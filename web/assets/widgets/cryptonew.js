/* 币安新币上线监控 — Binance exchangeInfo 快照 diff + 24hr Ticker(CORS JSON)
 * 现货 exchangeInfo: https://api.binance.com/api/v3/exchangeInfo
 *   已 curl 实测 2026-07-16：HTTP 200，响应头 Access-Control-Allow-Origin: *；原始约 17.3MB，gzip 传输约 315KB（浏览器自动解压），只解析 symbol/baseAsset/quoteAsset/status
 *   注意：实测现货 symbols 无 onboardDate 字段 → 现货上线时间以本组件 localStorage 快照 diff 的首次发现时间为准（首次运行建立基线 t=0，不计为新上线）
 * 合约 exchangeInfo: https://fapi.binance.com/fapi/v1/exchangeInfo
 *   已 curl 实测 2026-07-16：HTTP 200，Access-Control-Allow-Origin: *（fapi 不支持 HEAD，须用 GET 验证）；约 1MB
 *   仅取永续（contractType 以 PERPETUAL 结尾，含 TRADIFI_PERPETUAL 传统金融永续；剔除季度交割合约）；symbols 全部带 onboardDate（上板时间 ms，权威上线时间）；status=PENDING_TRADING 且 onboardDate>now 即"即将上线"
 * 现价/涨幅/成交额: https://api.binance.com/api/v3/ticker/24hr 与 https://fapi.binance.com/fapi/v1/ticker/24hr
 *   现货支持 ?symbols=["A","B"] 批量（已实测 CORS *）；批量中含无行情 symbol 会整请求报 -1121 → 回退逐 symbol 请求
 *   合约不支持 symbols 参数（实测传入后忽略并返回全量）→ 拉全量（约 263KB / 700+ 条）本地按 symbol 过滤
 *   字段（字符串数字，以真实响应为准）：symbol / lastPrice / priceChangePercent / quoteVolume
 * localStorage key: gt_cryptonew_v1 —— { v, seededAt, spot:{symbol:t}, fut:{symbol:t} }，t=上线时间(ms)，t=0 表示基线前已存在
 * 加密组件绿涨红跌：方向着色用 var(--up)(涨)/var(--down)(跌)。固定 5 分钟刷新（加密 24/7），document.hidden 时跳过。
 * Registers as custom tool id 'cryptonew' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const SPOT_INFO_URL = 'https://api.binance.com/api/v3/exchangeInfo';
  const FUT_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
  const SPOT_TICKER_URL = 'https://api.binance.com/api/v3/ticker/24hr';
  const FUT_TICKER_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';

  const LS_KEY = 'gt_cryptonew_v1';
  const REFRESH_MS = 5 * 60 * 1000; // 加密市场 24/7，固定 5 分钟刷新
  const FETCH_TIMEOUT_MS = 10000;
  const NEW_WINDOW_MS = 48 * 3600 * 1000; // 48h 内视为新上线，高亮置顶
  const BOARD_WINDOW_MS = 7 * 24 * 3600 * 1000; // 近 7 日涨跌幅榜窗口
  const FRESH_TOP_N = 8;
  const BOARD_TOP_N = 12;
  const UPCOMING_TOP_N = 6;

  const MARKET_LABEL = { spot: '现货', fut: '合约' };

  function injectStyle() {
    if (document.getElementById('cnew-style')) return;
    const style = document.createElement('style');
    style.id = 'cnew-style';
    style.textContent = `
.cnew-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.cnew-status { color: var(--warning); white-space: nowrap; }
.cnew-status.live { color: var(--acc); }
.cnew-meta {
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
  font-variant-numeric: tabular-nums;
}
.cnew-upcoming {
  font-size: 10px;
  color: var(--warning);
  border: 1px dashed color-mix(in srgb, var(--warning) 40%, transparent);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  margin-bottom: 8px;
  line-height: 1.7;
}
.cnew-upcoming b { font-weight: 600; font-family: var(--font-mono); }
.cnew-upcoming i { font-style: normal; color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; margin-left: 3px; }
.cnew-sec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin: 8px 0 6px;
}
.cnew-sec-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; margin-left: auto; }
.cnew-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--acc);
  box-shadow: 0 0 6px var(--acc-glow);
}
.cnew-fresh { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
@media (max-width: 720px) {
  .cnew-fresh { grid-template-columns: 1fr; }
}
.cnew-card {
  border: 1px solid color-mix(in srgb, var(--acc) 35%, transparent);
  border-radius: var(--radius-sm);
  padding: 7px 9px;
  background: color-mix(in srgb, var(--acc) 5%, var(--surface-raised));
  min-width: 0;
  transition: border-color 0.2s var(--ease-fluid);
}
.cnew-card[data-url] { cursor: pointer; }
.cnew-card[data-url]:hover { border-color: var(--acc); }
.cnew-card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.cnew-coin {
  font-weight: 600;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cnew-coin i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 9px; }
.cnew-mkt {
  font-size: 8px;
  color: var(--text-muted);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 0 4px;
  line-height: 14px;
  white-space: nowrap;
}
.cnew-mkt.fut { color: var(--info); border-color: color-mix(in srgb, var(--info) 40%, transparent); }
.cnew-badge {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--acc);
  border: 1px solid color-mix(in srgb, var(--acc) 50%, transparent);
  border-radius: 999px;
  padding: 0 5px;
  line-height: 14px;
  white-space: nowrap;
}
.cnew-card-top .cnew-badge { margin-left: auto; }
.cnew-card-mid {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cnew-price { font-size: 14px; font-weight: 700; }
.cnew-pct { font-size: 11px; }
.cnew-card-bot {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 3px;
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cnew-empty-box {
  grid-column: 1 / -1;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 10px;
  text-align: center;
  padding: 12px 6px;
}
.cnew-table-wrap { min-height: 80px; }
.cnew-table { width: 100%; font-variant-numeric: tabular-nums; }
.cnew-table th, .cnew-table td { white-space: nowrap; }
.cnew-table th:nth-child(n+4), .cnew-table td:nth-child(n+4) { text-align: right; }
.cnew-table tbody tr[data-url] { cursor: pointer; }
.cnew-table tbody tr[data-url]:hover { background: var(--surface-raised); }
.cnew-table tbody tr.cnew-row-new td { background: color-mix(in srgb, var(--acc) 6%, transparent); }
.cnew-rank { font-family: var(--font-mono); color: var(--text-dim); width: 1.6em; }
.cnew-rank.top { color: var(--warning); font-weight: 700; }
.cnew-num { font-family: var(--font-mono); }
.cnew-dim { color: var(--text-muted); }
.cnew-up { color: var(--up); }
.cnew-down { color: var(--down); }
.cnew-flat { color: var(--text-muted); }
.cnew-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cnew-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
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

  // 币价量级差异大（0.000x ~ 100,000+），按量级自适应小数位（同 cryptotop）
  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
    return v.toLocaleString('en-US', { maximumFractionDigits: d });
  };

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${fmtNum(v, 2)}%`;
  };

  // quoteVolume(计价货币) → 亿/万
  const fmtQv = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e8) return `${fmtNum(v / 1e8, 2)}亿`;
    if (Math.abs(v) >= 1e4) return `${fmtNum(v / 1e4, 0)}万`;
    return fmtNum(v, 0);
  };

  // 上线时间 → MM-DD HH:mm（本地时区）
  const fmtTime = (ms) => {
    if (!Number.isFinite(ms)) return '—';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'cnew-flat';
    return v > 0 ? 'cnew-up' : 'cnew-down';
  };

  // 现货：无 onboardDate（实测），仅取 diff 所需最小字段；剔除带 '_' 的异常代码
  const parseSpotInfo = (json) =>
    (json && Array.isArray(json.symbols) ? json.symbols : [])
      .filter((s) => s && typeof s.symbol === 'string' && s.symbol.indexOf('_') === -1)
      .map((s) => ({
        symbol: s.symbol,
        base: String(s.baseAsset || ''),
        quote: String(s.quoteAsset || ''),
        status: String(s.status || ''),
        onboard: 0,
      }));

  // 合约：仅永续（contractType 以 PERPETUAL 结尾，含 TRADIFI_PERPETUAL，剔除交割合约）；onboardDate 为权威上板时间
  const parseFutInfo = (json) =>
    (json && Array.isArray(json.symbols) ? json.symbols : [])
      .filter((s) => s && typeof s.symbol === 'string' && s.symbol.indexOf('_') === -1 && String(s.contractType).endsWith('PERPETUAL'))
      .map((s) => ({
        symbol: s.symbol,
        base: String(s.baseAsset || ''),
        quote: String(s.quoteAsset || 'USDT'),
        status: String(s.status || ''),
        onboard: Number(s.onboardDate) || 0,
      }));

  window.GT_EXTRA_TOOLS['cryptonew'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cnew-root">
          <div class="cnew-head">
            <span>币安 · 新币上线监控</span>
            <span class="cnew-status" data-conn>加载中…</span>
          </div>
          <div class="cnew-meta" data-meta>正在建立交易对快照…</div>
          <div class="cnew-upcoming" data-upcoming style="display:none"></div>
          <div class="cnew-sec-title"><span class="cnew-dot"></span><span>新上线 · 48H</span><i data-fresh-note></i></div>
          <div class="cnew-fresh" data-fresh></div>
          <div class="cnew-sec-title"><span>近 7 日新上线涨跌幅榜</span><i data-board-note></i></div>
          <div class="cnew-table-wrap">
            <table class="data-table cnew-table">
              <thead><tr><th>#</th><th>币种</th><th>市场</th><th>上线时间</th><th>最新价</th><th>24h涨跌</th><th>成交额</th></tr></thead>
              <tbody data-body><tr class="cnew-empty"><td colspan="7">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="cnew-foot">
            <span data-source></span>
            <span data-updated></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const metaEl = el.querySelector('[data-meta]');
      const upcomingEl = el.querySelector('[data-upcoming]');
      const freshEl = el.querySelector('[data-fresh]');
      const freshNote = el.querySelector('[data-fresh-note]');
      const boardNote = el.querySelector('[data-board-note]');
      const body = el.querySelector('[data-body]');
      const sourceEl = el.querySelector('[data-source]');
      const updatedEl = el.querySelector('[data-updated]');
      const hint = el.querySelector('[data-hint]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      const pendingTimers = new Set(); // 进行中 fetch 的超时定时器
      const pendingAborts = new Set(); // 进行中 fetch 的 AbortController
      const disposers = [];
      let snapMem = null; // localStorage 不可用时的内存快照
      let lastState = null; // 上次成功渲染状态（部分接口失败时复用对应市场视图）

      const on = (node, ev, fn) => {
        node.addEventListener(ev, fn);
        disposers.push(() => node.removeEventListener(ev, fn));
      };

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'cnew-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'cnew-status live';
        setStatus('online');
      };
      const showPartial = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '● LIVE';
        conn.className = 'cnew-status live';
        setStatus('online');
      };

      // 带超时的 JSON fetch（仿 ashareboard 的 controller/timer 管理）
      const fetchJSON = async (url) => {
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

      const loadSnap = () => {
        try {
          const raw = window.localStorage.getItem(LS_KEY);
          if (raw) {
            const j = JSON.parse(raw);
            if (j && j.v === 1 && j.spot && typeof j.spot === 'object' && j.fut && typeof j.fut === 'object') {
              snapMem = j;
              return j;
            }
          }
        } catch (e) { /* localStorage 不可用/数据损坏时走内存快照 */ }
        return snapMem;
      };
      const saveSnap = (s) => {
        snapMem = s;
        try {
          window.localStorage.setItem(LS_KEY, JSON.stringify(s));
        } catch (e) { /* 隐私模式等场景降级为内存快照 */ }
      };

      const mapTicker = (r) => {
        if (!r || typeof r.symbol !== 'string') return null;
        const price = parseFloat(r.lastPrice);
        if (!Number.isFinite(price)) return null;
        const pct = parseFloat(r.priceChangePercent);
        const qv = parseFloat(r.quoteVolume);
        return { price, pct: Number.isFinite(pct) ? pct : NaN, qv: Number.isFinite(qv) ? qv : NaN };
      };

      // 取 ticker：现货支持 ?symbols=[...] 批量（batchSupported=true）；合约不支持 symbols 参数
      // （实测 2026-07-16 传入后忽略并返回全量）→ 拉全量（约 263KB）本地过滤
      // 现货批量中含未开盘/无效 symbol 时币安整请求报 -1121 → 回退逐 symbol 请求
      const fetchTickers = async (baseUrl, symbols, batchSupported) => {
        const out = {};
        if (!symbols.length) return out;
        const want = new Set(symbols);
        const collect = (arr) => {
          (Array.isArray(arr) ? arr : []).forEach((r) => {
            if (!r || !want.has(r.symbol)) return;
            const t = mapTicker(r);
            if (t) out[r.symbol] = t;
          });
        };
        if (!batchSupported) {
          collect(await fetchJSON(baseUrl));
          return out;
        }
        try {
          collect(await fetchJSON(`${baseUrl}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`));
          return out;
        } catch (e) {
          await Promise.all(
            symbols.map(async (sym) => {
              try {
                const t = mapTicker(await fetchJSON(`${baseUrl}?symbol=${encodeURIComponent(sym)}`));
                if (t) out[sym] = t;
              } catch (e2) { /* 单个 symbol 无行情则忽略 */ }
            })
          );
          return out;
        }
      };

      // symbol/base/quote 白名单校验（仅排除空白与引号尖括号），异常代码不挂链接
      const SAFE_RE = /^[^\s"'<>&]{2,60}$/;
      const safeUrl = (r) => {
        if (r.mkt === 'fut') {
          return SAFE_RE.test(r.symbol) ? `https://www.binance.com/zh-CN/futures/${encodeURIComponent(r.symbol)}` : '';
        }
        return SAFE_RE.test(r.base) && SAFE_RE.test(r.quote)
          ? `https://www.binance.com/zh-CN/trade/${encodeURIComponent(`${r.base}_${r.quote}`)}`
          : '';
      };

      const cardHtml = (r, st) => {
        const tk = (r.mkt === 'fut' ? st.futTick : st.spotTick)[r.symbol];
        const pct = tk ? tk.pct : NaN;
        const url = safeUrl(r);
        return `
        <div class="cnew-card"${url ? ` data-url="${esc(url)}"` : ''}>
          <div class="cnew-card-top">
            <span class="cnew-coin">${esc(r.base || r.symbol)}<i>/${esc(r.quote || '')}</i></span>
            <span class="cnew-mkt${r.mkt === 'fut' ? ' fut' : ''}">${MARKET_LABEL[r.mkt]}</span>
            <span class="cnew-badge">NEW</span>
          </div>
          <div class="cnew-card-mid">
            <span class="cnew-price ${dirClass(pct)}">${esc(tk ? fmtPrice(tk.price) : '—')}</span>
            <span class="cnew-pct ${dirClass(pct)}">${esc(fmtPct(pct))}</span>
          </div>
          <div class="cnew-card-bot"><span>上线 ${esc(fmtTime(r.listedAt))}</span><span>成交 ${esc(tk ? fmtQv(tk.qv) : '—')}</span></div>
        </div>`;
      };

      const rowHtml = (r, i, st) => {
        const tk = (r.mkt === 'fut' ? st.futTick : st.spotTick)[r.symbol];
        const pct = tk ? tk.pct : NaN;
        const url = safeUrl(r);
        const isNew = st.at - r.listedAt <= NEW_WINDOW_MS;
        return `
        <tr${isNew ? ' class="cnew-row-new"' : ''}${url ? ` data-url="${esc(url)}"` : ''}>
          <td class="cnew-rank${i < 3 ? ' top' : ''}">${i + 1}</td>
          <td class="cnew-coin">${esc(r.base || r.symbol)}<i>/${esc(r.quote || '')}</i>${isNew ? ' <span class="cnew-badge">NEW</span>' : ''}</td>
          <td><span class="cnew-mkt${r.mkt === 'fut' ? ' fut' : ''}">${MARKET_LABEL[r.mkt]}</span></td>
          <td class="cnew-num cnew-dim">${esc(fmtTime(r.listedAt))}</td>
          <td class="cnew-num">${esc(tk ? fmtPrice(tk.price) : '—')}</td>
          <td class="cnew-num ${dirClass(pct)}">${esc(fmtPct(pct))}</td>
          <td class="cnew-num cnew-dim">${esc(tk ? fmtQv(tk.qv) : '—')}</td>
        </tr>`;
      };

      const render = (st) => {
        metaEl.textContent =
          `监控交易对 现货 ${st.spotView.count || '—'} · 合约 ${st.futView.count || '—'}` +
          (st.firstRun ? ' · 首次运行已建立基线，现货新币自后续检测起记录' : st.added > 0 ? ` · 本次新增 ${st.added}` : '');

        const ups = [...st.spotView.upcoming, ...st.futView.upcoming]
          .sort((a, b) => a.listedAt - b.listedAt)
          .slice(0, UPCOMING_TOP_N);
        if (ups.length) {
          upcomingEl.style.display = '';
          upcomingEl.innerHTML = `即将上线：${ups
            .map((u) => `<b>${esc(u.base || u.symbol)}</b><i>${esc(fmtTime(u.listedAt))}</i>`)
            .join('、')}`;
        } else {
          upcomingEl.style.display = 'none';
        }

        const fresh = [...st.spotView.fresh, ...st.futView.fresh]
          .sort((a, b) => b.listedAt - a.listedAt)
          .slice(0, FRESH_TOP_N);
        freshNote.textContent = fresh.length ? `${fresh.length} 个` : '';
        freshEl.innerHTML = fresh.length
          ? fresh.map((r) => cardHtml(r, st)).join('')
          : '<div class="cnew-empty-box">近 48 小时暂无新上线交易对</div>';

        const pctOf = (r) => {
          const tk = (r.mkt === 'fut' ? st.futTick : st.spotTick)[r.symbol];
          return tk ? tk.pct : NaN;
        };
        const board = [...st.spotView.board, ...st.futView.board];
        board.sort((a, b) => {
          const pa = pctOf(a);
          const pb = pctOf(b);
          const fa = Number.isFinite(pa);
          const fb = Number.isFinite(pb);
          if (fa && fb) return pb - pa;
          return (fb ? 1 : 0) - (fa ? 1 : 0); // 无行情的排最后
        });
        const rows = board.slice(0, BOARD_TOP_N);
        boardNote.textContent = board.length ? `共 ${board.length} 个 · 按 24h 涨跌排序` : '';
        body.innerHTML = rows.length
          ? rows.map((r, i) => rowHtml(r, i, st)).join('')
          : `<tr class="cnew-empty"><td colspan="7">近 7 日暂无新上线记录</td></tr>`;

        sourceEl.textContent = '来源：Binance 现货/合约 exchangeInfo + 24hr Ticker · 现货上线时间以本地快照 diff 为准';
        updatedEl.textContent = `更新于 ${new Date(st.at).toLocaleTimeString('zh-CN', { hour12: false })} · 5 分钟一刷`;
      };

      // 从快照 + 当前 exchangeInfo 计算单个市场视图
      const buildView = (list, snapMap, mkt, now) => {
        const view = { fresh: [], board: [], upcoming: [], count: list ? list.length : 0 };
        if (!list) return view;
        list.forEach((it) => {
          if (it.status === 'PENDING_TRADING' && it.onboard > now) {
            view.upcoming.push(Object.assign({ mkt, listedAt: it.onboard }, it));
            return;
          }
          if (it.status !== 'TRADING') return;
          const t = snapMap[it.symbol];
          if (typeof t !== 'number' || t <= 0 || t > now) return; // t=0 为基线前已存在
          const age = now - t;
          if (age > BOARD_WINDOW_MS) return;
          const row = Object.assign({ mkt, listedAt: t }, it);
          view.board.push(row);
          if (age <= NEW_WINDOW_MS) view.fresh.push(row);
        });
        view.upcoming.sort((a, b) => a.listedAt - b.listedAt);
        view.fresh.sort((a, b) => b.listedAt - a.listedAt);
        return view;
      };

      const emptyView = () => ({ fresh: [], board: [], upcoming: [], count: 0 });

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const [spotRes, futRes] = await Promise.allSettled([fetchJSON(SPOT_INFO_URL), fetchJSON(FUT_INFO_URL)]);
          if (!alive) return;
          const spotList = spotRes.status === 'fulfilled' ? parseSpotInfo(spotRes.value) : null;
          const futList = futRes.status === 'fulfilled' ? parseFutInfo(futRes.value) : null;
          if (!spotList && !futList) {
            showError('新币监控数据加载失败，5 分钟后自动重试…');
            return;
          }

          const now = Date.now();
          let snap = loadSnap();
          const firstRun = !snap;
          if (!snap) snap = { v: 1, seededAt: now, spot: {}, fut: {} };
          let added = 0;
          const record = (map, sym, t) => {
            if (!(sym in map)) {
              map[sym] = t; // t=0 表示基线前已存在，不计为新上线
              if (!firstRun && t > 0) added += 1;
            }
          };
          // 现货无 onboardDate：首次运行全部记基线(t=0)，之后新出现的记发现时间
          if (spotList) spotList.forEach((it) => record(snap.spot, it.symbol, firstRun ? 0 : now));
          // 合约 onboardDate 为权威上板时间（含 PENDING_TRADING 的未来时间）
          if (futList) futList.forEach((it) => record(snap.fut, it.symbol, it.onboard > 0 ? it.onboard : firstRun ? 0 : now));
          saveSnap(snap);

          const spotView = spotList ? buildView(spotList, snap.spot, 'spot', now) : lastState ? lastState.spotView : emptyView();
          const futView = futList ? buildView(futList, snap.fut, 'fut', now) : lastState ? lastState.futView : emptyView();

          const tickJobs = [];
          tickJobs.push(spotList ? fetchTickers(SPOT_TICKER_URL, spotView.board.map((r) => r.symbol), true) : Promise.resolve(lastState ? lastState.spotTick : {}));
          tickJobs.push(futList ? fetchTickers(FUT_TICKER_URL, futView.board.map((r) => r.symbol), false) : Promise.resolve(lastState ? lastState.futTick : {}));
          const [spotTick, futTick] = await Promise.all(tickJobs);
          if (!alive) return;

          const st = {
            at: now,
            added,
            firstRun,
            spotView,
            futView,
            spotTick,
            futTick,
          };
          lastState = st;
          render(st);
          if (spotList && futList) clearError();
          else showPartial(`${spotList ? '合约' : '现货'} exchangeInfo 本次刷新失败，该市场展示上次结果，5 分钟后自动重试…`);
        } finally {
          refreshInFlight = false;
        }
      };

      // 行/卡片点击：新标签页打开币安详情页（noopener）
      on(el, 'click', (e) => {
        const node = e.target && e.target.closest ? e.target.closest('[data-url]') : null;
        if (node) window.open(node.getAttribute('data-url'), '_blank', 'noopener');
      });

      const tick = () => {
        if (!alive || document.hidden) return; // 页面隐藏时跳过刷新
        refresh();
      };

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
        disposers.forEach((fn) => fn());
        disposers.length = 0;
      };
    },
  };
})();
