package matrix

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const (
	defaultSlidingSyncListKey = "main"
	defaultSlidingSyncRange   = 20
	maxSlidingSyncRange       = 200
)

var ErrInvalidSlidingSyncRange = errors.New("invalid Sliding Sync range")

type SlidingSyncRequest struct {
	ConnID            string                                    `json:"conn_id,omitempty"`
	Pos               string                                    `json:"pos,omitempty"`
	Lists             map[string]SlidingSyncListRequest         `json:"lists"`
	RoomSubscriptions map[id.RoomID]SlidingSyncRoomSubscription `json:"room_subscriptions,omitempty"`
	Extensions        SlidingSyncExtensionsRequest              `json:"extensions,omitempty"`
	Timeout           int                                       `json:"timeout,omitempty"`
}

type SlidingSyncListRequest struct {
	Ranges        [][2]int                `json:"ranges"`
	Sort          []string                `json:"sort,omitempty"`
	Filters       *SlidingSyncListFilters `json:"filters,omitempty"`
	RequiredState [][2]string             `json:"required_state,omitempty"`
	TimelineLimit int                     `json:"timeline_limit,omitempty"`
}

type SlidingSyncListFilters struct {
	IsDM *bool `json:"is_dm,omitempty"`
}

type SlidingSyncRoomSubscription struct {
	RequiredState [][2]string `json:"required_state,omitempty"`
	TimelineLimit int         `json:"timeline_limit,omitempty"`
}

type SlidingSyncExtensionsRequest struct {
	ToDevice    SlidingSyncExtensionRequest `json:"to_device,omitempty"`
	E2EE        SlidingSyncExtensionRequest `json:"e2ee,omitempty"`
	AccountData SlidingSyncExtensionRequest `json:"account_data,omitempty"`
	Typing      SlidingSyncExtensionRequest `json:"typing,omitempty"`
	Receipts    SlidingSyncExtensionRequest `json:"receipts,omitempty"`
}

type SlidingSyncExtensionRequest struct {
	Enabled bool        `json:"enabled"`
	Lists   []string    `json:"lists,omitempty"`
	Rooms   []id.RoomID `json:"rooms,omitempty"`
}

type SlidingSyncResponse struct {
	Pos        string                             `json:"pos"`
	Lists      map[string]SlidingSyncListResponse `json:"lists"`
	Rooms      map[id.RoomID]SlidingSyncRoom      `json:"rooms"`
	Extensions SlidingSyncExtensionsResponse      `json:"extensions,omitempty"`
}

type SlidingSyncListResponse struct {
	Count int                        `json:"count"`
	Ops   []SlidingSyncListOperation `json:"ops"`
}

type SlidingSyncListOperation struct {
	Op      string      `json:"op"`
	Range   [2]int      `json:"range,omitempty"`
	Index   int         `json:"index,omitempty"`
	RoomID  id.RoomID   `json:"room_id,omitempty"`
	RoomIDs []id.RoomID `json:"room_ids,omitempty"`
	From    int         `json:"from,omitempty"`
	To      int         `json:"to,omitempty"`
}

type SlidingSyncRoom struct {
	Initial             bool                              `json:"initial,omitempty"`
	RequiredState       []*event.Event                    `json:"required_state,omitempty"`
	InviteState         []*event.Event                    `json:"invite_state,omitempty"`
	Timeline            SlidingSyncTimeline               `json:"timeline,omitempty"`
	AccountData         []*event.Event                    `json:"account_data,omitempty"`
	UnreadNotifications *mautrix.UnreadNotificationCounts `json:"unread_notifications,omitempty"`
	Membership          string                            `json:"membership,omitempty"`
}

type SlidingSyncTimeline struct {
	Events    []*event.Event `json:"events,omitempty"`
	Limited   bool           `json:"limited,omitempty"`
	PrevBatch string         `json:"prev_batch,omitempty"`
	NumLive   int            `json:"num_live,omitempty"`
}

type SlidingSyncExtensionsResponse struct {
	ToDevice    *SlidingSyncToDeviceResponse    `json:"to_device,omitempty"`
	AccountData *SlidingSyncAccountDataResponse `json:"account_data,omitempty"`
	E2EE        *SlidingSyncE2EEResponse        `json:"e2ee,omitempty"`
	Typing      *SlidingSyncRoomEventsResponse  `json:"typing,omitempty"`
	Receipts    *SlidingSyncRoomEventsResponse  `json:"receipts,omitempty"`
}

type SlidingSyncRoomEventsResponse struct {
	Rooms map[id.RoomID]*event.Event `json:"rooms,omitempty"`
}

type SlidingSyncToDeviceResponse struct {
	NextBatch string         `json:"next_batch,omitempty"`
	Events    []*event.Event `json:"events,omitempty"`
}

type SlidingSyncAccountDataResponse struct {
	Global []*event.Event               `json:"global,omitempty"`
	Rooms  map[id.RoomID][]*event.Event `json:"rooms,omitempty"`
}

type SlidingSyncE2EEResponse struct {
	DeviceLists  mautrix.DeviceLists `json:"device_lists,omitempty"`
	OTKCount     mautrix.OTKCount    `json:"device_one_time_keys_count,omitempty"`
	FallbackKeys []id.KeyAlgorithm   `json:"device_unused_fallback_key_types,omitempty"`
}

type SlidingSyncSnapshot struct {
	Pos        string                        `json:"pos"`
	Ranges     map[string][2]int             `json:"ranges"`
	ListCounts map[string]int                `json:"listCounts"`
	ListRooms  map[string][]id.RoomID        `json:"listRooms"`
	KnownRooms map[id.RoomID]SlidingSyncRoom `json:"knownRooms"`
}

type SlidingSyncState struct {
	mu                sync.RWMutex
	pos               string
	ranges            map[string][2]int
	listCounts        map[string]int
	listRooms         map[string][]id.RoomID
	knownRooms        map[id.RoomID]SlidingSyncRoom
	roomSubscriptions map[id.RoomID]SlidingSyncRoomSubscription
}

func NewSlidingSyncState() *SlidingSyncState {
	return &SlidingSyncState{
		ranges: map[string][2]int{
			defaultSlidingSyncListKey: {0, defaultSlidingSyncRange},
		},
		listCounts: make(map[string]int),
		listRooms:  make(map[string][]id.RoomID),
		knownRooms: make(map[id.RoomID]SlidingSyncRoom),
	}
}

// UpdateVisibleRange accepts an exclusive end index, matching the frontend virtual list.
func (s *SlidingSyncState) UpdateVisibleRange(listKey string, startIndex, endIndex int) error {
	listKey = strings.TrimSpace(listKey)
	if listKey == "" || startIndex < 0 || endIndex <= startIndex || endIndex-startIndex > maxSlidingSyncRange {
		return fmt.Errorf("%w: list=%q start=%d end=%d", ErrInvalidSlidingSyncRange, listKey, startIndex, endIndex)
	}
	s.mu.Lock()
	s.ranges[listKey] = [2]int{startIndex, endIndex}
	s.mu.Unlock()
	return nil
}

func (s *SlidingSyncState) SetRoomSubscription(roomID id.RoomID, subscription *SlidingSyncRoomSubscription) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if subscription == nil {
		delete(s.roomSubscriptions, roomID)
		return
	}
	if s.roomSubscriptions == nil {
		s.roomSubscriptions = make(map[id.RoomID]SlidingSyncRoomSubscription)
	}
	s.roomSubscriptions[roomID] = *subscription
}

func (s *SlidingSyncState) Request(connID string, timeout, timelineLimit int) SlidingSyncRequest {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lists := make(map[string]SlidingSyncListRequest, len(s.ranges))
	listKeys := make([]string, 0, len(s.ranges))
	for listKey, visible := range s.ranges {
		listKeys = append(listKeys, listKey)
		lists[listKey] = SlidingSyncListRequest{
			Ranges:        [][2]int{{visible[0], visible[1] - 1}},
			Sort:          []string{"by_notification_level", "by_recency"},
			TimelineLimit: timelineLimit,
			RequiredState: defaultSlidingSyncRequiredState(),
		}
	}
	sort.Strings(listKeys)
	subscriptions := make(map[id.RoomID]SlidingSyncRoomSubscription, len(s.roomSubscriptions))
	roomIDs := make([]id.RoomID, 0, len(s.roomSubscriptions))
	for roomID, subscription := range s.roomSubscriptions {
		subscriptions[roomID] = subscription
		roomIDs = append(roomIDs, roomID)
	}
	sort.Slice(roomIDs, func(left, right int) bool { return roomIDs[left] < roomIDs[right] })
	return SlidingSyncRequest{
		ConnID:            connID,
		Pos:               s.pos,
		Lists:             lists,
		RoomSubscriptions: subscriptions,
		Timeout:           timeout,
		Extensions: SlidingSyncExtensionsRequest{
			ToDevice:    SlidingSyncExtensionRequest{Enabled: true},
			E2EE:        SlidingSyncExtensionRequest{Enabled: true},
			AccountData: SlidingSyncExtensionRequest{Enabled: true},
			Typing:      SlidingSyncExtensionRequest{Enabled: true, Lists: listKeys, Rooms: roomIDs},
			Receipts:    SlidingSyncExtensionRequest{Enabled: true, Lists: listKeys, Rooms: roomIDs},
		},
	}
}

func (s *SlidingSyncState) Apply(response SlidingSyncResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pos = response.Pos
	for listKey, list := range response.Lists {
		s.listCounts[listKey] = list.Count
		rooms := s.listRooms[listKey]
		for _, operation := range list.Ops {
			rooms = applySlidingSyncListOperation(rooms, operation)
		}
		s.listRooms[listKey] = rooms
	}
	for roomID, room := range response.Rooms {
		s.knownRooms[roomID] = room
	}
}

func applySlidingSyncListOperation(rooms []id.RoomID, operation SlidingSyncListOperation) []id.RoomID {
	switch operation.Op {
	case "SYNC":
		start, end := operation.Range[0], operation.Range[1]
		if start < 0 || end < start {
			return rooms
		}
		if end >= len(rooms) {
			rooms = append(rooms, make([]id.RoomID, end-len(rooms)+1)...)
		}
		for index := start; index <= end && index-start < len(operation.RoomIDs); index++ {
			rooms[index] = operation.RoomIDs[index-start]
		}
	case "INSERT":
		if operation.Index < 0 || operation.Index > len(rooms) || operation.RoomID == "" {
			return rooms
		}
		rooms = append(rooms, "")
		copy(rooms[operation.Index+1:], rooms[operation.Index:])
		rooms[operation.Index] = operation.RoomID
	case "DELETE":
		if operation.Index >= 0 && operation.Index < len(rooms) {
			rooms = append(rooms[:operation.Index], rooms[operation.Index+1:]...)
		}
	case "INVALIDATE":
		start, end := operation.Range[0], operation.Range[1]
		if start < 0 || end < start || start >= len(rooms) {
			return rooms
		}
		end = min(end, len(rooms)-1)
		for index := start; index <= end; index++ {
			rooms[index] = ""
		}
	case "MOVE":
		from, to := operation.From, operation.To
		if from < 0 || from >= len(rooms) || to < 0 || to >= len(rooms) || from == to {
			return rooms
		}
		roomID := rooms[from]
		if from < to {
			copy(rooms[from:to], rooms[from+1:to+1])
		} else {
			copy(rooms[to+1:from+1], rooms[to:from])
		}
		rooms[to] = roomID
	}
	return rooms
}

func (s *SlidingSyncState) ResetPosition() {
	s.mu.Lock()
	s.pos = ""
	s.mu.Unlock()
}

func (s *SlidingSyncState) Snapshot() SlidingSyncSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snapshot := SlidingSyncSnapshot{
		Pos:        s.pos,
		Ranges:     make(map[string][2]int, len(s.ranges)),
		ListCounts: make(map[string]int, len(s.listCounts)),
		ListRooms:  make(map[string][]id.RoomID, len(s.listRooms)),
		KnownRooms: make(map[id.RoomID]SlidingSyncRoom, len(s.knownRooms)),
	}
	for key, value := range s.ranges {
		snapshot.Ranges[key] = value
	}
	for key, value := range s.listCounts {
		snapshot.ListCounts[key] = value
	}
	for key, value := range s.listRooms {
		snapshot.ListRooms[key] = append([]id.RoomID(nil), value...)
	}
	for roomID, value := range s.knownRooms {
		snapshot.KnownRooms[roomID] = value
	}
	return snapshot
}

func (s *SlidingSyncState) ListCounts() map[string]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	counts := make(map[string]int, len(s.listCounts))
	for listKey, count := range s.listCounts {
		counts[listKey] = count
	}
	return counts
}

func (response SlidingSyncResponse) ToSyncResponse() *mautrix.RespSync {
	syncResponse := &mautrix.RespSync{
		NextBatch: response.Pos,
		Rooms: mautrix.RespSyncRooms{
			Join:   make(map[id.RoomID]*mautrix.SyncJoinedRoom, len(response.Rooms)),
			Invite: make(map[id.RoomID]*mautrix.SyncInvitedRoom),
			Leave:  make(map[id.RoomID]*mautrix.SyncLeftRoom),
		},
	}
	for roomID, room := range response.Rooms {
		switch room.Membership {
		case "invite":
			syncResponse.Rooms.Invite[roomID] = &mautrix.SyncInvitedRoom{State: mautrix.SyncEventsList{Events: room.InviteState}}
		case "leave", "ban":
			syncResponse.Rooms.Leave[roomID] = &mautrix.SyncLeftRoom{
				State:    mautrix.SyncEventsList{Events: room.RequiredState},
				Timeline: mautrix.SyncTimeline{SyncEventsList: mautrix.SyncEventsList{Events: room.Timeline.Events}, Limited: room.Timeline.Limited, PrevBatch: room.Timeline.PrevBatch},
			}
		default:
			syncResponse.Rooms.Join[roomID] = &mautrix.SyncJoinedRoom{
				State:               mautrix.SyncEventsList{Events: room.RequiredState},
				Timeline:            mautrix.SyncTimeline{SyncEventsList: mautrix.SyncEventsList{Events: room.Timeline.Events}, Limited: room.Timeline.Limited, PrevBatch: room.Timeline.PrevBatch},
				AccountData:         mautrix.SyncEventsList{Events: room.AccountData},
				UnreadNotifications: room.UnreadNotifications,
			}
		}
	}
	if extensions := response.Extensions; extensions.ToDevice != nil {
		syncResponse.ToDevice = mautrix.SyncEventsList{Events: extensions.ToDevice.Events}
	}
	if extensions := response.Extensions; extensions.AccountData != nil {
		syncResponse.AccountData = mautrix.SyncEventsList{Events: extensions.AccountData.Global}
		for roomID, events := range extensions.AccountData.Rooms {
			room, ok := syncResponse.Rooms.Join[roomID]
			if !ok {
				room = &mautrix.SyncJoinedRoom{}
				syncResponse.Rooms.Join[roomID] = room
			}
			room.AccountData.Events = append(room.AccountData.Events, events...)
		}
	}
	if extensions := response.Extensions; extensions.E2EE != nil {
		syncResponse.DeviceLists = extensions.E2EE.DeviceLists
		syncResponse.DeviceOTKCount = extensions.E2EE.OTKCount
		syncResponse.FallbackKeys = extensions.E2EE.FallbackKeys
	}
	appendEphemeralEvents := func(events map[id.RoomID]*event.Event) {
		for roomID, ephemeralEvent := range events {
			if ephemeralEvent == nil {
				continue
			}
			joinedRoom := syncResponse.Rooms.Join[roomID]
			if joinedRoom == nil {
				if room, exists := response.Rooms[roomID]; exists && room.Membership != "" && room.Membership != "join" {
					continue
				}
				joinedRoom = &mautrix.SyncJoinedRoom{}
				syncResponse.Rooms.Join[roomID] = joinedRoom
			}
			joinedRoom.Ephemeral.Events = append(joinedRoom.Ephemeral.Events, ephemeralEvent)
		}
	}
	if extensions := response.Extensions; extensions.Typing != nil {
		appendEphemeralEvents(extensions.Typing.Rooms)
	}
	if extensions := response.Extensions; extensions.Receipts != nil {
		appendEphemeralEvents(extensions.Receipts.Rooms)
	}
	return syncResponse
}

func defaultSlidingSyncRequiredState() [][2]string {
	return [][2]string{
		{"m.room.name", ""},
		{"m.room.avatar", ""},
		{"m.room.topic", ""},
		{"m.room.encryption", ""},
		{"m.room.member", "$LAZY"},
	}
}
