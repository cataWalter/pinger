package matrix

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
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

func TestOpenMediaPreviewForEventPrefersThumbnailAndFallsBack(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	client.SetMediaCacheDir(t.TempDir())
	homeserver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"errcode":"M_UNKNOWN","error":"thumbnail failed"}`, http.StatusBadRequest)
	}))
	t.Cleanup(homeserver.Close)
	client.engine.Client.HomeserverURL, _ = url.Parse(homeserver.URL)

	const roomID = "!room:example.org"
	if err = client.engine.DB.Room.CreateRow(context.Background(), id.RoomID(roomID)); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	insertImage := func(eventID string, info map[string]any, mediaURI string) {
		t.Helper()
		content, marshalErr := json.Marshal(map[string]any{"msgtype": "m.image", "body": "photo.png", "url": mediaURI, "info": info})
		if marshalErr != nil {
			t.Fatalf("marshal event content: %v", marshalErr)
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
		if _, insertErr := client.engine.DB.Event.Insert(context.Background(), storedEvent); insertErr != nil {
			t.Fatalf("insert media event: %v", insertErr)
		}
	}
	insertImage("$with-thumbnail", map[string]any{"mimetype": "image/png", "thumbnail_url": "mxc://example.org/thumb-small"}, "mxc://example.org/full-large")
	insertImage("$without-thumbnail", map[string]any{"mimetype": "image/png"}, "mxc://example.org/full-only")
	insertImage("$unavailable-thumbnail", map[string]any{"mimetype": "image/png", "thumbnail_url": "mxc://example.org/thumb-missing"}, "mxc://example.org/full-unavailable-thumb")
	writeCacheFile(t, client, "mxc://example.org/full-large", false, "full-large")
	writeCacheFile(t, client, "mxc://example.org/thumb-small", false, "thumb-small")
	writeCacheFile(t, client, "mxc://example.org/full-only", false, "full-only")
	writeCacheFile(t, client, "mxc://example.org/full-unavailable-thumb", false, "full-unavailable-thumb")

	readOpened := func(file *os.File, openErr error) string {
		t.Helper()
		if openErr != nil {
			t.Fatalf("open media: %v", openErr)
		}
		defer file.Close()
		data, readErr := io.ReadAll(file)
		if readErr != nil {
			t.Fatalf("read media: %v", readErr)
		}
		return string(data)
	}
	preview, _, previewErr := client.OpenMediaPreviewForEvent(context.Background(), roomID, "$with-thumbnail")
	if got := readOpened(preview, previewErr); got != "thumb-small" {
		t.Fatalf("preview with thumbnail = %q, want thumbnail bytes", got)
	}
	fallback, _, fallbackErr := client.OpenMediaPreviewForEvent(context.Background(), roomID, "$without-thumbnail")
	if got := readOpened(fallback, fallbackErr); got != "full-only" {
		t.Fatalf("preview without thumbnail = %q, want original bytes", got)
	}
	unavailable, _, unavailableErr := client.OpenMediaPreviewForEvent(context.Background(), roomID, "$unavailable-thumbnail")
	if got := readOpened(unavailable, unavailableErr); got != "full-unavailable-thumb" {
		t.Fatalf("preview with unavailable thumbnail = %q, want original bytes", got)
	}
	original, _, originalErr := client.OpenMediaFileForEvent(context.Background(), roomID, "$with-thumbnail")
	if got := readOpened(original, originalErr); got != "full-large" {
		t.Fatalf("original open = %q, want original bytes", got)
	}
}
