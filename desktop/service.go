package desktop

import (
	"context"
	"errors"
	"github.com/wailsapp/wails/v3/pkg/application"
	"mychat/matrix"
	"mychat/notifications"
	sharedpreferences "mychat/preferences"
	"sync"
	"sync/atomic"
)

type AppService struct {
	// Lock order: accountOpenMu, then accountMu, then activeRoomMu. localAIChatMu and chatExportMu are leaves; never nest them.
	client                 *matrix.Client
	accountMu              sync.RWMutex
	accountOpenMu          sync.Mutex
	accountRegistry        *accountRegistry
	accountClients         map[string]*matrix.Client
	accountEventPumps      map[string]bool
	accountSyncStarted     map[string]bool
	dataDir                string
	defaultDataDir         string
	accountMediaCacheDir   string
	activeAccountID        string
	preferences            *PreferenceStore
	sharedPreferences      *sharedpreferences.Store
	preferencesUnsubscribe func()
	notifier               notifications.Notifier
	permissionMu           sync.Mutex
	ctx                    context.Context
	cancel                 context.CancelFunc
	quit                   func()
	openURL                func(string) error
	chooseDataFolder       func() (string, error)
	restartRequested       atomic.Bool
	setAutostart           func(bool) error
	setMenuBarIcon         func(bool)
	menuStateChanged       func(MenuState)
	menuAccountsChanged    func()
	chooseSavePath         func(directory, filename string) (string, error)
	chooseDownloadFolder   func() (string, error)
	revealFile             func(string) error
	activeRoomMu           sync.RWMutex
	activeRoomID           string
	activeRoomClient       *matrix.Client
	localAIChatMu          sync.Mutex
	localAIChats           *localAIChatStore
	aiRuns                 aiRunRegistry
	imageEngine            imageEngine
	workers                sync.WaitGroup
	scheduled              *scheduledJobStore
	chatExportMu           sync.Mutex
	chatExportCancel       context.CancelFunc

	emitUpdate                 func(Update)
	emitReminder               func(ScheduledJob)
	emitLocalAIChatStream      func(LocalAIChatStreamEvent)
	emitLocalAIImageProgress   func(LocalAIImageProgressEvent)
	emitChatExportProgress     func(ChatExportProgress)
	emitBulkChatExportProgress func(BulkChatExportProgress)
	emitAIStream               func(AIStreamEvent)
}

func (s *AppService) OpenExternalURL(rawURL string) error {
	url, err := application.ValidateAndSanitizeURL(rawURL)
	if err != nil {
		return err
	}
	if s.openURL == nil {
		return errors.New("external URL opener unavailable")
	}
	return s.openURL(url)
}

type Snapshot struct {
	LoggedIn              bool             `json:"loggedIn"`
	NeedsVerification     bool             `json:"needsVerification"`
	Verification          *Verification    `json:"verification"`
	SyncReady             bool             `json:"syncReady"`
	ConnectionState       string           `json:"connectionState"`
	SlidingSyncListCounts map[string]int   `json:"slidingSyncListCounts"`
	Profile               AccountProfile   `json:"profile"`
	Accounts              []AccountSummary `json:"accounts"`
	ActiveAccountID       string           `json:"activeAccountId"`
	Rooms                 []Room           `json:"rooms"`
	Invites               []Invite         `json:"invites"`
	Preferences           map[string]any   `json:"preferences"`
}

type Room struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Topic           string `json:"topic"`
	Avatar          string `json:"avatar"`
	Preview         string `json:"preview"`
	LastSeen        int64  `json:"lastSeen"`
	Direct          bool   `json:"direct"`
	Favorite        bool   `json:"favorite"`
	Muted           bool   `json:"muted"`
	Unread          int    `json:"unread"`
	MarkedUnread    bool   `json:"markedUnread"`
	Mentions        int    `json:"mentions"`
	Unanswered      bool   `json:"unanswered"`
	NeedsReply      bool   `json:"needsReply"`
	LastEventID     string `json:"lastEventId"`
	LastEventSender string `json:"lastEventSender"`
	LastEventAt     int64  `json:"lastEventAt"`
	Bridge          string `json:"bridge"`
	AccountID       string `json:"accountId"`
}

type Invite struct {
	RoomID      string `json:"roomId"`
	Name        string `json:"name"`
	Topic       string `json:"topic"`
	Avatar      string `json:"avatar"`
	Inviter     string `json:"inviter"`
	InviterName string `json:"inviterName"`
	Direct      bool   `json:"direct"`
	InvitedAt   int64  `json:"invitedAt"`
}

type GroupRoomRequest struct {
	Name      string   `json:"name"`
	Topic     string   `json:"topic"`
	Invitees  []string `json:"invitees"`
	Encrypted bool     `json:"encrypted"`
}

type LinkPreview struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SiteName    string `json:"siteName"`
	Image       string `json:"image"`
	ImageWidth  int    `json:"imageWidth"`
	ImageHeight int    `json:"imageHeight"`
}

type AccountProfile struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Homeserver  string `json:"homeserver"`
	DeviceID    string `json:"deviceId"`
	AvatarURI   string `json:"avatarUri"`
	Verified    bool   `json:"verified"`
}

type Message struct {
	ID              string          `json:"id"`
	TransactionID   string          `json:"transactionId"`
	Sender          string          `json:"sender"`
	SenderName      string          `json:"senderName"`
	Avatar          string          `json:"avatar"`
	Body            string          `json:"body"`
	FormattedBody   string          `json:"formattedBody"`
	ReplyToEventID  string          `json:"replyToEventId"`
	ReplyToSender   string          `json:"replyToSender"`
	ReplyToPreview  string          `json:"replyToPreview"`
	ThreadRootID    string          `json:"threadRootId"`
	Timestamp       int64           `json:"timestamp"`
	SeenAt          int64           `json:"seenAt"`
	TimelineCursor  int64           `json:"timelineCursor"`
	Sending         bool            `json:"sending"`
	SendError       string          `json:"sendError"`
	Own             bool            `json:"own"`
	Reactions       map[string]int  `json:"reactions"`
	Reacted         map[string]bool `json:"reacted"`
	MediaURI        string          `json:"mediaUri"`
	MediaType       string          `json:"mediaType"`
	MediaMIME       string          `json:"mediaMime"`
	MediaSize       int             `json:"mediaSize"`
	MediaWidth      int             `json:"mediaWidth"`
	MediaHeight     int             `json:"mediaHeight"`
	MediaDurationMs int             `json:"mediaDurationMs"`
	Encrypted       bool            `json:"encrypted"`
	DecryptionError string          `json:"decryptionError"`
	Edited          bool            `json:"edited"`
	EditHistory     []string        `json:"editHistory"`
	Redacted        bool            `json:"redacted"`
}

type HistoryPage struct {
	Messages []Message `json:"messages"`
	Before   int64     `json:"before"`
	HasMore  bool      `json:"hasMore"`
}

type Member struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

type Device struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	LastSeenIP  string `json:"lastSeenIp"`
	LastSeenAt  int64  `json:"lastSeenAt"`
	Current     bool   `json:"current"`
}

type RoomKeyImportResult struct {
	Imported int `json:"imported"`
	Total    int `json:"total"`
}

type Notification struct {
	RoomID       string `json:"roomId"`
	AccountID    string `json:"accountId"`
	Room         string `json:"room"`
	Sender       string `json:"sender"`
	SenderAvatar string `json:"senderAvatar"`
	Body         string `json:"body"`
	Mention      bool   `json:"mention"`
	Category     string `json:"category"`
}

type Update struct {
	AccountID               string              `json:"accountId"`
	NotificationPreferences map[string]any      `json:"notificationPreferences"`
	Rooms                   []Room              `json:"rooms"`
	Invites                 []Invite            `json:"invites"`
	SlidingSyncListCounts   map[string]int      `json:"slidingSyncListCounts"`
	ChangedRoomID           []string            `json:"changedRoomId"`
	TimelineChangedRoomID   []string            `json:"timelineChangedRoomId"`
	TypingUsers             map[string][]string `json:"typingUsers"`
	Notifications           []Notification      `json:"notifications"`
	NewIncomingMessage      bool                `json:"newIncomingMessage,omitempty"`
	Error                   string              `json:"error"`
	InitialSyncComplete     bool                `json:"initialSyncComplete"`
	NeedsVerification       bool                `json:"needsVerification"`
	Verification            *Verification       `json:"verification"`
	ConnectionState         string              `json:"connectionState"`
}

type SASEmoji struct {
	Emoji       string `json:"emoji"`
	Description string `json:"description"`
}

// Verification is an interactive emoji comparison with another Matrix session.
type Verification struct {
	TransactionID string     `json:"transactionId"`
	UserID        string     `json:"userId"`
	DeviceID      string     `json:"deviceId"`
	Incoming      bool       `json:"incoming"`
	Phase         string     `json:"phase"`
	Emojis        []SASEmoji `json:"emojis"`
	Decimals      []int      `json:"decimals"`
	Reason        string     `json:"reason"`
}

func mapVerification(verification *matrix.Verification) *Verification {
	if verification == nil {
		return nil
	}
	emojis := make([]SASEmoji, 0, len(verification.Emojis))
	for _, emoji := range verification.Emojis {
		emojis = append(emojis, SASEmoji{Emoji: emoji.Emoji, Description: emoji.Description})
	}
	return &Verification{
		TransactionID: verification.TransactionID,
		UserID:        verification.UserID,
		DeviceID:      verification.DeviceID,
		Incoming:      verification.Incoming,
		Phase:         string(verification.Phase),
		Emojis:        emojis,
		Decimals:      append([]int{}, verification.Decimals...),
		Reason:        verification.Reason,
	}
}
