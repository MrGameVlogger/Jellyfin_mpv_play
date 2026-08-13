# Contributing to Jellyfin MPV Play

Thanks for your interest in contributing! This is a fork of [JohnGlaus/Jellyfin_mpv_play](https://github.com/JohnGlaus/Jellyfin_mpv_play).

## Development Setup

### Prerequisites

- **Node.js** v18+ (for running the shim directly)
- **MPV Player** — [mpv.io](https://mpv.io/installation/)
- **Jellyfin Server** — for testing
- **Xcode Command Line Tools** (macOS only, for building the native app)

### Quick Start

```bash
git clone https://github.com/MrGameVlogger/Jellyfin_mpv_play.git
cd Jellyfin_mpv_play
npm install
cp config.example.js config.js
# Edit config.js with your Jellyfin server details
npm start
```

### Building the macOS App

```bash
cd macapp
./build.sh
```

This compiles the Swift sources, bundles Node.js 22 LTS, and deploys to `/Applications`.

## Project Structure

```
Jellyfin_mpv_play/
├── shim.js                  # Main Node.js application (~1200 lines)
├── config.example.js        # Configuration template
├── package.json
├── macapp/
│   ├── Sources/             # Swift source files (11 files)
│   ├── Info.plist           # App metadata
│   ├── AppIcon.icns         # App icon
│   └── build.sh             # Build script
├── .github/
│   ├── ISSUE_TEMPLATE/      # Bug report, feature request
│   └── pull_request_template.md
├── AGENTS.md                # Agent context for AI assistants
├── SECURITY.md
└── README.md
```

## Code Style

### shim.js (Node.js)

- Uses CommonJS (`require`/`module.exports`)
- No build step — plain Node.js
- Log messages must match the patterns in `AGENTS.md` (the macOS app parses stdout)
- Use `console.log()` for state changes, `console.error()` for errors

### macapp/ (Swift)

- macOS 13.0+ minimum deployment target
- Uses Cocoa framework (AppKit)
- `ConfigParser.swift` is the shared utility for config file parsing
- `processLogLine()` runs on the main thread — keep it fast

## Submitting Changes

1. **Fork** the repository
2. **Create a branch** from `main`
3. **Make your changes** — follow the code style above
4. **Test** on your platform (macOS, Windows, or Linux)
5. **Submit a Pull Request** — fill out the PR template

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Update README if adding user-facing features
- Bump version in `macapp/Info.plist` **and** `package.json` if releasing
- No secrets or credentials in the diff

## Reporting Bugs

Use the [Bug Report](https://github.com/MrGameVlogger/Jellyfin_mpv_play/issues/new?template=bug_report.md) template. Include:
- Platform and OS version
- App version (menu bar → About)
- Steps to reproduce
- Logs (menu bar → Show Logs → Export on macOS)

## Feature Requests

Use the [Feature Request](https://github.com/MrGameVlogger/Jellyfin_mpv_play/issues/new?template=feature_request.md) template.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
