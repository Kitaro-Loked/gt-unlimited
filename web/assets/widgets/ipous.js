/* 美股打新 — Tab1 即将上市日历(未来30天) + Tab2 近期上市表现(近60天)，东财 clist CORS JSON
 * 数据源: https://push2.eastmoney.com/api/qt/clist/get?fs=m:105,m:106,m:107&fid=f26&po=1
 *   （备用 https://push2delay.eastmoney.com 延时行情兜底，双 host 依序回退）
 *   字段：f12=代码 f13=市场(105纳斯达克/106纽交所/107美交所) f14=名称 f2=现价 f3=涨跌幅%
 *   f26=上市日期(YYYYMMDD) f100=行业；pz 上限 100，按 fid=f26 倒序即最新上市在前
 *
 * 接口实测结论（2026-07-16，curl + Origin: https://trading.2009731.xyz 复测）：
 *   ① 东财 datacenter-web 美股 IPO 报表：RPT_USIPO_LIST / RPT_US_IPO_LIST / RPT_USIPO_CALENDAR /
 *      RPTA_US_IPO / RPTA_USIPO / RPT_US_IPOAPPLY / RPT_USIPO_INFO / RPT_US_STOCK_IPO /
 *      RPT_US_IPO / RPT_USIPO / RPT_HK_IPO_LIST 等 20+ 候选 reportName 全部返回 code 9501（报表不存在），
 *      东财无美股 IPO 公开报表；RPT_USF10_INFO_ORGPROFILE 仅公司概况（无发行价/募资额）。
 *   ② api.nasdaq.com/api/ipo/calendar：数据完整（含定价/募资额），但响应头无 Access-Control-Allow-Origin，
 *      浏览器 CORS 拦截，不可用。
 *   ③ stockanalysis.com /ipos/：HTML 服务端渲染且响应无 ACAO；/api/* 均 404（虽带 ACAO:*），不可用。
 *   ④ alphavantage IPO_CALENDAR：demo key 仅返回空 CSV 头，需付费 key，不可用。
 *   ⑤ push2his.eastmoney.com 日 K：本机偶发连接失败（http 000），且需逐股请求，放弃用其推算首日涨幅。
 *   ⑥ push2 主站本机出口 502（与 ushot/asharecb 一致）；push2delay 200 且 ACAO 回显 Origin → 唯一可用源。
 *   结论：发行价区间/募资额/首日涨幅/较发行价涨幅均无免费免 key 且支持 CORS 的数据源，
 *   故相关列不展示；即将上市日历仅有名称/代码/交易所/预计上市日/行业（东财通常只披露近几日日程）。
 *
 * 注意：美股绿涨红跌（国际习惯），方向着色令牌化 ipus-up=var(--up) / ipus-down=var(--down)
 * （只换令牌不翻转语义）；会话/今日等强调态统一用品牌 --acc 系。
 * Registers as custom tool id 'ipous' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'upcoming', label: '即将上市' },
    { id: 'recent', label: '近60天新股' },
  ];
  const LS_TAB_KEY = 'ipous.tab';
  const LS_ETF_KEY = 'ipous.etf';

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f26,f100';
  const PAGE_SIZE = 100; // clist pz 上限实测为 100
  const MAX_PAGES = 6; // 实测 100 行约覆盖 18 天，6 页足以覆盖 60 天窗口
  const emUrls = (pn) =>
    EM_HOSTS.map(
      (host) =>
        `${host}/api/qt/clist/get?pn=${pn}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f26` +
        `&fs=${encodeURIComponent('m:105,m:106,m:107')}&fields=${EM_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`
    );

  const EXCH_MAP = { 105: 'NASDAQ', 106: 'NYSE', 107: 'AMEX' };
  const RECENT_DAYS = 60;
  const UPCOMING_DAYS = 30;
  const RECENT_SHOW = 30; // 近期上市最多展示行数
  const REFRESH_MS = 30000; // 盘前/盘中/盘后刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  // 名称启发式分类：ETF（默认隐藏，可切换）/ SPAC / 新股
  const ETF_RE =
    /ETF|基金|做多|做空|\bFund\b|YieldMax|Direxion|ProShares|GraniteShares|VistaShares|KraneShares|XFUNDS|T-REX|REX Shares|Leverage Shares|Defiance|Roundhill|Global X|iShares|SPDR|Invesco|Vanguard|Virtus|John Hancock|Tradr|Bitwise|ARK |21Shares|VanEck|Franklin Templeton|Grayscale|Y.all Street|\bSEI\b/i;
  // 注意必须用词边界 \bSPAC\b，否则会误伤 "Space"/"SpaceX" 等名称
  const SPAC_RE = /\bAcquisition\b|\bAcq\.?\b|\bSPAC\b|空白支票|\bMerger Corp\b/i;

  function injectStyle() {
    if (document.getElementById('ipous-style')) return;
    const style = document.createElement('style');
    style.id = 'ipous-style';
    style.textContent = `
.ipus-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.ipus-head-right { display: flex; align-items: center; gap: 8px; }
.ipus-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ipus-session.open { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
.ipus-session.ext { color: var(--warning); border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.ipus-status { color: var(--warning); white-space: nowrap; }
.ipus-status.live { color: var(--acc); }
/* 美股绿涨红跌（国际习惯）令牌化：涨=--up 跌=--down，勿改用 --acc/--danger */
.ipus-up { color: var(--up); }
.ipus-down { color: var(--down); }
.ipus-flat { color: var(--text-muted); }
.ipus-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 8px;
}
.ipus-tab {
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.06em;
  white-space: nowrap;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
}
.ipus-tab:hover { color: var(--text); border-color: var(--text-dim); }
.ipus-tab.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
}
.ipus-etf {
  margin-left: auto;
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0.04em;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid);
}
.ipus-etf.on { color: var(--warning); border-color: var(--warning); }
.ipus-table { font-variant-numeric: tabular-nums; }
.ipus-table th, .ipus-table td { white-space: nowrap; }
.ipus-table tbody tr { cursor: pointer; transition: background 0.18s var(--ease-fluid); }
.ipus-table tbody tr:hover { background: var(--surface-raised); }
.ipus-name { font-weight: 600; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.ipus-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.ipus-num { font-family: var(--font-mono); }
.ipus-chip {
  display: inline-block;
  font-size: 9px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.ipus-chip.exch { color: var(--info); border-color: color-mix(in srgb, var(--info) 45%, transparent); }
.ipus-chip.spac { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 45%, transparent); margin-left: 4px; }
.ipus-chip.etf { color: var(--text-dim); margin-left: 4px; }
.ipus-chip.hot { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); margin-left: 4px; }
.ipus-days { color: var(--text-muted); font-family: var(--font-mono); }
.ipus-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ipus-note {
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
  line-height: 1.5;
}
.ipus-foot {
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px solid var(--hairline);
  padding-top: 6px;
}
.ipus-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  // 美股价格：>=1 保留 2 位，<1 保留 4 位（低价新股常见）
  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    return v >= 1 ? fmtNum(v, 2) : fmtNum(v, 4);
  };

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ipus-flat';
    return v > 0 ? 'ipus-up' : 'ipus-down';
  };

  // 美东时间（America/New_York，自动夏令时）；极端环境回退本地时区
  const etNow = () => {
    try {
      return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    } catch (e) {
      return new Date();
    }
  };

  // 美东日期偏移 offsetDays 后的 YYYYMMDD 数字（与 f26 同格式，可直接比大小）
  const etDateNum = (offsetDays) => {
    const t = etNow();
    t.setDate(t.getDate() + (offsetDays || 0));
    return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  };

  // f26(YYYYMMDD 数字) → 'MM-DD'
  const fmtListDate = (f26) => {
    const s = String(f26);
    return `${s.slice(4, 6)}-${s.slice(6, 8)}`;
  };

  // 上市至今自然日天数（按美东日期差）
  const daysSince = (f26) => {
    const s = String(f26);
    const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    const t = etNow();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((today.getTime() - d.getTime()) / 86400000);
  };

  /* 美东时段划分（不含法定节假日，仅按星期粗判）：
   * 盘前 04:00-09:29 / 盘中 09:30-15:59 / 盘后 16:00-19:59 / 其余休市 */
  const sessionState = () => {
    const et = etNow();
    const day = et.getDay();
    const mins = et.getHours() * 60 + et.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if (mins >= 240 && mins < 570) return 'pre';
    if (mins >= 570 && mins < 960) return 'trading';
    if (mins >= 960 && mins < 1200) return 'after';
    return 'closed';
  };

  const classify = (name) => {
    if (SPAC_RE.test(name)) return 'SPAC';
    if (ETF_RE.test(name)) return 'ETF';
    return '新股';
  };

  const loadTabId = () => {
    try {
      const v = window.localStorage.getItem(LS_TAB_KEY);
      if (TABS.some((t) => t.id === v)) return v;
    } catch (e) { /* localStorage 不可用时用默认 */ }
    return TABS[0].id;
  };
  const saveTabId = (id) => {
    try {
      window.localStorage.setItem(LS_TAB_KEY, id);
    } catch (e) { /* 忽略 */ }
  };
  const loadEtf = () => {
    try {
      return window.localStorage.getItem(LS_ETF_KEY) === '1';
    } catch (e) {
      return false;
    }
  };
  const saveEtf = (on) => {
    try {
      window.localStorage.setItem(LS_ETF_KEY, on ? '1' : '0');
    } catch (e) { /* 忽略 */ }
  };

  window.GT_EXTRA_TOOLS['ipous'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = loadTabId();
      let showEtf = loadEtf(); // 默认隐藏 ETF（美股新上市证券以杠杆 ETF 为主）

      el.innerHTML = `
        <div class="tool ipus-root">
          <div class="ipus-head">
            <span>美股 · 打新 IPO</span>
            <span class="ipus-head-right">
              <span class="ipus-session" data-session>—</span>
              <span class="ipus-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="ipus-tabs" data-tabs>
            ${TABS.map(
              (t) => `<button type="button" class="ipus-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
            ).join('')}
            <button type="button" class="ipus-etf${showEtf ? ' on' : ''}" data-etf title="切换是否显示 ETF 新发">${showEtf ? '含ETF' : '隐藏ETF'}</button>
          </div>
          <table class="data-table ipus-table">
            <thead data-head></thead>
            <tbody data-body>
              <tr class="ipus-empty"><td colspan="6">加载中…</td></tr>
            </tbody>
          </table>
          <div class="ipus-note">注：美股无公开打新渠道，IPO 申购需通过券商；发行价区间/募资额以券商及 SEC 文件为准（免费行情源不提供）。</div>
          <div class="ipus-foot">
            <span>来源：<span data-source>东方财富 · 美股全市场（按上市日期）</span><b data-delayed></b></span>
            <span>更新于 <b data-updated>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const head = el.querySelector('[data-head]');
      const body = el.querySelector('[data-body]');
      const tabsEl = el.querySelector('[data-tabs]');
      const etfBtn = el.querySelector('[data-etf]');
      const delayedEl = el.querySelector('[data-delayed]');
      const updatedEl = el.querySelector('[data-updated]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let allRows = []; // 最近一次成功获取的标准化上市记录（未来 + 近60天）
      let lastDelayed = false;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'ipus-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ipus-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 盘中';
          sessionEl.className = 'ipus-session open';
        } else if (s === 'pre') {
          sessionEl.textContent = '盘前';
          sessionEl.className = 'ipus-session ext';
        } else if (s === 'after') {
          sessionEl.textContent = '盘后';
          sessionEl.className = 'ipus-session ext';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'ipus-session';
        }
        return s;
      };

      // 通用 CORS fetch（带 10s 超时），urls 依序回退（push2 → push2delay）
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
            const json = await resp.json();
            return { json, delayed: i > 0 };
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

      // 分页拉取全市场按上市日期倒序的记录，覆盖 未来30天 + 近60天 窗口
      const fetchListings = async () => {
        const cutoff = etDateNum(-RECENT_DAYS);
        const rows = [];
        let delayed = false;
        for (let pn = 1; pn <= MAX_PAGES; pn += 1) {
          let page;
          try {
            page = await fetchJson(emUrls(pn));
          } catch (e) {
            if (pn === 1) throw e; // 首页失败才整体报错，后续页失败保留部分数据
            break;
          }
          const { json, delayed: d } = page;
          if (d) delayed = true;
          const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
          let reachedCutoff = false;
          diff.forEach((r) => {
            const f26 = Number(r.f26);
            if (!Number.isFinite(f26) || f26 < 20000101) return;
            if (f26 < cutoff) {
              reachedCutoff = true; // 倒序排列，其后记录更早，无需再收
              return;
            }
            const name = String(r.f14 || '');
            const code = String(r.f12 || '');
            if (!code || !name) return;
            rows.push({
              code,
              name,
              exch: EXCH_MAP[Number(r.f13)] || '—',
              date: f26,
              price: r.f2 == null || r.f2 === '-' ? NaN : Number(r.f2),
              pct: r.f3 == null || r.f3 === '-' ? NaN : Number(r.f3),
              industry: r.f100 && r.f100 !== '-' ? String(r.f100) : '',
              type: classify(name),
            });
          });
          if (reachedCutoff || diff.length < PAGE_SIZE) break;
        }
        return { rows, delayed };
      };

      const typeChip = (r) => {
        if (r.type === 'SPAC') return '<span class="ipus-chip spac">SPAC</span>';
        if (r.type === 'ETF') return '<span class="ipus-chip etf">ETF</span>';
        return '';
      };

      const visibleRows = (rows) => (showEtf ? rows : rows.filter((r) => r.type !== 'ETF'));

      // —— Tab1：即将上市（未来 30 天，按上市日升序）——
      const renderUpcoming = () => {
        head.innerHTML = `<tr><th>预计上市</th><th>名称</th><th>交易所</th><th>行业</th></tr>`;
        const today = etDateNum(0);
        const limit = etDateNum(UPCOMING_DAYS);
        const rows = visibleRows(allRows.filter((r) => r.date >= today && r.date <= limit)).sort((a, b) => a.date - b.date);
        if (!rows.length) {
          body.innerHTML = `<tr class="ipus-empty"><td colspan="4">未来 30 天暂无新披露的美股上市日程</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r) => {
            const chip =
              r.date === today
                ? '<span class="ipus-chip hot">今日上市</span>'
                : r.date === etDateNum(1)
                  ? '<span class="ipus-chip">明日</span>'
                  : '';
            const url = `https://quote.eastmoney.com/us/${encodeURIComponent(r.code)}.html`;
            return `
            <tr data-url="${url}" title="查看 ${esc(r.name)} 行情详情">
              <td class="ipus-num">${esc(fmtListDate(r.date))}${chip}</td>
              <td class="ipus-name">${esc(r.name)}<i>${esc(r.code)}</i>${typeChip(r)}</td>
              <td><span class="ipus-chip exch">${esc(r.exch)}</span></td>
              <td class="ipus-days">${esc(r.industry || '—')}</td>
            </tr>`;
          })
          .join('');
      };

      // —— Tab2：近 60 天新股表现（按上市日倒序，现价/当日涨幅）——
      const renderRecent = () => {
        head.innerHTML = `<tr><th>上市日</th><th>名称</th><th>交易所</th><th>现价($)</th><th>当日涨跌</th><th>天数</th></tr>`;
        const today = etDateNum(0);
        const rows = visibleRows(allRows.filter((r) => r.date <= today))
          .sort((a, b) => b.date - a.date)
          .slice(0, RECENT_SHOW);
        if (!rows.length) {
          body.innerHTML = `<tr class="ipus-empty"><td colspan="6">近 60 天暂无新股数据</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r) => {
            const cls = dirClass(r.pct);
            const days = daysSince(r.date);
            const url = `https://quote.eastmoney.com/us/${encodeURIComponent(r.code)}.html`;
            return `
            <tr data-url="${url}" title="查看 ${esc(r.name)} 行情详情">
              <td class="ipus-num">${esc(fmtListDate(r.date))}</td>
              <td class="ipus-name">${esc(r.name)}<i>${esc(r.code)}</i>${typeChip(r)}</td>
              <td><span class="ipus-chip exch">${esc(r.exch)}</span></td>
              <td class="ipus-num ${cls}">${esc(fmtPrice(r.price))}</td>
              <td class="ipus-num ${cls}">${Number.isFinite(r.pct) ? esc(fmtSigned(r.pct, 2)) + '%' : '—'}</td>
              <td class="ipus-days">${days <= 0 ? '今日' : `${days}天`}</td>
            </tr>`;
          })
          .join('');
      };

      const renderTab = () => {
        delayedEl.textContent = lastDelayed ? '（延时行情）' : '';
        if (activeTab === 'upcoming') renderUpcoming();
        else renderRecent();
      };

      const renderError = () => {
        body.innerHTML = `<tr class="ipus-empty"><td colspan="6">数据加载失败，稍后自动重试…</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        // 新请求前 abort 上一轮仍在进行的 fetch
        pendingAborts.forEach((c) => {
          try {
            c.abort();
          } catch (e) { /* 忽略 */ }
        });
        try {
          const result = await fetchListings();
          if (!alive) return;
          allRows = result.rows;
          lastDelayed = result.delayed;
          renderTab();
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          renderError();
          showError('数据加载失败，30 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return; // 页面不可见时跳过刷新
        const s = renderSession();
        if (s !== 'closed' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      // tab / ETF 切换仅本地重排，不重新拉取
      const onTabsClick = (e) => {
        const etf = e.target && e.target.closest ? e.target.closest('[data-etf]') : null;
        if (etf) {
          showEtf = !showEtf;
          saveEtf(showEtf);
          etfBtn.classList.toggle('on', showEtf);
          etfBtn.textContent = showEtf ? '含ETF' : '隐藏ETF';
          renderTab();
          return;
        }
        const btn = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
        if (!btn) return;
        const id = btn.getAttribute('data-tab');
        if (!id || id === activeTab) return;
        activeTab = id;
        saveTabId(id);
        tabsEl.querySelectorAll('.ipus-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        renderTab();
      };

      const onRowClick = (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-url]') : null;
        if (!tr) return;
        const url = tr.getAttribute('data-url');
        if (url) window.open(url, '_blank', 'noopener');
      };

      tabsEl.addEventListener('click', onTabsClick);
      body.addEventListener('click', onRowClick);

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
        tabsEl.removeEventListener('click', onTabsClick);
        body.removeEventListener('click', onRowClick);
      };
    },
  };
})();
