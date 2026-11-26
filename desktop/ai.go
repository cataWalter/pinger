package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"path"
	"strings"
	"time"

	"mychat/matrix"
)

const (
	aiCompletionTimeout    = 60 * time.Second
	aiMaxCompletionTimeout = 10 * time.Minute
	aiHealthTimeout        = 10 * time.Second
	aiTranscriptionTimeout = 5 * time.Minute
	aiTranscodeTimeout     = 2 * time.Minute
	aiMaxAudioBytes        = 50 << 20
	aiMaxResponseBytes     = 4 << 20
)

// aiFFmpegFallbackPaths covers Homebrew installs when the app is launched outside a shell with Homebrew on PATH.
var aiFFmpegFallbackPaths = []string{"/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"}

// AIImage is one base64-encoded image sent with a chat turn.
type AIImage struct {
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

// AIMessage is one chat turn sent to the local model.
type AIMessage struct {
	Role    string    `json:"role"`
	Content string    `json:"content"`
	Images  []AIImage `json:"images,omitempty"`
}

type aiChatRequest struct {
	Model              string            `json:"model,omitempty"`
	Messages           []aiOpenAIMessage `json:"messages"`
	Stream             bool              `json:"stream"`
	Temperature        float64           `json:"temperature"`
	TopP               float64           `json:"top_p"`
	TopK               int               `json:"top_k,omitempty"`
	MaxTokens          int               `json:"max_tokens,omitempty"`
	Stop               []string          `json:"stop,omitempty"`
	ResponseFormat     json.RawMessage   `json:"response_format,omitempty"`
	ChatTemplateKwargs map[string]any    `json:"chat_template_kwargs,omitempty"`
}

type aiChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type aiTranscriptionResponse struct {
	Text  string `json:"text"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func validateAIEndpoint(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("AI endpoint must be an http or https URL")
	}
	return nil
}

// aiChatCompletion posts to an OpenAI-compatible chat endpoint such as llama-server.
func aiChatCompletion(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage) (string, error) {
	return aiChatCompletionWithOptions(ctx, client, endpoint, model, messages, aiCompletionTimeout, 0)
}

func aiChatCompletionWithOptions(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage, timeout time.Duration, maxTokens int) (string, error) {
	return aiChatCompletionWithThinking(ctx, client, endpoint, model, messages, timeout, maxTokens, aiThinkingDisabled())
}

// aiChatCompletionWithThinking always sends the fixed sampling parameters.
func aiChatCompletionWithThinking(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage, timeout time.Duration, maxTokens int, chatTemplateKwargs map[string]any) (string, error) {
	if err := validateAIEndpoint(endpoint); err != nil {
		return "", err
	}
	if len(messages) == 0 {
		return "", errors.New("AI request has no messages")
	}
	body, err := json.Marshal(aiChatRequest{Model: model, Messages: aiOpenAIMessages(messages), Stream: false, Temperature: aiSamplingTemperature, TopP: aiSamplingTopP, TopK: aiSamplingTopK, MaxTokens: maxTokens, ChatTemplateKwargs: chatTemplateKwargs})
	if err != nil {
		return "", fmt.Errorf("encode AI request: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create AI request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("contact AI endpoint: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, aiMaxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("read AI response: %w", err)
	}
	var parsed aiChatResponse
	decodeErr := json.Unmarshal(data, &parsed)
	if response.StatusCode < 200 || response.StatusCode > 299 {
		if decodeErr == nil && parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("AI endpoint returned %d: %s", response.StatusCode, parsed.Error.Message)
		}
		return "", fmt.Errorf("AI endpoint returned %d", response.StatusCode)
	}
	if decodeErr != nil {
		return "", fmt.Errorf("decode AI response: %w", decodeErr)
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("AI endpoint returned no choices")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

func aiAudioTranscription(ctx context.Context, client *http.Client, endpoint, model, prompt, filename, contentType string, audio []byte) (string, error) {
	if err := validateAIEndpoint(endpoint); err != nil {
		return "", err
	}
	if len(audio) == 0 {
		return "", errors.New("audio file is empty")
	}
	if len(audio) > aiMaxAudioBytes {
		return "", errors.New("audio file exceeds the 50 MiB limit")
	}

	filename = path.Base(strings.ReplaceAll(strings.TrimSpace(filename), "\\", "/"))
	filename = strings.Map(func(char rune) rune {
		if char == '\r' || char == '\n' || char == 0 {
			return '_'
		}
		return char
	}, filename)
	if filename == "" || filename == "." || filename == "/" {
		filename = "audio"
	}
	if parsedType, _, err := mime.ParseMediaType(contentType); err == nil && parsedType != "" {
		contentType = matrix.NormalizeMediaType(parsedType)
	} else {
		contentType = "application/octet-stream"
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if model != "" {
		if err := writer.WriteField("model", model); err != nil {
			return "", fmt.Errorf("encode transcription model: %w", err)
		}
	}
	if prompt != "" {
		if err := writer.WriteField("prompt", prompt); err != nil {
			return "", fmt.Errorf("encode transcription prompt: %w", err)
		}
	}
	if err := writer.WriteField("response_format", "json"); err != nil {
		return "", fmt.Errorf("encode transcription format: %w", err)
	}
	fileHeader := make(textproto.MIMEHeader)
	fileHeader.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	fileHeader.Set("Content-Type", contentType)
	filePart, err := writer.CreatePart(fileHeader)
	if err != nil {
		return "", fmt.Errorf("encode audio file: %w", err)
	}
	if _, err := filePart.Write(audio); err != nil {
		return "", fmt.Errorf("encode audio file: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("finish transcription request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, aiTranscriptionTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+"/v1/audio/transcriptions", &body)
	if err != nil {
		return "", fmt.Errorf("create transcription request: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("contact AI transcription endpoint: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, aiMaxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("read AI transcription: %w", err)
	}
	var parsed aiTranscriptionResponse
	decodeErr := json.Unmarshal(data, &parsed)
	if response.StatusCode < 200 || response.StatusCode > 299 {
		if decodeErr == nil && parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("AI transcription endpoint returned %d: %s", response.StatusCode, parsed.Error.Message)
		}
		return "", fmt.Errorf("AI transcription endpoint returned %d; it must support /v1/audio/transcriptions", response.StatusCode)
	}
	if decodeErr != nil {
		return "", fmt.Errorf("decode AI transcription: %w", decodeErr)
	}
	transcription := strings.TrimSpace(parsed.Text)
	if transcription == "" {
		return "", errors.New("AI endpoint returned an empty transcription")
	}
	return transcription, nil
}

// aiHealthCheck reports whether the server is up and the model has finished loading.
func aiHealthCheck(ctx context.Context, client *http.Client, endpoint string) error {
	if err := validateAIEndpoint(endpoint); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, aiHealthTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint, "/")+"/health", nil)
	if err != nil {
		return fmt.Errorf("create health request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("contact AI endpoint: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, aiMaxResponseBytes))
	switch response.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusServiceUnavailable:
		return errors.New("AI model is still loading")
	default:
		return fmt.Errorf("AI endpoint health check returned %d", response.StatusCode)
	}
}

func (s *AppService) aiContext() context.Context {
	if s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}

// beginAIRoomRun registers requestID so it can be stopped, and bounds the whole run, history read included, by aiMaxCompletionTimeout.
func (s *AppService) beginAIRoomRun(requestID string) (context.Context, func()) {
	ctx, release := s.aiRuns.begin(s.aiContext(), requestID)
	ctx, cancel := context.WithTimeout(ctx, aiMaxCompletionTimeout)
	return ctx, func() {
		cancel()
		release()
	}
}

// readAIRoomHistory returns the latest limit messages of roomID for an AI run, or errAIRunStopped when the run was stopped.
func (s *AppService) readAIRoomHistory(ctx context.Context, roomID string, limit int) ([]matrix.Message, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}
	page, err := client.HistoryPageWithLimit(ctx, roomID, 0, limit)
	if err != nil {
		if ctx.Err() == context.Canceled {
			return nil, errAIRunStopped
		}
		return nil, fmt.Errorf("read room history: %w", err)
	}
	return page.Messages, nil
}

// aiIsWAV reports whether audio starts with a RIFF/WAVE header.
func aiIsWAV(audio []byte) bool {
	return len(audio) >= 12 && string(audio[0:4]) == "RIFF" && string(audio[8:12]) == "WAVE"
}
