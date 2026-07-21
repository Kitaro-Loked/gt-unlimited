/* A股涨停梯队 — 东方财富 push2ex 涨停池/炸板池（公开接口，ut 为公开常量）
 * Data: https://push2ex.eastmoney.com/getTopicZTPool?...&date=YYYYMMDD
 *       https://push2ex.eastmoney.com/getTopicZBPool?...&date=YYYYMMDD
 *   响应头 Access-Control-Allow-Origin: *，可直接 fetch（已 curl 实测 2026-07-16，HTTP 200 且 rc=0 有数据；
 *   pagesize=500 时 len(pool)==data.tc）。无独立"连板梯队"接口，梯队由 ZT 池 lbc 字段前端分组计算。
 *   ZT池字段: c代码 n名称 p最新价(÷1000) zdp涨跌幅% fund封单额(元) fbt首次封板(HHMMSS) lbc连板数
 *             zbc炸板次数 hs换手% amount成交额(元) hybk行业 zttj{days,ct}
 *   ZB池字段: 同结构（无 lbc/fund 语义），pool 长度=炸板家数；炸板率=ZB/(ZT+ZB)
 * 与 asharelimit.js 的差异：该组件是涨停池明细表格（含"连板天梯"平铺排序 tab），
 *   本组件聚焦"梯队"视角——按连板数从高到低分组（最高板→首板），组头显示家数/封单合计/占比条。
 * 注意：A股红涨绿跌，方向/梯队着色用语义令牌 var(--up)=红涨 / var(--down)=绿跌，不复用 --acc/--danger
 *   （--acc 为品牌黄铜强调色，--up/--down 为全局涨跌语义色）。
 * Registers as custom tool id 'ashareladder' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const UT = '7eea3edcaed734bea9cbfc24409ed989';
  const POOL_URL = (path, sort, date) =>
    `https://push2ex.eastmoney.com/${path}?ut=${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=${encodeURIComponent(sort)}&date=${date}`;
  const POOL_API = {
    zt: (d) => POOL_URL('getTopicZTPool', 'fbt:asc', d), // 涨停池
    zb: (d) => POOL_URL('getTopicZBPool', 'fbt:asc', d), // 炸板池（用于炸板率）
  };
  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市低频刷新（兼顾开/收盘切换与非交易日）
  const FETCH_TIMEOUT_MS = 10000; // push2ex 偶发挂起，必须带超时
  const MAX_BACKTRACK_DAYS = 5; // 日期最多往前回退 5 天
  const MAX_ROWS_PER_GROUP = 20; // 每组最多展示条数（首板组可能很长）

  function injectStyle() {
    if (document.getElementById('aladder-style')) return;
    const style = document.createElement('style');
    style.id = 'aladder-style';
    /* A股红涨绿跌：var(--up)=红涨 / var(--down)=绿跌，勿改用 --acc/--danger */
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.aladder-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .aladder-root { --up: #C0442F; --down: #2E7D4F; }
.aladder-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.aladder-head-right { display: flex; align-items: center; gap: 8px; }
.aladder-status { color: var(--warning); white-space: nowrap; }
.aladder-status.live { color: var(--acc); }
.aladder-subbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.aladder-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.aladder-session.on { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 8%, transparent); }
.aladder-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
.aladder-stat {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  background: var(--surface-raised);
}
.aladder-stat-label { font-size: 9px; letter-spacing: 0.1em; color: var(--text-muted); }
.aladder-stat-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--text);
}
.aladder-stat-value.up { color: var(--up); }
.aladder-stat-value.zb { color: var(--warning); }
.aladder-up { color: var(--up); }
.aladder-down { color: var(--down); }
.aladder-groups { display: flex; flex-direction: column; gap: 8px; }
.aladder-group {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  min-width: 0;
}
.aladder-group-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  min-width: 0;
}
.aladder-lb {
  flex-shrink: 0;
  display: inline-block;
  font-size: 10px;
  font-family: var(--font-mono);
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--up);
  color: var(--up);
  background: color-mix(in srgb, var(--up) 10%, transparent);
  white-space: nowrap;
}
.aladder-lb.hot { background: var(--up); color: var(--bg); }
.aladder-lb.first { border-color: var(--hairline-strong); color: var(--text-muted); background: transparent; }
.aladder-group-meta {
  font-size: 9px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aladder-group-meta b { font-weight: 600; color: var(--text-dim); }
.aladder-bar {
  flex: 1;
  height: 3px;
  min-width: 20px;
  border-radius: 999px;
  background: var(--hairline);
  overflow: hidden;
}
.aladder-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--up);
  transition: width 0.4s var(--ease-fluid);
}
.aladder-lb.first ~ .aladder-bar i { background: var(--text-dim); }
.aladder-rows { display: flex; flex-direction: column; }
.aladder-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  font-size: 11px;
  border-top: 1px dashed var(--hairline);
  cursor: pointer;
  min-width: 0;
}
.aladder-row:first-child { border-top: none; }
.aladder-row:hover .aladder-name { color: var(--acc); }
.aladder-name {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.aladder-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 9px; margin-left: 4px; }
.aladder-cell {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  white-space: nowrap;
}
.aladder-cell.fund { color: var(--up); }
.aladder-cell.zbc { color: var(--warning); }
.aladder-more {
  font-size: 9px;
  color: var(--text-dim);
  padding-top: 3px;
  font-family: var(--font-mono);
}
.aladder-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 14px 4px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // ---------- 北京时间工具（中国无夏令时，固定 UTC+8；与 asharelimit.js 一致） ----------
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

  // ---------- 格式化（fund 单位元；fbt 为 HHMMSS 整数） ----------
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
  const lbLabel = (lbc) => (lbc >= 2 ? `${lbc}连板` : '首板');

  window.GT_EXTRA_TOOLS['ashareladder'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool aladder-root">
          <div class="aladder-head">
            <span>EASTMONEY · A股涨停梯队</span>
            <span class="aladder-head-right">
              <span class="aladder-session" data-session>—</span>
              <span class="aladder-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="aladder-subbar">
            <span data-date>数据日期: —</span>
            <span data-note></span>
          </div>
          <div class="aladder-stats">
            <div class="aladder-stat"><span class="aladder-stat-label">涨停家数</span><span class="aladder-stat-value up" data-s-zt>—</span></div>
            <div class="aladder-stat"><span class="aladder-stat-label">连板家数</span><span class="aladder-stat-value up" data-s-lbc>—</span></div>
            <div class="aladder-stat"><span class="aladder-stat-label">最高板</span><span class="aladder-stat-value up" data-s-max>—</span></div>
            <div class="aladder-stat"><span class="aladder-stat-label">炸板率</span><span class="aladder-stat-value zb" data-s-zbr>—</span></div>
          </div>
          <div class="aladder-groups" data-groups>
            <div class="aladder-empty">加载中…</div>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const dateEl = el.querySelector('[data-date]');
      const noteEl = el.querySelector('[data-note]');
      const sessionEl = el.querySelector('[data-session]');
      const groupsEl = el.querySelector('[data-groups]');
      const statEls = {
        zt: el.querySelector('[data-s-zt]'),
        lbc: el.querySelector('[data-s-lbc]'),
        max: el.querySelector('[data-s-max]'),
        zbr: el.querySelector('[data-s-zbr]'),
      };

      let alive = true;
      let loading = false;
      let tickTimer = null;
      let lastFetchAt = 0;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const aborters = new Set(); // 进行中的 fetch AbortController

      const setConn = (state) => {
        if (state === 'live') {
          conn.textContent = '● LIVE';
          conn.className = 'aladder-status live';
          hint.style.display = 'none';
          setStatus('online');
        } else {
          conn.textContent = '连接失败';
          conn.className = 'aladder-status';
          hint.textContent = '数据加载失败，稍后自动重试…';
          hint.style.display = '';
          setStatus('offline');
        }
      };

      const updateSessionBadge = () => {
        const on = isTradingSession();
        sessionEl.textContent = on ? '● 交易中' : '休市';
        sessionEl.className = `aladder-session${on ? ' on' : ''}`;
        return on;
      };

      const fetchJson = (url) => {
        const ctl = new AbortController();
        aborters.add(ctl);
        const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        return fetch(url, { signal: ctl.signal, cache: 'no-store' })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .finally(() => {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            aborters.delete(ctl);
          });
      };

      const poolOf = (j) => (j && j.data && Array.isArray(j.data.pool) ? j.data.pool : []);

      // ---------- 梯队渲染：按 lbc 从高到低分组 ----------
      const renderLadder = (zt, zbCount, date) => {
        const groups = new Map(); // lbc -> items[]
        zt.forEach((it) => {
          const lbc = Math.max(1, Number(it.lbc) || 1); // ZT 池 lbc>=1，缺失按首板处理
          if (!groups.has(lbc)) groups.set(lbc, []);
          groups.get(lbc).push(it);
        });
        const levels = Array.from(groups.keys()).sort((a, b) => b - a);
        const maxLb = levels.length ? levels[0] : 0;
        const lbCount = zt.filter((it) => (Number(it.lbc) || 0) >= 2).length;
        const totalTouch = zt.length + zbCount; // 今日触板 = 涨停 + 炸板
        const zbRate = totalTouch > 0 ? (zbCount / totalTouch) * 100 : NaN;

        statEls.zt.textContent = `${zt.length} 家`;
        statEls.lbc.textContent = `${lbCount} 家`;
        statEls.max.textContent = maxLb > 0 ? `${maxLb} 板` : '—';
        statEls.zbr.textContent = Number.isFinite(zbRate) ? `${zbRate.toFixed(1)}%` : '—';
        dateEl.textContent = `数据日期: ${cnDate(date)}`;
        noteEl.textContent = totalTouch > 0 ? `触板 ${totalTouch} · 封板 ${zt.length} · 炸板 ${zbCount}` : '';

        if (!zt.length) {
          groupsEl.innerHTML = `<div class="aladder-empty">该交易日无涨停数据</div>`;
          return;
        }
        const maxGroupSize = Math.max(...levels.map((l) => groups.get(l).length), 1);
        groupsEl.innerHTML = levels
          .map((lbc) => {
            const items = groups.get(lbc).slice().sort((a, b) => (Number(b.fund) || 0) - (Number(a.fund) || 0));
            const fundSum = items.reduce((s, it) => s + (Number(it.fund) || 0), 0);
            const shown = items.slice(0, MAX_ROWS_PER_GROUP);
            const hidden = items.length - shown.length;
            const pct = Math.max(4, Math.round((items.length / maxGroupSize) * 100));
            const lbCls = lbc >= 3 ? 'aladder-lb hot' : lbc === 2 ? 'aladder-lb' : 'aladder-lb first';
            const rows = shown
              .map(
                (it) => `
                <div class="aladder-row" data-code="${esc(it.c)}">
                  <span class="aladder-name">${esc(it.n)}<i>${esc(it.c)}</i></span>
                  ${(Number(it.zbc) || 0) > 0 ? `<span class="aladder-cell zbc">炸${esc(it.zbc)}</span>` : ''}
                  <span class="aladder-cell">${fmtHm(Number(it.fbt))}</span>
                  <span class="aladder-cell fund">封 ${fmtMoney(Number(it.fund))}</span>
                </div>`
              )
              .join('');
            return `
              <div class="aladder-group">
                <div class="aladder-group-top">
                  <span class="${lbCls}">${lbLabel(lbc)}</span>
                  <span class="aladder-group-meta"><b>${items.length}</b> 家 · 封单合计 <b>${fmtMoney(fundSum)}</b></span>
                  <span class="aladder-bar"><i style="width:${pct}%"></i></span>
                </div>
                <div class="aladder-rows">${rows}</div>
                ${hidden > 0 ? `<div class="aladder-more">… 其余 ${hidden} 家略（封单额较小）</div>` : ''}
              </div>`;
          })
          .join('');
      };

      const load = async () => {
        if (!alive || loading) return;
        loading = true;
        lastFetchAt = Date.now();
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
          const zbRes = await fetchJson(POOL_API.zb(date)).catch(() => null);
          if (!alive) return;
          renderLadder(zt, poolOf(zbRes).length, date);
          setConn('live');
        } catch (e) {
          if (alive) setConn('fail');
        } finally {
          loading = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        const on = updateSessionBadge();
        if (document.hidden) return; // 页面不可见时跳过刷新
        if (on || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) load();
      };

      const onRowClick = (ev) => {
        const row = ev.target.closest('[data-code]');
        if (!row) return;
        const code = row.dataset.code;
        if (!/^\d{6}$/.test(code)) return;
        window.open(`https://quote.eastmoney.com/${mktOf(code)}${code}.html`, '_blank', 'noopener');
      };

      groupsEl.addEventListener('click', onRowClick);

      updateSessionBadge();
      load();
      tickTimer = setInterval(tick, REFRESH_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        aborters.forEach((ctl) => {
          try {
            ctl.abort();
          } catch (e) { /* 忽略 */ }
        });
        aborters.clear();
        groupsEl.removeEventListener('click', onRowClick);
      };
    },
  };
})();
