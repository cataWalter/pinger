package matrix

import (
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"testing"
	"time"
)

func TestPublishCoalescesTimelineChangedRoomIDs(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
	}
	client.publishTimeline([]string{"!first:example.org"}, "")
	client.pendingIncomingMessage = true
	client.publishTimeline([]string{"!second:example.org"}, "")

	update := <-client.events
	if len(update.TimelineChangedRoomID) != 2 {
		t.Fatalf("timeline changed rooms = %v, want both coalesced room IDs", update.TimelineChangedRoomID)
	}
	if update.TimelineChangedRoomID[0] != "!first:example.org" ||
		update.TimelineChangedRoomID[1] != "!second:example.org" {
		t.Fatalf("timeline changed rooms = %v, want sorted room IDs", update.TimelineChangedRoomID)
	}
	if len(update.ChangedRoomID) != 0 {
		t.Fatalf("metadata changed rooms = %v, want none", update.ChangedRoomID)
	}
	if !update.NewIncomingMessage {
		t.Fatal("coalesced update lost its incoming-message signal")
	}
}

func TestApplySyncFlagsOnlyLiveTimelineMessages(t *testing.T) {
	roomID := id.RoomID("!chat:example.org")
	rowID := database.EventRowID(1)
	for _, test := range []struct {
		name   string
		notify bool
		reset  bool
		sender string
		typeID string
		want   bool
	}{
		{name: "live message", notify: true, typeID: event.EventMessage.Type, want: true},
		{name: "own message", notify: true, sender: "@me:example.org", typeID: event.EventMessage.Type},
		{name: "initial history", notify: false, typeID: event.EventMessage.Type},
		{name: "reset timeline", notify: true, reset: true, typeID: event.EventMessage.Type},
		{name: "reaction", notify: true, typeID: "m.reaction"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &Client{
				engine: &hicli.HiClient{Account: &database.Account{UserID: id.UserID("@me:example.org")}},
				rooms:  make(map[string]Room),
				events: make(chan Update, 1),
				done:   make(chan struct{}),
			}
			sender := test.sender
			if sender == "" {
				sender = "@alice:example.org"
			}
			client.applySync(&jsoncmd.SyncComplete{
				Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
					roomID: {
						Meta:     &database.Room{ID: roomID},
						Reset:    test.reset,
						Timeline: []database.TimelineRowTuple{{Event: rowID}},
						Events: []*database.Event{{
							RowID:   rowID,
							ID:      id.EventID("$incoming"),
							Sender:  id.UserID(sender),
							Type:    test.typeID,
							Content: json.RawMessage(`{"msgtype":"m.text","body":"hello"}`),
						}},
					},
				},
			}, test.notify)
			got := client.pendingIncomingMessage
			if test.notify {
				got = (<-client.events).NewIncomingMessage
			}
			if got != test.want {
				t.Fatalf("incoming signal = %v, want %v", got, test.want)
			}
		})
	}
}

func TestApplySyncKeepsPreviewAndTimelineInSync(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!chat:example.org")
	latest := time.Date(2026, time.October, 17, 11, 57, 0, 0, time.UTC)
	stale := latest.Add(-time.Minute)
	client.rooms[roomID.String()] = Room{ID: roomID.String(), Name: "Andrea", Preview: "older", LastSeen: stale}
	syncEvent := &jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Timeline: []database.TimelineRowTuple{{Timeline: 2, Event: 2}},
				Events: []*database.Event{
					{
						RowID:     2,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"se hai bisogno dimmi"}`),
						Timestamp: jsontime.UM(latest),
					},
				},
			},
		},
	}
	client.applySync(syncEvent, true)
	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "se hai bisogno dimmi" || !rooms[0].LastSeen.Equal(latest) {
		t.Fatalf("preview not synced with timeline: %+v", rooms)
	}
	update := <-client.Events()
	if len(update.TimelineChangedRoomID) != 1 || update.TimelineChangedRoomID[0] != roomID.String() {
		t.Fatalf("timeline changed rooms = %v, want open chat refresh", update.TimelineChangedRoomID)
	}
	// Non-timeline events must not move the preview or trigger a refresh.
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Events: []*database.Event{
					{
						RowID:     99,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{\"body\":\"background noise\"}`),
						Timestamp: jsontime.UM(latest.Add(time.Minute)),
					},
				},
			},
		},
	}, true)
	rooms = client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "se hai bisogno dimmi" {
		t.Fatalf("non-timeline event moved preview: %+v", rooms)
	}
	update = <-client.Events()
	if len(update.TimelineChangedRoomID) != 0 {
		t.Fatalf("timeline changed rooms = %v, want no refresh", update.TimelineChangedRoomID)
	}
}

// gomuks picks a room's preview event server-side (room.preview_event_rowid).
// When that event's body arrives in this payload the sidebar must use it:
// re-deriving the preview from the newest in-timeline event can surface the
// bridge placeholder text instead of the message the open chat shows.
func TestApplySyncPrefersAuthoritativePreviewEvent(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!bridge:example.org")
	displayName := "WhatsApp chat"
	topic := "WhatsApp private chat"
	sent := time.Date(2026, time.October, 17, 12, 59, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{
		ID: roomID.String(), Name: displayName, Topic: topic,
		LastSeen: sent.Add(-time.Minute),
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Meta: &database.Room{
					ID:                roomID,
					Name:              &displayName,
					Topic:             &topic,
					PreviewEventRowID: 5,
					SortingTimestamp:  jsontime.UM(sent),
				},
				Timeline: []database.TimelineRowTuple{{Timeline: 1, Event: 9}},
				Events: []*database.Event{
					{
						RowID:     9,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"WhatsApp private chat"}`),
						Timestamp: jsontime.UM(sent),
					},
					{
						RowID:     5,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"i want a yes"}`),
						Timestamp: jsontime.UM(sent),
					},
				},
			},
		},
	}, false)
	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "i want a yes" {
		t.Fatalf("authoritative preview not used: %+v", rooms)
	}
}

func TestApplySyncKeepsPreviewSenderOnMessageEvent(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!chat:example.org")
	latest := time.Date(2026, time.October, 17, 13, 0, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{ID: roomID.String(), Name: "Andrea"}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Meta: &database.Room{ID: roomID, PreviewEventRowID: 5},
				Events: []*database.Event{
					{
						RowID:     5,
						ID:        "$latest-message",
						Type:      event.EventMessage.Type,
						Sender:    id.UserID("@me:example.org"),
						Content:   json.RawMessage(`{"body":"my latest message"}`),
						Timestamp: jsontime.UM(latest),
					},
					{
						RowID:     6,
						Type:      event.StateMember.Type,
						Sender:    id.UserID("@alice:example.org"),
						Timestamp: jsontime.UM(latest.Add(time.Minute)),
					},
				},
			},
		},
	}, false)

	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Preview != "my latest message" || rooms[0].LastEventSender != "@me:example.org" {
		t.Fatalf("preview sender = %+v, want own message sender", rooms)
	}
	if !rooms[0].LastEventAt.Equal(latest) || rooms[0].LastEventID != "$latest-message" {
		t.Fatalf("latest event = (%v, %q), want message timestamp %v and event ID %q",
			rooms[0].LastEventAt, rooms[0].LastEventID, latest, "$latest-message")
	}
}
