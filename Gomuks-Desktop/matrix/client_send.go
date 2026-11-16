package matrix

import (
	"context"
	"errors"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"strings"
	"time"
)

func (c *Client) SendMessage(ctx context.Context, roomID, text string) error {
	return c.sendMessage(ctx, roomID, text, nil, nil)
}

func (c *Client) SendMessageWithMentions(ctx context.Context, roomID, text string, userIDs []string) error {
	mentions := &event.Mentions{}
	for _, userID := range userIDs {
		matrixUserID := id.UserID(userID)
		if _, _, err := matrixUserID.ParseAndValidateStrict(); err == nil {
			mentions.UserIDs = append(mentions.UserIDs, matrixUserID)
		}
	}
	if len(mentions.UserIDs) == 0 {
		mentions = nil
	}
	return c.sendMessage(ctx, roomID, text, nil, mentions)
}

func (c *Client) SendReply(ctx context.Context, roomID, text, replyTo string) error {
	if replyTo == "" {
		return errors.New("reply target event ID is empty")
	}
	return c.sendMessage(ctx, roomID, text, &event.RelatesTo{
		InReplyTo: &event.InReplyTo{EventID: id.EventID(replyTo)},
	}, nil)
}

func (c *Client) EditMessage(ctx context.Context, roomID, text, editID string) error {
	if editID == "" || strings.HasPrefix(editID, "~") {
		return errors.New("cannot edit a message without a server event ID")
	}
	return c.sendMessage(ctx, roomID, text, &event.RelatesTo{
		Type:    event.RelReplace,
		EventID: id.EventID(editID),
	}, nil)
}

func (c *Client) sendMessage(ctx context.Context, roomID, text string, relation *event.RelatesTo, mentions *event.Mentions) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	// gomuks persists the event and sends it asynchronously through its engine.
	// Serialize registration with SendComplete so a very fast response cannot
	// race ahead of the optimistic local timeline entry.
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	evt, err := c.engine.SendMessage(ctx, id.RoomID(roomID), nil, nil, text, relation, mentions, nil)
	if err != nil {
		return fmt.Errorf("send Matrix message: %w", err)
	}
	if message, ok := messageFromEvent(evt); ok {
		message.Sending = true
		message.Own = c.isOwnMessage(message)
		message = c.enrichOwnMessage(ctx, roomID, message)
		c.storeLocalMessage(roomID, message)
	}
	c.publishTimeline([]string{roomID}, "")
	return nil
}

func (c *Client) React(ctx context.Context, roomID, eventID, emoji string) error {
	if eventID == "" || strings.TrimSpace(emoji) == "" {
		return errors.New("reaction requires a target event and emoji")
	}
	emoji = strings.TrimSpace(emoji)
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	content := &event.ReactionEventContent{RelatesTo: event.RelatesTo{
		Type:    event.RelAnnotation,
		EventID: id.EventID(eventID),
		Key:     emoji,
	}}
	// The engine stores the reaction locally, so counts update before sync.
	evt, err := c.engine.Send(ctx, id.RoomID(roomID), event.EventReaction, content, false, true)
	if err != nil {
		return fmt.Errorf("send Matrix reaction: %w", err)
	}
	if evt.SendError != "" {
		return fmt.Errorf("send Matrix reaction: %s", evt.SendError)
	}
	c.publishTimeline([]string{roomID}, "")
	return nil
}

// RemoveReaction redacts the current user's reaction with emoji from an event.
func (c *Client) RemoveReaction(ctx context.Context, roomID, eventID, emoji string) error {
	if eventID == "" || strings.HasPrefix(eventID, "~") || strings.TrimSpace(emoji) == "" {
		return errors.New("reaction removal requires a server event and emoji")
	}
	emoji = strings.TrimSpace(emoji)
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if c.engine.Account == nil {
		return errors.New("reaction removal requires a logged-in account")
	}
	reactionIDs, err := c.ownReactionIDs(ctx, roomID, id.EventID(eventID), emoji)
	if err != nil {
		return err
	}
	if len(reactionIDs) == 0 {
		return errors.New("no own reaction with this emoji to remove")
	}
	redacted, err := redactReactionIDs(ctx, c.engine.Client, id.RoomID(roomID), reactionIDs)
	for _, reactionID := range redacted {
		c.markReactionRemoved(reactionID)
	}
	if err != nil {
		return err
	}
	c.publishTimeline([]string{roomID}, "")
	return nil
}

// redactReactionIDs redacts in order and returns the reactions redacted before any failure.
func redactReactionIDs(ctx context.Context, cli *mautrix.Client, roomID id.RoomID, reactionIDs []id.EventID) ([]id.EventID, error) {
	var redacted []id.EventID
	for _, reactionID := range reactionIDs {
		if _, err := cli.RedactEvent(ctx, roomID, reactionID); err != nil {
			return redacted, fmt.Errorf("remove Matrix reaction %s: %w", reactionID, err)
		}
		redacted = append(redacted, reactionID)
	}
	return redacted, nil
}

func findOwnReactionIDs(ctx context.Context, cli *mautrix.Client, roomID id.RoomID, eventID id.EventID, userID id.UserID, emoji string) ([]id.EventID, error) {
	from := ""
	var reactionIDs []id.EventID
	seen := make(map[id.EventID]bool)
	for range reactionRelationMaxPages {
		resp, err := cli.GetRelations(ctx, roomID, eventID, &mautrix.ReqGetRelations{
			RelationType: event.RelAnnotation,
			EventType:    event.EventReaction,
			From:         from,
			Limit:        reactionRelationPageLimit,
		})
		if err != nil {
			return nil, fmt.Errorf("list Matrix reactions: %w", err)
		}
		for _, evt := range resp.Chunk {
			if evt == nil || evt.ID == "" || seen[evt.ID] || evt.Sender != userID || evt.Content.ParseRaw(evt.Type) != nil {
				continue
			}
			relation := evt.Content.AsReaction().RelatesTo
			if relation.EventID == eventID && relation.Type == event.RelAnnotation && relation.Key == emoji {
				reactionIDs = append(reactionIDs, evt.ID)
				seen[evt.ID] = true
			}
		}
		if resp.NextBatch == "" {
			return reactionIDs, nil
		}
		if resp.NextBatch == from {
			return nil, errors.New("Matrix reaction pagination did not advance")
		}
		from = resp.NextBatch
	}
	return nil, errors.New("Matrix reaction pagination exceeded the page limit")
}

func (c *Client) RedactMessage(ctx context.Context, roomID, eventID string) error {
	if eventID == "" || strings.HasPrefix(eventID, "~") {
		return errors.New("cannot redact a message without a server event ID")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if _, err = c.engine.Client.RedactEvent(ctx, id.RoomID(roomID), id.EventID(eventID)); err != nil {
		return fmt.Errorf("redact Matrix message: %w", err)
	}
	c.publish([]string{roomID}, "")
	return nil
}

func (c *Client) RetryMessage(ctx context.Context, transactionID string) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if _, err = c.engine.Resend(ctx, transactionID); err != nil {
		return fmt.Errorf("retry Matrix message: %w", err)
	}
	return nil
}

func (c *Client) SetTyping(ctx context.Context, roomID string, timeout time.Duration) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if err = c.engine.SetTyping(ctx, id.RoomID(roomID), timeout); err != nil {
		return fmt.Errorf("update Matrix typing status: %w", err)
	}
	return nil
}
