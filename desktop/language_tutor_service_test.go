package desktop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func testLanguageTutorLanguages() tutorLanguages {
	return tutorLanguages{Learning: "tr", Default: "it", Known: []string{"it", "tr", "en"}}
}

func testLanguageTutorTuning() aiFeatureTuning {
	return aiFeatureTuning{Prompt: languageTutorSystemPrompt, Temperature: languageTutorTemperature, MaxTokens: languageTutorMaxTokens}
}

func mustLanguageTutorRequest(t *testing.T, text, mode, explanation string) languageTutorRequest {
	t.Helper()
	request, err := newLanguageTutorRequest(text, mode, explanation, testLanguageTutorLanguages())
	if err != nil {
		t.Fatalf("newLanguageTutorRequest() error = %v", err)
	}
	return request
}

func chatCompletionResponse(content string) map[string]any {
	return map[string]any{"choices": []any{
		map[string]any{"message": map[string]string{"content": content}},
	}}
}

func TestAnalyzeLanguageTutorUsesLocalStructuredRequest(t *testing.T) {
	input := "Ben okula gidiyorum"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.URL.Path)
		}
		var request struct {
			Model       string      `json:"model"`
			Messages    []AIMessage `json:"messages"`
			Stream      bool        `json:"stream"`
			Temperature float64     `json:"temperature"`
			MaxTokens   int         `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Model != "tutor-model" || request.Stream || request.Temperature != languageTutorTemperature || request.MaxTokens != languageTutorMaxTokens || len(request.Messages) != 2 {
			t.Errorf("unexpected AI request: %+v", request)
		}
		if !strings.Contains(request.Messages[0].Content, "Word-by-word analysis") || !strings.Contains(request.Messages[0].Content, "NEVER suggest") {
			t.Errorf("system prompt omitted tutor rules: %q", request.Messages[0].Content)
		}
		if !strings.Contains(request.Messages[1].Content, "Explanation language: Italian (it)") {
			t.Errorf("user prompt omitted the explanation language: %q", request.Messages[1].Content)
		}
		if !strings.Contains(request.Messages[1].Content, `"Ben okula gidiyorum"`) {
			t.Errorf("user prompt did not safely quote input: %q", request.Messages[1].Content)
		}
		content := "```json\n" + `{"detected_language":"tr","corrected_text":"Ben okula gidiyorum.","translation":"Vado a scuola.","has_grammar_errors":false,"phrases":[{"text":"Ben okula gidiyorum.","meaning":"I go to school.","words":[{"word":"okula","breakdown":"okul-a -> scuola-verso","meaning":"to school"}]}],"grammar_rule":"Turkish uses SOV order.","text_to_insert":""}` + "\n```"
		if err := json.NewEncoder(w).Encode(chatCompletionResponse(content)); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	request := mustLanguageTutorRequest(t, input, languageTutorModeMessage, "it")
	analysis, err := analyzeLanguageTutor(context.Background(), server.Client(), server.URL, "tutor-model", testLanguageTutorTuning(), request, nil)
	if err != nil {
		t.Fatalf("analyzeLanguageTutor() error = %v", err)
	}
	if analysis.DetectedLanguage != "tr" || analysis.TargetLanguage != "tr" || analysis.ExplanationLanguage != "it" || analysis.OriginalText != input || analysis.Translation != "Vado a scuola." {
		t.Fatalf("unexpected analysis: %+v", analysis)
	}
	if analysis.TextToInsert != "" {
		t.Fatalf("incoming message produced text to insert: %q", analysis.TextToInsert)
	}
	if len(analysis.Phrases) != 1 || len(analysis.Phrases[0].Words) != 1 || analysis.Phrases[0].Words[0].Word != "okula" {
		t.Fatalf("phrases = %+v", analysis.Phrases)
	}
}

func TestAnalyzeLanguageTutorRejectsEmptyAndRemoteInput(t *testing.T) {
	if _, err := newLanguageTutorRequest("  ", languageTutorModeMessage, "it", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted empty input")
	}
	if _, err := newLanguageTutorRequest("ciao", "translate", "it", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted an unknown mode")
	}
	if _, err := newLanguageTutorRequest("ciao", languageTutorModeMessage, "fr", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted an explanation outside the known languages")
	}
	request := mustLanguageTutorRequest(t, "ciao", languageTutorModeMessage, "")
	if request.Explanation != "it" {
		t.Fatalf("empty explanation resolved to %q, want the default language", request.Explanation)
	}
	if _, err := analyzeLanguageTutor(context.Background(), http.DefaultClient, "https://example.org", "", testLanguageTutorTuning(), request, nil); err == nil {
		t.Fatal("analyzeLanguageTutor() accepted a remote endpoint")
	}
}

func TestParseTutorAnalysisValidatesDraftOutput(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Merhaba", languageTutorModeDraft, "it")
	valid := `{"detected_language":"Turkish","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"merhaba -> ciao","meaning":"hello"}]}],"grammar_rule":"Vowel harmony.","text_to_insert":"Merhaba."}`
	analysis, err := parseTutorAnalysis(valid, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.DetectedLanguage != "tr" || analysis.OriginalText != "Merhaba" || analysis.TextToInsert != "Merhaba." || len(analysis.Phrases) != 1 {
		t.Fatalf("normalized analysis = %+v", analysis)
	}

	for _, response := range []string{
		`not json`,
		`{"detected_language":"xyz-unknown","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"x"}]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"x"}]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"x"}]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","words":[{"word":"Merhaba","breakdown":"x"}]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"x"}]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba"}]}],"grammar_rule":"rule","text_to_insert":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"x"}]}],"grammar_rule":"","text_to_insert":"Merhaba."}`,
	} {
		if _, err := parseTutorAnalysis(response, draft); err == nil {
			t.Errorf("parseTutorAnalysis(%q) accepted invalid output", response)
		}
	}
}

func TestParseTutorAnalysisHandlesIncomingMessages(t *testing.T) {
	incoming := mustLanguageTutorRequest(t, "Ciao, come stai?", languageTutorModeMessage, "en")
	response := `{"detected_language":"it","translation":"Hi, how are you?","has_grammar_errors":true,"error_explanation":"ignored","phrases":[],"grammar_rule":"","text_to_insert":"Merhaba"}`
	analysis, err := parseTutorAnalysis(response, incoming)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.DetectedLanguage != "it" || analysis.TargetLanguage != "tr" || analysis.ExplanationLanguage != "en" {
		t.Fatalf("unexpected analysis roles: %+v", analysis)
	}
	if analysis.HasGrammarErrors || analysis.ErrorExplanation != "" {
		t.Fatalf("grammar checked outside the learning language: %+v", analysis)
	}
	if analysis.TextToInsert != "" {
		t.Fatalf("incoming message produced text to insert: %q", analysis.TextToInsert)
	}
	if analysis.Phrases == nil || len(analysis.Phrases) != 0 {
		t.Fatalf("phrases = %#v, want an empty list", analysis.Phrases)
	}
}

func TestParseTutorAnalysisFindsWrappedJSONAndDefaultsTextToInsert(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Merhaba.", languageTutorModeDraft, "it")
	response := "Here is the analysis:\n```json\n" + `{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"merhaba -> ciao","meaning":"hello"}]}],"grammar_rule":"Turkish uses vowel harmony."}` + "\n```\n"
	analysis, err := parseTutorAnalysis(response, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.OriginalText != "Merhaba." || analysis.CorrectedText != "Merhaba." || analysis.TextToInsert != "Merhaba." {
		t.Fatalf("normalized analysis = %+v", analysis)
	}
}

func TestParseTutorAnalysisKeepsPhraseBoundaries(t *testing.T) {
	request := mustLanguageTutorRequest(t, "Yaa ben seni arzuluyorum", languageTutorModeMessage, "it")
	response := `{"detected_language":"tr","corrected_text":"Yaa ben seni arzuluyorum","translation":"Sì, ti desidero.","phrases":[{"text":"Yaa","meaning":"Sì","words":[{"word":"Yaa","breakdown":"Yaa","meaning":"yeah (interjection)"}]},{"text":"ben seni arzuluyorum","meaning":"ti desidero","words":[{"word":"ben","breakdown":"ben","meaning":"I"},{"word":"seni","breakdown":"sen-i","meaning":"you (accusative)"},{"word":"arzuluyorum","breakdown":"arzu-la-yor-um","meaning":"I desire"}]}],"grammar_rule":"Turkish places the verb last.","text_to_insert":""}`
	analysis, err := parseTutorAnalysis(response, request)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if len(analysis.Phrases) != 2 || analysis.Phrases[0].Text != "Yaa" || analysis.Phrases[1].Text != "ben seni arzuluyorum" || len(analysis.Phrases[1].Words) != 3 {
		t.Fatalf("phrases = %+v", analysis.Phrases)
	}
}

func TestAnalyzeLanguageTutorRetriesMalformedResponseAndResetsStream(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages  []AIMessage `json:"messages"`
			MaxTokens int         `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		requestCount++
		content := "The response was truncated: {"
		if requestCount == 2 {
			if request.MaxTokens != languageTutorRetryMaxTokens || len(request.Messages) != 2 || !strings.Contains(request.Messages[1].Content, "Re-analyze the original source text") {
				t.Errorf("unexpected retry request: %+v", request)
			}
			content = `{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","phrases":[{"text":"Merhaba.","meaning":"Ciao.","words":[{"word":"Merhaba","breakdown":"merhaba -> ciao","meaning":"hello"}]}],"grammar_rule":"Turkish uses vowel harmony.","text_to_insert":""}`
		}
		if err := json.NewEncoder(w).Encode(chatCompletionResponse(content)); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	var events []AIStreamEvent
	request := mustLanguageTutorRequest(t, "Merhaba.", languageTutorModeMessage, "it")
	analysis, err := analyzeLanguageTutor(context.Background(), server.Client(), server.URL, "tutor-model", testLanguageTutorTuning(), request, func(text string, reset bool) {
		events = append(events, AIStreamEvent{Text: text, Reset: reset})
	})
	if err != nil {
		t.Fatalf("analyzeLanguageTutor() error = %v", err)
	}
	if requestCount != 2 || analysis.CorrectedText != "Merhaba." {
		t.Fatalf("requests = %d, analysis = %+v", requestCount, analysis)
	}
	// Expected stream: the malformed first response, a reset before the retry, then the retry response.
	if len(events) != 3 || events[0].Text == "" || !events[1].Reset || events[2].Text == "" {
		t.Fatalf("stream events = %+v", events)
	}
}

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
		"Turkish":     {code: "tr", ok: true},
		"IT":          {code: "it", ok: true},
		"ja":          {code: "ja", ok: true},
		"xyz-unknown": {ok: false},
		"":            {ok: false},
	}
	for input, want := range tests {
		code, ok := detectedLanguageCode(input)
		if code != want.code || ok != want.ok {
			t.Errorf("detectedLanguageCode(%q) = (%q, %v), want (%q, %v)", input, code, ok, want.code, want.ok)
		}
	}
}
