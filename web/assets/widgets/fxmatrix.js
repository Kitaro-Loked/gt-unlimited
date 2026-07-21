/* 外汇交叉矩阵 (FX_MATRIX)
 * 展示 USD/EUR/GBP/JPY/AUD/CAD/CHF/NZD/CNH 九大主要货币之间的交叉汇率，
 * 并估算相对上一交易日的日涨跌幅度。
 *
 * 数据来源：
 *   1. https://api.frankfurter.dev/v1/.. (欧洲央行日频参考汇率，免费、公开、默认 CORS)
 *   2. 若客户端直连被拦截，则经 /api/proxy?url=... 转发
 *   3. 若 API 仍不可用，回退到 TradingView forex-cross-rates 嵌入组件
 *
 * 注意：
 *   - frankfurter 不提供 CNH，CNH 列在缺少官方数据时会以 CNY 近似替代。
 *   - 日涨跌由最近两个可用交易日收盘价估算，并非实时盘口报价，仅供快速参考。
 *   - 点击非对角线单元格会派发 gt:set-symbol 事件，将主图切到对应 FX:BASEQUOTE。
 *
 * Registers as custom tool id 'fxmatrix' via window.GT_EXTRA_TOOLS.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNH'];
  const API_SYMBOLS = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY']; // CNY 作为 CNH 兜底

  const NAMES = {
    USD: '美元',
    EUR: '欧元',
    GBP: '英镑',
    JPY: '日元',
    AUD: '澳元',
    CAD: '加元',
    CHF: '瑞郎',
    NZD: '纽元',
    CNH: '离岸人民币',
  };

  const TV_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];
  const API_BASE = 'https://api.frankfurter.dev/v1';
  const REFRESH_MS = 300000; // 5 分钟
  const RANGE_DAYS = 8;      // 保证覆盖周末/假期，取到最后两个交易日
  const FETCH_TIMEOUT_MS = 12000;

  function injectStyle() {
    if (document.getElementById('fxm-style')) return;
    const style = document.createElement('style');
    style.id = 'fxm-style';
    style.textContent = `
.fxm-root {
  height: 100%;
  min-height: 0;
}
.fxm-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.fxm-head b { font-weight: 400; font-family: var(--font-mono); color: var(--text); }
.fxm-status { color: var(--warning); white-space: nowrap; }
.fxm-status.live { color: var(--acc); }
.fxm-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.fxm-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-family: var(--font-mono);
  font-size: 10px;
}
.fxm-table th,
.fxm-table td {
  border: 1px solid var(--hairline);
  text-align: center;
  vertical-align: middle;
  padding: 4px 2px;
  white-space: nowrap;
}
.fxm-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-raised);
  color: var(--text-muted);
  font-weight: 600;
  letter-spacing: 0.06em;
}
.fxm-table thead th:first-child {
  left: 0;
  z-index: 3;
}
.fxm-table tbody th {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface-raised);
  color: var(--text);
  font-weight: 600;
}
.fxm-table tbody th small {
  display: block;
  color: var(--text-dim);
  font-weight: 400;
  font-size: 9px;
  margin-top: 1px;
}
.fxm-cell {
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.fxm-cell:hover {
  background: color-mix(in srgb, var(--acc) 8%, transparent);
  border-color: var(--acc-dim);
}
.fxm-cell.diag {
  background: color-mix(in srgb, var(--text) 5%, transparent);
  cursor: default;
}
.fxm-rate {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 11px;
  line-height: 1.2;
}
.fxm-chg {
  font-variant-numeric: tabular-nums;
  font-size: 9px;
  line-height: 1.2;
  margin-top: 2px;
}
.fxm-up { color: var(--up); }
.fxm-down { color: var(--down); }
.fxm-flat { color: var(--text-muted); }
.fxm-empty { color: var(--text-dim); }
.fxm-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
}
.fxm-foot a { color: var(--acc); text-decoration: none; }
.fxm-foot a:hover { text-decoration: underline; }
.fxm-embed-wrap {
  flex: 1;
  min-height: 0;
  height: 100%;
}
.fxm-embed-wrap .tradingview-widget-container,
.fxm-embed-wrap .tradingview-widget-container__widget {
  height: 100%;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtDate = (d) => d.toISOString().slice(0, 10);

  const fmtRate = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1000) return v.toFixed(0);
    if (v >= 100) return v.toFixed(1);
    if (v >= 10) return v.toFixed(2);
    if (v >= 1) return v.toFixed(4);
    return v.toFixed(5);
  };

  const fmtChg = (v) => {
    if (!Number.isFinite(v)) return '';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  };

  const proxyUrl = (target) => `/api/proxy?url=${encodeURIComponent(target)}`;

  async function fetchJson(url, signal) {
    const errors = [];
    for (const target of [url, proxyUrl(url)]) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const res = await fetch(target, { signal, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json || typeof json !== 'object') throw new Error('bad payload');
        return json;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        errors.push(String(e.message || e));
      }
    }
    throw new Error(errors.join(' / '));
  }

  function tvTheme() {
    if (document.body && (document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white'))) {
      return 'light';
    }
    return 'dark';
  }

  function extractRates(raw) {
    const out = { USD: 1 };
    CURRENCIES.forEach((code) => {
      if (code === 'USD') return;
      let v = raw && raw[code];
      if (code === 'CNH' && (v == null || !Number.isFinite(Number(v)))) {
        v = raw && raw.CNY;
      }
      const n = Number(v);
      out[code] = Number.isFinite(n) && n > 0 ? n : null;
    });
    return out;
  }

  function buildMatrix(prevRates, curRates) {
    const p = extractRates(prevRates);
    const c = extractRates(curRates);
    const rows = [];
    CURRENCIES.forEach((base) => {
      const row = { base, cells: [] };
      CURRENCIES.forEach((quote) => {
        if (base === quote) {
          row.cells.push({ base, quote, rate: 1, chg: 0, diag: true });
          return;
        }
        if (c[base] == null || c[quote] == null || p[base] == null || p[quote] == null) {
          row.cells.push({ base, quote, rate: null, chg: null, diag: false });
          return;
        }
        const rate = c[quote] / c[base];
        const prevRate = p[quote] / p[base];
        const chg = prevRate > 0 ? (rate / prevRate - 1) * 100 : 0;
        row.cells.push({ base, quote, rate, chg, diag: false });
      });
      rows.push(row);
    });
    return rows;
  }

  function renderEmbed(container) {
    container.innerHTML = `
      <div class="fxm-embed-wrap" data-embed-wrap>
        <div class="tool-hint">API 数据不可用，已切换 TradingView 外汇交叉盘组件</div>
      </div>`;
    const wrap = container.querySelector('[data-embed-wrap]');
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container';
    widget.style.height = '100%';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    widget.appendChild(inner);
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-forex-cross-rates.js';
    script.text = JSON.stringify({
      width: '100%',
      height: '100%',
      currencies: TV_CURRENCIES,
      isTransparent: true,
      colorTheme: tvTheme(),
      locale: 'zh_CN',
      largeChartUrl: '',
    });
    widget.appendChild(script);
    wrap.appendChild(widget);
  }

  window.GT_EXTRA_TOOLS['fxmatrix'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool fxm-root">
          <div class="fxm-head">
            <span>外汇交叉矩阵 · <b>FX:BASEQUOTE</b></span>
            <span class="fxm-status" data-conn>连接中…</span>
          </div>
          <div class="fxm-wrap" data-table-wrap>
            <table class="fxm-table">
              <thead data-head></thead>
              <tbody data-body></tbody>
            </table>
          </div>
          <div class="fxm-foot">
            <span data-src>来源：frankfurter.dev (ECB)</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const head = el.querySelector('[data-head]');
      const body = el.querySelector('[data-body]');
      const hint = el.querySelector('[data-hint]');
      const wrap = el.querySelector('[data-table-wrap]');

      let alive = true;
      let controller = null;
      let timer = null;
      let timeouts = [];
      const listeners = [];

      const on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        listeners.push([target, type, fn, opts]);
      };

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'fxm-status';
        setStatus('offline');
      };

      const showHint = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
      };

      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'fxm-status live';
        setStatus('online');
      };

      const resetTable = () => {
        if (!wrap.querySelector('.fxm-table')) {
          wrap.innerHTML = '<table class="fxm-table"><thead data-head></thead><tbody data-body></tbody></table>';
        }
      };

      const renderHeader = (h) => {
        h.innerHTML = `
          <tr>
            <th>基础＼报价</th>
            ${CURRENCIES.map((c) => `<th>${esc(c)}<br><small>${esc(NAMES[c] || '')}</small></th>`).join('')}
          </tr>`;
      };

      const render = (matrix, curDate, prevDate, proxyUsed) => {
        resetTable();
        const headEl = wrap.querySelector('[data-head]');
        const bodyEl = wrap.querySelector('[data-body]');
        if (!headEl || !bodyEl) return;
        renderHeader(headEl);
        bodyEl.innerHTML = matrix
          .map((row) => {
            return `
              <tr>
                <th>${esc(row.base)}<small>${esc(NAMES[row.base] || '')}</small></th>
                ${row.cells
                  .map((cell) => {
                    if (cell.diag) {
                      return `<td class="fxm-cell diag"><span class="fxm-rate fxm-flat">1.0000</span></td>`;
                    }
                    if (cell.rate == null) {
                      return `<td class="fxm-empty">—</td>`;
                    }
                    const cls = cell.chg > 0 ? 'fxm-up' : cell.chg < 0 ? 'fxm-down' : 'fxm-flat';
                    return `<td class="fxm-cell" data-base="${esc(cell.base)}" data-quote="${esc(cell.quote)}">
                      <div class="fxm-rate ${cls}">${esc(fmtRate(cell.rate))}</div>
                      <div class="fxm-chg ${cls}">${esc(fmtChg(cell.chg))}</div>
                    </td>`;
                  })
                  .join('')}
              </tr>`;
          })
          .join('');

        timeEl.textContent = `${curDate} · 较 ${prevDate}`;
        srcEl.innerHTML = proxyUsed
          ? '来源：frankfurter.dev (ECB) · 经代理'
          : '来源：frankfurter.dev (ECB)';
        clearError();
      };

      const onCellClick = (ev) => {
        const cell = ev.target.closest('.fxm-cell[data-base]');
        if (!cell) return;
        const base = cell.getAttribute('data-base');
        const quote = cell.getAttribute('data-quote');
        if (!base || !quote || base === quote) return;
        window.dispatchEvent(
          new CustomEvent('gt:set-symbol', {
            detail: { tv: `FX:${base}${quote}` },
          })
        );
      };

      on(wrap, 'click', onCellClick);

      const load = async () => {
        if (!alive) return;
        if (controller) {
          try { controller.abort(); } catch (e) { /* noop */ }
        }
        controller = new AbortController();
        const abortTimer = setTimeout(() => {
          if (controller) controller.abort();
        }, FETCH_TIMEOUT_MS);
        timeouts.push(abortTimer);

        try {
          const end = new Date();
          const start = new Date(end.getTime() - RANGE_DAYS * 86400000);
          const symbols = API_SYMBOLS.join(',');
          const url = `${API_BASE}/${fmtDate(start)}..${fmtDate(end)}?base=USD&symbols=${symbols}`;
          const json = await fetchJson(url, controller.signal);
          if (!alive) return;
          if (!json.rates || typeof json.rates !== 'object') throw new Error('bad rates payload');
          const dates = Object.keys(json.rates).sort();
          if (dates.length < 2) throw new Error('insufficient history');
          const prevDate = dates[dates.length - 2];
          const curDate = dates[dates.length - 1];
          const matrix = buildMatrix(json.rates[prevDate], json.rates[curDate]);
          render(matrix, curDate, prevDate, false);
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          // 尝试纯代理模式兜底（直接请求失败且 fetchJson 内部已尝试代理时仍可能失败）
          try {
            const end = new Date();
            const start = new Date(end.getTime() - RANGE_DAYS * 86400000);
            const symbols = API_SYMBOLS.join(',');
            const url = `${API_BASE}/${fmtDate(start)}..${fmtDate(end)}?base=USD&symbols=${symbols}`;
            const res = await fetch(proxyUrl(url), { cache: 'no-store' });
            if (res.ok) {
              const json = await res.json();
              if (json && json.rates && typeof json.rates === 'object') {
                const dates = Object.keys(json.rates).sort();
                if (dates.length >= 2) {
                  const prevDate = dates[dates.length - 2];
                  const curDate = dates[dates.length - 1];
                  const matrix = buildMatrix(json.rates[prevDate], json.rates[curDate]);
                  render(matrix, curDate, prevDate, true);
                  return;
                }
              }
            }
          } catch (e2) { /* ignore, fall through to embed */ }
          if (!alive) return;
          renderEmbed(wrap);
          conn.textContent = '● LIVE';
          conn.className = 'fxm-status live';
          setStatus('online');
          showHint('免费 API 暂不可用，已切换 TradingView 嵌入组件');
        } finally {
          clearTimeout(abortTimer);
          timeouts = timeouts.filter((t) => t !== abortTimer);
          controller = null;
        }
      };

      setStatus('loading');
      load();
      timer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        timeouts.forEach((t) => clearTimeout(t));
        timeouts = [];
        if (controller) {
          try { controller.abort(); } catch (e) { /* noop */ }
          controller = null;
        }
        listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
        listeners.length = 0;
      };
    },
  };
})();
