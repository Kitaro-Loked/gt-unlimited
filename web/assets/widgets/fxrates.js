/* FX Rates panel + converter. Data: frankfurter (ECB reference rates, free, no key, CORS *).
   Registers as window.GT_EXTRA_TOOLS['fxrates']; app.js falls back to this registry. */
(() => {
  const API = 'https://api.frankfurter.dev/v1/latest';
  const REFRESH_MS = 60000;
  const BASES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD'];
  // CNH 不在 frankfurter 支持列表中，按约定以 SEK 代替
  const QUOTES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'HKD', 'CAD', 'CHF', 'NZD', 'KRW', 'SGD', 'SEK'];
  const NAMES = {
    USD: '美元', EUR: '欧元', JPY: '日元', GBP: '英镑', CNY: '人民币', AUD: '澳元',
    HKD: '港币', CAD: '加元', CHF: '瑞郎', NZD: '纽元', KRW: '韩元', SGD: '新元', SEK: '瑞典克朗',
  };

  const injectStyle = () => {
    if (document.getElementById('fxr-style')) return;
    const style = document.createElement('style');
    style.id = 'fxr-style';
    style.textContent = `
      .fxr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .fxr-bases { display: flex; gap: 4px; flex-wrap: wrap; }
      .fxr-base {
        font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em;
        padding: 5px 9px; background: color-mix(in srgb, var(--text) 4%, transparent);
        border: 1px solid var(--hairline); border-radius: var(--radius-sm);
        color: var(--text-muted); cursor: pointer;
        transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
      }
      .fxr-base:hover { color: var(--text); border-color: var(--acc-dim); }
      .fxr-base.active { color: var(--acc); border-color: var(--acc-dim); background: var(--acc-glow); }
      .fxr-date { font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.14em; color: var(--text-dim); text-transform: uppercase; }
      .fxr-table-wrap { border: 1px solid var(--hairline); border-radius: var(--radius-sm); overflow: hidden; }
      .fxr-table td.fxr-cur { font-weight: 600; letter-spacing: 0.06em; font-size: 11px; }
      .fxr-table td.fxr-cur small { color: var(--text-dim); font-weight: 400; margin-left: 5px; font-size: 9px; }
      .fxr-table th.fxr-num, .fxr-table td.fxr-rate, .fxr-table td.fxr-chg { text-align: right; }
      .fxr-table td.fxr-rate { font-family: var(--font-mono); font-size: 11px; }
      .fxr-table td.fxr-chg { font-family: var(--font-mono); font-size: 10px; width: 92px; }
      .fxr-table td.fxr-chg .fxr-flat { color: var(--text-dim); }
      .fxr-table tbody tr { transition: background 0.2s var(--ease-fluid); }
      .fxr-table tbody tr:hover { background: color-mix(in srgb, var(--text) 4%, transparent); }
      .fxr-conv { border-top: 1px dashed var(--hairline); padding-top: 10px; display: flex; flex-direction: column; gap: 10px; }
      .fxr-result { text-align: center; padding: 4px 0 2px; }
      .fxr-result-label { display: block; font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.15em; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px; }
      .fxr-result-value { font-family: var(--font-mono); font-size: 24px; font-weight: 700; color: var(--acc); letter-spacing: 0.02em; word-break: break-all; }
      .fxr-result-value small { font-size: 12px; font-weight: 500; color: var(--text-muted); margin-left: 6px; }
      .fxr-hint { padding: 8px 6px; }
    `;
    document.head.appendChild(style);
  };

  const fmtRate = (v) => {
    if (!Number.isFinite(v)) return '—';
    const digits = v >= 100 ? 2 : v >= 1 ? 4 : 5;
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtMoney = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};
  window.GT_EXTRA_TOOLS.fxrates = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool fxr-tool">
          <div class="fxr-head">
            <div class="fxr-bases" data-bases>
              ${BASES.map((b, i) => `<button type="button" class="fxr-base${i === 0 ? ' active' : ''}" data-base="${b}">${b}</button>`).join('')}
            </div>
            <div class="fxr-date" data-date>ECB · —</div>
          </div>
          <div class="fxr-table-wrap">
            <table class="data-table fxr-table">
              <thead><tr><th>货币</th><th class="fxr-num">汇率</th><th class="fxr-num">变动</th></tr></thead>
              <tbody data-rows>
                <tr class="empty-row"><td colspan="3">加载中…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="fxr-conv">
            <div class="tool-grid">
              <label class="field"><span>金额</span><input type="number" data-amount value="100" min="0" step="any"></label>
              <label class="field"><span>目标货币</span><select data-target></select></label>
            </div>
            <div class="fxr-result">
              <span class="fxr-result-label" data-conv-label>换算结果</span>
              <div class="fxr-result-value" data-conv-value>—</div>
            </div>
          </div>
          <div class="tool-hint fxr-hint" data-hint style="display:none"></div>
        </div>`;

      const rowsEl = el.querySelector('[data-rows]');
      const dateEl = el.querySelector('[data-date]');
      const hintEl = el.querySelector('[data-hint]');
      const amountEl = el.querySelector('[data-amount]');
      const targetEl = el.querySelector('[data-target]');
      const convLabelEl = el.querySelector('[data-conv-label]');
      const convValueEl = el.querySelector('[data-conv-value]');

      let alive = true;
      let base = BASES[0];
      let rates = {};
      let prevRates = {};

      const showHint = (msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const hideHint = () => {
        hintEl.style.display = 'none';
      };

      const rebuildTargets = (keep) => {
        const opts = QUOTES.filter((c) => c !== base);
        targetEl.innerHTML = opts.map((c) => `<option value="${c}">${c} · ${NAMES[c] || c}</option>`).join('');
        targetEl.value = keep && opts.includes(keep) ? keep : opts[0];
      };

      const renderRows = () => {
        const codes = QUOTES.filter((c) => c !== base);
        rowsEl.innerHTML = codes
          .map((code) => {
            const cur = rates[code];
            const prev = prevRates[code];
            let chg = '<span class="fxr-flat">—</span>';
            if (Number.isFinite(cur) && Number.isFinite(prev) && cur !== prev) {
              const pct = ((cur - prev) / prev) * 100;
              const up = pct > 0;
              chg = `<span class="${up ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%</span>`;
            }
            return `<tr>
              <td class="fxr-cur">${code}<small>${NAMES[code] || ''}</small></td>
              <td class="fxr-rate">${fmtRate(cur)}</td>
              <td class="fxr-chg">${chg}</td>
            </tr>`;
          })
          .join('');
      };

      const updateConv = () => {
        const amount = parseFloat(amountEl.value);
        const target = targetEl.value;
        const rate = rates[target];
        convLabelEl.textContent = Number.isFinite(amount) && target ? `${fmtMoney(amount)} ${base} ≈` : '换算结果';
        if (Number.isFinite(amount) && Number.isFinite(rate)) {
          convValueEl.innerHTML = `${fmtMoney(amount * rate)}<small>${target}</small>`;
        } else {
          convValueEl.textContent = '—';
        }
      };

      const load = async () => {
        try {
          const symbols = QUOTES.filter((c) => c !== base).join(',');
          const res = await fetch(`${API}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbols)}`);
          if (!res.ok) throw new Error(`http ${res.status}`);
          const json = await res.json();
          if (!alive) return;
          if (!json || !json.rates || typeof json.rates !== 'object') throw new Error('bad payload');
          prevRates = rates;
          rates = json.rates;
          dateEl.textContent = `ECB · ${json.date || '—'}`;
          renderRows();
          updateConv();
          hideHint();
          setStatus('online');
        } catch (e) {
          if (!alive) return;
          if (!Object.keys(rates).length) {
            rowsEl.innerHTML = '<tr class="empty-row"><td colspan="3">暂无数据</td></tr>';
          }
          showHint('汇率数据加载失败，下一轮自动重试');
          setStatus('offline');
        }
      };

      el.querySelector('[data-bases]').addEventListener('click', (ev) => {
        const btn = ev.target.closest('.fxr-base');
        if (!btn || btn.dataset.base === base) return;
        base = btn.dataset.base;
        el.querySelectorAll('.fxr-base').forEach((b) => b.classList.toggle('active', b === btn));
        prevRates = {}; // 换基准后旧值不可比，避免误导性的涨跌指示
        rates = {};
        rebuildTargets(targetEl.value);
        renderRows();
        updateConv();
        load();
      });
      amountEl.addEventListener('input', updateConv);
      targetEl.addEventListener('change', updateConv);

      rebuildTargets('EUR');
      load();
      const timer = setInterval(load, REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    },
  };
})();
