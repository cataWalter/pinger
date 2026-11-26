package matrix

import (
	"context"
	"errors"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
	"os"
	"path/filepath"
	"strings"
)

func (c *Client) DownloadAvatar(ctx context.Context, mxc string) ([]byte, error) {
	if strings.TrimSpace(mxc) == "" {
		return nil, nil
	}
	data, err := c.DownloadMedia(ctx, mxc, nil)
	if isMissingMatrixMediaError(err) {
		return nil, nil
	}
	return data, err
}

func isMissingMatrixMediaError(err error) bool {
	return errors.Is(err, mautrix.MNotFound)
}

// CachedMediaBytes downloads media through the encrypted disk cache.
func (c *Client) CachedMediaBytes(ctx context.Context, mxc string) ([]byte, error) {
	return c.DownloadMedia(ctx, mxc, c.mediaEncryptionFor(mxc))
}

const maxMediaEncryptedEntries = 4096

func (c *Client) mediaEncryptionFor(mxc string) *EncryptedMediaFile {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.mediaEncrypted[mxc]
}

func (c *Client) rememberMediaEncryption(messages []Message) {
	c.rememberRoomMediaEncryption("", messages)
}

func (c *Client) rememberRoomMediaEncryption(roomID string, messages []Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, message := range messages {
		if message.MediaURI != "" && message.MediaEncrypted != nil {
			c.rememberMediaEncryptionEntryLocked(roomID, message.MediaURI, message.MediaEncrypted)
		}
		if message.MediaThumbnailURI != "" && message.MediaThumbnailEncrypted != nil {
			c.rememberMediaEncryptionEntryLocked(roomID, message.MediaThumbnailURI, message.MediaThumbnailEncrypted)
		}
	}
}

func (c *Client) rememberMediaEncryptionEntryLocked(roomID, mxc string, file *EncryptedMediaFile) {
	if c.mediaEncrypted == nil {
		c.mediaEncrypted = make(map[string]*EncryptedMediaFile)
	}
	if _, exists := c.mediaEncrypted[mxc]; exists {
		c.mediaEncrypted[mxc] = file
		c.touchMediaEncryptedOrderLocked(mxc)
	} else {
		c.mediaEncrypted[mxc] = file
		c.mediaEncryptedOrder = append(c.mediaEncryptedOrder, mxc)
		for len(c.mediaEncrypted) > maxMediaEncryptedEntries && len(c.mediaEncryptedOrder) > 0 {
			oldest := c.mediaEncryptedOrder[0]
			c.mediaEncryptedOrder = c.mediaEncryptedOrder[1:]
			delete(c.mediaEncrypted, oldest)
			for _, keys := range c.mediaEncryptedByRoom {
				delete(keys, oldest)
			}
		}
	}
	if roomID != "" {
		if c.mediaEncryptedByRoom == nil {
			c.mediaEncryptedByRoom = make(map[string]map[string]struct{})
		}
		if c.mediaEncryptedByRoom[roomID] == nil {
			c.mediaEncryptedByRoom[roomID] = make(map[string]struct{})
		}
		c.mediaEncryptedByRoom[roomID][mxc] = struct{}{}
	}
}

func (c *Client) touchMediaEncryptedOrderLocked(mxc string) {
	for i, key := range c.mediaEncryptedOrder {
		if key == mxc {
			copy(c.mediaEncryptedOrder[i:], c.mediaEncryptedOrder[i+1:])
			c.mediaEncryptedOrder[len(c.mediaEncryptedOrder)-1] = mxc
			return
		}
	}
	c.mediaEncryptedOrder = append(c.mediaEncryptedOrder, mxc)
}

func (c *Client) forgetRoomMediaEncryptionLocked(roomID string) {
	if roomID == "" || len(c.mediaEncryptedByRoom) == 0 {
		return
	}
	roomKeys, exists := c.mediaEncryptedByRoom[roomID]
	if !exists {
		return
	}
	delete(c.mediaEncryptedByRoom, roomID)
	for mxc := range roomKeys {
		referencedElsewhere := false
		for _, otherKeys := range c.mediaEncryptedByRoom {
			if _, found := otherKeys[mxc]; found {
				referencedElsewhere = true
				break
			}
		}
		if !referencedElsewhere {
			delete(c.mediaEncrypted, mxc)
		}
	}
	if len(c.mediaEncryptedOrder) > 0 {
		kept := c.mediaEncryptedOrder[:0]
		for _, mxc := range c.mediaEncryptedOrder {
			if _, ok := c.mediaEncrypted[mxc]; ok {
				kept = append(kept, mxc)
			}
		}
		c.mediaEncryptedOrder = kept
	}
}

func (c *Client) DownloadMedia(ctx context.Context, mxc string, encrypted *EncryptedMediaFile) ([]byte, error) {
	if strings.TrimSpace(mxc) == "" {
		return nil, errors.New("Matrix media URI is empty")
	}
	if cached, cacheErr := c.readCachedMedia(mxc, encrypted != nil); cacheErr == nil && cached != nil {
		return cached, nil
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	uri, err := id.ContentURIString(mxc).Parse()
	if err != nil {
		return nil, fmt.Errorf("parse Matrix media URI: %w", err)
	}
	response, err := c.engine.Client.Download(ctx, uri)
	if err != nil {
		return nil, fmt.Errorf("download Matrix media: %w", err)
	}
	defer response.Body.Close()
	const maxMediaBytes = 50 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, maxMediaBytes+1))
	if err != nil {
		clear(data)
		return nil, fmt.Errorf("read Matrix media: %w", err)
	}
	if len(data) > maxMediaBytes {
		clear(data)
		return nil, fmt.Errorf("Matrix media exceeds %d MiB", maxMediaBytes>>20)
	}
	if encrypted != nil {
		plaintext, decryptErr := encrypted.decrypt(data)
		if decryptErr != nil {
			clear(data)
			return nil, fmt.Errorf("decrypt Matrix media: %w", decryptErr)
		}
		data = plaintext
	}
	c.writeCachedMedia(mxc, data, encrypted != nil)
	return data, nil
}

// CachedMediaPath returns the disk cache path for mxc when the file exists.
func (c *Client) CachedMediaPath(mxc string) (string, bool) {
	path, err := c.mediaCachePathFor(mxc, c.mediaEncryptionFor(mxc) != nil)
	if err != nil {
		return "", false
	}
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return "", false
	}
	return path, true
}

func (c *Client) readCachedMedia(mxc string, encrypted bool) ([]byte, error) {
	// Encrypted payloads are cached after decryption, so validate size before use.
	path, err := c.mediaCachePathFor(mxc, encrypted)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	const maxMediaBytes = 50 << 20
	if len(data) == 0 || len(data) > maxMediaBytes {
		_ = os.Remove(path)
		return nil, errors.New("cached Matrix media is invalid")
	}
	return data, nil
}

func (c *Client) writeCachedMedia(mxc string, data []byte, encrypted bool) {
	if len(data) == 0 {
		return
	}
	path, err := c.mediaCachePathFor(mxc, encrypted)
	if err != nil {
		return
	}
	if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		log.Printf("create Matrix media cache: %v", err)
		return
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".media-*")
	if err != nil {
		log.Printf("create Matrix media cache entry: %v", err)
		return
	}
	tmpName := tmp.Name()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		log.Printf("write Matrix media cache entry: %v", err)
		return
	}
	if err = tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		log.Printf("close Matrix media cache entry: %v", err)
		return
	}
	_ = os.Chmod(tmpName, 0o600)
	if err = os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		log.Printf("store Matrix media cache entry: %v", err)
	}
}
