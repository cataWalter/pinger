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

func TestHistoryPageShowsIncomingEncryptedEdit(t *testing.T) {
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
	client.engine.Account = &database.Account{UserID: "@me:example.org"}
	originalRowID, err := client.engine.DB.Event.Insert(ctx, &database.Event{
		RoomID:        roomID,
		ID:            "$original:example.org",
		Sender:        sender,
		Type:          event.EventEncrypted.Type,
		DecryptedType: event.EventMessage.Type,
		Timestamp:     jsontime.UM(baseTime),
		Content:       ciphertext,
		Decrypted:     json.RawMessage(`{"msgtype":"m.text","body":"original body"}`),
		Unsigned:      json.RawMessage(`{}`),
		TransactionID: "hicli-test_original",
	})
	if err != nil {
		t.Fatalf("insert original: %v", err)
	}
	editRowID, err := client.engine.DB.Event.Insert(ctx, &database.Event{
		RoomID:        roomID,
		ID:            "$edit:example.org",
		Sender:        sender,
		Type:          event.EventEncrypted.Type,
		DecryptedType: event.EventMessage.Type,
		Timestamp:     jsontime.UM(baseTime.Add(time.Second)),
		Content:       ciphertext,
		Decrypted:     json.RawMessage(`{"msgtype":"m.text","body":"","m.new_content":{"msgtype":"m.text","body":"edited body"},"m.relates_to":{"rel_type":"m.replace","event_id":"$original:example.org"}}`),
		Unsigned:      json.RawMessage(`{}`),
		TransactionID: "hicli-test_edit",
		RelatesTo:     "$original:example.org",
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

func TestHistoryPageIncludesEditedOriginalOutsideWindow(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	ctx := context.Background()
	roomID := id.RoomID("!room:example.org")
	baseTime := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create test room: %v", err)
	}
	client.engine.Account = &database.Account{UserID: "@me:example.org"}
	var rows []database.EventRowID
	insert := func(eventID id.EventID, sender id.UserID, offset int, content string, relatesTo id.EventID, relation event.RelationType) {
		t.Helper()
		rowID, insertErr := client.engine.DB.Event.Insert(ctx, &database.Event{
			RoomID:       roomID,
			ID:           eventID,
			Sender:       sender,
			Type:         event.EventMessage.Type,
			Timestamp:    jsontime.UM(baseTime.Add(time.Duration(offset) * time.Second)),
			Content:      json.RawMessage(content),
			Unsigned:     json.RawMessage(`{}`),
			RelatesTo:    relatesTo,
			RelationType: relation,
		})
		if insertErr != nil {
			t.Fatalf("insert %s: %v", eventID, insertErr)
		}
		rows = append(rows, rowID)
	}
	insert("$original:example.org", "@alice:example.org", 0, `{"msgtype":"m.text","body":"original body"}`, "", "")
	for i := 1; i <= 5; i++ {
		insert(id.EventID("$later"+string(rune('0'+i))+":example.org"), "@bob:example.org", i, `{"msgtype":"m.text","body":"later"}`, "", "")
	}
	insert("$edit:example.org", "@alice:example.org", 10,
		`{"msgtype":"m.text","body":"* edited body","m.new_content":{"msgtype":"m.text","body":"edited body"},"m.relates_to":{"rel_type":"m.replace","event_id":"$original:example.org"}}`,
		"$original:example.org", event.RelReplace)
	if _, err = client.engine.DB.Timeline.Append(ctx, roomID, rows); err != nil {
		t.Fatalf("append timeline: %v", err)
	}
	page, err := client.HistoryPageWithLimit(ctx, roomID.String(), 0, 3)
	if err != nil {
		t.Fatalf("load history page: %v", err)
	}
	for _, message := range page.Messages {
		if message.ID == "$original:example.org" {
			if message.Body != "edited body" {
				t.Fatalf("original body = %q, want %q", message.Body, "edited body")
			}
			return
		}
	}
	t.Fatalf("edited original missing from page: %+v", page.Messages)
}
