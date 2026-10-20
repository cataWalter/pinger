package desktop

import (
	"context"
	"fmt"
	"io/fs"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"mychat/datadir"
	"mychat/logging"
	"mychat/matrix"
	"mychat/notifications"
	sharedpreferences "mychat/preferences"
)

const (
	updateEventName             = "matrix:update"
	hostErrorEventName          = "matrix:host-error"
	attachmentSentEventName     = "matrix:attachment-sent"
	preferencesUpdateEventName  = "preferences:update"
	scheduledReminderEventName  = "scheduler:reminder"
	notificationOpenRoomName    = "notification:open-room"
	applicationMenuAboutName    = "application-menu:about"
	applicationMenuSettingsName = "application-menu:settings"
	applicationMenuSearchName   = "application-menu:search"
)

func Run(client *matrix.Client, assets fs.FS, icon []byte, dataDir, defaultDataDir, preferencesPath, mediaCacheDir string) error {
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
			logging.For("app").Warn().Err(importErr).Msg("could not import legacy preferences")
		}
	}
	scheduledJobs, err := newScheduledJobStore(filepath.Join(filepath.Dir(preferencesPath), "scheduled-jobs.json"))
	if err != nil {
		_ = sharedPreferences.Close()
		return fmt.Errorf("open scheduled jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	notifier := notifications.New()
	service := &AppService{client: client, sharedPreferences: sharedPreferences, notifier: notifier, ctx: ctx, cancel: cancel, scheduled: scheduledJobs}
	service.dataDir = dataDir
	service.defaultDataDir = defaultDataDir
	if err = service.initializeAccounts(dataDir, mediaCacheDir); err != nil {
		cancel()
		_ = sharedPreferences.Close()
		client.Close()
		return fmt.Errorf("initialize Matrix accounts: %w", err)
	}
	accounts := service.accountClientsSnapshot()
	logging.For("app").Info().
		Int("accounts", len(accounts)).
		Bool("logged_in", anyLoggedInAccount(accounts)).
		Msg("desktop application initialized")
	var shutdownOnce sync.Once
	shutdown := func() {
		shutdownOnce.Do(func() {
			logging.For("app").Info().Msg("shutting down desktop application")
			service.close()
			service.closeAccountClients()
			if lifecycle, ok := notifier.(notifications.Lifecycle); ok {
				if closeErr := lifecycle.Close(); closeErr != nil {
					logging.For("app").Warn().Err(closeErr).Msg("stop native notifications")
				}
			}
			// The databases are closed, so a data folder the user picked in the settings
			// can be applied now.
			if defaultDataDir != "" {
				if _, moveErr := datadir.ApplyPending(defaultDataDir); moveErr != nil {
					logging.For("app").Error().Err(moveErr).Msg("move application data")
				}
			}
			if service.restartRequested.Load() {
				if restartErr := relaunch(); restartErr != nil {
					logging.For("app").Error().Err(restartErr).Msg("restart Pinger")
				}
			}
		})
	}

	app := application.New(application.Options{
		Name:        "Pinger",
		Description: "A Matrix desktop client",
		Icon:        icon,
		Linux: application.LinuxOptions{
			ApplicationID: "fi.mau.pinger",
		},
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		OnShutdown: shutdown,
	})
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
	if lifecycle, ok := notifier.(notifications.Lifecycle); ok {
		if startErr := lifecycle.Start(ctx); startErr != nil {
			logging.For("app").Warn().Err(startErr).Msg("native notifications unavailable")
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
		logging.For("app").Warn().Err(err).Msg("apply launch-at-startup preference")
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
	})
	showMainWindow := func() {
		window.Show().Focus()
	}

	icons := trayIcons()
	if runtime.GOOS == "linux" {
		linuxIcons, iconErr := linuxTrayIcons()
		if iconErr != nil {
			logging.For("app").Warn().Err(iconErr).Msg("could not prepare Linux system tray icon")
		} else {
			icons = linuxIcons
		}
	}
	tray := app.SystemTray.New()
	tray.SetLabel("Pinger")
	var trayHasUnread atomic.Bool
	var trayDarkMode atomic.Bool
	trayDarkMode.Store(app.Env.IsDarkMode())
	setTrayIcon := func() {
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
		trayDarkMode.Store(event.Context().IsDarkMode())
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
		handler.SetClickHandler(func(roomID string) {
			showMainWindow()
			app.Event.Emit(notificationOpenRoomName, roomID)
		})
	}
	menu := application.NewMenu()
	menu.Add("Open").OnClick(func(_ *application.Context) {
		showMainWindow()
	})
	markAllRoomsRead := func() {
		go func() {
			if markErr := service.markAllRead(); markErr != nil && service.ctx.Err() == nil {
				logging.For("app").Error().Err(markErr).Msg("mark all rooms as read")
				app.Event.Emit(hostErrorEventName, map[string]string{"error": markErr.Error()})
			}
		}()
	}
	menu.Add("Mark All as Read").OnClick(func(_ *application.Context) {
		markAllRoomsRead()
	})
	menu.AddSeparator()
	menu.Add("Quit").OnClick(func(_ *application.Context) {
		app.Quit()
	})
	tray.SetMenu(menu)
	if runtime.GOOS == "darwin" {
		applicationMenu := application.NewMenu()
		appMenu := applicationMenu.AddSubmenu("Pinger")
		appMenu.Add("About Pinger").OnClick(func(_ *application.Context) {
			showMainWindow()
			app.Event.Emit(applicationMenuAboutName)
		})
		appMenu.AddSeparator()
		appMenu.Add("Settings...").SetAccelerator("CmdOrCtrl+,").OnClick(func(_ *application.Context) {
			showMainWindow()
			app.Event.Emit(applicationMenuSettingsName)
		})
		appMenu.AddSeparator()
		appMenu.AddRole(application.ServicesMenu)
		appMenu.AddSeparator()
		appMenu.AddRole(application.Hide)
		appMenu.AddRole(application.HideOthers)
		appMenu.AddRole(application.UnHide)
		appMenu.AddSeparator()
		appMenu.AddRole(application.Quit)

		applicationMenu.AddRole(application.FileMenu)
		applicationMenu.AddRole(application.EditMenu)
		messagesMenu := applicationMenu.AddSubmenu("Messages")
		messagesMenu.Add("Search Messages").SetAccelerator("CmdOrCtrl+f").OnClick(func(_ *application.Context) {
			showMainWindow()
			app.Event.Emit(applicationMenuSearchName)
		})
		messagesMenu.Add("Mark All as Read").OnClick(func(_ *application.Context) {
			markAllRoomsRead()
		})
		applicationMenu.AddRole(application.ViewMenu)
		applicationMenu.AddRole(application.WindowMenu)
		applicationMenu.AddRole(application.HelpMenu)
		app.Menu.SetApplicationMenu(applicationMenu)
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
			logging.For("app").Warn().Err(hostErr).Msg("desktop operation failed")
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
		app.Event.Emit(updateEventName, update)
	})
	service.startPreferencePump(func(state Snapshot) {
		app.Event.Emit(preferencesUpdateEventName, state)
	})
	service.startScheduledJobWorker()

	logging.For("app").Info().Msg("starting Wails desktop window")
	service.startSync()

	err = app.Run()
	shutdown()
	if err != nil {
		logging.For("app").Error().Err(err).Msg("Wails desktop window stopped with an error")
	} else {
		logging.For("app").Info().Msg("Wails desktop window closed")
	}
	return err
}
