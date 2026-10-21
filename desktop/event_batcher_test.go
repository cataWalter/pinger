package desktop

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type recordedBatch struct {
	eventName string
	payload   BatchedPayload
}

func newRecordingEventBatcher(interval time.Duration) (*EventBatcher, chan recordedBatch) {
	batcher := NewEventBatcher(context.Background(), interval)
	emissions := make(chan recordedBatch, 256)
	batcher.SetEmitter(func(eventName string, payload BatchedPayload) {
		emissions <- recordedBatch{eventName: eventName, payload: payload}
	})
	return batcher, emissions
}

func TestEventBatcherIdleFlushDoesNotEmitOrAllocate(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(time.Second)
	if allocations := testing.AllocsPerRun(100, batcher.Flush); allocations != 0 {
		t.Fatalf("idle Flush allocations = %v, want 0", allocations)
	}
	select {
	case event := <-emissions:
		t.Fatalf("idle batcher emitted %+v", event)
	default:
	}
}

func TestEventBatcherTickerDoesNotEmitEmptyPayloads(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(5 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batcher.Start(ctx)

	timer := time.NewTimer(30 * time.Millisecond)
	defer timer.Stop()
	select {
	case event := <-emissions:
		t.Fatalf("idle ticker emitted %+v", event)
	case <-timer.C:
	}
}

func TestEventBatcherDeduplicatesReceiptsAndPreservesRoomUpdates(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(time.Hour)
	batcher.EnqueueReceipt(ReadReceiptItem{RoomID: "!room:example.org", EventID: "$old"})
	batcher.EnqueueReceipt(ReadReceiptItem{RoomID: "!room:example.org", EventID: "$new"})
	batcher.EnqueueUpdate(Update{
		Rooms:                 []Room{{ID: "!room:example.org", Name: "General"}},
		TimelineChangedRoomID: []string{"!room:example.org"},
		Notifications:         []Notification{{RoomID: "!room:example.org", Body: "hello"}},
		Error:                 "temporary sync error",
	})

	batcher.Flush()
	event := <-emissions
	if event.eventName != batchUpdateEventName {
		t.Fatalf("event name = %q, want %q", event.eventName, batchUpdateEventName)
	}
	if len(event.payload.ReadReceipts) != 1 || event.payload.ReadReceipts[0].EventID != "$new" {
		t.Fatalf("receipts = %+v, want the latest receipt for the room", event.payload.ReadReceipts)
	}
	if len(event.payload.RoomStateDeltas) != 1 {
		t.Fatalf("room deltas = %+v, want one update", event.payload.RoomStateDeltas)
	}
	update := event.payload.RoomStateDeltas[0].Update
	if len(update.Rooms) != 1 || update.Rooms[0].Name != "General" || update.Error != "temporary sync error" {
		t.Fatalf("room update was not preserved: %+v", update)
	}
	if len(update.Notifications) != 1 || len(update.TimelineChangedRoomID) != 1 {
		t.Fatalf("update metadata was not preserved: %+v", update)
	}
	roomsDeltaEvent := <-emissions
	if roomsDeltaEvent.eventName != roomsDeltaEventName {
		t.Fatalf("room delta event name = %q, want %q", roomsDeltaEvent.eventName, roomsDeltaEventName)
	}
	if len(roomsDeltaEvent.payload.RoomStateDeltas) != 1 || roomsDeltaEvent.payload.RoomStateDeltas[0].Update.Rooms[0].Name != "General" {
		t.Fatalf("typed room delta payload = %+v", roomsDeltaEvent.payload)
	}
	if len(roomsDeltaEvent.payload.NewMessages) != 0 || len(roomsDeltaEvent.payload.ReadReceipts) != 0 || len(roomsDeltaEvent.payload.TypingUpdates) != 0 {
		t.Fatalf("room delta event included unrelated batch data: %+v", roomsDeltaEvent.payload)
	}
	if cap(batcher.buffer.NewMessages) != defaultEventBatchMaximumSize {
		t.Fatalf("reusable message buffer capacity = %d, want %d", cap(batcher.buffer.NewMessages), defaultEventBatchMaximumSize)
	}
}

func TestEventBatcherFlushesImmediatelyAtMaximumSize(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(time.Hour)
	batcher.maxBatchSize = 2
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batcher.Start(ctx)

	batcher.EnqueueMessage(MessageItem{RoomID: "!one:example.org", Message: Message{ID: "$one"}})
	batcher.EnqueueMessage(MessageItem{RoomID: "!two:example.org", Message: Message{ID: "$two"}})

	select {
	case event := <-emissions:
		if len(event.payload.NewMessages) != 2 {
			t.Fatalf("batch size = %d, want 2", len(event.payload.NewMessages))
		}
	case <-time.After(time.Second):
		t.Fatal("maximum-size batch did not flush before the ticker")
	}
}

func TestEventBatcherCapsEmittedBatchSize(t *testing.T) {
	batcher, emissions := newRecordingEventBatcher(time.Hour)
	batcher.maxBatchSize = 3
	for index := 0; index < 5; index++ {
		batcher.EnqueueMessage(MessageItem{RoomID: "!room:example.org", Message: Message{ID: fmt.Sprintf("$%d", index)}})
	}

	batcher.Flush()
	first := <-emissions
	if len(first.payload.NewMessages) != 3 {
		t.Fatalf("first batch size = %d, want maximum of 3", len(first.payload.NewMessages))
	}
	batcher.Flush()
	second := <-emissions
	if len(second.payload.NewMessages) != 2 {
		t.Fatalf("remaining batch size = %d, want 2", len(second.payload.NewMessages))
	}
}

func TestEventBatcherConcurrentEnqueueIsRaceSafe(t *testing.T) {
	batcher, _ := newRecordingEventBatcher(time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var emitted atomic.Int64
	batcher.SetEmitter(func(_ string, payload BatchedPayload) {
		emitted.Add(int64(len(payload.NewMessages)))
	})
	batcher.Start(ctx)

	const workers = 8
	const eventsPerWorker = 250
	var workersDone sync.WaitGroup
	workersDone.Add(workers)
	for worker := 0; worker < workers; worker++ {
		go func(worker int) {
			defer workersDone.Done()
			for index := 0; index < eventsPerWorker; index++ {
				batcher.EnqueueMessage(MessageItem{
					RoomID:  "!room:example.org",
					Message: Message{ID: fmt.Sprintf("$%d-%d", worker, index)},
				})
			}
		}(worker)
	}
	workersDone.Wait()
	batcher.Flush()

	if got, want := emitted.Load(), int64(workers*eventsPerWorker); got != want {
		t.Fatalf("emitted messages = %d, want %d", got, want)
	}
}
