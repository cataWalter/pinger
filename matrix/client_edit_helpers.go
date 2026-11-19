package matrix

import (
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"sort"
	"strings"
)

// isEditedEvent reports whether the event was actually edited. gomuks
// initializes LastEditRowID to a non-nil zero pointer on fresh sends, so a
// nil check alone flags brand-new messages as edited.
func isEditedEvent(evt *database.Event) bool {
	if evt == nil || evt.LastEditRowID == nil {
		return false
	}
	return *evt.LastEditRowID != 0
}

func editHistory(evt *database.Event) []string {
	if !isEditedEvent(evt) || evt.RedactedBy != "" {
		return nil
	}
	if source := editVersionSource(evt, false); source != "" {
		return []string{source}
	}
	return nil
}

func latestEdit(edits []*database.Event) *database.Event {
	var latest *database.Event
	for _, edit := range edits {
		if latest == nil || edit.Timestamp.Time.After(latest.Timestamp.Time) ||
			(edit.Timestamp.Time.Equal(latest.Timestamp.Time) && edit.RowID > latest.RowID) {
			latest = edit
		}
	}
	return latest
}

// applyEditedBody shows the replacement text, because gomuks only swaps in m.new_content when LastEditRef is set.
// Decrypted E2EE messages also carry Encrypted, so only skip them when the original or the edit failed to decrypt.
func applyEditedBody(message *Message, original, edit *database.Event) {
	if message.Redacted || message.DecryptionError != "" || edit.DecryptionError != "" ||
		(edit.MegolmSessionID != "" && edit.Decrypted == nil) {
		return
	}
	withEdit := *original
	withEdit.LastEditRef = edit
	edited, ok := messageFromEvent(&withEdit)
	if !ok {
		return
	}
	message.Body = edited.Body
	message.FormattedBody = edited.FormattedBody
}

func editHistoryWithEvents(evt *database.Event, edits []*database.Event) []string {
	if evt == nil || evt.RedactedBy != "" || len(edits) == 0 {
		return nil
	}
	versions := make([]string, 0, len(edits)+1)
	if source := editVersionSource(evt, false); source != "" {
		versions = append(versions, source)
	}
	orderedEdits := append([]*database.Event(nil), edits...)
	sort.SliceStable(orderedEdits, func(i, j int) bool {
		if orderedEdits[i].Timestamp.Time.Equal(orderedEdits[j].Timestamp.Time) {
			return orderedEdits[i].RowID < orderedEdits[j].RowID
		}
		return orderedEdits[i].Timestamp.Time.Before(orderedEdits[j].Timestamp.Time)
	})
	for _, edit := range orderedEdits {
		if source := editVersionSource(edit, true); source != "" {
			versions = append(versions, source)
		}
	}
	if len(orderedEdits) > 0 && editVersionSource(orderedEdits[len(orderedEdits)-1], true) != "" {
		versions = versions[:len(versions)-1]
	}
	return versions
}

func editVersionSource(evt *database.Event, replacement bool) string {
	if evt == nil {
		return ""
	}
	if evt.LocalContent != nil && strings.TrimSpace(evt.LocalContent.EditSource) != "" {
		return evt.LocalContent.EditSource
	}
	content := evt.Decrypted
	if content == nil {
		content = evt.Content
	}
	if replacement {
		var editContent struct {
			NewContent json.RawMessage `json:"m.new_content"`
		}
		if err := json.Unmarshal(content, &editContent); err != nil || len(editContent.NewContent) == 0 {
			return ""
		}
		content = editContent.NewContent
	}
	var messageContent struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(content, &messageContent); err != nil {
		return ""
	}
	return messageContent.Body
}
