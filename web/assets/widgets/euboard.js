/* 欧股行情板 — 东财欧洲指数+明星个股行情(CORS JSON)
 * 接口: https://push2.eastmoney.com/api/qt/ulist.np/get （响应头 Access-Control-Allow-Origin: *，
 *       失败时回退 push2delay.eastmoney.com 延时行情；2026-07-16 实测本机 push2 持续 502、push2delay 正常，
 *       与 hkboard.js 记录一致；全部 22 个 secid 单次请求 rc:0 返回完整数据）
 * 字段: f12=代码 f13=市场 f14=名称 f2=最新价 f3=涨跌幅% f4=涨跌额
 * 市场: 100=全球指数 155=伦交所(英股，价格为便士 GBX，展示时 /100 换算英镑)
 *       105/106=美股纳斯达克/纽交所 153=美股OTC粉单（欧陆公司以 ADR 覆盖，价格为美元）
 * 注意: 东财未覆盖欧陆本地上市（XETRA/Euronext/SIX），欧陆个股用美股 ADR 替代（名称标注 ADR）；
 *       伦交所国际线（如 155.0M42 ASML）实测数据停滞/缺失，未采用；stooq /q/l/ 接口 2026-07-16 实测 404，未采用；
 *       Yahoo chart 接口实测 429 限流，未采用。
 * 配色: 国际习惯绿涨红跌，方向着色 eubd-up=var(--up) / eubd-down=var(--down)。
 * Registers as custom tool id 'euboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 指数为辅（FTSE/GDAXI/FCHI 与 globalidx 重叠，此处补齐 SX5E/SSMI/AEX/IBEX）
  const INDICES = [
    { secid: '100.FTSE', code: 'FTSE', name: '英国富时100' },
    { secid: '100.GDAXI', code: 'GDAXI', name: '德国DAX30' },
    { secid: '100.FCHI', code: 'FCHI', name: '法国CAC40' },
    { secid: '100.SX5E', code: 'SX5E', name: '欧洲斯托克50' },
    { secid: '100.SSMI', code: 'SSMI', name: '瑞士SMI' },
    { secid: '100.AEX', code: 'AEX', name: '荷兰AEX' },
    { secid: '100.IBEX', code: 'IBEX', name: '西班牙IBEX35' },
  ];

  // 个股为主，按地区分组；uk=true 表示伦交所便士报价（展示换算英镑），其余为美股 ADR 美元报价
  const STOCK_GROUPS = [
    {
      name: '英国 · 伦交所(£)',
      items: [
        { secid: '155.SHEL', code: 'SHEL', name: '壳牌', uk: true },
        { secid: '155.AZN', code: 'AZN', name: '阿斯利康', uk: true },
        { secid: '155.HSBA', code: 'HSBA', name: '汇丰控股', uk: true },
        { secid: '155.ULVR', code: 'ULVR', name: '联合利华', uk: true },
        { secid: '155.GSK', code: 'GSK', name: '葛兰素史克', uk: true },
        { secid: '155.DGE', code: 'DGE', name: '帝亚吉欧', uk: true },
      ],
    },
    {
      name: '德国 · 美股ADR($)',
      items: [
        { secid: '106.SAP', code: 'SAP', name: '思爱普' },
        { secid: '153.MBGYY', code: 'MBGYY', name: '梅赛德斯-奔驰' },
        { secid: '153.ADDYY', code: 'ADDYY', name: '阿迪达斯' },
      ],
    },
    {
      name: '法国 · 美股ADR($)',
      items: [
        { secid: '153.LVMUY', code: 'LVMUY', name: '路易威登集团' },
        { secid: '106.TTE', code: 'TTE', name: '道达尔能源' },
        { secid: '105.SNY', code: 'SNY', name: '赛诺菲' },
      ],
    },
    {
      name: '荷兰/瑞士 · 美股ADR($)',
      items: [
        { secid: '105.ASML', code: 'ASML', name: '阿斯麦' },
        { secid: '106.NVS', code: 'NVS', name: '诺华制药' },
        { secid: '153.NSRGY', code: 'NSRGY', name: '雀巢' },
      ],
    },
  ];
  const ALL = INDICES.concat(STOCK_GROUPS.reduce((acc, g) => acc.concat(g.items), []));

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f4'; // 代码/市场/名称/最新价/涨跌幅%/涨跌额
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${EM_FIELDS}&secids=${ALL.map((i) => i.secid).join(',')}`;
  const quoteUrl = (secid) => `https://quote.eastmoney.com/unify/r/${encodeURIComponent(secid)}`; // 东财统一详情页（实测 200）

  const REFRESH_MS = 30000; // 交易时段刷新 30s
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市降频 5 分钟
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('eubd-style')) return;
    const style = document.createElement('style');
    style.id = 'eubd-style';
    style.textContent = `
.eubd-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.eubd-head-right { display: flex; align-items: center; gap: 8px; }
.eubd-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.eubd-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.eubd-status { color: var(--warning); white-space: nowrap; }
.eubd-status.live { color: var(--acc); }
.eubd-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.eubd-delayed {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--warning);
  color: var(--warning);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
/* 国际习惯绿涨红跌：--up=涨(松绿) --down=跌(陶土红)（crypto 组件中 --acc=品牌黄铜，语义依上下文而定） */
.eubd-up { color: var(--up); }
.eubd-down { color: var(--down); }
.eubd-flat { color: var(--text-muted); }
.eubd-sec-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin: 8px 0 6px;
}
.eubd-idx-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 6px;
}
.eubd-idx {
  display: block;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  min-width: 0;
  background: var(--surface-raised);
  text-decoration: none;
  transition: border-color 0.2s var(--ease-fluid);
}
.eubd-idx:hover { border-color: var(--acc-dim); }
.eubd-idx-name {
  display: block;
  font-size: 10px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.eubd-idx-price {
  display: block;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.eubd-idx-pct {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.eubd-groups {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
@media (max-width: 720px) {
  .eubd-groups { grid-template-columns: 1fr; }
}
.eubd-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 4px 2px;
  border-bottom: 1px dashed var(--hairline);
  text-decoration: none;
  transition: background 0.2s var(--ease-fluid);
}
.eubd-row:hover { background: var(--surface-raised); }
.eubd-row:last-child { border-bottom: none; }
.eubd-stock {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.eubd-stock i {
  font-style: normal;
  color: var(--text-dim);
  font-weight: 400;
  font-size: 9px;
  font-family: var(--font-mono);
  margin-left: 4px;
}
.eubd-price, .eubd-pct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.eubd-pct { min-width: 58px; text-align: right; }
.eubd-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 8px;
}
.eubd-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
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
    if (!Number.isFinite(v) || v === 0) return 'eubd-flat';
    return v > 0 ? 'eubd-up' : 'eubd-down';
  };

  // 伦敦时间（Europe/London，自动处理夏令时）交易时段：周一至五 08:00-16:30（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    let lon;
    try {
      lon = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    } catch (e) {
      lon = new Date(); // 极端环境回退本地时区
    }
    const day = lon.getDay();
    const mins = lon.getHours() * 60 + lon.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if (mins >= 480 && mins < 990) return 'trading';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['euboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool eubd-root">
          <div class="eubd-head">
            <span>欧股 · 行情板</span>
            <span class="eubd-head-right">
              <span class="eubd-session" data-session>—</span>
              <span class="eubd-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="eubd-sub">
            <span>欧洲主要指数 + 明星个股 · 绿涨红跌 · 交易时段 30s 刷新</span>
            <span class="eubd-delayed" data-delayed style="display:none">延时行情</span>
          </div>
          <div class="eubd-sec-title">主要指数</div>
          <div class="eubd-idx-grid">
            ${INDICES.map(
              (idx) => `
              <a class="eubd-idx" href="${esc(quoteUrl(idx.secid))}" target="_blank" rel="noopener" data-secid="${esc(idx.secid)}">
                <span class="eubd-idx-name">${esc(idx.name)}</span>
                <span class="eubd-idx-price eubd-flat" data-price>—</span>
                <span class="eubd-idx-pct eubd-flat" data-pct>—</span>
              </a>`
            ).join('')}
          </div>
          <div class="eubd-groups">
            ${STOCK_GROUPS.map(
              (g) => `
              <div class="eubd-group">
                <div class="eubd-sec-title">${esc(g.name)}</div>
                ${g.items
                  .map(
                    (s) => `
                  <a class="eubd-row" href="${esc(quoteUrl(s.secid))}" target="_blank" rel="noopener" data-secid="${esc(s.secid)}">
                    <span class="eubd-stock">${esc(s.name)}<i>${esc(s.code)}</i></span>
                    <span class="eubd-price eubd-flat" data-price>—</span>
                    <span class="eubd-pct eubd-flat" data-pct>—</span>
                  </a>`
                  )
                  .join('')}
              </div>`
            ).join('')}
          </div>
          <div class="eubd-foot">
            <span data-src>来源：东方财富</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const delayedEl = el.querySelector('[data-delayed]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const idxCards = {};
      el.querySelectorAll('.eubd-idx').forEach((card) => {
        idxCards[card.getAttribute('data-secid')] = {
          price: card.querySelector('[data-price]'),
          pct: card.querySelector('[data-pct]'),
        };
      });
      const stockRows = {};
      el.querySelectorAll('.eubd-row').forEach((row) => {
        stockRows[row.getAttribute('data-secid')] = {
          price: row.querySelector('[data-price]'),
          pct: row.querySelector('[data-pct]'),
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
        conn.className = 'eubd-status';
        setStatus('offline');
      };
      const clearError = (delayed) => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'eubd-status live';
        delayedEl.style.display = delayed ? '' : 'none';
        srcEl.textContent = delayed ? '来源：东方财富（延时行情）' : '来源：东方财富';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'eubd-session open';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'eubd-session';
        }
        return s;
      };

      // 东财行情：CORS fetch，push2 失败时回退 push2delay（延时行情）
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
        INDICES.forEach((idx) => {
          const r = bySecid[idx.secid];
          const c = idxCards[idx.secid];
          if (!r || !c) return;
          const price = Number(r.f2);
          const pct = Number(r.f3);
          const cls = dirClass(pct);
          c.price.textContent = fmtNum(price, 2);
          c.price.className = `eubd-idx-price ${cls}`;
          c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
          c.pct.className = `eubd-idx-pct ${cls}`;
        });
        STOCK_GROUPS.forEach((g) => {
          g.items.forEach((s) => {
            const r = bySecid[s.secid];
            const c = stockRows[s.secid];
            if (!r || !c) return;
            const raw = Number(r.f2);
            const pct = Number(r.f3);
            const cls = dirClass(pct);
            // 伦交所报价单位为便士(GBX)，展示时换算为英镑
            const price = s.uk ? raw / 100 : raw;
            c.price.textContent = Number.isFinite(price) ? fmtNum(price, 2) : '—';
            c.price.className = `eubd-price ${cls}`;
            c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
            c.pct.className = `eubd-pct ${cls}`;
          });
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
          showError('行情加载失败，30 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      renderSession();
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
