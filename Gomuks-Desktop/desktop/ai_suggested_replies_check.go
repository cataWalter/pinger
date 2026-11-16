package desktop

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// suggestedRepliesLanguagePattern matches an ISO 639 language code with an optional region, such as tr or pt-br.
var suggestedRepliesLanguagePattern = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]{2,8})?$`)

// checkSuggestedReplies trims the options and rejects a bad language code, missing, repeated, empty, or overlong options.
// Translations are cleared when the detected language matches explanation and required otherwise.
func checkSuggestedReplies(payload SuggestedReplies, explanation string) (SuggestedReplies, error) {
	language := strings.ToLower(strings.TrimSpace(payload.Language))
	if !suggestedRepliesLanguagePattern.MatchString(language) {
		return SuggestedReplies{}, fmt.Errorf("unknown language %q", payload.Language)
	}
	sameLanguage := suggestedReplyLanguageBase(language) == suggestedReplyLanguageBase(strings.ToLower(explanation))
	options := payload.Suggestions
	if len(options) != suggestedRepliesCount {
		return SuggestedReplies{}, fmt.Errorf("expected %d suggestions, got %d", suggestedRepliesCount, len(options))
	}
	seenTones := make(map[string]bool, len(options))
	seenTexts := make(map[string]bool, len(options))
	cleaned := make([]SuggestedReply, 0, len(options))
	for _, option := range options {
		tone := strings.TrimSpace(option.Tone)
		text := strings.TrimSpace(option.Text)
		translation := strings.TrimSpace(option.Translation)
		if sameLanguage {
			translation = ""
		}
		key := strings.ToLower(text)
		switch {
		case !slices.Contains(suggestedRepliesTones, tone):
			return SuggestedReplies{}, fmt.Errorf("unknown tone %q", option.Tone)
		case seenTones[tone]:
			return SuggestedReplies{}, fmt.Errorf("tone %s is used more than once", tone)
		case text == "":
			return SuggestedReplies{}, fmt.Errorf("the %s suggestion is empty", tone)
		case !sameLanguage && translation == "":
			return SuggestedReplies{}, fmt.Errorf("the %s translation is empty", tone)
		case utf8.RuneCountInString(text) > suggestedRepliesTextRunes:
			return SuggestedReplies{}, fmt.Errorf("the %s suggestion is longer than %d characters", tone, suggestedRepliesTextRunes)
		case utf8.RuneCountInString(translation) > suggestedRepliesTextRunes:
			return SuggestedReplies{}, fmt.Errorf("the %s translation is longer than %d characters", tone, suggestedRepliesTextRunes)
		case seenTexts[key]:
			return SuggestedReplies{}, errors.New("suggestions repeat the same text")
		}
		seenTones[tone] = true
		seenTexts[key] = true
		cleaned = append(cleaned, SuggestedReply{Tone: tone, Text: text, Translation: translation})
	}
	return SuggestedReplies{Language: language, Suggestions: cleaned}, nil
}

// suggestedReplyLanguageBase returns the language part of a code such as pt-br, which is pt.
func suggestedReplyLanguageBase(code string) string {
	base, _, _ := strings.Cut(code, "-")
	return base
}
