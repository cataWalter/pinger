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

func TestAccountCleanupRetriesWithoutRemovingActiveAccount(t *testing.T) {
	dataDir := t.TempDir()
	mediaRoot := filepath.Join(dataDir, "media")
	if err := os.WriteFile(mediaRoot, nil, 0o600); err != nil {
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
	service := &AppService{sharedPreferences: shared, scheduled: scheduled}
	if err = service.initializeAccounts(dataDir, mediaRoot); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.currentClient().Close)
	if !service.AccountCleanupPending() || !service.RetryAccountCleanup() {
		t.Fatal("cleanup should remain pending while the cache root is not a directory")
	}
	if err = os.Remove(mediaRoot); err != nil {
		t.Fatal(err)
	}
	obsolete := filepath.Join(mediaRoot, testOtherAccountID)
	if err = os.MkdirAll(obsolete, 0o700); err != nil {
		t.Fatal(err)
	}
	activeMedia := filepath.Join(mediaRoot, "active-media")
	if err = os.WriteFile(activeMedia, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if service.RetryAccountCleanup() || service.AccountCleanupPending() {
		t.Fatal("cleanup is still pending after the cache root was restored")
	}
	if _, err = os.Stat(obsolete); !os.IsNotExist(err) {
		t.Fatalf("obsolete media directory still exists: %v", err)
	}
	for _, path := range []string{activeMedia, filepath.Join(dataDir, "matrix.db")} {
		if _, err = os.Stat(path); err != nil {
			t.Fatalf("active account data was not preserved: %v", err)
		}
	}
}
