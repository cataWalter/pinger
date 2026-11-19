package desktop

import (
	"bytes"
	"fmt"
	"github.com/wailsapp/wails/v3/pkg/application"
	"image/png"
	"strings"
	"testing"
)

type testNeedsReplyDockBadge struct {
	label   string
	removed bool
}

func (badge *testNeedsReplyDockBadge) SetBadge(label string) error {
	badge.label = label
	return nil
}

func (badge *testNeedsReplyDockBadge) RemoveBadge() error {
	badge.removed = true
	return nil
}

func TestNeedsReplyCountersShowNumbersAndClearAtZero(t *testing.T) {
	for _, test := range []struct {
		count int
		label string
	}{
		{count: -1, label: ""},
		{count: 0, label: ""},
		{count: 1, label: "1"},
		{count: 17, label: "17"},
		{count: 1234, label: "1234"},
	} {
		t.Run(fmt.Sprint(test.count), func(t *testing.T) {
			if label := needsReplyCounterLabel(test.count); label != test.label {
				t.Fatalf("menu-bar label = %q, want %q", label, test.label)
			}
			badge := &testNeedsReplyDockBadge{}
			if err := setNeedsReplyDockBadge(badge, test.count); err != nil {
				t.Fatal(err)
			}
			if badge.label != test.label || badge.removed != (test.count <= 0) {
				t.Fatalf("Dock badge: label=%q removed=%v", badge.label, badge.removed)
			}
		})
	}
}

// menuItemsUnder returns every item in menu, including items in nested submenus.
func menuItemsUnder(menu *application.Menu) []*application.MenuItem {
	var items []*application.MenuItem
	for index := 0; ; index++ {
		item := menu.ItemAt(index)
		if item == nil {
			return items
		}
		items = append(items, item)
		if submenu := item.GetSubmenu(); submenu != nil {
			items = append(items, menuItemsUnder(submenu)...)
		}
	}
}

func TestDesktopCatalogsHaveMatchingKeys(t *testing.T) {
	var reference map[string]struct{}
	for language, catalog := range desktopCatalogs {
		keys := make(map[string]struct{}, len(catalog))
		for key := range catalog {
			keys[key] = struct{}{}
		}
		if reference == nil {
			reference = keys
			continue
		}
		if len(keys) != len(reference) {
			t.Errorf("%s catalog has %d keys, want %d", language, len(keys), len(reference))
			continue
		}
		for key := range reference {
			if _, ok := keys[key]; !ok {
				t.Errorf("%s catalog is missing %q", language, key)
			}
		}
	}
}

func TestLocalizedUIString(t *testing.T) {
	tests := []struct {
		language string
		english  string
		want     string
	}{
		{language: "it-IT", english: "Open Pinger", want: "Apri Pinger"},
		{language: "es", english: "New message", want: "Mensaje nuevo"},
		{language: "de-DE", english: "Settings...", want: "Einstellungen..."},
		{language: "fr_FR.UTF-8", english: "Quit Pinger", want: "Quitter Pinger"},
		{language: "pt-BR", english: "Open Pinger", want: "Open Pinger"},
	}
	for _, test := range tests {
		if got := localizedUIString(test.language, test.english); got != test.want {
			t.Errorf("localizedUIString(%q, %q) = %q, want %q", test.language, test.english, got, test.want)
		}
	}
}

func TestTrayMenuIconsAreValidPNGs(t *testing.T) {
	for _, name := range trayIconNames {
		t.Run(name, func(t *testing.T) {
			bitmap, err := trayIconAssets.ReadFile("menu_icons/" + name + ".png")
			if err != nil {
				t.Fatal(err)
			}
			config, err := png.DecodeConfig(bytes.NewReader(bitmap))
			if err != nil {
				t.Fatalf("decode menu icon: %v", err)
			}
			if config.Width != 24 || config.Height != 24 {
				t.Errorf("menu icon size = %dx%d, want 24x24", config.Width, config.Height)
			}
		})
	}
}

func TestApplicationMenuAcceleratorsAreUniqueAndModified(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	menu := menus.applicationMenu()

	seen := make(map[string]string)
	for _, item := range menuItemsUnder(menu) {
		accelerator := item.GetAccelerator()
		if accelerator == "" {
			continue
		}
		// The standard Delete role uses a bare Backspace accelerator by OS convention.
		if item.Label() != "Delete" && !strings.Contains(accelerator, "+") {
			t.Errorf("accelerator %q on %q has no modifier", accelerator, item.Label())
		}
		key := strings.ToLower(accelerator)
		if previous, ok := seen[key]; ok {
			t.Errorf("accelerator %q is used by both %q and %q", accelerator, previous, item.Label())
		}
		seen[key] = item.Label()
	}
}

func TestApplicationMenuRoomItemsFollowSelection(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	menus.applicationMenu()

	for _, key := range []string{menuActionRoomRead, menuActionRoomArchive, menuActionRoomFavorite, menuActionRoomNeedsReply, menuActionRoomAnswered, menuActionPrivateChatAll, menuActionTutorDraft} {
		if menus.items[key].Enabled() {
			t.Errorf("%s is enabled without a selection", key)
		}
	}

	menus.applyState(MenuState{RoomSelected: true, RoomUnread: true, RoomUnanswered: true, RoomNeedsReply: true})
	if !menus.items[menuActionRoomRead].Enabled() {
		t.Error("room read is disabled with a selected room")
	}
	if menus.items[menuActionRoomNeedsReply].Enabled() {
		t.Error("add to needs reply is enabled for a room that already needs reply")
	}
	if !menus.items[menuActionRoomAnswered].Enabled() {
		t.Error("mark as answered is disabled for a room that needs reply")
	}
	if got := menus.items[menuActionRoomRead].Label(); got != "Mark Room as Read" {
		t.Errorf("room read label = %q, want %q", got, "Mark Room as Read")
	}

	menus.applyState(MenuState{RoomSelected: true})
	if menus.items[menuActionRoomNeedsReply].Enabled() {
		t.Error("add to needs reply is enabled for a room that is not unanswered")
	}
	if menus.items[menuActionRoomAnswered].Enabled() {
		t.Error("mark as answered is enabled for a room that does not need reply")
	}
	if got := menus.items[menuActionRoomRead].Label(); got != "Mark Room as Unread" {
		t.Errorf("room read label = %q, want %q", got, "Mark Room as Unread")
	}

	menus.applyState(MenuState{RoomSelected: true, RoomUnanswered: true})
	if !menus.items[menuActionRoomNeedsReply].Enabled() {
		t.Error("add to needs reply is disabled for an unanswered room")
	}
}

func TestApplyStateLabelsAndFilterChecks(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	menus.applicationMenu()

	menus.applyState(MenuState{RoomSelected: true, RoomArchived: true, RoomFavorite: true, PrivateChatInAll: true, PrivateChatOpen: true, Filter: "favorites"})
	labels := map[string]string{
		menuActionRoomArchive:    "Restore Room",
		menuActionRoomFavorite:   "Remove Room from Favorites",
		menuActionPrivateChatAll: "Remove Private Chat from All Rooms",
	}
	for key, want := range labels {
		if got := menus.items[key].Label(); got != want {
			t.Errorf("%s label = %q, want %q", key, got, want)
		}
	}
	if !menus.items[menuActionFilterPrefix+"favorites"].Checked() {
		t.Error("favorites filter is not checked")
	}
	if menus.items[menuActionFilterPrefix+"all"].Checked() {
		t.Error("all rooms filter is still checked")
	}

	menus.applyState(MenuState{Filter: "all"})
	if !menus.items[menuActionFilterPrefix+"all"].Checked() {
		t.Error("all rooms filter is not checked after reset")
	}
}

func TestSyncPreferencesChecksTogglesAndZoomBounds(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	menus.applicationMenu()

	menus.syncPreferences(map[string]any{"privacy.incognito": true, "appearance.hide_images_and_videos": false, "appearance.zoom": "75"})
	if !menus.items[menuItemContentBlur].Checked() {
		t.Error("content blur is not checked when privacy.incognito is true")
	}
	if menus.items[menuItemHideImages].Checked() {
		t.Error("hide images is checked when the preference is false")
	}
	if menus.items[menuItemZoomOut].Enabled() {
		t.Error("zoom out is enabled at the minimum zoom")
	}
	if !menus.items[menuItemZoomIn].Enabled() {
		t.Error("zoom in is disabled below the maximum zoom")
	}

	menus.syncPreferences(map[string]any{"appearance.zoom": "125"})
	if menus.items[menuItemZoomIn].Enabled() {
		t.Error("zoom in is enabled at the maximum zoom")
	}
	if !menus.items[menuItemZoomOut].Enabled() {
		t.Error("zoom out is disabled above the minimum zoom")
	}
	if menus.items[menuItemContentBlur].Checked() {
		t.Error("content blur is checked when the preference is missing")
	}
}
