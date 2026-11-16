package desktop

import (
	"testing"
	"time"

	"mychat/matrix"
)

func TestMapUpdateIncludesInvites(t *testing.T) {
	update := mapUpdate(matrix.Update{Invites: []matrix.Invite{
		{RoomID: "!team:example.org", Name: "Team", Inviter: "@alice:example.org", InviterName: "Alice", Direct: true, InvitedAt: time.UnixMilli(1234)},
		{RoomID: "!old:example.org", Name: "Old"},
	}}, nil)
	want := []Invite{
		{RoomID: "!team:example.org", Name: "Team", Inviter: "@alice:example.org", InviterName: "Alice", Direct: true, InvitedAt: 1234},
		{RoomID: "!old:example.org", Name: "Old"},
	}
	if len(update.Invites) != len(want) || update.Invites[0] != want[0] || update.Invites[1] != want[1] {
		t.Fatalf("invites = %#v, want %#v", update.Invites, want)
	}
	if empty := mapUpdate(matrix.Update{}, nil); empty.Invites == nil {
		t.Fatal("empty invites must serialize as a list, not null")
	}
}

func TestRoomMembershipCallsNeedAnActiveAccount(t *testing.T) {
	service := &AppService{}
	if _, err := service.AcceptInvite("!room:example.org"); err == nil {
		t.Fatal("AcceptInvite() succeeded without an account")
	}
	if err := service.DeclineInvite("!room:example.org"); err == nil {
		t.Fatal("DeclineInvite() succeeded without an account")
	}
	if _, err := service.JoinRoom("#room:example.org"); err == nil {
		t.Fatal("JoinRoom() succeeded without an account")
	}
	if _, err := service.CreateGroupRoom(GroupRoomRequest{Name: "Team"}); err == nil {
		t.Fatal("CreateGroupRoom() succeeded without an account")
	}
	if err := service.InviteToRoom("!room:example.org", []string{"@alice:example.org"}); err == nil {
		t.Fatal("InviteToRoom() succeeded without an account")
	}
	if _, err := service.URLPreview("https://example.org/"); err == nil {
		t.Fatal("URLPreview() succeeded without an account")
	}
	if _, err := service.ThreadMessages("!room:example.org", "$root"); err == nil {
		t.Fatal("ThreadMessages() succeeded without an account")
	}
	if err := service.SendThreadReply("!room:example.org", "hi", "$root"); err == nil {
		t.Fatal("SendThreadReply() succeeded without an account")
	}
	for name, call := range map[string]func() error{
		"StartSessionVerification":   service.StartSessionVerification,
		"AcceptSessionVerification":  service.AcceptSessionVerification,
		"ConfirmSessionVerification": service.ConfirmSessionVerification,
		"CancelSessionVerification":  func() error { return service.CancelSessionVerification(false) },
	} {
		if err := call(); err == nil {
			t.Fatalf("%s() succeeded without an account", name)
		}
	}
}

func TestMapUpdateIncludesVerification(t *testing.T) {
	if update := mapUpdate(matrix.Update{}, nil); update.Verification != nil {
		t.Fatalf("verification = %#v, want nil", update.Verification)
	}
	update := mapUpdate(matrix.Update{Verification: &matrix.Verification{
		TransactionID: "txn",
		UserID:        "@me:example.org",
		DeviceID:      "PHONE",
		Incoming:      true,
		Phase:         matrix.VerificationComparing,
		Emojis:        []matrix.SASEmoji{{Emoji: "🐶", Description: "Dog"}},
		Decimals:      []int{1, 2, 3},
	}}, nil)
	got := update.Verification
	if got == nil || got.TransactionID != "txn" || got.DeviceID != "PHONE" || !got.Incoming || got.Phase != "comparing" {
		t.Fatalf("verification = %#v", got)
	}
	if len(got.Emojis) != 1 || got.Emojis[0] != (SASEmoji{Emoji: "🐶", Description: "Dog"}) || len(got.Decimals) != 3 {
		t.Fatalf("emoji = %#v decimals = %#v", got.Emojis, got.Decimals)
	}
}

func TestMapMessagesKeepsThreadRoot(t *testing.T) {
	mapped := mapMessages([]matrix.Message{{ID: "$reply", ThreadRootID: "$root", Timestamp: time.UnixMilli(5)}})
	if len(mapped) != 1 || mapped[0].ThreadRootID != "$root" {
		t.Fatalf("mapped = %#v, want thread root $root", mapped)
	}
}

func TestTagRoomsSetsOwningAccount(t *testing.T) {
	rooms := []Room{{ID: "!one:example.org", Name: "One"}, {ID: "!two:example.org", Name: "Two"}}

	tagRooms(rooms, "second")

	for _, room := range rooms {
		if room.AccountID != "second" {
			t.Fatalf("room %s account = %q, want %q", room.ID, room.AccountID, "second")
		}
	}
	if rooms[0].Name != "One" || rooms[1].ID != "!two:example.org" {
		t.Fatalf("tagRooms altered other fields: %+v", rooms)
	}
}
