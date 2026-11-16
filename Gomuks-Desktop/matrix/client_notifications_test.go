package matrix

import (
	"context"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNotificationCategoryClassifiesDirectMentionAndGroup(t *testing.T) {
	tests := []struct {
		name      string
		direct    bool
		highlight bool
		want      string
	}{
		{name: "direct room", direct: true, highlight: false, want: NotificationCategoryDirect},
		{name: "direct highlight stays direct", direct: true, highlight: true, want: NotificationCategoryDirect},
		{name: "group mention", direct: false, highlight: true, want: NotificationCategoryMention},
		{name: "group message", direct: false, highlight: false, want: NotificationCategoryGroup},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := notificationCategory(test.direct, test.highlight); got != test.want {
				t.Fatalf("notificationCategory(%v, %v) = %q, want %q", test.direct, test.highlight, got, test.want)
			}
		})
	}
}

func TestMissingMatrixMediaErrorIsRecognized(t *testing.T) {
	if !isMissingMatrixMediaError(fmt.Errorf("download Matrix media: %w", mautrix.MNotFound)) {
		t.Fatal("wrapped M_NOT_FOUND error was not recognized")
	}
	if isMissingMatrixMediaError(fmt.Errorf("media server unavailable")) {
		t.Fatal("non-404 error was treated as missing media")
	}
}

func TestMissingMatrixReadTargetErrorIsRecognized(t *testing.T) {
	if !isMissingMatrixReadTargetError(fmt.Errorf("send read receipt: %w", mautrix.MNotFound)) {
		t.Fatal("wrapped M_NOT_FOUND read target error was not recognized")
	}
	if isMissingMatrixReadTargetError(fmt.Errorf("Matrix server unavailable")) {
		t.Fatal("non-404 error was treated as a missing read target")
	}
}

func TestLocalMessagesMatchTimelineByEventOrTransactionID(t *testing.T) {
	tests := []struct {
		name      string
		timeline  Message
		candidate Message
	}{
		{
			name:      "event ID",
			timeline:  Message{ID: "$event"},
			candidate: Message{ID: "$event", TransactionID: "txn"},
		},
		{
			name:      "transaction ID",
			timeline:  Message{ID: "$event", TransactionID: "txn"},
			candidate: Message{ID: "~pending", TransactionID: "txn"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !containsMessage([]Message{test.timeline}, test.candidate) {
				t.Fatal("expected timeline message to match cached local message")
			}
		})
	}
}

func TestPublishCoalescesPendingUpdatesWithoutDroppingChangedRooms(t *testing.T) {
	client := &Client{
		events: make(chan Update, eventBufferSize),
		done:   make(chan struct{}),
		rooms:  make(map[string]Room),
		local:  make(map[string]map[string]Message),
	}

	for i := 0; i < eventBufferSize+100; i++ {
		client.publish([]string{fmt.Sprintf("!room-%03d:example.org", i)}, "")
	}

	updates := make([]Update, 0, eventBufferSize)
	for len(client.events) > 0 {
		updates = append(updates, <-client.events)
	}
	if len(updates) >= eventBufferSize {
		t.Fatalf("event queue was not coalesced: retained %d updates", len(updates))
	}
	changed := make(map[string]struct{})
	for _, update := range updates {
		for _, roomID := range update.ChangedRoomID {
			changed[roomID] = struct{}{}
		}
	}
	if len(changed) != eventBufferSize+100 {
		t.Fatalf("coalesced %d changed room IDs, want %d", len(changed), eventBufferSize+100)
	}
}

func TestInitCompletePublishesSyncReadyState(t *testing.T) {
	client := &Client{
		events: make(chan Update, 1),
		done:   make(chan struct{}),
		rooms:  make(map[string]Room),
		local:  make(map[string]map[string]Message),
	}

	client.handleBackendEvent(&jsoncmd.InitComplete{})

	select {
	case update := <-client.Events():
		if !update.InitialSyncComplete {
			t.Fatal("initial sync completion was not included in the update")
		}
	case <-time.After(time.Second):
		t.Fatal("expected a sync-ready update")
	}
	if !client.SyncReady() {
		t.Fatal("client should report initial sync ready")
	}
}

func TestNewInitializesAndReopensLocalDatabase(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "profile", "matrix.db")
	client, err := New(databasePath)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	client.Close()

	keyInfo, err := os.Stat(filepath.Join(filepath.Dir(databasePath), "crypto.key"))
	if err != nil {
		t.Fatalf("stat crypto key: %v", err)
	}
	if keyInfo.Mode().Perm() != 0o600 {
		t.Fatalf("crypto key permissions = %04o, want 0600", keyInfo.Mode().Perm())
	}

	client, err = New(databasePath)
	if err != nil {
		t.Fatalf("reopen client: %v", err)
	}
	client.Close()
}

func TestWaitForCacheWaitsUntilRestoreCompletes(t *testing.T) {
	client := &Client{cacheReady: make(chan struct{})}
	started := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		close(started)
		result <- client.WaitForCache(context.Background())
	}()
	<-started
	select {
	case err := <-result:
		t.Fatalf("WaitForCache returned before restore completed: %v", err)
	default:
	}

	close(client.cacheReady)
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("WaitForCache: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("WaitForCache did not return after restore completed")
	}
}

func TestLocalSearchParamsSupportsGlobalFiltersAndPagination(t *testing.T) {
	minTimestamp := time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC)
	maxTimestamp := time.Date(2026, time.October, 17, 23, 59, 59, 999000000, time.UTC)
	request := SearchRequest{
		Query:        "  project update  ",
		RoomID:       "!room:example.org",
		Sender:       "@alice:example.org",
		MinTimestamp: minTimestamp.UnixMilli(),
		MaxTimestamp: maxTimestamp.UnixMilli(),
		Limit:        25,
		NextBatch:    "local_offset:25",
	}

	params, err := localSearchParams(request)
	if err != nil {
		t.Fatalf("build search params: %v", err)
	}
	if params.SearchTerm != "project update" || !params.SortByTime || params.Limit != 25 || params.NextBatch != request.NextBatch {
		t.Fatalf("unexpected search params: %+v", params)
	}
	if len(params.RoomIDs) != 1 || params.RoomIDs[0] != id.RoomID(request.RoomID) {
		t.Fatalf("room filter = %v, want %q", params.RoomIDs, request.RoomID)
	}
	if len(params.Senders) != 1 || params.Senders[0] != id.UserID(request.Sender) {
		t.Fatalf("sender filter = %v, want %q", params.Senders, request.Sender)
	}
	if params.MinTimestamp.UnixMilli() != request.MinTimestamp || params.MaxTimestamp.UnixMilli() != request.MaxTimestamp {
		t.Fatalf("timestamp filters = (%d, %d), want (%d, %d)", params.MinTimestamp.UnixMilli(), params.MaxTimestamp.UnixMilli(), request.MinTimestamp, request.MaxTimestamp)
	}

	globalParams, err := localSearchParams(SearchRequest{Query: "topic"})
	if err != nil {
		t.Fatalf("build global search params: %v", err)
	}
	if len(globalParams.RoomIDs) != 0 || globalParams.Limit != 50 {
		t.Fatalf("global search params = %+v, want no room filter and default limit 50", globalParams)
	}
}

func TestReconnectDelayDoublesAndCaps(t *testing.T) {
	got := []time.Duration{
		LastReconnectDelay(0),
		LastReconnectDelay(1),
		LastReconnectDelay(2),
		LastReconnectDelay(5),
		LastReconnectDelay(6),
		LastReconnectDelay(20),
	}
	want := []time.Duration{time.Second, time.Second, 2 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("reconnect delay[%d] = %s, want %s", i, got[i], want[i])
		}
	}
}

func TestParseMXCRejectsInvalidURIs(t *testing.T) {
	server, mediaID, err := parseMXC("mxc://example.org/media123")
	if err != nil || server != "example.org" || mediaID != "media123" {
		t.Fatalf("parse mxc = (%q, %q, %v)", server, mediaID, err)
	}
	for _, invalid := range []string{"", "https://example.org/x", "mxc://", "mxc://server/", "mxc:///id", "mxc://s/a/b"} {
		if _, _, err = parseMXC(invalid); err == nil {
			t.Fatalf("expected error for %q", invalid)
		}
	}
}

func TestMediaCacheUsageAndClear(t *testing.T) {
	client := &Client{mediaCacheDir: filepath.Join(t.TempDir(), "media")}
	if err := os.MkdirAll(client.MediaCacheDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(client.MediaCacheDir(), "a"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(client.MediaCacheDir(), "b"), []byte("world!"), 0o600); err != nil {
		t.Fatal(err)
	}
	bytes, files, err := client.MediaCacheUsage()
	if err != nil || files != 2 || bytes != 11 {
		t.Fatalf("media usage = (%d, %d, %v)", bytes, files, err)
	}
	if path, err := client.mediaCachePath("mxc://example.org/media123"); err != nil || !strings.HasPrefix(path, client.MediaCacheDir()) {
		t.Fatalf("media cache path = %q, %v", path, err)
	}
	if err := client.ClearMediaCache(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := client.MediaCacheUsage(); err != nil {
		t.Fatal(err)
	}
}
