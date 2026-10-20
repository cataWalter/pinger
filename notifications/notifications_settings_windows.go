//go:build windows

package notifications

import (
	"fmt"
	"os/exec"
)

func OpenSystemSettings() error {
	command := exec.Command("explorer.exe", "ms-settings:notifications")
	if err := command.Start(); err != nil {
		return fmt.Errorf("open Windows notification settings: %w", err)
	}
	go func() { _ = command.Wait() }()
	return nil
}