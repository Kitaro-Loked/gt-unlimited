/* 全球股指行情板 — 东财全球指数行情(CORS JSON) + TradingView 图表兜底
 * 接口: https://push2.eastmoney.com/api/qt/ulist.np/get （响应头 Access-Control-Allow-Origin: *，
 *       失败时回退 push2delay.eastmoney.com 延时行情）
 * 字段: f12=代码 f13=市场 f14=名称 f2=最新价 f3=涨跌幅% f4=涨跌额
 * 变更(v14):
 *   - 删除印度 Nifty50。
 *   - 中东板块因 TradingView 受限，改为展示交易所状态 + 官方/Investing 链接，不再嵌入 TV 迷你图。
 * 注意：本组件绿涨红跌（国际习惯），方向着色用 gidx-up/gidx-down 类。
 * Registers as custom tool id 'globalidx' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // secid → TradingView symbol 兜底映射（显式 tv 字段优先级更高）
  const TV_MAP = {
    '1.000001': 'SSE:000001',
    '0.399001': 'SZSE:399001',
    '0.399006': 'SZSE:399006',
    '100.HSI': 'INDEX:HSI',
    '100.N225': 'INDEX:N225',
    '100.KS11': 'INDEX:KS11',
    '100.AS51': 'INDEX:AS51',
    '100.SENSEX': 'BSE:SENSEX',
    '100.FTSE': 'INDEX:FTSE',
    '100.GDAXI': 'INDEX:GDAXI',
    '100.FCHI': 'INDEX:FCHI',
    '100.SX5E': 'INDEX:SX5E',
    '100.SSMI': 'INDEX:SMI',
    '100.AEX': 'INDEX:AEX',
    '100.IBEX': 'INDEX:IBEX',
    '100.DJIA': 'INDEX:DJI',
    '100.NDX': 'INDEX:NDX',
    '100.SPX': 'INDEX:SPX',
    '100.BVSP': 'BMFBOVESPA:IBOV',
    '100.MXX': 'BMV:ME',
    '100.MERVAL': 'BCBA:IMV',
    '100.TASI': 'TADAWUL:TASI',
    '100.DFMGI': 'DFM:DFMGI',
    '100.QSI': 'QSE:GNRI',
    '100.SET': 'SET:SET',
    '100.KLSE': 'MYX:FBMKLCI',
    '100.JKSE': 'IDX:COMPOSITE',
    '100.PSEI': 'PSE:PSEI',
    '100.VNINDEX': 'HOSE:VNINDEX',
    '100.KSE100': 'KSE:KSE100',
    '100.JALSH': 'JSE:J200',
    '100.IMOEX': 'MOEX:IMOEX',
    '100.RTS': 'INDEX:RTS',
  };

  const tvSymbol = (item) => item.tv || TV_MAP[item.secid] || '';

  // 中东交易日：沙特/卡塔尔/以色列周日-周四；阿联酋周一至周五
  const GROUPS = [
    {
      name: '亚太',
      items: [
        { secid: '1.000001', code: '000001', name: '上证指数', url: 'https://quote.eastmoney.com/zs000001.html' },
        { secid: '0.399001', code: '399001', name: '深证成指', url: 'https://quote.eastmoney.com/zs399001.html' },
        { secid: '0.399006', code: '399006', name: '创业板指', url: 'https://quote.eastmoney.com/zs399006.html' },
        { secid: '100.HSI', code: 'HSI', name: '恒生指数', url: 'https://quote.eastmoney.com/gb/zsHSI.html' },
        { secid: '100.N225', code: 'N225', name: '日经225', url: 'https://quote.eastmoney.com/gb/zsN225.html' },
        { secid: '100.KS11', code: 'KS11', name: '韩国KOSPI', url: 'https://quote.eastmoney.com/gb/zsKS11.html' },
        { secid: '100.AS51', code: 'AS51', name: '澳大利亚标普200', url: 'https://quote.eastmoney.com/gb/zsAS51.html' },
      ],
    },
    {
      name: '南亚',
      items: [
        { secid: '100.SENSEX', code: 'SENSEX', name: '印度孟买SENSEX', url: 'https://quote.eastmoney.com/gb/zsSENSEX.html' },
        { secid: '100.KSE100', code: 'KSE100', name: '巴基斯坦KSE100', url: 'https://quote.eastmoney.com/gb/zsKSE100.html', tv: 'KSE:KSE100' },
      ],
    },
    {
      name: '欧洲',
      items: [
        { secid: '100.FTSE', code: 'FTSE', name: '英国富时100', url: 'https://quote.eastmoney.com/gb/zsFTSE.html' },
        { secid: '100.GDAXI', code: 'GDAXI', name: '德国DAX30', url: 'https://quote.eastmoney.com/gb/zsGDAXI.html' },
        { secid: '100.FCHI', code: 'FCHI', name: '法国CAC40', url: 'https://quote.eastmoney.com/gb/zsFCHI.html' },
        { secid: '100.SX5E', code: 'SX5E', name: '欧洲斯托克50', url: 'https://quote.eastmoney.com/gb/zsSX5E.html' },
        { secid: '100.SSMI', code: 'SSMI', name: '瑞士SMI', url: 'https://quote.eastmoney.com/gb/zsSSMI.html' },
        { secid: '100.AEX', code: 'AEX', name: '荷兰AEX', url: 'https://quote.eastmoney.com/gb/zsAEX.html' },
        { secid: '100.IBEX', code: 'IBEX', name: '西班牙IBEX35', url: 'https://quote.eastmoney.com/gb/zsIBEX.html' },
      ],
    },
    {
      name: '美洲',
      items: [
        { secid: '100.DJIA', code: 'DJIA', name: '道琼斯', url: 'https://quote.eastmoney.com/gb/zsDJIA.html' },
        { secid: '100.NDX', code: 'NDX', name: '纳斯达克', url: 'https://quote.eastmoney.com/gb/zsNDX.html' },
        { secid: '100.SPX', code: 'SPX', name: '标普500', url: 'https://quote.eastmoney.com/gb/zsSPX.html' },
        { secid: '100.BVSP', code: 'BVSP', name: '巴西Bovespa', url: 'https://quote.eastmoney.com/gb/zsBVSP.html' },
        { secid: '100.MXX', code: 'MXX', name: '墨西哥IPC', url: 'https://quote.eastmoney.com/gb/zsMXX.html' },
        { secid: '100.MERVAL', code: 'MERVAL', name: '阿根廷MERVAL', url: 'https://quote.eastmoney.com/gb/zsMERVAL.html' },
      ],
    },
    {
      name: '中东',
      items: [
        { code: 'TASI', name: '沙特Tadawul', url: 'https://www.investing.com/indices/saudi-arabia-tadawul', tz: 'Asia/Riyadh', open: [10, 0], close: [15, 0], days: [0, 1, 2, 3, 4] },
        { code: 'DFMGI', name: '迪拜DFM', url: 'https://www.investing.com/indices/dubai-financial-market-general-index', tz: 'Asia/Dubai', open: [10, 0], close: [15, 0], weekdays: true },
        { code: 'GNRI', name: '卡塔尔QE', url: 'https://www.investing.com/indices/qatar-general-index', tz: 'Asia/Qatar', open: [9, 30], close: [13, 10], days: [0, 1, 2, 3, 4] },
        { code: 'TA35', name: '以色列TA35', url: 'https://www.investing.com/indices/ta-35', tz: 'Asia/Jerusalem', open: [10, 0], close: [17, 25], days: [0, 1, 2, 3, 4] },
      ],
    },
    {
      name: '东南亚',
      items: [
        { secid: '100.SET', code: 'SET', name: '泰国SET', url: 'https://quote.eastmoney.com/gb/zsSET.html' },
        { secid: '100.KLSE', code: 'KLSE', name: '马来西亚KLSE', url: 'https://quote.eastmoney.com/gb/zsKLSE.html' },
        { secid: '100.JKSE', code: 'JKSE', name: '印尼IDX', url: 'https://quote.eastmoney.com/gb/zsJKSE.html' },
        { secid: '100.PSEI', code: 'PSEI', name: '菲律宾PSEi', url: 'https://quote.eastmoney.com/gb/zsPSEI.html' },
        { secid: '100.VNINDEX', code: 'VNINDEX', name: '越南VN-Index', url: 'https://quote.eastmoney.com/gb/zsVNINDEX.html' },
      ],
    },
    {
      name: '非洲 / 俄罗斯',
      items: [
        { code: 'J200', name: '南非JSE Top40', url: 'https://www.investing.com/indices/jse-top-40', tv: 'JSE:J200', tvOnly: true },
        { code: 'IMOEX', name: '俄罗斯MOEX', url: 'https://www.investing.com/indices/mcx', tv: 'MOEX:IMOEX', tvOnly: true },
        { secid: '100.RTS', code: 'RTS', name: '俄罗斯RTS', url: 'https://quote.eastmoney.com/gb/zsRTS.html' },
      ],
    },
  ];

  const ALL = GROUPS.reduce((acc, g) => {
    g.items.forEach((it) => {
      it.tv = tvSymbol(it);
      if (!acc.find((x) => x.secid === it.secid && x.tv === it.tv)) acc.push(it);
    });
    return acc;
  }, []);
  const EM_ITEMS = ALL.filter((i) => i.secid);

  const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com'];
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f4';
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${EM_FIELDS}&secids=${EM_ITEMS.map((i) => i.secid).join(',')}`;

  // 莫斯科交易所 ISS API 兜底（俄罗斯 MOEX 受制裁，TV scanner 无数据）
  const MOEX_ISS_URL = 'https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json';
  const proxyUrl = (target) => `/api/proxy?url=${encodeURIComponent(target)}`;
  async function fetchMoexFallback() {
    try {
      const resp = await fetch(proxyUrl(MOEX_ISS_URL), { cache: 'no-store' });
      if (!resp.ok) return null;
      const json = await resp.json();
      const cols = json && json.marketdata && json.marketdata.columns;
      const row = json && json.marketdata && Array.isArray(json.marketdata.data) && json.marketdata.data[0];
      if (!cols || !row) return null;
      const current = row[cols.indexOf('CURRENTVALUE')];
      const change = row[cols.indexOf('LASTCHANGE')];
      const pct = row[cols.indexOf('LASTCHANGEPRC')];
      if (!Number.isFinite(Number(current))) return null;
      return { f2: Number(current), f3: Number(pct), f4: Number(change), source: 'MOEX ISS' };
    } catch (e) {
      return null;
    }
  }

  const REFRESH_MS = 60000;
  const IDLE_REFRESH_MS = 5 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('gidx-style')) return;
    const style = document.createElement('style');
    style.id = 'gidx-style';
    style.textContent = `
.gidx-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.gidx-status { color: var(--warning); white-space: nowrap; }
.gidx-status.live { color: var(--acc); }
.gidx-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.gidx-delayed {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--warning);
  color: var(--warning);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.gidx-up { color: var(--up); }
.gidx-down { color: var(--down); }
.gidx-flat { color: var(--text-muted); }
.gidx-group { margin-bottom: 8px; }
.gidx-group-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.gidx-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 720px) {
  .gidx-grid { grid-template-columns: repeat(2, 1fr); }
}
.gidx-card {
  display: block;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
  text-decoration: none;
  transition: border-color 0.15s var(--ease-snap);
}
.gidx-card:hover { border-color: var(--acc-dim); }
.gidx-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.gidx-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gidx-code {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.gidx-price {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gidx-chg {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
  white-space: nowrap;
}
.gidx-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
}
.gidx-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
.gidx-tv {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  color: var(--acc);
  font-size: 8px;
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s var(--ease-fluid);
}
.gidx-tv:hover { border-color: var(--acc-dim); background: var(--acc-glow); }
.gidx-tv-wrap {
  margin-top: 6px;
  height: 120px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--hairline);
  background: var(--surface);
}
.gidx-card:has(.gidx-tv-wrap[style*="block"]) { grid-column: span 2; }
@media (max-width: 720px) {
  .gidx-card:has(.gidx-tv-wrap[style*="block"]) { grid-column: span 2; }
}
.gidx-tvonly .gidx-price,
.gidx-tvonly .gidx-chg { color: var(--text-dim); }
/* 中东交易所状态卡片 */
.gidx-mea { border-style: dashed; }
.gidx-mea .gidx-status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 10px;
  font-family: var(--font-mono);
}
.gidx-mea .gidx-session {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  font-size: 9px;
}
.gidx-mea .gidx-session.open { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); }
.gidx-mea .gidx-session.closed { color: var(--text-muted); border-color: var(--hairline); }
.gidx-mea .gidx-link {
  font-size: 9px;
  color: var(--acc);
  text-decoration: none;
}
.gidx-mea .gidx-link:hover { text-decoration: underline; }
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

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'gidx-flat';
    return v > 0 ? 'gidx-up' : 'gidx-down';
  };

  const isIdle = () => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  };

  const safeId = (secid) => String(secid || 'tv').replace(/[^a-zA-Z0-9]/g, '-');

  // 中东/特殊市场状态计算
  function marketState(item) {
    if (!item.tz) return null;
    let local;
    try {
      local = new Date(new Date().toLocaleString('en-US', { timeZone: item.tz }));
    } catch (e) {
      return null;
    }
    const day = local.getDay();
    const mins = local.getHours() * 60 + local.getMinutes();
    const days = item.days || (item.weekdays ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]);
    if (!days.includes(day)) {
      // 下一交易日
      let nextGap = null;
      for (let off = 1; off <= 8 && nextGap === null; off++) {
        if (days.includes((day + off) % 7)) nextGap = off;
      }
      return { state: 'closed', label: `休市·距开盘 ${nextGap || '-'}天` };
    }
    const openM = item.open[0] * 60 + item.open[1];
    const closeM = item.close[0] * 60 + item.close[1];
    if (mins < openM) return { state: 'closed', label: `未开盘·${Math.floor((openM - mins) / 60)}h${String((openM - mins) % 60).padStart(2, '0')}m` };
    if (mins < closeM) return { state: 'open', label: `交易中·剩${Math.floor((closeM - mins) / 60)}h${String((closeM - mins) % 60).padStart(2, '0')}m` };
    return { state: 'closed', label: '已收盘' };
  }

  window.GT_EXTRA_TOOLS['globalidx'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool gidx-root">
          <div class="gidx-head">
            <span>全球股指 · 行情板</span>
            <span class="gidx-status" data-conn>连接中…</span>
          </div>
          <div class="gidx-sub">
            <span>亚太 / 南亚 / 欧洲 / 美洲 / 中东 / 东南亚 / 非洲 / 俄罗斯 · 绿涨红跌 · 60s 自动刷新</span>
            <span class="gidx-delayed" data-delayed style="display:none">延时行情</span>
          </div>
          ${GROUPS.map(
            (g, gi) => `
            <div class="gidx-group">
              <div class="gidx-group-title">${esc(g.name)}</div>
              <div class="gidx-grid">
                ${g.items
                  .map(
                    (idx) => {
                      const isMea = g.name === '中东';
                      return `
                  <a class="gidx-card ${idx.tvOnly ? 'gidx-tvonly' : ''} ${isMea ? 'gidx-mea' : ''}" href="${esc(idx.url)}" target="_blank" rel="noopener" data-group="${gi}" data-secid="${esc(idx.secid || '')}" data-tv="${esc(idx.tv || '')}" data-tvonly="${idx.tvOnly ? '1' : ''}" ${isMea ? `data-mea="${esc(JSON.stringify({ tz: idx.tz, open: idx.open, close: idx.close, days: idx.days, weekdays: idx.weekdays }))}"` : ''}>
                    <div class="gidx-card-top">
                      <span class="gidx-name" data-name>${esc(idx.name)}</span>
                      <span class="gidx-code">${esc(idx.code)} ${!isMea ? '<span class="gidx-tv" data-tvbtn title="TradingView 图表">TV</span>' : ''}</span>
                    </div>
                    <div class="gidx-price gidx-flat" data-price>—</div>
                    <div class="gidx-chg"><span data-chg class="gidx-flat">—</span><span data-pct class="gidx-flat">—</span></div>
                    ${isMea ? `<div class="gidx-status-line"><span class="gidx-session closed" data-session>—</span><span class="gidx-link">查看行情 →</span></div>` : ''}
                    <div class="gidx-tv-wrap" data-tvwrap style="display:none"></div>
                  </a>`;
                    }
                  )
                  .join('')}
              </div>
            </div>`
          ).join('')}
          <div class="gidx-foot">
            <span data-src>来源：东方财富 / TradingView</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const delayedEl = el.querySelector('[data-delayed]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const cards = {};
      el.querySelectorAll('.gidx-card').forEach((card) => {
        cards[card.getAttribute('data-secid') || card.getAttribute('data-tv')] = {
          el: card,
          name: card.querySelector('[data-name]'),
          price: card.querySelector('[data-price]'),
          chg: card.querySelector('[data-chg]'),
          pct: card.querySelector('[data-pct]'),
          tvwrap: card.querySelector('[data-tvwrap]'),
        };
      });

      // 中东状态刷新
      const refreshMea = () => {
        el.querySelectorAll('[data-mea]').forEach((card) => {
          const info = JSON.parse(card.getAttribute('data-mea') || '{}');
          const st = marketState(info);
          const badge = card.querySelector('[data-session]');
          if (badge && st) {
            badge.textContent = st.label;
            badge.className = `gidx-session ${st.state}`;
          }
        });
      };
      refreshMea();
      const meaTimer = setInterval(refreshMea, 30000);

      const tvInstances = new Map();
      const openTvChart = (card) => {
        const tv = card.getAttribute('data-tv');
        const wrap = card.querySelector('[data-tvwrap]');
        if (!tv || !wrap) return;
        const showing = wrap.style.display === 'block';
        if (showing) {
          wrap.style.display = 'none';
          wrap.innerHTML = '';
          tvInstances.delete(tv);
          return;
        }
        wrap.style.display = 'block';
        const containerId = `gidx-tv-${safeId(card.getAttribute('data-secid'))}-${safeId(tv)}`;
        wrap.innerHTML = `<div id="${containerId}" style="height:100%"></div>`;
        if (typeof TradingView !== 'undefined') {
          try {
            tvInstances.set(tv, new TradingView.widget({
              autosize: true,
              symbol: tv,
              interval: 'D',
              timezone: 'Asia/Hong_Kong',
              theme: (document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white')) ? 'light' : 'dark',
              style: '3',
              locale: 'zh_CN',
              toolbar_bg: '#f1f3f6',
              enable_publishing: false,
              hide_top_toolbar: true,
              save_image: false,
              container_id: containerId,
            }));
          } catch (e) {
            wrap.innerHTML = `<div style="padding:8px;font-size:10px;color:var(--text-muted)">TradingView 图表加载失败</div>`;
          }
        } else {
          wrap.innerHTML = `<div style="padding:8px;font-size:10px;color:var(--text-muted)">TradingView 脚本未加载</div>`;
        }
      };

      const toggleTv = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const card = ev.target.closest('.gidx-card');
        if (!card) return;
        openTvChart(card);
      };
      el.querySelectorAll('[data-tvbtn]').forEach((btn) => btn.addEventListener('click', toggleTv));

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      const pendingTimers = new Set();
      const pendingAborts = new Set();

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'gidx-status';
        setStatus('offline');
      };
      const clearError = (delayed) => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'gidx-status live';
        delayedEl.style.display = delayed ? '' : 'none';
        srcEl.textContent = delayed ? '来源：东方财富（延时行情）/ TradingView' : '来源：东方财富 / TradingView';
        setStatus('online');
      };

      const fetchQuotes = async () => {
        let lastErr = null;
        if (!EM_ITEMS.length) throw new Error('no eastmoney symbols');
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(emUrl(EM_HOSTS[i]), { signal: ctrl.signal, cache: 'no-store' });
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
        throw lastErr || new Error('quotes error');
      };

      const render = (result, moexData) => {
        const bySecid = {};
        if (result && result.rows) {
          result.rows.forEach((r) => {
            if (r && r.f12 != null && r.f13 != null) bySecid[`${r.f13}.${r.f12}`] = r;
          });
        }

        const updateCard = (key, r, sourceLabel) => {
          const c = cards[key];
          if (!c) return;
          if (!r) {
            c.price.textContent = '—';
            c.chg.textContent = '—';
            c.pct.textContent = '—';
            c.price.className = 'gidx-price gidx-flat';
            c.chg.className = 'gidx-flat';
            c.pct.className = 'gidx-flat';
            return;
          }
          const price = Number(r.f2);
          const pct = Number(r.f3);
          const chg = Number(r.f4);
          if (r.f14) c.name.textContent = String(r.f14);
          const cls = dirClass(chg);
          c.price.textContent = fmtNum(price, 2);
          c.price.className = `gidx-price ${cls}`;
          c.chg.textContent = fmtSigned(chg, 2);
          c.chg.className = cls;
          c.pct.textContent = Number.isFinite(pct) ? `${fmtSigned(pct, 2)}%` : '—';
          c.pct.className = cls;
          if (sourceLabel) c.el.setAttribute('title', `${c.el.getAttribute('title') || ''} · 来源：${sourceLabel}`.trim());
        };

        EM_ITEMS.forEach((idx) => updateCard(idx.secid, bySecid[idx.secid]));
        if (moexData) updateCard('MOEX:IMOEX', moexData, 'MOEX ISS');

        const now = new Date();
        timeEl.textContent = now.toTimeString().slice(0, 8);
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const [result, moexData] = await Promise.all([
            fetchQuotes().catch(() => null),
            fetchMoexFallback(),
          ]);
          if (!alive) return;
          render(result, moexData);
          if (result && result.rows && result.rows.length) {
            clearError(result.delayed);
          } else if (moexData) {
            clearError(false);
            srcEl.textContent = '来源：东方财富 / TradingView / MOEX ISS';
          } else {
            showError('行情加载失败，60 秒后自动重试…');
          }
        } catch (e) {
          if (!alive) return;
          showError('行情加载失败，60 秒后自动重试…');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive) return;
        if (!isIdle() || Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
      refresh();

      // tvOnly 卡片直接展开 TradingView 迷你图表（中东已改为状态卡片，不会触发）
      el.querySelectorAll('[data-tvonly="1"]').forEach((card) => {
        requestAnimationFrame(() => openTvChart(card));
      });

      tickTimer = setInterval(tick, REFRESH_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        clearInterval(meaTimer);
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        pendingAborts.forEach((c) => {
          try {
            c.abort();
          } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
        el.querySelectorAll('[data-tvbtn]').forEach((btn) => btn.removeEventListener('click', toggleTv));
        tvInstances.clear();
      };
    },
  };
})();
