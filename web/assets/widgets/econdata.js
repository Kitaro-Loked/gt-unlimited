/* 经济数据日历 — 中美欧重要经济数据：最新值/前值/数据期/下次发布
 * 接口（均已 curl 实测 2026-07-16，带 Origin: https://trading.2009731.xyz 时响应
 * Access-Control-Allow-Origin: *，浏览器跨域 fetch 可用）：
 * ① 中国：datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_*
 *    RPT_ECONOMY_CPI            字段: TIME=数据期 NATIONAL_SAME=全国CPI同比%
 *    RPT_ECONOMY_PPI            字段: TIME BASE_SAME=PPI同比%
 *    RPT_ECONOMY_PMI            字段: TIME MAKE_INDEX=制造业PMI NMAKE_INDEX=非制造业PMI
 *    RPT_ECONOMY_GDP            字段: TIME SUM_SAME=GDP同比%（季度，累计口径）
 *    RPT_ECONOMY_RMB_LOAN       字段: TIME RMB_LOAN=新增人民币贷款(亿元，当月值)
 *    RPT_ECONOMY_CURRENCY_SUPPLY 字段: TIME BASIC_CURRENCY_SAME=M2同比%
 *    以上中国报表均无「下次发布日期/市场预期值」字段，下次发布列为按官方惯例的预估日程（静态文本）。
 * ② 美国：同站 reportName=RPT_ECONOMICVALUE_USANEW（东财全球经济指标库，实测存在）
 *    通用字段: INDICATOR_ID/INDICATOR_NAME/REPORT_DATE_CH=数据期/PUBLISH_DATE=公布日期/VALUE=值/PREV_VALUE=前值。
 *    最新一行 VALUE=null 表示尚未公布，其 PUBLISH_DATE 即下次发布日期；取首个 VALUE 非空行为最新值。
 *    指标 ID: EMG00000733=CPI同比 EMG00000746=核心CPI同比 EMG00152118=非农新增(千人)
 *             EMG00001039=失业率 EMG00342250=联邦基金利率目标上限 EMG00159633=GDP环比(季调,2017价)
 * ③ 欧元区：同站 reportName=RPT_ECONOMICVALUE_EURONEW（结构同②）
 *    指标 ID: EMG00008252=核心HICP(核心CPI)环比 EMG00342251=欧洲央行决议 EMG00007355=GDP当季同比
 * 实测剔除项（2026-07-16，接口返回"报表配置不存在"或指标库中不存在）：
 *    RPT_ECONOMY_SHRZGM（社融）不存在 → 中国信用数据以「新增人民币贷款 + M2同比」替代；
 *    RPT_ECONOMY_USA_CPI / RPT_ECONOMY_USA_NONFARM / RPT_ECONOMY_USA_INTEREST_RATE 均不存在；
 *    美国经济指标库中无 PCE 指标 → 以核心CPI同比替代；
 *    欧元区指标库中无总体HICP → 以核心HICP(剔除能源食品烟酒)环比替代；
 *    全部接口均无「市场预期值」字段，故本组件不含预期列。
 * 配色：中性。较前值变化用 ▲▼ 弱提示（--text-dim），不做红绿方向判断；7 日内临发布用 --warning 高亮。
 * 刷新：数据每日更新一次，组件 5 分钟降频轮询，document.hidden 时跳过。
 * Registers as custom tool id 'econdata' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const REFRESH_MS = 5 * 60 * 1000; // 数据每日更新，5 分钟降频轮询
  const FETCH_TIMEOUT_MS = 10000;

  // 中国指标：report=东财报表名 field=取值字段 unit=单位类型 next=预估发布日程（静态）
  const CN_ITEMS = [
    { report: 'RPT_ECONOMY_CPI', field: 'NATIONAL_SAME', name: 'CPI 同比', unit: '%', next: '每月9日前后' },
    { report: 'RPT_ECONOMY_PPI', field: 'BASE_SAME', name: 'PPI 同比', unit: '%', next: '每月9日前后' },
    { report: 'RPT_ECONOMY_PMI', field: 'MAKE_INDEX', name: '制造业 PMI', unit: '', next: '每月最后一日' },
    { report: 'RPT_ECONOMY_PMI', field: 'NMAKE_INDEX', name: '非制造业 PMI', unit: '', next: '每月最后一日' },
    { report: 'RPT_ECONOMY_GDP', field: 'SUM_SAME', name: 'GDP 同比', unit: '%', next: '季后15日前后' },
    { report: 'RPT_ECONOMY_CURRENCY_SUPPLY', field: 'BASIC_CURRENCY_SAME', name: 'M2 同比', unit: '%', next: '每月10-15日' },
    { report: 'RPT_ECONOMY_RMB_LOAN', field: 'RMB_LOAN', name: '新增人民币贷款', unit: 'loan', next: '每月10-15日' },
  ];

  // 美国指标（RPT_ECONOMICVALUE_USANEW）
  const US_ITEMS = [
    { id: 'EMG00000733', name: 'CPI 同比', unit: '%' },
    { id: 'EMG00000746', name: '核心 CPI 同比', unit: '%' },
    { id: 'EMG00152118', name: '非农就业新增', unit: 'nfp' },
    { id: 'EMG00001039', name: '失业率', unit: '%' },
    { id: 'EMG00342250', name: '联邦基金利率上限', unit: '%' },
    { id: 'EMG00159633', name: 'GDP 环比(季调)', unit: '%' },
  ];

  // 欧元区指标（RPT_ECONOMICVALUE_EURONEW）
  const EU_ITEMS = [
    { id: 'EMG00008252', name: '核心 CPI(HICP) 环比', unit: '%' },
    { id: 'EMG00342251', name: '欧央行利率决议', unit: '%' },
    { id: 'EMG00007355', name: 'GDP 同比', unit: '%' },
  ];

  const EMG_COLS = 'INDICATOR_ID,INDICATOR_NAME,REPORT_DATE_CH,PUBLISH_DATE,VALUE,PRE_VALUE';

  const cnUrl = (report) =>
    `${DC}?reportName=${report}&columns=ALL&pageNumber=1&pageSize=2&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;
  const emgUrl = (report) =>
    `${DC}?reportName=${report}&columns=${EMG_COLS}&pageNumber=1&pageSize=500&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;

  function injectStyle() {
    if (document.getElementById('econdata-style')) return;
    const style = document.createElement('style');
    style.id = 'econdata-style';
    style.textContent = `
.econ-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.econ-head-right { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.econ-updated { color: var(--text-dim); letter-spacing: 0.04em; }
.econ-status { color: var(--warning); white-space: nowrap; }
.econ-status.live { color: var(--acc); }
.econ-sec {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin: 8px 0 4px;
}
.econ-sec:first-of-type { margin-top: 0; }
.econ-sec i { font-style: normal; color: var(--text-dim); letter-spacing: 0.04em; }
.econ-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.econ-table th {
  font-size: 9px;
  font-weight: 500;
  color: var(--text-dim);
  text-align: right;
  padding: 2px 4px;
  border-bottom: 1px solid var(--hairline-strong);
  white-space: nowrap;
}
.econ-table th:first-child, .econ-table td:first-child { text-align: left; }
.econ-table td {
  padding: 3px 4px;
  border-bottom: 1px solid var(--hairline);
  text-align: right;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.econ-table tr:last-child td { border-bottom: none; }
.econ-name { font-family: var(--font-sans); color: var(--text); }
.econ-val { color: var(--text); }
.econ-dim { color: var(--text-muted); }
.econ-delta { font-style: normal; color: var(--text-dim); margin-left: 3px; font-size: 8px; }
.econ-soon { color: var(--warning); }
.econ-empty td { text-align: center; color: var(--text-dim); padding: 8px 4px; }
.econ-foot {
  margin-top: 8px;
  font-size: 9px;
  line-height: 1.5;
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

  const dateOnly = (s) => String(s || '').slice(0, 10);

  // 数值格式化：'%' 百分比 / 'loan' 亿元(≥1万亿转万亿) / 'nfp' 千人转万人 / 其他原值
  const fmtVal = (v, unit) => {
    if (!Number.isFinite(v)) return '—';
    if (unit === 'loan') {
      if (Math.abs(v) >= 10000) return `${fmtNum(v / 10000, 2)}万亿`;
      return `${fmtNum(v, 0)}亿`;
    }
    if (unit === 'nfp') return `${fmtNum(v / 10, 1)}万`;
    const n = Math.round(v * 100) / 100;
    return unit === '%' ? `${n}%` : String(n);
  };

  // 较前值变化箭头（中性弱提示，不做红绿方向判断）
  const deltaHtml = (cur, prev) => {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || cur === prev) return '';
    return `<i class="econ-delta">${cur > prev ? '▲' : '▼'}</i>`;
  };

  // 下次发布单元格（美/欧：PUBLISH_DATE；7 日内临近高亮倒计时）
  const nextCellHtml = (publishDate) => {
    const d = dateOnly(publishDate);
    if (!d) return '<span class="econ-dim">—</span>';
    const label = d.slice(5); // MM-DD
    const ts = new Date(`${d}T00:00:00+08:00`).getTime();
    if (Number.isFinite(ts)) {
      const days = Math.round((ts - Date.now()) / 86400000);
      if (days >= 0 && days <= 7) {
        return `<span class="econ-soon">${esc(label)} · ${days === 0 ? '今日' : `${days}日后`}</span>`;
      }
    }
    return esc(label);
  };

  window.GT_EXTRA_TOOLS['econdata'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool econ-root">
          <div class="econ-head">
            <span>经济数据日历 · 中美欧</span>
            <span class="econ-head-right">
              <span class="econ-updated" data-updated></span>
              <span class="econ-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="econ-sec"><span>中国 CN</span><i>统计局 / 央行 · 东财</i></div>
          <table class="data-table econ-table">
            <thead><tr><th>指标</th><th>最新值</th><th>前值</th><th>数据期</th><th>下次发布(预估)</th></tr></thead>
            <tbody data-cn-body></tbody>
          </table>
          <div class="econ-sec"><span>美国 US</span><i>官方公布 · 东财</i></div>
          <table class="data-table econ-table">
            <thead><tr><th>指标</th><th>最新值</th><th>前值</th><th>数据期</th><th>下次发布</th></tr></thead>
            <tbody data-us-body></tbody>
          </table>
          <div class="econ-sec"><span>欧元区 EU</span><i>ECB / 欧盟统计局 · 东财</i></div>
          <table class="data-table econ-table">
            <thead><tr><th>指标</th><th>最新值</th><th>前值</th><th>数据期</th><th>下次发布</th></tr></thead>
            <tbody data-eu-body></tbody>
          </table>
          <div class="econ-foot">数据源：东方财富数据中心。中国「下次发布」为按官方惯例的预估日程；接口无市场预期值字段，故不含预期列。</div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const updatedEl = el.querySelector('[data-updated]');
      const hint = el.querySelector('[data-hint]');
      const cnBody = el.querySelector('[data-cn-body]');
      const usBody = el.querySelector('[data-us-body]');
      const euBody = el.querySelector('[data-eu-body]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'econ-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'econ-status live';
        const now = new Date();
        updatedEl.textContent = `更新于 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setStatus('online');
      };

      // 带超时的 JSON fetch（controller/timer 纳入 cleanup 管理）
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

      // datacenter-web：取 result.data 数组
      const fetchDcRows = async (url) => {
        const json = await fetchJson(url);
        const rows = json && json.result && Array.isArray(json.result.data) ? json.result.data : [];
        if (!rows.length) throw new Error('empty');
        return rows;
      };

      const renderCn = (reportMap) => {
        cnBody.innerHTML = CN_ITEMS.map((it) => {
          const rows = reportMap.get(it.report);
          if (!rows || !rows.length) {
            return `<tr><td class="econ-name">${esc(it.name)}</td><td colspan="4" class="econ-dim">加载失败</td></tr>`;
          }
          const cur = Number(rows[0] && rows[0][it.field]);
          const prev = Number(rows[1] && rows[1][it.field]);
          const period = String((rows[0] && rows[0].TIME) || '—');
          return `<tr>
            <td class="econ-name">${esc(it.name)}</td>
            <td class="econ-val">${esc(fmtVal(cur, it.unit))}${deltaHtml(cur, prev)}</td>
            <td class="econ-dim">${esc(fmtVal(prev, it.unit))}</td>
            <td class="econ-dim">${esc(period)}</td>
            <td class="econ-dim">${esc(it.next)}</td>
          </tr>`;
        }).join('');
      };

      // 美/欧：rows 为整表（按 REPORT_DATE 倒序），按指标 ID 过滤后取最新实际值与待公布行
      const renderEmg = (tbody, items, rows) => {
        const html = items.map((it) => {
          const list = rows.filter((r) => r.INDICATOR_ID === it.id);
          const actual = list.find((r) => r.VALUE !== null && r.VALUE !== undefined);
          const upcoming = list.find((r) => r.VALUE === null || r.VALUE === undefined);
          if (!actual) {
            return `<tr><td class="econ-name">${esc(it.name)}</td><td colspan="4" class="econ-dim">暂无数据</td></tr>`;
          }
          const cur = Number(actual.VALUE);
          const prev = Number(actual.PRE_VALUE);
          return `<tr>
            <td class="econ-name">${esc(it.name)}</td>
            <td class="econ-val">${esc(fmtVal(cur, it.unit))}${deltaHtml(cur, prev)}</td>
            <td class="econ-dim">${esc(fmtVal(prev, it.unit))}</td>
            <td class="econ-dim">${esc(actual.REPORT_DATE_CH || '—')}</td>
            <td>${nextCellHtml(upcoming && upcoming.PUBLISH_DATE)}</td>
          </tr>`;
        }).join('');
        tbody.innerHTML = html || `<tr class="econ-empty"><td colspan="5">暂无数据</td></tr>`;
      };

      const renderEmgError = (tbody) => {
        tbody.innerHTML = `<tr class="econ-empty"><td colspan="5">数据加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const cnReports = [...new Set(CN_ITEMS.map((it) => it.report))];
          const results = await Promise.allSettled([
            ...cnReports.map((r) => fetchDcRows(cnUrl(r))),
            fetchDcRows(emgUrl('RPT_ECONOMICVALUE_USANEW')),
            fetchDcRows(emgUrl('RPT_ECONOMICVALUE_EURONEW')),
          ]);
          if (!alive) return;
          let okCount = 0;
          const reportMap = new Map();
          cnReports.forEach((r, i) => {
            const res = results[i];
            if (res.status === 'fulfilled') {
              reportMap.set(r, res.value);
              okCount += 1;
            } else {
              reportMap.set(r, null);
            }
          });
          renderCn(reportMap);
          const usRes = results[cnReports.length];
          if (usRes.status === 'fulfilled') {
            renderEmg(usBody, US_ITEMS, usRes.value);
            okCount += 1;
          } else {
            renderEmgError(usBody);
          }
          const euRes = results[cnReports.length + 1];
          if (euRes.status === 'fulfilled') {
            renderEmg(euBody, EU_ITEMS, euRes.value);
            okCount += 1;
          } else {
            renderEmgError(euBody);
          }
          if (okCount > 0) clearError();
          else showError('经济数据加载失败，5 分钟后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return;
        refresh();
      };

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
      };
    },
  };
})();
