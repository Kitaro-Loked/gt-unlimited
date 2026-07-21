/* 币圈量能异动榜 — Binance USDT 永续 1h 成交额异动扫描(CORS JSON)
 * 全量: https://fapi.binance.com/fapi/v1/ticker/24hr （过滤 USDT 结尾、不含 '_'、不含 'USDC'，取 quoteVolume 前 60）
 *   字段（字符串数字）：symbol / lastPrice / priceChangePercent(24h) / quoteVolume(24h 成交额 USDT)
 * K线: https://fapi.binance.com/fapi/v1/klines?symbol=XXX&interval=1h&limit=25
 *   数组下标：0=开盘时间(ms) 7=成交额(USDT)；最后 1 根为当前未完结小时，其前 24 根为已完成小时
 * 算法: 放量倍数 = 当前 1h 成交额 / 前 24h 均值，>= 2.5x 视为异动，按倍数降序取前 15
 * 并发: 7 个一批逐批 Promise.allSettled，单请求 10s 超时，扫描总预算 25s（实测 60 币种约 3s）
 * 实测: 2026-07-16 curl 验证两接口 GET 均 HTTP 200 且响应头带 Access-Control-Allow-Origin: *
 *   （fapi 不支持 HEAD，HEAD 请求 404，须用 GET 验证）
 * 取舍: 当前小时未完结，小时初倍数系统性偏低（如 10:05 仅累积 5 分钟量），不做时间投影以免放大噪音；
 *   涨跌% 直接取 24hr ticker 的 priceChangePercent（24h 窗口），不为每币种另算 1h 涨跌
 * 加密组件绿涨红跌：方向着色用 var(--up)(涨)/var(--down)(跌)。
 * Registers as custom tool id 'cryptovol' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TICKER_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
  const klinesUrl = (sym) =>
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=1h&limit=25`;
  const futLink = (sym) => `https://www.binance.com/zh-CN/futures/${encodeURIComponent(sym)}`;

  const SCAN_N = 60; // 扫描范围：24h 成交额前 N 的 USDT 永续
  const TOP_N = 15; // 榜单最多展示行数
  const SPIKE_RATIO = 2.5; // 放量异动阈值
  const CONCURRENCY = 7; // klines 请求批内并发数
  const REFRESH_MS = 5 * 60 * 1000; // 加密市场 24/7，固定 5 分钟刷新
  const TICK_MS = 30000; // tick 检查间隔（到期/重试判断）
  const ERROR_RETRY_MS = 60000; // 从未拿到数据时的重试间隔
  const FETCH_TIMEOUT_MS = 10000; // 单请求超时
  const SCAN_BUDGET_MS = 25000; // klines 扫描总时间预算，超时放弃剩余批次

  function injectStyle() {
    if (document.getElementById('cvol-style')) return;
    const style = document.createElement('style');
    style.id = 'cvol-style';
    style.textContent = `
.cvol-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.cvol-status { color: var(--warning); white-space: nowrap; }
.cvol-status.live { color: var(--acc); }
.cvol-table-wrap { min-height: 120px; }
.cvol-table { width: 100%; font-variant-numeric: tabular-nums; }
.cvol-table th, .cvol-table td { white-space: nowrap; }
.cvol-table th:last-child, .cvol-table td:last-child,
.cvol-table th:nth-child(3), .cvol-table td:nth-child(3),
.cvol-table th:nth-child(4), .cvol-table td:nth-child(4) { text-align: right; }
.cvol-table tbody tr[data-url] { cursor: pointer; }
.cvol-table tbody tr[data-url]:hover { background: var(--surface-raised); }
.cvol-rank { font-family: var(--font-mono); color: var(--text-dim); width: 1.6em; }
.cvol-rank.top { color: var(--warning); font-weight: 700; }
.cvol-coin { font-weight: 600; }
.cvol-num { font-family: var(--font-mono); }
.cvol-up { color: var(--up); }
.cvol-down { color: var(--down); }
.cvol-flat { color: var(--text-muted); }
.cvol-dim { color: var(--text-muted); }
.cvol-badge {
  display: inline-block;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.cvol-badge.up { color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
.cvol-badge.down { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
.cvol-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cvol-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${fmtNum(v, 2)}%`;
  };

  const fmtRatio = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${fmtNum(v, 2)}x`;
  };

  // quoteVolume(USDT) → 亿美元（与 cryptotop 一致）
  const fmtQuoteVol = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${fmtNum(v / 1e8, 2)}亿`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'cvol-flat';
    return v > 0 ? 'cvol-up' : 'cvol-down';
  };

  window.GT_EXTRA_TOOLS['cryptovol'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cvol-root">
          <div class="cvol-head">
            <span>币安 · USDT 永续量能异动</span>
            <span class="cvol-status" data-conn>加载中…</span>
          </div>
          <div class="cvol-table-wrap">
            <table class="data-table cvol-table">
              <thead><tr><th>#</th><th>币种</th><th>1h成交额</th><th>放量倍数</th><th>24h涨跌</th></tr></thead>
              <tbody data-body><tr class="cvol-empty"><td colspan="5">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="cvol-foot">
            <span data-source></span>
            <span data-updated></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const sourceEl = el.querySelector('[data-source]');
      const updatedEl = el.querySelector('[data-updated]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0; // 上次成功拿到数据的时间
      let lastAttemptAt = 0; // 上次发起刷新（含失败）的时间
      const pendingAborts = new Set(); // 进行中的 fetch AbortController
      const pendingTimers = new Set(); // 进行中的超时定时器
      const disposers = [];

      const on = (node, ev, fn) => {
        node.addEventListener(ev, fn);
        disposers.push(() => node.removeEventListener(ev, fn));
      };

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'cvol-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'cvol-status live';
        setStatus('online');
      };

      // 单请求 10s 超时；controller/timer 登记入集合，cleanup 时统一 abort/clear
      const fetchJSON = async (url) => {
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          return await resp.json();
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      // 过滤 USDT 永续（剔除交割合约 '_' 与 USDC 对），按 24h 成交额取前 SCAN_N
      const parseTickers = (arr) =>
        (Array.isArray(arr) ? arr : [])
          .filter((r) => {
            const s = r && r.symbol;
            return typeof s === 'string' && s.endsWith('USDT') && s.indexOf('_') === -1 && s.indexOf('USDC') === -1;
          })
          .map((r) => ({
            symbol: r.symbol,
            coin: r.symbol.slice(0, -4),
            pct: parseFloat(r.priceChangePercent),
            qv24: parseFloat(r.quoteVolume),
          }))
          .filter((r) => Number.isFinite(r.pct) && Number.isFinite(r.qv24) && r.qv24 > 0)
          .sort((a, b) => b.qv24 - a.qv24)
          .slice(0, SCAN_N);

      // 最后 1 根为当前未完结小时，其前 24 根均值作基准
      const calcSpike = (k) => {
        if (!Array.isArray(k) || k.length < 25) return null;
        const qvs = k.map((x) => parseFloat(x && x[7]));
        if (qvs.some((v) => !Number.isFinite(v))) return null;
        const cur = qvs[qvs.length - 1];
        const prev = qvs.slice(0, qvs.length - 1);
        const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
        if (!(avg > 0) || !(cur > 0)) return null;
        return { ratio: cur / avg, qv1h: cur };
      };

      // 分批并发扫描，返回 { rows(带 ratio/qv1h), scanned }
      const scanKlines = async (tickers) => {
        const rows = [];
        let scanned = 0;
        const deadline = Date.now() + SCAN_BUDGET_MS;
        for (let i = 0; i < tickers.length; i += CONCURRENCY) {
          if (!alive || Date.now() > deadline) break;
          const batch = tickers.slice(i, i + CONCURRENCY);
          const res = await Promise.allSettled(batch.map((t) => fetchJSON(klinesUrl(t.symbol))));
          if (!alive) break;
          res.forEach((rr, j) => {
            if (rr.status !== 'fulfilled') return;
            scanned += 1;
            const spike = calcSpike(rr.value);
            if (spike) rows.push(Object.assign({}, batch[j], spike));
          });
        }
        return { rows, scanned };
      };

      const render = (rows, scanned) => {
        const spikes = rows
          .filter((r) => r.ratio >= SPIKE_RATIO)
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, TOP_N);
        if (!spikes.length) {
          const best = rows.slice().sort((a, b) => b.ratio - a.ratio)[0];
          const tip = best ? `（当前最高 ${best.coin} ${fmtRatio(best.ratio)}）` : '';
          body.innerHTML = `<tr class="cvol-empty"><td colspan="5">当前无 ≥${SPIKE_RATIO}x 放量异动${esc(tip)}</td></tr>`;
        } else {
          body.innerHTML = spikes
            .map((r, i) => {
              // symbol 白名单校验；URL 经 encodeURIComponent 拼接、esc 转义后写入属性
              const url = /^[^\s"'<>&]{2,40}$/.test(r.symbol) ? futLink(r.symbol) : '';
              const dir = r.pct > 0 ? 'up' : r.pct < 0 ? 'down' : '';
              return `
            <tr${url ? ` data-url="${esc(url)}"` : ''}>
              <td class="cvol-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="cvol-coin">${esc(r.coin)}</td>
              <td class="cvol-num">${esc(fmtQuoteVol(r.qv1h))}</td>
              <td><span class="cvol-badge${dir ? ` ${dir}` : ''}">${esc(fmtRatio(r.ratio))}</span></td>
              <td class="cvol-num ${dirClass(r.pct)}">${esc(fmtPct(r.pct))}</td>
            </tr>`;
            })
            .join('');
        }
        sourceEl.textContent = `来源：Binance USDT 永续 · 阈值 ≥${SPIKE_RATIO}x · 扫描 ${scanned}/${SCAN_N}`;
        updatedEl.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastAttemptAt = Date.now();
        try {
          const ticker = await fetchJSON(TICKER_URL);
          if (!alive) return;
          const tickers = parseTickers(ticker);
          if (!tickers.length) throw new Error('empty ticker');
          conn.textContent = '扫描中…';
          const { rows, scanned } = await scanKlines(tickers);
          if (!alive) return;
          if (scanned === 0) throw new Error('klines all failed');
          lastFetchAt = Date.now();
          render(rows, scanned);
          clearError();
        } catch (e) {
          if (!alive) return;
          if (e && e.name === 'AbortError') showError('请求超时，1 分钟后自动重试…');
          else showError('行情扫描失败，1 分钟后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      // 行点击：新标签页打开币安合约详情页（noopener）
      on(body, 'click', (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-url]') : null;
        if (tr) window.open(tr.getAttribute('data-url'), '_blank', 'noopener');
      });

      // 成功数据每 5 分钟到期刷新；从未成功（或失败后无数据）时 1 分钟重试
      const tick = () => {
        if (!alive || document.hidden || refreshInFlight) return;
        const now = Date.now();
        if (lastFetchAt === 0) {
          if (now - lastAttemptAt >= ERROR_RETRY_MS) refresh();
        } else if (now - lastFetchAt >= REFRESH_MS) {
          refresh();
        }
      };

      // 页面重新可见时补一次到期检查（hidden 期间 tick 全部跳过）
      on(document, 'visibilitychange', () => {
        if (!document.hidden) tick();
      });

      setStatus('loading');
      refresh();
      tickTimer = setInterval(tick, TICK_MS);

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
        disposers.forEach((fn) => fn());
        disposers.length = 0;
      };
    },
  };
})();
