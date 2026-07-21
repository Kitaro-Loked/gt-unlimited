/* 港股行情板 — 腾讯指数/个股行情(JSONP/GBK) + 东财港股榜单(CORS JSON)
 * 指数: https://qt.gtimg.cn/q=hkHSI,hkHSCEI,hkHSTECH （注入 <script charset="gb2312">，响应定义全局 v_<code>）
 * 榜单: https://push2delay.eastmoney.com/api/qt/clist/get fs=m:116（实测 push2.eastmoney.com 从本机持续 502，
 *       故 push2delay 为主、push2 为备；响应头 Access-Control-Allow-Origin: *，push2delay 为延时行情）
 * 榜单兜底: 东财两 host 均失败时，用腾讯 JSONP 拉取固定权重股（hk00700/hk09988/…）
 * 注意：港股红涨绿跌（同A股习惯），方向着色用 hkboard-up/hkboard-down 类映射 var(--up)/var(--down)。
 * Registers as custom tool id 'hkboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 指数代码与名称（名称以接口返回为准，此处仅作占位）
  const INDICES = [
    { code: 'hkHSI', name: '恒生指数' },
    { code: 'hkHSCEI', name: '国企指数' },
    { code: 'hkHSTECH', name: '恒生科技' },
  ];
  const QT_URL = 'https://qt.gtimg.cn/q=' + INDICES.map((i) => i.code).join(',');
  /* 腾讯港股字段下标（v_<code> 值按 ~ 切分，0 基；与A股不同！已用 curl|iconv -f gbk 实测 2026-07）：
   * 1=名称 2=代码 3=现价 4=昨收 5=今开 29=时间戳 30=涨跌额 31=涨跌% 32=最高 33=最低
   * （A股为 31=涨跌额/32=涨跌%，港股整体前移一位，勿混用） */
  const F_NAME = 1;
  const F_CODE = 2;
  const F_PRICE = 3;
  const F_PREV = 4;
  const F_OPEN = 5;
  const F_TIME = 29;
  const F_CHG = 30;
  const F_PCT = 31;
  const F_HIGH = 32;
  const F_LOW = 33;

  // 东财榜单兜底用的固定权重股（腾讯/阿里/美团/小米/中芯/比亚迪/汇丰/中移动）
  const FALLBACK_STOCKS = ['hk00700', 'hk09988', 'hk03690', 'hk01810', 'hk00981', 'hk01211', 'hk00005', 'hk00941'];
  const QT_STOCK_URL = 'https://qt.gtimg.cn/q=' + FALLBACK_STOCKS.join(',');

  const EM_FS = 'm:116'; // 港股全部
  const EM_FIELDS = 'f12,f14,f2,f3,f20'; // 代码/名称/最新价/涨跌幅%/总市值
  // 实测 2026-07：push2.eastmoney.com 从本机持续 502，push2delay（延时行情）正常 → delay 在前
  const EM_HOSTS = ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'];
  const emUrl = (host) =>
    `${host}/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f20&fs=${encodeURIComponent(EM_FS)}&fields=${EM_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`;
  const DETAIL_URL = (code) => `https://quote.eastmoney.com/hk/${code}.html`; // 已 curl -sI 验证 200

  const BOARD_SIZE = 12;
  const REFRESH_MS = 60000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const JSONP_TIMEOUT_MS = 10000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('hkboard-style')) return;
    const style = document.createElement('style');
    style.id = 'hkboard-style';
    style.textContent = `
/* 港股红涨绿跌（同A股）：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.hkboard-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .hkboard-root { --up: #C0442F; --down: #2E7D4F; }
.hkboard-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.hkboard-head-right { display: flex; align-items: center; gap: 8px; }
.hkboard-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.hkboard-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.hkboard-status { color: var(--warning); white-space: nowrap; }
.hkboard-status.live { color: var(--acc); }
/* 港股红涨绿跌（同A股）：var(--up)=涨、var(--down)=跌 */
.hkboard-up { color: var(--up); }
.hkboard-down { color: var(--down); }
.hkboard-flat { color: var(--text-muted); }
.hkboard-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 720px) {
  .hkboard-grid { grid-template-columns: 1fr; }
}
.hkboard-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.hkboard-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.hkboard-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hkboard-pct {
  font-size: 10px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hkboard-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hkboard-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.hkboard-ohlc {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}
.hkboard-ohlc b {
  font-weight: 400;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.hkboard-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
}
.hkboard-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.hkboard-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.hkboard-table { font-variant-numeric: tabular-nums; }
.hkboard-table th, .hkboard-table td { white-space: nowrap; }
.hkboard-table tbody tr { cursor: pointer; }
.hkboard-table tbody tr:hover td { background: color-mix(in srgb, var(--acc) 6%, transparent); }
.hkboard-num { font-family: var(--font-mono); }
.hkboard-stock { font-weight: 600; }
.hkboard-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.hkboard-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
  cursor: default;
}
.hkboard-empty:hover td { background: transparent; }
.hkboard-foot {
  margin-top: 8px;
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

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'hkboard-flat';
    return v > 0 ? 'hkboard-up' : 'hkboard-down';
  };

  // 港股交易时段（香港=北京时间 UTC+8）：周一至五 09:30-12:00 / 13:00-16:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
    const day = bj.getDay();
    const mins = bj.getHours() * 60 + bj.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 570 && mins < 720) || (mins >= 780 && mins <= 960)) return 'trading';
    if (mins >= 720 && mins < 780) return 'lunch';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['hkboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool hkboard-root">
          <div class="hkboard-head">
            <span>港股 · 行情板</span>
            <span class="hkboard-head-right">
              <span class="hkboard-session" data-session>—</span>
              <span class="hkboard-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="hkboard-grid">
            ${INDICES.map(
              (idx) => `
              <div class="hkboard-card" data-code="${esc(idx.code)}">
                <div class="hkboard-card-top">
                  <span class="hkboard-name" data-name>${esc(idx.name)}</span>
                  <span class="hkboard-pct hkboard-flat" data-pct>—</span>
                </div>
                <div class="hkboard-price hkboard-flat" data-price>—</div>
                <div class="hkboard-chg"><span data-chg class="hkboard-flat">—</span></div>
                <div class="hkboard-ohlc"><span>开 <b data-open>—</b></span><span>高 <b data-high>—</b></span><span>低 <b data-low>—</b></span><span>昨 <b data-prev>—</b></span></div>
              </div>`
            ).join('')}
          </div>
          <div class="hkboard-board">
            <div class="hkboard-board-title"><span>热门个股 · 按总市值</span><i data-board-note></i></div>
            <table class="data-table hkboard-table">
              <thead><tr><th>名称</th><th>现价</th><th>涨跌幅</th></tr></thead>
              <tbody data-board-body></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="hkboard-foot">
            <span data-source>来源：腾讯行情（指数）/ 东方财富（个股）</span>
            <span data-updated>更新 —</span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const boardBody = el.querySelector('[data-board-body]');
      const boardNote = el.querySelector('[data-board-note]');
      const updatedEl = el.querySelector('[data-updated]');
      const cards = {};
      el.querySelectorAll('.hkboard-card').forEach((card) => {
        cards[card.getAttribute('data-code')] = {
          name: card.querySelector('[data-name]'),
          pct: card.querySelector('[data-pct]'),
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          open: card.querySelector('[data-open]'),
          high: card.querySelector('[data-high]'),
          low: card.querySelector('[data-low]'),
          prev: card.querySelector('[data-prev]'),
        };
      });

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingScripts = new Set(); // 进行中的 JSONP <script> 节点
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'hkboard-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'hkboard-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'hkboard-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'hkboard-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'hkboard-session';
        }
        return s;
      };

      const readGlobal = (name) => {
        const v = window[name];
        try {
          delete window[name];
        } catch (e) {
          window[name] = undefined;
        }
        return v;
      };
      const clearGlobals = (codes) => {
        codes.forEach((code) => readGlobal('v_' + code));
      };

      // 腾讯 JSONP：每次重新注入带时间戳的 <script charset="gb2312">，完成后清理节点与全局变量
      // codes: 期望返回的代码数组；返回 { code: 字段数组 }
      const fetchQt = (url, codes) =>
        new Promise((resolve, reject) => {
          if (!alive) {
            reject(new Error('disposed'));
            return;
          }
          const script = document.createElement('script');
          script.charset = 'gb2312';
          script.async = true;
          script.src = `${url}&_t=${Date.now()}`;
          let done = false;
          const finish = (err) => {
            if (done) return;
            done = true;
            pendingScripts.delete(script);
            if (timer) {
              clearTimeout(timer);
              pendingTimers.delete(timer);
            }
            script.onload = null;
            script.onerror = null;
            if (script.parentNode) script.parentNode.removeChild(script);
            if (err) {
              clearGlobals(codes);
              reject(err);
              return;
            }
            const out = {};
            let ok = 0;
            codes.forEach((code) => {
              const raw = readGlobal('v_' + code);
              if (typeof raw === 'string' && raw.indexOf('~') > 0) {
                out[code] = raw.split('~');
                ok += 1;
              }
            });
            if (ok === 0) reject(new Error('empty'));
            else resolve(out);
          };
          const timer = setTimeout(() => finish(new Error('timeout')), JSONP_TIMEOUT_MS);
          pendingTimers.add(timer);
          script.onload = () => finish(null);
          script.onerror = () => finish(new Error('jsonp error'));
          pendingScripts.add(script);
          document.head.appendChild(script);
        });

      const INDEX_CODES = INDICES.map((i) => i.code);
      const fetchIndices = () => fetchQt(QT_URL, INDEX_CODES);

      const renderIndices = (data) => {
        let timeStr = '';
        INDICES.forEach((idx) => {
          const f = data[idx.code];
          const c = cards[idx.code];
          if (!f || !c) return;
          const price = parseFloat(f[F_PRICE]);
          const prev = parseFloat(f[F_PREV]);
          const open = parseFloat(f[F_OPEN]);
          const high = parseFloat(f[F_HIGH]);
          const low = parseFloat(f[F_LOW]);
          const chg = parseFloat(f[F_CHG]);
          const pct = parseFloat(f[F_PCT]);
          if (f[F_NAME]) c.name.textContent = String(f[F_NAME]);
          const cls = dirClass(chg);
          c.price.textContent = fmtNum(price, 2);
          c.price.className = `hkboard-price ${cls}`;
          c.chg.textContent = fmtSigned(chg, 2);
          c.chg.className = cls;
          c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
          c.pct.className = `hkboard-pct ${cls}`;
          c.open.textContent = fmtNum(open, 2);
          c.high.textContent = fmtNum(high, 2);
          c.low.textContent = fmtNum(low, 2);
          c.prev.textContent = fmtNum(prev, 2);
          if (!timeStr && f[F_TIME]) timeStr = String(f[F_TIME]);
        });
        if (timeStr) updatedEl.textContent = `更新 ${timeStr}`;
      };

      // 东财榜单：CORS fetch，push2delay（延时）为主、push2 为备
      const fetchBoardEM = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i]), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            return { rows: diff, delayed: i === 0, source: 'em' };
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

      // 榜单兜底：腾讯 JSONP 固定权重股
      const fetchBoardFallback = async () => {
        const data = await fetchQt(QT_STOCK_URL, FALLBACK_STOCKS);
        const rows = FALLBACK_STOCKS.map((code) => data[code])
          .filter((f) => f)
          .map((f) => ({
            code: String(f[F_CODE] || ''),
            name: String(f[F_NAME] || ''),
            price: parseFloat(f[F_PRICE]),
            pct: parseFloat(f[F_PCT]),
          }))
          .filter((r) => r.code && r.name);
        if (!rows.length) throw new Error('empty');
        return { rows, delayed: false, source: 'tencent' };
      };

      const fetchBoard = async () => {
        try {
          return await fetchBoardEM();
        } catch (e) {
          return fetchBoardFallback();
        }
      };

      const renderBoard = (result) => {
        const rows = result.rows
          .map((r) =>
            result.source === 'em'
              ? { code: String(r.f12 || ''), name: String(r.f14 || ''), price: Number(r.f2), pct: Number(r.f3) }
              : r
          )
          // 过滤人民币柜台（8xxxx，如 80700/89988，与港币柜台重复）
          .filter((r) => r.code && r.name && r.code.charAt(0) !== '8' && Number.isFinite(r.pct))
          .slice(0, BOARD_SIZE);
        boardNote.textContent = result.source === 'tencent' ? '备选源·权重股' : result.delayed ? '延时行情' : '';
        if (!rows.length) {
          boardBody.innerHTML = `<tr class="hkboard-empty"><td colspan="3">暂无数据</td></tr>`;
          return;
        }
        boardBody.innerHTML = rows
          .map((r) => {
            const cls = dirClass(r.pct);
            return `
            <tr data-hkcode="${esc(r.code)}" title="查看 ${esc(r.name)} 详情">
              <td class="hkboard-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="hkboard-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="hkboard-num ${cls}">${esc(fmtSigned(r.pct, 2))}%</td>
            </tr>`;
          })
          .join('');
      };

      const renderBoardError = () => {
        boardNote.textContent = '';
        boardBody.innerHTML = `<tr class="hkboard-empty"><td colspan="3">榜单加载失败</td></tr>`;
      };

      // 行点击跳转东财港股详情页（新标签页，noopener）
      const onBoardClick = (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-hkcode]') : null;
        if (!tr) return;
        const code = tr.getAttribute('data-hkcode');
        if (code) window.open(DETAIL_URL(code), '_blank', 'noopener');
      };
      boardBody.addEventListener('click', onBoardClick);

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [idxRes, boardRes] = await Promise.allSettled([fetchIndices(), fetchBoard()]);
          if (!alive) return;
          if (idxRes.status === 'fulfilled') {
            renderIndices(idxRes.value);
            clearError();
          } else {
            showError('指数行情加载失败，60 秒后自动重试…');
          }
          if (boardRes.status === 'fulfilled') renderBoard(boardRes.value);
          else renderBoardError();
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
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
        pendingScripts.forEach((s) => {
          s.onload = null;
          s.onerror = null;
          if (s.parentNode) s.parentNode.removeChild(s);
        });
        pendingScripts.clear();
        boardBody.removeEventListener('click', onBoardClick);
        clearGlobals(INDEX_CODES);
        clearGlobals(FALLBACK_STOCKS);
      };
    },
  };
})();
