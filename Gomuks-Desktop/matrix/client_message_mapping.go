package matrix

import (
	"encoding/json"
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"maunium.net/go/mautrix/event"
	"strings"
)

func messageFromEvent(evt *database.Event) (Message, bool) {
	if evt == nil {
		return Message{}, false
	}
	if evt.RelationType == event.RelReplace {
		return Message{}, false
	}
	evtType := evt.GetType().Type
	if evtType != event.EventMessage.Type && evtType != event.EventSticker.Type && evtType != event.EventEncrypted.Type {
		return Message{}, false
	}
	threadRoot := threadRootID(evt)
	if evt.RedactedBy != "" {
		return Message{
			ID:           evt.ID.String(),
			Sender:       evt.Sender.String(),
			ThreadRootID: threadRoot,
			Timestamp:    evt.Timestamp.Time,
			Edited:       evt.LastEditRowID != nil,
			Redacted:     true,
		}, true
	}
	if evt.DecryptionError != "" {
		return Message{
			ID:              evt.ID.String(),
			Sender:          evt.Sender.String(),
			ThreadRootID:    threadRoot,
			Timestamp:       evt.Timestamp.Time,
			Encrypted:       true,
			DecryptionError: evt.DecryptionError,
		}, true
	}
	if evtType == event.EventEncrypted.Type {
		return Message{}, false
	}
	var content struct {
		MsgType string `json:"msgtype"`
		Body    string `json:"body"`
		Text    []struct {
			Body     string `json:"body"`
			MIMEType string `json:"mimetype"`
		} `json:"m.text"`
		FormattedBody        string                       `json:"formatted_body"`
		URL                  string                       `json:"url"`
		File                 *event.EncryptedFileInfo     `json:"file"`
		Info                 *event.FileInfo              `json:"info"`
		FileName             string                       `json:"filename"`
		BeeperGalleryImages  []*event.MessageEventContent `json:"com.beeper.gallery.images"`
		BeeperGalleryCaption string                       `json:"com.beeper.gallery.caption"`
		RelatesTo            struct {
			EventID       string `json:"event_id"`
			IsFallingBack bool   `json:"is_falling_back"`
			InReplyTo     struct {
				EventID string `json:"event_id"`
			} `json:"m.in_reply_to"`
		} `json:"m.relates_to"`
	}
	if err := json.Unmarshal(evt.GetContent(), &content); err != nil {
		return Message{}, false
	}
	mediaURI := content.URL
	mediaEncrypted := content.File
	mediaInfo := content.Info
	mediaType := content.MsgType
	mediaName := content.FileName
	if mediaName == "" {
		mediaName = content.Body
	}
	if mediaURI == "" && content.File != nil {
		mediaURI = string(content.File.URL)
	}
	var galleryMedia []MediaAttachment
	if content.MsgType == string(event.MsgBeeperGallery) {
		// The timeline row has one inline media slot, so display the first image in an album.
		// Every other album item is kept in galleryMedia so exports include it.
		inlineSet := false
		for _, galleryImage := range content.BeeperGalleryImages {
			if galleryImage == nil {
				continue
			}
			galleryURI := string(galleryImage.URL)
			if galleryURI == "" && galleryImage.File != nil {
				galleryURI = string(galleryImage.File.URL)
			}
			if galleryURI == "" {
				continue
			}
			galleryMIME := mediaMIME(galleryImage.Info)
			galleryName := galleryImage.FileName
			if galleryName == "" {
				galleryName = galleryImage.Body
			}
			inlineCandidate := galleryImage.MsgType == event.MsgImage || strings.HasPrefix(galleryMIME, "image/")
			if inlineSet || !inlineCandidate {
				galleryMedia = append(galleryMedia, MediaAttachment{
					URI:       galleryURI,
					MIME:      galleryMIME,
					Name:      galleryName,
					Encrypted: galleryImage.File,
				})
				continue
			}
			mediaURI = galleryURI
			mediaEncrypted = galleryImage.File
			mediaInfo = galleryImage.Info
			mediaType = string(galleryImage.MsgType)
			mediaName = galleryName
			inlineSet = true
		}
	}
	mediaMIMEType := mediaMIME(mediaInfo)
	if !strings.HasPrefix(mediaMIMEType, "image/") &&
		(mediaType == string(event.MsgImage) || evtType == event.EventSticker.Type) {
		mediaMIMEType = "image/unknown"
	}
	body := content.Body
	if body == "" {
		body = content.BeeperGalleryCaption
	}
	if body == "" {
		var fallbackText string
		for _, representation := range content.Text {
			if representation.Body == "" {
				continue
			}
			if fallbackText == "" {
				fallbackText = representation.Body
			}
			if representation.MIMEType == "" || representation.MIMEType == "text/plain" {
				body = representation.Body
				break
			}
		}
		if body == "" {
			body = fallbackText
		}
	}
	if body == "" {
		body = content.FileName
	}
	if body == "" {
		switch mediaType {
		case string(event.MsgImage):
			body = "Image"
		case string(event.MsgVideo):
			body = "Video"
		case string(event.MsgAudio):
			body = "Audio"
		case string(event.MsgFile):
			body = "File"
		case string(event.MsgBeeperGallery):
			body = "Media album"
		}
	}
	if body == "" && mediaURI != "" {
		body = "Attachment"
	}
	if body == "" {
		return Message{}, false
	}
	mediaMessage := mediaURI != "" || mediaType == string(event.MsgImage) ||
		mediaType == string(event.MsgVideo) || mediaType == string(event.MsgAudio) ||
		mediaType == string(event.MsgFile) || mediaType == string(event.MsgBeeperGallery) ||
		evtType == event.EventSticker.Type
	if mediaMessage {
		log.Printf("Matrix media mapped: msgtype=%q uri_present=%t mime=%q encrypted=%t inline_candidate=%t dimensions=%dx%d",
			mediaType, mediaURI != "", mediaMIMEType, mediaEncrypted != nil,
			mediaURI != "" && strings.HasPrefix(mediaMIMEType, "image/"), mediaWidth(mediaInfo), mediaHeight(mediaInfo))
	}
	replyTo := content.RelatesTo.InReplyTo.EventID
	if threadRoot != "" {
		// Thread messages only quote when the reply is real, not the thread fallback.
		if content.RelatesTo.IsFallingBack {
			replyTo = ""
		}
	} else if replyTo == "" {
		replyTo = content.RelatesTo.EventID
	}
	if replyTo == "" && threadRoot == "" {
		replyTo = evt.RelatesTo.String()
		switch evt.RelationType {
		case "", event.RelThread, event.RelReference:
		default:
			// Edits (m.replace), reactions (m.annotation) etc. are not replies.
			if evt.RelationType != "m.in_reply_to" {
				replyTo = ""
			}
		}
		if replyTo != "" && strings.HasPrefix(replyTo, "$") == false && !strings.Contains(replyTo, ":") {
			replyTo = ""
		}
	}
	return Message{
		ID:              evt.ID.String(),
		TransactionID:   evt.TransactionID,
		Sender:          evt.Sender.String(),
		Body:            body,
		FormattedBody:   content.FormattedBody,
		ReplyToEventID:  replyTo,
		ThreadRootID:    threadRoot,
		Timestamp:       evt.Timestamp.Time,
		TimelineCursor:  int64(evt.TimelineRowID),
		Sending:         isPendingEvent(evt),
		SendError:       mapSendError(evt.SendError),
		Reactions:       evt.Reactions,
		Reacted:         map[string]bool{},
		MediaURI:        mediaURI,
		MediaEncrypted:  mediaEncrypted,
		MediaMIME:       mediaMIMEType,
		MediaSize:       mediaSize(mediaInfo),
		MediaWidth:      mediaWidth(mediaInfo),
		MediaHeight:     mediaHeight(mediaInfo),
		MediaDurationMs: mediaDuration(mediaInfo),
		Encrypted:       evt.MegolmSessionID != "",
		Edited:          isEditedEvent(evt),
		EditHistory:     editHistory(evt),

		MediaType:               mediaType,
		MediaThumbnailURI:       mediaThumbnailURI(mediaInfo),
		MediaThumbnailEncrypted: mediaThumbnailEncrypted(mediaInfo),
		MediaName:               mediaName,
		GalleryMedia:            galleryMedia,
	}, true
}

// editHistory is a fallback for callers that don't batch-load replacement events.
// mapSendError converts the database send marker into a user-facing error.
// gomuks stores the transient "not sent" marker on every fresh local event and
// (upstream) never clears it on success, so it must not surface as an error.
// Only genuine failures (encrypt/send errors) are reported; the pending state
// is conveyed through Message.Sending instead.
func mapSendError(sendError string) string {
	if sendError == "" || sendError == "not sent" {
		return ""
	}
	return sendError
}
