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
)

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
			Options: aiOllamaOptions{Temperature: aiSamplingTemperature, TopP: aiSamplingTopP, TopK: aiSamplingTopK, NumPredict: options.MaxTokens, Stop: options.Stop},
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
		body, err := json.Marshal(aiChatRequest{
			Model:              model,
			Messages:           aiOpenAIMessages(messages),
			Stream:             stream,
			Temperature:        aiSamplingTemperature,
			TopP:               aiSamplingTopP,
			TopK:               aiSamplingTopK,
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
