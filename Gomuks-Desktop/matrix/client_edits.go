package matrix

import (
	"context"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"sort"
)

func (c *Client) populateEditHistories(ctx context.Context, roomID string, events []*database.Event, messages []Message) error {
	originals := make(map[id.EventID]*database.Event)
	eventIDs := make([]id.EventID, 0, len(events))
	messageIndexes := make(map[id.EventID]int, len(messages))
	for index := range messages {
		messageIndexes[id.EventID(messages[index].ID)] = index
	}
	for _, evt := range events {
		if evt == nil || evt.ID == "" || evt.RedactedBy != "" {
			continue
		}
		if _, ok := messageIndexes[evt.ID]; !ok {
			continue
		}
		originals[evt.ID] = evt
		eventIDs = append(eventIDs, evt.ID)
	}
	if len(eventIDs) == 0 {
		return nil
	}
	sort.Slice(eventIDs, func(i, j int) bool { return eventIDs[i] < eventIDs[j] })

	editRowsByOriginal, err := c.engine.DB.Event.GetEditRowIDs(ctx, id.RoomID(roomID), eventIDs...)
	if err != nil {
		return err
	}
	editRowIDs := make([]database.EventRowID, 0)
	for _, eventID := range eventIDs {
		editRowIDs = append(editRowIDs, editRowsByOriginal[eventID]...)
	}
	if len(editRowIDs) == 0 {
		return nil
	}
	editEvents, err := c.engine.DB.Event.GetByRowIDs(ctx, editRowIDs...)
	if err != nil {
		return err
	}
	editsByOriginal := make(map[id.EventID][]*database.Event)
	for _, edit := range editEvents {
		if edit == nil || edit.RelationType != event.RelReplace || edit.RedactedBy != "" {
			continue
		}
		editsByOriginal[edit.RelatesTo] = append(editsByOriginal[edit.RelatesTo], edit)
	}
	for eventID, original := range originals {
		if index, ok := messageIndexes[eventID]; ok {
			edits := editsByOriginal[eventID]
			messages[index].Edited = len(edits) > 0
			messages[index].EditHistory = editHistoryWithEvents(original, edits)
			if latest := latestEdit(edits); latest != nil {
				applyEditedBody(&messages[index], original, latest)
			}
		}
	}
	return nil
}
