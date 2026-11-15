package matrix

import (
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/util/jsontime"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestLatestOtherReadReceiptTimeIgnoresOwnAndNonMainReceipts(t *testing.T) {
	ownUserID := id.UserID("@me:example.org")
	readAt := time.Date(2026, time.October, 20, 16, 40, 0, 0, time.UTC)
	receipts := []*database.Receipt{
		{UserID: ownUserID, ReceiptType: event.ReceiptTypeRead, Timestamp: jsontime.UM(readAt.Add(time.Hour))},
		{UserID: "@friend:example.org", ReceiptType: event.ReceiptType("m.read.private"), Timestamp: jsontime.UM(readAt.Add(time.Hour))},
		{UserID: "@friend:example.org", ReceiptType: event.ReceiptTypeRead, ThreadID: "$thread", Timestamp: jsontime.UM(readAt.Add(time.Hour))},
		{UserID: "@friend:example.org", ReceiptType: event.ReceiptTypeRead, Timestamp: jsontime.UM(readAt.Add(-time.Minute))},
		{UserID: "@other:example.org", ReceiptType: event.ReceiptTypeRead, Timestamp: jsontime.UM(readAt)},
		nil,
	}

	if got := latestOtherReadReceiptTime(receipts, ownUserID); !got.Equal(readAt) {
		t.Fatalf("latestOtherReadReceiptTime() = %v, want %v", got, readAt)
	}
	if got := latestOtherReadReceiptTime(nil, ownUserID); !got.IsZero() {
		t.Fatalf("latestOtherReadReceiptTime(nil) = %v, want zero time", got)
	}
}
