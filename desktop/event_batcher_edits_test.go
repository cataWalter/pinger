package desktop

import (
	"testing"
	"time"
)

func TestEventBatcherCarriesEditedMessagesInOrderWithinBatchCap(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(time.Hour)
	batcher.maxBatchSize = 2
	batcher.EnqueueMessage(MessageItem{RoomID: "!room:example.org", Message: Message{ID: "$new"}})
	batcher.EnqueueEditedMessage(MessageItem{RoomID: "!room:example.org", Message: Message{ID: "$first", Body: "edited"}})
	batcher.EnqueueEditedMessage(MessageItem{RoomID: "!room:example.org", Message: Message{ID: "$second", Body: "later"}})

	batcher.Flush()
	first := <-emissions
	if len(first.payload.NewMessages) != 1 || len(first.payload.EditedMessages) != 1 {
		t.Fatalf("first batch = new %d, edited %d; want 1 and 1", len(first.payload.NewMessages), len(first.payload.EditedMessages))
	}
	if first.payload.EditedMessages[0].Message.Body != "edited" {
		t.Fatalf("first edited body = %q, want %q", first.payload.EditedMessages[0].Message.Body, "edited")
	}

	batcher.Flush()
	second := <-emissions
	if len(second.payload.EditedMessages) != 1 || second.payload.EditedMessages[0].Message.ID != "$second" {
		t.Fatalf("remaining edited messages = %+v, want $second", second.payload.EditedMessages)
	}
}

func TestEventBatcherCarriesRedactionsAndReactionDeltas(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(time.Hour)
	batcher.EnqueueRedaction(RedactionItem{RoomID: "!room:example.org", EventID: "$gone", RedactedBy: "$mod"})
	batcher.EnqueueReactionDelta(ReactionDeltaItem{
		RoomID:    "!room:example.org",
		EventID:   "$msg",
		Reactions: map[string]int{"🔥": 2},
		Reacted:   map[string]bool{"🔥": true},
	})

	batcher.Flush()
	emitted := <-emissions
	if len(emitted.payload.RedactedEventIDs) != 1 || emitted.payload.RedactedEventIDs[0].EventID != "$gone" {
		t.Fatalf("redacted_event_ids = %+v, want $gone", emitted.payload.RedactedEventIDs)
	}
	if len(emitted.payload.ReactionDeltas) != 1 || emitted.payload.ReactionDeltas[0].Reactions["🔥"] != 2 {
		t.Fatalf("reaction_deltas = %+v, want 🔥=2", emitted.payload.ReactionDeltas)
	}
}
