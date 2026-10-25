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
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type relationshipHealthStore struct {
	db *sql.DB
}

type relationshipHealthRow struct {
	ContactID              string
	WindowDate             string
	SentimentScore         float64
	Status                 string
	DetectedFrictionPoints []string
	Trend                  string
	Reasoning              string
	LastAnalyzedRoomID     string
	LastAnalyzedMessageID  string
	UpdatedAt              int64
}

type relationshipAnalysisCheckpoint struct {
	RoomID     string
	MessageID  string
	AnalyzedAt int64
}

func openRelationshipHealthStore(path string) (*relationshipHealthStore, error) {
	if path == "" {
		return nil, errors.New("relationship health database path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create relationship health directory: %w", err)
	}
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open relationship health database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &relationshipHealthStore{db: db}
	if err := store.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = db.Close()
		return nil, fmt.Errorf("secure relationship health database: %w", err)
	}
	return store, nil
}

func (s *relationshipHealthStore) initialize() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS contacts (
			contact_id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS dossier_cache (
			contact_id TEXT PRIMARY KEY REFERENCES contacts(contact_id) ON DELETE CASCADE,
			key_facts TEXT NOT NULL DEFAULT '[]',
			last_recap TEXT NOT NULL DEFAULT '',
			unresolved_commitments TEXT NOT NULL DEFAULT '[]',
			last_analyzed_message_id TEXT NOT NULL DEFAULT '',
			last_analyzed_message_timestamp INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS contact_room_links (
			room_id TEXT PRIMARY KEY,
			contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS relationship_health (
			contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
			window_date TEXT NOT NULL,
			sentiment_score REAL NOT NULL CHECK (sentiment_score >= -1.0 AND sentiment_score <= 1.0),
			status TEXT NOT NULL CHECK (status IN ('WARM', 'NEUTRAL', 'TENSE', 'COLD')),
			detected_friction_points TEXT NOT NULL DEFAULT '[]',
			trend TEXT NOT NULL CHECK (trend IN ('IMPROVING', 'STABLE', 'DETERIORATING')),
			reasoning TEXT NOT NULL DEFAULT '',
			last_analyzed_room_id TEXT NOT NULL DEFAULT '',
			last_analyzed_message_id TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (contact_id, window_date)
		);
		CREATE TABLE IF NOT EXISTS relationship_analysis_state (
			contact_id TEXT PRIMARY KEY REFERENCES contacts(contact_id) ON DELETE CASCADE,
			last_analyzed_room_id TEXT NOT NULL DEFAULT '',
			last_analyzed_message_id TEXT NOT NULL DEFAULT '',
			analyzed_at INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS relationship_health_updated_idx
			ON relationship_health(contact_id, updated_at DESC);
	`)
	if err != nil {
		return fmt.Errorf("initialize relationship health schema: %w", err)
	}
	return nil
}

func (s *relationshipHealthStore) close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *relationshipHealthStore) ensureContact(roomID, displayName string) (string, error) {
	if roomID == "" {
		return "", errors.New("room ID is empty")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	contactID, err := ensureRelationshipContactTx(tx, roomID, displayName)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("save contact mapping: %w", err)
	}
	return contactID, nil
}

func ensureRelationshipContactTx(tx *sql.Tx, roomID, displayName string) (string, error) {
	var contactID string
	err := tx.QueryRow(`SELECT contact_id FROM contact_room_links WHERE room_id = ?`, roomID).Scan(&contactID)
	if err == nil {
		if displayName != "" {
			_, err = tx.Exec(`UPDATE contacts SET display_name = ? WHERE contact_id = ? AND display_name = ''`, displayName, contactID)
		}
		return contactID, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("read contact mapping: %w", err)
	}
	contactID, err = newRelationshipContactID()
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(`INSERT INTO contacts (contact_id, display_name, created_at) VALUES (?, ?, ?)`, contactID, displayName, time.Now().UnixMilli())
	if err != nil {
		return "", fmt.Errorf("create relationship contact: %w", err)
	}
	_, err = tx.Exec(`INSERT INTO contact_room_links (room_id, contact_id) VALUES (?, ?)`, roomID, contactID)
	if err != nil {
		return "", fmt.Errorf("link room to relationship contact: %w", err)
	}
	return contactID, nil
}

func newRelationshipContactID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate contact ID: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func (s *relationshipHealthStore) linkedRooms(contactID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT room_id FROM contact_room_links WHERE contact_id = ? ORDER BY room_id`, contactID)
	if err != nil {
		return nil, fmt.Errorf("list linked contact rooms: %w", err)
	}
	defer rows.Close()
	rooms := make([]string, 0)
	for rows.Next() {
		var roomID string
		if err := rows.Scan(&roomID); err != nil {
			return nil, err
		}
		rooms = append(rooms, roomID)
	}
	return rooms, rows.Err()
}

func (s *relationshipHealthStore) linkRooms(roomID, targetRoomID string) error {
	if roomID == "" || targetRoomID == "" || roomID == targetRoomID {
		return errors.New("choose two different chats to link")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	sourceID, err := ensureRelationshipContactTx(tx, roomID, "")
	if err != nil {
		return err
	}
	targetID, err := ensureRelationshipContactTx(tx, targetRoomID, "")
	if err != nil {
		return err
	}
	if sourceID == targetID {
		return tx.Commit()
	}
	if err := mergeContactDossierCachesTx(tx, targetID, sourceID); err != nil {
		return err
	}
	if err := mergeRelationshipContactsTx(tx, targetID, sourceID); err != nil {
		return err
	}
	return tx.Commit()
}

func mergeRelationshipContactsTx(tx *sql.Tx, targetID, sourceID string) error {
	_, err := tx.Exec(`
		INSERT INTO relationship_health (
			contact_id, window_date, sentiment_score, status, detected_friction_points,
			trend, reasoning, last_analyzed_room_id, last_analyzed_message_id, updated_at
		)
		SELECT ?, window_date, sentiment_score, status, detected_friction_points,
			trend, reasoning, last_analyzed_room_id, last_analyzed_message_id, updated_at
		FROM relationship_health WHERE contact_id = ?
		ON CONFLICT(contact_id, window_date) DO UPDATE SET
			sentiment_score = excluded.sentiment_score,
			status = excluded.status,
			detected_friction_points = excluded.detected_friction_points,
			trend = excluded.trend,
			reasoning = excluded.reasoning,
			last_analyzed_room_id = excluded.last_analyzed_room_id,
			last_analyzed_message_id = excluded.last_analyzed_message_id,
			updated_at = excluded.updated_at
		WHERE excluded.updated_at > relationship_health.updated_at
	`, targetID, sourceID)
	if err != nil {
		return fmt.Errorf("merge relationship health history: %w", err)
	}
	_, err = tx.Exec(`
		INSERT INTO relationship_analysis_state (contact_id, last_analyzed_room_id, last_analyzed_message_id, analyzed_at)
		SELECT ?, last_analyzed_room_id, last_analyzed_message_id, analyzed_at
		FROM relationship_analysis_state WHERE contact_id = ?
		ON CONFLICT(contact_id) DO UPDATE SET
			last_analyzed_room_id = excluded.last_analyzed_room_id,
			last_analyzed_message_id = excluded.last_analyzed_message_id,
			analyzed_at = excluded.analyzed_at
		WHERE excluded.analyzed_at > relationship_analysis_state.analyzed_at
	`, targetID, sourceID)
	if err != nil {
		return fmt.Errorf("merge relationship analysis checkpoint: %w", err)
	}
	if _, err = tx.Exec(`UPDATE contact_room_links SET contact_id = ? WHERE contact_id = ?`, targetID, sourceID); err != nil {
		return fmt.Errorf("merge linked rooms: %w", err)
	}
	if _, err = tx.Exec(`DELETE FROM contacts WHERE contact_id = ?`, sourceID); err != nil {
		return fmt.Errorf("remove merged contact: %w", err)
	}
	return nil
}

func (s *relationshipHealthStore) unlinkRoom(roomID, displayName string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	contactID, err := ensureRelationshipContactTx(tx, roomID, displayName)
	if err != nil {
		return err
	}
	var roomCount int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM contact_room_links WHERE contact_id = ?`, contactID).Scan(&roomCount); err != nil {
		return fmt.Errorf("count linked contact rooms: %w", err)
	}
	if roomCount <= 1 {
		return tx.Commit()
	}
	newID, err := newRelationshipContactID()
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO contacts (contact_id, display_name, created_at) VALUES (?, ?, ?)`, newID, displayName, time.Now().UnixMilli()); err != nil {
		return fmt.Errorf("create unlinked contact: %w", err)
	}
	if _, err = tx.Exec(`UPDATE contact_room_links SET contact_id = ? WHERE room_id = ?`, newID, roomID); err != nil {
		return fmt.Errorf("unlink contact room: %w", err)
	}
	if _, err = tx.Exec(`DELETE FROM dossier_cache WHERE contact_id = ?`, contactID); err != nil {
		return fmt.Errorf("invalidate split contact dossier: %w", err)
	}
	return tx.Commit()
}

func (s *relationshipHealthStore) checkpoint(contactID string) (relationshipAnalysisCheckpoint, error) {
	var checkpoint relationshipAnalysisCheckpoint
	err := s.db.QueryRow(`
		SELECT last_analyzed_room_id, last_analyzed_message_id, analyzed_at
		FROM relationship_analysis_state WHERE contact_id = ?
	`, contactID).Scan(&checkpoint.RoomID, &checkpoint.MessageID, &checkpoint.AnalyzedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return relationshipAnalysisCheckpoint{}, nil
	}
	if err != nil {
		return relationshipAnalysisCheckpoint{}, fmt.Errorf("read relationship analysis checkpoint: %w", err)
	}
	return checkpoint, nil
}

func (s *relationshipHealthStore) saveHealth(row relationshipHealthRow) error {
	if row.ContactID == "" || row.WindowDate == "" || row.SentimentScore < -1 || row.SentimentScore > 1 {
		return errors.New("relationship health row is invalid")
	}
	if len(row.DetectedFrictionPoints) == 0 {
		row.DetectedFrictionPoints = []string{}
	}
	frictionJSON, err := json.Marshal(row.DetectedFrictionPoints)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO relationship_health (
			contact_id, window_date, sentiment_score, status, detected_friction_points,
			trend, reasoning, last_analyzed_room_id, last_analyzed_message_id, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(contact_id, window_date) DO UPDATE SET
			sentiment_score = excluded.sentiment_score,
			status = excluded.status,
			detected_friction_points = excluded.detected_friction_points,
			trend = excluded.trend,
			reasoning = excluded.reasoning,
			last_analyzed_room_id = excluded.last_analyzed_room_id,
			last_analyzed_message_id = excluded.last_analyzed_message_id,
			updated_at = excluded.updated_at
	`, row.ContactID, row.WindowDate, row.SentimentScore, row.Status, frictionJSON, row.Trend, row.Reasoning, row.LastAnalyzedRoomID, row.LastAnalyzedMessageID, row.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save relationship health: %w", err)
	}
	_, err = s.db.Exec(`
		INSERT INTO relationship_analysis_state (contact_id, last_analyzed_room_id, last_analyzed_message_id, analyzed_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(contact_id) DO UPDATE SET
			last_analyzed_room_id = excluded.last_analyzed_room_id,
			last_analyzed_message_id = excluded.last_analyzed_message_id,
			analyzed_at = excluded.analyzed_at
	`, row.ContactID, row.LastAnalyzedRoomID, row.LastAnalyzedMessageID, row.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save relationship analysis checkpoint: %w", err)
	}
	return nil
}

func (s *relationshipHealthStore) recentHealth(contactID string, limit int) ([]relationshipHealthRow, error) {
	if limit < 1 || limit > 90 {
		limit = 28
	}
	rows, err := s.db.Query(`
		SELECT window_date, sentiment_score, status, detected_friction_points, trend,
			reasoning, last_analyzed_room_id, last_analyzed_message_id, updated_at
		FROM relationship_health WHERE contact_id = ? ORDER BY window_date DESC LIMIT ?
	`, contactID, limit)
	if err != nil {
		return nil, fmt.Errorf("read relationship health history: %w", err)
	}
	defer rows.Close()
	results := make([]relationshipHealthRow, 0)
	for rows.Next() {
		var row relationshipHealthRow
		var frictionJSON string
		if err := rows.Scan(&row.WindowDate, &row.SentimentScore, &row.Status, &frictionJSON, &row.Trend, &row.Reasoning, &row.LastAnalyzedRoomID, &row.LastAnalyzedMessageID, &row.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(frictionJSON), &row.DetectedFrictionPoints); err != nil {
			row.DetectedFrictionPoints = []string{}
		}
		row.ContactID = contactID
		results = append(results, row)
	}
	return results, rows.Err()
}
