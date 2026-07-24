# 🎬 Jellyfin MPV Play

Control your **MPV player** from the **Jellyfin web interface** Play movies and series with hardware acceleration and resume from where you left off.

> **Fork of [JohnGlaus/Jellyfin_mpv_play](https://github.com/JohnGlaus/Jellyfin_mpv_play)** with a native macOS menubar app, bug fixes, and improvements.

### What's different in this fork
- **Native macOS menubar app** — no terminal needed; built with Swift
- **Bundled Node.js** — no need to install Node separately; the `.app` is self-contained (~175MB)
- **Full episode metadata** — titles shown in menubar include series, season, and episode name
- **Smart Resume** — "Play from beginning" in Jellyfin starts fresh instead of resuming
- **Stability fixes** — stdout buffering, proper pipe cleanup, robust process management
- **Self-contained .app** — bundles Node.js 22 LTS and dependencies inside the app bundle

---

## ✨ Features

- 🎯 **Remote Control** - Play from any device on your network
- 💾 **Smart Resume** - Resumes from where you stopped; "Play from beginning" in Jellyfin starts fresh
- ⏭️ **Auto-Play Next Episode** - Binge-watch series seamlessly
- ⚡ **Hardware Acceleration** - Smooth playback with MPV
- 🔄 **Auto-Reconnect** - Handles network interruptions
- 🍎 **Native macOS App** - Menubar icon, notifications, preferences, log viewer

---

## 📋 What You Need

**macOS:** Just the `.app` (downloaded or built) and [MPV Player](https://mpv.io/installation/). Node.js is bundled.

**Windows/Linux:**
1. **Node.js** (v14 or newer) - [Download here](https://nodejs.org/)
2. **MPV Player** - [Download here](https://mpv.io/installation/)
3. **Jellyfin Server** - Your server URL and login credentials

---

## 🚀 Quick Start

### macOS (Recommended)

1. **Download** the latest release from [Releases](https://github.com/MrGameVlogger/Jellyfin_mpv_play/releases) or build it yourself (see below)
2. **Install MPV** via Homebrew:
   ```bash
   brew install mpv
   ```
3. **Unzip** and drag `Jellyfin MPV Play.app` to `/Applications`
4. **Right-click → Open** (first launch only, to bypass Gatekeeper)
5. **Configure** credentials — the app opens a preferences editor on first run, or edit manually:
   ```bash
   nano ~/Library/Application\ Support/JellyfinMpvPlay/config.js
   ```
   ```javascript
   module.exports = {
       serverUrl: 'http://192.168.1.100:8096',  // Your Jellyfin server
       username: 'your_username',
       password: 'your_password',
       mpvPath: '/opt/homebrew/bin/mpv',         // Apple Silicon
       // mpvPath: '/usr/local/bin/mpv',         // Intel
       deviceName: 'My-Mac',
       deviceId: 'my-mac'                       // Different from deviceName
   };
   ```
6. Done — the app runs from the menubar

**Or build from source:**
```bash
git clone https://github.com/MrGameVlogger/Jellyfin_mpv_play.git
cd Jellyfin_mpv_play/macapp
./build.sh
```
This compiles the Swift app, downloads Node.js 22 LTS, bundles everything into a self-contained `.app`, and deploys to `/Applications/Jellyfin MPV Play.app`. The `.app` (~175MB) includes Node.js — no separate installation needed.

### Windows / Linux

1. **Install** prerequisites:
   - [Node.js](https://nodejs.org/) (v14 or newer)
   - [MPV Player](https://mpv.io/installation/)
2. **Clone and install:**
   ```bash
   git clone https://github.com/MrGameVlogger/Jellyfin_mpv_play.git
   cd Jellyfin_mpv_play
   npm install
   ```
3. **Configure:**
   ```bash
   cp config.example.js config.js
   nano config.js
   ```
4. **Run:**
   ```bash
   npm start
   ```

---

## 🎮 How to Use

### Step 1: Start the application
Run `npm start` in your project folder

### Step 2: Open Jellyfin
Open Jellyfin in your web browser

### Step 3: Select content
Choose any movie or episode

### Step 4: Click "Play on"
Click the cast icon (📺) or "Play on" button

![Step 1](images/1.png)
![Step 2](images/2.png)
![Step 3](images/3.png)
![Step 4](images/4.png)

### Step 5: Enjoy!
MPV will open automatically and start playing 🎉

---

## ⌨️ Keyboard Shortcuts

While watching in MPV:

| Key | Action |
|-----|--------|
| `>` or `Media Next` | Next episode |
| `<` or `Media Previous` | Previous episode |

---

## 🔄 Auto-Start (Optional)

### macOS

1. Open **System Settings** → **General** → **Login Items**
2. Click the **+** button
3. Navigate to the project folder and select `Jellyfin MPV Play.app`

### Windows

### Create `start.bat`

Create a file named `start.bat` in the project folder:
```batch
@echo off
cd /d "C:\_ELECTRON\jellyfin_mpv_play"
node shim.js
```

> ⚠️ **Change the path** to match your installation folder

### Create `start.vbs`

Create a file named `start.vbs` (runs silently without showing a window):
```vbscript
Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "C:\_ELECTRON\jellyfin_mpv_play\start.bat" & Chr(34), 0
Set WshShell = Nothing
```

> ⚠️ **Change the path** to match your `start.bat` location

### Add to Startup

1. Press `Win + R`
2. Type: `shell:startup` and press Enter
3. Create a **shortcut** to `start.vbs`
4. Move the shortcut to the Startup folder

---

## 🛠️ Troubleshooting

### "config.js file not found"
- Run: `cp config.example.js config.js` (macOS/Linux) or `copy config.example.js config.js` (Windows)
- Edit `config.js` with your details

### MPV doesn't open
- Check `mpvPath` in `config.js` points to the correct location
- Test MPV manually: Run `mpv --version` in your terminal

### Device doesn't appear in Jellyfin
- Verify `serverUrl` is correct
- Check username and password
- Make sure your PC and Jellyfin server are on the same network

### Playback doesn't resume
- Wait at least 10 seconds before closing MPV
- Resume data is saved in the `data/` folder

### MPV opens but no video / black screen
- Check your `~/.config/mpv/mpv.conf` has valid `vo` and `hwdec` settings (e.g., `vo=gpu-next`, `hwdec=videotoolbox` on macOS)

### Episode navigation (`>`/`<`) not working
- These keys are bound via IPC. If you have custom keybinds in `~/.config/mpv/input.conf`, they may override them

---

## 📁 Project Structure
```
jellyfin_mpv_play/
├── Jellyfin MPV Play.app/   # macOS app bundle (double-click to run)
├── macapp/                  # Swift source for native macOS app
│   ├── Sources/             # Swift source files
│   ├── build.sh             # Build script
│   └── Info.plist            # App metadata
├── data/                    # Tokens & positions (auto-generated)
├── images/                  # Screenshots for README
├── node_modules/            # Dependencies
├── .gitignore
├── config.example.js        # Configuration template
├── config.js                # Your config (don't share!)
├── package.json
├── README.md
└── shim.js                  # Main application
```

---

## 🔒 Security

- ⚠️ **Never share `config.js`** - it contains your password
- 🔐 Your password is only used to authenticate with Jellyfin
- 💾 Tokens are stored locally in the `data/` folder

---

## 🤝 Contributing

Found a bug? Have a suggestion?

- Open an [Issue](https://github.com/MrGameVlogger/Jellyfin_mpv_play/issues)
- Submit a Pull Request

This is a fork of [JohnGlaus/Jellyfin_mpv_play](https://github.com/JohnGlaus/Jellyfin_mpv_play). Upstream improvements may be synced periodically.

---

## 📄 License

MIT License - Feel free to use and modify!

---

## ❓ FAQ

**Q: Does this work on macOS?**  
A: Yes. Tested on macOS with Homebrew MPV. Use `/opt/homebrew/bin/mpv` (Apple Silicon) or `/usr/local/bin/mpv` (Intel) as your `mpvPath`. The native macOS app bundles Node.js 22 LTS — no separate Node installation needed. Build it with `cd macapp && ./build.sh`, or download the release zip.

**Q: Does this work on Linux?**  
A: Yes. Set `mpvPath` to `/usr/bin/mpv` (or wherever MPV is installed).

**Q: Can I use this over the internet?**  
A: Yes, if your Jellyfin server is accessible, but LAN is recommended

**Q: Can I run multiple instances?**  
A: Yes, use different `deviceId` and `ipcSocketPath` for each

---

**Made with ❤️ for the Jellyfin community**

⭐ **Star this repo** if you find it useful!
