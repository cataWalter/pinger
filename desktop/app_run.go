package desktop

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"mychat/notifications"
	"path/filepath"
)

func Run(assets fs.FS, applicationIcon []byte, dataDir, defaultDataDir, preferencesPath, mediaCacheRoot string) error {
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
	app := newApplication(service, frontend, applicationIcon, shutdown)

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
	shell.window = newMainWindow(app, applicationIcon, shell.startsHidden())
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
