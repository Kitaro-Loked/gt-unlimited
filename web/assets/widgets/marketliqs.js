/* 全市场爆仓聚合 — Binance / OKX / Bybit 公开强平 WS（无需 API key）
 * 数据源（浏览器直连，WebSocket 不受 CORS 限制，无需 JSONP）：
 *  - Binance USDⓈ-M: wss://fstream.binance.com/ws/!forceOrder@arr
 *      {o:{s,S,p,q,T}}；S=SELL 表示多仓被强平卖出（多爆），BUY=空爆。
 *  - OKX: wss://ws.okx.com:8443/ws/v5/public，订阅
 *      {"op":"subscribe","args":[{"channel":"liquidation-orders","instType":"SWAP"}]}
 *      每 ~25s 发送字符串 ping 保活（服务端回 "pong"）。
 *      data[].details[] 实测字段：instId/posSide/side/sz/bkPx/ts（bkPx=破产价）；
 *      posSide=long（或 net 模式下 side=sell）判为多爆。sz 单位为「张」，
 *      需乘合约面值 ctVal 才是真实名义价值：mount 时经 REST
 *      https://www.okx.com/api/v5/public/instruments?instType=SWAP （已验证
 *      返回 Access-Control-Allow-Origin，可跨域）拉取面值表；失败则回退 sz×价格。
 *  - Bybit: wss://stream.bybit.com/v5/public/linear，一次性订阅
 *      allLiquidation.<SYM> × 20（旧的 liquidation.<SYM> 主题已下线，
 *      服务端返回 "handler not found"）；每 20s 发 {"op":"ping"} 保活。
 *      data 为数组 [{T,s,S,v,p}]；注意 S 是「持仓方向」（官方文档：
 *      S=Buy 表示多仓被强平），与 Binance 订单方向语义相反：
 *      S=Buy → 多爆，S=Sell → 空爆。
 * 统计均为滚动 1 小时窗口；事件流最多保留 50 行（内存环形缓冲，不持久化）。
 * Registers as custom tool id 'marketliqs' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const RECONNECT_MS = 3000; // 每个连接独立 3 秒退避重连
  const STATS_WINDOW_MS = 3600 * 1000; // 最近 1 小时统计窗口
  const STATS_PRUNE_MS = 30000; // 无新事件时也周期性衰减统计
  const MAX_ROWS = 50; // 事件流环形缓冲上限
  const OKX_PING_MS = 25000;
  const BYBIT_PING_MS = 20000;
  const OKX_INSTRUMENTS_URL = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
  const BYBIT_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'BCHUSDT',
    'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'TONUSDT', 'TRXUSDT', 'DOTUSDT', 'AVAXUSDT', 'UNIUSDT',
  ];

  const EXCHANGES = {
    binance: { label: 'BIN', name: 'Binance', ws: 'wss://fstream.binance.com/ws/!forceOrder@arr' },
    okx: { label: 'OKX', name: 'OKX', ws: 'wss://ws.okx.com:8443/ws/v5/public' },
    bybit: { label: 'BYB', name: 'Bybit', ws: 'wss://stream.bybit.com/v5/public/linear' },
  };

  function injectStyle() {
    if (document.getElementById('mliq-style')) return;
    const style = document.createElement('style');
    style.id = 'mliq-style';
    style.textContent = `
.mliq-head {
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
  font-size: 9px; letter-spacing: 0.14em; color: var(--text-muted); margin-bottom: 8px;
}
.mliq-conns { display: flex; gap: 8px; }
.mliq-conn { font-family: var(--font-mono); font-size: 9px; color: var(--text-dim); white-space: nowrap; }
.mliq-conn i { font-style: normal; color: var(--warning); margin-right: 2px; }
.mliq-conn.live { color: var(--text-muted); }
.mliq-conn.live i { color: var(--acc); }
.mliq-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
.mliq-stat {
  border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 8px 10px;
  display: flex; flex-direction: column; gap: 3px; min-width: 0;
}
.mliq-stat-label { font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); text-transform: uppercase; }
.mliq-stat-value {
  font-family: var(--font-mono); font-size: 15px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums;
}
.mliq-stat-value.long { color: var(--down); }
.mliq-stat-value.short { color: var(--up); }
.mliq-bar {
  display: flex; height: 8px; border-radius: 999px; overflow: hidden;
  border: 1px solid var(--hairline); margin-bottom: 8px;
}
.mliq-bar-seg { height: 100%; width: 0; transition: width 0.4s var(--ease-fluid); }
.mliq-bar-seg.long { background: var(--down); }
.mliq-bar-seg.short { background: var(--up); }
.mliq-exlist { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.mliq-exrow { display: flex; align-items: center; gap: 8px; font-size: 10px; }
.mliq-exrow .mliq-exb { min-width: 34px; text-align: center; }
.mliq-exusd { flex: 0 0 auto; min-width: 64px; text-align: right; color: var(--text); }
.mliq-minibar { flex: 1; display: flex; height: 5px; border-radius: 999px; overflow: hidden; background: var(--hairline); }
.mliq-minibar i { display: block; height: 100%; width: 0; transition: width 0.4s var(--ease-fluid); }
.mliq-minibar i.l { background: var(--down); }
.mliq-minibar i.s { background: var(--up); }
.mliq-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
.mliq-tab {
  background: transparent; color: var(--text-muted); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); font-size: 10px; padding: 2px 8px; font-family: inherit; cursor: pointer;
}
.mliq-tab.on { color: var(--acc); border-color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, transparent); }
.mliq-tab:focus { outline: 1px solid var(--acc); }
.mliq-filter-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px; }
.mliq-filter {
  background: var(--surface-raised); color: var(--text); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); font-size: 11px; padding: 3px 6px; font-family: inherit; cursor: pointer;
}
.mliq-filter:focus { outline: 1px solid var(--acc); }
.mliq-count { font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); }
.mliq-list-wrap { max-height: 320px; overflow-y: auto; }
.mliq-table { font-variant-numeric: tabular-nums; }
.mliq-table th, .mliq-table td { white-space: nowrap; }
.mliq-num { font-family: var(--font-mono); }
.mliq-time { color: var(--text-muted); font-size: 10px; }
.mliq-sym { font-weight: 600; }
.mliq-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.mliq-exb {
  display: inline-block; font-family: var(--font-mono); font-size: 9px;
  padding: 1px 4px; border-radius: 3px; border: 1px solid var(--hairline);
}
.mliq-exb.binance { color: #f0b90b; }
.mliq-exb.okx { color: var(--text); }
.mliq-exb.bybit { color: #f7a600; }
.mliq-badge {
  display: inline-block; font-size: 10px; padding: 1px 6px;
  border-radius: 999px; border: 1px solid transparent;
}
.mliq-badge.long { color: var(--down); border-color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
.mliq-badge.short { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
.mliq-usd.long { color: var(--down); }
.mliq-usd.short { color: var(--up); }
.mliq-empty td { text-align: center; color: var(--text-muted); font-size: 11px; padding: 14px 4px; }
@keyframes mliqInLong {
  0% { opacity: 0; transform: translateY(-10px); }
  100% { opacity: 1; transform: none; }
}
@keyframes mliqInShort {
  0% { opacity: 0; transform: translateY(-10px); }
  100% { opacity: 1; transform: none; }
}
tr.mliq-new.long { animation: mliqInLong 0.6s var(--ease-snap); }
tr.mliq-new.short { animation: mliqInShort 0.6s var(--ease-snap); }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtUsd = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `$${v.toFixed(2)}`;
  };

  const fmtPrice = (p) => {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toPrecision(4);
  };

  const fmtTime = (t) => {
    const d = new Date(t);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };

  // 统一品种显示：Binance/Bybit 为 "BTCUSDT"，OKX 为 "BTC-USDT-SWAP"
  const splitSym = (raw) => {
    const s = String(raw || '');
    if (s.indexOf('-') !== -1) {
      const parts = s.split('-');
      return { base: parts[0], quote: parts[1] || '' };
    }
    if (s.endsWith('USDT')) return { base: s.slice(0, -4), quote: 'USDT' };
    return { base: s, quote: '' };
  };

  window.GT_EXTRA_TOOLS['marketliqs'] = {
    mount(el, setStatus) {
      injectStyle();

      const exKeys = Object.keys(EXCHANGES);
      el.innerHTML = `
        <div class="tool mliq-root">
          <div class="mliq-head">
            <span>全市场爆仓 · 多交易所</span>
            <span class="mliq-conns">
              ${exKeys
                .map(
                  (k) =>
                    `<span class="mliq-conn" data-conn="${k}" title="${EXCHANGES[k].name}"><i>●</i>${EXCHANGES[k].label}</span>`
                )
                .join('')}
            </span>
          </div>
          <div class="mliq-stats">
            <div class="mliq-stat"><span class="mliq-stat-label">多仓爆仓 · 1H</span><span class="mliq-stat-value long" data-long>$0.00</span></div>
            <div class="mliq-stat"><span class="mliq-stat-label">空仓爆仓 · 1H</span><span class="mliq-stat-value short" data-short>$0.00</span></div>
            <div class="mliq-stat"><span class="mliq-stat-label">合计 · 1H</span><span class="mliq-stat-value" data-total>$0.00</span></div>
          </div>
          <div class="mliq-bar"><span class="mliq-bar-seg long" data-bar-long></span><span class="mliq-bar-seg short" data-bar-short></span></div>
          <div class="mliq-exlist">
            ${exKeys
              .map(
                (k) => `
              <div class="mliq-exrow">
                <span class="mliq-exb ${k}">${EXCHANGES[k].label}</span>
                <span class="mliq-exusd mliq-num" data-exusd="${k}">$0.00</span>
                <span class="mliq-minibar"><i class="l" data-exl="${k}"></i><i class="s" data-exs="${k}"></i></span>
              </div>`
              )
              .join('')}
          </div>
          <div class="mliq-tabs" data-tabs>
            <button class="mliq-tab on" data-ex="all">全部</button>
            ${exKeys.map((k) => `<button class="mliq-tab" data-ex="${k}">${EXCHANGES[k].name}</button>`).join('')}
          </div>
          <div class="mliq-filter-row">
            <select class="mliq-filter" data-filter title="按美元价值过滤">
              <option value="0" selected>全部</option>
              <option value="10000">≥ $1万</option>
              <option value="100000">≥ $10万</option>
              <option value="1000000">≥ $100万</option>
            </select>
            <span class="mliq-count" data-count>0 条</span>
          </div>
          <div class="mliq-list-wrap">
            <table class="data-table mliq-table">
              <thead>
                <tr><th>时间</th><th>交易所</th><th>品种</th><th>方向</th><th>价格</th><th>金额</th></tr>
              </thead>
              <tbody data-body></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const connEls = {};
      const exUsdEls = {};
      const exBarLEls = {};
      const exBarSEls = {};
      exKeys.forEach((k) => {
        connEls[k] = el.querySelector(`[data-conn="${k}"]`);
        exUsdEls[k] = el.querySelector(`[data-exusd="${k}"]`);
        exBarLEls[k] = el.querySelector(`[data-exl="${k}"]`);
        exBarSEls[k] = el.querySelector(`[data-exs="${k}"]`);
      });
      const hint = el.querySelector('[data-hint]');
      const longEl = el.querySelector('[data-long]');
      const shortEl = el.querySelector('[data-short]');
      const totalEl = el.querySelector('[data-total]');
      const barLong = el.querySelector('[data-bar-long]');
      const barShort = el.querySelector('[data-bar-short]');
      const tabsEl = el.querySelector('[data-tabs]');
      const filterSel = el.querySelector('[data-filter]');
      const countEl = el.querySelector('[data-count]');
      const body = el.querySelector('[data-body]');

      const events = []; // 环形缓冲：最新在前，最多 MAX_ROWS 条
      const hourStats = []; // {t, ex, usd, isLong} 滚动 1 小时统计
      let exFilter = 'all';
      let minUsd = 0;
      let alive = true;
      let pruneTimer = null;
      let okxCtVal = null; // OKX 合约面值表：instId -> {v: ctVal, ccy: ctValCcy}
      const abortCtl = new AbortController();
      const conns = {}; // exKey -> {ws, live, everLive, reconnectTimer, pingTimer}

      const refreshOverall = () => {
        const liveN = exKeys.filter((k) => conns[k] && conns[k].live).length;
        if (liveN > 0) {
          hint.style.display = 'none';
          setStatus('online');
        } else if (exKeys.some((k) => conns[k] && conns[k].everLive)) {
          hint.textContent = `所有行情连接已断开，${RECONNECT_MS / 1000} 秒后自动重连…`;
          hint.style.display = '';
          setStatus('offline');
        }
      };

      const setBadge = (k, live) => {
        connEls[k].className = live ? 'mliq-conn live' : 'mliq-conn';
      };

      const passesFilter = (ev) => (exFilter === 'all' || ev.ex === exFilter) && ev.usd >= minUsd;

      const rowHtml = (ev) => {
        const side = ev.isLong ? 'long' : 'short';
        const sp = splitSym(ev.sym);
        const sym = sp.quote ? `${esc(sp.base)}<i>/${esc(sp.quote)}</i>` : esc(sp.base);
        return `
          <td class="mliq-num mliq-time">${fmtTime(ev.t)}</td>
          <td><span class="mliq-exb ${ev.ex}">${EXCHANGES[ev.ex].label}</span></td>
          <td class="mliq-sym">${sym}</td>
          <td><span class="mliq-badge ${side}">${ev.isLong ? '多爆' : '空爆'}</span></td>
          <td class="mliq-num">${fmtPrice(ev.p)}</td>
          <td class="mliq-num mliq-usd ${side}">${fmtUsd(ev.usd)}</td>`;
      };

      const renderEmpty = () => {
        const visible = events.filter(passesFilter).length;
        countEl.textContent = `${visible} 条`;
        if (visible > 0) return;
        body.innerHTML = `
          <tr class="mliq-empty"><td colspan="6">${events.length ? '无符合过滤条件的爆仓事件' : '等待爆仓事件…'}</td></tr>`;
      };

      const makeRow = (ev, animate) => {
        const tr = document.createElement('tr');
        if (animate) tr.className = `mliq-new ${ev.isLong ? 'long' : 'short'}`;
        tr.innerHTML = rowHtml(ev);
        return tr;
      };

      const addRow = (ev) => {
        if (!passesFilter(ev)) return;
        const empty = body.querySelector('.mliq-empty');
        if (empty) empty.remove();
        body.insertBefore(makeRow(ev, true), body.firstChild);
        while (body.children.length > MAX_ROWS) body.removeChild(body.lastChild);
        countEl.textContent = `${body.children.length} 条`;
      };

      const rerenderList = () => {
        body.innerHTML = '';
        events.filter(passesFilter).forEach((ev) => body.appendChild(makeRow(ev, false)));
        renderEmpty();
      };

      const pruneStats = () => {
        const cut = Date.now() - STATS_WINDOW_MS;
        while (hourStats.length && hourStats[0].t < cut) hourStats.shift();
      };

      const updateStats = () => {
        pruneStats();
        let longUsd = 0;
        let shortUsd = 0;
        const perEx = {};
        exKeys.forEach((k) => {
          perEx[k] = { long: 0, short: 0 };
        });
        hourStats.forEach((s) => {
          if (s.isLong) longUsd += s.usd;
          else shortUsd += s.usd;
          if (perEx[s.ex]) {
            if (s.isLong) perEx[s.ex].long += s.usd;
            else perEx[s.ex].short += s.usd;
          }
        });
        const total = longUsd + shortUsd;
        longEl.textContent = fmtUsd(longUsd);
        shortEl.textContent = fmtUsd(shortUsd);
        totalEl.textContent = fmtUsd(total);
        barLong.style.width = total > 0 ? `${((longUsd / total) * 100).toFixed(2)}%` : '0';
        barShort.style.width = total > 0 ? `${((shortUsd / total) * 100).toFixed(2)}%` : '0';
        exKeys.forEach((k) => {
          const t = perEx[k].long + perEx[k].short;
          exUsdEls[k].textContent = fmtUsd(t);
          exBarLEls[k].style.width = t > 0 ? `${((perEx[k].long / t) * 100).toFixed(2)}%` : '0';
          exBarSEls[k].style.width = t > 0 ? `${((perEx[k].short / t) * 100).toFixed(2)}%` : '0';
        });
      };

      const handleEvent = (ev) => {
        events.unshift(ev);
        if (events.length > MAX_ROWS) events.length = MAX_ROWS;
        hourStats.push({ t: Date.now(), ex: ev.ex, usd: ev.usd, isLong: ev.isLong });
        addRow(ev);
        updateStats();
      };

      // --- 各交易所消息解析（均防御性解析，字段缺失即跳过该条） ---
      // Binance: SELL=多仓被强平卖出（多爆），BUY=空爆
      const onBinanceMsg = (data) => {
        const arr = Array.isArray(data) ? data : [data];
        arr.forEach((d) => {
          const o = d && d.o;
          if (!o) return;
          const p = parseFloat(o.p);
          const q = parseFloat(o.q);
          if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0 || !o.s) return;
          handleEvent({
            t: Number(o.T) || Date.now(),
            ex: 'binance',
            sym: String(o.s),
            isLong: o.S === 'SELL',
            p,
            usd: p * q,
          });
        });
      };

      // OKX: data[].details[]；posSide=long → 多爆，posSide=short → 空爆；
      // 单向持仓（posSide=net）时回退用订单方向 side=sell → 多爆。
      // sz 单位为张：usdt 面值以币计 → usd=sz×ctVal×价格；币本位面值以 USD 计 → usd=sz×ctVal。
      const onOkxMsg = (data) => {
        if (!data || !Array.isArray(data.data)) return;
        data.data.forEach((entry) => {
          if (!entry || !Array.isArray(entry.details)) return;
          entry.details.forEach((d) => {
            if (!d) return;
            const instId = String(d.instId || entry.instId || '');
            const sz = parseFloat(d.sz);
            const px = parseFloat(d.bkPx || d.mkPx || d.idxPx); // 实测推送带 bkPx（破产价）
            if (!instId || !Number.isFinite(sz) || sz <= 0 || !Number.isFinite(px) || px <= 0) return;
            // posSide=long/short 直接判定；单向持仓模式 posSide=net 时回退订单方向 side=sell → 多爆
            const isLong = d.posSide === 'long' ? true : d.posSide === 'short' ? false : d.side === 'sell';
            let usd = NaN;
            const ct = okxCtVal && okxCtVal[instId];
            if (ct && Number.isFinite(ct.v) && ct.v > 0) {
              usd = ct.ccy === 'USD' ? sz * ct.v : sz * ct.v * px;
            } else {
              usd = sz * px; // 面值表不可用时的近似回退
            }
            if (!Number.isFinite(usd) || usd <= 0) return;
            handleEvent({
              t: Number(d.ts) || Date.now(),
              ex: 'okx',
              sym: instId,
              isLong,
              p: px,
              usd,
            });
          });
        });
      };

      // Bybit allLiquidation：S 为「持仓方向」（官方文档：S=Buy 表示多仓被强平），
      // 与 Binance 订单方向语义相反 —— S=Buy → 多爆，S=Sell → 空爆。
      const onBybitMsg = (data) => {
        if (!data || typeof data.topic !== 'string' || data.topic.indexOf('allLiquidation.') !== 0) return;
        const arr = Array.isArray(data.data) ? data.data : [data.data];
        arr.forEach((d) => {
          if (!d) return;
          const p = parseFloat(d.p);
          const v = parseFloat(d.v);
          if (!d.s || !Number.isFinite(p) || !Number.isFinite(v) || p <= 0 || v <= 0) return;
          handleEvent({
            t: Number(d.T) || Date.now(),
            ex: 'bybit',
            sym: String(d.s),
            isLong: d.S === 'Buy',
            p,
            usd: p * v,
          });
        });
      };

      // --- 通用连接工厂：独立重连（3s 退避）、独立 ping 保活、独立状态徽标 ---
      const makeConn = (key, { onMsg, onOpen, pingMsg, pingMs }) => {
        const c = { ws: null, live: false, everLive: false, reconnectTimer: null, pingTimer: null };
        conns[key] = c;

        const stopPing = () => {
          if (c.pingTimer) {
            clearInterval(c.pingTimer);
            c.pingTimer = null;
          }
        };
        const scheduleReconnect = () => {
          if (!alive || c.reconnectTimer) return;
          c.reconnectTimer = setTimeout(() => {
            c.reconnectTimer = null;
            connect();
          }, RECONNECT_MS);
        };
        const connect = () => {
          if (!alive) return;
          try {
            c.ws = new WebSocket(EXCHANGES[key].ws);
          } catch (e) {
            c.ws = null;
            scheduleReconnect();
            return;
          }
          c.ws.onopen = () => {
            if (!alive) return;
            c.live = true;
            c.everLive = true;
            setBadge(key, true);
            refreshOverall();
            if (onOpen) {
              try {
                c.ws.send(onOpen());
              } catch (e) { /* 忽略，等待服务端关闭后重连 */ }
            }
            if (pingMsg && pingMs) {
              stopPing();
              c.pingTimer = setInterval(() => {
                if (c.ws && c.ws.readyState === 1) {
                  try {
                    c.ws.send(pingMsg);
                  } catch (e) { /* 忽略 */ }
                }
              }, pingMs);
            }
          };
          c.ws.onmessage = (msg) => {
            if (!alive) return;
            let data;
            try {
              data = JSON.parse(msg.data);
            } catch (e) {
              return; // OKX 保活回包 "pong" 等非 JSON 文本帧
            }
            onMsg(data);
          };
          c.ws.onerror = () => {
            try {
              c.ws.close();
            } catch (e) { /* 忽略，onclose 统一处理重连 */ }
          };
          c.ws.onclose = () => {
            c.ws = null;
            c.live = false;
            stopPing();
            setBadge(key, false);
            refreshOverall();
            if (alive) scheduleReconnect();
          };
        };
        c.destroy = () => {
          if (c.reconnectTimer) {
            clearTimeout(c.reconnectTimer);
            c.reconnectTimer = null;
          }
          stopPing();
          if (c.ws) {
            c.ws.onopen = null;
            c.ws.onmessage = null;
            c.ws.onerror = null;
            c.ws.onclose = null;
            try {
              c.ws.close();
            } catch (e) { /* 忽略 */ }
            c.ws = null;
          }
        };
        connect();
        return c;
      };

      makeConn('binance', { onMsg: onBinanceMsg });
      makeConn('okx', {
        onMsg: onOkxMsg,
        onOpen: () => '{"op":"subscribe","args":[{"channel":"liquidation-orders","instType":"SWAP"}]}',
        pingMsg: 'ping',
        pingMs: OKX_PING_MS,
      });
      makeConn('bybit', {
        onMsg: onBybitMsg,
        onOpen: () =>
          JSON.stringify({ op: 'subscribe', args: BYBIT_SYMBOLS.map((s) => `allLiquidation.${s}`) }),
        pingMsg: '{"op":"ping"}',
        pingMs: BYBIT_PING_MS,
      });

      // OKX 合约面值表（REST 已验证带 Access-Control-Allow-Origin，可跨域）
      fetch(OKX_INSTRUMENTS_URL, { signal: abortCtl.signal })
        .then((r) => r.json())
        .then((j) => {
          if (!alive || !j || j.code !== '0' || !Array.isArray(j.data)) return;
          const map = {};
          j.data.forEach((r) => {
            if (r && r.instId) map[String(r.instId)] = { v: parseFloat(r.ctVal), ccy: String(r.ctValCcy || '') };
          });
          okxCtVal = map;
        })
        .catch(() => { /* 面值表拉取失败时使用 sz×价格近似 */ });

      tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.mliq-tab');
        if (!btn) return;
        exFilter = btn.getAttribute('data-ex') || 'all';
        tabsEl.querySelectorAll('.mliq-tab').forEach((b) => b.classList.toggle('on', b === btn));
        rerenderList();
      });

      filterSel.addEventListener('change', () => {
        minUsd = parseFloat(filterSel.value) || 0;
        rerenderList();
      });

      renderEmpty();
      updateStats();
      pruneTimer = setInterval(updateStats, STATS_PRUNE_MS);

      return () => {
        alive = false;
        if (pruneTimer) {
          clearInterval(pruneTimer);
          pruneTimer = null;
        }
        abortCtl.abort();
        exKeys.forEach((k) => {
          if (conns[k]) conns[k].destroy();
        });
      };
    },
  };
})();
