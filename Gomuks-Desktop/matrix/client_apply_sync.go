package matrix

import (
	"context"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/id"
	"time"
)

// unreadReactionCountTimeout bounds each per-room reaction count so a slow DB cannot stall sync.
const unreadReactionCountTimeout = 2 * time.Second

func (c *Client) applySync(syncEvent *jsoncmd.SyncComplete, notify bool) {
	roomAvatars := c.directRoomAvatars(syncEvent)
	changed := make([]string, 0, len(syncEvent.Rooms)+len(syncEvent.LeftRooms)+len(syncEvent.InvitedRooms))
	self := id.UserID(c.currentUserID())
	reactionUnreadCounts := make(map[id.RoomID]database.UnreadCounts)
	if c.engine != nil && self != "" {
		for roomID, syncRoom := range syncEvent.Rooms {
			if syncRoom == nil || syncRoom.Meta == nil || syncRoom.Meta.UnreadCounts.IsZero() {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), unreadReactionCountTimeout)
			counts, err := c.unreadReactionCounts(ctx, roomID, self)
			cancel()
			if err != nil {
				log.Printf("count unread reactions in room %s: %v", roomID, err)
				continue
			}
			reactionUnreadCounts[roomID] = counts
		}
	}
	c.mu.Lock()
	if c.invites == nil {
		c.invites = make(map[string]Invite)
	}
	for _, invited := range syncEvent.InvitedRooms {
		if invited == nil {
			continue
		}
		key := invited.ID.String()
		c.invites[key] = inviteFromInvitedRoom(invited, self)
		changed = append(changed, key)
	}
	for roomID, syncRoom := range syncEvent.Rooms {
		if syncRoom == nil {
			continue
		}
		key := roomID.String()
		delete(c.invites, key)
		room, exists := c.rooms[key]
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
		if notify && (syncRoom.Reset || len(syncRoom.Timeline) > 0 || len(syncRoom.Receipts) > 0) {
			if c.pendingTimelineRooms == nil {
				c.pendingTimelineRooms = make(map[string]struct{})
			}
			c.pendingTimelineRooms[key] = struct{}{}
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
					c.pendingIncomingMessage = true
					break
				}
			}
		}
		if notify {
			for _, notification := range syncRoom.Notifications {
				if notification.Event == nil {
					continue
				}
				if c.engine.Account != nil && notification.Event.Sender == c.engine.Account.UserID {
					continue
				}
				eventID := notification.Event.ID.String()
				if eventID == "" {
					continue
				}
				if _, seen := c.notifiedEvents[eventID]; seen {
					continue
				}
				c.notifiedEvents[eventID] = struct{}{}
				if message, ok := messageFromEvent(notification.Event); ok {
					profiled := []Message{message}
					c.populateMessageProfiles(context.Background(), key, profiled)
					message = profiled[0]
					sender := message.SenderName
					if sender == "" {
						sender = message.Sender
					}
					c.pendingNotifications = append(c.pendingNotifications, Notification{
						RoomID:       key,
						Room:         room.Name,
						Sender:       sender,
						SenderAvatar: message.Avatar,
						Body:         message.Body,
						Mention:      notification.Highlight,
						Category:     notificationCategory(room.Direct, notification.Highlight),
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
			c.removeLocalMessageLocked(key, evt)
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
				if c.pendingTimelineRooms == nil {
					c.pendingTimelineRooms = make(map[string]struct{})
				}
				c.pendingTimelineRooms[key] = struct{}{}
			}
		}
		setRoomNeedsReply(&room, c.currentUserID(), c.dismissedEvents[key])
		c.rooms[key] = room
		changed = append(changed, key)
	}
	for _, roomID := range syncEvent.LeftRooms {
		key := roomID.String()
		delete(c.rooms, key)
		delete(c.invites, key)
		changed = append(changed, key)
	}
	c.mu.Unlock()
	if notify && len(changed) > 0 {
		c.publish(changed, "")
	}
}
