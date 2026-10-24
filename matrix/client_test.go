package matrix

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

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

func TestHistoryPageReportsServerBackfill(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!history:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	if err = client.engine.DB.Room.SetPrevBatch(ctx, roomID, "opaque-next-page-token"); err != nil {
		t.Fatalf("set room pagination token: %v", err)
	}

	page, err := client.HistoryPageWithLimit(ctx, roomID.String(), 0, 25)
	if err != nil {
		t.Fatalf("load initial history page: %v", err)
	}
	if !page.HasMore {
		t.Fatal("initial history page should expose server-side older messages")
	}
}

func BenchmarkHistoryPageWithLimit(b *testing.B) {
	for _, messageCount := range []int{100, 250} {
		b.Run(fmt.Sprintf("messages-%d", messageCount), func(b *testing.B) {
			client, err := New(filepath.Join(b.TempDir(), "profile", "matrix.db"))
			if err != nil {
				b.Fatalf("create client: %v", err)
			}
			defer client.Close()

			ctx := context.Background()
			roomID := id.RoomID("!history-benchmark:example.org")
			if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
				b.Fatalf("create room row: %v", err)
			}
			rowIDs := make([]database.EventRowID, 0, messageCount)
			base := time.Date(2026, time.October, 19, 12, 0, 0, 0, time.UTC)
			for i := 0; i < messageCount; i++ {
				content := json.RawMessage(fmt.Sprintf(`{"msgtype":"m.text","body":"benchmark message %d"}`, i))
				rowID, insertErr := client.engine.DB.Event.Insert(ctx, &database.Event{
					RoomID:    roomID,
					ID:        id.EventID(fmt.Sprintf("$history-benchmark-%d", i)),
					Sender:    id.UserID("@alice:example.org"),
					Type:      event.EventMessage.Type,
					Timestamp: jsontime.UM(base.Add(time.Duration(i) * time.Second)),
					Content:   content,
					Unsigned:  json.RawMessage(`{}`),
				})
				if insertErr != nil {
					b.Fatalf("insert benchmark event %d: %v", i, insertErr)
				}
				rowIDs = append(rowIDs, rowID)
			}
			if _, err = client.engine.DB.Timeline.Append(ctx, roomID, rowIDs); err != nil {
				b.Fatalf("append benchmark timeline: %v", err)
			}

			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				page, historyErr := client.HistoryPageWithLimit(ctx, roomID.String(), 0, messageCount)
				if historyErr != nil {
					b.Fatalf("load benchmark history: %v", historyErr)
				}
				if len(page.Messages) != messageCount {
					b.Fatalf("loaded %d messages, want %d", len(page.Messages), messageCount)
				}
			}
		})
	}
}

func BenchmarkApplySync(b *testing.B) {
	for _, eventCount := range []int{100, 250} {
		b.Run(fmt.Sprintf("events-%d", eventCount), func(b *testing.B) {
			roomID := id.RoomID("!sync-benchmark:example.org")
			syncRoom := &jsoncmd.SyncRoom{
				Timeline: make([]database.TimelineRowTuple, 0, eventCount),
				Events:   make([]*database.Event, 0, eventCount),
			}
			base := time.Date(2026, time.October, 19, 12, 0, 0, 0, time.UTC)
			for i := 0; i < eventCount; i++ {
				rowID := database.EventRowID(i + 1)
				syncRoom.Timeline = append(syncRoom.Timeline, database.TimelineRowTuple{
					Timeline: database.TimelineRowID(i + 1),
					Event:    rowID,
				})
				syncRoom.Events = append(syncRoom.Events, &database.Event{
					RowID:     rowID,
					ID:        id.EventID(fmt.Sprintf("$sync-benchmark-%d", i)),
					Sender:    id.UserID("@alice:example.org"),
					Type:      event.EventMessage.Type,
					Timestamp: jsontime.UM(base.Add(time.Duration(i) * time.Second)),
					Content:   json.RawMessage(`{"msgtype":"m.text","body":"benchmark sync event"}`),
				})
			}
			syncEvent := &jsoncmd.SyncComplete{Rooms: map[id.RoomID]*jsoncmd.SyncRoom{roomID: syncRoom}}
			client := &Client{done: make(chan struct{}), rooms: make(map[string]Room)}

			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				client.applySync(syncEvent, false)
			}
		})
	}
}

// insertStoredMessage stores a message the way an earlier sync or history page would.
func insertStoredMessage(t *testing.T, client *Client, roomID id.RoomID, eventID id.EventID, body string, timestamp time.Time) {
	t.Helper()
	content, err := json.Marshal(map[string]string{"msgtype": "m.text", "body": body})
	if err != nil {
		t.Fatalf("marshal message content: %v", err)
	}
	evt := &database.Event{
		RoomID:    roomID,
		ID:        eventID,
		Sender:    id.UserID("@alice:example.org"),
		Type:      event.EventMessage.Type,
		Timestamp: jsontime.UM(timestamp),
		Content:   content,
		Unsigned:  json.RawMessage(`{}`),
	}
	if _, err = client.engine.DB.Event.Insert(context.Background(), evt); err != nil {
		t.Fatalf("insert message %s: %v", eventID, err)
	}
}

// insertStoredTopic stores a state event, which is never used as a preview.
func insertStoredTopic(t *testing.T, client *Client, roomID id.RoomID, eventID id.EventID, timestamp time.Time) {
	t.Helper()
	evt := &database.Event{
		RoomID:    roomID,
		ID:        eventID,
		Sender:    id.UserID("@alice:example.org"),
		Type:      event.StateTopic.Type,
		StateKey:  stringPointer(""),
		Timestamp: jsontime.UM(timestamp),
		Content:   json.RawMessage(`{"topic":"state only"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	if _, err := client.engine.DB.Event.Insert(context.Background(), evt); err != nil {
		t.Fatalf("insert topic state %s: %v", eventID, err)
	}
}

func TestStoredRoomPreviewReturnsNewestStoredMessage(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!stored-preview:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	base := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	insertStoredMessage(t, client, roomID, "$older", "older text", base)
	insertStoredMessage(t, client, roomID, "$newer", "newer text", base.Add(time.Hour))
	insertStoredTopic(t, client, roomID, "$topic", base.Add(2*time.Hour))
	edit := &database.Event{
		RoomID:       roomID,
		ID:           id.EventID("$edit"),
		Sender:       id.UserID("@alice:example.org"),
		Type:         event.EventMessage.Type,
		Timestamp:    jsontime.UM(base.Add(3 * time.Hour)),
		Content:      json.RawMessage(`{"msgtype":"m.text","body":"edited text"}`),
		Unsigned:     json.RawMessage(`{}`),
		RelatesTo:    id.EventID("$newer"),
		RelationType: event.RelReplace,
	}
	if _, err = client.engine.DB.Event.Insert(ctx, edit); err != nil {
		t.Fatalf("insert edit: %v", err)
	}

	message, ok, err := client.storedRoomPreview(ctx, roomID)
	if err != nil {
		t.Fatalf("load stored preview: %v", err)
	}
	if !ok || message.ID != "$newer" || message.Body != "newer text" {
		t.Fatalf("stored preview = %+v (found %t), want the newest original message", message, ok)
	}

	stateOnlyRoomID := id.RoomID("!state-only-preview:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, stateOnlyRoomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	insertStoredTopic(t, client, stateOnlyRoomID, "$topic-only", base)
	if _, ok, err = client.storedRoomPreview(ctx, stateOnlyRoomID); err != nil || ok {
		t.Fatalf("state-only room found=%t err=%v, want no preview", ok, err)
	}
}

func TestPreviewFromHistoryReadsOnlyWithinBudget(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	base := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	newRoom := func(t *testing.T, name, prevBatch string) id.RoomID {
		t.Helper()
		roomID := id.RoomID("!" + name + ":example.org")
		if err := client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
			t.Fatalf("create room row: %v", err)
		}
		if prevBatch != "" {
			if err := client.engine.DB.Room.SetPrevBatch(ctx, roomID, prevBatch); err != nil {
				t.Fatalf("set room pagination token: %v", err)
			}
		}
		return roomID
	}
	emptyPages := func(calls *int, hasMore bool) previewPageFunc {
		return func(context.Context, id.RoomID, int, bool) (*jsoncmd.PaginationResponse, error) {
			*calls++
			return &jsoncmd.PaginationResponse{HasMore: hasMore}, nil
		}
	}

	t.Run("stops at the first page that yields a message", func(t *testing.T) {
		roomID := newRoom(t, "found-on-first-page", "opaque-token")
		calls := 0
		page := func(_ context.Context, pageRoomID id.RoomID, _ int, _ bool) (*jsoncmd.PaginationResponse, error) {
			calls++
			insertStoredMessage(t, client, pageRoomID, "$history", "from history", base)
			return &jsoncmd.PaginationResponse{HasMore: true}, nil
		}
		message, ok, err := client.previewFromHistory(ctx, roomID, page)
		if err != nil || !ok || message.Body != "from history" || calls != 1 {
			t.Fatalf("preview = %+v found=%t err=%v calls=%d, want one call and the history message", message, ok, err, calls)
		}
	})

	t.Run("uses the page budget when no page yields a message", func(t *testing.T) {
		roomID := newRoom(t, "budget-only", "opaque-token")
		calls := 0
		_, ok, err := client.previewFromHistory(ctx, roomID, emptyPages(&calls, true))
		if err != nil || ok || calls != previewHistoryMaxPages {
			t.Fatalf("found=%t err=%v calls=%d, want no preview after %d pages", ok, err, calls, previewHistoryMaxPages)
		}
	})

	t.Run("stops when server history is complete", func(t *testing.T) {
		roomID := newRoom(t, "complete-after-one-page", "opaque-token")
		calls := 0
		_, ok, err := client.previewFromHistory(ctx, roomID, emptyPages(&calls, false))
		if err != nil || ok || calls != 1 {
			t.Fatalf("found=%t err=%v calls=%d, want one call and no preview", ok, err, calls)
		}
	})

	t.Run("makes no request without server history left", func(t *testing.T) {
		calls := 0
		for _, roomID := range []id.RoomID{
			newRoom(t, "no-token", ""),
			newRoom(t, "already-complete", database.PrevBatchPaginationComplete),
		} {
			if _, ok, err := client.previewFromHistory(ctx, roomID, emptyPages(&calls, true)); err != nil || ok {
				t.Fatalf("room %s found=%t err=%v, want no preview", roomID, ok, err)
			}
		}
		if calls != 0 {
			t.Fatalf("pagination calls = %d, want none", calls)
		}
	})

	t.Run("leaves rooms that are already paginating", func(t *testing.T) {
		roomID := newRoom(t, "already-paging", "opaque-token")
		calls := 0
		page := func(context.Context, id.RoomID, int, bool) (*jsoncmd.PaginationResponse, error) {
			calls++
			return nil, hicli.ErrPaginationAlreadyInProgress
		}
		_, ok, err := client.previewFromHistory(ctx, roomID, page)
		if err != nil || ok || calls != 1 {
			t.Fatalf("found=%t err=%v calls=%d, want one call and no error", ok, err, calls)
		}
	})
}

func TestApplyRoomPreviewKeepsSortingAndReplyState(t *testing.T) {
	sortedAt := time.Date(2026, time.October, 12, 9, 0, 0, 0, time.UTC)
	historyAt := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	client := &Client{
		rooms: map[string]Room{
			"!no-event:example.org":  {ID: "!no-event:example.org", LastSeen: sortedAt},
			"!has-event:example.org": {ID: "!has-event:example.org", LastSeen: sortedAt, LastEventAt: sortedAt, LastEventID: "$live"},
			"!set:example.org":       {ID: "!set:example.org", Preview: "kept", LastSeen: sortedAt},
		},
		dismissedEvents: map[string]string{},
	}
	history := Message{ID: "$history", Body: "old text", Sender: "@friend:example.org", Timestamp: historyAt}

	if !client.applyRoomPreview("!no-event:example.org", history) {
		t.Fatal("empty preview was not filled")
	}
	if !client.applyRoomPreview("!has-event:example.org", history) {
		t.Fatal("empty preview in a room with a newer event was not filled")
	}
	if client.applyRoomPreview("!set:example.org", Message{ID: "$other", Body: "replacement", Timestamp: historyAt}) {
		t.Fatal("existing preview was replaced")
	}

	noEvent := client.rooms["!no-event:example.org"]
	if noEvent.Preview != "old text" || noEvent.LastEventID != "$history" || !noEvent.LastEventAt.Equal(historyAt) {
		t.Fatalf("room without an event time = %+v, want the history message as its last event", noEvent)
	}
	hasEvent := client.rooms["!has-event:example.org"]
	if hasEvent.Preview != "old text" || hasEvent.LastEventID != "$live" || !hasEvent.LastEventAt.Equal(sortedAt) {
		t.Fatalf("room with a newer event = %+v, want its last event kept", hasEvent)
	}
	for _, room := range []Room{noEvent, hasEvent} {
		if !room.LastSeen.Equal(sortedAt) || room.LastEventSender != "" || room.Unanswered {
			t.Fatalf("sorting or reply state changed: %+v", room)
		}
	}
	if kept := client.rooms["!set:example.org"]; kept.Preview != "kept" {
		t.Fatalf("existing preview = %q, want kept", kept.Preview)
	}
}

func TestFillMissingPreviewsRestoresStoredMessagesWithoutNetwork(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!restored:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	base := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	sortedAt := base.Add(24 * time.Hour)
	insertStoredMessage(t, client, roomID, "$stored", "stored text", base)
	client.mu.Lock()
	client.rooms[roomID.String()] = Room{ID: roomID.String(), LastSeen: sortedAt}
	client.mu.Unlock()

	client.fillMissingPreviews(ctx, false)

	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "stored text" || !rooms[0].LastEventAt.Equal(base) {
		t.Fatalf("rooms = %+v, want the stored message as preview", rooms)
	}
	if !rooms[0].LastSeen.Equal(sortedAt) {
		t.Fatalf("LastSeen = %v, want sorting time unchanged", rooms[0].LastSeen)
	}
}

func TestMessageFromEventMapsMediaMetadata(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantURI    string
		wantMIME   string
		wantBody   string
		wantWidth  int
		wantHeight int
		encrypted  bool
	}{
		{
			name:       "unencrypted",
			content:    `{"body":"photo","url":"mxc://example.org/plain","info":{"mimetype":"image/png","w":640,"h":480}}`,
			wantURI:    "mxc://example.org/plain",
			wantMIME:   "image/png",
			wantBody:   "photo",
			wantWidth:  640,
			wantHeight: 480,
		},
		{
			name:      "encrypted",
			content:   `{"body":"photo","file":{"url":"mxc://example.org/encrypted","key":{},"iv":"iv","hashes":{},"v":"v2"}}`,
			wantURI:   "mxc://example.org/encrypted",
			encrypted: true,
		},
		{
			name:      "encrypted image without info",
			content:   `{"msgtype":"m.image","body":"photo.png","file":{"url":"mxc://example.org/image-without-info","key":{},"iv":"iv","hashes":{},"v":"v2"}}`,
			wantURI:   "mxc://example.org/image-without-info",
			wantMIME:  "image/unknown",
			encrypted: true,
		},
		{
			name: "Beeper gallery image and video",
			content: `{"msgtype":"com.beeper.gallery","body":"Sent an album with 1 image and 1 video:","com.beeper.gallery.images":[` +
				`{"msgtype":"m.image","body":"photo.jpg","file":{"url":"mxc://example.org/gallery-image","key":{},"iv":"iv","hashes":{},"v":"v2"},"info":{"mimetype":"image/jpeg","w":640,"h":480}},` +
				`{"msgtype":"m.video","body":"clip.mp4","file":{"url":"mxc://example.org/gallery-video","key":{},"iv":"iv","hashes":{},"v":"v2"}}]}`,
			wantURI:    "mxc://example.org/gallery-image",
			wantMIME:   "image/jpeg",
			wantBody:   "Sent an album with 1 image and 1 video:",
			wantWidth:  640,
			wantHeight: 480,
			encrypted:  true,
		},
		{
			name:      "encrypted image without legacy body",
			content:   `{"msgtype":"m.image","file":{"url":"mxc://example.org/bodyless-image","key":{},"iv":"iv","hashes":{},"v":"v2"},"info":{"mimetype":"image/jpeg"}}`,
			wantURI:   "mxc://example.org/bodyless-image",
			wantMIME:  "image/jpeg",
			wantBody:  "Image",
			encrypted: true,
		},
		{
			name:     "extensible text without legacy body",
			content:  `{"m.text":[{"body":"hello from extensible text"}]}`,
			wantBody: "hello from extensible text",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			evt := &database.Event{
				Type:    event.EventMessage.Type,
				Content: json.RawMessage(test.content),
			}
			message, ok := messageFromEvent(evt)
			if !ok {
				t.Fatal("expected a media message")
			}
			if message.MediaURI != test.wantURI {
				t.Errorf("media URI = %q, want %q", message.MediaURI, test.wantURI)
			}
			if (message.MediaEncrypted != nil) != test.encrypted {
				t.Errorf("encrypted metadata present = %t, want %t", message.MediaEncrypted != nil, test.encrypted)
			}
			if message.MediaMIME != test.wantMIME {
				t.Errorf("media MIME = %q, want %q", message.MediaMIME, test.wantMIME)
			}
			if test.wantBody != "" && message.Body != test.wantBody {
				t.Errorf("message body = %q, want %q", message.Body, test.wantBody)
			}
			if message.MediaWidth != test.wantWidth || message.MediaHeight != test.wantHeight {
				t.Errorf("media dimensions = %dx%d, want %dx%d", message.MediaWidth, message.MediaHeight, test.wantWidth, test.wantHeight)
			}
		})
	}
}

func TestMessageFromEventIncludesEditRedactionAndDecryptionStatus(t *testing.T) {
	editedRow := database.EventRowID(2)
	tests := []struct {
		name           string
		event          *database.Event
		wantBody       string
		wantEdited     bool
		wantRedacted   bool
		wantDecryption string
	}{
		{
			name:       "edited",
			event:      &database.Event{ID: "$edited", Type: event.EventMessage.Type, Content: json.RawMessage(`{"body":"updated"}`), LastEditRowID: &editedRow},
			wantBody:   "updated",
			wantEdited: true,
		},
		{
			name:         "redacted",
			event:        &database.Event{ID: "$redacted", Type: event.EventMessage.Type, RedactedBy: "$redaction"},
			wantEdited:   false,
			wantRedacted: true,
		},
		{
			name:           "decryption failure",
			event:          &database.Event{ID: "$encrypted", Type: event.EventEncrypted.Type, DecryptionError: "missing room key"},
			wantDecryption: "missing room key",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			message, ok := messageFromEvent(test.event)
			if !ok {
				t.Fatal("expected event to be represented in the timeline")
			}
			if message.Body != test.wantBody || message.Edited != test.wantEdited ||
				message.Redacted != test.wantRedacted || message.DecryptionError != test.wantDecryption {
				t.Fatalf("unexpected event status: %+v", message)
			}
		})
	}
}

func TestPopulateEditHistoriesReturnsPersistedPreviousVersions(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "profile", "matrix.db")
	client, err := New(databasePath)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	originalID := id.EventID("$original")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		client.Close()
		t.Fatalf("create test room: %v", err)
	}
	original := &database.Event{
		RoomID:       roomID,
		ID:           originalID,
		Sender:       id.UserID("@alice:example.org"),
		Type:         event.EventMessage.Type,
		Timestamp:    jsontime.UM(baseTime),
		Content:      json.RawMessage(`{"msgtype":"m.text","body":"original"}`),
		Unsigned:     json.RawMessage(`{}`),
		LocalContent: &database.LocalContent{EditSource: "original source"},
	}
	if _, err = client.engine.DB.Event.Upsert(ctx, original); err != nil {
		client.Close()
		t.Fatalf("store original message: %v", err)
	}
	edits := []*database.Event{
		{
			RoomID:       roomID,
			ID:           id.EventID("$edit-one"),
			Sender:       original.Sender,
			Type:         event.EventMessage.Type,
			Timestamp:    jsontime.UM(baseTime.Add(time.Second)),
			Content:      json.RawMessage(`{"msgtype":"m.text","body":"first edit","m.new_content":{"msgtype":"m.text","body":"first edit"}}`),
			Unsigned:     json.RawMessage(`{}`),
			LocalContent: &database.LocalContent{EditSource: "first edit source"},
			RelatesTo:    originalID,
			RelationType: event.RelReplace,
		},
		{
			RoomID:       roomID,
			ID:           id.EventID("$edit-two"),
			Sender:       original.Sender,
			Type:         event.EventMessage.Type,
			Timestamp:    jsontime.UM(baseTime.Add(2 * time.Second)),
			Content:      json.RawMessage(`{"msgtype":"m.text","body":"second edit","m.new_content":{"msgtype":"m.text","body":"second edit"}}`),
			Unsigned:     json.RawMessage(`{}`),
			RelatesTo:    originalID,
			RelationType: event.RelReplace,
		},
		{
			RoomID:       roomID,
			ID:           id.EventID("$redacted-edit"),
			Sender:       original.Sender,
			Type:         event.EventMessage.Type,
			Timestamp:    jsontime.UM(baseTime.Add(3 * time.Second)),
			Content:      json.RawMessage(`{"msgtype":"m.text","body":"redacted edit","m.new_content":{"msgtype":"m.text","body":"redacted edit"}}`),
			Unsigned:     json.RawMessage(`{}`),
			RedactedBy:   id.EventID("$redaction"),
			RelatesTo:    originalID,
			RelationType: event.RelReplace,
		},
	}
	for _, edit := range edits {
		if _, err = client.engine.DB.Event.Upsert(ctx, edit); err != nil {
			client.Close()
			t.Fatalf("store replacement event %s: %v", edit.ID, err)
		}
	}
	client.Close()

	client, err = New(databasePath)
	if err != nil {
		t.Fatalf("reopen client: %v", err)
	}
	defer client.Close()
	original, err = client.engine.DB.Event.GetByID(ctx, roomID, originalID)
	if err != nil {
		t.Fatalf("read original message: %v", err)
	}
	messages := []Message{{ID: originalID.String(), Body: "second edit"}}
	if err = client.populateEditHistories(ctx, roomID.String(), []*database.Event{original}, messages); err != nil {
		t.Fatalf("populate edit history: %v", err)
	}
	if !messages[0].Edited {
		t.Fatal("edited message was not recognized from persisted replacement events")
	}
	want := []string{"original source", "first edit source"}
	if len(messages[0].EditHistory) != len(want) {
		t.Fatalf("edit history = %q, want %q", messages[0].EditHistory, want)
	}
	for index := range want {
		if messages[0].EditHistory[index] != want[index] {
			t.Fatalf("edit history = %q, want %q", messages[0].EditHistory, want)
		}
	}
}

func TestMessageFromEventSkipsEditEvent(t *testing.T) {
	message, ok := messageFromEvent(&database.Event{
		ID:           "$edit-event",
		Type:         event.EventMessage.Type,
		RelationType: event.RelReplace,
		Content:      json.RawMessage(`{"body":"corrected text"}`),
	})
	if ok {
		t.Fatalf("edit event should not become a separate message: %+v", message)
	}
}

func TestMessageFromEventIgnoresNonMessages(t *testing.T) {
	tests := []struct {
		name string
		evt  *database.Event
	}{
		{
			name: "state event",
			evt:  &database.Event{Type: event.StateTopic.Type, StateKey: stringPointer("")},
		},
		{
			name: "redacted reaction",
			evt:  &database.Event{Type: event.EventReaction.Type, RedactedBy: "$redaction"},
		},
		{
			name: "message without body",
			evt:  &database.Event{Type: event.EventMessage.Type, Content: json.RawMessage(`{"msgtype":"m.text"}`)},
		},
		{
			name: "invalid content",
			evt:  &database.Event{Type: event.EventMessage.Type, Content: json.RawMessage(`invalid`)},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if message, ok := messageFromEvent(test.evt); ok {
				t.Fatalf("unexpected message: %+v", message)
			}
		})
	}
}

func TestRoomNeedsReplyHonorsUnreadIncomingAndDismissedEvents(t *testing.T) {
	room := Room{LastEventID: "$incoming", LastEventSender: "@alice:example.org"}
	if !roomNeedsReply(room, "@me:example.org", "") {
		t.Fatal("incoming event should need a reply")
	}
	if roomNeedsReply(room, "@me:example.org", "$incoming") {
		t.Fatal("dismissed event should not need a reply")
	}
	room.LastEventID = "$next"
	if !roomNeedsReply(room, "@me:example.org", "$incoming") {
		t.Fatal("a new incoming event should reactivate the room")
	}
	room.LastEventSender = "@me:example.org"
	if roomNeedsReply(room, "@me:example.org", "") {
		t.Fatal("outgoing event with no unread messages should not need a reply")
	}
	room.Unread = 1
	if roomNeedsReply(room, "@me:example.org", "") {
		t.Fatal("replying should clear needs-reply even while the stale unread count remains")
	}
	room.LastEventSender = "@alice:example.org"
	if !roomNeedsReply(room, "@me:example.org", "") {
		t.Fatal("unread messages from someone else should put the room in needs-reply")
	}
	room = Room{ID: "!cached:example.org", Unread: 2}
	if roomNeedsReply(room, "@me:example.org", room.ID) {
		t.Fatal("a dismissed room with no locally known latest event should stay dismissed")
	}
}

func TestPublishCoalescesTimelineChangedRoomIDs(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
	}
	client.publishTimeline([]string{"!first:example.org"}, "")
	client.publishTimeline([]string{"!second:example.org"}, "")

	update := <-client.events
	if len(update.TimelineChangedRoomID) != 2 {
		t.Fatalf("timeline changed rooms = %v, want both coalesced room IDs", update.TimelineChangedRoomID)
	}
	if update.TimelineChangedRoomID[0] != "!first:example.org" ||
		update.TimelineChangedRoomID[1] != "!second:example.org" {
		t.Fatalf("timeline changed rooms = %v, want sorted room IDs", update.TimelineChangedRoomID)
	}
	if len(update.ChangedRoomID) != 0 {
		t.Fatalf("metadata changed rooms = %v, want none", update.ChangedRoomID)
	}
}

func TestApplySyncKeepsPreviewAndTimelineInSync(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!chat:example.org")
	latest := time.Date(2026, time.October, 17, 11, 57, 0, 0, time.UTC)
	stale := latest.Add(-time.Minute)
	client.rooms[roomID.String()] = Room{ID: roomID.String(), Name: "Andrea", Preview: "older", LastSeen: stale}
	syncEvent := &jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Timeline: []database.TimelineRowTuple{{Timeline: 2, Event: 2}},
				Events: []*database.Event{
					{
						RowID:     2,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"se hai bisogno dimmi"}`),
						Timestamp: jsontime.UM(latest),
					},
				},
			},
		},
	}
	client.applySync(syncEvent, true)
	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "se hai bisogno dimmi" || !rooms[0].LastSeen.Equal(latest) {
		t.Fatalf("preview not synced with timeline: %+v", rooms)
	}
	update := <-client.Events()
	if len(update.TimelineChangedRoomID) != 1 || update.TimelineChangedRoomID[0] != roomID.String() {
		t.Fatalf("timeline changed rooms = %v, want open chat refresh", update.TimelineChangedRoomID)
	}
	// Non-timeline events must not move the preview or trigger a refresh.
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Events: []*database.Event{
					{
						RowID:     99,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{\"body\":\"background noise\"}`),
						Timestamp: jsontime.UM(latest.Add(time.Minute)),
					},
				},
			},
		},
	}, true)
	rooms = client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "se hai bisogno dimmi" {
		t.Fatalf("non-timeline event moved preview: %+v", rooms)
	}
	update = <-client.Events()
	if len(update.TimelineChangedRoomID) != 0 {
		t.Fatalf("timeline changed rooms = %v, want no refresh", update.TimelineChangedRoomID)
	}
}

// gomuks picks a room's preview event server-side (room.preview_event_rowid).
// When that event's body arrives in this payload the sidebar must use it:
// re-deriving the preview from the newest in-timeline event can surface the
// bridge placeholder text instead of the message the open chat shows.
func TestApplySyncPrefersAuthoritativePreviewEvent(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!bridge:example.org")
	displayName := "WhatsApp chat"
	topic := "WhatsApp private chat"
	sent := time.Date(2026, time.October, 17, 12, 59, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{
		ID: roomID.String(), Name: displayName, Topic: topic,
		LastSeen: sent.Add(-time.Minute),
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Meta: &database.Room{
					ID:                roomID,
					Name:              &displayName,
					Topic:             &topic,
					PreviewEventRowID: 5,
					SortingTimestamp:  jsontime.UM(sent),
				},
				Timeline: []database.TimelineRowTuple{{Timeline: 1, Event: 9}},
				Events: []*database.Event{
					{
						RowID:     9,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"WhatsApp private chat"}`),
						Timestamp: jsontime.UM(sent),
					},
					{
						RowID:     5,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"i want a yes"}`),
						Timestamp: jsontime.UM(sent),
					},
				},
			},
		},
	}, false)
	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "i want a yes" {
		t.Fatalf("authoritative preview not used: %+v", rooms)
	}
}

func TestApplySyncKeepsPreviewSenderOnMessageEvent(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!chat:example.org")
	latest := time.Date(2026, time.October, 17, 13, 0, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{ID: roomID.String(), Name: "Andrea"}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Meta: &database.Room{ID: roomID, PreviewEventRowID: 5},
				Events: []*database.Event{
					{
						RowID:     5,
						ID:        "$latest-message",
						Type:      event.EventMessage.Type,
						Sender:    id.UserID("@me:example.org"),
						Content:   json.RawMessage(`{"body":"my latest message"}`),
						Timestamp: jsontime.UM(latest),
					},
					{
						RowID:     6,
						Type:      event.StateMember.Type,
						Sender:    id.UserID("@alice:example.org"),
						Timestamp: jsontime.UM(latest.Add(time.Minute)),
					},
				},
			},
		},
	}, false)

	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "my latest message" || rooms[0].LastEventSender != "@me:example.org" {
		t.Fatalf("preview sender = %+v, want own message sender", rooms)
	}
	if !rooms[0].LastEventAt.Equal(latest) || rooms[0].LastEventID != "$latest-message" {
		t.Fatalf("latest event = (%v, %q), want message timestamp %v and event ID %q",
			rooms[0].LastEventAt, rooms[0].LastEventID, latest, "$latest-message")
	}
}

// A freshly sent own message can arrive in `events` before it has a timeline
// row (the timeline insert may land a sync later). It must still seed an
// otherwise-empty preview, otherwise the sidebar falls back to the room topic
// while the open chat already shows the sent text.
func TestApplySyncSeedsEmptyPreviewFromOwnPendingSend(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!bridge:example.org")
	topic := "WhatsApp private chat"
	sent := time.Date(2026, time.October, 17, 12, 59, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{
		ID: roomID.String(), Name: "WhatsApp chat", Topic: topic,
		LastSeen: sent.Add(-time.Minute),
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				// No timeline rows: the send has not been persisted yet.
				Events: []*database.Event{
					{
						RowID:     7,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"i want a yes"}`),
						Timestamp: jsontime.UM(sent),
					},
				},
			},
		},
	}, false)
	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "i want a yes" {
		t.Fatalf("pending own send did not seed preview: %+v", rooms)
	}
	if !rooms[0].LastSeen.Equal(sent) {
		t.Fatalf("last seen = %v, want %v", rooms[0].LastSeen, sent)
	}
}

func TestSyncStatusPublishesConnectionStates(t *testing.T) {
	client := &Client{
		events: make(chan Update, 4),
		done:   make(chan struct{}),
	}
	client.handleBackendEvent(&jsoncmd.SyncStatus{Type: jsoncmd.SyncStatusWaiting})
	if got := (<-client.events).ConnectionState; got != StateSyncing {
		t.Fatalf("waiting state = %q, want %q", got, StateSyncing)
	}
	client.handleBackendEvent(&jsoncmd.SyncStatus{Type: jsoncmd.SyncStatusOK})
	if update := <-client.events; update.ConnectionState != StateConnected || !update.InitialSyncComplete {
		t.Fatalf("connected update = %+v", update)
	}
	client.handleBackendEvent(&jsoncmd.SyncStatus{Type: jsoncmd.SyncStatusFailed})
	if update := <-client.events; update.ConnectionState != StateOffline || update.Error == "" {
		t.Fatalf("offline update = %+v", update)
	}
}

func TestApplySyncUpdatesRoomsAndRemovesLeftRooms(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms: map[string]Room{
			"!left:example.org": {ID: "!left:example.org", Name: "Left room"},
		},
	}
	name := "Project chat"
	topic := "Planning"
	dmUser := id.UserID("@alice:example.org")
	avatar := id.ContentURIString("mxc://example.org/room-avatar").ParseOrIgnore()
	roomID := id.RoomID("!project:example.org")
	room := &database.Room{
		ID:       roomID,
		Name:     &name,
		Topic:    &topic,
		Avatar:   &avatar,
		DMUserID: &dmUser,
		UnreadCounts: database.UnreadCounts{
			UnreadMessages:      5,
			UnreadNotifications: 2,
			UnreadHighlights:    1,
		},
	}
	latest := time.Date(2026, time.October, 14, 17, 5, 0, 0, time.UTC)
	syncEvent := &jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Meta:     room,
				Timeline: []database.TimelineRowTuple{{Timeline: 7, Event: 7}},
				Events: []*database.Event{
					{
						RowID:     7,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"latest"}`),
						Timestamp: jsontime.UM(latest),
					},
				},
			},
		},
		LeftRooms: []id.RoomID{"!left:example.org"},
	}

	client.applySync(syncEvent, true)

	rooms := client.Rooms()
	if len(rooms) != 1 {
		t.Fatalf("room count = %d, want 1", len(rooms))
	}
	got := rooms[0]
	if got.ID != roomID.String() || got.Name != name || got.Topic != topic || got.Avatar != avatar.String() || got.Preview != "latest" {
		t.Fatalf("unexpected room snapshot: %+v", got)
	}
	if !got.Direct || got.Unread != 5 || got.Mentions != 1 {
		t.Fatalf("room direct/unread metadata was not mapped: %+v", got)
	}
	if !got.LastSeen.Equal(latest) {
		t.Fatalf("last seen = %s, want %s", got.LastSeen, latest)
	}
	update := <-client.Events()
	if len(update.ChangedRoomID) != 2 {
		t.Fatalf("changed rooms = %v, want update and removal", update.ChangedRoomID)
	}
}

func TestUnreadMessageCountUsesNotificationFallbackWithoutDoubleCounting(t *testing.T) {
	tests := []struct {
		name   string
		counts database.UnreadCounts
		want   int
	}{
		{
			name:   "notification matches overlap with unread messages",
			counts: database.UnreadCounts{UnreadMessages: 2, UnreadNotifications: 2},
			want:   2,
		},
		{
			name:   "notification count is a fallback",
			counts: database.UnreadCounts{UnreadNotifications: 2},
			want:   2,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := unreadMessageCount(test.counts); got != test.want {
				t.Fatalf("unreadMessageCount() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestApplySyncUsesDirectRoomMemberAvatar(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!dm:example.org")
	userID := id.UserID("@alice:example.org")
	avatar := id.ContentURIString("mxc://example.org/alice-avatar")
	stateKey := userID.String()
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	memberEvent := &database.Event{
		RoomID:    roomID,
		ID:        id.EventID("$alice-member"),
		Sender:    userID,
		Type:      event.StateMember.Type,
		StateKey:  &stateKey,
		Timestamp: jsontime.UM(time.Now()),
		Content:   json.RawMessage(`{"displayname":"Alice","avatar_url":"` + string(avatar) + `"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	rowID, err := client.engine.DB.Event.Insert(ctx, memberEvent)
	if err != nil {
		t.Fatalf("insert member state: %v", err)
	}
	if err = client.engine.DB.CurrentState.Set(ctx, roomID, event.StateMember, userID.String(), rowID, ""); err != nil {
		t.Fatalf("set current member state: %v", err)
	}

	displayName := "Alice"
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {Meta: &database.Room{ID: roomID, Name: &displayName, DMUserID: &userID}},
		},
	}, false)

	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Avatar != string(avatar) {
		t.Fatalf("direct room avatar = %+v, want %q", rooms, avatar)
	}
}

func TestEnrichOwnMessageUsesRoomMemberAvatar(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!chat:example.org")
	userID := id.UserID("@me:example.org")
	avatar := id.ContentURIString("mxc://example.org/me-avatar")
	stateKey := userID.String()
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	memberEvent := &database.Event{
		RoomID:    roomID,
		ID:        id.EventID("$me-member"),
		Sender:    userID,
		Type:      event.StateMember.Type,
		StateKey:  &stateKey,
		Timestamp: jsontime.UM(time.Now()),
		Content:   json.RawMessage(`{"displayname":"Me","avatar_url":"` + string(avatar) + `"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	rowID, err := client.engine.DB.Event.Insert(ctx, memberEvent)
	if err != nil {
		t.Fatalf("insert member state: %v", err)
	}
	if err = client.engine.DB.CurrentState.Set(ctx, roomID, event.StateMember, userID.String(), rowID, ""); err != nil {
		t.Fatalf("set current member state: %v", err)
	}

	message := client.enrichOwnMessage(ctx, roomID.String(), Message{Sender: userID.String(), Own: true})
	if message.Avatar != string(avatar) || message.SenderName != "Me" {
		t.Fatalf("own message profile = %+v, want member avatar and display name", message)
	}
}

func TestApplySyncClassifiesUnmarkedDirectRoomsByMemberCount(t *testing.T) {
	tests := []struct {
		name       string
		joined     int
		invited    int
		wantDirect bool
	}{
		{name: "two joined members", joined: 2, wantDirect: true},
		{name: "joined and invited members", joined: 1, invited: 1, wantDirect: true},
		{name: "three joined members", joined: 3, wantDirect: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			roomID := id.RoomID("!" + strings.ReplaceAll(test.name, " ", "-") + ":example.org")
			joined, invited := test.joined, test.invited
			client := &Client{rooms: make(map[string]Room)}
			client.applySync(&jsoncmd.SyncComplete{
				Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
					roomID: {Meta: &database.Room{
						ID: roomID,
						LazyLoadSummary: &mautrix.LazyLoadSummary{
							JoinedMemberCount:  &joined,
							InvitedMemberCount: &invited,
						},
					}},
				},
			}, false)

			rooms := client.Rooms()
			if len(rooms) != 1 || rooms[0].Direct != test.wantDirect {
				t.Fatalf("direct = %v, want %v; rooms = %+v", len(rooms) == 1 && rooms[0].Direct, test.wantDirect, rooms)
			}
		})
	}
}

func TestNotificationCategoryClassifiesDirectMentionAndGroup(t *testing.T) {
	tests := []struct {
		name      string
		direct    bool
		highlight bool
		want      string
	}{
		{name: "direct room", direct: true, highlight: false, want: NotificationCategoryDirect},
		{name: "direct highlight stays direct", direct: true, highlight: true, want: NotificationCategoryDirect},
		{name: "group mention", direct: false, highlight: true, want: NotificationCategoryMention},
		{name: "group message", direct: false, highlight: false, want: NotificationCategoryGroup},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := notificationCategory(test.direct, test.highlight); got != test.want {
				t.Fatalf("notificationCategory(%v, %v) = %q, want %q", test.direct, test.highlight, got, test.want)
			}
		})
	}
}

func TestMissingMatrixMediaErrorIsRecognized(t *testing.T) {
	if !isMissingMatrixMediaError(fmt.Errorf("download Matrix media: %w", mautrix.MNotFound)) {
		t.Fatal("wrapped M_NOT_FOUND error was not recognized")
	}
	if isMissingMatrixMediaError(fmt.Errorf("media server unavailable")) {
		t.Fatal("non-404 error was treated as missing media")
	}
}

func TestMarkReadRetriesLatestEventWhenTargetIsMissing(t *testing.T) {
	var attempted []string
	marked, err := markReadWithLatestEventFallback("$stale", "$latest", func(eventID string) error {
		attempted = append(attempted, eventID)
		if eventID == "$stale" {
			return fmt.Errorf("failed to mark event as read: %w", mautrix.MNotFound)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("mark read with latest event: %v", err)
	}
	if marked != "$latest" {
		t.Fatalf("marked event = %q, want $latest", marked)
	}
	if len(attempted) != 2 || attempted[0] != "$stale" || attempted[1] != "$latest" {
		t.Fatalf("attempted events = %v, want [$stale $latest]", attempted)
	}
}

func TestMarkReadIgnoresMissingTargetsAfterFallback(t *testing.T) {
	tests := []struct {
		name          string
		eventID       string
		latestEventID string
		wantAttempts  []string
	}{
		{name: "same latest event", eventID: "$missing", latestEventID: "$missing", wantAttempts: []string{"$missing"}},
		{name: "missing fallback event", eventID: "$stale", latestEventID: "$latest", wantAttempts: []string{"$stale", "$latest"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var attempted []string
			_, err := markReadWithLatestEventFallback(test.eventID, test.latestEventID, func(eventID string) error {
				attempted = append(attempted, eventID)
				return fmt.Errorf("failed to mark event as read: %w", mautrix.MNotFound)
			})
			if err != nil {
				t.Fatalf("markReadWithLatestEventFallback() error = %v, want stale event ignored", err)
			}
			if strings.Join(attempted, ",") != strings.Join(test.wantAttempts, ",") {
				t.Fatalf("attempted events = %v, want %v", attempted, test.wantAttempts)
			}
		})
	}
}

func TestMarkReadDoesNotFallbackForOtherErrors(t *testing.T) {
	attempts := 0
	_, err := markReadWithLatestEventFallback("$stale", "$latest", func(string) error {
		attempts++
		return fmt.Errorf("homeserver unavailable")
	})
	if err == nil {
		t.Fatal("expected mark-read error")
	}
	if attempts != 1 {
		t.Fatalf("attempt count = %d, want 1", attempts)
	}
}

func TestLocalMessagesMatchTimelineByEventOrTransactionID(t *testing.T) {
	tests := []struct {
		name      string
		timeline  Message
		candidate Message
	}{
		{
			name:      "event ID",
			timeline:  Message{ID: "$event"},
			candidate: Message{ID: "$event", TransactionID: "txn"},
		},
		{
			name:      "transaction ID",
			timeline:  Message{ID: "$event", TransactionID: "txn"},
			candidate: Message{ID: "~pending", TransactionID: "txn"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !containsMessage([]Message{test.timeline}, test.candidate) {
				t.Fatal("expected timeline message to match cached local message")
			}
		})
	}
}

func TestPublishCoalescesPendingUpdatesWithoutDroppingChangedRooms(t *testing.T) {
	client := &Client{
		events: make(chan Update, eventBufferSize),
		done:   make(chan struct{}),
		rooms:  make(map[string]Room),
		local:  make(map[string]map[string]Message),
	}

	for i := 0; i < eventBufferSize+100; i++ {
		client.publish([]string{fmt.Sprintf("!room-%03d:example.org", i)}, "")
	}

	updates := make([]Update, 0, eventBufferSize)
	for len(client.events) > 0 {
		updates = append(updates, <-client.events)
	}
	if len(updates) >= eventBufferSize {
		t.Fatalf("event queue was not coalesced: retained %d updates", len(updates))
	}
	changed := make(map[string]struct{})
	for _, update := range updates {
		for _, roomID := range update.ChangedRoomID {
			changed[roomID] = struct{}{}
		}
	}
	if len(changed) != eventBufferSize+100 {
		t.Fatalf("coalesced %d changed room IDs, want %d", len(changed), eventBufferSize+100)
	}
}

func TestInitCompletePublishesSyncReadyState(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  make(map[string]Room),
		local:  make(map[string]map[string]Message),
	}

	client.handleBackendEvent(&jsoncmd.InitComplete{})

	select {
	case update := <-client.Events():
		if !update.InitialSyncComplete {
			t.Fatal("initial sync completion was not included in the update")
		}
	case <-time.After(time.Second):
		t.Fatal("expected a sync-ready update")
	}
	if !client.SyncReady() {
		t.Fatal("client should report initial sync ready")
	}
}

func TestNewInitializesAndReopensLocalDatabase(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "profile", "matrix.db")
	client, err := New(databasePath)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	client.Close()

	keyInfo, err := os.Stat(filepath.Join(filepath.Dir(databasePath), "crypto.key"))
	if err != nil {
		t.Fatalf("stat crypto key: %v", err)
	}
	if keyInfo.Mode().Perm() != 0o600 {
		t.Fatalf("crypto key permissions = %04o, want 0600", keyInfo.Mode().Perm())
	}

	client, err = New(databasePath)
	if err != nil {
		t.Fatalf("reopen client: %v", err)
	}
	client.Close()
}

func TestWaitForCacheWaitsUntilRestoreCompletes(t *testing.T) {
	client := &Client{cacheReady: make(chan struct{})}
	started := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		close(started)
		result <- client.WaitForCache(context.Background())
	}()
	<-started
	select {
	case err := <-result:
		t.Fatalf("WaitForCache returned before restore completed: %v", err)
	default:
	}

	close(client.cacheReady)
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("WaitForCache: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("WaitForCache did not return after restore completed")
	}
}

func TestLocalSearchParamsSupportsGlobalFiltersAndPagination(t *testing.T) {
	minTimestamp := time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC)
	maxTimestamp := time.Date(2026, time.October, 17, 23, 59, 59, 999000000, time.UTC)
	request := SearchRequest{
		Query:        "  project update  ",
		RoomID:       "!room:example.org",
		Sender:       "@alice:example.org",
		MinTimestamp: minTimestamp.UnixMilli(),
		MaxTimestamp: maxTimestamp.UnixMilli(),
		Limit:        25,
		NextBatch:    "local_offset:25",
	}

	params, err := localSearchParams(request)
	if err != nil {
		t.Fatalf("build search params: %v", err)
	}
	if params.SearchTerm != "project update" || !params.SortByTime || params.Limit != 25 || params.NextBatch != request.NextBatch {
		t.Fatalf("unexpected search params: %+v", params)
	}
	if len(params.RoomIDs) != 1 || params.RoomIDs[0] != id.RoomID(request.RoomID) {
		t.Fatalf("room filter = %v, want %q", params.RoomIDs, request.RoomID)
	}
	if len(params.Senders) != 1 || params.Senders[0] != id.UserID(request.Sender) {
		t.Fatalf("sender filter = %v, want %q", params.Senders, request.Sender)
	}
	if params.MinTimestamp.UnixMilli() != request.MinTimestamp || params.MaxTimestamp.UnixMilli() != request.MaxTimestamp {
		t.Fatalf("timestamp filters = (%d, %d), want (%d, %d)", params.MinTimestamp.UnixMilli(), params.MaxTimestamp.UnixMilli(), request.MinTimestamp, request.MaxTimestamp)
	}

	globalParams, err := localSearchParams(SearchRequest{Query: "topic"})
	if err != nil {
		t.Fatalf("build global search params: %v", err)
	}
	if len(globalParams.RoomIDs) != 0 || globalParams.Limit != 50 {
		t.Fatalf("global search params = %+v, want no room filter and default limit 50", globalParams)
	}
}

func TestReconnectDelayDoublesAndCaps(t *testing.T) {
	got := []time.Duration{
		LastReconnectDelay(0),
		LastReconnectDelay(1),
		LastReconnectDelay(2),
		LastReconnectDelay(5),
		LastReconnectDelay(6),
		LastReconnectDelay(20),
	}
	want := []time.Duration{time.Second, time.Second, 2 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("reconnect delay[%d] = %s, want %s", i, got[i], want[i])
		}
	}
}

func TestParseMXCRejectsInvalidURIs(t *testing.T) {
	server, mediaID, err := parseMXC("mxc://example.org/media123")
	if err != nil || server != "example.org" || mediaID != "media123" {
		t.Fatalf("parse mxc = (%q, %q, %v)", server, mediaID, err)
	}
	for _, invalid := range []string{"", "https://example.org/x", "mxc://", "mxc://server/", "mxc:///id", "mxc://s/a/b"} {
		if _, _, err = parseMXC(invalid); err == nil {
			t.Fatalf("expected error for %q", invalid)
		}
	}
}

func TestMediaCacheUsageAndClear(t *testing.T) {
	client := &Client{mediaCacheDir: filepath.Join(t.TempDir(), "media")}
	if err := os.MkdirAll(client.MediaCacheDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(client.MediaCacheDir(), "a"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(client.MediaCacheDir(), "b"), []byte("world!"), 0o600); err != nil {
		t.Fatal(err)
	}
	bytes, files, err := client.MediaCacheUsage()
	if err != nil || files != 2 || bytes != 11 {
		t.Fatalf("media usage = (%d, %d, %v)", bytes, files, err)
	}
	if path, err := client.mediaCachePath("mxc://example.org/media123"); err != nil || !strings.HasPrefix(path, client.MediaCacheDir()) {
		t.Fatalf("media cache path = %q, %v", path, err)
	}
	if err := client.ClearMediaCache(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := client.MediaCacheUsage(); err != nil {
		t.Fatal(err)
	}
}

func TestLogoutClearsMediaCache(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "account.db")
	client, err := New(databasePath)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Close()

	cacheDir := filepath.Join(t.TempDir(), "media")
	client.SetMediaCacheDir(cacheDir)
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		t.Fatalf("create media cache: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "decrypted-media"), []byte("private"), 0o600); err != nil {
		t.Fatalf("write media cache: %v", err)
	}

	if err := client.Logout(context.Background()); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		t.Fatalf("read media cache after logout: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("media cache contains %d entries after logout, want none", len(entries))
	}
}

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
