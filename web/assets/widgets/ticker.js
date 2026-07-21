/* GT UNLIMITED 自定义跑马灯 —— 替换 TradingView ticker tape
 * 自初始化（DOMContentLoaded），直接渲染进 #ticker-box，不注册 GT_EXTRA_TOOLS。
 * 数据源路由：
 *   *USDT        → 币安现货 WS miniTicker（断线 15s REST ticker/24hr 兜底）
 *   XAU / XAG    → gold-api.com 30s 轮询（涨跌幅基准价存 localStorage gt-ticker-base-v1）
 *   6 字母外汇对  → frankfurter.dev latest + 近 7 日区间序列，300s 轮询
 * 配置持久化：localStorage gt-ticker-v1 { symbols: [{ sym, label }], speed }
 */
(function () {
  'use strict';

  if (window.__gtTickerInit) return;
  window.__gtTickerInit = true;

  const LS_CFG = 'gt-ticker-v1';
  const LS_BASE = 'gt-ticker-base-v1';
  const SPEEDS = { slow: 30, mid: 60, fast: 100 }; // px/s
  const REST_FALLBACK_MS = 15000;
  const METAL_POLL_MS = 30000;
  const FX_POLL_MS = 300000;
  const WS_RETRY_MS = 20000;
  const FX_CCY = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNH'];

  const DEFAULT_SYMBOLS = [
    { sym: 'BTCUSDT', label: 'BTC' },
    { sym: 'ETHUSDT', label: 'ETH' },
    { sym: 'SOLUSDT', label: 'SOL' },
    { sym: 'BNBUSDT', label: 'BNB' },
    { sym: 'XAU', label: '黄金' },
    { sym: 'XAG', label: '白银' },
    { sym: 'EURUSD', label: '欧元/美元' },
    { sym: 'GBPUSD', label: '英镑/美元' },
    { sym: 'USDJPY', label: '美元/日元' },
    { sym: 'AUDUSD', label: '澳元/美元' },
    { sym: 'USDCAD', label: '美元/加元' },
    { sym: 'USDCHF', label: '美元/瑞郎' },
    { sym: 'NZDUSD', label: '纽元/美元' },
    { sym: 'USDCNH', label: '美元/离岸人民币' },
  ];

  const FX_LABELS = {
    EURUSD: '欧元/美元', GBPUSD: '英镑/美元', USDJPY: '美元/日元', AUDUSD: '澳元/美元',
    USDCAD: '美元/加元', USDCHF: '美元/瑞郎', NZDUSD: '纽元/美元', USDCNH: '美元/离岸人民币',
  };

  const CANDIDATE_COINS = [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK', 'AVAX', 'TON',
    'TRX', 'DOT', 'LTC', 'BCH', 'NEAR', 'UNI', 'ARB', 'OP', 'APT', 'SUI',
    'INJ', 'FIL', 'ATOM', 'ETC', 'HBAR', 'PEPE', 'WIF', 'TIA', 'SEI', 'ONDO',
  ];
  const CANDIDATES = CANDIDATE_COINS.map((c) => ({ sym: c + 'USDT', label: c }))
    .concat([
      { sym: 'XAU', label: '黄金' },
      { sym: 'XAG', label: '白银' },
    ])
    .concat(Object.keys(FX_LABELS).map((k) => ({ sym: k, label: FX_LABELS[k] })));

  const state = {
    cfg: null,          // { symbols: [{ sym, label }], speed: 'slow'|'mid'|'fast' }
    data: {},           // sym -> { price, chg, prev }
    errs: {},           // src -> 错误提示文案
  };

  let alive = true;
  let root = null, viewport = null, track = null, hintEl = null, gearBtn = null, panel = null;
  let chipList = null, addInput = null, panelMsgEl = null;
  let ws = null, wsRetryTimer = null, restTimer = null;
  let metalTimer = null, fxTimer = null, resizeTimer = null;
  let currentHalfW = 0;
  let pageHidden = typeof document !== 'undefined' && document.hidden;

  /* ---------------- 工具 ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchJson(url, retries) {
    const n = retries == null ? 1 : retries;
    let lastErr = null;
    for (let i = 0; i <= n; i++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('http ' + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (i < n) await sleep(2000);
      }
    }
    throw lastErr;
  }

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '—';
    if (p >= 10) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return p.toPrecision(4);
  }

  function isFxPair(sym) {
    if (!/^[A-Z]{6}$/.test(sym)) return false;
    if (sym.indexOf('USD') < 0) return false;
    const q = sym.indexOf('USD') === 0 ? sym.slice(3) : sym.slice(0, 3);
    return FX_CCY.indexOf(q) >= 0;
  }

  function classify(sym) {
    if (sym === 'XAU' || sym === 'XAG') return 'metal';
    if (/^[A-Z0-9]{2,20}USDT$/.test(sym)) return 'crypto';
    if (isFxPair(sym)) return 'fx';
    return null;
  }

  function defaultLabel(sym) {
    if (sym === 'XAU') return '黄金';
    if (sym === 'XAG') return '白银';
    if (FX_LABELS[sym]) return FX_LABELS[sym];
    if (/USDT$/.test(sym)) return sym.slice(0, -4);
    return sym;
  }

  function tvOf(sym) {
    if (sym === 'XAU') return 'TVC:GOLD';
    if (sym === 'XAG') return 'TVC:SILVER';
    if (/USDT$/.test(sym)) return 'BINANCE:' + sym;
    return 'FX:' + sym;
  }

  /* ---------------- 品种图标 ---------------- */

  // 外汇基础货币 → 货币符号（fxQuote 取对中非 USD 一侧作为基础货币）
  const FX_SYM = { EUR: '€', GBP: '£', USD: '$', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'Fr', NZD: 'NZ$', CNH: '¥' };

  // 返回图标的 HTML 字符串（span.tk-ico）。加密品种为字母徽章 + 叠层 CDN 图标，
  // 图标加载失败 onerror 移除 img 露出底层字母徽章；金银为纯 CSS 金属圆点；外汇为货币符号徽章。
  function iconHtml(item) {
    const kind = classify(item.sym);
    if (kind === 'crypto') {
      const base = item.sym.slice(0, -4).toLowerCase();
      return '<span class="tk-ico" aria-hidden="true">' +
        '<span class="tk-ico-letter">' + base.charAt(0).toUpperCase() + '</span>' +
        '<img src="https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/' + base + '.svg" ' +
        'width="17" height="17" loading="lazy" alt="" onerror="this.remove()">' +
        '</span>';
    }
    if (kind === 'metal') {
      return '<span class="tk-ico tk-ico-metal tk-ico-' + item.sym.toLowerCase() + '" aria-hidden="true"></span>';
    }
    if (kind === 'fx') {
      const ccy = fxQuote(item.sym);
      return '<span class="tk-ico tk-ico-fx" data-ccy="' + ccy + '" aria-hidden="true">' +
        (FX_SYM[ccy] || ccy.charAt(0)) + '</span>';
    }
    return '';
  }

  function fmtYmd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function lsRead(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function lsWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式等场景静默 */ }
  }

  /* ---------------- 配置持久化 ---------------- */

  function defaultCfg() {
    return { symbols: DEFAULT_SYMBOLS.map((s) => ({ sym: s.sym, label: s.label })), speed: 'mid' };
  }

  function loadCfg() {
    let cfg = lsRead(LS_CFG);
    if (cfg && Array.isArray(cfg.symbols) && SPEEDS[cfg.speed]) {
      const list = cfg.symbols.filter(
        (s) => s && typeof s.sym === 'string' && typeof s.label === 'string' && classify(s.sym)
      );
      if (list.length) {
        state.cfg = { symbols: list, speed: cfg.speed };
        return;
      }
    }
    state.cfg = defaultCfg();
  }

  function saveCfg() {
    lsWrite(LS_CFG, state.cfg);
  }

  /* ---------------- 样式注入 ---------------- */

  function injectStyle() {
    if (document.getElementById('gt-ticker-style')) return;
    const style = document.createElement('style');
    style.id = 'gt-ticker-style';
    style.textContent = `
.tkr-root { display: flex; align-items: center; width: 100%; height: 100%; padding-right: 46px; }
.tkr-viewport { flex: 1; min-width: 0; height: 100%; overflow: hidden; position: relative; }
.tkr-viewport::before, .tkr-viewport::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 34px; z-index: 2; pointer-events: none;
}
.tkr-viewport::before { left: 0; background: linear-gradient(to right, var(--bg), transparent); }
.tkr-viewport::after { right: 0; background: linear-gradient(to left, var(--bg), transparent); }
.tkr-track {
  display: flex; height: 100%; width: max-content; will-change: transform;
  animation-name: tkr-scroll; animation-timing-function: linear;
  animation-iteration-count: infinite; animation-duration: 60s;
}
.tkr-viewport:hover .tkr-track { animation-play-state: paused; }
@keyframes tkr-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.tkr-half { display: flex; align-items: center; height: 100%; flex-shrink: 0; }
.tkr-item {
  display: inline-flex; align-items: center; gap: 8px; height: 100%;
  padding: 0 16px; cursor: pointer; white-space: nowrap; user-select: none;
  border-right: 1px solid var(--hairline); transition: background 0.2s var(--ease-fluid);
}
.tkr-item:hover { background: var(--hairline); }
.tkr-item:focus-visible { outline: 1px solid var(--acc-dim); outline-offset: -1px; }
.tkr-label { font-family: var(--font-sans); font-size: 11px; color: var(--text-muted); letter-spacing: 0.04em; }
.tkr-price {
  font-family: var(--font-mono); font-size: 12px;
  font-variant-numeric: tabular-nums; color: var(--text);
}
.tkr-chg {
  font-family: var(--font-mono); font-size: 10px; font-variant-numeric: tabular-nums;
  padding: 2px 7px; border-radius: 999px; color: var(--text-dim); background: var(--hairline);
}
.tkr-chg.up { color: var(--up); background: color-mix(in srgb, var(--up) 14%, transparent); }
.tkr-chg.down { color: var(--down); background: color-mix(in srgb, var(--down) 14%, transparent); }
@keyframes tkr-flash-up-kf { 0% { opacity: 0.2; transform: translateY(3px); } 100% { opacity: 1; transform: none; } }
@keyframes tkr-flash-down-kf { 0% { opacity: 0.2; transform: translateY(-3px); } 100% { opacity: 1; transform: none; } }
.tkr-flash-up { animation: tkr-flash-up-kf 0.7s var(--ease-fluid); }
.tkr-flash-down { animation: tkr-flash-down-kf 0.7s var(--ease-fluid); }
.tkr-hint {
  flex-shrink: 0; padding: 0 8px; text-align: left; letter-spacing: 0;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--warning);
}
.tkr-gear {
  position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  color: var(--text-muted); cursor: pointer; font-size: 14px; line-height: 1;
  transition: all 0.2s var(--ease-fluid); z-index: 5;
}
.tkr-gear:hover, .tkr-gear.on { color: var(--acc); border-color: var(--acc-dim); }
.tkr-panel {
  position: fixed; top: calc(var(--header-h) + 8px); right: 10px;
  width: 330px; max-width: calc(100vw - 20px); max-height: 72vh; overflow-y: auto;
  z-index: 60; padding: 14px; border-radius: var(--radius-sm);
  border: 1px solid var(--hairline-strong);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 16px 40px var(--hairline);
  font-size: 12px; color: var(--text);
}
.tkr-panel[hidden] { display: none; }
.tkr-panel-title { font-family: var(--font-sans); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; }
.tkr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.tkr-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 5px 3px 10px;
  border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface-raised);
}
.tkr-chip b { font-weight: 500; font-size: 11px; }
.tkr-chip i { font-style: normal; font-family: var(--font-mono); font-size: 10px; color: var(--text-dim); }
.tkr-chip-x {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 13px; line-height: 1; padding: 2px 4px;
  transition: color 0.2s var(--ease-fluid);
}
.tkr-chip-x:hover { color: var(--danger); }
.tkr-add-row { display: flex; gap: 6px; margin-bottom: 6px; }
.tkr-add-input {
  flex: 1; min-width: 0; background: var(--surface-raised);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm); color: var(--text);
  padding: 7px 10px; font-family: var(--font-mono); font-size: 11px; outline: none;
  transition: border-color 0.2s var(--ease-fluid);
}
.tkr-add-input:focus { border-color: var(--acc-dim); }
.tkr-add-btn {
  padding: 7px 12px; border-radius: var(--radius-sm); border: 1px solid var(--hairline-strong);
  background: transparent; color: var(--text); font-family: var(--font-sans); font-size: 11px; cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
}
.tkr-add-btn:hover { border-color: var(--acc-dim); color: var(--acc); }
.tkr-panel-msg { font-size: 10px; color: var(--danger); min-height: 14px; margin-bottom: 8px; }
.tkr-speed-row { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
.tkr-speed-row > span { font-family: var(--font-sans); font-size: 11px; color: var(--text-muted); margin-right: 4px; }
.tkr-speed-btn {
  flex: 1; padding: 6px 0; text-align: center; border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); background: transparent; color: var(--text-muted);
  font-family: var(--font-sans); font-size: 11px; cursor: pointer; transition: all 0.2s var(--ease-fluid);
}
.tkr-speed-btn.on {
  border-color: var(--acc-dim); color: var(--acc);
  background: color-mix(in srgb, var(--acc) 10%, transparent);
}
.tkr-reset {
  width: 100%; padding: 7px 0; border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted); font-family: var(--font-sans); font-size: 11px; cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
}
.tkr-reset:hover { border-color: var(--danger); color: var(--danger); }
/* ---- 品种图标（17px，与文字垂直居中对齐） ---- */
.tk-ico {
  position: relative; flex: 0 0 17px; width: 17px; height: 17px;
  display: inline-flex; align-items: center; justify-content: center;
}
.tkr-item .tk-ico { margin-right: -3px; } /* item gap 8px → 图标与文字净距 5px */
.tk-ico-letter {
  width: 17px; height: 17px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; color: var(--acc);
  background: color-mix(in srgb, var(--acc) 16%, transparent);
}
.tk-ico img {
  position: absolute; inset: 0; display: block; width: 17px; height: 17px; border-radius: 50%;
}
.tk-ico-metal {
  border-radius: 50%;
  box-shadow: inset 1px 1px 2px rgba(255, 255, 255, 0.5), inset -1px -2px 3px rgba(0, 0, 0, 0.28);
}
.tk-ico-xau { background: radial-gradient(circle at 32% 30%, #f6d365 0%, #c9962e 100%); }
.tk-ico-xag { background: radial-gradient(circle at 32% 30%, #e8e8e8 0%, #9aa0a6 100%); }
.tk-ico-fx {
  border-radius: 5px; padding: 0 1px; box-sizing: border-box; white-space: nowrap;
  font-size: 8px; font-weight: 700; letter-spacing: -0.02em;
  background: color-mix(in srgb, var(--fxc, var(--acc)) 15%, transparent);
  color: color-mix(in srgb, var(--fxc, var(--acc)) 68%, #ffffff);
}
body.light-mode .tk-ico-fx { color: color-mix(in srgb, var(--fxc, var(--acc)) 74%, #000000); }
.tk-ico-fx[data-ccy="EUR"] { --fxc: #6b8dd6; }
.tk-ico-fx[data-ccy="GBP"] { --fxc: #a06fd8; }
.tk-ico-fx[data-ccy="USD"] { --fxc: #4da87a; }
.tk-ico-fx[data-ccy="JPY"] { --fxc: #d6695e; }
.tk-ico-fx[data-ccy="AUD"] { --fxc: #d9a03f; }
.tk-ico-fx[data-ccy="CAD"] { --fxc: #e0915c; }
.tk-ico-fx[data-ccy="CHF"] { --fxc: #9099a6; }
.tk-ico-fx[data-ccy="NZD"] { --fxc: #5ba8c9; }
.tk-ico-fx[data-ccy="CNH"] { --fxc: #cc7a99; }
/* 页面隐藏时暂停跑马灯动画 */
.tkr-track.tkr-paused { animation-play-state: paused; }
`;
    document.head.appendChild(style);
  }

  /* ---------------- 跑马灯轨道 ---------------- */

  function buildItem(s) {
    const item = document.createElement('span');
    item.className = 'tkr-item';
    item.dataset.sym = s.sym;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.title = s.label + ' ' + s.sym;
    item.insertAdjacentHTML('beforeend', iconHtml(s));
    const label = document.createElement('span');
    label.className = 'tkr-label';
    label.textContent = s.label;
    const price = document.createElement('span');
    price.className = 'tkr-price';
    price.textContent = '—';
    const chg = document.createElement('span');
    chg.className = 'tkr-chg';
    chg.textContent = '—';
    item.appendChild(label);
    item.appendChild(price);
    item.appendChild(chg);
    return item;
  }

  function applyDuration(halfW) {
    if (halfW > 0) currentHalfW = halfW;
    const w = currentHalfW || 1200;
    const sec = w / SPEEDS[state.cfg.speed];
    track.style.animationDuration = sec.toFixed(2) + 's';
  }

  // 无缝循环：轨道 = 两份相同 half，translateX(-50%) 恰好滚动一份；
  // half 内按视口宽度复制足够份数，保证任意品种数量下速度恒定且无断档。
  function rebuildTrack() {
    if (!track) return;
    track.innerHTML = '';
    const halfA = document.createElement('div');
    halfA.className = 'tkr-half';
    state.cfg.symbols.forEach((s) => halfA.appendChild(buildItem(s)));
    track.appendChild(halfA);
    const setW = halfA.offsetWidth;
    const vpW = viewport ? viewport.clientWidth : 0;
    if (setW > 0 && vpW > 0) {
      const copies = Math.max(1, Math.ceil(vpW / setW));
      for (let i = 1; i < copies; i++) {
        Array.from(halfA.children).slice(0, state.cfg.symbols.length).forEach((node) => {
          halfA.appendChild(node.cloneNode(true));
        });
      }
    }
    const halfB = halfA.cloneNode(true);
    halfB.setAttribute('aria-hidden', 'true');
    track.appendChild(halfB);
    applyDuration(halfA.offsetWidth);
    Object.keys(state.data).forEach((sym) => renderItem(sym));
  }

  function renderItem(sym) {
    if (pageHidden) return; // 页面隐藏时跳过 DOM 写入，数据仍由 applyData 缓存，可见时一次性应用
    const d = state.data[sym];
    const items = track.querySelectorAll('.tkr-item[data-sym="' + sym + '"]');
    items.forEach((item) => {
      const priceEl = item.querySelector('.tkr-price');
      const chgEl = item.querySelector('.tkr-chg');
      if (!d || !Number.isFinite(d.price)) {
        priceEl.textContent = '—';
        chgEl.textContent = '—';
        chgEl.classList.remove('up', 'down');
        return;
      }
      priceEl.textContent = fmtPrice(d.price);
      if (Number.isFinite(d.chg)) {
        chgEl.textContent = (d.chg >= 0 ? '+' : '') + d.chg.toFixed(2) + '%';
        chgEl.classList.toggle('up', d.chg >= 0);
        chgEl.classList.toggle('down', d.chg < 0);
      } else {
        chgEl.textContent = '—';
        chgEl.classList.remove('up', 'down');
      }
      if (Number.isFinite(d.prev) && d.prev !== d.price) {
        priceEl.classList.remove('tkr-flash-up', 'tkr-flash-down');
        void priceEl.offsetWidth; // 重置动画
        priceEl.classList.add(d.price > d.prev ? 'tkr-flash-up' : 'tkr-flash-down');
      }
    });
  }

  function applyData(sym, price, chg) {
    const d = state.data[sym] || {};
    d.prev = Number.isFinite(d.price) ? d.price : NaN;
    d.price = price;
    d.chg = chg;
    state.data[sym] = d;
    renderItem(sym);
  }

  function selectSymbol(sym) {
    window.dispatchEvent(new CustomEvent('gt:set-symbol', { detail: { tv: tvOf(sym) } }));
  }

  /* ---------------- 错误提示 ---------------- */

  function setErr(src, msg) {
    if (msg) state.errs[src] = msg;
    else delete state.errs[src];
    const msgs = Object.keys(state.errs).map((k) => state.errs[k]);
    if (!hintEl) return;
    if (!msgs.length) {
      hintEl.hidden = true;
    } else {
      hintEl.textContent = msgs[0];
      hintEl.hidden = false;
    }
  }

  /* ---------------- 币安（crypto） ---------------- */

  const cryptoSyms = () => state.cfg.symbols.map((s) => s.sym).filter((s) => /USDT$/.test(s));

  function closeCrypto() {
    if (ws) {
      const s = ws;
      ws = null;
      s.onclose = null;
      s.onerror = null;
      s.onmessage = null;
      s.onopen = null;
      try { s.close(); } catch (e) { /* ignore */ }
    }
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
  }

  function scheduleWsRetry() {
    if (wsRetryTimer || !alive) return;
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = null;
      if (alive) connectCrypto();
    }, WS_RETRY_MS);
  }

  function startCryptoRest() {
    if (restTimer || !alive) return;
    pollCryptoRest();
    restTimer = setInterval(pollCryptoRest, REST_FALLBACK_MS);
  }

  function connectCrypto() {
    closeCrypto();
    const syms = cryptoSyms();
    if (!syms.length || !alive) return;
    const streams = syms.map((s) => s.toLowerCase() + '@miniTicker').join('/');
    let socket;
    try {
      socket = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams);
    } catch (e) {
      setErr('crypto', '币安实时连接失败，REST 轮询兜底中…');
      startCryptoRest();
      scheduleWsRetry();
      return;
    }
    ws = socket;
    socket.onopen = () => {
      if (restTimer) { clearInterval(restTimer); restTimer = null; }
      setErr('crypto', null);
    };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg && msg.data;
        if (!d || !d.s) return;
        const price = parseFloat(d.c);
        const open = parseFloat(d.o);
        if (!Number.isFinite(price)) return;
        const chg = Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : NaN;
        applyData(d.s, price, chg);
      } catch (e) { /* 忽略坏帧 */ }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (!alive) return;
      setErr('crypto', '币安实时连接断开，REST 轮询兜底中…');
      startCryptoRest();
      scheduleWsRetry();
    };
    socket.onerror = () => {
      try { socket.close(); } catch (e) { /* onclose 会接管 */ }
    };
  }

  async function pollCryptoRest() {
    const syms = cryptoSyms();
    if (!syms.length || !alive) return;
    try {
      const data = await fetchJson(
        'https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(syms))
      );
      if (!Array.isArray(data)) throw new Error('bad data');
      data.forEach((d) => {
        const price = parseFloat(d.lastPrice);
        const open = parseFloat(d.openPrice);
        if (!Number.isFinite(price)) return;
        const chg = Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : NaN;
        applyData(d.symbol, price, chg);
      });
      if (alive && !ws) setErr('crypto', '币安实时连接断开，REST 轮询兜底中…');
    } catch (e) {
      setErr('crypto', '币安行情加载失败，自动重试中…');
    }
  }

  /* ---------------- 金银（gold-api.com） ---------------- */

  const metalSyms = () =>
    state.cfg.symbols.map((s) => s.sym).filter((s) => s === 'XAU' || s === 'XAG');

  // 涨跌幅基准：当天首次获取价，存 localStorage gt-ticker-base-v1 { date, XAU, XAG }
  function metalChg(sym, price) {
    const today = fmtYmd(new Date());
    let base = lsRead(LS_BASE);
    if (!base || base.date !== today) base = { date: today };
    if (!Number.isFinite(base[sym])) {
      base[sym] = price;
      lsWrite(LS_BASE, base);
      return 0;
    }
    lsWrite(LS_BASE, base);
    return base[sym] > 0 ? ((price - base[sym]) / base[sym]) * 100 : 0;
  }

  async function pollMetals() {
    const syms = metalSyms();
    if (!syms.length || !alive) return;
    let failed = false;
    await Promise.allSettled(
      syms.map(async (sym) => {
        try {
          const data = await fetchJson('https://api.gold-api.com/price/' + sym);
          const price = Number(data && data.price);
          if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
          applyData(sym, price, metalChg(sym, price));
        } catch (e) {
          failed = true;
        }
      })
    );
    setErr('metal', failed ? '金银价格加载失败，自动重试中…' : null);
  }

  /* ---------------- 外汇（frankfurter.dev，ECB 日频） ---------------- */

  const fxSyms = () => state.cfg.symbols.map((s) => s.sym).filter((s) => classify(s) === 'fx');
  const fxQuote = (sym) => (sym.indexOf('USD') === 0 ? sym.slice(3) : sym.slice(0, 3));
  // frankfurter 不支持 CNH（会被静默忽略），用在岸 CNY 近似离岸价
  const FX_API_ALIAS = { CNH: 'CNY' };
  const fxApiCcy = (q) => FX_API_ALIAS[q] || q;

  function fxPrice(sym, rates) {
    const r = rates ? Number(rates[fxApiCcy(fxQuote(sym))]) : NaN;
    if (!Number.isFinite(r) || r <= 0) return NaN;
    return sym.indexOf('USD') === 0 ? r : 1 / r;
  }

  async function pollFx() {
    const syms = fxSyms();
    if (!syms.length || !alive) return;
    const ccys = [];
    syms.forEach((s) => {
      const q = fxApiCcy(fxQuote(s));
      if (ccys.indexOf(q) < 0) ccys.push(q);
    });
    const q = encodeURIComponent(ccys.join(','));
    const start = fmtYmd(new Date(Date.now() - 7 * 86400000));
    try {
      const results = await Promise.all([
        fetchJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=' + q),
        fetchJson('https://api.frankfurter.dev/v1/' + start + '..?base=USD&symbols=' + q),
      ]);
      const latest = results[0];
      const range = results[1];
      const days = Object.keys((range && range.rates) || {}).sort();
      if (!latest || !latest.rates || days.length < 2) throw new Error('bad data');
      const prevRates = range.rates[days[days.length - 2]]; // 前一个交易日
      syms.forEach((sym) => {
        const now = fxPrice(sym, latest.rates);
        const prev = fxPrice(sym, prevRates);
        if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) {
          applyData(sym, now, ((now - prev) / prev) * 100);
        }
      });
      setErr('fx', null);
    } catch (e) {
      setErr('fx', '外汇数据加载失败，自动重试中…');
    }
  }

  /* ---------------- 设置面板 ---------------- */

  function panelMsg(msg) {
    if (panelMsgEl) panelMsgEl.textContent = msg || '';
  }

  function renderChips() {
    if (!chipList) return;
    chipList.innerHTML = '';
    state.cfg.symbols.forEach((s, i) => {
      const chip = document.createElement('span');
      chip.className = 'tkr-chip';
      chip.insertAdjacentHTML('beforeend', iconHtml(s));
      const name = document.createElement('b');
      name.textContent = s.label;
      const code = document.createElement('i');
      code.textContent = s.sym;
      const x = document.createElement('button');
      x.className = 'tkr-chip-x';
      x.type = 'button';
      x.textContent = '×';
      x.title = '删除 ' + s.sym;
      x.addEventListener('click', () => removeSymbol(i));
      chip.appendChild(name);
      chip.appendChild(code);
      chip.appendChild(x);
      chipList.appendChild(chip);
    });
  }

  function updateSpeedUI() {
    if (!panel) return;
    panel.querySelectorAll('.tkr-speed-btn').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.speed === state.cfg.speed);
    });
  }

  function afterCfgChange() {
    saveCfg();
    renderChips();
    updateSpeedUI();
    rebuildTrack();
    connectCrypto();
    pollMetals();
    pollFx();
  }

  function addSymbol() {
    const raw = (addInput.value || '').trim().toUpperCase();
    if (!raw) return;
    if (!classify(raw)) {
      panelMsg('无效代码：仅支持 *USDT / XAU / XAG / EURUSD 类美元外汇对');
      return;
    }
    if (state.cfg.symbols.some((s) => s.sym === raw)) {
      panelMsg('该品种已在列表中');
      return;
    }
    state.cfg.symbols.push({ sym: raw, label: defaultLabel(raw) });
    addInput.value = '';
    panelMsg(null);
    afterCfgChange();
  }

  function removeSymbol(i) {
    if (state.cfg.symbols.length <= 1) {
      panelMsg('至少保留一个品种');
      return;
    }
    const sym = state.cfg.symbols[i].sym;
    state.cfg.symbols.splice(i, 1);
    delete state.data[sym];
    panelMsg(null);
    afterCfgChange();
  }

  function setSpeed(speed) {
    if (!SPEEDS[speed] || state.cfg.speed === speed) return;
    state.cfg.speed = speed;
    saveCfg();
    updateSpeedUI();
    applyDuration(0);
  }

  function resetCfg() {
    state.cfg = defaultCfg();
    state.data = {};
    panelMsg(null);
    afterCfgChange();
  }

  function togglePanel(show) {
    if (!panel) return;
    const open = show == null ? panel.hidden : show;
    panel.hidden = !open;
    if (gearBtn) {
      gearBtn.classList.toggle('on', open);
      gearBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (open) {
      renderChips();
      updateSpeedUI();
      panelMsg(null);
    }
  }

  function renderPanel() {
    panel = document.createElement('div');
    panel.className = 'tkr-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="tkr-panel-title">跑马灯设置 · TICKER</div>' +
      '<div class="tkr-chips" data-chips></div>' +
      '<div class="tkr-add-row">' +
      '<input class="tkr-add-input" data-input list="tkr-add-list" placeholder="代码，如 DOGEUSDT / XAU / EURUSD" maxlength="12" autocomplete="off" spellcheck="false">' +
      '<datalist id="tkr-add-list"></datalist>' +
      '<button class="tkr-add-btn" data-add type="button">添加</button>' +
      '</div>' +
      '<div class="tkr-panel-msg" data-msg></div>' +
      '<div class="tkr-speed-row"><span>滚动速度</span>' +
      '<button class="tkr-speed-btn" data-speed="slow" type="button">慢</button>' +
      '<button class="tkr-speed-btn" data-speed="mid" type="button">中</button>' +
      '<button class="tkr-speed-btn" data-speed="fast" type="button">快</button>' +
      '</div>' +
      '<button class="tkr-reset" data-reset type="button">恢复默认</button>';
    document.body.appendChild(panel);

    chipList = panel.querySelector('[data-chips]');
    addInput = panel.querySelector('[data-input]');
    panelMsgEl = panel.querySelector('[data-msg]');

    const datalist = panel.querySelector('#tkr-add-list');
    CANDIDATES.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.sym;
      opt.label = c.label;
      datalist.appendChild(opt);
    });

    panel.querySelector('[data-add]').addEventListener('click', addSymbol);
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSymbol();
      }
    });
    panel.querySelectorAll('.tkr-speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => setSpeed(btn.dataset.speed));
    });
    panel.querySelector('[data-reset]').addEventListener('click', resetCfg);
    panel.addEventListener('click', (e) => e.stopPropagation());
  }

  /* ---------------- 骨架渲染 ---------------- */

  function renderShell(box) {
    box.innerHTML = '';

    root = document.createElement('div');
    root.className = 'tkr-root';

    viewport = document.createElement('div');
    viewport.className = 'tkr-viewport';
    track = document.createElement('div');
    track.className = 'tkr-track';
    viewport.appendChild(track);

    hintEl = document.createElement('span');
    hintEl.className = 'tool-hint tkr-hint';
    hintEl.hidden = true;

    root.appendChild(viewport);
    root.appendChild(hintEl);
    box.appendChild(root);

    gearBtn = document.createElement('button');
    gearBtn.className = 'tkr-gear';
    gearBtn.type = 'button';
    gearBtn.textContent = '⚙';
    gearBtn.title = '跑马灯设置';
    gearBtn.setAttribute('aria-label', '跑马灯设置');
    gearBtn.setAttribute('aria-expanded', 'false');
    box.appendChild(gearBtn);

    // 事件委托（cloneNode 的副本不携带监听器）
    track.addEventListener('click', (e) => {
      const item = e.target.closest('.tkr-item');
      if (item && item.dataset.sym) selectSymbol(item.dataset.sym);
    });
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.tkr-item');
      if (item && item.dataset.sym) {
        e.preventDefault();
        selectSymbol(item.dataset.sym);
      }
    });
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
  }

  /* ---------------- 生命周期 ---------------- */

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (alive) rebuildTrack();
    }, 250);
  }

  function onDocClick(e) {
    if (panel && !panel.hidden && !panel.contains(e.target)) togglePanel(false);
  }

  function onDocKeydown(e) {
    if (e.key === 'Escape' && panel && !panel.hidden) togglePanel(false);
  }

  // 页面隐藏：暂停 CSS 动画并停止 DOM 写入（数据照常缓存）；重新可见：一次性应用缓存并恢复动画
  function onVisibility() {
    pageHidden = document.hidden;
    if (track) track.classList.toggle('tkr-paused', pageHidden);
    if (!pageHidden && track) Object.keys(state.data).forEach((sym) => renderItem(sym));
  }

  function destroy() {
    alive = false;
    closeCrypto();
    if (metalTimer) { clearInterval(metalTimer); metalTimer = null; }
    if (fxTimer) { clearInterval(fxTimer); fxTimer = null; }
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    window.removeEventListener('resize', onResize);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeydown);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function init() {
    const box = document.getElementById('ticker-box');
    if (!box) return;
    injectStyle();
    loadCfg();
    renderShell(box);
    renderPanel();
    rebuildTrack();

    connectCrypto();
    pollMetals();
    pollFx();
    metalTimer = setInterval(pollMetals, METAL_POLL_MS);
    fxTimer = setInterval(pollFx, FX_POLL_MS);

    window.addEventListener('resize', onResize);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility(); // 应用初始可见性状态（隐藏加载时立即暂停动画）
    window.addEventListener('pagehide', destroy);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
