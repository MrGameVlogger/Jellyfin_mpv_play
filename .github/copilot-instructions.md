# Copilot Code Review Instructions

## Project Overview

This is a Jellyfin MPV Play project — a Node.js shim that connects to Jellyfin via WebSocket and controls MPV via Unix socket IPC, with an optional native macOS menubar app.

## Key Review Principles

1. **Log messages are contracts** — stdout is parsed by the macOS app. Changing log message patterns will silently break the app. See AGENTS.md for the full list.

2. **No test suite exists** — Changes need extra scrutiny since there are no automated tests to catch regressions.

3. **Thread safety matters** — The macOS app dispatches `processLogLine` to the main thread from a background thread. UI updates must happen on the main thread.

4. **IPC race conditions** — MPV IPC communication uses async callbacks and a poll timer. Race conditions and hanging promises are common failure modes.

5. **Jellyfin API compliance** — `SupportedCommands` must use exact `GeneralCommandType` enum names from Jellyfin source. Wrong names cause 400 errors.

## What to Look For

- Changes to console.log strings that match known patterns (see AGENTS.md)
- Missing error handling in async code
- Race conditions in playback state management
- Hardcoded paths that should be configurable
- Missing cleanup on shutdown
- Changes that would break the build script

## Style Notes

- CommonJS modules (require/module.exports)
- No build step for Node.js code
- Swift code targets macOS 13.0+
- MPV arguments are minimal — user's mpv.conf handles most settings
