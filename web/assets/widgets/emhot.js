/* 新兴市场明星股 — TradingView scanner 单标的接口(CORS JSON，按市场分组)
 * 接口: https://scanner.tradingview.com/symbol?symbol=<EXCH:CODE>&fields=close,change,change_abs,currency,description
 *        （GET 单标的，响应反射 Origin 头，Access-Control-Allow-Origin 实测可用 2026-07-16；
 *          close=现价 change=涨跌幅% change_abs=涨跌额 currency=币种 description=公司名）
 * 覆盖市场与标的（全部 curl 实测 2026-07-16，HTTP 200 + 有数据）:
 *   巴西(BRL):  BMFBOVESPA:VALE3 淡水河谷 / BMFBOVESPA:PETR4 巴西石油 / BMFBOVESPA:ITUB4 伊塔乌银行
 *   墨西哥(MXN): BMV:WALMEX 沃尔玛墨西哥
 *   印度(INR):  NSE:RELIANCE 信实工业 / NSE:TCS 塔塔咨询 / NSE:HDFCBANK HDFC银行（站内无 asiahot 组件，印度未覆盖故保留）
 *   沙特(SAR):  TADAWUL:2222 沙特阿美 / TADAWUL:1120 拉吉希银行 / TADAWUL:7010 沙特电信
 *   俄罗斯(USD): OTC:LUKOY 卢克石油ADR（OTC粉单）
 * 弃用标的实测记录（2026-07-16，均返回 {"code":"symbol_not_exists"}，已剔除）:
 *   - BMV:AMXL / BMV:AMXB / BMV:AMX（美洲移动，BMV 代码在 scanner 不可用）
 *   - BMV:GFNORTEO / BMV:FEMSAUBD（墨西哥备选，同不可用 → 墨西哥仅保留 WALMEX 一只）
 *   - MOEX:SBER / MCX:SBER / MCX:GAZP（俄罗斯本土，scanner 无 MOEX 个股）
 *   - OTC:SBRCY / OTC:OGZPY（Sberbank/Gazprom ADR，已退市无数据）→ 俄罗斯以 OTC:LUKOY 代替
 *   - JSE:NPN / JSE:SOL（南非，可用但实测市场已 ≥3 个，未纳入）
 * 配色: 绿涨红跌（国际习惯），用 emhot-up(绿 var(--up))/emhot-down(红 var(--down)) 语义令牌，不用 --acc/--danger。
 * Registers as custom tool id 'emhot' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const GROUPS = [
    {
      key: 'BR', name: '巴西', flag: '🇧🇷', ccy: 'BRL',
      items: [
        { key: 'VALE3', symbol: 'BMFBOVESPA:VALE3', name: '淡水河谷', code: 'VALE3' },
        { key: 'PETR4', symbol: 'BMFBOVESPA:PETR4', name: '巴西石油', code: 'PETR4' },
        { key: 'ITUB4', symbol: 'BMFBOVESPA:ITUB4', name: '伊塔乌银行', code: 'ITUB4' },
      ],
    },
    {
      key: 'MX', name: '墨西哥', flag: '🇲🇽', ccy: 'MXN',
      items: [{ key: 'WALMEX', symbol: 'BMV:WALMEX', name: '沃尔玛墨西哥', code: 'WALMEX' }],
    },
    {
      key: 'IN', name: '印度', flag: '🇮🇳', ccy: 'INR',
      items: [
        { key: 'RELIANCE', symbol: 'NSE:RELIANCE', name: '信实工业', code: 'RELIANCE' },
        { key: 'TCS', symbol: 'NSE:TCS', name: '塔塔咨询', code: 'TCS' },
        { key: 'HDFCBANK', symbol: 'NSE:HDFCBANK', name: 'HDFC银行', code: 'HDFCBANK' },
      ],
    },
    {
      key: 'SA', name: '沙特', flag: '🇸🇦', ccy: 'SAR',
      items: [
        { key: '2222', symbol: 'TADAWUL:2222', name: '沙特阿美', code: '2222' },
        { key: '1120', symbol: 'TADAWUL:1120', name: '拉吉希银行', code: '1120' },
        { key: '7010', symbol: 'TADAWUL:7010', name: '沙特电信', code: '7010' },
      ],
    },
    {
      key: 'RU', name: '俄罗斯', flag: '🇷🇺', ccy: 'USD · ADR',
      items: [{ key: 'LUKOY', symbol: 'OTC:LUKOY', name: '卢克石油ADR', code: 'LUKOY' }],
    },
  ];
  const ALL_ITEMS = GROUPS.reduce((acc, g) => acc.concat(g.items), []);

  const tvUrl = (symbol) =>
    `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,currency`;

  const REFRESH_MS = 60000; // 刷新间隔 60s
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 周末休市低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('emhot-style')) return;
    const style = document.createElement('style');
    style.id = 'emhot-style';
    style.textContent = `
.emhot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.emhot-head-right { display: flex; align-items: center; gap: 8px; }
.emhot-badge {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.emhot-status { color: var(--warning); white-space: nowrap; }
.emhot-status.live { color: var(--acc); }
/* 国际习惯绿涨红跌：语义令牌 var(--up)/var(--down)，勿改用 --acc/--danger */
.emhot-up { color: var(--up); }
.emhot-down { color: var(--down); }
.emhot-flat { color: var(--text-muted); }
.emhot-group { margin-bottom: 8px; }
.emhot-group-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--hairline);
  padding-bottom: 3px;
  margin-bottom: 2px;
}
.emhot-group-ccy {
  margin-left: auto;
  font-family: var(--font-mono);
  color: var(--text-dim);
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.emhot-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--hairline);
}
.emhot-row:last-child { border-bottom: none; }
.emhot-name {
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.emhot-name i {
  font-style: normal;
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  margin-left: 6px;
}
.emhot-price {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.emhot-chg, .emhot-pct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 64px;
  text-align: right;
}
.emhot-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
  margin-top: 2px;
}
.emhot-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  // 绿涨红跌
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'emhot-flat';
    return v > 0 ? 'emhot-up' : 'emhot-down';
  };

  // 覆盖市场横跨多个时区，仅 UTC 周末整体休市，降频刷新
  const isIdle = () => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  };

  window.GT_EXTRA_TOOLS['emhot'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool emhot-root">
          <div class="emhot-head">
            <span>新兴市场明星股</span>
            <span class="emhot-head-right">
              <span class="emhot-badge" data-weekend style="display:none">周末休市</span>
              <span class="emhot-status" data-conn>连接中…</span>
            </span>
          </div>
          ${GROUPS.map(
            (g) => `
            <div class="emhot-group" data-group="${esc(g.key)}">
              <div class="emhot-group-head">
                <span>${g.flag} ${esc(g.name)}</span>
                <span class="emhot-group-ccy">${esc(g.ccy)}</span>
              </div>
              ${g.items
                .map(
                  (it) => `
                <div class="emhot-row" data-key="${esc(it.key)}">
                  <span class="emhot-name">${esc(it.name)}<i>${esc(it.code)}</i></span>
                  <span class="emhot-price emhot-flat" data-price>—</span>
                  <span class="emhot-chg emhot-flat" data-chg>—</span>
                  <span class="emhot-pct emhot-flat" data-pct>—</span>
                </div>`
                )
                .join('')}
            </div>`
          ).join('')}
          <div class="emhot-foot">
            <span>来源：TradingView scanner（各交易所行情）· 俄罗斯 SBER/GAZP 无可用源，以卢克石油ADR代替</span>
            <span>绿涨红跌 · 更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const weekendEl = el.querySelector('[data-weekend]');
      const timeEl = el.querySelector('[data-time]');
      const rows = {};
      el.querySelectorAll('.emhot-row').forEach((row) => {
        rows[row.getAttribute('data-key')] = {
          price: row.querySelector('[data-price]'),
          chg: row.querySelector('[data-chg]'),
          pct: row.querySelector('[data-pct]'),
        };
      });

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'emhot-status';
        setStatus('offline');
      };
      const showLive = (partialMsg) => {
        if (partialMsg) {
          hint.textContent = partialMsg;
          hint.style.display = '';
        } else {
          hint.style.display = 'none';
        }
        conn.textContent = '● LIVE';
        conn.className = 'emhot-status live';
        setStatus('online');
      };

      // 单标的 CORS JSON fetch（10s 超时）
      const fetchOne = async (it) => {
        if (!alive) throw new Error('disposed');
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(tvUrl(it.symbol), { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          const json = await resp.json();
          const close = Number(json && json.close);
          if (!Number.isFinite(close)) throw new Error('empty');
          return { key: it.key, price: close, pct: Number(json.change), chg: Number(json.change_abs) };
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      const render = (v) => {
        const c = rows[v.key];
        if (!c) return;
        const cls = dirClass(v.chg);
        c.price.textContent = fmtNum(v.price, 2);
        c.price.className = `emhot-price ${cls}`;
        c.chg.textContent = fmtSigned(v.chg, 2);
        c.chg.className = `emhot-chg ${cls}`;
        c.pct.textContent = Number.isFinite(v.pct) ? `${fmtSigned(v.pct, 2)}%` : '—';
        c.pct.className = `emhot-pct ${cls}`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const results = await Promise.allSettled(ALL_ITEMS.map(fetchOne));
          if (!alive) return;
          const ok = results.filter((r) => r.status === 'fulfilled');
          if (!ok.length) {
            showError('行情加载失败，60 秒后自动重试…');
            return;
          }
          ok.forEach((r) => render(r.value));
          const failed = results.length - ok.length;
          showLive(failed ? `${failed} 只标的加载失败，其余正常，60 秒后自动重试…` : '');
          timeEl.textContent = new Date().toTimeString().slice(0, 8);
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
        weekendEl.style.display = isIdle() ? '' : 'none';
        if (!isIdle() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
      weekendEl.style.display = isIdle() ? '' : 'none';
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
