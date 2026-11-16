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
