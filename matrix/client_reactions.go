package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix/id"
	"strings"
)

// populateOwnReactions sets reaction counts and the current user's reactions from stored reaction events.
func (c *Client) populateOwnReactions(ctx context.Context, roomID string, messages []Message) error {
	eventIDs := make([]id.EventID, 0, len(messages))
	for _, message := range messages {
		if message.ID != "" && !strings.HasPrefix(message.ID, "~") {
			eventIDs = append(eventIDs, id.EventID(message.ID))
		}
	}
	if len(eventIDs) == 0 {
		return nil
	}
	reactions, err := c.engine.DB.Event.GetReactions(ctx, id.RoomID(roomID), eventIDs...)
	if err != nil {
		return err
	}
	var userID id.UserID
	if c.engine.Account != nil {
		userID = c.engine.Account.UserID
	}
	applyOwnReactions(messages, reactions, userID, c.removedReactionIDs())
	return nil
}

// applyOwnReactions rebuilds reaction counts and the user's own reactions, skipping failed sends and removed reactions.
func applyOwnReactions(messages []Message, reactions map[id.EventID]*database.GetReactionsResult, userID id.UserID, removed map[id.EventID]bool) {
	for index := range messages {
		result := reactions[id.EventID(messages[index].ID)]
		if result == nil {
			continue
		}
		counts := make(map[string]int)
		own := make(map[string]bool)
		for _, evt := range result.Events {
			if evt == nil || evt.SendError != "" || removed[evt.ID] {
				continue
			}
			key := reactionKey(evt.Content)
			if key == "" {
				continue
			}
			counts[key]++
			if evt.Sender == userID {
				own[key] = true
			}
		}
		messages[index].Reactions = counts
		messages[index].Reacted = own
	}
}

// reactionKey returns the emoji annotated by a reaction event's content.
func reactionKey(content json.RawMessage) string {
	var parsed struct {
		RelatesTo struct {
			Key string `json:"key"`
		} `json:"m.relates_to"`
	}
	if json.Unmarshal(content, &parsed) != nil {
		return ""
	}
	return parsed.RelatesTo.Key
}
