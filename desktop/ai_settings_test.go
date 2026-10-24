package desktop

import "testing"

func TestAIFeatureDefaultsMeetTemperatureMinimum(t *testing.T) {
	for _, feature := range aiBackendFeatureDefaults {
		if feature.Temperature < aiFeatureMinTemperature {
			t.Fatalf("%s default temperature = %v, want at least %v", feature.ID, feature.Temperature, aiFeatureMinTemperature)
		}
	}
}

func TestAIFeatureTuningIgnoresTemperatureBelowMinimum(t *testing.T) {
	defaults, ok := aiBackendFeature(aiFeatureGhostwriter)
	if !ok {
		t.Fatal("ghostwriter feature is not registered")
	}
	for _, value := range []string{"0", "0.5", "0.59", "2.5", "NaN"} {
		tuning := aiFeatureTuningFor(map[string]any{"ai.feature.ghostwriter.temperature": value}, aiFeatureGhostwriter)
		if tuning.Temperature != defaults.Temperature {
			t.Fatalf("temperature %q resolved to %v, want default %v", value, tuning.Temperature, defaults.Temperature)
		}
	}
	tuning := aiFeatureTuningFor(map[string]any{"ai.feature.ghostwriter.temperature": "0.6"}, aiFeatureGhostwriter)
	if tuning.Temperature != 0.6 {
		t.Fatalf("temperature 0.6 resolved to %v, want 0.6", tuning.Temperature)
	}
}

func TestAIRunOptionsRejectTemperatureBelowMinimum(t *testing.T) {
	if _, err := aiRunOptions(0.5, 0); err == nil {
		t.Fatal("temperature 0.5 was accepted, want rejection")
	}
	options, err := aiRunOptions(0.6, 0)
	if err != nil {
		t.Fatalf("temperature 0.6 was rejected: %v", err)
	}
	if options.Temperature != 0.6 {
		t.Fatalf("temperature = %v, want 0.6", options.Temperature)
	}
}
