/* A completion, its exact ledger entries and its note passage form one saved operation. */
(function () {
  'use strict';
  const App = window.App = window.App || {};
  const S = () => App.store, M = () => App.memoCore, E = x => S().esc(x);
  const copy = x => JSON.parse(JSON.stringify(x));
  let committing = false, unsettled = false, showingDone = false;
  const events = d => {
    if (d.memoEvents === undefined) d.memoEvents = [];
    if (!Array.isArray(d.memoEvents)) throw new Error('勾选记录格式异常，请先下载完整备份');
    return d.memoEvents;
  };
  function latest(kind, id, day) { return events(S().data()).slice().reverse().find(e => e.active && e.kind === kind && e.sourceId === id && (!day || e.sourceDay === day)); }
  function noteBlocks(day) { return M().segments(M().read(day)); }
  function append(event, text) {
    if (!text.trim()) return;
    const list = noteBlocks(event.noteDay), all = list.map(x => x.text).join('');
    const prefix = all && !all.endsWith('\n') ? '\n' : '';
    const block = { id: S().uid(), text: prefix + text + '\n' };
    if (event.kind !== 'cancellation') { block.eventId = event.id; block.label = event.kind === 'checkin' ? '打卡生成' : '任务生成'; }
    list.push(block);
    M().write(event.noteDay, list.map(x => x.text).join(''), event.at, list);
  }
  function passage(event) { return noteBlocks(event.noteDay).filter(x => x.eventId === event.id).map(x => x.text).join(''); }
  function ledger(event, type, points, note, day = event.sourceDay) {
    if (!(points > 0)) return;
    const entry = { id: S().uid(), date: day, type, points, leisure: 0, taskId: event.sourceId, memoEventId: event.id, note, at: event.at };
    S().data().ledger.push(entry); event.ledgerIds.push(entry.id); event.points += points;
  }
  function taskLists(day) {
    return ['required', 'ideal', 'extra'].map(k => (day.tasks[k] || []).filter(t => !t.fromQueue && !t.fromDaily));
  }
  function eligible(day, kind) {
    const lists = taskLists(day), done = a => a.length > 0 && a.every(t => t.done);
    return kind === 'base' ? done(lists[0]) : lists.every(done);
  }
  function rewardChoices(spec) {
    if (spec.kind !== 'task') return [];
    const day = S().getDay(spec.day), draft = copy(day), t = draft.tasks[spec.list].find(x => x.id === spec.id);
    if (!t) return [];
    t.done = true;
    return ['base', 'perfect'].filter(kind => eligible(draft, kind) && !(day.rewards || []).some(r => r.kind === kind));
  }
  function grantRewards(event, choices) {
    if (event.kind !== 'task') return;
    const day = S().getDay(event.sourceDay); day.rewards = day.rewards || [];
    choices.forEach(choice => {
      if (!eligible(day, choice.kind) || day.rewards.some(r => r.kind === choice.kind)) return;
      const id = S().uid(), points = Math.max(0, Number(choice.points) || 0);
      if (!points) return;
      const dependencies = taskLists(day).slice(0, choice.kind === 'base' ? 1 : 3).flat().map(t => t.id);
      S().data().ledger.push({ id, date: event.sourceDay, type: 'reward-' + choice.kind, points, leisure: 0, taskId: event.sourceId, memoReward: true, at: event.at, note: choice.kind === 'base' ? '保底奖励' : '全部任务完成奖励' });
      day.rewards.push({ kind: choice.kind, points, at: event.at, memoLedgerId: id, dependencies });
    });
  }
  function withdrawRewards(dayKey) {
    const day = S().data().days[dayKey]; if (!day) return;
    const lost = (day.rewards || []).filter(r => r.memoLedgerId && !eligible(day, r.kind));
    const ids = lost.map(r => r.memoLedgerId);
    S().data().ledger = S().data().ledger.filter(l => !ids.includes(l.id));
    day.rewards = (day.rewards || []).filter(r => !ids.includes(r.memoLedgerId));
  }
  function completeCore(spec, text, at = new Date().toISOString(), choices = []) {
    if (S().status().readOnly) throw new Error('记录保护中，暂不能勾选');
    const d = S().data(), event = { id: S().uid(), kind: spec.kind, sourceId: spec.id, sourceDay: spec.day || M().userDay(at), sourceList: spec.list || '', noteDay: M().userDay(at), at, active: true, ledgerIds: [], points: 0, title: spec.title };
    events(d); // Validate before making any changes.
    noteBlocks(event.noteDay);
    if (spec.kind === 'queue') {
      const idx = d.queue.findIndex(x => x.id === spec.id); if (idx < 0) throw new Error('这条任务已经移动或完成，请重新打开');
      const it = d.queue[idx]; event.queuePosition = idx; event.beforeId = d.queue[idx - 1]?.id || ''; event.afterId = d.queue[idx + 1]?.id || '';
      d.queue.splice(idx, 1); it.doneDay = event.sourceDay; it.doneAt = at; it.memoCompletionId = event.id;
      (d.queueDone = d.queueDone || []).unshift(it);
      // Retire old materialized copies. The queue item itself remains the source of its configuration.
      Object.values(d.days).forEach(day => Object.values(day.tasks || {}).forEach(list => { for (let i = list.length - 1; i >= 0; i--) if (list[i].fromQueue === it.id && !list[i].done) list.splice(i, 1); }));
      ledger(event, 'earn-queue', it.points == null ? (S().settings().queuePoints ?? 5) : it.points, '队列完成：' + it.text);
    } else if (spec.kind === 'task') {
      const task = S().getDay(event.sourceDay).tasks[spec.list].find(t => t.id === spec.id);
      if (!task || task.done) throw new Error('任务状态已改变，请重新打开');
      task.done = true; task.memoCompletionId = event.id; task.summary = { done: true, text, at };
      const settings = S().settings();
      const pts = task.points == null ? (spec.list === 'ideal' ? (settings.idealPoints ?? 10) : spec.list === 'extra' ? (settings.extPoints ?? 5) : 0) : task.points;
      // Required tasks keep the original group-reward rule rather than earning per-task points.
      if (spec.list === 'ideal' || spec.list === 'extra') ledger(event, 'earn-' + spec.list, pts, '任务完成：' + task.text);
    } else if (spec.kind === 'checkin' || spec.kind === 'daily') {
      const it = (spec.kind === 'checkin' ? d.checkins : d.daily).find(x => x.id === spec.id);
      if (!it) throw new Error('这条记录已不存在');
      it.days = it.days || {}; const n = Number(it.days[event.sourceDay]) || 0;
      const target = spec.kind === 'daily' ? 1 : Math.max(1, Number(it.target) || 1);
      if (n >= target) throw new Error('这一天已经勾选完成');
      const amount = spec.kind === 'checkin' ? App.checkin.memoPoints(it, event.sourceDay) : Math.max(0, Number(it.points ?? S().settings().dailyPoints ?? 2));
      it.days[event.sourceDay] = spec.kind === 'daily' ? Date.parse(at) : n + 1;
      ledger(event, spec.kind === 'checkin' ? 'earn-checkin' : 'earn-daily', amount, (spec.kind === 'checkin' ? '打卡：' : '今日基础任务：') + it.text);
    } else throw new Error('无法识别勾选来源');
    events(d).push(event); append(event, text); grantRewards(event, choices); return event;
  }
  function undoCore(id, reason = '', at = new Date().toISOString()) {
    if (S().status().readOnly) throw new Error('记录保护中，暂不能取消');
    const d = S().data(), event = events(d).find(e => e.id === id && e.active);
    if (!event) throw new Error('这次勾选已经取消，请重新打开');
    const blocks = noteBlocks(event.noteDay); // Refuse malformed note data before changing points or state.
    if (event.kind === 'queue') {
      const idx = (d.queueDone || []).findIndex(it => it.memoCompletionId === id);
      if (idx < 0) throw new Error('已完成任务已移动，请先检查任务记录');
      const it = d.queueDone.splice(idx, 1)[0]; delete it.doneDay; delete it.doneAt; delete it.memoCompletionId;
      let pos = d.queue.findIndex(x => x.id === event.afterId);
      if (pos < 0) { const prev = d.queue.findIndex(x => x.id === event.beforeId); pos = prev >= 0 ? prev + 1 : Math.min(event.queuePosition || 0, d.queue.length); }
      d.queue.splice(pos, 0, it);
    } else if (event.kind === 'task') {
      const task = d.days[event.sourceDay]?.tasks[event.sourceList]?.find(t => t.id === event.sourceId);
      if (!task) throw new Error('原任务已移动，暂不能自动取消');
      if (task.memoCompletionId !== event.id) throw new Error('任务已有其他完成记录，暂不能取消这一笔');
      task.done = false; delete task.memoCompletionId; if (task.summary) task.summary.done = false;
    } else {
      const it = (event.kind === 'checkin' ? d.checkins : d.daily).find(x => x.id === event.sourceId);
      if (!it || !it.days?.[event.sourceDay]) throw new Error('原打卡状态已改变，请重新打开');
      if (event.kind === 'daily' || it.days[event.sourceDay] <= 1) delete it.days[event.sourceDay];
      else it.days[event.sourceDay]--;
    }
    d.ledger = d.ledger.filter(l => !event.ledgerIds.includes(l.id));
    const kept = []; let removedLine = false;
    blocks.forEach(block => {
      if (block.eventId === id) { removedLine = removedLine || block.text.includes('\n'); return; }
      const previous = kept[kept.length - 1];
      if (removedLine && previous?.text && block.text && !previous.text.endsWith('\n') && !block.text.startsWith('\n')) kept.push({ id: S().uid(), text: '\n' });
      kept.push(block); if (block.text) removedLine = false;
    });
    M().write(event.noteDay, kept.map(b => b.text).join(''), at, kept);
    event.active = false; event.undoneAt = at; event.reason = reason;
    if (event.kind === 'task') withdrawRewards(event.sourceDay);
    if (reason.trim()) {
      const noteEvent = { id: S().uid(), kind: 'cancellation', noteDay: M().userDay(at), at };
      append(noteEvent, stamp(at, noteEvent.noteDay) + '【取消勾选】' + event.title + '：' + reason);
    }
    return event;
  }
  function stamp(at, day) { return (M().naturalDay(at) === day ? '' : '次日') + M().clock(at).replace(':', ''); }
  function refresh() {
    if (App.memo?.selected()) App.memo.show(App.memo.selected());
    App.memo?.history(); App.tasks?.renderAll(); App.queue?.render(); App.checkin?.render(); App.app?.refreshStats();
  }
  async function transaction(mutate) {
    if (committing) return false;
    committing = true;
    try {
      if (unsettled) {
        const ok = await S().save(); if (!ok) throw new Error('仍未保存，请下载完整备份后再试');
        unsettled = false; return true; // Retry persistence, never repeat the operation.
      }
      if (!await App.memo.flush()) throw new Error('笔记尚未安全保存，请先复制或下载');
      const d = S().data(), before = copy(d);
      try { mutate(); } catch (e) { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, before); throw e; }
      if (!await S().save()) { unsettled = true; throw new Error('此次操作尚未保存；文字仍在，请点“重试保存”，不要刷新'); }
      return true;
    } finally { committing = false; }
  }
  function complete(spec) {
    if (committing || unsettled) { App.ui.toast('请先完成当前操作或重试保存'); return; }
    const at = new Date().toISOString(), day = M().userDay(at), label = spec.kind === 'checkin' ? '积分打卡' : '任务勾选';
    const suffix = spec.day && spec.day !== day ? '（补记 ' + spec.day + '）' : '';
    const options = rewardChoices(spec), settings = S().settings();
    const m = App.ui.openModal('确认' + (spec.kind === 'checkin' ? '打卡' : '完成'),
      '<p class="hint">时间只表示本次勾选时刻。可补充、改写或清空；清空后仍完成并记积分。</p>' +
      '<label for="memo-action-text">写入笔记的文段</label><textarea id="memo-action-text" class="memo-action-text"></textarea>' +
      options.map(kind => '<div class="field"><label><input type="checkbox" data-reward="' + kind + '" checked> 同时领取' + (kind === 'base' ? '保底' : '全部完成') + '奖励</label><input type="number" min="0" data-reward-points="' + kind + '" value="' + Number(kind === 'base' ? settings.baseRewardPoints : settings.perfectRewardPoints) + '"></div>').join('') +
      '<p class="hint" id="memo-action-info"></p><p id="memo-action-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="commit">确认完成</button>', { lock: true });
    m.querySelector('#memo-action-text').value = stamp(at, day) + '【' + label + '】' + spec.title + suffix;
    let previewPoints = 0;
    if (spec.kind === 'queue') { const it = S().data().queue.find(x => x.id === spec.id); previewPoints = Number(it?.points ?? settings.queuePoints ?? 5); }
    if (spec.kind === 'checkin') { const it = S().data().checkins.find(x => x.id === spec.id); previewPoints = App.checkin.memoPoints(it, spec.day); }
    if (spec.kind === 'daily') { const it = S().data().daily.find(x => x.id === spec.id); previewPoints = Number(it?.points ?? settings.dailyPoints ?? 2); }
    if (spec.kind === 'task') { const it = S().getDay(spec.day).tasks[spec.list].find(x => x.id === spec.id); previewPoints = ['ideal', 'extra'].includes(spec.list) ? Number(it.points ?? (spec.list === 'ideal' ? settings.idealPoints : settings.extPoints)) : 0; }
    m.querySelector('#memo-action-info').textContent = '本次任务积分 +' + Math.max(0, previewPoints || 0) + '；写入 ' + day + ' 的笔记（04:00分日）。';
    bindCommit(m, () => completeCore(spec, m.querySelector('#memo-action-text').value, at,
      [...m.querySelectorAll('[data-reward]:checked')].map(x => ({ kind: x.dataset.reward, points: m.querySelector('[data-reward-points="' + x.dataset.reward + '"]').value }))));
  }
  function cancelEvent(event) {
    if (committing || unsettled) return;
    const text = passage(event), points = S().data().ledger.filter(l => event.ledgerIds.includes(l.id)).reduce((n, l) => n + l.points, 0);
    const m = App.ui.openModal('取消' + (event.kind === 'checkin' ? '这次打卡' : '完成'),
      '<p>将撤回本次积分 ' + points + '，删除以下生成文段及段内补充。其他笔记保留。</p>' +
      '<pre class="memo-delete-preview">' + E(text || '没有关联文段，或文段已被你删除。') + '</pre>' +
      '<label for="memo-action-text">取消原因（选填）</label><textarea id="memo-action-text" class="memo-action-text" placeholder="留空确认，不新增取消文字"></textarea><p id="memo-action-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">保留完成</button><button class="btn btn-danger" data-act="commit">确认取消</button>', { lock: true });
    bindCommit(m, () => undoCore(event.id, m.querySelector('#memo-action-text').value));
  }
  function bindCommit(m, mutate) {
    App.ui.bindActions({ cancel: () => { if (!committing && !unsettled) App.ui.closeModal(); }, commit: async button => {
      if (committing) return;
      button.disabled = true; m.querySelector('[data-act="cancel"]').disabled = true;
      try {
        if (await transaction(mutate)) { App.ui.closeModal(); refresh(); App.ui.toast('已保存'); }
      } catch (e) { m.querySelector('#memo-action-error').textContent = e.message; button.textContent = unsettled ? '重试保存' : '重新确认'; }
      finally { button.disabled = false; m.querySelector('[data-act="cancel"]').disabled = unsettled; }
    } });
  }
  function legacyCancel(spec) {
    const d = S().data();
    const type = spec.kind === 'checkin' ? 'earn-checkin' : spec.kind === 'daily' ? 'earn-daily' : spec.list === 'ideal' ? 'earn-ideal' : spec.list === 'extra' ? 'earn-extra' : null;
    const entry = d.ledger.slice().reverse().find(l => type && l.type === type && l.taskId === spec.id && l.date === spec.day && !l.memoEventId);
    const m = App.ui.openModal('取消旧记录', '<p>这条记录没有关联笔记，取消后保留原有文字。' + (entry ? '撤回原次积分 ' + entry.points + '。' : '没有可确认关联的积分，账目保留。') + '</p><label>取消原因（选填）</label><textarea id="memo-action-text" class="memo-action-text"></textarea><p id="memo-action-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">保留完成</button><button class="btn btn-danger" data-act="commit">确认取消</button>', { lock: true });
    bindCommit(m, () => {
      if (entry) d.ledger = d.ledger.filter(l => l.id !== entry.id);
      if (spec.kind === 'task') { const task = d.days[spec.day].tasks[spec.list].find(t => t.id === spec.id); task.done = false; if (task.summary) task.summary.done = false; }
      else if (spec.kind === 'queue') { const i = d.queueDone.findIndex(t => t.id === spec.id); if (i < 0) throw new Error('任务已移动'); const it = d.queueDone.splice(i, 1)[0]; delete it.doneDay; delete it.doneAt; d.queue.unshift(it); }
      else { const it = (spec.kind === 'checkin' ? d.checkins : d.daily).find(t => t.id === spec.id); if (spec.kind === 'daily' || it.days[spec.day] <= 1) delete it.days[spec.day]; else it.days[spec.day]--; }
      const reason = m.querySelector('#memo-action-text').value;
      if (reason.trim()) { const at = new Date().toISOString(); append({ id: S().uid(), kind: 'cancellation', noteDay: M().userDay(at), at }, stamp(at, M().userDay(at)) + '【取消勾选】' + spec.title + '：' + reason); }
    });
  }
  function task(list, id) {
    const day = S().todayKey(), t = S().getDay(day).tasks[list].find(x => x.id === id); if (!t) return;
    if ([App.tasks?.getTimer?.(), App.tasks?.getCdTimer?.()].some(timer => timer?.taskId === id)) { App.ui.toast('原有计时尚未结束，请先结束后再勾选'); return; }
    if (t.fromQueue) return queue(t.fromQueue);
    if (t.fromDaily) return daily(t.fromDaily);
    const spec = { kind: 'task', id, day, list, title: t.text };
    if (!t.done) complete(spec); else { const e = latest('task', id, day); e ? cancelEvent(e) : legacyCancel(spec); }
  }
  function queue(id) {
    const it = S().data().queue.find(x => x.id === id);
    if (it) return complete({ kind: 'queue', id, title: it.text, day: M().userDay() });
    const done = (S().data().queueDone || []).find(x => x.id === id); if (!done) return;
    const e = latest('queue', id); e ? cancelEvent(e) : legacyCancel({ kind: 'queue', id, title: done.text, day: done.doneDay });
  }
  function checkin(id, day = M().userDay(), cancel = false) {
    const it = (S().data().checkins || []).find(x => x.id === id); if (!it) return;
    const spec = { kind: 'checkin', id, day, title: it.text };
    if (cancel) { const e = latest('checkin', id, day); e ? cancelEvent(e) : legacyCancel(spec); }
    else complete(spec);
  }
  function daily(id) {
    const it = (S().data().daily || []).find(x => x.id === id); if (!it) return;
    const day = M().userDay(), spec = { kind: 'daily', id, day, title: it.text };
    if (it.days?.[day]) { const e = latest('daily', id, day); e ? cancelEvent(e) : legacyCancel(spec); } else complete(spec);
  }
  function checkinHistory(id) {
    const list = events(S().data()).filter(e => e.kind === 'checkin' && e.sourceId === id && e.active).slice(-50).reverse();
    const m = App.ui.openModal('打卡记录', '<p class="hint">可取消本版生成的某一次打卡，包括补卡。</p>' + (list.length ? list.map(e => '<div class="memo-queue-row"><p>' + E(e.sourceDay + ' · ' + e.title) + '</p><small>勾选于 ' + E(M().naturalDay(e.at) + ' ' + M().clock(e.at)) + ' · 原次积分 +' + e.points + '</small><p class="memo-queue-note">' + E(passage(e).trim().slice(0, 120) || '未写入文段') + '</p><button class="btn btn-small" data-act="undo-event" data-event="' + E(e.id) + '">取消这次打卡</button></div>').join('') : '<p>暂无本版打卡记录。旧版当天打卡仍可用“撤销”处理。</p>'), '<button class="btn" data-act="close">关闭</button>');
    App.ui.bindActions({ close: App.ui.closeModal, 'undo-event': b => { const e = list.find(x => x.id === b.dataset.event); if (e) cancelEvent(e); } });
  }
  function recover(error) {
    App.ui.toast(error.message);
    if (!unsettled || document.getElementById('memo-operation-retry')) return;
    const box = document.createElement('div'); box.id = 'memo-operation-retry'; box.className = 'memo-task-hint';
    box.appendChild(document.createTextNode('上次操作尚未保存。'));
    const button = document.createElement('button'); button.className = 'btn btn-small'; button.textContent = '重试保存'; box.appendChild(button);
    button.onclick = async () => { button.disabled = true; try { if (await transaction(() => {})) { box.remove(); refresh(); } } catch (e) { App.ui.toast(e.message); } finally { button.disabled = false; } };
    document.querySelector('.release-panel').appendChild(box);
  }
  function editQueue(id) {
    const it = S().data().queue.find(x => x.id === id);
    const m = App.ui.openModal(it ? '修改队列任务' : '添加队列任务', '<label for="mq-title">任务</label><input id="mq-title" maxlength="500"><label for="mq-note">备注（选填）</label><textarea id="mq-note" class="memo-action-text"></textarea><label for="mq-points">完成积分</label><input id="mq-points" type="number" min="0"><p id="memo-action-error" role="alert"></p>', '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="commit">保存</button>', { lock: true });
    m.querySelector('#mq-title').value = it?.text || ''; m.querySelector('#mq-note').value = it?.note || ''; m.querySelector('#mq-points').value = it?.points ?? S().settings().queuePoints ?? 5;
    bindCommit(m, () => { const text = m.querySelector('#mq-title').value.trim(); if (!text) throw new Error('请填写任务名称'); const target = id ? S().data().queue.find(x => x.id === id) : { id: S().uid(), createdAt: new Date().toISOString() }; if (!target) throw new Error('任务已移动，请重新打开'); target.text = text; target.note = m.querySelector('#mq-note').value; target.points = Math.max(0, Number(m.querySelector('#mq-points').value) || 0); if (!id) S().data().queue.push(target); });
  }
  function renderQueue(dailyHTML = '') {
    const root = document.getElementById('queue-view'); if (!root) return;
    const d = S().data(), q = d.queue || [], done = d.queueDone || [];
    const button = (act, id, text) => '<button class="btn btn-small" data-act="mq-' + act + '" data-id="' + E(id) + '">' + text + '</button>';
    function row(it, i) { return '<div class="memo-queue-row"><div><strong>' + E(it.text) + '</strong>' + (it.note ? '<p class="memo-queue-note">' + E(it.note) + '</p>' : '') + '<small>完成 +' + Math.max(0, Number(it.points ?? S().settings().queuePoints ?? 5)) + ' 积分</small></div><div class="memo-queue-actions">' + button('done', it.id, '✓ 完成') + button('edit', it.id, '修改') + (i > 0 ? button('up', it.id, '上移') : '') + (i < q.length - 1 ? button('down', it.id, '下移') : '') + button('delete', it.id, '删除') + '</div></div>'; }
    root.innerHTML = '<div class="card"><div class="memo-queue-head"><h2>任务队列</h2>' + button('add', '', '＋ 添加任务') + '</div><p class="hint">按你排的顺序，完成一条后下一条顶上。也可提前完成后面的任务；没有每日数量要求。</p>' + (q.length ? '<h3>当前</h3>' + row(q[0], 0) + '<h3>接下来</h3>' + (q.length > 1 ? q.slice(1).map((it, i) => row(it, i + 1)).join('') : '<p class="hint">后面暂时没有任务。</p>') : '<p class="hint">队列空着。把准备做的事情加进来即可。</p>') + '<div class="memo-queue-head"><h3>已完成（' + done.length + '）</h3>' + button('show', '', showingDone ? '收起' : '展开') + '</div>' + (showingDone ? done.slice(0, 60).map(it => '<div class="memo-queue-row"><div><strong>' + E(it.text) + '</strong><small>' + E(it.doneDay || '') + '</small></div><div class="memo-queue-actions">' + button('undo', it.id, '取消完成') + button('again', it.id, '再做一次') + '</div></div>').join('') : '') + '</div>' + ((d.daily || []).length ? '<details class="card"><summary>今天的基础任务（原有）</summary>' + dailyHTML + '</details>' : '');
  }
  async function queueClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || !b.dataset.act.startsWith('mq-')) return false;
    const act = b.dataset.act.slice(3), id = b.dataset.id, q = S().data().queue;
    if (act === 'add' || act === 'edit') editQueue(id);
    else if (act === 'done' || act === 'undo') queue(id);
    else if (act === 'show') { showingDone = !showingDone; App.queue.render(); }
    else if (act === 'delete') App.ui.confirm('删除队列任务“' + E(q.find(x => x.id === id)?.text) + '”？', '删除', async () => { try { await transaction(() => { const i = q.findIndex(x => x.id === id); if (i >= 0) q.splice(i, 1); }); refresh(); } catch (error) { recover(error); } });
    else if (act === 'up' || act === 'down' || act === 'again') {
      try { await transaction(() => {
        if (act === 'again') { const old = S().data().queueDone.find(x => x.id === id); if (!old) return; const next = copy(old); next.id = S().uid(); delete next.doneDay; delete next.doneAt; delete next.memoCompletionId; (next.subs || []).forEach(s => { s.done = null; }); (next.groups || []).forEach(g => (g.subs || []).forEach(s => { s.done = null; })); q.push(next); }
        else { const i = q.findIndex(x => x.id === id), j = i + (act === 'up' ? -1 : 1); if (i >= 0 && j >= 0 && j < q.length) [q[i], q[j]] = [q[j], q[i]]; }
      }); refresh(); } catch (error) { recover(error); }
    }
    return true;
  }
  App.memoActions = { task, queue, checkin, daily, checkinHistory, renderQueue, queueClick, busy: () => committing || unsettled, completeCore, undoCore, latest, passage, commit: transaction };
})();
