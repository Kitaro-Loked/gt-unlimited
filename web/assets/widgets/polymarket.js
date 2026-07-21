/* Polymarket 预测市场行情板
 * 主源: Polymarket Gamma API (https://gamma-api.polymarket.com/events)
 * 使用公共 REST 端点拉取活跃事件，展示概率、24h 价格变化、成交量/流动性/到期日。
 * 若公共端点不可用（网络/CORS），提示用户前往 polymarket.com。
 * Relayer API ID 通过 query 参数 relayerId 透传，便于后续接入 relayer 专属接口。
 * Registers as custom tool id 'polymarket' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const RELAYER_ID = '019f7efb-1818-7c50-a8f6-82669ba86b47';
  const API_BASE = 'https://gamma-api.polymarket.com';
  const TRADE_BASE = 'https://polymarket.com/event';

  const MAX_EVENTS = 200;        // 最多拉取活跃事件数
  const PAGE_LIMIT = 40;         // 单次分页数（与默认/增量显示保持一致）
  const DEFAULT_DISPLAY = 40;    // 默认显示数量
  const LOAD_MORE_INCREMENT = 40;// 每次加载更多增量
  const REFRESH_MS = 60000;      // 正常刷新间隔
  const FETCH_TIMEOUT_MS = 15000;

  const VIEWS = [
    { key: 'all', label: '全部', type: 'all' },
    { key: 'high_volume', label: '高成交量', type: 'preset', sort: 'volume24hr' },
    { key: 'ending_soon', label: '即将到期', type: 'preset', filter: 'endingSoon', sort: 'endDate' },
    { key: 'politics', label: '政治', type: 'category', cat: 'politics' },
    { key: 'crypto', label: '加密', type: 'category', cat: 'crypto' },
    { key: 'tech_ai', label: '科技/AI', type: 'category', cat: 'tech_ai' },
    { key: 'macro_fed', label: '宏观/美联储', type: 'category', cat: 'macro_fed' },
  ];

  const CATEGORIES = [
    { key: 'politics', label: '政治' },
    { key: 'crypto', label: '加密' },
    { key: 'tech_ai', label: '科技/AI' },
    { key: 'macro_fed', label: '宏观/美联储' },
    { key: 'sports', label: '体育' },
    { key: 'science', label: '科学' },
    { key: 'business', label: '商业' },
    { key: 'other', label: '其他' },
  ];

  const SORTS = [
    { key: 'volume', label: '总成交' },
    { key: 'volume24hr', label: '24h成交' },
    { key: 'liquidity', label: '流动性' },
    { key: 'endDate', label: '到期日' },
    { key: 'updatedAt', label: '最新' },
  ];

  const CAT_RULES = [
    {
      key: 'politics',
      words: 'politics,election,trump,biden,president,governor,senate,house,congress,vote,ballot,gop,democrat,republican,primary,polling,poll,maga,ukraine,israel,gaza,putin,nato,nuclear,war,geopolitical,diplomacy,sanctions,ceasefire,taiwan,china-us',
    },
    {
      key: 'crypto',
      words: 'crypto,bitcoin,btc,ethereum,eth,xrp,sol,bnb,chainlink,defi,blockchain,token,altcoin,polymarket,stablecoin,etf,sec,ripple,solana,cardano,doge,memecoin,cryptocurrency',
    },
    {
      key: 'sports',
      words: 'sports,nba,nfl,mlb,nhl,soccer,football,tennis,golf,olympics,f1,race,match,vs,esports,valorant,league,team,player,champion,score,goal,basketball,baseball,hockey,wimbledon,world cup,premier league',
    },
    {
      key: 'tech_ai',
      words: 'artificial intelligence,ai,llm,openai,chatgpt,gpt,claude,gemini,llama,anthropic,deepseek,robot,automation,model,neural,nvidia,tesla ai,waymo,alphabet,google ai,microsoft ai,apple intelligence,tsmc,semiconductor,chip',
    },
    {
      key: 'macro_fed',
      words: 'fed,federal reserve,fomc,interest rate,powell,cpi,ppi,inflation,deflation,recession,gdp,unemployment,nfp,jobs report,treasury,bond,yield,tariff,trade war,economy,macro,nasdaq,sp500,dow',
    },
    {
      key: 'science',
      words: 'science,weather,climate,space,nasa,spacex,virus,vaccine,mars,moon,asteroid,earthquake,hurricane,pandemic,epidemic',
    },
    {
      key: 'business',
      words: 'business,ipo,earnings,stocks,market,company,kraken,merger,acquisition,profit,revenue',
    },
  ];

  function inferCategory(title) {
    const t = String(title || '').toLowerCase();
    for (const rule of CAT_RULES) {
      for (const w of rule.words.split(',')) {
        if (w && t.includes(w.trim())) return rule.key;
      }
    }
    return 'other';
  }

  function injectStyle() {
    if (document.getElementById('poly-style')) return;
    const style = document.createElement('style');
    style.id = 'poly-style';
    style.textContent = `
.poly-root { height: 100%; overflow-y: auto; }
.poly-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.poly-status { color: var(--warning); white-space: nowrap; }
.poly-status.live { color: var(--acc); }
.poly-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.poly-search-wrap { margin-bottom: 8px; }
.poly-search {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text);
  outline: none;
  transition: border-color 0.2s var(--ease-fluid);
}
.poly-search::placeholder { color: var(--text-dim); }
.poly-search:focus { border-color: var(--acc-dim); }
.poly-tabs, .poly-sort {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.poly-tab, .poly-sort-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid), background 0.2s var(--ease-fluid);
}
.poly-tab:hover, .poly-sort-btn:hover { color: var(--text); border-color: var(--text-dim); }
.poly-tab.active, .poly-sort-btn.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
}
.poly-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}
@media (max-width: 520px) {
  .poly-grid { grid-template-columns: 1fr; }
}
.poly-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  background: var(--surface-raised);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s var(--ease-fluid), transform 0.15s var(--ease-fluid);
}
.poly-card:hover { border-color: var(--acc-dim); transform: translateY(-1px); }
.poly-card-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.poly-img {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  object-fit: cover;
  flex: 0 0 32px;
  background: var(--surface);
  border: 1px solid var(--hairline);
}
.poly-title-wrap { min-width: 0; flex: 1 1 auto; }
.poly-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.poly-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.poly-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.poly-badge.acc { color: var(--acc); border-color: var(--acc-dim); }
.poly-price-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  color: var(--text-dim);
}
.poly-price {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.poly-change {
  font-family: var(--font-mono);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-size: 10px;
}
.poly-change.up { color: var(--up, #2ecc71); }
.poly-change.down { color: var(--down, #e74c3c); }
.poly-bar-wrap {
  height: 5px;
  border-radius: 999px;
  background: var(--surface);
  overflow: hidden;
  border: 1px solid var(--hairline);
}
.poly-bar { height: 100%; background: var(--acc); border-radius: 999px; }
.poly-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 10px;
  color: var(--text-muted);
}
.poly-meta b {
  font-weight: 600;
  color: var(--text);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.poly-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.poly-trade {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  color: var(--acc);
}
.poly-load {
  display: block;
  width: 100%;
  padding: 8px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-bottom: 10px;
  transition: color 0.2s var(--ease-fluid), border-color 0.2s var(--ease-fluid);
}
.poly-load:hover { color: var(--text); border-color: var(--acc-dim); }
.poly-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 18px 6px;
}
.poly-fallback {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 24px 6px;
}
.poly-fallback a {
  color: var(--acc);
  text-decoration: underline;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtMoney = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
  };

  const fmtPct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(1)}%`;
  };

  const fmtPriceChange = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${(n * 100).toFixed(1)}¢`;
  };

  const parseJsonMaybe = (v) => {
    if (v == null) return null;
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch (e) {
        return null;
      }
    }
    return null;
  };

  const parsePrice = (market) => {
    if (!market || typeof market !== 'object') return null;
    const prices = parseJsonMaybe(market.outcomePrices);
    if (Array.isArray(prices) && prices.length > 0) {
      const p = Number(prices[0]);
      if (Number.isFinite(p) && p >= 0 && p <= 1) return p;
    }
    const last = Number(market.lastTradePrice);
    if (Number.isFinite(last) && last > 0 && last <= 1) return last;
    const bid = Number(market.bestBid);
    const ask = Number(market.bestAsk);
    if (Number.isFinite(bid) && Number.isFinite(ask) && ask > bid && bid >= 0 && ask <= 1) {
      return (bid + ask) / 2;
    }
    return null;
  };

  const parsePriceChange24h = (market) => {
    if (!market || typeof market !== 'object') return null;
    const candidates = [
      market.priceChange24h,
      market.change24h,
      market.oneDayPriceChange,
      market.priceChange24Hour,
      market.priceChange24Hr,
    ];
    for (const v of candidates) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const firstActiveMarket = (event) => {
    const markets = Array.isArray(event.markets) ? event.markets : [];
    return markets.find((m) => m && m.active && !m.closed) || markets[0] || null;
  };

  const eventUrl = (slug) => `${TRADE_BASE}/${encodeURIComponent(slug)}`;

  const daysLeft = (endDate) => {
    if (!endDate) return null;
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime())) return null;
    return Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const fmtDaysLeft = (days, endDate) => {
    if (days == null) return '';
    if (days <= 0) return '即将到期';
    if (days <= 30) return `剩 ${days} 天`;
    const end = new Date(endDate);
    return `截止 ${end.toISOString().slice(0, 10)}`;
  };

  window.GT_EXTRA_TOOLS['polymarket'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool poly-root">
          <div class="poly-head">
            <span>Polymarket · 预测市场</span>
            <span class="poly-status" data-conn>连接中…</span>
          </div>
          <div class="poly-sub">
            <span>活跃市场 · 概率/成交/流动性 · 60s 刷新</span>
            <span data-count>—</span>
          </div>
          <div class="poly-search-wrap">
            <input type="search" class="poly-search" data-search placeholder="搜索市场标题 / 分类…" autocomplete="off">
          </div>
          <div class="poly-tabs" data-cats></div>
          <div class="poly-sort" data-sort></div>
          <div class="poly-grid" data-grid></div>
          <button type="button" class="poly-load" data-load style="display:none">加载更多</button>
          <div class="poly-foot">
            <span data-src>来源：Polymarket Gamma API</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const grid = el.querySelector('[data-grid]');
      const countEl = el.querySelector('[data-count]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const loadBtn = el.querySelector('[data-load]');
      const catWrap = el.querySelector('[data-cats]');
      const sortWrap = el.querySelector('[data-sort]');
      const searchInput = el.querySelector('[data-search]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingTimers = new Set();
      const pendingAborts = new Set();

      const state = {
        events: [],
        activeView: 'all',
        activeSort: 'volume',
        displayLimit: DEFAULT_DISPLAY,
        search: '',
      };

      const showError = (msg) => {
        hint.innerHTML = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'poly-status';
        setStatus('offline');
      };

      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'poly-status live';
        setStatus('online');
      };

      const apiUrl = (offset = 0, limit = PAGE_LIMIT) =>
        `${API_BASE}/events?active=true&closed=false&order=volume&sort=desc&limit=${limit}&offset=${offset}&relayerId=${RELAYER_ID}`;

      // CORS 代理链：优先同域 /api/proxy，再公共代理。静态站点直接请求跨域 API 通常会被浏览器阻止。
      const PROXY_URLS = [
        (url) => `/api/proxy?url=${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      ];

      const fetchWithProxyFallback = async (url, signal) => {
        for (const makeProxy of PROXY_URLS) {
          if (signal && signal.aborted) throw new Error('aborted');
          try {
            const resp = await fetch(makeProxy(url), { cache: 'no-store', signal });
            if (!resp.ok) continue;
            const text = await resp.text();
            try {
              const json = JSON.parse(text);
              if (Array.isArray(json)) return json;
              if (json && json.contents) {
                const inner = JSON.parse(json.contents);
                if (Array.isArray(inner)) return inner;
              }
            } catch (parseErr) {
              // 不是 JSON，继续下一个代理
            }
          } catch (e) { /* ignore proxy error, try next */ }
        }
        throw new Error('polymarket api unreachable');
      };

      const fetchAllEvents = async (signal) => {
        const all = [];
        let offset = 0;
        while (all.length < MAX_EVENTS) {
          if (signal && signal.aborted) throw new Error('aborted');
          const limit = Math.min(PAGE_LIMIT, MAX_EVENTS - all.length);
          const batch = await fetchWithProxyFallback(apiUrl(offset, limit), signal);
          if (!Array.isArray(batch)) throw new Error('bad response');
          if (batch.length === 0) break;
          all.push(...batch);
          if (batch.length < limit) break;
          offset += batch.length;
        }
        return all.slice(0, MAX_EVENTS);
      };

      const fetchEvents = async () => {
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          return await fetchAllEvents(ctrl.signal);
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      const normalizeEvents = (raw) => {
        const out = [];
        raw.forEach((e) => {
          if (!e || !e.id) return;
          const market = firstActiveMarket(e);
          const price = parsePrice(market);
          const priceChange24h = parsePriceChange24h(market);
          const volume = Number.isFinite(Number(e.volume)) ? Number(e.volume) : 0;
          const volume24hr = Number.isFinite(Number(e.volume24hr)) ? Number(e.volume24hr) : 0;
          const liquidity = Number.isFinite(Number(e.liquidity)) ? Number(e.liquidity) : 0;
          const endDate = e.endDate || market?.endDate;
          const days = daysLeft(endDate);
          out.push({
            id: String(e.id),
            slug: String(e.slug || e.id),
            title: String(e.title || market?.question || '未命名市场'),
            image: e.image || market?.image || '',
            category: inferCategory(e.title),
            volume,
            volume24hr,
            liquidity,
            openInterest: Number.isFinite(Number(e.openInterest)) ? Number(e.openInterest) : 0,
            price,
            priceChange24h,
            endDate,
            days,
            updatedAt: e.updatedAt,
          });
        });
        return out;
      };

      const filteredEvents = () => {
        const view = VIEWS.find((v) => v.key === state.activeView) || VIEWS[0];
        let arr = state.events.slice();

        // 视图筛选
        if (view.type === 'category') {
          arr = arr.filter((e) => e.category === view.cat);
        } else if (view.type === 'preset' && view.filter === 'endingSoon') {
          arr = arr.filter((e) => e.days != null && e.days <= 30);
        }

        // 搜索过滤
        const q = state.search.trim().toLowerCase();
        if (q) {
          arr = arr.filter((e) => {
            if (e.title.toLowerCase().includes(q)) return true;
            const catLabel = CATEGORIES.find((c) => c.key === e.category)?.label || '';
            return catLabel.toLowerCase().includes(q);
          });
        }

        // 排序
        const sortKey = view.type === 'preset' && view.sort ? view.sort : state.activeSort;
        arr.sort((a, b) => {
          if (sortKey === 'updatedAt') {
            return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
          }
          if (sortKey === 'endDate') {
            const ad = a.endDate ? new Date(a.endDate).getTime() : Infinity;
            const bd = b.endDate ? new Date(b.endDate).getTime() : Infinity;
            return ad - bd;
          }
          const av = Number(a[sortKey]) || 0;
          const bv = Number(b[sortKey]) || 0;
          return bv - av;
        });
        return arr;
      };

      const viewCounts = () => {
        const counts = {};
        VIEWS.forEach((v) => {
          if (v.type === 'all') {
            counts[v.key] = state.events.length;
          } else if (v.type === 'category') {
            counts[v.key] = state.events.filter((e) => e.category === v.cat).length;
          } else if (v.type === 'preset' && v.filter === 'endingSoon') {
            counts[v.key] = state.events.filter((e) => e.days != null && e.days <= 30).length;
          } else if (v.type === 'preset') {
            counts[v.key] = state.events.length;
          }
        });
        return counts;
      };

      const renderTabs = () => {
        const counts = viewCounts();
        catWrap.innerHTML = VIEWS.map(
          (v) =>
            `<button type="button" class="poly-tab${state.activeView === v.key ? ' active' : ''}" data-view="${esc(v.key)}">${esc(v.label)} ${counts[v.key] != null ? `(${counts[v.key]})` : ''}</button>`
        ).join('');
        sortWrap.innerHTML = SORTS.map(
          (s) =>
            `<button type="button" class="poly-sort-btn${state.activeSort === s.key ? ' active' : ''}" data-sort="${esc(s.key)}">${esc(s.label)}</button>`
        ).join('');

        catWrap.querySelectorAll('[data-view]').forEach((btn) => {
          btn.addEventListener('click', onViewClick);
        });
        sortWrap.querySelectorAll('[data-sort]').forEach((btn) => {
          btn.addEventListener('click', onSortClick);
        });
      };

      const renderGrid = () => {
        const arr = filteredEvents();
        const showing = arr.slice(0, state.displayLimit);
        countEl.textContent = `${showing.length} / ${arr.length}`;

        if (!arr.length) {
          grid.innerHTML = `<div class="poly-empty">当前筛选暂无活跃市场</div>`;
          loadBtn.style.display = 'none';
          return;
        }

        grid.innerHTML = showing
          .map((e) => {
            const p = Number.isFinite(e.price) ? e.price : null;
            const barWidth = Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '50%';
            const priceText = Number.isFinite(p) ? `${(p * 100).toFixed(1)}¢` : '—';
            const oddsText = Number.isFinite(p) ? fmtPct(p) : '—';
            const catLabel = CATEGORIES.find((c) => c.key === e.category)?.label || '其他';
            const end = fmtDaysLeft(e.days, e.endDate);
            const change = fmtPriceChange(e.priceChange24h);
            const changeCls = e.priceChange24h == null ? '' : e.priceChange24h >= 0 ? 'up' : 'down';
            return `
            <a class="poly-card" href="${esc(eventUrl(e.slug))}" target="_blank" rel="noopener" title="${esc(e.title)}">
              <div class="poly-card-top">
                <img class="poly-img" src="${esc(e.image)}" alt="" loading="lazy" onerror="this.style.display='none'">
                <div class="poly-title-wrap">
                  <div class="poly-title">${esc(e.title)}</div>
                  <div class="poly-badges">
                    <span class="poly-badge">${esc(catLabel)}</span>
                    ${end ? `<span class="poly-badge acc">${esc(end)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="poly-price-row">
                <span class="poly-price">${esc(priceText)}</span>
                <span class="poly-change ${changeCls}">${esc(change)}</span>
                <span>赔率 ${esc(oddsText)}</span>
              </div>
              <div class="poly-bar-wrap"><div class="poly-bar" style="width:${barWidth}"></div></div>
              <div class="poly-meta">
                <span>24h 成交 <b>${esc(fmtMoney(e.volume24hr))}</b></span>
                <span>流动性 <b>${esc(fmtMoney(e.liquidity))}</b></span>
              </div>
              <div class="poly-meta">
                <span>总成交 <b>${esc(fmtMoney(e.volume))}</b></span>
                <span class="poly-trade">交易 ↗</span>
              </div>
            </a>`;
          })
          .join('');

        loadBtn.style.display = state.displayLimit < arr.length ? '' : 'none';
      };

      const render = () => {
        renderTabs();
        renderGrid();
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const raw = await fetchEvents();
          if (!alive) return;
          state.events = normalizeEvents(raw);
          render();
          timeEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          srcEl.textContent = '来源：Polymarket Gamma API';
          clearError();
        } catch (e) {
          if (!alive) return;
          showError(
            `Polymarket API 暂不可用（${e.message || '网络错误'}）。<br>可前往 <a href="https://polymarket.com" target="_blank" rel="noopener">polymarket.com</a> 查看。`
          );
        } finally {
          refreshInFlight = false;
        }
      };

      const onViewClick = (ev) => {
        const key = ev.currentTarget.getAttribute('data-view');
        if (!key || key === state.activeView) return;
        const view = VIEWS.find((v) => v.key === key);
        if (!view) return;
        state.activeView = key;
        state.displayLimit = DEFAULT_DISPLAY;
        if (view.type === 'preset' && view.sort) {
          state.activeSort = view.sort;
        }
        render();
      };

      const onSortClick = (ev) => {
        const key = ev.currentTarget.getAttribute('data-sort');
        if (!key || key === state.activeSort) return;
        state.activeSort = key;
        render();
      };

      const onSearch = () => {
        state.search = searchInput.value;
        state.displayLimit = DEFAULT_DISPLAY;
        renderGrid();
      };

      const onLoadMore = () => {
        state.displayLimit += LOAD_MORE_INCREMENT;
        renderGrid();
      };

      loadBtn.addEventListener('click', onLoadMore);
      searchInput.addEventListener('input', onSearch);

      const tick = () => {
        if (!alive || document.hidden) return;
        refresh();
      };

      setStatus('loading');
      renderTabs();
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
          } catch (e) { /* ignore */ }
        });
        pendingAborts.clear();
        loadBtn.removeEventListener('click', onLoadMore);
        searchInput.removeEventListener('input', onSearch);
      };
    },
  };
})();
