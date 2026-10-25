package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	imageEngineTestServerEnv = "MYCHAT_IMAGE_ENGINE_TEST_SERVER"
	testImagePNG             = "iVBORw0KGgo="
)

// TestMain lets the test binary act as the fake sd-server. The engine launches it as a real child process, so process start, readiness, and kill run for real.
func TestMain(m *testing.M) {
	if os.Getenv(imageEngineTestServerEnv) == "1" {
		os.Exit(serveImageEngineTestServer(os.Args[1:]))
	}
	os.Exit(m.Run())
}

// imageEngineTestServer implements the sd-server routes the engine uses.
type imageEngineTestServer struct {
	mu          sync.Mutex
	statusCalls int
	nextJob     int
	jobs        map[string]*imageEngineTestJob
}

// imageEngineTestJob drives the fake job by prompt: "fail" fails, "stall" generates until cancelled, anything else completes after one generating poll.
type imageEngineTestJob struct {
	prompt    string
	polls     int
	cancelled bool
}

func serveImageEngineTestServer(args []string) int {
	port := ""
	for index := 0; index+1 < len(args); index++ {
		if args[index] == "--listen-port" {
			port = args[index+1]
		}
	}
	if port == "" {
		return 2
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return 1
	}
	fake := &imageEngineTestServer{jobs: make(map[string]*imageEngineTestJob)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sdcpp/v1/models/status", fake.handleStatus)
	mux.HandleFunc("POST /sdcpp/v1/img_gen", fake.handleSubmit)
	mux.HandleFunc("GET /sdcpp/v1/jobs/{id}", fake.handleJob)
	mux.HandleFunc("POST /sdcpp/v1/jobs/{id}/cancel", fake.handleCancel)
	_ = http.Serve(listener, mux)
	return 1
}

// handleStatus reports loading twice before ready, so the engine's readiness wait runs.
func (s *imageEngineTestServer) handleStatus(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.statusCalls++
	state := "ready"
	if s.statusCalls <= 2 {
		state = "loading"
	}
	s.mu.Unlock()
	writeImageEngineTestJSON(w, http.StatusOK, map[string]string{"state": state})
}

func (s *imageEngineTestServer) handleSubmit(w http.ResponseWriter, r *http.Request) {
	var request imageGenerationRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeImageEngineTestJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.mu.Lock()
	s.nextJob++
	id := "job-" + strconv.Itoa(s.nextJob)
	s.jobs[id] = &imageEngineTestJob{prompt: request.Prompt}
	s.mu.Unlock()
	writeImageEngineTestJSON(w, http.StatusAccepted, map[string]string{"id": id, "status": "queued", "poll_url": "/sdcpp/v1/jobs/" + id})
}

func (s *imageEngineTestServer) handleJob(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[r.PathValue("id")]
	if !ok {
		writeImageEngineTestJSON(w, http.StatusNotFound, map[string]string{"error": "unknown job"})
		return
	}
	job.polls++
	switch {
	case job.cancelled:
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "cancelled", "error": map[string]string{"code": "cancelled", "message": "job was cancelled"}})
	case job.prompt == "fail":
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "failed", "error": map[string]string{"code": "generation_failed", "message": "fake failure"}})
	case job.prompt == "stall":
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "generating", "preview": map[string]any{"step": 1, "total_steps": 20, "b64_json": testImagePNG}})
	case job.polls == 1:
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "generating", "preview": map[string]any{"step": 1, "total_steps": 2, "b64_json": testImagePNG}})
	default:
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "completed", "result": map[string]any{"output_format": "png", "images": []map[string]string{{"b64_json": testImagePNG}}}})
	}
}

func (s *imageEngineTestServer) handleCancel(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[r.PathValue("id")]
	if !ok {
		writeImageEngineTestJSON(w, http.StatusNotFound, map[string]string{"error": "unknown job"})
		return
	}
	job.cancelled = true
	writeImageEngineTestJSON(w, http.StatusOK, map[string]bool{"cancel_requested": true})
}

func writeImageEngineTestJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// newImageEngineTestSettings points the engine at the test binary, which acts as sd-server through TestMain.
func newImageEngineTestSettings(t *testing.T, idle time.Duration) imageSettings {
	t.Helper()
	t.Setenv(imageEngineTestServerEnv, "1")
	binary, err := filepath.Abs(os.Args[0])
	if err != nil {
		t.Fatalf("resolve test binary: %v", err)
	}
	model := filepath.Join(t.TempDir(), "model.safetensors")
	if err := os.WriteFile(model, []byte("test model"), 0o600); err != nil {
		t.Fatalf("write test model: %v", err)
	}
	return imageSettings{BinaryPath: binary, ModelPath: model, IdleTimeout: idle, Width: 512, Height: 512}
}

func TestImageEngineGeneratesImageAndReportsProgress(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	var updates []imageEngineProgress
	image, err := engine.generate(context.Background(), settings, "ok", func(update imageEngineProgress) {
		updates = append(updates, update)
	})
	if err != nil {
		t.Fatalf("generate() error = %v", err)
	}
	if image != testImagePNG {
		t.Fatalf("image = %q, want %q", image, testImagePNG)
	}
	if len(updates) != 2 || updates[0].Stage != "starting" || updates[1].Stage != "generating" || updates[1].Step != 1 || updates[1].TotalSteps != 2 {
		t.Fatalf("progress = %+v, want starting then generating at step 1 of 2", updates)
	}
	if !engine.running() {
		t.Fatal("engine stopped right after a job; want it kept warm for the idle timeout")
	}
	engine.stop()
	if engine.running() {
		t.Fatal("stop() left the engine running")
	}
}

func TestImageEngineReusesProcessAndStopsWhenIdle(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Second)
	engine := &imageEngine{}
	defer engine.stop()

	if _, err := engine.generate(context.Background(), settings, "ok", nil); err != nil {
		t.Fatalf("first generate() error = %v", err)
	}
	first := engine.processID()
	if first == 0 {
		t.Fatal("no engine process after the first generation")
	}
	if _, err := engine.generate(context.Background(), settings, "ok", nil); err != nil {
		t.Fatalf("second generate() error = %v", err)
	}
	if second := engine.processID(); second != first {
		t.Fatalf("process ID changed from %d to %d, want the running engine reused", first, second)
	}
	deadline := time.Now().Add(10 * time.Second)
	for engine.running() {
		if time.Now().After(deadline) {
			t.Fatal("engine was still running after the idle timeout")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestImageEngineCancelStopsRemoteJob(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := time.Now()
	_, err := engine.generate(ctx, settings, "stall", func(update imageEngineProgress) {
		if update.Stage == "generating" {
			cancel()
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("generate() error = %v, want context.Canceled", err)
	}
	// Without a cancel request the job never reports cancelled, so the engine would wait out the full cancel timeout.
	if elapsed := time.Since(started); elapsed >= imageEngineCancelTimeout/2 {
		t.Fatalf("cancel took %s, want the engine to see the cancelled job promptly", elapsed)
	}
}

func TestImageEngineReportsFailedJob(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	_, err := engine.generate(context.Background(), settings, "fail", nil)
	if err == nil || !strings.Contains(err.Error(), "fake failure") {
		t.Fatalf("generate() error = %v, want the engine failure message", err)
	}
}

func TestImageEngineRejectsSecondGenerationWhileBusy(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	var startedOnce sync.Once
	done := make(chan error, 1)
	go func() {
		_, err := engine.generate(ctx, settings, "stall", func(update imageEngineProgress) {
			if update.Stage == "generating" {
				startedOnce.Do(func() { close(started) })
			}
		})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(20 * time.Second):
		t.Fatal("first generation did not start")
	}
	if _, err := engine.generate(context.Background(), settings, "ok", nil); !errors.Is(err, errImageEngineBusy) {
		t.Fatalf("second generate() error = %v, want errImageEngineBusy", err)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("first generate() error = %v, want context.Canceled", err)
	}
}

func TestImageEngineValidatesBinaryAndModelBeforeStart(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	missing := settings
	missing.BinaryPath = filepath.Join(t.TempDir(), "missing-sd-server")
	if err := validateImageSettings(missing); err == nil {
		t.Fatal("validateImageSettings accepted a missing binary")
	}
	missing = settings
	missing.ModelPath = filepath.Join(t.TempDir(), "missing.safetensors")
	if err := validateImageSettings(missing); err == nil {
		t.Fatal("validateImageSettings accepted a missing model")
	}
	if err := validateImageSettings(imageSettings{Width: 512, Height: 512}); !errors.Is(err, errImageEngineNotConfigured) {
		t.Fatalf("unset paths error = %v, want errImageEngineNotConfigured", err)
	}
}

func TestImageSettingsFromPreferencesUsesDefaults(t *testing.T) {
	if _, err := imageSettingsFromPreferences(map[string]any{}); !errors.Is(err, errImageEngineNotConfigured) {
		t.Fatalf("empty preferences error = %v, want errImageEngineNotConfigured", err)
	}
	settings, err := imageSettingsFromPreferences(map[string]any{
		"ai.image.binary_path": "/opt/sd/sd-server",
		"ai.image.model_path":  "/models/checkpoint.safetensors",
	})
	if err != nil {
		t.Fatalf("imageSettingsFromPreferences() error = %v", err)
	}
	if settings.IdleTimeout != imageEngineDefaultIdle || settings.Width != imageEngineDefaultSize || settings.Height != imageEngineDefaultSize {
		t.Fatalf("defaults = %+v", settings)
	}
	settings, err = imageSettingsFromPreferences(map[string]any{
		"ai.image.binary_path":  "/opt/sd/sd-server",
		"ai.image.model_path":   "/models/checkpoint.safetensors",
		"ai.image.idle_minutes": "10",
		"ai.image.size":         "768x768",
	})
	if err != nil {
		t.Fatalf("imageSettingsFromPreferences() error = %v", err)
	}
	if settings.IdleTimeout != 10*time.Minute || settings.Width != 768 || settings.Height != 768 {
		t.Fatalf("settings = %+v, want 10 minute idle and 768x768", settings)
	}
}

func TestImageSettingsFromPreferencesReadsSamplingOptions(t *testing.T) {
	settings, err := imageSettingsFromPreferences(map[string]any{
		"ai.image.binary_path":     "/opt/sd/sd-server",
		"ai.image.model_path":      "/models/checkpoint.safetensors",
		"ai.image.size":            "768x512",
		"ai.image.steps":           "30",
		"ai.image.cfg_scale":       "5",
		"ai.image.sampler":         "dpm++2m",
		"ai.image.negative_prompt": "  blurry  ",
	})
	if err != nil {
		t.Fatalf("imageSettingsFromPreferences() error = %v", err)
	}
	if settings.Width != 768 || settings.Height != 512 {
		t.Fatalf("size = %dx%d, want 768x512", settings.Width, settings.Height)
	}
	if settings.Steps != 30 || settings.CFGScale != 5 || settings.SampleMethod != "dpm++2m" || settings.NegativePrompt != "blurry" {
		t.Fatalf("sampling settings = %+v", settings)
	}

	defaults, err := imageSettingsFromPreferences(map[string]any{
		"ai.image.binary_path": "/opt/sd/sd-server",
		"ai.image.model_path":  "/models/checkpoint.safetensors",
		"ai.image.steps":       "many",
		"ai.image.cfg_scale":   "-2",
	})
	if err != nil {
		t.Fatalf("imageSettingsFromPreferences() error = %v", err)
	}
	if defaults.Steps != 0 || defaults.CFGScale != 0 || defaults.SampleMethod != "" || defaults.NegativePrompt != "" {
		t.Fatalf("unset sampling settings = %+v, want engine defaults", defaults)
	}
	if params := defaults.sampleParams(); params != nil {
		t.Fatalf("sampleParams() = %+v, want nil so the engine defaults apply", params)
	}
}

func TestImageGenerationRequestEncodesSamplingOptions(t *testing.T) {
	plain, err := json.Marshal(imageGenerationRequest{Prompt: "a fox", Width: 512, Height: 512, SampleParams: imageSettings{}.sampleParams()})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if strings.Contains(string(plain), "sample_params") || strings.Contains(string(plain), "negative_prompt") {
		t.Fatalf("request without sampling options = %s, want no sample_params or negative_prompt", plain)
	}

	settings := imageSettings{Steps: 8, CFGScale: 1, SampleMethod: "lcm", NegativePrompt: "blurry"}
	encoded, err := json.Marshal(imageGenerationRequest{
		Prompt:         "a fox",
		NegativePrompt: settings.NegativePrompt,
		Width:          512,
		Height:         512,
		SampleParams:   settings.sampleParams(),
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	want := `"negative_prompt":"blurry"`
	if !strings.Contains(string(encoded), want) {
		t.Fatalf("request = %s, want %s", encoded, want)
	}
	want = `"sample_params":{"sample_method":"lcm","sample_steps":8,"guidance":{"txt_cfg":1}}`
	if !strings.Contains(string(encoded), want) {
		t.Fatalf("request = %s, want %s", encoded, want)
	}
}

func TestLocalAIChatGenerateImageSavesPromptAndImageTurns(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	preferences, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if err := preferences.Set("ai.image.binary_path", settings.BinaryPath); err != nil {
		t.Fatalf("Set(ai.image.binary_path) error = %v", err)
	}
	if err := preferences.Set("ai.image.model_path", settings.ModelPath); err != nil {
		t.Fatalf("Set(ai.image.model_path) error = %v", err)
	}
	service := &AppService{dataDir: t.TempDir(), preferences: preferences}
	defer service.imageEngine.stop()
	chat, err := service.CreateLocalAIChat("", "chat")
	if err != nil {
		t.Fatalf("CreateLocalAIChat() error = %v", err)
	}

	turns, err := service.LocalAIChatGenerateImage(chat.ID, "  a red fox  ", "")
	if err != nil {
		t.Fatalf("LocalAIChatGenerateImage() error = %v", err)
	}
	if len(turns) != 2 || turns[0].Role != "user" || turns[0].Content != "a red fox" || turns[1].Role != "assistant" || len(turns[1].Attachments) != 1 {
		t.Fatalf("turns = %+v, want a user prompt then an assistant image", turns)
	}
	image := turns[1].Attachments[0]
	if image.Kind != "image" || image.MediaType != "image/png" || image.Data != testImagePNG || image.Size <= 0 {
		t.Fatalf("image attachment = %+v", image)
	}
	saved, err := service.LoadLocalAIChatMessages(chat.ID)
	if err != nil || len(saved) != 2 || saved[1].Attachments[0].Data != testImagePNG {
		t.Fatalf("saved messages = %+v, error = %v", saved, err)
	}
	chats, err := service.ListLocalAIChats()
	if err != nil || len(chats) != 1 || chats[0].Title != "a red fox" {
		t.Fatalf("chats = %+v, error = %v; want the title from the prompt", chats, err)
	}
	if _, err := service.AppendLocalAIChatMessage(chat.ID, LocalAIChatMessage{Role: "assistant", Content: "x", Attachments: []LocalAIChatAttachment{image}}); err == nil {
		t.Fatal("public append accepted an assistant image")
	}
	if _, err := service.LocalAIChatGenerateImage(chat.ID, "   ", ""); err == nil {
		t.Fatal("empty prompt was accepted")
	}
	if _, err := service.LocalAIChatGenerateImage("0123456789abcdef0123456789abcdef", "a fox", ""); !errors.Is(err, errLocalAIChatNotFound) {
		t.Fatalf("missing chat error = %v, want errLocalAIChatNotFound", err)
	}
}

func TestLocalAIChatGenerateImageRequiresConfiguredEngine(t *testing.T) {
	preferences, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	service := &AppService{dataDir: t.TempDir(), preferences: preferences}
	chat, err := service.CreateLocalAIChat("", "chat")
	if err != nil {
		t.Fatalf("CreateLocalAIChat() error = %v", err)
	}
	if _, err := service.LocalAIChatGenerateImage(chat.ID, "a fox", ""); !errors.Is(err, errImageEngineNotConfigured) {
		t.Fatalf("LocalAIChatGenerateImage() error = %v, want errImageEngineNotConfigured", err)
	}
}

func TestGenerateRoomImageValidatesPromptBeforeGenerating(t *testing.T) {
	preferences, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	service := &AppService{dataDir: t.TempDir(), preferences: preferences}
	if _, err := service.GenerateRoomImage("   ", ""); err == nil {
		t.Fatal("empty prompt was accepted")
	}
	if _, err := service.GenerateRoomImage("a fox", ""); !errors.Is(err, errImageEngineNotConfigured) {
		t.Fatalf("GenerateRoomImage() error = %v, want errImageEngineNotConfigured", err)
	}
}

func TestSendRoomImageValidatesInputBeforeSending(t *testing.T) {
	service := &AppService{dataDir: t.TempDir()}
	if err := service.SendRoomImage("", testImagePNG); err == nil {
		t.Fatal("empty room was accepted")
	}
	if err := service.SendRoomImage("!room:example.org", ""); err == nil {
		t.Fatal("empty image was accepted")
	}
	if err := service.SendRoomImage("!room:example.org", "not base64!"); err == nil {
		t.Fatal("invalid image data was accepted")
	}
	// Reaching the account check means the send step did not try to generate.
	err := service.SendRoomImage("!room:example.org", testImagePNG)
	if err == nil || !strings.Contains(err.Error(), "account unavailable") {
		t.Fatalf("SendRoomImage() error = %v, want unavailable-account error", err)
	}
}

func TestGenerateRoomImageReturnsGeneratedImage(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	preferences, err := NewPreferenceStore(filepath.Join(t.TempDir(), "preferences.json"))
	if err != nil {
		t.Fatalf("NewPreferenceStore() error = %v", err)
	}
	if err := preferences.Set("ai.image.binary_path", settings.BinaryPath); err != nil {
		t.Fatalf("Set(ai.image.binary_path) error = %v", err)
	}
	if err := preferences.Set("ai.image.model_path", settings.ModelPath); err != nil {
		t.Fatalf("Set(ai.image.model_path) error = %v", err)
	}
	service := &AppService{dataDir: t.TempDir(), preferences: preferences}
	defer service.imageEngine.stop()

	encoded, err := service.GenerateRoomImage("  a red fox  ", "")
	if err != nil {
		t.Fatalf("GenerateRoomImage() error = %v", err)
	}
	if encoded != testImagePNG {
		t.Fatalf("encoded image = %q, want the generated image", encoded)
	}
	if !service.imageEngine.running() {
		t.Fatal("image engine was not started")
	}
}
