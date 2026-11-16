package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"path/filepath"
	"testing"
	"time"
)

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
	messages := []Message{{ID: originalID.String(), Body: "original"}}
	if err = client.populateEditHistories(ctx, roomID.String(), []*database.Event{original}, messages); err != nil {
		t.Fatalf("populate edit history: %v", err)
	}
	if !messages[0].Edited {
		t.Fatal("edited message was not recognized from persisted replacement events")
	}
	if messages[0].Body != "second edit" {
		t.Fatalf("body = %q, want latest non-redacted edit %q", messages[0].Body, "second edit")
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

func TestSetRoomNeedsReplySplitsUnansweredFromAnsweredMark(t *testing.T) {
	room := Room{ID: "!dm:example.org", LastEventID: "$incoming", LastEventSender: "@alice:example.org"}
	setRoomNeedsReply(&room, "@me:example.org", "$incoming")
	if !room.Unanswered || room.NeedsReply {
		t.Fatalf("answered room = %+v, want unanswered without needs reply", room)
	}
	room.LastEventID = "$next"
	setRoomNeedsReply(&room, "@me:example.org", "$incoming")
	if !room.Unanswered || !room.NeedsReply {
		t.Fatalf("room with a new incoming event = %+v, want needs reply again", room)
	}
	room.LastEventSender = "@me:example.org"
	setRoomNeedsReply(&room, "@me:example.org", "")
	if room.Unanswered || room.NeedsReply {
		t.Fatalf("room with my last message = %+v, want neither list", room)
	}
}
