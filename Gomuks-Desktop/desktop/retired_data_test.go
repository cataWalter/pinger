package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveRetiredFeatureFilesRemovesRelationshipDatabases(t *testing.T) {
	dataDir := t.TempDir()
	retired := []string{
		filepath.Join(dataDir, "relationship-health.db"),
		filepath.Join(dataDir, "relationship-health.db-wal"),
		filepath.Join(dataDir, "accounts", "0123456789abcdef0123456789abcdef", "relationship-health.db"),
	}
	kept := []string{
		filepath.Join(dataDir, "matrix.db"),
		filepath.Join(dataDir, "accounts", "0123456789abcdef0123456789abcdef", "matrix.db"),
	}
	for _, path := range append(append([]string{}, retired...), kept...) {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("data"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := removeRetiredFeatureFiles(dataDir); err != nil {
		t.Fatalf("removeRetiredFeatureFiles() error = %v", err)
	}
	for _, path := range retired {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("%s still exists after cleanup (err = %v)", path, err)
		}
	}
	for _, path := range kept {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("%s was removed: %v", path, err)
		}
	}
	if err := removeRetiredFeatureFiles(dataDir); err != nil {
		t.Fatalf("second removeRetiredFeatureFiles() error = %v", err)
	}
}
