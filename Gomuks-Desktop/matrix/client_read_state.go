package matrix

import (
	"context"
	"errors"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"strings"
)

func (c *Client) MarkRead(ctx context.Context, roomID, eventID string) error {
	if eventID == "" {
		return nil
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	eventID = c.readReceiptTargetEventID(ctx, roomID, eventID)
	c.mu.RLock()
	markedUnread := c.rooms[roomID].MarkedUnread
	c.mu.RUnlock()
	if err = c.engine.MarkRead(ctx, id.RoomID(roomID), id.EventID(eventID), event.ReceiptTypeRead); err != nil && !isMissingMatrixReadTargetError(err) {
		return fmt.Errorf("mark Matrix room as read: %w", err)
	}
	if markedUnread {
		if err = c.engine.Client.SetRoomAccountData(ctx, id.RoomID(roomID), event.AccountDataMarkedUnread.Type, &event.MarkedUnreadEventContent{Unread: false}); err != nil {
			return fmt.Errorf("clear Matrix room's marked-unread state: %w", err)
		}
	}
	c.mu.Lock()
	room, ok := c.rooms[roomID]
	if ok {
		room.Unread = 0
		room.MarkedUnread = false
		room.Mentions = 0
		c.rooms[roomID] = room
	}
	c.mu.Unlock()
	if ok {
		c.publish(nil, "")
	}
	return nil
}

// readReceiptTargetEventID returns the event a read receipt should point at.
// The engine counts unread timeline rows that sit after the own receipt's row,
// while the caller's event ID comes from lastEventID, which only tracks message
// events. If the newest timeline row is not a message (for example an
// undecrypted event that still counts as unread), a receipt on the last message
// leaves that row unread and the badge never clears. Use the newest
// server-confirmed timeline row instead.
func (c *Client) readReceiptTargetEventID(ctx context.Context, roomID, fallback string) string {
	if c.engine == nil || c.engine.DB == nil {
		return fallback
	}
	events, err := c.engine.DB.Timeline.Get(ctx, id.RoomID(roomID), 20, 0)
	if err != nil {
		return fallback
	}
	return newestReadTargetEventID(events, fallback)
}

// newestReadTargetEventID picks the first server-confirmed event from a
// newest-first timeline slice. Local echoes do not have a server event ID yet,
// so they are skipped.
func newestReadTargetEventID(newestFirst []*database.Event, fallback string) string {
	for _, evt := range newestFirst {
		if evt == nil {
			continue
		}
		if eventID := evt.ID.String(); strings.HasPrefix(eventID, "$") {
			return eventID
		}
	}
	return fallback
}

func (c *Client) MarkUnread(ctx context.Context, roomID string) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if err = c.engine.Client.SetRoomAccountData(ctx, id.RoomID(roomID), event.AccountDataMarkedUnread.Type, &event.MarkedUnreadEventContent{Unread: true}); err != nil {
		return fmt.Errorf("mark Matrix room as unread: %w", err)
	}
	c.mu.Lock()
	room, ok := c.rooms[roomID]
	if ok {
		room.MarkedUnread = true
		c.rooms[roomID] = room
	}
	c.mu.Unlock()
	if ok {
		c.publish(nil, "")
	}
	return nil
}

func isMissingMatrixReadTargetError(err error) bool {
	return errors.Is(err, mautrix.MNotFound)
}

func unreadMessageCount(counts database.UnreadCounts) int {
	return max(counts.UnreadMessages, counts.UnreadNotifications)
}

func (c *Client) unreadReactionCounts(ctx context.Context, roomID id.RoomID, userID id.UserID) (counts database.UnreadCounts, err error) {
	err = c.engine.DB.Timeline.GetDB().QueryRow(ctx, unreadReactionCountsQuery, roomID, userID).
		Scan(&counts.UnreadHighlights, &counts.UnreadNotifications, &counts.UnreadMessages)
	return
}

func unreadCountsWithoutReactions(counts, reactions database.UnreadCounts) database.UnreadCounts {
	return database.UnreadCounts{
		UnreadHighlights:    max(0, counts.UnreadHighlights-reactions.UnreadHighlights),
		UnreadNotifications: max(0, counts.UnreadNotifications-reactions.UnreadNotifications),
		UnreadMessages:      max(0, counts.UnreadMessages-reactions.UnreadMessages),
	}
}
