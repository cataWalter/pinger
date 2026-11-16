package matrix

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"strings"
)

// StartDirectChat returns the joined one-to-one room with userID. When none exists it creates an
// encrypted, invite-only direct chat and records it in m.direct so other clients see it too.
func (c *Client) StartDirectChat(ctx context.Context, userID string) (string, error) {
	userID = strings.TrimSpace(userID)
	matrixUserID := id.UserID(userID)
	if _, _, err := matrixUserID.ParseAndValidateRelaxed(); err != nil {
		return "", fmt.Errorf("invalid Matrix user ID %q: %w", userID, err)
	}
	if userID == c.Profile().UserID {
		return "", errors.New("cannot start a direct chat with yourself")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return "", err
	}
	defer finish()

	c.directChatMu.Lock()
	defer c.directChatMu.Unlock()
	direct, err := c.directChatRooms(ctx)
	if err != nil {
		return "", err
	}
	if roomID, ok := c.joinedRoomID(direct[userID]); ok {
		return roomID, nil
	}

	emptyStateKey := ""
	resp, err := c.engine.Client.CreateRoom(ctx, &mautrix.ReqCreateRoom{
		Preset:   "trusted_private_chat",
		IsDirect: true,
		Invite:   []id.UserID{matrixUserID},
		InitialState: []*event.Event{{
			Type:     event.StateEncryption,
			StateKey: &emptyStateKey,
			Content: event.Content{Parsed: &event.EncryptionEventContent{
				Algorithm: id.AlgorithmMegolmV1,
			}},
		}},
	})
	if err != nil {
		return "", fmt.Errorf("create Matrix direct chat: %w", err)
	}
	direct[userID] = append(direct[userID], resp.RoomID)
	if err := c.engine.Client.SetAccountData(ctx, directAccountDataType, direct); err != nil {
		// The room exists and is usable; only the m.direct bookkeeping failed.
		log.Printf("record Matrix direct chat %s: %v", resp.RoomID, err)
	}
	return resp.RoomID.String(), nil
}

// directChatRooms reads the m.direct map of user IDs to their direct room IDs.
func (c *Client) directChatRooms(ctx context.Context) (map[string][]id.RoomID, error) {
	direct := make(map[string][]id.RoomID)
	if err := c.engine.Client.GetAccountData(ctx, directAccountDataType, &direct); err != nil && !errors.Is(err, mautrix.MNotFound) {
		return nil, fmt.Errorf("read Matrix direct chats: %w", err)
	}
	if direct == nil {
		direct = make(map[string][]id.RoomID)
	}
	return direct, nil
}

// joinedRoomID returns the first candidate room that is present in the client's room cache.
func (c *Client) joinedRoomID(candidates []id.RoomID) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, roomID := range candidates {
		if _, ok := c.rooms[roomID.String()]; ok {
			return roomID.String(), true
		}
	}
	return "", false
}

func (c *Client) directRoomAvatars(syncEvent *jsoncmd.SyncComplete) map[string]string {
	if c.engine == nil {
		return nil
	}

	keys := make([]database.RoomStateGUID, 0, len(syncEvent.Rooms))
	roomIDs := make(map[string]struct{}, len(syncEvent.Rooms))
	for roomID, syncRoom := range syncEvent.Rooms {
		if syncRoom == nil || syncRoom.Meta == nil || syncRoom.Meta.DMUserID == nil ||
			(syncRoom.Meta.Avatar != nil && syncRoom.Meta.Avatar.String() != "") {
			continue
		}
		keys = append(keys, database.RoomStateGUID{
			RoomID:   roomID,
			Type:     event.StateMember,
			StateKey: syncRoom.Meta.DMUserID.String(),
		})
		roomIDs[roomID.String()] = struct{}{}
	}
	if len(keys) == 0 {
		return nil
	}

	ctx, finish, err := c.beginOperation(context.Background())
	if err != nil {
		return nil
	}
	defer finish()

	members, err := c.engine.DB.CurrentState.GetMany(ctx, keys)
	if err != nil {
		log.Printf("read Matrix direct-message avatars: %v", err)
		return nil
	}
	avatars := make(map[string]string, len(roomIDs))
	for roomID := range roomIDs {
		avatars[roomID] = ""
	}
	for _, member := range members {
		if member.StateKey == nil {
			continue
		}
		var profile event.MemberEventContent
		if err = json.Unmarshal(member.GetContent(), &profile); err != nil {
			log.Printf("decode Matrix member profile in room %s: %v", member.RoomID, err)
			continue
		}
		avatars[member.RoomID.String()] = string(profile.AvatarURL)
	}
	return avatars
}
