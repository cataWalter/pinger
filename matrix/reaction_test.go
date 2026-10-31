package matrix

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

func TestFindOwnReactionIDsPagesThroughRelations(t *testing.T) {
	const roomID = id.RoomID("!room:example.org")
	const eventID = id.EventID("$target")
	const me = id.UserID("@me:example.org")

	pages := map[string]string{
		"": `{"chunk":[
			{"type":"m.reaction","event_id":"$my-thumb-first","sender":"@me:example.org","room_id":"!room:example.org","content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}},
			{"type":"m.reaction","event_id":"$other-thumb","sender":"@other:example.org","room_id":"!room:example.org","origin_server_ts":1,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}},
			{"type":"m.reaction","event_id":"$my-heart","sender":"@me:example.org","room_id":"!room:example.org","origin_server_ts":2,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"❤️"}}}
		],"next_batch":"page-2"}`,
		"page-2": `{"chunk":[
			{"type":"m.reaction","event_id":"$my-thumb-first","sender":"@me:example.org","room_id":"!room:example.org","content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}},
			{"type":"m.reaction","event_id":"$my-thumb","sender":"@me:example.org","room_id":"!room:example.org","origin_server_ts":3,"content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}}
		]}`,
	}
	var redacted []id.EventID
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/redact/") {
			segments := strings.Split(r.URL.Path, "/")
			redacted = append(redacted, id.EventID(segments[len(segments)-2]))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"event_id":"$redaction"}`))
			return
		}
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
	got, err := findOwnReactionIDs(context.Background(), cli, roomID, eventID, me, "👍")
	if err != nil {
		t.Fatalf("findOwnReactionID() error = %v", err)
	}
	want := []id.EventID{"$my-thumb-first", "$my-thumb"}
	if !slices.Equal(got, want) {
		t.Fatalf("findOwnReactionIDs() = %q, want %q", got, want)
	}

	missing, err := findOwnReactionIDs(context.Background(), cli, roomID, eventID, me, "🎉")
	if err != nil {
		t.Fatalf("findOwnReactionID(missing) error = %v", err)
	}
	if len(missing) != 0 {
		t.Fatalf("findOwnReactionID(missing) = %q, want empty", missing)
	}
	if err = redactOwnReactions(context.Background(), cli, roomID, eventID, me, "👍"); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(redacted, want) {
		t.Fatalf("redacted = %q, want each own annotation exactly once: %q", redacted, want)
	}
}

func TestRemoveOwnReactionsReportsPartialRedactionFailure(t *testing.T) {
	redactions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/redact/") {
			redactions++
			if redactions == 2 {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"errcode":"M_FORBIDDEN","error":"redaction denied"}`))
				return
			}
			_, _ = w.Write([]byte(`{"event_id":"$redaction"}`))
			return
		}
		_, _ = w.Write([]byte(`{"chunk":[
			{"type":"m.reaction","event_id":"$first","sender":"@me:example.org","content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"eyes"}}},
			{"type":"m.reaction","event_id":"$second","sender":"@me:example.org","content":{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"eyes"}}}
		]}`))
	}))
	defer server.Close()
	cli, err := mautrix.NewClient(server.URL, "@me:example.org", "token")
	if err != nil {
		t.Fatal(err)
	}
	err = redactOwnReactions(context.Background(), cli, "!room:example.org", "$target", "@me:example.org", "eyes")
	if err == nil || redactions != 2 || !strings.Contains(err.Error(), "$second") {
		t.Fatalf("partial removal = %d redactions, %v; want second redaction error", redactions, err)
	}
}

func TestApplyOwnReactionsMarksOnlyCurrentUserEmoji(t *testing.T) {
	const me = id.UserID("@me:example.org")
	const thumb = `{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}`
	messages := []Message{{ID: "$target", Reacted: map[string]bool{}}, {ID: "$other", Reacted: map[string]bool{}}}
	reactions := map[id.EventID]*database.GetReactionsResult{
		"$target": {Events: []*database.Event{
			{Sender: "@other:example.org", Content: json.RawMessage(thumb)},
			{Sender: me, Content: json.RawMessage(thumb)},
		}},
	}

	applyOwnReactions(messages, reactions, me)

	if !messages[0].Reacted["👍"] {
		t.Fatalf("own reaction not marked as reacted: %v", messages[0].Reacted)
	}
	if len(messages[1].Reacted) != 0 {
		t.Fatalf("message without own reaction marked: %v", messages[1].Reacted)
	}
}
