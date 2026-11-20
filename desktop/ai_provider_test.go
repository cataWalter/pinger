package desktop

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestParseAIEndpointURLOnlyAllowsLoopbackHTTP(t *testing.T) {
	for _, endpoint := range []string{
		"http://localhost:11434",
		"http://127.0.0.1:8080",
		"http://[::1]:8080",
	} {
		if _, err := parseAIEndpointURL(endpoint); err != nil {
			t.Errorf("parseAIEndpointURL(%q) error = %v", endpoint, err)
		}
	}
	for _, endpoint := range []string{
		"https://localhost:11434",
		"http://example.com:11434",
		"http://127.0.0.1.example.com:11434",
		"http://user:pass@localhost:11434",
		"http://localhost:11434/path",
		"http://localhost:11434?redirect=https://example.com",
	} {
		if _, err := parseAIEndpointURL(endpoint); err == nil {
			t.Errorf("parseAIEndpointURL(%q) accepted a non-local endpoint", endpoint)
		}
	}
}

func TestAIModelConfigUsesConfiguredLoopbackAIEndpoint(t *testing.T) {
	provider, endpoint, model, err := aiModelConfig(map[string]any{
		"ai.endpoint": "http://127.0.0.1:11434",
		"ai.model":    "local-model",
	})
	if err != nil {
		t.Fatalf("aiModelConfig() error = %v", err)
	}
	if provider != AIProviderOpenAICompatible || endpoint.String() != "http://127.0.0.1:11434" || model != "local-model" {
		t.Fatalf("aiModelConfig() = (%q, %q, %q), want OpenAI-compatible local model", provider, endpoint, model)
	}
}

func TestAIModelConfigFallsBackToLocalOllamaWithoutValidEndpoint(t *testing.T) {
	provider, endpoint, model, err := aiModelConfig(map[string]any{
		"ai.endpoint": "http://example.com:11434",
		"ai.model":    "remote-model",
	})
	if err != nil {
		t.Fatalf("aiModelConfig() error = %v", err)
	}
	if provider != AIProviderOllama || endpoint.String() != aiDefaultOllamaURL || model != aiDefaultOllamaModel {
		t.Fatalf("aiModelConfig() = (%q, %q, %q), want local Ollama default", provider, endpoint, model)
	}
}

func TestAILocalHTTPClientDisablesProxyAndRejectsNonLoopback(t *testing.T) {
	transport, ok := aiLocalHTTPClient.Transport.(*http.Transport)
	if !ok || transport.Proxy != nil || transport.DialContext == nil {
		t.Fatal("local AI HTTP client must use a no-proxy loopback transport")
	}
	if _, err := dialLocalAILoopback(context.Background(), "tcp", "192.0.2.1:80"); err == nil {
		t.Fatal("dialLocalAILoopback accepted a non-loopback address")
	}
}

func TestAILocalCompletionRejectsRedirects(t *testing.T) {
	for _, statusCode := range []int{http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		t.Run(http.StatusText(statusCode), func(t *testing.T) {
			var received atomic.Bool
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				received.Store(true)
				w.WriteHeader(http.StatusOK)
			}))
			defer remote.Close()
			local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, remote.URL, statusCode)
			}))
			defer local.Close()
			messages := []AIMessage{{Role: "user", Content: "private draft"}}
			_, err := aiProviderCompletion(context.Background(), aiLocalHTTPClient, AIProviderOpenAICompatible, local.URL, "test", messages, aiCompletionOptions{}, nil)
			if err == nil {
				t.Fatal("local completion accepted a redirect")
			}
			if received.Load() {
				t.Fatal("redirect destination received private content")
			}
		})
	}
}

func TestAILocalCompletionFallsBackToOpenAIRouteWhenOllamaRouteMissing(t *testing.T) {
	var openAIRequests atomic.Int32
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/chat":
			http.NotFound(w, r)
		case "/v1/chat/completions":
			openAIRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":" hi "}}]}`))
		default:
			t.Errorf("unexpected request path %q", r.URL.Path)
		}
	}))
	defer local.Close()
	messages := []AIMessage{{Role: "user", Content: "hello"}, {Role: "assistant", Content: "hey"}, {Role: "user", Content: "again"}}
	completion, err := aiProviderCompletion(context.Background(), aiLocalHTTPClient, AIProviderOllama, local.URL, "", messages, aiCompletionOptions{Chat: true}, nil)
	if err != nil || completion != "hi" {
		t.Fatalf("local completion = %q, %v; want hi from the OpenAI-compatible route", completion, err)
	}
	if got := openAIRequests.Load(); got != 1 {
		t.Fatalf("OpenAI-compatible route requests = %d, want 1", got)
	}
}

func TestAILocalCompletionAcceptsLoopbackResponse(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":" world"}}]}`))
	}))
	defer local.Close()
	messages := []AIMessage{{Role: "user", Content: "hello"}}
	completion, err := aiProviderCompletion(context.Background(), aiLocalHTTPClient, AIProviderOpenAICompatible, local.URL, "test", messages, aiCompletionOptions{}, nil)
	if err != nil || completion != "world" {
		t.Fatalf("local completion = %q, %v; want world", completion, err)
	}
}

func TestAILocalStreamAllowsFramingLargerThanReplyCap(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Repeat(": keepalive\n\n", 100)))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer local.Close()
	var chunks []string
	messages := []AIMessage{{Role: "user", Content: "hello"}}
	completion, err := aiProviderCompletion(context.Background(), aiLocalHTTPClient, AIProviderOpenAICompatible, local.URL, "test", messages, aiCompletionOptions{MaxResponseBytes: 64}, func(chunk string) {
		chunks = append(chunks, chunk)
	})
	if err != nil || completion != "hi" {
		t.Fatalf("stream completion = %q, %v; want hi with the framing ignored by the reply cap", completion, err)
	}
	if len(chunks) != 1 || chunks[0] != "hi" {
		t.Fatalf("stream chunks = %q, want [hi]", chunks)
	}
}
