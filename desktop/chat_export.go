package desktop

import (
	"context"
	"errors"
	"fmt"
	"html"
	"mime"
	"mychat/matrix"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
)

const chatExportProgressEventName = "chat-export:progress"

const (
	chatExportStageHistory   = "history"
	chatExportStageMedia     = "media"
	chatExportStageFinishing = "finishing"
	chatExportTranscriptName = "chat.html"
	chatExportMediaDirName   = "media"
	chatExportLabelRunes     = 80
	chatExportStemRunes      = 100
)

var errChatExportCancelled = errors.New("chat export was cancelled")

// chatExportPreferredExtensions overrides mime.ExtensionsByType, which lists alternatives such as ".jpe" first.
var chatExportPreferredExtensions = map[string]string{
	"image/jpeg":      ".jpg",
	"audio/mpeg":      ".mp3",
	"audio/ogg":       ".ogg",
	"video/quicktime": ".mov",
}

// ChatExportProgress reports the current stage of a room export.
type ChatExportProgress struct {
	RoomID     string `json:"roomId"`
	Stage      string `json:"stage"`
	Messages   int    `json:"messages"`
	MediaDone  int    `json:"mediaDone"`
	MediaTotal int    `json:"mediaTotal"`
}

// ChatExportResult describes a finished room export.
type ChatExportResult struct {
	Path        string `json:"path"`
	Messages    int    `json:"messages"`
	Media       int    `json:"media"`
	MediaFailed int    `json:"mediaFailed"`
}

type chatExportSource interface {
	RoomHistory(ctx context.Context, roomID string) ([]matrix.Message, error)
	DownloadAttachment(ctx context.Context, attachment matrix.MediaAttachment) ([]byte, error)
}

type chatExportAttachment struct {
	Name string
	MIME string
	// Path is relative to the export folder and empty when the file could not be saved.
	Path string
}

type chatExportEntry struct {
	Message     matrix.Message
	Attachments []chatExportAttachment
}

// ExportRoomChat saves a room's full history and media into a new folder inside parentDirectory and returns the transcript path.
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
	for _, room := range client.Rooms() {
		if room.ID == roomID {
			roomName = room.Name
			break
		}
	}
	ctx, err := s.beginChatExport()
	if err != nil {
		return ChatExportResult{}, err
	}
	defer s.endChatExport()
	result, err := exportRoomChat(ctx, client, roomID, roomName, parentDirectory, time.Now(), s.reportChatExportProgress)
	if err != nil && ctx.Err() != nil {
		return ChatExportResult{}, errChatExportCancelled
	}
	return result, err
}

// CancelChatExport stops the running room export and removes its partial folder. It returns false when no export is running.
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

// exportRoomChat writes chat.html and a media folder into a new folder under parentDirectory. The folder is removed when the export fails.
func exportRoomChat(ctx context.Context, source chatExportSource, roomID, roomName, parentDirectory string, exportedAt time.Time, report func(ChatExportProgress)) (result ChatExportResult, err error) {
	report(ChatExportProgress{RoomID: roomID, Stage: chatExportStageHistory})
	messages, err := source.RoomHistory(ctx, roomID)
	if err != nil {
		return ChatExportResult{}, err
	}
	mediaTotal := 0
	for _, message := range messages {
		mediaTotal += len(message.MediaAttachments())
	}

	dir, err := createChatExportFolder(parentDirectory, roomName, exportedAt)
	if err != nil {
		return ChatExportResult{}, err
	}
	defer func() {
		if err != nil {
			os.RemoveAll(dir)
		}
	}()
	mediaDir := filepath.Join(dir, chatExportMediaDirName)
	if mediaTotal > 0 {
		if err = os.Mkdir(mediaDir, 0o700); err != nil {
			return ChatExportResult{}, fmt.Errorf("create chat media folder: %w", err)
		}
	}

	media, failed, sequence := 0, 0, 0
	entries := make([]chatExportEntry, 0, len(messages))
	for _, message := range messages {
		entry := chatExportEntry{Message: message}
		for _, attachment := range message.MediaAttachments() {
			if ctx.Err() != nil {
				return ChatExportResult{}, errChatExportCancelled
			}
			sequence++
			report(ChatExportProgress{RoomID: roomID, Stage: chatExportStageMedia, Messages: len(messages), MediaDone: media + failed, MediaTotal: mediaTotal})
			item := chatExportAttachment{Name: attachment.Name, MIME: attachment.MIME}
			if item.Name == "" {
				item.Name = "attachment"
			}
			data, downloadErr := source.DownloadAttachment(ctx, attachment)
			if ctx.Err() != nil {
				return ChatExportResult{}, errChatExportCancelled
			}
			if downloadErr != nil || len(data) == 0 {
				failed++
			} else {
				fileName := chatExportMediaFileName(sequence, attachment.Name, attachment.MIME)
				if err = os.WriteFile(filepath.Join(mediaDir, fileName), data, 0o600); err != nil {
					return ChatExportResult{}, fmt.Errorf("save chat media: %w", err)
				}
				item.Path = chatExportMediaDirName + "/" + fileName
				media++
			}
			entry.Attachments = append(entry.Attachments, item)
		}
		entries = append(entries, entry)
	}

	report(ChatExportProgress{RoomID: roomID, Stage: chatExportStageFinishing, Messages: len(messages), MediaDone: media + failed, MediaTotal: mediaTotal})
	transcriptPath := filepath.Join(dir, chatExportTranscriptName)
	if err = os.WriteFile(transcriptPath, []byte(renderChatExportHTML(roomName, exportedAt, entries)), 0o600); err != nil {
		return ChatExportResult{}, fmt.Errorf("write chat export: %w", err)
	}
	return ChatExportResult{Path: transcriptPath, Messages: len(messages), Media: media, MediaFailed: failed}, nil
}

// createChatExportFolder creates "<room> chat <date time>" in parent, adding " (n)" when the name is taken.
func createChatExportFolder(parent, roomName string, at time.Time) (string, error) {
	base := exportNameLabel(roomName) + " chat " + at.Format("2006-01-02 1504")
	for i := 0; i < 1000; i++ {
		name := base
		if i > 0 {
			name = fmt.Sprintf("%s (%d)", base, i)
		}
		dir := filepath.Join(parent, name)
		err := os.Mkdir(dir, 0o700)
		if err == nil {
			return dir, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", fmt.Errorf("create chat export folder: %w", err)
		}
	}
	return "", errors.New("could not find a free chat export folder name")
}

func exportNameLabel(name string) string {
	label := sanitizeExportName(name)
	if label == "" {
		return "Room"
	}
	return clipExportRunes(label, chatExportLabelRunes)
}

// chatExportMediaFileName returns a unique, filesystem-safe name such as "0003-photo.jpg".
func chatExportMediaFileName(sequence int, name, mimeType string) string {
	ext := sanitizeExportName(filepath.Ext(name))
	stem := strings.TrimLeft(sanitizeExportName(strings.TrimSuffix(name, filepath.Ext(name))), ".")
	if len(ext) < 2 {
		ext = chatExportExtension(mimeType)
	}
	if stem == "" {
		stem = chatExportMediaDirName
	}
	return fmt.Sprintf("%04d-%s%s", sequence, clipExportRunes(stem, chatExportStemRunes), ext)
}

func chatExportExtension(mimeType string) string {
	if ext, ok := chatExportPreferredExtensions[mimeType]; ok {
		return ext
	}
	if extensions, err := mime.ExtensionsByType(mimeType); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	return ""
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

func renderChatExportHTML(roomName string, exportedAt time.Time, entries []chatExportEntry) string {
	title := roomName
	if title == "" {
		title = "Chat export"
	}
	var b strings.Builder
	b.WriteString("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>")
	b.WriteString(html.EscapeString(title))
	b.WriteString("</title>\n<style>")
	b.WriteString(chatExportCSS)
	b.WriteString("</style>\n</head>\n<body>\n<div class=\"masthead\"><h1>")
	b.WriteString(html.EscapeString(title))
	b.WriteString("</h1><p>")
	fmt.Fprintf(&b, "%d messages, exported %s", len(entries), html.EscapeString(exportedAt.Format("2006-01-02 15:04")))
	b.WriteString("</p></div>\n<main>\n")
	for _, entry := range entries {
		writeChatExportMessage(&b, entry)
	}
	b.WriteString("</main>\n</body>\n</html>\n")
	return b.String()
}

func writeChatExportMessage(b *strings.Builder, entry chatExportEntry) {
	message := entry.Message
	sender := message.SenderName
	if sender == "" {
		sender = message.Sender
	}
	class := "message"
	if message.Own {
		class += " own"
	}
	fmt.Fprintf(b, "<article class=\"%s\">\n<div class=\"meta\"><span class=\"sender\">%s</span>", class, html.EscapeString(sender))
	if !message.Timestamp.IsZero() {
		fmt.Fprintf(b, "<time>%s</time>", html.EscapeString(message.Timestamp.Local().Format("2006-01-02 15:04")))
	}
	b.WriteString("</div>\n")
	if message.ReplyToEventID != "" {
		fmt.Fprintf(b, "<blockquote class=\"reply\"><strong>%s</strong> %s</blockquote>\n", html.EscapeString(message.ReplyToSender), html.EscapeString(message.ReplyToPreview))
	}
	for _, attachment := range entry.Attachments {
		writeChatExportAttachment(b, attachment)
	}
	if text := chatExportMessageText(entry); text != "" {
		fmt.Fprintf(b, "<p class=\"text\">%s</p>\n", strings.ReplaceAll(html.EscapeString(text), "\n", "<br>\n"))
	}
	if len(message.Reactions) > 0 {
		keys := make([]string, 0, len(message.Reactions))
		for key := range message.Reactions {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		b.WriteString("<p class=\"reactions\">")
		for i, key := range keys {
			if i > 0 {
				b.WriteString(" ")
			}
			fmt.Fprintf(b, "%s %d", html.EscapeString(key), message.Reactions[key])
		}
		b.WriteString("</p>\n")
	}
	b.WriteString("</article>\n")
}

func chatExportMessageText(entry chatExportEntry) string {
	message := entry.Message
	switch {
	case message.Redacted:
		return "Message deleted"
	case message.DecryptionError != "":
		return "Unable to decrypt message: " + message.DecryptionError
	}
	if len(entry.Attachments) == 1 && message.Body == entry.Attachments[0].Name {
		return ""
	}
	text := message.Body
	if message.Edited {
		text += " (edited)"
	}
	return text
}

func writeChatExportAttachment(b *strings.Builder, attachment chatExportAttachment) {
	name := html.EscapeString(attachment.Name)
	if attachment.Path == "" {
		fmt.Fprintf(b, "<p class=\"missing\">Media not saved: %s</p>\n", name)
		return
	}
	src := html.EscapeString(attachment.Path)
	switch {
	case strings.HasPrefix(attachment.MIME, "image/"):
		fmt.Fprintf(b, "<img src=\"%s\" alt=\"%s\">\n", src, name)
	case strings.HasPrefix(attachment.MIME, "video/"):
		fmt.Fprintf(b, "<video controls src=\"%s\"></video>\n", src)
	case strings.HasPrefix(attachment.MIME, "audio/"):
		fmt.Fprintf(b, "<audio controls src=\"%s\"></audio>\n", src)
	default:
		fmt.Fprintf(b, "<p class=\"file\"><a href=\"%s\">%s</a></p>\n", src, name)
	}
}

const chatExportCSS = `
body { margin: 0; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #1d2025; }
.masthead { padding: 20px 24px; background: #fff; border-bottom: 1px solid #d8dce2; }
.masthead h1 { margin: 0 0 4px; font-size: 20px; }
.masthead p { margin: 0; color: #5f6670; font-size: 13px; }
main { max-width: 760px; margin: 0 auto; padding: 16px 24px 48px; }
article { margin: 8px 0; padding: 10px 12px; background: #fff; border-radius: 10px; }
article.own { background: #eaf2ff; }
.meta { font-size: 13px; }
.sender { font-weight: 600; }
time { margin-left: 8px; color: #5f6670; }
.text { margin: 6px 0 0; overflow-wrap: anywhere; }
.reply { margin: 6px 0; padding-left: 10px; border-left: 3px solid #b8c0cc; color: #5f6670; }
.reactions { margin: 6px 0 0; font-size: 13px; }
.missing { margin: 6px 0 0; color: #9a3412; font-style: italic; }
.file { margin: 6px 0 0; }
img, video { display: block; max-width: 100%; max-height: 480px; margin-top: 6px; border-radius: 8px; }
audio { display: block; margin-top: 6px; }
@media (prefers-color-scheme: dark) {
  body { background: #16181c; color: #e6e8eb; }
  .masthead, article { background: #22252b; }
  .masthead { border-color: #32363e; }
  article.own { background: #243047; }
  .masthead p, time, .reply { color: #9aa3ad; }
}
`
