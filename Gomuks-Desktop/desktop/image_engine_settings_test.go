package desktop

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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
