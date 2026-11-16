package datadir

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestEffectiveUsesTheDefaultFolderWithoutAMarker(t *testing.T) {
	defaultDir := t.TempDir()
	if got := Effective(defaultDir, Location{}); got != defaultDir {
		t.Fatalf("Effective() = %q, want %q", got, defaultDir)
	}
	custom := filepath.Join(t.TempDir(), "custom")
	if got := Effective(defaultDir, Location{DataDir: custom}); got != custom {
		t.Fatalf("Effective() = %q, want %q", got, custom)
	}
}

func TestApplyPendingMovesTheDataToTheSelectedFolder(t *testing.T) {
	defaultDir := filepath.Join(t.TempDir(), "default")
	target := filepath.Join(t.TempDir(), "custom")
	writeApplicationData(t, defaultDir, "hello")

	if err := Request(defaultDir, target, defaultDir); err != nil {
		t.Fatalf("Request() error = %v", err)
	}
	location, err := Read(defaultDir)
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if !location.Pending || location.DataDir != target || location.SourceDir != defaultDir {
		t.Fatalf("recorded location = %+v, want a pending move to %q", location, target)
	}

	effective, err := ApplyPending(defaultDir)
	if err != nil {
		t.Fatalf("ApplyPending() error = %v", err)
	}
	if effective != target {
		t.Fatalf("ApplyPending() = %q, want %q", effective, target)
	}
	if got := readMessage(t, filepath.Join(target, "matrix.db")); got != "hello" {
		t.Fatalf("moved database message = %q, want the copied message", got)
	}
	if got := readFile(t, filepath.Join(target, "crypto.key")); got != "key" {
		t.Fatalf("moved crypto key = %q, want the copied key", got)
	}
	if got := readFile(t, filepath.Join(target, "accounts.json")); got != "{}" {
		t.Fatalf("moved account registry = %q, want the copied registry", got)
	}
	if exists(t, filepath.Join(defaultDir, "matrix.db")) {
		t.Fatal("the database was left behind in the old folder")
	}
	if exists(t, filepath.Join(defaultDir, "crypto.key")) {
		t.Fatal("the crypto key was left behind in the old folder")
	}
	if !exists(t, LocationPath(defaultDir)) {
		t.Fatal("the data location marker was removed from the default folder")
	}

	location, err = Read(defaultDir)
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if location.Pending {
		t.Fatalf("recorded location = %+v, want the move to be finished", location)
	}
	if location.DataDir != target {
		t.Fatalf("recorded location = %+v, want the data folder %q", location, target)
	}
}

func TestApplyPendingMovesTheDataBackToTheDefaultFolder(t *testing.T) {
	defaultDir := filepath.Join(t.TempDir(), "default")
	custom := filepath.Join(t.TempDir(), "custom")
	writeApplicationData(t, custom, "moved")

	if err := Request(defaultDir, defaultDir, custom); err != nil {
		t.Fatalf("Request() error = %v", err)
	}
	effective, err := ApplyPending(defaultDir)
	if err != nil {
		t.Fatalf("ApplyPending() error = %v", err)
	}
	if effective != defaultDir {
		t.Fatalf("ApplyPending() = %q, want %q", effective, defaultDir)
	}
	if got := readMessage(t, filepath.Join(defaultDir, "matrix.db")); got != "moved" {
		t.Fatalf("moved database message = %q, want the copied message", got)
	}
	if exists(t, filepath.Join(custom, "matrix.db")) {
		t.Fatal("the database was left behind in the old folder")
	}
	if exists(t, LocationPath(defaultDir)) {
		t.Fatal("the data location marker should be removed when the default folder is used")
	}
}

func TestApplyPendingKeepsTheOldFolderWhenTheCopyFails(t *testing.T) {
	defaultDir := filepath.Join(t.TempDir(), "default")
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("not a folder"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeApplicationData(t, defaultDir, "hello")

	if err := Request(defaultDir, blocked, defaultDir); err != nil {
		t.Fatalf("Request() error = %v", err)
	}
	effective, err := ApplyPending(defaultDir)
	if err == nil {
		t.Fatal("ApplyPending() succeeded with an unusable target folder")
	}
	if effective != defaultDir {
		t.Fatalf("ApplyPending() = %q, want the unchanged folder %q", effective, defaultDir)
	}
	if got := readMessage(t, filepath.Join(defaultDir, "matrix.db")); got != "hello" {
		t.Fatalf("database message = %q, want the untouched message", got)
	}
	location, err := Read(defaultDir)
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if !location.Pending {
		t.Fatalf("recorded location = %+v, want the move to be retried", location)
	}
}

func TestApplyPendingKeepsCustomSourceWhenTheCopyFails(t *testing.T) {
	defaultDir := filepath.Join(t.TempDir(), "default")
	sourceDir := filepath.Join(t.TempDir(), "source")
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("not a folder"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeApplicationData(t, sourceDir, "custom data")

	if err := Request(defaultDir, blocked, sourceDir); err != nil {
		t.Fatalf("Request() error = %v", err)
	}
	effective, err := ApplyPending(defaultDir)
	if err == nil {
		t.Fatal("ApplyPending() succeeded with an unusable target folder")
	}
	if effective != sourceDir {
		t.Fatalf("ApplyPending() = %q, want the unchanged source %q", effective, sourceDir)
	}
	if got := readMessage(t, filepath.Join(sourceDir, "matrix.db")); got != "custom data" {
		t.Fatalf("source database message = %q, want custom data", got)
	}
	if exists(t, filepath.Join(defaultDir, "matrix.db")) {
		t.Fatal("failed move created a database in the default folder")
	}
}

func TestCopyDataRejectsNestedDestination(t *testing.T) {
	source := t.TempDir()
	writeApplicationData(t, source, "hello")
	target := filepath.Join(source, "nested")

	if err := CopyData(source, target); err == nil {
		t.Fatal("CopyData() succeeded with a destination nested in the source")
	}
	if exists(t, target) {
		t.Fatal("CopyData() created the nested destination")
	}
}

func TestRemoveDataKeepsTheLocationMarker(t *testing.T) {
	directory := t.TempDir()
	writeApplicationData(t, directory, "hello")
	if err := Write(directory, Location{DataDir: directory}); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if err := RemoveData(directory); err != nil {
		t.Fatalf("RemoveData() error = %v", err)
	}
	if exists(t, filepath.Join(directory, "matrix.db")) {
		t.Fatal("RemoveData() left the database behind")
	}
	if !exists(t, LocationPath(directory)) {
		t.Fatal("RemoveData() removed the data location marker")
	}
}

func TestCopyDataCopiesAccountDatabases(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	target := filepath.Join(t.TempDir(), "target")
	accountDatabase := filepath.Join(source, "accounts", "abc", "matrix.db")
	createMessageDatabase(t, accountDatabase, "account message")
	writeFile(t, filepath.Join(source, "accounts.json"), "{}")

	if err := CopyData(source, target); err != nil {
		t.Fatalf("CopyData() error = %v", err)
	}
	if got := readMessage(t, filepath.Join(target, "accounts", "abc", "matrix.db")); got != "account message" {
		t.Fatalf("copied account message = %q, want the copied message", got)
	}
	if !exists(t, accountDatabase) {
		t.Fatal("CopyData() removed the source database")
	}
}

func writeApplicationData(t *testing.T, directory, message string) {
	t.Helper()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	createMessageDatabase(t, filepath.Join(directory, "matrix.db"), message)
	writeFile(t, filepath.Join(directory, "crypto.key"), "key")
	writeFile(t, filepath.Join(directory, "accounts.json"), "{}")
}

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func createMessageDatabase(t *testing.T, path, message string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	for _, statement := range []string{
		"PRAGMA journal_mode=WAL",
		"CREATE TABLE IF NOT EXISTS messages (body TEXT NOT NULL)",
		"INSERT INTO messages (body) VALUES (?)",
	} {
		if statement == "INSERT INTO messages (body) VALUES (?)" {
			if _, err = db.Exec(statement, message); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if _, err = db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
}

func readMessage(t *testing.T, path string) string {
	t.Helper()
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var body string
	if err = db.QueryRow("SELECT body FROM messages").Scan(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func exists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	if err == nil {
		return true
	}
	if os.IsNotExist(err) {
		return false
	}
	t.Fatal(err)
	return false
}
