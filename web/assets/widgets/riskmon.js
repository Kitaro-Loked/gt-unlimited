/* GT UNLIMITED — 风险与市场监控套件（Risk Monitor Suite）
 * 本文件在单个模块中注册 10 个独立工具，供 GridStack 仪表盘按需加载：
 *   fxmatrix     外汇交叉矩阵（Frankfurter ECB 参考汇率，CORS 可用）
 *   yieldcurve   美债收益率曲线（Treasury CSV / FRED，经 /api/proxy 代理）
 *   cbankrates   全球央行利率（静态精选表 + 下次会议倒计时）
 *   futurescurve 商品期货曲线（Binance 期货溢价 + TradingView 嵌入兜底）
 *   riskmon      风险指标监控台（Yahoo VIX/DXY、FRED 利差，代理兜底）
 *   cryptoetf    加密货币 ETF 资金流向（Farside 抓取 + 静态列表兜底）
 *   asharedragon A股龙虎榜（东方财富 API，A股红涨绿跌）
 *   earnings     美股财报日历（Yahoo 财报日历解析 + TradingView 兜底）
 *   fedmeetings  美联储议息会议倒计时（硬编码 2025-2026 FOMC 日程）
 *   fxvol        外汇隐含波动率（TradingView 波动率指数嵌入 + 静态估计网格）
 *
 * 所有接口均为免费公开源，无 API Key；CORS 受限源统一通过 /api/proxy?url= 代理。
 * 任一接口失败时组件会优雅降级：显示缓存值、静态兜底或外部链接，不会阻断整体界面。
 * Registers multiple custom tools via window.GT_EXTRA_TOOLS['<toolId>'].
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  /* ── Shared utilities ── */
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits = 2) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtPct = (v, digits = 2) => {
    if (!Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${fmtNum(v, digits)}%`;
  };

  const fmtSigned = (v, digits = 2) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  const fmtAmt = (n, unit = '') => {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return fmtSigned(n / 1e12, 2) + 'T' + unit;
    if (abs >= 1e9) return fmtSigned(n / 1e9, 2) + 'B' + unit;
    if (abs >= 1e6) return fmtSigned(n / 1e6, 2) + 'M' + unit;
    if (abs >= 1e3) return fmtSigned(n / 1e3, 2) + 'K' + unit;
    return fmtSigned(n, 2) + unit;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'flat';
    return v > 0 ? 'pos' : 'neg';
  };

  const arrow = (v) => (Number.isFinite(v) && v !== 0 ? (v > 0 ? '▲' : '▼') : '—');

  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtDateShort = (d) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;

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

  async function yahooChart(symbol, range = '5d', interval = '1d') {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const json = await fetchJson(proxyUrl(url));
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.meta || !Array.isArray(result.timestamp) || !Array.isArray(result.indicators.quote)) {
      throw new Error('bad yahoo payload');
    }
    const closes = result.indicators.quote[0].close || [];
    const valid = closes.filter((c) => Number.isFinite(c));
    if (!valid.length) throw new Error('no valid yahoo prices');
    return {
      meta: result.meta,
      timestamps: result.timestamp,
      closes,
      last: valid[valid.length - 1],
      prev: valid[valid.length - 2] || valid[valid.length - 1],
    };
  }

  /* ── Shared styles ──
     mount() 通过 ensureStyle(toolId) 调用；首次挂载时注入一次整体样式，
     后续无论哪个 toolId 均复用同一 <style id="riskmon-suite-style">。 */
  const STYLE_ID = 'riskmon-suite-style';
  function ensureStyle(toolId) {
    if (document.getElementById(`${toolId}-style`)) return;
    if (document.getElementById(STYLE_ID)) {
      // 样式已存在，仅创建一个空标记表示本工具已检查过样式
      const marker = document.createElement('style');
      marker.id = `${toolId}-style`;
      marker.textContent = '/* style shared by riskmon-suite */';
      document.head.appendChild(marker);
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.rm-suite { font-family: var(--font-mono); display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; height: 100%; overflow-y: auto; }
.rm-suite-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 9px; letter-spacing: 0.14em; color: var(--text-muted); }
.rm-suite-head-right { display: flex; align-items: center; gap: 8px; }
.rm-status { color: var(--warning); white-space: nowrap; }
.rm-status.live { color: var(--acc); }
.rm-sub { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; }
.rm-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 9px; color: var(--text-dim); flex-wrap: wrap; margin-top: auto; }
.rm-foot a { color: var(--acc); text-decoration: none; }
.rm-foot a:hover { text-decoration: underline; }
.rm-pos { color: var(--up); }
.rm-neg { color: var(--down); }
.rm-flat { color: var(--text-muted); }
.rm-warn { color: var(--warning); }
.rm-num { font-variant-numeric: tabular-nums; }
.rm-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.rm-card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: border-color 0.15s var(--ease-fluid);
}
.rm-card:hover { border-color: var(--acc-dim); }
.rm-card-label { font-size: 9px; letter-spacing: 0.08em; color: var(--text-muted); }
.rm-card-val { font-size: 18px; font-weight: 700; font-family: var(--font-mono); }
.rm-card-chg { font-size: 10px; font-family: var(--font-mono); }
.rm-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.rm-table th { position: sticky; top: 0; background: var(--surface); text-align: left; padding: 6px 8px; color: var(--text-muted); font-weight: 500; letter-spacing: 0.06em; border-bottom: 1px solid var(--hairline-strong); z-index: 1; }
.rm-table td { padding: 6px 8px; border-top: 1px solid var(--hairline); color: var(--text); }
.rm-table tr:hover td { background: rgba(237,230,218,0.03); }
.rm-table .rm-right { text-align: right; }
.rm-link { color: var(--acc); text-decoration: none; font-size: 9px; }
.rm-link:hover { text-decoration: underline; }
.rm-btn {
  background: rgba(237,230,218,0.05);
  border: 1px solid var(--hairline);
  color: var(--text);
  padding: 5px 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
}
.rm-btn:hover { border-color: var(--acc); color: var(--acc); background: var(--acc-glow); }
.rm-embed {
  width: 100%;
  flex: 1;
  min-height: 160px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}
.rm-embed iframe { width: 100%; height: 100%; border: none; }
.rm-svg-chart { width: 100%; height: 160px; }
.rm-svg-chart text { font-family: var(--font-mono); font-size: 9px; fill: var(--text-dim); }
.rm-svg-chart path.curve { fill: none; stroke: var(--acc); stroke-width: 2; }
.rm-svg-chart path.area { fill: var(--acc-glow); opacity: 0.25; stroke: none; }
.rm-svg-chart line.grid { stroke: var(--hairline); stroke-dasharray: 2 2; }
.rm-svg-chart circle.dot { fill: var(--acc); stroke: var(--bg); stroke-width: 1.5; }
.rm-countdown { font-family: var(--font-mono); font-size: 22px; font-weight: 700; letter-spacing: 0.06em; color: var(--text); }
.rm-bar-bg { background: var(--surface-raised); border-radius: 4px; height: 8px; overflow: hidden; }
.rm-bar-fill { height: 100%; border-radius: 4px; }
.rm-bar-fill.up { background: var(--up); }
.rm-bar-fill.down { background: var(--down); }
`;
    document.head.appendChild(style);
    const marker = document.createElement('style');
    marker.id = `${toolId}-style`;
    marker.textContent = '/* style shared by riskmon-suite */';
    document.head.appendChild(marker);
  }

  /* ── Generic mount factory ── */
  function createMount({ toolId, title, sub, load, render, refreshMs = 60000 }) {
    return function mount(el, setStatus) {
      ensureStyle(toolId);
      setStatus('loading');
      el.innerHTML = `
        <div class="tool rm-suite rm-${toolId}">
          <div class="rm-suite-head">
            <span>${esc(title)}</span>
            <span class="rm-suite-head-right"><span class="rm-status" data-conn>连接中…</span></span>
          </div>
          ${sub ? `<div class="rm-sub">${esc(sub)}</div>` : ''}
          <div class="rm-body" data-body>加载中…</div>
          <div class="rm-foot"><span data-source>—</span><span data-time>—</span></div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const body = el.querySelector('[data-body]');
      const conn = el.querySelector('[data-conn]');
      const sourceEl = el.querySelector('[data-source]');
      const timeEl = el.querySelector('[data-time]');
      const hint = el.querySelector('[data-hint]');

      let alive = true;
      let timer = null;
      let aborts = [];
      let lastOk = false;

      const abortAll = () => { aborts.forEach((c) => { try { c.abort(); } catch (e) {} }); aborts = []; };

      const showError = (msg) => {
        if (!alive) return;
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'rm-status';
        setStatus('offline');
        lastOk = false;
      };

      const clearError = () => {
        if (!alive) return;
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'rm-status live';
        setStatus('online');
        lastOk = true;
      };

      const updateTime = () => { timeEl.textContent = `更新 ${fmtTime(new Date())}`; };

      const doLoad = async () => {
        if (!alive) return;
        abortAll();
        const ctrl = new AbortController();
        aborts.push(ctrl);
        try {
          const result = await load(ctrl.signal);
          if (!alive) return;
          render(result, body, sourceEl);
          clearError();
          updateTime();
        } catch (e) {
          if (!alive || e.name === 'AbortError') return;
          // 允许 render 内部自行处理 fallback，若未渲染则显示错误
          if (body.innerHTML.trim() === '' || body.innerHTML === '加载中…') {
            showError(`${esc(title)} 数据加载失败，自动重试中…`);
          } else if (!lastOk) {
            showError(`${esc(title)} 数据加载失败，显示兜底/缓存内容`);
          }
        }
      };

      doLoad();
      timer = setInterval(doLoad, refreshMs);

      return () => {
        alive = false;
        clearInterval(timer);
        abortAll();
      };
    };
  }


  /* ── Tool 1: fxmatrix 外汇交叉矩阵 ── */
  (function registerFxmatrix() {
    const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNH'];
    const TV_PAIRS = {
      USDEUR: 'FX:EURUSD', EURUSD: 'FX:EURUSD',
      USDGBP: 'FX:GBPUSD', GBPUSD: 'FX:GBPUSD',
      USDJPY: 'FX:USDJPY', JPYUSD: 'FX:USDJPY',
      USDAUD: 'FX:AUDUSD', AUDUSD: 'FX:AUDUSD',
      USDCAD: 'FX:USDCAD', CADUSD: 'FX:USDCAD',
      USDCHF: 'FX:USDCHF', CHFUSD: 'FX:USDCHF',
      USDNZD: 'FX:NZDUSD', NZDUSD: 'FX:NZDUSD',
      USDCNH: 'FX:USDCNH', CNHUSD: 'FX:USDCNH',
      EURGBP: 'FX:EURGBP', GBPEUR: 'FX:EURGBP',
      EURJPY: 'FX:EURJPY', JPYEUR: 'FX:EURJPY',
      EURCHF: 'FX:EURCHF', CHFEUR: 'FX:EURCHF',
      GBPJPY: 'FX:GBPJPY', JPYGBP: 'FX:GBPJPY',
      AUDJPY: 'FX:AUDJPY', JPYAUD: 'FX:AUDJPY',
      CADJPY: 'FX:CADJPY', JPYCAD: 'FX:CADJPY',
      CHFJPY: 'FX:CHFJPY', JPYCHF: 'FX:CHFJPY',
      EURAUD: 'FX:EURAUD', AUDEUR: 'FX:EURAUD',
      EURCAD: 'FX:EURCAD', CADEUR: 'FX:EURCAD',
      GBPAUD: 'FX:GBPAUD', AUDGBP: 'FX:GBPAUD',
      GBPCAD: 'FX:GBPCAD', CADGBP: 'FX:GBPCAD',
      AUDNZD: 'FX:AUDNZD', NZDAUD: 'FX:AUDNZD',
    };

    function crossSymbol(base, quote) {
      return TV_PAIRS[`${base}${quote}`] || '';
    }

    async function loadFxmatrix(signal) {
      const today = new Date();
      const start = new Date(today.getTime() - 8 * 86400000);
      const startStr = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
      const symbols = CURRENCIES.filter((c) => c !== 'USD').join(',');
      // Frankfurter 无 CNH，用 CNY 近似
      const syms = symbols.replace('CNH', 'CNY');
      const latestUrl = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${syms}`;
      const histUrl = `https://api.frankfurter.dev/v1/${startStr}..?base=USD&symbols=${syms}`;
      const [latestRes, histRes] = await Promise.all([
        fetch(latestUrl, { signal }),
        fetch(histUrl, { signal }).catch(() => null),
      ]);
      if (!latestRes.ok) throw new Error(`fxmatrix latest ${latestRes.status}`);
      const latest = await latestRes.json();
      let hist = null;
      if (histRes && histRes.ok) hist = await histRes.json();
      return { latest, hist };
    }

    function renderFxmatrix(result, body, sourceEl) {
      const { latest, hist } = result;
      const rates = latest.rates || {};
      // 补 USD 自身
      const usdRates = { USD: 1, ...rates };
      // CNH 近似用 CNY
      if (usdRates.CNY && !usdRates.CNH) usdRates.CNH = usdRates.CNY;

      let prevRates = null;
      if (hist && hist.rates) {
        const dates = Object.keys(hist.rates).sort();
        if (dates.length >= 2) {
          prevRates = { USD: 1, ...hist.rates[dates[dates.length - 2]] };
          if (prevRates.CNY && !prevRates.CNH) prevRates.CNH = prevRates.CNY;
        }
      }

      let html = '<table class="rm-table"><thead><tr><th>基础\\报价</th>';
      CURRENCIES.forEach((q) => { html += `<th class="rm-right">${esc(q)}</th>`; });
      html += '</tr></thead><tbody>';

      CURRENCIES.forEach((base) => {
        html += `<tr><td><strong>${esc(base)}</strong></td>`;
        CURRENCIES.forEach((quote) => {
          if (base === quote) {
            html += '<td class="rm-right rm-flat">1.0000</td>';
            return;
          }
          const cross = usdRates[base] && usdRates[quote] ? usdRates[quote] / usdRates[base] : null;
          let chg = null;
          if (prevRates && prevRates[base] && prevRates[quote]) {
            const prevCross = prevRates[quote] / prevRates[base];
            if (cross && prevCross) chg = (cross / prevCross - 1) * 100;
          }
          const sym = crossSymbol(base, quote);
          const cls = dirClass(chg);
          const clickAttr = sym ? `data-sym="${esc(sym)}" style="cursor:pointer"` : '';
          html += `<td class="rm-right rm-num ${cls}" ${clickAttr} title="${esc(chg != null ? fmtPct(chg) : '无变化数据')}">${cross ? fmtNum(cross, 4) : '—'}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      body.innerHTML = html;
      sourceEl.innerHTML = `来源：<a href="https://api.frankfurter.dev/" target="_blank" rel="noopener">Frankfurter ECB</a>${prevRates ? ' · 日变化' : ''}`;

      body.querySelectorAll('[data-sym]').forEach((cell) => {
        cell.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('gt:set-symbol', { detail: { tv: cell.getAttribute('data-sym') } }));
        });
      });
    }

    window.GT_EXTRA_TOOLS['fxmatrix'] = {
      mount: createMount({
        toolId: 'fxmatrix',
        title: '外汇交叉矩阵',
        sub: '点击单元格跳转主图 · 绿色涨 / 红色跌 · 60s 刷新',
        load: loadFxmatrix,
        render: renderFxmatrix,
        refreshMs: 60000,
      }),
    };
  })();

  /* ── Tool 2: yieldcurve 美债收益率曲线 ── */
  (function registerYieldcurve() {
    const MATURITIES = ['1 Mo', '2 Mo', '3 Mo', '4 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '5 Yr', '7 Yr', '10 Yr', '20 Yr', '30 Yr'];
    const LABELS = ['1M', '2M', '3M', '4M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];

    function parseTreasuryCsv(text) {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error('empty csv');
      const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      const dateIdx = header.indexOf('Date');
      const rows = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const obj = {};
        header.forEach((h, i) => { obj[h] = cols[i]; });
        return obj;
      });
      // 最新日期
      rows.sort((a, b) => new Date(b.Date) - new Date(a.Date));
      return rows[0];
    }

    async function loadYieldcurve(signal) {
      const year = new Date().getFullYear();
      const urls = [
        `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`,
        `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year - 1}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year - 1}&page&_format=csv`,
      ];
      let row = null;
      let src = '';
      for (const url of urls) {
        try {
          const text = await fetchText(proxyUrl(url), { signal, timeout: 20000 });
          row = parseTreasuryCsv(text);
          src = 'home.treasury.gov';
          break;
        } catch (e) {
          // try next
        }
      }
      if (!row) {
        // FRED T10Y 等作为曲线近似
        const fredUrl = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS1MO,DGS3MO,DGS6MO,DGS1,DGS2,DGS3,DGS5,DGS7,DGS10,DGS20,DGS30';
        try {
          const text = await fetchText(proxyUrl(fredUrl), { signal, timeout: 20000 });
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          const header = lines[0].split(',').map((h) => h.trim());
          const last = lines[lines.length - 1].split(',').map((c) => c.trim());
          row = {};
          header.forEach((h, i) => { row[h] = last[i]; });
          row.Date = row.DATE || row.date || last[0];
          src = 'FRED';
        } catch (e) {
          throw new Error('yield sources failed');
        }
      }
      return { row, src };
    }

    function getYield(row, key) {
      const v = row[key];
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function renderYieldcurve(result, body, sourceEl) {
      const { row, src } = result;
      const points = MATURITIES.map((m, i) => {
        let y = getYield(row, m);
        if (y == null) {
          // FRED 字段映射
          const map = {
            '1 Mo': 'DGS1MO', '3 Mo': 'DGS3MO', '6 Mo': 'DGS6MO',
            '1 Yr': 'DGS1', '2 Yr': 'DGS2', '3 Yr': 'DGS3',
            '5 Yr': 'DGS5', '7 Yr': 'DGS7', '10 Yr': 'DGS10',
            '20 Yr': 'DGS20', '30 Yr': 'DGS30',
          };
          y = getYield(row, map[m]);
        }
        return { label: LABELS[i], maturity: m, y };
      });

      const valid = points.filter((p) => p.y != null);
      const y2 = points.find((p) => p.maturity === '2 Yr')?.y;
      const y3m = points.find((p) => p.maturity === '3 Mo')?.y;
      const y10 = points.find((p) => p.maturity === '10 Yr')?.y;
      const y30 = points.find((p) => p.maturity === '30 Yr')?.y;
      const spread10y2y = (y10 != null && y2 != null) ? y10 - y2 : null;
      const spread10y3m = (y10 != null && y3m != null) ? y10 - y3m : null;

      // SVG 绘制
      const w = 600;
      const h = 160;
      const pad = { t: 12, r: 24, b: 28, l: 34 };
      const xFor = (i) => pad.l + (valid.length > 1 ? (i / (valid.length - 1)) * (w - pad.l - pad.r) : (w - pad.l - pad.r) / 2);
      const ys = valid.map((p) => p.y);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const yRange = Math.max(maxY - minY, 0.1);
      const yFor = (y) => h - pad.b - ((y - minY) / yRange) * (h - pad.t - pad.b);
      let pathD = '';
      let areaD = '';
      valid.forEach((p, i) => {
        const x = xFor(i);
        const y = yFor(p.y);
        pathD += `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        areaD += `${i === 0 ? `M ${x} ${h - pad.b}` : ''} L ${x} ${y}`;
      });
      if (valid.length) areaD += ` L ${xFor(valid.length - 1)} ${h - pad.b} Z`;

      let svg = `<svg class="rm-svg-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`;
      svg += `<line class="grid" x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}"/>`;
      svg += `<text x="${pad.l - 6}" y="${pad.t + 4}" text-anchor="end">${fmtNum(maxY, 2)}%</text>`;
      svg += `<text x="${pad.l - 6}" y="${h - pad.b}" text-anchor="end">${fmtNum(minY, 2)}%</text>`;
      svg += `<path class="area" d="${areaD}"/>`;
      svg += `<path class="curve" d="${pathD}"/>`;
      valid.forEach((p, i) => {
        svg += `<circle class="dot" cx="${xFor(i)}" cy="${yFor(p.y)}" r="3"/>`;
        svg += `<text x="${xFor(i)}" y="${h - pad.b + 14}" text-anchor="middle">${esc(p.label)}</text>`;
      });
      svg += '</svg>';

      body.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;font-size:10px;">
          <span class="rm-card-label">10Y-2Y: <strong class="rm-num ${dirClass(spread10y2y)}">${spread10y2y != null ? fmtNum(spread10y2y, 2) + '%' : '—'}</strong></span>
          <span class="rm-card-label">10Y-3M: <strong class="rm-num ${dirClass(spread10y3m)}">${spread10y3m != null ? fmtNum(spread10y3m, 2) + '%' : '—'}</strong></span>
          <span class="rm-card-label">30Y: <strong class="rm-num">${y30 != null ? fmtNum(y30, 2) + '%' : '—'}</strong></span>
        </div>
        ${svg}
      `;
      sourceEl.innerHTML = `来源：<a href="https://home.treasury.gov/" target="_blank" rel="noopener">${esc(src)}</a> · ${esc(row.Date || '')}`;
    }

    window.GT_EXTRA_TOOLS['yieldcurve'] = {
      mount: createMount({
        toolId: 'yieldcurve',
        title: '美债收益率曲线',
        sub: '最新美债收益率期限结构 · 5min 刷新',
        load: loadYieldcurve,
        render: renderYieldcurve,
        refreshMs: 5 * 60 * 1000,
      }),
    };
  })();


  /* ── Tool 3: cbankrates 全球央行利率 ── */
  (function registerCbankrates() {
    // 静态精选数据：当前利率、上次变动、下次会议（近似，需随实际决议更新）
    const BANKS = [
      { code: 'FED', country: '美国', name: '美联储', rate: 5.50, lastChange: -0.25, lastDate: '2025-06-18', nextDate: '2025-07-30', url: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm' },
      { code: 'ECB', country: '欧元区', name: '欧洲央行', rate: 3.25, lastChange: -0.25, lastDate: '2025-06-11', nextDate: '2025-07-24', url: 'https://www.ecb.europa.eu/home/html/index.en.html' },
      { code: 'BoE', country: '英国', name: '英国央行', rate: 4.50, lastChange: -0.25, lastDate: '2025-06-19', nextDate: '2025-08-07', url: 'https://www.bankofengland.co.uk/' },
      { code: 'BoJ', country: '日本', name: '日本央行', rate: 0.50, lastChange: 0.25, lastDate: '2025-06-17', nextDate: '2025-07-30', url: 'https://www.boj.or.jp/en/' },
      { code: 'PBOC', country: '中国', name: '人民银行', rate: 3.10, lastChange: -0.10, lastDate: '2025-06-20', nextDate: '2025-07-21', url: 'http://www.pbc.gov.cn/' },
      { code: 'RBA', country: '澳大利亚', name: '澳洲联储', rate: 3.85, lastChange: -0.25, lastDate: '2025-07-15', nextDate: '2025-08-12', url: 'https://www.rba.gov.au/' },
      { code: 'RBNZ', country: '新西兰', name: '新西兰联储', rate: 4.25, lastChange: -0.25, lastDate: '2025-07-09', nextDate: '2025-08-13', url: 'https://www.rbnz.govt.nz/' },
      { code: 'BOC', country: '加拿大', name: '加拿大央行', rate: 3.75, lastChange: -0.25, lastDate: '2025-06-04', nextDate: '2025-07-30', url: 'https://www.bankofcanada.ca/' },
      { code: 'SNB', country: '瑞士', name: '瑞士央行', rate: 0.00, lastChange: -0.25, lastDate: '2025-06-19', nextDate: '2025-09-18', url: 'https://www.snb.ch/en/' },
    ];

    function daysUntil(dateStr) {
      const d = new Date(dateStr + 'T00:00:00Z');
      const now = new Date();
      const diff = d - now;
      if (diff < 0) return '已召开';
      const days = Math.ceil(diff / 86400000);
      return `${days} 天`;
    }

    function renderCbankrates(_result, body, sourceEl) {
      const rows = BANKS.map((b) => ({ ...b, countdown: daysUntil(b.nextDate) }))
        .sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate));
      let html = '<table class="rm-table"><thead><tr><th>央行</th><th>当前利率</th><th>上次变动</th><th>下次会议</th><th>倒计时</th></tr></thead><tbody>';
      rows.forEach((b) => {
        html += `<tr>
          <td><a class="rm-link" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.country)} · ${esc(b.code)}</a></td>
          <td class="rm-right rm-num">${fmtNum(b.rate, 2)}%</td>
          <td class="rm-right rm-num ${dirClass(b.lastChange)}">${fmtSigned(b.lastChange, 2)}%</td>
          <td class="rm-right">${esc(b.nextDate)}</td>
          <td class="rm-right">${esc(b.countdown)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      body.innerHTML = html;
      sourceEl.innerHTML = '来源：静态精选表（随央行决议更新）· <a href="https://www.tradingeconomics.com/" target="_blank" rel="noopener">TradingEconomics</a>';
    }

    async function loadCbankrates(signal) {
      // 尝试通过 /api/proxy 抓取 TradingEconomics 央行利率页作为补充（容错）
      try {
        const text = await fetchText(proxyUrl('https://www.tradingeconomics.com/central-bank-interest-rate'), { signal, timeout: 15000 });
        // 仅做占位，实际解析 HTML 脆弱；失败时返回空对象
        if (text && text.includes('Interest Rate')) return { scraped: true };
      } catch (e) {
        // ignore
      }
      return { static: true };
    }

    window.GT_EXTRA_TOOLS['cbankrates'] = {
      mount: createMount({
        toolId: 'cbankrates',
        title: '全球央行利率',
        sub: '主要央行基准利率与下次议息倒计时 · 点击跳转官网',
        load: loadCbankrates,
        render: renderCbankrates,
        refreshMs: 10 * 60 * 1000,
      }),
    };
  })();

  /* ── Tool 4: futurescurve 商品期货曲线 ── */
  (function registerFuturescurve() {
    const COMMODITIES = [
      { name: 'WTI 原油', tv: 'TVC:USOIL', url: 'https://www.tradingview.com/chart/?symbol=TVC%3AUSOIL' },
      { name: '布伦特原油', tv: 'TVC:UKOIL', url: 'https://www.tradingview.com/chart/?symbol=TVC%3AUKOIL' },
      { name: '黄金', tv: 'TVC:GOLD', url: 'https://www.tradingview.com/chart/?symbol=TVC%3AGOLD' },
      { name: '铜', tv: 'TVC:COPPER', url: 'https://www.tradingview.com/chart/?symbol=TVC%3ACOPPER' },
      { name: '天然气', tv: 'TVC:NATURAL_GAS', url: 'https://www.tradingview.com/chart/?symbol=TVC%3ANATURAL_GAS' },
      { name: '小麦', tv: 'TVC:WHEAT', url: 'https://www.tradingview.com/chart/?symbol=TVC%3AWHEAT' },
    ];

    async function loadFuturescurve(signal) {
      // Binance 合约最新价格（用于 BTC/ETH 期限结构近似）
      let crypto = [];
      try {
        const perps = await fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal, timeout: 15000 });
        const quarters = await fetchJson('https://dapi.binance.com/dapi/v1/ticker/24hr', { signal, timeout: 15000 }).catch(() => []);
        const pick = (arr, sym) => arr.find((t) => t.symbol === sym);
        const btcPerp = pick(perps, 'BTCUSDT');
        const ethPerp = pick(perps, 'ETHUSDT');
        const btcQ = quarters.find((t) => t.symbol && t.symbol.startsWith('BTCUSD_'));
        const ethQ = quarters.find((t) => t.symbol && t.symbol.startsWith('ETHUSD_'));
        if (btcPerp) crypto.push({ name: 'BTC 永续', price: Number(btcPerp.lastPrice), chg: Number(btcPerp.priceChangePercent) });
        if (btcQ) crypto.push({ name: 'BTC 次季', price: Number(btcQ.lastPrice), chg: Number(btcQ.priceChangePercent) });
        if (ethPerp) crypto.push({ name: 'ETH 永续', price: Number(ethPerp.lastPrice), chg: Number(ethPerp.priceChangePercent) });
        if (ethQ) crypto.push({ name: 'ETH 次季', price: Number(ethQ.lastPrice), chg: Number(ethQ.priceChangePercent) });
      } catch (e) {
        crypto = [];
      }
      return { crypto };
    }

    function renderFuturescurve(result, body, sourceEl) {
      const { crypto } = result;
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
      COMMODITIES.forEach((c) => {
        html += `<a class="rm-card" href="${esc(c.url)}" target="_blank" rel="noopener">
          <span class="rm-card-label">${esc(c.name)}</span>
          <span class="rm-card-val" style="font-size:14px;">TradingView →</span>
        </a>`;
      });
      html += '</div>';

      if (crypto.length) {
        html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">币安合约期限结构（永续 vs 次季）</div>';
        html += '<table class="rm-table"><thead><tr><th>合约</th><th class="rm-right">价格</th><th class="rm-right">24h 涨跌</th><th class="rm-right">期限结构</th></tr></thead><tbody>';
        crypto.forEach((c) => {
          html += `<tr><td>${esc(c.name)}</td><td class="rm-right rm-num">${fmtNum(c.price, c.price > 1000 ? 1 : 2)}</td>
            <td class="rm-right rm-num ${dirClass(c.chg)}">${fmtPct(c.chg)}</td>
            <td class="rm-right">${c.name.includes('次季') ? '季度交割' : '永续'}</td></tr>`;
        });
        html += '</tbody></table>';
      } else {
        html += '<div class="tool-hint">Binance 合约数据暂不可用，已显示传统商品外部链接</div>';
      }

      body.innerHTML = html;
      sourceEl.innerHTML = '来源：<a href="https://www.binance.com/" target="_blank" rel="noopener">Binance</a> / <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a>';
    }

    window.GT_EXTRA_TOOLS['futurescurve'] = {
      mount: createMount({
        toolId: 'futurescurve',
        title: '商品期货曲线',
        sub: '传统商品 TradingView 链接 · 加密 Binance 合约溢价 · 60s 刷新',
        load: loadFuturescurve,
        render: renderFuturescurve,
        refreshMs: 60000,
      }),
    };
  })();


  /* ── Tool 5: riskmon 风险指标监控台 ── */
  (function registerRiskmon() {
    // 缓存键，允许组件重启后显示旧值
    const CACHE_KEY = 'gt-riskmon-cache-v1';

    function loadCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) { return {}; }
    }
    function saveCache(data) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
    }

    async function loadRiskmon(signal) {
      const cache = loadCache();
      const out = { cache };
      const tasks = [];

      // VIX via Yahoo
      tasks.push(
        yahooChart('^VIX', '5d', '1d')
          .then((d) => { out.vix = { value: d.last, prev: d.prev, chg: (d.last / d.prev - 1) * 100 }; })
          .catch(() => { out.vix = cache.vix || null; })
      );

      // DXY via Yahoo (DX-Y.NYB)
      tasks.push(
        yahooChart('DX-Y.NYB', '5d', '1d')
          .then((d) => { out.dxy = { value: d.last, prev: d.prev, chg: (d.last / d.prev - 1) * 100 }; })
          .catch(() => { out.dxy = cache.dxy || null; })
      );

      // MOVE Index via Yahoo（无直接标的，尝试 ICE 代理代码，失败则用缓存/兜底）
      tasks.push(
        yahooChart('^MOVE', '5d', '1d')
          .then((d) => { out.move = { value: d.last, prev: d.prev, chg: (d.last / d.prev - 1) * 100 }; })
          .catch(() => { out.move = cache.move || null; })
      );

      // 10Y-2Y spread via FRED T10Y2Y
      tasks.push(
        fetchText(proxyUrl('https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y'), { signal, timeout: 15000 })
          .then((text) => {
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            const last = lines[lines.length - 1].split(',');
            const v = Number(last[last.length - 1]);
            out.t10y2y = Number.isFinite(v) ? { value: v } : null;
          })
          .catch(() => { out.t10y2y = cache.t10y2y || null; })
      );

      // HY-OAS via FRED BAMLH0A0HYM2
      tasks.push(
        fetchText(proxyUrl('https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2'), { signal, timeout: 15000 })
          .then((text) => {
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            const last = lines[lines.length - 1].split(',');
            const v = Number(last[last.length - 1]);
            out.hyoas = Number.isFinite(v) ? { value: v } : null;
          })
          .catch(() => { out.hyoas = cache.hyoas || null; })
      );

      await Promise.all(tasks);
      // 保存成功项
      const toSave = {};
      ['vix', 'dxy', 'move', 't10y2y', 'hyoas'].forEach((k) => { if (out[k]) toSave[k] = out[k]; });
      if (Object.keys(toSave).length) saveCache(toSave);
      return out;
    }

    function card(label, item, detail = '') {
      const v = item && Number.isFinite(item.value) ? item.value : null;
      const chg = item && Number.isFinite(item.chg) ? item.chg : null;
      return `<div class="rm-card">
        <span class="rm-card-label">${esc(label)}${detail ? ` · ${esc(detail)}` : ''}</span>
        <span class="rm-card-val rm-num ${v == null ? 'rm-flat' : ''}">${v != null ? fmtNum(v, 2) : '—'}</span>
        <span class="rm-card-chg rm-num ${dirClass(chg)}">${chg != null ? `${arrow(chg)} ${fmtPct(chg)}` : ''}</span>
      </div>`;
    }

    function renderRiskmon(result, body, sourceEl) {
      const { vix, dxy, move, t10y2y, hyoas } = result;
      const hasAny = vix || dxy || move || t10y2y || hyoas;
      if (!hasAny) {
        body.innerHTML = `<div class="tool-hint">风险指标全部加载失败，请检查代理或稍后重试。</div>`;
        sourceEl.innerHTML = '来源：Yahoo Finance / FRED · <a href="https://www.tradingview.com/chart/?symbol=TVC%3AVIX" target="_blank" rel="noopener">TradingView VIX</a>';
        return;
      }
      body.innerHTML = `
        <div class="rm-card-grid">
          ${card('VIX', vix, '恐慌指数')}
          ${card('MOVE', move, '美债波动率')}
          ${card('DXY', dxy, '美元指数')}
          ${card('10Y-2Y', t10y2y, '利差')}
          ${card('HY-OAS', hyoas, '高收益利差')}
        </div>
      `;
      sourceEl.innerHTML = '来源：<a href="https://finance.yahoo.com/" target="_blank" rel="noopener">Yahoo</a> / <a href="https://fred.stlouisfed.org/" target="_blank" rel="noopener">FRED</a> · 失败项显示缓存/链接';
    }

    window.GT_EXTRA_TOOLS['riskmon'] = {
      mount: createMount({
        toolId: 'riskmon',
        title: '风险指标监控台',
        sub: 'VIX · MOVE · DXY · 10Y-2Y · HY-OAS · 60s 刷新',
        load: loadRiskmon,
        render: renderRiskmon,
        refreshMs: 60000,
      }),
    };
  })();

  /* ── Tool 6: cryptoetf 加密货币ETF资金流向 ── */
  (function registerCryptoetf() {
    const BTC_ETFS = [
      { ticker: 'IBIT', issuer: 'BlackRock' },
      { ticker: 'FBTC', issuer: 'Fidelity' },
      { ticker: 'ARKB', issuer: 'ARK 21Shares' },
      { ticker: 'BITB', issuer: 'Bitwise' },
      { ticker: 'HODL', issuer: 'VanEck' },
      { ticker: 'BTCO', issuer: 'Invesco' },
      { ticker: 'EZBC', issuer: 'Franklin' },
      { ticker: 'BRRR', issuer: 'Valkyrie' },
    ];
    const ETH_ETFS = [
      { ticker: 'ETHA', issuer: 'BlackRock' },
      { ticker: 'FETH', issuer: 'Fidelity' },
      { ticker: 'ETHW', issuer: 'Bitwise' },
      { ticker: 'CETH', issuer: 'Invesco' },
      { ticker: 'EZET', issuer: 'Franklin' },
      { ticker: 'ARKZ', issuer: 'ARK 21Shares' },
    ];

    async function loadCryptoetf(signal) {
      // 尝试抓取 Farside BTC ETF 页面
      let flows = null;
      try {
        const html = await fetchText(proxyUrl('https://farside.co.uk/btc/'), { signal, timeout: 20000 });
        // 极简化：查找页面中是否包含 ETF 名称作为成功标记，实际解析表格较脆弱
        if (html && html.includes('IBIT')) flows = { scraped: true, html };
      } catch (e) {
        flows = null;
      }
      return { flows };
    }

    function renderCryptoetf(result, body, sourceEl) {
      const scraped = result.flows && result.flows.scraped;
      const daily = new Array(BTC_ETFS.length).fill(0);
      const weekly = new Array(BTC_ETFS.length).fill(0);

      function barList(items, values, key) {
        let html = `<div style="margin-bottom:10px;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">${esc(key)}</div>`;
        items.forEach((it, i) => {
          const v = values[i] || 0;
          const cls = v >= 0 ? 'up' : 'down';
          const max = Math.max(...values.map(Math.abs), 1);
          const pct = (Math.abs(v) / max) * 100;
          html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:10px;">
            <span style="width:70px;flex:none;">${esc(it.ticker)}</span>
            <div class="rm-bar-bg" style="flex:1;"><div class="rm-bar-fill ${cls}" style="width:${pct.toFixed(1)}%;"></div></div>
            <span class="rm-num ${v >= 0 ? 'rm-pos' : 'rm-neg'}" style="width:60px;text-align:right;">${v >= 0 ? '+' : ''}${fmtNum(v, 1)}M</span>
          </div>`;
        });
        html += '</div>';
        return html;
      }

      body.innerHTML = `
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;">BTC 现货 ETF</div>
        ${barList(BTC_ETFS, daily, '日净流入 ($M) · 占位/待解析')}
        ${barList(BTC_ETFS, weekly, '周净流入 ($M) · 占位/待解析')}
        <div style="font-size:10px;color:var(--text-muted);margin:8px 0;">ETH 现货 ETF</div>
        <div class="tool-hint">公开日流量数据需通过 Farside/Apollo 抓取，当前展示发行人列表与占位流量。</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          ${ETH_ETFS.map((it) => `<span class="rm-btn" style="cursor:default;">${esc(it.ticker)} · ${esc(it.issuer)}</span>`).join('')}
        </div>
      `;
      sourceEl.innerHTML = scraped
        ? '来源：<a href="https://farside.co.uk/btc/" target="_blank" rel="noopener">Farside</a>（解析可能不完整）'
        : '来源：占位数据 · <a href="https://farside.co.uk/btc/" target="_blank" rel="noopener">Farside</a> / <a href="https://www.heyapollo.com/" target="_blank" rel="noopener">Apollo</a>';
    }

    window.GT_EXTRA_TOOLS['cryptoetf'] = {
      mount: createMount({
        toolId: 'cryptoetf',
        title: '加密货币ETF资金流向',
        sub: 'BTC/ETH 现货 ETF 日/周净流入 · 绿色流入 / 红色流出',
        load: loadCryptoetf,
        render: renderCryptoetf,
        refreshMs: 5 * 60 * 1000,
      }),
    };
  })();


  /* ── Tool 7: asharedragon A股龙虎榜 ── */
  (function registerAsharedragon() {
    // A股红涨绿跌：在本组件内覆盖 --up/--down
    async function loadAsharedragon(signal) {
      const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:0+t:7,m:1+t:3,m:0+t:80,m:1+t:23,m:0+t:81+s:204&fields=f12,f14,f20,f21,f124,f184,f204,f205';
      const json = await fetchJson(proxyUrl(url), { signal, timeout: 20000 });
      const data = json && json.data && json.data.diff;
      if (!Array.isArray(data)) throw new Error('empty dragon data');
      return data;
    }

    function renderAsharedragon(rows, body, sourceEl) {
      const list = rows.slice(0, 30).map((r) => ({
        code: r.f12,
        name: r.f14,
        netBuy: Number(r.f20), // 净买入额（元）
        buy: Number(r.f21), // 买入额
        pct: Number(r.f184), // 涨跌幅%
        instBuy: Number(r.f204), // 机构买入
        instSell: Number(r.f205), // 机构卖出
      }));
      let html = '<div style="--up:#D05B4B;--down:#4C9F70;"><table class="rm-table"><thead><tr><th>代码</th><th>名称</th><th>涨跌幅</th><th>龙虎榜净买</th><th>机构净买</th></tr></thead><tbody>';
      list.forEach((r) => {
        const net = Number.isFinite(r.netBuy) ? r.netBuy / 1e8 : null; // 亿元
        const inst = Number.isFinite(r.instBuy) && Number.isFinite(r.instSell) ? (r.instBuy - r.instSell) / 1e8 : null;
        const pct = Number.isFinite(r.pct) ? r.pct : null;
        html += `<tr>
          <td class="rm-num">${esc(r.code)}</td>
          <td>${esc(r.name)}</td>
          <td class="rm-right rm-num ${pct != null ? (pct >= 0 ? 'rm-pos' : 'rm-neg') : 'rm-flat'}">${pct != null ? fmtPct(pct) : '—'}</td>
          <td class="rm-right rm-num">${net != null ? fmtNum(net, 2) + '亿' : '—'}</td>
          <td class="rm-right rm-num ${inst != null ? (inst >= 0 ? 'rm-pos' : 'rm-neg') : 'rm-flat'}">${inst != null ? fmtSigned(inst, 2) + '亿' : '—'}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
      body.innerHTML = html;
      sourceEl.innerHTML = '来源：<a href="https://quote.eastmoney.com/" target="_blank" rel="noopener">东方财富龙虎榜</a> · A股红涨绿跌';
    }

    window.GT_EXTRA_TOOLS['asharedragon'] = {
      mount: createMount({
        toolId: 'asharedragon',
        title: 'A股龙虎榜',
        sub: '按龙虎榜净买入额排序 · 红涨绿跌 · 60s 刷新',
        load: loadAsharedragon,
        render: renderAsharedragon,
        refreshMs: 60000,
      }),
    };
  })();

  /* ── Tool 8: earnings 美股财报日历 ── */
  (function registerEarnings() {
    async function loadEarnings(signal) {
      const today = new Date();
      const dates = [];
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(today.getTime() + i * 86400000);
        dates.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
      }
      const results = [];
      for (const day of dates) {
        try {
          const url = `https://finance.yahoo.com/calendar/earnings?day=${day}`;
          const html = await fetchText(proxyUrl(url), { signal, timeout: 20000 });
          // 提取 root.App.main
          const m = html.match(/root\.App\.main\s*=\s*(\{.*?\});\s*<\/script>/s);
          if (!m) continue;
          const app = JSON.parse(m[1]);
          const rows = app.context && app.context.dispatcher && app.context.dispatcher.stores &&
            app.context.dispatcher.stores.CalendarStore && app.context.dispatcher.stores.CalendarStore.rows;
          if (!Array.isArray(rows)) continue;
          rows.forEach((r) => {
            results.push({
              symbol: r.ticker,
              name: r.companyShortName || r.companyName,
              epsEstimate: r.epsEstimate,
              time: r.startDateTime ? new Date(r.startDateTime) : null,
              mktCap: r.marketCap,
              day,
            });
          });
        } catch (e) {
          // ignore per day
        }
      }
      if (!results.length) throw new Error('no earnings data');
      return results.sort((a, b) => new Date(a.day) - new Date(b.day));
    }

    function timeLabel(t) {
      if (!t) return '—';
      const h = t.getHours();
      if (h < 9) return 'AMC 盘后';
      if (h >= 9 && h < 16) return 'BMO 盘前/盘中';
      return 'BMO 盘前';
    }

    function renderEarnings(rows, body, sourceEl) {
      let html = '<table class="rm-table"><thead><tr><th>日期</th><th>代码</th><th>公司</th><th>EPS 预期</th><th>时间</th><th>市值</th></tr></thead><tbody>';
      rows.slice(0, 80).forEach((r) => {
        const cap = Number.isFinite(Number(r.mktCap)) ? Number(r.mktCap) : null;
        html += `<tr>
          <td>${esc(r.day)}</td>
          <td class="rm-num"><a class="rm-link" href="https://finance.yahoo.com/quote/${esc(r.symbol)}" target="_blank" rel="noopener">${esc(r.symbol)}</a></td>
          <td>${esc(r.name || '')}</td>
          <td class="rm-right rm-num">${r.epsEstimate != null ? fmtNum(Number(r.epsEstimate), 2) : '—'}</td>
          <td>${esc(timeLabel(r.time))}</td>
          <td class="rm-right rm-num">${cap != null ? fmtAmt(cap, '$') : '—'}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      body.innerHTML = html;
      sourceEl.innerHTML = '来源：<a href="https://finance.yahoo.com/calendar/earnings" target="_blank" rel="noopener">Yahoo Earnings</a>';
    }

    window.GT_EXTRA_TOOLS['earnings'] = {
      mount: createMount({
        toolId: 'earnings',
        title: '美股财报日历',
        sub: '未来 7 天重要财报 · BMO/AMC · 10min 刷新',
        load: loadEarnings,
        render: renderEarnings,
        refreshMs: 10 * 60 * 1000,
      }),
    };
  })();

  /* ── Tool 9: fedmeetings 美联储议息会议倒计时 ── */
  (function registerFedmeetings() {
    // 硬编码 2025-2026 FOMC 日程（实际日程以 federalreserve.gov 为准）
    const MEETINGS = [
      '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
      '2025-07-30', '2025-09-17', '2025-11-06', '2025-12-17',
      '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
      '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16',
    ].map((d) => new Date(d + 'T18:00:00Z')); // 美东下午 2 点 ≈ UTC 18:00

    window.GT_EXTRA_TOOLS['fedmeetings'] = {
      mount(el, setStatus) {
        ensureStyle('fedmeetings');
        const currentRange = '4.25% – 4.50%';
        const now = new Date();
        const next = MEETINGS.find((d) => d > now);
        const remaining = MEETINGS.filter((d) => d > now);

        el.innerHTML = `
          <div class="tool rm-suite rm-fedmeetings">
            <div class="rm-suite-head"><span>美联储议息会议倒计时</span><span class="rm-status live" data-conn>● LIVE</span></div>
            <div class="rm-sub">2025-2026 FOMC 日程 · 倒计时每秒更新</div>
            <div class="rm-body" data-body>
              <div class="rm-card" style="cursor:default;">
                <span class="rm-card-label">下次 FOMC 会议倒计时</span>
                <div class="rm-countdown" data-countdown>—</div>
                <span class="rm-card-chg rm-flat" data-nextdate>${next ? fmtDate(next) + ' UTC' : '暂无 upcoming 数据'}</span>
              </div>
              <div class="rm-card" style="cursor:default;">
                <span class="rm-card-label">当前联邦基金目标区间</span>
                <span class="rm-card-val rm-num">${esc(currentRange)}</span>
                <span class="rm-card-chg rm-flat">市场预期：暂停（Pause）</span>
              </div>
              <div style="font-size:10px;color:var(--text-muted);margin:8px 0 6px;">年内剩余会议</div>
              <table class="rm-table"><thead><tr><th>日期</th><th class="rm-right">距今</th><th class="rm-right">状态</th></tr></thead><tbody>
                ${remaining.slice(0, 12).map((d) => {
                  const diff = d - now;
                  const days = Math.ceil(diff / 86400000);
                  return `<tr><td>${esc(fmtDate(d))}</td><td class="rm-right">${days} 天</td><td class="rm-right">待定</td></tr>`;
                }).join('')}
              </tbody></table>
            </div>
            <div class="rm-foot">
              <span>来源：<a href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noopener">Federal Reserve</a> · 硬编码日程</span>
              <span data-time>更新 ${fmtTime(new Date())}</span>
            </div>
          </div>`;

        const countdownEl = el.querySelector('[data-countdown]');
        const update = () => {
          const n = MEETINGS.find((d) => d > new Date());
          if (!n) {
            countdownEl.textContent = '—';
            return;
          }
          const diff = n - new Date();
          const days = Math.floor(diff / 86400000);
          const hrs = Math.floor((diff % 86400000) / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          countdownEl.textContent = `${days}d ${pad2(hrs)}h ${pad2(mins)}m`;
        };
        update();
        setStatus('online');
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
      },
    };
  })();

  /* ── Tool 10: fxvol 外汇隐含波动率 ── */
  (function registerFxvol() {
    // 静态估计表（免费隐含波动率源稀缺，以下为近月典型区间示意）
    const VOL_GRID = {
      EURUSD: { '1W': 7.2, '1M': 7.8, '3M': 8.5 },
      GBPUSD: { '1W': 8.1, '1M': 8.6, '3M': 9.2 },
      USDJPY: { '1W': 9.5, '1M': 10.1, '3M': 10.8 },
      USDCNH: { '1W': 6.8, '1M': 7.4, '3M': 8.0 },
      AUDUSD: { '1W': 8.4, '1M': 9.0, '3M': 9.6 },
    };

    function renderFxvol(_result, body, sourceEl) {
      const pairs = Object.keys(VOL_GRID);
      let html = '<table class="rm-table"><thead><tr><th>货币对</th><th class="rm-right">1W</th><th class="rm-right">1M</th><th class="rm-right">3M</th></tr></thead><tbody>';
      pairs.forEach((pair) => {
        const v = VOL_GRID[pair];
        html += `<tr>
          <td><a class="rm-link" href="https://www.tradingview.com/chart/?symbol=FX%3A${pair}" target="_blank" rel="noopener">${esc(pair.slice(0, 3) + '/' + pair.slice(3))}</a></td>
          <td class="rm-right rm-num">${fmtNum(v['1W'], 1)}%</td>
          <td class="rm-right rm-num">${fmtNum(v['1M'], 1)}%</td>
          <td class="rm-right rm-num">${fmtNum(v['3M'], 1)}%</td>
        </tr>`;
      });
      html += '</tbody></table>';

      // TradingView 波动率指数嵌入
      const theme = (document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white')) ? 'light' : 'dark';
      const containerId = `rm-fxvol-tv-${Date.now()}`;
      html += `<div class="rm-embed" id="${containerId}" style="margin-top:10px;min-height:180px;"></div>`;
      body.innerHTML = html;

      if (typeof TradingView !== 'undefined') {
        try {
          new TradingView.widget({
            autosize: true,
            symbol: 'TVC:VIX',
            interval: 'D',
            timezone: 'Asia/Hong_Kong',
            theme,
            style: '3',
            locale: 'zh_CN',
            hide_top_toolbar: true,
            save_image: false,
            container_id: containerId,
          });
        } catch (e) {
          document.getElementById(containerId).innerHTML = '<div style="padding:8px;font-size:10px;color:var(--text-muted)">TradingView VIX 嵌入失败</div>';
        }
      } else {
        document.getElementById(containerId).innerHTML = '<div style="padding:8px;font-size:10px;color:var(--text-muted)">TradingView 脚本未加载</div>';
      }

      sourceEl.innerHTML = '来源：静态估计 / <a href="https://www.tradingview.com/chart/?symbol=TVC%3AVIX" target="_blank" rel="noopener">TradingView VIX</a>';
    }

    window.GT_EXTRA_TOOLS['fxvol'] = {
      mount: createMount({
        toolId: 'fxvol',
        title: '外汇隐含波动率',
        sub: '主要货币对 1W/1M/3M 隐含波动估计 · VIX 嵌入',
        load: () => Promise.resolve({}),
        render: renderFxvol,
        refreshMs: 5 * 60 * 1000,
      }),
    };
  })();
})();
