package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

const (
	testSurvivorAccountID = "0123456789abcdef0123456789abcdef"
	testOtherAccountID    = "fedcba9876543210fedcba9876543210"
)

func writeCleanupFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertCleanupPathExists(t *testing.T, path string, want bool) {
	t.Helper()
	_, err := os.Stat(path)
	if got := err == nil; got != want {
		t.Errorf("%s exists = %t, want %t", path, got, want)
	}
}

func TestCleanupKeepsSecondarySurvivorAndRemovesPrimary(t *testing.T) {
	dataDir := t.TempDir()
	mediaRoot := t.TempDir()
	for _, name := range primaryMatrixFiles {
		writeCleanupFile(t, filepath.Join(dataDir, name))
	}
	writeCleanupFile(t, filepath.Join(dataDir, "accounts", testSurvivorAccountID, "matrix.db"))
	writeCleanupFile(t, filepath.Join(dataDir, "accounts", testOtherAccountID, "matrix.db"))
	writeCleanupFile(t, filepath.Join(mediaRoot, "avatar-0123456789abcdef"))
	writeCleanupFile(t, filepath.Join(mediaRoot, testSurvivorAccountID, "file"))
	writeCleanupFile(t, filepath.Join(mediaRoot, testOtherAccountID, "file"))

	if err := removeOtherAccountDatabases(dataDir, testSurvivorAccountID); err != nil {
		t.Fatal(err)
	}
	if err := removeOtherMediaCache(mediaRoot, testSurvivorAccountID); err != nil {
		t.Fatal(err)
	}

	for _, name := range primaryMatrixFiles {
		assertCleanupPathExists(t, filepath.Join(dataDir, name), false)
	}
	assertCleanupPathExists(t, filepath.Join(dataDir, "accounts", testSurvivorAccountID, "matrix.db"), true)
	assertCleanupPathExists(t, filepath.Join(dataDir, "accounts", testOtherAccountID), false)
	assertCleanupPathExists(t, filepath.Join(mediaRoot, "avatar-0123456789abcdef"), false)
	assertCleanupPathExists(t, filepath.Join(mediaRoot, testSurvivorAccountID, "file"), true)
	assertCleanupPathExists(t, filepath.Join(mediaRoot, testOtherAccountID), false)
}

func TestCleanupKeepsPrimaryAndRemovesSecondaryAccounts(t *testing.T) {
	dataDir := t.TempDir()
	mediaRoot := t.TempDir()
	writeCleanupFile(t, filepath.Join(dataDir, "matrix.db"))
	writeCleanupFile(t, filepath.Join(dataDir, "accounts", testOtherAccountID, "matrix.db"))
	writeCleanupFile(t, filepath.Join(mediaRoot, "avatar-0123456789abcdef"))
	writeCleanupFile(t, filepath.Join(mediaRoot, testOtherAccountID, "file"))

	if err := removeOtherAccountDatabases(dataDir, primaryAccountID); err != nil {
		t.Fatal(err)
	}
	if err := removeOtherMediaCache(mediaRoot, primaryAccountID); err != nil {
		t.Fatal(err)
	}

	assertCleanupPathExists(t, filepath.Join(dataDir, "matrix.db"), true)
	assertCleanupPathExists(t, filepath.Join(dataDir, "accounts"), false)
	assertCleanupPathExists(t, filepath.Join(mediaRoot, "avatar-0123456789abcdef"), true)
	assertCleanupPathExists(t, filepath.Join(mediaRoot, testOtherAccountID), false)
}

func TestInitializeAccountsKeepsOnlyActiveAccount(t *testing.T) {
	dataDir := t.TempDir()
	mediaRoot := filepath.Join(t.TempDir(), "media")
	writeCleanupFile(t, filepath.Join(dataDir, "matrix.db"))
	writeCleanupFile(t, filepath.Join(dataDir, "crypto.key"))
	registry, err := newAccountRegistry(filepath.Join(dataDir, "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = registry.Upsert(AccountSummary{ID: primaryAccountID, Profile: AccountProfile{UserID: "@one:example.org"}}); err != nil {
		t.Fatal(err)
	}
	if err = registry.Upsert(AccountSummary{ID: testSurvivorAccountID, Profile: AccountProfile{UserID: "@two:example.org"}}); err != nil {
		t.Fatal(err)
	}
	if err = registry.SetActive(testSurvivorAccountID); err != nil {
		t.Fatal(err)
	}
	shared, err := openSharedPreferences(dataDir, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = shared.Close() })
	scheduled, err := newScheduledJobStore(filepath.Join(dataDir, "scheduled-jobs.json"))
	if err != nil {
		t.Fatal(err)
	}
	service := &AppService{dataDir: dataDir, sharedPreferences: shared, scheduled: scheduled}
	t.Cleanup(func() {
		if client := service.currentClient(); client != nil {
			client.Close()
		}
	})

	if err = service.initializeAccounts(dataDir, mediaRoot); err != nil {
		t.Fatal(err)
	}
	if accounts := service.accountRegistry.All(); len(accounts) != 1 || accounts[0].ID != testSurvivorAccountID {
		t.Fatalf("registered accounts = %#v, want only %s", accounts, testSurvivorAccountID)
	}
	if got := service.currentAccountID(); got != testSurvivorAccountID {
		t.Fatalf("current account = %q, want %q", got, testSurvivorAccountID)
	}
	assertCleanupPathExists(t, filepath.Join(dataDir, "matrix.db"), false)
	assertCleanupPathExists(t, filepath.Join(dataDir, "crypto.key"), false)
	assertCleanupPathExists(t, filepath.Join(dataDir, "accounts", testSurvivorAccountID, "matrix.db"), true)
}
