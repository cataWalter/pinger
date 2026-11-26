package matrix

import (
	"context"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"sync"
	"time"
)

// unreadReactionCountTimeout bounds each per-room reaction count so a slow DB cannot stall sync.
const unreadReactionCountTimeout = 2 * time.Second

const unreadReactionQueryWorkers = 4

type preparedSyncNotification struct {
	eventID      string
	notification Notification
}

func (c *Client) queryUnreadReactionCounts(syncEvent *jsoncmd.SyncComplete, self id.UserID) map[id.RoomID]database.UnreadCounts {
	counts := make(map[id.RoomID]database.UnreadCounts)
	if c.engine == nil || self == "" {
		return counts
	}
	var roomIDs []id.RoomID
	for roomID, syncRoom := range syncEvent.Rooms {
		if syncRoom != nil && syncRoom.Meta != nil && !syncRoom.Meta.UnreadCounts.IsZero() {
			roomIDs = append(roomIDs, roomID)
		}
	}
	if len(roomIDs) == 0 {
		return counts
	}
	if len(roomIDs) == 1 {
		ctx, cancel := context.WithTimeout(context.Background(), unreadReactionCountTimeout)
		roomCounts, err := c.unreadReactionCounts(ctx, roomIDs[0], self)
		cancel()
		if err != nil {
			log.Printf("count unread reactions in room %s: %v", roomIDs[0], err)
			return counts
		}
		counts[roomIDs[0]] = roomCounts
		return counts
	}

	jobs := make(chan id.RoomID, len(roomIDs))
	for _, roomID := range roomIDs {
		jobs <- roomID
	}
	close(jobs)

	workers := min(unreadReactionQueryWorkers, len(roomIDs))
	var mu sync.Mutex
	var wg sync.WaitGroup
	wg.Add(workers)
	for range workers {
		go func() {
			defer wg.Done()
			for roomID := range jobs {
				ctx, cancel := context.WithTimeout(context.Background(), unreadReactionCountTimeout)
				roomCounts, err := c.unreadReactionCounts(ctx, roomID, self)
				cancel()
				if err != nil {
					log.Printf("count unread reactions in room %s: %v", roomID, err)
					continue
				}
				mu.Lock()
				counts[roomID] = roomCounts
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return counts
}

func (c *Client) applySync(syncEvent *jsoncmd.SyncComplete, notify bool) {
	roomAvatars := c.directRoomAvatars(syncEvent)
	changed := make([]string, 0, len(syncEvent.Rooms)+len(syncEvent.LeftRooms)+len(syncEvent.InvitedRooms))
	self := id.UserID(c.currentUserID())
	reactionUnreadCounts := c.queryUnreadReactionCounts(syncEvent, self)

	// Snapshot existing room and notification state under a short read lock so all DB queries run unlocked.
	c.mu.RLock()
	existingRooms := make(map[string]Room, len(syncEvent.Rooms))
	dismissed := make(map[string]string, len(syncEvent.Rooms))
	for roomID, syncRoom := range syncEvent.Rooms {
		if syncRoom == nil {
			continue
		}
		key := roomID.String()
		if room, exists := c.rooms[key]; exists {
			existingRooms[key] = room
		}
		if d, ok := c.dismissedEvents[key]; ok {
			dismissed[key] = d
		}
	}
	notifiedSnapshot := make(map[string]struct{}, len(c.notifiedEvents))
	for eventID := range c.notifiedEvents {
		notifiedSnapshot[eventID] = struct{}{}
	}
	c.mu.RUnlock()

	preparedInvites := make(map[string]Invite, len(syncEvent.InvitedRooms))
	for _, invited := range syncEvent.InvitedRooms {
		if invited == nil {
			continue
		}
		key := invited.ID.String()
		preparedInvites[key] = inviteFromInvitedRoom(invited, self)
		changed = append(changed, key)
	}

	preparedRooms := make(map[string]Room, len(syncEvent.Rooms))
	clearedInvites := make([]string, 0, len(syncEvent.Rooms))
	localEventsToRemove := make(map[string][]*database.Event)
	var syncedMessagesByRoom map[string][]Message
	var syncedReceipts []ReadReceiptItem
	var editTargetsByRoom map[string][]id.EventID
	var reactionTargetsByRoom map[string][]id.EventID
	var redactionsByRoom map[string][]syncRedaction
	var eventsByRoomAndID map[string]map[id.EventID]*database.Event
	var reloadTimelineRooms []string
	var pendingNotifs []preparedSyncNotification
	incomingMessage := false

	for roomID, syncRoom := range syncEvent.Rooms {
		if syncRoom == nil {
			continue
		}
		key := roomID.String()
		clearedInvites = append(clearedInvites, key)
		room, exists := existingRooms[key]
		if !exists {
			room = Room{ID: key, Name: key}
		}
		if meta := syncRoom.Meta; meta != nil {
			unreadCounts := unreadCountsWithoutReactions(meta.UnreadCounts, reactionUnreadCounts[roomID])
			room.Name = roomDisplayName(meta)
			if meta.Topic != nil {
				room.Topic = *meta.Topic
			}
			if meta.Avatar != nil {
				room.Avatar = meta.Avatar.String()
			}
			if avatar, ok := roomAvatars[key]; ok && (meta.Avatar == nil || room.Avatar == "") {
				room.Avatar = avatar
			}
			room.Direct = isDirectRoom(meta)
			room.Unread = unreadMessageCount(unreadCounts)
			room.MarkedUnread = meta.MarkedUnread != nil && *meta.MarkedUnread
			room.Mentions = unreadCounts.UnreadHighlights
			room.Bridge = bridgeLabel(meta)
			if !meta.SortingTimestamp.Time.IsZero() {
				room.LastSeen = meta.SortingTimestamp.Time
			}
		}
		if notify && (syncRoom.Reset || len(syncRoom.Receipts) > 0 || (len(syncRoom.Timeline) > 0 && !timelineCanSkipReload(syncRoom))) {
			reloadTimelineRooms = append(reloadTimelineRooms, key)
		}
		if notify && !syncRoom.Reset && len(syncRoom.Timeline) > 0 {
			timelineRows := make(map[database.EventRowID]struct{}, len(syncRoom.Timeline))
			for _, row := range syncRoom.Timeline {
				timelineRows[row.Event] = struct{}{}
			}
			for _, evt := range syncRoom.Events {
				if evt == nil || evt.Sender == "" || evt.Sender == self {
					continue
				}
				if _, isTimelineMessage := timelineRows[evt.RowID]; !isTimelineMessage {
					continue
				}
				if _, isMessage := messageFromEvent(evt); isMessage {
					incomingMessage = true
					break
				}
			}
		}
		if notify {
			for _, notification := range syncRoom.Notifications {
				if notification.Event == nil {
					continue
				}
				if c.engine != nil && c.engine.Account != nil && notification.Event.Sender == c.engine.Account.UserID {
					continue
				}
				eventID := notification.Event.ID.String()
				if eventID == "" {
					continue
				}
				if _, seen := notifiedSnapshot[eventID]; seen {
					continue
				}
				notifiedSnapshot[eventID] = struct{}{}
				if message, ok := messageFromEvent(notification.Event); ok {
					profiled := []Message{message}
					c.populateMessageProfiles(context.Background(), key, profiled)
					message = profiled[0]
					sender := message.SenderName
					if sender == "" {
						sender = message.Sender
					}
					pendingNotifs = append(pendingNotifs, preparedSyncNotification{
						eventID: eventID,
						notification: Notification{
							RoomID:       key,
							Room:         room.Name,
							Sender:       sender,
							SenderAvatar: message.Avatar,
							Body:         message.Body,
							Mention:      notification.Highlight,
							Category:     notificationCategory(room.Direct, notification.Highlight),
						},
					})
				}
			}
		}
		// gomuks decides which event is a room's preview server-side
		// (room.preview_event_rowid, using the same eligibility rules the
		// timeline uses). Prefer that answer so the sidebar text is always the
		// event the open chat shows, rather than re-deriving it from whatever
		// happens to arrive in this payload.
		previewResolved := false
		if meta := syncRoom.Meta; meta != nil && meta.PreviewEventRowID != 0 {
			for _, evt := range syncRoom.Events {
				if evt == nil || evt.RowID != meta.PreviewEventRowID {
					continue
				}
				if preview, ok := messageFromEvent(evt); ok && preview.Body != "" {
					room.Preview = preview.Body
					room.LastEventSender = preview.Sender
					previewResolved = true
				}
				break
			}
		}
		for _, evt := range syncRoom.Events {
			if evt == nil {
				continue
			}
			if evt.ID != "" {
				if eventsByRoomAndID == nil {
					eventsByRoomAndID = make(map[string]map[id.EventID]*database.Event)
				}
				if eventsByRoomAndID[key] == nil {
					eventsByRoomAndID[key] = make(map[id.EventID]*database.Event, len(syncRoom.Events))
				}
				eventsByRoomAndID[key][evt.ID] = evt
			}
			localEventsToRemove[key] = append(localEventsToRemove[key], evt)
			message, isMessage := messageFromEvent(evt)
			if isMessage && !evt.Timestamp.Time.Before(room.LastEventAt) {
				room.LastEventAt = evt.Timestamp.Time
				room.LastEventID = evt.ID.String()
				room.LastEventSender = message.Sender
			}
			inTimeline := isTimelineEvent(syncRoom.Timeline, evt.RowID)
			if isMessage && !previewResolved && evt.CanUseForPreview() {
				// Timeline membership keeps stale rows resent in `events` from
				// moving the preview backwards, but a freshly sent own message
				// may not have a timeline row yet, so let it seed an empty
				// preview instead of leaving the topic fallback in place.
				if room.Preview == "" || (inTimeline && !message.Timestamp.Before(room.LastSeen)) {
					room.LastSeen = message.Timestamp
					room.Preview = message.Body
					room.LastEventSender = message.Sender
				}
			}
			if notify && inTimeline {
				if !syncRoom.Reset && isMessage {
					message.Own = self != "" && message.Sender == self.String()
					if syncedMessagesByRoom == nil {
						syncedMessagesByRoom = make(map[string][]Message)
					}
					syncedMessagesByRoom[key] = append(syncedMessagesByRoom[key], message)
				} else if !syncRoom.Reset && evt.RelationType == event.RelReplace && evt.RelatesTo != "" {
					if editTargetsByRoom == nil {
						editTargetsByRoom = make(map[string][]id.EventID)
					}
					editTargetsByRoom[key] = append(editTargetsByRoom[key], evt.RelatesTo)
				} else if !syncRoom.Reset && evt.RelationType == event.RelAnnotation && evt.RelatesTo != "" {
					if reactionTargetsByRoom == nil {
						reactionTargetsByRoom = make(map[string][]id.EventID)
					}
					reactionTargetsByRoom[key] = append(reactionTargetsByRoom[key], evt.RelatesTo)
				} else if !syncRoom.Reset && evt.GetType().Type == event.EventRedaction.Type {
					if targetID := redactionTargetID(evt); targetID != "" {
						if redactionsByRoom == nil {
							redactionsByRoom = make(map[string][]syncRedaction)
						}
						redactionsByRoom[key] = append(redactionsByRoom[key], syncRedaction{targetID: targetID, redactorID: evt.ID})
					} else {
						reloadTimelineRooms = append(reloadTimelineRooms, key)
					}
				} else {
					reloadTimelineRooms = append(reloadTimelineRooms, key)
				}
			}
		}
		setRoomNeedsReply(&room, self.String(), dismissed[key])
		if notify && !syncRoom.Reset && len(syncRoom.Receipts) > 0 {
			seenAt := c.lastEventSeenAt(room)
			room.LastEventSeenAt = seenAt
			syncedReceipts = append(syncedReceipts, ReadReceiptItem{
				RoomID:    key,
				EventID:   room.LastEventID,
				Timestamp: seenAt.UnixMilli(),
			})
		}
		preparedRooms[key] = room
		changed = append(changed, key)
	}
	for _, roomID := range syncEvent.LeftRooms {
		changed = append(changed, roomID.String())
	}

	var newMessageItems []MessageItem
	if notify && len(syncedMessagesByRoom) > 0 {
		for roomKey, roomMessages := range syncedMessagesByRoom {
			c.rememberRoomMediaEncryption(roomKey, roomMessages)
			c.populateMessageProfiles(context.Background(), roomKey, roomMessages)
			c.enrichReplyPreviews(context.Background(), roomKey, roomMessages)
			for _, msg := range roomMessages {
				newMessageItems = append(newMessageItems, MessageItem{RoomID: roomKey, Message: msg})
			}
		}
	}

	var redactionItems []RedactionItem
	if notify && len(redactionsByRoom) > 0 {
		for roomKey, redactions := range redactionsByRoom {
			items, editTargets, reactionTargets, reload := c.resolveSyncRedactions(context.Background(), roomKey, eventsByRoomAndID[roomKey], redactions)
			redactionItems = append(redactionItems, items...)
			if len(editTargets) > 0 {
				if editTargetsByRoom == nil {
					editTargetsByRoom = make(map[string][]id.EventID)
				}
				editTargetsByRoom[roomKey] = append(editTargetsByRoom[roomKey], editTargets...)
			}
			if len(reactionTargets) > 0 {
				if reactionTargetsByRoom == nil {
					reactionTargetsByRoom = make(map[string][]id.EventID)
				}
				reactionTargetsByRoom[roomKey] = append(reactionTargetsByRoom[roomKey], reactionTargets...)
			}
			if reload {
				reloadTimelineRooms = append(reloadTimelineRooms, roomKey)
			}
		}
	}

	var editedItems []MessageItem
	if notify && len(editTargetsByRoom) > 0 {
		var reloadRooms []string
		editedItems, reloadRooms = c.editedMessageItems(editTargetsByRoom)
		reloadTimelineRooms = append(reloadTimelineRooms, reloadRooms...)
	}

	var reactionItems []ReactionDeltaItem
	if notify && len(reactionTargetsByRoom) > 0 {
		var reloadRooms []string
		reactionItems, reloadRooms = c.reactionDeltaItems(reactionTargetsByRoom)
		reloadTimelineRooms = append(reloadTimelineRooms, reloadRooms...)
	}

	// Commit prepared state under a single short write lock.
	c.mu.Lock()
	if c.invites == nil {
		c.invites = make(map[string]Invite)
	}
	if c.rooms == nil {
		c.rooms = make(map[string]Room)
	}
	for key, invite := range preparedInvites {
		c.invites[key] = invite
	}
	for _, key := range clearedInvites {
		delete(c.invites, key)
	}
	for key, room := range preparedRooms {
		c.rooms[key] = room
	}
	for key, evts := range localEventsToRemove {
		for _, evt := range evts {
			c.removeLocalMessageLocked(key, evt)
		}
	}
	if len(pendingNotifs) > 0 {
		if c.notifiedEvents == nil {
			c.notifiedEvents = make(map[string]struct{}, len(pendingNotifs))
		}
		for _, n := range pendingNotifs {
			if _, seen := c.notifiedEvents[n.eventID]; seen {
				continue
			}
			c.notifiedEvents[n.eventID] = struct{}{}
			c.pendingNotifications = append(c.pendingNotifications, n.notification)
		}
	}
	if incomingMessage {
		c.pendingIncomingMessage = true
	}
	if len(reloadTimelineRooms) > 0 {
		if c.pendingTimelineRooms == nil {
			c.pendingTimelineRooms = make(map[string]struct{})
		}
		for _, roomKey := range reloadTimelineRooms {
			c.pendingTimelineRooms[roomKey] = struct{}{}
		}
	}
	if len(newMessageItems) > 0 {
		c.pendingMessages = append(c.pendingMessages, newMessageItems...)
	}
	if len(editedItems) > 0 {
		c.pendingEditedMessages = append(c.pendingEditedMessages, editedItems...)
	}
	if len(redactionItems) > 0 {
		c.pendingRedactions = append(c.pendingRedactions, redactionItems...)
	}
	if len(reactionItems) > 0 {
		c.pendingReactionDeltas = append(c.pendingReactionDeltas, reactionItems...)
	}
	if len(syncedReceipts) > 0 {
		c.pendingReceipts = append(c.pendingReceipts, syncedReceipts...)
	}
	for _, roomID := range syncEvent.LeftRooms {
		key := roomID.String()
		delete(c.rooms, key)
		delete(c.invites, key)
		c.forgetRoomMediaEncryptionLocked(key)
	}
	c.mu.Unlock()

	if notify && len(changed) > 0 {
		c.publish(changed, "")
	}
}
