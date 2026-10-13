// Live end-to-end test suite. Exercises the shim against a REAL Jellyfin server
// and a REAL mpv, asserting on shim logs, mpv IPC properties, and Jellyfin API
// state. Opt-in (not part of `npm test`, needs a working config.js):
//
//     npm run test:e2e            run everything
//     npm run test:e2e -- --only 9,16   run selected test numbers
//
// The suite runs headless (vo=null/ao=null via mpvFlags) on an isolated session
// (own deviceId + own IPC socket) so it never touches a production device or
// pops up windows. Watched/favorite state that tests mutate is restored.
import { spawn, execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { createRequire } = await import('module');
const cfg = createRequire(import.meta.url)(path.join(ROOT, 'config.js'));

const TEST_ID = `e2e-live-suite-${process.pid}`;  // unique per run: concurrent runs must not collide
const TEST_NAME = 'E2E Live Suite';
const IPC_SOCK = `/tmp/mpv-e2e-live-${process.pid}.sock`;
const TMP_CONFIG = path.join(os.tmpdir(), `e2e-live-${Date.now()}.js`);
const ONLY = (process.argv.find(a => a.startsWith('--only')) ? (process.argv[process.argv.indexOf('--only') + 1] || '').split(',').map(Number) : null);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- tiny assert runner ----------
const results = [];
let current = { name: '', ok: true, details: [] };
function check(cond, msg) {
    if (!cond) {
        current.ok = false;
        current.details.push(msg);
        throw new Error(msg);
    }
}
function eq(a, b, msg) { check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function near(a, b, tol, msg) { check(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ~${b} ±${tol})`); }

// ---------- Jellyfin API ----------
const api = axios.create({ baseURL: cfg.serverUrl, timeout: 15000 });
let authHeaders;
async function login(deviceId) {
    const r = await api.post('/Users/AuthenticateByName', { Username: cfg.username, Pw: cfg.password }, {
        headers: { 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="${TEST_NAME}", Device="${TEST_NAME}", DeviceId="${deviceId}", Version="1.0.0"` }
    });
    return { Authorization: `MediaBrowser Token="${r.data.AccessToken}", Client="${TEST_NAME}", Device="${TEST_NAME}", DeviceId="${deviceId}", Version="1.0.0"`, userId: r.data.User.Id };
}
const get = (url, params) => api.get(url, { headers: authHeaders, params, paramsSerializer: { indexes: null }, validateStatus: () => true });
const post = (url, body, params) => api.post(url, body ?? {}, { headers: authHeaders, params, paramsSerializer: { indexes: null }, validateStatus: () => true });
const del = (url) => api.delete(url, { headers: authHeaders, validateStatus: () => true });

async function findSession() {
    const r = await get('/Sessions');
    return (r.data || []).find(s => s.DeviceId === TEST_ID);
}
async function playItem(itemId, { startTicks, playCommand, startIndex, audioStreamIndex, subtitleStreamIndex } = {}) {
    const ses = await findSession();
    check(ses, 'test session not found');
    void 0;
    const params = { playCommand: playCommand || 'PlayNow', itemIds: itemId };
    if (startTicks !== undefined) params.startPositionTicks = startTicks;
    if (startIndex !== undefined) params.startIndex = startIndex;
    if (audioStreamIndex !== undefined) params.audioStreamIndex = audioStreamIndex;
    if (subtitleStreamIndex !== undefined) params.subtitleStreamIndex = subtitleStreamIndex;
    const r = await post(`/Sessions/${ses.Id}/Playing`, null, params);
    check(r.status < 400, `Play request rejected: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
    return r;
}
async function playstate(cmd, extra = {}) {
    const ses = await findSession();
    const r = await post(`/Sessions/${ses.Id}/Playing/${cmd}`, null, extra);
    check(r.status < 400, `Playstate ${cmd} rejected: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
    return r;
}
async function generalCmd(name, args = {}) {
    const ses = await findSession();
    // Argument values are strings on the wire (ClientCapabilities/GeneralCommand)
    const strArgs = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)]));
    const r = await post(`/Sessions/${ses.Id}/Command`, { Name: name, Arguments: strArgs });
    check(r.status < 400, `GeneralCommand ${name} rejected: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
    return r;
}

// ---------- shim process ----------
let shimProc, shimOut = '';
function startShim(configPath = TMP_CONFIG) {
    shimOut = '';
    shimProc = spawn('node', ['shim.js', configPath], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    shimProc.stdout.on('data', d => shimOut += d);
    shimProc.stderr.on('data', d => shimOut += d);
}
async function waitFor(pattern, timeoutMs = 20000, label) {
    const t0 = Date.now();
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    while (Date.now() - t0 < timeoutMs) {
        if (re.test(shimOut)) return;
        await sleep(150);
    }
    check(false, `timeout waiting for ${label || pattern} — tail: ...${shimOut.slice(-500)}`);
}
async function stopShim() {
    if (!shimProc) return;
    shimProc.kill('SIGTERM');
    await sleep(1500);
    try { shimProc.kill('SIGKILL'); } catch {}
    shimProc = null;
    try { execSync('pkill -f "mpv-ipc-e2e-live" 2>/dev/null'); } catch {}
}

function markLog() { return shimOut.length; }
async function waitForSince(mark, pattern, timeoutMs = 30000, label) {
    const t0 = Date.now();
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    while (Date.now() - t0 < timeoutMs) {
        if (re.test(shimOut.slice(mark))) return;
        await sleep(150);
    }
    check(false, `timeout waiting for ${label || pattern} — tail: ...${shimOut.slice(-400)}`);
}
// Play an item and wait until mpv has DEFINITELY loaded it (the "File loaded by
// MPV" contract line). Polling `path` alone is not enough: the path updates when
// loading starts, and seeks sent during loading are dropped.
async function playAndWait(itemId, opts) {
    const m = markLog();
    await playItem(itemId, opts);
    // Match the load for THIS play command only — a previous test's in-flight
    // transition can emit its own "File loaded by MPV" after our mark.
    await waitForSince(m, 'Play command data', 15000);
    const m2 = markLog();
    await waitForSince(m2, 'File loaded by MPV', 40000);
    await connectIpcWhenReady();
    await waitForMpvPath(itemId);
    await sleep(500);
}
// mpv rejects seeks while a file is still loading ("error running command") —
// retry until accepted. Success resolves to the command's data (null for seek);
// failures resolve to { __error }.
async function seekWhenReady(target, flags = 'absolute') {
    for (let i = 0; i < 25; i++) {
        const r = await mpvCmd('seek', target, flags);
        if (!r || !r.__error) { await sleep(350); return; }
        await sleep(300);
    }
    check(false, `mpv never accepted seek to ${target}`);
}

// ---------- mpv IPC (the suite's own socket) ----------
let ipc = null, ipcBuf = '', ipcId = 1;
const ipcPending = new Map();
function ipcConnect() {
    return new Promise((resolve, reject) => {
        ipc = net.connect(IPC_SOCK);
        ipc.on('data', d => {
            ipcBuf += d.toString();
            const lines = ipcBuf.split('\n');
            ipcBuf = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                let r; try { r = JSON.parse(line); } catch { continue; }
                if (r.request_id !== undefined && ipcPending.has(r.request_id)) {
                    const p = ipcPending.get(r.request_id);
                    ipcPending.delete(r.request_id);
                    p.resolve(r.error === 'success' ? r.data : { __error: r.error });
                }
            }
        });
        ipc.on('close', () => { ipc = null; });
        ipc.on('connect', resolve);
        ipc.on('error', reject);
    });
}
function mpvCmd(command, ...args) {
    return new Promise(resolve => {
        if (!ipc || ipc.destroyed) { resolve({ __error: 'no-ipc' }); return; }
        const id = ipcId++;
        const t = setTimeout(() => { ipcPending.delete(id); resolve({ __error: 'timeout' }); }, 4000);
        ipcPending.set(id, { resolve: v => { clearTimeout(t); resolve(v); } });
        ipc.write(JSON.stringify({ command: [command, ...args], request_id: id }) + '\n');
    });
}
const mpvGet = (p) => mpvCmd('get_property', p);
const mpvSet = (p, v) => mpvCmd('set_property', p, v);
// NOTE: mpv's `filename` property is only the last path component (for stream
// URLs that is "stream?static=true&ApiKey=..."), so identity checks must use `path`.
function itemIdOf(p) {
    const m = /\/Videos\/([a-f0-9]+)/i.exec(String(p || ''));
    return m ? m[1] : String(p || '');
}
async function mpvPlaylist() {
    const n = await mpvGet('playlist-count');
    const out = [];
    for (let i = 0; i < (n || 0); i++) out.push(itemIdOf(await mpvGet(`playlist/${i}/filename`)));
    return out;
}
async function waitForMpvPath(expectedId, timeoutMs = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const p = await mpvGet('path');
        // `duration` only exists once the file is actually loaded — matching `path`
        // alone races the load (it updates when loading STARTS)
        const d = await mpvGet('duration');
        if (typeof p === 'string' && (!expectedId || p.includes(expectedId)) && typeof d === 'number' && d > 0) return p;
        await sleep(250);
    }
    check(false, `mpv never finished loading ${expectedId || 'a file'} (last: ${JSON.stringify(await mpvGet('path'))}, dur: ${JSON.stringify(await mpvGet('duration'))})`);
}
async function connectIpcWhenReady(timeoutMs = 25000) {
    if (ipc && !ipc.destroyed) return;
    ipc = null;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (fs.existsSync(IPC_SOCK)) {
            try { await ipcConnect(); return; } catch {}
        }
        await sleep(250);
    }
    check(false, 'test IPC socket never appeared');
}

// ---------- config fixture ----------
function writeConfig({ autoClose = false, headless = true } = {}) {
    fs.writeFileSync(TMP_CONFIG, `module.exports = {
    serverUrl: '${cfg.serverUrl}',
    username: '${cfg.username}',
    password: '${cfg.password}',
    mpvPath: '${cfg.mpvPath}',
    deviceName: '${TEST_NAME}',
    deviceId: '${TEST_ID}',
    ipcSocketPath: '${IPC_SOCK}',
    mpvFlags: ['--vo=null', '--ao=null', '--force-window=no'],
    headless: ${headless},
    verbose: true,
    autoClose: ${autoClose},
};
`);
}

// ---------- discovery ----------
async function discoverItems() {
    const items = {};
    const movies = await get(`/Users/${authHeaders.userId}/Items`, { IncludeItemTypes: 'Movie', Limit: 5, Fields: 'MediaStreams,RunTimeTicks' });
    items.movie = (movies.data.Items || [])[0];
    items.movie2 = (movies.data.Items || [])[1];
    check(items.movie && items.movie2, 'need at least 2 movies in library');

    // multi-track item: >=2 subtitle streams or >=2 audio streams
    const episodes = await get(`/Users/${authHeaders.userId}/Items`, { IncludeItemTypes: 'Episode', Limit: 30, Fields: 'MediaStreams,RunTimeTicks' });
    for (const it of episodes.data.Items || []) {
        // ParentIndexNumber > 0: specials (season 0) are deliberately redirected by
        // the shim to the NextUp episode of the regular season, so they cannot be
        // used as fixtures for "play THIS item" assertions.
        if (!(it.ParentIndexNumber > 0)) continue;
        const streams = it.MediaStreams || [];
        const subs = streams.filter(s => s.Type === 'Subtitle');
        const auds = streams.filter(s => s.Type === 'Audio');
        if (!items.multiTrack && (subs.length >= 2 || auds.length >= 2)) items.multiTrack = { ...it, subs, auds };
        if (items.multiTrack && items.multiTrack.subs.length >= 2 && items.multiTrack.auds.length >= 2) break;
    }
    check(items.multiTrack, 'no multi-track episode in library');

    // an episode with a season behind it (for queue/advance tests) + segments
    const nextUp = await get('/Shows/NextUp', { userId: authHeaders.userId, limit: 5 });
    for (const ep of nextUp.data.Items || []) {
        const full = await get(`/Users/${authHeaders.userId}/Items/${ep.Id}`, { fields: 'MediaStreams,RunTimeTicks,UserData' });
        const segs = await get(`/MediaSegments/${ep.Id}`, { includeSegmentTypes: ['Intro', 'Outro'] });
        const season = await get(`/Shows/${full.data.SeriesId}/Episodes`, { seasonId: full.data.SeasonId, userId: authHeaders.userId, fields: 'IndexNumber,RunTimeTicks' });
        const list = (season.data.Items || []).sort((a, b) => a.IndexNumber - b.IndexNumber);
        const idx = list.findIndex(e => e.Id === ep.Id);
        if (idx >= 0 && list.length >= 2 && list.every(e => e.ParentIndexNumber > 0)) {
            items.episode = { ...full.data, seasonList: list, seasonIndex: idx, segments: segs.data.Items || [] };
            // Same id set the shim's expansion uses; specials-free so a shuffled
            // first item cannot trigger the season-0 NextUp redirect.
            items.shuffleSeason = list;
            break;
        }
    }
    check(items.episode, 'no NextUp episode with a multi-episode season found');
    return items;
}

// ---------- tests ----------
const tests = [];
const t = (num, name, fn) => tests.push({ num, name, fn });

t(1, 'startup: connects, registers capabilities incl. SetShuffleQueue', async () => {
    await waitFor('WebSocket connection established', 30000);
    await waitFor('Script started correctly', 10000);
    await sleep(800);
    const ses = await findSession();
    check(ses, 'session not listed');
    check((ses.Capabilities && ses.Capabilities.SupportedCommands || []).includes('SetShuffleQueue'),
        'SetShuffleQueue not advertised in session capabilities');
    const f = await get(`/Users/${authHeaders.userId}/Items`, { Limit: 1 });
    check(f.status === 200, 'API not reachable with suite token');
});

t(2, 'PlayNow movie: loads, reports playing, emits title contract', async ({ items }) => {
    const m = markLog();
    await playItem(items.movie.Id);
    await waitForSince(m, 'PLAY command received', 10000);
    await waitForSince(m, 'Starting episode: ', 15000);
    await waitForSince(m, 'File loaded by MPV', 30000);
    await connectIpcWhenReady();
    await waitForMpvPath(items.movie.Id);
    const ses = await findSession();
    check(ses.PlayState && ses.PlayState.PlayMethod, 'session PlayState not reporting');
});

t(3, 'Playstate pause/unpause/playpause', async () => {
    await playstate('Pause'); await sleep(700);
    eq(await mpvGet('pause'), true, 'Pause command did not pause mpv');
    await waitFor('Playback paused', 5000);
    await playstate('Unpause'); await sleep(700);
    eq(await mpvGet('pause'), false, 'Unpause command did not resume mpv');
    await playstate('PlayPause'); await sleep(700);
    eq(await mpvGet('pause'), true, 'PlayPause did not toggle');
    await playstate('PlayPause'); await sleep(500);
});

t(4, 'Playstate seek/rewind/fastforward', async () => {
    await playstate('Seek', { seekPositionTicks: 30 * 10000000 }); await sleep(900);
    near(await mpvGet('time-pos'), 30, 8, 'Seek to 30s');
    await playstate('Rewind'); await sleep(900);
    near(await mpvGet('time-pos'), 20, 8, 'Rewind 10s');
    await playstate('FastForward'); await sleep(900);
    near(await mpvGet('time-pos'), 30, 8, 'FastForward 10s');
});

t(5, 'Volume up/down/set and mute/unmute/toggle', async () => {
    await mpvSet('volume', 50); await sleep(300);
    await generalCmd('VolumeUp'); await sleep(500);
    near(await mpvGet('volume'), 55, 2, 'VolumeUp +5');
    await generalCmd('VolumeDown'); await sleep(500);
    near(await mpvGet('volume'), 50, 2, 'VolumeDown -5');
    await generalCmd('SetVolume', { Volume: 33 }); await sleep(500);
    near(await mpvGet('volume'), 33, 2, 'SetVolume 33');
    await generalCmd('Mute'); await sleep(400);
    eq(await mpvGet('mute'), true, 'Mute');
    await generalCmd('Unmute'); await sleep(400);
    eq(await mpvGet('mute'), false, 'Unmute');
    await generalCmd('ToggleMute'); await sleep(400);
    eq(await mpvGet('mute'), true, 'ToggleMute');
    await generalCmd('ToggleMute'); await sleep(300);
});

t(6, 'SetRepeatMode maps to mpv loop properties', async () => {
    await generalCmd('SetRepeatMode', { RepeatMode: 'RepeatAll' }); await sleep(500);
    eq(await mpvGet('loop-playlist'), 'inf', 'RepeatAll -> loop-playlist=inf');
    await generalCmd('SetRepeatMode', { RepeatMode: 'RepeatOne' }); await sleep(500);
    eq(await mpvGet('loop-file'), 'inf', 'RepeatOne -> loop-file=inf');
    await generalCmd('SetRepeatMode', { RepeatMode: 'RepeatNone' }); await sleep(500);
    check((await mpvGet('loop-playlist')) !== 'inf', 'RepeatNone did not clear loop-playlist');
});

t(7, 'DisplayMessage pauses for 10s then restores', async () => {
    await playstate('Unpause'); await sleep(400);
    await generalCmd('DisplayMessage', { Header: 'E2E', Text: 'hello from the suite' }); await sleep(1200);
    eq(await mpvGet('pause'), true, 'DisplayMessage should pause playback');
    await sleep(10500);
    eq(await mpvGet('pause'), false, 'DisplayMessage should resume after 10s');
});

t(8, 'track mapping: Jellyfin stream indices select the right mpv tracks', async ({ items }) => {
    const { subs, auds } = items.multiTrack;
    await playAndWait(items.multiTrack.Id);
    if (subs.length >= 2) {
        await generalCmd('SetSubtitleStreamIndex', { Index: subs[1].Index }); await sleep(800);
        eq(await mpvGet('sid'), 2, `SetSubtitleStreamIndex(${subs[1].Index}) must select mpv sid 2`);
        // Jellyfin-initiated changes are echo-guarded (no immediate progress report),
        // so the session reflects it on the next 10s progress tick.
        await sleep(11000);
        const ses = await findSession();
        near(ses.PlayState.SubtitleStreamIndex, subs[1].Index, 0.5,
            'session must report the Jellyfin stream index back (not the mpv id)');
        await generalCmd('SetSubtitleStreamIndex', { Index: subs[0].Index }); await sleep(800);
        eq(await mpvGet('sid'), 1, `SetSubtitleStreamIndex(${subs[0].Index}) must select mpv sid 1`);
        await generalCmd('SetSubtitleStreamIndex', { Index: -1 }); await sleep(600);
        check([false, 'no', null].includes(await mpvGet('sid')), 'Index -1 must disable subtitles');
    }
    if (auds.length >= 2) {
        await generalCmd('SetAudioStreamIndex', { Index: auds[1].Index }); await sleep(800);
        eq(await mpvGet('aid'), 2, `SetAudioStreamIndex(${auds[1].Index}) must select mpv aid 2`);
    }
});

t(9, 'episode PlayNow expands to the full season at the right index', async ({ items }) => {
    const ep = items.episode;
    const m = markLog();
    await playItem(ep.Id);
    await waitForSince(m, 'Full season queue:', 20000);
    await waitForSince(m, 'File loaded by MPV', 30000);
    await connectIpcWhenReady();
    await waitForMpvPath(items.episode.Id);
    await sleep(500);
    const pl = await mpvPlaylist();
    eq(pl.length, ep.seasonList.length, 'playlist length must equal season episode count');
    const cur = await mpvGet('playlist-current-pos');
    eq(cur, ep.seasonIndex, 'playback must start at the clicked episode index');
    const started = itemIdOf(await mpvGet('path'));
    check(started === ep.Id, `wrong episode started: ${started}`);
});

t(10, 'resume: StartPositionTicks seeks mpv to the saved position', async ({ items }) => {
    await playAndWait(items.movie.Id, { startTicks: 60 * 10000000 });
    await sleep(1200);
    near(await mpvGet('time-pos'), 60, 12, 'resume position ~60s');
});

t(11, 'PlayNext/PlayLast insert into the playlist WITHOUT starting playback', async ({ items }) => {
    await playAndWait(items.episode.Id);
    const before = await mpvGet('playlist-current-pos');
    const beforeFile = itemIdOf(await mpvGet('path'));
    const r1 = await playItem(items.movie.Id, { playCommand: 'PlayNext' });
    check(r1.status < 400, 'PlayNext rejected');
    await sleep(1200);
    // NOTE: PlayLast must use a movie — the server expands a single episode to
    // its whole series queue before forwarding (SessionManager.SendPlayCommand).
    const r2 = await playItem(items.movie2.Id, { playCommand: 'PlayLast' });
    check(r2.status < 400, 'PlayLast rejected');
    await sleep(1200);
    const after = await mpvGet('playlist-current-pos');
    const afterFile = itemIdOf(await mpvGet('path'));
    eq(after, before, 'PlayNext/PlayLast must not change the playing item');
    eq(afterFile, beforeFile, 'PlayNext/PlayLast must not switch files');
    const pl = await mpvPlaylist();
    check(pl.includes(items.movie.Id), 'PlayNext item missing from playlist');
    check(pl[pl.length - 1] === items.movie2.Id, 'PlayLast item must be at the end');
});

t(12, 'PlayShuffle (web-UI flow): shuffled order survives to the playlist', async ({ items }) => {
    // jellyfin-web sends ALL season ids with PlayShuffle; the server shuffles them
    // and forwards PlayNow + the shuffled list. The shim must NOT re-sort it.
    // (Server-side note: single-id PlayShuffle is expanded in canonical order by
    // Jellyfin before it reaches any client - not fixable client-side.)
    const season = items.shuffleSeason;
    const m = markLog();
    await playItem(season.map(e => e.Id).join(','), { playCommand: 'PlayShuffle' });
    await waitForSince(m, 'File loaded by MPV', 40000);
    await connectIpcWhenReady();
    const seg = shimOut.slice(m);
    const line = seg.split('\n').find(l => l.includes('Play command data')) || '';
    const sent = (line.match(/itemIds":\[(.*?)\]/) || [, ''])[1].split(',').map(x => x.slice(1, 9));
    check(sent.length === season.length, `expected ${season.length} ids in the play message, got ${sent}`);
    const pl = await mpvPlaylist();
    eq(pl.map(x => x.slice(0, 8)), sent, 'playlist must keep the server-shuffled order');
    const started = itemIdOf(await mpvGet('path'));
    check(started.slice(0, 8) === sent[0], `playback must start at the first shuffled item (got ${started.slice(0, 8)})`);
});
t(13, 'SetShuffleQueue reorders the playlist but keeps playback', async () => {
    const beforeFile = await mpvGet('filename');
    const posBefore = await mpvGet('time-pos');
    await generalCmd('SetShuffleQueue'); await sleep(1200);
    const afterFile = await mpvGet('filename');
    eq(afterFile, beforeFile, 'shuffle must not restart the current item');
    const posAfter = await mpvGet('time-pos');
    check(typeof posAfter === 'number' && posAfter >= (typeof posBefore === 'number' ? posBefore - 1 : 0),
        'playback must keep running across shuffle');
    await waitFor('Queue shuffled by server', 8000);
});

t(14, 'SetPlaybackOrder uses playlist-shuffle/unshuffle', async () => {
    const before = await mpvPlaylist();
    check(before.length >= 2, `want a 2+ item queue for shuffle discrimination, got ${before.length}`);
    let changed = false;
    for (let i = 0; i < 8 && !changed; i++) {
        await generalCmd('SetPlaybackOrder', { PlaybackOrder: 'Shuffle' }); await sleep(900);
        changed = JSON.stringify(before) !== JSON.stringify(await mpvPlaylist());
        if (!changed) {
            await generalCmd('SetPlaybackOrder', { PlaybackOrder: 'Default' }); await sleep(400);
        }
    }
    check(changed, 'Shuffle did not reorder the playlist after 8 attempts');
    await generalCmd('SetPlaybackOrder', { PlaybackOrder: 'Default' }); await sleep(400);
});
t(15, 'NextTrack / PreviousTrack navigate the playlist', async () => {
    const before = await mpvGet('playlist-current-pos');
    await playstate('NextTrack'); await sleep(1500);
    const afterNext = await mpvGet('playlist-current-pos');
    check(afterNext > before, `NextTrack did not advance (${before} -> ${afterNext})`);
    await waitFor(/Starting next episode|Playlist changed/, 10000);
    await sleep(2500);
    // seek back early in the file so PreviousTrack goes to the previous item (<=30s rule)
    await seekWhenReady(5);
    await playstate('PreviousTrack'); await sleep(1500);
    const afterPrev = await mpvGet('playlist-current-pos');
    check(afterPrev < afterNext, `PreviousTrack did not go back (${afterNext} -> ${afterPrev})`);
    // NextTrack/PreviousTrack can kick off async transition work (NextUp queries
    // with retries) that lands AFTER this test returns and would clobber the
    // next test's playback — let it settle first.
    await sleep(4500);
});

t(16, 'skip intro: S-key wire path seeks past the segment', async ({ items }) => {
    const ep = items.episode;
    // Fetch segments fresh and clamp to the real duration: Jellyfin segment/runtime
    // metadata can disagree with the actual media file, and the NextUp-based
    // fixture can drift between runs.
    const segResp = await get(`/MediaSegments/${ep.Id}`, { includeSegmentTypes: ['Intro', 'Outro'] });
    const seg = (segResp.data?.Items || []).find(s => s.Type === 'Intro');
    if (!seg) { current.details.push('no Intro segment on the chosen episode - skipped'); return; }
    await playAndWait(ep.Id);
    const dur = await mpvGet('duration');
    check(typeof dur === 'number' && dur > 5, `unexpected duration ${JSON.stringify(dur)}`);
    const introEnd = Math.min(seg.EndTicks / 10000000, dur - 2);
    const startSec = Math.min(seg.StartTicks / 10000000 + 5, Math.max(introEnd - 2, 1));
    await seekWhenReady(startSec);
    await mpvCmd('script-message', 'jellyfin-skip-intro');
    await sleep(1500);
    const pos = await mpvGet('time-pos');
    check(typeof pos === 'number', `no position after skip (got ${JSON.stringify(pos)})`);
    check(pos >= introEnd - 2, `skip did not jump past intro end (pos=${pos}, introEnd=${introEnd}, dur=${dur})`);
    await waitFor(/Skip intro requested/, 5000);
});

t(17, 'OSC wire path: toggle-favorite flips favorite in Jellyfin', async ({ items }) => {
    await playAndWait(items.movie.Id);
    const before = await get(`/Users/${authHeaders.userId}/Items/${items.movie.Id}`);
    const wasFav = !!before.data.UserData?.IsFavorite;
    await mpvCmd('script-message', 'shim-jf-osc-action', 'toggle-favorite');
    await sleep(1800);
    const after = await get(`/Users/${authHeaders.userId}/Items/${items.movie.Id}`);
    check(!!after.data.UserData?.IsFavorite !== wasFav, 'favorite state did not flip');
    await mpvCmd('script-message', 'shim-jf-osc-action', 'toggle-favorite'); // restore
    await sleep(1200);
    const restored = await get(`/Users/${authHeaders.userId}/Items/${items.movie.Id}`);
    check(!!restored.data.UserData?.IsFavorite === wasFav, 'favorite restore failed');
});

t(18, 'next-up notification fires near the end of an episode', async ({ items }) => {
    const ep = items.episode;
    const nextEp = ep.seasonList[ep.seasonIndex + 1];
    if (!nextEp) { current.details.push('chosen episode is last in season — skipped'); return; }
    await playAndWait(items.episode.Id);
    const dur = await mpvGet('duration');
    check(typeof dur === 'number' && dur > 30, `unexpected duration ${dur}`);
    await seekWhenReady(dur - 12);
    shimOut = shimOut.replace(/Next up:/g, 'Next up-seen:'); // isolate this test's marker
    await waitFor('Next up:', 15000);
});

t(19, 'auto-advance: reaching EOF moves to the next episode', async ({ items }) => {
    const ep = items.episode;
    const nextEp = ep.seasonList[ep.seasonIndex + 1];
    if (!nextEp) { current.details.push('chosen episode is last in season — skipped'); return; }
    await playAndWait(items.episode.Id);
    const dur = await mpvGet('duration');
    await seekWhenReady(dur - 0.4);
    await waitFor('Starting next episode', 25000);
    await sleep(1500);
    const f = await mpvGet('filename');
    check(String(f).includes(nextEp.Id), `did not advance to next episode (got ${f})`);
});

t(20, 'mark watched at 90%+ and restore unplayed afterwards', async ({ items }) => {
    const ep = items.episode;
    const before = await get(`/Users/${authHeaders.userId}/Items/${ep.Id}`);
    const wasPlayed = !!before.data.UserData?.Played;
    try {
        await playAndWait(items.episode.Id);
        const dur = await mpvGet('duration');
        check(typeof dur === 'number' && dur > 10, `unexpected duration ${JSON.stringify(dur)}`);
        // 97% keeps margin against stream-duration estimates (Jellyfin runtime is
        // the mark threshold; mpv's duration can differ slightly)
        await seekWhenReady(dur * 0.97); await sleep(1000);
        const pos = await mpvGet('time-pos');
        check(typeof pos === 'number' && pos > dur * 0.9, `seek did not land near end (pos=${pos}, dur=${dur})`);
        await playstate('Stop');
        // markItemAsWatched is an async API call — poll for it
        let played = false;
        for (let i = 0; i < 15 && !played; i++) {
            await sleep(1000);
            const poll = await get(`/Users/${authHeaders.userId}/Items/${ep.Id}`);
            played = !!poll.data.UserData?.Played;
        }
        check(played, `item was not marked watched at 97% (wasPlayed at start: ${wasPlayed}, pos=${pos}, dur=${dur}, file: ${itemIdOf(await mpvGet('path'))}, runtime: ${(items.episode.RunTimeTicks || 0) / 1e7}shimlog: ${(shimOut.split('\n').filter(l => /watched|mark/i.test(l)).slice(-4)).join(' | ')})`);
    } finally {
        if (!wasPlayed) {
            await del(`/Users/${authHeaders.userId}/PlayedItems/${ep.Id}`);
        }
    }
});

t(21, 'autoClose quits mpv when playback ends', async ({ items }) => {
    await stopShim();
    writeConfig({ autoClose: true });
    startShim();
    await waitFor('WebSocket connection established', 30000);
    await playAndWait(items.movie.Id);
    const dur = await mpvGet('duration');
    await seekWhenReady(dur - 0.4);
    await waitFor(/Auto-close enabled/, 30000);
    await waitFor(/ending playback|No more episodes/, 15000);
    // restore the default fixture for the remaining tests
    await stopShim();
    writeConfig();
    startShim();
    await waitFor('WebSocket connection established', 30000);
});

t(22, 'SyncPlay: create, leave, and join groups through the OSC wire path', async ({ items }) => {
    await playAndWait(items.movie.Id);
    // own group: create + leave (no other members, so no forced Stop sync)
    await mpvCmd('script-message', 'shim-jf-osc-action', 'syncplay-new');
    await waitFor('Created new SyncPlay group', 12000);
    await mpvCmd('script-message', 'shim-jf-osc-action', 'syncplay-disable');
    await waitFor('Left SyncPlay group', 12000);
    // foreign group: joining works (the group owner is idle, so the server will
    // sync us to stopped — that is correct SyncPlay behavior, not a bug)
    const r1 = await post('/SyncPlay/New');
    check(r1.status < 400, `SyncPlay/New failed: ${r1.status}`);
    const list = await get('/SyncPlay/List');
    const group = (list.data || [])[0];
    check(group, 'no SyncPlay group after New');
    const m = markLog();
    await mpvCmd('script-message', 'shim-jf-osc-action', 'syncplay-join', String(group.GroupId));
    await waitForSince(m, /Joined SyncPlay group/, 12000);
});
t(23, 'security: token never appears in shim logs', async () => {
    const r = await api.post('/Users/AuthenticateByName', { Username: cfg.username, Pw: cfg.password }, {
        headers: { 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="x", Device="x", DeviceId="tokcheck", Version="1.0"` }
    });
    check(!shimOut.includes(r.data.AccessToken), 'access token leaked into logs');
    check(!shimOut.includes(cfg.password), 'password leaked into logs');
});

t(24, 'shutdown: lock file cleaned, session stops', async () => {
    const lockPath = path.join(ROOT, 'data', `${path.basename(TMP_CONFIG, '.js')}.lock`);
    check(fs.existsSync(lockPath), 'lock file missing while running');
    await stopShim();
    await sleep(800);
    check(!fs.existsSync(lockPath), 'lock file not cleaned up on shutdown');
    check(/Closing application/.test(shimOut), 'shutdown contract missing');
});

// ---------- runner ----------
async function main() {
    writeConfig();
    const loginInfo = await login('e2e-runner');
    authHeaders = loginInfo;
    const items = await discoverItems();
    console.log(`Discovered: movie="${items.movie.Name}", multiTrack="${items.multiTrack.Name}" (${items.multiTrack.subs.length} subs/${items.multiTrack.auds.length} aud), episode="${items.episode.Name}" S${items.episode.ParentIndexNumber}E${items.episode.IndexNumber} @index ${items.episode.seasonIndex}/${items.episode.seasonList.length}, segments: ${items.episode.segments.map(s => s.Type).join(',') || 'none'}\n`);

    startShim();
    // always wait for the shim to be connected before running any selected tests
    await waitFor('WebSocket connection established', 30000);
    await waitFor('Script started correctly', 10000);
    try {
        for (const test of tests) {
            if (ONLY && !ONLY.includes(test.num)) continue;
            current = { name: `${test.num}. ${test.name}`, ok: true, details: [] };
            const t0 = Date.now();
            try {
                await test.fn({ items });
                results.push({ ...current, pass: true, ms: Date.now() - t0 });
                console.log(`✅ PASS  ${current.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
            } catch (e) {
                results.push({ ...current, pass: false, ms: Date.now() - t0, error: e.message });
                console.log(`❌ FAIL  ${current.name}  — ${e.message}`);
                const interesting = shimOut.split('\n').filter(l =>
                    /→|General command|Play command data|Playlist changed|Starting|Already playing|MPV Error|error|No more|Queue|shuffled|Skip intro|SyncPlay|File loaded|watched|report|Report|mark/i.test(l)).slice(-12);
                for (const l of interesting) console.log(`      dbg| ${l.trim().slice(0, 160)}`);
            }
            // revive the shim if a test left it dead
            if (!shimProc && test.num !== 24) {
                writeConfig();
                startShim();
                await waitFor('WebSocket connection established', 30000);
                await connectIpcWhenReady().catch(() => {});
            }
        }
    } finally {
        await stopShim();
        try { fs.unlinkSync(TMP_CONFIG); } catch {}
        try { execSync('pkill -f "mpv-e2e-live-${process.pid}" 2>/dev/null'); } catch {}
        if (ipc) try { ipc.destroy(); } catch {}
    }

    const pass = results.filter(r => r.pass).length;
    console.log(`\n========== SUMMARY: ${pass}/${results.length} passed ==========`);
    for (const r of results.filter(r => !r.pass)) {
        console.log(`FAILED: ${r.name}\n   ${r.error || r.details.join('; ')}`);
    }
    process.exit(pass === results.length ? 0 : 1);
}

main().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
