package desktop

import (
	"context"
	"sync"
	"time"
)

const (
	batchUpdateEventName           = "matrix:batch_update"
	defaultEventBatchFlushInterval = 50 * time.Millisecond
	defaultEventBatchMaximumSize   = 100
)

type MessageItem struct {
	RoomID  string  `json:"roomId"`
	Message Message `json:"message"`
}

type ReadReceiptItem struct {
	RoomID    string `json:"roomId"`
	EventID   string `json:"eventId"`
	UserID    string `json:"userId"`
	Timestamp int64  `json:"timestamp"`
}

type TypingItem struct {
	RoomID  string   `json:"roomId"`
	UserIDs []string `json:"userIds"`
}

type RoomDeltaItem struct {
	Update Update `json:"update"`
}

type BatchedPayload struct {
	NewMessages     []MessageItem     `json:"new_messages"`
	ReadReceipts    []ReadReceiptItem `json:"read_receipts"`
	TypingUpdates   []TypingItem      `json:"typing_updates"`
	RoomStateDeltas []RoomDeltaItem   `json:"room_deltas"`
}

type BatchedEvent = BatchedPayload

type EventBatcher struct {
	wailsCtx      context.Context
	flushInterval time.Duration
	maxBatchSize  int

	mu             sync.Mutex
	flushMu        sync.Mutex
	buffer         BatchedPayload
	receiptIndexes map[string]int
	pendingEvents  int
	emit           func(string, BatchedPayload)
	flushRequests  chan struct{}
	startOnce      sync.Once
}

func NewEventBatcher(wailsCtx context.Context, flushInterval time.Duration) *EventBatcher {
	if wailsCtx == nil {
		wailsCtx = context.Background()
	}
	if flushInterval <= 0 {
		flushInterval = defaultEventBatchFlushInterval
	}

	return &EventBatcher{
		wailsCtx:      wailsCtx,
		flushInterval: flushInterval,
		maxBatchSize:  defaultEventBatchMaximumSize,
		buffer: BatchedPayload{
			NewMessages:     make([]MessageItem, 0, defaultEventBatchMaximumSize),
			ReadReceipts:    make([]ReadReceiptItem, 0, defaultEventBatchMaximumSize),
			TypingUpdates:   make([]TypingItem, 0, defaultEventBatchMaximumSize),
			RoomStateDeltas: make([]RoomDeltaItem, 0, defaultEventBatchMaximumSize),
		},
		receiptIndexes: make(map[string]int, defaultEventBatchMaximumSize),
		flushRequests:  make(chan struct{}, 1),
	}
}

func (b *EventBatcher) SetEmitter(emit func(string, BatchedPayload)) {
	b.mu.Lock()
	b.emit = emit
	b.mu.Unlock()
}

func (b *EventBatcher) Start(ctx context.Context) {
	if ctx == nil {
		ctx = b.wailsCtx
	}
	b.startOnce.Do(func() {
		go b.run(ctx)
	})
}

func (b *EventBatcher) EnqueueMessage(message MessageItem) {
	b.mu.Lock()
	b.buffer.NewMessages = append(b.buffer.NewMessages, message)
	flush := b.recordEventLocked()
	b.mu.Unlock()
	if flush {
		b.requestFlush()
	}
}

func (b *EventBatcher) EnqueueReceipt(receipt ReadReceiptItem) {
	b.mu.Lock()
	if index, exists := b.receiptIndexes[receipt.RoomID]; exists {
		b.buffer.ReadReceipts[index] = receipt
		b.mu.Unlock()
		return
	}
	b.receiptIndexes[receipt.RoomID] = len(b.buffer.ReadReceipts)
	b.buffer.ReadReceipts = append(b.buffer.ReadReceipts, receipt)
	flush := b.recordEventLocked()
	b.mu.Unlock()
	if flush {
		b.requestFlush()
	}
}

func (b *EventBatcher) EnqueueTyping(typing TypingItem) {
	b.mu.Lock()
	b.buffer.TypingUpdates = append(b.buffer.TypingUpdates, typing)
	flush := b.recordEventLocked()
	b.mu.Unlock()
	if flush {
		b.requestFlush()
	}
}

func (b *EventBatcher) EnqueueRoomDelta(delta RoomDeltaItem) {
	b.mu.Lock()
	b.buffer.RoomStateDeltas = append(b.buffer.RoomStateDeltas, delta)
	flush := b.recordEventLocked()
	b.mu.Unlock()
	if flush {
		b.requestFlush()
	}
}

func (b *EventBatcher) EnqueueUpdate(update Update) {
	b.EnqueueRoomDelta(RoomDeltaItem{Update: update})
}

func (b *EventBatcher) recordEventLocked() bool {
	b.pendingEvents++
	return b.pendingEvents >= b.maxBatchSize
}

func (b *EventBatcher) requestFlush() {
	select {
	case b.flushRequests <- struct{}{}:
	default:
	}
}

func (b *EventBatcher) run(ctx context.Context) {
	ticker := time.NewTicker(b.flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.Flush()
		case <-b.flushRequests:
			b.Flush()
		}
	}
}

func (b *EventBatcher) Flush() {
	b.flushMu.Lock()
	defer b.flushMu.Unlock()

	b.mu.Lock()
	if b.pendingEvents == 0 || b.emit == nil || b.wailsCtx.Err() != nil {
		b.mu.Unlock()
		return
	}

	remaining := b.maxBatchSize
	messageCount := min(len(b.buffer.NewMessages), remaining)
	remaining -= messageCount
	receiptCount := min(len(b.buffer.ReadReceipts), remaining)
	remaining -= receiptCount
	typingCount := min(len(b.buffer.TypingUpdates), remaining)
	remaining -= typingCount
	roomDeltaCount := min(len(b.buffer.RoomStateDeltas), remaining)
	batchSize := messageCount + receiptCount + typingCount + roomDeltaCount
	if batchSize == 0 {
		b.mu.Unlock()
		return
	}

	// Wails queues event data asynchronously, so emitted slices must not alias the reusable accumulator.
	payload := BatchedPayload{
		NewMessages:     cloneBatchPrefix(b.buffer.NewMessages, messageCount),
		ReadReceipts:    cloneBatchPrefix(b.buffer.ReadReceipts, receiptCount),
		TypingUpdates:   cloneBatchPrefix(b.buffer.TypingUpdates, typingCount),
		RoomStateDeltas: cloneBatchPrefix(b.buffer.RoomStateDeltas, roomDeltaCount),
	}
	b.buffer.NewMessages = drainBatchPrefix(b.buffer.NewMessages, messageCount)
	b.buffer.ReadReceipts = drainBatchPrefix(b.buffer.ReadReceipts, receiptCount)
	b.buffer.TypingUpdates = drainBatchPrefix(b.buffer.TypingUpdates, typingCount)
	b.buffer.RoomStateDeltas = drainBatchPrefix(b.buffer.RoomStateDeltas, roomDeltaCount)
	b.pendingEvents -= batchSize
	clear(b.receiptIndexes)
	for index, receipt := range b.buffer.ReadReceipts {
		b.receiptIndexes[receipt.RoomID] = index
	}
	emit := b.emit
	flushAgain := b.pendingEvents >= b.maxBatchSize
	b.mu.Unlock()

	emit(batchUpdateEventName, payload)
	if flushAgain {
		b.requestFlush()
	}
}

func cloneBatchPrefix[T any](items []T, count int) []T {
	if count == 0 {
		return nil
	}
	cloned := make([]T, count)
	copy(cloned, items[:count])
	return cloned
}

func drainBatchPrefix[T any](items []T, count int) []T {
	remaining := len(items) - count
	copy(items, items[count:])
	clear(items[remaining:])
	return items[:remaining]
}
