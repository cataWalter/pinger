package desktop

import (
	"context"
	"net/http"
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
