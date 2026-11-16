package desktop

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

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

// ListLocalAIChatFolders returns folders in creation order.
func (s *AppService) ListLocalAIChatFolders() ([]LocalAIChatFolder, error) {
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return nil, err
	}
	return store.listFolders()
}

// CreateLocalAIChatFolder saves a folder that chats can be filed into.
func (s *AppService) CreateLocalAIChatFolder(name string) (LocalAIChatFolder, error) {
	name, err := normalizeLocalAIChatFolderName(name)
	if err != nil {
		return LocalAIChatFolder{}, err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return LocalAIChatFolder{}, err
	}
	return store.createFolder(name, time.Now().UnixMilli())
}

// RenameLocalAIChatFolder changes the name of folderID.
func (s *AppService) RenameLocalAIChatFolder(folderID, name string) error {
	if err := validateLocalAIFolderID(folderID); err != nil {
		return err
	}
	name, err := normalizeLocalAIChatFolderName(name)
	if err != nil {
		return err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.renameFolder(folderID, name)
}

// DeleteLocalAIChatFolder removes folderID. Its chats are kept and become unfiled.
func (s *AppService) DeleteLocalAIChatFolder(folderID string) error {
	if err := validateLocalAIFolderID(folderID); err != nil {
		return err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.deleteFolder(folderID)
}

// SetLocalAIChatFolder files chatID into folderID, or unfiles it when folderID is empty.
func (s *AppService) SetLocalAIChatFolder(chatID, folderID string) error {
	if err := validateLocalAIChatID(chatID); err != nil {
		return err
	}
	folderID = strings.TrimSpace(folderID)
	if folderID != "" {
		if err := validateLocalAIFolderID(folderID); err != nil {
			return err
		}
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return err
	}
	return store.setChatFolder(chatID, folderID)
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

// LocalAIChatRequest is one conversation sent to the local model. AgentInstructions are appended to the system prompt.
type LocalAIChatRequest struct {
	Messages          []AIMessage `json:"messages"`
	RequestID         string      `json:"requestId"`
	AgentInstructions string      `json:"agentInstructions,omitempty"`
}

// LocalAIChatStreamEvent is one streamed text delta for the reply identified by RequestID.
type LocalAIChatStreamEvent struct {
	RequestID string `json:"requestId"`
	Text      string `json:"text"`
}

// LocalAIChat returns the assistant reply to request. Text deltas are emitted as local-ai:stream events while it runs, and AICancel with the same RequestID stops it.
func (s *AppService) LocalAIChat(request LocalAIChatRequest) (string, error) {
	if err := validateLocalAIChatMessages(request.Messages); err != nil {
		return "", err
	}
	agentInstructions := strings.TrimSpace(request.AgentInstructions)
	if utf8.RuneCountInString(agentInstructions) > localAIChatAgentLimit {
		return "", fmt.Errorf("agent instructions must be %d characters or fewer", localAIChatAgentLimit)
	}
	preferences := s.preferenceValues()
	provider, endpoint, model, err := aiModelConfig(preferences)
	if err != nil {
		return "", err
	}
	tuning := aiFeatureTuningFor(preferences, aiFeatureLocalChat)
	systemPrompt := tuning.Prompt
	if agentInstructions != "" {
		systemPrompt += "\n\nAgent instructions:\n" + agentInstructions
	}
	conversation := make([]AIMessage, 0, len(request.Messages)+1)
	conversation = append(conversation, AIMessage{Role: "system", Content: systemPrompt})
	conversation = append(conversation, request.Messages...)

	ctx, release := s.aiRuns.begin(s.aiContext(), request.RequestID)
	defer release()
	ctx, cancel := context.WithTimeout(ctx, localAIChatTimeout)
	defer cancel()

	var onChunk func(string)
	if request.RequestID != "" && s.emitLocalAIChatStream != nil {
		onChunk = func(text string) {
			s.emitLocalAIChatStream(LocalAIChatStreamEvent{RequestID: request.RequestID, Text: text})
		}
	}
	thinkingLevel := stringPreference(preferences, aiThinkingLevelPreference, aiThinkingLevelDefault)
	reply, err := runLocalAICompletion(ctx, aiLocalHTTPClient, provider, endpoint, model, conversation, localAIChatCompletionOptions(tuning, thinkingLevel), onChunk)
	if err != nil && ctx.Err() == context.Canceled {
		return "", errAIRunStopped
	}
	if err != nil && ctx.Err() == context.DeadlineExceeded {
		return "", errors.New("local AI reply timed out")
	}
	return reply, err
}

// localAIChatCompletionOptions builds sampling and thinking settings for chat replies.
func localAIChatCompletionOptions(tuning aiFeatureTuning, thinkingLevel string) aiCompletionOptions {
	maxTokens := tuning.MaxTokens
	if maxTokens <= 0 {
		maxTokens = localAIChatDefaultMaxTokens
	}
	return aiCompletionOptions{
		Temperature:        tuning.Temperature,
		MaxTokens:          maxTokens,
		Chat:               true,
		MaxResponseBytes:   localAIChatResponseBytes,
		ChatTemplateKwargs: aiThinkingOptions(thinkingLevel),
	}
}

// LocalAIImageProgressEvent is one image generation update for RequestID. Stage is starting while the engine loads, then generating with Step of TotalSteps and an optional base64 PNG Preview.
type LocalAIImageProgressEvent struct {
	RequestID  string `json:"requestId"`
	Stage      string `json:"stage"`
	Step       int    `json:"step"`
	TotalSteps int    `json:"totalSteps"`
	Preview    string `json:"preview,omitempty"`
}

// LocalAIChatGenerateImage generates an image from prompt with the local image engine and saves the prompt and the image to chatID as two turns. Progress is emitted as local-ai:image-progress events, and AICancel with the same RequestID stops generation.
func (s *AppService) LocalAIChatGenerateImage(chatID, prompt, requestID string) ([]LocalAIChatMessage, error) {
	if err := validateLocalAIChatID(chatID); err != nil {
		return nil, err
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, errors.New("describe the image to generate")
	}
	if utf8.RuneCountInString(prompt) > localAIChatMessageLimit {
		return nil, fmt.Errorf("local AI chat messages must be %d characters or fewer", localAIChatMessageLimit)
	}
	settings, err := imageSettingsFromPreferences(s.preferenceValues())
	if err != nil {
		return nil, err
	}
	store, err := s.localAIChatStoreForUse()
	if err != nil {
		return nil, err
	}
	if err := store.requireChat(chatID); err != nil {
		return nil, err
	}

	ctx, release := s.aiRuns.begin(s.aiContext(), requestID)
	defer release()
	image, err := s.imageEngine.generate(ctx, settings, prompt, s.imageProgressFunc(requestID))
	if err != nil {
		return nil, imageGenerationError(err)
	}

	// Assistant images are written only here. The public append path still rejects assistant attachments.
	imageAttachment := LocalAIChatAttachment{Name: localAIImageName, Kind: "image", MediaType: "image/png", Data: image}
	imageSize, err := validateLocalAIChatAttachment(imageAttachment)
	if err != nil {
		return nil, err
	}
	imageAttachment.Size = int64(imageSize)
	userTurn := LocalAIChatMessage{Role: "user", Content: prompt, Status: "complete", Attachments: []LocalAIChatAttachment{}}
	assistantTurn := LocalAIChatMessage{Role: "assistant", Status: "complete", Attachments: []LocalAIChatAttachment{imageAttachment}}
	return store.appendMessages(chatID, []LocalAIChatMessage{userTurn, assistantTurn}, time.Now().UnixMilli())
}

// GenerateRoomImage returns a base64 PNG for review and sends nothing. AICancel with the same requestID stops it.
func (s *AppService) GenerateRoomImage(prompt, requestID string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", errors.New("describe the image to generate")
	}
	if utf8.RuneCountInString(prompt) > localAIChatMessageLimit {
		return "", fmt.Errorf("prompts must be %d characters or fewer", localAIChatMessageLimit)
	}
	settings, err := imageSettingsFromPreferences(s.preferenceValues())
	if err != nil {
		return "", err
	}

	ctx, release := s.aiRuns.begin(s.aiContext(), requestID)
	defer release()
	encoded, err := s.imageEngine.generate(ctx, settings, prompt, s.imageProgressFunc(requestID))
	if err != nil {
		return "", imageGenerationError(err)
	}
	if _, err := base64.StdEncoding.DecodeString(encoded); err != nil {
		return "", fmt.Errorf("decode generated image: %w", err)
	}
	return encoded, nil
}
