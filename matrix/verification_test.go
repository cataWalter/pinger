package matrix

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"maunium.net/go/mautrix/event"
)

type sentToDevice struct {
	eventType string
	body      map[string]map[string]map[string]any
}

func newVerificationTestClient(t *testing.T) (*Client, func() []sentToDevice) {
	t.Helper()
	client, err := NewWithLogOutput(filepath.Join(t.TempDir(), "profile", "matrix.db"), io.Discard)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	t.Cleanup(client.Close)

	var mu sync.Mutex
	var sent []sentToDevice
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if prefix := "/_matrix/client/v3/sendToDevice/"; strings.HasPrefix(r.URL.Path, prefix) {
			var body struct {
				Messages map[string]map[string]map[string]any `json:"messages"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			mu.Lock()
			sent = append(sent, sentToDevice{eventType: strings.Split(strings.TrimPrefix(r.URL.Path, prefix), "/")[0], body: body.Messages})
			mu.Unlock()
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(server.Close)
	client.engine.Client.HomeserverURL, _ = url.Parse(server.URL)
	client.engine.Client.UserID = "@me:example.org"
	client.engine.Client.DeviceID = "THIS"
	return client, func() []sentToDevice {
		mu.Lock()
		defer mu.Unlock()
		return append([]sentToDevice(nil), sent...)
	}
}

func waitForVerificationPhase(t *testing.T, client *Client, phase VerificationPhase) *Verification {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		if current := client.Verification(); current != nil && current.Phase == phase {
			return current
		}
		select {
		case <-client.events:
		case <-time.After(10 * time.Millisecond):
		case <-deadline:
			t.Fatalf("verification = %+v, want phase %q", client.Verification(), phase)
		}
	}
}

func waitForToDevice(t *testing.T, sent func() []sentToDevice, eventType string) sentToDevice {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, item := range sent() {
			if item.eventType == eventType {
				return item
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no %s to-device event in %+v", eventType, sent())
	return sentToDevice{}
}

func TestIncomingVerificationRequestCanBeAcceptedAndCancelled(t *testing.T) {
	client, sent := newVerificationTestClient(t)
	if err := client.attachVerification(); err != nil {
		t.Fatalf("attachVerification() error = %v", err)
	}
	helper := client.verificationHelper()
	if err := client.attachVerification(); err != nil || client.verificationHelper() != helper {
		t.Fatalf("second attachVerification() = %v, want the same helper", err)
	}
	if _, ok := client.engine.Client.Syncer.(verificationSyncer); !ok {
		t.Fatalf("syncer = %T, want verificationSyncer", client.engine.Client.Syncer)
	}
	if !client.engine.ToDeviceInSync.Load() {
		t.Fatal("expected hicli to forward to-device events")
	}

	request := `{"from_device":"OTHER","methods":["m.sas.v1"],"timestamp":` + strconv.FormatInt(time.Now().UnixMilli(), 10) + `,"transaction_id":"txn-1"}`
	client.handleBackendEvent(&jsoncmd.SyncComplete{ToDevice: []*jsoncmd.SyncToDevice{
		{Sender: "@me:example.org", Type: event.ToDeviceVerificationRequest, Content: json.RawMessage(request)},
	}})
	current := waitForVerificationPhase(t, client, VerificationRequested)
	if current.TransactionID != "txn-1" || current.UserID != "@me:example.org" || current.DeviceID != "OTHER" || !current.Incoming {
		t.Fatalf("incoming verification = %+v", current)
	}

	callbacks := verificationCallbacks{client}
	callbacks.VerificationRequested(context.Background(), "txn-2", "@me:example.org", "THIRD")
	if client.Verification().TransactionID != "txn-1" {
		t.Fatal("a second request replaced the one in progress")
	}
	if err := client.ConfirmVerification(context.Background()); !errors.Is(err, errNoVerification) {
		t.Fatalf("ConfirmVerification() before emoji = %v, want errNoVerification", err)
	}

	if err := client.AcceptVerification(context.Background()); err != nil {
		t.Fatalf("AcceptVerification() error = %v", err)
	}
	ready := waitForToDevice(t, sent, "m.key.verification.ready")
	if content := ready.body["@me:example.org"]["OTHER"]; content["from_device"] != "THIS" || content["transaction_id"] != "txn-1" {
		t.Fatalf("ready event = %+v", ready.body)
	}
	waitForVerificationPhase(t, client, VerificationReady)

	callbacks.ShowSAS(context.Background(), "txn-1", []rune{'🐶', '🔑'}, []string{"Dog", "Key"}, []int{1001, 2002, 3003})
	current = waitForVerificationPhase(t, client, VerificationComparing)
	if len(current.Emojis) != 2 || current.Emojis[0] != (SASEmoji{Emoji: "🐶", Description: "Dog"}) || len(current.Decimals) != 3 {
		t.Fatalf("emoji verification = %+v", current)
	}

	if err := client.CancelVerification(context.Background(), true); err != nil {
		t.Fatalf("CancelVerification() error = %v", err)
	}
	if client.Verification() != nil {
		t.Fatal("cancelling should clear the verification")
	}
	cancel := waitForToDevice(t, sent, "m.key.verification.cancel")
	if content := cancel.body["@me:example.org"]["OTHER"]; content["code"] != string(event.VerificationCancelCodeSASMismatch) {
		t.Fatalf("cancel event = %+v", cancel.body)
	}
}

func TestVerificationCallbacksOnlyTouchTheShownTransaction(t *testing.T) {
	client, _ := newVerificationTestClient(t)
	callbacks := verificationCallbacks{client}
	ctx := context.Background()

	callbacks.VerificationDone(ctx, "unknown", event.VerificationMethodSAS)
	if client.Verification() != nil {
		t.Fatal("an unknown transaction created a verification")
	}

	callbacks.VerificationRequested(ctx, "txn", "@friend:example.org", "PHONE")
	callbacks.VerificationCancelled(ctx, "other", event.VerificationCancelCodeUser, "ignored")
	if client.Verification().Phase != VerificationRequested {
		t.Fatal("a different transaction changed the verification")
	}
	callbacks.VerificationCancelled(ctx, "txn", event.VerificationCancelCodeTimeout, "verification timed out")
	if current := client.Verification(); current.Phase != VerificationCancelled || current.Reason != "verification timed out" {
		t.Fatalf("cancelled verification = %+v", current)
	}

	callbacks.VerificationRequested(ctx, "next", "@me:example.org", "LAPTOP")
	callbacks.VerificationDone(ctx, "next", event.VerificationMethodSAS)
	if current := client.Verification(); current.Phase != VerificationDone || current.TransactionID != "next" {
		t.Fatalf("finished verification = %+v", current)
	}
	if err := client.CancelVerification(ctx, false); err != nil || client.Verification() != nil {
		t.Fatalf("dismissing a finished verification = %v, %+v", err, client.Verification())
	}
}

func TestQueueVerificationEventsOnlyForwardsVerification(t *testing.T) {
	client, _ := newVerificationTestClient(t)
	events := make(chan *event.Event, 4)
	client.verification.events = events

	client.queueVerificationEvents([]*jsoncmd.SyncToDevice{
		nil,
		{Sender: "@me:example.org", Type: event.ToDeviceRoomKey, Content: json.RawMessage(`{}`)},
		{Sender: "@me:example.org", Type: event.ToDeviceVerificationCancel, Content: json.RawMessage(`{`)},
		{Sender: "@me:example.org", Type: event.Type{Type: "m.key.verification.start"}, Content: json.RawMessage(`{"transaction_id":"txn","method":"m.sas.v1","from_device":"OTHER"}`)},
	})
	if len(events) != 1 {
		t.Fatalf("queued %d events, want 1", len(events))
	}
	evt := <-events
	if evt.Type != event.ToDeviceVerificationStart || evt.Sender != "@me:example.org" {
		t.Fatalf("queued event = %+v", evt)
	}
	if start, ok := evt.Content.Parsed.(*event.VerificationStartEventContent); !ok || start.TransactionID != "txn" {
		t.Fatalf("parsed content = %#v", evt.Content.Parsed)
	}
}

func TestSessionVerificationNeedsASignedInSession(t *testing.T) {
	client, _ := newVerificationTestClient(t)
	ctx := context.Background()
	if err := client.StartSelfVerification(ctx); err == nil {
		t.Fatal("StartSelfVerification() without an account succeeded")
	}
	if err := client.AcceptVerification(ctx); !errors.Is(err, errNoVerification) {
		t.Fatalf("AcceptVerification() = %v, want errNoVerification", err)
	}
	if err := client.CancelVerification(ctx, false); err != nil {
		t.Fatalf("CancelVerification() with nothing shown = %v", err)
	}
}
