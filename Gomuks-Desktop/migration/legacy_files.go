package migration

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

func writeExclusive(destination string, contents []byte, mode os.FileMode) (bool, error) {
	directory := filepath.Dir(destination)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return false, fmt.Errorf("create destination directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".gomuks-migration-*")
	if err != nil {
		return false, fmt.Errorf("create temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err = temporary.Chmod(mode); err == nil {
		var written int
		written, err = temporary.Write(contents)
		if err == nil && written != len(contents) {
			err = errors.New("short write")
		}
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return false, fmt.Errorf("write temporary file: %w", err)
	}

	linked, err := linkExclusive(temporaryPath, destination)
	if err != nil || !linked {
		return linked, err
	}
	if err = syncDirectory(directory); err != nil {
		return true, err
	}
	return true, nil
}

func linkExclusive(source, destination string) (bool, error) {
	if err := os.Link(source, destination); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func databaseDestinationState(path string) (databaseExists, sidecarExists bool, err error) {
	databaseExists, err = pathExists(path)
	if err != nil || databaseExists {
		return databaseExists, false, err
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		exists, err := pathExists(path + suffix)
		if err != nil {
			return false, false, err
		}
		sidecarExists = sidecarExists || exists
	}
	return databaseExists, sidecarExists, nil
}

func regularFileExists(path string) (bool, error) {
	info, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, fmt.Errorf("%q is not a regular file", path)
	}
	return true, nil
}

func pathExists(path string) (bool, error) {
	_, err := os.Lstat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func syncFile(path string) error {
	// The file is opened for writing, because Windows refuses to flush a read-only handle.
	file, err := os.OpenFile(path, os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func syncDirectory(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	if err = directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	return directory.Close()
}
