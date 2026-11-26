package matrix

import (
	"context"
	"encoding/json"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type syncRedaction struct {
	targetID   id.EventID
	redactorID id.EventID
}

func redactionTargetID(evt *database.Event) id.EventID {
	if evt == nil || evt.GetType().Type != event.EventRedaction.Type {
		return ""
	}
	var content struct {
		Redacts id.EventID `json:"redacts"`
	}
	if err := json.Unmarshal(evt.GetContent(), &content); err != nil {
		return ""
	}
	return content.Redacts
}

// timelineCanSkipReload reports whether every timeline row in the sync is an edit, reaction, or resolvable redaction.
func timelineCanSkipReload(syncRoom *jsoncmd.SyncRoom) bool {
	if len(syncRoom.Timeline) == 0 {
		return false
	}
	deltaRows := make(map[database.EventRowID]struct{})
	for _, evt := range syncRoom.Events {
		if evt == nil {
			continue
		}
		if (evt.RelationType == event.RelReplace || evt.RelationType == event.RelAnnotation) && evt.RelatesTo != "" {
			deltaRows[evt.RowID] = struct{}{}
		} else if redactionTargetID(evt) != "" {
			deltaRows[evt.RowID] = struct{}{}
		}
	}
	for _, row := range syncRoom.Timeline {
		if _, ok := deltaRows[row.Event]; !ok {
			return false
		}
	}
	return true
}

func dedupeEventIDs(ids []id.EventID) []id.EventID {
	if len(ids) <= 1 {
		return ids
	}
	seen := make(map[id.EventID]struct{}, len(ids))
	out := make([]id.EventID, 0, len(ids))
	for _, eventID := range ids {
		if eventID == "" {
			continue
		}
		if _, exists := seen[eventID]; exists {
			continue
		}
		seen[eventID] = struct{}{}
		out = append(out, eventID)
	}
	return out
}

// editedMessageItems rebuilds each edited original from the database; unresolved rooms are returned for a full reload.
func (c *Client) editedMessageItems(targetsByRoom map[string][]id.EventID) ([]MessageItem, []string) {
	if c.engine == nil || c.engine.DB == nil {
		reloadRooms := make([]string, 0, len(targetsByRoom))
		for roomKey := range targetsByRoom {
			reloadRooms = append(reloadRooms, roomKey)
		}
		return nil, reloadRooms
	}
	items := make([]MessageItem, 0)
	var reloadRooms []string
	for roomKey, targets := range targetsByRoom {
		reload := false
		for _, target := range dedupeEventIDs(targets) {
			message, ok := c.editedMessage(context.Background(), roomKey, target)
			if !ok {
				reload = true
				continue
			}
			items = append(items, MessageItem{RoomID: roomKey, Message: message})
		}
		if reload {
			reloadRooms = append(reloadRooms, roomKey)
		}
	}
	return items, reloadRooms
}

func (c *Client) editedMessage(ctx context.Context, roomKey string, target id.EventID) (Message, bool) {
	original, err := c.engine.DB.Event.GetByID(ctx, id.RoomID(roomKey), target)
	if err != nil || original == nil || original.RedactedBy != "" {
		return Message{}, false
	}
	message, ok := messageFromEvent(original)
	if !ok {
		return Message{}, false
	}
	messages := []Message{message}
	if err = c.populateEditHistories(ctx, roomKey, []*database.Event{original}, messages); err != nil {
		return Message{}, false
	}
	return messages[0], true
}

// reactionDeltaItems rebuilds reaction counts and own-reaction state from the database; unresolved rooms fall back to reload.
func (c *Client) reactionDeltaItems(targetsByRoom map[string][]id.EventID) ([]ReactionDeltaItem, []string) {
	if c.engine == nil || c.engine.DB == nil {
		reloadRooms := make([]string, 0, len(targetsByRoom))
		for roomKey := range targetsByRoom {
			reloadRooms = append(reloadRooms, roomKey)
		}
		return nil, reloadRooms
	}
	items := make([]ReactionDeltaItem, 0)
	var reloadRooms []string
	ctx := context.Background()
	for roomKey, targets := range targetsByRoom {
		unique := dedupeEventIDs(targets)
		messages := make([]Message, 0, len(unique))
		for _, target := range unique {
			messages = append(messages, Message{ID: target.String()})
		}
		if err := c.populateOwnReactions(ctx, roomKey, messages); err != nil {
			reloadRooms = append(reloadRooms, roomKey)
			continue
		}
		for _, msg := range messages {
			reactions := msg.Reactions
			if reactions == nil {
				reactions = map[string]int{}
			}
			reacted := msg.Reacted
			if reacted == nil {
				reacted = map[string]bool{}
			}
			items = append(items, ReactionDeltaItem{
				RoomID:    roomKey,
				EventID:   msg.ID,
				Reactions: reactions,
				Reacted:   reacted,
			})
		}
	}
	return items, reloadRooms
}

func (c *Client) resolveSyncRedactions(ctx context.Context, roomKey string, eventsByID map[id.EventID]*database.Event, redactions []syncRedaction) ([]RedactionItem, []id.EventID, []id.EventID, bool) {
	var items []RedactionItem
	var editTargets []id.EventID
	var reactionTargets []id.EventID
	reload := false
	for _, r := range redactions {
		targetEvt := eventsByID[r.targetID]
		if targetEvt == nil && c.engine != nil && c.engine.DB != nil {
			loaded, err := c.engine.DB.Event.GetByID(ctx, id.RoomID(roomKey), r.targetID)
			if err == nil {
				targetEvt = loaded
			}
		}
		if targetEvt == nil {
			reload = true
			continue
		}
		if targetEvt.RelationType == event.RelReplace && targetEvt.RelatesTo != "" {
			editTargets = append(editTargets, targetEvt.RelatesTo)
		} else if targetEvt.RelationType == event.RelAnnotation && targetEvt.RelatesTo != "" {
			reactionTargets = append(reactionTargets, targetEvt.RelatesTo)
		} else {
			items = append(items, RedactionItem{
				RoomID:     roomKey,
				EventID:    r.targetID.String(),
				RedactedBy: r.redactorID.String(),
			})
		}
	}
	return items, editTargets, reactionTargets, reload
}
