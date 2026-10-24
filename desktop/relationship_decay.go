package desktop

import (
	"log"
	"time"

	"mychat/matrix"
)

const (
	relationshipDecayCooldown        = 7 * 24 * time.Hour
	relationshipDecayVIPThreshold    = 7 * 24 * time.Hour
	relationshipDecayFriendThreshold = 14 * 24 * time.Hour
	relationshipDecayCasualThreshold = 30 * 24 * time.Hour
	relationshipDecayClientThreshold = 10 * 24 * time.Hour
	relationshipDecayBatchLimit      = 100
	relationshipDecayInterval        = 6 * time.Hour
	relationshipDecayEventName       = "relationship-decay:update"
)

type RelationshipDecayContact struct {
	ContactID                string   `json:"contactId"`
	DisplayName              string   `json:"displayName"`
	Tier                     string   `json:"tier"`
	RoomIDs                  []string `json:"roomIds"`
	LastInteractionTimestamp int64    `json:"lastInteractionTimestamp"`
	LastDecayAlertTimestamp  int64    `json:"lastDecayAlertTimestamp"`
	SnoozedUntil             int64    `json:"snoozedUntil"`
	Alerted                  bool     `json:"alerted"`
}

type RelationshipDecaySnapshot struct {
	AccountID string                     `json:"accountId"`
	Enabled   bool                       `json:"enabled"`
	Contacts  []RelationshipDecayContact `json:"contacts"`
}

func relationshipDecayAlertActive(contact RelationshipDecayContact, now time.Time) bool {
	return contact.LastDecayAlertTimestamp > now.Add(-relationshipDecayCooldown).UnixMilli() && contact.SnoozedUntil <= now.UnixMilli()
}

func relationshipDecayThreshold(tier string) (time.Duration, bool) {
	switch tier {
	case "VIP":
		return relationshipDecayVIPThreshold, true
	case "CLOSE_FRIEND":
		return relationshipDecayFriendThreshold, true
	case "CASUAL":
		return relationshipDecayCasualThreshold, true
	case "CLIENT":
		return relationshipDecayClientThreshold, true
	default:
		return 0, false
	}
}

func (s *AppService) RelationshipDecayContacts() (RelationshipDecaySnapshot, error) {
	accountID := s.currentAccountID()
	client := s.currentClient()
	store, err := s.relationshipHealthStoreForAccount(accountID)
	if err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	if err := syncRelationshipDecayContacts(store, client); err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	return relationshipDecaySnapshot(accountID, store, s.preferenceValuesForAccount(accountID), time.Now())
}

func (s *AppService) SetRelationshipTier(roomID, tier string) (RelationshipDecaySnapshot, error) {
	accountID := s.currentAccountID()
	client := s.currentClient()
	room, err := relationshipRoom(client, roomID)
	if err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	store, err := s.relationshipHealthStoreForAccount(accountID)
	if err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	contactID, err := store.ensureContact(room.ID, room.Name)
	if err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	if !room.LastEventAt.IsZero() {
		if err := store.updateContactInteraction(contactID, room.LastEventAt.UnixMilli()); err != nil {
			return RelationshipDecaySnapshot{}, err
		}
	}
	if err := store.setContactTier(contactID, tier); err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	s.triggerRelationshipDecay()
	return relationshipDecaySnapshot(accountID, store, s.preferenceValuesForAccount(accountID), time.Now())
}

func (s *AppService) SnoozeRelationshipDecay(contactID string) (RelationshipDecaySnapshot, error) {
	accountID := s.currentAccountID()
	store, err := s.relationshipHealthStoreForAccount(accountID)
	if err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	if err := store.snoozeDecayAlert(contactID, time.Now().Add(relationshipDecayCooldown).UnixMilli()); err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	s.triggerRelationshipDecay()
	return relationshipDecaySnapshot(accountID, store, s.preferenceValuesForAccount(accountID), time.Now())
}

func (s *AppService) startRelationshipDecayWorker() {
	if s.ctx == nil || s.ctx.Err() != nil {
		return
	}
	s.relationshipHealthMu.Lock()
	if s.relationshipDecayWorker {
		s.relationshipHealthMu.Unlock()
		return
	}
	s.relationshipDecayWorker = true
	trigger := make(chan struct{}, 1)
	s.relationshipDecayTrigger = trigger
	s.workers.Add(1)
	s.relationshipHealthMu.Unlock()

	go func() {
		defer s.workers.Done()
		ticker := time.NewTicker(relationshipDecayInterval)
		defer ticker.Stop()
		s.processRelationshipDecay()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				s.processRelationshipDecay()
			case <-trigger:
				s.processRelationshipDecay()
			}
		}
	}()
}

func (s *AppService) triggerRelationshipDecay() {
	s.relationshipHealthMu.Lock()
	trigger := s.relationshipDecayTrigger
	s.relationshipHealthMu.Unlock()
	if trigger == nil || s.ctx == nil || s.ctx.Err() != nil {
		return
	}
	select {
	case trigger <- struct{}{}:
	default:
	}
}

func (s *AppService) processRelationshipDecay() {
	if s.ctx == nil || s.ctx.Err() != nil {
		return
	}
	for accountID, client := range s.accountClientsSnapshot() {
		if s.ctx.Err() != nil {
			return
		}
		if client == nil || !client.IsLoggedIn() {
			continue
		}
		if err := s.processRelationshipDecayForAccount(accountID, client); err != nil {
			log.Printf("check relationship decay for account %s: %v", accountID, err)
		}
	}
}

func (s *AppService) processRelationshipDecayForAccount(accountID string, client *matrix.Client) error {
	store, err := s.relationshipHealthStoreForAccount(accountID)
	if err != nil {
		return err
	}
	if err := syncRelationshipDecayContacts(store, client); err != nil {
		return err
	}
	preferences := s.preferenceValuesForAccount(accountID)
	enabled, _ := preferences["relationship_health.enabled"].(bool)
	if !enabled {
		s.emitRelationshipDecayForAccount(accountID, store, preferences)
		return nil
	}
	candidates, err := store.dueDecayCandidates(time.Now(), relationshipDecayBatchLimit)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		s.emitRelationshipDecayForAccount(accountID, store, preferences)
		return nil
	}
	now := time.Now()
	for _, candidate := range candidates {
		if _, err := store.saveDecayAlert(candidate, now.UnixMilli(), now); err != nil {
			log.Printf("save relationship decay alert for contact %s: %v", candidate.ContactID, err)
		}
	}
	s.emitRelationshipDecayForAccount(accountID, store, preferences)
	return nil
}

func syncRelationshipDecayContacts(store *relationshipHealthStore, client *matrix.Client) error {
	if client == nil {
		return nil
	}
	for _, room := range client.Rooms() {
		if !room.Direct {
			continue
		}
		contactID, err := store.ensureContact(room.ID, room.Name)
		if err != nil {
			return err
		}
		if !room.LastEventAt.IsZero() {
			if err := store.updateContactInteraction(contactID, room.LastEventAt.UnixMilli()); err != nil {
				return err
			}
		}
	}
	return nil
}

func relationshipDecaySnapshot(accountID string, store *relationshipHealthStore, preferences map[string]any, now time.Time) (RelationshipDecaySnapshot, error) {
	contacts, err := store.decayContacts(now)
	if err != nil {
		return RelationshipDecaySnapshot{}, err
	}
	enabled, _ := preferences["relationship_health.enabled"].(bool)
	return RelationshipDecaySnapshot{AccountID: accountID, Enabled: enabled, Contacts: contacts}, nil
}

func (s *AppService) emitRelationshipDecayForAccount(accountID string, store *relationshipHealthStore, preferences map[string]any) {
	if s.emitRelationshipDecay == nil {
		return
	}
	snapshot, err := relationshipDecaySnapshot(accountID, store, preferences, time.Now())
	if err != nil {
		log.Printf("read relationship decay contacts for account %s: %v", accountID, err)
		return
	}
	s.emitRelationshipDecay(snapshot)
}
