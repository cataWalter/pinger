package desktop

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"mychat/matrix"
)

func TestAccountRegistryPersistsAccountsAndActiveAccount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.json")
	registry, err := newAccountRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	first := AccountSummary{ID: "primary", Profile: AccountProfile{UserID: "@one:example.org", Homeserver: "https://example.org"}}
	second := AccountSummary{ID: "account-two", Profile: AccountProfile{UserID: "@two:example.net", Homeserver: "https://example.net"}}
	if err = registry.Upsert(first); err != nil {
		t.Fatal(err)
	}
	if err = registry.Upsert(second); err != nil {
		t.Fatal(err)
	}
	if err = registry.SetActive(second.ID); err != nil {
		t.Fatal(err)
	}

	reloaded, err := newAccountRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.All(); !reflect.DeepEqual(got, []AccountSummary{first, second}) {
		t.Fatalf("accounts = %#v, want %#v", got, []AccountSummary{first, second})
	}
	if got := reloaded.ActiveID(); got != second.ID {
		t.Fatalf("active account = %q, want %q", got, second.ID)
	}
}

func TestAddAccountLoginFailureRollsBackAccountData(t *testing.T) {
	dataDir := t.TempDir()
	registry, err := newAccountRegistry(filepath.Join(dataDir, "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	service := &AppService{
		accountRegistry:      registry,
		accountClients:       map[string]*matrix.Client{},
		dataDir:              dataDir,
		accountMediaCacheDir: filepath.Join(t.TempDir(), "media-cache"),
		ctx:                  context.Background(),
	}

	if _, err := service.AddAccount("://invalid", "@alice:example.org", "password"); err == nil {
		t.Fatal("AddAccount() succeeded with an invalid homeserver")
	}
	entries, err := os.ReadDir(filepath.Join(dataDir, "accounts"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("read account data directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("account data directory contains %d entries after failed login", len(entries))
	}
	if accounts := service.Accounts(); len(accounts) != 0 {
		t.Fatalf("registered accounts after failed login = %#v, want none", accounts)
	}
}

func TestAccountRegistryRejectsUnknownActiveAccount(t *testing.T) {
	registry, err := newAccountRegistry(filepath.Join(t.TempDir(), "accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = registry.SetActive("unknown"); err == nil {
		t.Fatal("SetActive accepted an unknown account")
	}
}
