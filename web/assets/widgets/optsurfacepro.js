/* Options Volatility Surface Pro — 高级期权隐含波动率曲面组件
 * Registers as custom tool id 'optsurfacepro' via window.GT_EXTRA_TOOLS.
 *
 * Features:
 *   - TICKER 输入，通过 /api/proxy 拉取 Yahoo Finance 期权链（无 API Key）
 *   - 手动表格编辑器，本地持久化
 *   - DEMO 曲面生成器（带偏度 + 期限结构）
 *   - 四种 SVG 视图：热力图 / 3D 曲面 / 期限结构 / 波动率偏度
 *   - 鼠标悬停任意视图时，双线性插值得到该点隐含波动率，并估算 Greeks
 *   - 失败时自动回退 DEMO 数据，不影响界面
 */
(function () {
  'use strict';

  const ROOT = typeof window !== 'undefined' ? window : globalThis;
  ROOT.GT_EXTRA_TOOLS = ROOT.GT_EXTRA_TOOLS || {};

  const WIDGET_ID = 'optsurfacepro';
  const STORAGE_KEY = 'gt_optsurfacepro_v1';
  const PROXY = (url) => `/api/proxy?url=${encodeURIComponent(url)}`;
  const YAHOO_OPTIONS = (ticker) => `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  const YAHOO_CHART = (ticker) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=30d`;

  const FETCH_TIMEOUT_MS = 15000;
  const REFRESH_MS = 2 * 60 * 1000;
  const VIEW_MODES = ['heatmap', 'surface3d', 'term', 'skew'];
  const VIEW_LABELS = {
    heatmap: '热力图',
    surface3d: '3D 曲面',
    term: '期限结构',
    skew: '波动率偏度',
  };

  /* ── Styles ── */
  function injectStyle() {
    if (document.getElementById('osp-style')) return;
    const style = document.createElement('style');
    style.id = 'osp-style';
    style.textContent = `
.osp-root { display:flex; flex-direction:column; height:100%; min-height:0; font-family:var(--font-mono); }
.osp-head {
  display:flex; justify-content:space-between; align-items:center; gap:10px;
  font-size:9px; letter-spacing:0.12em; color:var(--text-muted); margin-bottom:8px; flex-wrap:wrap;
}
.osp-title { font-weight:600; color:var(--text); }
.osp-status { color:var(--warning); white-space:nowrap; }
.osp-status.live { color:var(--acc); }
.osp-status.demo { color:var(--info); }
.osp-badge {
  font-size:9px; letter-spacing:0.1em; padding:1px 7px; border-radius:999px;
  border:1px solid var(--hairline); color:var(--text-muted); white-space:nowrap;
}
.osp-badge.manual { color:var(--warning); border-color:var(--warning); background:color-mix(in srgb, var(--warning) 10%, transparent); }
.osp-badge.demo { color:var(--info); border-color:var(--info); background:color-mix(in srgb, var(--info) 10%, transparent); }
.osp-badge.live { color:var(--acc); border-color:var(--acc); background:color-mix(in srgb, var(--acc) 10%, transparent); }
.osp-toolbar {
  display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:10px;
  padding:8px; border:1px solid var(--hairline); border-radius:var(--radius-sm); background:var(--surface-raised);
}
.osp-toolbar label { font-size:9px; color:var(--text-dim); letter-spacing:0.08em; }
.osp-toolbar input, .osp-toolbar select {
  background:var(--bg); color:var(--text); border:1px solid var(--hairline); border-radius:var(--radius-sm);
  padding:3px 6px; font-family:var(--font-mono); font-size:11px; outline:none;
}
.osp-toolbar input:focus, .osp-toolbar select:focus { border-color:var(--acc); }
.osp-toolbar input[type="number"] { width:72px; }
.osp-toolbar input[type="text"] { width:78px; }
.osp-btn {
  background:var(--surface); color:var(--text-muted); border:1px solid var(--hairline);
  border-radius:var(--radius-sm); padding:4px 10px; font-size:10px; letter-spacing:0.06em;
  cursor:pointer; transition:all 0.15s ease;
}
.osp-btn:hover { color:var(--text); border-color:var(--text-muted); }
.osp-btn.primary { color:var(--acc); border-color:var(--acc); background:color-mix(in srgb, var(--acc) 8%, transparent); }
.osp-btn.primary:hover { background:color-mix(in srgb, var(--acc) 14%, transparent); }
.osp-btn.active { color:var(--text); border-color:var(--acc); background:color-mix(in srgb, var(--acc) 12%, transparent); }
.osp-body { display:grid; grid-template-columns:220px 1fr; gap:10px; flex:1; min-height:0; }
@media (max-width:900px) { .osp-body { grid-template-columns:1fr; grid-template-rows:auto 1fr; } }
.osp-panel {
  border:1px solid var(--hairline); border-radius:var(--radius-sm); background:var(--surface);
  display:flex; flex-direction:column; min-height:0; overflow:hidden;
}
.osp-panel-hd {
  display:flex; justify-content:space-between; align-items:center; padding:6px 8px;
  border-bottom:1px solid var(--hairline); font-size:9px; letter-spacing:0.1em; color:var(--text-muted);
}
.osp-table-wrap { flex:1; overflow:auto; }
.osp-table { width:100%; border-collapse:collapse; font-size:10px; font-family:var(--font-mono); }
.osp-table th, .osp-table td { padding:5px 6px; text-align:right; border-bottom:1px solid var(--hairline); white-space:nowrap; }
.osp-table th { position:sticky; top:0; background:var(--surface-raised); color:var(--text-muted); font-weight:500; font-size:9px; letter-spacing:0.06em; }
.osp-table th:first-child, .osp-table td:first-child { text-align:left; }
.osp-table td { color:var(--text); }
.osp-table input {
  width:100%; background:transparent; border:1px solid transparent; color:var(--text);
  font-family:var(--font-mono); font-size:10px; padding:2px 4px; text-align:right;
}
.osp-table input:focus { background:var(--bg); border-color:var(--acc); outline:none; }
.osp-table td:first-child input { text-align:left; }
.osp-table tbody tr:hover td { background:var(--surface-raised); }
.osp-table tbody tr.selected td { background:color-mix(in srgb, var(--acc) 10%, transparent); }
.osp-table .osp-empty td { text-align:center; color:var(--text-muted); padding:14px 4px; }
.osp-row-actions { display:flex; gap:4px; justify-content:flex-end; }
.osp-icon-btn {
  background:transparent; border:none; color:var(--text-dim); cursor:pointer; font-size:12px; padding:0 2px;
}
.osp-icon-btn:hover { color:var(--down); }
.osp-viz { flex:1; display:flex; flex-direction:column; min-height:0; position:relative; }
.osp-viz-hd { display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid var(--hairline); }
.osp-viz-title { font-size:9px; letter-spacing:0.1em; color:var(--text-muted); }
.osp-viz-legend { display:flex; align-items:center; gap:6px; font-size:9px; color:var(--text-dim); }
.osp-viz-legend .osp-bar { flex:0 0 80px; height:6px; border-radius:var(--radius-sm);
  background:linear-gradient(to right, var(--down), var(--text-muted), var(--up)); }
.osp-svg-wrap { flex:1; min-height:0; position:relative; }
.osp-svg { width:100%; height:100%; display:block; }
.osp-axis-label { font-size:9px; fill:var(--text-dim); font-family:var(--font-mono); }
.osp-tip {
  position:absolute; pointer-events:none; background:var(--surface-raised); border:1px solid var(--hairline);
  border-radius:var(--radius-sm); padding:6px 8px; font-size:10px; font-family:var(--font-mono);
  color:var(--text); box-shadow:0 4px 14px rgba(0,0,0,0.35); opacity:0; transition:opacity 0.1s;
  z-index:10; max-width:240px; line-height:1.5;
}
.osp-greeks { padding:8px; border-top:1px solid var(--hairline); }
.osp-greeks-title { font-size:9px; letter-spacing:0.1em; color:var(--text-muted); margin-bottom:6px; }
.osp-greeks-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; }
.osp-greek { display:flex; justify-content:space-between; font-size:10px; font-family:var(--font-mono); }
.osp-greek-label { color:var(--text-dim); }
.osp-greek-val { color:var(--text); font-weight:600; }
.osp-greek-val.up { color:var(--up); }
.osp-greek-val.down { color:var(--down); }
.osp-foot { margin-top:8px; font-size:9px; color:var(--text-dim); line-height:1.5; }
.osp-foot code { font-family:var(--font-mono); color:var(--text-muted); }
.osp-analyze-param { padding:8px; border-top:1px solid var(--hairline); }
.osp-analyze-param-title { font-size:9px; letter-spacing:0.1em; color:var(--text-muted); margin-bottom:6px; }
.osp-mini-row { display:flex; gap:6px; align-items:center; margin-bottom:4px; }
.osp-mini-row label { font-size:9px; color:var(--text-dim); white-space:nowrap; }
.osp-mini-row input { flex:1; background:var(--bg); border:1px solid var(--hairline); color:var(--text);
  font-family:var(--font-mono); font-size:10px; padding:2px 5px; border-radius:var(--radius-sm); }
.osp-mini-row input:focus { border-color:var(--acc); outline:none; }
.osp-chart-line { fill:none; stroke:var(--acc); stroke-width:2; }
.osp-chart-area { fill:var(--acc-glow); opacity:0.25; stroke:none; }
.osp-chart-grid { stroke:var(--hairline); stroke-dasharray:2 2; }
.osp-chart-axis { fill:var(--text-dim); font-family:var(--font-mono); font-size:9px; }
.osp-chart-dot { fill:var(--acc); stroke:var(--bg); stroke-width:1.5; }
.osp-chart-hline { stroke:var(--warning); stroke-width:1; stroke-dasharray:3 3; }
.osp-chart-label { fill:var(--warning); font-family:var(--font-mono); font-size:9px; }
`;
    document.head.appendChild(style);
  }

  /* ── Utilities ── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function fmtNum(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtPct(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return `${fmtNum(v * 100, digits)}%`;
  }
  function fmtDate(days) {
    if (!Number.isFinite(days)) return '—';
    const d = new Date(Date.now() + days * 86400000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ── Black-Scholes ── */
  function ncdf(x) {
    if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327;
    const p = d * Math.exp((-x * x) / 2) *
      (t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
    return x > 0 ? 1 - p : p;
  }
  const npdf = (x) => Math.exp((-x * x) / 2) * 0.3989422804014327;

  function bsGreeks(S, K, T, sig, r, kind = 'call') {
    if (!Number.isFinite(S) || !Number.isFinite(K) || !Number.isFinite(T) || T <= 0 || !Number.isFinite(sig) || sig <= 0) return null;
    const sq = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + (sig * sig) / 2) * T) / (sig * sq);
    const d2 = d1 - sig * sq;
    const ert = Math.exp(-r * T);
    const isCall = kind === 'call';
    const Nd1 = ncdf(d1);
    const Nd2 = ncdf(d2);
    const Nmd1 = ncdf(-d1);
    const Nmd2 = ncdf(-d2);
    const pdf = npdf(d1);
    const price = isCall ? S * Nd1 - K * ert * Nd2 : K * ert * Nmd2 - S * Nmd1;
    return {
      price,
      d1,
      delta: isCall ? Nd1 : Nd1 - 1,
      gamma: pdf / (S * sig * sq),
      theta: (-(S * pdf * sig) / (2 * sq) + (isCall ? -r * K * ert * Nd2 : r * K * ert * Nmd2)) / 365,
      vega: (S * pdf * sq) / 100,
      rho: (isCall ? K * T * ert * Nd2 : -K * T * ert * Nmd2) / 100,
    };
  }

  /* ── Color scale ── */
  function hexToRgb(hex) {
    const m = hex.match(/#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})/i);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
  }
  function getCssColor(name) {
    if (typeof getComputedStyle === 'undefined') return '#888';
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || '#888';
  }
  function volColor(vol, min, max, stops) {
    if (!Number.isFinite(vol) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 'var(--text-muted)';
    const t = clamp((vol - min) / (max - min), 0, 1);
    const seg = (stops.length - 1) * t;
    const i = Math.min(stops.length - 2, Math.floor(seg));
    const local = seg - i;
    const a = hexToRgb(stops[i]);
    const b = hexToRgb(stops[i + 1]);
    const rgb = [Math.round(lerp(a[0], b[0], local)), Math.round(lerp(a[1], b[1], local)), Math.round(lerp(a[2], b[2], local))];
    return `rgb(${rgb.join(',')})`;
  }
  function buildStops() {
    return [getCssColor('--down'), '#8B8B8B', getCssColor('--up')];
  }

  /* ── Demo surface generator ── */
  function generateDemoSurface(spot = 100) {
    const rows = [];
    const expiries = [7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];
    const strikes = [0.70, 0.75, 0.80, 0.85, 0.90, 0.93, 0.96, 0.98, 1.00, 1.02, 1.04, 1.07, 1.10, 1.15, 1.20, 1.25, 1.30].map((m) => spot * m);
    for (const exp of expiries) {
      const T = exp / 365;
      const base = 0.20 + 0.07 * Math.exp(-T * 1.8) + 0.025 * Math.sqrt(T);
      for (const K of strikes) {
        const m = K / spot;
        const skew = m < 1 ? 0.16 * Math.pow(1 - m, 1.25) : 0.035 * Math.pow(m - 1, 0.85);
        const smile = 0.012 * Math.pow(m - 1, 2);
        const iv = Math.max(0.05, base + skew + smile + (Math.random() - 0.5) * 0.008);
        rows.push({ kind: m < 1 ? 'put' : 'call', strike: +K.toFixed(2), expiryDays: exp, iv: +iv.toFixed(4) });
      }
    }
    return rows;
  }

  /* ── Persistence ── */
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && Array.isArray(obj.rows)) return obj;
    } catch (e) {}
    return null;
  }
  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rows: state.rows,
        spot: state.spot,
        rate: state.rate,
        ticker: state.ticker,
        analyzeK: state.analyzeK,
        analyzeT: state.analyzeT,
      }));
    } catch (e) {}
  }

  /* ── Fetch ── */
  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function fetchSpot(ticker) {
    const data = await fetchWithTimeout(PROXY(YAHOO_CHART(ticker)));
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta && Number.isFinite(meta.regularMarketPrice)) return meta.regularMarketPrice;
    const close = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (Array.isArray(close)) {
      for (let i = close.length - 1; i >= 0; i--) if (Number.isFinite(close[i])) return close[i];
    }
    throw new Error('spot unavailable');
  }

  async function fetchYahooOptions(ticker) {
    const data = await fetchWithTimeout(PROXY(YAHOO_OPTIONS(ticker)));
    const result = data?.optionChain?.result?.[0];
    if (!result) throw new Error('empty options response');
    const spot = result.quote?.regularMarketPrice;
    if (!Number.isFinite(spot)) throw new Error('spot missing in options response');

    const rows = [];
    const opts = result.options || [];
    for (const opt of opts) {
      const expDate = opt.expirationDate;
      if (!expDate) continue;
      const expDays = Math.max(1, Math.round((expDate * 1000 - Date.now()) / 86400000));
      const process = (list, kind) => {
        for (const c of list || []) {
          if (!Number.isFinite(c.impliedVolatility) || !Number.isFinite(c.strike)) continue;
          rows.push({ kind, strike: +c.strike.toFixed(2), expiryDays: expDays, iv: +c.impliedVolatility.toFixed(4) });
        }
      };
      process(opt.calls, 'call');
      process(opt.puts, 'put');
    }
    if (!rows.length) throw new Error('no implied vol rows');
    return { spot, rows };
  }

  /* ── Grid & interpolation ── */
  function getGrid(rows) {
    const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
    const exps = [...new Set(rows.map((r) => r.expiryDays))].sort((a, b) => a - b);
    const map = new Map();
    for (const r of rows) {
      const key = `${r.strike}|${r.expiryDays}`;
      const arr = map.get(key) || [];
      arr.push(r.iv);
      map.set(key, arr);
    }
    const matrix = exps.map((d) => strikes.map((k) => {
      const arr = map.get(`${k}|${d}`);
      if (!arr) return NaN;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }));
    const flat = rows.map((r) => r.iv).filter(Number.isFinite);
    return { strikes, exps, matrix, min: Math.min(...flat), max: Math.max(...flat), map };
  }

  function interpIV(strike, expiry, grid) {
    const { strikes, exps, matrix } = grid;
    if (!strikes.length || !exps.length) return NaN;
    if (strikes.length === 1 && exps.length === 1) return matrix[0][0];

    // find surrounding indices
    let si = 0;
    while (si < strikes.length - 2 && strikes[si + 1] < strike) si++;
    if (strike < strikes[0]) si = -1;
    else if (strike >= strikes[strikes.length - 1]) si = strikes.length - 2;

    let ei = 0;
    while (ei < exps.length - 2 && exps[ei + 1] < expiry) ei++;
    if (expiry < exps[0]) ei = -1;
    else if (expiry >= exps[exps.length - 1]) ei = exps.length - 2;

    // edge extrapolation clamped
    const s0 = si < 0 ? strikes[0] : strikes[si];
    const s1 = si < 0 ? strikes[1] : (si >= strikes.length - 1 ? strikes[strikes.length - 1] : strikes[si + 1]);
    const e0 = ei < 0 ? exps[0] : exps[ei];
    const e1 = ei < 0 ? exps[1] : (ei >= exps.length - 1 ? exps[exps.length - 1] : exps[ei + 1]);

    const st = (s1 === s0) ? 0 : clamp((strike - s0) / (s1 - s0), 0, 1);
    const et = (e1 === e0) ? 0 : clamp((expiry - e0) / (e1 - e0), 0, 1);

    const v00 = matrix[Math.max(0, ei < 0 ? 0 : ei)][Math.max(0, si < 0 ? 0 : si)];
    const v10 = matrix[Math.max(0, ei < 0 ? 0 : ei)][Math.min(strikes.length - 1, si < 0 ? 1 : si + 1)];
    const v01 = matrix[Math.min(exps.length - 1, ei < 0 ? 1 : ei + 1)][Math.max(0, si < 0 ? 0 : si)];
    const v11 = matrix[Math.min(exps.length - 1, ei < 0 ? 1 : ei + 1)][Math.min(strikes.length - 1, si < 0 ? 1 : si + 1)];

    if (![v00, v10, v01, v11].every(Number.isFinite)) return NaN;
    return lerp(lerp(v00, v10, st), lerp(v01, v11, st), et);
  }

  function nearestExp(exps, target) {
    if (!exps.length) return NaN;
    return exps.reduce((best, d) => Math.abs(d - target) < Math.abs(best - target) ? d : best, exps[0]);
  }
  function nearestStrike(strikes, target) {
    if (!strikes.length) return NaN;
    return strikes.reduce((best, k) => Math.abs(k - target) < Math.abs(best - target) ? k : best, strikes[0]);
  }

  /* ── Main mount ── */
  function mount(el, setStatus) {
    injectStyle();
    let destroyed = false;
    const root = document.createElement('div');
    root.className = 'osp-root';
    el.appendChild(root);

    const saved = loadSaved();
    const demoSpot = 450;
    const state = {
      ticker: saved?.ticker || 'SPY',
      spot: saved?.spot != null ? saved.spot : demoSpot,
      rate: saved?.rate != null ? saved.rate : 0.045,
      rows: saved?.rows?.length ? saved.rows : generateDemoSurface(demoSpot),
      source: saved?.rows?.length ? 'manual' : 'demo',
      view: 'heatmap',
      selected: null,
      lastFetch: null,
      analyzeK: saved?.analyzeK != null ? saved.analyzeK : demoSpot,
      analyzeT: saved?.analyzeT != null ? saved.analyzeT : 30,
      hoverPoint: null,
    };

    let refreshTimer = null;
    let ro = null;

    function setStatusInternal(status, cls) {
      if (setStatus && typeof setStatus === 'function') setStatus(status);
      const badge = root.querySelector('.osp-status');
      if (badge) {
        badge.textContent = status;
        badge.className = `osp-status ${cls || ''}`;
      }
    }

    function persist() { saveState(state); }

    function render() {
      if (destroyed) return;
      root.innerHTML = `
        <div class="osp-head">
          <span class="osp-title">期权隐含波动率曲面 PRO</span>
          <span class="osp-status ${state.source === 'live' ? 'live' : state.source === 'demo' ? 'demo' : ''}">${state.lastFetch ? '就绪' : '初始化'}</span>
        </div>
        <div class="osp-toolbar">
          <label>标的</label>
          <input id="osp-ticker" type="text" value="${esc(state.ticker)}" placeholder="SPY" title="Underlying ticker">
          <label>现价</label>
          <input id="osp-spot" type="number" step="0.01" value="${fmtNum(state.spot, 2)}" title="Underlying spot price">
          <label>利率</label>
          <input id="osp-rate" type="number" step="0.001" value="${fmtNum(state.rate, 3)}" title="Risk-free rate">
          <button id="osp-fetch" class="osp-btn primary" title="Fetch via /api/proxy from Yahoo Finance">拉取 LIVE</button>
          <button id="osp-demo" class="osp-btn" title="Generate realistic demo surface">DEMO</button>
          <button id="osp-clear" class="osp-btn" title="Clear manual rows">清空</button>
          <button id="osp-add" class="osp-btn" title="Add manual row">+ 行</button>
          <span style="flex:1"></span>
          ${VIEW_MODES.map((v) => `<button class="osp-btn ${state.view === v ? 'active' : ''}" data-view="${v}">${VIEW_LABELS[v]}</button>`).join('')}
        </div>
        <div class="osp-body">
          <div class="osp-panel">
            <div class="osp-panel-hd">
              <span>数据表</span>
              <span class="osp-badge ${state.source}">${state.source.toUpperCase()}</span>
            </div>
            <div class="osp-table-wrap">
              <table class="osp-table">
                <thead><tr><th>方向</th><th>行权价</th><th>天数</th><th>IV%</th><th></th></tr></thead>
                <tbody id="osp-tbody"></tbody>
              </table>
            </div>
            <div class="osp-greeks">
              <div class="osp-greeks-title">GREEKS 估算 · ${state.hoverPoint ? `K=${fmtNum(state.hoverPoint.strike)} T=${fmtNum(state.hoverPoint.expiry,0)}d` : '悬停/点选数据点'}</div>
              <div class="osp-greeks-grid" id="osp-greeks"></div>
            </div>
            <div class="osp-analyze-param" id="osp-analyze"></div>
          </div>
          <div class="osp-panel osp-viz">
            <div class="osp-viz-hd">
              <span class="osp-viz-title" id="osp-viz-title">${VIEW_LABELS[state.view]}</span>
              <div class="osp-viz-legend" id="osp-legend" style="${state.view === 'heatmap' || state.view === 'surface3d' ? '' : 'display:none'}">
                <span>低 IV</span><i class="osp-bar"></i><span>高 IV</span>
              </div>
            </div>
            <div class="osp-svg-wrap" id="osp-viz-wrap"><svg class="osp-svg" id="osp-svg"></svg><div class="osp-tip" id="osp-tip"></div></div>
          </div>
        </div>
        <div class="osp-foot">
          数据源：<code>${state.source.toUpperCase()}</code>${state.source === 'live' ? ` · ${state.rows.length} 合约 · ${state.lastFetch || ''}` : ''}。
          手动行自动保存。LIVE 通过 <code>/api/proxy</code> 代理 Yahoo Finance 期权链；失败时请使用 DEMO 或手动输入。
        </div>
      `;

      bindControls();
      renderTable();
      renderGreeks();
      renderAnalyzeParam();
      requestAnimationFrame(drawViz);
    }

    function bindControls() {
      const tickerInput = root.querySelector('#osp-ticker');
      const spotInput = root.querySelector('#osp-spot');
      const rateInput = root.querySelector('#osp-rate');
      tickerInput.addEventListener('change', () => { state.ticker = tickerInput.value.trim().toUpperCase(); persist(); });
      spotInput.addEventListener('change', () => {
        const v = parseFloat(spotInput.value);
        if (Number.isFinite(v)) { state.spot = v; if (!state.rows.length) state.analyzeK = v; persist(); drawViz(); }
      });
      rateInput.addEventListener('change', () => {
        const v = parseFloat(rateInput.value);
        if (Number.isFinite(v)) { state.rate = v; persist(); renderGreeks(); }
      });

      root.querySelector('#osp-add').addEventListener('click', () => {
        state.rows.push({ kind: 'call', strike: state.spot, expiryDays: 30, iv: 0.25 });
        state.source = 'manual';
        persist(); renderTable(); drawViz();
      });
      root.querySelector('#osp-demo').addEventListener('click', () => {
        clearRefresh();
        state.rows = generateDemoSurface(state.spot);
        state.source = 'demo';
        state.lastFetch = null;
        state.analyzeK = state.spot;
        state.analyzeT = 30;
        persist(); renderTable(); drawViz(); renderGreeks(); renderAnalyzeParam();
      });
      root.querySelector('#osp-clear').addEventListener('click', () => {
        clearRefresh();
        state.rows = []; state.selected = null; state.source = 'manual'; state.lastFetch = null;
        persist(); renderTable(); drawViz(); renderGreeks();
      });
      root.querySelector('#osp-fetch').addEventListener('click', fetchLive);

      root.querySelectorAll('[data-view]').forEach((b) => {
        b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
      });
    }

    function clearRefresh() {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }

    async function fetchLive() {
      const ticker = state.ticker;
      setStatusInternal('拉取中…', '');
      clearRefresh();
      try {
        const [spot, opt] = await Promise.all([
          fetchSpot(ticker).catch(() => null),
          fetchYahooOptions(ticker),
        ]);
        state.rows = opt.rows;
        state.spot = Number.isFinite(spot) ? spot : opt.spot;
        state.source = 'live';
        state.lastFetch = new Date().toLocaleTimeString();
        state.analyzeK = state.spot;
        state.analyzeT = nearestExp([...new Set(state.rows.map((r) => r.expiryDays))].sort((a, b) => a - b), 30);
        setStatusInternal('LIVE', 'live');
        persist();
        render();
        refreshTimer = setInterval(fetchLive, REFRESH_MS);
      } catch (err) {
        setStatusInternal(`LIVE 失败: ${err.message}`, '');
        // eslint-disable-next-line no-console
        console.warn('[optsurfacepro] fetch failed', err);
      }
    }

    function renderTable() {
      const tbody = root.querySelector('#osp-tbody');
      if (!tbody) return;
      if (!state.rows.length) {
        tbody.innerHTML = `<tr class="osp-empty"><td colspan="5">无数据，请添加手动行、DEMO 或拉取 LIVE。</td></tr>`;
        return;
      }
      tbody.innerHTML = state.rows.map((r, i) => `
        <tr data-idx="${i}" class="${state.selected === r ? 'selected' : ''}">
          <td><input data-field="kind" value="${esc(r.kind)}" autocomplete="off"></td>
          <td><input data-field="strike" type="number" step="0.01" value="${fmtNum(r.strike, 2)}"></td>
          <td><input data-field="expiryDays" type="number" step="1" value="${r.expiryDays}"></td>
          <td><input data-field="iv" type="number" step="0.0001" value="${fmtNum(r.iv * 100, 2)}"></td>
          <td class="osp-row-actions"><button class="osp-icon-btn" title="Delete">×</button></td>
        </tr>
      `).join('');

      tbody.querySelectorAll('input').forEach((input) => {
        input.addEventListener('change', () => {
          const tr = input.closest('tr');
          const i = parseInt(tr.dataset.idx, 10);
          const r = state.rows[i];
          const field = input.dataset.field;
          if (field === 'kind') r.kind = (input.value || 'call').toLowerCase().startsWith('p') ? 'put' : 'call';
          else {
            const v = parseFloat(input.value);
            if (Number.isFinite(v)) {
              if (field === 'iv') r.iv = v / 100;
              else r[field] = v;
            }
          }
          state.source = 'manual';
          persist(); drawViz();
        });
      });
      tbody.querySelectorAll('tr').forEach((tr) => {
        tr.addEventListener('mouseenter', () => {
          const i = parseInt(tr.dataset.idx, 10);
          state.selected = state.rows[i];
          state.hoverPoint = { strike: state.selected.strike, expiry: state.selected.expiryDays };
          renderGreeks();
        });
        tr.querySelector('.osp-icon-btn').addEventListener('click', () => {
          const i = parseInt(tr.dataset.idx, 10);
          if (state.selected === state.rows[i]) state.selected = null;
          state.rows.splice(i, 1);
          state.source = 'manual';
          persist(); renderTable(); drawViz(); renderGreeks();
        });
      });
    }

    function renderGreeks() {
      const grid = root.querySelector('#osp-greeks');
      if (!grid) return;
      const hp = state.hoverPoint;
      let K, T, iv;
      if (hp && Number.isFinite(hp.strike) && Number.isFinite(hp.expiry)) {
        K = hp.strike; T = Math.max(1e-6, hp.expiry / 365);
        iv = interpIV(K, hp.expiry, getGrid(state.rows));
      } else {
        const r = state.selected || state.rows[state.rows.length - 1];
        if (!r) { grid.innerHTML = '<div class="osp-greek"><span class="osp-greek-label">—</span></div>'; return; }
        K = r.strike; T = Math.max(1e-6, r.expiryDays / 365); iv = r.iv;
      }
      if (!Number.isFinite(iv)) { grid.innerHTML = '<div class="osp-greek"><span class="osp-greek-label">无有效插值</span></div>'; return; }
      const kind = K < state.spot ? 'put' : 'call';
      const g = bsGreeks(state.spot, K, T, iv, state.rate, kind);
      if (!g) { grid.innerHTML = '<div class="osp-greek"><span class="osp-greek-label">输入无效</span></div>'; return; }
      const items = [
        ['IV', fmtPct(iv), iv >= 0 ? '' : 'down'],
        ['PRICE', fmtNum(g.price, 3), g.price >= 0 ? 'up' : 'down'],
        ['DELTA', fmtNum(g.delta, 4), g.delta >= 0 ? 'up' : 'down'],
        ['GAMMA', fmtNum(g.gamma, 5), ''],
        ['THETA', fmtNum(g.theta, 4), g.theta >= 0 ? 'up' : 'down'],
        ['VEGA', fmtNum(g.vega, 4), ''],
        ['RHO', fmtNum(g.rho, 4), g.rho >= 0 ? 'up' : 'down'],
      ];
      grid.innerHTML = items.map(([label, val, cls]) => `
        <div class="osp-greek"><span class="osp-greek-label">${label}</span><span class="osp-greek-val ${cls}">${val}</span></div>
      `).join('');
    }

    function renderAnalyzeParam() {
      const box = root.querySelector('#osp-analyze');
      if (!box) return;
      if (state.view === 'term') {
        box.innerHTML = `
          <div class="osp-analyze-param-title">期限结构参数</div>
          <div class="osp-mini-row"><label>固定行权价 K</label><input id="osp-ak" type="number" step="0.01" value="${fmtNum(state.analyzeK, 2)}"></div>
        `;
        box.querySelector('#osp-ak').addEventListener('change', () => {
          const v = parseFloat(box.querySelector('#osp-ak').value);
          if (Number.isFinite(v)) { state.analyzeK = v; persist(); drawViz(); }
        });
      } else if (state.view === 'skew') {
        box.innerHTML = `
          <div class="osp-analyze-param-title">波动率偏度参数</div>
          <div class="osp-mini-row"><label>固定到期日 T</label><input id="osp-at" type="number" step="1" value="${fmtNum(state.analyzeT, 0)}"></div>
        `;
        box.querySelector('#osp-at').addEventListener('change', () => {
          const v = parseFloat(box.querySelector('#osp-at').value);
          if (Number.isFinite(v)) { state.analyzeT = v; persist(); drawViz(); }
        });
      } else {
        box.innerHTML = '';
      }
    }

    /* ── Visualization ── */
    function drawViz() {
      const svg = root.querySelector('#osp-svg');
      const wrap = root.querySelector('#osp-viz-wrap');
      const title = root.querySelector('#osp-viz-title');
      if (!svg || !wrap) return;
      if (title) title.textContent = VIEW_LABELS[state.view];
      const rect = wrap.getBoundingClientRect();
      const W = Math.max(200, rect.width);
      const H = Math.max(150, rect.height);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = '';
      state.hoverPoint = null;
      if (!state.rows.length) return;
      if (state.view === 'heatmap') drawHeatmap(svg, W, H);
      else if (state.view === 'surface3d') drawSurface3d(svg, W, H);
      else if (state.view === 'term') drawTerm(svg, W, H);
      else if (state.view === 'skew') drawSkew(svg, W, H);
    }

    function attachHover(el, html, point) {
      const tip = root.querySelector('#osp-tip');
      if (!tip) return;
      el.addEventListener('mouseenter', (e) => {
        tip.innerHTML = html;
        tip.style.opacity = '1';
        if (point) { state.hoverPoint = point; renderGreeks(); }
        moveTip(e);
      });
      el.addEventListener('mousemove', moveTip);
      el.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
      function moveTip(e) {
        const wrap = root.querySelector('#osp-viz-wrap');
        const rect = wrap.getBoundingClientRect();
        const x = e.clientX - rect.left + 10;
        const y = e.clientY - rect.top + 10;
        tip.style.left = `${Math.min(x, rect.width - tip.offsetWidth - 6)}px`;
        tip.style.top = `${Math.min(y, rect.height - tip.offsetHeight - 6)}px`;
      }
    }

    function drawHeatmap(svg, W, H) {
      const grid = getGrid(state.rows);
      const { strikes, exps, matrix, min, max } = grid;
      if (!strikes.length || !exps.length) return;
      const stops = buildStops();
      const pad = { top: 24, right: 16, bottom: 44, left: 54 };
      const cw = (W - pad.left - pad.right) / strikes.length;
      const ch = (H - pad.top - pad.bottom) / exps.length;

      for (let i = 0; i < exps.length; i++) {
        for (let j = 0; j < strikes.length; j++) {
          const iv = matrix[i][j];
          if (!Number.isFinite(iv)) continue;
          const x = pad.left + j * cw;
          const y = pad.top + i * ch;
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', x); rect.setAttribute('y', y);
          rect.setAttribute('width', Math.max(1, cw - 1)); rect.setAttribute('height', Math.max(1, ch - 1));
          rect.setAttribute('fill', volColor(iv, min, max, stops));
          rect.setAttribute('stroke', 'var(--hairline)');
          rect.style.cursor = 'pointer';
          const point = { strike: strikes[j], expiry: exps[i] };
          attachHover(rect, `K ${fmtNum(strikes[j])}<br>T ${exps[i]}d (${fmtDate(exps[i])})<br>IV ${fmtPct(iv)}`, point);
          svg.appendChild(rect);
        }
      }

      // axes
      for (let j = 0; j < strikes.length; j++) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', pad.left + j * cw + cw / 2);
        txt.setAttribute('y', H - pad.bottom + 14);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('class', 'osp-axis-label');
        txt.textContent = fmtNum(strikes[j], strikes[j] >= 1000 ? 0 : 1);
        svg.appendChild(txt);
      }
      for (let i = 0; i < exps.length; i++) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', pad.left - 8);
        txt.setAttribute('y', pad.top + i * ch + ch / 2 + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('class', 'osp-axis-label');
        txt.textContent = `${exps[i]}d`;
        svg.appendChild(txt);
      }
      addAxisLabels(svg, W, H, '行权价 →', '← 到期日');

      // global mousemove for smooth interpolation between cells
      svg.addEventListener('mousemove', (e) => {
        const wrap = root.querySelector('#osp-viz-wrap');
        const r = wrap.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        if (mx < pad.left || mx > W - pad.right || my < pad.top || my > H - pad.bottom) return;
        const jf = (mx - pad.left) / cw - 0.5;
        const fi = (my - pad.top) / ch - 0.5;
        const j = clamp(Math.round(jf), 0, strikes.length - 1);
        const i = clamp(Math.round(fi), 0, exps.length - 1);
        const strike = strikes[j];
        const expiry = exps[i];
        state.hoverPoint = { strike, expiry };
        renderGreeks();
      });
    }

    function drawSurface3d(svg, W, H) {
      const grid = getGrid(state.rows);
      const { strikes, exps, matrix, min, max } = grid;
      if (strikes.length < 2 || exps.length < 2) return;
      const stops = buildStops();
      const pad = { top: 24, right: 24, bottom: 44, left: 54 };
      const w = W - pad.left - pad.right;
      const h = H - pad.top - pad.bottom;

      const ax = -0.55;
      const ay = 0.35;
      const cx = strikes[(strikes.length - 1) >> 1];
      const cy = exps[(exps.length - 1) >> 1];
      const sx = w / (strikes[strikes.length - 1] - strikes[0] || 1);
      const sy = h / (exps[exps.length - 1] - exps[0] || 1);

      function project(k, d, iv) {
        const z = ((iv - min) / Math.max(1e-6, max - min)) * Math.min(w, h) * 0.35;
        const x0 = (k - cx) * sx * 0.7;
        const y0 = (d - cy) * sy * 0.7;
        const x1 = x0 * Math.cos(ay) + z * Math.sin(ay);
        const z1 = -x0 * Math.sin(ay) + z * Math.cos(ay);
        const y1 = y0 * Math.cos(ax) - z1 * Math.sin(ax);
        return [pad.left + w / 2 + x1, pad.top + h / 2 + y1];
      }

      const quads = [];
      for (let i = 0; i < exps.length - 1; i++) {
        for (let j = 0; j < strikes.length - 1; j++) {
          const vals = [matrix[i][j], matrix[i][j + 1], matrix[i + 1][j + 1], matrix[i + 1][j]];
          if (vals.some((v) => !Number.isFinite(v))) continue;
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          const pts = [
            project(strikes[j], exps[i], vals[0]),
            project(strikes[j + 1], exps[i], vals[1]),
            project(strikes[j + 1], exps[i + 1], vals[2]),
            project(strikes[j], exps[i + 1], vals[3]),
          ];
          const depth = pts.reduce((s, p) => s + p[1], 0);
          const centerK = strikes[j] + (strikes[j + 1] - strikes[j]) / 2;
          const centerD = exps[i] + (exps[i + 1] - exps[i]) / 2;
          quads.push({ pts, avg, depth, center: [centerK, centerD] });
        }
      }
      quads.sort((a, b) => a.depth - b.depth);

      let nearest = null;
      function updateNearest(e) {
        const wrap = root.querySelector('#osp-viz-wrap');
        const r = wrap.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        let best = null;
        let bestDist = Infinity;
        for (const q of quads) {
          const cxq = q.pts.reduce((s, p) => s + p[0], 0) / 4;
          const cyq = q.pts.reduce((s, p) => s + p[1], 0) / 4;
          const d = (mx - cxq) ** 2 + (my - cyq) ** 2;
          if (d < bestDist) { bestDist = d; best = q; }
        }
        nearest = best;
        if (nearest) {
          state.hoverPoint = { strike: nearest.center[0], expiry: nearest.center[1] };
          renderGreeks();
        }
      }

      for (const q of quads) {
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', q.pts.map((p) => p.join(',')).join(' '));
        poly.setAttribute('fill', volColor(q.avg, min, max, stops));
        poly.setAttribute('stroke', 'var(--surface-raised)');
        poly.setAttribute('stroke-width', '0.5');
        poly.setAttribute('fill-opacity', '0.85');
        poly.style.cursor = 'pointer';
        attachHover(poly, `K ${fmtNum(q.center[0])}<br>T ${fmtNum(q.center[1], 0)}d<br>平均 IV ${fmtPct(q.avg)}`, { strike: q.center[0], expiry: q.center[1] });
        svg.appendChild(poly);
      }
      svg.addEventListener('mousemove', updateNearest);
      addAxisLabels(svg, W, H, '行权价 →', '到期日 →');
    }

    function drawTerm(svg, W, H) {
      const grid = getGrid(state.rows);
      const { exps } = grid;
      if (!exps.length) return;
      const pad = { top: 22, right: 44, bottom: 34, left: 48 };
      const w = W - pad.left - pad.right;
      const h = H - pad.top - pad.bottom;

      const K = state.analyzeK;
      const pts = exps.map((d) => ({ d, iv: interpIV(K, d, grid) })).filter((p) => Number.isFinite(p.iv));
      if (pts.length < 2) return;
      const minD = pts[0].d;
      const maxD = pts[pts.length - 1].d;
      const ivs = pts.map((p) => p.iv);
      const minIV = Math.min(...ivs);
      const maxIV = Math.max(...ivs);
      const rangeIV = Math.max(maxIV - minIV, 0.005);

      const X = (d) => pad.left + ((d - minD) / (maxD - minD || 1)) * w;
      const Y = (iv) => pad.top + h - ((iv - (minIV - rangeIV * 0.1)) / (rangeIV * 1.2)) * h;

      // grid
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (h * i) / 4;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', pad.left); line.setAttribute('y1', y);
        line.setAttribute('x2', W - pad.right); line.setAttribute('y2', y);
        line.setAttribute('class', 'osp-chart-grid');
        svg.appendChild(line);
        const v = minIV - rangeIV * 0.1 + (rangeIV * 1.2 * (4 - i)) / 4;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', pad.left - 6); t.setAttribute('y', y + 3);
        t.setAttribute('text-anchor', 'end');
        t.setAttribute('class', 'osp-chart-axis');
        t.textContent = fmtPct(v);
        svg.appendChild(t);
      }

      // area + line
      let pathD = '';
      let areaD = '';
      pts.forEach((p, i) => {
        const x = X(p.d);
        const y = Y(p.iv);
        pathD += `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        areaD += `${i === 0 ? `M ${x} ${pad.top + h}` : ''} L ${x} ${y}`;
      });
      if (pts.length) areaD += ` L ${X(pts[pts.length - 1].d)} ${pad.top + h} Z`;

      const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      area.setAttribute('d', areaD);
      area.setAttribute('class', 'osp-chart-area');
      svg.appendChild(area);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('class', 'osp-chart-line');
      svg.appendChild(path);

      // dots + x-axis labels
      pts.forEach((p) => {
        const x = X(p.d);
        const y = Y(p.iv);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 3);
        dot.setAttribute('class', 'osp-chart-dot');
        attachHover(dot, `K ${fmtNum(K)}<br>T ${p.d}d<br>IV ${fmtPct(p.iv)}`, { strike: K, expiry: p.d });
        svg.appendChild(dot);

        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x); t.setAttribute('y', pad.top + h + 14);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'osp-chart-axis');
        t.textContent = `${p.d}d`;
        svg.appendChild(t);
      });

      // hover line
      const hoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hoverLine.setAttribute('class', 'osp-chart-hline');
      hoverLine.setAttribute('y1', pad.top);
      hoverLine.setAttribute('y2', pad.top + h);
      hoverLine.style.opacity = '0';
      svg.appendChild(hoverLine);

      svg.addEventListener('mousemove', (e) => {
        const wrap = root.querySelector('#osp-viz-wrap');
        const r = wrap.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const ratio = clamp((mx - pad.left) / w, 0, 1);
        const expiry = minD + ratio * (maxD - minD);
        const iv = interpIV(K, expiry, grid);
        if (Number.isFinite(iv)) {
          state.hoverPoint = { strike: K, expiry };
          renderGreeks();
          hoverLine.setAttribute('x1', mx); hoverLine.setAttribute('x2', mx);
          hoverLine.style.opacity = '1';
        }
      });
      svg.addEventListener('mouseleave', () => { hoverLine.style.opacity = '0'; });

      addAxisLabels(svg, W, H, '到期日 →', 'IV →');
    }

    function drawSkew(svg, W, H) {
      const grid = getGrid(state.rows);
      const { strikes } = grid;
      if (!strikes.length) return;
      const pad = { top: 22, right: 44, bottom: 34, left: 48 };
      const w = W - pad.left - pad.right;
      const h = H - pad.top - pad.bottom;

      const exp = state.analyzeT;
      const pts = strikes.map((k) => ({ k, iv: interpIV(k, exp, grid) })).filter((p) => Number.isFinite(p.iv));
      if (pts.length < 2) return;
      const minK = pts[0].k;
      const maxK = pts[pts.length - 1].k;
      const ivs = pts.map((p) => p.iv);
      const minIV = Math.min(...ivs);
      const maxIV = Math.max(...ivs);
      const rangeIV = Math.max(maxIV - minIV, 0.005);

      const X = (k) => pad.left + ((k - minK) / (maxK - minK || 1)) * w;
      const Y = (iv) => pad.top + h - ((iv - (minIV - rangeIV * 0.1)) / (rangeIV * 1.2)) * h;

      // grid
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (h * i) / 4;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', pad.left); line.setAttribute('y1', y);
        line.setAttribute('x2', W - pad.right); line.setAttribute('y2', y);
        line.setAttribute('class', 'osp-chart-grid');
        svg.appendChild(line);
        const v = minIV - rangeIV * 0.1 + (rangeIV * 1.2 * (4 - i)) / 4;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', pad.left - 6); t.setAttribute('y', y + 3);
        t.setAttribute('text-anchor', 'end');
        t.setAttribute('class', 'osp-chart-axis');
        t.textContent = fmtPct(v);
        svg.appendChild(t);
      }

      let pathD = '';
      let areaD = '';
      pts.forEach((p, i) => {
        const x = X(p.k);
        const y = Y(p.iv);
        pathD += `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        areaD += `${i === 0 ? `M ${x} ${pad.top + h}` : ''} L ${x} ${y}`;
      });
      if (pts.length) areaD += ` L ${X(pts[pts.length - 1].k)} ${pad.top + h} Z`;

      const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      area.setAttribute('d', areaD);
      area.setAttribute('class', 'osp-chart-area');
      svg.appendChild(area);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('class', 'osp-chart-line');
      svg.appendChild(path);

      pts.forEach((p) => {
        const x = X(p.k);
        const y = Y(p.iv);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 3);
        dot.setAttribute('class', 'osp-chart-dot');
        attachHover(dot, `K ${fmtNum(p.k)}<br>T ${exp}d<br>IV ${fmtPct(p.iv)}`, { strike: p.k, expiry: exp });
        svg.appendChild(dot);

        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x); t.setAttribute('y', pad.top + h + 14);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'osp-chart-axis');
        t.textContent = fmtNum(p.k, p.k >= 1000 ? 0 : 1);
        svg.appendChild(t);
      });

      // spot vertical line
      if (state.spot >= minK && state.spot <= maxK) {
        const sx = X(state.spot);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', sx); line.setAttribute('y1', pad.top);
        line.setAttribute('x2', sx); line.setAttribute('y2', pad.top + h);
        line.setAttribute('class', 'osp-chart-hline');
        svg.appendChild(line);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', sx); label.setAttribute('y', pad.top - 4);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'osp-chart-label');
        label.textContent = `S=${fmtNum(state.spot)}`;
        svg.appendChild(label);
      }

      const hoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hoverLine.setAttribute('class', 'osp-chart-hline');
      hoverLine.setAttribute('y1', pad.top);
      hoverLine.setAttribute('y2', pad.top + h);
      hoverLine.style.opacity = '0';
      svg.appendChild(hoverLine);

      svg.addEventListener('mousemove', (e) => {
        const wrap = root.querySelector('#osp-viz-wrap');
        const r = wrap.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const ratio = clamp((mx - pad.left) / w, 0, 1);
        const strike = minK + ratio * (maxK - minK);
        const iv = interpIV(strike, exp, grid);
        if (Number.isFinite(iv)) {
          state.hoverPoint = { strike, expiry: exp };
          renderGreeks();
          hoverLine.setAttribute('x1', mx); hoverLine.setAttribute('x2', mx);
          hoverLine.style.opacity = '1';
        }
      });
      svg.addEventListener('mouseleave', () => { hoverLine.style.opacity = '0'; });

      addAxisLabels(svg, W, H, '行权价 →', 'IV →');
    }

    function addAxisLabels(svg, W, H, xlabel, ylabel) {
      const xl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xl.setAttribute('x', W / 2); xl.setAttribute('y', H - 6);
      xl.setAttribute('text-anchor', 'middle'); xl.setAttribute('class', 'osp-axis-label');
      xl.textContent = xlabel; svg.appendChild(xl);
      const yl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      yl.setAttribute('x', 12); yl.setAttribute('y', H / 2);
      yl.setAttribute('text-anchor', 'middle'); yl.setAttribute('transform', `rotate(-90, 12, ${H / 2})`);
      yl.setAttribute('class', 'osp-axis-label');
      yl.textContent = ylabel; svg.appendChild(yl);
    }

    /* ── Resize & lifecycle ── */
    try {
      ro = new ResizeObserver(() => { if (!destroyed) drawViz(); });
      ro.observe(el);
    } catch (e) {}

    render();
    setStatusInternal(state.source === 'live' ? 'LIVE' : state.source === 'demo' ? 'DEMO' : 'MANUAL', state.source === 'live' ? 'live' : state.source === 'demo' ? 'demo' : '');

    return {
      destroy() {
        destroyed = true;
        if (ro) ro.disconnect();
        if (refreshTimer) clearInterval(refreshTimer);
        root.innerHTML = '';
        root.remove();
      },
    };
  }

  ROOT.GT_EXTRA_TOOLS[WIDGET_ID] = { mount };
})();
