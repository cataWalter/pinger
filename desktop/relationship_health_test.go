package desktop

import (
	"strings"
	"testing"
	"time"
)

func TestTrimRelationshipHealthMessagesKeepsLatestThirty(t *testing.T) {
	messages := make([]relationshipHealthMessage, 35)
	for index := range messages {
		messages[index] = relationshipHealthMessage{MessageID: string(rune('a' + index))}
	}

	trimmed := trimRelationshipHealthMessages(messages)
	if len(trimmed) != relationshipHealthHistoryLimit {
		t.Fatalf("trimRelationshipHealthMessages() returned %d messages, want %d", len(trimmed), relationshipHealthHistoryLimit)
	}
	if trimmed[0].MessageID != string(rune('a'+5)) || trimmed[len(trimmed)-1].MessageID != string(rune('a'+34)) {
		t.Fatalf("trimRelationshipHealthMessages() kept IDs %q through %q, want latest range", trimmed[0].MessageID, trimmed[len(trimmed)-1].MessageID)
	}
}

func TestShouldAnalyzeRelationshipHealth(t *testing.T) {
	now := time.Date(2026, time.April, 12, 12, 0, 0, 0, time.UTC)
	lastUpdated := now.Add(-23*time.Hour - time.Minute).UnixMilli()
	if shouldAnalyzeRelationshipHealth(now, lastUpdated, relationshipHealthNewMessageGate) {
		t.Fatal("shouldAnalyzeRelationshipHealth() analyzed before 24 hours or 11 new messages")
	}
	if !shouldAnalyzeRelationshipHealth(now, now.Add(-relationshipHealthReanalyzeAfter).UnixMilli(), 0) {
		t.Fatal("shouldAnalyzeRelationshipHealth() did not analyze after 24 hours")
	}
	if !shouldAnalyzeRelationshipHealth(now, lastUpdated, relationshipHealthNewMessageGate+1) {
		t.Fatal("shouldAnalyzeRelationshipHealth() did not analyze after 11 new messages")
	}
	if !shouldAnalyzeRelationshipHealth(now, 0, 0) {
		t.Fatal("shouldAnalyzeRelationshipHealth() did not analyze an uninitialized contact")
	}
}

func TestBuildRelationshipHealthPromptPreservesLanguageAndLatency(t *testing.T) {
	start := time.Date(2026, time.April, 12, 10, 0, 0, 0, time.UTC)
	messages := []relationshipHealthMessage{
		{RoomID: "!room:example.org", MessageID: "$incoming", Timestamp: start, Text: "¿Llegaste bien?", Channel: "Matrix"},
		{RoomID: "!room:example.org", MessageID: "$reply", Timestamp: start.Add(2 * time.Hour), Own: true, Text: "Sí, gracias", Channel: "Matrix"},
	}
	systemPrompt, userPrompt, err := buildRelationshipHealthPrompt(messages, nil, start.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("buildRelationshipHealthPrompt() error = %v", err)
	}
	if !strings.Contains(systemPrompt, "¿Llegaste bien?") || !strings.Contains(systemPrompt, "Sí, gracias") {
		t.Fatal("buildRelationshipHealthPrompt() did not preserve original-language text")
	}
	if !strings.Contains(systemPrompt, `"response_latency_seconds":7200`) {
		t.Fatal("buildRelationshipHealthPrompt() omitted response latency")
	}
	if !strings.Contains(systemPrompt, "never treat latency alone as evidence of conflict") || !strings.Contains(userPrompt, "last 15 incoming/outgoing exchanges") {
		t.Fatal("buildRelationshipHealthPrompt() omitted conservative analysis instructions")
	}
}

func TestParseRelationshipHealthResultValidatesScoreAndLabels(t *testing.T) {
	valid := `{"sentiment_score":0.4,"status":"WARM","trend":"IMPROVING","detected_friction_points":["short replies"],"reasoning":"More reciprocal replies."}`
	result, err := parseRelationshipHealthResult(valid)
	if err != nil {
		t.Fatalf("parseRelationshipHealthResult() error = %v", err)
	}
	if result.SentimentScore != 0.4 || result.Status != "WARM" {
		t.Fatalf("parseRelationshipHealthResult() = %+v", result)
	}
	for _, response := range []string{
		`{"sentiment_score":1.1,"status":"WARM","trend":"STABLE","detected_friction_points":[],"reasoning":""}`,
		`{"sentiment_score":0,"status":"UNKNOWN","trend":"STABLE","detected_friction_points":[],"reasoning":""}`,
	} {
		if _, err := parseRelationshipHealthResult(response); err == nil {
			t.Fatalf("parseRelationshipHealthResult(%s) unexpectedly succeeded", response)
		}
	}
}
