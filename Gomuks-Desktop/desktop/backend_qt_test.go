package desktop

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mychat/matrix"
)

func TestRunQtBackendStartsAndStopsWithoutWailsApplication(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	client, err := matrix.New(filepath.Join(dataDir, "matrix.db"))
	if err != nil {
		t.Fatalf("create Matrix client: %v", err)
	}

	var output bytes.Buffer
	if err = runQtBackend(
		client,
		dataDir,
		dataDir,
		filepath.Join(root, "preferences.json"),
		filepath.Join(root, "media"),
		strings.NewReader(""),
		&output,
	); err != nil {
		t.Fatalf("run Qt backend with closed input: %v", err)
	}
}
