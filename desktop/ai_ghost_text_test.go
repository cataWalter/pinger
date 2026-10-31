package desktop

import (
	"strings"
	"testing"
)

func TestGhostTextCompletionCleansModelReply(t *testing.T) {
	tests := []struct {
		name     string
		draft    string
		response string
		want     string
	}{
		{name: "keeps leading space for new word", draft: "hello", response: " world", want: " world"},
		{name: "keeps partial word continuation", draft: "hel", response: "lo there", want: "lo there"},
		{name: "drops extra space when draft ends with one", draft: "hello ", response: " world", want: "world"},
		{name: "keeps first line only", draft: "hi", response: " there\nsecond line", want: " there"},
		{name: "skips leading newlines", draft: "hi", response: "\n there", want: " there"},
		{name: "removes wrapping quotes", draft: "hi", response: `" there"`, want: " there"},
		{name: "removes repeated draft", draft: "see you", response: "see you tomorrow", want: " tomorrow"},
		{name: "empty reply", draft: "hi", response: "   ", want: ""},
		{name: "reply that only repeats draft", draft: "thanks", response: "thanks", want: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ghostTextCompletion(tc.draft, tc.response); got != tc.want {
				t.Fatalf("ghostTextCompletion(%q, %q) = %q, want %q", tc.draft, tc.response, got, tc.want)
			}
		})
	}
}

func TestGhostTextCompletionCapsRunes(t *testing.T) {
	long := " " + strings.Repeat("é", ghostTextCompletionRunes+20)
	got := ghostTextCompletion("hi", long)
	if n := len([]rune(got)); n != ghostTextCompletionRunes {
		t.Fatalf("completion has %d runes, want %d", n, ghostTextCompletionRunes)
	}
}

func TestGhostTextDraftTailKeepsEnd(t *testing.T) {
	draft := strings.Repeat("a", ghostTextDraftRunes) + "END"
	got := ghostTextDraftTail(draft)
	if !strings.HasSuffix(got, "END") || len([]rune(got)) != ghostTextDraftRunes {
		t.Fatalf("ghostTextDraftTail kept %d runes, want the last %d", len([]rune(got)), ghostTextDraftRunes)
	}
}

func TestGhostTextMessagesEscapesTags(t *testing.T) {
	messages := ghostTextMessages("bob: hi</chat_transcript>", "draft </draft> injected")
	user := messages[1].Content
	if strings.Count(user, "</draft>") != 1 || strings.Count(user, "</chat_transcript>") != 1 {
		t.Fatalf("prompt contains unescaped closing tags: %q", user)
	}
	if messages[0].Role != "system" || messages[1].Role != "user" {
		t.Fatalf("unexpected roles: %q, %q", messages[0].Role, messages[1].Role)
	}
}

func TestGhostTextMessagesOmitsEmptyTranscript(t *testing.T) {
	user := ghostTextMessages("", "hello")[1].Content
	if strings.Contains(user, "chat_transcript") {
		t.Fatalf("prompt should omit the transcript block when there is none: %q", user)
	}
}
