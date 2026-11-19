package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindRepoRootWalksUpToRepository(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "build"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module mychat\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "build", "config.yml"), []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "scripts", "dev")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := findRepoRoot(nested)
	if err != nil {
		t.Fatalf("findRepoRoot(%q) returned error: %v", nested, err)
	}
	if got != root {
		t.Fatalf("findRepoRoot(%q) = %q, want %q", nested, got, root)
	}
}
