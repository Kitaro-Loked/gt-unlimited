/* Liquidation monitor — Binance USD-M futures force orders via public WS (no API key)
 * Data: wss://fstream.binance.com/ws/!forceOrder@arr ({o:{s,S,p,q,T}})
 * 自定义统计：时间窗(5M~24H)/币种过滤/金额门槛/按币种聚合视图，配置持久化 localStorage('gt.liqcfg')
 * Registers as custom tool id 'liquidations' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
  const RECONNECT_MS = 3000;
  const STATS_PRUNE_MS = 30000; // 无新事件时也周期性衰减统计
  const MAX_ROWS = 30; // 事件列表环形缓冲上限（不持久化）
  const BUF_MAX = 5000; // 统计环形缓冲上限（安全阀）
  const AGG_TOP_N = 15; // 按币种统计最多展示行数
  const LS_KEY = 'gt.liqcfg';
  const WINDOWS = [
    { ms: 5 * 60 * 1000, label: '5M' },
    { ms: 15 * 60 * 1000, label: '15M' },
    { ms: 60 * 60 * 1000, label: '1H' },
    { ms: 4 * 3600 * 1000, label: '4H' },
    { ms: 24 * 3600 * 1000, label: '24H' },
  ];
  const DEFAULT_WIN_MS = WINDOWS[2].ms;

  function injectStyle() {
    if (document.getElementById('liq-style')) return;
    const style = document.createElement('style');
    style.id = 'liq-style';
    style.textContent = `
.liq-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.liq-status { color: var(--warning); }
.liq-status.live { color: var(--up); }
.liq-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
.liq-stat {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.liq-stat-label { font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; }
.liq-stat-value {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.liq-stat-value.long, .liq-usd.long { color: var(--down); }
.liq-stat-value.short, .liq-usd.short { color: var(--up); }
.liq-bar {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--hairline);
  margin-bottom: 8px;
}
.liq-bar-seg { height: 100%; width: 0; transition: width 0.4s var(--ease-fluid); }
.liq-bar-seg.long { background: var(--down); }
.liq-bar-seg.short { background: var(--up); }
.liq-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.liq-seg {
  display: flex;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.liq-seg button {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 10px;
  padding: 3px 8px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s var(--ease-fluid), color 0.2s var(--ease-fluid);
}
.liq-seg button.on { background: var(--surface-raised); color: var(--text); }
.liq-tabs { margin-left: auto; display: flex; gap: 4px; }
.liq-tab {
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: inherit;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
}
.liq-tab.on {
  color: var(--acc);
  border-color: var(--acc);
  background: color-mix(in srgb, var(--acc) 10%, transparent);
}
.liq-input {
  background: var(--surface-raised);
  color: var(--text);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 3px 6px;
  font-family: inherit;
  min-width: 0;
  transition: border-color 0.2s var(--ease-fluid);
}
.liq-input:focus, .liq-filter:focus, .liq-seg button:focus-visible, .liq-tab:focus-visible { outline: 1px solid var(--acc); }
.liq-coin-input { flex: 1; min-width: 72px; }
.liq-usd-input { width: 70px; }
.liq-filter {
  background: var(--surface-raised);
  color: var(--text);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 3px 6px;
  font-family: inherit;
  cursor: pointer;
}
.liq-count { margin-left: auto; font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; }
.liq-list-wrap { max-height: 320px; overflow-y: auto; }
.liq-table { font-variant-numeric: tabular-nums; }
.liq-table th, .liq-table td { white-space: nowrap; }
.liq-num { font-family: var(--font-mono); }
.liq-time { color: var(--text-muted); font-size: 10px; }
.liq-sym { font-weight: 600; }
.liq-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.liq-badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
}
.liq-badge.long { color: var(--down); border-color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
.liq-badge.short { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
.liq-cnt { color: var(--text-muted); }
.liq-minibar {
  display: inline-flex;
  width: 56px;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--hairline);
  vertical-align: middle;
}
.liq-minibar i { display: block; height: 100%; background: var(--down); }
.liq-minibar b { display: block; height: 100%; flex: 1; background: var(--up); }
.liq-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 14px 4px;
}
@keyframes liqIn {
  0% { opacity: 0; transform: translateY(-8px); }
  100% { opacity: 1; transform: none; }
}
tr.liq-new.long, tr.liq-new.short { animation: liqIn 0.8s var(--ease-fluid); }
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

  const fmtQty = (q) => {
    if (!Number.isFinite(q)) return '—';
    if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (q >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 3 });
    return q.toPrecision(3);
  };

  const fmtTime = (t) => {
    const d = new Date(t);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };

  // "BTC, eth" -> ['BTC', 'ETH']，子串匹配用
  const parseTokens = (s) =>
    String(s || '')
      .toUpperCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  const symHtml = (raw) => {
    const s = String(raw);
    return s.endsWith('USDT') ? `${esc(s.slice(0, -4))}<i>/USDT</i>` : esc(s);
  };

  window.GT_EXTRA_TOOLS['liquidations'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool liq-root">
          <div class="liq-head"><span>BINANCE FUTURES · 强制平仓</span><span class="liq-status" data-conn>连接中…</span></div>
          <div class="liq-stats">
            <div class="liq-stat"><span class="liq-stat-label">多仓爆仓 · <span data-winlab>1H</span></span><span class="liq-stat-value long" data-long>$0.00</span></div>
            <div class="liq-stat"><span class="liq-stat-label">空仓爆仓 · <span data-winlab>1H</span></span><span class="liq-stat-value short" data-short>$0.00</span></div>
            <div class="liq-stat"><span class="liq-stat-label">合计 · <span data-winlab>1H</span></span><span class="liq-stat-value" data-total>$0.00</span></div>
          </div>
          <div class="liq-bar"><span class="liq-bar-seg long" data-bar-long></span><span class="liq-bar-seg short" data-bar-short></span></div>
          <div class="liq-ctrl">
            <div class="liq-seg" data-seg>${WINDOWS.map((w) => `<button type="button" data-win="${w.ms}">${w.label}</button>`).join('')}</div>
            <div class="liq-tabs">
              <button type="button" class="liq-tab on" data-view-tab="list">事件</button>
              <button type="button" class="liq-tab" data-view-tab="coin">币种</button>
            </div>
          </div>
          <div class="liq-ctrl">
            <input class="liq-input liq-coin-input" data-coin type="text" placeholder="币种过滤，如 BTC,ETH" title="逗号分隔多个关键字，子串匹配，留空为全部">
            <select class="liq-filter" data-filter title="按美元价值过滤">
              <option value="0">全部</option>
              <option value="10000">≥ $1万</option>
              <option value="100000">≥ $10万</option>
              <option value="1000000">≥ $100万</option>
              <option value="-1" data-opt-custom>自定义…</option>
            </select>
            <input class="liq-input liq-usd-input" data-usd type="text" inputmode="decimal" placeholder="自定义$" title="美元金额门槛，回车生效">
            <span class="liq-count" data-count>0 条</span>
          </div>
          <div class="liq-list-wrap" data-wrap-list>
            <table class="data-table liq-table">
              <thead>
                <tr><th>时间</th><th>品种</th><th>方向</th><th>价格</th><th>数量</th><th>价值</th></tr>
              </thead>
              <tbody data-body></tbody>
            </table>
          </div>
          <div class="liq-list-wrap" data-wrap-coin style="display:none">
            <table class="data-table liq-table">
              <thead>
                <tr><th>币种</th><th>多爆</th><th>空爆</th><th>合计</th><th>笔数</th><th>多空比</th></tr>
              </thead>
              <tbody data-coin-body></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const longEl = el.querySelector('[data-long]');
      const shortEl = el.querySelector('[data-short]');
      const totalEl = el.querySelector('[data-total]');
      const barLong = el.querySelector('[data-bar-long]');
      const barShort = el.querySelector('[data-bar-short]');
      const segEl = el.querySelector('[data-seg]');
      const tabsEl = el.querySelector('.liq-tabs');
      const coinInput = el.querySelector('[data-coin]');
      const filterSel = el.querySelector('[data-filter]');
      const customOpt = filterSel.querySelector('[data-opt-custom]');
      const usdInput = el.querySelector('[data-usd]');
      const countEl = el.querySelector('[data-count]');
      const body = el.querySelector('[data-body]');
      const coinBody = el.querySelector('[data-coin-body]');
      const wrapList = el.querySelector('[data-wrap-list]');
      const wrapCoin = el.querySelector('[data-wrap-coin]');
      const winBtns = Array.from(segEl.querySelectorAll('button[data-win]'));
      const winlabs = Array.from(el.querySelectorAll('[data-winlab]'));
      const tabBtns = Array.from(tabsEl.querySelectorAll('button[data-view-tab]'));

      // 持久化配置（localStorage 可能不可用，全部静默降级）
      let cfg = {};
      try {
        cfg = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
      } catch (e) { /* 忽略损坏配置 */ }
      let winMs = WINDOWS.some((w) => w.ms === cfg.win) ? cfg.win : DEFAULT_WIN_MS;
      let minUsd = Number.isFinite(cfg.minUsd) && cfg.minUsd >= 0 ? cfg.minUsd : 0;
      let coinRaw = typeof cfg.syms === 'string' ? cfg.syms : '';
      let coinTokens = parseTokens(coinRaw);
      const saveCfg = () => {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ win: winMs, minUsd, syms: coinRaw }));
        } catch (e) { /* 隐私模式等场景下静默失败 */ }
      };

      const events = []; // 列表环形缓冲：最新在前，最多 MAX_ROWS 条
      const buf = []; // 统计环形缓冲：最新在前，按当前时间窗 prune，事件含时间戳
      let view = 'list'; // 'list' 事件列表 | 'coin' 按币种统计
      let alive = true;
      let everConnected = false;
      let ws = null;
      let reconnectTimer = null;
      let pruneTimer = null;
      let aggRaf = 0;

      const setConn = (state) => {
        if (state === 'live') {
          conn.textContent = '● LIVE';
          conn.className = 'liq-status live';
          hint.style.display = 'none';
          setStatus('online');
        } else if (state === 'connecting') {
          conn.textContent = '连接中…';
          conn.className = 'liq-status';
        } else {
          conn.textContent = '重连中…';
          conn.className = 'liq-status';
          hint.textContent = '行情连接已断开，3 秒后自动重连…';
          hint.style.display = '';
          setStatus('offline');
        }
      };

      const coinPass = (ev) => {
        if (!coinTokens.length) return true;
        const sym = ev.sym.toUpperCase();
        return coinTokens.some((t) => sym.includes(t));
      };
      const passesList = (ev) => ev.usd >= minUsd && coinPass(ev); // 金额门槛只作用于事件列表

      const rowHtml = (ev) => {
        const side = ev.isLong ? 'long' : 'short';
        return `
          <td class="liq-num liq-time">${fmtTime(ev.t)}</td>
          <td class="liq-sym">${symHtml(ev.sym)}</td>
          <td><span class="liq-badge ${side}">${ev.isLong ? '多爆' : '空爆'}</span></td>
          <td class="liq-num">${fmtPrice(ev.p)}</td>
          <td class="liq-num">${fmtQty(ev.q)}</td>
          <td class="liq-num liq-usd ${side}">${fmtUsd(ev.usd)}</td>`;
      };

      const renderEmpty = () => {
        const visible = events.filter(passesList).length;
        countEl.textContent = `${visible} 条`;
        if (visible > 0) return;
        body.innerHTML = `
          <tr class="liq-empty"><td colspan="6">${events.length ? '无符合过滤条件的爆仓事件' : '等待爆仓事件…'}</td></tr>`;
      };

      const makeRow = (ev, animate) => {
        const tr = document.createElement('tr');
        if (animate) tr.className = `liq-new ${ev.isLong ? 'long' : 'short'}`;
        tr.innerHTML = rowHtml(ev);
        return tr;
      };

      const addRow = (ev) => {
        if (view !== 'list' || !passesList(ev)) return;
        const empty = body.querySelector('.liq-empty');
        if (empty) empty.remove();
        body.insertBefore(makeRow(ev, true), body.firstChild);
        while (body.children.length > MAX_ROWS) body.removeChild(body.lastChild);
        countEl.textContent = `${body.children.length} 条`;
      };

      const rerenderList = () => {
        body.innerHTML = '';
        events.filter(passesList).forEach((ev) => body.appendChild(makeRow(ev, false)));
        renderEmpty();
      };

      // 统计缓冲按当前窗口衰减（最新在前，从尾部剔除过期事件）
      const pruneBuf = () => {
        const cut = Date.now() - winMs;
        while (buf.length && buf[buf.length - 1].t < cut) buf.pop();
      };

      // 统计卡 + 多空比例条：币种过滤同时作用于统计
      const updateStats = () => {
        pruneBuf();
        let longUsd = 0;
        let shortUsd = 0;
        for (const ev of buf) {
          if (!coinPass(ev)) continue;
          if (ev.isLong) longUsd += ev.usd;
          else shortUsd += ev.usd;
        }
        const total = longUsd + shortUsd;
        longEl.textContent = fmtUsd(longUsd);
        shortEl.textContent = fmtUsd(shortUsd);
        totalEl.textContent = fmtUsd(total);
        if (total > 0) {
          barLong.style.width = `${((longUsd / total) * 100).toFixed(2)}%`;
          barShort.style.width = `${((shortUsd / total) * 100).toFixed(2)}%`;
        } else {
          barLong.style.width = '0';
          barShort.style.width = '0';
        }
      };

      // 按币种聚合，合计降序取前 AGG_TOP_N
      const aggregateByCoin = () => {
        const map = new Map();
        for (const ev of buf) {
          if (!coinPass(ev)) continue;
          let a = map.get(ev.sym);
          if (!a) {
            a = { sym: ev.sym, longUsd: 0, shortUsd: 0, n: 0 };
            map.set(ev.sym, a);
          }
          if (ev.isLong) a.longUsd += ev.usd;
          else a.shortUsd += ev.usd;
          a.n += 1;
        }
        return Array.from(map.values())
          .sort((x, y) => y.longUsd + y.shortUsd - (x.longUsd + x.shortUsd))
          .slice(0, AGG_TOP_N);
      };

      const renderAgg = () => {
        const rows = aggregateByCoin();
        countEl.textContent = `${rows.length} 币种`;
        if (!rows.length) {
          coinBody.innerHTML = `<tr class="liq-empty"><td colspan="6">窗口内暂无爆仓数据</td></tr>`;
          return;
        }
        coinBody.innerHTML = rows
          .map((a) => {
            const total = a.longUsd + a.shortUsd;
            const lp = total > 0 ? (a.longUsd / total) * 100 : 0;
            return `
            <tr>
              <td class="liq-sym">${symHtml(a.sym)}</td>
              <td class="liq-num liq-usd long">${fmtUsd(a.longUsd)}</td>
              <td class="liq-num liq-usd short">${fmtUsd(a.shortUsd)}</td>
              <td class="liq-num">${fmtUsd(total)}</td>
              <td class="liq-num liq-cnt">${a.n}</td>
              <td><span class="liq-minibar" title="多爆 ${lp.toFixed(1)}% / 空爆 ${(100 - lp).toFixed(1)}%"><i style="width:${lp.toFixed(2)}%"></i><b></b></span></td>
            </tr>`;
          })
          .join('');
      };

      // 事件洪峰时按帧合并刷新聚合表
      const requestAgg = () => {
        if (view !== 'coin' || aggRaf) return;
        aggRaf = requestAnimationFrame(() => {
          aggRaf = 0;
          if (alive && view === 'coin') renderAgg();
        });
      };

      const setView = (v) => {
        view = v;
        tabBtns.forEach((b) => b.classList.toggle('on', b.dataset.viewTab === v));
        wrapList.style.display = v === 'list' ? '' : 'none';
        wrapCoin.style.display = v === 'coin' ? '' : 'none';
        if (v === 'coin') renderAgg();
        else rerenderList();
      };

      const handleOrder = (o) => {
        const p = parseFloat(o.p);
        const q = parseFloat(o.q);
        if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) return;
        const ev = {
          t: Number(o.T) || Date.now(),
          sym: String(o.s || ''),
          isLong: o.S === 'SELL', // SELL=多仓被强平卖出，BUY=空仓被强平买入
          p,
          q,
          usd: p * q,
        };
        events.unshift(ev);
        if (events.length > MAX_ROWS) events.length = MAX_ROWS;
        buf.unshift(ev);
        if (buf.length > BUF_MAX) buf.length = BUF_MAX;
        addRow(ev);
        updateStats();
        requestAgg();
      };

      const scheduleReconnect = () => {
        if (!alive || reconnectTimer) return;
        setConn('reconnecting');
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, RECONNECT_MS);
      };

      const connect = () => {
        if (!alive) return;
        setConn(everConnected ? 'reconnecting' : 'connecting');
        try {
          ws = new WebSocket(WS_URL);
        } catch (e) {
          ws = null;
          scheduleReconnect();
          return;
        }
        ws.onopen = () => {
          if (!alive) return;
          everConnected = true;
          setConn('live');
        };
        ws.onmessage = (msg) => {
          if (!alive) return;
          let data;
          try {
            data = JSON.parse(msg.data);
          } catch (e) {
            return;
          }
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach((d) => {
            if (d && d.o) handleOrder(d.o);
          });
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch (e) { /* 忽略，onclose 统一处理重连 */ }
        };
        ws.onclose = () => {
          ws = null;
          if (alive) scheduleReconnect();
        };
      };

      // ---- 控件事件 ----
      const syncWinUi = () => {
        const w = WINDOWS.find((x) => x.ms === winMs);
        winBtns.forEach((b) => b.classList.toggle('on', parseInt(b.dataset.win, 10) === winMs));
        winlabs.forEach((s) => {
          s.textContent = w ? w.label : '';
        });
      };

      const resetCustomOpt = () => {
        customOpt.value = '-1';
        customOpt.textContent = '自定义…';
      };

      // 金额门槛 UI 与 minUsd 对齐：命中预设选预设，否则改写自定义占位项并回填输入框
      const syncFilterUi = () => {
        const preset = Array.from(filterSel.options).find((o) => o !== customOpt && parseFloat(o.value) === minUsd);
        if (preset) {
          resetCustomOpt();
          filterSel.value = preset.value;
          usdInput.value = '';
        } else {
          customOpt.value = String(minUsd);
          customOpt.textContent = `≥ ${fmtUsd(minUsd)}`;
          filterSel.value = customOpt.value;
          usdInput.value = String(minUsd);
        }
      };

      const onSegClick = (e) => {
        const btn = e.target.closest('button[data-win]');
        if (!btn) return;
        const ms = parseInt(btn.dataset.win, 10);
        if (!WINDOWS.some((w) => w.ms === ms) || ms === winMs) return;
        winMs = ms;
        saveCfg();
        syncWinUi();
        updateStats();
        if (view === 'coin') renderAgg();
      };

      const onTabClick = (e) => {
        const btn = e.target.closest('button[data-view-tab]');
        if (!btn || btn.dataset.viewTab === view) return;
        setView(btn.dataset.viewTab);
      };

      const onCoinInput = () => {
        coinRaw = coinInput.value;
        coinTokens = parseTokens(coinRaw);
        saveCfg();
        updateStats();
        if (view === 'coin') renderAgg();
        else rerenderList();
      };

      const onFilterChange = () => {
        if (filterSel.value === '-1') { // 选中占位项：引导到自定义输入
          usdInput.focus();
          return;
        }
        minUsd = parseFloat(filterSel.value) || 0;
        resetCustomOpt();
        usdInput.value = '';
        saveCfg();
        rerenderList();
      };

      const onUsdKey = (e) => {
        if (e.key !== 'Enter') return;
        const v = parseFloat(usdInput.value.replace(/[,\s]/g, ''));
        if (!Number.isFinite(v) || v < 0) {
          usdInput.value = '';
          return;
        }
        minUsd = v;
        syncFilterUi();
        saveCfg();
        rerenderList();
        usdInput.blur();
      };

      segEl.addEventListener('click', onSegClick);
      tabsEl.addEventListener('click', onTabClick);
      coinInput.addEventListener('input', onCoinInput);
      filterSel.addEventListener('change', onFilterChange);
      usdInput.addEventListener('keydown', onUsdKey);

      coinInput.value = coinRaw;
      syncWinUi();
      syncFilterUi();
      setView('list');
      updateStats();
      connect();
      pruneTimer = setInterval(() => {
        updateStats();
        if (view === 'coin') renderAgg();
      }, STATS_PRUNE_MS);

      return () => {
        alive = false;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (pruneTimer) {
          clearInterval(pruneTimer);
          pruneTimer = null;
        }
        if (aggRaf) {
          cancelAnimationFrame(aggRaf);
          aggRaf = 0;
        }
        segEl.removeEventListener('click', onSegClick);
        tabsEl.removeEventListener('click', onTabClick);
        coinInput.removeEventListener('input', onCoinInput);
        filterSel.removeEventListener('change', onFilterChange);
        usdInput.removeEventListener('keydown', onUsdKey);
        if (ws) {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          try {
            ws.close();
          } catch (e) { /* 忽略 */ }
          ws = null;
        }
      };
    },
  };
})();
