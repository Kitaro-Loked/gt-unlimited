/* 大宗商品行情监控 — 黄金 / 原油 / 铜 / 天然气 / 小麦等
 * 数据来源：
 *   - gold-api.com（免费、公开、CORS 可用）：XAU、XAG、XPT、XPD
 *   - 其它品种使用 TradingView market-quotes 嵌入兜底
 * Registers as custom tool id 'commoditywatch' via window.GT_EXTRA_TOOLS.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const REFRESH_MS = 120000; // 2 分钟刷新
  const FETCH_TIMEOUT_MS = 12000;
  const METALS = [
    { symbol: 'XAU', name: '黄金', unit: 'USD/oz' },
    { symbol: 'XAG', name: '白银', unit: 'USD/oz' },
    { symbol: 'XPT', name: '铂金', unit: 'USD/oz' },
    { symbol: 'XPD', name: '钯金', unit: 'USD/oz' },
  ];

  function injectStyle() {
    if (document.getElementById('cmdty-style')) return;
    const style = document.createElement('style');
    style.id = 'cmdty-style';
    style.textContent = `
.cmdty-root { display: flex; flex-direction: column; height: 100%; }
.cmdty-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.cmdty-status { color: var(--warning); white-space: nowrap; }
.cmdty-status.live { color: var(--acc); }
.cmdty-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.cmdty-card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px;
}
.cmdty-card-name {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.cmdty-card-price {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-bottom: 2px;
}
.cmdty-card-unit {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.cmdty-up { color: var(--up); }
.cmdty-down { color: var(--down); }
.cmdty-flat { color: var(--text-muted); }
.cmdty-embed {
  flex: 1;
  min-height: 160px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}
.cmdty-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 8px;
}
.cmdty-foot a { color: var(--acc); text-decoration: none; }
.cmdty-foot a:hover { text-decoration: underline; }
.cmdty-hint { font-size: 10px; color: var(--text-muted); line-height: 1.5; margin-bottom: 8px; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtPrice = (v) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'cmdty-flat';
    return v > 0 ? 'cmdty-up' : 'cmdty-down';
  };

  window.GT_EXTRA_TOOLS['commoditywatch'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool cmdty-root">
          <div class="cmdty-head">
            <span>大宗商品行情</span>
            <span class="cmdty-status" data-conn>连接中…</span>
          </div>
          <div class="cmdty-hint">贵金属实时报价 + TradingView 能源/农产品行情</div>
          <div class="cmdty-grid" data-grid>
            ${METALS.map((m) => `
              <div class="cmdty-card">
                <div class="cmdty-card-name">${esc(m.name)} ${esc(m.symbol)}</div>
                <div class="cmdty-card-price cmdty-flat" data-price="${esc(m.symbol)}">—</div>
                <div class="cmdty-card-unit">${esc(m.unit)}</div>
              </div>
            `).join('')}
          </div>
          <div class="cmdty-embed" data-embed></div>
          <div class="cmdty-foot">
            <span>来源：gold-api.com / TradingView</span>
            <a href="https://www.tradingview.com/markets/futures/" target="_blank" rel="noopener">更多 →</a>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const embed = el.querySelector('[data-embed]');
      let alive = true;
      let timer = null;

      const showError = () => {
        conn.textContent = '连接失败';
        conn.className = 'cmdty-status';
        setStatus('offline');
      };
      const clearError = () => {
        conn.textContent = '● LIVE';
        conn.className = 'cmdty-status live';
        setStatus('online');
      };

      const load = async () => {
        try {
          const results = await Promise.all(
            METALS.map(async (m) => {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
              try {
                const res = await fetch(`https://api.gold-api.com/spot/${m.symbol}`, {
                  signal: ctrl.signal,
                  cache: 'no-store',
                });
                clearTimeout(t);
                if (!res.ok) return null;
                return await res.json();
              } catch (e) {
                clearTimeout(t);
                return null;
              }
            })
          );
          if (!alive) return;
          let ok = 0;
          results.forEach((data, i) => {
            if (!data || !Number.isFinite(data.price)) return;
            const symbol = METALS[i].symbol;
            const price = data.price;
            const prev = Number(data.open_price || data.prev_close_price || price);
            const chg = prev ? price - prev : 0;
            const pct = prev ? (chg / prev) * 100 : 0;
            const el2 = document.querySelector(`[data-price="${symbol}"]`);
            if (el2) {
              el2.textContent = `${fmtPrice(price)} ${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
              el2.className = `cmdty-card-price ${dirClass(chg)}`;
            }
            ok++;
          });
          if (ok) clearError();
          else showError();
        } catch (e) {
          if (!alive) return;
          showError();
        }
      };

      // TradingView market quotes embed for energy/agriculture
      if (embed && typeof TradingView !== 'undefined') {
        try {
          const widget = document.createElement('div');
          widget.className = 'tradingview-widget-container';
          const inner = document.createElement('div');
          inner.className = 'tradingview-widget-container__widget';
          widget.appendChild(inner);
          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.async = true;
          script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js';
          script.text = JSON.stringify({
            width: '100%',
            height: '100%',
            symbolsGroups: [
              {
                name: '能源',
                symbols: [
                  { name: 'TVC:USOIL', displayName: 'WTI原油' },
                  { name: 'TVC:UKOIL', displayName: '布伦特原油' },
                  { name: 'TVC:NATGAS', displayName: '天然气' },
                ],
              },
              {
                name: '农产品',
                symbols: [
                  { name: 'CBOT:ZC1!', displayName: '玉米' },
                  { name: 'CBOT:ZW1!', displayName: '小麦' },
                  { name: 'ICE:KC1!', displayName: '咖啡' },
                ],
              },
            ],
            showSymbolLogo: true,
            isTransparent: true,
            colorTheme: (document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white')) ? 'light' : 'dark',
            locale: 'zh_CN',
          });
          embed.innerHTML = '';
          embed.appendChild(widget);
          widget.appendChild(script);
        } catch (e) { /* noop */ }
      } else if (embed) {
        embed.innerHTML = '<div style="padding:12px;font-size:10px;color:var(--text-muted)">TradingView 脚本未加载</div>';
      }

      load();
      timer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        if (timer) clearInterval(timer);
      };
    },
  };
})();
