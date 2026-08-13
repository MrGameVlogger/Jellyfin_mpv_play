#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.js"
EXAMPLE_CONFIG="$SCRIPT_DIR/config.example.js"

if [ ! -f "$CONFIG_FILE" ]; then
    if [ -f "$EXAMPLE_CONFIG" ]; then
        cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
        echo "First run: created config.js from config.example.js"
        echo "Please edit $CONFIG_FILE with your Jellyfin server details and MPV path, then run this again."
        exit 0
    else
        echo "ERROR: config.example.js not found. Bundle may be corrupted."
        exit 1
    fi
fi

if ! command -v mpv &>/dev/null; then
    echo "ERROR: mpv is not installed or not in PATH."
    echo "Install it with your package manager, e.g.:"
    echo "  Ubuntu/Debian:  sudo apt install mpv"
    echo "  Fedora:         sudo dnf install mpv"
    echo "  Arch:           sudo pacman -S mpv"
    exit 1
fi

NODE_BIN="$SCRIPT_DIR/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
    echo "ERROR: Bundled Node.js not found at $NODE_BIN"
    echo "Bundle may be corrupted. Please re-download."
    exit 1
fi

trap 'echo ""; echo "Shutting down..."; exit 0' INT TERM

exec "$NODE_BIN" "$SCRIPT_DIR/shim.js"
