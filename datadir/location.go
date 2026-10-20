// Package datadir keeps track of the folder the application stores its data in and
// moves that data when the user picks a different folder.
package datadir

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"mychat/sqliteutil"
)

// locationFileName is the name of the marker file that records a custom data folder.
// The marker always lives in the default folder so it can be found no matter where
// the application data is stored.
const locationFileName = "data-location.json"

// Location describes where the application keeps its data.
type Location struct {
	// DataDir is the folder the application data is stored in. An empty value means
	// the default folder is used.
	DataDir string `json:"dataDir"`
	// Pending is set when the data still has to be moved to DataDir.
	Pending bool `json:"pending"`
	// SourceDir is the folder the data currently lives in while a move is pending.
	SourceDir string `json:"sourceDir"`
	// CleanupDir is a folder that still holds a copy of the data and is emptied on
	// the next start.
	CleanupDir string `json:"cleanupDir"`
}

// LocationPath returns the path of the marker file for the given default folder.
func LocationPath(defaultDir string) string {
	return filepath.Join(defaultDir, locationFileName)
}

// Read loads the recorded data location. A missing marker means the default folder
// is used.
func Read(defaultDir string) (Location, error) {
	contents, err := os.ReadFile(LocationPath(defaultDir))
	if errors.Is(err, fs.ErrNotExist) {
		return Location{}, nil
	}
	if err != nil {
		return Location{}, fmt.Errorf("read data location: %w", err)
	}
	var location Location
	if err = json.Unmarshal(contents, &location); err != nil {
		return Location{}, fmt.Errorf("decode data location: %w", err)
	}
	return location, nil
}

// Write stores the data location atomically.
func Write(defaultDir string, location Location) error {
	contents, err := json.MarshalIndent(location, "", "  ")
	if err != nil {
		return fmt.Errorf("encode data location: %w", err)
	}
	contents = append(contents, '\n')
	if err = os.MkdirAll(defaultDir, 0o700); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	temporary, err := os.CreateTemp(defaultDir, ".pinger-location-*")
	if err != nil {
		return fmt.Errorf("create temporary data location: %w", err)
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
		return fmt.Errorf("write temporary data location: %w", err)
	}
	if err = os.Rename(temporaryPath, LocationPath(defaultDir)); err != nil {
		return fmt.Errorf("replace data location: %w", err)
	}
	return nil
}

// Clear removes the recorded data location so the default folder is used again.
func Clear(defaultDir string) error {
	if err := os.Remove(LocationPath(defaultDir)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove data location: %w", err)
	}
	return nil
}

// Effective returns the folder the application data is stored in.
func Effective(defaultDir string, location Location) string {
	if location.DataDir != "" {
		return location.DataDir
	}
	return defaultDir
}

// Request records that the data has to be moved to targetDir. The move happens on the
// next start, when no database is open.
func Request(defaultDir, targetDir, sourceDir string) error {
	location, err := Read(defaultDir)
	if err != nil {
		return err
	}
	location.DataDir = targetDir
	location.Pending = true
	location.SourceDir = sourceDir
	location.CleanupDir = ""
	return Write(defaultDir, location)
}

// ApplyPending moves the data to the folder the user picked and returns the folder the
// application should use. A failed move keeps the old folder so the application keeps
// working, and the move is retried on the next start.
func ApplyPending(defaultDir string) (string, error) {
	location, err := Read(defaultDir)
	if err != nil {
		return defaultDir, err
	}
	effective := Effective(defaultDir, location)
	if location.CleanupDir != "" && location.CleanupDir != effective && location.CleanupDir != defaultDir {
		if cleanupErr := RemoveData(location.CleanupDir); cleanupErr == nil {
			location.CleanupDir = ""
			if writeErr := Write(defaultDir, location); writeErr != nil {
				return effective, writeErr
			}
		}
	}
	if !location.Pending || location.DataDir == "" {
		return effective, nil
	}

	target := location.DataDir
	source := location.SourceDir
	if source == "" {
		source = effective
	}
	if source == target {
		location.Pending = false
		location.SourceDir = ""
		if target == defaultDir {
			return defaultDir, Clear(defaultDir)
		}
		return target, Write(defaultDir, location)
	}
	if err = CopyData(source, target); err != nil {
		return source, fmt.Errorf("copy data to %q: %w", target, err)
	}

	// The copy succeeded, so the new folder holds the application data from now on.
	location.Pending = false
	location.SourceDir = ""
	location.DataDir = target
	if cleanupErr := RemoveData(source); cleanupErr != nil {
		location.CleanupDir = source
	} else {
		location.CleanupDir = ""
	}
	if target == defaultDir {
		return defaultDir, Clear(defaultDir)
	}
	return target, Write(defaultDir, location)
}

// CopyData copies the application data from sourceDir into targetDir.
func CopyData(sourceDir, targetDir string) error {
	source, err := filepath.Abs(sourceDir)
	if err != nil {
		return fmt.Errorf("resolve source data directory: %w", err)
	}
	target, err := filepath.Abs(targetDir)
	if err != nil {
		return fmt.Errorf("resolve target data directory: %w", err)
	}
	if source == target {
		return nil
	}
	if err = os.MkdirAll(target, 0o700); err != nil {
		return fmt.Errorf("create data directory %q: %w", target, err)
	}
	return copyDirectory(source, target)
}

// RemoveData deletes the application data in directory. The data location marker is
// kept so the application can still find the selected folder.
func RemoveData(directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read data directory %q: %w", directory, err)
	}
	for _, entry := range entries {
		if entry.Name() == locationFileName {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		if err = os.RemoveAll(path); err != nil {
			return fmt.Errorf("remove %q: %w", path, err)
		}
	}
	return nil
}

func copyDirectory(source, target string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return fmt.Errorf("read data directory %q: %w", source, err)
	}
	for _, entry := range entries {
		if entry.Name() == locationFileName {
			continue
		}
		sourcePath := filepath.Join(source, entry.Name())
		targetPath := filepath.Join(target, entry.Name())
		if entry.IsDir() {
			if err = os.MkdirAll(targetPath, 0o700); err != nil {
				return fmt.Errorf("create data directory %q: %w", targetPath, err)
			}
			if err = copyDirectory(sourcePath, targetPath); err != nil {
				return err
			}
			continue
		}
		if err = copyFile(sourcePath, targetPath); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(source, target string) error {
	if strings.HasSuffix(source, ".db") {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if err := os.Remove(target + suffix); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return fmt.Errorf("remove %q: %w", target+suffix, err)
			}
		}
		if err := sqliteutil.Backup(source, target); err != nil {
			return fmt.Errorf("copy database %q: %w", source, err)
		}
		if err := os.Chmod(target, 0o600); err != nil {
			return fmt.Errorf("secure copied database: %w", err)
		}
		return nil
	}
	contents, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("read %q: %w", source, err)
	}
	if err = os.WriteFile(target, contents, 0o600); err != nil {
		return fmt.Errorf("write %q: %w", target, err)
	}
	return nil
}
