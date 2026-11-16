package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"path/filepath"
	"testing"
	"time"
)

// A freshly sent own message can arrive in `events` before it has a timeline
// row (the timeline insert may land a sync later). It must still seed an
// otherwise-empty preview, otherwise the sidebar falls back to the room topic
// while the open chat already shows the sent text.
func TestApplySyncSeedsEmptyPreviewFromOwnPendingSend(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!bridge:example.org")
	topic := "WhatsApp private chat"
	sent := time.Date(2026, time.October, 17, 12, 59, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{
		ID: roomID.String(), Name: "WhatsApp chat", Topic: topic,
		LastSeen: sent.Add(-time.Minute),
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				// No timeline rows: the send has not been persisted yet.
				Events: []*database.Event{
					{
						RowID:     7,
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
		t.Fatalf("pending own send did not seed preview: %+v", rooms)
	}
	if !rooms[0].LastSeen.Equal(sent) {
		t.Fatalf("last seen = %v, want %v", rooms[0].LastSeen, sent)
	}
}

// An incoming message outside the timeline must move the sender with the last
// event ID, otherwise the room keeps the user's own sender and drops out of Unanswered.
func TestApplySyncSetsLastEventSenderWithLastEventID(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  map[string]Room{},
	}
	roomID := id.RoomID("!chat:example.org")
	base := time.Date(2026, time.October, 17, 14, 0, 0, 0, time.UTC)
	client.rooms[roomID.String()] = Room{
		ID:              roomID.String(),
		Name:            "Vincenzo",
		Preview:         "my reply",
		LastSeen:        base,
		LastEventAt:     base,
		LastEventID:     "$own-reply",
		LastEventSender: "@me:example.org",
	}
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Events: []*database.Event{
					{
						RowID:     7,
						ID:        "$incoming",
						Type:      event.EventMessage.Type,
						Sender:    id.UserID("@friend:example.org"),
						Content:   json.RawMessage(`{"body":"ciao"}`),
						Timestamp: jsontime.UM(base.Add(time.Minute)),
					},
				},
			},
		},
	}, false)

	rooms := client.Rooms()
	if len(rooms) != 1 {
		t.Fatalf("rooms = %+v, want one room", rooms)
	}
	room := rooms[0]
	if room.LastEventID != "$incoming" || room.LastEventSender != "@friend:example.org" {
		t.Fatalf("last event = (%q, %q), want the incoming message", room.LastEventID, room.LastEventSender)
	}
	if room.Preview != "my reply" || !room.Unanswered {
		t.Fatalf("preview = %q, unanswered = %t, want preview kept and room unanswered", room.Preview, room.Unanswered)
	}
}

// Timeline.Get is newest first. The decryption refresh must pick the newest
// message in the window, not the oldest one.
func TestRefreshRoomFromTimelineUsesNewestMessageSender(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!decrypted-preview:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	base := time.Date(2026, time.October, 17, 7, 34, 0, 0, time.UTC)
	insert := func(eventID id.EventID, sender id.UserID, body string, at time.Time) database.EventRowID {
		t.Helper()
		content, marshalErr := json.Marshal(map[string]string{"msgtype": "m.text", "body": body})
		if marshalErr != nil {
			t.Fatalf("marshal %s: %v", eventID, marshalErr)
		}
		rowID, insertErr := client.engine.DB.Event.Insert(ctx, &database.Event{
			RoomID:    roomID,
			ID:        eventID,
			Sender:    sender,
			Type:      event.EventMessage.Type,
			Timestamp: jsontime.UM(at),
			Content:   content,
			Unsigned:  json.RawMessage(`{}`),
		})
		if insertErr != nil {
			t.Fatalf("insert %s: %v", eventID, insertErr)
		}
		return rowID
	}
	own := insert("$own-reply", "@me:example.org", "my reply", base)
	incoming := insert("$incoming", "@friend:example.org", "decrypted incoming", base.Add(time.Hour))
	if _, err = client.engine.DB.Timeline.Append(ctx, roomID, []database.EventRowID{own, incoming}); err != nil {
		t.Fatalf("append timeline: %v", err)
	}

	client.mu.Lock()
	client.rooms[roomID.String()] = Room{
		ID:              roomID.String(),
		Preview:         "my reply",
		LastSeen:        base,
		LastEventAt:     base,
		LastEventID:     "$own-reply",
		LastEventSender: "@me:example.org",
	}
	client.mu.Unlock()

	client.refreshRoomFromTimeline(roomID.String())

	rooms := client.Rooms()
	if len(rooms) != 1 {
		t.Fatalf("rooms = %+v, want one room", rooms)
	}
	room := rooms[0]
	if room.LastEventID != "$incoming" || room.LastEventSender != "@friend:example.org" {
		t.Fatalf("last event = (%q, %q), want the newest incoming message", room.LastEventID, room.LastEventSender)
	}
	if room.Preview != "decrypted incoming" || !room.Unanswered {
		t.Fatalf("preview = %q, unanswered = %t, want incoming preview and unanswered room", room.Preview, room.Unanswered)
	}
}

func TestSyncStatusPublishesConnectionStates(t *testing.T) {
	client := &Client{
		events: make(chan Update, 4),
		done:   make(chan struct{}),
	}
	client.handleBackendEvent(&jsoncmd.SyncStatus{Type: jsoncmd.SyncStatusWaiting})
	if got := (<-client.events).ConnectionState; got != StateSyncing {
		t.Fatalf("waiting state = %q, want %q", got, StateSyncing)
	}
	client.handleBackendEvent(&jsoncmd.SyncStatus{Type: jsoncmd.SyncStatusOK})
	if update := <-client.events; update.ConnectionState != StateConnected || !update.InitialSyncComplete {
		t.Fatalf("connected update = %+v", update)
	}
	client.handleBackendEvent(&jsoncmd.SyncStatus{Type: jsoncmd.SyncStatusFailed})
	if update := <-client.events; update.ConnectionState != StateOffline || update.Error == "" {
		t.Fatalf("offline update = %+v", update)
	}
}

func TestApplySyncUpdatesRoomsAndRemovesLeftRooms(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms: map[string]Room{
			"!left:example.org": {ID: "!left:example.org", Name: "Left room"},
		},
	}
	name := "Project chat"
	topic := "Planning"
	dmUser := id.UserID("@alice:example.org")
	avatar := id.ContentURIString("mxc://example.org/room-avatar").ParseOrIgnore()
	roomID := id.RoomID("!project:example.org")
	room := &database.Room{
		ID:       roomID,
		Name:     &name,
		Topic:    &topic,
		Avatar:   &avatar,
		DMUserID: &dmUser,
		UnreadCounts: database.UnreadCounts{
			UnreadMessages:      5,
			UnreadNotifications: 2,
			UnreadHighlights:    1,
		},
	}
	latest := time.Date(2026, time.October, 14, 17, 5, 0, 0, time.UTC)
	syncEvent := &jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {
				Meta:     room,
				Timeline: []database.TimelineRowTuple{{Timeline: 7, Event: 7}},
				Events: []*database.Event{
					{
						RowID:     7,
						Type:      event.EventMessage.Type,
						Content:   json.RawMessage(`{"body":"latest"}`),
						Timestamp: jsontime.UM(latest),
					},
				},
			},
		},
		LeftRooms: []id.RoomID{"!left:example.org"},
	}

	client.applySync(syncEvent, true)

	rooms := client.Rooms()
	if len(rooms) != 1 {
		t.Fatalf("room count = %d, want 1", len(rooms))
	}
	got := rooms[0]
	if got.ID != roomID.String() || got.Name != name || got.Topic != topic || got.Avatar != avatar.String() || got.Preview != "latest" {
		t.Fatalf("unexpected room snapshot: %+v", got)
	}
	if !got.Direct || got.Unread != 5 || got.Mentions != 1 {
		t.Fatalf("room direct/unread metadata was not mapped: %+v", got)
	}
	if !got.LastSeen.Equal(latest) {
		t.Fatalf("last seen = %s, want %s", got.LastSeen, latest)
	}
	update := <-client.Events()
	if len(update.ChangedRoomID) != 2 {
		t.Fatalf("changed rooms = %v, want update and removal", update.ChangedRoomID)
	}
}

func TestNewestReadTargetEventIDPrefersNewestServerEvent(t *testing.T) {
	newestFirst := []*database.Event{
		nil,
		{ID: id.EventID("~local-echo")},
		{ID: id.EventID("$undecrypted-newer")},
		{ID: id.EventID("$last-message")},
	}
	if got := newestReadTargetEventID(newestFirst, "$last-message"); got != "$undecrypted-newer" {
		t.Fatalf("read target = %q, want newest server event %q", got, "$undecrypted-newer")
	}
}
