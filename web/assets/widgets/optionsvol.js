/* Options Volatility Surface — manual vol surface editor + Yahoo Finance options fallback/demo.
 * Registers as custom tool id 'optionsvol' via window.GT_EXTRA_TOOLS.
 * Features:
 *   - Manual input table for strike / expiration / implied volatility rows.
 *   - Demo surface generator (realistic equity vol skew + term structure).
 *   - Yahoo Finance options chain fetch via /api/proxy (no API key, graceful fallback).
 *   - SVG heatmap + simple perspective 3D surface views.
 *   - Estimated Greeks (Delta/Gamma/Theta/Vega/Rho) at hovered/selected point using Black-Scholes.
 *   - Clear "MANUAL / DEMO / LIVE" data source labeling.
 */
(function () {
  'use strict';

  const ROOT = typeof window !== 'undefined' ? window : globalThis;
  ROOT.GT_EXTRA_TOOLS = ROOT.GT_EXTRA_TOOLS || {};

  const WIDGET_ID = 'optionsvol';
  const STORAGE_KEY = 'gt_optionsvol_manual_v1';
  const PROXY = (url) => `/api/proxy?url=${encodeURIComponent(url)}`;
  const YAHOO_OPTIONS = (ticker) => `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  const YAHOO_CHART = (ticker) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=30d`;

  const FETCH_TIMEOUT_MS = 15000;
  const REFRESH_MS = 2 * 60 * 1000; // live data refresh cadence

  const VIEW_MODES = ['heatmap', 'surface3d'];

  function injectStyle() {
    if (document.getElementById('ovol-style')) return;
    const style = document.createElement('style');
    style.id = 'ovol-style';
    style.textContent = `
.ovol-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ovol-head {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); margin-bottom: 8px; flex-wrap: wrap;
}
.ovol-title { font-weight: 600; color: var(--text); }
.ovol-status { color: var(--warning); white-space: nowrap; }
.ovol-status.live { color: var(--acc); }
.ovol-status.demo { color: var(--info); }
.ovol-badge {
  font-size: 9px; letter-spacing: 0.1em; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--hairline); color: var(--text-muted); white-space: nowrap;
}
.ovol-badge.manual { color: var(--warning); border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.ovol-badge.demo { color: var(--info); border-color: var(--info); background: color-mix(in srgb, var(--info) 10%, transparent); }
.ovol-badge.live { color: var(--acc); border-color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, transparent); }
.ovol-toolbar {
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 10px;
  padding: 8px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface-raised);
}
.ovol-toolbar label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; }
.ovol-toolbar input, .ovol-toolbar select {
  background: var(--bg); color: var(--text); border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  padding: 3px 6px; font-family: var(--font-mono); font-size: 11px; outline: none;
}
.ovol-toolbar input:focus, .ovol-toolbar select:focus { border-color: var(--acc); }
.ovol-toolbar input[type="number"] { width: 70px; }
.ovol-btn {
  background: var(--surface); color: var(--text-muted); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); padding: 4px 10px; font-size: 10px; letter-spacing: 0.06em;
  cursor: pointer; transition: all 0.15s ease;
}
.ovol-btn:hover { color: var(--text); border-color: var(--text-muted); }
.ovol-btn.primary { color: var(--acc); border-color: var(--acc); background: color-mix(in srgb, var(--acc) 8%, transparent); }
.ovol-btn.primary:hover { background: color-mix(in srgb, var(--acc) 14%, transparent); }
.ovol-btn.active { color: var(--text); border-color: var(--acc); background: color-mix(in srgb, var(--acc) 12%, transparent); }
.ovol-body { display: grid; grid-template-columns: 220px 1fr; gap: 10px; flex: 1; min-height: 0; }
@media (max-width: 900px) { .ovol-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; } }
.ovol-panel {
  border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface);
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.ovol-panel-hd {
  display: flex; justify-content: space-between; align-items: center; padding: 6px 8px;
  border-bottom: 1px solid var(--hairline); font-size: 9px; letter-spacing: 0.1em; color: var(--text-muted);
}
.ovol-table-wrap { flex: 1; overflow: auto; }
.ovol-table { width: 100%; border-collapse: collapse; font-size: 10px; font-family: var(--font-mono); }
.ovol-table th, .ovol-table td { padding: 5px 6px; text-align: right; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.ovol-table th { position: sticky; top: 0; background: var(--surface-raised); color: var(--text-muted); font-weight: 500; font-size: 9px; letter-spacing: 0.06em; }
.ovol-table th:first-child, .ovol-table td:first-child { text-align: left; }
.ovol-table td { color: var(--text); }
.ovol-table input {
  width: 100%; background: transparent; border: 1px solid transparent; color: var(--text);
  font-family: var(--font-mono); font-size: 10px; padding: 2px 4px; text-align: right;
}
.ovol-table input:focus { background: var(--bg); border-color: var(--acc); outline: none; }
.ovol-table td:first-child input { text-align: left; }
.ovol-table tbody tr:hover td { background: var(--surface-raised); }
.ovol-table tbody tr.selected td { background: color-mix(in srgb, var(--acc) 10%, transparent); }
.ovol-table .ovol-empty td { text-align: center; color: var(--text-muted); padding: 14px 4px; }
.ovol-row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.ovol-icon-btn {
  background: transparent; border: none; color: var(--text-dim); cursor: pointer; font-size: 12px; padding: 0 2px;
}
.ovol-icon-btn:hover { color: var(--down); }
.ovol-viz { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.ovol-viz-hd { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--hairline); }
.ovol-viz-title { font-size: 9px; letter-spacing: 0.1em; color: var(--text-muted); }
.ovol-viz-legend { display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--text-dim); }
.ovol-viz-legend .ovol-bar { flex: 0 0 80px; height: 6px; border-radius: var(--radius-sm);
  background: linear-gradient(to right, var(--down), var(--text-muted), var(--up)); }
.ovol-svg-wrap { flex: 1; min-height: 0; position: relative; }
.ovol-svg { width: 100%; height: 100%; display: block; }
.ovol-axis-label { font-size: 9px; fill: var(--text-dim); font-family: var(--font-mono); }
.ovol-tip {
  position: absolute; pointer-events: none; background: var(--surface-raised); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); padding: 6px 8px; font-size: 10px; font-family: var(--font-mono);
  color: var(--text); box-shadow: 0 4px 14px rgba(0,0,0,0.35); opacity: 0; transition: opacity 0.1s;
  z-index: 10; max-width: 220px; line-height: 1.5;
}
.ovol-greeks { padding: 8px; }
.ovol-greeks-title { font-size: 9px; letter-spacing: 0.1em; color: var(--text-muted); margin-bottom: 6px; }
.ovol-greeks-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.ovol-greek { display: flex; justify-content: space-between; font-size: 10px; font-family: var(--font-mono); }
.ovol-greek-label { color: var(--text-dim); }
.ovol-greek-val { color: var(--text); font-weight: 600; }
.ovol-greek-val.up { color: var(--up); }
.ovol-greek-val.down { color: var(--down); }
.ovol-foot { margin-top: 8px; font-size: 9px; color: var(--text-dim); line-height: 1.5; }
.ovol-foot code { font-family: var(--font-mono); color: var(--text-muted); }
`;
    document.head.appendChild(style);
  }

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

  // ---------- Black-Scholes helpers ----------
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
      price, d1,
      delta: isCall ? Nd1 : Nd1 - 1,
      gamma: pdf / (S * sig * sq),
      theta: (-(S * pdf * sig) / (2 * sq) + (isCall ? -r * K * ert * Nd2 : r * K * ert * Nmd2)) / 365,
      vega: (S * pdf * sq) / 100,
      rho: (isCall ? K * T * ert * Nd2 : -K * T * ert * Nmd2) / 100,
    };
  }

  // ---------- Color scale ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
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
    const t = Math.max(0, Math.min(1, (vol - min) / (max - min)));
    const seg = (stops.length - 1) * t;
    const i = Math.min(stops.length - 2, Math.floor(seg));
    const local = seg - i;
    const a = hexToRgb(stops[i]);
    const b = hexToRgb(stops[i + 1]);
    const rgb = [Math.round(lerp(a[0], b[0], local)), Math.round(lerp(a[1], b[1], local)), Math.round(lerp(a[2], b[2], local))];
    return `rgb(${rgb.join(',')})`;
  }
  function buildStops() {
    return [
      getCssColor('--down'),
      '#8B8B8B',
      getCssColor('--up'),
    ];
  }

  // ---------- Demo data generator ----------
  function generateDemoSurface(spot = 100) {
    const rows = [];
    const expiries = [7, 14, 30, 60, 90, 180];
    const strikes = [0.75, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.25].map((m) => spot * m);
    for (const exp of expiries) {
      const T = exp / 365;
      // term structure: short-dated higher, longer lower
      const base = 0.22 + 0.06 * Math.exp(-T * 2) + 0.02 * Math.sqrt(T);
      for (const K of strikes) {
        const m = K / spot;
        // equity vol skew: puts get richer below spot, calls flatten above
        const skew = m < 1 ? 0.18 * Math.pow(1 - m, 1.3) : 0.04 * Math.pow(m - 1, 0.7);
        const iv = Math.max(0.05, base + skew + (Math.random() - 0.5) * 0.01);
        rows.push({ kind: m < 1 ? 'put' : 'call', strike: +K.toFixed(2), expiryDays: exp, iv: +iv.toFixed(4) });
      }
    }
    return rows;
  }

  // ---------- Persistence ----------
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows: state.rows, spot: state.spot, rate: state.rate, ticker: state.ticker }));
    } catch (e) {}
  }

  // ---------- Fetch ----------
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

  // ---------- Main widget ----------
  function mount(el, setStatus) {
    injectStyle();
    let destroyed = false;
    const root = document.createElement('div');
    root.className = 'ovol-root';
    el.appendChild(root);

    const saved = loadSaved();
    const state = {
      ticker: saved?.ticker || 'SPY',
      spot: saved?.spot != null ? saved.spot : 450,
      rate: 0.045,
      rows: saved?.rows?.length ? saved.rows : generateDemoSurface(450),
      source: saved?.rows?.length ? 'manual' : 'demo',
      view: 'heatmap',
      selected: null,
      lastFetch: null,
    };

    let refreshTimer = null;

    function setStatusInternal(status, cls) {
      if (setStatus && typeof setStatus === 'function') setStatus(status);
      const badge = root.querySelector('.ovol-status');
      if (badge) {
        badge.textContent = status;
        badge.className = `ovol-status ${cls || ''}`;
      }
    }

    function persist() { saveState(state); }

    function render() {
      if (destroyed) return;
      root.innerHTML = `
        <div class="ovol-head">
          <span class="ovol-title">OPTIONS VOLATILITY SURFACE</span>
          <span class="ovol-status ${state.source === 'live' ? 'live' : state.source === 'demo' ? 'demo' : ''}">${state.lastFetch ? 'READY' : 'INITIALIZED'}</span>
        </div>
        <div class="ovol-toolbar">
          <label>TICKER</label>
          <input id="ovol-ticker" value="${esc(state.ticker)}" placeholder="SPY" title="Underlying ticker">
          <label>SPOT</label>
          <input id="ovol-spot" type="number" step="0.01" value="${fmtNum(state.spot, 2)}" title="Underlying spot price">
          <label>RATE</label>
          <input id="ovol-rate" type="number" step="0.001" value="${fmtNum(state.rate, 3)}" title="Risk-free rate">
          <button id="ovol-fetch" class="ovol-btn primary" title="Fetch via /api/proxy from Yahoo Finance">FETCH LIVE</button>
          <button id="ovol-demo" class="ovol-btn" title="Generate realistic demo surface">DEMO</button>
          <button id="ovol-clear" class="ovol-btn" title="Clear manual rows">CLEAR</button>
          <button id="ovol-add" class="ovol-btn" title="Add manual row">+ ROW</button>
          <span style="flex:1"></span>
          <button class="ovol-btn ${state.view === 'heatmap' ? 'active' : ''}" data-view="heatmap">HEATMAP</button>
          <button class="ovol-btn ${state.view === 'surface3d' ? 'active' : ''}" data-view="surface3d">3D SURFACE</button>
        </div>
        <div class="ovol-body">
          <div class="ovol-panel">
            <div class="ovol-panel-hd">
              <span>INPUT TABLE</span>
              <span class="ovol-badge ${state.source}">${state.source.toUpperCase()}</span>
            </div>
            <div class="ovol-table-wrap">
              <table class="ovol-table">
                <thead><tr><th>KIND</th><th>STRIKE</th><th>DAYS</th><th>IV</th><th></th></tr></thead>
                <tbody id="ovol-tbody"></tbody>
              </table>
            </div>
            <div class="ovol-greeks">
              <div class="ovol-greeks-title">GREEKS ESTIMATE · ${state.selected ? `K=${fmtNum(state.selected.strike)} T=${state.selected.expiryDays}d` : 'HOVER/SELECT ROW'}</div>
              <div class="ovol-greeks-grid" id="ovol-greeks"></div>
            </div>
          </div>
          <div class="ovol-panel ovol-viz">
            <div class="ovol-viz-hd">
              <span class="ovol-viz-title">${state.view === 'heatmap' ? 'IMPLIED VOL HEATMAP' : 'IMPLIED VOL 3D SURFACE'}</span>
              <div class="ovol-viz-legend">
                <span>LOW IV</span><i class="ovol-bar"></i><span>HIGH IV</span>
              </div>
            </div>
            <div class="ovol-svg-wrap" id="ovol-viz-wrap"><svg class="ovol-svg" id="ovol-svg"></svg><div class="ovol-tip" id="ovol-tip"></div></div>
          </div>
        </div>
        <div class="ovol-foot">
          Source: <code>${state.source.toUpperCase()}</code>${state.source === 'live' ? ` · ${state.rows.length} contracts · ${state.lastFetch || ''}` : ''}.
          Manual rows auto-persist. Live data uses Yahoo Finance options via <code>/api/proxy</code>; if blocked, use DEMO or manual input.
        </div>
      `;

      bindControls();
      renderTable();
      renderGreeks();
      // schedule draw after DOM reflow
      requestAnimationFrame(drawViz);
    }

    function bindControls() {
      const tickerInput = root.querySelector('#ovol-ticker');
      const spotInput = root.querySelector('#ovol-spot');
      const rateInput = root.querySelector('#ovol-rate');
      tickerInput.addEventListener('change', () => { state.ticker = tickerInput.value.trim().toUpperCase(); persist(); });
      spotInput.addEventListener('change', () => { const v = parseFloat(spotInput.value); if (Number.isFinite(v)) { state.spot = v; persist(); drawViz(); } });
      rateInput.addEventListener('change', () => { const v = parseFloat(rateInput.value); if (Number.isFinite(v)) { state.rate = v; persist(); renderGreeks(); } });

      root.querySelector('#ovol-add').addEventListener('click', () => {
        state.rows.push({ kind: 'call', strike: state.spot, expiryDays: 30, iv: 0.25 });
        state.source = 'manual';
        persist(); renderTable(); drawViz();
      });
      root.querySelector('#ovol-demo').addEventListener('click', () => {
        state.rows = generateDemoSurface(state.spot);
        state.source = 'demo';
        state.lastFetch = null;
        persist(); renderTable(); drawViz(); renderGreeks();
      });
      root.querySelector('#ovol-clear').addEventListener('click', () => {
        state.rows = []; state.selected = null; state.source = 'manual'; state.lastFetch = null;
        persist(); renderTable(); drawViz(); renderGreeks();
      });
      root.querySelector('#ovol-fetch').addEventListener('click', fetchLive);

      root.querySelectorAll('[data-view]').forEach((b) => {
        b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
      });
    }

    async function fetchLive() {
      const ticker = state.ticker;
      setStatusInternal('FETCHING…', '');
      try {
        const [spot, opt] = await Promise.all([
          fetchSpot(ticker).catch(() => null),
          fetchYahooOptions(ticker),
        ]);
        state.rows = opt.rows;
        state.spot = Number.isFinite(spot) ? spot : opt.spot;
        state.source = 'live';
        state.lastFetch = new Date().toLocaleTimeString();
        setStatusInternal('LIVE', 'live');
        persist();
        render();
      } catch (err) {
        setStatusInternal(`LIVE FAILED: ${err.message}`, '');
        // eslint-disable-next-line no-console
        console.warn('[optionsvol] fetch failed', err);
      }
    }

    function renderTable() {
      const tbody = root.querySelector('#ovol-tbody');
      if (!tbody) return;
      if (!state.rows.length) {
        tbody.innerHTML = `<tr class="ovol-empty"><td colspan="5">No rows. Add manual data or fetch live/demo.</td></tr>`;
        return;
      }
      tbody.innerHTML = state.rows.map((r, i) => `
        <tr data-idx="${i}" class="${state.selected === r ? 'selected' : ''}">
          <td><input data-field="kind" value="${esc(r.kind)}" autocomplete="off"></td>
          <td><input data-field="strike" type="number" step="0.01" value="${fmtNum(r.strike, 2)}"></td>
          <td><input data-field="expiryDays" type="number" step="1" value="${r.expiryDays}"></td>
          <td><input data-field="iv" type="number" step="0.0001" value="${fmtNum(r.iv * 100, 2)}"></td>
          <td class="ovol-row-actions"><button class="ovol-icon-btn" title="Delete">×</button></td>
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
          renderGreeks();
        });
        tr.querySelector('.ovol-icon-btn').addEventListener('click', () => {
          const i = parseInt(tr.dataset.idx, 10);
          state.rows.splice(i, 1);
          if (state.selected === state.rows[i]) state.selected = null;
          state.source = 'manual';
          persist(); renderTable(); drawViz(); renderGreeks();
        });
      });
    }

    function renderGreeks() {
      const grid = root.querySelector('#ovol-greeks');
      if (!grid) return;
      const r = state.selected || state.rows[state.rows.length - 1];
      if (!r) { grid.innerHTML = '<div class="ovol-greek"><span class="ovol-greek-label">—</span></div>'; return; }
      const g = bsGreeks(state.spot, r.strike, Math.max(1e-6, r.expiryDays / 365), r.iv, state.rate, r.kind);
      if (!g) { grid.innerHTML = '<div class="ovol-greek"><span class="ovol-greek-label">Invalid inputs</span></div>'; return; }
      const items = [
        ['PRICE', fmtNum(g.price, 3), g.price >= 0 ? 'up' : 'down'],
        ['DELTA', fmtNum(g.delta, 4), g.delta >= 0 ? 'up' : 'down'],
        ['GAMMA', fmtNum(g.gamma, 5), ''],
        ['THETA', fmtNum(g.theta, 4), g.theta >= 0 ? 'up' : 'down'],
        ['VEGA', fmtNum(g.vega, 4), ''],
        ['RHO', fmtNum(g.rho, 4), g.rho >= 0 ? 'up' : 'down'],
      ];
      grid.innerHTML = items.map(([label, val, cls]) => `
        <div class="ovol-greek"><span class="ovol-greek-label">${label}</span><span class="ovol-greek-val ${cls}">${val}</span></div>
      `).join('');
    }

    function getGrid() {
      // pivot rows to unique strikes x expiries; average duplicates
      const strikes = [...new Set(state.rows.map((r) => r.strike))].sort((a, b) => a - b);
      const exps = [...new Set(state.rows.map((r) => r.expiryDays))].sort((a, b) => a - b);
      const map = new Map();
      for (const r of state.rows) {
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
      const flat = state.rows.map((r) => r.iv).filter(Number.isFinite);
      return { strikes, exps, matrix, min: Math.min(...flat), max: Math.max(...flat) };
    }

    function drawViz() {
      const svg = root.querySelector('#ovol-svg');
      const wrap = root.querySelector('#ovol-viz-wrap');
      if (!svg || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      const W = Math.max(200, rect.width);
      const H = Math.max(150, rect.height);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = '';
      if (!state.rows.length) return;
      if (state.view === 'heatmap') drawHeatmap(svg, W, H);
      else drawSurface3d(svg, W, H);
    }

    function drawHeatmap(svg, W, H) {
      const { strikes, exps, matrix, min, max } = getGrid();
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
          rect.dataset.strike = strikes[j];
          rect.dataset.exp = exps[i];
          rect.dataset.iv = iv;
          attachHover(rect, `K ${fmtNum(strikes[j])}<br>T ${exps[i]}d (${fmtDate(exps[i])})<br>IV ${fmtPct(iv)}`);
          svg.appendChild(rect);
        }
      }

      // axes
      for (let j = 0; j < strikes.length; j++) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', pad.left + j * cw + cw / 2);
        txt.setAttribute('y', H - pad.bottom + 14);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('class', 'ovol-axis-label');
        txt.textContent = fmtNum(strikes[j], strikes[j] >= 1000 ? 0 : 1);
        svg.appendChild(txt);
      }
      for (let i = 0; i < exps.length; i++) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', pad.left - 8);
        txt.setAttribute('y', pad.top + i * ch + ch / 2 + 3);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('class', 'ovol-axis-label');
        txt.textContent = `${exps[i]}d`;
        svg.appendChild(txt);
      }
      addAxisLabels(svg, W, H, 'STRIKE →', '← EXPIRY');
    }

    function drawSurface3d(svg, W, H) {
      const { strikes, exps, matrix, min, max } = getGrid();
      if (strikes.length < 2 || exps.length < 2) return;
      const stops = buildStops();
      const pad = { top: 24, right: 24, bottom: 44, left: 54 };
      const w = W - pad.left - pad.right;
      const h = H - pad.top - pad.bottom;

      // perspective projection parameters
      const ax = -0.55; // rotation around X (tilt)
      const ay = 0.35; // rotation around Y
      const cx = strikes[(strikes.length - 1) >> 1];
      const cy = exps[(exps.length - 1) >> 1];
      const sx = w / (strikes[strikes.length - 1] - strikes[0] || 1);
      const sy = h / (exps[exps.length - 1] - exps[0] || 1);

      function project(k, d, iv) {
        // z scale: vol height
        const z = ((iv - min) / Math.max(1e-6, max - min)) * Math.min(w, h) * 0.35;
        const x0 = (k - cx) * sx * 0.7;
        const y0 = (d - cy) * sy * 0.7;
        // rotate around Y then X
        const x1 = x0 * Math.cos(ay) + z * Math.sin(ay);
        const z1 = -x0 * Math.sin(ay) + z * Math.cos(ay);
        const y1 = y0 * Math.cos(ax) - z1 * Math.sin(ax);
        return [pad.left + w / 2 + x1, pad.top + h / 2 + y1];
      }

      // build quads back-to-front (painter's algorithm by y then x)
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
          quads.push({ pts, avg, depth, center: [strikes[j] + (strikes[j + 1] - strikes[j]) / 2, exps[i] + (exps[i + 1] - exps[i]) / 2] });
        }
      }
      quads.sort((a, b) => a.depth - b.depth);

      for (const q of quads) {
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', q.pts.map((p) => p.join(',')).join(' '));
        poly.setAttribute('fill', volColor(q.avg, min, max, stops));
        poly.setAttribute('stroke', 'var(--surface-raised)');
        poly.setAttribute('stroke-width', '0.5');
        poly.setAttribute('fill-opacity', '0.85');
        poly.style.cursor = 'pointer';
        attachHover(poly, `K ${fmtNum(q.center[0])}<br>T ${fmtNum(q.center[1], 0)}d<br>AVG IV ${fmtPct(q.avg)}`);
        svg.appendChild(poly);
      }
      addAxisLabels(svg, W, H, 'STRIKE →', 'EXPIRY →');
    }

    function addAxisLabels(svg, W, H, xlabel, ylabel) {
      const xl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xl.setAttribute('x', W / 2); xl.setAttribute('y', H - 6);
      xl.setAttribute('text-anchor', 'middle'); xl.setAttribute('class', 'ovol-axis-label');
      xl.textContent = xlabel; svg.appendChild(xl);
      const yl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      yl.setAttribute('x', 12); yl.setAttribute('y', H / 2);
      yl.setAttribute('text-anchor', 'middle'); yl.setAttribute('transform', `rotate(-90, 12, ${H / 2})`);
      yl.setAttribute('class', 'ovol-axis-label');
      yl.textContent = ylabel; svg.appendChild(yl);
    }

    function attachHover(el, html) {
      const tip = root.querySelector('#ovol-tip');
      if (!tip) return;
      el.addEventListener('mouseenter', (e) => {
        tip.innerHTML = html;
        tip.style.opacity = '1';
        moveTip(e);
      });
      el.addEventListener('mousemove', moveTip);
      el.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
      function moveTip(e) {
        const wrap = root.querySelector('#ovol-viz-wrap');
        const rect = wrap.getBoundingClientRect();
        const x = e.clientX - rect.left + 10;
        const y = e.clientY - rect.top + 10;
        tip.style.left = `${Math.min(x, rect.width - tip.offsetWidth - 6)}px`;
        tip.style.top = `${Math.min(y, rect.height - tip.offsetHeight - 6)}px`;
      }
    }

    // ---------- Resize handling ----------
    let ro;
    try {
      ro = new ResizeObserver(() => { if (!destroyed) drawViz(); });
      ro.observe(el);
    } catch (e) {}

    // ---------- Lifecycle ----------
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
