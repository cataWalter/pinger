package matrix

import (
	"context"
	"encoding/json"
	"io"
	"path/filepath"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestOpenMediaFileForEventUsesEncryptedCache(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	client.SetMediaCacheDir(t.TempDir())

	const roomID = "!room:example.org"
	const eventID = "$photo"
	const mediaURI = "mxc://example.org/encrypted-photo"
	if err = client.engine.DB.Room.CreateRow(context.Background(), id.RoomID(roomID)); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	content, err := json.Marshal(map[string]any{
		"msgtype": "m.image",
		"body":    "photo.webp",
		"file": map[string]any{
			"url":    mediaURI,
			"key":    map[string]string{},
			"iv":     "",
			"hashes": map[string]string{},
			"v":      "v2",
		},
		"info": map[string]any{"mimetype": "image/webp"},
	})
	if err != nil {
		t.Fatalf("marshal event content: %v", err)
	}
	storedEvent := &database.Event{
		RoomID:    id.RoomID(roomID),
		ID:        id.EventID(eventID),
		Sender:    id.UserID("@alice:example.org"),
		Type:      event.EventMessage.Type,
		Timestamp: jsontime.UM(time.Now()),
		Content:   content,
		Unsigned:  json.RawMessage(`{}`),
	}
	if _, err = client.engine.DB.Event.Insert(context.Background(), storedEvent); err != nil {
		t.Fatalf("insert media event: %v", err)
	}
	writeCacheFile(t, client, mediaURI, true, "decrypted-webp")

	file, mimeType, err := client.OpenMediaFileForEvent(context.Background(), roomID, eventID)
	if err != nil {
		t.Fatalf("open cached media: %v", err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		t.Fatalf("read cached media: %v", err)
	}
	if string(data) != "decrypted-webp" || mimeType != "image/webp" {
		t.Fatalf("opened media = %q (%q), want cached data and image/webp", data, mimeType)
	}
}

func TestOpenMediaFileForEventRejectsMalformedAndMissingIDs(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	if _, _, err = client.OpenMediaFileForEvent(context.Background(), "!room/example.org", "$photo"); err != ErrInvalidMediaRequest {
		t.Fatalf("malformed room ID error = %v, want ErrInvalidMediaRequest", err)
	}
	if _, _, err = client.OpenMediaFileForEvent(context.Background(), "!room:example.org", "$missing"); err != ErrMediaNotFound {
		t.Fatalf("missing event error = %v, want ErrMediaNotFound", err)
	}
}
