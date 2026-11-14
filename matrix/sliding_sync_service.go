package matrix

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/rs/zerolog"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	slidingSyncResponseLimit = 32 << 20
	slidingSyncLogBodyLimit  = 4 << 10
)

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
	log      zerolog.Logger

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
		log:                 zerolog.Nop(),
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
	m.log = client.Log.With().Str("sync_transport", "sliding").Logger()
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
