/* A股盘面总览 — 腾讯指数行情(JSONP/GBK) + 东财领涨领跌榜(CORS JSON)
 * 指数: https://qt.gtimg.cn/q=... （注入 <script charset="gb2312">，响应定义全局 v_<code>）
 * 榜单: https://push2.eastmoney.com/api/qt/clist/get （响应头 Access-Control-Allow-Origin: *，失败时回退 push2delay 延时行情）
 * 注意：A股红涨绿跌，方向着色用 aboard-up(--up)/aboard-down(--down)，不使用 --acc/--danger。
 * Registers as custom tool id 'ashareboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 指数代码与名称（名称以接口返回为准，此处仅作占位）
  const INDICES = [
    { code: 'sh000001', name: '上证指数' },
    { code: 'sz399001', name: '深证成指' },
    { code: 'sz399006', name: '创业板指' },
    { code: 'sh000688', name: '科创50' },
    { code: 'bj899050', name: '北证50' },
    { code: 'sh000300', name: '沪深300' },
    { code: 'sh000905', name: '中证500' },
    { code: 'sh000852', name: '中证1000' },
  ];
  const QT_URL = 'https://qt.gtimg.cn/q=' + INDICES.map((i) => i.code).join(',');
  /* 腾讯行情字段下标（v_<code> 值按 ~ 切分，0 基；已用 curl|iconv -f gbk 实测 2026-07）：
   * 1=名称 3=现价 4=昨收 5=今开 30=时间戳 31=涨跌额 32=涨跌% 33=最高 34=最低 37=成交额(万元) */
  const F_NAME = 1;
  const F_PRICE = 3;
  const F_PREV = 4;
  const F_OPEN = 5;
  const F_CHG = 31;
  const F_PCT = 32;
  const F_HIGH = 33;
  const F_LOW = 34;
  const F_AMT = 37;

  const EM_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 沪深A股
  const EM_FIELDS = 'f12,f14,f2,f3'; // 代码/名称/最新价/涨跌幅%
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host, po) =>
    `${host}/api/qt/clist/get?pn=1&pz=8&po=${po}&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(EM_FS)}&fields=${EM_FIELDS}`;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const JSONP_TIMEOUT_MS = 10000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('aboard-style')) return;
    const style = document.createElement('style');
    style.id = 'aboard-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.aboard-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .aboard-root { --up: #C0442F; --down: #2E7D4F; }
.aboard-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.aboard-head-right { display: flex; align-items: center; gap: 8px; }
.aboard-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.aboard-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.aboard-status { color: var(--warning); white-space: nowrap; }
.aboard-status.live { color: var(--acc); }
/* A股红涨绿跌：--up=红=涨，--down=绿=跌 */
.aboard-up { color: var(--up); }
.aboard-down { color: var(--down); }
.aboard-flat { color: var(--text-muted); }
.aboard-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 720px) {
  .aboard-grid { grid-template-columns: repeat(2, 1fr); }
}
.aboard-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.aboard-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.aboard-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aboard-amt {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.aboard-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.aboard-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.aboard-ohlc {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}
.aboard-ohlc b {
  font-weight: 400;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.aboard-sum {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.aboard-sum-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.aboard-sum-value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.aboard-sum-note { font-size: 9px; color: var(--text-dim); width: 100%; }
.aboard-boards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 720px) {
  .aboard-boards { grid-template-columns: 1fr; }
}
.aboard-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
}
.aboard-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.aboard-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.aboard-table { font-variant-numeric: tabular-nums; }
.aboard-table th, .aboard-table td { white-space: nowrap; }
.aboard-num { font-family: var(--font-mono); }
.aboard-stock { font-weight: 600; }
.aboard-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.aboard-empty td {
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

  // 成交额（万元）→ 亿/万
  const fmtAmt = (wan) => {
    if (!Number.isFinite(wan)) return '—';
    if (Math.abs(wan) >= 1e4) return `${fmtNum(wan / 1e4, 0)}亿`;
    return `${fmtNum(wan, 0)}万`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'aboard-flat';
    return v > 0 ? 'aboard-up' : 'aboard-down';
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

  window.GT_EXTRA_TOOLS['ashareboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool aboard-root">
          <div class="aboard-head">
            <span>A股 · 盘面总览</span>
            <span class="aboard-head-right">
              <span class="aboard-session" data-session>—</span>
              <span class="aboard-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="aboard-grid">
            ${INDICES.map(
              (idx) => `
              <div class="aboard-card" data-code="${esc(idx.code)}">
                <div class="aboard-card-top">
                  <span class="aboard-name" data-name>${esc(idx.name)}</span>
                  <span class="aboard-amt" data-amt>—</span>
                </div>
                <div class="aboard-price aboard-flat" data-price>—</div>
                <div class="aboard-chg"><span data-chg class="aboard-flat">—</span><span data-pct class="aboard-flat">—</span></div>
                <div class="aboard-ohlc"><span>开 <b data-open>—</b></span><span>高 <b data-high>—</b></span><span>低 <b data-low>—</b></span><span>昨 <b data-prev>—</b></span></div>
              </div>`
            ).join('')}
          </div>
          <div class="aboard-sum">
            <span class="aboard-sum-label">沪深两市成交额</span>
            <span class="aboard-sum-value" data-sum>—</span>
            <span class="aboard-sum-note">上证指数 + 深证成指成交额合计口径（腾讯行情，单位换算为亿元）</span>
          </div>
          <div class="aboard-boards">
            <div class="aboard-board">
              <div class="aboard-board-title"><span class="aboard-up">领涨 TOP 8</span><i data-up-note></i></div>
              <table class="data-table aboard-table">
                <thead><tr><th>名称</th><th>现价</th><th>涨幅</th></tr></thead>
                <tbody data-up-body></tbody>
              </table>
            </div>
            <div class="aboard-board">
              <div class="aboard-board-title"><span class="aboard-down">领跌 TOP 8</span><i data-down-note></i></div>
              <table class="data-table aboard-table">
                <thead><tr><th>名称</th><th>现价</th><th>跌幅</th></tr></thead>
                <tbody data-down-body></tbody>
              </table>
            </div>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const sumEl = el.querySelector('[data-sum]');
      const upBody = el.querySelector('[data-up-body]');
      const downBody = el.querySelector('[data-down-body]');
      const upNote = el.querySelector('[data-up-note]');
      const downNote = el.querySelector('[data-down-note]');
      const cards = {};
      el.querySelectorAll('.aboard-card').forEach((card) => {
        cards[card.getAttribute('data-code')] = {
          name: card.querySelector('[data-name]'),
          amt: card.querySelector('[data-amt]'),
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
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
        conn.className = 'aboard-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'aboard-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'aboard-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'aboard-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'aboard-session';
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
      const clearGlobals = () => {
        INDICES.forEach((idx) => readGlobal('v_' + idx.code));
      };

      // 腾讯 JSONP：每次重新注入带时间戳的 <script charset="gb2312">，完成后清理节点与全局变量
      const fetchIndices = () =>
        new Promise((resolve, reject) => {
          if (!alive) {
            reject(new Error('disposed'));
            return;
          }
          const script = document.createElement('script');
          script.charset = 'gb2312';
          script.async = true;
          script.src = `${QT_URL}&_t=${Date.now()}`;
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
              clearGlobals();
              reject(err);
              return;
            }
            const out = {};
            let ok = 0;
            INDICES.forEach((idx) => {
              const raw = readGlobal('v_' + idx.code);
              if (typeof raw === 'string' && raw.indexOf('~') > 0) {
                out[idx.code] = raw.split('~');
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

      const renderIndices = (data) => {
        let shAmt = NaN;
        let szAmt = NaN;
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
          const amt = parseFloat(f[F_AMT]); // 万元
          if (f[F_NAME]) c.name.textContent = String(f[F_NAME]);
          const cls = dirClass(chg);
          c.price.textContent = fmtNum(price, 2);
          c.price.className = `aboard-price ${cls}`;
          c.chg.textContent = fmtSigned(chg, 2);
          c.chg.className = cls;
          c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
          c.pct.className = cls;
          c.open.textContent = fmtNum(open, 2);
          c.high.textContent = fmtNum(high, 2);
          c.low.textContent = fmtNum(low, 2);
          c.prev.textContent = fmtNum(prev, 2);
          c.amt.textContent = `成交 ${fmtAmt(amt)}`;
          if (idx.code === 'sh000001') shAmt = amt;
          if (idx.code === 'sz399001') szAmt = amt;
        });
        if (Number.isFinite(shAmt) && Number.isFinite(szAmt)) {
          sumEl.textContent = fmtAmt(shAmt + szAmt);
        }
      };

      // 东财榜单：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchBoard = async (po) => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i], po), { signal: ctrl.signal, cache: 'no-store' });
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
        throw lastErr || new Error('board error');
      };

      const renderBoard = (tbody, noteEl, result, isUp) => {
        const cls = isUp ? 'aboard-up' : 'aboard-down';
        const rows = result.rows
          .map((r) => ({ code: String(r.f12 || ''), name: String(r.f14 || ''), price: Number(r.f2), pct: Number(r.f3) }))
          .filter((r) => r.code && Number.isFinite(r.pct))
          .slice(0, 8);
        noteEl.textContent = result.delayed ? '延时行情' : '';
        if (!rows.length) {
          tbody.innerHTML = `<tr class="aboard-empty"><td colspan="3">暂无数据</td></tr>`;
          return;
        }
        tbody.innerHTML = rows
          .map(
            (r) => `
            <tr>
              <td class="aboard-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="aboard-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="aboard-num ${cls}">${esc(fmtSigned(r.pct, 2))}%</td>
            </tr>`
          )
          .join('');
      };

      const renderBoardError = (tbody, noteEl) => {
        noteEl.textContent = '';
        tbody.innerHTML = `<tr class="aboard-empty"><td colspan="3">榜单加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [idxRes, upRes, downRes] = await Promise.allSettled([fetchIndices(), fetchBoard(1), fetchBoard(0)]);
          if (!alive) return;
          if (idxRes.status === 'fulfilled') {
            renderIndices(idxRes.value);
            clearError();
          } else {
            showError('指数行情加载失败，30 秒后自动重试…');
          }
          if (upRes.status === 'fulfilled') renderBoard(upBody, upNote, upRes.value, true);
          else renderBoardError(upBody, upNote);
          if (downRes.status === 'fulfilled') renderBoard(downBody, downNote, downRes.value, false);
          else renderBoardError(downBody, downNote);
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
        clearGlobals();
      };
    },
  };
})();
