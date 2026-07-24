# 🎬 Jellyfin MPV Play

Control your **MPV player** from the **Jellyfin web interface**. Play movies and series with hardware acceleration, auto-resume, and auto-play next episode.

> **Fork of [JohnGlaus/Jellyfin_mpv_play](https://github.com/JohnGlaus/Jellyfin_mpv_play)** — adds a native macOS menubar app, setup wizard, built-in help, and stability fixes.

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
| 🍎 **macOS** | [MPV Player](https://mpv.io/installation/) + the `.app` (download or build) |
| 🪟 **Windows** | [Node.js](https://nodejs.org/) v14+ · [MPV Player](https://mpv.io/installation/) · Jellyfin server |
| 🐧 **Linux** | [Node.js](https://nodejs.org/) v14+ · [MPV Player](https://mpv.io/installation/) · Jellyfin server |

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

3. **Launch** — drag `Jellyfin MPV Play.app` to `/Applications`, then right-click → Open (first launch only, to bypass Gatekeeper)

4. **Set up** — the app walks you through a 5-step wizard on first launch:
   - Enter your Jellyfin server URL
   - Enter your username and password
   - Test the connection
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

![Step 1](images/1.png)
![Step 2](images/2.png)
![Step 3](images/3.png)
![Step 4](images/4.png)

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
│   └── Info.plist           #   App metadata (v1.3.0)
├── data/                    # Runtime state (auto-generated, gitignored)
├── images/                  # Screenshots for README
├── node_modules/            # Dependencies (gitignored)
├── config.example.js        # Configuration template
├── config.js                # Your config — never commit! (gitignored)
├── shim.js                  # Main Node.js application (~930 lines)
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
