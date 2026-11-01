package matrix

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type slidingSyncRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn slidingSyncRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestSlidingSyncTransportPostsRequestAndTranslatesResponse(t *testing.T) {
	homeserver, err := url.Parse("https://matrix.example")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := NewSlidingSyncManager(homeserver, SlidingSyncConfig{})
	if err != nil {
		t.Fatal(err)
	}
	base := slidingSyncRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.Path != "/_matrix/client/unstable/org.matrix.msc3575/sync" {
			t.Fatalf("unexpected Sliding Sync request: %s %s", request.Method, request.URL)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("authorization header = %q", got)
		}
		var body SlidingSyncRequest
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Pos != "old-position" || body.Timeout != int((30*time.Second).Milliseconds()) {
			t.Fatalf("unexpected request position/timeout: %#v", body)
		}
		if got := body.Lists[defaultSlidingSyncListKey].Ranges; len(got) != 1 || got[0] != [2]int{0, 19} {
			t.Fatalf("unexpected default range: %#v", got)
		}
		roomID := id.RoomID("!room:example.org")
		responseBody, err := json.Marshal(SlidingSyncResponse{
			Pos: "new-position",
			Rooms: map[id.RoomID]SlidingSyncRoom{
				roomID: {Timeline: SlidingSyncTimeline{Events: []*event.Event{{ID: "$event"}}}},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(string(responseBody))),
			Request:    request,
		}, nil
	})
	legacyRequest, err := http.NewRequest(http.MethodGet, "https://matrix.example/_matrix/client/v3/sync?since=old-position&timeout=30000", nil)
	if err != nil {
		t.Fatal(err)
	}
	legacyRequest.Header.Set("Authorization", "Bearer test-token")
	response, err := (&slidingSyncTransport{manager: manager, base: base}).RoundTrip(legacyRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("translated response status = %d", response.StatusCode)
	}
	var syncResponse mautrix.RespSync
	if err = json.NewDecoder(response.Body).Decode(&syncResponse); err != nil {
		t.Fatal(err)
	}
	if syncResponse.NextBatch != "new-position" || len(syncResponse.Rooms.Join) != 1 {
		t.Fatalf("unexpected translated response: %#v", syncResponse)
	}
	if manager.State().Pos != "new-position" {
		t.Fatalf("stored position = %q", manager.State().Pos)
	}
}

func TestSlidingSyncTransportFallsBackToStandardSync(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		statusCode int
		body       string
		fallback   bool
	}{
		{"not found", http.StatusNotFound, `{"errcode":"M_UNRECOGNIZED","error":"Unrecognized request"}`, true},
		{"method not allowed", http.StatusMethodNotAllowed, "Method Not Allowed", true},
		{"not implemented", http.StatusNotImplemented, "", true},
		{"unrecognized endpoint", http.StatusBadRequest, `{"errcode":"M_UNRECOGNIZED","error":"Unrecognized request"}`, true},
		{"missing endpoint", http.StatusBadRequest, `{"errcode":"M_NOT_FOUND","error":"Unknown endpoint"}`, true},
		{"invalid request", http.StatusBadRequest, `{"errcode":"M_INVALID_PARAM","error":"Invalid list"}`, false},
		{"malformed error", http.StatusBadRequest, "not JSON", false},
		{"invalid token", http.StatusUnauthorized, `{"errcode":"M_UNKNOWN_TOKEN","error":"Invalid token"}`, false},
		{"forbidden", http.StatusForbidden, `{"errcode":"M_FORBIDDEN","error":"Forbidden"}`, false},
		{"rate limited", http.StatusTooManyRequests, `{"errcode":"M_LIMIT_EXCEEDED","retry_after_ms":1000}`, false},
		{"server failure", http.StatusInternalServerError, `{"errcode":"M_UNKNOWN","error":"Server error"}`, false},
		{"large diagnostic", http.StatusInternalServerError, strings.Repeat("x", slidingSyncLogBodyLimit+100), false},
	} {
		t.Run(testCase.name, func(test *testing.T) {
			homeserver, err := url.Parse("https://matrix.example")
			if err != nil {
				test.Fatal(err)
			}
			manager, err := NewSlidingSyncManager(homeserver, SlidingSyncConfig{})
			if err != nil {
				test.Fatal(err)
			}
			var requestedPaths []string
			base := slidingSyncRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				requestedPaths = append(requestedPaths, request.URL.Path)
				if request.Header.Get("Authorization") != "Bearer test-token" {
					test.Fatal("sync authorization was not preserved")
				}
				if request.URL.Path == "/_matrix/client/unstable/org.matrix.msc3575/sync" {
					return &http.Response{
						StatusCode: testCase.statusCode,
						Header:     make(http.Header),
						Body:       io.NopCloser(strings.NewReader(testCase.body)),
						Request:    request,
					}, nil
				}
				if request.URL.Path != "/_matrix/client/v3/sync" {
					test.Fatalf("unexpected standard sync request path: %s", request.URL.Path)
				}
				if got := request.URL.Query().Get("since"); got != "stored-token" {
					test.Fatalf("standard sync since = %q", got)
				}
				if got := request.URL.Query().Get("filter"); got != "real-filter" {
					test.Fatalf("standard sync filter = %q", got)
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(`{"next_batch":"legacy-token","rooms":{}}`)),
					Request:    request,
				}, nil
			})
			legacyRequest, err := http.NewRequest(http.MethodGet, "https://matrix.example/_matrix/client/v3/sync?since=stored-token&filter=real-filter", nil)
			if err != nil {
				test.Fatal(err)
			}
			legacyRequest.Header.Set("Authorization", "Bearer test-token")
			var logOutput bytes.Buffer
			matrixClient := &mautrix.Client{Client: &http.Client{Transport: base}, Log: zerolog.New(&logOutput)}
			if err = manager.Attach(matrixClient); err != nil {
				test.Fatal(err)
			}
			transport := matrixClient.Client.Transport
			for range 2 {
				response, err := transport.RoundTrip(legacyRequest)
				if err != nil {
					test.Fatal(err)
				}
				body, err := io.ReadAll(response.Body)
				_ = response.Body.Close()
				if err != nil {
					test.Fatal(err)
				}
				if testCase.fallback {
					var syncResponse mautrix.RespSync
					if err = json.Unmarshal(body, &syncResponse); err != nil {
						test.Fatal(err)
					}
					if response.StatusCode != http.StatusOK || syncResponse.NextBatch != "legacy-token" {
						test.Fatalf("standard sync status/batch = %d / %q", response.StatusCode, syncResponse.NextBatch)
					}
				} else if response.StatusCode != testCase.statusCode || string(body) != testCase.body {
					test.Fatalf("sync error changed: %d %s", response.StatusCode, body)
				}
			}
			want := []string{"/_matrix/client/unstable/org.matrix.msc3575/sync", "/_matrix/client/v3/sync", "/_matrix/client/v3/sync"}
			if !testCase.fallback {
				want = []string{"/_matrix/client/unstable/org.matrix.msc3575/sync", "/_matrix/client/unstable/org.matrix.msc3575/sync"}
			}
			if !slices.Equal(requestedPaths, want) || manager.slidingUnsupported.Load() != testCase.fallback {
				test.Fatalf("requested paths = %#v, want %#v; unsupported = %v", requestedPaths, want, manager.slidingUnsupported.Load())
			}
			if strings.Contains(logOutput.String(), "test-token") {
				test.Fatal("sync logs contain the authorization token")
			}
			logCount := 2
			if testCase.fallback {
				logCount = 1
			}
			decoder := json.NewDecoder(&logOutput)
			for range logCount {
				var entry struct {
					StatusCode            int    `json:"status_code"`
					Endpoint              string `json:"endpoint"`
					ResponseBody          string `json:"response_body"`
					ResponseBodyTruncated bool   `json:"response_body_truncated"`
					LegacyFallback        bool   `json:"legacy_fallback"`
				}
				if err = decoder.Decode(&entry); err != nil {
					test.Fatal(err)
				}
				expectedBody := testCase.body[:min(len(testCase.body), slidingSyncLogBodyLimit)]
				if entry.StatusCode != testCase.statusCode || entry.Endpoint != "/_matrix/client/unstable/org.matrix.msc3575/sync" || entry.ResponseBody != expectedBody || entry.ResponseBodyTruncated != (len(testCase.body) > slidingSyncLogBodyLimit) || entry.LegacyFallback != testCase.fallback {
					test.Fatalf("unexpected sync diagnostic: %#v", entry)
				}
			}
			if err = decoder.Decode(&struct{}{}); err != io.EOF {
				test.Fatalf("unexpected extra sync log: %v", err)
			}
		})
	}
}

func TestSlidingSyncTransportRestartsWhenStandardTokenIsRejected(t *testing.T) {
	homeserver, _ := url.Parse("https://matrix.example")
	manager, err := NewSlidingSyncManager(homeserver, SlidingSyncConfig{})
	if err != nil {
		t.Fatal(err)
	}
	var sinceValues []string
	base := slidingSyncRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path == "/_matrix/client/unstable/org.matrix.msc3575/sync" {
			return &http.Response{
				StatusCode: http.StatusNotFound,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"errcode":"M_UNRECOGNIZED","error":"Unrecognized request"}`)),
				Request:    request,
			}, nil
		}
		since := request.URL.Query().Get("since")
		sinceValues = append(sinceValues, since)
		if since != "" {
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"errcode":"M_UNKNOWN","error":"Invalid stream token"}`)),
				Request:    request,
			}, nil
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"next_batch":"fresh-token","rooms":{}}`)),
			Request:    request,
		}, nil
	})
	legacyRequest, err := http.NewRequest(http.MethodGet, "https://matrix.example/_matrix/client/v3/sync?since=stored-token", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := (&slidingSyncTransport{manager: manager, base: base}).RoundTrip(legacyRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if len(sinceValues) != 2 || sinceValues[0] != "stored-token" || sinceValues[1] != "" {
		t.Fatalf("since retry sequence = %#v", sinceValues)
	}
	if !manager.positionReset.Load() {
		t.Fatal("syncer was not notified to process the response as a fresh sync")
	}
	var syncResponse mautrix.RespSync
	if err = json.NewDecoder(response.Body).Decode(&syncResponse); err != nil {
		t.Fatal(err)
	}
	if syncResponse.NextBatch != "fresh-token" {
		t.Fatalf("fresh next batch = %q", syncResponse.NextBatch)
	}
}

func TestSlidingSyncTransportResetsExpiredPosition(t *testing.T) {
	homeserver, _ := url.Parse("https://matrix.example")
	manager, err := NewSlidingSyncManager(homeserver, SlidingSyncConfig{})
	if err != nil {
		t.Fatal(err)
	}
	var requestedPositions []string
	base := slidingSyncRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		var body SlidingSyncRequest
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		requestedPositions = append(requestedPositions, body.Pos)
		if len(requestedPositions) == 1 {
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Body:       io.NopCloser(strings.NewReader(`{"errcode":"M_INVALID_PARAM","error":"Unknown position token"}`)),
			}, nil
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"pos":"fresh-position","lists":{},"rooms":{}}`)),
		}, nil
	})
	legacyRequest, err := http.NewRequest(http.MethodGet, "https://matrix.example/_matrix/client/v3/sync?since=expired-position", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := (&slidingSyncTransport{manager: manager, base: base}).RoundTrip(legacyRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if len(requestedPositions) != 2 || requestedPositions[0] != "expired-position" || requestedPositions[1] != "" {
		t.Fatalf("position retry sequence = %#v", requestedPositions)
	}
	if !manager.positionReset.Load() {
		t.Fatal("syncer was not notified to process the response as a fresh sync")
	}
	var syncResponse mautrix.RespSync
	if err = json.NewDecoder(response.Body).Decode(&syncResponse); err != nil {
		t.Fatal(err)
	}
	if syncResponse.NextBatch != "fresh-position" {
		t.Fatalf("fresh position = %q", syncResponse.NextBatch)
	}
}

func TestSlidingSyncSyncerUsesExponentialFailureBackoff(t *testing.T) {
	manager := &SlidingSyncManager{}
	syncer := slidingSyncSyncer{inner: mautrix.NewDefaultSyncer(), manager: manager}
	for attempt, expected := range []time.Duration{
		time.Second,
		2 * time.Second,
		4 * time.Second,
		8 * time.Second,
		16 * time.Second,
		30 * time.Second,
		30 * time.Second,
	} {
		delay, err := syncer.OnFailedSync(nil, errors.New("temporary network failure"))
		if err != nil {
			t.Fatalf("retry %d returned error: %v", attempt+1, err)
		}
		if delay != expected {
			t.Fatalf("retry %d delay = %s, want %s", attempt+1, delay, expected)
		}
	}
	if err := syncer.ProcessResponse(context.Background(), &mautrix.RespSync{}, ""); err != nil {
		t.Fatalf("process successful response: %v", err)
	}
	if delay, err := syncer.OnFailedSync(nil, errors.New("temporary network failure")); err != nil || delay != time.Second {
		t.Fatalf("backoff after successful response = %s, %v; want 1s, nil", delay, err)
	}
}

func TestSlidingSyncViewportChangeRestartsLongPoll(t *testing.T) {
	homeserver, _ := url.Parse("https://matrix.example")
	manager, err := NewSlidingSyncManager(homeserver, SlidingSyncConfig{})
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{}, 1)
	base := slidingSyncRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	legacyRequest, err := http.NewRequest(http.MethodGet, "https://matrix.example/_matrix/client/v3/sync?since=current-position", nil)
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		response *http.Response
		err      error
	}
	resultChannel := make(chan result, 1)
	go func() {
		response, roundTripErr := (&slidingSyncTransport{manager: manager, base: base}).RoundTrip(legacyRequest)
		resultChannel <- result{response: response, err: roundTripErr}
	}()
	<-started
	if err = manager.UpdateVisibleRange("main", 10, 30); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-resultChannel:
		if got.err != nil {
			t.Fatal(got.err)
		}
		defer got.response.Body.Close()
		var syncResponse mautrix.RespSync
		if err = json.NewDecoder(got.response.Body).Decode(&syncResponse); err != nil {
			t.Fatal(err)
		}
		if syncResponse.NextBatch != "current-position" {
			t.Fatalf("position lost while refreshing range: %q", syncResponse.NextBatch)
		}
	case <-time.After(time.Second):
		t.Fatal("viewport change did not cancel the active long poll")
	}
	if got := manager.State().Ranges["main"]; got != [2]int{10, 30} {
		t.Fatalf("visible range was not updated: %#v", got)
	}
}

func TestSlidingSyncStoreDelegatesFilterID(t *testing.T) {
	store := slidingSyncStore{inner: mautrix.NewMemorySyncStore()}
	ctx := context.Background()
	userID := id.UserID("@user:example.org")
	if err := store.SaveFilterID(ctx, userID, "real-filter"); err != nil {
		t.Fatal(err)
	}
	filterID, err := store.LoadFilterID(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if filterID != "real-filter" {
		t.Fatalf("filter ID = %q, want the stored filter", filterID)
	}
}

func TestInvalidSlidingSyncPositionRequiresPositionError(t *testing.T) {
	if !invalidSlidingSyncPosition(http.StatusBadRequest, []byte(`{"errcode":"M_INVALID_PARAM","error":"Unknown position token"}`)) {
		t.Fatal("position error was not recognized")
	}
	if invalidSlidingSyncPosition(http.StatusBadRequest, []byte(`{"errcode":"M_INVALID_PARAM","error":"Invalid room ID"}`)) {
		t.Fatal("unrelated request validation error triggered a position reset")
	}
	if invalidSlidingSyncPosition(http.StatusUnauthorized, []byte(`{"errcode":"M_UNKNOWN_TOKEN","error":"Invalid access token"}`)) {
		t.Fatal("authentication error triggered a position reset")
	}
	if errors.Is(errSlidingSyncRequestChanged, context.Canceled) {
		t.Fatal("request-change cause should remain distinct from parent cancellation")
	}
}
