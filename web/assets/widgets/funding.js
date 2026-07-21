/* Funding rate + long/short ratio panel — Binance USD-M futures public REST (no API key)
 * Registers as custom tool id 'funding' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'];
  const LS_SYMBOLS = SYMBOLS.slice(0, 4); // long/short ratio: 仅前 4 个，避免限流
  const PREMIUM_URL = `https://fapi.binance.com/fapi/v1/premiumIndex?symbols=${encodeURIComponent(JSON.stringify(SYMBOLS))}`;
  const LS_URL = (sym) =>
    `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`;
  const REFRESH_MS = 30000;

  function injectStyle() {
    if (document.getElementById('fdr-style')) return;
    const style = document.createElement('style');
    style.id = 'fdr-style';
    style.textContent = `
.fdr-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.fdr-status { color: var(--warning); }
.fdr-status.live { color: var(--up); }
.fdr-table { font-variant-numeric: tabular-nums; }
.fdr-table th, .fdr-table td { white-space: nowrap; }
.fdr-sym { font-weight: 600; }
.fdr-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.fdr-num { font-family: var(--font-mono); }
.fdr-cd { color: var(--text-muted); }
.fdr-lsbar {
  display: flex;
  width: 64px;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--hairline);
}
.fdr-lsbar .fdr-long { background: var(--up); height: 100%; }
.fdr-lsbar .fdr-short { background: var(--down); height: 100%; flex: 1; }
.fdr-ls-cell { display: flex; align-items: center; gap: 6px; }
.fdr-ls-pct { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); }
.fdr-ls-na { color: var(--text-dim); }
`;
    document.head.appendChild(style);
  }

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toPrecision(4);
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return '结算中…';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  window.GT_EXTRA_TOOLS['funding'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool fdr-root">
          <div class="fdr-head"><span>BINANCE FUTURES · U本位永续</span><span class="fdr-status" data-conn>连接中…</span></div>
          <table class="data-table fdr-table">
            <thead>
              <tr><th>币种</th><th>资金费率</th><th>标记价</th><th>下次结算</th><th>多空比</th></tr>
            </thead>
            <tbody>
              ${SYMBOLS.map(
                (s) => `
                <tr data-sym="${s}">
                  <td class="fdr-sym">${s.replace('USDT', '')}<i>/USDT</i></td>
                  <td class="fdr-num" data-rate>—</td>
                  <td class="fdr-num" data-price>—</td>
                  <td class="fdr-num fdr-cd" data-cd>—</td>
                  <td data-ls><span class="fdr-ls-na">—</span></td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const nextFunding = {}; // sym -> nextFundingTime (ms)
      let alive = true;
      let refreshTimer = null;
      let tickTimer = null;

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'fdr-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'fdr-status live';
        setStatus('online');
      };

      const renderLs = (sym, longPct) => {
        const cell = el.querySelector(`tr[data-sym="${sym}"] [data-ls]`);
        if (!cell) return;
        if (!Number.isFinite(longPct)) return; // 无数据则保持留空
        const pct = (longPct * 100).toFixed(1);
        cell.innerHTML = `
          <div class="fdr-ls-cell" title="多 ${pct}% / 空 ${(100 - pct).toFixed(1)}%">
            <div class="fdr-lsbar"><span class="fdr-long" style="width:${pct}%"></span><span class="fdr-short"></span></div>
            <span class="fdr-ls-pct">${pct}%</span>
          </div>`;
      };

      const loadLongShort = async () => {
        // 每个 symbol 单独请求，仅前 4 个，失败静默（留空）
        await Promise.allSettled(
          LS_SYMBOLS.map(async (sym) => {
            const res = await fetch(LS_URL(sym));
            if (!res.ok) throw new Error(`ls ${res.status}`);
            const data = await res.json();
            const item = Array.isArray(data) ? data[0] : null;
            if (item && alive) renderLs(sym, parseFloat(item.longAccount));
          })
        );
      };

      const loadFunding = async () => {
        try {
          const res = await fetch(PREMIUM_URL);
          if (!res.ok) throw new Error(`http ${res.status}`);
          const data = await res.json();
          if (!Array.isArray(data)) throw new Error('bad data');
          const bySym = {};
          data.forEach((d) => { bySym[d.symbol] = d; });
          let found = 0;
          SYMBOLS.forEach((sym) => {
            const d = bySym[sym];
            if (!d) return;
            found += 1;
            const row = el.querySelector(`tr[data-sym="${sym}"]`);
            if (!row) return;
            const rate = parseFloat(d.lastFundingRate);
            const ratePct = rate * 100;
            const rateEl = row.querySelector('[data-rate]');
            rateEl.textContent = `${ratePct >= 0 ? '+' : ''}${ratePct.toFixed(4)}%`;
            rateEl.classList.remove('pos', 'neg', 'warn');
            rateEl.classList.add(ratePct >= 0.01 ? 'warn' : rate >= 0 ? 'pos' : 'neg');
            row.querySelector('[data-price]').textContent = fmtPrice(parseFloat(d.markPrice));
            nextFunding[sym] = Number(d.nextFundingTime) || 0;
          });
          if (!found) throw new Error('empty');
          if (!alive) return;
          clearError();
          loadLongShort();
        } catch (e) {
          if (!alive) return;
          showError('资金费率数据加载失败，稍后自动重试');
        }
      };

      const tick = () => {
        SYMBOLS.forEach((sym) => {
          const t = nextFunding[sym];
          if (!t) return;
          const cdEl = el.querySelector(`tr[data-sym="${sym}"] [data-cd]`);
          if (cdEl) cdEl.textContent = fmtCountdown(t - Date.now());
        });
      };

      loadFunding();
      refreshTimer = setInterval(loadFunding, REFRESH_MS);
      tickTimer = setInterval(tick, 1000);

      return () => {
        alive = false;
        if (refreshTimer) clearInterval(refreshTimer);
        if (tickTimer) clearInterval(tickTimer);
      };
    },
  };
})();
