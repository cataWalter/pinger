package desktop

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"mychat/notifications"
	sharedpreferences "mychat/preferences"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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

func newShutdown(service *AppService, notifier notifications.Notifier) func() {
	var shutdownOnce sync.Once
	return func() {
		shutdownOnce.Do(func() {
			service.close()
			service.closeAccountClients()
			if lifecycle, ok := notifier.(notifications.Lifecycle); ok {
				if closeErr := lifecycle.Close(); closeErr != nil {
					log.Printf("stop native notifications: %v", closeErr)
				}
			}
		})
	}
}

func newApplication(service *AppService, frontend fs.FS, applicationIcon []byte, shutdown func()) *application.App {
	staticAssets := application.AssetFileServerFS(frontend)
	mediaAssets := newMediaAssetHandler(service)

	app := application.New(application.Options{
		Name:        "Pinger",
		Description: "A Matrix desktop client",
		Icon:        applicationIcon,
		Services: []application.Service{
			application.NewService(service),
			application.NewService(NewLanguageTutorService(service)),
		},
		Assets: application.AssetOptions{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, mediaAssetPathPrefix) {
					mediaAssets.ServeHTTP(w, r)
					return
				}
				staticAssets.ServeHTTP(w, r)
			}),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		Linux: application.LinuxOptions{
			ApplicationID: "fi.mau.pinger",
		},
		OnShutdown: shutdown,
	})
	if len(applicationIcon) > 0 {
		app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
			application.InvokeAsync(func() {
				app.SetIcon(applicationIcon)
			})
		})
	}
	return app
}

func wireOpenHooks(service *AppService, app *application.App) {
	service.openURL = func(url string) error {
		if runtime.GOOS != "darwin" {
			return app.Browser.OpenURL(url)
		}
		output, openErr := exec.Command("open", url).CombinedOutput()
		if openErr != nil {
			if detail := strings.TrimSpace(string(output)); detail != "" {
				return fmt.Errorf("open link: %w: %s", openErr, detail)
			}
			return fmt.Errorf("open link: %w", openErr)
		}
		return nil
	}
	service.revealFile = func(path string) error {
		switch runtime.GOOS {
		case "darwin":
			return exec.Command("open", "-R", path).Run()
		case "windows":
			return exec.Command("explorer", "/select,"+path).Start()
		default:
			return app.Browser.OpenURL((&url.URL{Scheme: "file", Path: filepath.Dir(path)}).String())
		}
	}
}

func startNotifier(ctx context.Context, notifier notifications.Notifier) {
	if lifecycle, ok := notifier.(notifications.Lifecycle); ok {
		if startErr := lifecycle.Start(ctx); startErr != nil {
			log.Printf("native notifications unavailable: %v", startErr)
		}
	}
}

func wireLifecycleHooks(service *AppService, app *application.App) {
	service.quit = app.Quit
	service.emitReminder = func(reminder ScheduledJob) {
		app.Event.Emit(scheduledReminderEventName, reminder)
	}
	service.setAutostart = func(enabled bool) error {
		if enabled {
			return app.Autostart.Enable()
		}
		return app.Autostart.Disable()
	}
	launchAtStartup, _ := service.preferenceValues()["system.launch_at_startup"].(bool)
	if err := service.setAutostart(launchAtStartup); err != nil {
		log.Printf("apply launch at startup preference: %v", err)
	}
}

func newMainWindow(app *application.App, applicationIcon []byte, hidden bool) *application.WebviewWindow {
	return app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               "main",
		Title:              "Pinger",
		Width:              1100,
		Height:             720,
		AlwaysOnTop:        false,
		MinWidth:           760,
		MinHeight:          520,
		URL:                "/",
		BackgroundColour:   application.NewRGB(238, 243, 239),
		EnableFileDrop:     true,
		UseApplicationMenu: true,
		Hidden:             hidden,
		Mac: application.MacWindow{
			WindowLevel: application.MacWindowLevelNormal,
			// Draw the content under a transparent title bar so the sidebar and chat header sit at the top edge.
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				HideTitle:          true,
				FullSizeContent:    true,
			},
		},
		Linux: application.LinuxWindow{
			Icon: applicationIcon,
		},
	})
}
