/* A股资金面 — 融资融券汇总 + 龙虎榜 + 主力资金榜
 * 接口（均已 curl 实测 2026-07-16）：
 * ① 两融汇总: https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ
 *    带 Origin 请求头时响应 Access-Control-Allow-Origin: *（浏览器跨域 fetch 可用）。
 *    字段: DIM_DATE=日期 RZYE=融资余额(元) RZJME=融资净买入(元) RQYE=融券余额(元) RQYL=融券余量(股)。
 *    两融为 T+1 披露，取最近 2 行计算日变化。
 * ② 龙虎榜: 同站 reportName=RPT_DAILYBILLBOARD_DETAILS（CORS 同上）。
 *    字段: SECURITY_CODE/SECURITY_NAME_ABBR/TRADE_DATE/EXPLANATION=上榜原因/BILLBOARD_NET_AMT=龙虎榜净买入额(元)/CHANGE_RATE=涨跌幅%。
 *    当日榜单收盘后披露；按 TRADE_DATE 取最近交易日，分净买入/净卖出两侧各 TOP 8。
 * ③ 主力资金: https://push2.eastmoney.com/api/qt/clist/get fid=f62 主力净流入排序
 *    字段: f12=代码 f14=名称 f2=最新价 f3=涨跌幅% f62=主力净流入(元) f184=净流入占比%。
 *    失败回退 push2delay.eastmoney.com（延时行情兜底，同 ashareboard 双 host 模式）。
 *    实测当日 push2 主站间歇 502，push2delay 正常（CORS OK）。
 * ④ 北向资金：已放弃。2024-08 起实时/净买入停止披露，RPT_MUTUAL_DEAL_HISTORY 的
 *    NET_DEAL_AMT/BUY_AMT/SELL_AMT 多为 null，仅剩 DEAL_AMT 且单位口径存疑，不予展示。
 * 配色：A股约定 红=流入/涨，绿=流出/跌，用语义令牌 var(--up)=红 / var(--down)=绿，不使用 --acc/--danger。
 * Registers as custom tool id 'asharecapital' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DC_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const RZRQ_URL = `${DC_BASE}?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZYE,RZJME,RQYE,RQYL` +
    `&pageNumber=1&pageSize=2&sortColumns=DIM_DATE&sortTypes=-1&source=WEB&client=WEB`;
  const LHB_COLS = 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,BILLBOARD_NET_AMT,CHANGE_RATE';
  const lhbUrl = (sortType) =>
    `${DC_BASE}?reportName=RPT_DAILYBILLBOARD_DETAILS&columns=${LHB_COLS}` +
    `&pageNumber=1&pageSize=20&sortColumns=TRADE_DATE,BILLBOARD_NET_AMT&sortTypes=-1,${sortType}&source=WEB&client=WEB`;

  const EM_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 沪深A股
  const EM_FIELDS = 'f12,f14,f2,f3,f62,f184'; // 代码/名称/最新价/涨跌幅%/主力净流入(元)/净流入占比%
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host, po) =>
    `${host}/api/qt/clist/get?pn=1&pz=8&po=${po}&np=1&fltt=2&invt=2&fid=f62&fs=${encodeURIComponent(EM_FS)}&fields=${EM_FIELDS}`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('acap-style')) return;
    const style = document.createElement('style');
    style.id = 'acap-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.acap-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .acap-root { --up: #C0442F; --down: #2E7D4F; }
.acap-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.acap-head-right { display: flex; align-items: center; gap: 8px; }
.acap-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.acap-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.acap-status { color: var(--warning); white-space: nowrap; }
.acap-status.live { color: var(--acc); }
/* A股资金面约定：红=流入/涨 var(--up)，绿=流出/跌 var(--down)，勿改用 --acc/--danger */
.acap-in { color: var(--up); }
.acap-out { color: var(--down); }
.acap-flat { color: var(--text-muted); }
.acap-rzrq {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--surface-raised);
}
.acap-rzrq-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.acap-rzrq-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.acap-rzrq-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
@media (max-width: 720px) {
  .acap-rzrq-grid { grid-template-columns: 1fr; }
}
.acap-stat { min-width: 0; }
.acap-stat-label { font-size: 9px; color: var(--text-muted); margin-bottom: 2px; white-space: nowrap; }
.acap-stat-value {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  line-height: 1.25;
}
.acap-stat-chg {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.acap-boards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.acap-boards:last-child { margin-bottom: 0; }
@media (max-width: 720px) {
  .acap-boards { grid-template-columns: 1fr; }
}
.acap-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
}
.acap-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.acap-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; white-space: nowrap; }
.acap-table { font-variant-numeric: tabular-nums; table-layout: fixed; width: 100%; }
.acap-table th, .acap-table td { white-space: nowrap; }
.acap-reason { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
.acap-num { font-family: var(--font-mono); }
.acap-stock { font-weight: 600; }
.acap-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.acap-sub { font-style: normal; color: var(--text-dim); font-size: 9px; margin-left: 4px; }
.acap-empty td {
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

  // 元 → 亿/万亿
  const fmtYi = (v) => {
    if (!Number.isFinite(v)) return '—';
    const yi = v / 1e8;
    if (Math.abs(yi) >= 1e4) return `${fmtNum(yi / 1e4, 2)}万亿`;
    if (Math.abs(yi) >= 100) return `${fmtNum(yi, 0)}亿`;
    return `${fmtNum(yi, 2)}亿`;
  };

  const fmtYiSigned = (v) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtYi(v);
  };

  // 资金方向着色：流入红、流出绿
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'acap-flat';
    return v > 0 ? 'acap-in' : 'acap-out';
  };

  const dateOnly = (s) => String(s || '').slice(0, 10);

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

  window.GT_EXTRA_TOOLS['asharecapital'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool acap-root">
          <div class="acap-head">
            <span>A股 · 资金面</span>
            <span class="acap-head-right">
              <span class="acap-session" data-session>—</span>
              <span class="acap-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="acap-rzrq">
            <div class="acap-rzrq-title"><span>融资融券（两市合计）</span><i data-rzrq-date></i></div>
            <div class="acap-rzrq-grid">
              <div class="acap-stat">
                <div class="acap-stat-label">融资余额</div>
                <div class="acap-stat-value" data-rzye>—</div>
                <div class="acap-stat-chg acap-flat" data-rzye-chg>—</div>
              </div>
              <div class="acap-stat">
                <div class="acap-stat-label">融资净买入</div>
                <div class="acap-stat-value" data-rzjme>—</div>
                <div class="acap-stat-chg acap-flat" data-rzjme-sub>当日买入-偿还</div>
              </div>
              <div class="acap-stat">
                <div class="acap-stat-label">融券余额</div>
                <div class="acap-stat-value" data-rqye>—</div>
                <div class="acap-stat-chg acap-flat" data-rqye-chg>—</div>
              </div>
            </div>
          </div>
          <div class="acap-boards">
            <div class="acap-board">
              <div class="acap-board-title"><span class="acap-in">龙虎榜 · 净买入 TOP 8</span><i data-lhb-buy-note></i></div>
              <table class="data-table acap-table">
                <thead><tr><th>名称</th><th>上榜原因</th><th>净买入</th></tr></thead>
                <tbody data-lhb-buy-body></tbody>
              </table>
            </div>
            <div class="acap-board">
              <div class="acap-board-title"><span class="acap-out">龙虎榜 · 净卖出 TOP 8</span><i data-lhb-sell-note></i></div>
              <table class="data-table acap-table">
                <thead><tr><th>名称</th><th>上榜原因</th><th>净卖出</th></tr></thead>
                <tbody data-lhb-sell-body></tbody>
              </table>
            </div>
          </div>
          <div class="acap-boards">
            <div class="acap-board">
              <div class="acap-board-title"><span class="acap-in">主力净流入 TOP 8</span><i data-zj-buy-note></i></div>
              <table class="data-table acap-table">
                <thead><tr><th>名称</th><th>涨幅</th><th>净流入</th></tr></thead>
                <tbody data-zj-buy-body></tbody>
              </table>
            </div>
            <div class="acap-board">
              <div class="acap-board-title"><span class="acap-out">主力净流出 TOP 8</span><i data-zj-sell-note></i></div>
              <table class="data-table acap-table">
                <thead><tr><th>名称</th><th>涨幅</th><th>净流出</th></tr></thead>
                <tbody data-zj-sell-body></tbody>
              </table>
            </div>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const rzrqDate = el.querySelector('[data-rzrq-date]');
      const rzyeEl = el.querySelector('[data-rzye]');
      const rzyeChgEl = el.querySelector('[data-rzye-chg]');
      const rzjmeEl = el.querySelector('[data-rzjme]');
      const rqyeEl = el.querySelector('[data-rqye]');
      const rqyeChgEl = el.querySelector('[data-rqye-chg]');
      const lhbBuyBody = el.querySelector('[data-lhb-buy-body]');
      const lhbSellBody = el.querySelector('[data-lhb-sell-body]');
      const lhbBuyNote = el.querySelector('[data-lhb-buy-note]');
      const lhbSellNote = el.querySelector('[data-lhb-sell-note]');
      const zjBuyBody = el.querySelector('[data-zj-buy-body]');
      const zjSellBody = el.querySelector('[data-zj-sell-body]');
      const zjBuyNote = el.querySelector('[data-zj-buy-note]');
      const zjSellNote = el.querySelector('[data-zj-sell-note]');

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
        conn.className = 'acap-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'acap-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'acap-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'acap-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'acap-session';
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
        return rows;
      };

      // 主力资金榜：push2 失败时回退 push2delay（延时行情）
      const fetchZjBoard = async (po) => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          try {
            const json = await fetchJson(emUrl(EM_HOSTS[i], po));
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('board error');
      };

      const renderRzrq = (rows) => {
        const cur = rows[0];
        const prev = rows[1] || null;
        const rzye = Number(cur.RZYE);
        const rzrqChg = prev ? rzye - Number(prev.RZYE) : NaN;
        const rzjme = Number(cur.RZJME);
        const rqye = Number(cur.RQYE);
        const rqyeChg = prev ? rqye - Number(prev.RQYE) : NaN;
        rzrqDate.textContent = `${dateOnly(cur.DIM_DATE)}（T+1 披露）`;
        rzyeEl.textContent = fmtYi(rzye);
        rzyeChgEl.textContent = `日变化 ${fmtYiSigned(rzrqChg)}`;
        rzyeChgEl.className = `acap-stat-chg ${dirClass(rzrqChg)}`;
        rzjmeEl.textContent = fmtYiSigned(rzjme);
        rzjmeEl.className = `acap-stat-value ${dirClass(rzjme)}`;
        rqyeEl.textContent = fmtYi(rqye);
        rqyeChgEl.textContent = `日变化 ${fmtYiSigned(rqyeChg)}`;
        rqyeChgEl.className = `acap-stat-chg ${dirClass(rqyeChg)}`;
      };

      const renderRzrqError = () => {
        rzrqDate.textContent = '加载失败';
      };

      // 龙虎榜：取最近交易日的行，按净买入额方向排序（接口已排序，客户端再过滤日期兜底）
      const renderLhb = (tbody, noteEl, rows, isBuy) => {
        const latest = dateOnly(rows[0] && rows[0].TRADE_DATE);
        const list = rows
          .filter((r) => dateOnly(r.TRADE_DATE) === latest)
          .map((r) => ({
            code: String(r.SECURITY_CODE || ''),
            name: String(r.SECURITY_NAME_ABBR || ''),
            reason: String(r.EXPLANATION || ''),
            amt: Number(r.BILLBOARD_NET_AMT),
            pct: Number(r.CHANGE_RATE),
          }))
          .filter((r) => r.code && Number.isFinite(r.amt))
          .slice(0, 8);
        noteEl.textContent = latest ? latest.slice(5) : '';
        if (!list.length) {
          tbody.innerHTML = `<tr class="acap-empty"><td colspan="3">暂无数据</td></tr>`;
          return;
        }
        tbody.innerHTML = list
          .map(
            (r) => `
            <tr>
              <td class="acap-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="acap-reason" title="${esc(r.reason)}">${esc(r.reason)}</td>
              <td class="acap-num ${isBuy ? 'acap-in' : 'acap-out'}">${esc(fmtYi(r.amt))}<i class="acap-sub">${Number.isFinite(r.pct) ? esc(fmtNum(r.pct, 1)) + '%' : ''}</i></td>
            </tr>`
          )
          .join('');
      };

      const renderLhbError = (tbody, noteEl) => {
        noteEl.textContent = '';
        tbody.innerHTML = `<tr class="acap-empty"><td colspan="3">榜单加载失败</td></tr>`;
      };

      const renderZjBoard = (tbody, noteEl, result, isBuy) => {
        const rows = result.rows
          .map((r) => ({
            code: String(r.f12 || ''),
            name: String(r.f14 || ''),
            pct: Number(r.f3),
            amt: Number(r.f62),
            ratio: Number(r.f184),
          }))
          .filter((r) => r.code && Number.isFinite(r.amt))
          .slice(0, 8);
        noteEl.textContent = result.delayed ? '延时行情' : '';
        if (!rows.length) {
          tbody.innerHTML = `<tr class="acap-empty"><td colspan="3">暂无数据</td></tr>`;
          return;
        }
        tbody.innerHTML = rows
          .map(
            (r) => `
            <tr>
              <td class="acap-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="acap-num ${dirClass(r.pct)}">${Number.isFinite(r.pct) ? esc(fmtNum(r.pct, 2)) + '%' : '—'}</td>
              <td class="acap-num ${isBuy ? 'acap-in' : 'acap-out'}">${esc(fmtYi(r.amt))}<i class="acap-sub">${Number.isFinite(r.ratio) ? esc(fmtNum(r.ratio, 1)) + '%' : ''}</i></td>
            </tr>`
          )
          .join('');
      };

      const renderZjError = (tbody, noteEl) => {
        noteEl.textContent = '';
        tbody.innerHTML = `<tr class="acap-empty"><td colspan="3">榜单加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [rzrqRes, lhbBuyRes, lhbSellRes, zjBuyRes, zjSellRes] = await Promise.allSettled([
            fetchDcRows(RZRQ_URL),
            fetchDcRows(lhbUrl('-1')),
            fetchDcRows(lhbUrl('1')),
            fetchZjBoard(1),
            fetchZjBoard(0),
          ]);
          if (!alive) return;
          let anyOk = false;
          if (rzrqRes.status === 'fulfilled') {
            renderRzrq(rzrqRes.value);
            anyOk = true;
          } else {
            renderRzrqError();
          }
          if (lhbBuyRes.status === 'fulfilled') {
            renderLhb(lhbBuyBody, lhbBuyNote, lhbBuyRes.value, true);
            anyOk = true;
          } else {
            renderLhbError(lhbBuyBody, lhbBuyNote);
          }
          if (lhbSellRes.status === 'fulfilled') {
            renderLhb(lhbSellBody, lhbSellNote, lhbSellRes.value, false);
            anyOk = true;
          } else {
            renderLhbError(lhbSellBody, lhbSellNote);
          }
          if (zjBuyRes.status === 'fulfilled') renderZjBoard(zjBuyBody, zjBuyNote, zjBuyRes.value, true);
          else renderZjError(zjBuyBody, zjBuyNote);
          if (zjSellRes.status === 'fulfilled') renderZjBoard(zjSellBody, zjSellNote, zjSellRes.value, false);
          else renderZjError(zjSellBody, zjSellNote);
          if (anyOk || zjBuyRes.status === 'fulfilled' || zjSellRes.status === 'fulfilled') clearError();
          else showError('资金面数据加载失败，30 秒后自动重试…');
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
