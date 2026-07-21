/* A股个股速查 + 自选盯盘 — 腾讯行情 JSONP（qt.gtimg.cn + smartbox.gtimg.cn 智能提示）
 * 行情: https://qt.gtimg.cn/q=sh600519,sz300750,... （注入 <script charset="gb2312">，响应定义全局 v_<code>，
 *   GBK 编码必须走 JSONP，不支持 fetch 正确解码中文；已 curl 实测 2026-07-16：HTTP 200，GBK 数据正常）
 *   字段下标（v_<code> 值按 ~ 切分，0 基，同 ashareboard.js）：
 *   1=名称 3=现价 4=昨收 5=今开 30=时间戳 31=涨跌额 32=涨跌% 33=最高 34=最低 37=成交额(万元)
 * 搜索: https://smartbox.gtimg.cn/s3/?v=2&q=关键词&t=all （JSONP，响应定义全局 v_hint，
 *   格式 "市场~代码~名称~拼音~类型^市场~代码~..."，A股类型为 GP-A；
 *   已 curl 实测 2026-07-16：HTTP 200，无 CORS 头 → 必须 JSONP；内容为 ASCII+\u 转义，无需指定 charset）
 * 持久化: localStorage 'gt-ashare-watch-v1'（[{code,name}]，与币圈/外汇组件 watchlist.js 的 gt-watchlist-v1 独立）
 * 注意：A股红涨绿跌，方向着色用语义令牌 var(--up)=红涨 / var(--down)=绿跌，不使用 --acc/--danger。
 * Registers as custom tool id 'asharequote' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt-ashare-watch-v1';
  const QT_BASE = 'https://qt.gtimg.cn/q=';
  const SMART_URL = 'https://smartbox.gtimg.cn/s3/?v=2&t=all&q=';
  const MAX_ITEMS = 30; // 自选股上限（控制批量查询 URL 长度）
  const MAX_SUGGEST = 8; // 搜索提示条数
  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市低频刷新
  const JSONP_TIMEOUT_MS = 10000;
  const SUGGEST_DEBOUNCE_MS = 250;

  const F_NAME = 1;
  const F_PRICE = 3;
  const F_PREV = 4;
  const F_OPEN = 5;
  const F_TIME = 30;
  const F_CHG = 31;
  const F_PCT = 32;
  const F_HIGH = 33;
  const F_LOW = 34;
  const F_AMT = 37;

  // 默认预置权重股
  const DEFAULT_LIST = [
    { code: 'sh600519', name: '贵州茅台' },
    { code: 'sz300750', name: '宁德时代' },
    { code: 'sh600036', name: '招商银行' },
    { code: 'sh601318', name: '中国平安' },
    { code: 'sz000858', name: '五粮液' },
  ];

  function injectStyle() {
    if (document.getElementById('aquote-style')) return;
    const style = document.createElement('style');
    style.id = 'aquote-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.aquote-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .aquote-root { --up: #C0442F; --down: #2E7D4F; }
.aquote-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.aquote-head-right { display: flex; align-items: center; gap: 8px; }
.aquote-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.aquote-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.aquote-status { color: var(--warning); white-space: nowrap; }
.aquote-status.live { color: var(--acc); }
/* A股红涨绿跌：var(--up)=红涨 / var(--down)=绿跌，勿改用 --acc/--danger */
.aquote-up { color: var(--up); }
.aquote-down { color: var(--down); }
.aquote-flat { color: var(--text-muted); }
.aquote-search { position: relative; margin-bottom: 8px; }
.aquote-input {
  width: 100%;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 7px 10px;
  outline: none;
  transition: border-color 0.2s var(--ease-fluid);
}
.aquote-input:focus { border-color: var(--hairline-strong); }
.aquote-input::placeholder { color: var(--text-dim); }
.aquote-suggest {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bg-elevated);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: none;
  box-shadow: 0 16px 40px rgba(16, 14, 11, 0.35);
}
.aquote-suggest.show { display: block; }
.aquote-sug-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
  color: var(--text);
}
.aquote-sug-item:hover, .aquote-sug-item.active { background: var(--surface-raised); }
.aquote-sug-item .aquote-sug-code {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-muted);
  white-space: nowrap;
}
.aquote-sug-item .aquote-sug-name { font-weight: 600; }
.aquote-sug-empty { padding: 8px 10px; font-size: 10px; color: var(--text-muted); }
.aquote-table { font-variant-numeric: tabular-nums; width: 100%; }
.aquote-table th, .aquote-table td { white-space: nowrap; }
.aquote-num { font-family: var(--font-mono); }
.aquote-stock { font-weight: 600; }
.aquote-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.aquote-ohlc { font-size: 9px; color: var(--text-muted); }
.aquote-ohlc b { font-weight: 400; color: var(--text-dim); font-family: var(--font-mono); }
.aquote-del {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
}
.aquote-del:hover { color: var(--danger); background: var(--surface-raised); }
.aquote-time { font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); }
.aquote-empty td {
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
    if (Math.abs(wan) >= 1e4) return `${fmtNum(wan / 1e4, 1)}亿`;
    return `${fmtNum(wan, 0)}万`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'aquote-flat';
    return v > 0 ? 'aquote-up' : 'aquote-down';
  };

  // 6 位数字代码推断市场前缀：6→sh，0/3→sz，4/8→bj
  const inferCode = (digits) => {
    if (!/^\d{6}$/.test(digits)) return null;
    const d = digits.charAt(0);
    if (d === '6') return 'sh' + digits;
    if (d === '0' || d === '3') return 'sz' + digits;
    if (d === '4' || d === '8') return 'bj' + digits;
    return null;
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

  const loadList = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return DEFAULT_LIST.slice();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return DEFAULT_LIST.slice();
      return arr
        .filter((it) => it && typeof it.code === 'string' && /^(sh|sz|bj)\d{6}$/.test(it.code))
        .map((it) => ({ code: it.code, name: String(it.name || '') }))
        .slice(0, MAX_ITEMS);
    } catch (e) {
      return DEFAULT_LIST.slice();
    }
  };

  const saveList = (list) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
    } catch (e) { /* 忽略（隐私模式等） */ }
  };

  window.GT_EXTRA_TOOLS['asharequote'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool aquote-root">
          <div class="aquote-head">
            <span>A股 · 个股速查</span>
            <span class="aquote-head-right">
              <span class="aquote-session" data-session>—</span>
              <span class="aquote-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="aquote-search">
            <input class="aquote-input" data-input type="text" autocomplete="off" spellcheck="false"
              placeholder="输入代码 / 拼音简写 / 名称，回车或点选添加" />
            <div class="aquote-suggest" data-suggest></div>
          </div>
          <table class="data-table aquote-table">
            <thead><tr><th>名称</th><th>现价</th><th>涨跌幅</th><th>今开/最高/最低</th><th>成交额</th><th></th></tr></thead>
            <tbody data-body></tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const input = el.querySelector('[data-input]');
      const suggestBox = el.querySelector('[data-suggest]');

      let alive = true;
      let list = loadList();
      let suggestions = []; // 当前提示候选 [{code,name}]
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingScripts = new Set(); // 进行中的 JSONP <script> 节点
      const pendingTimers = new Set(); // 进行中的超时/防抖定时器
      const listeners = []; // 组件挂载的 DOM 事件（cleanup 统一移除）

      const on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        listeners.push([target, type, fn, opts]);
      };

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'aquote-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'aquote-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'aquote-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'aquote-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'aquote-session';
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

      // 通用 JSONP：注入 <script>，onload 后由 parser 从全局变量取数据；完成即清理节点与全局变量
      const jsonp = (src, charset, globalNames, parser) =>
        new Promise((resolve, reject) => {
          if (!alive) {
            reject(new Error('disposed'));
            return;
          }
          const script = document.createElement('script');
          if (charset) script.charset = charset;
          script.async = true;
          script.src = src;
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
              globalNames.forEach(readGlobal);
              reject(err);
              return;
            }
            try {
              resolve(parser());
            } catch (e) {
              globalNames.forEach(readGlobal);
              reject(e);
            }
          };
          const timer = setTimeout(() => finish(new Error('timeout')), JSONP_TIMEOUT_MS);
          pendingTimers.add(timer);
          script.onload = () => finish(null);
          script.onerror = () => finish(new Error('jsonp error'));
          pendingScripts.add(script);
          document.head.appendChild(script);
        });

      // 批量行情：qt.gtimg.cn JSONP（GBK），返回 { code: 字段数组 }
      const fetchQuotes = (codes) => {
        const names = codes.map((c) => 'v_' + c);
        return jsonp(
          `${QT_BASE}${codes.join(',')}&_t=${Date.now()}`,
          'gb2312',
          names,
          () => {
            const out = {};
            let ok = 0;
            codes.forEach((c) => {
              const raw = readGlobal('v_' + c);
              if (typeof raw === 'string' && raw.indexOf('~') > 0) {
                out[c] = raw.split('~');
                ok += 1;
              }
            });
            if (ok === 0) throw new Error('empty');
            return out;
          }
        );
      };

      // 智能提示：smartbox JSONP，响应 v_hint="市场~代码~名称~拼音~类型^..."，仅取沪深北 A股(GP-A)
      const fetchSuggest = (q) =>
        jsonp(`${SMART_URL}${encodeURIComponent(q)}&_t=${Date.now()}`, null, ['v_hint'], () => {
          const raw = readGlobal('v_hint');
          if (typeof raw !== 'string' || !raw) return [];
          return raw
            .split('^')
            .map((seg) => seg.split('~'))
            .filter((f) => f.length >= 4 && /^(sh|sz|bj)$/.test(f[0]) && /^\d{6}$/.test(f[1]) && f[4] === 'GP-A')
            .slice(0, MAX_SUGGEST)
            .map((f) => ({ code: f[0] + f[1], name: f[2] }));
        });

      const renderRows = (data) => {
        if (!list.length) {
          body.innerHTML = `<tr class="aquote-empty"><td colspan="6">自选为空，用上方搜索添加个股</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map((it) => {
            const f = data && data[it.code];
            if (!f) {
              return `<tr><td class="aquote-stock">${esc(it.name || it.code)}<i>${esc(it.code)}</i></td>
                <td colspan="4" class="aquote-time">暂无数据</td>
                <td><button class="aquote-del" data-del="${esc(it.code)}" title="删除">×</button></td></tr>`;
            }
            const name = f[F_NAME] || it.name || it.code;
            const price = parseFloat(f[F_PRICE]);
            const open = parseFloat(f[F_OPEN]);
            const high = parseFloat(f[F_HIGH]);
            const low = parseFloat(f[F_LOW]);
            const chg = parseFloat(f[F_CHG]);
            const pct = parseFloat(f[F_PCT]);
            const amt = parseFloat(f[F_AMT]); // 万元
            const time = String(f[F_TIME] || '');
            const cls = dirClass(chg);
            const hhmm = time.length >= 12 ? `${time.slice(8, 10)}:${time.slice(10, 12)}` : '';
            return `<tr>
              <td class="aquote-stock">${esc(name)}<i>${esc(it.code)}</i>${hhmm ? `<div class="aquote-time">${esc(hhmm)}</div>` : ''}</td>
              <td class="aquote-num ${cls}">${esc(fmtNum(price, 2))}</td>
              <td class="aquote-num ${cls}">${esc(fmtSigned(pct, 2))}%</td>
              <td class="aquote-ohlc"><b>${esc(fmtNum(open, 2))}</b> / <b>${esc(fmtNum(high, 2))}</b> / <b>${esc(fmtNum(low, 2))}</b></td>
              <td class="aquote-num">${esc(fmtAmt(amt))}</td>
              <td><button class="aquote-del" data-del="${esc(it.code)}" title="删除">×</button></td>
            </tr>`;
          })
          .join('');
      };

      const renderLoading = () => {
        if (!list.length) {
          body.innerHTML = `<tr class="aquote-empty"><td colspan="6">自选为空，用上方搜索添加个股</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map(
            (it) => `<tr><td class="aquote-stock">${esc(it.name || it.code)}<i>${esc(it.code)}</i></td>
            <td colspan="4" class="aquote-time">加载中…</td>
            <td><button class="aquote-del" data-del="${esc(it.code)}" title="删除">×</button></td></tr>`
          )
          .join('');
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        if (!list.length) {
          renderRows(null);
          clearError();
          return;
        }
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const data = await fetchQuotes(list.map((it) => it.code));
          if (!alive) return;
          renderRows(data);
          clearError();
        } catch (e) {
          if (!alive) return;
          showError('行情加载失败，稍后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        const s = renderSession();
        if (document.hidden) return; // 页面不可见时跳过刷新
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      const addStock = (code, name) => {
        if (!alive || !code) return;
        if (list.some((it) => it.code === code)) {
          input.value = '';
          hideSuggest();
          return;
        }
        if (list.length >= MAX_ITEMS) {
          showError(`自选已满（上限 ${MAX_ITEMS} 只），请先删除部分个股`);
          return;
        }
        list.push({ code, name: name || code });
        saveList(list);
        input.value = '';
        hideSuggest();
        refresh();
      };

      const removeStock = (code) => {
        const idx = list.findIndex((it) => it.code === code);
        if (idx < 0) return;
        list.splice(idx, 1);
        saveList(list);
        if (!list.length) renderRows(null);
        else refresh();
      };

      // ---- 搜索提示交互 ----
      const hideSuggest = () => {
        suggestBox.className = 'aquote-suggest';
        suggestBox.innerHTML = '';
        suggestions = [];
      };
      const showSuggest = (items, query) => {
        suggestions = items;
        if (!items.length) {
          suggestBox.innerHTML = `<div class="aquote-sug-empty">无匹配 A 股结果</div>`;
          suggestBox.className = 'aquote-suggest show';
          return;
        }
        suggestBox.innerHTML = items
          .map(
            (it, i) => `<div class="aquote-sug-item${i === 0 ? ' active' : ''}" data-idx="${i}">
              <span class="aquote-sug-name">${esc(it.name)}</span>
              <span class="aquote-sug-code">${esc(it.code)}</span>
            </div>`
          )
          .join('');
        suggestBox.className = 'aquote-suggest show';
      };

      let suggestSeq = 0; // 防抖后请求序号，丢弃过期响应
      const requestSuggest = (q) => {
        const seq = ++suggestSeq;
        fetchSuggest(q)
          .then((items) => {
            if (!alive || seq !== suggestSeq) return;
            if (input.value.trim() !== q) return; // 输入已变化，丢弃
            showSuggest(items, q);
          })
          .catch(() => {
            if (!alive || seq !== suggestSeq) return;
            hideSuggest();
          });
      };

      on(input, 'input', () => {
        const q = input.value.trim();
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          if (!alive) return;
          if (!q) {
            hideSuggest();
            return;
          }
          // 纯 6 位数字：直接推断市场，不走提示接口
          const direct = inferCode(q);
          if (direct) {
            showSuggest([{ code: direct, name: q }], q);
            return;
          }
          if (/^\d+$/.test(q)) {
            hideSuggest(); // 不完整数字不查询
            return;
          }
          requestSuggest(q);
        }, SUGGEST_DEBOUNCE_MS);
        pendingTimers.add(timer);
      });

      on(input, 'keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = input.value.trim();
          if (!q) return;
          const direct = inferCode(q);
          if (direct) {
            addStock(direct, q);
            return;
          }
          if (suggestions.length) addStock(suggestions[0].code, suggestions[0].name);
        } else if (e.key === 'Escape') {
          hideSuggest();
          input.blur();
        }
      });

      on(suggestBox, 'mousedown', (e) => {
        // mousedown 先于 input blur，确保点选生效
        const item = e.target.closest('.aquote-sug-item');
        if (!item) return;
        e.preventDefault();
        const idx = parseInt(item.getAttribute('data-idx'), 10);
        const it = suggestions[idx];
        if (it) addStock(it.code, it.name);
      });

      on(document, 'click', (e) => {
        if (!el.contains(e.target)) hideSuggest();
      });

      on(body, 'click', (e) => {
        const btn = e.target.closest('[data-del]');
        if (!btn) return;
        removeStock(btn.getAttribute('data-del'));
      });

      // ---- 启动 ----
      renderSession();
      renderLoading();
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
        pendingScripts.forEach((s) => {
          s.onload = null;
          s.onerror = null;
          if (s.parentNode) s.parentNode.removeChild(s);
        });
        pendingScripts.clear();
        listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
        listeners.length = 0;
        readGlobal('v_hint');
        list.forEach((it) => readGlobal('v_' + it.code));
      };
    },
  };
})();
