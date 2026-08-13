<p align="center">
  <img src="images/logo-banner.svg" width="400" alt="Jellyfin MPV Play">
</p>

<p align="center">
  Control your <b>MPV player</b> from the <b>Jellyfin web interface</b>. Play movies and series with hardware acceleration, auto-resume, and auto-play next episode.
</p>

<p align="center">
  <i>Fork of <a href="https://github.com/JohnGlaus/Jellyfin_mpv_play">JohnGlaus/Jellyfin_mpv_play</a> — adds a native macOS menubar app, setup wizard, built-in help, and stability fixes.</i>
</p>

---

## ✨ Features

- 🎯 **Remote Control** — Play from any device on your network
- 💾 **Smart Resume** — Remembers where you left off; "Play from beginning" in Jellyfin starts fresh
- ⏭️ **Auto-Play Next Episode** — Binge-watch series seamlessly
- ⚡ **Hardware Acceleration** — Smooth playback powered by MPV
- 🔄 **Auto-Reconnect** — Handles network interruptions with exponential backoff
- 🍎 **Native macOS App** — Menubar icon, notifications, preferences editor, log viewer, setup wizard
- 📦 **Self-Contained** — macOS `.app` bundles Node.js 22 LTS; no separate installation needed
- ❓ **Built-in Help** — Reference guide accessible from the menu bar

---

## 📋 What You Need

| Platform | Requirements |
|----------|-------------|
| 🍎 **macOS** | [MPV Player](https://mpv.io/installation/) + the `.app` (download or build) · Jellyfin server |
| 🪟 **Windows** | [Node.js v18+](https://nodejs.org/) · [MPV Player](https://mpv.io/installation/) · Jellyfin server |
| 🐧 **Linux** | [Node.js v18+](https://nodejs.org/) · [MPV Player](https://mpv.io/installation/) · Jellyfin server |

---

## 🚀 Quick Start

### 🍎 macOS

1. **Install MPV** via Homebrew:
   ```bash
   brew install mpv
   ```

2. **Download** the latest release from [Releases](https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases), or build from source:
   ```bash
   git clone https://github.com/MrGameVlogger/Jellyfin_mpv_play.git
   cd Jellyfin_mpv_play/macapp
   ./build.sh
   ```
   The build compiles the Swift app, downloads Node.js 22 LTS, and bundles everything into a self-contained `.app` (~175MB) deployed to `/Applications`.

3. **Launch** — if you built from source, the app is already deployed to `/Applications`. Otherwise drag `Jellyfin MPV Play.app` there, then right-click → Open (first launch only, to bypass Gatekeeper)

4. **Set up** — the app walks you through a setup wizard on first launch:
   - Welcome overview
   - Enter your Jellyfin server URL
   - Enter your username and password (with a Test Connection button)
   - Confirm MPV path and device settings
   - Done!

   > 💡 Config is saved to `~/Library/Application Support/JellyfinMpvPlay/config.js`. You can edit it manually or from the Preferences menu.

### 🪟 Windows / Linux

1. **Clone and install:**
   ```bash
   git clone https://github.com/MrGameVlogger/Jellyfin_mpv_play.git
   cd Jellyfin_mpv_play
   npm install
   ```

2. **Configure:**
   ```bash
   cp config.example.js config.js
   ```
   Edit `config.js` with your details:
   ```javascript
   module.exports = {
       serverUrl: 'http://192.168.1.100:8096',  // Your Jellyfin server
       username: 'your_username',
       password: 'your_password',
       mpvPath: '/usr/bin/mpv',                  // Linux
       // mpvPath: 'C:\\Program Files\\mpv\\mpv.exe',  // Windows
       deviceName: 'My-PC',
       deviceId: 'my-pc'                         // Different from deviceName
   };
   ```

3. **Run:**
   ```bash
   npm start
   ```

---

## 🎮 How to Use

1. **Start the app** — macOS: click the menu bar icon · Windows/Linux: `npm start`
2. **Open Jellyfin** in your web browser
3. **Pick something to watch** — any movie or episode
4. **Click "Play on"** — the cast icon (📺) or "Play on" button
5. **Enjoy!** — MPV opens automatically and starts playing 🎉

<table>
  <tr>
    <td align="center"><img src="images/1.png" width="300"><br><sub>1. Click the cast icon in Jellyfin</sub></td>
    <td align="center"><img src="images/2.png" width="300"><br><sub>2. Select your device from the list</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="images/3.png" width="300"><br><sub>3. Device connects and shows in the top bar</sub></td>
    <td align="center"><img src="images/4.png" width="300"><br><sub>4. Remote control options appear</sub></td>
  </tr>
</table>

---

## ⌨️ Keyboard Shortcuts

While watching in MPV:

| Key | Action |
|-----|--------|
| `>` or `Media Next` | Next episode |
| `<` or `Media Previous` | Previous episode |

---

## 🔄 Auto-Start (Optional)

### 🍎 macOS

The easiest way: click the menu bar icon → **Open at Login**.

Or manually:
1. Open **System Settings** → **General** → **Login Items**
2. Click the **+** button
3. Navigate to `/Applications` and select `Jellyfin MPV Play.app`

### 🪟 Windows

**Create `start.bat`:**
```batch
@echo off
cd /d "C:\path\to\Jellyfin_mpv_play"
node shim.js
```

**Create `start.vbs`** (runs silently):
```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "C:\path\to\start.bat" & Chr(34), 0
Set WshShell = Nothing
```

**Add to Startup:**
1. Press `Win + R`, type `shell:startup`, press Enter
2. Create a shortcut to `start.vbs` in the Startup folder

> ⚠️ **Change the paths** to match your installation folder

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| **"config.js file not found"** | Run `cp config.example.js config.js` and edit with your details |
| **MPV doesn't open** | Check `mpvPath` in config. Test: `mpv --version` in terminal |
| **Device doesn't appear in Jellyfin** | Verify `serverUrl`, username, password. Ensure same network |
| **Playback doesn't resume** | Wait at least 10 seconds before closing MPV |
| **Black screen / no video** | Check `~/.config/mpv/mpv.conf` for valid `vo` and `hwdec` settings |
| **Episode navigation (`>`/`<`) not working** | Custom keybinds in `~/.config/mpv/input.conf` may override defaults |

---

## 📁 Project Structure

```
Jellyfin_mpv_play/
├── macapp/                  # Native macOS app
│   ├── Sources/             #   Swift source files
│   ├── build.sh             #   Build script (downloads + bundles Node.js)
│   ├── AppIcon.icns         #   App icon (macOS .icns format)
│   └── Info.plist           #   App metadata (v1.5.0)
├── images/                  # Logo SVGs and screenshots
│   ├── logo.svg             #   Full logo with text
│   ├── icon.svg             #   App icon (no text)
│   ├── logo-banner.svg      #   Horizontal banner for README
│   └── 1-4.png              #   Step-by-step screenshots
├── data/                    # Runtime state (auto-generated, gitignored)
├── node_modules/            # Dependencies (gitignored)
├── config.example.js        # Configuration template
├── config.js                # Your config — never commit! (gitignored)
├── shim.js                  # Main Node.js application (~1200 lines)
├── package.json
└── README.md
```

---

## 🔒 Security

- ⚠️ **Never share `config.js`** — it contains your password
- 🔐 Your password is only used to authenticate with Jellyfin
- 💾 Tokens and playback positions are stored locally in the `data/` folder
- 📁 `config.js` and `data/` are gitignored — they stay on your machine

---

## 📝 Changelog

### v1.5.0 — Apple HIG Compliance, Bug Fixes, New Features

**New Features:**
- **Playback control from Jellyfin** — full `GeneralCommand` handler for volume, mute, audio/subtitle tracks, repeat mode, shuffle, fullscreen
- **Playstate commands** — PlayPause, NextTrack, PreviousTrack, Rewind (−10s), FastForward (+10s)
- **Series page play** — queries Jellyfin's NextUp API to find the correct episode
- **Copy Now Playing** — copies current title to clipboard
- **Open at Login** — toggle directly from menu bar dropdown
- **Open Config File** — opens `config.js` in default editor
- **Open App Folder** — opens Application Support directory in Finder

**Auto-Play Overhaul:**
- Fixed auto-play next episode — now uses IPC poll timer (queries mpv every 1s) instead of unreliable `eof-reached` events
- Episode transitions reuse the running MPV process via `loadfile` IPC command (no more window flash)
- Double-trigger prevention with `isPlayingNext` flag and 10s timeout
- Duplicate watched marking prevented with `markedWatched` Set

**Bug Fixes:**
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

**Apple HIG Compliance:**
- All windows now respect standard macOS window layering (removed `.floating`)
- Status bar icons use template images and adapt to light/dark menu bar
- Replaced deprecated `NSApp.activate(ignoringOtherApps:)` with version-checked API
- Log viewer respects system appearance instead of forcing dark theme
- Added `LSApplicationCategoryType` to Info.plist

**Code Quality:**
- Extracted shared `ConfigParser` utility (eliminates duplication across 3 files)
- Thread safety: `processLogLine` dispatched to main thread
- `shim.js`: Progress reports now include `RepeatMode`, `PlaybackOrder`, `MediaSourceId`
- `shim.js`: Shutdown sends `SessionsStop` message before closing WebSocket

### v1.4.0 — Bug Fixes, Logo, UI Overhaul

**New Features:**
- **Custom app icon** — replaces generic SF Symbol with purpose-built `AppIcon.icns`
- **Dark mode icon variant** — About window dynamically switches based on system appearance
- **SVG logo set** — `logo.svg`, `icon.svg`, `icon-light.svg`, `icon-dark.svg`, `logo-banner.svg`
- **Pause state reporting** — subscribes to MPV's `pause` property, accurate `IsPaused` in progress reports
- **Help window overhaul** — keyboard shortcuts with ⌘ equivalents, SF Symbols per section, resizable

**Bug Fixes:**
- Fixed shake animation (was using `frame.origin` instead of `layer.position`)
- Fixed version in auth header (was hardcoded `1.3.0`)
- Fixed memory leak in `AppDelegate.statusHandler` closure
- Fixed `isReportingStop` flag not resetting on fresh play
- Removed dead `getSavedPosition()` function
- Fixed log window text view sizing

**UI Improvements:**
- All windows float above other apps
- About window: taller, Jellyfin link, theme-aware icon
- Menu key equivalents for all items

### v1.3.0 — Setup Wizard, Help Window, Bundled Node.js

**New Features:**
- **First-run setup wizard** — 5-step guided setup with "Test Connection" button
- **Help window** — Getting Started, Controls, Keyboard Shortcuts, Smart Resume, Troubleshooting
- **Bundled Node.js 22 LTS** — fully self-contained app (~175MB), no system Node required

**Improvements:**
- About window redesigned with fork attribution and clickable links
- Preferences auto-fills default values for empty fields
- `findNodePath()` checks bundle first, falls back to system Node
- README rewritten with separate macOS/Windows/Linux sections

### v1.2.1 — Native macOS App, Play-from-Beginning Fix, 8 Bug Fixes

**New: Native macOS Menu Bar App:**
- Status bar icon with color-coded states (disconnected/connected/playing)
- Now Playing display, Pause/Resume and Stop controls
- Log viewer with syntax coloring, auto-scroll, export
- Preferences window with "Test Connection" button
- Launch at Login toggle, macOS notifications
- Automatic process management with exponential backoff restart
- Build script compiles Swift, bundles into `.app` for `/Applications`

**Fixed: Play-from-Beginning Bug:**
- Server's `StartPositionTicks: 0` now correctly starts from beginning
- Previously, saved local position could override "play from beginning" request

**Bug Fixes:**
1. Removed duplicate `connectToMpvIpc()` function
2. Race condition fix with `playbackGeneration` counter
3. Graceful shutdown now saves position and reports stop
4. `eof-reached` handler now reports stop to server
5. Episode list sort no longer mutates API response
6. Fixed `currentIndex` bounds check
7. Platform-aware IPC socket path (Unix/Windows)
8. Fixed MPV keybind names (`NEXT`/`PREV`)

**Improvements:**
- Log messages translated from Spanish to English (enables macOS app parsing)
- Simplified MPV arguments (delegated to user's `mpv.conf`)
- Added `--force-media-title` for descriptive window titles
- Better token validation and error handling

---

## 🤝 Contributing

Found a bug? Have a suggestion?

- Open an [Issue](https://github.com/MrGameVlogger/Jellyfin_mpv_play/issues)
- Submit a Pull Request

This is a fork of [JohnGlaus/Jellyfin_mpv_play](https://github.com/JohnGlaus/Jellyfin_mpv_play). Upstream improvements may be synced periodically.

---

## 📄 License

MIT License — Feel free to use and modify!

---

## ❓ FAQ

**Q: Does this work on macOS?**
A: Yes. Tested on macOS with Homebrew MPV. Use `/opt/homebrew/bin/mpv` (Apple Silicon) or `/usr/local/bin/mpv` (Intel) as your `mpvPath`. The native macOS app bundles Node.js 22 LTS — no separate installation needed.

**Q: Does this work on Linux?**
A: Yes. Set `mpvPath` to `/usr/bin/mpv` (or wherever MPV is installed).

**Q: Can I use this over the internet?**
A: Yes, if your Jellyfin server is accessible, but LAN is recommended.

**Q: Can I run multiple instances?**
A: Yes, use different `deviceId` and `ipcSocketPath` for each.

**Q: Where is my config on macOS?**
A: `~/Library/Application Support/JellyfinMpvPlay/config.js`. The setup wizard configures this on first launch.

**Q: How do I update the macOS app?**
A: Download the latest release, unzip, and replace the app in `/Applications`. Your config is stored separately and persists across updates.

---

**Made with ❤️ for the Jellyfin community**

⭐ **Star this repo** if you find it useful!

