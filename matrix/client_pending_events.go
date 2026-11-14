package matrix

import (
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
)

// isPendingEvent reports whether an event is still an unsent local echo.
//
// send_error alone cannot answer this: gomuks writes the transient "not sent"
// marker into every fresh local event and its deferred cleanup in
// actuallySend() re-writes it after a successful send too (UpdateID clears the
// column, then the defer persists the still-set in-memory "not sent" value).
// Upstream knows this and its Resend() checks for the "~" local placeholder
// prefix on the event ID instead, so that is the reliable pending signal here.
// Without it every confirmed message stays labelled "Sending…".
func isPendingEvent(evt *database.Event) bool {
	if evt == nil || evt.SendError == "" {
		return false
	}
	return evt.ID == "" || strings.HasPrefix(evt.ID.String(), "~")
}
