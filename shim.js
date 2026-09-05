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
    mpvLoadDelayMs: 100,
    fullscreen: userConfig.fullscreen || false,
    autoClose: userConfig.autoClose || false,
    mpvFlags: userConfig.mpvFlags || [],
    headless: userConfig.headless || false,
    autoSkipIntros: userConfig.autoSkipIntros || false,
    disableSkipIntro: userConfig.disableSkipIntro || false,
    verbose: userConfig.verbose || false
};

if (CONFIG.autoSkipIntros && CONFIG.disableSkipIntro) {
    console.error('⚠️ autoSkipIntros and disableSkipIntro are mutually exclusive — disabling autoSkipIntros');
    CONFIG.autoSkipIntros = false;
}

if (CONFIG.headless) {
    const logDir = path.join(__dirname, 'data');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'shim.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const timestamp = () => new Date().toISOString();
    console.log = (...args) => {
        const msg = `[${timestamp()}] ${args.join(' ')}\n`;
        logStream.write(msg);
        process.stdout.write(msg);
    };
    console.error = (...args) => {
        const msg = `[${timestamp()}] ERROR: ${args.join(' ')}\n`;
        logStream.write(msg);
        process.stderr.write(msg);
    };
    console.log(`🔇 Headless mode — logging to ${logFile}`);
}

function ts() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(level, component, ...args) {
    if (level === 'debug' && !CONFIG.verbose) return;
    const prefix = `[${ts()}] [${component}]`;
    if (level === 'error') {
        console.error(prefix, ...args);
    } else {
        console.log(prefix, ...args);
    }
}

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
let isSettingSubtitleFromJellyfin = false;
let subtitleFlagTimeout = null;
let currentSubtitleTrack = undefined;
let playbackGeneration = 0;
let isMpvPaused = false;
let isMuted = false;
let volumeLevel = 100;
let isPlayingNext = false;
let currentDuration = 0;
let progressPollTimer = null;
const pendingQueries = new Map();
const markedWatched = new Set();

let playQueue = [];
let queuePosition = -1;
let displayMessageTimeout = null;
let displayMessageOriginalPause = null;
let displayMessageOriginalFontSize = null;
let displayMessageOriginalAlignX = null;
let displayMessageOriginalAlignY = null;
let isSeeking = false;
let isNewQueueLoad = false;
let queueLoadCounter = 0;
let isPlayingNextTimestamp = 0;

let introSegments = [];
let skipIntroTimeout = null;
let isInIntroSegment = false;
let lastErrorOsdTime = 0;
let nextUpShown = false;
let skippedSegmentIds = new Set();
let oscSeekTimeout = null;

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
        fs.writeFileSync(idFile, id, { mode: 0o600 });
    } catch {}
    return id;
}

function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const stats = fs.statSync(TOKEN_FILE);
            const mode = stats.mode & 0o777;
            if (mode !== 0o600) {
                log('warn', 'auth', '⚠️ Token file has insecure permissions, re-authenticating');
                return false;
            }
            const data = fs.readFileSync(TOKEN_FILE, 'utf8');
            const tokenData = JSON.parse(data);
            if (tokenData.AccessToken && tokenData.User?.Id) {
                accessToken = tokenData.AccessToken;
                userId = tokenData.User.Id;
                log('info', 'auth', '✅ Saved token loaded successfully');
                return true;
            }
            log('warn', 'auth', '⚠️ Token file missing required fields, re-authenticating');
        }
    } catch (error) {
        log('error', 'auth', '⚠️ Error loading saved token:', error.message);
    }
    return false;
}

function saveToken(authResponse) {
    try {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(authResponse, null, 2));
        fs.chmodSync(TOKEN_FILE, 0o600);
        accessToken = authResponse.AccessToken;
        userId = authResponse.User?.Id;
        log('info', 'auth', '💾 Token saved successfully');
    } catch (error) {
        log('error', 'auth', '⚠️ Error saving token:', error.message);
    }
}

async function authenticateUser() {
    try {
        log('info', 'auth', '🔐 Authenticating user...');
        
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
        log('info', 'auth', `✅ Authentication successful for user: ${CONFIG.username}`);
        log('info', 'auth', `🆔 User ID: ${userId}`);
        return true;
    } catch (error) {
        log('error', 'auth', '❌ Authentication error:', error.message);
        if (error.response) {
            log('error', 'auth', '📄 HTTP status:', error.response.status);
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
        log('error', 'position', '⚠️ Error loading saved positions:', error.message);
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
        log('info', 'position', `💾 Position saved locally: ${(positionTicks / 10000000).toFixed(2)}s for ${itemId}`);
    } catch (error) {
        log('error', 'position', '⚠️ Error saving position:', error.message);
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
    
    log('info', 'ws', '🔌 Connecting to Jellyfin...');
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            log('info', 'ws', '✅ WebSocket connection established.');
            isReconnecting = false;
            reconnectAttempts = 0;
            lastErrorOsdTime = 0;
            log('info', 'ws', 'Connected to Jellyfin');
            
            const msg = {
                MessageType: "SessionsStart",
                Data: "0,1500"
            };
            ws.send(JSON.stringify(msg));
            log('info', 'ws', '📤 SessionsStart message sent');
            reportCapabilities();
            
            keepAliveInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
                        log('debug', 'ws', '💓 Keep-alive sent');
                    } catch (e) {
                        log('error', 'ws', 'Error sending keep-alive:', e.message);
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
                const noisyTypes = ['KeepAlive', 'ForceKeepAlive', 'RefreshProgress', 'Sessions'];
                if (!noisyTypes.includes(msg.MessageType)) {
                    log('info', 'ws', 'Message received:', msg.MessageType);
                }
                handleMessage(msg).catch(e => log('error', 'ws', 'Error handling message:', e.message));
            } catch (e) {
                log('error', 'ws', 'Error parsing message:', e.message);
            }
        });

        ws.on('error', (error) => {
            log('error', 'ws', 'WebSocket error:', error.message);
            isReconnecting = false;
        });

        ws.on('close', () => {
            log('info', 'ws', 'Disconnected from server.');
            isReconnecting = false;
            showErrorOsd('Connection lost — reconnecting...');
            
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
            
            scheduleReconnect();
        });
        
    } catch (error) {
        log('error', 'ws', '❌ Error creating WebSocket:', error.message);
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
    
    log('info', 'ws', `🔄 Scheduling automatic reconnection in ${delaySeconds} seconds (Attempt ${reconnectAttempts})...`);
    
    reconnectInterval = setTimeout(async () => {
        reconnectInterval = null;
        if (ws && ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            log('info', 'ws', '📡 Checking network connection before reconnecting...');
            const headers = getAuthHeaders();
            await axios.get(`${CONFIG.serverUrl}/System/Info`, { 
                headers,
                timeout: 3000
            });
            
            log('info', 'ws', '✅ Network connection active. Attempting WebSocket reconnection...');
            await connectWebSocket();
            
        } catch (error) {
            if (error.response && error.response.status === 401) {
                log('info', 'auth', '🔐 Token expired, reauthenticating...');
                showErrorOsd('Authentication expired — reconnecting...');
                const authenticated = await authenticateUser();
                if (authenticated) {
                    await connectWebSocket();
                } else {
                    log('error', 'auth', '❌ Reauthentication failed. Waiting for next attempt.');
                    showErrorOsd('Authentication failed');
                    clearTimeout(reconnectInterval);
                    reconnectInterval = null;
                    scheduleReconnect();
                }
            } else {
                log('warn', 'ws', `⚠️ Server unavailable or network down. Retrying in ${delaySeconds}s...`);
                showErrorOsd('Server unreachable — retrying...');
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
                log('error', 'ws', '❌ Error registering capabilities:', err.message);
            }
        });
}

async function handleMessage(msg) {
    if (msg.MessageType === "ForceKeepAlive") {
        const interval = msg.Data || 30;
        log('info', 'ws', `Server requested keep-alive every ${interval}s`);
        
        // Immediately respond to ForceKeepAlive
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
                log('debug', 'ws', '💓 Keep-alive sent (immediate response)');
            } catch (e) {
                log('error', 'ws', 'Error sending keep-alive:', e.message);
            }
        }
        
        // Set up periodic keep-alive at half the server's requested interval
        // to avoid race conditions with server timeout checks
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        const keepAliveMs = Math.min(interval * 1000, 30000); // Cap at 30s for safety
        keepAliveInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
                    log('debug', 'ws', '💓 Keep-alive sent');
                } catch (e) {
                    log('error', 'ws', 'Error sending keep-alive:', e.message);
                }
            }
        }, keepAliveMs);
        return;
    }
    if (msg.MessageType === "Play") {
        log('info', 'handler', '▶️ PLAY command received from web!');
        const data = msg.Data || {};
        const itemIds = data.ItemIds || [];
        const hasStartPosition = 'StartPositionTicks' in data;
        const startPosition = hasStartPosition ? data.StartPositionTicks : null;
        const playCommand = data.PlayCommand || 'PlayNow';
        
        log('info', 'handler', '📋 Play command data:', { itemIds, startPositionTicks: startPosition, hasStartPosition, playCommand });
        
        if (itemIds.length > 0) {
            let finalStartPosition = 0;
            if (hasStartPosition) {
                finalStartPosition = startPosition || 0;
                if (startPosition === 0) {
                    log('info', 'handler', '🎯 Playing from beginning');
                } else {
                    log('info', 'handler', `🎯 Resume position from server: ${(startPosition / 10000000).toFixed(2)}s`);
                }
            } else {
                log('info', 'handler', '🎯 No start position in message, playing from beginning');
            }
            
            let orderedItems = [...itemIds];
            if (playCommand === 'PlayShuffle') {
                for (let i = orderedItems.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [orderedItems[i], orderedItems[j]] = [orderedItems[j], orderedItems[i]];
                }
                log('info', 'queue', '🔀 Shuffled playlist');
            } else if (playCommand === 'PlayInstantMix') {
                log('info', 'queue', 'ℹ️ PlayInstantMix not supported, playing first item');
            }
            
            const startIndex = data.StartIndex || 0;
            let targetId = orderedItems[startIndex] || orderedItems[0];
            
            if (startIndex > 0) {
                log('info', 'queue', `🎯 Starting from index ${startIndex}`);
            }
            
            if (playCommand === 'PlayNext') {
                const insertAt = queuePosition + 1;
                playQueue.splice(insertAt, 0, ...orderedItems);
                for (let i = 0; i < orderedItems.length; i++) {
                    const url = `${CONFIG.serverUrl}/Videos/${orderedItems[i]}/stream?static=true&api_key=${accessToken}`;
                    sendMpvCommand('loadfile', [url, 'insert-at-index', insertAt + i]);
                }
                log('info', 'queue', `➕ Added ${orderedItems.length} item(s) to queue after position ${queuePosition}`);
                return;
            } else if (playCommand === 'PlayLast') {
                playQueue.push(...orderedItems);
                for (const id of orderedItems) {
                    const url = `${CONFIG.serverUrl}/Videos/${id}/stream?static=true&api_key=${accessToken}`;
                    sendMpvCommand('loadfile', [url, 'append']);
                }
                log('info', 'queue', `➕ Appended ${orderedItems.length} item(s) to queue (total: ${playQueue.length})`);
                return;
            } else {
                // Expand to full season queue if items are episodes from the same season
                if (orderedItems.length >= 1) {
                    try {
                        const info = await getEpisodeInfo(orderedItems[0], true);
                        if (info.isSeries && info.seasonNumber > 0 && info.episodes && info.episodes.length >= orderedItems.length) {
                            playQueue = info.episodes.map(ep => ep.Id);
                            queuePosition = info.currentIndex >= 0 ? info.currentIndex : 0;
                            targetId = playQueue[queuePosition];
                            log('info', 'queue', `📋 Full season queue: ${playQueue.length} episodes, starting at ${queuePosition + 1} (${info.seriesName} S${info.seasonNumber})`);
                        } else if (info.isSeries && info.seasonNumber === 0) {
                            // First episode is from Specials — find next unwatched episode
                            const nextUpId = await queryNextUp(info.seriesId);
                            if (nextUpId) {
                                const nextUpInfo = await getEpisodeInfo(nextUpId, true);
                                if (nextUpInfo.isSeries && nextUpInfo.episodes && nextUpInfo.episodes.length > 0) {
                                    playQueue = nextUpInfo.episodes.map(ep => ep.Id);
                                    queuePosition = nextUpInfo.currentIndex >= 0 ? nextUpInfo.currentIndex : 0;
                                    targetId = playQueue[queuePosition];
                                    log('info', 'queue', `📋 Full season queue: ${playQueue.length} episodes, starting at ${queuePosition + 1} (${nextUpInfo.seriesName} S${nextUpInfo.seasonNumber})`);
                                } else {
                                    playQueue = [...orderedItems];
                                    queuePosition = startIndex;
                                    log('info', 'queue', `📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
                                }
                            } else {
                                // No next up — fall back to season 1
                                const headers = getAuthHeaders();
                                const seasonsResponse = await axios.get(`${CONFIG.serverUrl}/Shows/${info.seriesId}/Seasons`, { headers });
                                const seasons = (seasonsResponse.data.Items || []).filter(s => s.IndexNumber > 0).sort((a, b) => a.IndexNumber - b.IndexNumber);
                                if (seasons.length > 0) {
                                    const season1 = seasons[0];
                                    const epsResponse = await axios.get(`${CONFIG.serverUrl}/Shows/${info.seriesId}/Episodes`, {
                                        headers,
                                        params: {
                                            seasonId: season1.Id,
                                            userId: userId,
                                            fields: 'Path,IndexNumber,ParentIndexNumber,SeriesName,Name,UserData'
                                        }
                                    });
                                    const eps = [...epsResponse.data.Items].sort((a, b) => a.IndexNumber - b.IndexNumber);
                                    if (eps.length > 0) {
                                        playQueue = eps.map(ep => ep.Id);
                                        queuePosition = 0;
                                        targetId = playQueue[0];
                                        log('info', 'queue', `📋 Full season queue: ${playQueue.length} episodes, starting at 1 (${info.seriesName} S${season1.IndexNumber})`);
                                    } else {
                                        playQueue = [...orderedItems];
                                        queuePosition = startIndex;
                                        log('info', 'queue', `📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
                                    }
                                } else {
                                    playQueue = [...orderedItems];
                                    queuePosition = startIndex;
                                    log('info', 'queue', `📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
                                }
                            }
                        } else {
                            playQueue = [...orderedItems];
                            queuePosition = startIndex;
                            log('info', 'queue', `📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
                        }
                    } catch (e) {
                        playQueue = [...orderedItems];
                        queuePosition = startIndex;
                        log('info', 'queue', `📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
                    }
                } else {
                    playQueue = [...orderedItems];
                    queuePosition = startIndex;
                    log('info', 'queue', `📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
                }
            }
            
            if (data.AudioStreamIndex !== undefined) {
                pendingAudioStreamIndex = data.AudioStreamIndex;
            }
            if (data.SubtitleStreamIndex !== undefined) {
                pendingSubtitleStreamIndex = data.SubtitleStreamIndex === -1 ? 'no' : data.SubtitleStreamIndex;
            }

            if (ipcClient && !ipcClient.destroyed && mpvProcess) {
                loadNewQueue(targetId, finalStartPosition).catch(err => {
                    log('error', 'queue', '⚠️ Error loading new queue:', err.message);
                });
            } else {
                playMedia(targetId, finalStartPosition).catch(err => {
                    log('error', 'mpv', '⚠️ Error playing media:', err.message);
                });
            }
        } else {
            log('error', 'handler', '⚠️ No ItemIds received in Play command');
        }
    } 
    else if (msg.MessageType === "Playstate") {
        const data = msg.Data || {};
        const command = data.Command;
        log('info', 'handler', `⏯️ State command received: ${command}`);
        
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
                sendMpvCommand('seek', [seekSeconds, 'absolute+keyframes']);
                log('info', 'handler', `⏩ Seek requested to ${seekSeconds.toFixed(2)}s`);
                currentPositionSeconds = seekSeconds;
                if (currentItemId) reportPlaybackProgress(currentItemId, data.SeekPositionTicks);
            }
        } else if (command === 'Rewind') {
            sendMpvCommand('seek', [-10, 'relative']);
            log('info', 'handler', '⏪ Rewind 10s');
        } else if (command === 'FastForward') {
            sendMpvCommand('seek', [10, 'relative']);
            log('info', 'handler', '⏩ Fast forward 10s');
        }
    }
    else if (msg.MessageType === "GeneralCommand") {
        const data = msg.Data || {};
        const command = data.Name;
        const args = data.Arguments || {};
        log('info', 'handler', `🎛️ General command received: ${command}`);
        
        if (command === 'SetAudioStreamIndex') {
            const index = parseInt(args.Index, 10);
            if (!isNaN(index)) sendMpvCommand('set_property', ['aid', index]);
        } else if (command === 'SetSubtitleStreamIndex') {
            const index = parseInt(args.Index, 10);
            isSettingSubtitleFromJellyfin = true;
            if (subtitleFlagTimeout) clearTimeout(subtitleFlagTimeout);
            subtitleFlagTimeout = setTimeout(() => { isSettingSubtitleFromJellyfin = false; subtitleFlagTimeout = null; }, 5000);
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
            log('info', 'handler', `💬 Jellyfin message: ${header} - ${text}`);
            const osdText = header ? `Message from Jellyfin Server\n${header}\n${text}` : `Message from Jellyfin Server\n${text}`;
            const duration = 10000;
            const wasPaused = await queryProperty('pause');
            if (wasPaused === null) return;
            if (displayMessageTimeout) {
                clearTimeout(displayMessageTimeout);
                displayMessageTimeout = null;
            } else {
                displayMessageOriginalPause = wasPaused;
                displayMessageOriginalFontSize = await queryProperty('osd-font-size');
                displayMessageOriginalAlignX = await queryProperty('osd-align-x');
                displayMessageOriginalAlignY = await queryProperty('osd-align-y');
            }
            if (!displayMessageOriginalPause) sendMpvCommand('set_property', ['pause', true]);
            sendMpvCommand('set_property', ['osd-font-size', 60]);
            sendMpvCommand('set_property', ['osd-align-x', 'center']);
            sendMpvCommand('set_property', ['osd-align-y', 'center']);
            await new Promise(r => setTimeout(r, 50));
            sendMpvCommand('show-text', [osdText, duration]);
            displayMessageTimeout = setTimeout(async () => {
                displayMessageTimeout = null;
                sendMpvCommand('set_property', ['osd-font-size', displayMessageOriginalFontSize || 55]);
                sendMpvCommand('set_property', ['osd-align-x', displayMessageOriginalAlignX || 'center']);
                sendMpvCommand('set_property', ['osd-align-y', displayMessageOriginalAlignY || 'bottom']);
                if (!displayMessageOriginalPause) {
                    const currentPause = await queryProperty('pause');
                    if (currentPause === true) sendMpvCommand('set_property', ['pause', false]);
                }
                displayMessageOriginalPause = null;
                displayMessageOriginalFontSize = null;
                displayMessageOriginalAlignX = null;
                displayMessageOriginalAlignY = null;
            }, duration);
        } else if (command === 'PlayNext') {
            playNextEpisode();
        } else if (command === 'ToggleFullscreen') {
            sendMpvCommand('cycle', ['fullscreen']);
        } else if (command === 'SkipIntro') {
            skipIntro();
        }
    }
    else if (msg.MessageType === "RestartRequired") {
        log('info', 'ws', '🔄 Server requires restart');
    }
    else if (msg.MessageType === "ServerShuttingDown") {
        log('info', 'ws', '🔴 Server is shutting down');
    }
    else if (msg.MessageType === "ServerRestarting") {
        log('info', 'ws', '🔄 Server is restarting, will reconnect...');
    }
}

async function getEpisodeInfo(itemId, silent = false) {
    try {
        const headers = getAuthHeaders();
        
        const response = await axios.get(`${CONFIG.serverUrl}/Users/${userId}/Items/${itemId}`, {
            headers,
            params: { fields: 'MediaStreams' }
        });
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
            if (!silent) log('info', 'episode', `📺 Episode detected: ${epLogTitle}`);

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
                userData: item.UserData || {},
                mediaStreams: item.MediaStreams || []
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
        log('error', 'episode', '⚠️ Error getting episode info:', error.message);
        return { isSeries: false, playable: false };
    }
}

async function getIntroSegments(itemId) {
    if (CONFIG.disableSkipIntro) {
        introSegments = [];
        skippedSegmentIds = new Set();
        isInIntroSegment = false;
        if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
        return;
    }
    introSegments = [];
    skippedSegmentIds = new Set();
    isInIntroSegment = false;
    if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
    try {
        const headers = getAuthHeaders();
        const response = await axios.get(`${CONFIG.serverUrl}/MediaSegments/${itemId}`, {
            headers,
            params: { includeSegmentTypes: ['Intro', 'Outro'] }
        });
        if (response.data && response.data.Items) {
            introSegments = response.data.Items.map(seg => ({
                startTicks: seg.StartTicks,
                endTicks: seg.EndTicks,
                type: seg.Type
            }));
            if (introSegments.length > 0) {
                log('info', 'segments', `🎬 Found ${introSegments.length} intro/outro segment(s)`);
            }
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            log('info', 'segments', 'ℹ️ Media segments API not available (server may not support it)');
        } else {
            log('error', 'segments', '⚠️ Error fetching intro segments:', error.message);
        }
    }
}

function skipIntro() {
    const posTicks = Math.round(currentPositionSeconds * 10000000);
    const segment = introSegments.find(seg => posTicks >= seg.startTicks && posTicks <= seg.endTicks);
    if (segment) {
        const seekTo = segment.endTicks / 10000000;
        log('info', 'segments', `⏩ Skipping ${segment.type} segment (seeking to ${seekTo.toFixed(2)}s)`);
        sendMpvCommand('seek', [seekTo, 'absolute+keyframes']);
        currentPositionSeconds = seekTo;
        if (currentItemId) reportPlaybackProgress(currentItemId, segment.endTicks);
        showSkipOsd(`Skipped ${segment.type.toLowerCase()}`);
        pushOscSkipButton('');
        // Mark this segment as skipped so we don't skip again
        skippedSegmentIds.add(segment.startTicks);
    }
    isInIntroSegment = false;
    if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
}

function checkIntroSegment(positionTicks) {
    const segment = introSegments.find(seg =>
        positionTicks >= seg.startTicks &&
        positionTicks <= seg.endTicks &&
        !skippedSegmentIds.has(seg.startTicks)
    );
    if (segment) {
        if (!isInIntroSegment) {
            isInIntroSegment = true;
            const skipLabel = `Skip ${segment.type}`;
            pushOscSkipButton(skipLabel);
            // Don't auto-skip if the user is dragging the OSC seekbar
            if (CONFIG.autoSkipIntros && !oscSeekTimeout) {
                log('info', 'segments', `🎬 Auto-skip: ${segment.type} detected, skipping in 3s...`);
                showSkipOsd(`Skipping ${segment.type.toLowerCase()} in 3s...`);
                skipIntroTimeout = setTimeout(skipIntro, 3000);
            } else {
                log('info', 'segments', `🎬 ${segment.type} detected — press S to skip`);
                showSkipOsd(`Press S to skip ${segment.type.toLowerCase()}`);
            }
        }
    } else if (isInIntroSegment) {
        isInIntroSegment = false;
        pushOscSkipButton('');
        if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
    }
}

let osdRestoreTimeout = null;

function showSkipOsd(text) {
    if (osdRestoreTimeout) { clearTimeout(osdRestoreTimeout); osdRestoreTimeout = null; }
    if (displayMessageTimeout) {
        clearTimeout(displayMessageTimeout);
        displayMessageTimeout = null;
        if (!displayMessageOriginalPause) sendMpvCommand('set_property', ['pause', false]);
        displayMessageOriginalPause = null;
        displayMessageOriginalFontSize = null;
        displayMessageOriginalAlignX = null;
        displayMessageOriginalAlignY = null;
    }
    const savedSize = displayMessageOriginalFontSize || 55;
    const savedAlignX = displayMessageOriginalAlignX || 'center';
    const savedAlignY = displayMessageOriginalAlignY || 'bottom';
    sendMpvCommand('set_property', ['osd-font-size', 40]);
    sendMpvCommand('set_property', ['osd-align-x', 'right']);
    sendMpvCommand('set_property', ['osd-align-y', 'bottom']);
    sendMpvCommand('show-text', [text, 3000]);
    osdRestoreTimeout = setTimeout(() => {
        sendMpvCommand('set_property', ['osd-font-size', savedSize]);
        sendMpvCommand('set_property', ['osd-align-x', savedAlignX]);
        sendMpvCommand('set_property', ['osd-align-y', savedAlignY]);
        osdRestoreTimeout = null;
    }, 3100);
}

function showErrorOsd(text) {
    const now = Date.now();
    if (now - lastErrorOsdTime < 30000) return;
    lastErrorOsdTime = now;
    if (osdRestoreTimeout) { clearTimeout(osdRestoreTimeout); osdRestoreTimeout = null; }
    if (displayMessageTimeout) {
        clearTimeout(displayMessageTimeout);
        displayMessageTimeout = null;
        if (!displayMessageOriginalPause) sendMpvCommand('set_property', ['pause', false]);
        displayMessageOriginalPause = null;
        displayMessageOriginalFontSize = null;
        displayMessageOriginalAlignX = null;
        displayMessageOriginalAlignY = null;
    }
    const savedSize = displayMessageOriginalFontSize || 55;
    const savedAlignX = displayMessageOriginalAlignX || 'center';
    const savedAlignY = displayMessageOriginalAlignY || 'bottom';
    sendMpvCommand('set_property', ['osd-font-size', 35]);
    sendMpvCommand('set_property', ['osd-align-x', 'right']);
    sendMpvCommand('set_property', ['osd-align-y', 'top']);
    sendMpvCommand('show-text', [text, 3000]);
    osdRestoreTimeout = setTimeout(() => {
        sendMpvCommand('set_property', ['osd-font-size', savedSize]);
        sendMpvCommand('set_property', ['osd-align-x', savedAlignX]);
        sendMpvCommand('set_property', ['osd-align-y', savedAlignY]);
        osdRestoreTimeout = null;
    }, 3100);
}

async function loadNewQueue(itemId, startTicks) {
    stopProgressPoll();
    if (currentItemId && !isReportingStop) {
        const runtime = currentEpisodeInfo?.itemRuntime || 0;
        const completionThreshold = 0.9;
        if (runtime > 0 && currentPositionSeconds >= runtime * completionThreshold) {
            markItemAsWatched(currentItemId);
        }
        reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
    }
    isReportingStop = false;
    isNewQueueLoad = true;

    currentItemId = itemId;
    currentPositionSeconds = startTicks / 10000000;
    pendingStartSeconds = 0;

    try {
        currentEpisodeInfo = await getEpisodeInfo(itemId);
        await getIntroSegments(itemId);
    } catch (e) {
        log('error', 'queue', '⚠️ Error getting episode info for new queue:', e.message);
        currentItemId = null;
        currentEpisodeInfo = null;
        isPlayingNext = false;
        return;
    }

    if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
        log('warn', 'queue', '⚠️ MPV/IPC no longer available after loading queue info, falling back to playMedia');
        playMedia(itemId, startTicks).catch(err => {
            log('error', 'mpv', '⚠️ Error playing media:', err.message);
        });
        return;
    }

    if (!currentEpisodeInfo.playable) {
        log('info', 'queue', `⏭️ Skipping non-playable item: ${currentEpisodeInfo.title}`);
        currentItemId = null;
        currentEpisodeInfo = null;
        return;
    }

    playSessionId = crypto.randomUUID();
    markedWatched.clear();

    const titleText = currentEpisodeInfo.isSeries
        ? [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${currentEpisodeInfo.episodeNumber}`, currentEpisodeInfo.title].filter(Boolean).join(' - ')
        : (currentEpisodeInfo.title || String(itemId));

    log('info', 'queue', `📺 Loading new queue: ${titleText}`);

    const savedAudioIndex = pendingAudioStreamIndex;
    const savedSubIndex = pendingSubtitleStreamIndex;
    pendingAudioStreamIndex = undefined;
    pendingSubtitleStreamIndex = undefined;

    sendMpvCommand('playlist-clear');
    for (let i = 0; i < playQueue.length; i++) {
        const url = `${CONFIG.serverUrl}/Videos/${playQueue[i]}/stream?static=true&api_key=${accessToken}`;
        sendMpvCommand('loadfile', [url, i === 0 ? 'replace' : 'append']);
    }
    queueLoadCounter = 1;
    log('info', 'queue', `📋 Loaded ${playQueue.length} items into MPV playlist.`);

    // If the requested item isn't the first in the queue, seek MPV to the right playlist position
    if (queuePosition > 0) {
        sendMpvCommand('set_property', ['playlist-pos', queuePosition]);
    }

    if (savedAudioIndex !== undefined) {
        sendMpvCommand('set_property', ['aid', savedAudioIndex]);
    }
    if (savedSubIndex !== undefined) {
        isSettingSubtitleFromJellyfin = true;
        if (subtitleFlagTimeout) clearTimeout(subtitleFlagTimeout);
        subtitleFlagTimeout = setTimeout(() => { isSettingSubtitleFromJellyfin = false; subtitleFlagTimeout = null; }, 5000);
        sendMpvCommand('set_property', ['sid', savedSubIndex]);
    }

    if (startTicks > 0) {
        pendingStartSeconds = startTicks / 10000000;
    }

    // Restore saved indices for reportPlaybackStart
    pendingAudioStreamIndex = savedAudioIndex;
    pendingSubtitleStreamIndex = savedSubIndex;
    reportPlaybackStart(itemId, startTicks);
    pendingAudioStreamIndex = undefined;
    pendingSubtitleStreamIndex = undefined;
    startProgressReporting(itemId);
    sendMpvCommand('set_property', ['force-media-title', `Jellyfin - ${titleText}`]);
    sendMpvCommand('set_property', ['title', `Jellyfin - ${titleText}`]);
}

async function playMedia(itemId, startTicks) {
    if (currentItemId && !isReportingStop) {
        reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
    }
    killMpv();
    isReportingStop = false;
    
    playbackGeneration++;
    const gen = playbackGeneration;

    currentItemId = itemId;
    currentPositionSeconds = startTicks / 10000000;
    currentEpisodeInfo = await getEpisodeInfo(itemId);
    await getIntroSegments(itemId);

    if (gen !== playbackGeneration) return;

    if (!currentEpisodeInfo.playable) {
        log('info', 'queue', `⏭️ Skipping non-playable item: ${currentEpisodeInfo.title} (type: ${currentEpisodeInfo.isSeries ? 'series' : 'other'})`);
        currentItemId = null;
        currentEpisodeInfo = null;
        return;
    }

    playSessionId = crypto.randomUUID();

    pendingStreamUrl = `${CONFIG.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${accessToken}`;
    pendingStartSeconds = startTicks / 10000000;

    log('info', 'mpv', '🍿 Launching MPV (Idle Mode)...');
    log('info', 'mpv', `    Item ID: ${itemId}`);
    log('info', 'mpv', `    Stream URL: ${CONFIG.serverUrl}/Videos/${itemId}/stream?static=true&api_key=***`);
    log('info', 'mpv', `    MPV Path: ${CONFIG.mpvPath}`);

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

    if (CONFIG.fullscreen) {
        args.push('--fullscreen');
    }

    if (Array.isArray(CONFIG.mpvFlags)) {
        args.push(...CONFIG.mpvFlags);
    }

    log('info', 'mpv', '🔧 MPV arguments:', args.join(' '));

    try {
        mpvProcess = spawn(CONFIG.mpvPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false
        });
        
        log('info', 'mpv', `✅ MPV started with PID: ${mpvProcess.pid}`);

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
                log('debug', 'mpv', `MPV: ${line}`);
            }
        });
        
        mpvProcess.stderr.on('data', (data) => {
            const line = data.toString().trim();
            if (line && !line.startsWith('AV:') && !line.includes('File tags:')) {
                log('debug', 'mpv', `MPV stderr: ${line}`);
            }
        });

        mpvProcess.on('error', (err) => {
            log('error', 'mpv', '❌ Error executing MPV:', err.message);
            log('error', 'mpv', '   Check mpvPath configuration:', CONFIG.mpvPath);
        });

        mpvProcess.on('close', (code, signal) => {
            if (gen !== playbackGeneration) return;

            if (code === 4) {
                log('info', 'mpv', `🛑 MPV closed (code ${code}, signal: ${signal}) — normal for forced quit`);
            } else if (code === 0) {
                log('info', 'mpv', `🛑 MPV closed (code ${code}, signal: ${signal})`);
            } else {
                log('info', 'mpv', `🛑 MPV closed (code ${code}, signal: ${signal})`);
            }
            
            if (code === 1) {
                log('error', 'mpv', '⚠️ MPV closed with error. Possible causes:');
                log('error', 'mpv', '   - Command line argument issue');
                log('error', 'mpv', '   - Cannot create window');
                log('error', 'mpv', '   - Video driver problem');
                log('error', 'mpv', '   - Insufficient permissions');
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
            for (const [, q] of pendingQueries) { if (q.timer) clearTimeout(q.timer); q.resolve(null); }
            pendingQueries.clear();
            if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
            if (ipcClient) { ipcClient.destroy(); ipcClient = null; }
            currentItemId = null;
            isSettingSubtitleFromJellyfin = false;
            if (subtitleFlagTimeout) { clearTimeout(subtitleFlagTimeout); subtitleFlagTimeout = null; }
            currentSubtitleTrack = undefined;
            currentEpisodeInfo = null;
            isReportingStop = false;
            isPlayingNext = false;
            isSeeking = false;
            isNewQueueLoad = false;
        });
    } catch (err) {
        log('error', 'mpv', '❌ Critical error executing MPV:', err);
        log('error', 'mpv', '   Stack:', err.stack);
        currentItemId = null;
        currentEpisodeInfo = null;
        stopProgressPoll();
        throw err;
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
            log('error', 'ipc', '❌ MPV not running, canceling IPC connection');
            return;
        }

        // Wait for socket file to exist before attempting connection
        if (!fs.existsSync(CONFIG.ipcSocketPath)) {
            if (connectionAttempts < maxAttempts) {
                setTimeout(attemptConnection, retryDelay);
            } else {
                log('error', 'ipc', '❌ Maximum IPC connection attempts reached');
            }
            return;
        }

        log('info', 'ipc', `🔗 Connecting to MPV IPC...`);
        
        if (ipcClient) {
            ipcClient.removeAllListeners();
            ipcClient.destroy();
        }
        ipcClient = net.connect(CONFIG.ipcSocketPath);
        let buffer = '';

        ipcClient.on('connect', () => {
            log('info', 'ipc', '✅ Connected to MPV IPC');

            setTimeout(() => {
                if (pendingStreamUrl && gen === playbackGeneration) {
                    log('info', 'ipc', '📡 Loading playlist into MPV...');
                    for (let i = 0; i < playQueue.length; i++) {
                        const url = `${CONFIG.serverUrl}/Videos/${playQueue[i]}/stream?static=true&api_key=${accessToken}`;
                        sendMpvCommand('loadfile', [url, i === 0 ? 'replace' : 'append']);
                    }
                    log('info', 'ipc', `    ✅ Loaded ${playQueue.length} items into playlist.`);

                    if (queuePosition > 0) {
                        sendMpvCommand('set_property', ['playlist-pos', queuePosition]);
                    }

                    if (pendingAudioStreamIndex !== undefined) {
                        sendMpvCommand('set_property', ['aid', pendingAudioStreamIndex]);
                        pendingAudioStreamIndex = undefined;
                    }
                    if (pendingSubtitleStreamIndex !== undefined) {
                        isSettingSubtitleFromJellyfin = true;
                        if (subtitleFlagTimeout) clearTimeout(subtitleFlagTimeout);
                        subtitleFlagTimeout = setTimeout(() => { isSettingSubtitleFromJellyfin = false; subtitleFlagTimeout = null; }, 5000);
                        sendMpvCommand('set_property', ['sid', pendingSubtitleStreamIndex]);
                        pendingSubtitleStreamIndex = undefined;
                    }
                }
            }, CONFIG.mpvLoadDelayMs);

            sendMpvCommand('observe_property', [1, 'time-pos']);
            sendMpvCommand('observe_property', [2, 'pause']);
            sendMpvCommand('observe_property', [3, 'mute']);
            sendMpvCommand('observe_property', [4, 'volume']);
            sendMpvCommand('observe_property', [5, 'sid']);
            sendMpvCommand('observe_property', [6, 'seeking']);
            sendMpvCommand('observe_property', [7, 'playlist-pos']);
            
            sendMpvCommand('keybind', ['>', 'script-message jellyfin-next']);
            sendMpvCommand('keybind', ['<', 'script-message jellyfin-prev']);
            if (!CONFIG.disableSkipIntro) {
                sendMpvCommand('keybind', ['s', 'script-message jellyfin-skip-intro']);
                log('info', 'ipc', '⌨️ Keys bound (>/< overridden for Jellyfin remote control, S for skip intro)');
            } else {
                log('info', 'ipc', '⌨️ Keys bound (>/< overridden for Jellyfin remote control)');
            }
        });

        ipcClient.on('data', (data) => {
            buffer += data.toString();
            // Prevent unbounded buffer growth
            if (buffer.length > 1024 * 1024) { // 1MB limit
                log('warn', 'ipc', 'IPC buffer too large, clearing');
                buffer = '';
                return;
            }
            const lines = buffer.split('\n');
            buffer = lines.pop();

            lines.forEach(line => {
                if (line.trim()) {
                    try {
                        const response = JSON.parse(line);

                        if (response.request_id !== undefined && pendingQueries.has(response.request_id)) {
                            const query = pendingQueries.get(response.request_id);
                            if (query.timer) clearTimeout(query.timer);
                            pendingQueries.delete(response.request_id);
                            query.resolve(response.error === 'success' ? response.data : null);
                            return;
                        }

                        handleMpvEvent(response);
                        
                        if (response.error && response.error !== 'success') {
                            log('error', 'ipc', '⚠️ MPV Error:', response.error, JSON.stringify(response.command));
                        }
                    } catch (e) {
                        log('error', 'ipc', '⚠️ Failed to parse MPV IPC response:', line.substring(0, 200));
                    }
                }
            });
        });

        ipcClient.on('error', (err) => {
            log('error', 'ipc', '⚠️ IPC error:', err.message);
            
            if (connectionAttempts < maxAttempts && mpvProcess && mpvProcess.exitCode === null) {
                setTimeout(attemptConnection, retryDelay);
            } else if (connectionAttempts >= maxAttempts) {
                log('error', 'ipc', '❌ Maximum IPC connection attempts reached');
                if (currentItemId && !isReportingStop) {
                    reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
                }
                killMpv();
            }
        });

        ipcClient.on('close', () => {
            log('info', 'ipc', '🔌 Disconnected from MPV IPC');
            for (const [, q] of pendingQueries) { if (q.timer) clearTimeout(q.timer); q.resolve(null); }
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
        log('info', 'report', '✅ Item marked as watched in Jellyfin');

        const positions = loadPlaybackPositions();
        if (positions[itemId]) {
            delete positions[itemId];
            fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
            log('info', 'report', '🗑️ Local position cleared (content watched)');
        }
    } catch (error) {
        log('error', 'report', '⚠️ Error marking item as watched:', error.message);
    }
}

function killMpv() {
    stopProgressPoll();
    introSegments = [];
    skippedSegmentIds = new Set();
    isInIntroSegment = false;
    nextUpShown = false;
    if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
    if (osdRestoreTimeout) { clearTimeout(osdRestoreTimeout); osdRestoreTimeout = null; }
    for (const [, q] of pendingQueries) { if (q.timer) clearTimeout(q.timer); q.resolve(null); }
    pendingQueries.clear();
    if (displayMessageTimeout) {
        clearTimeout(displayMessageTimeout);
        displayMessageTimeout = null;
        displayMessageOriginalPause = null;
        displayMessageOriginalFontSize = null;
        displayMessageOriginalAlignX = null;
        displayMessageOriginalAlignY = null;
    }
    if (mpvProcess) {
        log('info', 'mpv', '⏹️ Forcing previous MPV shutdown...');
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
        log('debug', 'mpv', '→', command, ...args);
        ipcClient.write(cmdStr);
    } catch (e) {
        log('error', 'mpv', 'Error sending command:', e.message);
    }
}

function queryProperty(property, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!ipcClient || ipcClient.destroyed) {
            resolve(null);
            return;
        }
        const requestId = ipcCommandId++;
        const timer = timeoutMs > 0 ? setTimeout(() => {
            pendingQueries.delete(requestId);
            resolve(null);
        }, timeoutMs) : null;
        pendingQueries.set(requestId, { property, resolve, timer });
        const cmd = { command: ['get_property', property], request_id: requestId };
        try {
            ipcClient.write(JSON.stringify(cmd) + '\n');
        } catch (e) {
            if (timer) clearTimeout(timer);
            pendingQueries.delete(requestId);
            resolve(null);
        }
    });
}

function startProgressPoll() {
    stopProgressPoll();
    progressPollTimer = setInterval(async () => {
        if (!currentItemId) return;

        if (isPlayingNext && Date.now() - isPlayingNextTimestamp > 30000) {
            log('warn', 'queue', '⚠️ isPlayingNext stuck for 30s, resetting');
            isPlayingNext = false;
        }

        const pos = await queryProperty('time-pos');
        const dur = await queryProperty('duration');
        if (typeof pos === 'number') currentPositionSeconds = pos;
        if (typeof dur === 'number') {
            currentDuration = dur;
        } else if (pos === null) {
            currentDuration = 0;
        }
        if (introSegments.length > 0) {
            checkIntroSegment(Math.round(currentPositionSeconds * 10000000));
        }
        if (!nextUpShown && !isMpvPaused && currentDuration > 0 && currentPositionSeconds >= currentDuration - 10 && currentEpisodeInfo?.nextEpisode) {
            nextUpShown = true;
            const next = currentEpisodeInfo.nextEpisode;
            const title = `${currentEpisodeInfo.seriesName} - ${next.ParentIndexNumber}x${next.IndexNumber} - ${next.Name}`;
            log('info', 'queue', `Next up: ${title}`);
            showSkipOsd(`Next up: ${title}`);
        }
        if (!isMpvPaused && currentDuration > 0 && currentPositionSeconds >= currentDuration - 1 && !isPlayingNext && currentItemId) {
            const isLastInPlaylist = queuePosition >= playQueue.length - 1;
            if (isLastInPlaylist) {
                log('info', 'queue', `🎬 Near end of last item (${currentPositionSeconds.toFixed(1)}s / ${currentDuration.toFixed(1)}s), querying NextUp`);
                markItemAsWatched(currentItemId);
                reportPlaybackStop(currentItemId, Math.round(currentPositionSeconds * 10000000));
                playNextEpisode();
            }
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
        isSeeking = false;
        if (queueLoadCounter > 0) {
            queueLoadCounter--;
            if (queueLoadCounter === 0) {
                isNewQueueLoad = false;
            }
        } else {
            isNewQueueLoad = false;
        }

        isReportingStop = false;
        log('info', 'mpv', '✅ File loaded by MPV. Preparing Seek if necessary...');
        isPlayingNext = false;
        currentDuration = 0;
        nextUpShown = false;
        markedWatched.clear();
        skippedSegmentIds.clear();
        isInIntroSegment = false;

        if (pendingTitle) {
            sendMpvCommand('set_property', ['force-media-title', pendingTitle]);
            sendMpvCommand('set_property', ['title', pendingTitle]);
            pendingTitle = null;
        }

        if (pendingStartSeconds > 0) {
            const seekTo = pendingStartSeconds;
            pendingStartSeconds = 0;
            setTimeout(() => {
                sendMpvCommand('seek', [seekTo, 'absolute+keyframes']);
                log('info', 'mpv', `⏩ Automatic seek to saved position: ${seekTo.toFixed(2)}s`);
                currentPositionSeconds = seekTo;
            }, 500);
        } else {
            currentPositionSeconds = 0;
            pendingStartSeconds = 0;
        }

        startProgressPoll();
        pendingStreamUrl = null;
        pushOscState();
        return;
    }

    if (event.event === 'property-change' && event.name === 'time-pos' && typeof event.data === 'number') {
        currentPositionSeconds = event.data;
        return;
    }

    if (event.event === 'property-change' && event.name === 'pause' && typeof event.data === 'boolean') {
        isMpvPaused = event.data;
        log('info', 'mpv', event.data ? '⏸️ Playback paused' : '▶️ Playback resumed');
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

    if (event.event === 'property-change' && event.name === 'sid') {
        currentSubtitleTrack = event.data;
        if (isSettingSubtitleFromJellyfin) {
            isSettingSubtitleFromJellyfin = false;
            if (subtitleFlagTimeout) { clearTimeout(subtitleFlagTimeout); subtitleFlagTimeout = null; }
            return;
        }
        if (currentItemId) {
            const sid = event.data;
            log('info', 'mpv', `🔤 Subtitle changed in MPV: track ${sid}`);
            reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
        }
        return;
    }

    if (event.event === 'property-change' && event.name === 'seeking' && event.data === false) {
        if (currentItemId) reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
        return;
    }

    if (event.event === 'property-change' && event.name === 'playlist-pos' && typeof event.data === 'number') {
        const newPos = event.data;
        // Skip during new queue loads — file-loaded handler takes care of it
        if (isNewQueueLoad) return;
        if (playQueue.length > 0 && newPos >= 0 && newPos < playQueue.length && newPos !== queuePosition) {
            const prevItemId = currentItemId;
            const prevPos = currentPositionSeconds;
            const prevRuntime = currentEpisodeInfo?.itemRuntime || 0;

            if (prevItemId && prevItemId !== playQueue[newPos]) {
                if (prevRuntime > 0 && prevPos >= prevRuntime * 0.9) {
                    markItemAsWatched(prevItemId);
                }
                reportPlaybackStop(prevItemId, Math.round(prevPos * 10000000));
            }
            stopProgressPoll();

            queuePosition = newPos;
            currentItemId = playQueue[newPos];
            currentPositionSeconds = 0;

            log('info', 'queue', `📋 Playlist changed: queuePosition=${queuePosition}, itemId=${currentItemId}`);

            getEpisodeInfo(currentItemId).then(info => {
                currentEpisodeInfo = info;
                const titleText = info.isSeries
                    ? [info.seriesName, `${info.seasonNumber}x${info.episodeNumber}`, info.title].filter(Boolean).join(' - ')
                    : (info.title || String(currentItemId));
                log('info', 'queue', `▶️ Starting next episode: ${titleText}`);
                sendMpvCommand('set_property', ['force-media-title', `Jellyfin - ${titleText}`]);
                sendMpvCommand('set_property', ['title', `Jellyfin - ${titleText}`]);
                playSessionId = crypto.randomUUID();
                reportPlaybackStart(currentItemId, 0);
                startProgressReporting(currentItemId);
                    getIntroSegments(currentItemId).catch(err => {
                        log('error', 'segments', '⚠️ Error getting intro segments:', err.message);
                    });
                startProgressPoll();
                pushOscState();
            }).catch(err => {
                log('error', 'episode', '⚠️ Error getting episode info:', err.message);
                startProgressPoll();
            });
        }
        return;
    }

    if (event.event === 'client-message' && event.args && event.args[0]) {
        if (event.args[0] === 'jellyfin-next') {
            log('info', 'episode', '⏭️ Next episode requested (Keypress)');
            playNextEpisode();
        } else if (event.args[0] === 'jellyfin-prev') {
            log('info', 'episode', '⏮️ Previous episode requested (Keypress)');
            playPreviousEpisode();
        } else if (event.args[0] === 'jellyfin-skip-intro') {
            log('info', 'segments', '⏩ Skip intro requested (Keypress)');
            skipIntro();
        } else if (event.args[0] === 'shim-jf-osc-action') {
            handleOscAction(event.args[1], event.args[2]);
        } else if (event.args[0] === 'shim-close') {
            log('info', 'osc', '🎮 OSC close requested — closing MPV');
            sendMpvCommand('quit');
        } else if (event.args[0] === 'shim-jf-osc-ui-seek') {
            // OSC seekbar was dragged — exempt from skip-intro detection
            if (oscSeekTimeout) clearTimeout(oscSeekTimeout);
            oscSeekTimeout = setTimeout(() => { oscSeekTimeout = null; }, 2000);
        }
    }
}

async function playNextEpisode() {
    if (isPlayingNext) {
        log('info', 'queue', '⏭️ Already playing next episode, skipping duplicate call.');
        return;
    }
    isPlayingNext = true;
    isPlayingNextTimestamp = Date.now();
    // Safety timeout to reset isPlayingNext if progress poll isn't running
    setTimeout(() => {
        if (isPlayingNext && Date.now() - isPlayingNextTimestamp > 30000) {
            log('info', 'queue', '⚠️ isPlayingNext stuck for 30s (safety timeout), resetting');
            isPlayingNext = false;
        }
    }, 31000);

    if (playQueue.length > 0 && queuePosition < playQueue.length - 1) {
        const prevItemId = currentItemId;
        const prevPos = currentPositionSeconds;
        const prevRuntime = currentEpisodeInfo?.itemRuntime || 0;
        if (prevItemId) {
            if (prevRuntime > 0 && prevPos >= prevRuntime * 0.9) {
                markItemAsWatched(prevItemId);
            }
            reportPlaybackStop(prevItemId, Math.round(prevPos * 10000000));
        }
        stopProgressPoll();
        queuePosition++;
        currentItemId = playQueue[queuePosition];
        currentPositionSeconds = 0;
        log('info', 'queue', `▶️ Next in queue (${queuePosition + 1}/${playQueue.length})`);
        if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
            log('warn', 'queue', '⚠️ MPV/IPC not available, cannot skip to next');
            isPlayingNext = false;
            return;
        }
        getEpisodeInfo(currentItemId).then(info => {
            currentEpisodeInfo = info;
            const titleText = info.isSeries
                ? [info.seriesName, `${info.seasonNumber}x${info.episodeNumber}`, info.title].filter(Boolean).join(' - ')
                : (info.title || String(currentItemId));
            log('info', 'queue', `▶️ Starting next episode: ${titleText}`);
            sendMpvCommand('set_property', ['force-media-title', `Jellyfin - ${titleText}`]);
            sendMpvCommand('set_property', ['title', `Jellyfin - ${titleText}`]);
            pushOscState();
        }).catch(err => {
            log('error', 'episode', '⚠️ Error getting episode info:', err.message);
        });
        sendMpvCommand('playlist-next');
        return;
    }

    if (!currentEpisodeInfo || !currentEpisodeInfo.isSeries) {
        log('info', 'queue', 'ℹ️ Not a series, ending playback.');
        playQueue = [];
        queuePosition = -1;
        isPlayingNext = false;
        pushOscState(false);
        if (CONFIG.autoClose) {
            log('info', 'queue', 'ℹ️ Auto-close enabled, closing MPV...');
            sendMpvCommand('quit');
        } else {
            log('info', 'queue', 'ℹ️ Playlist ended, MPV staying open (--keep-open=yes)');
        }
        return;
    }

    if (currentEpisodeInfo.nextEpisode) {
        const nextEp = currentEpisodeInfo.nextEpisode;
        const nextTitle = [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${nextEp.IndexNumber}`, nextEp.Name].filter(Boolean).join(' - ');
        log('info', 'queue', `▶️ Starting next episode: ${nextTitle}`);
        // Mark current episode as watched before advancing
        const prevItemId = currentItemId;
        const prevPos = currentPositionSeconds;
        const prevRuntime = currentEpisodeInfo?.itemRuntime || 0;
        if (prevItemId) {
            if (prevRuntime > 0 && prevPos >= prevRuntime * 0.9) {
                markItemAsWatched(prevItemId);
            }
            reportPlaybackStop(prevItemId, Math.round(prevPos * 10000000));
        }
        if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
            playMedia(nextEp.Id, 0).catch(err => {
                    log('error', 'episode', '⚠️ Error playing next episode:', err.message);
                isPlayingNext = false;
            });
            return;
        }
        const url = `${CONFIG.serverUrl}/Videos/${nextEp.Id}/stream?static=true&api_key=${accessToken}`;
        playQueue.push(nextEp.Id);
        queuePosition = playQueue.length - 1;
        currentItemId = nextEp.Id;
        sendMpvCommand('loadfile', [url, 'append']);
        sendMpvCommand('playlist-next');
        return;
    }

    log('info', 'queue', '🔍 End of season, querying NextUp...');
    try {
        const nextUpId = await queryNextUp(currentEpisodeInfo.seriesId);
        if (nextUpId) {
            const nextUpInfo = await getEpisodeInfo(nextUpId);
            const nextUpTitle = nextUpInfo.isSeries
                ? [nextUpInfo.seriesName, `${nextUpInfo.seasonNumber}x${nextUpInfo.episodeNumber}`, nextUpInfo.title].filter(Boolean).join(' - ')
                : (nextUpInfo.title || String(nextUpId));
            log('info', 'queue', `▶️ Starting next episode: ${nextUpTitle}`);
            // Mark current episode as watched before advancing
            const prevItemId2 = currentItemId;
            const prevPos2 = currentPositionSeconds;
            const prevRuntime2 = currentEpisodeInfo?.itemRuntime || 0;
            if (prevItemId2) {
                if (prevRuntime2 > 0 && prevPos2 >= prevRuntime2 * 0.9) {
                    markItemAsWatched(prevItemId2);
                }
                reportPlaybackStop(prevItemId2, Math.round(prevPos2 * 10000000));
            }
            if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
                playMedia(nextUpId, 0).catch(err => {
                log('error', 'episode', '⚠️ Error playing next episode:', err.message);
                    isPlayingNext = false;
                });
                return;
            }
            const url = `${CONFIG.serverUrl}/Videos/${nextUpId}/stream?static=true&api_key=${accessToken}`;
            playQueue.push(nextUpId);
            queuePosition = playQueue.length - 1;
            currentItemId = nextUpId;
            sendMpvCommand('loadfile', [url, 'append']);
            sendMpvCommand('playlist-next');
        } else {
            log('info', 'queue', 'ℹ️ No more episodes, ending playback.');
            playQueue = [];
            queuePosition = -1;
            isPlayingNext = false;
            pushOscState(false);
            if (CONFIG.autoClose) {
                log('info', 'queue', 'ℹ️ Auto-close enabled, closing MPV...');
                sendMpvCommand('quit');
            } else {
                log('info', 'queue', 'ℹ️ Playlist ended, MPV staying open (--keep-open=yes)');
            }
        }
    } catch (e) {
        log('warn', 'queue', '⚠️ NextUp query failed, keeping playback alive:', e.message);
        isPlayingNext = false;
    }
}

async function queryNextUp(seriesId) {
    const headers = getAuthHeaders();
    const response = await axios.get(`${CONFIG.serverUrl}/Shows/NextUp`, {
        headers,
        params: { userId, seriesId, limit: 1 }
    });
    if (response.data?.Items && response.data.Items.length > 0) {
        const nextEp = response.data.Items[0];
        log('info', 'episode', `📺 NextUp from Jellyfin: ${nextEp.SeriesName} - S${nextEp.ParentIndexNumber}E${nextEp.IndexNumber} - ${nextEp.Name}`);
        return nextEp.Id;
    }
    return null;
}

async function playPreviousEpisode() {
    if (isPlayingNext) {
        log('info', 'queue', '⏭️ Already transitioning, skipping.');
        return;
    }
    isPlayingNext = true;
    isPlayingNextTimestamp = Date.now();
    // Safety timeout to reset isPlayingNext if progress poll isn't running
    setTimeout(() => {
        if (isPlayingNext && Date.now() - isPlayingNextTimestamp > 30000) {
            log('info', 'queue', '⚠️ isPlayingNext stuck for 30s (safety timeout), resetting');
            isPlayingNext = false;
        }
    }, 31000);

    if (currentPositionSeconds > 30) {
        log('info', 'episode', '↩️ Restarting current episode (time > 30s)');
        isSeeking = true;
        sendMpvCommand('seek', [0, 'absolute+keyframes']);
        currentPositionSeconds = 0;
        if (currentItemId) reportPlaybackProgress(currentItemId, 0);
        isPlayingNext = false;
        setTimeout(() => { isSeeking = false; }, 1000);
        return;
    }

    if (playQueue.length > 0 && queuePosition > 0) {
        const prevItemId = currentItemId;
        const prevPos = currentPositionSeconds;
        const prevRuntime = currentEpisodeInfo?.itemRuntime || 0;
        if (prevItemId) {
            if (prevRuntime > 0 && prevPos >= prevRuntime * 0.9) {
                markItemAsWatched(prevItemId);
            }
            reportPlaybackStop(prevItemId, Math.round(prevPos * 10000000));
        }
        stopProgressPoll();
        queuePosition--;
        currentItemId = playQueue[queuePosition];
        currentPositionSeconds = 0;
        log('info', 'queue', `⏮️ Previous in queue (${queuePosition + 1}/${playQueue.length})`);
        getEpisodeInfo(currentItemId).then(info => {
            currentEpisodeInfo = info;
            const titleText = info.isSeries
                ? [info.seriesName, `${info.seasonNumber}x${info.episodeNumber}`, info.title].filter(Boolean).join(' - ')
                : (info.title || String(currentItemId));
            log('info', 'queue', `▶️ Starting previous episode: ${titleText}`);
            sendMpvCommand('set_property', ['force-media-title', `Jellyfin - ${titleText}`]);
            sendMpvCommand('set_property', ['title', `Jellyfin - ${titleText}`]);
            pushOscState();
        }).catch(err => {
            log('error', 'episode', '⚠️ Error getting episode info:', err.message);
        });
        sendMpvCommand('playlist-prev');
        return;
    }

    if (!currentEpisodeInfo || !currentEpisodeInfo.isSeries) {
        log('info', 'queue', 'ℹ️ Not a series, ignoring Previous command.');
        isPlayingNext = false;
        return;
    }

    if (!currentEpisodeInfo.previousEpisode) {
        log('info', 'queue', 'ℹ️ This is the first episode.');
        isPlayingNext = false;
        return;
    }

    const prevEp = currentEpisodeInfo.previousEpisode;
    const prevTitle = [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${prevEp.IndexNumber}`, prevEp.Name].filter(Boolean).join(' - ');
    log('info', 'queue', `◀️ Starting previous episode: ${prevTitle}`);
    // Use playMedia for cross-season previous to avoid queue desync
    playMedia(prevEp.Id, 0).catch(err => {
        log('error', 'episode', '⚠️ Error playing previous episode:', err.message);
        isPlayingNext = false;
    });
    return;
}

function reportPlaybackStart(itemId, positionTicks) {
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
        PlaybackOrder: 'Default',
        AudioStreamIndex: pendingAudioStreamIndex,
        SubtitleStreamIndex: pendingSubtitleStreamIndex !== undefined ? pendingSubtitleStreamIndex : (typeof currentSubtitleTrack === 'number' ? currentSubtitleTrack : undefined)
    };

    log('info', 'report', '📡 Reporting playback start...');
    
    axios.post(`${CONFIG.serverUrl}/Sessions/Playing`, data, { headers })
        .then(() => {
            log('info', 'report', '✅ Playback start reported');
        })
        .catch(e => {
            const status = e.response?.status || 'unknown';
            const body = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            log('error', 'report', `⚠️ Error reporting start (${status}):`, body);
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
        // Report progress to server to keep session alive
        reportPlaybackProgress(currentItemId, currentTicks);
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
            log('error', 'report', '⚠️ Failed to report progress:', e.message);
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

    log('info', 'report', `📡 Reporting playback stop (position: ${(positionTicks / 10000000).toFixed(2)}s)...`);
    
    axios.post(`${CONFIG.serverUrl}/Sessions/Playing/Stopped`, data, { headers })
        .then(() => {
            log('info', 'report', '✅ Playback stop reported correctly');
            isReportingStop = false;
        })
        .catch(e => {
            log('error', 'report', '⚠️ Error reporting stop:', e.message);
            isReportingStop = false;
        });
}

// jf-mpv-osc integration
function handleOscAction(verb, arg) {
    if (!verb) return;
    log('info', 'osc', `🎮 OSC action: ${verb}${arg !== undefined ? ' ' + arg : ''}`);
    switch (verb) {
        case 'skip-segment':
            skipIntro();
            break;
        case 'next-item':
            playNextEpisode();
            break;
        case 'prev-item':
            playPreviousEpisode();
            break;
        case 'set-sub':
            if (arg !== undefined) {
                const sid = arg === '-1' || arg === -1 ? 'no' : Number(arg);
                sendMpvCommand('set_property', ['sid', sid]);
            }
            break;
        case 'set-audio':
            if (arg !== undefined) {
                sendMpvCommand('set_property', ['aid', Number(arg)]);
            }
            break;
        case 'set-sub-size':
            if (arg !== undefined) {
                // arg is percentage string from sub_style options (e.g., "100" = normal)
                const scale = Number(arg) / 100;
                sendMpvCommand('set_property', ['sub-scale', scale || 1.0]);
            }
            break;
        case 'set-sub-position':
            if (arg !== undefined) {
                // arg is position string from sub_style options ("top", "50", "100")
                const pos = arg === 'top' ? 0 : Number(arg) || 100;
                sendMpvCommand('set_property', ['sub-pos', pos]);
            }
            break;
        case 'set-sub-color':
            if (arg !== undefined) {
                // arg is hex color string from sub_style options (e.g., "#FFFFFF")
                sendMpvCommand('set_property', ['sub-color', arg]);
            }
            break;
        case 'toggle-favorite':
            toggleFavorite();
            break;
        case 'screenshot':
            sendMpvCommand('screenshot');
            break;
        case 'set-fullscreen':
            // Notification from OSC — set to the requested state
            if (arg === 'yes') {
                sendMpvCommand('set_property', ['fullscreen', true]);
            } else if (arg === 'no') {
                sendMpvCommand('set_property', ['fullscreen', false]);
            } else {
                sendMpvCommand('cycle', ['fullscreen']);
            }
            break;
        case 'unwatched-quit':
            shutdown('unwatched-quit');
            break;
        default:
            log('debug', 'osc', `Unknown OSC action: ${verb} ${arg || ''}`);
    }
}

async function pushOscState(hasMedia = true) {
    if (!hasMedia) {
        sendMpvCommand('script-message', ['shim-jf-osc-state', JSON.stringify({ strings: {}, has_media: false })]);
        return;
    }
    if (!currentItemId || !mpvProcess) return;

    const hasPrev = playQueue.length > 0 && queuePosition > 0;
    const hasNext = playQueue.length > 0 && queuePosition < playQueue.length - 1;

    const state = {
        strings: {},
        has_media: true,
        allow_screenshot: true,
        queue: { has_prev: hasPrev, has_next: hasNext },
        favorite: currentEpisodeInfo?.userData?.IsFavorite || false
    };

    // Tier 1: Push subtitle and audio track lists from Jellyfin MediaStreams
    // Query current track selections from MPV
    const [currentSid, currentAid] = await Promise.all([
        queryProperty('sid').catch(() => null),
        queryProperty('aid').catch(() => null)
    ]);
    const activeSub = currentSid !== null ? currentSid : currentSubtitleTrack;
    const activeAudio = currentAid !== null ? currentAid : null;

    if (currentEpisodeInfo?.mediaStreams) {
        const subtitles = currentEpisodeInfo.mediaStreams
            .filter(s => s.Type === 'Subtitle')
            .map(s => ({
                id: s.Index,
                label: s.DisplayTitle || s.Title || s.Language || `Track ${s.Index}`,
                selected: s.Index === activeSub
            }));
        if (subtitles.length > 0) {
            subtitles.unshift({ id: -1, label: 'Off', selected: activeSub === 'no' || activeSub === -1 || activeSub === 0 });
            state.subtitles = subtitles;
        }

        const audio = currentEpisodeInfo.mediaStreams
            .filter(s => s.Type === 'Audio')
            .map(s => ({
                id: s.Index,
                label: s.DisplayTitle || s.Title || s.Language || `Track ${s.Index}`,
                selected: s.Index === activeAudio
            }));
        if (audio.length > 0) {
            state.audio = audio;
        }
    }

    // Tier 4: Subtitle styling options — query current values from MPV
    const [subScale, subPos, subColor] = await Promise.all([
        queryProperty('sub-scale').catch(() => null),
        queryProperty('sub-pos').catch(() => null),
        queryProperty('sub-color').catch(() => null)
    ]);

    const currentScale = typeof subScale === 'number' ? Math.round(subScale * 100) : 100;
    const currentPos = typeof subPos === 'number' ? subPos : 100;
    const currentColor = typeof subColor === 'string' ? subColor.toUpperCase() : '#FFFFFF';

    state.sub_style = {
        size: { current: `${currentScale}%`, options: [
            { id: '50', label: 'Tiny', selected: currentScale === 50 },
            { id: '75', label: 'Small', selected: currentScale === 75 },
            { id: '100', label: 'Normal', selected: currentScale === 100 },
            { id: '125', label: 'Large', selected: currentScale === 125 },
            { id: '150', label: 'Huge', selected: currentScale === 150 }
        ]},
        position: { current: currentPos === 0 ? 'Top' : currentPos === 100 ? 'Bottom' : 'Middle', options: [
            { id: 'top', label: 'Top', selected: currentPos === 0 },
            { id: '50', label: 'Middle', selected: currentPos === 50 },
            { id: '100', label: 'Bottom', selected: currentPos === 100 }
        ]},
        color: { current: currentColor === '#FFFFFF' ? 'White' : currentColor === '#FFFF00' ? 'Yellow' : currentColor === '#00FF00' ? 'Green' : currentColor === '#00FFFF' ? 'Cyan' : currentColor === '#FF0000' ? 'Red' : currentColor, options: [
            { id: '#FFFFFF', label: 'White', selected: currentColor === '#FFFFFF' },
            { id: '#FFFF00', label: 'Yellow', selected: currentColor === '#FFFF00' },
            { id: '#00FF00', label: 'Green', selected: currentColor === '#00FF00' },
            { id: '#00FFFF', label: 'Cyan', selected: currentColor === '#00FFFF' },
            { id: '#FF0000', label: 'Red', selected: currentColor === '#FF0000' }
        ]}
    };

    sendMpvCommand('script-message', ['shim-jf-osc-state', JSON.stringify(state)]);
}

function pushOscSkipButton(label) {
    sendMpvCommand('script-message', ['shim-jf-osc-skip', label || '']);
}

async function toggleFavorite() {
    if (!currentItemId) return;
    try {
        const headers = getAuthHeaders();
        const isFavorite = currentEpisodeInfo?.userData?.IsFavorite;
        if (isFavorite) {
            await axios.delete(`${CONFIG.serverUrl}/Users/${userId}/FavoriteItems/${currentItemId}`, { headers });
        } else {
            await axios.post(`${CONFIG.serverUrl}/Users/${userId}/FavoriteItems/${currentItemId}`, {}, { headers });
        }
        if (currentEpisodeInfo?.userData) {
            currentEpisodeInfo.userData.IsFavorite = !isFavorite;
        }
        pushOscState();
        log('info', 'osc', `${isFavorite ? '💔 Removed from' : '❤️ Added to'} favorites`);
    } catch (err) {
        log('error', 'osc', '⚠️ Error toggling favorite:', err.message);
    }
}

function shutdown(signal) {
    log('info', 'main', `\n👋 Closing application (${signal})...`);
    
    stopProgressPoll();
    for (const [, q] of pendingQueries) { if (q.timer) clearTimeout(q.timer); q.resolve(null); }
    pendingQueries.clear();
    if (reconnectInterval) { clearTimeout(reconnectInterval); reconnectInterval = null; }
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    
    if (currentItemId && currentPositionSeconds > 0) {
        savePlaybackPosition(currentItemId, Math.round(currentPositionSeconds * 10000000));
    }

    const doExit = () => {
        // Try graceful quit first, then force kill after timeout
        if (mpvProcess && ipcClient && !ipcClient.destroyed) {
            sendMpvCommand('quit');
            setTimeout(() => {
                killMpv();
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try { ws.send(JSON.stringify({ MessageType: 'SessionsStop' })); } catch (e) {}
                }
                if (ws) ws.close();
                setTimeout(() => process.exit(0), 500);
            }, 1000);
        } else {
            killMpv();
            if (ws && ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ MessageType: 'SessionsStop' })); } catch (e) {}
            }
            if (ws) ws.close();
            setTimeout(() => process.exit(0), 500);
        }
    };

    if (currentItemId && !isReportingStop) {
        isReportingStop = true;
        const headers = getAuthHeaders();
        const data = {
            ItemId: currentItemId,
            PositionTicks: Math.round(currentPositionSeconds * 10000000),
            IsPaused: isMpvPaused,
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
    log('error', 'main', '❌ Uncaught exception:', err);
    shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
    log('error', 'main', '❌ Unhandled rejection:', reason);
    shutdown('unhandledRejection');
});

async function main() {
    log('info', 'main', '\n🚀 Starting Jellyfin MPV Shim...\n');
    
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
	
    const hasToken = loadToken();
    
    if (!hasToken || !accessToken) {
        const authenticated = await authenticateUser();
        if (!authenticated) {
            log('error', 'main', '❌ Could not authenticate. Check your CONFIG credentials.');
            process.exit(1);
        }
    }
    
    await connectWebSocket();
    
    log('info', 'main', '\n✅ Script started correctly');
    log('info', 'main', '💡 Open Jellyfin in your browser and use "Play on" to select this device.');
    log('info', 'main', '💾 Local position system active');
    log('info', 'main', '🔄 Automatic reconnection enabled with Exponential Backoff');
    log('info', 'main', '⏭️ Use media keys or > and < keys to change episodes.\n');
}

main().catch(error => {
    log('error', 'main', '❌ Fatal error!:', error);
    process.exit(1);
});
