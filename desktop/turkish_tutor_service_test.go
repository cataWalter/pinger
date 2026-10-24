package desktop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnalyzeTurkishTutorUsesLocalStructuredRequest(t *testing.T) {
	input := "Ben okula gidiyorum"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.URL.Path)
		}
		var request struct {
			Model              string          `json:"model"`
			Messages           []AIMessage     `json:"messages"`
			Stream             bool            `json:"stream"`
			Temperature        float64         `json:"temperature"`
			MaxTokens          int             `json:"max_tokens"`
			ResponseFormat     json.RawMessage `json:"response_format"`
			ChatTemplateKwargs map[string]any  `json:"chat_template_kwargs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Model != "tutor-model" || request.Stream || request.Temperature != 0.6 || request.MaxTokens != turkishTutorMaxTokens || len(request.Messages) != 2 {
			t.Errorf("unexpected AI request: %+v", request)
		}
		if enabled, ok := request.ChatTemplateKwargs["enable_thinking"]; !ok || enabled != false {
			t.Errorf("chat_template_kwargs = %+v, want enable_thinking false", request.ChatTemplateKwargs)
		}
		var responseFormat struct {
			Type       string `json:"type"`
			JSONSchema struct {
				Name string `json:"name"`
			} `json:"json_schema"`
		}
		if err := json.Unmarshal(request.ResponseFormat, &responseFormat); err != nil || responseFormat.Type != "json_schema" || responseFormat.JSONSchema.Name != "tutor_analysis" {
			t.Errorf("response_format = %s, want json_schema tutor_analysis (err %v)", request.ResponseFormat, err)
		}
		if !strings.Contains(request.Messages[0].Content, "Word-by-Word Analysis") || !strings.Contains(request.Messages[0].Content, "NEVER suggest") {
			t.Errorf("system prompt omitted tutor rules: %q", request.Messages[0].Content)
		}
		if !strings.Contains(request.Messages[1].Content, `"Ben okula gidiyorum"`) {
			t.Errorf("user prompt did not safely quote input: %q", request.Messages[1].Content)
		}
		content := "```json\n" + `{"detected_language":"target","original_text":"model text","corrected_text":"Ben okula gidiyorum.","translation":"Vado a scuola.","has_grammar_errors":false,"morpheme_breakdown":[{"word":"okula","breakdown":"okul-a -> scuola-verso","meaning":"to school"}],"grammar_rule":"Turkish uses SOV order.","text_to_insert":"Ben okula gidiyorum."}` + "\n```"
		response := map[string]any{"choices": []any{
			map[string]any{"message": map[string]string{"content": content}},
		}}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	analysis, err := analyzeTurkishTutor(context.Background(), server.Client(), server.URL, "tutor-model", input)
	if err != nil {
		t.Fatalf("analyzeTurkishTutor() error = %v", err)
	}
	if analysis.DetectedLanguage != "tr" || analysis.OriginalText != input || analysis.Translation != "Vado a scuola." {
		t.Fatalf("unexpected analysis: %+v", analysis)
	}
	if len(analysis.MorphemeBreakdown) != 1 || analysis.MorphemeBreakdown[0].Word != "okula" {
		t.Fatalf("morpheme breakdown = %+v", analysis.MorphemeBreakdown)
	}
}

func TestAnalyzeTurkishTutorRejectsEmptyAndRemoteInput(t *testing.T) {
	if _, err := analyzeTurkishTutor(context.Background(), http.DefaultClient, "http://localhost:11434", "", "  "); err == nil {
		t.Fatal("analyzeTurkishTutor() accepted empty input")
	}
	if _, err := analyzeTurkishTutor(context.Background(), http.DefaultClient, "https://example.org", "", "ciao"); err == nil {
		t.Fatal("analyzeTurkishTutor() accepted a remote endpoint")
	}
}

func TestParseTutorAnalysisValidatesStructuredOutput(t *testing.T) {
	valid := `{"detected_language":"Italian","corrected_text":"Merhaba.","translation":"Ciao.","morpheme_breakdown":[{"word":"Merhaba","breakdown":"merhaba -> ciao"}],"grammar_rule":"Vowel harmony.","text_to_insert":"Merhaba."}`
	analysis, err := parseTutorAnalysis(valid, "Ciao", defaultTutorLanguagePair())
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.DetectedLanguage != "it" || analysis.OriginalText != "Ciao" || analysis.MorphemeBreakdown == nil {
		t.Fatalf("normalized analysis = %+v", analysis)
	}

	for _, response := range []string{
		`not json`,
		`{"detected_language":"en","corrected_text":"Merhaba","translation":"Hello","grammar_rule":"rule","text_to_insert":"Merhaba"}`,
		`{"detected_language":"tr","corrected_text":"","translation":"Ciao","grammar_rule":"rule","text_to_insert":"Merhaba"}`,
		`{"detected_language":"tr","corrected_text":"Merhaba","translation":"Ciao","morpheme_breakdown":[],"grammar_rule":"rule","text_to_insert":"Merhaba"}`,
		`{"detected_language":"tr","corrected_text":"Merhaba","translation":"Ciao","morpheme_breakdown":[{"word":"Merhaba"}],"grammar_rule":"rule","text_to_insert":"Merhaba"}`,
	} {
		if _, err := parseTutorAnalysis(response, "input", defaultTutorLanguagePair()); err == nil {
			t.Errorf("parseTutorAnalysis(%q) accepted invalid output", response)
		}
	}
}

func TestParseTutorAnalysisFindsWrappedJSONAndDefaultsTextToInsert(t *testing.T) {
	response := "Here is the analysis:\n```json\n" + `{"detected_language":"it","translation":"Merhaba.","morpheme_breakdown":[{"word":"Merhaba","breakdown":"merhaba -> ciao","meaning":"hello"}],"grammar_rule":"Turkish uses vowel harmony."}` + "\n```\n"
	analysis, err := parseTutorAnalysis(response, "Ciao.", defaultTutorLanguagePair())
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.OriginalText != "Ciao." || analysis.CorrectedText != "Merhaba." || analysis.TextToInsert != "Merhaba." {
		t.Fatalf("normalized analysis = %+v", analysis)
	}
}

func TestAnalyzeTurkishTutorRetriesMalformedResponse(t *testing.T) {
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
			if request.MaxTokens != turkishTutorMaxTokens || !strings.Contains(request.Messages[1].Content, "Re-analyze the original source text") {
				t.Errorf("unexpected retry request: %+v", request)
			}
			content = `{"detected_language":"it","corrected_text":"Merhaba.","translation":"Merhaba.","morpheme_breakdown":[{"word":"Merhaba","breakdown":"merhaba -> ciao","meaning":"hello"}],"grammar_rule":"Turkish uses vowel harmony.","text_to_insert":"Merhaba."}`
		}
		response := map[string]any{"choices": []any{
			map[string]any{"message": map[string]string{"content": content}},
		}}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	analysis, err := analyzeTurkishTutor(context.Background(), server.Client(), server.URL, "tutor-model", "Ciao.")
	if err != nil {
		t.Fatalf("analyzeTurkishTutor() error = %v", err)
	}
	if requestCount != 2 || analysis.TextToInsert != "Merhaba." {
		t.Fatalf("requests = %d, analysis = %+v", requestCount, analysis)
	}
}

func TestTutorLanguagePairFromPreferences(t *testing.T) {
	pair := tutorLanguagePairFromPreferences(map[string]any{"ai.tutor_language": "es", "ai.tutor_explanation_language": "en"})
	if pair.Target.Code != "es" || pair.Target.Name != "Spanish" || pair.Explanation.Code != "en" || pair.Explanation.Name != "English" {
		t.Fatalf("pair = %+v", pair)
	}
	for name, preferences := range map[string]map[string]any{
		"defaults":  nil,
		"unknown":   {"ai.tutor_language": "xx"},
		"identical": {"ai.tutor_language": "fr", "ai.tutor_explanation_language": "fr"},
	} {
		if pair := tutorLanguagePairFromPreferences(preferences); pair.Target.Code != "tr" || pair.Explanation.Code != "it" {
			t.Errorf("%s: pair = %+v, want Turkish and Italian defaults", name, pair)
		}
	}
}

func TestAnalyzeTutorUsesSelectedLanguagePair(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []AIMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if len(request.Messages) != 2 || !strings.Contains(request.Messages[1].Content, "Tutor language: Spanish. Explanation language: English.") {
			t.Errorf("user prompt omitted selected languages: %+v", request.Messages)
		}
		content := `{"detected_language":"target","original_text":"model text","corrected_text":"Hola, ¿cómo estás?","translation":"Hello, how are you?","has_grammar_errors":false,"morpheme_breakdown":[{"word":"estás","breakdown":"est-ás -> estar-tú","meaning":"you are"}],"grammar_rule":"Second-person verb endings.","text_to_insert":"Hola, ¿cómo estás?"}`
		response := map[string]any{"choices": []any{
			map[string]any{"message": map[string]string{"content": content}},
		}}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	languages := tutorLanguagePair{
		Target:      tutorLanguage{Code: "es", Name: "Spanish"},
		Explanation: tutorLanguage{Code: "en", Name: "English"},
	}
	tuning := aiFeatureTuningFor(nil, aiFeatureTurkishTutor)
	analysis, err := analyzeTurkishTutorWithOptions(context.Background(), server.Client(), server.URL, "tutor-model", "Hola", tuning, languages, nil, nil)
	if err != nil {
		t.Fatalf("analyzeTurkishTutorWithOptions() error = %v", err)
	}
	if analysis.DetectedLanguage != "es" || analysis.TargetLanguage != "es" || analysis.ExplanationLanguage != "en" || analysis.TextToInsert != "Hola, ¿cómo estás?" {
		t.Fatalf("analysis = %+v", analysis)
	}
}

func TestNormalizeTutorAnalysisMapsDetectedLanguageToPair(t *testing.T) {
	languages := tutorLanguagePair{
		Target:      tutorLanguage{Code: "de", Name: "German"},
		Explanation: tutorLanguage{Code: "en", Name: "English"},
	}
	analysis := TutorAnalysis{
		DetectedLanguage:  "English",
		CorrectedText:     "Guten Tag.",
		Translation:       "Good day.",
		MorphemeBreakdown: []MorphemeItem{{Word: "Guten", Breakdown: "gut-en", Meaning: "good"}},
		GrammarRule:       "Adjective endings follow the case.",
	}
	if err := normalizeTutorAnalysis(&analysis, "Good day.", languages); err != nil {
		t.Fatalf("normalizeTutorAnalysis() error = %v", err)
	}
	if analysis.DetectedLanguage != "en" || analysis.TargetLanguage != "de" || analysis.ExplanationLanguage != "en" || analysis.TextToInsert != "Good day." {
		t.Fatalf("normalized analysis = %+v", analysis)
	}

	unsupported := TutorAnalysis{DetectedLanguage: "tr", CorrectedText: "Guten Tag.", Translation: "Good day.", MorphemeBreakdown: []MorphemeItem{{Word: "Guten", Breakdown: "gut-en"}}, GrammarRule: "rule"}
	if err := normalizeTutorAnalysis(&unsupported, "Good day.", languages); err == nil {
		t.Fatal("normalizeTutorAnalysis() accepted a language outside the pair")
	}
}

// tutorReplyWithBreakdown returns a schema-valid Tutor reply with one morpheme item for "gideceğim".
func tutorReplyWithBreakdown(breakdown string) string {
	return `{"detected_language":"target","corrected_text":"Ben yarın okula gideceğim.","translation":"Domani andrò a scuola.","has_grammar_errors":false,"morpheme_breakdown":[{"word":"gideceğim","breakdown":"` + breakdown + `","meaning":"I will go"}],"grammar_rule":"Future tense.","text_to_insert":"Ben yarın okula gideceğim."}`
}

// newTutorReplyServer answers the Nth request with the Nth reply, repeating the last reply, and records each request's messages.
func newTutorReplyServer(t *testing.T, replies ...string) (*httptest.Server, *[][]AIMessage) {
	t.Helper()
	var requests [][]AIMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []AIMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		requests = append(requests, request.Messages)
		content := replies[min(len(requests), len(replies))-1]
		response := map[string]any{"choices": []any{
			map[string]any{"message": map[string]string{"content": content}},
		}}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

func TestMorphemeBreakdownMustSpellWord(t *testing.T) {
	for _, tc := range []struct {
		word, breakdown string
		want            bool
	}{
		{"gideceğim", "gid-eceğ-im", true},
		{"gideceğim", "git-e-cek-im", false},
		{"yarın", "yarin", false},
		{"Merhaba", "merhaba -> ciao", true},
		{"Ciao.", "ciao", true},
		{"okula", "okul-a -> scuola-verso", true},
		{"estás", "est-ás -> estar-tú", true},
		{"houses", "house-s", true},
		{"книги", "книг-и", true},
		{"книги", "книг-а", false},
	} {
		item := MorphemeItem{Word: tc.word, Breakdown: tc.breakdown}
		if got := morphemeSpellsWord(item); got != tc.want {
			t.Errorf("morphemeSpellsWord(%q, %q) = %v, want %v", tc.word, tc.breakdown, got, tc.want)
		}
	}
}

func TestAnalyzeTutorRetriesMorphemeMismatch(t *testing.T) {
	server, requests := newTutorReplyServer(t, tutorReplyWithBreakdown("git-e-cek-im"), tutorReplyWithBreakdown("gid-eceğ-im"))
	analysis, err := analyzeTurkishTutor(context.Background(), server.Client(), server.URL, "tutor-model", "Ben yarın okula gideceğim.")
	if err != nil {
		t.Fatalf("analyzeTurkishTutor() error = %v", err)
	}
	if len(*requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(*requests))
	}
	retryPrompt := (*requests)[1][1].Content
	if !strings.Contains(retryPrompt, `"gideceğim"`) || !strings.Contains(retryPrompt, "gitecekim") {
		t.Errorf("retry prompt did not name the mismatched word: %q", retryPrompt)
	}
	if got := analysis.MorphemeBreakdown[0].Breakdown; got != "gid-eceğ-im" {
		t.Fatalf("breakdown = %q, want the corrected segmentation", got)
	}
}

func TestAnalyzeTutorShowsUnverifiedWordWhole(t *testing.T) {
	reply := `{"detected_language":"target","corrected_text":"Ben yarın okula gideceğim.","translation":"Domani andrò a scuola.","has_grammar_errors":false,"morpheme_breakdown":[{"word":"okula","breakdown":"okul-a","meaning":"to school"},{"word":"gideceğim","breakdown":"git-e-cek-im","meaning":"I will go"}],"grammar_rule":"Future tense.","text_to_insert":"Ben yarın okula gideceğim."}`
	server, requests := newTutorReplyServer(t, reply)
	analysis, err := analyzeTurkishTutor(context.Background(), server.Client(), server.URL, "tutor-model", "Ben yarın okula gideceğim.")
	if err != nil {
		t.Fatalf("analyzeTurkishTutor() error = %v", err)
	}
	if len(*requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(*requests))
	}
	if len(analysis.MorphemeBreakdown) != 2 {
		t.Fatalf("morpheme breakdown = %+v", analysis.MorphemeBreakdown)
	}
	if got := analysis.MorphemeBreakdown[0].Breakdown; got != "okul-a" {
		t.Errorf("verified breakdown = %q, want okul-a", got)
	}
	if item := analysis.MorphemeBreakdown[1]; item.Breakdown != "gideceğim" || item.Meaning != "I will go" {
		t.Errorf("unverified item = %+v, want the whole word with its meaning", item)
	}
}

func TestAnalyzeTutorKeepsFirstReplyWhenRetryIsMalformed(t *testing.T) {
	server, requests := newTutorReplyServer(t, tutorReplyWithBreakdown("git-e-cek-im"), "The response was truncated: {")
	analysis, err := analyzeTurkishTutor(context.Background(), server.Client(), server.URL, "tutor-model", "Ben yarın okula gideceğim.")
	if err != nil {
		t.Fatalf("analyzeTurkishTutor() error = %v", err)
	}
	if len(*requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(*requests))
	}
	if got := analysis.MorphemeBreakdown[0].Breakdown; got != "gideceğim" || analysis.TextToInsert != "Ben yarın okula gideceğim." {
		t.Fatalf("analysis = %+v, want the first reply with the whole word", analysis)
	}
}
