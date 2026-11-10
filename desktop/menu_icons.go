package desktop

import (
	"embed"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	trayIconOpen     = "open"
	trayIconSearch   = "search"
	trayIconRead     = "read"
	trayIconSettings = "settings"
	trayIconUpdates  = "updates"
	trayIconQuit     = "quit"
)

var trayIconNames = [...]string{trayIconOpen, trayIconSearch, trayIconRead, trayIconSettings, trayIconUpdates, trayIconQuit}

//go:embed menu_icons/*.png
var trayIconAssets embed.FS

func setTrayMenuIcon(item *application.MenuItem, name string) {
	bitmap, err := trayIconAssets.ReadFile("menu_icons/" + name + ".png")
	if err != nil {
		panic(fmt.Sprintf("read tray menu icon %q: %v", name, err))
	}
	item.SetBitmap(bitmap)
}
