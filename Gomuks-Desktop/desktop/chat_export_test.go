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

type fakeChatExportSource struct {
	messages   []matrix.Message
	historyErr error
	// cancel is called while the history is read to simulate the user cancelling mid-export.
	cancel context.CancelFunc
}

func (f *fakeChatExportSource) RoomHistory(ctx context.Context, roomID string) ([]matrix.Message, error) {
	if f.cancel != nil {
		f.cancel()
	}
	if f.historyErr != nil {
		return nil, f.historyErr
	}
	return f.messages, nil
}

var chatExportTestTime = time.Date(2026, time.October, 25, 9, 30, 0, 0, time.UTC)

func chatExportTestMessages() []matrix.Message {
	return []matrix.Message{
		{
			ID:         "$1",
			Sender:     "@ann:example.org",
			SenderName: "Ann",
			Body:       "hello <b>team</b>\nsecond line",
			Timestamp:  chatExportTestTime,
		},
		{
			ID:         "$2",
			Sender:     "@bob:example.org",
			SenderName: "Bob",
			Body:       "Sent an album",
			Timestamp:  chatExportTestTime.Add(time.Minute),
			MediaURI:   "mxc://example.org/photo",
			MediaMIME:  "image/jpeg",
			MediaName:  "photo.jpg",
			GalleryMedia: []matrix.MediaAttachment{
				{URI: "mxc://example.org/clip", MIME: "video/mp4", Name: "clip.mp4"},
			},
			Reactions: map[string]int{"👍": 2},
		},
		{
			ID:        "$3",
			Sender:    "@ann:example.org",
			Redacted:  true,
			Timestamp: chatExportTestTime.Add(2 * time.Minute),
		},
	}
}

func TestExportRoomChatWritesTextFile(t *testing.T) {
	parent := t.TempDir()
	source := &fakeChatExportSource{messages: chatExportTestMessages()}
	var reports []ChatExportProgress
	result, err := exportRoomChat(context.Background(), source, "!team:example.org", "Team", false, parent, chatExportTestTime, func(progress ChatExportProgress) {
		reports = append(reports, progress)
	})
	if err != nil {
		t.Fatalf("exportRoomChat() error = %v", err)
	}
	if result.Messages != 3 {
		t.Fatalf("result = %+v, want 3 messages", result)
	}
	wantName := "Team chat " + chatExportTestTime.Format("2006-01-02 1504") + ".txt"
	if filepath.Dir(result.Path) != parent || filepath.Base(result.Path) != wantName {
		t.Fatalf("transcript path = %q, want %q inside %q", result.Path, wantName, parent)
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("export left %d entries, want only the text file", len(entries))
	}

	transcript, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	want := "Ann: hello <b>team</b>\nsecond line\n" +
		"Bob: Sent an album\n" +
		"ann: Message deleted\n"
	if string(transcript) != want {
		t.Fatalf("transcript = %q, want %q", transcript, want)
	}

	if len(reports) == 0 {
		t.Fatal("no progress reported")
	}
	last := reports[len(reports)-1]
	if last.Stage != chatExportStageFinishing || last.Messages != 3 {
		t.Fatalf("last progress = %+v, want finishing with 3 messages", last)
	}
}

func TestExportRoomChatWritesNothingWhenCancelled(t *testing.T) {
	parent := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := &fakeChatExportSource{messages: chatExportTestMessages(), cancel: cancel}

	_, err := exportRoomChat(ctx, source, "!team:example.org", "Team", false, parent, chatExportTestTime, func(ChatExportProgress) {})
	if !errors.Is(err, errChatExportCancelled) {
		t.Fatalf("exportRoomChat() error = %v, want errChatExportCancelled", err)
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("cancelled export left %d entries behind", len(entries))
	}
}

func TestExportRoomChatReturnsHistoryErrorWithoutWritingFile(t *testing.T) {
	parent := t.TempDir()
	historyErr := errors.New("timeline unavailable")
	source := &fakeChatExportSource{historyErr: historyErr}

	_, err := exportRoomChat(context.Background(), source, "!team:example.org", "Team", false, parent, chatExportTestTime, func(ChatExportProgress) {})
	if !errors.Is(err, historyErr) {
		t.Fatalf("exportRoomChat() error = %v, want %v", err, historyErr)
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("failed export left %d entries behind", len(entries))
	}
}

func TestUniqueExportFilePathAddsSuffixOnCollision(t *testing.T) {
	parent := t.TempDir()
	first, err := uniqueExportFilePath(parent, exportNameLabel("Team/Ops"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(first, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	second, err := uniqueExportFilePath(parent, exportNameLabel("Team/Ops"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(first) != "Team-Ops.txt" {
		t.Fatalf("first file = %q", filepath.Base(first))
	}
	if filepath.Base(second) != "Team-Ops (1).txt" {
		t.Fatalf("second file = %q", filepath.Base(second))
	}
}

func TestRenderChatExportTextFormatsLines(t *testing.T) {
	messages := []matrix.Message{
		{Sender: "@x:example.org", Body: "hi", Edited: true, Own: true},
		{Sender: "@y:example.org", SenderName: "Yan", Body: "<script>", DecryptionError: "bad key"},
		{Sender: "@z:example.org", Body: "no display name"},
	}
	group := "me: hi\n" +
		"Yan: Unable to decrypt message: bad key\n" +
		"z: no display name\n"
	if got := renderChatExportText(messages, false); got != group {
		t.Fatalf("renderChatExportText(group) = %q, want %q", got, group)
	}
	direct := "me: hi\n" +
		"them: Unable to decrypt message: bad key\n" +
		"them: no display name\n"
	if got := renderChatExportText(messages, true); got != direct {
		t.Fatalf("renderChatExportText(direct) = %q, want %q", got, direct)
	}
}

func TestAppServiceChatExportGuards(t *testing.T) {
	service := &AppService{}
	if service.CancelChatExport() {
		t.Fatal("CancelChatExport() = true without a running export")
	}
	if _, err := service.ExportRoomChat("!team:example.org", t.TempDir()); err == nil {
		t.Fatal("ExportRoomChat() error = nil without an open account")
	}

	ctx, err := service.beginChatExport()
	if err != nil {
		t.Fatalf("beginChatExport() error = %v", err)
	}
	if _, err := service.beginChatExport(); err == nil {
		t.Fatal("second beginChatExport() succeeded while an export was running")
	}
	if !service.CancelChatExport() {
		t.Fatal("CancelChatExport() = false during an export")
	}
	if ctx.Err() == nil {
		t.Fatal("CancelChatExport() did not cancel the export context")
	}
	service.endChatExport()
	if _, err := service.beginChatExport(); err != nil {
		t.Fatalf("beginChatExport() after end error = %v", err)
	}
	service.endChatExport()
}
