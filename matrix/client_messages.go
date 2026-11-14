package matrix

import (
	"go.mau.fi/gomuks/pkg/hicli/database"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
)

func roomDisplayName(room *database.Room) string {
	if room.Name != nil && strings.TrimSpace(*room.Name) != "" {
		return *room.Name
	}
	if room.CanonicalAlias != nil && *room.CanonicalAlias != "" {
		return room.CanonicalAlias.String()
	}
	return room.ID.String()
}

// bridgeLabel derives a Beeper-network style badge label from room metadata.
// gomuks does not expose bridge protocol directly, so this uses the DM user,
// alias, name, topic, and member heroes as a best-effort label (WhatsApp/Telegram/Signal/...).
func bridgeLabel(room *database.Room) string {
	if room == nil {
		return ""
	}
	candidates := make([]string, 0, 4)
	if room.DMUserID != nil {
		candidates = append(candidates, strings.ToLower(room.DMUserID.String()))
	}
	if room.CanonicalAlias != nil {
		candidates = append(candidates, strings.ToLower(room.CanonicalAlias.String()))
	}
	if room.Name != nil {
		candidates = append(candidates, strings.ToLower(*room.Name))
	}
	if room.Topic != nil {
		candidates = append(candidates, strings.ToLower(*room.Topic))
	}
	// Bridge ghost IDs such as @instagramgo_123 name the network even when the room name does not.
	if room.LazyLoadSummary != nil {
		for _, hero := range room.LazyLoadSummary.Heroes {
			candidates = append(candidates, strings.ToLower(hero.String()))
		}
	}
	for _, candidate := range candidates {
		switch {
		case strings.Contains(candidate, "whatsapp"):
			return "WA"
		case strings.Contains(candidate, "telegram"):
			return "TG"
		case strings.Contains(candidate, "signal"):
			return "SG"
		case strings.Contains(candidate, "imessage"):
			return "iM"
		case strings.Contains(candidate, "instagram"):
			return "IG"
		case strings.Contains(candidate, "discord"):
			return "DC"
		case strings.Contains(candidate, "slack"):
			return "SL"
		case strings.Contains(candidate, "sms"):
			return "SMS"
		}
	}
	if room.DMUserID != nil && !strings.Contains(strings.ToLower(room.ID.String()), "matrix") {
		return "BR"
	}
	return ""
}
