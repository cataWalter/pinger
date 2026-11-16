package logging

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func Configure() error {
	level := zerolog.InfoLevel
	if value := strings.TrimSpace(os.Getenv("PINGER_LOG_LEVEL")); value != "" {
		switch strings.ToLower(value) {
		case "trace", "debug", "info", "warn", "error", "fatal":
		default:
			return fmt.Errorf("invalid PINGER_LOG_LEVEL %q (choose trace, debug, info, warn, error, or fatal)", value)
		}
		parsed, err := zerolog.ParseLevel(strings.ToLower(value))
		if err != nil {
			return fmt.Errorf("invalid PINGER_LOG_LEVEL %q (choose trace, debug, info, warn, error, or fatal)", value)
		}
		level = parsed
	}
	zerolog.SetGlobalLevel(level)
	log.Logger = zerolog.New(zerolog.ConsoleWriter{
		Out:        os.Stderr,
		TimeFormat: "15:04:05.000",
	}).
		Level(level).
		With().
		Timestamp().
		Logger()
	return nil
}

func New(output io.Writer, component string) zerolog.Logger {
	writer := zerolog.ConsoleWriter{
		Out:        output,
		TimeFormat: "15:04:05.000",
	}
	return zerolog.New(writer).
		Level(zerolog.GlobalLevel()).
		With().
		Timestamp().
		Str("component", component).
		Logger()
}

func For(component string) *zerolog.Logger {
	logger := log.With().Str("component", component).Logger()
	return &logger
}

func init() {
	zerolog.TimeFieldFormat = time.RFC3339Nano
}
