/* 本地备忘录：原话保存，不解析学习状态，不自动规划。 */
(function () {
  'use strict';
  const App = window.App = window.App || {};
  const S = () => App.store;
  const $ = id => document.getElementById(id);
  let selected = null, saving = false, pending = Promise.resolve(true), inputVersion = 0;
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = value => {
    const p = dateFormat.formatToParts(new Date(value));
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
    list=App.memoActions?.visibleBlocks(list)||list;
    const all = S().data().memoEvents;
    const events = new Map((Array.isArray(all) ? all : []).filter(e => e).map(e => [e.id, e]));
    const sources = { queue: '任务队列', task: '当天任务', daily: '基础任务', project: '每日推进', checkin: '积分打卡' };
    return list.map(b => {
      const event = b.eventId && events.get(b.eventId);
      if (!event || !sources[event.kind]) return b.text;
      const label = !event.active ? event.title+' · 已撤销完成' : event.kind === 'checkin' ? '打卡生成' : '任务生成';
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
  let pendingLegacyBlocks = null;
  function persist() {
    if (!$('memo-editor')) return Promise.resolve(true);
    const epoch = ++inputVersion;
    try {
      if(pendingLegacyBlocks){
        App.memoActions?.archiveLegacyBlocks(pendingLegacyBlocks);
        pendingLegacyBlocks=null;
      }
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
      const blocks=segments(n);
      const visible=App.memoActions?.visibleBlocks(blocks)||blocks;
      pendingLegacyBlocks=visible.length!==blocks.length||visible.some((block,index)=>block!==blocks[index])?blocks:null;
      App.memoEditor.show(visible, S().status().readOnly);
      $('memo-heading').textContent = key === userDay() ? '今天的笔记' : key + ' 的笔记';
      $('memo-day-hint').textContent = '北京时间 · ' + key + ' 04:00 至 ' + shiftDay(key, 1) + ' 03:59';
      $('memo-editor').dataset.day = key;
      statusText(); copyStatus();
    } catch (e) { $('memo-editor').contentEditable = 'false'; state(e.message, true); }
  }
  async function openDay(key) {
    if (!await flush()) { state('当前内容尚未安全保存，请先复制全文，暂不切换日期', true); $('memo-date').value = selected; return false; }
    show(key); return true;
  }
  function insertTime() {
    if (S().status().readOnly) return;
    if (App.memoEditor.busy()) return App.ui.toast('请先完成正在输入的文字');
    const now = Date.now(), date = naturalDay(now);
    const stamp = date === selected ? clock(now) : (date === shiftDay(selected, 1) && userDay(now) === selected ? '次日' + clock(now) : date + ' ' + clock(now));
    const a = App.memoEditor.text().length;
    App.memoEditor.select(a);
    App.memoEditor.insert((a > 0 && App.memoEditor.text()[a - 1] !== '\n' ? '\n' : '') + stamp.replace(':', '') + ' ');
    App.memoEditor.revealEnd();
  }
  function writeClipboard(text) {
    const clipboard = navigator.clipboard;
    if (typeof text !== 'string' && clipboard?.write && typeof ClipboardItem === 'function') {
      // Start the clipboard request inside the click, before save and report generation.
      const payload = text.then(value => new Blob([value], { type: 'text/plain' }));
      payload.catch(() => {});
      try { return clipboard.write([new ClipboardItem({ 'text/plain': payload })]); }
      catch { /* Some browsers only support writeText. */ }
    }
    if (!clipboard?.writeText) return Promise.reject(new Error('剪贴板不可用'));
    return typeof text === 'string' ? clipboard.writeText(text) : text.then(value => clipboard.writeText(value));
  }
  async function copyText(text, onCopied) {
    let request;
    try { request = Promise.resolve(writeClipboard(text)).then(() => true, () => false); }
    catch { request = Promise.resolve(false); }
    const value = await text;
    let timer;
    const copied = await Promise.race([request, new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); })]);
    clearTimeout(timer);
    let confirmed = false;
    const confirmCopy = async () => {
      if (confirmed) return;
      confirmed = true;
      App.ui.toast('已复制，可直接粘贴');
      if (onCopied) await onCopied();
    };
    if (copied) { await confirmCopy(); return true; }

    const modal = App.ui.openModal('复制文字', '<p class="hint">自动复制未完成。可以重新复制、长按文字手动复制，或下载全文。</p><textarea id="memo-copy-fallback" aria-label="待复制全文" readonly></textarea>', '<button class="btn btn-primary" data-act="retry">重新复制</button><button class="btn" data-act="download">下载全文</button>' + (onCopied ? '<button class="btn" data-act="copied">我已手动复制</button>' : '') + '<button class="btn" data-act="close">关闭</button>');
    const field = modal.querySelector('#memo-copy-fallback');
    field.value = value;
    App.ui.bindActions({
      close: App.ui.closeModal,
      download: () => download('备忘录.txt', value),
      copied: async b => { b.disabled = true; App.ui.closeModal(); await confirmCopy(); },
      retry: async b => {
        b.disabled = true;
        let timer;
        try {
          await Promise.race([writeClipboard(value), new Promise((_, reject) => { timer = setTimeout(reject, 2500); })]);
          if (modal.isConnected) App.ui.closeModal();
          await confirmCopy();
        } catch {
          if (modal.isConnected) { field.focus(); field.select(); App.ui.toast('复制未成功，请手动复制或下载'); }
        } finally { clearTimeout(timer); b.disabled = false; }
      }
    });
    return false;
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
    const selection = App.memoEditor.selection();
    if (selection && selection.start !== selection.end) return copyText(App.memoEditor.text().slice(selection.start, selection.end));
    return App.ui.toast('请先选中要复制的文字');
  }
  const copyPrompt='请逐项回应我提出的问题、疑虑和请求。先给结论，再说明每项的理由。涉及行动时给出具体下一步。信息不足时，请指出缺哪条信息。';
  function withCopyPrompt(text){return text.startsWith(copyPrompt+'\n\n')?text:copyPrompt+'\n\n'+text;}
  let copying = false;
  function copyStatus() {
    const el = $('memo-copy-status'); if (!el) return;
    const last = S().data().memoFlow?.lastCopy; el.textContent = last ? '上次完整复制：' + naturalDay(last.at) + ' ' + clock(last.at) + ' · 复制不代表已发送' : '完整复制会补带遗漏内容；选区复制不更新记录';
  }
  async function markCopied(quote) {
    try { if (await App.memoActions.commit(() => App.memoFlow.markCopyCore(quote))) copyStatus(); }
    catch(e) { const el=$('memo-copy-status'); el.textContent='文字已复制，但复制记录尚未保存；点此重试'; el.onclick=async()=>{try{if(await App.memoActions.commit(()=>{})){el.onclick=null;copyStatus();}}catch(err){App.ui.toast(err.message);}}; App.ui.toast(e.message); }
  }
  async function copyFull() {
    if(copying)return;
    copying=true;
    try {
      const day=selected, fallback=currentText();
      let quote, notice;
      state('正在准备复制…');
      const text = (async () => {
        if (App.memoActions?.busy() || !await flush()) {
          notice='已提供笔记正文，任务汇总因保存未完成暂未生成';
          return fallback;
        }
        try {
          if (!S().data().memoFlow) return read(day) ? exportText([day]) : fallback;
          quote=App.memoFlow.copyQuote(day);
          return quote.text;
        } catch (e) {
          console.warn('完整复制汇总生成失败', e);
          notice='任务汇总生成失败，已提供笔记正文';
          return fallback;
        }
      })();
      const copied=await copyText(text.then(withCopyPrompt),()=>quote&&markCopied({...quote,text:withCopyPrompt(quote.text)}));
      if(notice)App.ui.toast(notice);
      return copied;
    } catch(e){App.ui.toast(e.message);} finally{copying=false;statusText();}
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
      const keys = [...new Set(entries('',from,to).concat(App.memoReport?Object.keys(S().data().days).filter(k=>validDate(k)&&k>=from&&k<=to&&App.memoReport.report(k).any):[]))].sort();
      if (!keys.length) { App.ui.toast('这个日期范围内还没有笔记'); return; }
      const text = (App.memoReport?keys.map(k=>App.memoReport.report(k).text).join('\n\n')+'\n\n':'')+exportText(keys);
      App.ui.openModal('导出笔记 · ' + keys.length + ' 天', '<p class="hint">先检查内容，可在下方删去不想发送的部分；不会改变原笔记。</p><textarea id="memo-export-preview" aria-label="导出预览"></textarea>', '<button class="btn btn-primary" data-act="copy">复制文字</button><button class="btn" data-act="download">下载文本</button><button class="btn" data-act="close">关闭</button>');
      $('memo-export-preview').value = text;
      App.ui.bindActions({ copy: () => copyText($('memo-export-preview').value), download: () => download('备忘录-' + from + '-' + to + '.txt', $('memo-export-preview').value), close: App.ui.closeModal });
    } catch (e) { App.ui.toast(e.message); }
  }
  function initCopyMenu(){
    const menu=$('memo-copy-menu'),panel=menu.querySelector('.memo-copy-options');
    const host=document.createElement('div');host.className='legacy-host';
    const layer=document.createElement('div');layer.className='memo-popup-layer';layer.hidden=true;
    layer.append(panel);host.append(layer);document.body.append(host);
    const close=(focus=false)=>{menu.open=false;layer.hidden=true;if(focus)menu.querySelector('summary').focus({preventScroll:true});};
    function place(){
      if(!menu.open)return;
      const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
      panel.style.width=Math.min(280,width-16)+'px';panel.style.maxHeight=Math.max(44,height-16)+'px';
      const anchor=menu.getBoundingClientRect(),box=panel.getBoundingClientRect();
      const x=Math.max(left+8,Math.min(anchor.right-box.width,left+width-box.width-8));
      const below=anchor.bottom+6,y=below+box.height<=top+height-8?below:anchor.top-box.height-6;
      panel.style.left=x+'px';panel.style.top=Math.max(top+8,Math.min(y,top+height-box.height-8))+'px';
    }
    menu.addEventListener('toggle',()=>{layer.hidden=!menu.open;if(menu.open)place();});
    panel.addEventListener('click',e=>{if(e.target.closest('button'))close();});
    document.addEventListener('pointerdown',e=>{if(menu.open&&!menu.contains(e.target)&&!panel.contains(e.target))close();});
    document.addEventListener('keydown',e=>{if(menu.open&&e.key==='Escape'){e.preventDefault();close(true);}});
    window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,{passive:true});
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
    let savedSelection;
    $('memo-copy-menu').addEventListener('pointerdown',()=>{ const p=App.memoEditor.selection(); if(p && p.start!==p.end)savedSelection=p; });
    $('memo-copy').onclick = () => { const p=savedSelection || App.memoEditor.selection(); savedSelection=null; return p && p.start!==p.end ? copyText(App.memoEditor.text().slice(p.start,p.end)) : App.ui.toast('请先选中文字'); };
    $('memo-copy-export').onclick=()=>App.app.switchView('memo-history');
    const paper=$('memo-editor').parentElement; paper.querySelectorAll('.memo-help').forEach(el=>paper.before(el));
    $('memo-copy-full').onclick = copyFull;
    $('memo-copy-again').onclick = () => { const last=S().data().memoFlow?.lastCopy; last ? copyText(withCopyPrompt(last.text)) : App.ui.toast('还没有完整复制记录'); };
    initCopyMenu();
    copyStatus();
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

