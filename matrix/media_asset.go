package matrix

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"unicode"

	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

var (
	ErrInvalidMediaRequest = errors.New("invalid media request")
	ErrMediaNotFound       = errors.New("media not found")
)

const maxCachedMediaSize = 50 << 20

type mediaAssetLockEntry struct {
	mu   sync.Mutex
	refs int
}

type mediaAssetLocks struct {
	mu      sync.Mutex
	entries map[string]*mediaAssetLockEntry
}

func (locks *mediaAssetLocks) lock(key string) func() {
	locks.mu.Lock()
	if locks.entries == nil {
		locks.entries = make(map[string]*mediaAssetLockEntry)
	}
	entry := locks.entries[key]
	if entry == nil {
		entry = &mediaAssetLockEntry{}
		locks.entries[key] = entry
	}
	entry.refs++
	locks.mu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		locks.mu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(locks.entries, key)
		}
		locks.mu.Unlock()
	}
}

func (c *Client) OpenMediaFileForEvent(ctx context.Context, roomID, eventID string) (*os.File, string, error) {
	if !validMediaIdentifier(roomID) || !validMediaIdentifier(eventID) {
		return nil, "", ErrInvalidMediaRequest
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, "", err
	}
	defer finish()

	storedEvent, err := c.engine.DB.Event.GetByID(ctx, id.RoomID(roomID), id.EventID(eventID))
	if errors.Is(err, sql.ErrNoRows) || (err == nil && storedEvent == nil) {
		return nil, "", ErrMediaNotFound
	}
	if err != nil {
		return nil, "", fmt.Errorf("read Matrix media event: %w", err)
	}
	message, ok := messageFromEvent(storedEvent)
	if message.DecryptionError != "" {
		return nil, "", fmt.Errorf("decrypt Matrix media event: %s", message.DecryptionError)
	}
	if !ok || message.Redacted || message.MediaURI == "" {
		return nil, "", ErrMediaNotFound
	}
	file, err := c.openCachedMediaFile(ctx, message.MediaURI, message.MediaEncrypted)
	if err != nil {
		return nil, "", err
	}
	return file, message.MediaMIME, nil
}

func (c *Client) OpenMediaFileForURI(ctx context.Context, mxc string) (*os.File, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()

	file, err := c.openCachedMediaFile(ctx, mxc, c.mediaEncryptionFor(mxc))
	if err != nil {
		return nil, err
	}
	return file, nil
}

func (c *Client) openCachedMediaFile(ctx context.Context, mxc string, encrypted *event.EncryptedFileInfo) (*os.File, error) {
	if strings.TrimSpace(mxc) == "" {
		return nil, ErrInvalidMediaRequest
	}
	if _, _, err := parseMXC(mxc); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidMediaRequest, err)
	}
	cachePath, err := c.mediaCachePathFor(mxc, encrypted != nil)
	if err != nil {
		return nil, err
	}
	unlock := c.mediaAssetLocks.lock(cachePath)
	defer unlock()

	if info, statErr := os.Stat(cachePath); statErr == nil {
		if info.Mode().IsRegular() && info.Size() > 0 && info.Size() <= maxCachedMediaSize {
			return os.Open(cachePath)
		}
		if removeErr := os.Remove(cachePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return nil, fmt.Errorf("remove invalid cached media: %w", removeErr)
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, fmt.Errorf("inspect cached media: %w", statErr)
	}

	data, err := c.DownloadMedia(ctx, mxc, encrypted)
	if err != nil {
		if isMissingMatrixMediaError(err) {
			return nil, ErrMediaNotFound
		}
		return nil, err
	}
	defer clear(data)

	file, err := os.Open(cachePath)
	if err != nil {
		return nil, fmt.Errorf("open cached media: %w", err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("stat cached media: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxCachedMediaSize {
		_ = file.Close()
		return nil, errors.New("cached Matrix media is invalid")
	}
	return file, nil
}

func validMediaIdentifier(value string) bool {
	if value == "" || strings.TrimSpace(value) != value || strings.ContainsAny(value, "/\\") {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return false
		}
	}
	return true
}
