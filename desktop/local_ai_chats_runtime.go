package desktop

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// SendRoomImage sends an image from GenerateRoomImage to roomID after the user approves it.
func (s *AppService) SendRoomImage(roomID, encoded string) error {
	if roomID == "" {
		return errors.New("select a room before sending an image")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("decode generated image: %w", err)
	}
	if len(data) == 0 {
		return errors.New("generated image is empty")
	}
	return s.sendAttachment(s.aiContext(), roomID, localAIImageName, data, false, false, 0)
}

// imageProgressFunc reports engine progress for requestID as local-ai:image-progress events. It returns nil when there is nothing to report.
func (s *AppService) imageProgressFunc(requestID string) func(imageEngineProgress) {
	if requestID == "" || s.emitLocalAIImageProgress == nil {
		return nil
	}
	return func(update imageEngineProgress) {
		s.emitLocalAIImageProgress(LocalAIImageProgressEvent{RequestID: requestID, Stage: update.Stage, Step: update.Step, TotalSteps: update.TotalSteps, Preview: update.Preview})
	}
}

// imageGenerationError maps engine cancellation and timeouts to the errors shown to the user.
func imageGenerationError(err error) error {
	if errors.Is(err, context.Canceled) {
		return errAIRunStopped
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("image generation timed out")
	}
	return err
}

func (s *AppService) localAIChatStoreForUse() (*localAIChatStore, error) {
	s.localAIChatMu.Lock()
	defer s.localAIChatMu.Unlock()
	if s.ctx != nil && s.ctx.Err() != nil {
		return nil, s.ctx.Err()
	}
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

func validateLocalAIFolderID(folderID string) error {
	if !localAIChatIDPattern.MatchString(folderID) {
		return errors.New("local AI folder id is invalid")
	}
	return nil
}

// normalizeLocalAIChatFolderName trims and collapses spaces, then checks the name length.
func normalizeLocalAIChatFolderName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		return "", errors.New("folder names cannot be empty")
	}
	if utf8.RuneCountInString(name) > localAIChatFolderNameLimit {
		return "", fmt.Errorf("folder names must be %d characters or fewer", localAIChatFolderNameLimit)
	}
	return name, nil
}

func validateLocalAIChatImage(image AIImage) (int, error) {
	switch image.MediaType {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
	default:
		return 0, errors.New("local AI chat images must be PNG, JPEG, GIF, or WebP")
	}
	data, err := base64.StdEncoding.DecodeString(image.Data)
	if err != nil || len(data) == 0 {
		return 0, errors.New("local AI chat image data must be valid base64")
	}
	if len(data) > localAIChatImageBytes {
		return 0, errors.New("local AI chat image exceeds the 8 MiB limit")
	}
	return len(data), nil
}

func validateLocalAIChatMessages(messages []AIMessage) error {
	imageBytes := 0
	for _, message := range messages {
		if message.Role != "user" && message.Role != "assistant" {
			return errors.New("local AI chat messages must be from the user or assistant")
		}
		if utf8.RuneCountInString(message.Content) > localAIChatMessageLimit {
			return fmt.Errorf("local AI chat messages must be %d characters or fewer", localAIChatMessageLimit)
		}
		if strings.TrimSpace(message.Content) == "" && len(message.Images) == 0 {
			return errors.New("local AI chat messages cannot be empty")
		}
		if message.Role == "assistant" && len(message.Images) > 0 {
			return errors.New("assistant messages cannot include images")
		}
		if len(message.Images) > localAIChatImageLimit {
			return fmt.Errorf("a message can include at most %d images", localAIChatImageLimit)
		}
		for _, image := range message.Images {
			imageSize, err := validateLocalAIChatImage(image)
			if err != nil {
				return err
			}
			imageBytes += imageSize
		}
	}
	if imageBytes > localAIChatImageInputLimit {
		return errors.New("local AI chat images exceeded the size limit")
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
