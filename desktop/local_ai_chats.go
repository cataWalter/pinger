package desktop

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	localAIChatFileName            = "local-ai-chats.db"
	localAIChatAttachmentLimit     = 8
	localAIChatTextAttachmentLimit = 32 << 10
	localAIChatNameLimit           = 255
	localAIChatTitleLimit          = 80
	localAIChatAgentIDLimit        = 64
	localAIChatExportLimit         = 8 << 20
)

var localAIChatIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// LocalAIChatSummary describes one saved local AI chat in the chat list.
type LocalAIChatSummary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	AgentID   string `json:"agentId"`
	UpdatedAt int64  `json:"updatedAt"`
	Preview   string `json:"preview"`
}

// LocalAIChatAttachment is one file attached to a saved chat turn. Text attachments carry their contents, images carry base64 data, and other files keep only metadata.
type LocalAIChatAttachment struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	MediaType string `json:"mediaType,omitempty"`
	Size      int64  `json:"size"`
	Text      string `json:"text,omitempty"`
	Data      string `json:"data,omitempty"`
}

// LocalAIChatMessage is one saved turn. Status is complete, or stopped when the user ended generation early.
type LocalAIChatMessage struct {
	Seq         int                     `json:"seq"`
	Role        string                  `json:"role"`
	Content     string                  `json:"content"`
	Status      string                  `json:"status"`
	Attachments []LocalAIChatAttachment `json:"attachments"`
	CreatedAt   int64                   `json:"createdAt"`
}

// ListLocalAIChats returns saved local AI chats, most recently updated first.
func (s *AppService) ListLocalAIChats() ([]LocalAIChatSummary, error) {
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return nil, err
	}
	return store.list()
}

// CreateLocalAIChat saves an empty chat that uses agentID, which may be empty.
func (s *AppService) CreateLocalAIChat(agentID string) (LocalAIChatSummary, error) {
	agentID = strings.TrimSpace(agentID)
	if utf8.RuneCountInString(agentID) > localAIChatAgentIDLimit {
		return LocalAIChatSummary{}, fmt.Errorf("agent ids must be %d characters or fewer", localAIChatAgentIDLimit)
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return LocalAIChatSummary{}, err
	}
	return store.create(agentID, time.Now().UnixMilli())
}

// LoadLocalAIChatMessages returns every saved turn of chatID in order.
func (s *AppService) LoadLocalAIChatMessages(chatID string) ([]LocalAIChatMessage, error) {
	if err := validateLocalAIChatID(chatID); err != nil {
		return nil, err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return nil, err
	}
	return store.messages(chatID)
}

// AppendLocalAIChatMessage saves one turn to chatID and returns it with its sequence number.
func (s *AppService) AppendLocalAIChatMessage(chatID string, message LocalAIChatMessage) (LocalAIChatMessage, error) {
	if err := validateLocalAIChatID(chatID); err != nil {
		return LocalAIChatMessage{}, err
	}
	if err := validateLocalAIChatMessageInput(&message); err != nil {
		return LocalAIChatMessage{}, err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return LocalAIChatMessage{}, err
	}
	return store.appendMessage(chatID, message, time.Now().UnixMilli())
}

// TruncateLocalAIChat removes the turn at fromSeq and every later turn, so an edited or regenerated turn can be resent.
func (s *AppService) TruncateLocalAIChat(chatID string, fromSeq int) error {
	if err := validateLocalAIChatID(chatID); err != nil {
		return err
	}
	if fromSeq < 1 {
		return errors.New("local AI chat sequence must be positive")
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.truncate(chatID, fromSeq, time.Now().UnixMilli())
}

// RenameLocalAIChat changes the sidebar title of chatID.
func (s *AppService) RenameLocalAIChat(chatID, title string) error {
	if err := validateLocalAIChatID(chatID); err != nil {
		return err
	}
	title = strings.Join(strings.Fields(title), " ")
	if title == "" {
		return errors.New("chat titles cannot be empty")
	}
	if utf8.RuneCountInString(title) > localAIChatTitleLimit {
		return fmt.Errorf("chat titles must be %d characters or fewer", localAIChatTitleLimit)
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.rename(chatID, title)
}

// SetLocalAIChatAgent changes the agent used for later turns of chatID.
func (s *AppService) SetLocalAIChatAgent(chatID, agentID string) error {
	if err := validateLocalAIChatID(chatID); err != nil {
		return err
	}
	agentID = strings.TrimSpace(agentID)
	if utf8.RuneCountInString(agentID) > localAIChatAgentIDLimit {
		return fmt.Errorf("agent ids must be %d characters or fewer", localAIChatAgentIDLimit)
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.setAgent(chatID, agentID)
}

// DeleteLocalAIChat removes chatID and all of its turns.
func (s *AppService) DeleteLocalAIChat(chatID string) error {
	if err := validateLocalAIChatID(chatID); err != nil {
		return err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.delete(chatID)
}

// ExportLocalAIChat writes a rendered transcript to a path chosen in a save dialog, or returns an empty path when cancelled.
func (s *AppService) ExportLocalAIChat(filename, content string) (string, error) {
	if content == "" || len(content) > localAIChatExportLimit {
		return "", errors.New("local AI chat export must contain between 1 byte and 8 MiB")
	}
	if s.chooseSavePath == nil {
		return "", errors.New("save dialog is unavailable")
	}
	directory := ""
	if home, err := os.UserHomeDir(); err == nil {
		directory = filepath.Join(home, "Downloads")
	}
	target, err := s.chooseSavePath(directory, safeDownloadName(filename))
	if err != nil {
		return "", err
	}
	if target == "" {
		return "", nil
	}
	if err := os.WriteFile(target, []byte(content), 0o600); err != nil {
		return "", fmt.Errorf("save local AI chat: %w", err)
	}
	return target, nil
}

func (s *AppService) localAIChatStoreForUse() (*localAIChatStore, error) {
	s.localAIChatMu.Lock()
	defer s.localAIChatMu.Unlock()
	if s.localAIChats != nil {
		return s.localAIChats, nil
	}
	if s.dataDir == "" {
		return nil, errors.New("local AI chat storage is not ready")
	}
	store, err := openLocalAIChatStore(filepath.Join(s.dataDir, localAIChatFileName))
	if err != nil {
		return nil, err
	}
	s.localAIChats = store
	return store, nil
}

func (s *AppService) closeLocalAIChatStore() {
	s.localAIChatMu.Lock()
	store := s.localAIChats
	s.localAIChats = nil
	s.localAIChatMu.Unlock()
	if err := store.close(); err != nil {
		log.Printf("close local AI chat database: %v", err)
	}
}

func validateLocalAIChatID(chatID string) error {
	if !localAIChatIDPattern.MatchString(chatID) {
		return errors.New("local AI chat id is invalid")
	}
	return nil
}

// validateLocalAIChatMessageInput checks a turn before it is saved and defaults an empty status to complete.
func validateLocalAIChatMessageInput(message *LocalAIChatMessage) error {
	if message.Role != "user" && message.Role != "assistant" {
		return errors.New("local AI chat messages must be from the user or assistant")
	}
	if message.Status == "" {
		message.Status = "complete"
	}
	if message.Status != "complete" && message.Status != "stopped" {
		return errors.New("local AI chat message status is invalid")
	}
	if utf8.RuneCountInString(message.Content) > localAIChatMessageLimit {
		return fmt.Errorf("local AI chat messages must be %d characters or fewer", localAIChatMessageLimit)
	}
	if strings.TrimSpace(message.Content) == "" && len(message.Attachments) == 0 {
		return errors.New("local AI chat messages cannot be empty")
	}
	if len(message.Attachments) > localAIChatAttachmentLimit {
		return fmt.Errorf("a message can include at most %d attachments", localAIChatAttachmentLimit)
	}
	if message.Role == "assistant" && len(message.Attachments) > 0 {
		return errors.New("assistant messages cannot include attachments")
	}
	imageCount := 0
	imageBytes := 0
	for _, attachment := range message.Attachments {
		size, err := validateLocalAIChatAttachment(attachment)
		if err != nil {
			return err
		}
		if attachment.Kind == "image" {
			imageCount++
		}
		imageBytes += size
	}
	if imageCount > localAIChatImageLimit {
		return fmt.Errorf("a message can include at most %d images", localAIChatImageLimit)
	}
	if imageBytes > localAIChatImageInputLimit {
		return errors.New("local AI chat images exceeded the size limit")
	}
	return nil
}

// validateLocalAIChatAttachment checks one attachment and returns the decoded size of its image data.
func validateLocalAIChatAttachment(attachment LocalAIChatAttachment) (int, error) {
	name := strings.TrimSpace(attachment.Name)
	if name == "" || len(name) > localAIChatNameLimit {
		return 0, fmt.Errorf("attachment names must be 1-%d bytes", localAIChatNameLimit)
	}
	if attachment.Size < 0 {
		return 0, errors.New("attachment size is invalid")
	}
	switch attachment.Kind {
	case "image":
		return validateLocalAIChatImage(AIImage{MediaType: attachment.MediaType, Data: attachment.Data})
	case "text":
		if len(attachment.Text) > localAIChatTextAttachmentLimit {
			return 0, fmt.Errorf("text attachments must be %d KiB or smaller", localAIChatTextAttachmentLimit>>10)
		}
		return 0, nil
	case "file":
		return 0, nil
	default:
		return 0, errors.New("attachment kind must be image, text, or file")
	}
}

// localAIChatTitle derives a sidebar title from the first user turn.
func localAIChatTitle(content string, attachments []LocalAIChatAttachment) string {
	text := strings.Join(strings.Fields(content), " ")
	if text == "" && len(attachments) > 0 {
		text = attachments[0].Name
	}
	runes := []rune(text)
	if len(runes) > localAIChatTitleLimit {
		return strings.TrimSpace(string(runes[:localAIChatTitleLimit-1])) + "…"
	}
	return text
}
