package desktop

import (
	"net"
	"strconv"
	"strings"
	"time"
)

// lastLine returns the last non-empty line of output, or an empty string.
func (l *imageEngineLog) lastLine() string {
	if l == nil {
		return ""
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	lines := strings.Split(strings.TrimSpace(string(l.tail)), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// freeLoopbackPort asks the OS for an unused loopback port.
func freeLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = listener.Close() }()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

// imageSettingsFromPreferences reads the image generation preferences. An unset or invalid value uses the default.
// Sampling values that are unset stay zero, so the engine's own defaults apply.
func imageSettingsFromPreferences(preferences map[string]any) (imageSettings, error) {
	settings := imageSettings{
		BinaryPath:     strings.TrimSpace(stringPreference(preferences, "ai.image.binary_path", "")),
		ModelPath:      strings.TrimSpace(stringPreference(preferences, "ai.image.model_path", "")),
		IdleTimeout:    imageEngineDefaultIdle,
		Width:          imageEngineDefaultSize,
		Height:         imageEngineDefaultSize,
		SampleMethod:   strings.TrimSpace(stringPreference(preferences, "ai.image.sampler", "")),
		NegativePrompt: strings.TrimSpace(stringPreference(preferences, "ai.image.negative_prompt", "")),
	}
	if minutes, err := strconv.Atoi(stringPreference(preferences, "ai.image.idle_minutes", "")); err == nil && minutes > 0 {
		settings.IdleTimeout = time.Duration(minutes) * time.Minute
	}
	if steps, err := strconv.Atoi(stringPreference(preferences, "ai.image.steps", "")); err == nil && steps > 0 {
		settings.Steps = steps
	}
	if scale, err := strconv.ParseFloat(stringPreference(preferences, "ai.image.cfg_scale", ""), 64); err == nil && scale > 0 {
		settings.CFGScale = scale
	}
	if widthText, heightText, found := strings.Cut(stringPreference(preferences, "ai.image.size", ""), "x"); found {
		width, widthErr := strconv.Atoi(widthText)
		height, heightErr := strconv.Atoi(heightText)
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			settings.Width = width
			settings.Height = height
		}
	}
	if settings.BinaryPath == "" || settings.ModelPath == "" {
		return imageSettings{}, errImageEngineNotConfigured
	}
	return settings, nil
}
