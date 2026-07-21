/* 印度股市行情板 — Nifty50 指数 + 印度国家交易所核心成分股（TradingView scanner，经 GT proxy）
 * 接口: GET https://scanner.tradingview.com/symbol?symbol=NSE:<code>&fields=close,change,change_abs,volume
 *       经 /api/proxy?url=... 转发。
 * 配色: 国际习惯绿涨红跌，inb-up(绿)/inb-down(红)。
 * 时段: NSE IST 周一至五 09:15-15:30。
 * Registers as custom tool id 'inboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEX = { symbol: 'NSE:NIFTY', name: 'Nifty 50', code: 'NIFTY' };
  const STOCKS = [
    { symbol: 'NSE:RELIANCE', name: '信实工业', code: 'RELIANCE' },
    { symbol: 'NSE:TCS', name: '塔塔咨询', code: 'TCS' },
    { symbol: 'NSE:INFY', name: '印孚瑟斯', code: 'INFY' },
    { symbol: 'NSE:HDFCBANK', name: 'HDFC银行', code: 'HDFCBANK' },
    { symbol: 'NSE:ICICIBANK', name: 'ICICI银行', code: 'ICICIBANK' },
    { symbol: 'NSE:HINDUNILVR', name: '印度联合利华', code: 'HINDUNILVR' },
    { symbol: 'NSE:SBIN', name: '印度国家银行', code: 'SBIN' },
    { symbol: 'NSE:BAJFINANCE', name: 'Bajaj Finance', code: 'BAJFINANCE' },
    { symbol: 'NSE:KOTAKBANK', name: 'Kotak银行', code: 'KOTAKBANK' },
    { symbol: 'NSE:ITC', name: 'ITC', code: 'ITC' },
    { symbol: 'NSE:LICI', name: '印度人寿保险', code: 'LICI' },
    { symbol: 'NSE:AXISBANK', name: 'Axis银行', code: 'AXISBANK' },
    { symbol: 'NSE:ASIANPAINT', name: '亚洲涂料', code: 'ASIANPAINT' },
    { symbol: 'NSE:MARUTI', name: '马鲁蒂', code: 'MARUTI' },
    { symbol: 'NSE:LT', name: 'Larsen & Toubro', code: 'LT' },
    { symbol: 'NSE:SUNPHARMA', name: '太阳制药', code: 'SUNPHARMA' },
  ];

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);
  const tvUrl = (symbol) =>
    `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const chartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const REFRESH_MS = 60000;
  const IDLE_REFRESH_MS = 5 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('inb-style')) return;
    const style = document.createElement('style');
    style.id = 'inb-style';
    style.textContent = `
.inb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.inb-head-right { display: flex; align-items: center; gap: 8px; }
.inb-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.inb-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.inb-status { color: var(--warning); white-space: nowrap; }
.inb-status.live { color: var(--acc); }
.inb-up { color: var(--up); }
.inb-down { color: var(--down); }
.inb-flat { color: var(--text-muted); }
.inb-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.inb-index {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  padding: 8px 10px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  text-decoration: none;
}
.inb-index-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.inb-index-label i { display: block; font-style: normal; font-size: 9px; color: var(--text-dim); letter-spacing: 0; margin-top: 2px; }
.inb-index-main { display: flex; align-items: baseline; gap: 10px; }
.inb-index-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.inb-index-chg {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.inb-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 1000px) {
  .inb-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 720px) {
  .inb-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .inb-grid { grid-template-columns: 1fr; }
}
.inb-card {
  display: block;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
  text-decoration: none;
  transition: border-color 0.15s var(--ease-snap);
}
.inb-card:hover { border-color: var(--acc-dim); }
.inb-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.inb-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inb-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.inb-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.inb-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.inb-vol {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.inb-vol b { font-weight: 400; color: var(--text-dim); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.inb-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.inb-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
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

  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    return Number.isInteger(v) ? fmtNum(v, 0) : fmtNum(v, 2);
  };

  const fmtVol = (shares) => {
    if (!Number.isFinite(shares) || shares <= 0) return '—';
    if (shares >= 1e8) return `${fmtNum(shares / 1e8, 2)}亿股`;
    if (shares >= 1e4) return `${fmtNum(shares / 1e4, 1)}万股`;
    return `${fmtNum(shares, 0)}股`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'inb-flat';
    return v > 0 ? 'inb-up' : 'inb-down';
  };

  const sessionState = () => {
    let ist;
    try {
      ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    } catch (e) {
      ist = new Date();
    }
    const day = ist.getDay();
    const mins = ist.getHours() * 60 + ist.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if (mins >= 555 && mins < 930) return 'trading';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['inboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool inb-root">
          <div class="inb-head">
            <span>印度 · Nifty50 行情板</span>
            <span class="inb-head-right">
              <span class="inb-session" data-session>—</span>
              <span class="inb-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="inb-sub">
            <span>NSE 核心成分股 · 绿涨红跌 · 60s 刷新</span>
            <span>单位 INR</span>
          </div>
          <a class="inb-index" href="${esc(chartUrl(INDEX.symbol))}" target="_blank" rel="noopener">
            <span class="inb-index-label">${esc(INDEX.name)}<i>${esc(INDEX.code)} · ${esc(INDEX.symbol)}</i></span>
            <span class="inb-index-main">
              <span class="inb-index-price inb-flat" data-idx-price>—</span>
              <span class="inb-index-chg inb-flat" data-idx-chg>—</span>
            </span>
          </a>
          <div class="inb-grid">
            ${STOCKS.map(
              (s) => `
              <a class="inb-card" href="${esc(chartUrl(s.symbol))}" target="_blank" rel="noopener" data-sym="${esc(s.symbol)}">
                <div class="inb-card-top">
                  <span class="inb-name">${esc(s.name)}</span>
                  <span class="inb-code">${esc(s.code)}</span>
                </div>
                <div class="inb-price inb-flat" data-price>—</div>
                <div class="inb-chg"><span data-chg class="inb-flat">—</span><span data-pct class="inb-flat">—</span></div>
                <div class="inb-vol"><span>成交</span><b data-vol>—</b></div>
              </a>`
            ).join('')}
          </div>
          <div class="inb-foot">
            <span>来源：TradingView（经 GT proxy）· 延时行情</span>
            <span>更新 <b data-time>—</b></span>
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
      el.querySelectorAll('.inb-card').forEach((card) => {
        cards[card.getAttribute('data-sym')] = {
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
          vol: card.querySelector('[data-vol]'),
        };
      });

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingTimers = new Set();
      const pendingAborts = new Set();

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'inb-status';
        setStatus('offline');
      };
      const showLive = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'inb-status live';
        setStatus('online');
      };

      const renderSession = () => {
        if (sessionState() === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'inb-session open';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'inb-session';
        }
      };

      const fetchOne = async (symbol) => {
        if (!alive) throw new Error('disposed');
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(proxy(tvUrl(symbol)), { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          const json = await resp.json();
          const close = Number(json && json.close);
          if (!Number.isFinite(close)) throw new Error('empty');
          return {
            symbol,
            price: close,
            pct: Number(json.change),
            chg: Number(json.change_abs),
            vol: Number(json.volume),
          };
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      const renderOne = (item) => {
        if (item.symbol === INDEX.symbol) {
          const cls = dirClass(item.chg);
          idxPriceEl.textContent = fmtPrice(item.price);
          idxPriceEl.className = `inb-index-price ${cls}`;
          idxChgEl.textContent = `${fmtSigned(item.chg, 2)} (${fmtSigned(item.pct, 2)}%)`;
          idxChgEl.className = `inb-index-chg ${cls}`;
          return;
        }
        const c = cards[item.symbol];
        if (!c) return;
        const cls = dirClass(item.chg);
        c.price.textContent = fmtPrice(item.price);
        c.price.className = `inb-price ${cls}`;
        c.chg.textContent = fmtSigned(item.chg, 2);
        c.chg.className = cls;
        c.pct.textContent = Number.isFinite(item.pct) ? `${fmtSigned(item.pct, 2)}%` : '—';
        c.pct.className = cls;
        c.vol.textContent = fmtVol(item.vol);
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const results = await Promise.allSettled([fetchOne(INDEX.symbol)].concat(STOCKS.map((s) => fetchOne(s.symbol))));
          if (!alive) return;
          const ok = results.filter((r) => r.status === 'fulfilled');
          if (!ok.length) {
            showError('行情加载失败，60 秒后自动重试…');
            return;
          }
          ok.forEach((r) => renderOne(r.value));
          const failed = results.length - ok.length;
          showLive(failed ? `${failed} 只标的失败，其余正常` : '');
          timeEl.textContent = new Date().toTimeString().slice(0, 8);
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return;
        renderSession();
        if (sessionState() === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
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
          } catch (e) { /* ignore */ }
        });
        pendingAborts.clear();
      };
    },
  };
})();
