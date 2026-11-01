package matrix

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// threadMessageLimit keeps very long threads to their most recent replies.
const threadMessageLimit = 500

var errThreadRoot = errors.New("a thread can only start from a sent message")

func threadRootID(evt *database.Event) string {
	if evt == nil || evt.RelationType != event.RelThread {
		return ""
	}
	root := evt.RelatesTo.String()
	if !strings.HasPrefix(root, "$") {
		return ""
	}
	return root
}

// ThreadMessages returns a thread's root and replies, oldest first.
func (c *Client) ThreadMessages(ctx context.Context, roomID, rootID string) ([]Message, error) {
	if !strings.HasPrefix(rootID, "$") {
		return nil, errThreadRoot
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	room, root := id.RoomID(roomID), id.EventID(rootID)
	rootEvent, err := c.engine.DB.Event.GetByID(ctx, room, root)
	if err != nil {
		return nil, fmt.Errorf("read thread root: %w", err)
	}
	replies, err := c.engine.DB.Event.GetRelatedEvents(ctx, room, root, event.RelThread, "")
	if err != nil {
		return nil, fmt.Errorf("read thread replies: %w", err)
	}
	if len(replies) > threadMessageLimit {
		replies = replies[len(replies)-threadMessageLimit:]
	}
	events := make([]*database.Event, 0, len(replies)+1)
	if rootEvent != nil {
		events = append(events, rootEvent)
	}
	events = append(events, replies...)
	messages := make([]Message, 0, len(events))
	for _, evt := range events {
		if message, ok := messageFromEvent(evt); ok {
			messages = append(messages, message)
		}
	}
	if err := c.populateEditHistories(ctx, roomID, events, messages); err != nil {
		log.Printf("read Matrix thread edit history for room %s: %v", roomID, err)
	}
	if err := c.populateOwnReactions(ctx, roomID, messages); err != nil {
		log.Printf("read Matrix thread reactions for room %s: %v", roomID, err)
	}
	c.mu.RLock()
	for _, message := range c.local[roomID] {
		if message.ThreadRootID == rootID && !containsMessage(messages, message) && !shadowedByServerRow(messages, message) {
			messages = append(messages, message)
		}
	}
	c.mu.RUnlock()
	c.rememberMediaEncryption(messages)
	c.populateMessageProfiles(ctx, roomID, messages)
	c.enrichReplyPreviews(ctx, roomID, messages)
	for i := range messages {
		messages[i].Own = c.isOwnMessage(messages[i])
	}
	sort.SliceStable(messages, func(i, j int) bool {
		if messages[i].Timestamp.Equal(messages[j].Timestamp) {
			return messages[i].ID < messages[j].ID
		}
		return messages[i].Timestamp.Before(messages[j].Timestamp)
	})
	return messages, nil
}

// SendThreadReply posts text in a thread. Clients without threads see it as a reply to the latest thread message.
func (c *Client) SendThreadReply(ctx context.Context, roomID, text, rootID string) error {
	if !strings.HasPrefix(rootID, "$") {
		return errThreadRoot
	}
	if strings.TrimSpace(text) == "" {
		return nil
	}
	fallback, err := c.latestThreadEvent(ctx, roomID, rootID)
	if err != nil {
		return err
	}
	return c.sendMessage(ctx, roomID, text, (&event.RelatesTo{}).SetThread(id.EventID(rootID), fallback), nil)
}

func (c *Client) latestThreadEvent(ctx context.Context, roomID, rootID string) (id.EventID, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return "", err
	}
	defer finish()
	replies, err := c.engine.DB.Event.GetRelatedEvents(ctx, id.RoomID(roomID), id.EventID(rootID), event.RelThread, "")
	if err != nil {
		return "", fmt.Errorf("read thread replies: %w", err)
	}
	for i := len(replies) - 1; i >= 0; i-- {
		if strings.HasPrefix(replies[i].ID.String(), "$") {
			return replies[i].ID, nil
		}
	}
	return id.EventID(rootID), nil
}
