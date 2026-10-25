package matrix

import (
	"encoding/json"
	"errors"
	"testing"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix/event"
)

func TestMessageFromEventKeepsEveryAlbumItem(t *testing.T) {
	evt := &database.Event{
		Type: event.EventMessage.Type,
		Content: json.RawMessage(`{"msgtype":"com.beeper.gallery","body":"Sent an album","com.beeper.gallery.images":[` +
			`{"msgtype":"m.video","body":"clip.mp4","file":{"url":"mxc://example.org/album-video","key":{},"iv":"iv","hashes":{},"v":"v2"}},` +
			`{"msgtype":"m.image","body":"first.jpg","url":"mxc://example.org/album-first","info":{"mimetype":"image/jpeg"}},` +
			`{"msgtype":"m.image","filename":"second.png","body":"caption","url":"mxc://example.org/album-second","info":{"mimetype":"image/png"}},` +
			`{"msgtype":"m.file","body":"notes.pdf","url":"mxc://example.org/album-file"}]}`),
	}
	message, ok := messageFromEvent(evt)
	if !ok {
		t.Fatal("expected an album message")
	}
	if message.MediaURI != "mxc://example.org/album-first" || message.MediaName != "first.jpg" {
		t.Fatalf("inline media = %q (%q), want the first image", message.MediaURI, message.MediaName)
	}

	attachments := message.MediaAttachments()
	want := []struct {
		uri       string
		name      string
		encrypted bool
	}{
		{uri: "mxc://example.org/album-first", name: "first.jpg"},
		{uri: "mxc://example.org/album-video", name: "clip.mp4", encrypted: true},
		{uri: "mxc://example.org/album-second", name: "second.png"},
		{uri: "mxc://example.org/album-file", name: "notes.pdf"},
	}
	if len(attachments) != len(want) {
		t.Fatalf("attachments = %d, want %d: %+v", len(attachments), len(want), attachments)
	}
	for i, attachment := range attachments {
		if attachment.URI != want[i].uri || attachment.Name != want[i].name {
			t.Errorf("attachment %d = %q (%q), want %q (%q)", i, attachment.URI, attachment.Name, want[i].uri, want[i].name)
		}
		if (attachment.Encrypted != nil) != want[i].encrypted {
			t.Errorf("attachment %d encrypted = %t, want %t", i, attachment.Encrypted != nil, want[i].encrypted)
		}
	}
}

func TestMessageMediaAttachmentsIsEmptyForTextMessages(t *testing.T) {
	message := Message{Body: "hello"}
	if attachments := message.MediaAttachments(); len(attachments) != 0 {
		t.Fatalf("attachments = %+v, want none", attachments)
	}
}

func TestCollectRoomHistoryReturnsOldestFirstAcrossPages(t *testing.T) {
	pages := map[int64]HistoryPage{
		0:  {Messages: []Message{{ID: "$5"}, {ID: "$6"}}, Before: 40, HasMore: true},
		40: {Messages: []Message{{ID: "$3"}, {ID: "$4"}}, Before: 20, HasMore: true},
		20: {Messages: []Message{{ID: "$1"}, {ID: "$2"}}, Before: 10, HasMore: false},
	}
	var requested []int64
	messages, err := collectRoomHistory(func(before int64) (HistoryPage, error) {
		requested = append(requested, before)
		return pages[before], nil
	}, func() error {
		t.Fatal("backfill should not run when the local timeline has messages")
		return nil
	})
	if err != nil {
		t.Fatalf("collectRoomHistory() error = %v", err)
	}
	assertMessageIDs(t, messages, "$1", "$2", "$3", "$4", "$5", "$6")
	if len(requested) != 3 || requested[0] != 0 || requested[1] != 40 || requested[2] != 20 {
		t.Fatalf("requested cursors = %v, want [0 40 20]", requested)
	}
}

func TestCollectRoomHistoryDeduplicatesOverlappingPages(t *testing.T) {
	pages := map[int64]HistoryPage{
		0:  {Messages: []Message{{ID: "$2"}, {ID: "$3"}}, Before: 20, HasMore: true},
		20: {Messages: []Message{{ID: "$1"}, {ID: "$2"}}, Before: 5, HasMore: false},
	}
	messages, err := collectRoomHistory(func(before int64) (HistoryPage, error) {
		return pages[before], nil
	}, func() error { return nil })
	if err != nil {
		t.Fatalf("collectRoomHistory() error = %v", err)
	}
	assertMessageIDs(t, messages, "$1", "$2", "$3")
}

func TestCollectRoomHistoryBackfillsEmptyLocalTimelineOnce(t *testing.T) {
	backfills := 0
	fetches := 0
	messages, err := collectRoomHistory(func(before int64) (HistoryPage, error) {
		fetches++
		if backfills == 0 {
			return HistoryPage{HasMore: true}, nil
		}
		return HistoryPage{Messages: []Message{{ID: "$1"}}, Before: 5, HasMore: false}, nil
	}, func() error {
		backfills++
		return nil
	})
	if err != nil {
		t.Fatalf("collectRoomHistory() error = %v", err)
	}
	if backfills != 1 || fetches != 2 {
		t.Fatalf("backfills = %d, fetches = %d, want 1 and 2", backfills, fetches)
	}
	assertMessageIDs(t, messages, "$1")
}

func TestCollectRoomHistoryStopsWhenServerHistoryIsEmpty(t *testing.T) {
	backfills := 0
	_, err := collectRoomHistory(func(before int64) (HistoryPage, error) {
		return HistoryPage{HasMore: true}, nil
	}, func() error {
		backfills++
		return nil
	})
	if err == nil {
		t.Fatal("collectRoomHistory() error = nil, want a pagination error")
	}
	if backfills != 1 {
		t.Fatalf("backfills = %d, want 1", backfills)
	}
}

func TestCollectRoomHistoryStopsWhenCursorDoesNotMove(t *testing.T) {
	pages := map[int64]HistoryPage{
		0:  {Messages: []Message{{ID: "$1"}}, Before: 10, HasMore: true},
		10: {Messages: []Message{{ID: "$0"}}, Before: 10, HasMore: true},
	}
	_, err := collectRoomHistory(func(before int64) (HistoryPage, error) {
		return pages[before], nil
	}, func() error { return nil })
	if err == nil {
		t.Fatal("collectRoomHistory() error = nil, want a pagination error")
	}
}

func TestCollectRoomHistoryReturnsFetchErrors(t *testing.T) {
	fetchErr := errors.New("timeline unavailable")
	_, err := collectRoomHistory(func(before int64) (HistoryPage, error) {
		return HistoryPage{}, fetchErr
	}, func() error {
		t.Fatal("backfill should not run after a fetch error")
		return nil
	})
	if !errors.Is(err, fetchErr) {
		t.Fatalf("collectRoomHistory() error = %v, want %v", err, fetchErr)
	}
}

func assertMessageIDs(t *testing.T, messages []Message, want ...string) {
	t.Helper()
	if len(messages) != len(want) {
		t.Fatalf("messages = %d, want %d", len(messages), len(want))
	}
	for i, message := range messages {
		if message.ID != want[i] {
			t.Errorf("message %d ID = %q, want %q", i, message.ID, want[i])
		}
	}
}
