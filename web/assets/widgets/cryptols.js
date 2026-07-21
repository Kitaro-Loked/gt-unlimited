/* 主流币多空情绪对比 — 币安 U 本位永续公开数据 (fapi.binance.com, CORS: Access-Control-Allow-Origin: *)
 * 三个接口（均 ?symbol=<SYM>&period=5m&limit=1，逐币种并发取最新一条；已 curl 实测 2026-07-16，HTTP 200 且带 ACAO:*）：
 *   账户比: GET /futures/data/globalLongShortAccountRatio  字段 longAccount/shortAccount（全体账户多空数之比，小数）
 *   大户比: GET /futures/data/topLongShortPositionRatio    字段 longAccount/shortAccount（大户持仓量多空之比，小数）
 *   买卖比: GET /futures/data/takerlongshortRatio          字段 buyVol/sellVol（Taker 主动买/卖成交量）
 * 展示口径：各指标统一换算为多头占比 0-100（taker = buyVol/(buyVol+sellVol)*100），综合 = 三项均值。
 * 与 sentiment.js（BTC/ETH/SOL 三币仪表盘）差异化：本组件为 11 币种横向对比表 + 全市场汇总条形。
 * 配色：加密货币绿涨红跌，多方占优于 var(--up)=绿，空方占优于 var(--down)=红，语义与站点一致。
 * Registers as custom tool id 'cryptols' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
    'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'LTCUSDT', 'TRXUSDT',
  ];
  const FAPI = 'https://fapi.binance.com';
  const METRICS = [
    { key: 'acct', path: 'globalLongShortAccountRatio', name: '账户比', desc: '全体账户多空人数之比 → 多头占比%' },
    { key: 'top', path: 'topLongShortPositionRatio', name: '大户比', desc: '大户持仓量多空之比 → 多头占比%' },
    { key: 'taker', path: 'takerlongshortRatio', name: '买卖比', desc: 'Taker 主动买/(买+卖)成交量 → 买方占比%' },
  ];
  const metricUrl = (m, sym) => `${FAPI}/futures/data/${m.path}?symbol=${sym}&period=5m&limit=1`;

  const REFRESH_MS = 60000; // 加密市场 7×24 无休市，固定 60s
  const FETCH_TIMEOUT_MS = 10000;
  const MAX_ATTEMPTS = 2; // 每次请求失败重试 1 次

  function injectStyle() {
    if (document.getElementById('cryptols-style')) return;
    const style = document.createElement('style');
    style.id = 'cryptols-style';
    style.textContent = `
.cryptols-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.cryptols-status { color: var(--warning); white-space: nowrap; }
.cryptols-status.live { color: var(--acc); }
.cryptols-sub {
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.cryptols-sum {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--surface-raised);
}
.cryptols-sum-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.cryptols-sum-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.cryptols-sum-value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cryptols-sum-bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: var(--down);
  overflow: hidden;
}
.cryptols-sum-bar::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: var(--hairline-strong);
}
.cryptols-sum-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--up);
  transition: width 0.4s var(--ease-fluid);
}
.cryptols-sum-note {
  margin-top: 6px;
  font-size: 9px;
  color: var(--text-dim);
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.cryptols-sum-note b { font-weight: 400; font-family: var(--font-mono); }
.cryptols-table { font-variant-numeric: tabular-nums; }
.cryptols-table th, .cryptols-table td { white-space: nowrap; }
.cryptols-table th.cryptols-r, .cryptols-table td.cryptols-r { text-align: right; }
.cryptols-sym { font-weight: 600; }
.cryptols-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.cryptols-num { font-family: var(--font-mono); }
/* 加密货币绿涨红跌：var(--up)=绿=多方占优、var(--down)=红=空方占优，语义与站点一致 */
.cryptols-long { color: var(--up); }
.cryptols-short { color: var(--down); }
.cryptols-flat { color: var(--text-muted); }
.cryptols-comp { min-width: 72px; }
.cryptols-comp-val {
  display: block;
  font-family: var(--font-mono);
  text-align: right;
  margin-bottom: 3px;
}
.cryptols-mini-bar {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: var(--hairline);
}
.cryptols-mini-bar::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -1px;
  bottom: -1px;
  width: 1px;
  background: var(--hairline-strong);
}
.cryptols-mini-fill {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 999px;
  transition: left 0.4s var(--ease-fluid), width 0.4s var(--ease-fluid);
}
.cryptols-mini-fill.long { background: var(--up); }
.cryptols-mini-fill.short { background: var(--down); }
.cryptols-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cryptols-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.cryptols-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
body.light-mode .cryptols-mini-bar { background: color-mix(in srgb, var(--text) 8%, transparent); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const clamp = (v) => Math.min(100, Math.max(0, v));

  const fmtPct = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');

  // 多头占比 → 方向 class：>=50 多方占优(绿)，<50 空方占优(红)
  const sideClass = (longPct) => {
    if (!Number.isFinite(longPct)) return 'cryptols-flat';
    return longPct >= 50 ? 'cryptols-long' : 'cryptols-short';
  };

  // 各指标原始值 → 多头占比 0-100
  const toLongPct = {
    acct: (d) => parseFloat(d.longAccount) * 100,
    top: (d) => parseFloat(d.longAccount) * 100,
    taker: (d) => {
      const buy = parseFloat(d.buyVol);
      const sell = parseFloat(d.sellVol);
      return Number.isFinite(buy) && Number.isFinite(sell) && buy + sell > 0 ? (buy / (buy + sell)) * 100 : NaN;
    },
  };

  window.GT_EXTRA_TOOLS['cryptols'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cryptols-root">
          <div class="cryptols-head">
            <span>主流币 · 多空情绪对比</span>
            <span class="cryptols-status" data-conn>连接中…</span>
          </div>
          <div class="cryptols-sub">币安 USDT 永续 · 各列均为多头占比(%)，绿=多方占优 / 红=空方占优</div>
          <div class="cryptols-sum">
            <div class="cryptols-sum-top">
              <span class="cryptols-sum-label">全市场多头占比均值</span>
              <span class="cryptols-sum-value cryptols-flat" data-avg>—</span>
            </div>
            <div class="cryptols-sum-bar"><span class="cryptols-sum-fill" data-sum-fill style="width:50%"></span></div>
            <div class="cryptols-sum-note">
              <span data-breadth>多头占优 — · 空头占优 —</span>
              <span>综合 = 账户比/大户比/买卖比 三项均值</span>
            </div>
          </div>
          <table class="data-table cryptols-table">
            <thead>
              <tr>
                <th>币种</th>
                ${METRICS.map((m) => `<th class="cryptols-r" title="${esc(m.desc)}">${esc(m.name)}</th>`).join('')}
                <th class="cryptols-r">综合</th>
              </tr>
            </thead>
            <tbody data-body>
              ${SYMBOLS.map(
                (s) => `
                <tr data-sym="${esc(s)}">
                  <td class="cryptols-sym">${esc(s.replace(/USDT$/, ''))}<i>USDT 永续</i></td>
                  ${METRICS.map((m) => `<td class="cryptols-num cryptols-r cryptols-flat" data-m="${m.key}">—</td>`).join('')}
                  <td class="cryptols-comp" data-m="comp">
                    <span class="cryptols-comp-val cryptols-flat" data-comp-val>—</span>
                    <div class="cryptols-mini-bar"><span class="cryptols-mini-fill long" data-comp-fill style="left:50%;width:0"></span></div>
                  </td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
          <div class="cryptols-foot">
            <span>来源: Binance Futures · 周期 5m · 每 60s 刷新</span>
            <span>更新: <b data-updated>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const avgEl = el.querySelector('[data-avg]');
      const sumFill = el.querySelector('[data-sum-fill]');
      const breadthEl = el.querySelector('[data-breadth]');
      const updatedEl = el.querySelector('[data-updated]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'cryptols-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'cryptols-status live';
        setStatus('online');
      };

      // 带超时 + 重试 1 次的 JSON fetch（仿 ashareboard fetchBoard 的 controller/timer 管理）
      const fetchJSON = async (url) => {
        let lastErr = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            return await resp.json();
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('fetch error');
      };

      // 单指标：取最新一条，换算为多头占比
      const fetchMetric = async (sym, m) => {
        const json = await fetchJSON(metricUrl(m, sym));
        const arr = Array.isArray(json) ? json : [];
        const last = arr.length ? arr[arr.length - 1] : null;
        const pct = last ? toLongPct[m.key](last) : NaN;
        if (!Number.isFinite(pct)) throw new Error('empty');
        return clamp(pct);
      };

      const renderMetric = (sym, key, pct) => {
        const td = el.querySelector(`tr[data-sym="${sym}"] td[data-m="${key}"]`);
        if (!td) return;
        td.textContent = fmtPct(pct);
        td.className = `cryptols-num cryptols-r ${sideClass(pct)}`;
      };

      const renderComposite = (sym, pct) => {
        const td = el.querySelector(`tr[data-sym="${sym}"] td[data-m="comp"]`);
        if (!td) return;
        const valEl = td.querySelector('[data-comp-val]');
        const fillEl = td.querySelector('[data-comp-fill]');
        if (!Number.isFinite(pct)) {
          valEl.textContent = '—';
          valEl.className = 'cryptols-comp-val cryptols-flat';
          fillEl.style.left = '50%';
          fillEl.style.width = '0';
          return;
        }
        valEl.textContent = fmtPct(pct);
        valEl.className = `cryptols-comp-val ${sideClass(pct)}`;
        if (pct >= 50) {
          fillEl.className = 'cryptols-mini-fill long';
          fillEl.style.left = '50%';
          fillEl.style.width = `${pct - 50}%`;
        } else {
          fillEl.className = 'cryptols-mini-fill short';
          fillEl.style.left = `${pct}%`;
          fillEl.style.width = `${50 - pct}%`;
        }
      };

      // 汇总：全市场综合多头占比均值 + 多/空占优家数
      const renderSummary = (comps) => {
        const valid = comps.filter((v) => Number.isFinite(v));
        if (!valid.length) return;
        const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
        avgEl.textContent = `${fmtPct(avg)}%`;
        avgEl.className = `cryptols-sum-value ${sideClass(avg)}`;
        sumFill.style.width = `${clamp(avg)}%`;
        const longs = valid.filter((v) => v >= 50).length;
        breadthEl.innerHTML = `多头占优 <b class="cryptols-long">${longs}</b> · 空头占优 <b class="cryptols-short">${valid.length - longs}</b>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        // 新请求前 abort 上一轮可能残留的 fetch
        pendingAborts.forEach((c) => {
          try { c.abort(); } catch (e) { /* 忽略 */ }
        });
        try {
          // 逐币种并发拉取三项指标；单项失败留空，不阻断其他
          const results = await Promise.allSettled(
            SYMBOLS.map(async (sym) => {
              const scores = await Promise.all(
                METRICS.map(async (m) => {
                  try {
                    const pct = await fetchMetric(sym, m);
                    if (alive) renderMetric(sym, m.key, pct);
                    return pct;
                  } catch (e) {
                    return null; // 单接口失败：静默留空，不计入综合
                  }
                })
              );
              const valid = scores.filter((v) => v !== null);
              const comp = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
              if (alive) renderComposite(sym, comp);
              return comp;
            })
          );
          if (!alive) return;
          const comps = results.map((r) => (r.status === 'fulfilled' ? r.value : NaN));
          const okCount = comps.filter((v) => Number.isFinite(v)).length;
          if (okCount === 0) {
            showError('币安接口连接失败，60 秒后自动重试…');
            return;
          }
          clearError();
          renderSummary(comps);
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return; // 页面不可见时跳过刷新
        refresh();
      };

      setStatus('loading');
      refresh();
      tickTimer = setInterval(tick, REFRESH_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        pendingAborts.forEach((c) => {
          try { c.abort(); } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
      };
    },
  };
})();
