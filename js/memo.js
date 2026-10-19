/* 本地备忘录：原话保存，不解析学习状态，不自动规划。 */
(function () {
  'use strict';
  const App = window.App = window.App || {};
  const S = () => App.store;
  const $ = id => document.getElementById(id);
  let selected = null, saving = false, pending = Promise.resolve(true), inputVersion = 0;
  const parts = value => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const d = {}; p.forEach(x => { d[x.type] = x.value; }); return d;
  };
  function naturalDay(value = Date.now()) { const p = parts(value); return p.year + '-' + p.month + '-' + p.day; }
  function userDay(value = Date.now()) { return naturalDay(new Date(value).getTime() - 4 * 3600000); }
  function clock(value = Date.now()) { const p = parts(value); return p.hour + ':' + p.minute; }
  function shiftDay(key, delta) { return new Date(Date.parse(key + 'T12:00:00Z') + delta * 86400000).toISOString().slice(0, 10); }
  function validDate(key) { return /^\d{4}-\d{2}-\d{2}$/.test(key || '') && Number.isFinite(Date.parse(key + 'T00:00:00Z')) && new Date(key + 'T00:00:00Z').toISOString().slice(0, 10) === key; }
  function notes() {
    const data = S().data();
    if (data.memoNotes === undefined) return {};
    if (!data.memoNotes || typeof data.memoNotes !== 'object' || Array.isArray(data.memoNotes)) throw new Error('笔记格式无法识别，请先导出完整备份');
    return data.memoNotes;
  }
  function read(key) {
    const n = notes()[key];
    if (n === undefined) return null;
    if (!n || typeof n.text !== 'string' || typeof n.id !== 'string') throw new Error('这天的笔记格式异常，请先导出完整备份');
    return n;
  }
  function segments(note) {
    if (!note) return [{ id: S().uid(), text: '' }];
    if (note.blocks === undefined) return [{ id: note.id + '-original', text: note.text }];
    if (note.blockVersion !== 1 || !Array.isArray(note.blocks) || note.blocks.some(b => !b || typeof b.id !== 'string' || typeof b.text !== 'string' || (b.eventId !== undefined && typeof b.eventId !== 'string')) || note.blocks.map(b => b.text).join('') !== note.text) throw new Error('笔记文段格式异常，请先下载完整备份');
    return note.blocks.map(b => Object.assign({}, b));
  }
  function write(key, text, at = new Date().toISOString(), blocks) {
    if (S().status().readOnly || !validDate(key)) throw new Error('记录处于保护状态，未覆盖笔记');
    const old = read(key);
    if (old && old.text === text && (blocks === undefined || JSON.stringify(old.blocks) === JSON.stringify(blocks))) return old;
    const next = Object.assign({}, old || {}, { id: old ? old.id : S().uid(), text, createdAt: old ? old.createdAt : at, updatedAt: at, revision: (old && Number(old.revision) || 0) + 1 });
    if (blocks !== undefined) { next.blocks = blocks; next.blockVersion = 1; }
    else if (next.blocks !== undefined) { next.blocks = [{ id: S().uid(), text }]; next.blockVersion = 1; }
    if (!S().data().memoNotes) S().data().memoNotes = {};
    S().data().memoNotes[key] = next;
    return next;
  }
  function entries(query = '', from = '', to = '') {
    const q = query.toLocaleLowerCase();
    return Object.keys(notes()).filter(validDate).sort().reverse().filter(key => {
      const n = read(key);
      return n.text.trim() && (!from || key >= from) && (!to || key <= to) && (!q || n.text.toLocaleLowerCase().includes(q));
    });
  }
  function exportBlocks(list) {
    const all = S().data().memoEvents;
    const events = new Map((Array.isArray(all) ? all : []).filter(e => e && e.active).map(e => [e.id, e]));
    const sources = { queue: '任务队列', task: '当天任务', daily: '基础任务', checkin: '积分打卡' };
    return list.map(b => {
      const event = b.eventId && events.get(b.eventId);
      if (!event || !sources[event.kind]) return b.text;
      const label = event.kind === 'checkin' ? '打卡生成' : '任务生成';
      // Keep every original character; wrappers are export-only and never saved into the memo.
      return '\n【' + label + '开始｜来源：' + sources[event.kind] + '】\n' + b.text +
        (b.text.endsWith('\n') ? '' : '\n') + '【' + label + '结束】\n';
    }).join('');
  }
  function exportText(keys) {
    const lines = ['个人备忘录', '时区：Asia/Shanghai；用户日：04:00—次日03:59。', '以下为原始笔记，可能包含事实、计划、感受和疑问；录入/修改时间不等于事件时间。', '复制或导出不代表已发送给教练或已归档。', ''];
    keys.slice().sort().forEach(key => {
      const n = read(key); if (!n) return;
      lines.push('===== 用户日 ' + key + ' =====', '笔记标识：' + n.id + '；修订：' + n.revision, '首次录入：' + n.createdAt + '；最后修改：' + n.updatedAt, '', exportBlocks(segments(n)), '');
    });
    return lines.join('\n');
  }
  function state(message, failed) {
    const el = $('memo-save'); if (!el) return;
    el.textContent = message; el.dataset.state = failed ? 'error' : 'saved';
  }
  function statusText() {
    const st = S().status();
    if (st.readOnly) return state('记录保护中，请复制全文', true);
    if (saving) return state('正在保存…');
    state(st.phase === 'saved' ? '已保存到手机' : st.message, st.phase === 'error');
  }
  // 每次输入立即交给主存储同步落本地、异步镜像；同一笔数据进入原有完整备份。
  function persist() {
    if (!$('memo-editor')) return Promise.resolve(true);
    const epoch = ++inputVersion;
    try {
      write(selected, App.memoEditor.text(), new Date().toISOString(), App.memoEditor.read());
      saving = true; state('正在保存…');
      pending = S().save().then(ok => {
        if (epoch === inputVersion) { saving = false; statusText(); }
        return ok;
      }).catch(() => { if (epoch === inputVersion) { saving = false; state('保存失败，请复制全文，暂勿关闭', true); } return false; });
    } catch (e) { saving = false; state(e.message, true); pending = Promise.resolve(false); }
    return pending;
  }
  async function flush() { const ok = await pending; return ok && await S().flush(); }
  function busy() { return App.memoEditor.busy() || (App.memoActions && App.memoActions.busy()) || saving || S().status().readOnly || S().status().phase === 'error'; }
  function show(key) {
    if (!validDate(key)) return;
    try {
      const n = read(key);
      const previousDay = selected; selected = key; $('memo-date').value = key;
      const editor = $('memo-editor');
      if (document.activeElement === editor && key === previousDay && App.memoEditor.text() === (n ? n.text : '')) return;
      App.memoEditor.show(segments(n), S().status().readOnly);
      requestAnimationFrame(() => { if (selected === key) editor.scrollTop = editor.scrollHeight; });
      $('memo-heading').textContent = key === userDay() ? '今天的笔记' : key + ' 的笔记';
      $('memo-day-hint').textContent = '北京时间 · ' + key + ' 04:00 至 ' + shiftDay(key, 1) + ' 03:59';
      $('memo-editor').dataset.day = key;
      statusText();
    } catch (e) { $('memo-editor').contentEditable = 'false'; state(e.message, true); }
  }
  async function openDay(key) {
    if (!await flush()) { state('当前内容尚未安全保存，请先复制全文，暂不切换日期', true); $('memo-date').value = selected; return false; }
    show(key); return true;
  }
  function insertTime() {
    const el = $('memo-editor'); if (S().status().readOnly) return;
    const now = Date.now(), date = naturalDay(now);
    const stamp = date === selected ? clock(now) : (date === shiftDay(selected, 1) && userDay(now) === selected ? '次日' + clock(now) : date + ' ' + clock(now));
    const pos = App.memoEditor.selection();
    const a = pos ? pos.start : App.memoEditor.text().length;
    App.memoEditor.insert((a > 0 && App.memoEditor.text()[a - 1] !== '\n' ? '\n' : '') + stamp.replace(':', '') + ' ');
  }
  async function copyText(text) {
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* 使用可见文本回退 */ }
    }
    if (!copied) {
      App.ui.openModal('复制文字', '<p class="hint">自动复制未完成，请长按下方文字全选复制。</p><textarea id="memo-copy-fallback" readonly></textarea>', '<button class="btn" data-act="close">关闭</button>');
      $('memo-copy-fallback').value = text; $('memo-copy-fallback').select();
      App.ui.bindActions({ close: App.ui.closeModal });
    } else App.ui.toast('已复制；请自行粘贴发送');
    return copied;
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }
  function currentText() {
    // 即使存储处于保护/错误状态，也能救出输入框里的文字。
    return '用户日：' + selected + '（北京时间04:00分界）\n\n' + exportBlocks(App.memoEditor.read());
  }
  async function copyCurrent() {
    const el = $('memo-editor');
    const selection = App.memoEditor.selection();
    if (selection && selection.start !== selection.end) return copyText(App.memoEditor.text().slice(selection.start, selection.end));
    if (!await flush()) return copyText(currentText());
    return copyText(read(selected) ? exportText([selected]) : currentText());
  }
  async function copyFull() {
    if (!await flush()) return copyText(currentText());
    return copyText(read(selected) ? exportText([selected]) : currentText());
  }
  function history() {
    const root = $('memo-history-results'); if (!root) return;
    root.replaceChildren();
    try {
      const all = entries($('memo-search').value);
      $('memo-history-count').textContent = all.length + ' 天笔记';
      if (!all.length) { root.textContent = '还没有符合条件的笔记。'; return; }
      all.forEach(key => {
        const n = read(key), b = document.createElement('button'); b.className = 'memo-history-item';
        const title = document.createElement('strong'); title.textContent = key;
        const preview = document.createElement('span'); preview.textContent = n.text.slice(0, 140);
        b.append(title, preview); b.onclick = async () => { if (await openDay(key)) App.app.switchView('memo'); }; root.appendChild(b);
      });
    } catch (e) { root.textContent = e.message; }
  }
  function exportRange() {
    const from = $('memo-from').value, to = $('memo-to').value;
    if (!validDate(from) || !validDate(to) || from > to) { App.ui.toast('请选择有效的起止日期'); return; }
    try {
      const keys = entries('', from, to);
      if (!keys.length) { App.ui.toast('这个日期范围内还没有笔记'); return; }
      const text = exportText(keys);
      App.ui.openModal('导出笔记 · ' + keys.length + ' 天', '<p class="hint">先检查内容，可在下方删去不想发送的部分；不会改变原笔记。</p><textarea id="memo-export-preview" aria-label="导出预览"></textarea>', '<button class="btn btn-primary" data-act="copy">复制文字</button><button class="btn" data-act="download">下载文本</button><button class="btn" data-act="close">关闭</button>');
      $('memo-export-preview').value = text;
      App.ui.bindActions({ copy: () => copyText($('memo-export-preview').value), download: () => download('备忘录-' + from + '-' + to + '.txt', $('memo-export-preview').value), close: App.ui.closeModal });
    } catch (e) { App.ui.toast(e.message); }
  }
  function init() {
    selected = userDay();
    App.memoEditor.init($('memo-editor'), persist);
    $('memo-editor').addEventListener('blur', flush);
    $('memo-time').onclick = insertTime;
    $('memo-today').onclick = () => openDay(userDay());
    $('memo-date').onchange = () => openDay($('memo-date').value);
    $('memo-prev').onclick = () => openDay(shiftDay(selected, -1));
    $('memo-next').onclick = () => openDay(shiftDay(selected, 1));
    $('memo-copy').onclick = copyCurrent;
    $('memo-copy-full').onclick = copyFull;
    $('memo-search').oninput = history;
    $('memo-from').value = shiftDay(userDay(), -6); $('memo-to').value = userDay();
    $('memo-export').onclick = exportRange;
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
    window.addEventListener('focus-storage', () => { statusText(); if (S().status().readOnly) $('memo-editor').contentEditable = 'false'; });
    show(selected);
  }
  App.memo = { init, show, history, flush, busy, copyCurrent, copyFull, selected: () => selected };
  App.memoCore = { naturalDay, userDay, clock, shiftDay, validDate, read, write, entries, exportText, segments, exportBlocks };
})();
