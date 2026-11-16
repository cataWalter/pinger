package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"path/filepath"
	"testing"
	"time"
)

func TestPreviewFromHistoryReadsOnlyWithinBudget(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	base := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	newRoom := func(t *testing.T, name, prevBatch string) id.RoomID {
		t.Helper()
		roomID := id.RoomID("!" + name + ":example.org")
		if err := client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
			t.Fatalf("create room row: %v", err)
		}
		if prevBatch != "" {
			if err := client.engine.DB.Room.SetPrevBatch(ctx, roomID, prevBatch); err != nil {
				t.Fatalf("set room pagination token: %v", err)
			}
		}
		return roomID
	}
	emptyPages := func(calls *int, hasMore bool) previewPageFunc {
		return func(context.Context, id.RoomID, int, bool) (*jsoncmd.PaginationResponse, error) {
			*calls++
			return &jsoncmd.PaginationResponse{HasMore: hasMore}, nil
		}
	}

	t.Run("stops at the first page that yields a message", func(t *testing.T) {
		roomID := newRoom(t, "found-on-first-page", "opaque-token")
		calls := 0
		page := func(_ context.Context, pageRoomID id.RoomID, _ int, _ bool) (*jsoncmd.PaginationResponse, error) {
			calls++
			insertStoredMessage(t, client, pageRoomID, "$history", "from history", base)
			return &jsoncmd.PaginationResponse{HasMore: true}, nil
		}
		message, ok, err := client.previewFromHistory(ctx, roomID, page)
		if err != nil || !ok || message.Body != "from history" || calls != 1 {
			t.Fatalf("preview = %+v found=%t err=%v calls=%d, want one call and the history message", message, ok, err, calls)
		}
	})

	t.Run("uses the page budget when no page yields a message", func(t *testing.T) {
		roomID := newRoom(t, "budget-only", "opaque-token")
		calls := 0
		_, ok, err := client.previewFromHistory(ctx, roomID, emptyPages(&calls, true))
		if err != nil || ok || calls != previewHistoryMaxPages {
			t.Fatalf("found=%t err=%v calls=%d, want no preview after %d pages", ok, err, calls, previewHistoryMaxPages)
		}
	})

	t.Run("stops when server history is complete", func(t *testing.T) {
		roomID := newRoom(t, "complete-after-one-page", "opaque-token")
		calls := 0
		_, ok, err := client.previewFromHistory(ctx, roomID, emptyPages(&calls, false))
		if err != nil || ok || calls != 1 {
			t.Fatalf("found=%t err=%v calls=%d, want one call and no preview", ok, err, calls)
		}
	})

	t.Run("makes no request without server history left", func(t *testing.T) {
		calls := 0
		for _, roomID := range []id.RoomID{
			newRoom(t, "no-token", ""),
			newRoom(t, "already-complete", database.PrevBatchPaginationComplete),
		} {
			if _, ok, err := client.previewFromHistory(ctx, roomID, emptyPages(&calls, true)); err != nil || ok {
				t.Fatalf("room %s found=%t err=%v, want no preview", roomID, ok, err)
			}
		}
		if calls != 0 {
			t.Fatalf("pagination calls = %d, want none", calls)
		}
	})

	t.Run("leaves rooms that are already paginating", func(t *testing.T) {
		roomID := newRoom(t, "already-paging", "opaque-token")
		calls := 0
		page := func(context.Context, id.RoomID, int, bool) (*jsoncmd.PaginationResponse, error) {
			calls++
			return nil, hicli.ErrPaginationAlreadyInProgress
		}
		_, ok, err := client.previewFromHistory(ctx, roomID, page)
		if err != nil || ok || calls != 1 {
			t.Fatalf("found=%t err=%v calls=%d, want one call and no error", ok, err, calls)
		}
	})
}

func TestApplyRoomPreviewKeepsSortingAndSetsLastSender(t *testing.T) {
	sortedAt := time.Date(2026, time.October, 12, 9, 0, 0, 0, time.UTC)
	historyAt := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	client := &Client{
		rooms: map[string]Room{
			"!no-event:example.org":  {ID: "!no-event:example.org", LastSeen: sortedAt},
			"!has-event:example.org": {ID: "!has-event:example.org", LastSeen: sortedAt, LastEventAt: sortedAt, LastEventID: "$live"},
			"!set:example.org":       {ID: "!set:example.org", Preview: "kept", LastSeen: sortedAt},
		},
		dismissedEvents: map[string]string{},
	}
	history := Message{ID: "$history", Body: "old text", Sender: "@friend:example.org", Timestamp: historyAt}

	if !client.applyRoomPreview("!no-event:example.org", history) {
		t.Fatal("empty preview was not filled")
	}
	if !client.applyRoomPreview("!has-event:example.org", history) {
		t.Fatal("empty preview in a room with a newer event was not filled")
	}
	if client.applyRoomPreview("!set:example.org", Message{ID: "$other", Body: "replacement", Timestamp: historyAt}) {
		t.Fatal("existing preview was replaced")
	}

	noEvent := client.rooms["!no-event:example.org"]
	if noEvent.Preview != "old text" || noEvent.LastEventID != "$history" || !noEvent.LastEventAt.Equal(historyAt) {
		t.Fatalf("room without an event time = %+v, want the history message as its last event", noEvent)
	}
	hasEvent := client.rooms["!has-event:example.org"]
	if hasEvent.Preview != "old text" || hasEvent.LastEventID != "$live" || !hasEvent.LastEventAt.Equal(sortedAt) {
		t.Fatalf("room with a newer event = %+v, want its last event kept", hasEvent)
	}
	if !noEvent.LastSeen.Equal(sortedAt) || noEvent.LastEventSender != "@friend:example.org" || !noEvent.Unanswered {
		t.Fatalf("room without an event time = %+v, want the friend's message as the reply state", noEvent)
	}
	if !hasEvent.LastSeen.Equal(sortedAt) || hasEvent.LastEventSender != "" || hasEvent.Unanswered {
		t.Fatalf("room with a newer event = %+v, want its reply state kept", hasEvent)
	}
	if kept := client.rooms["!set:example.org"]; kept.Preview != "kept" {
		t.Fatalf("existing preview = %q, want kept", kept.Preview)
	}
}

func TestFillMissingPreviewsRestoresStoredMessagesWithoutNetwork(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!restored:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	base := time.Date(2024, time.March, 1, 12, 0, 0, 0, time.UTC)
	sortedAt := base.Add(24 * time.Hour)
	insertStoredMessage(t, client, roomID, "$stored", "stored text", base)
	client.mu.Lock()
	client.rooms[roomID.String()] = Room{ID: roomID.String(), LastSeen: sortedAt}
	client.mu.Unlock()

	client.fillMissingPreviews(ctx, false)

	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "stored text" || !rooms[0].LastEventAt.Equal(base) {
		t.Fatalf("rooms = %+v, want the stored message as preview", rooms)
	}
	if !rooms[0].LastSeen.Equal(sortedAt) {
		t.Fatalf("LastSeen = %v, want sorting time unchanged", rooms[0].LastSeen)
	}
}

func TestMessageFromEventMapsMediaMetadata(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantURI    string
		wantMIME   string
		wantBody   string
		wantWidth  int
		wantHeight int
		encrypted  bool
	}{
		{
			name:       "unencrypted",
			content:    `{"body":"photo","url":"mxc://example.org/plain","info":{"mimetype":"image/png","w":640,"h":480}}`,
			wantURI:    "mxc://example.org/plain",
			wantMIME:   "image/png",
			wantBody:   "photo",
			wantWidth:  640,
			wantHeight: 480,
		},
		{
			name:      "encrypted",
			content:   `{"body":"photo","file":{"url":"mxc://example.org/encrypted","key":{},"iv":"iv","hashes":{},"v":"v2"}}`,
			wantURI:   "mxc://example.org/encrypted",
			encrypted: true,
		},
		{
			name:      "encrypted image without info",
			content:   `{"msgtype":"m.image","body":"photo.png","file":{"url":"mxc://example.org/image-without-info","key":{},"iv":"iv","hashes":{},"v":"v2"}}`,
			wantURI:   "mxc://example.org/image-without-info",
			wantMIME:  "image/unknown",
			encrypted: true,
		},
		{
			name: "Beeper gallery image and video",
			content: `{"msgtype":"com.beeper.gallery","body":"Sent an album with 1 image and 1 video:","com.beeper.gallery.images":[` +
				`{"msgtype":"m.image","body":"photo.jpg","file":{"url":"mxc://example.org/gallery-image","key":{},"iv":"iv","hashes":{},"v":"v2"},"info":{"mimetype":"image/jpeg","w":640,"h":480}},` +
				`{"msgtype":"m.video","body":"clip.mp4","file":{"url":"mxc://example.org/gallery-video","key":{},"iv":"iv","hashes":{},"v":"v2"}}]}`,
			wantURI:    "mxc://example.org/gallery-image",
			wantMIME:   "image/jpeg",
			wantBody:   "Sent an album with 1 image and 1 video:",
			wantWidth:  640,
			wantHeight: 480,
			encrypted:  true,
		},
		{
			name:      "encrypted image without legacy body",
			content:   `{"msgtype":"m.image","file":{"url":"mxc://example.org/bodyless-image","key":{},"iv":"iv","hashes":{},"v":"v2"},"info":{"mimetype":"image/jpeg"}}`,
			wantURI:   "mxc://example.org/bodyless-image",
			wantMIME:  "image/jpeg",
			wantBody:  "Image",
			encrypted: true,
		},
		{
			name:     "extensible text without legacy body",
			content:  `{"m.text":[{"body":"hello from extensible text"}]}`,
			wantBody: "hello from extensible text",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			evt := &database.Event{
				Type:    event.EventMessage.Type,
				Content: json.RawMessage(test.content),
			}
			message, ok := messageFromEvent(evt)
			if !ok {
				t.Fatal("expected a media message")
			}
			if message.MediaURI != test.wantURI {
				t.Errorf("media URI = %q, want %q", message.MediaURI, test.wantURI)
			}
			if (message.MediaEncrypted != nil) != test.encrypted {
				t.Errorf("encrypted metadata present = %t, want %t", message.MediaEncrypted != nil, test.encrypted)
			}
			if message.MediaMIME != test.wantMIME {
				t.Errorf("media MIME = %q, want %q", message.MediaMIME, test.wantMIME)
			}
			if test.wantBody != "" && message.Body != test.wantBody {
				t.Errorf("message body = %q, want %q", message.Body, test.wantBody)
			}
			if message.MediaWidth != test.wantWidth || message.MediaHeight != test.wantHeight {
				t.Errorf("media dimensions = %dx%d, want %dx%d", message.MediaWidth, message.MediaHeight, test.wantWidth, test.wantHeight)
			}
		})
	}
}
