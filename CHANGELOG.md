# Changelog

All notable changes to Jellyfin MPV Play are documented here.

<!--
## vX.Y.Z — TEMPLATE (copy this for new releases)

### New Features
- **Feature name** — Description of what it does and how to use it

### Bug Fixes
- **Fixed bug name** — Description of what was broken and how it's fixed

### Internal
- **Change name** — Description of internal change (CI, docs, refactoring)

---

-->

## v1.9.2

### Bug Fixes
- **Fixed ConfigParser URL parsing** — Comment stripping no longer corrupts URLs containing `//` (e.g., `https://...`)
- **Fixed Preferences auto-focus** — Server URL field no longer auto-highlights when opening Preferences
- **Fixed Preferences layout** — Improved spacing, error label truncation, separator widths
- **Fixed Info.plist version** — Updated from 1.8.3 to 1.9.1 to match package.json
- **Fixed queue load counter** — Multi-item queues now auto-advance correctly
- **Fixed Windows headless detection** — `findstr` now uses regex matching for config parsing
- **Fixed Linux exit code capture** — Shim exit code is now properly reported
- **Fixed MPV stderr false alarms** — MPV informational output no longer triggers error notifications

### Internal
- **Pre-push hook** — Blocks direct pushes to main branch
- **Test coverage** — Added `disableSkipIntro` to config test assertions
- **Documentation** — Updated AGENTS.md with branch-before-commit workflow

---

## v1.9.1

### New Features
- **Disable skip intro option** — New config option `disableSkipIntro: true` completely disables the intro/outro skip feature (hides prompts, does not bind S key, does not fetch segments)

### Bug Fixes
- **Fixed audio loss on resume** — Added 500ms delay before seeking to saved position to allow MPV to initialize audio decoder
- **Fixed seek delay race condition** — Capture seek position in local variable before setTimeout to prevent stale reads
- **Fixed error propagation** — `playMedia()` now re-throws errors so callers' catch blocks execute properly
- **Fixed intro state reset** — Reset intro segments and flags when `disableSkipIntro` is enabled
- **Fixed error pattern matching** — Added STDERR: prefix check and emoji patterns for Swift error detection
- **Fixed bare mpvPath search** — Bare command names like `mpv` now correctly search PATH instead of treating as literal filename

### Internal
- **Code audit** — Fixed 5 additional bugs found in comprehensive audit (seek race, state reset, error propagation)
- **Documentation** — Updated AGENTS.md with new config option

---

## v1.9.0

### New Features
- **Auto-skip intros/outros** — Uses Jellyfin's MediaSegments API to detect intro/outro segments. Config option `autoSkipIntros: true` auto-skips after 3s; when false, shows "Press S to skip" OSD. Supports the S key and SkipIntro GeneralCommand from Jellyfin web UI.
- **Next-up notification** — Shows "Next up: SeriesName - SxEp - EpisodeName" at bottom-right 10 seconds before episode ends
- **Error OSD messages** — Connection/auth errors shown in MPV OSD with 30s rate limiting (top-right)
- **Better logging** — Structured `[timestamp] [component]` format with `verbose: true` config option for debug output
- **ForceKeepAlive handling** — Server can now specify required keep-alive interval via WebSocket

### Bug Fixes
- **Fixed session keep-alive** — Progress reports now sent every 10s to server, preventing 5-minute idle timeout disconnect
- **Fixed intro skip repeating** — Clear all segments after skipping to prevent re-triggering when keyframe lands inside segment
- **Fixed IPC socket connection** — Wait for socket file to exist before connecting, reducing noisy ENOENT errors
- **Fixed token file permissions** — Use chmodSync to fix permissions on existing token files
- **Fixed queue desync** — Sync queue position when using MPV native playlist navigation
- **Fixed OSD corruption** — Save/restore OSD settings when showing skip/error messages
- **Fixed status bar icon** — Use SymbolConfiguration for colored icons, fix log pattern matching with emojis
- **Fixed headless mode** — Write to both stdout and log file so macOS app receives status updates
- **Fixed file picker** — Remove empty allowedContentTypes that prevented browsing for MPV binary

### Internal
- **Automated tests** — Added test suite using Node.js built-in test module (`npm test`)
- **Structured logging** — All logs use `[component]` prefix (ws, mpv, queue, episode, auth, ipc, main, handler, report, position, segments)
- **macOS app parsing** — Updated NodeProcessManager to match new log format
- **Code audit** — Fixed 24+ bugs across shim.js, Swift files, and launch scripts
- **Documentation** — Updated AGENTS.md line numbers, config table, state variables, and log contracts

---

## v1.8.3

### New Features
- **Windows headless mode** — `launch.bat` now supports `--headless` flag and auto-detection from config.js (matches Linux behavior)

### Internal
- **Expanded troubleshooting** — 12 new entries in README covering common failure modes (MODULE_NOT_FOUND, ENOENT, ECONNREFUSED, 401, IPC failures)
- **macOS app architecture docs** — CONTRIBUTING.md now documents all 11 Swift source files, spawn flow, and processLogLine
- **.editorconfig** — Consistent formatting across contributors (4-space JS/Swift, 2-space YAML, CRLF for .bat)
- **AGENTS.md cleanup** — Removed stale audit section, fixed Info.plist description

---

## v1.8.2

### Bug Fixes
- **Fixed CI release workflow** — `sync-output/` directory now created before writing files; release notes, Info.plist, and SECURITY.md sync correctly
- **Fixed CI release deletion** — workflow no longer deletes existing releases before recreating; assets are no longer permanently lost on re-runs
- **Fixed Info.plist version** — was stuck at 1.7.6; now matches package.json version
- **Fixed SECURITY.md version table** — now shows 1.8.x as supported, 1.7.x as no longer supported
- **Fixed pendingStartSeconds not reset** — stale seek position no longer persists when playing from beginning via loadNewQueue
- **Fixed .desktop Exec line** — now searches common bundle locations (`~/JellyfinMPVPlay-Linux-*`, `/opt/jellyfin-mpv-play`) when copied separately
- **Fixed AGENTS.md** — release workflow description now correctly says CHANGELOG.md (not PRs)
- **Fixed CONTRIBUTING.md** — line count updated from ~1250 to ~1620

---

## v1.8.1

### Bug Fixes
- **Fixed Linux headless mode** — `.desktop` file no longer opens a terminal window; `launch.sh` auto-detects headless config and either runs silently or opens a terminal as needed
- **Fixed release notes format** — CI now uses CHANGELOG.md directly instead of auto-generating from PRs

---

## v1.8.0

### New Features
- **Full queue system** — Native MPV playlist; Play Next / Play Last from Jellyfin UI; next/prev navigation through queued items
- **Cross-season auto-play** — Automatically queries Jellyfin's NextUp API when a season ends, seamlessly continuing to the next season
- **Display messages** — Jellyfin notifications appear as OSD overlays in MPV with pause support; "Message from Jellyfin Server" title identifies the source
- **Subtitle sync** — Subtitle changes in MPV (via `j` key or menu) are reported back to Jellyfin's session tracking
- **Fullscreen mode** — `fullscreen: true` in config.js starts MPV in fullscreen
- **Auto-close** — `autoClose: true` in config.js shuts down the app when playback queue is exhausted
- **Custom MPV flags** — `mpvFlags: ['--hwdec=auto', ...]` in config.js passes extra arguments to MPV
- **Headless mode** — `headless: true` in config.js suppresses console output, logs to `data/shim.log`; no terminal window required
- **Linux systemd service** — `./launch.sh --install-service` installs a user service for background operation with auto-restart; `--uninstall-service` to remove
- **PlayNow reuses MPV** — New play commands reuse the existing MPV instance via `playlist-clear` instead of killing and restarting; faster transitions, no window flicker
- **Diagnostic logging** — Queue position and item ID logged on every episode transition for easier debugging

### Bug Fixes
- **Fixed episode selection** — Plays exactly the episode clicked in Jellyfin, not the first unwatched; removed the NextUp/first-unwatched search
- **Fixed DisplayMessage OSD** — Uses `osd-align-y: center` instead of invalid `middle`; OSD positioned center-screen
- **Fixed progress report 400 errors** — Removed invalid `SubtitleStreamIndex` from progress reports; start reports still include the correct value
- **Fixed stop reports not sent** — Removed `isReportingStop` flag from `killMpv()`; added stop report in `playMedia()` before killing
- **Fixed `playPreviousEpisode` desync** — Uses `insert-at-index` + `playlist-prev` instead of `replace` to keep queue and MPV playlist in sync
- **Fixed PlayNext/PlayLast position** — Uses `insert-at-index` instead of `append` so items land at the correct position in MPV's playlist
- **Fixed `isPlayingNext` stuck** — 10-second timeout fallback in poll timer; IPC liveness checks before sending commands
- **Fixed DisplayMessage concurrent messages** — Original OSD properties captured once and reused; previous timeout cancelled before setting new one
- **Fixed `loadNewQueue` false auto-advance** — Sets `isNewQueueLoad` flag to prevent `file-loaded` handler from treating it as auto-advance
- **Fixed subtitle flag stuck** — 5-second timeout on `isSettingSubtitleFromJellyfin` flag; reset on MPV close
- **Fixed `queryProperty` hang** — 5-second timeout on all property queries; timers properly cleared on resolution
- **Fixed timer leak** — All `pendingQueries` bulk-clear paths now clear individual timers before resolving
- **Fixed stale position saves** — Skip functions update `currentItemId` and `queuePosition` immediately before sending MPV commands
- **Fixed `handleMessage` crash** — Added `.catch()` to async handler; unhandled rejections no longer kill the process
- **Fixed `.desktop` Exec lines** — Fixed broken `$0` reference in `bash -c` using `%k` (desktop file path)
- **Fixed headless terminal survival** — Uses `nohup` and `disown` so the process survives terminal closure
- **Fixed NextUp tight retry loop** — `isPlayingNext` no longer reset on NextUp failure; 10-second timeout handles recovery

---

## v1.7.6

### Bug Fixes
- Fixed playback stop not reported to Jellyfin when Stop command comes from web UI
- Fixed playback stop not reported when MPV IPC connection fails

---

## v1.7.5

> **Important:** This release fixes a critical bug where **playback controls did not appear in the Jellyfin web UI**. This bug was introduced in v1.7.0 during API format changes — the playback reports were incorrectly wrapped in a `playbackStartInfo`/`playbackProgressInfo` key, causing the server to reject session registration. If controls stopped working after updating from v1.6.0 or earlier, this update fixes that.

### Bug Fixes
- **Fixed playback controls not appearing in Jellyfin web UI** — removed incorrect `playbackStartInfo`/`playbackProgressInfo` wrapper from API requests; added valid `PlaybackOrder: 'Default'` enum value
- Fixed duplicate progress reporting causing 400 errors from Jellyfin server
- Fixed help window content clipped by hardcoded container height
- Fixed help window opening scrolled to bottom
- Fixed preferences window label/field alignment
- Fixed About window link buttons showing focus ring
- Fixed About window icon not adapting to dark mode

### Improvements
- About window now uses dark/light icon variant based on system appearance
- Help window link buttons no longer show focus ring
- Logs saved to ~/Library/Application Support/JellyfinMpvPlay/data/ with timestamps
- Icon SVGs bundled in app resources

---

## v1.7.4

### Bug Fixes
- Fixed emoji encoding corruption in log output (was garbled after v1.7.3 encoding change)

---

## v1.7.3

### Bug Fixes
- Fixed shutdown exiting before HTTP stop report completes (now waits for response)
- Fixed WebSocket URL construction (regex prevents hostname corruption)
- Fixed startProgressReporting not reporting progress to server (was only saving locally)
- Fixed StatusBarController icon colors not rendering (isTemplate was blocking tint)
- Fixed login item menu state not refreshing from external changes
- Fixed LogWindowController lineCount drift (uses actual count instead of tracking variable)
- Fixed NodeProcessManager stop() re-entry scheduling multiple SIGKILL timers
- Fixed stdout/stderr encoding dropping partial byte sequences (UTF-8 → ISO Latin 1)
- Fixed launch.sh not forwarding signals to child process
- Fixed launch.bat path separator issues (strips trailing backslash)

### Improvements
- Extracted shared ConfigParser.testConnection() (eliminated ~80 lines of duplication)
- Extracted StatusBarController.showAndActivate() helper
- Extracted NodeProcessManager.resetPlaybackState() method
- build.sh now verifies SHA256 checksum for Node.js download

---

## v1.7.2

### Bug Fixes
- Fixed random `deviceId` not persisted to disk — was creating zombie sessions in Jellyfin on every restart
- Fixed `pendingQueries` not resolved when MPV closes — could hang the poll timer forever
- Fixed stderr handler in NodeProcessManager not buffering partial lines — corrupted log parsing
- Fixed `.desktop` file Exec line — `dirname "$0"` returned `.` instead of script directory

---

## v1.7.1

### Features
- CI auto-generates release notes from merged PR titles (categorized by feat/fix/docs/ci)
- `package.json` is now the single source of truth for version; `shim.js` reads it at runtime

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
