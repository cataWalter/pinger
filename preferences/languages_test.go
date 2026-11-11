package preferences

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func openLanguageTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := open(filepath.Join(t.TempDir(), "preferences.db"), 5*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func customLanguagesJSON(t *testing.T, entries ...LanguageEntry) string {
	t.Helper()
	raw, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestLanguageCatalogMatchesSupportedCodes(t *testing.T) {
	want := []string{"ar", "de", "el", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv", "tr", "zh"}
	var entries []LanguageEntry
	if err := json.Unmarshal(languageCatalogJSON, &entries); err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(entries))
	for _, entry := range entries {
		got = append(got, entry.Code)
	}
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Fatalf("catalog codes = %v, want %v", got, want)
	}
}

func TestValidateCustomLanguagesRules(t *testing.T) {
	nine := make([]LanguageEntry, 0, MaxCustomLanguages+1)
	for i := range MaxCustomLanguages + 1 {
		nine = append(nine, LanguageEntry{Code: fmt.Sprintf("qa-%d", i), Name: fmt.Sprintf("Custom %d", i)})
	}
	valid := []string{
		``,
		`[]`,
		customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: "Brazilian Portuguese"}),
		customLanguagesJSON(t, LanguageEntry{Code: "sr-Latn", Name: "Serbian (Latin)"}),
	}
	for _, value := range valid {
		if err := validateCustomLanguages(value); err != nil {
			t.Errorf("validateCustomLanguages(%q) error = %v", value, err)
		}
	}

	invalid := map[string]string{
		"not json":       `not json`,
		"object":         `{"code":"pt-BR","name":"Brazilian Portuguese"}`,
		"bad code":       customLanguagesJSON(t, LanguageEntry{Code: "x", Name: "Short"}),
		"uppercase code": customLanguagesJSON(t, LanguageEntry{Code: "PT-BR", Name: "Brazilian Portuguese"}),
		"built-in code":  customLanguagesJSON(t, LanguageEntry{Code: "tr", Name: "Turkish again"}),
		"duplicate code": customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: "Brazilian"}, LanguageEntry{Code: "pt-br", Name: "Brazil"}),
		"empty name":     customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: ""}),
		"untrimmed name": customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: " Brazilian "}),
		"long name":      customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: strings.Repeat("n", MaxCustomLanguageNameLength+1)}),
		"control char":   customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: "Bad\x07name"}),
		"too many":       customLanguagesJSON(t, nine...),
	}
	for name, value := range invalid {
		t.Run(name, func(t *testing.T) {
			if err := validateCustomLanguages(value); err == nil {
				t.Fatalf("validateCustomLanguages(%q) accepted invalid custom languages", value)
			}
		})
	}

	if err := validateCustomLanguages([]string{"pt-BR"}); err == nil {
		t.Fatal("validateCustomLanguages() accepted a non-string value")
	}
}

func TestSetManyIsAllOrNothing(t *testing.T) {
	store := openLanguageTestStore(t)
	if err := store.SetMany("acct", map[string]any{
		"ai.default_language": "en",
		"ai.tutor_language":   "tr",
		"ai.known_languages":  `["en","tr"]`,
	}); err != nil {
		t.Fatal(err)
	}

	err := store.SetMany("acct", map[string]any{
		"ai.default_language": "de",
		"ai.tutor_language":   "xx",
	})
	if err == nil {
		t.Fatal("SetMany() accepted an invalid language in the batch")
	}
	snapshot, err := store.Snapshot("acct")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot["ai.default_language"] != "en" || snapshot["ai.tutor_language"] != "tr" {
		t.Fatalf("failed batch changed preferences: %#v", snapshot)
	}
}

func TestLearningLanguageMustDifferFromDefault(t *testing.T) {
	store := openLanguageTestStore(t)
	if err := store.Set(GlobalScope, "", "ai.tutor_language", "tr"); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(GlobalScope, "", "ai.default_language", "tr"); err == nil {
		t.Fatal("Set() accepted a default language equal to the learning language")
	}
	if err := store.SetMany("acct", map[string]any{
		"ai.default_language": "es",
		"ai.tutor_language":   "es",
	}); err == nil {
		t.Fatal("SetMany() accepted matching learning and default languages")
	}
	if err := store.Set(GlobalScope, "", "ai.tutor_language", "en"); err == nil {
		t.Fatal("Set() accepted a learning language equal to the implicit English default")
	}
}

func TestCustomLanguageRemovalRejectedWhileInUse(t *testing.T) {
	store := openLanguageTestStore(t)
	custom := customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: "Brazilian Portuguese"})
	if err := store.SetMany("acct", map[string]any{
		"ai.custom_languages": custom,
		"ai.tutor_language":   "pt-BR",
	}); err != nil {
		t.Fatalf("SetMany() adding a custom learning language error = %v", err)
	}

	if err := store.SetMany("acct", map[string]any{"ai.custom_languages": "[]"}); err == nil {
		t.Fatal("removed a custom language that is still the learning language")
	}
	if err := store.SetMany("acct", map[string]any{
		"ai.custom_languages": "[]",
		"ai.tutor_language":   "tr",
	}); err != nil {
		t.Fatalf("SetMany() removing a custom language with a new learning language error = %v", err)
	}

	if err := store.SetMany("acct", map[string]any{
		"ai.custom_languages": customLanguagesJSON(t, LanguageEntry{Code: "pt-BR", Name: "Brazilian Portuguese"}),
		"ai.known_languages":  `["en","pt-BR"]`,
	}); err != nil {
		t.Fatalf("SetMany() adding a custom known language error = %v", err)
	}
	if err := store.SetMany("acct", map[string]any{"ai.custom_languages": "[]"}); err == nil {
		t.Fatal("removed a custom language that is still a known language")
	}
	if err := store.SetMany("acct", map[string]any{
		"ai.custom_languages": "[]",
		"ai.known_languages":  `["en"]`,
	}); err != nil {
		t.Fatalf("SetMany() removing a custom language and its known entry error = %v", err)
	}
}

func TestRoomTutorLanguageAllowsOnlyChatLanguages(t *testing.T) {
	store := openLanguageTestStore(t)
	if err := store.SetMany("", map[string]any{
		"ai.default_language": "en",
		"ai.tutor_language":   "tr",
		"ai.known_languages":  `["en","it"]`,
	}); err != nil {
		t.Fatal(err)
	}

	const roomKey = "room.tutor_language.!room:example.org"
	for _, value := range []string{"", "en", "tr", "it"} {
		if err := store.Set(AccountScope, "acct", roomKey, value); err != nil {
			t.Errorf("Set(%q) error = %v", value, err)
		}
	}
	for _, value := range []string{"de", "xx"} {
		if err := store.Set(AccountScope, "acct", roomKey, value); err == nil {
			t.Errorf("Set(%q) accepted a language outside the chat's allowed set", value)
		}
	}
	if err := store.Set(AccountScope, "acct", "room.tutor_language.", "en"); err == nil {
		t.Error("Set() accepted a room tutor language without a room ID")
	}
	if err := store.Set(AccountScope, "acct", roomKey, true); err == nil {
		t.Error("Set() accepted a non-string room tutor language")
	}
}
