package desktop

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mychat/matrix"
	"mychat/notifications"
)

type recordedNotification struct {
	title    string
	subtitle string
	body     string
	roomID   string
	avatar   string
	sound    bool
}

type recordingNotifier struct {
	sent         []recordedNotification
	permission   string
	denyRequests bool
	requests     int
}

func (n *recordingNotifier) Supported() bool { return true }

func (n *recordingNotifier) Permission() string {
	if n.permission == "" {
		return "default"
	}
	return n.permission
}

func (n *recordingNotifier) RequestPermission() (string, error) {
	n.requests++
	if n.denyRequests {
		n.permission = "denied"
		return "denied", nil
	}
	n.permission = "granted"
	return "granted", nil
}

func (n *recordingNotifier) Send(message notifications.Message) error {
	n.sent = append(n.sent, recordedNotification{
		title:    message.Title,
		subtitle: message.Subtitle,
		body:     message.Body,
		roomID:   message.RoomID,
		avatar:   message.AvatarPath,
		sound:    message.Sound,
	})
	return nil
}

var _ notifications.Notifier = (*recordingNotifier)(nil)

func TestMapRoomsWithPreferences(t *testing.T) {
	rooms := []matrix.Room{{ID: "!room:example.org", Name: "General"}}
	preferences := map[string]any{
		"room.favorite.!room:example.org": true,
		"room.muted.!room:example.org":    true,
	}

	mapped := mapRoomsWithPreferences(rooms, preferences)
	if len(mapped) != 1 {
		t.Fatalf("mapped room count = %d, want 1", len(mapped))
	}
	if !mapped[0].Favorite || !mapped[0].Muted {
		t.Fatalf("room preferences were not mapped: %+v", mapped[0])
	}
	if rooms[0].Favorite || rooms[0].Muted {
		t.Fatal("mapping preferences mutated the Matrix client room snapshot")
	}
}

func TestMapUpdateFiltersNotificationsByPreferences(t *testing.T) {
	update := matrix.Update{Notifications: []matrix.Notification{
		{RoomID: "!group:example.org", Category: matrix.NotificationCategoryGroup},
		{RoomID: "!mention:example.org", Category: matrix.NotificationCategoryMention},
		{RoomID: "!muted:example.org", Category: matrix.NotificationCategoryDirect},
	}}
	preferences := map[string]any{
		"notifications.group":           true,
		"notifications.mentions":        false,
		"room.muted.!muted:example.org": true,
	}

	mapped := mapUpdate(update, preferences)
	if len(mapped.Notifications) != 1 || mapped.Notifications[0].RoomID != "!group:example.org" {
		t.Fatalf("mapped notifications = %+v, want only enabled group notification", mapped.Notifications)
	}
}

func TestReadDroppedAttachment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared image.png")
	want := []byte("image data")
	if err := os.WriteFile(path, want, 0o600); err != nil {
		t.Fatal(err)
	}

	filename, data, err := readDroppedAttachment(path)
	if err != nil {
		t.Fatal(err)
	}
	if filename != "shared image.png" {
		t.Fatalf("filename = %q, want %q", filename, "shared image.png")
	}
	if string(data) != string(want) {
		t.Fatalf("data = %q, want %q", data, want)
	}
}

func TestReadDroppedAttachmentRejectsOversizedFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.bin")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = file.Truncate(maxAttachmentSize + 1); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}

	_, _, err = readDroppedAttachment(path)
	if err == nil || !strings.Contains(err.Error(), "50 MiB") {
		t.Fatalf("error = %v, want 50 MiB limit error", err)
	}
}

func TestReadDroppedAttachmentRejectsDirectories(t *testing.T) {
	_, _, err := readDroppedAttachment(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("error = %v, want regular file error", err)
	}
}

func TestSendAttachmentRejectsOversizedData(t *testing.T) {
	service := &AppService{}
	err := service.sendAttachment(context.Background(), "!room:example.org", "large.bin", make([]byte, maxAttachmentSize+1), false, false, 0)
	if err == nil || !strings.Contains(err.Error(), "50 MiB") {
		t.Fatalf("error = %v, want 50 MiB limit error", err)
	}
}

func TestSendAttachmentRejectsMissingActiveClient(t *testing.T) {
	service := &AppService{}
	err := service.sendAttachment(context.Background(), "!room:example.org", "photo.png", []byte("pixels"), false, false, 0)
	if err == nil || !strings.Contains(err.Error(), "account unavailable") {
		t.Fatalf("error = %v, want unavailable-account error", err)
	}
}

func TestOpenExternalURLUsesValidatedOpener(t *testing.T) {
	wantURL := "https://open.spotify.com/track/example?si=abc123"
	var openedURL string
	service := &AppService{openURL: func(url string) error {
		openedURL = url
		return nil
	}}

	if err := service.OpenExternalURL(wantURL); err != nil {
		t.Fatal(err)
	}
	if openedURL != wantURL {
		t.Fatalf("opened URL = %q, want %q", openedURL, wantURL)
	}
}

func TestOpenExternalURLRejectsUnsafeScheme(t *testing.T) {
	called := false
	service := &AppService{openURL: func(string) error {
		called = true
		return nil
	}}

	if err := service.OpenExternalURL("javascript:alert(1)"); err == nil {
		t.Fatal("unsafe URL was accepted")
	}
	if called {
		t.Fatal("opener was called for an unsafe URL")
	}
}

func TestAppServiceNotificationMethodsUseInjectedNotifier(t *testing.T) {
	notifier := &recordingNotifier{}
	service := &AppService{notifier: notifier}

	if !service.NativeNotificationsSupported() {
		t.Fatal("native notifications should be supported")
	}
	if got := service.NotificationPermission(); got != "default" {
		t.Fatalf("permission = %q, want default", got)
	}
	delivered, err := service.SendNotification(NotificationAlert{Title: "Pinger", Body: "New message", RoomID: "!room:example.org"})
	if err != nil {
		t.Fatal(err)
	}
	if !delivered {
		t.Fatal("first notification was not delivered after prompting for permission")
	}
	if notifier.requests != 1 {
		t.Fatalf("permission requests = %d, want 1", notifier.requests)
	}
	if got, err := service.RequestNotificationPermission(); err != nil || got != "granted" {
		t.Fatalf("requested permission = %q, %v; want granted", got, err)
	}
	delivered, err = service.SendNotification(NotificationAlert{Title: "Pinger", Body: "New message", RoomID: "!room:example.org"})
	if err != nil {
		t.Fatal(err)
	}
	if !delivered {
		t.Fatal("notification was not reported delivered after permission was granted")
	}
	if notifier.requests != 2 {
		t.Fatalf("permission requests = %d, want 2 (no extra prompt after grant)", notifier.requests)
	}
	if len(notifier.sent) != 2 || notifier.sent[0] != (recordedNotification{title: "Pinger", body: "New message", roomID: "!room:example.org"}) {
		t.Fatalf("sent notifications = %+v", notifier.sent)
	}
}

func TestAppServiceSendNotificationSkipsDeniedPermission(t *testing.T) {
	notifier := &recordingNotifier{denyRequests: true}
	service := &AppService{notifier: notifier}

	delivered, err := service.SendNotification(NotificationAlert{Title: "Pinger", Body: "New message", RoomID: "!room:example.org"})
	if err != nil {
		t.Fatal(err)
	}
	if delivered || len(notifier.sent) != 0 {
		t.Fatalf("delivered = %v, sent = %+v; want nothing sent when denied", delivered, notifier.sent)
	}
}

func TestAppServiceSendNotificationWithoutOpenAccountSendsWithoutAvatar(t *testing.T) {
	notifier := &recordingNotifier{permission: "granted"}
	service := &AppService{notifier: notifier}

	delivered, err := service.SendNotification(NotificationAlert{
		Title:        "Alice",
		Subtitle:     "General",
		Body:         "hello",
		RoomID:       "!room:example.org",
		AccountID:    "missing",
		SenderAvatar: "mxc://example.org/avatar",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !delivered || len(notifier.sent) != 1 {
		t.Fatalf("delivered = %v, sent = %+v; want one alert", delivered, notifier.sent)
	}
	want := recordedNotification{title: "Alice", subtitle: "General", body: "hello", roomID: "!room:example.org"}
	if notifier.sent[0] != want {
		t.Fatalf("sent = %+v, want %+v", notifier.sent[0], want)
	}
}

func TestNotificationAvatarExtension(t *testing.T) {
	tests := map[string][]byte{
		".png": []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
		".jpg": []byte("\xff\xd8\xff\xe0\x00\x10JFIF"),
		".gif": []byte("GIF89a\x01\x00\x01\x00"),
		"":     []byte("<html><body>not an image</body></html>"),
	}
	for want, data := range tests {
		if got := notificationAvatarExtension(data); got != want {
			t.Fatalf("extension for %q = %q, want %q", data[:4], got, want)
		}
	}
}
