// Package sqliteutil provides helpers for copying SQLite databases.
package sqliteutil

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/mattn/go-sqlite3"
)

// Backup copies the database at sourcePath into destinationPath with SQLite's online
// backup API, so the copy contains every committed transaction even when the source
// uses WAL journaling. The source is opened read-write, which lets SQLite recover a
// WAL left behind by an unclean shutdown.
func Backup(sourcePath, destinationPath string) (err error) {
	return backup(sourcePath, destinationPath, false)
}

// BackupReadOnly copies the database at sourcePath into destinationPath without
// modifying the source file. Use it for data that must not be touched, such as the
// legacy application database.
func BackupReadOnly(sourcePath, destinationPath string) (err error) {
	return backup(sourcePath, destinationPath, true)
}

func backup(sourcePath, destinationPath string, readOnly bool) (err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	sourceURI := fileURI(sourcePath)
	query := "?_busy_timeout=5000"
	if readOnly {
		query = "?mode=ro&_busy_timeout=5000"
	}
	sourceDB, err := sql.Open("sqlite3", sourceURI+query)
	if err != nil {
		return fmt.Errorf("open source database: %w", err)
	}
	defer func() {
		if closeErr := sourceDB.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	sourceDB.SetMaxOpenConns(1)
	if err = sourceDB.PingContext(ctx); err != nil {
		return fmt.Errorf("read source database: %w", err)
	}

	destinationDB, err := sql.Open("sqlite3", destinationPath)
	if err != nil {
		return fmt.Errorf("open destination database: %w", err)
	}
	defer func() {
		if closeErr := destinationDB.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	destinationDB.SetMaxOpenConns(1)
	if err = destinationDB.PingContext(ctx); err != nil {
		return fmt.Errorf("initialize destination database: %w", err)
	}

	sourceConn, err := sourceDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire source database connection: %w", err)
	}
	defer func() {
		if closeErr := sourceConn.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	destinationConn, err := destinationDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire destination database connection: %w", err)
	}
	defer func() {
		if closeErr := destinationConn.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()

	err = destinationConn.Raw(func(destinationDriverConn any) error {
		destinationSQLite, ok := destinationDriverConn.(*sqlite3.SQLiteConn)
		if !ok {
			return fmt.Errorf("unexpected destination SQLite connection type %T", destinationDriverConn)
		}
		return sourceConn.Raw(func(sourceDriverConn any) error {
			sourceSQLite, ok := sourceDriverConn.(*sqlite3.SQLiteConn)
			if !ok {
				return fmt.Errorf("unexpected source SQLite connection type %T", sourceDriverConn)
			}
			return runBackup(destinationSQLite, sourceSQLite)
		})
	})
	return err
}

func runBackup(destination, source *sqlite3.SQLiteConn) (err error) {
	backup, err := destination.Backup("main", source, "main")
	if err != nil {
		return err
	}
	defer func() {
		if finishErr := backup.Finish(); err == nil && finishErr != nil {
			err = finishErr
		}
	}()

	deadline := time.Now().Add(30 * time.Second)
	for {
		done, stepErr := backup.Step(-1)
		if stepErr != nil {
			return stepErr
		}
		if done {
			return nil
		}
		if time.Now().After(deadline) {
			return errors.New("SQLite online backup timed out")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// fileURI turns a file path into a SQLite file URI. Windows paths need a leading
// slash, otherwise the drive letter is read as the URI authority.
func fileURI(path string) string {
	slashed := filepath.ToSlash(path)
	if !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	return (&url.URL{Scheme: "file", Path: slashed}).String()
}
