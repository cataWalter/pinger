package desktop

import (
	"fmt"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
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

func TestApplicationMenuAcceleratorsAreUniqueAndModified(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	menu := menus.applicationMenu()
	accounts := make([]AccountSummary, 0, 9)
	for index := range 9 {
		accounts = append(accounts, AccountSummary{ID: fmt.Sprintf("account-%d", index)})
	}
	menus.populateAccounts(menus.accounts, accounts, "account-0")

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

func TestZoomHelpersUseDefaultsAndClamp(t *testing.T) {
	levels := []struct {
		name   string
		values map[string]any
		want   int
	}{
		{name: "missing", values: map[string]any{}, want: zoomDefault},
		{name: "valid", values: map[string]any{"appearance.zoom": "80"}, want: 80},
		{name: "out of range", values: map[string]any{"appearance.zoom": "130"}, want: zoomDefault},
		{name: "not a number", values: map[string]any{"appearance.zoom": "large"}, want: zoomDefault},
	}
	for _, tc := range levels {
		if got := zoomLevel(tc.values); got != tc.want {
			t.Errorf("%s: zoomLevel() = %d, want %d", tc.name, got, tc.want)
		}
	}
	if got := clampZoom(130); got != zoomMaximum {
		t.Errorf("clampZoom(130) = %d, want %d", got, zoomMaximum)
	}
	if got := clampZoom(60); got != zoomMinimum {
		t.Errorf("clampZoom(60) = %d, want %d", got, zoomMinimum)
	}
	if got := clampZoom(95); got != 95 {
		t.Errorf("clampZoom(95) = %d, want 95", got)
	}
}

func TestPopulateAccountsNumbersFirstNineAndChecksActive(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	accountMenu := application.NewMenu()
	accounts := make([]AccountSummary, 0, 10)
	for index := range 10 {
		accounts = append(accounts, AccountSummary{
			ID:      fmt.Sprintf("account-%d", index),
			Profile: AccountProfile{UserID: fmt.Sprintf("@user%d:example.org", index)},
		})
	}
	menus.populateAccounts(accountMenu, accounts, "account-2")

	for index := range 10 {
		item := accountMenu.ItemAt(index)
		if item == nil {
			t.Fatalf("account item %d is missing", index)
		}
		// Wails normalizes CmdOrCtrl and Alt per platform, so only the digit and modifier are checked.
		got := item.GetAccelerator()
		if index >= 9 {
			if got != "" {
				t.Errorf("account %d accelerator = %q, want none", index, got)
			}
		} else {
			lower := strings.ToLower(got)
			if !strings.HasSuffix(lower, fmt.Sprintf("+%d", index+1)) || !(strings.Contains(lower, "alt") || strings.Contains(lower, "option")) {
				t.Errorf("account %d accelerator = %q, want an Alt or Option shortcut ending in %d", index, got, index+1)
			}
		}
		if item.Checked() != (index == 2) {
			t.Errorf("account %d checked = %t, want %t", index, item.Checked(), index == 2)
		}
	}
	if accountMenu.ItemAt(10) != nil {
		t.Error("unexpected extra account item")
	}
}

func TestPopulateAccountsWithoutAccountsIsDisabled(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	accountMenu := application.NewMenu()
	menus.populateAccounts(accountMenu, nil, "")

	item := accountMenu.ItemAt(0)
	if item == nil || item.Label() != "No Accounts" || item.Enabled() {
		t.Errorf("empty account menu should show a disabled %q item", "No Accounts")
	}
}

func TestAccountMenuLabelPrefersNameAndUserID(t *testing.T) {
	cases := []struct {
		name    string
		profile AccountProfile
		want    string
	}{
		{name: "name and user", profile: AccountProfile{DisplayName: "Ada", UserID: "@ada:example.org"}, want: "Ada (@ada:example.org)"},
		{name: "same name and user", profile: AccountProfile{DisplayName: "@ada:example.org", UserID: "@ada:example.org"}, want: "@ada:example.org"},
		{name: "user only", profile: AccountProfile{UserID: "@ada:example.org"}, want: "@ada:example.org"},
		{name: "empty", profile: AccountProfile{}, want: "Account"},
	}
	for _, tc := range cases {
		if got := accountMenuLabel(AccountSummary{Profile: tc.profile}); got != tc.want {
			t.Errorf("%s: accountMenuLabel() = %q, want %q", tc.name, got, tc.want)
		}
	}
}
