/* Watchlist — 自选观察列表（Binance 现货 WS miniTicker + gold-api.com 金银轮询）
 * Registers as custom tool id 'watchlist' via window.GT_EXTRA_TOOLS.
 * 持久化: localStorage gt-watchlist-v1（列表）/ gt-watchlist-base-v1（金属当日基准价） */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_LIST = 'gt-watchlist-v1';
  const LS_BASE = 'gt-watchlist-base-v1';
  const DEFAULT_LIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAU', 'XAG'];
  const METALS = { XAU: '黄金', XAG: '白银' };
  const TV_MAP = { XAU: 'TVC:GOLD', XAG: 'TVC:SILVER' };
  const METAL_URL = { XAU: 'https://api.gold-api.com/price/XAU', XAG: 'https://api.gold-api.com/price/XAG' };
  const HOT_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT',
    'AVAXUSDT', 'LTCUSDT', 'DOTUSDT', 'TRXUSDT', 'ATOMUSDT', 'NEARUSDT', 'UNIUSDT', 'ARBUSDT',
    'OPUSDT', 'FILUSDT', 'APTUSDT', 'SUIUSDT', 'INJUSDT', 'TIAUSDT', 'PEPEUSDT', 'WIFUSDT',
    'BONKUSDT', 'ORDIUSDT', 'SEIUSDT', 'JUPUSDT', 'ENAUSDT', 'TONUSDT', 'XAU', 'XAG',
  ];
  const WS_URL = (syms) =>
    'wss://stream.binance.com:9443/stream?streams=' + syms.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
  const REST_URL = (syms) =>
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`;
  const METAL_POLL_MS = 30000;
  const REST_FALLBACK_MS = 15000;
  const RECONNECT_MS = 5000;

  function injectStyle() {
    if (document.getElementById('wl-style')) return;
    const style = document.createElement('style');
    style.id = 'wl-style';
    style.textContent = `
.wl-root { display: flex; flex-direction: column; gap: 8px; }
.wl-add { display: flex; gap: 6px; }
.wl-add input {
  flex: 1; min-width: 0;
  background: var(--surface-raised); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); color: var(--text);
  font-family: var(--font-mono); font-size: 11px; padding: 6px 8px;
  outline: none; text-transform: uppercase;
  transition: border-color 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid);
}
.wl-add input:focus { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-glow); }
.wl-add .tool-btn { flex-shrink: 0; }
.wl-table { font-variant-numeric: tabular-nums; }
.wl-table th, .wl-table td { white-space: nowrap; }
.wl-table tbody tr { cursor: pointer; transition: background 0.25s var(--ease-snap); }
.wl-table tbody tr:hover { background: var(--surface-raised); }
.wl-sym { font-weight: 600; }
.wl-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.wl-num { font-family: var(--font-mono); }
.wl-del {
  background: none; border: none; cursor: pointer; padding: 0 2px;
  color: var(--text-dim); font-size: 13px; line-height: 1;
  transition: color 0.25s var(--ease-snap);
}
.wl-del:hover { color: var(--danger); }
.wl-flash-up { animation: wl-flash-up 0.6s var(--ease-fluid); }
.wl-flash-down { animation: wl-flash-down 0.6s var(--ease-fluid); }
@keyframes wl-flash-up { 0% { color: var(--up); } 100% { color: inherit; } }
@keyframes wl-flash-down { 0% { color: var(--down); } 100% { color: inherit; } }
.wl-foot { font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); text-transform: uppercase; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toPrecision(4);
  }

  const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—');

  function displayName(sym) {
    if (METALS[sym]) return { main: METALS[sym], sub: sym };
    if (sym.endsWith('USDT')) return { main: sym.slice(0, -4), sub: '/USDT' };
    return { main: sym, sub: '' };
  }

  function loadList() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_LIST));
      if (Array.isArray(raw)) {
        const list = raw.filter((s) => typeof s === 'string' && (METALS[s] || /^[A-Z0-9]{2,20}USDT$/.test(s)));
        return list.length ? list : DEFAULT_LIST.slice();
      }
    } catch (e) { /* 损坏则回退默认 */ }
    return DEFAULT_LIST.slice();
  }

  function loadBase() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_BASE));
      if (raw && typeof raw === 'object') return raw;
    } catch (e) { /* ignore */ }
    return { date: '', XAU: null, XAG: null };
  }

  window.GT_EXTRA_TOOLS['watchlist'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool wl-root">
          <div class="wl-add">
            <input type="text" list="wl-cands" placeholder="添加自选，如 BTCUSDT / XAU" maxlength="12" spellcheck="false">
            <datalist id="wl-cands">
              ${HOT_SYMBOLS.map((s) => `<option value="${s}">${METALS[s] ? esc(METALS[s]) : ''}</option>`).join('')}
            </datalist>
            <button class="tool-btn" data-add type="button">添加</button>
          </div>
          <table class="data-table wl-table">
            <thead>
              <tr><th>名称</th><th>最新价</th><th>24h涨跌</th><th>24h高</th><th>24h低</th><th></th></tr>
            </thead>
            <tbody data-rows></tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="wl-foot">BINANCE WS · GOLD-API 30S · 点击行切换图表</div>
        </div>`;

      const tbody = el.querySelector('[data-rows]');
      const hint = el.querySelector('[data-hint]');
      const input = el.querySelector('input');
      const addBtn = el.querySelector('[data-add]');

      let list = loadList();
      let base = loadBase(); // 金属当日基准价 {date, XAU, XAG}
      const lastPrices = {}; // sym -> 最新价（用于 flash 方向判断）
      let alive = true;
      let ws = null;
      let wsRetryTimer = null;
      let restTimer = null;
      let metalTimer = null;
      const ctl = new AbortController();

      const saveList = () => {
        try { localStorage.setItem(LS_LIST, JSON.stringify(list)); } catch (e) { /* ignore */ }
      };
      const saveBase = () => {
        try { localStorage.setItem(LS_BASE, JSON.stringify(base)); } catch (e) { /* ignore */ }
      };

      const showHint = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
      };
      const clearHint = () => {
        hint.style.display = 'none';
      };

      const cryptoSyms = () => list.filter((s) => !METALS[s]);
      const metalSyms = () => list.filter((s) => METALS[s]);

      /* ---------- 渲染 ---------- */

      function renderRows() {
        if (!list.length) {
          tbody.innerHTML = '';
          showHint('自选列表为空，请在上方添加品种（如 BTCUSDT、XAU）');
          return;
        }
        tbody.innerHTML = list
          .map((sym) => {
            const n = displayName(sym);
            const sub = METALS[sym] ? `<i>${esc(n.sub)}</i>` : n.sub ? `<i>${esc(n.sub)}</i>` : '';
            return `
            <tr data-sym="${esc(sym)}" title="点击切换图表">
              <td class="wl-sym">${esc(n.main)}${sub}</td>
              <td class="wl-num" data-price>—</td>
              <td class="wl-num" data-chg>—</td>
              <td class="wl-num" data-high>—</td>
              <td class="wl-num" data-low>—</td>
              <td><button class="wl-del" data-del type="button" title="删除">×</button></td>
            </tr>`;
          })
          .join('');
      }

      function updateRow(sym, price, open, high, low) {
        if (!alive) return;
        const row = tbody.querySelector(`tr[data-sym="${sym}"]`);
        if (!row || !Number.isFinite(price)) return;
        const priceEl = row.querySelector('[data-price]');
        const chgEl = row.querySelector('[data-chg]');
        const prev = lastPrices[sym];
        priceEl.textContent = fmtPrice(price);
        if (Number.isFinite(prev) && prev !== price) {
          priceEl.classList.remove('wl-flash-up', 'wl-flash-down');
          void priceEl.offsetWidth; // 重触发动画
          priceEl.classList.add(price > prev ? 'wl-flash-up' : 'wl-flash-down');
        }
        lastPrices[sym] = price;
        const chg = Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : NaN;
        chgEl.textContent = fmtPct(chg);
        chgEl.classList.remove('pos', 'neg');
        if (Number.isFinite(chg)) chgEl.classList.add(chg >= 0 ? 'pos' : 'neg');
        if (Number.isFinite(high)) row.querySelector('[data-high]').textContent = fmtPrice(high);
        if (Number.isFinite(low)) row.querySelector('[data-low]').textContent = fmtPrice(low);
      }

      /* ---------- 币安 crypto 数据 ---------- */

      function applyTicker(d) {
        const sym = d.s;
        if (!list.includes(sym)) return;
        updateRow(sym, parseFloat(d.c), parseFloat(d.o), parseFloat(d.h), parseFloat(d.l));
      }

      function stopCrypto() {
        if (ws) {
          ws.onclose = null; // 阻止触发重连
          try { ws.close(); } catch (e) { /* ignore */ }
          ws = null;
        }
        if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
        if (restTimer) { clearInterval(restTimer); restTimer = null; }
      }

      function startRestFallback() {
        if (restTimer) return; // 已在轮询
        const syms = cryptoSyms();
        if (!syms.length) return;
        const poll = async () => {
          try {
            const res = await fetch(REST_URL(syms), { signal: ctl.signal });
            if (!res.ok) throw new Error(`http ${res.status}`);
            const data = await res.json();
            if (!Array.isArray(data)) throw new Error('bad data');
            data.forEach((d) => applyTicker({ s: d.symbol, c: d.lastPrice, o: d.openPrice, h: d.highPrice, l: d.lowPrice }));
            if (!alive) return;
            clearHint();
            setStatus('online');
          } catch (e) {
            if (!alive || (e && e.name === 'AbortError')) return;
            showHint('行情数据加载失败，稍后自动重试');
            setStatus('offline');
          }
        };
        poll();
        restTimer = setInterval(poll, REST_FALLBACK_MS);
      }

      function startCrypto() {
        stopCrypto();
        const syms = cryptoSyms();
        if (!syms.length || !alive) return;
        try {
          ws = new WebSocket(WS_URL(syms));
        } catch (e) {
          startRestFallback();
          return;
        }
        ws.onopen = () => {
          if (!alive) return;
          if (restTimer) { clearInterval(restTimer); restTimer = null; }
          clearHint();
          setStatus('online');
        };
        ws.onmessage = (ev) => {
          if (!alive) return;
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.data) applyTicker(msg.data);
          } catch (e) { /* 忽略坏包 */ }
        };
        ws.onclose = () => {
          ws = null;
          if (!alive) return;
          startRestFallback();
          wsRetryTimer = setTimeout(() => {
            wsRetryTimer = null;
            if (alive && cryptoSyms().length) startCrypto();
          }, RECONNECT_MS);
        };
        ws.onerror = () => {
          try { ws && ws.close(); } catch (e) { /* ignore */ }
        };
      }

      /* ---------- 金银数据 ---------- */

      function ensureMetalBase(sym, price) {
        const today = new Date().toISOString().slice(0, 10); // UTC 日期
        if (base.date !== today || !Number.isFinite(base[sym])) {
          if (base.date !== today) {
            base = { date: today, XAU: null, XAG: null };
          }
          base[sym] = price;
          saveBase();
        }
        return base[sym];
      }

      async function pollMetals() {
        const syms = metalSyms();
        if (!syms.length || !alive) return;
        const results = await Promise.allSettled(
          syms.map(async (sym) => {
            const res = await fetch(METAL_URL[sym], { signal: ctl.signal });
            if (!res.ok) throw new Error(`http ${res.status}`);
            const data = await res.json();
            const price = parseFloat(data && data.price);
            if (!Number.isFinite(price)) throw new Error('bad price');
            return { sym, price };
          })
        );
        if (!alive) return;
        let ok = 0;
        results.forEach((r) => {
          if (r.status === 'fulfilled') {
            ok += 1;
            const { sym, price } = r.value;
            const open = ensureMetalBase(sym, price);
            updateRow(sym, price, open, NaN, NaN);
          }
        });
        if (!ok) {
          showHint('金银数据加载失败，稍后自动重试');
          if (!cryptoSyms().length) setStatus('offline');
        }
      }

      function startMetals() {
        if (metalTimer) { clearInterval(metalTimer); metalTimer = null; }
        if (!metalSyms().length || !alive) return;
        pollMetals();
        metalTimer = setInterval(pollMetals, METAL_POLL_MS);
      }

      /* ---------- 增删与事件 ---------- */

      function refreshData() {
        renderRows();
        startCrypto();
        startMetals();
      }

      function addSymbol() {
        const sym = (input.value || '').trim().toUpperCase();
        if (!sym) return;
        if (!(METALS[sym] || /^[A-Z0-9]{2,20}USDT$/.test(sym))) {
          showHint('无效品种：请输入 USDT 交易对（如 BTCUSDT）或 XAU / XAG');
          return;
        }
        if (list.includes(sym)) {
          showHint(`${sym} 已在列表中`);
          input.value = '';
          return;
        }
        list.push(sym);
        saveList();
        input.value = '';
        clearHint();
        refreshData();
      }

      addBtn.addEventListener('click', addSymbol);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSymbol();
      });

      tbody.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-sym]');
        if (!row) return;
        const sym = row.getAttribute('data-sym');
        if (e.target.closest('[data-del]')) {
          list = list.filter((s) => s !== sym);
          delete lastPrices[sym];
          saveList();
          refreshData();
          return;
        }
        const tv = METALS[sym] ? TV_MAP[sym] : `BINANCE:${sym}`;
        window.dispatchEvent(new CustomEvent('gt:set-symbol', { detail: { tv } }));
      });

      /* ---------- 启动与清理 ---------- */

      refreshData();

      return () => {
        alive = false;
        stopCrypto();
        if (metalTimer) clearInterval(metalTimer);
        ctl.abort();
      };
    },
  };
})();
