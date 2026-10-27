/* Floating visualization of existing timer sessions. Never creates a parallel timer. */
(function () {
'use strict';
const A=window.App;
let selected=null, collapsed=true;
try {collapsed=localStorage.getItem('focusPlanFloatExpanded')!=='1';}catch{}
const clock=ms=>{const s=Math.floor(Math.max(0,ms)/1000);return Math.floor(s/3600)+':'+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
function ensure(root){
 if(root.querySelector('[data-float-toggle]'))return;
 const toggle=document.createElement('button');
 toggle.type='button';toggle.className='btn float-toggle';toggle.dataset.floatToggle='';
 toggle.innerHTML='<span class="float-name"></span><span class="float-clock"></span><span class="float-current"></span><span class="float-arrow" aria-hidden="true"></span><span class="float-meter-mini" aria-hidden="true"><span class="float-meter-mini-fill"></span></span>';
 root.prepend(toggle);
 const title=document.createElement('p');title.id='float-title';root.append(title);
 const info=document.createElement('p');info.id='float-estimate';root.append(info);
 const meter=document.createElement('div');meter.id='float-meter';meter.className='float-meter';
 meter.innerHTML='<div class="float-meter-track" role="progressbar" aria-label="任务预计时间进度" aria-valuemin="0" aria-valuemax="100"><span class="float-meter-fill"></span></div><span class="float-meter-text"></span>';
 root.append(meter);
 const view=document.createElement('button');view.type='button';view.className='btn';view.dataset.floatOpen='';
 view.textContent='任务与完成';root.append(view);
}
function update(session,paused=[]){
 selected=session;
 const root=document.getElementById('mw-live');if(!root)return;
 ensure(root);
 const memoFocused=document.activeElement?.id==='memo-editor';
 const folded=collapsed||memoFocused;
 root.classList.toggle('float-empty',!session);
 root.classList.toggle('float-collapsed',folded);
 root.classList.toggle('float-editor-focus',memoFocused);
 root.dataset.status=session?.status||'';
 const toggle=root.querySelector('[data-float-toggle]');
 toggle.setAttribute('aria-expanded',String(!folded));
 toggle.querySelector('.float-arrow').textContent=folded?'⌄':'⌃';
 if(!session)return;
 const found=A.memoSchedule.resolve(session.ref),task=found?.task,ref=found?.ref||session.ref;
 const title=task?.text||session.title;
 const totals=A.memoSchedule.timing(session.ref);
 toggle.querySelector('.float-name').textContent=(session.status==='running'?'':'已暂停 · ')+title;
 toggle.querySelector('.float-clock').textContent='累计 '+clock(totals.totalMs);
 toggle.querySelector('.float-current').textContent='本次 '+clock(totals.currentMs);
 root.querySelector('#float-title').textContent=title;
 const end=root.querySelector('[data-schedule-command="end"]');
 if(end&&!end.disabled&&end.textContent!=='结束计时')end.textContent='结束计时';
 const expected=Number(task?.memoEstimatedDays?.[ref.day]??task?.estimatedMinutes);
 const valid=Number.isFinite(expected)&&expected>0;
 const meter=root.querySelector('#float-meter'),mini=toggle.querySelector('.float-meter-mini');
 const ms=totals.totalMs;
 meter.hidden=!valid;mini.hidden=!valid;
 root.classList.toggle('float-overtime',valid&&ms>expected*60000);
 const message=valid?'预计 '+expected+'分钟 · 累计 '+clock(ms):'预计未设置 · 累计 '+clock(ms);
 root.querySelector('#float-estimate').textContent=message+(paused.length>1?' · 共'+paused.length+'项暂停':'');
 if(valid){
   const pct=ms/60000/expected*100,fill=Math.max(0,Math.min(100,pct)),over=ms>expected*60000;
   meter.querySelector('.float-meter-fill').style.width=fill+'%';
   mini.querySelector('.float-meter-mini-fill').style.width=fill+'%';
   const detail=over?'超时 '+clock(ms-expected*60000):ms===expected*60000?'达到预计时长':'剩余 '+clock(expected*60000-ms);
   meter.querySelector('.float-meter-text').textContent=Math.floor(pct)+'% · '+detail;
   const track=meter.querySelector('[role="progressbar"]');
   track.setAttribute('aria-valuenow',String(Math.round(fill)));
   track.setAttribute('aria-valuetext',Math.floor(pct)+'%，'+detail);
 }
 toggle.setAttribute('aria-label',(session.status==='running'?'计时中 ':'已暂停 ')+title+' 累计 '+clock(ms)+' 本次 '+clock(totals.currentMs)+(valid?'，'+meter.querySelector('.float-meter-text').textContent:''));
 root.querySelector('[data-float-open]').disabled=A.memoActions.busy();
}
document.addEventListener('focusin',e=>{
 if(e.target?.id==='memo-editor')update(selected);
},true);
document.addEventListener('focusout',e=>{
 if(e.target?.id==='memo-editor')queueMicrotask(()=>update(selected));
},true);
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-float-toggle],[data-float-open]');if(!b)return;
 e.preventDefault();e.stopImmediatePropagation();
 if(b.hasAttribute('data-float-toggle')){
   collapsed=!collapsed;try{localStorage.setItem('focusPlanFloatExpanded',collapsed?'0':'1');}catch{}
   update(selected);return;
 }
 if(!selected||A.memoActions.busy())return;
 const found=A.memoSchedule.resolve(selected.ref);
 if(!found){A.ui.toast('任务已不存在，可结束此计时记录');return;}
 A.app.switchView('tasks');
 if(found.ref.kind==='checkin')A.memoActions.checkin(found.ref.id,found.ref.day);
 else A.memoWorkspace.complete(found.ref);
},true);
A.memoFloat={update,clock};
})();
