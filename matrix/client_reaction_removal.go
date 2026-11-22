package matrix

import (
	"context"
	"errors"
	"strings"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
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
	var pending bool
	if result := reactions[eventID]; result != nil {
		ids, pending = selectOwnReactionIDs(result.Events, userID, emoji, removed)
	}
	if len(ids) > 0 {
		return ids, nil
	}
	if pending {
		return nil, errors.New("reaction is still sending")
	}
	return findOwnReactionIDs(ctx, c.engine.Client, id.RoomID(roomID), eventID, userID, emoji)
}

// selectOwnReactionIDs returns the user's confirmed reactions with emoji and whether any are still sending.
// Successful sends keep the transient "not sent" marker, so only real send errors are excluded.
func selectOwnReactionIDs(events []*database.Event, userID id.UserID, emoji string, removed map[id.EventID]bool) (ids []id.EventID, pending bool) {
	for _, evt := range events {
		if evt == nil || evt.Sender != userID || mapSendError(evt.SendError) != "" || removed[evt.ID] || reactionKey(evt.Content) != emoji {
			continue
		}
		if strings.HasPrefix(string(evt.ID), "~") {
			pending = true
			continue
		}
		ids = append(ids, evt.ID)
	}
	return ids, pending
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
