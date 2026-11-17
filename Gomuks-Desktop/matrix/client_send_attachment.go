package matrix

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/attachment"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

func (c *Client) SendAttachment(ctx context.Context, roomID, filename string, data []byte) error {
	return c.sendAttachment(ctx, roomID, filename, data, 0, 0)
}

func (c *Client) SendVoiceNote(ctx context.Context, roomID, filename string, data []byte, durationMilliseconds int64) error {
	if durationMilliseconds <= 0 || durationMilliseconds > int64((4*time.Minute)/time.Millisecond) {
		return errors.New("voice note duration must be between 1 ms and 4 minutes")
	}
	return c.sendAttachment(ctx, roomID, filename, data, durationMilliseconds, 0)
}

func (c *Client) sendAttachment(ctx context.Context, roomID, filename string, data []byte, voiceDurationMilliseconds, videoDurationMilliseconds int64) error {
	if len(data) == 0 {
		return errors.New("attachment is empty")
	}
	const maxAttachmentBytes = 50 << 20
	if len(data) > maxAttachmentBytes {
		return fmt.Errorf("attachment exceeds %d MiB", maxAttachmentBytes>>20)
	}
	filename = filepath.Base(strings.TrimSpace(filename))
	if filename == "." || filename == "" {
		return errors.New("attachment filename is empty")
	}
	mimeType := http.DetectContentType(data)
	if detected, _, err := mime.ParseMediaType(mimeType); err == nil {
		mimeType = detected
	}
	if voiceDurationMilliseconds > 0 {
		voiceMIME, err := voiceNoteMIMEType(mimeType, filename)
		if err != nil {
			return err
		}
		mimeType = voiceMIME
	}
	if videoDurationMilliseconds > 0 {
		videoMIME, err := videoMessageMIMEType(mimeType, filename)
		if err != nil {
			return err
		}
		mimeType = videoMIME
	}
	msgType := event.MsgFile
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		msgType = event.MsgImage
	case strings.HasPrefix(mimeType, "video/"):
		msgType = event.MsgVideo
	case strings.HasPrefix(mimeType, "audio/"):
		msgType = event.MsgAudio
	}
	info := &event.FileInfo{MimeType: mimeType, Size: len(data)}
	if msgType == event.MsgImage {
		if config, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
			info.Width, info.Height = config.Width, config.Height
		}
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	encrypted, err := c.engine.ClientStore.IsEncrypted(ctx, id.RoomID(roomID))
	if err != nil {
		return fmt.Errorf("check room encryption before uploading attachment: %w", err)
	}
	content := &event.MessageEventContent{
		MsgType:  msgType,
		Body:     filename,
		FileName: filename,
		Info:     info,
	}
	if voiceDurationMilliseconds > 0 {
		if msgType != event.MsgAudio {
			return errors.New("voice note data must have an audio MIME type")
		}
		content.Body = "Voice message"
		content.Info.Duration = int(voiceDurationMilliseconds)
		content.MSC1767Audio = &event.MSC1767Audio{Duration: int(voiceDurationMilliseconds), Waveform: []int{}}
		content.MSC3245Voice = &event.MSC3245Voice{}
	}
	if videoDurationMilliseconds > 0 {
		if msgType != event.MsgVideo {
			return errors.New("video message data must have an MP4 or WebM MIME type")
		}
		content.Info.Duration = int(videoDurationMilliseconds)
	}
	uploadData := data
	var encryptedFile *attachment.EncryptedFile
	if encrypted {
		encryptedFile = attachment.NewEncryptedFile()
		uploadData = bytes.Clone(data)
		encryptedFile.EncryptInPlace(uploadData)
	}
	uploadType := mimeType
	if encrypted {
		uploadType = "application/octet-stream"
	}
	upload, err := c.engine.Client.UploadMedia(ctx, mautrix.ReqUploadMedia{
		ContentBytes: uploadData,
		ContentType:  uploadType,
		FileName:     filename,
	})
	if err != nil {
		return fmt.Errorf("upload Matrix attachment: %w", err)
	}
	if encrypted {
		content.File = &event.EncryptedFileInfo{
			EncryptedFile: *encryptedFile,
			URL:           upload.ContentURI.CUString(),
		}
	} else {
		content.URL = upload.ContentURI.CUString()
	}
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	evt, err := c.engine.Send(ctx, id.RoomID(roomID), event.EventMessage, content, false, false)
	if err != nil {
		return fmt.Errorf("send Matrix attachment event: %w", err)
	}
	if message, ok := messageFromEvent(evt); ok {
		message.Sending = true
		message.Own = c.isOwnMessage(message)
		message = c.enrichOwnMessage(ctx, roomID, message)
		c.storeLocalMessage(roomID, message)
	}
	c.publishTimeline([]string{roomID}, "")
	return nil
}
