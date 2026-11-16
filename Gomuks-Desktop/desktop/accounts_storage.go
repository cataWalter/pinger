package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

func (r *accountRegistry) saveLocked() error {
	contents, err := json.Marshal(r.data)
	if err != nil {
		return fmt.Errorf("encode account registry: %w", err)
	}
	contents = append(contents, '\n')
	directory := filepath.Dir(r.path)
	if err = os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create account registry directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".pinger-accounts-*")
	if err != nil {
		return fmt.Errorf("create temporary account registry: %w", err)
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
		return fmt.Errorf("write temporary account registry: %w", err)
	}
	if err = os.Rename(temporaryPath, r.path); err != nil {
		return fmt.Errorf("replace account registry: %w", err)
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	directoryFile, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open account registry directory: %w", err)
	}
	if err = directoryFile.Sync(); err != nil {
		_ = directoryFile.Close()
		return fmt.Errorf("sync account registry directory: %w", err)
	}
	if err = directoryFile.Close(); err != nil {
		return fmt.Errorf("close account registry directory: %w", err)
	}
	return nil
}
