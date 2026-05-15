// ── Theme ─────────────────────────────────────────────────────────────────
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vp:theme', theme);
    document.getElementById('themeStylish').classList.toggle('active', theme === 'stylish');
    document.getElementById('themeRetro').classList.toggle('active', theme === 'retro');

    const emptyText = document.getElementById('emptyText');
    const emptyIcon = document.querySelector('.empty-icon');
    if (theme === 'retro') {
        emptyText.innerHTML = '&gt; NO MEDIA LOADED<span class="empty-cursor"></span>';
        emptyIcon.textContent = '█';
    } else {
        emptyText.textContent = 'Select a video or audio file to begin';
        emptyIcon.textContent = '▶';
    }
}

const savedTheme = localStorage.getItem('vp:theme') || 'stylish';
setTheme(savedTheme);

document.getElementById('themeStylish').onclick = () => setTheme('stylish');
document.getElementById('themeRetro').onclick   = () => setTheme('retro');

// ── Player ────────────────────────────────────────────────────────────────
const player = videojs('player', {
    controls: true,
    autoplay: false,
    preload: 'auto',
    fluid: true,
    aspectRatio: '16:9',
    playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
});

const mediaInput     = document.getElementById('mediaInput');
const subtitleInput  = document.getElementById('subtitleInput');
const delayDisplay   = document.getElementById('delayDisplay');
const waveformCanvas = document.getElementById('waveform');
const app            = document.getElementById('app');

// ── Empty state ───────────────────────────────────────────────────────────
const emptyState = document.getElementById('emptyState');
player.on('loadedmetadata', () => emptyState.classList.add('hidden'));

// ── Collapsible controls ──────────────────────────────────────────────────
const controlsPanel = document.getElementById('controlsPanel');
const toggleBtn     = document.getElementById('toggleControlsBtn');
let controlsOpen    = true;
let autoCollapsed   = false;

function setControls(open) {
    controlsOpen = open;
    controlsPanel.classList.toggle('collapsed', !open);
    toggleBtn.textContent = open ? '▲ Settings' : '▼ Settings';
}

toggleBtn.onclick = () => setControls(!controlsOpen);

// ── State ─────────────────────────────────────────────────────────────────
let currentFileName = null;
let pendingSubtitle = null;
let originalCues    = null;
let currentSubLabel = '';
let subtitleOffset  = 0;
let lastSaveTime    = 0;
let isAudioOnly     = false;
let hlsInstance     = null;

function destroyHls() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
}

function playHLS(url) {
    const videoEl = player.el().querySelector('video');
    destroyHls();
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => player.play());
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        player.src({ src: url, type: 'application/x-mpegURL' });
        player.play();
    }
}

// ── Playlist ──────────────────────────────────────────────────────────────
let playlist     = [];
let currentIndex = -1;
let shuffleMode  = false;
let loopMode     = 'none';
let navHistory   = [];

function addToPlaylist(files) {
    const wasEmpty = playlist.length === 0;
    for (const file of files) {
        playlist.push({ file, name: file.name, url: URL.createObjectURL(file) });
    }
    renderPlaylist();
    if (wasEmpty) {
        playAt(0);
        if (!autoCollapsed) { autoCollapsed = true; setControls(false); }
    }
}

function addStreamToPlaylist(url) {
    const name = url.split('/').pop().split('?')[0] || 'stream.m3u8';
    const wasEmpty = playlist.length === 0;
    playlist.push({ name, url, isStream: true });
    renderPlaylist();
    if (wasEmpty) {
        playAt(playlist.length - 1);
        if (!autoCollapsed) { autoCollapsed = true; setControls(false); }
    } else {
        playAt(playlist.length - 1);
    }
}

function playAt(index) {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    const item = playlist[index];

    currentFileName = item.name;
    isAudioOnly = !item.isStream && (item.file.type.startsWith('audio/') || /\.(mp3|flac|m4a|aac|wav|ogg)$/i.test(item.name));

    originalCues = null;
    currentSubLabel = '';
    const remoteTracks = player.remoteTextTracks();
    for (let i = remoteTracks.length - 1; i >= 0; i--) player.removeRemoteTextTrack(remoteTracks[i]);

    if (item.isStream || /\.m3u8$/i.test(item.name)) {
        playHLS(item.url);
    } else {
        destroyHls();
        player.src({ src: item.url, type: getMimeType(item.file) });
        player.play();
    }

    if (isAudioOnly) {
        waveformCanvas.style.display = 'block';
        waveformCanvas.width  = waveformCanvas.offsetWidth;
        waveformCanvas.height = waveformCanvas.offsetHeight;
    } else {
        waveformCanvas.style.display = 'none';
    }

    setupVisualizer();

    if (pendingSubtitle) {
        applySubtitle(pendingSubtitle.cues, pendingSubtitle.label);
        pendingSubtitle = null;
    }

    renderPlaylist();
}

function removeFromPlaylist(index) {
    playlist.splice(index, 1);
    if (currentIndex === index) {
        if (playlist.length > 0) {
            playAt(Math.min(index, playlist.length - 1));
        } else {
            currentIndex = -1;
            player.pause();
            renderPlaylist();
        }
    } else {
        if (currentIndex > index) currentIndex--;
        renderPlaylist();
    }
}

function renderPlaylist() {
    const panel      = document.getElementById('playlistPanel');
    const list       = document.getElementById('playlistItems');
    const count      = document.getElementById('playlistCount');
    const prev       = document.getElementById('prevTrack');
    const next       = document.getElementById('nextTrack');
    const shuffleBtn = document.getElementById('shuffleBtn');
    const loopBtn    = document.getElementById('loopBtn');

    panel.style.display = playlist.length > 0 ? 'flex' : 'none';
    count.textContent = `${playlist.length} file${playlist.length !== 1 ? 's' : ''}`;
    prev.disabled = navHistory.length === 0 && (shuffleMode || currentIndex <= 0);
    next.disabled = !shuffleMode && currentIndex >= playlist.length - 1;

    shuffleBtn.classList.toggle('active', shuffleMode);
    loopBtn.textContent = loopMode === 'none' ? '↺ Off' : loopMode === 'all' ? '↺ All' : '↺ One';
    loopBtn.classList.toggle('active', loopMode !== 'none');

    list.innerHTML = '';
    playlist.forEach((item, i) => {
        const li  = document.createElement('li');
        li.className = 'playlist-item' + (i === currentIndex ? ' active' : '');

        const idx = document.createElement('span');
        idx.className = 'item-index';
        idx.textContent = i === currentIndex ? '▶' : String(i + 1);

        const name = document.createElement('span');
        name.className = 'item-name';
        name.textContent = item.name;
        name.title = item.name;

        const rm  = document.createElement('button');
        rm.className = 'item-remove';
        rm.textContent = '✕';
        rm.onclick = (e) => { e.stopPropagation(); removeFromPlaylist(i); };

        li.append(idx, name, rm);
        li.onclick = () => playAt(i);
        list.appendChild(li);
    });

    const activeEl = list.querySelector('.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function nextTrack() {
    if (playlist.length === 0) return;
    if (shuffleMode && playlist.length > 1) {
        let next;
        do { next = Math.floor(Math.random() * playlist.length); }
        while (next === currentIndex);
        navHistory.push(currentIndex);
        playAt(next);
    } else if (currentIndex < playlist.length - 1) {
        navHistory.push(currentIndex);
        playAt(currentIndex + 1);
    }
}

function prevTrack() {
    if (navHistory.length > 0) {
        playAt(navHistory.pop());
    } else if (!shuffleMode && currentIndex > 0) {
        playAt(currentIndex - 1);
    }
}

player.on('ended', () => {
    if (loopMode === 'one') { player.currentTime(0); player.play(); return; }
    const hasNext = shuffleMode ? playlist.length > 1 : currentIndex < playlist.length - 1;
    if (hasNext) {
        nextTrack();
    } else if (loopMode === 'all' && playlist.length > 0) {
        shuffleMode ? nextTrack() : (navHistory.push(currentIndex), playAt(0));
    }
});

document.getElementById('prevTrack').onclick  = prevTrack;
document.getElementById('nextTrack').onclick  = nextTrack;
document.getElementById('shuffleBtn').onclick = () => { shuffleMode = !shuffleMode; navHistory = []; renderPlaylist(); };
document.getElementById('loopBtn').onclick    = () => { loopMode = loopMode === 'none' ? 'all' : loopMode === 'all' ? 'one' : 'none'; renderPlaylist(); };
document.getElementById('clearPlaylist').onclick = () => { playlist = []; currentIndex = -1; navHistory = []; player.pause(); renderPlaylist(); };

// ── MIME type ─────────────────────────────────────────────────────────────
function getMimeType(file) {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop().toLowerCase();
    return ({
        mp4:'video/mp4', webm:'video/webm', ogv:'video/ogg',
        mkv:'video/x-matroska', mov:'video/quicktime', avi:'video/x-msvideo',
        mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
        flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac',
        m3u8:'application/x-mpegURL',
    })[ext] || 'video/mp4';
}

// ── Subtitle parsing ──────────────────────────────────────────────────────
function parseSrtTime(str) {
    const [hms, ms] = str.trim().split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms) / 1000;
}

function parseVttTime(str) {
    const clean = str.trim().split(' ')[0];
    const parts = clean.split(':').map(Number);
    return parts.length === 3 ? parts[0]*3600 + parts[1]*60 + parts[2] : parts[0]*60 + parts[1];
}

function parseSrt(text) {
    const cues = [];
    const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\n+/);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;
        const ti = /^\d+$/.test(lines[0]) ? 1 : 0;
        if (!lines[ti]?.includes('-->')) continue;
        const [start, end] = lines[ti].split('-->');
        cues.push({ startTime: parseSrtTime(start), endTime: parseSrtTime(end), text: lines.slice(ti+1).join('\n') });
    }
    return cues;
}

function parseVtt(text) {
    const cues = [];
    const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\n+/);
    for (const block of blocks) {
        if (block.startsWith('WEBVTT') || !block.includes('-->')) continue;
        const lines = block.trim().split('\n');
        const ti = lines[0].includes('-->') ? 0 : 1;
        if (!lines[ti]) continue;
        const [start, end] = lines[ti].split('-->');
        cues.push({ startTime: parseVttTime(start), endTime: parseVttTime(end), text: lines.slice(ti+1).join('\n') });
    }
    return cues;
}

function fmtVttTime(s) {
    s = Math.max(0, s);
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec}`;
}

function cuesToVtt(cues, offset) {
    return 'WEBVTT\n\n' + cues.map(c =>
        `${fmtVttTime(c.startTime + offset)} --> ${fmtVttTime(c.endTime + offset)}\n${c.text}`
    ).join('\n\n');
}

// ── Subtitle track ────────────────────────────────────────────────────────
function applySubtitle(cues, label) {
    originalCues = cues;
    currentSubLabel = label;
    const blob = new Blob([cuesToVtt(cues, 0)], { type: 'text/vtt' });
    const remoteTracks = player.remoteTextTracks();
    for (let i = remoteTracks.length - 1; i >= 0; i--) player.removeRemoteTextTrack(remoteTracks[i]);

    const trackEl = player.addRemoteTextTrack(
        { kind:'subtitles', src: URL.createObjectURL(blob), srclang:'en', label, default:true }, false
    );
    trackEl.addEventListener('load', () => {
        const tt = player.textTracks();
        for (let i = 0; i < tt.length; i++) {
            if (tt[i].label === label) {
                tt[i].mode = 'showing';
                if (subtitleOffset !== 0) applyOffsetToCues(tt[i]);
                break;
            }
        }
    });
}

function applyOffsetToCues(track) {
    if (!track.cues || !originalCues) return;
    for (let i = 0; i < Math.min(track.cues.length, originalCues.length); i++) {
        track.cues[i].startTime = Math.max(0, originalCues[i].startTime + subtitleOffset);
        track.cues[i].endTime   = Math.max(0, originalCues[i].endTime   + subtitleOffset);
    }
}

function getLoadedTrack() {
    const tt = player.textTracks();
    for (let i = 0; i < tt.length; i++) {
        if (tt[i].label === currentSubLabel) return tt[i];
    }
    return null;
}

// ── Subtitle delay ────────────────────────────────────────────────────────
function adjustDelay(delta) {
    subtitleOffset = Math.round((subtitleOffset + delta) * 10) / 10;
    delayDisplay.textContent = (subtitleOffset > 0 ? '+' : '') + subtitleOffset.toFixed(1) + 's';
    if (!originalCues) return;
    const track = getLoadedTrack();
    if (track) applyOffsetToCues(track);
}

document.getElementById('dm5').onclick    = () => adjustDelay(-0.5);
document.getElementById('dm1').onclick    = () => adjustDelay(-0.1);
document.getElementById('dp1').onclick    = () => adjustDelay(0.1);
document.getElementById('dp5').onclick    = () => adjustDelay(0.5);
document.getElementById('dreset').onclick = () => {
    subtitleOffset = 0;
    delayDisplay.textContent = '0.0s';
    if (!originalCues) return;
    const track = getLoadedTrack();
    if (track) applyOffsetToCues(track);
};

// ── Stream URL ────────────────────────────────────────────────────────────
document.getElementById('streamUrlBtn').onclick = () => {
    const url = document.getElementById('streamUrlInput').value.trim();
    if (!url) return;
    addStreamToPlaylist(url);
    document.getElementById('streamUrlInput').value = '';
};

document.getElementById('streamUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('streamUrlBtn').click();
});

// ── Load media ────────────────────────────────────────────────────────────
mediaInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    addToPlaylist(files);
    e.target.value = '';
});

// ── Resume position ───────────────────────────────────────────────────────
player.on('loadedmetadata', () => {
    if (!currentFileName) return;
    const saved = parseFloat(localStorage.getItem('vp:' + currentFileName));
    if (saved > 0 && saved < player.duration() - 10) player.currentTime(saved);
});

player.on('timeupdate', () => {
    if (!currentFileName) return;
    const now = Date.now();
    if (now - lastSaveTime > 5000) {
        localStorage.setItem('vp:' + currentFileName, player.currentTime());
        lastSaveTime = now;
    }
});

player.on('pause', () => {
    if (currentFileName) localStorage.setItem('vp:' + currentFileName, player.currentTime());
});

// ── Load subtitles ────────────────────────────────────────────────────────
subtitleInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const cues = file.name.endsWith('.srt') ? parseSrt(text) : parseVtt(text);
    if (player.currentSrc()) {
        applySubtitle(cues, file.name);
    } else {
        pendingSubtitle = { cues, label: file.name };
    }
});

// ── Theater mode ──────────────────────────────────────────────────────────
function toggleTheater() {
    app.classList.toggle('theater');
    const on = app.classList.contains('theater');
    document.getElementById('theaterBtn').textContent = on ? 'Exit Theater  [T]' : 'Theater Mode  [T]';
}
document.getElementById('theaterBtn').onclick = toggleTheater;

document.getElementById('clearCacheBtn').onclick = () => {
    Object.keys(localStorage).filter(k => k.startsWith('vp:')).forEach(k => localStorage.removeItem(k));
    const btn = document.getElementById('clearCacheBtn');
    btn.textContent = 'Cache cleared';
    setTimeout(() => { btn.textContent = 'Clear cache'; }, 2000);
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const dur = player.duration() || 0;
    switch (e.key) {
        case ' ':          e.preventDefault(); player.paused() ? player.play() : player.pause(); break;
        case 'ArrowLeft':  e.preventDefault(); player.currentTime(Math.max(0, player.currentTime() - 5)); break;
        case 'ArrowRight': e.preventDefault(); player.currentTime(Math.min(dur, player.currentTime() + 5)); break;
        case 'ArrowUp':    e.preventDefault(); player.volume(Math.min(1, player.volume() + 0.1)); break;
        case 'ArrowDown':  e.preventDefault(); player.volume(Math.max(0, player.volume() - 0.1)); break;
        case 'j': case 'J': player.currentTime(Math.max(0, player.currentTime() - 10)); break;
        case 'l': case 'L': player.currentTime(Math.min(dur, player.currentTime() + 10)); break;
        case 'f': case 'F': player.requestFullscreen(); break;
        case 't': case 'T': toggleTheater(); break;
        case 'm': case 'M': player.muted(!player.muted()); break;
        case '[': adjustDelay(-0.5); break;
        case ']': adjustDelay(0.5); break;
        case 'n': case 'N': nextTrack(); break;
        case 'b': case 'B': prevTrack(); break;
    }
});

// ── Waveform visualizer ───────────────────────────────────────────────────
let audioCtx  = null;
let analyser  = null;
let animFrame = null;

function setupVisualizer() {
    const mediaEl = player.el().querySelector('video, audio');
    if (!mediaEl) return;
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(mediaEl);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (animFrame) cancelAnimationFrame(animFrame);
    if (isAudioOnly) drawFrame();
}

function drawFrame() {
    animFrame = requestAnimationFrame(drawFrame);
    const ctx     = waveformCanvas.getContext('2d');
    const W       = waveformCanvas.width;
    const H       = waveformCanvas.height;
    const data    = new Uint8Array(analyser.frequencyBinCount);
    const isRetro = document.documentElement.getAttribute('data-theme') === 'retro';
    analyser.getByteFrequencyData(data);

    ctx.fillStyle = isRetro ? '#050d05' : '#0d0d12';
    ctx.fillRect(0, 0, W, H);

    const barW = W / data.length;
    for (let i = 0; i < data.length; i++) {
        const v = data[i] / 255;
        if (isRetro) {
            ctx.fillStyle = `hsl(128, 100%, ${25 + v * 55}%)`;
        } else {
            ctx.fillStyle = `hsl(${220 + (i / data.length) * 60}, 80%, ${30 + v * 40}%)`;
        }
        ctx.fillRect(i * barW, H - v * H, Math.max(1, barW - 1), v * H);
    }
}

window.addEventListener('resize', () => {
    if (waveformCanvas.style.display === 'block') {
        waveformCanvas.width  = waveformCanvas.offsetWidth;
        waveformCanvas.height = waveformCanvas.offsetHeight;
    }
});
