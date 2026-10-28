//go:build linux

package desktop

import (
	"os/exec"
	"syscall"
)

// configureImageEngineProcess makes the kernel kill sd-server when the app exits.
// Pdeathsig follows the starting OS thread, so the startup reaper still covers other cases.
func configureImageEngineProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}

// killImageEngineTree kills the sd-server process.
func killImageEngineTree(pid int) error {
	return killProcess(pid)
}
