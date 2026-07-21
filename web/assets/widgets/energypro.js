/* ENERGY_PRO · 能源期货专业版
 * 实时行情：WTI 原油 / Brent 原油 / 天然气 / RBOB 汽油 / 取暖油(ULSD) / 能源板块ETF
 * 数据来源：TradingView scanner (免费、公开、CORS 可用)
 *   https://scanner.tradingview.com/symbol?symbol=<SYMBOL>&fields=close,open,change,change_abs
 * Registers as custom tool id 'energypro' via window.GT_EXTRA_TOOLS.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 12000;
  const TV_API = 'https://scanner.tradingview.com/symbol';

  const ITEMS = [
    { key: 'cl', symbol: 'NYMEX:CL1!', name: 'WTI 原油', unit: 'USD/bbl', dec: 2 },
    { key: 'bz', symbol: 'NYMEX:BZ1!', name: 'Brent 原油', unit: 'USD/bbl', dec: 2 },
    { key: 'ng', symbol: 'NYMEX:NG1!', name: '天然气', unit: 'USD/MMBtu', dec: 3 },
    { key: 'rb', symbol: 'NYMEX:RB1!', name: 'RBOB 汽油', unit: 'USD/gal', dec: 3 },
    { key: 'ho', symbol: 'NYMEX:HO1!', name: '取暖油 / ULSD', unit: 'USD/gal', dec: 3 },
    { key: 'xle', symbol: 'AMEX:XLE', name: '能源板块 ETF', unit: 'USD', dec: 2 },
  ];

  function injectStyle() {
    if (document.getElementById('energypro-style')) return;
    const style = document.createElement('style');
    style.id = 'energypro-style';
    style.textContent = `
.energypro-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.energypro-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
  flex-shrink: 0;
}
.energypro-status { color: var(--warning); white-space: nowrap; }
.energypro-status.live { color: var(--acc); }
.energypro-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
@media (max-width: 720px) {
  .energypro-grid { grid-template-columns: repeat(2, 1fr); }
}
.energypro-card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px;
  position: relative;
  overflow: hidden;
}
.energypro-card.error { border-color: color-mix(in srgb, var(--down) 40%, var(--hairline)); }
.energypro-card-name {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.energypro-card-symbol {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.energypro-card-price {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-bottom: 2px;
}
.energypro-card-chg {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.energypro-up { color: var(--up); }
.energypro-down { color: var(--down); }
.energypro-flat { color: var(--text-muted); }
.energypro-spread {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
  flex-shrink: 0;
}
.energypro-spread-label {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.08em;
}
.energypro-spread-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.energypro-spread-note {
  margin-left: auto;
  font-size: 9px;
  color: var(--text-dim);
}
.energypro-chart-wrap {
  flex: 1;
  min-height: 120px;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px;
  position: relative;
  overflow: hidden;
}
.energypro-chart-title {
  position: absolute;
  top: 8px;
  left: 10px;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  z-index: 1;
}
.energypro-chart {
  width: 100%;
  height: 100%;
  display: block;
}
.energypro-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 8px;
  flex-shrink: 0;
}
.energypro-hint {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 8px;
  flex-shrink: 0;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtPrice = (v, dec) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'energypro-flat';
    return v > 0 ? 'energypro-up' : 'energypro-down';
  };

  const fetchTV = async (symbol) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${TV_API}?symbol=${encodeURIComponent(symbol)}&fields=close,open,change,change_abs`, {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = await res.json();
      if (!json || typeof json.close !== 'number' || !Number.isFinite(json.close)) {
        throw new Error('bad payload');
      }
      const open = typeof json.open === 'number' && Number.isFinite(json.open) ? json.open : null;
      const change = typeof json.change === 'number' && Number.isFinite(json.change) ? json.change : null;
      const changeAbs = typeof json.change_abs === 'number' && Number.isFinite(json.change_abs) ? json.change_abs : null;
      return { price: json.close, open, change, changeAbs };
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  };

  const drawChart = (canvas, dataMap) => {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 200);
    const height = Math.max(rect.height, 100);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const computed = getComputedStyle(document.body);
    const up = computed.getPropertyValue('--up').trim() || '#00c853';
    const down = computed.getPropertyValue('--down').trim() || '#ff5252';
    const textMuted = computed.getPropertyValue('--text-muted').trim() || '#888';
    const hairline = computed.getPropertyValue('--hairline').trim() || '#333';
    const acc = computed.getPropertyValue('--acc').trim() || '#ffaa00';

    ctx.clearRect(0, 0, width, height);

    const items = ITEMS.filter((it) => dataMap[it.key] && Number.isFinite(dataMap[it.key].change));
    if (items.length === 0) {
      ctx.fillStyle = textMuted;
      ctx.font = '10px var(--font-mono)';
      ctx.textAlign = 'center';
      ctx.fillText('等待行情数据…', width / 2, height / 2);
      return;
    }

    const padd = { top: 26, right: 16, bottom: 28, left: 38 };
    const chartW = width - padd.left - padd.right;
    const chartH = height - padd.top - padd.bottom;

    const values = items.map((it) => dataMap[it.key].change);
    const maxV = Math.max(...values.map((v) => Math.abs(v)), 0.5);
    const yMid = padd.top + chartH / 2;

    // grid zero line
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padd.left, yMid);
    ctx.lineTo(width - padd.right, yMid);
    ctx.stroke();

    // y-axis labels
    ctx.fillStyle = textMuted;
    ctx.font = '9px var(--font-mono)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${maxV.toFixed(2)}%`, padd.left - 6, padd.top);
    ctx.fillText('0.00%', padd.left - 6, yMid);
    ctx.fillText(`-${maxV.toFixed(2)}%`, padd.left - 6, padd.top + chartH);

    const barW = Math.min(28, chartW / items.length * 0.55);
    const step = items.length > 1 ? chartW / items.length : 0;

    items.forEach((it, i) => {
      const v = dataMap[it.key].change;
      const x = padd.left + step * i + step / 2;
      const barH = (v / maxV) * (chartH / 2);
      const isUp = v >= 0;
      const y = isUp ? yMid - barH : yMid;

      ctx.fillStyle = isUp ? up : down;
      const r = 2;
      const bh = Math.abs(barH);
      ctx.beginPath();
      ctx.roundRect(x - barW / 2, y, barW, Math.max(bh, 2), [r, r, r, r]);
      ctx.fill();

      // x-axis label
      ctx.fillStyle = textMuted;
      ctx.font = '9px var(--font-mono)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(it.key.toUpperCase(), x, padd.top + chartH + 6);
    });

    // title
    ctx.fillStyle = acc;
    ctx.font = '9px var(--font-sans)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('日涨跌 %', padd.left, 6);
  };

  window.GT_EXTRA_TOOLS['energypro'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool energypro-root">
          <div class="energypro-head">
            <span>ENERGY PRO · 能源期货</span>
            <span class="energypro-status" data-conn>连接中…</span>
          </div>
          <div class="energypro-hint">NYMEX / ICE 能源期货主力合约，60s 刷新</div>
          <div class="energypro-grid" data-grid>
            ${ITEMS.map((it) => `
              <div class="energypro-card" data-card="${esc(it.key)}">
                <div class="energypro-card-name">${esc(it.name)}</div>
                <div class="energypro-card-symbol">${esc(it.symbol)}</div>
                <div class="energypro-card-price energypro-flat" data-price="${esc(it.key)}">—</div>
                <div class="energypro-card-chg energypro-flat" data-chg="${esc(it.key)}">—</div>
              </div>
            `).join('')}
          </div>
          <div class="energypro-spread">
            <span class="energypro-spread-label">WTI − BRENT 价差</span>
            <span class="energypro-spread-value energypro-flat" data-spread>—</span>
            <span class="energypro-spread-note">负值表示 Brent 升水</span>
          </div>
          <div class="energypro-chart-wrap">
            <span class="energypro-chart-title">FRONT-MONTH PERFORMANCE</span>
            <canvas class="energypro-chart" data-chart></canvas>
          </div>
          <div class="energypro-foot">
            <span>来源：TradingView Scanner</span>
            <span data-time>—</span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const timeEl = el.querySelector('[data-time]');
      const spreadEl = el.querySelector('[data-spread]');
      const chartCanvas = el.querySelector('[data-chart]');
      const cards = {};
      ITEMS.forEach((it) => {
        cards[it.key] = {
          card: el.querySelector(`[data-card="${it.key}"]`),
          price: el.querySelector(`[data-price="${it.key}"]`),
          chg: el.querySelector(`[data-chg="${it.key}"]`),
        };
      });

      let alive = true;
      let timer = null;
      let resizeObserver = null;
      const dataMap = {};

      const setConn = (ok) => {
        if (ok) {
          conn.textContent = '● LIVE';
          conn.className = 'energypro-status live';
          setStatus('online');
        } else {
          conn.textContent = '连接失败';
          conn.className = 'energypro-status';
          setStatus('offline');
        }
      };

      const markError = (it) => {
        const c = cards[it.key];
        if (!c) return;
        c.card.classList.add('error');
        c.price.textContent = '—';
        c.chg.textContent = '不可用';
        c.price.className = 'energypro-card-price energypro-flat';
        c.chg.className = 'energypro-card-chg energypro-flat';
      };

      const updateCard = (it, d) => {
        const c = cards[it.key];
        if (!c) return;
        c.card.classList.remove('error');
        c.price.textContent = fmtPrice(d.price, it.dec);
        const pct = Number.isFinite(d.change) ? d.change : (Number.isFinite(d.open) && d.open > 0 ? ((d.price - d.open) / d.open) * 100 : null);
        const abs = Number.isFinite(d.changeAbs) ? d.changeAbs : (Number.isFinite(d.open) ? d.price - d.open : null);
        const cls = dirClass(pct);
        c.price.className = `energypro-card-price ${cls}`;
        c.chg.className = `energypro-card-chg ${cls}`;
        if (Number.isFinite(pct)) {
          const sign = pct >= 0 ? '+' : '';
          const absStr = Number.isFinite(abs) ? `${sign}${abs.toFixed(it.dec)} ${it.unit.split('/')[0]} · ` : '';
          c.chg.textContent = `${absStr}${sign}${pct.toFixed(2)}%`;
        } else {
          c.chg.textContent = '—';
        }
      };

      const updateSpread = () => {
        const cl = dataMap.cl;
        const bz = dataMap.bz;
        if (cl && bz && Number.isFinite(cl.price) && Number.isFinite(bz.price)) {
          const spread = cl.price - bz.price;
          spreadEl.textContent = `${spread >= 0 ? '+' : ''}${spread.toFixed(2)} USD/bbl`;
          spreadEl.className = `energypro-spread-value ${dirClass(spread)}`;
        } else {
          spreadEl.textContent = '—';
          spreadEl.className = 'energypro-spread-value energypro-flat';
        }
      };

      const redraw = () => {
        if (chartCanvas) drawChart(chartCanvas, dataMap);
      };

      const load = async () => {
        let okCount = 0;
        const results = await Promise.all(
          ITEMS.map(async (it) => {
            try {
              const d = await fetchTV(it.symbol);
              return { it, d, ok: true };
            } catch (e) {
              return { it, d: null, ok: false };
            }
          })
        );
        if (!alive) return;
        results.forEach(({ it, d, ok }) => {
          if (ok && d) {
            dataMap[it.key] = d;
            updateCard(it, d);
            okCount += 1;
          } else {
            markError(it);
          }
        });
        updateSpread();
        redraw();
        timeEl.textContent = `更新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
        setConn(okCount > 0);
      };

      load();
      timer = setInterval(load, REFRESH_MS);

      if (chartCanvas && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => redraw());
        resizeObserver.observe(chartCanvas.parentElement);
      }

      return () => {
        alive = false;
        if (timer) clearInterval(timer);
        if (resizeObserver) resizeObserver.disconnect();
      };
    },
  };
})();
