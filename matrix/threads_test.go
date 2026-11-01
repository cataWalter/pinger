package matrix

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func threadEvent(eventID id.EventID, relatesTo string) *database.Event {
	return &database.Event{
		ID:           eventID,
		Sender:       "@bob:example.org",
		Type:         event.EventMessage.Type,
		Timestamp:    jsontime.UM(time.Now()),
		RelatesTo:    "$root",
		RelationType: event.RelThread,
		Content:      json.RawMessage(`{"msgtype":"m.text","body":"in thread","m.relates_to":` + relatesTo + `}`),
	}
}

func TestMessageFromEventThreadRelations(t *testing.T) {
	cases := []struct {
		name      string
		relatesTo string
		replyTo   string
	}{
		{"fallback reply is not a quote", `{"rel_type":"m.thread","event_id":"$root","is_falling_back":true,"m.in_reply_to":{"event_id":"$latest"}}`, ""},
		{"real reply inside thread", `{"rel_type":"m.thread","event_id":"$root","m.in_reply_to":{"event_id":"$quoted"}}`, "$quoted"},
		{"thread without reply never quotes the root", `{"rel_type":"m.thread","event_id":"$root"}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			message, ok := messageFromEvent(threadEvent("$reply", tc.relatesTo))
			if !ok {
				t.Fatal("expected thread event to parse")
			}
			if message.ThreadRootID != "$root" || message.ReplyToEventID != tc.replyTo {
				t.Fatalf("thread root %q reply %q, want $root and %q", message.ThreadRootID, message.ReplyToEventID, tc.replyTo)
			}
		})
	}

	redacted := threadEvent("$gone", `{}`)
	redacted.RedactedBy = "$redaction"
	if message, ok := messageFromEvent(redacted); !ok || message.ThreadRootID != "$root" {
		t.Fatalf("redacted thread message = %+v, want thread root kept", message)
	}

	plain := &database.Event{
		ID:        "$plain",
		Type:      event.EventMessage.Type,
		Timestamp: jsontime.UM(time.Now()),
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"hi","m.relates_to":{"m.in_reply_to":{"event_id":"$quoted"}}}`),
	}
	if message, ok := messageFromEvent(plain); !ok || message.ThreadRootID != "" || message.ReplyToEventID != "$quoted" {
		t.Fatalf("plain reply = %+v, want no thread and reply $quoted", message)
	}
}

func insertThreadReply(t *testing.T, client *Client, roomID id.RoomID, eventID id.EventID, body string, timestamp time.Time) {
	t.Helper()
	evt := &database.Event{
		RoomID:       roomID,
		ID:           eventID,
		Sender:       "@bob:example.org",
		Type:         event.EventMessage.Type,
		Timestamp:    jsontime.UM(timestamp),
		RelatesTo:    "$root",
		RelationType: event.RelThread,
		Content:      json.RawMessage(`{"msgtype":"m.text","body":"` + body + `","m.relates_to":{"rel_type":"m.thread","event_id":"$root"}}`),
		Unsigned:     json.RawMessage(`{}`),
	}
	if _, err := client.engine.DB.Event.Insert(context.Background(), evt); err != nil {
		t.Fatalf("insert thread reply %s: %v", eventID, err)
	}
}

func TestThreadMessagesLoadsRootRepliesAndPendingSends(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!threads:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	start := time.Now().Add(-time.Hour)
	insertStoredMessage(t, client, roomID, "$root", "Root message", start)
	insertStoredMessage(t, client, roomID, "$other", "Not in the thread", start.Add(time.Minute))
	insertThreadReply(t, client, roomID, "$second", "Second reply", start.Add(3*time.Minute))
	insertThreadReply(t, client, roomID, "$first", "First reply", start.Add(2*time.Minute))
	client.storeLocalMessage(roomID.String(), Message{TransactionID: "txn-1", Body: "Sending reply", ThreadRootID: "$root", Timestamp: start.Add(4 * time.Minute), Sending: true})
	client.storeLocalMessage(roomID.String(), Message{TransactionID: "txn-2", Body: "Main timeline send", Timestamp: start.Add(5 * time.Minute), Sending: true})

	messages, err := client.ThreadMessages(ctx, roomID.String(), "$root")
	if err != nil {
		t.Fatalf("ThreadMessages() error = %v", err)
	}
	var bodies []string
	for _, message := range messages {
		bodies = append(bodies, message.Body)
	}
	want := []string{"Root message", "First reply", "Second reply", "Sending reply"}
	if len(bodies) != len(want) {
		t.Fatalf("thread bodies = %q, want %q", bodies, want)
	}
	for i := range want {
		if bodies[i] != want[i] {
			t.Fatalf("thread bodies = %q, want %q", bodies, want)
		}
	}
	if messages[1].ThreadRootID != "$root" || messages[0].ThreadRootID != "" {
		t.Fatalf("thread roots = %q, %q; want root unthreaded and reply in $root", messages[0].ThreadRootID, messages[1].ThreadRootID)
	}

	fallback, err := client.latestThreadEvent(ctx, roomID.String(), "$root")
	if err != nil || fallback != "$second" {
		t.Fatalf("latestThreadEvent() = %q, %v; want $second", fallback, err)
	}
	fallback, err = client.latestThreadEvent(ctx, roomID.String(), "$other")
	if err != nil || fallback != "$other" {
		t.Fatalf("latestThreadEvent() without replies = %q, %v; want the root", fallback, err)
	}
}

func TestThreadOperationsNeedASentRoot(t *testing.T) {
	client := &Client{}
	if _, err := client.ThreadMessages(context.Background(), "!room:example.org", "~pending"); !errors.Is(err, errThreadRoot) {
		t.Fatalf("ThreadMessages() error = %v, want errThreadRoot", err)
	}
	if err := client.SendThreadReply(context.Background(), "!room:example.org", "hi", ""); !errors.Is(err, errThreadRoot) {
		t.Fatalf("SendThreadReply() error = %v, want errThreadRoot", err)
	}
}
