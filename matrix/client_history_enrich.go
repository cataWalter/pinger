package matrix

import (
	"context"
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"time"
)

func (c *Client) enrichReplyPreviews(ctx context.Context, roomID string, messages []Message) {
	if len(messages) == 0 || c.engine == nil || c.engine.DB == nil {
		return
	}

	messagesByID := make(map[string]Message, len(messages))
	for _, message := range messages {
		if message.ID != "" {
			messagesByID[message.ID] = message
		}
	}

	targetIndexes := make(map[string]int)
	targetMessages := make([]Message, 0)
	for _, message := range messages {
		replyToID := message.ReplyToEventID
		if replyToID == "" || message.ReplyToPreview != "" {
			continue
		}
		if _, exists := messagesByID[replyToID]; exists {
			continue
		}
		if _, exists := targetIndexes[replyToID]; exists {
			continue
		}
		evt, err := c.engine.DB.Event.GetByID(ctx, id.RoomID(roomID), id.EventID(replyToID))
		if err != nil || evt == nil {
			continue
		}
		target, ok := messageFromEvent(evt)
		if !ok {
			continue
		}
		targetIndexes[replyToID] = len(targetMessages)
		targetMessages = append(targetMessages, target)
	}
	c.populateMessageProfiles(ctx, roomID, targetMessages)

	for i := range messages {
		if messages[i].ReplyToEventID == "" || messages[i].ReplyToPreview != "" {
			continue
		}
		target, exists := messagesByID[messages[i].ReplyToEventID]
		if !exists {
			if targetIndex, found := targetIndexes[messages[i].ReplyToEventID]; found {
				target = targetMessages[targetIndex]
				exists = true
			}
		}
		if !exists {
			continue
		}
		messages[i].ReplyToSender = target.SenderName
		if messages[i].ReplyToSender == "" {
			messages[i].ReplyToSender = target.Sender
		}
		if target.Redacted {
			messages[i].ReplyToPreview = "Message removed"
		} else {
			messages[i].ReplyToPreview = target.Body
		}
	}
}

func (c *Client) enrichSeenMessage(ctx context.Context, roomID string, messages []Message) {
	if len(messages) == 0 || c.engine == nil || c.engine.Account == nil {
		return
	}
	c.mu.RLock()
	room, exists := c.rooms[roomID]
	c.mu.RUnlock()
	if !exists || !room.Direct {
		return
	}
	eventIDs := make([]id.EventID, 0, len(messages))
	for _, message := range messages {
		if message.ID != "" {
			eventIDs = append(eventIDs, id.EventID(message.ID))
		}
	}
	if len(eventIDs) == 0 {
		return
	}
	receipts, err := c.engine.GetReceipts(ctx, id.RoomID(roomID), eventIDs)
	if err != nil {
		log.Printf("read Matrix receipts for room %s: %v", roomID, err)
		return
	}
	applyLatestReadReceipt(messages, receipts, c.engine.Account.UserID)
}

func applyLatestReadReceipt(messages []Message, receipts map[id.EventID][]*database.Receipt, ownUserID id.UserID) {
	messageIndexes := make(map[id.EventID]int, len(messages))
	for index, message := range messages {
		if message.ID != "" {
			messageIndexes[id.EventID(message.ID)] = index
		}
	}
	latestReceiptIndex := -1
	var latestSeenAt time.Time
	for eventID, eventReceipts := range receipts {
		index, exists := messageIndexes[eventID]
		if !exists {
			continue
		}
		for _, receipt := range eventReceipts {
			if receipt == nil || receipt.UserID == ownUserID || receipt.ReceiptType != event.ReceiptTypeRead || receipt.ThreadID != "" || receipt.Timestamp.Time.IsZero() {
				continue
			}
			if index > latestReceiptIndex || (index == latestReceiptIndex && receipt.Timestamp.Time.After(latestSeenAt)) {
				latestReceiptIndex = index
				latestSeenAt = receipt.Timestamp.Time
			}
		}
	}
	for index := latestReceiptIndex; index >= 0; index-- {
		if messages[index].Own && messages[index].ID != "" {
			messages[index].SeenAt = latestSeenAt
			return
		}
	}
}

func (c *Client) isOwnMessage(message Message) bool {
	return c.engine.Account != nil && message.Sender == c.engine.Account.UserID.String()
}

func (c *Client) enrichOwnMessage(ctx context.Context, roomID string, message Message) Message {
	profile := c.Profile()
	if message.Sender == "" {
		message.Sender = profile.UserID
	}
	if !message.Own && (profile.UserID == "" || message.Sender != profile.UserID) {
		return message
	}
	message.Own = true
	if message.Avatar == "" && message.Sender != "" {
		profiled := []Message{message}
		c.populateMessageProfiles(ctx, roomID, profiled)
		message = profiled[0]
	}
	if message.SenderName == "" {
		message.SenderName = profile.DisplayName
	}
	if message.Avatar == "" {
		message.Avatar = profile.AvatarURI
	}
	return message
}

func (c *Client) populateMessageProfiles(ctx context.Context, roomID string, messages []Message) {
	users := make(map[string]struct{})
	for i := range messages {
		if messages[i].Sender != "" {
			users[messages[i].Sender] = struct{}{}
		}
	}
	if len(users) == 0 {
		return
	}
	keys := make([]database.RoomStateGUID, 0, len(users))
	for userID := range users {
		keys = append(keys, database.RoomStateGUID{
			RoomID:   id.RoomID(roomID),
			Type:     event.StateMember,
			StateKey: userID,
		})
	}
	members, err := c.engine.DB.CurrentState.GetMany(ctx, keys)
	if err != nil {
		log.Printf("read Matrix member profiles for room %s: %v", roomID, err)
		return
	}
	profiles := make(map[string]event.MemberEventContent, len(members))
	for _, member := range members {
		if member.StateKey == nil {
			continue
		}
		var profile event.MemberEventContent
		if err = json.Unmarshal(member.GetContent(), &profile); err != nil {
			log.Printf("decode Matrix member profile in room %s: %v", roomID, err)
			continue
		}
		profiles[*member.StateKey] = profile
	}
	for i := range messages {
		if profile, ok := profiles[messages[i].Sender]; ok {
			if profile.Displayname != "" {
				messages[i].SenderName = profile.Displayname
			}
			messages[i].Avatar = string(profile.AvatarURL)
		}
	}
}

// refreshRoomFromTimeline re-derives the sidebar preview from the newest
// timeline message persisted in the DB. It is used after decryption completes:
// the sync-time Events payload often carries the still-encrypted stub (which
// messageFromEvent skips), so the preview would otherwise stay behind the
// open timeline until the next sync.
func (c *Client) refreshRoomFromTimeline(roomID string) {
	ctx, finish, err := c.beginOperation(context.Background())
	if err != nil {
		return
	}
	defer finish()
	events, err := c.engine.DB.Timeline.Get(ctx, id.RoomID(roomID), 20, 0)
	if err != nil || len(events) == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	room, ok := c.rooms[roomID]
	if !ok {
		return
	}
	// Timeline.Get returns newest first, so the first message found is the latest.
	for _, evt := range events {
		message, ok := messageFromEvent(evt)
		if !ok {
			continue
		}
		if room.Preview == "" || !message.Timestamp.Before(room.LastSeen) {
			room.LastSeen = message.Timestamp
			room.Preview = message.Body
		}
		if !evt.Timestamp.Time.Before(room.LastEventAt) {
			room.LastEventAt = evt.Timestamp.Time
			room.LastEventID = evt.ID.String()
			room.LastEventSender = evt.Sender.String()
		}
		break
	}
	setRoomNeedsReply(&room, c.currentUserID(), c.dismissedEvents[roomID])
	c.rooms[roomID] = room
}
