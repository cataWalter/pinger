package matrix

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMediaEncryptedEvictsOnLeaveAndBoundsCapacity(t *testing.T) {
	client := &Client{
		mediaEncrypted: make(map[string]*EncryptedMediaFile),
	}
	client.rememberRoomMediaEncryption("!leave:example.org", []Message{
		{MediaURI: "mxc://example.org/only-left", MediaEncrypted: &EncryptedMediaFile{}},
		{MediaURI: "mxc://example.org/shared", MediaEncrypted: &EncryptedMediaFile{}},
	})
	client.rememberRoomMediaEncryption("!keep:example.org", []Message{
		{MediaURI: "mxc://example.org/shared", MediaEncrypted: &EncryptedMediaFile{}},
	})

	client.mu.Lock()
	client.forgetRoomMediaEncryptionLocked("!leave:example.org")
	client.mu.Unlock()

	if client.mediaEncryptionFor("mxc://example.org/only-left") != nil {
		t.Fatal("expected left-room encryption metadata to be evicted")
	}
	if client.mediaEncryptionFor("mxc://example.org/shared") == nil {
		t.Fatal("expected shared encryption metadata to stay while another room still uses it")
	}

	// Verify bounded capacity evicts oldest entries.
	for i := 0; i < maxMediaEncryptedEntries+5; i++ {
		uri := "mxc://example.org/item-" + time.Unix(int64(i), 0).UTC().Format("150405") + "-" + string(rune('a'+(i%26)))
		if i == 0 {
			uri = "mxc://example.org/oldest"
		}
		client.rememberRoomMediaEncryption("!keep:example.org", []Message{{
			MediaURI:       uri,
			MediaEncrypted: &EncryptedMediaFile{},
		}})
	}
	if len(client.mediaEncrypted) > maxMediaEncryptedEntries {
		t.Fatalf("mediaEncrypted len = %d, want <= %d", len(client.mediaEncrypted), maxMediaEncryptedEntries)
	}
	if client.mediaEncryptionFor("mxc://example.org/oldest") != nil {
		t.Fatal("expected oldest entry to be evicted past capacity")
	}
}

func TestEnforceMediaCachePolicyRemovesExpiredAndOversizedFiles(t *testing.T) {
	dir := t.TempDir()
	client := &Client{mediaCacheDir: dir}
	now := time.Date(2026, time.November, 26, 12, 0, 0, 0, time.UTC)

	writeFile := func(name string, size int, age time.Duration) {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, make([]byte, size), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		mt := now.Add(-age)
		if err := os.Chtimes(p, mt, mt); err != nil {
			t.Fatalf("chtimes %s: %v", name, err)
		}
	}

	writeFile("expired", 100, 40*24*time.Hour)
	writeFile("older-within-age", 60, 10*24*time.Hour)
	writeFile("newest", 60, 1*time.Hour)

	result, err := client.EnforceMediaCachePolicy(80, 30, now)
	if err != nil {
		t.Fatalf("EnforceMediaCachePolicy() error = %v", err)
	}
	if result.Files != 2 || result.Bytes != 160 {
		t.Fatalf("removed = %+v, want 2 files / 160 bytes", result)
	}
	if _, err := os.Stat(filepath.Join(dir, "newest")); err != nil {
		t.Fatalf("expected newest file to remain: %v", err)
	}
}
