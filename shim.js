const { WebSocket } = require('ws');
const axios = require('axios');
const { spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');
const path = require('path');

const userConfig = require('./config.js');
const pkg = require('./package.json');

const CONFIG = {
    serverUrl: userConfig.serverUrl,
    username: userConfig.username,
    password: userConfig.password,
    mpvPath: userConfig.mpvPath,
    deviceName: userConfig.deviceName,
    deviceId: userConfig.deviceId || generateOrLoadDeviceId(),
    
    clientVersion: pkg.version,
    ipcSocketPath: userConfig.ipcSocketPath || (process.platform === 'win32' ? '\\\\.\\pipe\\mpv-ipc' : '/tmp/mpv-ipc.sock'),
    mpvLoadDelayMs: 100
};

const TOKEN_FILE = path.join(__dirname, 'data', `jellyfin_token_${CONFIG.deviceId}.json`);
const POSITIONS_FILE = path.join(__dirname, 'data', `playback_positions_${CONFIG.deviceId}.json`);

let mpvProcess = null;
let currentItemId = null;
let progressInterval = null;
let ipcClient = null;
let currentEpisodeInfo = null;
let ipcCommandId = 1;
let playSessionId = null;
let currentPositionSeconds = 0;
let isReportingStop = false;
let accessToken = null;
let userId = null;
let ws = null;
let reconnectInterval = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let keepAliveInterval = null;

let pendingStreamUrl = null;
let pendingStartSeconds = 0;
let pendingTitle = null;
let pendingAudioStreamIndex = undefined;
let pendingSubtitleStreamIndex = undefined;
let playbackGeneration = 0;
let isMpvPaused = false;
let isMuted = false;
let volumeLevel = 100;
let isPlayingNext = false;
let currentDuration = 0;
let progressPollTimer = null;
const pendingQueries = new Map();
const markedWatched = new Set();

function generateOrLoadDeviceId() {
    const idFile = path.join(__dirname, 'data', '.device-id');
    try {
        if (fs.existsSync(idFile)) {
            return fs.readFileSync(idFile, 'utf8').trim();
        }
    } catch {}
    const id = `mpv-${crypto.randomBytes(8).toString('hex')}`;
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        fs.writeFileSync(idFile, id);
    } catch {}
    return id;
}

function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const data = fs.readFileSync(TOKEN_FILE, 'utf8');
            const tokenData = JSON.parse(data);
            if (tokenData.AccessToken && tokenData.User?.Id) {
                accessToken = tokenData.AccessToken;
                userId = tokenData.User.Id;
                console.log('✅ Saved token loaded successfully');
                return true;
            }
            console.log('⚠️ Token file missing required fields, re-authenticating');
        }
    } catch (error) {
        console.error('⚠️ Error loading saved token:', error.message);
    }
    return false;
}

function saveToken(authResponse) {
    try {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(authResponse, null, 2), { mode: 0o600 });
        accessToken = authResponse.AccessToken;
        userId = authResponse.User?.Id;
        console.log('💾 Token saved successfully');
    } catch (error) {
        console.error('⚠️ Error saving token:', error.message);
    }
}

async function authenticateUser() {
    try {
        console.log('🔐 Authenticating user...');
        
        const authHeader = `MediaBrowser Client="${CONFIG.deviceName}", Device="${CONFIG.deviceName}", DeviceId="${CONFIG.deviceId}", Version="${CONFIG.clientVersion}"`;
        
        const response = await axios.post(
            `${CONFIG.serverUrl}/Users/AuthenticateByName`,
            {
                Username: CONFIG.username,
                Pw: CONFIG.password
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Emby-Authorization': authHeader
                }
            }
        );

        saveToken(response.data);
        console.log(`✅ Authentication successful for user: ${CONFIG.username}`);
        console.log(`🆔 User ID: ${userId}`);
        return true;
    } catch (error) {
        console.error('❌ Authentication error:', error.message);
        if (error.response) {
            console.error('📄 Details:', error.response.status, error.response.data);
        }
        return false;
    }
}

function loadPlaybackPositions() {
    try {
        if (fs.existsSync(POSITIONS_FILE)) {
            const data = fs.readFileSync(POSITIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('⚠️ Error loading saved positions:', error.message);
    }
    return {};
}

function savePlaybackPosition(itemId, positionTicks) {
    try {
        const positions = loadPlaybackPositions();
        positions[itemId] = {
            positionTicks: positionTicks,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
        console.log(`💾 Position saved locally: ${(positionTicks / 10000000).toFixed(2)}s for ${itemId}`);
    } catch (error) {
        console.error('⚠️ Error saving position:', error.message);
    }
}

function getAuthHeaders() {
    return {
        'X-Emby-Token': accessToken,
        'X-Emby-Authorization': `MediaBrowser Client="${CONFIG.deviceName}", Device="${CONFIG.deviceName}", DeviceId="${CONFIG.deviceId}", Version="${CONFIG.clientVersion}"`
    };
}

async function connectWebSocket() {
    if (isReconnecting) {
        return;
    }
    
    isReconnecting = true;
    
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }

    if (ws) {
        try {
            ws.removeAllListeners();
            ws.close();
        } catch (e) {
        }
        ws = null;
    }
    
    const wsUrl = CONFIG.serverUrl.replace(/^http/, 'ws') + `/socket?api_key=${accessToken}&deviceId=${CONFIG.deviceId}`;
    
    console.log('🔌 Connecting to Jellyfin...');
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            console.log('✅ WebSocket connection established.');
            isReconnecting = false;
            reconnectAttempts = 0;
            
            const msg = {
                MessageType: "SessionsStart",
                Data: "0,1500"
            };
            ws.send(JSON.stringify(msg));
            console.log('📤 SessionsStart message sent');
            reportCapabilities();
            
            keepAliveInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
                    } catch (e) {
                        console.error('⚠️ Error sending keep-alive:', e.message);
                    }
                }
            }, 30000);
            
            if (reconnectInterval) {
                clearTimeout(reconnectInterval);
                reconnectInterval = null;
            }
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.MessageType !== 'KeepAlive' && msg.MessageType !== 'ForceKeepAlive') {
                    console.log('📩 Message received:', msg.MessageType);
                }
                handleMessage(msg);
            } catch (e) {
                console.error('⚠️ Error parsing message:', e.message);
            }
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
            isReconnecting = false;
        });

        ws.on('close', () => {
            console.log('❌ Disconnected from server.');
            isReconnecting = false;
            
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
            
            scheduleReconnect();
        });
        
    } catch (error) {
        console.error('❌ Error creating WebSocket:', error.message);
        isReconnecting = false;
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectInterval) {
        return;
    }
    
    reconnectAttempts++;
    let delaySeconds = Math.min(30, 5 * Math.pow(2, reconnectAttempts - 1));
    if (reconnectAttempts === 1) delaySeconds = 5;
    
    console.log(`🔄 Scheduling automatic reconnection in ${delaySeconds} seconds (Attempt ${reconnectAttempts})...`);
    
    reconnectInterval = setTimeout(async () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            clearTimeout(reconnectInterval);
            reconnectInterval = null;
            return;
        }

        try {
            console.log('📡 Checking network connection before reconnecting...');
            const headers = getAuthHeaders();
            await axios.get(`${CONFIG.serverUrl}/System/Info`, { 
                headers,
                timeout: 3000
            });
            
            console.log('✅ Network connection active. Attempting WebSocket reconnection...');
            await connectWebSocket();
            
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.log('🔐 Token expired, reauthenticating...');
                const authenticated = await authenticateUser();
                if (authenticated) {
                    await connectWebSocket();
                } else {
                    console.error('❌ Reauthentication failed. Waiting for next attempt.');
                    clearTimeout(reconnectInterval);
                    reconnectInterval = null;
                    scheduleReconnect();
                }
            } else {
                console.log(`⚠️ Server unavailable or network down. Retrying in ${delaySeconds}s...`);
                clearTimeout(reconnectInterval);
                reconnectInterval = null;
                scheduleReconnect();
            }
        }
    }, delaySeconds * 1000);
}

function reportCapabilities() {
    const payload = {
        PlayableMediaTypes: ["Audio", "Video"],
        SupportedCommands: [
            "Play",
            "PlayState",
            "PlayNext",
            "SetAudioStreamIndex",
            "SetSubtitleStreamIndex",
            "SetRepeatMode",
            "SetPlaybackOrder",
            "Mute",
            "Unmute",
            "ToggleMute",
            "VolumeUp",
            "VolumeDown",
            "SetVolume",
            "DisplayMessage",
            "ToggleFullscreen"
        ],
        SupportsMediaControl: true,
        SupportsPersistentIdentifier: true,
        SupportsSync: false,
        SupportsContentUploading: false,
        SupportsRemoteControl: true
    };

    axios.post(`${CONFIG.serverUrl}/Sessions/Capabilities/Full`, payload, { 
        headers: getAuthHeaders()
    })
        .catch(err => {
            if (err.response && err.response.status !== 401) {
                console.error('❌ Error registering capabilities:', err.message);
            }
        });
}

async function handleMessage(msg) {
    if (msg.MessageType === "Play") {
        console.log('▶️ PLAY command received from web!');
        const data = msg.Data || {};
        const itemIds = data.ItemIds || [];
        const hasStartPosition = 'StartPositionTicks' in data;
        const startPosition = hasStartPosition ? data.StartPositionTicks : null;
        const playCommand = data.PlayCommand || 'PlayNow';
        
        console.log('📋 Play command data:', { itemIds, startPositionTicks: startPosition, hasStartPosition, playCommand });
        
        if (itemIds.length > 0) {
            let finalStartPosition = 0;
            if (hasStartPosition) {
                finalStartPosition = startPosition || 0;
                if (startPosition === 0) {
                    console.log('🎯 Playing from beginning');
                } else {
                    console.log(`🎯 Resume position from server: ${(startPosition / 10000000).toFixed(2)}s`);
                }
            } else {
                console.log('🎯 No start position in message, playing from beginning');
            }
            
            let orderedItems = [...itemIds];
            if (playCommand === 'PlayShuffle') {
                for (let i = orderedItems.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [orderedItems[i], orderedItems[j]] = [orderedItems[j], orderedItems[i]];
                }
                console.log('🔀 Shuffled playlist');
            } else if (playCommand === 'PlayNext' || playCommand === 'PlayLast') {
                console.log(`ℹ️ ${playCommand} not supported, playing now`);
            } else if (playCommand === 'PlayInstantMix') {
                console.log('ℹ️ PlayInstantMix not supported, playing first item');
            }
            
            const startIndex = data.StartIndex || 0;
            let targetId = orderedItems[startIndex] || orderedItems[0];
            
            if (startIndex > 0) {
                console.log(`🎯 Starting from index ${startIndex}`);
            } else if (orderedItems.length > 1 && !hasStartPosition && playCommand !== 'PlayShuffle') {
                const firstInfo = await getEpisodeInfo(orderedItems[0]);
                if (firstInfo.isSeries && firstInfo.seriesId) {
                    try {
                        const headers = getAuthHeaders();
                        const nextUpResponse = await axios.get(`${CONFIG.serverUrl}/Shows/NextUp`, {
                            headers,
                            params: { userId, seriesId: firstInfo.seriesId, limit: 1 }
                        });
                        if (nextUpResponse.data.Items && nextUpResponse.data.Items.length > 0) {
                            targetId = nextUpResponse.data.Items[0].Id;
                            console.log(`🎯 Next Up from Jellyfin: ${nextUpResponse.data.Items[0].Name}`);
                        }
                    } catch (e) {
                        console.log('⚠️ Next Up query failed, falling back to first unwatched');
                    }
                }
                if (targetId === (orderedItems[startIndex] || orderedItems[0])) {
                    for (const id of orderedItems) {
                        const info = await getEpisodeInfo(id);
                        if (info.playable && !info.userData?.Played) {
                            targetId = id;
                            console.log(`🎯 Playing first unwatched: ${info.title}`);
                            break;
                        }
                    }
                }
            }
            
            if (data.AudioStreamIndex !== undefined) {
                pendingAudioStreamIndex = data.AudioStreamIndex;
            }
            if (data.SubtitleStreamIndex !== undefined) {
                pendingSubtitleStreamIndex = data.SubtitleStreamIndex === -1 ? 'no' : data.SubtitleStreamIndex;
            }

            playMedia(targetId, finalStartPosition).catch(err => {
                console.error('⚠️ Error playing media:', err.message);
            });
        } else {
            console.error('⚠️ No ItemIds received in Play command');
        }
    } 
    else if (msg.MessageType === "Playstate") {
        const data = msg.Data || {};
        const command = data.Command;
        console.log(`⏯️ State command received: ${command}`);
        
        if (command === 'Stop') {
            if (currentItemId && !isReportingStop) {
                reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
            }
            killMpv();
        } else if (command === 'Pause') {
            sendMpvCommand('set_property', ['pause', true]);
        } else if (command === 'Unpause') {
            sendMpvCommand('set_property', ['pause', false]);
        } else if (command === 'PlayPause') {
            sendMpvCommand('set_property', ['pause', !isMpvPaused]);
        } else if (command === 'NextTrack') {
            playNextEpisode();
        } else if (command === 'PreviousTrack') {
            playPreviousEpisode();
        } else if (command === 'Seek') {
            if (data.SeekPositionTicks !== undefined) {
                const seekSeconds = data.SeekPositionTicks / 10000000;
                sendMpvCommand('seek', [seekSeconds, 'absolute']);
                console.log(`⏩ Seek requested to ${seekSeconds.toFixed(2)}s`);
                currentPositionSeconds = seekSeconds;
                if (currentItemId) reportPlaybackProgress(currentItemId, data.SeekPositionTicks);
            }
        } else if (command === 'Rewind') {
            sendMpvCommand('seek', [-10, 'relative']);
            console.log('⏪ Rewind 10s');
        } else if (command === 'FastForward') {
            sendMpvCommand('seek', [10, 'relative']);
            console.log('⏩ Fast forward 10s');
        }
    }
    else if (msg.MessageType === "GeneralCommand") {
        const data = msg.Data || {};
        const command = data.Name;
        const args = data.Arguments || {};
        console.log(`🎛️ General command received: ${command}`);
        
        if (command === 'SetAudioStreamIndex') {
            const index = parseInt(args.Index, 10);
            if (!isNaN(index)) sendMpvCommand('set_property', ['aid', index]);
        } else if (command === 'SetSubtitleStreamIndex') {
            const index = parseInt(args.Index, 10);
            sendMpvCommand('set_property', ['sid', isNaN(index) || index === -1 ? 'no' : index]);
        } else if (command === 'SetVolume') {
            const vol = parseInt(args.Volume, 10);
            if (!isNaN(vol)) sendMpvCommand('set_property', ['volume', vol]);
        } else if (command === 'VolumeUp') {
            sendMpvCommand('add_property', ['volume', 5]);
        } else if (command === 'VolumeDown') {
            sendMpvCommand('add_property', ['volume', -5]);
        } else if (command === 'Mute') {
            sendMpvCommand('set_property', ['mute', true]);
        } else if (command === 'Unmute') {
            sendMpvCommand('set_property', ['mute', false]);
        } else if (command === 'ToggleMute') {
            sendMpvCommand('set_property', ['mute', !isMuted]);
        } else if (command === 'SetRepeatMode') {
            const mode = args.RepeatMode;
            if (mode === 'RepeatAll') sendMpvCommand('set_property', ['loop-playlist', 'inf']);
            else if (mode === 'RepeatOne') sendMpvCommand('set_property', ['loop-file', 'inf']);
            else { sendMpvCommand('set_property', ['loop-playlist', 'no']); sendMpvCommand('set_property', ['loop-file', 'no']); }
        } else if (command === 'SetPlaybackOrder') {
            const order = args.PlaybackOrder;
            if (order === 'Shuffle') sendMpvCommand('set_property', ['shuffle', true]);
            else sendMpvCommand('set_property', ['shuffle', false]);
        } else if (command === 'DisplayMessage') {
            const header = args.Header || '';
            const text = args.Text || '';
            console.log(`💬 Jellyfin message: ${header} - ${text}`);
        } else if (command === 'PlayNext') {
            playNextEpisode();
        } else if (command === 'ToggleFullscreen') {
            sendMpvCommand('cycle', ['fullscreen']);
        }
    }
    else if (msg.MessageType === "RestartRequired") {
        console.log('🔄 Server requires restart');
    }
    else if (msg.MessageType === "ServerShuttingDown") {
        console.log('🔴 Server is shutting down');
    }
    else if (msg.MessageType === "ServerRestarting") {
        console.log('🔄 Server is restarting, will reconnect...');
    }
}

async function getEpisodeInfo(itemId) {
    try {
        const headers = getAuthHeaders();
        
        const response = await axios.get(`${CONFIG.serverUrl}/Users/${userId}/Items/${itemId}`, { headers });
        const item = response.data;

        if (item.Type === 'Episode') {
            const seasonResponse = await axios.get(`${CONFIG.serverUrl}/Shows/${item.SeriesId}/Episodes`, {
                headers,
                params: {
                    seasonId: item.SeasonId,
                    userId: userId,
                    fields: 'Path,IndexNumber,ParentIndexNumber,SeriesName,Name,UserData'
                }
            });

            const episodes = [...seasonResponse.data.Items].sort((a, b) => a.IndexNumber - b.IndexNumber);
            const currentIndex = episodes.findIndex(ep => ep.Id === itemId);
            const epName = currentIndex >= 0 ? (episodes[currentIndex].Name || '') : (item.Name || '');
            const epLogTitle = [item.SeriesName, `${item.ParentIndexNumber}x${item.IndexNumber}`, epName].filter(Boolean).join(' - ');
            console.log(`📺 Episode detected: ${epLogTitle}`);

            return {
                isSeries: true,
                playable: true,
                seriesId: item.SeriesId,
                currentIndex,
                episodes,
                nextEpisode: currentIndex >= 0 && currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null,
                previousEpisode: currentIndex > 0 ? episodes[currentIndex - 1] : null,
                seriesName: item.SeriesName,
                seasonNumber: item.ParentIndexNumber,
                episodeNumber: item.IndexNumber,
                title: epName,
                itemRuntime: item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0,
                userData: item.UserData || {}
            };
        }

        const playableTypes = ['Episode', 'Movie', 'Video', 'MusicVideo', 'Audio'];
        return {
            isSeries: false,
            playable: playableTypes.includes(item.Type),
            title: item.Name || 'Movie/Music',
            itemRuntime: item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0,
            userData: item.UserData || {}
        };
    } catch (error) {
        console.error('⚠️ Error getting episode info:', error.message);
        return { isSeries: false, playable: false };
    }
}

async function playMedia(itemId, startTicks) {
    killMpv();
    isReportingStop = false;
    
    playbackGeneration++;
    const gen = playbackGeneration;

    currentItemId = itemId;
    currentPositionSeconds = startTicks / 10000000;
    currentEpisodeInfo = await getEpisodeInfo(itemId);

    if (gen !== playbackGeneration) return;

    if (!currentEpisodeInfo.playable) {
        console.log(`⏭️ Skipping non-playable item: ${currentEpisodeInfo.title} (type: ${currentEpisodeInfo.isSeries ? 'series' : 'other'})`);
        currentItemId = null;
        currentEpisodeInfo = null;
        return;
    }

    playSessionId = crypto.randomUUID();

    pendingStreamUrl = `${CONFIG.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${accessToken}`;
    pendingStartSeconds = startTicks / 10000000;

    console.log('🍿 Launching MPV (Idle Mode)...');
    console.log(`    Item ID: ${itemId}`);
    console.log(`    Stream URL: ${CONFIG.serverUrl}/Videos/${itemId}/stream?static=true&api_key=***`);
    console.log(`    MPV Path: ${CONFIG.mpvPath}`);

    const titleText = currentEpisodeInfo.isSeries 
        ? [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${currentEpisodeInfo.episodeNumber}`, currentEpisodeInfo.title].filter(Boolean).join(' - ')
        : (currentEpisodeInfo.title || String(itemId));
    
    const args = [
        '--idle=yes',
        '--force-window=immediate',
        `--force-media-title=Jellyfin - ${titleText}`,
        `--title=Jellyfin - ${titleText}`,
        '--keep-open=yes',
        `--input-ipc-server=${CONFIG.ipcSocketPath}`,
        '--save-position-on-quit=no'
    ];

    console.log('🔧 MPV arguments:', args.join(' '));

    try {
        mpvProcess = spawn(CONFIG.mpvPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false
        });
        
        console.log(`✅ MPV started with PID: ${mpvProcess.pid}`);

        reportPlaybackStart(itemId, startTicks);
        startProgressReporting(itemId);

        setTimeout(() => {
            if (gen === playbackGeneration) {
                connectToMpvIpc(gen);
            }
        }, 500);

        mpvProcess.stdout.on('data', (data) => { 
            const line = data.toString().trim();
            if (line && !line.startsWith('AV:')) {
                console.log(`MPV: ${line}`);
            }
        });
        
        mpvProcess.stderr.on('data', (data) => { 
            console.error(`MPV stderr: ${data.toString().trim()}`); 
        });

        mpvProcess.on('error', (err) => {
            console.error('❌ Error executing MPV:', err.message);
            console.error('   Check mpvPath configuration:', CONFIG.mpvPath);
        });

        mpvProcess.on('close', (code, signal) => {
            if (gen !== playbackGeneration) return;

            console.log(`🛑 MPV closed (code ${code}, signal: ${signal})`);
            
            if (code === 1) {
                console.error('⚠️ MPV closed with error. Possible causes:');
                console.error('   - Command line argument issue');
                console.error('   - Cannot create window');
                console.error('   - Video driver problem');
                console.error('   - Insufficient permissions');
            }
            
            if (currentItemId && currentPositionSeconds > 0) {
                const positionTicks = Math.round(currentPositionSeconds * 10000000);
                savePlaybackPosition(currentItemId, positionTicks);
            }
            if (currentItemId && !isReportingStop) {
                const runtime = currentEpisodeInfo?.itemRuntime || 0;
                const completionThreshold = 0.9;
                if (runtime > 0 && currentPositionSeconds >= runtime * completionThreshold) {
                    markItemAsWatched(currentItemId);
                }
                reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
            }
            mpvProcess = null;
            stopProgressPoll();
            for (const [, q] of pendingQueries) q.resolve(null);
            pendingQueries.clear();
            if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
            if (ipcClient) { ipcClient.destroy(); ipcClient = null; }
            currentItemId = null;
            currentEpisodeInfo = null;
            isReportingStop = false;
        });
    } catch (err) {
        console.error('❌ Critical error executing MPV:', err);
        console.error('   Stack:', err.stack);
    }
}

function connectToMpvIpc(gen) {
    if (ipcClient) {
        ipcClient.destroy();
    }

    let connectionAttempts = 0;
    const maxAttempts = 10;
    const retryDelay = 500;

    function attemptConnection() {
        if (gen !== playbackGeneration) return;
        connectionAttempts++;
        
        if (!mpvProcess || mpvProcess.exitCode !== null) {
            console.error('❌ MPV not running, canceling IPC connection');
            return;
        }

        console.log(`🔗 Attempting to connect to MPV IPC (attempt ${connectionAttempts}/${maxAttempts})...`);
        
        ipcClient = net.connect(CONFIG.ipcSocketPath);
        let buffer = '';

        ipcClient.on('connect', () => {
            console.log('✅ Connected to MPV IPC');

            setTimeout(() => {
                if (pendingStreamUrl && gen === playbackGeneration) {
                    console.log('📡 Sending LOADFILE command...');
                    sendMpvCommand('loadfile', [pendingStreamUrl, 'replace']); 
                    console.log('    ✅ Load command sent.');

                    if (pendingAudioStreamIndex !== undefined) {
                        sendMpvCommand('set_property', ['aid', pendingAudioStreamIndex]);
                        pendingAudioStreamIndex = undefined;
                    }
                    if (pendingSubtitleStreamIndex !== undefined) {
                        sendMpvCommand('set_property', ['sid', pendingSubtitleStreamIndex]);
                        pendingSubtitleStreamIndex = undefined;
                    }
                }
            }, CONFIG.mpvLoadDelayMs);

            sendMpvCommand('observe_property', [1, 'time-pos']);
            sendMpvCommand('observe_property', [2, 'pause']);
            sendMpvCommand('observe_property', [3, 'mute']);
            sendMpvCommand('observe_property', [4, 'volume']);
            
            sendMpvCommand('keybind', ['NEXT', 'script-message jellyfin-next']);
            sendMpvCommand('keybind', ['PREV', 'script-message jellyfin-prev']);
            sendMpvCommand('keybind', ['>', 'script-message jellyfin-next']);
            sendMpvCommand('keybind', ['<', 'script-message jellyfin-prev']);
            console.log('⌨️ Keys bound (NEXT/PREV/>/< overridden for Jellyfin remote control)');
        });

        ipcClient.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            lines.forEach(line => {
                if (line.trim()) {
                    try {
                        const response = JSON.parse(line);

                        if (response.request_id !== undefined && pendingQueries.has(response.request_id)) {
                            const query = pendingQueries.get(response.request_id);
                            pendingQueries.delete(response.request_id);
                            query.resolve(response.error === 'success' ? response.data : null);
                            return;
                        }

                        handleMpvEvent(response);
                        
                        if (response.error && response.error !== 'success') {
                            console.error('⚠️ MPV Error:', response.error, JSON.stringify(response.command));
                        }
                    } catch (e) {
                        console.error('⚠️ Failed to parse MPV IPC response:', line.substring(0, 200));
                    }
                }
            });
        });

        ipcClient.on('error', (err) => {
            console.error(`⚠️ IPC error (attempt ${connectionAttempts}):`, err.message);
            
            if (connectionAttempts < maxAttempts && mpvProcess && mpvProcess.exitCode === null) {
                console.log(`🔄 Retrying IPC connection in ${retryDelay}ms...`);
                setTimeout(attemptConnection, retryDelay);
            } else if (connectionAttempts >= maxAttempts) {
                console.error('❌ Maximum IPC connection attempts reached');
                if (currentItemId && !isReportingStop) {
                    reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
                }
                killMpv();
            }
        });

        ipcClient.on('close', () => {
            console.log('🔌 Disconnected from MPV IPC');
            for (const [, q] of pendingQueries) q.resolve(null);
            pendingQueries.clear();
            ipcClient = null;
        });
    }

    attemptConnection();
}

async function markItemAsWatched(itemId) {
    if (markedWatched.has(itemId)) return;
    markedWatched.add(itemId);
    try {
        const headers = getAuthHeaders();
        await axios.post(`${CONFIG.serverUrl}/Users/${userId}/PlayedItems/${itemId}`, {}, { headers });
        console.log('✅ Item marked as watched in Jellyfin');

        const positions = loadPlaybackPositions();
        if (positions[itemId]) {
            delete positions[itemId];
            fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
            console.log('🗑️ Local position cleared (content watched)');
        }
    } catch (error) {
        console.error('⚠️ Error marking item as watched:', error.message);
    }
}

function killMpv() {
    stopProgressPoll();
    for (const [, q] of pendingQueries) q.resolve(null);
    pendingQueries.clear();
    if (mpvProcess) {
        console.log('⏹️ Forcing previous MPV shutdown...');
        isReportingStop = true;
        mpvProcess.kill();
        mpvProcess = null;
    }
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    if (ipcClient) {
        ipcClient.destroy();
        ipcClient = null;
    }
    try {
        if (fs.existsSync(CONFIG.ipcSocketPath)) {
            fs.unlinkSync(CONFIG.ipcSocketPath);
        }
    } catch (e) {
        // ignore cleanup errors
    }
}

function sendMpvCommand(command, args = []) {
    if (!ipcClient || ipcClient.destroyed) {
        return;
    }

    const cmd = {
        command: [command, ...args],
        request_id: ipcCommandId++
    };

    try {
        const cmdStr = JSON.stringify(cmd) + '\n';
        ipcClient.write(cmdStr);
    } catch (e) {
        console.error('⚠️ Error sending command to MPV:', e.message);
    }
}

function queryProperty(property) {
    return new Promise((resolve) => {
        if (!ipcClient || ipcClient.destroyed) {
            resolve(null);
            return;
        }
        const requestId = ipcCommandId++;
        pendingQueries.set(requestId, { property, resolve });
        const cmd = { command: ['get_property', property], request_id: requestId };
        try {
            ipcClient.write(JSON.stringify(cmd) + '\n');
        } catch (e) {
            pendingQueries.delete(requestId);
            resolve(null);
        }
    });
}

function startProgressPoll() {
    stopProgressPoll();
    progressPollTimer = setInterval(async () => {
        if (!currentItemId) return;
        const pos = await queryProperty('time-pos');
        const dur = await queryProperty('duration');
        if (typeof pos === 'number') currentPositionSeconds = pos;
        if (typeof dur === 'number') {
            currentDuration = dur;
        } else if (pos === null) {
            currentDuration = 0;
        }
        if (!isMpvPaused && currentDuration > 0 && currentPositionSeconds >= currentDuration - 1 && !isPlayingNext && currentItemId) {
            console.log(`🎬 Position near end (${currentPositionSeconds.toFixed(1)}s / ${currentDuration.toFixed(1)}s), triggering next episode`);
            markItemAsWatched(currentItemId);
            reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
            playNextEpisode();
        }
    }, 1000);
}

function stopProgressPoll() {
    if (progressPollTimer) {
        clearInterval(progressPollTimer);
        progressPollTimer = null;
    }
}

function handleMpvEvent(event) {
    if (event.event === 'file-loaded') {
        console.log('✅ File loaded by MPV. Preparing Seek if necessary...');
        isPlayingNext = false;
        currentDuration = 0;
        markedWatched.clear();
        startProgressPoll();
        
        if (pendingTitle) {
            sendMpvCommand('set_property', ['force-media-title', pendingTitle]);
            sendMpvCommand('set_property', ['title', pendingTitle]);
            pendingTitle = null;
        }
        if (pendingStartSeconds > 0) {
            sendMpvCommand('seek', [pendingStartSeconds, 'absolute']);
            console.log(`⏩ Automatic seek to saved position: ${pendingStartSeconds.toFixed(2)}s`);
            currentPositionSeconds = pendingStartSeconds;
        } else {
            currentPositionSeconds = 0;
        }
        if (currentItemId) reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
        pendingStartSeconds = 0;
        pendingStreamUrl = null;
        return;
    }

    if (event.event === 'property-change' && event.name === 'time-pos' && typeof event.data === 'number') {
        currentPositionSeconds = event.data;
        return;
    }

    if (event.event === 'property-change' && event.name === 'pause' && typeof event.data === 'boolean') {
        isMpvPaused = event.data;
        console.log(event.data ? '⏸️ Playback paused' : '▶️ Playback resumed');
        if (currentItemId) reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
        return;
    }

    if (event.event === 'property-change' && event.name === 'mute' && typeof event.data === 'boolean') {
        isMuted = event.data;
        return;
    }

    if (event.event === 'property-change' && event.name === 'volume' && typeof event.data === 'number') {
        volumeLevel = Math.round(event.data);
        return;
    }

    if (event.event === 'client-message' && event.args && event.args[0]) {
        if (event.args[0] === 'jellyfin-next') {
            console.log('⏭️ Next episode requested (Keypress)');
            playNextEpisode();
        } else if (event.args[0] === 'jellyfin-prev') {
            console.log('⏮️ Previous episode requested (Keypress)');
            playPreviousEpisode();
        }
    }
}

async function loadNextEpisode(nextEpId, markCurrentWatched = true) {
    stopProgressPoll();
    for (const [, q] of pendingQueries) q.resolve(null);
    pendingQueries.clear();
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

    if (markCurrentWatched && !isReportingStop && currentItemId) {
        markItemAsWatched(currentItemId);
        reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
    } else if (!markCurrentWatched && currentItemId && !isReportingStop) {
        reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
    }
    isReportingStop = false;

    currentItemId = nextEpId;
    currentPositionSeconds = 0;
    currentEpisodeInfo = await getEpisodeInfo(nextEpId);

    if (!currentEpisodeInfo.playable) {
        console.log(`⏭️ Next item not playable: ${currentEpisodeInfo.title}`);
        isPlayingNext = false;
        return;
    }

    playSessionId = crypto.randomUUID();
    pendingStreamUrl = `${CONFIG.serverUrl}/Videos/${nextEpId}/stream?static=true&api_key=${accessToken}`;
    pendingStartSeconds = 0;

    const titleText = currentEpisodeInfo.isSeries
        ? [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${currentEpisodeInfo.episodeNumber}`, currentEpisodeInfo.title].filter(Boolean).join(' - ')
        : (currentEpisodeInfo.title || String(nextEpId));

    console.log(`📺 Now playing: ${titleText}`);

    reportPlaybackStart(nextEpId, 0);
    startProgressReporting(nextEpId);

    pendingTitle = `Jellyfin - ${titleText}`;
    sendMpvCommand('loadfile', [pendingStreamUrl, 'replace']);
    
    setTimeout(() => {
        if (isPlayingNext) {
            isPlayingNext = false;
        }
    }, 10000);
}

function playNextEpisode() {
    if (isPlayingNext) {
        console.log('⏭️ Already playing next episode, skipping duplicate call.');
        return;
    }
    isPlayingNext = true;

    if (!currentEpisodeInfo || !currentEpisodeInfo.isSeries) {
        console.log('ℹ️ Not a series, ignoring Next command.');
        isPlayingNext = false;
        return;
    }

    if (!currentEpisodeInfo.nextEpisode) {
        console.log('ℹ️ No more episodes in this season, ending.');
        isPlayingNext = false;
        killMpv();
        return;
    }

    const nextEp = currentEpisodeInfo.nextEpisode;
    const nextTitle = [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${nextEp.IndexNumber}`, nextEp.Name].filter(Boolean).join(' - ');
    console.log(`▶️ Starting next episode: ${nextTitle}`);

    if (ipcClient && !ipcClient.destroyed && mpvProcess) {
        loadNextEpisode(nextEp.Id).catch(err => {
            console.error('⚠️ Error loading next episode:', err.message);
            isPlayingNext = false;
        });
    } else {
        playMedia(nextEp.Id, 0).catch(err => {
            console.error('⚠️ Error playing next episode:', err.message);
            isPlayingNext = false;
        });
    }
}

function playPreviousEpisode() {
    if (isPlayingNext) {
        console.log('⏮️ Already transitioning, skipping.');
        return;
    }
    isPlayingNext = true;

    if (!currentEpisodeInfo || !currentEpisodeInfo.isSeries) {
        console.log('ℹ️ Not a series, ignoring Previous command.');
        isPlayingNext = false;
        return;
    }

    if (currentPositionSeconds > 30) {
        console.log('↩️ Restarting current episode (time > 30s)');
        if (ipcClient && !ipcClient.destroyed && mpvProcess) {
            sendMpvCommand('seek', [0, 'absolute']);
            currentPositionSeconds = 0;
            if (currentItemId) reportPlaybackProgress(currentItemId, 0);
            isPlayingNext = false;
        } else {
            playMedia(currentItemId, 0).catch(err => {
                console.error('⚠️ Error playing media:', err.message);
                isPlayingNext = false;
            });
        }
        return;
    }

    if (!currentEpisodeInfo.previousEpisode) {
        console.log('ℹ️ This is the first episode of the season.');
        isPlayingNext = false;
        return;
    }

    const prevEp = currentEpisodeInfo.previousEpisode;
    const prevTitle = [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${prevEp.IndexNumber}`, prevEp.Name].filter(Boolean).join(' - ');
    console.log(`◀️ Starting previous episode: ${prevTitle}`);

    if (ipcClient && !ipcClient.destroyed && mpvProcess) {
        loadNextEpisode(prevEp.Id, false).catch(err => {
            console.error('⚠️ Error loading previous episode:', err.message);
            isPlayingNext = false;
        });
    } else {
        playMedia(prevEp.Id, 0).catch(err => {
            console.error('⚠️ Error playing previous episode:', err.message);
            isPlayingNext = false;
        });
    }
}

function reportPlaybackStart(itemId, positionTicks) {
    const headers = getAuthHeaders();
    
    const data = {
        ItemId: itemId,
        MediaSourceId: itemId,
        PositionTicks: positionTicks,
        IsPaused: false,
        IsMuted: isMuted,
        VolumeLevel: volumeLevel,
        PlayMethod: 'DirectPlay',
        PlaySessionId: playSessionId,
        CanSeek: true,
        RepeatMode: 'RepeatNone',
        PlaybackOrder: 'Default',
        AudioStreamIndex: pendingAudioStreamIndex,
        SubtitleStreamIndex: pendingSubtitleStreamIndex
    };

    console.log('📡 Reporting playback start...');
    
    axios.post(`${CONFIG.serverUrl}/Sessions/Playing`, data, { headers })
        .then(() => {
            console.log('✅ Playback start reported');
        })
        .catch(e => {
            const status = e.response?.status || 'unknown';
            const body = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            console.error(`⚠️ Error reporting start (${status}):`, body);
        });
}

function startProgressReporting(itemId) {
    if (progressInterval) {
        clearInterval(progressInterval);
    }

    progressInterval = setInterval(() => {
        if (!mpvProcess || !currentItemId) {
            clearInterval(progressInterval);
            progressInterval = null;
            return;
        }

        const currentTicks = Math.round(currentPositionSeconds * 10000000);
        if (currentPositionSeconds > 10) {
            savePlaybackPosition(currentItemId, currentTicks);
        }
    }, 10000);
}

function reportPlaybackProgress(itemId, positionTicks) {
    const headers = getAuthHeaders();
    
    const data = {
        ItemId: itemId,
        MediaSourceId: itemId,
        PositionTicks: positionTicks,
        IsPaused: isMpvPaused,
        IsMuted: isMuted,
        VolumeLevel: volumeLevel,
        PlayMethod: 'DirectPlay',
        PlaySessionId: playSessionId,
        CanSeek: true,
        RepeatMode: 'RepeatNone',
        PlaybackOrder: 'Default'
    };

    axios.post(`${CONFIG.serverUrl}/Sessions/Playing/Progress`, data, { headers })
        .catch(e => {
            console.error('⚠️ Failed to report progress:', e.message);
        });
}

function reportPlaybackStop(itemId, positionTicks) {
    if (!itemId || isReportingStop) {
        return;
    }
    
    isReportingStop = true;
    
    const headers = getAuthHeaders();
    
    const data = {
        ItemId: itemId,
        MediaSourceId: itemId,
        PositionTicks: positionTicks,
        PlaySessionId: playSessionId
    };

    console.log(`📡 Reporting playback stop (position: ${(positionTicks / 10000000).toFixed(2)}s)...`);
    
    axios.post(`${CONFIG.serverUrl}/Sessions/Playing/Stopped`, data, { headers })
        .then(() => {
            console.log('✅ Playback stop reported correctly');
        })
        .catch(e => {
            console.error('⚠️ Error reporting stop:', e.message);
            isReportingStop = false;
        });
}

function shutdown(signal) {
    console.log(`\n👋 Closing application (${signal})...`);
    
    stopProgressPoll();
    for (const [, q] of pendingQueries) q.resolve(null);
    pendingQueries.clear();
    if (reconnectInterval) { clearTimeout(reconnectInterval); reconnectInterval = null; }
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    
    if (currentItemId && currentPositionSeconds > 0) {
        savePlaybackPosition(currentItemId, Math.round(currentPositionSeconds * 10000000));
    }

    const doExit = () => {
        killMpv();
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ MessageType: 'SessionsStop' })); } catch (e) {}
        }
        if (ws) ws.close();
        setTimeout(() => process.exit(0), 500);
    };

    if (currentItemId && !isReportingStop) {
        isReportingStop = true;
        const headers = getAuthHeaders();
        const data = {
            ItemId: currentItemId,
            PositionTicks: Math.round(currentPositionSeconds * 10000000),
            IsPaused: false,
            PlayMethod: 'DirectPlay',
            PlaySessionId: playSessionId
        };
        axios.post(`${CONFIG.serverUrl}/Sessions/Playing/Stopped`, data, { headers })
            .catch(() => {})
            .finally(doExit);
    } else {
        doExit();
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
    shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled rejection:', reason);
    shutdown('unhandledRejection');
});

async function main() {
    console.log('\n🚀 Starting Jellyfin MPV Shim...\n');
    
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
	
    const hasToken = loadToken();
    
    if (!hasToken || !accessToken) {
        const authenticated = await authenticateUser();
        if (!authenticated) {
            console.error('❌ Could not authenticate. Check your CONFIG credentials.');
            process.exit(1);
        }
    }
    
    await connectWebSocket();
    
    console.log('\n✅ Script started correctly');
    console.log('💡 Open Jellyfin in your browser and use "Play on" to select this device.');
    console.log('💾 Local position system active');
    console.log('🔄 Automatic reconnection enabled with Exponential Backoff');
    console.log('⏭️ Use media keys or > and < keys to change episodes.\n');
}

main().catch(error => {
    console.error('❌ Fatal error!:', error);
    process.exit(1);
});
