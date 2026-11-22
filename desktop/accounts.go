package desktop

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mychat/matrix"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const primaryAccountID = "primary"

type AccountSummary struct {
	ID      string         `json:"id"`
	Profile AccountProfile `json:"profile"`
}

type accountRegistryData struct {
	Accounts        []AccountSummary `json:"accounts"`
	ActiveAccountID string           `json:"activeAccountId"`
}

type accountRegistry struct {
	mu   sync.RWMutex
	path string
	data accountRegistryData
}

func newAccountRegistry(path string) (*accountRegistry, error) {
	if path == "" {
		return nil, errors.New("account registry path is empty")
	}
	registry := &accountRegistry{path: path, data: accountRegistryData{Accounts: []AccountSummary{}}}
	contents, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return registry, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read account registry: %w", err)
	}
	if err = json.Unmarshal(contents, &registry.data); err != nil {
		return nil, fmt.Errorf("decode account registry: %w", err)
	}
	if registry.data.Accounts == nil {
		registry.data.Accounts = []AccountSummary{}
	}
	return registry, nil
}

func (r *accountRegistry) All() []AccountSummary {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]AccountSummary(nil), r.data.Accounts...)
}

func (r *accountRegistry) ActiveID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.data.ActiveAccountID
}

func (r *accountRegistry) Upsert(account AccountSummary) error {
	if account.ID == "" || account.Profile.UserID == "" {
		return errors.New("account ID and Matrix user ID are required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	previous := r.data
	r.data.Accounts = append([]AccountSummary(nil), r.data.Accounts...)
	for index := range r.data.Accounts {
		if r.data.Accounts[index].ID == account.ID {
			r.data.Accounts[index] = account
			return r.saveOrRestore(previous)
		}
	}
	r.data.Accounts = append(r.data.Accounts, account)
	return r.saveOrRestore(previous)
}

func (r *accountRegistry) SetActive(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	known := false
	for _, account := range r.data.Accounts {
		if account.ID == id {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("account %q is not registered", id)
	}
	previous := r.data
	r.data.ActiveAccountID = id
	return r.saveOrRestore(previous)
}

// KeepOnly removes every registered account except keepID. It leaves the active ID alone and saves only when something was removed.
func (r *accountRegistry) KeepOnly(keepID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	kept := []AccountSummary{}
	for _, account := range r.data.Accounts {
		if account.ID == keepID {
			kept = append(kept, account)
		}
	}
	if len(kept) == len(r.data.Accounts) {
		return nil
	}
	previous := r.data
	r.data.Accounts = kept
	return r.saveOrRestore(previous)
}

func (r *accountRegistry) saveOrRestore(previous accountRegistryData) error {
	if err := r.saveLocked(); err != nil {
		r.data = previous
		return err
	}
	return nil
}

func validAccountID(accountID string) bool {
	decoded, err := hex.DecodeString(accountID)
	return err == nil && len(decoded) == 16
}

func accountDatabasePath(dataDir, accountID string) (string, error) {
	if accountID == primaryAccountID {
		return filepath.Join(dataDir, "matrix.db"), nil
	}
	if !validAccountID(accountID) {
		return "", fmt.Errorf("invalid account ID %q", accountID)
	}
	return filepath.Join(dataDir, "accounts", accountID, "matrix.db"), nil
}

// mediaCacheDirFor returns the media directory for an account. The primary account uses the root itself, and other accounts use a subdirectory.
func mediaCacheDirFor(root, accountID string) string {
	if root == "" || accountID == primaryAccountID {
		return root
	}
	return filepath.Join(root, accountID)
}

// initializeAccounts opens the one surviving account, deletes every other account's data, and records the survivor in the registry.
func (s *AppService) initializeAccounts(dataDir, mediaCacheRoot string) error {
	registry, err := newAccountRegistry(filepath.Join(dataDir, "accounts.json"))
	if err != nil {
		return err
	}
	survivorID := registry.ActiveID()
	if survivorID == "" {
		survivorID = primaryAccountID
	}
	databasePath, err := accountDatabasePath(dataDir, survivorID)
	if err != nil {
		return err
	}
	client, err := matrix.New(databasePath)
	if err != nil {
		return fmt.Errorf("open account %s: %w", survivorID, err)
	}
	if dir := mediaCacheDirFor(mediaCacheRoot, survivorID); dir != "" {
		client.SetMediaCacheDir(dir)
	}
	if client.IsLoggedIn() && survivorID != primaryAccountID {
		for _, stored := range registry.All() {
			if stored.ID != survivorID || stored.Profile.UserID == "" {
				continue
			}
			actual := accountSummary(survivorID, client)
			if stored.Profile.UserID != actual.Profile.UserID {
				client.Close()
				return fmt.Errorf("account %s database belongs to %s, not %s", survivorID, actual.Profile.UserID, stored.Profile.UserID)
			}
			break
		}
	}

	s.removeOtherAccounts(dataDir, survivorID, mediaCacheRoot)
	if err = registry.KeepOnly(survivorID); err != nil {
		client.Close()
		return err
	}
	if client.IsLoggedIn() {
		if err = registry.Upsert(accountSummary(survivorID, client)); err != nil {
			client.Close()
			return err
		}
		if err = registry.SetActive(survivorID); err != nil {
			client.Close()
			return err
		}
	}

	s.accountMu.Lock()
	s.accountRegistry = registry
	s.activeAccountID = survivorID
	s.dataDir = dataDir
	s.mediaCacheRoot = mediaCacheRoot
	s.client = client
	s.accountMu.Unlock()
	return nil
}

func accountSummary(id string, client *matrix.Client) AccountSummary {
	profile := client.Profile()
	return AccountSummary{
		ID: id,
		Profile: AccountProfile{
			UserID:      profile.UserID,
			DisplayName: profile.DisplayName,
			Homeserver:  profile.Homeserver,
			DeviceID:    profile.DeviceID,
			AvatarURI:   profile.AvatarURI,
			Verified:    !client.NeedsVerification(),
		},
	}
}

func (s *AppService) currentClient() *matrix.Client {
	s.accountMu.RLock()
	defer s.accountMu.RUnlock()
	return s.client
}

// requireClient returns the active client, or errNoActiveAccount when none is set.
func (s *AppService) requireClient() (*matrix.Client, error) {
	client := s.currentClient()
	if client == nil {
		return nil, errNoActiveAccount
	}
	return client, nil
}

func (s *AppService) currentAccountID() string {
	s.accountMu.RLock()
	id := s.activeAccountID
	s.accountMu.RUnlock()
	return id
}

func mapAccountUpdate(update matrix.Update, accountID string, preferences map[string]any) Update {
	mapped := mapUpdate(update, preferences)
	mapped.AccountID = accountID
	mapped.NotificationPreferences = make(map[string]any)
	for key, value := range preferences {
		if strings.HasPrefix(key, "notifications.") || strings.HasPrefix(key, "room.muted.") || key == "sounds.effects" {
			mapped.NotificationPreferences[key] = value
		}
	}
	tagRooms(mapped.Rooms, accountID)
	tagNotifications(mapped.Notifications, accountID)
	return mapped
}
