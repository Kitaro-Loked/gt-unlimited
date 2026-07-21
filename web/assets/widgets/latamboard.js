/* 拉丁美洲股市行情板 — 巴西 / 墨西哥 / 阿根廷 / 智利 / 哥伦比亚
 * Registers as custom tool id 'latamboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEXES = [
    { symbol: 'BMFBOVESPA:IBOV', name: '巴西Bovespa', code: 'IBOV', tz: 'America/Sao_Paulo', open: [10, 0], close: [17, 0], weekdays: true },
    { symbol: 'BMV:ME', name: '墨西哥IPC', code: 'IPC', tz: 'America/Mexico_City', open: [8, 30], close: [15, 0], weekdays: true },
    { symbol: 'BCBA:IMV', name: '阿根廷MERVAL', code: 'MERVAL', tz: 'America/Argentina/Buenos_Aires', open: [11, 0], close: [17, 0], weekdays: true },
    { symbol: 'BCS:SP_IPSA', name: '智利IPSA', code: 'IPSA', tz: 'America/Santiago', open: [9, 30], close: [16, 0], weekdays: true },
    { symbol: 'BVC:ICAP', name: '哥伦比亚COLCAP', code: 'COLCAP', tz: 'America/Bogota', open: [9, 30], close: [15, 55], weekdays: true },
  ];

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);
  const tvUrl = (symbol) => `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const chartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('lab-style')) return;
    const style = document.createElement('style');
    style.id = 'lab-style';
    style.textContent = `
.lab-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; letter-spacing:0.14em; color:var(--text-muted); margin-bottom:6px; }
.lab-status { color:var(--warning); white-space:nowrap; }
.lab-status.live { color:var(--acc); }
.lab-sub { font-size:9px; color:var(--text-dim); margin-bottom:8px; }
.lab-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:8px; }
@media (max-width:480px){ .lab-grid { grid-template-columns:1fr; } }
.lab-card { display:block; border:1px solid var(--hairline); border-radius:var(--radius-sm); padding:8px 10px; background:var(--surface-raised); text-decoration:none; transition:border-color .15s; }
.lab-card:hover { border-color:var(--acc-dim); }
.lab-card-top { display:flex; justify-content:space-between; align-items:baseline; gap:6px; margin-bottom:4px; }
.lab-name { font-size:11px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lab-code { font-size:9px; color:var(--text-dim); font-family:var(--font-mono); }
.lab-price { font-family:var(--font-mono); font-size:17px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; white-space:nowrap; }
.lab-chg { display:flex; gap:8px; font-family:var(--font-mono); font-size:11px; margin-top:1px; }
.lab-session { display:inline-block; margin-top:6px; padding:1px 6px; border-radius:999px; border:1px solid var(--hairline); font-size:9px; font-family:var(--font-mono); }
.lab-session.open { color:var(--up); border-color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); }
.lab-session.closed { color:var(--text-muted); border-color:var(--hairline); }
.lab-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); flex-wrap:wrap; }
.lab-up { color:var(--up); } .lab-down { color:var(--down); } .lab-flat { color:var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  const fmtNum = (v,d) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const fmtSigned = (v,d) => Number.isFinite(v) ? (v>0?'+':'')+fmtNum(v,d) : '—';
  const fmtPrice = (v) => Number.isFinite(v) ? (Number.isInteger(v)?fmtNum(v,0):fmtNum(v,2)) : '—';
  const dirClass = (v) => !Number.isFinite(v) || v===0 ? 'lab-flat' : v>0 ? 'lab-up' : 'lab-down';

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

  window.GT_EXTRA_TOOLS['latamboard'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool lab-root">
          <div class="lab-head"><span>拉美 · 行情板</span><span class="lab-status" data-conn>连接中…</span></div>
          <div class="lab-sub">巴西 / 墨西哥 / 阿根廷 / 智利 / 哥伦比亚 · 状态与行情</div>
          <div class="lab-grid">
            ${INDEXES.map((it) => `
              <a class="lab-card" href="${esc(chartUrl(it.symbol))}" target="_blank" rel="noopener" data-sym="${esc(it.symbol)}">
                <div class="lab-card-top"><span class="lab-name">${esc(it.name)}</span><span class="lab-code">${esc(it.code)}</span></div>
                <div class="lab-price lab-flat" data-price>—</div>
                <div class="lab-chg"><span data-chg class="lab-flat">—</span><span data-pct class="lab-flat">—</span></div>
                <span class="lab-session closed" data-session>—</span>
              </a>`).join('')}
          </div>
          <div class="lab-foot"><span>来源：TradingView scanner（经 GT proxy）</span><span>更新 <b data-time>—</b></span></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const timeEl = el.querySelector('[data-time]');
      const cards = {};
      el.querySelectorAll('.lab-card').forEach((card) => {
        cards[card.getAttribute('data-sym')] = { price:card.querySelector('[data-price]'), chg:card.querySelector('[data-chg]'), pct:card.querySelector('[data-pct]'), session:card.querySelector('[data-session]') };
      });

      const updateSession = () => {
        INDEXES.forEach((it) => {
          const c = cards[it.symbol];
          if (!c) return;
          const st = sessionState(it);
          if (st) { c.session.textContent = st.label; c.session.className = `lab-session ${st.state}`; }
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
        c.price.className = `lab-price ${cls}`;
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
          conn.className = ok.length ? 'lab-status live' : 'lab-status';
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
