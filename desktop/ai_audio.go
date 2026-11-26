package desktop

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	sharedpreferences "mychat/preferences"
)

// aiIsMP3 reports whether audio starts with an ID3 tag or an MPEG Layer III frame sync.
// ADTS AAC frames share the 0xFF sync byte, so the layer bits must be non-zero.
func aiIsMP3(audio []byte) bool {
	if len(audio) >= 3 && string(audio[0:3]) == "ID3" {
		return true
	}
	return len(audio) >= 2 && audio[0] == 0xFF && audio[1]&0xE0 == 0xE0 && (audio[1]>>1)&0x03 != 0
}

// aiPrepareTranscriptionAudio converts audio the local endpoint cannot decode into 16 kHz mono WAV.
// llama-server decodes only WAV and MP3, so Matrix voice messages in Ogg, M4A, or WebM are converted with ffmpeg.
// Empty or oversized audio is returned unchanged so aiAudioTranscription reports its usual errors.
func aiPrepareTranscriptionAudio(ctx context.Context, audio []byte, filename, contentType string) ([]byte, string, string, error) {
	if len(audio) == 0 || len(audio) > aiMaxAudioBytes || aiIsWAV(audio) || aiIsMP3(audio) {
		return audio, filename, contentType, nil
	}
	converted, err := aiConvertAudioToWAV(ctx, audio)
	if err != nil {
		return nil, "", "", err
	}
	base := path.Base(strings.TrimSpace(filename))
	if base == "." || base == "/" {
		base = "audio"
	}
	filename = strings.TrimSuffix(base, path.Ext(base)) + ".wav"
	return converted, filename, "audio/wav", nil
}

func aiFFmpegPath() (string, error) {
	if found, err := exec.LookPath("ffmpeg"); err == nil {
		return found, nil
	}
	for _, candidate := range aiFFmpegFallbackPaths {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("this voice message format needs ffmpeg to transcribe; install it with 'brew install ffmpeg'")
}

func aiConvertAudioToWAV(ctx context.Context, audio []byte) ([]byte, error) {
	ffmpeg, err := aiFFmpegPath()
	if err != nil {
		return nil, err
	}
	workDir, err := os.MkdirTemp("", "gomuks-transcription-*")
	if err != nil {
		return nil, fmt.Errorf("create transcription workspace: %w", err)
	}
	defer os.RemoveAll(workDir)
	// ffmpeg reads MP4-family files more reliably from a seekable file than from a pipe.
	inputPath := filepath.Join(workDir, "input")
	outputPath := filepath.Join(workDir, "output.wav")
	if err := os.WriteFile(inputPath, audio, 0o600); err != nil {
		return nil, fmt.Errorf("write audio for conversion: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, aiTranscodeTimeout)
	defer cancel()
	var stderr bytes.Buffer
	command := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath)
	hideChildConsole(command)
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, fmt.Errorf("convert voice message for transcription: %s", detail)
	}
	converted, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("read converted voice message: %w", err)
	}
	return converted, nil
}

// aiCompletionTimeoutFor gives large prompts more time. A local model reads the whole prompt before its first token.
// Each KiB of prompt text adds one second to aiCompletionTimeout, up to aiMaxCompletionTimeout.
func aiCompletionTimeoutFor(messages []AIMessage) time.Duration {
	promptBytes := 0
	for _, message := range messages {
		promptBytes += len(message.Content)
		for _, image := range message.Images {
			promptBytes += len(image.Data)
		}
	}
	extra := time.Duration(promptBytes/1024) * time.Second
	return min(aiCompletionTimeout+extra, aiMaxCompletionTimeout)
}

// AIComplete sends chat messages to the configured AI provider and returns the reply text.
// Each reply delta is emitted as an ai:stream event while the model writes, so the panel shows text early.
// The temperature argument is kept for the frontend binding; every request uses the fixed sampling values.
func (s *AppService) AIComplete(messages []AIMessage, requestID string, temperature float64, maxTokens int) (string, error) {
	preferences := s.preferenceValues()
	route, err := aiFeatureRoute(preferences)
	if err != nil {
		return "", err
	}
	route = s.trackAIRoute(route)
	thinkingLevel := stringPreference(preferences, aiThinkingLevelPreference, aiThinkingLevelDefault)
	ctx, release := s.aiRuns.begin(s.aiContext(), requestID)
	defer release()
	ctx, cancel := context.WithTimeout(ctx, aiCompletionTimeoutFor(messages))
	defer cancel()
	var onChunk func(string)
	if requestID != "" && s.emitAIStream != nil {
		onChunk = func(text string) {
			s.emitAIStream(AIStreamEvent{RequestID: requestID, Text: text})
		}
	}
	return route.complete(ctx, messages, aiCompletionOptions{MaxTokens: maxTokens, ChatTemplateKwargs: aiThinkingOptions(thinkingLevel)}, onChunk)
}

// AICancel stops a running AI request.
func (s *AppService) AICancel(requestID string) bool {
	return s.aiRuns.cancel(requestID)
}

// AITranscribeMedia transcribes cached Matrix audio with the local loopback AI endpoint. Audio never goes to an online provider.
// language is the chat's ISO 639-1 code. An empty or unknown code leaves the language to the model.
func (s *AppService) AITranscribeMedia(mxcURI, filename, contentType, language string) (string, error) {
	preferences := s.preferenceValues()
	route, err := aiLocalRoute(preferences)
	if err != nil {
		return "", err
	}
	transcriptionModel, _ := preferences["ai.transcription_model"].(string)
	if transcriptionModel == "" {
		transcriptionModel = route.model
	}
	client, err := s.requireClient()
	if err != nil {
		return "", err
	}
	audio, err := client.CachedMediaBytes(s.aiContext(), mxcURI)
	if err != nil {
		return "", fmt.Errorf("load audio from Matrix: %w", err)
	}
	audio, filename, contentType, err = aiPrepareTranscriptionAudio(s.aiContext(), audio, filename, contentType)
	if err != nil {
		return "", err
	}
	prompt := aiTranscriptionPrompt(aiTranscriptionLanguageName(preferences, language))
	return aiAudioTranscription(s.aiContext(), route.client, route.endpoint, transcriptionModel, prompt, filename, contentType, audio)
}

// aiTranscriptionLanguageName returns the name of a chat language from the built-in or custom catalog, or an empty string.
func aiTranscriptionLanguageName(preferences map[string]any, code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return ""
	}
	return sharedpreferences.LanguageLookupFromPreferences(preferences)[code]
}

// aiTranscriptionPrompt asks for a word-for-word transcript in the named language. The local endpoint ignores a language form
// field, and a loose hint makes the model summarize the audio, so the instruction is strict. An empty name keeps the default request.
func aiTranscriptionPrompt(languageName string) string {
	if languageName == "" {
		return ""
	}
	return "Transcribe this audio word for word. The speech is in " + languageName + ". Output only the transcript."
}

// TestAIEndpoint checks the configured AI provider. Local checks that the server is up and the model is loaded.
// Online sends one short request, which also verifies the key and model.
func (s *AppService) TestAIEndpoint() error {
	preferences := s.preferenceValues()
	if stringPreference(preferences, aiProviderPreference, aiProviderLocal) == aiProviderOnline {
		route, err := aiOnlineRoute(preferences)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(s.aiContext(), aiCompletionTimeout)
		defer cancel()
		_, err = route.complete(ctx, []AIMessage{{Role: "user", Content: "Reply with OK."}}, aiCompletionOptions{MaxTokens: 16}, nil)
		if errors.Is(err, errAIEmptyResponse) {
			// The key and model were accepted. Some models use a small token budget on reasoning and return no text.
			s.recordAIHealthOutcome(route.provider, route.endpoint, nil)
			return nil
		}
		s.recordAIHealthOutcome(route.provider, route.endpoint, err)
		return err
	}
	route, err := aiLocalRoute(preferences)
	if err != nil {
		return err
	}
	err = aiHealthCheck(s.aiContext(), route.client, route.endpoint)
	s.recordAIHealthOutcome(route.provider, route.endpoint, err)
	return err
}
