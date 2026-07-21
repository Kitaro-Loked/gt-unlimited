/* Commodities panel: 贵金属与大宗商品行情 (gold/silver/platinum/WTI/natgas/copper).
   Data chain, all free & no API key:
     1) stooq batch CSV (spot metals + front-month futures, OHLC + ET timestamp)
     2) TradingView scanner per symbol (close/open, CORS reflects Origin)
     3) gold-api.com per metal (spot price + updatedAt, CORS *) — metals/copper only
   Registers as window.GT_EXTRA_TOOLS['commodities']; app.js falls back to this registry. */
(() => {
  const STOOQ_API = 'https://stooq.com/q/l/?s=xauusd,xagusd,xptusd,cl.f,ng.f,hg.f&f=sd2t2ohlcv&h&e=csv';
  const TV_API = 'https://scanner.tradingview.com/symbol';
  const GOLD_API = 'https://api.gold-api.com/price';
  const REFRESH_MS = 60000;

  const ITEMS = [
    { key: 'gold', name: '黄金', unit: 'USD/oz', dec: 2, goldApi: 'XAU', tv: 'COMEX:GC1!' },
    { key: 'silver', name: '白银', unit: 'USD/oz', dec: 2, goldApi: 'XAG', tv: 'COMEX:SI1!' },
    { key: 'platinum', name: '铂金', unit: 'USD/oz', dec: 2, goldApi: 'XPT', tv: 'NYMEX:PL1!' },
    { key: 'wti', name: 'WTI原油', unit: 'USD/bbl', dec: 2, goldApi: null, tv: 'NYMEX:CL1!' },
    { key: 'natgas', name: '天然气', unit: 'USD/MMBtu', dec: 3, goldApi: null, tv: 'NYMEX:NG1!' },
    { key: 'copper', name: '铜', unit: 'USD/lb', dec: 2, goldApi: 'HG', tv: 'COMEX:HG1!' },
  ];
  const STOOQ_MAP = { xauusd: 'gold', xagusd: 'silver', xptusd: 'platinum', 'cl.f': 'wti', 'ng.f': 'natgas', 'hg.f': 'copper' };

  const injectStyle = () => {
    if (document.getElementById('cmd-style')) return;
    const style = document.createElement('style');
    style.id = 'cmd-style';
    style.textContent = `
      .cmd-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .cmd-head-title { font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.15em; color: var(--text-dim); text-transform: uppercase; }
      .cmd-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); letter-spacing: 0.04em; }
      .cmd-rows { display: flex; flex-direction: column; border: 1px solid var(--hairline); border-radius: var(--radius-sm); overflow: hidden; }
      .cmd-row { position: relative; display: grid; grid-template-columns: 1fr auto 92px; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--hairline); transition: background 0.2s var(--ease-fluid); }
      .cmd-row:last-child { border-bottom: none; }
      .cmd-row:hover { background: color-mix(in srgb, var(--text) 4%, transparent); }
      .cmd-row::before { content: ''; position: absolute; inset: 0; opacity: 0; pointer-events: none; }
      .cmd-name { font-family: var(--font-sans); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; }
      .cmd-name small { display: block; font-size: 9px; color: var(--text-dim); font-weight: 400; margin-top: 1px; letter-spacing: 0.06em; }
      .cmd-price { font-family: var(--font-mono); font-size: 13px; font-weight: 700; text-align: right; }
      .cmd-chg { font-family: var(--font-mono); font-size: 10px; text-align: right; }
      .cmd-chg .cmd-flat { color: var(--text-dim); }
      .cmd-hint { padding: 8px 6px; }
      @keyframes cmdFlash { 0% { opacity: 1; } 100% { opacity: 0; } }
      .cmd-flash-up::before { background: color-mix(in srgb, var(--up) 18%, transparent); animation: cmdFlash 0.9s var(--ease-fluid); }
      .cmd-flash-down::before { background: color-mix(in srgb, var(--down) 18%, transparent); animation: cmdFlash 0.9s var(--ease-fluid); }
    `;
    document.head.appendChild(style);
  };

  const fmtPrice = (v, dec) =>
    Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';

  // stooq: 批量 CSV，一行一品种；期货符号可能返回 CL.F 形式
  const fetchStooq = async () => {
    const res = await fetch(STOOQ_API);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2 || !/^symbol,/i.test(lines[0])) throw new Error('bad payload');
    const out = {};
    lines.slice(1).forEach((line) => {
      const cols = line.split(',');
      const key = STOOQ_MAP[(cols[0] || '').trim().toLowerCase()];
      const close = parseFloat(cols[7]);
      const open = parseFloat(cols[4]);
      if (!key || !Number.isFinite(close)) return;
      out[key] = { price: close, open: Number.isFinite(open) ? open : null, date: (cols[1] || '').trim(), time: (cols[2] || '').trim() };
    });
    if (!Object.keys(out).length) throw new Error('empty payload');
    return out;
  };

  // TradingView scanner: close/open，相对开盘涨跌幅自行计算
  const fetchTV = async (symbol) => {
    const res = await fetch(`${TV_API}?symbol=${encodeURIComponent(symbol)}&fields=close,open`);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const json = await res.json();
    if (!json || typeof json.close !== 'number' || !Number.isFinite(json.close)) throw new Error('bad payload');
    const open = typeof json.open === 'number' && Number.isFinite(json.open) ? json.open : null;
    return { price: json.close, open };
  };

  // gold-api: 现货价 + updatedAt（无开盘价，涨跌幅降级为 —）
  const fetchGoldApi = async (symbol) => {
    const res = await fetch(`${GOLD_API}/${symbol}`);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const json = await res.json();
    if (!json || typeof json.price !== 'number' || !Number.isFinite(json.price)) throw new Error('bad payload');
    return { price: json.price, open: null };
  };

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};
  window.GT_EXTRA_TOOLS.commodities = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool cmd-tool">
          <div class="cmd-head">
            <span class="cmd-head-title">贵金属 · 大宗商品 · 60S 刷新</span>
            <span class="cmd-time" data-time>加载中…</span>
          </div>
          <div class="cmd-rows">
            ${ITEMS.map(
              (it) => `
            <div class="cmd-row" data-row="${it.key}">
              <span class="cmd-name">${it.name}<small>${it.tv} · ${it.unit}</small></span>
              <span class="cmd-price" data-price>—</span>
              <span class="cmd-chg" data-chg><span class="cmd-flat">—</span></span>
            </div>`
            ).join('')}
          </div>
          <div class="tool-hint cmd-hint" data-hint style="display:none"></div>
        </div>`;

      const timeEl = el.querySelector('[data-time]');
      const hintEl = el.querySelector('[data-hint]');
      const rows = {};
      ITEMS.forEach((it) => {
        const row = el.querySelector(`[data-row="${it.key}"]`);
        rows[it.key] = { row, priceEl: row.querySelector('[data-price]'), chgEl: row.querySelector('[data-chg]'), prev: undefined };
      });

      let alive = true;

      const showHint = (msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const hideHint = () => {
        hintEl.style.display = 'none';
      };

      const updateRow = (it, price, open) => {
        const r = rows[it.key];
        if (!r || !Number.isFinite(price)) return;
        const prev = r.prev;
        r.prev = price;
        r.priceEl.textContent = fmtPrice(price, it.dec);
        if (prev !== undefined && prev !== price) {
          r.row.classList.remove('cmd-flash-up', 'cmd-flash-down');
          void r.row.offsetWidth;
          r.row.classList.add(price > prev ? 'cmd-flash-up' : 'cmd-flash-down');
        }
        if (Number.isFinite(open) && open > 0) {
          const pct = ((price - open) / open) * 100;
          const up = pct >= 0;
          r.chgEl.innerHTML = `<span class="${up ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(2)}%</span>`;
        } else {
          r.chgEl.innerHTML = '<span class="cmd-flat">—</span>';
        }
      };

      const markRowError = (it) => {
        const r = rows[it.key];
        if (!r) return;
        r.priceEl.textContent = '—';
        r.chgEl.innerHTML = '<span class="cmd-flat">不可用</span>';
      };

      const load = async () => {
        let okCount = 0;
        // 1) stooq 批量：一次请求拿全部（含 ET 时间戳）
        try {
          const batch = await fetchStooq();
          if (!alive) return;
          ITEMS.forEach((it) => {
            const d = batch[it.key];
            if (d) {
              updateRow(it, d.price, d.open);
              okCount += 1;
            } else {
              markRowError(it);
            }
          });
          const any = batch[Object.keys(batch)[0]];
          timeEl.textContent = any && any.date ? `STOOQ · ${any.date} ${any.time} ET` : 'STOOQ';
        } catch (e) {
          // 2) 逐品种：TradingView scanner → gold-api（仅金属/铜）
          const results = await Promise.all(
            ITEMS.map(async (it) => {
              try {
                const d = await fetchTV(it.tv);
                return { it, d, src: 'TV' };
              } catch (e1) {
                if (!it.goldApi) return { it, d: null, src: null };
                try {
                  const d = await fetchGoldApi(it.goldApi);
                  return { it, d, src: 'GOLD-API' };
                } catch (e2) {
                  return { it, d: null, src: null };
                }
              }
            })
          );
          if (!alive) return;
          const srcs = [];
          results.forEach(({ it, d, src }) => {
            if (d) {
              updateRow(it, d.price, d.open);
              okCount += 1;
              if (!srcs.includes(src)) srcs.push(src);
            } else {
              markRowError(it);
            }
          });
          if (okCount) {
            timeEl.textContent = `${srcs.join('+')} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
          }
        }
        if (!alive) return;
        if (okCount === ITEMS.length) {
          hideHint();
          setStatus('online');
        } else if (okCount > 0) {
          showHint('部分品种数据不可用，下一轮自动重试');
          setStatus('online');
        } else {
          timeEl.textContent = '—';
          showHint('行情数据加载失败，下一轮自动重试');
          setStatus('offline');
        }
      };

      load();
      const timer = setInterval(load, REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    },
  };
})();
