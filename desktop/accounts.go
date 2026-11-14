package desktop

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mychat/matrix"
	"os"
	"path/filepath"
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

func (r *accountRegistry) UpsertAndActivate(account AccountSummary) error {
	if account.ID == "" || account.Profile.UserID == "" {
		return errors.New("account ID and Matrix user ID are required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	previous := r.data
	r.data.Accounts = append([]AccountSummary(nil), r.data.Accounts...)
	updated := false
	for index := range r.data.Accounts {
		if r.data.Accounts[index].ID == account.ID {
			r.data.Accounts[index] = account
			updated = true
			break
		}
	}
	if !updated {
		r.data.Accounts = append(r.data.Accounts, account)
	}
	r.data.ActiveAccountID = account.ID
	return r.saveOrRestore(previous)
}

func accountDatabasePath(dataDir, accountID string) (string, error) {
	if accountID == primaryAccountID {
		return filepath.Join(dataDir, "matrix.db"), nil
	}
	decoded, err := hex.DecodeString(accountID)
	if err != nil || len(decoded) != 16 {
		return "", fmt.Errorf("invalid account ID %q", accountID)
	}
	return filepath.Join(dataDir, "accounts", accountID, "matrix.db"), nil
}

func newAccountID() (string, error) {
	var id [16]byte
	if _, err := cryptorand.Read(id[:]); err != nil {
		return "", fmt.Errorf("generate account ID: %w", err)
	}
	return hex.EncodeToString(id[:]), nil
}

func (s *AppService) initializeAccounts(dataDir, mediaCacheDir string) error {
	registry, err := newAccountRegistry(filepath.Join(dataDir, "accounts.json"))
	if err != nil {
		return err
	}
	s.accountMu.RLock()
	primary := s.client
	s.accountMu.RUnlock()
	clients := make(map[string]*matrix.Client, 1)
	activeID := registry.ActiveID()
	if activeID == "" {
		activeID = primaryAccountID
	}
	activeClient := primary
	if activeID != primaryAccountID {
		databasePath, pathErr := accountDatabasePath(dataDir, activeID)
		if pathErr != nil {
			return pathErr
		}
		activeClient, err = matrix.New(databasePath)
		if err != nil {
			return fmt.Errorf("open account %s: %w", activeID, err)
		}
		if mediaCacheDir != "" {
			activeClient.SetMediaCacheDir(filepath.Join(mediaCacheDir, activeID))
		}
		if activeClient.IsLoggedIn() {
			for _, stored := range registry.All() {
				if stored.ID != activeID || stored.Profile.UserID == "" {
					continue
				}
				actual := accountSummary(activeID, activeClient)
				if stored.Profile.UserID != actual.Profile.UserID {
					activeClient.Close()
					return fmt.Errorf("account %s database belongs to %s, not %s", activeID, actual.Profile.UserID, stored.Profile.UserID)
				}
				break
			}
		}
	}
	clients[activeID] = activeClient

	if activeClient.IsLoggedIn() {
		if err = registry.Upsert(accountSummary(activeID, activeClient)); err != nil {
			closeAccountClientMap(clients)
			return err
		}
		if err = registry.SetActive(activeID); err != nil {
			closeAccountClientMap(clients)
			return err
		}
	}
	if primary != activeClient {
		primary.Close()
	}

	s.accountMu.Lock()
	s.accountRegistry = registry
	s.accountClients = clients
	s.activeAccountID = activeID
	s.dataDir = dataDir
	s.accountMediaCacheDir = mediaCacheDir
	s.client = activeClient
	s.accountMu.Unlock()
	return nil
}

func closeAccountClientMap(clients map[string]*matrix.Client) {
	for _, client := range clients {
		client.Close()
	}
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

func (s *AppService) Accounts() []AccountSummary {
	s.accountMu.RLock()
	registry := s.accountRegistry
	s.accountMu.RUnlock()
	if registry == nil {
		return []AccountSummary{}
	}
	return registry.All()
}
