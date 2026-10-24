package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"mychat/matrix"
)

const (
	relationshipDecayCooldown        = 7 * 24 * time.Hour
	relationshipDecayVIPThreshold    = 7 * 24 * time.Hour
	relationshipDecayFriendThreshold = 14 * 24 * time.Hour
	relationshipDecayCasualThreshold = 30 * 24 * time.Hour
	relationshipDecayClientThreshold = 10 * 24 * time.Hour
	relationshipDecayHistoryLimit    = 10
	relationshipDecayBatchLimit      = 100
	relationshipDecayInterval        = 6 * time.Hour
	relationshipDecayTimeout         = 20 * time.Second
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
	Nudge                    string   `json:"nudge"`
	Alerted                  bool     `json:"alerted"`
}

type RelationshipDecaySnapshot struct {
	AccountID string                     `json:"accountId"`
	Enabled   bool                       `json:"enabled"`
	Contacts  []RelationshipDecayContact `json:"contacts"`
}

func relationshipDecayAlertActive(contact RelationshipDecayContact, now time.Time) bool {
	return contact.Nudge != "" && contact.LastDecayAlertTimestamp > now.Add(-relationshipDecayCooldown).UnixMilli() && contact.SnoozedUntil <= now.UnixMilli()
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
	provider, endpoint, model, err := relationshipModelSettings(preferences)
	tuning := aiFeatureTuningFor(preferences, aiFeatureRelationshipDecay)
	if err != nil {
		log.Printf("relationship decay local model unavailable for account %s: %v", accountID, err)
		s.emitRelationshipDecayForAccount(accountID, store, preferences)
		return nil
	}
	for _, candidate := range candidates {
		if s.ctx.Err() != nil {
			return nil
		}
		roomIDs, err := store.linkedRooms(candidate.ContactID)
		if err != nil {
			log.Printf("list chats for relationship contact %s: %v", candidate.ContactID, err)
			continue
		}
		ctx, cancel := context.WithTimeout(s.ctx, relationshipDecayTimeout)
		messages, err := loadRelationshipDecayMessages(ctx, client, roomIDs)
		if err != nil {
			cancel()
			log.Printf("read recent messages for relationship contact %s: %v", candidate.ContactID, err)
			continue
		}
		if len(messages) == 0 {
			cancel()
			continue
		}
		systemPrompt, userPrompt, err := buildRelationshipDecayPrompt(candidate.DisplayName, candidate.Tier, messages, tuning.Prompt)
		if err != nil {
			cancel()
			log.Printf("build relationship nudge prompt for contact %s: %v", candidate.ContactID, err)
			continue
		}
		completion, err := localRelationshipDecayCompletion(ctx, provider, endpoint, model, systemPrompt, userPrompt, tuning)
		cancel()
		if err != nil {
			log.Printf("generate local relationship nudge for contact %s: %v", candidate.ContactID, err)
			continue
		}
		nudge, err := parseRelationshipDecayNudge(completion, messages)
		if err != nil {
			log.Printf("reject relationship nudge for contact %s: %v", candidate.ContactID, err)
			continue
		}
		saved, err := store.saveDecayAlert(candidate, nudge, time.Now().UnixMilli(), time.Now())
		if err != nil {
			log.Printf("save relationship nudge for contact %s: %v", candidate.ContactID, err)
			continue
		}
		if !saved {
			continue
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

func loadRelationshipDecayMessages(ctx context.Context, client *matrix.Client, roomIDs []string) ([]relationshipHealthMessage, error) {
	if client == nil {
		return nil, errors.New("no active Matrix account")
	}
	rooms := make(map[string]matrix.Room)
	for _, room := range client.Rooms() {
		rooms[room.ID] = room
	}
	messages := make([]relationshipHealthMessage, 0, len(roomIDs)*relationshipDecayHistoryLimit)
	for _, roomID := range roomIDs {
		room, ok := rooms[roomID]
		if !ok || !room.Direct {
			continue
		}
		page, err := client.HistoryPageWithLimit(ctx, roomID, 0, relationshipDecayHistoryLimit)
		if err != nil {
			return nil, fmt.Errorf("read local relationship history for %s: %w", roomID, err)
		}
		for _, message := range page.Messages {
			if !eligibleRelationshipMessage(message) {
				continue
			}
			messages = append(messages, relationshipHealthMessage{
				RoomID:    roomID,
				MessageID: message.ID,
				Timestamp: message.Timestamp,
				Own:       message.Own,
				Text:      strings.TrimSpace(message.Body),
			})
		}
	}
	sort.SliceStable(messages, func(i, j int) bool {
		if messages[i].Timestamp.Equal(messages[j].Timestamp) {
			if messages[i].RoomID == messages[j].RoomID {
				return messages[i].MessageID < messages[j].MessageID
			}
			return messages[i].RoomID < messages[j].RoomID
		}
		return messages[i].Timestamp.Before(messages[j].Timestamp)
	})
	if len(messages) > relationshipDecayHistoryLimit {
		messages = messages[len(messages)-relationshipDecayHistoryLimit:]
	}
	return messages, nil
}

func buildRelationshipDecayPrompt(displayName, tier string, messages []relationshipHealthMessage, instructions string) (string, string, error) {
	type promptMessage struct {
		Speaker string `json:"speaker"`
		Text    string `json:"text"`
	}
	recent := make([]promptMessage, 0, len(messages))
	for _, message := range messages {
		speaker := "Contact"
		if message.Own {
			speaker = "You"
		}
		recent = append(recent, promptMessage{Speaker: speaker, Text: clipGhostwriterText(message.Text, 800)})
	}
	conversation, err := json.Marshal(recent)
	if err != nil {
		return "", "", fmt.Errorf("encode relationship conversation: %w", err)
	}
	contactJSON, err := json.Marshal(strings.TrimSpace(displayName))
	if err != nil {
		return "", "", fmt.Errorf("encode relationship contact name: %w", err)
	}
	systemPrompt := instructions
	userPrompt := "Contact name (JSON string): " + string(contactJSON) + "\nRelationship tier: " + tier + "\nRecent messages in chronological order (JSON): " + string(conversation) + "\nWrite one specific sentence, grounded in these messages."
	return systemPrompt, userPrompt, nil
}

func parseRelationshipDecayNudge(response string, messages []relationshipHealthMessage) (string, error) {
	response = strings.TrimSpace(response)
	if strings.HasPrefix(response, "```") {
		if firstLine := strings.IndexByte(response, '\n'); firstLine >= 0 {
			response = response[firstLine+1:]
		}
		response = strings.TrimSuffix(strings.TrimSpace(response), "```")
	}
	response = strings.TrimSpace(response)
	if len(response) >= 2 && ((response[0] == '"' && response[len(response)-1] == '"') || (response[0] == '\'' && response[len(response)-1] == '\'')) {
		response = strings.TrimSpace(response[1 : len(response)-1])
	}
	response = strings.Join(strings.Fields(response), " ")
	if response == "" {
		return "", errors.New("local model returned an empty nudge")
	}
	if utf8.RuneCountInString(response) > 280 {
		return "", errors.New("local model returned a nudge that is too long")
	}
	if relationshipDecaySentenceEndings(response) > 1 {
		return "", errors.New("local model returned more than one sentence")
	}
	if relationshipDecayGenericPhrase(response) {
		return "", errors.New("local model returned a generic elapsed-time nudge")
	}
	if !relationshipDecayReferencesContext(response, messages) {
		return "", errors.New("local model nudge did not reference a concrete conversation topic")
	}
	if relationshipDecaySentenceEndings(response) == 0 {
		response += "."
	}
	return response, nil
}

func relationshipDecaySentenceEndings(text string) int {
	return strings.Count(text, ".") + strings.Count(text, "?") + strings.Count(text, "!")
}

func relationshipDecayGenericPhrase(text string) bool {
	lower := strings.ToLower(text)
	for _, phrase := range []string{"it's been a while", "it has been a while", "haven't talked", "have not talked", "since we last spoke", "just checking in", "checking in after"} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func relationshipDecayReferencesContext(nudge string, messages []relationshipHealthMessage) bool {
	ignored := map[string]struct{}{
		"about": {}, "after": {}, "again": {}, "been": {}, "could": {}, "from": {}, "have": {}, "hello": {}, "hope": {},
		"just": {}, "like": {}, "maybe": {}, "more": {}, "that": {}, "then": {}, "there": {}, "these": {}, "they": {},
		"this": {}, "what": {}, "when": {}, "where": {}, "with": {}, "would": {}, "your": {}, "youre": {},
	}
	var conversation strings.Builder
	for _, message := range messages {
		conversation.WriteString(message.Text)
		conversation.WriteByte(' ')
	}
	contextTerms := relationshipDecayTerms(conversation.String())
	for term := range relationshipDecayTerms(nudge) {
		if len([]rune(term)) < 4 {
			continue
		}
		if _, skip := ignored[term]; skip {
			continue
		}
		if _, found := contextTerms[term]; found {
			return true
		}
	}
	return false
}

func relationshipDecayTerms(text string) map[string]struct{} {
	terms := make(map[string]struct{})
	var token strings.Builder
	flush := func() {
		if token.Len() == 0 {
			return
		}
		terms[strings.ToLower(token.String())] = struct{}{}
		token.Reset()
	}
	for _, character := range text {
		if unicode.IsLetter(character) || unicode.IsNumber(character) {
			token.WriteRune(character)
		} else {
			flush()
		}
	}
	flush()
	return terms
}

func localRelationshipDecayCompletion(ctx context.Context, provider GhostwriterProvider, endpoint *url.URL, model, systemPrompt, userPrompt string, tuning aiFeatureTuning) (string, error) {
	return runLocalAICompletion(ctx, ghostwriterHTTPClient, provider, endpoint, model, []AIMessage{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}}, aiCompletionOptions{
		Temperature: tuning.Temperature,
		MaxTokens:   tuning.MaxTokens,
	}, nil)
}
