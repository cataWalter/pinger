package matrix

import (
	"context"
	"go.mau.fi/gomuks/pkg/hicli"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix/id"
	"sync"
	"time"
)

const eventBufferSize = 256
const timelinePageSize = 100
const defaultInitialHistoryLimit = 100

// Reconnect backoff bounds used when (re)starting Matrix sync after a failure.
const (
	reconnectInitialDelay = time.Second
	reconnectMaxDelay     = 30 * time.Second
)

const (
	StateConnecting ConnectionState = "connecting"
	StateSyncing    ConnectionState = "syncing"
	StateConnected  ConnectionState = "connected"
	StateOffline    ConnectionState = "offline"
)

// Notification categories used by per-category notification settings.
const (
	NotificationCategoryDirect  = "direct"
	NotificationCategoryMention = "mention"
	NotificationCategoryGroup   = "group"
)

type Client struct {
	engine     *hicli.HiClient
	dbPath     string
	events     chan Update
	done       chan struct{}
	cacheReady chan struct{}

	mu                     sync.RWMutex
	rooms                  map[string]Room
	invites                map[string]Invite
	urlPreviews            urlPreviewCache
	local                  map[string]map[string]Message
	mediaEncrypted         map[string]*EncryptedMediaFile
	typing                 map[string][]string
	pendingNotifications   []Notification
	pendingIncomingMessage bool
	notifiedEvents         map[string]struct{}
	pendingTimelineRooms   map[string]struct{}
	dismissedEvents        map[string]string
	removedReactions       map[id.EventID]time.Time
	syncReady              bool
	connectionState        ConnectionState
	mediaCacheDir          string
	mediaAssetLocks        mediaAssetLocks

	closeOnce       sync.Once
	eventMu         sync.Mutex
	sendMu          sync.Mutex
	scheduledSends  map[string]chan error
	startMu         sync.Mutex
	directChatMu    sync.Mutex
	slidingSyncMu   sync.RWMutex
	slidingSync     *SlidingSyncManager
	verification    verificationState
	started         bool
	lifecycleMu     sync.Mutex
	lifecycleCtx    context.Context
	lifecycleCancel context.CancelFunc
	operations      sync.WaitGroup
	closed          bool

	previewBackfillOnce sync.Once
}

const (
	reactionRelationPageLimit = 100
	reactionRelationMaxPages  = 20
)

const directAccountDataType = "m.direct"

const unreadReactionCountsQuery = `
	SELECT
		COALESCE(SUM(CASE WHEN event.unread_type & 4 != 0 THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN event.unread_type & 2 != 0 THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN event.unread_type & 1 != 0 THEN 1 ELSE 0 END), 0)
	FROM timeline
	JOIN event ON event.rowid = timeline.event_rowid
	WHERE timeline.room_id = $1 AND timeline.rowid > (
		SELECT MAX(rowid)
		FROM timeline
		WHERE room_id = $1 AND event_rowid IN (
			SELECT event.rowid
			FROM receipt
			JOIN event ON receipt.event_id = event.event_id
			WHERE receipt.room_id = $1 AND receipt.user_id = $2
		)
	) AND event.unread_type > 0 AND event.redacted_by IS NULL
	AND event.relation_type = 'm.annotation'
	AND (event.type = 'm.reaction' OR (event.type = 'm.room.encrypted' AND event.decrypted_type = 'm.reaction'))
`

const (
	// Each backfill pass reads at most previewHistoryMaxPages server pages of
	// previewHistoryPageSize events for a room without a stored message.
	previewHistoryPageSize = 10
	previewHistoryMaxPages = 3
	// Sidebar updates are published once per this many rooms.
	previewPublishBatch = 25
)
