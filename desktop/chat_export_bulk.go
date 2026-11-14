package desktop

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"mychat/matrix"
)

const bulkChatExportProgressEventName = "bulk-chat-export:progress"

// bulkChatExportMaxLimit caps how many messages are saved per chat.
const bulkChatExportMaxLimit = 1000

// bulkChatRoomTimeout bounds how long one chat may take to load before it is counted as failed.
var bulkChatRoomTimeout = 5 * time.Second

// bulkChatExportPrefix starts the name of the file that holds every chat export.
const bulkChatExportPrefix = "All chats"

// BulkChatExportProgress reports how far an export of every chat has advanced.
type BulkChatExportProgress struct {
	Done   int    `json:"done"`
	Total  int    `json:"total"`
	Room   string `json:"room"`
	Failed int    `json:"failed"`
}

// BulkChatExportResult describes an export of every chat. Cancelled exports keep the chats already written.
type BulkChatExportResult struct {
	Path      string `json:"path"`
	Chats     int    `json:"chats"`
	Messages  int    `json:"messages"`
	Failed    int    `json:"failed"`
	Cancelled bool   `json:"cancelled"`
}

// BulkChatExportOptions selects the chats and messages an export of every chat includes.
type BulkChatExportOptions struct {
	PrivateChats    bool `json:"privateChats"`
	GroupChats      bool `json:"groupChats"`
	MyMessages      bool `json:"myMessages"`
	TheirMessages   bool `json:"theirMessages"`
	DeletedMessages bool `json:"deletedMessages"`
}

type bulkChatExportSource interface {
	Rooms() []matrix.Room
	RecentRoomMessages(ctx context.Context, roomID string, limit int) ([]matrix.Message, error)
}

// ExportRecentMessagesForAllChats saves the newest limit messages of the selected chats into one text file inside parentDirectory. Messages with media are skipped.
func (s *AppService) ExportRecentMessagesForAllChats(parentDirectory string, limit int, options BulkChatExportOptions) (BulkChatExportResult, error) {
	client := s.currentClient()
	if client == nil {
		return BulkChatExportResult{}, errors.New("no account is open")
	}
	if limit < 1 || limit > bulkChatExportMaxLimit {
		return BulkChatExportResult{}, fmt.Errorf("messages per chat must be between 1 and %d", bulkChatExportMaxLimit)
	}
	if !options.PrivateChats && !options.GroupChats {
		return BulkChatExportResult{}, errors.New("choose private chats, group chats, or both")
	}
	if !options.MyMessages && !options.TheirMessages {
		return BulkChatExportResult{}, errors.New("choose your messages, their messages, or both")
	}
	if !filepath.IsAbs(parentDirectory) {
		return BulkChatExportResult{}, errors.New("chat export needs an absolute folder path")
	}
	info, err := os.Stat(parentDirectory)
	if err != nil {
		return BulkChatExportResult{}, fmt.Errorf("chat export folder: %w", err)
	}
	if !info.IsDir() {
		return BulkChatExportResult{}, errors.New("chat export needs a folder")
	}
	ctx, err := s.beginChatExport()
	if err != nil {
		return BulkChatExportResult{}, err
	}
	defer s.endChatExport()
	return exportRecentMessagesForAllChats(ctx, client, parentDirectory, limit, options, time.Now(), s.reportBulkChatExportProgress)
}

func (s *AppService) reportBulkChatExportProgress(progress BulkChatExportProgress) {
	if s.emitBulkChatExportProgress != nil {
		s.emitBulkChatExportProgress(progress)
	}
}

// exportRecentMessagesForAllChats writes every chat into one text file under parentDirectory as each chat loads. A chat that fails or exceeds bulkChatRoomTimeout is counted and skipped. Cancelling stops between chats and keeps the chats already written.
func exportRecentMessagesForAllChats(ctx context.Context, source bulkChatExportSource, parentDirectory string, limit int, options BulkChatExportOptions, exportedAt time.Time, report func(BulkChatExportProgress)) (BulkChatExportResult, error) {
	var rooms []matrix.Room
	for _, room := range source.Rooms() {
		if options.includesRoom(room) {
			rooms = append(rooms, room)
		}
	}
	path, err := uniqueExportFilePath(parentDirectory, fmt.Sprintf("%s last %d messages %s", bulkChatExportPrefix, limit, exportedAt.Format("2006-01-02 1504")))
	if err != nil {
		return BulkChatExportResult{}, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return BulkChatExportResult{}, fmt.Errorf("create chat export: %w", err)
	}
	defer file.Close()
	result := BulkChatExportResult{Path: path}
	for index, room := range rooms {
		if ctx.Err() != nil {
			result.Cancelled = true
			break
		}
		roomCtx, stopRoom := context.WithTimeout(ctx, bulkChatRoomTimeout)
		messages, historyErr := source.RecentRoomMessages(roomCtx, room.ID, limit)
		stopRoom()
		if ctx.Err() != nil {
			result.Cancelled = true
			break
		}
		if historyErr != nil {
			result.Failed++
		} else {
			messages = selectExportMessages(messages, options)
			if len(messages) > 0 {
				if err := writeBulkChatTranscript(file, room, messages, result.Chats > 0); err != nil {
					return result, fmt.Errorf("write chat export: %w", err)
				}
				result.Chats++
				result.Messages += len(messages)
			}
		}
		report(BulkChatExportProgress{Done: index + 1, Total: len(rooms), Room: room.Name, Failed: result.Failed})
	}
	return result, nil
}

// includesRoom reports whether the chat's kind is selected.
func (o BulkChatExportOptions) includesRoom(room matrix.Room) bool {
	if room.Direct {
		return o.PrivateChats
	}
	return o.GroupChats
}

// includesMessage reports whether the message's sender and deleted state are selected.
func (o BulkChatExportOptions) includesMessage(message matrix.Message) bool {
	if message.Redacted && !o.DeletedMessages {
		return false
	}
	if message.Own {
		return o.MyMessages
	}
	return o.TheirMessages
}

// selectExportMessages keeps the selected messages and drops messages with media. It returns a new slice.
func selectExportMessages(messages []matrix.Message, options BulkChatExportOptions) []matrix.Message {
	kept := make([]matrix.Message, 0, len(messages))
	for _, message := range messages {
		if len(message.MediaAttachments()) == 0 && options.includesMessage(message) {
			kept = append(kept, message)
		}
	}
	return kept
}

// writeBulkChatTranscript appends one chat's name line and messages to w, preceded by a blank line when leadingBlank is set.
func writeBulkChatTranscript(w io.Writer, room matrix.Room, messages []matrix.Message, leadingBlank bool) error {
	header := exportNameLabel(room.Name) + "\n"
	if leadingBlank {
		header = "\n" + header
	}
	_, err := io.WriteString(w, header+renderChatExportText(messages, room.Direct))
	return err
}
