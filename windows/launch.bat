@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "CONFIG_FILE=%SCRIPT_DIR%\config.js"
set "EXAMPLE_CONFIG=%SCRIPT_DIR%\config.example.js"

if not exist "%CONFIG_FILE%" (
    if exist "%EXAMPLE_CONFIG%" (
        copy "%EXAMPLE_CONFIG%" "%CONFIG_FILE%" >nul
        if errorlevel 1 (
            echo ERROR: Failed to create config.js >&2
            pause
            exit /b 1
        )
        echo First run: created config.js from config.example.js
        echo Please edit "%CONFIG_FILE%" with your Jellyfin server details and MPV path, then run this again.
        pause
        exit /b 0
    ) else (
        echo ERROR: config.example.js not found. Bundle may be corrupted. >&2
        pause
        exit /b 1
    )
)

where mpv >nul 2>nul
if errorlevel 1 (
    echo ERROR: mpv is not installed or not in PATH. >&2
    echo Download MPV from https://mpv.io/installation and add it to your PATH. >&2
    pause
    exit /b 1
)

set "NODE_BIN=%SCRIPT_DIR%\node\node.exe"
if not exist "%NODE_BIN%" (
    echo ERROR: Bundled Node.js not found at "%NODE_BIN%" >&2
    echo Bundle may be corrupted. Please re-download. >&2
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%\shim.js" (
    echo ERROR: shim.js not found in "%SCRIPT_DIR%" >&2
    echo Bundle may be corrupted. Please re-download. >&2
    pause
    exit /b 1
)

:: Check for headless mode
set "IS_HEADLESS=false"
if "%~1"=="--headless" set "IS_HEADLESS=true"
if "%IS_HEADLESS%"=="false" (
    findstr /i "headless.*true" "%CONFIG_FILE%" >nul 2>nul
    if not errorlevel 1 set "IS_HEADLESS=true"
)

if "%IS_HEADLESS%"=="true" (
    echo Running headless. Logs: %SCRIPT_DIR%\data\shim.log
    start "" /B "%NODE_BIN%" "%SCRIPT_DIR%\shim.js"
    exit /b 0
)

"%NODE_BIN%" "%SCRIPT_DIR%\shim.js"
if errorlevel 1 (
    echo.
    echo Shim exited with an error.
    pause
)

endlocal
