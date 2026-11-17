package desktop

import (
	"fmt"
	"log"
	sharedpreferences "mychat/preferences"
	"path/filepath"
	"sync"
)

func openSharedPreferences(dataDir, preferencesPath string) (*sharedpreferences.Store, error) {
	sharedPreferences, err := sharedpreferences.Open(filepath.Join(dataDir, "preferences.db"))
	if err != nil {
		return nil, fmt.Errorf("open shared preferences: %w", err)
	}
	if preferencesPath != "" {
		if _, importErr := sharedPreferences.ImportLegacy(preferencesPath, primaryAccountID); importErr != nil {
			log.Printf("could not import legacy preferences: %v", importErr)
		}
	}
	if _, cleanupErr := sharedPreferences.DeleteRetired(); cleanupErr != nil {
		log.Printf("could not remove preferences for retired features: %v", cleanupErr)
	}
	if cleanupErr := removeRetiredFeatureFiles(dataDir); cleanupErr != nil {
		log.Printf("could not remove data files for retired features: %v", cleanupErr)
	}
	return sharedPreferences, nil
}

func newShutdown(service *AppService) func() {
	var shutdownOnce sync.Once
	return func() {
		shutdownOnce.Do(func() {
			service.close()
			service.closeAccountClients()
		})
	}
}
