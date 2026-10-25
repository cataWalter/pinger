package desktop

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mychat/matrix"
)

type testMediaAssetSource struct {
	path     string
	mimeType string
	eventErr error
	uriErr   error
	roomID   string
	eventID  string
	mediaURI string
}

func (source *testMediaAssetSource) OpenMediaFileForEvent(_ context.Context, roomID, eventID string) (*os.File, string, error) {
	source.roomID, source.eventID = roomID, eventID
	if source.eventErr != nil {
		return nil, "", source.eventErr
	}
	file, err := os.Open(source.path)
	return file, source.mimeType, err
}

func (source *testMediaAssetSource) OpenMediaFileForURI(_ context.Context, mediaURI string) (*os.File, error) {
	source.mediaURI = mediaURI
	if source.uriErr != nil {
		return nil, source.uriErr
	}
	return os.Open(source.path)
}

func TestMediaAssetHandlerServesRangesAndEventMIME(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media")
	if err := os.WriteFile(path, []byte("0123456789"), 0o600); err != nil {
		t.Fatalf("write media: %v", err)
	}
	source := &testMediaAssetSource{path: path, mimeType: "image/webp"}
	handler := mediaAssetHandler{currentClient: func() mediaAssetSource { return source }}
	request := httptest.NewRequest(http.MethodGet, "/media/matrix/%21room%3Aexample.org/%24photo", nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" {
		t.Fatalf("response = %d %q, want 206 with range bytes", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Fatalf("Content-Range = %q, want bytes 2-5/10", got)
	}
	if got := response.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type = %q, want image/webp", got)
	}
	if got := response.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want bytes", got)
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if source.roomID != "!room:example.org" || source.eventID != "$photo" {
		t.Fatalf("resolved event = %q/%q", source.roomID, source.eventID)
	}
}

func TestMediaAssetHandlerMapsMalformedMissingAndDecryptErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media")
	if err := os.WriteFile(path, []byte("media"), 0o600); err != nil {
		t.Fatalf("write media: %v", err)
	}
	tests := []struct {
		name       string
		path       string
		eventErr   error
		wantStatus int
	}{
		{name: "malformed path", path: "/media/matrix/%21room%3Aexample.org/%2Fbad", wantStatus: http.StatusBadRequest},
		{name: "missing event", path: "/media/matrix/%21room%3Aexample.org/%24missing", eventErr: matrix.ErrMediaNotFound, wantStatus: http.StatusNotFound},
		{name: "decryption failure", path: "/media/encrypted/%21room%3Aexample.org/%24photo", eventErr: errors.New("bad encryption key"), wantStatus: http.StatusInternalServerError},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := &testMediaAssetSource{path: path, eventErr: test.eventErr}
			handler := mediaAssetHandler{currentClient: func() mediaAssetSource { return source }}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %q", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestMediaAssetHandlerServesMXCURI(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media")
	if err := os.WriteFile(path, []byte("GIF89a"), 0o600); err != nil {
		t.Fatalf("write media: %v", err)
	}
	source := &testMediaAssetSource{path: path}
	handler := mediaAssetHandler{currentClient: func() mediaAssetSource { return source }}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/media/mxc/example.org/avatar", nil))

	data, err := io.ReadAll(response.Result().Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if response.Code != http.StatusOK || string(data) != "GIF89a" || response.Header().Get("Content-Type") != "image/gif" {
		t.Fatalf("response = %d, %q, %q", response.Code, data, response.Header().Get("Content-Type"))
	}
	if source.mediaURI != "mxc://example.org/avatar" {
		t.Fatalf("MXC URI = %q", source.mediaURI)
	}
}

func TestMediaAssetHandlerUsesRawHTTPForBinaryOperations(t *testing.T) {
	var importedPassphrase, importedData string
	var uploadedRoomID, uploadedFilename, uploadedData string
	var uploadedVoiceNote, uploadedVideoMessage bool
	var uploadedDuration int64
	handler := mediaAssetHandler{
		exportRoomKeysFn: func(_ context.Context, passphrase string) ([]byte, error) {
			if passphrase != "backup secret" {
				t.Fatalf("export passphrase = %q", passphrase)
			}
			return []byte("encrypted backup bytes"), nil
		},
		importRoomKeysFn: func(_ context.Context, passphrase string, data []byte) (RoomKeyImportResult, error) {
			importedPassphrase = passphrase
			importedData = string(append([]byte(nil), data...))
			return RoomKeyImportResult{Imported: 2, Total: 3}, nil
		},
		sendAttachmentFn: func(_ context.Context, roomID, filename string, data []byte, voiceNote, videoMessage bool, duration int64) error {
			uploadedRoomID = roomID
			uploadedFilename = filename
			uploadedData = string(append([]byte(nil), data...))
			uploadedVoiceNote = voiceNote
			uploadedVideoMessage = videoMessage
			uploadedDuration = duration
			return nil
		},
	}

	exportResponse := httptest.NewRecorder()
	handler.ServeHTTP(exportResponse, httptest.NewRequest(http.MethodPost, "/media/ipc/room-keys/export", strings.NewReader(`{"passphrase":"backup secret"}`)))
	if exportResponse.Code != http.StatusOK || exportResponse.Body.String() != "encrypted backup bytes" {
		t.Fatalf("key export = %d %q", exportResponse.Code, exportResponse.Body.String())
	}
	if exportResponse.Header().Get("Cache-Control") != "no-store" || exportResponse.Header().Get("Content-Disposition") == "" {
		t.Fatalf("key export headers = %v", exportResponse.Header())
	}

	importRequest := httptest.NewRequest(http.MethodPost, "/media/ipc/room-keys/import", strings.NewReader("encrypted import bytes"))
	importRequest.Header.Set("X-Matrix-Backup-Passphrase", "import secret")
	importResponse := httptest.NewRecorder()
	handler.ServeHTTP(importResponse, importRequest)
	if importResponse.Code != http.StatusOK || importedPassphrase != "import secret" || importedData != "encrypted import bytes" {
		t.Fatalf("key import = %d, passphrase %q, data %q", importResponse.Code, importedPassphrase, importedData)
	}
	if importResponse.Body.String() != "{\"imported\":2,\"total\":3}\n" {
		t.Fatalf("key import result = %q", importResponse.Body.String())
	}

	attachmentRequest := httptest.NewRequest(http.MethodPost, "/media/ipc/attachment/%21room%3Aexample.org?filename=voice.ogg&voiceNote=true&videoMessage=false&durationMs=1250", strings.NewReader("voice bytes"))
	attachmentResponse := httptest.NewRecorder()
	handler.ServeHTTP(attachmentResponse, attachmentRequest)
	if attachmentResponse.Code != http.StatusNoContent || uploadedRoomID != "!room:example.org" || uploadedFilename != "voice.ogg" || uploadedData != "voice bytes" || !uploadedVoiceNote || uploadedVideoMessage || uploadedDuration != 1250 {
		t.Fatalf("voice upload = %d, room=%q filename=%q data=%q voice=%t video=%t duration=%d", attachmentResponse.Code, uploadedRoomID, uploadedFilename, uploadedData, uploadedVoiceNote, uploadedVideoMessage, uploadedDuration)
	}

	videoRequest := httptest.NewRequest(http.MethodPost, "/media/ipc/attachment/%21room%3Aexample.org?filename=clip.webm&voiceNote=false&videoMessage=true&durationMs=2500", strings.NewReader("video bytes"))
	videoResponse := httptest.NewRecorder()
	handler.ServeHTTP(videoResponse, videoRequest)
	if videoResponse.Code != http.StatusNoContent || uploadedRoomID != "!room:example.org" || uploadedFilename != "clip.webm" || uploadedData != "video bytes" || uploadedVoiceNote || !uploadedVideoMessage || uploadedDuration != 2500 {
		t.Fatalf("video upload = %d, room=%q filename=%q data=%q voice=%t video=%t duration=%d", videoResponse.Code, uploadedRoomID, uploadedFilename, uploadedData, uploadedVoiceNote, uploadedVideoMessage, uploadedDuration)
	}
}
