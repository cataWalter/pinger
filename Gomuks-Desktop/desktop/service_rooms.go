package desktop

import (
	"errors"
	"fmt"
	"log"
	"mychat/notifications"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SaveMedia writes a cached attachment to the download folder, or to a path chosen in a save dialog when ask-each-time is enabled. An empty path with no error means the user cancelled.
func (s *AppService) SaveMedia(mxc, filename string) (string, error) {
	data, err := s.currentClient().CachedMediaBytes(s.ctx, mxc)
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("no media data to save")
	}
	name := safeDownloadName(filename)
	preferences := s.preferenceValues()
	directory, _ := preferences["downloads.folder"].(string)
	if directory == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", homeErr
		}
		directory = filepath.Join(home, "Downloads")
	}
	askEach, _ := preferences["downloads.ask_each_time"].(bool)
	target := ""
	if askEach {
		if s.chooseSavePath == nil {
			return "", errors.New("save dialog is unavailable")
		}
		target, err = s.chooseSavePath(directory, name)
		if err != nil {
			return "", err
		}
		if target == "" {
			return "", nil
		}
	} else {
		return saveDownload(directory, name, data)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", fmt.Errorf("create download folder: %w", err)
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return "", fmt.Errorf("save attachment: %w", err)
	}
	return target, nil
}

// ChooseDownloadFolder opens a native folder picker and returns the selected directory, or an empty string when cancelled.
func (s *AppService) ChooseDownloadFolder() (string, error) {
	if s.chooseDownloadFolder == nil {
		return "", errors.New("folder picker is unavailable")
	}
	return s.chooseDownloadFolder()
}

func (s *AppService) RevealFile(path string) error {
	if s.revealFile == nil {
		return errors.New("file manager is unavailable")
	}
	if !filepath.IsAbs(path) {
		return errors.New("reveal needs an absolute file path")
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("reveal file: %w", err)
	}
	return s.revealFile(path)
}

func (s *AppService) OptimizeDatabase() error {
	return s.currentClient().OptimizeDatabase(s.ctx)
}

func (s *AppService) SetRoomUnanswered(roomID string, unanswered bool) error {
	return s.currentClient().SetRoomUnanswered(s.ctx, roomID, unanswered)
}

func (s *AppService) SetBooleanPreference(key string, value bool) error {
	if key == "system.launch_at_startup" && s.setAutostart != nil {
		previous, _ := s.preferenceValues()[key].(bool)
		if err := s.setAutostart(value); err != nil {
			return fmt.Errorf("update launch at startup: %w", err)
		}
		if err := s.setPreference(key, value); err != nil {
			if rollbackErr := s.setAutostart(previous); rollbackErr != nil {
				return errors.Join(err, fmt.Errorf("restore launch at startup: %w", rollbackErr))
			}
			return err
		}
		return nil
	}
	if err := s.setPreference(key, value); err != nil {
		return err
	}
	if key == "window.menu_bar_icon" && s.setMenuBarIcon != nil {
		s.setMenuBarIcon(value)
	}
	return nil
}

func (s *AppService) SetActiveRoom(roomID string) {
	client := s.currentClient()
	s.activeRoomMu.Lock()
	previousRoomID := s.activeRoomID
	previousClient := s.activeRoomClient
	if previousRoomID == roomID && previousClient == client {
		s.activeRoomMu.Unlock()
		return
	}
	s.activeRoomID = roomID
	s.activeRoomClient = client
	if previousClient != nil && previousRoomID != "" {
		if err := previousClient.UnsubscribeFromRoom(previousRoomID); err != nil {
			log.Printf("unsubscribe from active Matrix room %s: %v", previousRoomID, err)
		}
	}
	if client != nil && roomID != "" {
		if err := client.SubscribeToRoom(roomID); err != nil {
			log.Printf("subscribe to active Matrix room %s: %v", roomID, err)
		}
	}
	s.activeRoomMu.Unlock()
}

func (s *AppService) UpdateVisibleRange(listKey string, startIndex, endIndex int) error {
	client := s.currentClient()
	if client == nil {
		return nil
	}
	return client.UpdateVisibleRange(listKey, startIndex, endIndex)
}

func (s *AppService) SubscribeToRoom(roomID string) error {
	client := s.currentClient()
	if client == nil {
		return nil
	}
	return client.SubscribeToRoom(roomID)
}

func (s *AppService) UnsubscribeFromRoom(roomID string) error {
	client := s.currentClient()
	if client == nil {
		return nil
	}
	return client.UnsubscribeFromRoom(roomID)
}

func (s *AppService) MarkAllRead() error {
	var combinedErr error
	client := s.currentClient()
	if client == nil {
		return nil
	}
	for _, room := range client.Rooms() {
		page, err := client.HistoryPage(s.ctx, room.ID, 0)
		if err != nil {
			combinedErr = errors.Join(combinedErr, fmt.Errorf("load history for %s: %w", room.ID, err))
			continue
		}
		for i := len(page.Messages) - 1; i >= 0; i-- {
			message := page.Messages[i]
			if message.ID == "" || strings.HasPrefix(message.ID, "~") {
				continue
			}
			if err = client.MarkRead(s.ctx, room.ID, message.ID); err != nil {
				combinedErr = errors.Join(combinedErr, fmt.Errorf("mark room %s as read: %w", room.ID, err))
			}
			break
		}
	}
	return combinedErr
}

func (s *AppService) SetStringPreference(key, value string) error {
	return s.setPreference(key, value)
}

// SetStringPreferences saves several string preferences in one transaction. Either every value is saved or none is.
func (s *AppService) SetStringPreferences(values map[string]string) error {
	if s.sharedPreferences == nil {
		return errors.New("preference store is unavailable")
	}
	batch := make(map[string]any, len(values))
	for key, value := range values {
		batch[key] = value
	}
	return s.sharedPreferences.SetMany(s.currentAccountID(), batch)
}

func (s *AppService) NativeNotificationsSupported() bool {
	return s.notifier != nil && s.notifier.Supported()
}

func (s *AppService) NotificationPermission() string {
	if s.notifier == nil {
		return "unsupported"
	}
	return s.notifier.Permission()
}

func (s *AppService) RequestNotificationPermission() (string, error) {
	if s.notifier == nil {
		return "unsupported", nil
	}
	return s.notifier.RequestPermission()
}

func (s *AppService) OpenNotificationSettings() error {
	return notifications.OpenSystemSettings()
}

// NotificationAlert is one native alert requested by the frontend.
// AccountID and SenderAvatar are optional; the avatar is loaded from the account's media cache.
type NotificationAlert struct {
	Title        string `json:"title"`
	Subtitle     string `json:"subtitle"`
	Body         string `json:"body"`
	RoomID       string `json:"roomId"`
	AccountID    string `json:"accountId"`
	SenderAvatar string `json:"senderAvatar"`
}

func (s *AppService) SendNotification(alert NotificationAlert) (bool, error) {
	if s.notifier == nil || !s.notifier.Supported() {
		return false, nil
	}
	if s.notifier.Permission() != "granted" {
		granted, err := s.ensureNotificationPermission()
		if err != nil || !granted {
			return false, err
		}
	}
	language := stringPreference(s.preferenceValues(), "general.language", "system")
	title := alert.Title
	if title == "" {
		title = localizedUIString(language, "Pinger")
	}
	body := alert.Body
	if body == "" {
		body = localizedUIString(language, "New message")
	}
	message := notifications.Message{
		Title:     title,
		Subtitle:  alert.Subtitle,
		Body:      body,
		RoomID:    alert.RoomID,
		AccountID: alert.AccountID,
	}
	avatarPath, cleanup := s.notificationAvatarFile(alert.AccountID, alert.SenderAvatar)
	defer cleanup()
	message.AvatarPath = avatarPath
	if err := s.notifier.Send(message); err != nil {
		return false, err
	}
	return true, nil
}

const (
	notificationAvatarTimeout  = 3 * time.Second
	notificationAvatarMaxBytes = 5 << 20
)
