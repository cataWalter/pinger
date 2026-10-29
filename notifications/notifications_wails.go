//go:build (darwin && cgo) || linux || windows

package notifications

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	wailsnotifications "github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type nativeNotifier struct {
	service *wailsnotifications.NotificationService
	started atomic.Bool
	nextID  atomic.Uint64
}

func New() Notifier {
	return &nativeNotifier{service: wailsnotifications.New()}
}

func (n *nativeNotifier) Start(ctx context.Context) error {
	if err := n.service.ServiceStartup(ctx, application.ServiceOptions{}); err != nil {
		return err
	}
	n.started.Store(true)
	return nil
}

func (n *nativeNotifier) Close() error {
	if !n.started.Swap(false) {
		return nil
	}
	return n.service.ServiceShutdown()
}

func (n *nativeNotifier) Supported() bool {
	return n.started.Load()
}

func (n *nativeNotifier) Permission() string {
	if !n.started.Load() {
		return "unsupported"
	}
	granted, err := n.service.CheckNotificationAuthorization()
	if err != nil {
		return "unsupported"
	}
	if granted {
		return "granted"
	}
	return "default"
}

func (n *nativeNotifier) RequestPermission() (string, error) {
	if !n.started.Load() {
		return "unsupported", nil
	}
	granted, err := n.service.RequestNotificationAuthorization()
	if err != nil {
		return "unsupported", err
	}
	if granted {
		return "granted", nil
	}
	return "denied", nil
}

func (n *nativeNotifier) SetClickHandler(handler func(roomID string)) {
	n.service.OnNotificationResponse(func(result wailsnotifications.NotificationResult) {
		roomID, _ := result.Response.UserInfo["roomId"].(string)
		if roomID != "" && handler != nil {
			handler(roomID)
		}
	})
}

func (n *nativeNotifier) Send(message Message) error {
	if !n.started.Load() {
		return nil
	}
	options := wailsnotifications.NotificationOptions{
		ID:       fmt.Sprintf("pinger-%d-%d", time.Now().UnixNano(), n.nextID.Add(1)),
		Title:    message.Title,
		Subtitle: message.Subtitle,
		Body:     message.Body,
		Sound:    &wailsnotifications.NotificationSound{Silent: !message.Sound},
		Data:     map[string]interface{}{"roomId": message.RoomID},
	}
	if message.AvatarPath != "" {
		options.Attachments = []wailsnotifications.NotificationAttachment{{ID: "avatar", Path: message.AvatarPath}}
	}
	return n.service.SendNotification(options)
}
