package matrix

import (
	"context"
	"errors"
	"fmt"
	"maunium.net/go/mautrix/crypto/verificationhelper"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

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
