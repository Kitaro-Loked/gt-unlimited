/* Auto pivot points panel — Binance spot public REST + WebSocket (no API key)
 * Daily H/L/C from klines(1d, limit=2) previous complete day; live price via @miniTicker WS (REST 15s fallback).
 * Registers as custom tool id 'autopivot' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SYMBOLS = [
    { id: 'BTCUSDT', label: 'BTC / USDT' },
    { id: 'ETHUSDT', label: 'ETH / USDT' },
    { id: 'SOLUSDT', label: 'SOL / USDT' },
    { id: 'BNBUSDT', label: 'BNB / USDT' },
    { id: 'XRPUSDT', label: 'XRP / USDT' },
    { id: 'PAXGUSDT', label: 'PAXG · 黄金' },
  ];
  const METHODS = [
    { id: 'classic', label: '经典 Classic' },
    { id: 'camarilla', label: '卡玛利拉 Camarilla' },
    { id: 'fib', label: '斐波那契 Fib' },
  ];
  const KLINE_URL = (sym) => `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=2`;
  const TICKER_URL = (sym) => `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify([sym]))}`;
  const WS_URL = (sym) => `wss://stream.binance.com:9443/stream?streams=${sym.toLowerCase()}@miniTicker`;
  const DAILY_REFRESH_MS = 5 * 60 * 1000; // 日数据 5 分钟自动重取
  const PRICE_POLL_MS = 15000;

  function injectStyle() {
    if (document.getElementById('apv-style')) return;
    const style = document.createElement('style');
    style.id = 'apv-style';
    style.textContent = `
.apv-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.apv-sym {
  background: var(--surface); color: var(--text); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); padding: 4px 8px; font-size: 12px; font-family: var(--font-mono);
  outline: none; cursor: pointer;
  transition: border-color 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid);
}
.apv-sym:focus { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-glow); }
.apv-tabs { display: flex; gap: 4px; }
.apv-tab {
  background: transparent; color: var(--text-muted); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); padding: 3px 8px; font-size: 10px; cursor: pointer; letter-spacing: 0.04em;
  transition: color 0.3s var(--ease-fluid), border-color 0.3s var(--ease-fluid), background 0.3s var(--ease-fluid);
}
.apv-tab:hover { color: var(--text); border-color: var(--hairline-strong); }
.apv-tab.active { color: var(--acc); border-color: var(--acc); background: var(--acc-glow); }
.apv-body { display: flex; gap: 12px; align-items: stretch; }
.apv-table { flex: 1; min-width: 0; }
.apv-table tr.key-level td { box-shadow: inset 2px 0 0 var(--acc); }
.apv-table .lv { white-space: nowrap; }
.apv-tag {
  display: none; margin-left: 6px; font-size: 9px; font-family: var(--font-mono);
  color: var(--acc); background: var(--acc-glow); border-radius: 3px; padding: 1px 4px;
}
.apv-table tr.key-level .apv-tag { display: inline-block; }
.apv-side {
  display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 108px;
  border-left: 1px solid var(--hairline); padding-left: 12px;
}
.apv-side-label { font-size: 9px; letter-spacing: 0.14em; color: var(--text-muted); }
.apv-price {
  font-family: var(--font-mono); font-size: 18px; font-weight: 600; color: var(--text);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.apv-conn { font-size: 9px; letter-spacing: 0.12em; color: var(--warning); }
.apv-conn.live { color: var(--acc); }
.apv-period { font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); }
.apv-table .pr { font-variant-numeric: tabular-nums; }
`;
    document.head.appendChild(style);
  }

  // PAXG 固定 2 位小数；其它按量级自适应
  function decimals(sym, ref) {
    if (sym === 'PAXGUSDT') return 2;
    if (ref >= 500) return 2;
    if (ref >= 50) return 3;
    if (ref >= 1) return 4;
    return 5;
  }

  function fmtPx(v, d) {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // 前一完整日 H/L/C → 各方法价位表（自上而下：阻力 → 枢轴 → 支撑）
  function computeLevels(h, l, c, method) {
    const range = h - l;
    const p = (h + l + c) / 3;
    if (method === 'camarilla') {
      return [
        { name: 'R4', price: c + (range * 1.1) / 2, cls: 'res' },
        { name: 'R3', price: c + (range * 1.1) / 4, cls: 'res' },
        { name: 'R2', price: c + (range * 1.1) / 6, cls: 'res' },
        { name: 'R1', price: c + (range * 1.1) / 12, cls: 'res' },
        { name: 'S1', price: c - (range * 1.1) / 12, cls: 'sup' },
        { name: 'S2', price: c - (range * 1.1) / 6, cls: 'sup' },
        { name: 'S3', price: c - (range * 1.1) / 4, cls: 'sup' },
        { name: 'S4', price: c - (range * 1.1) / 2, cls: 'sup' },
      ];
    }
    if (method === 'fib') {
      return [
        { name: 'R3', price: p + range, cls: 'res' },
        { name: 'R2', price: p + 0.618 * range, cls: 'res' },
        { name: 'R1', price: p + 0.382 * range, cls: 'res' },
        { name: 'P', price: p, cls: 'piv' },
        { name: 'S1', price: p - 0.382 * range, cls: 'sup' },
        { name: 'S2', price: p - 0.618 * range, cls: 'sup' },
        { name: 'S3', price: p - range, cls: 'sup' },
      ];
    }
    return [
      { name: 'R3', price: h + 2 * (p - l), cls: 'res' },
      { name: 'R2', price: p + range, cls: 'res' },
      { name: 'R1', price: 2 * p - l, cls: 'res' },
      { name: 'P', price: p, cls: 'piv' },
      { name: 'S1', price: 2 * p - h, cls: 'sup' },
      { name: 'S2', price: p - range, cls: 'sup' },
      { name: 'S3', price: l - 2 * (h - p), cls: 'sup' },
    ];
  }

  window.GT_EXTRA_TOOLS['autopivot'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool apv-root">
          <div class="apv-head">
            <select class="apv-sym" data-sym>
              ${SYMBOLS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
            </select>
            <div class="apv-tabs" data-tabs>
              ${METHODS.map((m, i) => `<button type="button" class="apv-tab${i === 0 ? ' active' : ''}" data-method="${m.id}">${m.label}</button>`).join('')}
            </div>
          </div>
          <div class="apv-body">
            <table class="level-table apv-table"><tbody data-levels>
              <tr><td class="lv" style="color:var(--text-dim)">加载日K数据…</td></tr>
            </tbody></table>
            <div class="apv-side">
              <span class="apv-side-label">现价 LAST</span>
              <span class="apv-price" data-price>—</span>
              <span class="apv-conn" data-conn>连接中…</span>
              <span class="apv-period" data-period>周期 —</span>
            </div>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const symSel = el.querySelector('[data-sym]');
      const tabsBox = el.querySelector('[data-tabs]');
      const levelsBody = el.querySelector('[data-levels]');
      const priceEl = el.querySelector('[data-price]');
      const connEl = el.querySelector('[data-conn]');
      const periodEl = el.querySelector('[data-period]');
      const hint = el.querySelector('[data-hint]');

      let symbol = SYMBOLS[0].id;
      let method = METHODS[0].id;
      let day = null; // { h, l, c, date }
      let price = NaN;
      let rowsMeta = []; // [{ tr, tag, price }]
      let alive = true;
      let ws = null;
      let pollTimer = null;
      let dailyTimer = null;
      const ctl = new AbortController();

      const showHint = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
      };
      const clearHint = () => {
        hint.style.display = 'none';
      };

      // 网络请求带一次自动重试（1.5s 后）
      const fetchJson = async (url) => {
        let lastErr = null;
        for (let i = 0; i < 2; i += 1) {
          try {
            const res = await fetch(url, { signal: ctl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
          } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            lastErr = e;
            if (i === 0) await new Promise((r) => setTimeout(r, 1500));
          }
        }
        throw lastErr;
      };

      const renderTable = () => {
        rowsMeta = [];
        if (!day) {
          levelsBody.innerHTML = '<tr><td class="lv" style="color:var(--text-dim)">加载日K数据…</td></tr>';
          return;
        }
        const d = decimals(symbol, day.c);
        const levels = computeLevels(day.h, day.l, day.c, method);
        levelsBody.innerHTML = levels
          .map(
            (lv) =>
              `<tr class="${lv.cls}"><td class="lv">${lv.name}<span class="apv-tag" data-tag></span></td><td class="pr">${fmtPx(lv.price, d)}</td></tr>`
          )
          .join('');
        rowsMeta = levels.map((lv, i) => ({
          tr: levelsBody.children[i],
          tag: levelsBody.children[i].querySelector('[data-tag]'),
          price: lv.price,
        }));
        applyPrice();
      };

      // 高亮最近上方压力位 / 下方支撑位，并标注距现价百分比
      const applyPrice = () => {
        const d = decimals(symbol, Number.isFinite(price) ? price : day ? day.c : 1);
        priceEl.textContent = fmtPx(price, d);
        if (!rowsMeta.length || !Number.isFinite(price) || price <= 0) return;
        let above = -1;
        let below = -1;
        rowsMeta.forEach((r, i) => {
          if (r.price > price && (above < 0 || r.price < rowsMeta[above].price)) above = i;
          if (r.price < price && (below < 0 || r.price > rowsMeta[below].price)) below = i;
        });
        rowsMeta.forEach((r, i) => {
          const hot = i === above || i === below;
          r.tr.classList.toggle('key-level', hot);
          if (hot) {
            const pct = ((r.price - price) / price) * 100;
            r.tag.textContent = `距现价 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
          } else {
            r.tag.textContent = '';
          }
        });
      };

      // 前一完整日 K线：limit=2 时 [0] 为前一交易日（[1] 为当日未完结）
      const loadDaily = async () => {
        try {
          const data = await fetchJson(KLINE_URL(symbol));
          if (!alive) return;
          const k = Array.isArray(data) && data.length >= 2 ? data[data.length - 2] : Array.isArray(data) ? data[0] : null;
          const h = k ? parseFloat(k[2]) : NaN;
          const l = k ? parseFloat(k[3]) : NaN;
          const c = k ? parseFloat(k[4]) : NaN;
          if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || h <= l) throw new Error('bad kline');
          day = { h, l, c, date: new Date(Number(k[0])).toISOString().slice(0, 10) };
          periodEl.textContent = `周期 ${day.date} UTC · 前一交易日`;
          clearHint();
          setStatus('online');
          renderTable();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          if (!day) {
            levelsBody.innerHTML = '<tr><td class="lv" style="color:var(--text-dim)">日K数据加载失败</td></tr>';
            setStatus('offline');
          }
          showHint('日K数据加载失败，稍后自动重试（5 分钟周期）');
        }
      };

      const pollPrice = async () => {
        try {
          const data = await fetchJson(TICKER_URL(symbol));
          if (!alive) return;
          const item = Array.isArray(data) ? data[0] : null;
          const p = item ? parseFloat(item.lastPrice) : NaN;
          if (!Number.isFinite(p)) throw new Error('bad price');
          price = p;
          connEl.textContent = 'POLLING · 15S';
          connEl.className = 'apv-conn live';
          setStatus('online');
          applyPrice();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          connEl.textContent = '现价获取失败';
          connEl.className = 'apv-conn';
          if (!Number.isFinite(price)) showHint('现价数据加载失败，稍后自动重试');
        }
      };

      const stopPoll = () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      const connectWs = () => {
        if (ws) {
          try { ws.close(); } catch (e) { /* noop */ }
          ws = null;
        }
        stopPoll();
        try {
          const sock = new WebSocket(WS_URL(symbol));
          ws = sock;
          sock.onopen = () => {
            if (!alive || sock !== ws) return;
            connEl.textContent = '● LIVE';
            connEl.className = 'apv-conn live';
            setStatus('online');
          };
          sock.onmessage = (ev) => {
            if (!alive || sock !== ws) return;
            try {
              const d = JSON.parse(ev.data).data;
              const p = d ? parseFloat(d.c) : NaN;
              if (Number.isFinite(p)) {
                price = p;
                applyPrice();
              }
            } catch (e) { /* noop */ }
          };
          sock.onclose = () => {
            if (!alive || sock !== ws) return; // 已切换品种或已卸载的旧 socket 事件忽略
            // WS 断开 → REST 15s 轮询兜底
            connEl.textContent = 'POLLING · 15S';
            connEl.className = 'apv-conn';
            pollPrice();
            if (!pollTimer) pollTimer = setInterval(pollPrice, PRICE_POLL_MS);
          };
          sock.onerror = () => {
            sock.close();
          };
        } catch (e) {
          pollPrice();
          if (!pollTimer) pollTimer = setInterval(pollPrice, PRICE_POLL_MS);
        }
      };

      symSel.addEventListener('change', () => {
        symbol = symSel.value;
        day = null;
        price = NaN;
        periodEl.textContent = '周期 —';
        priceEl.textContent = '—';
        clearHint();
        renderTable();
        loadDaily();
        connectWs();
      });

      tabsBox.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-method]');
        if (!btn) return;
        method = btn.getAttribute('data-method');
        tabsBox.querySelectorAll('.apv-tab').forEach((b) => b.classList.toggle('active', b === btn));
        renderTable();
      });

      loadDaily();
      connectWs();
      dailyTimer = setInterval(loadDaily, DAILY_REFRESH_MS);

      return () => {
        alive = false;
        ctl.abort();
        if (dailyTimer) clearInterval(dailyTimer);
        stopPoll();
        if (ws) {
          try { ws.close(); } catch (e) { /* noop */ }
          ws = null;
        }
      };
    },
  };
})();
