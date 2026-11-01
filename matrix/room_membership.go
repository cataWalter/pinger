package matrix

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const (
	maxRoomNameLength  = 255
	maxRoomTopicLength = 1000
	maxInvitesPerCall  = 50
)

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

// GroupRoomRequest describes a new multi-person room.
type GroupRoomRequest struct {
	Name      string
	Topic     string
	Invitees  []string
	Encrypted bool
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

// parseJoinTarget accepts a room ID, a room alias, a matrix.to link or a matrix: URI.
func parseJoinTarget(target string) (string, []string, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return "", nil, errors.New("enter a room address")
	}
	if strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "matrix:") {
		uri, err := id.ParseMatrixURIOrMatrixToURL(target)
		if err != nil {
			return "", nil, fmt.Errorf("not a Matrix room link: %w", err)
		}
		switch uri.Sigil1 {
		case '!', '#':
			target = uri.PrimaryIdentifier()
			via := slices.DeleteFunc(slices.Clone(uri.Via), func(server string) bool { return strings.TrimSpace(server) == "" })
			if _, err = validateJoinIdentifier(target); err != nil {
				return "", nil, err
			}
			return target, via, nil
		default:
			return "", nil, errors.New("that link points to a person, not a room")
		}
	}
	server, err := validateJoinIdentifier(target)
	if err != nil {
		return "", nil, err
	}
	if target[0] == '!' && server != "" {
		return target, []string{server}, nil
	}
	return target, nil, nil
}

func validateJoinIdentifier(target string) (string, error) {
	if len(target) > 255 || strings.ContainsAny(target, " \t\r\n") {
		return "", fmt.Errorf("invalid room address %q", target)
	}
	sigil, localpart, server := id.ParseCommonIdentifier(target)
	switch {
	case sigil == '#' && localpart != "" && server != "":
		return server, nil
	case sigil == '!' && localpart != "":
		// Room version 12 IDs have no server part.
		return server, nil
	case sigil == '@':
		return "", errors.New("that is a person's Matrix ID, not a room")
	default:
		return "", fmt.Errorf("invalid room address %q: use #alias:server, !roomid or a matrix.to link", target)
	}
}

// JoinRoom joins a public room or a room the user has the address of.
func (c *Client) JoinRoom(ctx context.Context, target string) (string, error) {
	roomIDOrAlias, via, err := parseJoinTarget(target)
	if err != nil {
		return "", err
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return "", err
	}
	defer finish()
	resp, err := c.engine.Client.JoinRoom(ctx, roomIDOrAlias, &mautrix.ReqJoinRoom{Via: via})
	if err != nil {
		return "", fmt.Errorf("join room: %w", err)
	}
	roomID := resp.RoomID.String()
	name := ""
	if roomIDOrAlias[0] == '#' {
		name = roomIDOrAlias
	}
	c.markJoined(roomID, Room{Name: name})
	return roomID, nil
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

// CreateGroupRoom creates a private, invite-only room and invites the given people.
func (c *Client) CreateGroupRoom(ctx context.Context, request GroupRoomRequest) (string, error) {
	name := strings.TrimSpace(request.Name)
	topic := strings.TrimSpace(request.Topic)
	if name == "" {
		return "", errors.New("enter a room name")
	}
	if utf8.RuneCountInString(name) > maxRoomNameLength {
		return "", fmt.Errorf("room names can be at most %d characters", maxRoomNameLength)
	}
	if utf8.RuneCountInString(topic) > maxRoomTopicLength {
		return "", fmt.Errorf("room topics can be at most %d characters", maxRoomTopicLength)
	}
	invitees, err := normalizeInvitees(request.Invitees, c.currentUserID())
	if err != nil {
		return "", err
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return "", err
	}
	defer finish()
	create := &mautrix.ReqCreateRoom{
		Preset:     "private_chat",
		Visibility: "private",
		Name:       name,
		Topic:      topic,
		Invite:     invitees,
	}
	if request.Encrypted {
		emptyStateKey := ""
		create.InitialState = []*event.Event{{
			Type:     event.StateEncryption,
			StateKey: &emptyStateKey,
			Content: event.Content{Parsed: &event.EncryptionEventContent{
				Algorithm: id.AlgorithmMegolmV1,
			}},
		}}
	}
	resp, err := c.engine.Client.CreateRoom(ctx, create)
	if err != nil {
		return "", fmt.Errorf("create room: %w", err)
	}
	roomID := resp.RoomID.String()
	c.markJoined(roomID, Room{Name: name, Topic: topic})
	return roomID, nil
}

// InviteUsers invites people to a joined room. It tries everyone and reports every failure.
func (c *Client) InviteUsers(ctx context.Context, roomID string, userIDs []string) error {
	matrixRoomID, err := validateRoomID(roomID)
	if err != nil {
		return err
	}
	invitees, err := normalizeInvitees(userIDs, c.currentUserID())
	if err != nil {
		return err
	}
	if len(invitees) == 0 {
		return errors.New("enter a Matrix ID to invite, like @name:example.org")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	var failures []error
	for _, userID := range invitees {
		if _, err := c.engine.Client.InviteUser(ctx, matrixRoomID, &mautrix.ReqInviteUser{UserID: userID}); err != nil {
			failures = append(failures, fmt.Errorf("invite %s: %w", userID, err))
		}
	}
	return errors.Join(failures...)
}

// markJoined shows a just-joined room before sync delivers it.
func (c *Client) markJoined(roomID string, placeholder Room) {
	c.mu.Lock()
	invite, invited := c.invites[roomID]
	delete(c.invites, roomID)
	if _, exists := c.rooms[roomID]; !exists {
		placeholder.ID = roomID
		if invited {
			placeholder.Name = firstNonEmpty(placeholder.Name, invite.Name)
			placeholder.Topic = firstNonEmpty(placeholder.Topic, invite.Topic)
			placeholder.Avatar = invite.Avatar
			placeholder.Direct = invite.Direct
		}
		placeholder.Name = firstNonEmpty(placeholder.Name, roomID)
		placeholder.LastSeen = time.Now()
		c.rooms[roomID] = placeholder
	}
	c.mu.Unlock()
	c.publish([]string{roomID}, "")
}
