package desktop

import (
	"slices"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestWindowsBrowserArgsForLowSpecModeDisablesGPURendering(t *testing.T) {
	if got := windowsBrowserArgsFor(map[string]any{"appearance.low_spec_mode": true}); !slices.Contains(got, "--disable-gpu") {
		t.Fatalf("windowsBrowserArgsFor(low spec) = %v, want --disable-gpu", got)
	}
	if got := windowsBrowserArgsFor(map[string]any{"appearance.low_spec_mode": false}); len(got) != 0 {
		t.Fatalf("windowsBrowserArgsFor(default) = %v, want none", got)
	}
}

func TestLinuxWebviewGpuPolicyForLowSpecModeDisablesHardwareAcceleration(t *testing.T) {
	if got := linuxWebviewGpuPolicyFor(map[string]any{"appearance.low_spec_mode": true}); got != application.WebviewGpuPolicyNever {
		t.Fatalf("linuxWebviewGpuPolicyFor(low spec) = %v, want %v", got, application.WebviewGpuPolicyNever)
	}
	if got := linuxWebviewGpuPolicyFor(map[string]any{"appearance.low_spec_mode": false}); got != application.WebviewGpuPolicyAlways {
		t.Fatalf("linuxWebviewGpuPolicyFor(default) = %v, want %v", got, application.WebviewGpuPolicyAlways)
	}
}

func TestWindowBackdropForLowSpecModeUsesOpaqueBackdrop(t *testing.T) {
	if got := windowBackdropFor(map[string]any{"appearance.low_spec_mode": true}); got != application.MacBackdropNormal {
		t.Fatalf("windowBackdropFor(low spec) = %v, want %v", got, application.MacBackdropNormal)
	}
}

func TestWindowBackdropForDefaultUsesMacWindowBackdrop(t *testing.T) {
	for _, preferences := range []map[string]any{nil, {}, {"appearance.low_spec_mode": false}} {
		if got := windowBackdropFor(preferences); got != macWindowBackdrop {
			t.Fatalf("windowBackdropFor(%v) = %v, want %v", preferences, got, macWindowBackdrop)
		}
	}
}
