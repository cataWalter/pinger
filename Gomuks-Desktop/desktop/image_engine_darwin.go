//go:build darwin

package desktop

import (
	"errors"
	"os/exec"
	"syscall"
)

// configureImageEngineProcess starts sd-server in its own process group so the whole group can be stopped.
// macOS has no parent-death signal, so a crashed app still leaves the process for the startup reaper.
func configureImageEngineProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killImageEngineTree kills the process group led by pid, falling back to the single process when no group exists.
func killImageEngineTree(pid int) error {
	err := syscall.Kill(-pid, syscall.SIGKILL)
	if err == nil || !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return killProcess(pid)
}
