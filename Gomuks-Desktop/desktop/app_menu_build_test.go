package desktop

import (
	"fmt"
	"github.com/wailsapp/wails/v3/pkg/application"
	"strings"
	"testing"
)

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

func TestApplicationMenusApplyLanguageToStaticAndDynamicLabels(t *testing.T) {
	menus := newApplicationMenus(&AppService{}, nil, nil, nil)
	menus.applicationMenu()

	menus.syncPreferences(map[string]any{"general.language": "it"})
	for item, english := range menus.originalLabels {
		if english == "Settings..." && item.Label() != "Impostazioni..." {
			t.Fatalf("settings label = %q, want %q", item.Label(), "Impostazioni...")
		}
		if english == "All Rooms" && item.Label() != "Tutte le stanze" {
			t.Fatalf("room filter label = %q, want %q", item.Label(), "Tutte le stanze")
		}
	}
	menus.applyState(MenuState{RoomSelected: true, RoomUnread: true, Filter: "all"})
	if got := menus.items[menuActionRoomRead].Label(); got != "Segna la stanza come letta" {
		t.Fatalf("dynamic room label = %q", got)
	}

	menus.syncPreferences(map[string]any{"general.language": "es"})
	if got := menus.items[menuActionRoomRead].Label(); got != "Marcar sala como leída" {
		t.Fatalf("updated dynamic room label = %q", got)
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
