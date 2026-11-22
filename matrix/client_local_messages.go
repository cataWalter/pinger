package matrix

import (
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
)

func (c *Client) storeLocalMessage(roomID string, message Message) {
	key := message.TransactionID
	if key == "" {
		key = message.ID
	}
	c.mu.Lock()
	if message.MediaURI != "" && message.MediaEncrypted != nil {
		if c.mediaEncrypted == nil {
			c.mediaEncrypted = make(map[string]*EncryptedMediaFile)
		}
		c.mediaEncrypted[message.MediaURI] = message.MediaEncrypted
	}
	if c.local[roomID] == nil {
		c.local[roomID] = make(map[string]Message)
	}
	c.local[roomID][key] = message
	room, exists := c.rooms[roomID]
	if exists {
		// Own optimistic sends often share the same millisecond as the previous
		// event, so use >= here. Otherwise the sidebar preview/time advances
		// but the text stays on the old bridge topic ("WhatsApp private chat")
		// while the open timeline already shows the sent message.
		if !message.Timestamp.Before(room.LastSeen) {
			room.LastSeen = message.Timestamp
			room.Preview = message.Body
		}
		if !message.Timestamp.Before(room.LastEventAt) {
			room.LastEventAt = message.Timestamp
			room.LastEventID = message.ID
			room.LastEventSender = message.Sender
			setRoomNeedsReply(&room, c.currentUserID(), c.dismissedEvents[roomID])
		}
		c.rooms[roomID] = room
	}
	c.mu.Unlock()
}

func (c *Client) removeLocalMessageLocked(roomID string, evt *database.Event) {
	messages := c.local[roomID]
	for key, message := range messages {
		if message.ID == evt.ID.String() ||
			(message.TransactionID != "" && message.TransactionID == evt.TransactionID) {
			delete(messages, key)
		}
	}
	if len(messages) == 0 {
		delete(c.local, roomID)
	}
}

// storeFailedMessage keeps a genuinely failed send visible (with its error)
// under both the transaction-ID and event-ID keys so the timeline and the
// retry lookup can find it regardless of which identifier the UI holds.
func (c *Client) storeFailedMessage(roomID string, message Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.local[roomID] == nil {
		c.local[roomID] = make(map[string]Message)
	}
	if message.TransactionID != "" {
		c.local[roomID][message.TransactionID] = message
	}
	if message.ID != "" {
		c.local[roomID][message.ID] = message
	}
}

// shadowedByServerRow reports whether a server-confirmed row already covers a
// local optimistic entry whose IDs no longer line up (e.g. the server echo
// arrived with a real event ID while the pending entry still carries the
// local ~txn ID, or vice versa). Matching on sender+body+timestamp proximity
// avoids leaving a stale "Sending..." duplicate next to the confirmed copy.
func shadowedByServerRow(messages []Message, candidate Message) bool {
	if candidate.ID == "" || !candidate.Sending {
		return false
	}
	for _, message := range messages {
		if message.Sending || message.Sender != candidate.Sender || message.Body != candidate.Body {
			continue
		}
		if message.ID != "" && !strings.HasPrefix(message.ID, "~") {
			return true
		}
	}
	return false
}

func containsMessage(messages []Message, candidate Message) bool {
	for _, message := range messages {
		if message.ID == candidate.ID ||
			(candidate.TransactionID != "" && message.TransactionID == candidate.TransactionID) {
			return true
		}
	}
	return false
}
