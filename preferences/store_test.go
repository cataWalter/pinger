package preferences

import (
	"encoding/json"
	"os"
	"path/filepath"
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
