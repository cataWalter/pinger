package matrix

import (
	"context"
	"errors"
	"fmt"
	"maunium.net/go/mautrix"
	"time"
)

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
