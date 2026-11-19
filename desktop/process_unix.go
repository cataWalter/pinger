//go:build !windows

package desktop

import (
	"os/exec"
	"strconv"
	"strings"
)

func hideChildConsole(_ *exec.Cmd) {}

// processCommand returns the command line of pid. It reports false when the process does not exist or ps is unavailable.
func processCommand(pid int) (string, bool) {
	if pid <= 0 {
		return "", false
	}
	output, err := exec.Command("ps", "-o", "command=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return "", false
	}
	command := strings.TrimSpace(string(output))
	return command, command != ""
}
