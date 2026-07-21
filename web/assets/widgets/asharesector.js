/* A股板块热度 — 东财板块涨跌榜(CORS JSON)：行业板块/概念板块双 Tab，领涨/领跌排序切换
 * 接口: https://push2.eastmoney.com/api/qt/clist/get （备用 https://push2delay.eastmoney.com 延时行情兜底）
 *   行业板块 fs=m:90+t:2；概念板块 fs=m:90+t:3；fid=f3 按涨跌幅排序，po=1 降序(领涨)/po=0 升序(领跌)
 * 实测 2026-07-16：本机出口访问 push2 返回 502，故必须保留 push2delay 回退；
 *   push2delay 响应 HTTP 200，响应头 access-control-allow-origin: *，行业 total=496 / 概念 total=495。
 *   字段（以实测为准）：f2=板块点位 f3=涨跌幅% f12=板块代码(BKxxxx) f14=板块名
 *   f104=上涨家数 f105=下跌家数 f128=领涨股名称 f136=领涨股涨跌幅% f140=领涨股代码
 *   板块详情页 https://quote.eastmoney.com/bk/90.<板块代码>.html 实测 200。
 * 注意：A股红涨绿跌，方向着色用 asect-up(红)/asect-down(绿)，不使用 --acc/--danger。
 * Registers as custom tool id 'asharesector' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'industry', label: '行业板块', fs: 'm:90+t:2' },
    { id: 'concept', label: '概念板块', fs: 'm:90+t:3' },
  ];
  const LS_TAB_KEY = 'asharesector.tab';
  const LS_PO_KEY = 'asharesector.po';

  const EM_FIELDS = 'f12,f14,f2,f3,f104,f105,f128,f136,f140'; // 代码/名称/点位/涨跌幅%/上涨家数/下跌家数/领涨股/领涨股涨幅%/领涨股代码
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host, tab, po) =>
    `${host}/api/qt/clist/get?pn=1&pz=15&po=${po}&np=1&fltt=2&invt=2` +
    `&fid=f3&fs=${encodeURIComponent(tab.fs)}&fields=${EM_FIELDS}` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('asect-style')) return;
    const style = document.createElement('style');
    style.id = 'asect-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.asect-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .asect-root { --up: #C0442F; --down: #2E7D4F; }
.asect-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.asect-head-right { display: flex; align-items: center; gap: 8px; }
.asect-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.asect-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.asect-status { color: var(--warning); white-space: nowrap; }
.asect-status.live { color: var(--acc); }
.asect-up { color: var(--up); }
.asect-down { color: var(--down); }
.asect-flat { color: var(--text-muted); }
.asect-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.asect-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.asect-tab {
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
  transition: color 0.25s var(--ease-snap), border-color 0.25s var(--ease-snap), background 0.25s var(--ease-snap);
}
.asect-tab:hover { color: var(--text); border-color: var(--hairline-strong); }
.asect-tab.active {
  color: var(--up);
  border-color: var(--up);
  background: color-mix(in srgb, var(--up) 10%, transparent);
  font-weight: 600;
}
.asect-sort {
  appearance: none;
  border: 1px solid var(--hairline);
  background: var(--surface-raised);
  font-size: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 0.06em;
  white-space: nowrap;
  font-family: var(--font-mono);
  transition: color 0.25s var(--ease-snap), border-color 0.25s var(--ease-snap), background 0.25s var(--ease-snap);
}
.asect-sort.desc { color: var(--up); border-color: color-mix(in srgb, var(--up) 45%, var(--hairline)); }
.asect-sort.asc { color: var(--down); border-color: color-mix(in srgb, var(--down) 45%, var(--hairline)); }
.asect-sort:hover { background: var(--surface); }
.asect-table { font-variant-numeric: tabular-nums; }
.asect-table th, .asect-table td { white-space: nowrap; }
.asect-table tbody tr { cursor: pointer; transition: background 0.25s var(--ease-snap); }
.asect-table tbody tr:hover { background: var(--surface-raised); }
.asect-rank { color: var(--text-dim); font-family: var(--font-mono); width: 1%; }
.asect-rank.top { color: var(--up); font-weight: 700; }
.asect-board { font-weight: 600; }
.asect-board i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.asect-lead { font-weight: 600; }
.asect-lead i { font-style: normal; font-family: var(--font-mono); font-weight: 400; font-size: 10px; margin-left: 4px; }
.asect-num { font-family: var(--font-mono); }
.asect-counts { font-family: var(--font-mono); color: var(--text-dim); }
.asect-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.asect-foot {
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
.asect-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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
    if (!Number.isFinite(v) || v === 0) return 'asect-flat';
    return v > 0 ? 'asect-up' : 'asect-down';
  };

  // 北京时间（UTC+8）交易时段：周一至五 09:30-11:30 / 13:00-15:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const day = bj.getDay();
    const mins = bj.getHours() * 60 + bj.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 570 && mins < 690) || (mins >= 780 && mins <= 900)) return 'trading';
    if (mins >= 690 && mins < 780) return 'lunch';
    return 'closed';
  };

  const loadState = (key, valid) => {
    try {
      const v = window.localStorage.getItem(key);
      if (valid(v)) return v;
    } catch (e) { /* localStorage 不可用时用默认 */ }
    return null;
  };
  const saveState = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) { /* 忽略 */ }
  };

  window.GT_EXTRA_TOOLS['asharesector'] = {
    mount(el, setStatus) {
      injectStyle();

      let activeTab = loadState(LS_TAB_KEY, (v) => TABS.some((t) => t.id === v)) || TABS[0].id;
      let activePo = loadState(LS_PO_KEY, (v) => v === '0' || v === '1') || '1'; // 默认降序看领涨板块

      el.innerHTML = `
        <div class="tool asect-root">
          <div class="asect-head">
            <span>A股 · 板块热度</span>
            <span class="asect-head-right">
              <span class="asect-session" data-session>—</span>
              <span class="asect-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="asect-toolbar">
            <div class="asect-tabs" data-tabs>
              ${TABS.map(
                (t) => `<button type="button" class="asect-tab${t.id === activeTab ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
              ).join('')}
            </div>
            <button type="button" class="asect-sort" data-sort title="切换排序方向：领涨/领跌板块"></button>
          </div>
          <table class="data-table asect-table">
            <thead><tr><th>#</th><th>板块</th><th>涨跌幅</th><th>领涨股</th><th>涨/跌家数</th></tr></thead>
            <tbody data-body>
              <tr class="asect-empty"><td colspan="5">加载中…</td></tr>
            </tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="asect-foot">
            <span>来源：东方财富 · 板块行情（点击行查看板块详情）<b data-delayed></b></span>
            <span>更新于 <b data-updated>—</b></span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const tabsEl = el.querySelector('[data-tabs]');
      const sortBtn = el.querySelector('[data-sort]');
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
        conn.className = 'asect-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'asect-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'asect-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'asect-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'asect-session';
        }
        return s;
      };

      const renderSortBtn = () => {
        const desc = activePo === '1';
        sortBtn.textContent = desc ? '领涨 ▲' : '领跌 ▼';
        sortBtn.className = `asect-sort ${desc ? 'desc' : 'asc'}`;
      };

      // 东财板块榜：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchBoard = async (tab, po) => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i], tab, po), { signal: ctrl.signal, cache: 'no-store' });
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
            pct: Number(r.f3),
            upCount: Number(r.f104),
            downCount: Number(r.f105),
            leadName: String(r.f128 || ''),
            leadPct: Number(r.f136),
          }))
          .filter((r) => r.code && Number.isFinite(r.pct))
          .slice(0, 15);
        delayedEl.textContent = result.delayed ? '（延时行情）' : '';
        if (!rows.length) {
          body.innerHTML = `<tr class="asect-empty"><td colspan="5">暂无数据</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r, i) => {
            const cls = dirClass(r.pct);
            const leadCls = dirClass(r.leadPct);
            const url = `https://quote.eastmoney.com/bk/90.${esc(r.code)}.html`;
            const upTxt = Number.isFinite(r.upCount) ? String(r.upCount) : '—';
            const downTxt = Number.isFinite(r.downCount) ? String(r.downCount) : '—';
            return `
            <tr data-url="${url}" title="查看 ${esc(r.name)} 板块详情">
              <td class="asect-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
              <td class="asect-board">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="asect-num ${cls}">${esc(fmtSigned(r.pct, 2))}%</td>
              <td class="asect-lead">${esc(r.leadName || '—')}<i class="${leadCls}">${Number.isFinite(r.leadPct) ? esc(fmtSigned(r.leadPct, 2)) + '%' : ''}</i></td>
              <td class="asect-counts"><span class="asect-up">${esc(upTxt)}</span>/<span class="asect-down">${esc(downTxt)}</span></td>
            </tr>`;
          })
          .join('');
      };

      const renderBoardError = () => {
        delayedEl.textContent = '';
        body.innerHTML = `<tr class="asect-empty"><td colspan="5">榜单加载失败，稍后自动重试…</td></tr>`;
      };

      const stateKey = () => `${activeTab}:${activePo}`;

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
        const reqKey = stateKey();
        const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
        try {
          const result = await fetchBoard(tab, activePo);
          if (!alive) return;
          // 等待期间用户可能已切换 Tab/排序，过期结果直接丢弃
          if (reqKey !== stateKey()) return;
          renderRows(result);
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          if (reqKey === stateKey()) {
            renderBoardError();
            showError('板块榜加载失败，30 秒后自动重试…');
          }
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        const s = renderSession();
        if (document.hidden) return; // 页面不可见时跳过刷新
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      const onTabsClick = (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
        if (!btn) return;
        const id = btn.getAttribute('data-tab');
        if (!id || id === activeTab) return;
        activeTab = id;
        saveState(LS_TAB_KEY, id);
        tabsEl.querySelectorAll('.asect-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === id);
        });
        body.innerHTML = `<tr class="asect-empty"><td colspan="5">加载中…</td></tr>`;
        refreshInFlight = false; // 允许立即发起新 Tab 的请求（旧请求在 refresh 开头被 abort）
        refresh();
      };

      const onSortClick = () => {
        activePo = activePo === '1' ? '0' : '1';
        saveState(LS_PO_KEY, activePo);
        renderSortBtn();
        body.innerHTML = `<tr class="asect-empty"><td colspan="5">加载中…</td></tr>`;
        refreshInFlight = false;
        refresh();
      };

      const onRowClick = (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-url]') : null;
        if (!tr) return;
        const url = tr.getAttribute('data-url');
        if (url) window.open(url, '_blank', 'noopener');
      };

      tabsEl.addEventListener('click', onTabsClick);
      sortBtn.addEventListener('click', onSortClick);
      body.addEventListener('click', onRowClick);

      renderSession();
      renderSortBtn();
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
        sortBtn.removeEventListener('click', onSortClick);
        body.removeEventListener('click', onRowClick);
      };
    },
  };
})();
