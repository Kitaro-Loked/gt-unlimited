/* Multi-timeframe technical indicator dashboard — Binance spot klines (no API key)
 * Symbols × 1h/4h/1d, RSI(14) + MACD(12,26,9) hist + EMA20/50, ATR(14)% volatility.
 * Registers as custom tool id 'indicators' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'];
  const TFS = ['1h', '4h', '1d'];
  const KLINE_URL = (sym, tf) =>
    `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=120`;
  const REFRESH_MS = 60000;
  const STAGGER_MS = 150; // 24 个请求错开，避免突发

  function injectStyle() {
    if (document.getElementById('ind-style')) return;
    const style = document.createElement('style');
    style.id = 'ind-style';
    style.textContent = `
.ind-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.ind-head-right { display: flex; align-items: center; gap: 8px; }
.ind-status { color: var(--warning); }
.ind-status.live { color: var(--acc); }
.ind-upd { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ind-refresh { padding: 2px 8px; font-size: 9px; letter-spacing: 0.1em; }
.ind-table { font-variant-numeric: tabular-nums; }
.ind-table th, .ind-table td { white-space: nowrap; text-align: center; }
.ind-table th:first-child, .ind-table td:first-child,
.ind-table th:nth-child(2), .ind-table td:nth-child(2) { text-align: left; }
.ind-sym { font-weight: 600; }
.ind-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.ind-price { font-family: var(--font-mono); }
.ind-dots { display: inline-flex; gap: 4px; vertical-align: middle; margin-right: 6px; }
.ind-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hairline-strong);
  display: inline-block;
}
.ind-dot.bull { background: var(--up); }
.ind-dot.bear { background: var(--down); }
.ind-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  letter-spacing: 0.06em;
}
.ind-badge.s3 { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 16%, transparent); }
.ind-badge.s2 { color: var(--up); }
.ind-badge.s1 { color: var(--down); }
.ind-badge.s0 { color: var(--down); border-color: var(--down); background: color-mix(in srgb, var(--down) 16%, transparent); }
.ind-cell-na { color: var(--text-dim); }
.ind-atr { font-family: var(--font-mono); color: var(--text-muted); }
.ind-legend {
  margin-top: 8px;
  font-size: 9px;
  line-height: 1.6;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
`;
    document.head.appendChild(style);
  }

  // ---------- 指标计算（纯 JS） ----------

  function emaSeries(values, period) {
    const k = 2 / (period + 1);
    const out = new Array(values.length);
    let prev = values[0];
    for (let i = 0; i < values.length; i++) {
      prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsiLast(closes, period) {
    if (closes.length < period + 1) return NaN;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgG = gain / period;
    let avgL = loss / period;
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
      avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (avgL === 0) return 100;
    const rs = avgG / avgL;
    return 100 - 100 / (1 + rs);
  }

  function macdHistLast(closes) {
    if (closes.length < 35) return NaN;
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    const macd = [];
    for (let i = 25; i < closes.length; i++) macd.push(fast[i] - slow[i]);
    const signal = emaSeries(macd, 9);
    return macd[macd.length - 1] - signal[signal.length - 1];
  }

  function atrLast(highs, lows, closes, period) {
    if (closes.length < period + 1) return NaN;
    const tr = (i) => Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    let atr = 0;
    for (let i = 1; i <= period; i++) atr += tr(i);
    atr /= period;
    for (let i = period + 1; i < closes.length; i++) {
      atr = (atr * (period - 1) + tr(i)) / period;
    }
    return atr;
  }

  // 解析 klines 并计算某周期的 3 个信号
  function analyzeTf(raw) {
    if (!Array.isArray(raw) || raw.length < 60) return null;
    const closes = raw.map((k) => parseFloat(k[4]));
    if (closes.some((v) => !Number.isFinite(v))) return null;
    const rsi = rsiLast(closes, 14);
    const hist = macdHistLast(closes);
    const e20 = emaSeries(closes, 20).pop();
    const e50 = emaSeries(closes, 50).pop();
    const close = closes[closes.length - 1];
    if (![rsi, hist, e20, e50, close].every(Number.isFinite)) return null;
    const sigs = [rsi > 50 ? 1 : 0, hist > 0 ? 1 : 0, e20 > e50 ? 1 : 0];
    return {
      sigs,
      bull: sigs[0] + sigs[1] + sigs[2],
      rsi,
      hist,
      e20,
      e50,
      close,
      vsEma20: ((close - e20) / e20) * 100,
    };
  }

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toPrecision(4);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  const TF_BADGE = ['强空', '偏空', '偏多', '强多']; // index = 多信号数 0..3

  window.GT_EXTRA_TOOLS['indicators'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool ind-root">
          <div class="ind-head">
            <span class="ind-status" data-conn>连接中…</span>
            <span class="ind-head-right">
              <span data-upd>更新 —</span>
              <button type="button" class="tool-btn ghost ind-refresh" data-refresh>刷新</button>
            </span>
          </div>
          <table class="data-table ind-table">
            <thead>
              <tr><th>币种</th><th>现价</th><th>1H</th><th>4H</th><th>1D</th><th>综合</th><th>ATR%</th></tr>
            </thead>
            <tbody>
              ${SYMBOLS.map(
                (s) => `
                <tr data-sym="${s}">
                  <td class="ind-sym">${s.replace('USDT', '')}<i>/USDT</i></td>
                  <td class="ind-price" data-price>—</td>
                  ${TFS.map((tf) => `<td data-cell="${tf}"><span class="ind-cell-na">…</span></td>`).join('')}
                  <td data-overall><span class="ind-cell-na">…</span></td>
                  <td class="ind-atr" data-atr>—</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="ind-legend">
            信号点（左→右）：RSI(14)&gt;50 多 · MACD(12,26,9) 柱&gt;0 多 · EMA20&gt;EMA50 多；绿=多 红=空。<br>
            周期徽章：3多=强多 / 2多=偏多 / 1多=偏空 / 0多=强空。综合列=三周期 9 票：≥6 强多 / 4-5 偏多 / 3 偏空 / ≤2 强空。<br>
            ATR% = 日线 ATR(14) ÷ 现价，衡量波动幅度。数据：Binance 现货 K线，60s 自动刷新。
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const updEl = el.querySelector('[data-upd]');
      const refreshBtn = el.querySelector('[data-refresh]');
      const ctl = new AbortController();
      const tfData = {}; // sym -> { '1h': {...}, '4h': {...}, '1d': {...}, atrPct }
      let alive = true;
      let loading = false;
      let refreshTimer = null;

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'ind-status';
        setStatus('offline');
      };
      const markLive = (failCount) => {
        conn.textContent = '● LIVE';
        conn.className = 'ind-status live';
        setStatus('online');
        if (failCount > 0) {
          hint.textContent = `${failCount} 个周期数据加载失败，下轮自动重试`;
          hint.style.display = '';
        } else {
          hint.style.display = 'none';
        }
      };

      const renderTfCell = (sym, tf) => {
        const cell = el.querySelector(`tr[data-sym="${sym}"] [data-cell="${tf}"]`);
        const d = tfData[sym] && tfData[sym][tf];
        if (!cell || !d) return;
        const dotTitle = [
          `RSI(14) ${d.rsi.toFixed(1)} ${d.sigs[0] ? '多' : '空'}`,
          `MACD柱 ${d.hist >= 0 ? '+' : ''}${d.hist.toPrecision(3)} ${d.sigs[1] ? '多' : '空'}`,
          `EMA20 ${d.sigs[2] ? '>' : '<'} EMA50 ${d.sigs[2] ? '多' : '空'}`,
        ].join(' · ');
        const dots = d.sigs
          .map((s) => `<span class="ind-dot ${s ? 'bull' : 'bear'}"></span>`)
          .join('');
        cell.innerHTML = `
          <span title="${esc(dotTitle)}｜收盘 vs EMA20 ${d.vsEma20 >= 0 ? '+' : ''}${d.vsEma20.toFixed(2)}%">
            <span class="ind-dots">${dots}</span><span class="ind-badge s${d.bull}">${TF_BADGE[d.bull]}</span>
          </span>`;
      };

      const renderOverall = (sym) => {
        const d = tfData[sym];
        if (!d) return;
        const overallCell = el.querySelector(`tr[data-sym="${sym}"] [data-overall]`);
        if (!overallCell) return;
        if (!d['1h'] || !d['4h'] || !d['1d']) {
          overallCell.innerHTML = '<span class="ind-cell-na">—</span>';
          return;
        }
        const votes = d['1h'].bull + d['4h'].bull + d['1d'].bull;
        const label = votes >= 6 ? '强多' : votes >= 4 ? '偏多' : votes >= 3 ? '偏空' : '强空';
        const cls = votes >= 6 ? 's3' : votes >= 4 ? 's2' : votes >= 3 ? 's1' : 's0';
        overallCell.innerHTML = `<span class="ind-badge ${cls}" title="9 票中 ${votes} 票看多">${label} ${votes}/9</span>`;
      };

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const loadAll = async () => {
        if (loading || !alive) return;
        loading = true;
        refreshBtn.disabled = true;
        const tasks = [];
        SYMBOLS.forEach((sym) => TFS.forEach((tf) => tasks.push({ sym, tf })));
        let ok = 0;
        let fail = 0;
        await Promise.all(
          tasks.map((t, i) =>
            (async () => {
              await sleep(i * STAGGER_MS);
              if (!alive) return;
              try {
                const res = await fetch(KLINE_URL(t.sym, t.tf), { signal: ctl.signal });
                if (!res.ok) throw new Error(`http ${res.status}`);
                const raw = await res.json();
                const a = analyzeTf(raw);
                if (!a) throw new Error('bad data');
                if (!alive) return;
                tfData[t.sym] = tfData[t.sym] || {};
                tfData[t.sym][t.tf] = a;
                ok += 1;
                if (t.tf === '1h') {
                  const priceEl = el.querySelector(`tr[data-sym="${t.sym}"] [data-price]`);
                  if (priceEl) priceEl.textContent = fmtPrice(a.close);
                }
                if (t.tf === '1d') {
                  const highs = raw.map((k) => parseFloat(k[2]));
                  const lows = raw.map((k) => parseFloat(k[3]));
                  const closes = raw.map((k) => parseFloat(k[4]));
                  const atr = atrLast(highs, lows, closes, 14);
                  const atrEl = el.querySelector(`tr[data-sym="${t.sym}"] [data-atr]`);
                  if (atrEl) {
                    atrEl.textContent = Number.isFinite(atr) ? `${((atr / a.close) * 100).toFixed(2)}%` : '—';
                  }
                }
                renderTfCell(t.sym, t.tf);
                renderOverall(t.sym);
              } catch (e) {
                if (e && e.name === 'AbortError') return;
                fail += 1;
              }
            })()
          )
        );
        loading = false;
        if (!alive) return;
        refreshBtn.disabled = false;
        if (ok === 0) {
          showError('指标数据加载失败，稍后自动重试');
          return;
        }
        markLive(fail);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        updEl.textContent = `更新 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      };

      refreshBtn.addEventListener('click', loadAll);
      loadAll();
      refreshTimer = setInterval(loadAll, REFRESH_MS);

      return () => {
        alive = false;
        ctl.abort();
        if (refreshTimer) clearInterval(refreshTimer);
        refreshBtn.removeEventListener('click', loadAll);
      };
    },
  };
})();
