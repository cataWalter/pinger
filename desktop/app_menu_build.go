package desktop

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"strconv"
)

// applicationMenu builds the macOS menu bar and keeps a handle for account rebuilds.
func (m *applicationMenus) applicationMenu() *application.Menu {
	menu := application.NewMenu()
	m.root = menu

	pinger := menu.AddSubmenu("Pinger")
	pinger.Add("About Pinger").OnClick(m.event(applicationMenuAboutName))
	pinger.Add("Check for Updates...").OnClick(m.checkForUpdates)
	pinger.AddSeparator()
	pinger.Add("Settings...").SetAccelerator("CmdOrCtrl+,").OnClick(m.event(applicationMenuSettingsName))
	sections := pinger.AddSubmenu("Settings Section")
	for _, tab := range applicationMenuSettingsTabs {
		sections.Add(tab).OnClick(m.dispatch(menuActionSettingsPrefix + tab))
	}
	pinger.AddSeparator()
	pinger.AddRole(application.ServicesMenu)
	pinger.AddSeparator()
	pinger.Add("Hide Pinger").SetAccelerator("CmdOrCtrl+h").SetRole(application.Hide)
	pinger.AddRole(application.HideOthers)
	pinger.AddRole(application.UnHide)
	pinger.AddSeparator()
	pinger.Add("Quit Pinger").SetAccelerator("CmdOrCtrl+q").OnClick(m.quit)

	file := menu.AddSubmenu("File")
	file.Add("New Private Model Chat").SetAccelerator("CmdOrCtrl+shift+m").OnClick(m.dispatch(menuActionPrivateChatNew))
	file.AddSeparator()
	file.AddRole(application.CloseWindow)

	// Standard Edit roles let the native WebView handle text undo/redo without document.execCommand.
	edit := menu.AddSubmenu("Edit")
	edit.AddRole(application.Undo)
	edit.AddRole(application.Redo)
	edit.AddSeparator()
	edit.AddRole(application.Cut)
	edit.AddRole(application.Copy)
	edit.AddRole(application.Paste)
	edit.AddRole(application.PasteAndMatchStyle)
	edit.AddRole(application.Delete)
	edit.AddRole(application.SelectAll)
	edit.AddSeparator()
	edit.AddRole(application.SpeechMenu)

	messages := menu.AddSubmenu("Messages")
	messages.Add("Search Messages").SetAccelerator("CmdOrCtrl+f").OnClick(m.event(applicationMenuSearchName))
	messages.Add("Quick Switch Rooms...").SetAccelerator("CmdOrCtrl+k").OnClick(m.dispatch(menuActionQuickSwitch))
	messages.Add("Focus Room Search").SetAccelerator("CmdOrCtrl+shift+s").OnClick(m.dispatch(menuActionRoomSearch))
	messages.AddSeparator()
	// Room navigation has no accelerator so the composer keeps Option and Shift+arrow text selection.
	messages.Add("Next Room").OnClick(m.dispatch(menuActionRoomNext))
	messages.Add("Previous Room").OnClick(m.dispatch(menuActionRoomPrevious))
	messages.Add("Next Needs-Reply Room").OnClick(m.dispatch(menuActionNeedsReplyNext))
	messages.Add("Previous Needs-Reply Room").OnClick(m.dispatch(menuActionNeedsReplyPrevious))
	messages.Add("Jump to Latest Messages").SetAccelerator("CmdOrCtrl+shift+l").OnClick(m.dispatch(menuActionJumpToLatest))
	messages.AddSeparator()
	for _, filter := range menuFilters {
		item := messages.AddRadio(filter.label, filter.id == "all")
		if filter.accelerator != "" {
			item.SetAccelerator(filter.accelerator)
		}
		item.OnClick(m.dispatch(menuActionFilterPrefix + filter.id))
		m.items[menuActionFilterPrefix+filter.id] = item
	}
	messages.AddSeparator()
	m.track(menuActionTutorDraft, messages.Add("Analyze Draft with Language Tutor").SetAccelerator("Ctrl+Shift+T").OnClick(m.dispatch(menuActionTutorDraft)))
	messages.AddSeparator()
	room := messages.AddSubmenu("Room")
	m.track(menuActionRoomAnswered, room.Add("Mark Room as Answered").OnClick(m.dispatch(menuActionRoomAnswered)))
	room.Add("Undo Mark Answered").OnClick(m.dispatch(menuActionUndo))
	m.track(menuActionRoomNeedsReply, room.Add("Add Room to Needs Reply").OnClick(m.dispatch(menuActionRoomNeedsReply)))
	m.track(menuActionRoomRead, room.Add("Mark Room as Read").OnClick(m.dispatch(menuActionRoomRead)))
	m.track(menuActionRoomArchive, room.Add("Archive Room").OnClick(m.dispatch(menuActionRoomArchive)))
	m.track(menuActionRoomFavorite, room.Add("Add Room to Favorites").OnClick(m.dispatch(menuActionRoomFavorite)))
	room.AddSeparator()
	m.track(menuActionPrivateChatAll, room.Add("Add Private Chat to All Rooms").SetAccelerator("CmdOrCtrl+shift+g").OnClick(m.dispatch(menuActionPrivateChatAll)))
	messages.AddSeparator()
	messages.Add("Mark All as Read").OnClick(m.markAllReadClick)

	view := menu.AddSubmenu("View")
	m.items[menuItemContentBlur] = view.AddCheckbox("Content Blur", false).SetAccelerator("CmdOrCtrl+shift+p").OnClick(m.togglePreference("privacy.incognito"))
	m.items[menuItemHideImages] = view.AddCheckbox("Hide Images and Videos", false).SetAccelerator("CmdOrCtrl+shift+i").OnClick(m.togglePreference("appearance.hide_images_and_videos"))
	view.AddSeparator()
	m.items[menuItemZoomIn] = view.Add("Zoom In").SetAccelerator("CmdOrCtrl+=").OnClick(m.stepZoom(zoomStep))
	m.items[menuItemZoomOut] = view.Add("Zoom Out").SetAccelerator("CmdOrCtrl+-").OnClick(m.stepZoom(-zoomStep))
	view.Add("Actual Size").SetAccelerator("CmdOrCtrl+0").OnClick(m.resetZoom)
	view.AddSeparator()
	view.AddRole(application.ToggleFullscreen)
	view.AddRole(application.OpenDevTools)

	menu.AddRole(application.WindowMenu)

	help := menu.AddSubmenu("Help")
	help.Add("Keyboard Shortcuts").SetAccelerator("CmdOrCtrl+/").OnClick(m.dispatch(menuActionSettingsPrefix + "Keyboard"))
	help.Add("Pinger Help").OnClick(m.dispatch(menuActionSettingsPrefix + "Help"))
	help.AddSeparator()
	help.Add("Report an Issue...").OnClick(m.openURL(pingerIssuesURL))
	help.Add("Project Repository...").OnClick(m.openURL(pingerRepositoryURL))
	help.Add("Release Notes...").OnClick(m.openURL(releasesPageURL))
	help.Add("Project License...").OnClick(m.openURL(pingerLicenseURL))

	m.rememberMenuLabels(menu)
	m.applyLanguage(m.language)
	m.applyState(MenuState{Filter: "all"})
	return menu
}

// applyState enables, labels, and checks the items that depend on the frontend state.
func (m *applicationMenus) applyState(state MenuState) {
	m.state = state
	for _, key := range []string{menuActionRoomRead, menuActionRoomArchive, menuActionRoomFavorite, menuActionRoomNeedsReply, menuActionRoomAnswered} {
		m.setEnabled(key, state.RoomSelected)
	}
	m.setEnabled(menuActionRoomNeedsReply, state.RoomSelected && state.RoomUnanswered && !state.RoomNeedsReply)
	m.setEnabled(menuActionRoomAnswered, state.RoomSelected && state.RoomNeedsReply)
	m.setEnabled(menuActionPrivateChatAll, state.PrivateChatOpen)
	m.setEnabled(menuActionTutorDraft, state.DraftReady)
	m.setLabel(menuActionRoomRead, choose(state.RoomUnread, "Mark Room as Read", "Mark Room as Unread"))
	m.setLabel(menuActionRoomArchive, choose(state.RoomArchived, "Restore Room", "Archive Room"))
	m.setLabel(menuActionRoomFavorite, choose(state.RoomFavorite, "Remove Room from Favorites", "Add Room to Favorites"))
	m.setLabel(menuActionPrivateChatAll, choose(state.PrivateChatInAll, "Remove Private Chat from All Rooms", "Add Private Chat to All Rooms"))
	for _, filter := range menuFilters {
		m.setChecked(menuActionFilterPrefix+filter.id, state.Filter == filter.id)
	}
}

// syncPreferences applies the preference-driven checkmarks and zoom bounds to the menu.
func (m *applicationMenus) syncPreferences(values map[string]any) {
	incognito, _ := values["privacy.incognito"].(bool)
	hideImages, _ := values["appearance.hide_images_and_videos"].(bool)
	m.setChecked(menuItemContentBlur, incognito)
	m.setChecked(menuItemHideImages, hideImages)
	zoom := zoomLevel(values)
	m.setEnabled(menuItemZoomIn, zoom < zoomMaximum)
	m.setEnabled(menuItemZoomOut, zoom > zoomMinimum)
	language, ok := values["general.language"].(string)
	if !ok {
		language = "system"
	}
	m.applyLanguage(language)
}

func (m *applicationMenus) rememberMenuLabels(menu *application.Menu) {
	if menu == nil {
		return
	}
	for index := 0; ; index++ {
		item := menu.ItemAt(index)
		if item == nil {
			return
		}
		if _, exists := m.originalLabels[item]; !exists {
			m.originalLabels[item] = item.Label()
		}
		m.rememberMenuLabels(item.GetSubmenu())
	}
}

func (m *applicationMenus) applyLanguage(language string) {
	m.language = normalizeUILanguage(language)
	for item, english := range m.originalLabels {
		item.SetLabel(localizedUIString(m.language, english))
	}
	m.applyState(m.state)
}

// track stores item under key so its label, enabled, and checked state can change later.
func (m *applicationMenus) track(key string, item *application.MenuItem) {
	m.items[key] = item
}

func (m *applicationMenus) setEnabled(key string, enabled bool) {
	if item := m.items[key]; item != nil {
		item.SetEnabled(enabled)
	}
}

func (m *applicationMenus) setChecked(key string, checked bool) {
	if item := m.items[key]; item != nil {
		item.SetChecked(checked)
	}
}

func (m *applicationMenus) setLabel(key, label string) {
	if item := m.items[key]; item != nil {
		item.SetLabel(localizedUIString(m.language, label))
	}
}

// event returns a click handler that shows the window and emits a named app event.
func (m *applicationMenus) event(name string) func(*application.Context) {
	return func(_ *application.Context) {
		m.showWindow()
		m.app.Event.Emit(name)
	}
}

// dispatch returns a click handler that shows the window and sends an action ID to the frontend.
func (m *applicationMenus) dispatch(action string) func(*application.Context) {
	return func(_ *application.Context) {
		m.showWindow()
		m.app.Event.Emit(applicationMenuActionEventName, action)
	}
}

func (m *applicationMenus) markAllReadClick(_ *application.Context) {
	m.markAllRead()
}

func (m *applicationMenus) quit(_ *application.Context) {
	m.app.Quit()
}

// openURL returns a click handler that opens rawURL in the default browser.
func (m *applicationMenus) openURL(rawURL string) func(*application.Context) {
	return func(_ *application.Context) {
		m.fail(m.service.OpenExternalURL(rawURL))
	}
}

// togglePreference returns a click handler that flips the boolean preference at key.
func (m *applicationMenus) togglePreference(key string) func(*application.Context) {
	return func(_ *application.Context) {
		current, _ := m.service.preferenceValues()[key].(bool)
		m.fail(m.service.SetBooleanPreference(key, !current))
	}
}

// stepZoom returns a click handler that moves the zoom level by delta within the allowed range.
func (m *applicationMenus) stepZoom(delta int) func(*application.Context) {
	return func(_ *application.Context) {
		next := clampZoom(zoomLevel(m.service.preferenceValues()) + delta)
		m.fail(m.service.SetStringPreference("appearance.zoom", strconv.Itoa(next)))
	}
}

func (m *applicationMenus) resetZoom(_ *application.Context) {
	m.fail(m.service.SetStringPreference("appearance.zoom", strconv.Itoa(zoomDefault)))
}
