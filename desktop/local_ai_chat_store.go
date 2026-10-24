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

var errLocalAIChatNotFound = errors.New("local AI chat was not found")

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
		CREATE INDEX IF NOT EXISTS local_ai_chats_updated_idx ON local_ai_chats(updated_at DESC);
	`)
	if err != nil {
		return fmt.Errorf("initialize local AI chat schema: %w", err)
	}
	return nil
}

func (s *localAIChatStore) list() ([]LocalAIChatSummary, error) {
	rows, err := s.db.Query(`SELECT chat_id, title, agent_id, updated_at FROM local_ai_chats ORDER BY updated_at DESC, chat_id`)
	if err != nil {
		return nil, fmt.Errorf("list local AI chats: %w", err)
	}
	defer rows.Close()
	chats := make([]LocalAIChatSummary, 0)
	for rows.Next() {
		var chat LocalAIChatSummary
		if err := rows.Scan(&chat.ID, &chat.Title, &chat.AgentID, &chat.UpdatedAt); err != nil {
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
	chatID, err := newLocalAIChatID()
	if err != nil {
		return LocalAIChatSummary{}, err
	}
	if _, err := s.db.Exec(`INSERT INTO local_ai_chats (chat_id, title, agent_id, created_at, updated_at) VALUES (?, '', ?, ?, ?)`, chatID, agentID, now, now); err != nil {
		return LocalAIChatSummary{}, fmt.Errorf("create local AI chat: %w", err)
	}
	return LocalAIChatSummary{ID: chatID, AgentID: agentID, UpdatedAt: now}, nil
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
	if message.Status == "" {
		message.Status = "complete"
	}
	attachments, err := json.Marshal(message.Attachments)
	if err != nil {
		return LocalAIChatMessage{}, fmt.Errorf("encode local AI chat attachments: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return LocalAIChatMessage{}, fmt.Errorf("begin local AI chat message: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var title string
	if err := tx.QueryRow(`SELECT title FROM local_ai_chats WHERE chat_id = ?`, chatID).Scan(&title); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return LocalAIChatMessage{}, errLocalAIChatNotFound
		}
		return LocalAIChatMessage{}, fmt.Errorf("load local AI chat: %w", err)
	}
	var seq int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) + 1 FROM local_ai_chat_messages WHERE chat_id = ?`, chatID).Scan(&seq); err != nil {
		return LocalAIChatMessage{}, fmt.Errorf("number local AI chat message: %w", err)
	}
	message.Seq = seq
	message.CreatedAt = now
	if _, err := tx.Exec(`INSERT INTO local_ai_chat_messages (chat_id, seq, role, content, status, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, chatID, seq, message.Role, message.Content, message.Status, string(attachments), now); err != nil {
		return LocalAIChatMessage{}, fmt.Errorf("store local AI chat message: %w", err)
	}
	if title == "" && message.Role == "user" {
		title = localAIChatTitle(message.Content, message.Attachments)
	}
	if _, err := tx.Exec(`UPDATE local_ai_chats SET title = ?, updated_at = ? WHERE chat_id = ?`, title, now, chatID); err != nil {
		return LocalAIChatMessage{}, fmt.Errorf("update local AI chat: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return LocalAIChatMessage{}, fmt.Errorf("commit local AI chat message: %w", err)
	}
	return message, nil
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
