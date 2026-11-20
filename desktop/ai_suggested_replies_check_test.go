package desktop

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSuggestedRepliesUsesRoomLanguagePreferences(t *testing.T) {
	preferences := map[string]any{
		"ai.tutor_language":                 "tr",
		"ai.default_language":               "en",
		"room.learning_language.!room:test": "fr",
		"room.tutor_language.!room:test":    "de",
	}

	explanation, languages := suggestedReplyLanguages(preferences, "!room:test")
	if explanation != "de" {
		t.Fatalf("explanation = %q", explanation)
	}
	if got := languageTutorLabel(languages.Names, explanation); got != "German (de)" {
		t.Fatalf("explanation label = %q", got)
	}
}

func TestParseSuggestedRepliesRejectsInvalidOptions(t *testing.T) {
	identity := func(options []SuggestedReply) []SuggestedReply { return options }
	tests := map[string]struct {
		language string
		edit     func([]SuggestedReply) []SuggestedReply
	}{
		"too few suggestions": {"en", func(options []SuggestedReply) []SuggestedReply { return options[:suggestedRepliesCount-1] }},
		"too many suggestions": {"en", func(options []SuggestedReply) []SuggestedReply {
			return append(options, SuggestedReply{Tone: "Brief", Text: "extra", Translation: "extra"})
		}},
		"unknown tone": {"en", func(options []SuggestedReply) []SuggestedReply {
			options[0].Tone = "Angry"
			return options
		}},
		"repeated tone": {"en", func(options []SuggestedReply) []SuggestedReply {
			options[1].Tone = options[0].Tone
			return options
		}},
		"empty text": {"en", func(options []SuggestedReply) []SuggestedReply {
			options[0].Text = "  "
			return options
		}},
		"repeated text": {"en", func(options []SuggestedReply) []SuggestedReply {
			options[1].Text = " reply one "
			return options
		}},
		"overlong text": {"en", func(options []SuggestedReply) []SuggestedReply {
			options[0].Text = strings.Repeat("a", suggestedRepliesTextRunes+1)
			return options
		}},
		"missing translation in another language": {"it", func(options []SuggestedReply) []SuggestedReply {
			options[0].Translation = " "
			return options
		}},
		"unknown language": {"Italian", identity},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			response := testSuggestedRepliesResponse(t, tc.language, tc.edit(testSuggestedReplyOptions()))
			if _, err := parseSuggestedReplies(response, "en"); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestRequestSuggestedRepliesStopsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Drain the body first so the server watches the connection and r.Context() ends when the client disconnects.
		_, _ = io.Copy(io.Discard, r.Body)
		cancel()
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)

	_, err := requestSuggestedReplies(ctx, server.Client(), server.URL, "local.gguf", testSuggestedRepliesTuning(), suggestedRepliesInput{Transcript: "Alice: hi\n", Latest: "Alice: hi"})
	if !errors.Is(err, errAIRunStopped) {
		t.Fatalf("error = %v, want errAIRunStopped", err)
	}
}
