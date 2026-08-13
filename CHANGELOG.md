# Changelog

All notable changes to Jellyfin MPV Play are documented here.

## v1.7.1

### Features
- CI auto-generates release notes from merged PR titles (categorized by feat/fix/docs/ci)
- `package.json` is now the single source of truth for version; `shim.js` reads it at runtime

### Bug Fixes
- Fixed `pendingQueries` not being resolved when MPV closes (could hang poll timer)
- Fixed random `deviceId` not being persisted (created zombie sessions on restart)
- Fixed stderr handler in NodeProcessManager not buffering partial lines
- Fixed `.desktop` file Exec line — `dirname "$0"` returned `.` instead of script directory

### Documentation
- Fixed duplicate step numbering in macOS Quick Start
- Added v1.7.1 to recent releases
- Fixed CODE_OF_CONDUCT.md using security advisory for CoC reports
- Added `*.tar.gz` to .gitignore
- Updated Info.plist version to match package.json

---

## v1.7.0 — Security, Stability, Bug Fixes

### Downloads
| Platform | File |
|----------|------|
| macOS | `JellyfinMPVPlay-macOS-v1.7.0.zip` |
| Linux | `JellyfinMPVPlay-Linux-v1.7.0.tar.gz` |
| Windows | `JellyfinMPVPlay-Windows-v1.7.0.zip` |

### Security
- **API key redaction** — stream URL no longer logged with `api_key` parameter
- **Token file permissions** — auth token file created with 0o600 (owner-only read/write)
- **Crash handlers** — added `uncaughtException`/`unhandledRejection` handlers for graceful shutdown

### Bug Fixes
- **ConfigParser regex rewritten** — escaped quotes in config values (e.g. `it\'s`) no longer truncate or corrupt the parsed value
- **Audio/subtitle stream commands** — now sent after MPV IPC connects, not before (were silently failing)
- **Backward episode navigation** — no longer marks current episode as watched when going to previous episode
- **StatusBarController** — added NSObject inheritance (menu item actions were broken at runtime)
- **StatusBarController togglePause** — fixed double-toggle causing pause state desync with MPV
- **SF Symbol compatibility** — replaced `menubar.arrow.up.rectangle` (requires macOS 14) with `menubar.rectangle` (macOS 11+)
- **Setup wizard** — closing window without completing no longer starts shim with invalid config
- **Setup wizard** — device name/ID and mpvPath values preserved when navigating back
- **Setup wizard** — default mpvPath now detects Apple Silicon vs Intel architecture
- **NodeProcessManager title extraction** — handles quoted titles with spaces correctly
- **NodeProcessManager togglePause** — sends predicted next state, not stale local state
- **NodeProcessManager findNodePath** — returns empty string on failure instead of bare "node"
- **NodeProcessManager sendMpvCommand** — logs IPC connect/send failures instead of silently returning
- **NotificationManager** — logs when notification permission is denied
- **launch.sh** — error handling code now actually runs (was blocked by `set -e`)
- **launch.sh** — follows symlinks to resolve script directory
- **launch.bat** — paths with special characters handled correctly
- **clientVersion** — synced with package.json version (was hardcoded `2.0.0`)
- **reportPlaybackProgress** — errors now logged instead of silently swallowed
- **scheduleReconnect** — changed from `setInterval` to `setTimeout` to prevent double-fire

### Improvements
- **Shared config escaping** — `ConfigParser.escapeConfigValue()` replaces duplicate `escape()` functions
- **Redundant dispatch removed** — `nowPlayingHandler` no longer double-dispatches to main queue
- **Stale version fallback removed** — About window shows "unknown" instead of hardcoded "1.3.1"
- **Application termination** — `applicationWillTerminate` waits for cleanup before exiting

---

## v1.6.0 — Cross-Platform Bundles, CI Build Workflow

### Downloads
| Platform | File |
|----------|------|
| macOS | `JellyfinMPVPlay-macOS-v1.6.0.zip` |
| Linux | `JellyfinMPVPlay-Linux-v1.6.0.tar.gz` |
| Windows | `JellyfinMPVPlay-Windows-v1.6.0.zip` |

### New Features
- **Linux bundle** — self-contained `.tar.gz` with bundled Node.js 22 LTS; just install MPV and run `./launch.sh`
- **Windows bundle** — self-contained `.zip` with bundled Node.js 22 LTS; just install MPV and run `launch.bat`
- **Linux desktop integration** — `.desktop` file included for app launcher support
- **CI/CD workflow** — GitHub Actions automatically builds and releases all 3 platform bundles on version tags
- **First-run config creation** — launchers auto-copy `config.example.js` to `config.js` on first run

### Improvements
- Updated `config.example.js` with platform-specific `mpvPath` examples
- Updated `macapp/build.sh` to skip `/Applications` deploy in CI environments
- Added `.gitattributes` for consistent line endings (CRLF for `.bat`, LF for `.sh`)

---

## v1.5.0 — Apple HIG Compliance, Bug Fixes, New Features

### New Features
- **Playback control from Jellyfin** — full `GeneralCommand` handler for volume, mute, audio/subtitle tracks, repeat mode, shuffle, fullscreen
- **Playstate commands** — PlayPause, NextTrack, PreviousTrack, Rewind (−10s), FastForward (+10s)
- **Series page play** — queries Jellyfin's NextUp API to find the correct episode
- **Copy Now Playing** — copies current title to clipboard
- **Open at Login** — toggle directly from menu bar dropdown
- **Open Config File** — opens `config.js` in default editor
- **Open App Folder** — opens Application Support directory in Finder

### Auto-Play Overhaul
- Fixed auto-play next episode — now uses IPC poll timer (queries mpv every 1s) instead of unreliable `eof-reached` events
- Episode transitions reuse the running MPV process via `loadfile` IPC command (no more window flash)
- Double-trigger prevention with `isPlayingNext` flag and 10s timeout
- Duplicate watched marking prevented with `markedWatched` Set

### Bug Fixes
- Fixed poll timer hanging forever when IPC disconnects (pending promises now resolved)
- Fixed `connectToMpvIpc` retries racing with new playback (generation check added)
- Fixed `reportPlaybackStop` failure leaving `isReportingStop` stuck true
- Fixed `loadNextEpisode` not clearing progress interval (stale position saves)
- Fixed `shutdown()` not reporting playback stop to server
- Fixed stale `currentDuration` from previous episode after IPC query failure
- Fixed `isPlayingNext` never resetting if `loadfile` send silently fails (10s timeout)
- Preferences save now triggers node restart (was silently ignored)
- Setup "Skip" no longer writes empty config (was causing infinite setup loop)
- Stop playback state protected from stale log line callbacks
- Shake animation now works (added `field.wantsLayer = true`)
- IPC socket cleanup on shutdown and MPV exit
- Pending IPC queries resolved on cleanup (prevents poll timer hang)

### Apple HIG Compliance
- All windows now respect standard macOS window layering (removed `.floating`)
- Status bar icons use template images and adapt to light/dark menu bar
- Replaced deprecated `NSApp.activate(ignoringOtherApps:)` with version-checked API
- Log viewer respects system appearance instead of forcing dark theme
- Added `LSApplicationCategoryType` to Info.plist

### Code Quality
- Extracted shared `ConfigParser` utility (eliminates duplication across 3 files)
- Thread safety: `processLogLine` dispatched to main thread
- `shim.js`: Progress reports now include `RepeatMode`, `PlaybackOrder`, `MediaSourceId`
- `shim.js`: Shutdown sends `SessionsStop` message before closing WebSocket

---

## v1.4.0 — Bug Fixes, Logo, UI Overhaul

### New Features
- **Custom app icon** — replaces generic SF Symbol with purpose-built `AppIcon.icns`
- **Dark mode icon variant** — About window dynamically switches based on system appearance
- **SVG logo set** — `logo.svg`, `icon.svg`, `icon-light.svg`, `icon-dark.svg`, `logo-banner.svg`
- **Pause state reporting** — subscribes to MPV's `pause` property, accurate `IsPaused` in progress reports
- **Help window overhaul** — keyboard shortcuts with ⌘ equivalents, SF Symbols per section, resizable

### Bug Fixes
- Fixed shake animation (was using `frame.origin` instead of `layer.position`)
- Fixed version in auth header (was hardcoded `1.3.0`)
- Fixed memory leak in `AppDelegate.statusHandler` closure
- Fixed `isReportingStop` flag not resetting on fresh play
- Removed dead `getSavedPosition()` function
- Fixed log window text view sizing

### UI Improvements
- All windows float above other apps
- About window: taller, Jellyfin link, theme-aware icon
- Menu key equivalents for all items

---

## v1.3.0 — Setup Wizard, Help Window, Bundled Node.js

### New Features
- **First-run setup wizard** — 5-step guided setup with "Test Connection" button
- **Help window** — Getting Started, Controls, Keyboard Shortcuts, Smart Resume, Troubleshooting
- **Bundled Node.js 22 LTS** — fully self-contained app (~175MB), no system Node required

### Improvements
- About window redesigned with fork attribution and clickable links
- Preferences auto-fills default values for empty fields
- `findNodePath()` checks bundle first, falls back to system Node
- README rewritten with separate macOS/Windows/Linux sections

---

## v1.2.1 — Native macOS App, Play-from-Beginning Fix, 8 Bug Fixes

### New: Native macOS Menu Bar App
- Status bar icon with color-coded states (disconnected/connected/playing)
- Now Playing display, Pause/Resume and Stop controls
- Log viewer with syntax coloring, auto-scroll, export
- Preferences window with "Test Connection" button
- Launch at Login toggle, macOS notifications
- Automatic process management with exponential backoff restart
- Build script compiles Swift, bundles into `.app` for `/Applications`

### Fixed: Play-from-Beginning Bug
- Server's `StartPositionTicks: 0` now correctly starts from beginning
- Previously, saved local position could override "play from beginning" request

### Bug Fixes
1. Removed duplicate `connectToMpvIpc()` function
2. Race condition fix with `playbackGeneration` counter
3. Graceful shutdown now saves position and reports stop
4. `eof-reached` handler now reports stop to server
5. Episode list sort no longer mutates API response
6. Fixed `currentIndex` bounds check
7. Platform-aware IPC socket path (Unix/Windows)
8. Fixed MPV keybind names (`NEXT`/`PREV`)

### Improvements
- Log messages translated from Spanish to English (enables macOS app parsing)
- Simplified MPV arguments (delegated to user's `mpv.conf`)
- Added `--force-media-title` for descriptive window titles
- Better token validation and error handling
