package matrix

import (
	"context"
	"fmt"
	"github.com/rs/zerolog"
	"go.mau.fi/gomuks/pkg/hicli"
	"go.mau.fi/util/dbutil"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"maunium.net/go/mautrix/event"
	"os"
	"path/filepath"
)

// New opens gomuks' SQLite stores and restores the cached account if present.
// Cached room metadata is loaded asynchronously; network syncing is started by Start.
func New(databasePath string) (*Client, error) {
	return NewWithLogOutput(databasePath, os.Stderr)
}

// NewWithLogOutput is New with gomuks engine logs written to logOutput.
func NewWithLogOutput(databasePath string, logOutput io.Writer) (*Client, error) {
	databasePath, err := filepath.Abs(databasePath)
	if err != nil {
		return nil, fmt.Errorf("resolve Matrix database path: %w", err)
	}
	dataDir := filepath.Dir(databasePath)
	if err = os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create Matrix data directory: %w", err)
	}
	if err = os.Chmod(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("secure Matrix data directory: %w", err)
	}
	pickleKey, err := loadOrCreatePickleKey(filepath.Join(dataDir, "crypto.key"))
	if err != nil {
		return nil, err
	}
	if err = ensureSecureFilePermissions(filepath.Join(dataDir, "crypto.key"), 0o600); err != nil {
		return nil, err
	}
	// Harden permissions on existing session material: the SQLite database
	// holds decrypted message contents, access tokens, and Megolm sessions.
	for _, path := range []string{databasePath, databasePath + "-wal", databasePath + "-shm"} {
		if err = ensureSecureFilePermissions(path, 0o600); err != nil {
			return nil, err
		}
	}
	rawDB, err := dbutil.NewWithDialect(databasePath+"?_txlock=immediate", "sqlite3-fk-wal")
	if err != nil {
		return nil, fmt.Errorf("open gomuks SQLite database: %w", err)
	}

	client := &Client{
		dbPath:               databasePath,
		events:               make(chan Update, eventBufferSize),
		done:                 make(chan struct{}),
		cacheReady:           make(chan struct{}),
		rooms:                make(map[string]Room),
		invites:              make(map[string]Invite),
		local:                make(map[string]map[string]Message),
		mediaEncrypted:       make(map[string]*event.EncryptedFileInfo),
		typing:               make(map[string][]string),
		notifiedEvents:       make(map[string]struct{}),
		pendingTimelineRooms: make(map[string]struct{}),
		dismissedEvents:      make(map[string]string),
		mediaCacheDir:        defaultMediaCacheDir(dataDir),
	}
	client.lifecycleCtx, client.lifecycleCancel = context.WithCancel(context.Background())
	logger := zerolog.New(logOutput).With().Timestamp().Logger()
	// hicli is gomuks' embeddable Matrix engine; its callback is invoked from
	// sync and decryption goroutines, so it only publishes immutable snapshots.
	client.engine = hicli.New(rawDB, nil, logger, pickleKey, client.handleBackendEvent)

	ctx := context.Background()
	// Loading with an empty user ID upgrades the schema even when no account
	// has been saved yet, allowing the login form to use the same database.
	if err = client.engine.Load(ctx, ""); err != nil {
		client.Close()
		return nil, fmt.Errorf("initialize gomuks database: %w", err)
	}
	if _, err = client.engine.DB.Exec(ctx, `CREATE TABLE IF NOT EXISTS room_unanswered_status (
		room_id TEXT PRIMARY KEY,
		dismissed_event_id TEXT NOT NULL,
		dismissed_at INTEGER NOT NULL
	)`); err != nil {
		client.Close()
		return nil, fmt.Errorf("initialize unanswered chat state: %w", err)
	}
	dismissedRows, err := client.engine.DB.Query(ctx, `SELECT room_id, dismissed_event_id FROM room_unanswered_status`)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("load unanswered chat state: %w", err)
	}
	for dismissedRows.Next() {
		var roomID, eventID string
		if err = dismissedRows.Scan(&roomID, &eventID); err != nil {
			_ = dismissedRows.Close()
			client.Close()
			return nil, fmt.Errorf("decode unanswered chat state: %w", err)
		}
		client.dismissedEvents[roomID] = eventID
	}
	if err = dismissedRows.Err(); err != nil {
		_ = dismissedRows.Close()
		client.Close()
		return nil, fmt.Errorf("read unanswered chat state: %w", err)
	}
	_ = dismissedRows.Close()
	userID, err := client.engine.DB.Account.GetFirstUserID(ctx)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("read cached Matrix account: %w", err)
	}

	if userID != "" {
		if err = client.engine.Load(ctx, userID); err != nil {
			client.Close()
			return nil, fmt.Errorf("restore cached Matrix account: %w", err)
		}
		restoreCtx, finishRestore, restoreErr := client.beginOperation(ctx)
		if restoreErr != nil {
			client.Close()
			return nil, fmt.Errorf("start cached Matrix restore: %w", restoreErr)
		}
		go func() {
			defer func() {
				close(client.cacheReady)
				finishRestore()
			}()
			for initialSync := range client.engine.GetInitialSync(restoreCtx, 100, 0) {
				client.applySync(initialSync, false)
			}
			if restoreCtx.Err() == nil {
				// Restore sidebar previews from messages already in the local
				// database. This makes no network request.
				client.fillMissingPreviews(restoreCtx, false)
				client.publish(nil, "")
			}
		}()
	} else {
		close(client.cacheReady)
	}
	return client, nil
}
