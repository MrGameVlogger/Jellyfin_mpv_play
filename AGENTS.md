# AGENTS.md

## What this is

Node.js shim (`shim.js`, ~1200 lines) that connects to Jellyfin via WebSocket, receives play commands, and controls MPV via Unix socket IPC. Optional macOS menubar app (`macapp/`) spawns the shim and parses its stdout for UI state.

## Commands

```bash
npm install && npm start     # run shim directly
cd macapp && ./build.sh      # compile Swift, bundle Node.js 22, deploy to /Applications
```

No test, lint, or typecheck steps exist.

## Key files

| File | Role |
|------|------|
| `shim.js` | Entire Node.js application |
| `config.js` | User config with credentials (gitignored) |
| `config.example.js` | Template for `config.js` |
| `data/` | Runtime state: auth tokens, playback positions (gitignored) |
| `macapp/Sources/*.swift` | Native macOS menubar app (11 files) |
| `macapp/build.sh` | Compile + bundle + deploy to `/Applications` |
| `macapp/Info.plist` | App version — increment before shipping |

## Architecture

- **IPC**: Unix socket at `/tmp/mpv-ipc.sock` (configurable via `ipcSocketPath` in config.js)
- **MPV flags**: `--idle=yes --keep-open=yes --save-position-on-quit=no`
- **Auto-play**: Poll timer queries `time-pos` and `duration` via IPC every 1s. Triggers next episode when `pos >= dur - 1`. Does NOT rely on `eof-reached` or `end-file` — those don't fire with `--keep-open=yes`.
- **Episode transitions**: `loadNextEpisode()` reuses the running MPV process (sends `loadfile` via IPC). `playMedia()` spawns a fresh MPV (used for initial play and when IPC is down).
- **Series page play**: Queries `GET /Shows/NextUp?userId={id}&seriesId={id}&limit=1` to find the correct next episode, falls back to first unwatched in the list.
- **Playable types**: `Episode`, `Movie`, `Video`, `MusicVideo`, `Audio` — anything else is skipped.
- **Watched threshold**: Item marked watched at 90% of runtime.
- **Reconnection**: Exponential backoff (5s → 10s → 20s → 30s cap) on WebSocket disconnect.

## Jellyfin API compliance

The shim handles three WebSocket message types: `Play`, `Playstate`, `GeneralCommand`.

**PlaystateCommand** — all 9 handled: Stop, Pause, Unpause, PlayPause, NextTrack, PreviousTrack, Seek, Rewind, FastForward.

**GeneralCommand** — SetAudioStreamIndex, SetSubtitleStreamIndex, SetVolume, VolumeUp/Down, Mute/Unmute/ToggleMute, SetRepeatMode, SetPlaybackOrder, DisplayMessage, PlayNext, ToggleFullscreen.

**PlayRequest fields used**: ItemIds, StartPositionTicks, PlayCommand (PlayNow/PlayShuffle), StartIndex, AudioStreamIndex, SubtitleStreamIndex.

**Progress reports include**: ItemId, PositionTicks, IsPaused, IsMuted, VolumeLevel, PlayMethod, PlaySessionId, CanSeek, RepeatMode, PlaybackOrder, MediaSourceId.

**SupportedCommands** must use exact `GeneralCommandType` enum names from Jellyfin source (`MediaBrowser.Model/Session/GeneralCommandType.cs`). Wrong names cause 400 errors.

**Shutdown**: Sends `SessionsStop` message before closing WebSocket to prevent zombie sessions.

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

## Release workflow

1. Increment version in `macapp/Info.plist`
2. `cd macapp && ./build.sh` (deploys to `/Applications`)
3. Commit + push (after user approval)
4. Create release zip: `ditto -c -k --sequesterRsrc --keepParent "Jellyfin MPV Play.app" "JellyfinMPVPlay-macOS-vX.Y.Z.zip"`
5. GitHub release: `gh release create vX.Y.Z JellyfinMPVPlay-macOS-vX.Y.Z.zip --title "vX.Y.Z" --notes "..."`

**Important**: `gh` may default to the upstream repo (JohnGlaus). Always use `-R MrGameVlogger/Jellyfin_mpv_play` with release commands, or run `gh repo set-default MrGameVlogger/Jellyfin_mpv_play` once.
