/* AGRI_PRO · 农产品专业版
 * 综合 CBOT 谷物、ICE 软商品、CME 畜牧等八大农产品期货主力合约实时行情，
 * 以终端表格 + 独立卡片 + 日涨跌条形图呈现。
 *
 * 数据来源：
 *   - TradingView scanner (https://scanner.tradingview.com/symbol)
 *     免费、公开、无需 API key，返回 close / open / change / change_abs
 *   - 若客户端直连被 CORS 拦截，自动经 /api/proxy?url=... 转发
 *
 * 注册工具：window.GT_EXTRA_TOOLS['agripro']
 */
(function () {
  'use strict';

  const TV_API = 'https://scanner.tradingview.com/symbol';
  const REFRESH_MS = 30000;
  const FETCH_TIMEOUT_MS = 12000;

  const AGRIS = [
    { key: 'zc', name: '玉米', exchange: 'CBOT', symbol: 'ZC1!', unit: 'USD/bu', dec: 2, group: 'grain' },
    { key: 'zw', name: '小麦', exchange: 'CBOT', symbol: 'ZW1!', unit: 'USD/bu', dec: 2, group: 'grain' },
    { key: 'zs', name: '大豆', exchange: 'CBOT', symbol: 'ZS1!', unit: 'USD/bu', dec: 2, group: 'grain' },
    { key: 'kc', name: '咖啡', exchange: 'ICEUS', symbol: 'KC1!', unit: 'USD/lb', dec: 2, group: 'soft' },
    { key: 'sb', name: '糖', exchange: 'ICEUS', symbol: 'SB1!', unit: 'USD/lb', dec: 2, group: 'soft' },
    { key: 'ct', name: '棉花', exchange: 'ICEUS', symbol: 'CT1!', unit: 'USD/lb', dec: 2, group: 'soft' },
    { key: 'le', name: '活牛', exchange: 'CME', symbol: 'LE1!', unit: 'USD/lb', dec: 3, group: 'livestock' },
    { key: 'he', name: '瘦肉猪', exchange: 'CME', symbol: 'HE1!', unit: 'USD/lb', dec: 3, group: 'livestock' },
  ];

  const TABS = [
    { id: 'all', label: '全部' },
    { id: 'grain', label: '谷物' },
    { id: 'soft', label: '软商品' },
    { id: 'livestock', label: '畜牧' },
  ];

  function injectStyle() {
    if (document.getElementById('agp-style')) return;
    const style = document.createElement('style');
    style.id = 'agp-style';
    style.textContent = `
      .agp-root { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 8px; }
      .agp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .agp-title { font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.15em; color: var(--text-dim); text-transform: uppercase; }
      .agp-status { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; }
      .agp-status.online { color: var(--up); }
      .agp-status.offline { color: var(--down); }
      .agp-tabs { display: flex; gap: 4px; }
      .agp-tab { background: var(--surface); border: 1px solid var(--hairline); color: var(--text-muted); font-family: var(--font-sans); font-size: 10px; padding: 3px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: all .15s ease; }
      .agp-tab:hover { border-color: var(--acc); color: var(--text); }
      .agp-tab.active { background: var(--acc); border-color: var(--acc); color: var(--bg); font-weight: 600; }
      .agp-scroll { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface); }
      .agp-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 11px; }
      .agp-table th, .agp-table td { border-bottom: 1px solid var(--hairline); padding: 8px 10px; text-align: right; white-space: nowrap; }
      .agp-table th { position: sticky; top: 0; background: var(--surface-raised); color: var(--text-muted); font-weight: 600; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; }
      .agp-table th:first-child, .agp-table td:first-child { text-align: left; }
      .agp-name { font-family: var(--font-sans); font-weight: 600; font-size: 12px; }
      .agp-name small { display: block; font-size: 9px; color: var(--text-dim); font-weight: 400; margin-top: 1px; letter-spacing: 0.04em; }
      .agp-price { font-weight: 700; font-variant-numeric: tabular-nums; }
      .agp-chg { font-size: 10px; font-variant-numeric: tabular-nums; }
      .agp-empty { color: var(--text-dim); }
      .agp-cards { display: none; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; padding: 8px; }
      .agp-card { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 10px; display: flex; flex-direction: column; gap: 4px; }
      .agp-card-name { font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--text); }
      .agp-card-name small { display: block; font-size: 9px; color: var(--text-dim); font-weight: 400; }
      .agp-card-price { font-family: var(--font-mono); font-size: 14px; font-weight: 700; }
      .agp-card-chg { font-family: var(--font-mono); font-size: 10px; }
      .agp-chart-wrap { padding: 10px; border-top: 1px solid var(--hairline); }
      .agp-chart-title { font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.12em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
      .agp-bar-chart { width: 100%; height: 120px; }
      .agp-bar { transition: y .4s ease, height .4s ease, fill .4s ease; }
      .agp-axis { stroke: var(--hairline); stroke-width: 1; }
      .agp-axis text { fill: var(--text-dim); font-family: var(--font-mono); font-size: 9px; }
      .agp-zero { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3,3; }
      .agp-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 9px; color: var(--text-dim); letter-spacing: 0.04em; flex-wrap: wrap; }
      .agp-foot b { color: var(--text-muted); font-weight: 400; }
      .agp-hint { display: none; padding: 8px; font-size: 11px; color: var(--text-muted); }
      @media (max-width: 420px) {
        .agp-table { display: none; }
        .agp-cards { display: grid; }
      }
    `;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtPrice = (v, dec) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };

  const fmtChg = (v) => {
    if (!Number.isFinite(v)) return '—';
    const up = v >= 0;
    return `<span class="${up ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${v.toFixed(2)}%</span>`;
  };

  const fmtAbs = (v) => {
    if (!Number.isFinite(v)) return '—';
    const up = v >= 0;
    return `<span class="${up ? 'pos' : 'neg'}">${up ? '+' : ''}${v.toFixed(v >= 100 || v <= -100 ? 1 : 2)}</span>`;
  };

  const proxyUrl = (target) => `/api/proxy?url=${encodeURIComponent(target)}`;

  async function fetchSymbol(symbol) {
    const url = `${TV_API}?symbol=${encodeURIComponent(symbol)}&fields=close,open,change,change_abs`;
    const errors = [];
    const targets = [url, proxyUrl(url)];
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(target, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json || typeof json.close !== 'number' || !Number.isFinite(json.close)) throw new Error('bad payload');
        return {
          price: json.close,
          open: Number.isFinite(json.open) ? json.open : null,
          change: Number.isFinite(json.change) ? json.change : null,
          changeAbs: Number.isFinite(json.change_abs) ? json.change_abs : null,
          proxy: i === 1,
        };
      } catch (e) {
        clearTimeout(t);
        errors.push(String(e.message || e));
      }
    }
    throw new Error(errors.join(' / '));
  }

  function renderBarChart(svg, data) {
    const width = svg.clientWidth || 320;
    const height = 120;
    const pad = { top: 6, right: 10, bottom: 28, left: 34 };
    const innerW = Math.max(40, width - pad.left - pad.right);
    const innerH = height - pad.top - pad.bottom;

    const values = data.map((d) => d.pct).filter(Number.isFinite);
    const maxV = values.length ? Math.max(...values.map(Math.abs), 0.15) : 1;
    const yScale = (v) => (innerH / 2) - (v / maxV) * (innerH / 2);

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = '';

    const zeroY = pad.top + innerH / 2;
    const zero = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    zero.setAttribute('x1', pad.left);
    zero.setAttribute('x2', pad.left + innerW);
    zero.setAttribute('y1', zeroY);
    zero.setAttribute('y2', zeroY);
    zero.setAttribute('class', 'agp-zero');
    svg.appendChild(zero);

    [-maxV, -maxV / 2, 0, maxV / 2, maxV].forEach((v) => {
      const y = pad.top + yScale(v);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pad.left - 6);
      text.setAttribute('y', y + 3);
      text.setAttribute('text-anchor', 'end');
      text.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
      svg.appendChild(text);
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('x1', pad.left - 3);
      tick.setAttribute('x2', pad.left);
      tick.setAttribute('y1', y);
      tick.setAttribute('y2', y);
      tick.setAttribute('class', 'agp-axis');
      svg.appendChild(tick);
    });

    const n = data.length || 1;
    const barW = Math.max(12, (innerW / n) * 0.55);
    const step = innerW / n;

    data.forEach((d, i) => {
      const x = pad.left + i * step + (step - barW) / 2;
      const pct = Number.isFinite(d.pct) ? d.pct : 0;
      const barH = Math.abs(yScale(0) - yScale(pct));
      const y = pct >= 0 ? yScale(pct) + pad.top : pad.top + yScale(0);
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', Math.max(1, barH));
      rect.setAttribute('rx', 2);
      rect.setAttribute('class', 'agp-bar');
      rect.setAttribute('fill', pct >= 0 ? 'var(--up)' : 'var(--down)');
      svg.appendChild(rect);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x + barW / 2);
      label.setAttribute('y', height - 6);
      label.setAttribute('text-anchor', 'middle');
      label.textContent = d.name;
      svg.appendChild(label);
    });
  }

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};
  window.GT_EXTRA_TOOLS['agripro'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool agp-root">
          <div class="agp-head">
            <span class="agp-title">AGRI_PRO · 农产品专业版</span>
            <div class="agp-tabs" data-tabs>
              ${TABS.map((t) => `<button class="agp-tab${t.id === 'all' ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}
            </div>
          </div>
          <div class="agp-scroll">
            <table class="agp-table">
              <thead>
                <tr>
                  <th>品种</th>
                  <th>价格</th>
                  <th>涨跌额</th>
                  <th>涨跌幅</th>
                </tr>
              </thead>
              <tbody data-body>
                ${AGRIS.map((m) => `
                  <tr data-row="${esc(m.key)}" data-group="${esc(m.group)}">
                    <td><span class="agp-name">${esc(m.name)}<small>${esc(m.exchange)}:${esc(m.symbol)} · ${esc(m.unit)}</small></span></td>
                    <td class="agp-price" data-price>—</td>
                    <td class="agp-chg" data-abs>—</td>
                    <td class="agp-chg" data-pct>—</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div class="agp-cards" data-cards>
              ${AGRIS.map((m) => `
                <div class="agp-card" data-card="${esc(m.key)}" data-group="${esc(m.group)}">
                  <span class="agp-card-name">${esc(m.name)}<small>${esc(m.exchange)}:${esc(m.symbol)}</small></span>
                  <span class="agp-card-price" data-price>—</span>
                  <span class="agp-card-chg" data-chg>—</span>
                </div>
              `).join('')}
            </div>
            <div class="agp-chart-wrap">
              <div class="agp-chart-title">日涨跌分布 · DAILY CHANGE</div>
              <svg class="agp-bar-chart" data-chart></svg>
            </div>
          </div>
          <div class="agp-foot">
            <span data-src>来源：TradingView Scanner</span>
            <span>更新 <b data-time>—</b> · <span class="agp-status" data-status>连接中…</span></span>
          </div>
          <div class="agp-hint" data-hint></div>
        </div>`;

      const statusEl = el.querySelector('[data-status]');
      const timeEl = el.querySelector('[data-time]');
      const srcEl = el.querySelector('[data-src]');
      const hintEl = el.querySelector('[data-hint]');
      const chartSvg = el.querySelector('[data-chart]');
      const rows = {};
      const cards = {};
      AGRIS.forEach((m) => {
        rows[m.key] = {
          row: el.querySelector(`[data-row="${m.key}"]`),
          price: el.querySelector(`[data-row="${m.key}"] [data-price]`),
          abs: el.querySelector(`[data-row="${m.key}"] [data-abs]`),
          pct: el.querySelector(`[data-row="${m.key}"] [data-pct]`),
        };
        cards[m.key] = {
          card: el.querySelector(`[data-card="${m.key}"]`),
          price: el.querySelector(`[data-card="${m.key}"] [data-price]`),
          chg: el.querySelector(`[data-card="${m.key}"] [data-chg]`),
        };
      });

      let alive = true;
      let timer = null;
      let currentTab = 'all';

      const applyFilter = () => {
        AGRIS.forEach((m) => {
          const show = currentTab === 'all' || m.group === currentTab;
          if (rows[m.key].row) rows[m.key].row.style.display = show ? '' : 'none';
          if (cards[m.key].card) cards[m.key].card.style.display = show ? '' : 'none';
        });
      };

      el.querySelector('[data-tabs]').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        currentTab = btn.getAttribute('data-tab');
        el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === currentTab));
        applyFilter();
      });

      const showHint = (msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const hideHint = () => {
        hintEl.style.display = 'none';
      };

      const updateStatus = (online, text) => {
        statusEl.textContent = text;
        statusEl.className = `agp-status ${online ? 'online' : 'offline'}`;
        setStatus(online ? 'online' : 'offline');
      };

      const load = async () => {
        if (!alive) return;
        const results = await Promise.all(
          AGRIS.map(async (m) => {
            try {
              const d = await fetchSymbol(`${m.exchange}:${m.symbol}`);
              return { m, d, ok: true };
            } catch (e) {
              return { m, d: null, ok: false, err: e.message };
            }
          })
        );
        if (!alive) return;

        const chartData = [];
        let okCount = 0;
        let proxyUsed = false;

        results.forEach(({ m, d, ok }) => {
          const r = rows[m.key];
          const c = cards[m.key];
          if (!ok || !d) {
            r.price.innerHTML = '<span class="agp-empty">—</span>';
            r.abs.innerHTML = '<span class="agp-empty">—</span>';
            r.pct.innerHTML = '<span class="agp-empty">—</span>';
            c.price.innerHTML = '<span class="agp-empty">—</span>';
            c.chg.innerHTML = '<span class="agp-empty">—</span>';
            chartData.push({ key: m.key, name: m.name, pct: null });
            return;
          }
          okCount += 1;
          if (d.proxy) proxyUsed = true;

          const pct = Number.isFinite(d.change) ? d.change : (Number.isFinite(d.open) && d.open > 0 ? ((d.price - d.open) / d.open) * 100 : null);
          const abs = Number.isFinite(d.changeAbs) ? d.changeAbs : (Number.isFinite(d.open) ? d.price - d.open : null);

          r.price.textContent = fmtPrice(d.price, m.dec);
          r.abs.innerHTML = fmtAbs(abs);
          r.pct.innerHTML = fmtChg(pct);

          c.price.textContent = fmtPrice(d.price, m.dec);
          c.chg.innerHTML = fmtChg(pct);

          chartData.push({ key: m.key, name: m.name, pct });
        });

        renderBarChart(chartSvg, chartData);

        if (okCount === AGRIS.length) {
          hideHint();
          updateStatus(true, '● ONLINE');
        } else if (okCount > 0) {
          showHint('部分品种数据不可用，下一轮自动重试');
          updateStatus(true, '● PARTIAL');
        } else {
          showHint('行情数据加载失败，下一轮自动重试');
          updateStatus(false, '● OFFLINE');
        }

        timeEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        srcEl.textContent = proxyUsed ? '来源：TradingView Scanner · 经代理' : '来源：TradingView Scanner';
      };

      setStatus('loading');
      load();
      timer = setInterval(load, REFRESH_MS);

      const onResize = () => {
        const data = AGRIS.map((m) => {
          const pctText = rows[m.key].pct.textContent || '';
          const match = pctText.match(/([+-]?\d+\.?\d*)%/);
          return { key: m.key, name: m.name, pct: match ? parseFloat(match[1]) : null };
        });
        renderBarChart(chartSvg, data);
      };
      window.addEventListener('resize', onResize);

      return () => {
        alive = false;
        if (timer) clearInterval(timer);
        window.removeEventListener('resize', onResize);
      };
    },
  };
})();
