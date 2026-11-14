package desktop

import (
	"errors"
	"fmt"
	"mychat/logging"
	"mychat/matrix"
	"os"
	"path/filepath"
	"strings"
)

func (s *AppService) accountClient(accountID string) (*matrix.Client, error) {
	s.accountOpenMu.Lock()
	defer s.accountOpenMu.Unlock()
	s.accountMu.RLock()
	if client := s.accountClients[accountID]; client != nil {
		s.accountMu.RUnlock()
		return client, nil
	}
	registry := s.accountRegistry
	dataDir := s.dataDir
	mediaCacheDir := s.accountMediaCacheDir
	s.accountMu.RUnlock()
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
	databasePath, err := accountDatabasePath(dataDir, accountID)
	if err != nil {
		return nil, err
	}
	client, err := matrix.New(databasePath)
	if err != nil {
		return nil, fmt.Errorf("open account %s: %w", accountID, err)
	}
	if mediaCacheDir != "" {
		client.SetMediaCacheDir(filepath.Join(mediaCacheDir, accountID))
	}
	if client.IsLoggedIn() && stored.Profile.UserID != "" {
		actualUserID := client.Profile().UserID
		if actualUserID != stored.Profile.UserID {
			client.Close()
			return nil, fmt.Errorf("account %s database belongs to %s, not %s", accountID, actualUserID, stored.Profile.UserID)
		}
	}
	s.accountMu.Lock()
	if s.accountClients == nil {
		s.accountClients = make(map[string]*matrix.Client)
	}
	s.accountClients[accountID] = client
	s.accountMu.Unlock()
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
	s.setActiveAccount(accountID, client)
	s.startAccountEventPump(accountID, client)
	s.startAccountSync(accountID, client)
	s.notifyAccountsChanged()
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
		removeAccountData(dataDir, accountID, mediaCacheDir)
		return Snapshot{}, err
	}
	if err = registry.UpsertAndActivate(accountSummary(accountID, client)); err != nil {
		client.Close()
		removeAccountData(dataDir, accountID, mediaCacheDir)
		return Snapshot{}, err
	}
	s.accountMu.Lock()
	if s.accountClients == nil {
		s.accountClients = make(map[string]*matrix.Client)
	}
	s.accountClients[accountID] = client
	s.accountMu.Unlock()
	s.setActiveAccount(accountID, client)
	s.startAccountEventPump(accountID, client)
	s.startAccountSync(accountID, client)
	s.notifyAccountsChanged()
	return s.Snapshot()
}

// removeAccountData deletes the database and media cache created for an account that was not added.
func removeAccountData(dataDir, accountID, mediaCacheDir string) {
	_ = os.RemoveAll(filepath.Join(dataDir, "accounts", accountID))
	if mediaCacheDir != "" {
		_ = os.RemoveAll(filepath.Join(mediaCacheDir, accountID))
	}
}

// setActiveAccount updates the active account ID and client together.
func (s *AppService) setActiveAccount(accountID string, client *matrix.Client) {
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	s.activeAccountID = accountID
	s.client = client
}

func (s *AppService) currentClient() *matrix.Client {
	s.accountMu.RLock()
	defer s.accountMu.RUnlock()
	return s.client
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
				emit(mapAccountUpdate(update, accountID, s.preferenceValuesForAccount(accountID)))
			}
		}
	}()
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

func (r *accountRegistry) saveOrRestore(previous accountRegistryData) error {
	if err := r.saveLocked(); err != nil {
		r.data = previous
		return err
	}
	return nil
}
