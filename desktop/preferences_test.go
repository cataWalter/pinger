package desktop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPreferenceStoreLoadsAndPersistsValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config", "preferences.json")
	legacyValues := map[string]any{
		"appearance.theme":   "Dark",
		"appearance.compact": true,
		"future.preference":  "preserved",
	}
	contents, err := json.Marshal(legacyValues)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	store, err := NewPreferenceStore(path)
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if got := store.All(); !reflect.DeepEqual(got, map[string]any{
		"appearance.theme":   "Dark",
		"appearance.compact": true,
		"future.preference":  "preserved",
	}) {
		t.Fatalf("All() = %#v", got)
	}
	if err = store.Set("room.favorite.!room:example.org", true); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	if err = store.Set("room.archived.primary.!room:example.org", true); err != nil {
		t.Fatalf("Set() room archive error = %v", err)
	}
	if err = store.Set("appearance.theme", "Light"); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	if err = store.Set("history.initial_messages", "250"); err != nil {
		t.Fatalf("Set() history.initial_messages error = %v", err)
	}

	reloaded, err := NewPreferenceStore(path)
	if err != nil {
		t.Fatalf("reload preferences: %v", err)
	}
	values := reloaded.All()
	if values["appearance.theme"] != "Light" || values["room.favorite.!room:example.org"] != true || values["room.archived.primary.!room:example.org"] != true || values["history.initial_messages"] != "250" || values["future.preference"] != "preserved" {
		t.Fatalf("persisted values = %#v", values)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("preferences permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestPreferenceStoreAcceptsAdditionalThemes(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, theme := range []string{"Bosco", "Rosa"} {
		if err = store.Set("appearance.theme", theme); err != nil {
			t.Errorf("Set(appearance.theme, %q) error = %v", theme, err)
		}
	}
}

func TestPreferenceStoreAcceptsCopyTimestampSetting(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Set("clipboard.copy_timestamp", true); err != nil {
		t.Fatalf("Set(clipboard.copy_timestamp, true) error = %v", err)
	}
}

func TestPreferenceStoreAcceptsAccentPalette(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, palette := range []string{"Forest", "Ocean", "Rose", "Gold"} {
		if err = store.Set("appearance.accent_color", palette); err != nil {
			t.Errorf("Set(appearance.accent_color, %q) error = %v", palette, err)
		}
	}
}

func TestPreferenceStoreAcceptsChatWallpaper(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, wallpaper := range []string{"None", "Meadow", "Tide", "Rose"} {
		if err = store.Set("appearance.chat_wallpaper", wallpaper); err != nil {
			t.Errorf("Set(appearance.chat_wallpaper, %q) error = %v", wallpaper, err)
		}
	}
}

func TestPreferenceStoreAcceptsChatListSettings(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"sidebar.compact_chat_list", "sidebar.show_previews", "sidebar.show_unread_counts"} {
		if err = store.Set(key, false); err != nil {
			t.Errorf("Set(%s, false) error = %v", key, err)
		}
	}
}

func TestPreferenceStoreAcceptsScheduleTimeSuggestions(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Set("schedule.suggestions_minutes", "5, 15, 60, 240"); err != nil {
		t.Fatalf("Set(schedule.suggestions_minutes) error = %v", err)
	}
}

func TestPreferenceStoreAcceptsArchiveNavigationPreference(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"next_visible", "next_unread", "none"} {
		if err = store.Set("archive.next_room", value); err != nil {
			t.Errorf("Set(archive.next_room, %q) error = %v", value, err)
		}
	}
}

func TestPreferenceStoreAcceptsArchiveAgePreference(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"1", "7", "30", "90", "365", "3650"} {
		if err = store.Set("archive.older_than_days", value); err != nil {
			t.Errorf("Set(archive.older_than_days, %q) error = %v", value, err)
		}
	}
	for _, value := range []string{"0", "-1", "1.5", "3651", "thirty"} {
		if err = store.Set("archive.older_than_days", value); err == nil {
			t.Errorf("Set(archive.older_than_days, %q) unexpectedly succeeded", value)
		}
	}
	if err = store.Set("archive.automatic", true); err != nil {
		t.Errorf("Set(archive.automatic, true) error = %v", err)
	}
}

func TestPreferenceStoreAcceptsAfterReadNavigationPreference(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"stay", "next_visible", "next_unread", "none"} {
		if err = store.Set("inbox.after_read", value); err != nil {
			t.Errorf("Set(inbox.after_read, %q) error = %v", value, err)
		}
	}
}

func TestPreferenceStoreValidatesScheduleDefaultDelays(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schedule.default_send_minutes", "schedule.default_reminder_minutes"} {
		for _, value := range []string{"1", "5", "60", "10080"} {
			if err = store.Set(key, value); err != nil {
				t.Errorf("Set(%s, %q) error = %v", key, value, err)
			}
		}
		for _, value := range []any{"0", "10081", "5,15", 5} {
			if err = store.Set(key, value); err == nil {
				t.Errorf("Set(%s, %v) unexpectedly succeeded", key, value)
			}
		}
	}
}

func TestPreferenceStoreAcceptsPointerCursorSetting(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Set("appearance.pointer_cursor", false); err != nil {
		t.Fatalf("Set(appearance.pointer_cursor, false) error = %v", err)
	}
}

func TestPreferenceStoreAcceptsAppZoom(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Set("appearance.zoom", "110"); err != nil {
		t.Fatalf("Set(appearance.zoom, 110) error = %v", err)
	}
}

func TestPreferenceStoreAcceptsAudioInputDevice(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Set("audio.input_device", "microphone-device-id"); err != nil {
		t.Fatalf("Set(audio.input_device) error = %v", err)
	}
}
