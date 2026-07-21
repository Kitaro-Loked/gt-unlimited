/* Cross-asset correlation matrix — 跨金融产品 30 日收益率 PEARSON 相关
 * 资产池：加密货币(BTC/ETH)、股指(SPX/NDX)、美元(DXY)、外汇(EURUSD)、
 *        黄金(GC=F)、原油(CL=F)、美债10Y(^TNX)、波动率(VIX)。
 * 数据源：Binance spot klines（1d）+ Yahoo Finance chart API（经 GT proxy）。
 * Registers as custom tool id 'correlation' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const ASSETS = [
    { id: 'BTC', name: 'Bitcoin', type: 'Crypto', src: 'binance', symbol: 'BTCUSDT' },
    { id: 'ETH', name: 'Ethereum', type: 'Crypto', src: 'binance', symbol: 'ETHUSDT' },
    { id: 'SPX', name: 'S&P 500', type: 'Index', src: 'yahoo', symbol: '^GSPC' },
    { id: 'NDX', name: 'Nasdaq 100', type: 'Index', src: 'yahoo', symbol: '^NDX' },
    { id: 'DXY', name: 'US Dollar Index', type: 'FX', src: 'yahoo', symbol: 'DX-Y.NYB' },
    { id: 'EURUSD', name: 'EUR/USD', type: 'FX', src: 'yahoo', symbol: 'EURUSD=X' },
    { id: 'GOLD', name: 'Gold', type: 'Commodity', src: 'yahoo', symbol: 'GC=F' },
    { id: 'WTI', name: 'WTI Crude', type: 'Commodity', src: 'yahoo', symbol: 'CL=F' },
    { id: 'TNX', name: 'US 10Y Yield', type: 'Bond', src: 'yahoo', symbol: '^TNX' },
    { id: 'VIX', name: 'VIX', type: 'Volatility', src: 'yahoo', symbol: '^VIX' },
  ];

  const BINANCE_KLINE = (sym) => `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=45`;
  const YAHOO_CHART = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=45d`;
  const PROXY = (url) => `/api/proxy?url=${encodeURIComponent(url)}`;
  const REFRESH_MS = 10 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 15000;

  function injectStyle() {
    if (document.getElementById('corr-style')) return;
    const style = document.createElement('style');
    style.id = 'corr-style';
    style.textContent = `
.corr-root { display:flex; flex-direction:column; height:100%; }
.corr-head { display:flex; justify-content:space-between; align-items:center; font-size:9px; letter-spacing:0.12em; color:var(--text-muted); margin-bottom:8px; }
.corr-status { color:var(--warning); }
.corr-status.live { color:var(--acc); }
.corr-wrap { flex:1; overflow:auto; }
.corr-table { width:100%; border-collapse:collapse; table-layout:fixed; font-variant-numeric:tabular-nums; }
.corr-table th, .corr-table td { text-align:center; padding:5px 2px; font-size:10px; font-family:var(--font-mono); border:1px solid var(--hairline); white-space:nowrap; }
.corr-table th { font-weight:600; color:var(--text-muted); background:var(--surface-raised); font-size:9px; }
.corr-table td { color:var(--text); cursor:pointer; }
.corr-table td.corr-diag { color:var(--text-dim); background:var(--surface-raised); }
.corr-type { display:block; font-size:8px; color:var(--text-dim); font-weight:400; }
.corr-foot { margin-top:8px; font-size:9px; line-height:1.5; color:var(--text-dim); }
.corr-legend { display:flex; align-items:center; gap:6px; font-size:9px; color:var(--text-muted); }
.corr-legend .corr-bar { flex:0 0 72px; height:6px; border-radius:var(--radius-sm); background:linear-gradient(to right, var(--down), transparent, var(--up)); }
.corr-detail { margin-top:6px; padding:6px 8px; border-radius:8px; border:1px solid var(--hairline); background:var(--surface-raised); font-size:10px; color:var(--text-muted); min-height:24px; }
@media (max-width:640px){ .corr-table th, .corr-table td { padding:3px 1px; font-size:9px; } }
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function dateKey(tsSec) {
    const d = new Date(tsSec * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }

  function logReturnsByDate(closeMap) {
    const dates = Object.keys(closeMap).sort();
    const rets = {};
    for (let i = 1; i < dates.length; i++) {
      const prev = closeMap[dates[i-1]], cur = closeMap[dates[i]];
      if (prev > 0 && cur > 0) rets[dates[i]] = Math.log(cur / prev);
    }
    return rets;
  }

  function pearson(pairs) {
    const n = pairs.length;
    if (n < 5) return NaN;
    let sx = 0, sy = 0;
    for (const [x, y] of pairs) { sx += x; sy += y; }
    const mx = sx / n, my = sy / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of pairs) { const dx = x - mx, dy = y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const den = Math.sqrt(sxx * syy);
    return den > 0 ? sxy / den : NaN;
  }

  function cellColor(r) {
    if (!Number.isFinite(r)) return 'transparent';
    const alpha = Math.min(Math.abs(r), 1) * 0.55 + (Math.abs(r) > 0.02 ? 0.05 : 0);
    if (r >= 0) return `color-mix(in srgb, var(--up) ${Math.round(alpha * 100)}%, transparent)`;
    return `color-mix(in srgb, var(--down) ${Math.round(alpha * 100)}%, transparent)`;
  }

  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function loadBinance(symbol) {
    const data = await fetchWithTimeout(BINANCE_KLINE(symbol));
    if (!Array.isArray(data)) throw new Error('bad binance');
    const map = {};
    data.forEach((k) => {
      // kline: [openTime, open, high, low, close, volume, closeTime, ...]
      map[dateKey(Math.floor(k[0] / 1000))] = parseFloat(k[4]);
    });
    return map;
  }

  async function loadYahoo(symbol) {
    const data = await fetchWithTimeout(PROXY(YAHOO_CHART(symbol)));
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result || !Array.isArray(result.timestamp)) throw new Error('bad yahoo');
    const closes = result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close || [];
    const map = {};
    result.timestamp.forEach((ts, i) => {
      const c = closes[i];
      if (Number.isFinite(c)) map[dateKey(ts)] = c;
    });
    return map;
  }

  async function loadAsset(asset) {
    if (asset.src === 'binance') return loadBinance(asset.symbol);
    return loadYahoo(asset.symbol);
  }

  window.GT_EXTRA_TOOLS['correlation'] = {
    mount(el, setStatus) {
      injectStyle();
      const labels = ASSETS.map((a) => a.id);
      el.innerHTML = `
        <div class="tool corr-root">
          <div class="corr-head">
            <span>跨金融产品 · 30日收益率相关</span>
            <span class="corr-status" data-conn>连接中…</span>
          </div>
          <div class="corr-wrap">
            <table class="corr-table">
              <thead><tr><th></th>${labels.map((s) => `<th>${esc(s)}<span class="corr-type">${esc(ASSETS.find((a)=>a.id===s).type)}</span></th>`).join('')}</tr></thead>
              <tbody>${labels.map((s) => `<tr><th>${esc(s)}<span class="corr-type">${esc(ASSETS.find((a)=>a.id===s).type)}</span></th>${labels.map(() => '<td>—</td>').join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="corr-foot">
            <div class="corr-legend"><span>-1 反向</span><span class="corr-bar"></span><span>+1 同向</span></div>
            <div>解读：&gt;0.8 高度同向，&lt;-0.3 反向 · 数据源 Binance / Yahoo Finance（经 GT proxy）</div>
          </div>
          <div class="corr-detail" data-detail>点击矩阵单元格查看品种对说明</div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const detailEl = el.querySelector('[data-detail]');
      const tbody = el.querySelector('tbody');
      let alive = true;
      let refreshTimer = null;

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'corr-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'corr-status live';
        setStatus('online');
      };

      const render = (matrix) => {
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row, i) => {
          const cells = row.querySelectorAll('td');
          cells.forEach((td, j) => {
            const r = matrix[i][j];
            if (i === j) { td.textContent = '1.00'; td.className = 'corr-diag'; td.style.background = ''; td.title = `${labels[i]} / ${labels[j]}`; return; }
            if (!Number.isFinite(r)) { td.textContent = '—'; td.style.background = ''; td.title = `${labels[i]} / ${labels[j]}：数据不足`; return; }
            td.textContent = r.toFixed(2);
            td.style.background = cellColor(r);
            td.title = `${labels[i]} / ${labels[j]}：${r.toFixed(4)}`;
          });
        });
      };

      const computeMatrix = (seriesList) => {
        const n = ASSETS.length;
        const retsList = seriesList.map((map) => logReturnsByDate(map));
        const matrix = [];
        for (let i = 0; i < n; i++) {
          matrix[i] = [];
          for (let j = 0; j < n; j++) {
            if (i === j) { matrix[i][j] = 1; continue; }
            const pairs = [];
            const ri = retsList[i], rj = retsList[j];
            for (const d of Object.keys(ri)) {
              if (rj[d] !== undefined) pairs.push([ri[d], rj[d]]);
            }
            matrix[i][j] = pearson(pairs);
          }
        }
        return matrix;
      };

      const load = async () => {
        try {
          const results = await Promise.allSettled(ASSETS.map((a) => loadAsset(a)));
          if (!alive) return;
          const seriesList = results.map((r) => (r.status === 'fulfilled' ? r.value : {}));
          const allEmpty = seriesList.every((m) => !Object.keys(m).length);
          if (allEmpty) throw new Error('all empty');
          const matrix = computeMatrix(seriesList);
          render(matrix);
          clearError();
        } catch (e) {
          if (!alive) return;
          showError('相关性数据加载失败，10 分钟后自动重试');
        }
      };

      tbody.addEventListener('click', (e) => {
        const td = e.target.closest('td');
        if (!td) return;
        const row = td.parentElement;
        const i = Array.from(row.parentElement.children).indexOf(row);
        const j = Array.from(row.children).indexOf(td) - 1;
        if (i < 0 || j < 0 || i >= ASSETS.length || j >= ASSETS.length) return;
        const a = ASSETS[i], b = ASSETS[j];
        detailEl.innerHTML = `<b>${esc(a.id)} · ${esc(a.name)}</b> (${esc(a.type)}) vs <b>${esc(b.id)} · ${esc(b.name)}</b> (${esc(b.type)}) — 点击位置仅作参考，历史相关性不代表未来走势。`;
      });

      load();
      refreshTimer = setInterval(load, REFRESH_MS);

      return () => { alive = false; if (refreshTimer) clearInterval(refreshTimer); };
    },
  };
})();
