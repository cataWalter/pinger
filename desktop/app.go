package desktop

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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

func Run(client *matrix.Client, assets fs.FS, dataDir, preferencesPath, mediaCacheDir string) error {
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
	scheduledJobs, err := newScheduledJobStore(filepath.Join(filepath.Dir(preferencesPath), "scheduled-jobs.json"))
	if err != nil {
		_ = sharedPreferences.Close()
		return fmt.Errorf("open scheduled jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	notifier := notifications.New()
	service := &AppService{client: client, sharedPreferences: sharedPreferences, notifier: notifier, ctx: ctx, cancel: cancel, scheduled: scheduledJobs}
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

	app := application.New(application.Options{
		Name:        "Pinger",
		Description: "A Matrix desktop client",
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
	})
	showMainWindow := func() {
		window.Show().Focus()
	}

	icons := trayIcons()
	tray := app.SystemTray.New()
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
				log.Printf("mark all rooms as read: %v", markErr)
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

	service.startSync()

	err = app.Run()
	shutdown()
	return err
}
