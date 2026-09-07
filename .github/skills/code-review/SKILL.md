# Code Review Skill

## Purpose

This skill provides context for GitHub Copilot code review to give more relevant feedback on this Jellyfin MPV Play project.

## Project Context

This is a Node.js shim (`shim.js`) that connects to Jellyfin via WebSocket and controls MPV via Unix socket IPC, with an optional native macOS menubar app (`macapp/`).

## Review Focus Areas

### shim.js (Node.js)

- **Log line contracts**: stdout is parsed by the macOS app's `processLogLine()`. Changing log message patterns (e.g., "Episode detected:", "File loaded by MPV") will silently break the macOS app. Flag any changes to console.log strings that match known patterns.
- **IPC communication**: Changes to MPV IPC commands or the poll timer logic need careful review — race conditions and hanging promises are common failure modes.
- **Jellyfin API compliance**: `SupportedCommands` must use exact `GeneralCommandType` enum names. Wrong names cause 400 errors from the server.
- **State flags**: `isPlayingNext`, `markedWatched`, `pendingQueries` are critical for preventing race conditions. Changes to these need careful review.
- **WebSocket keep-alive**: `ws` library v8.x auto-responds to ping/pong. Don't add manual ping handlers. ForceKeepAlive data can be number, string, or object — always parse safely with fallback to 30.
- **SyncPlay**: Full support implemented. Commands (Unpause, Pause, Stop, Seek, etc.), group updates, waiting/ready states, UTC time sync.
- **EOF detection**: `eof-reached` observer (ID 8) for reliable end-of-file detection. Logs item ID, position, duration, queue index.
- **Secrets redaction**: API keys and tokens must be redacted in log output using `redact()`.

### macapp/ (Swift)

- **Thread safety**: `processLogLine` runs on the main thread (dispatched from background). UI updates must happen on main thread.
- **State flags**: `isStoppingPlayback` prevents stale log lines from corrupting state after user clicks Stop.
- **Config parsing**: `ConfigParser.swift` is shared across AppDelegate, NodeProcessManager, PreferencesWindowController, and StatusBarController. Changes affect all four.
- **Window management**: All windows use standard layering (no `.floating`). Status bar icons are template images for light/dark mode.
- **Multi-config**: Preferences has a config file selector. Selected config is stored in UserDefaults and passed to shim.js.

### General

- **Tests are limited**: `npm test` runs log-contract and config tests, but coverage is minimal. Changes need extra scrutiny.
- **No lint/typecheck**: Code style is enforced by convention, not tooling.
- **Log patterns are contracts**: See AGENTS.md "Log line contracts" section for the full list.
- **IPC socket**: Defaults to `$XDG_RUNTIME_DIR/mpv-ipc.sock` on Linux, `/tmp/mpv-ipc.sock` on macOS, `\\.\pipe\mpv-ipc` on Windows.

## Common Issues to Flag

1. Changes to log message strings that the macOS app parses
2. Missing error handling in async IPC code
3. Race conditions in playback state management
4. Hardcoded paths that should be configurable
5. Missing cleanup on shutdown (IPC socket, progress intervals)
6. Changes that would break the build script's assumptions
7. ForceKeepAlive data parsing (can be number, string, or object)
8. WebSocket message types that should be handled but aren't

## References

- `AGENTS.md` — Full architecture, gotchas, and log line contracts
- `SECURITY.md` — Supported versions
- `README.md` — User-facing documentation
