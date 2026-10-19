package preferences

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "github.com/mattn/go-sqlite3"
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
	if err := validateScope(scope, accountID); err != nil {
		return err
	}
	if err := Validate(key, value); err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode preference %q: %w", key, err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin preference update: %w", err)
	}
	defer tx.Rollback()
	var revision int64
	if err = tx.QueryRow("SELECT revision FROM preference_meta WHERE id = 1").Scan(&revision); err != nil {
		return fmt.Errorf("read preference revision: %w", err)
	}
	revision++
	if _, err = tx.Exec(`
		INSERT INTO preferences (scope, account_id, key, value_json, updated_at, revision)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope, account_id, key) DO UPDATE SET
			value_json = excluded.value_json,
			updated_at = excluded.updated_at,
			revision = excluded.revision`, scope, accountID, key, raw, time.Now().UnixMilli(), revision); err != nil {
		return fmt.Errorf("write preference %q: %w", key, err)
	}
	if _, err = tx.Exec("UPDATE preference_meta SET revision = ? WHERE id = 1", revision); err != nil {
		return fmt.Errorf("write preference revision: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit preference update: %w", err)
	}
	s.markRevision(revision)
	s.publish(Change{Revision: revision})
	return nil
}

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

func Validate(key string, value any) error {
	const roomAIAgentsPrefix = "room.ai_agents."
	if strings.HasPrefix(key, roomAIAgentsPrefix) {
		if strings.TrimPrefix(key, roomAIAgentsPrefix) == "" {
			return errors.New("room AI-agent preference requires a room ID")
		}
		serialized, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a JSON string", key)
		}
		return validateRoomAIAgents(serialized)
	}
	for _, prefix := range []string{"room.archived.", "room.favorite.", "room.muted."} {
		if strings.HasPrefix(key, prefix) {
			if strings.TrimPrefix(key, prefix) == "" {
				return errors.New("room preference requires a room ID")
			}
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("room preference %q must be a boolean", key)
			}
			return nil
		}
	}
	switch key {
	case "appearance.compact", "appearance.hide_deleted_messages", "appearance.message_animations", "appearance.pointer_cursor", "appearance.show_avatars", "appearance.show_timestamps", "appearance.time_24_hour", "appearance.relative_timestamps",
		"clipboard.copy_timestamp", "composer.arrow_up_focus_timeline", "composer.ctrl_enter", "composer.spellcheck", "notifications.enabled", "notifications.only_when_unfocused", "notifications.sound",
		"sidebar.compact_chat_list", "sidebar.show_previews", "sidebar.show_unread_counts", "window.minimize_to_tray", "window.room_details_visible", "window.sidebar_visible", "system.launch_at_startup", "voice.autoplay_next",
		"notifications.direct", "notifications.mentions", "notifications.group", "notifications.otp_immediate", "notifications.otp_copy", "sidebar.transparent", "sidebar.network_icons", "reactions.quick_enabled", "window.start_minimized", "window.quit_on_close", "window.menu_bar_icon", "downloads.ask_each_time", "appearance.balanced_text", "composer.formatting_toolbar", "emoji.autocomplete", "emoji.replace_emoticons":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("preference %q must be a boolean", key)
		}
	case "downloads.folder":
		folder, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if folder != "" && (!filepath.IsAbs(folder) || strings.ContainsRune(folder, 0)) {
			return errors.New("download folder must be an absolute path")
		}
	case "ai.endpoint":
		endpoint, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if endpoint != "" {
			parsed, err := url.Parse(endpoint)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				return errors.New("AI endpoint must be an HTTP or HTTPS URL")
			}
		}
	case "ai.model", "appearance.bubble_color", "audio.input_device":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
	case "ai.translate_language":
		language, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if len(language) > 40 {
			return errors.New("AI translation language must be 40 characters or fewer")
		}
	case "notifications.sound_direct", "notifications.sound_mention", "notifications.sound_group":
		if !oneOf(value, "Chime", "Pulse", "Soft", "Silent") {
			return fmt.Errorf("%s has an unsupported value", key)
		}
	case "notifications.batch_seconds":
		if !oneOf(value, "0", "3", "10", "30") {
			return errors.New("notifications.batch_seconds has an unsupported value")
		}
	case "notifications.repeat_minutes":
		if !oneOf(value, "0", "5", "15", "60") {
			return errors.New("notifications.repeat_minutes has an unsupported value")
		}
	case "sidebar.pinned_style":
		if !oneOf(value, "Top of list", "Star only") {
			return errors.New("sidebar.pinned_style has an unsupported value")
		}
	case "reactions.quick_source":
		if !oneOf(value, "Frequent", "Custom") {
			return errors.New("reactions.quick_source has an unsupported value")
		}
	case "reactions.custom_emojis":
		if !validEmojiList(value) {
			return errors.New("reactions.custom_emojis must contain 1 to 6 emoji separated by spaces")
		}
	case "reactions.default_emoji":
		if !validEmojiList(value) || strings.Contains(value.(string), " ") {
			return errors.New("reactions.default_emoji must be a single emoji")
		}
	case "messages.double_click":
		if !oneOf(value, "None", "Reply", "React") {
			return errors.New("messages.double_click has an unsupported value")
		}
	case "sounds.effects":
		if !oneOf(value, "Off", "Sent messages") {
			return errors.New("sounds.effects has an unsupported value")
		}
	case "appearance.theme":
		if !oneOf(value, "System default", "Light", "Dark", "OLED black", "Bosco", "Rosa") {
			return errors.New("appearance.theme has an unsupported value")
		}
	case "appearance.accent_color":
		if !oneOf(value, "Forest", "Ocean", "Rose", "Gold") {
			return errors.New("appearance.accent_color has an unsupported value")
		}
	case "appearance.chat_wallpaper":
		if !oneOf(value, "None", "Meadow", "Tide", "Rose") {
			return errors.New("appearance.chat_wallpaper has an unsupported value")
		}
	case "appearance.font_size":
		if !oneOf(value, "Small", "Medium", "Large") {
			return errors.New("appearance.font_size has an unsupported value")
		}
	case "appearance.zoom":
		if !oneOf(value, "75", "80", "85", "90", "95", "100", "105", "110", "115", "120", "125") {
			return errors.New("appearance.zoom has an unsupported value")
		}
	case "notifications.privacy":
		if !oneOf(value, "Sender and message preview", "Sender only", "Hidden content") {
			return errors.New("notifications.privacy has an unsupported value")
		}
	case "composer.undo_send_seconds":
		if !oneOf(value, "0", "5", "10", "20", "30") {
			return errors.New("composer.undo_send_seconds has an unsupported value")
		}
	case "schedule.suggestions_minutes":
		if !validScheduleSuggestions(value) {
			return errors.New("schedule.suggestions_minutes must contain 1 to 6 unique minute values from 1 to 10080")
		}
	case "schedule.default_send_minutes", "schedule.default_reminder_minutes":
		if !validScheduleDelay(value) {
			return fmt.Errorf("preference %q must be a minute value from 1 to 10080", key)
		}
	case "archive.next_room":
		if !oneOf(value, "next_visible", "next_unread", "none") {
			return errors.New("archive.next_room has an unsupported value")
		}
	case "archive.older_than_days":
		if !oneOf(value, "30", "60", "90", "180", "365") {
			return errors.New("archive.older_than_days has an unsupported value")
		}
	case "inbox.after_read":
		if !oneOf(value, "stay", "next_visible", "next_unread", "none") {
			return errors.New("inbox.after_read has an unsupported value")
		}
	case "shortcuts.mark_answered":
		shortcut, ok := value.(string)
		if !ok || len([]rune(shortcut)) != 1 {
			return errors.New("shortcuts.mark_answered must contain one character")
		}
	case "history.initial_messages":
		if !oneOf(value, "25", "50", "100", "250", "500", "1000") {
			return errors.New("history.initial_messages has an unsupported value")
		}
	default:
		return fmt.Errorf("unknown preference %q", key)
	}
	return nil
}

func validateRoomAIAgents(serialized string) error {
	const (
		maxBytes        = 32_768
		maxAgents       = 8
		maxIDRunes      = 64
		maxNameRunes    = 48
		maxPromptRunes  = 2_000
	)
	if len(serialized) > maxBytes {
		return errors.New("room AI-agent data exceeds the size limit")
	}
	var collection struct {
		Agents []struct {
			ID           string `json:"id"`
			Name         string `json:"name"`
			Instructions string `json:"instructions"`
		} `json:"agents"`
		DefaultAgentID *string `json:"defaultAgentId"`
	}
	if err := json.Unmarshal([]byte(serialized), &collection); err != nil {
		return fmt.Errorf("invalid room AI-agent JSON: %w", err)
	}
	if collection.Agents == nil || collection.DefaultAgentID == nil {
		return errors.New("room AI-agent data must include agents and defaultAgentId")
	}
	if len(collection.Agents) > maxAgents {
		return fmt.Errorf("room AI-agent data may contain at most %d profiles", maxAgents)
	}
	ids := make(map[string]struct{}, len(collection.Agents))
	for _, agent := range collection.Agents {
		if agent.ID == "" || utf8.RuneCountInString(agent.ID) > maxIDRunes {
			return errors.New("room AI-agent IDs must contain 1 to 64 characters")
		}
		if _, duplicate := ids[agent.ID]; duplicate {
			return errors.New("room AI-agent IDs must be unique")
		}
		ids[agent.ID] = struct{}{}
		if strings.TrimSpace(agent.Name) == "" || utf8.RuneCountInString(agent.Name) > maxNameRunes {
			return errors.New("room AI-agent names must contain 1 to 48 characters")
		}
		if strings.TrimSpace(agent.Instructions) == "" || utf8.RuneCountInString(agent.Instructions) > maxPromptRunes {
			return errors.New("room AI-agent instructions must contain 1 to 2000 characters")
		}
	}
	if defaultID := *collection.DefaultAgentID; defaultID != "" {
		if _, exists := ids[defaultID]; !exists {
			return errors.New("default room AI-agent must match a saved profile")
		}
	}
	return nil
}

func oneOf(value any, choices ...string) bool {
	actual, ok := value.(string)
	if !ok {
		return false
	}
	for _, choice := range choices {
		if actual == choice {
			return true
		}
	}
	return false
}

func validEmojiList(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	fields := strings.Fields(text)
	if len(fields) < 1 || len(fields) > 6 {
		return false
	}
	for _, field := range fields {
		if len(field) > 32 {
			return false
		}
	}
	return true
}

func validScheduleSuggestions(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	parts := strings.Split(text, ",")
	if len(parts) < 1 || len(parts) > 6 {
		return false
	}
	seen := make(map[int]struct{}, len(parts))
	for _, part := range parts {
		minutes, err := time.ParseDuration(strings.TrimSpace(part) + "m")
		if err != nil || minutes < time.Minute || minutes > 10080*time.Minute {
			return false
		}
		value := int(minutes / time.Minute)
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func validScheduleDelay(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	minutes, err := time.ParseDuration(text + "m")
	return err == nil && minutes >= time.Minute && minutes <= 10080*time.Minute
}
