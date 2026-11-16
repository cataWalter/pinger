package migration

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mychat/sqliteutil"
	"os"
	"path/filepath"
	"runtime"
)

const (
	dataDirectoryName       = "gomuks-desktop"
	legacyDataDirectoryName = "fyne-matrix"
	legacyFyneAppID         = "fi.mau.fyne-matrix"
	databaseFileName        = "matrix.db"
	preferencesFileName     = "preferences.json"
	cryptoKeyFileName       = "crypto.key"
)

type Paths struct {
	DataDir               string
	LegacyDataDir         string
	PreferencesFile       string
	LegacyPreferencesFile string
}

type Report struct {
	DatabaseMigrated    bool
	CryptoKeyMigrated   bool
	PreferencesMigrated bool
	PreferencesWarning  error
}

func CurrentPaths() (Paths, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return Paths{}, fmt.Errorf("resolve user config directory: %w", err)
	}

	homeDir := ""
	if runtime.GOOS == "darwin" {
		homeDir, err = os.UserHomeDir()
		if err != nil {
			return Paths{}, fmt.Errorf("resolve user home directory: %w", err)
		}
	}
	return PathsFor(runtime.GOOS, homeDir, configDir), nil
}

func PathsFor(goos, homeDir, configDir string) Paths {
	dataDir := filepath.Join(configDir, dataDirectoryName)
	fyneConfigDir := filepath.Join(configDir, "fyne")
	if goos == "darwin" {
		fyneConfigDir = filepath.Join(homeDir, "Library", "Preferences", "fyne")
	}

	return Paths{
		DataDir:               dataDir,
		LegacyDataDir:         filepath.Join(configDir, legacyDataDirectoryName),
		PreferencesFile:       filepath.Join(dataDir, preferencesFileName),
		LegacyPreferencesFile: filepath.Join(fyneConfigDir, legacyFyneAppID, preferencesFileName),
	}
}

// WithDataDir returns the paths that use the given data directory, so the application
// can keep its data in a folder the user picked.
func (p Paths) WithDataDir(dataDir string) Paths {
	if dataDir == "" {
		return p
	}
	p.DataDir = dataDir
	p.PreferencesFile = filepath.Join(dataDir, preferencesFileName)
	return p
}

func MigrateLegacy(paths Paths) (Report, error) {
	var report Report
	if paths.DataDir == "" || paths.LegacyDataDir == "" {
		return report, errors.New("migration requires new and legacy data directories")
	}
	if filepath.Clean(paths.DataDir) == filepath.Clean(paths.LegacyDataDir) {
		return report, errors.New("new and legacy data directories must differ")
	}

	destinationDatabase := filepath.Join(paths.DataDir, databaseFileName)
	legacyDatabase := filepath.Join(paths.LegacyDataDir, databaseFileName)
	destinationExists, sidecarExists, err := databaseDestinationState(destinationDatabase)
	if err != nil {
		return report, err
	}
	if sidecarExists && !destinationExists {
		return report, fmt.Errorf("SQLite sidecar exists without destination database at %q", destinationDatabase)
	}
	if !destinationExists {
		legacyExists, err := regularFileExists(legacyDatabase)
		if err != nil {
			return report, fmt.Errorf("inspect legacy Matrix database: %w", err)
		}
		if legacyExists {
			keyMigrated, err := migrateCryptoKey(
				filepath.Join(paths.LegacyDataDir, cryptoKeyFileName),
				filepath.Join(paths.DataDir, cryptoKeyFileName),
			)
			if err != nil {
				return report, err
			}
			report.CryptoKeyMigrated = keyMigrated

			report.DatabaseMigrated, err = migrateSQLiteDatabase(legacyDatabase, destinationDatabase)
			if err != nil {
				return report, fmt.Errorf("migrate legacy Matrix database: %w", err)
			}
		}
	}

	if paths.PreferencesFile != "" && paths.LegacyPreferencesFile != "" {
		report.PreferencesMigrated, report.PreferencesWarning = migratePreferences(
			paths.LegacyPreferencesFile,
			paths.PreferencesFile,
		)
	}
	return report, nil
}

func migrateCryptoKey(source, destination string) (bool, error) {
	key, err := os.ReadFile(source)
	if errors.Is(err, fs.ErrNotExist) {
		destinationExists, destinationErr := pathExists(destination)
		if destinationErr != nil {
			return false, fmt.Errorf("inspect destination crypto key: %w", destinationErr)
		}
		if destinationExists {
			return false, errors.New("legacy Matrix database has no crypto key, but a destination key already exists")
		}
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read legacy crypto key: %w", err)
	}
	if len(key) != 32 {
		return false, fmt.Errorf("legacy crypto key at %q has invalid length %d", source, len(key))
	}

	existingKey, err := os.ReadFile(destination)
	if err == nil {
		if !bytes.Equal(existingKey, key) {
			return false, errors.New("destination crypto key differs from the legacy key; refusing to migrate the database")
		}
		return false, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return false, fmt.Errorf("read destination crypto key: %w", err)
	}

	migrated, err := writeExclusive(destination, key, 0o600)
	if err != nil {
		return false, fmt.Errorf("migrate legacy crypto key: %w", err)
	}
	if !migrated {
		existingKey, err = os.ReadFile(destination)
		if err != nil {
			return false, fmt.Errorf("read concurrent destination crypto key: %w", err)
		}
		if !bytes.Equal(existingKey, key) {
			return false, errors.New("destination crypto key differs from the legacy key; refusing to migrate the database")
		}
	}
	return migrated, nil
}

func migrateSQLiteDatabase(source, destination string) (bool, error) {
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return false, fmt.Errorf("create destination data directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".gomuks-migration-*.db")
	if err != nil {
		return false, fmt.Errorf("create temporary database: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Close(); err != nil {
		return false, fmt.Errorf("close temporary database: %w", err)
	}

	if err := sqliteutil.BackupReadOnly(source, temporaryPath); err != nil {
		return false, err
	}
	if err := os.Chmod(temporaryPath, 0o600); err != nil {
		return false, fmt.Errorf("secure migrated database: %w", err)
	}
	if err := syncFile(temporaryPath); err != nil {
		return false, fmt.Errorf("sync migrated database: %w", err)
	}

	linked, err := linkExclusive(temporaryPath, destination)
	if err != nil {
		return false, fmt.Errorf("install migrated database: %w", err)
	}
	if !linked {
		return false, nil
	}
	if err := syncDirectory(filepath.Dir(destination)); err != nil {
		return true, fmt.Errorf("sync destination data directory: %w", err)
	}
	return true, nil
}

func migratePreferences(source, destination string) (bool, error) {
	destinationExists, err := pathExists(destination)
	if err != nil {
		return false, fmt.Errorf("inspect destination preferences: %w", err)
	}
	if destinationExists {
		return false, nil
	}
	contents, err := os.ReadFile(source)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read legacy preferences: %w", err)
	}
	var values map[string]json.RawMessage
	if err = json.Unmarshal(contents, &values); err != nil {
		return false, fmt.Errorf("decode legacy preferences: %w", err)
	}
	if values == nil {
		return false, errors.New("legacy preferences must contain a JSON object")
	}
	contents, err = json.Marshal(values)
	if err != nil {
		return false, fmt.Errorf("encode migrated preferences: %w", err)
	}
	return writeExclusive(destination, append(contents, '\n'), 0o600)
}
