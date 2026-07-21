/* 交易纪律清单 — 本地持久化，无外部请求
 * Registers as custom tool id 'checklist' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt-checklist-v1';
  const MAX_CUSTOM_LEN = 60;
  const MAX_CUSTOM_COUNT = 20;

  const DEFAULT_ITEMS = [
    { id: 'd1', text: '确认大趋势方向', custom: false },
    { id: 'd2', text: '标记关键支撑阻力', custom: false },
    { id: 'd3', text: '单笔风险 ≤ 2%', custom: false },
    { id: 'd4', text: '已设置止损', custom: false },
    { id: 'd5', text: '已计算仓位手数', custom: false },
    { id: 'd6', text: '已查财经日历无高冲击数据', custom: false },
    { id: 'd7', text: '情绪稳定无报复交易', custom: false },
  ];

  function injectStyle() {
    if (document.getElementById('ckl-style')) return;
    const style = document.createElement('style');
    style.id = 'ckl-style';
    style.textContent = `
.ckl-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.ckl-streak { font-family: var(--font-mono); color: var(--warning); }
.ckl-progress-wrap { margin-bottom: 10px; }
.ckl-progress-info {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}
.ckl-progress-label { font-size: 10px; color: var(--text-muted); letter-spacing: 0.08em; }
.ckl-progress-pct { font-family: var(--font-mono); font-size: 16px; font-weight: 600; color: var(--acc); font-variant-numeric: tabular-nums; }
.ckl-progress-pct.done { color: var(--acc); }
.ckl-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--hairline);
  overflow: hidden;
}
.ckl-bar-fill {
  height: 100%;
  width: 0;
  border-radius: 999px;
  background: var(--acc);
  transition: width 0.5s var(--ease-fluid);
}
.ckl-badge {
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--acc);
  border-radius: var(--radius-sm);
  color: var(--acc);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.ckl-badge.show { display: flex; }
.ckl-list { display: flex; flex-direction: column; }
.ckl-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 2px;
  border-bottom: 1px solid var(--hairline);
  font-size: 12px;
}
.ckl-item:last-child { border-bottom: none; }
.ckl-item input[type="checkbox"] {
  accent-color: var(--acc);
  width: 15px;
  height: 15px;
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
}
.ckl-text { flex: 1; min-width: 0; word-break: break-all; }
.ckl-item.checked .ckl-text { color: var(--text-dim); text-decoration: line-through; }
.ckl-del {
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  transition: color 0.25s var(--ease-snap);
}
.ckl-del:hover { color: var(--danger); }
.ckl-add { display: flex; gap: 6px; margin-top: 10px; }
.ckl-add input {
  flex: 1;
  min-width: 0;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 12px;
  padding: 7px 10px;
  outline: none;
  transition: border-color 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid);
}
.ckl-add input:focus { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-glow); }
.ckl-add input::placeholder { color: var(--text-dim); }
.ckl-add .tool-btn { flex-shrink: 0; }
`;
    document.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const todayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // 以 localDateStr 的前一日日期字符串（本地时区）
  const yesterdayStr = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const loadState = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return null;
      return {
        date: typeof s.date === 'string' ? s.date : '',
        items: Array.isArray(s.items) ? s.items.filter((it) => it && typeof it.id === 'string' && typeof it.text === 'string') : [],
        done: Array.isArray(s.done) ? s.done.filter((id) => typeof id === 'string') : [],
        streak: Number.isFinite(s.streak) ? s.streak : 0,
        lastCompleteDate: typeof s.lastCompleteDate === 'string' ? s.lastCompleteDate : '',
      };
    } catch (e) {
      return null;
    }
  };

  const saveState = (s) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch (e) {
      /* 存储不可用时静默降级，仅影响持久化 */
    }
  };

  window.GT_EXTRA_TOOLS['checklist'] = {
    mount(el, setStatus) {
      injectStyle();

      // 纯本地组件，无网络依赖
      setStatus('online');

      let state = loadState();
      if (!state) {
        state = { date: todayStr(), items: DEFAULT_ITEMS.slice(), done: [], streak: 0, lastCompleteDate: '' };
      }
      // 首次使用补默认项；已有用户若默认项缺失则不强制插入（尊重其删除），仅保留自定义项
      if (!state.items.length) state.items = DEFAULT_ITEMS.slice();

      // 日期变更：清空勾选，保留自定义项与 streak
      const today = todayStr();
      if (state.date !== today) {
        state.date = today;
        state.done = [];
      }
      saveState(state);

      el.innerHTML = `
        <div class="tool ckl-root">
          <div class="ckl-head"><span>交易纪律 · PRE-TRADE CHECKLIST</span><span class="ckl-streak" data-streak></span></div>
          <div class="ckl-progress-wrap">
            <div class="ckl-progress-info">
              <span class="ckl-progress-label">完成进度</span>
              <span class="ckl-progress-pct" data-pct>0%</span>
            </div>
            <div class="ckl-bar"><div class="ckl-bar-fill" data-fill></div></div>
          </div>
          <div class="ckl-badge" data-badge>✓ 准备就绪，可以交易</div>
          <div class="ckl-list" data-list></div>
          <div class="ckl-add">
            <input type="text" maxlength="${MAX_CUSTOM_LEN}" placeholder="添加自定义检查项…" data-input>
            <button class="tool-btn" type="button" data-add>添加</button>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const listEl = el.querySelector('[data-list]');
      const pctEl = el.querySelector('[data-pct]');
      const fillEl = el.querySelector('[data-fill]');
      const badgeEl = el.querySelector('[data-badge]');
      const streakEl = el.querySelector('[data-streak]');
      const inputEl = el.querySelector('[data-input]');
      const addBtn = el.querySelector('[data-add]');
      const hintEl = el.querySelector('[data-hint]');
      let alive = true;

      const showHint = (msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const clearHint = () => {
        hintEl.style.display = 'none';
      };

      const render = () => {
        const total = state.items.length;
        const doneSet = new Set(state.done);
        const doneCount = state.items.filter((it) => doneSet.has(it.id)).length;
        const pct = total ? Math.round((doneCount / total) * 100) : 0;

        pctEl.textContent = `${pct}%`;
        pctEl.classList.toggle('done', pct === 100 && total > 0);
        fillEl.style.width = `${pct}%`;
        badgeEl.classList.toggle('show', pct === 100 && total > 0);
        streakEl.textContent = state.streak > 0 ? `连续完成 ${state.streak} 天` : '';

        listEl.innerHTML = state.items
          .map(
            (it) => `
          <label class="ckl-item ${doneSet.has(it.id) ? 'checked' : ''}" data-id="${esc(it.id)}">
            <input type="checkbox" ${doneSet.has(it.id) ? 'checked' : ''}>
            <span class="ckl-text">${esc(it.text)}</span>
            <button class="ckl-del" type="button" title="删除" aria-label="删除">×</button>
          </label>`
          )
          .join('');
      };

      const persistAndRender = () => {
        saveState(state);
        render();
      };

      // 全部完成 → streak 每天只记一次：昨日也完成则连续 +1，否则重新计为 1
      const checkCompletion = () => {
        const total = state.items.length;
        if (!total) return;
        const doneCount = state.items.filter((it) => state.done.includes(it.id)).length;
        if (doneCount === total && state.lastCompleteDate !== todayStr()) {
          const yest = yesterdayStr(todayStr());
          state.streak = state.lastCompleteDate === yest ? state.streak + 1 : 1;
          state.lastCompleteDate = todayStr();
        }
      };

      listEl.addEventListener('change', (e) => {
        const cb = e.target.closest('input[type="checkbox"]');
        if (!cb) return;
        const row = cb.closest('.ckl-item');
        if (!row) return;
        const id = row.getAttribute('data-id');
        if (cb.checked) {
          if (!state.done.includes(id)) state.done.push(id);
        } else {
          state.done = state.done.filter((d) => d !== id);
        }
        checkCompletion();
        persistAndRender();
      });

      listEl.addEventListener('click', (e) => {
        const del = e.target.closest('.ckl-del');
        if (!del) return;
        e.preventDefault();
        const row = del.closest('.ckl-item');
        if (!row) return;
        const id = row.getAttribute('data-id');
        state.items = state.items.filter((it) => it.id !== id);
        state.done = state.done.filter((d) => d !== id);
        clearHint();
        persistAndRender();
      });

      const addItem = () => {
        const text = inputEl.value.trim();
        if (!text) return;
        if (state.items.length >= MAX_CUSTOM_COUNT + DEFAULT_ITEMS.length) {
          showHint(`清单最多 ${MAX_CUSTOM_COUNT + DEFAULT_ITEMS.length} 项`);
          return;
        }
        clearHint();
        state.items.push({ id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`, text, custom: true });
        inputEl.value = '';
        persistAndRender();
      };

      addBtn.addEventListener('click', addItem);
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addItem();
        }
      });

      // 跨天驻留页面时每分钟检查日期变更，自动重置勾选
      const dayTimer = setInterval(() => {
        if (!alive) return;
        const now = todayStr();
        if (state.date !== now) {
          state.date = now;
          state.done = [];
          persistAndRender();
        }
      }, 60000);

      render();

      return () => {
        alive = false;
        clearInterval(dayTimer);
      };
    },
  };
})();
