/* A股涨停复盘 — 东方财富 push2ex 涨停池/连板天梯/炸板池/跌停池（公开接口，ut 为公开常量）
 * Data: https://push2ex.eastmoney.com/getTopicZTPool|getTopicZBPool|getTopicDTPool
 *   响应带 Access-Control-Allow-Origin: *，可直接 fetch（JSONP cb= 亦可用，未采用）
 *   字段: c代码 n名称 p最新价(÷1000) zdp涨跌幅% fund封单额 fbt首封 lbt末封 zbc炸板次数
 *         lbc连板数 hs换手% amount成交额 zttj{days,ct} / DT池: days连跌 oc打开次数
 * Registers as custom tool id 'asharelimit' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const UT = '7eea3edcaed734bea9cbfc24409ed989';
  const POOL_URL = (path, sort, date) =>
    `https://push2ex.eastmoney.com/${path}?ut=${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=${encodeURIComponent(sort)}&date=${date}`;
  const POOL_API = {
    zt: (d) => POOL_URL('getTopicZTPool', 'fbt:asc', d), // 涨停池
    zb: (d) => POOL_URL('getTopicZBPool', 'fbt:asc', d), // 炸板池
    dt: (d) => POOL_URL('getTopicDTPool', 'fund:desc', d), // 跌停池（sort=fbt 返回空，须用 fund）
  };
  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 12000; // 接口偶发挂起，必须带超时
  const MAX_BACKTRACK_DAYS = 5; // 日期最多往前回退 5 天

  function injectStyle() {
    if (document.getElementById('alimit-style')) return;
    const style = document.createElement('style');
    style.id = 'alimit-style';
    /* A股习惯红涨绿跌：本组件用 alimit-up(红)/alimit-down(绿) 表示方向，
     * 映射到语义令牌 var(--up)/var(--down)，与站点 crypto 组件的 --acc/--danger 解耦。 */
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.alimit-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .alimit-root { --up: #C0442F; --down: #2E7D4F; }
.alimit-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.alimit-status { color: var(--warning); }
.alimit-status.live { color: var(--acc); }
.alimit-subbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.alimit-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
}
.alimit-session.on { color: var(--up); border-color: var(--up); }
.alimit-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
.alimit-stat {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.alimit-stat-label { font-size: 9px; letter-spacing: 0.1em; color: var(--text-muted); }
.alimit-stat-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.alimit-stat-value.up { color: var(--up); }
.alimit-stat-value.down { color: var(--down); }
.alimit-stat-value.zb { color: var(--warning); }
.alimit-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--hairline);
}
.alimit-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-family: inherit;
  padding: 4px 8px;
  cursor: pointer;
}
.alimit-tab:hover { color: var(--text); }
.alimit-tab.active { color: var(--text); border-bottom-color: var(--acc); font-weight: 600; }
.alimit-tab i { font-style: normal; color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; }
.alimit-list-wrap { max-height: 340px; overflow-y: auto; }
.alimit-table { font-variant-numeric: tabular-nums; }
.alimit-table th, .alimit-table td { white-space: nowrap; }
.alimit-table tbody tr { cursor: pointer; }
.alimit-num { font-family: var(--font-mono); }
.alimit-code { color: var(--text-dim); }
.alimit-name { font-weight: 600; }
.alimit-up { color: var(--up); }
.alimit-down { color: var(--down); }
.alimit-badge {
  display: inline-block;
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--up);
  color: var(--up);
  background: color-mix(in srgb, var(--up) 10%, transparent);
}
.alimit-badge.hot {
  background: var(--up);
  color: var(--bg);
  font-weight: 700;
}
.alimit-badge.down {
  border-color: var(--down);
  color: var(--down);
  background: color-mix(in srgb, var(--down) 10%, transparent);
}
.alimit-time { color: var(--text-muted); font-size: 10px; }
.alimit-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 14px 4px;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // ---------- 北京时间工具（中国无夏令时，固定 UTC+8） ----------
  const bjNow = () => new Date(Date.now() + 8 * 3600 * 1000);
  const pad2 = (n) => String(n).padStart(2, '0');
  const bjDateStr = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  const bjTodayStr = () => bjDateStr(bjNow());
  const backtrack = (dateStr, days) => {
    const t = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8)));
    t.setUTCDate(t.getUTCDate() - days);
    return bjDateStr(t);
  };
  const cnDate = (dateStr) => `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  // A股连续竞价时段：周一至五 09:30-11:30 / 13:00-15:00（北京时间）
  const isTradingSession = () => {
    const b = bjNow();
    const day = b.getUTCDay();
    if (day === 0 || day === 6) return false;
    const mins = b.getUTCHours() * 60 + b.getUTCMinutes();
    return (mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900);
  };

  // ---------- 格式化（东财缩放：p÷1000；fund/amount 单位元；fbt/lbt 为 HHMMSS 整数） ----------
  const fmtPrice = (p) => (Number.isFinite(p) ? (p / 1000).toFixed(2) : '—');
  const fmtPct = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const fmtHs = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const fmtMoney = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
    if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
    return v.toFixed(0);
  };
  const fmtHm = (n) => {
    if (!Number.isFinite(n)) return '—';
    const s = String(Math.trunc(n)).padStart(6, '0');
    return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  };
  // 代码首字符定市场：6→sh，4/8→bj，其余→sz
  const mktOf = (code) => (code[0] === '6' ? 'sh' : code[0] === '4' || code[0] === '8' ? 'bj' : 'sz');

  window.GT_EXTRA_TOOLS['asharelimit'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool alimit-root">
          <div class="alimit-head"><span>EASTMONEY · A股涨停复盘</span><span class="alimit-status" data-conn>连接中…</span></div>
          <div class="alimit-subbar">
            <span data-date>数据日期: —</span>
            <span class="alimit-session" data-session>—</span>
          </div>
          <div class="alimit-stats">
            <div class="alimit-stat"><span class="alimit-stat-label">涨停</span><span class="alimit-stat-value up" data-s-zt>—</span></div>
            <div class="alimit-stat"><span class="alimit-stat-label">最高连板</span><span class="alimit-stat-value up" data-s-lb>—</span></div>
            <div class="alimit-stat"><span class="alimit-stat-label">炸板</span><span class="alimit-stat-value zb" data-s-zb>—</span></div>
            <div class="alimit-stat"><span class="alimit-stat-label">跌停</span><span class="alimit-stat-value down" data-s-dt>—</span></div>
          </div>
          <div class="alimit-tabs" data-tabs>
            <button type="button" class="alimit-tab active" data-tab="zt">涨停池 <i data-c-zt></i></button>
            <button type="button" class="alimit-tab" data-tab="lb">连板天梯 <i data-c-lb></i></button>
            <button type="button" class="alimit-tab" data-tab="zb">炸板池 <i data-c-zb></i></button>
            <button type="button" class="alimit-tab" data-tab="dt">跌停池 <i data-c-dt></i></button>
          </div>
          <div class="alimit-list-wrap">
            <table class="data-table alimit-table" data-table></table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const dateEl = el.querySelector('[data-date]');
      const sessionEl = el.querySelector('[data-session]');
      const tabsEl = el.querySelector('[data-tabs]');
      const tableEl = el.querySelector('[data-table]');
      const statEls = {
        zt: el.querySelector('[data-s-zt]'),
        lb: el.querySelector('[data-s-lb]'),
        zb: el.querySelector('[data-s-zb]'),
        dt: el.querySelector('[data-s-dt]'),
      };
      const cntEls = {
        zt: el.querySelector('[data-c-zt]'),
        lb: el.querySelector('[data-c-lb]'),
        zb: el.querySelector('[data-c-zb]'),
        dt: el.querySelector('[data-c-dt]'),
      };

      const pools = { zt: [], zb: [], dt: [] };
      let activeTab = 'zt';
      let dataDate = '';
      let alive = true;
      let loading = false;
      let refreshTimer = null;
      const aborters = new Set();

      const setConn = (state) => {
        if (state === 'live') {
          conn.textContent = '● LIVE';
          conn.className = 'alimit-status live';
          hint.style.display = 'none';
          setStatus('online');
        } else {
          conn.textContent = '连接失败';
          conn.className = 'alimit-status';
          hint.textContent = '数据加载失败，稍后自动重试…';
          hint.style.display = '';
          setStatus('offline');
        }
      };

      const updateSessionBadge = () => {
        const on = isTradingSession();
        sessionEl.textContent = on ? '交易中' : '休市';
        sessionEl.className = `alimit-session${on ? ' on' : ''}`;
      };

      const fetchJson = (url) => {
        const ctl = new AbortController();
        aborters.add(ctl);
        const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
        return fetch(url, { signal: ctl.signal, cache: 'no-store' })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .finally(() => {
            clearTimeout(timer);
            aborters.delete(ctl);
          });
      };

      const poolOf = (j) => (j && j.data && Array.isArray(j.data.pool) ? j.data.pool : []);

      // ---------- 表格渲染 ----------
      const dirCls = (zdp) => (zdp >= 0 ? 'alimit-up' : 'alimit-down');
      const headCells = (it, cls) => `
        <td class="alimit-num alimit-code">${esc(it.c)}</td>
        <td class="alimit-name">${esc(it.n)}</td>
        <td class="alimit-num">${fmtPrice(it.p)}</td>
        <td class="alimit-num ${cls}">${fmtPct(it.zdp)}</td>`;
      const lbBadge = (lbc, always) => {
        const n = Number(lbc) || 0;
        if (!always && n <= 0) return '<td class="alimit-num">—</td>';
        return `<td class="alimit-num"><span class="alimit-badge${n >= 3 ? ' hot' : ''}">${n}板</span></td>`;
      };

      const TABS = {
        zt: {
          cols: ['代码', '名称', '最新价', '涨跌幅%', '封单额', '首封', '炸板', '连板', '换手%', '成交额'],
          rows: () => pools.zt,
          row: (it) => `
            ${headCells(it, 'alimit-up')}
            <td class="alimit-num">${fmtMoney(it.fund)}</td>
            <td class="alimit-num alimit-time">${fmtHm(it.fbt)}</td>
            <td class="alimit-num">${Number.isFinite(it.zbc) ? esc(it.zbc) : '—'}</td>
            ${lbBadge(it.lbc, false)}
            <td class="alimit-num">${fmtHs(it.hs)}</td>
            <td class="alimit-num">${fmtMoney(it.amount)}</td>`,
        },
        lb: {
          cols: ['代码', '名称', '最新价', '涨跌幅%', '封单额', '首封', '连板', '换手%', '成交额'],
          rows: () => pools.zt.slice().sort((a, b) => (Number(b.lbc) || 0) - (Number(a.lbc) || 0)),
          row: (it) => `
            ${headCells(it, 'alimit-up')}
            <td class="alimit-num">${fmtMoney(it.fund)}</td>
            <td class="alimit-num alimit-time">${fmtHm(it.fbt)}</td>
            ${lbBadge(it.lbc, true)}
            <td class="alimit-num">${fmtHs(it.hs)}</td>
            <td class="alimit-num">${fmtMoney(it.amount)}</td>`,
        },
        zb: {
          cols: ['代码', '名称', '最新价', '涨跌幅%', '首封', '炸板', '换手%', '成交额'],
          rows: () => pools.zb,
          row: (it) => `
            ${headCells(it, dirCls(it.zdp))}
            <td class="alimit-num alimit-time">${fmtHm(it.fbt)}</td>
            <td class="alimit-num">${Number.isFinite(it.zbc) ? esc(it.zbc) : '—'}</td>
            <td class="alimit-num">${fmtHs(it.hs)}</td>
            <td class="alimit-num">${fmtMoney(it.amount)}</td>`,
        },
        dt: {
          cols: ['代码', '名称', '最新价', '涨跌幅%', '封单额', '封板', '连跌', '换手%', '成交额'],
          rows: () => pools.dt,
          row: (it) => `
            ${headCells(it, 'alimit-down')}
            <td class="alimit-num">${fmtMoney(it.fund)}</td>
            <td class="alimit-num alimit-time">${fmtHm(it.lbt)}</td>
            <td class="alimit-num">${Number.isFinite(it.days) && it.days > 0 ? `<span class="alimit-badge down">${esc(it.days)}天</span>` : '—'}</td>
            <td class="alimit-num">${fmtHs(it.hs)}</td>
            <td class="alimit-num">${fmtMoney(it.amount)}</td>`,
        },
      };

      const renderTable = () => {
        const tab = TABS[activeTab];
        const rows = tab.rows();
        const thead = `<thead><tr>${tab.cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
        const body = rows.length
          ? rows
              .map((it) => `<tr data-code="${esc(it.c)}">${tab.row(it)}</tr>`)
              .join('')
          : `<tr class="alimit-empty"><td colspan="${tab.cols.length}">${dataDate ? '该交易日无数据' : '加载中…'}</td></tr>`;
        tableEl.innerHTML = `${thead}<tbody>${body}</tbody>`;
      };

      const renderSummary = () => {
        const maxLb = pools.zt.reduce((m, it) => Math.max(m, Number(it.lbc) || 0), 0);
        statEls.zt.textContent = `${pools.zt.length} 家`;
        statEls.lb.textContent = maxLb > 0 ? `${maxLb} 板` : '—';
        statEls.zb.textContent = `${pools.zb.length} 家`;
        statEls.dt.textContent = `${pools.dt.length} 家`;
        cntEls.zt.textContent = pools.zt.length ? `(${pools.zt.length})` : '';
        cntEls.lb.textContent = pools.zt.length ? `(${pools.zt.filter((it) => (Number(it.lbc) || 0) >= 2).length})` : '';
        cntEls.zb.textContent = pools.zb.length ? `(${pools.zb.length})` : '';
        cntEls.dt.textContent = pools.dt.length ? `(${pools.dt.length})` : '';
        dateEl.textContent = `数据日期: ${dataDate ? cnDate(dataDate) : '—'}`;
      };

      const load = async () => {
        if (!alive || loading) return;
        loading = true;
        try {
          // 日期回退：从北京时间今天往前最多 5 天，取最近有涨停数据的交易日
          const today = bjTodayStr();
          let date = today;
          let zt = [];
          for (let i = 0; i <= MAX_BACKTRACK_DAYS; i++) {
            const d = backtrack(today, i);
            const pool = poolOf(await fetchJson(POOL_API.zt(d)));
            if (pool.length > 0 || i === MAX_BACKTRACK_DAYS) {
              date = d;
              zt = pool;
              break;
            }
          }
          const [zbRes, dtRes] = await Promise.all([
            fetchJson(POOL_API.zb(date)).catch(() => null),
            fetchJson(POOL_API.dt(date)).catch(() => null),
          ]);
          if (!alive) return;
          pools.zt = zt;
          pools.zb = poolOf(zbRes);
          pools.dt = poolOf(dtRes);
          dataDate = date;
          renderSummary();
          renderTable();
          setConn('live');
        } catch (e) {
          if (alive) setConn('fail');
        } finally {
          loading = false;
        }
      };

      const onTabClick = (ev) => {
        const btn = ev.target.closest('[data-tab]');
        if (!btn) return;
        activeTab = btn.dataset.tab;
        tabsEl.querySelectorAll('.alimit-tab').forEach((b) => b.classList.toggle('active', b === btn));
        renderTable();
      };

      const onRowClick = (ev) => {
        const tr = ev.target.closest('tr[data-code]');
        if (!tr) return;
        const code = tr.dataset.code;
        if (!/^\d{6}$/.test(code)) return;
        window.open(`https://quote.eastmoney.com/${mktOf(code)}${code}.html`, '_blank', 'noopener');
      };

      tabsEl.addEventListener('click', onTabClick);
      tableEl.addEventListener('click', onRowClick);

      updateSessionBadge();
      renderTable();
      load();
      refreshTimer = setInterval(() => {
        updateSessionBadge();
        if (isTradingSession()) load(); // 仅交易时段自动刷新
      }, REFRESH_MS);

      return () => {
        alive = false;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        aborters.forEach((ctl) => {
          try {
            ctl.abort();
          } catch (e) { /* 忽略 */ }
        });
        aborters.clear();
        tabsEl.removeEventListener('click', onTabClick);
        tableEl.removeEventListener('click', onRowClick);
      };
    },
  };
})();
