/* A股分红与高股息 — 高股息榜 + 除权除息日历
 * 接口（均已 curl 实测 2026-07-16）：
 * ① 高股息榜 / 除息日历: https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET
 *    带 Origin 请求头时响应 Access-Control-Allow-Origin: *（浏览器跨域 fetch 可用）。
 *    字段: SECURITY_CODE=代码 SECURITY_NAME_ABBR=名称 PRETAX_BONUS_RMB=每10股派现(元,税前)
 *          DIVIDENT_RATIO=股息率(小数,每股派现/股价,注意官方字段名拼写即 DIVIDENT)
 *          EX_DIVIDEND_DATE=除权除息日 EQUITY_RECORD_DATE=股权登记日
 *          IMPL_PLAN_PROFILE=分配方案文字 REPORT_DATE=报告期 ASSIGN_PROGRESS=进度。
 *    Tab1 高股息榜: filter=(REPORT_DATE='<上年>-12-31') 按 DIVIDENT_RATIO 降序 TOP 15
 *      （仅最近年度分红方案，不含中期/特别分红，见页脚注明）；
 *      再用实时价重算股息率 = 每10股派现/10/最新价，行情失败时回退报表 DIVIDENT_RATIO。
 *    Tab2 除息日历: filter=(EX_DIVIDEND_DATE>='<今日>') 按除息日升序，倒计时 ≤3 天高亮。
 * ② 实时行情（高股息榜现价/涨跌幅/股息率重算）: /api/qt/ulist.np/get?secids=...
 *    fields: f12=代码 f2=最新价 f3=涨跌幅%。secid 前缀：沪市 1.，深市/北交所 0.。
 *    实测当日 push2.eastmoney.com 主站 502，push2delay.eastmoney.com 正常（CORS OK），
 *    保留 push2→push2delay 双 host 兜底（同 ashareboard/asharecapital 模式）。
 *    另：东财 clist 行情接口实测无股息率字段（f1~f130 抽样比对神华/工行/寒武纪等均不符），
 *    故股息率取自 datacenter 分红报表而非行情接口。
 * 配色：方向着色令牌化 dvd-up=var(--up) / dvd-down=var(--down)（A股 涨=up 跌=down，
 * 只换令牌不翻转语义）；会话/Tab/热榜等强调态统一用品牌 --acc 系，不使用 --danger。
 * Registers as custom tool id 'dividend' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DC_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const BONUS_COLS =
    'SECURITY_CODE,SECURITY_NAME_ABBR,PRETAX_BONUS_RMB,DIVIDENT_RATIO,' +
    'EX_DIVIDEND_DATE,EQUITY_RECORD_DATE,IMPL_PLAN_PROFILE,ASSIGN_PROGRESS';
  // 高股息榜：最近年度分红方案，按股息率降序
  const topUrl = (reportDate) =>
    `${DC_BASE}?reportName=RPT_SHAREBONUS_DET&columns=${BONUS_COLS}` +
    `&filter=(REPORT_DATE%3D%27${reportDate}%27)&pageNumber=1&pageSize=15` +
    `&sortColumns=DIVIDENT_RATIO&sortTypes=-1&source=WEB&client=WEB`;
  // 除息日历：今日起未来除权除息，按日期升序
  const calUrl = (today) =>
    `${DC_BASE}?reportName=RPT_SHAREBONUS_DET&columns=${BONUS_COLS}` +
    `&filter=(EX_DIVIDEND_DATE%3E%3D%27${today}%27)&pageNumber=1&pageSize=30` +
    `&sortColumns=EX_DIVIDEND_DATE&sortTypes=1&source=WEB&client=WEB`;

  const QUOTE_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const quoteUrl = (host, secids) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f2,f3&secids=${secids}`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const FETCH_TIMEOUT_MS = 10000;
  const SOON_DAYS = 3; // 距除息 ≤N 天高亮

  const TABS = [
    { id: 'top', label: '高股息榜' },
    { id: 'calendar', label: '除息日历' },
  ];

  function injectStyle() {
    if (document.getElementById('dvd-style')) return;
    const style = document.createElement('style');
    style.id = 'dvd-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.dvd-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .dvd-root { --up: #C0442F; --down: #2E7D4F; }
.dvd-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.dvd-head-right { display: flex; align-items: center; gap: 8px; }
.dvd-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.dvd-session.open { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
.dvd-status { color: var(--warning); white-space: nowrap; }
.dvd-status.live { color: var(--acc); }
/* 方向着色令牌化：A股 涨=--up 跌=--down，勿改用 --acc/--danger */
.dvd-up { color: var(--up); }
.dvd-down { color: var(--down); }
.dvd-flat { color: var(--text-muted); }
.dvd-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.dvd-tab {
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
.dvd-tab:hover { color: var(--text); border-color: var(--text-dim); }
.dvd-tab.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
  font-weight: 600;
}
.dvd-table { font-variant-numeric: tabular-nums; table-layout: fixed; width: 100%; }
.dvd-table th, .dvd-table td { white-space: nowrap; }
.dvd-table tbody tr { cursor: pointer; transition: background 0.18s var(--ease-fluid); }
.dvd-table tbody tr:hover { background: var(--surface-raised); }
.dvd-rank { color: var(--text-dim); font-family: var(--font-mono); width: 1%; }
.dvd-rank.top { color: var(--acc); font-weight: 700; }
.dvd-stock { font-weight: 600; }
.dvd-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.dvd-num { font-family: var(--font-mono); }
.dvd-yield { font-family: var(--font-mono); color: var(--acc); font-weight: 700; }
.dvd-plan { max-width: 150px; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); }
.dvd-date { font-family: var(--font-mono); color: var(--text-muted); }
.dvd-soon td { background: var(--acc-glow); }
.dvd-soon td:first-child { box-shadow: inset 2px 0 0 var(--acc); }
.dvd-badge {
  display: inline-block;
  font-size: 9px;
  font-family: var(--font-mono);
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: var(--acc-glow);
  color: var(--text-muted);
  white-space: nowrap;
}
.dvd-badge.hot { color: var(--acc); border-color: var(--acc-dim); font-weight: 700; }
.dvd-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.dvd-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.dvd-foot b { font-weight: 400; color: var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const pad2 = (n) => String(n).padStart(2, '0');

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  // A股涨跌着色：红涨绿跌
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'dvd-flat';
    return v > 0 ? 'dvd-up' : 'dvd-down';
  };

  const dateOnly = (s) => String(s || '').slice(0, 10);

  // 北京时间（UTC+8）：用本地 getter 读取即为北京墙钟时间
  const bjNow = () => {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
  };

  const bjTodayStr = () => {
    const bj = bjNow();
    return `${bj.getFullYear()}-${pad2(bj.getMonth() + 1)}-${pad2(bj.getDate())}`;
  };

  // 最近年度分红报告期：上一年度年报
  const annualReportDate = () => `${bjNow().getFullYear() - 1}-12-31`;

  // 距除息天数（按北京时间自然日，0=今日）
  const daysToEx = (exDateStr) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(exDateStr || ''));
    if (!m) return NaN;
    const bj = bjNow();
    const todayUtc = Date.UTC(bj.getFullYear(), bj.getMonth(), bj.getDate());
    const exUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Math.round((exUtc - todayUtc) / 86400000);
  };

  // 行情 secid 前缀：沪市 1.，深市/北交所 0.（北交所老代码 8xx 已切换 920xxx，少数无行情时降级展示）
  const secidOf = (code) => (String(code).charAt(0) === '6' ? '1.' : '0.') + String(code);

  const mktOf = (code) => {
    const c = String(code).charAt(0);
    if (c === '6') return 'sh';
    if (c === '4' || c === '8' || c === '9') return 'bj';
    return 'sz';
  };

  // 北京时间交易时段：周一至五 09:15-11:30 / 13:00-15:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const bj = bjNow();
    const day = bj.getDay();
    const mins = bj.getHours() * 60 + bj.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 555 && mins < 690) || (mins >= 780 && mins <= 900)) return 'trading';
    if (mins >= 690 && mins < 780) return 'lunch';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['dividend'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = 'top';

      el.innerHTML = `
        <div class="tool dvd-root">
          <div class="dvd-head">
            <span>A股 · 分红与高股息</span>
            <span class="dvd-head-right">
              <span class="dvd-session" data-session>—</span>
              <span class="dvd-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="dvd-tabs" data-tabs>
            ${TABS.map(
              (t) => `<button type="button" class="dvd-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
            ).join('')}
          </div>
          <table class="data-table dvd-table">
            <thead data-head-row></thead>
            <tbody data-body>
              <tr class="dvd-empty"><td colspan="7">加载中…</td></tr>
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="dvd-foot">
            <span>来源：东方财富 · 分红实施报表（税前口径，仅最近年度方案，未含中期分红）<b data-note></b></span>
            <span>更新于 <b data-updated>—</b></span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const tabsEl = el.querySelector('[data-tabs]');
      const headRow = el.querySelector('[data-head-row]');
      const body = el.querySelector('[data-body]');
      const noteEl = el.querySelector('[data-note]');
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
        conn.className = 'dvd-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'dvd-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'dvd-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'dvd-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'dvd-session';
        }
        return s;
      };

      // 带超时的 JSON fetch（controller/timer 纳入 cleanup 管理）
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

      // datacenter-web：取 result.data 数组
      const fetchDcRows = async (url) => {
        const json = await fetchJson(url);
        const rows = json && json.result && Array.isArray(json.result.data) ? json.result.data : [];
        if (!rows.length) throw new Error('empty');
        return { rows, count: Number(json.result.count) || rows.length };
      };

      // 实时行情：push2 失败时回退 push2delay（延时行情）；整体失败返回 null（降级展示）
      const fetchQuotes = async (codes) => {
        const secids = codes.map(secidOf).join(',');
        for (let i = 0; i < QUOTE_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          try {
            const json = await fetchJson(quoteUrl(QUOTE_HOSTS[i], secids));
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            const map = {};
            diff.forEach((q) => {
              map[String(q.f12)] = { price: Number(q.f2), pct: Number(q.f3) };
            });
            return { map, delayed: i > 0 };
          } catch (e) { /* 尝试下一 host */ }
        }
        return null;
      };

      const renderHead = (cols) => {
        headRow.innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
      };

      const rowUrl = (code) => `https://quote.eastmoney.com/${mktOf(code)}${esc(code)}.html`;

      // Tab1 高股息榜
      const renderTop = (rows, quotes) => {
        renderHead(['#', '名称', '现价', '涨跌幅', '股息率', '分配方案', '除息日']);
        const list = rows
          .map((r) => {
            const code = String(r.SECURITY_CODE || '');
            const q = quotes && quotes.map ? quotes.map[code] : null;
            const price = q && Number.isFinite(q.price) ? q.price : NaN;
            const pct = q && Number.isFinite(q.pct) ? q.pct : NaN;
            const bonus10 = Number(r.PRETAX_BONUS_RMB); // 每10股派现(元,税前)
            // 有实时价则重算股息率，否则回退报表值（小数→%）
            const ratio = Number(r.DIVIDENT_RATIO);
            const yieldPct = Number.isFinite(bonus10) && Number.isFinite(price) && price > 0
              ? (bonus10 / 10 / price) * 100
              : Number.isFinite(ratio)
                ? ratio * 100
                : NaN;
            return {
              code,
              name: String(r.SECURITY_NAME_ABBR || ''),
              price,
              pct,
              yieldPct,
              plan: String(r.IMPL_PLAN_PROFILE || ''),
              exDate: dateOnly(r.EX_DIVIDEND_DATE),
            };
          })
          .filter((r) => r.code && Number.isFinite(r.yieldPct) && r.yieldPct > 0)
          .slice(0, 15);
        noteEl.textContent = quotes
          ? `股息率=每股派现/最新价${quotes.delayed ? ' · 延时行情' : ''}`
          : '行情不可用，股息率为报表值';
        if (!list.length) {
          body.innerHTML = `<tr class="dvd-empty"><td colspan="7">暂无数据</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map((r, i) => {
            const cls = dirClass(r.pct);
            return `
            <tr data-url="${rowUrl(r.code)}" title="查看 ${esc(r.name)} 行情详情">
              <td class="dvd-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="dvd-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="dvd-num ${cls}">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="dvd-num ${cls}">${Number.isFinite(r.pct) ? esc(fmtSigned(r.pct, 2)) + '%' : '—'}</td>
              <td class="dvd-yield">${esc(fmtNum(r.yieldPct, 2))}%</td>
              <td class="dvd-plan" title="${esc(r.plan)}">${esc(r.plan || '—')}</td>
              <td class="dvd-date">${esc(r.exDate ? r.exDate.slice(5) : '—')}</td>
            </tr>`;
          })
          .join('');
      };

      // Tab2 除权除息日历
      const renderCalendar = (rows, total) => {
        renderHead(['除息日', '名称', '分配方案', '股息率', '登记日', '进度', '倒计时']);
        const list = rows
          .map((r) => ({
            code: String(r.SECURITY_CODE || ''),
            name: String(r.SECURITY_NAME_ABBR || ''),
            exDate: dateOnly(r.EX_DIVIDEND_DATE),
            recordDate: dateOnly(r.EQUITY_RECORD_DATE),
            plan: String(r.IMPL_PLAN_PROFILE || ''),
            progress: String(r.ASSIGN_PROGRESS || ''),
            ratio: Number(r.DIVIDENT_RATIO),
            days: daysToEx(r.EX_DIVIDEND_DATE),
          }))
          .filter((r) => r.code && r.exDate)
          .slice(0, 20);
        noteEl.textContent = `未来共 ${total} 只待除息，按除息日升序`;
        if (!list.length) {
          body.innerHTML = `<tr class="dvd-empty"><td colspan="7">近期暂无除权除息</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map((r) => {
            const soon = Number.isFinite(r.days) && r.days <= SOON_DAYS;
            const dayLabel = !Number.isFinite(r.days)
              ? '—'
              : r.days === 0
                ? '今日除息'
                : `${r.days} 天`;
            return `
            <tr class="${soon ? 'dvd-soon' : ''}" data-url="${rowUrl(r.code)}" title="查看 ${esc(r.name)} 行情详情">
              <td class="dvd-date">${esc(r.exDate.slice(5))}</td>
              <td class="dvd-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="dvd-plan" title="${esc(r.plan)}">${esc(r.plan || '—')}</td>
              <td class="dvd-yield">${Number.isFinite(r.ratio) ? esc(fmtNum(r.ratio * 100, 2)) + '%' : '—'}</td>
              <td class="dvd-date">${esc(r.recordDate ? r.recordDate.slice(5) : '—')}</td>
              <td class="dvd-plan" title="${esc(r.progress)}">${esc(r.progress || '—')}</td>
              <td><span class="dvd-badge${soon ? ' hot' : ''}">${esc(dayLabel)}</span></td>
            </tr>`;
          })
          .join('');
      };

      const renderErrorRow = (colspan) => {
        noteEl.textContent = '';
        body.innerHTML = `<tr class="dvd-empty"><td colspan="${colspan}">加载失败，稍后自动重试…</td></tr>`;
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
          if (tab === 'top') {
            const res = await fetchDcRows(topUrl(annualReportDate()));
            if (!alive || tab !== activeTab) return;
            const codes = [...new Set(res.rows.map((r) => String(r.SECURITY_CODE || '')).filter(Boolean))];
            const quotes = await fetchQuotes(codes).catch(() => null);
            if (!alive || tab !== activeTab) return;
            renderTop(res.rows, quotes);
          } else {
            const res = await fetchDcRows(calUrl(bjTodayStr()));
            if (!alive || tab !== activeTab) return;
            renderCalendar(res.rows, res.count);
          }
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          if (tab === activeTab) {
            renderErrorRow(7);
            showError('数据加载失败，30 秒后自动重试…');
          }
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return;
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      const onTabsClick = (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
        if (!btn) return;
        const id = btn.getAttribute('data-tab');
        if (!id || id === activeTab) return;
        activeTab = id;
        tabsEl.querySelectorAll('.dvd-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        body.innerHTML = `<tr class="dvd-empty"><td colspan="7">加载中…</td></tr>`;
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
