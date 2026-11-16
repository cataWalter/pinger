//go:build !linux && !darwin

package desktop

import "os/exec"

// configureImageEngineProcess has no parent-death signal here, so the startup reaper handles orphans.
func configureImageEngineProcess(_ *exec.Cmd) {}

// killImageEngineTree kills the sd-server process.
func killImageEngineTree(pid int) error {
	return killProcess(pid)
}
