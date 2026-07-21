/* 全球市场热力图 — 按区域/国家分组的世界股指热力图
 * 主源: 东财全球指数行情 https://push2.eastmoney.com/api/qt/ulist.np/get
 *       （失败时回退 push2delay.eastmoney.com 延时行情）
 * 兜底: 东财两 host 均失败时，嵌入 TradingView market-overview-widget。
 *       东财覆盖不全的市场（印度 Nifty50、中东、南非、俄罗斯 MOEX 等）
 *       以 TradingView 代码标记，点击 TV 徽章打开图表；整体失败时启用
 *       TradingView 市场概览兜底。
 * 配色: 国际习惯绿涨红跌，tile 颜色映射 var(--up)/var(--down)。
 * Registers as custom tool id 'worldheat' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 区域分组与指数（2026-07 实测可用代码）
  // - 东财有效：中国、香港、日本、韩国、澳洲、欧美主要指数、印度 SENSEX、俄罗斯 RTS
  // - 东财缺失/失效：印度 Nifty50、沙特 TASI、迪拜 DFMGI、卡塔尔 QE General Index、南非 JSE、俄罗斯 MOEX
  //   这些项目使用 tv 字段保存 TradingView 代码，secid 留空，不在东财请求里发送。
  // - 俄罗斯 MOEX 因制裁在 TradingView scanner 无数据，经莫斯科交易所 ISS API 兜底。
  const REGIONS = [
    {
      name: '亚太',
      weight: 0.30,
      src: '东方财富',
      items: [
        { secid: '1.000001', code: '000001', name: '上证', weight: 0.10 },
        { secid: '0.399001', code: '399001', name: '深证', weight: 0.06 },
        { secid: '0.399006', code: '399006', name: '创业板', weight: 0.05 },
        { secid: '100.HSI', code: 'HSI', name: '恒生', weight: 0.05 },
        { secid: '100.N225', code: 'N225', name: '日经225', weight: 0.04 },
        { secid: '100.KS11', code: 'KS11', name: '韩国KOSPI', weight: 0.02 },
        { secid: '100.AS51', code: 'AS51', name: '澳洲标普200', weight: 0.01 },
      ],
    },
    {
      name: '南亚',
      weight: 0.08,
      src: '东方财富 / TradingView',
      items: [
        { secid: '100.SENSEX', code: 'SENSEX', name: '印度SENSEX', weight: 0.04 },
        { code: 'NIFTY', name: '印度Nifty50', weight: 0.03, tv: 'NSE:NIFTY', tvOnly: true },
        { secid: '100.KSE100', code: 'KSE100', name: '巴基斯坦KSE100', weight: 0.01, tv: 'KSE:KSE100' },
      ],
    },
    {
      name: '欧洲',
      weight: 0.20,
      src: '东方财富',
      items: [
        { secid: '100.FTSE', code: 'FTSE', name: '英国富时100', weight: 0.04 },
        { secid: '100.GDAXI', code: 'GDAXI', name: '德国DAX', weight: 0.05 },
        { secid: '100.FCHI', code: 'FCHI', name: '法国CAC40', weight: 0.04 },
        { secid: '100.SX5E', code: 'SX5E', name: '斯托克50', weight: 0.04, tv: 'INDEX:SX5E' },
        { secid: '100.SSMI', code: 'SSMI', name: '瑞士SMI', weight: 0.02, tv: 'INDEX:SMI' },
        { secid: '100.AEX', code: 'AEX', name: '荷兰AEX', weight: 0.01, tv: 'INDEX:AEX' },
      ],
    },
    {
      name: '美洲',
      weight: 0.30,
      src: '东方财富',
      items: [
        { secid: '100.SPX', code: 'SPX', name: '标普500', weight: 0.12 },
        { secid: '100.NDX', code: 'NDX', name: '纳斯达克', weight: 0.10 },
        { secid: '100.DJIA', code: 'DJIA', name: '道琼斯', weight: 0.05, tv: 'INDEX:DJI' },
        { secid: '100.BVSP', code: 'BVSP', name: '巴西Bovespa', weight: 0.02, tv: 'BMFBOVESPA:IBOV' },
        { secid: '100.MXX', code: 'MXX', name: '墨西哥IPC', weight: 0.01, tv: 'BMV:ME' },
      ],
    },
    {
      name: '中东',
      weight: 0.05,
      src: 'TradingView',
      items: [
        { code: 'TASI', name: '沙特Tadawul', weight: 0.03, tv: 'TADAWUL:TASI', tvOnly: true },
        { code: 'DFMGI', name: '迪拜DFM', weight: 0.01, tv: 'DFM:DFMGI', tvOnly: true },
        { code: 'GNRI', name: '卡塔尔QE', weight: 0.01, tv: 'QSE:GNRI', tvOnly: true },
      ],
    },
    {
      name: '东南亚',
      weight: 0.07,
      src: '东方财富 / TradingView',
      items: [
        { secid: '100.SET', code: 'SET', name: '泰国SET', weight: 0.02, tv: 'SET:SET' },
        { secid: '100.KLSE', code: 'KLSE', name: '马来西亚KLSE', weight: 0.02, tv: 'MYX:FBMKLCI' },
        { secid: '100.JKSE', code: 'JKSE', name: '印尼IDX', weight: 0.02, tv: 'IDX:COMPOSITE' },
        { secid: '100.PSEI', code: 'PSEI', name: '菲律宾PSEi', weight: 0.01, tv: 'PSE:PSEI' },
        { secid: '100.VNINDEX', code: 'VNINDEX', name: '越南VN', weight: 0.01, tv: 'HOSE:VNINDEX' },
      ],
    },
    {
      name: '非洲 / 俄罗斯',
      weight: 0.07,
      src: '东方财富 / TradingView',
      items: [
        { code: 'J200', name: '南非JSE Top40', weight: 0.02, tv: 'JSE:J200', tvOnly: true },
        { code: 'IMOEX', name: '俄罗斯MOEX', weight: 0.02, tv: 'MOEX:IMOEX', tvOnly: true },
        { secid: '100.RTS', code: 'RTS', name: '俄罗斯RTS', weight: 0.03 },
      ],
    },
  ];

  const ALL = REGIONS.reduce((acc, r) => acc.concat(r.items), []);
  const EM_ITEMS = ALL.filter((i) => i.secid);
  const EM_SECIDS = EM_ITEMS.map((i) => i.secid).filter((v, i, a) => a.indexOf(v) === i);

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com'];
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f4';
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${EM_FIELDS}&secids=${EM_SECIDS.join(',')}`;

  const TV_ITEMS = ALL.filter((i) => i.tv);
  const tvSymbolUrl = (symbol) =>
    `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const tvProxy = (url) => `/api/proxy?url=${encodeURIComponent(url)}`;

  // 莫斯科交易所 ISS API 兜底（俄罗斯 MOEX 受制裁，TV scanner 无数据）
  const MOEX_ISS_URL =
    'https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json';
  async function fetchMoexFallback() {
    try {
      const resp = await fetch(tvProxy(MOEX_ISS_URL), { cache: 'no-store' });
      if (!resp.ok) return null;
      const json = await resp.json();
      const cols = json && json.marketdata && json.marketdata.columns;
      const row = json && json.marketdata && Array.isArray(json.marketdata.data) && json.marketdata.data[0];
      if (!cols || !row) return null;
      const current = row[cols.indexOf('CURRENTVALUE')];
      const change = row[cols.indexOf('LASTCHANGE')];
      const pct = row[cols.indexOf('LASTCHANGEPRC')];
      if (!Number.isFinite(Number(current))) return null;
      return { close: Number(current), change_abs: Number(change), change: Number(pct), volume: null, source: 'MOEX ISS' };
    } catch (e) {
      return null;
    }
  }

  const REFRESH_MS = 60000;
  const IDLE_REFRESH_MS = 5 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('worldheat-style')) return;
    const style = document.createElement('style');
    style.id = 'worldheat-style';
    style.textContent = `
.wh-root { display: flex; flex-direction: column; height: 100%; }
.wh-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.wh-head-right { display: flex; align-items: center; gap: 8px; }
.wh-status { color: var(--warning); white-space: nowrap; }
.wh-status.live { color: var(--acc); }
.wh-sub {
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.wh-delayed {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--warning);
  color: var(--warning);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.wh-body { flex: 1; overflow-y: auto; overflow-x: hidden; }
.wh-region { margin-bottom: 6px; }
.wh-region-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
  align-items: baseline;
}
.wh-region-title b { font-weight: 400; font-family: var(--font-mono); color: var(--text-dim); margin-left: auto; }
.wh-region-src {
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 0.05em;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: help;
}
.wh-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.wh-tile {
  position: relative;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  min-width: 56px;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform 0.15s var(--ease-snap), box-shadow 0.2s var(--ease-fluid);
  overflow: hidden;
  text-decoration: none;
}
.wh-tile:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.25); z-index: 2; }
.wh-tile-name {
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wh-tile-code {
  font-size: 8px;
  color: rgba(255,255,255,0.78);
  font-family: var(--font-mono);
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.wh-tile-pct {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  text-align: right;
  white-space: nowrap;
}
.wh-tile-tv {
  position: absolute;
  top: 3px;
  right: 3px;
  font-size: 7px;
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  color: rgba(255,255,255,0.9);
  background: rgba(0,0,0,0.25);
  padding: 1px 4px;
  border-radius: 3px;
  pointer-events: none;
}
.wh-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
  padding: 16px;
}
.wh-fallback {
  display: none;
  height: 100%;
  border-radius: var(--radius-inner);
  overflow: hidden;
  border: 1px solid var(--hairline);
}
.wh-fallback.active { display: block; }
.wh-fallback iframe { width: 100%; height: 100%; border: none; }
.wh-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 6px;
}
.wh-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
.wh-hint { margin-top: 6px; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  // 颜色插值：pct 从 -3% 到 +3% 映射为红→ neutral →绿
  const tileColor = (pct) => {
    if (!Number.isFinite(pct)) return 'var(--surface-raised)';
    const up = getComputedStyle(document.documentElement).getPropertyValue('--up').trim() || '#4C9F70';
    const down = getComputedStyle(document.documentElement).getPropertyValue('--down').trim() || '#D05B4B';
    const max = 3;
    const t = Math.max(-max, Math.min(max, pct)) / max; // -1 .. 1
    if (t === 0) return 'var(--surface-raised)';
    const target = t > 0 ? up : down;
    const opacity = 0.35 + Math.abs(t) * 0.45; // 0.35 .. 0.80
    return `color-mix(in srgb, ${target} ${Math.round(opacity * 100)}%, var(--surface-raised))`;
  };

  const quoteUrl = (secid) => `https://quote.eastmoney.com/unify/r/${encodeURIComponent(secid)}`;
  const tvChartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const tileFlexBasis = (regionWeight, itemWeight) => {
    const share = (itemWeight / regionWeight) * 100;
    return Math.max(12, Math.min(48, share));
  };

  const isIdle = () => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  };

  // TradingView market-overview 兜底配置：按区域分组，包含东财失效市场的 TV 代码
  const tvMarketOverviewUrl = () => {
    const theme = (document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white')) ? 'light' : 'dark';
    const tabs = [
      {
        title: '亚太',
        symbols: [
          { s: 'SSE:000001', d: '上证指数' },
          { s: 'SZSE:399001', d: '深证成指' },
          { s: 'SZSE:399006', d: '创业板指' },
          { s: 'INDEX:HSI', d: '恒生指数' },
          { s: 'INDEX:N225', d: '日经225' },
          { s: 'INDEX:KS11', d: '韩国KOSPI' },
          { s: 'INDEX:AS51', d: '澳洲标普200' },
        ],
      },
      {
        title: '南亚',
        symbols: [
          { s: 'BSE:SENSEX', d: '印度SENSEX' },
          { s: 'NSE:NIFTY', d: '印度Nifty50' },
          { s: 'KSE:KSE100', d: '巴基斯坦KSE100' },
        ],
      },
      {
        title: '欧洲',
        symbols: [
          { s: 'INDEX:FTSE', d: '英国富时100' },
          { s: 'INDEX:GDAXI', d: '德国DAX' },
          { s: 'INDEX:FCHI', d: '法国CAC40' },
          { s: 'INDEX:SX5E', d: '斯托克50' },
          { s: 'INDEX:SMI', d: '瑞士SMI' },
          { s: 'INDEX:AEX', d: '荷兰AEX' },
        ],
      },
      {
        title: '美洲',
        symbols: [
          { s: 'INDEX:SPX', d: '标普500' },
          { s: 'INDEX:NDX', d: '纳斯达克' },
          { s: 'INDEX:DJI', d: '道琼斯' },
          { s: 'BMFBOVESPA:IBOV', d: '巴西Bovespa' },
          { s: 'BMV:ME', d: '墨西哥IPC' },
        ],
      },
      {
        title: '中东',
        symbols: [
          { s: 'TADAWUL:TASI', d: '沙特Tadawul' },
          { s: 'DFM:DFMGI', d: '迪拜DFM' },
          { s: 'QSE:GNRI', d: '卡塔尔QE' },
        ],
      },
      {
        title: '东南亚',
        symbols: [
          { s: 'SET:SET', d: '泰国SET' },
          { s: 'MYX:FBMKLCI', d: '马来西亚KLSE' },
          { s: 'IDX:COMPOSITE', d: '印尼IDX' },
          { s: 'PSE:PSEI', d: '菲律宾PSEi' },
          { s: 'HOSE:VNINDEX', d: '越南VN' },
        ],
      },
      {
        title: '非洲 / 俄罗斯',
        symbols: [
          { s: 'JSE:J200', d: '南非JSE Top40' },
          { s: 'MOEX:IMOEX', d: '俄罗斯MOEX' },
          { s: 'INDEX:RTS', d: '俄罗斯RTS' },
        ],
      },
    ];
    return `https://www.tradingview-widget.com/embed-widget/market-overview/?locale=zh_CN&colorTheme=${theme}&dateRange=1D&showChart=true&showSymbolLogo=true&isTransparent=false&tabs=${encodeURIComponent(JSON.stringify(tabs))}`;
  };

  window.GT_EXTRA_TOOLS['worldheat'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool wh-root">
          <div class="wh-head">
            <span>全球市场 · 区域热力图</span>
            <span class="wh-head-right">
              <span class="wh-status" data-conn>连接中…</span>
              <span class="wh-delayed" data-delayed style="display:none">延时</span>
            </span>
          </div>
          <div class="wh-sub">按区域分组的世界主要股指 · 颜色越深涨跌幅度越大 · 缺失数据以 TV 代码兜底 · 60s 刷新</div>
          <div class="wh-body" data-body></div>
          <div class="wh-fallback" data-fallback>
            <iframe data-fallback-frame allowtransparency="true" scrolling="no"></iframe>
          </div>
          <div class="wh-foot">
            <span data-src>来源：东方财富 / TradingView</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint wh-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const delayedEl = el.querySelector('[data-delayed]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const bodyEl = el.querySelector('[data-body]');
      const fallbackEl = el.querySelector('[data-fallback]');
      const fallbackFrame = el.querySelector('[data-fallback-frame]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let useFallback = false;
      const pendingTimers = new Set();
      const pendingAborts = new Set();

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'wh-status';
        setStatus('offline');
      };
      const clearError = (delayed) => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'wh-status live';
        delayedEl.style.display = delayed ? '' : 'none';
        srcEl.textContent = delayed ? '来源：东方财富（延时行情）/ TradingView' : '来源：东方财富 / TradingView';
        setStatus('online');
      };

      const loadFallback = () => {
        if (useFallback) return;
        useFallback = true;
        bodyEl.style.display = 'none';
        fallbackEl.classList.add('active');
        srcEl.textContent = '来源：TradingView（行情兜底）';
        fallbackFrame.src = tvMarketOverviewUrl();
      };

      const fetchQuotes = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          if (!EM_SECIDS.length) throw new Error('no eastmoney symbols');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i]), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('quotes error');
      };

      // 对 tvOnly / tv 兜底项目拉取 TradingView scanner（经本地代理）
      const fetchTVQuotes = async () => {
        const out = {};
        await Promise.all(
          TV_ITEMS.map(async (it) => {
            try {
              const resp = await fetch(tvProxy(tvSymbolUrl(it.tv)), { cache: 'no-store' });
              if (!resp.ok) return;
              const json = await resp.json();
              if (json && Number.isFinite(Number(json.change))) {
                out[it.tv] = json;
              }
            } catch (e) { /* ignore single symbol failure */ }
          })
        );
        // 俄罗斯 MOEX 经莫斯科交易所 ISS API 兜底
        const moex = await fetchMoexFallback();
        if (moex) out['MOEX:IMOEX'] = moex;
        return out;
      };

      const render = (emResult, tvResult) => {
        const bySecid = {};
        (emResult?.rows || []).forEach((r) => {
          if (r && r.f12 != null && r.f13 != null) bySecid[`${r.f13}.${r.f12}`] = r;
        });
        const tvByTv = tvResult || {};

        bodyEl.style.display = '';
        fallbackEl.classList.remove('active');
        useFallback = false;

        bodyEl.innerHTML = REGIONS.map((region) => {
          let validCount = 0;
          let weightedSum = 0;

          const tiles = region.items.map((it) => {
            let pct = NaN;
            let name = it.name;
            let source = region.src;
            if (it.secid && bySecid[it.secid]) {
              const r = bySecid[it.secid];
              pct = Number(r.f3);
              if (r.f14) name = String(r.f14);
              source = '东方财富';
            } else if (it.tv && tvByTv[it.tv]) {
              pct = Number(tvByTv[it.tv].change);
              source = 'TradingView';
            }
            const hasData = Number.isFinite(pct);
            const cls = !hasData || pct === 0 ? 'wh-flat' : (pct > 0 ? 'wh-up' : 'wh-down');
            const basis = tileFlexBasis(region.weight, it.weight);
            const href = it.tv ? tvChartUrl(it.tv) : (it.secid ? quoteUrl(it.secid) : '#');
            const tvBadge = it.tv ? `<span class="wh-tile-tv">TV</span>` : '';
            if (hasData) {
              validCount += 1;
              weightedSum += pct * it.weight;
            }
            return `
              <a class="wh-tile ${cls}" href="${esc(href)}" target="_blank" rel="noopener"
                 style="flex:${it.weight * 100} 1 ${basis}%; background:${tileColor(pct)}"
                 title="${esc(name)} ${esc(it.code)}${it.tv ? ' · ' + esc(it.tv) : ''} ${hasData ? fmtSigned(pct, 2) + '%' : '—'} · 来源：${esc(source)}">
                ${tvBadge}
                <div>
                  <div class="wh-tile-name">${esc(name)}</div>
                  <div class="wh-tile-code">${esc(it.code)}</div>
                </div>
                <div class="wh-tile-pct">${hasData ? esc(fmtSigned(pct, 2)) + '%' : '—'}</div>
              </a>`;
          }).join('');

          const regionPct = validCount > 0 ? weightedSum / region.weight : NaN;

          return `
            <div class="wh-region">
              <div class="wh-region-title">
                <span>${esc(region.name)}</span>
                <span class="wh-region-src" title="数据来源：${esc(region.src)}">${esc(region.src)}</span>
                <b>${Number.isFinite(regionPct) ? fmtSigned(regionPct, 2) + '%' : '—'}</b>
              </div>
              <div class="wh-row">${tiles}</div>
            </div>`;
        }).join('');

        timeEl.textContent = new Date().toTimeString().slice(0, 8);
      };

      const renderNoData = () => {
        bodyEl.style.display = '';
        fallbackEl.classList.remove('active');
        useFallback = false;
        bodyEl.innerHTML = REGIONS.map((region) => {
          const tiles = region.items.map((it) => {
            const basis = tileFlexBasis(region.weight, it.weight);
            const href = it.tv ? tvChartUrl(it.tv) : (it.secid ? quoteUrl(it.secid) : '#');
            const tvBadge = it.tv ? `<span class="wh-tile-tv">TV</span>` : '';
            return `
              <a class="wh-tile wh-flat" href="${esc(href)}" target="_blank" rel="noopener"
                 style="flex:${it.weight * 100} 1 ${basis}%; background:var(--surface-raised)"
                 title="${esc(it.name)} ${esc(it.code)}${it.tv ? ' · ' + esc(it.tv) : ''} — · 来源：${esc(region.src)}">
                ${tvBadge}
                <div>
                  <div class="wh-tile-name">${esc(it.name)}</div>
                  <div class="wh-tile-code">${esc(it.code)}</div>
                </div>
                <div class="wh-tile-pct">—</div>
              </a>`;
          }).join('');
          return `
            <div class="wh-region">
              <div class="wh-region-title">
                <span>${esc(region.name)}</span>
                <span class="wh-region-src" title="数据来源：${esc(region.src)}">${esc(region.src)}</span>
                <b>—</b>
              </div>
              <div class="wh-row">${tiles}</div>
            </div>`;
        }).join('');
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [emResult, tvResult] = await Promise.all([
            EM_SECIDS.length ? fetchQuotes().catch(() => null) : Promise.resolve(null),
            TV_ITEMS.length ? fetchTVQuotes().catch(() => ({})) : Promise.resolve({}),
          ]);
          if (!alive) return;
          if (emResult && emResult.rows && emResult.rows.length) {
            render(emResult, tvResult);
            clearError(emResult.delayed);
          } else if (Object.keys(tvResult).length) {
            render(null, tvResult);
            clearError(false);
          } else {
            renderNoData();
            loadFallback();
            showError('行情源暂不可用，已切换 TradingView 市场概览兜底。');
          }
        } catch (e) {
          if (!alive) return;
          loadFallback();
          showError('行情失败，已切换 TradingView 市场概览兜底。');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return;
        if (!isIdle() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
      refresh();
      tickTimer = setInterval(tick, REFRESH_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        pendingAborts.forEach((c) => {
          try {
            c.abort();
          } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
      };
    },
  };
})();
