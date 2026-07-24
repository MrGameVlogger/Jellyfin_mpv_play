module.exports = {
    // Jellyfin server URL (e.g., http://192.168.1.100:8096)
    serverUrl: 'http://YOUR_JELLYFIN_IP:8096',
    
    // Your Jellyfin username
    username: 'your_username',
    
    // Your Jellyfin password
    password: 'your_password',
    
    // Full path to MPV executable
    // Windows example: 'C:\\Program Files\\mpv\\mpv.exe'
    // macOS example: '/opt/homebrew/bin/mpv' or '/usr/local/bin/mpv'
    // Linux example: '/usr/bin/mpv'
    mpvPath: 'C:\\path\\to\\mpv.exe',
    
    // Device name (will appear in Jellyfin's device list)
    deviceName: 'My-MPV-Player',
    
    // Any name, but different from the one you put in deviceName
    deviceId: 'My-MPV-room',
    
    // IPC socket path (optional — defaults to platform-appropriate path)
    // Windows default: '\\\\.\\pipe\\mpv-ipc'
    // macOS/Linux default: '/tmp/mpv-ipc.sock'
    // ipcSocketPath: '/tmp/mpv-ipc.sock'
};