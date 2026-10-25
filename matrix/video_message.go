package matrix

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
	"time"
)

const maxVideoMessageDuration = 3 * time.Minute

func (c *Client) SendVideoMessage(ctx context.Context, roomID, filename string, data []byte, durationMilliseconds int64) error {
	if durationMilliseconds <= 0 || durationMilliseconds > int64(maxVideoMessageDuration/time.Millisecond) {
		return errors.New("video message duration must be between 1 ms and 3 minutes")
	}
	return c.sendAttachment(ctx, roomID, filename, data, 0, durationMilliseconds)
}

func videoMessageMIMEType(sniffed, filename string) (string, error) {
	if parsed, _, err := mime.ParseMediaType(sniffed); err == nil {
		switch parsed {
		case "video/mp4", "video/webm":
			return parsed, nil
		case "application/octet-stream":
		default:
			return "", fmt.Errorf("video messages must use MP4 or WebM format")
		}
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".mp4":
		return "video/mp4", nil
	case ".webm":
		return "video/webm", nil
	default:
		return "", errors.New("video messages must use MP4 or WebM format")
	}
}
