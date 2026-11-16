package desktop

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"mychat/matrix"
)

type fakeBulkChatExportSource struct {
	rooms    []matrix.Room
	messages map[string][]matrix.Message
	failing  map[string]bool
	// hanging chats block until their context ends.
	hanging map[string]bool
	// cancelRoom cancels the export when that room is requested.
	cancelRoom string
	cancel     context.CancelFunc
}

func (f *fakeBulkChatExportSource) Rooms() []matrix.Room {
	return f.rooms
}

func (f *fakeBulkChatExportSource) RecentRoomMessages(ctx context.Context, roomID string, limit int) ([]matrix.Message, error) {
	if f.cancel != nil && roomID == f.cancelRoom {
		f.cancel()
		return nil, context.Canceled
	}
	if f.hanging[roomID] {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if f.failing[roomID] {
		return nil, errors.New("history unavailable")
	}
	messages := f.messages[roomID]
	if len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}
	return messages, nil
}

func bulkChatExportTestMessages(bodies ...string) []matrix.Message {
	messages := make([]matrix.Message, 0, len(bodies))
	for i, body := range bodies {
		messages = append(messages, matrix.Message{
			ID:         "$" + body,
			Sender:     "@ann:example.org",
			SenderName: "Ann",
			Body:       body,
			Timestamp:  chatExportTestTime.Add(time.Duration(i) * time.Minute),
		})
	}
	return messages
}

var bulkChatExportAll = BulkChatExportOptions{PrivateChats: true, GroupChats: true, MyMessages: true, TheirMessages: true, DeletedMessages: true}

func TestExportRecentMessagesForAllChatsFiltersChatsAndMessages(t *testing.T) {
	group := bulkChatExportTestMessages("theirs", "mine", "deleted")
	group[1].Own = true
	group[2].Own = true
	group[2].Redacted = true
	source := &fakeBulkChatExportSource{
		rooms: []matrix.Room{
			{ID: "!g:example.org", Name: "Team"},
			{ID: "!p:example.org", Name: "Ann", Direct: true},
		},
		messages: map[string][]matrix.Message{
			"!g:example.org": group,
			"!p:example.org": bulkChatExportTestMessages("private"),
		},
	}
	run := func(options BulkChatExportOptions) string {
		result, err := exportRecentMessagesForAllChats(context.Background(), source, t.TempDir(), 50, options, chatExportTestTime, func(BulkChatExportProgress) {})
		if err != nil {
			t.Fatalf("exportRecentMessagesForAllChats() error = %v", err)
		}
		page, err := os.ReadFile(result.Path)
		if err != nil {
			t.Fatal(err)
		}
		return string(page)
	}
	if got, want := run(BulkChatExportOptions{GroupChats: true, TheirMessages: true}), "Team\nAnn: theirs\n"; got != want {
		t.Fatalf("group chats, their messages = %q, want %q", got, want)
	}
	if got, want := run(BulkChatExportOptions{PrivateChats: true, TheirMessages: true}), "Ann\nthem: private\n"; got != want {
		t.Fatalf("private chats, their messages = %q, want %q", got, want)
	}
	if got, want := run(BulkChatExportOptions{GroupChats: true, MyMessages: true, DeletedMessages: true}), "Team\nme: mine\nme: Message deleted\n"; got != want {
		t.Fatalf("group chats, my and deleted messages = %q, want %q", got, want)
	}
}

func TestExportRecentMessagesForAllChatsWritesOneFile(t *testing.T) {
	owner := bulkChatExportTestMessages("only")
	owner[0].Own = true
	source := &fakeBulkChatExportSource{
		rooms: []matrix.Room{
			{ID: "!a:example.org", Name: "Team"},
			{ID: "!b:example.org", Name: "Ann", Direct: true},
			{ID: "!c:example.org", Name: "Broken"},
		},
		messages: map[string][]matrix.Message{
			"!a:example.org": bulkChatExportTestMessages("first", "second", "third"),
			"!b:example.org": owner,
		},
		failing: map[string]bool{"!c:example.org": true},
	}
	parent := t.TempDir()
	var reports []BulkChatExportProgress
	result, err := exportRecentMessagesForAllChats(context.Background(), source, parent, 2, bulkChatExportAll, chatExportTestTime, func(progress BulkChatExportProgress) {
		reports = append(reports, progress)
	})
	if err != nil {
		t.Fatalf("exportRecentMessagesForAllChats() error = %v", err)
	}
	if result.Cancelled || result.Chats != 2 || result.Messages != 3 || result.Failed != 1 {
		t.Fatalf("result = %+v, want 2 chats, 3 messages, 1 failed, not cancelled", result)
	}
	wantName := "All chats last 2 messages 2026-10-25 0930.txt"
	if filepath.Dir(result.Path) != parent || filepath.Base(result.Path) != wantName {
		t.Fatalf("file = %q, want %q inside %q", result.Path, wantName, parent)
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("export left %d entries, want only the text file", len(entries))
	}
	page, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "Team\nAnn: second\nAnn: third\n\nAnn\nme: only\n"; string(page) != want {
		t.Fatalf("transcript = %q, want %q", page, want)
	}
	if len(reports) != 3 || reports[2].Done != 3 || reports[2].Total != 3 || reports[2].Failed != 1 {
		t.Fatalf("progress reports = %+v", reports)
	}
}

func TestExportRecentMessagesForAllChatsKeepsWrittenChatsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := &fakeBulkChatExportSource{
		rooms: []matrix.Room{
			{ID: "!a:example.org", Name: "Alpha"},
			{ID: "!b:example.org", Name: "Beta"},
			{ID: "!c:example.org", Name: "Gamma"},
		},
		messages: map[string][]matrix.Message{
			"!a:example.org": bulkChatExportTestMessages("hi"),
		},
		cancelRoom: "!b:example.org",
		cancel:     cancel,
	}
	parent := t.TempDir()
	result, err := exportRecentMessagesForAllChats(ctx, source, parent, 50, bulkChatExportAll, chatExportTestTime, func(BulkChatExportProgress) {})
	if err != nil {
		t.Fatalf("exportRecentMessagesForAllChats() error = %v", err)
	}
	if !result.Cancelled || result.Chats != 1 {
		t.Fatalf("result = %+v, want cancelled after 1 chat", result)
	}
	page, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "Alpha\nAnn: hi\n"; string(page) != want {
		t.Fatalf("transcript = %q, want %q", page, want)
	}
}

func TestExportRecentMessagesForAllChatsSkipsMessagesWithMedia(t *testing.T) {
	messages := bulkChatExportTestMessages("hello", "picture", "bye")
	messages[1].MediaURI = "mxc://example.org/picture"
	messages[1].MediaMIME = "image/png"
	messages[1].MediaName = "holiday.png"
	source := &fakeBulkChatExportSource{
		rooms:    []matrix.Room{{ID: "!a:example.org", Name: "Team"}},
		messages: map[string][]matrix.Message{"!a:example.org": messages},
	}
	parent := t.TempDir()
	result, err := exportRecentMessagesForAllChats(context.Background(), source, parent, 100, bulkChatExportAll, chatExportTestTime, func(BulkChatExportProgress) {})
	if err != nil {
		t.Fatalf("exportRecentMessagesForAllChats() error = %v", err)
	}
	if result.Chats != 1 || result.Messages != 2 {
		t.Fatalf("result = %+v, want 1 chat with 2 text messages", result)
	}
	page, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "Team\nAnn: hello\nAnn: bye\n"; string(page) != want {
		t.Fatalf("transcript = %q, want %q", page, want)
	}
}

func TestExportRecentMessagesForAllChatsSkipsChatsWithoutText(t *testing.T) {
	source := &fakeBulkChatExportSource{
		rooms: []matrix.Room{
			{ID: "!a:example.org", Name: "Quiet"},
			{ID: "!b:example.org", Name: "Team"},
		},
		messages: map[string][]matrix.Message{"!b:example.org": bulkChatExportTestMessages("hi")},
	}
	result, err := exportRecentMessagesForAllChats(context.Background(), source, t.TempDir(), 50, bulkChatExportAll, chatExportTestTime, func(BulkChatExportProgress) {})
	if err != nil {
		t.Fatalf("exportRecentMessagesForAllChats() error = %v", err)
	}
	if result.Chats != 1 {
		t.Fatalf("result = %+v, want 1 chat", result)
	}
	page, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "Team\nAnn: hi\n"; string(page) != want {
		t.Fatalf("transcript = %q, want %q", page, want)
	}
}

func TestExportRecentMessagesForAllChatsSkipsStalledChat(t *testing.T) {
	previous := bulkChatRoomTimeout
	bulkChatRoomTimeout = 10 * time.Millisecond
	t.Cleanup(func() { bulkChatRoomTimeout = previous })
	source := &fakeBulkChatExportSource{
		rooms: []matrix.Room{
			{ID: "!stalled:example.org", Name: "Stalled"},
			{ID: "!a:example.org", Name: "Team"},
		},
		messages: map[string][]matrix.Message{"!a:example.org": bulkChatExportTestMessages("hi")},
		hanging:  map[string]bool{"!stalled:example.org": true},
	}
	result, err := exportRecentMessagesForAllChats(context.Background(), source, t.TempDir(), 50, bulkChatExportAll, chatExportTestTime, func(BulkChatExportProgress) {})
	if err != nil {
		t.Fatalf("exportRecentMessagesForAllChats() error = %v", err)
	}
	if result.Cancelled || result.Chats != 1 || result.Failed != 1 {
		t.Fatalf("result = %+v, want 1 chat and 1 failed without cancelling", result)
	}
	page, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "Team\nAnn: hi\n"; string(page) != want {
		t.Fatalf("transcript = %q, want %q", page, want)
	}
}

func TestExportRecentMessagesForAllChatsGuards(t *testing.T) {
	service := &AppService{}
	if _, err := service.ExportRecentMessagesForAllChats(t.TempDir(), 50, bulkChatExportAll); err == nil {
		t.Fatal("ExportRecentMessagesForAllChats() error = nil without an open account")
	}
}
