package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"mychat/desktop"
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

func main() {
	desktop.AppVersion = Version

	paths, err := migration.CurrentPaths()
	if err != nil {
		log.Fatal(err)
	}
	migrationReport, err := migration.MigrateLegacy(paths)
	if err != nil {
		log.Fatal(err)
	}
	if migrationReport.DatabaseMigrated {
		log.Printf("migrated Matrix data into %s", paths.DataDir)
	}
	if migrationReport.PreferencesWarning != nil {
		log.Printf("could not migrate legacy preferences: %v", migrationReport.PreferencesWarning)
	}

	client, err := matrix.New(filepath.Join(paths.DataDir, "matrix.db"))
	if err != nil {
		log.Fatal(err)
	}
	mediaCacheDir := ""
	if cacheDir, cacheErr := os.UserCacheDir(); cacheErr == nil && cacheDir != "" {
		mediaCacheDir = filepath.Join(cacheDir, "gomuks-desktop", "media")
		client.SetMediaCacheDir(mediaCacheDir)
	}

	if err = desktop.Run(client, frontendAssets, paths.DataDir, paths.PreferencesFile, mediaCacheDir); err != nil {
		log.Fatal(err)
	}
}
