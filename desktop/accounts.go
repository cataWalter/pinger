package desktop

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"mychat/logging"
	"mychat/matrix"
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
	primary := s.client
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
	s.accountMu.Unlock()
	s.clientMu.Lock()
	s.client = activeClient
	s.clientMu.Unlock()
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

func (s *AppService) accountClient(accountID string) (*matrix.Client, error) {
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	if client := s.accountClients[accountID]; client != nil {
		return client, nil
	}
	registry := s.accountRegistry
	if registry == nil {
		return nil, errors.New("account registry is unavailable")
	}
	var stored *AccountSummary
	for _, account := range registry.All() {
		if account.ID == accountID {
			stored = &account
			break
		}
	}
	if stored == nil {
		return nil, fmt.Errorf("account %q is not registered", accountID)
	}
	databasePath, err := accountDatabasePath(s.dataDir, accountID)
	if err != nil {
		return nil, err
	}
	client, err := matrix.New(databasePath)
	if err != nil {
		return nil, fmt.Errorf("open account %s: %w", accountID, err)
	}
	if s.accountMediaCacheDir != "" {
		client.SetMediaCacheDir(filepath.Join(s.accountMediaCacheDir, accountID))
	}
	if client.IsLoggedIn() && stored.Profile.UserID != "" {
		actualUserID := client.Profile().UserID
		if actualUserID != stored.Profile.UserID {
			client.Close()
			return nil, fmt.Errorf("account %s database belongs to %s, not %s", accountID, actualUserID, stored.Profile.UserID)
		}
	}
	if s.accountClients == nil {
		s.accountClients = make(map[string]*matrix.Client)
	}
	s.accountClients[accountID] = client
	return client, nil
}

func (s *AppService) AccountRooms() []Room {
	rooms := []Room{}
	for _, account := range s.Accounts() {
		client, err := s.accountClient(account.ID)
		if err != nil {
			logging.For("service").Warn().Err(err).Msg("could not open Matrix account for inbox")
			continue
		}
		if !client.IsLoggedIn() {
			continue
		}
		s.startAccountEventPump(account.ID, client)
		s.startAccountSync(account.ID, client)
		if err = client.WaitForCache(s.ctx); err != nil {
			if s.ctx.Err() == nil {
				logging.For("service").Warn().Err(err).Str("account_id", account.ID).Msg("could not load Matrix account cache for inbox")
			}
			continue
		}
		accountRooms := mapRoomsWithPreferences(client.Rooms(), s.preferenceValuesForAccount(account.ID))
		tagRooms(accountRooms, account.ID)
		rooms = append(rooms, accountRooms...)
	}
	return rooms
}

func (s *AppService) SwitchAccount(accountID string) (Snapshot, error) {
	client, err := s.accountClient(accountID)
	if err != nil {
		return Snapshot{}, err
	}
	if !client.IsLoggedIn() {
		return Snapshot{}, fmt.Errorf("account %q is not logged in", accountID)
	}
	s.accountMu.RLock()
	registry := s.accountRegistry
	s.accountMu.RUnlock()
	if registry == nil {
		return Snapshot{}, errors.New("account registry is unavailable")
	}
	if err = registry.SetActive(accountID); err != nil {
		return Snapshot{}, err
	}
	s.accountMu.Lock()
	s.activeAccountID = accountID
	s.accountMu.Unlock()
	s.clientMu.Lock()
	s.client = client
	s.clientMu.Unlock()
	s.startAccountEventPump(accountID, client)
	s.startAccountSync(accountID, client)
	return s.Snapshot()
}

func (s *AppService) AddAccount(homeserver, username, password string) (Snapshot, error) {
	s.accountMu.RLock()
	registry := s.accountRegistry
	dataDir := s.dataDir
	mediaCacheDir := s.accountMediaCacheDir
	s.accountMu.RUnlock()
	if registry == nil {
		return Snapshot{}, errors.New("account registry is unavailable")
	}
	accountID, err := newAccountID()
	if err != nil {
		return Snapshot{}, err
	}
	databasePath, err := accountDatabasePath(dataDir, accountID)
	if err != nil {
		return Snapshot{}, err
	}
	client, err := matrix.New(databasePath)
	if err != nil {
		return Snapshot{}, fmt.Errorf("create account database: %w", err)
	}
	if mediaCacheDir != "" {
		client.SetMediaCacheDir(filepath.Join(mediaCacheDir, accountID))
	}
	if err = client.Login(s.ctx, homeserver, username, password); err != nil {
		client.Close()
		return Snapshot{}, err
	}
	if err = registry.UpsertAndActivate(accountSummary(accountID, client)); err != nil {
		client.Close()
		return Snapshot{}, err
	}
	s.accountMu.Lock()
	if s.accountClients == nil {
		s.accountClients = make(map[string]*matrix.Client)
	}
	s.accountClients[accountID] = client
	s.activeAccountID = accountID
	s.accountMu.Unlock()
	s.clientMu.Lock()
	s.client = client
	s.clientMu.Unlock()
	s.startAccountEventPump(accountID, client)
	s.startAccountSync(accountID, client)
	return s.Snapshot()
}

func (s *AppService) currentClient() *matrix.Client {
	s.clientMu.RLock()
	client := s.client
	s.clientMu.RUnlock()
	return client
}

func (s *AppService) currentAccountID() string {
	s.accountMu.RLock()
	id := s.activeAccountID
	s.accountMu.RUnlock()
	return id
}

func (s *AppService) accountClientsSnapshot() map[string]*matrix.Client {
	s.accountMu.RLock()
	clients := make(map[string]*matrix.Client, len(s.accountClients))
	for id, client := range s.accountClients {
		clients[id] = client
	}
	s.accountMu.RUnlock()
	return clients
}

func (s *AppService) closeAccountClients() {
	closeAccountClientMap(s.accountClientsSnapshot())
}

func (s *AppService) startAccountEventPump(accountID string, client *matrix.Client) {
	s.accountMu.Lock()
	if s.accountEventPumps == nil {
		s.accountEventPumps = make(map[string]bool)
	}
	if s.accountEventPumps[accountID] || s.emitUpdate == nil || s.ctx.Err() != nil {
		s.accountMu.Unlock()
		return
	}
	s.accountEventPumps[accountID] = true
	emit := s.emitUpdate
	s.accountMu.Unlock()

	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		wasConnected := false
		for {
			select {
			case <-s.ctx.Done():
				return
			case update, ok := <-client.Events():
				if !ok || s.ctx.Err() != nil {
					return
				}
				if update.Error != "" {
					logging.For("service").Warn().
						Str("connection_state", string(update.ConnectionState)).
						Str("detail", update.Error).
						Msg("Matrix update reported an error")
				}
				connected := update.ConnectionState == matrix.StateConnected
				if connected && !wasConnected {
					s.triggerRelationshipDecay()
				}
				wasConnected = connected
				if s.currentAccountID() == accountID {
					mapped := mapUpdate(update, s.preferenceValuesForAccount(accountID))
					tagRooms(mapped.Rooms, accountID)
					emit(mapped)
				}
			}
		}
	}()
}

func (r *accountRegistry) saveOrRestore(previous accountRegistryData) error {
	if err := r.saveLocked(); err != nil {
		r.data = previous
		return err
	}
	return nil
}

func (r *accountRegistry) saveLocked() error {
	contents, err := json.Marshal(r.data)
	if err != nil {
		return fmt.Errorf("encode account registry: %w", err)
	}
	contents = append(contents, '\n')
	directory := filepath.Dir(r.path)
	if err = os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create account registry directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".pinger-accounts-*")
	if err != nil {
		return fmt.Errorf("create temporary account registry: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err = temporary.Chmod(0o600); err == nil {
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
		return fmt.Errorf("write temporary account registry: %w", err)
	}
	if err = os.Rename(temporaryPath, r.path); err != nil {
		return fmt.Errorf("replace account registry: %w", err)
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	directoryFile, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open account registry directory: %w", err)
	}
	if err = directoryFile.Sync(); err != nil {
		_ = directoryFile.Close()
		return fmt.Errorf("sync account registry directory: %w", err)
	}
	if err = directoryFile.Close(); err != nil {
		return fmt.Errorf("close account registry directory: %w", err)
	}
	return nil
}
