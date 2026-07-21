/* 币圈波动率与期权 — Deribit DVOL 指数 + 期权 Max Pain(CORS JSON)
 * DVOL: https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=...&end_timestamp=...&resolution=3600
 *   字段: result.data = [[ts_ms, open, high, low, close], ...]，close 即 DVOL 当前值（年化波动率 %）。
 * 期权: https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option
 *   全量返回（BTC 约 390KB / 872 条，ETH 约 320KB / 718 条），仅聚合最近 2 个到期日；
 *   instrument_name 形如 BTC-17JUL26-60000-C，open_interest 单位为币（1 张 = 1 币），
 *   名义价值 ≈ Σ open_interest × estimated_delivery_price；Max Pain 按行权价遍历买方总赔付最小值自算。
 * 降级: DVOL 接口失败时用币安 klines 自算 30 日已实现波动率 HV 兜底
 *   https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=720
 *   （小时收盘对数收益标准差 × sqrt(365×24)，卡片角标显示 HV 30D）。
 * 已用 curl 实测 2026-07：以上接口 GET 均 200；Deribit 带 Origin 请求时回 Access-Control-Allow-Origin
 *   （回显 Origin，无 Origin 的缓存响应可能缺该头，浏览器跨域正常）；币安回 Access-Control-Allow-Origin: *。
 * 币圈绿涨红跌：方向着色用 var(--up)=涨 / var(--down)=跌。加密市场 24/7，固定 5 分钟刷新。
 * Registers as custom tool id 'cryptodvol' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const CURS = ['BTC', 'ETH'];
  const DVOL_URL = (cur, start, end) =>
    `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`;
  const OPTS_URL = (cur) =>
    `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${cur}&kind=option`;
  const KLINE_URL = (cur) => `https://api.binance.com/api/v3/klines?symbol=${cur}USDT&interval=1h&limit=720`;

  const REFRESH_MS = 5 * 60 * 1000; // 固定 5 分钟刷新
  const FETCH_TIMEOUT_MS = 10000;
  const EXPIRY_COUNT = 2; // 每币种聚合最近 2 个到期日
  const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

  function injectStyle() {
    if (document.getElementById('cdvol-style')) return;
    const style = document.createElement('style');
    style.id = 'cdvol-style';
    style.textContent = `
.cdvol-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.cdvol-status { color: var(--warning); white-space: nowrap; }
.cdvol-status.live { color: var(--acc); }
.cdvol-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
.cdvol-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.cdvol-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.cdvol-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.cdvol-badge {
  font-size: 9px;
  color: var(--text-dim);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 1px 7px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.cdvol-badge.hv { color: var(--warning); border-color: var(--warning); }
.cdvol-value {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cdvol-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.cdvol-hl {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}
.cdvol-hl b {
  font-weight: 400;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.cdvol-up { color: var(--up); }
.cdvol-down { color: var(--down); }
.cdvol-flat { color: var(--text-muted); }
.cdvol-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
}
.cdvol-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.cdvol-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.cdvol-table { width: 100%; font-variant-numeric: tabular-nums; }
.cdvol-table th, .cdvol-table td { white-space: nowrap; }
.cdvol-table th:not(:first-child), .cdvol-table td:not(:first-child) { text-align: right; }
.cdvol-cur { font-weight: 600; }
.cdvol-cur i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.cdvol-num { font-family: var(--font-mono); }
.cdvol-pain { font-family: var(--font-mono); font-weight: 700; color: var(--warning); }
.cdvol-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cdvol-foot {
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

  // 美元名义价值 → $X.XXB / $XXX.XM
  const fmtUsd = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e9) return `$${fmtNum(v / 1e9, 2)}B`;
    if (Math.abs(v) >= 1e6) return `$${fmtNum(v / 1e6, 1)}M`;
    return `$${fmtNum(v / 1e3, 0)}K`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'cdvol-flat';
    return v > 0 ? 'cdvol-up' : 'cdvol-down';
  };

  // '17JUL26' → Date（UTC，到期日 08:00 结算，此处按 00:00 粗算 DTE 足够）
  const parseExpiry = (exp) => {
    const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(exp);
    if (!m || MONTHS[m[2]] == null) return null;
    return new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1])));
  };

  const parseInstrument = (name) => {
    const p = String(name || '').split('-');
    if (p.length !== 4) return null;
    const strike = Number(p[2]);
    const type = p[3];
    if (!Number.isFinite(strike) || (type !== 'C' && type !== 'P')) return null;
    return { exp: p[1], strike, type };
  };

  // Max Pain：遍历行权价，使期权买方（call+put）总赔付最小的价格
  const calcMaxPain = (rows) => {
    const strikes = Array.from(new Set(rows.map((r) => r.strike))).sort((a, b) => a - b);
    let best = NaN;
    let bestPain = Infinity;
    for (let i = 0; i < strikes.length; i += 1) {
      const k = strikes[i];
      let pain = 0;
      for (let j = 0; j < rows.length; j += 1) {
        const r = rows[j];
        pain += r.type === 'C' ? r.oi * Math.max(0, k - r.strike) : r.oi * Math.max(0, r.strike - k);
      }
      if (pain < bestPain) {
        bestPain = pain;
        best = k;
      }
    }
    return best;
  };

  // 已实现波动率（年化 %）：小时收盘对数收益样本标准差 × sqrt(365×24)
  const annualizedHv = (closes) => {
    const rets = [];
    for (let i = 1; i < closes.length; i += 1) {
      if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
    }
    if (rets.length < 2) return NaN;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varSum = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
    return Math.sqrt(varSum) * Math.sqrt(365 * 24) * 100;
  };

  window.GT_EXTRA_TOOLS['cryptodvol'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cdvol-root">
          <div class="cdvol-head">
            <span>CRYPTO_VOL · 期权波动率</span>
            <span class="cdvol-status" data-conn>连接中…</span>
          </div>
          <div class="cdvol-grid">
            ${CURS.map(
              (cur) => `
              <div class="cdvol-card" data-cur="${esc(cur)}">
                <div class="cdvol-card-top">
                  <span class="cdvol-name">${esc(cur)} DVOL</span>
                  <span class="cdvol-badge" data-badge>DVOL</span>
                </div>
                <div class="cdvol-value cdvol-flat" data-value>—</div>
                <div class="cdvol-chg"><span data-chg class="cdvol-flat">—</span><span data-pct class="cdvol-flat">—</span></div>
                <div class="cdvol-hl"><span>24H 高 <b data-high>—</b></span><span>24H 低 <b data-low>—</b></span></div>
              </div>`
            ).join('')}
          </div>
          <div class="cdvol-board">
            <div class="cdvol-board-title"><span>期权 MAX PAIN · 未平仓名义价值</span><i data-opt-note></i></div>
            <table class="data-table cdvol-table">
              <thead><tr><th>币种</th><th>到期</th><th>现价</th><th>MAX PAIN</th><th>偏离</th><th>OI 名义</th></tr></thead>
              <tbody data-opt-body>
                <tr class="cdvol-empty"><td colspan="6">加载中…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="cdvol-foot">
            <span>数据来源 Deribit（降级 Binance HV）· 每 5 分钟刷新</span>
            <span data-updated>—</span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const optBody = el.querySelector('[data-opt-body]');
      const optNote = el.querySelector('[data-opt-note]');
      const updatedEl = el.querySelector('[data-updated]');
      const hint = el.querySelector('[data-hint]');
      const cards = {};
      el.querySelectorAll('.cdvol-card').forEach((card) => {
        cards[card.getAttribute('data-cur')] = {
          badge: card.querySelector('[data-badge]'),
          value: card.querySelector('[data-value]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
          high: card.querySelector('[data-high]'),
          low: card.querySelector('[data-low]'),
        };
      });

      let alive = true;
      let refreshTimer = null;
      let refreshInFlight = false;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const setConn = (ok, errs) => {
        if (ok) {
          conn.textContent = '● LIVE';
          conn.className = 'cdvol-status live';
          setStatus('online');
        } else {
          conn.textContent = '连接失败';
          conn.className = 'cdvol-status';
          setStatus('offline');
        }
        if (errs.length) {
          hint.textContent = `${errs.join('；')}，5 分钟后自动重试…`;
          hint.style.display = '';
        } else {
          hint.style.display = 'none';
        }
      };

      // 统一 fetch JSON：AbortController 10s 超时，句柄纳入 cleanup
      const fetchJSON = async (url) => {
        if (!alive) throw new Error('disposed');
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

      /* ---- DVOL（Deribit），失败降级币安 HV ---- */
      const parseDvol = (json) => {
        const data = json && json.result && Array.isArray(json.result.data) ? json.result.data : [];
        if (!data.length) throw new Error('empty');
        const last = data[data.length - 1];
        const cur = Number(last[4]);
        if (!Number.isFinite(cur)) throw new Error('empty');
        const target = Number(last[0]) - 24 * 3600 * 1000;
        let prev = data[0];
        for (let i = data.length - 2; i >= 0; i -= 1) {
          if (Number(data[i][0]) <= target) {
            prev = data[i];
            break;
          }
        }
        // 近 24h 高/低（含当前点）
        let high = -Infinity;
        let low = Infinity;
        for (let i = data.length - 1; i >= 0; i -= 1) {
          if (Number(data[i][0]) < target) break;
          high = Math.max(high, Number(data[i][2]));
          low = Math.min(low, Number(data[i][3]));
        }
        const chg = cur - Number(prev[4]);
        return { value: cur, chg, pct: (chg / Number(prev[4])) * 100, high, low, hv: false };
      };

      const fetchVol = async (cur) => {
        const end = Date.now();
        try {
          const json = await fetchJSON(DVOL_URL(cur, end - 48 * 3600 * 1000, end));
          return parseDvol(json);
        } catch (e) {
          if (!alive) throw e;
          // 降级：币安小时 klines 自算 30 日已实现波动率（24h 变化用平移 24h 窗口对比）
          const klines = await fetchJSON(KLINE_URL(cur));
          if (!Array.isArray(klines) || klines.length < 48) throw new Error('hv empty');
          const closes = klines.map((k) => Number(k[4]));
          const value = annualizedHv(closes.slice(-721));
          const prev = annualizedHv(closes.slice(0, -24));
          const win = closes.slice(-25);
          if (!Number.isFinite(value)) throw new Error('hv empty');
          return {
            value,
            chg: Number.isFinite(prev) ? value - prev : NaN,
            pct: Number.isFinite(prev) && prev !== 0 ? ((value - prev) / prev) * 100 : NaN,
            high: Math.max.apply(null, win),
            low: Math.min.apply(null, win),
            hv: true,
          };
        }
      };

      const renderVol = (cur, d) => {
        const c = cards[cur];
        if (!c) return;
        const cls = dirClass(d.chg);
        c.badge.textContent = d.hv ? 'HV 30D' : 'DVOL';
        c.badge.className = `cdvol-badge${d.hv ? ' hv' : ''}`;
        c.value.textContent = fmtNum(d.value, 1);
        c.value.className = `cdvol-value ${cls}`;
        c.chg.textContent = fmtSigned(d.chg, 2);
        c.chg.className = cls;
        c.pct.textContent = Number.isFinite(d.pct) ? `${fmtSigned(d.pct, 2)}%` : '—';
        c.pct.className = cls;
        c.high.textContent = fmtNum(d.high, 1);
        c.low.textContent = fmtNum(d.low, 1);
      };

      const renderVolError = (cur) => {
        const c = cards[cur];
        if (!c) return;
        c.badge.textContent = '—';
        c.badge.className = 'cdvol-badge';
        c.value.textContent = '—';
        c.value.className = 'cdvol-value cdvol-flat';
        c.chg.textContent = '—';
        c.chg.className = 'cdvol-flat';
        c.pct.textContent = '—';
        c.pct.className = 'cdvol-flat';
        c.high.textContent = '—';
        c.low.textContent = '—';
      };

      /* ---- 期权 Max Pain（Deribit book summary，聚合最近 2 个到期日） ---- */
      const fetchPain = async (cur) => {
        const json = await fetchJSON(OPTS_URL(cur));
        const list = json && Array.isArray(json.result) ? json.result : [];
        if (!list.length) throw new Error('empty');
        const byExp = new Map(); // expKey -> { date, rows: [{strike,type,oi}], spot }
        list.forEach((it) => {
          const meta = parseInstrument(it.instrument_name);
          const oi = Number(it.open_interest);
          if (!meta || !Number.isFinite(oi) || oi <= 0) return;
          let bucket = byExp.get(meta.exp);
          if (!bucket) {
            const date = parseExpiry(meta.exp);
            if (!date) return;
            bucket = { date, rows: [], spot: NaN };
            byExp.set(meta.exp, bucket);
          }
          bucket.rows.push({ strike: meta.strike, type: meta.type, oi });
          const spot = Number(it.estimated_delivery_price) || Number(it.underlying_price);
          if (Number.isFinite(spot)) bucket.spot = spot;
        });
        const exps = Array.from(byExp.values()).sort((a, b) => a.date - b.date).slice(0, EXPIRY_COUNT);
        if (!exps.length) throw new Error('empty');
        return exps.map((bucket) => {
          const maxPain = calcMaxPain(bucket.rows);
          const notional = bucket.rows.reduce((a, r) => a + r.oi, 0) * bucket.spot;
          const dte = Math.max(0, Math.round((bucket.date.getTime() - Date.now()) / 86400000));
          return {
            cur,
            exp: bucket.date,
            dte,
            spot: bucket.spot,
            maxPain,
            dev: Number.isFinite(maxPain) && maxPain !== 0 ? ((bucket.spot - maxPain) / maxPain) * 100 : NaN,
            notional,
          };
        });
      };

      const renderPain = (rows) => {
        optNote.textContent = '最近 2 个到期日 · Deribit';
        optBody.innerHTML = rows
          .map((r) => {
            const expStr = `${String(r.exp.getUTCMonth() + 1).padStart(2, '0')}-${String(r.exp.getUTCDate()).padStart(2, '0')}`;
            const devCls = dirClass(r.dev);
            return `
            <tr>
              <td class="cdvol-cur">${esc(r.cur)}<i>${r.dte}D</i></td>
              <td class="cdvol-num">${esc(expStr)}</td>
              <td class="cdvol-num">${esc(fmtNum(r.spot, 0))}</td>
              <td class="cdvol-pain">${esc(fmtNum(r.maxPain, 0))}</td>
              <td class="cdvol-num ${devCls}">${Number.isFinite(r.dev) ? esc(fmtSigned(r.dev, 2)) + '%' : '—'}</td>
              <td class="cdvol-num">${esc(fmtUsd(r.notional))}</td>
            </tr>`;
          })
          .join('');
      };

      const renderPainError = () => {
        optNote.textContent = '';
        optBody.innerHTML = `<tr class="cdvol-empty"><td colspan="6">期权数据加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight || document.hidden) return;
        refreshInFlight = true;
        try {
          const jobs = CURS.map((cur) => fetchVol(cur)).concat(CURS.map((cur) => fetchPain(cur)));
          const res = await Promise.allSettled(jobs);
          if (!alive) return;
          const errs = [];
          let anyOk = false;
          CURS.forEach((cur, i) => {
            if (res[i].status === 'fulfilled') {
              renderVol(cur, res[i].value);
              anyOk = true;
            } else {
              renderVolError(cur);
              errs.push(`${cur} 波动率加载失败`);
            }
          });
          const painRows = [];
          CURS.forEach((cur, i) => {
            const r = res[CURS.length + i];
            if (r.status === 'fulfilled') {
              painRows.push(...r.value);
              anyOk = true;
            } else {
              errs.push(`${cur} 期权加载失败`);
            }
          });
          if (painRows.length) renderPain(painRows);
          else renderPainError();
          setConn(anyOk, errs);
          if (anyOk) {
            updatedEl.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
          }
        } finally {
          refreshInFlight = false;
        }
      };

      refresh();
      refreshTimer = setInterval(refresh, REFRESH_MS);

      return () => {
        alive = false;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
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
