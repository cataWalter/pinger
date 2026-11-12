package desktop

import (
	"encoding/json"
	"testing"
)

// TestEveryProviderRequestUsesFixedSampling checks that both encodings send the fixed sampling values,
// even when a caller passes a different per-feature temperature.
func TestEveryProviderRequestUsesFixedSampling(t *testing.T) {
	messages := []AIMessage{{Role: "user", Content: "Translate hello"}}
	options := aiCompletionOptions{Temperature: 0.3, MaxTokens: 64}

	for _, provider := range []AIProvider{AIProviderOpenAICompatible, AIProviderOllama} {
		body, _, err := encodeAICompletionRequest(provider, "local-model", messages, options, false)
		if err != nil {
			t.Fatalf("encodeAICompletionRequest(%q) error = %v", provider, err)
		}
		var request map[string]any
		if err := json.Unmarshal(body, &request); err != nil {
			t.Fatalf("decode %q request: %v", provider, err)
		}
		if provider == AIProviderOllama {
			request = request["options"].(map[string]any)
		}
		if request["temperature"] != 1.0 || request["top_p"] != 0.95 || request["top_k"] != 64.0 {
			t.Errorf("%q sampling = temperature %v, top_p %v, top_k %v; want 1, 0.95, 64", provider, request["temperature"], request["top_p"], request["top_k"])
		}
	}
}
