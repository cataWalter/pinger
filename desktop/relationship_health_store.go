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

type relationshipDecayCandidate struct {
	ContactID                string
	DisplayName              string
	Tier                     string
	LastInteractionTimestamp int64
	LastDecayAlertTimestamp  int64
	SnoozedUntil             int64
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
			created_at INTEGER NOT NULL,
			tier TEXT NOT NULL DEFAULT 'NONE' CHECK (tier IN ('VIP', 'CLOSE_FRIEND', 'CASUAL', 'CLIENT', 'NONE')),
			last_interaction_timestamp INTEGER NOT NULL DEFAULT 0,
			last_decay_alert_timestamp INTEGER NOT NULL DEFAULT 0,
			decay_nudge TEXT NOT NULL DEFAULT '',
			snoozed_until INTEGER NOT NULL DEFAULT 0
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
	if err := ensureRelationshipDecayColumns(s.db); err != nil {
		return err
	}
	if _, err := s.db.Exec(`
		CREATE INDEX IF NOT EXISTS relationship_decay_candidates_idx
			ON contacts(tier, last_interaction_timestamp, last_decay_alert_timestamp, snoozed_until);
	`); err != nil {
		return fmt.Errorf("index relationship decay contacts: %w", err)
	}
	return nil
}

func ensureRelationshipDecayColumns(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(contacts)`)
	if err != nil {
		return fmt.Errorf("inspect relationship contacts schema: %w", err)
	}
	columns := make(map[string]struct{})
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return fmt.Errorf("read relationship contacts schema: %w", err)
		}
		columns[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("read relationship contacts schema: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close relationship contacts schema: %w", err)
	}
	definitions := []struct {
		name       string
		definition string
	}{
		{"tier", "TEXT NOT NULL DEFAULT 'NONE' CHECK (tier IN ('VIP', 'CLOSE_FRIEND', 'CASUAL', 'CLIENT', 'NONE'))"},
		{"last_interaction_timestamp", "INTEGER NOT NULL DEFAULT 0"},
		{"last_decay_alert_timestamp", "INTEGER NOT NULL DEFAULT 0"},
		{"decay_nudge", "TEXT NOT NULL DEFAULT ''"},
		{"snoozed_until", "INTEGER NOT NULL DEFAULT 0"},
	}
	for _, column := range definitions {
		if _, exists := columns[column.name]; exists {
			continue
		}
		if _, err := db.Exec(`ALTER TABLE contacts ADD COLUMN ` + column.name + ` ` + column.definition); err != nil {
			return fmt.Errorf("add relationship contact column %s: %w", column.name, err)
		}
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

func (s *relationshipHealthStore) setContactTier(contactID, tier string) error {
	switch tier {
	case "VIP", "CLOSE_FRIEND", "CASUAL", "CLIENT", "NONE":
	default:
		return fmt.Errorf("unknown relationship tier %q", tier)
	}
	result, err := s.db.Exec(`
		UPDATE contacts SET
			tier = ?,
			last_decay_alert_timestamp = CASE WHEN tier <> ? THEN 0 ELSE last_decay_alert_timestamp END,
			snoozed_until = CASE WHEN tier <> ? THEN 0 ELSE snoozed_until END
		WHERE contact_id = ?
	`, tier, tier, tier, contactID)
	if err != nil {
		return fmt.Errorf("set relationship tier: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected == 0 {
		return errors.New("relationship contact was not found")
	}
	return nil
}

func (s *relationshipHealthStore) updateContactInteraction(contactID string, timestamp int64) error {
	if contactID == "" || timestamp <= 0 {
		return nil
	}
	_, err := s.db.Exec(`
		UPDATE contacts SET
			last_interaction_timestamp = ?,
			last_decay_alert_timestamp = 0,
			snoozed_until = 0
		WHERE contact_id = ? AND last_interaction_timestamp < ?
	`, timestamp, contactID, timestamp)
	if err != nil {
		return fmt.Errorf("update relationship interaction: %w", err)
	}
	return nil
}

func (s *relationshipHealthStore) dueDecayCandidates(now time.Time, limit int) ([]relationshipDecayCandidate, error) {
	if limit < 1 {
		return []relationshipDecayCandidate{}, nil
	}
	nowMillis := now.UnixMilli()
	cutoffMillis := now.Add(-relationshipDecayCooldown).UnixMilli()
	vipThreshold, _ := relationshipDecayThreshold("VIP")
	friendThreshold, _ := relationshipDecayThreshold("CLOSE_FRIEND")
	casualThreshold, _ := relationshipDecayThreshold("CASUAL")
	clientThreshold, _ := relationshipDecayThreshold("CLIENT")
	rows, err := s.db.Query(`
		SELECT contact_id, display_name, tier, last_interaction_timestamp, last_decay_alert_timestamp, snoozed_until
		FROM contacts
		WHERE last_interaction_timestamp > 0
			AND snoozed_until <= ?
			AND last_decay_alert_timestamp <= ?
			AND (
				(tier = 'VIP' AND last_interaction_timestamp < ?)
				OR (tier = 'CLOSE_FRIEND' AND last_interaction_timestamp < ?)
				OR (tier = 'CASUAL' AND last_interaction_timestamp < ?)
				OR (tier = 'CLIENT' AND last_interaction_timestamp < ?)
			)
		ORDER BY last_interaction_timestamp ASC
		LIMIT ?
	`, nowMillis, cutoffMillis,
		now.Add(-vipThreshold).UnixMilli(),
		now.Add(-friendThreshold).UnixMilli(),
		now.Add(-casualThreshold).UnixMilli(),
		now.Add(-clientThreshold).UnixMilli(), limit)
	if err != nil {
		return nil, fmt.Errorf("query relationship decay candidates: %w", err)
	}
	defer rows.Close()
	candidates := make([]relationshipDecayCandidate, 0)
	for rows.Next() {
		var candidate relationshipDecayCandidate
		if err := rows.Scan(&candidate.ContactID, &candidate.DisplayName, &candidate.Tier, &candidate.LastInteractionTimestamp, &candidate.LastDecayAlertTimestamp, &candidate.SnoozedUntil); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func (s *relationshipHealthStore) saveDecayAlert(candidate relationshipDecayCandidate, alertedAt int64, now time.Time) (bool, error) {
	if candidate.ContactID == "" || alertedAt <= 0 {
		return false, errors.New("relationship decay alert is invalid")
	}
	nowMillis := now.UnixMilli()
	cutoffMillis := now.Add(-relationshipDecayCooldown).UnixMilli()
	result, err := s.db.Exec(`
		UPDATE contacts SET last_decay_alert_timestamp = ?
		WHERE contact_id = ? AND tier = ? AND last_interaction_timestamp = ?
			AND last_decay_alert_timestamp = ? AND snoozed_until = ?
			AND last_decay_alert_timestamp <= ? AND snoozed_until <= ?
	`, alertedAt, candidate.ContactID, candidate.Tier,
		candidate.LastInteractionTimestamp, candidate.LastDecayAlertTimestamp, candidate.SnoozedUntil,
		cutoffMillis, nowMillis)
	if err != nil {
		return false, fmt.Errorf("save relationship decay alert: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (s *relationshipHealthStore) snoozeDecayAlert(contactID string, until int64) error {
	result, err := s.db.Exec(`UPDATE contacts SET snoozed_until = ? WHERE contact_id = ?`, until, contactID)
	if err != nil {
		return fmt.Errorf("snooze relationship decay alert: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected == 0 {
		return errors.New("relationship contact was not found")
	}
	return nil
}

func (s *relationshipHealthStore) decayContacts(now time.Time) ([]RelationshipDecayContact, error) {
	rows, err := s.db.Query(`
		SELECT c.contact_id, c.display_name, c.tier, c.last_interaction_timestamp,
			c.last_decay_alert_timestamp, c.snoozed_until, l.room_id
		FROM contacts c
		LEFT JOIN contact_room_links l ON l.contact_id = c.contact_id
		ORDER BY c.display_name COLLATE NOCASE, c.contact_id, l.room_id
	`)
	if err != nil {
		return nil, fmt.Errorf("list relationship contacts: %w", err)
	}
	defer rows.Close()
	contacts := make([]RelationshipDecayContact, 0)
	contactIndexes := make(map[string]int)
	for rows.Next() {
		var contactID, displayName, tier string
		var lastInteraction, lastAlert, snoozedUntil int64
		var roomID sql.NullString
		if err := rows.Scan(&contactID, &displayName, &tier, &lastInteraction, &lastAlert, &snoozedUntil, &roomID); err != nil {
			return nil, err
		}
		index, exists := contactIndexes[contactID]
		if !exists {
			index = len(contacts)
			contactIndexes[contactID] = index
			contacts = append(contacts, RelationshipDecayContact{
				ContactID:                contactID,
				DisplayName:              displayName,
				Tier:                     tier,
				LastInteractionTimestamp: lastInteraction,
				LastDecayAlertTimestamp:  lastAlert,
				SnoozedUntil:             snoozedUntil,
				RoomIDs:                  []string{},
			})
		}
		if roomID.Valid {
			contacts[index].RoomIDs = append(contacts[index].RoomIDs, roomID.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for index := range contacts {
		contact := &contacts[index]
		contact.Alerted = relationshipDecayAlertActive(*contact, now)
	}
	return contacts, nil
}
