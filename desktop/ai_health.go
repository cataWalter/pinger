package desktop

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	aiProviderStatusEventName   = "ai:provider_status"
	aiProviderCooldownDuration  = 30 * time.Second
	aiProviderCooldownThreshold = 2
)

// AIProviderHealthStatus describes whether the active AI endpoint is reachable or cooling down after errors.
type AIProviderHealthStatus struct {
	Status        string `json:"status"`
	Provider      string `json:"provider"`
	Endpoint      string `json:"endpoint"`
	Error         string `json:"error,omitempty"`
	FailureCount  int    `json:"failureCount"`
	CooldownUntil int64  `json:"cooldownUntil,omitempty"`
}

type aiProviderState struct {
	provider      AIProvider
	endpoint      string
	status        string
	lastError     string
	failures      int
	cooldownUntil time.Time
}

type aiHealthTracker struct {
	mu     sync.Mutex
	states map[string]*aiProviderState
}

func aiHealthKey(provider AIProvider, endpoint string) string {
	return string(provider) + "|" + endpoint
}

func isAIHealthFailure(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, errAIEmptyResponse) || errors.Is(err, errAIRunStopped) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	var statusErr *aiHTTPStatusError
	if errors.As(err, &statusErr) {
		return statusErr.statusCode >= http.StatusInternalServerError || statusErr.statusCode == http.StatusTooManyRequests
	}
	return true
}

func (t *aiHealthTracker) checkCooldown(provider AIProvider, endpoint string, now time.Time) (AIProviderHealthStatus, bool) {
	if t == nil || endpoint == "" {
		return AIProviderHealthStatus{}, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	state := t.states[aiHealthKey(provider, endpoint)]
	if state == nil || state.status != "cooldown" {
		return AIProviderHealthStatus{}, false
	}
	if !now.Before(state.cooldownUntil) {
		state.status = "degraded"
		state.cooldownUntil = time.Time{}
		return AIProviderHealthStatus{}, false
	}
	return state.snapshot(), true
}

func (t *aiHealthTracker) recordSuccess(provider AIProvider, endpoint string) (AIProviderHealthStatus, bool) {
	if t == nil || endpoint == "" {
		return AIProviderHealthStatus{}, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := aiHealthKey(provider, endpoint)
	state := t.states[key]
	if state == nil || state.status == "healthy" {
		return AIProviderHealthStatus{}, false
	}
	state.status = "healthy"
	state.failures = 0
	state.lastError = ""
	state.cooldownUntil = time.Time{}
	return state.snapshot(), true
}

func (t *aiHealthTracker) recordFailure(provider AIProvider, endpoint string, err error, now time.Time) (AIProviderHealthStatus, bool) {
	if t == nil || endpoint == "" || !isAIHealthFailure(err) {
		return AIProviderHealthStatus{}, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.states == nil {
		t.states = make(map[string]*aiProviderState)
	}
	key := aiHealthKey(provider, endpoint)
	state := t.states[key]
	if state == nil {
		state = &aiProviderState{provider: provider, endpoint: endpoint, status: "healthy"}
		t.states[key] = state
	}
	state.failures++
	state.lastError = err.Error()
	nextStatus := "degraded"
	var cooldownUntil time.Time
	if state.failures >= aiProviderCooldownThreshold {
		nextStatus = "cooldown"
		cooldownUntil = now.Add(aiProviderCooldownDuration)
	}
	changed := state.status != nextStatus || nextStatus == "cooldown"
	state.status = nextStatus
	state.cooldownUntil = cooldownUntil
	return state.snapshot(), changed
}

func (s *aiProviderState) snapshot() AIProviderHealthStatus {
	var until int64
	if !s.cooldownUntil.IsZero() {
		until = s.cooldownUntil.UnixMilli()
	}
	return AIProviderHealthStatus{
		Status:        s.status,
		Provider:      string(s.provider),
		Endpoint:      s.endpoint,
		Error:         s.lastError,
		FailureCount:  s.failures,
		CooldownUntil: until,
	}
}

func (s *AppService) trackAIRoute(route aiRoute) aiRoute {
	route.health = &s.aiHealth
	route.emitStatus = s.emitAIProviderStatus
	return route
}

func (s *AppService) recordAIHealthOutcome(provider AIProvider, endpoint string, err error) {
	var status AIProviderHealthStatus
	var changed bool
	if err == nil {
		status, changed = s.aiHealth.recordSuccess(provider, endpoint)
	} else {
		status, changed = s.aiHealth.recordFailure(provider, endpoint, err, time.Now())
	}
	if changed && s.emitAIProviderStatus != nil {
		s.emitAIProviderStatus(status)
	}
}

func formatCooldownError(status AIProviderHealthStatus) error {
	if status.Error != "" {
		return fmt.Errorf("AI provider %s is temporarily unavailable (%s)", status.Endpoint, status.Error)
	}
	return fmt.Errorf("AI provider %s is temporarily unavailable", status.Endpoint)
}
