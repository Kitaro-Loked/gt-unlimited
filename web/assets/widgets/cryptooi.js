/* 合约持仓量(OI)监控 — 币安 U 本位永续 (fapi.binance.com, CORS: Access-Control-Allow-Origin: *)
 * OI:  GET /futures/data/openInterestHist?symbol=<SYM>&period=1h&limit=3 （逐币种并发，取最新一条
 *      sumOpenInterestValue 为当前 OI 美元名义值，与最早一条对比算 OI 变化%；字段名已 curl 实测 2026-07）
 * 价格: GET /fapi/v1/ticker/24hr?symbols=<JSON数组> 取 priceChangePercent
 *      （实测该端点会忽略 symbols 过滤返回全量列表，故客户端按白名单过滤，参数保留以兼容真实 API）
 * 配色: 加密货币绿涨红跌，方向着色用 var(--up)/var(--down) 语义令牌。
 * Registers as custom tool id 'cryptooi' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
    'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'LTCUSDT',
  ];
  const FAPI = 'https://fapi.binance.com';
  const oiUrl = (sym) => `${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=3`;
  const TICKER_URL = `${FAPI}/fapi/v1/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(SYMBOLS))}`;
  const detailUrl = (sym) => `https://www.binance.com/zh-CN/futures/${sym}`;

  const REFRESH_MS = 60000; // 加密市场 7×24 无休市，固定 60s
  const FETCH_TIMEOUT_MS = 10000;
  const MAX_ATTEMPTS = 2; // 每次请求失败重试 1 次

  function injectStyle() {
    if (document.getElementById('cryptooi-style')) return;
    const style = document.createElement('style');
    style.id = 'cryptooi-style';
    style.textContent = `
.cryptooi-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.cryptooi-status { color: var(--warning); white-space: nowrap; }
.cryptooi-status.live { color: var(--acc); }
.cryptooi-sub {
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.cryptooi-table { font-variant-numeric: tabular-nums; }
.cryptooi-table th, .cryptooi-table td { white-space: nowrap; }
.cryptooi-table th.cryptooi-r, .cryptooi-table td.cryptooi-r { text-align: right; }
.cryptooi-table tbody tr { cursor: pointer; transition: background 0.12s var(--ease-snap); }
.cryptooi-table tbody tr:hover { background: var(--surface-raised); }
.cryptooi-rank { color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; }
.cryptooi-sym { font-weight: 600; }
.cryptooi-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.cryptooi-num { font-family: var(--font-mono); }
/* 加密货币绿涨红跌：var(--up)=涨、var(--down)=跌 */
.cryptooi-up { color: var(--up); }
.cryptooi-down { color: var(--down); }
.cryptooi-flat { color: var(--text-muted); }
.cryptooi-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cryptooi-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.cryptooi-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtSignedPct = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${fmtNum(v, 2)}%`;
  };

  // OI 美元名义值 → 亿美元
  const fmtOi = (usd) => {
    if (!Number.isFinite(usd)) return '—';
    return fmtNum(usd / 1e8, 2);
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'cryptooi-flat';
    return v > 0 ? 'cryptooi-up' : 'cryptooi-down';
  };

  window.GT_EXTRA_TOOLS['cryptooi'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cryptooi-root">
          <div class="cryptooi-head">
            <span>合约持仓量(OI)监控</span>
            <span class="cryptooi-status" data-conn>连接中…</span>
          </div>
          <div class="cryptooi-sub">币安 USDT 永续 · 按持仓名义价值降序 · 点击行跳转币安合约详情</div>
          <table class="data-table cryptooi-table">
            <thead><tr><th>#</th><th>币种</th><th class="cryptooi-r">持仓量(亿美元)</th><th class="cryptooi-r">OI 1h变化</th><th class="cryptooi-r">价格 24h</th></tr></thead>
            <tbody data-body><tr class="cryptooi-empty"><td colspan="5">加载中…</td></tr></tbody>
          </table>
          <div class="cryptooi-foot">
            <span>来源: Binance Futures · OI 变化 = 最新 1h 周期值对比 2 根前（limit=3）</span>
            <span>更新: <b data-updated>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const body = el.querySelector('[data-body]');
      const hint = el.querySelector('[data-hint]');
      const updatedEl = el.querySelector('[data-updated]');

      let alive = true;
      let tickTimer = null;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'cryptooi-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'cryptooi-status live';
        setStatus('online');
      };

      // 带超时 + 重试 1 次的 JSON fetch（仿 ashareboard fetchBoard 的 controller/timer 管理）
      const fetchJSON = async (url) => {
        let lastErr = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            return await resp.json();
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('fetch error');
      };

      // 单币种 OI：取最新一条 sumOpenInterestValue，与最早一条对比算变化%
      const fetchOI = async (sym) => {
        const json = await fetchJSON(oiUrl(sym));
        const arr = Array.isArray(json) ? json : [];
        const last = arr.length ? arr[arr.length - 1] : null;
        const first = arr.length ? arr[0] : null;
        const oiValue = last ? parseFloat(last.sumOpenInterestValue) : NaN;
        const oiFirst = first ? parseFloat(first.sumOpenInterestValue) : NaN;
        const oiChg = Number.isFinite(oiValue) && Number.isFinite(oiFirst) && oiFirst > 0
          ? ((oiValue - oiFirst) / oiFirst) * 100
          : NaN;
        if (!Number.isFinite(oiValue)) throw new Error('empty');
        return { symbol: sym, oiValue, oiChg };
      };

      // 24h 行情：批量请求（端点可能忽略 symbols 返回全量），客户端按白名单过滤
      const fetchTickers = async () => {
        const json = await fetchJSON(TICKER_URL);
        const arr = Array.isArray(json) ? json : json ? [json] : [];
        const out = {};
        arr.forEach((t) => {
          if (t && SYMBOLS.indexOf(t.symbol) !== -1) {
            out[t.symbol] = parseFloat(t.priceChangePercent);
          }
        });
        return out;
      };

      const render = (oiRows, tickers) => {
        const ok = oiRows.filter(Boolean).sort((a, b) => b.oiValue - a.oiValue);
        const failed = SYMBOLS.filter((s) => !oiRows.some((r) => r && r.symbol === s));
        if (!ok.length && !Object.keys(tickers).length) {
          body.innerHTML = `<tr class="cryptooi-empty"><td colspan="5">数据加载失败，60 秒后自动重试…</td></tr>`;
          return;
        }
        const rowHtml = (r, rank) => {
          const pct = tickers[r.symbol];
          return `
            <tr data-sym="${esc(r.symbol)}" title="查看 ${esc(r.symbol)} 币安合约详情">
              <td class="cryptooi-rank">${rank}</td>
              <td class="cryptooi-sym">${esc(r.symbol.replace(/USDT$/, ''))}<i>USDT 永续</i></td>
              <td class="cryptooi-num cryptooi-r">${esc(fmtOi(r.oiValue))}</td>
              <td class="cryptooi-num cryptooi-r ${dirClass(r.oiChg)}">${esc(fmtSignedPct(r.oiChg))}</td>
              <td class="cryptooi-num cryptooi-r ${dirClass(pct)}">${esc(fmtSignedPct(pct))}</td>
            </tr>`;
        };
        const failedHtml = (sym) => {
          const pct = tickers[sym];
          return `
            <tr data-sym="${esc(sym)}" title="查看 ${esc(sym)} 币安合约详情">
              <td class="cryptooi-rank">—</td>
              <td class="cryptooi-sym">${esc(sym.replace(/USDT$/, ''))}<i>USDT 永续</i></td>
              <td class="cryptooi-num cryptooi-r cryptooi-flat">—</td>
              <td class="cryptooi-num cryptooi-r cryptooi-flat">—</td>
              <td class="cryptooi-num cryptooi-r ${dirClass(pct)}">${esc(fmtSignedPct(pct))}</td>
            </tr>`;
        };
        body.innerHTML = ok.map((r, i) => rowHtml(r, i + 1)).join('') + failed.map(failedHtml).join('');
        updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      };

      const refresh = async () => {
        if (!alive) return;
        // 新请求前 abort 上一轮可能残留的 fetch
        pendingAborts.forEach((c) => {
          try { c.abort(); } catch (e) { /* 忽略 */ }
        });
        try {
          const results = await Promise.allSettled([...SYMBOLS.map(fetchOI), fetchTickers()]);
          if (!alive) return;
          const tickers = results[results.length - 1].status === 'fulfilled' ? results[results.length - 1].value : {};
          const oiRows = results.slice(0, SYMBOLS.length).map((r) => (r.status === 'fulfilled' ? r.value : null));
          const okCount = oiRows.filter(Boolean).length + Object.keys(tickers).length;
          render(oiRows, tickers);
          if (okCount > 0) clearError();
          else showError('币安接口连接失败，60 秒后自动重试…');
        } catch (e) {
          if (!alive) return;
          showError('币安接口连接失败，60 秒后自动重试…');
        }
      };

      // 行点击跳转币安合约详情（新标签页，noopener）
      const onRowClick = (ev) => {
        const tr = ev.target && ev.target.closest ? ev.target.closest('tr[data-sym]') : null;
        if (!tr) return;
        const sym = tr.getAttribute('data-sym');
        if (sym) window.open(detailUrl(sym), '_blank', 'noopener');
      };
      body.addEventListener('click', onRowClick);

      setStatus('loading');
      refresh();
      tickTimer = setInterval(refresh, REFRESH_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        pendingAborts.forEach((c) => {
          try { c.abort(); } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
        body.removeEventListener('click', onRowClick);
      };
    },
  };
})();
