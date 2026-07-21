/* 全球期货行情板 — 东财外盘期货行情(CORS JSON)
 * 接口: https://push2.eastmoney.com/api/qt/ulist.np/get （响应头 Access-Control-Allow-Origin 回显 Origin，
 *       失败时回退 push2delay.eastmoney.com 延时行情；secids 参数为 <市场>.<代码> 主连合约）
 * 市场: 101=COMEX 102=NYMEX 103=CBOT 108=NYBOT(ICE US) 112=ICE EU
 * 字段: f12=代码 f13=市场 f14=名称 f2=最新价 f3=涨跌幅% f4=涨跌额 f15=最高 f16=最低 f17=今开 f18=昨收
 * 实测（2026-07-16，curl 验证 HTTP 200 + CORS 头 + 非空数据）：
 *   - 上方 ulist 接口对全部 13 个 secid 返回有效行情（push2 在本服务器环境偶发 502，浏览器端通常可用，
 *     双 host 兜底逻辑保留）；东财 clist fs=m:101/102/103/108/112 亦验证有效（用于确认市场代码归属）。
 *   - stooq.com/q/l/ 期货 CSV（gc.f/si.f/cl.f/zw.f 等）当前全量返回 404（含 commodities.js 在用 URL），不可用。
 *   - TradingView scanner/symbol 对 COMEX:GC1! 等有 CORS 且可用，但对咖啡/可可（ICE/NYBOT:KC1!/CC1!）
 *     一律 404 symbol_not_exists。
 * 取舍：东财无美咖啡(KC)/可可(CC)品种，stooq 失效、TV scanner 不支持，故本板不含咖啡/可可，特此说明。
 * 注意：本组件绿涨红跌（国际习惯），方向着色 gfut-up=var(--up) / gfut-down=var(--down)。
 * Registers as custom tool id 'globalfut' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 品种（名称自定，避免 f14 的"当月连续"长名）；dec 为小数位；url 为东财详情页（200 实测）
  const GROUPS = [
    {
      name: '贵金属 METALS',
      items: [
        { secid: '101.GC00Y', code: 'GC00Y', name: 'COMEX黄金', sub: 'COMEX · USD/oz', dec: 1, url: 'https://quote.eastmoney.com/globalfuture/GC00Y.html' },
        { secid: '101.SI00Y', code: 'SI00Y', name: 'COMEX白银', sub: 'COMEX · USD/oz', dec: 3, url: 'https://quote.eastmoney.com/globalfuture/SI00Y.html' },
        { secid: '101.HG00Y', code: 'HG00Y', name: 'COMEX铜', sub: 'COMEX · USD/lb', dec: 3, url: 'https://quote.eastmoney.com/globalfuture/HG00Y.html' },
      ],
    },
    {
      name: '能源 ENERGY',
      items: [
        { secid: '102.CL00Y', code: 'CL00Y', name: 'WTI原油', sub: 'NYMEX · USD/bbl', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/CL00Y.html' },
        { secid: '112.B00Y', code: 'B00Y', name: '布伦特原油', sub: 'ICE EU · USD/bbl', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/B00Y.html' },
        { secid: '102.NG00Y', code: 'NG00Y', name: '天然气', sub: 'NYMEX · USD/MMBtu', dec: 3, url: 'https://quote.eastmoney.com/globalfuture/NG00Y.html' },
      ],
    },
    {
      name: '农产品 GRAINS',
      items: [
        { secid: '103.ZS00Y', code: 'ZS00Y', name: '美大豆', sub: 'CBOT · 美分/bu', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/ZS00Y.html' },
        { secid: '103.ZC00Y', code: 'ZC00Y', name: '美玉米', sub: 'CBOT · 美分/bu', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/ZC00Y.html' },
        { secid: '103.ZW00Y', code: 'ZW00Y', name: '美小麦', sub: 'CBOT · 美分/bu', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/ZW00Y.html' },
        { secid: '103.ZM00Y', code: 'ZM00Y', name: '美豆粕', sub: 'CBOT · USD/ton', dec: 1, url: 'https://quote.eastmoney.com/globalfuture/ZM00Y.html' },
        { secid: '103.ZL00Y', code: 'ZL00Y', name: '美豆油', sub: 'CBOT · 美分/lb', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/ZL00Y.html' },
      ],
    },
    {
      name: '软商品 SOFTS',
      items: [
        { secid: '108.SB00Y', code: 'SB00Y', name: '糖11号', sub: 'ICE US · 美分/lb', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/SB00Y.html' },
        { secid: '108.CT00Y', code: 'CT00Y', name: '美棉花', sub: 'ICE US · 美分/lb', dec: 2, url: 'https://quote.eastmoney.com/globalfuture/CT00Y.html' },
      ],
    },
  ];
  const ALL = GROUPS.reduce((acc, g) => acc.concat(g.items), []);

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f4,f15,f16'; // 代码/市场/名称/最新价/涨跌幅%/涨跌额/最高/最低
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${EM_FIELDS}&secids=${ALL.map((i) => i.secid).join(',')}`;

  const REFRESH_MS = 60000; // 刷新间隔 60s
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 周末休市低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('gfut-style')) return;
    const style = document.createElement('style');
    style.id = 'gfut-style';
    style.textContent = `
.gfut-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.gfut-status { color: var(--warning); white-space: nowrap; }
.gfut-status.live { color: var(--acc); }
.gfut-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.gfut-delayed {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--warning);
  color: var(--warning);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
/* 国际习惯绿涨红跌：--up=涨(松绿) --down=跌(陶土红) */
.gfut-up { color: var(--up); }
.gfut-down { color: var(--down); }
.gfut-flat { color: var(--text-muted); }
.gfut-group { margin-bottom: 8px; }
.gfut-group-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.gfut-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 720px) {
  .gfut-grid { grid-template-columns: repeat(2, 1fr); }
}
.gfut-card {
  display: block;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
  text-decoration: none;
  transition: border-color 0.2s var(--ease-fluid);
}
.gfut-card:hover { border-color: var(--acc-dim); }
.gfut-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 1px;
}
.gfut-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gfut-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.gfut-unit {
  font-size: 9px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.gfut-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gfut-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.gfut-range {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gfut-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
}
.gfut-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
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

  // 绿涨红跌
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'gfut-flat';
    return v > 0 ? 'gfut-up' : 'gfut-down';
  };

  // 全球期货 UTC 周六/日整体休市，降频刷新
  const isIdle = () => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  };

  window.GT_EXTRA_TOOLS['globalfut'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool gfut-root">
          <div class="gfut-head">
            <span>全球期货 · 行情板</span>
            <span class="gfut-status" data-conn>连接中…</span>
          </div>
          <div class="gfut-sub">
            <span>贵金属 / 能源 / 农产品 / 软商品 主连合约 · 绿涨红跌 · 60s 自动刷新</span>
            <span class="gfut-delayed" data-delayed style="display:none">延时行情</span>
          </div>
          ${GROUPS.map(
            (g, gi) => `
            <div class="gfut-group">
              <div class="gfut-group-title">${esc(g.name)}</div>
              <div class="gfut-grid">
                ${g.items
                  .map(
                    (it) => `
                  <a class="gfut-card" href="${esc(it.url)}" target="_blank" rel="noopener" data-group="${gi}" data-secid="${esc(it.secid)}">
                    <div class="gfut-card-top">
                      <span class="gfut-name">${esc(it.name)}</span>
                      <span class="gfut-code">${esc(it.code)}</span>
                    </div>
                    <div class="gfut-unit">${esc(it.sub)}</div>
                    <div class="gfut-price gfut-flat" data-price>—</div>
                    <div class="gfut-chg"><span data-chg class="gfut-flat">—</span><span data-pct class="gfut-flat">—</span></div>
                    <div class="gfut-range"><span>高 <b data-high>—</b></span><span>低 <b data-low>—</b></span></div>
                  </a>`
                  )
                  .join('')}
              </div>
            </div>`
          ).join('')}
          <div class="gfut-foot">
            <span data-src>来源：东方财富</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const delayedEl = el.querySelector('[data-delayed]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const cards = {};
      el.querySelectorAll('.gfut-card').forEach((card) => {
        cards[card.getAttribute('data-secid')] = {
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
          high: card.querySelector('[data-high]'),
          low: card.querySelector('[data-low]'),
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
        conn.className = 'gfut-status';
        setStatus('offline');
      };
      const clearError = (delayed) => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'gfut-status live';
        delayedEl.style.display = delayed ? '' : 'none';
        srcEl.textContent = delayed ? '来源：东方财富（延时行情）' : '来源：东方财富';
        setStatus('online');
      };

      // 东财外盘期货：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchQuotes = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i]), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('quotes error');
      };

      const render = (result) => {
        const bySecid = {};
        result.rows.forEach((r) => {
          if (r && r.f12 != null && r.f13 != null) bySecid[`${r.f13}.${r.f12}`] = r;
        });
        ALL.forEach((it) => {
          const r = bySecid[it.secid];
          const c = cards[it.secid];
          if (!r || !c) return;
          const price = Number(r.f2);
          const pct = Number(r.f3);
          const chg = Number(r.f4);
          const high = Number(r.f15);
          const low = Number(r.f16);
          const cls = dirClass(chg);
          c.price.textContent = fmtNum(price, it.dec);
          c.price.className = `gfut-price ${cls}`;
          c.chg.textContent = fmtSigned(chg, it.dec);
          c.chg.className = cls;
          c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
          c.pct.className = cls;
          c.high.textContent = fmtNum(high, it.dec);
          c.low.textContent = fmtNum(low, it.dec);
        });
        const now = new Date();
        timeEl.textContent = now.toTimeString().slice(0, 8);
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const result = await fetchQuotes();
          if (!alive) return;
          render(result);
          clearError(result.delayed);
        } catch (e) {
          if (!alive) return;
          showError('行情加载失败，60 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return; // 页面不可见时跳过刷新
        if (!isIdle() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
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
