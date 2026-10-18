package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"

	sharedpreferences "mychat/preferences"
)

type PreferenceStore struct {
	mu     sync.RWMutex
	path   string
	values map[string]any
}

func NewPreferenceStore(path string) (*PreferenceStore, error) {
	if path == "" {
		return nil, errors.New("preferences path is empty")
	}
	store := &PreferenceStore{path: path, values: make(map[string]any)}
	contents, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read preferences: %w", err)
	}
	if err = json.Unmarshal(contents, &store.values); err != nil {
		return nil, fmt.Errorf("decode preferences: %w", err)
	}
	if store.values == nil {
		return nil, errors.New("preferences must contain a JSON object")
	}
	return store, nil
}

func (s *PreferenceStore) All() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return maps.Clone(s.values)
}

func (s *PreferenceStore) Set(key string, value any) error {
	if err := validatePreference(key, value); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.values[key]
	s.values[key] = value
	if err := s.saveLocked(); err != nil {
		if existed {
			s.values[key] = previous
		} else {
			delete(s.values, key)
		}
		return err
	}
	return nil
}

func (s *PreferenceStore) saveLocked() error {
	contents, err := json.Marshal(s.values)
	if err != nil {
		return fmt.Errorf("encode preferences: %w", err)
	}
	contents = append(contents, '\n')
	directory := filepath.Dir(s.path)
	if err = os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create preferences directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".gomuks-preferences-*")
	if err != nil {
		return fmt.Errorf("create temporary preferences file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err = temporary.Chmod(0o600); err == nil {
		var written int
		written, err = temporary.Write(contents)
		if err == nil && written != len(contents) {
			err = errors.New("short write")
		}
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("write temporary preferences file: %w", err)
	}
	if err = os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace preferences file: %w", err)
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	directoryFile, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open preferences directory: %w", err)
	}
	if err = directoryFile.Sync(); err != nil {
		_ = directoryFile.Close()
		return fmt.Errorf("sync preferences directory: %w", err)
	}
	if err = directoryFile.Close(); err != nil {
		return fmt.Errorf("close preferences directory: %w", err)
	}
	return nil
}

func validatePreference(key string, value any) error {
	return sharedpreferences.Validate(key, value)
}

// validEmojiList accepts 1 to 6 space-separated tokens, each up to 32 bytes.
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
		minutes, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || minutes < 1 || minutes > 10080 {
			return false
		}
		if _, duplicate := seen[minutes]; duplicate {
			return false
		}
		seen[minutes] = struct{}{}
	}
	return true
}

func validScheduleDelay(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	minutes, err := strconv.Atoi(text)
	return err == nil && minutes >= 1 && minutes <= 10080
}

func oneOf(value any, options ...string) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	for _, option := range options {
		if text == option {
			return true
		}
	}
	return false
}
