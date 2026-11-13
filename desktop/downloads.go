package desktop

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"mychat/matrix"
)

// StorageUsage reports the on-disk size of a Matrix account's database and its
// write-ahead log.
type StorageUsage struct {
	DatabaseBytes int64 `json:"databaseBytes"`
	WALBytes      int64 `json:"walBytes"`
}

// MediaCacheUsage reports the on-disk size and file count of the media cache.
type MediaCacheUsage struct {
	Bytes int64 `json:"bytes"`
	Files int   `json:"files"`
}

// RoomStorage is an approximate per-chat storage attribution.
type RoomStorage struct {
	RoomID     string `json:"roomId"`
	Name       string `json:"name"`
	Messages   int    `json:"messages"`
	TextBytes  int64  `json:"textBytes"`
	MediaBytes int64  `json:"mediaBytes"`
	MediaFiles int    `json:"mediaFiles"`
}

// MediaCleanupRequest selects cached media to delete. Empty or zero fields match everything.
type MediaCleanupRequest struct {
	RoomID        string `json:"roomId"`
	OlderThanDays int    `json:"olderThanDays"`
	MediaType     string `json:"mediaType"`
}

type MediaCleanupResult struct {
	Files int   `json:"files"`
	Bytes int64 `json:"bytes"`
}

const maxDownloadAttempts = 1000

func (s *AppService) StorageUsage() (StorageUsage, error) {
	databaseBytes, walBytes, err := s.currentClient().StorageUsage()
	if err != nil {
		return StorageUsage{}, err
	}
	return StorageUsage{DatabaseBytes: databaseBytes, WALBytes: walBytes}, nil
}

func (s *AppService) MediaCacheUsage() (MediaCacheUsage, error) {
	bytes, files, err := s.currentClient().MediaCacheUsage()
	if err != nil {
		return MediaCacheUsage{}, err
	}
	return MediaCacheUsage{Bytes: bytes, Files: files}, nil
}

func (s *AppService) ClearMediaCache() error {
	return s.currentClient().ClearMediaCache()
}

// RoomStorageUsage reports cached media and approximate message storage per chat.
func (s *AppService) RoomStorageUsage() ([]RoomStorage, error) {
	usage, err := s.currentClient().RoomStorageUsage(s.ctx)
	if err != nil {
		return nil, err
	}
	result := make([]RoomStorage, 0, len(usage))
	for _, entry := range usage {
		result = append(result, RoomStorage{
			RoomID:     entry.RoomID,
			Name:       entry.Name,
			Messages:   entry.Messages,
			TextBytes:  entry.TextBytes,
			MediaBytes: entry.MediaBytes,
			MediaFiles: entry.MediaFiles,
		})
	}
	return result, nil
}

// ClearCachedMedia deletes cached media matching the request. Messages are kept.
func (s *AppService) ClearCachedMedia(request MediaCleanupRequest) (MediaCleanupResult, error) {
	filter, err := mediaCleanupFilter(request, time.Now())
	if err != nil {
		return MediaCleanupResult{}, err
	}
	result, err := s.currentClient().ClearCachedMedia(s.ctx, filter)
	if err != nil {
		return MediaCleanupResult{}, err
	}
	return MediaCleanupResult{Files: result.Files, Bytes: result.Bytes}, nil
}

func mediaCleanupFilter(request MediaCleanupRequest, now time.Time) (matrix.MediaCleanupFilter, error) {
	if request.OlderThanDays < 0 {
		return matrix.MediaCleanupFilter{}, errors.New("age must be zero or more days")
	}
	filter := matrix.MediaCleanupFilter{
		RoomID:    strings.TrimSpace(request.RoomID),
		MediaType: strings.TrimSpace(request.MediaType),
	}
	if request.OlderThanDays > 0 {
		filter.OlderThan = now.AddDate(0, 0, -request.OlderThanDays)
	}
	if err := filter.Validate(); err != nil {
		return matrix.MediaCleanupFilter{}, err
	}
	return filter, nil
}

// saveDownload writes data to directory/name without overwriting an existing file,
// retrying with an index suffix up to maxDownloadAttempts.
func saveDownload(directory, name string, data []byte) (string, error) {
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", fmt.Errorf("create download folder: %w", err)
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for index := 0; index < maxDownloadAttempts; index++ {
		candidateName := name
		if index > 0 {
			candidateName = fmt.Sprintf("%s (%d)%s", base, index, ext)
		}
		candidate := filepath.Join(directory, candidateName)
		file, err := os.OpenFile(candidate, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", fmt.Errorf("create download: %w", err)
		}
		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(candidate)
			return "", fmt.Errorf("save attachment: %w", errors.Join(writeErr, closeErr))
		}
		return candidate, nil
	}
	return "", fmt.Errorf("no available download filename for %q after %d attempts", name, maxDownloadAttempts)
}

// safeDownloadName trims any directory components from a filename and falls back
// to a generic name for empty or path-separator-only values.
func safeDownloadName(filename string) string {
	name := filepath.Base(strings.TrimSpace(filename))
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return "attachment"
	}
	return name
}
