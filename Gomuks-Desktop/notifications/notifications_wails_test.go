//go:build (darwin && cgo) || linux || windows

package notifications

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestNotificationAttachmentsPreserveAvatars(t *testing.T) {
	for _, platform := range []string{"darwin", "windows", "linux"} {
		t.Run(platform, func(t *testing.T) {
			for _, test := range []struct {
				name, avatar, icon, wantID, wantPath string
			}{
				{name: "avatar", avatar: "/cache/avatar.png", icon: "/cache/pinger.png", wantID: "avatar", wantPath: "/cache/avatar.png"},
				{name: "application fallback", icon: "/cache/pinger.png", wantID: "application", wantPath: "/cache/pinger.png"},
				{name: "native identity without attachment"},
			} {
				t.Run(test.name, func(t *testing.T) {
					attachments := notificationAttachments(platform, test.avatar, test.icon)
					if test.wantPath == "" {
						if len(attachments) != 0 {
							t.Fatalf("unexpected attachment: %+v", attachments)
						}
						return
					}
					if len(attachments) != 1 || attachments[0].ID != test.wantID || attachments[0].Path != test.wantPath {
						t.Fatalf("attachments = %+v, want %s at %s", attachments, test.wantID, test.wantPath)
					}
					wantType := ""
					if platform == "windows" {
						wantType = "appLogoOverride"
					}
					if attachments[0].Type != wantType {
						t.Fatalf("attachment placement = %q, want %q", attachments[0].Type, wantType)
					}
				})
			}
		})
	}
}

func TestNotificationIconCachePreservesPreviouslyDeliveredArtwork(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "icons")
	first := []byte("first application artwork")
	second := []byte("updated application artwork")
	firstPath, err := cacheNotificationIcon(directory, first)
	if err != nil {
		t.Fatal(err)
	}
	reusedPath, err := cacheNotificationIcon(directory, first)
	if err != nil || reusedPath != firstPath {
		t.Fatalf("cache reuse: path=%s err=%v", reusedPath, err)
	}
	secondPath, err := cacheNotificationIcon(directory, second)
	if err != nil || secondPath == firstPath {
		t.Fatalf("updated artwork: path=%s err=%v", secondPath, err)
	}
	for path, want := range map[string][]byte{firstPath: first, secondPath: second} {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("cached artwork %s = %q, err=%v", path, got, err)
		}
	}
	if path, err := cacheNotificationIcon(directory, nil); err != nil || path != "" {
		t.Fatalf("empty artwork: path=%s err=%v", path, err)
	}
}
