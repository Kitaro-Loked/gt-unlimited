/* Portfolio & Risk — 投资组合与风险分析
 * Registers as custom tool id 'portfoliorisk' via window.GT_EXTRA_TOOLS.
 *
 * Features:
 *   - Manual position input (ticker, quantity, cost basis, sector) persisted to localStorage
 *   - Manual bond input (face value, coupon, yield, maturity, frequency) with duration/convexity
 *   - PnL calculation using Yahoo Finance chart API via /api/proxy
 *   - Attribution analysis (Brinson allocation / selection / interaction) via manual benchmark weights
 *   - Beta / Alpha estimation against SPY using historical returns
 *   - Parametric VaR, Historical Simulation VaR and Monte Carlo VaR (95% / 99%, 1-day / 10-day)
 *   - Stress-test scenarios + custom shock input
 *   - CSV / Excel export of positions, bonds and key metrics
 *
 * All external data uses free Yahoo Finance endpoints proxied through GT. When a ticker
 * cannot be fetched the row keeps the manual cost basis and shows "—" for market data.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt-portfoliorisk-v2';
  const LS_KEY_V1 = 'gt-portfoliorisk-v1';
  const PROXY = (url) => `/api/proxy?url=${encodeURIComponent(url)}`;
  const YAHOO_CHART = (sym, range = '6mo', interval = '1d') =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
  const REFRESH_MS = 2 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 15000;
  const MC_SIMULATIONS = 50000;

  const DEFAULT_POSITIONS = [
    { id: 'p1', ticker: 'AAPL', qty: 50, cost: 175, sector: 'Technology' },
    { id: 'p2', ticker: 'MSFT', qty: 25, cost: 330, sector: 'Technology' },
    { id: 'p3', ticker: 'JPM', qty: 60, cost: 140, sector: 'Financials' },
    { id: 'p4', ticker: 'SPY', qty: 40, cost: 420, sector: 'ETF' },
  ];

  const DEFAULT_BONDS = [
    { id: 'b1', name: 'T 10Y Demo', face: 100000, coupon: 4.25, yield: 4.30, years: 10, freq: 2 },
    { id: 'b2', name: 'Corp 5Y Demo', face: 50000, coupon: 5.50, yield: 5.75, years: 5, freq: 2 },
  ];

  const SECTORS = [
    'Technology', 'Healthcare', 'Financials', 'Consumer', 'Energy',
    'Industrials', 'Materials', 'Utilities', 'Communication', 'ETF', 'Other',
  ];

  const STRESS_SCENARIOS = [
    { name: 'COVID Crash (Mar 2020)', shock: -0.34, betaMult: 1.2, rateShockBp: 0 },
    { name: '2022 Bear Market', shock: -0.20, betaMult: 1.1, rateShockBp: 200 },
    { name: 'Rate Shock +200bp', shock: -0.12, betaMult: 1.0, rateShockBp: 200 },
    { name: 'Tech Correction', shock: -0.25, betaMult: 1.3, rateShockBp: 0 },
    { name: 'Black Monday 1987', shock: -0.50, betaMult: 1.4, rateShockBp: 0 },
    { name: 'Flash Crash 2010', shock: -0.10, betaMult: 1.5, rateShockBp: 0 },
  ];

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function fmtNum(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtPct(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${fmtNum(v, digits)}%`;
  }

  function fmtAmt(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e12) return fmtNum(v / 1e12, digits) + 'T';
    if (abs >= 1e9) return fmtNum(v / 1e9, digits) + 'B';
    if (abs >= 1e6) return fmtNum(v / 1e6, digits) + 'M';
    if (abs >= 1e3) return fmtNum(v / 1e3, digits) + 'K';
    return fmtNum(v, digits);
  }

  const dirClass = (v) => (!Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'pos' : 'neg');

  function injectStyle() {
    if (document.getElementById('pr-style')) return;
    const style = document.createElement('style');
    style.id = 'pr-style';
    style.textContent = `
.pr-root { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:var(--font-mono); }
.pr-head { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--hairline); }
.pr-title { font-size:10px; letter-spacing:0.14em; color:var(--text-muted); text-transform:uppercase; }
.pr-actions { display:flex; gap:6px; flex-wrap:wrap; }
.pr-status { font-size:10px; color:var(--warning); }
.pr-status.live { color:var(--acc); }
.pr-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:8px; padding:10px 12px; }
.pr-card {
  background:var(--surface-raised); border:1px solid var(--hairline); border-radius:var(--radius-sm);
  padding:10px; display:flex; flex-direction:column; gap:4px; min-width:0;
}
.pr-card-label { font-size:9px; letter-spacing:0.08em; color:var(--text-muted); }
.pr-card-val { font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pr-card-sub { font-size:9px; color:var(--text-dim); }
.pr-tabs { display:flex; gap:6px; padding:0 12px 8px; border-bottom:1px solid var(--hairline); flex-wrap:wrap; }
.pr-tab {
  background:transparent; border:1px solid var(--hairline); color:var(--text-dim);
  font-family:var(--font-mono); font-size:10px; padding:5px 12px; border-radius:999px; cursor:pointer;
  transition:all .2s var(--ease-fluid);
}
.pr-tab:hover { border-color:var(--acc); color:var(--text); }
.pr-tab.active { border-color:var(--acc); color:var(--acc); background:var(--acc-glow); }
.pr-body { flex:1; overflow:auto; padding:12px; }
.pr-section-title { font-size:10px; letter-spacing:0.1em; color:var(--text-muted); margin:0 0 8px; text-transform:uppercase; }
.pr-table { width:100%; border-collapse:collapse; font-size:10px; }
.pr-table th { position:sticky; top:0; background:var(--surface); text-align:left; padding:6px 8px; color:var(--text-muted); font-weight:500; letter-spacing:0.06em; border-bottom:1px solid var(--hairline-strong); z-index:1; }
.pr-table td { padding:6px 8px; border-top:1px solid var(--hairline); color:var(--text); vertical-align:middle; }
.pr-table tr:hover td { background:rgba(237,230,218,0.03); }
.pr-table .right { text-align:right; }
.pr-table input, .pr-table select {
  background:var(--surface-raised); border:1px solid var(--hairline); color:var(--text);
  font-family:var(--font-mono); font-size:10px; padding:4px 6px; border-radius:var(--radius-sm); width:100%; box-sizing:border-box;
}
.pr-table input:focus, .pr-table select:focus { border-color:var(--acc); outline:none; }
.pr-table .ticker input { text-transform:uppercase; }
.pr-btn {
  background:rgba(237,230,218,0.05); border:1px solid var(--hairline); color:var(--text);
  font-family:var(--font-mono); font-size:10px; padding:5px 12px; border-radius:999px; cursor:pointer;
  transition:all .2s var(--ease-fluid);
}
.pr-btn:hover { border-color:var(--acc); color:var(--acc); background:var(--acc-glow); }
.pr-btn.danger:hover { border-color:var(--danger); color:var(--danger); background:rgba(220,90,90,0.08); }
.pr-del { background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:14px; line-height:1; }
.pr-del:hover { color:var(--danger); }
.pr-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); padding:8px 12px; border-top:1px solid var(--hairline); flex-wrap:wrap; }
.pr-foot a { color:var(--acc); text-decoration:none; }
.pr-foot a:hover { text-decoration:underline; }
.pr-hint { margin-top:8px; }
.pr-grid-2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px; }
.pr-grid-3 { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; }
.pr-panel { background:var(--surface-raised); border:1px solid var(--hairline); border-radius:var(--radius-sm); padding:10px; }
.pr-mini { font-size:9px; color:var(--text-dim); line-height:1.5; }
.pr-bar-bg { background:var(--surface); border-radius:4px; height:8px; overflow:hidden; }
.pr-bar-fill { height:100%; border-radius:4px; }
.pr-bar-fill.up { background:var(--up); }
.pr-bar-fill.down { background:var(--down); }
.pr-scenario-row { display:flex; align-items:center; gap:10px; margin-bottom:6px; font-size:10px; }
.pr-scenario-name { width:160px; flex:none; color:var(--text-muted); }
.pr-scenario-bar { flex:1; }
.pr-scenario-val { width:90px; text-align:right; font-variant-numeric:tabular-nums; }
.pr-svg { width:100%; height:180px; }
.pr-svg text { font-family:var(--font-mono); font-size:9px; fill:var(--text-dim); }
.pr-svg path.curve { fill:none; stroke:var(--acc); stroke-width:2; }
.pr-svg path.area { fill:var(--acc-glow); opacity:.25; stroke:none; }
.pr-svg line.grid { stroke:var(--hairline); stroke-dasharray:2 2; }
.pr-svg rect.bar { fill:var(--acc); }
.pr-svg rect.bar.down { fill:var(--down); }
.pr-svg rect.bar.up { fill:var(--up); }
.pr-input-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
.pr-input-row label { font-size:10px; color:var(--text-muted); white-space:nowrap; }
.pr-input-row input, .pr-input-row select { flex:1; background:var(--surface-raised); border:1px solid var(--hairline); color:var(--text); font-family:var(--font-mono); font-size:10px; padding:4px 6px; border-radius:var(--radius-sm); }
.pr-export-btns { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
.pr-metric-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; }
.pr-metric { background:var(--surface); border:1px solid var(--hairline); border-radius:var(--radius-sm); padding:8px; }
.pr-metric-label { font-size:9px; color:var(--text-muted); letter-spacing:0.06em; }
.pr-metric-val { font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:3px; }
`;
    document.head.appendChild(style);
  }

  /* ── Persistence ── */
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.positions)) {
          s.positions.forEach((p) => { if (!p.id) p.id = uid(); });
          if (!Array.isArray(s.bonds)) s.bonds = DEFAULT_BONDS.map((b) => ({ ...b, id: b.id || uid() }));
          else s.bonds.forEach((b) => { if (!b.id) b.id = uid(); });
          return s;
        }
      }
    } catch (e) { /* ignore */ }
    // Migrate v1 if present
    try {
      const v1 = localStorage.getItem(LS_KEY_V1);
      if (v1) {
        const s = JSON.parse(v1);
        if (s && Array.isArray(s.positions)) {
          s.positions.forEach((p) => { if (!p.id) p.id = uid(); });
          s.bonds = DEFAULT_BONDS.map((b) => ({ ...b, id: b.id || uid() }));
          return s;
        }
      }
    } catch (e) { /* ignore */ }
    return {
      positions: DEFAULT_POSITIONS.map((p) => ({ ...p, id: p.id || uid() })),
      bonds: DEFAULT_BONDS.map((b) => ({ ...b, id: b.id || uid() })),
      benchmark: 'SPY',
      sectorWeights: {},
      sectorReturns: {},
      riskFree: 4.5,
      confidence: 0.95,
      horizon: 1,
      customShock: { shock: -10, label: '自定义冲击' },
    };
  }

  function saveState(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* ── Data fetching ── */
  async function fetchJson(url, signal) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let onAbort;
    if (signal) {
      onAbort = () => ctrl.abort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async function yahooChart(symbol, signal, range = '6mo', interval = '1d') {
    const json = await fetchJson(PROXY(YAHOO_CHART(symbol, range, interval)), signal);
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !Array.isArray(result.timestamp) || !Array.isArray(result.indicators.quote)) throw new Error('bad yahoo');
    const closes = result.indicators.quote[0].close || [];
    const prices = [];
    result.timestamp.forEach((ts, i) => {
      const c = closes[i];
      if (Number.isFinite(c)) prices.push({ date: new Date(ts * 1000), close: c });
    });
    if (!prices.length) throw new Error('no prices');
    return prices;
  }

  /* ── Math helpers ── */
  function logReturns(prices) {
    const out = [];
    for (let i = 1; i < prices.length; i += 1) {
      const prev = prices[i - 1].close, cur = prices[i].close;
      if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
    }
    return out;
  }

  function mean(arr) {
    if (!arr.length) return NaN;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function stdDev(arr) {
    if (arr.length < 2) return NaN;
    const m = mean(arr);
    const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(v);
  }

  function covariance(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return NaN;
    const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
    let s = 0;
    for (let i = 0; i < n; i += 1) s += (x[i] - mx) * (y[i] - my);
    return s / (n - 1);
  }

  function olsBetaAlpha(assetRets, benchRets) {
    const n = Math.min(assetRets.length, benchRets.length);
    if (n < 5) return { beta: NaN, alpha: NaN, r2: NaN };
    const x = benchRets.slice(-n), y = assetRets.slice(-n);
    const cov = covariance(x, y);
    const varX = covariance(x, x);
    if (!Number.isFinite(varX) || varX === 0) return { beta: NaN, alpha: NaN, r2: NaN };
    const beta = cov / varX;
    const alpha = mean(y) - beta * mean(x);
    const ssTot = y.reduce((s, v) => s + (v - mean(y)) ** 2, 0);
    let ssRes = 0;
    for (let i = 0; i < n; i += 1) ssRes += (y[i] - (alpha + beta * x[i])) ** 2;
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
    return { beta, alpha, r2 };
  }

  function zScore(conf) {
    if (conf >= 0.99) return 2.326;
    if (conf >= 0.975) return 1.96;
    if (conf >= 0.95) return 1.645;
    if (conf >= 0.9) return 1.282;
    return 1.645;
  }

  function quantileSorted(sortedAsc, q) {
    if (!sortedAsc.length) return NaN;
    const pos = q * (sortedAsc.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
  }

  /* ── Bond math ── */
  function bondCashFlows(face, couponAnnualPct, ytmAnnualPct, years, freq = 2) {
    const n = Math.max(1, Math.round(years * freq));
    const c = face * (couponAnnualPct / 100) / freq;
    const y = ytmAnnualPct / 100 / freq;
    const flows = [];
    for (let t = 1; t <= n; t += 1) {
      const cf = t === n ? c + face : c;
      const pv = cf / Math.pow(1 + y, t);
      flows.push({ t: t / freq, cf, pv });
    }
    return { flows, y };
  }

  function bondMetrics(face, couponAnnualPct, ytmAnnualPct, years, freq = 2) {
    if (!Number.isFinite(face) || !Number.isFinite(couponAnnualPct) || !Number.isFinite(ytmAnnualPct) || !Number.isFinite(years) || years <= 0) {
      return { price: NaN, macaulay: NaN, modified: NaN, convexity: NaN, ytm: NaN };
    }
    const { flows, y } = bondCashFlows(face, couponAnnualPct, ytmAnnualPct, years, freq);
    const price = flows.reduce((s, f) => s + f.pv, 0);
    if (price <= 0) return { price, macaulay: NaN, modified: NaN, convexity: NaN, ytm: ytmAnnualPct / 100 };
    const macaulay = flows.reduce((s, f) => s + f.t * f.pv, 0) / price;
    const modified = macaulay / (1 + y);
    const convexity = flows.reduce((s, f) => s + f.t * (f.t + 1 / freq) * f.pv, 0) / (price * (1 + y) * (1 + y));
    return { price, macaulay, modified, convexity, ytm: ytmAnnualPct / 100 };
  }

  function bondPriceChange(price, modified, convexity, yieldChangePct) {
    const dy = yieldChangePct / 100;
    return price * (-modified * dy + 0.5 * convexity * dy * dy);
  }

  /* ── Return matrix helpers ── */
  function buildReturnMatrix(positions, pricesByTicker) {
    // Build aligned log-return matrix with rows = dates, cols = positions
    const rets = positions.map((p) => {
      const prices = pricesByTicker[p.ticker] || [];
      return logReturns(prices);
    });
    const minLen = Math.min(...rets.map((r) => r.length).filter((n) => n > 0), Infinity);
    if (!Number.isFinite(minLen) || minLen < 5) return [];
    const matrix = [];
    for (let i = 0; i < minLen; i += 1) {
      matrix.push(rets.map((r) => r[r.length - minLen + i]));
    }
    return matrix;
  }

  function covarianceMatrix(matrix) {
    // matrix rows = observations, cols = variables
    if (!matrix.length) return [];
    const n = matrix.length;
    const k = matrix[0].length;
    const means = [];
    for (let j = 0; j < k; j += 1) means.push(mean(matrix.map((r) => r[j])));
    const cov = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let a = 0; a < k; a += 1) {
        for (let b = 0; b < k; b += 1) {
          cov[a][b] += (matrix[i][a] - means[a]) * (matrix[i][b] - means[b]);
        }
      }
    }
    for (let a = 0; a < k; a += 1) {
      for (let b = 0; b < k; b += 1) cov[a][b] /= (n - 1);
    }
    return cov;
  }

  function cholesky(cov) {
    const n = cov.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let s = cov[i][j];
        for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 0) return null; // not positive-definite
          L[i][j] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    return L;
  }

  /* ── VaR methods ── */
  function historicalVaR(weights, matrix, totalValue, confidence, horizon) {
    if (!matrix.length || !weights.length) return { value: NaN, pct: NaN };
    const portRets = matrix.map((row) => row.reduce((s, r, i) => s + (weights[i] || 0) * r, 0));
    portRets.sort((a, b) => a - b);
    const q = quantileSorted(portRets, 1 - confidence);
    const dailyPct = Number.isFinite(q) ? -q : NaN;
    const scaled = dailyPct * Math.sqrt(horizon);
    return { value: totalValue * scaled, pct: scaled };
  }

  function monteCarloVaR(weights, matrix, totalValue, confidence, horizon) {
    if (!matrix.length || !weights.length) return { value: NaN, pct: NaN };
    const cov = covarianceMatrix(matrix);
    const L = cholesky(cov);
    if (!L) return { value: NaN, pct: NaN };
    const k = weights.length;
    const sims = [];
    for (let s = 0; s < MC_SIMULATIONS; s += 1) {
      const z = Array.from({ length: k }, () => {
        // Box-Muller
        const u1 = Math.random(), u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      });
      const r = Array.from({ length: k }, () => 0);
      for (let i = 0; i < k; i += 1) {
        for (let j = 0; j <= i; j += 1) r[i] += L[i][j] * z[j];
      }
      sims.push(r.reduce((sum, ri, i) => sum + (weights[i] || 0) * ri, 0));
    }
    sims.sort((a, b) => a - b);
    const q = quantileSorted(sims, 1 - confidence);
    const dailyPct = Number.isFinite(q) ? -q : NaN;
    const scaled = dailyPct * Math.sqrt(horizon);
    return { value: totalValue * scaled, pct: scaled };
  }

  /* ── Core portfolio calculations ── */
  function computeMetrics(state, pricesByTicker) {
    const { positions, bonds, benchmark, riskFree } = state;
    const benchPrices = pricesByTicker[benchmark] || [];
    const benchRets = logReturns(benchPrices);
    const benchTotalReturn = benchPrices.length > 1 ? benchPrices[benchPrices.length - 1].close / benchPrices[0].close - 1 : NaN;
    const annualFactor = 252;

    const enriched = positions.map((p) => {
      const prices = pricesByTicker[p.ticker] || [];
      const current = prices.length ? prices[prices.length - 1].close : NaN;
      const rets = logReturns(prices);
      const { beta, alpha, r2 } = olsBetaAlpha(rets, benchRets);
      const vol = stdDev(rets) * Math.sqrt(annualFactor);
      const totalReturn = prices.length > 1 ? prices[prices.length - 1].close / prices[0].close - 1 : NaN;
      const marketValue = Number.isFinite(current) && Number.isFinite(p.qty) ? current * p.qty : NaN;
      const costBasis = Number.isFinite(p.cost) && Number.isFinite(p.qty) ? p.cost * p.qty : NaN;
      const pnl = Number.isFinite(marketValue) && Number.isFinite(costBasis) ? marketValue - costBasis : NaN;
      const pnlPct = Number.isFinite(pnl) && costBasis > 0 ? pnl / costBasis : NaN;
      return { ...p, current, marketValue, costBasis, pnl, pnlPct, beta, alpha, r2, vol, totalReturn, rets };
    });

    const enrichedBonds = (bonds || []).map((b) => {
      const m = bondMetrics(b.face, b.coupon, b.yield, b.years, b.freq || 2);
      return { ...b, ...m };
    });

    const totalEquityValue = enriched.reduce((s, p) => s + (Number.isFinite(p.marketValue) ? p.marketValue : 0), 0);
    const totalBondValue = enrichedBonds.reduce((s, b) => s + (Number.isFinite(b.price) ? b.price : 0), 0);
    const totalValue = totalEquityValue + totalBondValue;
    const totalCost = enriched.reduce((s, p) => s + (Number.isFinite(p.costBasis) ? p.costBasis : 0), 0);
    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? totalPnl / totalCost : NaN;

    enriched.forEach((p) => { p.weight = totalValue > 0 ? (p.marketValue || 0) / totalValue : 0; });
    enrichedBonds.forEach((b) => { b.weight = totalValue > 0 ? (b.price || 0) / totalValue : 0; });

    // Portfolio beta = weighted average of equity betas (using 1 for missing), bonds beta assumed 0
    const portfolioBeta = totalValue > 0
      ? enriched.reduce((s, p) => s + p.weight * (Number.isFinite(p.beta) ? p.beta : 1), 0)
      : NaN;

    // Portfolio variance from covariance matrix (equity only; bonds low-vol treated separately)
    let portfolioVar = NaN;
    if (enriched.length) {
      let s = 0;
      for (let i = 0; i < enriched.length; i += 1) {
        for (let j = 0; j < enriched.length; j += 1) {
          const ri = enriched[i].rets, rj = enriched[j].rets;
          const n = Math.min(ri.length, rj.length);
          if (n >= 2) {
            s += enriched[i].weight * enriched[j].weight * covariance(ri.slice(-n), rj.slice(-n));
          }
        }
      }
      portfolioVar = s;
    }
    const portfolioVolDaily = Number.isFinite(portfolioVar) && portfolioVar >= 0 ? Math.sqrt(portfolioVar) : NaN;
    const portfolioVolAnn = Number.isFinite(portfolioVolDaily) ? portfolioVolDaily * Math.sqrt(annualFactor) : NaN;

    // Parametric VaR
    const z = zScore(state.confidence || 0.95);
    const horizon = Math.max(1, state.horizon || 1);
    const varAbs = Number.isFinite(portfolioVolDaily) ? totalValue * z * portfolioVolDaily * Math.sqrt(horizon) : NaN;
    const varPct = totalValue > 0 && Number.isFinite(varAbs) ? varAbs / totalValue : NaN;

    // Historical & Monte Carlo VaR
    const retMatrix = buildReturnMatrix(enriched, pricesByTicker);
    const histVaR = historicalVaR(enriched.map((p) => p.weight), retMatrix, totalValue, state.confidence || 0.95, horizon);
    const mcVaR = monteCarloVaR(enriched.map((p) => p.weight), retMatrix, totalValue, state.confidence || 0.95, horizon);

    // Alpha vs benchmark (Jensen's alpha)
    const portfolioReturn = totalCost > 0 && totalValue > 0 ? (totalValue / totalCost - 1) : NaN;
    const rfAnnual = (riskFree || 0) / 100;
    const alpha = Number.isFinite(portfolioReturn) && Number.isFinite(benchTotalReturn) && Number.isFinite(portfolioBeta)
      ? portfolioReturn - rfAnnual - portfolioBeta * (benchTotalReturn - rfAnnual)
      : NaN;
    const benchVolAnn = Number.isFinite(benchRets.length) && benchRets.length >= 2
      ? stdDev(benchRets) * Math.sqrt(annualFactor)
      : NaN;

    // Bond portfolio duration (value-weighted among bonds)
    const bondPortfolioDuration = totalBondValue > 0
      ? enrichedBonds.reduce((s, b) => s + (b.price || 0) * (b.modified || 0), 0) / totalBondValue
      : NaN;
    const bondPortfolioConvexity = totalBondValue > 0
      ? enrichedBonds.reduce((s, b) => s + (b.price || 0) * (b.convexity || 0), 0) / totalBondValue
      : NaN;

    return {
      positions: enriched,
      bonds: enrichedBonds,
      totalValue,
      totalEquityValue,
      totalBondValue,
      totalCost,
      totalPnl,
      totalPnlPct,
      portfolioBeta,
      portfolioVolDaily,
      portfolioVolAnn,
      varAbs,
      varPct,
      histVaR,
      mcVaR,
      portfolioReturn,
      benchTotalReturn,
      alpha,
      benchVolAnn,
      benchRets,
      bondPortfolioDuration,
      bondPortfolioConvexity,
    };
  }

  /* ── Brinson attribution ── */
  function computeAttribution(metrics, state) {
    const { positions } = metrics;
    const { sectorWeights, sectorReturns } = state;
    const sectors = new Set(positions.map((p) => p.sector || 'Other'));

    const rows = [];
    let totalWb = 0;
    sectors.forEach((sector) => {
      const posInSector = positions.filter((p) => (p.sector || 'Other') === sector);
      const wp = posInSector.reduce((s, p) => s + p.weight, 0);
      const rp = wp > 0 ? posInSector.reduce((s, p) => s + p.weight * (p.totalReturn || 0), 0) / wp : 0;
      const wb = Number(sectorWeights[sector]) || 0;
      const rb = Number(sectorReturns[sector]);
      const rbUse = Number.isFinite(rb) ? rb : (metrics.benchTotalReturn || 0);
      rows.push({ sector, wp, wb, rp, rb: rbUse });
      totalWb += wb;
    });
    const norm = totalWb > 0 ? 1 / totalWb : 0;
    rows.forEach((r) => { r.wbNorm = r.wb * norm; });

    let allocation = 0, selection = 0, interaction = 0;
    rows.forEach((r) => {
      allocation += (r.wp - r.wbNorm) * r.rb;
      selection += r.wbNorm * (r.rp - r.rb);
      interaction += (r.wp - r.wbNorm) * (r.rp - r.rb);
    });

    return { rows, allocation, selection, interaction };
  }

  /* ── Rendering ── */
  function renderCards(el, metrics) {
    const cards = el.querySelector('[data-cards]');
    if (!cards) return;
    cards.innerHTML = `
      <div class="pr-card"><span class="pr-card-label">总市值</span><span class="pr-card-val">$${fmtAmt(metrics.totalValue)}</span><span class="pr-card-sub">股票 $${fmtAmt(metrics.totalEquityValue)} · 债券 $${fmtAmt(metrics.totalBondValue)}</span></div>
      <div class="pr-card"><span class="pr-card-label">总盈亏</span><span class="pr-card-val ${dirClass(metrics.totalPnl)}">${metrics.totalPnl >= 0 ? '+' : ''}$${fmtAmt(metrics.totalPnl)}</span><span class="pr-card-sub ${dirClass(metrics.totalPnlPct)}">${fmtPct(metrics.totalPnlPct)}</span></div>
      <div class="pr-card"><span class="pr-card-label">组合 Beta</span><span class="pr-card-val">${fmtNum(metrics.portfolioBeta, 2)}</span><span class="pr-card-sub">vs ${esc(metrics.benchmark || 'SPY')}</span></div>
      <div class="pr-card"><span class="pr-card-label">年化波动</span><span class="pr-card-val">${fmtPct(metrics.portfolioVolAnn)}</span><span class="pr-card-sub">日波动 ${fmtPct(metrics.portfolioVolDaily)}</span></div>
      <div class="pr-card"><span class="pr-card-label">VaR (${((metrics.confidence || 0.95) * 100).toFixed(0)}%, ${metrics.horizon || 1}d)</span><span class="pr-card-val neg">-$${fmtAmt(metrics.varAbs)}</span><span class="pr-card-sub neg">${fmtPct(metrics.varPct)}</span></div>
      <div class="pr-card"><span class="pr-card-label">债券久期</span><span class="pr-card-val">${fmtNum(metrics.bondPortfolioDuration, 2)}</span><span class="pr-card-sub">凸性 ${fmtNum(metrics.bondPortfolioConvexity, 2)}</span></div>
    `;
  }

  function renderPositionsTab(body, state, metrics, onChange) {
    const rows = metrics.positions.map((p) => `
      <tr data-id="${esc(p.id)}">
        <td class="ticker"><input value="${esc(p.ticker)}" data-field="ticker" placeholder="AAPL"></td>
        <td><input type="number" value="${Number.isFinite(p.qty) ? p.qty : ''}" data-field="qty" placeholder="0" step="any"></td>
        <td><input type="number" value="${Number.isFinite(p.cost) ? p.cost : ''}" data-field="cost" placeholder="0" step="any"></td>
        <td>
          <select data-field="sector">
            ${SECTORS.map((s) => `<option value="${esc(s)}" ${p.sector === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </td>
        <td class="right">${Number.isFinite(p.current) ? fmtNum(p.current) : '—'}</td>
        <td class="right">${Number.isFinite(p.marketValue) ? '$' + fmtAmt(p.marketValue) : '—'}</td>
        <td class="right ${dirClass(p.pnl)}">${Number.isFinite(p.pnl) ? (p.pnl >= 0 ? '+' : '') + '$' + fmtAmt(p.pnl) : '—'}</td>
        <td class="right ${dirClass(p.pnlPct)}">${fmtPct(p.pnlPct)}</td>
        <td class="right">${Number.isFinite(p.beta) ? fmtNum(p.beta, 2) : '—'}</td>
        <td class="right">${Number.isFinite(p.vol) ? fmtPct(p.vol) : '—'}</td>
        <td><button class="pr-del" data-del title="删除">×</button></td>
      </tr>
    `).join('');

    body.innerHTML = `
      <div class="pr-export-btns">
        <button class="pr-btn" data-add type="button">+ 添加持仓</button>
        <button class="pr-btn danger" data-clear type="button">清空</button>
        <button class="pr-btn" data-export-csv type="button">导出 CSV</button>
        <button class="pr-btn" data-export-excel type="button">导出 Excel</button>
        <button class="pr-btn" data-import type="button">导入 CSV</button>
      </div>
      <table class="pr-table">
        <thead>
          <tr>
            <th>代码</th><th>数量</th><th>成本价</th><th>行业</th><th class="right">现价</th>
            <th class="right">市值</th><th class="right">盈亏</th><th class="right">盈亏%</th>
            <th class="right">Beta</th><th class="right">年化波动</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="11" class="pr-mini" style="text-align:center;padding:16px;">暂无持仓，点击“添加持仓”</td></tr>'}</tbody>
      </table>
      <input type="file" data-file style="display:none" accept=".csv,text/csv">
    `;

    body.querySelector('[data-add]').addEventListener('click', () => {
      state.positions.push({ id: uid(), ticker: '', qty: 0, cost: 0, sector: 'Other' });
      saveState(state);
      onChange();
    });
    body.querySelector('[data-clear]').addEventListener('click', () => {
      if (!state.positions.length) return;
      if (confirm('确定清空所有持仓？')) {
        state.positions = [];
        saveState(state);
        onChange();
      }
    });
    body.querySelector('[data-export-csv]').addEventListener('click', () => exportCsv(state, metrics));
    body.querySelector('[data-export-excel]').addEventListener('click', () => exportExcel(state, metrics));
    body.querySelector('[data-import]').addEventListener('click', () => body.querySelector('[data-file]').click());
    const fileInput = body.querySelector('[data-file]');
    fileInput.addEventListener('change', (e) => {
      importCsv(e.target.files[0], state, () => { onChange(); fileInput.value = ''; });
    });

    body.querySelectorAll('tbody tr').forEach((row) => {
      const id = row.getAttribute('data-id');
      if (!id) return;
      const del = row.querySelector('[data-del]');
      if (del) del.addEventListener('click', () => {
        state.positions = state.positions.filter((p) => p.id !== id);
        saveState(state);
        onChange();
      });
      row.querySelectorAll('input, select').forEach((inp) => {
        inp.addEventListener('change', () => updatePositionFromRow(row, state));
        inp.addEventListener('blur', () => { saveState(state); onChange(); });
      });
    });
  }

  function updatePositionFromRow(row, state) {
    const id = row.getAttribute('data-id');
    const p = state.positions.find((x) => x.id === id);
    if (!p) return;
    row.querySelectorAll('input, select').forEach((inp) => {
      const f = inp.getAttribute('data-field');
      if (f === 'ticker' || f === 'sector') p[f] = inp.value;
      else p[f] = parseFloat(inp.value) || 0;
    });
  }

  function updateBondFromRow(row, state) {
    const id = row.getAttribute('data-id');
    const b = state.bonds.find((x) => x.id === id);
    if (!b) return;
    row.querySelectorAll('input, select').forEach((inp) => {
      const f = inp.getAttribute('data-field');
      if (f === 'name') b[f] = inp.value;
      else b[f] = parseFloat(inp.value) || 0;
    });
  }

  function renderBondsTab(body, state, metrics, onChange) {
    const rows = metrics.bonds.map((b) => `
      <tr data-id="${esc(b.id)}">
        <td><input value="${esc(b.name)}" data-field="name" placeholder="债券名称"></td>
        <td><input type="number" value="${Number.isFinite(b.face) ? b.face : ''}" data-field="face" placeholder="100000" step="any"></td>
        <td><input type="number" value="${Number.isFinite(b.coupon) ? b.coupon : ''}" data-field="coupon" placeholder="%" step="0.01"></td>
        <td><input type="number" value="${Number.isFinite(b.yield) ? b.yield : ''}" data-field="yield" placeholder="%" step="0.01"></td>
        <td><input type="number" value="${Number.isFinite(b.years) ? b.years : ''}" data-field="years" placeholder="年" step="0.5"></td>
        <td>
          <select data-field="freq">
            ${[1, 2, 4, 12].map((f) => `<option value="${f}" ${(b.freq || 2) === f ? 'selected' : ''}>${f === 1 ? '年' : f === 2 ? '半年' : f === 4 ? '季' : '月'}</option>`).join('')}
          </select>
        </td>
        <td class="right">${Number.isFinite(b.price) ? '$' + fmtAmt(b.price) : '—'}</td>
        <td class="right">${Number.isFinite(b.modified) ? fmtNum(b.modified, 2) : '—'}</td>
        <td class="right">${Number.isFinite(b.convexity) ? fmtNum(b.convexity, 2) : '—'}</td>
        <td><button class="pr-del" data-del title="删除">×</button></td>
      </tr>
    `).join('');

    body.innerHTML = `
      <div class="pr-export-btns">
        <button class="pr-btn" data-add type="button">+ 添加债券</button>
        <button class="pr-btn danger" data-clear type="button">清空</button>
      </div>
      <table class="pr-table">
        <thead>
          <tr>
            <th>名称</th><th class="right">面值</th><th class="right">票息%</th><th class="right">到期收益率%</th>
            <th class="right">剩余期限(年)</th><th>付息频率</th><th class="right">价格</th>
            <th class="right">修正久期</th><th class="right">凸性</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="10" class="pr-mini" style="text-align:center;padding:16px;">暂无债券，点击“添加债券”</td></tr>'}</tbody>
      </table>
      <div class="pr-grid-2" style="margin-top:12px;">
        <div class="pr-panel">
          <div class="pr-section-title">组合债券指标</div>
          <div class="pr-mini">债券总市值: <strong>$${fmtAmt(metrics.totalBondValue)}</strong></div>
          <div class="pr-mini">组合修正久期: <strong>${fmtNum(metrics.bondPortfolioDuration, 2)}</strong></div>
          <div class="pr-mini">组合凸性: <strong>${fmtNum(metrics.bondPortfolioConvexity, 2)}</strong></div>
          <div class="pr-mini" style="margin-top:6px;color:var(--text-dim);">
            利率每上升 100bp，债券组合价值约下跌 ${fmtPct((metrics.bondPortfolioDuration || 0) - 0.5 * (metrics.bondPortfolioConvexity || 0) * 0.01)}。
          </div>
        </div>
        <div class="pr-panel">
          <div class="pr-section-title">价格-收益率敏感度</div>
          <div id="pr-bond-chart"></div>
        </div>
      </div>
    `;

    body.querySelector('[data-add]').addEventListener('click', () => {
      state.bonds.push({ id: uid(), name: '', face: 100000, coupon: 4, yield: 4, years: 5, freq: 2 });
      saveState(state);
      onChange();
    });
    body.querySelector('[data-clear]').addEventListener('click', () => {
      if (!state.bonds.length) return;
      if (confirm('确定清空所有债券？')) {
        state.bonds = [];
        saveState(state);
        onChange();
      }
    });

    body.querySelectorAll('tbody tr').forEach((row) => {
      const id = row.getAttribute('data-id');
      if (!id) return;
      const del = row.querySelector('[data-del]');
      if (del) del.addEventListener('click', () => {
        state.bonds = state.bonds.filter((b) => b.id !== id);
        saveState(state);
        onChange();
      });
      row.querySelectorAll('input, select').forEach((inp) => {
        inp.addEventListener('change', () => updateBondFromRow(row, state));
        inp.addEventListener('blur', () => { saveState(state); onChange(); });
      });
    });

    drawBondPriceYieldChart(body.querySelector('#pr-bond-chart'), metrics.bonds);
  }

  function drawBondPriceYieldChart(container, bonds) {
    if (!container) return;
    if (!bonds.length) { container.innerHTML = '<div class="pr-mini">添加债券后显示价格-收益率曲线</div>'; return; }
    // Aggregate a representative bond: value-weighted coupon/yield/duration
    const total = bonds.reduce((s, b) => s + (Number.isFinite(b.price) ? b.price : 0), 0);
    if (total <= 0) { container.innerHTML = '<div class="pr-mini">无有效债券价格</div>'; return; }
    const avgCoupon = bonds.reduce((s, b) => s + (b.price || 0) * (b.coupon || 0), 0) / total;
    const avgYtm = bonds.reduce((s, b) => s + (b.price || 0) * (b.yield || 0), 0) / total;
    const avgYears = bonds.reduce((s, b) => s + (b.price || 0) * (b.years || 0), 0) / total;
    const avgFreq = 2;

    const W = 500, H = 180, pad = { t: 12, r: 16, b: 32, l: 44 };
    const yMin = Math.max(0, avgYtm - 2);
    const yMax = avgYtm + 2;
    const points = [];
    for (let y = yMin; y <= yMax; y += 0.1) {
      const m = bondMetrics(100, avgCoupon, y, avgYears, avgFreq);
      if (Number.isFinite(m.price)) points.push({ y, p: m.price });
    }
    if (!points.length) { container.innerHTML = '<div class="pr-mini">无法绘制</div>'; return; }
    const minP = Math.min(...points.map((p) => p.p));
    const maxP = Math.max(...points.map((p) => p.p));
    const xFor = (y) => pad.l + ((y - yMin) / (yMax - yMin)) * (W - pad.l - pad.r);
    const yFor = (p) => H - pad.b - ((p - minP) / (maxP - minP || 1)) * (H - pad.t - pad.b);
    let d = '';
    points.forEach((pt, i) => { d += `${i === 0 ? 'M' : 'L'} ${xFor(pt.y)} ${yFor(pt.p)}`; });

    container.innerHTML = `
      <svg class="pr-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line class="grid" x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}"/>
        <line class="grid" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}"/>
        <path class="curve" d="${d}"/>
        <text x="${pad.l - 6}" y="${pad.t + 4}" text-anchor="end">${fmtNum(maxP, 1)}</text>
        <text x="${pad.l - 6}" y="${H - pad.b}" text-anchor="end">${fmtNum(minP, 1)}</text>
        <text x="${pad.l}" y="${H - 8}" text-anchor="start">${fmtNum(yMin, 1)}%</text>
        <text x="${W - pad.r}" y="${H - 8}" text-anchor="end">${fmtNum(yMax, 1)}%</text>
        <text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)">YTM %</text>
      </svg>
      <div class="pr-mini" style="margin-top:4px;">合成债券（票息 ${fmtNum(avgCoupon, 2)}%，期限 ${fmtNum(avgYears, 1)} 年）的价格-收益率曲线</div>
    `;
  }

  function exportCsv(state, metrics) {
    const lines = [];
    lines.push('type,ticker_or_name,qty_or_face,cost_or_coupon,sector_or_yield,years,freq,current_or_price,beta_or_duration,pnl_or_convexity');
    state.positions.forEach((p) => {
      const em = metrics.positions.find((x) => x.id === p.id) || {};
      lines.push(`stock,${p.ticker},${p.qty},${p.cost},${p.sector || 'Other'},,,${em.current || ''},${em.beta || ''},${em.pnl || ''}`);
    });
    state.bonds.forEach((b) => {
      const bm = metrics.bonds.find((x) => x.id === b.id) || {};
      lines.push(`bond,${b.name},${b.face},${b.coupon},,${b.years},${b.freq || 2},${bm.price || ''},${bm.modified || ''},${bm.convexity || ''}`);
    });
    lines.push('');
    lines.push('metric,value');
    lines.push(`total_value,${metrics.totalValue}`);
    lines.push(`equity_value,${metrics.totalEquityValue}`);
    lines.push(`bond_value,${metrics.totalBondValue}`);
    lines.push(`total_pnl,${metrics.totalPnl}`);
    lines.push(`portfolio_beta,${metrics.portfolioBeta}`);
    lines.push(`portfolio_vol_ann,${metrics.portfolioVolAnn}`);
    lines.push(`parametric_var,${metrics.varAbs}`);
    lines.push(`historical_var,${metrics.histVaR.value}`);
    lines.push(`monte_carlo_var,${metrics.mcVaR.value}`);
    lines.push(`bond_duration,${metrics.bondPortfolioDuration}`);
    lines.push(`bond_convexity,${metrics.bondPortfolioConvexity}`);
    lines.push(`benchmark,${state.benchmark || 'SPY'}`);
    lines.push(`confidence,${state.confidence || 0.95}`);
    lines.push(`horizon_days,${state.horizon || 1}`);

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gt-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportExcel(state, metrics) {
    // Excel can open an HTML table saved as .xls; supports Chinese and multiple sheets via multiple tables.
    const html = [];
    html.push('<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">');
    html.push('<head><meta charset="utf-8"><style>td,th{font-family:monospace;font-size:10px;border:1px solid #999;padding:4px;}th{background:#eee;}</style></head><body>');
    html.push('<table>');
    html.push('<tr><th>类型</th><th>代码/名称</th><th>数量/面值</th><th>成本/票息%</th><th>行业/到期收益率%</th><th>剩余期限(年)</th><th>付息频率</th><th>现价/价格</th><th>Beta/修正久期</th><th>盈亏/凸性</th></tr>');
    state.positions.forEach((p) => {
      const em = metrics.positions.find((x) => x.id === p.id) || {};
      html.push(`<tr><td>股票</td><td>${esc(p.ticker)}</td><td>${p.qty}</td><td>${p.cost}</td><td>${esc(p.sector || 'Other')}</td><td></td><td></td><td>${fmtNum(em.current)}</td><td>${fmtNum(em.beta, 2)}</td><td>${fmtNum(em.pnl)}</td></tr>`);
    });
    state.bonds.forEach((b) => {
      const bm = metrics.bonds.find((x) => x.id === b.id) || {};
      html.push(`<tr><td>债券</td><td>${esc(b.name)}</td><td>${b.face}</td><td>${b.coupon}</td><td>${b.yield}</td><td>${b.years}</td><td>${b.freq || 2}</td><td>${fmtNum(bm.price)}</td><td>${fmtNum(bm.modified, 2)}</td><td>${fmtNum(bm.convexity, 2)}</td></tr>`);
    });
    html.push('</table>');
    html.push('<br><table>');
    html.push('<tr><th>指标</th><th>数值</th></tr>');
    html.push(`<tr><td>总市值</td><td>${fmtNum(metrics.totalValue)}</td></tr>`);
    html.push(`<tr><td>股票市值</td><td>${fmtNum(metrics.totalEquityValue)}</td></tr>`);
    html.push(`<tr><td>债券市值</td><td>${fmtNum(metrics.totalBondValue)}</td></tr>`);
    html.push(`<tr><td>总盈亏</td><td>${fmtNum(metrics.totalPnl)}</td></tr>`);
    html.push(`<tr><td>组合 Beta</td><td>${fmtNum(metrics.portfolioBeta, 2)}</td></tr>`);
    html.push(`<tr><td>年化波动率</td><td>${fmtPct(metrics.portfolioVolAnn)}</td></tr>`);
    html.push(`<tr><td>参数法 VaR</td><td>${fmtNum(metrics.varAbs)}</td></tr>`);
    html.push(`<tr><td>历史模拟 VaR</td><td>${fmtNum(metrics.histVaR.value)}</td></tr>`);
    html.push(`<tr><td>蒙特卡洛 VaR</td><td>${fmtNum(metrics.mcVaR.value)}</td></tr>`);
    html.push(`<tr><td>债券组合久期</td><td>${fmtNum(metrics.bondPortfolioDuration, 2)}</td></tr>`);
    html.push(`<tr><td>债券组合凸性</td><td>${fmtNum(metrics.bondPortfolioConvexity, 2)}</td></tr>`);
    html.push('</table>');
    html.push('</body></html>');

    const blob = new Blob([html.join('')], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gt-portfolio-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importCsv(file, state, done) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const importedPositions = [];
      const importedBonds = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(',').map((c) => c.trim());
        if (cols.length < 3) continue;
        const type = (cols[0] || '').toLowerCase();
        if (type === 'bond') {
          importedBonds.push({
            id: uid(),
            name: cols[1] || '',
            face: parseFloat(cols[2]) || 0,
            coupon: parseFloat(cols[3]) || 0,
            yield: parseFloat(cols[4]) || 0,
            years: parseFloat(cols[5]) || 0,
            freq: parseInt(cols[6], 10) || 2,
          });
        } else {
          importedPositions.push({
            id: uid(),
            ticker: (cols[1] || '').toUpperCase(),
            qty: parseFloat(cols[2]) || 0,
            cost: parseFloat(cols[3]) || 0,
            sector: cols[4] || 'Other',
          });
        }
      }
      if (importedPositions.length) state.positions = importedPositions;
      if (importedBonds.length) state.bonds = importedBonds;
      if (importedPositions.length || importedBonds.length) saveState(state);
      done();
    };
    reader.readAsText(file);
  }

  function renderAttributionTab(body, state, metrics, attribution, onChange) {
    const rows = attribution.rows.map((r) => `
      <tr>
        <td>${esc(r.sector)}</td>
        <td class="right">${fmtPct(r.wp)}</td>
        <td class="right"><input type="number" data-sector="${esc(r.sector)}" data-type="weight" value="${Number.isFinite(r.wb) ? (r.wb * 100).toFixed(1) : ''}" step="0.1" placeholder="%"></td>
        <td class="right ${dirClass(r.rp)}">${fmtPct(r.rp)}</td>
        <td class="right"><input type="number" data-sector="${esc(r.sector)}" data-type="return" value="${Number.isFinite(state.sectorReturns[r.sector]) ? (state.sectorReturns[r.sector] * 100).toFixed(2) : ''}" step="0.01" placeholder="默认=基准"></td>
        <td class="right ${dirClass((r.wp - r.wbNorm) * r.rb)}">${fmtPct((r.wp - r.wbNorm) * r.rb)}</td>
        <td class="right ${dirClass(r.wbNorm * (r.rp - r.rb))}">${fmtPct(r.wbNorm * (r.rp - r.rb))}</td>
        <td class="right ${dirClass((r.wp - r.wbNorm) * (r.rp - r.rb))}">${fmtPct((r.wp - r.wbNorm) * (r.rp - r.rb))}</td>
      </tr>
    `).join('');

    body.innerHTML = `
      <div class="pr-section-title">Brinson 归因（配置 / 选股 / 交互）</div>
      <div class="pr-mini" style="margin-bottom:10px;">
        配置效应 = Σ(Wp-Wb)·Rb · 选股效应 = ΣWb·(Rp-Rb) · 交互 = Σ(Wp-Wb)·(Rp-Rb)
      </div>
      <table class="pr-table">
        <thead>
          <tr>
            <th>行业</th><th class="right">组合权重</th><th class="right">基准权重 %</th>
            <th class="right">组合收益</th><th class="right">基准收益 %</th>
            <th class="right">配置</th><th class="right">选股</th><th class="right">交互</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="pr-panel" style="margin-top:10px;">
        <div class="pr-grid-2">
          <div><span class="pr-card-label">配置效应</span><div class="pr-card-val ${dirClass(attribution.allocation)}">${fmtPct(attribution.allocation)}</div></div>
          <div><span class="pr-card-label">选股效应</span><div class="pr-card-val ${dirClass(attribution.selection)}">${fmtPct(attribution.selection)}</div></div>
          <div><span class="pr-card-label">交互效应</span><div class="pr-card-val ${dirClass(attribution.interaction)}">${fmtPct(attribution.interaction)}</div></div>
          <div><span class="pr-card-label">总超额</span><div class="pr-card-val ${dirClass(metrics.portfolioReturn - metrics.benchTotalReturn)}">${fmtPct(metrics.portfolioReturn - metrics.benchTotalReturn)}</div></div>
        </div>
      </div>
    `;

    body.querySelectorAll('input[data-sector]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const sector = inp.getAttribute('data-sector');
        const type = inp.getAttribute('data-type');
        const v = parseFloat(inp.value);
        if (type === 'weight') state.sectorWeights[sector] = Number.isFinite(v) ? v / 100 : 0;
        else state.sectorReturns[sector] = Number.isFinite(v) ? v / 100 : undefined;
        saveState(state);
        onChange();
      });
    });
  }

  function renderRiskTab(body, state, metrics, pricesByTicker, rerender) {
    const varControls = `
      <div class="pr-grid-3" style="margin-bottom:12px;">
        <div class="pr-panel">
          <div class="pr-section-title">VaR 参数</div>
          <div class="pr-input-row"><label>置信度</label>
            <select data-conf>
              <option value="0.95" ${state.confidence === 0.95 ? 'selected' : ''}>95%</option>
              <option value="0.99" ${state.confidence === 0.99 ? 'selected' : ''}>99%</option>
              <option value="0.90" ${state.confidence === 0.90 ? 'selected' : ''}>90%</option>
            </select>
          </div>
          <div class="pr-input-row"><label>持有期(交易日)</label>
            <input type="number" data-horizon value="${state.horizon || 1}" min="1" step="1">
          </div>
          <div class="pr-input-row"><label>无风险利率%</label>
            <input type="number" data-rf value="${state.riskFree || 0}" step="0.01">
          </div>
        </div>
        <div class="pr-panel">
          <div class="pr-section-title">风险分解</div>
          <div class="pr-mini">组合日波动率: <strong>${fmtPct(metrics.portfolioVolDaily)}</strong></div>
          <div class="pr-mini">组合年化波动率: <strong>${fmtPct(metrics.portfolioVolAnn)}</strong></div>
          <div class="pr-mini">系统风险(Beta): <strong>${fmtNum(metrics.portfolioBeta, 2)}</strong></div>
          <div class="pr-mini">特有风险(年化残差σ 近似): <strong>${fmtPct(Math.max(0, (metrics.portfolioVolAnn || 0) ** 2 - ((metrics.portfolioBeta || 0) * (metrics.benchVolAnn || 0)) ** 2) ** 0.5)}</strong></div>
        </div>
        <div class="pr-panel">
          <div class="pr-section-title">VaR 汇总 (${((state.confidence || 0.95) * 100).toFixed(0)}%, ${state.horizon || 1}d)</div>
          <div class="pr-metric-grid">
            <div class="pr-metric"><div class="pr-metric-label">参数法 VaR</div><div class="pr-metric-val neg">-$${fmtAmt(metrics.varAbs)}</div></div>
            <div class="pr-metric"><div class="pr-metric-label">历史模拟 VaR</div><div class="pr-metric-val neg">-$${fmtAmt(metrics.histVaR.value)}</div></div>
            <div class="pr-metric"><div class="pr-metric-label">蒙特卡洛 VaR</div><div class="pr-metric-val neg">-$${fmtAmt(metrics.mcVaR.value)}</div></div>
          </div>
          <div class="pr-mini" style="margin-top:6px;">历史模拟基于各资产实际日收益序列；蒙特卡洛基于协方差矩阵生成 ${MC_SIMULATIONS.toLocaleString()} 条路径。</div>
        </div>
      </div>
    `;

    const positions = metrics.positions;
    const labels = positions.map((p) => p.ticker);
    const n = positions.length;
    let corrHtml = '<div class="pr-section-title">收益相关性矩阵</div><table class="pr-table"><thead><tr><th></th>';
    labels.forEach((l) => { corrHtml += `<th class="right">${esc(l)}</th>`; });
    corrHtml += '</tr></thead><tbody>';
    for (let i = 0; i < n; i += 1) {
      corrHtml += `<tr><th>${esc(labels[i])}</th>`;
      for (let j = 0; j < n; j += 1) {
        const ri = positions[i].rets, rj = positions[j].rets;
        const len = Math.min(ri.length, rj.length);
        let corr = NaN;
        if (len >= 5) {
          const si = stdDev(ri.slice(-len)), sj = stdDev(rj.slice(-len));
          if (si > 0 && sj > 0) corr = covariance(ri.slice(-len), rj.slice(-len)) / (si * sj);
        }
        const c = cellColor(corr);
        corrHtml += `<td class="right" style="background:${c}">${Number.isFinite(corr) ? corr.toFixed(2) : '—'}</td>`;
      }
      corrHtml += '</tr>';
    }
    corrHtml += '</tbody></table>';

    body.innerHTML = varControls + corrHtml;

    body.querySelector('[data-conf]').addEventListener('change', (e) => { state.confidence = parseFloat(e.target.value); saveState(state); rerender(); });
    body.querySelector('[data-horizon]').addEventListener('change', (e) => { state.horizon = parseInt(e.target.value, 10) || 1; saveState(state); rerender(); });
    body.querySelector('[data-rf]').addEventListener('change', (e) => { state.riskFree = parseFloat(e.target.value) || 0; saveState(state); rerender(); });
  }

  function cellColor(r) {
    if (!Number.isFinite(r)) return 'transparent';
    const alpha = Math.min(Math.abs(r), 1) * 0.5 + 0.05;
    if (r >= 0) return `color-mix(in srgb, var(--up) ${Math.round(alpha * 100)}%, transparent)`;
    return `color-mix(in srgb, var(--down) ${Math.round(alpha * 100)}%, transparent)`;
  }

  function renderStressTab(body, state, metrics) {
    const custom = state.customShock || { shock: -10, label: '自定义冲击' };
    const customShockPct = (custom.shock || 0) / 100;
    const beta = Number.isFinite(metrics.portfolioBeta) ? metrics.portfolioBeta : 1;
    const customEquityLoss = metrics.totalEquityValue * customShockPct * beta;
    const customBondLoss = metrics.totalBondValue > 0 && Number.isFinite(metrics.bondPortfolioDuration)
      ? bondPriceChange(metrics.totalBondValue, metrics.bondPortfolioDuration, metrics.bondPortfolioConvexity, custom.shock || 0)
      : 0;
    const customTotal = customEquityLoss + customBondLoss;

    const rows = STRESS_SCENARIOS.map((sc) => {
      const scenarioEquityReturn = sc.shock * beta * (sc.betaMult || 1);
      const equityLoss = metrics.totalEquityValue * scenarioEquityReturn;
      const bondLoss = (sc.rateShockBp || 0) > 0 && metrics.totalBondValue > 0 && Number.isFinite(metrics.bondPortfolioDuration)
        ? bondPriceChange(metrics.totalBondValue, metrics.bondPortfolioDuration, metrics.bondPortfolioConvexity, sc.rateShockBp / 100)
        : 0;
      const loss = equityLoss + bondLoss;
      return { ...sc, scenarioReturn: loss / Math.max(1, metrics.totalValue), loss };
    });
    rows.push({ name: custom.label || '自定义冲击', shock: customShockPct, scenarioReturn: customTotal / Math.max(1, metrics.totalValue), loss: customTotal, custom: true });

    const maxLoss = Math.max(...rows.map((r) => Math.abs(r.loss || 0)), 1);
    const html = rows.map((r) => `
      <div class="pr-scenario-row">
        <span class="pr-scenario-name">${esc(r.name)}</span>
        <div class="pr-scenario-bar pr-bar-bg"><div class="pr-bar-fill down" style="width:${(Math.abs(r.loss || 0) / maxLoss * 100).toFixed(1)}%"></div></div>
        <span class="pr-scenario-val neg">-$${fmtAmt(Math.abs(r.loss))}</span>
        <span class="pr-scenario-val neg">${fmtPct(r.scenarioReturn)}</span>
      </div>
    `).join('');

    body.innerHTML = `
      <div class="pr-section-title">压力测试（股票按 Beta 调整，债券按久期/凸性调整）</div>
      <div class="pr-mini" style="margin-bottom:10px;">
        股票损失 = 股票市值 × 冲击 × Beta × 乘数；利率冲击下债券损失 = 价格 × (-D·Δy + 0.5·C·Δy²)。
      </div>
      ${html}
      <div class="pr-panel" style="margin-top:12px;">
        <div class="pr-section-title">自定义冲击</div>
        <div class="pr-input-row">
          <label>名称</label>
          <input type="text" data-custom-label value="${esc(custom.label || '自定义冲击')}">
        </div>
        <div class="pr-input-row">
          <label>冲击幅度 %</label>
          <input type="number" data-custom-shock value="${custom.shock || 0}" step="0.1">
        </div>
        <div class="pr-mini">当前自定义损失: <strong class="neg">-$${fmtAmt(Math.abs(customTotal))}</strong>（股票 $${fmtAmt(Math.abs(customEquityLoss))} + 债券 $${fmtAmt(Math.abs(customBondLoss))}）</div>
      </div>
    `;

    body.querySelector('[data-custom-label]').addEventListener('change', (e) => {
      state.customShock = state.customShock || {};
      state.customShock.label = e.target.value || '自定义冲击';
      saveState(state);
    });
    body.querySelector('[data-custom-shock]').addEventListener('change', (e) => {
      state.customShock = state.customShock || {};
      state.customShock.shock = parseFloat(e.target.value) || 0;
      saveState(state);
    });
  }

  /* ── Main mount ── */
  window.GT_EXTRA_TOOLS['portfoliorisk'] = {
    mount(el, setStatus) {
      injectStyle();
      const state = loadState();
      let activeTab = 'positions';
      let pricesByTicker = {};
      let alive = true;
      let refreshTimer = null;
      let aborts = [];

      el.innerHTML = `
        <div class="tool pr-root">
          <div class="pr-head">
            <span class="pr-title">Portfolio & Risk</span>
            <div class="pr-actions">
              <span class="pr-status" data-conn>连接中…</span>
              <button class="pr-btn" data-refresh type="button">刷新</button>
            </div>
          </div>
          <div class="pr-cards" data-cards></div>
          <div class="pr-tabs" data-tabs>
            <button class="pr-tab active" data-tab="positions" type="button">持仓</button>
            <button class="pr-tab" data-tab="bonds" type="button">债券</button>
            <button class="pr-tab" data-tab="attribution" type="button">归因</button>
            <button class="pr-tab" data-tab="risk" type="button">风险</button>
            <button class="pr-tab" data-tab="stress" type="button">压力测试</button>
          </div>
          <div class="pr-body" data-body></div>
          <div class="pr-foot">
            <span>数据来源：Yahoo Finance（经 /api/proxy）</span>
            <span data-time>—</span>
          </div>
          <div class="tool-hint pr-hint" data-hint style="display:none"></div>
        </div>
      `;

      const body = el.querySelector('[data-body]');
      const tabsBar = el.querySelector('[data-tabs]');
      const conn = el.querySelector('[data-conn]');
      const timeEl = el.querySelector('[data-time]');
      const hint = el.querySelector('[data-hint]');

      const showError = (msg) => {
        if (!alive) return;
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '部分离线';
        conn.className = 'pr-status';
        setStatus('offline');
      };
      const clearError = () => {
        if (!alive) return;
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'pr-status live';
        setStatus('online');
      };
      const updateTime = () => { timeEl.textContent = `更新 ${new Date().toLocaleTimeString()}`; };

      const abortAll = () => { aborts.forEach((c) => { try { c.abort(); } catch (e) {} }); aborts = []; };

      const render = () => {
        const metrics = computeMetrics(state, pricesByTicker);
        // Attach config for card rendering
        metrics.confidence = state.confidence;
        metrics.horizon = state.horizon;
        metrics.benchmark = state.benchmark;
        const attribution = computeAttribution(metrics, state);

        renderCards(el, metrics);

        if (activeTab === 'positions') renderPositionsTab(body, state, metrics, refresh);
        else if (activeTab === 'bonds') renderBondsTab(body, state, metrics, refresh);
        else if (activeTab === 'attribution') renderAttributionTab(body, state, metrics, attribution, refresh);
        else if (activeTab === 'risk') renderRiskTab(body, state, metrics, pricesByTicker, render);
        else if (activeTab === 'stress') renderStressTab(body, state, metrics);

        tabsBar.querySelectorAll('.pr-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
      };

      const refresh = async () => {
        if (!alive) return;
        abortAll();
        const ctrl = new AbortController();
        aborts.push(ctrl);

        const tickers = new Set(state.positions.map((p) => p.ticker).filter(Boolean));
        tickers.add(state.benchmark || 'SPY');

        let okCount = 0;
        let failCount = 0;
        await Promise.allSettled(
          Array.from(tickers).map(async (sym) => {
            try {
              const prices = await yahooChart(sym, ctrl.signal);
              if (prices.length) {
                pricesByTicker[sym] = prices;
                okCount += 1;
              }
            } catch (e) {
              failCount += 1;
            }
          })
        );

        if (!alive) return;
        render();
        updateTime();
        if (okCount || !state.positions.length) clearError();
        else showError('全部行情获取失败，显示手动成本数据；请检查代理或代码是否正确。');
      };

      tabsBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.pr-tab');
        if (!btn || btn.dataset.tab === activeTab) return;
        activeTab = btn.dataset.tab;
        render();
      });

      el.querySelector('[data-refresh]').addEventListener('click', refresh);

      refresh();
      refreshTimer = setInterval(refresh, REFRESH_MS);

      return () => {
        alive = false;
        clearInterval(refreshTimer);
        abortAll();
      };
    },
  };
})();
