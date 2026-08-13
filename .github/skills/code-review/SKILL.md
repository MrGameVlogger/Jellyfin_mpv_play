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
- **State flags**: `isStoppingPlayback`, `isPlayingNext`, `markedWatched`, `pendingQueries` are critical for preventing race conditions. Changes to these need careful review.

### macapp/ (Swift)

- **Thread safety**: `processLogLine` runs on the main thread (dispatched from background). UI updates must happen on main thread.
- **Config parsing**: `ConfigParser.swift` is shared across AppDelegate, NodeProcessManager, and PreferencesWindowController. Changes affect all three.
- **Window management**: All windows use standard layering (no `.floating`). Status bar icons are template images for light/dark mode.

### General

- **No tests exist**: There's no test suite, so changes need extra scrutiny.
- **No lint/typecheck**: Code style is enforced by convention, not tooling.
- **Log patterns are contracts**: See AGENTS.md "Log line contracts" section for the full list.

## Common Issues to Flag

1. Changes to log message strings that the macOS app parses
2. Missing error handling in async IPC code
3. Race conditions in playback state management
4. Hardcoded paths that should be configurable
5. Missing cleanup on shutdown (IPC socket, progress intervals)
6. Changes that would break the build script's assumptions

## References

- `AGENTS.md` — Full architecture, gotchas, and log line contracts
- `SECURITY.md` — Supported versions
- `README.md` — User-facing documentation
