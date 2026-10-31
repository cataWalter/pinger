//go:build (darwin && cgo) || linux || windows

package notifications

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	wailsnotifications "github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type nativeNotifier struct {
	service  *wailsnotifications.NotificationService
	started  atomic.Bool
	nextID   atomic.Uint64
	iconPath string
}

func New() Notifier {
	return &nativeNotifier{service: wailsnotifications.New()}
}

func (n *nativeNotifier) Start(ctx context.Context) error {
	if runtime.GOOS == "linux" {
		directory, err := os.UserCacheDir()
		if err == nil {
			n.iconPath, err = cacheNotificationIcon(filepath.Join(directory, "pinger", "notification-icons"), application.Get().Config().Icon)
		}
		if err != nil {
			log.Printf("cache notification icon: %v", err)
		}
	}
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

func (n *nativeNotifier) SetClickHandler(handler func(accountID, roomID string)) {
	n.service.OnNotificationResponse(func(result wailsnotifications.NotificationResult) {
		roomID, _ := result.Response.UserInfo["roomId"].(string)
		accountID, _ := result.Response.UserInfo["accountId"].(string)
		if roomID != "" && handler != nil {
			handler(accountID, roomID)
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
		Data:     map[string]interface{}{"roomId": message.RoomID, "accountId": message.AccountID},
	}
	options.Attachments = notificationAttachments(message.AvatarPath, n.iconPath)
	return n.service.SendNotification(options)
}

func notificationAttachments(avatarPath, iconPath string) []wailsnotifications.NotificationAttachment {
	if avatarPath != "" {
		return []wailsnotifications.NotificationAttachment{{ID: "avatar", Path: avatarPath}}
	}
	if iconPath != "" {
		return []wailsnotifications.NotificationAttachment{{ID: "application", Path: iconPath}}
	}
	return nil
}

func cacheNotificationIcon(directory string, icon []byte) (string, error) {
	if len(icon) == 0 {
		return "", nil
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, fmt.Sprintf("%x.png", sha256.Sum256(icon)))
	if existing, err := os.ReadFile(path); err == nil && sha256.Sum256(existing) == sha256.Sum256(icon) {
		return path, nil
	}
	if err := os.WriteFile(path, icon, 0o600); err != nil {
		return "", err
	}
	return path, nil
}
