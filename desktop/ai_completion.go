package desktop

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

func encodeAICompletionRequest(provider AIProvider, model string, messages []AIMessage, options aiCompletionOptions, stream bool) ([]byte, string, error) {
	if !options.Chat && aiMessagesHaveImages(messages) {
		return nil, "", errors.New("images require a chat request")
	}
	switch provider {
	case AIProviderOllama:
		request := aiOllamaRequest{
			Model:   model,
			Think:   aiOllamaThinkingOption(options.ChatTemplateKwargs),
			Stream:  stream,
			Format:  aiOllamaFormat(options),
			Options: aiOllamaOptions{Temperature: options.Temperature, NumPredict: options.MaxTokens, Stop: options.Stop},
		}
		var requestPath string
		if options.Chat {
			request.Messages = aiOllamaMessages(messages)
			requestPath = "/api/chat"
		} else {
			if messages[0].Role == "system" {
				request.System = messages[0].Content
			}
			request.Prompt = messages[len(messages)-1].Content
			requestPath = "/api/generate"
		}
		body, err := json.Marshal(request)
		if err != nil {
			return nil, "", fmt.Errorf("encode Ollama request: %w", err)
		}
		return body, requestPath, nil
	case AIProviderOpenAICompatible:
		responseFormat, err := aiOpenAIResponseFormat(options)
		if err != nil {
			return nil, "", fmt.Errorf("encode response format: %w", err)
		}
		temperature := options.Temperature
		body, err := json.Marshal(aiChatRequest{
			Model:              model,
			Messages:           aiOpenAIMessages(messages),
			Stream:             stream,
			Temperature:        &temperature,
			MaxTokens:          options.MaxTokens,
			Stop:               options.Stop,
			ResponseFormat:     responseFormat,
			ChatTemplateKwargs: options.ChatTemplateKwargs,
		})
		if err != nil {
			return nil, "", fmt.Errorf("encode OpenAI-compatible request: %w", err)
		}
		return body, "/v1/chat/completions", nil
	default:
		return nil, "", errors.New("unsupported AI provider")
	}
}

func aiMessagesHaveImages(messages []AIMessage) bool {
	for _, message := range messages {
		if len(message.Images) > 0 {
			return true
		}
	}
	return false
}

func aiOllamaMessages(messages []AIMessage) []aiOllamaMessage {
	converted := make([]aiOllamaMessage, 0, len(messages))
	for _, message := range messages {
		item := aiOllamaMessage{Role: message.Role, Content: message.Content}
		for _, image := range message.Images {
			item.Images = append(item.Images, image.Data)
		}
		converted = append(converted, item)
	}
	return converted
}

func aiOpenAIMessages(messages []AIMessage) []aiOpenAIMessage {
	converted := make([]aiOpenAIMessage, 0, len(messages))
	for _, message := range messages {
		item := aiOpenAIMessage{Role: message.Role, Content: message.Content}
		if len(message.Images) > 0 {
			parts := []aiOpenAIContentPart{{Type: "text", Text: message.Content}}
			for _, image := range message.Images {
				parts = append(parts, aiOpenAIContentPart{Type: "image_url", ImageURL: &aiOpenAIImageURL{URL: "data:" + image.MediaType + ";base64," + image.Data}})
			}
			item.Content = parts
		}
		converted = append(converted, item)
	}
	return converted
}

func aiOllamaFormat(options aiCompletionOptions) json.RawMessage {
	if len(options.JSONSchema) > 0 {
		return options.JSONSchema
	}
	if options.JSONObject {
		return json.RawMessage(`"json"`)
	}
	return nil
}

func aiOpenAIResponseFormat(options aiCompletionOptions) (json.RawMessage, error) {
	if len(options.JSONSchema) > 0 {
		name := options.JSONSchemaName
		if name == "" {
			name = "response"
		}
		return json.Marshal(struct {
			Type       string `json:"type"`
			JSONSchema struct {
				Name   string          `json:"name"`
				Strict bool            `json:"strict"`
				Schema json.RawMessage `json:"schema"`
			} `json:"json_schema"`
		}{
			Type: "json_schema",
			JSONSchema: struct {
				Name   string          `json:"name"`
				Strict bool            `json:"strict"`
				Schema json.RawMessage `json:"schema"`
			}{Name: name, Strict: true, Schema: options.JSONSchema},
		})
	}
	if options.JSONObject {
		return json.RawMessage(`{"type":"json_object"}`), nil
	}
	return nil, nil
}

// runLocalAICompletion runs a request against the local model endpoint configured in AI settings.
func runLocalAICompletion(ctx context.Context, client *http.Client, provider AIProvider, endpoint *url.URL, model string, messages []AIMessage, options aiCompletionOptions, onChunk func(string)) (string, error) {
	if endpoint == nil {
		return "", errors.New("local AI endpoint is unavailable")
	}
	return aiProviderCompletion(ctx, client, provider, endpoint.String(), model, messages, options, onChunk)
}

func isEventStreamResponse(response *http.Response) bool {
	return strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream")
}

// aiStatusError reads a short error body from a non-2xx response and returns it with the status code.
func aiStatusError(response *http.Response) error {
	data, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	var parsed struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(data, &parsed) == nil && len(parsed.Error) > 0 {
		var message string
		if json.Unmarshal(parsed.Error, &message) != nil {
			var object struct {
				Message string `json:"message"`
			}
			if json.Unmarshal(parsed.Error, &object) == nil {
				message = object.Message
			}
		}
		if message != "" {
			return fmt.Errorf("AI endpoint returned %d: %s", response.StatusCode, message)
		}
	}
	return fmt.Errorf("AI endpoint returned %d", response.StatusCode)
}

func decodeAICompletion(provider AIProvider, chat bool, data []byte) (string, error) {
	if provider == AIProviderOllama {
		var parsed struct {
			Response string    `json:"response"`
			Message  AIMessage `json:"message"`
			Error    string    `json:"error"`
		}
		if err := json.Unmarshal(data, &parsed); err != nil {
			return "", fmt.Errorf("decode Ollama response: %w", err)
		}
		if parsed.Error != "" {
			return "", fmt.Errorf("Ollama error: %s", parsed.Error)
		}
		text := parsed.Response
		if chat {
			text = parsed.Message.Content
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return "", errAIEmptyResponse
		}
		return text, nil
	}
	var parsed aiChatResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("decode AI response: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", fmt.Errorf("AI endpoint error: %s", parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("AI endpoint returned no choices")
	}
	text := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if text == "" {
		return "", errAIEmptyResponse
	}
	return text, nil
}

func streamAICompletion(reader io.Reader, provider AIProvider, chat bool, maxBytes int64, onChunk func(string)) (string, error) {
	if provider == AIProviderOllama {
		return streamOllamaCompletion(reader, chat, maxBytes, onChunk)
	}
	return streamOpenAICompatibleCompletion(reader, maxBytes, onChunk)
}

func streamOllamaCompletion(reader io.Reader, chat bool, maxBytes int64, onChunk func(string)) (string, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), int(maxBytes+1))
	var completion strings.Builder
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var chunk struct {
			Response string    `json:"response"`
			Message  AIMessage `json:"message"`
			Error    string    `json:"error"`
		}
		if err := json.Unmarshal(line, &chunk); err != nil {
			// A cut-off read leaves a partial last line, so the read failure is the real cause.
			if readErr := scanner.Err(); readErr != nil {
				return "", fmt.Errorf("read Ollama stream: %w", readErr)
			}
			return "", fmt.Errorf("decode Ollama stream: %w", err)
		}
		if chunk.Error != "" {
			return "", fmt.Errorf("Ollama error: %s", chunk.Error)
		}
		text := chunk.Response
		if chat {
			text = chunk.Message.Content
		}
		if text == "" {
			continue
		}
		if int64(completion.Len()+len(text)) > maxBytes {
			return "", errAIResponseTooLarge
		}
		completion.WriteString(text)
		onChunk(text)
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("read Ollama stream: %w", err)
	}
	result := strings.TrimSpace(completion.String())
	if result == "" {
		return "", errAIEmptyResponse
	}
	return result, nil
}

func streamOpenAICompatibleCompletion(reader io.Reader, maxBytes int64, onChunk func(string)) (string, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), int(maxBytes+1))
	var completion strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			// A cut-off read leaves a partial last line, so the read failure is the real cause.
			if readErr := scanner.Err(); readErr != nil {
				return "", fmt.Errorf("read OpenAI-compatible stream: %w", readErr)
			}
			return "", fmt.Errorf("decode OpenAI-compatible stream: %w", err)
		}
		if chunk.Error != nil {
			return "", fmt.Errorf("AI endpoint error: %s", chunk.Error.Message)
		}
		if len(chunk.Choices) == 0 || chunk.Choices[0].Delta.Content == "" {
			continue
		}
		text := chunk.Choices[0].Delta.Content
		if int64(completion.Len()+len(text)) > maxBytes {
			return "", errAIResponseTooLarge
		}
		completion.WriteString(text)
		onChunk(text)
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("read OpenAI-compatible stream: %w", err)
	}
	result := strings.TrimSpace(completion.String())
	if result == "" {
		return "", errAIEmptyResponse
	}
	return result, nil
}
