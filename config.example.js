module.exports = {
    // Jellyfin server URL (e.g., http://192.168.1.100:8096)
    serverUrl: '',
    
    // Your Jellyfin username
    username: '',
    
    // Your Jellyfin password
    password: '',
    
    // Full path to MPV executable
    mpvPath: '/opt/homebrew/bin/mpv',
    
    // Device name (will appear in Jellyfin's device list)
    deviceName: 'Mac',
    
    // Any name, but different from the one you put in deviceName
    deviceId: 'mac-mpv',
    
    // IPC socket path (optional — defaults to /tmp/mpv-ipc.sock)
    // ipcSocketPath: '/tmp/mpv-ipc.sock'
};