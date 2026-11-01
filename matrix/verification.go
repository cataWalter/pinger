package matrix

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/verificationhelper"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const verificationQueueSize = 64

var (
	errVerificationUnavailable = errors.New("session verification is available once Matrix sync has started")
	errNoVerification          = errors.New("there is no session verification in progress")
	errVerificationBusy        = errors.New("finish or cancel the current session verification first")
)

type VerificationPhase string

const (
	VerificationRequested VerificationPhase = "requested"
	VerificationReady     VerificationPhase = "ready"
	VerificationComparing VerificationPhase = "comparing"
	VerificationConfirmed VerificationPhase = "confirmed"
	VerificationDone      VerificationPhase = "done"
	VerificationCancelled VerificationPhase = "cancelled"
)

type SASEmoji struct {
	Emoji       string
	Description string
}

// Verification is the interactive emoji (SAS) verification shown to the user.
type Verification struct {
	TransactionID string
	UserID        string
	DeviceID      string
	Incoming      bool
	Phase         VerificationPhase
	Emojis        []SASEmoji
	Decimals      []int
	Reason        string
}

func (v *Verification) active() bool {
	return v != nil && v.Phase != VerificationDone && v.Phase != VerificationCancelled
}

type verificationState struct {
	mu      sync.Mutex
	helper  *verificationhelper.VerificationHelper
	events  chan *event.Event
	current *Verification
}

// verificationSyncer lets the verification helper register handlers; hicli
// delivers to-device events through SyncComplete, which dispatches them here.
type verificationSyncer struct {
	mautrix.Syncer
	handlers *mautrix.DefaultSyncer
}

func (s verificationSyncer) OnSync(callback mautrix.SyncHandler) { s.handlers.OnSync(callback) }

func (s verificationSyncer) OnEvent(callback mautrix.EventHandler) { s.handlers.OnEvent(callback) }

func (s verificationSyncer) OnEventType(eventType event.Type, callback mautrix.EventHandler) {
	s.handlers.OnEventType(eventType, callback)
}

// attachVerification must run before the sync loop starts because it wraps the client's syncer.
func (c *Client) attachVerification() error {
	c.verification.mu.Lock()
	defer c.verification.mu.Unlock()
	if c.verification.helper != nil {
		return nil
	}
	handlers := mautrix.NewDefaultSyncer()
	c.engine.Client.Syncer = verificationSyncer{Syncer: c.engine.Client.Syncer, handlers: handlers}
	helper := verificationhelper.NewVerificationHelper(c.engine.Client, c.engine.Crypto, nil, verificationCallbacks{c}, false, false, true)
	if err := helper.Init(c.lifecycleCtx); err != nil {
		return fmt.Errorf("initialize session verification: %w", err)
	}
	events := make(chan *event.Event, verificationQueueSize)
	c.verification.helper = helper
	c.verification.events = events
	c.engine.ToDeviceInSync.Store(true)
	go c.runVerificationEvents(handlers, events)
	return nil
}

func (c *Client) runVerificationEvents(handlers *mautrix.DefaultSyncer, events <-chan *event.Event) {
	for {
		select {
		case <-c.done:
			return
		case evt := <-events:
			ctx, finish, err := c.beginOperation(c.engine.Client.Log.WithContext(context.Background()))
			if err != nil {
				return
			}
			handlers.Dispatch(ctx, evt)
			finish()
		}
	}
}

// queueVerificationEvents hands verification to-device events to a worker so
// the helper's network calls never block sync processing.
func (c *Client) queueVerificationEvents(toDevice []*jsoncmd.SyncToDevice) {
	c.verification.mu.Lock()
	events := c.verification.events
	c.verification.mu.Unlock()
	if events == nil {
		return
	}
	for _, item := range toDevice {
		if item == nil || !strings.HasPrefix(item.Type.Type, "m.key.verification.") {
			continue
		}
		evt := &event.Event{
			Sender:  item.Sender,
			Type:    event.Type{Type: item.Type.Type, Class: event.ToDeviceEventType},
			Content: event.Content{VeryRaw: item.Content},
		}
		if err := evt.Content.ParseRaw(evt.Type); err != nil {
			c.engine.Client.Log.Warn().Err(err).Str("event_type", evt.Type.Type).Msg("Skipping unparsable verification event")
			continue
		}
		select {
		case events <- evt:
		default:
			c.engine.Client.Log.Warn().Str("event_type", evt.Type.Type).Msg("Dropping verification event because the queue is full")
		}
	}
}

// Verification returns a copy of the current session verification, if any.
func (c *Client) Verification() *Verification {
	c.verification.mu.Lock()
	defer c.verification.mu.Unlock()
	if c.verification.current == nil {
		return nil
	}
	snapshot := *c.verification.current
	return &snapshot
}

func (c *Client) verificationHelper() *verificationhelper.VerificationHelper {
	c.verification.mu.Lock()
	defer c.verification.mu.Unlock()
	return c.verification.helper
}

func (c *Client) setVerification(next *Verification) {
	c.verification.mu.Lock()
	c.verification.current = next
	c.verification.mu.Unlock()
	c.publish(nil, "")
}

// updateVerification applies change only while txnID is still the shown verification.
func (c *Client) updateVerification(txnID id.VerificationTransactionID, change func(*Verification)) bool {
	c.verification.mu.Lock()
	current := c.verification.current
	if current == nil || current.TransactionID != string(txnID) {
		c.verification.mu.Unlock()
		return false
	}
	next := *current
	change(&next)
	c.verification.current = &next
	c.verification.mu.Unlock()
	c.publish(nil, "")
	return true
}

// StartSelfVerification asks the account's other sessions to verify this one with emoji.
func (c *Client) StartSelfVerification(ctx context.Context) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if !c.engine.IsLoggedIn() {
		return errors.New("sign in before verifying sessions")
	}
	if c.NeedsVerification() {
		return errors.New("verify this session with your recovery key first")
	}
	helper := c.verificationHelper()
	if helper == nil {
		return errVerificationUnavailable
	}
	if c.Verification().active() {
		return errVerificationBusy
	}
	self := c.engine.Client.UserID
	others, err := c.otherOwnDevices(ctx, self)
	if err != nil {
		return err
	}
	if others == 0 {
		if _, err = c.engine.Crypto.FetchKeys(ctx, []id.UserID{self}, true); err != nil {
			return fmt.Errorf("fetch your sessions: %w", err)
		}
		if others, err = c.otherOwnDevices(ctx, self); err != nil {
			return err
		} else if others == 0 {
			return errors.New("sign in on another device before verifying with emoji")
		}
	}
	txnID, err := helper.StartVerification(ctx, self)
	if err != nil {
		return fmt.Errorf("start session verification: %w", err)
	}
	c.setVerification(&Verification{TransactionID: string(txnID), UserID: self.String(), Phase: VerificationRequested})
	return nil
}

func (c *Client) otherOwnDevices(ctx context.Context, self id.UserID) (int, error) {
	devices, err := c.engine.Crypto.CryptoStore.GetDevices(ctx, self)
	if err != nil {
		return 0, fmt.Errorf("read your sessions: %w", err)
	}
	count := 0
	for deviceID := range devices {
		if deviceID != c.engine.Client.DeviceID {
			count++
		}
	}
	return count, nil
}

func (c *Client) beginVerificationAction(ctx context.Context, phase VerificationPhase) (context.Context, func(), *verificationhelper.VerificationHelper, id.VerificationTransactionID, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, nil, nil, "", err
	}
	helper := c.verificationHelper()
	current := c.Verification()
	if helper == nil || current == nil || current.Phase != phase {
		finish()
		return nil, nil, nil, "", errNoVerification
	}
	return ctx, finish, helper, id.VerificationTransactionID(current.TransactionID), nil
}

// AcceptVerification answers an incoming request; emoji comparison starts automatically.
func (c *Client) AcceptVerification(ctx context.Context) error {
	ctx, finish, helper, txnID, err := c.beginVerificationAction(ctx, VerificationRequested)
	if err != nil {
		return err
	}
	defer finish()
	if err = helper.AcceptVerification(ctx, txnID); err != nil {
		return fmt.Errorf("accept session verification: %w", err)
	}
	return nil
}

// ConfirmVerification records that the emoji match on both devices.
func (c *Client) ConfirmVerification(ctx context.Context) error {
	ctx, finish, helper, txnID, err := c.beginVerificationAction(ctx, VerificationComparing)
	if err != nil {
		return err
	}
	defer finish()
	if err = helper.ConfirmSAS(ctx, txnID); err != nil {
		return fmt.Errorf("confirm session verification: %w", err)
	}
	c.updateVerification(txnID, func(v *Verification) {
		if v.Phase == VerificationComparing {
			v.Phase = VerificationConfirmed
		}
	})
	return nil
}

// CancelVerification stops an active verification, or dismisses a finished one.
func (c *Client) CancelVerification(ctx context.Context, mismatch bool) error {
	current := c.Verification()
	if current == nil {
		return nil
	}
	c.setVerification(nil)
	if !current.active() {
		return nil
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	helper := c.verificationHelper()
	if helper == nil {
		return nil
	}
	code, reason := event.VerificationCancelCodeUser, "The user cancelled the verification."
	if mismatch {
		code, reason = event.VerificationCancelCodeSASMismatch, "The emoji did not match."
	}
	err = helper.CancelVerification(ctx, id.VerificationTransactionID(current.TransactionID), code, reason)
	if err != nil && !errors.Is(err, verificationhelper.ErrUnknownVerificationTransaction) {
		return fmt.Errorf("cancel session verification: %w", err)
	}
	return nil
}

func (c *Client) continueVerification(txnID id.VerificationTransactionID, supportsSAS bool) {
	ctx, finish, err := c.beginOperation(c.engine.Client.Log.WithContext(context.Background()))
	if err != nil {
		return
	}
	defer finish()
	helper := c.verificationHelper()
	if helper == nil {
		return
	}
	if !supportsSAS {
		reason := "The other session cannot compare emoji."
		if err = helper.CancelVerification(ctx, txnID, event.VerificationCancelCodeUnknownMethod, reason); err != nil {
			c.engine.Client.Log.Warn().Err(err).Msg("Failed to cancel verification without emoji support")
		}
		c.updateVerification(txnID, func(current *Verification) {
			current.Phase = VerificationCancelled
			current.Reason = reason
		})
		return
	}
	// Fails harmlessly when the other device starts emoji comparison first.
	if err = helper.StartSAS(ctx, txnID); err != nil {
		c.engine.Client.Log.Debug().Err(err).Msg("Emoji verification was not started by this device")
	}
}

// verificationCallbacks run while the helper holds its transaction lock, so
// they must not call back into the helper synchronously.
type verificationCallbacks struct{ client *Client }

func (v verificationCallbacks) VerificationRequested(_ context.Context, txnID id.VerificationTransactionID, from id.UserID, fromDevice id.DeviceID) {
	c := v.client
	c.verification.mu.Lock()
	if c.verification.current.active() {
		c.verification.mu.Unlock()
		return
	}
	c.verification.current = &Verification{TransactionID: string(txnID), UserID: from.String(), DeviceID: fromDevice.String(), Incoming: true, Phase: VerificationRequested}
	c.verification.mu.Unlock()
	c.publish(nil, "")
}

func (v verificationCallbacks) VerificationReady(_ context.Context, txnID id.VerificationTransactionID, otherDeviceID id.DeviceID, supportsSAS, _ bool, _ *verificationhelper.QRCode) {
	if v.client.updateVerification(txnID, func(current *Verification) {
		current.Phase = VerificationReady
		current.DeviceID = otherDeviceID.String()
	}) {
		go v.client.continueVerification(txnID, supportsSAS)
	}
}

func (v verificationCallbacks) ShowSAS(_ context.Context, txnID id.VerificationTransactionID, emojis []rune, descriptions []string, decimals []int) {
	sas := make([]SASEmoji, 0, len(emojis))
	for index, emoji := range emojis {
		description := ""
		if index < len(descriptions) {
			description = descriptions[index]
		}
		sas = append(sas, SASEmoji{Emoji: string(emoji), Description: description})
	}
	v.client.updateVerification(txnID, func(current *Verification) {
		current.Phase = VerificationComparing
		current.Emojis = sas
		current.Decimals = append([]int(nil), decimals...)
	})
}

func (v verificationCallbacks) VerificationCancelled(_ context.Context, txnID id.VerificationTransactionID, _ event.VerificationCancelCode, reason string) {
	v.client.updateVerification(txnID, func(current *Verification) {
		current.Phase = VerificationCancelled
		current.Reason = reason
		current.Emojis = nil
		current.Decimals = nil
	})
}

func (v verificationCallbacks) VerificationDone(_ context.Context, txnID id.VerificationTransactionID, _ event.VerificationMethod) {
	v.client.updateVerification(txnID, func(current *Verification) {
		current.Phase = VerificationDone
		current.Emojis = nil
		current.Decimals = nil
	})
}
