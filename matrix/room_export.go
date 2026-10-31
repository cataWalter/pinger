package matrix

import (
	"context"
	"errors"
	"fmt"

	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// MediaAttachment describes one downloadable file attached to a message.
type MediaAttachment struct {
	URI       string
	MIME      string
	Name      string
	Encrypted *event.EncryptedFileInfo
}

// MediaAttachments returns every downloadable file in a message: the inline
// media first, then the remaining items of a Beeper album.
func (m Message) MediaAttachments() []MediaAttachment {
	attachments := make([]MediaAttachment, 0, 1+len(m.GalleryMedia))
	if m.MediaURI != "" {
		attachments = append(attachments, MediaAttachment{
			URI:       m.MediaURI,
			MIME:      m.MediaMIME,
			Name:      m.MediaName,
			Encrypted: m.MediaEncrypted,
		})
	}
	return append(attachments, m.GalleryMedia...)
}

// DownloadAttachment returns the decrypted bytes of one attachment.
func (c *Client) DownloadAttachment(ctx context.Context, attachment MediaAttachment) ([]byte, error) {
	return c.DownloadMedia(ctx, attachment.URI, attachment.Encrypted)
}

// RoomHistory returns every message in a room, oldest first. It pages back
// through the local timeline and then the server history until the start of
// the room is reached.
func (c *Client) RoomHistory(ctx context.Context, roomID string) ([]Message, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	return collectRoomHistory(
		func(before int64) (HistoryPage, error) {
			return c.HistoryPage(ctx, roomID, before)
		},
		func() error {
			_, paginateErr := c.engine.Paginate(ctx, id.RoomID(roomID), 0, timelinePageSize, false)
			return paginateErr
		},
	)
}

// collectRoomHistory walks pages from the newest message back to the start of
// the room and returns the messages oldest first without duplicates. backfill
// runs once when the local timeline is empty, because HistoryPage cannot reach
// the server in that state.
func collectRoomHistory(fetch func(before int64) (HistoryPage, error), backfill func() error) ([]Message, error) {
	var pages [][]Message
	seen := make(map[string]struct{})
	var before int64
	backfilled := false
	for {
		page, err := fetch(before)
		if err != nil {
			return nil, err
		}
		if before == 0 && page.Before == 0 && page.HasMore && !backfilled {
			backfilled = true
			if err := backfill(); err != nil {
				return nil, fmt.Errorf("fetch room history from server: %w", err)
			}
			continue
		}
		pages = append(pages, page.Messages)
		if !page.HasMore {
			break
		}
		if page.Before == 0 || (before != 0 && page.Before >= before) {
			return nil, errors.New("room history pagination did not advance")
		}
		before = page.Before
	}

	var messages []Message
	for i := len(pages) - 1; i >= 0; i-- {
		for _, message := range pages[i] {
			key := message.ID
			if key == "" {
				key = message.TransactionID
			}
			if key != "" {
				if _, duplicate := seen[key]; duplicate {
					continue
				}
				seen[key] = struct{}{}
			}
			messages = append(messages, message)
		}
	}
	return messages, nil
}
