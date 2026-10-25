package desktop

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mychat/matrix"
)

type fakeChatExportSource struct {
	messages   []matrix.Message
	historyErr error
	files      map[string][]byte
	// cancel is called on the first download to simulate the user cancelling mid-export.
	cancel context.CancelFunc
}

func (f *fakeChatExportSource) RoomHistory(ctx context.Context, roomID string) ([]matrix.Message, error) {
	if f.historyErr != nil {
		return nil, f.historyErr
	}
	return f.messages, nil
}

func (f *fakeChatExportSource) DownloadAttachment(ctx context.Context, attachment matrix.MediaAttachment) ([]byte, error) {
	if f.cancel != nil {
		f.cancel()
		return nil, context.Canceled
	}
	data, ok := f.files[attachment.URI]
	if !ok {
		return nil, errors.New("download failed")
	}
	return data, nil
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

func TestExportRoomChatWritesTranscriptAndMedia(t *testing.T) {
	parent := t.TempDir()
	source := &fakeChatExportSource{
		messages: chatExportTestMessages(),
		files:    map[string][]byte{"mxc://example.org/photo": []byte("jpeg-bytes")},
	}
	var reports []ChatExportProgress
	result, err := exportRoomChat(context.Background(), source, "!team:example.org", "Team", parent, chatExportTestTime, func(progress ChatExportProgress) {
		reports = append(reports, progress)
	})
	if err != nil {
		t.Fatalf("exportRoomChat() error = %v", err)
	}
	if result.Messages != 3 || result.Media != 1 || result.MediaFailed != 1 {
		t.Fatalf("result = %+v, want 3 messages, 1 media saved, 1 media failed", result)
	}
	if filepath.Base(result.Path) != chatExportTranscriptName {
		t.Fatalf("transcript path = %q, want %s", result.Path, chatExportTranscriptName)
	}
	dir := filepath.Dir(result.Path)
	if filepath.Dir(dir) != parent || !strings.HasPrefix(filepath.Base(dir), "Team chat 2026-10-25 0930") {
		t.Fatalf("export folder = %q, want a \"Team chat\" folder inside %q", dir, parent)
	}

	photo, err := os.ReadFile(filepath.Join(dir, "media", "0001-photo.jpg"))
	if err != nil || string(photo) != "jpeg-bytes" {
		t.Fatalf("saved photo = %q, %v", photo, err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "media"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("media folder has %d files, want only the saved photo", len(entries))
	}

	transcript, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	page := string(transcript)
	for _, want := range []string{
		"hello &lt;b&gt;team&lt;/b&gt;<br>",
		`<img src="media/0001-photo.jpg" alt="photo.jpg">`,
		"Media not saved: clip.mp4",
		"Message deleted",
		"👍 2",
	} {
		if !strings.Contains(page, want) {
			t.Errorf("transcript missing %q", want)
		}
	}

	if len(reports) == 0 {
		t.Fatal("no progress reported")
	}
	last := reports[len(reports)-1]
	if last.Stage != chatExportStageFinishing || last.MediaDone != 2 || last.MediaTotal != 2 {
		t.Fatalf("last progress = %+v, want finishing with 2 of 2 media", last)
	}
}

func TestExportRoomChatRemovesPartialFolderWhenCancelled(t *testing.T) {
	parent := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := &fakeChatExportSource{messages: chatExportTestMessages(), cancel: cancel}

	_, err := exportRoomChat(ctx, source, "!team:example.org", "Team", parent, chatExportTestTime, func(ChatExportProgress) {})
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

func TestExportRoomChatReturnsHistoryErrorWithoutCreatingFolder(t *testing.T) {
	parent := t.TempDir()
	historyErr := errors.New("timeline unavailable")
	source := &fakeChatExportSource{historyErr: historyErr}

	_, err := exportRoomChat(context.Background(), source, "!team:example.org", "Team", parent, chatExportTestTime, func(ChatExportProgress) {})
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

func TestCreateChatExportFolderAddsSuffixOnCollision(t *testing.T) {
	parent := t.TempDir()
	first, err := createChatExportFolder(parent, "Team/Ops", chatExportTestTime)
	if err != nil {
		t.Fatal(err)
	}
	second, err := createChatExportFolder(parent, "Team/Ops", chatExportTestTime)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(first) != "Team-Ops chat 2026-10-25 0930" {
		t.Fatalf("first folder = %q", filepath.Base(first))
	}
	if filepath.Base(second) != "Team-Ops chat 2026-10-25 0930 (1)" {
		t.Fatalf("second folder = %q", filepath.Base(second))
	}
}

func TestChatExportMediaFileName(t *testing.T) {
	tests := []struct {
		name     string
		mimeType string
		want     string
	}{
		{name: "photo.jpg", mimeType: "image/jpeg", want: "0003-photo.jpg"},
		{name: "", mimeType: "image/png", want: "0003-media.png"},
		{name: "a#b%c.pdf", mimeType: "application/pdf", want: "0003-a-b-c.pdf"},
		{name: "notes", mimeType: "application/pdf", want: "0003-notes.pdf"},
		{name: "clip", mimeType: "video/quicktime", want: "0003-clip.mov"},
		{name: "readme", mimeType: "image/unknown", want: "0003-readme"},
	}
	for _, test := range tests {
		if got := chatExportMediaFileName(3, test.name, test.mimeType); got != test.want {
			t.Errorf("chatExportMediaFileName(3, %q, %q) = %q, want %q", test.name, test.mimeType, got, test.want)
		}
	}
}

func TestRenderChatExportHTMLEscapesNames(t *testing.T) {
	entries := []chatExportEntry{{
		Message: matrix.Message{
			Sender:     "@x:example.org",
			SenderName: `"Ann" & <Co>`,
			Body:       "<script>alert(1)</script>",
		},
	}}
	page := renderChatExportHTML("<Team>", chatExportTestTime, entries)
	for _, want := range []string{
		"&lt;Team&gt;",
		"&#34;Ann&#34; &amp; &lt;Co&gt;",
		"&lt;script&gt;alert(1)&lt;/script&gt;",
	} {
		if !strings.Contains(page, want) {
			t.Errorf("page missing %q", want)
		}
	}
	if strings.Contains(page, "<script>") {
		t.Fatal("page contains an unescaped script tag")
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
