#!/bin/bash

set -e

APP_NAME="Jellyfin MPV Play"
BUILD_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$BUILD_DIR")"
APP_BUNDLE="$PROJECT_DIR/$APP_NAME.app"
SOURCES_DIR="$BUILD_DIR/Sources"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"

NODE_VERSION="22.23.1"
NODE_DIR="$RESOURCES_DIR/node"

echo "Building $APP_NAME..."

# Clean old build
rm -rf "$APP_BUNDLE"

# Create .app bundle structure
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$RESOURCES_DIR"

# Copy Info.plist
cp "$BUILD_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

# Copy app icon
cp "$BUILD_DIR/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"

# Bundle JS files into Resources
echo "Bundling JS files..."
cp "$PROJECT_DIR/shim.js" "$RESOURCES_DIR/shim.js"
cp "$PROJECT_DIR/config.example.js" "$RESOURCES_DIR/config.example.js"
cp -R "$PROJECT_DIR/node_modules" "$RESOURCES_DIR/node_modules"

# Download and bundle Node.js
echo "Bundling Node.js v$NODE_VERSION..."
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    NODE_ARCH="arm64"
else
    NODE_ARCH="x64"
fi
NODE_TAR="node-v$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/$NODE_TAR"
NODE_TMP="$PROJECT_DIR/.node-tmp"

rm -rf "$NODE_TMP"
mkdir -p "$NODE_TMP"

echo "Downloading $NODE_URL..."
curl -fL "$NODE_URL" -o "$NODE_TMP/$NODE_TAR"
echo "Extracting..."
tar -xzf "$NODE_TMP/$NODE_TAR" -C "$NODE_TMP"
mv "$NODE_TMP/node-v$NODE_VERSION-darwin-$NODE_ARCH" "$NODE_DIR"
rm -rf "$NODE_TMP"

# Make node executable
chmod +x "$NODE_DIR/bin/node"

# Remove unnecessary npm/corepack to reduce bundle size
rm -rf "$NODE_DIR/lib/node_modules/npm" "$NODE_DIR/lib/node_modules/corepack" 2>/dev/null || true
rm -f "$NODE_DIR/bin/npm" "$NODE_DIR/bin/npx" "$NODE_DIR/bin/corepack" 2>/dev/null || true

echo "Node.js bundled: $NODE_DIR/bin/node ($(uname -m))"

# Compile Swift sources
echo "Compiling Swift sources..."
swiftc \
    -sdk "$(xcrun --show-sdk-path)" \
    -framework Cocoa \
    -framework UserNotifications \
    -O \
    "$SOURCES_DIR"/*.swift \
    -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

echo "Build complete: $APP_BUNDLE"
echo "Run with: open \"$APP_BUNDLE\""

# Deploy to /Applications (skip in CI)
if [ -n "$CI" ]; then
    echo "CI environment detected, skipping deploy to /Applications."
else
    DEPLOY_PATH="/Applications/$APP_NAME.app"
    APP_PID=$(pgrep -f "$APP_BUNDLE/Contents/MacOS/$APP_NAME" 2>/dev/null || true)
    if [ -n "$APP_PID" ]; then
        kill "$APP_PID" 2>/dev/null || true
        for i in $(seq 1 10); do
            kill -0 "$APP_PID" 2>/dev/null || break
            sleep 0.5
        done
        kill -9 "$APP_PID" 2>/dev/null || true
    fi
    rm -rf "$DEPLOY_PATH"
    if cp -R "$APP_BUNDLE" "$DEPLOY_PATH" 2>/dev/null; then
        echo "Deployed to: $DEPLOY_PATH"
    else
        echo "WARNING: Could not deploy to /Applications (permission denied). Run with sudo or copy manually:"
        echo "  cp -R \"$APP_BUNDLE\" \"$DEPLOY_PATH\""
    fi
fi
