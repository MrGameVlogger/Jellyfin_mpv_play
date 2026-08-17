# TODO

Features, bugs, and improvements planned for Jellyfin MPV Play.

---

## Completed

| Feature | Version | Details |
|---------|---------|---------|
| Fullscreen mode | v1.8.0 | Config option: `fullscreen: true` |
| Queue system | v1.8.0 | Native MPV playlist, PlayNext/PlayLast, cross-season via NextUp |
| Auto-close | v1.8.0 | Config option: `autoClose: true` |
| Headless mode | v1.8.0 | Linux systemd service, Windows `--headless` flag |
| Custom MPV flags | v1.8.0 | Config option: `mpvFlags: [...]` |
| DisplayMessage OSD | v1.8.0 | Center-screen overlay, 10s pause, concurrent message handling |
| Subtitle sync | v1.8.0 | Bidirectional sync between MPV and Jellyfin server |
| Windows support | v1.8.3 | `launch.bat` with headless support |
| CI version sync | v1.8.3 | Info.plist auto-synced from package.json in CI |
| Seek progress reports | v1.8.4 | Report progress immediately on user-initiated seeks (MPV seeking property) |
| Auto-skip intros/outros | v1.8.4 | MediaSegments API, auto-skip or S key, config option `autoSkipIntros` |
| Error OSD messages | v1.8.4 | Connection/auth errors shown in MPV OSD with rate limiting |

---

## Features

### Next-up notification

Before the current episode ends, show an OSD preview of the next episode:
- "Next up: SeriesName - S2E5 - EpisodeName"
- Auto-dismiss after 5s or on user action

---

## Not Our Bug

### JP subtitle freeze

**Source:** Upstream Issue #2 — [MPV unresponsive when video includes JP subtitles](https://github.com/JohnGlaus/Jellyfin_mpv_play/issues/2) (closed)

MPV freezes when playing videos with Japanese subtitles. This is an MPV issue, not a shim issue. The shim doesn't touch subtitle rendering — it only passes the subtitle track to MPV via `sid`. Possible causes include CJK font rendering, ASS/SSA format handling, or missing fonts on the user's system. Not reproducible as a shim bug.

---

## Improvements

### Queue persistence

Save the current queue to `data/` so it survives restarts. On relaunch, offer to resume:
- "Resume playback? Last: SeriesName - S2E3"

### Sync position from Jellyfin server on connect

Resume from where you left off on another device. Query the server for the last playback position on connect and offer to resume.

### MPV config detection

Warn the user if their `~/.config/mpv/mpv.conf` has settings that conflict with the shim:
- `--fullscreen` in mpv.conf when `fullscreen: false` in config.js
- `--no-idle` which conflicts with `--idle=yes`

### Better logging

Add log levels (info, warn, error) and optional verbose mode:
- `verbose: true` in config.js enables debug logging
- Logs include timestamps and component names (e.g. `[mpv]`, `[ws]`, `[jellyfin]`)

---

## Ideas (Low Priority)

- **Chapter markers** — Display MPV chapter markers in OSD
- **Audio language preference** — Auto-select preferred audio language from config
- **Subtitle language preference** — Auto-select preferred subtitle language from config
- **Resume confirmation** — Ask "Resume from 12:34?" instead of auto-resuming
- **Multi-server support** — Connect to multiple Jellyfin servers
- **Trakt integration** — Scrobble to Trakt.tv
