/* My liquidations — Binance USD-M futures user force orders (signed REST)
 * Data: GET https://fapi.binance.com/fapi/v1/forceOrders (header X-MBX-APIKEY, HMAC-SHA256 signature)
 * Time sync: GET https://fapi.binance.com/fapi/v1/time (avoid -1021 timestamp drift)
 * API key/secret are stored ONLY in this browser's localStorage (gt.myliq.keys) and are
 * never logged or sent anywhere except fapi.binance.com. CORS is open on these endpoints.
 * Registers as custom tool id 'myliquidations' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const BASE = 'https://fapi.binance.com';
  const TIME_URL = `${BASE}/fapi/v1/time`;
  const ORDERS_URL = `${BASE}/fapi/v1/forceOrders`;
  const LS_KEY = 'gt.myliq.keys';
  const REFRESH_MS = 60000; // 60 秒自动刷新
  const MAX_ROWS = 100; // 明细表最多展示 100 行
  const RECV_WINDOW = 5000;

  const STATUS_ZH = {
    FILLED: '已成交',
    PARTIALLY_FILLED: '部分成交',
    CANCELED: '已撤销',
    EXPIRED: '已失效',
    NEW: '进行中',
    REJECTED: '已拒绝',
  };

  function injectStyle() {
    if (document.getElementById('myliq-style')) return;
    const style = document.createElement('style');
    style.id = 'myliq-style';
    style.textContent = `
.myliq-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.myliq-status { color: var(--warning); }
.myliq-status.live { color: var(--up); }
.myliq-keys { border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px; }
.myliq-field { display: flex; align-items: center; gap: 6px; }
.myliq-field label { font-family: var(--font-sans); font-size: 10px; color: var(--text-muted); width: 64px; flex-shrink: 0; }
.myliq-field input, .myliq-sym-input { flex: 1; min-width: 0; background: var(--surface-raised); color: var(--text); border: 1px solid var(--hairline); border-radius: var(--radius-sm); font-size: 11px; padding: 4px 8px; font-family: var(--font-mono); transition: border-color 0.2s var(--ease-fluid); }
.myliq-field input:focus, .myliq-sym-input:focus { outline: 1px solid var(--acc); }
.myliq-keys-actions { display: flex; gap: 6px; }
.myliq-btn { background: var(--surface-raised); color: var(--text); border: 1px solid var(--hairline); border-radius: var(--radius-sm); font-size: 11px; padding: 3px 10px; font-family: inherit; cursor: pointer; transition: border-color 0.2s var(--ease-fluid), color 0.2s var(--ease-fluid); }
.myliq-btn:hover { border-color: var(--acc); color: var(--acc); }
.myliq-btn-link { border-color: transparent; color: var(--text-muted); padding: 1px 6px; }
.myliq-btn-link:hover { color: var(--acc); }
.myliq-secure-note { font-size: 10px; line-height: 1.6; color: var(--text-muted); border-top: 1px dashed var(--hairline); padding-top: 6px; }
.myliq-secure-note b { color: var(--warning); font-weight: 600; }
.myliq-keysbar { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--text-muted); margin-bottom: 8px; }
.myliq-keysbar .dot { color: var(--up); }
.myliq-filter-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.myliq-sym-input { flex: 1; }
.myliq-filter {
  background: var(--surface-raised);
  color: var(--text);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 3px 6px;
  font-family: inherit;
  cursor: pointer;
}
.myliq-filter:focus { outline: 1px solid var(--acc); }
.myliq-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
.myliq-stat {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.myliq-stat-label { font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; }
.myliq-stat-value {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.myliq-list-wrap { max-height: 320px; overflow-y: auto; }
.myliq-table { font-variant-numeric: tabular-nums; }
.myliq-table th, .myliq-table td { white-space: nowrap; }
.myliq-num { font-family: var(--font-mono); }
.myliq-time { color: var(--text-muted); font-size: 10px; }
.myliq-sym { font-weight: 600; }
.myliq-sym i { font-style: normal; color: var(--text-dim); font-weight: 400; }
.myliq-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid transparent; }
.myliq-badge.long { color: var(--down); border-color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
.myliq-badge.short { color: var(--up); border-color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
.myliq-usd.long { color: var(--down); }
.myliq-usd.short { color: var(--up); }
.myliq-state { color: var(--text-muted); font-size: 10px; }
.myliq-empty td {
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  padding: 14px 4px;
  line-height: 1.8;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtUsd = (v) => {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `$${v.toFixed(2)}`;
  };

  const fmtPrice = (p) => {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toPrecision(4);
  };

  const fmtQty = (q) => {
    if (!Number.isFinite(q)) return '—';
    if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (q >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 3 });
    return q.toPrecision(3);
  };

  const fmtTime = (t) => {
    const d = new Date(t);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };

  // WebCrypto HMAC-SHA256 → hex（secret 只作为签名密钥，绝不外发/打印）
  async function hmacSha256Hex(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  window.GT_EXTRA_TOOLS['myliquidations'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool myliq-root">
          <div class="myliq-head"><span>BINANCE FUTURES · 我的爆仓</span><span class="myliq-status" data-conn>未配置</span></div>
          <div class="myliq-keys" data-keys>
            <div class="myliq-field"><label>API Key</label><input data-in-key type="text" autocomplete="off" spellcheck="false" placeholder="建议只读权限"></div>
            <div class="myliq-field"><label>Secret Key</label><input data-in-secret type="password" autocomplete="off" spellcheck="false" placeholder="仅保存在本地浏览器"></div>
            <div class="myliq-keys-actions">
              <button class="myliq-btn" data-save>保存密钥</button>
              <button class="myliq-btn" data-clear>清除</button>
            </div>
            <div class="myliq-secure-note"><b>安全提示</b>：密钥仅保存在本浏览器 localStorage，不会上传至任何第三方；请务必使用「只读」权限并<b>绑定 IP 白名单</b>的 API 密钥。</div>
          </div>
          <div class="myliq-keysbar" data-keysbar style="display:none">
            <span><span class="dot">●</span> 密钥已保存（仅本地）</span>
            <button class="myliq-btn myliq-btn-link" data-edit>重新配置</button>
            <button class="myliq-btn myliq-btn-link" data-wipe>清除密钥</button>
          </div>
          <div class="myliq-filter-row">
            <input class="myliq-sym-input" data-sym type="text" autocomplete="off" spellcheck="false" placeholder="品种过滤，如 BTCUSDT（留空为全部）">
            <select class="myliq-filter" data-days title="按时间范围过滤">
              <option value="7" selected>近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="0">全部</option>
            </select>
            <button class="myliq-btn" data-refresh>刷新</button>
          </div>
          <div class="myliq-stats">
            <div class="myliq-stat"><span class="myliq-stat-label">累计爆仓笔数</span><span class="myliq-stat-value" data-cnt>—</span></div>
            <div class="myliq-stat"><span class="myliq-stat-label">累计爆仓金额</span><span class="myliq-stat-value" data-sum>—</span></div>
            <div class="myliq-stat"><span class="myliq-stat-label">最大单笔金额</span><span class="myliq-stat-value" data-max>—</span></div>
          </div>
          <div class="myliq-list-wrap">
            <table class="data-table myliq-table">
              <thead>
                <tr><th>时间</th><th>品种</th><th>方向</th><th>均价</th><th>数量</th><th>金额</th><th>状态</th></tr>
              </thead>
              <tbody data-body></tbody>
            </table>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const hint = el.querySelector('[data-hint]');
      const keysBox = el.querySelector('[data-keys]');
      const keysBar = el.querySelector('[data-keysbar]');
      const inKey = el.querySelector('[data-in-key]');
      const inSecret = el.querySelector('[data-in-secret]');
      const symInput = el.querySelector('[data-sym]');
      const daysSel = el.querySelector('[data-days]');
      const cntEl = el.querySelector('[data-cnt]');
      const sumEl = el.querySelector('[data-sum]');
      const maxEl = el.querySelector('[data-max]');
      const body = el.querySelector('[data-body]');

      let alive = true;
      let refreshTimer = null;
      let apiKey = '';
      let apiSecret = '';
      let serverOffset = 0; // serverTime - Date.now()
      let timeSynced = false;
      let loading = false;
      let orders = []; // 最新在前

      const loadKeys = () => {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (!raw) return false;
          const obj = JSON.parse(raw);
          if (obj && typeof obj.k === 'string' && typeof obj.s === 'string' && obj.k && obj.s) {
            apiKey = obj.k;
            apiSecret = obj.s;
            return true;
          }
        } catch (e) { /* 损坏的存储视为未配置 */ }
        return false;
      };

      const saveKeys = () => {
        apiKey = inKey.value.trim();
        apiSecret = inSecret.value.trim();
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ k: apiKey, s: apiSecret }));
        } catch (e) { /* 存储失败不影响本次会话使用 */ }
      };

      const wipeKeys = () => {
        apiKey = '';
        apiSecret = '';
        inKey.value = '';
        inSecret.value = '';
        try {
          localStorage.removeItem(LS_KEY);
        } catch (e) { /* 忽略 */ }
      };

      const hasKeys = () => Boolean(apiKey && apiSecret);

      const showHint = (msg) => {
        hint.innerHTML = msg;
        hint.style.display = '';
      };
      const hideHint = () => {
        hint.style.display = 'none';
      };

      const setConn = (state, text) => {
        if (state === 'live') {
          conn.textContent = text || '● LIVE';
          conn.className = 'myliq-status live';
          setStatus('online');
        } else if (state === 'fail') {
          conn.textContent = text || '连接失败';
          conn.className = 'myliq-status';
          setStatus('offline');
        } else {
          conn.textContent = text || '未配置';
          conn.className = 'myliq-status';
        }
      };

      const syncKeysUi = () => {
        if (hasKeys()) {
          keysBox.style.display = 'none';
          keysBar.style.display = '';
        } else {
          keysBox.style.display = '';
          keysBar.style.display = 'none';
        }
      };

      const orderUsd = (o) => {
        const cum = parseFloat(o.cumQuote);
        if (Number.isFinite(cum) && cum > 0) return cum;
        const q = parseFloat(o.executedQty);
        const p = parseFloat(o.avgPrice) || parseFloat(o.price);
        return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
      };

      const render = () => {
        const days = parseInt(daysSel.value, 10) || 0;
        const cut = days > 0 ? Date.now() - days * 86400 * 1000 : 0;
        const visible = cut > 0 ? orders.filter((o) => o.time >= cut) : orders;

        let total = 0;
        let maxUsd = 0;
        visible.forEach((o) => {
          const usd = orderUsd(o);
          total += usd;
          if (usd > maxUsd) maxUsd = usd;
        });
        cntEl.textContent = String(visible.length);
        sumEl.textContent = fmtUsd(total);
        maxEl.textContent = visible.length ? fmtUsd(maxUsd) : '—';

        const rows = visible.slice(0, MAX_ROWS);
        if (!rows.length) {
          body.innerHTML = `
            <tr class="myliq-empty"><td colspan="7">${hasKeys() ? '该时间范围内无爆仓记录' : '请先配置 API 密钥'}</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((o) => {
            const isLong = o.side === 'SELL'; // SELL=多仓被强平卖出，BUY=空仓被强平买入
            const side = isLong ? 'long' : 'short';
            const raw = String(o.symbol || '');
            const sym = raw.endsWith('USDT') ? `${esc(raw.slice(0, -4))}<i>/USDT</i>` : esc(raw);
            const statusZh = STATUS_ZH[o.status] || String(o.status || '—');
            return `
            <tr>
              <td class="myliq-num myliq-time">${fmtTime(o.time)}</td>
              <td class="myliq-sym">${sym}</td>
              <td><span class="myliq-badge ${side}">${isLong ? '多爆' : '空爆'}</span></td>
              <td class="myliq-num">${fmtPrice(parseFloat(o.avgPrice) || parseFloat(o.price))}</td>
              <td class="myliq-num">${fmtQty(parseFloat(o.executedQty))}</td>
              <td class="myliq-num myliq-usd ${side}">${fmtUsd(orderUsd(o))}</td>
              <td class="myliq-state">${esc(statusZh)}</td>
            </tr>`;
          })
          .join('');
      };

      const renderGuide = () => {
        cntEl.textContent = '—';
        sumEl.textContent = '—';
        maxEl.textContent = '—';
        body.innerHTML = `
          <tr class="myliq-empty"><td colspan="7">在上方填入币安 USDⓈ-M 合约 API 密钥后自动加载<br>建议使用「只读」权限并绑定 IP 白名单</td></tr>`;
      };

      // 同步服务器时间，避免 -1021（本地时钟与服务器偏差过大）
      const syncTime = async () => {
        const res = await fetch(TIME_URL);
        if (!res.ok) throw new Error(`time http ${res.status}`);
        const data = await res.json();
        if (!Number.isFinite(Number(data.serverTime))) throw new Error('bad time');
        serverOffset = Number(data.serverTime) - Date.now();
        timeSynced = true;
      };

      const friendlyError = (code, msg) => {
        if (code === -2015) return 'API 密钥无效、权限不足或 IP 未加入白名单（-2015）';
        if (code === -2014) return 'API Key 格式错误（-2014）';
        if (code === -1021) return '本地时间与服务器不同步（-1021）';
        if (code === -2011) return '请求参数错误（-2011）：请检查品种名称';
        return `币安返回错误 ${esc(String(code))}：${esc(msg || '未知错误')}`;
      };

      const fetchOrders = async () => {
        if (!timeSynced) await syncTime();
        const params = new URLSearchParams();
        const sym = symInput.value.trim().toUpperCase();
        if (sym) params.set('symbol', sym);
        params.set('limit', '1000');
        params.set('timestamp', String(Date.now() + serverOffset));
        params.set('recvWindow', String(RECV_WINDOW));
        const qs = params.toString();
        const signature = await hmacSha256Hex(apiSecret, qs);
        const res = await fetch(`${ORDERS_URL}?${qs}&signature=${signature}`, {
          headers: { 'X-MBX-APIKEY': apiKey },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error('binance');
          err.code = data && typeof data.code === 'number' ? data.code : res.status;
          err.msg = data && data.msg ? String(data.msg) : `http ${res.status}`;
          throw err;
        }
        if (!Array.isArray(data)) throw new Error('bad data');
        return data;
      };

      const loadOrders = async () => {
        if (!alive || loading) return;
        if (!hasKeys()) {
          orders = [];
          setConn('idle');
          renderGuide();
          return;
        }
        loading = true;
        try {
          let data;
          try {
            data = await fetchOrders();
          } catch (e) {
            if (!e || e.code !== -1021) throw e;
            // 时间不同步（-1021）：强制重校服务器时间后再试一次
            await syncTime();
            data = await fetchOrders();
          }
          if (!alive) return;
          orders = data
            .filter((o) => o && Number.isFinite(Number(o.time)))
            .map((o) => ({ ...o, time: Number(o.time) }))
            .sort((a, b) => b.time - a.time); // 倒序：最新在前
          hideHint();
          setConn('live');
          render();
        } catch (e) {
          if (!alive) return;
          if (e && typeof e.code === 'number') {
            showHint(friendlyError(e.code, e.msg));
          } else {
            showHint('网络错误，无法连接币安 API，请检查网络后点击「刷新」重试');
          }
          setConn('fail');
        } finally {
          loading = false;
        }
      };

      el.querySelector('[data-save]').addEventListener('click', () => {
        if (!inKey.value.trim() || !inSecret.value.trim()) {
          showHint('请同时填写 API Key 与 Secret Key');
          return;
        }
        saveKeys();
        syncKeysUi();
        hideHint();
        timeSynced = false; // 新会话先重新校时
        loadOrders();
      });
      el.querySelector('[data-clear]').addEventListener('click', () => {
        wipeKeys();
        orders = [];
        syncKeysUi();
        setConn('idle');
        renderGuide();
      });
      el.querySelector('[data-edit]').addEventListener('click', () => {
        keysBox.style.display = '';
        keysBar.style.display = 'none';
        inKey.value = apiKey;
        inSecret.value = '';
        inSecret.placeholder = '重新输入 Secret（不会回显已保存值）';
      });
      el.querySelector('[data-wipe]').addEventListener('click', () => {
        wipeKeys();
        orders = [];
        syncKeysUi();
        setConn('idle');
        renderGuide();
      });
      el.querySelector('[data-refresh]').addEventListener('click', () => loadOrders());
      daysSel.addEventListener('change', () => {
        if (hasKeys() && orders.length) render();
      });
      symInput.addEventListener('change', () => {
        if (hasKeys()) loadOrders();
      });

      // 初始化
      if (loadKeys()) {
        syncKeysUi();
        renderGuide();
        loadOrders();
      } else {
        syncKeysUi();
        renderGuide();
      }
      refreshTimer = setInterval(() => loadOrders(), REFRESH_MS);

      return () => {
        alive = false;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      };
    },
  };
})();
