package matrix

import (
	"context"
	"encoding/json"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"sort"
	"strings"
	"time"
)

// SetRoomUnanswered with false marks the room answered for its latest event; Unanswered is unchanged.
func (c *Client) SetRoomUnanswered(ctx context.Context, roomID string, unanswered bool) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()

	c.mu.RLock()
	room, exists := c.rooms[roomID]
	c.mu.RUnlock()
	if !exists {
		return fmt.Errorf("room %q is not available", roomID)
	}

	if unanswered {
		if _, err = c.engine.DB.Exec(ctx, `DELETE FROM room_unanswered_status WHERE room_id = ?`, roomID); err != nil {
			return fmt.Errorf("restore unanswered chat state: %w", err)
		}
		c.mu.Lock()
		delete(c.dismissedEvents, roomID)
		if current, ok := c.rooms[roomID]; ok {
			setRoomNeedsReply(&current, c.currentUserID(), "")
			c.rooms[roomID] = current
		}
		c.mu.Unlock()
	} else {
		eventID := room.LastEventID
		if eventID == "" {
			eventID = room.ID
		}
		if _, err = c.engine.DB.Exec(ctx, `INSERT INTO room_unanswered_status (room_id, dismissed_event_id, dismissed_at)
			VALUES (?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET
			dismissed_event_id = excluded.dismissed_event_id, dismissed_at = excluded.dismissed_at`,
			roomID, eventID, time.Now().UnixMilli()); err != nil {
			return fmt.Errorf("save answered chat state: %w", err)
		}
		c.mu.Lock()
		c.dismissedEvents[roomID] = eventID
		if current, ok := c.rooms[roomID]; ok {
			setRoomNeedsReply(&current, c.currentUserID(), eventID)
			c.rooms[roomID] = current
		}
		c.mu.Unlock()
	}
	c.publish([]string{roomID}, "")
	return nil
}

func (c *Client) Rooms() []Room {
	c.mu.RLock()
	defer c.mu.RUnlock()
	rooms := make([]Room, 0, len(c.rooms))
	for _, room := range c.rooms {
		rooms = append(rooms, room)
	}
	sort.Slice(rooms, func(i, j int) bool {
		if rooms[i].LastSeen.Equal(rooms[j].LastSeen) {
			left, right := strings.ToLower(rooms[i].Name), strings.ToLower(rooms[j].Name)
			if left == right {
				return rooms[i].ID < rooms[j].ID
			}
			return left < right
		}
		return rooms[i].LastSeen.After(rooms[j].LastSeen)
	})
	return rooms
}

func (c *Client) attachSlidingSync() error {
	c.slidingSyncMu.Lock()
	if c.slidingSync != nil {
		c.slidingSyncMu.Unlock()
		return nil
	}
	manager, err := NewSlidingSyncManager(c.engine.Client.HomeserverURL, DefaultSlidingSyncConfig())
	if err != nil {
		c.slidingSyncMu.Unlock()
		return err
	}
	if err = manager.Attach(c.engine.Client); err != nil {
		c.slidingSyncMu.Unlock()
		return err
	}
	c.slidingSync = manager
	c.slidingSyncMu.Unlock()
	c.refreshSlidingSyncPriorityRooms()
	return nil
}

func (c *Client) UpdateVisibleRange(listKey string, startIndex, endIndex int) error {
	c.slidingSyncMu.RLock()
	manager := c.slidingSync
	c.slidingSyncMu.RUnlock()
	if manager == nil {
		return nil
	}
	return manager.UpdateVisibleRange(listKey, startIndex, endIndex)
}

func (c *Client) SlidingSyncListCounts() map[string]int {
	c.slidingSyncMu.RLock()
	manager := c.slidingSync
	c.slidingSyncMu.RUnlock()
	if manager == nil {
		return map[string]int{}
	}
	return manager.state.ListCounts()
}

func (c *Client) SubscribeToRoom(roomID string) error {
	c.slidingSyncMu.RLock()
	manager := c.slidingSync
	c.slidingSyncMu.RUnlock()
	if manager == nil || roomID == "" {
		return nil
	}
	return manager.SubscribeToRoom(roomID)
}

func (c *Client) UnsubscribeFromRoom(roomID string) error {
	c.slidingSyncMu.RLock()
	manager := c.slidingSync
	c.slidingSyncMu.RUnlock()
	if manager == nil || roomID == "" {
		return nil
	}
	return manager.UnsubscribeFromRoom(roomID)
}

func (c *Client) refreshSlidingSyncPriorityRooms() {
	c.slidingSyncMu.RLock()
	manager := c.slidingSync
	c.slidingSyncMu.RUnlock()
	if manager == nil {
		return
	}
	c.mu.RLock()
	roomIDs := make([]string, 0)
	for roomID, room := range c.rooms {
		if room.Unread > 0 || room.MarkedUnread {
			roomIDs = append(roomIDs, roomID)
		}
	}
	c.mu.RUnlock()
	manager.SetPriorityRooms(roomIDs)
}

func (c *Client) RoomMembers(ctx context.Context, roomID string) ([]Member, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	events, err := c.engine.DB.CurrentState.GetMembers(ctx, id.RoomID(roomID))
	if err != nil {
		return nil, fmt.Errorf("read Matrix room members: %w", err)
	}
	members := make([]Member, 0, len(events))
	for _, evt := range events {
		if evt == nil || evt.StateKey == nil {
			continue
		}
		var profile event.MemberEventContent
		if err = json.Unmarshal(evt.GetContent(), &profile); err != nil {
			log.Printf("decode member profile in room %s: %v", roomID, err)
			continue
		}
		if profile.Membership != event.MembershipJoin && profile.Membership != event.MembershipInvite {
			continue
		}
		displayName := strings.TrimSpace(profile.Displayname)
		if displayName == "" {
			displayName = *evt.StateKey
		}
		members = append(members, Member{ID: *evt.StateKey, DisplayName: displayName})
	}
	sort.Slice(members, func(i, j int) bool {
		return strings.ToLower(members[i].DisplayName) < strings.ToLower(members[j].DisplayName)
	})
	return members, nil
}

func (c *Client) LeaveRoom(ctx context.Context, roomID string) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if _, err = c.engine.Client.LeaveRoom(ctx, id.RoomID(roomID)); err != nil {
		return fmt.Errorf("leave Matrix room: %w", err)
	}
	c.mu.Lock()
	delete(c.rooms, roomID)
	delete(c.local, roomID)
	c.mu.Unlock()
	c.publishTimeline([]string{roomID}, "")
	return nil
}

func isDirectRoom(room *database.Room) bool {
	if room == nil {
		return false
	}
	if room.DMUserID != nil {
		return true
	}
	if room.Topic != nil && strings.Contains(strings.ToLower(*room.Topic), "private chat") {
		return true
	}
	if room.LazyLoadSummary == nil || room.LazyLoadSummary.JoinedMemberCount == nil {
		return false
	}
	memberCount := *room.LazyLoadSummary.JoinedMemberCount
	if room.LazyLoadSummary.InvitedMemberCount != nil {
		memberCount += *room.LazyLoadSummary.InvitedMemberCount
	}
	return memberCount == 2
}

// roomUnanswered reports whether the latest message is not from the user, ignoring answered marks.
func roomUnanswered(room Room, userID string) bool {
	// A stale unread count must not keep a room unanswered after the user replies.
	if userID != "" && room.LastEventSender == userID {
		return false
	}
	return room.Unread > 0 || (room.LastEventSender != "" && room.LastEventSender != userID)
}

func roomNeedsReply(room Room, userID, dismissedEventID string) bool {
	if dismissedEventID != "" &&
		(room.LastEventID == dismissedEventID || (room.LastEventID == "" && dismissedEventID == room.ID)) {
		return false
	}
	return roomUnanswered(room, userID)
}

// setRoomNeedsReply sets Unanswered from the latest message and NeedsReply from the answered mark.
func setRoomNeedsReply(room *Room, userID, dismissedEventID string) {
	room.Unanswered = roomUnanswered(*room, userID)
	room.NeedsReply = roomNeedsReply(*room, userID, dismissedEventID)
}

func (c *Client) currentUserID() string {
	if c.engine == nil || c.engine.Account == nil {
		return ""
	}
	return string(c.engine.Account.UserID)
}
