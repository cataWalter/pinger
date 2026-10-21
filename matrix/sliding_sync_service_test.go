package matrix

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

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

func TestSlidingSyncStoreSkipsLegacyFilterCreation(t *testing.T) {
	store := slidingSyncStore{inner: &mautrix.MemorySyncStore{
		Filters:   make(map[id.UserID]string),
		NextBatch: make(map[id.UserID]string),
	}}
	filterID, err := store.LoadFilterID(context.Background(), "@user:example.org")
	if err != nil {
		t.Fatal(err)
	}
	if filterID == "" {
		t.Fatal("Sliding Sync should not create a legacy /sync filter")
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
