package matrix

import (
	"errors"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
)

// voiceNoteMIMEType resolves the audio MIME type of a voice note. Containers such as M4A have no
// signature in Go's content sniffer, so generic results fall back to the filename extension.
func voiceNoteMIMEType(sniffed, filename string) (string, error) {
	if parsed, _, err := mime.ParseMediaType(sniffed); err == nil {
		switch {
		case strings.HasPrefix(parsed, "audio/"):
			return parsed, nil
		case parsed == "application/octet-stream" || parsed == "application/ogg":
		default:
			return "", fmt.Errorf("voice notes must use an audio format, not %s", parsed)
		}
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".m4a", ".mp4":
		return "audio/mp4", nil
	case ".ogg", ".oga", ".opus":
		return "audio/ogg", nil
	case ".mp3":
		return "audio/mpeg", nil
	case ".wav":
		return "audio/wav", nil
	case ".webm":
		return "audio/webm", nil
	default:
		return "", errors.New("voice notes must use an audio format")
	}
}
