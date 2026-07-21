/* A股市场情绪（赚钱效应）— 腾讯指数行情(JSONP/GBK) + 东财涨跌停池(CORS JSON)
 * 成交额: https://qt.gtimg.cn/q=sh000001,sz399001 （注入 <script charset="gb2312">，响应定义全局 v_<code>）
 *   字段下标同 ashareboard.js：1=名称 3=现价 31=涨跌额 37=成交额(万元)，两市成交额=上证+深证合计
 * 涨跌停: https://push2ex.eastmoney.com/getTopicZTPool|getTopicZBPool|getTopicDTPool
 *   响应头 Access-Control-Allow-Origin: *（已 curl 实测 2026-07-16），pagesize=500 时 len(pool)==tc
 *   ZT池字段: c代码 n名称 zdp涨跌幅% lbc连板数；pool 数组长度=家数；日期回退逻辑同 asharelimit.js
 * 注意：A股红涨绿跌，方向/情绪着色用语义令牌 --up(红=涨/热)/--down(绿=跌/冷)，与 crypto 组件的 --acc/--danger 解耦。
 * Registers as custom tool id 'asharemood' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const INDICES = [
    { code: 'sh000001', name: '上证指数' },
    { code: 'sz399001', name: '深证成指' },
  ];
  const QT_URL = 'https://qt.gtimg.cn/q=' + INDICES.map((i) => i.code).join(',');
  const F_AMT = 37; // 成交额（万元）

  const UT = '7eea3edcaed734bea9cbfc24409ed989';
  const POOL_URL = (path, sort, date) =>
    `https://push2ex.eastmoney.com/${path}?ut=${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=${encodeURIComponent(sort)}&date=${date}`;
  const POOL_API = {
    zt: (d) => POOL_URL('getTopicZTPool', 'fbt:asc', d), // 涨停池（条目含 lbc 连板数）
    zb: (d) => POOL_URL('getTopicZBPool', 'fbt:asc', d), // 炸板池
    dt: (d) => POOL_URL('getTopicDTPool', 'fund:desc', d), // 跌停池（sort=fbt 返回空，须用 fund）
  };

  const REFRESH_MS = 60000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市低频刷新（兼顾开/收盘切换与非交易日）
  const JSONP_TIMEOUT_MS = 10000;
  const FETCH_TIMEOUT_MS = 12000; // push2ex 偶发挂起，必须带超时
  const MAX_BACKTRACK_DAYS = 5; // 日期最多往前回退 5 天

  function injectStyle() {
    if (document.getElementById('amood-style')) return;
    const style = document.createElement('style');
    style.id = 'amood-style';
    /* A股红涨绿跌：amood-up(红)/amood-down(绿) 映射语义令牌 --up/--down，勿改用 --acc/--danger */
    style.textContent = `
/* A股红涨绿跌：在本组件作用域将 --up 覆盖为红、--down 覆盖为绿，勿改用 --acc/--danger */
.amood-root { --up: #D05B4B; --down: #4C9F70; }
body.light-mode .amood-root { --up: #C0442F; --down: #2E7D4F; }
.amood-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.amood-head-right { display: flex; align-items: center; gap: 8px; }
.amood-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.amood-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.amood-status { color: var(--warning); white-space: nowrap; }
.amood-status.live { color: var(--acc); }
.amood-up { color: var(--up); }
.amood-down { color: var(--down); }
.amood-zb { color: var(--warning); }
.amood-subbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.amood-subbar b { font-weight: 600; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.amood-score {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--surface-raised);
}
.amood-score-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.amood-score-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.amood-score-num {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 6px;
}
.amood-score-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 10px;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.amood-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  overflow: hidden;
}
.amood-bar-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  transition: width 0.4s var(--ease-fluid);
}
.amood-bar-scale {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 4px;
}
.amood-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
@media (max-width: 720px) {
  .amood-grid { grid-template-columns: repeat(2, 1fr); }
}
.amood-stat {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.amood-stat-label { font-size: 9px; letter-spacing: 0.1em; color: var(--text-muted); white-space: nowrap; }
.amood-stat-value {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.amood-stat-value i { font-style: normal; font-size: 10px; font-weight: 400; color: var(--text-dim); margin-left: 4px; }
.amood-sum {
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
.amood-sum-label { font-size: 10px; letter-spacing: 0.1em; color: var(--text-muted); }
.amood-sum-value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.amood-sum-note { font-size: 9px; color: var(--text-dim); width: 100%; }
.amood-lb {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  margin-bottom: 8px;
}
.amood-lb-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.amood-lb-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.amood-table { font-variant-numeric: tabular-nums; }
.amood-table th, .amood-table td { white-space: nowrap; }
.amood-table tbody tr { cursor: pointer; }
.amood-num { font-family: var(--font-mono); }
.amood-stock { font-weight: 600; }
.amood-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.amood-badge {
  display: inline-block;
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--up);
  color: var(--up);
  background: color-mix(in srgb, var(--up) 10%, transparent);
}
.amood-badge.hot { background: var(--up); color: var(--bg); font-weight: 700; }
.amood-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.amood-foot {
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

  // ---------- 北京时间工具（中国无夏令时，固定 UTC+8；UTC 日期法与 asharelimit.js 一致） ----------
  const bjNow = () => new Date(Date.now() + 8 * 3600 * 1000);
  const pad2 = (n) => String(n).padStart(2, '0');
  const bjDateStr = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  const bjTodayStr = () => bjDateStr(bjNow());
  const backtrack = (dateStr, days) => {
    const t = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8)));
    t.setUTCDate(t.getUTCDate() - days);
    return bjDateStr(t);
  };
  const cnDate = (dateStr) => `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

  // 北京时间交易时段：周一至五 09:15-11:30 / 13:00-15:00（仅按星期粗判，不含法定节假日）
  const sessionState = () => {
    const b = bjNow();
    const day = b.getUTCDay();
    const mins = b.getUTCHours() * 60 + b.getUTCMinutes();
    if (day === 0 || day === 6) return 'closed';
    if ((mins >= 555 && mins < 690) || (mins >= 780 && mins <= 900)) return 'trading';
    if (mins >= 690 && mins < 780) return 'lunch';
    return 'closed';
  };

  // 成交额（万元）→ 亿元
  const fmtAmtYi = (wan) => {
    if (!Number.isFinite(wan)) return '—';
    return `${(wan / 1e4).toLocaleString('en-US', { maximumFractionDigits: 0 })}亿`;
  };

  /* 情绪指数（0-100）：
   *   基础分 = 涨停/(涨停+跌停) × 100（两市无涨跌停时取 50）
   *   炸板修正 = (0.25 - 炸板率) × 40（炸板率 25% 视为中性）
   *   高度修正 = (min(最高连板,8)/8 - 0.5) × 10
   * 分档：≥75 亢奋 / ≥60 偏热 / ≥40 中性 / ≥25 偏冷 / <25 冰点 */
  const moodScore = (zt, dt, zb, maxLb) => {
    const total = zt + dt;
    const base = total > 0 ? (zt / total) * 100 : 50;
    const zbRate = zt + zb > 0 ? zb / (zt + zb) : 0;
    const raw = base + (0.25 - zbRate) * 40 + (Math.min(maxLb, 8) / 8 - 0.5) * 10;
    return Math.round(Math.max(0, Math.min(100, raw)));
  };
  const MOOD_BANDS = [
    { min: 75, tag: '亢奋', color: 'var(--up)' },
    { min: 60, tag: '偏热', color: 'var(--warning)' },
    { min: 40, tag: '中性', color: 'var(--text-muted)' },
    { min: 25, tag: '偏冷', color: 'color-mix(in srgb, var(--down) 70%, var(--text-muted))' },
    { min: 0, tag: '冰点', color: 'var(--down)' },
  ];
  const bandOf = (score) => MOOD_BANDS.find((b) => score >= b.min) || MOOD_BANDS[MOOD_BANDS.length - 1];

  // 代码首字符定市场：6→sh，4/8→bj，其余→sz
  const mktOf = (code) => (code[0] === '6' ? 'sh' : code[0] === '4' || code[0] === '8' ? 'bj' : 'sz');

  window.GT_EXTRA_TOOLS['asharemood'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool amood-root">
          <div class="amood-head">
            <span>A股 · 市场情绪（赚钱效应）</span>
            <span class="amood-head-right">
              <span class="amood-session" data-session>—</span>
              <span class="amood-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="amood-subbar">
            <span data-date>数据日期: —</span>
            <span>涨跌停比 <b class="amood-up" data-r-zt>—</b> : <b class="amood-down" data-r-dt>—</b></span>
          </div>
          <div class="amood-score">
            <div class="amood-score-top">
              <span class="amood-score-label">情绪指数<span class="amood-score-num" data-score>—</span></span>
              <span class="amood-score-tag" data-tag>—</span>
            </div>
            <div class="amood-bar"><div class="amood-bar-fill" data-fill></div></div>
            <div class="amood-bar-scale"><span>0 冰点</span><span>50</span><span>100 亢奋</span></div>
          </div>
          <div class="amood-grid">
            <div class="amood-stat"><span class="amood-stat-label">涨停</span><span class="amood-stat-value amood-up" data-s-zt>—</span></div>
            <div class="amood-stat"><span class="amood-stat-label">跌停</span><span class="amood-stat-value amood-down" data-s-dt>—</span></div>
            <div class="amood-stat"><span class="amood-stat-label">炸板 / 炸板率</span><span class="amood-stat-value amood-zb" data-s-zb>—</span></div>
            <div class="amood-stat"><span class="amood-stat-label">最高连板</span><span class="amood-stat-value amood-up" data-s-lb>—</span></div>
          </div>
          <div class="amood-sum">
            <span class="amood-sum-label">沪深两市成交额</span>
            <span class="amood-sum-value" data-amt>—</span>
            <span class="amood-sum-note">上证指数 + 深证成指成交额合计口径（腾讯行情，单位换算为亿元）</span>
          </div>
          <div class="amood-lb">
            <div class="amood-lb-title"><span>连板高度 TOP 5</span><i>点击行查看个股详情</i></div>
            <table class="data-table amood-table">
              <thead><tr><th>名称</th><th>连板</th><th>涨跌幅%</th></tr></thead>
              <tbody data-lb-body><tr class="amood-empty"><td colspan="3">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="amood-foot">
            <span>来源：腾讯行情 · 东方财富</span>
            <span data-updated>更新于 —</span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const dateEl = el.querySelector('[data-date]');
      const rZtEl = el.querySelector('[data-r-zt]');
      const rDtEl = el.querySelector('[data-r-dt]');
      const scoreEl = el.querySelector('[data-score]');
      const tagEl = el.querySelector('[data-tag]');
      const fillEl = el.querySelector('[data-fill]');
      const amtEl = el.querySelector('[data-amt]');
      const lbBody = el.querySelector('[data-lb-body]');
      const updatedEl = el.querySelector('[data-updated]');
      const statEls = {
        zt: el.querySelector('[data-s-zt]'),
        dt: el.querySelector('[data-s-dt]'),
        zb: el.querySelector('[data-s-zb]'),
        lb: el.querySelector('[data-s-lb]'),
      };

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingScripts = new Set(); // 进行中的 JSONP <script> 节点
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const setLive = () => {
        conn.textContent = '● LIVE';
        conn.className = 'amood-status live';
        setStatus('online');
      };
      const setFail = (msg) => {
        conn.textContent = '连接失败';
        conn.className = 'amood-status';
        hint.textContent = msg;
        hint.style.display = '';
        setStatus('offline');
      };
      const showHint = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
      };
      const clearHint = () => {
        hint.style.display = 'none';
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'amood-session open';
        } else if (s === 'lunch') {
          sessionEl.textContent = '午间休市';
          sessionEl.className = 'amood-session';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'amood-session';
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

      const renderTurnover = (data) => {
        const sh = data.sh000001 ? parseFloat(data.sh000001[F_AMT]) : NaN;
        const sz = data.sz399001 ? parseFloat(data.sz399001[F_AMT]) : NaN;
        amtEl.textContent = Number.isFinite(sh) && Number.isFinite(sz) ? fmtAmtYi(sh + sz) : '—';
      };

      // 东财 CORS fetch（带超时；新请求由 refreshInFlight 保证不与旧请求并发）
      const fetchJson = (url) => {
        const ctl = new AbortController();
        pendingAborts.add(ctl);
        const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        return fetch(url, { signal: ctl.signal, cache: 'no-store' })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .finally(() => {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctl);
          });
      };

      const poolOf = (j) => (j && j.data && Array.isArray(j.data.pool) ? j.data.pool : []);

      // 日期回退：从北京时间今天往前最多 5 天，取最近有涨停数据的交易日；
      // 炸板/跌停池任一失败则整体视为失败（避免缺失计数扭曲情绪分），下轮自动重试
      const loadPools = async () => {
        const today = bjTodayStr();
        let date = today;
        let zt = [];
        for (let i = 0; i <= MAX_BACKTRACK_DAYS; i++) {
          const d = backtrack(today, i);
          const pool = poolOf(await fetchJson(POOL_API.zt(d)));
          if (pool.length > 0 || i === MAX_BACKTRACK_DAYS) {
            date = d;
            zt = pool;
            break;
          }
        }
        const [zb, dt] = await Promise.all([fetchJson(POOL_API.zb(date)), fetchJson(POOL_API.dt(date))]);
        return { date, zt, zb: poolOf(zb), dt: poolOf(dt) };
      };

      const renderPools = (res) => {
        const ztN = res.zt.length;
        const zbN = res.zb.length;
        const dtN = res.dt.length;
        const maxLb = res.zt.reduce((m, it) => Math.max(m, Number(it.lbc) || 0), 0);
        const zbRate = ztN + zbN > 0 ? (zbN / (ztN + zbN)) * 100 : NaN;

        statEls.zt.textContent = `${ztN} 家`;
        statEls.dt.textContent = `${dtN} 家`;
        statEls.zb.innerHTML = `${zbN} 家<i>${Number.isFinite(zbRate) ? `率 ${zbRate.toFixed(1)}%` : '率 —'}</i>`;
        statEls.lb.textContent = maxLb > 0 ? `${maxLb} 板` : '—';
        rZtEl.textContent = String(ztN);
        rDtEl.textContent = String(dtN);

        const score = moodScore(ztN, dtN, zbN, maxLb);
        const band = bandOf(score);
        scoreEl.textContent = String(score);
        scoreEl.style.color = band.color;
        tagEl.textContent = band.tag;
        tagEl.style.color = band.color;
        fillEl.style.width = `${score}%`;
        fillEl.style.background = band.color;

        const stale = res.date !== bjTodayStr();
        dateEl.textContent = `数据日期: ${cnDate(res.date)}${stale ? '（最近交易日）' : ''}`;

        const top = res.zt
          .slice()
          .sort((a, b) => (Number(b.lbc) || 0) - (Number(a.lbc) || 0))
          .slice(0, 5);
        if (!top.length) {
          lbBody.innerHTML = `<tr class="amood-empty"><td colspan="3">该交易日无涨停数据</td></tr>`;
        } else {
          lbBody.innerHTML = top
            .map((it) => {
              const lbc = Number(it.lbc) || 0;
              const zdp = Number(it.zdp);
              return `
            <tr data-code="${esc(it.c)}">
              <td class="amood-stock">${esc(it.n)}<i>${esc(it.c)}</i></td>
              <td class="amood-num"><span class="amood-badge${lbc >= 3 ? ' hot' : ''}">${esc(lbc)}板</span></td>
              <td class="amood-num amood-up">${Number.isFinite(zdp) ? `+${esc(zdp.toFixed(2))}` : '—'}</td>
            </tr>`;
            })
            .join('');
        }
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [idxRes, poolRes] = await Promise.allSettled([fetchIndices(), loadPools()]);
          if (!alive) return;
          const idxOk = idxRes.status === 'fulfilled';
          const poolOk = poolRes.status === 'fulfilled';
          if (idxOk) renderTurnover(idxRes.value);
          if (poolOk) renderPools(poolRes.value);
          if (idxOk || poolOk) {
            setLive();
            const d = new Date();
            updatedEl.textContent = `更新于 ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
            if (!idxOk) showHint('成交额数据加载失败，下轮自动重试…');
            else if (!poolOk) showHint('涨跌停数据加载失败，下轮自动重试…');
            else clearHint();
          } else {
            setFail('数据加载失败，稍后自动重试…');
          }
        } finally {
          refreshInFlight = false;
        }
      };

      const onRowClick = (ev) => {
        const tr = ev.target.closest('tr[data-code]');
        if (!tr) return;
        const code = tr.dataset.code;
        if (!/^\d{6}$/.test(code)) return;
        window.open(`https://quote.eastmoney.com/${mktOf(code)}${code}.html`, '_blank', 'noopener');
      };
      lbBody.addEventListener('click', onRowClick);

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
        lbBody.removeEventListener('click', onRowClick);
      };
    },
  };
})();
