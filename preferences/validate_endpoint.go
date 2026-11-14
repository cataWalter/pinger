package preferences

import (
	"errors"
	_ "github.com/mattn/go-sqlite3"
	"net"
	"net/url"
	"strings"
)

func ValidateAIEndpoint(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("AI endpoint must be an http or https URL")
	}
	if parsed.Scheme == "http" {
		host := strings.ToLower(parsed.Hostname())
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return errors.New("AI endpoints outside localhost must use HTTPS")
		}
	}
	return nil
}

// Validate checks one preference against the built-in languages. Set and SetMany also accept
// the custom languages stored in ai.custom_languages.
func Validate(key string, value any) error {
	return validatePreference(key, value, LanguageLookupFor(""))
}
