package preferences

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"strings"
)

// readPreferenceRaw returns the stored JSON for one preference inside tx.
func readPreferenceRaw(tx *sql.Tx, scope Scope, accountID, key string) ([]byte, bool, error) {
	var raw []byte
	err := tx.QueryRow("SELECT value_json FROM preferences WHERE scope = ? AND account_id = ? AND key = ?", scope, accountID, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read preference %q: %w", key, err)
	}
	return raw, true, nil
}

// effectiveString returns the value a global string preference will have after writes are applied.
func effectiveString(tx *sql.Tx, writes []write, key string) (string, error) {
	for _, w := range writes {
		if w.key != key {
			continue
		}
		value, ok := w.value.(string)
		if !ok {
			return "", fmt.Errorf("preference %q must be a string", key)
		}
		return value, nil
	}
	raw, found, err := readPreferenceRaw(tx, GlobalScope, "", key)
	if err != nil || !found {
		return "", err
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("decode preference %q: %w", key, err)
	}
	return value, nil
}

// validateBatchLanguages checks language rules that involve more than one preference.
func validateBatchLanguages(tx *sql.Tx, writes []write) error {
	if touchesAnyKey(writes, "ai.tutor_language", "ai.default_language") {
		learning, err := effectiveString(tx, writes, "ai.tutor_language")
		if err != nil {
			return err
		}
		defaultCode, err := effectiveString(tx, writes, "ai.default_language")
		if err != nil {
			return err
		}
		if defaultCode == "" {
			defaultCode = "en"
		}
		if learning != "" && learning == defaultCode {
			return errors.New("learning language must differ from the default language")
		}
	}
	return nil
}

// validateLanguagesAfterCustomChange rejects a custom language change that leaves the learning, default, or known
// languages pointing at a language that no longer exists.
func validateLanguagesAfterCustomChange(tx *sql.Tx, writes []write, languages LanguageLookup) error {
	if !touchesAnyKey(writes, "ai.custom_languages") {
		return nil
	}
	for _, key := range []string{"ai.tutor_language", "ai.default_language"} {
		code, err := effectiveString(tx, writes, key)
		if err != nil {
			return err
		}
		if _, ok := languages[code]; code != "" && !ok {
			return fmt.Errorf("%s still uses a language that would be removed", key)
		}
	}
	serialized, err := effectiveString(tx, writes, "ai.known_languages")
	if err != nil {
		return err
	}
	var known []string
	if serialized != "" {
		_ = json.Unmarshal([]byte(serialized), &known)
	}
	for _, code := range known {
		if _, ok := languages[code]; !ok {
			return errors.New("ai.known_languages still uses a language that would be removed")
		}
	}
	return validateRoomLanguagesAfterCustomChange(tx, writes, languages)
}

func validateRoomLanguagesAfterCustomChange(tx *sql.Tx, writes []write, languages LanguageLookup) error {
	rows, err := tx.Query(`SELECT account_id, key, value_json FROM preferences
		WHERE scope = ? AND (key GLOB ? OR key GLOB ?)`, AccountScope, roomTutorLanguagePrefix+"*", roomLearningLanguagePrefix+"*")
	if err != nil {
		return fmt.Errorf("read room language preferences: %w", err)
	}
	defer rows.Close()
	values := make(map[string]string)
	for rows.Next() {
		var accountID, key string
		var raw []byte
		if err := rows.Scan(&accountID, &key, &raw); err != nil {
			return fmt.Errorf("read room language preference: %w", err)
		}
		var code string
		if err := json.Unmarshal(raw, &code); err != nil {
			return fmt.Errorf("decode room language preference %q: %w", key, err)
		}
		values[accountID+"\x00"+key] = code
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read room language preferences: %w", err)
	}
	for _, w := range writes {
		if w.scope == AccountScope && isRoomLanguagePreference(w.key) {
			code, _ := w.value.(string)
			values[w.accountID+"\x00"+w.key] = code
		}
	}
	for key, code := range values {
		if _, ok := languages[code]; code != "" && !ok {
			return fmt.Errorf("room language preference %q still uses a language that would be removed", key)
		}
	}
	return nil
}

func isRoomLanguagePreference(key string) bool {
	return strings.HasPrefix(key, roomTutorLanguagePrefix) || strings.HasPrefix(key, roomLearningLanguagePrefix)
}

func touchesAnyKey(writes []write, keys ...string) bool {
	for _, w := range writes {
		for _, key := range keys {
			if w.key == key {
				return true
			}
		}
	}
	return false
}

// retiredPreferenceKeys lists exact keys written by features that have been removed.
var retiredPreferenceKeys = map[string]bool{
	"busy_mode.enabled":           true,
	"composer.spellcheck":         true,
	"ghostwriter.enabled":         true,
	"ghostwriter.endpoint":        true,
	"ghostwriter.provider":        true,
	"ghostwriter.model":           true,
	"relationship_health.enabled": true,
}

// retiredPreferencePrefixes lists key prefixes written by features that have been removed.
var retiredPreferencePrefixes = []string{
	"room.ghostwriter.",
	"room.tone_guard.",
	"ai.feature.ghostwriter.",
	"ai.feature.contact_dossier.",
	"ai.feature.tone_guard.",
}

func isRetiredPreferenceKey(key string) bool {
	if retiredPreferenceKeys[key] {
		return true
	}
	for _, prefix := range retiredPreferencePrefixes {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

// DeleteRetired removes stored preferences written by removed features across all scopes.
// It returns the number of rows deleted and is safe to call on every start.
func (s *Store) DeleteRetired() (int, error) {
	type storedKey struct {
		scope     string
		accountID string
		key       string
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin retired preference cleanup: %w", err)
	}
	defer tx.Rollback()
	var retired []storedKey
	rows, err := tx.Query("SELECT scope, account_id, key FROM preferences")
	if err != nil {
		return 0, fmt.Errorf("read preferences for cleanup: %w", err)
	}
	for rows.Next() {
		var row storedKey
		if err := rows.Scan(&row.scope, &row.accountID, &row.key); err != nil {
			_ = rows.Close()
			return 0, fmt.Errorf("decode preference key: %w", err)
		}
		if isRetiredPreferenceKey(row.key) {
			retired = append(retired, row)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, fmt.Errorf("read preference keys: %w", err)
	}
	if err := rows.Close(); err != nil {
		return 0, fmt.Errorf("close preference key rows: %w", err)
	}
	if len(retired) == 0 {
		return 0, nil
	}
	var revision int64
	if err := tx.QueryRow("SELECT revision FROM preference_meta WHERE id = 1").Scan(&revision); err != nil {
		return 0, fmt.Errorf("read preference revision: %w", err)
	}
	revision++
	for _, row := range retired {
		if _, err := tx.Exec("DELETE FROM preferences WHERE scope = ? AND account_id = ? AND key = ?", row.scope, row.accountID, row.key); err != nil {
			return 0, fmt.Errorf("delete retired preference %q: %w", row.key, err)
		}
	}
	if _, err := tx.Exec("UPDATE preference_meta SET revision = ? WHERE id = 1", revision); err != nil {
		return 0, fmt.Errorf("write preference revision: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit retired preference cleanup: %w", err)
	}
	s.markRevision(revision)
	s.publish(Change{Revision: revision})
	return len(retired), nil
}

// DeleteAccountsExcept removes account-scoped preferences for every account other than keepAccountID.
// It returns the number of rows deleted and is safe to call on every start.
func (s *Store) DeleteAccountsExcept(keepAccountID string) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin account preference cleanup: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.Exec("DELETE FROM preferences WHERE scope = ? AND account_id <> ?", AccountScope, keepAccountID)
	if err != nil {
		return 0, fmt.Errorf("delete preferences for other accounts: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count deleted account preferences: %w", err)
	}
	if deleted == 0 {
		return 0, nil
	}
	var revision int64
	if err := tx.QueryRow("SELECT revision FROM preference_meta WHERE id = 1").Scan(&revision); err != nil {
		return 0, fmt.Errorf("read preference revision: %w", err)
	}
	revision++
	if _, err := tx.Exec("UPDATE preference_meta SET revision = ? WHERE id = 1", revision); err != nil {
		return 0, fmt.Errorf("write preference revision: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit account preference cleanup: %w", err)
	}
	s.markRevision(revision)
	s.publish(Change{Revision: revision})
	return int(deleted), nil
}
