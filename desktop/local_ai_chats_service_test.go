package desktop

import (
	"strings"
	"testing"
)

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
