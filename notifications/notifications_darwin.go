//go:build darwin

package notifications

import (
	"fmt"
	"os/exec"
)

func OpenSystemSettings() error {
	settingsURLs := []string{
		"x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=fi.mau.pinger",
		"x-apple.systempreferences:com.apple.preference.notifications?id=fi.mau.pinger",
		"x-apple.systempreferences:com.apple.preference.notifications",
	}
	var lastErr error
	for _, settingsURL := range settingsURLs {
		if err := exec.Command("/usr/bin/open", settingsURL).Run(); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return fmt.Errorf("open macOS notification settings: %w", lastErr)
}
