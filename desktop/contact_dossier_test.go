package desktop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestShouldAnalyzeContactDossier(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-contactDossierReanalyzeAfter + time.Minute).UnixMilli()
	if shouldAnalyzeContactDossier(now, fresh, contactDossierNewMessageGate) {
		t.Fatal("dossier refreshed before 24 hours or 11 new messages")
	}
	if !shouldAnalyzeContactDossier(now, now.Add(-contactDossierReanalyzeAfter).UnixMilli(), 0) {
		t.Fatal("dossier did not refresh after 24 hours")
	}
	if !shouldAnalyzeContactDossier(now, fresh, contactDossierNewMessageGate+1) {
		t.Fatal("dossier did not refresh after 11 new messages")
	}
	if !shouldAnalyzeContactDossier(now, 0, 0) {
		t.Fatal("new dossier was not marked for initial analysis")
	}
}

func TestContactDossierNewMessageCount(t *testing.T) {
	start := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	messages := make([]relationshipHealthMessage, 12)
	for index := range messages {
		messages[index] = relationshipHealthMessage{MessageID: string(rune('a' + index)), Timestamp: start.Add(time.Duration(index) * time.Minute)}
	}
	if count := contactDossierNewMessageCount(messages, "b", 0); count != 10 {
		t.Fatalf("new messages after b = %d, want 10", count)
	}
	if count := contactDossierNewMessageCount(messages, "a", 0); count != 11 {
		t.Fatalf("new messages after a = %d, want 11", count)
	}
	if count := contactDossierNewMessageCount(messages, "older-checkpoint", start.Add(-time.Minute).UnixMilli()); count != 12 {
		t.Fatalf("new messages after an evicted checkpoint = %d, want 12", count)
	}
}

func TestContactDossierWriteRequiresCurrentLinkedRooms(t *testing.T) {
	store, err := openRelationshipHealthStore(filepath.Join(t.TempDir(), "relationship-health.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()
	roomID := "!dossier:example.org"
	contactID, err := store.ensureContact(roomID, "Dossier")
	if err != nil {
		t.Fatal(err)
	}
	cache := contactDossierCache{ContactID: contactID, KeyFacts: []string{"Location: Berlin"}, UpdatedAt: 1}
	saved, err := store.saveContactDossierForLinkedRooms(contactID, roomID, []string{"!stale:example.org"}, cache)
	if err != nil || saved {
		t.Fatalf("stale dossier write = saved %v, error %v", saved, err)
	}
	if _, found, err := store.readContactDossier(contactID); err != nil || found {
		t.Fatalf("stale cache found = %v, error = %v", found, err)
	}
	saved, err = store.saveContactDossierForLinkedRooms(contactID, roomID, []string{roomID}, cache)
	if err != nil || !saved {
		t.Fatalf("current dossier write = saved %v, error %v", saved, err)
	}
}

func TestMergeContactDossierUpdatesStableFactLabels(t *testing.T) {
	existing := contactDossierCache{
		KeyFacts:  []string{"Location: Madrid", "Programming language: Rust", "Pet (Milo): cat"},
		LastRecap: "Older recap.", UnresolvedCommitments: []string{"Send the apartment listing"},
	}
	merged := mergeContactDossier(existing, contactDossierResult{
		KeyFacts:              []string{"Location: Berlin", "Favorite drink: tea"},
		LastRecap:             "They discussed the move. They will compare apartment listings next week.",
		UnresolvedCommitments: []string{},
	})
	if !reflect.DeepEqual(merged.KeyFacts, []string{"Location: Berlin", "Programming language: Rust", "Pet (Milo): cat", "Favorite drink: tea"}) {
		t.Fatalf("merged facts = %#v", merged.KeyFacts)
	}
	if merged.LastRecap != "They discussed the move. They will compare apartment listings next week." {
		t.Fatalf("merged recap = %q", merged.LastRecap)
	}
	if len(merged.UnresolvedCommitments) != 0 {
		t.Fatalf("resolved commitments remained: %#v", merged.UnresolvedCommitments)
	}
}

func TestParseContactDossierResult(t *testing.T) {
	valid := `{"key_facts":["Location: Berlin"],"last_recap":"They discussed the move. They agreed to meet next week.","unresolved_commitments":["Send the apartment listing"]}`
	result, err := parseContactDossierResult(valid)
	if err != nil {
		t.Fatalf("parseContactDossierResult() error = %v", err)
	}
	if result.KeyFacts[0] != "Location: Berlin" || result.UnresolvedCommitments[0] != "Send the apartment listing" {
		t.Fatalf("parsed dossier = %+v", result)
	}
	for _, response := range []string{
		`{"key_facts":[],"last_recap":"Recap.","unresolved_commitments":[],"extra":true}`,
		`{"key_facts":[],"last_recap":"Recap."}`,
		valid + ` {}`,
	} {
		if _, err := parseContactDossierResult(response); err == nil {
			t.Fatalf("parseContactDossierResult(%s) unexpectedly succeeded", response)
		}
	}
}

func TestLocalContactDossierCompletionRequestsStructuredOutput(t *testing.T) {
	responseBody := `{"key_facts":["Location: Berlin"],"last_recap":"They discussed the move. They agreed to meet next week.","unresolved_commitments":[]}`
	for _, test := range []struct {
		name     string
		provider GhostwriterProvider
		path     string
	}{
		{name: "Ollama", provider: GhostwriterProviderOllama, path: "/api/generate"},
		{name: "OpenAI-compatible", provider: GhostwriterProviderOpenAICompatible, path: "/v1/chat/completions"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != test.path {
					t.Errorf("request path = %q, want %q", request.URL.Path, test.path)
				}
				var payload map[string]any
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Errorf("decode request payload: %v", err)
				}
				if test.provider == GhostwriterProviderOllama {
					if _, ok := payload["format"].(map[string]any); !ok {
						t.Errorf("Ollama request did not include JSON schema format: %#v", payload["format"])
					}
					_, _ = writer.Write([]byte(`{"response":` + quoteJSON(responseBody) + `}`))
					return
				}
				format, _ := payload["response_format"].(map[string]any)
				if format["type"] != "json_schema" {
					t.Errorf("OpenAI-compatible request format = %#v", format)
				}
				_, _ = writer.Write([]byte(`{"choices":[{"message":{"content":` + quoteJSON(responseBody) + `}}]}`))
			}))
			defer server.Close()
			endpoint, err := url.Parse(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			result, err := localContactDossierCompletion(context.Background(), test.provider, endpoint, "local", "system", "prompt")
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(result) != responseBody {
				t.Fatalf("completion = %q", result)
			}
		})
	}
}

func quoteJSON(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
