package matrix

import (
	"context"
	"errors"
	"strings"
	"time"

	"maunium.net/go/mautrix/id"
)

// reactionRemovalTTL hides a redacted reaction until sync removes it from the local store.
const reactionRemovalTTL = 2 * time.Minute

// ownReactionIDs finds the current user's reactions with emoji, preferring the local store over a server lookup.
func (c *Client) ownReactionIDs(ctx context.Context, roomID string, eventID id.EventID, emoji string) ([]id.EventID, error) {
	userID := c.engine.Account.UserID
	removed := c.removedReactionIDs()
	reactions, err := c.engine.DB.Event.GetReactions(ctx, id.RoomID(roomID), eventID)
	if err != nil {
		return nil, err
	}
	var ids []id.EventID
	pending := false
	if result := reactions[eventID]; result != nil {
		for _, evt := range result.Events {
			if evt == nil || evt.Sender != userID || evt.SendError != "" || removed[evt.ID] || reactionKey(evt.Content) != emoji {
				continue
			}
			if strings.HasPrefix(string(evt.ID), "~") {
				pending = true
				continue
			}
			ids = append(ids, evt.ID)
		}
	}
	if len(ids) > 0 {
		return ids, nil
	}
	if pending {
		return nil, errors.New("reaction is still sending")
	}
	return findOwnReactionIDs(ctx, c.engine.Client, id.RoomID(roomID), eventID, userID, emoji)
}

// markReactionRemoved records a redacted reaction so it stays hidden until sync catches up.
func (c *Client) markReactionRemoved(reactionID id.EventID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.removedReactions == nil {
		c.removedReactions = make(map[id.EventID]time.Time)
	}
	c.removedReactions[reactionID] = time.Now()
}

// removedReactionIDs returns recently redacted reactions and drops entries older than reactionRemovalTTL.
func (c *Client) removedReactionIDs() map[id.EventID]bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	removed := make(map[id.EventID]bool, len(c.removedReactions))
	for reactionID, at := range c.removedReactions {
		if now.Sub(at) > reactionRemovalTTL {
			delete(c.removedReactions, reactionID)
			continue
		}
		removed[reactionID] = true
	}
	return removed
}
