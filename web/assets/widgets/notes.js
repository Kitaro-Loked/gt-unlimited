/* Trading notes — localStorage persisted notepad with search / export.
 * Registers as custom tool id 'notes' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const LS_KEY = 'gt-notes-v1';
  const SAVE_DEBOUNCE_MS = 500;

  function injectStyle() {
    if (document.getElementById('nts-style')) return;
    const style = document.createElement('style');
    style.id = 'nts-style';
    style.textContent = `
.nts-root { display: flex; flex-direction: column; gap: 8px; height: 100%; }
.nts-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}
.nts-search {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 11px;
  padding: 5px 8px;
  outline: none;
  transition: border-color 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid);
}
.nts-search:focus { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-glow); }
.nts-body { display: flex; gap: 8px; min-height: 220px; flex: 1; }
.nts-list {
  width: 118px;
  flex-shrink: 0;
  overflow-y: auto;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.nts-item {
  padding: 6px 8px;
  cursor: pointer;
  border-bottom: 1px solid var(--hairline);
  transition: background 0.25s var(--ease-snap);
}
.nts-item:last-child { border-bottom: none; }
.nts-item:hover { background: var(--surface-raised); }
.nts-item.active { background: var(--surface-raised); border-left: 2px solid var(--acc); padding-left: 6px; }
.nts-item-title {
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nts-item-date { font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); }
.nts-empty { padding: 10px 8px; font-size: 10px; color: var(--text-dim); }
.nts-editor { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.nts-textarea {
  flex: 1;
  min-height: 160px;
  resize: none;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 11px;
  line-height: 1.6;
  padding: 8px;
  outline: none;
  font-family: var(--font-mono);
  box-sizing: border-box;
  transition: border-color 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid);
}
.nts-textarea:focus { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-glow); }
.nts-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.nts-saved { color: var(--text-muted); }
`;
    document.head.appendChild(style);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function noteTitle(text) {
    const first = (text.split('\n').find((l) => l.trim()) || '').trim();
    return first ? first.slice(0, 12) : '（无标题）';
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}-${dd}`;
  }

  function fmtFullDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const TEMPLATE_TEXT = [
    '交易计划模板',
    '────────────',
    '品种：',
    '方向：',
    '入场：',
    '止损：',
    '目标：',
    '风险%：',
    '理由：',
    ''
  ].join('\n');

  function loadNotes() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return arr.filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string');
        }
      }
    } catch (e) { /* 损坏数据则重置 */ }
    return [{ id: uid(), text: TEMPLATE_TEXT, updated: Date.now() }];
  }

  function persist(notes) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(notes));
    } catch (e) { /* 存储满等异常忽略 */ }
  }

  window.GT_EXTRA_TOOLS['notes'] = {
    mount(el, setStatus) {
      injectStyle();
      setStatus('online');

      el.innerHTML = `
        <div class="tool nts-root">
          <div class="nts-head"><span>交易笔记 · NOTES</span><span data-count></span></div>
          <input class="nts-search" type="text" placeholder="搜索笔记…" data-search />
          <div class="nts-body">
            <div class="nts-list" data-list></div>
            <div class="nts-editor">
              <textarea class="nts-textarea" data-editor placeholder="在此记录交易计划与复盘…" spellcheck="false"></textarea>
              <div class="nts-foot">
                <span data-words>0 字</span>
                <span class="nts-saved" data-saved></span>
              </div>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="tool-btn" data-new>+ 新建</button>
            <button class="tool-btn danger" data-del>删除</button>
            <button class="tool-btn ghost" data-export style="margin-left:auto">导出全部</button>
          </div>
          <div class="tool-hint" data-hint style="display:none"></div>
        </div>`;

      const listEl = el.querySelector('[data-list]');
      const editorEl = el.querySelector('[data-editor]');
      const searchEl = el.querySelector('[data-search]');
      const wordsEl = el.querySelector('[data-words]');
      const savedEl = el.querySelector('[data-saved]');
      const countEl = el.querySelector('[data-count]');
      const hintEl = el.querySelector('[data-hint]');

      let notes = loadNotes();
      persist(notes);
      let activeId = notes[0].id;
      let saveTimer = null;
      let alive = true;

      const showHint = (msg) => {
        hintEl.textContent = msg;
        hintEl.style.display = '';
      };
      const clearHint = () => { hintEl.style.display = 'none'; };

      const getActive = () => notes.find((n) => n.id === activeId) || null;

      const renderWords = () => {
        const n = getActive();
        const len = n ? n.text.replace(/\s/g, '').length : 0;
        wordsEl.textContent = `${len} 字`;
      };

      const renderList = () => {
        const q = searchEl.value.trim().toLowerCase();
        const sorted = notes.slice().sort((a, b) => b.updated - a.updated);
        const filtered = q ? sorted.filter((n) => n.text.toLowerCase().includes(q)) : sorted;
        countEl.textContent = `${notes.length} 条`;
        if (!filtered.length) {
          listEl.innerHTML = `<div class="nts-empty">${q ? '无匹配笔记' : '暂无笔记'}</div>`;
          return;
        }
        listEl.innerHTML = filtered
          .map(
            (n) => `
            <div class="nts-item${n.id === activeId ? ' active' : ''}" data-id="${esc(n.id)}">
              <div class="nts-item-title">${esc(noteTitle(n.text))}</div>
              <div class="nts-item-date">${esc(fmtDate(n.updated))}</div>
            </div>`
          )
          .join('');
      };

      const renderEditor = () => {
        const n = getActive();
        editorEl.value = n ? n.text : '';
        editorEl.disabled = !n;
        renderWords();
      };

      const flushSave = () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        persist(notes);
        if (alive) savedEl.textContent = `已保存 ${fmtDate(Date.now())}`;
      };

      const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        savedEl.textContent = '编辑中…';
        saveTimer = setTimeout(() => {
          saveTimer = null;
          persist(notes);
          if (alive) savedEl.textContent = `已保存 ${fmtDate(Date.now())}`;
        }, SAVE_DEBOUNCE_MS);
      };

      const onEditorInput = () => {
        const n = getActive();
        if (!n) return;
        n.text = editorEl.value;
        n.updated = Date.now();
        renderWords();
        renderList();
        scheduleSave();
      };

      const onListClick = (e) => {
        const item = e.target.closest('.nts-item');
        if (!item) return;
        flushSave();
        activeId = item.getAttribute('data-id');
        renderList();
        renderEditor();
      };

      const onSearch = () => { renderList(); };

      const onNew = () => {
        flushSave();
        const n = { id: uid(), text: '', updated: Date.now() };
        notes.push(n);
        persist(notes);
        activeId = n.id;
        searchEl.value = '';
        renderList();
        renderEditor();
        editorEl.focus();
      };

      const onDelete = () => {
        const n = getActive();
        if (!n) return;
        if (!window.confirm(`确定删除笔记「${noteTitle(n.text)}」？此操作不可恢复。`)) return;
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        notes = notes.filter((x) => x.id !== n.id);
        persist(notes);
        activeId = notes.length ? notes.slice().sort((a, b) => b.updated - a.updated)[0].id : null;
        renderList();
        renderEditor();
        savedEl.textContent = '已删除';
      };

      const onExport = () => {
        flushSave();
        clearHint();
        if (!notes.length) {
          showHint('没有可导出的笔记。');
          return;
        }
        const sorted = notes.slice().sort((a, b) => b.updated - a.updated);
        const sep = '────────────────────────────';
        const content = sorted
          .map((n) => `${sep}\n日期：${fmtFullDate(n.updated)}\n${sep}\n${n.text}`)
          .join('\n\n');
        try {
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `gt-notes-${fmtFullDate(Date.now())}.txt`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) {
          showHint('导出失败：浏览器阻止了下载。');
        }
      };

      editorEl.addEventListener('input', onEditorInput);
      listEl.addEventListener('click', onListClick);
      searchEl.addEventListener('input', onSearch);
      el.querySelector('[data-new]').addEventListener('click', onNew);
      el.querySelector('[data-del]').addEventListener('click', onDelete);
      el.querySelector('[data-export]').addEventListener('click', onExport);

      renderList();
      renderEditor();

      return function cleanup() {
        alive = false;
        flushSave();
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
      };
    }
  };
})();
