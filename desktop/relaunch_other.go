//go:build !windows

package desktop

import (
	"errors"
	"os"
	"syscall"
)

// processAlive reports whether the process with the given ID is still running.
func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	defer process.Release()
	err = process.Signal(syscall.Signal(0))
	if err == nil {
		return true
	}
	// A process owned by another user cannot be signalled, but it is still running.
	return errors.Is(err, syscall.EPERM)
}
