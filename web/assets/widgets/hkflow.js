/* 港股通·南向资金 — 南向成交净买入/成交额 + 港股通持股占比榜（东财 datacenter-web，CORS JSON）
 * 接口（均已 curl 实测 2026-07-16，带 Origin 响应 Access-Control-Allow-Origin: *）：
 * ① 南向资金: https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY
 *    filter=(MUTUAL_TYPE in ("002","004","006"))，002=港股通(沪) 004=港股通(深) 006=南向合计。
 *    字段: TRADE_DATE=日期 NET_DEAL_AMT=成交净买入 BUY_AMT=买入成交额 SELL_AMT=卖出成交额 DEAL_AMT=成交总额
 *    （金额单位=百万港元，东财页面 formatter zoom:6 证实；÷100 得亿港元）
 *    INDEX_CLOSE_PRICE/INDEX_CHANGE_RATE=恒生指数（006 行）。当日行盘后即有，盘中可能不存在 → 永远展示日期。
 *    北向(001/003/005)同报表 NET/BUY/SELL 已为 null（2024-08 停止披露），本组件只用南向。
 * ② 港股通持股: 同站 reportName=RPT_MUTUAL_STOCK_HOLDRANKS，filter=(TRADE_DATE='…')(RN=1)（RN=1=沪深合并去重行）。
 *    字段: SECURITY_NAME/SECURITY_CODE=名称/代码 HOLD_SHARES_RATIO=持股占港股股本比例%
 *    HOLD_MARKET_CAP=持股市值(元) ADD_SHARES_REPAIR=当日增持股数(股) CHANGE_RATE=当日涨跌幅%。
 *    T+1 披露（2026-07-16 盘中实测最近日期为 07-15）；取最近 10 天内最大 TRADE_DATE 的 TOP10。
 * 已放弃的接口（实测 2026-07-16 不可用）：
 *    push2/push2delay 的 qt/kamt/get、kamt.rtmin/get、kamtbs.rtmin/get —— 北向停披后南向亦为
 *    零值/满额占位数据（dayNetAmtIn≡dayAmtThreshold），不可信；RPT_MUTUAL_STOCK_NORTHSTA 持续 9701。
 * 配色：本组件按主控约定 绿=流入/涨 var(--up) 红=流出/跌 var(--down)（与 hkboard 红涨绿跌相反，勿混用）。
 * Registers as custom tool id 'hkflow' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DC_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  // 南向资金：一次取 002/004/006 近 6 个交易日（按日期倒序、类型升序）
  const FLOW_COLS = 'MUTUAL_TYPE,TRADE_DATE,NET_DEAL_AMT,BUY_AMT,SELL_AMT,DEAL_AMT,INDEX_CLOSE_PRICE,INDEX_CHANGE_RATE';
  const FLOW_URL =
    `${DC_BASE}?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=${FLOW_COLS}` +
    `&filter=${encodeURIComponent('(MUTUAL_TYPE in ("002","004","006"))')}` +
    `&pageNumber=1&pageSize=18&sortColumns=TRADE_DATE,MUTUAL_TYPE&sortTypes=-1,1&source=WEB&client=WEB`;
  // 港股通持股占比榜：最近 10 天窗口内按日期倒序 + 占比倒序，客户端再锁定最大日期
  const HOLD_COLS = 'SECURITY_NAME,SECURITY_CODE,TRADE_DATE,HOLD_SHARES_RATIO,HOLD_MARKET_CAP,ADD_SHARES_REPAIR,CHANGE_RATE';
  const holdUrl = () => {
    const since = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    return (
      `${DC_BASE}?reportName=RPT_MUTUAL_STOCK_HOLDRANKS&columns=${HOLD_COLS}` +
      `&filter=${encodeURIComponent(`(TRADE_DATE>='${since}')(RN=1)`)}` +
      `&pageNumber=1&pageSize=10&sortColumns=TRADE_DATE,HOLD_SHARES_RATIO&sortTypes=-1,-1&source=WEB&client=WEB`
    );
  };
  const DETAIL_URL = (code) => `https://quote.eastmoney.com/hk/${code}.html`; // 同 hkboard 已验证 200

  const FLOW_TYPES = ['006', '002', '004']; // 合计 / 沪 / 深
  const BOARD_SIZE = 10;
  const TREND_DAYS = 6;
  const REFRESH_MS = 60000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('hkflow-style')) return;
    const style = document.createElement('style');
    style.id = 'hkflow-style';
    style.textContent = `
.hkflow-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.hkflow-head-right { display: flex; align-items: center; gap: 8px; }
.hkflow-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.hkflow-session.open { color: var(--acc); border-color: var(--acc); background: var(--acc-glow); }
.hkflow-status { color: var(--warning); white-space: nowrap; }
.hkflow-status.live { color: var(--acc); }
/* 本组件约定（主控指定）：绿=流入/涨 var(--up)，红=流出/跌 var(--down)，与 hkboard 红涨绿跌相反 */
.hkflow-up { color: var(--up); }
.hkflow-down { color: var(--down); }
.hkflow-flat { color: var(--text-muted); }
.hkflow-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--surface-raised);
  min-width: 0;
}
.hkflow-card-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.hkflow-card-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; white-space: nowrap; }
.hkflow-net {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  min-width: 0;
}
.hkflow-net-label { font-size: 10px; color: var(--text-muted); white-space: nowrap; }
.hkflow-net-value {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  line-height: 1.2;
}
.hkflow-net-hsi {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hkflow-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 6px;
}
@media (max-width: 720px) {
  .hkflow-grid { grid-template-columns: 1fr; }
}
.hkflow-stat { min-width: 0; }
.hkflow-stat-label { font-size: 9px; color: var(--text-muted); margin-bottom: 2px; white-space: nowrap; }
.hkflow-stat-value {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  line-height: 1.25;
}
.hkflow-split {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.hkflow-split b { font-weight: 600; }
.hkflow-trend {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 34px;
  padding-top: 6px;
  border-top: 1px solid var(--hairline);
}
.hkflow-bar {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100%;
  position: relative;
}
.hkflow-bar i {
  display: block;
  width: 100%;
  min-height: 1px;
  border-radius: 2px 2px 0 0;
  background: var(--up);
}
.hkflow-bar.neg i { border-radius: 0 0 2px 2px; background: var(--down); }
.hkflow-bar.neg { justify-content: flex-start; }
.hkflow-bar span {
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  transform: translateY(100%);
  white-space: nowrap;
  overflow: visible;
}
.hkflow-trend-wrap { margin-bottom: 12px; }
.hkflow-table { font-variant-numeric: tabular-nums; table-layout: fixed; width: 100%; }
.hkflow-table th, .hkflow-table td { white-space: nowrap; }
.hkflow-table tbody tr { cursor: pointer; }
.hkflow-table tbody td { transition: background 0.3s var(--ease-fluid); }
.hkflow-table tbody tr:hover td { background: color-mix(in srgb, var(--acc) 6%, transparent); }
.hkflow-num { font-family: var(--font-mono); }
.hkflow-stock { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.hkflow-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.hkflow-ratio { width: 100%; }
.hkflow-ratio-cell { display: flex; align-items: center; gap: 6px; }
.hkflow-ratio-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: var(--hairline);
  overflow: hidden;
  min-width: 20px;
}
.hkflow-ratio-bar i { display: block; height: 100%; background: var(--acc); }
.hkflow-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
  cursor: default;
}
.hkflow-empty:hover td { background: transparent; }
.hkflow-foot {
  font-size: 9px;
  color: var(--text-dim);
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
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

  // 南向资金接口金额单位=百万港元 → 亿港元字符串
  const fmtYi = (millions, digits) => {
    if (!Number.isFinite(millions)) return '—';
    return `${fmtNum(millions / 100, digits == null ? 1 : digits)}亿`;
  };
  const fmtYiSigned = (millions) => {
    if (!Number.isFinite(millions)) return '—';
    return (millions > 0 ? '+' : '') + fmtYi(millions);
  };

  // 资金方向着色：流入/净买入=绿 var(--up)，流出/净卖出=红 var(--down)
  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'hkflow-flat';
    return v > 0 ? 'hkflow-up' : 'hkflow-down';
  };

  const dateOnly = (s) => String(s || '').slice(0, 10);

  // 港股交易时段（香港=北京时间 UTC+8）：周一至五 09:30-12:00 / 13:00-16:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const now = new Date();
    const hk = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const day = hk.getDay();
    const mins = hk.getHours() * 60 + hk.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 570 && mins < 720) || (mins >= 780 && mins <= 960)) return 'trading';
    if (mins >= 720 && mins < 780) return 'lunch';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['hkflow'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool hkflow-root">
          <div class="hkflow-head">
            <span>港股通 · 南向资金</span>
            <span class="hkflow-head-right">
              <span class="hkflow-session" data-session>—</span>
              <span class="hkflow-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="hkflow-card">
            <div class="hkflow-card-title"><span>南向成交（港币）</span><i data-flow-date></i></div>
            <div class="hkflow-net">
              <span class="hkflow-net-label">成交净买入</span>
              <span class="hkflow-net-value hkflow-flat" data-net>—</span>
              <span class="hkflow-net-hsi" data-hsi></span>
            </div>
            <div class="hkflow-grid">
              <div class="hkflow-stat">
                <div class="hkflow-stat-label">买入成交额</div>
                <div class="hkflow-stat-value" data-buy>—</div>
              </div>
              <div class="hkflow-stat">
                <div class="hkflow-stat-label">卖出成交额</div>
                <div class="hkflow-stat-value" data-sell>—</div>
              </div>
              <div class="hkflow-stat">
                <div class="hkflow-stat-label">成交总额</div>
                <div class="hkflow-stat-value" data-deal>—</div>
              </div>
            </div>
            <div class="hkflow-split" data-split>—</div>
            <div class="hkflow-trend-wrap">
              <div class="hkflow-trend" data-trend></div>
            </div>
          </div>
          <div class="hkflow-card">
            <div class="hkflow-card-title"><span>港股通持股占比 TOP 10</span><i data-hold-date></i></div>
            <table class="data-table hkflow-table">
              <thead><tr><th>名称</th><th style="width:34%">占股本</th><th>持股市值</th><th>日增持</th></tr></thead>
              <tbody data-hold-body></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="hkflow-foot">
            <span>来源：东方财富 · 沪深港通（T+0 成交 / T+1 持股）</span>
            <span data-updated>更新 —</span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const flowDate = el.querySelector('[data-flow-date]');
      const netEl = el.querySelector('[data-net]');
      const hsiEl = el.querySelector('[data-hsi]');
      const buyEl = el.querySelector('[data-buy]');
      const sellEl = el.querySelector('[data-sell]');
      const dealEl = el.querySelector('[data-deal]');
      const splitEl = el.querySelector('[data-split]');
      const trendEl = el.querySelector('[data-trend]');
      const holdDate = el.querySelector('[data-hold-date]');
      const holdBody = el.querySelector('[data-hold-body]');
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
        conn.className = 'hkflow-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'hkflow-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'hkflow-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'hkflow-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'hkflow-session';
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

      // 南向资金：按 日期→类型 组织，最新日期的 006/002/004 + 006 历史
      const renderFlow = (rows) => {
        const byDateType = {};
        rows.forEach((r) => {
          byDateType[`${dateOnly(r.TRADE_DATE)}|${r.MUTUAL_TYPE}`] = r;
        });
        const dates = [...new Set(rows.map((r) => dateOnly(r.TRADE_DATE)))].sort().reverse();
        const latest = dates[0];
        const total = byDateType[`${latest}|006`] || byDateType[`${latest}|002`] || rows[0];
        const sh = byDateType[`${latest}|002`];
        const sz = byDateType[`${latest}|004`];
        if (!total) throw new Error('no total row');

        const net = Number(total.NET_DEAL_AMT);
        const buy = Number(total.BUY_AMT);
        const sell = Number(total.SELL_AMT);
        const deal = Number(total.DEAL_AMT);
        flowDate.textContent = latest;
        netEl.textContent = fmtYiSigned(net);
        netEl.className = `hkflow-net-value ${dirClass(net)}`;
        const hsiChg = Number(total.INDEX_CHANGE_RATE);
        hsiEl.textContent = Number.isFinite(hsiChg)
          ? `恒指 ${fmtNum(Number(total.INDEX_CLOSE_PRICE), 2)} (${(hsiChg > 0 ? '+' : '') + fmtNum(hsiChg, 2)}%)`
          : '';
        hsiEl.className = `hkflow-net-hsi ${dirClass(hsiChg)}`;
        buyEl.textContent = fmtYi(buy);
        sellEl.textContent = fmtYi(sell);
        dealEl.textContent = fmtYi(deal);

        if (sh || sz) {
          const shNet = sh ? Number(sh.NET_DEAL_AMT) : NaN;
          const szNet = sz ? Number(sz.NET_DEAL_AMT) : NaN;
          splitEl.innerHTML =
            `港股通(沪) <b class="${dirClass(shNet)}">${esc(fmtYiSigned(shNet))}</b>` +
            ` · 港股通(深) <b class="${dirClass(szNet)}">${esc(fmtYiSigned(szNet))}</b>`;
        } else {
          splitEl.textContent = '';
        }

        // 近 N 日净买入条（006 合计，按日期升序）
        const trend = dates
          .slice(0, TREND_DAYS)
          .map((d) => ({ date: d, net: Number((byDateType[`${d}|006`] || {}).NET_DEAL_AMT) }))
          .filter((t) => Number.isFinite(t.net))
          .reverse();
        const maxAbs = Math.max(...trend.map((t) => Math.abs(t.net)), 1);
        trendEl.innerHTML = trend
          .map((t) => {
            const h = Math.max(4, Math.round((Math.abs(t.net) / maxAbs) * 100));
            const cls = t.net >= 0 ? '' : 'neg';
            return `<div class="hkflow-bar ${cls}" title="${esc(t.date)} 净买入 ${esc(fmtYiSigned(t.net))}"><i style="height:${h}%"></i><span>${esc(t.date.slice(5))}</span></div>`;
          })
          .join('');
      };

      const renderFlowError = () => {
        flowDate.textContent = '加载失败';
        trendEl.innerHTML = '';
      };

      // 持股占比榜：行集已按 日期倒序+占比倒序，锁定最大日期
      const renderHold = (rows) => {
        const latest = dateOnly(rows[0] && rows[0].TRADE_DATE);
        const list = rows
          .filter((r) => dateOnly(r.TRADE_DATE) === latest)
          .map((r) => ({
            code: String(r.SECURITY_CODE || ''),
            name: String(r.SECURITY_NAME || ''),
            ratio: Number(r.HOLD_SHARES_RATIO),
            cap: Number(r.HOLD_MARKET_CAP), // 元
            add: Number(r.ADD_SHARES_REPAIR), // 股
            pct: Number(r.CHANGE_RATE),
          }))
          .filter((r) => r.code && Number.isFinite(r.ratio))
          .slice(0, BOARD_SIZE);
        holdDate.textContent = latest ? `${latest}（T+1）` : '';
        if (!list.length) {
          holdBody.innerHTML = `<tr class="hkflow-empty"><td colspan="4">暂无数据</td></tr>`;
          return;
        }
        const maxRatio = Math.max(...list.map((r) => r.ratio), 1);
        holdBody.innerHTML = list
          .map((r) => {
            const w = Math.max(2, Math.round((r.ratio / maxRatio) * 100));
            const addWan = Number.isFinite(r.add) ? r.add / 1e4 : NaN;
            return `
            <tr data-hkcode="${esc(r.code)}" title="查看 ${esc(r.name)} 详情">
              <td class="hkflow-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td><span class="hkflow-ratio-cell"><span class="hkflow-num">${esc(fmtNum(r.ratio, 1))}%</span><span class="hkflow-ratio-bar"><i style="width:${w}%"></i></span></span></td>
              <td class="hkflow-num">${Number.isFinite(r.cap) ? esc(fmtNum(r.cap / 1e8, 1)) + '亿' : '—'}</td>
              <td class="hkflow-num ${dirClass(addWan)}">${Number.isFinite(addWan) ? esc((addWan > 0 ? '+' : '') + fmtNum(addWan, 0)) + '万' : '—'}</td>
            </tr>`;
          })
          .join('');
      };

      const renderHoldError = () => {
        holdDate.textContent = '';
        holdBody.innerHTML = `<tr class="hkflow-empty"><td colspan="4">榜单加载失败</td></tr>`;
      };

      // 行点击跳转东财港股详情页（新标签页，noopener）
      const onHoldClick = (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-hkcode]') : null;
        if (!tr) return;
        const code = tr.getAttribute('data-hkcode');
        if (code) window.open(DETAIL_URL(code), '_blank', 'noopener');
      };
      holdBody.addEventListener('click', onHoldClick);

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [flowRes, holdRes] = await Promise.allSettled([fetchDcRows(FLOW_URL), fetchDcRows(holdUrl())]);
          if (!alive) return;
          let anyOk = false;
          if (flowRes.status === 'fulfilled') {
            try {
              renderFlow(flowRes.value);
              anyOk = true;
            } catch (e) {
              renderFlowError();
            }
          } else {
            renderFlowError();
          }
          if (holdRes.status === 'fulfilled') {
            renderHold(holdRes.value);
            anyOk = true;
          } else {
            renderHoldError();
          }
          if (anyOk) {
            clearError();
            const hk = new Date(Date.now() + (new Date().getTimezoneOffset() + 8 * 60) * 60000);
            updatedEl.textContent = `更新 ${String(hk.getHours()).padStart(2, '0')}:${String(hk.getMinutes()).padStart(2, '0')}`;
          } else {
            showError('南向资金数据加载失败，60 秒后自动重试…');
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
        holdBody.removeEventListener('click', onHoldClick);
      };
    },
  };
})();
