package desktop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testLanguageTutorLanguages() tutorLanguages {
	return tutorLanguages{Learning: "tr", Default: "it", Known: []string{"it", "tr", "en"}, Names: map[string]string{"it": "Italian", "tr": "Turkish", "en": "English", "fr": "French"}}
}

func testLanguageTutorTuning() aiFeatureTuning {
	return aiFeatureTuning{Prompt: languageTutorSystemPrompt, Temperature: languageTutorTemperature, MaxTokens: languageTutorMaxTokens}
}

func mustLanguageTutorRequest(t *testing.T, text, mode, learning, explanation string) languageTutorRequest {
	t.Helper()
	request, err := newLanguageTutorRequest(text, mode, learning, explanation, testLanguageTutorLanguages())
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
		if !strings.Contains(request.Messages[0].Content, "untrusted data") || !strings.Contains(request.Messages[0].Content, "suggest what to say next") {
			t.Errorf("system prompt omitted tutor rules: %q", request.Messages[0].Content)
		}
		if !strings.Contains(request.Messages[1].Content, "Explanation language: Italian (it)") {
			t.Errorf("user prompt omitted the explanation language: %q", request.Messages[1].Content)
		}
		if !strings.Contains(request.Messages[1].Content, `"Ben okula gidiyorum"`) {
			t.Errorf("user prompt did not safely quote input: %q", request.Messages[1].Content)
		}
		content := "```json\n" + `{"detected_language":"tr","corrected_text":"Ben okula gidiyorum.","translation":"Vado a scuola."}` + "\n```"
		if err := json.NewEncoder(w).Encode(chatCompletionResponse(content)); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	request := mustLanguageTutorRequest(t, input, languageTutorModeMessage, "tr", "it")
	analysis, err := analyzeLanguageTutor(context.Background(), server.Client(), server.URL, "tutor-model", testLanguageTutorTuning(), request, nil)
	if err != nil {
		t.Fatalf("analyzeLanguageTutor() error = %v", err)
	}
	if analysis.DetectedLanguage != "tr" || analysis.CorrectedText != "Ben okula gidiyorum." || analysis.Translation != "Vado a scuola." {
		t.Fatalf("unexpected analysis: %+v", analysis)
	}
	if analysis.TextToInsert != "" {
		t.Fatalf("incoming message produced text to insert: %q", analysis.TextToInsert)
	}
}

func TestAnalyzeLanguageTutorRejectsEmptyAndRemoteInput(t *testing.T) {
	if _, err := newLanguageTutorRequest("  ", languageTutorModeMessage, "tr", "it", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted empty input")
	}
	if _, err := newLanguageTutorRequest("ciao", "translate", "tr", "it", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted an unknown mode")
	}
	if _, err := newLanguageTutorRequest("ciao", languageTutorModeMessage, "xx", "it", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted an unsupported learning language")
	}
	if _, err := newLanguageTutorRequest("ciao", languageTutorModeMessage, "tr", "xx", testLanguageTutorLanguages()); err == nil {
		t.Fatal("newLanguageTutorRequest() accepted an unsupported explanation language")
	}
	request := mustLanguageTutorRequest(t, "ciao", languageTutorModeMessage, "", "")
	if request.Explanation != "it" {
		t.Fatalf("empty explanation resolved to %q, want the default language", request.Explanation)
	}
	if _, err := analyzeLanguageTutor(context.Background(), http.DefaultClient, "https://example.org", "", testLanguageTutorTuning(), request, nil); err == nil {
		t.Fatal("analyzeLanguageTutor() accepted a remote endpoint")
	}
}

func TestLanguageTutorUsesChatLearningAndExplanationLanguages(t *testing.T) {
	request := mustLanguageTutorRequest(t, "Je vais à école.", languageTutorModeMessage, "fr", "en")
	if request.Learning != "fr" || request.Explanation != "en" {
		t.Fatalf("request languages = learning %q, explanation %q", request.Learning, request.Explanation)
	}
	prompt, err := languageTutorUserPrompt(request)
	if err != nil {
		t.Fatalf("languageTutorUserPrompt() error = %v", err)
	}
	if !strings.Contains(prompt, "Learning language: French (fr)") || !strings.Contains(prompt, "Explanation language: English (en)") {
		t.Fatalf("prompt omitted the per-chat languages: %q", prompt)
	}

	response := `{"detected_language":"fr","corrected_text":"Je vais à l'école.","translation":"I am going to school.","grammar_notes":["Use à l'école for the contracted article.","Keep the infinitive after aller."],"vocabulary":[{"term":"aller à l'école","meaning":"to go to school","example":"Elle va à l'école à huit heures."}]}`
	analysis, err := parseTutorAnalysis(response, request)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.CorrectedText != "Je vais à l'école." || len(analysis.GrammarNotes) != 2 || len(analysis.Vocabulary) != 1 {
		t.Fatalf("unexpected language-learning analysis: %+v", analysis)
	}
}

func TestParseTutorAnalysisValidatesDraftOutput(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Merhaba", languageTutorModeDraft, "tr", "it")
	valid := `{"detected_language":"Turkish","corrected_text":"Merhaba."}`
	analysis, err := parseTutorAnalysis(valid, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.DetectedLanguage != "tr" || analysis.TextToInsert != "Merhaba." {
		t.Fatalf("normalized analysis = %+v", analysis)
	}

	for _, response := range []string{
		`not json`,
		`{"detected_language":"12","corrected_text":"Merhaba."}`,
		`{"detected_language":"tr","corrected_text":""}`,
	} {
		if _, err := parseTutorAnalysis(response, draft); err == nil {
			t.Errorf("parseTutorAnalysis(%q) accepted invalid output", response)
		}
	}
}

func TestDraftOutputDropsTranslationNotesAndVocabulary(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Merhaba", languageTutorModeDraft, "tr", "it")
	response := `{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao.","grammar_notes":["Should be discarded."],"vocabulary":[{"term":"merhaba","meaning":"hello","example":"Merhaba, Ali."}]}`
	analysis, err := parseTutorAnalysis(response, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.CorrectedText != "Merhaba." || analysis.TextToInsert != "Merhaba." {
		t.Fatalf("normalized analysis = %+v", analysis)
	}
	if analysis.Translation != "" || len(analysis.GrammarNotes) != 0 || len(analysis.Vocabulary) != 0 {
		t.Fatalf("draft kept extra fields: %+v", analysis)
	}
}

func TestDraftRequestSendsCorrectionOnlySchema(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ResponseFormat struct {
				JSONSchema struct {
					Schema struct {
						Properties map[string]json.RawMessage `json:"properties"`
					} `json:"schema"`
				} `json:"json_schema"`
			} `json:"response_format"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		properties := request.ResponseFormat.JSONSchema.Schema.Properties
		if len(properties) != 2 || properties["detected_language"] == nil || properties["corrected_text"] == nil {
			t.Errorf("draft schema properties = %v, want only detected_language and corrected_text", properties)
		}
		if err := json.NewEncoder(w).Encode(chatCompletionResponse(`{"detected_language":"tr","corrected_text":"Merhaba."}`)); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	draft := mustLanguageTutorRequest(t, "Merhaba", languageTutorModeDraft, "tr", "it")
	analysis, err := analyzeLanguageTutor(context.Background(), server.Client(), server.URL, "tutor-model", testLanguageTutorTuning(), draft, nil)
	if err != nil {
		t.Fatalf("analyzeLanguageTutor() error = %v", err)
	}
	if analysis.CorrectedText != "Merhaba." {
		t.Fatalf("unexpected analysis: %+v", analysis)
	}
}

func TestDraftRequestReturnsOnlyTargetLanguageText(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Merhaba", languageTutorModeDraft, "tr", "it")
	analysis, err := parseTutorAnalysis(`{"detected_language":"tr","corrected_text":"Merhaba."}`, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.TextToInsert != "Merhaba." {
		t.Fatalf("TextToInsert = %q, want the corrected draft", analysis.TextToInsert)
	}
	prompt, err := languageTutorUserPrompt(draft)
	if err != nil {
		t.Fatalf("languageTutorUserPrompt() error = %v", err)
	}
	if !strings.Contains(prompt, "Learning language: Turkish (tr)") || strings.Contains(prompt, "grammar_notes") || strings.Contains(prompt, `"translation"`) {
		t.Fatalf("draft prompt = %q", prompt)
	}
}

func TestDraftRejectsUntranslatedSourceEcho(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Domani non so quando potrò arrivare.", languageTutorModeDraft, "tr", "en")
	if _, err := parseTutorAnalysis(`{"detected_language":"it","corrected_text":"Domani non so quando potrò arrivare."}`, draft); err == nil {
		t.Fatal("untranslated draft echo was accepted")
	}
	if _, err := parseTutorAnalysis(`{"detected_language":"it","corrected_text":"\"Domani non so quando potrò arrivare.\""}`, draft); err == nil {
		t.Fatal("quoted untranslated draft echo was accepted")
	}
	analysis, err := parseTutorAnalysis(`{"detected_language":"it","corrected_text":"Yarın ne zaman gelebileceğimi bilmiyorum."}`, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.TextToInsert != "Yarın ne zaman gelebileceğimi bilmiyorum." {
		t.Fatalf("TextToInsert = %q, want the translated draft", analysis.TextToInsert)
	}
}

func TestParseTutorAnalysisHandlesIncomingMessages(t *testing.T) {
	incoming := mustLanguageTutorRequest(t, "Ciao, come stai?", languageTutorModeMessage, "tr", "en")
	response := `{"detected_language":"it","corrected_text":"Ciao, come stai?","translation":"Hi, how are you?","grammar_notes":["Should be discarded."],"vocabulary":[{"term":"ciao","meaning":"hello","example":"Ciao, Ana!"}],"text_to_insert":"Merhaba"}`
	analysis, err := parseTutorAnalysis(response, incoming)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.DetectedLanguage != "it" || analysis.Translation != "Hi, how are you?" {
		t.Fatalf("unexpected analysis: %+v", analysis)
	}
	if analysis.CorrectedText != "" || analysis.TextToInsert != "" {
		t.Fatalf("text outside the learning language kept corrected or insertable text: %+v", analysis)
	}
	if len(analysis.GrammarNotes) != 0 || len(analysis.Vocabulary) != 0 {
		t.Fatalf("learning notes were kept for text outside the learning language: %+v", analysis)
	}

	learningIncoming := mustLanguageTutorRequest(t, "Ben okula gidiyorum", languageTutorModeMessage, "tr", "en")
	if _, err := parseTutorAnalysis(`{"detected_language":"tr","corrected_text":"","translation":"I go to school."}`, learningIncoming); err == nil {
		t.Fatal("learning-language message without corrected text was accepted")
	}
	if _, err := parseTutorAnalysis(`{"detected_language":"it","corrected_text":"","translation":""}`, incoming); err == nil {
		t.Fatal("incoming message without translation was accepted")
	}
}

func TestParseTutorAnalysisFindsWrappedJSONAndDefaultsTextToInsert(t *testing.T) {
	draft := mustLanguageTutorRequest(t, "Merhaba.", languageTutorModeDraft, "tr", "it")
	response := "Here is the analysis:\n```json\n" + `{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao."}` + "\n```\n"
	analysis, err := parseTutorAnalysis(response, draft)
	if err != nil {
		t.Fatalf("parseTutorAnalysis() error = %v", err)
	}
	if analysis.CorrectedText != "Merhaba." || analysis.TextToInsert != "Merhaba." {
		t.Fatalf("normalized analysis = %+v", analysis)
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
			if request.MaxTokens != languageTutorRetryMaxTokens || len(request.Messages) != 2 || !strings.Contains(request.Messages[1].Content, "Return one complete JSON object") {
				t.Errorf("unexpected retry request: %+v", request)
			}
			content = `{"detected_language":"tr","corrected_text":"Merhaba.","translation":"Ciao."}`
		}
		if err := json.NewEncoder(w).Encode(chatCompletionResponse(content)); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	var events []AIStreamEvent
	request := mustLanguageTutorRequest(t, "Merhaba.", languageTutorModeMessage, "tr", "it")
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
