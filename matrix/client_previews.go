package matrix

import (
	"context"
	"errors"
	"go.mau.fi/gomuks/pkg/hicli"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/id"
)

// previewPageFunc matches HiClient.PaginateServer. Tests substitute a fake.
type previewPageFunc func(ctx context.Context, roomID id.RoomID, limit int, reset bool) (*jsoncmd.PaginationResponse, error)

// startPreviewBackfill fills missing sidebar previews once the cache is loaded.
// It runs at most once per client, in the background.
func (c *Client) startPreviewBackfill() {
	if c.engine == nil {
		return
	}
	c.previewBackfillOnce.Do(func() {
		ctx, finish, err := c.beginOperation(context.Background())
		if err != nil {
			return
		}
		go func() {
			defer finish()
			if err := c.WaitForCache(ctx); err != nil {
				return
			}
			c.fillMissingPreviews(ctx, true)
		}()
	})
}

// fillMissingPreviews sets the sidebar preview of rooms that have none, most
// recent room first. The newest message already stored locally is used first.
// When allowNetwork is true, the remaining rooms read older server history.
// Only empty previews are filled. LastSeen never changes, so sidebar order
// stays as it is.
func (c *Client) fillMissingPreviews(ctx context.Context, allowNetwork bool) {
	if c.engine == nil {
		return
	}
	var candidates []string
	for _, room := range c.Rooms() {
		if room.Preview == "" {
			candidates = append(candidates, room.ID)
		}
	}
	changed := make([]string, 0, previewPublishBatch)
	for _, roomID := range candidates {
		if ctx.Err() != nil {
			return
		}
		message, ok, err := c.storedRoomPreview(ctx, id.RoomID(roomID))
		if err == nil && !ok && allowNetwork {
			message, ok, err = c.previewFromHistory(ctx, id.RoomID(roomID), c.engine.PaginateServer)
		}
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("load preview for %s: %v", roomID, err)
			}
			continue
		}
		if ok && c.applyRoomPreview(roomID, message) {
			changed = append(changed, roomID)
		}
		if len(changed) == previewPublishBatch {
			c.publish(changed, "")
			changed = make([]string, 0, previewPublishBatch)
		}
	}
	if len(changed) > 0 {
		c.publish(changed, "")
	}
}

// storedRoomPreview returns the newest preview-eligible message already stored
// locally for the room. RecalculatePreview only reads, so the room is unchanged.
func (c *Client) storedRoomPreview(ctx context.Context, roomID id.RoomID) (Message, bool, error) {
	rowID, err := c.engine.DB.Room.RecalculatePreview(ctx, roomID)
	if err != nil || rowID == 0 {
		return Message{}, false, err
	}
	evt, err := c.engine.DB.Event.GetByRowID(ctx, rowID)
	if err != nil || evt == nil {
		return Message{}, false, err
	}
	message, ok := messageFromEvent(evt)
	return message, ok && message.Body != "", nil
}

// previewFromHistory reads older server history for the room, one page at a
// time, until a message is stored locally. A room without a pagination token,
// or whose history is complete, makes no request.
func (c *Client) previewFromHistory(ctx context.Context, roomID id.RoomID, page previewPageFunc) (Message, bool, error) {
	room, err := c.engine.DB.Room.Get(ctx, roomID)
	if err != nil {
		return Message{}, false, err
	}
	if !hasServerHistory(room) {
		return Message{}, false, nil
	}
	for range previewHistoryMaxPages {
		resp, err := page(ctx, roomID, previewHistoryPageSize, false)
		if errors.Is(err, hicli.ErrPaginationAlreadyInProgress) {
			// The user is already paging this room, which loads its messages too.
			return Message{}, false, nil
		}
		if err != nil {
			return Message{}, false, err
		}
		message, ok, err := c.storedRoomPreview(ctx, roomID)
		if err != nil || ok {
			return message, ok, err
		}
		if resp == nil || !resp.HasMore {
			break
		}
	}
	return Message{}, false, nil
}

// applyRoomPreview sets the preview of a room that has none. It also sets the
// room's last event and its sender when the message is not older than it, so
// history never moves a room backwards. LastSeen is left unchanged.
func (c *Client) applyRoomPreview(roomID string, message Message) bool {
	if message.Body == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	room, ok := c.rooms[roomID]
	if !ok || room.Preview != "" {
		return false
	}
	room.Preview = message.Body
	if !message.Timestamp.Before(room.LastEventAt) {
		room.LastEventAt = message.Timestamp
		room.LastEventID = message.ID
		room.LastEventSender = message.Sender
	}
	setRoomNeedsReply(&room, c.currentUserID(), c.dismissedEvents[roomID])
	c.rooms[roomID] = room
	return true
}
