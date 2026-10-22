package matrix

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

const slidingSyncResponseLimit = 32 << 20

var errSlidingSyncRequestChanged = errors.New("Sliding Sync request superseded by viewport change")

type SlidingSyncConfig struct {
	RequestTimeout       time.Duration
	InitialTimelineLimit int
	TimelineLimit        int
	RoomTimelineLimit    int
	UnreadTimelineLimit  int
	ListRequiredState    [][2]string
	RoomRequiredState    [][2]string
}

func DefaultSlidingSyncConfig() SlidingSyncConfig {
	return SlidingSyncConfig{
		RequestTimeout:       30 * time.Second,
		InitialTimelineLimit: 20,
		TimelineLimit:        5,
		RoomTimelineLimit:    50,
		UnreadTimelineLimit:  1,
		ListRequiredState:    defaultSlidingSyncRequiredState(),
		RoomRequiredState:    defaultSlidingSyncRequiredState(),
	}
}

type SlidingSyncManager struct {
	state    *SlidingSyncState
	endpoint string
	connID   string
	config   SlidingSyncConfig

	attachMu sync.Mutex
	attached bool

	requestMu     sync.Mutex
	requestID     atomic.Uint64
	requestCancel context.CancelCauseFunc

	subscriptionMu      sync.Mutex
	activeSubscriptions map[id.RoomID]SlidingSyncRoomSubscription
	priorityRooms       map[id.RoomID]struct{}

	positionReset      atomic.Bool
	syncFailures       atomic.Uint32
	slidingUnsupported atomic.Bool
}

func NewSlidingSyncManager(homeserverURL *url.URL, config SlidingSyncConfig) (*SlidingSyncManager, error) {
	if homeserverURL == nil || homeserverURL.Scheme == "" || homeserverURL.Host == "" {
		return nil, errors.New("Sliding Sync requires an absolute homeserver URL")
	}
	defaults := DefaultSlidingSyncConfig()
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = defaults.RequestTimeout
	}
	if config.InitialTimelineLimit <= 0 {
		config.InitialTimelineLimit = defaults.InitialTimelineLimit
	}
	if config.TimelineLimit <= 0 {
		config.TimelineLimit = defaults.TimelineLimit
	}
	if config.RoomTimelineLimit <= 0 {
		config.RoomTimelineLimit = defaults.RoomTimelineLimit
	}
	if config.UnreadTimelineLimit <= 0 {
		config.UnreadTimelineLimit = defaults.UnreadTimelineLimit
	}
	if config.ListRequiredState == nil {
		config.ListRequiredState = defaults.ListRequiredState
	}
	if config.RoomRequiredState == nil {
		config.RoomRequiredState = defaults.RoomRequiredState
	}
	endpoint := homeserverURL.JoinPath("_matrix", "client", "unstable", "org.matrix.msc3575", "sync")
	return &SlidingSyncManager{
		state:               NewSlidingSyncState(),
		endpoint:            endpoint.String(),
		connID:              newSlidingSyncConnID(),
		config:              config,
		activeSubscriptions: make(map[id.RoomID]SlidingSyncRoomSubscription),
		priorityRooms:       make(map[id.RoomID]struct{}),
	}, nil
}

func newSlidingSyncConnID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("pinger-%d", time.Now().UnixNano())
}

// Attach redirects mautrix's existing sync loop to MSC3575, preserving gomuks'
// response processing, cancellation, and reconnect backoff without a second loop.
// Servers that do not expose the endpoint are switched to standard /sync.
func (m *SlidingSyncManager) Attach(client *mautrix.Client) error {
	if client == nil || client.Client == nil {
		return errors.New("Sliding Sync cannot attach to an uninitialized Matrix client")
	}
	m.attachMu.Lock()
	defer m.attachMu.Unlock()
	if m.attached {
		return nil
	}
	base := client.Client.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	client.Client.Transport = &slidingSyncTransport{manager: m, base: base}
	client.Store = slidingSyncStore{inner: client.Store}
	client.Syncer = slidingSyncSyncer{inner: client.Syncer, manager: m}
	m.attached = true
	return nil
}

func (m *SlidingSyncManager) UpdateVisibleRange(listKey string, startIndex, endIndex int) error {
	previous := m.state.Snapshot().Ranges[listKey]
	if err := m.state.UpdateVisibleRange(listKey, startIndex, endIndex); err != nil {
		return err
	}
	if previous != [2]int{startIndex, endIndex} {
		m.cancelActiveRequest()
	}
	return nil
}

func (m *SlidingSyncManager) SubscribeToRoom(roomID string) error {
	return m.SubscribeToRoomWithSettings(roomID, SlidingSyncRoomSubscription{
		RequiredState: cloneSlidingSyncState(m.config.RoomRequiredState),
		TimelineLimit: m.config.RoomTimelineLimit,
	})
}

func (m *SlidingSyncManager) SubscribeToRoomWithSettings(roomID string, subscription SlidingSyncRoomSubscription) error {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return errors.New("room ID is empty")
	}
	if subscription.TimelineLimit < 0 {
		return errors.New("room timeline limit cannot be negative")
	}
	if subscription.TimelineLimit == 0 {
		subscription.TimelineLimit = m.config.RoomTimelineLimit
	}
	if subscription.RequiredState == nil {
		subscription.RequiredState = cloneSlidingSyncState(m.config.RoomRequiredState)
	} else {
		subscription.RequiredState = cloneSlidingSyncState(subscription.RequiredState)
	}
	id := id.RoomID(roomID)
	m.subscriptionMu.Lock()
	m.activeSubscriptions[id] = subscription
	m.updateSubscriptionsLocked()
	m.subscriptionMu.Unlock()
	m.cancelActiveRequest()
	return nil
}

func (m *SlidingSyncManager) UnsubscribeFromRoom(roomID string) error {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return errors.New("room ID is empty")
	}
	id := id.RoomID(roomID)
	m.subscriptionMu.Lock()
	_, existed := m.activeSubscriptions[id]
	delete(m.activeSubscriptions, id)
	m.updateSubscriptionsLocked()
	m.subscriptionMu.Unlock()
	if existed {
		m.cancelActiveRequest()
	}
	return nil
}

func (m *SlidingSyncManager) SetPriorityRooms(roomIDs []string) {
	priorityRooms := make(map[id.RoomID]struct{}, len(roomIDs))
	for _, roomID := range roomIDs {
		roomID = strings.TrimSpace(roomID)
		if roomID != "" {
			priorityRooms[id.RoomID(roomID)] = struct{}{}
		}
	}
	m.subscriptionMu.Lock()
	if equalRoomSet(m.priorityRooms, priorityRooms) {
		m.subscriptionMu.Unlock()
		return
	}
	m.priorityRooms = priorityRooms
	m.updateSubscriptionsLocked()
	m.subscriptionMu.Unlock()
	m.cancelActiveRequest()
}

func (m *SlidingSyncManager) updateSubscriptionsLocked() {
	subscriptions := make(map[id.RoomID]SlidingSyncRoomSubscription, len(m.activeSubscriptions)+len(m.priorityRooms))
	for roomID, subscription := range m.activeSubscriptions {
		subscriptions[roomID] = subscription
	}
	for roomID := range m.priorityRooms {
		if _, isActive := subscriptions[roomID]; !isActive {
			subscriptions[roomID] = SlidingSyncRoomSubscription{
				RequiredState: cloneSlidingSyncState(m.config.RoomRequiredState),
				TimelineLimit: m.config.UnreadTimelineLimit,
			}
		}
	}
	m.state.mu.Lock()
	m.state.roomSubscriptions = subscriptions
	m.state.mu.Unlock()
}

func equalRoomSet(left, right map[id.RoomID]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for roomID := range left {
		if _, ok := right[roomID]; !ok {
			return false
		}
	}
	return true
}

func cloneSlidingSyncState(input [][2]string) [][2]string {
	return append([][2]string(nil), input...)
}

func (m *SlidingSyncManager) State() SlidingSyncSnapshot {
	return m.state.Snapshot()
}

func (m *SlidingSyncManager) cancelActiveRequest() {
	m.requestMu.Lock()
	cancel := m.requestCancel
	m.requestMu.Unlock()
	if cancel != nil {
		cancel(errSlidingSyncRequestChanged)
	}
}

type slidingSyncTransport struct {
	manager *SlidingSyncManager
	base    http.RoundTripper
}

func (transport *slidingSyncTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.Method != http.MethodGet || !strings.HasSuffix(strings.TrimRight(request.URL.Path, "/"), "/sync") {
		return transport.base.RoundTrip(request)
	}
	return transport.manager.roundTrip(request, transport.base)
}

func (transport *slidingSyncTransport) CloseIdleConnections() {
	if closer, ok := transport.base.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

func (m *SlidingSyncManager) roundTrip(request *http.Request, base http.RoundTripper) (*http.Response, error) {
	if m.slidingUnsupported.Load() {
		return m.legacySync(request, base)
	}
	requestContext, cancel := context.WithCancelCause(request.Context())
	requestID := m.requestID.Add(1)
	m.requestMu.Lock()
	m.requestCancel = cancel
	m.requestMu.Unlock()
	defer func() {
		cancel(nil)
		m.requestMu.Lock()
		if m.requestID.Load() == requestID {
			m.requestCancel = nil
		}
		m.requestMu.Unlock()
	}()

	pos := request.URL.Query().Get("since")
	for attempt := 0; attempt < 2; attempt++ {
		slidingRequest, err := m.newRequest(requestContext, request, base, pos)
		if err != nil {
			return nil, err
		}
		if requestContext.Err() != nil {
			break
		}
		response, err := base.RoundTrip(slidingRequest)
		if err != nil {
			if context.Cause(requestContext) == errSlidingSyncRequestChanged {
				return m.emptySyncResponse(request, pos), nil
			}
			return nil, err
		}
		if response.StatusCode == http.StatusNotFound {
			_ = response.Body.Close()
			m.slidingUnsupported.Store(true)
			return m.legacySync(request, base)
		}
		if response.StatusCode >= http.StatusBadRequest {
			body, readErr := readSlidingSyncBody(response.Body)
			_ = response.Body.Close()
			if readErr != nil {
				return slidingSyncErrorResponse(request, http.StatusBadGateway, readErr.Error()), nil
			}
			if attempt == 0 && pos != "" && invalidSlidingSyncPosition(response.StatusCode, body) {
				m.positionReset.Store(true)
				m.state.ResetPosition()
				pos = ""
				continue
			}
			response.Body = io.NopCloser(bytes.NewReader(body))
			response.ContentLength = int64(len(body))
			response.Request = request
			return response, nil
		}
		return m.translateResponse(request, response)
	}
	if context.Cause(requestContext) == errSlidingSyncRequestChanged {
		return m.emptySyncResponse(request, pos), nil
	}
	if err := requestContext.Err(); err != nil {
		return nil, err
	}
	return slidingSyncErrorResponse(request, http.StatusBadGateway, "Sliding Sync request did not complete"), nil
}

func (m *SlidingSyncManager) newRequest(ctx context.Context, original *http.Request, _ http.RoundTripper, pos string) (*http.Request, error) {
	timelineLimit := m.config.TimelineLimit
	requiredState := m.config.ListRequiredState
	if pos == "" {
		timelineLimit = m.config.InitialTimelineLimit
	}
	slidingRequest := m.state.Request(m.connID, int(m.config.RequestTimeout.Milliseconds()), timelineLimit)
	slidingRequest.Pos = pos
	for listKey, list := range slidingRequest.Lists {
		list.RequiredState = cloneSlidingSyncState(requiredState)
		slidingRequest.Lists[listKey] = list
	}
	for roomID, subscription := range slidingRequest.RoomSubscriptions {
		if subscription.RequiredState == nil {
			subscription.RequiredState = cloneSlidingSyncState(m.config.RoomRequiredState)
		}
		if subscription.TimelineLimit <= 0 {
			subscription.TimelineLimit = m.config.RoomTimelineLimit
		}
		slidingRequest.RoomSubscriptions[roomID] = subscription
	}
	body, err := json.Marshal(slidingRequest)
	if err != nil {
		return nil, fmt.Errorf("encode Sliding Sync request: %w", err)
	}
	endpoint, err := url.Parse(m.endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse Sliding Sync endpoint: %w", err)
	}
	newRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create Sliding Sync request: %w", err)
	}
	newRequest.Header = original.Header.Clone()
	newRequest.Header.Set("Content-Type", "application/json")
	newRequest.Header.Set("Accept", "application/json")
	newRequest.ContentLength = int64(len(body))
	return newRequest, nil
}

func (m *SlidingSyncManager) translateResponse(request *http.Request, response *http.Response) (*http.Response, error) {
	body, err := readSlidingSyncBody(response.Body)
	_ = response.Body.Close()
	if err != nil {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, err.Error()), nil
	}
	var slidingResponse SlidingSyncResponse
	if err = json.Unmarshal(body, &slidingResponse); err != nil {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, "decode Sliding Sync response: "+err.Error()), nil
	}
	if slidingResponse.Pos == "" {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, "Sliding Sync response has no position token"), nil
	}
	syncBody, err := json.Marshal(slidingResponse.ToSyncResponse())
	if err != nil {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, "encode adapted sync response: "+err.Error()), nil
	}
	m.state.Apply(slidingResponse)
	return slidingSyncHTTPResponse(request, response.Header, syncBody), nil
}

func readSlidingSyncBody(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, slidingSyncResponseLimit+1))
	if err != nil {
		return nil, fmt.Errorf("read Sliding Sync response: %w", err)
	}
	if len(data) > slidingSyncResponseLimit {
		return nil, fmt.Errorf("Sliding Sync response exceeds %d bytes", slidingSyncResponseLimit)
	}
	return data, nil
}

func invalidSlidingSyncPosition(statusCode int, body []byte) bool {
	if statusCode != http.StatusBadRequest && statusCode != http.StatusConflict && statusCode != http.StatusGone {
		return false
	}
	var apiError struct {
		ErrCode string `json:"errcode"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(body, &apiError) != nil {
		return false
	}
	code := strings.ToUpper(apiError.ErrCode)
	description := strings.ToLower(apiError.Error)
	if code == "M_UNKNOWN_POS" || code == "M_INVALID_POS" {
		return true
	}
	return (code == "M_UNKNOWN" || code == "M_INVALID_PARAM") &&
		(strings.Contains(description, "position") || strings.Contains(description, "pos ") || strings.Contains(description, "token"))
}

// legacySync forwards a standard /sync request. A stored token can come from Sliding Sync,
// which standard sync rejects, so a rejected token restarts from an initial sync.
func (m *SlidingSyncManager) legacySync(request *http.Request, base http.RoundTripper) (*http.Response, error) {
	response, err := base.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusBadRequest || request.URL.Query().Get("since") == "" {
		return response, err
	}
	_ = response.Body.Close()
	fresh := request.Clone(request.Context())
	query := fresh.URL.Query()
	query.Del("since")
	fresh.URL.RawQuery = query.Encode()
	m.positionReset.Store(true)
	return base.RoundTrip(fresh)
}

func (m *SlidingSyncManager) emptySyncResponse(request *http.Request, pos string) *http.Response {
	body, _ := json.Marshal(&mautrix.RespSync{NextBatch: pos})
	return slidingSyncHTTPResponse(request, make(http.Header), body)
}

func slidingSyncHTTPResponse(request *http.Request, headers http.Header, body []byte) *http.Response {
	responseHeaders := headers.Clone()
	responseHeaders.Del("Content-Encoding")
	responseHeaders.Del("Content-Length")
	responseHeaders.Set("Content-Type", "application/json")
	return &http.Response{
		Status:        "200 OK",
		StatusCode:    http.StatusOK,
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        responseHeaders,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       request,
	}
}

func slidingSyncErrorResponse(request *http.Request, statusCode int, message string) *http.Response {
	body, _ := json.Marshal(map[string]string{"errcode": "M_UNKNOWN", "error": message})
	return &http.Response{
		Status:        fmt.Sprintf("%d %s", statusCode, http.StatusText(statusCode)),
		StatusCode:    statusCode,
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        http.Header{"Content-Type": []string{"application/json"}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       request,
	}
}

type slidingSyncSyncer struct {
	inner   mautrix.Syncer
	manager *SlidingSyncManager
}

func (syncer slidingSyncSyncer) ProcessResponse(ctx context.Context, response *mautrix.RespSync, since string) error {
	if syncer.manager.positionReset.Swap(false) {
		since = ""
	}
	err := syncer.inner.ProcessResponse(ctx, response, since)
	if err == nil {
		syncer.manager.syncFailures.Store(0)
	}
	return err
}

func (syncer slidingSyncSyncer) OnFailedSync(response *mautrix.RespSync, err error) (time.Duration, error) {
	_, syncErr := syncer.inner.OnFailedSync(response, err)
	if syncErr != nil {
		return 0, syncErr
	}
	attempt := syncer.manager.syncFailures.Add(1)
	return reconnectDelay(int(attempt)), nil
}

func (syncer slidingSyncSyncer) GetFilterJSON(userID id.UserID) *mautrix.Filter {
	return syncer.inner.GetFilterJSON(userID)
}

type slidingSyncStore struct {
	inner mautrix.SyncStore
}

func (store slidingSyncStore) SaveFilterID(ctx context.Context, userID id.UserID, filterID string) error {
	return store.inner.SaveFilterID(ctx, userID, filterID)
}

func (store slidingSyncStore) LoadFilterID(ctx context.Context, userID id.UserID) (string, error) {
	return store.inner.LoadFilterID(ctx, userID)
}

func (store slidingSyncStore) SaveNextBatch(ctx context.Context, userID id.UserID, nextBatch string) error {
	return store.inner.SaveNextBatch(ctx, userID, nextBatch)
}

func (store slidingSyncStore) LoadNextBatch(ctx context.Context, userID id.UserID) (string, error) {
	return store.inner.LoadNextBatch(ctx, userID)
}
