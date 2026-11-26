package matrix

import (
	"context"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"sort"
)

func notificationCategory(direct, highlight bool) string {
	switch {
	case direct:
		return NotificationCategoryDirect
	case highlight:
		return NotificationCategoryMention
	default:
		return NotificationCategoryGroup
	}
}

func (c *Client) handleBackendEvent(raw any) {
	switch evt := raw.(type) {
	case *jsoncmd.SyncComplete:
		c.queueVerificationEvents(evt.ToDevice)
		c.applySync(evt, true)
	case *jsoncmd.EventsDecrypted:
		c.refreshRoomFromTimeline(evt.RoomID.String())
		c.publishTimeline([]string{evt.RoomID.String()}, "")
	case *jsoncmd.Typing:
		roomID := evt.RoomID.String()
		users := make([]string, 0, len(evt.UserIDs))
		for _, userID := range evt.UserIDs {
			if c.engine.Account == nil || userID != c.engine.Account.UserID {
				users = append(users, userID.String())
			}
		}
		c.mu.Lock()
		if len(users) == 0 {
			delete(c.typing, roomID)
		} else {
			c.typing[roomID] = users
		}
		syncReady := c.syncReady
		connState := c.connectionState
		needsVerification := c.NeedsVerification()
		c.mu.Unlock()
		c.publishUpdate(Update{
			RoomsOmitted:        true,
			TypingUpdates:       []TypingItem{{RoomID: roomID, UserIDs: append([]string(nil), users...)}},
			TypingUsers:         map[string][]string{roomID: append([]string(nil), users...)},
			InitialSyncComplete: syncReady,
			NeedsVerification:   needsVerification,
			ConnectionState:     connState,
		})
	case *jsoncmd.SendComplete:
		if evt.Event != nil {
			c.sendMu.Lock()
			var finalized *Message
			if message, ok := messageFromEvent(evt.Event); ok {
				message.Sending = false
				message.SendError = ""
				message.Own = c.isOwnMessage(message)
				message = c.enrichOwnMessage(context.Background(), evt.Event.RoomID.String(), message)
				if evt.Error != nil {
					message.SendError = evt.Error.Error()
					c.storeFailedMessage(evt.Event.RoomID.String(), message)
				} else if evt.Event.SendError == "" || evt.Event.SendError == "not sent" {
					// Send succeeded (or is still in flight with only the
					// transient marker): drop the optimistic pending entry so
					// the server-confirmed row takes over on next sync, but keep
					// the sidebar preview on the sent text.
					c.mu.Lock()
					roomID := evt.Event.RoomID.String()
					c.removeLocalMessageLocked(roomID, evt.Event)
					if room, ok := c.rooms[roomID]; ok {
						if message.Body != "" && !message.Timestamp.Before(room.LastSeen) {
							room.LastSeen = message.Timestamp
							room.Preview = message.Body
						}
						if !message.Timestamp.Before(room.LastEventAt) {
							room.LastEventAt = message.Timestamp
							room.LastEventID = evt.Event.ID.String()
							if message.Sender != "" {
								room.LastEventSender = message.Sender
							}
							setRoomNeedsReply(&room, c.currentUserID(), c.dismissedEvents[roomID])
						}
						c.rooms[roomID] = room
					}
					c.mu.Unlock()
				} else {
					message.SendError = evt.Event.SendError
					c.storeFailedMessage(evt.Event.RoomID.String(), message)
				}
				finalized = &message
			}
			c.completeScheduledSendLocked(evt)
			c.sendMu.Unlock()
			errorMessage := ""
			if evt.Error != nil {
				errorMessage = evt.Error.Error()
			}
			roomID := evt.Event.RoomID.String()
			if finalized != nil {
				c.mu.Lock()
				c.pendingMessages = append(c.pendingMessages, MessageItem{RoomID: roomID, Message: *finalized})
				c.mu.Unlock()
				c.publish([]string{roomID}, errorMessage)
			} else {
				c.publishTimeline([]string{roomID}, errorMessage)
			}
		} else if evt.Error != nil {
			c.publish(nil, evt.Error.Error())
		}
	case *jsoncmd.SyncStatus:
		message := ""
		c.mu.Lock()
		switch evt.Type {
		case jsoncmd.SyncStatusErroring, jsoncmd.SyncStatusFailed:
			c.connectionState = StateOffline
			message = evt.Error
			if message == "" {
				message = "Matrix sync is offline"
			}
		case jsoncmd.SyncStatusOK:
			c.syncReady = true
			c.connectionState = StateConnected
		case jsoncmd.SyncStatusWaiting:
			if c.syncReady {
				c.connectionState = StateConnected
			} else {
				c.connectionState = StateSyncing
			}
		}
		c.mu.Unlock()
		if message != "" && c.engine != nil && c.engine.Client != nil {
			c.engine.Client.Log.Error().Interface("sync_status", evt.Type).Str("error", message).Msg("Matrix sync failed")
		}
		c.publish(nil, message)
		if evt.Type == jsoncmd.SyncStatusOK {
			c.startPreviewBackfill()
		}
	case *jsoncmd.InitComplete:
		c.mu.Lock()
		c.syncReady = true
		c.connectionState = StateConnected
		c.mu.Unlock()
		c.publish(nil, "")
		c.startPreviewBackfill()
	}
}

func (c *Client) publish(changed []string, errMessage string) {
	c.refreshSlidingSyncPriorityRooms()
	update := Update{
		Rooms:                 c.Rooms(),
		Invites:               c.Invites(),
		SlidingSyncListCounts: c.SlidingSyncListCounts(),
		ChangedRoomID:         append([]string(nil), changed...),
		Error:                 errMessage,
		InitialSyncComplete:   c.SyncReady(),
		NeedsVerification:     c.engine != nil && c.NeedsVerification(),
		Verification:          c.Verification(),
		ConnectionState:       c.ConnectionState(),
	}
	c.mu.Lock()
	if c.pendingTimelineRooms == nil {
		c.pendingTimelineRooms = make(map[string]struct{})
	}
	update.TimelineChangedRoomID = make([]string, 0, len(c.pendingTimelineRooms))
	for roomID := range c.pendingTimelineRooms {
		update.TimelineChangedRoomID = append(update.TimelineChangedRoomID, roomID)
	}
	clear(c.pendingTimelineRooms)
	update.TypingUsers = make(map[string][]string, len(c.typing))
	for roomID, users := range c.typing {
		update.TypingUsers[roomID] = append([]string(nil), users...)
	}
	update.NewIncomingMessage = c.pendingIncomingMessage
	c.pendingIncomingMessage = false
	update.NewMessages = append([]MessageItem(nil), c.pendingMessages...)
	c.pendingMessages = c.pendingMessages[:0]
	update.EditedMessages = append([]MessageItem(nil), c.pendingEditedMessages...)
	c.pendingEditedMessages = c.pendingEditedMessages[:0]
	update.RedactedEventIDs = append([]RedactionItem(nil), c.pendingRedactions...)
	c.pendingRedactions = c.pendingRedactions[:0]
	update.ReactionDeltas = append([]ReactionDeltaItem(nil), c.pendingReactionDeltas...)
	c.pendingReactionDeltas = c.pendingReactionDeltas[:0]
	update.ReadReceipts = append([]ReadReceiptItem(nil), c.pendingReceipts...)
	c.pendingReceipts = c.pendingReceipts[:0]
	update.Notifications = append([]Notification(nil), c.pendingNotifications...)
	c.pendingNotifications = c.pendingNotifications[:0]
	c.mu.Unlock()
	c.publishUpdate(update)
}

func (c *Client) publishUpdate(update Update) {
	c.eventMu.Lock()
	defer c.eventMu.Unlock()
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case c.events <- update:
		return
	default:
	}

	// Keep the callback non-blocking even if the UI is busy rendering. The next
	// delivered update contains the newest room snapshot and all pending IDs.
	changedSet := make(map[string]struct{}, len(update.ChangedRoomID))
	timelineChangedSet := make(map[string]struct{}, len(update.TimelineChangedRoomID))
	for _, roomID := range update.TimelineChangedRoomID {
		timelineChangedSet[roomID] = struct{}{}
	}
	pendingError := ""
	initialSyncComplete := update.InitialSyncComplete
	newIncomingMessage := update.NewIncomingMessage
	notifications := make([]Notification, 0, len(update.Notifications))
	pendingMessages := make([]MessageItem, 0, len(update.NewMessages))
	pendingEdited := make([]MessageItem, 0, len(update.EditedMessages))
	pendingRedactions := make([]RedactionItem, 0, len(update.RedactedEventIDs))
	pendingReactionDeltas := make([]ReactionDeltaItem, 0, len(update.ReactionDeltas))
	pendingReceipts := make([]ReadReceiptItem, 0, len(update.ReadReceipts))
	pendingTyping := make([]TypingItem, 0, len(update.TypingUpdates))
	roomsOmitted := update.RoomsOmitted
	var fallbackRooms []Room
	var fallbackInvites []Invite
	var fallbackListCounts map[string]int
drain:
	for {
		select {
		case pending := <-c.events:
			if !pending.RoomsOmitted {
				roomsOmitted = false
				fallbackRooms = pending.Rooms
				fallbackInvites = pending.Invites
				fallbackListCounts = pending.SlidingSyncListCounts
			}
			for _, roomID := range pending.ChangedRoomID {
				changedSet[roomID] = struct{}{}
			}
			for _, roomID := range pending.TimelineChangedRoomID {
				timelineChangedSet[roomID] = struct{}{}
			}
			if pending.Error != "" {
				pendingError = pending.Error
			}
			initialSyncComplete = initialSyncComplete || pending.InitialSyncComplete
			newIncomingMessage = newIncomingMessage || pending.NewIncomingMessage
			notifications = append(notifications, pending.Notifications...)
			pendingMessages = append(pendingMessages, pending.NewMessages...)
			pendingEdited = append(pendingEdited, pending.EditedMessages...)
			pendingRedactions = append(pendingRedactions, pending.RedactedEventIDs...)
			pendingReactionDeltas = append(pendingReactionDeltas, pending.ReactionDeltas...)
			pendingReceipts = append(pendingReceipts, pending.ReadReceipts...)
			pendingTyping = append(pendingTyping, pending.TypingUpdates...)
		default:
			break drain
		}
	}
	if update.RoomsOmitted && !roomsOmitted {
		update.RoomsOmitted = false
		update.Rooms = fallbackRooms
		update.Invites = fallbackInvites
		update.SlidingSyncListCounts = fallbackListCounts
	}
	for _, roomID := range update.ChangedRoomID {
		changedSet[roomID] = struct{}{}
	}
	if update.Error == "" {
		update.Error = pendingError
	}
	update.InitialSyncComplete = initialSyncComplete
	update.NewIncomingMessage = newIncomingMessage
	update.Notifications = append(notifications, update.Notifications...)
	update.NewMessages = append(pendingMessages, update.NewMessages...)
	update.EditedMessages = append(pendingEdited, update.EditedMessages...)
	update.RedactedEventIDs = append(pendingRedactions, update.RedactedEventIDs...)
	update.ReactionDeltas = append(pendingReactionDeltas, update.ReactionDeltas...)
	update.ReadReceipts = append(pendingReceipts, update.ReadReceipts...)
	update.TypingUpdates = append(pendingTyping, update.TypingUpdates...)
	update.ChangedRoomID = update.ChangedRoomID[:0]
	for roomID := range changedSet {
		update.ChangedRoomID = append(update.ChangedRoomID, roomID)
	}
	sort.Strings(update.ChangedRoomID)
	update.TimelineChangedRoomID = update.TimelineChangedRoomID[:0]
	for roomID := range timelineChangedSet {
		update.TimelineChangedRoomID = append(update.TimelineChangedRoomID, roomID)
	}
	sort.Strings(update.TimelineChangedRoomID)
	select {
	case c.events <- update:
	case <-c.done:
	}
}

func (c *Client) publishTimeline(roomIDs []string, errMessage string) {
	c.mu.Lock()
	if c.pendingTimelineRooms == nil {
		c.pendingTimelineRooms = make(map[string]struct{})
	}
	for _, roomID := range roomIDs {
		c.pendingTimelineRooms[roomID] = struct{}{}
	}
	c.mu.Unlock()
	c.publish(nil, errMessage)
}
