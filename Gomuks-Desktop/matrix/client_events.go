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
		c.mu.Unlock()
		c.publish(nil, "")
	case *jsoncmd.SendComplete:
		if evt.Event != nil {
			c.sendMu.Lock()
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
			}
			c.completeScheduledSendLocked(evt)
			c.sendMu.Unlock()
			errorMessage := ""
			if evt.Error != nil {
				errorMessage = evt.Error.Error()
			}
			c.publishTimeline([]string{evt.Event.RoomID.String()}, errorMessage)
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
	update.Notifications = append([]Notification(nil), c.pendingNotifications...)
	c.pendingNotifications = c.pendingNotifications[:0]
	c.mu.Unlock()
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
	notifications := append([]Notification(nil), update.Notifications...)
drain:
	for {
		select {
		case pending := <-c.events:
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
		default:
			break drain
		}
	}
	for _, roomID := range update.ChangedRoomID {
		changedSet[roomID] = struct{}{}
	}
	if update.Error == "" {
		update.Error = pendingError
	}
	update.InitialSyncComplete = initialSyncComplete
	update.NewIncomingMessage = newIncomingMessage
	update.Notifications = notifications
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
