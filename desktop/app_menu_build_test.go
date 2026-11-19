package desktop

import "testing"

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
