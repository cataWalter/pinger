package desktop

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestAIHealthTrackerCooldownAndRecovery(t *testing.T) {
	var tracker aiHealthTracker
	now := time.Date(2026, time.November, 26, 12, 0, 0, 0, time.UTC)

	if _, cool := tracker.checkCooldown(AIProviderOpenAICompatible, "http://127.0.0.1:8080", now); cool {
		t.Fatal("fresh tracker entered cooldown")
	}

	// User cancellation must not mark provider unhealthy.
	if _, changed := tracker.recordFailure(AIProviderOpenAICompatible, "http://127.0.0.1:8080", context.Canceled, now); changed {
		t.Fatal("canceled request changed provider health")
	}

	status, changed := tracker.recordFailure(AIProviderOpenAICompatible, "http://127.0.0.1:8080", errors.New("connection refused"), now)
	if !changed || status.Status != "degraded" || status.FailureCount != 1 {
		t.Fatalf("first failure = %+v (changed=%v), want degraded count=1", status, changed)
	}

	status, changed = tracker.recordFailure(AIProviderOpenAICompatible, "http://127.0.0.1:8080", errors.New("connection refused"), now.Add(time.Second))
	if !changed || status.Status != "cooldown" || status.FailureCount != 2 {
		t.Fatalf("second failure = %+v (changed=%v), want cooldown count=2", status, changed)
	}

	if _, cool := tracker.checkCooldown(AIProviderOpenAICompatible, "http://127.0.0.1:8080", now.Add(5*time.Second)); !cool {
		t.Fatal("expected provider to be in cooldown")
	}
	if _, cool := tracker.checkCooldown(AIProviderOpenAICompatible, "http://127.0.0.1:8080", now.Add(aiProviderCooldownDuration+time.Second)); cool {
		t.Fatal("expected cooldown to expire after duration")
	}

	status, changed = tracker.recordSuccess(AIProviderOpenAICompatible, "http://127.0.0.1:8080")
	if !changed || status.Status != "healthy" || status.FailureCount != 0 {
		t.Fatalf("recovery = %+v (changed=%v), want healthy count=0", status, changed)
	}
}

func TestTrackedAIRouteEnforcesCooldownAndEmitsStatus(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"message":"unavailable"}}`))
	}))
	defer server.Close()

	var emitted []AIProviderHealthStatus
	service := &AppService{
		emitAIProviderStatus: func(status AIProviderHealthStatus) {
			emitted = append(emitted, status)
		},
	}
	route := service.trackAIRoute(aiRoute{
		client:   server.Client(),
		provider: AIProviderOpenAICompatible,
		endpoint: server.URL,
		model:    "test.gguf",
	})

	msgs := []AIMessage{{Role: "user", Content: "hi"}}
	_, _ = route.complete(context.Background(), msgs, aiCompletionOptions{}, nil)
	_, _ = route.complete(context.Background(), msgs, aiCompletionOptions{}, nil)
	// Third call should fail fast due to cooldown without hitting the server.
	_, err := route.complete(context.Background(), msgs, aiCompletionOptions{}, nil)
	if err == nil {
		t.Fatal("expected cooldown error")
	}
	if hits.Load() != 2 {
		t.Fatalf("server hits = %d, want 2 (third call short-circuited)", hits.Load())
	}
	if len(emitted) != 2 || emitted[0].Status != "degraded" || emitted[1].Status != "cooldown" {
		t.Fatalf("emitted statuses = %+v, want [degraded, cooldown]", emitted)
	}
}
