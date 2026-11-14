package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"path/filepath"
	"testing"
	"time"
)

func FuzzMessageFromEvent(f *testing.F) {
	for _, content := range []string{`{"msgtype":"m.text","body":"hello"}`, `{"msgtype":"m.image","body":"image.png","url":"mxc://example.org/image"}`, `{"msgtype":"com.beeper.gallery","com.beeper.gallery.images":[]}`, `{"msgtype":"m.text","body":{}}`, `null`, `[]`, ``} {
		f.Add([]byte(content))
	}
	f.Fuzz(func(t *testing.T, content []byte) {
		if len(content) > 64*1024 {
			t.Skip()
		}
		evt := &database.Event{ID: "$fuzz", Sender: "@fuzz:example.org", Type: event.EventMessage.Type, Content: json.RawMessage(content)}
		message, ok := messageFromEvent(evt)
		if ok && (message.ID != string(evt.ID) || message.Sender != string(evt.Sender)) {
			t.Fatalf("parsed message changed event identity: %+v", message)
		}
	})
}

func TestMessageFromEvent(t *testing.T) {
	timestamp := time.Date(2026, time.October, 14, 17, 0, 0, 0, time.UTC)
	evt := &database.Event{
		ID:        id.EventID("$message"),
		Sender:    id.UserID("@alice:example.org"),
		Type:      event.EventMessage.Type,
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"hello","formatted_body":"<strong>hello</strong>"}`),
		Timestamp: jsontime.UM(timestamp),
	}

	message, ok := messageFromEvent(evt)
	if !ok {
		t.Fatal("expected a Matrix text message")
	}
	if message.ID != "$message" || message.Sender != "@alice:example.org" || message.Body != "hello" {
		t.Fatalf("unexpected message snapshot: %+v", message)
	}
	if !message.Timestamp.Equal(timestamp) {
		t.Fatalf("timestamp = %s, want %s", message.Timestamp, timestamp)
	}
	if message.FormattedBody != "<strong>hello</strong>" {
		t.Fatalf("formatted body = %q", message.FormattedBody)
	}
}

func TestScheduledSendCompletionWaitsForServerResult(t *testing.T) {
	for _, test := range []struct {
		name       string
		eventID    id.EventID
		sendError  string
		wantResult bool
		wantError  bool
	}{
		{name: "pending is not delivered", eventID: "~pending"},
		{name: "server confirmed", eventID: "$server", wantResult: true},
		{name: "delivery failed", eventID: "~pending", sendError: "server rejected message", wantResult: true, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			completion := make(chan error, 1)
			client := &Client{scheduledSends: map[string]chan error{"txn": completion}}
			client.completeScheduledSendLocked(&jsoncmd.SendComplete{Event: &database.Event{
				ID: test.eventID, TransactionID: "txn", SendError: test.sendError,
			}})
			select {
			case err := <-completion:
				if !test.wantResult || (err != nil) != test.wantError {
					t.Fatalf("completion = %v, want result=%v error=%v", err, test.wantResult, test.wantError)
				}
			default:
				if test.wantResult {
					t.Fatal("delivery completion was not reported")
				}
			}
		})
	}
}

func TestPasswordUIASessionRequiresSinglePasswordStage(t *testing.T) {
	passwordFlow := func(stages ...any) *mautrix.RespError {
		return &mautrix.RespError{
			ErrCode: "M_UNAUTHORIZED",
			ExtraData: map[string]any{
				"session": "uia-session",
				"flows":   []any{map[string]any{"stages": stages}},
			},
		}
	}

	tests := []struct {
		name     string
		apiError *mautrix.RespError
		want     bool
	}{
		{name: "password flow", apiError: passwordFlow(string(mautrix.AuthTypePassword)), want: true},
		{name: "multi-stage flow", apiError: passwordFlow(string(mautrix.AuthTypePassword), "m.login.recaptcha")},
		{name: "different flow", apiError: passwordFlow("m.login.sso")},
		{name: "wrong error", apiError: &mautrix.RespError{ErrCode: "M_FORBIDDEN", ExtraData: map[string]any{"session": "uia-session", "flows": []any{map[string]any{"stages": []any{string(mautrix.AuthTypePassword)}}}}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			session, ok := passwordUIASession(test.apiError)
			if ok != test.want {
				t.Fatalf("password UIAA supported = %t, want %t", ok, test.want)
			}
			if ok && session != "uia-session" {
				t.Fatalf("UIAA session = %q, want %q", session, "uia-session")
			}
		})
	}
}

func TestPasswordUIAAAuthUsesMatrixUserField(t *testing.T) {
	payload, err := json.Marshal(passwordUIAAAuth{
		Type:     mautrix.AuthTypePassword,
		User:     "@me:example.org",
		Password: "secret",
		Session:  "uia-session",
	})
	if err != nil {
		t.Fatal(err)
	}
	var auth map[string]string
	if err = json.Unmarshal(payload, &auth); err != nil {
		t.Fatal(err)
	}
	if auth["type"] != string(mautrix.AuthTypePassword) || auth["user"] != "@me:example.org" || auth["password"] != "secret" || auth["session"] != "uia-session" {
		t.Fatalf("unexpected password UIAA payload: %s", payload)
	}
	if _, ok := auth["identifier"]; ok {
		t.Fatalf("password UIAA payload must not use the login identifier field: %s", payload)
	}
}

func TestEnrichReplyPreviewFromStoredEvent(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!reply-preview:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	insertStoredMessage(t, client, roomID, "$quoted", "Original message text", time.Now())
	insertStoredMessage(t, client, roomID, "$thread-root", "Thread root text", time.Now())

	replyEvent := &database.Event{
		ID:           "$reply",
		Sender:       "@bob:example.org",
		Type:         event.EventMessage.Type,
		Timestamp:    jsontime.UM(time.Now()),
		RelatesTo:    "$thread-root",
		RelationType: event.RelThread,
		Content:      json.RawMessage(`{"msgtype":"m.text","body":"Reply text","m.relates_to":{"rel_type":"m.thread","event_id":"$thread-root","m.in_reply_to":{"event_id":"$quoted"}}}`),
	}
	reply, ok := messageFromEvent(replyEvent)
	if !ok {
		t.Fatal("expected reply event to parse")
	}
	if reply.ReplyToEventID != "$quoted" {
		t.Fatalf("reply target = %q, want $quoted", reply.ReplyToEventID)
	}

	messages := []Message{reply}
	client.enrichReplyPreviews(ctx, roomID.String(), messages)
	if messages[0].ReplyToSender != "@alice:example.org" || messages[0].ReplyToPreview != "Original message text" {
		t.Fatalf("reply preview = sender %q, text %q; want sender @alice:example.org and original text", messages[0].ReplyToSender, messages[0].ReplyToPreview)
	}
}

func TestApplyLatestReadReceiptMarksLatestOwnMessage(t *testing.T) {
	seenAt := time.Date(2026, time.October, 20, 16, 40, 0, 0, time.UTC)
	ownUserID := id.UserID("@me:example.org")
	messages := []Message{
		{ID: "$first", Own: true},
		{ID: "$older-receipt", Own: false},
		{ID: "$latest-own", Own: true},
		{ID: "$latest-receipt", Own: false},
	}
	receipts := map[id.EventID][]*database.Receipt{
		"$older-receipt": {{
			UserID:      "@friend:example.org",
			ReceiptType: event.ReceiptTypeRead,
			Timestamp:   jsontime.UM(seenAt.Add(-time.Minute)),
		}},
		"$latest-own": {{
			UserID:      ownUserID,
			ReceiptType: event.ReceiptTypeRead,
			Timestamp:   jsontime.UM(seenAt.Add(time.Minute)),
		}},
		"$latest-receipt": {{
			UserID:      "@friend:example.org",
			ReceiptType: event.ReceiptTypeRead,
			Timestamp:   jsontime.UM(seenAt),
		}, {
			UserID:      "@friend:example.org",
			ReceiptType: event.ReceiptTypeRead,
			ThreadID:    "$thread-root",
			Timestamp:   jsontime.UM(seenAt.Add(time.Minute)),
		}},
	}

	applyLatestReadReceipt(messages, receipts, ownUserID)

	if !messages[2].SeenAt.Equal(seenAt) {
		t.Fatalf("latest own message SeenAt = %v, want %v", messages[2].SeenAt, seenAt)
	}
	if !messages[0].SeenAt.IsZero() || !messages[1].SeenAt.IsZero() || !messages[3].SeenAt.IsZero() {
		t.Fatalf("receipt should mark only the latest preceding own message: %+v", messages)
	}
}

func TestTimelineMessagePrefixCountsVisibleMessages(t *testing.T) {
	events := []*database.Event{
		{Type: event.EventReaction.Type, RedactedBy: "$redaction"},
		{ID: "$first", Type: event.EventMessage.Type, Content: json.RawMessage(`{"body":"first"}`)},
		{ID: "$second", Type: event.EventMessage.Type, Content: json.RawMessage(`{"body":"second"}`)},
	}

	prefix, messages := timelineMessagePrefix(events, 1, nil)
	if prefix != 2 || len(messages) != 1 || messages[0].Body != "first" {
		t.Fatalf("timeline prefix = %d with messages %+v, want 2 with the first message", prefix, messages)
	}
}

func TestHasServerHistory(t *testing.T) {
	tests := []struct {
		name string
		room *database.Room
		want bool
	}{
		{name: "missing room"},
		{name: "no pagination token", room: &database.Room{}},
		{name: "pagination complete", room: &database.Room{PrevBatch: database.PrevBatchPaginationComplete}},
		{name: "server history available", room: &database.Room{PrevBatch: "opaque-next-page-token"}, want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := hasServerHistory(test.room); got != test.want {
				t.Fatalf("hasServerHistory() = %t, want %t", got, test.want)
			}
		})
	}
}
