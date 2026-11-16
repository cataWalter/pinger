package desktop

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	sharedpreferences "mychat/preferences"
)

const (
	aiDefaultOllamaURL   = "http://127.0.0.1:11434"
	aiDefaultOllamaModel = "qwen2.5:3b"
)

// aiLocalHTTPClient only reaches loopback addresses, never follows redirects, and ignores proxies.
var aiLocalHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy:       nil,
		DialContext: dialLocalAILoopback,
	},
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func dialLocalAILoopback(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid local AI address: %w", err)
	}
	var addresses []net.IPAddr
	if ip := net.ParseIP(host); ip != nil {
		addresses = []net.IPAddr{{IP: ip}}
	} else {
		addresses, err = net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("resolve local AI address: %w", err)
		}
	}
	if len(addresses) == 0 {
		return nil, errors.New("local AI address resolved to no IPs")
	}
	for _, address := range addresses {
		if !address.IP.IsLoopback() {
			return nil, errors.New("local AI address resolved outside loopback")
		}
	}

	dialer := net.Dialer{}
	var lastErr error
	for _, address := range addresses {
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	return nil, fmt.Errorf("connect to local AI endpoint: %w", lastErr)
}

type AIProvider string

const (
	AIProviderOllama           AIProvider = "ollama"
	AIProviderOpenAICompatible AIProvider = "openai-compatible"
)

func stringPreference(preferences map[string]any, key, fallback string) string {
	value, _ := preferences[key].(string)
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// aiModelConfig uses the shared AI endpoint when it is a valid loopback URL, and otherwise a local Ollama server.
func aiModelConfig(preferences map[string]any) (AIProvider, *url.URL, string, error) {
	if sharedEndpoint := strings.TrimSpace(stringPreference(preferences, "ai.endpoint", "")); sharedEndpoint != "" {
		if localEndpoint, err := parseAIEndpointURL(sharedEndpoint); err == nil {
			return AIProviderOpenAICompatible, localEndpoint, strings.TrimSpace(stringPreference(preferences, "ai.model", "")), nil
		}
	}
	localEndpoint, err := parseAIEndpointURL(aiDefaultOllamaURL)
	if err != nil {
		return "", nil, "", err
	}
	return AIProviderOllama, localEndpoint, aiDefaultOllamaModel, nil
}

func parseAIEndpointURL(raw string) (*url.URL, error) {
	if err := sharedpreferences.ValidateLocalHTTPEndpoint(raw); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, errors.New("AI endpoint must be a localhost HTTP URL")
	}
	if strings.EqualFold(parsed.Hostname(), "localhost") {
		parsed.Host = net.JoinHostPort("127.0.0.1", parsed.Port())
		if parsed.Port() == "" {
			parsed.Host = "127.0.0.1"
		}
	}
	parsed.Path = ""
	parsed.RawPath = ""
	return parsed, nil
}
