package desktop

import "testing"

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
