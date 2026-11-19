package matrix

import (
	"context"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"sort"
	"strings"
	"time"
)

const maxInvitesPerCall = 50

// Invite is a pending room invitation built from the (untrusted) stripped invite state.
type Invite struct {
	RoomID      string
	Name        string
	Topic       string
	Avatar      string
	Inviter     string
	InviterName string
	Direct      bool
	InvitedAt   time.Time
}

func inviteFromInvitedRoom(room *database.InvitedRoom, self id.UserID) Invite {
	invite := Invite{RoomID: room.ID.String(), InvitedAt: room.CreatedAt.Time}
	alias := ""
	memberNames := make(map[string]string)
	for _, evt := range room.InviteState {
		if evt == nil {
			continue
		}
		switch evt.Type {
		case event.StateRoomName:
			invite.Name, _ = evt.Content.Raw["name"].(string)
		case event.StateTopic:
			invite.Topic, _ = evt.Content.Raw["topic"].(string)
		case event.StateRoomAvatar:
			invite.Avatar, _ = evt.Content.Raw["url"].(string)
		case event.StateCanonicalAlias:
			alias, _ = evt.Content.Raw["alias"].(string)
		case event.StateMember:
			stateKey := evt.GetStateKey()
			if name, _ := evt.Content.Raw["displayname"].(string); name != "" {
				memberNames[stateKey] = name
			}
			if id.UserID(stateKey) == self {
				invite.Inviter = evt.Sender.String()
			}
		}
	}
	invite.InviterName = memberNames[invite.Inviter]
	invite.Direct = room.GetDMUserID(self) != ""
	invite.Name = strings.TrimSpace(invite.Name)
	if invite.Name == "" {
		invite.Name = alias
	}
	if invite.Name == "" && invite.Direct {
		invite.Name = firstNonEmpty(invite.InviterName, invite.Inviter)
	}
	if invite.Name == "" {
		invite.Name = invite.RoomID
	}
	return invite
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// Invites returns pending invitations, newest first.
func (c *Client) Invites() []Invite {
	c.mu.RLock()
	invites := make([]Invite, 0, len(c.invites))
	for _, invite := range c.invites {
		invites = append(invites, invite)
	}
	c.mu.RUnlock()
	sort.Slice(invites, func(i, j int) bool {
		if invites[i].InvitedAt.Equal(invites[j].InvitedAt) {
			return invites[i].RoomID < invites[j].RoomID
		}
		return invites[i].InvitedAt.After(invites[j].InvitedAt)
	})
	return invites
}

func validateRoomID(roomID string) (id.RoomID, error) {
	roomID = strings.TrimSpace(roomID)
	if len(roomID) < 2 || roomID[0] != '!' || len(roomID) > 255 || strings.ContainsAny(roomID, " \t\r\n") {
		return "", fmt.Errorf("invalid Matrix room ID %q", roomID)
	}
	return id.RoomID(roomID), nil
}

// AcceptInvite joins an invited room and shows it in the room list right away.
func (c *Client) AcceptInvite(ctx context.Context, roomID string) (string, error) {
	matrixRoomID, err := validateRoomID(roomID)
	if err != nil {
		return "", err
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return "", err
	}
	defer finish()
	if _, err = c.engine.Client.JoinRoom(ctx, matrixRoomID.String(), nil); err != nil {
		return "", fmt.Errorf("accept invitation: %w", err)
	}
	c.markJoined(matrixRoomID.String(), Room{})
	return matrixRoomID.String(), nil
}

// DeclineInvite rejects an invitation.
func (c *Client) DeclineInvite(ctx context.Context, roomID string) error {
	matrixRoomID, err := validateRoomID(roomID)
	if err != nil {
		return err
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if _, err = c.engine.Client.LeaveRoom(ctx, matrixRoomID); err != nil {
		return fmt.Errorf("decline invitation: %w", err)
	}
	c.mu.Lock()
	delete(c.invites, matrixRoomID.String())
	c.mu.Unlock()
	c.publish([]string{matrixRoomID.String()}, "")
	return nil
}

func normalizeInvitees(userIDs []string, self string) ([]id.UserID, error) {
	invitees := make([]id.UserID, 0, len(userIDs))
	seen := make(map[string]struct{}, len(userIDs))
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" || userID == self {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		if _, _, err := id.UserID(userID).ParseAndValidateRelaxed(); err != nil {
			return nil, fmt.Errorf("invalid Matrix user ID %q: %w", userID, err)
		}
		seen[userID] = struct{}{}
		invitees = append(invitees, id.UserID(userID))
	}
	if len(invitees) > maxInvitesPerCall {
		return nil, fmt.Errorf("invite at most %d people at a time", maxInvitesPerCall)
	}
	return invitees, nil
}
