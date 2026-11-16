package desktop

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"os"
	"path/filepath"
)

var (
	errLocalAIChatNotFound   = errors.New("local AI chat was not found")
	errLocalAIFolderNotFound = errors.New("local AI folder was not found")
)

type localAIChatStore struct {
	db *sql.DB
}

func openLocalAIChatStore(path string) (*localAIChatStore, error) {
	if path == "" {
		return nil, errors.New("local AI chat database path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create local AI chat directory: %w", err)
	}
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open local AI chat database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &localAIChatStore{db: db}
	if err := store.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = db.Close()
		return nil, fmt.Errorf("secure local AI chat database: %w", err)
	}
	return store, nil
}

func (s *localAIChatStore) close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *localAIChatStore) initialize() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS local_ai_chats (
			chat_id TEXT PRIMARY KEY,
			title TEXT NOT NULL DEFAULT '',
			agent_id TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS local_ai_chat_messages (
			chat_id TEXT NOT NULL REFERENCES local_ai_chats(chat_id) ON DELETE CASCADE,
			seq INTEGER NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
			content TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'stopped')),
			attachments TEXT NOT NULL DEFAULT '[]',
			created_at INTEGER NOT NULL,
			PRIMARY KEY (chat_id, seq)
		);
		CREATE TABLE IF NOT EXISTS local_ai_folders (
			folder_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS local_ai_chats_updated_idx ON local_ai_chats(updated_at DESC);
	`)
	if err != nil {
		return fmt.Errorf("initialize local AI chat schema: %w", err)
	}
	// Databases created before chat kinds existed get the default kind for their existing chats.
	if err := s.ensureColumn("local_ai_chats", "kind", "TEXT NOT NULL DEFAULT 'chat'"); err != nil {
		return err
	}
	// Chats saved before folders existed are unfiled.
	if err := s.ensureColumn("local_ai_chats", "folder_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

// ensureColumn adds column to table when an older database does not have it yet.
func (s *localAIChatStore) ensureColumn(table, column, definition string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&count); err != nil {
		return fmt.Errorf("inspect local AI chat schema: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err := s.db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)); err != nil {
		return fmt.Errorf("add local AI chat column %s: %w", column, err)
	}
	return nil
}

// list returns chats newest first. Unanswered is set when the newest saved turn is the model's, so the user has not replied yet.
func (s *localAIChatStore) list() ([]LocalAIChatSummary, error) {
	rows, err := s.db.Query(`SELECT c.chat_id, c.title, c.agent_id, c.kind, c.folder_id, c.updated_at,
		COALESCE((SELECT substr(m.content, 1, 160) FROM local_ai_chat_messages m WHERE m.chat_id = c.chat_id ORDER BY m.seq DESC LIMIT 1), ''),
		COALESCE((SELECT m.role FROM local_ai_chat_messages m WHERE m.chat_id = c.chat_id ORDER BY m.seq DESC LIMIT 1), '')
		FROM local_ai_chats c ORDER BY c.updated_at DESC, c.chat_id`)
	if err != nil {
		return nil, fmt.Errorf("list local AI chats: %w", err)
	}
	defer rows.Close()
	chats := make([]LocalAIChatSummary, 0)
	for rows.Next() {
		var chat LocalAIChatSummary
		var lastRole string
		if err := rows.Scan(&chat.ID, &chat.Title, &chat.AgentID, &chat.Kind, &chat.FolderID, &chat.UpdatedAt, &chat.Preview, &lastRole); err != nil {
			return nil, fmt.Errorf("read local AI chat: %w", err)
		}
		chat.Unanswered = lastRole == "assistant"
		chats = append(chats, chat)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read local AI chats: %w", err)
	}
	return chats, nil
}

func (s *localAIChatStore) create(agentID string, now int64) (LocalAIChatSummary, error) {
	return s.createWithKind(agentID, localAIChatKindChat, now)
}

// createWithKind saves an empty chat. Kind sets the row icon and does not change after creation.
func (s *localAIChatStore) createWithKind(agentID, kind string, now int64) (LocalAIChatSummary, error) {
	chatID, err := newLocalAIChatID()
	if err != nil {
		return LocalAIChatSummary{}, err
	}
	if _, err := s.db.Exec(`INSERT INTO local_ai_chats (chat_id, title, agent_id, kind, created_at, updated_at) VALUES (?, '', ?, ?, ?, ?)`, chatID, agentID, kind, now, now); err != nil {
		return LocalAIChatSummary{}, fmt.Errorf("create local AI chat: %w", err)
	}
	return LocalAIChatSummary{ID: chatID, AgentID: agentID, Kind: kind, UpdatedAt: now}, nil
}

// localAIChatTitleInput holds what a generated title is based on: the saved title, the first user turn, and the first complete reply.
type localAIChatTitleInput struct {
	title       string
	prompt      string
	attachments []LocalAIChatAttachment
	reply       string
}

// titleInput loads the title inputs for chatID. A missing turn leaves its fields empty.
func (s *localAIChatStore) titleInput(chatID string) (localAIChatTitleInput, error) {
	var input localAIChatTitleInput
	if err := s.db.QueryRow(`SELECT title FROM local_ai_chats WHERE chat_id = ?`, chatID).Scan(&input.title); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return localAIChatTitleInput{}, errLocalAIChatNotFound
		}
		return localAIChatTitleInput{}, fmt.Errorf("load local AI chat title: %w", err)
	}
	attachments := "[]"
	err := s.db.QueryRow(`SELECT content, attachments FROM local_ai_chat_messages WHERE chat_id = ? AND role = 'user' ORDER BY seq LIMIT 1`, chatID).Scan(&input.prompt, &attachments)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return localAIChatTitleInput{}, fmt.Errorf("load local AI chat first turn: %w", err)
	}
	if err := json.Unmarshal([]byte(attachments), &input.attachments); err != nil {
		return localAIChatTitleInput{}, fmt.Errorf("read local AI chat attachments: %w", err)
	}
	err = s.db.QueryRow(`SELECT content FROM local_ai_chat_messages WHERE chat_id = ? AND role = 'assistant' AND status = 'complete' ORDER BY seq LIMIT 1`, chatID).Scan(&input.reply)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return localAIChatTitleInput{}, fmt.Errorf("load local AI chat reply: %w", err)
	}
	return input, nil
}

// replaceableTitle returns the title derived from the first user turn and whether a generated title may replace it. Renamed or already generated titles do not match and are kept.
func (input localAIChatTitleInput) replaceableTitle() (string, bool) {
	derived := localAIChatTitle(input.prompt, input.attachments)
	return derived, derived != "" && input.reply != "" && input.title == derived
}

// replaceDerivedTitle sets title only while the chat still has derived as its title, so a rename made during generation wins. It returns the title stored afterwards.
func (s *localAIChatStore) replaceDerivedTitle(chatID, derived, title string) (string, error) {
	if _, err := s.db.Exec(`UPDATE local_ai_chats SET title = ? WHERE chat_id = ? AND title = ?`, title, chatID, derived); err != nil {
		return "", fmt.Errorf("update local AI chat title: %w", err)
	}
	var current string
	if err := s.db.QueryRow(`SELECT title FROM local_ai_chats WHERE chat_id = ?`, chatID).Scan(&current); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errLocalAIChatNotFound
		}
		return "", fmt.Errorf("load local AI chat title: %w", err)
	}
	return current, nil
}

func (s *localAIChatStore) rename(chatID, title string) error {
	return s.execExisting(`UPDATE local_ai_chats SET title = ? WHERE chat_id = ?`, title, chatID)
}

func (s *localAIChatStore) setAgent(chatID, agentID string) error {
	return s.execExisting(`UPDATE local_ai_chats SET agent_id = ? WHERE chat_id = ?`, agentID, chatID)
}

func (s *localAIChatStore) delete(chatID string) error {
	return s.execExisting(`DELETE FROM local_ai_chats WHERE chat_id = ?`, chatID)
}

func (s *localAIChatStore) listFolders() ([]LocalAIChatFolder, error) {
	rows, err := s.db.Query(`SELECT folder_id, name FROM local_ai_folders ORDER BY created_at, folder_id`)
	if err != nil {
		return nil, fmt.Errorf("list local AI folders: %w", err)
	}
	defer rows.Close()
	folders := make([]LocalAIChatFolder, 0)
	for rows.Next() {
		var folder LocalAIChatFolder
		if err := rows.Scan(&folder.ID, &folder.Name); err != nil {
			return nil, fmt.Errorf("read local AI folder: %w", err)
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read local AI folders: %w", err)
	}
	return folders, nil
}

// createFolder saves a folder. The count check and insert share a transaction so the folder limit holds.
func (s *localAIChatStore) createFolder(name string, now int64) (LocalAIChatFolder, error) {
	folderID, err := newLocalAIChatID()
	if err != nil {
		return LocalAIChatFolder{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return LocalAIChatFolder{}, fmt.Errorf("begin local AI folder: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM local_ai_folders`).Scan(&count); err != nil {
		return LocalAIChatFolder{}, fmt.Errorf("count local AI folders: %w", err)
	}
	if count >= localAIChatFolderLimit {
		return LocalAIChatFolder{}, fmt.Errorf("local AI folders must be %d or fewer", localAIChatFolderLimit)
	}
	if _, err := tx.Exec(`INSERT INTO local_ai_folders (folder_id, name, created_at) VALUES (?, ?, ?)`, folderID, name, now); err != nil {
		return LocalAIChatFolder{}, fmt.Errorf("create local AI folder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return LocalAIChatFolder{}, fmt.Errorf("commit local AI folder: %w", err)
	}
	return LocalAIChatFolder{ID: folderID, Name: name}, nil
}

func (s *localAIChatStore) renameFolder(folderID, name string) error {
	result, err := s.db.Exec(`UPDATE local_ai_folders SET name = ? WHERE folder_id = ?`, name, folderID)
	if err != nil {
		return fmt.Errorf("rename local AI folder: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check local AI folder: %w", err)
	}
	if rows == 0 {
		return errLocalAIFolderNotFound
	}
	return nil
}
