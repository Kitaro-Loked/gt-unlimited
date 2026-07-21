/* Trading calculators: 点值 / 保证金 / 强平价 — 纯本地计算，无网络请求
 * Registers as custom tool id 'calculators' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'pip', label: '点值 PIP' },
    { id: 'margin', label: '保证金 MARGIN' },
    { id: 'liq', label: '强平价 LIQ' },
  ];

  function injectStyle() {
    if (document.getElementById('gtc-style')) return;
    const style = document.createElement('style');
    style.id = 'gtc-style';
    style.textContent = `
.gtc-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.gtc-tab {
  transition: color 0.3s var(--ease-fluid), border-color 0.3s var(--ease-fluid), background 0.3s var(--ease-fluid);
}
.gtc-tab.active {
  border-color: var(--acc);
  color: var(--acc);
  background: var(--acc-glow);
}
.gtc-root .result-row b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.gtc-risk-warn { color: var(--warning); }
.gtc-risk-danger { color: var(--danger); }
`;
    document.head.appendChild(style);
  }

  const parseVal = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  function fmtNum(n, maxDec) {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: maxDec == null ? 2 : maxDec });
  }

  // 价格自适应精度：大数少小数位，小数多保留
  function fmtPrice(v) {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1000) return fmtNum(v, 1);
    if (v >= 100) return fmtNum(v, 2);
    if (v >= 1) return fmtNum(v, 4);
    return fmtNum(v, 6);
  }

  const HINT_FILL = '<div class="tool-hint">填写完整参数后自动计算</div>';

  /* ---------- Tab 1: 点值计算器 ---------- */
  function pipHtml() {
    return `
      <div class="tool-grid">
        <label class="field"><span>每手合约单位</span><input type="number" data-f="units" value="100000" min="0" step="any"></label>
        <label class="field"><span>点大小</span><input type="number" data-f="point" value="0.0001" min="0" step="any"></label>
      </div>
      <label class="field"><span>当前汇率系数（可选 · 默认 1，报价货币 ≠ 账户货币时填写）</span><input type="number" data-f="rate" value="1" min="0" step="any"></label>
      <div class="tool-results" data-results></div>`;
  }

  function pipCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const units = parseVal(get('units').value);
    const point = parseVal(get('point').value);
    let rate = parseVal(get('rate').value);
    if (rate === null) rate = 1; // 可选，默认 1
    if (!units || !point || rate < 0) {
      out.innerHTML = HINT_FILL;
      return;
    }
    const perLot = units * point * rate;
    out.innerHTML = `
      <div class="result-row highlight"><span>每手点值</span><b>${fmtNum(perLot, 4)}</b></div>
      <div class="result-row"><span>0.1 手（迷你手）点值</span><b>${fmtNum(perLot * 0.1, 4)}</b></div>
      <div class="result-row"><span>0.01 手（微手）点值</span><b>${fmtNum(perLot * 0.01, 4)}</b></div>`;
  }

  /* ---------- Tab 2: 保证金计算器 ---------- */
  function marginHtml() {
    return `
      <div class="tool-grid">
        <label class="field"><span>现价</span><input type="number" data-f="price" placeholder="1.08500" min="0" step="any"></label>
        <label class="field"><span>手数</span><input type="number" data-f="lots" value="1" min="0" step="any"></label>
      </div>
      <div class="tool-grid">
        <label class="field"><span>每手合约单位</span><input type="number" data-f="units" value="100000" min="0" step="any"></label>
        <label class="field"><span>杠杆（1 : x）</span><input type="number" data-f="lev" value="100" min="1" step="any"></label>
      </div>
      <div class="tool-results" data-results></div>
      <div class="tool-hint" data-risk style="display:none"></div>`;
  }

  function marginCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const risk = pane.querySelector('[data-risk]');
    const price = parseVal(get('price').value);
    const lots = parseVal(get('lots').value);
    const units = parseVal(get('units').value);
    const lev = parseVal(get('lev').value);
    risk.style.display = 'none';
    if (!price || !lots || !units || !lev || lev < 1) {
      out.innerHTML = HINT_FILL;
      return;
    }
    const margin = (price * lots * units) / lev;
    out.innerHTML = `
      <div class="result-row highlight"><span>所需保证金</span><b>${fmtPrice(margin)}</b></div>`;
    if (lev > 100) {
      risk.textContent = '⚠ 杠杆超过 100 倍，风险极高，请谨慎控制仓位';
      risk.className = 'tool-hint gtc-risk-danger';
      risk.style.display = '';
    } else if (lev > 50) {
      risk.textContent = '⚠ 杠杆超过 50 倍，请注意风险';
      risk.className = 'tool-hint gtc-risk-warn';
      risk.style.display = '';
    }
  }

  /* ---------- Tab 3: 强平价计算器（逐仓简化） ---------- */
  function liqHtml() {
    return `
      <div class="tool-grid">
        <label class="field"><span>方向</span>
          <select data-f="dir">
            <option value="long">做多 LONG</option>
            <option value="short">做空 SHORT</option>
          </select>
        </label>
        <label class="field"><span>杠杆（1 : x）</span><input type="number" data-f="lev" value="20" min="1" step="any"></label>
      </div>
      <div class="tool-grid">
        <label class="field"><span>入场价</span><input type="number" data-f="entry" placeholder="65000" min="0" step="any"></label>
        <label class="field"><span>维持保证金率 %</span><input type="number" data-f="mmr" value="0.5" min="0" step="any"></label>
      </div>
      <div class="tool-results" data-results></div>`;
  }

  function liqCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const dir = get('dir').value === 'short' ? 'short' : 'long';
    const entry = parseVal(get('entry').value);
    const lev = parseVal(get('lev').value);
    const mmrPct = parseVal(get('mmr').value);
    if (!entry || entry <= 0 || !lev || lev < 1 || mmrPct === null || mmrPct < 0) {
      out.innerHTML = HINT_FILL;
      return;
    }
    const k = 1 / lev - mmrPct / 100; // 距入场的价格偏移比例（两个方向相同）
    if (k <= 0) {
      out.innerHTML = '<div class="tool-hint gtc-risk-danger">⚠ 维持保证金率 ≥ 1 / 杠杆，开仓即触发强平，请调整参数</div>';
      return;
    }
    const liq = dir === 'long' ? entry * (1 - k) : entry * (1 + k);
    const distPct = k * 100;
    const distCls = distPct < 5 ? 'neg' : distPct < 15 ? 'warn' : 'pos';
    out.innerHTML = `
      <div class="result-row highlight"><span>强平价</span><b>${fmtPrice(liq)}</b></div>
      <div class="result-row"><span>距入场</span><b>${fmtNum(distPct, 2)}%</b></div>
      <div class="result-row"><span>强平缓冲</span><b class="${distCls}">距强平还有 ${fmtNum(distPct, 2)}%</b></div>`;
  }

  const PANES = {
    pip: { html: pipHtml, compute: pipCompute },
    margin: { html: marginHtml, compute: marginCompute },
    liq: { html: liqHtml, compute: liqCompute },
  };

  window.GT_EXTRA_TOOLS['calculators'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool gtc-root">
          <div class="gtc-tabs" data-tabs>
            ${TABS.map(
              (t, i) =>
                `<button type="button" class="tool-btn ghost gtc-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
            ).join('')}
          </div>
          <div data-pane></div>
        </div>`;

      const tabsBar = el.querySelector('[data-tabs]');
      const pane = el.querySelector('[data-pane]');
      let activeTab = TABS[0].id;

      const renderTab = (id) => {
        activeTab = id;
        tabsBar.querySelectorAll('.gtc-tab').forEach((b) => {
          b.classList.toggle('active', b.dataset.tab === id);
        });
        pane.innerHTML = PANES[id].html();
        PANES[id].compute(pane);
      };

      const onTabClick = (e) => {
        const btn = e.target.closest('.gtc-tab');
        if (!btn || btn.dataset.tab === activeTab) return;
        renderTab(btn.dataset.tab);
      };
      const onInput = () => PANES[activeTab].compute(pane);

      tabsBar.addEventListener('click', onTabClick);
      pane.addEventListener('input', onInput);
      pane.addEventListener('change', onInput);

      renderTab(activeTab);
      setStatus('online'); // 纯本地计算，始终可用

      return () => {
        tabsBar.removeEventListener('click', onTabClick);
        pane.removeEventListener('input', onInput);
        pane.removeEventListener('change', onInput);
      };
    },
  };
})();
