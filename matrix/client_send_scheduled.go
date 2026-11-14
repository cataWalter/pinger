package matrix

import (
	"context"
	"errors"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"strings"
)

func (c *Client) SendScheduledMessage(ctx context.Context, roomID, text, replyTo, transactionID string, onQueued func(string) error) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("scheduled message cannot be empty")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	c.sendMu.Lock()
	var evt *database.Event
	if transactionID != "" {
		evt, err = c.engine.DB.Event.GetByTransactionID(ctx, transactionID)
		if err == nil && (evt == nil || evt.RoomID != id.RoomID(roomID)) {
			err = errors.New("scheduled message transaction not found in its room; check the room before retrying")
		}
		if err == nil && evt.ID != "" && !strings.HasPrefix(evt.ID.String(), "~") {
			c.sendMu.Unlock()
			return nil
		}
		if err == nil {
			evt, err = c.engine.Resend(ctx, transactionID)
		}
	} else {
		var relation *event.RelatesTo
		if replyTo != "" {
			relation = &event.RelatesTo{InReplyTo: &event.InReplyTo{EventID: id.EventID(replyTo)}}
		}
		evt, err = c.engine.SendMessage(ctx, id.RoomID(roomID), nil, nil, text, relation, nil, nil)
	}
	if err != nil {
		c.sendMu.Unlock()
		return fmt.Errorf("queue scheduled Matrix message: %w", err)
	}
	if evt == nil || evt.TransactionID == "" {
		c.sendMu.Unlock()
		return errors.New("scheduled message has no delivery transaction; check the room before retrying")
	}
	if c.scheduledSends == nil {
		c.scheduledSends = make(map[string]chan error)
	}
	completion := make(chan error, 1)
	c.scheduledSends[evt.TransactionID] = completion
	if message, ok := messageFromEvent(evt); ok {
		message.Sending = true
		message.Own = c.isOwnMessage(message)
		c.storeLocalMessage(roomID, message)
	}
	if onQueued != nil {
		err = onQueued(evt.TransactionID)
	}
	c.sendMu.Unlock()
	defer func() {
		c.sendMu.Lock()
		if c.scheduledSends[evt.TransactionID] == completion {
			delete(c.scheduledSends, evt.TransactionID)
		}
		c.sendMu.Unlock()
	}()
	c.publishTimeline([]string{roomID}, "")
	if err != nil {
		return fmt.Errorf("persist scheduled transaction; message may already be sending: %w", err)
	}
	select {
	case sendErr := <-completion:
		return sendErr
	case <-ctx.Done():
		return fmt.Errorf("delivery not confirmed; check the room before retrying: %w", ctx.Err())
	}
}

func (c *Client) completeScheduledSendLocked(evt *jsoncmd.SendComplete) {
	if evt.Event == nil {
		return
	}
	completion := c.scheduledSends[evt.Event.TransactionID]
	if completion == nil {
		return
	}
	sendErr := evt.Error
	if sendErr == nil && evt.Event.SendError != "" && evt.Event.SendError != "not sent" {
		sendErr = errors.New(evt.Event.SendError)
	}
	if sendErr == nil && (evt.Event.ID == "" || strings.HasPrefix(evt.Event.ID.String(), "~")) {
		return
	}
	delete(c.scheduledSends, evt.Event.TransactionID)
	completion <- sendErr
}
