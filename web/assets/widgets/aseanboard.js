/* 东盟股市行情板 — 新加坡 / 马来西亚 / 泰国 / 印尼 / 菲律宾 / 越南
 * Registers as custom tool id 'aseanboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEXES = [
    { symbol: 'SGX:ES3', name: '新加坡STI(ES3)', code: 'ES3', tz: 'Asia/Singapore', open: [9, 0], close: [17, 0], weekdays: true },
    { symbol: 'FTSEMYX:FBMKLCI', name: '马来西亚KLCI', code: 'KLCI', tz: 'Asia/Kuala_Lumpur', open: [9, 0], close: [17, 0], weekdays: true },
    { symbol: 'SET:SET', name: '泰国SET', code: 'SET', tz: 'Asia/Bangkok', open: [10, 0], close: [16, 30], weekdays: true },
    { symbol: 'IDX:COMPOSITE', name: '印尼IDX', code: 'IDX', tz: 'Asia/Jakarta', open: [9, 0], close: [15, 0], weekdays: true },
    { symbol: 'PSE:PSEI', name: '菲律宾PSEi', code: 'PSEi', tz: 'Asia/Manila', open: [9, 30], close: [15, 0], weekdays: true },
    { symbol: 'HOSE:VNINDEX', name: '越南VN-Index', code: 'VNINDEX', tz: 'Asia/Ho_Chi_Minh', open: [9, 0], close: [15, 0], weekdays: true },
  ];

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);
  const tvUrl = (symbol) => `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const chartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('ase-style')) return;
    const style = document.createElement('style');
    style.id = 'ase-style';
    style.textContent = `
.ase-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; letter-spacing:0.14em; color:var(--text-muted); margin-bottom:6px; }
.ase-status { color:var(--warning); white-space:nowrap; }
.ase-status.live { color:var(--acc); }
.ase-sub { font-size:9px; color:var(--text-dim); margin-bottom:8px; }
.ase-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:8px; }
@media (max-width:720px){ .ase-grid { grid-template-columns:repeat(2, 1fr); } }
@media (max-width:480px){ .ase-grid { grid-template-columns:1fr; } }
.ase-card { display:block; border:1px solid var(--hairline); border-radius:var(--radius-sm); padding:8px 10px; background:var(--surface-raised); text-decoration:none; transition:border-color .15s; }
.ase-card:hover { border-color:var(--acc-dim); }
.ase-card-top { display:flex; justify-content:space-between; align-items:baseline; gap:6px; margin-bottom:4px; }
.ase-name { font-size:11px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ase-code { font-size:9px; color:var(--text-dim); font-family:var(--font-mono); }
.ase-price { font-family:var(--font-mono); font-size:17px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; white-space:nowrap; }
.ase-chg { display:flex; gap:8px; font-family:var(--font-mono); font-size:11px; margin-top:1px; }
.ase-session { display:inline-block; margin-top:6px; padding:1px 6px; border-radius:999px; border:1px solid var(--hairline); font-size:9px; font-family:var(--font-mono); }
.ase-session.open { color:var(--up); border-color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); }
.ase-session.closed { color:var(--text-muted); border-color:var(--hairline); }
.ase-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); flex-wrap:wrap; }
.ase-up { color:var(--up); } .ase-down { color:var(--down); } .ase-flat { color:var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  const fmtNum = (v,d) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const fmtSigned = (v,d) => Number.isFinite(v) ? (v>0?'+':'')+fmtNum(v,d) : '—';
  const fmtPrice = (v) => Number.isFinite(v) ? (Number.isInteger(v)?fmtNum(v,0):fmtNum(v,2)) : '—';
  const dirClass = (v) => !Number.isFinite(v) || v===0 ? 'ase-flat' : v>0 ? 'ase-up' : 'ase-down';

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

  window.GT_EXTRA_TOOLS['aseanboard'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool ase-root">
          <div class="ase-head"><span>东盟 · 行情板</span><span class="ase-status" data-conn>连接中…</span></div>
          <div class="ase-sub">新加坡 / 马来西亚 / 泰国 / 印尼 / 菲律宾 / 越南 · 状态与行情</div>
          <div class="ase-grid">
            ${INDEXES.map((it) => `
              <a class="ase-card" href="${esc(chartUrl(it.symbol))}" target="_blank" rel="noopener" data-sym="${esc(it.symbol)}">
                <div class="ase-card-top"><span class="ase-name">${esc(it.name)}</span><span class="ase-code">${esc(it.code)}</span></div>
                <div class="ase-price ase-flat" data-price>—</div>
                <div class="ase-chg"><span data-chg class="ase-flat">—</span><span data-pct class="ase-flat">—</span></div>
                <span class="ase-session closed" data-session>—</span>
              </a>`).join('')}
          </div>
          <div class="ase-foot"><span>来源：TradingView scanner（经 GT proxy）</span><span>更新 <b data-time>—</b></span></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const timeEl = el.querySelector('[data-time]');
      const cards = {};
      el.querySelectorAll('.ase-card').forEach((card) => {
        cards[card.getAttribute('data-sym')] = { price:card.querySelector('[data-price]'), chg:card.querySelector('[data-chg]'), pct:card.querySelector('[data-pct]'), session:card.querySelector('[data-session]') };
      });

      const updateSession = () => {
        INDEXES.forEach((it) => {
          const c = cards[it.symbol];
          if (!c) return;
          const st = sessionState(it);
          if (st) { c.session.textContent = st.label; c.session.className = `ase-session ${st.state}`; }
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
        c.price.className = `ase-price ${cls}`;
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
          conn.className = ok.length ? 'ase-status live' : 'ase-status';
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
