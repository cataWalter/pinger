package desktop

import (
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"
)

func (handler mediaAssetHandler) uploadAttachment(w http.ResponseWriter, r *http.Request, escapedRoomID string) {
	roomID, err := url.PathUnescape(escapedRoomID)
	if err != nil || !validMediaAssetSegment(roomID) {
		http.Error(w, "malformed room ID", http.StatusBadRequest)
		return
	}
	filename := strings.TrimSpace(r.URL.Query().Get("filename"))
	if filename == "" {
		http.Error(w, "an attachment filename is required", http.StatusBadRequest)
		return
	}
	voiceNote, err := strconv.ParseBool(r.URL.Query().Get("voiceNote"))
	if err != nil && r.URL.Query().Get("voiceNote") != "" {
		http.Error(w, "invalid voice-note flag", http.StatusBadRequest)
		return
	}
	videoMessage, err := strconv.ParseBool(r.URL.Query().Get("videoMessage"))
	if err != nil && r.URL.Query().Get("videoMessage") != "" {
		http.Error(w, "invalid video-message flag", http.StatusBadRequest)
		return
	}
	if voiceNote && videoMessage {
		http.Error(w, "attachment cannot be both a voice note and a video message", http.StatusBadRequest)
		return
	}
	durationMilliseconds := int64(0)
	if rawDuration := r.URL.Query().Get("durationMs"); rawDuration != "" {
		durationMilliseconds, err = strconv.ParseInt(rawDuration, 10, 64)
		if err != nil || durationMilliseconds < 0 {
			http.Error(w, "invalid voice-note duration", http.StatusBadRequest)
			return
		}
	}
	if videoMessage && (durationMilliseconds < 1 || durationMilliseconds > maxVideoMessageDurationMilliseconds) {
		http.Error(w, "video-message duration must be between 1 ms and 3 minutes", http.StatusBadRequest)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentSize)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "attachment exceeds the 50 MiB limit", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "could not read attachment", http.StatusBadRequest)
		}
		return
	}
	defer clear(data)
	if len(data) == 0 {
		http.Error(w, "attachment is empty", http.StatusBadRequest)
		return
	}
	if handler.sendAttachmentFn == nil {
		http.Error(w, "Matrix service unavailable", http.StatusInternalServerError)
		return
	}
	if err = handler.sendAttachmentFn(r.Context(), roomID, safeDownloadName(filename), data, voiceNote, videoMessage, durationMilliseconds); err != nil {
		log.Printf("send Matrix attachment to %q: %v", roomID, err)
		http.Error(w, "attachment upload failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func parseMediaAssetPath(escapedPath string) (source, roomID, eventID string, err error) {
	if !strings.HasPrefix(escapedPath, mediaAssetPathPrefix) {
		return "", "", "", errors.New("media URL has no media prefix")
	}
	segments := strings.Split(strings.TrimPrefix(escapedPath, mediaAssetPathPrefix), "/")
	if len(segments) != 3 {
		return "", "", "", errors.New("media URL must have three path segments")
	}
	decoded := make([]string, len(segments))
	for index, segment := range segments {
		decoded[index], err = url.PathUnescape(segment)
		if err != nil || !validMediaAssetSegment(decoded[index]) {
			return "", "", "", errors.New("media URL has an invalid path segment")
		}
	}
	return decoded[0], decoded[1], decoded[2], nil
}

func validMediaAssetSegment(value string) bool {
	if value == "" || value == "." || value == ".." || strings.TrimSpace(value) != value || strings.ContainsAny(value, "/\\") {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return false
		}
	}
	return true
}

func mediaAssetContentType(file *os.File, declared string) (string, error) {
	if parsed, _, err := mime.ParseMediaType(declared); err == nil && parsed != "application/octet-stream" && parsed != "image/unknown" {
		return declared, nil
	}
	buffer := make([]byte, 512)
	read, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	return http.DetectContentType(buffer[:read]), nil
}
