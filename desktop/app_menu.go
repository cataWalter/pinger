package desktop

import (
	"fmt"
	"log"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	applicationMenuActionEventName = "application-menu:action"
	pingerRepositoryURL            = "https://github.com/cataWalter/pinger"
	pingerIssuesURL                = "https://github.com/cataWalter/pinger/issues"
	pingerLicenseURL               = "https://github.com/cataWalter/pinger/blob/main/LICENSE"
	zoomDefault                    = 100
	zoomMinimum                    = 75
	zoomMaximum                    = 125
	zoomStep                       = 5
)

// Action IDs sent on applicationMenuActionEventName; the frontend maps each one to an existing command.
const (
	menuActionAccountPrefix      = "account:"
	menuActionFilterPrefix       = "filter:"
	menuActionSettingsPrefix     = "settings:"
	menuActionJumpToLatest       = "jump-latest"
	menuActionNeedsReplyNext     = "needs-reply-next"
	menuActionNeedsReplyPrevious = "needs-reply-previous"
	menuActionPrivateChatAll     = "private-chat-all"
	menuActionPrivateChatNew     = "private-chat-new"
	menuActionQuickSwitch        = "quick-switch"
	menuActionRoomAnswered       = "room-answered"
	menuActionRoomArchive        = "room-archive"
	menuActionRoomFavorite       = "room-favorite"
	menuActionRoomNeedsReply     = "room-needs-reply"
	menuActionRoomNext           = "room-next"
	menuActionRoomPrevious       = "room-previous"
	menuActionRoomRead           = "room-read"
	menuActionRoomSearch         = "room-search"
	menuActionTutorDraft         = "tutor-draft"
	menuActionUndo               = "undo"
)

// Keys for items the Go side updates directly; these are never sent to the frontend.
const (
	menuItemContentBlur = "content-blur"
	menuItemHideImages  = "hide-images"
	menuItemZoomIn      = "zoom-in"
	menuItemZoomOut     = "zoom-out"
)

// applicationMenuSettingsTabs matches the settings sections in the frontend tab list.
var applicationMenuSettingsTabs = []string{"General", "Account", "Appearance", "Notifications", "Keyboard", "History", "Devices", "Storage", "Security", "Help", "About", "AI", "Integrations"}

// menuFilters lists the room filters in the Messages menu, in display order.
var menuFilters = []struct {
	id          string
	label       string
	accelerator string
}{
	{id: "all", label: "All Rooms", accelerator: "CmdOrCtrl+shift+a"},
	{id: "needs-reply", label: "Needs Reply", accelerator: "CmdOrCtrl+shift+u"},
	{id: "unanswered", label: "Unanswered", accelerator: "CmdOrCtrl+shift+r"},
	{id: "favorites", label: "Favorites", accelerator: "CmdOrCtrl+shift+f"},
	{id: "archived", label: "Archived", accelerator: "CmdOrCtrl+shift+h"},
	{id: "private", label: "Private Model Chats"},
}

// MenuState is the frontend state that enables, labels, and checks native menu items.
type MenuState struct {
	RoomSelected     bool   `json:"roomSelected"`
	RoomUnread       bool   `json:"roomUnread"`
	RoomArchived     bool   `json:"roomArchived"`
	RoomFavorite     bool   `json:"roomFavorite"`
	RoomNeedsReply   bool   `json:"roomNeedsReply"`
	PrivateChatOpen  bool   `json:"privateChatOpen"`
	PrivateChatInAll bool   `json:"privateChatInAll"`
	DraftReady       bool   `json:"draftReady"`
	Filter           string `json:"filter"`
}

// applicationMenus owns the native menu bar and tray menu, and the items that follow app state.
type applicationMenus struct {
	service     *AppService
	app         *application.App
	showWindow  func()
	markAllRead func()
	root        *application.Menu
	accounts    *application.Menu
	items       map[string]*application.MenuItem
}

// newApplicationMenus prepares the menu builder; the menus are built by trayMenu and applicationMenu.
func newApplicationMenus(service *AppService, app *application.App, showWindow, markAllRead func()) *applicationMenus {
	return &applicationMenus{
		service:     service,
		app:         app,
		showWindow:  showWindow,
		markAllRead: markAllRead,
		items:       make(map[string]*application.MenuItem),
	}
}

// SetMenuState receives the frontend room and filter state that drives the native menu.
func (s *AppService) SetMenuState(state MenuState) {
	if s.menuStateChanged != nil {
		s.menuStateChanged(state)
	}
}

// notifyAccountsChanged asks the native menu to rebuild the account submenu.
func (s *AppService) notifyAccountsChanged() {
	if s.menuAccountsChanged != nil {
		s.menuAccountsChanged()
	}
}

// trayMenu builds the menu-bar icon menu.
func (m *applicationMenus) trayMenu() *application.Menu {
	menu := application.NewMenu()
	menu.Add("Open Pinger").OnClick(func(_ *application.Context) {
		m.showWindow()
	})
	menu.Add("Search Messages").OnClick(m.event(applicationMenuSearchName))
	menu.Add("Mark All as Read").OnClick(m.markAllReadClick)
	menu.AddSeparator()
	menu.Add("Settings...").OnClick(m.event(applicationMenuSettingsName))
	menu.Add("Check for Updates...").OnClick(m.checkForUpdates)
	menu.AddSeparator()
	menu.Add("Quit Pinger").OnClick(m.quit)
	return menu
}

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
	m.accounts = file.AddSubmenu("Switch Account")
	file.Add("Add Account...").OnClick(m.dispatch(menuActionSettingsPrefix + "Account"))
	file.AddSeparator()
	file.AddRole(application.CloseWindow)

	// Undo is custom so Cmd+Z reaches the room undo when no text field has focus.
	edit := menu.AddSubmenu("Edit")
	edit.Add("Undo").SetAccelerator("CmdOrCtrl+z").OnClick(m.dispatch(menuActionUndo))
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

	m.applyState(MenuState{Filter: "all"})
	return menu
}

// refreshAccounts rebuilds the switch-account submenu after the account list or active account changes.
func (m *applicationMenus) refreshAccounts() {
	if m.accounts == nil {
		return
	}
	m.populateAccounts(m.accounts, m.service.Accounts(), m.service.currentAccountID())
	if m.root != nil {
		m.root.Update()
	}
}

// populateAccounts fills menu with one radio item per account, numbering the first nine with shortcuts.
func (m *applicationMenus) populateAccounts(menu *application.Menu, accounts []AccountSummary, activeID string) {
	menu.Clear()
	if len(accounts) == 0 {
		menu.Add("No Accounts").SetEnabled(false)
		return
	}
	for index, account := range accounts {
		item := menu.AddRadio(accountMenuLabel(account), account.ID == activeID)
		if index < 9 {
			item.SetAccelerator(fmt.Sprintf("CmdOrCtrl+Alt+%d", index+1))
		}
		item.OnClick(m.dispatch(menuActionAccountPrefix + account.ID))
	}
}

// applyState enables, labels, and checks the items that depend on the frontend state.
func (m *applicationMenus) applyState(state MenuState) {
	for _, key := range []string{menuActionRoomRead, menuActionRoomArchive, menuActionRoomFavorite, menuActionRoomNeedsReply, menuActionRoomAnswered} {
		m.setEnabled(key, state.RoomSelected)
	}
	m.setEnabled(menuActionRoomNeedsReply, state.RoomSelected && !state.RoomNeedsReply)
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
		item.SetLabel(label)
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

// checkForUpdates runs the release check in the background and reports the result in a native dialog.
func (m *applicationMenus) checkForUpdates(_ *application.Context) {
	go func() {
		status, err := m.service.CheckForUpdates()
		message := status.Message
		if err != nil {
			message = err.Error()
		}
		m.app.Dialog.Info().SetTitle("Check for Updates").SetMessage(message).Show()
	}()
}

// fail logs a menu command error and reports it to the frontend unless the app is shutting down.
func (m *applicationMenus) fail(err error) {
	if err == nil || m.service.ctx.Err() != nil {
		return
	}
	log.Printf("application menu: %v", err)
	m.app.Event.Emit(hostErrorEventName, map[string]string{"error": err.Error()})
}

// zoomLevel reads the zoom preference, falling back to the default when it is missing or out of range.
func zoomLevel(values map[string]any) int {
	zoom, err := strconv.Atoi(fmt.Sprint(values["appearance.zoom"]))
	if err != nil || zoom < zoomMinimum || zoom > zoomMaximum {
		return zoomDefault
	}
	return zoom
}

func clampZoom(zoom int) int {
	return min(max(zoom, zoomMinimum), zoomMaximum)
}

// accountMenuLabel returns the display name, with the user ID in brackets when both exist.
func accountMenuLabel(account AccountSummary) string {
	name := account.Profile.DisplayName
	userID := account.Profile.UserID
	switch {
	case name != "" && userID != "" && name != userID:
		return fmt.Sprintf("%s (%s)", name, userID)
	case name != "":
		return name
	case userID != "":
		return userID
	default:
		return "Account"
	}
}

// choose returns whenTrue if condition holds, otherwise whenFalse.
func choose(condition bool, whenTrue, whenFalse string) string {
	if condition {
		return whenTrue
	}
	return whenFalse
}
