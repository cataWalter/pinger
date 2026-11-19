package desktop

import (
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
)

// primaryMatrixFiles lists the files that make up the primary account's Matrix database and key.
var primaryMatrixFiles = []string{"matrix.db", "matrix.db-wal", "matrix.db-shm", "matrix.db-journal", "crypto.key"}

// removeOtherAccounts deletes the preferences, scheduled jobs, databases, and cached media of every account except survivorID.
// Failures are logged so that a partial cleanup does not block startup; the next launch retries it.
func (s *AppService) removeOtherAccounts(dataDir, survivorID, mediaCacheRoot string) {
	if _, err := s.sharedPreferences.DeleteAccountsExcept(survivorID); err != nil {
		log.Printf("could not remove preferences for other accounts: %v", err)
	}
	if _, err := s.scheduled.keepOnlyAccount(survivorID); err != nil {
		log.Printf("could not remove scheduled jobs for other accounts: %v", err)
	}
	if err := removeOtherAccountDatabases(dataDir, survivorID); err != nil {
		log.Printf("could not remove databases for other accounts: %v", err)
	}
	if err := removeOtherMediaCache(mediaCacheRoot, survivorID); err != nil {
		log.Printf("could not remove cached media for other accounts: %v", err)
	}
}

// removeOtherAccountDatabases keeps the survivor's database. When the survivor is a secondary account, the primary database lives at the data directory root and is removed too.
func removeOtherAccountDatabases(dataDir, survivorID string) error {
	accountsDir := filepath.Join(dataDir, "accounts")
	if survivorID == primaryAccountID {
		return os.RemoveAll(accountsDir)
	}
	var errs []error
	for _, name := range primaryMatrixFiles {
		if err := os.Remove(filepath.Join(dataDir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	entries, err := os.ReadDir(accountsDir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		errs = append(errs, err)
	}
	for _, entry := range entries {
		if entry.Name() == survivorID {
			continue
		}
		if err := os.RemoveAll(filepath.Join(accountsDir, entry.Name())); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// removeOtherMediaCache keeps the survivor's media. The primary account's media is stored as flat files at the root, and each secondary account has its own directory.
func removeOtherMediaCache(root, survivorID string) error {
	if root == "" {
		return nil
	}
	entries, err := os.ReadDir(root)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var errs []error
	for _, entry := range entries {
		name := entry.Name()
		if name == survivorID {
			continue
		}
		if survivorID == primaryAccountID && (!entry.IsDir() || !validAccountID(name)) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, name)); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
