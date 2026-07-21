/* 币安合约/现货涨跌榜 — Binance 24hr Ticker(CORS JSON)
 * 合约: https://fapi.binance.com/fapi/v1/ticker/24hr （全量数组，过滤 USDT 结尾、不含 '_'、不含 'USDC'）
 * 现货: https://api.binance.com/api/v3/ticker/24hr （同样过滤）
 * 已用 curl 实测 2026-07：两接口 GET 响应头均带 Access-Control-Allow-Origin: *（fapi 不支持 HEAD，会 404）。
 * 字段（字符串数字，以真实响应为准）：symbol / lastPrice / priceChangePercent / quoteVolume。
 * 加密组件绿涨红跌：方向着色用 --up(涨)/--down(跌)。
 * Registers as custom tool id 'cryptotop' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const MARKETS = {
    futures: {
      label: '合约',
      url: 'https://fapi.binance.com/fapi/v1/ticker/24hr',
      source: 'Binance USDT 永续合约',
      link: (sym) => `https://www.binance.com/zh-CN/futures/${encodeURIComponent(sym)}`,
    },
    spot: {
      label: '现货',
      url: 'https://api.binance.com/api/v3/ticker/24hr',
      source: 'Binance 现货',
      link: (sym) => `https://www.binance.com/zh-CN/trade/${encodeURIComponent(sym.slice(0, -4))}_USDT`,
    },
  };

  const TABS = [
    { id: 'gainers', label: '涨幅榜' },
    { id: 'losers', label: '跌幅榜' },
    { id: 'volume', label: '成交额榜' },
  ];

  const TOP_N = 15;
  const REFRESH_MS = 30000; // 加密市场 24/7，固定 30s 刷新
  const FETCH_TIMEOUT_MS = 12000; // 全量响应约几百 KB，超时留足余量

  function injectStyle() {
    if (document.getElementById('ctop-style')) return;
    const style = document.createElement('style');
    style.id = 'ctop-style';
    style.textContent = `
.ctop-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.ctop-status { color: var(--warning); white-space: nowrap; }
.ctop-status.live { color: var(--acc); }
.ctop-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.ctop-seg { display: flex; border: 1px solid var(--hairline); border-radius: var(--radius-sm); overflow: hidden; }
.ctop-seg button {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 10px;
  padding: 3px 10px;
  cursor: pointer;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ctop-seg button + button { border-left: 1px solid var(--hairline); }
.ctop-seg button.on {
  color: var(--acc);
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.ctop-table-wrap { min-height: 120px; }
.ctop-table { width: 100%; font-variant-numeric: tabular-nums; }
.ctop-table th, .ctop-table td { white-space: nowrap; }
.ctop-table th:last-child, .ctop-table td:last-child,
.ctop-table th:nth-child(3), .ctop-table td:nth-child(3),
.ctop-table th:nth-child(4), .ctop-table td:nth-child(4) { text-align: right; }
.ctop-table tbody tr[data-url] { cursor: pointer; transition: background 0.2s var(--ease-fluid); }
.ctop-table tbody tr[data-url]:hover { background: var(--surface-raised); }
.ctop-rank { font-family: var(--font-mono); color: var(--text-dim); width: 1.6em; }
.ctop-rank.top { color: var(--warning); font-weight: 700; }
.ctop-coin { font-weight: 600; }
.ctop-num { font-family: var(--font-mono); }
.ctop-up { color: var(--up); }
.ctop-down { color: var(--down); }
.ctop-flat { color: var(--text-muted); }
.ctop-dim { color: var(--text-muted); }
.ctop-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ctop-foot {
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

  // 币价量级差异大（0.000x ~ 100,000+），按量级自适应小数位
  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
    return v.toLocaleString('en-US', { maximumFractionDigits: d });
  };

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${fmtNum(v, 2)}%`;
  };

  // quoteVolume(USDT) → 亿美元
  const fmtQuoteVol = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${fmtNum(v / 1e8, 2)}亿`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ctop-flat';
    return v > 0 ? 'ctop-up' : 'ctop-down';
  };

  window.GT_EXTRA_TOOLS['cryptotop'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool ctop-root">
          <div class="ctop-head">
            <span>币安 · 合约/现货涨跌榜</span>
            <span class="ctop-status" data-conn>加载中…</span>
          </div>
          <div class="ctop-toolbar">
            <span class="ctop-seg" data-market-seg>
              <button type="button" data-market="futures" class="on">合约</button>
              <button type="button" data-market="spot">现货</button>
            </span>
            <span class="ctop-seg" data-tab-seg>
              ${TABS.map((t, i) => `<button type="button" data-tab="${esc(t.id)}"${i === 0 ? ' class="on"' : ''}>${esc(t.label)}</button>`).join('')}
            </span>
          </div>
          <div class="ctop-table-wrap">
            <table class="data-table ctop-table">
              <thead><tr><th>#</th><th>币种</th><th>最新价</th><th>24h涨跌</th><th>成交额(亿$)</th></tr></thead>
              <tbody data-body><tr class="ctop-empty"><td colspan="5">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="ctop-foot">
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
      const marketSeg = el.querySelector('[data-market-seg]');
      const tabSeg = el.querySelector('[data-tab-seg]');

      let alive = true;
      let tickTimer = null;
      let ctrl = null; // 进行中的 fetch AbortController
      const pendingTimers = new Set(); // 进行中 fetch 的超时定时器
      let market = 'futures';
      let tab = 'gainers';
      const cache = { futures: null, spot: null }; // { rows, at }
      const disposers = [];

      const on = (node, ev, fn) => {
        node.addEventListener(ev, fn);
        disposers.push(() => node.removeEventListener(ev, fn));
      };

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'ctop-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ctop-status live';
        setStatus('online');
      };

      // 接口字段为字符串数字；过滤 USDT 结尾、不含 '_'（剔除交割合约）、不含 'USDC'
      const parseRows = (arr) =>
        (Array.isArray(arr) ? arr : [])
          .filter((r) => {
            const s = r && r.symbol;
            return typeof s === 'string' && s.endsWith('USDT') && s.indexOf('_') === -1 && s.indexOf('USDC') === -1;
          })
          .map((r) => ({
            symbol: r.symbol,
            coin: r.symbol.slice(0, -4),
            price: parseFloat(r.lastPrice),
            pct: parseFloat(r.priceChangePercent),
            qv: parseFloat(r.quoteVolume),
          }))
          .filter((r) => Number.isFinite(r.pct) && Number.isFinite(r.price));

      const sortRows = (rows) => {
        const list = rows.slice();
        if (tab === 'gainers') list.sort((a, b) => b.pct - a.pct);
        else if (tab === 'losers') list.sort((a, b) => a.pct - b.pct);
        else list.sort((a, b) => b.qv - a.qv);
        return list.slice(0, TOP_N);
      };

      const render = () => {
        const entry = cache[market];
        const rows = entry ? sortRows(entry.rows) : [];
        if (!rows.length) {
          body.innerHTML = `<tr class="ctop-empty"><td colspan="5">${entry ? '暂无数据' : '加载中…'}</td></tr>`;
        } else {
          body.innerHTML = rows
            .map((r, i) => {
              // symbol 白名单校验（放行字母/数字/中文等，仅排除空白与引号尖括号；
              // URL 经 encodeURIComponent 拼接、esc 转义后写入属性），异常 symbol 不挂链接
              const url = /^[^\s"'<>&]{2,40}$/.test(r.symbol) ? MARKETS[market].link(r.symbol) : '';
              return `
            <tr${url ? ` data-url="${esc(url)}"` : ''}>
              <td class="ctop-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="ctop-coin">${esc(r.coin)}</td>
              <td class="ctop-num">${esc(fmtPrice(r.price))}</td>
              <td class="ctop-num ${dirClass(r.pct)}">${esc(fmtPct(r.pct))}</td>
              <td class="ctop-num ctop-dim">${esc(fmtQuoteVol(r.qv))}</td>
            </tr>`;
            })
            .join('');
        }
        sourceEl.textContent = `来源：${MARKETS[market].source}${entry ? ` · USDT 交易对 ${entry.rows.length} 个` : ''}`;
        updatedEl.textContent = entry
          ? `更新于 ${new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false })}`
          : '';
      };

      const refresh = async () => {
        if (!alive) return;
        if (ctrl) ctrl.abort(); // 新请求前 abort 旧请求
        ctrl = new AbortController();
        const myCtrl = ctrl;
        const timer = setTimeout(() => myCtrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(MARKETS[market].url, { signal: myCtrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          const json = await resp.json();
          if (!alive || ctrl !== myCtrl) return;
          cache[market] = { rows: parseRows(json), at: Date.now() };
          clearError();
          render();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError' && ctrl !== myCtrl)) return;
          if (e && e.name === 'AbortError') showError('请求超时，30 秒后自动重试…');
          else showError('行情加载失败，30 秒后自动重试…');
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          if (ctrl === myCtrl) ctrl = null;
        }
      };

      // 行点击：新标签页打开币安详情页（noopener）
      on(body, 'click', (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-url]') : null;
        if (tr) window.open(tr.getAttribute('data-url'), '_blank', 'noopener');
      });

      on(marketSeg, 'click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-market]') : null;
        if (!btn || btn.getAttribute('data-market') === market) return;
        market = btn.getAttribute('data-market');
        marketSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        conn.textContent = '加载中…';
        conn.className = 'ctop-status';
        setStatus('loading');
        render(); // 先展示该市场缓存（若有），再拉新数据
        refresh();
      });

      on(tabSeg, 'click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-tab]') : null;
        if (!btn || btn.getAttribute('data-tab') === tab) return;
        tab = btn.getAttribute('data-tab');
        tabSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        render(); // Tab 切换仅重排缓存数据，不重复请求
      });

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
        if (ctrl) {
          try {
            ctrl.abort();
          } catch (e) { /* 忽略 */ }
          ctrl = null;
        }
        disposers.forEach((fn) => fn());
        disposers.length = 0;
      };
    },
  };
})();
