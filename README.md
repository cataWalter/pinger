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
- [Using with Beeper](#using-with-beeper)
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
- **Invitations** appear at the top of the All view with Accept and Decline buttons; invite avatars are not loaded until you join. The **+** button beside the room list joins a room by alias, room ID, or matrix.to link, or creates a private group with an optional topic, invitees, and end-to-end encryption (on by default).

**Accounts**

- Sign in to several Matrix accounts from the avatar menu at the bottom of the sidebar. The inbox can show every account or scope to one, and `Ctrl+Alt+1`–`Ctrl+Alt+9` switches the active account.
- Every account keeps its own database, preferences, and AI profiles under the data directory.
- Unsent composer drafts stay separate for each account and room and, by default, are saved on this device so they return after a restart (Settings → Keyboard → **Keep unsent drafts after restarting**; turning it off deletes saved drafts). Staged attachments stay only while the app is running. Switching accounts preserves both; logging out or leaving a room discards its drafts. Pending confirmations and AI suggestions close when switching accounts.

**Messaging**

- Reply and quick-reaction controls stay visible; replying opens a quoted reply composer; reactions show as chips. The message **context menu** offers Reply, Reply in thread, React, Bookmark, Mark as unread, Copy (plain or with timestamp), Forward…, a "Received at" timestamp, Set reminder, and — when an AI endpoint is configured — Translate, Draft reply with AI, and Explain message; your own messages add Edit and Delete, and failed sends add Retry sending.
- **Forward** text messages to any other room of the same account; bookmarks and read-state changes are stored locally.
- In direct chats, your own messages show a **Seen at** timestamp derived from the other person's read receipt.
- The composer accepts pasted images and files dropped onto the window (50 MiB per attachment), completes `@` mentions from the room member list, suggests emoji for `:shortcodes:`, and optionally replaces emoticons as you type. The **Formatting** menu preserves the selected draft text; Settings can keep the full formatting toolbar expanded.
- **Voice notes** record straight from the composer with a selectable microphone (up to 4 minutes / 50 MiB); the next voice note can auto-play. Any audio message can be **transcribed with AI** and the transcript inserted into the composer as a draft.
- An optional **undo send** window (5–30 seconds) holds outgoing messages briefly so they can be recalled.
- **Link previews** show a title, summary, and thumbnail under the first web link in a text message. Your homeserver fetches the page; previews are off in encrypted rooms unless enabled in Settings → Appearance.
- **Threads**: replies in a thread are grouped under their first message with a reply count and the latest reply. Click it, or choose **Reply in thread**, to read and answer the thread in a side panel.

**Scheduled messages & reminders**

- **Send Later**, in the composer's **Delivery options** menu, schedules a draft — or a reply — for a future time; the same menu starts video recording. **Remind Later** sets a reminder on any message. Delays run from 1 minute to 7 days, with default delays and quick time suggestions configurable in Settings → General.
- The queue dialog, under **Room actions → Scheduled messages and reminders**, lists pending, fired, and failed jobs and lets you reschedule, edit, or cancel them. Its count remains visible in the header. Reminders surface as an in-app notice and a desktop notification, and can archive the room afterwards.
- Jobs persist in `scheduled-jobs.json` and fire from a background worker while Pinger is running.
- Scheduled messages remain in the sending state until Matrix confirms delivery. Failed or interrupted jobs retain their transaction ID for retry; check the room before retrying an interrupted send.
- Temporary failures to save a delivery result are retried without resending the message. An app exit before storage recovers still requires interrupted-send recovery on the next launch.

**AI assistance**

- The composer's **AI tools** menu groups Language Tutor, suggested replies, image generation, summarization, and translation. Active image generation keeps a directly accessible Stop control.
- AI action shortcuts are shown in menus and Settings → Keyboard.

- Configure an OpenAI-compatible endpoint in Settings → Integrations (endpoint URL, optional model name, connection test) — including a llama-server you run yourself. Each chat's tutor language is set in its room details and defaults to the default language chosen in Settings → AI.
- Actions: **Ask AI** (answer a question using room context), draft a reply, explain or translate a selected message, rewrite or shorten composer text, summarize a room, identify chat topics and themes, analyze a two-person conversation, and run a per-room chat agent. **Translate chat** into the chat's tutor language batches the room history so a whole conversation can be translated at once, and audio messages can be transcribed (optional transcription model in Settings → Integrations). Results can be inserted into the composer as a draft or reply.
- Create up to eight named instruction profiles per room, with an optional default. Profiles are managed in the room **Details** panel, stored in the active account's local preferences, and are not synced through Matrix.
- AI actions return suggestions only. Nothing is sent as a Matrix message unless you review and send it yourself. The selected text, included chat context, and custom profile instructions are sent to the configured endpoint, which may be remote.
- **Tone Guard** checks drafts over 10 words, drafts sent from 10 PM to 6 AM, drafts after tense incoming messages, or every draft in rooms where it is enabled. It uses only a local loopback model; a remote endpoint, timeout, or model error fails open. Medium- or high-severity drafts can be replaced with a calmer alternative or sent unchanged.

**Room details & media**

- **Room details** opens a panel with the room ID and topic, chat-agent profiles, the member list, an **Invite people** field, and a Leave room button. Search and details stay visible in the header; **Room actions** contains the media gallery, export, scheduled queue, favorite, and mute commands. Favorite and muted indicators remain visible beside the room title.
- Room/member avatars and attachments are downloaded from Matrix content URIs and stored in the on-disk media cache; avatars are also cached in memory for the session and resized for display. Missing images use a generated initials icon.
- Images embedded in Markdown are displayed as links and only open in the system browser when clicked. Automatic downloads reserve unique filenames without overwriting existing files.

**Appearance**

- System default plus eleven themes — Light, Dark, VS Code, OLED black, Bosco, Rosa, Dracula, Midnight, Slate, Solarized, Sepia — with visual previews, independent accent palettes, and chat wallpapers. Existing theme names and custom colors are preserved; text and focus colors are derived for readability.
- Font size (Small/Medium/Large), app zoom 75–125% (`Ctrl`/`⌘` + `+` / `-` / `0`), compact chat list, room previews, unread badges, network labels for bridged chats, favorite placement (top of list or star only), message animations, 24-hour or relative timestamps, optional hiding of media and deleted messages, balanced line wrapping, and a pointer cursor on clickable controls.
- Motion is restrained and follows the OS reduced-motion preference. Message entrances apply only to new visible arrivals, not history loads, older-page prepends, or receipt updates.

**System tray & notifications**

- Alerts use the operating system's native notification service: Notification Center on macOS, toast notifications on Windows, and the freedesktop notification service on Linux. macOS requires the bundled Pinger app identity; Windows and Linux use system notification settings. Desktop settings control permission, focus, sound and volume, content privacy (sender + preview, sender only, or hidden), and separate alerts for direct messages, mentions, and group messages with a per-category tone (Chime, Pulse, Soft, Silent). Muted rooms never notify. Settings → Notifications can open the OS notification settings for Pinger.
- Optional batching combines new messages into one alert; a repeat reminder re-surfaces a still-unread room (after 5, 15, or 60 minutes); one-time codes can alert immediately and copy the code to the clipboard; an optional sound effect plays when a message is sent.
- Reopen the window, mark all rooms read, or quit from the tray menu; the tray icon and tooltip reflect unread activity and follow the system light/dark appearance. Closing the window can minimize to tray; the startup preference registers the app with the OS. Clicking a notification focuses the app and opens the relevant room.
- On macOS, the Dock badge and menu-bar number match the sidebar's Needs reply total: rooms awaiting a reply, excluding archived rooms and following the inbox account scope. Both numbers disappear when the total is zero.
- All desktop platforms use the shared Pinger artwork. Windows embeds the ICO in the executable and uses the avatar or Pinger fallback as the toast logo; Linux supplies the window PNG and matches the installed `fi.mau.pinger.desktop` entry for GTK4/Wayland dock icons. macOS uses the bundled ICNS and runtime Dock icon. Notification avatars take priority over fallback artwork.

**Settings** (`Ctrl+,` / `⌘,`)

A searchable dialog with twelve tabs:

- **General** — launch at login, tray behavior (minimize to tray, start minimized, quit on close, menu bar icon), download folder and "ask where to save", double-click action, quick-reaction options, navigation after read/archive, inactive-room age and Archive inactive rooms, voice-note microphone and autoplay, schedule defaults and suggestions.
- **Account** — profile details, typing indicators, content blur (read receipts are still sent when you open a room), log out.
- **Appearance** — theme, accent, wallpaper, font size, app zoom, message and sidebar layout, link previews, timestamps.
- **Notifications** — permission, enable/focus, sound and volume, content privacy, per-category alerts and tones, batching, repeat reminder, one-time-code handling, sound effects, and a button that opens the OS notification settings for Pinger.
- **Keyboard** — Ctrl+Enter send, undo send window, spellcheck, formatting toolbar, emoji suggestions, emoticon replacement, copy timestamps, Up-arrow focus, single-key shortcuts (R, J, K, and the answered key), mark-answered key, full shortcut list.
- **History** — messages loaded when a room opens (25–1000).
- **Devices** — list active devices with last-seen details, revoke them, and start an emoji comparison with another verified session.
- **Storage** — database, WAL, and media-cache sizes; clear media cache; optimize the database (VACUUM); storage per chat; cleanup filtered by media type and age.
- **Security** — device verification status; export/import room keys protected with a passphrase.
- **Help** — shortcuts, storage, local AI, bridged networks, encryption FAQ, and a report-an-issue link.
- **About** — version and build info, check for updates with release notes, repository, feedback, and license links.
- **Integrations** — OpenAI-compatible AI (endpoint, model, transcription model, translation language, test) and detected chat networks (WhatsApp, Telegram, Instagram, Signal, iMessage, Discord, Slack, SMS).

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
| `Ctrl`/`⌘` + `Shift+T` | Analyze the composer draft with Language Tutor |
| `Ctrl`/`⌘` + `Shift+B` | Suggest replies |
| `Ctrl`/`⌘` + `Shift+J` | Generate an image from the draft for approval |
| `Ctrl`/`⌘` + `Shift+O` | Prepare a Local AI summary chat |
| `Ctrl`/`⌘` + `Shift+Y` | Translate messages received since your last message |
| `Ctrl`/`⌘` + `Shift+X` | Clear message translations |
| `Ctrl`/`⌘` + `Shift+C` | Analyze the focused message with Language Tutor |
| `Ctrl`/`⌘` + `Shift+D` | Draft a reply to the focused message |
| `Ctrl`/`⌘` + `Shift+E` | Explain the focused message |
| `Ctrl`/`⌘` + `Shift+V` | Transcribe the focused audio message |
| `Ctrl`/`⌘` + `Shift+M` | Start a private model chat |
| `Ctrl+1` … `Ctrl+9` | Jump to room by list position |
| `Ctrl+Alt+1` … `Ctrl+Alt+9` | Switch Matrix account |
| `Ctrl`/`⌘` + `+` / `-` / `0` | Zoom in / out / reset app zoom |
| `↑` `↓` `Home` `End` | Navigate the room list |
| `Shift+F10` | Open the room actions menu |
| `Home` / `End` | Focus the first / latest message in the timeline |
| `Escape` | Close search or dialog |
| `Tab` / `Shift+Tab` | Move between controls |
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
- Saved composer drafts (the 100 most recent, up to 8,000 characters each) are kept as plain text in the app's web storage on this device. Logging out removes that account's drafts; turning off **Keep unsent drafts after restarting** removes all of them.
- Tone Guard sends only the draft and up to two recent incoming messages to a configured loopback HTTP model. It never sends this context to a remote endpoint; when the configured endpoint is not local or the check fails, the message can still be sent.
- Link previews send the link to your homeserver's preview endpoint, which fetches the page. They are on by default for unencrypted rooms and off for encrypted rooms; both can be turned off in Settings → Appearance. Previews are cached in memory only.
- On first launch, data from the legacy Fyne build (`fyne-matrix` data directory and `fi.mau.fyne-matrix` preferences) is migrated into the current data directory; the legacy database is copied with SQLite's online backup API.
- On each launch, removed features' stored data is deleted: the `relationship-health.db*` files for each account and their retired preference keys. The step is idempotent and ignores missing files.

## Run locally

Targets macOS 12+, Windows x64 (WebView2 Runtime), and Linux x64.

### Using with Beeper

Pinger connects directly to Beeper's Matrix homeserver at `https://matrix.beeper.com/`. It does not create Beeper accounts or pair chat networks.

1. **Register and connect your chats in Beeper first.** [Download the official Beeper app](https://www.beeper.com/download) on mobile or desktop, create your account, and link your supported networks, such as WhatsApp, Telegram, Signal or iMessage. New network logins, QR-code pairing and account linking must be completed in Beeper, not Pinger.
2. **Set a Matrix password for your existing Beeper account.** Email sign-in codes and Google or Apple sign-in are not a Matrix password. Use the password option in Beeper account settings or the account's supported password-reset flow. [Element Web](https://app.element.io/), configured with `https://matrix.beeper.com/`, may offer a **Forgot password** flow for your account. If no password or reset option is available, contact Beeper support rather than creating a separate Matrix account. If you already set a Matrix password, use that password or reset it if forgotten.
3. **Sign in to Pinger.** Choose **Use Beeper Homeserver** on the sign-in screen, or enter `https://matrix.beeper.com/` manually. Use your full Matrix user ID, for example `@your_user:beeper.com`, and your Matrix password. The **Using Beeper with Pinger?** guide repeats these steps and links to the official app.

**Verify the new device:** approve the Pinger session from an existing signed-in Beeper client when supported, or enter your account's Recovery Key or recovery passphrase when Pinger prompts for it. After a session is verified, use **Devices → Verify another session** to compare emoji with another session or respond to an incoming request. A new unverified session may still require the Recovery Key or passphrase because it cannot sync the to-device verification request before encryption setup. Keep your existing Beeper session and recovery information available; signing in does not replace account verification or bridge setup. Never share your password or Recovery Key.

### Prerequisites

- [Go 1.26.10](https://go.dev/dl/); scripts and tasks explicitly select this patched compiler because Go 1.27 requires macOS 13 and cannot retain macOS 12 support
- [Node.js 22+](https://nodejs.org/) with npm
- Wails CLI **v3.0.0-beta.30** (must match `go.mod`):
  `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.30`
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) and MinGW-w64 GCC for CGO (MSYS2 UCRT64 is supported; `gcc` must be on `PATH` or under `tools/msys64/ucrt64/bin`)
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

`go build` creates a plain executable and cannot carry the macOS bundle metadata needed for a stable Finder, Dock, tray, and Notification Center identity. Use the app bundle for native notifications. The bundle is ad-hoc signed for local identity; this is not Developer ID signing or notarization.

### Live development

```sh
wails3 task dev
```

Hot-reloads the frontend via Vite and rebuilds the Go app on change.

For a native executable without the desktop installer, run `wails3 task build:linux` on Linux or `wails3 task build:windows` on Windows. These write to `bin/`; Windows builds require MinGW-w64 GCC on `PATH`. The Windows ZIP and Linux DEB/AppImage installers are produced by the release workflow; local builds do not create those installer formats.

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

Application artwork is maintained in [assets/pinger.svg](assets/pinger.svg). Regenerate app PNGs, macOS ICNS, Windows ICO, Linux launcher sizes, and browser favicons with `npm --prefix frontend run icons`; verify freshness and native resolutions with `npm --prefix frontend run icons:check`. Both commands need frontend dependencies and the matching Wails CLI (resolved from `PATH`, `GOBIN`, or `GOPATH/bin`; `WAILS_COMMAND` can override it). Task builds, macOS packaging, and release jobs regenerate icons automatically. Local Windows Task builds also embed the ICO and application manifest.

macOS tray artwork uses native monochrome templates; Windows variants follow system appearance rather than the chat theme, and Linux uses a colored mark. Linux alerts without a room avatar use cached application artwork; existing avatar attachments are preserved.

Build the frontend before compiling Go. The same checks run in CI on every push to `main` and pull request; backend checks don't launch a desktop window:

```sh
npm --prefix frontend ci
npm --prefix frontend exec -- playwright install chromium webkit
npm --prefix frontend test
npm --prefix frontend run test:browser
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=moderate
export GOTOOLCHAIN=go1.26.10
go test -tags "sqlite_fts5 goolm" ./...
go test -race -count=1 -tags "sqlite_fts5 goolm" ./desktop ./matrix ./preferences
go vet -tags "sqlite_fts5 goolm" ./...
go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 -checks='SA*' -tags sqlite_fts5,goolm ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -tags sqlite_fts5,goolm ./...
go build -tags "sqlite_fts5 goolm" .
```

CI also runs 30-second, two-worker fuzz campaigns for local AI endpoint validation, media path parsing, and Matrix message content. To run one locally, use `go test -tags sqlite_fts5,goolm ./matrix -run '^$' -fuzz '^FuzzMessageFromEvent$' -fuzztime=30s -parallel=2`; the other targets are `FuzzValidateLocalHTTPEndpoint` in `./preferences` and `FuzzParseMediaAssetPath` in `./desktop`.

Workflow definitions and external actions are checked by pinned `actionlint`; the build setup is shared in [.github/actions/setup-build/action.yml](.github/actions/setup-build/action.yml). Required job IDs stay `checks`, `windows-checks`, and `linux-checks`. Run the workflow policy and release-asset regressions locally with:

```bash
actionlint
ruby scripts/check-workflows.rb
node --test scripts/release-assets.test.mjs
```

Windows and Linux PR jobs compile the package tests and native application using the release pipeline's CGO setup. They do not exercise native windows, notifications, or operating-system permissions. Production JavaScript and CSS explicitly target Safari 15 for macOS 12; current Playwright WebKit is not a substitute for testing that minimum operating system.

Frontend performance regressions cover render counts, including that composer typing does not rerender timeline Markdown, and per-render clock/relative formatter reuse. A local formatting microbenchmark measured roughly 311 ms versus 5 ms for 10,000 timestamps; this is not a whole-application frame-rate or memory benchmark. Large-history virtualization remains a separate measured change.

### Dependency maintenance

[Dependabot](.github/dependabot.yml) checks Go, frontend, and GitHub Actions dependencies every Monday at 06:00 UTC, with at most three open version-update PRs per ecosystem. Patch/minor updates are grouped to reduce CI churn; React and its types stay together. Go and npm security updates have separate groups and do not wait for the weekly version-update schedule. Wails Go, CLI, and JavaScript runtime upgrades remain coordinated manually so their versions stay aligned. Vulnerability scans gate reachable Go findings and moderate-or-higher npm advisories; module-only advisories must still be reviewed separately.

The [auto-merge workflow](.github/workflows/dependabot-auto-merge.yml) queues squash merges only for verified, same-repository Dependabot PRs whose highest update is patch or minor. Major and unclassified updates remain manual. It never checks out or executes PR code. Repository auto-merge must be enabled, and `main` must require the GitHub Actions `checks`, `windows-checks`, and `linux-checks` jobs, an up-to-date branch, and resolved review conversations. These settings are enabled on this repository; administrator bypass is retained for maintainer operations. Keep the required check names aligned if CI jobs are renamed.

By default, the workflow uses `GITHUB_TOKEN`, whose merges do not trigger normal push-triggered CI or release workflows. To preserve those downstream workflows, add a repository Actions secret named `DEPENDABOT_AUTO_MERGE_TOKEN` containing a repository-scoped fine-grained personal access token with **Contents: Read and write** and **Pull requests: Read and write** permissions. For GitHub Actions updates, also grant **Workflows: Read and write**. Store it directly in GitHub, never in the repository. The workflow uses that token when present; no automatic PR approval or review-permission setting is needed.

## Releases

Every push to `main` runs the complete CI workflow, builds universal (arm64 + amd64) macOS binaries on `macos-latest`, x64 Windows binaries on `windows-latest`, and x64 Linux binaries on `ubuntu-24.04`, then publishes a numbered stable GitHub release with checksums and marks it as the latest release. A successful build also updates the Homebrew tap and Debian APT repository and submits the Windows package to WinGet. Pushing a `v*` tag publishes a stable release and runs the same distribution jobs. Manual dispatch builds packages without publication by default; set `publish=true` explicitly to publish a stable release.

After publication, the workflow updates the [Homebrew tap](https://github.com/cataWalter/homebrew-tap) with the macOS DMG URL and SHA-256 checksum. Install with `brew install --cask catawalter/tap/pinger`, or update an existing installation with `brew update && brew upgrade --cask pinger`.

The release workflow explicitly calls the APT and WinGet workflows after the build succeeds; it does not rely on `release: published` events generated by `GITHUB_TOKEN`. Main-branch releases and stable tags are both distributed automatically. Publication requires `TAP_GITHUB_TOKEN`, `GPG_PRIVATE_KEY` matching the APT repository's public key, and `WINGET_TOKEN` for the WinGet fork/PR. An encrypted signing key can use the optional `GPG_PASSPHRASE` secret. Private signing material is never uploaded.

Manual Homebrew, APT, and WinGet runs default to `dry_run=true`: they download an exact platform asset, verify its release checksum and available GitHub digest, then validate and upload metadata without pushing. APT dry runs sign with an ephemeral validation key and verify both signatures; production uses the configured repository key. WinGet validates all three manifests against pinned Microsoft schemas and uses the actual ZIP's nested `pinger.exe`; rerunning submission updates the existing branch/PR instead of opening a duplicate. Schema checks do not prove Microsoft acceptance or installation on a native Windows device.

```bash
gh workflow run ci.yml --ref main
gh workflow run release.yml --ref main -f publish=false
gh workflow run update-tap.yml --ref main -f tag=v0.13 -f dry_run=true
gh workflow run update-deb-repo.yml --ref main -f tag=v0.13 -f dry_run=true
gh workflow run winget-submission.yml --ref main -f tag=v0.13 -f dry_run=true
gh workflow run dependabot-auto-merge.yml --ref main
```

The committed `package-lock.json` makes npm the canonical package manager for CI and release builds. The root Taskfile also has optional Bun, pnpm, and Yarn adapters for local use, but those paths are not covered by CI and have no committed lockfiles.

| Artifact | Contents |
| --- | --- |
| `Pinger-<version>-macos-universal.dmg` | Ad-hoc-signed, not notarized app + `/Applications` symlink |
| `Pinger-<version>-windows-amd64.zip` | `pinger.exe` with embedded icon and manifest |
| `Pinger-<version>-linux-amd64.deb` | Debian package for Linux x64 |
| `Pinger-<version>-linux-amd64.AppImage` | Portable AppImage for Linux x64 |
| `checksums.txt` | SHA-256 manifest for all packages |

Desktop release builds embed version, commit, and build timestamp via ldflags; other builds report `dev`.

## License

AGPL-3.0-or-later, matching the embedded gomuks `hicli` engine. See [gnu.org/licenses](https://www.gnu.org/licenses/agpl-3.0.html) for the license text.
