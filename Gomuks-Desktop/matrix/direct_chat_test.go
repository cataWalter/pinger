package matrix

import (
	"testing"

	"maunium.net/go/mautrix/id"
)

func TestJoinedRoomIDReturnsFirstCachedCandidate(t *testing.T) {
	client := &Client{rooms: map[string]Room{
		"!dm:example.org": {},
	}}

	roomID, ok := client.joinedRoomID([]id.RoomID{"!gone:example.org", "!dm:example.org"})
	if !ok || roomID != "!dm:example.org" {
		t.Fatalf("joinedRoomID() = %q, %v; want %q, true", roomID, ok, "!dm:example.org")
	}
}

func TestJoinedRoomIDSkipsRoomsMissingFromCache(t *testing.T) {
	client := &Client{rooms: map[string]Room{}}

	if roomID, ok := client.joinedRoomID([]id.RoomID{"!gone:example.org"}); ok {
		t.Fatalf("joinedRoomID() = %q, true; want no room", roomID)
	}
	if roomID, ok := client.joinedRoomID(nil); ok {
		t.Fatalf("joinedRoomID(nil) = %q, true; want no room", roomID)
	}
}
