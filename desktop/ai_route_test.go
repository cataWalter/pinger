package desktop

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

// testLocalAIRoute targets an httptest server through the loopback client that local AI settings use.
func testLocalAIRoute(server *httptest.Server, model string) aiRoute {
	return aiRoute{client: aiLocalHTTPClient, provider: AIProviderOpenAICompatible, endpoint: server.URL, model: model}
}

func testOnlinePreferences() map[string]any {
	return map[string]any{
		aiProviderPreference:       aiProviderOnline,
		aiOnlineEndpointPreference: aiOnlineDefaultEndpoint,
		aiOnlineModelPreference:    "openai/gpt-4o-mini",
		aiOnlineConsentPreference:  aiOnlineDefaultEndpoint,
	}
}

func TestAILocalRouteRejectsRemoteEndpoint(t *testing.T) {
	prefs := map[string]any{"ai.endpoint": "https://example.org", "ai.model": "local.gguf"}
	if _, err := aiLocalRoute(prefs); err == nil {
		t.Fatal("aiLocalRoute() accepted a remote endpoint")
	}
}

func TestOnlineAIRouteNeedsConsentModelAndKey(t *testing.T) {
	keyring.MockInit()

	prefs := testOnlinePreferences()
	delete(prefs, aiOnlineConsentPreference)
	if _, err := aiOnlineRoute(prefs); err == nil {
		t.Fatal("aiOnlineRoute() ran without consent")
	}

	prefs = testOnlinePreferences()
	prefs[aiOnlineModelPreference] = ""
	if _, err := aiOnlineRoute(prefs); err == nil {
		t.Fatal("aiOnlineRoute() ran without a model")
	}

	prefs = testOnlinePreferences()
	if _, err := aiOnlineRoute(prefs); err == nil {
		t.Fatal("aiOnlineRoute() ran without an API key")
	}

	if err := keyring.Set(aiOnlineKeychainService, aiOnlineKeyAccount("openrouter.ai"), "test-key"); err != nil {
		t.Fatalf("keyring.Set() error = %v", err)
	}
	route, err := aiOnlineRoute(prefs)
	if err != nil {
		t.Fatalf("aiOnlineRoute() error = %v", err)
	}
	if route.provider != AIProviderOnline || route.endpoint != aiOnlineDefaultEndpoint || route.model != "openai/gpt-4o-mini" {
		t.Fatalf("aiOnlineRoute() = %+v", route)
	}
}

func TestChangingOnlineEndpointRevokesConsent(t *testing.T) {
	prefs := testOnlinePreferences()
	prefs[aiOnlineEndpointPreference] = "https://example.com/v1"
	endpoint, _, err := aiOnlineEndpointSetting(prefs)
	if err != nil {
		t.Fatalf("aiOnlineEndpointSetting() error = %v", err)
	}
	if aiOnlineConsented(prefs, endpoint) {
		t.Fatal("consent for OpenRouter carried over to a different endpoint")
	}
}

func TestOnlineChatRouteNeverFallsBackToLocal(t *testing.T) {
	keyring.MockInit()

	prefs := testOnlinePreferences()
	delete(prefs, aiOnlineConsentPreference)
	prefs["ai.endpoint"] = "http://127.0.0.1:8080"
	prefs["ai.model"] = "local.gguf"
	if _, err := aiChatRoute(prefs); err == nil {
		t.Fatal("online chat route fell back to local AI without consent")
	}
}

func TestBackgroundChatLanguageStaysLocalWhenOnlineIsReady(t *testing.T) {
	keyring.MockInit()
	if err := keyring.Set(aiOnlineKeychainService, aiOnlineKeyAccount("openrouter.ai"), "test-key"); err != nil {
		t.Fatalf("keyring.Set() error = %v", err)
	}

	prefs := testOnlinePreferences()
	prefs["ai.endpoint"] = "http://127.0.0.1:8080"
	prefs["ai.model"] = "local.gguf"
	if _, err := aiOnlineRoute(prefs); err != nil {
		t.Fatalf("aiOnlineRoute() error = %v, want the online route to be ready", err)
	}
	route, err := chatLanguageRoute(prefs)
	if err != nil {
		t.Fatalf("chatLanguageRoute() error = %v", err)
	}
	if route.provider == AIProviderOnline || route.endpoint != "http://127.0.0.1:8080" {
		t.Fatalf("chatLanguageRoute() = %+v, want the local endpoint", route)
	}
}

func TestOnlineAITransportSendsKeyOnlyOverHTTPSToItsHost(t *testing.T) {
	var authorization string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	client := &http.Client{Transport: &onlineAITransport{host: strings.ToLower(parsed.Host), key: "test-key", base: server.Client().Transport}}

	response, err := client.Get(server.URL + "/chat/completions")
	if err != nil {
		t.Fatalf("GET over HTTPS to the configured host error = %v", err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatalf("close response body: %v", err)
	}
	if authorization != "Bearer test-key" {
		t.Fatalf("Authorization = %q, want the bearer key", authorization)
	}

	for _, target := range []string{"http://" + parsed.Host + "/chat/completions", "https://example.org/chat/completions"} {
		if response, err := client.Get(target); err == nil {
			_ = response.Body.Close()
			t.Fatalf("online transport sent a request to %s", target)
		}
	}
}

func TestOnlineRequestOmitsLocalOnlyOptions(t *testing.T) {
	messages := []AIMessage{{Role: "user", Content: "Hi"}}
	options := aiCompletionOptions{Chat: true, ChatTemplateKwargs: aiThinkingDisabled()}

	body, requestPath, err := encodeAICompletionRequest(AIProviderOnline, "openai/gpt-4o-mini", messages, options, false)
	if err != nil {
		t.Fatalf("encode online request: %v", err)
	}
	if requestPath != "/chat/completions" {
		t.Fatalf("online request path = %q, want /chat/completions", requestPath)
	}
	for _, field := range []string{`"top_k"`, `"chat_template_kwargs"`} {
		if strings.Contains(string(body), field) {
			t.Fatalf("online request includes llama-server field %s", field)
		}
	}

	body, requestPath, err = encodeAICompletionRequest(AIProviderOpenAICompatible, "local.gguf", messages, options, false)
	if err != nil {
		t.Fatalf("encode local request: %v", err)
	}
	if requestPath != "/v1/chat/completions" || !strings.Contains(string(body), `"top_k"`) {
		t.Fatalf("local request path = %q, body = %s", requestPath, body)
	}
}
