<p align="center">
  <img src="images/logo-banner.svg" width="400" alt="Jellyfin MPV Play">
</p>

<p align="center">
  Control your <b>MPV player</b> from the <b>Jellyfin web interface</b>.<br>
  Play movies and series with hardware acceleration, auto-resume, and auto-play next episode.
</p>

<p align="center">
  <a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/MrGameVlogger/Jellyfin_mpv_play?style=flat-square&label=latest%20release"></a>
  <a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square">
  <a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases/latest"><img alt="Downloads" src="https://img.shields.io/github/downloads/MrGameVlogger/Jellyfin_mpv_play/total?style=flat-square"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22%20LTS-brightgreen?style=flat-square&logo=node.js">
</p>

<p align="center">
  <i>Fork of <a href="https://github.com/JohnGlaus/Jellyfin_mpv_play">JohnGlaus/Jellyfin_mpv_play</a> — adds native macOS menubar app, cross-platform bundles, setup wizard, and stability fixes.</i>
</p>

---

## Features

- **Remote Control** — Play from any device on your network
- **Smart Resume** — Remembers where you left off; "Play from beginning" in Jellyfin starts fresh
- **Auto-Play Next Episode** — Binge-watch series seamlessly with cross-season support
- **Full Queue System** — Native MPV playlist; Play Next / Play Last from Jellyfin UI; next/prev navigation
- **Hardware Acceleration** — Smooth playback powered by MPV
- **Auto-Reconnect** — Handles network interruptions with exponential backoff
- **Subtitle Sync** — Change subtitles in MPV, Jellyfin tracks the change
- **Display Messages** — Jellyfin notifications appear as OSD overlays in MPV
- **Fullscreen Mode** — Optional auto-fullscreen on startup
- **Auto-Close** — Optional shutdown when playback queue is exhausted
- **Custom MPV Flags** — Pass any MPV options from config
- **Headless Mode** — Run as a background service on Linux (systemd support)
- **Native macOS App** — Menubar icon, notifications, preferences editor, log viewer, setup wizard
- **Self-Contained Bundles** — All platforms bundle Node.js 22 LTS; just install MPV and go
- **Built-in Help** — Reference guide accessible from the menu bar (macOS)

---

## Downloads

<a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases/latest"><img alt="macOS" src="https://img.shields.io/badge/macOS-.app-blue?style=for-the-badge&logo=apple"></a>
<a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases/latest"><img alt="Linux" src="https://img.shields.io/badge/Linux-.tar.gz-yellow?style=for-the-badge&logo=linux"></a>
<a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases/latest"><img alt="Windows" src="https://img.shields.io/badge/Windows-.zip-blue?style=for-the-badge&logo=windows"></a>

All bundles include their own Node.js runtime. Only [MPV Player](https://mpv.io/installation/) is required.

---

## Quick Start

### macOS

1. **Install MPV** via Homebrew:
   ```bash
   brew install mpv
   ```

2. **Download** the latest release from [Releases](https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases), or build from source:
   ```bash
   git clone https://github.com/MrGameVlogger/Jellyfin_mpv_play.git
   cd Jellyfin_mpv_play
   npm install
   cd macapp
   ./build.sh
   ```
   The build compiles the Swift app, downloads Node.js 22 LTS, and bundles everything into a self-contained `.app` (~175MB) deployed to `/Applications`.

3. **Remove quarantine** (required for downloaded apps):
   ```bash
   xattr -cr "/Applications/Jellyfin MPV Play.app"
   ```
   macOS marks downloaded apps with a quarantine flag. Without removing it, you'll get a "damaged or can't be opened" error.

4. **Launch** — if you built from source, the app is already deployed to `/Applications`. Otherwise drag `Jellyfin MPV Play.app` there, then right-click → Open (first launch only, to bypass Gatekeeper)

5. **Set up** — the app walks you through a setup wizard on first launch:
   - Welcome overview
   - Enter your Jellyfin server URL
   - Enter your username and password (with a Test Connection button)
   - Confirm MPV path and device settings
   - Done!

   > Config is saved to `~/Library/Application Support/JellyfinMpvPlay/config.js`. You can edit it manually or from the Preferences menu.

### Windows

1. **Install MPV** — download from [mpv.io/installation](https://mpv.io/installation/) and add to your PATH

2. **Download** the latest `JellyfinMPVPlay-Windows-*.zip` from [Releases](https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases)

3. **Extract** the zip to any folder (e.g. `C:\Apps\JellyfinMPVPlay`)

4. **Configure** — double-click `launch.bat` once. It creates `config.js` from the template. Edit it with your Jellyfin server details:
   ```javascript
   module.exports = {
       serverUrl: 'http://192.168.1.100:8096',
       username: 'your_username',
       password: 'your_password',
       mpvPath: 'mpv',  // or full path like 'C:\\Program Files\\mpv\\mpv.exe'
       deviceName: 'My-PC',
       deviceId: 'my-pc'
   };
   ```

5. **Run** — double-click `launch.bat`

### Linux

1. **Install MPV:**
   ```bash
   # Ubuntu/Debian
   sudo apt install mpv
   # Fedora
   sudo dnf install mpv
   # Arch
   sudo pacman -S mpv
   ```

2. **Download** the latest `JellyfinMPVPlay-Linux-*.tar.gz` from [Releases](https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases)

3. **Extract** and configure:
   ```bash
   tar -xzf JellyfinMPVPlay-Linux-*.tar.gz
   cd JellyfinMPVPlay-Linux-*
   ./launch.sh    # First run creates config.js
   ```
   Edit `config.js` with your Jellyfin server details:
   ```javascript
   module.exports = {
       serverUrl: 'http://192.168.1.100:8096',
       username: 'your_username',
       password: 'your_password',
       mpvPath: '/usr/bin/mpv',
       deviceName: 'My-PC',
       deviceId: 'my-pc',
       // fullscreen: true,       // Start MPV in fullscreen
       // autoClose: true,         // Close app when queue finishes
       // mpvFlags: [],            // Extra MPV flags
       // headless: true,          // Suppress console output, log to data/shim.log
   };
   ```

4. **Run:**
   ```bash
   ./launch.sh
   ```

   > To add to your app launcher, copy `jellyfin-mpv-play.desktop` to `~/.local/share/applications/` and update the `Exec` path.

#### Headless / Background Service

Run without a terminal window:

```bash
./launch.sh --headless
```

Logs are written to `data/shim.log` instead of the terminal.

To run as a systemd service (auto-start on login, auto-restart on crash):

```bash
./launch.sh --install-service
systemctl --user start jellyfin-mpv-play
```

View logs: `journalctl --user -u jellyfin-mpv-play -f`

To remove the service:
```bash
./launch.sh --uninstall-service
```

---

## How to Use

1. **Start the app** — macOS: click the menu bar icon · Windows: double-click `launch.bat` · Linux: run `./launch.sh`
2. **Open Jellyfin** in your web browser
3. **Pick something to watch** — any movie or episode
4. **Click "Play on"** — the cast icon or "Play on" button
5. **Enjoy!** — MPV opens automatically and starts playing

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

## Keyboard Shortcuts

While watching in MPV:

| Key | Action |
|-----|--------|
| `>` | Next episode |
| `<` | Previous episode |
| `j` | Cycle subtitles (synced to Jellyfin) |

MPV's native `Media Next` / `Media Previous` keys also work for playlist navigation.

---

## Auto-Start (Optional)

### macOS

The easiest way: click the menu bar icon → **Open at Login**.

Or manually:
1. Open **System Settings** → **General** → **Login Items**
2. Click the **+** button
3. Navigate to `/Applications` and select `Jellyfin MPV Play.app`

### Linux

**Option A: Systemd service (recommended)**

```bash
./launch.sh --install-service
systemctl --user start jellyfin-mpv-play
```

This creates a user service that starts on login and restarts on crash. Logs: `journalctl --user -u jellyfin-mpv-play -f`

**Option B: Desktop file**

Copy `jellyfin-mpv-play.desktop` to `~/.local/share/applications/` and update the `Exec` path. Right-click the entry in your app launcher to set it as a startup app.

**Option C: Cron**

```bash
crontab -e
# Add: @reboot /path/to/launch.sh --headless
```

### Windows

**Option A: Use the bundle** — edit `launch.bat` to add it to your Startup folder, or create a shortcut.

**Option B: Manual setup:**

**Create `start.bat`:**
```batch
@echo off
cd /d "C:\path\to\JellyfinMPVPlay"
node\node.exe shim.js
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

> **Change the paths** to match your installation folder

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **macOS: "app is damaged/can't be opened"** | Run `xattr -cr "/Applications/Jellyfin MPV Play.app"` to remove the quarantine flag |
| **"config.js file not found"** | Run the launcher once to auto-create `config.js`, then edit with your details |
| **MPV doesn't open** | Check `mpvPath` in config. Test: `mpv --version` in terminal |
| **Device doesn't appear in Jellyfin** | Verify `serverUrl`, username, password. Ensure same network |
| **Playback doesn't resume** | Wait at least 10 seconds before closing MPV |
| **Black screen / no video** | Check `~/.config/mpv/mpv.conf` for valid `vo` and `hwdec` settings |
| **Episode navigation (`>`/`<`) not working** | Custom keybinds in `~/.config/mpv/input.conf` may override defaults |
| **Linux: "mpv is not installed"** | Install via `sudo apt install mpv` (or your distro's package manager) |
| **Windows: "mpv is not installed"** | Download from [mpv.io](https://mpv.io/installation/) and add to your PATH |

---

## Project Structure

```
Jellyfin_mpv_play/
├── macapp/                  # Native macOS app
│   ├── Sources/             #   Swift source files
│   ├── build.sh             #   Build script (downloads + bundles Node.js)
│   ├── AppIcon.icns         #   App icon (macOS .icns format)
│   └── Info.plist           #   App metadata
├── linux/                   # Linux bundle launcher
│   ├── launch.sh            #   Launcher script (--headless, --install-service)
│   ├── jellyfin-mpv-play.service  #   Systemd user service
│   └── jellyfin-mpv-play.desktop  #   Desktop integration
├── windows/                 # Windows bundle launcher
│   └── launch.bat           #   Launcher script
├── images/                  # Logo SVGs and screenshots
│   ├── logo.svg             #   Full logo with text
│   ├── icon.svg             #   App icon (no text)
│   ├── icon-light.svg       #   Light variant
│   ├── icon-dark.svg        #   Dark variant
│   ├── logo-banner.svg      #   Horizontal banner for README
│   └── 1-4.png              #   Step-by-step screenshots
├── data/                    # Runtime state (auto-generated, gitignored)
├── node_modules/            # Dependencies (gitignored)
├── config.example.js        # Configuration template
├── config.js                # Your config — never commit! (gitignored)
├── shim.js                  # Main Node.js application (~1620 lines)
├── package.json
└── README.md
```

---

## Security

- **Never share `config.js`** — it contains your password
- Your password is only used to authenticate with Jellyfin
- Tokens and playback positions are stored locally in the `data/` folder
- `config.js` and `data/` are gitignored — they stay on your machine

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full release history.

### Recent Releases

**v1.8.1** — Linux headless fix, release notes format ([details](CHANGELOG.md#v181))
- Fixed Linux headless mode — no terminal window when `headless: true`

**v1.8.0** — Queue system, DisplayMessage OSD, subtitle sync, headless mode ([details](CHANGELOG.md#v180))
- Full queue system with native MPV playlist, Play Next/Play Last, cross-season auto-play
- Jellyfin messages appear as OSD overlays in MPV with pause support
- Subtitle changes in MPV synced to Jellyfin
- Headless mode for Linux background operation
- Fullscreen, auto-close, custom MPV flags config options

**v1.7.6** — Bug fixes: stop reporting ([details](CHANGELOG.md#v176))
- Fixed playback stop not reported when Stop command comes from Jellyfin web UI
- Fixed playback stop not reported when MPV IPC connection fails

**v1.7.5** — **Critical fix: playback controls in Jellyfin web UI** ([details](CHANGELOG.md#v175))
- **Fixed playback controls broken since v1.7.0** (API format regression)
- Fixed duplicate progress reporting, help window, preferences alignment, dark mode icon
- Logs now saved to Application Support with timestamps
- About window dark mode icon, preferences alignment, log file saving

**v1.7.4** — Fix: emoji encoding corruption in log output ([details](CHANGELOG.md#v174))

**v1.7.3** — Bug fixes: shutdown race, icon colors, encoding, signal handling ([details](CHANGELOG.md#v173))
- Fixed shutdown waiting for HTTP stop report before exiting
- Fixed StatusBarController icon colors actually rendering
- Fixed signal forwarding in launch.sh, path handling in launch.bat
- Extracted shared utilities, SHA256 checksum verification

**v1.7.2** — Bug fixes: deviceId persistence, pendingQueries hang, stderr buffering ([details](CHANGELOG.md#v172))
- Fixed random deviceId creating zombie sessions on restart
- Fixed pendingQueries not resolved on MPV close (poll timer hang)
- Fixed stderr line buffering in NodeProcessManager
- Fixed `.desktop` file Exec line

**v1.7.1** — CI automation: auto-generated release notes from PRs ([details](CHANGELOG.md#v171))
- Release workflow now auto-generates changelog from merged PR titles
- Version sync: package.json is single source of truth, shim.js reads it at runtime

**v1.7.0** — Security, stability, and 20 bug fixes ([details](CHANGELOG.md#v170--security-stability-bug-fixes))
- API key redaction, token file permissions, crash handlers
- ConfigParser regex, audio/subtitle timing, backward navigation, SF Symbols, setup wizard fixes

**v1.6.0** — Cross-platform bundles and CI workflow ([details](CHANGELOG.md#v160--cross-platform-bundles-ci-build-workflow))
- Self-contained Linux and Windows bundles with bundled Node.js
- GitHub Actions auto-builds releases for all 3 platforms

**v1.5.0** — Apple HIG compliance and major feature release ([details](CHANGELOG.md#v150--apple-hig-compliance-bug-fixes-new-features))
- Full playback control from Jellyfin, auto-play overhaul, 13 bug fixes

<details>
<summary><b>Older releases</b></summary>

**v1.4.0** — Bug fixes, logo, UI overhaul ([details](CHANGELOG.md#v140--bug-fixes-logo-ui-overhaul))

**v1.3.0** — Setup wizard, help window, bundled Node.js ([details](CHANGELOG.md#v130--setup-wizard-help-window-bundled-nodejs))

**v1.2.1** — Native macOS app, play-from-beginning fix, 8 bug fixes ([details](CHANGELOG.md#v121--native-macos-app-play-from-beginning-fix-8-bug-fixes))
</details>

---

## Contributing

Found a bug? Have a suggestion?

- Open an [Issue](https://github.com/MrGameVlogger/Jellyfin_mpv_play/issues)
- Submit a Pull Request

This is a fork of [JohnGlaus/Jellyfin_mpv_play](https://github.com/JohnGlaus/Jellyfin_mpv_play). Upstream improvements may be synced periodically.

---

## License

MIT License — Feel free to use and modify! See [LICENSE](LICENSE).

---

## FAQ

**Q: Does this work on macOS?**
A: Yes. Tested on macOS with Homebrew MPV. Use `/opt/homebrew/bin/mpv` (Apple Silicon) or `/usr/local/bin/mpv` (Intel) as your `mpvPath`. The native macOS app bundles Node.js 22 LTS — no separate installation needed.

**Q: Does this work on Linux?**
A: Yes. Download the Linux bundle from [Releases](https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases), extract, and run `./launch.sh`. Set `mpvPath` to `/usr/bin/mpv` (or wherever MPV is installed).

**Q: Can I use this over the internet?**
A: Yes, if your Jellyfin server is accessible, but LAN is recommended.

**Q: Can I run multiple instances?**
A: Yes, use different `deviceId` and `ipcSocketPath` for each.

**Q: Where is my config on macOS?**
A: `~/Library/Application Support/JellyfinMpvPlay/config.js`. The setup wizard configures this on first launch.

**Q: How do I update the macOS app?**
A: Download the latest release, unzip, and replace the app in `/Applications`. Your config is stored separately and persists across updates.

**Q: How do I update the Linux/Windows bundle?**
A: Download the latest release, extract to a new folder, and copy your `config.js` from the old folder. Your `data/` folder (playback positions) can also be copied over.

---

<p align="center">
  Made with ❤️ for the Jellyfin community<br>
  <a href="https://github.com/MrGameVlogger/Jellyfin_mpv_play/stargazers">⭐ Star this repo</a> if you find it useful!
</p>
