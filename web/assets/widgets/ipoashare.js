/* A股打新工作台 — ①申购日历(按申购日分组,今日高亮) ②待上市 ③新债申购 ④首日涨幅回顾
 * 数据源: 东方财富 datacenter-web（全部 curl 实测 2026-07-16，HTTP 200；
 *   带 Origin: https://trading.2009731.xyz 时响应 Access-Control-Allow-Origin: *，浏览器跨域 fetch 可用）
 * ①②④ 新股报表: reportName=RPTA_APP_IPOAPPLY（filter 支持 APPLY_DATE/LISTING_DATE 比较；排序列 APPLY_DATE/LISTING_DATE 均有效）
 *   字段: SECUCODE=带市场后缀代码 SECURITY_CODE=证券代码 APPLY_CODE=申购代码(沪732/787开头,与证券代码不同)
 *   SECURITY_NAME=名称 APPLY_DATE=申购日 LISTING_DATE=上市日(未定=null)
 *   BALLOT_NUM_DATE=中签号公布日 BALLOT_PAY_DATE=缴款日 ISSUE_PRICE=发行价(未来价未定=null)
 *   AFTER_ISSUE_PE=发行市盈率 INDUSTRY_PE_NEW=行业市盈率 ONLINE_APPLY_UPPER=网上申购上限(股)
 *   TOP_APPLY_MARKETCAP=顶格需配市值(万元; 北交所为全额现金申购,该值=顶格申购资金,如千岸科技 787500股×24.3元=1913.625万)
 *   ISSUE_NUM=发行量(万股) MARKET_TYPE_NEW=板块 LD_CLOSE_CHANGE=上市首日收盘涨幅%
 * ③ 新债报表: reportName=RPT_BOND_CB_LIST（filter 支持 PUBLIC_START_DATE；排序列 PUBLIC_START_DATE）
 *   字段: SECURITY_CODE=转债代码 SECURITY_NAME_ABBR=转债简称 CORRECODE=申购代码 CORRECODE_NAME_ABBR=申购简称
 *   SECURITY_SHORT_NAME=正股 PUBLIC_START_DATE=申购日 LISTING_DATE=上市日 ACTUAL_ISSUE_SCALE=发行规模(亿元)
 *   RATING=债项评级 INITIAL_TRANSFER_PRICE=转股价 ONLINE_GENERAL_AAU=网上申购上限(样本恒为1000,手)
 *   新债申购专用报表名 RPTA_CB_APPLY / RPT_CB_APPLY / RPTA_APP_CBAPPLY / RPT_BOND_CB_APPLY / RPT_CB_LIST
 *   实测均返回 code 9501(报表不存在)，故新债 Tab 改用 RPT_BOND_CB_LIST 实现。
 * 配色: 方向着色令牌化 ipoas-up=var(--up) / ipoas-down=var(--down)（A股 涨=up 跌=down，
 * 只换令牌不翻转语义）；会话/Tab/今日/热门等强调态统一用品牌 --acc 系。
 * Registers as custom tool id 'ipoashare' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DC_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const IPO_COLS =
    'SECUCODE,SECURITY_CODE,SECURITY_NAME,APPLY_CODE,APPLY_DATE,LISTING_DATE,BALLOT_NUM_DATE,BALLOT_PAY_DATE,' +
    'ISSUE_PRICE,AFTER_ISSUE_PE,INDUSTRY_PE_NEW,ONLINE_APPLY_UPPER,TOP_APPLY_MARKETCAP,ISSUE_NUM,MARKET_TYPE_NEW,' +
    'INDUSTRY_NAME,LD_CLOSE_CHANGE';
  // ① 申购日历: 今日起未来申购（含今日），按申购日升序
  const APPLY_URL =
    `${DC_BASE}?reportName=RPTA_APP_IPOAPPLY&columns=${IPO_COLS}` +
    `&filter=(APPLY_DATE%3E%3D'TODAY')&sortColumns=APPLY_DATE&sortTypes=1&pageSize=30&pageNumber=1&source=WEB&client=WEB`;
  // ② 待上市: 已申购未上市（含今日申购），按申购日倒序后客户端再筛
  const PENDING_URL =
    `${DC_BASE}?reportName=RPTA_APP_IPOAPPLY&columns=${IPO_COLS}` +
    `&filter=(APPLY_DATE%3C%3D'TODAY')&sortColumns=APPLY_DATE&sortTypes=-1&pageSize=30&pageNumber=1&source=WEB&client=WEB`;
  // ④ 首日回顾: 已上市，按上市日倒序
  const REVIEW_URL =
    `${DC_BASE}?reportName=RPTA_APP_IPOAPPLY&columns=${IPO_COLS}` +
    `&filter=(LISTING_DATE%3C%3D'TODAY')&sortColumns=LISTING_DATE&sortTypes=-1&pageSize=10&pageNumber=1&source=WEB&client=WEB`;
  // ③ 新债: 近 60 天起申购的转债（含未来），客户端拆分申购中/待上市
  const CB_COLS =
    'SECURITY_CODE,SECURITY_NAME_ABBR,CORRECODE,CORRECODE_NAME_ABBR,SECURITY_SHORT_NAME,' +
    'PUBLIC_START_DATE,LISTING_DATE,ACTUAL_ISSUE_SCALE,RATING,INITIAL_TRANSFER_PRICE,ONLINE_GENERAL_AAU';
  const CB_URL =
    `${DC_BASE}?reportName=RPT_BOND_CB_LIST&columns=${CB_COLS}` +
    `&filter=(PUBLIC_START_DATE%3E%3D'D60')&sortColumns=PUBLIC_START_DATE&sortTypes=-1&pageSize=40&pageNumber=1&source=WEB&client=WEB`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  const TABS = [
    { id: 'apply', label: '申购日历' },
    { id: 'pending', label: '待上市' },
    { id: 'cb', label: '新债申购' },
    { id: 'review', label: '首日回顾' },
  ];
  const LS_TAB_KEY = 'ipoashare.tab';

  function injectStyle() {
    if (document.getElementById('ipoas-style')) return;
    const style = document.createElement('style');
    style.id = 'ipoas-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.ipoas-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .ipoas-root { --up: #C0442F; --down: #2E7D4F; }
.ipoas-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.ipoas-head-right { display: flex; align-items: center; gap: 8px; }
.ipoas-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ipoas-session.open { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
.ipoas-status { color: var(--warning); white-space: nowrap; }
.ipoas-status.live { color: var(--acc); }
/* 方向着色令牌化：A股 涨=--up 跌=--down，勿改用 --acc/--danger */
.ipoas-up { color: var(--up); }
.ipoas-down { color: var(--down); }
.ipoas-flat { color: var(--text-muted); }
.ipoas-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ipoas-tab {
  appearance: none;
  border: 1px solid var(--hairline);
  background: var(--surface-raised);
  color: var(--text-muted);
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 0.06em;
  white-space: nowrap;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
}
.ipoas-tab:hover { color: var(--text); border-color: var(--text-dim); }
.ipoas-tab.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
  font-weight: 600;
}
.ipoas-table { font-variant-numeric: tabular-nums; }
.ipoas-table th, .ipoas-table td { white-space: nowrap; }
.ipoas-table tbody tr[data-url] { cursor: pointer; transition: background 0.18s var(--ease-fluid); }
.ipoas-table tbody tr[data-url]:hover { background: var(--surface-raised); }
.ipoas-group td {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  padding-top: 8px;
  border-bottom: 1px solid var(--hairline-strong);
}
.ipoas-group.today td { color: var(--acc); }
.ipoas-name { font-weight: 600; }
.ipoas-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.ipoas-sub { color: var(--text-muted); }
.ipoas-num { font-family: var(--font-mono); }
.ipoas-chip {
  display: inline-block;
  font-size: 9px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.ipoas-chip.hot { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
.ipoas-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ipoas-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 9px;
  color: var(--text-dim);
  border-top: 1px solid var(--hairline);
  padding-top: 6px;
}
.ipoas-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ipoas-flat';
    return v > 0 ? 'ipoas-up' : 'ipoas-down';
  };

  // 北京时间（UTC+8）日期串 YYYY-MM-DD
  const bjToday = () => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const m = String(bj.getMonth() + 1).padStart(2, '0');
    const d = String(bj.getDate()).padStart(2, '0');
    return `${bj.getFullYear()}-${m}-${d}`;
  };

  // 北京时间 today 前 n 天的 YYYY-MM-DD
  const bjDaysAgo = (n) => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000 - n * 86400000);
    const m = String(bj.getMonth() + 1).padStart(2, '0');
    const d = String(bj.getDate()).padStart(2, '0');
    return `${bj.getFullYear()}-${m}-${d}`;
  };

  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekdayOf = (dateStr) => {
    const p = String(dateStr).split('-');
    if (p.length !== 3) return '';
    return WD[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
  };

  // SECUCODE 后缀 → 东财行情页市场前缀
  const mktOfSecu = (secucode) => {
    const s = String(secucode || '');
    if (s.endsWith('.SH')) return 'sh';
    if (s.endsWith('.BJ')) return 'bj';
    return 'sz';
  };
  // 转债 11→sh，其余→sz（同 asharecb）
  const mktOfBond = (code) => (String(code).indexOf('11') === 0 ? 'sh' : 'sz');

  // 板块名称缩写
  const boardName = (s) => {
    const v = String(s || '');
    if (v.indexOf('科创') >= 0) return '科创板';
    if (v.indexOf('创业') >= 0) return '创业板';
    if (v.indexOf('北交') >= 0) return '北交所';
    if (v.indexOf('深') >= 0) return '深主板';
    if (v.indexOf('上') >= 0 || v.indexOf('沪') >= 0) return '沪主板';
    return v || '—';
  };

  // 申购上限（股）→ 万股
  const fmtShares = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e4) return `${fmtNum(v / 1e4, v / 1e4 >= 100 ? 1 : 2)}万股`;
    return `${fmtNum(v, 0)}股`;
  };

  // 发行量（万股）→ 亿/万股
  const fmtIssueNum = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e4) return `${fmtNum(v / 1e4, 2)}亿股`;
    return `${fmtNum(v, 0)}万股`;
  };

  // 顶格需配（万元）
  const fmtWan = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${fmtNum(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2)}万`;
  };

  // 北京时间（UTC+8）交易时段：周一至五 09:15-11:30 / 13:00-15:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const day = bj.getDay();
    const mins = bj.getHours() * 60 + bj.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 555 && mins < 690) || (mins >= 780 && mins <= 900)) return 'trading';
    if (mins >= 690 && mins < 780) return 'lunch';
    return 'closed';
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

  // 新股行标准化（null→''/NaN，避免 Number(null)=0 误显）
  const mapIpoRow = (r) => ({
    secucode: String(r.SECUCODE || ''),
    code: String(r.SECURITY_CODE || ''),
    name: String(r.SECURITY_NAME || ''),
    applyCode: String(r.APPLY_CODE || ''),
    board: boardName(r.MARKET_TYPE_NEW),
    industry: String(r.INDUSTRY_NAME || ''),
    applyDate: r.APPLY_DATE ? String(r.APPLY_DATE).slice(0, 10) : '',
    listDate: r.LISTING_DATE ? String(r.LISTING_DATE).slice(0, 10) : '',
    ballotNumDate: r.BALLOT_NUM_DATE ? String(r.BALLOT_NUM_DATE).slice(0, 10) : '',
    ballotPayDate: r.BALLOT_PAY_DATE ? String(r.BALLOT_PAY_DATE).slice(0, 10) : '',
    price: r.ISSUE_PRICE == null ? NaN : Number(r.ISSUE_PRICE),
    pe: r.AFTER_ISSUE_PE == null ? NaN : Number(r.AFTER_ISSUE_PE),
    indPe: r.INDUSTRY_PE_NEW == null ? NaN : Number(r.INDUSTRY_PE_NEW),
    applyUpper: r.ONLINE_APPLY_UPPER == null ? NaN : Number(r.ONLINE_APPLY_UPPER),
    topMc: r.TOP_APPLY_MARKETCAP == null ? NaN : Number(r.TOP_APPLY_MARKETCAP),
    issueNum: r.ISSUE_NUM == null ? NaN : Number(r.ISSUE_NUM),
    firstPct: r.LD_CLOSE_CHANGE == null ? NaN : Number(r.LD_CLOSE_CHANGE),
  });

  // 状态机：今日申购 > 待申购 > 今日上市 > 待上市 > 已缴款待上市；今日事项红色高亮
  const ipoState = (r, today) => {
    if (r.applyDate && r.applyDate === today) return { chip: '今日申购', hot: true, col: 'apply' };
    if (r.applyDate && r.applyDate > today) return { chip: '待申购', hot: false, col: 'apply' };
    if (r.listDate && r.listDate === today) return { chip: '今日上市', hot: true, col: 'list' };
    if (r.listDate && r.listDate > today) return { chip: '待上市', hot: false, col: 'list' };
    return { chip: '已缴款待上市', hot: false, col: 'list' }; // 申购缴款已过、上市日未定
  };

  const chipHtml = (st, col) =>
    st.chip && st.col === col ? ` <span class="ipoas-chip${st.hot ? ' hot' : ''}">${esc(st.chip)}</span>` : '';

  window.GT_EXTRA_TOOLS['ipoashare'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = loadTabId();

      el.innerHTML = `
        <div class="tool ipoas-root">
          <div class="ipoas-head">
            <span>A股 · 打新工作台</span>
            <span class="ipoas-head-right">
              <span class="ipoas-session" data-session>—</span>
              <span class="ipoas-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="ipoas-tabs" data-tabs>
            ${TABS.map(
              (t) => `<button type="button" class="ipoas-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
            ).join('')}
          </div>
          <table class="data-table ipoas-table">
            <thead data-head></thead>
            <tbody data-body>
              <tr class="ipoas-empty"><td colspan="9">加载中…</td></tr>
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="ipoas-foot">
            <span>来源：<span data-source>东方财富</span>（点击行查看详情）</span>
            <span>更新于 <b data-updated>—</b></span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const head = el.querySelector('[data-head]');
      const body = el.querySelector('[data-body]');
      const tabsEl = el.querySelector('[data-tabs]');
      const sourceEl = el.querySelector('[data-source]');
      const updatedEl = el.querySelector('[data-updated]');

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
        conn.className = 'ipoas-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ipoas-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'ipoas-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'ipoas-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'ipoas-session';
        }
        return s;
      };

      // 通用 CORS fetch（10s 超时）
      const fetchJson = async (url) => {
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

      const dcRows = (json) =>
        json && json.result && Array.isArray(json.result.data) ? json.result.data : [];

      // —— Tab 表头 ——
      const HEADS = {
        apply:
          '<tr><th>名称</th><th>申购代码</th><th>发行价</th><th>发行PE</th><th>行业PE</th>' +
          '<th>申购上限</th><th>顶格需配</th><th>中签号</th><th>缴款日</th></tr>',
        pending:
          '<tr><th>名称</th><th>板块</th><th>发行价</th><th>发行量</th><th>申购日</th><th>上市日</th></tr>',
        cb:
          '<tr><th>转债名称</th><th>申购代码</th><th>正股</th><th>评级</th><th>规模</th>' +
          '<th>转股价</th><th>申购日</th><th>上市日</th></tr>',
        review:
          '<tr><th>名称</th><th>板块</th><th>上市日</th><th>发行价</th><th>首日涨幅</th></tr>',
      };
      const COLSPAN = { apply: 9, pending: 6, cb: 8, review: 5 };
      const SOURCES = {
        apply: '东方财富 · 新股申购日历（按申购日分组）',
        pending: '东方财富 · 待上市新股（顶格需配：北交所为申购资金口径）',
        cb: '东方财富 · 可转债发行列表（申购中 + 待上市）',
        review: '东方财富 · 近上市新股首日表现（红涨绿跌）',
      };

      const emptyRow = (tab, msg) =>
        `<tr class="ipoas-empty"><td colspan="${COLSPAN[tab]}">${esc(msg)}</td></tr>`;

      // —— ① 申购日历：今日起未来申购，按申购日分组 ——
      const fetchApply = async () => {
        const json = await fetchJson(APPLY_URL.replace('TODAY', bjToday()));
        return dcRows(json).map(mapIpoRow).filter((r) => r.code && r.name);
      };

      const renderApply = (rows) => {
        const today = bjToday();
        if (!rows.length) {
          body.innerHTML = emptyRow('apply', '近期暂无新股申购');
          return;
        }
        const groups = new Map(); // applyDate -> rows
        rows.forEach((r) => {
          const k = r.applyDate || '未定';
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(r);
        });
        const parts = [];
        groups.forEach((list, date) => {
          const isToday = date === today;
          const label = date === '未定'
            ? '申购日待定'
            : `${date.slice(5)} ${weekdayOf(date)}${isToday ? ' · 今日申购' : ''} · ${list.length}只`;
          parts.push(`<tr class="ipoas-group${isToday ? ' today' : ''}"><td colspan="9">${esc(label)}</td></tr>`);
          list.forEach((r) => {
            const st = ipoState(r, today);
            const url = `https://quote.eastmoney.com/${mktOfSecu(r.secucode)}${esc(r.code)}.html`;
            const title = r.industry ? `${r.name} · ${r.industry}` : r.name;
            parts.push(`
            <tr data-url="${url}" title="${esc(title)}">
              <td class="ipoas-name">${esc(r.name)}<i>${esc(r.code)}</i>${chipHtml(st, 'apply')}</td>
              <td class="ipoas-num">${esc(r.applyCode || '—')}</td>
              <td class="ipoas-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '待定'}</td>
              <td class="ipoas-num">${Number.isFinite(r.pe) ? esc(fmtNum(r.pe, 2)) : '—'}</td>
              <td class="ipoas-num ipoas-sub">${Number.isFinite(r.indPe) ? esc(fmtNum(r.indPe, 2)) : '—'}</td>
              <td class="ipoas-num">${esc(fmtShares(r.applyUpper))}</td>
              <td class="ipoas-num">${esc(fmtWan(r.topMc))}</td>
              <td class="ipoas-num">${esc(r.ballotNumDate ? r.ballotNumDate.slice(5) : '—')}</td>
              <td class="ipoas-num">${esc(r.ballotPayDate ? r.ballotPayDate.slice(5) : '—')}</td>
            </tr>`);
          });
        });
        body.innerHTML = parts.join('');
      };

      // —— ② 待上市：已申购（含今日）、未上市或上市日 >= 今日 ——
      const fetchPending = async () => {
        const today = bjToday();
        const json = await fetchJson(PENDING_URL.replace('TODAY', today));
        return dcRows(json)
          .map(mapIpoRow)
          .filter((r) => r.code && r.name && (!r.listDate || r.listDate >= today));
      };

      const renderPending = (rows) => {
        const today = bjToday();
        if (!rows.length) {
          body.innerHTML = emptyRow('pending', '暂无待上市新股');
          return;
        }
        // 今日上市排最前，其余按上市日升序（未定置后）
        const sorted = rows.slice().sort((a, b) => {
          const ka = a.listDate || '9999-12-31';
          const kb = b.listDate || '9999-12-31';
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        body.innerHTML = sorted
          .map((r) => {
            const st = ipoState(r, today);
            const url = `https://quote.eastmoney.com/${mktOfSecu(r.secucode)}${esc(r.code)}.html`;
            const title = r.industry ? `${r.name} · ${r.industry}` : r.name;
            return `
            <tr data-url="${url}" title="${esc(title)}">
              <td class="ipoas-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td><span class="ipoas-chip">${esc(r.board)}</span></td>
              <td class="ipoas-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="ipoas-num">${esc(fmtIssueNum(r.issueNum))}</td>
              <td class="ipoas-num">${esc(r.applyDate ? r.applyDate.slice(5) : '—')}</td>
              <td class="ipoas-num">${esc(r.listDate ? r.listDate.slice(5) : '待定')}${chipHtml(st, 'list')}</td>
            </tr>`;
          })
          .join('');
      };

      // —— ③ 新债申购：申购中（申购日 >= 今日）+ 待上市（已申购未上市）——
      const fetchCb = async () => {
        const today = bjToday();
        const json = await fetchJson(CB_URL.replace('D60', bjDaysAgo(60)));
        const rows = dcRows(json)
          .map((r) => ({
            code: String(r.SECURITY_CODE || ''),
            name: String(r.SECURITY_NAME_ABBR || ''),
            applyCode: String(r.CORRECODE || ''),
            stock: String(r.SECURITY_SHORT_NAME || ''),
            applyDate: r.PUBLIC_START_DATE ? String(r.PUBLIC_START_DATE).slice(0, 10) : '',
            listDate: r.LISTING_DATE ? String(r.LISTING_DATE).slice(0, 10) : '',
            scale: r.ACTUAL_ISSUE_SCALE == null ? NaN : Number(r.ACTUAL_ISSUE_SCALE),
            rating: String(r.RATING || ''),
            tp: r.INITIAL_TRANSFER_PRICE == null ? NaN : Number(r.INITIAL_TRANSFER_PRICE),
          }))
          .filter((r) => r.code && r.name && r.applyDate);
        const applying = rows
          .filter((r) => r.applyDate >= today)
          .sort((a, b) => (a.applyDate < b.applyDate ? -1 : a.applyDate > b.applyDate ? 1 : 0));
        const pendingList = rows
          .filter((r) => r.applyDate < today && (!r.listDate || r.listDate >= today))
          .sort((a, b) => {
            const ka = a.listDate || '9999-12-31';
            const kb = b.listDate || '9999-12-31';
            return ka < kb ? -1 : ka > kb ? 1 : 0;
          });
        return { applying, pendingList };
      };

      const cbRowHtml = (r, today) => {
        const applyToday = r.applyDate === today;
        const listToday = r.listDate === today;
        const url = `https://quote.eastmoney.com/${mktOfBond(r.code)}${esc(r.code)}.html`;
        return `
        <tr data-url="${url}" title="${esc(r.name)} · 正股 ${esc(r.stock)}">
          <td class="ipoas-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
          <td class="ipoas-num">${esc(r.applyCode || '—')}</td>
          <td class="ipoas-sub">${esc(r.stock || '—')}</td>
          <td class="ipoas-num">${esc(r.rating || '—')}</td>
          <td class="ipoas-num">${Number.isFinite(r.scale) ? esc(fmtNum(r.scale, 2)) + '亿' : '—'}</td>
          <td class="ipoas-num">${Number.isFinite(r.tp) ? esc(fmtNum(r.tp, 2)) : '—'}</td>
          <td class="ipoas-num">${esc(r.applyDate.slice(5))}${applyToday ? ' <span class="ipoas-chip hot">今日申购</span>' : ''}</td>
          <td class="ipoas-num">${esc(r.listDate ? r.listDate.slice(5) : '待定')}${listToday ? ' <span class="ipoas-chip hot">今日上市</span>' : ''}</td>
        </tr>`;
      };

      const renderCb = (result) => {
        const today = bjToday();
        if (!result.applying.length && !result.pendingList.length) {
          body.innerHTML = emptyRow('cb', '近期暂无新债申购或上市');
          return;
        }
        const parts = [];
        if (result.applying.length) {
          parts.push(`<tr class="ipoas-group${result.applying.some((r) => r.applyDate === today) ? ' today' : ''}"><td colspan="8">申购中 · ${result.applying.length}只</td></tr>`);
          result.applying.forEach((r) => parts.push(cbRowHtml(r, today)));
        }
        if (result.pendingList.length) {
          parts.push(`<tr class="ipoas-group${result.pendingList.some((r) => r.listDate === today) ? ' today' : ''}"><td colspan="8">待上市 · ${result.pendingList.length}只</td></tr>`);
          result.pendingList.forEach((r) => parts.push(cbRowHtml(r, today)));
        }
        body.innerHTML = parts.join('');
      };

      // —— ④ 首日回顾：近上市新股首日收盘涨幅（打新收益预期参考）——
      const fetchReview = async () => {
        const json = await fetchJson(REVIEW_URL.replace('TODAY', bjToday()));
        return dcRows(json)
          .map(mapIpoRow)
          .filter((r) => r.code && r.name && r.listDate && Number.isFinite(r.firstPct))
          .slice(0, 6);
      };

      const renderReview = (rows) => {
        if (!rows.length) {
          body.innerHTML = emptyRow('review', '暂无近期上市新股数据');
          return;
        }
        const avg = rows.reduce((s, r) => s + r.firstPct, 0) / rows.length;
        body.innerHTML =
          rows
            .map((r) => {
              const cls = dirClass(r.firstPct);
              const url = `https://quote.eastmoney.com/${mktOfSecu(r.secucode)}${esc(r.code)}.html`;
              const title = r.industry ? `${r.name} · ${r.industry}` : r.name;
              return `
            <tr data-url="${url}" title="${esc(title)}">
              <td class="ipoas-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td><span class="ipoas-chip">${esc(r.board)}</span></td>
              <td class="ipoas-num">${esc(r.listDate.slice(5))}</td>
              <td class="ipoas-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="ipoas-num ${cls}">${esc(fmtSigned(r.firstPct, 2))}%</td>
            </tr>`;
            })
            .join('') +
          `<tr class="ipoas-group"><td colspan="5">近 ${rows.length} 只平均首日涨幅 <span class="${dirClass(avg)}">${esc(fmtSigned(avg, 2))}%</span></td></tr>`;
      };

      const FETCHERS = { apply: fetchApply, pending: fetchPending, cb: fetchCb, review: fetchReview };
      const RENDERERS = { apply: renderApply, pending: renderPending, cb: renderCb, review: renderReview };

      const renderTabChrome = () => {
        head.innerHTML = HEADS[activeTab];
        sourceEl.textContent = SOURCES[activeTab];
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
        const tab = activeTab;
        try {
          const result = await FETCHERS[tab]();
          if (!alive) return;
          // 等待期间用户可能已切换 Tab，过期结果直接丢弃
          if (tab !== activeTab) return;
          RENDERERS[tab](result);
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          if (tab === activeTab) {
            body.innerHTML = emptyRow(tab, '数据加载失败，稍后自动重试…');
            showError('数据加载失败，30 秒后自动重试…');
          }
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return;
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      const onTabsClick = (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
        if (!btn) return;
        const id = btn.getAttribute('data-tab');
        if (!id || id === activeTab) return;
        activeTab = id;
        saveTabId(id);
        tabsEl.querySelectorAll('.ipoas-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        renderTabChrome();
        body.innerHTML = emptyRow(id, '加载中…');
        refreshInFlight = false; // 允许立即发起新 Tab 的请求（旧请求在 refresh 开头被 abort）
        refresh();
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
      renderTabChrome();
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
