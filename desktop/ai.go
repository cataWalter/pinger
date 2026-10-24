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

	sharedpreferences "mychat/preferences"
)

const (
	aiCompletionTimeout    = 3 * time.Minute
	aiToneGuardTimeout     = 1200 * time.Millisecond
	aiHealthTimeout        = 10 * time.Second
	aiTranscriptionTimeout = 5 * time.Minute
	aiMaxAudioBytes        = 50 << 20
	aiMaxResponseBytes     = 4 << 20
)

// AIMessage is one chat turn sent to the local model.
type AIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiChatRequest struct {
	Model              string          `json:"model,omitempty"`
	Messages           []AIMessage     `json:"messages"`
	Stream             bool            `json:"stream"`
	Temperature        *float64        `json:"temperature,omitempty"`
	MaxTokens          int             `json:"max_tokens,omitempty"`
	Stop               []string        `json:"stop,omitempty"`
	ResponseFormat     json.RawMessage `json:"response_format,omitempty"`
	ChatTemplateKwargs map[string]any  `json:"chat_template_kwargs,omitempty"`
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
	return sharedpreferences.ValidateAIEndpoint(raw)
}

func doAIRequest(client *http.Client, endpoint string, request *http.Request) (*http.Response, error) {
	baseURL, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse AI endpoint: %w", err)
	}
	if client == nil {
		client = http.DefaultClient
	}
	clientCopy := *client
	previousCheckRedirect := client.CheckRedirect
	clientCopy.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if !sameAIOrigin(baseURL, request.URL) {
			return errors.New("AI endpoint redirect changed origin")
		}
		if previousCheckRedirect != nil {
			return previousCheckRedirect(request, via)
		}
		if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return nil
	}
	return clientCopy.Do(request)
}

func sameAIOrigin(first, second *url.URL) bool {
	return strings.EqualFold(first.Scheme, second.Scheme) &&
		strings.EqualFold(first.Hostname(), second.Hostname()) && aiEndpointPort(first) == aiEndpointPort(second)
}

func aiEndpointPort(endpoint *url.URL) string {
	if port := endpoint.Port(); port != "" {
		return port
	}
	if strings.EqualFold(endpoint.Scheme, "https") {
		return "443"
	}
	return "80"
}

// aiChatCompletion posts a non-streaming request to an OpenAI-compatible chat endpoint such as llama-server.
func aiChatCompletion(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage) (string, error) {
	return aiChatCompletionWithOptions(ctx, client, endpoint, model, messages, aiCompletionTimeout, aiCompletionOptions{}, nil)
}

// aiChatCompletionWithOptions runs one OpenAI-compatible chat request. When onChunk is set, the reply is streamed.
func aiChatCompletionWithOptions(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage, timeout time.Duration, options aiCompletionOptions, onChunk func(string)) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return aiProviderCompletion(ctx, client, GhostwriterProviderOpenAICompatible, endpoint, model, messages, options, onChunk)
}

// aiToneGuardCompletion classifies a draft on a loopback endpoint only, so the draft never leaves the machine.
func aiToneGuardCompletion(ctx context.Context, client *http.Client, endpoint, model string, messages []AIMessage, options aiCompletionOptions) (string, error) {
	if err := sharedpreferences.ValidateLocalHTTPEndpoint(endpoint); err != nil {
		return "", fmt.Errorf("Tone Guard requires a localhost HTTP endpoint: %w", err)
	}
	return aiChatCompletionWithOptions(ctx, client, endpoint, model, messages, aiToneGuardTimeout, options, nil)
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
	response, err := doAIRequest(client, endpoint, request)
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
	response, err := doAIRequest(client, endpoint, request)
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

// AIComplete sends chat messages to the configured endpoint and returns the full reply.
// When requestID is set, reply deltas are emitted as ai:stream events so the answer can be shown while it is generated.
// temperature and maxTokens are chosen by the caller from the AI feature settings; zero maxTokens means no explicit limit.
func (s *AppService) AIComplete(messages []AIMessage, requestID string, temperature float64, maxTokens int) (string, error) {
	endpoint, model, err := s.aiEndpointSettings()
	if err != nil {
		return "", err
	}
	options, err := aiRunOptions(temperature, maxTokens)
	if err != nil {
		return "", err
	}
	return s.runAIStream(requestID, func(ctx context.Context, onChunk func(string)) (string, error) {
		return aiChatCompletionWithOptions(ctx, aiHTTPClient, endpoint, model, messages, aiCompletionTimeout, options, onChunk)
	})
}

// AICancel stops the AI request with requestID and reports whether it was running.
func (s *AppService) AICancel(requestID string) bool {
	return s.aiRuns.cancel(requestID)
}

// runAIStream runs one AI call tracked under requestID. Deltas are emitted as ai:stream events when requestID is set.
func (s *AppService) runAIStream(requestID string, run func(ctx context.Context, onChunk func(string)) (string, error)) (string, error) {
	ctx, release := s.aiRuns.begin(s.aiContext(), requestID)
	defer release()
	var onChunk func(string)
	if requestID != "" {
		onChunk = func(text string) {
			if s.emitAIStream != nil {
				s.emitAIStream(AIStreamEvent{RequestID: requestID, Text: text})
			}
		}
	}
	result, err := run(ctx, onChunk)
	if err != nil && ctx.Err() == context.Canceled {
		return "", errAIRunStopped
	}
	return result, err
}

// CheckMessageTone classifies a draft using only a local loopback AI endpoint.
func (s *AppService) CheckMessageTone(messages []AIMessage, temperature float64, maxTokens int) (string, error) {
	endpoint, model, err := s.aiEndpointSettings()
	if err != nil {
		return "", err
	}
	options, err := aiRunOptions(temperature, maxTokens)
	if err != nil {
		return "", err
	}
	return aiToneGuardCompletion(s.aiContext(), ghostwriterHTTPClient, endpoint, model, messages, options)
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
