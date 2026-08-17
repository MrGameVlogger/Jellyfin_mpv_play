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
    verbose: userConfig.verbose || false
};

if (CONFIG.headless) {
    const logDir = path.join(__dirname, 'data');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'shim.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const timestamp = () => new Date().toISOString();
    console.log = (...args) => { logStream.write(`[${timestamp()}] ${args.join(' ')}\n`); };
    console.error = (...args) => { logStream.write(`[${timestamp()}] ERROR: ${args.join(' ')}\n`); };
    console.log(`🔇 Headless mode — logging to ${logFile}`);
    process.stdout.write = () => true;
    process.stderr.write = () => true;
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
let isManualSkip = false;
let isSeeking = false;
let isNewQueueLoad = false;
let isPlayingNextTimestamp = 0;
let previousItemId = null;

let introSegments = [];
let skipIntroTimeout = null;
let isInIntroSegment = false;
let lastErrorOsdTime = 0;
let nextUpShown = false;

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
            lastErrorOsdTime = 0;
            showErrorOsd('Connected to Jellyfin');
            
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
                showErrorOsd('Authentication expired — reconnecting...');
                const authenticated = await authenticateUser();
                if (authenticated) {
                    await connectWebSocket();
                } else {
                    console.error('❌ Reauthentication failed. Waiting for next attempt.');
                    showErrorOsd('Authentication failed');
                    clearTimeout(reconnectInterval);
                    reconnectInterval = null;
                    scheduleReconnect();
                }
            } else {
                console.log(`⚠️ Server unavailable or network down. Retrying in ${delaySeconds}s...`);
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
            } else if (playCommand === 'PlayInstantMix') {
                console.log('ℹ️ PlayInstantMix not supported, playing first item');
            }
            
            const startIndex = data.StartIndex || 0;
            let targetId = orderedItems[startIndex] || orderedItems[0];
            
            if (startIndex > 0) {
                console.log(`🎯 Starting from index ${startIndex}`);
            }
            
            if (playCommand === 'PlayNext') {
                const insertAt = queuePosition + 1;
                playQueue.splice(insertAt, 0, ...orderedItems);
                for (let i = 0; i < orderedItems.length; i++) {
                    const url = `${CONFIG.serverUrl}/Videos/${orderedItems[i]}/stream?static=true&api_key=${accessToken}`;
                    sendMpvCommand('loadfile', [url, 'insert-at-index', insertAt + i]);
                }
                console.log(`➕ Added ${orderedItems.length} item(s) to queue after position ${queuePosition}`);
                return;
            } else if (playCommand === 'PlayLast') {
                playQueue.push(...orderedItems);
                for (const id of orderedItems) {
                    const url = `${CONFIG.serverUrl}/Videos/${id}/stream?static=true&api_key=${accessToken}`;
                    sendMpvCommand('loadfile', [url, 'append']);
                }
                console.log(`➕ Appended ${orderedItems.length} item(s) to queue (total: ${playQueue.length})`);
                return;
            } else {
                playQueue = [...orderedItems];
                queuePosition = startIndex;
                console.log(`📋 Queue set: ${playQueue.length} items, starting at index ${queuePosition}`);
            }
            
            if (data.AudioStreamIndex !== undefined) {
                pendingAudioStreamIndex = data.AudioStreamIndex;
            }
            if (data.SubtitleStreamIndex !== undefined) {
                pendingSubtitleStreamIndex = data.SubtitleStreamIndex === -1 ? 'no' : data.SubtitleStreamIndex;
            }

            if (ipcClient && !ipcClient.destroyed && mpvProcess) {
                loadNewQueue(targetId, finalStartPosition).catch(err => {
                    console.error('⚠️ Error loading new queue:', err.message);
                });
            } else {
                playMedia(targetId, finalStartPosition).catch(err => {
                    console.error('⚠️ Error playing media:', err.message);
                });
            }
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
                sendMpvCommand('seek', [seekSeconds, 'absolute+keyframes']);
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
            console.log(`💬 Jellyfin message: ${header} - ${text}`);
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
        console.log('🔄 Server requires restart');
    }
    else if (msg.MessageType === "ServerShuttingDown") {
        console.log('🔴 Server is shutting down');
    }
    else if (msg.MessageType === "ServerRestarting") {
        console.log('🔄 Server is restarting, will reconnect...');
    }
}

async function getEpisodeInfo(itemId, silent = false) {
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
            if (!silent) console.log(`📺 Episode detected: ${epLogTitle}`);

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

async function getIntroSegments(itemId) {
    introSegments = [];
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
                console.log(`🎬 Found ${introSegments.length} intro/outro segment(s)`);
            }
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log('ℹ️ Media segments API not available (server may not support it)');
        } else {
            console.error('⚠️ Error fetching intro segments:', error.message);
        }
    }
}

function skipIntro() {
    const posTicks = Math.round(currentPositionSeconds * 10000000);
    const segment = introSegments.find(seg => posTicks >= seg.startTicks && posTicks <= seg.endTicks);
    if (segment) {
        const seekTo = segment.endTicks / 10000000;
        console.log(`⏩ Skipping ${segment.type} segment (seeking to ${seekTo.toFixed(2)}s)`);
        sendMpvCommand('seek', [seekTo, 'absolute+keyframes']);
        currentPositionSeconds = seekTo;
        if (currentItemId) reportPlaybackProgress(currentItemId, segment.endTicks);
        showSkipOsd(`Skipped ${segment.type.toLowerCase()}`);
    }
    isInIntroSegment = false;
    if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
}

function checkIntroSegment(positionTicks) {
    const segment = introSegments.find(seg => positionTicks >= seg.startTicks && positionTicks <= seg.endTicks);
    if (segment) {
        if (!isInIntroSegment) {
            isInIntroSegment = true;
            if (CONFIG.autoSkipIntros) {
                console.log(`🎬 Auto-skip: ${segment.type} detected, skipping in 3s...`);
                showSkipOsd(`Skipping ${segment.type.toLowerCase()} in 3s...`);
                skipIntroTimeout = setTimeout(skipIntro, 3000);
            } else {
                console.log(`🎬 ${segment.type} detected — press S to skip`);
                showSkipOsd(`Press S to skip ${segment.type.toLowerCase()}`);
            }
        }
    } else if (isInIntroSegment) {
        isInIntroSegment = false;
        if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
    }
}

function showSkipOsd(text) {
    sendMpvCommand('set_property', ['osd-font-size', 40]);
    sendMpvCommand('set_property', ['osd-align-x', 'right']);
    sendMpvCommand('set_property', ['osd-align-y', 'bottom']);
    sendMpvCommand('show-text', [text, 3000]);
}

function showErrorOsd(text) {
    const now = Date.now();
    if (now - lastErrorOsdTime < 30000) return;
    lastErrorOsdTime = now;
    sendMpvCommand('set_property', ['osd-font-size', 35]);
    sendMpvCommand('set_property', ['osd-align-x', 'right']);
    sendMpvCommand('set_property', ['osd-align-y', 'top']);
    sendMpvCommand('show-text', [text, 3000]);
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
        console.error('⚠️ Error getting episode info for new queue:', e.message);
        currentItemId = null;
        currentEpisodeInfo = null;
        isPlayingNext = false;
        return;
    }

    if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
        console.log('⚠️ MPV/IPC no longer available after loading queue info, falling back to playMedia');
        playMedia(itemId, startTicks).catch(err => {
            console.error('⚠️ Error playing media:', err.message);
        });
        return;
    }

    if (!currentEpisodeInfo.playable) {
        console.log(`⏭️ Skipping non-playable item: ${currentEpisodeInfo.title}`);
        currentItemId = null;
        currentEpisodeInfo = null;
        return;
    }

    playSessionId = crypto.randomUUID();
    markedWatched.clear();

    const titleText = currentEpisodeInfo.isSeries
        ? [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${currentEpisodeInfo.episodeNumber}`, currentEpisodeInfo.title].filter(Boolean).join(' - ')
        : (currentEpisodeInfo.title || String(itemId));

    console.log(`📺 Loading new queue: ${titleText}`);

    const savedAudioIndex = pendingAudioStreamIndex;
    const savedSubIndex = pendingSubtitleStreamIndex;

    sendMpvCommand('playlist-clear');
    const firstUrl = `${CONFIG.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${accessToken}`;
    sendMpvCommand('loadfile', [firstUrl, 'replace']);
    for (let i = 1; i < playQueue.length; i++) {
        const url = `${CONFIG.serverUrl}/Videos/${playQueue[i]}/stream?static=true&api_key=${accessToken}`;
        sendMpvCommand('loadfile', [url, 'append']);
    }
    console.log(`📋 Loaded ${playQueue.length} items into MPV playlist.`);

    if (savedAudioIndex !== undefined) {
        sendMpvCommand('set_property', ['aid', savedAudioIndex]);
        pendingAudioStreamIndex = undefined;
    }
    if (savedSubIndex !== undefined) {
        isSettingSubtitleFromJellyfin = true;
        if (subtitleFlagTimeout) clearTimeout(subtitleFlagTimeout);
        subtitleFlagTimeout = setTimeout(() => { isSettingSubtitleFromJellyfin = false; subtitleFlagTimeout = null; }, 5000);
        sendMpvCommand('set_property', ['sid', savedSubIndex]);
        pendingSubtitleStreamIndex = undefined;
    }

    if (startTicks > 0) {
        pendingStartSeconds = startTicks / 10000000;
    }

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

    if (CONFIG.fullscreen) {
        args.push('--fullscreen');
    }

    if (Array.isArray(CONFIG.mpvFlags)) {
        args.push(...CONFIG.mpvFlags);
    }

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
            isManualSkip = false;
            isSeeking = false;
            isNewQueueLoad = false;
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
                    console.log('📡 Loading playlist into MPV...');
                    sendMpvCommand('loadfile', [pendingStreamUrl, 'replace']);
                    console.log(`    ✅ Item 1/${playQueue.length} loaded.`);

                    for (let i = 1; i < playQueue.length; i++) {
                        const url = `${CONFIG.serverUrl}/Videos/${playQueue[i]}/stream?static=true&api_key=${accessToken}`;
                        sendMpvCommand('loadfile', [url, 'append']);
                    }
                    if (playQueue.length > 1) {
                        console.log(`    ✅ Appended ${playQueue.length - 1} more items to playlist.`);
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
            
            sendMpvCommand('keybind', ['>', 'script-message jellyfin-next']);
            sendMpvCommand('keybind', ['<', 'script-message jellyfin-prev']);
            sendMpvCommand('keybind', ['s', 'script-message jellyfin-skip-intro']);
            console.log('⌨️ Keys bound (>/< overridden for Jellyfin remote control, S for skip intro)');
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
                            if (query.timer) clearTimeout(query.timer);
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
    introSegments = [];
    isInIntroSegment = false;
    nextUpShown = false;
    if (skipIntroTimeout) { clearTimeout(skipIntroTimeout); skipIntroTimeout = null; }
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
        console.log('⏹️ Forcing previous MPV shutdown...');
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
            console.log('⚠️ isPlayingNext stuck for 30s, resetting');
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
                console.log(`🎬 Near end of last item (${currentPositionSeconds.toFixed(1)}s / ${currentDuration.toFixed(1)}s), querying NextUp`);
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
        const isSeekingEvent = isSeeking;
        const isNewQueueEvent = isNewQueueLoad;
        isSeeking = false;
        isNewQueueLoad = false;
        const isAutoAdvance = currentItemId && !pendingStreamUrl && !isManualSkip && !isSeekingEvent && !isNewQueueEvent;
        const isManualSkipEvent = isManualSkip && !isSeekingEvent && !isNewQueueEvent;
        isManualSkip = false;
        
        if (isAutoAdvance) {
            const prevItemId = currentItemId;
            const prevPos = currentPositionSeconds;
            const prevRuntime = currentEpisodeInfo?.itemRuntime || 0;
            const completionThreshold = 0.9;
            
            if (prevRuntime > 0 && prevPos >= prevRuntime * completionThreshold) {
                markItemAsWatched(prevItemId);
            }
            reportPlaybackStop(prevItemId, Math.round(prevPos * 10000000));
            stopProgressPoll();
            
            queuePosition++;
            if (queuePosition >= 0 && queuePosition < playQueue.length) {
                currentItemId = playQueue[queuePosition];
                console.log(`📋 Auto-advance: queuePosition=${queuePosition}, itemId=${currentItemId}`);
            } else {
                console.log(`📋 Auto-advance: queue exhausted (position=${queuePosition}, length=${playQueue.length})`);
                currentItemId = null;
            }
            currentPositionSeconds = 0;
            isPlayingNext = false;
        } else if (isManualSkipEvent && previousItemId) {
            console.log(`📋 Manual skip: prevItemId=${previousItemId}, newPos=${queuePosition}, newItemId=${currentItemId}`);
            reportPlaybackStop(previousItemId, Math.round(currentPositionSeconds * 10000000));
            previousItemId = null;
            stopProgressPoll();
            currentPositionSeconds = 0;
            isPlayingNext = false;
        }

        isReportingStop = false;
        console.log('✅ File loaded by MPV. Preparing Seek if necessary...');
        isPlayingNext = false;
        currentDuration = 0;
        nextUpShown = false;
        markedWatched.clear();
        
        if (pendingTitle) {
            sendMpvCommand('set_property', ['force-media-title', pendingTitle]);
            sendMpvCommand('set_property', ['title', pendingTitle]);
            pendingTitle = null;
        }

        if (isAutoAdvance && currentItemId) {
            getEpisodeInfo(currentItemId).then(info => {
                currentEpisodeInfo = info;
                const titleText = info.isSeries
                    ? [info.seriesName, `${info.seasonNumber}x${info.episodeNumber}`, info.title].filter(Boolean).join(' - ')
                    : (info.title || String(currentItemId));
                console.log(`▶️ Starting next episode: ${titleText}`);
                sendMpvCommand('set_property', ['force-media-title', `Jellyfin - ${titleText}`]);
                sendMpvCommand('set_property', ['title', `Jellyfin - ${titleText}`]);
                playSessionId = crypto.randomUUID();
                reportPlaybackStart(currentItemId, 0);
                startProgressReporting(currentItemId);
                startProgressPoll();
            });
        } else {
            startProgressPoll();
        }

        if (pendingStartSeconds > 0) {
            sendMpvCommand('seek', [pendingStartSeconds, 'absolute+keyframes']);
            console.log(`⏩ Automatic seek to saved position: ${pendingStartSeconds.toFixed(2)}s`);
            currentPositionSeconds = pendingStartSeconds;
        } else {
            currentPositionSeconds = 0;
        }
        if (currentItemId && !isAutoAdvance) reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
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

    if (event.event === 'property-change' && event.name === 'sid') {
        currentSubtitleTrack = event.data;
        if (isSettingSubtitleFromJellyfin) {
            isSettingSubtitleFromJellyfin = false;
            if (subtitleFlagTimeout) { clearTimeout(subtitleFlagTimeout); subtitleFlagTimeout = null; }
            return;
        }
        if (currentItemId) {
            const sid = event.data;
            console.log(`🔤 Subtitle changed in MPV: track ${sid}`);
            reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
        }
        return;
    }

    if (event.event === 'property-change' && event.name === 'seeking' && event.data === false) {
        if (currentItemId) reportPlaybackProgress(currentItemId, Math.round(currentPositionSeconds * 10000000));
        return;
    }

    if (event.event === 'client-message' && event.args && event.args[0]) {
        if (event.args[0] === 'jellyfin-next') {
            console.log('⏭️ Next episode requested (Keypress)');
            playNextEpisode();
        } else if (event.args[0] === 'jellyfin-prev') {
            console.log('⏮️ Previous episode requested (Keypress)');
            playPreviousEpisode();
        } else if (event.args[0] === 'jellyfin-skip-intro') {
            console.log('⏩ Skip intro requested (Keypress)');
            skipIntro();
        }
    }
}

async function playNextEpisode() {
    if (isPlayingNext) {
        console.log('⏭️ Already playing next episode, skipping duplicate call.');
        return;
    }
    isPlayingNext = true;
    isPlayingNextTimestamp = Date.now();

    if (playQueue.length > 0 && queuePosition < playQueue.length - 1) {
        previousItemId = currentItemId;
        isManualSkip = true;
        queuePosition++;
        currentItemId = playQueue[queuePosition];
        console.log(`▶️ Next in queue (${queuePosition + 1}/${playQueue.length})`);
        if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
            console.log('⚠️ MPV/IPC not available, cannot skip to next');
            isPlayingNext = false;
            isManualSkip = false;
            return;
        }
        sendMpvCommand('playlist-next');
        return;
    }

    if (!currentEpisodeInfo || !currentEpisodeInfo.isSeries) {
        console.log('ℹ️ Not a series, ending playback.');
        playQueue = [];
        queuePosition = -1;
        isPlayingNext = false;
        if (CONFIG.autoClose) {
            shutdown('auto-close');
        } else {
            killMpv();
        }
        return;
    }

    if (currentEpisodeInfo.nextEpisode) {
        const nextEp = currentEpisodeInfo.nextEpisode;
        const nextTitle = [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${nextEp.IndexNumber}`, nextEp.Name].filter(Boolean).join(' - ');
        console.log(`▶️ Starting next episode: ${nextTitle}`);
        if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
            playMedia(nextEp.Id, 0).catch(err => {
                console.error('⚠️ Error playing next episode:', err.message);
                isPlayingNext = false;
            });
            return;
        }
        const url = `${CONFIG.serverUrl}/Videos/${nextEp.Id}/stream?static=true&api_key=${accessToken}`;
        playQueue.push(nextEp.Id);
        previousItemId = currentItemId;
        queuePosition = playQueue.length - 1;
        currentItemId = nextEp.Id;
        isManualSkip = true;
        sendMpvCommand('loadfile', [url, 'append']);
        sendMpvCommand('playlist-next');
        return;
    }

    console.log('🔍 End of season, querying NextUp...');
    try {
        const nextUpId = await queryNextUp(currentEpisodeInfo.seriesId);
        if (nextUpId) {
            const nextUpInfo = await getEpisodeInfo(nextUpId);
            const nextUpTitle = nextUpInfo.isSeries
                ? [nextUpInfo.seriesName, `${nextUpInfo.seasonNumber}x${nextUpInfo.episodeNumber}`, nextUpInfo.title].filter(Boolean).join(' - ')
                : (nextUpInfo.title || String(nextUpId));
            console.log(`▶️ Starting next episode: ${nextUpTitle}`);
            if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
                playMedia(nextUpId, 0).catch(err => {
                    console.error('⚠️ Error playing next episode:', err.message);
                    isPlayingNext = false;
                });
                return;
            }
            const url = `${CONFIG.serverUrl}/Videos/${nextUpId}/stream?static=true&api_key=${accessToken}`;
            playQueue.push(nextUpId);
            previousItemId = currentItemId;
            queuePosition = playQueue.length - 1;
            currentItemId = nextUpId;
            isManualSkip = true;
            sendMpvCommand('loadfile', [url, 'append']);
            sendMpvCommand('playlist-next');
        } else {
            console.log('ℹ️ No more episodes, ending playback.');
            playQueue = [];
            queuePosition = -1;
            isPlayingNext = false;
            if (CONFIG.autoClose) {
                shutdown('auto-close');
            } else {
                killMpv();
            }
        }
    } catch (e) {
        console.log('⚠️ NextUp query failed, keeping playback alive:', e.message);
    }
}

async function queryNextUp(seriesId) {
    const headers = getAuthHeaders();
    const response = await axios.get(`${CONFIG.serverUrl}/Shows/NextUp`, {
        headers,
        params: { userId, seriesId, limit: 1 }
    });
    if (response.data.Items && response.data.Items.length > 0) {
        const nextEp = response.data.Items[0];
        console.log(`📺 NextUp from Jellyfin: ${nextEp.SeriesName} - S${nextEp.ParentIndexNumber}E${nextEp.IndexNumber} - ${nextEp.Name}`);
        return nextEp.Id;
    }
    return null;
}

async function playPreviousEpisode() {
    if (isPlayingNext) {
        console.log('⏭️ Already transitioning, skipping.');
        return;
    }
    isPlayingNext = true;
    isPlayingNextTimestamp = Date.now();

    if (currentPositionSeconds > 30) {
        console.log('↩️ Restarting current episode (time > 30s)');
        isSeeking = true;
        sendMpvCommand('seek', [0, 'absolute+keyframes']);
        currentPositionSeconds = 0;
        if (currentItemId) reportPlaybackProgress(currentItemId, 0);
        isPlayingNext = false;
        return;
    }

    if (playQueue.length > 0 && queuePosition > 0) {
        previousItemId = currentItemId;
        queuePosition--;
        currentItemId = playQueue[queuePosition];
        isManualSkip = true;
        console.log(`⏮️ Previous in queue (${queuePosition + 1}/${playQueue.length})`);
        sendMpvCommand('playlist-prev');
        return;
    }

    if (!currentEpisodeInfo || !currentEpisodeInfo.isSeries) {
        console.log('ℹ️ Not a series, ignoring Previous command.');
        isPlayingNext = false;
        return;
    }

    if (!currentEpisodeInfo.previousEpisode) {
        console.log('ℹ️ This is the first episode.');
        isPlayingNext = false;
        return;
    }

    const prevEp = currentEpisodeInfo.previousEpisode;
    const prevTitle = [currentEpisodeInfo.seriesName, `${currentEpisodeInfo.seasonNumber}x${prevEp.IndexNumber}`, prevEp.Name].filter(Boolean).join(' - ');
    console.log(`◀️ Starting previous episode: ${prevTitle}`);
    if (!ipcClient || ipcClient.destroyed || !mpvProcess) {
        playMedia(prevEp.Id, 0).catch(err => {
            console.error('⚠️ Error playing previous episode:', err.message);
            isPlayingNext = false;
        });
        return;
    }
    const url = `${CONFIG.serverUrl}/Videos/${prevEp.Id}/stream?static=true&api_key=${accessToken}`;
    previousItemId = currentItemId;
    playQueue.splice(queuePosition, 0, prevEp.Id);
    currentItemId = playQueue[queuePosition];
    isManualSkip = true;
    sendMpvCommand('loadfile', [url, 'insert-at-index', queuePosition]);
    sendMpvCommand('playlist-prev');
    return;
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
        SubtitleStreamIndex: pendingSubtitleStreamIndex !== undefined ? pendingSubtitleStreamIndex : (typeof currentSubtitleTrack === 'number' ? currentSubtitleTrack : undefined)
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
    for (const [, q] of pendingQueries) { if (q.timer) clearTimeout(q.timer); q.resolve(null); }
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
