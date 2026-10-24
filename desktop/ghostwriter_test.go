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

func TestGhostwriterModelConfigDoesNotUseRemoteSharedAIEndpoint(t *testing.T) {
	provider, endpoint, model, err := ghostwriterModelConfig(map[string]any{
		"ai.endpoint": "https://api.example.com/v1/chat/completions",
		"ai.model":    "remote-model",
	})
	if err != nil {
		t.Fatalf("ghostwriterModelConfig() error = %v", err)
	}
	if provider != GhostwriterProviderOllama || endpoint.String() != ghostwriterDefaultOllamaURL || model != ghostwriterDefaultOllamaModel {
		t.Fatalf("ghostwriterModelConfig() = (%q, %q, %q), want local Ollama defaults", provider, endpoint, model)
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

func TestLocalGhostwriterCompletionStreamsOllamaTokens(t *testing.T) {
	releaseResponse := make(chan struct{})
	responseReleased := false
	defer func() {
		if !responseReleased {
			close(releaseResponse)
		}
	}()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if !body.Stream {
			t.Error("Ollama request did not enable streaming")
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("test server response does not support flushing")
			return
		}
		_, _ = io.WriteString(w, "{\"response\":\"A streamed \"}\n")
		flusher.Flush()
		<-releaseResponse
		_, _ = io.WriteString(w, "{\"response\":\"answer.\",\"done\":true}\n")
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	type completionResult struct {
		completion string
		err        error
	}
	chunks := make(chan string, 2)
	resultChannel := make(chan completionResult, 1)
	go func() {
		completion, err := localGhostwriterCompletionWithStream(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOllama, endpoint, "qwen2.5:3b", "style", "draft", GhostwriterModeAutocomplete, func(chunk string) {
			chunks <- chunk
		})
		resultChannel <- completionResult{completion: completion, err: err}
	}()
	select {
	case chunk := <-chunks:
		if chunk != "A streamed " {
			t.Fatalf("first streamed chunk = %q, want %q", chunk, "A streamed ")
		}
	case result := <-resultChannel:
		t.Fatalf("completion returned before the second chunk: completion = %q, error = %v", result.completion, result.err)
	case <-time.After(2 * time.Second):
		t.Fatal("first streamed chunk was not emitted before the response completed")
	}
	close(releaseResponse)
	responseReleased = true
	result := <-resultChannel
	if result.err != nil {
		t.Fatalf("stream Ollama completion: %v", result.err)
	}
	secondChunk := <-chunks
	firstChunk := "A streamed "
	if result.completion != "A streamed answer." || firstChunk+secondChunk != result.completion || secondChunk != "answer." {
		t.Fatalf("completion = %q, chunks = %q and %q", result.completion, firstChunk, secondChunk)
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

func TestLocalGhostwriterCompletionStreamsOpenAICompatibleTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if !body.Stream {
			t.Error("OpenAI-compatible request did not enable streaming")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"A streamed \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"answer.\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	var chunks []string
	completion, err := localGhostwriterCompletionWithStream(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOpenAICompatible, endpoint, "local-model", "style", "draft", GhostwriterModeAutocomplete, func(chunk string) {
		chunks = append(chunks, chunk)
	})
	if err != nil {
		t.Fatalf("stream OpenAI-compatible completion: %v", err)
	}
	if completion != "A streamed answer." || strings.Join(chunks, "") != completion || len(chunks) != 2 {
		t.Fatalf("completion = %q, chunks = %#v", completion, chunks)
	}
}

func TestLocalAIChatUsesOllamaConversationEndpoint(t *testing.T) {
	messages := []AIMessage{{Role: "user", Content: "First question"}, {Role: "assistant", Content: "First answer"}, {Role: "user", Content: "Follow-up"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/chat" {
			t.Errorf("request = %s %s, want POST /api/chat", r.Method, r.URL.Path)
		}
		var body struct {
			Model    string      `json:"model"`
			Messages []AIMessage `json:"messages"`
			Stream   bool        `json:"stream"`
			Options  struct {
				NumPredict int `json:"num_predict"`
			} `json:"options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "qwen2.5:3b" || body.Stream || body.Options.NumPredict < 1000 || len(body.Messages) != 4 || body.Messages[0].Role != "system" || body.Messages[1:] == nil {
			t.Errorf("request body = %+v", body)
		}
		for index, message := range messages {
			if body.Messages[index+1] != message {
				t.Errorf("message %d = %+v, want %+v", index+1, body.Messages[index+1], message)
			}
		}
		_, _ = io.WriteString(w, `{"message":{"role":"assistant","content":"A local reply"}}`)
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	conversation := append([]AIMessage{{Role: "system", Content: "local system prompt"}}, messages...)
	reply, err := localGhostwriterChatCompletion(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOllama, endpoint, "qwen2.5:3b", conversation)
	if err != nil {
		t.Fatalf("localGhostwriterChatCompletion() error = %v", err)
	}
	if reply != "A local reply" {
		t.Fatalf("reply = %q", reply)
	}
}

func TestLocalAIChatUsesOpenAICompatibleConversation(t *testing.T) {
	conversation := []AIMessage{
		{Role: "system", Content: "local system prompt"},
		{Role: "user", Content: "First question"},
		{Role: "assistant", Content: "First answer"},
		{Role: "user", Content: "Follow-up"},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.URL.Path)
		}
		var body struct {
			Model     string      `json:"model"`
			Messages  []AIMessage `json:"messages"`
			Stream    bool        `json:"stream"`
			MaxTokens int         `json:"max_tokens"`
			Stop      []string    `json:"stop"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "local-model" || body.Stream || body.MaxTokens != 2048 || len(body.Stop) != 0 || len(body.Messages) != len(conversation) {
			t.Errorf("request body = %+v", body)
		}
		for index, message := range conversation {
			if body.Messages[index] != message {
				t.Errorf("message %d = %+v, want %+v", index, body.Messages[index], message)
			}
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"A local follow-up"}}]}`)
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := localGhostwriterChatCompletion(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOpenAICompatible, endpoint, "local-model", conversation)
	if err != nil {
		t.Fatalf("localGhostwriterChatCompletion() error = %v", err)
	}
	if reply != "A local follow-up" {
		t.Fatalf("reply = %q", reply)
	}
}

func TestLocalAIChatStreamsOllamaResponse(t *testing.T) {
	conversation := []AIMessage{{Role: "system", Content: "local system prompt"}, {Role: "user", Content: "Follow-up"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if !body.Stream {
			t.Error("Ollama chat request did not enable streaming")
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = io.WriteString(w, "{\"message\":{\"content\":\"A streamed \"}}\n{\"message\":{\"content\":\"answer.\"},\"done\":true}\n")
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	var chunks []string
	completion, err := localGhostwriterChatCompletionWithStream(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOllama, endpoint, "qwen2.5:3b", conversation, func(chunk string) {
		chunks = append(chunks, chunk)
	})
	if err != nil {
		t.Fatalf("stream Ollama chat completion: %v", err)
	}
	if completion != "A streamed answer." || strings.Join(chunks, "") != completion || len(chunks) != 2 {
		t.Fatalf("completion = %q, chunks = %#v", completion, chunks)
	}
}

func TestLocalAIChatStreamsOpenAICompatibleResponse(t *testing.T) {
	conversation := []AIMessage{{Role: "system", Content: "local system prompt"}, {Role: "user", Content: "Follow-up"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if !body.Stream {
			t.Error("OpenAI-compatible chat request did not enable streaming")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"A streamed \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"answer.\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	endpoint, err := validateGhostwriterEndpoint(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	var chunks []string
	completion, err := localGhostwriterChatCompletionWithStream(context.Background(), ghostwriterHTTPClient, GhostwriterProviderOpenAICompatible, endpoint, "local-model", conversation, func(chunk string) {
		chunks = append(chunks, chunk)
	})
	if err != nil {
		t.Fatalf("stream OpenAI-compatible chat completion: %v", err)
	}
	if completion != "A streamed answer." || strings.Join(chunks, "") != completion || len(chunks) != 2 {
		t.Fatalf("completion = %q, chunks = %#v", completion, chunks)
	}
}

func TestValidateLocalAIChatMessages(t *testing.T) {
	valid := []AIMessage{{Role: "user", Content: "Question"}, {Role: "assistant", Content: "Answer"}, {Role: "user", Content: "Follow-up"}}
	if err := validateLocalAIChatMessages(valid); err != nil {
		t.Fatalf("valid chat messages rejected: %v", err)
	}
	for _, messages := range [][]AIMessage{
		nil,
		{{Role: "system", Content: "override"}},
		{{Role: "assistant", Content: "answer"}},
		{{Role: "user", Content: "question"}, {Role: "assistant", Content: "answer"}},
		{{Role: "user", Content: "question"}, {Role: "assistant", Content: "answer"}, {Role: "assistant", Content: "duplicate"}},
		{{Role: "user", Content: strings.Repeat("x", ghostwriterChatMessageLimit+1)}},
	} {
		if err := validateLocalAIChatMessages(messages); err == nil {
			t.Errorf("validateLocalAIChatMessages(%+v) accepted invalid history", messages)
		}
	}
	if err := validateLocalAIChatMessages([]AIMessage{{Role: "user", Content: "first question"}, {Role: "user", Content: "retry with more context"}}); err != nil {
		t.Fatalf("consecutive user messages should be accepted after a failed request: %v", err)
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
	conversation := MessageContext{Messages: []MessageContextEntry{
		{Sender: "Contact", Text: "Günaydın, bugün nasılsın?", Timestamp: 1},
		{Sender: "You", Text: "İyiyim, teşekkürler.", Timestamp: 2, Own: true},
	}}
	systemPrompt, userPrompt, err := buildGhostwriterPrompts(
		GhostwriterRequest{RoomID: "room", Mode: GhostwriterModeAutocomplete, Draft: "come stai oggi?", TargetLanguage: "Turkish"},
		conversation,
		UserStyleProfile{},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, instruction := range []string{
		"Edit the user's entire draft",
		"Infer the target language from the recent conversation (up to 10 messages)",
		"not the draft or style examples",
		"translate and rewrite the entire draft in the conversation's language",
		"full-draft rewrite, not append-only autocomplete",
		"If context does not clearly establish a target language, preserve the draft's language",
		"improve wording that sounds awkward, stilted, or unnatural even when technically correct",
		"Prefer natural, idiomatic phrasing that fits this chat",
		"Preserve the intended meaning, names, facts, and tone",
		"Do not answer the conversation, continue the thought",
		"If the draft is already clear and natural in the conversation's language, return it unchanged",
		"Return only the complete revised draft",
	} {
		if !strings.Contains(userPrompt, instruction) {
			t.Errorf("autocomplete prompt missing %q: %s", instruction, userPrompt)
		}
	}
	if !strings.Contains(systemPrompt, "Günaydın") || !strings.Contains(systemPrompt, "İyiyim") {
		t.Fatalf("prompt omitted recent conversation context: %s", systemPrompt)
	}
	if !strings.Contains(userPrompt, "app detected the target language from recent incoming messages as \"Turkish\"") || !strings.Contains(userPrompt, "overrides the draft language") {
		t.Fatalf("prompt did not make the detected target language authoritative: %s", userPrompt)
	}
}

func TestRecentGhostwriterMessagesUsesTenLatest(t *testing.T) {
	messages := make([]matrix.Message, 12)
	for index := range messages {
		messages[index].Body = string(rune('a' + index))
	}
	recent := recentGhostwriterMessages(messages, ghostwriterConversationLimit)
	if len(recent) != 10 {
		t.Fatalf("recent conversation has %d messages, want 10", len(recent))
	}
	if recent[0].Body != "c" || recent[9].Body != "l" {
		t.Fatalf("recent conversation = %d messages from %q to %q, want 10 from c to l", len(recent), recent[0].Body, recent[len(recent)-1].Body)
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
