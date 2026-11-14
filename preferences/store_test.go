package preferences

import (
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
)

func FuzzValidateLocalHTTPEndpoint(f *testing.F) {
	for _, raw := range []string{"http://localhost:11434", "http://127.0.0.1:8080/", "http://[::1]:8080", "https://localhost", "http://example.org", "http://user@localhost", "http://localhost/path", "http://localhost?secret=value", ""} {
		f.Add(raw)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		if ValidateLocalHTTPEndpoint(raw) != nil {
			return
		}
		parsed, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
			t.Fatalf("accepted unsafe local endpoint %q", raw)
		}
		host := strings.ToLower(parsed.Hostname())
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			t.Fatalf("accepted non-loopback endpoint %q", raw)
		}
	})
}

func TestValidateHideImagesAndVideosPreference(t *testing.T) {
	const key = "appearance.hide_images_and_videos"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean value")
	}
}

func TestValidateSoundEffectsPreference(t *testing.T) {
	for _, value := range []string{"Off", "Sent messages", "Incoming and sent messages"} {
		if err := Validate("sounds.effects", value); err != nil {
			t.Errorf("Validate(sounds.effects, %q) error = %v", value, err)
		}
	}
	if err := Validate("sounds.effects", "Incoming only"); err == nil {
		t.Fatal("Validate() accepted an unsupported sound effect preference")
	}
}

func TestValidateIncognitoPreference(t *testing.T) {
	const key = "privacy.incognito"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean Incognito preference")
	}
}

func TestValidateImageEnginePreferences(t *testing.T) {
	for _, key := range []string{"ai.image.binary_path", "ai.image.model_path"} {
		if err := Validate(key, ""); err != nil {
			t.Errorf("Validate(%q, empty) error = %v", key, err)
		}
		if err := Validate(key, filepath.Join(t.TempDir(), "sd-server")); err != nil {
			t.Errorf("Validate(%q, absolute path) error = %v", key, err)
		}
		if err := Validate(key, "relative/sd-server"); err == nil {
			t.Errorf("Validate(%q) accepted a relative path", key)
		}
		if err := Validate(key, 42); err == nil {
			t.Errorf("Validate(%q) accepted a non-string value", key)
		}
	}
	for _, value := range []string{"", "1", "3", "5", "10", "30"} {
		if err := Validate("ai.image.idle_minutes", value); err != nil {
			t.Errorf("Validate(ai.image.idle_minutes, %q) error = %v", value, err)
		}
	}
	if err := Validate("ai.image.idle_minutes", "7"); err == nil {
		t.Fatal("Validate() accepted an unsupported image idle timeout")
	}
	for _, value := range []string{"", "512x512", "512x768", "768x512", "768x768", "768x1024", "1024x768", "1024x1024"} {
		if err := Validate("ai.image.size", value); err != nil {
			t.Errorf("Validate(ai.image.size, %q) error = %v", value, err)
		}
	}
	if err := Validate("ai.image.size", "640x640"); err == nil {
		t.Fatal("Validate() accepted an unsupported image size")
	}
	for _, value := range []string{"", "4", "8", "12", "20", "30", "40"} {
		if err := Validate("ai.image.steps", value); err != nil {
			t.Errorf("Validate(ai.image.steps, %q) error = %v", value, err)
		}
	}
	if err := Validate("ai.image.steps", "25"); err == nil {
		t.Fatal("Validate() accepted an unsupported image step count")
	}
	for _, value := range []string{"", "1", "3", "5", "7", "9"} {
		if err := Validate("ai.image.cfg_scale", value); err != nil {
			t.Errorf("Validate(ai.image.cfg_scale, %q) error = %v", value, err)
		}
	}
	if err := Validate("ai.image.cfg_scale", "2.2"); err == nil {
		t.Fatal("Validate() accepted an unsupported image guidance scale")
	}
	for _, value := range []string{"", "euler", "euler_a", "heun", "dpm2", "dpm++2m", "lcm"} {
		if err := Validate("ai.image.sampler", value); err != nil {
			t.Errorf("Validate(ai.image.sampler, %q) error = %v", value, err)
		}
	}
	if err := Validate("ai.image.sampler", "ddpm"); err == nil {
		t.Fatal("Validate() accepted an unsupported image sampler")
	}
	if err := Validate("ai.image.negative_prompt", "blurry, low quality"); err != nil {
		t.Errorf("Validate(ai.image.negative_prompt) error = %v", err)
	}
	if err := Validate("ai.image.negative_prompt", strings.Repeat("a", 1001)); err == nil {
		t.Fatal("Validate() accepted an image negative prompt over 1000 characters")
	}
	if err := Validate("ai.image.negative_prompt", 42); err == nil {
		t.Fatal("Validate() accepted a non-string image negative prompt")
	}
}

func TestValidateMessageBookmarkPreference(t *testing.T) {
	const key = "message.bookmark.%21room%3Aexample.org.%24event%3Aexample.org"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate("message.bookmark.", true); err == nil {
		t.Fatal("Validate() accepted a bookmark preference without a message ID")
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean bookmark preference")
	}
}

func TestValidateLocalAIChatFavoritePreference(t *testing.T) {
	const key = "ai.local_chat.favorite.chat-1"
	for _, value := range []bool{true, false} {
		if err := Validate(key, value); err != nil {
			t.Errorf("Validate(%q, %t) error = %v", key, value, err)
		}
	}
	if err := Validate("ai.local_chat.favorite.", true); err == nil {
		t.Fatal("Validate() accepted a local AI favorite without a chat ID")
	}
	if err := Validate(key, "true"); err == nil {
		t.Fatal("Validate() accepted a non-boolean local AI favorite")
	}
}

func TestValidateAppearanceThemePreference(t *testing.T) {
	validThemes := []string{"System default", "Light", "Dark", "VS Code", "OLED black", "Bosco", "Rosa", "Dracula", "Midnight", "Slate", "Solarized", "Sepia"}
	for _, theme := range validThemes {
		if err := Validate("appearance.theme", theme); err != nil {
			t.Errorf("Validate(appearance.theme, %q) error = %v", theme, err)
		}
	}
	if err := Validate("appearance.theme", "Unknown theme"); err == nil {
		t.Fatal("Validate() accepted an unsupported theme")
	}
}

func TestValidateAITranscriptionModelPreference(t *testing.T) {
	if err := Validate("ai.transcription_model", "whisper-1"); err != nil {
		t.Fatalf("Validate(ai.transcription_model) error = %v", err)
	}
	if err := Validate("ai.transcription_model", true); err == nil {
		t.Fatal("Validate() accepted a non-string transcription model")
	}
}

func TestValidateTutorLanguagePreferences(t *testing.T) {
	for _, key := range []string{"ai.tutor_language", "ai.default_language"} {
		for _, value := range []string{"", "es", "tr"} {
			if err := Validate(key, value); err != nil {
				t.Errorf("Validate(%q, %q) error = %v", key, value, err)
			}
		}
		if err := Validate(key, "xx"); err == nil {
			t.Errorf("Validate(%q) accepted an unsupported language", key)
		}
		if err := Validate(key, true); err == nil {
			t.Errorf("Validate(%q) accepted a non-string language", key)
		}
	}

	for _, value := range []string{`["en"]`, `["en","it","tr"]`} {
		if err := Validate("ai.known_languages", value); err != nil {
			t.Errorf("Validate(ai.known_languages, %s) error = %v", value, err)
		}
	}
	for _, value := range []string{``, `[]`, `not json`, `["xx"]`, `["en","en"]`, `"en"`} {
		if err := Validate("ai.known_languages", value); err == nil {
			t.Errorf("Validate(ai.known_languages, %q) accepted invalid languages", value)
		}
	}
	if err := Validate("ai.known_languages", []string{"en"}); err == nil {
		t.Error("Validate(ai.known_languages) accepted a non-string value")
	}
}

func TestValidateAIFeaturePreferences(t *testing.T) {
	for _, key := range []string{
		"ai.feature.agent.prompt",
		"ai.feature.tone_guard.temperature",
		"ai.feature.chat_translation.max_tokens",
		"ai.feature.language_tutor.prompt",
	} {
		if err := Validate(key, ""); err != nil {
			t.Errorf("Validate(%q, blank) error = %v", key, err)
		}
	}
	if err := Validate("ai.feature.tone_guard.temperature", "0.6"); err != nil {
		t.Fatalf("Validate(tone_guard.temperature, 0.6) error = %v", err)
	}
	if err := Validate("ai.feature.tone_guard.temperature", "0.5"); err == nil {
		t.Fatal("Validate() accepted an AI temperature below 0.6")
	}
	if err := Validate("ai.feature.summarize.max_tokens", "512"); err != nil {
		t.Fatalf("Validate(summarize.max_tokens, 512) error = %v", err)
	}
	if err := Validate("ai.feature.agent.prompt", strings.Repeat("a", 8001)); err == nil {
		t.Fatal("Validate() accepted an AI prompt longer than 8000 characters")
	}
	if err := Validate("ai.feature.tone_guard.temperature", "2.5"); err == nil {
		t.Fatal("Validate() accepted an out-of-range AI temperature")
	}
	if err := Validate("ai.feature.summarize.max_tokens", "9000"); err == nil {
		t.Fatal("Validate() accepted an AI token limit above 8192")
	}
	if err := Validate("ai.feature.unknown_feature.prompt", "text"); err == nil {
		t.Fatal("Validate() accepted an unknown AI feature")
	}
	if err := Validate("ai.feature.agent.temperature", 0.5); err == nil {
		t.Fatal("Validate() accepted a non-string AI temperature")
	}
}

func TestValidateEmoticonReplacements(t *testing.T) {
	const key = "emoji.emoticon_replacements"
	if err := Validate(key, `[[":)","😎"],[":shrug:","🤷"]]`); err != nil {
		t.Fatalf("Validate(valid emoticon replacements) error = %v", err)
	}
	for _, value := range []any{
		true,
		"{",
		`[[":)"]]`,
		`[[" :) ","🙂"]]`,
		`[[":)","🙂"],[":)","🙁"]]`,
		`[[":)","🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂"]]`,
	} {
		if err := Validate(key, value); err == nil {
			t.Errorf("Validate(%s, %#v) unexpectedly succeeded", key, value)
		}
	}
}
