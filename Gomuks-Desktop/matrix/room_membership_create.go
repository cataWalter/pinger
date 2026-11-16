package matrix

import (
	"context"
	"errors"
	"fmt"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"strings"
	"time"
	"unicode/utf8"
)

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
