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

	learning, explanation, languages := suggestedReplyLanguages(preferences, "!room:test")
	if learning != "fr" || explanation != "de" {
		t.Fatalf("room languages = learning %q, explanation %q", learning, explanation)
	}
	if got := languageTutorLabel(languages.Names, learning); got != "French (fr)" {
		t.Fatalf("learning label = %q", got)
	}
	if got := languageTutorLabel(languages.Names, explanation); got != "German (de)" {
		t.Fatalf("explanation label = %q", got)
	}
}

func TestParseSuggestedRepliesRejectsInvalidOptions(t *testing.T) {
	tests := map[string]string{
		"four suggestions": `{"suggestions":[{"tone":"Warm","text":"a"},{"tone":"Brief","text":"b"},{"tone":"Direct","text":"c"},{"tone":"Warm","text":"d"}]}`,
		"plain strings":    `{"suggestions":["a","b","c"]}`,
		"unknown tone":     `{"suggestions":[{"tone":"Angry","text":"a"},{"tone":"Brief","text":"b"},{"tone":"Direct","text":"c"}]}`,
		"repeated tone":    `{"suggestions":[{"tone":"Warm","text":"a"},{"tone":"Warm","text":"b"},{"tone":"Direct","text":"c"}]}`,
		"empty text":       `{"suggestions":[{"tone":"Warm","text":"  "},{"tone":"Brief","text":"b"},{"tone":"Direct","text":"c"}]}`,
		"repeated text":    `{"suggestions":[{"tone":"Warm","text":"Ok"},{"tone":"Brief","text":" ok "},{"tone":"Direct","text":"c"}]}`,
		"overlong text":    `{"suggestions":[{"tone":"Warm","text":"` + strings.Repeat("a", suggestedRepliesTextRunes+1) + `"},{"tone":"Brief","text":"b"},{"tone":"Direct","text":"c"}]}`,
	}
	for name, response := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := parseSuggestedReplies(response); err == nil {
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
