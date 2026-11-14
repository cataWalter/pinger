package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPreferenceStoreAcceptsNotificationAndReactionSettings(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	valid := []struct {
		key   string
		value any
	}{
		{key: "notifications.direct", value: true},
		{key: "notifications.mentions", value: false},
		{key: "notifications.group", value: true},
		{key: "notifications.otp_immediate", value: true},
		{key: "notifications.otp_copy", value: false},
		{key: "notifications.sound_direct", value: "Pulse"},
		{key: "notifications.sound_mention", value: "Silent"},
		{key: "notifications.sound_group", value: "Soft"},
		{key: "notifications.batch_seconds", value: "10"},
		{key: "notifications.repeat_minutes", value: "15"},
		{key: "sidebar.transparent", value: true},
		{key: "sidebar.network_icons", value: true},
		{key: "sidebar.pinned_style", value: "Star only"},
		{key: "reactions.quick_enabled", value: false},
		{key: "reactions.quick_source", value: "Custom"},
		{key: "reactions.custom_emojis", value: "\U0001F44D \U0001F389"},
		{key: "reactions.default_emoji", value: "\U0001F44D"},
		{key: "messages.double_click", value: "Reply"},
		{key: "window.start_minimized", value: true},
		{key: "window.quit_on_close", value: true},
		{key: "sounds.effects", value: "Sent messages"},
	}
	for _, item := range valid {
		if err = store.Set(item.key, item.value); err != nil {
			t.Errorf("Set(%s, %v) error = %v", item.key, item.value, err)
		}
	}
}

func TestPreferenceStoreRejectsInvalidNotificationAndReactionSettings(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	invalid := []struct {
		key   string
		value any
	}{
		{key: "notifications.batch_seconds", value: "7"},
		{key: "notifications.batch_seconds", value: 3},
		{key: "notifications.repeat_minutes", value: "1"},
		{key: "notifications.sound_direct", value: "Loud"},
		{key: "sidebar.pinned_style", value: "Bottom"},
		{key: "reactions.quick_source", value: "Random"},
		{key: "reactions.custom_emojis", value: ""},
		{key: "reactions.custom_emojis", value: "a b c d e f g"},
		{key: "reactions.default_emoji", value: ""},
		{key: "reactions.default_emoji", value: "a b"},
		{key: "messages.double_click", value: "Edit"},
		{key: "sounds.effects", value: "Always"},
	}
	for _, item := range invalid {
		if err = store.Set(item.key, item.value); err == nil {
			t.Errorf("Set(%s, %v) unexpectedly succeeded", item.key, item.value)
		}
	}
}

func TestPreferenceStoreRejectsInvalidWrites(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		key   string
		value any
	}{
		{key: "appearance.theme", value: "Neon"},
		{key: "appearance.zoom", value: "130"},
		{key: "appearance.compact", value: "yes"},
		{key: "room.favorite.", value: true},
		{key: "room.muted.!room:example.org", value: "yes"},
		{key: "history.initial_messages", value: "12"},
		{key: "schedule.suggestions_minutes", value: "5,5"},
		{key: "archive.next_room", value: "random"},
		{key: "archive.older_than_days", value: "3651"},
		{key: "inbox.after_read", value: "random"},
		{key: "unknown.key", value: true},
	}
	for _, test := range tests {
		t.Run(test.key, func(t *testing.T) {
			if err := store.Set(test.key, test.value); err == nil {
				t.Fatalf("Set(%q, %#v) succeeded", test.key, test.value)
			}
		})
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(store.path), filepath.Base(store.path))); !os.IsNotExist(err) {
		t.Fatalf("invalid writes created a preferences file, stat error = %v", err)
	}
}

func TestNewPreferenceStoreRejectsCorruptData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPreferenceStore(path); err == nil {
		t.Fatal("NewPreferenceStore() accepted corrupt JSON")
	}
}
