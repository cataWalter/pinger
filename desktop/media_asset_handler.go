package desktop

import (
	"context"
	"encoding/json"
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

	"mychat/matrix"
)

const mediaAssetPathPrefix = "/media/"
const mediaIPCPathPrefix = "/media/ipc/"
const maxRoomKeyBackupSize = 100 << 20

type mediaAssetSource interface {
	OpenMediaFileForEvent(context.Context, string, string) (*os.File, string, error)
	OpenMediaFileForURI(context.Context, string) (*os.File, error)
}

type mediaAssetHandler struct {
	currentClient    func() mediaAssetSource
	exportRoomKeysFn func(context.Context, string) ([]byte, error)
	importRoomKeysFn func(context.Context, string, []byte) (RoomKeyImportResult, error)
	sendAttachmentFn func(context.Context, string, string, []byte, bool, int64) error
}

func newMediaAssetHandler(service *AppService) http.Handler {
	handler := mediaAssetHandler{}
	if service == nil {
		return handler
	}
	handler.currentClient = func() mediaAssetSource {
		client := service.currentClient()
		if client == nil {
			return nil
		}
		return client
	}
	handler.exportRoomKeysFn = func(ctx context.Context, passphrase string) ([]byte, error) {
		client := service.currentClient()
		if client == nil {
			return nil, errors.New("Matrix account unavailable")
		}
		return client.ExportRoomKeys(ctx, passphrase)
	}
	handler.importRoomKeysFn = func(ctx context.Context, passphrase string, data []byte) (RoomKeyImportResult, error) {
		client := service.currentClient()
		if client == nil {
			return RoomKeyImportResult{}, errors.New("Matrix account unavailable")
		}
		imported, total, err := client.ImportRoomKeys(ctx, passphrase, data)
		return RoomKeyImportResult{Imported: imported, Total: total}, err
	}
	handler.sendAttachmentFn = service.sendAttachment
	return handler
}

func (handler mediaAssetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.EscapedPath(), mediaIPCPathPrefix) {
		handler.serveLocalBinaryRequest(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	source, roomID, eventID, err := parseMediaAssetPath(r.URL.EscapedPath())
	if err != nil {
		http.Error(w, "malformed media URL", http.StatusBadRequest)
		return
	}
	client := handler.currentClient()
	if client == nil {
		http.Error(w, "media not found", http.StatusNotFound)
		return
	}

	var file *os.File
	var declaredMIME string
	switch source {
	case "matrix", "encrypted":
		file, declaredMIME, err = client.OpenMediaFileForEvent(r.Context(), roomID, eventID)
	case "mxc":
		file, err = client.OpenMediaFileForURI(r.Context(), "mxc://"+roomID+"/"+eventID)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, matrix.ErrInvalidMediaRequest):
			http.Error(w, "malformed media URL", http.StatusBadRequest)
		case errors.Is(err, matrix.ErrMediaNotFound):
			http.Error(w, "media not found", http.StatusNotFound)
		default:
			log.Printf("open Matrix media %q/%q: %v", roomID, eventID, err)
			http.Error(w, "media could not be decrypted", http.StatusInternalServerError)
		}
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		log.Printf("stat Matrix media %q/%q: %v", roomID, eventID, err)
		http.Error(w, "media could not be read", http.StatusInternalServerError)
		return
	}
	contentType, err := mediaAssetContentType(file, declaredMIME)
	if err != nil {
		log.Printf("detect Matrix media type %q/%q: %v", roomID, eventID, err)
		http.Error(w, "media could not be read", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, eventID, info.ModTime(), file)
}

func (handler mediaAssetHandler) serveLocalBinaryRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	segments := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), mediaIPCPathPrefix), "/")
	switch {
	case len(segments) == 2 && segments[0] == "room-keys" && segments[1] == "export":
		handler.exportRoomKeys(w, r)
	case len(segments) == 2 && segments[0] == "room-keys" && segments[1] == "import":
		handler.importRoomKeys(w, r)
	case len(segments) == 2 && segments[0] == "attachment":
		handler.uploadAttachment(w, r, segments[1])
	default:
		http.NotFound(w, r)
	}
}

func (handler mediaAssetHandler) exportRoomKeys(w http.ResponseWriter, r *http.Request) {
	if handler.exportRoomKeysFn == nil {
		http.Error(w, "Matrix service unavailable", http.StatusInternalServerError)
		return
	}
	var request struct {
		Passphrase string `json:"passphrase"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || strings.TrimSpace(request.Passphrase) == "" {
		http.Error(w, "a passphrase is required", http.StatusBadRequest)
		return
	}
	data, err := handler.exportRoomKeysFn(r.Context(), request.Passphrase)
	if err != nil {
		log.Printf("export Matrix room keys: %v", err)
		http.Error(w, "room key export failed", http.StatusInternalServerError)
		return
	}
	defer clear(data)
	if len(data) == 0 {
		http.Error(w, "room key export was empty", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="matrix-room-keys.txt"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (handler mediaAssetHandler) importRoomKeys(w http.ResponseWriter, r *http.Request) {
	passphrase := r.Header.Get("X-Matrix-Backup-Passphrase")
	if strings.TrimSpace(passphrase) == "" {
		http.Error(w, "a passphrase is required", http.StatusBadRequest)
		return
	}
	if handler.importRoomKeysFn == nil {
		http.Error(w, "Matrix service unavailable", http.StatusInternalServerError)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRoomKeyBackupSize)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "room key backup exceeds 100 MiB", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "could not read room key backup", http.StatusBadRequest)
		}
		return
	}
	defer clear(data)
	if len(data) == 0 {
		http.Error(w, "room key backup is empty", http.StatusBadRequest)
		return
	}
	result, err := handler.importRoomKeysFn(r.Context(), passphrase, data)
	if err != nil {
		http.Error(w, "room key import failed", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(result)
}

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
	durationMilliseconds := int64(0)
	if rawDuration := r.URL.Query().Get("durationMs"); rawDuration != "" {
		durationMilliseconds, err = strconv.ParseInt(rawDuration, 10, 64)
		if err != nil || durationMilliseconds < 0 {
			http.Error(w, "invalid voice-note duration", http.StatusBadRequest)
			return
		}
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
	if err = handler.sendAttachmentFn(r.Context(), roomID, safeDownloadName(filename), data, voiceNote, durationMilliseconds); err != nil {
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
