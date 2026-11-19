package desktop

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"strconv"
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
var applicationMenuSettingsTabs = []string{"General", "Account", "Appearance", "Notifications", "Keyboard", "Storage", "AI", "Help"}

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
	RoomUnanswered   bool   `json:"roomUnanswered"`
	RoomNeedsReply   bool   `json:"roomNeedsReply"`
	NeedsReplyCount  int    `json:"needsReplyCount"`
	PrivateChatOpen  bool   `json:"privateChatOpen"`
	PrivateChatInAll bool   `json:"privateChatInAll"`
	DraftReady       bool   `json:"draftReady"`
	Filter           string `json:"filter"`
}

// applicationMenus owns the native menu bar and tray menu, and the items that follow app state.
type applicationMenus struct {
	service        *AppService
	app            *application.App
	showWindow     func()
	markAllRead    func()
	root           *application.Menu
	tray           *application.Menu
	items          map[string]*application.MenuItem
	originalLabels map[*application.MenuItem]string
	language       string
	state          MenuState
}

// newApplicationMenus prepares the menu builder; the menus are built by trayMenu and applicationMenu.
func newApplicationMenus(service *AppService, app *application.App, showWindow, markAllRead func()) *applicationMenus {
	return &applicationMenus{
		service:        service,
		app:            app,
		showWindow:     showWindow,
		markAllRead:    markAllRead,
		items:          make(map[string]*application.MenuItem),
		originalLabels: make(map[*application.MenuItem]string),
		language:       "en",
	}
}

// SetMenuState receives the frontend room and filter state that drives the native menu.
func (s *AppService) SetMenuState(state MenuState) {
	if s.menuStateChanged != nil {
		s.menuStateChanged(state)
	}
}

type needsReplyDockBadge interface {
	SetBadge(string) error
	RemoveBadge() error
}

func needsReplyCounterLabel(count int) string {
	if count <= 0 {
		return ""
	}
	return strconv.Itoa(count)
}

func setNeedsReplyDockBadge(badge needsReplyDockBadge, count int) error {
	if count <= 0 {
		return badge.RemoveBadge()
	}
	return badge.SetBadge(needsReplyCounterLabel(count))
}

// trayMenu builds the menu-bar icon menu.
func (m *applicationMenus) trayMenu() *application.Menu {
	menu := application.NewMenu()
	addAction := func(label, icon string) *application.MenuItem {
		item := menu.Add(label)
		setTrayMenuIcon(item, icon)
		return item
	}
	addAction("Open Pinger", trayIconOpen).OnClick(func(_ *application.Context) {
		m.showWindow()
	})
	addAction("Search Messages", trayIconSearch).OnClick(m.event(applicationMenuSearchName))
	addAction("Mark All as Read", trayIconRead).OnClick(m.markAllReadClick)
	menu.AddSeparator()
	addAction("Settings...", trayIconSettings).OnClick(m.event(applicationMenuSettingsName))
	addAction("Check for Updates...", trayIconUpdates).OnClick(m.checkForUpdates)
	menu.AddSeparator()
	addAction("Quit Pinger", trayIconQuit).OnClick(m.quit)
	m.tray = menu
	m.rememberMenuLabels(menu)
	m.applyLanguage(m.language)
	return menu
}
