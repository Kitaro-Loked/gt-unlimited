/* Price alerts panel — Binance spot miniTicker WS + REST polling fallback (no API key)
 * Registers as custom tool id 'alerts' via window.GT_EXTRA_TOOLS.
 * Alerts persisted to localStorage (gt-alerts-v1); Notification + WebAudio beep on trigger. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt-alerts-v1';
  const POLL_MS = 10000;
  const WS_RETRY_MS = 30000;
  const WS_URL = (syms) =>
    `wss://stream.binance.com:9443/stream?streams=${syms.map((s) => `${s.toLowerCase()}@miniTicker`).join('/')}`;
  const TICKER_URL = (syms) =>
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`;
  const CANDIDATES = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT',
    'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT',
    'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'INJUSDT', 'FILUSDT', 'UNIUSDT',
  ];
  const COND_LABEL = { gte: '高于 ≥', lte: '低于 ≤' };
  const COND_SIGN = { gte: '≥', lte: '≤' };

  function injectStyle() {
    if (document.getElementById('alrt-style')) return;
    const style = document.createElement('style');
    style.id = 'alrt-style';
    style.textContent = `
.alrt-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.alrt-status { color: var(--warning); }
.alrt-status.live { color: var(--up); }
.alrt-status.poll { color: var(--warning); }
.alrt-form { margin-bottom: 8px; }
.alrt-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
.alrt-list-wrap {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: 8px;
}
.alrt-table { font-variant-numeric: tabular-nums; }
.alrt-table th, .alrt-table td { white-space: nowrap; }
.alrt-sym { font-weight: 600; }
.alrt-note {
  display: block;
  font-size: 9px;
  color: var(--text-dim);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alrt-num { font-family: var(--font-mono); }
.alrt-badge {
  font-size: 9px;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--info);
  color: var(--info);
  white-space: nowrap;
}
.alrt-badge.hit { border-color: var(--warning); color: var(--warning); }
tr.alrt-hit td { background: var(--acc-glow); }
.alrt-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--text-dim);
}
`;
    document.head.appendChild(style);
  }

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toPrecision(4);
  }

  const genId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  window.GT_EXTRA_TOOLS['alerts'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool alrt-root">
          <div class="alrt-head"><span>价格提醒 · BINANCE SPOT</span><span class="alrt-status" data-conn>—</span></div>
          <div class="tool-grid alrt-form">
            <label class="field"><span>品种 SYMBOL</span><input data-symbol list="gt-alrt-symbols" placeholder="BTCUSDT" maxlength="20" autocomplete="off"></label>
            <label class="field"><span>条件 CONDITION</span><select data-cond><option value="gte">高于 ≥</option><option value="lte">低于 ≤</option></select></label>
            <label class="field"><span>目标价 TARGET</span><input data-target type="number" min="0" step="any" placeholder="0.00"></label>
            <label class="field"><span>备注 NOTE（可选）</span><input data-note placeholder="如：突破前高" maxlength="40" autocomplete="off"></label>
          </div>
          <datalist id="gt-alrt-symbols">${CANDIDATES.map((s) => `<option value="${s}"></option>`).join('')}</datalist>
          <div class="alrt-actions"><button class="tool-btn" data-add>＋ 添加提醒</button></div>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="alrt-list-wrap" data-wrap style="display:none">
            <table class="data-table alrt-table">
              <thead><tr><th>品种</th><th>条件 / 目标价</th><th>当前价</th><th>距离</th><th>状态</th><th></th></tr></thead>
              <tbody data-rows></tbody>
            </table>
          </div>
          <div class="tool-hint" data-empty>暂无价格提醒 — 在上方添加后自动开始监控，触发时桌面通知 + 提示音</div>
          <div class="alrt-foot" data-foot style="display:none">
            <span data-count></span>
            <button class="tool-btn ghost danger" data-clear>清除已触发</button>
          </div>
        </div>`;

      const connEl = el.querySelector('[data-conn]');
      const hintEl = el.querySelector('[data-hint]');
      const emptyEl = el.querySelector('[data-empty]');
      const wrapEl = el.querySelector('[data-wrap]');
      const footEl = el.querySelector('[data-foot]');
      const countEl = el.querySelector('[data-count]');
      const rowsEl = el.querySelector('[data-rows]');
      const symInput = el.querySelector('[data-symbol]');
      const condSelect = el.querySelector('[data-cond]');
      const targetInput = el.querySelector('[data-target]');
      const noteInput = el.querySelector('[data-note]');
      const addBtn = el.querySelector('[data-add]');
      const clearBtn = el.querySelector('[data-clear]');

      let alive = true;
      let ws = null;
      let pollTimer = null;
      let wsRetryTimer = null;
      let streamKey = '';
      let audioCtx = null;
      let hintFrom = ''; // 'form' | 'net'
      const lastPrices = {}; // sym -> latest price

      // ---- persistence ----
      const loadAlerts = () => {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (!raw) return [];
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return [];
          return arr
            .map((a) => ({
              id: String((a && a.id) || ''),
              symbol: String((a && a.symbol) || '').toUpperCase(),
              cond: a && a.cond === 'lte' ? 'lte' : 'gte',
              target: Number(a && a.target),
              note: String((a && a.note) || '').slice(0, 40),
              triggered: !!(a && a.triggered),
            }))
            .filter(
              (a) =>
                /^[a-z0-9]{4,24}$/i.test(a.id) &&
                /^[A-Z0-9]{2,20}$/.test(a.symbol) &&
                Number.isFinite(a.target) &&
                a.target > 0
            );
        } catch (e) {
          return [];
        }
      };
      let alerts = loadAlerts();
      const saveAlerts = () => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(alerts)); } catch (e) { /* noop */ }
      };

      // ---- ui helpers ----
      const showHint = (msg, from) => {
        hintFrom = from || '';
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const hideHint = (from) => {
        if (from && hintFrom !== from) return;
        hintFrom = '';
        hintEl.style.display = 'none';
      };
      const setConn = (text, cls) => {
        connEl.textContent = text;
        connEl.className = `alrt-status${cls ? ` ${cls}` : ''}`;
      };
      const updateCount = () => {
        countEl.textContent = alerts.length
          ? `共 ${alerts.length} 条 · ${alerts.filter((a) => a.triggered).length} 已触发`
          : '';
      };

      const updateRowDistance = (tr, a, price) => {
        const distTd = tr.querySelector('[data-dist]');
        if (!distTd) return;
        distTd.classList.remove('pos', 'neg');
        if (!Number.isFinite(price)) {
          distTd.textContent = '—';
          return;
        }
        const d = ((price - a.target) / a.target) * 100;
        distTd.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(2)}%`;
        distTd.classList.add(d >= 0 ? 'pos' : 'neg');
      };

      const buildRow = (a) => {
        const tr = document.createElement('tr');
        tr.dataset.id = a.id;
        if (a.triggered) tr.classList.add('alrt-hit');

        const tdSym = document.createElement('td');
        const symSpan = document.createElement('span');
        symSpan.className = 'alrt-sym';
        symSpan.textContent = a.symbol;
        tdSym.appendChild(symSpan);
        if (a.note) {
          const note = document.createElement('span');
          note.className = 'alrt-note';
          note.textContent = a.note;
          tdSym.appendChild(note);
        }

        const tdCond = document.createElement('td');
        tdCond.className = 'alrt-num';
        tdCond.textContent = `${COND_SIGN[a.cond]} ${fmtPrice(a.target)}`;

        const tdPrice = document.createElement('td');
        tdPrice.className = 'alrt-num';
        tdPrice.setAttribute('data-price', '');
        tdPrice.textContent = fmtPrice(lastPrices[a.symbol]);

        const tdDist = document.createElement('td');
        tdDist.className = 'alrt-num';
        tdDist.setAttribute('data-dist', '');

        const tdBadge = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `alrt-badge${a.triggered ? ' hit' : ''}`;
        badge.textContent = a.triggered ? '已触发' : '监控中';
        tdBadge.appendChild(badge);

        const tdDel = document.createElement('td');
        const del = document.createElement('button');
        del.className = 'row-del';
        del.type = 'button';
        del.title = '删除';
        del.textContent = '✕';
        del.addEventListener('click', () => removeAlert(a.id));
        tdDel.appendChild(del);

        [tdSym, tdCond, tdPrice, tdDist, tdBadge, tdDel].forEach((td) => tr.appendChild(td));
        updateRowDistance(tr, a, lastPrices[a.symbol]);
        return tr;
      };

      const renderList = () => {
        rowsEl.innerHTML = '';
        const has = alerts.length > 0;
        wrapEl.style.display = has ? '' : 'none';
        footEl.style.display = has ? '' : 'none';
        emptyEl.style.display = has ? 'none' : '';
        updateCount();
        alerts.forEach((a) => rowsEl.appendChild(buildRow(a)));
      };

      // ---- notification & sound ----
      const unlockAudio = () => {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          audioCtx = audioCtx || new Ctx();
          if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { /* noop */ }
      };

      const beep = () => {
        try {
          unlockAudio();
          if (!audioCtx) return;
          const t0 = audioCtx.currentTime;
          [[880, 0], [1320, 0.18]].forEach(([freq, offset]) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t0 + offset);
            gain.gain.exponentialRampToValueAtTime(0.2, t0 + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.15);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(t0 + offset);
            osc.stop(t0 + offset + 0.16);
          });
        } catch (e) { /* noop */ }
      };

      const notify = (a, price) => {
        try {
          if (!('Notification' in window) || Notification.permission !== 'granted') return;
          const body = `${a.symbol} ${COND_LABEL[a.cond]} ${fmtPrice(a.target)}，现价 ${fmtPrice(price)}${a.note ? ` · ${a.note}` : ''}`;
          new Notification('GT 价格提醒触发', { body });
        } catch (e) { /* noop */ }
      };

      const fireAlert = (a, price) => {
        a.triggered = true;
        saveAlerts();
        const tr = rowsEl.querySelector(`tr[data-id="${a.id}"]`);
        if (tr) {
          tr.classList.add('alrt-hit');
          const badge = tr.querySelector('.alrt-badge');
          if (badge) {
            badge.classList.add('hit');
            badge.textContent = '已触发';
          }
        }
        updateCount();
        notify(a, price);
        beep();
      };

      // ---- price feed ----
      const onPrice = (sym, price) => {
        if (!alive || !Number.isFinite(price)) return;
        lastPrices[sym] = price;
        alerts.forEach((a) => {
          if (a.symbol !== sym) return;
          const tr = rowsEl.querySelector(`tr[data-id="${a.id}"]`);
          if (tr) {
            const priceTd = tr.querySelector('[data-price]');
            if (priceTd) priceTd.textContent = fmtPrice(price);
            updateRowDistance(tr, a, price);
          }
          if (!a.triggered && ((a.cond === 'gte' && price >= a.target) || (a.cond === 'lte' && price <= a.target))) {
            fireAlert(a, price);
          }
        });
      };

      const fetchPrices = async () => {
        const syms = [...new Set(alerts.map((a) => a.symbol))];
        if (!syms.length || !alive) return;
        try {
          const res = await fetch(TICKER_URL(syms));
          if (!res.ok) throw new Error(`http ${res.status}`);
          const data = await res.json();
          if (!Array.isArray(data)) throw new Error('bad data');
          if (!alive) return;
          data.forEach((t) => onPrice(t.symbol, parseFloat(t.lastPrice)));
          setStatus('online');
          hideHint('net');
        } catch (e) {
          if (!alive) return;
          setStatus('offline');
          showHint('行情数据加载失败，正在自动重试…', 'net');
        }
      };

      const stopWs = () => {
        if (ws) {
          ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
          try { ws.close(); } catch (e) { /* noop */ }
          ws = null;
        }
      };
      const stopPoll = () => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      };
      const stopRetry = () => {
        if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
      };

      const startPoll = () => {
        if (pollTimer || !alive) return;
        fetchPrices();
        pollTimer = setInterval(fetchPrices, POLL_MS);
      };

      const connect = (force) => {
        if (!alive) return;
        const syms = [...new Set(alerts.map((a) => a.symbol))];
        const key = syms.slice().sort().join(',');
        if (!force && key === streamKey) return;
        streamKey = key;
        stopWs();
        stopPoll();
        stopRetry();
        if (!syms.length) {
          setConn('—', '');
          return;
        }
        setConn('连接中…', '');
        fetchPrices(); // 立即取一次现价，无需等 WS 首帧
        ws = new WebSocket(WS_URL(syms));
        ws.onopen = () => {
          if (!alive) return;
          setConn('● LIVE', 'live');
          setStatus('online');
          stopPoll();
        };
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data).data;
            if (d && d.s) onPrice(d.s, parseFloat(d.c));
          } catch (e) { /* noop */ }
        };
        ws.onerror = () => {
          try { ws.close(); } catch (e) { /* noop */ }
        };
        ws.onclose = () => {
          if (!alive) return;
          ws = null;
          setConn('POLLING', 'poll');
          startPoll();
          // 30s 后尝试恢复 WS 实时流
          wsRetryTimer = setTimeout(() => connect(true), WS_RETRY_MS);
        };
      };

      // ---- actions ----
      const addAlert = () => {
        const symbol = symInput.value.trim().toUpperCase();
        const cond = condSelect.value === 'lte' ? 'lte' : 'gte';
        const target = parseFloat(targetInput.value);
        const note = noteInput.value.trim().slice(0, 40);
        if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
          showHint('请输入有效的品种代码，如 BTCUSDT', 'form');
          return;
        }
        if (!Number.isFinite(target) || target <= 0) {
          showHint('请输入有效的目标价（大于 0 的数字）', 'form');
          return;
        }
        if (alerts.some((a) => !a.triggered && a.symbol === symbol && a.cond === cond && a.target === target)) {
          showHint('相同品种、条件与目标价的提醒已存在', 'form');
          return;
        }
        // 首次添加时请求桌面通知权限（需在用户手势内调用）
        try {
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
          }
        } catch (e) { /* noop */ }
        unlockAudio(); // 借点击手势解锁音频上下文
        alerts.push({ id: genId(), symbol, cond, target, note, triggered: false });
        saveAlerts();
        renderList();
        connect(false);
        hideHint('form');
        targetInput.value = '';
        noteInput.value = '';
        symInput.focus();
      };

      const removeAlert = (id) => {
        alerts = alerts.filter((a) => a.id !== id);
        saveAlerts();
        renderList();
        connect(false);
      };

      const clearTriggered = () => {
        const n = alerts.filter((a) => a.triggered).length;
        if (!n) {
          showHint('当前没有已触发的提醒', 'form');
          return;
        }
        alerts = alerts.filter((a) => !a.triggered);
        saveAlerts();
        renderList();
        connect(false);
        hideHint('form');
      };

      addBtn.addEventListener('click', addAlert);
      [targetInput, noteInput, symInput].forEach((input) => {
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') addAlert();
        });
      });
      clearBtn.addEventListener('click', clearTriggered);

      renderList();
      connect(false);

      return () => {
        alive = false;
        stopWs();
        stopPoll();
        stopRetry();
        if (audioCtx) {
          try { audioCtx.close(); } catch (e) { /* noop */ }
          audioCtx = null;
        }
        const st = document.getElementById('alrt-style');
        if (st && st.parentNode) st.parentNode.removeChild(st);
      };
    },
  };
})();
