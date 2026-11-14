package desktop

import (
	"context"
	"log"
	"mychat/notifications"
	"runtime"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
)

// desktopShell holds the native window, tray, menu, and Dock state that Run wires to AppService.
type desktopShell struct {
	ctx             context.Context
	service         *AppService
	app             *application.App
	notifier        notifications.Notifier
	eventBatcher    *EventBatcher
	applicationIcon []byte
	window          *application.WebviewWindow
	tray            *application.SystemTray
	icons           trayIconVariants
	menus           *applicationMenus
	trayHasUnread   atomic.Bool
	trayDarkMode    atomic.Bool
	dockBadge       *dock.DockService
	needsReplyCount atomic.Int64
	counterMu       sync.Mutex
	lastNeedsReply  int
	lastUnread      int
}

func (s *desktopShell) menuBarIconEnabled() bool {
	value, ok := s.service.preferenceValues()["window.menu_bar_icon"].(bool)
	return !ok || value
}

func (s *desktopShell) startsHidden() bool {
	startMinimized, _ := s.service.preferenceValues()["window.start_minimized"].(bool)
	return startMinimized && s.menuBarIconEnabled()
}

func (s *desktopShell) showMainWindow() {
	s.window.Show().Focus()
}

func (s *desktopShell) trayThemePreference() string {
	theme, _ := s.service.preferenceValues()["appearance.theme"].(string)
	return theme
}

func (s *desktopShell) setTrayIcon() {
	if runtime.GOOS == "darwin" {
		icon := s.icons.normal
		if s.trayHasUnread.Load() {
			icon = s.icons.unread
		}
		s.tray.SetTemplateIcon(icon)
		return
	}
	if s.trayDarkMode.Load() {
		if s.trayHasUnread.Load() {
			s.tray.SetIcon(s.icons.darkModeUnread)
		} else {
			s.tray.SetIcon(s.icons.darkMode)
		}
		return
	}
	if s.trayHasUnread.Load() {
		s.tray.SetIcon(s.icons.unread)
	} else {
		s.tray.SetIcon(s.icons.normal)
	}
}

func (s *desktopShell) setupTray() {
	s.icons = trayIcons()
	if runtime.GOOS == "darwin" {
		s.icons = macOSTrayIcons()
	} else if runtime.GOOS == "linux" {
		linuxIcons, iconErr := linuxTrayIcons()
		if iconErr != nil {
			log.Printf("prepare Linux tray icons: %v", iconErr)
		} else {
			s.icons = linuxIcons
		}
	}
	s.tray = s.app.SystemTray.New()
	s.trayDarkMode.Store(trayIconUsesDarkVariant(s.trayThemePreference(), s.app.Env.IsDarkMode()))
	s.setTrayIcon()
	s.tray.SetTooltip("Pinger")
	s.app.Event.OnApplicationEvent(events.Common.ThemeChanged, func(event *application.ApplicationEvent) {
		if event.Context() == nil {
			return
		}
		s.trayDarkMode.Store(trayIconUsesDarkVariant(s.trayThemePreference(), event.Context().IsDarkMode()))
		s.setTrayIcon()
	})
	s.tray.OnClick(func() {
		if s.window.IsVisible() {
			s.window.Hide()
			return
		}
		s.showMainWindow()
	})
}

func (s *desktopShell) wireNotificationClicks() {
	if handler, ok := s.notifier.(notifications.ClickHandler); ok {
		handler.SetClickHandler(func(accountID, roomID string) {
			s.showMainWindow()
			s.app.Event.Emit(notificationOpenRoomName, map[string]string{"accountId": accountID, "roomId": roomID})
		})
	}
}

func (s *desktopShell) markAllRoomsRead() {
	go func() {
		if markErr := s.service.markAllRead(); markErr != nil && s.service.ctx.Err() == nil {
			log.Printf("mark all rooms as read: %v", markErr)
			s.app.Event.Emit(hostErrorEventName, map[string]string{"error": markErr.Error()})
		}
	}()
}

func (s *desktopShell) setupMenus() {
	s.menus = newApplicationMenus(s.service, s.app, s.showMainWindow, s.markAllRoomsRead)
	s.tray.SetMenu(s.menus.trayMenu())
	if runtime.GOOS == "darwin" {
		s.app.Menu.SetApplicationMenu(s.menus.applicationMenu())
		s.menus.refreshAccounts()
		s.menus.syncPreferences(s.service.preferenceValues())
	}
}

func (s *desktopShell) emitHostError(hostErr error) {
	if hostErr != nil {
		s.app.Event.Emit(hostErrorEventName, map[string]string{"error": hostErr.Error()})
	}
}

func (s *desktopShell) wireWindowHooks() {
	s.window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if quitOnClose, _ := s.service.preferenceValues()["window.quit_on_close"].(bool); quitOnClose {
			s.app.Quit()
			return
		}
		if minimizeToTray, _ := s.service.preferenceValues()["window.minimize_to_tray"].(bool); minimizeToTray && s.menuBarIconEnabled() {
			event.Cancel()
			s.window.Hide()
		}
	})
	s.window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		if event.Context() == nil {
			return
		}
		paths := append([]string(nil), event.Context().DroppedFiles()...)
		if len(paths) == 0 {
			return
		}
		go func() {
			files, readErr := readDroppedFiles(paths)
			if len(files) > 0 {
				s.app.Event.Emit(droppedFilesEventName, map[string]any{"files": files})
			}
			s.emitHostError(readErr)
		}()
	})
}
