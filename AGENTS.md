# AGENTS.md

## What this is

Node.js shim (`shim.js`, ~1250 lines) that connects to Jellyfin via WebSocket, receives play commands, and controls MPV via Unix socket IPC. Optional macOS menubar app (`macapp/`) spawns the shim and parses its stdout for UI state.

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

1. Increment version in `package.json` (use `npm version X.Y.Z`)
2. Commit, push to a branch, and merge via PR
3. Create and push a version tag: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
4. The CI workflow (`.github/workflows/build.yml`) automatically:
   - Reads version from `package.json`
   - Generates release notes from merged PRs (categorized by feat/fix/docs/ci)
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
- package.json version matches Info.plist
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
