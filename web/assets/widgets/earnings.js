/* 美股财报日历 — 展示未来 7 个交易日的重要美股财报日程。
 * 数据来源：
 *   1. Yahoo Finance Earnings Calendar（https://finance.yahoo.com/calendar/earnings），
 *      通过 /api/proxy?url=... 转发以绕过 CORS；页面内嵌 JSON root.App.main，
 *      本组件递归搜索其中符合财报字段结构的数据数组。
 *   2. 兜底：TradingView events 嵌入 + 手动维护的 Mega-Cap 财报占位清单 + 外部链接。
 * 注意：
 *   - Yahoo 页面结构可能变化，解析为启发式，失败即切换兜底，不影响其它组件。
 *   - 数据为公开免费，无 API Key；不要依赖时间精度，仅作日程参考。
 *   - EPS estimate / market cap 在 Yahoo 不可用时显示 “—”。
 * Registers as custom tool id 'earnings' via window.GT_EXTRA_TOOLS.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const REFRESH_MS = 5 * 60 * 1000; // 5 分钟刷新
  const FETCH_TIMEOUT_MS = 15000;
  const DAYS_AHEAD = 7;
  const MAX_PER_DAY = 60; // 单日最多解析条数，避免 DOM 爆炸

  // 常见美股 → TradingView 交易所前缀（用于点击跳转主图）
  const NASDAQ_SET = new Set([
    'AAPL','MSFT','AMZN','GOOGL','GOOG','META','NVDA','TSLA','NFLX','AMD','INTC',
    'QCOM','ADBE','PYPL','AVGO','COST','PEP','CSCO','CMCSA','TMUS','TXN','ABNB',
    'SBUX','INTU','AMAT','ADI','MU','LRCX','MRVL','KLAC','SNPS','CDNS','FTNT',
    'ANSS','ENPH','SEDG','CSX','ISRG','MDLZ','GILD','AMGN','BIIB','VRTX','REGN',
    'ILMN','MRNA','ZS','CRWD','OKTA','DDOG','NET','PLTR','SNOW','ZM','DOCU',
    'UBER','LYFT','DASH','COIN','HOOD','ROKU','PTON','LCID','RIVN','AFRM','SQ','SHOP'
  ]);

  // 兜底占位：知名 Mega-Cap 财报日程模板（实际日期为占位，仅用于完全离线时保持界面可用）
  const FALLBACK_STOCKS = [
    { symbol: 'AAPL', name: 'Apple Inc.', tv: 'NASDAQ:AAPL' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', tv: 'NASDAQ:MSFT' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', tv: 'NASDAQ:AMZN' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', tv: 'NASDAQ:GOOGL' },
    { symbol: 'META', name: 'Meta Platforms', tv: 'NASDAQ:META' },
    { symbol: 'TSLA', name: 'Tesla Inc.', tv: 'NASDAQ:TSLA' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', tv: 'NASDAQ:NVDA' },
    { symbol: 'JPM', name: 'JPMorgan Chase', tv: 'NYSE:JPM' },
    { symbol: 'V', name: 'Visa Inc.', tv: 'NYSE:V' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', tv: 'NYSE:JNJ' },
    { symbol: 'WMT', name: 'Walmart Inc.', tv: 'NYSE:WMT' },
    { symbol: 'XOM', name: 'Exxon Mobil', tv: 'NYSE:XOM' },
    { symbol: 'BAC', name: 'Bank of America', tv: 'NYSE:BAC' },
    { symbol: 'PG', name: 'Procter & Gamble', tv: 'NYSE:PG' },
    { symbol: 'MA', name: 'Mastercard Inc.', tv: 'NYSE:MA' },
  ];

  function tvSymbol(symbol) {
    if (NASDAQ_SET.has(symbol)) return `NASDAQ:${symbol}`;
    return `NYSE:${symbol}`;
  }

  function injectStyle() {
    if (document.getElementById('earnings-style')) return;
    const style = document.createElement('style');
    style.id = 'earnings-style';
    style.textContent = `
.earn-root { display: flex; flex-direction: column; height: 100%; }
.earn-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.earn-status { color: var(--warning); white-space: nowrap; }
.earn-status.live { color: var(--acc); }
.earn-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.earn-scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.earn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.earn-table th {
  position: sticky;
  top: 0;
  background: var(--surface-raised);
  color: var(--text-muted);
  font-weight: 600;
  text-align: left;
  padding: 7px 8px;
  border-bottom: 1px solid var(--hairline);
  font-size: 10px;
  letter-spacing: 0.06em;
}
.earn-table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--hairline);
  color: var(--text);
  white-space: nowrap;
}
.earn-table tr:last-child td { border-bottom: none; }
.earn-table tr:hover td { background: var(--surface-raised); }
.earn-sym {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--acc);
  cursor: pointer;
}
.earn-name { color: var(--text-muted); font-size: 10px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
.earn-time {
  display: inline-block;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.earn-time.bmo { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.earn-time.amc { color: var(--warning); border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.earn-num { font-family: var(--font-mono); color: var(--text); }
.earn-date {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.earn-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}
.earn-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 8px;
}
.earn-foot a { color: var(--acc); text-decoration: none; }
.earn-foot a:hover { text-decoration: underline; }
.earn-fallback {
  padding: 16px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.6;
}
.earn-fallback p { margin: 0 0 10px; }
.earn-fallback ul { margin: 0; padding-left: 16px; }
.earn-fallback li { margin-bottom: 4px; }
.earn-tv-wrap {
  height: 280px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
  margin-top: 8px;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtNum = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const fmtDate = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const fmtCap = (v) => {
    if (!Number.isFinite(v) || v <= 0) return '—';
    if (v >= 1e12) return `$${fmtNum(v / 1e12, 2)}T`;
    if (v >= 1e9) return `$${fmtNum(v / 1e9, 2)}B`;
    if (v >= 1e6) return `$${fmtNum(v / 1e6, 2)}M`;
    return `$${fmtNum(v, 0)}`;
  };

  const parseEps = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const timeLabel = (item) => {
    // Yahoo 有时直接提供 time 字符串
    const rawTime = String(item.time || item.earningsTime || item.earningsTimeType || '').toLowerCase();
    if (rawTime.includes('before') || rawTime === 'bmo') return { text: 'BMO', cls: 'bmo' };
    if (rawTime.includes('after') || rawTime === 'amc') return { text: 'AMC', cls: 'amc' };
    // 解析 ISO 时间并按美东时间 09:30/16:00 判断
    const iso = item.startDateTime || item.earningsDate || item.earningsDateStart || item.earningsCallDate || '';
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const hour = et.getHours();
        const min = et.getMinutes();
        const minutes = hour * 60 + min;
        if (minutes < 570) return { text: 'BMO', cls: 'bmo' }; // 09:30 ET 前
        if (minutes >= 960) return { text: 'AMC', cls: 'amc' }; // 16:00 ET 后
        return { text: `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')} ET`, cls: '' };
      }
    }
    return { text: 'TNC', cls: '' };
  };

  const extractEarnings = (rootObj) => {
    const results = [];
    const seen = new Set();

    const isEarningsItem = (x) =>
      x &&
      typeof x === 'object' &&
      typeof x.symbol === 'string' &&
      x.symbol.length >= 1 &&
      x.symbol.length <= 8 &&
      /[A-Z]+/.test(x.symbol) &&
      (x.companyName != null || x.companyShortName != null || x.name != null || x.earningsDate != null || x.epsEstimate != null);

    const walk = (obj, depth = 0) => {
      if (depth > 12 || results.length >= MAX_PER_DAY * DAYS_AHEAD) return;
      if (obj == null || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        // 若数组元素疑似财报条目，整段采用
        if (obj.length && obj.every(isEarningsItem)) {
          obj.forEach((x) => {
            if (seen.has(x.symbol)) return;
            seen.add(x.symbol);
            results.push(x);
          });
          return;
        }
        obj.forEach((child) => walk(child, depth + 1));
      } else {
        Object.values(obj).forEach((child) => walk(child, depth + 1));
      }
    };

    walk(rootObj);
    return results;
  };

  const proxyUrl = (target) => `/api/proxy?url=${encodeURIComponent(target)}`;

  async function fetchYahooDay(dateStr, signal) {
    const target = `https://finance.yahoo.com/calendar/earnings?from=${dateStr}&to=${dateStr}&day=${dateStr}`;
    const res = await fetch(proxyUrl(target), { signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const html = await res.text();
    if (!html || html.length < 100) throw new Error('empty html');

    // 提取 root.App.main
    const idx = html.indexOf('root.App.main = ');
    if (idx < 0) throw new Error('root.App.main not found');
    let start = idx + 'root.App.main = '.length;
    let brace = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;
    let end = start;
    for (let i = start; i < html.length; i += 1) {
      const ch = html[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === stringChar) {
          inString = false;
        }
      } else {
        if (ch === '"' || ch === "'" || ch === '`') {
          inString = true;
          stringChar = ch;
        } else if (ch === '{' || ch === '[') {
          if (brace === 0 && i > start) start = i;
          brace += 1;
        } else if (ch === '}' || ch === ']') {
          brace -= 1;
          if (brace === 0) {
            end = i + 1;
            break;
          }
        }
      }
    }
    if (end <= start) throw new Error('cannot locate root.App.main boundaries');
    const json = html.slice(start, end);
    const parsed = JSON.parse(json);
    const items = extractEarnings(parsed);
    return { date: dateStr, items };
  }

  async function fetchYahooRange(days, signal) {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(fmtDate(d));
    }
    const results = await Promise.all(
      dates.map((date) => fetchYahooDay(date, signal).catch((e) => ({ date, items: [], error: e.message })))
    );
    const flat = [];
    results.forEach((r) => {
      if (r.items) {
        r.items.forEach((it) => {
          flat.push({ ...it, _date: r.date });
        });
      }
    });
    if (!flat.length) throw new Error('no earnings data parsed');
    return flat;
  }

  const renderFallback = (root, onRetry) => {
    root.innerHTML = `
      <div class="tool earn-root">
        <div class="earn-head"><span>美股财报日历</span><span class="earn-status" data-conn>离线</span></div>
        <div class="earn-sub"><span>Yahoo 数据暂不可用，已切换兜底视图</span><span data-time>—</span></div>
        <div class="earn-scroll">
          <div class="earn-fallback">
            <p>公共数据源当前无法返回财报日历，可能原因：</p>
            <ul>
              <li>Yahoo Finance 页面结构变更，导致启发式解析失败；</li>
              <li>代理 /api/proxy 不可达或返回受限；</li>
              <li>当前为非美股财报密集期，数据为空。</li>
            </ul>
            <p>替代方案：</p>
            <ul>
              <li><a href="https://finance.yahoo.com/calendar/earnings" target="_blank" rel="noopener">Yahoo Earnings Calendar →</a></li>
              <li><a href="https://www.tradingview.com/markets/stocks-united-states/earnings/" target="_blank" rel="noopener">TradingView Earnings →</a></li>
              <li><a href="https://www.nasdaq.com/market-activity/earnings" target="_blank" rel="noopener">Nasdaq Earnings →</a></li>
            </ul>
            <p>下方为部分 Mega-Cap 占位（实际请以官方日历为准）。</p>
          </div>
          <table class="earn-table">
            <thead><tr><th>代码</th><th>名称</th><th>时间</th><th>EPS 预期</th><th>市值</th></tr></thead>
            <tbody>
              ${FALLBACK_STOCKS.map((s, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i % 7);
                return `<tr data-tv="${esc(s.tv)}">
                  <td><span class="earn-sym">${esc(s.symbol)}</span></td>
                  <td class="earn-name">${esc(s.name)}</td>
                  <td><span class="earn-time">TNC</span></td>
                  <td class="earn-num">—</td>
                  <td class="earn-num">—</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="earn-foot">
          <span>来源：Yahoo Finance（失败）/ TradingView / 本地占位</span>
          <button class="drag-handle-btn" data-retry style="border-radius:999px;padding:6px 12px;">重试</button>
        </div>
        <div class="tool-hint" data-hint style="display:none"></div>
      </div>`;
    root.querySelector('[data-retry]').addEventListener('click', onRetry);
  };

  const render = (root, items, connEl, timeEl, hintEl, setStatus) => {
    const rows = items
      .map((it) => {
        const symbol = String(it.symbol || '').trim().toUpperCase();
        if (!symbol) return null;
        const name = it.companyName || it.companyShortName || it.name || it.company || '';
        const eps = parseEps(it.epsEstimate);
        const mcap = Number(it.marketCap) || Number(it.marketCapValue);
        const dateStr = it._date || (it.earningsDate ? fmtDate(new Date(it.earningsDate)) : '');
        const t = timeLabel(it);
        const tv = tvSymbol(symbol);
        return {
          symbol,
          name,
          eps,
          mcap,
          dateStr,
          t,
          tv,
          raw: it,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 按日期、再按时间 BMO 在前 AMC 在后
        if (a.dateStr && b.dateStr && a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
        const rank = (x) => (x.t.cls === 'bmo' ? 0 : x.t.cls === 'amc' ? 2 : 1);
        return rank(a) - rank(b);
      });

    if (!rows.length) {
      root.innerHTML = `<div class="earn-empty">未来 ${DAYS_AHEAD} 天暂无解析到财报数据</div>`;
      return;
    }

    root.innerHTML = `
      <table class="earn-table">
        <thead><tr><th>日期</th><th>代码</th><th>名称</th><th>时间</th><th>EPS 预期</th><th>市值</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr data-tv="${esc(r.tv)}" title="点击查看 ${esc(r.symbol)} 图表">
              <td class="earn-date">${esc(r.dateStr || '—')}</td>
              <td><span class="earn-sym">${esc(r.symbol)}</span></td>
              <td class="earn-name">${esc(r.name)}</td>
              <td><span class="earn-time ${r.t.cls}">${esc(r.t.text)}</span></td>
              <td class="earn-num">${Number.isFinite(r.eps) ? esc(fmtNum(r.eps, 2)) : '—'}</td>
              <td class="earn-num">${esc(fmtCap(r.mcap))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;

    root.querySelectorAll('tr[data-tv]').forEach((tr) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        const tv = tr.getAttribute('data-tv');
        if (tv) window.dispatchEvent(new CustomEvent('gt:set-symbol', { detail: { tv } }));
      });
    });

    if (connEl) {
      connEl.textContent = '● LIVE';
      connEl.className = 'earn-status live';
    }
    if (timeEl) timeEl.textContent = `更新 ${new Date().toTimeString().slice(0, 8)} · ${rows.length} 条`;
    if (hintEl) hintEl.style.display = 'none';
    setStatus('online');
  };

  window.GT_EXTRA_TOOLS['earnings'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool earn-root">
          <div class="earn-head">
            <span>美股财报日历</span>
            <span class="earn-status" data-conn>连接中…</span>
          </div>
          <div class="earn-sub">
            <span>未来 ${DAYS_AHEAD} 天 · 代码/名称/时间/EPS 预期/市值</span>
            <span data-time>—</span>
          </div>
          <div class="earn-scroll" data-body>
            <div class="earn-empty">加载中…</div>
          </div>
          <div class="earn-foot">
            <span data-src>来源：Yahoo Finance（代理）</span>
            <span>更新 <b data-foot-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const body = el.querySelector('[data-body]');
      const conn = el.querySelector('[data-conn]');
      const time = el.querySelector('[data-time]');
      const footTime = el.querySelector('[data-foot-time]');
      const hint = el.querySelector('[data-hint]');
      const src = el.querySelector('[data-src]');

      let alive = true;
      let controller = null;
      let timer = null;

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'earn-status';
        setStatus('offline');
      };

      const load = async () => {
        if (!alive) return;
        if (controller) controller.abort();
        controller = new AbortController();
        const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const items = await fetchYahooRange(DAYS_AHEAD, controller.signal);
          if (!alive) return;
          render(body, items, conn, time, hint, setStatus);
          src.textContent = '来源：Yahoo Finance（代理）';
          footTime.textContent = new Date().toTimeString().slice(0, 8);
        } catch (e) {
          clearTimeout(to);
          if (!alive || e.name === 'AbortError') return;
          // 切换兜底视图
          setStatus('offline');
          conn.textContent = '离线';
          conn.className = 'earn-status';
          time.textContent = '使用兜底数据';
          src.textContent = '来源：Yahoo Finance（失败）/ TradingView / 本地占位';
          renderFallback(body, () => {
            body.innerHTML = '<div class="earn-empty">重新加载…</div>';
            load();
          });
          footTime.textContent = new Date().toTimeString().slice(0, 8);
          // 兜底表格行仍可点击跳转
          body.querySelectorAll('tr[data-tv]').forEach((tr) => {
            tr.addEventListener('click', () => {
              const tv = tr.getAttribute('data-tv');
              if (tv) window.dispatchEvent(new CustomEvent('gt:set-symbol', { detail: { tv } }));
            });
          });
        } finally {
          clearTimeout(to);
        }
      };

      setStatus('loading');
      load();
      timer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        if (timer) clearInterval(timer);
        if (controller) controller.abort();
      };
    },
  };
})();
