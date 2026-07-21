/* 亚太明星股 — TradingView scanner 批量接口（CORS JSON，POST）
 * 接口: POST https://scanner.tradingview.com/{market}/scan
 *        market ∈ japan/korea/india/singapore；body: {"symbols":{"tickers":[...],"query":{"types":[]}},"columns":["close","change","volume"]}
 *        响应 { data: [{ s: "TSE:7203", d: [close, change, volume] }] }，change=涨跌幅%
 *        响应头 Access-Control-Allow-Origin 反射 Origin，浏览器跨域可用（curl 实测 2026-07-16）；
 *        注意 POST 不得显式设 Content-Type: application/json：预检 allow-headers 仅 Referer,Accept，
 *        不含 content-type，会被浏览器拦截；以字符串 body（text/plain 简单请求）发送即可正常解析。
 *        数据为 TradingView 延时行情（日/韩/印/新约延时 15 分钟，页脚已注明）。
 * 代码勘误（2026-07-16 curl 实测）:
 *   - 任务指定"丰田 7207"有误：TSE:7207 在 TradingView 返回 404 symbol_not_exists，
 *     丰田汽车正确代码为 TSE:7203（本组件采用 7203）。
 *   - 单标的 GET https://scanner.tradingview.com/symbol?symbol=KRX:005930&fields=close,change,volume
 *     同样可用（200 + CORS），本组件采用每市场一次 POST 批量请求（共 4 次）以减少请求数。
 * 配色: 国际习惯绿涨红跌，用 ahot-up(绿 var(--up))/ahot-down(红 var(--down)) 语义令牌。
 * 交易时段（按各市场本地时区计算，UTC 偏移法，不依赖浏览器时区）:
 *   日本 TSE  UTC+9    周一至五 09:00-11:30 / 12:30-15:00（午间休市显示"午休"）
 *   韩国 KRX  UTC+9    周一至五 09:00-15:30
 *   印度 NSE  UTC+5:30 周一至五 09:15-15:30
 *   新加坡 SGX UTC+8   周一至五 09:00-17:00
 * 刷新: 任一市场交易/午休中 60s；全部休市降频 5 分钟；document.hidden 跳过。
 * Registers as custom tool id 'asiahot' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // tzOffset: 相对 UTC 的分钟偏移；sessions: 本地时间 [起, 止)（分钟）
  const MARKETS = [
    {
      key: 'japan',
      name: '日本',
      tzOffset: 9 * 60,
      sessions: [
        [9 * 60, 11 * 60 + 30],
        [12 * 60 + 30, 15 * 60],
      ],
      lunch: [11 * 60 + 30, 12 * 60 + 30], // 午休段（仅日本展示）
      stocks: [
        { sym: 'TSE:7203', code: '7203', cn: '丰田汽车' },
        { sym: 'TSE:6758', code: '6758', cn: '索尼集团' },
        { sym: 'TSE:9984', code: '9984', cn: '软银集团' },
        { sym: 'TSE:8035', code: '8035', cn: '东京电子' },
        { sym: 'TSE:7974', code: '7974', cn: '任天堂' },
      ],
    },
    {
      key: 'korea',
      name: '韩国',
      tzOffset: 9 * 60,
      sessions: [[9 * 60, 15 * 60 + 30]],
      stocks: [
        { sym: 'KRX:005930', code: '005930', cn: '三星电子' },
        { sym: 'KRX:000660', code: '000660', cn: 'SK海力士' },
        { sym: 'KRX:373220', code: '373220', cn: 'LG新能源' },
      ],
    },
    {
      key: 'india',
      name: '印度',
      tzOffset: 5 * 60 + 30,
      sessions: [[9 * 60 + 15, 15 * 60 + 30]],
      stocks: [
        { sym: 'NSE:RELIANCE', code: 'RELIANCE', cn: '信实工业' },
        { sym: 'NSE:TCS', code: 'TCS', cn: '塔塔咨询' },
        { sym: 'NSE:INFY', code: 'INFY', cn: '印孚瑟斯' },
      ],
    },
    {
      key: 'singapore',
      name: '新加坡',
      tzOffset: 8 * 60,
      sessions: [[9 * 60, 17 * 60]],
      stocks: [
        { sym: 'SGX:D05', code: 'D05', cn: '星展银行' },
        { sym: 'SGX:O39', code: 'O39', cn: '华侨银行' },
        { sym: 'SGX:Z74', code: 'Z74', cn: '新电信' },
      ],
    },
  ];

  const scanUrl = (market) => `https://scanner.tradingview.com/${market}/scan`;

  const REFRESH_MS = 60000; // 刷新间隔 60s
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 全部休市低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('ahot-style')) return;
    const style = document.createElement('style');
    style.id = 'ahot-style';
    style.textContent = `
.ahot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.ahot-status { color: var(--warning); white-space: nowrap; }
.ahot-status.live { color: var(--acc); }
/* 国际习惯绿涨红跌：语义令牌 var(--up)/var(--down)，勿改用 --acc/--danger */
.ahot-up { color: var(--up); }
.ahot-down { color: var(--down); }
.ahot-flat { color: var(--text-muted); }
.ahot-mkt {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  padding: 6px 10px 4px;
  margin-bottom: 8px;
}
.ahot-mkt-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.ahot-mkt-name {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text);
}
.ahot-badge {
  font-size: 9px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ahot-badge.open {
  color: var(--acc);
  border-color: var(--acc);
  background: var(--acc-glow);
}
.ahot-badge.lunch { color: var(--warning); border-color: var(--warning); }
.ahot-mkt-time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ahot-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  border-top: 1px solid var(--hairline);
}
.ahot-row-name {
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ahot-row-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.ahot-row-price {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ahot-row-pct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 64px;
  text-align: right;
}
.ahot-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.ahot-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  // 各市场本地价格小数位：日股整数（8035 约 7 万日元）、韩股整数、印/新两位
  const priceDigits = (mktKey) => (mktKey === 'japan' || mktKey === 'korea' ? 0 : 2);

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ahot-flat';
    return v > 0 ? 'ahot-up' : 'ahot-down';
  };

  // 市场本地时间（UTC 偏移法）：返回 { day: 0-6(周一=0), minutes: 当日分钟, hhmm }
  const marketNow = (mkt) => {
    const now = Date.now() + mkt.tzOffset * 60000;
    const d = new Date(now);
    const day = (d.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return { day, minutes, hhmm: `${hh}:${mm}` };
  };

  // 市场状态: 'open' 交易中 / 'lunch' 午休 / 'closed' 休市
  const marketState = (mkt) => {
    const t = marketNow(mkt);
    if (t.day >= 5) return 'closed'; // 周六日
    for (let i = 0; i < mkt.sessions.length; i += 1) {
      if (t.minutes >= mkt.sessions[i][0] && t.minutes < mkt.sessions[i][1]) return 'open';
    }
    if (mkt.lunch && t.minutes >= mkt.lunch[0] && t.minutes < mkt.lunch[1]) return 'lunch';
    return 'closed';
  };

  const allClosed = () => MARKETS.every((m) => marketState(m) === 'closed');

  window.GT_EXTRA_TOOLS['asiahot'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool ahot-root">
          <div class="ahot-head">
            <span>亚太明星股</span>
            <span class="ahot-status" data-conn>连接中…</span>
          </div>
          ${MARKETS.map(
            (m) => `
            <div class="ahot-mkt" data-mkt="${esc(m.key)}">
              <div class="ahot-mkt-head">
                <span class="ahot-mkt-name">${esc(m.name)}</span>
                <span class="ahot-badge" data-badge>—</span>
                <span class="ahot-mkt-time" data-localtime>—</span>
              </div>
              ${m.stocks
                .map(
                  (s) => `
                <div class="ahot-row" data-sym="${esc(s.sym)}">
                  <span class="ahot-row-name">${esc(s.cn)}</span>
                  <span class="ahot-row-code">${esc(s.code)}</span>
                  <span class="ahot-row-price ahot-flat" data-price>—</span>
                  <span class="ahot-row-pct ahot-flat" data-pct>—</span>
                </div>`
                )
                .join('')}
            </div>`
          ).join('')}
          <div class="ahot-foot">
            <span>来源：TradingView（延时约 15 分钟）</span>
            <span>绿涨红跌 · 更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const timeEl = el.querySelector('[data-time]');
      const mktEls = {};
      el.querySelectorAll('.ahot-mkt').forEach((mktEl) => {
        const rows = {};
        mktEl.querySelectorAll('.ahot-row').forEach((row) => {
          rows[row.getAttribute('data-sym')] = {
            price: row.querySelector('[data-price]'),
            pct: row.querySelector('[data-pct]'),
          };
        });
        mktEls[mktEl.getAttribute('data-mkt')] = {
          badge: mktEl.querySelector('[data-badge]'),
          localtime: mktEl.querySelector('[data-localtime]'),
          rows,
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
        conn.className = 'ahot-status';
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
        conn.className = 'ahot-status live';
        setStatus('online');
      };

      const updateBadges = () => {
        MARKETS.forEach((m) => {
          const ui = mktEls[m.key];
          if (!ui) return;
          const st = marketState(m);
          ui.badge.textContent = st === 'open' ? '交易中' : st === 'lunch' ? '午休' : '休市';
          ui.badge.className = `ahot-badge${st === 'open' ? ' open' : st === 'lunch' ? ' lunch' : ''}`;
          ui.localtime.textContent = marketNow(m).hhmm;
        });
      };

      // 单市场批量请求（POST，10s 超时）
      const fetchMarket = async (mkt) => {
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          // 注意：不显式设置 Content-Type（字符串 body 默认 text/plain，属简单请求）；
          // 若设 application/json 会触发 CORS 预检，而该接口 allow-headers 不含 content-type，
          // 浏览器端将被拦截（2026-07-16 实测 OPTIONS 预检 204 但 allow-headers: Referer,Accept）。
          const resp = await fetch(scanUrl(mkt.key), {
            method: 'POST',
            body: JSON.stringify({
              symbols: { tickers: mkt.stocks.map((s) => s.sym), query: { types: [] } },
              columns: ['close', 'change', 'volume'],
            }),
            signal: ctrl.signal,
            cache: 'no-store',
          });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          const json = await resp.json();
          const data = json && Array.isArray(json.data) ? json.data : [];
          if (!data.length) throw new Error('empty');
          return data;
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      const renderMarket = (mkt, data) => {
        const ui = mktEls[mkt.key];
        if (!ui) return;
        const digits = priceDigits(mkt.key);
        data.forEach((item) => {
          const c = ui.rows[item && item.s];
          if (!c || !Array.isArray(item.d)) return;
          const price = Number(item.d[0]);
          const pct = Number(item.d[1]);
          if (!Number.isFinite(price)) return;
          const cls = dirClass(pct);
          c.price.textContent = fmtNum(price, digits);
          c.price.className = `ahot-row-price ${cls}`;
          c.pct.textContent = Number.isFinite(pct) ? `${pct > 0 ? '+' : ''}${fmtNum(pct, 2)}%` : '—';
          c.pct.className = `ahot-row-pct ${cls}`;
        });
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const results = await Promise.allSettled(MARKETS.map((m) => fetchMarket(m)));
          if (!alive) return;
          const okCount = results.filter((r) => r.status === 'fulfilled').length;
          if (okCount === 0) {
            showError('行情加载失败，60 秒后自动重试…');
            return;
          }
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') renderMarket(MARKETS[i], r.value);
          });
          const failedNames = results
            .map((r, i) => (r.status === 'rejected' ? MARKETS[i].name : null))
            .filter(Boolean)
            .join('、');
          showLive(failedNames ? `${failedNames}行情加载失败，其余正常，60 秒后自动重试…` : '');
          const now = new Date();
          timeEl.textContent = now.toTimeString().slice(0, 8);
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
        updateBadges();
        if (!allClosed() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
      updateBadges();
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
