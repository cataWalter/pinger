package notifications

import "context"

// Message is one native alert. AvatarPath is an optional local image file.
type Message struct {
	Title      string
	Subtitle   string
	Body       string
	RoomID     string
	AccountID  string
	AvatarPath string
	Sound      bool
}

type Notifier interface {
	Supported() bool
	Permission() string
	RequestPermission() (string, error)
	Send(message Message) error
}

type Lifecycle interface {
	Start(context.Context) error
	Close() error
}

type ClickHandler interface {
	SetClickHandler(func(accountID, roomID string))
}
