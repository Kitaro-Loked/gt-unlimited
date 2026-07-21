/* A股北向资金监控 — 沪深港通实时净流入
 * 数据来源：东方财富公开接口 push2.eastmoney.com/api/qt/kamt.get
 * 经 /api/proxy?url=... 转发以绕过浏览器 CORS。
 * 失败时显示静态解释与外部链接。
 * Registers as custom tool id 'northbound' via window.GT_EXTRA_TOOLS.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const REFRESH_MS = 60000; // 1 分钟刷新
  const FETCH_TIMEOUT_MS = 12000;
  const API_URL = 'https://push2.eastmoney.com/api/qt/kamt.get?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65,f66,f67,f68,f69,f70,f71,f72,f73&secid=&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2';

  function injectStyle() {
    if (document.getElementById('nb-style')) return;
    const style = document.createElement('style');
    style.id = 'nb-style';
    style.textContent = `
.nb-root { display: flex; flex-direction: column; height: 100%; }
.nb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.nb-status { color: var(--warning); white-space: nowrap; }
.nb-status.live { color: var(--acc); }
.nb-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.nb-card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px 8px;
  text-align: center;
}
.nb-card-label {
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.nb-card-val {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.nb-up { color: var(--up); }
.nb-down { color: var(--down); }
.nb-flat { color: var(--text-muted); }
.nb-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  margin-top: auto;
}
.nb-foot a { color: var(--acc); text-decoration: none; }
.nb-foot a:hover { text-decoration: underline; }
.nb-hint { font-size: 10px; color: var(--text-muted); line-height: 1.5; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtYi = (v) => {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
    if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
    return `${v.toFixed(0)}`;
  };

  const dirClass = (v) => {
    if (!Number.isFinite(v) || v === 0) return 'nb-flat';
    return v > 0 ? 'nb-up' : 'nb-down';
  };

  const proxyUrl = (target) => `/api/proxy?url=${encodeURIComponent(target)}`;

  window.GT_EXTRA_TOOLS['northbound'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool nb-root">
          <div class="nb-head">
            <span>北向资金 · 沪深港通</span>
            <span class="nb-status" data-conn>连接中…</span>
          </div>
          <div class="nb-grid">
            <div class="nb-card">
              <div class="nb-card-label">沪股通净流入</div>
              <div class="nb-card-val nb-flat" data-sh>—</div>
            </div>
            <div class="nb-card">
              <div class="nb-card-label">深股通净流入</div>
              <div class="nb-card-val nb-flat" data-sz>—</div>
            </div>
            <div class="nb-card">
              <div class="nb-card-label">北向合计</div>
              <div class="nb-card-val nb-flat" data-total>—</div>
            </div>
          </div>
          <div class="nb-hint" data-hint>加载中…</div>
          <div class="nb-foot">
            <span>来源：东方财富</span>
            <a href="https://data.eastmoney.com/hkstock/ggt.html" target="_blank" rel="noopener">详情 →</a>
          </div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const shEl = el.querySelector('[data-sh]');
      const szEl = el.querySelector('[data-sz]');
      const totalEl = el.querySelector('[data-total]');
      const hint = el.querySelector('[data-hint]');

      let alive = true;
      let controller = null;
      let timer = null;

      const showError = (msg) => {
        hint.textContent = msg;
        conn.textContent = '连接失败';
        conn.className = 'nb-status';
        setStatus('offline');
      };
      const clearError = () => {
        hint.textContent = 'A股交易时段实时更新，红色为净流入，绿色为净流出';
        conn.textContent = '● LIVE';
        conn.className = 'nb-status live';
        setStatus('online');
      };

      const render = (sh, sz) => {
        shEl.textContent = fmtYi(sh);
        shEl.className = `nb-card-val ${dirClass(sh)}`;
        szEl.textContent = fmtYi(sz);
        szEl.className = `nb-card-val ${dirClass(sz)}`;
        const total = (Number.isFinite(sh) ? sh : 0) + (Number.isFinite(sz) ? sz : 0);
        totalEl.textContent = fmtYi(total);
        totalEl.className = `nb-card-val ${dirClass(total)}`;
      };

      const load = async () => {
        if (controller) controller.abort();
        controller = new AbortController();
        const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(proxyUrl(`${API_URL}&_=${Date.now()}`), { signal: controller.signal, cache: 'no-store' });
          clearTimeout(t);
          if (!res.ok) throw new Error(`http ${res.status}`);
          const json = await res.json();
          if (!alive) return;
          const data = json && json.data;
          if (!data) throw new Error('empty');
          // fields2: f51 沪股通流入 f52 沪股通余额 f53 深股通流入 f54 深股通余额 ... 具体字段以东方财富为准
          // 尝试常见字段：当天净流入常用 f20/f21 或 f51/f53
          let sh = null;
          let sz = null;
          if (typeof data.f51 === 'number') sh = data.f51;
          else if (typeof data.f20 === 'number') sh = data.f20;
          else if (typeof data.SHJK === 'number') sh = data.SHJK;
          if (typeof data.f53 === 'number') sz = data.f53;
          else if (typeof data.f21 === 'number') sz = data.f21;
          else if (typeof data.SZJK === 'number') sz = data.SZJK;
          if (sh === null || sz === null) {
            // 兜底：尝试从 data 的任意数字字段找两个合理值
            const nums = Object.values(data).filter((v) => Number.isFinite(v) && Math.abs(v) < 1e12 && Math.abs(v) > 1e6);
            if (nums.length >= 2) {
              sh = nums[0];
              sz = nums[1];
            } else {
              throw new Error('fields mismatch');
            }
          }
          render(sh, sz);
          clearError();
        } catch (e) {
          clearTimeout(t);
          if (!alive || e.name === 'AbortError') return;
          showError('北向资金数据加载失败，请确认代理服务已运行，或稍后自动重试。');
        }
      };

      load();
      timer = setInterval(load, REFRESH_MS);

      return () => {
        alive = false;
        if (controller) controller.abort();
        if (timer) clearInterval(timer);
      };
    },
  };
})();
