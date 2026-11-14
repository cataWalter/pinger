package preferences

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Scope string

const (
	GlobalScope  Scope = "global"
	AccountScope Scope = "account"
)

type Change struct {
	Revision int64
}

type Store struct {
	db       *sql.DB
	interval time.Duration

	mu           sync.RWMutex
	lastRevision int64
	subscribers  map[chan Change]struct{}
	stop         chan struct{}
	done         chan struct{}
	closeOnce    sync.Once
}

func Open(path string) (*Store, error) {
	return open(path, 250*time.Millisecond)
}

func open(path string, interval time.Duration) (*Store, error) {
	if path == "" {
		return nil, errors.New("preferences path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create preferences directory: %w", err)
	}
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open preferences database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{
		db:          db,
		interval:    interval,
		subscribers: make(map[chan Change]struct{}),
		stop:        make(chan struct{}),
		done:        make(chan struct{}),
	}
	if err := store.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	store.lastRevision, err = store.revision()
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	go store.watch()
	return store, nil
}

func (s *Store) initialize() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS preferences (
			scope TEXT NOT NULL CHECK (scope IN ('global', 'account')),
			account_id TEXT NOT NULL DEFAULT '',
			key TEXT NOT NULL,
			value_json BLOB NOT NULL,
			updated_at INTEGER NOT NULL,
			revision INTEGER NOT NULL,
			PRIMARY KEY (scope, account_id, key)
		);
		CREATE TABLE IF NOT EXISTS preference_meta (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			revision INTEGER NOT NULL
		);
		INSERT INTO preference_meta (id, revision)
			SELECT 1, 0
			WHERE NOT EXISTS (SELECT 1 FROM preference_meta WHERE id = 1);
		CREATE TABLE IF NOT EXISTS preference_migrations (
			name TEXT PRIMARY KEY,
			completed_at INTEGER NOT NULL
		);`)
	if err != nil {
		return fmt.Errorf("initialize preferences database: %w", err)
	}
	return nil
}

func (s *Store) Snapshot(accountID string) (map[string]any, error) {
	global, err := s.all(GlobalScope, "")
	if err != nil {
		return nil, err
	}
	if accountID == "" {
		return global, nil
	}
	account, err := s.all(AccountScope, accountID)
	if err != nil {
		return nil, err
	}
	for key, value := range account {
		global[key] = value
	}
	return global, nil
}

func (s *Store) All(scope Scope, accountID string) (map[string]any, error) {
	return s.all(scope, accountID)
}

func (s *Store) all(scope Scope, accountID string) (map[string]any, error) {
	if err := validateScope(scope, accountID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("SELECT key, value_json FROM preferences WHERE scope = ? AND account_id = ?", scope, accountID)
	if err != nil {
		return nil, fmt.Errorf("read preferences: %w", err)
	}
	defer rows.Close()
	values := make(map[string]any)
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, fmt.Errorf("decode preference row: %w", err)
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("decode preference %q: %w", key, err)
		}
		values[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read preference rows: %w", err)
	}
	return values, nil
}

func (s *Store) SetGlobal(key string, value any) error {
	return s.Set(GlobalScope, "", key, value)
}

func (s *Store) SetAccount(accountID, key string, value any) error {
	return s.Set(AccountScope, accountID, key, value)
}

func (s *Store) Set(scope Scope, accountID, key string, value any) error {
	return s.setAll([]write{{scope: scope, accountID: accountID, key: key, value: value}})
}

// SetMany writes several preferences in one transaction, so either every change is saved or none is.
// IsAccountKey routes each key to the account scope or the global scope.
func (s *Store) SetMany(accountID string, values map[string]any) error {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	writes := make([]write, 0, len(keys))
	for _, key := range keys {
		w := write{scope: GlobalScope, key: key, value: values[key]}
		if IsAccountKey(key) {
			w.scope = AccountScope
			w.accountID = accountID
		}
		writes = append(writes, w)
	}
	return s.setAll(writes)
}

// write is one preference change inside a batch.
type write struct {
	scope     Scope
	accountID string
	key       string
	value     any
}

// setAll validates and writes a batch in one transaction. It bumps the revision once and skips unchanged values.
func (s *Store) setAll(writes []write) error {
	if len(writes) == 0 {
		return nil
	}
	for _, w := range writes {
		if err := validateScope(w.scope, w.accountID); err != nil {
			return err
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin preference update: %w", err)
	}
	defer tx.Rollback()

	// Language checks depend on stored values, so they read inside the transaction.
	customLanguages, err := effectiveString(tx, writes, "ai.custom_languages")
	if err != nil {
		return err
	}
	languages := LanguageLookupFor(customLanguages)
	encoded := make([][]byte, len(writes))
	for i, w := range writes {
		if err := validatePreference(w.key, w.value, languages); err != nil {
			return err
		}
		raw, err := json.Marshal(w.value)
		if err != nil {
			return fmt.Errorf("encode preference %q: %w", w.key, err)
		}
		encoded[i] = raw
	}
	if err := validateBatchLanguages(tx, writes); err != nil {
		return err
	}
	if err := validateLanguagesAfterCustomChange(tx, writes, languages); err != nil {
		return err
	}

	changed := make([]int, 0, len(writes))
	for i, w := range writes {
		existing, found, err := readPreferenceRaw(tx, w.scope, w.accountID, w.key)
		if err != nil {
			return err
		}
		if !found || !bytes.Equal(existing, encoded[i]) {
			changed = append(changed, i)
		}
	}
	if len(changed) == 0 {
		return nil
	}

	var revision int64
	if err := tx.QueryRow("SELECT revision FROM preference_meta WHERE id = 1").Scan(&revision); err != nil {
		return fmt.Errorf("read preference revision: %w", err)
	}
	revision++
	now := time.Now().UnixMilli()
	for _, i := range changed {
		w := writes[i]
		if _, err := tx.Exec(`
		INSERT INTO preferences (scope, account_id, key, value_json, updated_at, revision)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope, account_id, key) DO UPDATE SET
			value_json = excluded.value_json,
			updated_at = excluded.updated_at,
			revision = excluded.revision`, w.scope, w.accountID, w.key, encoded[i], now, revision); err != nil {
			return fmt.Errorf("write preference %q: %w", w.key, err)
		}
	}
	if _, err := tx.Exec("UPDATE preference_meta SET revision = ? WHERE id = 1", revision); err != nil {
		return fmt.Errorf("write preference revision: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit preference update: %w", err)
	}
	s.markRevision(revision)
	s.publish(Change{Revision: revision})
	return nil
}
