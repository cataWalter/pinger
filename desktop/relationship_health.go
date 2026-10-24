package desktop

import (
	"errors"
	"fmt"
	"log"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"mychat/matrix"
)

const relationshipHealthRoomLimit = 8

type RelationshipHealthPoint struct {
	WindowDate     string  `json:"windowDate"`
	SentimentScore float64 `json:"sentimentScore"`
	Status         string  `json:"status"`
	Trend          string  `json:"trend"`
}

type RelationshipHealthSnapshot struct {
	AccountID              string                    `json:"accountId"`
	RoomID                 string                    `json:"roomId"`
	ContactID              string                    `json:"contactId"`
	LinkedRoomIDs          []string                  `json:"linkedRoomIds"`
	Enabled                bool                      `json:"enabled"`
	Analyzing              bool                      `json:"analyzing"`
	InsufficientData       bool                      `json:"insufficientData"`
	SevereTension          bool                      `json:"severeTension"`
	SentimentScore         float64                   `json:"sentimentScore"`
	Status                 string                    `json:"status"`
	Trend                  string                    `json:"trend"`
	DetectedFrictionPoints []string                  `json:"detectedFrictionPoints"`
	Reasoning              string                    `json:"reasoning"`
	UpdatedAt              int64                     `json:"updatedAt"`
	History                []RelationshipHealthPoint `json:"history"`
	Error                  string                    `json:"error"`
}

type relationshipHealthMessage struct {
	RoomID    string
	MessageID string
	Timestamp time.Time
	Own       bool
	Text      string
	Channel   string
}

func (s *AppService) RelationshipHealth(roomID string) (RelationshipHealthSnapshot, error) {
	accountID := s.currentAccountID()
	client := s.currentClient()
	room, err := relationshipRoom(client, roomID)
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	preferences := s.preferenceValuesForAccount(accountID)
	enabled, _ := preferences["relationship_health.enabled"].(bool)
	snapshot := RelationshipHealthSnapshot{
		AccountID:              accountID,
		RoomID:                 roomID,
		Enabled:                enabled,
		Status:                 "NEUTRAL",
		Trend:                  "STABLE",
		InsufficientData:       true,
		DetectedFrictionPoints: []string{},
		History:                []RelationshipHealthPoint{},
		LinkedRoomIDs:          []string{roomID},
	}
	store, err := s.relationshipHealthStoreForAccount(accountID)
	if err != nil {
		return snapshot, err
	}
	contactID, err := store.ensureContact(roomID, room.Name)
	if err != nil {
		return snapshot, err
	}
	linkedRooms, err := store.linkedRooms(contactID)
	if err != nil {
		return snapshot, err
	}
	rows, err := store.recentHealth(contactID, 28)
	if err != nil {
		return snapshot, err
	}
	snapshot = relationshipHealthSnapshot(accountID, roomID, contactID, linkedRooms, rows)
	snapshot.Enabled = enabled
	return snapshot, nil
}

func (s *AppService) LinkRelationshipContact(roomID, targetRoomID string) (RelationshipHealthSnapshot, error) {
	client := s.currentClient()
	if _, err := relationshipRoom(client, roomID); err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	if _, err := relationshipRoom(client, targetRoomID); err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	store, err := s.relationshipHealthStoreForAccount(s.currentAccountID())
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	firstID, err := store.ensureContact(roomID, "")
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	secondID, err := store.ensureContact(targetRoomID, "")
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	firstRooms, err := store.linkedRooms(firstID)
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	secondRooms, err := store.linkedRooms(secondID)
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	if len(firstRooms)+len(secondRooms) > relationshipHealthRoomLimit {
		return RelationshipHealthSnapshot{}, fmt.Errorf("a contact can link at most %d chats", relationshipHealthRoomLimit)
	}
	if err := store.linkRooms(roomID, targetRoomID); err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	return s.RelationshipHealth(roomID)
}

func (s *AppService) UnlinkRelationshipContact(roomID string) (RelationshipHealthSnapshot, error) {
	client := s.currentClient()
	room, err := relationshipRoom(client, roomID)
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	store, err := s.relationshipHealthStoreForAccount(s.currentAccountID())
	if err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	if err := store.unlinkRoom(roomID, room.Name); err != nil {
		return RelationshipHealthSnapshot{}, err
	}
	return s.RelationshipHealth(roomID)
}

func relationshipRoom(client *matrix.Client, roomID string) (matrix.Room, error) {
	if client == nil || strings.TrimSpace(roomID) == "" {
		return matrix.Room{}, errors.New("select a direct chat first")
	}
	for _, room := range client.Rooms() {
		if room.ID != roomID {
			continue
		}
		if !room.Direct {
			return matrix.Room{}, errors.New("relationship health is available for direct chats")
		}
		return room, nil
	}
	return matrix.Room{}, errors.New("the requested chat is not available in the active account")
}

func (s *AppService) relationshipHealthStoreForAccount(accountID string) (*relationshipHealthStore, error) {
	s.relationshipHealthMu.Lock()
	defer s.relationshipHealthMu.Unlock()
	if s.relationshipHealthStores == nil {
		s.relationshipHealthStores = make(map[string]*relationshipHealthStore)
	}
	if store := s.relationshipHealthStores[accountID]; store != nil {
		return store, nil
	}
	matrixPath, err := accountDatabasePath(s.dataDir, accountID)
	if err != nil {
		return nil, err
	}
	store, err := openRelationshipHealthStore(filepath.Join(filepath.Dir(matrixPath), "relationship-health.db"))
	if err != nil {
		return nil, err
	}
	s.relationshipHealthStores[accountID] = store
	return store, nil
}

func relationshipHealthSnapshot(accountID, roomID, contactID string, linkedRooms []string, rows []relationshipHealthRow) RelationshipHealthSnapshot {
	snapshot := RelationshipHealthSnapshot{
		AccountID:              accountID,
		RoomID:                 roomID,
		ContactID:              contactID,
		LinkedRoomIDs:          append([]string(nil), linkedRooms...),
		Enabled:                true,
		Status:                 "NEUTRAL",
		Trend:                  "STABLE",
		InsufficientData:       len(rows) == 0,
		DetectedFrictionPoints: []string{},
		History:                make([]RelationshipHealthPoint, 0, len(rows)),
	}
	for index := len(rows) - 1; index >= 0; index-- {
		row := rows[index]
		snapshot.History = append(snapshot.History, RelationshipHealthPoint{
			WindowDate:     row.WindowDate,
			SentimentScore: row.SentimentScore,
			Status:         row.Status,
			Trend:          row.Trend,
		})
	}
	if len(rows) == 0 {
		return snapshot
	}
	latest := rows[0]
	snapshot.SentimentScore = latest.SentimentScore
	snapshot.Status = latest.Status
	snapshot.Trend = latest.Trend
	snapshot.DetectedFrictionPoints = append([]string(nil), latest.DetectedFrictionPoints...)
	snapshot.Reasoning = latest.Reasoning
	snapshot.UpdatedAt = latest.UpdatedAt
	snapshot.InsufficientData = false
	snapshot.SevereTension = latest.Status == "COLD" || latest.Status == "TENSE" && latest.Trend == "DETERIORATING" && latest.SentimentScore <= -0.4
	return snapshot
}

func relationshipHealthJobKey(accountID, contactID string) string {
	return accountID + "\x00" + contactID
}

func relationshipModelSettings(preferences map[string]any) (GhostwriterProvider, *url.URL, string, error) {
	enabled, _ := preferences["relationship_health.enabled"].(bool)
	if !enabled {
		return "", nil, "", errors.New("enable relationship health in Settings > Integrations first")
	}
	providerValue, _ := preferences["ghostwriter.provider"].(string)
	provider := GhostwriterProvider(strings.TrimSpace(providerValue))
	if provider == "" {
		provider = GhostwriterProviderOllama
	}
	if provider != GhostwriterProviderOllama && provider != GhostwriterProviderOpenAICompatible {
		return "", nil, "", errors.New("choose a supported local relationship-health provider")
	}
	endpointValue, _ := preferences["ghostwriter.endpoint"].(string)
	if strings.TrimSpace(endpointValue) == "" {
		if provider == GhostwriterProviderOllama {
			endpointValue = ghostwriterDefaultOllamaURL
		} else {
			endpointValue = ghostwriterDefaultOpenAIURL
		}
	}
	endpoint, err := validateGhostwriterEndpoint(endpointValue)
	if err != nil {
		return "", nil, "", fmt.Errorf("invalid local relationship-health endpoint: %w", err)
	}
	model, _ := preferences["ghostwriter.model"].(string)
	model = strings.TrimSpace(model)
	if model == "" && provider == GhostwriterProviderOllama {
		model = ghostwriterDefaultOllamaModel
	}
	return provider, endpoint, model, nil
}

func eligibleRelationshipMessage(message matrix.Message) bool {
	return !message.Redacted && message.DecryptionError == "" && message.MediaURI == "" && !message.Sending && message.SendError == "" && strings.TrimSpace(message.Body) != ""
}

func (s *AppService) closeRelationshipHealthStores() {
	s.relationshipHealthMu.Lock()
	stores := s.relationshipHealthStores
	s.relationshipHealthStores = nil
	s.relationshipHealthMu.Unlock()
	for _, store := range stores {
		if err := store.close(); err != nil {
			log.Printf("close relationship health database: %v", err)
		}
	}
}
