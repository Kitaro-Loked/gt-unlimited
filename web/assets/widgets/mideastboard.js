/* 中东股市行情板 — 沙特 / 阿联酋 / 卡塔尔 / 以色列 / 埃及
 * 因 TradingView 前端嵌入在该地区常受限，本组件以"市场状态 + 外部链接"为主展示，
 * 同时经 GT proxy 尝试 TradingView scanner 获取实时数据作为辅助。
 * Registers as custom tool id 'mideastboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEXES = [
    { symbol: 'TADAWUL:TASI', name: '沙特Tadawul', code: 'TASI', tz: 'Asia/Riyadh', open: [10, 0], close: [15, 0], days: [0, 1, 2, 3, 4] },
    { symbol: 'DFM:DFMGI', name: '迪拜DFM', code: 'DFMGI', tz: 'Asia/Dubai', open: [10, 0], close: [15, 0], weekdays: true },
    { symbol: 'QSE:GNRI', name: '卡塔尔QE', code: 'GNRI', tz: 'Asia/Qatar', open: [9, 30], close: [13, 10], days: [0, 1, 2, 3, 4] },
    { symbol: 'TASE:TA35', name: '以色列TA35', code: 'TA35', tz: 'Asia/Jerusalem', open: [10, 0], close: [17, 25], days: [0, 1, 2, 3, 4] },
    { symbol: 'EGX:EGX30', name: '埃及EGX30', code: 'EGX30', tz: 'Africa/Cairo', open: [10, 0], close: [14, 30], weekdays: true },
  ];

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);
  const tvUrl = (symbol) => `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const chartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('meb-style')) return;
    const style = document.createElement('style');
    style.id = 'meb-style';
    style.textContent = `
.meb-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; letter-spacing:0.14em; color:var(--text-muted); margin-bottom:6px; }
.meb-status { color:var(--warning); white-space:nowrap; }
.meb-status.live { color:var(--acc); }
.meb-sub { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); margin-bottom:8px; }
.meb-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:8px; }
@media (max-width:480px){ .meb-grid { grid-template-columns:1fr; } }
.meb-card { display:block; border:1px solid var(--hairline); border-radius:var(--radius-sm); padding:8px 10px; background:var(--surface-raised); text-decoration:none; transition:border-color .15s; }
.meb-card:hover { border-color:var(--acc-dim); }
.meb-card-top { display:flex; justify-content:space-between; align-items:baseline; gap:6px; margin-bottom:4px; }
.meb-name { font-size:11px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.meb-code { font-size:9px; color:var(--text-dim); font-family:var(--font-mono); }
.meb-price { font-family:var(--font-mono); font-size:17px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; white-space:nowrap; }
.meb-chg { display:flex; gap:8px; font-family:var(--font-mono); font-size:11px; margin-top:1px; }
.meb-session { display:inline-block; margin-top:6px; padding:1px 6px; border-radius:999px; border:1px solid var(--hairline); font-size:9px; font-family:var(--font-mono); }
.meb-session.open { color:var(--up); border-color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); }
.meb-session.closed { color:var(--text-muted); border-color:var(--hairline); }
.meb-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); flex-wrap:wrap; }
.meb-up { color:var(--up); } .meb-down { color:var(--down); } .meb-flat { color:var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  const fmtNum = (v,d) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const fmtSigned = (v,d) => Number.isFinite(v) ? (v>0?'+':'')+fmtNum(v,d) : '—';
  const fmtPrice = (v) => Number.isFinite(v) ? (Number.isInteger(v)?fmtNum(v,0):fmtNum(v,2)) : '—';
  const dirClass = (v) => !Number.isFinite(v) || v===0 ? 'meb-flat' : v>0 ? 'meb-up' : 'meb-down';

  function sessionState(item) {
    let local;
    try { local = new Date(new Date().toLocaleString('en-US', { timeZone: item.tz })); } catch(e){ return null; }
    const day = local.getDay();
    const mins = local.getHours()*60 + local.getMinutes();
    const days = item.days || (item.weekdays ? [1,2,3,4,5] : [0,1,2,3,4,5,6]);
    if (!days.includes(day)) return { state:'closed', label:'休市' };
    const openM = item.open[0]*60 + item.open[1];
    const closeM = item.close[0]*60 + item.close[1];
    if (mins < openM) return { state:'closed', label:`未开盘·${Math.floor((openM-mins)/60)}h${String((openM-mins)%60).padStart(2,'0')}m` };
    if (mins < closeM) return { state:'open', label:`交易中·剩${Math.floor((closeM-mins)/60)}h${String((closeM-mins)%60).padStart(2,'0')}m` };
    return { state:'closed', label:'已收盘' };
  }

  window.GT_EXTRA_TOOLS['mideastboard'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool meb-root">
          <div class="meb-head"><span>中东 · 行情板</span><span class="meb-status" data-conn>连接中…</span></div>
          <div class="meb-sub"><span>沙特 / 阿联酋 / 卡塔尔 / 以色列 / 埃及 · 状态与行情</span><span>GMT+3/4</span></div>
          <div class="meb-grid">
            ${INDEXES.map((it) => `
              <a class="meb-card" href="${esc(chartUrl(it.symbol))}" target="_blank" rel="noopener" data-sym="${esc(it.symbol)}">
                <div class="meb-card-top"><span class="meb-name">${esc(it.name)}</span><span class="meb-code">${esc(it.code)}</span></div>
                <div class="meb-price meb-flat" data-price>—</div>
                <div class="meb-chg"><span data-chg class="meb-flat">—</span><span data-pct class="meb-flat">—</span></div>
                <span class="meb-session closed" data-session>—</span>
              </a>`).join('')}
          </div>
          <div class="meb-foot"><span>来源：TradingView scanner（经 GT proxy）/ 交易所链接</span><span>更新 <b data-time>—</b></span></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const timeEl = el.querySelector('[data-time]');
      const cards = {};
      el.querySelectorAll('.meb-card').forEach((card) => {
        cards[card.getAttribute('data-sym')] = { price:card.querySelector('[data-price]'), chg:card.querySelector('[data-chg]'), pct:card.querySelector('[data-pct]'), session:card.querySelector('[data-session]') };
      });

      const updateSession = () => {
        INDEXES.forEach((it) => {
          const c = cards[it.symbol];
          if (!c) return;
          const st = sessionState(it);
          if (st) { c.session.textContent = st.label; c.session.className = `meb-session ${st.state}`; }
        });
      };
      updateSession();
      const sessionTimer = setInterval(updateSession, 30000);

      let alive = true, tickTimer = null;
      const renderOne = (item) => {
        const c = cards[item.symbol];
        if (!c) return;
        const cls = dirClass(item.chg);
        c.price.textContent = fmtPrice(item.price);
        c.price.className = `meb-price ${cls}`;
        c.chg.textContent = fmtSigned(item.chg, 2);
        c.chg.className = cls;
        c.pct.textContent = Number.isFinite(item.pct) ? `${fmtSigned(item.pct,2)}%` : '—';
        c.pct.className = cls;
      };

      const fetchOne = async (symbol) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
          const resp = await fetch(proxy(tvUrl(symbol)), { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error('http');
          const json = await resp.json();
          const close = Number(json.close);
          if (!Number.isFinite(close)) throw new Error('empty');
          return { symbol, price: close, pct: Number(json.change), chg: Number(json.change_abs) };
        } finally { clearTimeout(timer); }
      };

      const refresh = async () => {
        if (!alive) return;
        try {
          const results = await Promise.allSettled(INDEXES.map((it) => fetchOne(it.symbol)));
          if (!alive) return;
          const ok = results.filter((r) => r.status === 'fulfilled');
          ok.forEach((r) => renderOne(r.value));
          conn.textContent = ok.length ? '● LIVE' : '连接失败';
          conn.className = ok.length ? 'meb-status live' : 'meb-status';
          setStatus(ok.length ? 'online' : 'offline');
          timeEl.textContent = new Date().toTimeString().slice(0,8);
        } catch (e) { setStatus('offline'); }
      };

      setStatus('loading');
      refresh();
      tickTimer = setInterval(refresh, REFRESH_MS);

      return () => { alive=false; clearInterval(tickTimer); clearInterval(sessionTimer); };
    },
  };
})();
