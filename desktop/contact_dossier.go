package desktop

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"mychat/matrix"
)

const (
	contactDossierHistoryLimit = 30
	contactDossierMinMessages  = 3
	contactDossierTimeout      = 20 * time.Second
	contactDossierEventName    = "contact-dossier:update"
)

var contactDossierJSONSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"key_facts":{"type":"array","items":{"type":"string","maxLength":180},"maxItems":20},
		"last_recap":{"type":"string","maxLength":600},
		"unresolved_commitments":{"type":"array","items":{"type":"string","maxLength":180},"maxItems":16}
	},
	"required":["key_facts","last_recap","unresolved_commitments"],
	"additionalProperties":false
}`)

type ContactDossierSnapshot struct {
	AccountID             string   `json:"accountId"`
	RoomID                string   `json:"roomId"`
	ContactID             string   `json:"contactId"`
	DisplayName           string   `json:"displayName"`
	Tier                  string   `json:"tier"`
	LinkedChannels        []string `json:"linkedChannels"`
	LinkedRoomIDs         []string `json:"linkedRoomIds"`
	Enabled               bool     `json:"enabled"`
	Analyzing             bool     `json:"analyzing"`
	InsufficientData      bool     `json:"insufficientData"`
	KeyFacts              []string `json:"keyFacts"`
	LastRecap             string   `json:"lastRecap"`
	UnresolvedCommitments []string `json:"unresolvedCommitments"`
	UpdatedAt             int64    `json:"updatedAt"`
	Error                 string   `json:"error"`
}

type contactDossierCache struct {
	ContactID                    string
	KeyFacts                     []string
	LastRecap                    string
	UnresolvedCommitments        []string
	LastAnalyzedMessageID        string
	LastAnalyzedMessageTimestamp int64
	UpdatedAt                    int64
}

type contactDossierResult struct {
	KeyFacts              []string `json:"key_facts"`
	LastRecap             string   `json:"last_recap"`
	UnresolvedCommitments []string `json:"unresolved_commitments"`
}

type contactDossierPromptMessage struct {
	Channel   string `json:"channel"`
	Speaker   string `json:"speaker"`
	Timestamp string `json:"timestamp"`
	Text      string `json:"text"`
}

func (s *AppService) ContactDossier(roomID string) (ContactDossierSnapshot, error) {
	return s.contactDossier(roomID, false)
}

func (s *AppService) RefreshContactDossier(roomID string) (ContactDossierSnapshot, error) {
	return s.contactDossier(roomID, true)
}

func (s *AppService) contactDossier(roomID string, force bool) (ContactDossierSnapshot, error) {
	accountID := s.currentAccountID()
	client := s.currentClient()
	room, err := relationshipRoom(client, roomID)
	if err != nil {
		return ContactDossierSnapshot{}, err
	}
	store, err := s.relationshipHealthStoreForAccount(accountID)
	if err != nil {
		return ContactDossierSnapshot{}, err
	}
	contactID, err := store.ensureContact(room.ID, room.Name)
	if err != nil {
		return ContactDossierSnapshot{}, err
	}
	roomIDs, err := store.linkedRooms(contactID)
	if err != nil {
		return ContactDossierSnapshot{}, err
	}
	preferences := s.preferenceValuesForAccount(accountID)
	enabled, _ := preferences["relationship_health.enabled"].(bool)
	snapshot, err := contactDossierSnapshot(accountID, roomID, contactID, roomIDs, client, store, enabled)
	if err != nil {
		return ContactDossierSnapshot{}, err
	}
	if !enabled || !force {
		return snapshot, nil
	}
	snapshot.Analyzing = s.startContactDossierAnalysis(accountID, roomID, contactID, roomIDs, client, store)
	return snapshot, nil
}

func contactDossierSnapshot(accountID, roomID, contactID string, roomIDs []string, client *matrix.Client, store *relationshipHealthStore, enabled bool) (ContactDossierSnapshot, error) {
	var snapshot ContactDossierSnapshot
	snapshot.AccountID = accountID
	snapshot.RoomID = roomID
	snapshot.ContactID = contactID
	snapshot.Enabled = enabled
	snapshot.LinkedChannels = linkedDossierChannels(client, roomIDs)
	snapshot.LinkedRoomIDs = append([]string(nil), roomIDs...)
	snapshot.KeyFacts = []string{}
	snapshot.UnresolvedCommitments = []string{}
	if err := store.db.QueryRow(`SELECT display_name, tier FROM contacts WHERE contact_id = ?`, contactID).Scan(&snapshot.DisplayName, &snapshot.Tier); err != nil {
		return snapshot, fmt.Errorf("read dossier contact: %w", err)
	}
	cache, found, err := store.readContactDossier(contactID)
	if err != nil {
		return snapshot, err
	}
	if found {
		snapshot.KeyFacts = cache.KeyFacts
		snapshot.LastRecap = cache.LastRecap
		snapshot.UnresolvedCommitments = cache.UnresolvedCommitments
		snapshot.UpdatedAt = cache.UpdatedAt
	}
	return snapshot, nil
}

func linkedDossierChannels(client *matrix.Client, roomIDs []string) []string {
	if client == nil {
		return []string{}
	}
	linked := make(map[string]struct{}, len(roomIDs))
	for _, room := range client.Rooms() {
		if !room.Direct || !containsString(roomIDs, room.ID) {
			continue
		}
		channel := strings.TrimSpace(room.Bridge)
		if channel == "" {
			channel = "Matrix"
		}
		linked[channel] = struct{}{}
	}
	channels := make([]string, 0, len(linked))
	for channel := range linked {
		channels = append(channels, channel)
	}
	sort.Strings(channels)
	return channels
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

type contactDossierQueryer interface {
	QueryRow(query string, args ...any) *sql.Row
}

type contactDossierExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func (s *relationshipHealthStore) readContactDossier(contactID string) (contactDossierCache, bool, error) {
	return readContactDossierFrom(s.db, contactID)
}

func readContactDossierFrom(queryer contactDossierQueryer, contactID string) (contactDossierCache, bool, error) {
	var cache contactDossierCache
	var keyFactsJSON, commitmentsJSON string
	err := queryer.QueryRow(`
		SELECT key_facts, last_recap, unresolved_commitments, last_analyzed_message_id,
			last_analyzed_message_timestamp, updated_at
		FROM dossier_cache WHERE contact_id = ?
	`, contactID).Scan(&keyFactsJSON, &cache.LastRecap, &commitmentsJSON, &cache.LastAnalyzedMessageID, &cache.LastAnalyzedMessageTimestamp, &cache.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return contactDossierCache{ContactID: contactID, KeyFacts: []string{}, UnresolvedCommitments: []string{}}, false, nil
	}
	if err != nil {
		return contactDossierCache{}, false, fmt.Errorf("read contact dossier: %w", err)
	}
	if err := json.Unmarshal([]byte(keyFactsJSON), &cache.KeyFacts); err != nil {
		return contactDossierCache{}, false, fmt.Errorf("decode dossier key facts: %w", err)
	}
	if err := json.Unmarshal([]byte(commitmentsJSON), &cache.UnresolvedCommitments); err != nil {
		return contactDossierCache{}, false, fmt.Errorf("decode dossier commitments: %w", err)
	}
	cache.ContactID = contactID
	if cache.KeyFacts == nil {
		cache.KeyFacts = []string{}
	}
	if cache.UnresolvedCommitments == nil {
		cache.UnresolvedCommitments = []string{}
	}
	return cache, true, nil
}

func (s *relationshipHealthStore) saveContactDossier(cache contactDossierCache) error {
	return saveContactDossierWith(s.db, cache)
}

func saveContactDossierWith(execer contactDossierExecer, cache contactDossierCache) error {
	keyFactsJSON, err := json.Marshal(cache.KeyFacts)
	if err != nil {
		return fmt.Errorf("encode dossier key facts: %w", err)
	}
	commitmentsJSON, err := json.Marshal(cache.UnresolvedCommitments)
	if err != nil {
		return fmt.Errorf("encode dossier commitments: %w", err)
	}
	_, err = execer.Exec(`
		INSERT INTO dossier_cache (
			contact_id, key_facts, last_recap, unresolved_commitments,
			last_analyzed_message_id, last_analyzed_message_timestamp, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(contact_id) DO UPDATE SET
			key_facts = excluded.key_facts,
			last_recap = excluded.last_recap,
			unresolved_commitments = excluded.unresolved_commitments,
			last_analyzed_message_id = excluded.last_analyzed_message_id,
			last_analyzed_message_timestamp = excluded.last_analyzed_message_timestamp,
			updated_at = excluded.updated_at
	`, cache.ContactID, string(keyFactsJSON), cache.LastRecap, string(commitmentsJSON), cache.LastAnalyzedMessageID, cache.LastAnalyzedMessageTimestamp, cache.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save contact dossier: %w", err)
	}
	return nil
}

func (s *relationshipHealthStore) saveContactDossierForLinkedRooms(contactID, roomID string, roomIDs []string, cache contactDossierCache) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var currentContactID string
	err = tx.QueryRow(`SELECT contact_id FROM contact_room_links WHERE room_id = ?`, roomID).Scan(&currentContactID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("verify dossier contact link: %w", err)
	}
	if currentContactID != contactID {
		return false, nil
	}
	rows, err := tx.Query(`SELECT room_id FROM contact_room_links WHERE contact_id = ? ORDER BY room_id`, contactID)
	if err != nil {
		return false, fmt.Errorf("verify dossier linked rooms: %w", err)
	}
	currentRoomIDs := make([]string, 0)
	for rows.Next() {
		var linkedRoomID string
		if err := rows.Scan(&linkedRoomID); err != nil {
			_ = rows.Close()
			return false, err
		}
		currentRoomIDs = append(currentRoomIDs, linkedRoomID)
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	if !sameDossierRoomIDs(currentRoomIDs, roomIDs) {
		return false, nil
	}
	if err := saveContactDossierWith(tx, cache); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit contact dossier: %w", err)
	}
	return true, nil
}

func sameDossierRoomIDs(first, second []string) bool {
	if len(first) != len(second) {
		return false
	}
	firstCopy := append([]string(nil), first...)
	secondCopy := append([]string(nil), second...)
	sort.Strings(firstCopy)
	sort.Strings(secondCopy)
	for index := range firstCopy {
		if firstCopy[index] != secondCopy[index] {
			return false
		}
	}
	return true
}

func mergeContactDossierCachesTx(tx *sql.Tx, targetID, sourceID string) error {
	target, targetFound, err := readContactDossierFrom(tx, targetID)
	if err != nil {
		return err
	}
	source, sourceFound, err := readContactDossierFrom(tx, sourceID)
	if err != nil || !sourceFound {
		return err
	}
	if !targetFound {
		source.ContactID = targetID
		if err := saveContactDossierWith(tx, source); err != nil {
			return err
		}
		return nil
	}
	older, newer := source, target
	if source.UpdatedAt > target.UpdatedAt {
		older, newer = target, source
	}
	merged := newer
	merged.ContactID = targetID
	merged.KeyFacts = mergeDossierFacts(older.KeyFacts, newer.KeyFacts)
	merged.UnresolvedCommitments = normalizeDossierStrings(append(append([]string{}, older.UnresolvedCommitments...), newer.UnresolvedCommitments...), 16, 180)
	if merged.LastRecap == "" {
		merged.LastRecap = older.LastRecap
	}
	return saveContactDossierWith(tx, merged)
}

func (s *AppService) startContactDossierAnalysis(accountID, roomID, contactID string, roomIDs []string, client *matrix.Client, store *relationshipHealthStore) bool {
	key := relationshipHealthJobKey(accountID, contactID)
	s.relationshipHealthMu.Lock()
	if s.ctx == nil || s.ctx.Err() != nil {
		s.relationshipHealthMu.Unlock()
		return false
	}
	if s.contactDossierJobs == nil {
		s.contactDossierJobs = make(map[string]bool)
	}
	if s.contactDossierJobs[key] {
		s.relationshipHealthMu.Unlock()
		return true
	}
	s.contactDossierJobs[key] = true
	s.workers.Add(1)
	s.relationshipHealthMu.Unlock()

	go func() {
		defer s.workers.Done()
		defer func() {
			s.relationshipHealthMu.Lock()
			delete(s.contactDossierJobs, key)
			s.relationshipHealthMu.Unlock()
		}()
		s.processContactDossier(accountID, roomID, contactID, roomIDs, client, store)
	}()
	return true
}

func (s *AppService) processContactDossier(accountID, roomID, contactID string, roomIDs []string, client *matrix.Client, store *relationshipHealthStore) {
	ctx, cancel := context.WithTimeout(s.aiContext(), contactDossierTimeout)
	defer cancel()
	cache, found, err := store.readContactDossier(contactID)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	if !found {
		cache = contactDossierCache{ContactID: contactID, KeyFacts: []string{}, UnresolvedCommitments: []string{}}
	}
	messages, err := loadContactDossierMessages(ctx, client, roomIDs)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	if len(messages) < contactDossierMinMessages {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, false, true, nil)
		return
	}
	preferences := s.preferenceValuesForAccount(accountID)
	provider, endpoint, model, err := relationshipModelSettings(preferences)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	tuning := aiFeatureTuningFor(preferences, aiFeatureContactDossier)
	systemPrompt, userPrompt, err := buildContactDossierPrompt(cache, messages, tuning.Prompt)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	completion, err := localContactDossierCompletion(ctx, provider, endpoint, model, systemPrompt, userPrompt, tuning)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	result, err := parseContactDossierResult(completion)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	cache = mergeContactDossier(cache, result)
	latest := messages[len(messages)-1]
	cache.ContactID = contactID
	cache.LastAnalyzedMessageID = latest.MessageID
	cache.LastAnalyzedMessageTimestamp = latest.Timestamp.UnixMilli()
	cache.UpdatedAt = time.Now().UnixMilli()
	saved, err := store.saveContactDossierForLinkedRooms(contactID, roomID, roomIDs, cache)
	if err != nil {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, true, false, err)
		return
	}
	if !saved {
		s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, false, false, nil)
		return
	}
	s.emitContactDossierResult(accountID, roomID, contactID, roomIDs, client, store, false, false, nil)
}

func (s *AppService) emitContactDossierResult(accountID, roomID, contactID string, roomIDs []string, client *matrix.Client, store *relationshipHealthStore, analyzing, insufficient bool, resultError error) {
	var currentContactID string
	if err := store.db.QueryRow(`SELECT contact_id FROM contact_room_links WHERE room_id = ?`, roomID).Scan(&currentContactID); err == nil {
		contactID = currentContactID
		if currentRoomIDs, err := store.linkedRooms(contactID); err == nil {
			roomIDs = currentRoomIDs
		}
	}
	enabled, _ := s.preferenceValuesForAccount(accountID)["relationship_health.enabled"].(bool)
	snapshot, err := contactDossierSnapshot(accountID, roomID, contactID, roomIDs, client, store, enabled)
	if err != nil {
		if resultError == nil {
			resultError = err
		}
		snapshot = ContactDossierSnapshot{AccountID: accountID, RoomID: roomID, ContactID: contactID, Enabled: enabled, LinkedChannels: []string{}, LinkedRoomIDs: []string{}, KeyFacts: []string{}, UnresolvedCommitments: []string{}}
	}
	snapshot.Analyzing = analyzing
	snapshot.InsufficientData = insufficient
	if resultError != nil {
		snapshot.Error = resultError.Error()
	}
	if s.emitContactDossier != nil {
		s.emitContactDossier(snapshot)
	}
}

func loadContactDossierMessages(ctx context.Context, client *matrix.Client, roomIDs []string) ([]relationshipHealthMessage, error) {
	if client == nil {
		return nil, errors.New("no active Matrix account")
	}
	rooms := make(map[string]matrix.Room)
	for _, room := range client.Rooms() {
		rooms[room.ID] = room
	}
	messages := make([]relationshipHealthMessage, 0, len(roomIDs)*contactDossierHistoryLimit)
	for _, roomID := range roomIDs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		room, ok := rooms[roomID]
		if !ok || !room.Direct {
			continue
		}
		page, err := client.HistoryPageWithLimit(ctx, roomID, 0, contactDossierHistoryLimit)
		if err != nil {
			return nil, fmt.Errorf("read local dossier history for %s: %w", roomID, err)
		}
		for _, message := range page.Messages {
			if !eligibleRelationshipMessage(message) {
				continue
			}
			messageID := message.ID
			if messageID == "" || strings.HasPrefix(messageID, "~") {
				messageID = message.TransactionID
			}
			if messageID == "" || strings.HasPrefix(messageID, "~") {
				continue
			}
			channel := strings.TrimSpace(room.Bridge)
			if channel == "" {
				channel = "Matrix"
			}
			messages = append(messages, relationshipHealthMessage{
				RoomID: roomID, MessageID: messageID, Timestamp: message.Timestamp,
				Own: message.Own, Text: strings.TrimSpace(message.Body), Channel: channel,
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
	if len(messages) > contactDossierHistoryLimit {
		messages = messages[len(messages)-contactDossierHistoryLimit:]
	}
	return messages, nil
}

func buildContactDossierPrompt(existing contactDossierCache, messages []relationshipHealthMessage, instructions string) (string, string, error) {
	promptMessages := make([]contactDossierPromptMessage, 0, len(messages))
	for _, message := range messages {
		speaker := "Contact"
		if message.Own {
			speaker = "You"
		}
		promptMessages = append(promptMessages, contactDossierPromptMessage{
			Channel: message.Channel, Speaker: speaker,
			Timestamp: message.Timestamp.UTC().Format(time.RFC3339), Text: clipGhostwriterText(message.Text, 1200),
		})
	}
	input, err := json.Marshal(struct {
		Existing struct {
			KeyFacts              []string `json:"key_facts"`
			LastRecap             string   `json:"last_recap"`
			UnresolvedCommitments []string `json:"unresolved_commitments"`
		} `json:"existing_dossier"`
		Messages []contactDossierPromptMessage `json:"recent_messages"`
	}{Existing: struct {
		KeyFacts              []string `json:"key_facts"`
		LastRecap             string   `json:"last_recap"`
		UnresolvedCommitments []string `json:"unresolved_commitments"`
	}{KeyFacts: existing.KeyFacts, LastRecap: existing.LastRecap, UnresolvedCommitments: existing.UnresolvedCommitments}, Messages: promptMessages})
	if err != nil {
		return "", "", fmt.Errorf("encode contact dossier prompt: %w", err)
	}
	systemPrompt := instructions
	return systemPrompt, string(input), nil
}

func mergeContactDossier(existing contactDossierCache, update contactDossierResult) contactDossierCache {
	existing.KeyFacts = mergeDossierFacts(existing.KeyFacts, update.KeyFacts)
	if strings.TrimSpace(update.LastRecap) != "" {
		existing.LastRecap = strings.TrimSpace(update.LastRecap)
	}
	if update.UnresolvedCommitments != nil {
		existing.UnresolvedCommitments = normalizeDossierStrings(update.UnresolvedCommitments, 16, 180)
	}
	return existing
}

func mergeDossierFacts(existing, updates []string) []string {
	merged := normalizeDossierStrings(existing, 20, 180)
	indices := make(map[string]int, len(merged))
	for index, fact := range merged {
		if label, _, ok := strings.Cut(fact, ":"); ok {
			label = strings.ToLower(strings.TrimSpace(label))
			if label != "" {
				indices[label] = index
			}
		}
	}
	for _, fact := range normalizeDossierStrings(updates, 20, 180) {
		label, _, labeled := strings.Cut(fact, ":")
		key := strings.ToLower(strings.TrimSpace(label))
		if labeled && key != "" {
			if index, exists := indices[key]; exists {
				merged[index] = fact
				continue
			}
			indices[key] = len(merged)
		}
		merged = appendUniqueDossierString(merged, fact, 20)
	}
	return merged
}

func normalizeDossierStrings(values []string, limit, maxRunes int) []string {
	result := make([]string, 0, min(len(values), limit))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > maxRunes {
			value = string([]rune(value)[:maxRunes])
		}
		result = appendUniqueDossierString(result, value, limit)
		if len(result) == limit {
			break
		}
	}
	return result
}

func appendUniqueDossierString(values []string, value string, limit int) []string {
	for _, existing := range values {
		if strings.EqualFold(existing, value) {
			return values
		}
	}
	if len(values) >= limit {
		return values
	}
	return append(values, value)
}

func parseContactDossierResult(response string) (contactDossierResult, error) {
	var result contactDossierResult
	decoder := json.NewDecoder(strings.NewReader(response))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, fmt.Errorf("decode contact dossier JSON: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return result, errors.New("contact dossier response contains trailing data")
	}
	if result.KeyFacts == nil || result.LastRecap == "" || result.UnresolvedCommitments == nil {
		return result, errors.New("contact dossier response is missing required fields")
	}
	if len(result.KeyFacts) > 20 || len(result.UnresolvedCommitments) > 16 || utf8.RuneCountInString(result.LastRecap) > 600 {
		return result, errors.New("contact dossier response exceeds output limits")
	}
	for _, fact := range result.KeyFacts {
		if utf8.RuneCountInString(strings.TrimSpace(fact)) > 180 {
			return result, errors.New("contact dossier fact exceeds output limit")
		}
	}
	for _, commitment := range result.UnresolvedCommitments {
		if utf8.RuneCountInString(strings.TrimSpace(commitment)) > 180 {
			return result, errors.New("contact dossier commitment exceeds output limit")
		}
	}
	result.KeyFacts = normalizeDossierStrings(result.KeyFacts, 20, 180)
	result.LastRecap = strings.TrimSpace(result.LastRecap)
	result.UnresolvedCommitments = normalizeDossierStrings(result.UnresolvedCommitments, 16, 180)
	return result, nil
}

func localContactDossierCompletion(ctx context.Context, provider GhostwriterProvider, endpoint *url.URL, model, systemPrompt, userPrompt string, tuning aiFeatureTuning) (string, error) {
	return runLocalAICompletion(ctx, ghostwriterHTTPClient, provider, endpoint, model, []AIMessage{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}}, aiCompletionOptions{
		Temperature:    tuning.Temperature,
		MaxTokens:      tuning.MaxTokens,
		JSONSchemaName: "contact_dossier",
		JSONSchema:     contactDossierJSONSchema,
	}, nil)
}
