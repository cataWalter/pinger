package desktop

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

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
		if data == "" {
			continue
		}
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
			return "", fmt.Errorf("decode OpenAI-compatible stream: %w (payload %q)", err, data)
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
