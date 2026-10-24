package desktop

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"mychat/matrix"
	sharedpreferences "mychat/preferences"
)

const (
	ghostwriterHistoryLimit       = 200
	ghostwriterStyleSampleLimit   = 40
	ghostwriterConversationLimit  = 10
	ghostwriterExampleLimit       = 5
	ghostwriterChatHistoryLimit   = 40
	localAIChatMessageLimit       = 48000
	localAIChatInputLimit         = 512 << 10
	localAIChatImageLimit         = 4
	localAIChatImageBytes         = 8 << 20
	localAIChatImageInputLimit    = 16 << 20
	localAIChatAgentLimit         = 8000
	localAIChatResponseBytes      = 256 << 10
	ghostwriterMaxResponseBytes   = 64 << 10
	ghostwriterSuggestionTimeout  = 20 * time.Second
	ghostwriterChatTimeout        = 10 * time.Minute
	ghostwriterStreamEventName    = "ghostwriter:stream"
	localAIChatStreamEventName    = "local-ai:stream"
	ghostwriterDefaultOllamaURL   = "http://127.0.0.1:11434"
	ghostwriterDefaultOpenAIURL   = "http://127.0.0.1:8080"
	ghostwriterDefaultOllamaModel = "qwen2.5:3b"
)

var ghostwriterStopSequences = []string{"\n\nUser:", "\n\nAssistant:", "User:", "Assistant:"}

var ghostwriterHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy:       nil,
		DialContext: dialGhostwriterLoopback,
	},
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func dialGhostwriterLoopback(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid local Ghostwriter address: %w", err)
	}
	var addresses []net.IPAddr
	if ip := net.ParseIP(host); ip != nil {
		addresses = []net.IPAddr{{IP: ip}}
	} else {
		addresses, err = net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("resolve local Ghostwriter address: %w", err)
		}
	}
	if len(addresses) == 0 {
		return nil, errors.New("local Ghostwriter address resolved to no IPs")
	}
	for _, address := range addresses {
		if !address.IP.IsLoopback() {
			return nil, errors.New("local Ghostwriter address resolved outside loopback")
		}
	}

	dialer := net.Dialer{}
	var lastErr error
	for _, address := range addresses {
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	return nil, fmt.Errorf("connect to local Ghostwriter endpoint: %w", lastErr)
}

type GhostwriterMode string

const (
	GhostwriterModeChips        GhostwriterMode = "chips"
	GhostwriterModeAutocomplete GhostwriterMode = "autocomplete"
	GhostwriterModeSlash        GhostwriterMode = "slash"
	GhostwriterModeChat         GhostwriterMode = "chat"
)

type GhostwriterProvider string

const (
	GhostwriterProviderOllama           GhostwriterProvider = "ollama"
	GhostwriterProviderOpenAICompatible GhostwriterProvider = "openai-compatible"
)

type GhostwriterRequest struct {
	RoomID         string          `json:"roomId"`
	RequestID      string          `json:"requestId,omitempty"`
	Mode           GhostwriterMode `json:"mode"`
	Draft          string          `json:"draft"`
	Intent         string          `json:"intent"`
	TargetLanguage string          `json:"targetLanguage,omitempty"`
}

type GhostwriterStreamEvent struct {
	RequestID string `json:"requestId"`
	RoomID    string `json:"roomId"`
	Text      string `json:"text"`
}

type LocalAIChatStreamEvent struct {
	RequestID string `json:"requestId"`
	Text      string `json:"text"`
}

type GhostSuggestion struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Label string `json:"label,omitempty"`
	Text  string `json:"text"`
}

type ghostwriterChipItem struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type MessageContext struct {
	ContactID   string                `json:"contactId"`
	ContactName string                `json:"contactName"`
	Platform    string                `json:"platform"`
	Messages    []MessageContextEntry `json:"messages"`
}

type MessageContextEntry struct {
	Sender    string `json:"sender"`
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
	Own       bool   `json:"own"`
}

type EmojiFrequency struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type UserStyleProfile struct {
	SampleCount             int              `json:"sampleCount"`
	Casing                  string           `json:"casing"`
	LowercaseRate           float64          `json:"lowercaseRate"`
	NoFinalPunctuationRate  float64          `json:"noFinalPunctuationRate"`
	PeriodRate              float64          `json:"periodRate"`
	EllipsisRate            float64          `json:"ellipsisRate"`
	ExclamationRate         float64          `json:"exclamationRate"`
	QuestionRate            float64          `json:"questionRate"`
	Emojis                  []EmojiFrequency `json:"emojis"`
	AverageWordCount        float64          `json:"averageWordCount"`
	AverageMessagesPerBurst float64          `json:"averageMessagesPerBurst"`
	FormalityScore          float64          `json:"formalityScore"`
}

type StylometryService struct{}

func (StylometryService) Profile(messages []matrix.Message) UserStyleProfile {
	eligible := make([]matrix.Message, 0, len(messages))
	for _, message := range messages {
		if eligibleGhostwriterMessage(message) {
			eligible = append(eligible, message)
		}
	}
	if len(eligible) > ghostwriterStyleSampleLimit {
		eligible = eligible[len(eligible)-ghostwriterStyleSampleLimit:]
	}
	profile := UserStyleProfile{SampleCount: len(eligible), Emojis: []EmojiFrequency{}}
	if len(eligible) == 0 {
		profile.Casing = "not enough examples; use natural sentence case"
		profile.FormalityScore = 0.5
		return profile
	}

	var letterCount, lowercaseCount, wordCount, formalMarkers, casualMarkers int
	var noPunctuation, periods, ellipses, exclamations, questions int
	emojiCounts := make(map[string]int)
	for _, message := range eligible {
		text := strings.TrimSpace(message.Body)
		for _, char := range text {
			if !unicode.IsLetter(char) {
				continue
			}
			letterCount++
			if unicode.IsLower(char) {
				lowercaseCount++
			}
		}
		wordCount += len(strings.Fields(text))
		punctuation := terminalPunctuation(text)
		switch punctuation {
		case "none":
			noPunctuation++
		case "period":
			periods++
		case "ellipsis":
			ellipses++
		case "exclamation":
			exclamations++
		case "question":
			questions++
		}
		for emoji, count := range countEmojis(text) {
			emojiCounts[emoji] += count
		}
		formal, casual := countFormalityMarkers(text)
		formalMarkers += formal
		casualMarkers += casual
	}

	count := float64(len(eligible))
	if letterCount > 0 {
		profile.LowercaseRate = float64(lowercaseCount) / float64(letterCount)
	}
	switch {
	case profile.LowercaseRate >= 0.78:
		profile.Casing = "mostly lowercase"
	case profile.LowercaseRate <= 0.35:
		profile.Casing = "frequent capitalization"
	default:
		profile.Casing = "sentence case"
	}
	profile.NoFinalPunctuationRate = float64(noPunctuation) / count
	profile.PeriodRate = float64(periods) / count
	profile.EllipsisRate = float64(ellipses) / count
	profile.ExclamationRate = float64(exclamations) / count
	profile.QuestionRate = float64(questions) / count
	profile.AverageWordCount = float64(wordCount) / count
	profile.AverageMessagesPerBurst = averageMessagesPerBurst(eligible)
	if formalMarkers+casualMarkers > 0 {
		profile.FormalityScore = float64(formalMarkers) / float64(formalMarkers+casualMarkers)
	} else {
		profile.FormalityScore = 0.5
	}
	profile.Emojis = mostFrequentEmojis(emojiCounts, 5)
	return profile
}

func eligibleGhostwriterMessage(message matrix.Message) bool {
	return message.Own && !message.Sending && message.SendError == "" && !message.Redacted &&
		message.DecryptionError == "" && message.MediaURI == "" && strings.TrimSpace(message.Body) != ""
}

func recentGhostwriterMessages(messages []matrix.Message, limit int) []matrix.Message {
	if limit <= 0 {
		return nil
	}
	conversation := make([]matrix.Message, 0, limit)
	for _, message := range messages {
		if message.Redacted || message.DecryptionError != "" || message.MediaURI != "" || strings.TrimSpace(message.Body) == "" {
			continue
		}
		conversation = append(conversation, message)
	}
	if len(conversation) > limit {
		conversation = conversation[len(conversation)-limit:]
	}
	return conversation
}

func terminalPunctuation(text string) string {
	text = strings.TrimSpace(text)
	text = strings.TrimRightFunc(text, func(char rune) bool {
		return unicode.IsSpace(char) || isEmojiBase(char) || isEmojiModifier(char) || isEmojiTag(char) ||
			char == '\ufe0f' || char == '\ufe0e' || char == '\u20e3' || char == '\u200d'
	})
	switch {
	case strings.HasSuffix(text, "...") || strings.HasSuffix(text, "…"):
		return "ellipsis"
	case strings.HasSuffix(text, "."):
		return "period"
	case strings.HasSuffix(text, "!"):
		return "exclamation"
	case strings.HasSuffix(text, "?"):
		return "question"
	default:
		return "none"
	}
}

func countFormalityMarkers(text string) (formal, casual int) {
	formalWords := map[string]struct{}{"please": {}, "thank": {}, "thanks": {}, "kindly": {}, "would": {}, "could": {}, "regards": {}}
	casualWords := map[string]struct{}{"lol": {}, "lmao": {}, "idk": {}, "imo": {}, "gonna": {}, "wanna": {}, "nah": {}, "yep": {}, "yup": {}}
	for _, word := range strings.Fields(strings.ToLower(text)) {
		word = strings.Trim(word, ".,!?;:'\"()[]{}")
		if _, ok := formalWords[word]; ok {
			formal++
		}
		if _, ok := casualWords[word]; ok {
			casual++
		}
	}
	return formal, casual
}

func averageMessagesPerBurst(messages []matrix.Message) float64 {
	if len(messages) == 0 {
		return 0
	}
	ordered := append([]matrix.Message(nil), messages...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Timestamp.Before(ordered[j].Timestamp) })
	bursts := 1
	for index := 1; index < len(ordered); index++ {
		if ordered[index].Timestamp.Sub(ordered[index-1].Timestamp) > 2*time.Minute {
			bursts++
		}
	}
	return float64(len(ordered)) / float64(bursts)
}

func countEmojis(text string) map[string]int {
	runes := []rune(text)
	counts := make(map[string]int)
	for index := 0; index < len(runes); {
		if !isEmojiBase(runes[index]) {
			index++
			continue
		}
		start := index
		index++
		if isRegionalIndicator(runes[start]) && index < len(runes) && isRegionalIndicator(runes[index]) {
			index++
		}
		for index < len(runes) {
			char := runes[index]
			switch {
			case char == '\ufe0f' || char == '\ufe0e' || char == '\u20e3' || isEmojiModifier(char) || isEmojiTag(char):
				index++
			case char == '\u200d' && index+1 < len(runes) && isEmojiBase(runes[index+1]):
				index += 2
			default:
				goto emojiComplete
			}
		}
	emojiComplete:
		counts[string(runes[start:index])]++
	}
	return counts
}

func isEmojiBase(char rune) bool {
	return isRegionalIndicator(char) ||
		(char >= 0x1f000 && char <= 0x1faff) ||
		(char >= 0x2600 && char <= 0x27ff) ||
		(char >= 0x2300 && char <= 0x23ff)
}

func isRegionalIndicator(char rune) bool { return char >= 0x1f1e6 && char <= 0x1f1ff }
func isEmojiModifier(char rune) bool     { return char >= 0x1f3fb && char <= 0x1f3ff }
func isEmojiTag(char rune) bool          { return char >= 0xe0020 && char <= 0xe007f }

func mostFrequentEmojis(counts map[string]int, limit int) []EmojiFrequency {
	emojis := make([]EmojiFrequency, 0, len(counts))
	for emoji, count := range counts {
		emojis = append(emojis, EmojiFrequency{Emoji: emoji, Count: count})
	}
	sort.Slice(emojis, func(i, j int) bool {
		if emojis[i].Count == emojis[j].Count {
			return emojis[i].Emoji < emojis[j].Emoji
		}
		return emojis[i].Count > emojis[j].Count
	})
	if len(emojis) > limit {
		emojis = emojis[:limit]
	}
	return emojis
}

func (s *AppService) Ghostwriter(request GhostwriterRequest) ([]GhostSuggestion, error) {
	if err := validateGhostwriterRequest(request); err != nil {
		return nil, err
	}
	preferences := s.preferenceValues()
	enabled, _ := preferences["ghostwriter.enabled"].(bool)
	if !enabled {
		return nil, errors.New("enable Ghostwriter in Settings > AI first")
	}
	provider, localEndpoint, model, err := ghostwriterModelConfig(preferences)
	if err != nil {
		return nil, err
	}

	client := s.currentClient()
	if client == nil {
		return nil, errors.New("no active Matrix account")
	}
	var selectedRoom *matrix.Room
	for _, room := range client.Rooms() {
		if room.ID == request.RoomID {
			roomCopy := room
			selectedRoom = &roomCopy
			break
		}
	}
	if selectedRoom == nil {
		return nil, errors.New("the requested chat is not available in the active account")
	}

	ctx, cancel := context.WithTimeout(s.aiContext(), ghostwriterSuggestionTimeout)
	defer cancel()
	page, err := client.HistoryPageWithLimit(ctx, request.RoomID, 0, ghostwriterHistoryLimit)
	if err != nil {
		return nil, fmt.Errorf("read local chat history: %w", err)
	}

	conversationLimit := ghostwriterConversationLimit
	exampleLimit := ghostwriterExampleLimit
	messageTextLimit := 2000
	exampleTextLimit := 1200
	if request.Mode == GhostwriterModeAutocomplete {
		exampleLimit = 2
		messageTextLimit = 600
		exampleTextLimit = 400
	}
	styleMessages := make([]matrix.Message, 0, ghostwriterStyleSampleLimit)
	conversationMessages := recentGhostwriterMessages(page.Messages, conversationLimit)
	for _, message := range page.Messages {
		if eligibleGhostwriterMessage(message) {
			styleMessages = append(styleMessages, message)
		}
	}
	if len(styleMessages) > ghostwriterStyleSampleLimit {
		styleMessages = styleMessages[len(styleMessages)-ghostwriterStyleSampleLimit:]
	}

	profile := (StylometryService{}).Profile(styleMessages)
	examples := make([]string, 0, exampleLimit)
	for index := len(styleMessages) - 1; index >= 0 && len(examples) < exampleLimit; index-- {
		examples = append(examples, clipGhostwriterText(strings.TrimSpace(styleMessages[index].Body), exampleTextLimit))
	}
	for left, right := 0, len(examples)-1; left < right; left, right = left+1, right-1 {
		examples[left], examples[right] = examples[right], examples[left]
	}
	messageContext := MessageContext{
		ContactID:   selectedRoom.ID,
		ContactName: selectedRoom.Name,
		Platform:    ghostwriterPlatform(selectedRoom.Bridge),
		Messages:    make([]MessageContextEntry, 0, len(conversationMessages)),
	}
	for _, message := range conversationMessages {
		sender := message.SenderName
		if message.Own {
			sender = "You"
		} else if sender == "" {
			sender = message.Sender
		}
		messageContext.Messages = append(messageContext.Messages, MessageContextEntry{
			Sender:    sender,
			Text:      clipGhostwriterText(strings.TrimSpace(message.Body), messageTextLimit),
			Timestamp: message.Timestamp.UnixMilli(),
			Own:       message.Own,
		})
	}

	tuning := aiFeatureTuningFor(preferences, aiFeatureGhostwriter)
	systemPrompt, userPrompt, err := buildGhostwriterPromptsWithInstructions(request, messageContext, profile, examples, tuning.Prompt)
	if err != nil {
		return nil, fmt.Errorf("build Ghostwriter prompt: %w", err)
	}
	var onChunk func(string)
	if (request.Mode == GhostwriterModeAutocomplete || request.Mode == GhostwriterModeSlash) && request.RequestID != "" && s.emitGhostwriterStream != nil {
		onChunk = func(text string) {
			s.emitGhostwriterStream(GhostwriterStreamEvent{RequestID: request.RequestID, RoomID: request.RoomID, Text: text})
		}
	}
	messages := []AIMessage{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}}
	completion, err := runLocalAICompletion(ctx, ghostwriterHTTPClient, provider, localEndpoint, model, messages, ghostwriterCompletionOptions(request.Mode, tuning), onChunk)
	if err != nil {
		log.Printf("Ghostwriter %s request failed (%s, model %q): %v", request.Mode, provider, model, err)
		return nil, err
	}
	suggestions, err := parseGhostwriterSuggestions(request.Mode, request.Draft, request.Intent, completion)
	if err != nil {
		log.Printf("Ghostwriter %s reply rejected (%s, model %q, %d bytes): %v", request.Mode, provider, model, len(completion), err)
	}
	return suggestions, err
}

// LocalAIChatRequest is one conversation turn sent from the local AI chat window.
type LocalAIChatRequest struct {
	Messages          []AIMessage `json:"messages"`
	RequestID         string      `json:"requestId"`
	AgentInstructions string      `json:"agentInstructions,omitempty"`
}

// LocalAIChat returns the next assistant turn. Deltas are emitted as local-ai:stream events, and AICancel stops RequestID.
func (s *AppService) LocalAIChat(request LocalAIChatRequest) (string, error) {
	if err := validateLocalAIChatMessages(request.Messages); err != nil {
		return "", err
	}
	agentInstructions := strings.TrimSpace(request.AgentInstructions)
	if utf8.RuneCountInString(agentInstructions) > localAIChatAgentLimit {
		return "", fmt.Errorf("agent instructions must be %d characters or fewer", localAIChatAgentLimit)
	}
	preferences := s.preferenceValues()
	provider, localEndpoint, model, err := ghostwriterModelConfig(preferences)
	if err != nil {
		return "", err
	}
	tuning := aiFeatureTuningFor(preferences, aiFeatureLocalChat)
	systemPrompt := tuning.Prompt
	if agentInstructions != "" {
		systemPrompt += "\n\nAgent instructions:\n" + agentInstructions
	}
	conversation := make([]AIMessage, 0, len(request.Messages)+1)
	conversation = append(conversation, AIMessage{Role: "system", Content: systemPrompt})
	conversation = append(conversation, request.Messages...)
	ctx, release := s.aiRuns.begin(s.aiContext(), request.RequestID)
	defer release()
	ctx, cancel := context.WithTimeout(ctx, ghostwriterChatTimeout)
	defer cancel()
	var onChunk func(string)
	if request.RequestID != "" && s.emitLocalAIChatStream != nil {
		onChunk = func(text string) {
			s.emitLocalAIChatStream(LocalAIChatStreamEvent{RequestID: request.RequestID, Text: text})
		}
	}
	reply, err := runLocalAICompletion(ctx, ghostwriterHTTPClient, provider, localEndpoint, model, conversation, ghostwriterCompletionOptions(GhostwriterModeChat, tuning), onChunk)
	if err != nil && ctx.Err() == context.Canceled {
		return "", errAIRunStopped
	}
	if err != nil && ctx.Err() == context.DeadlineExceeded {
		return "", errors.New("local AI reply timed out")
	}
	return reply, err
}

var localAIChatImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

func validateLocalAIChatMessages(messages []AIMessage) error {
	if len(messages) == 0 || len(messages) > ghostwriterChatHistoryLimit {
		return fmt.Errorf("local AI chat must contain between 1 and %d messages", ghostwriterChatHistoryLimit)
	}
	totalBytes := 0
	imageBytes := 0
	previousRole := ""
	for _, message := range messages {
		if message.Role != "user" && message.Role != "assistant" {
			return errors.New("local AI chat only accepts user and assistant messages")
		}
		if previousRole == "" && message.Role != "user" {
			return errors.New("local AI chat must start with a user message")
		}
		if message.Role == "assistant" && previousRole != "user" {
			return errors.New("local AI assistant messages must follow a user message")
		}
		if (strings.TrimSpace(message.Content) == "" && len(message.Images) == 0) || utf8.RuneCountInString(message.Content) > localAIChatMessageLimit {
			return errors.New("local AI chat messages must be non-empty and within the size limit")
		}
		messageImageBytes, err := validateLocalAIChatImages(message)
		if err != nil {
			return err
		}
		imageBytes += messageImageBytes
		if imageBytes > localAIChatImageInputLimit {
			return errors.New("local AI chat images exceeded the size limit")
		}
		totalBytes += len(message.Content)
		if totalBytes > localAIChatInputLimit {
			return errors.New("local AI chat history exceeded the size limit")
		}
		previousRole = message.Role
	}
	if previousRole != "user" {
		return errors.New("local AI chat must end with a user message")
	}
	return nil
}

// validateLocalAIChatImages checks one message's images and returns their decoded size.
func validateLocalAIChatImages(message AIMessage) (int, error) {
	if len(message.Images) == 0 {
		return 0, nil
	}
	if message.Role != "user" {
		return 0, errors.New("only user messages can include images")
	}
	if len(message.Images) > localAIChatImageLimit {
		return 0, fmt.Errorf("a message can include at most %d images", localAIChatImageLimit)
	}
	total := 0
	for _, image := range message.Images {
		size, err := validateLocalAIChatImage(image)
		if err != nil {
			return 0, err
		}
		total += size
	}
	return total, nil
}

// validateLocalAIChatImage checks one image's type, size, and encoding and returns its decoded size.
func validateLocalAIChatImage(image AIImage) (int, error) {
	if !localAIChatImageTypes[image.MediaType] {
		return 0, errors.New("local AI images must be PNG, JPEG, GIF, or WebP")
	}
	size := base64.RawStdEncoding.DecodedLen(len(strings.TrimRight(image.Data, "=")))
	if size > localAIChatImageBytes {
		return 0, fmt.Errorf("local AI images must be %d MiB or smaller", localAIChatImageBytes>>20)
	}
	if _, err := base64.StdEncoding.DecodeString(image.Data); err != nil {
		return 0, errors.New("local AI image data must be base64")
	}
	return size, nil
}

func stringPreference(preferences map[string]any, key, fallback string) string {
	value, _ := preferences[key].(string)
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func ghostwriterModelConfig(preferences map[string]any) (GhostwriterProvider, *url.URL, string, error) {
	provider := GhostwriterProvider(stringPreference(preferences, "ghostwriter.provider", string(GhostwriterProviderOllama)))
	if provider != GhostwriterProviderOllama && provider != GhostwriterProviderOpenAICompatible {
		return "", nil, "", errors.New("choose a supported local Ghostwriter provider")
	}

	model := strings.TrimSpace(stringPreference(preferences, "ghostwriter.model", ""))
	endpoint := strings.TrimSpace(stringPreference(preferences, "ghostwriter.endpoint", ""))
	if endpoint == "" {
		sharedEndpoint := strings.TrimSpace(stringPreference(preferences, "ai.endpoint", ""))
		if localEndpoint, err := validateGhostwriterEndpoint(sharedEndpoint); err == nil {
			provider = GhostwriterProviderOpenAICompatible
			if model == "" {
				model = strings.TrimSpace(stringPreference(preferences, "ai.model", ""))
			}
			return provider, localEndpoint, model, nil
		}
		if provider == GhostwriterProviderOllama {
			endpoint = ghostwriterDefaultOllamaURL
		} else {
			endpoint = ghostwriterDefaultOpenAIURL
		}
	}

	localEndpoint, err := validateGhostwriterEndpoint(endpoint)
	if err != nil {
		return "", nil, "", err
	}
	if model == "" && provider == GhostwriterProviderOllama {
		model = ghostwriterDefaultOllamaModel
	}
	return provider, localEndpoint, model, nil
}

func validateGhostwriterRequest(request GhostwriterRequest) error {
	if strings.TrimSpace(request.RoomID) == "" {
		return errors.New("select a chat for Ghostwriter")
	}
	switch request.Mode {
	case GhostwriterModeChips:
	case GhostwriterModeAutocomplete:
		if strings.TrimSpace(request.Draft) == "" {
			return errors.New("type a draft before requesting autocomplete")
		}
	case GhostwriterModeSlash:
		if strings.TrimSpace(request.Intent) == "" {
			return errors.New("add an intent after /ghost")
		}
	default:
		return errors.New("unknown Ghostwriter mode")
	}
	if utf8.RuneCountInString(request.Draft) > 4000 || utf8.RuneCountInString(request.Intent) > 300 {
		return errors.New("Ghostwriter input is too long")
	}
	targetLanguage := strings.TrimSpace(request.TargetLanguage)
	if utf8.RuneCountInString(targetLanguage) > 48 {
		return errors.New("Ghostwriter target language is too long")
	}
	for _, character := range targetLanguage {
		if !unicode.IsLetter(character) && character != ' ' && character != '-' {
			return errors.New("Ghostwriter target language is invalid")
		}
	}
	return nil
}

func ghostwriterPlatform(bridge string) string {
	switch strings.ToLower(strings.TrimSpace(bridge)) {
	case "":
		return "Matrix"
	case "wa":
		return "WhatsApp"
	case "tg":
		return "Telegram"
	case "sg":
		return "Signal"
	case "im":
		return "iMessage"
	case "ig":
		return "Instagram"
	case "dc":
		return "Discord"
	case "sl":
		return "Slack"
	case "sms":
		return "SMS"
	case "br":
		return "Bridged chat"
	default:
		return bridge
	}
}

func buildGhostwriterPrompts(request GhostwriterRequest, context MessageContext, profile UserStyleProfile, examples []string) (string, string, error) {
	return buildGhostwriterPromptsWithInstructions(request, context, profile, examples, ghostwriterDefaultInstructions)
}

// buildGhostwriterPromptsWithInstructions builds the prompts for one Ghostwriter request. instructions is the tunable system guidance placed before the untrusted data sections.
func buildGhostwriterPromptsWithInstructions(request GhostwriterRequest, context MessageContext, profile UserStyleProfile, examples []string, instructions string) (string, string, error) {
	profileJSON, err := json.Marshal(profile)
	if err != nil {
		return "", "", err
	}
	examplesJSON, err := json.Marshal(examples)
	if err != nil {
		return "", "", err
	}
	conversationJSON, err := json.Marshal(struct {
		ContactName string                `json:"contactName"`
		Platform    string                `json:"platform"`
		Messages    []MessageContextEntry `json:"messages"`
	}{ContactName: clipGhostwriterText(context.ContactName, 160), Platform: context.Platform, Messages: context.Messages})
	if err != nil {
		return "", "", err
	}
	systemPrompt := instructions + "\n\n" +
		"Recipient and platform context (JSON data):\n" + string(conversationJSON) +
		"\n\nObserved user style profile (JSON data):\n" + string(profileJSON) +
		"\n\nGenuine recent outgoing examples from this chat (JSON strings, oldest first):\n" + string(examplesJSON)
	var userPrompt string
	switch request.Mode {
	case GhostwriterModeChips:
		userPrompt = `Generate exactly three short replies to the newest incoming message, using the timestamps and conversation to understand what is being asked. Keep all three in the user's voice and preserve the same intent: first the clearest natural answer, second a slightly warmer version, third a meaningfully different alternative (ask a follow-up only if it would help). Do not force agreement, refusal, delay, or a question when the context does not call for it. Avoid generic filler and do not invent facts, feelings, plans, or commitments. Return only compact JSON with this shape: {"suggestions":[{"kind":"direct","text":"..."},{"kind":"warm","text":"..."},{"kind":"alternative","text":"..."}]}.`
	case GhostwriterModeAutocomplete:
		draftJSON, marshalErr := json.Marshal(request.Draft)
		if marshalErr != nil {
			return "", "", marshalErr
		}
		languageInstruction := ""
		if targetLanguage := strings.TrimSpace(request.TargetLanguage); targetLanguage != "" {
			languageJSON, marshalErr := json.Marshal(targetLanguage)
			if marshalErr != nil {
				return "", "", marshalErr
			}
			languageInstruction = "The app detected the target language from recent incoming messages as " + string(languageJSON) + ". This detected language is authoritative and overrides the draft language. You MUST rewrite the entire draft in that language. "
		}
		userPrompt = languageInstruction + "Edit the user's entire draft. Infer the target language from the recent conversation (up to 10 messages), prioritizing the newest incoming message and the language used across the conversation, not the draft or style examples. If the draft uses a different language, translate and rewrite the entire draft in the conversation's language. You may replace every word; this is a full-draft rewrite, not append-only autocomplete. Preserve the intended meaning, names, facts, and tone. If context does not clearly establish a target language, preserve the draft's language. Correct spelling, grammar, and punctuation, and improve wording that sounds awkward, stilted, or unnatural even when technically correct. Prefer natural, idiomatic phrasing that fits this chat and the user's style. Do not answer the conversation, continue the thought, or add greetings, explanations, questions, facts, or commitments. If the draft is already clear and natural in the conversation's language, return it unchanged. Return only the complete revised draft. Draft (JSON string): " + string(draftJSON)
	case GhostwriterModeSlash:
		intentJSON, marshalErr := json.Marshal(strings.TrimSpace(request.Intent))
		if marshalErr != nil {
			return "", "", marshalErr
		}
		userPrompt = "Write one complete, concise response in the user's voice for this intent. Use the recent chat only as context and do not add unsupported facts. Return only the draft text. Intent (JSON string): " + string(intentJSON)
	default:
		return "", "", errors.New("unknown Ghostwriter mode")
	}
	return systemPrompt, userPrompt, nil
}

func localGhostwriterCompletion(ctx context.Context, client *http.Client, provider GhostwriterProvider, endpoint *url.URL, model, systemPrompt, userPrompt string, mode GhostwriterMode) (string, error) {
	return localGhostwriterCompletionWithStream(ctx, client, provider, endpoint, model, systemPrompt, userPrompt, mode, nil)
}

func localGhostwriterCompletionWithStream(ctx context.Context, client *http.Client, provider GhostwriterProvider, endpoint *url.URL, model, systemPrompt, userPrompt string, mode GhostwriterMode, onChunk func(string)) (string, error) {
	return localGhostwriterCompletionWithMessagesAndStream(ctx, client, provider, endpoint, model, []AIMessage{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}}, mode, onChunk)
}

func localGhostwriterChatCompletion(ctx context.Context, client *http.Client, provider GhostwriterProvider, endpoint *url.URL, model string, messages []AIMessage) (string, error) {
	return localGhostwriterChatCompletionWithStream(ctx, client, provider, endpoint, model, messages, nil)
}

func localGhostwriterChatCompletionWithStream(ctx context.Context, client *http.Client, provider GhostwriterProvider, endpoint *url.URL, model string, messages []AIMessage, onChunk func(string)) (string, error) {
	return localGhostwriterCompletionWithMessagesAndStream(ctx, client, provider, endpoint, model, messages, GhostwriterModeChat, onChunk)
}

func localGhostwriterCompletionWithMessagesAndStream(ctx context.Context, client *http.Client, provider GhostwriterProvider, endpoint *url.URL, model string, messages []AIMessage, mode GhostwriterMode, onChunk func(string)) (string, error) {
	tuning := aiFeatureTuningFor(nil, ghostwriterFeatureFor(mode))
	return runLocalAICompletion(ctx, client, provider, endpoint, model, messages, ghostwriterCompletionOptions(mode, tuning), onChunk)
}

// ghostwriterFeatureFor returns the feature whose prompt and sampling apply to a Ghostwriter mode.
func ghostwriterFeatureFor(mode GhostwriterMode) string {
	if mode == GhostwriterModeChat {
		return aiFeatureLocalChat
	}
	return aiFeatureGhostwriter
}

// ghostwriterCompletionOptions maps a Ghostwriter mode and its tuned settings to one model call.
// A token limit of 0 uses the mode's built-in limit.
func ghostwriterCompletionOptions(mode GhostwriterMode, tuning aiFeatureTuning) aiCompletionOptions {
	options := aiCompletionOptions{
		Temperature:      tuning.Temperature,
		MaxTokens:        tuning.MaxTokens,
		MaxResponseBytes: ghostwriterMaxResponseBytes,
	}
	if options.MaxTokens <= 0 {
		options.MaxTokens = ghostwriterModeMaxTokens(mode)
	}
	switch mode {
	case GhostwriterModeChat:
		options.Chat = true
		options.MaxResponseBytes = localAIChatResponseBytes
	case GhostwriterModeChips:
		options.JSONObject = true
		options.Stop = ghostwriterStopSequences
	default:
		options.Stop = ghostwriterStopSequences
	}
	// Hidden reasoning is turned off for every mode, because it would consume the token limit before the reply.
	options.ChatTemplateKwargs = aiThinkingDisabled()
	return options
}

// ghostwriterModeMaxTokens returns the built-in token limit for a Ghostwriter mode.
func ghostwriterModeMaxTokens(mode GhostwriterMode) int {
	switch mode {
	case GhostwriterModeAutocomplete:
		return 256
	case GhostwriterModeChips:
		return 400
	case GhostwriterModeChat:
		return 8192
	default:
		return 180
	}
}
func validateGhostwriterEndpoint(raw string) (*url.URL, error) {
	if err := sharedpreferences.ValidateLocalHTTPEndpoint(raw); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, errors.New("Ghostwriter endpoint must be a localhost HTTP URL")
	}
	if strings.EqualFold(parsed.Hostname(), "localhost") {
		parsed.Host = net.JoinHostPort("127.0.0.1", parsed.Port())
		if parsed.Port() == "" {
			parsed.Host = "127.0.0.1"
		}
	}
	parsed.Path = ""
	parsed.RawPath = ""
	return parsed, nil
}

func parseGhostwriterSuggestions(mode GhostwriterMode, draft, intent, response string) ([]GhostSuggestion, error) {
	response = strings.TrimSpace(response)
	response = strings.TrimPrefix(response, "```json")
	response = strings.TrimPrefix(response, "```JSON")
	response = strings.TrimSuffix(response, "```")
	response = strings.TrimSpace(response)
	switch mode {
	case GhostwriterModeChips:
		var parsed struct {
			Suggestions []ghostwriterChipItem `json:"suggestions"`
		}
		if err := json.NewDecoder(strings.NewReader(response)).Decode(&parsed); err != nil {
			parsed.Suggestions = partialGhostwriterChipSuggestions(response)
		}
		if len(parsed.Suggestions) == 0 {
			return nil, errors.New("local model returned no usable quick replies")
		}
		if len(parsed.Suggestions) > 3 {
			parsed.Suggestions = parsed.Suggestions[:3]
		}
		kindLabels := map[string]struct {
			kind  string
			label string
		}{
			"direct":          {kind: "direct", label: "Direct"},
			"warm":            {kind: "warm", label: "Warmer"},
			"alternative":     {kind: "alternative", label: "Alternative"},
			"affirmative":     {kind: "direct", label: "Direct"},
			"polite_decline":  {kind: "alternative", label: "Alternative"},
			"delay_follow_up": {kind: "alternative", label: "Alternative"},
		}
		fallbackKinds := []string{"direct", "warm", "alternative"}
		labels := map[string]string{"direct": "Direct", "warm": "Warmer", "alternative": "Alternative"}
		usedKinds := make(map[string]bool, len(parsed.Suggestions))
		result := make([]GhostSuggestion, 0, len(parsed.Suggestions))
		for _, suggestion := range parsed.Suggestions {
			text := clipGhostwriterText(strings.TrimSpace(suggestion.Text), 320)
			if text == "" {
				continue
			}
			kind, ok := kindLabels[strings.ToLower(strings.TrimSpace(suggestion.Kind))]
			if !ok || usedKinds[kind.kind] {
				for _, fallback := range fallbackKinds {
					if !usedKinds[fallback] {
						kind = struct {
							kind  string
							label string
						}{kind: fallback, label: labels[fallback]}
						break
					}
				}
			}
			usedKinds[kind.kind] = true
			result = append(result, GhostSuggestion{ID: "chip-" + kind.kind, Type: "chip", Label: kind.label, Text: text})
		}
		if len(result) == 0 {
			return nil, errors.New("local model returned no usable quick replies")
		}
		return result, nil
	case GhostwriterModeAutocomplete:
		response = clipGhostwriterText(strings.TrimSpace(response), 2000)
		if response == "" {
			return nil, nil
		}
		return []GhostSuggestion{{ID: "autocomplete", Type: "autocomplete", Text: response}}, nil
	case GhostwriterModeSlash:
		response = clipGhostwriterText(response, 2000)
		if response == "" {
			return nil, errors.New("local model returned an empty draft")
		}
		return []GhostSuggestion{{ID: "slash-result", Type: "slash_result", Label: strings.TrimSpace(intent), Text: response}}, nil
	default:
		return nil, errors.New("unknown Ghostwriter mode")
	}
}

func partialGhostwriterChipSuggestions(response string) []ghostwriterChipItem {
	start := strings.IndexByte(response, '{')
	if start < 0 {
		return nil
	}
	decoder := json.NewDecoder(strings.NewReader(response[start:]))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil
	}
	for decoder.More() {
		keyToken, tokenErr := decoder.Token()
		if tokenErr != nil {
			return nil
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil
		}
		if key != "suggestions" {
			var ignored json.RawMessage
			if decoder.Decode(&ignored) != nil {
				return nil
			}
			continue
		}
		arrayToken, tokenErr := decoder.Token()
		if tokenErr != nil || arrayToken != json.Delim('[') {
			return nil
		}
		suggestions := make([]ghostwriterChipItem, 0, 3)
		for decoder.More() {
			var suggestion ghostwriterChipItem
			if decoder.Decode(&suggestion) != nil {
				return suggestions
			}
			suggestions = append(suggestions, suggestion)
		}
		return suggestions
	}
	return nil
}

func clipGhostwriterText(text string, maxRunes int) string {
	if utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	runes := []rune(text)
	if maxRunes <= 1 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-1]) + "…"
}
