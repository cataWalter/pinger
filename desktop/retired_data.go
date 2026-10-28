package desktop

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// removeRetiredFeatureFiles deletes the relationship-health database and its SQLite sidecar files.
// The database lives next to each account's matrix.db: the primary account uses dataDir directly and
// other accounts use dataDir/accounts/<id>. Missing files are ignored, so it is safe to run on every start.
func removeRetiredFeatureFiles(dataDir string) error {
	patterns := []string{
		filepath.Join(dataDir, "relationship-health.db*"),
		filepath.Join(dataDir, "accounts", "*", "relationship-health.db*"),
	}
	var failures []error
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			return fmt.Errorf("find retired feature files: %w", err)
		}
		for _, match := range matches {
			if err := os.Remove(match); err != nil && !errors.Is(err, fs.ErrNotExist) {
				failures = append(failures, fmt.Errorf("remove %s: %w", match, err))
			}
		}
	}
	return errors.Join(failures...)
}
