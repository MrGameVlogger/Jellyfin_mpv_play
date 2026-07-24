# AGENTS.md

## What this is

Two-part system: a Node.js shim (`shim.js`) that connects to Jellyfin via WebSocket and launches MPV with IPC control, plus an optional native macOS menubar app (`macapp/`) that spawns the shim and parses its stdout to drive UI state.

## Running

```bash
npm install
npm start          # runs: node shim.js
```

No build, lint, test, or typecheck steps exist. `npm start` is the only script.

## Building the macOS app

```bash
cd macapp && ./build.sh
```

Compiles Swift sources with `swiftc`, bundles `shim.js` + `node_modules` into `.app/Contents/Resources`, deploys to `/Applications/Jellyfin MPV Play.app`. Kills any running instance before deploying.

Version lives in `macapp/Info.plist` (`CFBundleVersion` / `CFBundleShortVersionString`). Increment when shipping changes.

## Prerequisites

- Node.js >= 14
- MPV installed and path set in `config.js` (`mpvPath`)
- `config.js` created from `config.example.js` with real Jellyfin credentials
- macOS app requires Xcode Command Line Tools (for `swiftc`)

## Key files

| File | Role |
|------|------|
| `shim.js` | Entire Node.js application (~930 lines) |
| `config.js` | User config with credentials (gitignored, never commit) |
| `config.example.js` | Template for `config.js` |
| `data/` | Runtime state: auth tokens and playback positions (gitignored) |
| `macapp/Sources/*.swift` | Native macOS app (8 files) |
| `macapp/build.sh` | Build + deploy script |
| `macapp/Info.plist` | App metadata and version |

## Architecture

- IPC with MPV over Unix socket (`/tmp/mpv-ipc.sock`)
- MPV launched in `--idle` mode, `loadfile` sent via IPC after connection
- `--save-position-on-quit=no` — position tracking handled in-app via `data/` files
- Auto-reconnect uses exponential backoff on WebSocket disconnect
- Episode navigation (`>`/`<` keys) via MPV client-message IPC events
- macOS app spawns `node shim.js`, parses stdout lines for state changes, sends MPV commands via raw Unix socket

## Critical: Log line contracts

The macOS app (`NodeProcessManager.swift:processLogLine`) parses specific log lines from `shim.js` to update UI. If you change these log messages, the app breaks silently:

| Log line pattern | What it triggers |
|---|---|
| `WebSocket connection established` | Sets status to connected, sends notification |
| `Episode detected: <title>` | Sets now-playing title, enables pause/stop |
| `File loaded by MPV` | Marks as playing (fallback if no episode detected) |
| `Closing application` / `MPV closed` / `Process terminated` | Clears now-playing, resets state |
| Lines starting with `ERROR` / `error` / `FATAL` | Sends error notification |

The title after `Episode detected:` is parsed by `extractTitleFromEpisode()` and displayed in the menubar. Format: `SeriesName - SxEp - EpisodeName`.

## Gotchas

- `config.js` is gitignored. Missing file → `MODULE_NOT_FOUND` on start.
- `deviceId` must differ from `deviceName` per Jellyfin's device registration.
- Positions and token files are per-device, named with `deviceId`.
- App marks items watched at 90% of runtime.
- MPV args in `shim.js` are minimal (idle, window, title, IPC, no-save-position). User's `~/.config/mpv/mpv.conf` handles playback settings (vo, hwdec, ao, cache, etc.).
- The macOS app's `NODE_PATH` is set to bundle Resources so `node_modules` resolves correctly.
- `bash -l` is avoided in `findNodePath()` — it hangs in GUI apps.
- `process.environment` is built as a explicit dict with `NODE_PATH` to ensure node_modules found.
- `setupApplicationSupport()` runs before the guard check (shim.js must exist before we check for it).
