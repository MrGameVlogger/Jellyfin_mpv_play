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

set +e
cd "$SCRIPT_DIR"
"$NODE_BIN" "$SCRIPT_DIR/shim.js" &
NODE_PID=$!
trap 'kill $NODE_PID 2>/dev/null' INT TERM
wait $NODE_PID
EXIT_CODE=$?
set -e
if [ $EXIT_CODE -ne 0 ]; then
    echo "" >&2
    echo "Shim exited with error code $EXIT_CODE" >&2
fi
exit $EXIT_CODE
