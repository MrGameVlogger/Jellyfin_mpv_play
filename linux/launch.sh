#!/bin/bash
set -e

# Resolve symlink: follow $0 to its real path
SOURCE="$0"
while [ -L "$SOURCE" ]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"

CONFIG_FILE="$SCRIPT_DIR/config.js"
EXAMPLE_CONFIG="$SCRIPT_DIR/config.example.js"

if [ ! -f "$CONFIG_FILE" ]; then
    if [ -f "$EXAMPLE_CONFIG" ]; then
        cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
        echo "First run: created config.js from config.example.js"
        echo "Please edit $CONFIG_FILE with your Jellyfin server details and MPV path, then run this again."
        exit 0
    else
        echo "ERROR: config.example.js not found. Bundle may be corrupted." >&2
        exit 1
    fi
fi

if ! command -v mpv &>/dev/null; then
    echo "ERROR: mpv is not installed or not in PATH." >&2
    echo "Install it with your package manager, e.g.:" >&2
    echo "  Ubuntu/Debian:  sudo apt install mpv" >&2
    echo "  Fedora:         sudo dnf install mpv" >&2
    echo "  Arch:           sudo pacman -S mpv" >&2
    exit 1
fi

NODE_BIN="$SCRIPT_DIR/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
    echo "ERROR: Bundled Node.js not found at $NODE_BIN" >&2
    echo "Bundle may be corrupted. Please re-download." >&2
    exit 1
fi

if [ ! -f "$SCRIPT_DIR/shim.js" ]; then
    echo "ERROR: shim.js not found in $SCRIPT_DIR" >&2
    echo "Bundle may be corrupted. Please re-download." >&2
    exit 1
fi

# Install systemd service
if [ "$1" = "--install-service" ]; then
    SERVICE_FILE="$SCRIPT_DIR/linux/jellyfin-mpv-play.service"
    if [ ! -f "$SERVICE_FILE" ]; then
        echo "ERROR: Service file not found at $SERVICE_FILE" >&2
        exit 1
    fi
    # Patch ExecStart and WorkingDirectory to actual install path
    sed "s|/opt/jellyfin-mpv-play|$SCRIPT_DIR|g" "$SERVICE_FILE" > /tmp/jellyfin-mpv-play.service
    mkdir -p ~/.config/systemd/user
    cp /tmp/jellyfin-mpv-play.service ~/.config/systemd/user/jellyfin-mpv-play.service
    systemctl --user daemon-reload
    systemctl --user enable jellyfin-mpv-play.service
    echo "Service installed and enabled. Start with: systemctl --user start jellyfin-mpv-play"
    echo "View logs with: journalctl --user -u jellyfin-mpv-play -f"
    exit 0
fi

# Uninstall systemd service
if [ "$1" = "--uninstall-service" ]; then
    systemctl --user stop jellyfin-mpv-play.service 2>/dev/null || true
    systemctl --user disable jellyfin-mpv-play.service 2>/dev/null || true
    rm -f ~/.config/systemd/user/jellyfin-mpv-play.service
    systemctl --user daemon-reload
    echo "Service stopped, disabled, and removed."
    exit 0
fi

set +e
cd "$SCRIPT_DIR"

if [ "$1" = "--headless" ]; then
    nohup "$NODE_BIN" "$SCRIPT_DIR/shim.js" > /dev/null 2>&1 &
    NODE_PID=$!
    disown $NODE_PID
    echo "Running headless (PID: $NODE_PID). Logs: $SCRIPT_DIR/data/shim.log"
    echo "Stop with: kill $NODE_PID"
    exit 0
else
    "$NODE_BIN" "$SCRIPT_DIR/shim.js" &
    NODE_PID=$!
    trap 'kill $NODE_PID 2>/dev/null' INT TERM
    wait $NODE_PID
fi

EXIT_CODE=$?
set -e
if [ $EXIT_CODE -ne 0 ]; then
    echo "" >&2
    echo "Shim exited with error code $EXIT_CODE" >&2
fi
exit $EXIT_CODE
