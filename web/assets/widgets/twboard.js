/* 台股行情板 — 台湾加权指数 + 台股明星 15 只（TradingView scanner 批量快照，CORS JSON）
 * 接口: POST https://scanner.tradingview.com/taiwan/scan
 *        请求体 JSON: {"symbols":{"tickers":["TWSE:2330",...],"query":{"types":[]}},
 *                      "columns":["close","change","change_abs","volume"]}
 *        关键：Content-Type 用 text/plain（CORS 简单请求，避免预检；预检响应
 *              access-control-allow-headers 不含 content-type，application/json 会被浏览器拦截）。
 *              响应头 access-control-allow-origin 反射 Origin，实测可跨域（2026-07-16）。
 *        响应: {"totalCount":N,"data":[{"s":"TWSE:2330","d":[close,change%,change_abs,volume(股)]}]}
 *        指数代码: TWSE:IX0001 = 台湾加权指数(TAIEX)，volume 恒为 null。
 * 实测记录（2026-07-16，均 curl -H "Origin: https://example.com" 验证）:
 *   - POST /taiwan/scan 批量 16 标的: HTTP 200 + ACAO 反射 Origin + 数据完整（一次拉全，采用）
 *   - GET /symbol?symbol=TWSE:2330 单标的可用（HTTP 200 + ACAO），但不支持逗号分隔多标的
 *     （多标的返回 {"code":"symbol_not_exists"}），故弃用逐只 GET 方案
 *   - 个股交易所前缀必须是 TWSE:，TPE:/TPEX:/ROCO: 均 404 symbol_not_exists
 *   - 指数仅 TWSE:IX0001 可用；TAIEX:TWII / TVC:TAIEX / TWSE:TAIEX 均 404
 *   - 东财无台湾市场：suggest "2330" 命中日股(176.2330_JPX)、"台积电" 仅命中美股 ADR(106.TSM)，弃用
 * 台股时段: 周一至五 09:00-13:30 Asia/Taipei（UTC+8 全年无夏令时），仅按星期粗判，不含节假日
 * 配色: 国际习惯绿涨红跌，用 twb-up(绿 var(--up))/twb-down(红 var(--down)) 语义令牌，不用 --acc/--danger
 * Registers as custom tool id 'twboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEX_DEF = { s: 'TWSE:IX0001', name: '台湾加权', code: 'TAIEX', isIndex: true };
  // 台股明星（TWSE 上市，名称固定中文展示，接口 description 为英文不采用）
  const STOCKS = [
    { s: 'TWSE:2330', name: '台积电', code: '2330' },
    { s: 'TWSE:2454', name: '联发科', code: '2454' },
    { s: 'TWSE:2317', name: '鸿海', code: '2317' },
    { s: 'TWSE:2308', name: '台达电', code: '2308' },
    { s: 'TWSE:2303', name: '联电', code: '2303' },
    { s: 'TWSE:3711', name: '日月光', code: '3711' },
    { s: 'TWSE:3008', name: '大立光', code: '3008' },
    { s: 'TWSE:2881', name: '富邦金', code: '2881' },
    { s: 'TWSE:2882', name: '国泰金', code: '2882' },
    { s: 'TWSE:2412', name: '中华电', code: '2412' },
    { s: 'TWSE:2891', name: '中信金', code: '2891' },
    { s: 'TWSE:2382', name: '广达', code: '2382' },
    { s: 'TWSE:2357', name: '华硕', code: '2357' },
    { s: 'TWSE:6505', name: '台塑化', code: '6505' },
    { s: 'TWSE:2886', name: '兆丰金', code: '2886' },
  ];
  const ALL_SYMBOLS = [INDEX_DEF.s].concat(STOCKS.map((x) => x.s));

  const TV_SCAN_URL = 'https://scanner.tradingview.com/taiwan/scan';
  const scanBody = JSON.stringify({
    symbols: { tickers: ALL_SYMBOLS, query: { types: [] } },
    columns: ['close', 'change', 'change_abs', 'volume'],
  });

  const REFRESH_MS = 45000; // 交易时段刷新间隔 45s
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('twboard-style')) return;
    const style = document.createElement('style');
    style.id = 'twboard-style';
    style.textContent = `
.twb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.twb-head-right { display: flex; align-items: center; gap: 8px; }
.twb-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.twb-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.twb-status { color: var(--warning); white-space: nowrap; }
.twb-status.live { color: var(--acc); }
/* 国际习惯绿涨红跌：语义令牌 var(--up)/var(--down)，勿改用 --acc/--danger */
.twb-up { color: var(--up); }
.twb-down { color: var(--down); }
.twb-flat { color: var(--text-muted); }
.twb-index {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  background: var(--surface-raised);
  flex-wrap: wrap;
}
.twb-index-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.twb-index-label i { display: block; font-style: normal; font-size: 9px; color: var(--text-dim); letter-spacing: 0; margin-top: 2px; }
.twb-index-main { display: flex; align-items: baseline; gap: 10px; }
.twb-index-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.twb-index-chg {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.twb-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 1100px) {
  .twb-grid { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 720px) {
  .twb-grid { grid-template-columns: repeat(2, 1fr); }
}
.twb-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.twb-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.twb-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.twb-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.twb-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.twb-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.twb-vol {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.twb-vol b { font-weight: 400; color: var(--text-dim); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.twb-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.twb-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
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

  // 股价：整数去小数（2,470 / 3,700），非整数保留两位（97.30 / 242.50）
  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    return Number.isInteger(v) ? fmtNum(v, 0) : fmtNum(v, 2);
  };

  // 成交量（股）→ 张（1 张 = 1000 股），≥1 万张换「万张」
  const fmtVol = (shares) => {
    if (!Number.isFinite(shares) || shares <= 0) return '—';
    const lots = shares / 1000;
    if (lots >= 10000) return `${fmtNum(lots / 10000, 1)}万张`;
    return `${fmtNum(Math.round(lots), 0)}张`;
  };

  const dirArrow = (v) => {
    if (!Number.isFinite(v) || v === 0) return '·';
    return v > 0 ? '▲' : '▼';
  };

  // 绿涨红跌（国际习惯）
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'twb-flat';
    return v > 0 ? 'twb-up' : 'twb-down';
  };

  // 台股时段：周一至五 09:00-13:30 Asia/Taipei（UTC+8，无夏令时；不含法定节假日，仅按星期粗判）
  const isTrading = () => {
    const now = new Date();
    const tp = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const day = tp.getDay();
    if (day === 0 || day === 6) return false;
    const mins = tp.getHours() * 60 + tp.getMinutes();
    return mins >= 540 && mins <= 810; // 09:00 - 13:30
  };

  window.GT_EXTRA_TOOLS['twboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool twb-root">
          <div class="twb-head">
            <span>台股 · 盘面总览</span>
            <span class="twb-head-right">
              <span class="twb-session" data-session>—</span>
              <span class="twb-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="twb-index">
            <span class="twb-index-label">台湾加权指数<i>TAIEX · TWSE:IX0001</i></span>
            <span class="twb-index-main">
              <span class="twb-index-price" data-idx-price>—</span>
              <span class="twb-index-chg" data-idx-chg>—</span>
            </span>
          </div>
          <div class="twb-grid">
            ${STOCKS.map(
              (it) => `
              <div class="twb-card" data-s="${esc(it.s)}">
                <div class="twb-card-top">
                  <span class="twb-name">${esc(it.name)}</span>
                  <span class="twb-code">${esc(it.code)}</span>
                </div>
                <div class="twb-price twb-flat" data-price>—</div>
                <div class="twb-chg"><span data-chg class="twb-flat">—</span><span data-pct class="twb-flat">—</span></div>
                <div class="twb-vol"><span data-state>—</span><b data-vol>—</b></div>
              </div>`
            ).join('')}
          </div>
          <div class="twb-foot">
            <span data-src>来源：TradingView（TWSE 快照）· 单位 TWD</span>
            <span>绿涨红跌 · 更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const timeEl = el.querySelector('[data-time]');
      const idxPriceEl = el.querySelector('[data-idx-price]');
      const idxChgEl = el.querySelector('[data-idx-chg]');
      const cards = {};
      el.querySelectorAll('.twb-card').forEach((card) => {
        cards[card.getAttribute('data-s')] = {
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
          vol: card.querySelector('[data-vol]'),
          state: card.querySelector('[data-state]'),
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
        conn.className = 'twb-status';
        setStatus('offline');
      };
      const showLive = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'twb-status live';
        setStatus('online');
      };

      const renderSession = () => {
        if (isTrading()) {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'twb-session open';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'twb-session';
        }
      };

      // TradingView 批量快照：POST text/plain（CORS 简单请求，规避预检 content-type 限制），10s 超时
      const fetchScan = async () => {
        if (!alive) throw new Error('disposed');
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(TV_SCAN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: scanBody,
            signal: ctrl.signal,
            cache: 'no-store',
          });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          const json = await resp.json();
          const rows = json && Array.isArray(json.data) ? json.data : [];
          if (!rows.length) throw new Error('empty');
          return rows;
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      const render = (rows) => {
        const bySym = {};
        rows.forEach((r) => {
          if (r && r.s && Array.isArray(r.d)) bySym[r.s] = r.d;
        });
        // 加权指数
        const ix = bySym[INDEX_DEF.s];
        if (ix) {
          const price = Number(ix[0]);
          const pct = Number(ix[1]);
          const chg = Number(ix[2]);
          const cls = dirClass(chg);
          idxPriceEl.textContent = Number.isFinite(price) ? fmtNum(price, 2) : '—';
          idxPriceEl.className = `twb-index-price ${cls}`;
          idxChgEl.textContent = `${dirArrow(chg)} ${fmtSigned(chg, 2)} (${fmtSigned(pct, 2)}%)`;
          idxChgEl.className = `twb-index-chg ${cls}`;
        }
        // 个股
        const trading = isTrading();
        STOCKS.forEach((it) => {
          const d = bySym[it.s];
          const c = cards[it.s];
          if (!d || !c) return;
          const price = Number(d[0]);
          const pct = Number(d[1]);
          const chg = Number(d[2]);
          const vol = Number(d[3]);
          if (!Number.isFinite(price)) return;
          const cls = dirClass(chg);
          c.price.textContent = fmtPrice(price);
          c.price.className = `twb-price ${cls}`;
          c.chg.textContent = fmtSigned(chg, 2);
          c.chg.className = cls;
          c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
          c.pct.className = cls;
          c.vol.textContent = `量 ${fmtVol(vol)}`;
          // 成交状态：无成交量且处于交易时段 → 疑似停牌/未成交；否则跟随大盘时段
          c.state.textContent = !Number.isFinite(vol) || vol <= 0 ? (trading ? '未成交' : '—') : trading ? '交易中' : '已收盘';
        });
        timeEl.textContent = new Date().toTimeString().slice(0, 8);
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const rows = await fetchScan();
          if (!alive) return;
          render(rows);
          showLive();
        } catch (e) {
          if (!alive) return;
          showError('行情加载失败，45 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
        renderSession();
        if (isTrading() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
      renderSession();
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
