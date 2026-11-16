//go:build linux

package notifications

import (
	"errors"
	"fmt"
	"os/exec"
)

func OpenSystemSettings() error {
	commands := [][]string{
		{"gnome-control-center", "notifications"},
		{"systemsettings", "kcm_notifications"},
		{"systemsettings6", "kcm_notifications"},
	}
	var lastErr error
	for _, args := range commands {
		path, err := exec.LookPath(args[0])
		if err != nil {
			lastErr = err
			continue
		}
		command := exec.Command(path, args[1:]...)
		if err := command.Start(); err != nil {
			lastErr = err
			continue
		}
		go func() { _ = command.Wait() }()
		return nil
	}
	if lastErr != nil {
		return fmt.Errorf("open Linux notification settings: %w", lastErr)
	}
	return errors.New("notification settings are not available for this Linux desktop")
}