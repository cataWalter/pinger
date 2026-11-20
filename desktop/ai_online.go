package desktop

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/zalando/go-keyring"

	sharedpreferences "mychat/preferences"
)

const (
	aiProviderPreference       = "ai.provider"
	aiProviderLocal            = "local"
	aiProviderOnline           = "online"
	aiOnlineEndpointPreference = "ai.online.endpoint"
	aiOnlineModelPreference    = "ai.online.model"
	aiOnlineConsentPreference  = "ai.online.consent_endpoint"
	aiOnlineDefaultEndpoint    = "https://openrouter.ai/api/v1"
	aiOnlineKeychainService    = "pinger"
	aiOnlineKeychainAccount    = "online-ai:"
)

// normalizeOnlineAIEndpoint validates an online endpoint and returns it in the form used for consent,
// along with its lowercased host, which names the keychain entry for its API key.
func normalizeOnlineAIEndpoint(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if err := sharedpreferences.ValidateOnlineAIEndpoint(raw); err != nil {
		return "", "", err
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", "", errors.New("online AI endpoint must be an https URL")
	}
	parsed.Host = strings.ToLower(parsed.Host)
	return strings.TrimRight(parsed.String(), "/"), parsed.Host, nil
}

// aiOnlineEndpointSetting returns the normalized online endpoint, or the OpenRouter endpoint when none is set.
func aiOnlineEndpointSetting(preferences map[string]any) (string, string, error) {
	return normalizeOnlineAIEndpoint(stringPreference(preferences, aiOnlineEndpointPreference, aiOnlineDefaultEndpoint))
}

// aiOnlineConsented reports whether the user allowed online requests to endpoint. Changing the endpoint revokes consent.
func aiOnlineConsented(preferences map[string]any, endpoint string) bool {
	consented, _, err := normalizeOnlineAIEndpoint(stringPreference(preferences, aiOnlineConsentPreference, ""))
	return err == nil && consented == endpoint
}

func aiOnlineKeyAccount(host string) string {
	return aiOnlineKeychainAccount + host
}

// loadOnlineAIKey returns the API key saved for host.
func loadOnlineAIKey(host string) (string, error) {
	key, err := keyring.Get(aiOnlineKeychainService, aiOnlineKeyAccount(host))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", errors.New("add an API key for the online AI service in Settings > AI")
	}
	if err != nil {
		return "", fmt.Errorf("read online AI key from the keychain: %w", err)
	}
	return key, nil
}

// SetOnlineAIKey saves the API key for the online AI endpoint in the OS keychain. The key is never returned to the UI.
func (s *AppService) SetOnlineAIKey(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("enter an API key")
	}
	_, host, err := aiOnlineEndpointSetting(s.preferenceValues())
	if err != nil {
		return err
	}
	if err := keyring.Set(aiOnlineKeychainService, aiOnlineKeyAccount(host), key); err != nil {
		return fmt.Errorf("save online AI key to the keychain: %w", err)
	}
	return nil
}

// ClearOnlineAIKey removes the API key saved for the online AI endpoint.
func (s *AppService) ClearOnlineAIKey() error {
	_, host, err := aiOnlineEndpointSetting(s.preferenceValues())
	if err != nil {
		return err
	}
	err = keyring.Delete(aiOnlineKeychainService, aiOnlineKeyAccount(host))
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("remove online AI key from the keychain: %w", err)
	}
	return nil
}

// OnlineAIKeyStored reports whether an API key is saved for the online AI endpoint.
func (s *AppService) OnlineAIKeyStored() (bool, error) {
	_, host, err := aiOnlineEndpointSetting(s.preferenceValues())
	if err != nil {
		return false, err
	}
	_, err = keyring.Get(aiOnlineKeychainService, aiOnlineKeyAccount(host))
	if errors.Is(err, keyring.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read online AI key from the keychain: %w", err)
	}
	return true, nil
}

// onlineAIClient sends requests only over HTTPS to one host and adds the API key to each of them.
// Redirects are not followed, so the key cannot be forwarded to another host.
func onlineAIClient(host, key string) *http.Client {
	return &http.Client{
		Transport: &onlineAITransport{host: strings.ToLower(host), key: key, base: http.DefaultTransport},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

type onlineAITransport struct {
	host string
	key  string
	base http.RoundTripper
}

func (t *onlineAITransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme != "https" || strings.ToLower(request.URL.Host) != t.host {
		return nil, errors.New("online AI requests may only go to the configured HTTPS endpoint")
	}
	clone := request.Clone(request.Context())
	clone.Header.Set("Authorization", "Bearer "+t.key)
	return t.base.RoundTrip(clone)
}
