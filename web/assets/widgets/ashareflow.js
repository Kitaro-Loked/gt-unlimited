/* A股资金流向榜 — 东财 clist 主力净流入/流出榜(CORS JSON)
 * 接口: https://push2.eastmoney.com/api/qt/clist/get （失败时回退 push2delay 延时行情）
 * 实测 2026-07：两 host 响应头均带 Access-Control-Allow-Origin: *；
 *   行业板块 fs=m:90+t:2，个股 fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23；
 *   f12=代码 f14=名称 f2=最新价 f3=涨跌幅% f62=主力净流入额(元) f184=主力净占比%；
 *   fid=f62 排序，po=1 净流入榜 / po=0 净流出榜。
 * 注意：A股红涨绿跌，方向着色用 aflow-up(--up)/aflow-down(--down)，不使用 --acc/--danger。
 * Registers as custom tool id 'ashareflow' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const EM_COMMON = 'pn=1&pz=25&np=1&fltt=2&invt=2&ut=bd1d9ddb04089700cf9c27f6f7426281&fid=f62';
  const TABS = [
    { key: 'industry', label: '行业板块', fs: 'm:90+t:2', fields: 'f12,f14,f3,f62,f184' },
    { key: 'stock', label: '个股', fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23', fields: 'f12,f14,f2,f3,f62,f184' },
  ];
  const DIRS = [
    { po: 1, label: '净流入' },
    { po: 0, label: '净流出' },
  ];
  const emUrl = (host, tab, po) =>
    `${host}/api/qt/clist/get?${EM_COMMON}&po=${po}&fs=${encodeURIComponent(tab.fs)}&fields=${tab.fields}`;

  const REFRESH_MS = 60000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('aflow-style')) return;
    const style = document.createElement('style');
    style.id = 'aflow-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.aflow-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .aflow-root { --up: #C0442F; --down: #2E7D4F; }
.aflow-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.aflow-head-right { display: flex; align-items: center; gap: 8px; }
.aflow-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.aflow-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.aflow-status { color: var(--warning); white-space: nowrap; }
.aflow-status.live { color: var(--acc); }
/* A股红涨绿跌：--up=红=涨，--down=绿=跌 */
.aflow-up { color: var(--up); }
.aflow-down { color: var(--down); }
.aflow-flat { color: var(--text-muted); }
.aflow-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.aflow-seg { display: inline-flex; border: 1px solid var(--hairline); border-radius: var(--radius-sm); overflow: hidden; }
.aflow-seg button {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  padding: 4px 12px;
  cursor: pointer;
  letter-spacing: 0.06em;
  white-space: nowrap;
  transition: color 0.25s var(--ease-fluid), background 0.25s var(--ease-fluid);
}
.aflow-seg button + button { border-left: 1px solid var(--hairline); }
.aflow-seg button.active { background: var(--surface-raised); color: var(--text); font-weight: 600; }
.aflow-list { flex: 1; min-height: 0; overflow-y: auto; }
.aflow-table { font-variant-numeric: tabular-nums; width: 100%; }
.aflow-table th, .aflow-table td { white-space: nowrap; }
.aflow-table tbody tr { cursor: pointer; }
.aflow-table tbody td { transition: background 0.2s var(--ease-fluid); }
.aflow-table tbody tr:hover td { background: var(--surface-raised); }
.aflow-num { font-family: var(--font-mono); }
.aflow-rank { color: var(--text-dim); font-family: var(--font-mono); width: 22px; }
.aflow-name { font-weight: 600; }
.aflow-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.aflow-ratio { display: flex; align-items: center; gap: 6px; }
.aflow-bar {
  position: relative;
  width: 44px;
  height: 4px;
  border-radius: 2px;
  background: var(--hairline);
  overflow: hidden;
  flex: none;
}
.aflow-bar i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: block;
  border-radius: 2px;
}
.aflow-bar i.pos { background: var(--up); }
.aflow-bar i.neg { background: var(--down); }
.aflow-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 16px 4px;
}
.aflow-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
  flex-wrap: wrap;
}
.aflow-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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

  // 金额（元）→ 亿/万，保留正负号
  const fmtMoney = (yuan) => {
    if (!Number.isFinite(yuan)) return '—';
    const sign = yuan > 0 ? '+' : yuan < 0 ? '-' : '';
    const abs = Math.abs(yuan);
    if (abs >= 1e8) return `${sign}${fmtNum(abs / 1e8, 2)}亿`;
    if (abs >= 1e4) return `${sign}${fmtNum(abs / 1e4, 0)}万`;
    return `${sign}${fmtNum(abs, 0)}`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'aflow-flat';
    return v > 0 ? 'aflow-up' : 'aflow-down';
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

  // 个股详情页：6→sh，0/3→sz，4/8/9→bj
  const stockUrl = (code) => {
    const c = String(code || '');
    let mkt = '';
    if (c[0] === '6') mkt = 'sh';
    else if (c[0] === '0' || c[0] === '3') mkt = 'sz';
    else if (c[0] === '4' || c[0] === '8' || c[0] === '9') mkt = 'bj';
    return mkt ? `https://quote.eastmoney.com/${mkt}${c}.html` : '';
  };

  const boardUrl = (code) => `https://quote.eastmoney.com/bk/90.${String(code || '')}.html`;

  window.GT_EXTRA_TOOLS['ashareflow'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool aflow-root">
          <div class="aflow-head">
            <span>A股 · 资金流向榜</span>
            <span class="aflow-head-right">
              <span class="aflow-session" data-session>—</span>
              <span class="aflow-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="aflow-toolbar">
            <span class="aflow-seg" data-tabs>
              ${TABS.map((t, i) => `<button type="button" data-tab="${esc(t.key)}" class="${i === 0 ? 'active' : ''}">${esc(t.label)}</button>`).join('')}
            </span>
            <span class="aflow-seg" data-dirs>
              ${DIRS.map((d, i) => `<button type="button" data-po="${d.po}" class="${i === 0 ? 'active' : ''}">${esc(d.label)}</button>`).join('')}
            </span>
          </div>
          <div class="aflow-list">
            <table class="data-table aflow-table">
              <thead data-thead></thead>
              <tbody data-tbody></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="aflow-foot">
            <span>来源：东方财富 · 主力资金流（clist）<b data-delayed></b></span>
            <span>更新 <b data-time>—</b></span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const thead = el.querySelector('[data-thead]');
      const tbody = el.querySelector('[data-tbody]');
      const timeEl = el.querySelector('[data-time]');
      const delayedEl = el.querySelector('[data-delayed]');
      const tabsEl = el.querySelector('[data-tabs]');
      const dirsEl = el.querySelector('[data-dirs]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let needRefresh = true; // 切 Tab/方向后立即刷新
      let lastFetchAt = 0;
      let curTab = TABS[0];
      let curPo = DIRS[0].po;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'aflow-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'aflow-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'aflow-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'aflow-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'aflow-session';
        }
        return s;
      };

      // 东财榜单：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchFlow = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i], curTab, curPo), { signal: ctrl.signal, cache: 'no-store' });
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
        throw lastErr || new Error('flow error');
      };

      const renderHead = () => {
        const cols =
          curTab.key === 'stock'
            ? ['#', '名称', '最新价', '涨跌幅', '主力净流入', '净占比']
            : ['#', '名称', '涨跌幅', '主力净流入', '净占比'];
        thead.innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
      };

      const renderRows = (result) => {
        const isStock = curTab.key === 'stock';
        const rows = result.rows
          .map((r) => ({
            code: String(r.f12 || ''),
            name: String(r.f14 || ''),
            price: Number(r.f2),
            pct: Number(r.f3),
            flow: Number(r.f62), // 主力净流入额（元）
            ratio: Number(r.f184), // 主力净占比 %
          }))
          .filter((r) => r.code && Number.isFinite(r.flow));
        delayedEl.textContent = result.delayed ? '（延时行情）' : '';
        if (!rows.length) {
          tbody.innerHTML = `<tr class="aflow-empty"><td colspan="${isStock ? 6 : 5}">暂无数据</td></tr>`;
          return;
        }
        const maxRatio = rows.reduce((m, r) => Math.max(m, Math.abs(r.ratio) || 0), 0) || 1;
        tbody.innerHTML = rows
          .map((r, i) => {
            const url = isStock ? stockUrl(r.code) : boardUrl(r.code);
            const flowCls = dirClass(r.flow);
            const barCls = r.flow > 0 ? 'pos' : 'neg';
            const barW = Math.max(2, Math.min(100, (Math.abs(r.ratio) / maxRatio) * 100));
            const ratioTxt = Number.isFinite(r.ratio) ? `${fmtNum(r.ratio, 2)}%` : '—';
            const cells = [
              `<td class="aflow-rank">${i + 1}</td>`,
              `<td class="aflow-name">${esc(r.name)}<i>${esc(r.code)}</i></td>`,
            ];
            if (isStock) cells.push(`<td class="aflow-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>`);
            cells.push(`<td class="aflow-num ${dirClass(r.pct)}">${Number.isFinite(r.pct) ? esc(fmtSigned(r.pct, 2)) + '%' : '—'}</td>`);
            cells.push(`<td class="aflow-num ${flowCls}">${esc(fmtMoney(r.flow))}</td>`);
            cells.push(
              `<td><span class="aflow-ratio"><span class="aflow-num ${flowCls}">${esc(ratioTxt)}</span><span class="aflow-bar"><i class="${barCls}" style="width:${barW.toFixed(1)}%"></i></span></span></td>`
            );
            return `<tr${url ? ` data-url="${esc(url)}"` : ''}>${cells.join('')}</tr>`;
          })
          .join('');
      };

      const renderError = () => {
        const cols = curTab.key === 'stock' ? 6 : 5;
        tbody.innerHTML = `<tr class="aflow-empty"><td colspan="${cols}">榜单加载失败，稍后自动重试…</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        needRefresh = false;
        lastFetchAt = Date.now();
        try {
          const result = await fetchFlow();
          if (!alive) return;
          renderRows(result);
          timeEl.textContent = new Date().toTimeString().slice(0, 8);
          clearError();
        } catch (e) {
          if (!alive) return;
          renderError();
          showError('资金流向数据加载失败，60 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        const s = renderSession();
        if (needRefresh || s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      // 行点击：新标签页打开详情（noopener）
      const onRowClick = (ev) => {
        const tr = ev.target && ev.target.closest ? ev.target.closest('tr[data-url]') : null;
        if (!tr) return;
        const url = tr.getAttribute('data-url');
        if (url) window.open(url, '_blank', 'noopener');
      };

      const onTabClick = (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-tab]') : null;
        if (!btn) return;
        const next = TABS.find((t) => t.key === btn.getAttribute('data-tab'));
        if (!next || next.key === curTab.key) return;
        curTab = next;
        tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        renderHead();
        tbody.innerHTML = `<tr class="aflow-empty"><td colspan="${curTab.key === 'stock' ? 6 : 5}">加载中…</td></tr>`;
        needRefresh = true;
        tick();
      };

      const onDirClick = (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-po]') : null;
        if (!btn) return;
        const next = Number(btn.getAttribute('data-po'));
        if (next === curPo) return;
        curPo = next;
        dirsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        needRefresh = true;
        tick();
      };

      tbody.addEventListener('click', onRowClick);
      tabsEl.addEventListener('click', onTabClick);
      dirsEl.addEventListener('click', onDirClick);

      renderHead();
      renderSession();
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
        tbody.removeEventListener('click', onRowClick);
        tabsEl.removeEventListener('click', onTabClick);
        dirsEl.removeEventListener('click', onDirClick);
      };
    },
  };
})();
