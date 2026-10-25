package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSafeDownloadNameStripsPathsAndFallsBack(t *testing.T) {
	cases := map[string]string{
		"photo.jpg":        "photo.jpg",
		"../../etc/passwd": "passwd",
		"  notes.txt  ":    "notes.txt",
		"":                 "attachment",
		".":                "attachment",
		"..":               "attachment",
	}
	for input, want := range cases {
		if got := safeDownloadName(input); got != want {
			t.Errorf("safeDownloadName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUniqueDownloadPathAvoidsOverwrite(t *testing.T) {
	directory := t.TempDir()
	first := uniqueDownloadPath(directory, "photo.jpg")
	if first != filepath.Join(directory, "photo.jpg") {
		t.Fatalf("first path = %q", first)
	}
	if err := os.WriteFile(first, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := uniqueDownloadPath(directory, "photo.jpg")
	if want := filepath.Join(directory, "photo (1).jpg"); second != want {
		t.Fatalf("second path = %q, want %q", second, want)
	}
	if err := os.WriteFile(second, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	third := uniqueDownloadPath(directory, "photo.jpg")
	if want := filepath.Join(directory, "photo (2).jpg"); third != want {
		t.Fatalf("third path = %q, want %q", third, want)
	}
}

func TestRevealFileRequiresHookAndExistingAbsolutePath(t *testing.T) {
	saved := filepath.Join(t.TempDir(), "photo.png")
	if err := os.WriteFile(saved, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := &AppService{}
	if err := service.RevealFile(saved); err == nil {
		t.Fatal("RevealFile() without a file manager returned nil error")
	}
	var revealed string
	service.revealFile = func(path string) error {
		revealed = path
		return nil
	}
	if err := service.RevealFile("photo.png"); err == nil {
		t.Fatal("RevealFile() accepted a relative path")
	}
	if err := service.RevealFile(filepath.Join(t.TempDir(), "missing.png")); err == nil {
		t.Fatal("RevealFile() accepted a missing file")
	}
	if err := service.RevealFile(saved); err != nil {
		t.Fatalf("RevealFile() error = %v", err)
	}
	if revealed != saved {
		t.Fatalf("revealed = %q, want %q", revealed, saved)
	}
}
