/* Futures long/short sentiment panel — Binance USD-M futures public REST (no API key)
 * Registers as custom tool id 'sentiment' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const API = (path, sym) => `https://fapi.binance.com/futures/data/${path}?symbol=${sym}&period=1h&limit=1`;
  const REFRESH_MS = 60000;

  const METRICS = [
    { key: 'retail', name: '散户多空比', desc: '多空账户数之比（全体账户）' },
    { key: 'top', name: '大户持仓比', desc: '大户持仓量多空之比' },
    { key: 'taker', name: '主动买卖比', desc: 'Taker 主动买入/卖出成交量之比' },
  ];

  const GAUGE_STOPS = [
    { max: 25, label: '极度恐慌', color: 'var(--down)' },
    { max: 45, label: '偏空', color: 'color-mix(in srgb, var(--down) 45%, var(--warning))' },
    { max: 55, label: '中性', color: 'var(--warning)' },
    { max: 75, label: '偏多', color: 'color-mix(in srgb, var(--up) 55%, var(--warning))' },
    { max: Infinity, label: '极度贪婪', color: 'var(--up)' },
  ];

  function injectStyle() {
    if (document.getElementById('sent-style')) return;
    const style = document.createElement('style');
    style.id = 'sent-style';
    style.textContent = `
.sent-root { font-variant-numeric: tabular-nums; }
.sent-gauge {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--hairline);
  margin-bottom: 10px;
}
.sent-gauge-num {
  font-family: var(--font-mono);
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}
.sent-gauge-meta { display: flex; flex-direction: column; gap: 2px; }
.sent-gauge-label { font-size: 13px; font-weight: 600; }
.sent-gauge-sub { font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); }
.sent-gauge-track {
  height: 6px;
  border-radius: 3px;
  margin-top: 6px;
  background: linear-gradient(90deg, var(--down) 0%, color-mix(in srgb, var(--down) 45%, var(--warning)) 25%, var(--warning) 50%, color-mix(in srgb, var(--up) 55%, var(--warning)) 75%, var(--up) 100%);
  position: relative;
  flex-basis: 100%;
}
.sent-gauge-pin {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 12px;
  background: var(--text);
  border-radius: 1px;
  transform: translateX(-50%);
  transition: left 0.4s var(--ease-fluid);
}
.sent-block {
  padding: 8px 0;
  border-bottom: 1px solid var(--hairline);
}
.sent-block:last-of-type { border-bottom: none; }
.sent-block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.sent-sym { font-weight: 600; font-size: 12px; }
.sent-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.sent-score { font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
.sent-row {
  display: grid;
  grid-template-columns: 64px 44px 1fr;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  font-size: 10px;
}
.sent-row-name { color: var(--text-muted); white-space: nowrap; }
.sent-row-val { font-family: var(--font-mono); text-align: right; }
.sent-bar {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: var(--hairline);
}
.sent-bar::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: var(--hairline-strong);
}
.sent-bar-fill {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 4px;
  transition: left 0.4s var(--ease-fluid), width 0.4s var(--ease-fluid);
}
.sent-bar-fill.long { background: var(--up); }
.sent-bar-fill.short { background: var(--down); }
.sent-foot {
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const clamp = (v) => Math.min(100, Math.max(0, v));

  function gaugeStop(score) {
    return GAUGE_STOPS.find((g) => score < g.max) || GAUGE_STOPS[GAUGE_STOPS.length - 1];
  }

  window.GT_EXTRA_TOOLS['sentiment'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool sent-root">
          <div class="sent-gauge-wrap">
            <div class="sent-gauge">
              <span class="sent-gauge-num" data-g-num>—</span>
              <span class="sent-gauge-meta">
                <span class="sent-gauge-label" data-g-label>加载中…</span>
                <span class="sent-gauge-sub">综合情绪 · BTC / ETH / SOL</span>
              </span>
            </div>
            <div class="sent-gauge-track"><span class="sent-gauge-pin" data-g-pin style="left:50%"></span></div>
          </div>
          <div data-blocks>
            ${SYMBOLS.map(
              (s) => `
              <div class="sent-block" data-sym="${esc(s)}">
                <div class="sent-block-head">
                  <span class="sent-sym">${esc(s.replace('USDT', ''))}<i>/USDT 永续</i></span>
                  <span class="sent-score" data-score>—</span>
                </div>
                ${METRICS.map(
                  (m) => `
                  <div class="sent-row" data-metric="${m.key}" title="${esc(m.desc)}">
                    <span class="sent-row-name">${esc(m.name)}</span>
                    <span class="sent-row-val" data-val>—</span>
                    <div class="sent-bar"><span class="sent-bar-fill" data-fill style="left:50%;width:0"></span></div>
                  </div>`
                ).join('')}
              </div>`
            ).join('')}
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="sent-foot">数据源：Binance USDⓈ-M Futures · 周期 1h · 每 60s 刷新</div>
        </div>`;

      const gNum = el.querySelector('[data-g-num]');
      const gLabel = el.querySelector('[data-g-label]');
      const gPin = el.querySelector('[data-g-pin]');
      const hint = el.querySelector('[data-hint]');
      let alive = true;
      let timer = null;

      const renderMetric = (sym, key, longPct) => {
        const row = el.querySelector(`.sent-block[data-sym="${sym}"] .sent-row[data-metric="${key}"]`);
        if (!row || !Number.isFinite(longPct)) return;
        const pct = clamp(longPct);
        row.querySelector('[data-val]').textContent = pct.toFixed(1);
        const fill = row.querySelector('[data-fill]');
        if (pct >= 50) {
          fill.className = 'sent-bar-fill long';
          fill.style.left = '50%';
          fill.style.width = `${pct - 50}%`;
        } else {
          fill.className = 'sent-bar-fill short';
          fill.style.left = `${pct}%`;
          fill.style.width = `${50 - pct}%`;
        }
      };

      const renderScore = (sym, score) => {
        const scoreEl = el.querySelector(`.sent-block[data-sym="${sym}"] [data-score]`);
        if (!scoreEl) return;
        if (!Number.isFinite(score)) return;
        const stop = gaugeStop(score);
        scoreEl.textContent = `${score.toFixed(0)} · ${stop.label}`;
        scoreEl.style.color = stop.color;
      };

      const renderGauge = (score) => {
        if (!Number.isFinite(score)) return;
        const stop = gaugeStop(score);
        gNum.textContent = score.toFixed(0);
        gNum.style.color = stop.color;
        gLabel.textContent = stop.label;
        gLabel.style.color = stop.color;
        gPin.style.left = `${clamp(score)}%`;
      };

      // 各指标原始值 → 多头占比 0-100
      const toLongPct = {
        retail: (d) => parseFloat(d.longAccount) * 100,
        top: (d) => parseFloat(d.longAccount) * 100,
        taker: (d) => {
          const r = parseFloat(d.buySellRatio);
          return Number.isFinite(r) && r >= 0 ? (r / (1 + r)) * 100 : NaN;
        },
      };

      const fetchMetric = async (sym, key) => {
        const path =
          key === 'retail'
            ? 'globalLongShortAccountRatio'
            : key === 'top'
              ? 'topLongShortPositionRatio'
              : 'takerlongshortRatio';
        const res = await fetch(API(path, sym));
        if (!res.ok) throw new Error(`http ${res.status}`);
        const data = await res.json();
        const item = Array.isArray(data) ? data[0] : null;
        if (!item) throw new Error('empty');
        const pct = toLongPct[key](item);
        if (!Number.isFinite(pct)) throw new Error('bad data');
        return pct;
      };

      const load = async () => {
        const results = await Promise.allSettled(
          SYMBOLS.map(async (sym) => {
            const scores = await Promise.all(
              METRICS.map(async (m) => {
                try {
                  const pct = await fetchMetric(sym, m.key);
                  if (alive) renderMetric(sym, m.key, pct);
                  return pct; // 单接口失败：静默留空，不计入合成
                } catch (e) {
                  return null;
                }
              })
            );
            const valid = scores.filter((v) => v !== null);
            return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
          })
        );
        if (!alive) return;

        const symScores = results.map((r, i) => (r.status === 'fulfilled' ? r.value : null));
        symScores.forEach((s, i) => {
          if (s !== null) renderScore(SYMBOLS[i], s);
        });
        const valid = symScores.filter((v) => v !== null);
        if (!valid.length) {
          hint.textContent = '情绪数据加载失败，稍后自动重试';
          hint.style.display = '';
          setStatus('offline');
          return;
        }
        hint.style.display = 'none';
        setStatus('online');
        renderGauge(valid.reduce((a, b) => a + b, 0) / valid.length);
      };

      load();
      timer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        if (timer) clearInterval(timer);
      };
    },
  };
})();
