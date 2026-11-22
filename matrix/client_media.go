package matrix

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"
)

// defaultMediaCacheDir prefers the OS cache directory and falls back to the
// config data directory so portable installs keep working.
func defaultMediaCacheDir(dataDir string) string {
	if cacheDir, err := os.UserCacheDir(); err == nil && cacheDir != "" {
		return filepath.Join(cacheDir, "gomuks-desktop", "media")
	}
	return filepath.Join(dataDir, "media")
}

// SetMediaCacheDir overrides the on-disk media cache directory (tests, portable installs).
func (c *Client) SetMediaCacheDir(dir string) {
	c.mu.Lock()
	c.mediaCacheDir = dir
	c.mu.Unlock()
}

// MediaCacheDir reports the directory used for decrypted media files.
func (c *Client) MediaCacheDir() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.mediaCacheDir
}

// mediaCachePath maps an mxc:// URI to a stable cache file name.
func (c *Client) mediaCachePath(mxc string) (string, error) {
	server, mediaID, err := parseMXC(mxc)
	if err != nil {
		return "", err
	}
	name := server + "_" + mediaID
	sum := sha256.Sum256([]byte(mxc))
	return filepath.Join(c.MediaCacheDir(), name+"-"+hex.EncodeToString(sum[:8])), nil
}

func (c *Client) mediaCachePathFor(mxc string, encrypted bool) (string, error) {
	path, err := c.mediaCachePath(mxc)
	if err != nil || !encrypted {
		return path, err
	}
	return path + ".encrypted", nil
}

func parseMXC(mxc string) (server, mediaID string, err error) {
	rest, ok := strings.CutPrefix(strings.TrimSpace(mxc), "mxc://")
	if !ok || rest == "" {
		return "", "", fmt.Errorf("invalid Matrix media URI %q", mxc)
	}
	server, mediaID, ok = strings.Cut(rest, "/")
	if !ok || server == "" || mediaID == "" || strings.Contains(mediaID, "/") {
		return "", "", fmt.Errorf("invalid Matrix media URI %q", mxc)
	}
	return server, mediaID, nil
}

// MediaCacheUsage walks the media cache directory and reports its size.
func (c *Client) MediaCacheUsage() (bytes int64, files int, err error) {
	dir := c.MediaCacheDir()
	if dir == "" {
		return 0, 0, nil
	}
	err = filepath.WalkDir(dir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		bytes += info.Size()
		files++
		return nil
	})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, 0, nil
		}
		return 0, 0, fmt.Errorf("measure media cache: %w", err)
	}
	return bytes, files, nil
}

// ClearMediaCache removes cached media files without touching message history.
func (c *Client) ClearMediaCache() error {
	dir := c.MediaCacheDir()
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("list media cache: %w", err)
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if err = os.RemoveAll(path); err != nil {
			return fmt.Errorf("remove cached media at %q: %w", path, err)
		}
	}
	return nil
}

func mediaMIME(info *mediaContentInfo) string {
	if info == nil {
		return ""
	}
	return info.MimeType
}

func mediaThumbnailURI(info *mediaContentInfo) string {
	if info == nil {
		return ""
	}
	if info.ThumbnailURL != "" {
		return string(info.ThumbnailURL)
	}
	if info.ThumbnailFile != nil {
		return string(info.ThumbnailFile.URL)
	}
	return ""
}

func mediaThumbnailEncrypted(info *mediaContentInfo) *EncryptedMediaFile {
	if info == nil {
		return nil
	}
	return info.ThumbnailFile
}

func mediaSize(info *mediaContentInfo) int {
	if info == nil {
		return 0
	}
	return info.Size
}

func mediaWidth(info *mediaContentInfo) int {
	if info == nil {
		return 0
	}
	return info.Width
}

func mediaHeight(info *mediaContentInfo) int {
	if info == nil {
		return 0
	}
	return info.Height
}

func mediaDuration(info *mediaContentInfo) int {
	if info == nil || info.Duration <= 0 {
		return 0
	}
	return int(info.Duration)
}
