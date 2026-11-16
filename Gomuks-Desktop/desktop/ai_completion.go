package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

const aiStreamEventName = "ai:stream"
const aiThinkingLevelPreference = "ai.thinking_level"
const aiThinkingLevelDefault = "none"

var (
	errAIResponseTooLarge = errors.New("AI response exceeded the size limit")
	errAIEmptyResponse    = errors.New("AI endpoint returned an empty response")
	errAIRunStopped       = errors.New("AI request was stopped")
)

func doAIRequest(client *http.Client, endpoint string, request *http.Request) (*http.Response, error) {
	if err := validateAIEndpoint(endpoint); err != nil {
		return nil, err
	}
	if client == nil {
		return nil, errors.New("AI client is unavailable")
	}
	return client.Do(request)
}

// AIStreamEvent carries one streamed text delta for a running AI request.
// Reset tells the UI to discard text already shown for the request, which happens when a request is retried.
type AIStreamEvent struct {
	RequestID string `json:"requestId"`
	Text      string `json:"text"`
	Reset     bool   `json:"reset,omitempty"`
}

// Sampling parameters sent with every model call. They override per-feature temperature settings.
const (
	aiSamplingTemperature = 1.0
	aiSamplingTopP        = 0.95
	aiSamplingTopK        = 64
)

// aiCompletionOptions describes one model call. Zero values mean the server default.
type aiCompletionOptions struct {
	Temperature float64
	MaxTokens   int
	Stop        []string
	// Chat selects Ollama /api/chat for multi-turn messages. Otherwise Ollama receives the first system message and the last message as a prompt.
	Chat bool
	// JSONObject asks for any JSON object. JSONSchema takes precedence and constrains the output to the schema.
	JSONObject     bool
	JSONSchemaName string
	JSONSchema     json.RawMessage
	// ChatTemplateKwargs is passed to OpenAI-compatible servers to control model thinking.
	ChatTemplateKwargs map[string]any
	// MaxResponseBytes limits the accepted reply size. Zero uses aiMaxResponseBytes.
	MaxResponseBytes int64
}

// aiThinkingDisabled returns the default chat template arguments for no hidden reasoning.
func aiThinkingDisabled() map[string]any {
	return map[string]any{"enable_thinking": false}
}

func aiThinkingOptions(level string) map[string]any {
	level = strings.ToLower(strings.TrimSpace(level))
	if level == "none" || level == "" {
		return aiThinkingDisabled()
	}
	switch level {
	case "low", "medium", "high":
		return map[string]any{"enable_thinking": true, "reasoning_effort": level}
	default:
		return aiThinkingDisabled()
	}
}

func aiOllamaThinkingOption(kwargs map[string]any) any {
	enabled, ok := kwargs["enable_thinking"].(bool)
	if !ok {
		return nil
	}
	if !enabled {
		return false
	}
	if level, ok := kwargs["reasoning_effort"].(string); ok {
		return level
	}
	return true
}

type aiOllamaOptions struct {
	Temperature float64  `json:"temperature"`
	TopP        float64  `json:"top_p"`
	TopK        int      `json:"top_k"`
	NumPredict  int      `json:"num_predict,omitempty"`
	Stop        []string `json:"stop,omitempty"`
}

type aiOllamaRequest struct {
	Model    string            `json:"model"`
	Think    any               `json:"think,omitempty"`
	Messages []aiOllamaMessage `json:"messages,omitempty"`
	System   string            `json:"system,omitempty"`
	Prompt   string            `json:"prompt,omitempty"`
	Stream   bool              `json:"stream"`
	Format   json.RawMessage   `json:"format,omitempty"`
	Options  aiOllamaOptions   `json:"options"`
}

// aiOllamaMessage carries images as raw base64 strings, which is the Ollama chat wire format.
type aiOllamaMessage struct {
	Role    string   `json:"role"`
	Content string   `json:"content"`
	Images  []string `json:"images,omitempty"`
}

// aiOpenAIMessage uses a string for text-only turns and a content part list when images are attached.
type aiOpenAIMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type aiOpenAIContentPart struct {
	Type     string            `json:"type"`
	Text     string            `json:"text,omitempty"`
	ImageURL *aiOpenAIImageURL `json:"image_url,omitempty"`
}

type aiOpenAIImageURL struct {
	URL string `json:"url"`
}

// aiRunRegistry tracks in-flight AI requests by ID so the UI can stop them.
type aiRunRegistry struct {
	mu   sync.Mutex
	runs map[string]*aiRun
}

type aiRun struct {
	cancel context.CancelFunc
}

// begin derives a cancellable context for requestID. The returned function releases the registration.
// An empty requestID is not tracked and cannot be stopped.
func (r *aiRunRegistry) begin(parent context.Context, requestID string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	if requestID == "" {
		return ctx, cancel
	}
	run := &aiRun{cancel: cancel}
	r.mu.Lock()
	if r.runs == nil {
		r.runs = make(map[string]*aiRun)
	}
	if previous := r.runs[requestID]; previous != nil {
		previous.cancel()
	}
	r.runs[requestID] = run
	r.mu.Unlock()
	return ctx, func() {
		cancel()
		r.mu.Lock()
		if r.runs[requestID] == run {
			delete(r.runs, requestID)
		}
		r.mu.Unlock()
	}
}

// cancel stops the request with requestID and reports whether it was running.
func (r *aiRunRegistry) cancel(requestID string) bool {
	r.mu.Lock()
	run := r.runs[requestID]
	r.mu.Unlock()
	if run == nil {
		return false
	}
	run.cancel()
	return true
}

// aiProviderCompletion sends one request to a local Ollama server or an OpenAI-compatible endpoint.
// When onChunk is set, the reply is requested as a stream and each delta is passed to onChunk.
// The full trimmed reply is returned in both modes.
func aiProviderCompletion(ctx context.Context, client *http.Client, provider AIProvider, endpoint, model string, messages []AIMessage, options aiCompletionOptions, onChunk func(string)) (string, error) {
	if err := validateAIEndpoint(endpoint); err != nil {
		return "", err
	}
	if len(messages) == 0 {
		return "", errors.New("AI request has no messages")
	}
	if client == nil {
		return "", errors.New("AI client is unavailable")
	}
	streaming := onChunk != nil
	body, requestPath, err := encodeAICompletionRequest(provider, model, messages, options, streaming)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+requestPath, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create AI request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if streaming {
		if provider == AIProviderOllama {
			request.Header.Set("Accept", "application/x-ndjson")
		} else {
			request.Header.Set("Accept", "text/event-stream, application/json")
		}
	}
	response, err := doAIRequest(client, endpoint, request)
	if err != nil {
		return "", fmt.Errorf("contact AI endpoint: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", aiStatusError(response)
	}

	maxBytes := options.MaxResponseBytes
	if maxBytes <= 0 {
		maxBytes = aiMaxResponseBytes
	}
	limited := &io.LimitedReader{R: response.Body, N: maxBytes + 1}
	var completion string
	if streaming && (provider == AIProviderOllama || isEventStreamResponse(response)) {
		completion, err = streamAICompletion(limited, provider, options.Chat, maxBytes, onChunk)
	} else {
		data, readErr := io.ReadAll(limited)
		if readErr != nil {
			return "", fmt.Errorf("read AI response: %w", readErr)
		}
		if int64(len(data)) > maxBytes {
			return "", errAIResponseTooLarge
		}
		completion, err = decodeAICompletion(provider, options.Chat, data)
		if err == nil && streaming {
			onChunk(completion)
		}
	}
	if err != nil {
		return "", err
	}
	if limited.N == 0 {
		return "", errAIResponseTooLarge
	}
	return completion, nil
}
