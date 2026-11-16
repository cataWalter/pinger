package desktop

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

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
