package desktop

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mychat/datadir"
)

// DataLocation describes the folders the application stores its data in.
type DataLocation struct {
	// DataDir is the folder the application data is stored in right now.
	DataDir string `json:"dataDir"`
	// DefaultDir is the folder the application uses when no other folder was picked.
	DefaultDir string `json:"defaultDir"`
	// PendingDir is the folder the data is moved to on the next start.
	PendingDir string `json:"pendingDir"`
	// MediaCacheDir is the folder downloaded media is cached in.
	MediaCacheDir string `json:"mediaCacheDir"`
}

// DataLocation returns the folders the application stores its data in.
func (s *AppService) DataLocation() DataLocation {
	s.accountMu.RLock()
	dataDir, defaultDir, mediaCacheDir := s.dataDir, s.defaultDataDir, s.accountMediaCacheDir
	s.accountMu.RUnlock()

	location := DataLocation{DataDir: dataDir, DefaultDir: defaultDir, MediaCacheDir: mediaCacheDir}
	if defaultDir == "" {
		return location
	}
	recorded, err := datadir.Read(defaultDir)
	if err != nil {
		return location
	}
	if recorded.Pending && recorded.DataDir != "" {
		location.PendingDir = recorded.DataDir
	}
	return location
}

// ChooseDataFolder opens a native folder picker and returns the selected directory,
// or an empty string when the picker was cancelled.
func (s *AppService) ChooseDataFolder() (string, error) {
	if s.chooseDataFolder == nil {
		return "", errors.New("folder picker is unavailable")
	}
	return s.chooseDataFolder()
}

// SetDataFolder moves the application data to the given folder. The move happens when
// Pinger restarts, because the databases cannot be moved while they are open.
func (s *AppService) SetDataFolder(path string) (DataLocation, error) {
	target, err := validateDataFolder(path)
	if err != nil {
		return DataLocation{}, err
	}
	s.accountMu.RLock()
	current, defaultDir := s.dataDir, s.defaultDataDir
	s.accountMu.RUnlock()
	if defaultDir == "" {
		return DataLocation{}, errors.New("the data folder is unavailable")
	}
	if sameDirectory(target, current) {
		return s.DataLocation(), errors.New("Pinger already stores its data in this folder")
	}
	if err = datadir.Request(defaultDir, target, current); err != nil {
		return DataLocation{}, fmt.Errorf("save data folder: %w", err)
	}
	return s.DataLocation(), nil
}

// UseDefaultDataFolder moves the application data back to the default folder.
func (s *AppService) UseDefaultDataFolder() (DataLocation, error) {
	s.accountMu.RLock()
	defaultDir := s.defaultDataDir
	s.accountMu.RUnlock()
	if defaultDir == "" {
		return DataLocation{}, errors.New("the default data folder is unavailable")
	}
	return s.SetDataFolder(defaultDir)
}

// RestartApp quits Pinger and starts it again, so a new data folder is applied.
func (s *AppService) RestartApp() error {
	if s.quit == nil {
		return errors.New("Pinger cannot restart right now")
	}
	s.restartRequested.Store(true)
	s.quit()
	return nil
}

func validateDataFolder(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", errors.New("choose a folder for the Pinger data")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return "", fmt.Errorf("resolve data folder: %w", err)
	}
	if err = os.MkdirAll(absolute, 0o700); err != nil {
		return "", fmt.Errorf("create data folder: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("inspect data folder: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%q is not a folder", absolute)
	}
	probe, err := os.CreateTemp(absolute, ".pinger-write-test-*")
	if err != nil {
		return "", fmt.Errorf("the folder is not writable: %w", err)
	}
	probePath := probe.Name()
	if err = probe.Close(); err != nil {
		_ = os.Remove(probePath)
		return "", fmt.Errorf("the folder is not writable: %w", err)
	}
	if err = os.Remove(probePath); err != nil {
		return "", fmt.Errorf("the folder is not writable: %w", err)
	}
	return absolute, nil
}

func sameDirectory(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	leftPath, leftErr := filepath.Abs(left)
	rightPath, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return filepath.Clean(leftPath) == filepath.Clean(rightPath)
}
