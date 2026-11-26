package desktop

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestStreamOpenAICompatibleCompletionSkipsEmptyDataLines(t *testing.T) {
	stream := "data:\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n"
	got, err := streamOpenAICompatibleCompletion(strings.NewReader(stream), 1024, func(string) {})
	if err != nil {
		t.Fatalf("streamOpenAICompatibleCompletion() error = %v", err)
	}
	if got != "hi" {
		t.Fatalf("streamOpenAICompatibleCompletion() = %q, want %q", got, "hi")
	}
}

func TestValidateAIEndpointRequiresHTTPURL(t *testing.T) {
	for _, endpoint := range []string{"http://localhost:8080", "https://ai.example.net/base"} {
		if err := validateAIEndpoint(endpoint); err != nil {
			t.Fatalf("validateAIEndpoint(%q) error = %v", endpoint, err)
		}
	}
	for _, endpoint := range []string{"localhost:8080", "ftp://example.net", "http://", "not a url"} {
		if err := validateAIEndpoint(endpoint); err == nil {
			t.Fatalf("validateAIEndpoint(%q) accepted invalid endpoint", endpoint)
		}
	}
}

func TestPreferenceStoreAcceptsAIEndpointSettings(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if err := store.Set("ai.endpoint", "http://localhost:8080"); err != nil {
		t.Fatalf("Set(ai.endpoint) error = %v", err)
	}
	if err := store.Set("ai.endpoint", ""); err != nil {
		t.Fatalf("Set(ai.endpoint) clearing error = %v", err)
	}
	if err := store.Set("ai.endpoint", "localhost:8080"); err == nil {
		t.Fatal("Set(ai.endpoint) accepted a URL without a scheme")
	}
	if err := store.Set("ai.model", "local-model.gguf"); err != nil {
		t.Fatalf("Set(ai.model) error = %v", err)
	}
	if err := store.Set("ai.model", 3); err == nil {
		t.Fatal("Set(ai.model) accepted a non-string value")
	}
	for _, level := range []string{"none", "low", "medium", "high"} {
		if err := store.Set("ai.thinking_level", level); err != nil {
			t.Errorf("Set(ai.thinking_level, %q) error = %v", level, err)
		}
	}
	if err := store.Set("ai.thinking_level", "maximum"); err == nil {
		t.Fatal("Set(ai.thinking_level) accepted an unsupported value")
	}
	if err := store.Set("ai.default_language", "es"); err != nil {
		t.Fatalf("Set(ai.default_language) error = %v", err)
	}
	if err := store.Set("ai.known_languages", `["en","es"]`); err != nil {
		t.Fatalf("Set(ai.known_languages) error = %v", err)
	}
	if err := store.Set("ai.known_languages", `["xx"]`); err == nil {
		t.Fatal("Set(ai.known_languages) accepted an unsupported language")
	}
}

func TestAIThinkingOptionsMapLevelsForProviders(t *testing.T) {
	tests := []struct {
		level  string
		openAI map[string]any
		ollama any
	}{
		{level: "none", openAI: map[string]any{"enable_thinking": false}, ollama: false},
		{level: "low", openAI: map[string]any{"enable_thinking": true, "reasoning_effort": "low"}, ollama: "low"},
		{level: "medium", openAI: map[string]any{"enable_thinking": true, "reasoning_effort": "medium"}, ollama: "medium"},
		{level: "high", openAI: map[string]any{"enable_thinking": true, "reasoning_effort": "high"}, ollama: "high"},
	}
	for _, test := range tests {
		options := aiThinkingOptions(test.level)
		if !reflect.DeepEqual(options, test.openAI) {
			t.Errorf("aiThinkingOptions(%q) = %#v, want %#v", test.level, options, test.openAI)
		}
		if got := aiOllamaThinkingOption(options); got != test.ollama {
			t.Errorf("aiOllamaThinkingOption(%q) = %#v, want %#v", test.level, got, test.ollama)
		}
	}
}

func TestAIThinkingOptionsEncodeForProviders(t *testing.T) {
	for _, test := range []struct {
		provider AIProvider
		level    string
		want     any
	}{
		{provider: AIProviderOpenAICompatible, level: "none", want: false},
		{provider: AIProviderOpenAICompatible, level: "high", want: "high"},
		{provider: AIProviderOllama, level: "none", want: false},
		{provider: AIProviderOllama, level: "high", want: "high"},
	} {
		body, _, err := encodeAICompletionRequest(test.provider, "gemma4:12b", []AIMessage{{Role: "user", Content: "test"}}, aiCompletionOptions{
			Chat:               true,
			ChatTemplateKwargs: aiThinkingOptions(test.level),
		}, false)
		if err != nil {
			t.Fatalf("encodeAICompletionRequest(%q, %q) error = %v", test.provider, test.level, err)
		}
		var request map[string]json.RawMessage
		if err := json.Unmarshal(body, &request); err != nil {
			t.Fatalf("decode %q request: %v", test.provider, err)
		}
		var got any
		if test.provider == AIProviderOllama {
			if err := json.Unmarshal(request["think"], &got); err != nil {
				t.Fatalf("decode Ollama think value: %v", err)
			}
		} else {
			var kwargs map[string]any
			if err := json.Unmarshal(request["chat_template_kwargs"], &kwargs); err != nil {
				t.Fatalf("decode OpenAI-compatible template kwargs: %v", err)
			}
			if kwargs["enable_thinking"] != (test.level != "none") {
				t.Errorf("%q enable_thinking = %v", test.provider, kwargs["enable_thinking"])
			}
			if effort := kwargs["reasoning_effort"]; test.level == "high" && effort != test.want {
				t.Errorf("%q reasoning_effort = %v, want %v", test.provider, effort, test.want)
			}
			if test.level == "none" {
				continue
			}
			continue
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Errorf("%q think value = %#v, want %#v", test.provider, got, test.want)
		}
	}
}

func TestAIChatCompletionSendsMessagesAndReturnsReply(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.URL.Path)
		}
		var body struct {
			Model              string         `json:"model"`
			Messages           []AIMessage    `json:"messages"`
			Stream             bool           `json:"stream"`
			ChatTemplateKwargs map[string]any `json:"chat_template_kwargs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "local.gguf" || body.Stream || len(body.Messages) != 1 || body.Messages[0].Content != "Translate hello" {
			t.Errorf("unexpected body: %+v", body)
		}
		if body.ChatTemplateKwargs["enable_thinking"] != true || body.ChatTemplateKwargs["reasoning_effort"] != "high" {
			t.Errorf("unexpected thinking settings: %+v", body.ChatTemplateKwargs)
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"  Hola  "}}]}`)
	}))
	defer server.Close()

	reply, err := aiChatCompletionWithThinking(context.Background(), server.Client(), server.URL+"/", "local.gguf", []AIMessage{{Role: "user", Content: "Translate hello"}}, aiCompletionTimeout, 0, aiThinkingOptions("high"))
	if err != nil {
		t.Fatalf("aiChatCompletion() error = %v", err)
	}
	if reply != "Hola" {
		t.Fatalf("reply = %q, want %q", reply, "Hola")
	}
}

func TestLocalAIRouteStreamsDeltasInOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if !body.Stream {
			t.Errorf("request stream = false, want true")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()

	var chunks []string
	reply, err := testLocalAIRoute(server, "local.gguf").complete(context.Background(), []AIMessage{{Role: "user", Content: "Say hello"}}, aiCompletionOptions{ChatTemplateKwargs: aiThinkingDisabled()}, func(text string) {
		chunks = append(chunks, text)
	})
	if err != nil {
		t.Fatalf("complete() error = %v", err)
	}
	if reply != "Hello" {
		t.Fatalf("reply = %q, want %q", reply, "Hello")
	}
	if !reflect.DeepEqual(chunks, []string{"Hel", "lo"}) {
		t.Fatalf("chunks = %q, want [Hel lo]", chunks)
	}
}

func TestAICompletionTimeoutGrowsWithPromptSizeUpToCap(t *testing.T) {
	short := []AIMessage{{Role: "user", Content: "Summarize this"}}
	if got := aiCompletionTimeoutFor(short); got != aiCompletionTimeout {
		t.Fatalf("short prompt timeout = %s, want %s", got, aiCompletionTimeout)
	}
	large := []AIMessage{{Role: "system", Content: "Summarize"}, {Role: "user", Content: strings.Repeat("x", 64<<10)}}
	if got := aiCompletionTimeoutFor(large); got != aiCompletionTimeout+64*time.Second {
		t.Fatalf("64 KiB prompt timeout = %s, want %s", got, aiCompletionTimeout+64*time.Second)
	}
	huge := []AIMessage{{Role: "user", Content: strings.Repeat("x", 4<<20)}}
	if got := aiCompletionTimeoutFor(huge); got != aiMaxCompletionTimeout {
		t.Fatalf("4 MiB prompt timeout = %s, want cap %s", got, aiMaxCompletionTimeout)
	}
}
