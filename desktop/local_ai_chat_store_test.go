package desktop

import (
	"errors"
	"path/filepath"
	"testing"
)

func openTestLocalAIChatStore(t *testing.T) (*localAIChatStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), localAIChatFileName)
	store, err := openLocalAIChatStore(path)
	if err != nil {
		t.Fatalf("openLocalAIChatStore() error = %v", err)
	}
	t.Cleanup(func() { _ = store.close() })
	return store, path
}

func TestLocalAIChatStorePersistsChatsAcrossReopen(t *testing.T) {
	store, path := openTestLocalAIChatStore(t)
	chat, err := store.create("agent-1", 1000)
	if err != nil {
		t.Fatalf("create() error = %v", err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "  How do\n  I test?  ", Status: "complete"}, 1001); err != nil {
		t.Fatalf("appendMessage(user) error = %v", err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "assistant", Content: "Like this.", Status: "stopped"}, 1002); err != nil {
		t.Fatalf("appendMessage(assistant) error = %v", err)
	}
	if err := store.close(); err != nil {
		t.Fatalf("close() error = %v", err)
	}

	reopened, err := openLocalAIChatStore(path)
	if err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	defer func() { _ = reopened.close() }()
	chats, err := reopened.list()
	if err != nil {
		t.Fatalf("list() error = %v", err)
	}
	if len(chats) != 1 || chats[0].ID != chat.ID || chats[0].Title != "How do I test?" || chats[0].AgentID != "agent-1" || chats[0].UpdatedAt != 1002 {
		t.Fatalf("chats = %+v", chats)
	}
	messages, err := reopened.messages(chat.ID)
	if err != nil {
		t.Fatalf("messages() error = %v", err)
	}
	if len(messages) != 2 || messages[0].Seq != 1 || messages[1].Seq != 2 || messages[1].Status != "stopped" || messages[1].Content != "Like this." {
		t.Fatalf("messages = %+v", messages)
	}
	if messages[0].Attachments == nil || len(messages[0].Attachments) != 0 {
		t.Fatalf("attachments = %#v, want empty non-nil slice", messages[0].Attachments)
	}
}

func TestLocalAIChatStoreListsMostRecentlyUpdatedFirst(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	older, err := store.create("", 100)
	if err != nil {
		t.Fatal(err)
	}
	newer, err := store.create("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(older.ID, LocalAIChatMessage{Role: "user", Content: "Bump"}, 300); err != nil {
		t.Fatal(err)
	}
	chats, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 2 || chats[0].ID != older.ID || chats[1].ID != newer.ID {
		t.Fatalf("chats order = %+v", chats)
	}
}

func TestLocalAIChatStoreTruncateRemovesTurnsAndResetsTitle(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	chat, err := store.create("", 1)
	if err != nil {
		t.Fatal(err)
	}
	for seq, message := range []LocalAIChatMessage{
		{Role: "user", Content: "First question"},
		{Role: "assistant", Content: "First answer"},
		{Role: "user", Content: "Second question"},
	} {
		if _, err := store.appendMessage(chat.ID, message, int64(seq+2)); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.truncate(chat.ID, 2, 10); err != nil {
		t.Fatalf("truncate(2) error = %v", err)
	}
	messages, err := store.messages(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Content != "First question" {
		t.Fatalf("messages after truncate(2) = %+v", messages)
	}
	chats, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if chats[0].Title != "First question" {
		t.Fatalf("title after truncate(2) = %q", chats[0].Title)
	}

	if err := store.truncate(chat.ID, 1, 11); err != nil {
		t.Fatalf("truncate(1) error = %v", err)
	}
	messages, err = store.messages(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 0 {
		t.Fatalf("messages after truncate(1) = %+v", messages)
	}
	chats, err = store.list()
	if err != nil {
		t.Fatal(err)
	}
	if chats[0].Title != "" {
		t.Fatalf("title after truncate(1) = %q, want empty", chats[0].Title)
	}
	if err := store.truncate("0123456789abcdef0123456789abcdef", 1, 12); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("truncate(missing) error = %v, want errLocalAIChatNotFound", err)
	}
}

func TestLocalAIChatStoreRenameSetAgentAndDeleteCascade(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	chat, err := store.create("agent-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Hello"}, 2); err != nil {
		t.Fatal(err)
	}
	if err := store.rename(chat.ID, "Renamed"); err != nil {
		t.Fatalf("rename() error = %v", err)
	}
	if err := store.setAgent(chat.ID, "agent-2"); err != nil {
		t.Fatalf("setAgent() error = %v", err)
	}
	chats, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].Title != "Renamed" || chats[0].AgentID != "agent-2" {
		t.Fatalf("chats = %+v", chats)
	}
	if err := store.delete(chat.ID); err != nil {
		t.Fatalf("delete() error = %v", err)
	}
	messages, err := store.messages(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 0 {
		t.Fatalf("messages after delete = %+v, want cascade", messages)
	}
	if err := store.delete(chat.ID); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("delete(missing) error = %v, want errLocalAIChatNotFound", err)
	}
	if err := store.rename(chat.ID, "Gone"); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("rename(missing) error = %v, want errLocalAIChatNotFound", err)
	}
	if err := store.setAgent(chat.ID, ""); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("setAgent(missing) error = %v, want errLocalAIChatNotFound", err)
	}
}

func TestLocalAIChatStoreAppendToMissingChatFails(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	_, err := store.appendMessage("0123456789abcdef0123456789abcdef", LocalAIChatMessage{Role: "user", Content: "Hi"}, 1)
	if !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("appendMessage(missing) error = %v, want errLocalAIChatNotFound", err)
	}
}

func TestLocalAIChatStoreKeepsTitleFromFirstUserTurn(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	chat, err := store.create("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Original topic"}, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Later topic"}, 3); err != nil {
		t.Fatal(err)
	}
	chats, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if chats[0].Title != "Original topic" {
		t.Fatalf("title = %q, want first user turn", chats[0].Title)
	}
}
