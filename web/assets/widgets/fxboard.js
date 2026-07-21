/* FX & precious metals board — gold-api.com (XAU/XAG realtime) + frankfurter (ECB daily FX).
 * Registers as custom tool id 'fxboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const METAL_REFRESH_MS = 30000;
  const FX_REFRESH_MS = 300000;
  const BASE_LS_KEY = 'gt-fxboard-base-v1';
  const FX_SYMBOLS = 'EUR,GBP,JPY,AUD,CAD,CHF,NZD,CNH';
  const FX_LATEST_URL = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${FX_SYMBOLS}`;
  const FX_RANGE_URL = (start) =>
    `https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${FX_SYMBOLS}`;

  const METALS = [
    { key: 'XAU', name: '黄金', code: 'XAUUSD', url: 'https://api.gold-api.com/price/XAU' },
    { key: 'XAG', name: '白银', code: 'XAGUSD', url: 'https://api.gold-api.com/price/XAG' },
  ];

  // quote: 'USD' 表示 XXXUSD（倒数），'BASE' 表示 USDXXX（直取）
  const FX_PAIRS = [
    { code: 'EURUSD', name: '欧元/美元', quote: 'EUR', dir: 'inv', digits: 5 },
    { code: 'GBPUSD', name: '英镑/美元', quote: 'GBP', dir: 'inv', digits: 5 },
    { code: 'AUDUSD', name: '澳元/美元', quote: 'AUD', dir: 'inv', digits: 5 },
    { code: 'NZDUSD', name: '纽元/美元', quote: 'NZD', dir: 'inv', digits: 5 },
    { code: 'USDJPY', name: '美元/日元', quote: 'JPY', dir: 'dir', digits: 3 },
    { code: 'USDCAD', name: '美元/加元', quote: 'CAD', dir: 'dir', digits: 5 },
    { code: 'USDCHF', name: '美元/瑞郎', quote: 'CHF', dir: 'dir', digits: 5 },
    { code: 'USDCNH', name: '美元/离岸人民币', quote: 'CNH', dir: 'dir', digits: 5 },
  ];

  function injectStyle() {
    if (document.getElementById('fxb-style')) return;
    const style = document.createElement('style');
    style.id = 'fxb-style';
    style.textContent = `
.fxb-sec-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin: 10px 0 6px;
}
.fxb-sec-head:first-child { margin-top: 0; }
.fxb-sec-head .fxb-src { color: var(--text-dim); letter-spacing: 0.06em; text-transform: none; }
.fxb-table { font-variant-numeric: tabular-nums; }
.fxb-table th, .fxb-table td { white-space: nowrap; }
.fxb-table th.fxb-num, .fxb-table td.fxb-num { text-align: right; }
.fxb-sym { font-weight: 600; }
.fxb-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; margin-left: 5px; font-size: 9px; }
.fxb-price {
  position: relative;
  display: inline-block;
  font-family: var(--font-mono);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
}
.fxb-price::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
}
/* 涨跌闪烁：覆盖层仅动 opacity，符合动画约束 */
.fxb-flash-up::before { background: color-mix(in srgb, var(--up) 30%, transparent); animation: fxb-flash 0.9s var(--ease-fluid); }
.fxb-flash-down::before { background: color-mix(in srgb, var(--down) 30%, transparent); animation: fxb-flash 0.9s var(--ease-fluid); }
@keyframes fxb-flash {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
`;
    document.head.appendChild(style);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtNum(v, digits) {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtSigned(v, digits) {
    if (!Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${fmtNum(v, digits)}`;
  }

  function fmtPct(v) {
    if (!Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  function fmtTime(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  // USD 基准换算：XXXUSD = 1/rates.XXX，USDXXX = rates.XXX
  function pairPrice(pair, rates) {
    const r = rates && Number(rates[pair.quote]);
    if (!Number.isFinite(r) || r <= 0) return NaN;
    return pair.dir === 'inv' ? 1 / r : r;
  }

  function fetchWithRetry(url, signal, tries) {
    const attempt = (n) =>
      fetch(url, { signal }).then((res) => {
        if (!res.ok) throw new Error(`http ${res.status}`);
        return res.json();
      }).catch((err) => {
        if (err.name === 'AbortError') throw err;
        if (n <= 1) throw err;
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            attempt(n - 1).then(resolve, reject);
          }, 1500);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new DOMException('aborted', 'AbortError'));
            }, { once: true });
          }
        });
      });
    return attempt(tries);
  }

  window.GT_EXTRA_TOOLS['fxboard'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool fxb-root">
          <div class="fxb-sec-head">
            <span>贵金属 · PRECIOUS METALS</span>
            <span class="fxb-src" data-metal-src>实时 · gold-api · —</span>
          </div>
          <table class="data-table fxb-table">
            <thead>
              <tr><th>品种</th><th class="fxb-num">最新价</th><th class="fxb-num">涨跌额</th><th class="fxb-num">涨跌幅</th></tr>
            </thead>
            <tbody>
              ${METALS.map(
                (m) => `
                <tr data-metal="${m.key}">
                  <td class="fxb-sym">${esc(m.name)}<i>${esc(m.code)}</i></td>
                  <td class="fxb-num"><span class="fxb-price" data-price>—</span></td>
                  <td class="fxb-num" data-chg>—</td>
                  <td class="fxb-num" data-pct>—</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
          <div class="tool-hint" data-metal-hint style="display:none"></div>
          <div class="fxb-sec-head">
            <span>外汇直盘 · FX MAJORS</span>
            <span class="fxb-src" data-fx-src>ECB 日频 · frankfurter · —</span>
          </div>
          <table class="data-table fxb-table">
            <thead>
              <tr><th>品种</th><th class="fxb-num">最新价</th><th class="fxb-num">涨跌额</th><th class="fxb-num">涨跌幅</th></tr>
            </thead>
            <tbody>
              ${FX_PAIRS.map(
                (p) => `
                <tr data-fx="${p.code}">
                  <td class="fxb-sym">${esc(p.name)}<i>${esc(p.code)}</i></td>
                  <td class="fxb-num"><span class="fxb-price" data-price>—</span></td>
                  <td class="fxb-num" data-chg>—</td>
                  <td class="fxb-num" data-pct>—</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
          <div class="tool-hint" data-fx-hint style="display:none"></div>
        </div>`;

      const metalSrc = el.querySelector('[data-metal-src]');
      const metalHint = el.querySelector('[data-metal-hint]');
      const fxSrc = el.querySelector('[data-fx-src]');
      const fxHint = el.querySelector('[data-fx-hint]');
      let alive = true;
      let metalTimer = null;
      let fxTimer = null;
      let metalFail = false;
      let fxFail = false;
      const controller = new AbortController();
      const signal = controller.signal;
      const lastPrice = {}; // 上一次轮询价格，用于 flash 判断

      const updateStatus = () => {
        setStatus(metalFail && fxFail ? 'offline' : 'online');
      };

      const showHint = (hintEl, msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const hideHint = (hintEl) => {
        hintEl.style.display = 'none';
      };

      // 当天首次价作为涨跌基准，存 localStorage
      const readBase = () => {
        try {
          const raw = localStorage.getItem(BASE_LS_KEY);
          if (!raw) return null;
          const obj = JSON.parse(raw);
          return obj && typeof obj === 'object' ? obj : null;
        } catch (e) {
          return null;
        }
      };
      const writeBase = (base) => {
        try {
          localStorage.setItem(BASE_LS_KEY, JSON.stringify(base));
        } catch (e) { /* 存储不可用时忽略 */ }
      };

      const flashPrice = (priceEl, prev, next) => {
        if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return;
        priceEl.classList.remove('fxb-flash-up', 'fxb-flash-down');
        void priceEl.offsetWidth; // 强制回流以重触发动画
        priceEl.classList.add(next > prev ? 'fxb-flash-up' : 'fxb-flash-down');
      };

      const renderChange = (row, chg, pct, digits) => {
        const chgEl = row.querySelector('[data-chg]');
        const pctEl = row.querySelector('[data-pct]');
        chgEl.textContent = fmtSigned(chg, digits);
        pctEl.textContent = fmtPct(pct);
        [chgEl, pctEl].forEach((n) => {
          n.classList.remove('pos', 'neg');
          if (Number.isFinite(pct) && pct !== 0) n.classList.add(pct > 0 ? 'pos' : 'neg');
        });
      };

      const loadMetals = async () => {
        const results = await Promise.allSettled(
          METALS.map((m) => fetchWithRetry(m.url, signal, 2))
        );
        if (!alive) return;
        const today = isoDate(new Date());
        let base = readBase();
        if (!base || base.date !== today) base = { date: today };
        let ok = 0;
        results.forEach((res, i) => {
          const m = METALS[i];
          if (res.status !== 'fulfilled') return;
          const price = Number(res.value && res.value.price);
          if (!Number.isFinite(price)) return;
          ok += 1;
          if (!Number.isFinite(base[m.key])) base[m.key] = price; // 当天首次价
          const row = el.querySelector(`tr[data-metal="${m.key}"]`);
          if (!row) return;
          const priceEl = row.querySelector('[data-price]');
          flashPrice(priceEl, lastPrice[m.key], price);
          lastPrice[m.key] = price;
          priceEl.textContent = fmtNum(price, 2);
          const chg = price - base[m.key];
          const pct = (chg / base[m.key]) * 100;
          renderChange(row, chg, pct, 2);
        });
        writeBase(base);
        if (ok > 0) {
          metalFail = false;
          hideHint(metalHint);
          metalSrc.textContent = `实时 · gold-api · ${fmtTime(new Date())}`;
        } else {
          metalFail = true;
          showHint(metalHint, '贵金属行情加载失败，30 秒后自动重试');
        }
        updateStatus();
      };

      const loadFx = async () => {
        try {
          const start = new Date(Date.now() - 7 * 86400000);
          const [latest, range] = await Promise.all([
            fetchWithRetry(FX_LATEST_URL, signal, 2),
            fetchWithRetry(FX_RANGE_URL(isoDate(start)), signal, 2),
          ]);
          if (!alive) return;
          const latestRates = latest && latest.rates;
          if (!latestRates) throw new Error('bad data');
          // 区间数据取最后两个交易日算涨跌
          const dates = Object.keys((range && range.rates) || {}).sort();
          const prevRates = dates.length >= 2 ? range.rates[dates[dates.length - 2]] : null;
          FX_PAIRS.forEach((pair) => {
            const price = pairPrice(pair, latestRates);
            if (!Number.isFinite(price)) return;
            const prev = prevRates ? pairPrice(pair, prevRates) : NaN;
            const row = el.querySelector(`tr[data-fx="${pair.code}"]`);
            if (!row) return;
            const priceEl = row.querySelector('[data-price]');
            flashPrice(priceEl, lastPrice[pair.code], price);
            lastPrice[pair.code] = price;
            priceEl.textContent = fmtNum(price, pair.digits);
            const chg = Number.isFinite(prev) ? price - prev : NaN;
            const pct = Number.isFinite(prev) && prev !== 0 ? (chg / prev) * 100 : NaN;
            renderChange(row, chg, pct, pair.digits);
          });
          fxFail = false;
          hideHint(fxHint);
          const rateDate = latest.date ? esc(latest.date) : dates[dates.length - 1] || '—';
          fxSrc.textContent = `ECB 日频 · ${rateDate} · 更新 ${fmtTime(new Date())}`;
        } catch (e) {
          if (!alive) return;
          fxFail = true;
          showHint(fxHint, '外汇行情加载失败，5 分钟后自动重试');
        }
        updateStatus();
      };

      loadMetals();
      loadFx();
      metalTimer = setInterval(loadMetals, METAL_REFRESH_MS);
      fxTimer = setInterval(loadFx, FX_REFRESH_MS);

      return () => {
        alive = false;
        controller.abort();
        if (metalTimer) clearInterval(metalTimer);
        if (fxTimer) clearInterval(fxTimer);
      };
    },
  };
})();
