/* A股期指与ETF — 东财股指期货(CORS JSON) + 腾讯现货指数/ETF行情(JSONP/GBK)
 * 期货: https://push2.eastmoney.com/api/qt/clist/get?fs=m:220 （中金所全部期货，含 IF/IH/IC/IM 与国债期货；
 *   响应头 Access-Control-Allow-Origin: *，失败时回退 push2delay 延时行情，照抄 ashareboard.js 双 host 模式）
 *   主力合约 = 同一品种全部挂牌合约中成交量(f5)最大者（东财无主连标记，客户端自算）。
 *   字段: f2=最新价 f3=涨跌% f4=涨跌额 f5=成交量(手) f12=代码 f14=名称
 * 现货/ETF: https://qt.gtimg.cn/q=... （注入 <script charset="gb2312">，响应定义全局 v_<code>）
 *   字段下标（v_<code> 值按 ~ 切分，0 基，同 ashareboard.js）：1=名称 3=现价 4=昨收 31=涨跌额 32=涨跌% 37=成交额(万元)
 * 接口实测结论（2026-07-16，curl 验证）：
 *   - 腾讯期货代码不可用：wh_/ff_/nf_ 前缀 + IF2508/IF2509/IF2603/IFL0 等全部返回 v_pv_none_match="1"，放弃。
 *   - 新浪 hq.sinajs.cn/list=nf_IF2608 有数据，但响应无 Access-Control-Allow-Origin 且强制校验 Referer，
 *     浏览器跨域不可用，放弃。
 *   - 东财 m:221 仅含中金所期权（MO/IO/HO）；股指期货在 fs=m:220（与国债期货混合，按代码正则过滤）。
 *     push2delay 实测 16 个股指合约齐全（IF/IH/IC/IM 各 4 个），fltt=2 时 f2/f3 为正确浮点值。
 *   - push2 与 push2delay 均带 Access-Control-Allow-Origin: *（实测当日 push2 一度 502，双 host 兜底必要）。
 * 注意：A股红涨绿跌，方向着色用语义令牌 var(--up)=红涨 / var(--down)=绿跌，不使用 --acc/--danger。
 * Registers as custom tool id 'asharefut' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 品种 → 现货指数（腾讯代码）；名称以接口返回为准，此处仅作占位
  const VARIETIES = [
    { prefix: 'IF', name: '沪深300', spot: 'sh000300' },
    { prefix: 'IH', name: '上证50', spot: 'sh000016' },
    { prefix: 'IC', name: '中证500', spot: 'sh000905' },
    { prefix: 'IM', name: '中证1000', spot: 'sh000852' },
  ];

  // ETF 榜单（腾讯代码）：宽基 + 行业
  const ETFS = [
    { code: 'sh510300', tag: '宽基' },
    { code: 'sh510500', tag: '宽基' },
    { code: 'sh510050', tag: '宽基' },
    { code: 'sz159915', tag: '宽基' },
    { code: 'sh588000', tag: '宽基' },
    { code: 'sz159949', tag: '宽基' },
    { code: 'sh512880', tag: '证券' },
    { code: 'sh512800', tag: '银行' },
    { code: 'sh512010', tag: '医药' },
    { code: 'sh512760', tag: '芯片' },
    { code: 'sh515030', tag: '新能车' },
    { code: 'sh512660', tag: '军工' },
  ];

  const QT_CODES = VARIETIES.map((v) => v.spot).concat(ETFS.map((e) => e.code));
  const QT_URL = 'https://qt.gtimg.cn/q=' + QT_CODES.join(',');
  // 腾讯字段下标（0 基）
  const F_NAME = 1;
  const F_PRICE = 3;
  const F_CHG = 31;
  const F_PCT = 32;
  const F_AMT = 37; // 万元

  const EM_FS = 'm:220'; // 中金所期货（股指+国债混合，客户端按代码过滤）
  const EM_FIELDS = 'f12,f14,f2,f3,f4,f5';
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const emUrl = (host) =>
    `${host}/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${EM_FS}&fields=${EM_FIELDS}`;
  const FUT_RE = /^(IF|IH|IC|IM)\d{4}$/;

  const REFRESH_MS = 30000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新
  const JSONP_TIMEOUT_MS = 10000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('afut-style')) return;
    const style = document.createElement('style');
    style.id = 'afut-style';
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.afut-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .afut-root { --up: #C0442F; --down: #2E7D4F; }
.afut-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.afut-head-right { display: flex; align-items: center; gap: 8px; }
.afut-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.afut-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.afut-status { color: var(--warning); white-space: nowrap; }
.afut-status.live { color: var(--acc); }
/* A股红涨绿跌：var(--up)=红涨 / var(--down)=绿跌，勿改用 --acc/--danger */
.afut-up { color: var(--up); }
.afut-down { color: var(--down); }
.afut-flat { color: var(--text-muted); }
.afut-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
.afut-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.afut-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.afut-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.afut-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.afut-price {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.afut-chg {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.afut-basis {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  gap: 2px 8px;
  flex-wrap: wrap;
}
.afut-basis b {
  font-weight: 400;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.afut-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
}
.afut-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.afut-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.afut-table { font-variant-numeric: tabular-nums; }
.afut-table th, .afut-table td { white-space: nowrap; }
.afut-num { font-family: var(--font-mono); }
.afut-etf { font-weight: 600; }
.afut-etf i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.afut-tag { color: var(--text-dim); font-size: 9px; }
.afut-empty td {
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
    if (!Number.isFinite(v) || v === 0) return 'afut-flat';
    return v > 0 ? 'afut-up' : 'afut-down';
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

  window.GT_EXTRA_TOOLS['asharefut'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool afut-root">
          <div class="afut-head">
            <span>A股 · 期指与ETF</span>
            <span class="afut-head-right">
              <span class="afut-session" data-session>—</span>
              <span class="afut-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="afut-grid">
            ${VARIETIES.map(
              (v) => `
              <div class="afut-card" data-prefix="${esc(v.prefix)}">
                <div class="afut-card-top">
                  <span class="afut-name">${esc(v.name)}期指</span>
                  <span class="afut-code" data-code>—</span>
                </div>
                <div class="afut-price afut-flat" data-price>—</div>
                <div class="afut-chg afut-flat" data-pct>—</div>
                <div class="afut-basis"><span>基差 <b data-basis class="afut-flat">—</b></span><span>现货 <b data-spot>—</b></span></div>
              </div>`
            ).join('')}
          </div>
          <div class="afut-board">
            <div class="afut-board-title"><span>ETF 行情榜</span><i data-etf-note></i></div>
            <table class="data-table afut-table">
              <thead><tr><th>名称</th><th>类型</th><th>现价</th><th>涨跌幅</th><th>成交额</th></tr></thead>
              <tbody data-etf-body></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const etfBody = el.querySelector('[data-etf-body]');
      const etfNote = el.querySelector('[data-etf-note]');
      const cards = {};
      el.querySelectorAll('.afut-card').forEach((card) => {
        cards[card.getAttribute('data-prefix')] = {
          code: card.querySelector('[data-code]'),
          price: card.querySelector('[data-price]'),
          pct: card.querySelector('[data-pct]'),
          basis: card.querySelector('[data-basis]'),
          spot: card.querySelector('[data-spot]'),
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
        conn.className = 'afut-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'afut-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'afut-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'afut-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'afut-session';
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
        QT_CODES.forEach((code) => readGlobal('v_' + code));
      };

      // 腾讯 JSONP：现货指数 + ETF 合并一次请求，注入 <script charset="gb2312">
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
            const out = {};
            let ok = 0;
            QT_CODES.forEach((code) => {
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

      // 东财期货 clist：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchFutures = async () => {
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
            const rows = diff.filter((r) => FUT_RE.test(String(r.f12 || '')));
            if (!rows.length) throw new Error('empty');
            return { rows, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('futures error');
      };

      // 每个品种取成交量最大者为主力合约
      const pickMain = (rows) => {
        const main = {};
        rows.forEach((r) => {
          const code = String(r.f12);
          const prefix = code.slice(0, 2);
          const vol = Number(r.f5);
          if (!main[prefix] || (Number.isFinite(vol) && vol > Number(main[prefix].f5))) main[prefix] = r;
        });
        return main;
      };

      const render = (futRes, qtData) => {
        const main = futRes ? pickMain(futRes.rows) : {};
        VARIETIES.forEach((v) => {
          const c = cards[v.prefix];
          if (!c) return;
          const f = main[v.prefix];
          const spotF = qtData ? qtData[v.spot] : null;
          const spotPrice = spotF ? parseFloat(spotF[F_PRICE]) : NaN;
          if (f) {
            const price = Number(f.f2);
            const pct = Number(f.f3);
            c.code.textContent = `${String(f.f12)} 主力${futRes.delayed ? '·延时' : ''}`;
            c.price.textContent = fmtNum(price, 1);
            c.price.className = `afut-price ${dirClass(pct)}`;
            c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
            c.pct.className = `afut-chg ${dirClass(pct)}`;
            if (Number.isFinite(price) && Number.isFinite(spotPrice)) {
              const basis = price - spotPrice;
              const basisPct = spotPrice !== 0 ? (basis / spotPrice) * 100 : NaN;
              c.basis.textContent = `${fmtSigned(basis, 1)} (${fmtSigned(basisPct, 2)}%)`;
              c.basis.className = dirClass(basis);
            } else {
              c.basis.textContent = '—';
              c.basis.className = 'afut-flat';
            }
          } else {
            c.code.textContent = '—';
            c.price.textContent = '—';
            c.price.className = 'afut-price afut-flat';
            c.pct.textContent = '—';
            c.pct.className = 'afut-chg afut-flat';
            c.basis.textContent = '—';
            c.basis.className = 'afut-flat';
          }
          c.spot.textContent = Number.isFinite(spotPrice) ? fmtNum(spotPrice, 2) : '—';
        });
      };

      const renderEtf = (qtData) => {
        const rows = ETFS.map((e) => {
          const f = qtData[e.code];
          if (!f) return null;
          return {
            name: String(f[F_NAME] || ''),
            code: e.code,
            tag: e.tag,
            price: parseFloat(f[F_PRICE]),
            pct: parseFloat(f[F_PCT]),
            amt: parseFloat(f[F_AMT]), // 万元
          };
        }).filter((r) => r && Number.isFinite(r.pct));
        etfNote.textContent = '';
        if (!rows.length) {
          etfBody.innerHTML = `<tr class="afut-empty"><td colspan="5">暂无数据</td></tr>`;
          return;
        }
        etfBody.innerHTML = rows
          .map(
            (r) => `
            <tr>
              <td class="afut-etf">${esc(r.name)}<i>${esc(r.code.replace(/^(sh|sz)/, ''))}</i></td>
              <td class="afut-tag">${esc(r.tag)}</td>
              <td class="afut-num">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 3)) : '—'}</td>
              <td class="afut-num ${dirClass(r.pct)}">${esc(fmtSigned(r.pct, 2))}%</td>
              <td class="afut-num">${esc(fmtAmt(r.amt))}</td>
            </tr>`
          )
          .join('');
      };

      const renderEtfError = () => {
        etfNote.textContent = '';
        etfBody.innerHTML = `<tr class="afut-empty"><td colspan="5">ETF 行情加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [futRes, qtRes] = await Promise.allSettled([fetchFutures(), fetchTencent()]);
          if (!alive) return;
          const qtData = qtRes.status === 'fulfilled' ? qtRes.value : null;
          if (futRes.status === 'fulfilled' || qtData) {
            render(futRes.status === 'fulfilled' ? futRes.value : null, qtData);
            clearError();
            if (futRes.status !== 'fulfilled') {
              hint.textContent = '期货行情加载失败，仅显示现货/ETF，30 秒后自动重试…';
              hint.style.display = '';
            }
          } else {
            showError('行情加载失败，30 秒后自动重试…');
          }
          if (qtData) renderEtf(qtData);
          else renderEtfError();
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (document.hidden) return; // 页面不可见时跳过刷新
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
