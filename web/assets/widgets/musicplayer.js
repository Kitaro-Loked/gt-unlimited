/* GT UNLIMITED audio stream player — replaces the broken YouTube iframe.
 * Registers as custom tool id 'musicplayer' via window.GT_EXTRA_TOOLS.
 * Uses only free, no-API-key public audio streams with graceful degradation.
 *
 * 改进点：
 *  - 每电台配置多条直连 / 代理候选 URL，失败自动 fallback
 *  - 元数据接口走 /api/proxy 代理，绕过 CORS
 *  - AudioContext 在用户手势时自动 resume
 *  - 更可靠的电台列表，错误恢复与静态兜底
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt-musicplayer-v2';
  const METADATA_INTERVAL_MS = 15000;
  const PROXY_PREFIX = '/api/proxy?url=';
  const MAX_CONSECUTIVE_ERRORS = 6; // allow a few URL fallbacks before giving up

  // Public direct MP3/AAC streams that are reliable and require no API key.
  // Each station provides multiple endpoints so playback can failover in case
  // one server or domain is blocked.
  const STATIONS = [
    {
      id: 'groovesalad',
      name: 'Groove Salad',
      category: 'Ambient / Electronic',
      urls: [
        'https://ice4.somafm.com/groovesalad-128-mp3',
        'https://ice6.somafm.com/groovesalad-128-mp3',
        'https://ice2.somafm.com/groovesalad-128-mp3',
      ],
      api: 'somafm',
      metaUrl: 'https://api.somafm.com/songs/groovesalad.json',
    },
    {
      id: 'dronezone',
      name: 'Drone Zone',
      category: 'Ambient',
      urls: [
        'https://ice4.somafm.com/dronezone-128-mp3',
        'https://ice6.somafm.com/dronezone-128-mp3',
        'https://ice2.somafm.com/dronezone-128-mp3',
      ],
      api: 'somafm',
      metaUrl: 'https://api.somafm.com/songs/dronezone.json',
    },
    {
      id: 'secretagent',
      name: 'Secret Agent',
      category: 'Downtempo',
      urls: [
        'https://ice6.somafm.com/secretagent-128-mp3',
        'https://ice4.somafm.com/secretagent-128-mp3',
        'https://ice2.somafm.com/secretagent-128-mp3',
      ],
      api: 'somafm',
      metaUrl: 'https://api.somafm.com/songs/secretagent.json',
    },
    {
      id: 'spacestation',
      name: 'Space Station Soma',
      category: 'Electronic',
      urls: [
        'https://ice4.somafm.com/spacestation-128-mp3',
        'https://ice6.somafm.com/spacestation-128-mp3',
        'https://ice2.somafm.com/spacestation-128-mp3',
      ],
      api: 'somafm',
      metaUrl: 'https://api.somafm.com/songs/spacestation.json',
    },
    {
      id: 'deepspaceone',
      name: 'Deep Space One',
      category: 'Ambient',
      urls: [
        'https://ice4.somafm.com/deepspaceone-128-mp3',
        'https://ice6.somafm.com/deepspaceone-128-mp3',
        'https://ice2.somafm.com/deepspaceone-128-mp3',
      ],
      api: 'somafm',
      metaUrl: 'https://api.somafm.com/songs/deepspaceone.json',
    },
    {
      id: 'radioparadise',
      name: 'Radio Paradise',
      category: 'Eclectic Rock',
      urls: [
        'https://stream.radioparadise.com/mp3-192',
        'https://stream.radioparadise.com/mp3-128',
        'https://stream-uk1.radioparadise.com/mp3-128',
      ],
      api: 'rp',
      metaUrl: 'https://api.radioparadise.com/api/now_playing?chan=0',
    },
    {
      id: 'kexp',
      name: 'KEXP 90.3 FM',
      category: 'Indie / Alternative',
      urls: [
        'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',
        'https://live-aacplus-64.kexp.org/kexp64.aac',
        'https://kexp-mp3-128.streamguys1.com/kexp128.mp3?no_cache=1',
      ],
      api: 'kexp',
      metaUrl: 'https://api.kexp.org/v2/plays/?limit=1',
    },
    {
      id: 'fluxchillhop',
      name: 'FluxFM Chillhop',
      category: 'Lo-Fi Hip-Hop',
      urls: [
        'https://streams.fluxfm.de/chillhop/mp3-128',
        'https://streams.fluxfm.de/chillhop/aac-64',
      ],
      api: 'none',
    },
    {
      id: 'naimradio',
      name: 'Naim Radio',
      category: 'Jazz / Eclectic',
      urls: [
        'https://mscp3.co.uk:8210/stream',
        'https://mscp3.co.uk:8210/stream?no_cache=1',
      ],
      api: 'none',
    },
  ];

  function proxy(url) {
    return PROXY_PREFIX + encodeURIComponent(url);
  }

  function injectStyle() {
    if (document.getElementById('mp-style')) return;
    const style = document.createElement('style');
    style.id = 'mp-style';
    style.textContent = `
.mp-root { display: flex; flex-direction: column; gap: 8px; height: 100%; overflow: hidden; }
.mp-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--text-muted); font-family: var(--font-sans);
}
.mp-status { color: var(--acc); font-family: var(--font-mono); }
.mp-display {
  position: relative; flex: 1 1 0; min-height: 90px;
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); overflow: hidden;
}
.mp-vis {
  position: absolute; inset: 0; width: 100%; height: 100%;
  display: block; opacity: 0.55; pointer-events: none;
}
.mp-meta {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 10px 12px;
  background: linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%);
  color: var(--text);
}
.mp-station-name {
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 3px;
}
.mp-track {
  font-size: 14px; font-weight: 600; line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mp-artist {
  font-size: 11px; color: var(--text-dim); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mp-controls {
  display: flex; align-items: center; gap: 8px;
}
.mp-play {
  width: 34px; height: 34px; flex-shrink: 0;
  border-radius: 50%; border: 1px solid var(--acc);
  background: var(--acc-glow); color: var(--acc);
  font-size: 13px; cursor: pointer; transition: all 0.2s ease;
}
.mp-play:hover { background: var(--acc); color: var(--bg); }
.mp-volume {
  flex: 1 1 0; min-width: 60px;
  -webkit-appearance: none; appearance: none; height: 4px;
  background: var(--hairline); border-radius: 2px; outline: none;
}
.mp-volume::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px;
  border-radius: 50%; background: var(--acc); cursor: pointer;
}
.mp-volume::-moz-range-thumb {
  width: 12px; height: 12px; border: none; border-radius: 50%;
  background: var(--acc); cursor: pointer;
}
.mp-mute {
  width: 30px; height: 30px; flex-shrink: 0;
  background: transparent; border: 1px solid var(--hairline);
  color: var(--text-muted); border-radius: var(--radius-sm);
  font-size: 12px; cursor: pointer; transition: all 0.2s ease;
}
.mp-mute:hover { border-color: var(--acc-dim); color: var(--acc); }
.mp-error {
  display: none; font-size: 10px; color: var(--down);
  text-align: center; letter-spacing: 0.08em; padding: 4px 0;
}
.mp-error.visible { display: block; }
.mp-stations {
  flex: 1 1 0; min-height: 60px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 6px;
}
.mp-station-btn {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 9px; background: var(--surface);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  color: var(--text); cursor: pointer; transition: all 0.18s ease;
  text-align: left; font-family: var(--font-sans);
}
.mp-station-btn:hover { background: var(--surface-raised); border-color: var(--hairline-strong); }
.mp-station-btn.active { border-color: var(--acc); background: var(--surface-raised); }
.mp-station-btn .mp-name { font-size: 11px; font-weight: 500; }
.mp-station-btn .mp-cat {
  font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;
}
.mp-station-btn.active .mp-cat { color: var(--acc); }
`;
    document.head.appendChild(style);
  }

  function buildHTML() {
    return `
      <div class="tool mp-root">
        <div class="mp-head"><span>AUDIO_STREAM</span><span class="mp-status" data-status>STANDBY</span></div>
        <div class="mp-display">
          <canvas class="mp-vis" data-canvas></canvas>
          <div class="mp-meta">
            <div class="mp-station-name" data-station-name>SELECT A STATION</div>
            <div class="mp-track" data-track>—</div>
            <div class="mp-artist" data-artist>GT UNLIMITED AUDIO</div>
          </div>
        </div>
        <div class="mp-controls">
          <button class="mp-play" data-play title="播放 / 暂停">▶</button>
          <input class="mp-volume" type="range" min="0" max="1" step="0.01" value="0.7" data-volume title="音量" />
          <button class="mp-mute" data-mute title="静音">🔊</button>
        </div>
        <div class="mp-error" data-error></div>
        <div class="mp-stations" data-stations></div>
      </div>`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt data */ }
    return { stationId: STATIONS[0].id, volume: 0.7 };
  }

  function saveState(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota errors */ }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchJson(url) {
    const doFetch = async (target) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const res = await fetch(target, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('http ' + res.status);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await doFetch(url);
    } catch (directErr) {
      try {
        return await doFetch(proxy(url));
      } catch (proxyErr) {
        return null;
      }
    }
  }

  function parseMeta(station, data) {
    if (!data) return null;
    try {
      if (station.api === 'somafm') {
        const songs = Array.isArray(data) ? data : (data.songs || []);
        const s = songs[0];
        if (s) return { title: s.title, artist: s.artist };
      }
      if (station.api === 'rp') {
        const song = data.song || data;
        if (song) return { title: song.title, artist: song.artist };
      }
      if (station.api === 'kexp') {
        const results = data.results || [];
        const r = results[0];
        if (r && r.song) {
          return {
            title: r.song.name,
            artist: r.artist ? r.artist.name : '',
          };
        }
      }
    } catch (e) { /* fall through to fallback */ }
    return null;
  }

  function getCandidateUrls(station) {
    const out = [];
    (station.urls || []).forEach((u) => {
      out.push(u);
      out.push(proxy(u));
    });
    // de-dupe while preserving order
    return out.filter((u, i, arr) => arr.indexOf(u) === i);
  }

  window.GT_EXTRA_TOOLS['musicplayer'] = {
    mount(el, setStatus) {
      injectStyle();
      setStatus('online');

      el.innerHTML = buildHTML();

      const statusEl = el.querySelector('[data-status]');
      const stationNameEl = el.querySelector('[data-station-name]');
      const trackEl = el.querySelector('[data-track]');
      const artistEl = el.querySelector('[data-artist]');
      const playBtn = el.querySelector('[data-play]');
      const volumeInput = el.querySelector('[data-volume]');
      const muteBtn = el.querySelector('[data-mute]');
      const errorEl = el.querySelector('[data-error]');
      const stationsEl = el.querySelector('[data-stations]');
      const canvas = el.querySelector('[data-canvas]');

      const saved = loadState();
      let stationIndex = Math.max(0, STATIONS.findIndex((s) => s.id === saved.stationId));
      let volume = typeof saved.volume === 'number' ? saved.volume : 0.7;
      let isPlaying = false;
      let consecutiveErrors = 0;
      let metadataTimer = null;
      let errorRecoveryTimer = null;
      let rafId = null;
      let alive = true;
      let sourceCreated = false;
      let wasMuted = false;
      let playSession = 0;
      let currentCandidates = [];
      let currentUrlIdx = 0;

      const audio = document.createElement('audio');
      audio.crossOrigin = 'anonymous';
      audio.preload = 'none';
      audio.volume = volume;

      let audioCtx = null;
      let analyser = null;
      let sourceNode = null;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
      } catch (e) {
        audioCtx = null;
      }

      function setStatusText(text) {
        if (alive) statusEl.textContent = text;
      }

      function showError(msg) {
        if (!msg) {
          errorEl.textContent = '';
          errorEl.classList.remove('visible');
          return;
        }
        errorEl.textContent = msg;
        errorEl.classList.add('visible');
      }

      function updateMuteIcon() {
        muteBtn.textContent = audio.muted || audio.volume === 0 ? '🔇' : '🔊';
      }

      function updateMetaDisplay(meta, station) {
        stationNameEl.textContent = `${station.name} · ${station.category}`;
        if (meta && meta.title) {
          trackEl.textContent = meta.title;
          artistEl.textContent = meta.artist || '—';
        } else {
          trackEl.textContent = 'LIVE STREAM';
          artistEl.textContent = station.name;
        }
      }

      async function refreshMeta() {
        const station = STATIONS[stationIndex];
        if (!station.metaUrl) {
          updateMetaDisplay(null, station);
          return;
        }
        const data = await fetchJson(station.metaUrl);
        const meta = parseMeta(station, data);
        if (alive) updateMetaDisplay(meta, station);
      }

      function startMetaLoop() {
        if (metadataTimer) clearInterval(metadataTimer);
        refreshMeta();
        metadataTimer = setInterval(refreshMeta, METADATA_INTERVAL_MS);
      }

      function stopMetaLoop() {
        if (metadataTimer) {
          clearInterval(metadataTimer);
          metadataTimer = null;
        }
      }

      function renderStations() {
        stationsEl.innerHTML = STATIONS.map((s, i) => `
          <button class="mp-station-btn${i === stationIndex ? ' active' : ''}" data-idx="${i}">
            <span class="mp-name">${esc(s.name)}</span>
            <span class="mp-cat">${esc(s.category)}</span>
          </button>`).join('');
      }

      async function unlockAudioContext() {
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
          try { await audioCtx.resume(); } catch (e) { /* ignore */ }
        }
      }

      function initAudioGraph() {
        if (sourceCreated || !audioCtx || !analyser) return;
        try {
          sourceNode = audioCtx.createMediaElementSource(audio);
          sourceNode.connect(analyser);
          analyser.connect(audioCtx.destination);
          sourceCreated = true;
        } catch (e) {
          sourceCreated = false;
        }
      }

      function attemptPlay(url, session) {
        if (!alive || session !== playSession) return;
        try {
          audio.pause();
          audio.src = url;
          audio.load();
          audio.play().catch((e) => {
            if (session !== playSession) return;
            // Autoplay policy or transient failure: surface hint, try fallback
            showError('播放被阻止，尝试备用地址…');
            handlePlayError(session);
          });
        } catch (e) {
          if (session !== playSession) return;
          handlePlayError(session);
        }
      }

      function handlePlayError(session) {
        if (!alive || session !== playSession) return;
        consecutiveErrors += 1;
        if (currentUrlIdx + 1 < currentCandidates.length) {
          currentUrlIdx += 1;
          showError(`源不可用，切换备用 ${currentUrlIdx + 1}/${currentCandidates.length}…`);
          attemptPlay(currentCandidates[currentUrlIdx], session);
        } else {
          showError('所有备用地址均失败，自动切换电台…');
          scheduleErrorRecovery();
        }
      }

      async function togglePlay() {
        await unlockAudioContext();
        if (!audioCtx) {
          showError('当前浏览器不支持 Web Audio。');
          return;
        }
        initAudioGraph();
        if (isPlaying) {
          audio.pause();
        } else {
          const station = STATIONS[stationIndex];
          currentCandidates = getCandidateUrls(station);
          currentUrlIdx = 0;
          playSession += 1;
          attemptPlay(currentCandidates[0], playSession);
        }
      }

      function updatePlayButton() {
        playBtn.textContent = isPlaying ? '⏸' : '▶';
        playBtn.title = isPlaying ? '暂停' : '播放';
      }

      async function selectStation(idx, autoPlay) {
        if (idx < 0 || idx >= STATIONS.length) return;
        stationIndex = idx;
        consecutiveErrors = 0;
        showError(null);
        const station = STATIONS[stationIndex];

        audio.pause();
        audio.src = '';
        audio.load();

        saveState({ stationId: station.id, volume: audio.volume });
        renderStations();
        updateMetaDisplay(null, station);
        startMetaLoop();

        currentCandidates = getCandidateUrls(station);
        currentUrlIdx = 0;
        playSession += 1;

        if (autoPlay || isPlaying) {
          await unlockAudioContext();
          initAudioGraph();
          attemptPlay(currentCandidates[0], playSession);
        } else {
          setStatusText('READY');
        }
      }

      function scheduleErrorRecovery() {
        if (errorRecoveryTimer) clearTimeout(errorRecoveryTimer);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          showError('多个流均不可用，请手动选择电台。');
          setStatus('error');
          setStatusText('ERROR');
          return;
        }
        errorRecoveryTimer = setTimeout(() => {
          if (!alive) return;
          const next = (stationIndex + 1) % STATIONS.length;
          selectStation(next, true);
        }, 2500);
      }

      function onAudioPlay() {
        isPlaying = true;
        consecutiveErrors = 0;
        showError(null);
        updatePlayButton();
        setStatus('online');
        setStatusText('ON AIR');
        startMetaLoop();
      }

      function onAudioPause() {
        isPlaying = false;
        updatePlayButton();
        setStatusText('PAUSED');
        stopMetaLoop();
      }

      function onAudioError() {
        const code = audio.error ? audio.error.code : '?';
        isPlaying = false;
        updatePlayButton();
        setStatus('error');
        setStatusText('ERROR');
        showError(`流错误 (${code})，尝试备用地址…`);
        handlePlayError(playSession);
      }

      function onVolumeInput() {
        const v = parseFloat(volumeInput.value);
        audio.volume = v;
        audio.muted = v === 0;
        if (v > 0 && wasMuted) audio.muted = false;
        updateMuteIcon();
        saveState({ stationId: STATIONS[stationIndex].id, volume: v });
      }

      function toggleMute() {
        if (audio.volume === 0) {
          audio.volume = wasMuted || 0.5;
          audio.muted = false;
        } else if (audio.muted) {
          audio.muted = false;
        } else {
          wasMuted = audio.volume;
          audio.muted = true;
        }
        volumeInput.value = audio.muted ? 0 : audio.volume;
        updateMuteIcon();
        saveState({ stationId: STATIONS[stationIndex].id, volume: audio.volume });
      }

      function onStationClick(e) {
        const btn = e.target.closest('.mp-station-btn');
        if (!btn) return;
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        selectStation(idx, true);
      }

      // Visualizer
      let ctx2d = null;
      let visualizerBars = 32;
      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        ctx2d = canvas.getContext('2d');
        if (ctx2d) ctx2d.scale(dpr, dpr);
      }

      function drawVisualizer(time) {
        if (!alive) return;
        rafId = requestAnimationFrame(drawVisualizer);
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!ctx2d) return;
        ctx2d.clearRect(0, 0, w, h);

        let dataArray = null;
        if (analyser && isPlaying) {
          dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
        }

        const barCount = visualizerBars;
        const gap = 2;
        const barW = (w - gap * (barCount - 1)) / barCount;
        for (let i = 0; i < barCount; i++) {
          let value = 0;
          if (dataArray) {
            const idx = Math.floor((i / barCount) * (dataArray.length / 2));
            value = dataArray[idx] / 255;
          } else {
            value = Math.max(0.05, Math.sin(time * 0.003 + i * 0.4) * 0.25 + 0.25);
            if (isPlaying) value *= 0.6 + Math.random() * 0.4;
            else value *= 0.25;
          }
          const barH = value * h * 0.85;
          const x = i * (barW + gap);
          const y = h - barH;
          const hue = 35 + (i / barCount) * 25;
          ctx2d.fillStyle = isPlaying
            ? `hsla(${hue}, 70%, 55%, ${0.7 + value * 0.3})`
            : 'var(--text-dim)';
          ctx2d.fillRect(x, y, barW, barH);
        }
      }

      // Event wiring
      playBtn.addEventListener('click', togglePlay);
      volumeInput.addEventListener('input', onVolumeInput);
      muteBtn.addEventListener('click', toggleMute);
      stationsEl.addEventListener('click', onStationClick);
      audio.addEventListener('play', onAudioPlay);
      audio.addEventListener('pause', onAudioPause);
      audio.addEventListener('error', onAudioError);

      // Ensure AudioContext resumes on the first user gesture inside this widget
      el.addEventListener('pointerdown', unlockAudioContext, { once: true });

      // Analyser setup
      if (audioCtx) {
        try {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
        } catch (e) {
          analyser = null;
        }
      }

      // Initialize UI state
      volumeInput.value = volume;
      audio.volume = volume;
      updateMuteIcon();
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      renderStations();
      selectStation(stationIndex, false);
      rafId = requestAnimationFrame(drawVisualizer);

      return function cleanup() {
        alive = false;
        stopMetaLoop();
        if (errorRecoveryTimer) {
          clearTimeout(errorRecoveryTimer);
          errorRecoveryTimer = null;
        }
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        window.removeEventListener('resize', resizeCanvas);
        try {
          audio.pause();
          audio.src = '';
          audio.load();
        } catch (e) { /* ignore */ }
        if (sourceNode && analyser) {
          try {
            sourceNode.disconnect();
            analyser.disconnect();
          } catch (e) { /* ignore */ }
        }
        if (audioCtx && audioCtx.state !== 'closed') {
          try { audioCtx.close(); } catch (e) { /* ignore */ }
        }
      };
    },
  };
})();
