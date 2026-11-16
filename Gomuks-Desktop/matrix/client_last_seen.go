package matrix

import (
	"context"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"time"
)

// lastEventSeenAt returns when another user last read the room's latest message.
// It returns the zero time when the latest message was not sent by the account or has not been read yet.
func (c *Client) lastEventSeenAt(room Room) time.Time {
	if c.engine == nil || c.engine.DB == nil || c.engine.Account == nil || room.LastEventID == "" {
		return time.Time{}
	}
	ownUserID := c.engine.Account.UserID
	if room.LastEventSender != ownUserID.String() {
		return time.Time{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	receipts, err := c.engine.GetReceipts(ctx, id.RoomID(room.ID), []id.EventID{id.EventID(room.LastEventID)})
	if err != nil {
		return time.Time{}
	}
	return latestOtherReadReceiptTime(receipts[id.EventID(room.LastEventID)], ownUserID)
}

// latestOtherReadReceiptTime returns the newest main-timeline read receipt sent by a user other than ownUserID.
func latestOtherReadReceiptTime(receipts []*database.Receipt, ownUserID id.UserID) time.Time {
	var latest time.Time
	for _, receipt := range receipts {
		if receipt == nil || receipt.UserID == ownUserID || receipt.ReceiptType != event.ReceiptTypeRead || receipt.ThreadID != "" || receipt.Timestamp.Time.IsZero() {
			continue
		}
		if receipt.Timestamp.Time.After(latest) {
			latest = receipt.Timestamp.Time
		}
	}
	return latest
}
