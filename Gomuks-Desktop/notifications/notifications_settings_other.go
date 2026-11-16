//go:build !darwin && !linux && !windows

package notifications

import "errors"

func OpenSystemSettings() error {
	return errors.New("native notification settings are unavailable on this platform")
}