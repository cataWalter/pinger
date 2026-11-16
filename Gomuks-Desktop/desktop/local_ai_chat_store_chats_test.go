package desktop

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalAIChatStoreAddsKindToExistingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-ai-chats.db")
	legacy, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`CREATE TABLE local_ai_chats (chat_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', agent_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO local_ai_chats (chat_id, title, agent_id, created_at, updated_at) VALUES ('0123456789abcdef0123456789abcdef', 'Old chat', '', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := openLocalAIChatStore(path)
	if err != nil {
		t.Fatalf("openLocalAIChatStore() error = %v", err)
	}
	chats, err := store.list()
	if err != nil || len(chats) != 1 || chats[0].Kind != localAIChatKindChat || chats[0].Title != "Old chat" {
		t.Fatalf("migrated chats = %+v, err = %v", chats, err)
	}
	if err := store.close(); err != nil {
		t.Fatal(err)
	}

	// Reopening must not fail when the column already exists.
	reopened, err := openLocalAIChatStore(path)
	if err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	t.Cleanup(func() { _ = reopened.close() })
}

func TestLocalAIChatStoreFoldersFileAndUnfileChats(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	chat, err := store.create("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Hello"}, 2); err != nil {
		t.Fatal(err)
	}
	work, err := store.createFolder("Work", 3)
	if err != nil {
		t.Fatalf("createFolder() error = %v", err)
	}
	if err := store.setChatFolder(chat.ID, work.ID); err != nil {
		t.Fatalf("setChatFolder() error = %v", err)
	}
	chats, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].FolderID != work.ID || chats[0].UpdatedAt != 2 {
		t.Fatalf("chats after move = %+v, want folder %s and updated_at kept at 2", chats, work.ID)
	}
	folders, err := store.listFolders()
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 1 || folders[0].ID != work.ID || folders[0].Name != "Work" {
		t.Fatalf("folders = %+v", folders)
	}

	if err := store.setChatFolder(chat.ID, "0123456789abcdef0123456789abcdef"); !errors.Is(err, errLocalAIFolderNotFound) {
		t.Fatalf("setChatFolder(missing folder) error = %v, want errLocalAIFolderNotFound", err)
	}
	if err := store.setChatFolder("0123456789abcdef0123456789abcdef", work.ID); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("setChatFolder(missing chat) error = %v, want errLocalAIChatNotFound", err)
	}
	if err := store.renameFolder(work.ID, "Projects"); err != nil {
		t.Fatalf("renameFolder() error = %v", err)
	}
	if err := store.renameFolder("0123456789abcdef0123456789abcdef", "Gone"); !errors.Is(err, errLocalAIFolderNotFound) {
		t.Fatalf("renameFolder(missing) error = %v, want errLocalAIFolderNotFound", err)
	}

	if err := store.deleteFolder(work.ID); err != nil {
		t.Fatalf("deleteFolder() error = %v", err)
	}
	chats, err = store.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].FolderID != "" || chats[0].UpdatedAt != 2 {
		t.Fatalf("chats after folder delete = %+v, want the chat kept and unfiled", chats)
	}
	folders, err = store.listFolders()
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 0 {
		t.Fatalf("folders after delete = %+v", folders)
	}
	if err := store.deleteFolder(work.ID); !errors.Is(err, errLocalAIFolderNotFound) {
		t.Fatalf("deleteFolder(missing) error = %v, want errLocalAIFolderNotFound", err)
	}
}

func TestLocalAIChatStoreLimitsFolderCount(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	for i := range localAIChatFolderLimit {
		if _, err := store.createFolder("Folder "+strings.Repeat("x", i%3), int64(i)); err != nil {
			t.Fatalf("createFolder(%d) error = %v", i, err)
		}
	}
	if _, err := store.createFolder("One too many", 1000); err == nil {
		t.Fatal("createFolder accepted a folder beyond the limit")
	}
}

func TestLocalAIChatStoreAddsFolderColumnToExistingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-ai-chats.db")
	legacy, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`CREATE TABLE local_ai_chats (chat_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', agent_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'chat', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO local_ai_chats (chat_id, title, agent_id, created_at, updated_at) VALUES ('0123456789abcdef0123456789abcdef', 'Old chat', '', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := openLocalAIChatStore(path)
	if err != nil {
		t.Fatalf("openLocalAIChatStore() error = %v", err)
	}
	t.Cleanup(func() { _ = store.close() })
	chats, err := store.list()
	if err != nil || len(chats) != 1 || chats[0].FolderID != "" || chats[0].Title != "Old chat" {
		t.Fatalf("migrated chats = %+v, err = %v", chats, err)
	}
	folder, err := store.createFolder("Migrated", 2)
	if err != nil {
		t.Fatalf("createFolder() error = %v", err)
	}
	if err := store.setChatFolder(chats[0].ID, folder.ID); err != nil {
		t.Fatalf("setChatFolder() error = %v", err)
	}
}

func TestLocalAIChatStoreReplacesOnlyDerivedTitle(t *testing.T) {
	store, _ := openTestLocalAIChatStore(t)
	chat, err := store.create("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "user", Content: "Plan a trip to Lisbon in June"}, 2); err != nil {
		t.Fatalf("appendMessage(user) error = %v", err)
	}
	input, err := store.titleInput(chat.ID)
	if err != nil {
		t.Fatalf("titleInput() error = %v", err)
	}
	if _, ok := input.replaceableTitle(); ok {
		t.Fatal("title without a reply is replaceable")
	}
	if _, err := store.appendMessage(chat.ID, LocalAIChatMessage{Role: "assistant", Content: "Here is a plan.", Status: "complete"}, 3); err != nil {
		t.Fatalf("appendMessage(assistant) error = %v", err)
	}
	input, err = store.titleInput(chat.ID)
	if err != nil {
		t.Fatalf("titleInput() error = %v", err)
	}
	derived, ok := input.replaceableTitle()
	if !ok || derived != "Plan a trip to Lisbon in June" {
		t.Fatalf("replaceableTitle() = %q, %v", derived, ok)
	}
	current, err := store.replaceDerivedTitle(chat.ID, derived, "Trip planning")
	if err != nil || current != "Trip planning" {
		t.Fatalf("replaceDerivedTitle() = %q, %v", current, err)
	}

	// A rename made while generation runs must win over the generated title.
	renamed, err := store.create("", 4)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.appendMessage(renamed.ID, LocalAIChatMessage{Role: "user", Content: "Budget notes"}, 5); err != nil {
		t.Fatalf("appendMessage(user) error = %v", err)
	}
	if _, err := store.appendMessage(renamed.ID, LocalAIChatMessage{Role: "assistant", Content: "Here are notes.", Status: "complete"}, 6); err != nil {
		t.Fatalf("appendMessage(assistant) error = %v", err)
	}
	if err := store.rename(renamed.ID, "My budget"); err != nil {
		t.Fatalf("rename() error = %v", err)
	}
	input, err = store.titleInput(renamed.ID)
	if err != nil {
		t.Fatalf("titleInput() error = %v", err)
	}
	if _, ok := input.replaceableTitle(); ok {
		t.Fatal("renamed title is replaceable")
	}
	current, err = store.replaceDerivedTitle(renamed.ID, "Budget notes", "Money plans")
	if err != nil || current != "My budget" {
		t.Fatalf("replaceDerivedTitle(renamed) = %q, %v, want My budget", current, err)
	}

	if _, err := store.titleInput("0123456789abcdef0123456789abcdef"); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("titleInput(missing) error = %v, want errLocalAIChatNotFound", err)
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
