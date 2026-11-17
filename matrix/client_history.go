package matrix

import (
	"context"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/id"
	"sort"
)

func (c *Client) Messages(ctx context.Context, roomID string) ([]Message, error) {
	page, err := c.HistoryPage(ctx, roomID, 0)
	if err != nil {
		return nil, err
	}
	return page.Messages, nil
}

func timelineMessagePrefix(events []*database.Event, limit int, messages []Message) (int, []Message) {
	messageCount := 0
	for index, evt := range events {
		message, ok := messageFromEvent(evt)
		if !ok {
			continue
		}
		messages = append(messages, message)
		messageCount++
		if messageCount == limit {
			return index + 1, messages
		}
	}
	return len(events), messages
}

func isTimelineEvent(timeline []database.TimelineRowTuple, rowID database.EventRowID) bool {
	for _, tuple := range timeline {
		if tuple.Event == rowID {
			return true
		}
	}
	return false
}

func hasServerHistory(room *database.Room) bool {
	return room != nil && room.PrevBatch != "" && room.PrevBatch != database.PrevBatchPaginationComplete
}

func (c *Client) HistoryPage(ctx context.Context, roomID string, before int64) (HistoryPage, error) {
	return c.HistoryPageWithLimit(ctx, roomID, before, defaultInitialHistoryLimit)
}

func (c *Client) HistoryPageWithLimit(ctx context.Context, roomID string, before int64, initialLimit int) (HistoryPage, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return HistoryPage{}, err
	}
	defer finish()
	page := HistoryPage{}
	var events []*database.Event
	var initialMessages []Message
	if before == 0 {
		if initialLimit < 1 {
			initialLimit = defaultInitialHistoryLimit
		}
		initialMessages = make([]Message, 0, initialLimit)
		cursor := database.TimelineRowID(0)
		remaining := initialLimit
		for {
			batch, getErr := c.engine.DB.Timeline.Get(ctx, id.RoomID(roomID), timelinePageSize, cursor)
			if getErr != nil {
				return HistoryPage{}, fmt.Errorf("read room timeline: %w", getErr)
			}
			if len(batch) == 0 {
				break
			}

			messageCountBefore := len(initialMessages)
			var prefixLength int
			prefixLength, initialMessages = timelineMessagePrefix(batch, remaining, initialMessages)
			messageCount := len(initialMessages) - messageCountBefore
			events = append(events, batch[:prefixLength]...)
			if messageCount == remaining {
				page.Before = int64(batch[prefixLength-1].TimelineRowID)
				page.HasMore = prefixLength < len(batch) || len(batch) == timelinePageSize
				break
			}

			page.Before = int64(batch[len(batch)-1].TimelineRowID)
			remaining -= messageCount
			if len(batch) < timelinePageSize {
				break
			}
			cursor = database.TimelineRowID(page.Before)
		}
	} else {
		var getErr error
		events, getErr = c.engine.DB.Timeline.Get(ctx, id.RoomID(roomID), timelinePageSize, database.TimelineRowID(before))
		if getErr != nil {
			return HistoryPage{}, fmt.Errorf("read room timeline: %w", getErr)
		}
		page.HasMore = len(events) == timelinePageSize
		if len(events) > 0 {
			page.Before = int64(events[len(events)-1].TimelineRowID)
		}
	}
	room, getErr := c.engine.DB.Room.Get(ctx, id.RoomID(roomID))
	if getErr != nil {
		return HistoryPage{}, fmt.Errorf("read room history pagination state: %w", getErr)
	}
	if before != 0 && len(events) == 0 && hasServerHistory(room) {
		pagination, paginateErr := c.engine.Paginate(ctx, id.RoomID(roomID), database.TimelineRowID(before), timelinePageSize, false)
		if paginateErr != nil {
			return HistoryPage{}, fmt.Errorf("paginate older room history: %w", paginateErr)
		}
		events = pagination.Events
		page.HasMore = pagination.HasMore
		if len(events) > 0 {
			page.Before = int64(events[len(events)-1].TimelineRowID)
		}
	} else {
		page.HasMore = page.HasMore || hasServerHistory(room)
	}
	messages := initialMessages
	parsedTimelineEvents := 0
	skippedEventTypes := make(map[string]int)
	if before == 0 {
		for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
			messages[left], messages[right] = messages[right], messages[left]
		}
		parsedTimelineEvents = len(initialMessages)
	} else {
		messages = make([]Message, 0, len(events))
		for i := len(events) - 1; i >= 0; i-- {
			if message, ok := messageFromEvent(events[i]); ok {
				messages = append(messages, message)
				parsedTimelineEvents++
			} else if events[i] != nil {
				skippedEventTypes[events[i].GetType().Type]++
			}
		}
	}
	if before == 0 {
		events, messages = c.addEditTargets(ctx, id.RoomID(roomID), events, messages)
	}
	if err := c.populateEditHistories(ctx, roomID, events, messages); err != nil {
		log.Printf("read Matrix edit history for room %s: %v", roomID, err)
	}
	if err := c.populateOwnReactions(ctx, roomID, messages); err != nil {
		log.Printf("read Matrix own reactions for room %s: %v", roomID, err)
	}
	if parsedTimelineEvents == 0 {
		for _, evt := range events {
			if evt != nil {
				skippedEventTypes[evt.GetType().Type]++
			}
		}
		log.Printf("Matrix history page has no parsed timeline messages: rows=%d skipped_event_types=%v", len(events), skippedEventTypes)
	}
	if before == 0 {
		c.mu.Lock()
		localMessages := c.local[roomID]
		for key, message := range localMessages {
			if containsMessage(messages, message) || shadowedByServerRow(messages, message) {
				delete(localMessages, key)
				continue
			}
			messages = append(messages, message)
		}
		if len(localMessages) == 0 {
			delete(c.local, roomID)
		}
		c.mu.Unlock()
	}
	c.rememberMediaEncryption(messages)
	c.populateMessageProfiles(ctx, roomID, messages)
	c.enrichReplyPreviews(ctx, roomID, messages)
	for i := range messages {
		messages[i].Own = isOwnMessageForRoom(messages[i], c.currentUserID(), room)
	}
	sort.SliceStable(messages, func(i, j int) bool {
		if messages[i].Timestamp.Equal(messages[j].Timestamp) {
			return messages[i].ID < messages[j].ID
		}
		return messages[i].Timestamp.Before(messages[j].Timestamp)
	})
	c.enrichSeenMessage(ctx, roomID, messages)
	page.Messages = messages
	return page, nil
}
