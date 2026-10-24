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
		if request.Model != "tutor-model" || request.Stream || request.Temperature != 0.1 || request.MaxTokens != turkishTutorMaxTokens || len(request.Messages) != 2 {
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
		if !strings.Contains(request.Messages[0].Content, "Agglutination Analysis") || !strings.Contains(request.Messages[0].Content, "NEVER suggest") {
			t.Errorf("system prompt omitted tutor rules: %q", request.Messages[0].Content)
		}
		if !strings.Contains(request.Messages[1].Content, `"Ben okula gidiyorum"`) {
			t.Errorf("user prompt did not safely quote input: %q", request.Messages[1].Content)
		}
		content := "```json\n" + `{"detected_language":"tr","original_text":"model text","corrected_text":"Ben okula gidiyorum.","translation":"Vado a scuola.","has_grammar_errors":false,"morpheme_breakdown":[{"word":"okula","breakdown":"okul-a -> scuola-verso","meaning":"to school"}],"grammar_rule":"Turkish uses SOV order.","text_to_insert":"Ben okula gidiyorum."}` + "\n```"
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
	analysis, err := parseTutorAnalysis(valid, "Ciao")
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
		if _, err := parseTutorAnalysis(response, "input"); err == nil {
			t.Errorf("parseTutorAnalysis(%q) accepted invalid output", response)
		}
	}
}

func TestParseTutorAnalysisFindsWrappedJSONAndDefaultsTextToInsert(t *testing.T) {
	response := "Here is the analysis:\n```json\n" + `{"detected_language":"it","translation":"Merhaba.","morpheme_breakdown":[{"word":"Merhaba","breakdown":"merhaba -> ciao","meaning":"hello"}],"grammar_rule":"Turkish uses vowel harmony."}` + "\n```\n"
	analysis, err := parseTutorAnalysis(response, "Ciao.")
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
