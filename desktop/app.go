package desktop

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	"mychat/matrix"
	"mychat/notifications"
	sharedpreferences "mychat/preferences"
)

const (
	hostErrorEventName          = "matrix:host-error"
	attachmentSentEventName     = "matrix:attachment-sent"
	preferencesUpdateEventName  = "preferences:update"
	scheduledReminderEventName  = "scheduler:reminder"
	notificationOpenRoomName    = "notification:open-room"
	applicationMenuAboutName    = "application-menu:about"
	applicationMenuSettingsName = "application-menu:settings"
	applicationMenuSearchName   = "application-menu:search"
)

func Run(client *matrix.Client, assets fs.FS, applicationIcon []byte, dataDir, defaultDataDir, preferencesPath, mediaCacheDir string) error {
	frontend, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return fmt.Errorf("open embedded frontend assets: %w", err)
	}
	sharedPreferences, err := sharedpreferences.Open(filepath.Join(dataDir, "preferences.db"))
	if err != nil {
		return fmt.Errorf("open shared preferences: %w", err)
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
	scheduledJobs, err := newScheduledJobStore(filepath.Join(filepath.Dir(preferencesPath), "scheduled-jobs.json"))
	if err != nil {
		_ = sharedPreferences.Close()
		return fmt.Errorf("open scheduled jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	notifier := notifications.New()
	service := &AppService{client: client, dataDir: dataDir, defaultDataDir: defaultDataDir, sharedPreferences: sharedPreferences, notifier: notifier, ctx: ctx, cancel: cancel, scheduled: scheduledJobs}
	service.imageEngine.stateFile = imageEngineRecordPath(defaultDataDir)
	if reapErr := reapOrphanedImageEngine(service.imageEngine.stateFile); reapErr != nil {
		log.Printf("reap orphaned image engine: %v", reapErr)
	}
	if err = service.initializeAccounts(dataDir, mediaCacheDir); err != nil {
		cancel()
		_ = sharedPreferences.Close()
		client.Close()
		return fmt.Errorf("initialize Matrix accounts: %w", err)
	}
	var shutdownOnce sync.Once
	shutdown := func() {
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
	eventBatcher := NewEventBatcher(ctx, defaultEventBatchFlushInterval)
	eventBatcher.SetEmitter(func(eventName string, payload BatchedPayload) {
		app.Event.Emit(eventName, payload)
	})
	eventBatcher.Start(ctx)
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
	if lifecycle, ok := notifier.(notifications.Lifecycle); ok {
		if startErr := lifecycle.Start(ctx); startErr != nil {
			log.Printf("native notifications unavailable: %v", startErr)
		}
	}
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
	if err = service.setAutostart(launchAtStartup); err != nil {
		log.Printf("apply launch at startup preference: %v", err)
	}

	// The menu-bar icon is the only way to reopen a hidden window, so hiding to tray and starting minimized require it.
	menuBarIconEnabled := func() bool {
		value, ok := service.preferenceValues()["window.menu_bar_icon"].(bool)
		return !ok || value
	}
	startMinimized, _ := service.preferenceValues()["window.start_minimized"].(bool)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
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
		Hidden:             startMinimized && menuBarIconEnabled(),
		Mac: application.MacWindow{
			WindowLevel: application.MacWindowLevelNormal,
		},
		Linux: application.LinuxWindow{
			Icon: applicationIcon,
		},
	})
	showMainWindow := func() {
		window.Show().Focus()
	}

	icons := trayIcons()
	if runtime.GOOS == "darwin" {
		icons = macOSTrayIcons()
	} else if runtime.GOOS == "linux" {
		linuxIcons, iconErr := linuxTrayIcons()
		if iconErr != nil {
			log.Printf("prepare Linux tray icons: %v", iconErr)
		} else {
			icons = linuxIcons
		}
	}
	tray := app.SystemTray.New()
	var trayHasUnread atomic.Bool
	var trayDarkMode atomic.Bool
	trayThemePreference := func() string {
		theme, _ := service.preferenceValues()["appearance.theme"].(string)
		return theme
	}
	trayDarkMode.Store(trayIconUsesDarkVariant(trayThemePreference(), app.Env.IsDarkMode()))
	setTrayIcon := func() {
		if runtime.GOOS == "darwin" {
			icon := icons.normal
			if trayHasUnread.Load() {
				icon = icons.unread
			}
			tray.SetTemplateIcon(icon)
			return
		}
		if trayDarkMode.Load() {
			if trayHasUnread.Load() {
				tray.SetIcon(icons.darkModeUnread)
			} else {
				tray.SetIcon(icons.darkMode)
			}
			return
		}
		if trayHasUnread.Load() {
			tray.SetIcon(icons.unread)
		} else {
			tray.SetIcon(icons.normal)
		}
	}
	setTrayIcon()
	tray.SetTooltip("Pinger")
	app.Event.OnApplicationEvent(events.Common.ThemeChanged, func(event *application.ApplicationEvent) {
		if event.Context() == nil {
			return
		}
		trayDarkMode.Store(trayIconUsesDarkVariant(trayThemePreference(), event.Context().IsDarkMode()))
		setTrayIcon()
	})
	tray.OnClick(func() {
		if window.IsVisible() {
			window.Hide()
			return
		}
		showMainWindow()
	})
	if handler, ok := notifier.(notifications.ClickHandler); ok {
		handler.SetClickHandler(func(accountID, roomID string) {
			showMainWindow()
			app.Event.Emit(notificationOpenRoomName, map[string]string{"accountId": accountID, "roomId": roomID})
		})
	}
	markAllRoomsRead := func() {
		go func() {
			if markErr := service.markAllRead(); markErr != nil && service.ctx.Err() == nil {
				log.Printf("mark all rooms as read: %v", markErr)
				app.Event.Emit(hostErrorEventName, map[string]string{"error": markErr.Error()})
			}
		}()
	}
	menus := newApplicationMenus(service, app, showMainWindow, markAllRoomsRead)
	tray.SetMenu(menus.trayMenu())
	if runtime.GOOS == "darwin" {
		app.Menu.SetApplicationMenu(menus.applicationMenu())
		menus.refreshAccounts()
		menus.syncPreferences(service.preferenceValues())
	}
	var needsReplyCount atomic.Int64
	var counterMu sync.Mutex
	lastNeedsReplyCount := -1
	var dockBadge *dock.DockService
	if runtime.GOOS == "darwin" {
		dockBadge = dock.New()
	}
	refreshNeedsReplyCounter := func() {
		if dockBadge == nil {
			return
		}
		counterMu.Lock()
		defer counterMu.Unlock()
		if ctx.Err() != nil {
			return
		}
		count := int(needsReplyCount.Load())
		if count == lastNeedsReplyCount {
			return
		}
		tray.SetLabel(needsReplyCounterLabel(count))
		if badgeErr := setNeedsReplyDockBadge(dockBadge, count); badgeErr != nil {
			log.Printf("update Needs reply Dock badge: %v", badgeErr)
			return
		}
		lastNeedsReplyCount = count
	}
	if dockBadge != nil {
		app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
			go refreshNeedsReplyCounter()
		})
	}
	service.menuStateChanged = func(state MenuState) {
		if dockBadge != nil {
			needsReplyCount.Store(int64(max(0, state.NeedsReplyCount)))
			go refreshNeedsReplyCounter()
		}
		application.InvokeAsync(func() {
			menus.applyState(state)
		})
	}
	service.menuAccountsChanged = func() {
		application.InvokeAsync(menus.refreshAccounts)
	}
	// Tray Show and Hide are no-ops until the native tray exists, so the initial state is applied after launch.
	if !menuBarIconEnabled() {
		app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
			tray.Hide()
		})
	}
	service.setMenuBarIcon = func(enabled bool) {
		if enabled {
			tray.Show()
			return
		}
		tray.Hide()
		showMainWindow()
	}
	service.chooseSavePath = func(directory, filename string) (string, error) {
		dialog := app.Dialog.SaveFile().SetFilename(filename).AttachToWindow(window)
		if directory != "" {
			dialog.SetDirectory(directory)
		}
		return dialog.PromptForSingleSelection()
	}
	service.chooseDownloadFolder = func() (string, error) {
		return app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).AttachToWindow(window).PromptForSingleSelection()
	}
	service.chooseDataFolder = func() (string, error) {
		return app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).AttachToWindow(window).PromptForSingleSelection()
	}

	emitHostError := func(hostErr error) {
		if hostErr != nil {
			app.Event.Emit(hostErrorEventName, map[string]string{"error": hostErr.Error()})
		}
	}
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if quitOnClose, _ := service.preferenceValues()["window.quit_on_close"].(bool); quitOnClose {
			app.Quit()
			return
		}
		if minimizeToTray, _ := service.preferenceValues()["window.minimize_to_tray"].(bool); minimizeToTray && menuBarIconEnabled() {
			event.Cancel()
			window.Hide()
		}
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		if event.Context() == nil {
			return
		}
		paths := append([]string(nil), event.Context().DroppedFiles()...)
		if len(paths) == 0 {
			return
		}
		go func() {
			roomID, sent, dropErr := service.sendDroppedFiles(paths)
			if sent {
				app.Event.Emit(attachmentSentEventName, roomID)
			}
			emitHostError(dropErr)
		}()
	})

	lastUnread := -1
	service.startEventPump(func(update Update) {
		if update.AccountID != service.currentAccountID() {
			eventBatcher.EnqueueUpdate(update)
			return
		}
		unread := 0
		for _, room := range update.Rooms {
			unread += room.Unread
		}
		if unread != lastUnread {
			trayHasUnread.Store(unread > 0)
			setTrayIcon()
			if unread > 0 {
				tray.SetTooltip(fmt.Sprintf("Pinger (%d unread)", unread))
			} else {
				tray.SetTooltip("Pinger")
			}
			lastUnread = unread
		}
		eventBatcher.EnqueueUpdate(update)
	})
	service.emitLocalAIChatStream = func(chunk LocalAIChatStreamEvent) {
		app.Event.Emit(localAIChatStreamEventName, chunk)
	}
	service.emitLocalAIImageProgress = func(update LocalAIImageProgressEvent) {
		app.Event.Emit(localAIImageProgressEventName, update)
	}
	service.emitChatExportProgress = func(progress ChatExportProgress) {
		app.Event.Emit(chatExportProgressEventName, progress)
	}
	service.emitAIStream = func(chunk AIStreamEvent) {
		app.Event.Emit(aiStreamEventName, chunk)
	}
	service.startPreferencePump(func(state Snapshot) {
		if theme, ok := state.Preferences["appearance.theme"].(string); ok {
			trayDarkMode.Store(trayIconUsesDarkVariant(theme, app.Env.IsDarkMode()))
			setTrayIcon()
		}
		application.InvokeAsync(func() {
			menus.syncPreferences(state.Preferences)
		})
		app.Event.Emit(preferencesUpdateEventName, state)
	})
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
