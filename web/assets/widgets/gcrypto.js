// Crypto market global overview panel (CoinGecko free public API, no key)
// Data: /api/v3/global + /api/v3/search/trending, refreshed every 120s
(function () {
  'use strict';

  const API_GLOBAL = 'https://api.coingecko.com/api/v3/global';
  const API_TRENDING = 'https://api.coingecko.com/api/v3/search/trending';
  const REFRESH_MS = 120 * 1000;

  const css = `
    .gcg-wrap { display: flex; flex-direction: column; gap: 10px; }
    .gcg-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .gcg-stat {
      border: 1px solid var(--hairline); border-radius: var(--radius-sm);
      padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
      min-width: 0;
    }
    .gcg-stat-label { font-family: var(--font-sans); font-size: 10px; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; }
    .gcg-stat-value {
      font-family: var(--font-mono); font-size: 20px; font-weight: 600;
      color: var(--acc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .gcg-dom-head { display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 10px; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; }
    .gcg-dom-bar {
      display: flex; height: 10px; border-radius: 999px; overflow: hidden;
      border: 1px solid var(--hairline);
    }
    .gcg-dom-seg { height: 100%; transition: width 0.5s var(--ease-fluid); }
    .gcg-dom-seg.btc { background: var(--warning); }
    .gcg-dom-seg.eth { background: var(--info); }
    .gcg-dom-seg.other { background: var(--hairline-strong); }
    .gcg-dom-legend { display: flex; gap: 14px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .gcg-dom-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
    .gcg-dom-legend b { color: var(--text); font-weight: 600; }
    .gcg-list { display: flex; flex-direction: column; }
    .gcg-row {
      display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 8px;
      padding: 7px 2px; border-bottom: 1px solid var(--hairline); font-size: 12px;
    }
    .gcg-row:last-child { border-bottom: none; }
    .gcg-rank { font-family: var(--font-mono); color: var(--text-muted); font-size: 11px; }
    .gcg-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gcg-name i { color: var(--text-muted); font-style: normal; font-family: var(--font-mono); font-size: 10px; margin-left: 6px; text-transform: uppercase; }
    .gcg-chg { font-family: var(--font-mono); font-size: 12px; }
    .gcg-foot { font-family: var(--font-sans); font-size: 10px; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; }
  `;

  const fmtCap = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—');

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};
  window.GT_EXTRA_TOOLS['gcrypto'] = {
    mount(el, setStatus) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);

      el.innerHTML = '<div class="gcg-wrap"><div class="tool-hint">加载中…</div></div>';
      const wrap = el.querySelector('.gcg-wrap');
      const ctl = new AbortController();

      const render = (global, trending) => {
        const d = global && global.data ? global.data : {};
        const mcap = d.total_market_cap ? d.total_market_cap.usd : NaN;
        const vol = d.total_volume ? d.total_volume.usd : NaN;
        const chg = d.market_cap_change_percentage_24h_usd;
        const dom = d.market_cap_percentage || {};
        const btc = Number.isFinite(dom.btc) ? dom.btc : 0;
        const eth = Number.isFinite(dom.eth) ? dom.eth : 0;
        const other = Math.max(0, 100 - btc - eth);
        const coins = (trending && Array.isArray(trending.coins) ? trending.coins : []).slice(0, 7);

        wrap.innerHTML = `
          <div class="gcg-stats">
            <div class="gcg-stat">
              <span class="gcg-stat-label">全球总市值</span>
              <span class="gcg-stat-value">${fmtCap(mcap)}</span>
            </div>
            <div class="gcg-stat">
              <span class="gcg-stat-label">24H 成交量</span>
              <span class="gcg-stat-value">${fmtCap(vol)}</span>
            </div>
            <div class="gcg-stat">
              <span class="gcg-stat-label">24H 市值变化</span>
              <span class="gcg-stat-value ${chg >= 0 ? 'pos' : 'neg'}">${fmtPct(chg)}</span>
            </div>
          </div>
          <div class="gcg-dom-head"><span>市值占比</span><span>BTC.D</span></div>
          <div class="gcg-dom-bar">
            <div class="gcg-dom-seg btc" style="width:${btc.toFixed(2)}%"></div>
            <div class="gcg-dom-seg eth" style="width:${eth.toFixed(2)}%"></div>
            <div class="gcg-dom-seg other" style="width:${other.toFixed(2)}%"></div>
          </div>
          <div class="gcg-dom-legend">
            <span><i style="background:var(--warning)"></i>BTC <b>${btc.toFixed(1)}%</b></span>
            <span><i style="background:var(--info)"></i>ETH <b>${eth.toFixed(1)}%</b></span>
            <span><i style="background:var(--hairline-strong)"></i>其它 <b>${other.toFixed(1)}%</b></span>
          </div>
          <div class="gcg-dom-head"><span>热门搜索 · TRENDING</span></div>
          <div class="gcg-list">
            ${coins
              .map((c, i) => {
                const item = c.item || {};
                const pct = item.data && item.data.price_change_percentage_24h ? item.data.price_change_percentage_24h.usd : null;
                const pctHtml = Number.isFinite(pct)
                  ? `<span class="gcg-chg ${pct >= 0 ? 'pos' : 'neg'}">${fmtPct(pct)}</span>`
                  : '<span class="gcg-chg" style="color:var(--text-muted)">—</span>';
                return `
                <div class="gcg-row">
                  <span class="gcg-rank">#${item.market_cap_rank || i + 1}</span>
                  <span class="gcg-name">${esc(item.name)}<i>${esc(item.symbol)}</i></span>
                  ${pctHtml}
                </div>`;
              })
              .join('')}
          </div>
          <div class="gcg-foot">COINGECKO · ${Number.isFinite(d.active_cryptocurrencies) ? d.active_cryptocurrencies.toLocaleString('en-US') + ' 种加密货币 · ' : ''}120S 刷新</div>`;
      };

      const load = async () => {
        try {
          const [gRes, tRes] = await Promise.all([
            fetch(API_GLOBAL, { signal: ctl.signal }),
            fetch(API_TRENDING, { signal: ctl.signal }),
          ]);
          if (!gRes.ok || !tRes.ok) throw new Error(`HTTP ${gRes.status}/${tRes.status}`);
          const [gJson, tJson] = await Promise.all([gRes.json(), tRes.json()]);
          render(gJson, tJson);
          setStatus('online');
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          wrap.innerHTML = '<div class="tool-hint">数据加载失败（可能触发 CoinGecko 限流），稍后自动重试</div>';
          setStatus('offline');
        }
      };

      load();
      const timer = setInterval(load, REFRESH_MS);
      return () => {
        clearInterval(timer);
        ctl.abort();
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    },
  };
})();
