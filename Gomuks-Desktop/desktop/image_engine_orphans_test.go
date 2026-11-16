package desktop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReapOrphanedImageEngineRemovesRecordWithoutKillingMismatchedProcess(t *testing.T) {
	path := filepath.Join(t.TempDir(), imageEngineRecordFile)
	record := imageEngineRecord{PID: os.Getpid(), Binary: "/nonexistent/sd-server", Owner: 0}
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := reapOrphanedImageEngine(path); err != nil {
		t.Fatalf("reapOrphanedImageEngine() error = %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("record still exists after reap: %v", err)
	}
}

func TestReapOrphanedImageEngineKeepsRecordOwnedByLiveInstance(t *testing.T) {
	path := filepath.Join(t.TempDir(), imageEngineRecordFile)
	record := imageEngineRecord{PID: os.Getpid(), Binary: "/nonexistent/sd-server", Owner: os.Getppid()}
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := reapOrphanedImageEngine(path); err != nil {
		t.Fatalf("reapOrphanedImageEngine() error = %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("record owned by a live instance was removed: %v", err)
	}
}

func TestImageEngineRecordPathRequiresDataDir(t *testing.T) {
	if got := imageEngineRecordPath(""); got != "" {
		t.Fatalf("imageEngineRecordPath(\"\") = %q, want empty", got)
	}
	if got := imageEngineRecordPath("/data"); got != filepath.Join("/data", imageEngineRecordFile) {
		t.Fatalf("imageEngineRecordPath(/data) = %q", got)
	}
}
