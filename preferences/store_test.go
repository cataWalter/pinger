package preferences

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateHideImagesAndVideosPreference(t *testing.T) {
	const key = "appearance.hide_images_and_videos"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean value")
	}
}

func TestValidateIncognitoPreference(t *testing.T) {
	const key = "privacy.incognito"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean Incognito preference")
	}
}

func TestValidateBusyModePreference(t *testing.T) {
	const key = "busy_mode.enabled"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean busy-mode preference")
	}
}

func TestValidateMessageBookmarkPreference(t *testing.T) {
	const key = "message.bookmark.%21room%3Aexample.org.%24event%3Aexample.org"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate("message.bookmark.", true); err == nil {
		t.Fatal("Validate() accepted a bookmark preference without a message ID")
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean bookmark preference")
	}
}

func TestValidateLocalAIChatFavoritePreference(t *testing.T) {
	const key = "ai.local_chat.favorite.chat-1"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate("ai.local_chat.favorite.", true); err == nil {
		t.Fatal("Validate() accepted a local AI favorite without a chat ID")
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean local AI favorite")
	}
}

func TestValidateAppearanceThemePreference(t *testing.T) {
	validThemes := []string{"System default", "Light", "Dark", "VS Code", "OLED black", "Bosco", "Rosa", "Dracula", "Midnight", "Slate", "Solarized", "Sepia"}
	for _, theme := range validThemes {
		if err := Validate("appearance.theme", theme); err != nil {
			t.Errorf("Validate(appearance.theme, %q) error = %v", theme, err)
		}
	}
	if err := Validate("appearance.theme", "Unknown theme"); err == nil {
		t.Fatal("Validate() accepted an unsupported theme")
	}
}

func TestValidateAITranscriptionModelPreference(t *testing.T) {
	if err := Validate("ai.transcription_model", "whisper-1"); err != nil {
		t.Fatalf("Validate(ai.transcription_model) error = %v", err)
	}
	if err := Validate("ai.transcription_model", true); err == nil {
		t.Fatal("Validate() accepted a non-string transcription model")
	}
}

func TestValidateTutorLanguagePreferences(t *testing.T) {
	for _, key := range []string{"ai.tutor_language", "ai.tutor_explanation_language"} {
		for _, value := range []string{"", "es", "tr"} {
			if err := Validate(key, value); err != nil {
				t.Errorf("Validate(%q, %q) error = %v", key, value, err)
			}
		}
		if err := Validate(key, "xx"); err == nil {
			t.Errorf("Validate(%q) accepted an unsupported tutor language", key)
		}
		if err := Validate(key, true); err == nil {
			t.Errorf("Validate(%q) accepted a non-string tutor language", key)
		}
	}
}

func TestValidateAIFeaturePreferences(t *testing.T) {
	for _, key := range []string{
		"ai.feature.agent.prompt",
		"ai.feature.tone_guard.temperature",
		"ai.feature.chat_translation.max_tokens",
		"ai.feature.turkish_tutor.prompt",
	} {
		if err := Validate(key, ""); err != nil {
			t.Errorf("Validate(%q, blank) error = %v", key, err)
		}
	}
	if err := Validate("ai.feature.tone_guard.temperature", "0.6"); err != nil {
		t.Fatalf("Validate(tone_guard.temperature, 0.6) error = %v", err)
	}
	if err := Validate("ai.feature.tone_guard.temperature", "0.5"); err == nil {
		t.Fatal("Validate() accepted an AI temperature below 0.6")
	}
	if err := Validate("ai.feature.summarize.max_tokens", "512"); err != nil {
		t.Fatalf("Validate(summarize.max_tokens, 512) error = %v", err)
	}
	if err := Validate("ai.feature.agent.prompt", strings.Repeat("a", 8001)); err == nil {
		t.Fatal("Validate() accepted an AI prompt longer than 8000 characters")
	}
	if err := Validate("ai.feature.tone_guard.temperature", "2.5"); err == nil {
		t.Fatal("Validate() accepted an out-of-range AI temperature")
	}
	if err := Validate("ai.feature.summarize.max_tokens", "9000"); err == nil {
		t.Fatal("Validate() accepted an AI token limit above 8192")
	}
	if err := Validate("ai.feature.unknown_feature.prompt", "text"); err == nil {
		t.Fatal("Validate() accepted an unknown AI feature")
	}
	if err := Validate("ai.feature.agent.temperature", 0.5); err == nil {
		t.Fatal("Validate() accepted a non-string AI temperature")
	}
}

func TestValidateGhostwriterPreferences(t *testing.T) {
	for _, endpoint := range []string{"", "http://localhost:11434", "http://127.0.0.1:8080", "http://[::1]:8080"} {
		if err := Validate("ghostwriter.endpoint", endpoint); err != nil {
			t.Errorf("Validate(ghostwriter.endpoint, %q) error = %v", endpoint, err)
		}
	}
	for _, endpoint := range []string{"https://localhost:11434", "http://example.com:11434", "http://localhost:11434/v1"} {
		if err := Validate("ghostwriter.endpoint", endpoint); err == nil {
			t.Errorf("Validate(ghostwriter.endpoint, %q) accepted a non-local URL", endpoint)
		}
	}
	if err := Validate("ghostwriter.enabled", true); err != nil {
		t.Fatalf("Validate(ghostwriter.enabled) error = %v", err)
	}
	for _, provider := range []string{"ollama", "openai-compatible"} {
		if err := Validate("ghostwriter.provider", provider); err != nil {
			t.Errorf("Validate(ghostwriter.provider, %q) error = %v", provider, err)
		}
	}
	if err := Validate("ghostwriter.provider", "remote"); err == nil {
		t.Fatal("Validate(ghostwriter.provider) accepted an unsupported provider")
	}
	if err := Validate("ghostwriter.model", strings.Repeat("x", 161)); err == nil {
		t.Fatal("Validate(ghostwriter.model) accepted an overlong model name")
	}
}

func TestValidateRelationshipHealthPreference(t *testing.T) {
	if err := Validate("relationship_health.enabled", true); err != nil {
		t.Fatalf("Validate(relationship_health.enabled) error = %v", err)
	}
	if err := Validate("relationship_health.enabled", "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean relationship-health preference")
	}
}

func TestValidateEmoticonReplacements(t *testing.T) {
	const key = "emoji.emoticon_replacements"
	if err := Validate(key, `[[":)","😎"],[":shrug:","🤷"]]`); err != nil {
		t.Fatalf("Validate(valid emoticon replacements) error = %v", err)
	}
	for _, value := range []any{
		true,
		"{",
		`[[":)"]]`,
		`[[" :) ","🙂"]]`,
		`[[":)","🙂"],[":)","🙁"]]`,
		`[[":)","🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂"]]`,
	} {
		if err := Validate(key, value); err == nil {
			t.Errorf("Validate(%s, %#v) unexpectedly succeeded", key, value)
		}
	}
}

func TestValidateLocalAIAgents(t *testing.T) {
	const key = "ai.local_agents"
	if err := Validate(key, `{"agents":[{"id":"tutor","name":"Tutor","instructions":"Teach gently."}],"defaultAgentId":"tutor"}`); err != nil {
		t.Fatalf("Validate(valid local agents) error = %v", err)
	}
	if err := Validate(key, `{"agents":[],"defaultAgentId":""}`); err != nil {
		t.Fatalf("Validate(empty local agents) error = %v", err)
	}
	for name, value := range map[string]any{
		"wrong type":         true,
		"malformed JSON":     "{",
		"missing default":    `{"agents":[]}`,
		"unknown default":    `{"agents":[{"id":"tutor","name":"Tutor","instructions":"Teach."}],"defaultAgentId":"missing"}`,
		"blank instructions": `{"agents":[{"id":"tutor","name":"Tutor","instructions":" "}],"defaultAgentId":""}`,
	} {
		if err := Validate(key, value); err == nil {
			t.Errorf("%s: Validate(%s) unexpectedly succeeded", name, key)
		}
	}
}

func TestValidateRoomAIAgents(t *testing.T) {
	key := "room.ai_agents.!room:example.org"
	validAgent := struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Instructions string `json:"instructions"`
	}{ID: "tutor", Name: "Language tutor", Instructions: "Teach Spanish with gentle corrections."}
	valid := struct {
		Agents         []any  `json:"agents"`
		DefaultAgentID string `json:"defaultAgentId"`
	}{Agents: []any{validAgent}, DefaultAgentID: "tutor"}
	validJSON, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	if err := Validate(key, string(validJSON)); err != nil {
		t.Fatalf("Validate(valid agents) error = %v", err)
	}

	tooMany := valid
	tooMany.Agents = make([]any, 9)
	for index := range tooMany.Agents {
		tooMany.Agents[index] = validAgent
	}
	tooManyJSON, err := json.Marshal(tooMany)
	if err != nil {
		t.Fatal(err)
	}
	unknownDefault, err := json.Marshal(struct {
		Agents         []any  `json:"agents"`
		DefaultAgentID string `json:"defaultAgentId"`
	}{Agents: []any{validAgent}, DefaultAgentID: "missing"})
	if err != nil {
		t.Fatal(err)
	}
	invalidCases := []struct {
		name  string
		key   string
		value any
	}{
		{name: "missing room", key: "room.ai_agents.", value: string(validJSON)},
		{name: "wrong type", key: key, value: true},
		{name: "malformed JSON", key: key, value: "{"},
		{name: "too many profiles", key: key, value: string(tooManyJSON)},
		{name: "unknown default", key: key, value: string(unknownDefault)},
		{name: "missing instructions", key: key, value: `{"agents":[{"id":"tutor","name":"Tutor","instructions":" "}],"defaultAgentId":""}`},
	}
	for _, test := range invalidCases {
		t.Run(test.name, func(t *testing.T) {
			if err := Validate(test.key, test.value); err == nil {
				t.Fatal("Validate() unexpectedly succeeded")
			}
		})
	}
}

func TestStorePersistsAndScopesValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.db")
	store, err := open(path, 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetGlobal("appearance.compact", true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAccount("account-a", "room.favorite.!room:example.org", true); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot("account-a")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot["appearance.compact"] != true || snapshot["room.favorite.!room:example.org"] != true {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	other, err := store.Snapshot("account-b")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := other["room.favorite.!room:example.org"]; ok {
		t.Fatalf("account-specific preference leaked: %#v", other)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := open(path, 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	value, err := reopened.Snapshot("account-a")
	if err != nil {
		t.Fatal(err)
	}
	if value["room.favorite.!room:example.org"] != true {
		t.Fatalf("reopened snapshot = %#v", value)
	}
}

func TestStorePublishesChanges(t *testing.T) {
	store, err := open(filepath.Join(t.TempDir(), "preferences.db"), 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	changes, unsubscribe := store.Subscribe(1)
	defer unsubscribe()
	if err := store.SetGlobal("notifications.enabled", false); err != nil {
		t.Fatal(err)
	}
	select {
	case change := <-changes:
		if change.Revision == 0 {
			t.Fatal("change revision was not recorded")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for preference change")
	}
}

func TestStoreSkipsUnchangedValue(t *testing.T) {
	store, err := open(filepath.Join(t.TempDir(), "preferences.db"), 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	changes, unsubscribe := store.Subscribe(2)
	defer unsubscribe()
	if err := store.SetGlobal("notifications.enabled", false); err != nil {
		t.Fatal(err)
	}
	firstChange := <-changes

	if err := store.SetGlobal("notifications.enabled", false); err != nil {
		t.Fatal(err)
	}
	revision, err := store.revision()
	if err != nil {
		t.Fatal(err)
	}
	if revision != firstChange.Revision {
		t.Fatalf("revision after unchanged value = %d, want %d", revision, firstChange.Revision)
	}
	select {
	case change := <-changes:
		t.Fatalf("unchanged value published a new revision: %d", change.Revision)
	default:
	}
}

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

func TestValidateRoomGhostwriterPreference(t *testing.T) {
	if err := Validate("room.ghostwriter.!room:example.org", true); err != nil {
		t.Fatalf("Validate(room Ghostwriter) error = %v", err)
	}
	if err := Validate("room.ghostwriter.!room:example.org", false); err != nil {
		t.Fatalf("Validate(disabled room Ghostwriter) error = %v", err)
	}
	if err := Validate("room.ghostwriter.!room:example.org", "true"); err == nil {
		t.Fatal("Validate(room Ghostwriter) accepted a non-boolean value")
	}
	if err := Validate("room.ghostwriter.", true); err == nil {
		t.Fatal("Validate(room Ghostwriter) accepted a missing room ID")
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
