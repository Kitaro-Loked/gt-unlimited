/* 币圈期权情绪流 — Deribit 期权 PCR + IV 期限结构 + 大单成交(CORS JSON)
 * 期权汇总: https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option
 *   全量返回（BTC 约 390KB / 872 条，ETH 约 317KB），字段: instrument_name 形如 BTC-17JUL26-60000-C，
 *   volume / volume_usd 为 24h 成交量（币本位），open_interest 单位为币（1 张 = 1 币），
 *   mark_iv 为标记隐含波动率(%)，estimated_delivery_price 为标的价格。
 *   本组件按全部到期日合计认沽/认购 → 成交量 PCR 与持仓量 PCR；
 *   并按到期日分组，取行权价在标的 ±5% 内的合约平均 mark_iv → ATM IV 期限结构。
 * 大单成交: https://www.deribit.com/api/v2/public/get_last_trades_by_currency?currency=BTC&kind=option&count=100
 *   result.trades 字段: timestamp(ms) / direction(buy|sell 主动方向) / amount(币) / contracts / iv(%) / index_price；
 *   名义价值 = amount × index_price，过滤 ≥ $250K 视为大单（实测近 100 笔 BTC 约 3 笔、ETH 约 8 笔达标）。
 * 已用 curl 实测 2026-07-16：以上接口 GET 均 200；Deribit 带 Origin 请求时回显
 *   Access-Control-Allow-Origin（回显 Origin，浏览器跨域正常）。
 * 币圈绿涨红跌：主动买/偏多 用 var(--up)，主动卖/偏空 用 var(--down)；PCR ≥1.0 偏空、≤0.7 偏多。
 * 加密市场 24/7，固定 5 分钟刷新。
 * Registers as custom tool id 'cryptooptflow' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const CURS = ['BTC', 'ETH'];
  const BOOK_URL = (cur) =>
    `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${cur}&kind=option`;
  const TRADES_URL = (cur) =>
    `https://www.deribit.com/api/v2/public/get_last_trades_by_currency?currency=${cur}&kind=option&count=100`;

  const REFRESH_MS = 5 * 60 * 1000; // 固定 5 分钟刷新
  const FETCH_TIMEOUT_MS = 10000;
  const ATM_BAND = 0.05; // ATM 判定：行权价在标的 ±5% 内
  const TERM_COUNT = 8; // 期限结构最多展示最近 8 个到期日
  const BIG_TRADE_USD = 250000; // 大单过滤阈值（名义美元）
  const BIG_TRADE_ROWS = 10; // 大单表最多行数
  const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

  function injectStyle() {
    if (document.getElementById('cof-style')) return;
    const style = document.createElement('style');
    style.id = 'cof-style';
    style.textContent = `
.cof-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.cof-status { color: var(--warning); white-space: nowrap; }
.cof-status.live { color: var(--acc); }
.cof-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
.cof-card {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  background: var(--surface-raised);
}
.cof-card-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  margin-bottom: 6px;
}
.cof-pcr-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  padding: 3px 0;
}
.cof-pcr-row + .cof-pcr-row { border-top: 1px solid var(--hairline); }
.cof-pcr-label {
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.cof-pcr-val {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cof-pcr-sub {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cof-tag {
  font-size: 9px;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 0 6px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.cof-tag.bull { color: var(--up); border-color: var(--up); }
.cof-tag.bear { color: var(--down); border-color: var(--down); }
.cof-board {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-width: 0;
  margin-bottom: 8px;
}
.cof-board:last-of-type { margin-bottom: 0; }
.cof-board-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.cof-board-title i { font-style: normal; color: var(--text-dim); font-size: 9px; letter-spacing: 0; }
.cof-chart { width: 100%; height: auto; display: block; }
.cof-svg-text { fill: var(--text-dim); font-size: 9px; font-family: var(--font-mono); }
.cof-svg-grid { stroke: var(--hairline); stroke-width: 1; }
.cof-svg-axis { stroke: var(--hairline-strong); stroke-width: 1; }
.cof-line-btc { stroke: var(--acc); fill: none; stroke-width: 1.6; }
.cof-line-eth { stroke: var(--info); fill: none; stroke-width: 1.6; }
.cof-dot-btc { fill: var(--acc); }
.cof-dot-eth { fill: var(--info); }
.cof-legend {
  display: flex;
  gap: 12px;
  font-size: 9px;
  color: var(--text-muted);
  margin-top: 2px;
}
.cof-legend b { font-weight: 400; font-family: var(--font-mono); }
.cof-legend .btc { color: var(--acc); }
.cof-legend .eth { color: var(--info); }
.cof-table { width: 100%; font-variant-numeric: tabular-nums; }
.cof-table th, .cof-table td { white-space: nowrap; }
.cof-table th:not(:first-child), .cof-table td:not(:first-child) { text-align: right; }
.cof-num { font-family: var(--font-mono); }
.cof-inst { font-family: var(--font-mono); font-weight: 600; }
.cof-inst i { font-style: normal; color: var(--text-dim); font-weight: 400; font-size: 9px; margin-left: 4px; }
.cof-up { color: var(--up); }
.cof-down { color: var(--down); }
.cof-flat { color: var(--text-muted); }
.cof-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.cof-chart-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 14px 4px;
}
.cof-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 9px;
  color: var(--text-dim);
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

  // 币量压缩：12.3K / 1.45M
  const fmtK = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e6) return `${fmtNum(v / 1e6, 2)}M`;
    if (Math.abs(v) >= 1e3) return `${fmtNum(v / 1e3, 1)}K`;
    return fmtNum(v, 0);
  };

  const fmtUsd = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e6) return `$${fmtNum(v / 1e6, 2)}M`;
    return `$${fmtNum(v / 1e3, 0)}K`;
  };

  // '17JUL26' → Date（UTC）
  const parseExpiry = (exp) => {
    const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(exp);
    if (!m || MONTHS[m[2]] == null) return null;
    return new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1])));
  };

  const parseInstrument = (name) => {
    const p = String(name || '').split('-');
    if (p.length !== 4) return null;
    const strike = Number(p[2]);
    const type = p[3];
    if (!Number.isFinite(strike) || (type !== 'C' && type !== 'P')) return null;
    return { exp: p[1], strike, type };
  };

  const mmdd = (d) =>
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  window.GT_EXTRA_TOOLS['cryptooptflow'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool cof-root">
          <div class="cof-head">
            <span>CRYPTO_OPT · 期权情绪流</span>
            <span class="cof-status" data-conn>连接中…</span>
          </div>
          <div class="cof-grid">
            ${CURS.map(
              (cur) => `
              <div class="cof-card" data-cur="${esc(cur)}">
                <div class="cof-card-name">${esc(cur)} 期权 PCR</div>
                <div class="cof-pcr-row">
                  <span class="cof-pcr-label">成交量</span>
                  <span class="cof-pcr-val cof-flat" data-vol-pcr>—</span>
                  <span class="cof-tag" data-vol-tag>—</span>
                </div>
                <div class="cof-pcr-row">
                  <span class="cof-pcr-label">持仓量</span>
                  <span class="cof-pcr-val cof-flat" data-oi-pcr>—</span>
                  <span class="cof-tag" data-oi-tag>—</span>
                </div>
                <div class="cof-pcr-row">
                  <span class="cof-pcr-label">沽/购 24H</span>
                  <span class="cof-pcr-sub" data-vol-sub>—</span>
                </div>
                <div class="cof-pcr-row">
                  <span class="cof-pcr-label">沽/购 OI</span>
                  <span class="cof-pcr-sub" data-oi-sub>—</span>
                </div>
              </div>`
            ).join('')}
          </div>
          <div class="cof-board">
            <div class="cof-board-title"><span>ATM IV 期限结构</span><i>行权价 ±5% 均值 · 最近 8 期</i></div>
            <div data-chart><div class="cof-chart-empty">加载中…</div></div>
            <div class="cof-legend"><span class="btc">— BTC</span><span class="eth">— ETH</span><span style="margin-left:auto" data-iv-note></span></div>
          </div>
          <div class="cof-board">
            <div class="cof-board-title"><span>期权大单成交</span><i>名义 ≥ $250K · 近 100 笔</i></div>
            <table class="data-table cof-table">
              <thead><tr><th>时间</th><th>合约</th><th>方向</th><th>数量</th><th>名义</th><th>IV</th></tr></thead>
              <tbody data-trade-body>
                <tr class="cof-empty"><td colspan="6">加载中…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="cof-foot">
            <span>数据来源 Deribit · 每 5 分钟刷新</span>
            <span data-updated>—</span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const chartBox = el.querySelector('[data-chart]');
      const ivNote = el.querySelector('[data-iv-note]');
      const tradeBody = el.querySelector('[data-trade-body]');
      const updatedEl = el.querySelector('[data-updated]');
      const hint = el.querySelector('[data-hint]');
      const cards = {};
      el.querySelectorAll('.cof-card').forEach((card) => {
        cards[card.getAttribute('data-cur')] = {
          volPcr: card.querySelector('[data-vol-pcr]'),
          volTag: card.querySelector('[data-vol-tag]'),
          oiPcr: card.querySelector('[data-oi-pcr]'),
          oiTag: card.querySelector('[data-oi-tag]'),
          volSub: card.querySelector('[data-vol-sub]'),
          oiSub: card.querySelector('[data-oi-sub]'),
        };
      });

      let alive = true;
      let refreshTimer = null;
      let refreshInFlight = false;
      const pendingTimers = new Set(); // 进行中的超时定时器
      const pendingAborts = new Set(); // 进行中的 fetch AbortController

      const setConn = (ok, errs) => {
        if (ok) {
          conn.textContent = '● LIVE';
          conn.className = 'cof-status live';
          setStatus('online');
        } else {
          conn.textContent = '连接失败';
          conn.className = 'cof-status';
          setStatus('offline');
        }
        if (errs.length) {
          hint.textContent = `${errs.join('；')}，5 分钟后自动重试…`;
          hint.style.display = '';
        } else {
          hint.style.display = 'none';
        }
      };

      // 统一 fetch JSON：AbortController 10s 超时，句柄纳入 cleanup
      const fetchJSON = async (url) => {
        if (!alive) throw new Error('disposed');
        const ctrl = new AbortController();
        pendingAborts.add(ctrl);
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        pendingTimers.add(timer);
        try {
          const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          return await resp.json();
        } finally {
          clearTimeout(timer);
          pendingTimers.delete(timer);
          pendingAborts.delete(ctrl);
        }
      };

      /* ---- 期权汇总：全到期 PCR + ATM IV 期限结构 ---- */
      const fetchBook = async (cur) => {
        const json = await fetchJSON(BOOK_URL(cur));
        const list = json && Array.isArray(json.result) ? json.result : [];
        if (!list.length) throw new Error('empty');
        let volPut = 0;
        let volCall = 0;
        let oiPut = 0;
        let oiCall = 0;
        const byExp = new Map(); // expKey -> { date, spot, ivSum, ivN }
        list.forEach((it) => {
          const meta = parseInstrument(it.instrument_name);
          if (!meta) return;
          const vol = Number(it.volume);
          const oi = Number(it.open_interest);
          if (Number.isFinite(vol) && vol > 0) {
            if (meta.type === 'P') volPut += vol;
            else volCall += vol;
          }
          if (Number.isFinite(oi) && oi > 0) {
            if (meta.type === 'P') oiPut += oi;
            else oiCall += oi;
          }
          const iv = Number(it.mark_iv);
          const spot = Number(it.estimated_delivery_price) || Number(it.underlying_price);
          if (!Number.isFinite(iv) || iv <= 0 || !Number.isFinite(spot) || spot <= 0) return;
          // ATM 附近：行权价在标的 ±5% 内
          if (Math.abs(meta.strike - spot) / spot > ATM_BAND) return;
          let bucket = byExp.get(meta.exp);
          if (!bucket) {
            const date = parseExpiry(meta.exp);
            if (!date) return;
            bucket = { date, ivSum: 0, ivN: 0 };
            byExp.set(meta.exp, bucket);
          }
          bucket.ivSum += iv;
          bucket.ivN += 1;
        });
        if (volCall <= 0 && oiCall <= 0) throw new Error('empty');
        const terms = Array.from(byExp.values())
          .filter((b) => b.ivN > 0)
          .sort((a, b) => a.date - b.date)
          .slice(0, TERM_COUNT)
          .map((b) => ({
            date: b.date,
            dte: Math.max(0, Math.round((b.date.getTime() - Date.now()) / 86400000)),
            iv: b.ivSum / b.ivN,
          }));
        return {
          cur,
          volPut,
          volCall,
          oiPut,
          oiCall,
          volPcr: volCall > 0 ? volPut / volCall : NaN,
          oiPcr: oiCall > 0 ? oiPut / oiCall : NaN,
          terms,
        };
      };

      /* ---- 大单成交 ---- */
      const fetchTrades = async (cur) => {
        const json = await fetchJSON(TRADES_URL(cur));
        const list = json && json.result && Array.isArray(json.result.trades) ? json.result.trades : [];
        if (!list.length) throw new Error('empty');
        return list
          .map((t) => {
            const amount = Number(t.amount);
            const idx = Number(t.index_price);
            const meta = parseInstrument(t.instrument_name);
            if (!meta || !Number.isFinite(amount) || !Number.isFinite(idx)) return null;
            const date = parseExpiry(meta.exp);
            return {
              ts: Number(t.timestamp),
              cur,
              strike: meta.strike,
              type: meta.type,
              exp: date ? mmdd(date) : meta.exp,
              dir: t.direction === 'buy' ? 'buy' : 'sell',
              amount,
              notional: amount * idx,
              iv: Number(t.iv),
            };
          })
          .filter((t) => t && Number.isFinite(t.ts) && t.notional >= BIG_TRADE_USD);
      };

      // PCR 情绪：≥1.0 偏空(红)，≤0.7 偏多(绿)，其余中性
      const pcrSentiment = (pcr) => {
        if (!Number.isFinite(pcr)) return { cls: 'cof-flat', tag: '', label: '—' };
        if (pcr >= 1.0) return { cls: 'cof-down', tag: 'bear', label: '偏空' };
        if (pcr <= 0.7) return { cls: 'cof-up', tag: 'bull', label: '偏多' };
        return { cls: 'cof-flat', tag: '', label: '中性' };
      };

      const renderPcr = (d) => {
        const c = cards[d.cur];
        if (!c) return;
        const volS = pcrSentiment(d.volPcr);
        const oiS = pcrSentiment(d.oiPcr);
        c.volPcr.textContent = Number.isFinite(d.volPcr) ? fmtNum(d.volPcr, 2) : '—';
        c.volPcr.className = `cof-pcr-val ${volS.cls}`;
        c.volTag.textContent = volS.label;
        c.volTag.className = `cof-tag${volS.tag ? ` ${volS.tag}` : ''}`;
        c.oiPcr.textContent = Number.isFinite(d.oiPcr) ? fmtNum(d.oiPcr, 2) : '—';
        c.oiPcr.className = `cof-pcr-val ${oiS.cls}`;
        c.oiTag.textContent = oiS.label;
        c.oiTag.className = `cof-tag${oiS.tag ? ` ${oiS.tag}` : ''}`;
        c.volSub.textContent = `${fmtK(d.volPut)} / ${fmtK(d.volCall)}`;
        c.oiSub.textContent = `${fmtK(d.oiPut)} / ${fmtK(d.oiCall)}`;
      };

      const renderPcrError = (cur) => {
        const c = cards[cur];
        if (!c) return;
        [c.volPcr, c.oiPcr].forEach((n) => {
          n.textContent = '—';
          n.className = 'cof-pcr-val cof-flat';
        });
        [c.volTag, c.oiTag].forEach((n) => {
          n.textContent = '—';
          n.className = 'cof-tag';
        });
        c.volSub.textContent = '—';
        c.oiSub.textContent = '—';
      };

      /* ---- IV 期限结构 SVG（双币种折线，x=到期日并集，y=ATM IV） ---- */
      const renderChart = (bookList) => {
        const seriesMap = {}; // cur -> Map(dateTs -> iv)
        const dateSet = new Set();
        bookList.forEach((b) => {
          const m = new Map();
          b.terms.forEach((t) => {
            m.set(t.date.getTime(), t.iv);
            dateSet.add(t.date.getTime());
          });
          seriesMap[b.cur] = m;
        });
        const dates = Array.from(dateSet).sort((a, b) => a - b).slice(0, TERM_COUNT);
        if (!dates.length) {
          chartBox.innerHTML = '<div class="cof-chart-empty">暂无 IV 期限数据</div>';
          ivNote.textContent = '';
          return;
        }
        const allIvs = [];
        Object.values(seriesMap).forEach((m) => m.forEach((v) => allIvs.push(v)));
        let yMin = Math.min.apply(null, allIvs);
        let yMax = Math.max.apply(null, allIvs);
        if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) {
          yMin = (Number.isFinite(yMin) ? yMin : 0) - 1;
          yMax = yMin + 2;
        }
        yMin = Math.max(0, yMin - 2);
        yMax += 2;

        const W = 480;
        const H = 132;
        const PL = 34; // 左 padding（y 轴刻度）
        const PR = 10;
        const PT = 8;
        const PB = 24; // 下 padding（x 轴日期）
        const iw = W - PL - PR;
        const ih = H - PT - PB;
        const xAt = (i) => PL + (dates.length === 1 ? iw / 2 : (i / (dates.length - 1)) * iw);
        const yAt = (iv) => PT + (1 - (iv - yMin) / (yMax - yMin)) * ih;

        let svg = `<svg class="cof-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ATM IV 期限结构">`;
        // 网格 + y 轴刻度（顶/中/底）
        [yMax, (yMax + yMin) / 2, yMin].forEach((v) => {
          const y = yAt(v).toFixed(1);
          svg += `<line class="cof-svg-grid" x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"/>`;
          svg += `<text class="cof-svg-text" x="${PL - 4}" y="${y}" text-anchor="end" dominant-baseline="middle">${fmtNum(v, 0)}</text>`;
        });
        svg += `<line class="cof-svg-axis" x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}"/>`;
        // x 轴日期标签
        dates.forEach((ts, i) => {
          svg += `<text class="cof-svg-text" x="${xAt(i).toFixed(1)}" y="${H - PB + 12}" text-anchor="middle">${mmdd(new Date(ts))}</text>`;
        });
        // 折线 + 数据点
        CURS.forEach((cur) => {
          const m = seriesMap[cur];
          if (!m) return;
          const pts = dates
            .map((ts, i) => (m.has(ts) ? [xAt(i), yAt(m.get(ts))] : null))
            .filter(Boolean);
          if (!pts.length) return;
          const cls = cur === 'BTC' ? 'btc' : 'eth';
          if (pts.length > 1) {
            svg += `<polyline class="cof-line-${cls}" points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`;
          }
          pts.forEach((p) => {
            svg += `<circle class="cof-dot-${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2"/>`;
          });
          // 末端 IV 数值
          const last = pts[pts.length - 1];
          const lastTs = dates[dates.length - 1];
          if (m.has(lastTs)) {
            svg += `<text class="cof-svg-text cof-dot-${cls}" x="${Math.min(last[0] + 4, W - PR).toFixed(1)}" y="${last[1].toFixed(1)}" dominant-baseline="middle">${fmtNum(m.get(lastTs), 0)}</text>`;
          }
        });
        svg += '</svg>';
        chartBox.innerHTML = svg;
        const d0 = new Date(dates[0]);
        const d1 = new Date(dates[dates.length - 1]);
        ivNote.textContent = `${mmdd(d0)} → ${mmdd(d1)}`;
      };

      const renderChartError = () => {
        chartBox.innerHTML = '<div class="cof-chart-empty">IV 数据加载失败</div>';
        ivNote.textContent = '';
      };

      const renderTrades = (trades) => {
        if (!trades.length) {
          tradeBody.innerHTML = '<tr class="cof-empty"><td colspan="6">近 100 笔暂无 ≥$250K 大单</td></tr>';
          return;
        }
        tradeBody.innerHTML = trades
          .map((t) => {
            const time = new Date(t.ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
            const dirCls = t.dir === 'buy' ? 'cof-up' : 'cof-down';
            const dirTxt = t.dir === 'buy' ? '买入' : '卖出';
            return `
            <tr>
              <td class="cof-num">${esc(time)}</td>
              <td class="cof-inst">${esc(t.cur)} ${esc(fmtNum(t.strike, 0))}${esc(t.type)}<i>${esc(t.exp)}</i></td>
              <td class="${dirCls}">${dirTxt}</td>
              <td class="cof-num">${esc(fmtNum(t.amount, t.amount >= 100 ? 0 : 1))}</td>
              <td class="cof-num">${esc(fmtUsd(t.notional))}</td>
              <td class="cof-num">${Number.isFinite(t.iv) && t.iv > 0 ? esc(fmtNum(t.iv, 1)) : '—'}</td>
            </tr>`;
          })
          .join('');
      };

      const renderTradesError = () => {
        tradeBody.innerHTML = '<tr class="cof-empty"><td colspan="6">大单数据加载失败</td></tr>';
      };

      const refresh = async () => {
        if (!alive || refreshInFlight || document.hidden) return;
        refreshInFlight = true;
        try {
          const jobs = CURS.map((cur) => fetchBook(cur)).concat(CURS.map((cur) => fetchTrades(cur)));
          const res = await Promise.allSettled(jobs);
          if (!alive) return;
          const errs = [];
          let anyOk = false;
          const books = [];
          CURS.forEach((cur, i) => {
            if (res[i].status === 'fulfilled') {
              renderPcr(res[i].value);
              books.push(res[i].value);
              anyOk = true;
            } else {
              renderPcrError(cur);
              errs.push(`${cur} 期权汇总失败`);
            }
          });
          if (books.length) renderChart(books);
          else renderChartError();
          const trades = [];
          CURS.forEach((cur, i) => {
            const r = res[CURS.length + i];
            if (r.status === 'fulfilled') {
              trades.push(...r.value);
              anyOk = true;
            } else {
              errs.push(`${cur} 成交失败`);
            }
          });
          trades.sort((a, b) => b.ts - a.ts);
          if (trades.length || CURS.every((cur, i) => res[CURS.length + i].status === 'fulfilled')) {
            renderTrades(trades.slice(0, BIG_TRADE_ROWS));
          } else {
            renderTradesError();
          }
          setConn(anyOk, errs);
          if (anyOk) {
            updatedEl.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
          }
        } finally {
          refreshInFlight = false;
        }
      };

      refresh();
      refreshTimer = setInterval(refresh, REFRESH_MS);

      return () => {
        alive = false;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        pendingTimers.forEach((t) => clearTimeout(t));
        pendingTimers.clear();
        pendingAborts.forEach((c) => {
          try {
            c.abort();
          } catch (e) { /* 忽略 */ }
        });
        pendingAborts.clear();
      };
    },
  };
})();
