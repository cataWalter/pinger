package matrix

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

func TestFindOwnReactionIDPagesThroughRelations(t *testing.T) {
	const roomID = id.RoomID("!room:example.org")
	const eventID = id.EventID("$target")
	const me = id.UserID("@me:example.org")

	pages := map[string]string{
		"": `{"chunk":[
			{"type":"m.reaction","event_id":"$other-thumb","sender":"@other:example.org","room_id":"!room:example.org","origin_server_ts":1,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}},
			{"type":"m.reaction","event_id":"$my-heart","sender":"@me:example.org","room_id":"!room:example.org","origin_server_ts":2,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"❤️"}}}
		],"next_batch":"page-2"}`,
		"page-2": `{"chunk":[
			{"type":"m.reaction","event_id":"$my-thumb","sender":"@me:example.org","room_id":"!room:example.org","origin_server_ts":3,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}}
		]}`,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/m.annotation/m.reaction") {
			http.NotFound(w, r)
			return
		}
		body, ok := pages[r.URL.Query().Get("from")]
		if !ok {
			http.Error(w, "unknown page", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	cli, err := mautrix.NewClient(server.URL, me, "token")
	if err != nil {
		t.Fatal(err)
	}
	got, err := findOwnReactionID(context.Background(), cli, roomID, eventID, me, "👍")
	if err != nil {
		t.Fatalf("findOwnReactionID() error = %v", err)
	}
	if got != "$my-thumb" {
		t.Fatalf("findOwnReactionID() = %q, want %q", got, "$my-thumb")
	}

	missing, err := findOwnReactionID(context.Background(), cli, roomID, eventID, me, "🎉")
	if err != nil {
		t.Fatalf("findOwnReactionID(missing) error = %v", err)
	}
	if missing != "" {
		t.Fatalf("findOwnReactionID(missing) = %q, want empty", missing)
	}
}
