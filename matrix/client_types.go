package matrix

import (
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"time"
)

type SearchRequest struct {
	Query        string
	RoomID       string
	Sender       string
	MinTimestamp int64
	MaxTimestamp int64
	Limit        int
	NextBatch    string
}

type SearchResult struct {
	RoomID  string
	Message Message
}

type SearchPage struct {
	Results   []SearchResult
	NextBatch string
}

// Room and Message are UI-facing snapshots that do not expose gomuks internals.
type Room struct {
	ID              string
	Name            string
	Topic           string
	Avatar          string
	Preview         string
	LastSeen        time.Time
	Direct          bool
	Favorite        bool
	Muted           bool
	Archived        bool
	Unread          int
	MarkedUnread    bool
	Mentions        int
	Unanswered      bool
	NeedsReply      bool
	LastEventID     string
	LastEventSender string
	LastEventAt     time.Time
	// LastEventSeenAt is set when another user has read the room's latest message, which must be our own.
	LastEventSeenAt time.Time
	Bridge          string
}

type Message struct {
	ID              string
	TransactionID   string
	Sender          string
	SenderName      string
	Avatar          string
	Body            string
	FormattedBody   string
	ReplyToEventID  string
	ReplyToSender   string
	ReplyToPreview  string
	ThreadRootID    string
	Timestamp       time.Time
	SeenAt          time.Time
	TimelineCursor  int64
	Sending         bool
	SendError       string
	Own             bool
	Reactions       map[string]int
	Reacted         map[string]bool
	MediaURI        string
	MediaMIME       string
	MediaSize       int
	MediaWidth      int
	MediaHeight     int
	MediaEncrypted  *event.EncryptedFileInfo
	MediaDurationMs int
	Encrypted       bool
	DecryptionError string
	Edited          bool
	EditHistory     []string
	Redacted        bool

	MediaType               string
	MediaThumbnailURI       string
	MediaThumbnailEncrypted *event.EncryptedFileInfo

	// MediaName is the filename of the inline media when the event provides one.
	MediaName string
	// GalleryMedia holds the album items after the inline one, so exports keep every file.
	GalleryMedia []MediaAttachment
}

type Member struct {
	ID          string
	DisplayName string
}

type Device struct {
	ID          string
	DisplayName string
	LastSeenIP  string
	LastSeenAt  time.Time
	Current     bool
}

type AccountProfile struct {
	UserID      string
	DisplayName string
	Homeserver  string
	DeviceID    string
	AvatarURI   string
	Verified    bool
}

type HistoryPage struct {
	Messages []Message
	Before   int64
	HasMore  bool
}

type ConnectionState string

// Update is emitted when gomuks has persisted sync data to its local database.
type Update struct {
	Rooms                 []Room
	Invites               []Invite
	SlidingSyncListCounts map[string]int
	ChangedRoomID         []string
	TimelineChangedRoomID []string
	TypingUsers           map[string][]string
	Notifications         []Notification
	NewIncomingMessage    bool
	Error                 string
	InitialSyncComplete   bool
	NeedsVerification     bool
	Verification          *Verification
	ConnectionState       ConnectionState
}

type Notification struct {
	RoomID       string
	Room         string
	Sender       string
	SenderAvatar string
	Body         string
	Mention      bool
	Category     string
}

type passwordUIAAAuth struct {
	Type     mautrix.AuthType `json:"type"`
	User     string           `json:"user"`
	Password string           `json:"password"`
	Session  string           `json:"session"`
}
