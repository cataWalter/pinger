package desktop

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

// checkSuggestedReplies trims the options and rejects missing, repeated, empty, or overlong ones.
func checkSuggestedReplies(options []SuggestedReply) ([]SuggestedReply, error) {
	if len(options) != suggestedRepliesCount {
		return nil, fmt.Errorf("expected %d suggestions, got %d", suggestedRepliesCount, len(options))
	}
	seenTones := make(map[string]bool, len(options))
	seenTexts := make(map[string]bool, len(options))
	cleaned := make([]SuggestedReply, 0, len(options))
	for _, option := range options {
		tone := strings.TrimSpace(option.Tone)
		text := strings.TrimSpace(option.Text)
		translation := strings.TrimSpace(option.Translation)
		key := strings.ToLower(text)
		switch {
		case !slices.Contains(suggestedRepliesTones, tone):
			return nil, fmt.Errorf("unknown tone %q", option.Tone)
		case seenTones[tone]:
			return nil, fmt.Errorf("tone %s is used more than once", tone)
		case text == "":
			return nil, fmt.Errorf("the %s suggestion is empty", tone)
		case translation == "":
			return nil, fmt.Errorf("the %s translation is empty", tone)
		case utf8.RuneCountInString(text) > suggestedRepliesTextRunes:
			return nil, fmt.Errorf("the %s suggestion is longer than %d characters", tone, suggestedRepliesTextRunes)
		case utf8.RuneCountInString(translation) > suggestedRepliesTextRunes:
			return nil, fmt.Errorf("the %s translation is longer than %d characters", tone, suggestedRepliesTextRunes)
		case seenTexts[key]:
			return nil, errors.New("suggestions repeat the same text")
		}
		seenTones[tone] = true
		seenTexts[key] = true
		cleaned = append(cleaned, SuggestedReply{Tone: tone, Text: text, Translation: translation})
	}
	return cleaned, nil
}
