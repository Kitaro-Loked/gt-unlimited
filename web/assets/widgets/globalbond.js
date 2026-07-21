/* 全球债市与恐慌指数 — 东财全球国债收益率/美元指数(CORS JSON) + TradingView VIX(CORS JSON)
 * 接口1: https://push2.eastmoney.com/api/qt/ulist.np/get （失败回退 push2delay.eastmoney.com 延时行情，
 *        双 host 模式照抄 ashareboard.js/globalidx.js；响应头 Access-Control-Allow-Origin: *）
 *        字段: f12=代码 f13=市场 f14=名称 f2=最新价(收益率%/指数点) f3=涨跌幅% f4=涨跌额(点)
 *        secid（经东财 suggest API 定位并实测 2026-07-16）:
 *          171.US10Y 美国10年期国债收益率 / 171.US2Y 美国2年期国债收益率
 *          171.DE10Y 德国10年期国债 / 171.JP10Y 日本10年期国债 / 171.CN10Y 中国10年期国债
 *          100.UDI  美元指数(DXY)
 * 接口2: https://scanner.tradingview.com/symbol?symbol=CBOE:VIX&fields=close,change,change_abs
 *        （GET 单标的，响应反射 Origin 头，Access-Control-Allow-Origin 实测可用 2026-07-16；
 *          VIX 为延时行情；close=现价 change=涨跌幅% change_abs=涨跌额）
 * 弃用接口实测记录（2026-07-16，均 curl 验证）:
 *   - stooq.com /q/l/ 全部 404（含 aapl.us，疑似封禁本机 IP 段）
 *   - 腾讯 qt.gtimg.cn q=usVIX 数据停留在 2026-02-06，已停更
 *   - 东财无 VIX 指数 secid（market 100 共 63 个指数不含 VIX；100.VIX 请求被静默剔除）
 *   - Yahoo query1.finance.yahoo.com 持续 429；CBOE cdn.cboe.com 无 CORS 头且响应 700KB+
 *   - push2.eastmoney.com 本机 curl 持续 502（浏览器端或可用，保留为主 host，push2delay 兜底）
 * 配色: DXY/VIX 绿涨红跌（国际习惯），gbond-up=var(--up) / gbond-down=var(--down)；
 *       国债收益率涨跌对风险资产含义相反，按中性色展示并加注（见页脚）。
 * Registers as custom tool id 'globalbond' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // kind: 'yield' = 国债收益率（中性展示，涨跌额换算 bp）；'index' = 指数（绿涨红跌，涨跌额按点）
  const EM_ITEMS = [
    { key: 'US10Y', secid: '171.US10Y', name: '美债10年', code: 'US10Y', kind: 'yield' },
    { key: 'US2Y', secid: '171.US2Y', name: '美债2年', code: 'US2Y', kind: 'yield' },
    { key: 'DE10Y', secid: '171.DE10Y', name: '德债10年', code: 'DE10Y', kind: 'yield' },
    { key: 'JP10Y', secid: '171.JP10Y', name: '日债10年', code: 'JP10Y', kind: 'yield' },
    { key: 'CN10Y', secid: '171.CN10Y', name: '中债10年', code: 'CN10Y', kind: 'yield' },
    { key: 'DXY', secid: '100.UDI', name: '美元指数', code: 'DXY', kind: 'index' },
  ];
  const VIX_DEF = { key: 'VIX', name: 'VIX恐慌', code: 'VIX', kind: 'index' };
  const ALL_ITEMS = EM_ITEMS.concat([VIX_DEF]);

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f4'; // 代码/市场/名称/最新价/涨跌幅%/涨跌额
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${EM_FIELDS}&secids=${EM_ITEMS.map((i) => i.secid).join(',')}`;
  const TV_URL = 'https://scanner.tradingview.com/symbol?symbol=CBOE%3AVIX&fields=close,change,change_abs';

  const REFRESH_MS = 60000; // 刷新间隔 60s
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 周末休市低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('gbond-style')) return;
    const style = document.createElement('style');
    style.id = 'gbond-style';
    style.textContent = `
.gbond-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.gbond-head-right { display: flex; align-items: center; gap: 8px; }
.gbond-badge {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.gbond-badge.warn { color: var(--warning); border-color: var(--warning); }
.gbond-status { color: var(--warning); white-space: nowrap; }
.gbond-status.live { color: var(--acc); }
/* 国际习惯绿涨红跌：--up=涨(松绿) --down=跌(陶土红) */
.gbond-up { color: var(--up); }
.gbond-down { color: var(--down); }
.gbond-flat { color: var(--text-muted); }
.gbond-spread {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  background: var(--surface-raised);
  flex-wrap: wrap;
}
.gbond-spread-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.gbond-spread-label i { display: block; font-style: normal; font-size: 9px; color: var(--text-dim); letter-spacing: 0; margin-top: 2px; }
.gbond-spread-main { display: flex; align-items: baseline; gap: 8px; }
.gbond-spread-value {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gbond-spread-chg {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gbond-spread-badge {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.gbond-spread-badge.inverted {
  color: var(--down);
  border-color: var(--down);
  background: color-mix(in srgb, var(--down) 10%, transparent);
}
.gbond-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 720px) {
  .gbond-grid { grid-template-columns: repeat(2, 1fr); }
}
.gbond-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.gbond-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.gbond-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gbond-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.gbond-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gbond-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.gbond-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.gbond-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
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

  // 涨跌额(点) → 基点(bp) 带符号字符串
  const fmtBp = (pts) => {
    if (!Number.isFinite(pts)) return '—';
    const bp = pts * 100;
    return `${bp > 0 ? '+' : ''}${fmtNum(bp, 1)}bp`;
  };

  const dirArrow = (v) => {
    if (!Number.isFinite(v) || v === 0) return '·';
    return v > 0 ? '▲' : '▼';
  };

  // 绿涨红跌（指数类）
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'gbond-flat';
    return v > 0 ? 'gbond-up' : 'gbond-down';
  };

  // 全球债市近 24h 交易，周末（UTC 周六/日）整体休市，降频刷新
  const isIdle = () => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  };

  window.GT_EXTRA_TOOLS['globalbond'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool gbond-root">
          <div class="gbond-head">
            <span>全球债市 · 恐慌指数</span>
            <span class="gbond-head-right">
              <span class="gbond-badge" data-weekend style="display:none">周末休市</span>
              <span class="gbond-badge warn" data-delayed style="display:none">延时行情</span>
              <span class="gbond-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="gbond-spread">
            <span class="gbond-spread-label">美债 10Y-2Y 利差<i>收益率曲线（负值=倒挂）</i></span>
            <span class="gbond-spread-main">
              <span class="gbond-spread-value" data-spread>—</span>
              <span class="gbond-spread-chg" data-spread-chg>—</span>
            </span>
            <span class="gbond-spread-badge" data-spread-badge style="display:none"></span>
          </div>
          <div class="gbond-grid">
            ${ALL_ITEMS.map(
              (it) => `
              <div class="gbond-card" data-key="${esc(it.key)}">
                <div class="gbond-card-top">
                  <span class="gbond-name">${esc(it.name)}</span>
                  <span class="gbond-code">${esc(it.code)}</span>
                </div>
                <div class="gbond-price gbond-flat" data-price>—</div>
                <div class="gbond-chg"><span data-chg class="gbond-flat">—</span><span data-pct class="gbond-flat">—</span></div>
              </div>`
            ).join('')}
          </div>
          <div class="gbond-foot">
            <span data-src>来源：东方财富（国债/美元）· TradingView（VIX 延时）</span>
            <span>收益率涨跌中性展示（上行通常利空风险资产）· 更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const weekendEl = el.querySelector('[data-weekend]');
      const delayedEl = el.querySelector('[data-delayed]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const spreadEl = el.querySelector('[data-spread]');
      const spreadChgEl = el.querySelector('[data-spread-chg]');
      const spreadBadgeEl = el.querySelector('[data-spread-badge]');
      const cards = {};
      el.querySelectorAll('.gbond-card').forEach((card) => {
        cards[card.getAttribute('data-key')] = {
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
        };
      });

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'gbond-status';
        setStatus('offline');
      };
      const showLive = (delayed, partialMsg) => {
        if (partialMsg) {
          hint.textContent = partialMsg;
          hint.style.display = '';
        } else {
          hint.style.display = 'none';
        }
        conn.textContent = '● LIVE';
        conn.className = 'gbond-status live';
        delayedEl.style.display = delayed ? '' : 'none';
        srcEl.textContent = delayed
          ? '来源：东方财富（延时行情）· TradingView（VIX 延时）'
          : '来源：东方财富（国债/美元）· TradingView（VIX 延时）';
        setStatus('online');
      };

      // 通用 CORS JSON fetch（10s 超时），双 host 依次尝试
      const fetchJson = async (urls) => {
        let lastErr = null;
        for (let i = 0; i < urls.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(urls[i], { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            return { json: await resp.json(), fallback: i > 0 };
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

      // 东财国债收益率 + 美元指数：push2 失败时回退 push2delay（延时行情）
      const fetchEm = async () => {
        const { json, fallback } = await fetchJson(EM_HOSTS.map(emUrl));
        const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
        if (!diff.length) throw new Error('empty');
        return { rows: diff, delayed: fallback };
      };

      // TradingView VIX（延时行情，单 host 无需回退）
      const fetchVix = async () => {
        const { json } = await fetchJson([TV_URL]);
        const close = Number(json && json.close);
        if (!Number.isFinite(close)) throw new Error('empty');
        return { price: close, pct: Number(json.change), chg: Number(json.change_abs) };
      };

      const renderEm = (result) => {
        const bySecid = {};
        result.rows.forEach((r) => {
          if (r && r.f12 != null && r.f13 != null) bySecid[`${r.f13}.${r.f12}`] = r;
        });
        EM_ITEMS.forEach((it) => {
          const r = bySecid[it.secid];
          const c = cards[it.key];
          if (!r || !c) return;
          const price = Number(r.f2);
          const pct = Number(r.f3);
          const chg = Number(r.f4);
          if (!Number.isFinite(price)) return;
          if (it.kind === 'yield') {
            // 收益率：中性展示，涨跌额换算 bp
            c.price.textContent = `${fmtNum(price, 3)}%`;
            c.price.className = 'gbond-price gbond-flat';
            c.chg.textContent = `${dirArrow(chg)} ${fmtBp(chg)}`;
            c.chg.className = 'gbond-flat';
            c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
            c.pct.className = 'gbond-flat';
          } else {
            const cls = dirClass(chg);
            c.price.textContent = fmtNum(price, 2);
            c.price.className = `gbond-price ${cls}`;
            c.chg.textContent = fmtSigned(chg, 2);
            c.chg.className = cls;
            c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
            c.pct.className = cls;
          }
        });
        // 10Y-2Y 利差（bp）：负值即倒挂
        const r10 = bySecid['171.US10Y'];
        const r2 = bySecid['171.US2Y'];
        const y10 = r10 && Number(r10.f2);
        const y2 = r2 && Number(r2.f2);
        if (Number.isFinite(y10) && Number.isFinite(y2)) {
          const spread = (y10 - y2) * 100; // bp
          const d10 = Number(r10.f4);
          const d2 = Number(r2.f4);
          const spreadChg = Number.isFinite(d10) && Number.isFinite(d2) ? (d10 - d2) * 100 : NaN;
          spreadEl.textContent = `${spread > 0 ? '+' : ''}${fmtNum(spread, 1)}bp`;
          spreadChgEl.textContent = Number.isFinite(spreadChg)
            ? `日内 ${dirArrow(spreadChg)} ${Math.abs(spreadChg).toFixed(1)}bp`
            : '—';
          if (spread < 0) {
            spreadBadgeEl.textContent = '⚠ 曲线倒挂';
            spreadBadgeEl.className = 'gbond-spread-badge inverted';
          } else {
            spreadBadgeEl.textContent = '曲线正常';
            spreadBadgeEl.className = 'gbond-spread-badge';
          }
          spreadBadgeEl.style.display = '';
        }
      };

      const renderVix = (v) => {
        const c = cards.VIX;
        if (!c) return;
        const cls = dirClass(v.chg);
        c.price.textContent = fmtNum(v.price, 2);
        c.price.className = `gbond-price ${cls}`;
        c.chg.textContent = fmtSigned(v.chg, 2);
        c.chg.className = cls;
        c.pct.textContent = Number.isFinite(v.pct) ? `${fmtSigned(v.pct, 2)}%` : '—';
        c.pct.className = cls;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [emRes, vixRes] = await Promise.allSettled([fetchEm(), fetchVix()]);
          if (!alive) return;
          if (emRes.status === 'rejected' && vixRes.status === 'rejected') {
            showError('行情加载失败，60 秒后自动重试…');
            return;
          }
          if (emRes.status === 'fulfilled') renderEm(emRes.value);
          if (vixRes.status === 'fulfilled') renderVix(vixRes.value);
          const partial =
            emRes.status === 'rejected'
              ? '东财债券行情加载失败，仅显示 VIX，60 秒后自动重试…'
              : vixRes.status === 'rejected'
                ? 'VIX 加载失败，其余数据正常，60 秒后自动重试…'
                : '';
          showLive(emRes.status === 'fulfilled' && emRes.value.delayed, partial);
          const now = new Date();
          timeEl.textContent = now.toTimeString().slice(0, 8);
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
        weekendEl.style.display = isIdle() ? '' : 'none';
        if (!isIdle() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
      weekendEl.style.display = isIdle() ? '' : 'none';
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
