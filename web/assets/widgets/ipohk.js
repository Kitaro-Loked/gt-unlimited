/* 港股打新 — 待上市新股 + 次新股行情（东财 clist 降级口径，见下）
 * 数据源实测记录（2026-07-16，均用 curl 带 Origin: https://trading.2009731.xyz 复测）：
 * ① 东财 datacenter-web 港股 IPO 报表：不可用。穷举 RPT_HKIPO_LIST / RPT_HKIPO_APPLY /
 *    RPT_HK_IPOAPPLY / RPTA_HK_IPOAPPLY / RPT_HKIPO_ISSUE / RPT_HK_IPO_LIST / RPT_IPO_HK /
 *    RPT_HK_IPO / RPT_HKIPOLIST / RPTA_HK_IPO / RPT_HK_NEWIPO / RPT_IPO_HKLIST /
 *    RPT_HK_IPOLIST / RPTA_HK_XG / RPTA_APP_HKIPO / RPT_APP_HKIPO / RPT_HKIPOAPPLY /
 *    RPT_HK_IPOAPPLYLIST / RPT_HKIPO_ALLLIST / RPT_HKIPO_NEWLIST / RPT_HKIPO_CALENDAR /
 *    RPT_HKIPO_INFO / RPT_HKIPO_BASIC / RPT_HK_XGSG / RPT_XG_HKIPO / RPT_HKSTOCK_IPO /
 *    RPTA_IPO_HK / RPT_IPO_HKAPPLY / RPT_HK_NEW_STOCK 共 29 个候选，全部返回 code 9501
 *    （报表配置不存在）；GitHub/Sourcegraph 公开代码亦无东财港股 IPO 报表名踪迹。
 *    东财 hk.eastmoney.com/ipolist.html 为服务端渲染 HTML 且响应无 ACAO 头，浏览器不可用。
 *    新浪 vip.stock.finance.sina.com.cn/q/view/hk_IPOList.php 有真实港股新股表
 *    （招股价/招股日期/上市日期），但无 ACAO 头且不支持 JSONP，浏览器跨域不可用。
 *    披露易 hkexnews.hk ACAO 锁定 sc.hkexnews.hk；同花顺/阿斯达克均为 HTML+反爬，均不可用。
 * ② 东财 push2 clist（本组件采用）：
 *    https://push2.eastmoney.com/api/qt/clist/get?fs=m:116+t:3,m:116+t:4（港股主板+GEM 普通股）
 *    实测 2026-07-16：本机出口访问 push2 返回 502（与 asharecb/ashareboard 一致）；
 *    push2delay.eastmoney.com 200 且 Access-Control-Allow-Origin 回显请求 Origin（浏览器可用），
 *    故按双 host 模式 push2 失败回退 push2delay（延时行情兜底）。
 *    fid=f26&po=1 按上市日期倒序。字段：f12=代码 f14=名称 f2=最新价(HKD) f3=涨跌幅%
 *    f6=成交额(HKD) f26=上市日期(YYYYMMDD) f100=行业 f20=总市值(HKD)。
 *    未上市新股 f2/f3/f6 为 '-' 且 f26 为未来日期（实测：02990 鼎立资本/02995 雅天妮集团
 *    f26=20260720，GEM 08572 朝威控股 f26=20260717；腾讯 qt.gtimg.cn 个股行情侧证代码已存在）。
 * 降级口径（重要）：
 *    - 「待上市」Tab = clist 中尚无成交价（f2='-'）或上市日为未来日期的港股证券，
 *      含新上市/重新挂牌/介绍上市等，无法区分"招股中(可认购)"与"已截止招股待挂牌"；
 *      招股日期区间/发行价区间/每手股数/入场费/保荐人/孖展倍数/暗盘日期均无免费可跨域数据源，
 *      本组件不提供上述字段。
 *    - 「次新股」Tab = 按上市日倒序的近期上市新股，展示最新价与当日涨跌幅，
 *      非"首日涨跌"（发行价不可得，无法计算首日表现）。
 *    - 名称含括号（如"(五万)""(五百)"=合股临时代码）、"股权"、-R/-旧 后缀的特殊柜台已过滤。
 * 配色：港股绿涨红跌（国际习惯），方向着色令牌化 ipohk-up=var(--up) / ipohk-down=var(--down)
 *   （只换令牌不翻转语义）；会话/Tab/热榜等强调态统一用品牌 --acc 系。
 * 时段：Asia/Hong_Kong（UTC+8 无夏令时）周一至五 09:30-12:00 / 13:00-16:00，
 *   交易中 30s 刷新，休市降频 5 分钟；document.hidden 跳过刷新。
 * Registers as custom tool id 'ipohk' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'upcoming', label: '待上市' },
    { id: 'recent', label: '次新股' },
  ];
  const LS_TAB_KEY = 'ipohk.tab';

  // —— 东财 clist：港股主板(t:3)+GEM(t:4) 普通股，按上市日期(f26)倒序 ——
  const HK_FS = 'm:116+t:3,m:116+t:4';
  const HK_FIELDS = 'f12,f14,f2,f3,f6,f26,f100,f20';
  const HK_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const hkUrl = (host) =>
    `${host}/api/qt/clist/get?pn=1&pz=60&po=1&np=1&fltt=2&invt=2&fid=f26` +
    `&fs=${encodeURIComponent(HK_FS)}&fields=${HK_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`;

  const MAX_ROWS = 12; // 每个 Tab 最多展示行数
  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('ipohk-style')) return;
    const style = document.createElement('style');
    style.id = 'ipohk-style';
    style.textContent = `
.ipohk-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.ipohk-head-right { display: flex; align-items: center; gap: 8px; }
.ipohk-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ipohk-session.open { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
.ipohk-status { color: var(--warning); white-space: nowrap; }
.ipohk-status.live { color: var(--acc); }
/* 港股绿涨红跌（国际习惯）令牌化：涨=--up 跌=--down，勿改用 --acc/--danger */
.ipohk-up { color: var(--up); }
.ipohk-down { color: var(--down); }
.ipohk-flat { color: var(--text-muted); }
.ipohk-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ipohk-tab {
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
.ipohk-tab:hover { color: var(--text); border-color: var(--text-dim); }
.ipohk-tab.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
  font-weight: 600;
}
.ipohk-tab i { font-style: normal; font-family: var(--font-mono); font-size: 9px; margin-left: 4px; opacity: 0.8; }
.ipohk-table { font-variant-numeric: tabular-nums; }
.ipohk-table th, .ipohk-table td { white-space: nowrap; }
.ipohk-table tbody tr { cursor: pointer; transition: background 0.18s var(--ease-fluid); }
.ipohk-table tbody tr:hover { background: var(--surface-raised); }
.ipohk-rank { color: var(--text-dim); font-family: var(--font-mono); width: 1%; }
.ipohk-rank.top { color: var(--acc); font-weight: 700; }
.ipohk-name { font-weight: 600; }
.ipohk-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.ipohk-num { font-family: var(--font-mono); }
.ipohk-chip {
  display: inline-block;
  font-size: 9px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.ipohk-chip.hot { color: var(--warning); border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.ipohk-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ipohk-foot {
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
.ipohk-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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

  // 成交额（港元）→ 亿/万
  const fmtAmt = (hkd) => {
    if (!Number.isFinite(hkd)) return '—';
    const yi = hkd / 1e8;
    if (Math.abs(yi) >= 1) return `${fmtNum(yi, Math.abs(yi) >= 100 ? 1 : 2)}亿`;
    return `${fmtNum(hkd / 1e4, 0)}万`;
  };

  // 港股绿涨红跌
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ipohk-flat';
    return v > 0 ? 'ipohk-up' : 'ipohk-down';
  };

  // 香港时间（UTC+8，无夏令时）
  const hkNow = () => {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
  };
  const hkToday = () => {
    const hk = hkNow();
    const m = String(hk.getMonth() + 1).padStart(2, '0');
    const d = String(hk.getDate()).padStart(2, '0');
    return `${hk.getFullYear()}-${m}-${d}`;
  };

  // f26(YYYYMMDD) → YYYY-MM-DD
  const fmtListDate = (f26) => {
    const s = String(f26 || '');
    if (!/^\d{8}$/.test(s)) return '';
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  };

  // 特殊柜台噪音：合股临时代码"(五万)"/"(五百)"、股权、-R、-旧 等（真实 IPO 名称不含括号）
  const isNoiseCounter = (name) => {
    const n = String(name || '');
    if (/[（(]/.test(n)) return true;
    if (n.indexOf('股权') >= 0) return true;
    if (/(-R|-旧|旧)$/.test(n)) return true;
    return false;
  };

  // GEM（创业板）代码段 08xxx；其余按主板
  const boardOf = (code) => (String(code).indexOf('08') === 0 ? 'GEM' : '主板');

  // 香港（UTC+8）交易时段：周一至五 09:30-12:00 / 13:00-16:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const hk = hkNow();
    const day = hk.getDay();
    const mins = hk.getHours() * 60 + hk.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 570 && mins < 720) || (mins >= 780 && mins < 960)) return 'trading';
    if (mins >= 720 && mins < 780) return 'lunch';
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

  window.GT_EXTRA_TOOLS['ipohk'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = loadTabId();

      el.innerHTML = `
        <div class="tool ipohk-root">
          <div class="ipohk-head">
            <span>港股 · 打新与次新</span>
            <span class="ipohk-head-right">
              <span class="ipohk-session" data-session>—</span>
              <span class="ipohk-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="ipohk-tabs" data-tabs>
            ${TABS.map(
              (t) =>
                `<button type="button" class="ipohk-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(
                  t.label
                )}<i data-count="${esc(t.id)}"></i></button>`
            ).join('')}
          </div>
          <table class="data-table ipohk-table">
            <thead data-head></thead>
            <tbody data-body>
              <tr class="ipohk-empty"><td colspan="${activeTab === 'upcoming' ? 4 : 6}">加载中…</td></tr>
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="ipohk-foot">
            <span>来源：<span data-source>东方财富</span>（点击行查看行情）<b data-delayed></b></span>
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
      const delayedEl = el.querySelector('[data-delayed]');
      const updatedEl = el.querySelector('[data-updated]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let lastSplit = null; // 最近一次拆分的 { upcoming, recent }，用于 Tab 计数角标
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'ipohk-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ipohk-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'ipohk-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'ipohk-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'ipohk-session';
        }
        return s;
      };

      // 通用 CORS fetch（带 10s 超时），hosts 依序回退
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

      // 拉取并拆分：待上市（无成交价或上市日在未来）/ 次新（已上市按上市日倒序）
      const fetchList = async () => {
        const { json, delayed } = await fetchJson(HK_HOSTS.map(hkUrl));
        const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
        const today = hkToday();
        const upcoming = [];
        const recent = [];
        diff.forEach((r) => {
          const name = String(r.f14 || '');
          const code = String(r.f12 || '');
          if (!code || !name || isNoiseCounter(name)) return;
          const listDate = fmtListDate(r.f26);
          if (!listDate) return;
          const row = {
            code,
            name,
            board: boardOf(code),
            listDate,
            price: typeof r.f2 === 'number' ? r.f2 : NaN,
            pct: typeof r.f3 === 'number' ? r.f3 : NaN,
            amt: typeof r.f6 === 'number' ? r.f6 : NaN,
            industry: String(r.f100 && r.f100 !== '-' ? r.f100 : ''),
            mcap: typeof r.f20 === 'number' ? r.f20 : NaN,
          };
          if (!Number.isFinite(row.price) || listDate >= today) upcoming.push(row);
          else recent.push(row);
        });
        // API 按上市日倒序返回；待上市改为正序（最近挂牌的排最前）
        upcoming.sort((a, b) => (a.listDate < b.listDate ? -1 : a.listDate > b.listDate ? 1 : 0));
        return { upcoming, recent, delayed };
      };

      const quoteUrl = (code) => `https://quote.eastmoney.com/hk/${esc(code)}.html`;

      // 当前 Tab 的列数（待上市 4 列 / 次新 6 列），用于空态/加载行 colspan
      const colCount = () => (activeTab === 'upcoming' ? 4 : 6);
      const emptyRow = (msg) => `<tr class="ipohk-empty"><td colspan="${colCount()}">${esc(msg)}</td></tr>`;

      const renderUpcomingHead = () => {
        head.innerHTML = `<tr><th>名称</th><th>板块</th><th>预计上市</th><th>状态</th></tr>`;
      };

      const renderUpcoming = (rows) => {
        const today = hkToday();
        const list = rows.slice(0, MAX_ROWS);
        if (!list.length) {
          body.innerHTML = `<tr class="ipohk-empty"><td colspan="4">暂无待上市新股</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map((r) => {
            const isToday = r.listDate === today;
            const chip = isToday
              ? `<span class="ipohk-chip hot">今日挂牌</span>`
              : `<span class="ipohk-chip">待挂牌</span>`;
            const title = `${r.name} · 预计 ${r.listDate} 上市（招股期/发行价等打新详情暂无免费可跨域数据源）`;
            return `
            <tr data-url="${quoteUrl(r.code)}" title="${esc(title)}">
              <td class="ipohk-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td><span class="ipohk-chip">${esc(r.board)}</span></td>
              <td class="ipohk-num">${esc(r.listDate.slice(5))}</td>
              <td>${chip}</td>
            </tr>`;
          })
          .join('');
      };

      const renderRecentHead = () => {
        head.innerHTML = `<tr><th>#</th><th>名称</th><th>上市日</th><th>现价</th><th>涨跌幅</th><th>成交额</th></tr>`;
      };

      const renderRecent = (rows) => {
        const list = rows.slice(0, MAX_ROWS);
        if (!list.length) {
          body.innerHTML = `<tr class="ipohk-empty"><td colspan="6">暂无数据</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map((r, i) => {
            const cls = dirClass(r.pct);
            const industryChip = r.industry ? ` <span class="ipohk-chip">${esc(r.industry)}</span>` : '';
            const title = `${r.name}${r.industry ? ` · ${r.industry}` : ''} · ${r.listDate} 上市（展示为最新行情，非首日涨跌）`;
            return `
            <tr data-url="${quoteUrl(r.code)}" title="${esc(title)}">
              <td class="ipohk-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="ipohk-name">${esc(r.name)}<i>${esc(r.code)}</i>${industryChip}</td>
              <td class="ipohk-num">${esc(r.listDate.slice(5))}</td>
              <td class="ipohk-num ${cls}">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 3)) : '—'}</td>
              <td class="ipohk-num ${cls}">${esc(fmtSigned(r.pct, 2))}%</td>
              <td class="ipohk-num">${esc(fmtAmt(r.amt))}</td>
            </tr>`;
          })
          .join('');
      };

      const renderTabCounts = (result) => {
        const upEl = tabsEl.querySelector('[data-count="upcoming"]');
        const reEl = tabsEl.querySelector('[data-count="recent"]');
        if (upEl) upEl.textContent = result.upcoming.length ? String(Math.min(result.upcoming.length, MAX_ROWS)) : '';
        if (reEl) reEl.textContent = result.recent.length ? String(Math.min(result.recent.length, MAX_ROWS)) : '';
      };

      const renderError = () => {
        body.innerHTML = emptyRow('数据加载失败，稍后自动重试…');
      };

      const renderTabChrome = () => {
        if (activeTab === 'upcoming') {
          renderUpcomingHead();
          sourceEl.textContent = '东方财富 · 港股待上市（含新挂牌/重新上市，按预计上市日排序）';
        } else {
          renderRecentHead();
          sourceEl.textContent = '东方财富 · 港股次新股（按上市日倒序，最新行情非首日涨跌）';
        }
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
          const result = await fetchList();
          if (!alive) return;
          lastSplit = result;
          delayedEl.textContent = result.delayed ? '（延时行情）' : '';
          renderTabCounts(result);
          // 等待期间用户可能已切换 Tab，过期结果仅用于计数，不渲染表体
          if (tab !== activeTab) return;
          if (tab === 'upcoming') renderUpcoming(result.upcoming);
          else renderRecent(result.recent);
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          if (tab === activeTab) {
            renderError();
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
        tabsEl.querySelectorAll('.ipohk-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        renderTabChrome();
        // 已有拆分数据时直接本地渲染切换，无数据才重新拉取
        if (lastSplit) {
          if (activeTab === 'upcoming') renderUpcoming(lastSplit.upcoming);
          else renderRecent(lastSplit.recent);
          return;
        }
        body.innerHTML = emptyRow('加载中…');
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
