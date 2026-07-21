/* 美联储议息会议倒计时 — 显示下一次 FOMC 会议倒计时、当前联邦基金目标区间、
 * 市场加息/暂停/降息概率（来自 CME FedWatch，失败时显示占位与链接），
 * 以及当年剩余 FOMC 会议列表。
 * 数据来源：
 *   - FOMC 日程：硬编码 2025-2026 年官方日程，并尝试通过 /api/proxy 抓取
 *     federalreserve.gov/monetarypolicy/fomccalendars.htm 做校验/更新。
 *   - 利率概率：优先尝试 CME FedWatch 页面（经 /api/proxy），失败回退到静态占位。
 *   - 当前目标区间：默认 4.25%-4.50%，并尝试从 FRED 有效联邦基金利率(DFF)
 *     CSV 经 /api/proxy 更新。
 * 注意：所有外部接口均可能因 CORS/反爬而失败，组件会优雅降级到硬编码数据并给出外部链接。
 * Registers as custom tool id 'fedmeetings' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const TOOL_ID = 'fedmeetings';
  const STYLE_ID = `${TOOL_ID}-style`;

  // 硬编码 2025-2026 FOMC 会议（第一天开始，第二天 14:00 ET 发布声明）
  // 格式：[年份, 月, 第一天, 第二天]
  const BASE_MEETINGS = [
    // 2025
    { year: 2025, month: 1, d1: 28, d2: 29 },
    { year: 2025, month: 3, d1: 18, d2: 19 },
    { year: 2025, month: 5, d1: 6, d2: 7 },
    { year: 2025, month: 6, d1: 17, d2: 18 },
    { year: 2025, month: 7, d1: 29, d2: 30 },
    { year: 2025, month: 9, d1: 16, d2: 17 },
    { year: 2025, month: 10, d1: 28, d2: 29 },
    { year: 2025, month: 12, d1: 16, d2: 17 },
    // 2026
    { year: 2026, month: 1, d1: 27, d2: 28 },
    { year: 2026, month: 3, d1: 17, d2: 18 },
    { year: 2026, month: 5, d1: 6, d2: 7 },
    { year: 2026, month: 6, d1: 16, d2: 17 },
    { year: 2026, month: 7, d1: 28, d2: 29 },
    { year: 2026, month: 9, d1: 22, d2: 23 },
    { year: 2026, month: 10, d1: 27, d2: 28 },
    { year: 2026, month: 12, d1: 15, d2: 16 },
  ];

  const DEFAULT_TARGET = { low: 4.25, high: 4.50 };
  const PROB_LINK = 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html';
  const FED_CAL_LINK = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

  const REFRESH_MS = 5 * 60 * 1000; // 数据 5 分钟刷新
  const COUNTDOWN_MS = 1000;        // 倒计时 1 秒刷新

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.fed-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow: auto;
}
.fed-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.fed-status { color: var(--warning); white-space: nowrap; }
.fed-status.live { color: var(--acc); }
.fed-countdown {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  padding: 14px 12px;
  text-align: center;
}
.fed-countdown-label {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.fed-countdown-row {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-mono);
  margin-bottom: 6px;
}
.fed-cd-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 44px;
}
.fed-cd-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.fed-cd-unit {
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 4px;
  letter-spacing: 0.08em;
}
.fed-cd-sep {
  font-size: 22px;
  color: var(--text-dim);
  line-height: 1;
  padding-bottom: 12px;
}
.fed-next-date {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.fed-target {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  background: var(--surface);
}
.fed-target-label {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}
.fed-target-value {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 700;
  color: var(--acc);
  font-variant-numeric: tabular-nums;
}
.fed-prob {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  background: var(--surface);
}
.fed-prob-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.fed-prob-head a {
  color: var(--acc);
  text-decoration: none;
}
.fed-prob-head a:hover { text-decoration: underline; }
.fed-prob-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 10px;
}
.fed-prob-row:last-child { margin-bottom: 0; }
.fed-prob-name {
  width: 44px;
  flex: none;
  color: var(--text-muted);
  letter-spacing: 0.08em;
}
.fed-prob-bar-wrap {
  flex: 1;
  height: 8px;
  background: color-mix(in srgb, var(--text) 6%, transparent);
  border-radius: 999px;
  overflow: hidden;
}
.fed-prob-bar {
  height: 100%;
  border-radius: 999px;
  min-width: 2px;
  transition: width 0.3s var(--ease-fluid);
}
.fed-prob-bar.cut { background: var(--down); }
.fed-prob-bar.pause { background: var(--info); }
.fed-prob-bar.hike { background: var(--up); }
.fed-prob-pct {
  width: 40px;
  flex: none;
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.fed-prob-note {
  font-size: 9px;
  color: var(--text-dim);
  margin-top: 8px;
  line-height: 1.4;
}
.fed-list {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
  flex: 1;
  min-height: 80px;
}
.fed-list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-raised);
}
.fed-list-head a {
  color: var(--acc);
  text-decoration: none;
}
.fed-list-head a:hover { text-decoration: underline; }
.fed-list-table {
  width: 100%;
  font-size: 10px;
  border-collapse: collapse;
}
.fed-list-table th,
.fed-list-table td {
  padding: 7px 10px;
  text-align: left;
  white-space: nowrap;
}
.fed-list-table th {
  color: var(--text-dim);
  font-weight: 500;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--hairline);
}
.fed-list-table td {
  color: var(--text);
  border-bottom: 1px solid var(--hairline);
}
.fed-list-table tr:last-child td { border-bottom: none; }
.fed-list-table td:nth-child(2),
.fed-list-table td:nth-child(3) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.fed-list-table .fed-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  font-size: 9px;
  color: var(--text-muted);
}
.fed-list-table .fed-tag.next {
  color: var(--acc);
  border-color: var(--acc);
  background: var(--acc-glow);
}
.fed-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
.fed-foot a { color: var(--acc); text-decoration: none; }
.fed-foot a:hover { text-decoration: underline; }
.fed-error {
  color: var(--warning);
  font-size: 10px;
  line-height: 1.4;
}
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const fmtPct = (v, digits = 1) => {
    if (!Number.isFinite(v)) return '—';
    return `${v.toFixed(digits)}%`;
  };

  const fmtRate = (v) => {
    if (!Number.isFinite(v)) return '—';
    return `${v.toFixed(2)}%`;
  };

  // FOMC 会议 statement 发布时间：第二天 14:00 ET
  const meetingStatementTimeNY = (m) => {
    return new Date(`${m.year}-${String(m.month).padStart(2, '0')}-${String(m.d2).padStart(2, '0')}T14:00:00-04:00`);
  };

  // 按当前 UTC 时间过滤出未来会议（含当天未发布的）
  const futureMeetings = (list) => {
    const now = Date.now();
    return list.filter((m) => meetingStatementTimeNY(m).getTime() > now);
  };

  // 解析 federalreserve.gov 日历 HTML，提取当年和下一年 FOMC 日期
  const parseFedCalendar = (html) => {
    const meetings = [];
    if (!html) return meetings;
    // 新站点通常用 <div class="panel panel-default"> 包裹每个月，日期格式 "Month dd-dd, yyyy" 或 "Month dd-dd"
    const monthRe = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})-(\d{1,2})(?:,\s+(\d{4}))?/gi;
    let m;
    const months = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    };
    const currentYear = new Date().getFullYear();
    while ((m = monthRe.exec(html)) !== null) {
      const mon = months[m[1].toLowerCase()];
      const d1 = parseInt(m[2], 10);
      const d2 = parseInt(m[3], 10);
      const year = m[4] ? parseInt(m[4], 10) : currentYear;
      if (mon && d1 && d2) {
        meetings.push({ year, month: mon, d1, d2 });
      }
    }
    return meetings;
  };

  // 解析 CME FedWatch 页面中常见的概率文本（尽力而为）
  const parseCmeProbabilities = (html) => {
    if (!html) return null;
    const out = { cut: null, pause: null, hike: null, source: 'CME FedWatch' };
    // 常见文本模式："Probability of X bps hike/cut/unchanged"
    const re = /(\d+\.?\d*)%\s*(?:probability|prob)\s*(?:of\s+a)?\s*([\d\-]+)\s*(?:bps?)?\s*(hike|cut|increase|decrease|lower|raise|unchanged|hold|no\s*change)/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const pct = parseFloat(m[1]);
      const action = m[3].toLowerCase();
      if (!Number.isFinite(pct)) continue;
      if (/hike|increase|raise/.test(action)) out.hike = (out.hike || 0) + pct;
      else if (/cut|decrease|lower/.test(action)) out.cut = (out.cut || 0) + pct;
      else if (/unchanged|hold|no\s*change|pause/.test(action)) out.pause = (out.pause || 0) + pct;
    }
    if (out.cut == null && out.pause == null && out.hike == null) return null;
    // 归一化
    const sum = (out.cut || 0) + (out.pause || 0) + (out.hike || 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.5) {
      const factor = 100 / sum;
      if (out.cut != null) out.cut *= factor;
      if (out.pause != null) out.pause *= factor;
      if (out.hike != null) out.hike *= factor;
    }
    return out;
  };

  // 解析 FRED DFF CSV 最后一行
  const parseFredDff = (csv) => {
    if (!csv) return null;
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1];
    const parts = last.split(',');
    if (parts.length < 2) return null;
    const val = parseFloat(parts[parts.length - 1]);
    if (!Number.isFinite(val)) return null;
    return val;
  };

  window.GT_EXTRA_TOOLS[TOOL_ID] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool fed-root">
          <div class="fed-head">
            <span>美联储 · FOMC 议息会议</span>
            <span class="fed-status" data-conn>连接中…</span>
          </div>
          <div class="fed-countdown">
            <div class="fed-countdown-label">距下次 FOMC 声明发布</div>
            <div class="fed-countdown-row" data-cd>
              <span class="fed-cd-block"><span class="fed-cd-num" data-days>—</span><span class="fed-cd-unit">天</span></span>
              <span class="fed-cd-sep">:</span>
              <span class="fed-cd-block"><span class="fed-cd-num" data-hours>—</span><span class="fed-cd-unit">时</span></span>
              <span class="fed-cd-sep">:</span>
              <span class="fed-cd-block"><span class="fed-cd-num" data-minutes>—</span><span class="fed-cd-unit">分</span></span>
              <span class="fed-cd-sep">:</span>
              <span class="fed-cd-block"><span class="fed-cd-num" data-seconds>—</span><span class="fed-cd-unit">秒</span></span>
            </div>
            <div class="fed-next-date" data-next-date>—</div>
          </div>
          <div class="fed-target">
            <span class="fed-target-label">当前联邦基金目标区间</span>
            <span class="fed-target-value" data-target>—</span>
          </div>
          <div class="fed-prob">
            <div class="fed-prob-head">
              <span>下次会议利率路径概率</span>
              <a href="${esc(PROB_LINK)}" target="_blank" rel="noopener">CME FedWatch →</a>
            </div>
            <div data-prob-rows>
              <div class="fed-prob-row"><span class="fed-prob-name">降息</span><div class="fed-prob-bar-wrap"><div class="fed-prob-bar cut" style="width:0%"></div></div><span class="fed-prob-pct">—</span></div>
              <div class="fed-prob-row"><span class="fed-prob-name">暂停</span><div class="fed-prob-bar-wrap"><div class="fed-prob-bar pause" style="width:0%"></div></div><span class="fed-prob-pct">—</span></div>
              <div class="fed-prob-row"><span class="fed-prob-name">加息</span><div class="fed-prob-bar-wrap"><div class="fed-prob-bar hike" style="width:0%"></div></div><span class="fed-prob-pct">—</span></div>
            </div>
            <div class="fed-prob-note" data-prob-note>概率数据加载中…</div>
          </div>
          <div class="fed-list">
            <div class="fed-list-head">
              <span>当年剩余会议</span>
              <a href="${esc(FED_CAL_LINK)}" target="_blank" rel="noopener">官网日程 →</a>
            </div>
            <table class="fed-list-table">
              <thead><tr><th>日期</th><th>开始</th><th>声明(ET)</th><th>状态</th></tr></thead>
              <tbody data-list></tbody>
            </table>
          </div>
          <div class="fed-foot">
            <span data-src>来源：Federal Reserve / CME Group</span>
            <span>更新 <b data-time>—</b></span>
          </div>
          <div class="tool-hint fed-error" data-hint style="display:none"></div>
        </div>`;

      const conn = el.querySelector('[data-conn]');
      const daysEl = el.querySelector('[data-days]');
      const hoursEl = el.querySelector('[data-hours]');
      const minutesEl = el.querySelector('[data-minutes]');
      const secondsEl = el.querySelector('[data-seconds]');
      const nextDateEl = el.querySelector('[data-next-date]');
      const targetEl = el.querySelector('[data-target]');
      const probRowsEl = el.querySelector('[data-prob-rows]');
      const probNoteEl = el.querySelector('[data-prob-note]');
      const listEl = el.querySelector('[data-list]');
      const srcEl = el.querySelector('[data-src]');
      const timeEl = el.querySelector('[data-time]');
      const hint = el.querySelector('[data-hint]');

      let alive = true;
      let meetings = BASE_MEETINGS.slice();
      let target = { ...DEFAULT_TARGET };
      let probabilities = null;
      let countdownTimer = null;
      let refreshTimer = null;
      let controller = null;

      const proxyUrl = (targetUrl) => `/api/proxy?url=${encodeURIComponent(targetUrl)}`;

      const showError = (msg) => {
        hint.textContent = msg;
        hint.style.display = '';
        conn.textContent = '连接失败';
        conn.className = 'fed-status';
        setStatus('offline');
      };

      const clearError = () => {
        hint.style.display = 'none';
        conn.textContent = '● LIVE';
        conn.className = 'fed-status live';
        setStatus('online');
      };

      const renderTarget = () => {
        targetEl.textContent = `${fmtRate(target.low)} – ${fmtRate(target.high)}`;
      };

      const renderProbabilities = () => {
        const p = probabilities || { cut: 35, pause: 55, hike: 10, source: '静态占位' };
        const rows = [
          { key: 'cut', label: '降息', cls: 'cut' },
          { key: 'pause', label: '暂停', cls: 'pause' },
          { key: 'hike', label: '加息', cls: 'hike' },
        ];
        probRowsEl.innerHTML = rows
          .map((r) => {
            const v = p[r.key];
            const pct = Number.isFinite(v) ? v : 0;
            return `<div class="fed-prob-row">
              <span class="fed-prob-name">${esc(r.label)}</span>
              <div class="fed-prob-bar-wrap"><div class="fed-prob-bar ${r.cls}" style="width:${pct.toFixed(1)}%"></div></div>
              <span class="fed-prob-pct">${fmtPct(pct)}</span>
            </div>`;
          })
          .join('');
        if (probabilities && probabilities.source) {
          probNoteEl.textContent = `基于 ${esc(probabilities.source)} 最新数据。市场隐含概率仅供参考，非官方预测。`;
        } else {
          probNoteEl.innerHTML = `概率占位数据；实时概率请查看 <a href="${esc(PROB_LINK)}" target="_blank" rel="noopener">CME FedWatch Tool</a>。`;
        }
      };

      const renderList = () => {
        const fut = futureMeetings(meetings);
        const currentYear = new Date().getFullYear();
        const yearMeetings = meetings.filter((m) => m.year === currentYear);
        const next = fut[0];

        if (!yearMeetings.length) {
          listEl.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim)">当年暂无剩余会议</td></tr>`;
          return;
        }

        listEl.innerHTML = yearMeetings
          .map((m) => {
            const isNext = next && m.year === next.year && m.month === next.month && m.d1 === next.d1;
            const start = `${m.month}/${m.d1}`;
            const statement = `${m.month}/${m.d2} 14:00`;
            return `<tr>
              <td>${esc(String(m.month).padStart(2, '0') + '/' + String(m.d1).padStart(2, '0'))}</td>
              <td>${esc(start)}</td>
              <td>${esc(statement)}</td>
              <td><span class="fed-tag ${isNext ? 'next' : ''}">${isNext ? 'NEXT' : '待定'}</span></td>
            </tr>`;
          })
          .join('');
      };

      const updateCountdown = () => {
        const fut = futureMeetings(meetings);
        const next = fut[0];
        if (!next) {
          daysEl.textContent = '—';
          hoursEl.textContent = '—';
          minutesEl.textContent = '—';
          secondsEl.textContent = '—';
          nextDateEl.textContent = '暂无未来会议';
          return;
        }
        const t = meetingStatementTimeNY(next).getTime();
        const diff = t - Date.now();
        if (diff <= 0) {
          daysEl.textContent = '00';
          hoursEl.textContent = '00';
          minutesEl.textContent = '00';
          secondsEl.textContent = '00';
          nextDateEl.textContent = 'FOMC 声明已发布';
          return;
        }
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const pad = (n) => String(n).padStart(2, '0');
        daysEl.textContent = pad(days);
        hoursEl.textContent = pad(hours);
        minutesEl.textContent = pad(minutes);
        secondsEl.textContent = pad(seconds);
        const d = meetingStatementTimeNY(next);
        const opts = { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        nextDateEl.textContent = `${d.toLocaleString('zh-CN', opts)} ET · ${next.year}年${next.month}月`;
      };

      const fetchCalendar = async () => {
        try {
          const url = proxyUrl('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
          if (!res.ok) return null;
          const html = await res.text();
          const parsed = parseFedCalendar(html);
          if (parsed.length >= 4) return parsed;
          return null;
        } catch (e) {
          return null;
        }
      };

      const fetchProbabilities = async () => {
        try {
          const url = proxyUrl('https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html');
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
          if (!res.ok) return null;
          const html = await res.text();
          return parseCmeProbabilities(html);
        } catch (e) {
          return null;
        }
      };

      const fetchTarget = async () => {
        try {
          // FRED DFF CSV 最近数据
          const today = new Date().toISOString().slice(0, 10);
          const url = proxyUrl(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF&cosd=2024-01-01&coed=${today}`);
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
          if (!res.ok) return null;
          const csv = await res.text();
          const rate = parseFredDff(csv);
          if (!Number.isFinite(rate)) return null;
          // 有效利率通常位于目标区间中点附近；这里仅做展示，目标区间仍用默认值
          return rate;
        } catch (e) {
          return null;
        }
      };

      const loadData = async () => {
        if (controller) controller.abort();
        controller = new AbortController();

        const [cal, prob, effRate] = await Promise.all([
          fetchCalendar(),
          fetchProbabilities(),
          fetchTarget(),
        ]);

        if (!alive) return;

        let updated = false;
        if (cal && cal.length) {
          meetings = cal;
          updated = true;
        }
        if (prob) {
          probabilities = prob;
          updated = true;
        }
        if (effRate != null) {
          // 以有效利率为中枢，设定 ±0.125% 的展示区间（实际目标区间以 Fed 公布为准）
          target.low = Math.max(0, effRate - 0.125);
          target.high = effRate + 0.125;
          updated = true;
        }

        renderTarget();
        renderProbabilities();
        renderList();
        updateCountdown();

        const now = new Date();
        timeEl.textContent = now.toTimeString().slice(0, 8);

        if (updated) {
          srcEl.textContent = '来源：Federal Reserve / CME Group / FRED';
          clearError();
        } else {
          srcEl.textContent = '来源：Federal Reserve / CME Group / FRED（离线占位）';
          // 硬编码数据可用，不算完全失败
          setStatus('online');
        }
      };

      renderTarget();
      renderProbabilities();
      renderList();
      updateCountdown();

      setStatus('loading');
      loadData().catch((e) => {
        if (!alive) return;
        showError('FOMC 数据加载失败，已显示硬编码日程与占位概率。');
        renderTarget();
        renderProbabilities();
        renderList();
        updateCountdown();
      });

      countdownTimer = setInterval(updateCountdown, COUNTDOWN_MS);
      refreshTimer = setInterval(() => {
        if (!alive) return;
        loadData().catch(() => {
          if (!alive) return;
          showError('自动刷新失败，倒计时仍继续运行。');
        });
      }, REFRESH_MS);

      return () => {
        alive = false;
        clearInterval(countdownTimer);
        clearInterval(refreshTimer);
        if (controller) controller.abort();
      };
    },
  };
})();
