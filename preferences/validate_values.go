package preferences

import (
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// validatePreference checks one preference. languages lists the codes that language keys may use.
func validatePreference(key string, value any, languages LanguageLookup) error {
	const roomAIAgentsPrefix = "room.ai_agents."
	const messageBookmarkPrefix = "message.bookmark."
	if strings.HasPrefix(key, roomAIAgentsPrefix) {
		if strings.TrimPrefix(key, roomAIAgentsPrefix) == "" {
			return errors.New("room AI-agent preference requires a room ID")
		}
		serialized, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a JSON string", key)
		}
		return validateAIAgentCollection(serialized)
	}
	for _, prefix := range []string{roomTutorLanguagePrefix, roomLearningLanguagePrefix, roomDetectedLanguagePrefix} {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		if strings.TrimPrefix(key, prefix) == "" {
			return errors.New("room language preference requires a room ID")
		}
		code, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if _, known := languages[code]; code != "" && !known {
			return errors.New("room language is not supported")
		}
		return nil
	}
	if strings.HasPrefix(key, messageBookmarkPrefix) {
		if strings.TrimPrefix(key, messageBookmarkPrefix) == "" {
			return errors.New("message bookmark preference requires a message ID")
		}
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("preference %q must be a boolean", key)
		}
		return nil
	}
	const localAIChatFavoritePrefix = "ai.local_chat.favorite."
	if strings.HasPrefix(key, localAIChatFavoritePrefix) {
		if strings.TrimPrefix(key, localAIChatFavoritePrefix) == "" {
			return errors.New("local AI chat favorite requires a chat ID")
		}
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("preference %q must be a boolean", key)
		}
		return nil
	}
	if strings.HasPrefix(key, "ai.feature.") {
		return validateAIFeaturePreference(key, value)
	}
	for _, prefix := range []string{"room.archived.", "room.favorite.", "room.muted.", "room.needs_reply.", "room.tone_guard."} {
		if strings.HasPrefix(key, prefix) {
			if strings.TrimPrefix(key, prefix) == "" {
				return errors.New("room preference requires a room ID")
			}
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("room preference %q must be a boolean", key)
			}
			return nil
		}
	}
	switch key {
	case "appearance.compact", "appearance.hide_deleted_messages", "appearance.hide_images_and_videos", "appearance.message_animations", "appearance.pointer_cursor", "appearance.show_avatars", "appearance.show_timestamps", "appearance.time_24_hour", "appearance.relative_timestamps",
		"clipboard.copy_timestamp", "composer.arrow_up_focus_timeline", "composer.ctrl_enter", "composer.ghost_text", "composer.keep_drafts", "composer.spellcheck", "messages.url_previews", "messages.url_previews_encrypted", "notifications.enabled", "notifications.only_when_unfocused", "notifications.sound",
		"sidebar.compact_chat_list", "sidebar.show_previews", "sidebar.show_unread_counts", "window.minimize_to_tray", "window.room_details_visible", "window.sidebar_visible", "system.launch_at_startup", "voice.autoplay_next",
		"notifications.direct", "notifications.mentions", "notifications.group", "notifications.otp_immediate", "notifications.otp_copy", "sidebar.transparent", "sidebar.network_icons", "reactions.quick_enabled", "window.start_minimized", "window.quit_on_close", "window.menu_bar_icon", "downloads.ask_each_time", "appearance.balanced_text", "appearance.low_spec_mode", "emoji.autocomplete", "emoji.replace_emoticons", "privacy.incognito", "archive.automatic", "ai.detect_chat_language":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("preference %q must be a boolean", key)
		}
	case "downloads.folder":
		folder, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if folder != "" && (!filepath.IsAbs(folder) || strings.ContainsRune(folder, 0)) {
			return errors.New("download folder must be an absolute path")
		}
	case "ai.thinking_level":
		if !oneOf(value, "none", "low", "medium", "high") {
			return errors.New("AI thinking level has an unsupported value")
		}
	case "ai.endpoint":
		endpoint, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if endpoint != "" {
			return ValidateAIEndpoint(endpoint)
		}
	case "ai.model", "ai.transcription_model", "appearance.bubble_color", "audio.input_device":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
	case "emoji.emoticon_replacements":
		return validateEmoticonReplacements(value)
	case "ai.local_agents":
		serialized, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a JSON string", key)
		}
		return validateAIAgentCollection(serialized)
	case "ai.tutor_language", "ai.default_language":
		code, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if _, known := languages[code]; code != "" && !known {
			return errors.New("AI language is not supported")
		}
	case "ai.known_languages":
		return validateKnownLanguages(value, languages)
	case "ai.custom_languages":
		return validateCustomLanguages(value)
	case "ai.image.binary_path", "ai.image.model_path":
		path, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if path != "" && (!filepath.IsAbs(path) || strings.ContainsRune(path, 0)) {
			return fmt.Errorf("preference %q must be an absolute path", key)
		}
	case "ai.image.idle_minutes":
		if !oneOf(value, "", "1", "3", "5", "10", "30") {
			return errors.New("image engine idle timeout has an unsupported value")
		}
	case "ai.image.size":
		if !oneOf(value, "", "512x512", "512x768", "768x512", "768x768", "768x1024", "1024x768", "1024x1024") {
			return errors.New("image size has an unsupported value")
		}
	case "ai.image.steps":
		if !oneOf(value, "", "4", "8", "12", "20", "30", "40") {
			return errors.New("image steps has an unsupported value")
		}
	case "ai.image.cfg_scale":
		if !oneOf(value, "", "1", "3", "5", "7", "9") {
			return errors.New("image guidance scale has an unsupported value")
		}
	case "ai.image.sampler":
		if !oneOf(value, "", "euler", "euler_a", "heun", "dpm2", "dpm++2m", "lcm") {
			return errors.New("image sampler has an unsupported value")
		}
	case "ai.image.negative_prompt":
		prompt, ok := value.(string)
		if !ok {
			return fmt.Errorf("preference %q must be a string", key)
		}
		if utf8.RuneCountInString(prompt) > 1000 || strings.ContainsRune(prompt, 0) {
			return errors.New("image negative prompt must be 1000 characters or fewer")
		}
	case "notifications.sound_direct", "notifications.sound_mention", "notifications.sound_group":
		if !oneOf(value, "Chime", "Pulse", "Soft", "Silent") {
			return fmt.Errorf("%s has an unsupported value", key)
		}
	case "notifications.batch_seconds":
		if !oneOf(value, "0", "3", "10", "30") {
			return errors.New("notifications.batch_seconds has an unsupported value")
		}
	case "notifications.repeat_minutes":
		if !oneOf(value, "0", "5", "15", "60") {
			return errors.New("notifications.repeat_minutes has an unsupported value")
		}
	case "sidebar.pinned_style":
		if !oneOf(value, "Top of list", "Star only") {
			return errors.New("sidebar.pinned_style has an unsupported value")
		}
	case "reactions.quick_source":
		if !oneOf(value, "Frequent", "Custom") {
			return errors.New("reactions.quick_source has an unsupported value")
		}
	case "reactions.custom_emojis":
		if !validEmojiList(value) {
			return errors.New("reactions.custom_emojis must contain 1 to 6 emoji separated by spaces")
		}
	case "reactions.default_emoji":
		if !validEmojiList(value) || strings.Contains(value.(string), " ") {
			return errors.New("reactions.default_emoji must be a single emoji")
		}
	case "messages.double_click":
		if !oneOf(value, "None", "Reply", "React") {
			return errors.New("messages.double_click has an unsupported value")
		}
	case "sounds.effects":
		if !oneOf(value, "Off", "Sent messages", "Incoming and sent messages") {
			return errors.New("sounds.effects has an unsupported value")
		}
	case "appearance.theme":
		if !oneOf(value, "System default", "Light", "Dark", "VS Code", "OLED black", "Bosco", "Rosa", "Dracula", "Midnight", "Slate", "Solarized", "Sepia") {
			return errors.New("appearance.theme has an unsupported value")
		}
	case "appearance.accent_color":
		if !oneOf(value, "Forest", "Ocean", "Rose", "Gold") && !isHexColor(value) {
			return errors.New("appearance.accent_color has an unsupported value")
		}
	case "appearance.chat_wallpaper":
		if !oneOf(value, "None", "Meadow", "Tide", "Rose") {
			return errors.New("appearance.chat_wallpaper has an unsupported value")
		}
	case "appearance.font_size":
		if !oneOf(value, "Small", "Medium", "Large") {
			return errors.New("appearance.font_size has an unsupported value")
		}
	case "appearance.zoom":
		if !oneOf(value, "75", "80", "85", "90", "95", "100", "105", "110", "115", "120", "125") {
			return errors.New("appearance.zoom has an unsupported value")
		}
	case "notifications.privacy":
		if !oneOf(value, "Sender and message preview", "Sender only", "Hidden content") {
			return errors.New("notifications.privacy has an unsupported value")
		}
	case "schedule.suggestions_minutes":
		if !validScheduleSuggestions(value) {
			return errors.New("schedule.suggestions_minutes must contain 1 to 6 unique minute values from 1 to 10080")
		}
	case "schedule.default_send_minutes", "schedule.default_reminder_minutes":
		if !validScheduleDelay(value) {
			return fmt.Errorf("preference %q must be a minute value from 1 to 10080", key)
		}
	case "archive.next_room":
		if !oneOf(value, "next_visible", "next_unread", "none") {
			return errors.New("archive.next_room has an unsupported value")
		}
	case "archive.older_than_days":
		if !validArchiveAgeDays(value) {
			return errors.New("archive.older_than_days must be a whole number from 1 to 3650")
		}
	case "inbox.after_read":
		if !oneOf(value, "stay", "next_visible", "next_unread", "none") {
			return errors.New("inbox.after_read has an unsupported value")
		}
	case "shortcuts.mark_answered":
		shortcut, ok := value.(string)
		if !ok || len([]rune(shortcut)) != 1 {
			return errors.New("shortcuts.mark_answered must contain one character")
		}
	case "history.initial_messages":
		if !oneOf(value, "25", "50", "100", "250", "500", "1000") {
			return errors.New("history.initial_messages has an unsupported value")
		}
	default:
		return fmt.Errorf("unknown preference %q", key)
	}
	return nil
}

// roomTutorLanguagePrefix prefixes the per-chat tutor language, room.tutor_language.<roomID>.
const roomTutorLanguagePrefix = "room.tutor_language."

// roomLearningLanguagePrefix prefixes the per-chat learning language, room.learning_language.<roomID>.
const roomLearningLanguagePrefix = "room.learning_language."

// roomDetectedLanguagePrefix prefixes the language last detected automatically for a chat, room.detected_language.<roomID>.
// It lets the app tell an automatic learning language from one the user chose.
const roomDetectedLanguagePrefix = "room.detected_language."
