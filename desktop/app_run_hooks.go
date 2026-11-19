package desktop

import (
	"fmt"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
)

func (s *desktopShell) setupDockBadge() {
	if runtime.GOOS == "darwin" {
		s.dockBadge = dock.New()
	}
	if s.dockBadge != nil {
		s.app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
			go s.refreshNeedsReplyCounter()
		})
	}
}

func (s *desktopShell) refreshNeedsReplyCounter() {
	if s.dockBadge == nil {
		return
	}
	s.counterMu.Lock()
	defer s.counterMu.Unlock()
	if s.ctx.Err() != nil {
		return
	}
	count := int(s.needsReplyCount.Load())
	if count == s.lastNeedsReply {
		return
	}
	s.tray.SetLabel(needsReplyCounterLabel(count))
	if badgeErr := setNeedsReplyDockBadge(s.dockBadge, count); badgeErr != nil {
		log.Printf("update Needs reply Dock badge: %v", badgeErr)
		return
	}
	s.lastNeedsReply = count
}

func (s *desktopShell) wireMenuCallbacks() {
	s.service.menuStateChanged = func(state MenuState) {
		if s.dockBadge != nil {
			s.needsReplyCount.Store(int64(max(0, state.NeedsReplyCount)))
			go s.refreshNeedsReplyCounter()
		}
		application.InvokeAsync(func() {
			s.menus.applyState(state)
		})
	}
}

func (s *desktopShell) wireMenuBarAndDialogs() {
	// Tray Show and Hide are no-ops until the native tray exists, so the initial state is applied after launch.
	if !s.menuBarIconEnabled() {
		s.app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
			s.tray.Hide()
		})
	}
	s.service.setMenuBarIcon = func(enabled bool) {
		if enabled {
			s.tray.Show()
			return
		}
		s.tray.Hide()
		s.showMainWindow()
	}
	s.service.chooseSavePath = func(directory, filename string) (string, error) {
		dialog := s.app.Dialog.SaveFile().SetFilename(filename).AttachToWindow(s.window)
		if directory != "" {
			dialog.SetDirectory(directory)
		}
		return dialog.PromptForSingleSelection()
	}
	s.service.chooseDownloadFolder = func() (string, error) {
		return s.app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).AttachToWindow(s.window).PromptForSingleSelection()
	}
	s.service.chooseDataFolder = func() (string, error) {
		return s.app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).AttachToWindow(s.window).PromptForSingleSelection()
	}
}

func (s *desktopShell) wireEventPumps() {
	s.service.startEventPump(s.handleUpdate)
	s.service.emitLocalAIChatStream = func(chunk LocalAIChatStreamEvent) {
		s.app.Event.Emit(localAIChatStreamEventName, chunk)
	}
	s.service.emitLocalAIImageProgress = func(update LocalAIImageProgressEvent) {
		s.app.Event.Emit(localAIImageProgressEventName, update)
	}
	s.service.emitChatExportProgress = func(progress ChatExportProgress) {
		s.app.Event.Emit(chatExportProgressEventName, progress)
	}
	s.service.emitBulkChatExportProgress = func(progress BulkChatExportProgress) {
		s.app.Event.Emit(bulkChatExportProgressEventName, progress)
	}
	s.service.emitAIStream = func(chunk AIStreamEvent) {
		s.app.Event.Emit(aiStreamEventName, chunk)
	}
	s.service.startPreferencePump(s.handlePreferences)
}

func (s *desktopShell) handleUpdate(update Update) {
	unread := 0
	for _, room := range update.Rooms {
		unread += room.Unread
	}
	if unread != s.lastUnread {
		s.trayHasUnread.Store(unread > 0)
		s.setTrayIcon()
		if unread > 0 {
			s.tray.SetTooltip(fmt.Sprintf("Pinger (%d unread)", unread))
		} else {
			s.tray.SetTooltip("Pinger")
		}
		s.lastUnread = unread
	}
	s.eventBatcher.EnqueueUpdate(update)
}

func (s *desktopShell) handlePreferences(state Snapshot) {
	if theme, ok := state.Preferences["appearance.theme"].(string); ok {
		s.trayDarkMode.Store(trayIconUsesDarkVariant(theme, s.app.Env.IsDarkMode()))
		s.setTrayIcon()
	}
	application.InvokeAsync(func() {
		s.menus.syncPreferences(state.Preferences)
	})
	s.app.Event.Emit(preferencesUpdateEventName, state)
}
