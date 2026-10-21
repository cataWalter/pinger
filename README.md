# Pinger

[![CI](https://github.com/cataWalter/pinger/actions/workflows/ci.yml/badge.svg)](https://github.com/cataWalter/pinger/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cataWalter/pinger)](https://github.com/cataWalter/pinger/releases)
[![Go 1.26+](https://img.shields.io/badge/Go-1.26%2B-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Wails v3](https://img.shields.io/badge/Wails-v3.0.0_beta.30-ff5e14)](https://wails.io)
[![License: AGPL-3.0+](https://img.shields.io/badge/license-AGPL--3.0%2B-blue.svg)](#license)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#run-locally)

Desktop client for [gomuks](https://github.com/gomuks) — a Matrix client with SQLite caching and media storage. Pinger embeds gomuks' `pkg/hicli` engine in a [Wails v3](https://wails.io) (Go) host with a React + TypeScript interface.

> **License note:** This application embeds `gomuks`' `pkg/hicli` engine. Review the AGPL-3.0-or-later license obligations before distributing.

## Contents

- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Data storage & privacy](#data-storage--privacy)
- [Run locally](#run-locally)
- [Project structure](#project-structure)
- [Development & checks](#development--checks)
- [Releases](#releases)
- [License](#license)

## Features

**Triage & workflow**

- **Needs reply** sidebar view, persisted in SQLite. Mark a room answered with `E` (configurable in Settings → Keyboard); `Ctrl+Z` / `⌘Z` restores the most recently dismissed room. Triage shortcuts are ignored while the composer is focused.
- **Room filters**: All, Archive, Needs reply, and Favorites toggles plus a one-click "archive all read rooms" cleanup; `Ctrl+Shift+U` shows only needs-reply rooms, `Ctrl+Shift+A` shows all.
- **Quick switcher** (`Ctrl+K` / `⌘K`) fuzzy-jumps to any room by name; **message search** (`Ctrl+F` / `⌘F`) searches local history across all rooms with optional filters (chat, sender, from/to dates); `/` focuses room search.
- **Room navigation**: `Ctrl+1`–`Ctrl+9` jump to a room by list position; `Alt+↑`/`Alt+↓` cycle rooms; `Ctrl+Shift+↑`/`Ctrl+Shift+↓` cycle needs-reply rooms; `Ctrl+Shift+L` jumps to the latest message.
- **Room actions**: right-click a room (or `Shift+F10`) to remove it from Needs reply, mark it read/unread, archive/restore it, or favorite/unfavorite it; multi-selecting rooms applies the same actions in bulk. The tray menu and the macOS **Messages** menu can mark everything read.

**Accounts**

- Sign in to several Matrix accounts from the avatar menu at the bottom of the sidebar. The inbox can show every account or scope to one, and `Ctrl+Alt+1`–`Ctrl+Alt+9` switches the active account.
- Every account keeps its own database, preferences, and AI profiles under the data directory.

**Messaging**

- Reply and quick-reaction controls stay visible; replying opens a quoted reply composer; reactions show as chips. The message **context menu** offers Reply, React, Bookmark, Mark as unread, Copy (plain or with timestamp), Forward…, a "Received at" timestamp, Set reminder, and — when an AI endpoint is configured — Translate, Draft reply with AI, and Explain message; your own messages add Edit and Delete, and failed sends add Retry sending.
- **Forward** text messages to any other room of the same account; bookmarks and read-state changes are stored locally.
- In direct chats, your own messages show a **Seen at** timestamp derived from the other person's read receipt.
- The composer accepts pasted images and files dropped onto the window (50 MiB per attachment), completes `@` mentions from the room member list, suggests emoji for `:shortcodes:`, optionally replaces emoticons as you type, and offers an optional formatting toolbar (bold, italic, inline code, strikethrough) with spellcheck.
- **Voice notes** record straight from the composer with a selectable microphone (up to 4 minutes / 50 MiB); the next voice note can auto-play. Any audio message can be **transcribed with AI** and the transcript inserted into the composer as a draft.
- An optional **undo send** window (5–30 seconds) holds outgoing messages briefly so they can be recalled.

**Scheduled messages & reminders**

- **Send Later** schedules a draft — or a reply — for a future time; **Remind Later** sets a reminder on any message. Delays run from 1 minute to 7 days, with default delays and quick time suggestions configurable in Settings → General.
- The queue dialog (clock icon in the header) lists pending, fired, and failed jobs and lets you reschedule, edit, or cancel them. Reminders surface as an in-app notice and a desktop notification, and can archive the room afterwards.
- Jobs persist in `scheduled-jobs.json` and fire from a background worker while Pinger is running.

**AI assistance**

- Configure an OpenAI-compatible endpoint in Settings → Integrations (endpoint URL, optional model name, translation language, connection test) — including a llama-server you run yourself.
- Actions: **Ask AI** (answer a question using room context), draft a reply, explain or translate a selected message, rewrite or shorten composer text, summarize a room, identify chat topics and themes, analyze a two-person conversation, and run a per-room chat agent. **Translate chat to English** batches the room history so a whole conversation can be translated at once, and audio messages can be transcribed (optional transcription model in Settings → Integrations). Results can be inserted into the composer as a draft or reply.
- Create up to eight named instruction profiles per room, with an optional default. Profiles are managed in the room **Details** panel, stored in the active account's local preferences, and are not synced through Matrix.
- AI actions return suggestions only. Nothing is sent as a Matrix message unless you review and send it yourself. The selected text, included chat context, and custom profile instructions are sent to the configured endpoint, which may be remote.
- **AI Ghostwriter** is a separate, opt-in local feature. It offers three context-aware reply chips, a Tab-accepted inline continuation after 300 ms, and `/ghost <intent>` for a complete draft. Configure Ollama or a llama.cpp-compatible server in Settings → Integrations; Ghostwriter accepts only HTTP loopback endpoints, bypasses proxies, rejects redirects, and never sends a message automatically. Autocomplete times out after 1.5 seconds.
- **Tone Guard** checks drafts over 10 words, drafts sent from 10 PM to 6 AM, drafts after tense incoming messages, or every draft in rooms where it is enabled. It uses only a local loopback model; a remote endpoint, timeout, or model error fails open. Medium- or high-severity drafts can be replaced with a calmer alternative or sent unchanged.

**Room details & media**

- The header toggles the sidebar; **Details** opens a panel with the room ID and topic, chat-agent profiles, the member list, and a Leave room button. The header also carries favorite, mute, message search, and scheduled-queue buttons.
- Room/member avatars and attachments are downloaded from Matrix content URIs and stored in the on-disk media cache; avatars are also cached in memory for the session and resized for display. Missing images use a generated initials icon.

**Appearance**

- System default plus ten themes — Light, Dark, OLED black, Bosco, Rosa, Dracula, Midnight, Slate, Solarized, Sepia — each with its own default outgoing-message color, plus independent accent palettes and chat wallpapers.
- Font size (Small/Medium/Large), app zoom 75–125% (`Ctrl`/`⌘` + `+` / `-` / `0`), compact message layout, compact chat list, transparent sidebar, room previews, unread badges, network labels for bridged chats, favorite placement (top of list or star only), message animations, 24-hour or relative timestamps, optional hiding of media and deleted messages, balanced line wrapping, and a pointer cursor on clickable controls.

**System tray & notifications**

- Alerts use the operating system's native notification service: Notification Center on macOS, toast notifications on Windows, and the freedesktop notification service on Linux. macOS requires the bundled Pinger app identity; Windows and Linux use system notification settings. Desktop settings control permission, focus, sound and volume, content privacy (sender + preview, sender only, or hidden), and separate alerts for direct messages, mentions, and group messages with a per-category tone (Chime, Pulse, Soft, Silent). Muted rooms never notify. Settings → Notifications can open the OS notification settings for Pinger.
- Optional batching combines new messages into one alert; a repeat reminder re-surfaces a still-unread room (after 5, 15, or 60 minutes); one-time codes can alert immediately and copy the code to the clipboard; an optional sound effect plays when a message is sent.
- Reopen the window, mark all rooms read, or quit from the tray menu; the tray icon and tooltip reflect unread activity and follow the system light/dark appearance. Closing the window can minimize to tray; the startup preference registers the app with the OS. Clicking a notification focuses the app and opens the relevant room.

**Settings** (`Ctrl+,` / `⌘,`)

A searchable dialog with twelve tabs:

- **General** — launch at login, tray behavior (minimize to tray, start minimized, quit on close, menu bar icon), download folder and "ask where to save", double-click action, quick-reaction options, navigation after read/archive, inactive-room age and Archive inactive rooms, voice-note microphone and autoplay, schedule defaults and suggestions.
- **Account** — profile details, typing indicators, incognito mode (pauses read markers), log out.
- **Appearance** — theme, accent, wallpaper, font size, app zoom, message and sidebar layout, timestamps.
- **Notifications** — permission, enable/focus, sound and volume, content privacy, per-category alerts and tones, batching, repeat reminder, one-time-code handling, sound effects, and a button that opens the OS notification settings for Pinger.
- **Keyboard** — Ctrl+Enter send, undo send window, spellcheck, formatting toolbar, emoji suggestions, emoticon replacement, copy timestamps, Up-arrow focus, single-key shortcuts (R, J, K, and the answered key), mark-answered key, full shortcut list.
- **History** — messages loaded when a room opens (25–1000).
- **Devices** — list active devices with last-seen details and revoke them.
- **Storage** — database, WAL, and media-cache sizes; clear media cache; optimize the database (VACUUM); storage per chat; cleanup filtered by media type and age.
- **Security** — device verification status; export/import room keys protected with a passphrase.
- **Help** — shortcuts, storage, local AI, bridged networks, encryption FAQ, and a report-an-issue link.
- **About** — version and build info, check for updates with release notes, repository, feedback, and license links.
- **Integrations** — OpenAI-compatible AI (endpoint, model, transcription model, translation language, test), local AI Ghostwriter (Ollama or OpenAI-compatible loopback endpoint), and detected chat networks (WhatsApp, Telegram, Instagram, Signal, iMessage, Discord, Slack, SMS).

## Keyboard shortcuts

Press `?` in the app (or open Settings → Keyboard) for the authoritative list.

| Shortcut | Action |
| --- | --- |
| `E` *(configurable)* | Mark the selected room answered |
| `Ctrl+Z` / `⌘Z` | Undo — restore the last answered room |
| `R` | Reply to the focused message |
| `J` / `K` or `↑` / `↓` | Move through the focused timeline |
| `?` | Open Settings → Keyboard (full shortcut list) |
| `/` or `Ctrl+Shift+S` / `⌘⇧S` | Focus room search |
| `Ctrl+K` / `⌘K` | Open the quick switcher |
| `Ctrl+F` / `⌘F` | Search local message history across rooms |
| `Ctrl+,` / `⌘,` | Open Settings |
| `Alt+↑` / `Alt+↓` | Previous / next room |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Previous / next needs-reply room |
| `Ctrl+Shift+U` | Filter to needs-reply rooms only |
| `Ctrl+Shift+A` | Show all rooms (clear filters) |
| `Ctrl+Shift+L` | Jump to the latest messages |
| `Ctrl+1` … `Ctrl+9` | Jump to room by list position |
| `Ctrl+Alt+1` … `Ctrl+Alt+9` | Switch Matrix account |
| `Ctrl`/`⌘` + `+` / `-` / `0` | Zoom in / out / reset app zoom |
| `↑` `↓` `Home` `End` | Navigate the room list |
| `Shift+F10` | Open the room actions menu |
| `Home` / `End` | Focus the first / latest message in the timeline |
| `Escape` | Close search or dialog |
| `Tab` / `Shift+Tab` | Accept a visible Ghostwriter continuation, otherwise move between controls |
| `Enter` or `Ctrl+Enter` / `⌘↩` | Send message *(toggleable in Settings → Keyboard)* |
| `Shift+Enter` | New line in the composer |

Single-key shortcuts (`R`, `J`, `K`, and the answered key) can be turned off in Settings → Keyboard; `Ctrl`/`⌘` shortcuts keep working. Single keys are ignored while typing in the composer or when a dialog is open.

## Data storage & privacy

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| **Data directory** | `~/Library/Application Support/gomuks-desktop` | `%AppData%\gomuks-desktop` | `~/.config/gomuks-desktop` |
| **Media cache** | `~/Library/Caches/gomuks-desktop/media` | `%LocalAppData%\gomuks-desktop\media` | `~/.cache/gomuks-desktop/media` |

- The data directory holds the primary account's SQLite database (`matrix.db`; additional accounts live under `accounts/<account-id>/matrix.db`), the preferences database (`preferences.db`), the account registry (`accounts.json`), scheduled messages and reminders (`scheduled-jobs.json`), the Olm pickle key (`crypto.key`), and the legacy `preferences.json` file that is imported into `preferences.db` on first launch.
- The local SQLite cache stores message data, including decrypted event contents. Downloaded media is cached under the user's cache directory; encrypted payloads are decrypted before caching, and cache files are owner-only. Clearing the media cache (Settings → Storage) removes only downloaded media — use OS disk encryption for protection at rest.
- Tone Guard sends only the draft and up to two recent incoming messages to a configured loopback HTTP model. It never sends this context to a remote endpoint; when the configured endpoint is not local or the check fails, the message can still be sent.
- On first launch, data from the legacy Fyne build (`fyne-matrix` data directory and `fi.mau.fyne-matrix` preferences) is migrated into the current data directory; the legacy database is copied with SQLite's online backup API.

### Ghostwriter storage boundary

Ghostwriter reads up to 200 messages from the active room through `matrix.Client.HistoryPageWithLimit`; this reuses gomuks' existing SQLite-backed timeline and does not open a second database connection. Only bounded room context and outgoing style examples are sent to the configured loopback model. The frontend never receives database paths, handles, or keys.

The Matrix cache currently uses SQLite, not SQLCipher. If SQLCipher is introduced, configure it where the gomuks database is opened and keep Ghostwriter on `HistoryPageWithLimit` so the engine owns the encrypted connection and key lifecycle. If a future requirement needs direct SQL reads, add a bounded, read-only typed method to `matrix.Client` beside `HistoryPageWithLimit`; do not open the database from the desktop service or expose SQLCipher keys to TypeScript. Use OS disk encryption for the current SQLite cache at rest.

## Run locally

Targets macOS 12+, Windows x64 (WebView2 Runtime), and Linux x64.

### Prerequisites

- [Go 1.26+](https://go.dev/dl/)
- [Node.js 22+](https://nodejs.org/) with npm
- Wails CLI **v3.0.0-beta.30** (must match `go.mod`):
  `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.30`
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- Linux: GTK4 and WebKitGTK 6 development libraries (required by Wails on Linux)

Two Go build tags are used throughout: `sqlite_fts5` is required (SQLite full-text search), and `goolm` selects mautrix-go's pure-Go Olm implementation (no libolm needed).

### Build and run

From the repository root:

```sh
wails3 generate bindings -f '-tags sqlite_fts5,goolm' -clean=true -ts -i
npm --prefix frontend ci
sh scripts/build-macos-app.sh
open bin/Pinger.app
```

- The script builds the frontend and executable, packages `Pinger.app`, and ad-hoc signs it so macOS can register native notifications. Quit with `Cmd+Q`.
- A plain `go run -tags "sqlite_fts5 goolm" .` launches an unbundled executable, so macOS native notifications are unavailable in that mode.
- The equivalent Task command is `task package:go`.
- Matrix sync events are handled off the UI thread and delivered to the React interface through Wails runtime events.

`go build` creates a plain executable and cannot carry the macOS bundle metadata needed for a stable Finder, Dock, tray, and Notification Center identity. Use the signed app bundle for native notifications.

### Live development

```sh
wails3 task dev
```

Hot-reloads the frontend via Vite and rebuilds the Go app on change.

## Project structure

| Path | Purpose |
| --- | --- |
| `main.go` | Entry point — embeds the frontend, migrates legacy data, and starts the desktop app |
| `desktop/` | Wails application: services, preferences, system tray, scheduled reminders, attachments |
| `frontend/` | React + TypeScript UI (Vite build, vitest tests) |
| `matrix/` | Matrix client wrapper around gomuks' `hicli` engine |
| `migration/` | First-run migration from the legacy Fyne app |
| `preferences/` | Shared SQLite preference store (global and per-account scopes) |
| `notifications/` | Desktop notification backends (native macOS and fallback) |
| `scripts/` | macOS app packaging script |
| `build/` | Wails build configuration and platform assets |
| `assets/` | Application icons |
| `.github/workflows/` | CI and release pipelines |

## Development & checks

Build the frontend before compiling Go. The same checks run in CI on every push to `main` and pull request; backend checks don't launch a desktop window:

```sh
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
go test -tags "sqlite_fts5 goolm" ./desktop ./matrix ./migration ./preferences
go vet -tags "sqlite_fts5 goolm" ./desktop ./matrix ./migration ./preferences
go build -tags "sqlite_fts5 goolm" .
```

## Releases

Pushing a `v*` tag runs the release workflow, which builds universal (arm64 + amd64) macOS binaries on `macos-latest`, x64 Windows binaries on `windows-latest`, and x64 Linux binaries on `ubuntu-latest`, then publishes a GitHub Release. Manually dispatching the workflow uploads the same packages as workflow artifacts without publishing a release.

| Artifact | Contents |
| --- | --- |
| `Pinger-<version>-macos-universal.dmg` | Signed app + `/Applications` symlink |
| `Pinger-<version>-windows-amd64.zip` | `pinger.exe` with embedded icon and manifest |
| `Pinger-<version>-linux-amd64.deb` | Debian package for Linux x64 |
| `Pinger-<version>-linux-amd64.AppImage` | Portable AppImage for Linux x64 |
| `checksums.txt` | SHA-256 manifest for all packages |

Desktop release builds embed version, commit, and build timestamp via ldflags; other builds report `dev`.

## License

AGPL-3.0-or-later, matching the embedded gomuks `hicli` engine. See [gnu.org/licenses](https://www.gnu.org/licenses/agpl-3.0.html) for the license text.
