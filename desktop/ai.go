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
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	sharedpreferences "mychat/preferences"
)

const (
	aiCompletionTimeout    = 60 * time.Second
	aiMaxCompletionTimeout = 10 * time.Minute
	aiToneGuardTimeout     = 1200 * time.Millisecond
	aiToneGuardMaxTokens   = 192
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
	Temperature        *float64          `json:"temperature,omitempty"`
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
	return aiChatCompletionWithOptions(ctx, client, endpoint, model, messages, aiCompletionTimeout, nil, 0)
}

func aiChatCompletionWithOptions(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage, timeout time.Duration, temperature *float64, maxTokens int) (string, error) {
	return aiChatCompletionWithThinking(ctx, client, endpoint, model, messages, timeout, temperature, maxTokens, aiThinkingDisabled())
}

func aiChatCompletionWithThinking(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage, timeout time.Duration, temperature *float64, maxTokens int, chatTemplateKwargs map[string]any) (string, error) {
	if err := validateAIEndpoint(endpoint); err != nil {
		return "", err
	}
	if len(messages) == 0 {
		return "", errors.New("AI request has no messages")
	}
	body, err := json.Marshal(aiChatRequest{Model: model, Messages: aiOpenAIMessages(messages), Stream: false, Temperature: temperature, MaxTokens: maxTokens, ChatTemplateKwargs: chatTemplateKwargs})
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

func aiToneGuardCompletion(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage) (string, error) {
	if err := sharedpreferences.ValidateLocalHTTPEndpoint(endpoint); err != nil {
		return "", fmt.Errorf("Tone Guard requires a localhost HTTP endpoint: %w", err)
	}
	temperature := 0.1
	return aiChatCompletionWithOptions(ctx, client, endpoint, model, messages, aiToneGuardTimeout, &temperature, aiToneGuardMaxTokens)
}

func aiAudioTranscription(ctx context.Context, client *http.Client, endpoint, model, filename, contentType string, audio []byte) (string, error) {
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
		contentType = parsedType
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

func (s *AppService) aiEndpointSettings() (string, string, error) {
	preferences := s.preferenceValues()
	endpoint, _ := preferences["ai.endpoint"].(string)
	model, _ := preferences["ai.model"].(string)
	if endpoint == "" {
		return "", "", errors.New("set an AI endpoint in Settings > Integrations")
	}
	return endpoint, model, nil
}

func (s *AppService) aiContext() context.Context {
	if s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}

// aiIsWAV reports whether audio starts with a RIFF/WAVE header.
func aiIsWAV(audio []byte) bool {
	return len(audio) >= 12 && string(audio[0:4]) == "RIFF" && string(audio[8:12]) == "WAVE"
}

// aiIsMP3 reports whether audio starts with an ID3 tag or an MPEG Layer III frame sync.
// ADTS AAC frames share the 0xFF sync byte, so the layer bits must be non-zero.
func aiIsMP3(audio []byte) bool {
	if len(audio) >= 3 && string(audio[0:3]) == "ID3" {
		return true
	}
	return len(audio) >= 2 && audio[0] == 0xFF && audio[1]&0xE0 == 0xE0 && (audio[1]>>1)&0x03 != 0
}

// aiPrepareTranscriptionAudio converts audio the local endpoint cannot decode into 16 kHz mono WAV.
// llama-server decodes only WAV and MP3, so Matrix voice messages in Ogg, M4A, or WebM are converted with ffmpeg.
// Empty or oversized audio is returned unchanged so aiAudioTranscription reports its usual errors.
func aiPrepareTranscriptionAudio(ctx context.Context, audio []byte, filename, contentType string) ([]byte, string, string, error) {
	if len(audio) == 0 || len(audio) > aiMaxAudioBytes || aiIsWAV(audio) || aiIsMP3(audio) {
		return audio, filename, contentType, nil
	}
	converted, err := aiConvertAudioToWAV(ctx, audio)
	if err != nil {
		return nil, "", "", err
	}
	base := path.Base(strings.TrimSpace(filename))
	if base == "." || base == "/" {
		base = "audio"
	}
	filename = strings.TrimSuffix(base, path.Ext(base)) + ".wav"
	return converted, filename, "audio/wav", nil
}

func aiFFmpegPath() (string, error) {
	if found, err := exec.LookPath("ffmpeg"); err == nil {
		return found, nil
	}
	for _, candidate := range aiFFmpegFallbackPaths {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("this voice message format needs ffmpeg to transcribe; install it with 'brew install ffmpeg'")
}

func aiConvertAudioToWAV(ctx context.Context, audio []byte) ([]byte, error) {
	ffmpeg, err := aiFFmpegPath()
	if err != nil {
		return nil, err
	}
	workDir, err := os.MkdirTemp("", "gomuks-transcription-*")
	if err != nil {
		return nil, fmt.Errorf("create transcription workspace: %w", err)
	}
	defer os.RemoveAll(workDir)
	// ffmpeg reads MP4-family files more reliably from a seekable file than from a pipe.
	inputPath := filepath.Join(workDir, "input")
	outputPath := filepath.Join(workDir, "output.wav")
	if err := os.WriteFile(inputPath, audio, 0o600); err != nil {
		return nil, fmt.Errorf("write audio for conversion: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, aiTranscodeTimeout)
	defer cancel()
	var stderr bytes.Buffer
	command := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath)
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, fmt.Errorf("convert voice message for transcription: %s", detail)
	}
	converted, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("read converted voice message: %w", err)
	}
	return converted, nil
}

// aiCompletionTimeoutFor gives large prompts more time. A local model reads the whole prompt before its first token.
// Each KiB of prompt text adds one second to aiCompletionTimeout, up to aiMaxCompletionTimeout.
func aiCompletionTimeoutFor(messages []AIMessage) time.Duration {
	promptBytes := 0
	for _, message := range messages {
		promptBytes += len(message.Content)
		for _, image := range message.Images {
			promptBytes += len(image.Data)
		}
	}
	extra := time.Duration(promptBytes/1024) * time.Second
	return min(aiCompletionTimeout+extra, aiMaxCompletionTimeout)
}

// AIComplete sends chat messages to the configured local endpoint and returns the reply text.
func (s *AppService) AIComplete(messages []AIMessage, requestID string, temperature float64, maxTokens int) (string, error) {
	endpoint, model, err := s.aiEndpointSettings()
	if err != nil {
		return "", err
	}
	thinkingLevel := stringPreference(s.preferenceValues(), aiThinkingLevelPreference, aiThinkingLevelDefault)
	ctx, release := s.aiRuns.begin(s.aiContext(), requestID)
	defer release()
	return aiChatCompletionWithThinking(ctx, aiHTTPClient, endpoint, model, messages, aiCompletionTimeoutFor(messages), &temperature, maxTokens, aiThinkingOptions(thinkingLevel))
}

// AICancel stops a running AI request.
func (s *AppService) AICancel(requestID string) bool {
	return s.aiRuns.cancel(requestID)
}

// CheckMessageTone classifies a draft using only a local loopback AI endpoint.
func (s *AppService) CheckMessageTone(messages []AIMessage) (string, error) {
	endpoint, model, err := s.aiEndpointSettings()
	if err != nil {
		return "", err
	}
	return aiToneGuardCompletion(s.aiContext(), aiLocalHTTPClient, endpoint, model, messages)
}

// AITranscribeMedia transcribes cached Matrix audio with the configured OpenAI-compatible endpoint.
func (s *AppService) AITranscribeMedia(mxcURI, filename, contentType string) (string, error) {
	endpoint, model, err := s.aiEndpointSettings()
	if err != nil {
		return "", err
	}
	preferences := s.preferenceValues()
	transcriptionModel, _ := preferences["ai.transcription_model"].(string)
	if transcriptionModel == "" {
		transcriptionModel = model
	}
	audio, err := s.currentClient().CachedMediaBytes(s.aiContext(), mxcURI)
	if err != nil {
		return "", fmt.Errorf("load audio from Matrix: %w", err)
	}
	audio, filename, contentType, err = aiPrepareTranscriptionAudio(s.aiContext(), audio, filename, contentType)
	if err != nil {
		return "", err
	}
	return aiAudioTranscription(s.aiContext(), aiHTTPClient, endpoint, transcriptionModel, filename, contentType, audio)
}

// TestAIEndpoint checks that the configured endpoint is reachable and its model is loaded.
func (s *AppService) TestAIEndpoint() error {
	endpoint, _, err := s.aiEndpointSettings()
	if err != nil {
		return err
	}
	return aiHealthCheck(s.aiContext(), aiHTTPClient, endpoint)
}

var aiHTTPClient = &http.Client{}
