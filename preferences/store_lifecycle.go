package preferences

import (
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"io/fs"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

func (s *Store) ImportLegacy(path, accountID string) (bool, error) {
	if path == "" {
		return false, errors.New("legacy preferences path is empty")
	}
	contents, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read legacy preferences: %w", err)
	}
	values := make(map[string]any)
	if err := json.Unmarshal(contents, &values); err != nil {
		return false, fmt.Errorf("decode legacy preferences: %w", err)
	}
	if values == nil {
		return false, errors.New("legacy preferences must contain a JSON object")
	}
	if accountID == "" {
		return false, errors.New("legacy preference import requires an account ID")
	}
	for key, value := range values {
		if err := Validate(key, value); err != nil {
			return false, fmt.Errorf("validate legacy preference %q: %w", key, err)
		}
	}

	const migrationName = "preferences-json-v1"
	tx, err := s.db.Begin()
	if err != nil {
		return false, fmt.Errorf("begin legacy preference import: %w", err)
	}
	defer tx.Rollback()
	var completed int
	err = tx.QueryRow("SELECT COUNT(*) FROM preference_migrations WHERE name = ?", migrationName).Scan(&completed)
	if err != nil {
		return false, fmt.Errorf("check legacy preference import: %w", err)
	}
	if completed > 0 {
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("finish legacy preference import: %w", err)
		}
		return false, ensureBackup(path)
	}
	var revision int64
	if err = tx.QueryRow("SELECT revision FROM preference_meta WHERE id = 1").Scan(&revision); err != nil {
		return false, fmt.Errorf("read preference revision: %w", err)
	}
	for key, value := range values {
		scope, scopedAccount := GlobalScope, ""
		if IsAccountKey(key) {
			scope, scopedAccount = AccountScope, accountID
		}
		raw, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			return false, fmt.Errorf("encode legacy preference %q: %w", key, marshalErr)
		}
		revision++
		if _, err = tx.Exec(`
			INSERT OR IGNORE INTO preferences (scope, account_id, key, value_json, updated_at, revision)
			VALUES (?, ?, ?, ?, ?, ?)`, scope, scopedAccount, key, raw, time.Now().UnixMilli(), revision); err != nil {
			return false, fmt.Errorf("import legacy preference %q: %w", key, err)
		}
	}
	if _, err = tx.Exec("INSERT INTO preference_migrations (name, completed_at) VALUES (?, ?)", migrationName, time.Now().UnixMilli()); err != nil {
		return false, fmt.Errorf("record legacy preference import: %w", err)
	}
	if _, err = tx.Exec("UPDATE preference_meta SET revision = ? WHERE id = 1", revision); err != nil {
		return false, fmt.Errorf("write imported preference revision: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("commit legacy preference import: %w", err)
	}
	s.markRevision(revision)
	s.publish(Change{Revision: revision})
	if err := ensureBackup(path); err != nil {
		return true, err
	}
	return true, nil
}

func ensureBackup(path string) error {
	backup := path + ".backup"
	if _, err := os.Stat(backup); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("inspect legacy preferences backup: %w", err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read legacy preferences for backup: %w", err)
	}
	if err = os.WriteFile(backup, contents, 0o600); err != nil {
		return fmt.Errorf("write legacy preferences backup: %w", err)
	}
	return nil
}

func (s *Store) Subscribe(buffer int) (<-chan Change, func()) {
	if buffer < 1 {
		buffer = 1
	}
	channel := make(chan Change, buffer)
	s.mu.Lock()
	s.subscribers[channel] = struct{}{}
	s.mu.Unlock()
	return channel, func() {
		s.mu.Lock()
		if _, ok := s.subscribers[channel]; ok {
			delete(s.subscribers, channel)
			close(channel)
		}
		s.mu.Unlock()
	}
}

func (s *Store) Close() error {
	var err error
	s.closeOnce.Do(func() {
		close(s.stop)
		<-s.done
		s.mu.Lock()
		for channel := range s.subscribers {
			close(channel)
		}
		s.subscribers = make(map[chan Change]struct{})
		s.mu.Unlock()
		err = s.db.Close()
	})
	return err
}

func (s *Store) watch() {
	defer close(s.done)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			revision, err := s.revision()
			if err == nil && s.markRevisionIfNew(revision) {
				s.publish(Change{Revision: revision})
			}
		case <-s.stop:
			return
		}
	}
}

func (s *Store) revision() (int64, error) {
	var revision int64
	if err := s.db.QueryRow("SELECT revision FROM preference_meta WHERE id = 1").Scan(&revision); err != nil {
		return 0, fmt.Errorf("read preference revision: %w", err)
	}
	return revision, nil
}

func (s *Store) markRevision(revision int64) {
	s.mu.Lock()
	if revision > s.lastRevision {
		s.lastRevision = revision
	}
	s.mu.Unlock()
}

func (s *Store) markRevisionIfNew(revision int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if revision <= s.lastRevision {
		return false
	}
	s.lastRevision = revision
	return true
}

func (s *Store) publish(change Change) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for channel := range s.subscribers {
		select {
		case channel <- change:
		default:
		}
	}
}

func validateScope(scope Scope, accountID string) error {
	switch scope {
	case GlobalScope:
		if accountID != "" {
			return errors.New("global preferences cannot have an account ID")
		}
	case AccountScope:
		if accountID == "" {
			return errors.New("account preferences require an account ID")
		}
	default:
		return fmt.Errorf("unknown preference scope %q", scope)
	}
	return nil
}

func IsAccountKey(key string) bool {
	return strings.HasPrefix(key, "room.")
}

const (
	NotificationCategoryDirect  = "direct"
	NotificationCategoryMention = "mention"
	NotificationCategoryGroup   = "group"
)

func NotificationAllowed(values map[string]any, roomID, category string) bool {
	if enabled, ok := values["notifications.enabled"].(bool); ok && !enabled {
		return false
	}
	if muted, ok := values["room.muted."+roomID].(bool); ok && muted {
		return false
	}
	switch category {
	case NotificationCategoryDirect:
		return preferenceEnabled(values, "notifications.direct", true)
	case NotificationCategoryMention:
		return preferenceEnabled(values, "notifications.mentions", true)
	case NotificationCategoryGroup:
		return preferenceEnabled(values, "notifications.group", false)
	default:
		return true
	}
}

func preferenceEnabled(values map[string]any, key string, fallback bool) bool {
	value, ok := values[key].(bool)
	if !ok {
		return fallback
	}
	return value
}

func ValidateLocalHTTPEndpoint(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("AI endpoint must be a localhost HTTP URL without a path")
	}
	host := strings.ToLower(parsed.Hostname())
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return errors.New("AI endpoint must use localhost or a loopback IP address")
	}
	return nil
}
