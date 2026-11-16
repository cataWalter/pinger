package matrix

import (
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

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
