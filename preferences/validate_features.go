package preferences

import (
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// validateKnownLanguages checks ai.known_languages, a JSON array of distinct language codes from languages.
func validateKnownLanguages(value any, languages LanguageLookup) error {
	serialized, ok := value.(string)
	if !ok {
		return errors.New("AI known languages must be a JSON string")
	}
	var codes []string
	if err := json.Unmarshal([]byte(serialized), &codes); err != nil {
		return errors.New("AI known languages must be a JSON array of language codes")
	}
	if len(codes) == 0 || len(codes) > len(languages) {
		return fmt.Errorf("AI known languages must contain 1 to %d languages", len(languages))
	}
	seen := make(map[string]bool, len(codes))
	for _, code := range codes {
		if _, known := languages[code]; !known {
			return errors.New("AI known languages contains an unsupported language")
		}
		if seen[code] {
			return errors.New("AI known languages must not repeat a language")
		}
		seen[code] = true
	}
	return nil
}

// aiFeatureIDs lists the AI features whose prompt, temperature, and token limit can be tuned from settings.
// The IDs must match the feature catalog in desktop/ai_settings.go and frontend/src/aiSettings.ts.
var aiFeatureIDs = map[string]bool{
	"local_chat":            true,
	"language_tutor":        true,
	"suggested_replies":     true,
	"improve_draft":         true,
	"ask_ai":                true,
	"summarize":             true,
	"draft_reply":           true,
	"continue_conversation": true,
	"rewrite":               true,
	"shorten":               true,
	"explain":               true,
	"topics":                true,
	"conversation_analysis": true,
	"agent":                 true,
	"chat_translation":      true,
	"tone_guard":            true,
}

const (
	aiFeatureMaxPromptRunes = 8000
	aiFeatureMinTemperature = 0.6
	aiFeatureMaxTemperature = 2
	aiFeatureMaxTokens      = 8192
)

// validateAIFeaturePreference checks ai.feature.<id>.prompt, ai.feature.<id>.temperature, and ai.feature.<id>.max_tokens.
// Numeric values are stored as strings. An empty temperature or token limit keeps the built-in default.
func validateAIFeaturePreference(key string, value any) error {
	rest := strings.TrimPrefix(key, "ai.feature.")
	dot := strings.LastIndexByte(rest, '.')
	if dot <= 0 || !aiFeatureIDs[rest[:dot]] {
		return fmt.Errorf("unknown AI feature preference %q", key)
	}
	text, ok := value.(string)
	if !ok {
		return fmt.Errorf("preference %q must be a string", key)
	}
	switch rest[dot+1:] {
	case "prompt":
		if utf8.RuneCountInString(text) > aiFeatureMaxPromptRunes {
			return fmt.Errorf("AI prompt must be %d characters or fewer", aiFeatureMaxPromptRunes)
		}
	case "temperature":
		if text == "" {
			return nil
		}
		temperature, err := strconv.ParseFloat(text, 64)
		if err != nil || !(temperature >= aiFeatureMinTemperature && temperature <= aiFeatureMaxTemperature) {
			return errors.New("AI temperature must be a number from 0.6 to 2")
		}
	case "max_tokens":
		if text == "" {
			return nil
		}
		tokens, err := strconv.Atoi(text)
		if err != nil || tokens < 0 || tokens > aiFeatureMaxTokens {
			return fmt.Errorf("AI max tokens must be a whole number from 0 to %d", aiFeatureMaxTokens)
		}
	default:
		return fmt.Errorf("unknown AI feature preference %q", key)
	}
	return nil
}

func validateEmoticonReplacements(value any) error {
	const maxBytes, maxEntries, maxRunes = 8192, 64, 16
	serialized, ok := value.(string)
	if !ok || len(serialized) > maxBytes {
		return errors.New("emoji.emoticon_replacements must be a JSON string of at most 8192 bytes")
	}
	var replacements [][]string
	if err := json.Unmarshal([]byte(serialized), &replacements); err != nil {
		return fmt.Errorf("invalid emoticon replacement JSON: %w", err)
	}
	if len(replacements) > maxEntries {
		return fmt.Errorf("emoticon replacements may contain at most %d pairs", maxEntries)
	}
	seen := make(map[string]struct{}, len(replacements))
	for _, pair := range replacements {
		if len(pair) != 2 {
			return errors.New("each emoticon replacement must contain a symbol and emoji")
		}
		symbol, emoji := pair[0], pair[1]
		if symbol == "" || strings.TrimSpace(symbol) != symbol || strings.IndexFunc(symbol, unicode.IsSpace) >= 0 || utf8.RuneCountInString(symbol) > maxRunes {
			return errors.New("emoticon symbols must contain 1 to 16 non-space characters")
		}
		if emoji == "" || strings.TrimSpace(emoji) != emoji || strings.IndexFunc(emoji, unicode.IsSpace) >= 0 || utf8.RuneCountInString(emoji) > maxRunes {
			return errors.New("emoticon replacements must contain 1 to 16 non-space characters")
		}
		if _, duplicate := seen[symbol]; duplicate {
			return errors.New("emoticon replacement symbols must be unique")
		}
		seen[symbol] = struct{}{}
	}
	return nil
}

// validateAIAgentCollection checks a serialized list of chat agent profiles and their default selection.
func validateAIAgentCollection(serialized string) error {
	const (
		maxBytes       = 32_768
		maxAgents      = 8
		maxIDRunes     = 64
		maxNameRunes   = 48
		maxPromptRunes = 2_000
	)
	if len(serialized) > maxBytes {
		return errors.New("AI-agent data exceeds the size limit")
	}
	var collection struct {
		Agents []struct {
			ID           string `json:"id"`
			Name         string `json:"name"`
			Instructions string `json:"instructions"`
		} `json:"agents"`
		DefaultAgentID *string `json:"defaultAgentId"`
	}
	if err := json.Unmarshal([]byte(serialized), &collection); err != nil {
		return fmt.Errorf("invalid AI-agent JSON: %w", err)
	}
	if collection.Agents == nil || collection.DefaultAgentID == nil {
		return errors.New("AI-agent data must include agents and defaultAgentId")
	}
	if len(collection.Agents) > maxAgents {
		return fmt.Errorf("AI-agent data may contain at most %d profiles", maxAgents)
	}
	ids := make(map[string]struct{}, len(collection.Agents))
	for _, agent := range collection.Agents {
		if agent.ID == "" || utf8.RuneCountInString(agent.ID) > maxIDRunes {
			return errors.New("AI-agent IDs must contain 1 to 64 characters")
		}
		if _, duplicate := ids[agent.ID]; duplicate {
			return errors.New("AI-agent IDs must be unique")
		}
		ids[agent.ID] = struct{}{}
		if strings.TrimSpace(agent.Name) == "" || utf8.RuneCountInString(agent.Name) > maxNameRunes {
			return errors.New("AI-agent names must contain 1 to 48 characters")
		}
		if strings.TrimSpace(agent.Instructions) == "" || utf8.RuneCountInString(agent.Instructions) > maxPromptRunes {
			return errors.New("AI-agent instructions must contain 1 to 2000 characters")
		}
	}
	if defaultID := *collection.DefaultAgentID; defaultID != "" {
		if _, exists := ids[defaultID]; !exists {
			return errors.New("default AI-agent must match a saved profile")
		}
	}
	return nil
}

func oneOf(value any, choices ...string) bool {
	actual, ok := value.(string)
	if !ok {
		return false
	}
	for _, choice := range choices {
		if actual == choice {
			return true
		}
	}
	return false
}

func isHexColor(value any) bool {
	text, ok := value.(string)
	if !ok || len(text) != 7 || text[0] != '#' {
		return false
	}
	for _, r := range text[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}

func validEmojiList(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	fields := strings.Fields(text)
	if len(fields) < 1 || len(fields) > 6 {
		return false
	}
	for _, field := range fields {
		if len(field) > 32 {
			return false
		}
	}
	return true
}

func validScheduleSuggestions(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	parts := strings.Split(text, ",")
	if len(parts) < 1 || len(parts) > 6 {
		return false
	}
	seen := make(map[int]struct{}, len(parts))
	for _, part := range parts {
		minutes, err := time.ParseDuration(strings.TrimSpace(part) + "m")
		if err != nil || minutes < time.Minute || minutes > 10080*time.Minute {
			return false
		}
		value := int(minutes / time.Minute)
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func validScheduleDelay(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	minutes, err := time.ParseDuration(text + "m")
	return err == nil && minutes >= time.Minute && minutes <= 10080*time.Minute
}

func validArchiveAgeDays(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	days, err := strconv.Atoi(text)
	return err == nil && days >= 1 && days <= 3650
}
