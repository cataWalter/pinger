package desktop

import (
	"slices"
	"testing"
)

func TestTutorLanguagesFromPreferences(t *testing.T) {
	tests := []struct {
		name        string
		preferences map[string]any
		learning    string
		defaultCode string
		known       []string
	}{
		{name: "empty preferences use English and Turkish", preferences: map[string]any{}, learning: "tr", defaultCode: "en", known: []string{"en"}},
		{name: "learning language equal to default falls back", preferences: map[string]any{"ai.default_language": "it", "ai.tutor_language": "it", "ai.known_languages": `["it","tr"]`}, learning: "tr", defaultCode: "it", known: []string{"it", "tr"}},
		{name: "Turkish default falls back to Spanish", preferences: map[string]any{"ai.default_language": "tr", "ai.tutor_language": ""}, learning: "es", defaultCode: "tr", known: []string{"tr"}},
		{name: "unsupported learning language falls back and unknown codes are dropped", preferences: map[string]any{"ai.default_language": "en", "ai.tutor_language": "zz", "ai.known_languages": `["de","zz","de"]`}, learning: "tr", defaultCode: "en", known: []string{"de", "en"}},
		{name: "invalid known list keeps the default only", preferences: map[string]any{"ai.default_language": "en", "ai.tutor_language": "de", "ai.known_languages": `not json`}, learning: "de", defaultCode: "en", known: []string{"en"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			languages := tutorLanguagesFromPreferences(test.preferences)
			if languages.Learning != test.learning || languages.Default != test.defaultCode || !slices.Equal(languages.Known, test.known) {
				t.Fatalf("tutorLanguagesFromPreferences() = %+v, want learning %q, default %q, known %v", languages, test.learning, test.defaultCode, test.known)
			}
		})
	}
}

func TestDetectedLanguageCode(t *testing.T) {
	tests := map[string]struct {
		code string
		ok   bool
	}{
		"Turkish": {code: "tr", ok: true},
		"IT":      {code: "it", ok: true},
		"ja":      {code: "ja", ok: true},
		"123":     {ok: false},
		"pt-BR":   {code: "pt-br", ok: true},
		"":        {ok: false},
	}
	for input, want := range tests {
		code, ok := detectedLanguageCode(input)
		if code != want.code || ok != want.ok {
			t.Errorf("detectedLanguageCode(%q) = (%q, %v), want (%q, %v)", input, code, ok, want.code, want.ok)
		}
	}
}
