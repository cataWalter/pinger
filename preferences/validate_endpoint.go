package preferences

import (
	"errors"
	_ "github.com/mattn/go-sqlite3"
	"net/url"
	"strings"
)

func ValidateOnlineAIEndpoint(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("online AI endpoint must be an HTTPS URL without credentials, query, or fragment")
	}
	return nil
}

// Validate checks one preference against the built-in languages. Set and SetMany also accept
// the custom languages stored in ai.custom_languages.
func Validate(key string, value any) error {
	return validatePreference(key, value, LanguageLookupFor(""))
}
