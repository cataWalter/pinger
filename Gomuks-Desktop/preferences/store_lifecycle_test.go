package preferences

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStorePublishesChangesAcrossOpenStores(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.db")
	writer, err := open(path, 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	reader, err := open(path, 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	changes, unsubscribe := reader.Subscribe(1)
	defer unsubscribe()
	if err := writer.SetGlobal("notifications.enabled", false); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changes:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cross-process preference change")
	}
	values, err := reader.Snapshot("")
	if err != nil {
		t.Fatal(err)
	}
	if values["notifications.enabled"] != false {
		t.Fatalf("reader snapshot = %#v", values)
	}
}

func TestNotificationAllowedUsesCategoryAndRoomPreferences(t *testing.T) {
	values := map[string]any{
		"notifications.direct":          true,
		"notifications.mentions":        false,
		"notifications.group":           true,
		"room.muted.!muted:example.org": true,
	}
	if !NotificationAllowed(values, "!direct:example.org", NotificationCategoryDirect) {
		t.Fatal("direct notification was unexpectedly blocked")
	}
	if NotificationAllowed(values, "!mention:example.org", NotificationCategoryMention) {
		t.Fatal("mention notification was unexpectedly allowed")
	}
	if !NotificationAllowed(values, "!group:example.org", NotificationCategoryGroup) {
		t.Fatal("group notification was unexpectedly blocked")
	}
	if NotificationAllowed(values, "!muted:example.org", NotificationCategoryDirect) {
		t.Fatal("muted-room notification was unexpectedly allowed")
	}
	if NotificationAllowed(nil, "!group:example.org", NotificationCategoryGroup) {
		t.Fatal("group notification should default to disabled")
	}
}

func TestValidateRoomToneGuardPreference(t *testing.T) {
	if err := Validate("room.tone_guard.!room:example.org", true); err != nil {
		t.Fatalf("Validate(room tone guard) error = %v", err)
	}
	if err := Validate("room.tone_guard.!room:example.org", "true"); err == nil {
		t.Fatal("Validate(room tone guard) accepted a non-boolean value")
	}
	if err := Validate("room.tone_guard.", true); err == nil {
		t.Fatal("Validate(room tone guard) accepted a missing room ID")
	}
}

func TestValidateRoomNeedsReplyPreference(t *testing.T) {
	if err := Validate("room.needs_reply.!room:example.org", true); err != nil {
		t.Fatalf("Validate(room needs reply) error = %v", err)
	}
	if err := Validate("room.needs_reply.!room:example.org", false); err != nil {
		t.Fatalf("Validate(cleared room needs reply) error = %v", err)
	}
	if err := Validate("room.needs_reply.!room:example.org", "true"); err == nil {
		t.Fatal("Validate(room needs reply) accepted a string value")
	}
	if err := Validate("room.needs_reply.", true); err == nil {
		t.Fatal("Validate(room needs reply) accepted a missing room ID")
	}
}

func TestImportLegacyPreferencesCreatesBackup(t *testing.T) {
	directory := t.TempDir()
	legacyPath := filepath.Join(directory, "preferences.json")
	if err := os.WriteFile(legacyPath, []byte(`{"appearance.compact":true,"room.favorite.!room:example.org":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := open(filepath.Join(directory, "preferences.db"), 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	imported, err := store.ImportLegacy(legacyPath, "primary")
	if err != nil || !imported {
		t.Fatalf("ImportLegacy() = %t, %v", imported, err)
	}
	snapshot, err := store.Snapshot("primary")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot["appearance.compact"] != true || snapshot["room.favorite.!room:example.org"] != true {
		t.Fatalf("imported snapshot = %#v", snapshot)
	}
	if _, err := os.Stat(legacyPath + ".backup"); err != nil {
		t.Fatal(err)
	}
}
