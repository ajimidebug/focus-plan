/* Compact projections of existing sessions. No parallel timer or reward state. */
(function () {
'use strict';
const A = window.App;
let selected = null, collapsed = true;
try { collapsed = localStorage.getItem('focusPlanFloatExpanded') !== '1'; } catch {}
const clock = ms => { const s = Math.floor(Math.max(0, ms) / 1000); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function ensure(root) {
 if (root.querySelector('[data-float-toggle]')) return;
 const toggle = document.createElement('button');
 toggle.type = 'button'; toggle.className = 'btn float-toggle'; toggle.dataset.floatToggle = '';
 toggle.innerHTML = '<span class="float-name"></span><span class="float-arrow" aria-hidden="true"></span>';
 root.prepend(toggle);
 const summary = document.createElement('div'); summary.className = 'float-summary';
 summary.innerHTML = '<span class="float-current"></span><span class="float-clock"></span><span class="float-total"></span>';
 root.append(summary);
 const meter = document.createElement('div'); meter.id = 'float-meter'; meter.className = 'float-meter';
 meter.innerHTML = '<span class="float-meter-text"></span><div class="float-meter-track"><span class="float-meter-fill"></span></div>';
 root.append(meter);
 const view = document.createElement('button'); view.type = 'button'; view.className = 'btn float-complete'; view.dataset.floatOpen = '';
 root.append(view);
}
function update(session, paused = []) {
 selected = session;
 const root = document.getElementById('mw-live'); if (!root) return;
 ensure(root);
 const memoFocused = document.activeElement?.id === 'memo-editor', folded = collapsed || memoFocused;
 root.classList.toggle('float-empty', !session);
 root.classList.toggle('float-collapsed', folded);
 root.classList.toggle('float-editor-focus', memoFocused);
 root.dataset.status = session?.status || '';
 const toggle = root.querySelector('[data-float-toggle]');
 toggle.setAttribute('aria-expanded', String(!folded));
 toggle.querySelector('.float-arrow').textContent = folded ? '⌄' : '⌃';
 if (!session) return;
 const found = A.memoSchedule.resolve(session.ref), task = found?.task, ref = found?.ref || session.ref;
 const title = task?.text || session.title, totals = A.memoSchedule.timing(session.ref);
 const nowDay = A.memoCore.userDay(), daily = ['checkin', 'daily', 'project'].includes(ref.kind);
 const control = root.querySelector('#mw-live-controls [data-schedule-command]');
 if (control) control.setAttribute('aria-label', (session.status === 'running' ? '暂停：' : '继续：') + title);
 toggle.querySelector('.float-name').textContent = (session.status === 'running' ? '' : '已暂停 · ') + title;
 root.querySelector('.float-current').textContent = '本次 ' + clock(A.memoSchedule.elapsed(session));
 root.querySelector('.float-clock').textContent = '今日 ' + clock(totals.todayMs);
 root.querySelector('.float-total').textContent = '累计 ' + clock(totals.allMs);
 const end = root.querySelector('[data-schedule-command="end"]'); if (end && !end.disabled) end.textContent = '结束计时';
 const expected = Number(task?.memoEstimatedDays?.[daily ? nowDay : ref.day] ?? task?.estimatedMinutes);
 const valid = Number.isFinite(expected) && expected > 0, currentMs = A.memoSchedule.elapsed(session);
 const ms = valid ? (daily ? totals.todayMs : totals.allMs) : currentMs;
 const meter = root.querySelector('#float-meter'), track = meter.querySelector('.float-meter-track');
 const over = valid && ms > expected * 60000;
 root.classList.toggle('float-overtime', over); root.classList.toggle('float-unbounded', !valid);
 let fill, detail;
 if (valid && !over) {
   fill = Math.min(100, ms / (expected * 60000) * 100);
   detail = (daily ? '今日预计 ' : '预计总用时 ') + expected + '分钟 · ' + (over ? '超时 ' + clock(ms-expected*60000) : ms === expected*60000 ? '达到预计时长' : '剩余 ' + clock(expected*60000-ms));
   track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', daily ? '今日预计用时进度' : '任务预计总用时进度');
   track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(Math.round(fill)));
 } else {
   // A clock scale, never a completion percentage. Exact hours keep a full segment until the next second.
   const seconds = Math.floor((over ? ms-expected*60000 : ms) / 1000), hours = Math.floor(seconds / 3600), rest = seconds % 3600;
   fill = seconds > 0 && rest === 0 ? 100 : rest / 3600 * 100;
   detail = (over ? (daily?'今日预计 ':'预计总用时 ')+expected+'分钟 · 超时 ' : '用时刻度 · ') + (hours ? hours + '小时＋' : '') + Math.floor(rest / 60) + '分' + String(rest % 60).padStart(2, '0') + '秒';
   track.setAttribute('role', 'img'); track.setAttribute('aria-label', (over?'超时':'本次用时')+'刻度，每格15分钟，每段1小时');
   ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].forEach(name => track.removeAttribute(name));
 }
 track.style.setProperty('--meter-tick', valid&&!over?Math.min(100,15/expected*100)+'%':'25%');
 if(over&&folded)root.querySelector('.float-clock').textContent='超时 '+clock(ms-expected*60000);
 track.setAttribute('aria-valuetext', detail);
 meter.querySelector('.float-meter-fill').style.width = Math.max(0, fill) + '%';
 meter.querySelector('.float-meter-text').textContent = detail + (paused.length > 1 ? ' · ' + paused.length + '项暂停' : '');
 toggle.setAttribute('aria-label', (session.status === 'running' ? '计时中，' : '已暂停，') + title + '；本次 ' + clock(currentMs) + '；今日 ' + clock(totals.todayMs) + '；' + detail + '；' + (folded ? '展开详情' : '收起详情'));
 const complete = root.querySelector('[data-float-open]');
 const targetDay = ref.day || task?.assignment?.day;
 complete.textContent = '任务与完成' + (targetDay && targetDay !== nowDay ? ' · ' + targetDay.slice(5) : '');
 complete.disabled = A.memoActions.busy();
}
document.addEventListener('focusin', e => { if (e.target?.id === 'memo-editor') update(selected); }, true);
document.addEventListener('focusout', e => { if (e.target?.id === 'memo-editor') queueMicrotask(() => update(selected)); }, true);
document.addEventListener('click', e => {
 const b = e.target.closest('[data-float-toggle],[data-float-open]'); if (!b) return;
 e.preventDefault(); e.stopImmediatePropagation();
 if (b.hasAttribute('data-float-toggle')) {
   collapsed = !collapsed; try { localStorage.setItem('focusPlanFloatExpanded', collapsed ? '0' : '1'); } catch {}
   update(selected); return;
 }
 if (!selected || A.memoActions.busy()) return;
 const found = A.memoSchedule.resolve(selected.ref);
 if (!found) { A.ui.toast('任务已不存在，可结束此计时记录'); return; }
 A.app.switchView('tasks');
 if (found.ref.kind === 'checkin') A.memoActions.checkin(found.ref.id, found.ref.day);
 else A.memoWorkspace.complete(found.ref);
}, true);
A.memoFloat = { update };
})();
