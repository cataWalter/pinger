package desktop

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
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

func (s *localAIChatStore) list() ([]LocalAIChatSummary, error) {
	rows, err := s.db.Query(`SELECT c.chat_id, c.title, c.agent_id, c.kind, c.folder_id, c.updated_at,
		COALESCE((SELECT substr(m.content, 1, 160) FROM local_ai_chat_messages m WHERE m.chat_id = c.chat_id ORDER BY m.seq DESC LIMIT 1), '')
		FROM local_ai_chats c ORDER BY c.updated_at DESC, c.chat_id`)
	if err != nil {
		return nil, fmt.Errorf("list local AI chats: %w", err)
	}
	defer rows.Close()
	chats := make([]LocalAIChatSummary, 0)
	for rows.Next() {
		var chat LocalAIChatSummary
		if err := rows.Scan(&chat.ID, &chat.Title, &chat.AgentID, &chat.Kind, &chat.FolderID, &chat.UpdatedAt, &chat.Preview); err != nil {
			return nil, fmt.Errorf("read local AI chat: %w", err)
		}
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

// deleteFolder removes folderID. Its chats stay saved and become unfiled.
func (s *localAIChatStore) deleteFolder(folderID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin local AI folder delete: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`DELETE FROM local_ai_folders WHERE folder_id = ?`, folderID)
	if err != nil {
		return fmt.Errorf("delete local AI folder: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check local AI folder: %w", err)
	}
	if rows == 0 {
		return errLocalAIFolderNotFound
	}
	if _, err := tx.Exec(`UPDATE local_ai_chats SET folder_id = '' WHERE folder_id = ?`, folderID); err != nil {
		return fmt.Errorf("unfile local AI chats: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit local AI folder delete: %w", err)
	}
	return nil
}

// setChatFolder moves chatID into folderID, or out of its folder when folderID is empty. The folder must exist. updated_at is kept so moving a chat does not reorder the list.
func (s *localAIChatStore) setChatFolder(chatID, folderID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin local AI chat folder: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if folderID != "" {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM local_ai_folders WHERE folder_id = ?`, folderID).Scan(&count); err != nil {
			return fmt.Errorf("load local AI folder: %w", err)
		}
		if count == 0 {
			return errLocalAIFolderNotFound
		}
	}
	result, err := tx.Exec(`UPDATE local_ai_chats SET folder_id = ? WHERE chat_id = ?`, folderID, chatID)
	if err != nil {
		return fmt.Errorf("update local AI chat folder: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check local AI chat: %w", err)
	}
	if rows == 0 {
		return errLocalAIChatNotFound
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit local AI chat folder: %w", err)
	}
	return nil
}

func (s *localAIChatStore) messages(chatID string) ([]LocalAIChatMessage, error) {
	rows, err := s.db.Query(`SELECT seq, role, content, status, attachments, created_at FROM local_ai_chat_messages WHERE chat_id = ? ORDER BY seq`, chatID)
	if err != nil {
		return nil, fmt.Errorf("load local AI chat messages: %w", err)
	}
	defer rows.Close()
	messages := make([]LocalAIChatMessage, 0)
	for rows.Next() {
		var message LocalAIChatMessage
		var attachments string
		if err := rows.Scan(&message.Seq, &message.Role, &message.Content, &message.Status, &attachments, &message.CreatedAt); err != nil {
			return nil, fmt.Errorf("read local AI chat message: %w", err)
		}
		message.Attachments = []LocalAIChatAttachment{}
		if err := json.Unmarshal([]byte(attachments), &message.Attachments); err != nil {
			return nil, fmt.Errorf("read local AI chat attachments: %w", err)
		}
		if message.Attachments == nil {
			message.Attachments = []LocalAIChatAttachment{}
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read local AI chat messages: %w", err)
	}
	return messages, nil
}

// appendMessage stores message at the next sequence number and sets the chat title from the first user turn.
func (s *localAIChatStore) appendMessage(chatID string, message LocalAIChatMessage, now int64) (LocalAIChatMessage, error) {
	saved, err := s.appendMessages(chatID, []LocalAIChatMessage{message}, now)
	if err != nil {
		return LocalAIChatMessage{}, err
	}
	return saved[0], nil
}

// appendMessages stores messages in order in one transaction, so a turn pair is never saved half-way. The title comes from the first user turn when the chat has none yet.
func (s *localAIChatStore) appendMessages(chatID string, messages []LocalAIChatMessage, now int64) ([]LocalAIChatMessage, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin local AI chat message: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var title string
	if err := tx.QueryRow(`SELECT title FROM local_ai_chats WHERE chat_id = ?`, chatID).Scan(&title); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errLocalAIChatNotFound
		}
		return nil, fmt.Errorf("load local AI chat: %w", err)
	}
	var seq int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) + 1 FROM local_ai_chat_messages WHERE chat_id = ?`, chatID).Scan(&seq); err != nil {
		return nil, fmt.Errorf("number local AI chat message: %w", err)
	}
	saved := make([]LocalAIChatMessage, 0, len(messages))
	for _, message := range messages {
		if message.Status == "" {
			message.Status = "complete"
		}
		attachments, err := json.Marshal(message.Attachments)
		if err != nil {
			return nil, fmt.Errorf("encode local AI chat attachments: %w", err)
		}
		message.Seq = seq
		message.CreatedAt = now
		if _, err := tx.Exec(`INSERT INTO local_ai_chat_messages (chat_id, seq, role, content, status, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, chatID, seq, message.Role, message.Content, message.Status, string(attachments), now); err != nil {
			return nil, fmt.Errorf("store local AI chat message: %w", err)
		}
		if title == "" && message.Role == "user" {
			title = localAIChatTitle(message.Content, message.Attachments)
		}
		saved = append(saved, message)
		seq++
	}
	if _, err := tx.Exec(`UPDATE local_ai_chats SET title = ?, updated_at = ? WHERE chat_id = ?`, title, now, chatID); err != nil {
		return nil, fmt.Errorf("update local AI chat: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit local AI chat message: %w", err)
	}
	return saved, nil
}

// requireChat returns errLocalAIChatNotFound when chatID is not saved.
func (s *localAIChatStore) requireChat(chatID string) error {
	var found int
	if err := s.db.QueryRow(`SELECT 1 FROM local_ai_chats WHERE chat_id = ?`, chatID).Scan(&found); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errLocalAIChatNotFound
		}
		return fmt.Errorf("load local AI chat: %w", err)
	}
	return nil
}

// truncate removes the message at fromSeq and every later message. Removing the first turn clears the title.
func (s *localAIChatStore) truncate(chatID string, fromSeq int, now int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin local AI chat truncate: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE local_ai_chats SET title = CASE WHEN ? <= 1 THEN '' ELSE title END, updated_at = ? WHERE chat_id = ?`, fromSeq, now, chatID)
	if err != nil {
		return fmt.Errorf("update local AI chat: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check local AI chat: %w", err)
	} else if rows == 0 {
		return errLocalAIChatNotFound
	}
	if _, err := tx.Exec(`DELETE FROM local_ai_chat_messages WHERE chat_id = ? AND seq >= ?`, chatID, fromSeq); err != nil {
		return fmt.Errorf("truncate local AI chat messages: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit local AI chat truncate: %w", err)
	}
	return nil
}

func (s *localAIChatStore) execExisting(query string, args ...any) error {
	result, err := s.db.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("update local AI chat: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check local AI chat: %w", err)
	}
	if rows == 0 {
		return errLocalAIChatNotFound
	}
	return nil
}

func newLocalAIChatID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("create local AI chat id: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}
