package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	sharedpreferences "mychat/preferences"
	"strings"
)

func languageTutorUserPrompt(request languageTutorRequest) (string, error) {
	quotedText, err := json.Marshal(request.Text)
	if err != nil {
		return "", fmt.Errorf("encode tutor input: %w", err)
	}
	learning := languageTutorLabel(request.Languages.Names, request.Learning)
	source := fmt.Sprintf("<source_text>%s</source_text>", quotedText)
	explanation := languageTutorLabel(request.Languages.Names, request.Explanation)
	if request.Mode == languageTutorModeDraft {
		return fmt.Sprintf(`Learning language: %s. Explanation language: %s. The source text is an outgoing draft. Return its corrected form in the learning language: if it is already in the learning language, correct its grammar, spelling, and word choice; otherwise translate it. Ignore missing diacritics that come from keyboard limits. Then give translation: the meaning of corrected_text in the explanation language, so the learner can confirm what they are sending. Leave translation empty when the explanation language is the learning language. Return no other text.

Return exactly this JSON object and nothing else:
{"detected_language":"<ISO 639-1 code of the source text>","corrected_text":"<result in the learning language>","translation":"<meaning of corrected_text in the explanation language, or an empty string>"}

Source text (JSON string inside <source_text> tags):
%s`, learning, explanation, source), nil
	}
	return fmt.Sprintf(`Learning language: %s. Explanation language: %s. The source text is an incoming message the learner wants to understand.

Return exactly this JSON object and nothing else:
{"detected_language":"<ISO 639-1 code of the source text>","corrected_text":"<corrected text when the source is already in the learning language, otherwise an empty string>","translation":"<translation in the explanation language>","grammar_notes":["<up to two brief notes when the source is in the learning language, otherwise an empty array>"],"vocabulary":[{"term":"<useful word or phrase from the source when it is in the learning language>","meaning":"<meaning in the explanation language>","example":"<natural example in the learning language>"}]}

Source text (JSON string inside <source_text> tags):
%s`, learning, explanation, source), nil
}

func parseTutorAnalysis(response string, request languageTutorRequest) (TutorAnalysis, error) {
	var lastErr error
	for _, candidate := range tutorJSONObjects(response) {
		var analysis TutorAnalysis
		if err := json.Unmarshal([]byte(candidate), &analysis); err != nil {
			lastErr = err
			continue
		}
		if err := normalizeTutorAnalysis(&analysis, request); err != nil {
			lastErr = err
			continue
		}
		return analysis, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no complete JSON object found")
	}
	return TutorAnalysis{}, fmt.Errorf("decode Language Tutor response: %w", lastErr)
}

func tutorJSONObjects(response string) []string {
	var objects []string
	start := -1
	depth := 0
	inString := false
	escaped := false
	for index, char := range response {
		if start == -1 {
			if char == '{' {
				start = index
				depth = 1
			}
			continue
		}
		if inString {
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			continue
		}
		switch char {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				objects = append(objects, response[start:index+1])
				start = -1
			}
		}
	}
	return objects
}

// detectedLanguageCode accepts a language code, an English name, or a tag whose primary subtag is 2 or 3 letters.
func detectedLanguageCode(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if code, supported := sharedpreferences.TutorLanguageCode(value); supported {
		return code, true
	}
	lower := strings.ToLower(value)
	primary, _, _ := strings.Cut(lower, "-")
	if len(primary) >= 2 && len(primary) <= 3 && isASCIILetters(primary) {
		return lower, true
	}
	return "", false
}

// sameLanguage reports whether two codes name the same language, ignoring region subtags such as pt-BR.
func sameLanguage(a, b string) bool {
	primaryA, _, _ := strings.Cut(strings.ToLower(a), "-")
	primaryB, _, _ := strings.Cut(strings.ToLower(b), "-")
	return primaryA == primaryB
}

func normalizeTutorAnalysis(analysis *TutorAnalysis, request languageTutorRequest) error {
	detected, ok := detectedLanguageCode(analysis.DetectedLanguage)
	if !ok {
		return errors.New("Language Tutor returned an unsupported detected language")
	}
	analysis.DetectedLanguage = detected
	analysis.CorrectedText = strings.TrimSpace(analysis.CorrectedText)
	analysis.Translation = strings.TrimSpace(analysis.Translation)
	analysis.GrammarNotes = normalizeTutorGrammarNotes(analysis.GrammarNotes)
	analysis.Vocabulary = normalizeTutorVocabulary(analysis.Vocabulary)
	if request.Mode == languageTutorModeMessage && analysis.Translation == "" {
		return errors.New("Language Tutor returned no translation")
	}
	if request.Mode == languageTutorModeDraft {
		analysis.CorrectedText = unwrapTutorQuotes(analysis.CorrectedText)
		// Drafts ask only for corrected text and its translation, so drop notes and vocabulary a model returns anyway.
		analysis.GrammarNotes = nil
		analysis.Vocabulary = nil
		// The translation exists to confirm meaning, so it is useless when it would repeat the learning language.
		if sameLanguage(request.Explanation, request.Learning) {
			analysis.Translation = ""
		} else if analysis.Translation == "" {
			return errors.New("Language Tutor returned no translation")
		}
		// A draft in another language must be translated; returning the source unchanged is a failed reply.
		if !sameLanguage(detected, request.Learning) && analysis.CorrectedText == strings.TrimSpace(request.Text) {
			return errors.New("Language Tutor returned the draft without translating it")
		}
	}
	// Drafts and learning-language text need a corrected form. Other text gets only a translation.
	needsCorrection := request.Mode == languageTutorModeDraft || sameLanguage(detected, request.Learning)
	if !needsCorrection {
		analysis.CorrectedText = ""
		analysis.TextToInsert = ""
		analysis.GrammarNotes = nil
		analysis.Vocabulary = nil
		return nil
	}
	if analysis.CorrectedText == "" {
		return errors.New("Language Tutor returned no corrected text")
	}
	// Only drafts can replace the composer. Incoming messages are never inserted.
	analysis.TextToInsert = ""
	if request.Mode == languageTutorModeDraft {
		analysis.TextToInsert = analysis.CorrectedText
	}
	return nil
}

func normalizeTutorGrammarNotes(notes []string) []string {
	cleaned := make([]string, 0, min(len(notes), 2))
	for _, note := range notes {
		if note = strings.TrimSpace(note); note != "" {
			cleaned = append(cleaned, note)
			if len(cleaned) == 2 {
				break
			}
		}
	}
	return cleaned
}

func normalizeTutorVocabulary(items []TutorVocabularyItem) []TutorVocabularyItem {
	cleaned := make([]TutorVocabularyItem, 0, min(len(items), 3))
	for _, item := range items {
		item.Term = strings.TrimSpace(item.Term)
		item.Meaning = strings.TrimSpace(item.Meaning)
		item.Example = strings.TrimSpace(item.Example)
		if item.Term == "" || item.Meaning == "" || item.Example == "" {
			continue
		}
		cleaned = append(cleaned, item)
		if len(cleaned) == 3 {
			break
		}
	}
	return cleaned
}

// unwrapTutorQuotes removes one pair of quote marks that wrap the whole reply. Small models add them around echoed JSON strings.
func unwrapTutorQuotes(text string) string {
	for _, pair := range [][2]string{{`"`, `"`}, {"\u201c", "\u201d"}, {"\u00ab", "\u00bb"}} {
		if len(text) >= len(pair[0])+len(pair[1]) && strings.HasPrefix(text, pair[0]) && strings.HasSuffix(text, pair[1]) {
			return strings.TrimSpace(text[len(pair[0]) : len(text)-len(pair[1])])
		}
	}
	return text
}

func isASCIILetters(value string) bool {
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') {
			return false
		}
	}
	return true
}
