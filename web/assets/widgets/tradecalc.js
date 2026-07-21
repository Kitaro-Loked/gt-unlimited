/* 策略计算器 TRADE_TOOLS — 网格交易 / 凯利仓位 / 定投DCA（纯 JS 本地计算，无网络请求）
 * 数据接口：无（全部实时本地计算，2026-07-16 实测无网络依赖，挂载即 online）。
 * 输入持久化：localStorage key 'gt_tradecalc_v1'（独立命名，与其他组件不冲突）。
 * 配色约定：通用工具组件，绿涨红跌 —— 正收益/多头用 .pos，亏损/风险用 .neg，警示用 .warn（语义色令牌由全局 styles.css 定义）。
 * 与既有组件差异：calculators.js 做点值/保证金/强平价，compound.js 做复利增长/回撤恢复/简易期望值，
 * 本组件专注网格策略参数表、凯利分数仓位+连亏资金曲线、定投复利曲线，不重复实现。
 * Registers as custom tool id 'tradecalc' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt_tradecalc_v1';
  const MAX_GRIDS = 200; // 网格数上限（表格行数保护）
  const MAX_LOSS_N = 50; // 凯利连亏曲线上限
  const MAX_DCA_N = 600; // 定投期数上限（50 年）

  const TABS = [
    { id: 'grid', label: '网格 GRID' },
    { id: 'kelly', label: '凯利 KELLY' },
    { id: 'dca', label: '定投 DCA' },
  ];

  const DEFAULTS = {
    tab: 'grid',
    grid: { upper: '70000', lower: '50000', n: '10', amt: '100', mode: 'geo' },
    kelly: { p: '45', b: '2', n: '10' },
    dca: { pmt: '500', n: '36', apr: '8' },
  };

  function injectStyle() {
    if (document.getElementById('tcx-style')) return;
    const style = document.createElement('style');
    style.id = 'tcx-style';
    style.textContent = `
.tcx-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tcx-tabs .tool-btn.ghost { border-radius: 999px; }
.tcx-tabs .tool-btn.ghost.on {
  background: var(--acc-glow);
  color: var(--acc);
  border-color: var(--acc-dim);
}
.tcx-pane { display: none; flex-direction: column; gap: 10px; }
.tcx-pane.on { display: flex; }
/* 纸感输入框（局部加强，与全局 .field 协调） */
.tcx-root .field input,
.tcx-root .field select {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  transition: border-color 0.25s var(--ease-fluid), background 0.25s var(--ease-fluid);
}
.tcx-root .field input:focus,
.tcx-root .field select:focus {
  border-color: var(--acc-dim);
  background: var(--surface);
}
.tcx-table { font-variant-numeric: tabular-nums; }
.tcx-table th, .tcx-table td { white-space: nowrap; }
.tcx-table td.num { font-family: var(--font-mono); }
.tcx-table tr.tcx-ellipsis td { color: var(--text-dim); text-align: center; letter-spacing: 0.2em; }
.tcx-note { font-size: 10px; color: var(--text-dim); line-height: 1.5; }
`;
    document.head.appendChild(style);
  }

  /* ---------- 工具函数 ---------- */
  const parseVal = (s) => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };

  const fmtNum = (v, d = 2) =>
    Number.isFinite(v)
      ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
      : '—';

  const fmtMoney = (v, d = 2) => (Number.isFinite(v) ? `$${fmtNum(v, d)}` : '—');

  const fmtPct = (v, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${fmtNum(v, d)}%` : '—');

  const pctClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'warn');

  // localStorage 恢复的值注入 value 属性前转义，防属性断裂
  const escAttr = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- 状态持久化 ---------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const saved = JSON.parse(raw);
      return {
        tab: saved.tab || DEFAULTS.tab,
        grid: { ...DEFAULTS.grid, ...(saved.grid || {}) },
        kelly: { ...DEFAULTS.kelly, ...(saved.kelly || {}) },
        dca: { ...DEFAULTS.dca, ...(saved.dca || {}) },
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      /* 隐私模式等场景下静默失败，不影响计算 */
    }
  }

  /* ---------- Tab 1: 网格交易计算器 ---------- */
  function gridHtml(s) {
    return `
      <div class="tool-grid">
        <label class="field"><span>区间上限价</span><input type="number" data-f="upper" value="${escAttr(s.upper)}" min="0" step="any"></label>
        <label class="field"><span>区间下限价</span><input type="number" data-f="lower" value="${escAttr(s.lower)}" min="0" step="any"></label>
      </div>
      <div class="tool-grid">
        <label class="field"><span>网格数（1 ~ ${MAX_GRIDS}）</span><input type="number" data-f="n" value="${escAttr(s.n)}" min="1" max="${MAX_GRIDS}" step="1"></label>
        <label class="field"><span>每格投入 $</span><input type="number" data-f="amt" value="${escAttr(s.amt)}" min="0" step="any"></label>
      </div>
      <label class="field"><span>网格模式</span>
        <select data-f="mode">
          <option value="geo"${s.mode === 'geo' ? ' selected' : ''}>等比网格（每格收益率相同）</option>
          <option value="arith"${s.mode === 'arith' ? ' selected' : ''}>等差网格（每格价差相同）</option>
        </select>
      </label>
      <div class="tool-results" data-results></div>`;
  }

  function gridCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const upper = parseVal(get('upper').value);
    const lower = parseVal(get('lower').value);
    const nRaw = parseVal(get('n').value);
    const amt = parseVal(get('amt').value);
    const mode = get('mode').value === 'arith' ? 'arith' : 'geo';
    if (upper === null || lower === null || lower <= 0 || upper <= lower ||
        nRaw === null || nRaw < 1 || nRaw > MAX_GRIDS || amt === null || amt <= 0) {
      out.innerHTML = `<div class="tool-hint">请输入有效参数：上限 &gt; 下限 &gt; 0，网格数 1 ~ ${MAX_GRIDS}，每格投入 &gt; 0</div>`;
      return;
    }
    const n = Math.floor(nRaw);
    // 价格档位 P_0=lower ... P_n=upper；第 i 格在 P_i 买入、P_{i+1} 卖出
    const levels = [];
    let ratio = null;
    if (mode === 'geo') {
      ratio = Math.pow(upper / lower, 1 / n);
      for (let i = 0; i <= n; i += 1) levels.push(lower * Math.pow(ratio, i));
    } else {
      const step = (upper - lower) / n;
      for (let i = 0; i <= n; i += 1) levels.push(lower + i * step);
    }

    const rows = []; // {i, buy, sell, qty, profit, profitPct}
    for (let i = 0; i < n; i += 1) {
      const buy = levels[i];
      const sell = levels[i + 1];
      const qty = amt / buy;
      const profit = qty * (sell - buy);
      rows.push({ i: i + 1, buy, sell, qty, profit, profitPct: (profit / amt) * 100 });
    }
    const totalInvest = amt * n;
    const minProfit = rows.reduce((m, r) => Math.min(m, r.profitPct), Infinity);
    const maxProfit = rows.reduce((m, r) => Math.max(m, r.profitPct), -Infinity);
    const gridStepPct = mode === 'geo' ? (ratio - 1) * 100 : null;

    const rowHtml = (r) => `
      <tr>
        <td>${r.i}</td>
        <td class="num">${fmtNum(r.buy, r.buy < 10 ? 4 : 2)}</td>
        <td class="num">${fmtNum(r.sell, r.sell < 10 ? 4 : 2)}</td>
        <td class="num">${fmtNum(r.qty, 4)}</td>
        <td class="num pos">${fmtMoney(r.profit)}</td>
        <td class="num pos">${fmtPct(r.profitPct)}</td>
      </tr>`;
    let tableRows;
    if (n <= 20) {
      tableRows = rows.map(rowHtml).join('');
    } else {
      tableRows =
        rows.slice(0, 18).map(rowHtml).join('') +
        '<tr class="tcx-ellipsis"><td colspan="6">· · ·</td></tr>' +
        rowHtml(rows[n - 1]);
    }

    out.innerHTML = `
      <div class="result-row highlight"><span>总投入（满格买入）</span><b>${fmtMoney(totalInvest)}</b></div>
      <div class="result-row"><span>理论单格收益</span><b class="pos">${
        mode === 'geo'
          ? `${fmtPct(rows[0].profitPct)} / 格（每格相同）`
          : `${fmtPct(minProfit)} ~ ${fmtPct(maxProfit)} / 格（低价格更高）`
      }</b></div>
      <div class="result-row"><span>单格利润金额</span><b class="pos">${
        mode === 'geo'
          ? fmtMoney(rows[0].profit)
          : `${fmtMoney(rows[rows.length - 1].profit)} ~ ${fmtMoney(rows[0].profit)}`
      }</b></div>
      <div class="result-row"><span>每格间距</span><b>${
        mode === 'geo' ? fmtNum(gridStepPct) + '%（等比）' : fmtNum((upper - lower) / n, 4) + '（等差）'
      }</b></div>
      <table class="data-table tcx-table">
        <thead><tr><th>格号</th><th>买入价</th><th>卖出价</th><th>数量</th><th>利润/格</th><th>利润率</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="tcx-note">不含手续费与滑点；价格触及上限全部卖出、跌破下限满格持仓。等比模式每格收益率一致，等差模式低价格收益率更高。</div>`;
  }

  /* ---------- Tab 2: 凯利公式仓位 ---------- */
  function kellyHtml(s) {
    return `
      <div class="tool-grid">
        <label class="field"><span>胜率 %（0 ~ 100）</span><input type="number" data-f="p" value="${escAttr(s.p)}" min="0" max="100" step="any"></label>
        <label class="field"><span>盈亏比 R:R（盈利 / 亏损）</span><input type="number" data-f="b" value="${escAttr(s.b)}" min="0" step="any"></label>
      </div>
      <label class="field"><span>连亏次数 N（1 ~ ${MAX_LOSS_N}，资金曲线参考）</span><input type="number" data-f="n" value="${escAttr(s.n)}" min="1" max="${MAX_LOSS_N}" step="1"></label>
      <div class="tool-results" data-results></div>`;
  }

  function kellyCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const winPct = parseVal(get('p').value);
    const b = parseVal(get('b').value);
    const nRaw = parseVal(get('n').value);
    if (winPct === null || winPct <= 0 || winPct > 100 || b === null || b <= 0 ||
        nRaw === null || nRaw < 1 || nRaw > MAX_LOSS_N) {
      out.innerHTML = `<div class="tool-hint">请输入有效参数：胜率 0 ~ 100（不含 0），盈亏比 &gt; 0，N 1 ~ ${MAX_LOSS_N}</div>`;
      return;
    }
    const p = winPct / 100;
    const q = 1 - p;
    const kelly = p - q / b; // f* = p - q/b
    const evR = p * b - q; // 单笔期望值（R 倍数，1R = 单笔亏损额）

    const evHtml = `<b class="${pctClass(evR)}">${evR >= 0 ? '+' : ''}${fmtNum(evR, 3)} R</b>`;
    const verdict = evR > 0
      ? '<b class="pos">期望为正 · 系统可持续</b>'
      : evR < 0
        ? '<b class="neg">期望为负 · 长期必亏</b>'
        : '<b class="warn">期望为零 · 盈亏平衡</b>';

    let kellyRowsHtml;
    let lossTableHtml = '';
    if (kelly <= 0) {
      kellyRowsHtml = `
        <div class="result-row highlight"><span>Kelly 最优仓位 f*</span><b class="neg">不建议开仓（f* ≤ 0）</b></div>
        <div class="result-row"><span>判定</span>${verdict}</div>`;
    } else {
      const full = kelly;
      const half = kelly / 2;
      const quarter = kelly / 4;
      kellyRowsHtml = `
        <div class="result-row highlight"><span>Kelly 最优仓位 f*</span><b class="${full >= 0.5 ? 'neg' : full >= 0.25 ? 'warn' : 'pos'}">${fmtNum(full * 100)}%</b></div>
        <div class="result-row"><span>½ Kelly（推荐实战）</span><b>${fmtNum(half * 100)}%</b></div>
        <div class="result-row"><span>¼ Kelly（稳健）</span><b>${fmtNum(quarter * 100)}%</b></div>
        <div class="result-row"><span>判定</span>${verdict}</div>`;

      // 连续 N 次亏损后的剩余资金曲线：equity = (1 - f)^N
      const n = Math.floor(nRaw);
      const rows = [];
      for (let i = 1; i <= n; i += 1) {
        rows.push({
          i,
          full: Math.pow(1 - full, i) * 100,
          half: Math.pow(1 - half, i) * 100,
          quarter: Math.pow(1 - quarter, i) * 100,
        });
      }
      const eqClass = (v) => (v < 50 ? 'neg' : v < 80 ? 'warn' : 'pos');
      let bodyRows = '';
      const rowHtml = (r) => `
      <tr>
        <td>${r.i}</td>
        <td class="num ${eqClass(r.full)}">${fmtNum(r.full, 1)}%</td>
        <td class="num ${eqClass(r.half)}">${fmtNum(r.half, 1)}%</td>
        <td class="num ${eqClass(r.quarter)}">${fmtNum(r.quarter, 1)}%</td>
      </tr>`;
      if (n <= 15) {
        bodyRows = rows.map(rowHtml).join('');
      } else {
        bodyRows =
          rows.slice(0, 12).map(rowHtml).join('') +
          '<tr class="tcx-ellipsis"><td colspan="4">· · ·</td></tr>' +
          rowHtml(rows[n - 1]);
      }
      lossTableHtml = `
      <table class="data-table tcx-table">
        <thead><tr><th>连亏</th><th>全 Kelly</th><th>½ Kelly</th><th>¼ Kelly</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <div class="tcx-note">上表为连亏 N 次后剩余资金占本金比例（equity = (1 − f)^N）。全 Kelly 波动极大，实战中 ½ ~ ¼ Kelly 回撤更可控；连续亏损概率 = (1 − 胜率)^N。</div>`;
    }

    out.innerHTML = `
      <div class="result-row"><span>单笔期望值</span>${evHtml}</div>
      ${kellyRowsHtml}
      ${lossTableHtml}`;
  }

  /* ---------- Tab 3: 定投 DCA 模拟 ---------- */
  function dcaHtml(s) {
    return `
      <div class="tool-grid">
        <label class="field"><span>每月投入 $</span><input type="number" data-f="pmt" value="${escAttr(s.pmt)}" min="0" step="any"></label>
        <label class="field"><span>期数（月，1 ~ ${MAX_DCA_N}）</span><input type="number" data-f="n" value="${escAttr(s.n)}" min="1" max="${MAX_DCA_N}" step="1"></label>
      </div>
      <label class="field"><span>预期年化收益率 %（可为负）</span><input type="number" data-f="apr" value="${escAttr(s.apr)}" min="-99" step="any"></label>
      <div class="tool-results" data-results></div>`;
  }

  function dcaCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const pmt = parseVal(get('pmt').value);
    const nRaw = parseVal(get('n').value);
    const apr = parseVal(get('apr').value);
    if (pmt === null || pmt <= 0 || nRaw === null || nRaw < 1 || nRaw > MAX_DCA_N ||
        apr === null || apr <= -100) {
      out.innerHTML = `<div class="tool-hint">请输入有效参数：每月投入 &gt; 0，期数 1 ~ ${MAX_DCA_N}，年化 &gt; -100%</div>`;
      return;
    }
    const n = Math.floor(nRaw);
    const m = Math.pow(1 + apr / 100, 1 / 12) - 1; // 年化 → 月化（有效复利）

    // 月末投入（普通年金）：FV = PMT * ((1+m)^n - 1) / m
    const rows = []; // {i, invested, fv, gain}
    let fv = 0;
    for (let i = 1; i <= n; i += 1) {
      fv = fv * (1 + m) + pmt; // 上月本息计息 + 本月末投入
      const invested = pmt * i;
      rows.push({ i, invested, fv, gain: fv - invested });
    }
    const last = rows[n - 1];
    const totalPct = (last.gain / last.invested) * 100;

    let tableRows = '';
    const rowHtml = (r) => `
      <tr>
        <td>${r.i}</td>
        <td class="num">${fmtMoney(r.invested, 0)}</td>
        <td class="num">${fmtMoney(r.fv)}</td>
        <td class="num ${pctClass(r.gain)}">${r.gain >= 0 ? '+' : ''}${fmtMoney(r.gain)}</td>
      </tr>`;
    if (n <= 12) {
      tableRows = rows.map(rowHtml).join('');
    } else {
      tableRows =
        rows.slice(0, 11).map(rowHtml).join('') +
        '<tr class="tcx-ellipsis"><td colspan="4">· · ·</td></tr>' +
        rowHtml(last);
    }

    out.innerHTML = `
      <div class="result-row highlight"><span>期末本息</span><b class="${pctClass(last.gain)}">${fmtMoney(last.fv)}</b></div>
      <div class="result-row"><span>投入本金</span><b>${fmtMoney(last.invested)}</b></div>
      <div class="result-row"><span>总收益</span><b class="${pctClass(last.gain)}">${last.gain >= 0 ? '+' : ''}${fmtMoney(last.gain)}（${fmtPct(totalPct)}）</b></div>
      <div class="result-row"><span>月化利率</span><b>${fmtPct(m * 100, 3)}</b></div>
      <table class="data-table tcx-table">
        <thead><tr><th>月</th><th>累计投入</th><th>期末价值</th><th>累计收益</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="tcx-note">假设每月末投入、年化收益按月化复利（(1+年化)^(1/12) − 1）稳定增长；实际定投收益取决于买入时的净值路径，本表仅为恒定收益假设下的理论值。</div>`;
  }

  const PANES = {
    grid: { html: gridHtml, compute: gridCompute, stateKey: 'grid' },
    kelly: { html: kellyHtml, compute: kellyCompute, stateKey: 'kelly' },
    dca: { html: dcaHtml, compute: dcaCompute, stateKey: 'dca' },
  };

  window.GT_EXTRA_TOOLS['tradecalc'] = {
    mount(el, setStatus) {
      injectStyle();

      const state = loadState();
      if (!PANES[state.tab]) state.tab = 'grid';

      el.innerHTML = `
        <div class="tool tcx-root">
          <div class="tcx-tabs" data-tabs>
            ${TABS.map(
              (t) =>
                `<button type="button" class="tool-btn ghost tcx-tab${t.id === state.tab ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`
            ).join('')}
          </div>
          <div class="tcx-pane on" data-pane></div>
        </div>`;

      const tabsBar = el.querySelector('[data-tabs]');
      const pane = el.querySelector('[data-pane]');
      let activeTab = state.tab;

      const renderTab = (id) => {
        activeTab = id;
        state.tab = id;
        saveState(state);
        tabsBar.querySelectorAll('.tcx-tab').forEach((b) => {
          b.classList.toggle('on', b.dataset.tab === id);
        });
        pane.innerHTML = PANES[id].html(state[PANES[id].stateKey]);
        PANES[id].compute(pane);
      };

      const onTabClick = (e) => {
        const btn = e.target.closest('.tcx-tab');
        if (!btn || btn.dataset.tab === activeTab) return;
        renderTab(btn.dataset.tab);
      };
      const onInput = (e) => {
        const f = e.target.closest('[data-f]');
        if (f) {
          state[PANES[activeTab].stateKey][f.dataset.f] = f.value;
          saveState(state);
        }
        PANES[activeTab].compute(pane);
      };

      tabsBar.addEventListener('click', onTabClick);
      pane.addEventListener('input', onInput);
      pane.addEventListener('change', onInput);

      renderTab(activeTab);
      setStatus('online'); // 纯本地计算，挂载即就绪

      return () => {
        tabsBar.removeEventListener('click', onTabClick);
        pane.removeEventListener('input', onInput);
        pane.removeEventListener('change', onInput);
      };
    },
  };
})();
