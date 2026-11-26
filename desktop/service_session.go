package desktop

import (
	"errors"
	"log"
	sharedpreferences "mychat/preferences"
	"strconv"
	"time"
)

func (s *AppService) Snapshot() (Snapshot, error) {
	client, err := s.requireClient()
	if err != nil {
		return Snapshot{}, err
	}
	if err := client.WaitForCache(s.ctx); err != nil {
		return Snapshot{}, err
	}
	profile := client.Profile()
	preferences := s.preferenceValues()
	rooms := mapRoomsWithPreferences(client.Rooms(), preferences)
	tagRooms(rooms, s.currentAccountID())
	if s.smokeSnapshot != nil {
		select {
		case s.smokeSnapshot <- struct{}{}:
		default:
		}
	}
	return Snapshot{
		AccountID:             s.currentAccountID(),
		LoggedIn:              client.IsLoggedIn(),
		NeedsVerification:     client.NeedsVerification(),
		Verification:          mapVerification(client.Verification()),
		SyncReady:             client.SyncReady(),
		ConnectionState:       string(client.ConnectionState()),
		SlidingSyncListCounts: client.SlidingSyncListCounts(),
		Profile: AccountProfile{
			UserID:      profile.UserID,
			DisplayName: profile.DisplayName,
			Homeserver:  profile.Homeserver,
			DeviceID:    profile.DeviceID,
			AvatarURI:   profile.AvatarURI,
			Verified:    profile.Verified,
		},
		Rooms:       rooms,
		Invites:     mapInvites(client.Invites()),
		Preferences: preferences,
	}, nil
}

func (s *AppService) preferenceValues() map[string]any {
	return s.preferenceValuesForAccount(s.currentAccountID())
}

func (s *AppService) preferenceValuesForAccount(accountID string) map[string]any {
	if s.sharedPreferences != nil {
		values, err := s.sharedPreferences.Snapshot(accountID)
		if err != nil {
			log.Printf("read shared preferences: %v", err)
			return map[string]any{}
		}
		return values
	}
	if s.preferences != nil {
		return s.preferences.All()
	}
	return map[string]any{}
}

func (s *AppService) setPreference(key string, value any) error {
	if s.sharedPreferences != nil {
		if sharedpreferences.IsAccountKey(key) {
			return s.sharedPreferences.SetAccount(s.currentAccountID(), key, value)
		}
		return s.sharedPreferences.SetGlobal(key, value)
	}
	if s.preferences == nil {
		return errors.New("preference store is unavailable")
	}
	return s.preferences.Set(key, value)
}

func (s *AppService) startPreferencePump(emit func(Snapshot), emitDelta func(PreferenceDelta)) {
	if s.sharedPreferences == nil || emit == nil {
		return
	}
	changes, unsubscribe := s.sharedPreferences.Subscribe(8)
	s.preferencesUnsubscribe = unsubscribe
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		for {
			select {
			case <-s.ctx.Done():
				return
			case change, ok := <-changes:
				if !ok || s.ctx.Err() != nil {
					return
				}
				accountID := s.currentAccountID()
				if emitDelta != nil && len(change.Changed) > 0 && (change.AccountID == "" || change.AccountID == accountID) {
					emitDelta(PreferenceDelta{AccountID: accountID, Preferences: change.Changed})
					continue
				}
				state, err := s.Snapshot()
				if err != nil {
					log.Printf("build preference update: %v", err)
					continue
				}
				emit(state)
			}
		}
	}()
}

func (s *AppService) Login(homeserver, username, password string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	if err := client.Login(s.ctx, homeserver, username, password); err != nil {
		return err
	}
	if s.accountRegistry != nil {
		account := accountSummary(s.currentAccountID(), client)
		if err := s.accountRegistry.Upsert(account); err != nil {
			return err
		}
		return s.accountRegistry.SetActive(account.ID)
	}
	return nil
}

func (s *AppService) Verify(recoveryKey string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	if err := client.Verify(s.ctx, recoveryKey); err != nil {
		return err
	}
	if s.accountRegistry != nil {
		return s.accountRegistry.Upsert(accountSummary(s.currentAccountID(), client))
	}
	return nil
}

// StartSessionVerification asks the account's other sessions to compare emoji with this one.
func (s *AppService) StartSessionVerification() error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.StartSelfVerification(s.ctx)
}

func (s *AppService) AcceptSessionVerification() error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.AcceptVerification(s.ctx)
}

func (s *AppService) ConfirmSessionVerification() error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.ConfirmVerification(s.ctx)
}

// CancelSessionVerification stops the current verification, or dismisses it once finished.
func (s *AppService) CancelSessionVerification(mismatch bool) error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.CancelVerification(s.ctx, mismatch)
}

func (s *AppService) History(roomID string, before int64) (HistoryPage, error) {
	initialLimit := 100
	if before == 0 {
		if configured, ok := s.preferenceValues()["history.initial_messages"].(string); ok {
			if value, parseErr := strconv.Atoi(configured); parseErr == nil {
				initialLimit = value
			}
		}
	}
	client, err := s.requireClient()
	if err != nil {
		return HistoryPage{}, err
	}
	page, err := client.HistoryPageWithLimit(s.ctx, roomID, before, initialLimit)
	if err != nil {
		return HistoryPage{}, err
	}
	return HistoryPage{
		Messages: mapMessages(page.Messages),
		Before:   page.Before,
		HasMore:  page.HasMore,
	}, nil
}

func (s *AppService) SendMessage(roomID, text string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.SendMessage(s.ctx, roomID, text)
}

func (s *AppService) SendMessageWithMentions(roomID, text string, userIDs []string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.SendMessageWithMentions(s.ctx, roomID, text, userIDs)
}

func (s *AppService) SendReply(roomID, text, replyTo string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.SendReply(s.ctx, roomID, text, replyTo)
}

// ThreadMessages returns a thread's root and replies, oldest first.
func (s *AppService) ThreadMessages(roomID, rootID string) ([]Message, error) {
	client := s.currentClient()
	if client == nil {
		return nil, errNoActiveAccount
	}
	messages, err := client.ThreadMessages(s.ctx, roomID, rootID)
	if err != nil {
		return nil, err
	}
	return mapMessages(messages), nil
}

func (s *AppService) SendThreadReply(roomID, text, rootID string) error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.SendThreadReply(s.ctx, roomID, text, rootID)
}

func (s *AppService) EditMessage(roomID, text, eventID string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.EditMessage(s.ctx, roomID, text, eventID)
}

func (s *AppService) React(roomID, eventID, emoji string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.React(s.ctx, roomID, eventID, emoji)
}

func (s *AppService) RemoveReaction(roomID, eventID, emoji string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.RemoveReaction(s.ctx, roomID, eventID, emoji)
}

func (s *AppService) RedactMessage(roomID, eventID string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.RedactMessage(s.ctx, roomID, eventID)
}

func (s *AppService) RetryMessage(transactionID string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.RetryMessage(s.ctx, transactionID)
}

func (s *AppService) MarkRead(roomID, eventID string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.MarkRead(s.ctx, roomID, eventID)
}

func (s *AppService) MarkUnread(roomID string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.MarkUnread(s.ctx, roomID)
}

func (s *AppService) SetTyping(roomID string, timeoutMilliseconds int64) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.SetTyping(s.ctx, roomID, time.Duration(timeoutMilliseconds)*time.Millisecond)
}

type MessageSearchRequest struct {
	Query        string `json:"query"`
	RoomID       string `json:"roomID"`
	Sender       string `json:"sender"`
	MinTimestamp int64  `json:"minTimestamp"`
	MaxTimestamp int64  `json:"maxTimestamp"`
	Limit        int    `json:"limit"`
	NextBatch    string `json:"nextBatch"`
}

type MessageSearchResult struct {
	RoomID  string  `json:"roomID"`
	Message Message `json:"message"`
}

type MessageSearchPage struct {
	Results   []MessageSearchResult `json:"results"`
	NextBatch string                `json:"nextBatch"`
}
