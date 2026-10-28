package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestValidateAIEndpointRequiresHTTPURL(t *testing.T) {
	for _, endpoint := range []string{"http://localhost:8080", "https://ai.example.net/base"} {
		if err := validateAIEndpoint(endpoint); err != nil {
			t.Fatalf("validateAIEndpoint(%q) error = %v", endpoint, err)
		}
	}
	for _, endpoint := range []string{"localhost:8080", "ftp://example.net", "http://", "not a url"} {
		if err := validateAIEndpoint(endpoint); err == nil {
			t.Fatalf("validateAIEndpoint(%q) accepted invalid endpoint", endpoint)
		}
	}
}

func TestPreferenceStoreAcceptsAIEndpointSettings(t *testing.T) {
	store, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if err := store.Set("ai.endpoint", "http://localhost:8080"); err != nil {
		t.Fatalf("Set(ai.endpoint) error = %v", err)
	}
	if err := store.Set("ai.endpoint", ""); err != nil {
		t.Fatalf("Set(ai.endpoint) clearing error = %v", err)
	}
	if err := store.Set("ai.endpoint", "localhost:8080"); err == nil {
		t.Fatal("Set(ai.endpoint) accepted a URL without a scheme")
	}
	if err := store.Set("ai.model", "local-model.gguf"); err != nil {
		t.Fatalf("Set(ai.model) error = %v", err)
	}
	if err := store.Set("ai.model", 3); err == nil {
		t.Fatal("Set(ai.model) accepted a non-string value")
	}
	for _, level := range []string{"none", "low", "medium", "high"} {
		if err := store.Set("ai.thinking_level", level); err != nil {
			t.Errorf("Set(ai.thinking_level, %q) error = %v", level, err)
		}
	}
	if err := store.Set("ai.thinking_level", "maximum"); err == nil {
		t.Fatal("Set(ai.thinking_level) accepted an unsupported value")
	}
	if err := store.Set("ai.default_language", "es"); err != nil {
		t.Fatalf("Set(ai.default_language) error = %v", err)
	}
	if err := store.Set("ai.known_languages", `["en","es"]`); err != nil {
		t.Fatalf("Set(ai.known_languages) error = %v", err)
	}
	if err := store.Set("ai.known_languages", `["xx"]`); err == nil {
		t.Fatal("Set(ai.known_languages) accepted an unsupported language")
	}
}

func TestAIThinkingOptionsMapLevelsForProviders(t *testing.T) {
	tests := []struct {
		level  string
		openAI map[string]any
		ollama any
	}{
		{level: "none", openAI: map[string]any{"enable_thinking": false}, ollama: false},
		{level: "low", openAI: map[string]any{"enable_thinking": true, "reasoning_effort": "low"}, ollama: "low"},
		{level: "medium", openAI: map[string]any{"enable_thinking": true, "reasoning_effort": "medium"}, ollama: "medium"},
		{level: "high", openAI: map[string]any{"enable_thinking": true, "reasoning_effort": "high"}, ollama: "high"},
	}
	for _, test := range tests {
		options := aiThinkingOptions(test.level)
		if !reflect.DeepEqual(options, test.openAI) {
			t.Errorf("aiThinkingOptions(%q) = %#v, want %#v", test.level, options, test.openAI)
		}
		if got := aiOllamaThinkingOption(options); got != test.ollama {
			t.Errorf("aiOllamaThinkingOption(%q) = %#v, want %#v", test.level, got, test.ollama)
		}
	}
}

func TestAIThinkingOptionsEncodeForProviders(t *testing.T) {
	for _, test := range []struct {
		provider AIProvider
		level    string
		want     any
	}{
		{provider: AIProviderOpenAICompatible, level: "none", want: false},
		{provider: AIProviderOpenAICompatible, level: "high", want: "high"},
		{provider: AIProviderOllama, level: "none", want: false},
		{provider: AIProviderOllama, level: "high", want: "high"},
	} {
		body, _, err := encodeAICompletionRequest(test.provider, "gemma4:12b", []AIMessage{{Role: "user", Content: "test"}}, aiCompletionOptions{
			Chat:               true,
			ChatTemplateKwargs: aiThinkingOptions(test.level),
		}, false)
		if err != nil {
			t.Fatalf("encodeAICompletionRequest(%q, %q) error = %v", test.provider, test.level, err)
		}
		var request map[string]json.RawMessage
		if err := json.Unmarshal(body, &request); err != nil {
			t.Fatalf("decode %q request: %v", test.provider, err)
		}
		var got any
		if test.provider == AIProviderOllama {
			if err := json.Unmarshal(request["think"], &got); err != nil {
				t.Fatalf("decode Ollama think value: %v", err)
			}
		} else {
			var kwargs map[string]any
			if err := json.Unmarshal(request["chat_template_kwargs"], &kwargs); err != nil {
				t.Fatalf("decode OpenAI-compatible template kwargs: %v", err)
			}
			if kwargs["enable_thinking"] != (test.level != "none") {
				t.Errorf("%q enable_thinking = %v", test.provider, kwargs["enable_thinking"])
			}
			if effort := kwargs["reasoning_effort"]; test.level == "high" && effort != test.want {
				t.Errorf("%q reasoning_effort = %v, want %v", test.provider, effort, test.want)
			}
			if test.level == "none" {
				continue
			}
			continue
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Errorf("%q think value = %#v, want %#v", test.provider, got, test.want)
		}
	}
}

func TestAIChatCompletionSendsMessagesAndReturnsReply(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.URL.Path)
		}
		var body struct {
			Model              string         `json:"model"`
			Messages           []AIMessage    `json:"messages"`
			Stream             bool           `json:"stream"`
			ChatTemplateKwargs map[string]any `json:"chat_template_kwargs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "local.gguf" || body.Stream || len(body.Messages) != 1 || body.Messages[0].Content != "Translate hello" {
			t.Errorf("unexpected body: %+v", body)
		}
		if body.ChatTemplateKwargs["enable_thinking"] != true || body.ChatTemplateKwargs["reasoning_effort"] != "high" {
			t.Errorf("unexpected thinking settings: %+v", body.ChatTemplateKwargs)
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"  Hola  "}}]}`)
	}))
	defer server.Close()

	reply, err := aiChatCompletionWithThinking(context.Background(), server.Client(), server.URL+"/", "local.gguf", []AIMessage{{Role: "user", Content: "Translate hello"}}, aiCompletionTimeout, nil, 0, aiThinkingOptions("high"))
	if err != nil {
		t.Fatalf("aiChatCompletion() error = %v", err)
	}
	if reply != "Hola" {
		t.Fatalf("reply = %q, want %q", reply, "Hola")
	}
}

func TestAICompletionTimeoutGrowsWithPromptSizeUpToCap(t *testing.T) {
	short := []AIMessage{{Role: "user", Content: "Summarize this"}}
	if got := aiCompletionTimeoutFor(short); got != aiCompletionTimeout {
		t.Fatalf("short prompt timeout = %s, want %s", got, aiCompletionTimeout)
	}
	large := []AIMessage{{Role: "system", Content: "Summarize"}, {Role: "user", Content: strings.Repeat("x", 64<<10)}}
	if got := aiCompletionTimeoutFor(large); got != aiCompletionTimeout+64*time.Second {
		t.Fatalf("64 KiB prompt timeout = %s, want %s", got, aiCompletionTimeout+64*time.Second)
	}
	huge := []AIMessage{{Role: "user", Content: strings.Repeat("x", 4<<20)}}
	if got := aiCompletionTimeoutFor(huge); got != aiMaxCompletionTimeout {
		t.Fatalf("4 MiB prompt timeout = %s, want cap %s", got, aiMaxCompletionTimeout)
	}
}

func TestAIToneGuardCompletionUsesLocalLowTemperatureRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model       string      `json:"model"`
			Messages    []AIMessage `json:"messages"`
			Stream      bool        `json:"stream"`
			Temperature float64     `json:"temperature"`
			MaxTokens   int         `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if body.Model != "local-tone-model" || body.Stream || body.Temperature != 0.1 || body.MaxTokens != aiToneGuardMaxTokens || len(body.Messages) != 2 {
			t.Errorf("unexpected Tone Guard request: %+v", body)
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"{\"is_hostile_or_unprofessional\":false}"}}]}`)
	}))
	defer server.Close()

	result, err := aiToneGuardCompletion(context.Background(), server.Client(), server.URL, "local-tone-model", []AIMessage{{Role: "system", Content: "classify"}, {Role: "user", Content: "draft"}})
	if err != nil {
		t.Fatalf("aiToneGuardCompletion() error = %v", err)
	}
	if !strings.Contains(result, `"is_hostile_or_unprofessional":false`) {
		t.Fatalf("result = %q, want classifier JSON", result)
	}
}

func TestAIToneGuardCompletionRejectsNonLocalEndpoints(t *testing.T) {
	for _, endpoint := range []string{"https://localhost:8080", "http://example.com:8080", "http://localhost:8080/v1"} {
		if _, err := aiToneGuardCompletion(context.Background(), http.DefaultClient, endpoint, "", []AIMessage{{Role: "user", Content: "draft"}}); err == nil {
			t.Errorf("aiToneGuardCompletion(%q) accepted a non-local endpoint", endpoint)
		}
	}
}

func TestAIToneGuardCompletionTimesOut(t *testing.T) {
	releaseHandler := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-releaseHandler:
		}
	}))
	defer func() {
		close(releaseHandler)
		server.Close()
	}()

	started := time.Now()
	_, err := aiToneGuardCompletion(context.Background(), server.Client(), server.URL, "", []AIMessage{{Role: "user", Content: "draft"}})
	if err == nil {
		t.Fatal("aiToneGuardCompletion() succeeded after the deadline")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("aiToneGuardCompletion() took %v, want at most 2s", elapsed)
	}
}

func TestAIAudioTranscriptionSendsAudioAndReturnsTranscript(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("request = %s %s, want POST /v1/audio/transcriptions", r.Method, r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse multipart form: %v", err)
			return
		}
		if r.FormValue("model") != "whisper-small" || r.FormValue("response_format") != "json" {
			t.Errorf("form fields = model %q, response_format %q", r.FormValue("model"), r.FormValue("response_format"))
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Errorf("read audio file: %v", err)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil {
			t.Errorf("read audio bytes: %v", err)
		}
		if header.Filename != "voice-note.webm" || string(data) != "audio bytes" {
			t.Errorf("uploaded file = %q, %q", header.Filename, data)
		}
		if header.Header.Get("Content-Type") != "audio/webm" {
			t.Errorf("uploaded content type = %q", header.Header.Get("Content-Type"))
		}
		_, _ = io.WriteString(w, `{"text":"  hello from audio  "}`)
	}))
	defer server.Close()

	transcript, err := aiAudioTranscription(context.Background(), server.Client(), server.URL+"/", "whisper-small", "voice-note.webm", "audio/webm; codecs=opus", []byte("audio bytes"))
	if err != nil {
		t.Fatalf("aiAudioTranscription() error = %v", err)
	}
	if transcript != "hello from audio" {
		t.Fatalf("transcript = %q, want trimmed text", transcript)
	}
}

func TestAIAudioTranscriptionRejectsEmptyAudio(t *testing.T) {
	if _, err := aiAudioTranscription(context.Background(), http.DefaultClient, "http://localhost:8080", "", "audio.ogg", "audio/ogg", nil); err == nil {
		t.Fatal("aiAudioTranscription() accepted empty audio")
	}
}

func TestAIAudioFormatDetection(t *testing.T) {
	if !aiIsWAV([]byte("RIFF\x24\x00\x00\x00WAVEfmt ")) || aiIsWAV([]byte("OggS\x00\x02\x00\x00WAVE")) {
		t.Fatal("aiIsWAV() misclassified WAV input")
	}
	if !aiIsMP3([]byte("ID3\x03\x00\x00\x00\x00\x00\x00")) || !aiIsMP3([]byte{0xFF, 0xFB, 0x90, 0x00}) {
		t.Fatal("aiIsMP3() rejected MP3 input")
	}
	for name, audio := range map[string][]byte{"ogg": []byte("OggS\x00\x02"), "adts aac": {0xFF, 0xF1, 0x50, 0x80}, "webm": {0x1A, 0x45, 0xDF, 0xA3}} {
		if aiIsMP3(audio) || aiIsWAV(audio) {
			t.Fatalf("%s detected as a format the endpoint already accepts", name)
		}
	}
}

func TestAIPrepareTranscriptionAudioKeepsSupportedFormats(t *testing.T) {
	cases := map[string][]byte{
		"wav":        append([]byte("RIFF\x24\x00\x00\x00WAVE"), make([]byte, 32)...),
		"mp3 tag":    append([]byte("ID3\x03\x00\x00\x00\x00\x00\x00"), make([]byte, 32)...),
		"mpeg frame": {0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00},
	}
	for name, audio := range cases {
		got, filename, contentType, err := aiPrepareTranscriptionAudio(context.Background(), audio, "voice.mp3", "audio/mpeg")
		if err != nil {
			t.Fatalf("%s: aiPrepareTranscriptionAudio() error = %v", name, err)
		}
		if !bytes.Equal(got, audio) || filename != "voice.mp3" || contentType != "audio/mpeg" {
			t.Fatalf("%s: audio was changed to %q, %q, %q", name, got[:min(len(got), 4)], filename, contentType)
		}
	}
}

func TestAIPrepareTranscriptionAudioConvertsOggToWAV(t *testing.T) {
	ffmpeg, err := aiFFmpegPath()
	if err != nil {
		t.Skipf("ffmpeg not available: %v", err)
	}
	source, err := exec.Command(ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "libopus", "-f", "ogg", "pipe:1").Output()
	if err != nil || len(source) == 0 {
		t.Skipf("ffmpeg cannot create Ogg/Opus test audio: %v", err)
	}
	if aiIsWAV(source) || aiIsMP3(source) {
		t.Fatal("test source should not already be WAV or MP3")
	}

	converted, filename, contentType, err := aiPrepareTranscriptionAudio(context.Background(), source, "Voice message.ogg", "audio/ogg")
	if err != nil {
		t.Fatalf("aiPrepareTranscriptionAudio() error = %v", err)
	}
	if !aiIsWAV(converted) || filename != "Voice message.wav" || contentType != "audio/wav" {
		t.Fatalf("converted wav = %v, filename = %q, content type = %q", aiIsWAV(converted), filename, contentType)
	}
}

func TestAIChatCompletionReportsServerErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"error":{"message":"Loading model"}}`)
	}))
	defer server.Close()

	_, err := aiChatCompletion(context.Background(), server.Client(), server.URL, "", []AIMessage{{Role: "user", Content: "hi"}})
	if err == nil || !strings.Contains(err.Error(), "Loading model") {
		t.Fatalf("aiChatCompletion() error = %v, want server message", err)
	}
}

func TestAIChatCompletionRejectsEmptyChoices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"choices":[]}`)
	}))
	defer server.Close()

	if _, err := aiChatCompletion(context.Background(), server.Client(), server.URL, "", []AIMessage{{Role: "user", Content: "hi"}}); err == nil {
		t.Fatal("aiChatCompletion() accepted a response without choices")
	}
}

func TestAIChatCompletionRejectsEmptyMessages(t *testing.T) {
	if _, err := aiChatCompletion(context.Background(), http.DefaultClient, "http://localhost:8080", "", nil); err == nil {
		t.Fatal("aiChatCompletion() accepted an empty message list")
	}
}

func TestAIHealthCheckReportsLoadingModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("path = %s, want /health", r.URL.Path)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	err := aiHealthCheck(context.Background(), server.Client(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "still loading") {
		t.Fatalf("aiHealthCheck() error = %v, want loading message", err)
	}
}

func TestAIHealthCheckAcceptsReadyServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"status":"ok"}`)
	}))
	defer server.Close()

	if err := aiHealthCheck(context.Background(), server.Client(), server.URL); err != nil {
		t.Fatalf("aiHealthCheck() error = %v", err)
	}
}
