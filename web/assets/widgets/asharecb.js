/* A股可转债与新股 — Tab1 可转债行情榜(东财 clist CORS JSON) + Tab2 新股日历(东财 datacenter CORS JSON)
 * 转债榜: https://push2.eastmoney.com/api/qt/clist/get?fs=b:MK0354 （备用 https://push2delay.eastmoney.com 延时行情兜底）
 *   实测 2026-07-16：本机出口访问 push2 返回 502（与 asharehot 一致），push2delay 200 且 access-control-allow-origin: *，
 *   total=322 只转债。字段：f12=转债代码 f14=转债名称 f2=现价 f3=涨跌幅% f6=成交额(元)
 *   f229=正股现价 f230=正股涨跌幅% f232=正股代码 f233=正股市场(1沪/0深) f234=正股名称
 *   （f229/f230 已对照 push2delay stock/get 个股行情核实：300622→15.20/+11.52%、600456→28.51/+1.75%）
 * 新股日历: https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_APP_IPOAPPLY
 *   实测 2026-07-16：浏览器 Origin 下响应 Access-Control-Allow-Origin: *，数据更新至当日；
 *   注意排序列必须是 APPLY_DATE（PUBLIC_START_DATE 不存在，会报 9501）。
 *   字段：SECURITY_CODE=代码 SECURITY_NAME=名称 APPLY_DATE=申购日 LISTING_DATE=上市日
 *   ISSUE_PRICE=发行价 MARKET_TYPE_NEW=板块 INDUSTRY_NAME=行业 LD_CLOSE_CHANGE=上市首日涨幅%
 * 注意：A股红涨绿跌，方向着色用语义令牌 var(--up)=红涨 / var(--down)=绿跌，不使用 --acc/--danger。
 * Registers as custom tool id 'asharecb' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'cb', label: '可转债榜' },
    { id: 'ipo', label: '新股日历' },
  ];
  const LS_TAB_KEY = 'asharecb.tab';

  // —— 可转债榜（东财 clist，沪深可转债市场板块 b:MK0354）——
  const CB_FS = 'b:MK0354';
  const CB_FIELDS = 'f12,f14,f2,f3,f6,f229,f230,f232,f233,f234';
  const CB_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const cbUrl = (host) =>
    `${host}/api/qt/clist/get?pn=1&pz=12&po=1&np=1&fltt=2&invt=2&fid=f3` +
    `&fs=${encodeURIComponent(CB_FS)}&fields=${CB_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`;

  // —— 新股日历（东财 datacenter，按申购日倒序：未来申购 + 近期上市）——
  const IPO_URL =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=APPLY_DATE&sortTypes=-1' +
    '&pageSize=14&pageNumber=1&reportName=RPTA_APP_IPOAPPLY' +
    '&columns=SECURITY_CODE,SECURITY_NAME,APPLY_DATE,LISTING_DATE,ISSUE_PRICE,MARKET_TYPE_NEW,INDUSTRY_NAME,LD_CLOSE_CHANGE' +
    '&source=WEB&client=WEB';

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('acb-style')) return;
    const style = document.createElement('style');
    style.id = 'acb-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.acb-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .acb-root { --up: #C0442F; --down: #2E7D4F; }
.acb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.acb-head-right { display: flex; align-items: center; gap: 8px; }
.acb-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.acb-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.acb-status { color: var(--warning); white-space: nowrap; }
.acb-status.live { color: var(--acc); }
/* A股红涨绿跌：var(--up)=红涨 / var(--down)=绿跌，勿改用 --acc/--danger */
.acb-up { color: var(--up); }
.acb-down { color: var(--down); }
.acb-flat { color: var(--text-muted); }
.acb-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.acb-tab {
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
  transition: color 0.15s var(--ease-fluid), border-color 0.15s var(--ease-fluid), background 0.15s var(--ease-fluid);
}
.acb-tab:hover { color: var(--text); border-color: var(--text-dim); }
.acb-tab.active {
  color: var(--up);
  border-color: var(--up);
  background: color-mix(in srgb, var(--up) 10%, transparent);
  font-weight: 600;
}
.acb-table { font-variant-numeric: tabular-nums; }
.acb-table th, .acb-table td { white-space: nowrap; }
.acb-table tbody tr { cursor: pointer; transition: background 0.12s var(--ease-fluid); }
.acb-table tbody tr:hover { background: var(--surface-raised); }
.acb-rank { color: var(--text-dim); font-family: var(--font-mono); width: 1%; }
.acb-rank.top { color: var(--up); font-weight: 700; }
.acb-name { font-weight: 600; }
.acb-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.acb-ul { color: var(--text-muted); }
.acb-num { font-family: var(--font-mono); }
.acb-chip {
  display: inline-block;
  font-size: 9px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.acb-chip.hot { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.acb-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.acb-foot {
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
.acb-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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

  // 成交额（元）→ 亿/万
  const fmtAmt = (yuan) => {
    if (!Number.isFinite(yuan)) return '—';
    const yi = yuan / 1e8;
    if (Math.abs(yi) >= 1) return `${fmtNum(yi, Math.abs(yi) >= 100 ? 1 : 2)}亿`;
    return `${fmtNum(yuan / 1e4, 0)}万`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'acb-flat';
    return v > 0 ? 'acb-up' : 'acb-down';
  };

  // 北京时间（UTC+8）日期串 YYYY-MM-DD
  const bjToday = () => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const m = String(bj.getMonth() + 1).padStart(2, '0');
    const d = String(bj.getDate()).padStart(2, '0');
    return `${bj.getFullYear()}-${m}-${d}`;
  };

  // 东财行情页市场前缀：6→sh，0/3→sz，4/8/9→bj（其余兜底 sz）；转债 11→sh，12→sz
  const mktOfStock = (code) => {
    const c = String(code).charAt(0);
    if (c === '6') return 'sh';
    if (c === '4' || c === '8' || c === '9') return 'bj';
    return 'sz';
  };
  const mktOfBond = (code) => (String(code).indexOf('11') === 0 ? 'sh' : 'sz');

  // 板块名称缩写
  const boardName = (s) => {
    const v = String(s || '');
    if (v.indexOf('科创') >= 0) return '科创板';
    if (v.indexOf('创业') >= 0) return '创业板';
    if (v.indexOf('北交') >= 0) return '北交所';
    if (v.indexOf('深') >= 0) return '深主板';
    if (v.indexOf('上') >= 0) return '沪主板';
    return v || '—';
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

  window.GT_EXTRA_TOOLS['asharecb'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = loadTabId();

      el.innerHTML = `
        <div class="tool acb-root">
          <div class="acb-head">
            <span>A股 · 可转债与新股</span>
            <span class="acb-head-right">
              <span class="acb-session" data-session>—</span>
              <span class="acb-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="acb-tabs" data-tabs>
            ${TABS.map(
              (t) => `<button type="button" class="acb-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
            ).join('')}
          </div>
          <table class="data-table acb-table">
            <thead data-head></thead>
            <tbody data-body>
              <tr class="acb-empty"><td colspan="6">加载中…</td></tr>
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="acb-foot">
            <span>来源：<span data-source>东方财富</span>（点击行查看详情）<b data-delayed></b></span>
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
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'acb-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'acb-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'acb-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'acb-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'acb-session';
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

      // —— Tab1：可转债行情榜（按涨幅降序）——
      const fetchCb = async () => {
        const { json, delayed } = await fetchJson(CB_HOSTS.map(cbUrl));
        const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
        return { rows: diff, delayed };
      };

      const renderCbHead = () => {
        head.innerHTML = `<tr><th>#</th><th>转债名称</th><th>现价</th><th>涨跌幅</th><th>正股(涨幅)</th><th>成交额</th></tr>`;
      };

      const renderCb = (result) => {
        const rows = result.rows
          .map((r) => ({
            code: String(r.f12 || ''),
            name: String(r.f14 || ''),
            price: r.f2 == null ? NaN : Number(r.f2),
            pct: r.f3 == null ? NaN : Number(r.f3),
            amt: r.f6 == null ? NaN : Number(r.f6),
            ulCode: String(r.f232 || ''),
            ulName: String(r.f234 || ''),
            ulPct: r.f230 == null ? NaN : Number(r.f230),
          }))
          .filter((r) => r.code && Number.isFinite(r.pct))
          .slice(0, 12);
        delayedEl.textContent = result.delayed ? '（延时行情）' : '';
        if (!rows.length) {
          body.innerHTML = `<tr class="acb-empty"><td colspan="6">暂无数据</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r, i) => {
            const cls = dirClass(r.pct);
            const ulCls = dirClass(r.ulPct);
            const url = `https://quote.eastmoney.com/${mktOfBond(r.code)}${esc(r.code)}.html`;
            const ulCell = r.ulName
              ? `<span class="acb-ul">${esc(r.ulName)}</span> <span class="acb-num ${ulCls}">${esc(fmtSigned(r.ulPct, 2))}%</span>`
              : '—';
            return `
            <tr data-url="${url}" title="查看 ${esc(r.name)} 行情详情">
              <td class="acb-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="acb-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="acb-num ${cls}">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 3)) : '—'}</td>
              <td class="acb-num ${cls}">${esc(fmtSigned(r.pct, 2))}%</td>
              <td>${ulCell}</td>
              <td class="acb-num">${esc(fmtAmt(r.amt))}</td>
            </tr>`;
          })
          .join('');
      };

      // —— Tab2：新股日历（按申购日倒序）——
      const fetchIpo = async () => {
        const { json } = await fetchJson([IPO_URL]);
        const data = json && json.result && Array.isArray(json.result.data) ? json.result.data : [];
        return { rows: data, delayed: false };
      };

      const renderIpoHead = () => {
        head.innerHTML = `<tr><th>名称</th><th>板块</th><th>申购日</th><th>上市日</th><th>发行价</th><th>首日涨幅</th></tr>`;
      };

      // 状态：今日申购 > 待申购 > 今日上市 > 待上市 > 已上市；col 标记 chip 展示在哪一列
      const ipoState = (r, today) => {
        if (r.applyDate && r.applyDate === today) return { chip: '今日申购', hot: true, col: 'apply' };
        if (r.applyDate && r.applyDate > today) return { chip: '待申购', hot: false, col: 'apply' };
        if (r.listDate && r.listDate === today) return { chip: '今日上市', hot: true, col: 'list' };
        if (!r.listDate || r.listDate > today) return { chip: '待上市', hot: false, col: 'list' };
        return { chip: '', hot: false, col: '' };
      };

      const renderIpo = (result) => {
        const today = bjToday();
        const rows = result.rows
          .map((r) => ({
            code: String(r.SECURITY_CODE || ''),
            name: String(r.SECURITY_NAME || ''),
            board: boardName(r.MARKET_TYPE_NEW),
            industry: String(r.INDUSTRY_NAME || ''),
            applyDate: r.APPLY_DATE ? String(r.APPLY_DATE).slice(0, 10) : '',
            listDate: r.LISTING_DATE ? String(r.LISTING_DATE).slice(0, 10) : '',
            price: r.ISSUE_PRICE == null ? NaN : Number(r.ISSUE_PRICE), // null→NaN，避免 Number(null)=0 误显 0.00
            firstPct: r.LD_CLOSE_CHANGE == null ? NaN : Number(r.LD_CLOSE_CHANGE),
          }))
          .filter((r) => r.code && r.name);
        delayedEl.textContent = '';
        if (!rows.length) {
          body.innerHTML = `<tr class="acb-empty"><td colspan="6">暂无数据</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r) => {
            const st = ipoState(r, today);
            const listed = st.chip === '' || st.chip === '今日上市';
            const pctCls = dirClass(r.firstPct);
            const url = `https://quote.eastmoney.com/${mktOfStock(r.code)}${esc(r.code)}.html`;
            const title = r.industry ? `${r.name} · ${r.industry}` : r.name;
            const chipHtml = (col) =>
              st.chip && st.col === col ? ` <span class="acb-chip${st.hot ? ' hot' : ''}">${esc(st.chip)}</span>` : '';
            return `
            <tr data-url="${url}" title="${esc(title)}">
              <td class="acb-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td><span class="acb-chip">${esc(r.board)}</span></td>
              <td class="acb-num">${esc(r.applyDate ? r.applyDate.slice(5) : '—')}${chipHtml('apply')}</td>
              <td class="acb-num">${esc(r.listDate ? r.listDate.slice(5) : '—')}${chipHtml('list')}</td>
              <td class="acb-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="acb-num ${listed ? pctCls : ''}">${listed && Number.isFinite(r.firstPct) ? esc(fmtSigned(r.firstPct, 2)) + '%' : '—'}</td>
            </tr>`;
          })
          .join('');
      };

      const renderError = () => {
        delayedEl.textContent = '';
        body.innerHTML = `<tr class="acb-empty"><td colspan="6">数据加载失败，稍后自动重试…</td></tr>`;
      };

      const renderTabChrome = () => {
        if (activeTab === 'ipo') {
          renderIpoHead();
          sourceEl.textContent = '东方财富 · 新股申购日历';
        } else {
          renderCbHead();
          sourceEl.textContent = '东方财富 · 沪深可转债市场（按涨幅排序）';
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
          const result = tab === 'ipo' ? await fetchIpo() : await fetchCb();
          if (!alive) return;
          // 等待期间用户可能已切换 Tab，过期结果直接丢弃
          if (tab !== activeTab) return;
          if (tab === 'ipo') renderIpo(result);
          else renderCb(result);
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
        tabsEl.querySelectorAll('.acb-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        renderTabChrome();
        body.innerHTML = `<tr class="acb-empty"><td colspan="6">加载中…</td></tr>`;
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
