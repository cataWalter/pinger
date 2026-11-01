package matrix

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func strippedState(evtType event.Type, stateKey string, sender id.UserID, content map[string]any) *event.Event {
	return &event.Event{Type: evtType, StateKey: &stateKey, Sender: sender, Content: event.Content{Raw: content}}
}

func TestInviteFromInvitedRoomReadsGroupDetails(t *testing.T) {
	self := id.UserID("@me:example.org")
	invitedAt := time.UnixMilli(1_700_000_000_000)
	invite := inviteFromInvitedRoom(&database.InvitedRoom{
		ID:        "!team:example.org",
		CreatedAt: jsontime.UM(invitedAt),
		InviteState: []*event.Event{
			strippedState(event.StateRoomName, "", "@alice:example.org", map[string]any{"name": " Team "}),
			strippedState(event.StateTopic, "", "@alice:example.org", map[string]any{"topic": "Plans"}),
			strippedState(event.StateRoomAvatar, "", "@alice:example.org", map[string]any{"url": "mxc://example.org/avatar"}),
			strippedState(event.StateMember, "@alice:example.org", "@alice:example.org", map[string]any{"membership": "join", "displayname": "Alice"}),
			strippedState(event.StateMember, string(self), "@alice:example.org", map[string]any{"membership": "invite"}),
		},
	}, self)

	want := Invite{
		RoomID:      "!team:example.org",
		Name:        "Team",
		Topic:       "Plans",
		Avatar:      "mxc://example.org/avatar",
		Inviter:     "@alice:example.org",
		InviterName: "Alice",
		InvitedAt:   invitedAt,
	}
	if !invite.InvitedAt.Equal(want.InvitedAt) {
		t.Fatalf("InvitedAt = %v, want %v", invite.InvitedAt, want.InvitedAt)
	}
	invite.InvitedAt = want.InvitedAt
	if invite != want {
		t.Fatalf("invite = %#v, want %#v", invite, want)
	}
}

func TestInviteFromInvitedRoomNamesDirectChatsAfterInviter(t *testing.T) {
	self := id.UserID("@me:example.org")
	invite := inviteFromInvitedRoom(&database.InvitedRoom{
		ID: "!dm:example.org",
		InviteState: []*event.Event{
			strippedState(event.StateJoinRules, "", "@bob:example.org", map[string]any{"join_rule": "invite"}),
			strippedState(event.StateMember, "@bob:example.org", "@bob:example.org", map[string]any{"membership": "join", "displayname": "Bob"}),
			strippedState(event.StateMember, string(self), "@bob:example.org", map[string]any{"membership": "invite", "is_direct": true}),
		},
	}, self)
	if !invite.Direct || invite.Name != "Bob" || invite.Inviter != "@bob:example.org" {
		t.Fatalf("invite = %#v, want a direct chat named after Bob", invite)
	}

	bare := inviteFromInvitedRoom(&database.InvitedRoom{ID: "!bare:example.org"}, self)
	if bare.Name != "!bare:example.org" || bare.Direct {
		t.Fatalf("bare invite = %#v, want the room ID as its name", bare)
	}
}

func TestApplySyncTracksInvitesUntilJoinedOrLeft(t *testing.T) {
	client := &Client{rooms: map[string]Room{}}
	client.applySync(&jsoncmd.SyncComplete{InvitedRooms: []*database.InvitedRoom{
		{ID: "!first:example.org", CreatedAt: jsontime.UM(time.UnixMilli(1000))},
		{ID: "!second:example.org", CreatedAt: jsontime.UM(time.UnixMilli(2000))},
	}}, false)

	invites := client.Invites()
	if len(invites) != 2 || invites[0].RoomID != "!second:example.org" || invites[1].RoomID != "!first:example.org" {
		t.Fatalf("Invites() = %#v, want newest first", invites)
	}

	client.applySync(&jsoncmd.SyncComplete{
		Rooms:     map[id.RoomID]*jsoncmd.SyncRoom{"!first:example.org": {}},
		LeftRooms: []id.RoomID{"!second:example.org"},
	}, false)
	if invites := client.Invites(); len(invites) != 0 {
		t.Fatalf("Invites() = %#v, want none after join and decline", invites)
	}
	if _, ok := client.rooms["!first:example.org"]; !ok {
		t.Fatal("joined invite was not added to the room list")
	}
}

func TestMarkJoinedShowsInvitedRoomImmediately(t *testing.T) {
	client, err := New(filepath.Join(t.TempDir(), "profile", "matrix.db"))
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer client.Close()
	client.mu.Lock()
	client.invites["!team:example.org"] = Invite{RoomID: "!team:example.org", Name: "Team", Topic: "Plans", Avatar: "mxc://example.org/a"}
	client.rooms["!known:example.org"] = Room{ID: "!known:example.org", Name: "Known"}
	client.mu.Unlock()

	client.markJoined("!team:example.org", Room{})
	client.markJoined("!known:example.org", Room{Name: "Placeholder"})
	client.markJoined("!new:example.org", Room{})

	client.mu.RLock()
	defer client.mu.RUnlock()
	if room := client.rooms["!team:example.org"]; room.Name != "Team" || room.Topic != "Plans" || room.Avatar != "mxc://example.org/a" || room.LastSeen.IsZero() {
		t.Fatalf("joined invite room = %#v", room)
	}
	if room := client.rooms["!known:example.org"]; room.Name != "Known" {
		t.Fatalf("markJoined overwrote a synced room: %#v", room)
	}
	if room := client.rooms["!new:example.org"]; room.Name != "!new:example.org" {
		t.Fatalf("placeholder room = %#v, want the room ID as its name", room)
	}
	if len(client.invites) != 0 {
		t.Fatalf("invites = %#v, want the accepted invite removed", client.invites)
	}
}

func TestParseJoinTarget(t *testing.T) {
	tests := []struct {
		name    string
		target  string
		want    string
		via     []string
		wantErr string
	}{
		{name: "alias", target: " #room:example.org ", want: "#room:example.org"},
		{name: "room ID routes via its server", target: "!abc:example.org", want: "!abc:example.org", via: []string{"example.org"}},
		{name: "server-less room ID", target: "!abcdef", want: "!abcdef"},
		{name: "matrix.to alias", target: "https://matrix.to/#/%23room:example.org", want: "#room:example.org"},
		{name: "matrix.to room ID with via", target: "https://matrix.to/#/!abc:example.org?via=other.org", want: "!abc:example.org", via: []string{"other.org"}},
		{name: "matrix URI", target: "matrix:r/room:example.org", want: "#room:example.org"},
		{name: "empty", target: "  ", wantErr: "enter a room address"},
		{name: "user ID", target: "@alice:example.org", wantErr: "person"},
		{name: "matrix.to user", target: "https://matrix.to/#/@alice:example.org", wantErr: "person"},
		{name: "alias without server", target: "#room", wantErr: "invalid room address"},
		{name: "plain words", target: "my room", wantErr: "invalid room address"},
		{name: "other website", target: "https://example.org/room", wantErr: "not a Matrix room link"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, via, err := parseJoinTarget(test.target)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("parseJoinTarget(%q) error = %v, want %q", test.target, err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseJoinTarget(%q) error = %v", test.target, err)
			}
			if got != test.want || strings.Join(via, ",") != strings.Join(test.via, ",") {
				t.Fatalf("parseJoinTarget(%q) = %q, %v; want %q, %v", test.target, got, via, test.want, test.via)
			}
		})
	}
}

func TestNormalizeInviteesDropsSelfAndDuplicates(t *testing.T) {
	invitees, err := normalizeInvitees([]string{" @alice:example.org ", "", "@me:example.org", "@alice:example.org", "@bob:example.org"}, "@me:example.org")
	if err != nil {
		t.Fatalf("normalizeInvitees() error = %v", err)
	}
	if len(invitees) != 2 || invitees[0] != "@alice:example.org" || invitees[1] != "@bob:example.org" {
		t.Fatalf("normalizeInvitees() = %v", invitees)
	}
	if _, err = normalizeInvitees([]string{"alice"}, ""); err == nil {
		t.Fatal("normalizeInvitees() accepted an invalid Matrix ID")
	}
	tooMany := make([]string, maxInvitesPerCall+1)
	for index := range tooMany {
		tooMany[index] = "@user" + strings.Repeat("x", index) + ":example.org"
	}
	if _, err = normalizeInvitees(tooMany, ""); err == nil {
		t.Fatal("normalizeInvitees() accepted too many people")
	}
}

func TestRoomOperationsRejectInvalidInputBeforeNetwork(t *testing.T) {
	client := &Client{}
	if _, err := client.AcceptInvite(t.Context(), "#alias:example.org"); err == nil {
		t.Fatal("AcceptInvite() accepted an alias")
	}
	if err := client.DeclineInvite(t.Context(), ""); err == nil {
		t.Fatal("DeclineInvite() accepted an empty room ID")
	}
	if _, err := client.CreateGroupRoom(t.Context(), GroupRoomRequest{Name: "  "}); err == nil || !strings.Contains(err.Error(), "room name") {
		t.Fatalf("CreateGroupRoom() error = %v, want a missing name error", err)
	}
	if _, err := client.CreateGroupRoom(t.Context(), GroupRoomRequest{Name: strings.Repeat("x", maxRoomNameLength+1)}); err == nil {
		t.Fatal("CreateGroupRoom() accepted an overlong name")
	}
	if err := client.InviteUsers(t.Context(), "!room:example.org", []string{" "}); err == nil || !strings.Contains(err.Error(), "Matrix ID") {
		t.Fatalf("InviteUsers() error = %v, want a missing invitee error", err)
	}
}
