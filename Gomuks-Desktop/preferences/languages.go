package preferences

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// languageCatalogJSON is the built-in language catalog. frontend/src/aiSettings.ts imports the same file.
//
//go:embed languages.json
var languageCatalogJSON []byte

const (
	// MaxCustomLanguages caps ai.custom_languages.
	MaxCustomLanguages = 8
	// MaxCustomLanguageNameLength caps the name of a custom language, in characters.
	MaxCustomLanguageNameLength = 40
)

// customLanguageCodePattern accepts basic BCP-47 tags such as "pt-BR" or "sr-Latn".
var customLanguageCodePattern = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$`)

// LanguageEntry is one language in the built-in catalog or in ai.custom_languages.
type LanguageEntry struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// LanguageLookup maps language codes to English names for built-in and custom languages.
type LanguageLookup map[string]string

// builtinLanguages is the built-in catalog keyed by code.
var builtinLanguages = loadLanguageCatalog()

func loadLanguageCatalog() LanguageLookup {
	var entries []LanguageEntry
	if err := json.Unmarshal(languageCatalogJSON, &entries); err != nil {
		panic(fmt.Sprintf("language catalog is invalid: %v", err))
	}
	lookup := make(LanguageLookup, len(entries))
	for _, entry := range entries {
		if entry.Code == "" || entry.Name == "" {
			panic("language catalog entries need a code and a name")
		}
		if _, duplicate := lookup[entry.Code]; duplicate {
			panic(fmt.Sprintf("language catalog repeats %q", entry.Code))
		}
		lookup[entry.Code] = entry.Name
	}
	return lookup
}

// TutorLanguageName returns the English name for a built-in language code.
func TutorLanguageName(code string) (string, bool) {
	name, ok := builtinLanguages[code]
	return name, ok
}

// TutorLanguageCode returns the built-in code for an English language name such as "Turkish", ignoring case.
func TutorLanguageCode(name string) (string, bool) {
	name = strings.TrimSpace(name)
	for code, language := range builtinLanguages {
		if strings.EqualFold(language, name) {
			return code, true
		}
	}
	return "", false
}

// LanguageLookupFor returns the built-in languages plus the custom languages in serializedCustom.
// An invalid list is ignored here; writes are rejected by validateCustomLanguages.
func LanguageLookupFor(serializedCustom string) LanguageLookup {
	lookup := make(LanguageLookup, len(builtinLanguages)+MaxCustomLanguages)
	for code, name := range builtinLanguages {
		lookup[code] = name
	}
	entries, err := parseCustomLanguages(serializedCustom)
	if err != nil {
		return lookup
	}
	for _, entry := range entries {
		lookup[entry.Code] = entry.Name
	}
	return lookup
}

// LanguageLookupFromPreferences returns the built-in and custom languages for a preference snapshot.
func LanguageLookupFromPreferences(values map[string]any) LanguageLookup {
	serialized, _ := values["ai.custom_languages"].(string)
	return LanguageLookupFor(serialized)
}

// parseCustomLanguages decodes ai.custom_languages and checks each entry. An empty value means no custom languages.
func parseCustomLanguages(serialized string) ([]LanguageEntry, error) {
	if strings.TrimSpace(serialized) == "" {
		return nil, nil
	}
	var entries []LanguageEntry
	if err := json.Unmarshal([]byte(serialized), &entries); err != nil {
		return nil, errors.New("AI custom languages must be a JSON array of {code, name} objects")
	}
	if len(entries) > MaxCustomLanguages {
		return nil, fmt.Errorf("AI custom languages must contain at most %d languages", MaxCustomLanguages)
	}
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if !customLanguageCodePattern.MatchString(entry.Code) {
			return nil, errors.New("AI custom language codes must be basic BCP-47 tags such as pt-BR")
		}
		if _, builtin := builtinLanguages[entry.Code]; builtin {
			return nil, errors.New("AI custom languages must not repeat a built-in language")
		}
		folded := strings.ToLower(entry.Code)
		if seen[folded] {
			return nil, errors.New("AI custom languages must not repeat a code")
		}
		seen[folded] = true
		if entry.Name == "" || entry.Name != strings.TrimSpace(entry.Name) {
			return nil, errors.New("AI custom language names must be non-empty and trimmed")
		}
		if utf8.RuneCountInString(entry.Name) > MaxCustomLanguageNameLength {
			return nil, fmt.Errorf("AI custom language names must be at most %d characters", MaxCustomLanguageNameLength)
		}
		if strings.IndexFunc(entry.Name, unicode.IsControl) >= 0 {
			return nil, errors.New("AI custom language names must not contain control characters")
		}
	}
	return entries, nil
}

// validateCustomLanguages checks ai.custom_languages, a JSON string holding an array of {code, name} objects.
func validateCustomLanguages(value any) error {
	serialized, ok := value.(string)
	if !ok {
		return errors.New("AI custom languages must be a JSON string")
	}
	_, err := parseCustomLanguages(serialized)
	return err
}
