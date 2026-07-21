/* 韩国股市行情板 — KOSPI 指数 + 核心成分股
 * Registers as custom tool id 'koreaboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDEX = { symbol: 'KRX:KOSPI', name: 'KOSPI', code: 'KOSPI' };
  const STOCKS = [
    { symbol: 'KRX:005930', name: '三星电子', code: '005930' },
    { symbol: 'KRX:000660', name: 'SK海力士', code: '000660' },
    { symbol: 'KRX:005380', name: '现代汽车', code: '005380' },
    { symbol: 'KRX:035720', name: 'Kakao', code: '035720' },
    { symbol: 'KRX:035420', name: 'NAVER', code: '035420' },
    { symbol: 'KRX:051910', name: 'LG化学', code: '051910' },
    { symbol: 'KRX:006400', name: '三星SDI', code: '006400' },
    { symbol: 'KRX:012330', name: '现代摩比斯', code: '012330' },
  ];

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);
  const tvUrl = (symbol) => `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=close,change,change_abs,volume`;
  const chartUrl = (symbol) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('kob-style')) return;
    const style = document.createElement('style');
    style.id = 'kob-style';
    style.textContent = `
.kob-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; letter-spacing:0.14em; color:var(--text-muted); margin-bottom:6px; }
.kob-head-right { display:flex; align-items:center; gap:8px; }
.kob-status { color:var(--warning); white-space:nowrap; }
.kob-status.live { color:var(--acc); }
.kob-session { font-size:10px; padding:1px 8px; border-radius:999px; border:1px solid var(--hairline); color:var(--text-muted); letter-spacing:0.08em; }
.kob-session.open { color:var(--up); border-color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); }
.kob-sub { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); margin-bottom:8px; }
.kob-index { border:1px solid var(--hairline); border-radius:var(--radius-sm); background:var(--surface-raised); padding:8px 10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; text-decoration:none; }
.kob-index-label { font-size:10px; letter-spacing:0.1em; color:var(--text-muted); }
.kob-index-main { display:flex; align-items:baseline; gap:10px; }
.kob-index-price { font-family:var(--font-mono); font-size:17px; font-weight:700; color:var(--text); font-variant-numeric:tabular-nums; }
.kob-index-chg { font-family:var(--font-mono); font-size:11px; }
.kob-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin-bottom:8px; }
@media (max-width:1000px){ .kob-grid { grid-template-columns:repeat(3, 1fr); } }
@media (max-width:720px){ .kob-grid { grid-template-columns:repeat(2, 1fr); } }
@media (max-width:480px){ .kob-grid { grid-template-columns:1fr; } }
.kob-card { display:block; border:1px solid var(--hairline); border-radius:var(--radius-sm); padding:8px 10px; background:var(--surface-raised); text-decoration:none; transition:border-color .15s; }
.kob-card:hover { border-color:var(--acc-dim); }
.kob-card-top { display:flex; justify-content:space-between; align-items:baseline; gap:6px; margin-bottom:4px; }
.kob-name { font-size:11px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kob-code { font-size:9px; color:var(--text-dim); font-family:var(--font-mono); }
.kob-price { font-family:var(--font-mono); font-size:17px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; white-space:nowrap; }
.kob-chg { display:flex; gap:8px; font-family:var(--font-mono); font-size:11px; margin-top:1px; }
.kob-vol { margin-top:5px; padding-top:5px; border-top:1px solid var(--hairline); font-size:9px; color:var(--text-muted); display:flex; justify-content:space-between; }
.kob-vol b { font-weight:400; color:var(--text-dim); font-family:var(--font-mono); }
.kob-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; color:var(--text-dim); flex-wrap:wrap; }
.kob-up { color:var(--up); } .kob-down { color:var(--down); } .kob-flat { color:var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  const fmtNum = (v,d) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const fmtSigned = (v,d) => Number.isFinite(v) ? (v>0?'+':'')+fmtNum(v,d) : '—';
  const fmtPrice = (v) => Number.isFinite(v) ? (Number.isInteger(v)?fmtNum(v,0):fmtNum(v,2)) : '—';
  const fmtVol = (shares) => {
    if (!Number.isFinite(shares) || shares<=0) return '—';
    if (shares >= 1e8) return `${fmtNum(shares/1e8,2)}亿股`;
    if (shares >= 1e4) return `${fmtNum(shares/1e4,1)}万股`;
    return `${fmtNum(shares,0)}股`;
  };
  const dirClass = (v) => !Number.isFinite(v) || v===0 ? 'kob-flat' : v>0 ? 'kob-up' : 'kob-down';

  const sessionState = () => {
    let kst;
    try { kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); } catch(e){ kst = new Date(); }
    const day = kst.getDay(), mins = kst.getHours()*60 + kst.getMinutes();
    if (day===0 || day===6) return 'closed';
    if (mins>=540 && mins<930) return 'trading';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['koreaboard'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool kob-root">
          <div class="kob-head">
            <span>韩国 · KOSPI 行情板</span>
            <span class="kob-head-right">
              <span class="kob-session" data-session>—</span>
              <span class="kob-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="kob-sub"><span>KOSPI 核心成分股 · 绿涨红跌 · 60s 刷新</span><span>单位 KRW</span></div>
          <a class="kob-index" href="${esc(chartUrl(INDEX.symbol))}" target="_blank" rel="noopener">
            <span class="kob-index-label">${esc(INDEX.name)}<i style="display:block;font-style:normal;font-size:9px;color:var(--text-dim);margin-top:2px;">${esc(INDEX.code)} · ${esc(INDEX.symbol)}</i></span>
            <span class="kob-index-main"><span class="kob-index-price kob-flat" data-idx-price>—</span><span class="kob-index-chg kob-flat" data-idx-chg>—</span></span>
          </a>
          <div class="kob-grid">
            ${STOCKS.map((s) => `
              <a class="kob-card" href="${esc(chartUrl(s.symbol))}" target="_blank" rel="noopener" data-sym="${esc(s.symbol)}">
                <div class="kob-card-top"><span class="kob-name">${esc(s.name)}</span><span class="kob-code">${esc(s.code)}</span></div>
                <div class="kob-price kob-flat" data-price>—</div>
                <div class="kob-chg"><span data-chg class="kob-flat">—</span><span data-pct class="kob-flat">—</span></div>
                <div class="kob-vol"><span>成交</span><b data-vol>—</b></div>
              </a>`).join('')}
          </div>
          <div class="kob-foot"><span>来源：TradingView scanner（经 GT proxy）</span><span>更新 <b data-time>—</b></span></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const timeEl = el.querySelector('[data-time]');
      const idxPriceEl = el.querySelector('[data-idx-price]');
      const idxChgEl = el.querySelector('[data-idx-chg]');
      const cards = {};
      el.querySelectorAll('.kob-card').forEach((card) => {
        cards[card.getAttribute('data-sym')] = { price:card.querySelector('[data-price]'), chg:card.querySelector('[data-chg]'), pct:card.querySelector('[data-pct]'), vol:card.querySelector('[data-vol]') };
      });

      const renderSession = () => {
        if (sessionState()==='trading') { sessionEl.textContent='● 交易中'; sessionEl.className='kob-session open'; }
        else { sessionEl.textContent='休市'; sessionEl.className='kob-session'; }
      };

      let alive = true, tickTimer = null;
      const renderOne = (item) => {
        if (item.symbol === INDEX.symbol) {
          const cls = dirClass(item.chg);
          idxPriceEl.textContent = fmtPrice(item.price);
          idxPriceEl.className = `kob-index-price ${cls}`;
          idxChgEl.textContent = `${fmtSigned(item.chg,2)} (${fmtSigned(item.pct,2)}%)`;
          idxChgEl.className = `kob-index-chg ${cls}`;
          return;
        }
        const c = cards[item.symbol];
        if (!c) return;
        const cls = dirClass(item.chg);
        c.price.textContent = fmtPrice(item.price);
        c.price.className = `kob-price ${cls}`;
        c.chg.textContent = fmtSigned(item.chg,2);
        c.chg.className = cls;
        c.pct.textContent = Number.isFinite(item.pct) ? `${fmtSigned(item.pct,2)}%` : '—';
        c.pct.className = cls;
        c.vol.textContent = fmtVol(item.vol);
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
          return { symbol, price: close, pct: Number(json.change), chg: Number(json.change_abs), vol: Number(json.volume) };
        } finally { clearTimeout(timer); }
      };

      const refresh = async () => {
        if (!alive) return;
        try {
          const results = await Promise.allSettled([fetchOne(INDEX.symbol)].concat(STOCKS.map((s) => fetchOne(s.symbol))));
          if (!alive) return;
          const ok = results.filter((r) => r.status === 'fulfilled');
          ok.forEach((r) => renderOne(r.value));
          conn.textContent = ok.length ? '● LIVE' : '连接失败';
          conn.className = ok.length ? 'kob-status live' : 'kob-status';
          setStatus(ok.length ? 'online' : 'offline');
          timeEl.textContent = new Date().toTimeString().slice(0,8);
        } catch (e) { setStatus('offline'); }
      };

      setStatus('loading');
      renderSession();
      refresh();
      tickTimer = setInterval(refresh, REFRESH_MS);

      return () => { alive=false; clearInterval(tickTimer); };
    },
  };
})();
