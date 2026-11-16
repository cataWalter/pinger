package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewestReadTargetEventIDFallsBackWithoutServerEvents(t *testing.T) {
	if got := newestReadTargetEventID(nil, "$fallback"); got != "$fallback" {
		t.Fatalf("read target with empty timeline = %q, want fallback", got)
	}
	localOnly := []*database.Event{{ID: id.EventID("~local-echo")}}
	if got := newestReadTargetEventID(localOnly, "$fallback"); got != "$fallback" {
		t.Fatalf("read target with only local echoes = %q, want fallback", got)
	}
}

func TestUnreadMessageCountUsesNotificationFallbackWithoutDoubleCounting(t *testing.T) {
	tests := []struct {
		name   string
		counts database.UnreadCounts
		want   int
	}{
		{
			name:   "notification matches overlap with unread messages",
			counts: database.UnreadCounts{UnreadMessages: 2, UnreadNotifications: 2},
			want:   2,
		},
		{
			name:   "notification count is a fallback",
			counts: database.UnreadCounts{UnreadNotifications: 2},
			want:   2,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := unreadMessageCount(test.counts); got != test.want {
				t.Fatalf("unreadMessageCount() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestUnreadReactionCountsExcludeReadAndRedactedEvents(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!unread:example.org")
	userID := id.UserID("@me:example.org")
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}

	events := []*database.Event{
		{ID: "$read-reaction", Type: event.EventReaction.Type, RelationType: event.RelAnnotation, UnreadType: database.UnreadTypeNotify},
		{ID: "$read", Type: event.EventMessage.Type},
		{ID: "$unread-reaction", Type: event.EventReaction.Type, RelationType: event.RelAnnotation, UnreadType: database.UnreadTypeNotify | database.UnreadTypeHighlight},
		{ID: "$unread-message", Type: event.EventMessage.Type, UnreadType: database.UnreadTypeNotify | database.UnreadTypeNormal},
		{ID: "$redacted-reaction", Type: event.EventReaction.Type, RelationType: event.RelAnnotation, RedactedBy: "$redaction", UnreadType: database.UnreadTypeNotify},
		{ID: "$encrypted-reaction", Type: event.EventEncrypted.Type, DecryptedType: event.EventReaction.Type, RelationType: event.RelAnnotation, UnreadType: database.UnreadTypeNotify | database.UnreadTypeNormal},
	}
	rowIDs := make([]database.EventRowID, 0, len(events))
	for _, dbEvent := range events {
		dbEvent.RoomID = roomID
		dbEvent.Sender = "@alice:example.org"
		dbEvent.Content = json.RawMessage(`{}`)
		dbEvent.Unsigned = json.RawMessage(`{}`)
		rowID, insertErr := client.engine.DB.Event.Insert(ctx, dbEvent)
		if insertErr != nil {
			t.Fatalf("insert event %s: %v", dbEvent.ID, insertErr)
		}
		rowIDs = append(rowIDs, rowID)
	}
	if _, err = client.engine.DB.Timeline.Append(ctx, roomID, rowIDs); err != nil {
		t.Fatalf("append timeline: %v", err)
	}
	if err = client.engine.DB.Receipt.Put(ctx, &database.Receipt{
		RoomID: roomID, UserID: userID, ReceiptType: event.ReceiptType("m.read"), EventID: "$read",
	}); err != nil {
		t.Fatalf("insert read receipt: %v", err)
	}

	reactions, err := client.unreadReactionCounts(ctx, roomID, userID)
	if err != nil {
		t.Fatalf("count unread reactions: %v", err)
	}
	wantReactions := database.UnreadCounts{UnreadHighlights: 1, UnreadNotifications: 2, UnreadMessages: 1}
	if reactions != wantReactions {
		t.Fatalf("unread reaction counts = %+v, want %+v", reactions, wantReactions)
	}

	counts := unreadCountsWithoutReactions(database.UnreadCounts{
		UnreadHighlights: 1, UnreadNotifications: 4, UnreadMessages: 2,
	}, reactions)
	if got := unreadMessageCount(counts); got != 2 || counts.UnreadHighlights != 0 {
		t.Fatalf("unread counts after excluding reactions = %+v, badge = %d", counts, got)
	}
}

func TestApplySyncUsesDirectRoomMemberAvatar(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!dm:example.org")
	userID := id.UserID("@alice:example.org")
	avatar := id.ContentURIString("mxc://example.org/alice-avatar")
	stateKey := userID.String()
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	memberEvent := &database.Event{
		RoomID:    roomID,
		ID:        id.EventID("$alice-member"),
		Sender:    userID,
		Type:      event.StateMember.Type,
		StateKey:  &stateKey,
		Timestamp: jsontime.UM(time.Now()),
		Content:   json.RawMessage(`{"displayname":"Alice","avatar_url":"` + string(avatar) + `"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	rowID, err := client.engine.DB.Event.Insert(ctx, memberEvent)
	if err != nil {
		t.Fatalf("insert member state: %v", err)
	}
	if err = client.engine.DB.CurrentState.Set(ctx, roomID, event.StateMember, userID.String(), rowID, ""); err != nil {
		t.Fatalf("set current member state: %v", err)
	}

	displayName := "Alice"
	client.applySync(&jsoncmd.SyncComplete{
		Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
			roomID: {Meta: &database.Room{ID: roomID, Name: &displayName, DMUserID: &userID}},
		},
	}, false)

	rooms := client.Rooms()
	if len(rooms) != 1 || rooms[0].Avatar != string(avatar) {
		t.Fatalf("direct room avatar = %+v, want %q", rooms, avatar)
	}
}

func TestEnrichOwnMessageUsesRoomMemberAvatar(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	roomID := id.RoomID("!chat:example.org")
	userID := id.UserID("@me:example.org")
	avatar := id.ContentURIString("mxc://example.org/me-avatar")
	stateKey := userID.String()
	if err = client.engine.DB.Room.CreateRow(ctx, roomID); err != nil {
		t.Fatalf("create room row: %v", err)
	}
	memberEvent := &database.Event{
		RoomID:    roomID,
		ID:        id.EventID("$me-member"),
		Sender:    userID,
		Type:      event.StateMember.Type,
		StateKey:  &stateKey,
		Timestamp: jsontime.UM(time.Now()),
		Content:   json.RawMessage(`{"displayname":"Me","avatar_url":"` + string(avatar) + `"}`),
		Unsigned:  json.RawMessage(`{}`),
	}
	rowID, err := client.engine.DB.Event.Insert(ctx, memberEvent)
	if err != nil {
		t.Fatalf("insert member state: %v", err)
	}
	if err = client.engine.DB.CurrentState.Set(ctx, roomID, event.StateMember, userID.String(), rowID, ""); err != nil {
		t.Fatalf("set current member state: %v", err)
	}

	message := client.enrichOwnMessage(ctx, roomID.String(), Message{Sender: userID.String(), Own: true})
	if message.Avatar != string(avatar) || message.SenderName != "Me" {
		t.Fatalf("own message profile = %+v, want member avatar and display name", message)
	}
}

func TestApplySyncClassifiesUnmarkedDirectRoomsByMemberCount(t *testing.T) {
	tests := []struct {
		name       string
		joined     int
		invited    int
		wantDirect bool
	}{
		{name: "two joined members", joined: 2, wantDirect: true},
		{name: "joined and invited members", joined: 1, invited: 1, wantDirect: true},
		{name: "three joined members", joined: 3, wantDirect: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			roomID := id.RoomID("!" + strings.ReplaceAll(test.name, " ", "-") + ":example.org")
			joined, invited := test.joined, test.invited
			client := &Client{rooms: make(map[string]Room)}
			client.applySync(&jsoncmd.SyncComplete{
				Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
					roomID: {Meta: &database.Room{
						ID: roomID,
						LazyLoadSummary: &mautrix.LazyLoadSummary{
							JoinedMemberCount:  &joined,
							InvitedMemberCount: &invited,
						},
					}},
				},
			}, false)

			rooms := client.Rooms()
			if len(rooms) != 1 || rooms[0].Direct != test.wantDirect {
				t.Fatalf("direct = %v, want %v; rooms = %+v", len(rooms) == 1 && rooms[0].Direct, test.wantDirect, rooms)
			}
		})
	}
}

func TestApplySyncClassifiesExplicitBridgedPrivateChatAsDirect(t *testing.T) {
	for _, test := range []struct {
		name       string
		topic      string
		wantDirect bool
	}{
		{name: "private chat", topic: "WhatsApp private chat", wantDirect: true},
		{name: "group chat", topic: "WhatsApp group chat", wantDirect: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			roomID := id.RoomID("!" + strings.ReplaceAll(test.name, " ", "-") + ":example.org")
			client := &Client{rooms: make(map[string]Room)}
			client.applySync(&jsoncmd.SyncComplete{
				Rooms: map[id.RoomID]*jsoncmd.SyncRoom{
					roomID: {Meta: &database.Room{ID: roomID, Topic: &test.topic}},
				},
			}, false)

			rooms := client.Rooms()
			if len(rooms) != 1 || rooms[0].Direct != test.wantDirect {
				t.Fatalf("direct = %v, want %v; rooms = %+v", len(rooms) == 1 && rooms[0].Direct, test.wantDirect, rooms)
			}
		})
	}
}
