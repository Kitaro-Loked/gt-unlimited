/* A股人气热股榜 — 东财股吧人气榜(POST CORS JSON) + 东财行情补全(ulist 双 host 兜底)
 * 排名: POST https://emappdata.eastmoney.com/stockrank/getAllCurrentList
 *   body: {"appId":"appId01","globalId":"...","marketType":"","pageNo":1,"pageSize":20}
 *   字段: sc=带市场前缀代码(SH603127/SZ002185) rk=人气排名 rc=状态位 hisRc=较上期排名变化(正=上升)
 *   实测 2026-07-16: GET 返回"服务异常"，必须 POST；CORS 预检通过(Access-Control-Allow-Origin 回显来源)；
 *   仅返回沪深 A 股，无港股/美股榜单接口(getHkCurrentList/getUsCurrentList 等实测均 404)，故不做多市场 Tab。
 * 行情: https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.<code>/0.<code>&fields=f12,f14,f2,f3,f8
 *   字段: f12=代码 f14=名称 f2=最新价 f3=涨跌幅% f8=换手率%
 *   实测 2026-07-16: push2 主站对本机出口 IP 返回 502，push2delay 正常且带 CORS 头，保留双 host 兜底。
 * 弃用源: 雪球 stock.xueqiu.com/v5/stock/hot_stock/list.json 实测 2026-07-16 返回 400(error_code 400016，
 *   "请重新登录帐号")，需登录 cookie，浏览器无法直连，未采用。
 * 注意：A股红涨绿跌，方向着色用 hotrank-up(红 var(--up))/hotrank-down(绿 var(--down))，不使用 --acc/--danger。
 * Registers as custom tool id 'hotrank' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const RANK_URL = 'https://emappdata.eastmoney.com/stockrank/getAllCurrentList';
  const RANK_BODY = JSON.stringify({
    appId: 'appId01',
    globalId: '786e4c21-70dc-435a-93bb-38',
    marketType: '',
    pageNo: 1,
    pageSize: 20,
  });
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host, secids) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3,f8&secids=${encodeURIComponent(secids)}`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('hotrank-style')) return;
    const style = document.createElement('style');
    style.id = 'hotrank-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.hotrank-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .hotrank-root { --up: #C0442F; --down: #2E7D4F; }
.hotrank-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.hotrank-head-right { display: flex; align-items: center; gap: 8px; }
.hotrank-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.hotrank-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.hotrank-status { color: var(--warning); white-space: nowrap; }
.hotrank-status.live { color: var(--acc); }
/* A股红涨绿跌：语义令牌 var(--up)/var(--down)，勿改用 --acc/--danger */
.hotrank-up { color: var(--up); }
.hotrank-down { color: var(--down); }
.hotrank-flat { color: var(--text-muted); }
.hotrank-boards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 720px) {
  .hotrank-boards { grid-template-columns: 1fr; }
}
.hotrank-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.hotrank-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.hotrank-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.hotrank-table { font-variant-numeric: tabular-nums; width: 100%; }
.hotrank-table th, .hotrank-table td { white-space: nowrap; }
.hotrank-num { font-family: var(--font-mono); }
.hotrank-rank {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--text-dim);
  width: 22px;
}
.hotrank-rank.top { color: var(--acc); }
.hotrank-stock { font-weight: 600; max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
.hotrank-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.hotrank-rc { font-family: var(--font-mono); font-size: 10px; }
.hotrank-note {
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.hotrank-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
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
    if (!Number.isFinite(v) || v === 0) return 'hotrank-flat';
    return v > 0 ? 'hotrank-up' : 'hotrank-down';
  };

  // SH/SZ 代码 → 东财 secid（1=沪 0=深；北证按 0 处理，榜单实测未出现）
  const toSecid = (sc) => {
    const m = /^(SH|SZ|BJ)(\d{6})$/i.exec(String(sc || ''));
    if (!m) return null;
    return `${m[1].toUpperCase() === 'SH' ? 1 : 0}.${m[2]}`;
  };

  // 北京时间（UTC+8）交易时段：周一至五 09:15-11:30 / 13:00-15:00（仅按星期粗判）
  const sessionState = () => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const day = bj.getDay();
    const mins = bj.getHours() * 60 + bj.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 555 && mins < 690) || (mins >= 780 && mins <= 900)) return 'trading';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['hotrank'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool hotrank-root">
          <div class="hotrank-head">
            <span>A股 · 人气热股榜</span>
            <span class="hotrank-head-right">
              <span class="hotrank-session" data-session>—</span>
              <span class="hotrank-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="hotrank-boards">
            <div class="hotrank-board">
              <div class="hotrank-board-title"><span>TOP 1 – 10</span><i data-note-a></i></div>
              <table class="data-table hotrank-table">
                <thead><tr><th>#</th><th>名称</th><th>现价</th><th>涨跌幅</th><th>排名变化</th><th>换手</th></tr></thead>
                <tbody data-body-a></tbody>
              </table>
            </div>
            <div class="hotrank-board">
              <div class="hotrank-board-title"><span>TOP 11 – 20</span><i data-note-b></i></div>
              <table class="data-table hotrank-table">
                <thead><tr><th>#</th><th>名称</th><th>现价</th><th>涨跌幅</th><th>排名变化</th><th>换手</th></tr></thead>
                <tbody data-body-b></tbody>
              </table>
            </div>
          </div>
          <div class="hotrank-note">口径：东方财富股吧人气榜（按吧内关注度排名），行情与换手率来自东财行情接口</div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const bodies = [el.querySelector('[data-body-a]'), el.querySelector('[data-body-b]')];
      const notes = [el.querySelector('[data-note-a]'), el.querySelector('[data-note-b]')];

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
        conn.className = 'hotrank-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'hotrank-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'hotrank-session open';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'hotrank-session';
        }
        return s;
      };

      // 通用 fetch（带超时与 abort 登记），供排名与行情复用
      const fetchJson = async (url, options) => {
        if (!alive) throw new Error('disposed');
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(url, Object.assign({ signal: ctrl.signal, cache: 'no-store' }, options));
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          return await resp.json();
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      // 东财股吧人气榜：POST JSON，返回 [{sc, rk, rc, hisRc}]
      const fetchRank = async () => {
        const json = await fetchJson(RANK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: RANK_BODY,
        });
        const list = json && json.status === 0 && Array.isArray(json.data) ? json.data : [];
        if (!list.length) throw new Error('empty rank');
        return list
          .map((r) => ({ sc: String(r.sc || ''), rk: Number(r.rk), hisRc: Number(r.hisRc), secid: toSecid(r.sc) }))
          .filter((r) => r.secid && Number.isFinite(r.rk))
          .sort((a, b) => a.rk - b.rk)
          .slice(0, 20);
      };

      // 东财行情补全：ulist 批量报价，push2 失败时回退 push2delay（延时行情）
      const fetchQuotes = async (secids) => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          try {
            const json = await fetchJson(emUrl(EM_HOSTS[i], secids));
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('quote error');
      };

      const fmtRankChange = (hisRc) => {
        if (!Number.isFinite(hisRc) || hisRc === 0) return '<span class="hotrank-flat">—</span>';
        const cls = hisRc > 0 ? 'hotrank-up' : 'hotrank-down';
        const arrow = hisRc > 0 ? '↑' : '↓';
        return `<span class="${cls}">${arrow}${Math.abs(hisRc)}</span>`;
      };

      const renderRows = (rankList, quoteResult) => {
        const quoteMap = {};
        if (quoteResult) {
          quoteResult.rows.forEach((q) => {
            quoteMap[String(q.f12 || '')] = q;
          });
        }
        const half = Math.ceil(rankList.length / 2);
        const groups = [rankList.slice(0, half), rankList.slice(half)];
        groups.forEach((group, gi) => {
          if (!group.length) {
            bodies[gi].innerHTML = `<tr class="hotrank-empty"><td colspan="6">暂无数据</td></tr>`;
            return;
          }
          bodies[gi].innerHTML = group
            .map((r) => {
              const code = r.sc.slice(2);
              const q = quoteMap[code];
              const price = q ? Number(q.f2) : NaN;
              const pct = q ? Number(q.f3) : NaN;
              const turnover = q ? Number(q.f8) : NaN;
              const name = q && q.f14 ? String(q.f14) : code;
              const cls = dirClass(pct);
              return `
              <tr>
                <td class="hotrank-rank ${r.rk <= 3 ? 'top' : ''}">${r.rk}</td>
                <td class="hotrank-stock" title="${esc(name)}">${esc(name)}<i>${esc(code)}</i></td>
                <td class="hotrank-num ${cls}">${Number.isFinite(price) ? esc(fmtNum(price, 2)) : '—'}</td>
                <td class="hotrank-num ${cls}">${Number.isFinite(pct) ? esc(fmtSigned(pct, 2)) + '%' : '—'}</td>
                <td class="hotrank-rc">${fmtRankChange(r.hisRc)}</td>
                <td class="hotrank-num">${Number.isFinite(turnover) ? esc(fmtNum(turnover, 2)) + '%' : '—'}</td>
              </tr>`;
            })
            .join('');
        });
        const delayedTag = quoteResult && quoteResult.delayed ? '延时行情' : '';
        notes[0].textContent = delayedTag;
        notes[1].textContent = delayedTag;
      };

      const renderError = (msg) => {
        bodies.forEach((tbody) => {
          tbody.innerHTML = `<tr class="hotrank-empty"><td colspan="6">${esc(msg)}</td></tr>`;
        });
        notes.forEach((n) => {
          n.textContent = '';
        });
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const rankList = await fetchRank();
          if (!alive) return;
          // 排名到手即视为在线；行情失败降级为仅展示排名
          clearError();
          let quoteResult = null;
          try {
            quoteResult = await fetchQuotes(rankList.map((r) => r.secid).join(','));
          } catch (e) {
            notes.forEach((n) => {
              n.textContent = '行情暂缺';
            });
          }
          if (!alive) return;
          renderRows(rankList, quoteResult);
        } catch (e) {
          if (!alive) return;
          renderError('人气榜加载失败');
          showError('人气榜加载失败，30 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

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
      };
    },
  };
})();
