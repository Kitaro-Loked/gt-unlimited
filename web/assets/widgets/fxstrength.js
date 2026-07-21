/* Currency strength meter — relative daily change vs USD axis.
   Data: frankfurter.dev (ECB reference rates, free, no key, CORS *).
   Registers as custom tool id 'fxstrength' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const CURRENCIES = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
  const NAMES = {
    USD: '美元', EUR: '欧元', GBP: '英镑', JPY: '日元',
    AUD: '澳元', CAD: '加元', CHF: '瑞郎', NZD: '纽元',
  };
  const REFRESH_MS = 300000; // 300s 轮询
  const RANGE_DAYS = 8; // 近 8 日区间，保证覆盖最近两个交易日

  function injectStyle() {
    if (document.getElementById('fxs-style')) return;
    const style = document.createElement('style');
    style.id = 'fxs-style';
    style.textContent = `
.fxs-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.fxs-badge {
  font-size: 9px;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hairline);
  color: var(--text-muted);
}
.fxs-badge strong { font-family: var(--font-mono); margin-left: 4px; }
.fxs-badge.strong { color: var(--up); border-color: var(--up); }
.fxs-badge.weak { color: var(--down); border-color: var(--down); }
.fxs-rows { display: flex; flex-direction: column; gap: 7px; }
.fxs-row { display: flex; align-items: center; gap: 8px; }
.fxs-cur {
  width: 74px;
  flex: none;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.fxs-cur small { color: var(--text-dim); font-weight: 400; margin-left: 5px; font-size: 9px; }
.fxs-track {
  position: relative;
  flex: 1;
  height: 12px;
  background: color-mix(in srgb, var(--text) 5%, transparent);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.fxs-track::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--hairline-strong);
}
.fxs-bar { position: absolute; top: 2px; bottom: 2px; border-radius: var(--radius-sm); }
.fxs-bar.up { background: var(--up); left: 50%; }
.fxs-bar.down { background: var(--down); right: 50%; }
.fxs-val {
  width: 76px;
  flex: none;
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
}
.fxs-foot {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}
`;
    document.head.appendChild(style);
  }

  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`;

  const fmtTime = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  // 8 天前日期，YYYY-MM-DD（本地时区即可，服务端按日期对齐）
  function startDate() {
    const d = new Date(Date.now() - RANGE_DAYS * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  window.GT_EXTRA_TOOLS['fxstrength'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool fxs-root">
          <div class="fxs-badges">
            <span class="fxs-badge strong">最强<strong data-strong>—</strong></span>
            <span class="fxs-badge weak">最弱<strong data-weak>—</strong></span>
          </div>
          <div class="fxs-rows" data-rows>
            <div class="tool-hint">加载中…</div>
          </div>
          <div class="fxs-foot">
            <span>基于 ECB 日频参考汇率 · 相对强弱</span>
            <span data-updated>更新 —</span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const rowsEl = el.querySelector('[data-rows]');
      const hintEl = el.querySelector('[data-hint]');
      const strongEl = el.querySelector('[data-strong]');
      const weakEl = el.querySelector('[data-weak]');
      const updatedEl = el.querySelector('[data-updated]');

      let alive = true;
      let controller = null;

      const showError = (msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
        setStatus('offline');
      };
      const clearError = () => {
        hintEl.style.display = 'none';
        setStatus('online');
      };

      const render = (list) => {
        const maxAbs = Math.max(...list.map((x) => Math.abs(x.chg)), 1e-9);
        rowsEl.innerHTML = list
          .map((x) => {
            const w = (Math.abs(x.chg) / maxAbs) * 50; // 归一化：半轨 50%
            const up = x.chg >= 0;
            return `
            <div class="fxs-row">
              <span class="fxs-cur">${x.code}<small>${NAMES[x.code] || ''}</small></span>
              <div class="fxs-track">
                <span class="fxs-bar ${up ? 'up' : 'down'}" style="width:${w.toFixed(2)}%"></span>
              </div>
              <span class="fxs-val ${up ? 'pos' : 'neg'}">${fmtPct(x.chg)}</span>
            </div>`;
          })
          .join('');
        strongEl.textContent = `${list[0].code} ${fmtPct(list[0].chg)}`;
        weakEl.textContent = `${list[list.length - 1].code} ${fmtPct(list[list.length - 1].chg)}`;
      };

      const load = async () => {
        if (controller) controller.abort();
        controller = new AbortController();
        const url = `https://api.frankfurter.dev/v1/${startDate()}..?base=USD&symbols=${CURRENCIES.join(',')}`;
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`http ${res.status}`);
          const json = await res.json();
          if (!alive) return;
          if (!json || !json.rates || typeof json.rates !== 'object') throw new Error('bad payload');
          const dates = Object.keys(json.rates).sort();
          if (dates.length < 2) throw new Error('not enough data');
          const prev = json.rates[dates[dates.length - 2]];
          const cur = json.rates[dates[dates.length - 1]];
          // rates.X = 每美元兑 X 的数量，X 兑美元日变化% = (prev/cur - 1) * 100
          const others = CURRENCIES.map((code) => {
            const a = Number(prev[code]);
            const b = Number(cur[code]);
            if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) throw new Error(`bad rate ${code}`);
            return { code, chg: (a / b - 1) * 100 };
          });
          // USD 自身 = 其它 7 货币变化均值的相反数
          const mean = others.reduce((s, x) => s + x.chg, 0) / others.length;
          const list = [...others, { code: 'USD', chg: -mean }].sort((a, b) => b.chg - a.chg);
          render(list);
          updatedEl.textContent = `更新 ${fmtTime(new Date())} · 收盘 ${dates[dates.length - 1]}`;
          clearError();
        } catch (e) {
          if (!alive || e.name === 'AbortError') return;
          showError('货币强弱数据加载失败，下一轮自动重试');
        }
      };

      load();
      const timer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        clearInterval(timer);
        if (controller) controller.abort();
      };
    },
  };
})();
