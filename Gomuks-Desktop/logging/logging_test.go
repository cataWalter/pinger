package logging

import (
	"bytes"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func TestConfigureUsesRequestedLogLevel(t *testing.T) {
	previousLevel := zerolog.GlobalLevel()
	previousLogger := log.Logger
	t.Cleanup(func() {
		zerolog.SetGlobalLevel(previousLevel)
		log.Logger = previousLogger
	})
	t.Setenv("PINGER_LOG_LEVEL", "debug")

	if err := Configure(); err != nil {
		t.Fatalf("Configure() error = %v", err)
	}
	if got := zerolog.GlobalLevel(); got != zerolog.DebugLevel {
		t.Fatalf("global log level = %s, want %s", got, zerolog.DebugLevel)
	}
}

func TestConfigureRejectsInvalidLogLevel(t *testing.T) {
	t.Setenv("PINGER_LOG_LEVEL", "verbose")

	if err := Configure(); err == nil {
		t.Fatal("Configure() error = nil, want invalid-level error")
	}
}

func TestNewWritesReadableComponentLogs(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, "matrix")
	logger.Info().Str("state", "connected").Msg("sync started")

	line := output.String()
	for _, part := range []string{"INF", "matrix", "connected", "sync started"} {
		if !strings.Contains(line, part) {
			t.Errorf("console log %q does not contain %q", line, part)
		}
	}
}
