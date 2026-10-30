/* Compact projections of existing sessions. No parallel timer or reward state. */
(function () {
'use strict';
const A = window.App;
let selected = null, collapsed = true;
try { collapsed = localStorage.getItem('focusPlanFloatExpanded') !== '1'; } catch {}
const clock = ms => { const s = Math.floor(Math.max(0, ms) / 1000); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
// Anchor to the visible viewport, including when a mobile keyboard reduces it.
function place() {
 const root = document.getElementById('mw-live'); if (!root) return;
 const viewport = window.visualViewport, height = viewport?.height || window.innerHeight, offset = viewport?.offsetTop || 0;
 const bottom = height < 500 ? 64 : 88;
 const target = height < 500 ? Math.min(64, height * .18) : Math.max(144, Math.min(260, height * .24));
 const top = Math.max(12, Math.min(target, height - bottom - 112));
 root.style.setProperty('--float-top', (offset + top) + 'px');
 root.style.setProperty('--float-room', Math.max(44, height - top - bottom) + 'px');
}
window.visualViewport?.addEventListener('resize', place);
window.visualViewport?.addEventListener('scroll', place);
window.addEventListener('resize', place);
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
 meter.innerHTML = '<span class="float-meter-text"></span><div class="float-meter-scale"><span>0</span><span class="float-range-end"></span></div><div class="float-meter-track"><span class="float-meter-previous"></span><span class="float-meter-fill"></span><i class="float-expected-mark" aria-hidden="true"></i></div>';
 root.append(meter);
 const view = document.createElement('button'); view.type = 'button'; view.className = 'btn float-complete'; view.dataset.floatOpen = '';
 root.append(view);
}
function update(session, paused = []) {
 selected = session;
 const root = document.getElementById('mw-live'); if (!root) return;
 ensure(root);
 place();
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
 const projection = A.memoSchedule.meterTiming(ref, session);
 root.querySelector('.float-current').textContent = (daily ? '今日累计 ' : '累计 ') + clock(projection.totalMs);
 root.querySelector('.float-clock').textContent = '本次 ' + clock(projection.currentMs);
 root.querySelector('.float-total').textContent = daily ? '历日累计 ' + clock(totals.allMs) : '今日 ' + clock(totals.todayMs);
 const end = root.querySelector('[data-schedule-command="end"]'); if (end && !end.disabled) end.textContent = '结束计时';
 const expected = Number(task?.memoEstimatedDays?.[daily ? nowDay : ref.day] ?? task?.estimatedMinutes);
 const valid = Number.isFinite(expected) && expected > 0, currentMs = projection.currentMs;
 const ms = projection.totalMs;
 const meter = root.querySelector('#float-meter'), track = meter.querySelector('.float-meter-track');
 const {over,bounded,fill,previous,current,rangeMs,expectedPosition,detail,tick,state}=A.memoSchedule.meterState(ms,expected,daily,projection.previousMs);
 root.classList.toggle('float-overtime',over);root.classList.toggle('float-unbounded',!valid);root.dataset.meterState=state;
 track.setAttribute('role',bounded?'progressbar':'img');
 track.setAttribute('aria-label',(daily?'今日累计':'任务累计')+'用时刻度，浅色为此前，亮色为本次，范围0至'+rangeMs/60000+'分钟');
 ['aria-valuemin','aria-valuemax','aria-valuenow'].forEach(name=>track.removeAttribute(name));
 if(bounded){track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(Math.round(fill)));}
 track.style.setProperty('--meter-tick',tick);
 if(over&&folded)root.querySelector('.float-clock').textContent='超时 '+clock(ms-expected*60000);
 const description = detail + '；此前 ' + clock(projection.previousMs) + ' · 本次 ' + clock(currentMs);
 track.setAttribute('aria-valuetext', description);
 track.dataset.totalMs = String(ms);track.dataset.previousMs = String(projection.previousMs);track.dataset.currentMs = String(currentMs);
 meter.querySelector('.float-meter-previous').style.width = previous + '%';
 const fillEl = meter.querySelector('.float-meter-fill');fillEl.style.left = previous + '%';fillEl.style.width = Math.max(0,current) + '%';
 const mark = meter.querySelector('.float-expected-mark');mark.hidden = !valid;mark.style.left = (expectedPosition ?? 0) + '%';
 track.style.setProperty('--expected-position',(expectedPosition ?? 100)+'%');
 meter.querySelector('.float-range-end').textContent = rangeMs/60000 + '分钟';
 meter.querySelector('.float-meter-text').textContent = description + (paused.length > 1 ? ' · ' + paused.length + '项暂停' : '');
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
