package desktop

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
)

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
