package preferences

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

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

func TestDeleteRetiredRemovesRemovedFeatureKeys(t *testing.T) {
	store, err := open(filepath.Join(t.TempDir(), "preferences.db"), 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const accountID = "0123456789abcdef0123456789abcdef"
	rows := []struct {
		scope     Scope
		accountID string
		key       string
		value     string
	}{
		{GlobalScope, "", "busy_mode.enabled", "true"},
		{GlobalScope, "", "ghostwriter.endpoint", `"http://localhost:11434"`},
		{GlobalScope, "", "relationship_health.enabled", "true"},
		{GlobalScope, "", "ai.feature.contact_dossier.temperature", "0.7"},
		{AccountScope, accountID, "room.ghostwriter.!room:example.org", "true"},
		{GlobalScope, "", "ai.endpoint", `"http://localhost:11434"`},
		{GlobalScope, "", "notifications.enabled", "false"},
		{AccountScope, accountID, "room.favorite.!room:example.org", "true"},
	}
	for _, row := range rows {
		if _, err := store.db.Exec("INSERT INTO preferences (scope, account_id, key, value_json, updated_at, revision) VALUES (?, ?, ?, ?, 0, 0)", row.scope, row.accountID, row.key, []byte(row.value)); err != nil {
			t.Fatal(err)
		}
	}
	deleted, err := store.DeleteRetired()
	if err != nil {
		t.Fatalf("DeleteRetired() error = %v", err)
	}
	if deleted != 5 {
		t.Fatalf("DeleteRetired() deleted %d rows, want 5", deleted)
	}
	global, err := store.All(GlobalScope, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := global["ai.endpoint"]; !ok {
		t.Fatal("DeleteRetired() removed ai.endpoint")
	}
	if _, ok := global["notifications.enabled"]; !ok {
		t.Fatal("DeleteRetired() removed notifications.enabled")
	}
	if len(global) != 2 {
		t.Fatalf("global preferences = %v, want only the two kept keys", global)
	}
	account, err := store.All(AccountScope, accountID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := account["room.favorite.!room:example.org"]; !ok || len(account) != 1 {
		t.Fatalf("account preferences = %v, want only the favorite room key", account)
	}
	again, err := store.DeleteRetired()
	if err != nil {
		t.Fatalf("second DeleteRetired() error = %v", err)
	}
	if again != 0 {
		t.Fatalf("second DeleteRetired() deleted %d rows, want 0", again)
	}
}

func TestDeleteAccountsExceptKeepsOnlySurvivorPreferences(t *testing.T) {
	store, err := open(filepath.Join(t.TempDir(), "preferences.db"), 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const keepID = "0123456789abcdef0123456789abcdef"
	const otherID = "fedcba9876543210fedcba9876543210"
	rows := []struct {
		scope     Scope
		accountID string
		key       string
	}{
		{GlobalScope, "", "notifications.enabled"},
		{AccountScope, keepID, "room.favorite.!keep:example.org"},
		{AccountScope, otherID, "room.favorite.!other:example.org"},
		{AccountScope, "primary", "room.favorite.!primary:example.org"},
	}
	for _, row := range rows {
		if _, err := store.db.Exec("INSERT INTO preferences (scope, account_id, key, value_json, updated_at, revision) VALUES (?, ?, ?, ?, 0, 0)", row.scope, row.accountID, row.key, []byte("true")); err != nil {
			t.Fatal(err)
		}
	}
	deleted, err := store.DeleteAccountsExcept(keepID)
	if err != nil {
		t.Fatalf("DeleteAccountsExcept() error = %v", err)
	}
	if deleted != 2 {
		t.Fatalf("DeleteAccountsExcept() deleted %d rows, want 2", deleted)
	}
	kept, err := store.All(AccountScope, keepID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := kept["room.favorite.!keep:example.org"]; !ok || len(kept) != 1 {
		t.Fatalf("survivor preferences = %v, want only its favorite room key", kept)
	}
	global, err := store.All(GlobalScope, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := global["notifications.enabled"]; !ok {
		t.Fatal("DeleteAccountsExcept() removed a global preference")
	}
	again, err := store.DeleteAccountsExcept(keepID)
	if err != nil {
		t.Fatalf("second DeleteAccountsExcept() error = %v", err)
	}
	if again != 0 {
		t.Fatalf("second DeleteAccountsExcept() deleted %d rows, want 0", again)
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
