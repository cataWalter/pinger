package matrix

import (
	"encoding/json"
	"testing"
	"time"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"maunium.net/go/mautrix/id"
)

func TestApplyOwnReactionsCountsStoredReactions(t *testing.T) {
	const me = id.UserID("@me:example.org")
	const thumb = `{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}`
	messages := []Message{{ID: "$target"}}
	reactions := map[id.EventID]*database.GetReactionsResult{
		"$target": {Events: []*database.Event{
			{ID: "$other", Sender: "@other:example.org", Content: json.RawMessage(thumb)},
			{ID: "$mine", Sender: me, Content: json.RawMessage(thumb)},
			{ID: "$failed", Sender: me, SendError: "failed to send event: M_FORBIDDEN", Content: json.RawMessage(thumb)},
			{ID: "$removed", Sender: me, Content: json.RawMessage(thumb)},
		}},
	}

	applyOwnReactions(messages, reactions, me, map[id.EventID]bool{"$removed": true})

	if got := messages[0].Reactions["👍"]; got != 2 {
		t.Fatalf("thumb count = %d, want 2 (failed and removed rows excluded)", got)
	}
	if !messages[0].Reacted["👍"] {
		t.Fatalf("own reaction not marked: %v", messages[0].Reacted)
	}
}

func TestApplyOwnReactionsDropsOnlyFailedOwnReaction(t *testing.T) {
	const me = id.UserID("@me:example.org")
	const thumb = `{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}`
	messages := []Message{{ID: "$target", Reacted: map[string]bool{"👍": true}}}
	reactions := map[id.EventID]*database.GetReactionsResult{
		"$target": {Events: []*database.Event{
			{ID: "~hicli-1", Sender: me, SendError: "not sent", Content: json.RawMessage(thumb)},
		}},
	}

	applyOwnReactions(messages, reactions, me, nil)

	if messages[0].Reacted["👍"] || messages[0].Reactions["👍"] != 0 {
		t.Fatalf("failed reaction still shown: reacted=%v counts=%v", messages[0].Reacted, messages[0].Reactions)
	}
}

func TestApplyOwnReactionsKeepsConfirmedLocalSend(t *testing.T) {
	const me = id.UserID("@me:example.org")
	const thumb = `{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}`
	messages := []Message{{ID: "$target"}}
	reactions := map[id.EventID]*database.GetReactionsResult{
		"$target": {Events: []*database.Event{
			// gomuks keeps the "not sent" marker on successful local sends, so this reaction is confirmed.
			{ID: "$sent", Sender: me, SendError: "not sent", Content: json.RawMessage(thumb)},
		}},
	}

	applyOwnReactions(messages, reactions, me, nil)

	if messages[0].Reactions["👍"] != 1 || !messages[0].Reacted["👍"] {
		t.Fatalf("confirmed local reaction hidden: reacted=%v counts=%v", messages[0].Reacted, messages[0].Reactions)
	}
}

func TestSelectOwnReactionIDsRemovesConfirmedLocalSend(t *testing.T) {
	const me = id.UserID("@me:example.org")
	const thumb = `{"m.relates_to":{"rel_type":"m.annotation","event_id":"$target","key":"👍"}}`
	events := []*database.Event{
		{ID: "$sent", Sender: me, SendError: "not sent", Content: json.RawMessage(thumb)},
		{ID: "$failed", Sender: me, SendError: "failed to send event: M_FORBIDDEN", Content: json.RawMessage(thumb)},
		{ID: "~hicli-1", Sender: me, SendError: "not sent", Content: json.RawMessage(thumb)},
	}

	ids, pending := selectOwnReactionIDs(events, me, "👍", nil)

	if len(ids) != 1 || ids[0] != "$sent" {
		t.Fatalf("removable reactions = %v, want [$sent]", ids)
	}
	if !pending {
		t.Fatal("unconfirmed local echo not reported as pending")
	}
}

func TestRemovedReactionIDsExpire(t *testing.T) {
	c := &Client{}
	c.markReactionRemoved("$fresh")
	c.removedReactions["$stale"] = time.Now().Add(-reactionRemovalTTL - time.Second)

	removed := c.removedReactionIDs()
	if !removed["$fresh"] {
		t.Fatalf("fresh removal not tracked: %v", removed)
	}
	if removed["$stale"] {
		t.Fatalf("stale removal still tracked: %v", removed)
	}
	if _, ok := c.removedReactions["$stale"]; ok {
		t.Fatal("stale removal not pruned")
	}
}
