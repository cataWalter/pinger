//go:build windows

package desktop

import "os"

// processAlive reports whether the process with the given ID is still running.
func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = process.Release()
	return true
}
