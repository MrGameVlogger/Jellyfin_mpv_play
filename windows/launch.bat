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

:: Resolve MPV path: prefer configured mpvPath, fall back to PATH
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

set "MPV_PATH="
set "MPV_CONFIG="
for /f "usebackq delims=" %%P in (`"%NODE_BIN%" -e "try { const c=require(process.argv[1]); process.stdout.write(c.mpvPath||''); } catch(e) { process.exit(2) }" "%CONFIG_FILE%" 2^>nul`) do set "MPV_CONFIG=%%P"

if defined MPV_CONFIG (
    if exist "%MPV_CONFIG%" (
        set "MPV_PATH=%MPV_CONFIG%"
    ) else if exist "%SCRIPT_DIR%\%MPV_CONFIG%" (
        set "MPV_PATH=%SCRIPT_DIR%\%MPV_CONFIG%"
    )
)

if not defined MPV_PATH (
    for /f "delims=" %%P in ('where mpv 2^>nul') do if not defined MPV_PATH set "MPV_PATH=%%P"
)

if not defined MPV_PATH (
    echo ERROR: mpv not found. >&2
    if defined MPV_CONFIG echo Configured path not found: "%MPV_CONFIG%" >&2
    echo Download MPV from https://mpv.io/installation and either: >&2
    echo   - Add it to your PATH, or >&2
    echo   - Set mpvPath in config.js to the full path of mpv.exe >&2
    pause
    exit /b 1
)

if not exist "%MPV_PATH%" (
    echo ERROR: MPV executable not found: "%MPV_PATH%" >&2
    pause
    exit /b 1
)

set "JELLYFIN_MPV_PATH=%MPV_PATH%"

:: Check for headless mode
set "IS_HEADLESS=false"
if "%~1"=="--headless" set "IS_HEADLESS=true"
if "%IS_HEADLESS%"=="false" (
    findstr /i /r "headless.*true" "%CONFIG_FILE%" >nul 2>nul
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
