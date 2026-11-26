package matrix

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// applyEditSync stores an original message and an edit to it, then applies a sync containing only the edit.
func applyEditSync(t *testing.T, reset bool) Update {
	t.Helper()
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	client.events = make(chan Update, 1)

	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	originalID := id.EventID("$original")
	sender := id.UserID("@alice:example.org")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create test room: %v", err)
	}
	if _, err = client.engine.DB.Event.Upsert(ctx, &database.Event{
		RoomID:    roomID,
		ID:        originalID,
		Sender:    sender,
		Type:      event.EventMessage.Type,
		Timestamp: jsontime.UM(baseTime),
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"original"}`),
		Unsigned:  json.RawMessage(`{}`),
	}); err != nil {
		t.Fatalf("store original message: %v", err)
	}
	edit := &database.Event{
		RoomID:       roomID,
		ID:           id.EventID("$edit"),
		Sender:       sender,
		Type:         event.EventMessage.Type,
		Timestamp:    jsontime.UM(baseTime.Add(time.Second)),
		Content:      json.RawMessage(`{"msgtype":"m.text","body":"edited","m.new_content":{"msgtype":"m.text","body":"edited"}}`),
		Unsigned:     json.RawMessage(`{}`),
		RelatesTo:    originalID,
		RelationType: event.RelReplace,
	}
	editRowID, err := client.engine.DB.Event.Upsert(ctx, edit)
	if err != nil {
		t.Fatalf("store edit: %v", err)
	}
	edit.RowID = editRowID

	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Reset:    reset,
				Timeline: []database.TimelineRowTuple{{Timeline: 1, Event: editRowID}},
				Events:   []*database.Event{edit},
			},
		},
	}, true)
	return <-client.events
}

func TestApplySyncEditDeltaUpdatesOriginalWithoutTimelineReload(t *testing.T) {
	update := applyEditSync(t, false)
	if len(update.TimelineChangedRoomID) != 0 {
		t.Fatalf("edit-only sync requested a timeline reload for %v", update.TimelineChangedRoomID)
	}
	if len(update.EditedMessages) != 1 {
		t.Fatalf("edited messages = %+v, want one edit delta", update.EditedMessages)
	}
	got := update.EditedMessages[0]
	if got.RoomID != "!room:example.org" || got.Message.ID != "$original" || got.Message.Body != "edited" || !got.Message.Edited {
		t.Fatalf("unexpected edit delta: %+v", got)
	}
}

func TestApplySyncResetStillReloadsTimelineInsteadOfEditDelta(t *testing.T) {
	update := applyEditSync(t, true)
	if len(update.EditedMessages) != 0 {
		t.Fatalf("reset sync emitted edit deltas: %+v", update.EditedMessages)
	}
	if len(update.TimelineChangedRoomID) != 1 {
		t.Fatalf("reset sync did not request a timeline reload: %v", update.TimelineChangedRoomID)
	}
}

func TestApplySyncReactionAndRedactionDeltasAvoidTimelineReload(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	client.events = make(chan Update, 4)

	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	originalID := id.EventID("$original")
	sender := id.UserID("@alice:example.org")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create test room: %v", err)
	}
	original := &database.Event{
		RoomID:    roomID,
		ID:        originalID,
		Sender:    sender,
		Type:      event.EventMessage.Type,
		Timestamp: jsontime.UM(baseTime),
		Content:   json.RawMessage(`{"msgtype":"m.text","body":"original"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	origRowID, err := client.engine.DB.Event.Upsert(ctx, original)
	if err != nil {
		t.Fatalf("store original: %v", err)
	}
	original.RowID = origRowID

	reaction := &database.Event{
		RoomID:       roomID,
		ID:           id.EventID("$react-1"),
		Sender:       sender,
		Type:         event.EventReaction.Type,
		Timestamp:    jsontime.UM(baseTime.Add(time.Second)),
		Content:      json.RawMessage(`{"m.relates_to":{"rel_type":"m.annotation","event_id":"$original","key":"👍"}}`),
		Unsigned:     json.RawMessage(`{}`),
		RelatesTo:    originalID,
		RelationType: event.RelAnnotation,
	}
	reactRowID, err := client.engine.DB.Event.Upsert(ctx, reaction)
	if err != nil {
		t.Fatalf("store reaction: %v", err)
	}
	reaction.RowID = reactRowID

	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Timeline: []database.TimelineRowTuple{{Timeline: 1, Event: reactRowID}},
				Events:   []*database.Event{reaction, original},
			},
		},
	}, true)
	reactionUpdate := <-client.events
	if len(reactionUpdate.TimelineChangedRoomID) != 0 {
		t.Fatalf("reaction-only sync requested reload: %v", reactionUpdate.TimelineChangedRoomID)
	}
	if len(reactionUpdate.ReactionDeltas) != 1 || reactionUpdate.ReactionDeltas[0].Reactions["👍"] != 1 {
		t.Fatalf("reaction deltas = %+v, want 👍=1", reactionUpdate.ReactionDeltas)
	}

	// Redacting the reaction should emit an updated empty reaction delta rather than a message redaction.
	reaction.RedactedBy = id.EventID("$redact-react")
	if _, err = client.engine.DB.Event.Upsert(ctx, reaction); err != nil {
		t.Fatalf("update redacted reaction: %v", err)
	}
	redactReact := &database.Event{
		RowID:     90,
		RoomID:    roomID,
		ID:        id.EventID("$redact-react"),
		Sender:    sender,
		Type:      event.EventRedaction.Type,
		Timestamp: jsontime.UM(baseTime.Add(2 * time.Second)),
		Content:   json.RawMessage(`{"redacts":"$react-1"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Timeline: []database.TimelineRowTuple{{Timeline: 2, Event: 90}},
				Events:   []*database.Event{redactReact, reaction, original},
			},
		},
	}, true)
	unreactUpdate := <-client.events
	if len(unreactUpdate.TimelineChangedRoomID) != 0 || len(unreactUpdate.RedactedEventIDs) != 0 {
		t.Fatalf("reaction redaction unexpected reload=%v redactions=%v", unreactUpdate.TimelineChangedRoomID, unreactUpdate.RedactedEventIDs)
	}
	if len(unreactUpdate.ReactionDeltas) != 1 || len(unreactUpdate.ReactionDeltas[0].Reactions) != 0 {
		t.Fatalf("expected cleared reaction delta, got %+v", unreactUpdate.ReactionDeltas)
	}

	// Redacting the original message should emit a RedactionItem without reloading.
	original.RedactedBy = id.EventID("$redact-orig")
	redactOrig := &database.Event{
		RowID:     91,
		RoomID:    roomID,
		ID:        id.EventID("$redact-orig"),
		Sender:    sender,
		Type:      event.EventRedaction.Type,
		Timestamp: jsontime.UM(baseTime.Add(3 * time.Second)),
		Content:   json.RawMessage(`{"redacts":"$original"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Timeline: []database.TimelineRowTuple{{Timeline: 3, Event: 91}},
				Events:   []*database.Event{redactOrig, original},
			},
		},
	}, true)
	redactUpdate := <-client.events
	if len(redactUpdate.TimelineChangedRoomID) != 0 {
		t.Fatalf("redaction sync requested reload: %v", redactUpdate.TimelineChangedRoomID)
	}
	if len(redactUpdate.RedactedEventIDs) != 1 || redactUpdate.RedactedEventIDs[0].EventID != "$original" {
		t.Fatalf("redacted_event_ids = %+v, want $original", redactUpdate.RedactedEventIDs)
	}
}
