package desktop

import (
	"context"
	"errors"
	"fmt"
	"mychat/matrix"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

const chatExportProgressEventName = "chat-export:progress"

const (
	chatExportStageHistory   = "history"
	chatExportStageFinishing = "finishing"
	chatExportFileExt        = ".txt"
	chatExportLabelRunes     = 80
)

var errChatExportCancelled = errors.New("chat export was cancelled")

// ChatExportProgress reports the current stage of a room export.
type ChatExportProgress struct {
	RoomID   string `json:"roomId"`
	Stage    string `json:"stage"`
	Messages int    `json:"messages"`
}

// ChatExportResult describes a finished room export.
type ChatExportResult struct {
	Path     string `json:"path"`
	Messages int    `json:"messages"`
}

type chatExportSource interface {
	RoomHistory(ctx context.Context, roomID string) ([]matrix.Message, error)
}

// ExportRoomChat saves a room's full history as a text file inside parentDirectory and returns the file path.
func (s *AppService) ExportRoomChat(roomID, parentDirectory string) (ChatExportResult, error) {
	client := s.currentClient()
	if client == nil {
		return ChatExportResult{}, errors.New("no account is open")
	}
	if roomID == "" {
		return ChatExportResult{}, errors.New("chat export needs a room")
	}
	if !filepath.IsAbs(parentDirectory) {
		return ChatExportResult{}, errors.New("chat export needs an absolute folder path")
	}
	info, err := os.Stat(parentDirectory)
	if err != nil {
		return ChatExportResult{}, fmt.Errorf("chat export folder: %w", err)
	}
	if !info.IsDir() {
		return ChatExportResult{}, errors.New("chat export needs a folder")
	}
	roomName := ""
	direct := false
	for _, room := range client.Rooms() {
		if room.ID == roomID {
			roomName = room.Name
			direct = room.Direct
			break
		}
	}
	ctx, err := s.beginChatExport()
	if err != nil {
		return ChatExportResult{}, err
	}
	defer s.endChatExport()
	result, err := exportRoomChat(ctx, client, roomID, roomName, direct, parentDirectory, time.Now(), s.reportChatExportProgress)
	if err != nil && ctx.Err() != nil {
		return ChatExportResult{}, errChatExportCancelled
	}
	return result, err
}

// CancelChatExport stops the running export. A single-room export writes nothing when cancelled; a bulk export keeps the chats already written. It returns false when no export is running.
func (s *AppService) CancelChatExport() bool {
	s.chatExportMu.Lock()
	defer s.chatExportMu.Unlock()
	if s.chatExportCancel == nil {
		return false
	}
	s.chatExportCancel()
	return true
}

func (s *AppService) beginChatExport() (context.Context, error) {
	s.chatExportMu.Lock()
	defer s.chatExportMu.Unlock()
	if s.chatExportCancel != nil {
		return nil, errors.New("a chat export is already running")
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	s.chatExportCancel = cancel
	return ctx, nil
}

func (s *AppService) endChatExport() {
	s.chatExportMu.Lock()
	cancel := s.chatExportCancel
	s.chatExportCancel = nil
	s.chatExportMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *AppService) reportChatExportProgress(progress ChatExportProgress) {
	if s.emitChatExportProgress != nil {
		s.emitChatExportProgress(progress)
	}
}

// exportRoomChat writes the room's history as one text file under parentDirectory.
func exportRoomChat(ctx context.Context, source chatExportSource, roomID, roomName string, direct bool, parentDirectory string, exportedAt time.Time, report func(ChatExportProgress)) (ChatExportResult, error) {
	report(ChatExportProgress{RoomID: roomID, Stage: chatExportStageHistory})
	messages, err := source.RoomHistory(ctx, roomID)
	if err != nil {
		return ChatExportResult{}, err
	}
	if ctx.Err() != nil {
		return ChatExportResult{}, errChatExportCancelled
	}
	report(ChatExportProgress{RoomID: roomID, Stage: chatExportStageFinishing, Messages: len(messages)})
	path, err := uniqueExportFilePath(parentDirectory, exportNameLabel(roomName)+" chat "+exportedAt.Format("2006-01-02 1504"))
	if err != nil {
		return ChatExportResult{}, err
	}
	if err := os.WriteFile(path, []byte(renderChatExportText(messages, direct)), 0o600); err != nil {
		os.Remove(path)
		return ChatExportResult{}, fmt.Errorf("write chat export: %w", err)
	}
	return ChatExportResult{Path: path, Messages: len(messages)}, nil
}

// uniqueExportFilePath returns dir/label.txt, adding " (n)" when that file already exists.
func uniqueExportFilePath(dir, label string) (string, error) {
	for i := 0; i < 1000; i++ {
		name := label + chatExportFileExt
		if i > 0 {
			name = fmt.Sprintf("%s (%d)%s", label, i, chatExportFileExt)
		}
		path := filepath.Join(dir, name)
		_, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			return path, nil
		}
		if err != nil {
			return "", fmt.Errorf("check chat export file: %w", err)
		}
	}
	return "", errors.New("could not find a free chat export file name")
}

func exportNameLabel(name string) string {
	label := sanitizeExportName(name)
	if label == "" {
		return "Room"
	}
	return clipExportRunes(label, chatExportLabelRunes)
}

// sanitizeExportName replaces path separators, reserved characters, and control characters, then collapses whitespace.
func sanitizeExportName(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case unicode.IsControl(r):
			b.WriteRune(' ')
		case strings.ContainsRune(`/\:*?"<>|#%`, r):
			b.WriteRune('-')
		default:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func clipExportRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// renderChatExportText writes one "label: text" line per message, without timestamps.
func renderChatExportText(messages []matrix.Message, direct bool) string {
	var b strings.Builder
	for _, message := range messages {
		fmt.Fprintf(&b, "%s: %s\n", chatExportSenderLabel(message, direct), chatExportMessageText(message))
	}
	return b.String()
}

// chatExportSenderLabel is "me" for your messages, "them" in 1:1 chats, and the sender name otherwise.
func chatExportSenderLabel(message matrix.Message, direct bool) string {
	switch {
	case message.Own:
		return "me"
	case direct:
		return "them"
	case message.SenderName != "":
		return message.SenderName
	}
	// Group members without a display name show the local part of their Matrix ID.
	localPart, _, _ := strings.Cut(strings.TrimPrefix(message.Sender, "@"), ":")
	return localPart
}

// chatExportMessageText returns the message body, or a placeholder for deleted and undecryptable messages.
func chatExportMessageText(message matrix.Message) string {
	switch {
	case message.Redacted:
		return "Message deleted"
	case message.DecryptionError != "":
		return "Unable to decrypt message: " + message.DecryptionError
	}
	return message.Body
}
