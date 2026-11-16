package matrix

import (
	"errors"
	"testing"

	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestSlidingSyncStateBuildsRequestFromExclusiveRange(t *testing.T) {
	state := NewSlidingSyncState()
	if err := state.UpdateVisibleRange("main", 4, 12); err != nil {
		t.Fatal(err)
	}
	state.SetRoomSubscription("!active:example.org", &SlidingSyncRoomSubscription{TimelineLimit: 80})
	request := state.Request("connection", 30000, 20)
	if request.Pos != "" || request.ConnID != "connection" {
		t.Fatalf("unexpected request identity: pos=%q conn_id=%q", request.Pos, request.ConnID)
	}
	if got := request.Lists["main"].Ranges; len(got) != 1 || got[0] != [2]int{4, 11} {
		t.Fatalf("range was not converted to MSC3575's inclusive end: %#v", got)
	}
	if _, ok := request.RoomSubscriptions["!active:example.org"]; !ok {
		t.Fatal("active room subscription missing from request")
	}
	if len(request.Extensions.Typing.Lists) != 1 || request.Extensions.Typing.Lists[0] != "main" {
		t.Fatalf("typing extension is not scoped to the active list: %#v", request.Extensions.Typing)
	}
	if len(request.Extensions.Receipts.Rooms) != 1 || request.Extensions.Receipts.Rooms[0] != "!active:example.org" {
		t.Fatalf("receipt extension is not scoped to subscribed rooms: %#v", request.Extensions.Receipts)
	}
}

func TestSlidingSyncStateRejectsInvalidRanges(t *testing.T) {
	state := NewSlidingSyncState()
	for _, testCase := range [][3]int{{-1, 1, 0}, {0, 0, 0}, {0, maxSlidingSyncRange + 1, 0}} {
		if err := state.UpdateVisibleRange("main", testCase[0], testCase[1]); !errors.Is(err, ErrInvalidSlidingSyncRange) {
			t.Errorf("range [%d,%d) error = %v, want ErrInvalidSlidingSyncRange", testCase[0], testCase[1], err)
		}
	}
}

func TestSlidingSyncStateAppliesListOperationsAndRooms(t *testing.T) {
	state := NewSlidingSyncState()
	state.Apply(SlidingSyncResponse{
		Pos: "next-position",
		Lists: map[string]SlidingSyncListResponse{
			"main": {
				Count: 2,
				Ops: []SlidingSyncListOperation{{
					Op:      "SYNC",
					Range:   [2]int{0, 1},
					RoomIDs: []id.RoomID{"!one:example.org", "!two:example.org"},
				}},
			},
		},
		Rooms: map[id.RoomID]SlidingSyncRoom{
			"!one:example.org": {Initial: true},
		},
	})
	snapshot := state.Snapshot()
	if snapshot.Pos != "next-position" || snapshot.ListCounts["main"] != 2 {
		t.Fatalf("response metadata not applied: %#v", snapshot)
	}
	counts := state.ListCounts()
	if counts["main"] != 2 {
		t.Fatalf("list-count snapshot = %#v, want main=2", counts)
	}
	counts["main"] = 99
	if state.ListCounts()["main"] != 2 {
		t.Fatal("mutating list-count snapshot changed Sliding Sync state")
	}
	if got := snapshot.ListRooms["main"]; len(got) != 2 || got[0] != "!one:example.org" || got[1] != "!two:example.org" {
		t.Fatalf("unexpected list room order: %#v", got)
	}
	if _, ok := snapshot.KnownRooms["!one:example.org"]; !ok {
		t.Fatal("room delta missing from cache")
	}
}

func TestSlidingSyncResponseConvertsForMautrixSyncer(t *testing.T) {
	roomID := id.RoomID("!room:example.org")
	eventID := id.EventID("$message")
	typingEvent := &event.Event{ID: eventID, Type: event.EphemeralEventTyping}
	receiptEvent := &event.Event{ID: eventID, Type: event.EphemeralEventReceipt}
	response := SlidingSyncResponse{
		Pos: "next-position",
		Rooms: map[id.RoomID]SlidingSyncRoom{
			roomID: {
				RequiredState: []*event.Event{{ID: eventID}},
				Timeline:      SlidingSyncTimeline{Events: []*event.Event{{ID: eventID}}, Limited: true, PrevBatch: "older"},
			},
		},
		Extensions: SlidingSyncExtensionsResponse{
			Typing:   &SlidingSyncRoomEventsResponse{Rooms: map[id.RoomID]*event.Event{roomID: typingEvent}},
			Receipts: &SlidingSyncRoomEventsResponse{Rooms: map[id.RoomID]*event.Event{roomID: receiptEvent}},
		},
	}
	syncResponse := response.ToSyncResponse()
	joinedRoom := syncResponse.Rooms.Join[roomID]
	if syncResponse.NextBatch != response.Pos || joinedRoom == nil {
		t.Fatalf("room response was not converted: %#v", syncResponse)
	}
	if len(joinedRoom.State.Events) != 1 || len(joinedRoom.Timeline.Events) != 1 || !joinedRoom.Timeline.Limited || joinedRoom.Timeline.PrevBatch != "older" {
		t.Fatalf("room state/timeline delta was not preserved: %#v", joinedRoom)
	}
	if len(joinedRoom.Ephemeral.Events) != 2 || joinedRoom.Ephemeral.Events[0] != typingEvent || joinedRoom.Ephemeral.Events[1] != receiptEvent {
		t.Fatalf("typing and receipt events were not preserved as ephemeral sync events: %#v", joinedRoom.Ephemeral.Events)
	}
}
