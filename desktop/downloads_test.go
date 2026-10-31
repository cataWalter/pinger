package desktop

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
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

func TestSaveDownloadAvoidsOverwrite(t *testing.T) {
	directory := t.TempDir()
	first, err := saveDownload(directory, "photo.jpg", []byte("a"))
	if err != nil {
		t.Fatal(err)
	}
	if first != filepath.Join(directory, "photo.jpg") {
		t.Fatalf("first path = %q", first)
	}
	second, err := saveDownload(directory, "photo.jpg", []byte("b"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(directory, "photo (1).jpg"); second != want {
		t.Fatalf("second path = %q, want %q", second, want)
	}
	third, err := saveDownload(directory, "photo.jpg", []byte("c"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(directory, "photo (2).jpg"); third != want {
		t.Fatalf("third path = %q, want %q", third, want)
	}
}

func TestSaveDownloadConcurrentNamesKeepDistinctContents(t *testing.T) {
	directory := t.TempDir()
	const count = 16
	paths := make(chan string, count)
	var workers sync.WaitGroup
	for index := 0; index < count; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			contents := fmt.Sprintf("download-%d", index)
			path, err := saveDownload(directory, "photo.jpg", []byte(contents))
			if err != nil {
				t.Error(err)
				return
			}
			actual, err := os.ReadFile(path)
			if err != nil || string(actual) != contents {
				t.Errorf("download contents = %q, %v; want %q", actual, err, contents)
			}
			paths <- path
		}()
	}
	workers.Wait()
	close(paths)
	unique := make(map[string]bool)
	for path := range paths {
		unique[path] = true
	}
	if len(unique) != count {
		t.Fatalf("saved %d distinct downloads, want %d", len(unique), count)
	}
}

func TestSaveDownloadCollisionLimitDoesNotOverwrite(t *testing.T) {
	directory := t.TempDir()
	for index := 0; index < 1000; index++ {
		name := "photo.jpg"
		if index > 0 {
			name = fmt.Sprintf("photo (%d).jpg", index)
		}
		if err := os.WriteFile(filepath.Join(directory, name), []byte("original"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if path, err := saveDownload(directory, "photo.jpg", []byte("replacement")); err == nil || path != "" {
		t.Fatalf("exhausted download = %q, %v; want error", path, err)
	}
	contents, err := os.ReadFile(filepath.Join(directory, "photo (999).jpg"))
	if err != nil || string(contents) != "original" {
		t.Fatalf("last existing download = %q, %v", contents, err)
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
