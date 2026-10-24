package desktop

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mychat/matrix"
)

func TestStylometryServiceProfilesOutgoingText(t *testing.T) {
	base := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
	messages := []matrix.Message{
		{Own: true, Body: "hey thanks 😄", Timestamp: base},
		{Own: true, Body: "i'll check... 😄", Timestamp: base.Add(time.Minute)},
		{Own: true, Body: "Please send the details.", Timestamp: base.Add(10 * time.Minute)},
		{Own: false, Body: "not a user example", Timestamp: base.Add(11 * time.Minute)},
		{Own: true, Body: "redacted text", Redacted: true, Timestamp: base.Add(12 * time.Minute)},
		{Own: true, Body: "failed send", SendError: "failed", Timestamp: base.Add(13 * time.Minute)},
		{Own: true, Body: "voice note", MediaURI: "mxc://example/audio", Timestamp: base.Add(14 * time.Minute)},
	}
	profile := (StylometryService{}).Profile(messages)
	if profile.SampleCount != 3 {
		t.Fatalf("SampleCount = %d, want 3", profile.SampleCount)
	}
	if profile.Casing != "mostly lowercase" {
		t.Fatalf("Casing = %q, want mostly lowercase", profile.Casing)
	}
	if profile.EllipsisRate == 0 || profile.PeriodRate == 0 {
		t.Fatalf("punctuation profile = %+v, want ellipsis and period usage", profile)
	}
	if profile.AverageWordCount == 0 || profile.AverageMessagesPerBurst != 1.5 {
		t.Fatalf("length/chunking profile = %+v", profile)
	}
	if len(profile.Emojis) != 1 || profile.Emojis[0].Emoji != "😄" || profile.Emojis[0].Count != 2 {
		t.Fatalf("Emojis = %+v, want two 😄", profile.Emojis)
	}
}

func TestValidateGhostwriterEndpointOnlyAllowsLoopbackHTTP(t *testing.T) {
	for _, endpoint := range []string{
		"http://localhost:11434",
		"http://127.0.0.1:8080",
		"http://[::1]:8080",
	} {
		if _, err := validateGhostwriterEndpoint(endpoint); err != nil {
			t.Errorf("validateGhostwriterEndpoint(%q) error = %v", endpoint, err)
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
		if _, err := validateGhostwriterEndpoint(endpoint); err == nil {
			t.Errorf("validateGhostwriterEndpoint(%q) accepted a non-local endpoint", endpoint)
		}
	}
}

func TestGhostwriterModelConfigUsesConfiguredLoopbackAIEndpoint(t *testing.T) {
	provider, endpoint, model, err := ghostwriterModelConfig(map[string]any{
		"ghostwriter.provider": "ollama",
		"ai.endpoint":          "http://127.0.0.1:11434",
		"ai.model":             "local-model",
	})
	if err != nil {
		t.Fatalf("ghostwriterModelConfig() error = %v", err)
	}
	if provider != GhostwriterProviderOpenAICompatible || endpoint.String() != "http://127.0.0.1:11434" || model != "local-model" {
		t.Fatalf("ghostwriterModelConfig() = (%q, %q, %q), want OpenAI-compatible local model", provider, endpoint, model)
	}
}

func TestGhostwriterModelConfigKeepsExplicitGhostwriterEndpoint(t *testing.T) {
	provider, endpoint, model, err := ghostwriterModelConfig(map[string]any{
		"ghostwriter.provider": "ollama",
		"ghostwriter.endpoint": "http://localhost:11434",
		"ghostwriter.model":    "custom-model",
		"ai.endpoint":          "http://127.0.0.1:8080",
		"ai.model":             "shared-model",
	})
	if err != nil {
		t.Fatalf("ghostwriterModelConfig() error = %v", err)
	}
	if provider != GhostwriterProviderOllama || endpoint.String() != "http://127.0.0.1:11434" || model != "custom-model" {
		t.Fatalf("ghostwriterModelConfig() = (%q, %q, %q), want explicit Ghostwriter configuration", provider, endpoint, model)
	}
}

func TestGhostwriterHTTPClientDisablesProxyAndRejectsNonLoopback(t *testing.T) {
	transport, ok := ghostwriterHTTPClient.Transport.(*http.Transport)
	if !ok || transport.Proxy != nil || transport.DialContext == nil {
		t.Fatal("Ghostwriter HTTP client must use a no-proxy loopback transport")
	}
	if _, err := dialGhostwriterLoopback(context.Background(), "tcp", "192.0.2.1:80"); err == nil {
		t.Fatal("dialGhostwriterLoopback accepted a non-loopback address")
	}
}

func TestLocalGhostwriterCompletionUsesOllamaGenerate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/generate" {
			t.Errorf("request = %s %s, want POST /api/generate", r.Method, r.URL.Path)
		}
		var body struct {
			Model   string `json:"model"`
			System  string `json:"system"`
			Prompt  string `json:"prompt"`
			Stream  bool   `json:"stream"`
			Options struct {
				Stop []string `json:"stop"`
			} `json:"options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "qwen2.5:3b" || body.Stream || body.System != "style profile" || body.Prompt != "complete this" {
			t.Errorf("request body = %+v", body)
		}
		if len(body.Options.Stop) == 0 {
			t.Error("Ollama request omitted stop sequences")
		}
		_, _ = io.WriteString(w, `{"response":"thanks for the update"}`)
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := localGhostwriterCompletion(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOllama, endpoint, "qwen2.5:3b", "style profile", "complete this", GhostwriterModeAutocomplete)
	if err != nil {
		t.Fatalf("localGhostwriterCompletion() error = %v", err)
	}
	if reply != "thanks for the update" {
		t.Fatalf("reply = %q", reply)
	}
}

func TestLocalGhostwriterCompletionUsesOpenAICompatibleChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.URL.Path)
		}
		var body struct {
			Model          string      `json:"model"`
			Messages       []AIMessage `json:"messages"`
			Stream         bool        `json:"stream"`
			Stop           []string    `json:"stop"`
			MaxTokens      int         `json:"max_tokens"`
			ResponseFormat struct {
				Type string `json:"type"`
			} `json:"response_format"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "local-model" || body.Stream || len(body.Messages) != 2 || body.Messages[0].Role != "system" || len(body.Stop) == 0 || body.MaxTokens < 400 || body.ResponseFormat.Type != "json_object" {
			t.Errorf("request body = %+v", body)
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"{\"suggestions\":[{\"kind\":\"direct\",\"text\":\"A local draft\"}] }"}}]}`)
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := localGhostwriterCompletion(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOpenAICompatible, endpoint, "local-model", "style profile", "draft a reply", GhostwriterModeChips)
	if err != nil {
		t.Fatalf("localGhostwriterCompletion() error = %v", err)
	}
	if !strings.Contains(reply, `"kind":"direct"`) {
		t.Fatalf("reply = %q", reply)
	}
}

func TestParseGhostwriterSuggestions(t *testing.T) {
	chips, err := parseGhostwriterSuggestions(GhostwriterModeChips, "", "", `{"suggestions":[{"kind":"direct","text":"I'll send it over."},{"kind":"warm","text":"Absolutely, I'll send it over!"},{"kind":"alternative","text":"Would tomorrow work better?"}]}`)
	if err != nil {
		t.Fatalf("parseGhostwriterSuggestions(chips) error = %v", err)
	}
	if len(chips) != 3 || chips[0].Type != "chip" || chips[0].Label != "Direct" || chips[2].Label != "Alternative" {
		t.Fatalf("chips = %+v", chips)
	}
	completion, err := parseGhostwriterSuggestions(GhostwriterModeAutocomplete, "Pazar o zaman ?", "", "Pazar, o zaman mı?")
	if err != nil || len(completion) != 1 || completion[0].Text != "Pazar, o zaman mı?" {
		t.Fatalf("autocomplete = %+v, error = %v", completion, err)
	}
	slash, err := parseGhostwriterSuggestions(GhostwriterModeSlash, "", "decline politely", "I appreciate the offer, but I can't make it.")
	if err != nil || len(slash) != 1 || slash[0].Type != "slash_result" || slash[0].Label != "decline politely" {
		t.Fatalf("slash result = %+v, error = %v", slash, err)
	}
}

func TestBuildGhostwriterAutocompletePromptEditsInsteadOfAppending(t *testing.T) {
	_, userPrompt, err := buildGhostwriterPrompts(
		GhostwriterRequest{RoomID: "room", Mode: GhostwriterModeAutocomplete, Draft: "Pazar o zaman ?"},
		MessageContext{},
		UserStyleProfile{},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, instruction := range []string{
		"Edit the user's entire draft in the same language",
		"improve wording that sounds awkward, stilted, or unnatural even when technically correct",
		"Prefer natural, idiomatic phrasing that fits this chat",
		"Preserve the intended meaning",
		"Do not answer the conversation, continue the thought",
		"If the draft is already clear and natural for this context, return it unchanged",
		"Return only the complete revised draft",
	} {
		if !strings.Contains(userPrompt, instruction) {
			t.Errorf("autocomplete prompt missing %q: %s", instruction, userPrompt)
		}
	}
}

func TestBuildGhostwriterChipPromptTargetsLatestIncomingMessage(t *testing.T) {
	context := MessageContext{
		ContactName: "Contact",
		Platform:    "Telegram",
		Messages: []MessageContextEntry{
			{Sender: "Contact", Text: "Can you send the notes today?", Timestamp: 1},
		},
	}
	systemPrompt, userPrompt, err := buildGhostwriterPrompts(
		GhostwriterRequest{RoomID: "room", Mode: GhostwriterModeChips},
		context,
		UserStyleProfile{Casing: "sentence case", AverageWordCount: 8},
		[]string{"I'll take a look"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(systemPrompt, "address the newest incoming message first") ||
		!strings.Contains(userPrompt, "Do not force agreement, refusal, delay") ||
		!strings.Contains(userPrompt, `"kind":"direct"`) ||
		!strings.Contains(userPrompt, `"kind":"alternative"`) {
		t.Fatalf("reply prompt does not describe context-driven variants:\nsystem: %s\nuser: %s", systemPrompt, userPrompt)
	}
}

func TestParseGhostwriterChipsRejectsUnusableOutput(t *testing.T) {
	for _, response := range []string{
		"not JSON",
		`{"suggestions":[]}`,
		`{"suggestions":[{"kind":"direct","text":" "}]}`,
	} {
		if _, err := parseGhostwriterSuggestions(GhostwriterModeChips, "", "", response); err == nil {
			t.Errorf("parseGhostwriterSuggestions(%q) accepted malformed chips", response)
		}
	}
}

func TestParseGhostwriterChipsSalvagesPartialAndTrailingOutput(t *testing.T) {
	responses := []string{
		`{"suggestions":[{"kind":"direct","text":"That works."},{"kind":"warm","text":"Sounds good to me!"}]} Extra text`,
		`{"suggestions":[{"kind":"direct","text":"That works."},{"kind":"warm","text":"Sounds good to me!"}`,
	}
	for _, response := range responses {
		suggestions, err := parseGhostwriterSuggestions(GhostwriterModeChips, "", "", response)
		if err != nil {
			t.Fatalf("parseGhostwriterSuggestions(%q) error = %v", response, err)
		}
		if len(suggestions) != 2 || suggestions[0].Label != "Direct" || suggestions[1].Label != "Warmer" {
			t.Fatalf("suggestions = %+v, want two usable quick replies", suggestions)
		}
	}
}

func TestBuildGhostwriterPromptsKeepRoomIdentifiersOutOfPrompt(t *testing.T) {
	context := MessageContext{
		ContactID:   "!private-room:example.org",
		ContactName: "Contact",
		Platform:    "WhatsApp",
		Messages:    []MessageContextEntry{{Sender: "Contact", Text: "Are you free?", Timestamp: 1}},
	}
	systemPrompt, userPrompt, err := buildGhostwriterPrompts(
		GhostwriterRequest{RoomID: context.ContactID, Mode: GhostwriterModeSlash, Intent: "decline politely"},
		context,
		UserStyleProfile{Casing: "mostly lowercase", AverageWordCount: 8},
		[]string{"sounds good 😄"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(systemPrompt, context.ContactID) || !strings.Contains(systemPrompt, "WhatsApp") || !strings.Contains(systemPrompt, "sounds good") || !strings.Contains(userPrompt, "decline politely") {
		t.Fatalf("unexpected prompts:\nsystem: %s\nuser: %s", systemPrompt, userPrompt)
	}
}
