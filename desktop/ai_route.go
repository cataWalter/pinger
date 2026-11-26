package desktop

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"mychat/logging"
)

// aiRoute is the provider, endpoint, and model one AI call uses.
type aiRoute struct {
	client     *http.Client
	provider   AIProvider
	endpoint   string
	model      string
	health     *aiHealthTracker
	emitStatus func(AIProviderHealthStatus)
}

// aiLocalRoute targets the loopback endpoint in ai.endpoint. Voice transcription, image generation, and tone checks always use it.
func aiLocalRoute(preferences map[string]any) (aiRoute, error) {
	endpoint := strings.TrimSpace(stringPreference(preferences, "ai.endpoint", ""))
	if endpoint == "" {
		return aiRoute{}, errors.New("set an AI endpoint in Settings > AI")
	}
	parsed, err := parseAIEndpointURL(endpoint)
	if err != nil {
		return aiRoute{}, errors.New("the AI endpoint must be a localhost HTTP URL in Settings > AI")
	}
	return aiRoute{
		client:   aiLocalHTTPClient,
		provider: AIProviderOpenAICompatible,
		endpoint: parsed.String(),
		model:    strings.TrimSpace(stringPreference(preferences, "ai.model", "")),
	}, nil
}

// aiOnlineRoute targets the online service in ai.online.*. It requires consent to that endpoint, a model, and a saved key.
func aiOnlineRoute(preferences map[string]any) (aiRoute, error) {
	endpoint, host, err := aiOnlineEndpointSetting(preferences)
	if err != nil {
		return aiRoute{}, err
	}
	if !aiOnlineConsented(preferences, endpoint) {
		return aiRoute{}, errors.New("allow online AI in Settings > AI before sending requests to it")
	}
	model := strings.TrimSpace(stringPreference(preferences, aiOnlineModelPreference, ""))
	if model == "" {
		return aiRoute{}, errors.New("set an online AI model in Settings > AI")
	}
	key, err := loadOnlineAIKey(host)
	if err != nil {
		return aiRoute{}, err
	}
	return aiRoute{client: onlineAIClient(host, key), provider: AIProviderOnline, endpoint: endpoint, model: model}, nil
}

// aiFeatureRoute sends text features such as suggested replies, the Language Tutor, and AIComplete to the provider in ai.provider.
func aiFeatureRoute(preferences map[string]any) (aiRoute, error) {
	if stringPreference(preferences, aiProviderPreference, aiProviderLocal) == aiProviderOnline {
		return aiOnlineRoute(preferences)
	}
	return aiLocalRoute(preferences)
}

// aiChatRoute sends chat to the provider in ai.provider. Local chat falls back to Ollama when ai.endpoint is unset.
// Online chat never falls back, so a failed online request is reported instead of being answered locally.
func aiChatRoute(preferences map[string]any) (aiRoute, error) {
	if stringPreference(preferences, aiProviderPreference, aiProviderLocal) == aiProviderOnline {
		return aiOnlineRoute(preferences)
	}
	provider, endpoint, model, err := aiModelConfig(preferences)
	if err != nil {
		return aiRoute{}, err
	}
	return aiRoute{client: aiLocalHTTPClient, provider: provider, endpoint: endpoint.String(), model: model}, nil
}

// complete runs one request on the route.
func (r aiRoute) complete(ctx context.Context, messages []AIMessage, options aiCompletionOptions, onChunk func(string)) (string, error) {
	if r.health != nil {
		if status, coolingDown := r.health.checkCooldown(r.provider, r.endpoint, time.Now()); coolingDown {
			return "", formatCooldownError(status)
		}
	}
	startedAt := time.Now()
	result, err := aiProviderCompletion(ctx, r.client, r.provider, r.endpoint, r.model, messages, options, onChunk)
	if r.health != nil {
		var status AIProviderHealthStatus
		var changed bool
		if err == nil {
			status, changed = r.health.recordSuccess(r.provider, r.endpoint)
		} else {
			status, changed = r.health.recordFailure(r.provider, r.endpoint, err, time.Now())
		}
		if changed && r.emitStatus != nil {
			r.emitStatus(status)
		}
	}
	outcome := "success"
	if err != nil {
		switch {
		case errors.Is(ctx.Err(), context.Canceled):
			outcome = "canceled"
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			outcome = "timeout"
		default:
			outcome = "failed"
		}
	}
	logging.For("ai").Debug().Bool("online", r.provider == AIProviderOnline).
		Str("outcome", outcome).Dur("duration_ms", time.Since(startedAt)).Msg("text completion finished")
	return result, err
}
