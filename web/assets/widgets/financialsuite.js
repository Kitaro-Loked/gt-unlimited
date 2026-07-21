/* GT UNLIMITED — 金融专业套件（Financial Suite）
 * Registers nine custom tools via window.GT_EXTRA_TOOLS:
 *   finstatements   财务报表（FA）
 *   companydes      公司资料（DES）
 *   researchres     卖方研报（RES）
 *   fundamentaldata 估值模型输入
 *   ownership       机构与内部人持股
 *   madeals         M&A 交易数据库
 *   swaps           利率/货币/CDS 互换计算器
 *   structuredproducts 结构型产品定价
 *   portriskpro     组合风险专业版
 *
 * 数据来源：Yahoo Finance quoteSummary / chart（经 /api/proxy 代理），失败时优雅降级到 Demo/静态数据。
 * 无 API Key，纯原生 JS，不依赖外部库。
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  /* ── Shared utilities ── */
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtDateShort = (d) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const fmtYear = (ts) => new Date((ts || 0) * 1000).getFullYear();
  const fmtDateTs = (ts) => fmtDate(new Date((ts || 0) * 1000));

  function fmtNum(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtPct(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${fmtNum(v, digits)}%`;
  }
  function fmtSigned(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  }
  function fmtAmt(n, unit = '', digits = 2) {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return fmtSigned(n / 1e12, digits) + 'T' + unit;
    if (abs >= 1e9) return fmtSigned(n / 1e9, digits) + 'B' + unit;
    if (abs >= 1e6) return fmtSigned(n / 1e6, digits) + 'M' + unit;
    if (abs >= 1e3) return fmtSigned(n / 1e3, digits) + 'K' + unit;
    return fmtSigned(n, digits) + unit;
  }
  const dirClass = (v) => (!Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'pos' : 'neg');
  const arrow = (v) => (Number.isFinite(v) && v !== 0 ? (v > 0 ? '▲' : '▼') : '—');

  const proxyUrl = (target) => `/api/proxy?url=${encodeURIComponent(target)}`;

  async function fetchJson(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    let onOuterAbort;
    if (opts.signal) {
      onOuterAbort = () => ctrl.abort();
      opts.signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    try {
      const { signal, ...rest } = opts;
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
      if (opts.signal && onOuterAbort) opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }

  async function fetchText(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    let onOuterAbort;
    if (opts.signal) {
      onOuterAbort = () => ctrl.abort();
      opts.signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    try {
      const { signal, ...rest } = opts;
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
      if (opts.signal && onOuterAbort) opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }

  async function yahooQuoteSummary(symbol, modules, signal) {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    return fetchJson(proxyUrl(url), { signal, timeout: 20000 });
  }

  async function yahooChart(symbol, range = '6mo', interval = '1d', signal) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const json = await fetchJson(proxyUrl(url), { signal, timeout: 15000 });
    const result = json?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp) || !Array.isArray(result.indicators?.quote)) throw new Error('bad chart');
    const closes = result.indicators.quote[0].close || [];
    const prices = [];
    result.timestamp.forEach((ts, i) => { if (Number.isFinite(closes[i])) prices.push({ date: new Date(ts * 1000), close: closes[i] }); });
    if (!prices.length) throw new Error('no prices');
    return prices;
  }

  function getRaw(v) {
    if (v && typeof v === 'object' && Number.isFinite(v.raw)) return v.raw;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function getFmt(v) {
    if (v && typeof v === 'object' && v.fmt) return v.fmt;
    const n = Number(v);
    return Number.isFinite(n) ? fmtNum(n) : (v != null ? String(v) : '—');
  }

  /* ── Shared styles ── */
  const STYLE_ID = 'financial-suite-style';
  function ensureStyle(toolId) {
    if (document.getElementById(`${toolId}-style`)) return;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
.fs-suite { font-family: var(--font-mono); display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; height: 100%; overflow: hidden; }
.fs-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--hairline); padding-bottom: 8px; }
.fs-title { font-size: 10px; letter-spacing: 0.12em; color: var(--text-muted); text-transform: uppercase; }
.fs-sub { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 2px; }
.fs-head-right { display: flex; align-items: center; gap: 6px; }
.fs-search { background: var(--surface-raised); border: 1px solid var(--hairline); color: var(--text); font-family: var(--font-mono); font-size: 10px; padding: 4px 8px; border-radius: var(--radius-sm); width: 90px; text-transform: uppercase; }
.fs-search:focus { border-color: var(--acc); outline: none; }
.fs-btn { background: rgba(237,230,218,0.05); border: 1px solid var(--hairline); color: var(--text); font-family: var(--font-mono); font-size: 10px; padding: 4px 10px; border-radius: 999px; cursor: pointer; transition: all .2s var(--ease-fluid); }
.fs-btn:hover { border-color: var(--acc); color: var(--acc); background: var(--acc-glow); }
.fs-status { font-size: 9px; color: var(--warning); white-space: nowrap; }
.fs-status.live { color: var(--acc); }
.fs-body { flex: 1; overflow: auto; min-height: 0; }
.fs-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 9px; color: var(--text-dim); flex-wrap: wrap; margin-top: auto; }
.fs-foot a { color: var(--acc); text-decoration: none; }
.fs-foot a:hover { text-decoration: underline; }
.fs-pos { color: var(--up); }
.fs-neg { color: var(--down); }
.fs-flat { color: var(--text-muted); }
.fs-warn { color: var(--warning); }
.fs-info { color: var(--info); }
.fs-num { font-variant-numeric: tabular-nums; }
.fs-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 8px; }
.fs-card { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 8px; display: flex; flex-direction: column; gap: 3px; }
.fs-card-label { font-size: 9px; letter-spacing: 0.08em; color: var(--text-muted); }
.fs-card-val { font-size: 15px; font-weight: 700; font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-card-sub { font-size: 9px; color: var(--text-dim); }
.fs-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.fs-table th { position: sticky; top: 0; background: var(--surface); text-align: left; padding: 5px 6px; color: var(--text-muted); font-weight: 500; letter-spacing: 0.06em; border-bottom: 1px solid var(--hairline-strong); z-index: 1; }
.fs-table td { padding: 5px 6px; border-top: 1px solid var(--hairline); color: var(--text); }
.fs-table tr:hover td { background: rgba(237,230,218,0.03); }
.fs-table .right { text-align: right; }
.fs-tabs { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.fs-tab { background: transparent; border: 1px solid var(--hairline); color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; padding: 4px 10px; border-radius: 999px; cursor: pointer; transition: all .2s var(--ease-fluid); }
.fs-tab:hover { border-color: var(--acc); color: var(--text); }
.fs-tab.active { border-color: var(--acc); color: var(--acc); background: var(--acc-glow); }
.fs-panel { display: none; }
.fs-panel.active { display: block; }
.fs-input-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.fs-input-row label { font-size: 9px; color: var(--text-muted); white-space: nowrap; }
.fs-input-row input, .fs-input-row select { background: var(--surface-raised); border: 1px solid var(--hairline); color: var(--text); font-family: var(--font-mono); font-size: 10px; padding: 3px 6px; border-radius: var(--radius-sm); }
.fs-input-row input[type="number"] { width: 90px; }
.fs-input-row input:focus, .fs-input-row select:focus { border-color: var(--acc); outline: none; }
.fs-section-title { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); margin: 8px 0 6px; text-transform: uppercase; }
.fs-mini { font-size: 9px; color: var(--text-dim); line-height: 1.5; }
.fs-bar-bg { background: var(--surface); border-radius: 4px; height: 8px; overflow: hidden; }
.fs-bar-fill { height: 100%; border-radius: 4px; }
.fs-bar-fill.up { background: var(--up); }
.fs-bar-fill.down { background: var(--down); }
.fs-svg { width: 100%; height: 160px; }
.fs-svg text { font-family: var(--font-mono); font-size: 9px; fill: var(--text-dim); }
.fs-svg path.curve { fill: none; stroke: var(--acc); stroke-width: 2; }
.fs-svg line.grid { stroke: var(--hairline); stroke-dasharray: 2 2; }
.fs-svg rect.bar { fill: var(--acc); }
.fs-svg rect.bar.up { fill: var(--up); }
.fs-svg rect.bar.down { fill: var(--down); }
.fs-note { width: 100%; min-height: 60px; background: var(--surface-raised); border: 1px solid var(--hairline); color: var(--text); font-family: var(--font-mono); font-size: 10px; padding: 6px; border-radius: var(--radius-sm); resize: vertical; box-sizing: border-box; }
.fs-note:focus { border-color: var(--acc); outline: none; }
.fs-hint { margin-top: 6px; }
.fs-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.fs-panel-card { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 10px; }
.fs-del { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; }
.fs-del:hover { color: var(--down); }
.fs-link { color: var(--acc); text-decoration: none; font-size: 9px; }
.fs-link:hover { text-decoration: underline; }
`;
      document.head.appendChild(style);
    }
    const marker = document.createElement('style');
    marker.id = `${toolId}-style`;
    marker.textContent = '/* shared by financial-suite */';
    document.head.appendChild(marker);
  }

  function attachTabs(container) {
    const tabs = container.querySelectorAll('.fs-tab');
    const panels = container.querySelectorAll('.fs-panel');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const id = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
        panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === id));
      });
    });
  }

  /* ── Generic search-based mount factory ── */
  function createSearchMount({ toolId, title, sub, placeholder = 'AAPL', storageKey, load, render, refreshMs = 60000 }) {
    return function mount(el, setStatus) {
      ensureStyle(toolId);
      setStatus('loading');
      let savedTicker = '';
      try { savedTicker = localStorage.getItem(storageKey) || ''; } catch (e) {}
      el.innerHTML = `
        <div class="tool fs-suite fs-${toolId}">
          <div class="fs-head">
            <div>
              <div class="fs-title">${esc(title)}</div>
              ${sub ? `<div class="fs-sub">${esc(sub)}</div>` : ''}
            </div>
            <div class="fs-head-right">
              <input class="fs-search" data-ticker value="${esc(savedTicker || placeholder)}" placeholder="${esc(placeholder)}">
              <button class="fs-btn" data-search>查询</button>
              <span class="fs-status" data-conn>连接中…</span>
            </div>
          </div>
          <div class="fs-body" data-body>加载中…</div>
          <div class="fs-foot"><span data-source>—</span><span data-time>—</span></div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const body = el.querySelector('[data-body]');
      const conn = el.querySelector('[data-conn]');
      const sourceEl = el.querySelector('[data-source]');
      const timeEl = el.querySelector('[data-time]');
      const hint = el.querySelector('[data-hint]');
      const tickerInput = el.querySelector('[data-ticker]');

      let alive = true;
      let timer = null;
      let aborts = [];

      const abortAll = () => { aborts.forEach((c) => { try { c.abort(); } catch (e) {} }); aborts = []; };
      const getTicker = () => tickerInput.value.trim().toUpperCase() || placeholder;
      const saveTicker = () => { try { localStorage.setItem(storageKey, getTicker()); } catch (e) {} };
      const showError = (msg) => {
        if (!alive) return;
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '数据失败';
        conn.className = 'fs-status';
        setStatus('offline');
      };
      const clearError = () => {
        if (!alive) return;
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'fs-status live';
        setStatus('online');
      };
      const updateTime = () => { timeEl.textContent = `更新 ${fmtTime(new Date())}`; };

      const doLoad = async () => {
        if (!alive) return;
        abortAll();
        const ctrl = new AbortController();
        aborts.push(ctrl);
        const symbol = getTicker();
        saveTicker();
        try {
          const data = await load(symbol, ctrl.signal);
          if (!alive) return;
          render(data, body, sourceEl, symbol);
          clearError();
          updateTime();
        } catch (e) {
          if (!alive || e.name === 'AbortError') return;
          try { render(null, body, sourceEl, symbol); } catch (err) {}
          showError(`${esc(title)} 数据加载失败，已显示 Demo/静态数据`);
          updateTime();
        }
      };

      tickerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLoad(); });
      el.querySelector('[data-search]').addEventListener('click', doLoad);

      doLoad();
      timer = setInterval(doLoad, refreshMs);

      return () => { alive = false; clearInterval(timer); abortAll(); };
    };
  }

  /* ── Demo / fallback data factories ── */
  function demoFinancials(symbol) {
    const now = Math.floor(Date.now() / 1000);
    const yearSec = 365 * 86400;
    const makeDates = (n) => Array.from({ length: n }, (_, i) => now - (n - 1 - i) * yearSec);
    const dates = makeDates(4);
    return {
      symbol,
      source: 'Demo',
      income: [
        { endDate: dates[0], totalRevenue: 2.6017e11, costOfRevenue: 1.6178e11, grossProfit: 9.839e10, operatingIncome: 6.62e10, netIncome: 5.74e10, ebit: 6.62e10, incomeBeforeTax: 6.75e10, incomeTaxExpense: 9.68e9, interestExpense: -2.93e9, researchDevelopment: 1.876e10, sellingGeneralAdministrative: 1.997e10 },
        { endDate: dates[1], totalRevenue: 2.9432e11, costOfRevenue: 1.8162e11, grossProfit: 1.127e11, operatingIncome: 8.05e10, netIncome: 7.36e10, ebit: 8.05e10, incomeBeforeTax: 8.09e10, incomeTaxExpense: 9.68e9, interestExpense: -2.93e9, researchDevelopment: 2.119e10, sellingGeneralAdministrative: 2.239e10 },
        { endDate: dates[2], totalRevenue: 3.6572e11, costOfRevenue: 2.2361e11, grossProfit: 1.4211e11, operatingIncome: 9.95e10, netIncome: 9.28e10, ebit: 9.95e10, incomeBeforeTax: 1.008e11, incomeTaxExpense: 1.31e10, interestExpense: -2.93e9, researchDevelopment: 2.626e10, sellingGeneralAdministrative: 2.49e10 },
        { endDate: dates[3], totalRevenue: 3.9433e11, costOfRevenue: 2.4011e11, grossProfit: 1.5432e11, operatingIncome: 1.099e11, netIncome: 1.008e11, ebit: 1.099e11, incomeBeforeTax: 1.121e11, incomeTaxExpense: 1.81e10, interestExpense: -2.93e9, researchDevelopment: 2.9715e10, sellingGeneralAdministrative: 2.6095e10 },
      ],
      balance: [
        { endDate: dates[0], totalAssets: 3.2389e11, totalLiabilitiesNetMinorityInterest: 2.5849e11, stockholdersEquity: 6.54e10, cashAndCashEquivalents: 4.82e10, totalDebt: 1.1298e11, netDebt: 6.478e10, currentAssets: 1.4321e11, currentLiabilities: 1.0518e11 },
        { endDate: dates[1], totalAssets: 3.5102e11, totalLiabilitiesNetMinorityInterest: 2.8791e11, stockholdersEquity: 6.311e10, cashAndCashEquivalents: 6.39e10, totalDebt: 1.365e11, netDebt: 7.26e10, currentAssets: 1.722e11, currentLiabilities: 1.253e11 },
        { endDate: dates[2], totalAssets: 3.9474e11, totalLiabilitiesNetMinorityInterest: 3.0208e11, stockholdersEquity: 9.266e10, cashAndCashEquivalents: 4.83e10, totalDebt: 1.325e11, netDebt: 8.42e10, currentAssets: 1.813e11, currentLiabilities: 1.535e11 },
        { endDate: dates[3], totalAssets: 3.6425e11, totalLiabilitiesNetMinorityInterest: 2.905e11, stockholdersEquity: 7.375e10, cashAndCashEquivalents: 3.07e10, totalDebt: 1.236e11, netDebt: 9.29e10, currentAssets: 1.486e11, currentLiabilities: 1.454e11 },
      ],
      cash: [
        { endDate: dates[0], operatingCashflow: 8.067e10, capitalExpenditures: -7.6e9, freeCashFlow: 7.307e10, depreciation: 1.1e10 },
        { endDate: dates[1], operatingCashflow: 1.041e11, capitalExpenditures: -7.3e9, freeCashFlow: 9.68e10, depreciation: 1.12e10 },
        { endDate: dates[2], operatingCashflow: 1.221e11, capitalExpenditures: -7.5e9, freeCashFlow: 1.146e11, depreciation: 1.12e10 },
        { endDate: dates[3], operatingCashflow: 1.102e11, capitalExpenditures: -7.5e9, freeCashFlow: 1.027e11, depreciation: 1.12e10 },
      ],
    };
  }

  function demoCompany(symbol) {
    return {
      symbol,
      source: 'Demo',
      profile: { address1: 'One Apple Park Way', city: 'Cupertino', state: 'CA', country: 'United States', website: 'https://www.apple.com', industry: 'Consumer Electronics', sector: 'Technology', fullTimeEmployees: 161000, longBusinessSummary: 'Apple Inc. 设计、制造和销售智能手机、个人电脑、平板电脑、可穿戴设备和配件，并销售多种相关服务。' },
      keyStats: { trailingPE: 28.5, forwardPE: 25.2, priceToBook: 45.2, enterpriseValue: 3.1e12, profitMargins: 0.255, beta: 1.18, fiftyTwoWeekHigh: 199.62, fiftyTwoWeekLow: 164.08 },
      financialData: { currentPrice: 185.3, targetHighPrice: 250, targetLowPrice: 158, targetMeanPrice: 200, recommendationKey: 'buy', numberOfAnalystOpinions: 42, earningsGrowth: 0.08, revenueGrowth: 0.02 },
      recommendationTrend: { trend: [{ period: '0m', strongBuy: 12, buy: 20, hold: 8, sell: 2, strongSell: 0 }] },
      earningsTrend: { trend: [{ period: '+1y', growth: 0.08, earningsEstimate: { avg: 6.85 } }, { period: '+5y', growth: 0.075 }] },
      calendarEvents: { earnings: { earningsDate: [Math.floor(Date.now() / 1000) + 10 * 86400] }, exDividendDate: Math.floor(Date.now() / 1000) + 5 * 86400, dividendDate: Math.floor(Date.now() / 1000) + 25 * 86400 },
      upgrades: [
        { firm: 'Goldman Sachs', toGrade: 'Buy', fromGrade: 'Neutral', action: 'up', epochGradeDate: Math.floor(Date.now() / 1000) - 15 * 86400 },
        { firm: 'Morgan Stanley', toGrade: 'Overweight', fromGrade: 'Equal-Weight', action: 'up', epochGradeDate: Math.floor(Date.now() / 1000) - 30 * 86400 },
        { firm: 'JPMorgan', toGrade: 'Neutral', fromGrade: 'Overweight', action: 'down', epochGradeDate: Math.floor(Date.now() / 1000) - 45 * 86400 },
      ],
    };
  }

  function demoOwnership(symbol) {
    return {
      symbol,
      source: 'Demo',
      institutions: [
        { organization: 'Vanguard Group', pctHeld: 0.082, position: 1.25e9, value: 2.31e11 },
        { organization: 'BlackRock', pctHeld: 0.064, position: 9.8e8, value: 1.82e11 },
        { organization: 'Berkshire Hathaway', pctHeld: 0.058, position: 8.9e8, value: 1.65e11 },
        { organization: 'State Street', pctHeld: 0.039, position: 6.0e8, value: 1.11e11 },
        { organization: 'Fidelity', pctHeld: 0.021, position: 3.2e8, value: 5.92e10 },
      ],
      insiders: [
        { name: 'Timothy D. Cook', relation: 'CEO', latestTransDate: Math.floor(Date.now() / 1000) - 90 * 86400, positionDirect: 3.3e6, positionIndirect: 0 },
        { name: 'Luca Maestri', relation: 'CFO', latestTransDate: Math.floor(Date.now() / 1000) - 120 * 86400, positionDirect: 1.1e5, positionIndirect: 0 },
      ],
    };
  }

  /* ── Tool 1: finstatements 财务报表 ── */
  (function registerFinstatements() {
    const STORAGE_KEY = 'gt-financialsuite-finstatements-ticker';

    async function load(symbol, signal) {
      const modules = 'incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory';
      const json = await yahooQuoteSummary(symbol, modules, signal);
      const r = json?.quoteSummary?.result?.[0];
      if (!r) throw new Error('empty');
      return {
        symbol,
        source: 'Yahoo Finance',
        income: r.incomeStatementHistory?.incomeStatementHistory || [],
        balance: r.balanceSheetHistory?.balanceSheetHistory || [],
        cash: r.cashflowStatementHistory?.cashflowStatementHistory || [],
      };
    }

    function statementTable(years, rows, dataArr) {
      let html = '<table class="fs-table"><thead><tr><th>项目</th>';
      years.forEach((y) => { html += `<th class="right">${esc(String(y))}</th>`; });
      html += '</tr></thead><tbody>';
      rows.forEach((row) => {
        html += `<tr><td>${esc(row.label)}</td>`;
        dataArr.forEach((item) => {
          const v = getRaw(item[row.key]);
          html += `<td class="right fs-num">${v != null ? fmtAmt(v, '', row.digits || 2) : '—'}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function ratioPanel(income, balance, cash, years) {
      const rows = [
        { label: '毛利率', f: (i, b, c) => i.grossProfit / i.totalRevenue },
        { label: '营业利润率', f: (i, b, c) => i.operatingIncome / i.totalRevenue },
        { label: '净利润率', f: (i, b, c) => i.netIncome / i.totalRevenue },
        { label: 'ROE', f: (i, b, c) => i.netIncome / b.stockholdersEquity },
        { label: 'ROA', f: (i, b, c) => i.netIncome / b.totalAssets },
        { label: '负债/权益', f: (i, b, c) => b.totalDebt / b.stockholdersEquity },
        { label: '流动比率', f: (i, b, c) => b.currentAssets / b.currentLiabilities },
        { label: 'FCF 利润率', f: (i, b, c) => c.freeCashFlow / i.totalRevenue },
        { label: '利息保障倍数', f: (i, b, c) => i.operatingIncome / Math.abs(i.interestExpense || 0) },
      ];
      let html = '<table class="fs-table"><thead><tr><th>比率</th>';
      years.forEach((y) => { html += `<th class="right">${esc(String(y))}</th>`; });
      html += '</tr></thead><tbody>';
      rows.forEach((r) => {
        html += `<tr><td>${esc(r.label)}</td>`;
        income.forEach((inc, idx) => {
          const bal = balance[idx] || {};
          const cf = cash[idx] || {};
          const numer = { i: inc, b: bal, c: cf };
          const vals = {};
          ['totalRevenue','grossProfit','operatingIncome','netIncome','totalAssets','stockholdersEquity','totalDebt','currentAssets','currentLiabilities','freeCashFlow','interestExpense'].forEach((k)=>{ vals[k]=getRaw(inc[k]||bal[k]||cf[k]); });
          let v;
          try { v = r.f(vals, vals, vals); } catch (e) { v = NaN; }
          if (!Number.isFinite(v)) v = null;
          html += `<td class="right fs-num ${dirClass(v)}">${v != null ? fmtPct(v * 100, 2) : '—'}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function render(data, body, sourceEl, symbol) {
      const demo = demoFinancials(symbol);
      const income = (data && data.income && data.income.length) ? data.income : demo.income;
      const balance = (data && data.balance && data.balance.length) ? data.balance : demo.balance;
      const cash = (data && data.cash && data.cash.length) ? data.cash : demo.cash;
      const years = income.map((r) => fmtYear(r.endDate));

      const incomeRows = [
        { label: '总营收', key: 'totalRevenue' },
        { label: '营业成本', key: 'costOfRevenue' },
        { label: '毛利润', key: 'grossProfit' },
        { label: '研发费用', key: 'researchDevelopment' },
        { label: '销售及管理费用', key: 'sellingGeneralAdministrative' },
        { label: '营业利润', key: 'operatingIncome' },
        { label: '税前利润', key: 'incomeBeforeTax' },
        { label: '所得税', key: 'incomeTaxExpense' },
        { label: '净利润', key: 'netIncome' },
      ];
      const balanceRows = [
        { label: '流动资产', key: 'currentAssets' },
        { label: '总资产', key: 'totalAssets' },
        { label: '流动负债', key: 'currentLiabilities' },
        { label: '总负债', key: 'totalLiabilitiesNetMinorityInterest' },
        { label: '股东权益', key: 'stockholdersEquity' },
        { label: '现金及等价物', key: 'cashAndCashEquivalents' },
        { label: '总债务', key: 'totalDebt' },
        { label: '净债务', key: 'netDebt' },
      ];
      const cashRows = [
        { label: '经营活动现金流', key: 'operatingCashflow' },
        { label: '资本支出', key: 'capitalExpenditures' },
        { label: '自由现金流', key: 'freeCashFlow' },
        { label: '折旧摊销', key: 'depreciation' },
      ];

      body.innerHTML = `
        <div class="fs-tabs">
          <button class="fs-tab active" data-tab="income">利润表</button>
          <button class="fs-tab" data-tab="balance">资产负债表</button>
          <button class="fs-tab" data-tab="cash">现金流</button>
          <button class="fs-tab" data-tab="ratios">关键比率</button>
        </div>
        <div class="fs-panel active" data-panel="income">${statementTable(years, incomeRows, income)}</div>
        <div class="fs-panel" data-panel="balance">${statementTable(years, balanceRows, balance)}</div>
        <div class="fs-panel" data-panel="cash">${statementTable(years, cashRows, cash)}</div>
        <div class="fs-panel" data-panel="ratios">${ratioPanel(income, balance, cash, years)}</div>
      `;
      attachTabs(body);
      sourceEl.innerHTML = `${esc(symbol)} · ${esc(data ? data.source : 'Demo')} · <a class="fs-link" href="https://finance.yahoo.com/quote/${esc(symbol)}/financials" target="_blank" rel="noopener">Yahoo Finance</a>`;
    }

    window.GT_EXTRA_TOOLS['finstatements'] = {
      mount: createSearchMount({ toolId: 'finstatements', title: '财务报表 FA', sub: '利润表 / 资产负债表 / 现金流 / 自动比率', placeholder: 'AAPL', storageKey: STORAGE_KEY, load, render, refreshMs: 5 * 60 * 1000 }),
    };
  })();

  /* ── Tool 2: companydes 公司资料 ── */
  (function registerCompanydes() {
    const STORAGE_KEY = 'gt-financialsuite-companydes-ticker';

    async function load(symbol, signal) {
      const modules = 'summaryProfile,defaultKeyStatistics,financialData,recommendationTrend,earningsTrend,calendarEvents,upgradeDowngradeHistory';
      const json = await yahooQuoteSummary(symbol, modules, signal);
      const r = json?.quoteSummary?.result?.[0];
      if (!r) throw new Error('empty');
      return { symbol, source: 'Yahoo Finance', ...r };
    }

    function recBar(trend) {
      if (!trend || !trend.trend || !trend.trend.length) return '';
      const t = trend.trend[0];
      const total = (t.strongBuy || 0) + (t.buy || 0) + (t.hold || 0) + (t.sell || 0) + (t.strongSell || 0);
      if (!total) return '';
      const parts = [
        { k: 'strongBuy', label: '强烈买入', cls: 'up' },
        { k: 'buy', label: '买入', cls: 'up' },
        { k: 'hold', label: '持有', cls: 'warn' },
        { k: 'sell', label: '卖出', cls: 'down' },
        { k: 'strongSell', label: '强烈卖出', cls: 'down' },
      ];
      let html = `<div style="display:flex;height:10px;border-radius:4px;overflow:hidden;margin:6px 0;">`;
      parts.forEach((p) => {
        const v = t[p.k] || 0;
        if (v) html += `<div class="fs-bar-fill ${p.cls}" style="width:${(v / total * 100).toFixed(1)}%" title="${esc(p.label)} ${v}"></div>`;
      });
      html += '</div><div style="display:flex;gap:8px;font-size:9px;color:var(--text-muted);flex-wrap:wrap;">';
      parts.forEach((p) => { const v = t[p.k] || 0; html += `<span>${esc(p.label)}: ${v}</span>`; });
      html += `<span>总计: ${total}</span></div>`;
      return html;
    }

    function render(data, body, sourceEl, symbol) {
      const d = data || demoCompany(symbol);
      const p = d.summaryProfile || {};
      const k = d.defaultKeyStatistics || {};
      const f = d.financialData || {};
      const trend = d.recommendationTrend || {};
      const earn = d.earningsTrend || {};
      const cal = d.calendarEvents || {};
      const ups = (d.upgradeDowngradeHistory?.history || d.upgrades || []).slice(0, 8);

      const target = f.targetMeanPrice;
      const upside = Number.isFinite(target) && Number.isFinite(f.currentPrice) && f.currentPrice ? (target / f.currentPrice - 1) * 100 : null;

      const earnRows = (earn.trend || []).slice(0, 4).map((e) => {
        const est = e.earningsEstimate?.avg || e.epsEstimate;
        return `<tr><td>${esc(e.period || '')}</td><td class="right fs-num">${est != null ? fmtNum(est, 2) : '—'}</td><td class="right fs-num ${dirClass(e.growth)}">${Number.isFinite(e.growth) ? fmtPct(e.growth * 100) : '—'}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="fs-mini">无数据</td></tr>';

      const upRows = ups.map((u) => `
        <tr>
          <td>${fmtDateTs(u.epochGradeDate)}</td>
          <td>${esc(u.firm || '')}</td>
          <td class="${dirClass((u.action || '').includes('up') ? 1 : (u.action || '').includes('down') ? -1 : 0)}">${esc(u.action || '')}</td>
          <td>${esc(u.toGrade || '')}</td>
          <td>${esc(u.fromGrade || '')}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" class="fs-mini">无近期评级变动</td></tr>';

      const ed = cal.earnings?.earningsDate?.[0];
      body.innerHTML = `
        <div class="fs-card-grid">
          <div class="fs-card"><span class="fs-card-label">当前价</span><span class="fs-card-val">$${fmtNum(f.currentPrice || k.previousClose, 2)}</span></div>
          <div class="fs-card"><span class="fs-card-label">目标价</span><span class="fs-card-val">$${fmtNum(target, 2)}</span><span class="fs-card-sub ${dirClass(upside)}">${upside != null ? fmtPct(upside) : '—'} 潜在空间</span></div>
          <div class="fs-card"><span class="fs-card-label">市盈率 TTM</span><span class="fs-card-val">${fmtNum(k.trailingPE, 2)}</span><span class="fs-card-sub">远期 ${fmtNum(k.forwardPE, 2)}</span></div>
          <div class="fs-card"><span class="fs-card-label">市净率</span><span class="fs-card-val">${fmtNum(k.priceToBook, 2)}</span></div>
          <div class="fs-card"><span class="fs-card-label">利润率</span><span class="fs-card-val">${fmtPct((k.profitMargins || f.profitMargins) * 100)}</span></div>
          <div class="fs-card"><span class="fs-card-label">Beta</span><span class="fs-card-val">${fmtNum(k.beta, 2)}</span></div>
        </div>
        <div class="fs-grid-2">
          <div class="fs-panel-card">
            <div class="fs-section-title">公司概况</div>
            <div class="fs-mini">${esc(p.longBusinessSummary || '无简介')}</div>
            <div class="fs-mini" style="margin-top:6px;">
              <div><strong>行业 / 板块：</strong>${esc(p.industry || '—')} / ${esc(p.sector || '—')}</div>
              <div><strong>总部：</strong>${esc([p.city, p.state, p.country].filter(Boolean).join(', '))}</div>
              <div><strong>员工：</strong>${fmtNum(p.fullTimeEmployees, 0)}</div>
              <div><strong>网站：</strong>${p.website ? `<a class="fs-link" href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website)}</a>` : '—'}</div>
              <div><strong>下次财报：</strong>${ed ? fmtDateTs(ed) : '—'}</div>
              <div><strong>除息日：</strong>${cal.exDividendDate ? fmtDateTs(cal.exDividendDate) : '—'}</div>
            </div>
          </div>
          <div class="fs-panel-card">
            <div class="fs-section-title">分析师共识</div>
            <div class="fs-mini"><strong>综合评级：</strong><span class="fs-info">${esc((f.recommendationKey || '—').toUpperCase())}</span></div>
            ${recBar(trend)}
            <div class="fs-section-title">EPS 趋势</div>
            <table class="fs-table"><thead><tr><th>期间</th><th class="right">EPS 预期</th><th class="right">增长</th></tr></thead><tbody>${earnRows}</tbody></table>
          </div>
        </div>
        <div class="fs-section-title">近期评级变动</div>
        <table class="fs-table"><thead><tr><th>日期</th><th>机构</th><th>动作</th><th>调至</th><th>从</th></tr></thead><tbody>${upRows}</tbody></table>
      `;
      sourceEl.innerHTML = `${esc(symbol)} · ${esc(d.source)} · <a class="fs-link" href="https://finance.yahoo.com/quote/${esc(symbol)}" target="_blank" rel="noopener">Yahoo Finance</a>`;
    }

    window.GT_EXTRA_TOOLS['companydes'] = {
      mount: createSearchMount({ toolId: 'companydes', title: '公司资料 DES', sub: '公司概况 / 关键指标 / 分析师共识 / EPS 趋势', placeholder: 'AAPL', storageKey: STORAGE_KEY, load, render, refreshMs: 5 * 60 * 1000 }),
    };
  })();

  /* ── Tool 3: researchres 卖方研报 ── */
  (function registerResearchres() {
    const STORAGE_KEY_TICKER = 'gt-financialsuite-researchres-ticker';
    const STORAGE_KEY_NOTES = 'gt-financialsuite-researchres-notes';

    async function load(symbol, signal) {
      const json = await yahooQuoteSummary(symbol, 'upgradeDowngradeHistory', signal);
      const r = json?.quoteSummary?.result?.[0];
      if (!r) throw new Error('empty');
      return { symbol, source: 'Yahoo Finance', history: r.upgradeDowngradeHistory?.history || [] };
    }

    function render(data, body, sourceEl, symbol) {
      const d = data || { symbol, source: 'Demo', history: demoCompany(symbol).upgrades };
      const rows = (d.history || []).slice(0, 50).map((u) => `
        <tr>
          <td>${fmtDateTs(u.epochGradeDate)}</td>
          <td>${esc(u.firm || '')}</td>
          <td class="${dirClass((u.action || '').includes('up') ? 1 : (u.action || '').includes('down') ? -1 : 0)}">${esc(u.action || '')}</td>
          <td>${esc(u.toGrade || '')}</td>
          <td>${esc(u.fromGrade || '')}</td>
        </tr>
      `).join('');
      let notes = '';
      try { notes = localStorage.getItem(STORAGE_KEY_NOTES) || ''; } catch (e) {}
      body.innerHTML = `
        <div class="fs-tabs">
          <button class="fs-tab active" data-tab="history">评级历史</button>
          <button class="fs-tab" data-tab="portals">研报门户</button>
          <button class="fs-tab" data-tab="notes">研究笔记</button>
        </div>
        <div class="fs-panel active" data-panel="history">
          <table class="fs-table"><thead><tr><th>日期</th><th>机构</th><th>动作</th><th>新评级</th><th>原评级</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="fs-mini">无数据</td></tr>'}</tbody></table>
        </div>
        <div class="fs-panel" data-panel="portals">
          <div class="fs-mini" style="margin-bottom:8px;">以下为卖方机构公开研究入口（部分需机构权限）：</div>
          <div class="fs-card-grid">
            <a class="fs-card" href="https://www.goldmansachs.com/intelligence/pages/research.html" target="_blank" rel="noopener"><span class="fs-card-label">Goldman Sachs</span><span class="fs-card-val" style="font-size:12px;">Research →</span></a>
            <a class="fs-card" href="https://www.morganstanley.com/ideas" target="_blank" rel="noopener"><span class="fs-card-label">Morgan Stanley</span><span class="fs-card-val" style="font-size:12px;">Ideas →</span></a>
            <a class="fs-card" href="https://www.jpmorgan.com/insights/research" target="_blank" rel="noopener"><span class="fs-card-label">JPMorgan</span><span class="fs-card-val" style="font-size:12px;">Research →</span></a>
            <a class="fs-card" href="https://www.credit-suisse.com/invest/en/research.html" target="_blank" rel="noopener"><span class="fs-card-label">Credit Suisse</span><span class="fs-card-val" style="font-size:12px;">Research →</span></a>
            <a class="fs-card" href="https://www.bankofamerica.com/corporateinstitutional/research/insights" target="_blank" rel="noopener"><span class="fs-card-label">BofA Securities</span><span class="fs-card-val" style="font-size:12px;">Insights →</span></a>
            <a class="fs-card" href="https://www.ubs.com/global/en/wealth-management/insights/our-house-view.html" target="_blank" rel="noopener"><span class="fs-card-label">UBS</span><span class="fs-card-val" style="font-size:12px;">House View →</span></a>
          </div>
        </div>
        <div class="fs-panel" data-panel="notes">
          <textarea class="fs-note" data-notes placeholder="输入研究笔记，自动保存…">${esc(notes)}</textarea>
          <div class="fs-mini">提示：支持 Markdown 纯文本，笔记仅保存在本地浏览器。</div>
        </div>
      `;
      attachTabs(body);
      const ta = body.querySelector('[data-notes]');
      if (ta) {
        ta.addEventListener('input', () => { try { localStorage.setItem(STORAGE_KEY_NOTES, ta.value); } catch (e) {} });
      }
      sourceEl.innerHTML = `${esc(symbol)} · ${esc(d.source)} · <a class="fs-link" href="https://finance.yahoo.com/quote/${esc(symbol)}/analysis" target="_blank" rel="noopener">Yahoo Analysis</a>`;
    }

    window.GT_EXTRA_TOOLS['researchres'] = {
      mount: createSearchMount({ toolId: 'researchres', title: '卖方研报 RES', sub: '评级历史 / 研报门户 / 可编辑研究笔记', placeholder: 'AAPL', storageKey: STORAGE_KEY_TICKER, load, render, refreshMs: 10 * 60 * 1000 }),
    };
  })();

  /* ── Tool 4: fundamentaldata 估值模型 ── */
  (function registerFundamentaldata() {
    const STORAGE_KEY = 'gt-financialsuite-fundamentaldata-v1';

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return null;
    }
    function saveState(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }

    function defaultState() {
      return {
        revenue: 380,
        growth1_5: 6,
        growth6_10: 3,
        ebitMargin: 28,
        taxRate: 16,
        dnaPct: 3,
        capexPct: 4,
        nwcPct: 2,
        wacc: 9,
        terminalGrowth: 2.5,
        netDebt: 80,
        shares: 15.2,
        price: 185,
        evEbitdaMultiple: 18,
        peMultiple: 25,
        rf: 4.5,
        erp: 5,
        beta: 1.1,
        costOfDebt: 5,
        equityRatio: 80,
        debtRatio: 20,
      };
    }

    function computeDCF(s) {
      const rev = Number(s.revenue) || 0;
      const g1 = (Number(s.growth1_5) || 0) / 100;
      const g2 = (Number(s.growth6_10) || 0) / 100;
      const margin = (Number(s.ebitMargin) || 0) / 100;
      const tax = (Number(s.taxRate) || 0) / 100;
      const dna = (Number(s.dnaPct) || 0) / 100;
      const capex = (Number(s.capexPct) || 0) / 100;
      const nwc = (Number(s.nwcPct) || 0) / 100;
      const wacc = (Number(s.wacc) || 10) / 100;
      const tg = (Number(s.terminalGrowth) || 2.5) / 100;
      const nd = Number(s.netDebt) || 0;
      const sh = Number(s.shares) || 1;
      const price = Number(s.price) || 0;
      const evEbitda = Number(s.evEbitdaMultiple) || 1;
      const pe = Number(s.peMultiple) || 1;

      const flows = [];
      let revenue = rev;
      let prevRevenue = rev;
      for (let y = 1; y <= 10; y += 1) {
        const g = y <= 5 ? g1 : g2;
        revenue = prevRevenue * (1 + g);
        const ebit = revenue * margin;
        const nopat = ebit * (1 - tax);
        const dnaAmt = revenue * dna;
        const capexAmt = revenue * capex;
        const nwcAmt = (revenue - prevRevenue) * nwc;
        const fcf = nopat + dnaAmt - capexAmt - nwcAmt;
        flows.push({ year: y, revenue, ebit, fcf });
        prevRevenue = revenue;
      }
      const sumPV = flows.reduce((acc, f) => acc + f.fcf / Math.pow(1 + wacc, f.year), 0);
      const terminalFCF = flows[flows.length - 1].fcf * (1 + tg);
      const terminalValue = terminalFCF / (wacc - tg);
      const pvTerminal = terminalValue / Math.pow(1 + wacc, 10);
      const enterpriseValue = sumPV + pvTerminal;
      const equityValue = enterpriseValue - nd;
      const impliedPrice = sh ? equityValue / sh : 0;
      const upside = price ? (impliedPrice / price - 1) * 100 : 0;

      const ebit10 = flows[flows.length - 1].ebit;
      const evEbitdaValue = ebit10 * evEbitda;
      const netIncome10 = ebit10 * (1 - tax);
      const peValue = netIncome10 * pe;
      const impliedPriceEbitda = sh ? (evEbitdaValue - nd) / sh : 0;
      const impliedPricePe = sh ? (peValue - nd) / sh : 0;

      return { flows, sumPV, pvTerminal, enterpriseValue, equityValue, impliedPrice, upside, ebit10, evEbitdaValue, peValue, impliedPriceEbitda, impliedPricePe };
    }

    window.GT_EXTRA_TOOLS['fundamentaldata'] = {
      mount(el, setStatus) {
        ensureStyle('fundamentaldata');
        setStatus('online');
        const state = loadState() || defaultState();
        let activeTab = 'dcf';

        el.innerHTML = `
          <div class="tool fs-suite">
            <div class="fs-head">
              <div><div class="fs-title">估值模型输入</div><div class="fs-sub">DCF / WACC / 倍数法快速估算</div></div>
              <div class="fs-head-right"><span class="fs-status live">READY</span></div>
            </div>
            <div class="fs-tabs">
              <button class="fs-tab active" data-tab="dcf">DCF 假设</button>
              <button class="fs-tab" data-tab="wacc">WACC</button>
              <button class="fs-tab" data-tab="multiples">估值倍数</button>
              <button class="fs-tab" data-tab="output">估值结果</button>
            </div>
            <div class="fs-body" data-body></div>
            <div class="fs-foot"><span>所有输入自动保存至本地</span><span data-time>—</span></div>
          </div>`;
        const body = el.querySelector('[data-body]');
        const timeEl = el.querySelector('[data-time]');

        const input = (label, key, step = '0.1', type = 'number', extra = '') =>
          `<div class="fs-input-row"><label>${esc(label)}</label><input type="${type}" data-key="${esc(key)}" value="${esc(state[key])}" step="${step}"${extra}></div>`;

        const render = () => {
          const dcf = computeDCF(state);
          let html = '';
          if (activeTab === 'dcf') {
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('最近年度营收 ($B)', 'revenue', '0.1')}${input('收入增速 1-5 年 %', 'growth1_5', '0.1')}${input('收入增速 6-10 年 %', 'growth6_10', '0.1')}${input('EBIT 利润率 %', 'ebitMargin', '0.1')}${input('有效税率 %', 'taxRate', '0.1')}</div>
                <div class="fs-panel-card">${input('D&A / 营收 %', 'dnaPct', '0.1')}${input('资本支出 / 营收 %', 'capexPct', '0.1')}${input('净营运资本 / 营收变动 %', 'nwcPct', '0.1')}${input('净债务 ($B)', 'netDebt', '0.1')}${input('流通股数 (B)', 'shares', '0.01')}${input('当前股价 ($)', 'price', '0.01')}</div>
              </div>`;
          } else if (activeTab === 'wacc') {
            const costEquity = (Number(state.rf) || 0) + (Number(state.beta) || 0) * (Number(state.erp) || 0);
            const waccCalc = (Number(state.equityRatio) || 0) / 100 * costEquity + (Number(state.debtRatio) || 0) / 100 * (Number(state.costOfDebt) || 0) * (1 - (Number(state.taxRate) || 0) / 100);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('无风险利率 %', 'rf', '0.01')}${input('股票风险溢价 %', 'erp', '0.1')}${input('Beta', 'beta', '0.01')}${input('债务成本 %', 'costOfDebt', '0.1')}${input('税率 %', 'taxRate', '0.1')}${input('股权比例 %', 'equityRatio', '0.1')}${input('债权比例 %', 'debtRatio', '0.1')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">WACC 计算</div>
                  <div class="fs-mini">股权成本 = ${fmtNum(state.rf)}% + ${fmtNum(state.beta)} × ${fmtNum(state.erp)}% = ${fmtNum(costEquity)}%</div>
                  <div class="fs-mini">WACC = ${fmtNum(state.equityRatio)}% × ${fmtNum(costEquity)}% + ${fmtNum(state.debtRatio)}% × ${fmtNum(state.costOfDebt)}% × (1 - ${fmtNum(state.taxRate)}%)</div>
                  <div class="fs-mini" style="margin-top:8px;"><strong>计算 WACC：</strong>${fmtNum(waccCalc)}%</div>
                  <div class="fs-mini"><strong>DCF 使用 WACC：</strong>${fmtNum(state.wacc)}%</div>
                  <button class="fs-btn" data-apply-wacc style="margin-top:8px;">应用计算 WACC 到 DCF</button>
                </div>
              </div>`;
          } else if (activeTab === 'multiples') {
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('目标 EV/EBITDA 倍数', 'evEbitdaMultiple', '0.1')}${input('目标 P/E 倍数', 'peMultiple', '0.1')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">倍数法说明</div>
                  <div class="fs-mini">第 10 年 EBIT = ${fmtAmt(dcf.ebit10, 'B')}，净利润 = ${fmtAmt(dcf.ebit10 * (1 - (state.taxRate / 100)), 'B')}</div>
                  <div class="fs-mini">EV/EBITDA 法隐含股价：$${fmtNum(dcf.impliedPriceEbitda, 2)}</div>
                  <div class="fs-mini">P/E 法隐含股价：$${fmtNum(dcf.impliedPricePe, 2)}</div>
                </div>
              </div>`;
          } else {
            const rows = dcf.flows.map((f) => `
              <tr><td>第 ${f.year} 年</td><td class="right fs-num">${fmtAmt(f.revenue, 'B')}</td><td class="right fs-num">${fmtAmt(f.ebit, 'B')}</td><td class="right fs-num">${fmtAmt(f.fcf, 'B')}</td></tr>
            `).join('');
            html = `
              <div class="fs-card-grid">
                <div class="fs-card"><span class="fs-card-label">预测期 FCF 现值</span><span class="fs-card-val">${fmtAmt(dcf.sumPV, 'B')}</span></div>
                <div class="fs-card"><span class="fs-card-label">终值现值</span><span class="fs-card-val">${fmtAmt(dcf.pvTerminal, 'B')}</span></div>
                <div class="fs-card"><span class="fs-card-label">企业价值</span><span class="fs-card-val">${fmtAmt(dcf.enterpriseValue, 'B')}</span></div>
                <div class="fs-card"><span class="fs-card-label">股权价值</span><span class="fs-card-val">${fmtAmt(dcf.equityValue, 'B')}</span></div>
                <div class="fs-card"><span class="fs-card-label">DCF 隐含股价</span><span class="fs-card-val ${dirClass(dcf.upside)}">$${fmtNum(dcf.impliedPrice, 2)}</span></div>
                <div class="fs-card"><span class="fs-card-label">相对当前价空间</span><span class="fs-card-val ${dirClass(dcf.upside)}">${fmtPct(dcf.upside)}</span></div>
              </div>
              <table class="fs-table"><thead><tr><th>年份</th><th class="right">营收</th><th class="right">EBIT</th><th class="right">FCF</th></tr></thead><tbody>${rows}</tbody></table>
            `;
          }
          body.innerHTML = html;
          body.querySelectorAll('input[data-key]').forEach((inp) => {
            inp.addEventListener('change', () => {
              const key = inp.dataset.key;
              state[key] = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
              saveState(state);
              if (activeTab === 'multiples' || activeTab === 'output') render();
            });
          });
          const applyBtn = body.querySelector('[data-apply-wacc]');
          if (applyBtn) {
            applyBtn.addEventListener('click', () => {
              const costEquity = (Number(state.rf) || 0) + (Number(state.beta) || 0) * (Number(state.erp) || 0);
              state.wacc = (Number(state.equityRatio) || 0) / 100 * costEquity + (Number(state.debtRatio) || 0) / 100 * (Number(state.costOfDebt) || 0) * (1 - (Number(state.taxRate) || 0) / 100);
              saveState(state);
              render();
            });
          }
          timeEl.textContent = `更新 ${fmtTime(new Date())}`;
        };

        el.querySelectorAll('.fs-tab').forEach((tab) => {
          tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            el.querySelectorAll('.fs-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
            render();
          });
        });

        render();
        return () => {};
      },
    };
  })();

  /* ── Tool 5: ownership 持股结构 ── */
  (function registerOwnership() {
    const STORAGE_KEY = 'gt-financialsuite-ownership-ticker';

    async function load(symbol, signal) {
      const json = await yahooQuoteSummary(symbol, 'institutionOwnership,insiderHolders', signal);
      const r = json?.quoteSummary?.result?.[0];
      if (!r) throw new Error('empty');
      return { symbol, source: 'Yahoo Finance', institutions: r.institutionOwnership?.ownershipList || [], insiders: r.insiderHolders?.holders || [] };
    }

    function render(data, body, sourceEl, symbol) {
      const d = data || demoOwnership(symbol);
      const instRows = (d.institutions || []).slice(0, 30).map((o) => `
        <tr>
          <td>${esc(o.organization || '')}</td>
          <td class="right fs-num">${fmtPct((o.pctHeld || 0) * 100)}</td>
          <td class="right fs-num">${fmtAmt(o.position || 0)}</td>
          <td class="right fs-num">${o.value != null ? '$' + fmtAmt(getRaw(o.value)) : '—'}</td>
        </tr>
      `).join('');
      const insRows = (d.insiders || []).slice(0, 30).map((h) => `
        <tr>
          <td>${esc(h.name || '')}</td>
          <td>${esc(h.relation || '')}</td>
          <td class="right fs-num">${fmtAmt(getRaw(h.positionDirect))}</td>
          <td class="right">${h.latestTransDate ? fmtDateTs(h.latestTransDate) : '—'}</td>
        </tr>
      `).join('');

      body.innerHTML = `
        <div class="fs-tabs">
          <button class="fs-tab active" data-tab="inst">机构持股</button>
          <button class="fs-tab" data-tab="insider">内部人持股</button>
        </div>
        <div class="fs-panel active" data-panel="inst">
          <table class="fs-table"><thead><tr><th>机构</th><th class="right">持股比例</th><th class="right">持股数</th><th class="right">持仓价值</th></tr></thead><tbody>${instRows || '<tr><td colspan="4" class="fs-mini">无数据</td></tr>'}</tbody></table>
        </div>
        <div class="fs-panel" data-panel="insider">
          <table class="fs-table"><thead><tr><th>姓名</th><th>关系</th><th class="right">直接持股</th><th class="right">最近交易</th></tr></thead><tbody>${insRows || '<tr><td colspan="4" class="fs-mini">无数据</td></tr>'}</tbody></table>
        </div>
      `;
      attachTabs(body);
      sourceEl.innerHTML = `${esc(symbol)} · ${esc(d.source)} · <a class="fs-link" href="https://finance.yahoo.com/quote/${esc(symbol)}/holders" target="_blank" rel="noopener">Yahoo Holders</a>`;
    }

    window.GT_EXTRA_TOOLS['ownership'] = {
      mount: createSearchMount({ toolId: 'ownership', title: '持股结构', sub: '机构持股 / 内部人持股', placeholder: 'AAPL', storageKey: STORAGE_KEY, load, render, refreshMs: 10 * 60 * 1000 }),
    };
  })();

  /* ── Tool 6: madeals M&A 交易数据库 ── */
  (function registerMadeals() {
    const STORAGE_KEY = 'gt-financialsuite-madeals-v1';

    const DEFAULT_DEALS = [
      { date: '2024-01-23', target: 'MosaicML', acquirer: 'Databricks', industry: 'AI / Cloud', value: 1.3, status: '已完成', notes: '生成式 AI 模型公司' },
      { date: '2022-10-27', target: 'Twitter', acquirer: 'Elon Musk / X Corp', industry: 'Social Media', value: 44.0, status: '已完成', notes: '私有化交易' },
      { date: '2022-03-06', target: 'Mandiant', acquirer: 'Google', industry: 'Cybersecurity', value: 5.4, status: '已完成', notes: '威胁情报与安全服务' },
      { date: '2021-12-14', target: 'Activision Blizzard', acquirer: 'Microsoft', industry: 'Gaming', value: 68.7, status: '已完成', notes: '游戏业务最大并购之一' },
      { date: '2021-09-13', target: 'Metro-Goldwyn-Mayer', acquirer: 'Amazon', industry: 'Entertainment', value: 8.45, status: '已完成', notes: '影视内容库' },
      { date: '2019-11-14', target: '21st Century Fox assets', acquirer: 'Disney', industry: 'Entertainment', value: 71.3, status: '已完成', notes: '影视与流媒体资产' },
      { date: '2016-07-24', target: 'ARM Holdings', acquirer: 'SoftBank', industry: 'Semiconductors', value: 31.4, status: '已完成', notes: '芯片架构设计' },
      { date: '2000-01-10', target: 'Time Warner', acquirer: 'AOL', industry: 'Media / Internet', value: 164.0, status: '已分拆', notes: '历史上最大并购之一' },
    ];

    function loadUserDeals() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return [];
    }
    function saveUserDeals(list) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {} }

    function renderTable(rows, editable) {
      return rows.map((r, i) => `
        <tr data-idx="${i}" data-editable="${editable}">
          <td><input data-field="date" value="${esc(r.date)}"></td>
          <td><input data-field="target" value="${esc(r.target)}"></td>
          <td><input data-field="acquirer" value="${esc(r.acquirer)}"></td>
          <td><input data-field="industry" value="${esc(r.industry)}"></td>
          <td><input data-field="value" type="number" step="0.01" value="${fmtNum(r.value, 2)}"></td>
          <td><input data-field="status" value="${esc(r.status)}"></td>
          <td><input data-field="notes" value="${esc(r.notes)}"></td>
          ${editable ? '<td><button class="fs-del" data-del>×</button></td>' : '<td></td>'}
        </tr>
      `).join('');
    }

    window.GT_EXTRA_TOOLS['madeals'] = {
      mount(el, setStatus) {
        ensureStyle('madeals');
        setStatus('online');
        let userDeals = loadUserDeals();
        el.innerHTML = `
          <div class="tool fs-suite">
            <div class="fs-head">
              <div><div class="fs-title">M&A 交易数据库</div><div class="fs-sub">经典案例 + 可编辑自定义交易</div></div>
              <div class="fs-head-right"><button class="fs-btn" data-add>+ 添加交易</button></div>
            </div>
            <div class="fs-body" data-body></div>
            <div class="fs-foot"><span>静态经典案例 + 本地自定义数据</span></div>
          </div>`;
        const body = el.querySelector('[data-body]');

        const render = () => {
          body.innerHTML = `
            <div class="fs-section-title">经典并购案例</div>
            <table class="fs-table"><thead><tr><th>日期</th><th>标的</th><th>收购方</th><th>行业</th><th class="right">交易价值 ($B)</th><th>状态</th><th>备注</th><th></th></tr></thead><tbody>${renderTable(DEFAULT_DEALS, false)}</tbody></table>
            <div class="fs-section-title">自定义交易</div>
            <table class="fs-table"><thead><tr><th>日期</th><th>标的</th><th>收购方</th><th>行业</th><th class="right">交易价值 ($B)</th><th>状态</th><th>备注</th><th></th></tr></thead><tbody>${renderTable(userDeals, true) || '<tr><td colspan="8" class="fs-mini">点击右上角添加交易</td></tr>'}</tbody></table>
          `;
          body.querySelectorAll('tbody tr[data-editable="true"] input').forEach((inp) => {
            inp.addEventListener('change', () => {
              const tr = inp.closest('tr');
              const idx = parseInt(tr.dataset.idx, 10);
              const f = inp.dataset.field;
              userDeals[idx][f] = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
              saveUserDeals(userDeals);
            });
          });
          body.querySelectorAll('[data-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const tr = btn.closest('tr');
              const idx = parseInt(tr.dataset.idx, 10);
              userDeals.splice(idx, 1);
              saveUserDeals(userDeals);
              render();
            });
          });
        };

        el.querySelector('[data-add]').addEventListener('click', () => {
          userDeals.push({ date: fmtDate(new Date()), target: '', acquirer: '', industry: '', value: 0, status: '进行中', notes: '' });
          saveUserDeals(userDeals);
          render();
        });

        render();
        return () => {};
      },
    };
  })();

  /* ── Tool 7: swaps 互换计算器 ── */
  (function registerSwaps() {
    const STORAGE_KEY = 'gt-financialsuite-swaps-v1';

    function loadState() {
      try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
      return null;
    }
    function saveState(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }

    const defaults = {
      irs: { notional: 100, fixedRate: 4.5, floatSpread: 0, years: 5, freq: 2, discRate: 4.5 },
      ccs: { notionalDom: 100, notionalFor: 1000, spot: 0.1, domRate: 4.5, forRate: 2.0, years: 5, freq: 2 },
      cds: { notional: 100, couponBp: 100, hazard: 2, recovery: 40, years: 5, freq: 4, discRate: 4 },
    };

    window.GT_EXTRA_TOOLS['swaps'] = {
      mount(el, setStatus) {
        ensureStyle('swaps');
        setStatus('online');
        const state = loadState() || defaults;
        let activeTab = 'irs';

        el.innerHTML = `
          <div class="tool fs-suite">
            <div class="fs-head"><div><div class="fs-title">互换计算器</div><div class="fs-sub">利率互换 / 货币互换 / CDS 快速定价</div></div></div>
            <div class="fs-tabs">
              <button class="fs-tab active" data-tab="irs">利率互换 IRS</button>
              <button class="fs-tab" data-tab="ccs">货币互换 CCS</button>
              <button class="fs-tab" data-tab="cds">信用违约互换 CDS</button>
            </div>
            <div class="fs-body" data-body></div>
            <div class="fs-foot"><span>计算结果仅供参考，未含实际日期惯例与折扣曲线细节</span></div>
          </div>`;
        const body = el.querySelector('[data-body]');

        const input = (tab, label, key, step = '0.01', type = 'number') => {
          const v = state[tab][key];
          return `<div class="fs-input-row"><label>${esc(label)}</label><input type="${type}" data-tab="${tab}" data-key="${esc(key)}" value="${esc(v)}" step="${step}"></div>`;
        };

        const annuityFactor = (r, n, freq) => {
          const m = freq;
          const periods = n * m;
          const dr = r / 100 / m;
          if (dr === 0) return periods / m;
          return (1 - Math.pow(1 + dr, -periods)) / dr;
        };
        const df = (r, t, freq = 1) => Math.pow(1 + r / 100 / freq, -t * freq);

        const computeIrs = (s) => {
          const N = Number(s.notional) || 0;
          const fixed = (Number(s.fixedRate) || 0) / 100;
          const spread = (Number(s.floatSpread) || 0) / 100;
          const years = Number(s.years) || 0;
          const freq = Number(s.freq) || 1;
          const disc = (Number(s.discRate) || 0) / 100;
          const af = annuityFactor(s.discRate, years, freq);
          const fixedLeg = N * fixed * af;
          const floatLeg = N * (spread + disc) * af;
          const npv = fixedLeg - floatLeg;
          const fairFixed = ((spread + disc) * 100).toFixed(3);
          return { fixedLeg, floatLeg, npv, fairFixed };
        };

        const computeCcs = (s) => {
          const Nd = Number(s.notionalDom) || 0;
          const Nf = Number(s.notionalFor) || 0;
          const spot = Number(s.spot) || 0;
          const rd = (Number(s.domRate) || 0) / 100;
          const rf = (Number(s.forRate) || 0) / 100;
          const years = Number(s.years) || 0;
          const freq = Number(s.freq) || 1;
          const domLeg = Nd * rd * annuityFactor(s.domRate, years, freq);
          const forLegUsd = Nf * spot * rf * annuityFactor(s.forRate, years, freq);
          const principalDomPV = Nd * df(s.domRate, years, freq);
          const principalForPV = Nf * spot * df(s.forRate, years, freq);
          return { domLeg, forLegUsd, principalDomPV, principalForPV, npv: domLeg - forLegUsd + principalDomPV - principalForPV };
        };

        const computeCds = (s) => {
          const N = Number(s.notional) || 0;
          const c = (Number(s.couponBp) || 0) / 10000;
          const h = (Number(s.hazard) || 0) / 100;
          const rec = (Number(s.recovery) || 0) / 100;
          const years = Number(s.years) || 0;
          const freq = Number(s.freq) || 1;
          const disc = (Number(s.discRate) || 0) / 100;
          const periods = years * freq;
          const dt = 1 / freq;
          let premiumLeg = 0, defaultLeg = 0, survival = 1;
          for (let i = 1; i <= periods; i += 1) {
            const t = i * dt;
            const surv = Math.exp(-h * t);
            const prior = Math.exp(-h * (t - dt));
            const q = prior - surv;
            premiumLeg += c * dt * surv * Math.pow(1 + disc, -t);
            defaultLeg += (1 - rec) * q * Math.pow(1 + disc, -t);
            survival = surv;
          }
          const fairSpread = defaultLeg / premiumLeg * c * 10000;
          const npv = N * (premiumLeg - defaultLeg);
          return { npv, fairSpread, survival };
        };

        const render = () => {
          let html = '';
          if (activeTab === 'irs') {
            const r = computeIrs(state.irs);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('irs', '名义本金 ($M)', 'notional')}${input('irs', '固定利率 %', 'fixedRate')}${input('irs', '浮动利差 bp', 'floatSpread')}${input('irs', '期限 (年)', 'years', '1')}${input('irs', '年付息次数', 'freq', '1')}${input('irs', '贴现率 %', 'discRate')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">IRS 结果</div>
                  <div class="fs-mini">固定端 PV：$${fmtAmt(r.fixedLeg, 'M')}</div>
                  <div class="fs-mini">浮动端 PV：$${fmtAmt(r.floatLeg, 'M')}</div>
                  <div class="fs-mini">NPV（收固定）：$${fmtAmt(r.npv, 'M')}</div>
                  <div class="fs-mini">近似公允固定利率：${r.fairFixed}%</div>
                </div>
              </div>`;
          } else if (activeTab === 'ccs') {
            const r = computeCcs(state.ccs);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('ccs', '本币名义本金 ($M)', 'notionalDom')}${input('ccs', '外币名义本金', 'notionalFor')}${input('ccs', '即期汇率', 'spot')}${input('ccs', '本币利率 %', 'domRate')}${input('ccs', '外币利率 %', 'forRate')}${input('ccs', '期限 (年)', 'years', '1')}${input('ccs', '年付息次数', 'freq', '1')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">CCS 结果</div>
                  <div class="fs-mini">本币利息腿 PV：$${fmtAmt(r.domLeg, 'M')}</div>
                  <div class="fs-mini">外币利息腿 PV（折合本币）：$${fmtAmt(r.forLegUsd, 'M')}</div>
                  <div class="fs-mini">本币本金 PV：$${fmtAmt(r.principalDomPV, 'M')}</div>
                  <div class="fs-mini">外币本金 PV（折合本币）：$${fmtAmt(r.principalForPV, 'M')}</div>
                  <div class="fs-mini">NPV：$${fmtAmt(r.npv, 'M')}</div>
                </div>
              </div>`;
          } else {
            const r = computeCds(state.cds);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('cds', '名义本金 ($M)', 'notional')}${input('cds', '票息 (bp)', 'couponBp')}${input('cds', '风险率 %', 'hazard')}${input('cds', '回收率 %', 'recovery')}${input('cds', '期限 (年)', 'years', '1')}${input('cds', '年付息次数', 'freq', '1')}${input('cds', '贴现率 %', 'discRate')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">CDS 结果</div>
                  <div class="fs-mini">保护买方 NPV：$${fmtAmt(r.npv, 'M')}</div>
                  <div class="fs-mini">近似公允利差：${fmtNum(r.fairSpread, 1)} bp</div>
                  <div class="fs-mini">到期 Survival：${fmtPct(r.survival * 100)}</div>
                </div>
              </div>`;
          }
          body.innerHTML = html;
          body.querySelectorAll('input[data-tab][data-key]').forEach((inp) => {
            inp.addEventListener('change', () => {
              const tab = inp.dataset.tab;
              const key = inp.dataset.key;
              state[tab][key] = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
              saveState(state);
              render();
            });
          });
        };

        el.querySelectorAll('.fs-tab').forEach((tab) => {
          tab.addEventListener('click', () => { activeTab = tab.dataset.tab; el.querySelectorAll('.fs-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab)); render(); });
        });
        render();
        return () => {};
      },
    };
  })();

  /* ── Tool 8: structuredproducts 结构型产品 ── */
  (function registerStructuredproducts() {
    const STORAGE_KEY = 'gt-financialsuite-structured-v1';

    function loadState() {
      try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
      return null;
    }
    function saveState(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }

    const defaults = {
      autocall: { principal: 100, coupon: 12, barrier: 80, ko: 100, maturityYears: 3, obsPerYear: 4, vol: 20, drift: 5, paths: 2000 },
      revconv: { principal: 100, coupon: 10, strike: 90, barrier: 70, maturityYears: 1, vol: 25, drift: 5, paths: 2000 },
      cln: { principal: 100, coupon: 8, hazard: 3, recovery: 30, maturityYears: 5, discRate: 5 },
    };

    function randn() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    window.GT_EXTRA_TOOLS['structuredproducts'] = {
      mount(el, setStatus) {
        ensureStyle('structuredproducts');
        setStatus('online');
        const state = loadState() || defaults;
        let activeTab = 'autocall';

        el.innerHTML = `
          <div class="tool fs-suite">
            <div class="fs-head"><div><div class="fs-title">结构型产品定价</div><div class="fs-sub">Autocall / Reverse Convertible / CLN</div></div></div>
            <div class="fs-tabs">
              <button class="fs-tab active" data-tab="autocall">Autocall</button>
              <button class="fs-tab" data-tab="revconv">反向可转债</button>
              <button class="fs-tab" data-tab="cln">信用挂钩票据</button>
            </div>
            <div class="fs-body" data-body></div>
            <div class="fs-foot"><span>Monte Carlo 模拟结果仅供参考</span></div>
          </div>`;
        const body = el.querySelector('[data-body]');

        const input = (tab, label, key, step = '0.1') => {
          const v = state[tab][key];
          return `<div class="fs-input-row"><label>${esc(label)}</label><input type="number" data-tab="${tab}" data-key="${esc(key)}" value="${esc(v)}" step="${step}"></div>`;
        };

        const simulateGBM = (S0, years, vol, drift, obsTimes) => {
          const dt = 1 / 252;
          const steps = Math.ceil(years / dt);
          let S = S0;
          const path = [S];
          const sigma = vol / 100;
          const mu = drift / 100;
          for (let i = 1; i <= steps; i += 1) {
            S = S * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * randn());
            path.push(S);
          }
          return obsTimes.map((t) => {
            const idx = Math.min(Math.floor(t * 252), steps);
            return path[idx];
          });
        };

        const simulateAutocall = (s) => {
          const P = Number(s.principal);
          const c = Number(s.coupon) / 100;
          const bar = Number(s.barrier) / 100;
          const ko = Number(s.ko) / 100;
          const T = Number(s.maturityYears);
          const obs = Number(s.obsPerYear);
          const vol = Number(s.vol);
          const drift = Number(s.drift);
          const paths = Number(s.paths);
          const obsTimes = Array.from({ length: T * obs }, (_, i) => (i + 1) / obs);
          let called = 0, matured = 0, loss = 0, couponSum = 0;
          for (let p = 0; p < paths; p += 1) {
            const vals = simulateGBM(100, T, vol, drift, obsTimes);
            let hit = false;
            for (let i = 0; i < vals.length; i += 1) {
              if (vals[i] >= ko * 100) { called += 1; couponSum += c * P * (i + 1) / obs; hit = true; break; }
            }
            if (!hit) {
              matured += 1;
              const final = vals[vals.length - 1];
              if (final >= bar * 100) { couponSum += c * P * T; }
              else { loss += P * (1 - final / 100); couponSum += c * P * T; }
            }
          }
          const probCall = called / paths;
          const probLoss = loss / (paths * P);
          const expectedPayoff = couponSum / paths;
          const annualYield = expectedPayoff / P / T * 100;
          return { probCall, probLoss, expectedPayoff, annualYield };
        };

        const simulateRevConv = (s) => {
          const P = Number(s.principal);
          const c = Number(s.coupon) / 100;
          const strike = Number(s.strike) / 100;
          const bar = Number(s.barrier) / 100;
          const T = Number(s.maturityYears);
          const vol = Number(s.vol);
          const drift = Number(s.drift);
          const paths = Number(s.paths);
          let converted = 0, principalReturned = 0, couponSum = 0;
          for (let p = 0; p < paths; p += 1) {
            const vals = simulateGBM(100, T, vol, drift, [T]);
            const final = vals[0];
            couponSum += c * P * T;
            if (final < strike * 100) { converted += 1; }
            else { principalReturned += 1; }
          }
          const probConv = converted / paths;
          const expectedPayoff = couponSum / paths + (converted / paths) * (P * strike) + (principalReturned / paths) * P;
          const annualYield = (expectedPayoff / P - 1) / T * 100;
          return { probConv, expectedPayoff, annualYield };
        };

        const priceCLN = (s) => {
          const P = Number(s.principal);
          const c = Number(s.coupon) / 100;
          const h = Number(s.hazard) / 100;
          const rec = Number(s.recovery) / 100;
          const T = Number(s.maturityYears);
          const disc = Number(s.discRate) / 100;
          const dt = 1;
          let premium = 0, protection = 0, survival = 1;
          for (let t = 1; t <= T; t += 1) {
            const surv = Math.exp(-h * t);
            const q = survival - surv;
            premium += c * P * surv * Math.pow(1 + disc, -t);
            protection += (1 - rec) * P * q * Math.pow(1 + disc, -t);
            survival = surv;
          }
          const price = P - protection + premium;
          const ytm = (c * P + (P - price) / T) / ((P + price) / 2) * 100;
          return { price, protection, premium, ytm };
        };

        const render = () => {
          let html = '';
          if (activeTab === 'autocall') {
            const r = simulateAutocall(state.autocall);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('autocall', '名义本金', 'principal')}${input('autocall', '年化票息 %', 'coupon')}${input('autocall', '敲出障碍 %', 'ko')}${input('autocall', '下跌障碍 %', 'barrier')}${input('autocall', '期限 (年)', 'maturityYears', '1')}${input('autocall', '每年观察次数', 'obsPerYear', '1')}${input('autocall', '波动率 %', 'vol')}${input('autocall', '预期收益率 %', 'drift')}${input('autocall', '模拟路径', 'paths', '1')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">Autocall 模拟结果</div>
                  <div class="fs-mini">提前赎回概率：${fmtPct(r.probCall * 100)}</div>
                  <div class="fs-mini">本金损失概率：${fmtPct(r.probLoss * 100)}</div>
                  <div class="fs-mini">期望总收益：$${fmtNum(r.expectedPayoff, 2)}</div>
                  <div class="fs-mini">年化期望收益率：${fmtPct(r.annualYield)}</div>
                </div>
              </div>`;
          } else if (activeTab === 'revconv') {
            const r = simulateRevConv(state.revconv);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('revconv', '名义本金', 'principal')}${input('revconv', '年化票息 %', 'coupon')}${input('revconv', '转股价 %', 'strike')}${input('revconv', '下跌障碍 %', 'barrier')}${input('revconv', '期限 (年)', 'maturityYears', '1')}${input('revconv', '波动率 %', 'vol')}${input('revconv', '预期收益率 %', 'drift')}${input('revconv', '模拟路径', 'paths', '1')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">反向可转债模拟结果</div>
                  <div class="fs-mini">转股概率：${fmtPct(r.probConv * 100)}</div>
                  <div class="fs-mini">期望到期价值：$${fmtNum(r.expectedPayoff, 2)}</div>
                  <div class="fs-mini">年化期望收益率：${fmtPct(r.annualYield)}</div>
                </div>
              </div>`;
          } else {
            const r = priceCLN(state.cln);
            html = `
              <div class="fs-grid-2">
                <div class="fs-panel-card">${input('cln', '名义本金', 'principal')}${input('cln', '年化票息 %', 'coupon')}${input('cln', '年风险率 %', 'hazard')}${input('cln', '回收率 %', 'recovery')}${input('cln', '期限 (年)', 'maturityYears', '1')}${input('cln', '贴现率 %', 'discRate')}</div>
                <div class="fs-panel-card">
                  <div class="fs-section-title">CLN 定价结果</div>
                  <div class="fs-mini">理论价格：$${fmtNum(r.price, 2)}</div>
                  <div class="fs-mini">信用保护成本 PV：$${fmtNum(r.protection, 2)}</div>
                  <div class="fs-mini">票息 PV：$${fmtNum(r.premium, 2)}</div>
                  <div class="fs-mini">近似年化收益率：${fmtPct(r.ytm)}</div>
                </div>
              </div>`;
          }
          body.innerHTML = html;
          body.querySelectorAll('input[data-tab][data-key]').forEach((inp) => {
            inp.addEventListener('change', () => {
              state[inp.dataset.tab][inp.dataset.key] = parseFloat(inp.value);
              saveState(state);
              render();
            });
          });
        };

        el.querySelectorAll('.fs-tab').forEach((tab) => {
          tab.addEventListener('click', () => { activeTab = tab.dataset.tab; el.querySelectorAll('.fs-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab)); render(); });
        });
        render();
        return () => {};
      },
    };
  })();

  /* ── Tool 9: portriskpro 组合风险专业版 ── */
  (function registerPortriskpro() {
    const STORAGE_KEY = 'gt-financialsuite-portriskpro-v1';
    const REFRESH_MS = 2 * 60 * 1000;

    const DEFAULT_POSITIONS = [
      { id: 'p1', ticker: 'AAPL', qty: 50, cost: 175 },
      { id: 'p2', ticker: 'MSFT', qty: 25, cost: 330 },
      { id: 'p3', ticker: 'JPM', qty: 60, cost: 140 },
      { id: 'p4', ticker: 'SPY', qty: 40, cost: 420 },
    ];

    const STRESS_SCENARIOS = [
      { name: '2008 金融危机', shock: -0.45 },
      { name: 'COVID 崩盘', shock: -0.34 },
      { name: '2022 熊市', shock: -0.20 },
      { name: '加息冲击 +200bp', shock: -0.12 },
      { name: '科技板块回调', shock: -0.25 },
      { name: '地缘冲突黑天鹅', shock: -0.15 },
    ];

    const FACTORS = [
      { key: 'market', label: '市场' },
      { key: 'size', label: '规模' },
      { key: 'value', label: '价值' },
      { key: 'momentum', label: '动量' },
      { key: 'quality', label: '质量' },
    ];

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && Array.isArray(s.positions)) return s;
        }
      } catch (e) {}
      return {
        positions: DEFAULT_POSITIONS.map((p) => ({ ...p, id: p.id })),
        confidence: 0.95,
        horizon: 10,
        simulations: 5000,
        factorShocks: { market: -10, size: -3, value: 2, momentum: -4, quality: -1 },
      };
    }
    function saveState(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }
    const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

    function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
    function stdDev(arr) {
      if (arr.length < 2) return NaN;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
    }
    function covariance(x, y) {
      const n = Math.min(x.length, y.length);
      if (n < 2) return NaN;
      const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
      let s = 0;
      for (let i = 0; i < n; i += 1) s += (x[i] - mx) * (y[i] - my);
      return s / (n - 1);
    }
    function logReturns(prices) {
      const out = [];
      for (let i = 1; i < prices.length; i += 1) { if (prices[i - 1].close > 0) out.push(Math.log(prices[i].close / prices[i - 1].close)); }
      return out;
    }
    function zScore(conf) {
      if (conf >= 0.99) return 2.326;
      if (conf >= 0.975) return 1.96;
      if (conf >= 0.95) return 1.645;
      if (conf >= 0.9) return 1.282;
      return 1.645;
    }
    function randn() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // Cholesky decomposition (positive-definite check skipped; fallback to independent)
    function cholesky(A) {
      const n = A.length;
      const L = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j <= i; j += 1) {
          let s = 0;
          for (let k = 0; k < j; k += 1) s += L[i][k] * L[j][k];
          if (i === j) {
            const v = A[i][i] - s;
            if (v <= 0) return null;
            L[i][j] = Math.sqrt(v);
          } else {
            L[i][j] = (A[i][j] - s) / L[j][j];
          }
        }
      }
      return L;
    }

    window.GT_EXTRA_TOOLS['portriskpro'] = {
      mount(el, setStatus) {
        ensureStyle('portriskpro');
        setStatus('loading');
        const state = loadState();
        let pricesByTicker = {};
        let alive = true;
        let timer = null;
        let aborts = [];
        let activeTab = 'positions';

        el.innerHTML = `
          <div class="tool fs-suite">
            <div class="fs-head">
              <div><div class="fs-title">组合风险专业版</div><div class="fs-sub">Monte Carlo VaR · 因子暴露 · 压力测试 · 相关性热图</div></div>
              <div class="fs-head-right"><span class="fs-status" data-conn>连接中…</span><button class="fs-btn" data-refresh>刷新</button></div>
            </div>
            <div class="fs-tabs">
              <button class="fs-tab active" data-tab="positions">持仓</button>
              <button class="fs-tab" data-tab="metrics">风险指标</button>
              <button class="fs-tab" data-tab="factors">因子暴露</button>
              <button class="fs-tab" data-tab="stress">压力测试</button>
              <button class="fs-tab" data-tab="heatmap">相关性热图</button>
            </div>
            <div class="fs-body" data-body></div>
            <div class="fs-foot"><span>数据：Yahoo Finance（经 /api/proxy）</span><span data-time>—</span></div>
            <div class="tool-hint" data-hint style="display:none"></div>
          </div>`;
        const body = el.querySelector('[data-body]');
        const conn = el.querySelector('[data-conn]');
        const timeEl = el.querySelector('[data-time]');
        const hint = el.querySelector('[data-hint]');

        const abortAll = () => { aborts.forEach((c) => { try { c.abort(); } catch (e) {} }); aborts = []; };
        const showError = (msg) => { if (!alive) return; hint.textContent = msg; hint.style.display = ''; conn.textContent = '部分离线'; conn.className = 'fs-status'; setStatus('offline'); };
        const clearError = () => { if (!alive) return; hint.style.display = 'none'; conn.textContent = '● LIVE'; conn.className = 'fs-status live'; setStatus('online'); };
        const updateTime = () => { timeEl.textContent = `更新 ${fmtTime(new Date())}`; };

        function enriched() {
          const positions = state.positions.map((p) => {
            const prices = pricesByTicker[p.ticker] || [];
            const current = prices.length ? prices[prices.length - 1].close : NaN;
            const rets = logReturns(prices);
            const mv = Number.isFinite(current) && Number.isFinite(p.qty) ? current * p.qty : NaN;
            const cost = Number.isFinite(p.cost) && Number.isFinite(p.qty) ? p.cost * p.qty : NaN;
            const pnl = Number.isFinite(mv) && Number.isFinite(cost) ? mv - cost : NaN;
            const pnlPct = cost > 0 && Number.isFinite(pnl) ? pnl / cost : NaN;
            const vol = Number.isFinite(stdDev(rets)) ? stdDev(rets) * Math.sqrt(252) : NaN;
            const factorBetas = p.factorBetas || { market: 1, size: 0.5, value: 0, momentum: 0, quality: 0 };
            return { ...p, current, mv, cost, pnl, pnlPct, rets, vol, factorBetas };
          });
          const totalValue = positions.reduce((s, p) => s + (Number.isFinite(p.mv) ? p.mv : 0), 0);
          const totalCost = positions.reduce((s, p) => s + (Number.isFinite(p.cost) ? p.cost : 0), 0);
          positions.forEach((p) => { p.weight = totalValue > 0 ? (p.mv || 0) / totalValue : 0; });
          return { positions, totalValue, totalCost, totalPnl: totalValue - totalCost, pnlPct: totalCost > 0 ? (totalValue - totalCost) / totalCost : NaN };
        }

        function portfolioVol(metrics) {
          const pos = metrics.positions;
          if (!pos.length) return NaN;
          let s = 0;
          for (let i = 0; i < pos.length; i += 1) {
            for (let j = 0; j < pos.length; j += 1) {
              const n = Math.min(pos[i].rets.length, pos[j].rets.length);
              if (n >= 2) s += pos[i].weight * pos[j].weight * covariance(pos[i].rets.slice(-n), pos[j].rets.slice(-n));
            }
          }
          return Number.isFinite(s) && s >= 0 ? Math.sqrt(s) : NaN;
        }

        function parametricVaR(metrics) {
          const vol = portfolioVol(metrics);
          const z = zScore(state.confidence || 0.95);
          const h = Math.max(1, state.horizon || 1);
          return { vol, varAbs: metrics.totalValue * z * vol * Math.sqrt(h), varPct: metrics.totalValue > 0 ? z * vol * Math.sqrt(h) : NaN };
        }

        function mcVaR(metrics) {
          const pos = metrics.positions.filter((p) => p.rets.length >= 5);
          if (!pos.length) return { varAbs: NaN, varPct: NaN, median: NaN };
          const n = pos.length;
          const corr = [];
          const vols = [];
          for (let i = 0; i < n; i += 1) {
            vols.push(stdDev(pos[i].rets));
            const row = [];
            for (let j = 0; j < n; j += 1) {
              const len = Math.min(pos[i].rets.length, pos[j].rets.length);
              const si = stdDev(pos[i].rets.slice(-len)), sj = stdDev(pos[j].rets.slice(-len));
              row.push(si > 0 && sj > 0 ? covariance(pos[i].rets.slice(-len), pos[j].rets.slice(-len)) / (si * sj) : (i === j ? 1 : 0));
            }
            corr.push(row);
          }
          const cov = corr.map((row, i) => row.map((c, j) => c * vols[i] * vols[j]));
          const L = cholesky(cov);
          const sims = Math.max(1000, Math.min(20000, Number(state.simulations) || 5000));
          const h = Math.max(1, Number(state.horizon) || 1);
          const dailyShocks = [];
          const annualFactor = 252;
          for (let k = 0; k < sims; k += 1) {
            const z = Array.from({ length: n }, randn);
            const r = L ? L.map((row) => row.reduce((s, li, i) => s + li * z[i], 0)) : z.map((zi, i) => zi * vols[i]);
            const portReturn = pos.reduce((s, p, i) => s + p.weight * r[i] * Math.sqrt(h), 0);
            dailyShocks.push(portReturn);
          }
          dailyShocks.sort((a, b) => a - b);
          const idx = Math.floor((1 - (state.confidence || 0.95)) * sims);
          const varReturn = -dailyShocks[idx];
          return { varAbs: metrics.totalValue * varReturn, varPct: varReturn, median: dailyShocks[Math.floor(sims / 2)] };
        }

        function factorExposure(metrics) {
          const pos = metrics.positions;
          const exposure = {};
          FACTORS.forEach((f) => { exposure[f.key] = 0; });
          pos.forEach((p) => {
            FACTORS.forEach((f) => { exposure[f.key] += p.weight * (p.factorBetas?.[f.key] || 0); });
          });
          return exposure;
        }

        function renderPositions() {
          const m = enriched();
          const factorCells = (p) => FACTORS.map((f) => `<td class="right"><input data-field="factor_${esc(f.key)}" type="number" step="0.01" value="${fmtNum(p.factorBetas[f.key] || 0, 2)}" style="width:50px;text-align:right;"></td>`).join('');
          const rows = m.positions.map((p) => `
            <tr data-id="${esc(p.id)}">
              <td><input data-field="ticker" value="${esc(p.ticker)}"></td>
              <td><input data-field="qty" type="number" step="any" value="${Number.isFinite(p.qty) ? p.qty : ''}"></td>
              <td><input data-field="cost" type="number" step="any" value="${Number.isFinite(p.cost) ? p.cost : ''}"></td>
              <td class="right fs-num">${Number.isFinite(p.current) ? fmtNum(p.current, 2) : '—'}</td>
              <td class="right fs-num">${Number.isFinite(p.mv) ? '$' + fmtAmt(p.mv) : '—'}</td>
              <td class="right fs-num ${dirClass(p.pnl)}">${Number.isFinite(p.pnl) ? (p.pnl >= 0 ? '+' : '') + '$' + fmtAmt(p.pnl) : '—'}</td>
              <td class="right fs-num ${dirClass(p.pnlPct)}">${fmtPct(p.pnlPct)}</td>
              <td class="right fs-num">${Number.isFinite(p.vol) ? fmtPct(p.vol) : '—'}</td>
              ${factorCells(p)}
              <td><button class="fs-del" data-del>×</button></td>
            </tr>
          `).join('');
          const factorHeaders = FACTORS.map((f) => `<th class="right">β${esc(f.label)}</th>`).join('');
          body.innerHTML = `
            <div style="display:flex;gap:8px;margin-bottom:8px;"><button class="fs-btn" data-add>+ 添加持仓</button><button class="fs-btn" data-clear>清空</button><button class="fs-btn" data-export>导出 CSV</button><button class="fs-btn" data-import>导入 CSV</button></div>
            <table class="fs-table"><thead><tr><th>代码</th><th>数量</th><th>成本价</th><th class="right">现价</th><th class="right">市值</th><th class="right">盈亏</th><th class="right">盈亏%</th><th class="right">年化波动</th>${factorHeaders}<th></th></tr></thead><tbody>${rows || `<tr><td colspan="${9 + FACTORS.length}" class="fs-mini">暂无持仓</td></tr>`}</tbody></table>
            <input type="file" data-file style="display:none" accept=".csv">
          `;
          body.querySelector('[data-add]').addEventListener('click', () => { state.positions.push({ id: uid(), ticker: '', qty: 0, cost: 0 }); saveState(state); render(); });
          body.querySelector('[data-clear]').addEventListener('click', () => { if (confirm('清空所有持仓？')) { state.positions = []; saveState(state); render(); } });
          body.querySelector('[data-export]').addEventListener('click', () => {
            const lines = ['ticker,qty,cost'];
            state.positions.forEach((p) => lines.push(`${p.ticker},${p.qty},${p.cost}`));
            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gt-portriskpro-${fmtDate(new Date())}.csv`; a.click(); URL.revokeObjectURL(a.href);
          });
          const fileInput = body.querySelector('[data-file]');
          body.querySelector('[data-import]').addEventListener('click', () => fileInput.click());
          fileInput.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
              const imported = [];
              String(r.result).split(/\r?\n/).filter((l) => l.trim()).slice(1).forEach((line) => {
                const cols = line.split(',').map((c) => c.trim());
                if (cols.length >= 3) imported.push({ id: uid(), ticker: cols[0].toUpperCase(), qty: parseFloat(cols[1]) || 0, cost: parseFloat(cols[2]) || 0 });
              });
              if (imported.length) { state.positions = imported; saveState(state); render(); }
              fileInput.value = '';
            };
            r.readAsText(f);
          });
          body.querySelectorAll('tbody tr').forEach((row) => {
            row.querySelector('[data-del]').addEventListener('click', () => { state.positions = state.positions.filter((p) => p.id !== row.dataset.id); saveState(state); render(); });
            row.querySelectorAll('input').forEach((inp) => {
              inp.addEventListener('change', () => {
                const p = state.positions.find((x) => x.id === row.dataset.id);
                if (!p) return;
                const f = inp.dataset.field;
                if (f.startsWith('factor_')) {
                  p.factorBetas = p.factorBetas || { market: 1, size: 0.5, value: 0, momentum: 0, quality: 0 };
                  p.factorBetas[f.slice(7)] = parseFloat(inp.value) || 0;
                } else {
                  p[f] = f === 'ticker' ? inp.value.toUpperCase() : parseFloat(inp.value) || 0;
                }
                saveState(state);
                render();
              });
            });
          });
        }

        function renderMetrics() {
          const m = enriched();
          const p = parametricVaR(m);
          const mc = mcVaR(m);
          body.innerHTML = `
            <div class="fs-card-grid">
              <div class="fs-card"><span class="fs-card-label">总市值</span><span class="fs-card-val">$${fmtAmt(m.totalValue)}</span><span class="fs-card-sub">成本 $${fmtAmt(m.totalCost)}</span></div>
              <div class="fs-card"><span class="fs-card-label">总盈亏</span><span class="fs-card-val ${dirClass(m.totalPnl)}">${m.totalPnl >= 0 ? '+' : ''}$${fmtAmt(m.totalPnl)}</span><span class="fs-card-sub ${dirClass(m.pnlPct)}">${fmtPct(m.pnlPct)}</span></div>
              <div class="fs-card"><span class="fs-card-label">组合日波动</span><span class="fs-card-val">${fmtPct(p.vol)}</span><span class="fs-card-sub">年化 ${fmtPct(p.vol * Math.sqrt(252))}</span></div>
              <div class="fs-card"><span class="fs-card-label">参数 VaR (${((state.confidence || 0.95) * 100).toFixed(0)}%, ${state.horizon}d)</span><span class="fs-card-val neg">-$${fmtAmt(p.varAbs)}</span><span class="fs-card-sub neg">${fmtPct(p.varPct * 100)}</span></div>
              <div class="fs-card"><span class="fs-card-label">MC VaR (${((state.confidence || 0.95) * 100).toFixed(0)}%, ${state.horizon}d)</span><span class="fs-card-val neg">-$${fmtAmt(mc.varAbs)}</span><span class="fs-card-sub neg">${fmtPct(mc.varPct * 100)}</span></div>
              <div class="fs-card"><span class="fs-card-label">模拟中位数收益</span><span class="fs-card-val">${fmtPct(mc.median * 100)}</span></div>
            </div>
            <div class="fs-section-title">VaR 参数</div>
            <div class="fs-grid-2">
              <div class="fs-input-row"><label>置信度</label><select data-conf>${[0.9, 0.95, 0.99].map((c) => `<option value="${c}" ${state.confidence === c ? 'selected' : ''}>${(c * 100).toFixed(0)}%</option>`).join('')}</select></div>
              <div class="fs-input-row"><label>持有期 (日)</label><input data-horizon type="number" min="1" value="${state.horizon}"></div>
              <div class="fs-input-row"><label>Monte Carlo 路径</label><input data-sims type="number" min="1000" step="1000" value="${state.simulations}"></div>
            </div>
          `;
          body.querySelector('[data-conf]').addEventListener('change', (e) => { state.confidence = parseFloat(e.target.value); saveState(state); render(); });
          body.querySelector('[data-horizon]').addEventListener('change', (e) => { state.horizon = Math.max(1, parseInt(e.target.value, 10) || 1); saveState(state); render(); });
          body.querySelector('[data-sims]').addEventListener('change', (e) => { state.simulations = Math.max(1000, parseInt(e.target.value, 10) || 5000); saveState(state); render(); });
        }

        function renderFactors() {
          const m = enriched();
          const exp = factorExposure(m);
          const shocks = state.factorShocks || {};
          const impact = FACTORS.reduce((s, f) => s + (exp[f.key] || 0) * ((shocks[f.key] || 0) / 100), 0);
          let html = `<div class="fs-section-title">组合因子暴露（简化模型：市值加权单位暴露）</div><div class="fs-grid-2">`;
          FACTORS.forEach((f) => {
            const e = exp[f.key] || 0;
            html += `
              <div class="fs-panel-card">
                <div class="fs-input-row"><label>${esc(f.label)} 暴露</label><input type="number" step="0.01" value="${fmtNum(e, 2)}" readonly></div>
                <div class="fs-input-row"><label>${esc(f.label)} 冲击 %</label><input type="number" data-factor="${esc(f.key)}" value="${fmtNum(shocks[f.key] || 0)}" step="0.1"></div>
              </div>`;
          });
          html += `</div><div class="fs-panel-card" style="margin-top:8px;"><div class="fs-section-title">情景冲击下组合收益</div><div class="fs-mini">综合因子冲击影响：${fmtPct(impact * 100)}</div><div class="fs-mini">预期组合价值变动：$${fmtAmt(impact * m.totalValue)}</div></div>`;
          body.innerHTML = html;
          body.querySelectorAll('input[data-factor]').forEach((inp) => {
            inp.addEventListener('change', () => {
              state.factorShocks = state.factorShocks || {};
              state.factorShocks[inp.dataset.factor] = parseFloat(inp.value) || 0;
              saveState(state);
              render();
            });
          });
        }

        function renderStress() {
          const m = enriched();
          const rows = STRESS_SCENARIOS.map((sc) => {
            const loss = m.totalValue * sc.shock;
            return `<div class="fs-input-row" style="justify-content:space-between;"><span style="font-size:10px;">${esc(sc.name)}</span><span class="fs-num fs-neg">-$${fmtAmt(Math.abs(loss))} (${fmtPct(sc.shock * 100)})</span></div>`;
          }).join('');
          body.innerHTML = `<div class="fs-section-title">历史情景压力测试</div><div class="fs-panel-card">${rows}</div>`;
        }

        function renderHeatmap() {
          const m = enriched();
          const pos = m.positions.filter((p) => p.rets.length >= 5);
          const labels = pos.map((p) => p.ticker);
          const n = labels.length;
          const corr = [];
          for (let i = 0; i < n; i += 1) {
            const row = [];
            for (let j = 0; j < n; j += 1) {
              const len = Math.min(pos[i].rets.length, pos[j].rets.length);
              const si = stdDev(pos[i].rets.slice(-len)), sj = stdDev(pos[j].rets.slice(-len));
              const c = si > 0 && sj > 0 ? covariance(pos[i].rets.slice(-len), pos[j].rets.slice(-len)) / (si * sj) : (i === j ? 1 : 0);
              row.push(c);
            }
            corr.push(row);
          }
          const size = Math.max(240, Math.min(400, n * 50));
          const pad = 60;
          const cell = (size - pad) / n;
          let svg = `<svg class="fs-svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet">`;
          for (let i = 0; i < n; i += 1) {
            for (let j = 0; j < n; j += 1) {
              const c = corr[i][j];
              const alpha = Number.isFinite(c) ? Math.min(Math.abs(c), 1) * 0.6 + 0.05 : 0;
              const fill = Number.isFinite(c) ? (c >= 0 ? `color-mix(in srgb, var(--up) ${Math.round(alpha * 100)}%, transparent)` : `color-mix(in srgb, var(--down) ${Math.round(alpha * 100)}%, transparent)`) : 'transparent';
              svg += `<rect x="${pad + j * cell}" y="${pad + i * cell}" width="${cell - 1}" height="${cell - 1}" fill="${fill}" stroke="var(--hairline)"/>`;
              if (cell > 30) svg += `<text x="${pad + j * cell + cell / 2}" y="${pad + i * cell + cell / 2 + 3}" text-anchor="middle" font-size="9" fill="var(--text)">${Number.isFinite(c) ? c.toFixed(2) : '—'}</text>`;
            }
            svg += `<text x="${pad - 6}" y="${pad + i * cell + cell / 2 + 3}" text-anchor="end" class="fs-svg-text">${esc(labels[i])}</text>`;
            svg += `<text x="${pad + i * cell + cell / 2}" y="${pad - 8}" text-anchor="middle" class="fs-svg-text">${esc(labels[i])}</text>`;
          }
          svg += '</svg>';
          body.innerHTML = `<div class="fs-section-title">收益相关性热图</div>${svg}`;
        }

        function render() {
          if (activeTab === 'positions') renderPositions();
          else if (activeTab === 'metrics') renderMetrics();
          else if (activeTab === 'factors') renderFactors();
          else if (activeTab === 'stress') renderStress();
          else if (activeTab === 'heatmap') renderHeatmap();
          el.querySelectorAll('.fs-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
        }

        el.querySelectorAll('.fs-tab').forEach((tab) => {
          tab.addEventListener('click', () => { activeTab = tab.dataset.tab; render(); });
        });

        const refresh = async () => {
          if (!alive) return;
          abortAll();
          const ctrl = new AbortController();
          aborts.push(ctrl);
          const tickers = new Set(state.positions.map((p) => p.ticker).filter(Boolean));
          let ok = 0, fail = 0;
          await Promise.allSettled(Array.from(tickers).map(async (sym) => {
            try {
              const prices = await yahooChart(sym, '6mo', '1d', ctrl.signal);
              if (prices.length) { pricesByTicker[sym] = prices; ok += 1; }
            } catch (e) { fail += 1; }
          }));
          if (!alive) return;
          render();
          updateTime();
          if (ok || !state.positions.length) clearError();
          else showError('行情获取失败，显示手动成本数据');
        };

        el.querySelector('[data-refresh]').addEventListener('click', refresh);
        refresh();
        timer = setInterval(refresh, REFRESH_MS);
        render();

        return () => { alive = false; clearInterval(timer); abortAll(); };
      },
    };
  })();
})();
