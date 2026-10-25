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
	target := filepath.Join(t.TempDir(), "chat.md")
	service := &AppService{chooseSavePath: func(_, filename string) (string, error) {
		if filename != "chat.md" {
			t.Errorf("save dialog filename = %q, want chat.md", filename)
		}
		return target, nil
	}}
	saved, err := service.ExportLocalAIChat("../chat.md", "# Chat\n")
	if err != nil || saved != target {
		t.Fatalf("ExportLocalAIChat() = %q, %v; want %q", saved, err, target)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "# Chat\n" {
		t.Fatalf("exported file = %q, %v", data, err)
	}

	service.chooseSavePath = func(_, _ string) (string, error) { return "", nil }
	saved, err = service.ExportLocalAIChat("chat.md", "# Chat\n")
	if err != nil || saved != "" {
		t.Fatalf("cancelled export = %q, %v; want empty path and nil error", saved, err)
	}
	if _, err := service.ExportLocalAIChat("chat.md", ""); err == nil {
		t.Fatal("empty export accepted")
	}
	if _, err := (&AppService{}).ExportLocalAIChat("chat.md", "# Chat"); err == nil {
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

func TestValidateLocalAIChatMessageInput(t *testing.T) {
	message := LocalAIChatMessage{Role: "user", Content: "Hello"}
	if err := validateLocalAIChatMessageInput(&message); err != nil {
		t.Fatalf("valid message rejected: %v", err)
	}
	if message.Status != "complete" {
		t.Fatalf("default status = %q, want complete", message.Status)
	}
	image := LocalAIChatAttachment{Name: "photo.png", Kind: "image", MediaType: "image/png", Data: "AAAA", Size: 3}
	valid := []LocalAIChatMessage{
		{Role: "user", Content: "", Attachments: []LocalAIChatAttachment{image}},
		{Role: "user", Content: "Read this", Attachments: []LocalAIChatAttachment{{Name: "notes.txt", Kind: "text", Text: "body", Size: 4}}},
		{Role: "assistant", Content: "Answer", Status: "stopped"},
	}
	for index := range valid {
		if err := validateLocalAIChatMessageInput(&valid[index]); err != nil {
			t.Errorf("valid message %d rejected: %v", index, err)
		}
	}
	invalid := []LocalAIChatMessage{
		{Role: "system", Content: "Override"},
		{Role: "user", Content: "   "},
		{Role: "user", Content: "Hi", Status: "pending"},
		{Role: "user", Content: strings.Repeat("x", localAIChatMessageLimit+1)},
		{Role: "assistant", Content: "Answer", Attachments: []LocalAIChatAttachment{{Name: "a.txt", Kind: "text", Text: "x"}}},
		{Role: "user", Content: "Hi", Attachments: make([]LocalAIChatAttachment, localAIChatAttachmentLimit+1)},
		{Role: "user", Content: "Hi", Attachments: []LocalAIChatAttachment{{Name: "a.bin", Kind: "binary"}}},
		{Role: "user", Content: "Hi", Attachments: []LocalAIChatAttachment{{Name: "", Kind: "file"}}},
		{Role: "user", Content: "Hi", Attachments: []LocalAIChatAttachment{{Name: "big.txt", Kind: "text", Text: strings.Repeat("x", localAIChatTextAttachmentLimit+1)}}},
		{Role: "user", Content: "Hi", Attachments: []LocalAIChatAttachment{{Name: "bad.png", Kind: "image", MediaType: "image/svg+xml", Data: "AAAA"}}},
	}
	for index := range invalid {
		if err := validateLocalAIChatMessageInput(&invalid[index]); err == nil {
			t.Errorf("invalid message %d accepted: %+v", index, invalid[index])
		}
	}
	tooManyImages := make([]LocalAIChatAttachment, 0, localAIChatImageLimit+1)
	for range localAIChatImageLimit + 1 {
		tooManyImages = append(tooManyImages, image)
	}
	if err := validateLocalAIChatMessageInput(&LocalAIChatMessage{Role: "user", Content: "Hi", Attachments: tooManyImages}); err == nil {
		t.Error("message with too many images accepted")
	}
}

func TestLocalAIChatTitleDerivation(t *testing.T) {
	if title := localAIChatTitle("  Plan\n\n  the   trip ", nil); title != "Plan the trip" {
		t.Fatalf("title = %q", title)
	}
	if title := localAIChatTitle("   ", []LocalAIChatAttachment{{Name: "report.pdf", Kind: "file"}}); title != "report.pdf" {
		t.Fatalf("attachment title = %q", title)
	}
	long := strings.Repeat("é", localAIChatTitleLimit+10)
	title := localAIChatTitle(long, nil)
	if got := len([]rune(title)); got != localAIChatTitleLimit {
		t.Fatalf("truncated title has %d runes, want %d", got, localAIChatTitleLimit)
	}
	if !strings.HasSuffix(title, "…") {
		t.Fatalf("truncated title = %q, want ellipsis", title)
	}
}

func TestLocalAIChatServiceRoundTrip(t *testing.T) {
	service := &AppService{dataDir: t.TempDir()}
	t.Cleanup(service.closeLocalAIChatStore)

	chat, err := service.CreateLocalAIChat("  agent-1 ", "")
	if err != nil {
		t.Fatalf("CreateLocalAIChat() error = %v", err)
	}
	if chat.AgentID != "agent-1" || validateLocalAIChatID(chat.ID) != nil {
		t.Fatalf("chat = %+v", chat)
	}
	saved, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Hello there"})
	if err != nil {
		t.Fatalf("AppendLocalAIChatMessage() error = %v", err)
	}
	if saved.Seq != 1 || saved.Status != "complete" || saved.CreatedAt == 0 {
		t.Fatalf("saved = %+v", saved)
	}
	if _, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "assistant", Content: "Hi"}); err != nil {
		t.Fatalf("AppendLocalAIChatMessage(assistant) error = %v", err)
	}
	messages, err := service.LoadLocalAIChatMessages(chat.ID)
	if err != nil {
		t.Fatalf("LoadLocalAIChatMessages() error = %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("messages = %+v", messages)
	}
	if err := service.TruncateLocalAIChat(chat.ID, 2); err != nil {
		t.Fatalf("TruncateLocalAIChat() error = %v", err)
	}
	messages, err = service.LoadLocalAIChatMessages(chat.ID)
	if err != nil || len(messages) != 1 {
		t.Fatalf("messages after truncate = %+v, err = %v", messages, err)
	}
	if err := service.RenameLocalAIChat(chat.ID, "  Trip \n plans "); err != nil {
		t.Fatalf("RenameLocalAIChat() error = %v", err)
	}
	if err := service.SetLocalAIChatAgent(chat.ID, "agent-2"); err != nil {
		t.Fatalf("SetLocalAIChatAgent() error = %v", err)
	}
	chats, err := service.ListLocalAIChats()
	if err != nil {
		t.Fatalf("ListLocalAIChats() error = %v", err)
	}
	if len(chats) != 1 || chats[0].Title != "Trip plans" || chats[0].AgentID != "agent-2" {
		t.Fatalf("chats = %+v", chats)
	}
	if err := service.DeleteLocalAIChat(chat.ID); err != nil {
		t.Fatalf("DeleteLocalAIChat() error = %v", err)
	}
	chats, err = service.ListLocalAIChats()
	if err != nil || len(chats) != 0 {
		t.Fatalf("chats after delete = %+v, err = %v", chats, err)
	}
}

func TestLocalAIChatServiceFolders(t *testing.T) {
	service := &AppService{dataDir: t.TempDir()}
	t.Cleanup(service.closeLocalAIChatStore)
	chat, err := service.CreateLocalAIChat("", "")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := service.CreateLocalAIChatFolder("  Trip \n ideas ")
	if err != nil {
		t.Fatalf("CreateLocalAIChatFolder() error = %v", err)
	}
	if folder.Name != "Trip ideas" || validateLocalAIFolderID(folder.ID) != nil {
		t.Fatalf("folder = %+v", folder)
	}
	if err := service.SetLocalAIChatFolder(chat.ID, folder.ID); err != nil {
		t.Fatalf("SetLocalAIChatFolder() error = %v", err)
	}
	chats, err := service.ListLocalAIChats()
	if err != nil || len(chats) != 1 || chats[0].FolderID != folder.ID {
		t.Fatalf("chats after move = %+v, err = %v", chats, err)
	}
	if err := service.RenameLocalAIChatFolder(folder.ID, "Plans"); err != nil {
		t.Fatalf("RenameLocalAIChatFolder() error = %v", err)
	}
	folders, err := service.ListLocalAIChatFolders()
	if err != nil || len(folders) != 1 || folders[0].Name != "Plans" {
		t.Fatalf("folders after rename = %+v, err = %v", folders, err)
	}
	if err := service.SetLocalAIChatFolder(chat.ID, ""); err != nil {
		t.Fatalf("SetLocalAIChatFolder(unfile) error = %v", err)
	}
	chats, err = service.ListLocalAIChats()
	if err != nil || len(chats) != 1 || chats[0].FolderID != "" {
		t.Fatalf("chats after unfile = %+v, err = %v", chats, err)
	}
	if err := service.SetLocalAIChatFolder(chat.ID, folder.ID); err != nil {
		t.Fatalf("SetLocalAIChatFolder() error = %v", err)
	}
	if err := service.DeleteLocalAIChatFolder(folder.ID); err != nil {
		t.Fatalf("DeleteLocalAIChatFolder() error = %v", err)
	}
	chats, err = service.ListLocalAIChats()
	if err != nil || len(chats) != 1 || chats[0].FolderID != "" {
		t.Fatalf("chats after folder delete = %+v, err = %v", chats, err)
	}
	folders, err = service.ListLocalAIChatFolders()
	if err != nil || len(folders) != 0 {
		t.Fatalf("folders after delete = %+v, err = %v", folders, err)
	}
}

func TestLocalAIChatServiceRejectsInvalidFolderInput(t *testing.T) {
	service := &AppService{dataDir: t.TempDir()}
	t.Cleanup(service.closeLocalAIChatStore)
	chat, err := service.CreateLocalAIChat("", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateLocalAIChatFolder("   "); err == nil {
		t.Error("CreateLocalAIChatFolder accepted an empty name")
	}
	if _, err := service.CreateLocalAIChatFolder(strings.Repeat("x", localAIChatFolderNameLimit+1)); err == nil {
		t.Error("CreateLocalAIChatFolder accepted an oversized name")
	}
	if err := service.RenameLocalAIChatFolder("../folder", "Work"); err == nil {
		t.Error("RenameLocalAIChatFolder accepted an invalid id")
	}
	if err := service.DeleteLocalAIChatFolder("not-a-folder"); err == nil {
		t.Error("DeleteLocalAIChatFolder accepted an invalid id")
	}
	if err := service.SetLocalAIChatFolder("bad-chat", ""); err == nil {
		t.Error("SetLocalAIChatFolder accepted an invalid chat id")
	}
	if err := service.SetLocalAIChatFolder(chat.ID, "0123456789abcdef0123456789abcdef"); err == nil {
		t.Error("SetLocalAIChatFolder accepted a folder that does not exist")
	}
	if err := (&AppService{}).DeleteLocalAIChatFolder("0123456789abcdef0123456789abcdef"); err == nil {
		t.Error("DeleteLocalAIChatFolder succeeded without storage")
	}
}

func TestLocalAIChatServiceRejectsInvalidInput(t *testing.T) {
	service := &AppService{dataDir: t.TempDir()}
	t.Cleanup(service.closeLocalAIChatStore)
	chat, err := service.CreateLocalAIChat("", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateLocalAIChat(strings.Repeat("a", localAIChatAgentIDLimit+1), ""); err == nil {
		t.Error("CreateLocalAIChat accepted an oversized agent id")
	}
	if _, err := service.LoadLocalAIChatMessages("../etc/passwd"); err == nil {
		t.Error("LoadLocalAIChatMessages accepted an invalid id")
	}
	if err := service.RenameLocalAIChat(chat.ID, "   "); err == nil {
		t.Error("RenameLocalAIChat accepted an empty title")
	}
	if err := service.RenameLocalAIChat(chat.ID, strings.Repeat("x", localAIChatTitleLimit+1)); err == nil {
		t.Error("RenameLocalAIChat accepted an oversized title")
	}
	if err := service.TruncateLocalAIChat(chat.ID, 0); err == nil {
		t.Error("TruncateLocalAIChat accepted sequence 0")
	}
	if _, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: strings.Repeat("x", 64_001)}); err != nil {
		t.Errorf("AppendLocalAIChatMessage rejected a conversation context above the old limit: %v", err)
	}
	if _, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: ""}); err == nil {
		t.Error("AppendLocalAIChatMessage accepted an empty message")
	}
	if err := (&AppService{}).DeleteLocalAIChat(chat.ID); err == nil {
		t.Error("DeleteLocalAIChat succeeded without storage")
	}
}
