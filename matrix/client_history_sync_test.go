package matrix

import (
	"context"
	"encoding/json"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"path/filepath"
	"testing"
	"time"
)

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

func TestOwnMessageForRoomRecognizesBridgedDirectChatSenders(t *testing.T) {
	bridgePeerID := id.UserID("@contact:whatsapp")
	bridgeRoom := &database.Room{DMUserID: &bridgePeerID}
	matrixPeerID := id.UserID("@contact:example.org")
	matrixRoom := &database.Room{DMUserID: &matrixPeerID}

	tests := []struct {
		name    string
		message Message
		userID  string
		room    *database.Room
		want    bool
	}{
		{name: "account sender", message: Message{Sender: "@me:example.org"}, userID: "@me:example.org", want: true},
		{name: "bridged own puppet", message: Message{Sender: "@self:whatsapp"}, userID: "@me:example.org", room: bridgeRoom, want: true},
		{name: "bridged peer", message: Message{Sender: bridgePeerID.String()}, userID: "@me:example.org", room: bridgeRoom, want: false},
		{name: "ordinary direct peer", message: Message{Sender: "@other:example.org"}, userID: "@me:example.org", room: matrixRoom, want: false},
		{name: "missing sender", message: Message{}, userID: "@me:example.org", room: bridgeRoom, want: false},
		{name: "existing own flag", message: Message{Sender: "@self:whatsapp", Own: true}, room: matrixRoom, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isOwnMessageForRoom(test.message, test.userID, test.room); got != test.want {
				t.Fatalf("isOwnMessageForRoom() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestHistoryPageMarksBridgedPuppetMessagesAsOwn(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!bridged-history:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	peerID := id.UserID("@contact:whatsapp")
	if err = client.engine.DB.Room.Update(ctx, &database.Room{ID: roomID, DMUserID: &peerID}); err != nil {
		t.Fatalf("store bridged direct-chat peer: %v", err)
	}
	client.engine.Account = &database.Account{UserID: id.UserID("@me:example.org")}

	base := time.Date(2026, time.September, 2, 9, 0, 0, 0, time.UTC)
	messages := []struct {
		id     id.EventID
		sender id.UserID
		own    bool
	}{
		{id: "$own-puppet", sender: "@self:whatsapp", own: true},
		{id: "$bridge-peer", sender: peerID, own: false},
	}
	rowIDs := make([]database.EventRowID, 0, len(messages))
	for index, message := range messages {
		rowID, insertErr := client.engine.DB.Event.Insert(ctx, &database.Event{
			RoomID:    roomID,
			ID:        message.id,
			Sender:    message.sender,
			Type:      event.EventMessage.Type,
			Timestamp: jsontime.UM(base.Add(time.Duration(index) * time.Minute)),
			Content:   json.RawMessage(`{"msgtype":"m.text","body":"history message"}`),
			Unsigned:  json.RawMessage(`{}`),
		})
		if insertErr != nil {
			t.Fatalf("insert message %s: %v", message.id, insertErr)
		}
		rowIDs = append(rowIDs, rowID)
	}
	if _, err = client.engine.DB.Timeline.Append(ctx, roomID, rowIDs); err != nil {
		t.Fatalf("append room timeline: %v", err)
	}

	page, err := client.HistoryPageWithLimit(ctx, roomID.String(), 0, len(messages))
	if err != nil {
		t.Fatalf("load history page: %v", err)
	}
	if len(page.Messages) != len(messages) {
		t.Fatalf("loaded %d messages, want %d", len(page.Messages), len(messages))
	}
	for index, want := range messages {
		if got := page.Messages[index]; got.ID != string(want.id) || got.Own != want.own {
			t.Errorf("message %q own=%t, want own=%t", got.ID, got.Own, want.own)
		}
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
