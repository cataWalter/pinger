package desktop

import (
	"fmt"
	"github.com/wailsapp/wails/v3/pkg/application"
	"log"
	"strconv"
)

// checkForUpdates runs the release check in the background and reports the result in a native dialog.
func (m *applicationMenus) checkForUpdates(_ *application.Context) {
	go func() {
		status, err := m.service.CheckForUpdates()
		message := status.Message
		if err != nil {
			message = err.Error()
		}
		m.app.Dialog.Info().SetTitle(localizedUIString(m.language, "Check for Updates")).SetMessage(message).Show()
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
