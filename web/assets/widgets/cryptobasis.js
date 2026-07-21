/* 币安期现基差套利监控 — Binance 现货价 vs U本位永续标记价(CORS JSON)
 * 现货: https://api.binance.com/api/v3/ticker/price （全量数组，字段 symbol/price）
 * 合约: https://fapi.binance.com/fapi/v1/premiumIndex （全量数组，字段 symbol/markPrice/indexPrice/lastFundingRate/nextFundingTime；fapi 不支持 HEAD，用 GET 验证）
 * 已用 curl GET 实测 2026-07-16：两接口均 HTTP 200，响应头均带 Access-Control-Allow-Origin: *（响应体约 150-190KB）。
 * 基差口径: (永续标记价 - 现货最新价) / 现货最新价 × 100%；剔除现货价偏离 indexPrice(币安综合指数价) >1% 的异常对
 *   （实测 2026-07-16：不过滤时 TROY/LIT 等已下架或换币对出现 ±60%~378% 的假基差，过滤后 448→380 对，|基差|中位数 0.16%）。
 * 机会高亮: 基差 ≤ -0.1% 为深度贴水(红)，≥ +0.1% 为高升水(绿)；资金费率与基差同向(期现套利可同时吃基差收敛+资金费)标 ★。
 * 与 funding.js 的分工: funding.js 固定 8 个主流币的资金费率/倒计时/多空比；本组件做全市场期现基差扫描与套利价差排序。
 * 加密组件绿涨红跌：基差/费率方向着色用 var(--up)=正/升水 / var(--down)=负/贴水。
 * 加密市场 24/7，固定 30s 刷新；document.hidden 时跳过。
 * Registers as custom tool id 'cryptobasis' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SPOT_URL = 'https://api.binance.com/api/v3/ticker/price';
  const PREM_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';

  const TOP_N = 15;
  const DEEP_NEG_PCT = -0.1; // 深度贴水阈值（任务约定）
  const HIGH_POS_PCT = 0.1; // 高升水阈值（与贴水对称）
  const SPOT_INDEX_TOLERANCE = 0.01; // 现货价与指数价允许偏差，超出视为现货异常/已下架
  const REFRESH_MS = 30000; // 加密市场 24/7，固定 30s
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('cbasis-style')) return;
    const style = document.createElement('style');
    style.id = 'cbasis-style';
    style.textContent = `
.cbasis-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.cbasis-status { color: var(--warning); white-space: nowrap; }
.cbasis-status.live { color: var(--acc); }
.cbasis-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
}
.cbasis-stats b {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.cbasis-table { width: 100%; font-variant-numeric: tabular-nums; }
.cbasis-table th, .cbasis-table td { white-space: nowrap; }
.cbasis-table th:not(:first-child), .cbasis-table td:not(:first-child) { text-align: right; }
.cbasis-coin { font-weight: 600; }
.cbasis-coin i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 9px; }
.cbasis-num { font-family: var(--font-mono); }
.cb-up { color: var(--up); }
.cb-down { color: var(--down); }
.cb-flat { color: var(--text-muted); }
.cbasis-badge {
  font-weight: 400;
  font-size: 8px;
  padding: 0 4px;
  border-radius: 999px;
  margin-left: 5px;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
  white-space: nowrap;
  vertical-align: 1px;
}
.cbasis-badge.pos {
  color: var(--up);
  border-color: color-mix(in srgb, var(--up) 45%, transparent);
  background: color-mix(in srgb, var(--up) 10%, transparent);
}
.cbasis-badge.neg {
  color: var(--down);
  border-color: color-mix(in srgb, var(--down) 45%, transparent);
  background: color-mix(in srgb, var(--down) 10%, transparent);
}
.cbasis-table tbody tr.cbasis-opp-pos { background: color-mix(in srgb, var(--up) 5%, transparent); }
.cbasis-table tbody tr.cbasis-opp-neg { background: color-mix(in srgb, var(--down) 5%, transparent); }
.cbasis-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cbasis-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  // 币价量级差异大（0.000x ~ 100,000+），按量级自适应小数位
  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
    return v.toLocaleString('en-US', { maximumFractionDigits: d });
  };

  // 资金费率年化(%)：8h 费率 × 3 × 365，按量级自适应小数位
  const fmtAnn = (v) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    return `${v > 0 ? '+' : ''}${fmtNum(v, d)}%`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'cb-flat';
    return v > 0 ? 'cb-up' : 'cb-down';
  };

  window.GT_EXTRA_TOOLS['cryptobasis'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cbasis-root">
          <div class="cbasis-head">
            <span>币安 · 期现基差套利</span>
            <span class="cbasis-status" data-conn>连接中…</span>
          </div>
          <div class="cbasis-stats">
            <span>匹配对 <b data-stat-pairs>—</b></span>
            <span>升水 <b class="cb-up" data-stat-pos>—</b></span>
            <span>贴水 <b class="cb-down" data-stat-neg>—</b></span>
            <span>平均基差 <b data-stat-avg>—</b></span>
          </div>
          <table class="data-table cbasis-table">
            <thead><tr><th>币种</th><th>现货价</th><th>标记价</th><th>基差%</th><th>费率(8h)</th><th>年化</th></tr></thead>
            <tbody data-body><tr class="cbasis-empty"><td colspan="6">加载中…</td></tr></tbody>
          </table>
          <div class="cbasis-foot">
            <span>基差=(标记价-现货价)/现货价 · ★=费率与基差同向(套利双收益) · 年化=8h费率×3×365</span>
            <span data-updated></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const updatedEl = el.querySelector('[data-updated]');
      const statPairs = el.querySelector('[data-stat-pairs]');
      const statPos = el.querySelector('[data-stat-pos]');
      const statNeg = el.querySelector('[data-stat-neg]');
      const statAvg = el.querySelector('[data-stat-avg]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let hasData = false;
      const pendingTimers = new Set(); // 进行中 fetch 的超时定时器
      const pendingAborts = new Set(); // 进行中 fetch 的 AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'cbasis-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'cbasis-status live';
        setStatus('online');
      };

      const fetchJson = async (url) => {
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          return await resp.json();
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      // 配对：USDT 永续（剔除 '_' 交割合约）× 现货 USDT 对；剔除现货价偏离指数价 >1% 的异常对
      const buildRows = (spotArr, premArr) => {
        const spotMap = {};
        (Array.isArray(spotArr) ? spotArr : []).forEach((r) => {
          if (!r || typeof r.symbol !== 'string') return;
          const p = parseFloat(r.price);
          if (p > 0) spotMap[r.symbol] = p;
        });
        const rows = [];
        (Array.isArray(premArr) ? premArr : []).forEach((d) => {
          if (!d || typeof d.symbol !== 'string') return;
          const s = d.symbol;
          if (!s.endsWith('USDT') || s.indexOf('_') !== -1) return;
          const mark = parseFloat(d.markPrice);
          const idx = parseFloat(d.indexPrice);
          const spot = spotMap[s];
          if (!(mark > 0) || !(idx > 0) || !(spot > 0)) return;
          if (Math.abs(spot - idx) / idx > SPOT_INDEX_TOLERANCE) return;
          const fr = parseFloat(d.lastFundingRate);
          rows.push({
            symbol: s,
            coin: s.slice(0, -4),
            spot,
            mark,
            basisPct: ((mark - spot) / spot) * 100,
            fund8hPct: (Number.isFinite(fr) ? fr : 0) * 100,
          });
        });
        rows.sort((a, b) => Math.abs(b.basisPct) - Math.abs(a.basisPct));
        return rows;
      };

      const render = (rows) => {
        // 统计覆盖全部匹配对，榜单仅取 |基差| TOP_N
        let pos = 0;
        let neg = 0;
        let sum = 0;
        rows.forEach((r) => {
          if (r.basisPct > 0) pos += 1;
          else if (r.basisPct < 0) neg += 1;
          sum += r.basisPct;
        });
        statPairs.textContent = String(rows.length);
        statPos.textContent = String(pos);
        statNeg.textContent = String(neg);
        statAvg.textContent = rows.length ? `${fmtSigned(sum / rows.length, 3)}%` : '—';

        const top = rows.slice(0, TOP_N);
        if (!top.length) {
          body.innerHTML = `<tr class="cbasis-empty"><td colspan="6">暂无数据</td></tr>`;
        } else {
          body.innerHTML = top
            .map((r) => {
              const isNegOpp = r.basisPct <= DEEP_NEG_PCT;
              const isPosOpp = r.basisPct >= HIGH_POS_PCT;
              const aligned =
                (isNegOpp || isPosOpp) && r.fund8hPct !== 0 && Math.sign(r.fund8hPct) === Math.sign(r.basisPct);
              const badge =
                isNegOpp || isPosOpp
                  ? `<b class="cbasis-badge ${isNegOpp ? 'neg' : 'pos'}" title="${esc(
                      aligned
                        ? '资金费率与基差同向：期现套利可同时吃基差收敛 + 资金费'
                        : isNegOpp
                          ? '深度贴水：永续低于现货，可反向期现套利'
                          : '高升水：永续高于现货，可正向期现套利'
                    )}">${isNegOpp ? '贴水' : '升水'}${aligned ? '★' : ''}</b>`
                  : '';
              const rowCls = isNegOpp ? ' class="cbasis-opp-neg"' : isPosOpp ? ' class="cbasis-opp-pos"' : '';
              return `
            <tr${rowCls}>
              <td class="cbasis-coin">${esc(r.coin)}<i>/USDT</i>${badge}</td>
              <td class="cbasis-num">${esc(fmtPrice(r.spot))}</td>
              <td class="cbasis-num">${esc(fmtPrice(r.mark))}</td>
              <td class="cbasis-num ${dirClass(r.basisPct)}">${esc(fmtSigned(r.basisPct, 3))}%</td>
              <td class="cbasis-num ${dirClass(r.fund8hPct)}">${esc(fmtSigned(r.fund8hPct, 4))}%</td>
              <td class="cbasis-num ${dirClass(r.fund8hPct)}">${esc(fmtAnn(r.fund8hPct * 3 * 365))}</td>
            </tr>`;
            })
            .join('');
        }
        updatedEl.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const [spotArr, premArr] = await Promise.all([fetchJson(SPOT_URL), fetchJson(PREM_URL)]);
          if (!alive) return;
          const rows = buildRows(spotArr, premArr);
          if (!rows.length) throw new Error('empty');
          hasData = true;
          clearError();
          render(rows);
        } catch (e) {
          if (!alive) return;
          showError(e && e.name === 'AbortError' ? '请求超时，30 秒后自动重试…' : '行情加载失败，30 秒后自动重试…');
          if (!hasData) body.innerHTML = `<tr class="cbasis-empty"><td colspan="6">加载失败，等待自动重试…</td></tr>`;
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return;
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
          try {
            c.abort();
          } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
      };
    },
  };
})();
