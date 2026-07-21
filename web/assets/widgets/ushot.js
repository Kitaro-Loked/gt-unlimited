/* 美股明星榜 — 固定明星个股行情板（成交额/涨幅异动榜 + 盘前盘后状态）
 * 主源: 腾讯行情 JSONP https://qt.gtimg.cn/q=usAAPL,usNVDA,... （注入 <script charset="gb2312">，响应定义全局 v_us<CODE>，无 CORS 必须 JSONP）
 * 备源: 东财 https://push2.eastmoney.com/api/qt/ulist.np/get （secids=105.<SYM> 纳斯达克；实测 2026-07-16 push2 全站 502，
 *       push2delay 正常且响应头 Access-Control-Allow-Origin: *，故按双 host 模式 push2 失败回退 push2delay 延时行情）
 * 腾讯字段下标（v_us<CODE> 值按 ~ 切分，0 基；curl|iconv -f gbk 实测 2026-07-16，共 71 字段）：
 *   1=名称 2=代码(如 AAPL.OQ) 3=现价 4=昨收 5=今开 30=时间戳 31=涨跌额 32=涨跌% 33=最高 34=最低
 *   36=成交量(股) 37=成交额(美元) 38=换手率% 39=市盈率 43=振幅% 45=总市值(亿美元) 46=英文名 48/49=52周高/低
 * 东财字段：f12=代码 f14=名称 f2=最新价 f3=涨跌幅% f4=涨跌额 f5=成交量 f6=成交额(美元) f15=高 f16=低 f17=开 f18=昨收
 * 盘前/盘后价：两源实测均不提供（免费行情时间戳停在上个交易日收盘，东财 f292=11），故组件仅展示时段状态并在页脚注明。
 * 注意：美股绿涨红跌（国际习惯），方向着色 ushot-up=var(--up) / ushot-down=var(--down)。
 * Registers as custom tool id 'ushot' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 明星个股清单（18 只，腾讯/东财两源 2026-07-16 实测全部有数据；东财侧均在 105 纳斯达克）
  const STOCKS = [
    { sym: 'NVDA', cn: '英伟达' },
    { sym: 'AAPL', cn: '苹果' },
    { sym: 'MSFT', cn: '微软' },
    { sym: 'AMZN', cn: '亚马逊' },
    { sym: 'GOOGL', cn: '谷歌A' },
    { sym: 'META', cn: 'Meta' },
    { sym: 'AVGO', cn: '博通' },
    { sym: 'TSLA', cn: '特斯拉' },
    { sym: 'AMD', cn: 'AMD' },
    { sym: 'MU', cn: '美光科技' },
    { sym: 'INTC', cn: '英特尔' },
    { sym: 'ARM', cn: 'ARM' },
    { sym: 'SMCI', cn: '超微电脑' },
    { sym: 'PLTR', cn: 'Palantir' },
    { sym: 'CRWD', cn: 'CrowdStrike' },
    { sym: 'NFLX', cn: '奈飞' },
    { sym: 'COIN', cn: 'Coinbase' },
    { sym: 'MSTR', cn: 'Strategy' },
  ];
  const CN_NAME = {};
  STOCKS.forEach((s) => { CN_NAME[s.sym] = s.cn; });

  const QT_URL = 'https://qt.gtimg.cn/q=' + STOCKS.map((s) => 'us' + s.sym).join(',');
  const F_NAME = 1;
  const F_PRICE = 3;
  const F_PREV = 4;
  const F_OPEN = 5;
  const F_CHG = 31;
  const F_PCT = 32;
  const F_HIGH = 33;
  const F_LOW = 34;
  const F_VOL = 36;
  const F_AMT = 37;

  const EM_SECIDS = STOCKS.map((s) => '105.' + s.sym).join(',');
  const EM_FIELDS = 'f12,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18';
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?np=1&fltt=2&invt=2&secids=${EM_SECIDS}&fields=${EM_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`;

  const TABS = [
    { key: 'amt', label: '成交额榜' },
    { key: 'up', label: '涨幅榜' },
    { key: 'down', label: '跌幅榜' },
  ];

  const REFRESH_MS = 30000; // 盘前/盘中/盘后刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const JSONP_TIMEOUT_MS = 10000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('ushot-style')) return;
    const style = document.createElement('style');
    style.id = 'ushot-style';
    style.textContent = `
.ushot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.ushot-head-right { display: flex; align-items: center; gap: 8px; }
.ushot-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ushot-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.ushot-session.ext { color: var(--warning); border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.ushot-status { color: var(--warning); white-space: nowrap; }
.ushot-status.live { color: var(--acc); }
/* 美股绿涨红跌（国际习惯）：--up=涨(松绿) --down=跌(陶土红) */
.ushot-up { color: var(--up); }
.ushot-down { color: var(--down); }
.ushot-flat { color: var(--text-muted); }
.ushot-sum {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--surface-raised);
}
.ushot-sum-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.ushot-sum-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.ushot-sum-note { font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; }
.ushot-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.ushot-tab {
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.06em;
  white-space: nowrap;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
}
.ushot-tab:hover { color: var(--text); border-color: var(--text-dim); }
.ushot-tab.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
}
.ushot-table { font-variant-numeric: tabular-nums; }
.ushot-table th, .ushot-table td { white-space: nowrap; }
.ushot-rank { font-family: var(--font-mono); color: var(--text-dim); width: 24px; }
.ushot-stock { font-weight: 600; }
.ushot-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.ushot-num { font-family: var(--font-mono); }
.ushot-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ushot-foot {
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

  // 成交额（美元）→ 亿美元
  const fmtAmt = (usd) => {
    if (!Number.isFinite(usd)) return '—';
    if (Math.abs(usd) >= 1e8) return `${fmtNum(usd / 1e8, 1)}亿`;
    return `${fmtNum(usd / 1e4, 0)}万`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ushot-flat';
    return v > 0 ? 'ushot-up' : 'ushot-down';
  };

  /* 美东时间（America/New_York，自动处理夏令时）时段划分（不含法定节假日，仅按星期粗判）：
   * 盘前 04:00-09:29 / 盘中 09:30-15:59 / 盘后 16:00-19:59 / 其余休市 */
  const sessionState = () => {
    let et;
    try {
      et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    } catch (e) {
      et = new Date(); // 极端环境回退本地时区
    }
    const day = et.getDay();
    const mins = et.getHours() * 60 + et.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if (mins >= 240 && mins < 570) return 'pre';
    if (mins >= 570 && mins < 960) return 'trading';
    if (mins >= 960 && mins < 1200) return 'after';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['ushot'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool ushot-root">
          <div class="ushot-head">
            <span>美股 · 明星榜</span>
            <span class="ushot-head-right">
              <span class="ushot-session" data-session>—</span>
              <span class="ushot-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="ushot-sum">
            <span class="ushot-sum-label">18 只合计成交额</span>
            <span class="ushot-sum-value" data-sum>—</span>
            <span class="ushot-sum-note" data-adv>—</span>
          </div>
          <div class="ushot-tabs">
            ${TABS.map(
              (t, i) => `<button type="button" class="ushot-tab${i === 0 ? ' active' : ''}" data-tab="${esc(t.key)}">${esc(t.label)}</button>`
            ).join('')}
          </div>
          <table class="data-table ushot-table">
            <thead><tr><th>#</th><th>名称</th><th>现价($)</th><th>涨跌额</th><th>涨跌幅</th><th>成交额($)</th></tr></thead>
            <tbody data-body></tbody>
          </table>
          <div class="ushot-foot">
            <span data-src>来源：腾讯行情 · 美股明星 18 只</span>
            <span data-updated></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const tbody = el.querySelector('[data-body]');
      const srcEl = el.querySelector('[data-src]');
      const updatedEl = el.querySelector('[data-updated]');
      const sumEl = el.querySelector('[data-sum]');
      const advEl = el.querySelector('[data-adv]');
      const tabBtns = Array.prototype.slice.call(el.querySelectorAll('[data-tab]'));

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let activeTab = TABS[0].key;
      let lastRows = []; // 最近一次成功获取的标准化行情
      let lastSource = '腾讯行情';
      const pendingScripts = new Set(); // 进行中的 JSONP <script> 节点
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'ushot-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ushot-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 盘中';
          sessionEl.className = 'ushot-session open';
        } else if (s === 'pre') {
          sessionEl.textContent = '盘前';
          sessionEl.className = 'ushot-session ext';
        } else if (s === 'after') {
          sessionEl.textContent = '盘后';
          sessionEl.className = 'ushot-session ext';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'ushot-session';
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
        STOCKS.forEach((s) => readGlobal('v_us' + s.sym));
      };

      // 标准化行情行
      const normRow = (sym, name, o) => ({
        sym,
        name: CN_NAME[sym] || name || sym,
        price: o.price,
        prev: o.prev,
        open: o.open,
        high: o.high,
        low: o.low,
        chg: o.chg,
        pct: o.pct,
        vol: o.vol,
        amt: o.amt,
      });

      // 腾讯 JSONP：每次重新注入带时间戳的 <script charset="gb2312">，完成后清理节点与全局变量
      const fetchTencent = () =>
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
            const rows = [];
            STOCKS.forEach((s) => {
              const raw = readGlobal('v_us' + s.sym);
              if (typeof raw !== 'string' || raw.indexOf('~') < 0) return;
              const f = raw.split('~');
              const price = parseFloat(f[F_PRICE]);
              if (!Number.isFinite(price) || price <= 0) return;
              rows.push(normRow(s.sym, f[F_NAME], {
                price,
                prev: parseFloat(f[F_PREV]),
                open: parseFloat(f[F_OPEN]),
                high: parseFloat(f[F_HIGH]),
                low: parseFloat(f[F_LOW]),
                chg: parseFloat(f[F_CHG]),
                pct: parseFloat(f[F_PCT]),
                vol: parseFloat(f[F_VOL]),
                amt: parseFloat(f[F_AMT]),
              }));
            });
            if (rows.length === 0) reject(new Error('empty'));
            else resolve({ rows, delayed: false, source: '腾讯行情' });
          };
          const timer = setTimeout(() => finish(new Error('timeout')), JSONP_TIMEOUT_MS);
          pendingTimers.add(timer);
          script.onload = () => finish(null);
          script.onerror = () => finish(new Error('jsonp error'));
          pendingScripts.add(script);
          document.head.appendChild(script);
        });

      // 东财备源：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchEastmoney = async () => {
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
            const rows = [];
            diff.forEach((r) => {
              const sym = String(r.f12 || '');
              const price = Number(r.f2);
              if (!sym || !Number.isFinite(price) || price <= 0) return;
              rows.push(normRow(sym, String(r.f14 || ''), {
                price,
                prev: Number(r.f18),
                open: Number(r.f17),
                high: Number(r.f15),
                low: Number(r.f16),
                chg: Number(r.f4),
                pct: Number(r.f3),
                vol: Number(r.f5),
                amt: Number(r.f6),
              }));
            });
            if (rows.length === 0) throw new Error('empty');
            return { rows, delayed: i > 0, source: i > 0 ? '东方财富 · 延时行情' : '东方财富' };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('eastmoney error');
      };

      const sortRows = (rows, tab) => {
        const arr = rows.slice();
        if (tab === 'amt') arr.sort((a, b) => (b.amt || 0) - (a.amt || 0));
        else if (tab === 'up') arr.sort((a, b) => (b.pct || 0) - (a.pct || 0));
        else arr.sort((a, b) => (a.pct || 0) - (b.pct || 0));
        return arr;
      };

      const renderBoard = () => {
        const rows = sortRows(lastRows, activeTab);
        srcEl.textContent = `来源：${lastSource} · 美股明星 ${lastRows.length} 只`;
        if (!rows.length) {
          tbody.innerHTML = `<tr class="ushot-empty"><td colspan="6">暂无数据</td></tr>`;
          sumEl.textContent = '—';
          advEl.textContent = '—';
          return;
        }
        let amtSum = 0;
        let up = 0;
        let down = 0;
        let flat = 0;
        lastRows.forEach((r) => {
          if (Number.isFinite(r.amt)) amtSum += r.amt;
          if (!Number.isFinite(r.chg) || r.chg === 0) flat += 1;
          else if (r.chg > 0) up += 1;
          else down += 1;
        });
        sumEl.textContent = fmtAmt(amtSum);
        advEl.innerHTML =
          `<span class="ushot-up">涨 ${up}</span> · <span class="ushot-down">跌 ${down}</span>` +
          (flat ? ` · <span class="ushot-flat">平 ${flat}</span>` : '');
        tbody.innerHTML = rows
          .map(
            (r, i) => `
            <tr>
              <td class="ushot-rank">${i + 1}</td>
              <td class="ushot-stock">${esc(r.name)}<i>${esc(r.sym)}</i></td>
              <td class="ushot-num ${dirClass(r.chg)}">${esc(fmtNum(r.price, 2))}</td>
              <td class="ushot-num ${dirClass(r.chg)}">${esc(fmtSigned(r.chg, 2))}</td>
              <td class="ushot-num ${dirClass(r.pct)}">${Number.isFinite(r.pct) ? esc(fmtSigned(r.pct, 2)) + '%' : '—'}</td>
              <td class="ushot-num">${esc(fmtAmt(r.amt))}</td>
            </tr>`
          )
          .join('');
      };

      const renderBoardError = () => {
        tbody.innerHTML = `<tr class="ushot-empty"><td colspan="6">行情加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          let result = null;
          try {
            result = await fetchTencent();
          } catch (e) {
            if (!alive) return;
            result = await fetchEastmoney(); // 主源失败回退东财
          }
          if (!alive) return;
          lastRows = result.rows;
          lastSource = result.source;
          renderBoard();
          updatedEl.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 免费行情不含盘前盘后价`;
          clearError();
        } catch (e) {
          if (!alive) return;
          renderBoardError();
          showError('行情加载失败，30 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      // tab 切换仅本地重排，不重新拉取
      const onTabClick = (ev) => {
        const key = ev.currentTarget.getAttribute('data-tab');
        if (!key || key === activeTab) return;
        activeTab = key;
        tabBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === key));
        renderBoard();
      };
      tabBtns.forEach((b) => b.addEventListener('click', onTabClick));

      const tick = () => {
        if (!alive || document.hidden) return; // 页面不可见时跳过刷新
        const s = renderSession();
        if (s !== 'closed' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
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
        tabBtns.forEach((b) => b.removeEventListener('click', onTabClick));
      };
    },
  };
})();
