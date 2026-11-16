package desktop

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLocalAIChatSendsConversationAndAgentInstructions(t *testing.T) {
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
		if body.Model != "local-model" || body.Stream || body.MaxTokens != localAIChatDefaultMaxTokens || len(body.Stop) != 0 {
			t.Errorf("request body = %+v", body)
		}
		if len(body.Messages) != 4 {
			t.Errorf("messages = %d, want 4", len(body.Messages))
			return
		}
		if body.Messages[0].Role != "system" || !strings.Contains(body.Messages[0].Content, "Agent instructions:\nKeep answers short.") {
			t.Errorf("system message = %+v", body.Messages[0])
		}
		if body.Messages[3].Role != "user" || body.Messages[3].Content != "Follow-up" {
			t.Errorf("last message = %+v, want user Follow-up", body.Messages[3])
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"A local follow-up"}}]}`)
	}))
	defer server.Close()

	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if err := store.Set("ai.endpoint", server.URL); err != nil {
		t.Fatalf("Set(ai.endpoint) error = %v", err)
	}
	if err := store.Set("ai.model", "local-model"); err != nil {
		t.Fatalf("Set(ai.model) error = %v", err)
	}
	service := &AppService{preferences: store}

	reply, err := service.LocalAIChat(LocalAIChatRequest{
		Messages: []AIMessage{
			{Role: "user", Content: "First question"},
			{Role: "assistant", Content: "First answer"},
			{Role: "user", Content: "Follow-up"},
		},
		RequestID:         "local-chat-test",
		AgentInstructions: "Keep answers short.",
	})
	if err != nil {
		t.Fatalf("LocalAIChat() error = %v", err)
	}
	if reply != "A local follow-up" {
		t.Fatalf("reply = %q", reply)
	}
}

func TestLocalAIChatServiceCreatesKinds(t *testing.T) {
	service := &AppService{dataDir: t.TempDir()}
	t.Cleanup(service.closeLocalAIChatStore)

	summary, err := service.CreateLocalAIChat("", localAIChatKindSummary)
	if err != nil || summary.Kind != localAIChatKindSummary {
		t.Fatalf("summary chat = %+v, err = %v", summary, err)
	}
	plain, err := service.CreateLocalAIChat("", "")
	if err != nil || plain.Kind != localAIChatKindChat {
		t.Fatalf("default chat = %+v, err = %v", plain, err)
	}
	if _, err := service.CreateLocalAIChat("", "notes"); err == nil {
		t.Error("CreateLocalAIChat accepted an unknown kind")
	}
	chats, err := service.ListLocalAIChats()
	if err != nil {
		t.Fatalf("ListLocalAIChats() error = %v", err)
	}
	kinds := map[string]string{}
	for _, chat := range chats {
		kinds[chat.ID] = chat.Kind
	}
	if len(chats) != 2 || kinds[summary.ID] != localAIChatKindSummary || kinds[plain.ID] != localAIChatKindChat {
		t.Fatalf("chats = %+v", chats)
	}
}

func TestCleanLocalAIChatTitle(t *testing.T) {
	cases := []struct {
		reply string
		want  string
	}{
		{"\"Trip planning.\"", "Trip planning"},
		{"Title: Lisbon in June\n\nBecause", "Lisbon in June"},
		{"  **Weekly   budget**  ", "Weekly budget"},
		{"\n\n", ""},
		{"“Quiet morning walk”", "Quiet morning walk"},
	}
	for _, tc := range cases {
		if got := cleanLocalAIChatTitle(tc.reply); got != tc.want {
			t.Errorf("cleanLocalAIChatTitle(%q) = %q, want %q", tc.reply, got, tc.want)
		}
	}
	long := strings.Repeat("é", localAIChatTitleLimit+5)
	if got := len([]rune(cleanLocalAIChatTitle(long))); got != localAIChatTitleLimit {
		t.Errorf("long title has %d runes, want %d", got, localAIChatTitleLimit)
	}
}

func TestGenerateLocalAIChatTitleReplacesOnlyDerivedTitles(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Messages           []AIMessage    `json:"messages"`
			ChatTemplateKwargs map[string]any `json:"chat_template_kwargs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if len(body.Messages) != 2 || !strings.Contains(body.Messages[1].Content, "Plan a trip to Lisbon") {
			t.Errorf("title messages = %+v", body.Messages)
		}
		if body.ChatTemplateKwargs["enable_thinking"] != false {
			t.Errorf("chat_template_kwargs = %+v, want thinking disabled", body.ChatTemplateKwargs)
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"\"Trip planning.\""}}]}`)
	}))
	defer server.Close()

	preferences, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if err := preferences.Set("ai.endpoint", server.URL); err != nil {
		t.Fatalf("Set(ai.endpoint) error = %v", err)
	}
	if err := preferences.Set("ai.model", "local-model"); err != nil {
		t.Fatalf("Set(ai.model) error = %v", err)
	}
	service := &AppService{dataDir: t.TempDir(), preferences: preferences}
	t.Cleanup(service.closeLocalAIChatStore)

	chat, err := service.CreateLocalAIChat("", localAIChatKindSummary)
	if err != nil {
		t.Fatalf("CreateLocalAIChat() error = %v", err)
	}
	if _, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Plan a trip to Lisbon in June"}); err != nil {
		t.Fatalf("AppendLocalAIChatMessage(user) error = %v", err)
	}

	// Without a reply there is nothing to title from, so the model is not called.
	title, err := service.GenerateLocalAIChatTitle(chat.ID)
	if err != nil || title != "Plan a trip to Lisbon in June" || calls.Load() != 0 {
		t.Fatalf("title before reply = %q, err = %v, calls = %d", title, err, calls.Load())
	}

	if _, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "assistant", Content: "Here is a plan."}); err != nil {
		t.Fatalf("AppendLocalAIChatMessage(assistant) error = %v", err)
	}
	title, err = service.GenerateLocalAIChatTitle(chat.ID)
	if err != nil || title != "Trip planning" || calls.Load() != 1 {
		t.Fatalf("generated title = %q, err = %v, calls = %d", title, err, calls.Load())
	}

	// The generated title is no longer derived from the first turn, so a second call keeps it.
	title, err = service.GenerateLocalAIChatTitle(chat.ID)
	if err != nil || title != "Trip planning" || calls.Load() != 1 {
		t.Fatalf("second title = %q, err = %v, calls = %d", title, err, calls.Load())
	}

	renamed, err := service.CreateLocalAIChat("", "")
	if err != nil {
		t.Fatalf("CreateLocalAIChat() error = %v", err)
	}
	if _, err := service.AppendLocalAIChatMessage(renamed.ID, LocalAIChatMessage{Role: "user", Content: "Budget notes"}); err != nil {
		t.Fatalf("AppendLocalAIChatMessage(user) error = %v", err)
	}
	if _, err := service.AppendLocalAIChatMessage(renamed.ID, LocalAIChatMessage{Role: "assistant", Content: "Here are notes."}); err != nil {
		t.Fatalf("AppendLocalAIChatMessage(assistant) error = %v", err)
	}
	if err := service.RenameLocalAIChat(renamed.ID, "My budget"); err != nil {
		t.Fatalf("RenameLocalAIChat() error = %v", err)
	}
	title, err = service.GenerateLocalAIChatTitle(renamed.ID)
	if err != nil || title != "My budget" || calls.Load() != 1 {
		t.Fatalf("renamed title = %q, err = %v, calls = %d", title, err, calls.Load())
	}
}

func TestExportLocalAIChatWritesChosenPath(t *testing.T) {
	target := filepath.Join(t.TempDir(), "chat.txt")
	service := &AppService{chooseSavePath: func(_, filename string) (string, error) {
		if filename != "chat.txt" {
			t.Errorf("save dialog filename = %q, want chat.txt", filename)
		}
		return target, nil
	}}
	saved, err := service.ExportLocalAIChat("../chat.txt", "Ann: hi\n")
	if err != nil || saved != target {
		t.Fatalf("ExportLocalAIChat() = %q, %v; want %q", saved, err, target)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "Ann: hi\n" {
		t.Fatalf("exported file = %q, %v", data, err)
	}

	service.chooseSavePath = func(_, _ string) (string, error) { return "", nil }
	saved, err = service.ExportLocalAIChat("chat.txt", "Ann: hi\n")
	if err != nil || saved != "" {
		t.Fatalf("cancelled export = %q, %v; want empty path and nil error", saved, err)
	}
	if _, err := service.ExportLocalAIChat("chat.txt", ""); err == nil {
		t.Fatal("empty export accepted")
	}
	if _, err := (&AppService{}).ExportLocalAIChat("chat.txt", "Ann: hi"); err == nil {
		t.Fatal("export without a save dialog accepted")
	}
}

func TestLocalAIChatIDValidation(t *testing.T) {
	if err := validateLocalAIChatID("0123456789abcdef0123456789abcdef"); err != nil {
		t.Fatalf("valid id rejected: %v", err)
	}
	for _, chatID := range []string{"", "0123456789ABCDEF0123456789ABCDEF", "0123", "../0123456789abcdef0123456789abc"} {
		if err := validateLocalAIChatID(chatID); err == nil {
			t.Errorf("validateLocalAIChatID(%q) accepted invalid id", chatID)
		}
	}
}
