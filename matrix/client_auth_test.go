package matrix

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreatePickleKeyRecoversFromEmptyKeyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crypto.key")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	key, err := loadOrCreatePickleKey(path)
	if err != nil {
		t.Fatalf("loadOrCreatePickleKey() error = %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("key length = %d, want 32", len(key))
	}
	again, err := loadOrCreatePickleKey(path)
	if err != nil || !bytes.Equal(key, again) {
		t.Fatalf("second load = %x, %v; want the stored key %x", again, err, key)
	}
}

func TestLoadOrCreatePickleKeyRejectsPartialKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crypto.key")
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOrCreatePickleKey(path); err == nil {
		t.Fatal("loadOrCreatePickleKey() accepted a partial key")
	}
}
