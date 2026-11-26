package desktop

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"mychat/notifications"
	"os"
	"path/filepath"
	"time"
)

func Run(assets fs.FS, applicationIcon []byte, dataDir, defaultDataDir, preferencesPath, mediaCacheRoot string) error {
	return run(assets, applicationIcon, dataDir, defaultDataDir, preferencesPath, mediaCacheRoot, nil)
}

func RunSmokeTest(assets fs.FS, applicationIcon []byte) error {
	dataDir, err := os.MkdirTemp("", "pinger-smoke-*")
	if err != nil {
		return fmt.Errorf("create smoke-test profile: %w", err)
	}
	defer os.RemoveAll(dataDir)
	return run(assets, applicationIcon, dataDir, dataDir, filepath.Join(dataDir, "preferences.json"), filepath.Join(dataDir, "media"), make(chan struct{}, 1))
}

func run(assets fs.FS, applicationIcon []byte, dataDir, defaultDataDir, preferencesPath, mediaCacheRoot string, smokeSnapshot chan struct{}) error {
	frontend, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return fmt.Errorf("open embedded frontend assets: %w", err)
	}
	sharedPreferences, err := openSharedPreferences(dataDir, preferencesPath)
	if err != nil {
		return err
	}
	scheduledJobs, err := newScheduledJobStore(filepath.Join(filepath.Dir(preferencesPath), "scheduled-jobs.json"))
	if err != nil {
		_ = sharedPreferences.Close()
		return fmt.Errorf("open scheduled jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	notifier := notifications.New()
	service := &AppService{dataDir: dataDir, defaultDataDir: defaultDataDir, sharedPreferences: sharedPreferences, notifier: notifier, ctx: ctx, cancel: cancel, scheduled: scheduledJobs}
	service.smokeSnapshot = smokeSnapshot
	service.imageEngine.stateFile = imageEngineRecordPath(defaultDataDir)
	if reapErr := reapOrphanedImageEngine(service.imageEngine.stateFile); reapErr != nil {
		log.Printf("reap orphaned image engine: %v", reapErr)
	}
	if err = service.initializeAccounts(dataDir, mediaCacheRoot); err != nil {
		cancel()
		_ = sharedPreferences.Close()
		return fmt.Errorf("initialize Matrix account: %w", err)
	}
	shutdown := newShutdown(service, notifier)
	if smokeSnapshot != nil {
		closeService := shutdown
		shutdown = func() {
			closeService()
			_ = os.RemoveAll(dataDir)
		}
	}
	preferences := service.preferenceValues()
	backdrop := windowBackdropFor(preferences)
	app := newApplication(service, frontend, applicationIcon, shutdown, backdrop, windowsBrowserArgsFor(preferences))

	if smokeSnapshot != nil {
		newMainWindow(app, applicationIcon, false, backdrop, linuxWebviewGpuPolicyFor(preferences))
		smokeResult := make(chan error, 1)
		go func() {
			timer := time.NewTimer(20 * time.Second)
			defer timer.Stop()
			select {
			case <-smokeSnapshot:
				fmt.Println("Pinger packaged startup smoke passed")
				smokeResult <- nil
			case <-timer.C:
				err := fmt.Errorf("embedded frontend did not request a startup snapshot")
				fmt.Fprintln(os.Stderr, err)
				smokeResult <- err
			case <-ctx.Done():
				smokeResult <- fmt.Errorf("application quit before the startup snapshot")
			}
			if ctx.Err() == nil {
				app.Quit()
			}
		}()
		err = app.Run()
		shutdown()
		if err != nil {
			return err
		}
		return <-smokeResult
	}

	eventBatcher := NewEventBatcher(ctx, defaultEventBatchFlushInterval)
	eventBatcher.SetEmitter(func(eventName string, payload BatchedPayload) {
		app.Event.Emit(eventName, payload)
	})
	eventBatcher.Start(ctx)
	wireOpenHooks(service, app)
	startNotifier(ctx, notifier)
	wireLifecycleHooks(service, app)

	shell := &desktopShell{
		ctx:             ctx,
		service:         service,
		app:             app,
		notifier:        notifier,
		eventBatcher:    eventBatcher,
		applicationIcon: applicationIcon,
		lastUnread:      -1,
		lastNeedsReply:  -1,
	}
	shell.window = newMainWindow(app, applicationIcon, shell.startsHidden(), backdrop, linuxWebviewGpuPolicyFor(preferences))
	shell.setupTray()
	shell.wireNotificationClicks()
	shell.setupMenus()
	shell.setupDockBadge()
	shell.wireMenuCallbacks()
	shell.wireMenuBarAndDialogs()
	shell.wireWindowHooks()
	shell.wireEventPumps()

	service.startScheduledJobWorker()
	service.startSync()

	err = app.Run()
	shutdown()
	if service.restartRequested.Load() {
		if restartErr := relaunch(); restartErr != nil {
			return fmt.Errorf("restart Pinger: %w", restartErr)
		}
	}
	return err
}
