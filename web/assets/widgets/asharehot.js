/* A股多维榜单 — 东财 clist 行情榜(CORS JSON)：涨幅/跌幅/换手/成交额四个 Tab
 * 接口: https://push2.eastmoney.com/api/qt/clist/get （备用 https://push2delay.eastmoney.com 延时行情兜底）
 * 实测 2026-07：push2delay 响应头 access-control-allow-origin: *，字段 f2=现价 f3=涨跌幅% f6=成交额(元)
 *   f8=换手率% f12=代码 f14=名称 f20=总市值；本机出口访问 push2 返回 502，故必须保留 push2delay 回退。
 * 注意：A股红涨绿跌，方向着色用 ahot-up(--up)/ahot-down(--down)，不使用 --acc/--danger。
 * Registers as custom tool id 'asharehot' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'up', label: '涨幅榜', fid: 'f3', po: 1 },
    { id: 'down', label: '跌幅榜', fid: 'f3', po: 0 },
    { id: 'turnover', label: '换手榜', fid: 'f8', po: 1 },
    { id: 'amount', label: '成交额榜', fid: 'f6', po: 1 },
  ];
  const LS_TAB_KEY = 'asharehot.tab';

  const EM_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 沪深A股
  const EM_FIELDS = 'f12,f14,f2,f3,f6,f8,f20'; // 代码/名称/现价/涨跌幅%/成交额(元)/换手率%/总市值
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host, tab) =>
    `${host}/api/qt/clist/get?pn=1&pz=15&po=${tab.po}&np=1&fltt=2&invt=2` +
    `&fid=${tab.fid}&fs=${encodeURIComponent(EM_FS)}&fields=${EM_FIELDS}` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('ahot-style')) return;
    const style = document.createElement('style');
    style.id = 'ahot-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.ahot-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .ahot-root { --up: #C0442F; --down: #2E7D4F; }
.ahot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.ahot-head-right { display: flex; align-items: center; gap: 8px; }
.ahot-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ahot-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.ahot-status { color: var(--warning); white-space: nowrap; }
.ahot-status.live { color: var(--acc); }
/* A股红涨绿跌：--up=红=涨，--down=绿=跌 */
.ahot-up { color: var(--up); }
.ahot-down { color: var(--down); }
.ahot-flat { color: var(--text-muted); }
.ahot-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ahot-tab {
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
.ahot-tab:hover { color: var(--text); border-color: var(--text-dim); }
.ahot-tab.active {
  color: var(--up);
  border-color: var(--up);
  background: color-mix(in srgb, var(--up) 10%, transparent);
  font-weight: 600;
}
.ahot-table { font-variant-numeric: tabular-nums; }
.ahot-table th, .ahot-table td { white-space: nowrap; }
.ahot-table tbody tr { cursor: pointer; transition: background 0.15s var(--ease-fluid); }
.ahot-table tbody tr:hover { background: var(--surface-raised); }
.ahot-rank { color: var(--text-dim); font-family: var(--font-mono); width: 1%; }
.ahot-rank.top { color: var(--up); font-weight: 700; }
.ahot-stock { font-weight: 600; }
.ahot-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.ahot-num { font-family: var(--font-mono); }
.ahot-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ahot-foot {
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
.ahot-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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
    if (!Number.isFinite(v) || v === 0) return 'ahot-flat';
    return v > 0 ? 'ahot-up' : 'ahot-down';
  };

  // 东财行情页市场前缀：6→sh，0/3→sz，4/8/9→bj（其余兜底 sz）
  const mktOf = (code) => {
    const c = String(code).charAt(0);
    if (c === '6') return 'sh';
    if (c === '4' || c === '8' || c === '9') return 'bj';
    return 'sz';
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

  window.GT_EXTRA_TOOLS['asharehot'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = loadTabId();

      el.innerHTML = `
        <div class="tool ahot-root">
          <div class="ahot-head">
            <span>A股 · 多维榜单</span>
            <span class="ahot-head-right">
              <span class="ahot-session" data-session>—</span>
              <span class="ahot-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="ahot-tabs" data-tabs>
            ${TABS.map(
              (t) => `<button type="button" class="ahot-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
            ).join('')}
          </div>
          <table class="data-table ahot-table">
            <thead><tr><th>#</th><th>名称</th><th>现价</th><th>涨跌幅</th><th>换手率</th><th>成交额</th></tr></thead>
            <tbody data-body>
              <tr class="ahot-empty"><td colspan="6">加载中…</td></tr>
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="ahot-foot">
            <span>来源：东方财富 · 沪深A股（点击行查看行情详情）<b data-delayed></b></span>
            <span>更新于 <b data-updated>—</b></span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const tabsEl = el.querySelector('[data-tabs]');
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
        conn.className = 'ahot-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ahot-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'ahot-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'ahot-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'ahot-session';
        }
        return s;
      };

      // 东财榜单：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchBoard = async (tab) => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i], tab), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('board error');
      };

      const renderRows = (result) => {
        const rows = result.rows
          .map((r) => ({
            code: String(r.f12 || ''),
            name: String(r.f14 || ''),
            price: Number(r.f2),
            pct: Number(r.f3),
            amt: Number(r.f6),
            turnover: Number(r.f8),
          }))
          .filter((r) => r.code && Number.isFinite(r.pct))
          .slice(0, 15);
        delayedEl.textContent = result.delayed ? '（延时行情）' : '';
        if (!rows.length) {
          body.innerHTML = `<tr class="ahot-empty"><td colspan="6">暂无数据</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r, i) => {
            const cls = dirClass(r.pct);
            const url = `https://quote.eastmoney.com/${mktOf(r.code)}${esc(r.code)}.html`;
            return `
            <tr data-url="${url}" title="查看 ${esc(r.name)} 行情详情">
              <td class="ahot-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="ahot-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="ahot-num ${cls}">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="ahot-num ${cls}">${esc(fmtSigned(r.pct, 2))}%</td>
              <td class="ahot-num">${Number.isFinite(r.turnover) ? esc(fmtNum(r.turnover, 2)) + '%' : '—'}</td>
              <td class="ahot-num">${esc(fmtAmt(r.amt))}</td>
            </tr>`;
          })
          .join('');
      };

      const renderBoardError = () => {
        delayedEl.textContent = '';
        body.innerHTML = `<tr class="ahot-empty"><td colspan="6">榜单加载失败，稍后自动重试…</td></tr>`;
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
        const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
        try {
          const result = await fetchBoard(tab);
          if (!alive) return;
          // 等待期间用户可能已切换 Tab，过期结果直接丢弃
          if (tab.id !== activeTab) return;
          renderRows(result);
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          if (tab.id === activeTab) {
            renderBoardError();
            showError('榜单加载失败，30 秒后自动重试…');
          }
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
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
        tabsEl.querySelectorAll('.ahot-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        body.innerHTML = `<tr class="ahot-empty"><td colspan="6">加载中…</td></tr>`;
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
