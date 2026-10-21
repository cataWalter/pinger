import { fuzzyScore } from './fuzzy'

export type SettingsTab = 'General' | 'Appearance' | 'Notifications' | 'Keyboard' | 'History' | 'Account' | 'Devices' | 'Storage' | 'Security' | 'Help' | 'About' | 'Integrations'

export const SETTINGS_TABS: SettingsTab[] = ['General', 'Account', 'Appearance', 'Notifications', 'Keyboard', 'History', 'Devices', 'Storage', 'Security', 'Help', 'About', 'Integrations']

export type SettingsEntry = {
  id: string
  tab: SettingsTab
  title: string
  description: string
  keywords?: string
  anchor?: string
}

export const settingsEntries: SettingsEntry[] = [
  { id: 'general.launch-at-login', tab: 'General', title: 'Launch Pinger at login', description: 'Start Pinger automatically when you sign in.', keywords: 'startup autostart sign in' },
  { id: 'general.minimize-to-tray', tab: 'General', title: 'Minimize to tray when closing the window', description: 'Keep Pinger in the menu bar instead of quitting.', keywords: 'tray close window quit' },
  { id: 'general.start-minimized', tab: 'General', title: 'Start minimized', description: 'Open Pinger in the menu bar when it launches.', keywords: 'startup tray hidden launch' },
  { id: 'general.quit-on-close', tab: 'General', title: 'Quit Pinger when the window closes', description: 'Fully quit instead of staying in the menu bar.', keywords: 'close quit exit window' },
  { id: 'general.menu-bar-icon', tab: 'General', title: 'Show menu bar icon', description: 'Show the Pinger icon in the system menu bar.', keywords: 'menu bar status tray icon' },
  { id: 'general.download-folder', tab: 'General', title: 'Download folder', description: 'Where downloaded media and files are saved.', keywords: 'downloads save location directory path' },
  { id: 'general.ask-where-to-save', tab: 'General', title: 'Ask where to save each download', description: 'Choose a folder for every download.', keywords: 'downloads save ask location' },
  { id: 'general.double-click-message', tab: 'General', title: 'Double-click a message', description: 'Choose what a double-click on a message does.', keywords: 'double click reply react' },
  { id: 'general.quick-reaction-picker', tab: 'General', title: 'Show quick reaction picker', description: 'Open a small emoji picker on a message.', keywords: 'reaction emoji picker quick' },
  { id: 'general.default-reaction', tab: 'General', title: 'Default reaction', description: 'Sent directly when the quick picker is turned off.', keywords: 'reaction emoji thumbs up default' },
  { id: 'general.quick-reaction-set', tab: 'General', title: 'Quick reaction set', description: 'Use the built-in frequent set or your own emoji.', keywords: 'reaction emoji frequent custom set' },
  { id: 'general.custom-quick-reactions', tab: 'General', title: 'Custom quick reactions', description: 'Up to 6 emoji, separated by spaces.', keywords: 'reaction emoji custom list' },
  { id: 'general.after-read-state', tab: 'General', title: "After changing a room's read state", description: 'Choose where to go after marking a room read or unread.', keywords: 'read unread next room inbox' },
  { id: 'general.after-archiving', tab: 'General', title: 'After archiving a room', description: 'Choose what opens after the selected room is archived.', keywords: 'archive next room' },
  { id: 'general.inactive-room-age', tab: 'General', title: 'Inactive room age', description: 'Set the number of days without activity before a room is archived.', keywords: 'archive inactive days old age' },
  { id: 'general.automatic-inactive-archive', tab: 'General', title: 'Automatically archive inactive rooms', description: 'Automatically archive rooms after the inactive-room age has passed.', keywords: 'archive inactive automatic auto cleanup' },
  { id: 'general.archive-inactive-rooms', tab: 'General', title: 'Archive inactive rooms', description: 'Archive every room that has been inactive for the chosen number of days.', keywords: 'archive cleanup rooms inactive' },
  { id: 'general.voice-note-microphone', tab: 'General', title: 'Voice-note microphone', description: 'Choose the input used for recording.', keywords: 'audio mic voice record input device' },
  { id: 'general.auto-play-next-voice-note', tab: 'General', title: 'Auto-play next voice note', description: 'Play the following voice note automatically.', keywords: 'audio voice autoplay' },
  { id: 'general.default-send-later-delay', tab: 'General', title: 'Default Send Later delay', description: 'Initial scheduled-send time, in minutes (1–10080).', keywords: 'schedule send later delay minutes' },
  { id: 'general.default-remind-later-delay', tab: 'General', title: 'Default Remind Later delay', description: 'Initial reminder time, in minutes (1–10080).', keywords: 'schedule remind later delay minutes reminder' },
  { id: 'general.schedule-time-suggestions', tab: 'General', title: 'Schedule time suggestions', description: 'Enter 1–6 comma-separated delays in minutes.', keywords: 'schedule suggestions delay minutes' },

  { id: 'account.details', tab: 'Account', title: 'Account details', description: 'Your user ID, homeserver, device and verification status.', keywords: 'profile user id homeserver device verified', anchor: '.account-details' },
  { id: 'account.send-typing', tab: 'Account', title: 'Send typing indicators', description: 'Let others see when you are typing.', keywords: 'typing privacy indicator' },
  { id: 'account.incognito', tab: 'Account', title: 'Incognito mode', description: 'Blur message text, names, and room images until hovered; suppress read receipts.', keywords: 'privacy hidden incognito blur hover messages names' },
  { id: 'account.log-out', tab: 'Account', title: 'Log out', description: 'Sign out and clear the local session data.', keywords: 'sign out logout session exit' },

  { id: 'appearance.theme', tab: 'Appearance', title: 'Theme', description: 'Choose the conversation surface.', keywords: 'dark light mode oled black color scheme dracula midnight slate solarized sepia' },
  { id: 'appearance.font-size', tab: 'Appearance', title: 'Font size', description: 'Adjust room and message text.', keywords: 'font text size readability' },
  { id: 'appearance.app-zoom', tab: 'Appearance', title: 'App zoom', description: 'Scale the full interface.', keywords: 'zoom scale magnification' },
  { id: 'appearance.bubble-color', tab: 'Appearance', title: 'Outgoing message color', description: 'Choose a color for your messages.', keywords: 'bubble colour green outgoing' },
  { id: 'appearance.accent-color', tab: 'Appearance', title: 'Theme accent', description: 'Choose an accent independent of message color.', keywords: 'accent palette forest ocean rose gold' },
  { id: 'appearance.chat-wallpaper', tab: 'Appearance', title: 'Chat wallpaper', description: 'Add a subtle background to conversations.', keywords: 'background wallpaper meadow tide rose' },
  { id: 'appearance.pointer-cursor', tab: 'Appearance', title: 'Use pointer cursor on clickable controls', description: 'Show a pointer cursor over buttons and links.', keywords: 'cursor pointer mouse' },
  { id: 'appearance.compact', tab: 'Appearance', title: 'Compact message layout', description: 'Fit more messages on screen.', keywords: 'compact density spacing layout' },
  { id: 'appearance.room-previews', tab: 'Appearance', title: 'Show room previews', description: 'Show the last message in the room list.', keywords: 'sidebar preview last message' },
  { id: 'appearance.unread-counts', tab: 'Appearance', title: 'Show unread counts', description: 'Show unread message badges in the room list.', keywords: 'sidebar badge unread count' },
  { id: 'appearance.compact-chat-list', tab: 'Appearance', title: 'Compact chat list', description: 'Fit more rooms in the sidebar.', keywords: 'sidebar compact density list' },
  { id: 'appearance.transparent-sidebar', tab: 'Appearance', title: 'Transparent sidebar', description: 'Let the desktop show through the sidebar.', keywords: 'sidebar transparency vibrancy' },
  { id: 'appearance.network-icons', tab: 'Appearance', title: 'Show network labels in the chat list', description: 'Mark bridged chats with their network.', keywords: 'sidebar bridge network whatsapp telegram' },
  { id: 'appearance.favorite-chats', tab: 'Appearance', title: 'Favorite chats', description: 'List favorite rooms first, or only mark them with a star.', keywords: 'sidebar favorites pinned star' },
  { id: 'appearance.message-animations', tab: 'Appearance', title: 'Animate new messages', description: 'Animate messages as they arrive.', keywords: 'animation motion new messages' },
  { id: 'appearance.show-timestamps', tab: 'Appearance', title: 'Show message timestamps', description: 'Display the time next to each message.', keywords: 'time clock timestamps' },
  { id: 'appearance.hide-media', tab: 'Appearance', title: 'Hide images and videos', description: 'Show placeholders instead of media.', keywords: 'media images videos hide' },
  { id: 'appearance.hide-deleted', tab: 'Appearance', title: 'Hide deleted messages', description: 'Keep removed messages out of the timeline.', keywords: 'deleted removed redacted hide' },
  { id: 'appearance.balanced-text', tab: 'Appearance', title: 'Balance message line wrapping', description: 'Wrap long lines evenly.', keywords: 'wrap text balance' },
  { id: 'appearance.24-hour-clock', tab: 'Appearance', title: 'Use a 24-hour clock', description: 'Show times in 24-hour format.', keywords: 'time clock 24 hour' },
  { id: 'appearance.relative-timestamps', tab: 'Appearance', title: 'Use relative timestamps', description: 'Show times like "2 minutes ago".', keywords: 'time relative ago' },

  { id: 'notifications.system-permission', tab: 'Notifications', title: 'System permission', description: 'Allow Pinger to post desktop alerts.', keywords: 'permission notification centre macos allow' },
  { id: 'notifications.enabled', tab: 'Notifications', title: 'Enable notifications', description: 'Show alerts for new messages.', keywords: 'notification alerts enable' },
  { id: 'notifications.busy-mode', tab: 'Notifications', title: 'Busy mode auto-replies', description: 'Reply once in each direct chat using the language of the latest 10 text messages.', keywords: 'busy away auto reply automatic response out of office' },
  { id: 'notifications.focused', tab: 'Notifications', title: 'Notify while Pinger is focused', description: 'Alert even when the app is open.', keywords: 'notification focused active window' },
  { id: 'notifications.sound', tab: 'Notifications', title: 'Play a notification sound', description: 'Play a sound with each alert.', keywords: 'notification sound alert' },
  { id: 'notifications.volume', tab: 'Notifications', title: 'Notification volume', description: 'Adjust the alert tone level.', keywords: 'volume alert sound level' },
  { id: 'notifications.privacy', tab: 'Notifications', title: 'Notification content', description: 'Control what appears outside the app.', keywords: 'privacy preview sender content hidden' },
  { id: 'notifications.direct', tab: 'Notifications', title: 'Direct message alerts', description: 'Alert for one-to-one chats.', keywords: 'notification dm direct message' },
  { id: 'notifications.mentions', tab: 'Notifications', title: 'Mention alerts', description: 'Alert when someone mentions you.', keywords: 'notification mention' },
  { id: 'notifications.group', tab: 'Notifications', title: 'Group message alerts', description: 'Alert for group chats.', keywords: 'notification group room' },
  { id: 'notifications.sound-direct', tab: 'Notifications', title: 'Direct message tone', description: 'Sound played for this kind of alert.', keywords: 'sound tone direct chime' },
  { id: 'notifications.sound-mention', tab: 'Notifications', title: 'Mention tone', description: 'Sound played for this kind of alert.', keywords: 'sound tone mention chime' },
  { id: 'notifications.sound-group', tab: 'Notifications', title: 'Group message tone', description: 'Sound played for this kind of alert.', keywords: 'sound tone group chime' },
  { id: 'notifications.batch', tab: 'Notifications', title: 'Batch new messages', description: 'Combine messages from the same room into one alert.', keywords: 'notification batch group combine' },
  { id: 'notifications.repeat', tab: 'Notifications', title: 'Repeat unread reminder', description: 'Remind you once about a room that is still unread.', keywords: 'notification reminder unread repeat' },
  { id: 'notifications.otp-immediate', tab: 'Notifications', title: 'Notify one-time codes immediately', description: 'Alert as soon as a login code arrives.', keywords: 'notification otp code login' },
  { id: 'notifications.otp-copy', tab: 'Notifications', title: 'Copy one-time codes automatically', description: 'Copy login codes to the clipboard.', keywords: 'notification otp code copy clipboard' },
  { id: 'notifications.sound-effects', tab: 'Notifications', title: 'Sound effects', description: 'Play a short sound when a message is sent.', keywords: 'sound effects sent message' },

  { id: 'keyboard.ctrl-enter', tab: 'Keyboard', title: 'Use Ctrl + Enter to send', description: 'Send a message with Ctrl + Enter.', keywords: 'send enter composer' },
  { id: 'keyboard.undo-send', tab: 'Keyboard', title: 'Undo send window', description: 'Hold a sent message briefly so it can be undone.', keywords: 'undo send seconds' },
  { id: 'keyboard.spellcheck', tab: 'Keyboard', title: 'Spellcheck messages', description: 'Check spelling while you type.', keywords: 'spellcheck spell check' },
  { id: 'keyboard.formatting-toolbar', tab: 'Keyboard', title: 'Show formatting toolbar', description: 'Show bold, italic and link controls.', keywords: 'formatting toolbar bold italic' },
  { id: 'keyboard.emoji-autocomplete', tab: 'Keyboard', title: 'Suggest emoji for :shortcodes:', description: 'Complete :shortcodes: as you type.', keywords: 'emoji autocomplete shortcode' },
  { id: 'keyboard.emoticon-replacement', tab: 'Keyboard', title: 'Replace emoticons as you type', description: 'Turn :-) into an emoji while typing and when sending. On by default.', keywords: 'emoticon emoji replace' },
  { id: 'keyboard.custom-emoticon-replacements', tab: 'Keyboard', title: 'Custom emoji replacements', description: 'Choose which emoji a text symbol becomes.', keywords: 'emoticon emoji custom mapping symbol', anchor: '#emoticon-replacement-editor' },
  { id: 'keyboard.copy-timestamp', tab: 'Keyboard', title: 'Include timestamps when copying messages', description: 'Add the time to copied text.', keywords: 'clipboard copy timestamp' },
  { id: 'keyboard.arrow-up-focus', tab: 'Keyboard', title: 'Use Up to focus the message list when the composer is empty', description: 'Move focus to the timeline with the Up arrow.', keywords: 'up arrow focus timeline composer' },
  { id: 'keyboard.single-keys', tab: 'Keyboard', title: 'Enable single-key shortcuts (R, J, K and the answered key)', description: 'Reply, navigate and mark rooms without modifiers.', keywords: 'single key shortcuts r j k' },
  { id: 'keyboard.mark-answered', tab: 'Keyboard', title: 'Mark answered shortcut', description: 'Use one letter to mark the selected room answered.', keywords: 'shortcut answered key letter' },
  { id: 'keyboard.reference', tab: 'Keyboard', title: 'Keyboard shortcuts', description: 'Every shortcut Pinger understands.', keywords: 'shortcut keys reference list', anchor: '.keyboard-shortcut-list' },

  { id: 'history.initial-messages', tab: 'History', title: 'Messages to load', description: 'Load this many recent messages when opening a room.', keywords: 'history messages load count limit' },

  { id: 'devices.list', tab: 'Devices', title: 'Active devices', description: 'Signed-in devices and when they were last active.', keywords: 'devices sessions list', anchor: '.device-row' },
  { id: 'devices.revoke', tab: 'Devices', title: 'Revoke device', description: 'Sign a device out of this account.', keywords: 'revoke device sign out remove', anchor: '.device-row .settings-command' },

  { id: 'storage.data-folder', tab: 'Storage', title: 'Data folder', description: 'Where Pinger keeps its database, keys and preferences.', keywords: 'data folder location directory move appdata storage restart' },
  { id: 'storage.summary', tab: 'Storage', title: 'Local storage', description: 'Sizes of the local database and media cache.', keywords: 'storage disk usage database cache', anchor: '.storage-summary' },
  { id: 'storage.clear-cache', tab: 'Storage', title: 'Clear media cache', description: 'Delete cached media files. Messages and keys are kept.', keywords: 'storage cache clear media delete' },
  { id: 'storage.optimize', tab: 'Storage', title: 'Optimize database', description: 'Compact the local database to reclaim space.', keywords: 'storage database optimize compact' },
  { id: 'storage.by-chat', tab: 'Storage', title: 'Storage by chat', description: 'See how much space each chat uses and clean it up.', keywords: 'storage per chat room usage cleanup', anchor: '.chat-storage' },
  { id: 'storage.clear-matching', tab: 'Storage', title: 'Clear matching cached media', description: 'Remove cached media for the selected chats.', keywords: 'storage cleanup media age type' },

  { id: 'security.verification', tab: 'Security', title: 'Device verification', description: 'Whether this device is verified with your account.', keywords: 'security encryption verified device', anchor: '.settings-note' },
  { id: 'security.backup-passphrase', tab: 'Security', title: 'Backup passphrase', description: 'Protect the exported key backup with a passphrase.', keywords: 'security passphrase backup keys' },
  { id: 'security.confirm-passphrase', tab: 'Security', title: 'Confirm passphrase', description: 'Repeat the backup passphrase.', keywords: 'security passphrase confirm' },
  { id: 'security.export-keys', tab: 'Security', title: 'Export room keys', description: 'Save an encrypted copy of your room keys.', keywords: 'security export backup keys download' },
  { id: 'security.import-passphrase', tab: 'Security', title: 'Import passphrase', description: 'Passphrase of the backup file you are importing.', keywords: 'security import passphrase' },
  { id: 'security.import-file', tab: 'Security', title: 'Import room key file', description: 'Restore room keys from a backup file.', keywords: 'security import backup file restore' },

  { id: 'integrations.ai', tab: 'Integrations', title: 'OpenAI-compatible AI', description: 'Connect Pinger to a llama-server or other OpenAI-compatible endpoint.', keywords: 'ai llm model endpoint local', anchor: '.ai-settings-form' },
  { id: 'integrations.ai-endpoint', tab: 'Integrations', title: 'Endpoint', description: 'Address of the OpenAI-compatible endpoint.', keywords: 'ai endpoint url server address' },
  { id: 'integrations.ai-model', tab: 'Integrations', title: 'Model name (optional)', description: 'Model served by the endpoint.', keywords: 'ai model name' },
  { id: 'integrations.ai-translate', tab: 'Integrations', title: 'Translate into', description: 'Language used for translations.', keywords: 'ai translate language' },
  { id: 'integrations.ai-test', tab: 'Integrations', title: 'Test endpoint', description: 'Check that the endpoint answers.', keywords: 'ai test connection endpoint' },
  { id: 'integrations.ghostwriter', tab: 'Integrations', title: 'AI Ghostwriter', description: 'Draft context-aware replies using your local chat history and writing style.', keywords: 'ghostwriter autocomplete quick reply slash local ollama llama.cpp', anchor: '.ghostwriter-settings' },
  { id: 'integrations.ghostwriter-enabled', tab: 'Integrations', title: 'Enable local AI Ghostwriter', description: 'Show local reply chips, inline completions, and /ghost drafts.', keywords: 'ghostwriter opt in autocomplete replies', anchor: '.ghostwriter-settings .setting-toggle' },
  { id: 'integrations.ghostwriter-provider', tab: 'Integrations', title: 'Ghostwriter provider', description: 'Choose Ollama or an OpenAI-compatible local server.', keywords: 'ollama llama.cpp local provider', anchor: '.ghostwriter-settings select' },
  { id: 'integrations.ghostwriter-endpoint', tab: 'Integrations', title: 'Ghostwriter local endpoint', description: 'Must use localhost or a loopback IP address.', keywords: 'ghostwriter endpoint localhost privacy', anchor: '.ghostwriter-settings input[type="url"]' },
  { id: 'integrations.ghostwriter-model', tab: 'Integrations', title: 'Ghostwriter model', description: 'Model loaded by Ollama or your local server.', keywords: 'ghostwriter model qwen llama gguf', anchor: '.ghostwriter-settings input[type="text"]' },
  { id: 'integrations.relationship-health', tab: 'Integrations', title: 'Keep in Touch reminders', description: 'Generate local relationship check-ins and contextual follow-up drafts.', keywords: 'keep in touch relationship health decay follow-up reminders local', anchor: '.relationship-health-settings .setting-toggle' },
  { id: 'integrations.networks', tab: 'Integrations', title: 'Detected chat networks', description: 'Bridged networks found in your chats.', keywords: 'bridges whatsapp telegram signal integration', anchor: '.integration-status' },

  { id: 'help.keyboard', tab: 'Help', title: 'Keyboard shortcuts', description: 'A quick tour of the shortcuts Pinger uses.', keywords: 'help shortcuts' },
  { id: 'help.storage', tab: 'Help', title: 'Storage and media', description: 'How clearing the media cache affects your messages.', keywords: 'help storage media cache' },
  { id: 'help.ai', tab: 'Help', title: 'Local AI', description: 'Pinger connects to a llama-server you run yourself.', keywords: 'help ai llama local model' },
  { id: 'help.networks', tab: 'Help', title: 'Chat networks', description: 'How bridged chats from other networks appear.', keywords: 'help bridges whatsapp telegram' },
  { id: 'help.encryption', tab: 'Help', title: 'Encryption and room keys', description: 'Export room keys from Security and protect the file with a passphrase.', keywords: 'help encryption keys backup' },
  { id: 'help.report-issue', tab: 'Help', title: 'Report an issue', description: 'Open the issue tracker on GitHub.', keywords: 'help report bug issue github' },

  { id: 'about.update', tab: 'About', title: 'Check for updates', description: 'Look for a newer Pinger release.', keywords: 'about update version upgrade release' },
  { id: 'about.repository', tab: 'About', title: 'Project repository', description: 'Source code for Pinger.', keywords: 'about github repository source code' },
  { id: 'about.feedback', tab: 'About', title: 'Send feedback or report an issue', description: 'Open the issue tracker on GitHub.', keywords: 'about feedback issue github' },
  { id: 'about.license', tab: 'About', title: 'License', description: 'Terms Pinger is released under.', keywords: 'about license agpl gpl', anchor: 'a[href*="LICENSE"]' },
]

function scoreEntry(entry: SettingsEntry, terms: string[]) {
  const title = entry.title.toLowerCase()
  const text = `${entry.title} ${entry.description} ${entry.keywords ?? ''}`.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (title === term) score += 120
    else if (title.startsWith(term)) score += 90
    else if (title.includes(term)) score += 70
    else if (text.includes(term)) score += 40
    else {
      const fuzzy = fuzzyScore(term, title) ?? fuzzyScore(term, text)
      if (fuzzy === null) return 0
      score += Math.min(30, Math.max(4, fuzzy / 4))
    }
  }
  return score
}

export function searchSettings(query: string, entries: SettingsEntry[] = settingsEntries) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const ranked: { entry: SettingsEntry; score: number }[] = []
  for (const entry of entries) {
    const score = scoreEntry(entry, terms)
    if (score > 0) ranked.push({ entry, score })
  }
  return ranked
    .sort((left, right) => right.score - left.score
      || SETTINGS_TABS.indexOf(left.entry.tab) - SETTINGS_TABS.indexOf(right.entry.tab)
      || left.entry.title.localeCompare(right.entry.title))
    .map((item) => item.entry)
}

export function groupSettingsByTab(entries: SettingsEntry[]) {
  const grouped = new Map<SettingsTab, SettingsEntry[]>()
  for (const tab of SETTINGS_TABS) {
    const matches = entries.filter((entry) => entry.tab === tab)
    if (matches.length > 0) grouped.set(tab, matches)
  }
  return grouped
}
