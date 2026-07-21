/* 全球市场情绪 breadth — 汇总全球主要指数涨跌，计算 Fear/Greed 得分与涨跌家数
 * 主源: 东财全球指数行情 https://push2delay.eastmoney.com/api/qt/ulist.np/get
 *       经 /api/proxy?url=... 转发；push2 服务器从本机常 502，故以 push2delay 为主、push2 为备。
 * 兜底: 东财两 host 均失败时，嵌入 TradingView market-overview widget。
 * 计算: 平均涨跌幅映射到 0-100 分，并与涨跌家数占比取平均；>=80 极度贪婪，60-80 贪婪，
 *       40-60 中性，20-40 恐惧，<=20 极度恐惧。
 * 配色: 绿涨红跌，msg-up(绿)/msg-down(红)。
 * Registers as custom tool id 'marketsentiment' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  // 全球主要指数（与 globalidx/worldheat 保持一致）
  const INDICES = [
    { secid: '100.SPX', name: '标普500', region: '美洲' },
    { secid: '100.NDX', name: '纳斯达克', region: '美洲' },
    { secid: '100.DJIA', name: '道琼斯', region: '美洲' },
    { secid: '100.BVSP', name: '巴西Bovespa', region: '美洲' },
    { secid: '100.MXX', name: '墨西哥IPC', region: '美洲' },
    { secid: '1.000001', name: '上证指数', region: '亚太' },
    { secid: '0.399001', name: '深证成指', region: '亚太' },
    { secid: '100.HSI', name: '恒生指数', region: '亚太' },
    { secid: '100.N225', name: '日经225', region: '亚太' },
    { secid: '100.KS11', name: '韩国KOSPI', region: '亚太' },
    { secid: '100.AS51', name: '澳洲标普200', region: '亚太' },
    { secid: '100.SENSEX', name: '印度SENSEX', region: '亚太' },
    { secid: '100.FTSE', name: '英国富时100', region: '欧洲' },
    { secid: '100.GDAXI', name: '德国DAX', region: '欧洲' },
    { secid: '100.FCHI', name: '法国CAC40', region: '欧洲' },
    { secid: '100.SX5E', name: '欧洲斯托克50', region: '欧洲' },
    { secid: '100.SSMI', name: '瑞士SMI', region: '欧洲' },
    { secid: '100.AEX', name: '荷兰AEX', region: '欧洲' },
    { secid: '100.TASI', name: '沙特TASI', region: '中东' },
    { secid: '100.DFMGI', name: '迪拜DFM', region: '中东' },
    { secid: '100.QSI', name: '卡塔尔QE', region: '中东' },
    { secid: '100.RTS', name: '俄罗斯RTS', region: '其他' },
  ];
  const SECIDS = INDICES.map((i) => i.secid).filter((v, i, a) => a.indexOf(v) === i);

  const EM_HOSTS = ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'];
  const EM_FIELDS = 'f12,f13,f14,f2,f3,f4';
  const emUrl = (host) =>
    `${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=${EM_FIELDS}&secids=${SECIDS.join(',')}`;
  const quoteUrl = (secid) => `https://quote.eastmoney.com/unify/r/${encodeURIComponent(secid)}`;

  const REFRESH_MS = 60000;
  const IDLE_REFRESH_MS = 5 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;

  function injectStyle() {
    if (document.getElementById('mkt-sent-style')) return;
    const style = document.createElement('style');
    style.id = 'mkt-sent-style';
    style.textContent = `
.msg-root { display: flex; flex-direction: column; height: 100%; }
.msg-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.msg-status { color: var(--warning); white-space: nowrap; }
.msg-status.live { color: var(--acc); }
.msg-sub {
  font-size: 9px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.msg-body { flex: 1; overflow-y: auto; overflow-x: hidden; }
.msg-gauge-box {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  padding: 10px;
  margin-bottom: 8px;
}
.msg-gauge-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.msg-score {
  font-family: var(--font-mono);
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.msg-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  white-space: nowrap;
}
.msg-gauge {
  height: 10px;
  border-radius: 999px;
  background: var(--surface);
  overflow: hidden;
  margin-bottom: 8px;
}
.msg-gauge-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #D05B4B 0%, #B88A5A 25%, var(--text-muted) 50%, #6CA67E 75%, #4C9F70 100%);
  transition: width 0.6s var(--ease-fluid);
}
.msg-counts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}
.msg-counts b {
  display: block;
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text);
  margin-top: 2px;
}
.msg-count-up b { color: var(--up); }
.msg-count-down b { color: var(--down); }
.msg-region { margin-bottom: 8px; }
.msg-region-title {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.msg-region-title b { font-weight: 400; font-family: var(--font-mono); color: var(--text-dim); }
.msg-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 3px 2px;
  border-bottom: 1px dashed var(--hairline);
  text-decoration: none;
  transition: background 0.2s var(--ease-fluid);
}
.msg-row:hover { background: var(--surface-raised); }
.msg-row:last-child { border-bottom: none; }
.msg-name {
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.msg-name i {
  font-style: normal;
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  margin-left: 6px;
}
.msg-bar-wrap {
  width: 64px;
  height: 5px;
  background: var(--surface);
  border-radius: 999px;
  overflow: hidden;
  align-self: center;
}
.msg-bar {
  height: 100%;
  border-radius: 999px;
}
.msg-pct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 58px;
  text-align: right;
}
.msg-up { color: var(--up); }
.msg-down { color: var(--down); }
.msg-flat { color: var(--text-muted); }
.msg-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 6px;
}
.msg-foot b { font-weight: 400; font-family: var(--font-mono); color: var(--text-muted); }
.msg-fallback {
  display: none;
  flex: 1;
  border-radius: var(--radius-inner);
  overflow: hidden;
  border: 1px solid var(--hairline);
}
.msg-fallback.active { display: block; }
.msg-fallback iframe { width: 100%; height: 100%; border: none; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtSigned = (v, digits) => {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'msg-flat';
    return v > 0 ? 'msg-up' : 'msg-down';
  };

  const scoreLabel = (score) => {
    if (score >= 80) return { text: '极度贪婪', cls: 'msg-up' };
    if (score >= 60) return { text: '贪婪', cls: 'msg-up' };
    if (score >= 40) return { text: '中性', cls: 'msg-flat' };
    if (score >= 20) return { text: '恐惧', cls: 'msg-down' };
    return { text: '极度恐惧', cls: 'msg-down' };
  };

  const proxy = (url) => '/api/proxy?url=' + encodeURIComponent(url);

  window.GT_EXTRA_TOOLS['marketsentiment'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool msg-root">
          <div class="msg-head">
            <span>全球市场 · 情绪 breadth</span>
            <span class="msg-status" data-conn>连接中…</span>
          </div>
          <div class="msg-sub">全球主要指数涨跌聚合 · 60s 刷新</div>
          <div class="msg-body" data-body>
            <div class="msg-gauge-box">
              <div class="msg-gauge-top">
                <span class="msg-score" data-score>—</span>
                <span class="msg-label" data-label>—</span>
              </div>
              <div class="msg-gauge"><div class="msg-gauge-fill" data-fill style="width:0%"></div></div>
              <div class="msg-counts">
                <span class="msg-count-up">上涨<b data-adv>—</b></span>
                <span class="msg-count-down">下跌<b data-dec>—</b></span>
                <span>平盘<b data-flat>—</b></span>
                <span>缺失<b data-miss>—</b></span>
              </div>
            </div>
            <div data-rows></div>
          </div>
          <div class="msg-fallback" data-fallback>
            <iframe data-fallback-frame allowtransparency="true" scrolling="no"></iframe>
          </div>
          <div class="msg-foot">
            <span data-src>来源：东方财富（经 GT proxy）</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const scoreEl = el.querySelector('[data-score]');
      const labelEl = el.querySelector('[data-label]');
      const fillEl = el.querySelector('[data-fill]');
      const advEl = el.querySelector('[data-adv]');
      const decEl = el.querySelector('[data-dec]');
      const flatEl = el.querySelector('[data-flat]');
      const missEl = el.querySelector('[data-miss]');
      const rowsEl = el.querySelector('[data-rows]');
      const bodyEl = el.querySelector('[data-body]');
      const fallbackEl = el.querySelector('[data-fallback]');
      const fallbackFrame = el.querySelector('[data-fallback-frame]');

      let alive = true;
      let tickTimer = null;
      let refreshInFlight = false;
      let lastFetchAt = 0;
      let useFallback = false;
      const pendingTimers = new Set();
      const pendingAborts = new Set();

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'msg-status';
        setStatus('offline');
      };
      const clearError = (delayed) => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'msg-status live';
        srcEl.textContent = delayed ? '来源：东方财富（延时行情，经 GT proxy）' : '来源：东方财富（经 GT proxy）';
        setStatus('online');
      };

      const loadFallback = () => {
        if (useFallback) return;
        useFallback = true;
        bodyEl.style.display = 'none';
        fallbackEl.classList.add('active');
        srcEl.textContent = '来源：TradingView（行情兜底）';
        const theme = (document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white')) ? 'light' : 'dark';
        fallbackFrame.src = `https://www.tradingview-widget.com/embed-widget/market-overview/?locale=zh_CN&colorTheme=${theme}&dateRange=1D&showChart=true&showSymbolLogo=true&isTransparent=false&tabs=[{"title":"亚太","symbols":[{"s":"INDEX:HSI","d":"恒生指数"},{"s":"INDEX:N225","d":"日经225"},{"s":"INDEX:KS11","d":"韩国KOSPI"},{"s":"INDEX:AS51","d":"澳洲标普200"},{"s":"NSE:NIFTY","d":"印度Nifty50"}]},{"title":"欧洲","symbols":[{"s":"INDEX:FTSE","d":"英国富时100"},{"s":"INDEX:GDAXI","d":"德国DAX"},{"s":"INDEX:FCHI","d":"法国CAC40"},{"s":"XETR:DAX","d":"斯托克50"}]},{"title":"美洲","symbols":[{"s":"INDEX:SPX","d":"标普500"},{"s":"INDEX:NDX","d":"纳斯达克"},{"s":"INDEX:DJIA","d":"道琼斯"},{"s":"BMFBOVESPA:IBOV","d":"巴西Bovespa"}]},{"title":"中东/其他","symbols":[{"s":"TADAWUL:TASI","d":"沙特Tadawul"},{"s":"DFM:DFMGI","d":"迪拜DFM"},{"s":"MOEX:IMOEX","d":"俄罗斯MOEX"}]}]`;
      };

      const fetchQuotes = async () => {
        let lastErr = null;
        for (let i = 0; i < EM_HOSTS.length; i += 1) {
          if (!alive) throw new Error('disposed');
          const ctrl = new AbortController();
          pendingAborts.add(ctrl);
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          pendingTimers.add(timer);
          try {
            const resp = await fetch(proxy(emUrl(EM_HOSTS[i])), { signal: ctrl.signal, cache: 'no-store' });
            if (!resp.ok) throw new Error(`http ${resp.status}`);
            const json = await resp.json();
            const diff = json && json.data && Array.isArray(json.data.diff) ? json.data.diff : [];
            if (!diff.length) throw new Error('empty');
            return { rows: diff, delayed: i === 0 };
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

      const render = (result) => {
        const bySecid = {};
        result.rows.forEach((r) => {
          if (r && r.f12 != null && r.f13 != null) bySecid[`${r.f13}.${r.f12}`] = r;
        });

        const data = INDICES.map((idx) => {
          const r = bySecid[idx.secid];
          return {
            secid: idx.secid,
            name: r && r.f14 ? String(r.f14) : idx.name,
            code: r && r.f12 ? String(r.f12) : idx.secid.split('.')[1],
            region: idx.region,
            pct: r ? Number(r.f3) : NaN,
          };
        });

        let adv = 0;
        let dec = 0;
        let flat = 0;
        let miss = 0;
        let sum = 0;
        let count = 0;
        data.forEach((d) => {
          if (!Number.isFinite(d.pct)) {
            miss += 1;
            return;
          }
          if (d.pct > 0) adv += 1;
          else if (d.pct < 0) dec += 1;
          else flat += 1;
          sum += d.pct;
          count += 1;
        });

        const avgPct = count ? sum / count : 0;
        const scoreFromAvg = Math.max(0, Math.min(100, 50 + (avgPct / 3) * 50));
        const scoreFromBreadth = count ? (100 * adv) / count : 50;
        const score = Math.round((scoreFromAvg + scoreFromBreadth) / 2);
        const lbl = scoreLabel(score);

        scoreEl.textContent = score;
        labelEl.textContent = lbl.text;
        labelEl.className = `msg-label ${lbl.cls}`;
        fillEl.style.width = `${score}%`;
        advEl.textContent = adv;
        decEl.textContent = dec;
        flatEl.textContent = flat;
        missEl.textContent = miss;

        const groups = {};
        data.forEach((d) => {
          if (!groups[d.region]) groups[d.region] = [];
          groups[d.region].push(d);
        });

        rowsEl.innerHTML = Object.keys(groups).map((region) => {
          const items = groups[region].slice().sort((a, b) => {
            if (!Number.isFinite(a.pct)) return 1;
            if (!Number.isFinite(b.pct)) return -1;
            return b.pct - a.pct;
          });
          const regionAvg = items.reduce((acc, it) => acc + (Number.isFinite(it.pct) ? it.pct : 0), 0) /
            Math.max(1, items.filter((it) => Number.isFinite(it.pct)).length);
          const rowsHtml = items.map((it) => {
            const cls = dirClass(it.pct);
            const width = Number.isFinite(it.pct) ? Math.min(100, Math.abs(it.pct) * 8) : 0;
            const barColor = it.pct > 0 ? 'var(--up)' : it.pct < 0 ? 'var(--down)' : 'var(--text-dim)';
            return `
              <a class="msg-row" href="${esc(quoteUrl(it.secid))}" target="_blank" rel="noopener">
                <span class="msg-name">${esc(it.name)}<i>${esc(it.code)}</i></span>
                <span class="msg-bar-wrap"><span class="msg-bar" style="width:${width}%;background:${barColor}"></span></span>
                <span class="msg-pct ${cls}">${Number.isFinite(it.pct) ? esc(fmtSigned(it.pct, 2)) + '%' : '—'}</span>
              </a>`;
          }).join('');
          return `
            <div class="msg-region">
              <div class="msg-region-title">
                <span>${esc(region)}</span>
                <b>${Number.isFinite(regionAvg) ? fmtSigned(regionAvg, 2) + '%' : '—'}</b>
              </div>
              ${rowsHtml}
            </div>`;
        }).join('');

        timeEl.textContent = new Date().toTimeString().slice(0, 8);
      };

      const refresh = async () => {
        if (!alive || refreshInFlight) return;
        refreshInFlight = true;
        lastFetchAt = Date.now();
        try {
          const result = await fetchQuotes();
          if (!alive) return;
          bodyEl.style.display = '';
          fallbackEl.classList.remove('active');
          useFallback = false;
          render(result);
          clearError(result.delayed);
        } catch (e) {
          if (!alive) return;
          loadFallback();
          showError('东财行情失败，已切换 TradingView 市场概览兜底。');
        } finally {
          refreshInFlight = false;
        }
      };

      const tick = () => {
        if (!alive || document.hidden) return;
        if (Date.now() - lastFetchAt >= IDLE_REFRESH_MS) refresh();
      };

      setStatus('loading');
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
      };
    },
  };
})();
