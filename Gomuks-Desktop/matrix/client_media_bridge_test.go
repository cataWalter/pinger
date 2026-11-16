package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCachedMediaBytesUsesIncomingEncryptionMetadata(t *testing.T) {
	uri := "mxc://example.org/encrypted-image"
	client := &Client{mediaCacheDir: t.TempDir()}
	client.rememberMediaEncryption([]Message{{
		MediaURI:       uri,
		MediaEncrypted: &event.EncryptedFileInfo{},
	}})

	plainPath, err := client.mediaCachePathFor(uri, false)
	if err != nil {
		t.Fatal(err)
	}
	encryptedPath, err := client.mediaCachePathFor(uri, true)
	if err != nil {
		t.Fatal(err)
	}
	if plainPath == encryptedPath {
		t.Fatal("encrypted and plaintext media must use distinct cache paths")
	}
	if err := os.MkdirAll(filepath.Dir(encryptedPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(plainPath, []byte("ciphertext"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(encryptedPath, []byte("decrypted image"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := client.CachedMediaBytes(context.Background(), uri)
	if err != nil || string(got) != "decrypted image" {
		t.Fatalf("cached media = %q, %v; want decrypted image", got, err)
	}
	if path, ok := client.CachedMediaPath(uri); !ok || path != encryptedPath {
		t.Fatalf("cached media path = %q, %v; want %q", path, ok, encryptedPath)
	}
}

func TestBridgeLabelDetectsNetworks(t *testing.T) {
	name := "WhatsApp Bridge"
	client := &Client{}
	_ = client
	room := roomForBridgeTest(&name, "@_whatsapp_user:example.org")
	if got := bridgeLabel(room); got != "WA" {
		t.Fatalf("bridge = %q, want WA", got)
	}
	plain := roomForBridgeTest(nil, "")
	if got := bridgeLabel(plain); got != "" {
		t.Fatalf("plain bridge = %q, want empty", got)
	}
	if got := bridgeLabel(nil); got != "" {
		t.Fatalf("nil bridge = %q, want empty", got)
	}
	topic := "Instagram private chat"
	instagram := &database.Room{ID: "!room:example.org", Topic: &topic}
	if got := bridgeLabel(instagram); got != "IG" {
		t.Fatalf("Instagram topic bridge = %q, want IG", got)
	}
	ghost := &database.Room{
		ID:              "!room:example.org",
		LazyLoadSummary: &mautrix.LazyLoadSummary{Heroes: []id.UserID{"@instagramgo_114644436598164:beeper.local"}},
	}
	if got := bridgeLabel(ghost); got != "IG" {
		t.Fatalf("Instagram ghost hero bridge = %q, want IG", got)
	}
}

func roomForBridgeTest(name *string, dmUser string) *database.Room {
	room := &database.Room{ID: "!room:example.org", Name: name}
	if dmUser != "" {
		dm := id.UserID(dmUser)
		room.DMUserID = &dm
	}
	return room
}

func stringPointer(value string) *string {
	return &value
}

func TestMessageFromEventTreatsNotSentAsPendingNotError(t *testing.T) {
	evt := &database.Event{
		ID:        id.EventID("~hicli-1"),
		Sender:    id.UserID("@me:example.org"),
		Type:      event.EventMessage.Type,
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"hi"}`),
		SendError: "not sent",
	}
	message, ok := messageFromEvent(evt)
	if !ok {
		t.Fatal("expected pending message to be represented")
	}
	if !message.Sending {
		t.Fatalf("Sending = false, want true: %+v", message)
	}
	if message.SendError != "" {
		t.Fatalf("SendError = %q, want empty (pending marker is not a failure)", message.SendError)
	}
	if message.Edited {
		t.Fatalf("fresh send flagged as edited: %+v", message)
	}
}

func TestMessageFromEventKeepsRealSendErrors(t *testing.T) {
	evt := &database.Event{
		ID:        id.EventID("~hicli-2"),
		Sender:    id.UserID("@me:example.org"),
		Type:      event.EventMessage.Type,
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"hi"}`),
		SendError: "failed to encrypt: boom",
	}
	message, ok := messageFromEvent(evt)
	if !ok {
		t.Fatal("expected failed message to be represented")
	}
	if message.SendError != "failed to encrypt: boom" {
		t.Fatalf("SendError = %q, want the real failure", message.SendError)
	}
}

func TestMessageFromEventClearsSendingForConfirmedEvent(t *testing.T) {
	// gomuks leaves the "not sent" marker on the row even after a successful
	// send (its deferred cleanup re-writes it once UpdateID has cleared it), so
	// a real event ID must win over send_error and drop the pending state.
	evt := &database.Event{
		ID:        id.EventID("$confirmed:example.org"),
		Sender:    id.UserID("@me:example.org"),
		Type:      event.EventMessage.Type,
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"hi"}`),
		SendError: "not sent",
	}
	message, ok := messageFromEvent(evt)
	if !ok {
		t.Fatal("expected confirmed message to be represented")
	}
	if message.Sending {
		t.Fatalf("Sending = true for a confirmed event, want false: %+v", message)
	}
	if message.SendError != "" {
		t.Fatalf("SendError = %q, want empty for a confirmed event", message.SendError)
	}
}

func TestMessageFromEventKeepsUnplacedEventPending(t *testing.T) {
	evt := &database.Event{
		Sender:    id.UserID("@me:example.org"),
		Type:      event.EventMessage.Type,
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"hi"}`),
		SendError: "not sent",
	}
	message, ok := messageFromEvent(evt)
	if !ok {
		t.Fatal("expected unplaced message to be represented")
	}
	if !message.Sending {
		t.Fatalf("Sending = false for an event without an ID, want true: %+v", message)
	}
}

func TestShadowedByServerRowCoversRenamedOptimisticEntry(t *testing.T) {
	sentAt := time.Now()
	server := []Message{{ID: "$real", Sender: "@me:example.org", Body: "hi", Timestamp: sentAt}}
	pending := Message{ID: "~hicli-1", Sender: "@me:example.org", Body: "hi", Sending: true, Timestamp: sentAt}
	if !shadowedByServerRow(server, pending) {
		t.Fatal("expected server-confirmed row to shadow the stale pending entry")
	}
	other := Message{ID: "~hicli-9", Sender: "@me:example.org", Body: "different", Sending: true, Timestamp: sentAt}
	if shadowedByServerRow(server, other) {
		t.Fatal("different body must not be shadowed")
	}
}
