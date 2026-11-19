package matrix

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestPopulateEditHistoriesUsesDecryptedLocalEdit(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "profile", "matrix.db")
	client, err := New(databasePath)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	originalID := id.EventID("$original:beeper.local")
	sender := id.UserID("@alice:example.org")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	ciphertext := json.RawMessage(`{"algorithm":"m.megolm.v1.aes-sha2","ciphertext":"AAAA","device_id":"D","sender_key":"K","session_id":"S"}`)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create test room: %v", err)
	}
	original := &database.Event{
		RoomID:        roomID,
		ID:            originalID,
		Sender:        sender,
		Type:          event.EventEncrypted.Type,
		DecryptedType: event.EventMessage.Type,
		Timestamp:     jsontime.UM(baseTime),
		Content:       ciphertext,
		Decrypted:     json.RawMessage(`{"msgtype":"m.text","body":"original body"}`),
		Unsigned:      json.RawMessage(`{}`),
		TransactionID: "hicli-test_original",
		SendError:     "not sent",
	}
	if _, err = client.engine.DB.Event.Upsert(ctx, original); err != nil {
		t.Fatalf("store original message: %v", err)
	}
	edit := &database.Event{
		RoomID:        roomID,
		ID:            id.EventID("$edit:beeper.local"),
		Sender:        sender,
		Type:          event.EventEncrypted.Type,
		DecryptedType: event.EventMessage.Type,
		Timestamp:     jsontime.UM(baseTime.Add(time.Second)),
		Content:       ciphertext,
		Decrypted:     json.RawMessage(`{"msgtype":"m.text","body":"","m.new_content":{"msgtype":"m.text","body":"edited body"},"m.relates_to":{"rel_type":"m.replace","event_id":"$original:beeper.local"}}`),
		Unsigned:      json.RawMessage(`{}`),
		TransactionID: "hicli-test_edit",
		SendError:     "not sent",
		RelatesTo:     originalID,
		RelationType:  event.RelReplace,
	}
	if _, err = client.engine.DB.Event.Upsert(ctx, edit); err != nil {
		t.Fatalf("store edit: %v", err)
	}
	stored, err := client.engine.DB.Event.GetByID(ctx, roomID, originalID)
	if err != nil {
		t.Fatalf("read original message: %v", err)
	}
	messages := []Message{{ID: originalID.String(), Body: "original body"}}
	if err = client.populateEditHistories(ctx, roomID.String(), []*database.Event{stored}, messages); err != nil {
		t.Fatalf("populate edit history: %v", err)
	}
	if messages[0].Body != "edited body" {
		t.Fatalf("body = %q, want %q (edited=%v)", messages[0].Body, "edited body", messages[0].Edited)
	}
}

func TestHistoryPageShowsDecryptedLocalEdit(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	sender := id.UserID("@alice:example.org")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	ciphertext := json.RawMessage(`{"algorithm":"m.megolm.v1.aes-sha2","ciphertext":"AAAA","device_id":"D","sender_key":"K","session_id":"S"}`)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create test room: %v", err)
	}
	client.engine.Account = &database.Account{UserID: sender}
	originalRowID, err := client.engine.DB.Event.Insert(ctx, &database.Event{
		RoomID:        roomID,
		ID:            "$original:beeper.local",
		Sender:        sender,
		Type:          event.EventEncrypted.Type,
		DecryptedType: event.EventMessage.Type,
		Timestamp:     jsontime.UM(baseTime),
		Content:       ciphertext,
		Decrypted:     json.RawMessage(`{"msgtype":"m.text","body":"original body"}`),
		Unsigned:      json.RawMessage(`{}`),
		TransactionID: "hicli-test_original",
		SendError:     "not sent",
	})
	if err != nil {
		t.Fatalf("insert original: %v", err)
	}
	editRowID, err := client.engine.DB.Event.Insert(ctx, &database.Event{
		RoomID:        roomID,
		ID:            "$edit:beeper.local",
		Sender:        sender,
		Type:          event.EventEncrypted.Type,
		DecryptedType: event.EventMessage.Type,
		Timestamp:     jsontime.UM(baseTime.Add(time.Second)),
		Content:       ciphertext,
		Decrypted:     json.RawMessage(`{"msgtype":"m.text","body":"","m.new_content":{"msgtype":"m.text","body":"edited body"},"m.relates_to":{"rel_type":"m.replace","event_id":"$original:beeper.local"}}`),
		Unsigned:      json.RawMessage(`{}`),
		TransactionID: "hicli-test_edit",
		SendError:     "not sent",
		RelatesTo:     "$original:beeper.local",
		RelationType:  event.RelReplace,
	})
	if err != nil {
		t.Fatalf("insert edit: %v", err)
	}
	if _, err = client.engine.DB.Timeline.Append(ctx, roomID, []database.EventRowID{originalRowID, editRowID}); err != nil {
		t.Fatalf("append timeline: %v", err)
	}
	page, err := client.HistoryPageWithLimit(ctx, roomID.String(), 0, 10)
	if err != nil {
		t.Fatalf("load history page: %v", err)
	}
	if len(page.Messages) != 1 {
		t.Fatalf("loaded %d messages, want 1: %+v", len(page.Messages), page.Messages)
	}
	if page.Messages[0].Body != "edited body" {
		t.Fatalf("history body = %q, want %q (edited=%v)", page.Messages[0].Body, "edited body", page.Messages[0].Edited)
	}
}

func TestPopulateEditHistoriesAppliesEditToDecryptedMegolmMessage(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	originalID := id.EventID("$original:beeper.local")
	sender := id.UserID("@alice:example.org")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	ciphertext := json.RawMessage(`{"algorithm":"m.megolm.v1.aes-sha2","ciphertext":"AAAA","device_id":"D","sender_key":"K","session_id":"S"}`)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create test room: %v", err)
	}
	for _, evt := range []*database.Event{
		{
			RoomID:          roomID,
			ID:              originalID,
			Sender:          sender,
			Type:            event.EventEncrypted.Type,
			DecryptedType:   event.EventMessage.Type,
			Timestamp:       jsontime.UM(baseTime),
			Content:         ciphertext,
			Decrypted:       json.RawMessage(`{"msgtype":"m.text","body":"original body"}`),
			MegolmSessionID: "S",
			Unsigned:        json.RawMessage(`{}`),
			TransactionID:   "hicli-test_original",
			SendError:       "not sent",
		},
		{
			RoomID:          roomID,
			ID:              id.EventID("$edit:beeper.local"),
			Sender:          sender,
			Type:            event.EventEncrypted.Type,
			DecryptedType:   event.EventMessage.Type,
			Timestamp:       jsontime.UM(baseTime.Add(time.Second)),
			Content:         ciphertext,
			Decrypted:       json.RawMessage(`{"msgtype":"m.text","body":"* edited body","m.new_content":{"msgtype":"m.text","body":"edited body"},"m.relates_to":{"rel_type":"m.replace","event_id":"$original:beeper.local"}}`),
			MegolmSessionID: "S",
			Unsigned:        json.RawMessage(`{}`),
			TransactionID:   "hicli-test_edit",
			SendError:       "not sent",
			RelatesTo:       originalID,
			RelationType:    event.RelReplace,
		},
	} {
		if _, err = client.engine.DB.Event.Upsert(ctx, evt); err != nil {
			t.Fatalf("store event %s: %v", evt.ID, err)
		}
	}
	stored, err := client.engine.DB.Event.GetByID(ctx, roomID, originalID)
	if err != nil {
		t.Fatalf("read original message: %v", err)
	}
	message, ok := messageFromEvent(stored)
	if !ok {
		t.Fatalf("original message was not mapped to a timeline message")
	}
	messages := []Message{message}
	if err = client.populateEditHistories(ctx, roomID.String(), []*database.Event{stored}, messages); err != nil {
		t.Fatalf("populate edit history: %v", err)
	}
	if messages[0].Body != "edited body" {
		t.Fatalf("body = %q, want %q (edited=%v)", messages[0].Body, "edited body", messages[0].Edited)
	}
}
