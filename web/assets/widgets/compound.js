/* Compound / drawdown recovery / expectancy & Kelly calculator (pure JS, no network)
 * Registers as custom tool id 'compound' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const DD_REFS = [5, 10, 15, 20, 25, 30, 40, 50]; // 回撤恢复参考表（%）
  const MAX_PERIODS = 1000;

  function injectStyle() {
    if (document.getElementById('cpx-style')) return;
    const style = document.createElement('style');
    style.id = 'cpx-style';
    style.textContent = `
.cpx-tabs { display: flex; gap: 6px; }
.cpx-tabs .tool-btn.ghost {
  transition: color 0.3s var(--ease-fluid), background 0.3s var(--ease-fluid), border-color 0.3s var(--ease-fluid);
}
.cpx-tabs .tool-btn.ghost.on {
  background: var(--acc-glow);
  color: var(--acc);
  border-color: var(--acc-dim);
}
.cpx-pane { display: none; flex-direction: column; gap: 10px; }
.cpx-pane.on { display: flex; }
.cpx-table { font-variant-numeric: tabular-nums; }
.cpx-table th, .cpx-table td { white-space: nowrap; }
.cpx-table td.num { font-family: var(--font-mono); }
.cpx-table tr.on td { background: var(--acc-glow); color: var(--acc); font-weight: 600; }
.cpx-table tr.cpx-ellipsis td { color: var(--text-dim); text-align: center; letter-spacing: 0.2em; }
`;
    document.head.appendChild(style);
  }

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

  window.GT_EXTRA_TOOLS['compound'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool">
          <div class="cpx-tabs">
            <button type="button" class="tool-btn ghost on" data-tab="grow">复利增长</button>
            <button type="button" class="tool-btn ghost" data-tab="dd">回撤恢复</button>
            <button type="button" class="tool-btn ghost" data-tab="ev">期望值·凯利</button>
          </div>

          <div class="cpx-pane on" data-pane="grow">
            <div class="tool-grid">
              <label class="field"><span>本金 $</span><input type="number" data-f="g-p" value="10000" min="0" step="any"></label>
              <label class="field"><span>每期收益率 %</span><input type="number" data-f="g-r" value="5" step="any"></label>
            </div>
            <div class="tool-grid">
              <label class="field"><span>期数</span><input type="number" data-f="g-n" value="12" min="1" max="${MAX_PERIODS}" step="1"></label>
              <label class="field"><span>每期追加 $（可选）</span><input type="number" data-f="g-a" value="0" min="0" step="any"></label>
            </div>
            <div class="tool-results" data-out="grow"></div>
          </div>

          <div class="cpx-pane" data-pane="dd">
            <label class="field"><span>回撤幅度 %</span><input type="number" data-f="d-pct" value="10" min="0" max="99.9" step="any"></label>
            <div class="tool-results" data-out="dd"></div>
          </div>

          <div class="cpx-pane" data-pane="ev">
            <label class="field"><span>胜率 %</span><input type="number" data-f="e-p" value="45" min="0" max="100" step="any"></label>
            <div class="tool-grid">
              <label class="field"><span>平均盈利 $</span><input type="number" data-f="e-w" value="300" min="0" step="any"></label>
              <label class="field"><span>平均亏损 $</span><input type="number" data-f="e-l" value="150" min="0" step="any"></label>
            </div>
            <div class="tool-results" data-out="ev"></div>
          </div>
        </div>`;

      const get = (f) => el.querySelector(`[data-f="${f}"]`);
      const outGrow = el.querySelector('[data-out="grow"]');
      const outDd = el.querySelector('[data-out="dd"]');
      const outEv = el.querySelector('[data-out="ev"]');

      /* ---------- Tab 1: 复利增长 ---------- */
      const calcGrow = () => {
        const p0 = parseVal(get('g-p').value);
        const r = parseVal(get('g-r').value);
        const nRaw = parseVal(get('g-n').value);
        const add = parseVal(get('g-a').value) || 0;
        if (p0 === null || p0 <= 0 || r === null || r <= -100 ||
            nRaw === null || nRaw < 1 || nRaw > MAX_PERIODS || add < 0) {
          outGrow.innerHTML = `<div class="tool-hint">请输入有效参数：本金 &gt; 0，期数 1 ~ ${MAX_PERIODS}，收益率 &gt; -100%</div>`;
          return;
        }
        const n = Math.floor(nRaw);
        const rows = []; // {i, eq, cumPct}
        let eq = p0;
        for (let i = 1; i <= n; i += 1) {
          eq = eq * (1 + r / 100) + add; // 每期先计息、期末追加
          const invested = p0 + add * i;
          rows.push({ i, eq, cumPct: (eq / invested - 1) * 100 });
        }
        const last = rows[rows.length - 1];
        const totalAdd = add * n;
        const totalPct = last.cumPct;
        const eqClass = last.eq >= p0 + totalAdd ? 'pos' : 'neg';

        let tableRows = '';
        const rowHtml = (row) => `
          <tr>
            <td>${row.i}</td>
            <td class="num">${fmtMoney(row.eq)}</td>
            <td class="num ${pctClass(row.cumPct)}">${fmtPct(row.cumPct)}</td>
          </tr>`;
        if (n <= 10) {
          tableRows = rows.map(rowHtml).join('');
        } else {
          tableRows =
            rows.slice(0, 10).map(rowHtml).join('') +
            '<tr class="cpx-ellipsis"><td colspan="3">· · ·</td></tr>' +
            rowHtml(last);
        }

        outGrow.innerHTML = `
          <div class="result-row highlight"><span>最终权益</span><b class="${eqClass}">${fmtMoney(last.eq)}</b></div>
          <div class="result-row"><span>总收益率</span><b class="${pctClass(totalPct)}">${fmtPct(totalPct)}</b></div>
          <div class="result-row"><span>期末追加总额</span><b>${fmtMoney(totalAdd)}</b></div>
          <div class="result-row"><span>总投入（本金+追加）</span><b>${fmtMoney(p0 + totalAdd)}</b></div>
          <table class="data-table cpx-table">
            <thead><tr><th>期数</th><th>期末权益</th><th>累计收益</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>`;
      };

      /* ---------- Tab 2: 回撤恢复 ---------- */
      const calcDd = () => {
        const d = parseVal(get('d-pct').value);
        if (d === null || d <= 0 || d >= 100) {
          outDd.innerHTML = '<div class="tool-hint">请输入 0 ~ 100 之间的回撤百分比</div>';
          return;
        }
        const need = (1 / (1 - d / 100) - 1) * 100;
        const refRows = DD_REFS.map((ref) => {
          const refNeed = (1 / (1 - ref / 100) - 1) * 100;
          const on = Math.abs(d - ref) < 1e-9 ? ' class="on"' : '';
          return `<tr${on}><td class="num">-${ref}%</td><td class="num">+${fmtNum(refNeed)}%</td></tr>`;
        }).join('');
        outDd.innerHTML = `
          <div class="result-row highlight"><span>回本所需涨幅</span><b class="warn">+${fmtNum(need)}%</b></div>
          <div class="result-row"><span>当前回撤</span><b class="neg">-${fmtNum(d)}%</b></div>
          <table class="data-table cpx-table">
            <thead><tr><th>回撤幅度</th><th>回本所需涨幅</th></tr></thead>
            <tbody>${refRows}</tbody>
          </table>`;
      };

      /* ---------- Tab 3: 期望值与凯利 ---------- */
      const calcEv = () => {
        const winPct = parseVal(get('e-p').value);
        const avgWin = parseVal(get('e-w').value);
        const avgLoss = parseVal(get('e-l').value);
        if (winPct === null || winPct < 0 || winPct > 100 ||
            avgWin === null || avgWin <= 0 || avgLoss === null || avgLoss <= 0) {
          outEv.innerHTML = '<div class="tool-hint">请输入有效参数：胜率 0 ~ 100，平均盈利 / 亏损 &gt; 0</div>';
          return;
        }
        const p = winPct / 100;
        const q = 1 - p;
        const b = avgWin / avgLoss; // 盈亏比
        const ev = p * avgWin - q * avgLoss; // 每笔期望值
        const kelly = p - q / b; // f* = p - q/b
        const verdict = ev > 0
          ? '<b class="pos">期望为正 · 系统可持续</b>'
          : ev < 0
            ? '<b class="neg">期望为负 · 长期必亏</b>'
            : '<b class="warn">期望为零 · 盈亏平衡</b>';
        const kellyHtml = kelly > 0
          ? `<b class="${kelly >= 0.25 ? 'warn' : 'pos'}">${fmtNum(kelly * 100)}%</b>`
          : '<b class="neg">不建议开仓</b>';
        outEv.innerHTML = `
          <div class="result-row highlight"><span>每笔期望值</span><b class="${pctClass(ev)}">${ev >= 0 ? '+' : ''}${fmtMoney(ev)}</b></div>
          <div class="result-row"><span>盈亏比 R:R</span><b>1 : ${fmtNum(b)}</b></div>
          <div class="result-row"><span>判定</span>${verdict}</div>
          <div class="result-row"><span>Kelly 仓位 f*</span>${kellyHtml}</div>
          <div class="result-row"><span>¼ Kelly（稳健）</span><b>${kelly > 0 ? `${fmtNum((kelly / 4) * 100)}%` : '—'}</b></div>`;
      };

      const calcAll = () => {
        calcGrow();
        calcDd();
        calcEv();
      };

      const onInput = (e) => {
        if (e.target.matches('input')) calcAll();
      };
      const onClick = (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === btn));
        el.querySelectorAll('[data-pane]').forEach((pane) =>
          pane.classList.toggle('on', pane.dataset.pane === btn.dataset.tab));
      };

      el.addEventListener('input', onInput);
      el.addEventListener('click', onClick);
      calcAll();
      setStatus('online'); // 纯本地计算，挂载即就绪

      return () => {
        el.removeEventListener('input', onInput);
        el.removeEventListener('click', onClick);
      };
    },
  };
})();
