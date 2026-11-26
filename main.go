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

	if len(os.Args) == 2 && os.Args[1] == "--smoke-test" {
		if err := desktop.RunSmokeTest(frontendAssets, applicationIcon); err != nil {
			logger.Fatal().Err(err).Msg("packaged startup smoke failed")
		}
		return
	}

	// A previous instance may still hold the data files when Pinger is restarted.
	desktop.WaitForPreviousInstance()

	paths, err := migration.CurrentPaths()
	if err != nil {
		logger.Fatal().Err(err).Msg("resolve application data paths")
	}
	defaultDataDir := paths.DataDir
	dataDir, err := datadir.ApplyPending(defaultDataDir)
	if err != nil {
		logger.Error().Err(err).Msg("could not apply the selected data folder; using the default")
		dataDir = defaultDataDir
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

	logger.Info().Msg("application data ready")
	mediaCacheRoot := ""
	if cacheDir, cacheErr := os.UserCacheDir(); cacheErr == nil && cacheDir != "" {
		mediaCacheRoot = filepath.Join(cacheDir, "gomuks-desktop", "media")
	}

	if err = desktop.Run(frontendAssets, applicationIcon, dataDir, defaultDataDir, paths.PreferencesFile, mediaCacheRoot); err != nil {
		logger.Fatal().Err(err).Msg("run desktop application")
	}
	logger.Info().Msg("Pinger exited")
}
