/* 日股行情板 — 日经225 + 日本东证所明星股（TradingView scanner，经 GT proxy）
 * 接口: GET https://scanner.tradingview.com/symbol?symbol=TSE:<code>&fields=close,change,change_abs,volume
 *       经 /api/proxy?url=... 转发以绕开浏览器 CORS。
 * 字段: close=现价 change=涨跌幅% change_abs=涨跌额 volume=成交量(股)
 * 配色: 国际习惯绿涨红跌，方向着色 jpb-up(绿 var(--up))/jpb-down(红 var(--down))。
 * 时段: 东证 JST 周一至五 09:00-11:30 / 12:30-15:00，午休显示“午休”。
 * Registers as custom tool id 'jpboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEX = { symbol: 'TVC:NI225', name: '日经225', code: 'N225' };
  const STOCKS = [
    { symbol: 'TSE:7203', name: '丰田汽车', code: '7203' },
    { symbol: 'TSE:6758', name: '索尼集团', code: '6758' },
    { symbol: 'TSE:9984', name: '软银集团', code: '9984' },
    { symbol: 'TSE:8035', name: '东京电子', code: '8035' },
    { symbol: 'TSE:7974', name: '任天堂', code: '7974' },
    { symbol: 'TSE:6861', name: '基恩士', code: '6861' },
    { symbol: 'TSE:8306', name: '三菱UFJ', code: '8306' },
    { symbol: 'TSE:9983', name: '迅销', code: '9983' },
    { symbol: 'TSE:9433', name: 'KDDI', code: '9433' },
    { symbol: 'TSE:6501', name: '日立', code: '6501' },
    { symbol: 'TSE:7751', name: '佳能', code: '7751' },
    { symbol: 'TSE:6752', name: '松下', code: '6752' },
    { symbol: 'TSE:7267', name: '本田', code: '7267' },
    { symbol: 'TSE:4568', name: '第一三共', code: '4568' },
    { symbol: 'TSE:3382', name: '7&i控股', code: '3382' },
  ];

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);
  const tvUrl = (symbol) =>
    `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const chartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const REFRESH_MS = 60000;
  const IDLE_REFRESH_MS = 5 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('jpb-style')) return;
    const style = document.createElement('style');
    style.id = 'jpb-style';
    style.textContent = `
.jpb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.jpb-head-right { display: flex; align-items: center; gap: 8px; }
.jpb-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.jpb-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.jpb-session.lunch { color: var(--warning); border-color: var(--warning); }
.jpb-status { color: var(--warning); white-space: nowrap; }
.jpb-status.live { color: var(--acc); }
.jpb-up { color: var(--up); }
.jpb-down { color: var(--down); }
.jpb-flat { color: var(--text-muted); }
.jpb-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.jpb-index {
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
}
.jpb-index-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.jpb-index-label i { display: block; font-style: normal; font-size: 9px; color: var(--text-dim); letter-spacing: 0; margin-top: 2px; }
.jpb-index-main { display: flex; align-items: baseline; gap: 10px; }
.jpb-index-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.jpb-index-chg {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.jpb-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 900px) {
  .jpb-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
  .jpb-grid { grid-template-columns: 1fr; }
}
.jpb-card {
  display: block;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
  text-decoration: none;
  transition: border-color 0.15s var(--ease-snap);
}
.jpb-card:hover { border-color: var(--acc-dim); }
.jpb-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.jpb-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jpb-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.jpb-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.jpb-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.jpb-vol {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.jpb-vol b { font-weight: 400; color: var(--text-dim); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.jpb-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.jpb-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
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
    if (!Number.isFinite(v) || v === 0) return 'jpb-flat';
    return v > 0 ? 'jpb-up' : 'jpb-down';
  };

  const sessionState = () => {
    let jp;
    try {
      jp = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    } catch (e) {
      jp = new Date();
    }
    const day = jp.getDay();
    const mins = jp.getHours() * 60 + jp.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if (mins >= 540 && mins < 690) return 'trading';
    if (mins >= 690 && mins < 750) return 'lunch';
    if (mins >= 750 && mins < 900) return 'trading';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['jpboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool jpb-root">
          <div class="jpb-head">
            <span>日股 · 行情板</span>
            <span class="jpb-head-right">
              <span class="jpb-session" data-session>—</span>
              <span class="jpb-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="jpb-sub">
            <span>日经225 + 东证所核心蓝筹 · 绿涨红跌 · 60s 刷新</span>
            <span>单位 JPY</span>
          </div>
          <a class="jpb-index" href="${esc(chartUrl(INDEX.symbol))}" target="_blank" rel="noopener">
            <span class="jpb-index-label">${esc(INDEX.name)}<i>${esc(INDEX.code)} · ${esc(INDEX.symbol)}</i></span>
            <span class="jpb-index-main">
              <span class="jpb-index-price jpb-flat" data-idx-price>—</span>
              <span class="jpb-index-chg jpb-flat" data-idx-chg>—</span>
            </span>
          </a>
          <div class="jpb-grid">
            ${STOCKS.map(
              (s) => `
              <a class="jpb-card" href="${esc(chartUrl(s.symbol))}" target="_blank" rel="noopener" data-sym="${esc(s.symbol)}">
                <div class="jpb-card-top">
                  <span class="jpb-name">${esc(s.name)}</span>
                  <span class="jpb-code">${esc(s.code)}</span>
                </div>
                <div class="jpb-price jpb-flat" data-price>—</div>
                <div class="jpb-chg"><span data-chg class="jpb-flat">—</span><span data-pct class="jpb-flat">—</span></div>
                <div class="jpb-vol"><span>成交</span><b data-vol>—</b></div>
              </a>`
            ).join('')}
          </div>
          <div class="jpb-foot">
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
      el.querySelectorAll('.jpb-card').forEach((card) => {
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
        conn.className = 'jpb-status';
        setStatus('offline');
      };
      const showLive = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'jpb-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'jpb-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午休';
          sessionEl.className = 'jpb-session lunch';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'jpb-session';
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
          idxPriceEl.className = `jpb-index-price ${cls}`;
          idxChgEl.textContent = `${fmtSigned(item.chg, 2)} (${fmtSigned(item.pct, 2)}%)`;
          idxChgEl.className = `jpb-index-chg ${cls}`;
          return;
        }
        const c = cards[item.symbol];
        if (!c) return;
        const cls = dirClass(item.chg);
        c.price.textContent = fmtPrice(item.price);
        c.price.className = `jpb-price ${cls}`;
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
        } catch (e) {
          if (!alive) return;
          showError('行情加载失败，60 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return;
        renderSession();
        const s = sessionState();
        if (s === 'trading' || s === 'lunch' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
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
