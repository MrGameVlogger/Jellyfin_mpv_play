# AGENTS.md

## What this is

Node.js shim (`shim.js`, ~1895 lines) that connects to Jellyfin via WebSocket, receives play commands, and controls MPV via Unix socket IPC. Optional macOS menubar app (`macapp/`) spawns the shim and parses its stdout for UI state. Linux and Windows users run `shim.js` directly via platform-specific launcher scripts.

## Commands

```bash
npm install && npm start     # run shim directly
cd macapp && ./build.sh      # compile Swift, bundle Node.js 22, deploy to /Applications
cd macapp && CI=true ./build.sh  # build without deploying to /Applications
```

No lint or typecheck steps exist. Tests run via `npm test`.

## Key files

| File | Role |
|------|------|
| `shim.js` | Entire Node.js application — all Jellyfin API, MPV control, queue, OSD, subtitle sync, headless logic |
| `config.js` | User config with credentials (gitignored) |
| `config.example.js` | Template for `config.js` |
| `package.json` | Version source of truth (single source — `clientVersion` reads from here at runtime) |
| `data/` | Runtime state: auth tokens, playback positions, device ID (gitignored) |
| `data/shim.log` | Headless mode log output (created when `headless: true`) |
| `macapp/Sources/*.swift` | Native macOS menubar app (11 files) |
| `macapp/build.sh` | Compile Swift, bundle Node.js 22, deploy to `/Applications` |
| `macapp/Info.plist` | App version — auto-synced by CI from `package.json`; don't edit manually |
| `linux/launch.sh` | Smart launcher: detects headless config, manages systemd service |
| `linux/jellyfin-mpv-play.desktop` | Desktop entry with actions (Launch, Headless, Quit) |
| `linux/jellyfin-mpv-play.service` | Systemd user service for headless mode |
| `windows/launch.bat` | Windows launcher with `--headless` flag support |
| `.github/workflows/build.yml` | CI: tag-triggered, builds 3 platforms, creates GitHub Release |
| `.editorconfig` | 4-space indent for JS/Swift, 2-space for YAML, CRLF for .bat |

## Architecture

- **IPC**: Unix socket at `/tmp/mpv-ipc.sock` (configurable via `ipcSocketPath` in config.js). Windows uses named pipe `\\.\pipe\mpv-ipc`.
- **MPV flags**: `--idle=yes --keep-open=yes --save-position-on-quit=no` (plus optional `--fullscreen` and user `mpvFlags`)
- **Queue system**: `playQueue` array tracks all item IDs; `queuePosition` tracks current index. Items loaded into MPV's native playlist via `loadfile append`. MPV auto-advances through the playlist.
- **Episode transitions**: MPV's native playlist handles auto-advance. The `file-loaded` event detects auto-advance and updates state. `loadNewQueue()` reuses the existing MPV for PlayNow commands. `playMedia()` spawns a fresh MPV (used for initial play and when IPC is down).
- **Cross-season**: When queue is exhausted, queries `GET /Shows/NextUp` for next season's episodes.
- **PlayNext/PlayLast**: Inserts items into both the queue and MPV's playlist at the correct position using `insert-at-index`.
- **Auto-play**: Poll timer queries `time-pos` and `duration` via IPC every 1s. For the last item in the playlist, triggers `playNextEpisode()` when `pos >= dur - 1`. MPV handles all other transitions natively.
- **DisplayMessage**: Shows OSD overlay in MPV, pauses playback for 10s, then resumes. Original pause state tracked globally (`displayMessageOriginalPause`) to handle concurrent messages.
- **Subtitle sync**: Observes `sid` property. Changes from MPV are reported to Jellyfin via progress API. Changes from Jellyfin are flagged (`isSettingSubtitleFromJellyfin`) to prevent echo. 5s timeout clears the flag if no echo detected.
- **Headless mode**: `headless: true` in config.js redirects console output to `data/shim.log` and suppresses stdout/stderr. On Linux, `launch.sh` auto-detects headless config and re-opens a terminal if needed.
- **Playable types**: `Episode`, `Movie`, `Video`, `MusicVideo`, `Audio` — anything else is skipped.
- **Watched threshold**: Item marked watched at 90% of runtime.
- **Reconnection**: Exponential backoff (5s → 10s → 20s → 30s cap) on WebSocket disconnect.

## Config options

All options go in `config.js` (copy from `config.example.js`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | string | **required** | Jellyfin server URL (e.g. `http://192.168.1.10:8096`) |
| `username` | string | **required** | Jellyfin username |
| `password` | string | **required** | Jellyfin password |
| `mpvPath` | string | `"mpv"` | Path to MPV binary |
| `deviceName` | string | `"Jellyfin MPV Play"` | Display name in Jellyfin session |
| `deviceId` | string | auto-generated | Unique device ID (must differ from `deviceName` per Jellyfin) |
| `ipcSocketPath` | string | `/tmp/mpv-ipc.sock` | Unix socket path (Windows: `\\.\pipe\mpv-ipc`) |
| `fullscreen` | boolean | `false` | Start MPV in fullscreen mode |
| `autoClose` | boolean | `false` | Close shim when playback ends |
| `mpvFlags` | array | `[]` | Additional MPV arguments (e.g. `["--hwdec=auto"]`) |
| `headless` | boolean | `false` | Redirect logs to `data/shim.log`, suppress stdout/stderr |
| `autoSkipIntros` | boolean | `false` | Auto-skip intros/outros after 3s (or show "Press S to skip" OSD) |
| `disableSkipIntro` | boolean | `false` | Completely disable intro/outro skip feature (hides prompts, no S key) |
| `verbose` | boolean | `false` | Show debug-level logs with timestamps and component names |

`config.js` is gitignored. Missing file → `MODULE_NOT_FOUND` on start.

## Key functions map

All functions live in `shim.js`. There are no classes — the entire app is procedural with module-level state.

### Lifecycle & auth

| Function | Line | Description |
|----------|------|-------------|
| `main()` | 1865 | Entry point: creates `data/`, loads token or authenticates, connects WebSocket |
| `authenticateUser()` | 176 | POSTs to `/Users/AuthenticateByName`, saves token |
| `loadToken()` | 139 | Reads JWT from `data/jellyfin_token_{deviceId}.json` |
| `saveToken(authResponse)` | 164 | Persists JWT to disk |
| `getAuthHeaders()` | 235 | Returns `X-Emby-Token` + `X-Emby-Authorization` headers |
| `generateOrLoadDeviceId()` | 123 | Reads or generates device ID from `data/.device-id` |

### WebSocket & Jellyfin communication

| Function | Line | Description |
|----------|------|-------------|
| `connectWebSocket()` | 242 | Establishes WS connection, sets up message handler, starts keep-alive |
| `scheduleReconnect()` | 339 | Exponential backoff reconnection (5s → 10s → 20s → 30s cap) |
| `handleMessage(msg)` | 430 | Main WS message dispatcher — handles Play, Playstate, GeneralCommand |
| `reportCapabilities()` | 393 | Registers session capabilities with Jellyfin |
| `getEpisodeInfo(itemId, silent)` | 659 | Fetches item metadata + season episode list |
| `queryNextUp(seriesId)` | 1635 | Queries `/Shows/NextUp` for next unwatched episode |

### MPV control

| Function | Line | Description |
|----------|------|-------------|
| `playMedia(itemId, startTicks)` | 917 | Spawns fresh MPV process with IPC socket |
| `loadNewQueue(itemId, startTicks)` | 825 | Loads new queue into running MPV (clears playlist, reloads) |
| `connectToMpvIpc(gen)` | 1059 | Connects to MPV Unix socket, observes properties, binds keys |
| `killMpv()` | 1220 | Kills MPV, cleans up IPC, resolves pending queries |
| `sendMpvCommand(command, args)` | 1260 | Sends JSON command to MPV via IPC |
| `queryProperty(property, timeoutMs)` | 1279 | Queries MPV property (returns Promise) |
| `startProgressPoll()` | 1302 | 1s interval: polls `time-pos`/`duration`, triggers next episode near end |
| `stopProgressPoll()` | 1346 | Clears progress poll timer |
| `handleMpvEvent(event)` | 1353 | Processes MPV IPC events (file-loaded, property changes, keybinds) |

### Queue & episode transitions

| Function | Line | Description |
|----------|------|-------------|
| `playNextEpisode()` | 1528 | Advances to next episode (queue → season → NextUp → end) |
| `playPreviousEpisode()` | 1649 | Goes to previous episode (restart if >30s, queue, or season prev) |

### Auto-skip & OSD

| Function | Line | Description |
|----------|------|-------------|
| `getIntroSegments(itemId)` | 713 | Fetches intro/outro segments from Jellyfin MediaSegments API |
| `skipIntro()` | 743 | Seeks to end of current intro/outro segment |
| `checkIntroSegment(positionTicks)` | 760 | Checks if position is inside an intro/outro segment |
| `showSkipOsd(text)` | 786 | Shows bottom-right OSD (skip prompts, next-up notification) |
| `showErrorOsd(text)` | 804 | Shows top-right OSD (connection/auth errors, rate limited) |

### Playback reporting

| Function | Line | Description |
|----------|------|-------------|
| `reportPlaybackStart(itemId, positionTicks)` | 1708 | Reports start to `/Sessions/Playing` |
| `reportPlaybackProgress(itemId, positionTicks)` | 1761 | Reports progress to `/Sessions/Playing/Progress` |
| `reportPlaybackStop(itemId, positionTicks)` | 1784 | Reports stop to `/Sessions/Playing/Stopped` |
| `startProgressReporting(itemId)` | 1740 | 10s interval: saves local playback positions |
| `markItemAsWatched(itemId)` | 1201 | Marks item as played, clears local position |
| `savePlaybackPosition(itemId, positionTicks)` | 221 | Persists position to `data/playback_positions_{deviceId}.json` |
| `loadPlaybackPositions()` | 209 | Reads saved positions from disk |

### Shutdown

| Function | Line | Description |
|----------|------|-------------|
| `shutdown(signal)` | 1813 | Graceful exit: saves positions, kills MPV, sends SessionsStop, closes WS |

## State management

All state is module-level variables. No state machine or stores — just mutable globals with flags to coordinate async operations.

### Core playback state

| Variable | Type | Purpose |
|----------|------|---------|
| `currentItemId` | string | ID of currently playing item |
| `currentPositionSeconds` | number | Current playback position in seconds |
| `currentDuration` | number | Duration of current item |
| `currentEpisodeInfo` | object | Episode metadata (series name, season/episode numbers, next/prev episodes) |
| `playSessionId` | string | Unique session ID for Jellyfin progress reports |

### Queue state

| Variable | Type | Purpose |
|----------|------|---------|
| `playQueue` | array | Ordered list of item IDs |
| `queuePosition` | number | Index into `playQueue` (-1 when not playing) |
| `previousItemId` | string | ID of item before current (for back-navigation) |

### MPV / IPC state

| Variable | Type | Purpose |
|----------|------|---------|
| `mpvProcess` | Process | Spawned MPV child process |
| `ipcClient` | Socket | Unix socket connection to MPV IPC |
| `ipcCommandId` | number | Auto-incrementing request ID for IPC commands |
| `isMpvPaused` | boolean | Current pause state |
| `isMuted` | boolean | Current mute state |
| `volumeLevel` | number | Current volume (0-100) |

### Coordination flags

| Variable | Type | Purpose |
|----------|------|---------|
| `isPlayingNext` | boolean | Prevents double-triggering episode transitions (30s timeout fallback) |
| `isPlayingNextTimestamp` | number | Timestamp when `isPlayingNext` was set (for timeout) |
| `isManualSkip` | boolean | True when user/NextTrack triggered skip (vs auto-advance) |
| `isSeeking` | boolean | True during seek operations (prevents progress reports) |
| `isNewQueueLoad` | boolean | True during `loadNewQueue()` to suppress file-loaded handlers |
| `isReportingStop` | boolean | Prevents duplicate stop reports |
| `isSettingSubtitleFromJellyfin` | boolean | Echo prevention: true when subtitle change came from Jellyfin (5s timeout) |
| `pendingQueries` | Map | Tracks outstanding IPC queries (must resolve all before cleanup) |
| `markedWatched` | Set | Prevents duplicate "mark as watched" API calls (cleared on new file) |

### DisplayMessage state

| Variable | Type | Purpose |
|----------|------|---------|
| `displayMessageTimeout` | Timer | Active OSD timeout (10s) |
| `displayMessageOriginalPause` | boolean | Pause state before message (restored after) |
| `displayMessageOriginalFontSize` | number | Font size before message (restored after) |
| `displayMessageOriginalAlignX` | string | Alignment X before message (restored after) |
| `displayMessageOriginalAlignY` | string | Alignment Y before message (restored after) |

### Auto-skip & next-up state

| Variable | Type | Purpose |
|----------|------|---------|
| `introSegments` | array | Cached intro/outro segments from MediaSegments API |
| `skipIntroTimeout` | Timer | Auto-skip delay timeout (3s) |
| `isInIntroSegment` | boolean | Currently inside an intro/outro segment |
| `lastErrorOsdTime` | number | Timestamp of last error OSD (30s rate limiting) |
| `nextUpShown` | boolean | Prevents duplicate next-up notifications per episode |

### Auth / connection state

| Variable | Type | Purpose |
|----------|------|---------|
| `accessToken` | string | Jellyfin JWT token |
| `userId` | string | Jellyfin user ID |
| `ws` | WebSocket | Connection to Jellyfin server |
| `reconnectAttempts` | number | Current backoff level (resets on successful connect) |
| `isReconnecting` | boolean | True during reconnection attempt |
| `reconnectInterval` | Timer | Active reconnect timer |
| `keepAliveInterval` | Timer | WebSocket keep-alive interval |

### Pending playback state (between command and MPV ready)

| Variable | Type | Purpose |
|----------|------|---------|
| `pendingStreamUrl` | string | URL to load when IPC connects |
| `pendingStartSeconds` | number | Start position for pending stream |
| `pendingTitle` | string | Title to display for pending stream |
| `pendingAudioStreamIndex` | number | Audio stream to set after load |
| `pendingSubtitleStreamIndex` | number | Subtitle stream to set after load |

## Modification patterns

### Adding a new config option

1. Add the option to `config.example.js` with a default value and comment
2. Add it to the `CONFIG` object in `shim.js` (line 12-29): `optionName: userConfig.optionName || defaultValue`
3. Use `CONFIG.optionName` throughout the code
4. Update AGENTS.md config table, README.md, CONTRIBUTING.md if relevant

### Adding a new PlaystateCommand

1. Add the `case` to `handleMessage()` under the `"Playstate"` switch (line 522)
2. Implement the actual MPV command via `sendMpvCommand()`
3. If it requires new state, add a module-level variable with a clear name
4. Update `reportCapabilities()` to include the new command in `SupportedCommands`
5. Update AGENTS.md "Jellyfin API compliance" section

### Adding a new GeneralCommand

1. Add the `case` to `handleMessage()` under the `"GeneralCommand"` switch (line 558)
2. Use the exact `GeneralCommandType` enum name from Jellyfin source — wrong names cause 400 errors
3. If it requires new MPV IPC, use `sendMpvCommand()` or `queryProperty()`
4. Update `reportCapabilities()` to include the new command
5. Update AGENTS.md "Jellyfin API compliance" section

### Adding a new log line (macapp interaction)

**⚠️ CRITICAL**: The macOS app parses stdout line-by-line. Every log line pattern must be:
1. Added to this document's "Log line contracts" table
2. Checked against `NodeProcessManager.swift:processLogLine` to ensure Swift code handles it
3. Never changed after release (would silently break the macOS app)

Use patterns like:
- `console.log('▶️ Starting next episode: <title>')` — parsed by Swift
- `console.log('ℹ️ ...')` — informational, not parsed
- `console.error('⚠️ ...')` — error, parsed as error notification

### Adding a new IPC property observer

1. Add `observe_property` command in `connectToMpvIpc()` (around line 940)
2. Add a `case` in `handleMpvEvent()` under `property-change` (line 1431)
3. Update the corresponding state variable
4. If the change should be reported to Jellyfin, include it in `reportPlaybackProgress()` fields

### Modifying the queue system

- `playQueue` is the source of truth for item order
- `queuePosition` tracks where we are
- MPV's native playlist must stay in sync with `playQueue`
- `loadNewQueue()` clears and rebuilds both
- `playNextEpisode()` / `playPreviousEpisode()` modify both
- `file-loaded` event updates `queuePosition` on auto-advance

## Platform-specific behavior

### macOS (`macapp/`)

- `build.sh` compiles Swift, bundles Node.js 22.23.1 (arm64 or x64, not universal), deploys to `/Applications`
- `setupApplicationSupport()` always overwrites `shim.js` from the bundle on launch
- `NodeProcessManager.swift` spawns the shim, parses stdout via `processLogLine` on main thread
- `StatusBarController.swift` manages the menu bar icon (template images for light/dark mode)
- All windows use standard layering (no `.floating`)
- `ConfigParser.swift` is the shared utility for config file parsing and Application Support paths
- `Info.plist` version is auto-synced by CI — never edit manually

### Linux (`linux/`)

- `launch.sh` detects headless config via `findstr`-equivalent (grep + sed), re-opens terminal if needed
- `--install-service` / `--uninstall-service` manages systemd user service
- `jellyfin-mpv-play.desktop` has Terminal=false (launch.sh handles terminal detection)
- `jellyfin-mpv-play.service` runs shim as systemd user service (Type=simple, Restart=on-failure)
- MPV args are minimal — user's `~/.config/mpv/mpv.conf` handles vo, hwdec, ao, cache, etc.

### Windows (`windows/`)

- `launch.bat` supports `--headless` flag (passed directly) and auto-detection from config.js via `findstr`
- IPC socket path defaults to named pipe `\\.\pipe\mpv-ipc`
- Line endings should be CRLF
- Path quoting matters for special characters

## Error handling patterns

### IPC connection failure

`connectToMpvIpc()` retries up to 10 times with 500ms delay (via `attemptConnection()`). If all retries fail, `pendingStreamUrl` is set and `playMedia()` will spawn a fresh MPV when the next command arrives.

### WebSocket disconnect

`scheduleReconnect()` implements exponential backoff: 5s → 10s → 20s → 30s (cap). Resets `reconnectAttempts` on successful connect. `isReconnecting` prevents duplicate reconnection attempts.

### MPV process crash

`killMpv()` cleans up IPC client, resolves all `pendingQueries` with null, clears intervals. If `autoClose` is enabled, `shutdown()` is called.

### Pending queries timeout

`queryProperty()` has a default 5s timeout. If a query times out, it resolves with null and is removed from `pendingQueries`. `killMpv()` also resolves all pending queries on cleanup.

### Episode transition guard

`isPlayingNext` flag prevents double-triggering. Has a 10s timeout fallback: if `isPlayingNextTimestamp` is older than 10s, the flag is cleared and the transition proceeds.

### Duplicate API calls

- `markedWatched` Set prevents duplicate "mark as watched" calls (cleared on each new file load)
- `isReportingStop` flag prevents duplicate stop reports
- `isSettingSubtitleFromJellyfin` flag with 5s timeout prevents subtitle echo

### Uncaught exceptions

Both `uncaughtException` and `unhandledRejection` handlers call `shutdown()` to ensure clean exit.

## Testing approach

**Automated tests** (`npm test`):

- `tests/log-contracts.test.js` — verifies macOS app contract patterns exist in shim.js, error patterns present, log function signature, no conflicts between new and existing log lines
- `tests/config.test.js` — verifies config.example.js is valid JavaScript, all required options present, CONFIG object has all expected properties, all options documented

**Manual testing** with a real Jellyfin server:

1. Starting the shim (`npm start`) and connecting from Jellyfin web UI
2. Testing Play/PlayNext/PlayLast queue behavior
3. Testing Playstate commands (Pause, Seek, Next/Prev track)
4. Testing DisplayMessage from Jellyfin dashboard
5. Testing subtitle switching from both sides
6. Testing headless mode (`headless: true` in config, check `data/shim.log`)
7. Testing auto-close (`autoClose: true` in config)
8. Testing fullscreen (`fullscreen: true` in config)
9. On macOS: building the app and testing from the menubar
10. On Linux: testing `launch.sh --install-service` and systemd service
11. On Windows: testing `launch.bat --headless`

## Security considerations

- `config.js` is gitignored — contains server credentials
- `data/jellyfin_token_{deviceId}.json` contains JWT tokens — never commit
- `data/.device-id` is machine-specific — never commit
- API tokens are logged in `getAuthHeaders()` debug output — be careful with logging
- `shim.js` reads `package.json` at runtime for version — never hardcode version strings
- The shim connects to Jellyfin over HTTP by default — HTTPS requires correct `serverUrl`
- `mpvFlags` user config is passed directly to MPV as command-line arguments — no sanitization (intentional, user controls their own machine)

## Log line contracts

`NodeProcessManager.swift:processLogLine` parses stdout from shim.js. It runs on the **main thread** (dispatched from background readability handler). Changing these patterns breaks the macOS app silently:

| Pattern in stdout | What Swift code does |
|---|---|
| `WebSocket connection established` | Status → connected, notification |
| `Episode detected: <title>` | Sets now-playing title, status → playing |
| `Starting next episode: <title>` | Updates now-playing title |
| `Starting previous episode: <title>` | Updates now-playing title |
| `File loaded by MPV` | Status → playing (fallback) |
| `Playback paused` | Pause state on |
| `Playback resumed` | Pause state off |
| `No more episodes` | Clears now-playing, status → connected |
| `Closing application` / `MPV closed` / `Process terminated` | Clears now-playing, status → connected |
| Lines containing `ERROR` / `❌` / `FATAL` | Error notification |

stderr is also routed through `processLogLine` (prefixed with `STDERR:`), so `❌` in stderr triggers error notifications.

Title format for `Episode detected`: `SeriesName - SxEp - EpisodeName` (parsed by `extractTitleFromEpisode()`). Next/prev episode logs use the same format.

## Gotchas

- `config.js` is gitignored. Missing file → `MODULE_NOT_FOUND` on start.
- `deviceId` must differ from `deviceName` per Jellyfin's device registration.
- `setupApplicationSupport()` always overwrites `shim.js` from the bundle on launch. This ensures rebuilds take effect.
- The bundled Node.js is arm64 or x64 depending on build machine — not universal.
- `processLogLine` mutates `isPlaying`, `isPaused`, `nowPlaying` — always runs on main thread (dispatched from GCD background thread in readability handler).
- `isStoppingPlayback` flag prevents stale log lines from corrupting state after user clicks Stop. Cleared when MPV closes.
- `pendingQueries` Map must resolve all promises before clearing — otherwise poll timer hangs forever.
- `isPlayingNext` flag prevents double-triggering of episode transitions. Has a 10s timeout fallback in case `loadfile` silently fails.
- `markedWatched` Set prevents duplicate "mark as watched" API calls. Cleared on each new file load.
- MPV args are minimal. User's `~/.config/mpv/mpv.conf` handles vo, hwdec, ao, cache, etc.
- `gh` CLI defaults to upstream repo (JohnGlaus), not the fork. Run `gh repo set-default MrGameVlogger/Jellyfin_mpv_play` or use `-R MrGameVlogger/Jellyfin_mpv_play` with release commands.
- All windows use standard layering (no `.floating`). Status bar icons are template images — they adapt to light/dark mode automatically.
- `ConfigParser.swift` is the shared utility for config file parsing and Application Support paths. Used by AppDelegate, NodeProcessManager, and PreferencesWindowController.

## Jellyfin API compliance

The shim handles three WebSocket message types: `Play`, `Playstate`, `GeneralCommand`.

**PlaystateCommand** — all 9 handled: Stop, Pause, Unpause, PlayPause, NextTrack, PreviousTrack, Seek, Rewind, FastForward.

**GeneralCommand** — SetAudioStreamIndex, SetSubtitleStreamIndex, SetVolume, VolumeUp/Down, Mute/Unmute/ToggleMute, SetRepeatMode, SetPlaybackOrder, DisplayMessage, PlayNext, ToggleFullscreen.

**PlayRequest fields used**: ItemIds, StartPositionTicks, PlayCommand (PlayNow/PlayShuffle), StartIndex, AudioStreamIndex, SubtitleStreamIndex.

**Progress reports include**: ItemId, PositionTicks, IsPaused, IsMuted, VolumeLevel, PlayMethod, PlaySessionId, CanSeek, RepeatMode, PlaybackOrder, MediaSourceId.

**SupportedCommands** must use exact `GeneralCommandType` enum names from Jellyfin source (`MediaBrowser.Model/Session/GeneralCommandType.cs`). Wrong names cause 400 errors.

**Shutdown**: Sends `SessionsStop` message before closing WebSocket to prevent zombie sessions.

## Historical context

This project started as a simple MPV shim for Jellyfin and grew significantly:

- **v1.0-v1.7**: Basic shim with manual episode navigation, no queue, no OSD, no headless mode
- **v1.8.0**: Major feature release — queue system, DisplayMessage OSD, subtitle sync, headless mode (Linux systemd), custom MPV flags, fullscreen, auto-close. All features built from scratch in `shim.js`.
- **v1.8.1**: Pre-release (no assets — CI failed due to missing sync-output directory)
- **v1.8.2**: Bug sweep — CI fix, Info.plist version stuck at 1.7.6, security audit, documentation overhaul
- **v1.8.3**: Documentation polish — README troubleshooting expanded, CONTRIBUTING architecture docs, AGENTS.md audit checklist, .editorconfig, signed commits
- **v1.9.0**: Feature release — auto-skip intros/outros, error OSD messages, next-up notification, better logging with structured format, automated tests, comprehensive bug audit (24+ fixes)

Key architectural decisions:
- **No classes, no modules** — entire app is one procedural file with module-level state. This was intentional for simplicity and easy deployment (single file).
- **MPV native playlist** — leveraging MPV's built-in playlist rather than manual loadfile calls for each transition.
- **Log line contracts** — stdout parsing by macOS app created a hard API surface that must never change.
- **`package.json` as version source** — CI syncs versions to Info.plist and SECURITY.md automatically.

## Release workflow

1. Increment version in `package.json` (use `npm version X.Y.Z`)
2. Commit, push to a branch, and merge via PR
3. Create and push a version tag: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
4. The CI workflow (`.github/workflows/build.yml`) automatically:
   - Reads version from `package.json`
   - Generates release notes from CHANGELOG.md entries
   - Builds macOS `.app` bundle (runs on `macos-latest`)
   - Builds Linux bundle with bundled Node.js (runs on `ubuntu-latest`)
   - Builds Windows bundle with bundled Node.js (runs on `windows-latest`)
   - Creates a GitHub Release with auto-generated notes and all 3 platform artifacts

`package.json` is the single source of truth for version. `shim.js` reads it at runtime. `Info.plist` and `SECURITY.md` are auto-synced by CI into release artifacts (not committed back to repo). Update `CHANGELOG.md` before tagging a release.

The macOS `.app` can also be built locally: `cd macapp && ./build.sh` (deploys to `/Applications`). Use `CI=true` to skip the deploy step.

**Important**: `gh` may default to the upstream repo (JohnGlaus). Always use `-R MrGameVlogger/Jellyfin_mpv_play` with release commands, or run `gh repo set-default MrGameVlogger/Jellyfin_mpv_play` once.

**⚠️ Never delete releases to reorder them** — GitHub release assets (zip files, etc.) are permanently deleted when a release is deleted. If you need to reorder releases, use the GitHub API to update `published_at` dates instead. Always download assets before deleting a release.

## GitHub workflow

- **Branch protection**: `main` requires PRs (force pushes and deletions blocked)
- **Merge strategy**: Squash merge (`--squash`) — one commit per PR
- **PR workflow**: Create branch → commit → push → `gh pr create` → `gh pr merge --squash` → delete branch
- **⚠️ NEVER push directly to `main`** — always create a branch and open a PR, even for docs or small fixes. The branch protection allows maintainer bypass but this should not be used.
- **Dependabot**: Weekly npm dependency updates on Mondays
- **Auto-labeler**: PRs auto-labeled by file paths (macos, shim, documentation, ci, dependencies, images, linux, windows)
- **Signed commits and tags**: SSH signing configured in global git config — all commits and tags should be signed

## Running a comprehensive audit

When asked to audit the entire project, run ALL of the following checks. Fix everything through PRs, never push directly to main.

### 1. Code audit

Read EVERY file completely. Do not skip or summarize. Check for:

**shim.js:**
- Race conditions (state mutated across async boundaries)
- Error handling gaps (silent catches, missing error paths)
- Dead code, unused variables, unreachable branches
- Platform issues (Windows paths, IPC socket cleanup)
- Memory leaks (event listeners, intervals, sets never cleared)
- Log message consistency (these are parsed by the macOS app — see "Log line contracts" above)
- Security (API keys in logs, token file permissions)
- Version consistency (`clientVersion` vs `package.json`)

**macapp/Sources/*.swift (all 11 files):**
- NSObject inheritance for classes using @objc selectors
- Thread safety (properties mutated from multiple threads)
- Memory leaks (retain cycles in closures, missing [weak self])
- Missing error handling
- Deprecated APIs vs minimum macOS version
- Duplicate code across files (shared utilities)
- Logic bugs (state desync, unreachable code)

**macapp/build.sh:**
- curl flags (-f for fail on HTTP errors)
- Architecture handling
- Missing error messages

**linux/launch.sh:**
- Symlink resolution
- Error handling (set -e interactions)
- Exit codes on signals
- File existence checks

**windows/launch.bat:**
- Path quoting (special characters)
- Error handling
- Line endings (should be CRLF)

**linux/jellyfin-mpv-play.desktop:**
- Exec line correctness (test with $0 = _)
- Icon reference
- Spec compliance (Version field, Categories)

**config.example.js:**
- Platform-specific defaults
- Comment accuracy

### 2. Documentation audit

Read ALL docs completely. Check for:

**Version consistency:**
- package.json version matches Info.plist (auto-synced by CI)
- shim.js reads from package.json (no hardcoded version)
- CHANGELOG.md has entry for current version
- README.md "Recent Releases" lists current version
- SECURITY.md supported versions table is current
- CONTRIBUTING.md references are accurate

**Content accuracy:**
- Line counts match actual file sizes
- Release workflow matches actual CI behavior
- All links are valid (format-wise)
- No stale information from previous versions
- Platform-specific instructions are correct

**Files to check:**
- README.md
- AGENTS.md
- CHANGELOG.md
- SECURITY.md
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- config.example.js
- .github/pull_request_template.md
- .github/ISSUE_TEMPLATE/*.md
- .github/copilot-instructions.md
- .github/skills/code-review/SKILL.md

### 3. CI/CD audit

Check all GitHub features:

**Workflows:**
- Build & Release: does it trigger on tags? Does it build all 3 platforms? Are release notes correct?
- Labeler: are all file patterns correct? Any overlaps? Any missing patterns?
- CodeQL: is it running? 0 alerts? Correct languages?
- Dependabot: correct ecosystems (npm + github-actions)?

**Run these commands:**
```
gh api repos/MrGameVlogger/Jellyfin_mpv_play/actions/workflows -q '.workflows[] | "\(.name) [\(.state)]"'
gh run list -R MrGameVlogger/Jellyfin_mpv_play --limit 10
gh api repos/MrGameVlogger/Jellyfin_mpv_play/code-scanning/default-setup -q '{languages: .languages, state: .state}'
gh api repos/MrGameVlogger/Jellyfin_mpv_play/code-scanning/alerts -q 'length'
gh api repos/MrGameVlogger/Jellyfin_mpv_play -q '.security_and_analysis'
```

**Check for:**
- Stale branches (should only be `main`)
- Open PRs (should be none unless work is in progress)
- Failed workflow runs and their error logs
- Release assets (all 3 platforms present)
- Release notes quality (no CI noise, correct categorization)

### 4. Version release check

If a release was recently created, verify:
- Tag points to the correct commit
- Release notes match what's actually in the build
- All 3 platform bundles are present
- No code fixes listed that aren't in the build
- Downloads table has correct version-specific filenames

### 5. Post-audit

After fixing everything:
- All fixes go through PRs (never push to main)
- Update CHANGELOG.md if code changes were made
- If version was bumped, update Info.plist, CHANGELOG.md, README.md in the same PR
- Clean up any stale local branches
- Run `git status` to verify clean working directory
