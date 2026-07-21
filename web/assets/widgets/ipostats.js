/* A股新股表现与破发监测（近90天）— 东财 datacenter IPO 报表 + 腾讯/东财现价兜底
 * ① 新股清单: https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_APP_IPOAPPLY
 *    实测 2026-07-16（curl，带 Origin: https://example.com）：
 *    HTTP 200，响应头 Access-Control-Allow-Origin: *，浏览器跨域 fetch 可用。
 *    排序列 LISTING_DATE 可用（asharecb 注：PUBLIC_START_DATE 会报 9501；本报表 LISTING_DATE 正常）。
 *    filter=(LISTING_DATE>='YYYY-MM-DD')(LISTING_DATE<='YYYY-MM-DD') 可用（需 URL 编码），
 *    近 90 天窗口实测返回 38 只（2026-04-17 ~ 2026-07-16）。
 *    字段：SECUCODE=代码.市场(920117.BJ) SECURITY_CODE SECURITY_NAME(含N/C前缀) LISTING_DATE
 *    ISSUE_PRICE=发行价 LD_CLOSE_CHANGE=上市首日涨幅% LATELY_PRICE=最新价 MARKET_TYPE_NEW=板块
 *    （实测值：北交所/深交所其他/创业板注册制/科创板/上交所其他） INDUSTRY_NAME=行业
 *    LATELY_PRICE 实测与当日腾讯行情现价一致（301583→140.00 / 688797→348.03 / bj920117→35.34），可作现价兜底。
 *    注意：PROFIT/TOTAL_CHANGE 字段为过时口径（与现价对不上，如 301583 PROFIT 对应价 236.99 ≠ 现价 140），
 *    单签收益不取 PROFIT，改按 (现价-发行价)×每签股数 自算（沪深 500 股/签，北交所 100 股/签）。
 * ② 现价（交易时段实时）: 腾讯 JSONP https://qt.gtimg.cn/q=sz301583,sh688797,bj920117,...
 *    实测 2026-07-16：sh/sz/bj 三市场前缀均可用，<script charset="gb2312"> 注入，全局 v_<code>，~ 切分，3=现价。
 *    失败时回退东财 ulist: https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.688797,0.301583,0.920117
 *    （secid 市场位：沪=1 深=0 北=0；实测 2026-07-16 本机出口 push2 502，push2delay 200 且 CORS *，双 host 兜底）。
 *    两级行情均失败时逐股回退报表 LATELY_PRICE（足日频率，非实时）。
 * 配色：方向着色令牌化 ips-up=var(--up) / ips-down=var(--down)（A股 涨=up 跌=down，
 * 只换令牌不翻转语义）；破发=现价低于发行价，属下跌用 var(--down) + '破发'徽标；
 * 会话等强调态统一用品牌 --acc 系。
 * Registers as custom tool id 'ipostats' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DC_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const IPO_COLUMNS =
    'SECUCODE,SECURITY_CODE,SECURITY_NAME,LISTING_DATE,ISSUE_PRICE,LD_CLOSE_CHANGE,LATELY_PRICE,MARKET_TYPE_NEW,INDUSTRY_NAME';
  const ipoUrl = (startDate, endDate) =>
    `${DC_BASE}?reportName=RPTA_APP_IPOAPPLY&columns=${IPO_COLUMNS}` +
    `&filter=${encodeURIComponent(`(LISTING_DATE>='${startDate}')(LISTING_DATE<='${endDate}')`)}` +
    '&sortColumns=LISTING_DATE&sortTypes=-1&pageNumber=1&pageSize=200&source=WEB&client=WEB';

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const ulistUrl = (host, secids) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f2&secids=${encodeURIComponent(secids.join(','))}` +
    '&ut=bd1d9ddb04089700cf9c27f6f7426281';

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;
  const JSONP_TIMEOUT_MS = 10000;
  const RANGE_DAYS = 90; // 统计窗口：近 90 天

  // 板块分组（MARKET_TYPE_NEW → 展示名），顺序即展示顺序
  const BOARDS = ['主板', '创业板', '科创板', '北交所'];
  const boardOf = (s) => {
    const v = String(s || '');
    if (v.indexOf('科创') >= 0) return '科创板';
    if (v.indexOf('创业') >= 0) return '创业板';
    if (v.indexOf('北交') >= 0) return '北交所';
    return '主板'; // 上交所其他/深交所其他/空值 → 主板
  };

  // 每签股数：沪深（主板/创业板/科创板）500 股/签，北交所 100 股/签
  const lotOf = (board) => (board === '北交所' ? 100 : 500);

  function injectStyle() {
    if (document.getElementById('ips-style')) return;
    const style = document.createElement('style');
    style.id = 'ips-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.ips-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .ips-root { --up: #C0442F; --down: #2E7D4F; }
.ips-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.ips-head-right { display: flex; align-items: center; gap: 8px; }
.ips-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.ips-session.open { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
.ips-status { color: var(--warning); white-space: nowrap; }
.ips-status.live { color: var(--acc); }
/* 方向着色令牌化：A股 涨=--up 跌=--down，勿改用 --acc/--danger */
.ips-up { color: var(--up); }
.ips-down { color: var(--down); }
.ips-flat { color: var(--text-muted); }
.ips-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 720px) {
  .ips-cards { grid-template-columns: repeat(2, 1fr); }
}
.ips-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.ips-card-label { font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); white-space: nowrap; }
.ips-card-value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ips-card-note {
  font-size: 9px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ips-boards {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.ips-boards-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.ips-boards-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.ips-board-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.ips-board-row:last-child { margin-bottom: 1px; }
.ips-board-name { width: 3.4em; font-size: 10px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
.ips-board-barwrap {
  flex: 1;
  height: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  overflow: hidden;
  min-width: 0;
}
.ips-board-bar { height: 100%; border-radius: 999px; min-width: 2px; transition: width 0.45s var(--ease-fluid); }
.ips-board-stat {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.ips-table-wrap { max-height: 235px; overflow-y: auto; }
.ips-table { font-variant-numeric: tabular-nums; }
.ips-table th, .ips-table td { white-space: nowrap; }
.ips-table tbody tr { cursor: pointer; transition: background 0.18s var(--ease-fluid); }
.ips-table tbody tr:hover { background: var(--surface-raised); }
.ips-name { font-weight: 600; }
.ips-name i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.ips-num { font-family: var(--font-mono); }
.ips-chip {
  display: inline-block;
  font-size: 9px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.ips-badge {
  display: inline-block;
  font-size: 9px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--down);
  color: var(--down);
  background: color-mix(in srgb, var(--down) 12%, transparent);
  margin-left: 5px;
  letter-spacing: 0.05em;
  vertical-align: 1px;
}
.ips-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.ips-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 9px;
  color: var(--text-dim);
  border-top: 1px solid var(--hairline);
  padding-top: 6px;
}
.ips-foot b { font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
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

  // 单签收益（元）→ +X.XX万 / +X,XXX元
  const fmtProfit = (yuan) => {
    if (!Number.isFinite(yuan)) return '—';
    const sign = yuan > 0 ? '+' : yuan < 0 ? '-' : '';
    const abs = Math.abs(yuan);
    if (abs >= 1e4) return `${sign}${fmtNum(abs / 1e4, 2)}万`;
    return `${sign}${fmtNum(abs, 0)}元`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'ips-flat';
    return v > 0 ? 'ips-up' : 'ips-down';
  };

  // 北京时间（UTC+8）的日期串 YYYY-MM-DD；offsetDays 可为负（如 -90）
  const bjDateStr = (offsetDays) => {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000 + offsetDays * 86400000);
    const m = String(bj.getMonth() + 1).padStart(2, '0');
    const d = String(bj.getDate()).padStart(2, '0');
    return `${bj.getFullYear()}-${m}-${d}`;
  };

  // SECUCODE 后缀 → 腾讯/东财行情市场前缀
  const mktOf = (secucode, code) => {
    const suf = String(secucode || '').split('.')[1];
    if (suf) return suf.toLowerCase(); // SH/SZ/BJ → sh/sz/bj
    const c = String(code || '').charAt(0); // 后缀缺失时按代码首字符兜底
    if (c === '6') return 'sh';
    if (c === '4' || c === '8' || c === '9') return 'bj';
    return 'sz';
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

  window.GT_EXTRA_TOOLS['ipostats'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool ips-root">
          <div class="ips-head">
            <span>A股 · 新股表现与破发监测（近${RANGE_DAYS}天）</span>
            <span class="ips-head-right">
              <span class="ips-session" data-session>—</span>
              <span class="ips-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="ips-cards">
            <div class="ips-card">
              <div class="ips-card-label">上市家数</div>
              <div class="ips-card-value" data-c-count>—</div>
              <div class="ips-card-note">近${RANGE_DAYS}天新上市</div>
            </div>
            <div class="ips-card">
              <div class="ips-card-label">首日平均涨幅</div>
              <div class="ips-card-value" data-c-avg>—</div>
              <div class="ips-card-note">上市首日收盘口径</div>
            </div>
            <div class="ips-card">
              <div class="ips-card-label">破发家数 / 破发率</div>
              <div class="ips-card-value" data-c-broken>—</div>
              <div class="ips-card-note">现价低于发行价</div>
            </div>
            <div class="ips-card">
              <div class="ips-card-label">单签最高收益</div>
              <div class="ips-card-value" data-c-profit>—</div>
              <div class="ips-card-note" data-c-profit-name>按现价估算</div>
            </div>
          </div>
          <div class="ips-boards">
            <div class="ips-boards-title"><span>板块分布 · 平均首日涨幅</span><i>条长=家数占比</i></div>
            <div data-boards>
              <div class="ips-empty" style="color:var(--text-dim);font-size:10px;padding:4px 0">加载中…</div>
            </div>
          </div>
          <div class="ips-table-wrap">
            <table class="data-table ips-table">
              <thead>
                <tr><th>名称</th><th>板块</th><th>上市日</th><th>发行价</th><th>首日涨幅</th><th>现价</th><th>较发行价</th></tr>
              </thead>
              <tbody data-body>
                <tr class="ips-empty"><td colspan="7">加载中…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
          <div class="ips-foot">
            <span>来源：东方财富 · 新股申购报表 + 腾讯行情<b data-quote-note></b>（单签：沪深500股/北交所100股，点击行查看详情）</span>
            <span>更新于 <b data-updated>—</b></span>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const boardsEl = el.querySelector('[data-boards]');
      const quoteNoteEl = el.querySelector('[data-quote-note]');
      const updatedEl = el.querySelector('[data-updated]');
      const cardCount = el.querySelector('[data-c-count]');
      const cardAvg = el.querySelector('[data-c-avg]');
      const cardBroken = el.querySelector('[data-c-broken]');
      const cardProfit = el.querySelector('[data-c-profit]');
      const cardProfitName = el.querySelector('[data-c-profit-name]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let hasData = false;
      const pendingScripts = new Set(); // 进行中的 JSONP <script> 节点
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController
      let jsonpCodes = []; // 本轮 JSONP 请求的腾讯代码（用于清理全局变量）

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'ips-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'ips-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'ips-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'ips-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'ips-session';
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

      // 通用 CORS fetch（带 10s 超时）
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

      // 新股清单：东财 datacenter，近 RANGE_DAYS 天已上市，按上市日倒序
      const fetchIpoList = async () => {
        const json = await fetchJson(ipoUrl(bjDateStr(-RANGE_DAYS), bjDateStr(0)));
        const data = json && json.result && Array.isArray(json.result.data) ? json.result.data : [];
        return data
          .map((r) => {
            const code = String(r.SECURITY_CODE || '');
            const board = boardOf(r.MARKET_TYPE_NEW);
            return {
              code,
              mkt: mktOf(r.SECUCODE, code),
              name: String(r.SECURITY_NAME || ''),
              board,
              industry: String(r.INDUSTRY_NAME || ''),
              listDate: r.LISTING_DATE ? String(r.LISTING_DATE).slice(0, 10) : '',
              issue: r.ISSUE_PRICE == null ? NaN : Number(r.ISSUE_PRICE), // null→NaN，避免 Number(null)=0
              firstPct: r.LD_CLOSE_CHANGE == null ? NaN : Number(r.LD_CLOSE_CHANGE),
              lately: r.LATELY_PRICE == null ? NaN : Number(r.LATELY_PRICE), // 报表最近价（现价兜底）
            };
          })
          .filter((r) => r.code && r.name && r.listDate);
      };

      // 腾讯 JSONP 批量现价：一次请求全部代码，响应定义全局 v_<mkt><code>
      const fetchLiveTencent = (rows) =>
        new Promise((resolve, reject) => {
          if (!alive) {
            reject(new Error('disposed'));
            return;
          }
          const codes = rows.map((r) => r.mkt + r.code);
          jsonpCodes = codes;
          const script = document.createElement('script');
          script.charset = 'gb2312';
          script.async = true;
          script.src = `https://qt.gtimg.cn/q=${codes.join(',')}&_t=${Date.now()}`;
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
            const out = {};
            let ok = 0;
            codes.forEach((qc) => {
              const raw = readGlobal('v_' + qc);
              if (typeof raw === 'string' && raw.indexOf('~') > 0) {
                const price = parseFloat(raw.split('~')[3]); // 3=现价
                if (Number.isFinite(price) && price > 0) {
                  out[qc.slice(2)] = price; // 去掉 2 字符市场前缀，以纯代码为键
                  ok += 1;
                }
              }
            });
            if (err && ok === 0) {
              reject(err);
              return;
            }
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

      // 东财 ulist 批量现价（腾讯整体失败时的兜底）：secid 市场位 沪=1 深=0 北=0，双 host
      const fetchLiveUlist = async (rows) => {
        const secids = rows.map((r) => (r.mkt === 'sh' ? '1.' : '0.') + r.code);
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          try {
            const json = await fetchJson(ulistUrl(EM_HOSTS[i], secids));
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            const out = {};
            diff.forEach((d) => {
              const price = Number(d.f2);
              if (d.f12 != null && Number.isFinite(price) && price > 0) out[String(d.f12)] = price;
            });
            if (Object.keys(out).length) return { map: out, delayed: i > 0 };
            lastErr = new Error('empty');
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('ulist error');
      };

      // 现价取值优先级：实时行情 > 报表最近价
      const curPriceOf = (r, live) => {
        const v = live[r.code];
        if (Number.isFinite(v)) return v;
        return r.lately;
      };

      const renderStats = (rows, live) => {
        const withPrice = rows.filter((r) => Number.isFinite(curPriceOf(r, live)) && Number.isFinite(r.issue) && r.issue > 0);
        const firstPcts = rows.map((r) => r.firstPct).filter(Number.isFinite);
        cardCount.textContent = `${rows.length} 家`;
        const avg = firstPcts.length ? firstPcts.reduce((a, b) => a + b, 0) / firstPcts.length : NaN;
        cardAvg.textContent = Number.isFinite(avg) ? `${fmtSigned(avg, 1)}%` : '—';
        cardAvg.className = `ips-card-value ${dirClass(avg)}`;
        const broken = withPrice.filter((r) => curPriceOf(r, live) < r.issue);
        const rate = withPrice.length ? (broken.length / withPrice.length) * 100 : NaN;
        cardBroken.textContent = Number.isFinite(rate) ? `${broken.length} 家 / ${fmtNum(rate, 1)}%` : '—';
        cardBroken.className = `ips-card-value ${broken.length ? 'ips-down' : ''}`;
        // 单签最高收益：(现价-发行价)×每签股数（沪深500股/签，北交所100股/签）
        let best = null;
        withPrice.forEach((r) => {
          const profit = (curPriceOf(r, live) - r.issue) * lotOf(r.board);
          if (!best || profit > best.profit) best = { profit, name: r.name };
        });
        if (best) {
          cardProfit.textContent = fmtProfit(best.profit);
          cardProfit.className = `ips-card-value ${dirClass(best.profit)}`;
          cardProfitName.textContent = `${best.name} · 按现价估算`;
        } else {
          cardProfit.textContent = '—';
          cardProfit.className = 'ips-card-value';
          cardProfitName.textContent = '按现价估算';
        }
      };

      const renderBoards = (rows) => {
        if (!rows.length) {
          boardsEl.innerHTML = `<div style="color:var(--text-dim);font-size:10px;padding:4px 0">暂无数据</div>`;
          return;
        }
        const groups = {};
        BOARDS.forEach((b) => {
          groups[b] = { count: 0, pctSum: 0, pctN: 0 };
        });
        rows.forEach((r) => {
          const g = groups[r.board] || groups['主板'];
          g.count += 1;
          if (Number.isFinite(r.firstPct)) {
            g.pctSum += r.firstPct;
            g.pctN += 1;
          }
        });
        const maxCount = Math.max(1, ...BOARDS.map((b) => groups[b].count));
        boardsEl.innerHTML = BOARDS.map((b) => {
          const g = groups[b];
          const avg = g.pctN ? g.pctSum / g.pctN : NaN;
          const width = Math.round((g.count / maxCount) * 100);
          const color = !g.count ? 'transparent' : dirClass(avg) === 'ips-down' ? 'var(--down)' : 'var(--up)';
          const avgTxt = Number.isFinite(avg) ? `${fmtSigned(avg, 1)}%` : '—';
          return `
          <div class="ips-board-row">
            <span class="ips-board-name">${esc(b)}</span>
            <span class="ips-board-barwrap"><span class="ips-board-bar" style="display:block;width:${width}%;background:${color}"></span></span>
            <span class="ips-board-stat">${g.count}家 · 均 <b class="${dirClass(avg)}" style="font-weight:400">${esc(avgTxt)}</b></span>
          </div>`;
        }).join('');
      };

      const renderTable = (rows, live) => {
        if (!rows.length) {
          body.innerHTML = `<tr class="ips-empty"><td colspan="7">近${RANGE_DAYS}天无新上市记录</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((r) => {
            const cur = curPriceOf(r, live);
            const valid = Number.isFinite(cur) && Number.isFinite(r.issue) && r.issue > 0;
            const vsPct = valid ? (cur / r.issue - 1) * 100 : NaN;
            const isBroken = valid && cur < r.issue; // 破发：现价低于发行价（下跌，ips-down + 徽标）
            const vsCls = dirClass(vsPct);
            const firstCls = dirClass(r.firstPct);
            const url = `https://quote.eastmoney.com/${r.mkt}${esc(r.code)}.html`;
            const title = r.industry ? `${r.name} · ${r.industry}` : r.name;
            return `
            <tr data-url="${url}" title="${esc(title)}">
              <td class="ips-name">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td><span class="ips-chip">${esc(r.board)}</span></td>
              <td class="ips-num">${esc(r.listDate.slice(5))}</td>
              <td class="ips-num">${Number.isFinite(r.issue) ? esc(fmtNum(r.issue, 2)) : '—'}</td>
              <td class="ips-num ${firstCls}">${Number.isFinite(r.firstPct) ? esc(fmtSigned(r.firstPct, 2)) + '%' : '—'}</td>
              <td class="ips-num ${isBroken ? 'ips-down' : ''}">${Number.isFinite(cur) ? esc(fmtNum(cur, 2)) : '—'}</td>
              <td class="ips-num ${vsCls}">${Number.isFinite(vsPct) ? esc(fmtSigned(vsPct, 2)) + '%' : '—'}${isBroken ? '<span class="ips-badge">破发</span>' : ''}</td>
            </tr>`;
          })
          .join('');
      };

      const renderLoadError = () => {
        if (hasData) return; // 已有旧数据时保留，仅头部提示
        body.innerHTML = `<tr class="ips-empty"><td colspan="7">数据加载失败，稍后自动重试…</td></tr>`;
        boardsEl.innerHTML = `<div style="color:var(--text-dim);font-size:10px;padding:4px 0">加载失败</div>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        // 新请求前 abort 上一轮仍在进行的 fetch
        pendingAborts.forEach((c) => {
          try {
            c.abort();
          } catch (e) { /* 忽略 */ }
        });
        try {
          const rows = await fetchIpoList();
          if (!alive) return;
          // 现价：腾讯 JSONP → 东财 ulist → 报表 LATELY_PRICE（逐股兜底）
          let live = {};
          let liveSrc = '';
          try {
            live = await fetchLiveTencent(rows);
            liveSrc = '';
          } catch (e1) {
            if (!alive) return;
            try {
              const res = await fetchLiveUlist(rows);
              live = res.map;
              liveSrc = res.delayed ? '（现价：东财延时行情）' : '（现价：东财行情）';
            } catch (e2) {
              live = {};
              liveSrc = '（现价：东财报表最近价，非实时）';
            }
          }
          if (!alive) return;
          quoteNoteEl.textContent = liveSrc;
          renderStats(rows, live);
          renderBoards(rows);
          renderTable(rows, live);
          hasData = true;
          updatedEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          clearError();
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          renderLoadError();
          showError('数据加载失败，30 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return;
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      const onRowClick = (e) => {
        const tr = e.target && e.target.closest ? e.target.closest('tr[data-url]') : null;
        if (!tr) return;
        const url = tr.getAttribute('data-url');
        if (url) window.open(url, '_blank', 'noopener');
      };

      body.addEventListener('click', onRowClick);

      renderSession();
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
        pendingScripts.forEach((s) => {
          s.onload = null;
          s.onerror = null;
          if (s.parentNode) s.parentNode.removeChild(s);
        });
        pendingScripts.clear();
        jsonpCodes.forEach((qc) => readGlobal('v_' + qc));
        jsonpCodes = [];
        body.removeEventListener('click', onRowClick);
      };
    },
  };
})();
