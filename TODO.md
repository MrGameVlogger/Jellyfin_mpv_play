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

---

## Features

### Auto-skip intros/outros

**Source:** Upstream Issue #1 — [Add Auto-Skip support?](https://github.com/JohnGlaus/Jellyfin_mpv_play/issues/1)

Jellyfin provides intro/outro segment data via its API. We can use this to:

1. **Query intro segments** — `GET /Items/{id}/IntroSections` returns timestamp ranges for intros
2. **Auto-skip** — When playback reaches an intro start, seek to intro end
3. **Manual skip button** — Show "Skip Intro" via DisplayMessage OSD when in an intro segment
4. **Keyboard shortcut** — Bind a key (e.g. `S`) to manually skip intro/outro

**Implementation plan:**
- Add `getIntroSections(itemId)` function to fetch intro segment data
- In `startProgressPoll()`, check if current position is inside an intro segment
- If yes, show "Skip Intro" OSD and optionally auto-skip after 5s
- Add `skipIntro()` function that seeks to the end of the current segment
- Add `SkipIntro` to `SupportedCommands` for Jellyfin remote control

### Better error messages

Show user-facing errors in MPV OSD instead of just logging to console. For example:
- "Connection lost" when WebSocket disconnects
- "Authentication failed" when token expires
- "Server unreachable" when Jellyfin is down

### Next-up notification

Before the current episode ends, show an OSD preview of the next episode:
- "Next up: SeriesName - S2E5 - EpisodeName"
- Auto-dismiss after 5s or on user action

---

## Bugs to Investigate

### JP subtitle freeze

**Source:** Upstream Issue #2 — [MPV unresponsive when video includes JP subtitles](https://github.com/JohnGlaus/Jellyfin_mpv_play/issues/2) (closed)

MPV freezes when playing videos with Japanese subtitles. May be related to:
- Subtitle font rendering with CJK characters
- MPV's `--sub-font` or `--sub-font-size` settings
- ASS/SSA subtitle format handling

**Action:** Test with a video containing JP subtitles and check if the issue exists in our version.

---

## Improvements

### Queue persistence

Save the current queue to `data/` so it survives restarts. On relaunch, offer to resume:
- "Resume playback? Last: SeriesName - S2E3"

### Progress sync improvements

Currently reports progress every 10s. Could improve:
- Report on pause/unpause immediately
- Report on seek operations
- Sync position from Jellyfin server on connect (resume from where you left off on another device)

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
