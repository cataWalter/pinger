package matrix

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// Media categories accepted by MediaCleanupFilter.MediaType.
const (
	MediaCategoryImage = "image"
	MediaCategoryVideo = "video"
	MediaCategoryAudio = "audio"
	MediaCategoryFile  = "file"
	MediaCategoryOther = "other"
)

// RoomStorage is an approximate attribution of local storage to one room.
// Text bytes are the length of the parsed body fields, which excludes database
// row and index overhead. Media bytes are the cache files that exist on disk.
type RoomStorage struct {
	RoomID     string
	Name       string
	Messages   int
	TextBytes  int64
	MediaBytes int64
	MediaFiles int
}

// MediaCleanupFilter selects cached media to delete. Zero values match everything.
// Only cached media files are removed; messages are never modified.
type MediaCleanupFilter struct {
	RoomID    string
	OlderThan time.Time
	MediaType string
}

// MediaCleanupResult reports how much cached media was removed.
type MediaCleanupResult struct {
	Files int
	Bytes int64
}

type cachedMediaFile struct {
	path string
	size int64
}

// mediaCategory maps a Matrix msgtype to a cleanup category.
func mediaCategory(msgType string) string {
	switch msgType {
	case "":
		return ""
	case string(event.MsgImage):
		return MediaCategoryImage
	case string(event.MsgVideo):
		return MediaCategoryVideo
	case string(event.MsgAudio):
		return MediaCategoryAudio
	case string(event.MsgFile):
		return MediaCategoryFile
	default:
		return MediaCategoryOther
	}
}

// Validate rejects unknown media type filters.
func (f MediaCleanupFilter) Validate() error {
	switch f.MediaType {
	case "", MediaCategoryImage, MediaCategoryVideo, MediaCategoryAudio, MediaCategoryFile, MediaCategoryOther:
		return nil
	}
	return fmt.Errorf("unknown media type %q", f.MediaType)
}

// Matches reports whether a message's media falls under the filter.
func (f MediaCleanupFilter) Matches(message Message) bool {
	if !f.OlderThan.IsZero() && !message.Timestamp.Before(f.OlderThan) {
		return false
	}
	if f.MediaType != "" && mediaCategory(message.MediaType) != f.MediaType {
		return false
	}
	return true
}

// cachedMediaFilesFor returns the on-disk cache files for a message's media and thumbnail.
// Files that do not exist are skipped, so the returned sizes are real disk usage.
func (c *Client) cachedMediaFilesFor(message Message) []cachedMediaFile {
	if c.MediaCacheDir() == "" {
		return nil
	}
	refs := []struct {
		uri       string
		encrypted bool
	}{
		{message.MediaURI, message.MediaEncrypted != nil},
		{message.MediaThumbnailURI, message.MediaThumbnailEncrypted != nil},
	}
	var files []cachedMediaFile
	for _, ref := range refs {
		if ref.uri == "" {
			continue
		}
		path, err := c.mediaCachePathFor(ref.uri, ref.encrypted)
		if err != nil {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		files = append(files, cachedMediaFile{path: path, size: info.Size()})
	}
	return files
}

// summarizeRoomStorage attributes text and cached media bytes to a room's messages.
func (c *Client) summarizeRoomStorage(roomID, name string, messages []Message) RoomStorage {
	summary := RoomStorage{RoomID: roomID, Name: name}
	seen := make(map[string]struct{})
	for _, message := range messages {
		summary.Messages++
		summary.TextBytes += int64(len(message.Body) + len(message.FormattedBody))
		for _, file := range c.cachedMediaFilesFor(message) {
			if _, dup := seen[file.path]; dup {
				continue
			}
			seen[file.path] = struct{}{}
			summary.MediaBytes += file.size
			summary.MediaFiles++
		}
	}
	return summary
}

// removeCachedMedia deletes cache files for messages matching filter. The removed map
// records paths already deleted so repeated files across rooms are counted once.
func (c *Client) removeCachedMedia(messages []Message, filter MediaCleanupFilter, removed map[string]struct{}) (MediaCleanupResult, error) {
	var result MediaCleanupResult
	for _, message := range messages {
		if !filter.Matches(message) {
			continue
		}
		for _, file := range c.cachedMediaFilesFor(message) {
			if _, dup := removed[file.path]; dup {
				continue
			}
			if err := os.Remove(file.path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return result, fmt.Errorf("remove cached media %q: %w", file.path, err)
			}
			removed[file.path] = struct{}{}
			result.Files++
			result.Bytes += file.size
		}
	}
	return result, nil
}

// roomMessages loads every parsed message in a room's timeline.
func (c *Client) roomMessages(ctx context.Context, roomID string) ([]Message, error) {
	var messages []Message
	cursor := database.TimelineRowID(0)
	for {
		batch, err := c.engine.DB.Timeline.Get(ctx, id.RoomID(roomID), timelinePageSize, cursor)
		if err != nil {
			return nil, fmt.Errorf("read room timeline: %w", err)
		}
		for _, evt := range batch {
			if message, ok := messageFromEvent(evt); ok {
				messages = append(messages, message)
			}
		}
		if len(batch) < timelinePageSize {
			return messages, nil
		}
		cursor = batch[len(batch)-1].TimelineRowID
	}
}

// RoomStorageUsage attributes local message and cached media storage to each room
// with messages, largest first.
func (c *Client) RoomStorageUsage(ctx context.Context) ([]RoomStorage, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	rooms := c.Rooms()
	usage := make([]RoomStorage, 0, len(rooms))
	for _, room := range rooms {
		messages, err := c.roomMessages(ctx, room.ID)
		if err != nil {
			return nil, fmt.Errorf("measure room %s: %w", room.ID, err)
		}
		if len(messages) == 0 {
			continue
		}
		usage = append(usage, c.summarizeRoomStorage(room.ID, room.Name, messages))
	}
	sort.SliceStable(usage, func(i, j int) bool {
		left := usage[i].TextBytes + usage[i].MediaBytes
		right := usage[j].TextBytes + usage[j].MediaBytes
		if left != right {
			return left > right
		}
		return usage[i].RoomID < usage[j].RoomID
	})
	return usage, nil
}

// ClearCachedMedia deletes cached media for messages matching filter across one room
// or all rooms. Message history is left intact; media is re-downloaded on demand.
func (c *Client) ClearCachedMedia(ctx context.Context, filter MediaCleanupFilter) (MediaCleanupResult, error) {
	if err := filter.Validate(); err != nil {
		return MediaCleanupResult{}, err
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return MediaCleanupResult{}, err
	}
	defer finish()
	roomIDs := []string{filter.RoomID}
	if filter.RoomID == "" {
		roomIDs = roomIDs[:0]
		for _, room := range c.Rooms() {
			roomIDs = append(roomIDs, room.ID)
		}
	}
	var total MediaCleanupResult
	removed := make(map[string]struct{})
	for _, roomID := range roomIDs {
		messages, err := c.roomMessages(ctx, roomID)
		if err != nil {
			return total, fmt.Errorf("read room %s for media cleanup: %w", roomID, err)
		}
		result, err := c.removeCachedMedia(messages, filter, removed)
		total.Files += result.Files
		total.Bytes += result.Bytes
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

// EnforceMediaCachePolicy prunes cached media files older than maxAgeDays and trims oldest files to keep disk usage within maxBytes.
func (c *Client) EnforceMediaCachePolicy(maxBytes int64, maxAgeDays int, now time.Time) (MediaCleanupResult, error) {
	if maxBytes <= 0 && maxAgeDays <= 0 {
		return MediaCleanupResult{}, nil
	}
	dir := c.MediaCacheDir()
	if dir == "" {
		return MediaCleanupResult{}, nil
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return MediaCleanupResult{}, nil
	}
	if err != nil {
		return MediaCleanupResult{}, fmt.Errorf("read media cache directory: %w", err)
	}
	type diskEntry struct {
		path    string
		size    int64
		modTime time.Time
	}
	var kept []diskEntry
	var totalBytes int64
	var result MediaCleanupResult
	cutoff := time.Time{}
	if maxAgeDays > 0 {
		cutoff = now.AddDate(0, 0, -maxAgeDays)
	}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".media-") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		size := info.Size()
		if !cutoff.IsZero() && info.ModTime().Before(cutoff) {
			if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return result, fmt.Errorf("remove expired cached media %q: %w", path, removeErr)
			}
			result.Files++
			result.Bytes += size
			continue
		}
		totalBytes += size
		kept = append(kept, diskEntry{path: path, size: size, modTime: info.ModTime()})
	}
	if maxBytes > 0 && totalBytes > maxBytes {
		sort.SliceStable(kept, func(i, j int) bool {
			if !kept[i].modTime.Equal(kept[j].modTime) {
				return kept[i].modTime.Before(kept[j].modTime)
			}
			return kept[i].path < kept[j].path
		})
		for _, item := range kept {
			if totalBytes <= maxBytes {
				break
			}
			if removeErr := os.Remove(item.path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return result, fmt.Errorf("trim cached media %q: %w", item.path, removeErr)
			}
			totalBytes -= item.size
			result.Files++
			result.Bytes += item.size
		}
	}
	return result, nil
}
