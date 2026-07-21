/* A股热力图 — 东方财富行情接口（push2delay，延时行情，无需 key）
 * Data: https://push2delay.eastmoney.com/api/qt/clist/get (CORS: Access-Control-Allow-Origin: *)
 *   个股: fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23  fields=f12,f14,f2,f3,f20,f100(行业)
 *   板块: fs=m:90+t:2                          fields=f12,f14,f3,f20
 * 版式仿美股 TradingView 热力图: squarified treemap，按行业分组，市值决定面积。
 * 配色与美股一致: 绿涨红跌（暖系松绿/陶土红，取 CSS 变量 --up/--down），色阶按当前数据动态归一。
 * Registers as custom tool id 'ashareheat' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const EM_API = 'https://push2delay.eastmoney.com/api/qt/clist/get';
  const UT = 'bd1d9ddb04089700cf9c27f6f7426281';
  const REFRESH_MS = 60 * 1000;
  const N_OPTIONS = [40, 80, 120, 200, 500];
  const LS_MODE = 'aheat-mode';
  const LS_N = 'aheat-n';

  const FS_STOCK = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
  const FS_BOARD = 'm:90+t:2';

  /* 热力配色（美股/TradingView 习惯：绿涨红跌；暖系松绿/陶土红，与全站令牌一致。
     常量为兜底值，渲染时优先读取 CSS 变量 --up/--down/--surface-raised，随主题切换） */
  const C_UP = '#4C9F70'; // 松绿（涨）— var(--up) 兜底
  const C_DOWN = '#d05b4b'; // 陶土红（跌）— var(--down) 兜底
  const C_NEUTRAL = '#33291f'; // 暖调深中性（0 附近）— var(--surface-raised) 兜底
  const GROUP_HEADER_H = 15; // 行业分组标题条高度(px)
  const TILE_GAP = 1; // 瓦片间隙(px)

  function injectStyle() {
    if (document.getElementById('aheat-style')) return;
    const style = document.createElement('style');
    style.id = 'aheat-style';
    style.textContent = `
.aheat-root {
  /* 绝对定位铺满 .widget-body（它是 position:relative），高度不依赖
     .tool-root 的百分比解析，也不会被内容撑高 —— 组件内部永不出滚动条，
     热力图始终一张图铺满整个组件区域 */
  position: absolute;
  inset: 0;
  overflow: hidden;
}
/* 覆盖 .widget-body.tool-body 的 overflow-y:auto，禁止热力图组件内滑动 */
.widget-body.tool-body:has(.aheat-root) {
  overflow: hidden !important;
}
.aheat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.aheat-head-right { display: flex; align-items: center; gap: 6px; }
.aheat-mkt {
  display: inline-block;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--text-muted);
}
.aheat-mkt.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.aheat-conn { color: var(--warning); }
.aheat-conn.live { color: var(--acc); }
.aheat-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.aheat-tabs { display: flex; gap: 4px; }
.aheat-tab {
  background: var(--surface-raised);
  color: var(--text-muted);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 3px 12px;
  font-family: inherit;
  cursor: pointer;
}
.aheat-tab.active { color: var(--text); border-color: var(--acc); }
.aheat-tab:focus { outline: 1px solid var(--acc); }
.aheat-sel {
  background: var(--surface-raised);
  color: var(--text);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 3px 6px;
  font-family: inherit;
  cursor: pointer;
}
.aheat-sel:focus { outline: 1px solid var(--acc); }
.aheat-map {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
}
.aheat-group {
  position: absolute;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  overflow: hidden;
}
.aheat-gname {
  display: block;
  height: ${GROUP_HEADER_H}px;
  line-height: ${GROUP_HEADER_H}px;
  padding: 0 4px;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aheat-tile {
  position: absolute;
  border-radius: 3px;
  padding: 3px 4px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  cursor: pointer;
  overflow: hidden;
  transition: filter 0.2s var(--ease-fluid);
}
.aheat-tile:hover { filter: brightness(1.18); z-index: 2; }
.aheat-name {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.aheat-pct {
  font-family: var(--font-mono);
  font-size: 10px;
  color: color-mix(in srgb, var(--text) 92%, transparent);
  font-variant-numeric: tabular-nums;
}
.aheat-tile.t-lg .aheat-name { font-size: 13px; }
.aheat-tile.t-lg .aheat-pct { font-size: 12px; font-weight: 600; }
.aheat-tile.t-md .aheat-name { font-size: 11px; }
.aheat-tile.t-xs .aheat-name { font-size: 9px; font-weight: 400; }
.aheat-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.aheat-legend-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: linear-gradient(to right, var(--down), var(--surface-raised) 50%, var(--up));
}
.aheat-meta {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  /* '#rrggbb' → [r,g,b] */
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  const lerpColor = (ha, hb, t) => {
    const a = hexRgb(ha);
    const b = hexRgb(hb);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  /* 从 CSS 变量解析颜色（读 body 计算样式，body.light-mode 覆盖值随之生效；
     非 #rrggbb 值时回退到文件内常量，保证 lerp 可解析） */
  const heatVar = (name, fallback) => {
    try {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
    } catch (e) {
      return fallback;
    }
  };

  /* 涨跌幅 → 瓦片背景色（绿涨红跌，scale 为当前数据最大 |涨跌幅|，动态归一仿 TradingView） */
  const heatColor = (pct, scale) => {
    const neutral = heatVar('--surface-raised', C_NEUTRAL);
    if (!Number.isFinite(pct)) return neutral;
    const s = scale > 0 ? scale : 1;
    let t = Math.min(Math.abs(pct) / s, 1);
    t = Math.pow(t, 0.6); // 小涨跌幅也能看出颜色层次
    return pct >= 0
      ? lerpColor(neutral, heatVar('--up', C_UP), t)
      : lerpColor(neutral, heatVar('--down', C_DOWN), t);
  };

  const fmtPct = (p) => (Number.isFinite(p) ? `${p > 0 ? '+' : ''}${p.toFixed(2)}%` : '—');

  const fmtCap = (v) => {
    if (!Number.isFinite(v) || v <= 0) return '—';
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
    return `${(v / 1e8).toFixed(0)}亿`;
  };

  /* 北京时间判断交易时段: 周一至周五 9:30-11:30 / 13:00-15:00 */
  const isMarketOpen = () => {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const day = bj.getUTCDay();
    if (day === 0 || day === 6) return false;
    const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes();
    return (mins >= 570 && mins < 690) || (mins >= 780 && mins < 900);
  };

  const fmtClock = () => {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };

  /* 代码 → 行情页前缀: 6→sh, 0/3→sz, 8/4/9→bj */
  const stockUrl = (code) => {
    const c = String(code || '');
    const first = c.charAt(0);
    const mkt = first === '6' ? 'sh' : first === '0' || first === '3' ? 'sz' : 'bj';
    return `https://quote.eastmoney.com/${mkt}${encodeURIComponent(c)}.html`;
  };

  const boardUrl = (code) => `https://quote.eastmoney.com/bk/90.${encodeURIComponent(String(code || ''))}.html`;

  const loadLs = (key, fallback) => {
    try {
      const v = window.localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  };

  const saveLs = (key, val) => {
    try {
      window.localStorage.setItem(key, val);
    } catch (e) { /* 隐私模式下忽略 */ }
  };

  /* squarified treemap（Bruls 算法）：items 需按 w 降序，返回 [{x,y,w,h,it}]。
     以像素面积（weight * unit）计算 worst 长宽比，避免原始权重与像素 side 混用。
     条带方向：容器更宽时铺竖条（沿高方向排列），更高时铺横条（沿宽方向排列）。 */
  const squarify = (items, rect) => {
    const out = [];
    const total = items.reduce((s, it) => s + it.w, 0);
    if (!items.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
    const unit = (rect.w * rect.h) / total; // 每单位权重对应的面积(px²)
    let { x, y, w, h } = rect;

    const worst = (row, side) => {
      if (!row.length || side <= 0) return -Infinity;
      const s = row.reduce((a, b) => a + b.w, 0) * unit; // 行总面积
      let minA = Infinity;
      let maxA = -Infinity;
      for (const it of row) {
        const a = it.w * unit;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
      }
      const s2 = s * s;
      const side2 = side * side;
      return Math.max((side2 * maxA) / s2, s2 / (side2 * minA));
    };

    const flushRow = (row) => {
      const side = Math.min(w, h);
      if (!row.length || side <= 0) return;
      const s = row.reduce((a, b) => a + b.w, 0) * unit;
      const thick = s / side; // 条带厚度（垂直于 side 的方向）
      if (!Number.isFinite(thick) || thick <= 0) return;
      const horiz = w >= h; // 容器更宽 → 竖条带，沿 h 方向排列
      let off = 0;
      for (const it of row) {
        const len = (it.w * unit) / thick;
        out.push(
          horiz
            ? { x: x, y: y + off, w: thick, h: len, it: it.it }
            : { x: x + off, y: y, w: len, h: thick, it: it.it }
        );
        off += len;
      }
      if (horiz) {
        x += thick;
        w -= thick;
      } else {
        y += thick;
        h -= thick;
      }
    };

    let row = [];
    for (const it of items) {
      if (w <= 0 || h <= 0) break;
      if (!row.length) {
        row.push(it);
        continue;
      }
      const side = Math.min(w, h);
      const nextRow = row.concat(it);
      if (worst(row, side) >= worst(nextRow, side)) {
        row = nextRow;
      } else {
        flushRow(row);
        row = [it];
      }
    }
    if (row.length && w > 0 && h > 0) flushRow(row);
    return out;
  };

  window.GT_EXTRA_TOOLS['ashareheat'] = {
    mount(el, setStatus) {
      injectStyle();

      let mode = loadLs(LS_MODE, 'stock') === 'board' ? 'board' : 'stock';
      let topN = N_OPTIONS.indexOf(parseInt(loadLs(LS_N, '80'), 10)) >= 0 ? parseInt(loadLs(LS_N, '80'), 10) : 80;

      el.innerHTML = `
        <div class="tool aheat-root">
          <div class="aheat-head">
            <span>A股 · 热力图</span>
            <span class="aheat-head-right">
              <span class="aheat-mkt" data-mkt>—</span>
              <span class="aheat-conn" data-conn>加载中…</span>
            </span>
          </div>
          <div class="aheat-toolbar">
            <div class="aheat-tabs">
              <button type="button" class="aheat-tab" data-tab="stock">个股</button>
              <button type="button" class="aheat-tab" data-tab="board">行业板块</button>
            </div>
            <select class="aheat-sel" data-n title="按总市值取前 N">
              ${N_OPTIONS.map((n) => `<option value="${n}">前 ${n}</option>`).join('')}
            </select>
          </div>
          <div class="aheat-map" data-map></div>
          <div class="aheat-legend">
            <span data-leg-lo>-</span>
            <span class="aheat-legend-bar"></span>
            <span data-leg-hi>-</span>
          </div>
          <div class="aheat-meta">
            <span data-src>来源: 东方财富(延时行情)</span>
            <span data-time>—</span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const map = el.querySelector('[data-map]');
      const conn = el.querySelector('[data-conn]');
      const mktEl = el.querySelector('[data-mkt]');
      const timeEl = el.querySelector('[data-time]');
      const hint = el.querySelector('[data-hint]');
      const nSel = el.querySelector('[data-n]');
      const legLo = el.querySelector('[data-leg-lo]');
      const legHi = el.querySelector('[data-leg-hi]');
      const tabs = Array.prototype.slice.call(el.querySelectorAll('[data-tab]'));

      let alive = true;
      let refreshTimer = null;
      let aborter = null;
      let lastList = null; // 最近一次数据，resize 时重排版
      let resizeObs = null;
      let resizeRaf = 0;

      nSel.value = String(topN);

      const syncTabs = () => {
        tabs.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === mode));
      };

      const setConn = (state) => {
        if (state === 'live') {
          conn.textContent = '● 已更新';
          conn.className = 'aheat-conn live';
          hint.style.display = 'none';
          setStatus('online');
        } else if (state === 'loading') {
          conn.textContent = '加载中…';
          conn.className = 'aheat-conn';
        } else {
          conn.textContent = '获取失败';
          conn.className = 'aheat-conn';
          hint.textContent = '行情数据获取失败，60 秒后自动重试…';
          hint.style.display = '';
          setStatus('offline');
        }
      };

      const updateMktBadge = () => {
        const open = isMarketOpen();
        mktEl.textContent = open ? '交易中' : '休市';
        mktEl.className = open ? 'aheat-mkt open' : 'aheat-mkt';
      };

      /* 单块瓦片 HTML（坐标相对其包含块） */
      const tileHtml = (r, scale) => {
        const it = r.it;
        const w = Math.max(r.w - TILE_GAP * 2, 0);
        const h = Math.max(r.h - TILE_GAP * 2, 0);
        if (w < 2 || h < 2) return '';
        const area = w * h;
        const cls = area >= 5200 ? 't-lg' : area >= 2400 ? 't-md' : area >= 900 ? 't-sm' : 't-xs';
        const showName = w >= 46 && h >= 20;
        const showPct = w >= 40 && h >= 32;
        const title =
          mode === 'board'
            ? `${it.code} ${it.name}\n涨跌幅: ${fmtPct(it.pct)}\n总市值: ${fmtCap(it.cap)}`
            : `${it.code} ${it.name}\n最新价: ${Number.isFinite(it.price) ? it.price.toFixed(2) : '—'}\n涨跌幅: ${fmtPct(it.pct)}\n总市值: ${fmtCap(it.cap)}`;
        return `<div class="aheat-tile ${cls}" data-code="${esc(it.code)}" title="${esc(title)}"
            style="left:${(r.x + TILE_GAP).toFixed(1)}px;top:${(r.y + TILE_GAP).toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;background:${heatColor(it.pct, scale)}">
          ${showName ? `<span class="aheat-name">${esc(it.name)}</span>` : ''}
          ${showPct ? `<span class="aheat-pct">${esc(fmtPct(it.pct))}</span>` : ''}
        </div>`;
      };

      const render = (list) => {
        const W = map.clientWidth;
        const H = map.clientHeight;
        if (!list.length) {
          map.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 4px;">暂无数据</div>';
          return;
        }
        if (W < 50 || H < 50) return; // 容器尚未就绪，等 resize 触发

        /* 归一化后的条目 */
        const items = list
          .map((it) => ({
            code: String(it.f12 || ''),
            name: String(it.f14 || ''),
            price: parseFloat(it.f2),
            pct: parseFloat(it.f3),
            cap: parseFloat(it.f20),
            ind: String(it.f100 || '其他'),
          }))
          .filter((it) => it.code && Number.isFinite(it.cap) && it.cap > 0);
        if (!items.length) {
          map.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 4px;">暂无数据</div>';
          return;
        }

        /* 色阶动态归一：最大 |涨跌幅|（下限 2%，避免全平盘时色阶过敏感） */
        let maxAbs = 2;
        items.forEach((it) => {
          if (Number.isFinite(it.pct) && Math.abs(it.pct) > maxAbs) maxAbs = Math.abs(it.pct);
        });
        legLo.textContent = `-${maxAbs.toFixed(1)}%`;
        legHi.textContent = `+${maxAbs.toFixed(1)}%`;

        const rect = { x: 0, y: 0, w: W, h: H };
        let html = '';

        if (mode === 'board') {
          /* 板块模式：平铺 squarify */
          items.sort((a, b) => b.cap - a.cap);
          const rects = squarify(items.map((it) => ({ w: it.cap, it })), rect);
          html = rects.map((r) => tileHtml({ x: r.x, y: r.y, w: r.w, h: r.h, it: r.it }, maxAbs)).join('');
        } else {
          /* 个股模式：按行业分组（仿 TradingView sector 分组） */
          const groups = new Map();
          items.forEach((it) => {
            const g = groups.get(it.ind) || { name: it.ind, cap: 0, items: [] };
            g.cap += it.cap;
            g.items.push(it);
            groups.set(it.ind, g);
          });
          const glist = Array.from(groups.values()).sort((a, b) => b.cap - a.cap);
          const grects = squarify(glist.map((g) => ({ w: g.cap, it: g })), rect);
          html = grects
            .map((gr) => {
              const g = gr.it;
              const showHeader = gr.w >= 56 && gr.h >= 46;
              const inner = {
                x: 1,
                y: showHeader ? GROUP_HEADER_H : 1,
                w: Math.max(gr.w - 2, 0),
                h: Math.max(gr.h - (showHeader ? GROUP_HEADER_H : 1) - 1, 0),
              };
              g.items.sort((a, b) => b.cap - a.cap);
              const tiles = squarify(g.items.map((it) => ({ w: it.cap, it })), inner)
                .map((r) => tileHtml(r, maxAbs))
                .join('');
              return `<div class="aheat-group" style="left:${gr.x.toFixed(1)}px;top:${gr.y.toFixed(1)}px;width:${gr.w.toFixed(1)}px;height:${gr.h.toFixed(1)}px">
                ${showHeader ? `<span class="aheat-gname">${esc(g.name)}</span>` : ''}${tiles}</div>`;
            })
            .join('');
        }
        map.innerHTML = html;
      };

      const onTileClick = (ev) => {
        const tile = ev.target && ev.target.closest ? ev.target.closest('.aheat-tile') : null;
        if (!tile) return;
        const code = tile.getAttribute('data-code');
        if (!code) return;
        const url = mode === 'board' ? boardUrl(code) : stockUrl(code);
        window.open(url, '_blank', 'noopener');
      };

      const buildUrl = () => {
        const params = new URLSearchParams({
          pn: '1',
          pz: String(topN),
          po: '1',
          np: '1',
          fltt: '2',
          invt: '2',
          fid: 'f20',
          ut: UT,
        });
        if (mode === 'board') {
          params.set('fs', FS_BOARD);
          params.set('fields', 'f12,f14,f3,f20');
        } else {
          params.set('fs', FS_STOCK);
          params.set('fields', 'f12,f14,f2,f3,f20,f100');
        }
        return `${EM_API}?${params.toString()}`;
      };

      const load = async () => {
        if (!alive) return;
        if (aborter) {
          try {
            aborter.abort();
          } catch (e) { /* 忽略 */ }
        }
        aborter = typeof AbortController !== 'undefined' ? new AbortController() : null;
        setConn('loading');
        updateMktBadge();
        try {
          const res = await fetch(buildUrl(), aborter ? { signal: aborter.signal } : {});
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          if (!alive) return;
          const list = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
          lastList = list;
          render(list);
          timeEl.textContent = `更新 ${fmtClock()} · 60s 刷新`;
          setConn('live');
        } catch (e) {
          if (!alive || (e && e.name === 'AbortError')) return;
          setConn('error');
        }
      };

      const onTabClick = (ev) => {
        const m = ev.currentTarget.getAttribute('data-tab');
        if (m === mode) return;
        mode = m;
        saveLs(LS_MODE, mode);
        syncTabs();
        load();
      };

      const onNChange = () => {
        const v = parseInt(nSel.value, 10);
        if (N_OPTIONS.indexOf(v) < 0 || v === topN) return;
        topN = v;
        saveLs(LS_N, String(topN));
        load();
      };

      /* 组件尺寸变化时用缓存数据重排版 */
      const onResize = () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          if (alive && lastList) render(lastList);
        });
      };

      syncTabs();
      map.addEventListener('click', onTileClick);
      tabs.forEach((b) => b.addEventListener('click', onTabClick));
      nSel.addEventListener('change', onNChange);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(onResize);
        resizeObs.observe(map);
      }

      load();
      refreshTimer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        if (aborter) {
          try {
            aborter.abort();
          } catch (e) { /* 忽略 */ }
          aborter = null;
        }
        if (resizeObs) {
          resizeObs.disconnect();
          resizeObs = null;
        }
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = 0;
        }
        map.removeEventListener('click', onTileClick);
        tabs.forEach((b) => b.removeEventListener('click', onTabClick));
        nSel.removeEventListener('change', onNChange);
      };
    },
  };
})();
