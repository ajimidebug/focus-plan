/* Review series own schedules; ordinary task events own execution, notes and points. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, P = () => A.memoSchedule;
  const clone = x => JSON.parse(JSON.stringify(x)), E = x => S().esc(String(x ?? ''));
  const lists = { required: '必做', ideal: '理想', extra: '长期拓展' };
  const results = { '': '未记录', no: '未掌握', partial: '部分掌握', yes: '已掌握' };
  function state(create = false) {
    const d = S().data();
    if (!d.memoReview && create) d.memoReview = { version: 1, series: [], rounds: [] };
    return d.memoReview || { version: 1, series: [], rounds: [] };
  }
  const series = id => state().series.find(s => s.id === id);
  const round = id => state().rounds.find(r => r.id === id);
  const rounds = id => state().rounds.filter(r => r.seriesId === id).sort((a,b) => a.n-b.n);
  function locate(ref) {
    const found = P().resolve(ref), r = round(found?.task.memoReviewRoundId);
    return r ? { ...found, round: r, series: series(r.seriesId) } : null;
  }
  const taskOf = r => r?.taskRef && P().resolve(r.taskRef);
  function clock(ms) { return M().naturalDay(ms) + ' ' + M().clock(ms); }
  function inputTime(ms) { return clock(ms).replace(' ', 'T'); }
  function parseTime(value) { const n = Date.parse(value + ':00+08:00'); if (!Number.isFinite(n)) throw Error('请选择有效的北京时间'); return n; }
  function gapText(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return minutes < 60 ? minutes + '分钟' : minutes < 1440 ? Math.floor(minutes/60) + '小时' + (minutes%60 ? minutes%60+'分钟' : '') : Math.floor(minutes/1440) + '天' + (minutes%1440 ? Math.floor(minutes%1440/60)+'小时' : '');
  }
  function point(r) {
    const f = taskOf(r); if (!f) return;
    const items = P().state().items, old = items.find(p => p.memoReviewRoundId === r.id && !p.deleted);
    const p = P().savePlan({ ref: f.ref, title: f.task.text, day: M().userDay(r.due), type: 'point', start: r.due, end: null, memoReviewRoundId: r.id, reviewSync: true }, old?.id);
    delete p.reviewSync; p.suspendedByReview = !!series(r.seriesId)?.paused || r.status !== 'pending';
    // Completed points remain visible as the saved expectation.
    if (r.status === 'done') p.suspendedByReview = false;
    return p;
  }
  function newSeriesCore(input) {
    const text = String(input.text || '').trim(), points = Number(input.points ?? 1), estimate = Number(input.estimatedMinutes || 0);
    if (!text || !Number.isFinite(points) || points < 0 || !Number.isFinite(estimate) || estimate < 0 || estimate > 1440 || !lists[input.list || 'ideal']) throw Error('请检查名称、积分、栏目和预计用时');
    const s = { id: S().uid(), text, note: String(input.note || ''), points, estimatedMinutes: estimate, list: input.list || 'ideal', createdAt: new Date().toISOString(), paused: false, source: input.source ? clone(input.source) : null };
    state(true).series.push(s);
    if (input.due != null) scheduleCore(s.id, input.due);
    return s;
  }
  function scheduleCore(id, due, options = {}) {
    const s = series(id); if (!s || s.paused) throw Error('复习任务已暂停或不存在');
    if (!Number.isFinite(due) || due <= 0 || (!options.legacy && due <= Date.now())) throw Error('下次复习时间必须在当前时刻之后');
    if (options.parentEventId) {
      const existing = rounds(id).find(r => r.parentEventId === options.parentEventId && r.status !== 'cancelled');
      if (existing) return existing;
    }
    const list = options.list || s.list, day = M().userDay(due); if (!lists[list]) throw Error('任务栏目无效');
    const r = { id: S().uid(), seriesId: id, n: Math.max(0,...rounds(id).map(x=>x.n))+1, due, originalDue: due, status: 'pending', result: '', history: [], createdAt: new Date().toISOString(), parentEventId: options.parentEventId || null };
    const task = { id: S().uid(), text: '复习：' + s.text + ' · 第' + r.n + '轮', note: s.note, points: s.points, estimatedMinutes: s.estimatedMinutes, dateBasis: 'user', createdAt: r.createdAt, memoReviewRoundId: r.id };
    r.taskRef = { kind: 'task', id: task.id, day, list };
    state(true).rounds.push(r); S().getDay(day).tasks[list].push(task); point(r); return r;
  }
  function assertExecutable(ref) {
    const x = locate(ref); if (x && (x.round.status !== 'pending' || x.series?.paused)) throw Error('这轮已取消、完成或暂停，请在复习管理中查看');
    return x;
  }
  function rescheduleCore(id, due, list) {
    const r = round(id), s = r && series(r.seriesId), f = taskOf(r);
    if (!r || r.status !== 'pending' || !f || s.paused) throw Error('只能调整未完成且未暂停的轮次');
    if (!Number.isFinite(due) || due <= Date.now()) throw Error('请选择未来的复习时刻');
    list = list || f.ref.list || f.task.assignment?.list || s.list;
    if (due === r.due && list === (f.ref.list || f.task.assignment?.list)) return;
    const target = M().userDay(due);
    // Timer identity is kept by moveCore, including cross-day history snapshots.
    A.memoFlow.moveCore(f.ref, target, list);
    const next = P().resolve(f.ref); if (!next) throw Error('复习任务移动失败');
    r.history.push({ at: new Date().toISOString(), from: r.due, to: due, action: 'reschedule' });
    r.due = due; r.editedAt = new Date().toISOString(); r.taskRef = clone(next.ref); point(r); P().invalidate?.();
  }
  function cancelCore(id, reason = '取消安排') {
    const r = round(id); if (!r || r.status === 'cancelled') return;
    if (r.status === 'done') throw Error('请先撤销本轮完成');
    const f = taskOf(r); if (f) { P().stopRef(f.ref); f.task.memoReviewHidden = true; }
    r.status = 'cancelled'; r.history.push({ at: new Date().toISOString(), action: 'cancel', reason });
    P().state().items.filter(p=>p.memoReviewRoundId===id).forEach(p=>p.suspendedByReview=true); P().invalidate?.();
  }
  function pauseCore(id, paused) {
    const s = series(id); if (!s) throw Error('复习任务不存在');
    s.paused = paused; s.pausedAt = paused ? new Date().toISOString() : null;
    rounds(id).filter(r=>r.status==='pending').forEach(r=>{ const f=taskOf(r); if(f){if(paused)P().stopRef(f.ref);f.task.memoReviewHidden=paused;} point(r); });
    P().invalidate?.();
  }
  function onComplete(event, spec) {
    const x = assertExecutable(spec); if (!x) return '';
    const { round:r, series:s } = x, value = spec.review || {};
    if (!Object.hasOwn(results,value.result || '')) throw Error('复习结果无效');
    r.status='done'; r.at=event.at; r.eventId=event.id; r.result=value.result || '';
    event.review={seriesId:s.id,roundId:r.id,n:r.n,title:s.text,due:r.due,originalDue:r.originalDue,result:r.result};
    const previous=rounds(s.id).filter(v=>v.status==='done'&&v.id!==r.id&&Date.parse(v.at)<=Date.parse(event.at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
    if(previous)event.review.gapMs=Date.parse(event.at)-Date.parse(previous.at);
    if(value.mode && value.mode!=='none'){
      const due=value.mode==='relative'?Date.parse(event.at)+Number(value.minutes)*60000:Number(value.due);
      if(!Number.isFinite(due)||due<=Date.parse(event.at))throw Error('下一轮应晚于本轮完成时刻');
      const next=scheduleCore(s.id,due,{parentEventId:event.id});event.review.nextRoundId=next.id;
    }
    return '\n复习：'+s.text+' · 第'+r.n+'轮\n原定：'+clock(r.due)+'；实际：'+clock(Date.parse(event.at))+'\n结果：'+results[r.result]+(previous?'；距上次实际完成 '+gapText(event.review.gapMs):'')+(event.review.nextRoundId?'\n下次：'+clock(round(event.review.nextRoundId).due):'');
  }
  function started(r) { const f=taskOf(r); return !!f && P().state().sessions.some(s=>s.ref.id===f.ref.id&&s.ref.kind===f.ref.kind&&s.chunks.length); }
  function onUndo(event) {
    if(!event.review)return;const r=round(event.review.roundId);if(!r||r.eventId!==event.id)throw Error('复习完成关联已改变');
    r.status='pending';delete r.at;delete r.eventId;r.result='';
    const next=round(event.review.nextRoundId);
    if(next&&next.status==='pending'&&!next.editedAt&&!started(next))cancelCore(next.id,'撤销上轮完成时取消未使用的下一轮');
    else if(next)next.predecessorUndone=true;
    const f=taskOf(r);if(f)f.task.memoReviewHidden=!!series(r.seriesId)?.paused;point(r);
  }
  function onDelete(task){const r=round(task?.memoReviewRoundId);if(r&&r.status==='pending')cancelCore(r.id,'删除执行任务');}
  function restoreTask(task){const r=round(task?.memoReviewRoundId);if(!r)return;if(r.status!=='done'){r.status='pending';delete task.memoReviewHidden;point(r);}}
  function hidden(task,list) { return !!task.memoReviewHidden && list!=='required'; }
  function label(task) {
    const r=round(task?.memoReviewRoundId);if(!r)return '';
    const s=series(r.seriesId),status=r.status==='cancelled'?'已取消':s?.paused?'已暂停':r.status==='done'?'已完成':'原定 '+clock(r.due);
    return '<small class="review-badge">第'+r.n+'轮 · '+E(status)+(r.predecessorUndone?' · 上轮已撤销':'')+'</small>';
  }
  function summary(day) {
    const due=state().rounds.filter(r=>r.status==='pending'&&!series(r.seriesId)?.paused&&r.due<=Date.now()&&taskOf(r));
    if(!due.length || day!==M().userDay())return '';
    return '<details class="review-due"><summary>到期复习 '+due.length+'轮</summary>'+due.sort((a,b)=>a.due-b.due).map(r=>'<p>'+E(series(r.seriesId)?.text)+' · '+E(clock(r.due))+' <button class="btn btn-small" data-review-open="'+r.id+'">打开本轮</button></p>').join('')+'</details>';
  }
  function registry() {
    return '<details class="review-registry"><summary>复习任务（'+state().series.length+'）</summary><button class="btn btn-small" data-review-new>＋ 新建复习任务</button>'+state().series.map(s=>{
      const rs=rounds(s.id),next=rs.filter(r=>r.status==='pending').sort((a,b)=>a.due-b.due)[0];
      return '<div class="review-series"><strong>'+E(s.text)+'</strong><small>已完成'+rs.filter(r=>r.status==='done').length+'轮 · '+(s.paused?'已暂停':next?'下次 '+E(clock(next.due)):'暂无下次安排')+'</small><button class="btn btn-small" data-review-series="'+s.id+'">历史与安排</button></div>';
    }).join('')+'</details>';
  }
  function refresh(){A.memoWorkspace?.render();P().render();A.app?.refreshStats();}
  function bindSave(m,fn,after){let busy=false;A.ui.bindActions({cancel:()=>{if(!busy&&!A.memoActions.busy())A.ui.closeModal();},save:async b=>{
    if(busy)return;busy=true;b.disabled=true;
    try{if(await A.memoActions.commit(fn)){A.ui.closeModal();refresh();after?.();}}
    catch(e){m.querySelector('[role=alert]').textContent=e.message;b.textContent=A.memoActions.busy()?'重试保存':'重新保存';}
    finally{busy=false;b.disabled=false;m.querySelectorAll('input,textarea,select').forEach(x=>x.disabled=A.memoActions.busy());}
  }});}
  function timeField(due){return '<label>北京时间<input type="datetime-local" data-review-time value="'+inputTime(due)+'"></label><div class="review-chips">'+[[30,'30分钟后'],[120,'2小时后'],[240,'4小时后'],[1440,'1天后'],[4320,'3天后']].map(([n,t])=>'<button type="button" class="btn btn-small" data-review-minutes="'+n+'">'+t+'</button>').join('')+'</div><p class="hint" data-review-preview></p>';}
  function bindTime(m){const input=m.querySelector('[data-review-time]'),out=m.querySelector('[data-review-preview]');const show=()=>{try{const ms=parseTime(input.value);out.textContent='计划 '+clock(ms)+' · 用户日 '+M().userDay(ms)+(ms>Date.now()?' · 距现在 '+gapText(ms-Date.now()):' · 已到期');}catch{out.textContent='请选择时间';}};input.oninput=show;m.querySelectorAll('[data-review-minutes]').forEach(b=>b.onclick=()=>{input.value=inputTime(Date.now()+Number(b.dataset.reviewMinutes)*60000);show();});show();return ()=>parseTime(input.value);}
  function newEditor(sourceRef=null,draft=null){
    const old=sourceRef?P().find(sourceRef):draft,prior=sourceRef&&state().series.find(s=>s.source&&s.source.id===sourceRef.id&&s.source.kind===sourceRef.kind);
    if(prior)return manage(prior.id);
    const m=A.ui.openModal('新建间隔复习','<label>名称<input id="review-title" value="'+E(old?.text||'')+'"></label><label>每轮积分<input id="review-points" type="number" min="0" value="1"></label>'+timeField(Date.now()+120*60000)+'<label>执行栏目<select id="review-list">'+Object.entries(lists).map(([k,t])=>'<option value="'+k+'" '+(k==='ideal'?'selected':'')+'>'+t+'</option>').join('')+'</select></label><p class="hint">必做沿用原有逾期与整组奖励规则。每轮只结算一次。</p><label>备注<textarea id="review-note">'+E(old?.note||'')+'</textarea></label><label>预计分钟<input id="review-estimate" type="number" min="0" max="1440" value="'+E(old?.estimatedMinutes||'')+'"></label>'+(old?.sp?'<p class="hint">检测到旧复习计划，可保留原记录并接入旧轮次。</p><label><input id="review-import" type="checkbox">接入旧计划（不补发历史积分）</label>':'')+'<p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存复习任务</button>',{lock:true});
    const getTime=bindTime(m);
    bindSave(m,()=>{const input={text:m.querySelector('#review-title').value,points:Number(m.querySelector('#review-points').value),note:m.querySelector('#review-note').value,estimatedMinutes:Number(m.querySelector('#review-estimate').value),list:m.querySelector('#review-list').value,source:sourceRef};
      if(m.querySelector('#review-import')?.checked)importCore(sourceRef,input);else newSeriesCore({...input,due:getTime()});});
  }
  function scheduleEditor(id,roundId=null){
    const s=series(id),r=round(roundId);if(!s)return;
    const m=A.ui.openModal(r?'调整本轮复习':'安排下一次 · '+s.text,timeField(r?.due||Date.now()+120*60000)+'<label>执行栏目<select id="review-list">'+Object.entries(lists).map(([k,t])=>'<option value="'+k+'" '+(k===(taskOf(r)?.ref.list||s.list)?'selected':'')+'>'+t+'</option>').join('')+'</select></label><p class="hint">修改日期不会增加完成次数；每轮保留独立历史。</p><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存安排</button>',{lock:true});
    const getTime=bindTime(m);bindSave(m,()=>r?rescheduleCore(r.id,getTime(),m.querySelector('#review-list').value):scheduleCore(id,getTime(),{list:m.querySelector('#review-list').value}),()=>manage(id));
  }
  function manage(id){
    const s=series(id);if(!s)return;const rs=rounds(id);
    const m=A.ui.openModal('复习任务 · '+s.text,'<p>'+E(s.note)+'</p><div class="review-history">'+rs.map((r,i)=>{
      const previous=rs.slice(0,i).filter(v=>v.status==='done').at(-1),interval=r.at&&previous?.at?' · 间隔 '+gapText(Date.parse(r.at)-Date.parse(previous.at)):'';
      return '<article><strong>第'+r.n+'轮 · '+E(r.status==='done'?'已完成':r.status==='cancelled'?'已取消':'待复习')+'</strong><small>计划 '+E(clock(r.due))+(r.originalDue!==r.due?' · 最初 '+E(clock(r.originalDue)):'')+'</small>'+(r.at?'<small>实际 '+E(clock(Date.parse(r.at)))+E(interval)+' · '+results[r.result||'']+'</small>':'')+(r.legacy?'<small>旧记录 · '+E(r.legacy.via==='move'?'移动记作完成，未验证实际复习':'保留原记录，未重新计分')+'</small>':'')+(r.predecessorUndone?'<small>前置完成已撤销；本轮保留</small>':'')+(taskOf(r)?'<button class="btn btn-small" data-review-open="'+r.id+'">查看本轮</button>':'')+(r.status==='pending'&&!s.paused?'<button class="btn btn-small" data-review-edit="'+r.id+'">改时间</button><button class="btn btn-small" data-review-task="'+r.id+'">本轮内容与积分</button><button class="btn btn-small" data-review-cancel="'+r.id+'">取消本轮</button>':'')+(r.history.length?'<details><summary>调整记录</summary>'+r.history.map(h=>'<small>'+E(clock(Date.parse(h.at)))+' · '+E(h.reason||(h.from?clock(h.from)+' → '+clock(h.to):h.action))+'</small>').join('')+'</details>':'')+'</article>';
    }).join('')+'</div><p role="alert">'+(A.memoActions.busy()?'本次操作尚未保存，请重试保存。':'')+'</p>','<button class="btn" data-act="close">关闭</button><button class="btn" data-act="edit">修改内容</button><button class="btn" data-act="pause">'+(s.paused?'恢复复习':'暂停复习')+'</button>'+(!s.paused?'<button class="btn" data-act="stop">停止后续</button><button class="btn btn-primary" data-act="add">安排下一轮</button>':''),{lock:true});
    async function change(fn){try{if(await A.memoActions.commit(fn)){refresh();manage(id);}}catch(e){m.querySelector('[role=alert]').textContent=e.message;const b=document.createElement('button');b.className='btn';b.textContent='重试保存';b.onclick=()=>change(()=>{});m.querySelector('[role=alert]').append(b);}}
    if(A.memoActions.busy()){const retry=document.createElement('button');retry.className='btn';retry.textContent='重试保存';retry.onclick=()=>change(()=>{});m.querySelector('[role=alert]').append(retry);}
    m.querySelectorAll('[data-review-edit]').forEach(b=>b.onclick=()=>{if(!A.memoActions.busy())scheduleEditor(id,b.dataset.reviewEdit);});
    m.querySelectorAll('[data-review-task]').forEach(b=>b.onclick=()=>{if(!A.memoActions.busy()){const f=taskOf(round(b.dataset.reviewTask));if(f)A.memoWorkspace.editor(f.ref,undefined,true);}});
    m.querySelectorAll('[data-review-cancel]').forEach(b=>b.onclick=()=>change(()=>cancelCore(b.dataset.reviewCancel)));
    A.ui.bindActions({close:()=>{if(!A.memoActions.busy())A.ui.closeModal();},add:()=>{if(!A.memoActions.busy())scheduleEditor(id);},pause:()=>change(()=>pauseCore(id,!s.paused)),stop:()=>change(()=>{rounds(id).filter(r=>r.status==='pending').forEach(r=>cancelCore(r.id,'停止后续复习'));}),edit:()=>{if(!A.memoActions.busy())editSeries(id);}});
  }
  function editSeries(id){const s=series(id);if(!s)return;const m=A.ui.openModal('修改复习内容','<label>名称<input id="review-title" value="'+E(s.text)+'"></label><label>后续新轮次积分<input id="review-points" type="number" min="0" value="'+s.points+'"></label><label>备注<textarea id="review-note">'+E(s.note)+'</textarea></label><p class="hint">已经安排的轮次保留当时的内容和积分。</p><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>',{lock:true});bindSave(m,()=>{const current=series(id),text=m.querySelector('#review-title').value.trim(),points=Number(m.querySelector('#review-points').value);if(!text||!Number.isFinite(points)||points<0)throw Error('请检查名称与积分');current.text=text;current.note=m.querySelector('#review-note').value;current.points=points;},()=>manage(id));}
  function importCore(ref,input){
    if(state().series.some(s=>s.source?.id===ref.id&&s.source.kind===ref.kind))throw Error('这份来源已接入复习，请打开已有系列');
    const t=P().find(ref),plan=t?.sp?.planned;if(!Array.isArray(plan))throw Error('旧计划不可读取');
    const s=newSeriesCore({...input,source:ref});
    plan.forEach(old=>{const due=Number(old.due);if(!Number.isFinite(due)||due<=0)throw Error('旧计划时间异常，原记录未改动');
      if(old.done===null){const need=Math.max(1,Number(old.need)||1),hits=Array.isArray(old.hits)?old.hits.length:0;if(need>20)throw Error('旧轮次遍数异常');for(let i=0;i<Math.max(1,need-hits);i++){const r=scheduleCore(s.id,due,{legacy:true});r.legacy={...clone(old),remainingPass:i+1,remainingTotal:Math.max(1,need-hits)};}}
      else{const at=typeof old.at==='number'?new Date(old.at).toISOString():old.at&&Number.isFinite(Date.parse(old.at))?old.at:null;state(true).rounds.push({id:S().uid(),seriesId:s.id,n:Math.max(0,...rounds(s.id).map(r=>r.n))+1,due,originalDue:due,status:old.done===true?'done':'cancelled',at,result:'',history:[],legacy:clone(old),createdAt:new Date().toISOString()});}});
    return s;
  }
  function completionFields(ref,m){
    const x=locate(ref);if(!x)return ()=>null;
    const box=document.createElement('fieldset');box.className='review-completion';box.innerHTML='<legend>本轮复习与下次安排</legend><label>结果<select data-review-result>'+Object.entries(results).map(([k,t])=>'<option value="'+k+'">'+t+'</option>').join('')+'</select></label><label>下次<select data-review-next><option value="none">暂不安排</option><option value="30">30分钟后</option><option value="120">2小时后</option><option value="240">4小时后</option><option value="1440">1天后</option><option value="4320">3天后</option><option value="custom">自定义分钟</option><option value="at">指定时刻</option></select></label><input data-review-custom type="number" min="1" placeholder="间隔分钟" hidden><input data-review-at type="datetime-local" value="'+inputTime(Date.now()+86400000)+'" hidden><p class="hint">间隔从实际确认完成时计算；已有独立安排保留。若新增同日任务，整组奖励以保存后的条件为准。</p>';
    m.querySelector('.action-passage').before(box);
    const next=box.querySelector('[data-review-next]');next.onchange=()=>{box.querySelector('[data-review-custom]').hidden=next.value!=='custom';box.querySelector('[data-review-at]').hidden=next.value!=='at';};
    return ()=>{const mode=next.value;return {result:box.querySelector('[data-review-result]').value,mode:mode==='none'?'none':mode==='at'?'at':'relative',minutes:mode==='custom'?Number(box.querySelector('[data-review-custom]').value):Number(mode),due:mode==='at'?parseTime(box.querySelector('[data-review-at]').value):null};};
  }
  async function openRound(id){const r=round(id);let f=taskOf(r);if(!f)return A.ui.toast('原执行任务已删除，历史仍保留');if(r.status==='cancelled'||series(r.seriesId)?.paused)return manage(r.seriesId);if(f.ref.kind==='task'&&f.ref.day<M().userDay()){try{if(!await A.memoActions.commit(()=>{A.memoFlow.moveCore(f.ref,M().userDay(),f.ref.list);r.taskRef=clone(P().canonical(f.ref));}))return;f=taskOf(r);refresh();}catch(e){A.ui.toast(e.message);manage(r.seriesId);return;}}A.ui.closeModal();if(f.ref.kind==='queue')A.memoActions.queue(f.ref.id);else A.memoActions.task(f.ref.list,f.ref.id,f.ref.day);}
  function init(){
    document.addEventListener('click',e=>{const b=e.target.closest('[data-review-new],[data-review-series],[data-review-open]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();if(A.memoActions.busy())return A.ui.toast('请先重试保存');if(b.hasAttribute('data-review-new'))newEditor();else if(b.dataset.reviewOpen)openRound(b.dataset.reviewOpen);else manage(b.dataset.reviewSeries);},true);
    let last='';const check=()=>{const key=state().rounds.filter(r=>r.status==='pending'&&r.due<=Date.now()&&!series(r.seriesId)?.paused).map(r=>r.id).join('|');if(key!==last&&!document.querySelector('.modal-mask')&&!A.memoActions.busy()){last=key;refresh();}};
    setInterval(check,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  }
  A.memoReview={state,series,round,rounds,locate,taskOf,newSeriesCore,scheduleCore,rescheduleCore,cancelCore,pauseCore,assertExecutable,onComplete,onUndo,onDelete,restoreTask,hidden,label,summary,registry,newEditor,scheduleEditor,manage,importCore,completionFields,point,init};
})();
