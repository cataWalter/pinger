package main

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"mychat/datadir"
	"mychat/desktop"
	"mychat/logging"
	"mychat/matrix"
	"mychat/migration"
)

var (
	Version   = "dev"
	Commit    = "unknown"
	BuildDate = "unknown"
)

//go:embed all:frontend/dist
var frontendAssets embed.FS

//go:embed build/appicon.png
var applicationIcon []byte

func main() {
	if err := logging.Configure(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	logger := logging.For("startup")
	logger.Info().
		Str("version", Version).
		Str("commit", Commit).
		Str("platform", runtime.GOOS+"/"+runtime.GOARCH).
		Msg("starting Pinger")

	desktop.AppVersion = Version
	desktop.AppCommit = Commit
	desktop.AppBuildDate = BuildDate

	// A previous instance may still hold the data files when Pinger is restarted.
	desktop.WaitForPreviousInstance()

	paths, err := migration.CurrentPaths()
	if err != nil {
		logger.Fatal().Err(err).Msg("resolve application data paths")
	}
	defaultDataDir := paths.DataDir
	dataDir, err := datadir.ApplyPending(defaultDataDir)
	if err != nil {
		logger.Error().Err(err).Str("data_dir", dataDir).Msg("could not apply the selected data folder; continuing with the current folder")
	}
	paths = paths.WithDataDir(dataDir)
	migrationReport, err := migration.MigrateLegacy(paths)
	if err != nil {
		logger.Fatal().Err(err).Msg("migrate legacy application data")
	}
	if migrationReport.DatabaseMigrated {
		logger.Info().Msg("migrated legacy Matrix database")
	}
	if migrationReport.PreferencesWarning != nil {
		logger.Warn().Err(migrationReport.PreferencesWarning).Msg("could not migrate legacy preferences")
	}

	client, err := matrix.New(filepath.Join(dataDir, "matrix.db"))
	if err != nil {
		logger.Fatal().Err(err).Msg("initialize Matrix client")
	}
	logger.Info().Msg("application data and Matrix database ready")
	mediaCacheDir := ""
	if cacheDir, cacheErr := os.UserCacheDir(); cacheErr == nil && cacheDir != "" {
		mediaCacheDir = filepath.Join(cacheDir, "gomuks-desktop", "media")
		client.SetMediaCacheDir(mediaCacheDir)
	}

	if err = desktop.Run(client, frontendAssets, applicationIcon, dataDir, defaultDataDir, paths.PreferencesFile, mediaCacheDir); err != nil {
		logger.Fatal().Err(err).Msg("run desktop application")
	}
	logger.Info().Msg("Pinger exited")
}
