/* 全球市场假期日历 — 纯 JS 静态数据（无网络请求，挂载即 online）
 * 数据: 2026 年全球主要交易所休市日，逐条按公开资料编制（编制时间 2026-07-16），来源：
 *   - 中国A股(沪深北): 上交所/深交所 2025-12-22《2026年部分节假日休市安排》(元旦1/1-1/3、春节2/15-2/23、
 *     清明4/4-4/6、劳动节5/1-5/5、端午6/19-6/21、中秋9/25-9/27、国庆10/1-10/7)
 *   - 中国香港(HKEX): 香港政府宪报 2026 年公众假期(gov.hk)，周六落假的佛诞/重阳/中秋翌日等已按补假处理
 *   - 美国(NYSE): nyse.com 2026 休市日（独立日 7/4 逢周六 → 7/3 补休）
 *   - 英国(LSE): gov.uk bank-holidays.json 英格兰 2026（Boxing Day 逢周六 → 12/28 补休）
 *   - 日本(TSE/JPX): JPX 2026 休市日 = 国民祝日 + 年末年始；2026 出现白银周(9/21-9/23，9/22 为国民の休日)
 *   - 德国(XETRA): Deutsche Börse 2026 trading calendar（升天节/圣灵降临节/基督圣体节照常交易，全年仅 7 个整日休市）
 *   - 新加坡(SGX): MOM 2026 公众假期（开斋节 3/21 逢周六不造成额外休市，未列入；卫塞节/国庆/屠妖节逢周日顺延周一）
 * 字段: m=市场代码 s=休市开始(含) e=休市结束(含) n=假期名称；日期为各交易所当地日历日。
 * 口径说明: 仅含整日休市，不含提前收盘(half-day)与台风等临时休市；倒计时按用户本地日期计算。
 * 配色: 今日休市高亮用 --warning，其余中性色，无涨跌红绿约定。
 * Registers as custom tool id 'holidays' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const COMPILED_AT = '2026-07-16'; // 数据编制日期
  const WINDOW_DAYS = 90; // 展示未来 90 天内的休市事件
  const DAY_MS = 86400000;
  const TICK_MS = 30000; // 低频检查本地日期是否跨天（跨天即重算）

  const MARKETS = [
    { id: 'CN', flag: '🇨🇳', short: 'A股', full: '中国A股 · 沪深' },
    { id: 'HK', flag: '🇭🇰', short: '港股', full: '中国香港 · HKEX' },
    { id: 'US', flag: '🇺🇸', short: '美股', full: '美国 · NYSE' },
    { id: 'GB', flag: '🇬🇧', short: '英国', full: '英国 · LSE' },
    { id: 'JP', flag: '🇯🇵', short: '日本', full: '日本 · TSE' },
    { id: 'DE', flag: '🇩🇪', short: '德国', full: '德国 · XETRA' },
    { id: 'SG', flag: '🇸🇬', short: '新加坡', full: '新加坡 · SGX' },
  ];
  const MMAP = {};
  MARKETS.forEach((m) => { MMAP[m.id] = m; });

  // 2026 年休市日（s/e 均为含当日；单日假期 e === s）
  const HOLIDAYS = [
    // 中国A股（沪深交易所公告口径，休市区间含周末）
    { m: 'CN', s: '2026-01-01', e: '2026-01-03', n: '元旦' },
    { m: 'CN', s: '2026-02-15', e: '2026-02-23', n: '春节' },
    { m: 'CN', s: '2026-04-04', e: '2026-04-06', n: '清明节' },
    { m: 'CN', s: '2026-05-01', e: '2026-05-05', n: '劳动节' },
    { m: 'CN', s: '2026-06-19', e: '2026-06-21', n: '端午节' },
    { m: 'CN', s: '2026-09-25', e: '2026-09-27', n: '中秋节' },
    { m: 'CN', s: '2026-10-01', e: '2026-10-07', n: '国庆节' },
    // 中国香港（HKEX，周六落假不造成额外休市的已剔除：4/4 耶稣受难节翌日、9/26 中秋翌日、12/26 圣诞节后首个周日）
    { m: 'HK', s: '2026-01-01', e: '2026-01-01', n: '元旦' },
    { m: 'HK', s: '2026-02-17', e: '2026-02-19', n: '农历新年' },
    { m: 'HK', s: '2026-04-03', e: '2026-04-03', n: '耶稣受难节' },
    { m: 'HK', s: '2026-04-06', e: '2026-04-06', n: '清明节补假' },
    { m: 'HK', s: '2026-04-07', e: '2026-04-07', n: '复活节星期一补假' },
    { m: 'HK', s: '2026-05-01', e: '2026-05-01', n: '劳动节' },
    { m: 'HK', s: '2026-05-25', e: '2026-05-25', n: '佛诞补假' },
    { m: 'HK', s: '2026-06-19', e: '2026-06-19', n: '端午节' },
    { m: 'HK', s: '2026-07-01', e: '2026-07-01', n: '香港特区成立纪念日' },
    { m: 'HK', s: '2026-10-01', e: '2026-10-01', n: '国庆日' },
    { m: 'HK', s: '2026-10-19', e: '2026-10-19', n: '重阳节补假' },
    { m: 'HK', s: '2026-12-25', e: '2026-12-25', n: '圣诞节' },
    // 美国 NYSE（独立日 7/4 逢周六 → 7/3 补休）
    { m: 'US', s: '2026-01-01', e: '2026-01-01', n: '元旦' },
    { m: 'US', s: '2026-01-19', e: '2026-01-19', n: '马丁·路德·金纪念日' },
    { m: 'US', s: '2026-02-16', e: '2026-02-16', n: '总统日' },
    { m: 'US', s: '2026-04-03', e: '2026-04-03', n: '耶稣受难日' },
    { m: 'US', s: '2026-05-25', e: '2026-05-25', n: '阵亡将士纪念日' },
    { m: 'US', s: '2026-06-19', e: '2026-06-19', n: '六月节' },
    { m: 'US', s: '2026-07-03', e: '2026-07-03', n: '独立日(补休)' },
    { m: 'US', s: '2026-09-07', e: '2026-09-07', n: '劳工节' },
    { m: 'US', s: '2026-11-26', e: '2026-11-26', n: '感恩节' },
    { m: 'US', s: '2026-12-25', e: '2026-12-25', n: '圣诞节' },
    // 英国 LSE（英格兰银行假日）
    { m: 'GB', s: '2026-01-01', e: '2026-01-01', n: '元旦' },
    { m: 'GB', s: '2026-04-03', e: '2026-04-03', n: '耶稣受难日' },
    { m: 'GB', s: '2026-04-06', e: '2026-04-06', n: '复活节星期一' },
    { m: 'GB', s: '2026-05-04', e: '2026-05-04', n: '五月初银行假日' },
    { m: 'GB', s: '2026-05-25', e: '2026-05-25', n: '春季银行假日' },
    { m: 'GB', s: '2026-08-31', e: '2026-08-31', n: '夏季银行假日' },
    { m: 'GB', s: '2026-12-25', e: '2026-12-25', n: '圣诞节' },
    { m: 'GB', s: '2026-12-28', e: '2026-12-28', n: '节礼日(补休)' },
    // 日本 TSE（国民祝日 + 年末年始；9/22 为两祝日之间的国民の休日）
    { m: 'JP', s: '2026-01-01', e: '2026-01-02', n: '年末年始' },
    { m: 'JP', s: '2026-01-12', e: '2026-01-12', n: '成人之日' },
    { m: 'JP', s: '2026-02-11', e: '2026-02-11', n: '建国纪念日' },
    { m: 'JP', s: '2026-02-23', e: '2026-02-23', n: '天皇诞生日' },
    { m: 'JP', s: '2026-03-20', e: '2026-03-20', n: '春分之日' },
    { m: 'JP', s: '2026-04-29', e: '2026-04-29', n: '昭和之日' },
    { m: 'JP', s: '2026-05-04', e: '2026-05-06', n: '黄金周(绿之日/宪法补假/儿童之日)' },
    { m: 'JP', s: '2026-07-20', e: '2026-07-20', n: '海之日' },
    { m: 'JP', s: '2026-08-11', e: '2026-08-11', n: '山之日' },
    { m: 'JP', s: '2026-09-21', e: '2026-09-23', n: '白银周(敬老/国民休日/秋分)' },
    { m: 'JP', s: '2026-10-12', e: '2026-10-12', n: '体育之日' },
    { m: 'JP', s: '2026-11-03', e: '2026-11-03', n: '文化之日' },
    { m: 'JP', s: '2026-11-23', e: '2026-11-23', n: '勤劳感谢之日' },
    { m: 'JP', s: '2026-12-31', e: '2026-12-31', n: '年末年始' },
    // 德国 XETRA（全年仅 7 个整日休市，升天节/圣灵降临节/基督圣体节照常交易）
    { m: 'DE', s: '2026-01-01', e: '2026-01-01', n: '元旦' },
    { m: 'DE', s: '2026-04-03', e: '2026-04-03', n: '耶稣受难日' },
    { m: 'DE', s: '2026-04-06', e: '2026-04-06', n: '复活节星期一' },
    { m: 'DE', s: '2026-05-01', e: '2026-05-01', n: '劳动节' },
    { m: 'DE', s: '2026-12-24', e: '2026-12-25', n: '圣诞节' },
    { m: 'DE', s: '2026-12-31', e: '2026-12-31', n: '除夕' },
    // 新加坡 SGX（开斋节 3/21 逢周六不额外休市；卫塞节/国庆/屠妖节逢周日顺延至周一）
    { m: 'SG', s: '2026-01-01', e: '2026-01-01', n: '元旦' },
    { m: 'SG', s: '2026-02-17', e: '2026-02-18', n: '农历新年' },
    { m: 'SG', s: '2026-04-03', e: '2026-04-03', n: '耶稣受难日' },
    { m: 'SG', s: '2026-05-01', e: '2026-05-01', n: '劳动节' },
    { m: 'SG', s: '2026-05-27', e: '2026-05-27', n: '哈芝节' },
    { m: 'SG', s: '2026-06-01', e: '2026-06-01', n: '卫塞节(补假)' },
    { m: 'SG', s: '2026-08-10', e: '2026-08-10', n: '国庆日(补假)' },
    { m: 'SG', s: '2026-11-09', e: '2026-11-09', n: '屠妖节(补假)' },
    { m: 'SG', s: '2026-12-25', e: '2026-12-25', n: '圣诞节' },
  ];

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 'YYYY-MM-DD' → 本地时区当日零点 Date（避免 new Date(str) 按 UTC 解析造成的日期偏移）
  const parseDay = (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const todayStart = () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  };
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtMD = (d) => `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // 预解析并升序排序（模块级一次性）
  const EVENTS = HOLIDAYS.map((h) => ({ ...h, sd: parseDay(h.s), ed: parseDay(h.e) }))
    .sort((a, b) => a.sd - b.sd || a.ed - b.ed);

  function injectStyle() {
    if (document.getElementById('hday-style')) return;
    const style = document.createElement('style');
    style.id = 'hday-style';
    style.textContent = `
.hday-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.hday-status { color: var(--acc); white-space: nowrap; }
.hday-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.hday-chip {
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition: color 0.25s var(--ease-fluid), border-color 0.25s var(--ease-fluid), background 0.25s var(--ease-fluid);
}
.hday-chip:hover { color: var(--text); border-color: var(--hairline-strong); }
.hday-chip.on {
  color: var(--acc);
  border-color: color-mix(in srgb, var(--acc) 45%, transparent);
  background: color-mix(in srgb, var(--acc) 10%, transparent);
}
.hday-today {
  font-size: 10px;
  line-height: 1.6;
  border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  margin-bottom: 8px;
  color: var(--text);
}
.hday-today .hday-t-title {
  color: var(--warning);
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-right: 6px;
}
.hday-today .hday-t-item { white-space: nowrap; margin-right: 8px; }
.hday-today .hday-t-item .hday-dim { color: var(--text-muted); }
.hday-open {
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.hday-table-wrap { min-height: 100px; }
.hday-table { width: 100%; font-variant-numeric: tabular-nums; }
.hday-table th, .hday-table td { white-space: nowrap; }
.hday-table th:last-child, .hday-table td:last-child { text-align: right; }
.hday-date { font-family: var(--font-mono); }
.hday-range { color: var(--text-dim); font-size: 9px; }
.hday-wd { color: var(--text-dim); }
.hday-mkt { cursor: pointer; }
.hday-mkt:hover { text-decoration: underline; text-underline-offset: 2px; }
.hday-cd { font-family: var(--font-mono); color: var(--text-muted); }
.hday-cd.soon { color: var(--warning); }
.hday-cd.now { color: var(--warning); font-weight: 700; }
.hday-table tr.hday-now td { background: color-mix(in srgb, var(--warning) 8%, transparent); }
.hday-table tbody td { transition: background 0.25s var(--ease-fluid); }
.hday-table tbody tr:hover td { background: var(--surface-raised); }
.hday-table tbody tr.hday-now:hover td { background: color-mix(in srgb, var(--warning) 14%, transparent); }
.hday-empty td {
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 4px;
}
.hday-foot {
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

  window.GT_EXTRA_TOOLS['holidays'] = {
    mount(el, setStatus) {
      injectStyle();

      el.innerHTML = `
        <div class="tool hday-root">
          <div class="hday-head">
            <span>全球市场假期 · 2026</span>
            <span class="hday-status" data-conn>● 静态数据</span>
          </div>
          <div class="hday-chips" data-chips>
            <button type="button" class="hday-chip on" data-mkt="">全部</button>
            ${MARKETS.map((m) => `<button type="button" class="hday-chip" data-mkt="${esc(m.id)}">${esc(m.flag)} ${esc(m.short)}</button>`).join('')}
          </div>
          <div data-today></div>
          <div class="hday-table-wrap">
            <table class="data-table hday-table">
              <thead><tr><th>日期</th><th>星期</th><th>市场</th><th>假期</th><th>倒计时</th></tr></thead>
              <tbody data-body></tbody>
            </table>
          </div>
          <div class="hday-foot">
            <span>未来 ${WINDOW_DAYS} 天 · 编制于 ${esc(COMPILED_AT)} · 按本地日期重算</span>
            <span>仅供参考，以交易所公告为准</span>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const body = el.querySelector('[data-body]');
      const todayBox = el.querySelector('[data-today]');
      const chipsBox = el.querySelector('[data-chips]');
      const hint = el.querySelector('[data-hint]');

      let alive = true;
      let tickTimer = null;
      let lastDayKey = dayKey(new Date());
      let filter = ''; // '' = 全部
      const disposers = [];

      const on = (node, ev, fn) => {
        node.addEventListener(ev, fn);
        disposers.push(() => node.removeEventListener(ev, fn));
      };

      // 过滤 + 窗口裁剪：进行中或未来 90 天内的休市事件，按开始日升序
      const visibleEvents = (today) => {
        const winEnd = new Date(today.getTime() + WINDOW_DAYS * DAY_MS);
        return EVENTS.filter((h) => {
          if (filter && h.m !== filter) return false;
          return h.ed >= today && h.sd <= winEnd;
        });
      };

      const renderToday = (today) => {
        const closed = {};
        EVENTS.forEach((h) => {
          if (h.sd <= today && today <= h.ed) {
            (closed[h.m] = closed[h.m] || []).push(h.n);
          }
        });
        const ids = MARKETS.map((m) => m.id).filter((id) => closed[id]);
        if (!ids.length) {
          todayBox.innerHTML = `<div class="hday-open">✓ 今日 ${MARKETS.length} 个主要市场均无假期休市</div>`;
          return;
        }
        todayBox.innerHTML = `
          <div class="hday-today">
            <span class="hday-t-title">今日休市</span>
            ${ids.map((id) => {
              const m = MMAP[id];
              return `<span class="hday-t-item">${esc(m.flag)} <b>${esc(m.short)}</b> <span class="hday-dim">${esc(closed[id].join(' / '))}</span></span>`;
            }).join('')}
          </div>`;
      };

      const renderList = (today) => {
        const rows = visibleEvents(today);
        if (!rows.length) {
          body.innerHTML = `<tr class="hday-empty"><td colspan="5">${filter ? '该市场' : ''}未来 ${WINDOW_DAYS} 天内无休市安排</td></tr>`;
          return;
        }
        body.innerHTML = rows
          .map((h) => {
            const m = MMAP[h.m];
            const days = Math.round((h.sd - today) / DAY_MS); // 距开始日天数（进行中为负）
            const inProg = days <= 0 && today <= h.ed;
            const isRange = h.s !== h.e;
            let cdText;
            let cdCls = 'hday-cd';
            if (inProg) {
              cdText = '休市中';
              cdCls += ' now';
            } else if (days === 0) {
              cdText = '今天';
              cdCls += ' now';
            } else {
              cdText = `D-${days}`;
              if (days <= 7) cdCls += ' soon';
            }
            const dateCell = isRange
              ? `<span class="hday-date">${esc(fmtMD(h.sd))}</span><span class="hday-range">~${esc(fmtMD(h.ed))}</span>`
              : `<span class="hday-date">${esc(fmtMD(h.sd))}</span>`;
            return `
            <tr${inProg || days === 0 ? ' class="hday-now"' : ''}>
              <td>${dateCell}</td>
              <td class="hday-wd">${esc(WEEKDAYS[h.sd.getDay()])}</td>
              <td class="hday-mkt" data-mkt="${esc(h.m)}" title="点击过滤：${esc(m.full)}">${esc(m.flag)} ${esc(m.short)}</td>
              <td>${esc(h.n)}</td>
              <td class="${cdCls}">${esc(cdText)}</td>
            </tr>`;
          })
          .join('');
      };

      const render = () => {
        const today = todayStart();
        renderToday(today);
        renderList(today);
      };

      const setFilter = (id) => {
        filter = id;
        chipsBox.querySelectorAll('.hday-chip').forEach((b) =>
          b.classList.toggle('on', (b.getAttribute('data-mkt') || '') === filter));
        hint.style.display = 'none';
        render();
      };

      on(chipsBox, 'click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.hday-chip') : null;
        if (!btn) return;
        setFilter(btn.getAttribute('data-mkt') || '');
      });

      // 行内市场名点击 → 过滤该市场（再点顶部“全部”恢复）
      on(body, 'click', (e) => {
        const cell = e.target && e.target.closest ? e.target.closest('td.hday-mkt') : null;
        if (!cell) return;
        setFilter(cell.getAttribute('data-mkt') || '');
      });

      // 静态数据：挂载即 online
      setStatus('online');
      render();

      // 低频检查本地日期跨天（覆盖 0 点重算与休眠唤醒场景），document.hidden 时跳过
      tickTimer = setInterval(() => {
        if (!alive || document.hidden) return;
        const k = dayKey(new Date());
        if (k !== lastDayKey) {
          lastDayKey = k;
          render();
        }
      }, TICK_MS);

      return () => {
        alive = false;
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        disposers.forEach((fn) => fn());
        disposers.length = 0;
      };
    },
  };
})();
