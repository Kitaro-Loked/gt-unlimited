/* 美股热门行情板 — 东财美股榜单(CORS JSON)
 * 榜单: https://push2.eastmoney.com/api/qt/clist/get （fs=m:105,m:106,m:107 纳斯达克/纽交所/美交所，
 *       响应头 Access-Control-Allow-Origin: *，失败时回退 push2delay 延时行情）
 * 字段（curl 实测 2026-07）：f12=代码 f14=名称 f2=最新价(美元) f3=涨跌幅% f20=总市值(美元)
 * 注意：美股绿涨红跌（国际习惯），方向着色用 usboard-up/usboard-down 类映射 var(--up)/var(--down)。
 * Registers as custom tool id 'usboard' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const EM_FS = 'm:105,m:106,m:107'; // 美股：纳斯达克/纽交所/美交所
  const EM_FIELDS = 'f12,f14,f2,f3,f20'; // 代码/名称/最新价/涨跌幅%/总市值
  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com']; // 后者为延时行情兜底
  const TABS = [
    { key: 'mcap', label: '市值榜', fid: 'f20', po: 1 },
    { key: 'up', label: '涨幅榜', fid: 'f3', po: 1 },
    { key: 'down', label: '跌幅榜', fid: 'f3', po: 0 },
    { key: 'sectors', label: '板块ETF', isSectors: true },
  ];

  // 美股行业 ETF（热力图视图）
  const SECTOR_ETFS = [
    { sym: 'XLK', name: '科技' },
    { sym: 'XLF', name: '金融' },
    { sym: 'XLE', name: '能源' },
    { sym: 'XLI', name: '工业' },
    { sym: 'XLP', name: '消费必需品' },
    { sym: 'XLV', name: '医疗' },
    { sym: 'XLU', name: '公用事业' },
    { sym: 'XLRE', name: '房地产' },
    { sym: 'XLC', name: '通信' },
    { sym: 'XBI', name: '生科' },
    { sym: 'XRT', name: '零售' },
    { sym: 'SMH', name: '半导体' },
    { sym: 'SOXX', name: '半导体(纳斯)' },
    { sym: 'GDX', name: '黄金矿业' },
    { sym: 'OIH', name: '油服' },
    { sym: 'KRE', name: '区域银行' },
  ];
  const ETF_SECIDS = SECTOR_ETFS.map((s) => '106.' + s.sym).join(','); // 板块ETF多在纽交所
  const ETF_FIELDS = 'f12,f14,f2,f3,f4';
  const PAGE_SIZE = 20;
  const emUrl = (host, tab) =>
    `${host}/api/qt/clist/get?pn=1&pz=${PAGE_SIZE}&po=${tab.po}&np=1&fltt=2&invt=2&fid=${tab.fid}` +
    `&fs=${encodeURIComponent(EM_FS)}&fields=${EM_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`;
  const etfUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${ETF_FIELDS}&secids=${ETF_SECIDS}`;
  const quoteUrl = (code) => `https://quote.eastmoney.com/us/${encodeURIComponent(code)}.html`;

  const REFRESH_MS = 60000; // 交易时段刷新间隔
  const IDLE_REFRESH_MS = 5 * 60 * 1000; // 休市时低频刷新（兼顾开/收盘切换）
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('usboard-style')) return;
    const style = document.createElement('style');
    style.id = 'usboard-style';
    style.textContent = `
.usboard-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.usboard-head-right { display: flex; align-items: center; gap: 8px; }
.usboard-session {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.usboard-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.usboard-status { color: var(--warning); white-space: nowrap; }
.usboard-status.live { color: var(--acc); }
/* 美股绿涨红跌（国际习惯）：var(--up)=涨、var(--down)=跌 */
.usboard-up { color: var(--up); }
.usboard-down { color: var(--down); }
.usboard-flat { color: var(--text-muted); }
.usboard-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.usboard-tab {
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.usboard-tab:hover { color: var(--text); border-color: var(--text-dim); }
.usboard-tab.active {
  color: var(--acc);
  border-color: var(--acc-dim);
  background: var(--acc-glow);
}
.usboard-table { font-variant-numeric: tabular-nums; }
.usboard-table th, .usboard-table td { white-space: nowrap; }
.usboard-table tbody tr { cursor: pointer; }
.usboard-rank { font-family: var(--font-mono); color: var(--text-dim); width: 24px; }
.usboard-stock { font-weight: 600; }
.usboard-stock i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 10px; margin-left: 4px; }
.usboard-num { font-family: var(--font-mono); }
.usboard-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.usboard-foot {
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.usboard-sector-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
@media (max-width: 720px) {
  .usboard-sector-grid { grid-template-columns: repeat(2, 1fr); }
}
.usboard-sector-tile {
  border-radius: var(--radius-sm);
  padding: 8px;
  min-height: 58px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform 0.15s var(--ease-snap), box-shadow 0.2s var(--ease-fluid);
  text-decoration: none;
  overflow: hidden;
}
.usboard-sector-tile:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
.usboard-sector-name {
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.usboard-sector-sym {
  font-size: 8px;
  color: rgba(255,255,255,0.78);
  font-family: var(--font-mono);
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.usboard-sector-pct {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  text-align: right;
  white-space: nowrap;
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

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + fmtNum(v, digits);
  };

  // 总市值（美元）→ 亿美元
  const fmtMcap = (usd) => {
    if (!Number.isFinite(usd)) return '—';
    return `${fmtNum(usd / 1e8, 0)}亿`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'usboard-flat';
    return v > 0 ? 'usboard-up' : 'usboard-down';
  };

  // 热力图 tile 颜色：按涨跌幅 -3% .. +3% 在 surface-raised 与 --up/--down 之间插值
  const sectorTileColor = (pct) => {
    if (!Number.isFinite(pct)) return 'var(--surface-raised)';
    const up = getComputedStyle(document.documentElement).getPropertyValue('--up').trim() || '#4C9F70';
    const down = getComputedStyle(document.documentElement).getPropertyValue('--down').trim() || '#D05B4B';
    const max = 3;
    const t = Math.max(-max, Math.min(max, pct)) / max;
    if (t === 0) return 'var(--surface-raised)';
    const target = t > 0 ? up : down;
    const opacity = 0.35 + Math.abs(t) * 0.45;
    return `color-mix(in srgb, ${target} ${Math.round(opacity * 100)}%, var(--surface-raised))`;
  };

  // 美东时间（America/New_York，自动处理夏令时）交易时段：周一至五 09:30-16:00（不含法定节假日，仅按星期粗判）
  const sessionState = () => {
    let et;
    try {
      et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    } catch (e) {
      et = new Date(); // 极端环境回退本地时区
    }
    const day = et.getDay();
    const mins = et.getHours() * 60 + et.getMinutes();
    if (day === 0 || day === 6) return 'closed';
    if (mins >= 570 && mins < 960) return 'trading';
    return 'closed';
  };

  window.GT_EXTRA_TOOLS['usboard'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool usboard-root">
          <div class="usboard-head">
            <span>美股 · 热门行情板</span>
            <span class="usboard-head-right">
              <span class="usboard-session" data-session>—</span>
              <span class="usboard-status" data-conn>连接中…</span>
            </span>
          </div>
          <div class="usboard-tabs">
            ${TABS.map(
              (t, i) => `<button type="button" class="usboard-tab${i === 0 ? ' active' : ''}" data-tab="${esc(t.key)}">${esc(t.label)}</button>`
            ).join('')}
          </div>
          <table class="data-table usboard-table">
            <thead><tr><th>#</th><th>名称</th><th>现价($)</th><th>涨跌幅</th><th>总市值($)</th></tr></thead>
            <tbody data-body></tbody>
          </table>
          <div class="usboard-foot">
            <span data-src>来源：东方财富 · 美股（纳斯达克/纽交所/美交所）</span>
            <span data-updated></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const sessionEl = el.querySelector('[data-session]');
      const hint = el.querySelector('[data-hint]');
      const tbody = el.querySelector('[data-body]');
      const srcEl = el.querySelector('[data-src]');
      const updatedEl = el.querySelector('[data-updated]');
      const tabBtns = Array.prototype.slice.call(el.querySelectorAll('[data-tab]'));

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let activeTab = TABS[0].key;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'usboard-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'usboard-status live';
        setStatus('online');
      };

      const renderSession = () => {
        const s = sessionState();
        if (s === 'trading') {
          sessionEl.textContent = '● 交易中';
          sessionEl.className = 'usboard-session open';
        } else {
          sessionEl.textContent = '休市';
          sessionEl.className = 'usboard-session';
        }
        return s;
      };

      // 东财榜单：CORS fetch，push2 失败时回退 push2delay（延时行情）
      const fetchBoard = async (tab) => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i], tab), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('board error');
      };

      // 板块 ETF：东财 ulist 批量拉取
      const fetchSectors = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(etfUrl(EM_HOSTS[i]), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            return { rows: diff, delayed: i > 0 };
          } catch (e) {
            lastErr = e;
          } finally {
            clearTimeout(timer);
            pendingTimers.delete(timer);
            pendingAborts.delete(ctrl);
          }
        }
        throw lastErr || new Error('sectors error');
      };

      const renderBoard = (result) => {
        const rows = result.rows
          .map((r) => ({
            code: String(r.f12 || ''),
            name: String(r.f14 || ''),
            price: Number(r.f2),
            pct: Number(r.f3),
            mcap: Number(r.f20),
          }))
          .filter((r) => r.code)
          .slice(0, PAGE_SIZE);
        srcEl.textContent = `来源：东方财富 · 美股（纳斯达克/纽交所/美交所）${result.delayed ? ' · 延时行情' : ''}`;
        if (!rows.length) {
          tbody.innerHTML = `<tr class="usboard-empty"><td colspan="5">暂无数据</td></tr>`;
          return;
        }
        tbody.innerHTML = rows
          .map(
            (r, i) => `
            <tr data-code="${esc(r.code)}">
              <td class="usboard-rank">${i + 1}</td>
              <td class="usboard-stock">${esc(r.name)}<i>${esc(r.code)}</i></td>
              <td class="usboard-num ${dirClass(r.pct)}">${Number.isFinite(r.price) ? esc(fmtNum(r.price, 2)) : '—'}</td>
              <td class="usboard-num ${dirClass(r.pct)}">${Number.isFinite(r.pct) ? esc(fmtSigned(r.pct, 2)) + '%' : '—'}</td>
              <td class="usboard-num">${esc(fmtMcap(r.mcap))}</td>
            </tr>`
          )
          .join('');
      };

      const renderBoardError = () => {
        tbody.innerHTML = `<tr class="usboard-empty"><td colspan="5">榜单加载失败</td></tr>`;
      };

      const renderSectors = (result) => {
        const bySym = {};
        result.rows.forEach((r) => {
          if (r && r.f12 != null) bySym[String(r.f12)] = r;
        });
        srcEl.textContent = `来源：东方财富 · 美股行业ETF${result.delayed ? ' · 延时行情' : ''}`;
        const tiles = SECTOR_ETFS.map((etf) => {
          const r = bySym[etf.sym];
          const pct = r ? Number(r.f3) : NaN;
          const name = r && r.f14 ? String(r.f14) : etf.name;
          const cls = !Number.isFinite(pct) || pct === 0 ? 'usboard-flat' : (pct > 0 ? 'usboard-up' : 'usboard-down');
          return `
            <a class="usboard-sector-tile ${cls}" href="${esc(quoteUrl(etf.sym))}" target="_blank" rel="noopener"
               style="background:${sectorTileColor(pct)}" title="${esc(name)} ${esc(etf.sym)}">
              <div>
                <div class="usboard-sector-name">${esc(name)}</div>
                <div class="usboard-sector-sym">${esc(etf.sym)}</div>
              </div>
              <div class="usboard-sector-pct">${Number.isFinite(pct) ? esc(fmtSigned(pct, 2)) + '%' : '—'}</div>
            </a>`;
        }).join('');
        tbody.innerHTML = `<tr><td colspan="5"><div class="usboard-sector-grid">${tiles}</div></td></tr>`;
      };

      const renderSectorsError = () => {
        tbody.innerHTML = `<tr class="usboard-empty"><td colspan="5">板块ETF加载失败</td></tr>`;
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        const tab = TABS.find((t) => t.key === activeTab) || TABS[0];
        try {
          if (tab.isSectors) {
            const result = await fetchSectors();
            if (!alive) return;
            renderSectors(result);
          } else {
            const result = await fetchBoard(tab);
            if (!alive) return;
            renderBoard(result);
          }
          updatedEl.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
          clearError();
        } catch (e) {
          if (!alive) return;
          if (tab.isSectors) renderSectorsError();
          else renderBoardError();
          showError('榜单加载失败，60 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const onTabClick = (ev) => {
        const key = ev.currentTarget.getAttribute('data-tab');
        if (!key || key === activeTab) return;
        activeTab = key;
        tabBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === key));
        tbody.innerHTML = `<tr class="usboard-empty"><td colspan="5">加载中…</td></tr>`;
        refresh();
      };
      tabBtns.forEach((b) => b.addEventListener('click', onTabClick));

      // 行点击跳转东财美股详情页（新标签页，noopener）
      const onRowClick = (ev) => {
        const tr = ev.target && ev.target.closest ? ev.target.closest('tr[data-code]') : null;
        if (!tr) return;
        const code = tr.getAttribute('data-code');
        if (code) window.open(quoteUrl(code), '_blank', 'noopener');
      };
      tbody.addEventListener('click', onRowClick);

      const tick = () => {
        if (!alive) return;
        const s = renderSession();
        if (s === 'trading' || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      renderSession();
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
          } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
        tabBtns.forEach((b) => b.removeEventListener('click', onTabClick));
        tbody.removeEventListener('click', onRowClick);
      };
    },
  };
})();
