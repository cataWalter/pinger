package desktop

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"
)

// relaunchParentEnv carries the process ID of the instance that started this one. The
// new instance waits for that process to exit, so it never opens the data files while
// the previous instance still holds them.
const relaunchParentEnv = "PINGER_RELAUNCH_PARENT_PID"

// WaitForPreviousInstance blocks until the instance that started this one has exited.
func WaitForPreviousInstance() {
	raw := os.Getenv(relaunchParentEnv)
	if raw == "" {
		return
	}
	pid, err := strconv.Atoi(raw)
	if err != nil || pid <= 0 || pid == os.Getpid() {
		return
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// relaunch starts another instance of the application. The new instance waits for this
// one to exit before it opens the data files.
func relaunch() error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate the Pinger executable: %w", err)
	}
	command := exec.Command(executable, os.Args[1:]...)
	if workingDir, workingErr := os.Getwd(); workingErr == nil {
		command.Dir = workingDir
	}
	command.Env = append(os.Environ(), relaunchParentEnv+"="+strconv.Itoa(os.Getpid()))
	if err = command.Start(); err != nil {
		return fmt.Errorf("start a new Pinger instance: %w", err)
	}
	return nil
}
