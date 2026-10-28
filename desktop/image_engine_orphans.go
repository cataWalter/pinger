package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// imageEngineRecordFile names the record of the sd-server process started by the app.
const imageEngineRecordFile = "image-engine.json"

// imageEngineRecord identifies a started sd-server so a later launch can reap it after a crash.
type imageEngineRecord struct {
	PID    int    `json:"pid"`
	Binary string `json:"binary"`
	Owner  int    `json:"owner"`
}

// imageEngineRecordPath returns the record location in the stable default data folder, or empty when unknown.
func imageEngineRecordPath(defaultDataDir string) string {
	if defaultDataDir == "" {
		return ""
	}
	return filepath.Join(defaultDataDir, imageEngineRecordFile)
}

// recordLocked writes the record for a newly started process. The caller must hold the mutex.
func (e *imageEngine) recordLocked(pid int, binary string) {
	if e.stateFile == "" {
		return
	}
	record := imageEngineRecord{PID: pid, Binary: binary, Owner: os.Getpid()}
	data, err := json.Marshal(record)
	if err == nil {
		err = os.WriteFile(e.stateFile, data, 0o600)
	}
	if err != nil {
		log.Printf("record image engine process: %v", err)
	}
}

// removeImageEngineRecord deletes the record once the process it names is stopped.
func removeImageEngineRecord(path string) {
	if path == "" {
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("remove image engine record: %v", err)
	}
}

// reapOrphanedImageEngine kills the sd-server left behind by a crashed app.
// It leaves the record alone while another live app instance owns the process.
func reapOrphanedImageEngine(path string) error {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read image engine record: %w", err)
	}
	var record imageEngineRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return removeRecordFile(path)
	}
	if record.Owner != os.Getpid() && processExists(record.Owner) {
		return nil
	}
	var killErr error
	if command, ok := processCommand(record.PID); ok && record.Binary != "" && strings.Contains(command, record.Binary) {
		killErr = killImageEngineTree(record.PID)
	}
	if err := removeRecordFile(path); err != nil {
		return err
	}
	if killErr != nil {
		return fmt.Errorf("stop orphaned image engine %d: %w", record.PID, killErr)
	}
	return nil
}

func removeRecordFile(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove image engine record: %w", err)
	}
	return nil
}

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

func processExists(pid int) bool {
	_, ok := processCommand(pid)
	return ok
}

func killProcess(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Kill()
}
