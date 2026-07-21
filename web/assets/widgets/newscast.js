/* GT UNLIMITED — News Broadcast Board (newscast)
 * 多源 RSS 新闻直播墙：滚动头条 + 分类列表 + 地区/主题筛选 + 自动刷新 + 语音播报
 * 数据源：BBC World / Reuters / The Guardian / Al Jazeera / GDACS（全部走 /api/proxy 代理，无 API Key）
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt_newscast_v1';
  const LS_PREFS_KEY = 'gt_newscast_prefs_v1';
  const REFRESH_MS = 3 * 60 * 1000; // 3 分钟自动刷新
  const FETCH_TIMEOUT_MS = 15000;
  const MAX_STORE = 250;
  const MAX_LIST = 80;
  const MAX_TICKER = 14;
  const MAX_BROADCAST = 30;

  const FEEDS = [
    {
      id: 'bbc',
      name: 'BBC World',
      home: 'https://www.bbc.co.uk/news',
      url: 'http://feeds.bbci.co.uk/news/world/rss.xml',
      regionHint: 'Global',
      topics: ['world', 'politics', 'business', 'tech', 'science', 'health'],
    },
    {
      id: 'reuters',
      name: 'Reuters',
      home: 'https://www.reuters.com',
      url: 'https://www.reutersagency.com/feed/?best-topics=news&post_type=reuters-best',
      regionHint: 'Global',
      topics: ['business', 'markets', 'politics', 'tech'],
    },
    {
      id: 'guardian',
      name: 'The Guardian',
      home: 'https://www.theguardian.com',
      url: 'https://www.theguardian.com/world/rss',
      regionHint: 'Global',
      topics: ['world', 'politics', 'business', 'tech', 'environment'],
    },
    {
      id: 'aljazeera',
      name: 'Al Jazeera',
      home: 'https://www.aljazeera.com',
      url: 'https://www.aljazeera.com/xml/rss/all.xml',
      regionHint: 'Global',
      topics: ['world', 'politics', 'business', 'tech', 'climate'],
    },
    {
      id: 'gdacs',
      name: 'GDACS',
      home: 'https://www.gdacs.org',
      url: 'http://www.gdacs.org/xml/rss.xml',
      regionHint: 'Global',
      topics: ['disaster', 'climate'],
    },
  ];

  const REGIONS = ['All', 'Global', 'Americas', 'Europe', 'Middle East & Africa', 'Asia & Pacific'];
  const TOPICS = ['All', 'Finance', 'Tech', 'Climate & Disaster', 'Health', 'Conflict', 'Politics', 'Other'];

  const REGION_KEYWORDS = {
    Americas: ['US', 'USA', 'America', 'American', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Venezuela', 'Chile', 'Peru', 'Ecuador', 'Bolivia', 'Paraguay', 'Uruguay', 'Latin America', 'Washington', 'White House', 'Pentagon', 'Federal Reserve', 'Fed', 'SEC', 'Wall Street', 'Nasdaq', 'S&P', 'NYSE', 'Dow', 'Treasury', 'Biden', 'Trump', 'Amazon', 'Tesla', 'Apple', 'Microsoft', 'Google'],
    Europe: ['Europe', 'European', 'EU', 'UK', 'Britain', 'British', 'England', 'Scotland', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Portugal', 'Greece', 'Poland', 'Ukraine', 'Russia', 'Russian', 'Moscow', 'Putin', 'Zelensky', 'NATO', 'ECB', 'Euro', 'London', 'Paris', 'Berlin', 'Rome', 'Madrid', 'Brussels', 'Vienna'],
    'Middle East & Africa': ['Middle East', 'Israel', 'Gaza', 'Palestine', 'Palestinian', 'Iran', 'Iranian', 'Saudi', 'Yemen', 'Syria', 'Syrian', 'Lebanon', 'Lebanese', 'Turkey', 'Turkish', 'Iraq', 'Iraqi', 'Jordan', 'Qatar', 'UAE', 'Dubai', 'Africa', 'African', 'Nigeria', 'Kenya', 'Ethiopia', 'Egypt', 'Morocco', 'South Africa', 'Libya', 'Sudan', 'Somalia', 'Congo', 'Ghana'],
    'Asia & Pacific': ['China', 'Chinese', 'India', 'Indian', 'Japan', 'Japanese', 'Australia', 'Australian', 'South Korea', 'North Korea', 'Korean', 'Taiwan', 'Taiwanese', 'Hong Kong', 'Indonesia', 'Philippines', 'Vietnam', 'Thailand', 'Malaysia', 'Singapore', 'Pakistan', 'Bangladesh', 'Myanmar', 'New Zealand', 'ASEAN', 'Beijing', 'Shanghai', 'Delhi', 'Mumbai', 'Tokyo', 'Sydney', 'Seoul', 'Pyongyang'],
  };

  const TOPIC_KEYWORDS = {
    Finance: ['market', 'markets', 'stock', 'stocks', 'finance', 'economic', 'economy', 'Fed', 'ECB', 'interest rate', 'inflation', 'deflation', 'trade', 'tariff', 'tariffs', 'Wall Street', 'Nasdaq', 'S&P', 'FTSE', 'Dow', 'bitcoin', 'crypto', 'cryptocurrency', 'oil', 'gold', 'yen', 'yuan', 'dollar', 'euro', 'pound', 'commodity', 'commodities', 'recession', 'GDP', 'unemployment', 'jobs report', 'earnings', 'IPO', 'merger', 'acquisition', 'bank', 'banks', 'banking'],
    Tech: ['tech', 'technology', 'AI', 'artificial intelligence', 'semiconductor', 'chip', 'smartphone', 'internet', 'cyber', 'software', 'Tesla', 'Apple', 'Google', 'Microsoft', 'Meta', 'Amazon', 'Nvidia', 'OpenAI', 'hacker', 'data breach', 'electric vehicle', 'EV', 'space', 'satellite', 'semiconductor'],
    'Climate & Disaster': ['climate', 'weather', 'flood', 'flooding', 'earthquake', 'hurricane', 'typhoon', 'wildfire', 'drought', 'storm', 'cyclone', 'disaster', 'volcanic', 'eruption', 'tsunami', 'landslide', 'tornado', 'extreme weather', 'gdacs'],
    Health: ['health', 'covid', 'pandemic', 'virus', 'vaccine', 'disease', 'outbreak', 'WHO', 'medicine', 'hospital', 'medical', 'mental health', 'drug', 'fda'],
    Conflict: ['war', 'conflict', 'attack', 'missile', 'drone', 'airstrike', 'military', 'army', 'soldier', 'killed', 'kill', 'bomb', 'explosion', 'invade', 'invasion', 'fighting', 'clashes', 'rocket', 'hostage', 'casualty', 'casualties', 'strike'],
    Politics: ['politics', 'election', 'elections', 'vote', 'voting', 'government', 'president', 'prime minister', 'minister', 'parliament', 'policy', 'sanctions', 'summit', 'congress', 'senate', 'legislation', 'diplomatic', 'diplomacy', 'treaty'],
  };

  function injectStyle() {
    if (document.getElementById('newscast-style')) return;
    const style = document.createElement('style');
    style.id = 'newscast-style';
    style.textContent = `
.nc-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; gap: 8px; }
.nc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.nc-title { font-family: var(--font-sans); font-size: 11px; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; }
.nc-status { font-size: 10px; font-family: var(--font-mono); color: var(--text-dim); }
.nc-status.live { color: var(--acc); }
.nc-actions { display: flex; align-items: center; gap: 6px; }
.nc-btn {
  background: transparent; border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; padding: 5px 10px; cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
}
.nc-btn:hover { border-color: var(--acc-dim); color: var(--acc); }
.nc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.nc-btn.active { border-color: var(--acc); color: var(--acc); background: var(--acc-glow); }
.nc-broadcast {
  display: none; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 8px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface-raised);
}
.nc-broadcast.visible { display: flex; }
.nc-broadcast-status {
  font-size: 10px; color: var(--acc); font-family: var(--font-mono); min-width: 90px;
}
.nc-broadcast label { font-size: 9px; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
.nc-broadcast input[type="range"] {
  width: 80px; -webkit-appearance: none; appearance: none; height: 4px;
  background: var(--hairline); border-radius: 2px; outline: none;
}
.nc-broadcast input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%; background: var(--acc); cursor: pointer;
}
.nc-broadcast input[type="range"]::-moz-range-thumb {
  width: 10px; height: 10px; border: none; border-radius: 50%; background: var(--acc); cursor: pointer;
}
.nc-broadcast select {
  background: var(--bg); border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  color: var(--text); font-family: var(--font-mono); font-size: 10px; padding: 3px 6px; max-width: 140px;
}
.nc-ticker-wrap {
  flex-shrink: 0; height: 28px; overflow: hidden; position: relative;
  border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-raised) 50%, transparent);
}
.nc-ticker-wrap::before, .nc-ticker-wrap::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 24px; z-index: 2; pointer-events: none;
}
.nc-ticker-wrap::before { left: 0; background: linear-gradient(to right, var(--surface), transparent); }
.nc-ticker-wrap::after { right: 0; background: linear-gradient(to left, var(--surface), transparent); }
.nc-ticker-track {
  display: flex; align-items: center; height: 100%; width: max-content; will-change: transform;
  animation: nc-scroll 50s linear infinite;
}
.nc-ticker-wrap:hover .nc-ticker-track { animation-play-state: paused; }
@keyframes nc-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.nc-ticker-item {
  display: inline-flex; align-items: center; gap: 8px; padding: 0 16px;
  border-right: 1px solid var(--hairline); white-space: nowrap; font-size: 11px; color: var(--text);
  cursor: pointer; user-select: none;
}
.nc-ticker-item:hover { color: var(--acc); }
.nc-ticker-time { font-family: var(--font-mono); font-size: 9px; color: var(--text-dim); }
.nc-ticker-src { font-size: 8px; letter-spacing: 0.08em; color: var(--text-muted); text-transform: uppercase; }
.nc-ticker-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--acc); box-shadow: 0 0 5px var(--acc-glow); }
.nc-filterbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 8px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface-raised);
}
.nc-filterbar label { font-size: 9px; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase; }
.nc-filterbar select, .nc-filterbar input {
  background: var(--bg); border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  color: var(--text); font-family: var(--font-mono); font-size: 10px; padding: 4px 8px; outline: none;
}
.nc-filterbar select:focus, .nc-filterbar input:focus { border-color: var(--acc-dim); }
.nc-filterbar input { min-width: 120px; flex: 1; }
.nc-count { margin-left: auto; font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); }
.nc-list-wrap { flex: 1; overflow-y: auto; border: 1px solid var(--hairline); border-radius: var(--radius-sm); }
.nc-list { width: 100%; border-collapse: collapse; font-size: 11px; }
.nc-list th {
  position: sticky; top: 0; background: var(--surface); text-align: left; padding: 7px 8px;
  font-size: 8px; letter-spacing: 0.12em; color: var(--text-dim); text-transform: uppercase; font-weight: 500; z-index: 1;
}
.nc-list td { padding: 7px 8px; border-top: 1px solid var(--hairline); color: var(--text); vertical-align: top; }
.nc-list tbody tr { cursor: pointer; transition: background 0.15s var(--ease-fluid); }
.nc-list tbody tr:hover { background: var(--surface-raised); }
.nc-list a { color: inherit; text-decoration: none; }
.nc-list a:hover { color: var(--acc); text-decoration: underline; }
.nc-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-dim); white-space: nowrap; }
.nc-source { font-size: 9px; color: var(--text-muted); white-space: nowrap; }
.nc-topic { display: inline-block; font-size: 9px; color: var(--text-dim); border: 1px solid var(--hairline); border-radius: 999px; padding: 1px 6px; margin-right: 4px; }
.nc-region { font-size: 9px; color: var(--text-muted); }
.nc-empty td { text-align: center; color: var(--text-muted); padding: 24px 8px; }
.nc-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 9px; color: var(--text-dim); }
.nc-hint { font-size: 10px; color: var(--warning); min-height: 14px; }
.nc-hint:empty { display: none; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function unescapeHtml(s) {
    const div = document.createElement('div');
    div.innerHTML = s;
    return div.textContent || div.innerText || s;
  }

  function cleanText(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  function lsWrite(val) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_PREFS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {};
  }
  function savePrefs(prefs) {
    try { localStorage.setItem(LS_PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  function classifyRegion(title, categories, hint) {
    const text = (title + ' ' + categories.join(' ') + ' ' + hint).toLowerCase();
    for (const region of ['Americas', 'Europe', 'Middle East & Africa', 'Asia & Pacific']) {
      const hits = REGION_KEYWORDS[region];
      for (const kw of hits) {
        if (text.includes(kw.toLowerCase())) return region;
      }
    }
    return 'Global';
  }

  function classifyTopics(title, categories, sourceTopics) {
    const text = (title + ' ' + categories.join(' ')).toLowerCase();
    const topics = [];
    for (const topic of TOPICS) {
      if (topic === 'All' || topic === 'Other') continue;
      const hits = TOPIC_KEYWORDS[topic];
      for (const kw of hits) {
        if (text.includes(kw.toLowerCase())) {
          topics.push(topic);
          break;
        }
      }
    }
    // source-level hints
    if (sourceTopics.includes('disaster') || sourceTopics.includes('climate')) {
      if (!topics.includes('Climate & Disaster')) topics.push('Climate & Disaster');
    }
    if (sourceTopics.includes('business') || sourceTopics.includes('markets')) {
      if (!topics.includes('Finance')) topics.push('Finance');
    }
    if (sourceTopics.includes('tech')) {
      if (!topics.includes('Tech')) topics.push('Tech');
    }
    if (sourceTopics.includes('health')) {
      if (!topics.includes('Health')) topics.push('Health');
    }
    if (!topics.length) topics.push('Other');
    return topics;
  }

  function parseAtom(doc, feed) {
    const entries = doc.querySelectorAll('entry');
    const items = [];
    entries.forEach((entry) => {
      const titleEl = entry.querySelector('title');
      let title = cleanText(titleEl ? titleEl.textContent : '');
      if (!title) return;
      const linkEl = entry.querySelector('link');
      let link = '';
      if (linkEl) {
        link = linkEl.getAttribute('href') || linkEl.textContent || '';
      }
      const dateEl = entry.querySelector('published,updated');
      const date = dateEl ? new Date(dateEl.textContent) : new Date();
      const cats = Array.from(entry.querySelectorAll('category'))
        .map((c) => cleanText(c.textContent || c.getAttribute('term') || ''))
        .filter(Boolean);
      const descEl = entry.querySelector('summary,content');
      const desc = cleanText(descEl ? descEl.textContent : '');
      items.push(buildItem(title, link, date, cats, desc, feed));
    });
    return items;
  }

  function parseRss(doc, feed) {
    const items = [];
    const itemEls = doc.querySelectorAll('item');
    itemEls.forEach((item) => {
      const titleEl = item.querySelector('title');
      let title = cleanText(titleEl ? titleEl.textContent : '');
      if (!title) return;
      const linkEl = item.querySelector('link');
      let link = cleanText(linkEl ? linkEl.textContent : '');
      const dateEl = item.querySelector('pubDate');
      const date = dateEl ? new Date(dateEl.textContent) : new Date();
      const cats = Array.from(item.querySelectorAll('category'))
        .map((c) => cleanText(c.textContent || c.getAttribute('term') || ''))
        .filter(Boolean);
      const descEl = item.querySelector('description');
      const desc = cleanText(descEl ? descEl.textContent : '');
      items.push(buildItem(title, link, date, cats, desc, feed));
    });
    return items;
  }

  function parseXmlFallback(text, feed) {
    // 当 DOMParser 不可用时，用保守正则兜底
    const items = [];
    const re = /<(item|entry)[\s\S]*?<\/\1>/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const block = m[0];
      const title = cleanText((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      if (!title) continue;
      let link = '';
      const atomLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
      if (atomLink) link = cleanText(atomLink[1]);
      else link = cleanText((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
      const dateRaw = (block.match(/<(pubDate|published|updated)>([\s\S]*?)<\/\1>/i) || [])[2] || '';
      const date = dateRaw ? new Date(dateRaw) : new Date();
      const cats = [];
      const catRe = /<category[^>]*>([\s\S]*?)<\/category>/gi;
      let cm;
      while ((cm = catRe.exec(block)) !== null) cats.push(cleanText(cm[1]));
      const desc = cleanText((block.match(/<(description|summary)>([\s\S]*?)<\/\1>/i) || [])[2] || '');
      items.push(buildItem(title, link, date, cats, desc, feed));
    }
    return items;
  }

  function buildItem(title, link, date, categories, desc, feed) {
    if (!Number.isFinite(date.getTime())) date = new Date();
    const region = classifyRegion(title, categories, feed.regionHint);
    const topics = classifyTopics(title, categories, feed.topics);
    return {
      id: (feed.id + '|' + (link || title)).slice(0, 240),
      title,
      link: link || feed.home,
      date: date.getTime(),
      source: feed.name,
      sourceId: feed.id,
      region,
      topics,
      desc: desc || title,
    };
  }

  async function fetchFeed(feed) {
    const url = '/api/proxy?url=' + encodeURIComponent(feed.url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error('http ' + res.status);
      const text = await res.text();
      if (!text.trim()) throw new Error('empty body');

      // 某些源会返回 HTML 登录/错误页，快速丢弃
      const sniff = text.slice(0, 200).toLowerCase();
      if (sniff.includes('<!doctype html') && !sniff.includes('<rss') && !sniff.includes('<feed') && !sniff.includes('<channel')) {
        throw new Error('html response');
      }

      let items = [];
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'application/xml');
        const root = doc.documentElement ? doc.documentElement.tagName.toLowerCase() : '';
        const err = doc.querySelector('parsererror');
        if (!err && (root === 'rss' || root === 'channel' || root === 'feed')) {
          items = root === 'feed' ? parseAtom(doc, feed) : parseRss(doc, feed);
        } else {
          items = parseXmlFallback(text, feed);
        }
      } else {
        items = parseXmlFallback(text, feed);
      }
      return { ok: true, items };
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: e.message, feed };
    }
  }

  function dedupeAndSort(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    out.sort((a, b) => b.date - a.date);
    return out.slice(0, MAX_STORE);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.max(0, now - d);
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + '分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + '小时前';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtTimeShort(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getSynth() {
    return window.speechSynthesis || null;
  }

  window.GT_EXTRA_TOOLS['newscast'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool nc-root">
          <div class="nc-head">
            <span class="nc-title">新闻直播 · NEWSCAST</span>
            <span class="nc-status" data-status>初始化…</span>
            <div class="nc-actions">
              <button class="nc-btn" data-broadcast type="button" title="语音播报">📢 播报</button>
              <button class="nc-btn" data-refresh type="button" title="立即刷新">↻ 刷新</button>
            </div>
          </div>
          <div class="nc-broadcast" data-broadcast-panel>
            <span class="nc-broadcast-status" data-broadcast-status>就绪</span>
            <button class="nc-btn" data-broadcast-toggle type="button" title="播放 / 暂停">▶ 播放</button>
            <button class="nc-btn" data-broadcast-stop type="button" title="停止">⏹ 停止</button>
            <label for="nc-rate">语速</label>
            <input id="nc-rate" type="range" min="0.5" max="2" step="0.1" value="1" data-broadcast-rate title="语速">
            <label for="nc-voice">声音</label>
            <select id="nc-voice" data-broadcast-voice title="声音"></select>
          </div>
          <div class="nc-ticker-wrap" aria-label="滚动头条">
            <div class="nc-ticker-track" data-ticker></div>
          </div>
          <div class="nc-filterbar">
            <label for="nc-region">地区</label>
            <select id="nc-region" data-region>${REGIONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
            <label for="nc-topic">主题</label>
            <select id="nc-topic" data-topic>${TOPICS.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
            <input type="text" data-search placeholder="搜索标题 / 来源…" autocomplete="off" spellcheck="false">
            <span class="nc-count" data-count>0 条</span>
          </div>
          <div class="nc-hint" data-hint></div>
          <div class="nc-list-wrap">
            <table class="nc-list">
              <thead><tr><th>时间</th><th>来源</th><th>标题</th><th>地区</th><th>主题</th></tr></thead>
              <tbody data-body><tr class="nc-empty"><td colspan="5">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="nc-foot">
            <span data-source>来源：BBC / Reuters / Guardian / Al Jazeera / GDACS</span>
            <span data-updated>—</span>
          </div>
        </div>`;

      const statusEl = el.querySelector('[data-status]');
      const tickerTrack = el.querySelector('[data-ticker]');
      const regionSel = el.querySelector('[data-region]');
      const topicSel = el.querySelector('[data-topic]');
      const searchIn = el.querySelector('[data-search]');
      const countEl = el.querySelector('[data-count]');
      const hintEl = el.querySelector('[data-hint]');
      const body = el.querySelector('[data-body]');
      const sourceEl = el.querySelector('[data-source]');
      const updatedEl = el.querySelector('[data-updated]');
      const refreshBtn = el.querySelector('[data-refresh]');
      const broadcastBtn = el.querySelector('[data-broadcast]');
      const broadcastPanel = el.querySelector('[data-broadcast-panel]');
      const broadcastStatus = el.querySelector('[data-broadcast-status]');
      const broadcastToggle = el.querySelector('[data-broadcast-toggle]');
      const broadcastStop = el.querySelector('[data-broadcast-stop]');
      const broadcastRate = el.querySelector('[data-broadcast-rate]');
      const broadcastVoice = el.querySelector('[data-broadcast-voice]');

      const prefs = loadPrefs();
      if (prefs.region) regionSel.value = prefs.region;
      if (prefs.topic) topicSel.value = prefs.topic;
      if (prefs.search) searchIn.value = prefs.search;
      if (prefs.rate) broadcastRate.value = prefs.rate;

      let alive = true;
      let allItems = [];
      let refreshTimer = null;
      let inFlight = false;

      // ── Speech synthesis state ──
      const synth = getSynth();
      let voices = [];
      let broadcastQueue = [];
      let broadcastIndex = 0;
      let isBroadcasting = false;
      let isPaused = false;
      let currentUtterance = null;

      function getFilters() {
        return {
          region: regionSel.value,
          topic: topicSel.value,
          search: (searchIn.value || '').trim().toLowerCase(),
        };
      }

      const matches = (it, f) => {
        if (f.region !== 'All' && it.region !== f.region) return false;
        if (f.topic !== 'All' && !it.topics.includes(f.topic)) return false;
        if (f.search) {
          const hay = (it.title + ' ' + it.source + ' ' + it.desc).toLowerCase();
          if (!hay.includes(f.search)) return false;
        }
        return true;
      };

      const filtered = () => {
        const f = getFilters();
        return allItems.filter((it) => matches(it, f));
      };

      function saveUiPrefs() {
        savePrefs({
          region: regionSel.value,
          topic: topicSel.value,
          search: searchIn.value,
          rate: parseFloat(broadcastRate.value) || 1,
          voiceURI: broadcastVoice.value || undefined,
        });
      }

      function renderTicker(items) {
        const take = items.slice(0, MAX_TICKER);
        if (!take.length) {
          tickerTrack.innerHTML = '<span class="nc-ticker-item"><span class="nc-ticker-dot"></span>等待新闻数据…</span>';
          return;
        }
        const half = take.map((it) => `
          <a class="nc-ticker-item" href="${esc(it.link)}" target="_blank" rel="noopener">
            <span class="nc-ticker-dot"></span>
            <span class="nc-ticker-src">${esc(it.source)}</span>
            <span>${esc(it.title)}</span>
            <span class="nc-ticker-time">${esc(fmtTimeShort(it.date))}</span>
          </a>`).join('');
        tickerTrack.innerHTML = half + half;
      }

      function renderList(items) {
        countEl.textContent = items.length + ' 条';
        if (!items.length) {
          body.innerHTML = '<tr class="nc-empty"><td colspan="5">无匹配头条</td></tr>';
          return;
        }
        body.innerHTML = items.slice(0, MAX_LIST).map((it) => `
          <tr data-link="${esc(it.link)}">
            <td class="nc-time">${esc(fmtTime(it.date))}</td>
            <td class="nc-source">${esc(it.source)}</td>
            <td><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></td>
            <td class="nc-region">${esc(it.region)}</td>
            <td>${it.topics.slice(0, 2).map((t) => `<span class="nc-topic">${esc(t)}</span>`).join('')}</td>
          </tr>`).join('');
      }

      function renderAll() {
        const list = filtered();
        renderTicker(list);
        renderList(list);
      }

      function setConn(status, text) {
        statusEl.textContent = text;
        statusEl.className = 'nc-status' + (status === 'online' ? ' live' : '');
        setStatus(status);
      }

      async function refresh() {
        if (!alive || inFlight) return;
        inFlight = true;
        refreshBtn.disabled = true;
        setConn('loading', '加载中…');
        hintEl.textContent = '';

        const results = await Promise.all(FEEDS.map((f) => fetchFeed(f)));
        const successes = results.filter((r) => r.ok);
        const failures = results.filter((r) => !r.ok);

        if (successes.length) {
          const merged = [];
          successes.forEach((r) => merged.push(...r.items));
          if (merged.length) {
            allItems = dedupeAndSort(merged.concat(allItems));
            lsWrite({ items: allItems, updatedAt: Date.now() });
            setConn('online', '● LIVE');
            if (failures.length) {
              const names = failures.map((r) => r.feed.name).join('、');
              hintEl.textContent = `部分源未加载：${names}，已用其余源展示。`;
            }
          } else if (allItems.length) {
            setConn('online', '● LIVE');
            hintEl.textContent = '本次未获取到新条目，展示缓存数据。';
          } else {
            setConn('offline', '无数据');
            hintEl.textContent = '新闻源暂不可用。';
          }
        } else {
          if (!allItems.length) setConn('offline', '离线');
          else {
            setConn('online', '● LIVE');
            hintEl.textContent = '全部源加载失败，展示缓存数据。';
          }
        }

        renderAll();
        updatedEl.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' · 3分钟自动刷新';
        sourceEl.textContent = '来源：' + FEEDS.map((f) => f.name).join(' / ') + ' · 经 /api/proxy 代理';
        inFlight = false;
        refreshBtn.disabled = false;
      }

      // ── Broadcast / TTS ──
      function populateVoices() {
        if (!synth) return;
        voices = synth.getVoices() || [];
        const savedVoiceURI = prefs.voiceURI;
        const saved = loadPrefs();
        const currentOptions = Array.from(broadcastVoice.options).map((o) => o.value);
        const voiceOptions = voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }));
        // Avoid thrashing DOM if list unchanged
        const newValues = voiceOptions.map((o) => o.value);
        if (newValues.length === currentOptions.length && newValues.every((v, i) => v === currentOptions[i])) return;
        broadcastVoice.innerHTML = voiceOptions.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        const selectURI = saved.voiceURI || savedVoiceURI;
        if (selectURI && newValues.includes(selectURI)) {
          broadcastVoice.value = selectURI;
        } else if (voices.length) {
          // Prefer Chinese or default voice
          const zh = voices.find((v) => v.lang.toLowerCase().startsWith('zh'));
          broadcastVoice.value = zh ? zh.voiceURI : voices[0].voiceURI;
        }
      }

      function selectedVoice() {
        return voices.find((v) => v.voiceURI === broadcastVoice.value) || voices[0] || null;
      }

      function buildBroadcastQueue() {
        const items = filtered().slice(0, MAX_BROADCAST);
        return items.map((it, idx) => ({
          text: `${it.source} 报道：${cleanText(unescapeHtml(it.title))}`,
          idx: idx + 1,
          total: items.length,
        }));
      }

      function updateBroadcastUi() {
        if (!isBroadcasting) {
          broadcastPanel.classList.remove('visible');
          broadcastBtn.classList.remove('active');
          broadcastToggle.textContent = '▶ 播放';
          broadcastStatus.textContent = '就绪';
          return;
        }
        broadcastPanel.classList.add('visible');
        broadcastBtn.classList.add('active');
        if (isPaused) {
          broadcastToggle.textContent = '▶ 继续';
          broadcastStatus.textContent = '已暂停';
        } else {
          broadcastToggle.textContent = '⏸ 暂停';
          broadcastStatus.textContent = `播报中 ${broadcastIndex + 1}/${broadcastQueue.length}`;
        }
      }

      function stopBroadcast() {
        if (!synth) return;
        try { synth.cancel(); } catch (e) { /* ignore */ }
        isBroadcasting = false;
        isPaused = false;
        broadcastIndex = 0;
        broadcastQueue = [];
        currentUtterance = null;
        updateBroadcastUi();
      }

      function speakNext() {
        if (!alive || !synth || !isBroadcasting) return;
        if (broadcastIndex >= broadcastQueue.length) {
          broadcastStatus.textContent = '播报完成';
          broadcastToggle.textContent = '▶ 重播';
          isBroadcasting = false;
          isPaused = false;
          broadcastIndex = 0;
          broadcastBtn.classList.remove('active');
          return;
        }
        const item = broadcastQueue[broadcastIndex];
        const u = new SpeechSynthesisUtterance(item.text);
        const voice = selectedVoice();
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : 'zh-CN';
        u.rate = parseFloat(broadcastRate.value) || 1;
        u.pitch = 1;
        u.volume = 1;

        u.onstart = () => {
          if (!alive) return;
          isPaused = false;
          updateBroadcastUi();
        };
        u.onend = () => {
          if (!alive) return;
          broadcastIndex += 1;
          currentUtterance = null;
          speakNext();
        };
        u.onerror = (e) => {
          if (!alive) return;
          // 'canceled' is expected when user stops; skip others
          if (e.error === 'canceled' || e.error === 'interrupted') return;
          broadcastStatus.textContent = '播报出错';
          hintEl.textContent = `语音播报错误：${e.error}`;
          stopBroadcast();
        };

        currentUtterance = u;
        try {
          synth.speak(u);
        } catch (e) {
          hintEl.textContent = '语音播放失败，请重试';
          stopBroadcast();
        }
      }

      function startBroadcast() {
        if (!synth) {
          hintEl.textContent = '当前浏览器不支持语音播报。';
          return;
        }
        synth.cancel();
        broadcastQueue = buildBroadcastQueue();
        if (!broadcastQueue.length) {
          hintEl.textContent = '当前筛选无新闻可播报。';
          return;
        }
        broadcastIndex = 0;
        isBroadcasting = true;
        isPaused = false;
        updateBroadcastUi();
        speakNext();
      }

      function toggleBroadcast() {
        if (!synth) {
          hintEl.textContent = '当前浏览器不支持语音播报。';
          return;
        }
        if (!isBroadcasting) {
          startBroadcast();
          return;
        }
        if (isPaused) {
          try { synth.resume(); } catch (e) { /* ignore */ }
          isPaused = false;
          updateBroadcastUi();
        } else {
          try { synth.pause(); } catch (e) { /* ignore */ }
          isPaused = true;
          updateBroadcastUi();
        }
      }

      // 事件绑定
      const disposers = [];
      const on = (node, ev, fn) => {
        node.addEventListener(ev, fn);
        disposers.push(() => node.removeEventListener(ev, fn));
      };

      on(regionSel, 'change', () => { saveUiPrefs(); stopBroadcast(); renderAll(); });
      on(topicSel, 'change', () => { saveUiPrefs(); stopBroadcast(); renderAll(); });
      on(searchIn, 'input', () => { saveUiPrefs(); stopBroadcast(); renderAll(); });
      on(refreshBtn, 'click', refresh);
      on(broadcastBtn, 'click', () => {
        if (broadcastPanel.classList.contains('visible')) {
          stopBroadcast();
        } else {
          startBroadcast();
        }
      });
      on(broadcastToggle, 'click', toggleBroadcast);
      on(broadcastStop, 'click', stopBroadcast);
      on(broadcastRate, 'change', () => {
        saveUiPrefs();
        if (isBroadcasting && currentUtterance) {
          // Changing rate requires restart from current item
          const idx = broadcastIndex;
          synth.cancel();
          broadcastIndex = idx;
          isPaused = false;
          speakNext();
        }
      });
      on(broadcastVoice, 'change', () => {
        saveUiPrefs();
        if (isBroadcasting && currentUtterance) {
          const idx = broadcastIndex;
          synth.cancel();
          broadcastIndex = idx;
          isPaused = false;
          speakNext();
        }
      });
      on(body, 'click', (e) => {
        const row = e.target.closest('tr[data-link]');
        if (row && !e.target.closest('a')) {
          window.open(row.dataset.link, '_blank', 'noopener');
        }
      });

      // Voice list may load asynchronously
      if (synth && typeof synth.onvoiceschanged !== 'undefined') {
        const voiceHandler = () => populateVoices();
        synth.onvoiceschanged = voiceHandler;
        disposers.push(() => { synth.onvoiceschanged = null; });
      }
      populateVoices();
      // Some engines fire voiceschanged only after a short delay
      setTimeout(populateVoices, 300);
      setTimeout(populateVoices, 1000);

      // 加载缓存作为首屏兜底
      const cache = lsRead();
      if (cache && Array.isArray(cache.items) && cache.items.length) {
        allItems = cache.items;
        renderAll();
        setConn('loading', '缓存');
      }

      refresh();
      refreshTimer = setInterval(() => {
        if (!alive || document.hidden) return;
        refresh();
      }, REFRESH_MS);

      return () => {
        alive = false;
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        disposers.forEach((fn) => fn());
        disposers.length = 0;
        stopBroadcast();
      };
    },
  };
})();
