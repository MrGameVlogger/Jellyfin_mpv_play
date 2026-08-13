@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "CONFIG_FILE=%SCRIPT_DIR%config.js"
set "EXAMPLE_CONFIG=%SCRIPT_DIR%config.example.js"

if not exist "%CONFIG_FILE%" (
    if exist "%EXAMPLE_CONFIG%" (
        copy "%EXAMPLE_CONFIG%" "%CONFIG_FILE%" >nul
        echo First run: created config.js from config.example.js
        echo Please edit %CONFIG_FILE% with your Jellyfin server details and MPV path, then run this again.
        pause
        exit /b 0
    ) else (
        echo ERROR: config.example.js not found. Bundle may be corrupted.
        pause
        exit /b 1
    )
)

where mpv >nul 2>nul
if errorlevel 1 (
    echo ERROR: mpv is not installed or not in PATH.
    echo Download MPV from https://mpv.io/installation and add it to your PATH.
    pause
    exit /b 1
)

set "NODE_BIN=%SCRIPT_DIR%node\node.exe"
if not exist "%NODE_BIN%" (
    echo ERROR: Bundled Node.js not found at %NODE_BIN%
    echo Bundle may be corrupted. Please re-download.
    pause
    exit /b 1
)

"%NODE_BIN%" "%SCRIPT_DIR%shim.js"
if errorlevel 1 (
    echo.
    echo Shim exited with an error.
    pause
)

endlocal
