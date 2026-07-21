/* A股ETF期权链（T型报价摘要）— 东财上交所期权全市场(CORS JSON) + 腾讯ETF现货行情(JSONP/GBK)
 * 期权合约: https://push2.eastmoney.com/api/qt/clist/get?fs=m:10 （上交所挂牌全部 ETF 期权，
 *   50ETF/300ETF/500ETF/科创50/科创板50 共 748 个合约，pz 上限 100 需分页；
 *   响应头 Access-Control-Allow-Origin: *，失败时回退 push2delay 延时通道，照抄 ashareboard.js 双 host 模式）
 *   字段: f2=最新价 f3=涨跌% f5=成交量(张) f6=成交额 f108=持仓量 f12=代码 f14=名称（如 "50ETF购7月2900"）
 *   合约名正则 ^(50ETF|300ETF)(购|沽)(\d+)月(\d+)$，带 A 后缀的调整合约被排除。
 * 现货: https://qt.gtimg.cn/q=sh510050,sh510300 （注入 <script charset="gb2312">，全局 v_<code>）
 *   字段下标（v_<code> 值按 ~ 切分，0 基，同 ashareboard.js）：1=名称 3=现价 31=涨跌额 32=涨跌%
 * 当月到期日：上交所 ETF 期权到期日为到期月第 4 个星期三（遇节假日顺延未处理），按北京时间客户端计算。
 * 接口实测结论（2026-07-16，curl 验证，含 Origin: https://trading.2009731.xyz）：
 *   - push2delay.eastmoney.com fs=m:10：合约清单完整（748 个，f12/f14 正常，含 ACAO 头），
 *     但延时通道不下发期权行情：f2/f3/f5/f108 全部为 "-"（stock/get 单合约 f43 同样为空，仅 f60 昨收有效）。
 *   - push2.eastmoney.com：本机出口 IP 全部 3 个 CDN 节点均 502（已知按出口 IP 封锁，与其他 A股组件一致），
 *     期权行情字段未能从本机验证；正常访客浏览器可达 push2 时组件显示完整 T 型报价，
 *     仅能达 push2delay 时降级为「合约结构 + 现货 + 到期倒计时」，并在界面注明。
 *   - 备选源均不可用：腾讯期权代码（sh/s_/op/CON_OP 前缀）返回 v_pv_none_match；
 *     新浪 hq.sinajs.cn 强制校验 Referer 且无 ACAO；网易/搜狐无期权代码；
 *     东财 datacenter RPT_OPTION_* 报表不存在；fs=b:MK0350/0446/0448/0501 均 rc:102。
 * 注意：A股红涨绿跌，方向着色 optc-up=var(--up) / optc-down=var(--down)，认购/认沽各按自身涨跌着色。
 * Registers as custom tool id 'optionchain' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const UNDERLYINGS = [
    { key: '50ETF', spot: 'sh510050', label: '50ETF期权' },
    { key: '300ETF', spot: 'sh510300', label: '300ETF期权' },
  ];
  const QT_URL = 'https://qt.gtimg.cn/q=' + UNDERLYINGS.map((u) => u.spot).join(',');
  // 腾讯字段下标（0 基，同 ashareboard.js）
  const F_NAME = 1;
  const F_PRICE = 3;
  const F_CHG = 31;
  const F_PCT = 32;

  const EM_FS = 'm:10'; // 上交所 ETF 期权全市场
  const EM_FIELDS = 'f12,f14,f2,f3,f5,f6,f108';
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时通道兜底
  const EM_MAX_PAGES = 10; // pz 上限 100，748 个合约需 8 页
  const emUrl = (host, pn) =>
    `${host}/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${EM_FS}&fields=${EM_FIELDS}`;
  const NAME_RE = /^(50ETF|300ETF)(购|沽)(\d+)月(\d+)$/; // 排除带 A 后缀的调整合约
  const ATM_AROUND = 3; // 平值上下各 3 档

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const JSONP_TIMEOUT_MS = 10000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('optc-style')) return;
    const style = document.createElement('style');
    style.id = 'optc-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.optc-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .optc-root { --up: #C0442F; --down: #2E7D4F; }
.optc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.optc-head-right { display: flex; align-items: center; gap: 8px; }
.optc-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.optc-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.optc-status { color: var(--warning); white-space: nowrap; }
.optc-status.live { color: var(--acc); }
/* A股红涨绿跌：optc-up=涨 / optc-down=跌，颜色随全站令牌 var(--up)/var(--down) */
.optc-up { color: var(--up); }
.optc-down { color: var(--down); }
.optc-flat { color: var(--text-muted); }
.optc-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.optc-tab {
  font-size: 10px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.08em;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
}
.optc-tab:hover { color: var(--text); }
.optc-tab.active {
  color: var(--text);
  border-color: var(--acc);
  background: color-mix(in srgb, var(--acc) 10%, transparent);
}
.optc-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: baseline;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  margin-bottom: 8px;
  background: var(--surface-raised);
}
.optc-strip-item { display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.optc-strip-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; }
.optc-strip-value {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.optc-strip-note { font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); }
.optc-table { font-variant-numeric: tabular-nums; }
.optc-table th, .optc-table td { white-space: nowrap; }
.optc-table th.optc-call { color: var(--up); }
.optc-table th.optc-put { color: var(--down); }
.optc-num { font-family: var(--font-mono); }
.optc-vol { color: var(--text-dim); font-size: 10px; }
.optc-strike {
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text);
  border-left: 1px solid var(--hairline);
  border-right: 1px solid var(--hairline);
}
.optc-strike i { font-style: normal; font-size: 9px; color: var(--acc); margin-left: 3px; }
.optc-atm td { background: color-mix(in srgb, var(--acc) 6%, transparent); }
.optc-atm .optc-strike { color: var(--acc); }
.optc-table tbody tr:hover td { background: var(--acc-glow); }
.optc-empty td {
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

  // 成交量（张）→ 万
  const fmtVol = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e4) return `${fmtNum(v / 1e4, 1)}万`;
    return fmtNum(v, 0);
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'optc-flat';
    return v > 0 ? 'optc-up' : 'optc-down';
  };

  // 北京时间（UTC+8）
  const bjNow = () => {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
  };

  // 交易时段：周一至五 09:30-11:30 / 13:00-15:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    const bj = bjNow();
    const day = bj.getDay();
    const mins = bj.getHours() * 60 + bj.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 570 && mins < 690) || (mins >= 780 && mins <= 900)) return 'trading';
    if (mins >= 690 && mins < 780) return 'lunch';
    return 'closed';
  };

  // 到期月第 4 个星期三（上交所 ETF 期权到期日规则，遇节假日顺延未处理）
  const fourthWednesday = (year, month) => {
    const d = new Date(year, month - 1, 1);
    let count = 0;
    while (count < 4) {
      if (d.getDay() === 3) count += 1;
      if (count < 4) d.setDate(d.getDate() + 1);
    }
    return d;
  };

  window.GT_EXTRA_TOOLS['optionchain'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool optc-root">
          <div class="optc-head">
            <span>A股 · ETF期权链</span>
            <span class="optc-head-right">
              <span class="optc-session" data-session>—</span>
              <span class="optc-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="optc-tabs">
            ${UNDERLYINGS.map(
              (u, i) => `<button type="button" class="optc-tab${i === 0 ? ' active' : ''}" data-tab="${esc(u.key)}">${esc(u.label)}</button>`
            ).join('')}
          </div>
          <div class="optc-strip">
            <span class="optc-strip-item"><span class="optc-strip-label" data-spot-label>现货</span><span class="optc-strip-value optc-flat" data-spot>—</span></span>
            <span class="optc-strip-item"><span class="optc-strip-label">当月</span><span class="optc-strip-value" data-cycle>—</span></span>
            <span class="optc-strip-item"><span class="optc-strip-label">到期</span><span class="optc-strip-value" data-expiry>—</span><span class="optc-strip-note" data-countdown></span></span>
            <span class="optc-strip-item"><span class="optc-strip-label">量PCR</span><span class="optc-strip-value" data-pcr-vol>—</span><span class="optc-strip-note" data-pcr-vol-note></span></span>
            <span class="optc-strip-item"><span class="optc-strip-label">仓PCR</span><span class="optc-strip-value" data-pcr-oi>—</span></span>
          </div>
          <table class="data-table optc-table">
            <thead>
              <tr>
                <th class="optc-call">涨幅</th><th class="optc-call">购·最新</th><th class="optc-call">量</th>
                <th style="text-align:center">行权价</th>
                <th class="optc-put">沽·最新</th><th class="optc-put">涨幅</th><th class="optc-put">量</th>
              </tr>
            </thead>
            <tbody data-chain-body></tbody>
          </table>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const spotLabel = el.querySelector('[data-spot-label]');
      const spotEl = el.querySelector('[data-spot]');
      const cycleEl = el.querySelector('[data-cycle]');
      const expiryEl = el.querySelector('[data-expiry]');
      const countdownEl = el.querySelector('[data-countdown]');
      const pcrVolEl = el.querySelector('[data-pcr-vol]');
      const pcrVolNoteEl = el.querySelector('[data-pcr-vol-note]');
      const pcrOiEl = el.querySelector('[data-pcr-oi]');
      const chainBody = el.querySelector('[data-chain-body]');
      const tabBtns = Array.from(el.querySelectorAll('[data-tab]'));

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let activeTab = UNDERLYINGS[0].key;
      let contractsByU = {}; // key → 合约数组
      let spotByU = {}; // key → {name, price, chg, pct}
      let quotesMissing = false; // 延时通道无期权行情
      const pendingScripts = new Set(); // 进行中的 JSONP <script> 节点
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'optc-status';
        setStatus('offline');
      };
      const showNote = (msg) => {
        // 部分数据可用：提示但不置 offline
        hint.textContent = msg;
        hint.style.display = msg ? '' : 'none';
        conn.textContent = '● LIVE';
        conn.className = 'optc-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'optc-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'optc-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'optc-session';
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
        UNDERLYINGS.forEach((u) => readGlobal('v_' + u.spot));
      };

      // 腾讯 JSONP：每次重新注入带时间戳的 <script charset="gb2312">，完成后清理节点与全局变量
      const fetchSpot = () =>
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
            UNDERLYINGS.forEach((u) => {
              const raw = readGlobal('v_' + u.spot);
              if (typeof raw === 'string' && raw.indexOf('~') > 0) {
                const f = raw.split('~');
                out[u.key] = {
                  name: String(f[F_NAME] || u.key),
                  price: parseFloat(f[F_PRICE]),
                  chg: parseFloat(f[F_CHG]),
                  pct: parseFloat(f[F_PCT]),
                };
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

      // 单页 CORS fetch（带超时与 AbortController）
      const fetchPage = async (host, pn) => {
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(emUrl(host, pn), { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          const json = await resp.json();
          const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
          return diff;
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      // 东财期权链：分页拉全 748 个合约后按名称过滤 50ETF/300ETF，push2 失败时回退 push2delay
      const fetchOptions = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          try {
            const rows = [];
            for (let pn = 1; pn <= EM_MAX_PAGES; pn += 1) {
              if (!alive) throw new Error('disposed');
              const diff = await fetchPage(EM_HOSTS[i], pn);
              diff.forEach((r) => rows.push(r));
              if (diff.length < 100) break;
            }
            const parsed = { '50ETF': [], '300ETF': [] };
            let quoted = 0;
            rows.forEach((r) => {
              const m = NAME_RE.exec(String(r.f14 || ''));
              if (!m) return;
              const price = Number(r.f2);
              if (Number.isFinite(price)) quoted += 1;
              parsed[m[1]].push({
                code: String(r.f12 || ''),
                cp: m[2] === '购' ? 'C' : 'P',
                month: Number(m[3]),
                strike: Number(m[4]), // 厘：3000 → 3.000 元
                price,
                pct: Number(r.f3),
                vol: Number(r.f5),
                oi: Number(r.f108),
              });
            });
            const total = parsed['50ETF'].length + parsed['300ETF'].length;
            if (total === 0) throw new Error('no contracts');
            return { parsed, delayed: i > 0, quoted };
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('options error');
      };

      // 当月合约：到期日（第 4 个周三）≥ 今天（北京时间）的最近一个到期月
      const pickCycle = (contracts) => {
        const bj = bjNow();
        const today = new Date(bj.getFullYear(), bj.getMonth(), bj.getDate());
        const months = {};
        contracts.forEach((c) => {
          months[c.month] = true;
        });
        let best = null;
        Object.keys(months).forEach((ms) => {
          const m = Number(ms);
          const year = m >= bj.getMonth() + 1 ? bj.getFullYear() : bj.getFullYear() + 1;
          const expiry = fourthWednesday(year, m);
          if (expiry >= today && (!best || expiry < best.expiry)) best = { month: m, expiry };
        });
        if (!best && Object.keys(months).length) {
          // 全部到期月均早于今天（极端情况）：取最小月
          const m = Math.min.apply(null, Object.keys(months).map(Number));
          const year = m >= bj.getMonth() + 1 ? bj.getFullYear() : bj.getFullYear() + 1;
          best = { month: m, expiry: fourthWednesday(year, m) };
        }
        return best;
      };

      const render = () => {
        const u = UNDERLYINGS.find((x) => x.key === activeTab);
        spotLabel.textContent = u ? u.key : '现货';
        const spot = spotByU[activeTab];
        if (spot && Number.isFinite(spot.price)) {
          spotEl.textContent = `${fmtNum(spot.price, 3)} ${Number.isFinite(spot.pct) ? fmtSigned(spot.pct, 2) + '%' : ''}`;
          spotEl.className = `optc-strip-value ${dirClass(spot.chg)}`;
        } else {
          spotEl.textContent = '—';
          spotEl.className = 'optc-strip-value optc-flat';
        }

        const contracts = contractsByU[activeTab] || [];
        const cycle = pickCycle(contracts);
        if (!cycle) {
          cycleEl.textContent = '—';
          expiryEl.textContent = '—';
          countdownEl.textContent = '';
          pcrVolEl.textContent = '—';
          pcrVolNoteEl.textContent = '';
          pcrOiEl.textContent = '—';
          chainBody.innerHTML = `<tr class="optc-empty"><td colspan="7">当月合约数据不可用</td></tr>`;
          return;
        }

        cycleEl.textContent = `${cycle.month}月`;
        expiryEl.textContent = `${String(cycle.expiry.getMonth() + 1).padStart(2, '0')}-${String(cycle.expiry.getDate()).padStart(2, '0')}`;
        const bj = bjNow();
        const today = new Date(bj.getFullYear(), bj.getMonth(), bj.getDate());
        const days = Math.round((cycle.expiry - today) / 86400000);
        countdownEl.textContent = days <= 0 ? '今日到期' : `剩${days}天`;

        const monthContracts = contracts.filter((c) => c.month === cycle.month);
        // PCR：当月全部行权价认沽/认购之比
        let callVol = 0;
        let putVol = 0;
        let callOi = 0;
        let putOi = 0;
        monthContracts.forEach((c) => {
          if (c.cp === 'C') {
            if (Number.isFinite(c.vol)) callVol += c.vol;
            if (Number.isFinite(c.oi)) callOi += c.oi;
          } else {
            if (Number.isFinite(c.vol)) putVol += c.vol;
            if (Number.isFinite(c.oi)) putOi += c.oi;
          }
        });
        if (callVol > 0 && putVol > 0) {
          const pcr = putVol / callVol;
          pcrVolEl.textContent = fmtNum(pcr, 2);
          pcrVolNoteEl.textContent = pcr >= 1.2 ? '避险偏空' : pcr <= 0.8 ? '偏多' : '中性';
        } else {
          pcrVolEl.textContent = '—';
          pcrVolNoteEl.textContent = '';
        }
        pcrOiEl.textContent = callOi > 0 && putOi > 0 ? fmtNum(putOi / callOi, 2) : '—';

        // T 型表：平值上下各 3 档
        const strikes = Array.from(new Set(monthContracts.map((c) => c.strike))).sort((a, b) => a - b);
        const callMap = {};
        const putMap = {};
        monthContracts.forEach((c) => {
          if (c.cp === 'C') callMap[c.strike] = c;
          else putMap[c.strike] = c;
        });
        let atmIdx = 0;
        if (spot && Number.isFinite(spot.price)) {
          const target = spot.price * 1000;
          strikes.forEach((s, i) => {
            if (Math.abs(s - target) < Math.abs(strikes[atmIdx] - target)) atmIdx = i;
          });
        }
        const from = Math.max(0, atmIdx - ATM_AROUND);
        const to = Math.min(strikes.length - 1, atmIdx + ATM_AROUND);
        if (!strikes.length) {
          chainBody.innerHTML = `<tr class="optc-empty"><td colspan="7">当月合约数据不可用</td></tr>`;
          return;
        }
        const cell = (c, kind) => {
          if (!c) return '<td class="optc-num optc-flat">—</td>';
          if (kind === 'pct') {
            return `<td class="optc-num ${dirClass(c.pct)}">${Number.isFinite(c.pct) ? esc(fmtSigned(c.pct, 2)) + '%' : '—'}</td>`;
          }
          if (kind === 'price') {
            return `<td class="optc-num">${Number.isFinite(c.price) ? esc(fmtNum(c.price, 4)) : '—'}</td>`;
          }
          return `<td class="optc-num optc-vol">${esc(fmtVol(c.vol))}</td>`;
        };
        const rowsHtml = [];
        for (let i = from; i <= to; i += 1) {
          const s = strikes[i];
          const isAtm = i === atmIdx;
          rowsHtml.push(`
            <tr${isAtm ? ' class="optc-atm"' : ''}>
              ${cell(callMap[s], 'pct')}
              ${cell(callMap[s], 'price')}
              ${cell(callMap[s], 'vol')}
              <td class="optc-strike">${esc(fmtNum(s / 1000, 3))}${isAtm ? '<i>ATM</i>' : ''}</td>
              ${cell(putMap[s], 'price')}
              ${cell(putMap[s], 'pct')}
              ${cell(putMap[s], 'vol')}
            </tr>`);
        }
        chainBody.innerHTML = rowsHtml.join('');
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [spotRes, optRes] = await Promise.allSettled([fetchSpot(), fetchOptions()]);
          if (!alive) return;
          if (spotRes.status === 'fulfilled') spotByU = spotRes.value;
          if (optRes.status === 'fulfilled') {
            contractsByU = optRes.value.parsed;
            quotesMissing = optRes.value.quoted === 0;
            const notes = [];
            if (optRes.value.delayed) notes.push('延时通道不下发期权行情，仅展示合约结构（东财 push2 对本网络不可达）');
            else if (quotesMissing) notes.push('期权行情暂缺，仅展示合约结构');
            if (spotRes.status !== 'fulfilled') notes.push('现货行情加载失败');
            showNote(notes.join('；'));
          } else if (spotRes.status === 'fulfilled') {
            showNote('期权链加载失败，展示现货行情，30 秒后自动重试…');
          } else {
            showError('行情加载失败，30 秒后自动重试…');
          }
          render();
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      const onTabClick = (e) => {
        const btn = e.currentTarget;
        activeTab = btn.getAttribute('data-tab');
        tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
        render();
      };
      tabBtns.forEach((b) => b.addEventListener('click', onTabClick));

      renderSession();
      refresh();
      tickTimer = setInterval(tick, REFRESH_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        tabBtns.forEach((b) => b.removeEventListener('click', onTabClick));
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
