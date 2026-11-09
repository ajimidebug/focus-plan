/* Memo workspace: explicit task editing, stable queue order and daily project occurrences. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, $ = id => document.getElementById(id), esc = x => S().esc(String(x ?? ''));
  const names = { required: '必做任务', ideal: '理想任务', extra: '长期拓展' };
  let pane = 'today', taskDay, positions = {}, ready = false, lastDay, lastCivilDay, completionFocus;
  const projects = () => S().data().memoProjects || [];
  const button = (act, text, attrs = '', primary = false) => '<button type="button" class="btn btn-small' + (primary ? ' btn-primary' : '') + '" data-mw="' + act + '" ' + attrs + '>' + text + '</button>';
  function sortedQueue() { return (S().data().queue || []).slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (a.rank ?? (S().data().queue.indexOf(a) * 1024)) - (b.rank ?? (S().data().queue.indexOf(b) * 1024))); }
  function orderQueue() { S().data().queue = sortedQueue(); }
  function moveQueue(id, action) {
    orderQueue(); const q = S().data().queue, t = q.find(x => x.id === id); if (!t) throw new Error('任务已移动');
    const group = q.filter(x => !!x.pinned === !!t.pinned), i = group.indexOf(t);
    if (action === 'pin') { t.pinned = !t.pinned; t.rank = Math.min(0, ...q.filter(x => !!x.pinned === !!t.pinned).map(x => x.rank ?? 0)) - 1024; }
    else { const j = i + (action === 'up' ? -1 : 1); if (j < 0 || j >= group.length) return; [group[i], group[j]] = [group[j], group[i]]; group.forEach((x, n) => x.rank = n * 1024); }
    orderQueue();
  }

  // Execution queue stores references, not task copies; no skip audit events.
  let execExpanded=false;
  function execEntries(){const x=S().data().memoExecutionQueue;if(x===undefined)return [];if(!Array.isArray(x))throw Error('执行队列数据异常，请下载备份');return x;}
  const execKey=ref=>A.memoSchedule.key(ref);
  // Session-local intent. Reload restores recorded time but never auto-starts next task.
  let queueExecution=null;
  const currentQueueSession=()=>queueExecution&&A.memoSchedule.state().sessions.find(s=>s.id===queueExecution.sessionId);
  function captureQueueAdvance(ref){
    if(!queueExecution||queueExecution.key!==execKey(ref))return null;
    const session=currentQueueSession();
    if(!session||!['running','paused'].includes(session.status)||execKey(session.ref)!==queueExecution.key)return null;
    return {key:queueExecution.key,sessionId:session.id,running:session.status==='running'};
  }
  function timerStarted(ref,fromQueue=false){
    const key=execKey(ref);
    const running=A.memoSchedule.state().sessions.find(s=>s.status==='running'&&execKey(s.ref)===key);
    if(fromQueue){
      if(!running||!execEntries().some(e=>{const x=execResolve(e);return x&&execKey(x.ref)===key;}))return;
      queueExecution={key,sessionId:running.id};
    }else if(queueExecution){
      if(key!==queueExecution.key)queueExecution=null;
      else if(running)queueExecution.sessionId=running.id;
    }
    render();
  }
  function timerEnded(ref){
    if(queueExecution&&queueExecution.key===execKey(ref)){queueExecution=null;render();}
  }
  async function queueSettled(ref,captured){
    if(!captured||!queueExecution||queueExecution.key!==captured.key||queueExecution.sessionId!==captured.sessionId)return;
    queueExecution=null;
    if(!captured.running||A.memoActions.busy())return;
    const candidates=execEntries().map(execResolve).filter(Boolean).filter(x=>!doneFor(x.task,x.ref));
    for(const item of candidates){
      if(A.memoSchedule.state().sessions.some(s=>s.status==='running'))return;
      try{A.memoReview?.assertExecutable(item.ref);}catch(_){continue;}
      let started=null;const startAt=Date.now();
      try{
        const saved=await A.memoActions.commit(()=>{started=A.memoSchedule.startRef(item.ref,startAt);});
        if(!saved){render();return;}
        if(started?.status==='running'){
          queueExecution={key:execKey(item.ref),sessionId:started.id};
          render();A.memoSchedule.render();return;
        }
      }catch(error){
        if(A.memoActions.busy()){
          // A failed save may leave the proposed chunk in memory: freeze it
          // at its start rather than show an unconfirmed running timer.
          if(started?.status==='running')A.memoSchedule.pauseCore(started,startAt);
          const message='上一项已保存，下一项计时尚未确认保存。请重试保存，再手动继续。';
          if($('mw-error'))$('mw-error').textContent=message;
          A.ui.toast(message);render();A.memoSchedule.render();return;
        }
        if(!A.memoSchedule.resolve(item.ref))continue;
        A.ui.toast('下一项计时未启动：'+error.message);
        render();return;
      }
    }
    render();
  }
  function execResolve(entry){
    if(!entry?.ref||typeof entry.ref!=='object')return null;
    const x=A.memoSchedule.resolve(entry.ref);
    if(!x||x.task.archived||x.task.memoDismissed)return null;
    if(x.ref.kind==='checkin'){
      const day=x.ref.day;
      if(day!==M().userDay()||!A.memoFinance?.plans(day).some(p=>p.it.id===x.ref.id))return null;
      if(!Number.isSafeInteger(entry.habitCount)||entry.habitCount<0||Number(x.task.days?.[day]||0)>entry.habitCount)return null;
    }
    return x;
  }
  function execHas(ref){
    const key=execKey(ref);
    return execEntries().some(entry=>{const x=execResolve(entry);return x&&execKey(x.ref)===key;});
  }
  function pruneExec(){
    if(S().data().memoExecutionQueue===undefined)return;
    const seen=new Set();
    S().data().memoExecutionQueue=execEntries().filter(e=>{
      const x=execResolve(e);if(!x||doneFor(x.task,x.ref))return false;
      const key=execKey(x.ref);if(seen.has(key))return false;seen.add(key);return true;
    });
  }
  function execAppend(refs){
    const existing=new Set(execEntries().map(execResolve).filter(Boolean).map(x=>execKey(x.ref)));
    for(const ref of refs){
      const x=A.memoSchedule.resolve(ref);
      if(!x||x.task.archived||x.task.memoDismissed||doneFor(x.task,x.ref))throw Error('只能加入有效的未完成任务');
      if(x.ref.kind==='checkin'&&(x.ref.day!==M().userDay()||!A.memoFinance?.plans(x.ref.day).some(p=>p.it.id===x.ref.id)))throw Error('只能把今天已安排的习惯加入队列');
      const key=execKey(x.ref);
      if(!existing.has(key)){const entry={ref:x.ref,pinned:false};if(x.ref.kind==='checkin')entry.habitCount=Number(x.task.days?.[x.ref.day])||0;(S().data().memoExecutionQueue||(S().data().memoExecutionQueue=[])).push(entry);existing.add(key);}
    }
  }
  function execAdd(ref){
    if(A.memoActions.busy())return A.ui.toast('请先重试保存');
    if(execHas(ref))return A.ui.toast('已经在执行队列中');
    return commit(()=>execAppend([ref]));
  }
  async function execMove(ref,act){
    let captured=null;
    const saved=await commit(()=>{
      const arr=execEntries(),key=execKey(ref),i=arr.findIndex(e=>{const x=execResolve(e);return x&&execKey(x.ref)===key;});
      if(i<0)throw Error('这项任务已经移出队列');
      if(act==='skip'){captured=captureQueueAdvance(ref);if(captured)A.memoSchedule.stopRef(ref);arr.splice(i,1);return;}
      if(act==='pin'){arr[i].pinned=!arr[i].pinned;arr.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));return;}
      if(act==='tail'){const item=arr.splice(i,1)[0];item.pinned=false;arr.push(item);return;}
      const j=i+(act==='up'?-1:1);
      if(j>=0&&j<arr.length&&!!arr[i].pinned===!!arr[j].pinned)[arr[i],arr[j]]=[arr[j],arr[i]];
    });
    if(saved&&act==='skip'&&captured)await queueSettled(ref,captured);
    if(!saved&&captured)queueExecution=null;
    return saved;
  }
  function execPick(){
    const seen=new Set(),types=['required','ideal','extra'],today=M().userDay();
    const plans=taskDay===today?A.memoFinance?.plans(taskDay)||[]:[];
    const selected=new Set(execEntries().map(execResolve).filter(Boolean).map(x=>execKey(x.ref)));
    const groups=types.map(list=>{
      const normal=A.memoSchedule.columnItems(taskDay,list).filter(x=>!x.done&&!x.task.archived&&!x.task.memoDismissed);
      const habits=plans.filter(x=>x.r.list===list&&!x.r.hidden&&!x.it.archived).map(x=>({
        ref:{kind:'checkin',id:x.it.id,day:taskDay},task:x.it,habit:{count:x.n,target:x.r.target}
      }));
      const rows=normal.concat(habits).filter(x=>{
        const key=execKey(x.ref);if(seen.has(key))return false;seen.add(key);return true;
      });
      return {list,rows};
    });
    const html='<div class="mw-exec-picker-tabs" role="group" aria-label="任务栏目">'+groups.map((g,i)=>'<button type="button" class="btn" data-exec-tab="'+g.list+'" aria-pressed="'+(i===0)+'">'+esc(names[g.list])+'</button>').join('')+'</div>'+
      '<div class="mw-exec-picker-grid">'+groups.map((g,i)=>
        '<section class="mw-exec-picker-column'+(i===0?' is-active':'')+'" data-exec-column="'+g.list+'" data-category="'+g.list+'"><h3>'+esc(names[g.list])+' <small>'+g.rows.length+'</small></h3>'+
        (g.rows.map(x=>{
          const already=selected.has(execKey(x.ref)),isHabit=x.ref.kind==='checkin';
          const subtitle=isHabit?'习惯 · '+x.habit.count+'/'+x.habit.target+' 次':x.ref.kind==='project'?'每日推进':x.ref.kind==='daily'?'基础任务':'任务';
          return '<label class="mw-exec-candidate'+(already?' is-added':'')+'" title="'+esc(x.task.text)+'"><input type="checkbox" data-exec-pick value="'+esc(JSON.stringify(x.ref))+'" aria-label="选择：'+esc(x.task.text)+'"'+(already?' disabled':'')+'><span class="mw-exec-candidate-body"><strong>'+esc(x.task.text)+'</strong><small>'+esc(already?'已入队':subtitle)+'</small></span></label>';
        }).join('')||'<p class="mw-exec-picker-empty">暂无可加入项目</p>')+'</section>').join('')+'</div>';
    const modal=A.ui.openModal('添加到执行队列','<p class="hint">从 '+esc(taskDay)+' 的三栏选择。习惯按本用户日加入，原安排和积分不变。</p><div class="mw-exec-picker">'+html+'</div><p id="mw-exec-selected" role="status">已选择 0 项</p><p id="mw-exec-error" role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">加入选中任务</button>',{lock:true});
    const count=()=>modal.querySelector('#mw-exec-selected').textContent='已选择 '+modal.querySelectorAll('[data-exec-pick]:checked').length+' 项';
    modal.addEventListener('change',count);count();
    modal.querySelectorAll('[data-exec-tab]').forEach(tab=>tab.onclick=()=>{
      modal.querySelectorAll('[data-exec-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x===tab)));
      modal.querySelectorAll('[data-exec-column]').forEach(x=>x.classList.toggle('is-active',x.dataset.execColumn===tab.dataset.execTab));
    });
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:async b=>{
      const refs=[...modal.querySelectorAll('[data-exec-pick]:checked')].map(el=>JSON.parse(el.value));
      if(!refs.length){modal.querySelector('#mw-exec-error').textContent='请至少选择一项';return;}
      b.disabled=true;
      try{if(await commit(()=>execAppend(refs)))A.ui.closeModal();}
      catch(e){modal.querySelector('#mw-exec-error').textContent=e.message;}
      finally{if(b.isConnected)b.disabled=A.memoActions.busy();}
    }});
  }
  function execMenu(ref){
    const current=execEntries().find(e=>{const x=execResolve(e);return x&&execKey(x.ref)===execKey(ref);});
    const found=current&&execResolve(current);if(!found)return A.ui.toast('该任务已移出队列');
    const habit=ref.kind==='checkin',actions=[
      ['pin',current.pinned?'取消置顶':'置顶'],['up','上移'],['down','下移'],['tail','移至队尾'],
      ['edit',habit?'调整习惯安排':'编辑任务'],['delete',habit?'':'删除原任务']
    ].filter(x=>x[1]);
    const modal=A.ui.openModal('队列操作 · '+found.task.text,
      '<div class="mw-exec-menu-list">'+actions.map(([act,label])=>'<button type="button" class="btn mw-exec-menu-action'+(act==='delete'?' is-danger':'')+'" data-exec-action="'+act+'">'+esc(label)+'</button>').join('')+'</div><p id="mw-exec-menu-error" role="alert"></p>',
      '<button class="btn" data-act="close">关闭</button>',{lock:true});
    A.ui.bindActions({close:()=>{if(!A.memoActions.busy())A.ui.closeModal();}});
    modal.querySelectorAll('[data-exec-action]').forEach(b=>b.onclick=async()=>{
      if(A.memoActions.busy())return;b.disabled=true;
      const act=b.dataset.execAction;
      try{
        if(['pin','up','down','tail'].includes(act)){if(await execMove(ref,act))A.ui.closeModal();}
        else {A.ui.closeModal();if(habit)A.memoFinance.arrange(ref.id);else if(act==='edit')editor(ref);else A.memoActions.deleteTask(ref);}
      }catch(e){if(modal.isConnected)modal.querySelector('#mw-exec-menu-error').textContent=e.message;else A.ui.toast(e.message);}
      finally{if(b.isConnected)b.disabled=false;}
    });
  }
  function execHTML(){
    const rows=execEntries().map(e=>({entry:e,found:execResolve(e)})).filter(x=>x.found&&!doneFor(x.found.task,x.found.ref));
    const visible=execExpanded?rows:rows.slice(0,5);
    const renderItem=({entry,found},i)=>{
      const ref=found.ref,attr=refAttrs(ref),isHabit=ref.kind==='checkin';
      const category=isHabit?(A.memoFinance?.plans(ref.day).find(p=>p.it.id===ref.id)?.r.list||'extra'):ref.list||found.task.assignment?.list||((ref.kind==='project'||ref.kind==='daily')?found.task.memoCategoryDays?.[ref.day]||'extra':'queue');
      const session=A.memoSchedule.timing(ref).session;
      const live=session?.status==='running'?' · 执行中':session?.status==='paused'?' · 暂停中':'';
      const current=queueExecution?.key===execKey(ref);
      return '<div class="mw-exec-item" data-category="'+esc(category)+'"><i class="mw-exec-color" aria-hidden="true"></i><div class="mw-exec-info"><strong>'+(entry.pinned?'📌 ':'')+(i+1)+'. '+esc(found.task.text)+'</strong><small>'+esc(names[category]||'待安排')+(isHabit?' · 习惯':'')+(current?' · 当前计时':'')+live+(ref.day?' · '+esc(ref.day):'')+'</small></div><div class="mw-exec-actions"><button type="button" class="btn btn-small" data-schedule-command="start" data-schedule-ref="'+esc(JSON.stringify(ref))+'"'+(session?.status==='paused'?' data-session-id="'+esc(session.id)+'"':'')+(session?.status==='running'?' disabled aria-label="正在计时"':'')+'>▶ 开始／继续</button>'+(isHabit?button('exec-checkin','打卡',attr):button('exec-complete','完成',attr))+button('exec-skip','跳过',attr)+'</div>'+button('exec-menu','⋯',attr+' aria-label="队列操作：'+esc(found.task.text)+'"')+'</div>';
    };
    return '<section class="card mw-exec-board" aria-label="执行队列"><div class="mw-exec-head"><h2>执行队列 <small>· '+rows.length+' 项'+(queueExecution?' · '+(currentQueueSession()?.status==='paused'?'已暂停':'连续计时中'):'')+'</small></h2>'+button('search','检索任务','aria-label="检索任务"')+button('exec-pick','＋ 添加任务')+'</div>'+(rows.length?visible.map(renderItem).join(''):'<p class="hint">尚无执行队列任务。可从三栏加入，不改变原安排。</p>')+(rows.length>5?button('exec-expand',execExpanded?'收起':'展开其余 '+(rows.length-5)+' 项'):'')+'</section>';
  }

  async function commit(fn, retry = false) { if (A.memoActions.busy() && !retry) { A.ui.toast('请先重试保存当前操作'); return false; } try { if (await A.memoActions.commit(fn)) { $('mw-error').textContent = ''; render(); A.app.refreshStats(); A.memoSchedule.render(); return true; } }
    catch (e) { A.ui.toast(e.message); $('mw-error').textContent = e.message; const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重试保存'; retry.onclick = () => commit(() => {}, true); $('mw-error').appendChild(retry); } return false; }
  function refAttrs(ref) { return 'data-ref="' + esc(JSON.stringify(ref)) + '"'; }
  function doneFor(t, ref) { return ['project', 'daily'].includes(ref.kind) ? !!t.days?.[ref.day] : ref.kind === 'queue' ? !!(t.doneAt || t.doneDay) : !!t.done; }
  function priorityWeight(task) {
    const n=Number(task?.priorityWeight);
    return Number.isInteger(n)&&n>=1&&n<=5?n:3;
  }
  function priorityLabel(task) { return ['','较低','次要','正常','重要','最重要'][priorityWeight(task)]; }
  function card(t, ref, options = {}) {
    const done = doneFor(t, ref), attrs = refAttrs(ref);
    const points = score(t,ref), category = ref.list || t.assignment?.list || (ref.kind === 'project' ? t.memoCategoryDays?.[ref.day]||'extra' : 'queue');
    return '<article class="mw-task' + (done ? ' mw-done' : '') + '" data-mw-card data-carried="'+!!A.memoFlow.isCarried(t)+'" data-category="'+category+'" data-bounty="'+!!A.memoOrganize?.bounty(points)+'" data-score="'+scoreBand(points)+'" data-priority="'+(category==='required'?priorityWeight(t):'')+'" data-bounty-tier="'+(A.memoOrganize?.bountyTier(points)||'none')+'" ' + attrs + '><div class="mw-task-heading">' + button('complete', done ? '✓' : '○', attrs + ' aria-label="' + (done ? '取消完成：' : '完成：') + esc(t.text) + '" aria-pressed="' + done + '"') + '<div class="mw-task-title"><strong>' + esc(t.text) + '</strong>' + scoreHTML(points) + '<div class="mw-task-meta">' + (category==='required'&&priorityWeight(t)!==3?'<small class="mw-priority-note">优先 '+priorityWeight(t)+' · '+priorityLabel(t)+'</small>':'') + (ref.kind === 'queue' ? '<span>' + (t.pinned ? '置顶 · ' : '') + (options.number ? '第' + options.number + '项' : '已安排') + '</span>' : ref.kind === 'project' ? '<span>每日推进 · ' + esc(ref.day) + '</span>' : '') + (A.memoReview?.label(t)||'')+(A.memoRecurrence?.label(t)||'')+'</div></div>' + button('edit', '编辑', attrs + ' aria-label="编辑：' + esc(t.text) + '"') + '</div><div class="mw-task-timing">' + A.memoSchedule.rowControls(ref) + '</div>' +
      (true ? '<details class="mw-task-extras"><summary>更多操作</summary><div class="mw-task-secondary">' + (['task','queue'].includes(ref.kind) && (!done || t.overdueEventId) ? button('assign', done ? '安排与扣分记录' : ref.kind === 'queue' ? (t.assignment ? '调整今日安排' : '安排到今天') : '调整安排', attrs) : '') + (!done && ['task','queue'].includes(ref.kind) && (t.originalDay || (t.assignment?.day || ref.day) < M().userDay()) ? button('backfill', '补记完成', attrs) : '') + (A.memoFlow.isCarried(t) ? '<details class="mw-late-detail"><summary>顺延记录</summary><small>' + esc(A.memoFlow.lateLabel(t)) + '</small></details>' : '') + (t.assignment ? '<small>' + esc(t.assignment.day + ' · ' + names[t.assignment.list]) + '</small>' : '') + (done?A.memoSchedule.executionHTML((S().data().memoEvents||[]).find(e=>e.active&&e.kind===ref.kind&&e.sourceId===ref.id&&(ref.kind==='queue'||e.sourceDay===ref.day))?.timing):'') + (t.note ? '<details class="mw-note"><summary>备注</summary><p>' + esc(t.note) + '</p></details>' : '') + (options.reorder ? '<details class="mw-manage"><summary>更多操作</summary><div>' + button('pin', t.pinned ? '取消置顶' : '置顶', attrs) + button('up', '上移', attrs) + button('down', '下移', attrs) + '</div></details>' : '') + '</div></details>' : '') + '</article>';
  }
  function taskSection(items) {
    const open = items.filter(x => !doneFor(x.task, x.ref)), done = items.filter(x => doneFor(x.task, x.ref));
    return open.map(x => card(x.task, x.ref)).join('') + (!open.length ? '<p class="hint mw-empty">暂无未完成任务</p>' : '') + (done.length ? '<details class="mw-completed"><summary>已完成（' + done.length + '）</summary>' + done.map(x => card(x.task, x.ref)).join('') + '</details>' : '');
  }
  function score(t,ref){if((ref.list==='required'||t.assignment?.list==='required')&&!['project','daily'].includes(ref.kind))return null;if(ref.kind==='project')return Math.max(0,Number(t.points)||0);return Math.max(0,Number(t.points??(ref.kind==='queue'?S().settings().queuePoints??5:ref.list==='ideal'?S().settings().idealPoints??1:S().settings().extPoints??5))||0);}
  function scoreHTML(n){return n===null?'':(A.memoOrganize?.badge(n)||'')+'<small class="mw-score">+'+esc(n)+'分</small>';}
  function scoreBand(n){return n===null?'group':n===0?'zero':n<5?'low':n<10?'medium':'high';}
  function taskItems(day,list){
    return A.memoSchedule.columnItems(day,list).concat((A.memoFlow.deferred?.(day,list)||[]).filter(x=>x.automatic)).map((x,i)=>({x,i})).sort((a,b)=>Number(a.x.done)-Number(b.x.done)||(!a.x.done&&!a.x.deferred&&!b.x.deferred&&list==='required'?priorityWeight(b.x.task)-priorityWeight(a.x.task):0)||(!a.x.done&&list!=='required'?score(b.x.task,b.x.ref)-score(a.x.task,a.x.ref):0)||a.i-b.i).map(v=>v.x);
  }
  function deferredHTML(x,compact=false){
    const t=x.task,current=A.memoSchedule.find(x.currentRef),attrs='data-deferred-source="'+esc(JSON.stringify(x.ref))+'"';
    return '<article class="'+(compact?'cal-task':'mw-task')+' mw-deferred" '+attrs+'><strong>'+esc(t.text)+'</strong><small class="mw-deferred-status">'+esc((current?.backfillDay&&((current.done||current.doneAt)))?'已补记完成至'+current.backfillDay+' · 原安排结束':(current?.memoAutoCarry||t.memoAutoCarry)?'已顺延至'+x.toDay+' · 原安排结束':'已改期至'+x.toDay+' · 原安排结束')+'</small>'+(x.legacy?'<small>旧延期记录，内容按现存记录展示</small>':'')+
      (!x.legacy?(t.subs||[]).concat((t.groups||[]).flatMap(g=>g.subs||[])).map(s=>'<small>'+esc((s.done===true?'✓ ':'○ ')+s.text)+'</small>').join(''):'')+
      (!compact&&t.note?'<details><summary>当时备注</summary><p>'+esc(t.note)+'</p></details>':'')+
      (current?'<div class="mw-deferred-actions"><button class="btn btn-small" data-deferred-open="'+esc(JSON.stringify(x.currentRef))+'">查看当前任务</button>'+(!current.done&&!current.doneAt?'<button class="btn btn-small" data-deferred-day="'+esc(x.ref.day)+'" data-deferred-backfill="'+esc(JSON.stringify(x.currentRef))+'">补记本日完成</button><button class="btn btn-small" data-deferred-assign="'+esc(JSON.stringify(x.currentRef))+'">调整安排</button>':'')+'</div>':'')+'</article>';
  }
  function openDeferred(ref){const t=A.memoSchedule.find(ref),day=ref.day||t?.assignment?.day;if(day){taskDay=day;pane='today';render();}else showPane('queue');}
  // Calendar's original compact columns and row markup, without mutation controls.
  function overviewHTML(day){
    const dt=new Date(day+'T12:00:00+08:00'),wd=['日','一','二','三','四','五','六'][dt.getUTCDay()];
    let html='<section class="card mw-overview"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">🗓 '+Number(day.slice(5,7))+'月'+Number(day.slice(8))+'日 周'+wd+'</h3></div><div class="cal-cols" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    [['required','✅ 必须'],['ideal','⭐ 理想'],['extra','🌱 拓展']].forEach(([list,name])=>{
      const items=taskItems(day,list),progress=A.memoFinance.column(day,list);
      html+='<div class="cal-col" data-overview-list="'+list+'" tabindex="0" role="group" aria-label="'+names[list]+'，点击空白添加任务" style="border:1px solid var(--line);border-radius:10px;padding:9px 10px"><div class="cal-col-head" style="font-size:13px;font-weight:700;margin-bottom:6px">'+name+' <span class="mw-column-count">'+progress.label+'</span></div><div class="mw-column-meter" role="img" aria-label="'+esc(names[list]+'：'+progress.label+'，未完成延期'+progress.deferred+'项；'+progress.segments.map(x=>x.label+x.count+'项').join('，'))+'">'+progress.segments.map(x=>'<span class="mw-column-'+x.state+'" data-progress-state="'+x.state+'" style="width:'+x.percent+'%" aria-hidden="true"></span>').join('')+'</div>'+(progress.supervision?'<small class="mw-column-extra">监督 '+progress.supervision+'项</small>':'');
      function rows(items){let html='';items.forEach(x=>{if(x.deferred){html+=deferredHTML(x,true);return;}const {task:t,ref}=x;
        html+='<div class="cal-task'+(doneFor(t,ref)?' done':'')+'" data-carried="'+!!A.memoFlow.isCarried(t)+'" data-category="'+list+'" data-bounty="'+!!A.memoOrganize?.bounty(score(t,ref))+'" data-score="'+scoreBand(score(t,ref))+'" data-priority="'+(list==='required'?priorityWeight(t):'')+'" data-bounty-tier="'+(A.memoOrganize?.bountyTier(score(t,ref))||'none')+'" data-overview-ref="'+esc(JSON.stringify(ref))+'" tabindex="0" role="button" aria-label="打开任务：'+esc(t.text+(A.memoFlow.isCarried(t)?'，逾期顺延':'')+(score(t,ref)!==null?'，'+score(t,ref)+'分':''))+'" style="border-bottom:1px dashed var(--line);padding:6px 2px"><span class="t-text" title="'+esc(t.text)+'" style="font-size:13.5px;word-break:break-all"><span class="ov-task-name">'+esc(t.text)+(doneFor(t,ref)?' ✓':'')+'</span>'+scoreHTML(score(t,ref))+(A.tasks?.carryTagHTML?.(t)||'')+(A.tasks?.lecTagHTML?.(t)||'')+(A.memoReview?.label(t)||'')+(A.memoRecurrence?.label(t)||'')+'</span>';
        if(t.standard)html+='<div class="t-std" style="font-size:11.5px;color:#f59e0b;margin-top:2px">📌 标准：'+esc(t.standard)+'</div>';
        (t.groups||[]).forEach(g=>{const subs=g.subs||[];html+='<div class="t-ctx grp">🧩 '+esc(g.name||'任务组')+(subs.length?'（'+subs.filter(x=>x.done===true).length+'/'+subs.length+'）':'')+'</div>';subs.forEach(x=>{html+='<div class="t-ctx sub"><span>· '+esc(x.text)+(x.done===true?' ✓':x.done===false?' ✗':'')+'</span></div>';});});
        (t.subs||[]).forEach(x=>{html+='<div class="t-ctx sub"><span>· '+esc(x.text)+'（限'+esc(x.minutes)+'分）'+(x.done===true?' ✓':x.done===false?' ✗':'')+'</span></div>';});
        html+='</div>';
      });return html;}const open=items.filter(x=>!doneFor(x.task,x.ref)),done=items.filter(x=>doneFor(x.task,x.ref));html+=(list==='extra'&&A.memoOrganize?A.memoOrganize.grouped(open,rows,true):rows(open))+(A.memoFinance?.planned(day,list,false)||'');html+=A.memoOrganize?.fold('overview:'+day+':'+list,rows(done),done.length)||'';if(list==='required')html+=A.memoGoals?.html(day,true)||'';html+='</div>';
    });return html+'</div></section>';
  }
  function overviewClick(e,day){
    const goal=e.target.closest('[data-goal]');if(goal){e.preventDefault();e.stopImmediatePropagation();return A.memoGoals.editor(goal.dataset.goal);}
    if(e.target.closest('[data-goal-group]'))return;
    if(e.target.closest('[data-deferred-source]'))return;
    const quick=e.target.closest('[data-mw="exec-add"]');if(quick){e.preventDefault();e.stopImmediatePropagation();return execAdd(JSON.parse(quick.dataset.ref));}
    if(e.target.closest('summary,button,input,select,a'))return;if(window.getSelection()?.toString())return;
    const task=e.target.closest('[data-overview-ref]'),col=e.target.closest('[data-overview-list]');if(!col)return;
    e.preventDefault();e.stopImmediatePropagation();if(task)complete(JSON.parse(task.dataset.overviewRef));else{taskDay=day;const group=e.target.closest('[data-family-id]');if(group)A.memoOrganize.add(group.dataset.familyId);else editor(null,col.dataset.overviewList);}
  }
  function categoryBody(items,day,list){const open=items.filter(x=>x.deferred||!doneFor(x.task,x.ref)),done=items.filter(x=>!x.deferred&&doneFor(x.task,x.ref)),renderItem=x=>x.deferred?deferredHTML(x):card(x.task,x.ref);return (list==='extra'&&A.memoOrganize?A.memoOrganize.grouped(open,rows=>rows.map(renderItem).join('')):open.map(renderItem).join(''))+(A.memoFinance?.planned(day,list,false)||'')+(A.memoOrganize?.fold('full:'+day+':'+list,done.map(x=>'<small>'+esc((S().data().memoTaskGroups||[]).find(g=>g.id===x.task.memoGroup)?.name||'')+'</small>'+card(x.task,x.ref)).join(''),done.length)||'');}

  function inlineWaiting(){
    const waiting=sortedQueue().filter(t=>!t.assignment&&!t.memoDismissed&&!t.archived&&!A.memoReview?.hidden(t,t.assignment?.list));
    const pending=pendingRows(),visible=waiting.slice(0,5);
    return '<section class="card mw-inline-waiting" aria-label="待安排任务"><div class="mw-group-head"><h2>待安排任务 <small>· '+waiting.length+' 项</small></h2>'+button('add-queue','＋ 添加任务','',true)+'</div>'+
      (waiting.length?'<div class="mw-queue-grid">'+visible.map(waitingRow).join('')+'</div>':'<p class="hint">没有待安排的队列任务</p>')+
      (waiting.length>5?'<p class="hint">当前显示前 5 项</p>':'')+
      (pending.length?'<details class="mw-pending-inline"><summary>往日需要重新安排（'+pending.length+'）</summary>'+pendingHTML()+'</details>':'')+
      '<button class="btn btn-small" data-mw="open-queue">查看完整待安排管理</button></section>';
  }

  // Local read-only search: stable task identities; review rounds stay grouped by series.
  function taskSearch(){
    const d=S().data(),rows=[],add=(type,id,title,note,status,date,ref,detail='',keywords='')=>rows.push({type,id,title:String(title||''),note:String(note||''),status,date:date||'',ref,detail,keywords});
    const recurrence=d.memoRecurrence||{series:[],occurrences:[]};
    const occurrenceById=new Map((recurrence.occurrences||[]).map(o=>[o.id,o]));
    const validSeries=new Set((recurrence.series||[]).map(s=>s.id));
    const linkedOccurrence=id=>{const o=occurrenceById.get(id);return !!(o&&validSeries.has(o.seriesId));};
    Object.entries(d.days||{}).forEach(([day,data])=>['required','ideal','extra'].forEach(list=>(data.tasks?.[list]||[]).forEach(t=>{
      if(t.fromQueue||t.fromDaily||t.memoProjectId||t.memoMovedTo||t.memoReviewRoundId||t.memoOccurrenceId&&linkedOccurrence(t.memoOccurrenceId))return;
      add('task',t.id,t.text,t.note,t.memoDismissed?'archived':t.done?'done':'pending',day,{kind:'task',id:t.id,day,list},names[list]);
    })));
    (d.queue||[]).concat(d.queueDone||[]).forEach(t=>{
      if(t.memoReviewRoundId||t.memoOccurrenceId&&linkedOccurrence(t.memoOccurrenceId))return;
      add('task',t.id,t.text,t.note,t.archived||t.memoDismissed?'archived':t.doneAt||t.doneDay?'done':'pending',t.assignment?.day||t.doneDay||'',{kind:'queue',id:t.id},t.assignment?names[t.assignment.list]:'待安排');
    });
    (d.memoReview?.series||[]).forEach(series=>{
      const rs=(d.memoReview.rounds||[]).filter(r=>r.seriesId===series.id).sort((a,b)=>a.n-b.n);
      const status=series.stoppedAt||series.paused?'archived':rs.length&&rs.every(r=>r.status==='done')?'done':'pending';
      const next=rs.find(r=>r.status==='pending');
      const minutesText=n=>n<60?n+'分钟':n%1440===0?n/1440+'天':n%60===0?n/60+'小时':n+'分钟';
      const rule=(series.intervals||[]).length?series.intervals.map(minutesText).join(' → '):'手动安排';
      const history=(d.memoReview?.rounds||[]).filter(r=>r.seriesId===series.id).map(r=>{
        const current=r.taskRef&&A.memoSchedule?.resolve(r.taskRef);
        const original=r.taskRef?.kind==='task'?Object.values(d.days?.[r.taskRef.day]?.tasks||{}).flat().find(t=>t.id===r.taskRef.id):null;
        return [current?.task?.text,current?.task?.note,original?.text,original?.note].filter(Boolean).join(' ');
      }).join(' ');
      add('review',series.id,series.text,series.note,status,next?.due?M().userDay(next.due):'',null,'间隔复习 · '+rule+' · 已有'+rs.length+'轮',history);
    });
    (recurrence.series||[]).forEach(series=>{
      const today=M().userDay(),revisions=Array.isArray(series.revisions)?series.revisions:[];
      const current=A.memoRecurrence?.config(series,today)||revisions.at(-1);
      if(!current)return;
      const history=(recurrence.occurrences||[]).filter(o=>o.seriesId===series.id);
      const pending=history.filter(o=>o.status==='pending').sort((a,b)=>a.day.localeCompare(b.day));
      const expected=!series.paused&&!series.stoppedAt?A.memoRecurrence?.nextDue(series,today):null;
      const rule=A.memoRecurrence?.ruleText?.(current.rule)||'周期未定义';
      const detail=(series.reviewMode?'持续周期复习':'周期任务')+' · '+rule+
        (pending.length?' · 待做 '+pending.length+'期':expected?' · 预计下次 '+expected:'');
      const historyTerms=history.map(o=>{
        const found=A.memoRecurrence?.taskOf(o);
        const archived=o.taskRef?.kind==='task'?Object.values(d.days?.[o.taskRef.day]?.tasks||{}).flat().find(t=>t.memoOccurrenceId===o.id):null;
        return [found?.task?.text,found?.task?.note,archived?.text,archived?.note,o.day].filter(Boolean).join(' ');
      });
      const keywords=revisions.map(x=>[x.text,x.note].filter(Boolean).join(' ')).concat(historyTerms).join(' ');
      add('cycle',series.id,current.text,current.note,series.stoppedAt||series.paused?'archived':'pending',pending[0]?.day||expected||'',null,detail,keywords);
    });
    (d.checkins||[]).forEach(t=>add('checkin',t.id,t.text,t.note,t.archived?'archived':'pending','',null,'习惯'));
    (d.memoProjects||[]).forEach(t=>add('project',t.id,t.text,t.note,t.archived?'archived':'pending','',null,'长期项目'));
    (d.daily||[]).forEach(t=>add('project',t.id,t.text,t.note,t.archived?'archived':'pending','',null,'基础任务'));
    (d.memoDeleted||[]).filter(x=>!x.restored).forEach(x=>add('deleted',x.id,x.payload?.text||'已删除任务','', 'archived',M().userDay(x.at),null,'删除记录'));
    const m=A.ui.openModal('检索任务','<label>搜索名称或备注<input id="mw-search-text" type="search" autocomplete="off" placeholder="输入任务、复习名称……"></label><div class="schedule-fields"><label>类型<select id="mw-search-type"><option value="">全部</option><option value="task">普通任务</option><option value="review">间隔复习</option><option value="cycle">周期任务与持续复习</option><option value="checkin">习惯</option><option value="project">长期项目与基础任务</option><option value="deleted">已删除</option></select></label><label>状态<select id="mw-search-status"><option value="">全部状态</option><option value="pending">未完成</option><option value="done">已完成</option><option value="archived">暂停或停用</option></select></label></div><p id="mw-search-count" class="hint"></p><div id="mw-search-results" class="mw-queue-grid" style="max-height:55vh;overflow-y:auto"></div>','<button class="btn" data-act="cancel">关闭</button>');
    const q=x=>m.querySelector(x),input=q('#mw-search-text'),type=q('#mw-search-type'),status=q('#mw-search-status');
    function draw(){
      const term=input.value.trim().toLocaleLowerCase(),filtered=term?rows.filter(x=>(!type.value||x.type===type.value)&&(!status.value||x.status===status.value)&&[x.title,x.note,x.detail,x.keywords].join(' ').toLocaleLowerCase().includes(term)):[];
      filtered.sort((a,b)=>Number(a.status!=='pending')-Number(b.status!=='pending')||b.date.localeCompare(a.date));
      q('#mw-search-count').textContent=term?'找到 '+filtered.length+' 条结果'+(filtered.length>60?'，显示前60条':''):'输入关键词开始检索';
      q('#mw-search-results').innerHTML=filtered.slice(0,60).map(x=>'<button type="button" class="btn mw-history-row" data-search-type="'+esc(x.type)+'" data-search-id="'+esc(x.id)+'" style="display:block;text-align:left;width:100%;white-space:normal"><strong>'+esc(x.title)+'</strong><small style="display:block">'+esc(({task:'普通任务',review:'间隔复习',cycle:'周期任务',checkin:'习惯',project:'项目',deleted:'已删除'})[x.type]+' · '+({pending:'未完成',done:'已完成',archived:'已停用或暂停'})[x.status]+(x.date?' · '+x.date:'')+(x.detail?' · '+x.detail:''))+'</small></button>').join('')||(term?'<p class="hint">没有匹配结果</p>':'');
    }
    input.addEventListener('input',draw);type.addEventListener('change',draw);status.addEventListener('change',draw);
    q('#mw-search-results').addEventListener('click',e=>{
      const button=e.target.closest('[data-search-type]');if(!button)return;
      const x=rows.find(x=>x.type===button.dataset.searchType&&x.id===button.dataset.searchId);if(!x)return;
      A.ui.closeModal();
      if(x.type==='review')return A.memoReview?.manage(x.id);
      if(x.type==='cycle')return A.memoRecurrence?.manage(x.id);
      if(x.type==='deleted')return A.memoActions.trash();
      if(x.type==='checkin'){A.app.switchView('checkin');return;}
      if(x.type==='project'){A.app.switchView('tasks');showPane('details');return;}
      const found=A.memoSchedule.resolve(x.ref);if(!found)return A.ui.toast('任务关联已变化，请重新搜索');
      const date=found.ref.day||found.task.assignment?.day;
      A.app.switchView('tasks');
      if(date)setDay(date);else showPane('queue');
      editor(found.ref);
    });
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();}});
    input.focus();
  }
  function claimDayRewards(){
    const day=taskDay||M().userDay(),open=A.memoActions.availableRewards(day);
    if(!open.length)return A.ui.toast('当天没有待领取的整组奖励');
    const m=A.ui.openModal('领取整组奖励 · '+day,'<p class="hint">按当前有效目标判断，已领取的奖励不能重复领取。</p>'+open.map(x=>'<label><input type="checkbox" data-claim-kind="'+x.kind+'" checked> '+esc(x.label)+' <input type="number" data-claim-points="'+x.kind+'" min="0.01" step="0.01" value="'+(x.points||'')+'" placeholder="积分"></label>').join('')+'<p id="mw-claim-error" role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="claim">确认领取</button>',{lock:true});
    let saving=false;
    A.ui.bindActions({cancel:()=>{if(!saving&&!A.memoActions.busy())A.ui.closeModal();},claim:async b=>{
      if(saving||A.memoActions.busy())return;saving=true;b.disabled=true;
      try{const choices=[...m.querySelectorAll('[data-claim-kind]:checked')].map(c=>({kind:c.dataset.claimKind,points:m.querySelector('[data-claim-points="'+c.dataset.claimKind+'"]').value}));if(!choices.length)throw Error('请勾选要领取的奖励');if(await A.memoActions.commit(()=>A.memoActions.claimRewardsCore(day,choices))){A.ui.closeModal();render();A.ui.toast('整组奖励已领取');}}
      catch(e){m.querySelector('#mw-claim-error').textContent=e.message;}finally{saving=false;b.disabled=false;}
    }});
  }
  function renderTasks() {
    taskDay = taskDay || M().userDay();
    if(A.memoRecurrence?.needsDay(taskDay)&&!A.memoActions.busy()){
      const requestedDay=taskDay;commit(()=>A.memoRecurrence.ensureCore(requestedDay));return;
    }
    const root=$('mw-today');
    root.innerHTML=execHTML()+(A.framework?'<div data-framework-overview></div>':overviewHTML(taskDay))+(A.memoFinance&&A.memoActions.availableRewards(taskDay).length?'<section class="mw-reward-claim">'+button('claim-rewards','领取已达成的整组奖励')+'</section>':'')+(A.ms?.compactHTML?.()||'')+(A.memoGantt?.html()||'')+inlineWaiting();
    if(A.framework)A.framework.overview(root.querySelector('[data-framework-overview]'),taskDay);
    A.ms?.refresh();
  }
  function setDay(day) {
    if(!M().validDate(day))return;
    taskDay=day;positions.today=0;pane='today';render();
  }
  function renderDetails() {
    const root=$('mw-details');if(!root)return;
    root.innerHTML='<h2>详细任务管理 · '+esc(taskDay)+'</h2><div class="mw-full-list">' + ['required', 'ideal', 'extra'].map(list => {
      const items = taskItems(taskDay,list);
      return '<section class="mw-group" id="mw-column-'+list+'"><div class="mw-group-head"><h2>' + names[list] + '<small> · 待做 ' + (items.filter(x => !x.deferred&&!doneFor(x.task, x.ref)).length+(A.memoFinance?.plans(taskDay).filter(x=>x.r.list===list&&A.memoPenalty?.policy(x.it,taskDay).mode!=='punch'&&x.n<x.r.target).length||0)) + ((A.memoFinance?.plans(taskDay).filter(x=>x.r.list===list&&A.memoPenalty?.policy(x.it,taskDay).mode==='punch').length||0)?' · 监督 '+A.memoFinance.plans(taskDay).filter(x=>x.r.list===list&&A.memoPenalty?.policy(x.it,taskDay).mode==='punch').length:'') + '</small></h2>' + button('add-' + list, '＋ 添加', 'aria-label="添加' + names[list] + '"') + '</div>' + categoryBody(items,taskDay,list) + (list==='required'?(A.memoGoals?.html(taskDay,false)||''):'') + (list === 'extra' ? (A.memoRecurrence?.registry()||'')+(A.memoReview?.registry()||'')+'<details class="mw-project-help"><summary>项目说明与已停用项目</summary><p class="hint">长期拓展是三栏分类；长期项目是持续任务实体；积分习惯仅为安排引用，不会生成第二条积分任务。一次性任务保留日期，每日推进项目可以停用。</p>' + (S().data().daily || []).filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-daily', '恢复基础任务', refAttrs({ kind: 'daily', id: p.id })) + '</p>').join('') + projects().filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-project', '恢复项目', refAttrs({ kind: 'project', id: p.id })) + '</p>').join('') + '</details>' : '') + '</section>';
    }).join('') + '</div>';
  }
  function renderLegacy() {
    const root=$('mw-legacy');if(!root)return;
    const day=taskDay||M().userDay();
    const old=(S().data().daily||[]).filter(t=>!t.archived&&!t.memoCategoryDays?.[day]);
    const archivedDaily=(S().data().daily||[]).filter(t=>t.archived);
    const archivedProjects=projects().filter(t=>t.archived);
    root.innerHTML='<h2>基础任务与归档</h2>'+
      '<p class="hint">旧基础任务未删除；可在这里管理，已安排到三栏的任务继续在三栏操作。</p>'+
      (old.length?taskSection(old.map(task=>({task,ref:{kind:"daily",id:task.id,day}}))):'<p class="hint">暂无未分类基础任务</p>')+
      '<details><summary>已停用基础任务（'+archivedDaily.length+'）</summary>'+
      archivedDaily.map(t=>'<p>'+esc(t.text)+button('restore-daily','恢复基础任务',refAttrs({kind:'daily',id:t.id}))+'</p>').join('')+
      '</details><details><summary>已停用长期项目（'+archivedProjects.length+'）</summary>'+
      archivedProjects.map(t=>'<p>'+esc(t.text)+button('restore-project','恢复项目',refAttrs({kind:'project',id:t.id}))+'</p>').join('')+'</details>';
  }
  function renderQueue() {
    const all = sortedQueue().filter(t=>!t.memoDismissed&&!A.memoReview?.hidden(t,t.assignment?.list)), q = all.filter(t => !t.assignment), assigned = all.filter(t => t.assignment), done = S().data().queueDone || [];
    $('mw-queue').innerHTML = '<section class="mw-waiting-section"><h2>需要重新安排</h2>'+pendingHTML()+'</section><section class="mw-waiting-section"><div class="mw-group-head"><h2>尚未安排</h2>' + button('add-queue', '＋ 添加任务', '', true) + '</div><div class="mw-queue-grid">' + q.map(waitingRow).join('') + '</div>' + (!q.length ? '<p class="hint">添加准备做的任务，再安排顺序。</p>' : '') + (assigned.filter(t=>t.assignment.day>=M().userDay()).length ? '<details class="mw-assigned"><summary>已安排（' + assigned.filter(t=>t.assignment.day>=M().userDay()).length + '）</summary>' + assigned.filter(t=>t.assignment.day>=M().userDay()).map(t => card(t, { kind: 'queue', id: t.id }, { number: '已安排', reorder: true })).join('') + '</details>' : '') + '<details><summary>已完成（' + done.length + '）</summary>' + done.slice(0, 100).map(t => card(t, { kind: 'queue', id: t.id }, { number: '已完成' })).join('') + '</details></section>';
  }
  function preserve(renderFn) {
    const root = $(pane === 'queue' ? 'mw-queue' : 'mw-today'), disclosures = new Set();
    const detailKey = el => el.dataset.foldKey||el.dataset.family||(el.closest('[data-ref]')?.dataset.ref || root?.id) + ':' + (el.classList.contains('mw-completed') ? el.closest('.mw-group')?.querySelector('h2')?.textContent.replace(/ · 待做.*/, '') : el.querySelector('summary')?.textContent);
    root?.querySelectorAll('details[open]').forEach(el => disclosures.add(detailKey(el)));
    const anchor = [...(root?.querySelectorAll('[data-mw-card],.mw-history-row[data-ref]') || [])].find(el => el.getBoundingClientRect().bottom > 0), ref = anchor?.dataset.ref, offset = anchor?.getBoundingClientRect().top;
    renderFn();
    root?.querySelectorAll('details').forEach(el => { if (disclosures.has(detailKey(el))) el.open = true; });
    if (ref && document.body.dataset.view === 'tasks' && pane !== 'timeline') requestAnimationFrame(() => { const next = [...root.querySelectorAll('[data-mw-card],.mw-history-row[data-ref]')].find(el => el.dataset.ref === ref); if (next) window.scrollBy(0, next.getBoundingClientRect().top - offset); });
  }
  function renderReviews() { $('mw-reviews').innerHTML = (A.memoReview?.summary(M().userDay())||'') + (A.memoReview?.registry()||'') + (A.memoRecurrence?.registry()||''); }
  function render() { if (!ready) return; preserve(() => { renderTasks(); if(pane==='queue')renderQueue(); if(pane==='history')renderHistory(); if(pane==='reviews')renderReviews(); if(pane==='legacy')renderLegacy(); if(pane==='details')renderDetails(); renderPending(); applyPane(); }); A.memoSchedule.tick?.(); A.app?.refreshStats();
    if (completionFocus) { const ref = completionFocus.ref, t = A.memoSchedule.find(ref); if (t && doneFor(t, ref) !== completionFocus.before) { const cardEl = [...document.querySelectorAll('[data-mw-card]')].find(el => el.dataset.ref === JSON.stringify(ref)); const folded = cardEl?.closest('.mw-completed:not([open])'); (folded?.querySelector('summary') || cardEl?.querySelector('[data-mw="complete"]'))?.focus({ preventScroll: true }); completionFocus = null; } }
  }
  function applyPane() { ['today', 'queue', 'reviews', 'history', 'legacy', 'details', 'pending'].forEach(p => { const el = $('mw-' + p); el.hidden = p !== pane; document.querySelector('[data-mw-pane="' + p + '"]')?.setAttribute('aria-pressed', String(p === pane)); });
    const sessions = A.memoSchedule.state().sessions, shown = sessions.find(s => s.status === 'running') || sessions.find(s => s.status === 'paused');
    const container = pane === 'timeline' ? null : $(pane === 'queue' ? 'mw-queue' : 'mw-today');
    $('mw-live')?.classList.toggle('mw-local-timer', !!shown && [...(container?.querySelectorAll('[data-mw-card]') || [])].some(el => A.memoSchedule.key(JSON.parse(el.dataset.ref)) === A.memoSchedule.key(shown.ref)));
    A.memoFloat?.place?.();
  }
  function showPane(next, save = true, options = {}) {
    if(next==='pending')next='queue';
    if (next === 'timeline') { A.app.switchView('timeline'); return A.memoSchedule.open(Object.assign({}, options, { workspace: true })); }
    if (save) positions[pane] = window.scrollY;
    pane = next; if(next==='queue')renderQueue();else if(next==='history')renderHistory();else if(next==='reviews')renderReviews();else if(next==='legacy')renderLegacy();else if(next==='details')renderDetails();applyPane(); if (next === 'timeline') A.memoSchedule.open(Object.assign({}, options, { workspace: true }));
    requestAnimationFrame(() => { if (options.focusCard) $('schedule-card-' + options.focusCard)?.scrollIntoView({ block: 'center' }); else window.scrollTo({ top: positions[next] || 0 }); });
  }
  function enter(next, day) { if(day && M().validDate(day)){taskDay=day;render();}  if (next) showPane(next, false); else { applyPane(); requestAnimationFrame(() => window.scrollTo({ top: positions[pane] || 0 })); } }
  function returnToday() {
    if(document.querySelector('#modal-root .modal-mask')||A.memoActions.busy())return;
    const today=M().userDay(),changed=taskDay!==today||pane!=='today';taskDay=today;positions.today=0;pane='today';
    if(changed)render();else applyPane();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const target=document.querySelector('#mw-today .framework-overview')||$('mw-today'),header=document.querySelector('.app-topbar');if(target)window.scrollTo({top:Math.max(0,window.scrollY+target.getBoundingClientRect().top-(header?.getBoundingClientRect().height||0)-8),behavior:'instant'});}));
  }
  function leave() { positions[pane] = window.scrollY; }
  function timingFields() { return '<details open><summary>安排时间（选填）</summary><div class="schedule-fields"><label>开始／时间点<input type="time" id="mw-start"></label><label>结束（选填）<input type="time" id="mw-end"></label></div><label><input type="checkbox" id="mw-next">次日结束</label><p class="hint">只填开始即为时间点；都不填则暂不安排。</p></details>'; }
  function saveTiming(modal, ref, title, day) {
    const start = modal.querySelector('#mw-start').value, end = modal.querySelector('#mw-end').value;
    if (!start && !end) return;
    if (!start) throw new Error('请补充开始时间');
    A.memoSchedule.savePlan({ ref, title, day, type: end ? 'span' : 'point', start: Date.parse((start < '04:00' ? M().shiftDay(day,1) : day) + 'T' + start + ':00+08:00'), end: end ? Date.parse(((modal.querySelector('#mw-next').checked || end < '04:00') ? M().shiftDay(day, 1) : day) + 'T' + end + ':00+08:00') : null });
  }
  function editor(ref, list, reviewExecution = false) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const reviewLink=ref&&A.memoReview?.locate(ref);if(reviewLink&&!reviewExecution)return A.memoReview.manage(reviewLink.series.id);
    const existing = ref && A.memoSchedule.find(ref), day = ref?.day || taskDay || M().userDay(), kind = ref?.kind || (list === 'queue' ? 'queue' : 'task');
    const m = A.ui.openModal(existing ? '编辑任务' : '添加' + (names[list] || '队列任务'), (!existing && kind === 'task' ? '<label>任务栏目<select id="mw-list">' + Object.keys(names).map(k => '<option value="' + k + '"' + (k === list ? ' selected' : '') + '>' + names[k] + '</option>').join('') + '</select></label>' : '') + '<div class="mw-title-field"><label for="mw-title">任务名称</label><textarea id="mw-title" rows="2"></textarea></div>' +
      (existing && kind === 'task' && ref?.list === 'required' ? '' : '<div id="mw-points-field"><label for="mw-points">完成积分</label><input type="number" id="mw-points" min="0" inputmode="decimal"></div>') + '<label id="mw-priority-field"'+((list==='required'||ref?.list==='required'||existing?.assignment?.list==='required')?'':' hidden')+'>必做优先级<select id="mw-priority" aria-label="必做优先级">'+[1,2,3,4,5].map(n=>'<option value="'+n+'">'+n+' · '+['','较低','次要','正常','重要','最重要'][n]+'</option>').join('')+'</select></label><label for="mw-note-edit">备注（选填）</label><textarea id="mw-note-edit" rows="2"></textarea>' + (!existing && kind === 'task' ? '<fieldset id="mw-repeat-wrap"><legend>重复方式</legend><label><input type="radio" name="mw-repeat" value="once" checked>一次性完成</label><label><input type="radio" name="mw-repeat" value="daily">每日推进</label><label><input type="radio" name="mw-repeat" value="review">间隔复习</label><label><input type="radio" name="mw-repeat" value="cycle">固定周期</label></fieldset>' : '') +
      '<label>预计用时（分钟，选填）<input id="mw-estimate" type="number" min="0" max="1440"></label>' + timingFields() + (existing ? '<p class="hint">这里可追加一段安排；修改已有时间请点卡片上的“修改／追加时间”。</p>' : '') + '<p id="mw-form-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button>' + (existing ? '<button class="btn btn-danger" data-act="delete">' + (kind === 'project' || kind === 'daily' ? '停用' : '删除') + '</button>' + (kind === 'task' && ref.list === 'extra' && !reviewLink ? '<button class="btn" data-act="convert">转为每日推进</button>' : '') : '') + '<button class="btn mw-save-start" data-act="save-start">保存并立即开始</button><button class="btn btn-primary" data-act="save">保存</button>', { lock: true, cancelOnBackdrop: true });
    m.classList.add('mw-task-editor');
    const q = s => m.querySelector(s); q('#mw-title').value = existing?.text || ''; q('#mw-note-edit').value = existing?.note || ''; if (q('#mw-points')) q('#mw-points').value = existing?.points ?? (kind === 'queue' ? S().settings().queuePoints ?? 5 : list === 'ideal' || ref?.list === 'ideal' ? S().settings().idealPoints ?? 1 : S().settings().extPoints ?? 5);
    q('#mw-estimate').value = existing?.estimatedMinutes || ''; if(q('#mw-priority')) q('#mw-priority').value=String(priorityWeight(existing));
    A.memoOrganize?.editor(m,existing,list||ref?.list,ref); A.memoGantt?.editor(m,existing,kind,list||ref?.list);const selectList = q('#mw-list');
    if (selectList) { let pointsEdited = false; q('#mw-points').addEventListener('input', () => { pointsEdited = true; }); const update = () => { if (!pointsEdited) q('#mw-points').value = selectList.value === 'ideal' ? S().settings().idealPoints ?? 1 : S().settings().extPoints ?? 5; q('#mw-repeat-wrap').hidden = false;q('[name="mw-repeat"][value="daily"]').closest('label').hidden=selectList.value!=='extra'; q('#mw-points-field').hidden = selectList.value === 'required';q('#mw-priority-field').hidden=selectList.value!=='required'; }; selectList.onchange = update; update(); }
    m.querySelectorAll('[name="mw-repeat"]').forEach(r=>r.addEventListener('change',()=>{if(r.checked&&['review','cycle'].includes(r.value)&&!A.memoActions.busy()){const draft={text:q('#mw-title').value,note:q('#mw-note-edit').value};A.ui.closeModal();if(r.value==='review')A.memoReview.newEditor(null,draft);else A.memoRecurrence.newEditor({...draft,list:q('#mw-list')?.value||list,points:Number(q('#mw-points')?.value)||0,estimatedMinutes:Number(q('#mw-estimate').value)||0});}}));
    if(existing&&!reviewLink&&A.memoReview&&['task','queue'].includes(kind)){const link=document.createElement('button');link.className='btn';link.type='button';link.textContent='建立间隔复习';link.onclick=()=>{if(!A.memoActions.busy())A.memoReview.newEditor(ref);};m.querySelector('.modal-actions').prepend(link);}
    if(existing&&A.memoRecurrence?.locate(ref)){const manage=document.createElement('button');manage.className='btn';manage.textContent='周期历史与后续规则';manage.onclick=()=>A.memoRecurrence.manage(A.memoRecurrence.locate(ref).series.id);m.querySelector('.modal-actions').prepend(manage);}
    q('#mw-title').focus();
    if (kind === 'project') { const hist = document.createElement('details'); hist.innerHTML = '<summary>每日完成记录</summary>' + Object.keys(existing.days || {}).sort().reverse().map(k => '<button type="button" class="btn" data-project-day="' + esc(k) + '">' + esc(k) + ' · 取消本日完成</button>').join(''); q('#mw-form-error').before(hist); hist.querySelectorAll('[data-project-day]').forEach(b => b.onclick = () => A.memoActions.project(ref.id, b.dataset.projectDay)); }
    const immediate=q('[data-act="save-start"]');
    const running=existing&&A.memoSchedule.state().sessions.slice().reverse().find(s=>A.memoSchedule.key(s.ref)===A.memoSchedule.key(ref)&&s.status!=='ended');
    immediate.hidden=day!==M().userDay()||!!(existing&&(existing.archived||doneFor(existing,ref)));
    immediate.textContent=running?.status==='running'?'保存并返回':running?'保存并继续计时':'保存并立即开始';
    A.ui.dateContext(m, { day: kind==='queue'?(existing?.assignment?.day||null):day, saveSelector:'[data-act=save]', noStart:!!(existing&&(existing.archived||doneFor(existing,ref))) || day!==M().userDay() });
    let submitting=false,savedRef=null,taskSaved=false;
    async function save(b, convert = false, begin = false) {
      if(submitting)return;submitting=true;const actions=[...m.querySelectorAll('.modal-actions button')];actions.forEach(x=>x.disabled=true);
      try { if(!taskSaved){if (await A.memoActions.commit(() => {
        const text = q('#mw-title').value.trim(); if (!text) throw new Error('请填写任务名称'); if (!existing && text.includes('\n')) throw new Error('一次添加一个任务，正文说明可写在备注中');
        if(A.framework){const checked=A.framework.validateTask(text,q('#mw-estimate').value);if(!checked.success)throw Error(checked.error.issues[0].message);}
        const selectedList = q('#mw-list')?.value || list;
        const d = S().data(), isProject = kind === 'project' || convert || (selectedList === 'extra' && q('[name="mw-repeat"]:checked')?.value === 'daily');
        const current=existing?A.memoSchedule.find(ref):null;if(existing&&!current)throw new Error('任务已移动或删除，请重新打开');
        let t = current, targetRef = ref;
        if (isProject && kind !== 'project') {
          if (current?.memoProjectId) throw new Error('此任务已转换，请编辑对应每日项目');
          if (!d.memoProjects) d.memoProjects = [];
          t = { id: S().uid(), text, days: {}, createdAt: new Date().toISOString(), createdDay: day, source: existing ? { id: existing.id, day, list: ref.list } : null };
          d.memoProjects.push(t); targetRef = { kind: 'project', id: t.id, day: ref?.day || (day === M().userDay() ? M().userDay() : day) }; t.createdDay = targetRef.day;
          if (current) { if (current.done) throw new Error('已完成的旧任务保留历史，请新建每日推进项目'); A.memoSchedule.stopRef(ref); current.memoProjectId = t.id; }; // Preserve historical source and its ledger; never infer a merge by title.
        } else if (!t) {
          t = { id: S().uid(), createdAt: new Date().toISOString() };
          if (kind === 'queue') { (d.queue || (d.queue = [])).push(t); targetRef = { kind: 'queue', id: t.id }; }
          else { S().getDay(day).tasks[selectedList].push(t); targetRef = { kind: 'task', id: t.id, list: selectedList, day }; }
        }
        t.estimatedMinutes = Math.min(1440, Math.max(0, Number(q('#mw-estimate').value) || 0)); t.dateBasis = 'user';
        t.text = text; t.note = q('#mw-note-edit').value; if (q('#mw-points')) t.points = Math.max(0, Number(q('#mw-points').value) || 0);
        if(q('#mw-priority')&&(selectedList==='required'||(!q('#mw-list')&&ref?.list==='required')||(kind==='queue'&&t.assignment?.list==='required'))){
          const weight=Number(q('#mw-priority').value);
          if(!Number.isInteger(weight)||weight<1||weight>5)throw Error('必做优先级必须为1—5');
          t.priorityWeight=weight;
        }
        if(q('#task-group'))t.memoGroup=q('#task-group').value;A.memoGantt?.apply(t,m);saveTiming(m, targetRef, text, targetRef.kind === 'project' ? targetRef.day : day); savedRef=targetRef;
        A.memoActions?.reconcileRewards?.(day);
      })){taskSaved=true;}else return;}
      if(begin){if(day!==M().userDay())throw Error('日期已改变，任务已保存，请关闭后重新开始');if(!await A.memoActions.commit(()=>A.memoSchedule.startRef(savedRef)))return;}
      A.ui.closeModal();render();A.memoSchedule.render();if(begin)A.ui.toast('任务已保存，计时已开始或保持运行');
      }catch(e){q('#mw-form-error').textContent=(taskSaved?'任务已保存；计时尚未保存成功。':'')+e.message;b.textContent=A.memoActions.busy()?'重试保存':taskSaved?'重试开始计时':'重新保存';}
      finally{submitting=false;const pending=A.memoActions.busy();actions.forEach(x=>x.disabled=pending||taskSaved);if(!pending){const cancel=q('[data-act="cancel"]');if(cancel)cancel.disabled=false;}if(b.isConnected)b.disabled=false;m.querySelectorAll('input,textarea,select').forEach(x=>x.disabled=pending||taskSaved);}
    }
    A.ui.bindActions({ cancel: () => { if (!submitting&&!A.memoActions.busy()) A.ui.closeModal(); }, save, 'save-start':b=>save(b,false,true), convert: b => save(b, true), delete: () => {
      if (A.memoActions.busy()) return;
      if (kind === 'project' || kind === 'daily') A.ui.confirm('停用后不再列入当前清单，历史完成、积分和笔记保留，可恢复。', '停用项目', () => commit(() => { const current=A.memoSchedule.find(ref);if(!current)throw new Error('任务已不存在，请重新打开');current.archived = true; const state = A.memoSchedule.state(); state.sessions.filter(s => s.ref.kind === kind && s.ref.id === ref.id).forEach(s => A.memoSchedule.stopRef(s.ref)); state.items.filter(p => p.ref.kind === kind && p.ref.id === ref.id && p.start >= Date.now()).forEach(p => p.suspendedByArchive = true); }).then(ok => { if (ok) A.ui.closeModal(); }));
      else A.memoActions.deleteTask(ref);
    } });
  }
  function complete(ref) { ref = A.memoSchedule.canonical(ref); const t = A.memoSchedule.find(ref); if (t) completionFocus = { ref, before: doneFor(t, ref) }; if (ref.kind === 'task') A.memoActions.task(ref.list, ref.id, ref.day); else if (ref.kind === 'queue') A.memoActions.queue(ref.id); else if (ref.kind === 'daily') A.memoActions.daily(ref.id, ref.day); else if(ref.kind==='checkin') A.memoActions.checkin(ref.id,ref.day); else A.memoActions.project(ref.id, ref.day); }

  function datedTasks() {
    const rows = [];
    Object.entries(S().data().days).forEach(([day, data]) => ['required', 'ideal', 'extra'].forEach(list => (data.tasks[list] || []).filter(t => !t.fromQueue && !t.fromDaily && !t.memoProjectId).forEach(task => rows.push({ task, ref: { kind: 'task', id: task.id, day, list } }))));
    A.memoFlow?.queues().forEach(task => { if(task.assignment)rows.push({task,ref:{kind:'queue',id:task.id},day:task.assignment.day,list:task.assignment.list}); const seen=new Set();(task.assignmentHistory||[]).filter(a=>a.day&&a.list).forEach(a=>{const key=a.day+':'+a.list;if(seen.has(key))return;seen.add(key);const h=A.memoFlow.deferred(a.day,a.list).find(x=>x.ref.kind==='queue'&&x.ref.id===task.id);if(h)rows.push({task:Object.assign({},h.task,{memoMovedTo:{kind:'queue',id:task.id}}),ref:h.ref,day:a.day,list:a.list});}); });
    return rows;
  }
  function historyRow(x) {
    const t = x.task, day = x.day || x.ref.day, list = x.list || x.ref.list;
    const historical=(A.memoFlow.deferred?.(day,list)||[]).find(h=>h.ref.kind===x.ref.kind&&h.ref.id===x.ref.id);if(historical)return deferredHTML(historical);
    const status = t.memoMovedTo ? '已重新安排' : t.memoDismissed ? '未完成 · 不再安排' : t.done || t.doneAt ? (t.backfillDay ? (t.backfillDay <= t.originalDay ? '补记按时完成' : '补记延期完成') : t.originalDay ? '延期完成' : '已完成') : '未完成';
    return '<article class="mw-history-row" '+refAttrs(x.ref)+'><strong>' + esc(t.text) + '</strong><p>' + esc(day + ' · ' + names[list] + ' · ' + status + (status === '未完成' ? (day < S().data().memoFlow?.startedDay ? ' · 旧任务，待安排' : list !== 'required' ? ' · 待重新安排' : '') : '')) + '</p>' + (!t.memoMovedTo && !t.memoDismissed ? (t.done || t.doneAt ? button('open-day', '查看当天', refAttrs(Object.assign({}, x.ref, {day}))) : button('assign', '重新安排', refAttrs(x.ref)) + '<details class="mw-row-more"><summary>更多</summary><div class="mw-secondary-actions">' + button('backfill','补记完成',refAttrs(x.ref))+button('edit','编辑',refAttrs(x.ref))+button('enqueue','暂不安排',refAttrs(x.ref))+button('dismiss','不再安排',refAttrs(x.ref))+'</div></details>') : t.memoDismissed ? button('restore-pending', '恢复待安排', refAttrs(x.ref)) : '') + '</article>';
  }
  function backlog() {
    const rows = datedTasks().filter(x => (x.day || x.ref.day) < M().userDay() && !x.task.done && !x.task.doneAt && !x.task.memoMovedTo && !x.task.memoDismissed && !x.task.memoOccurrenceId && !A.memoReview?.hidden(x.task,x.list||x.ref.list||x.task.assignment?.list));
    return '<details class="mw-backlog"><summary>往日未完成（' + rows.length + '）</summary>' + rows.sort((a,b) => (a.day || a.ref.day).localeCompare(b.day || b.ref.day)).map(historyRow).join('') + '</details>';
  }
  function pendingRows(){return datedTasks().filter(x=>(x.day||x.ref.day)<M().userDay()&&!x.task.done&&!x.task.doneAt&&!x.task.memoMovedTo&&!x.task.memoDismissed&&!x.task.memoOccurrenceId&&!A.memoReview?.hidden(x.task,x.list||x.ref.list||x.task.assignment?.list));}
  function pendingHTML(){
    const rows=pendingRows();
    if(!rows.length)return '<p class="hint">暂无需要重新安排的任务</p>';
    return ['required','ideal','extra'].map(list=>{
      const grouped=rows.filter(x=>(x.list||x.ref.list||x.task.assignment?.list||'extra')===list);
      return grouped.length?'<section class="mw-pending-group"><h3>'+names[list]+' · '+grouped.length+'</h3>'+grouped.map(historyRow).join('')+'</section>':'';
    }).join('');
  }
  function waitingRow(t){const ref={kind:'queue',id:t.id},attrs=refAttrs(ref);return '<article class="mw-history-row" data-bounty="'+!!A.memoOrganize?.bounty(score(t,ref))+'" '+attrs+'><strong>'+esc(t.text)+(A.memoOrganize?.badge(score(t,ref))||'')+'<small class="mw-score">+'+Math.max(0,Number(t.points??S().settings().queuePoints??5))+'分</small>'+'</strong><div class="mw-waiting-actions">'+button('assign','安排',attrs)+'</div><details><summary>更多</summary><div class="mw-secondary-actions">'+button('complete','直接完成',attrs)+A.memoSchedule.rowControls(ref)+(t.note?'<p>'+esc(t.note)+'</p>':'')+button('edit','编辑',attrs)+button('pin',t.pinned?'取消置顶':'置顶',attrs)+button('up','上移',attrs)+button('down','下移',attrs)+button('dismiss','不再安排',attrs)+'</div></details></article>';}
  function renderPending(){const nav=document.querySelector('[data-mw-pane="queue"]');if(nav)nav.textContent='待安排 '+(pendingRows().length+sortedQueue().filter(t=>!t.assignment&&!t.memoDismissed&&!A.memoReview?.hidden(t,t.assignment?.list)).length);}

  let historyFrom = '', historyTo = '', historyStatus = '', historyList = '';
  function renderHistory() {
    const root = $('mw-history'); if (!root) return;
    const rows = datedTasks().filter(x => { const day = x.day || x.ref.day, t = x.task, status = t.memoMovedTo ? 'moved' : t.memoDismissed ? 'dismissed' : t.done || t.doneAt ? 'done' : 'pending'; return (!historyFrom || day >= historyFrom) && (!historyTo || day <= historyTo) && (!historyStatus || historyStatus === status) && (!historyList || historyList === (x.list || x.ref.list)); });
    root.innerHTML = '<h2>任务历史</h2><div class="schedule-fields"><label>从<input type="date" id="mh-from" value="' + historyFrom + '"></label><label>至<input type="date" id="mh-to" value="' + historyTo + '"></label><label>栏目<select id="mh-list"><option value="">全部</option>' + Object.entries(names).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('') + '</select></label><label>状态<select id="mh-status"><option value="">全部</option><option value="pending">未完成</option><option value="done">已完成</option><option value="moved">已重新安排</option><option value="dismissed">不再安排</option></select></label></div>' + (rows.sort((a,b)=>(b.day || b.ref.day).localeCompare(a.day || a.ref.day)).map(historyRow).join('') || '<p>没有符合条件的任务</p>');
    $('mh-list').value=historyList; $('mh-status').value=historyStatus;
    ['from','to','list','status'].forEach(k => $('mh-'+k).onchange = e => { if(k==='from')historyFrom=e.target.value; if(k==='to')historyTo=e.target.value; if(k==='list')historyList=e.target.value; if(k==='status')historyStatus=e.target.value; renderHistory(); });
  }
  function assignmentEditor(ref, onReturn) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const t = A.memoSchedule.find(ref); if (!t) return;
    const active=A.memoSchedule.timing(ref).session;
    if(active?.status==='running'){return A.ui.confirm('调整日期前会暂停当前计时，已有时段保留。','暂停并调整安排',async()=>{if(await commit(()=>A.memoSchedule.pauseCore(active))){assignmentEditor(ref,onReturn);}});}
    const finish=()=>{A.ui.closeModal();render();A.memoSchedule.render();onReturn?.();};
    const review=A.memoReview?.locate(ref);if(review&&!onReturn)return A.memoReview.scheduleEditor(review.series.id,review.round.id);
    const startDay=M().userDay(),weekday=['日','一','二','三','四','五','六'];
    const week=Array.from({length:7},(_,i)=>{const value=M().shiftDay(startDay,i),w=new Date(value+'T12:00:00+08:00').getUTCDay();return '<button type="button" class="btn mw-assign-day" data-ma-pick-day="'+value+'" aria-pressed="'+(i===0)+'"><small>周'+weekday[w]+'</small><strong>'+Number(value.slice(8))+'</strong></button>';}).join('');
    const m = A.ui.openModal('安排 · '+t.text,
      '<label>安排日期</label><div class="mw-assign-week" role="group" aria-label="最近七天">'+week+'</div><label>其他日期<input type="date" id="ma-day" value="'+startDay+'"></label><p class="hint">选择日期后直接选择安排栏目。</p><div class="mw-assign-choices">'+['required','ideal','extra'].map((list,i)=>'<button class="btn" data-act="pick" data-list="'+list+'">'+['必做','理想','拓展'][i]+'</button>').join('')+'</div><div class="mw-assign-options"><button class="btn btn-small" data-act="time-settings">安排时间与预计用时</button><button class="btn btn-small" data-act="edit-task">编辑任务</button><button class="btn btn-small" data-act="queue">暂不安排</button>'+(t.overdueEventId?'<button class="btn btn-small" data-act="forgive">纠正错误扣分</button>':'')+'</div><p id="ma-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button>', {lock:true});
    const date=m.querySelector('#ma-day');
    const updateWeek=()=>m.querySelectorAll('[data-ma-pick-day]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.maPickDay===date.value)));
    m.querySelectorAll('[data-ma-pick-day]').forEach(b=>b.onclick=()=>{date.value=b.dataset.maPickDay;date.dispatchEvent(new Event('change',{bubbles:true}));updateWeek();});
    date.addEventListener('change',updateWeek);updateWeek();
    A.ui.dateContext(m,{getDay:()=>date.value,label:'安排到',sourceDay:ref.day||t.assignment?.day,choiceSelector:'[data-act=pick]'});
    async function save(b,target,list){if(A.memoActions.busy())return;const buttons=m.querySelectorAll('[data-act="pick"],[data-act="queue"]');buttons.forEach(x=>x.disabled=true);try{if(await A.memoActions.commit(()=>{if(review){if(target==='queue')throw Error('复习轮次请保留日期安排');const clock=M().clock(review.round.due);A.memoReview.rescheduleCore(review.round.id,Date.parse((clock<'04:00'?M().shiftDay(date.value,1):date.value)+'T'+clock+':00+08:00'),list||ref.list);}else A.memoFlow.moveCore(ref,date.value,list||t.assignment?.list||ref.list||'ideal',target);})){finish();A.ui.toast('已安排');}}catch(e){m.querySelector('#ma-error').textContent=e.message;}finally{buttons.forEach(x=>x.disabled=false);}}
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())finish();},pick:b=>save(b,'task',b.dataset.list),queue:b=>save(b,'queue'),'time-settings':()=>{if(!A.memoActions.busy()){A.ui.closeModal();A.memoSchedule.arrange(ref);}},'edit-task':()=>{if(!A.memoActions.busy()){A.ui.closeModal();editor(ref);}},forgive:()=>{if(A.memoActions.busy()||m.querySelector('#ma-reason'))return;const reason=document.createElement('input');reason.id='ma-reason';reason.placeholder='说明错误原因';m.querySelector('#ma-error').before(reason);const b=m.querySelector('[data-act="forgive"]');b.textContent='确认纠正';b.onclick=async()=>{try{if(await A.memoActions.commit(()=>A.memoFlow.forgiveCore(ref,reason.value))){A.ui.closeModal();render();A.app.refreshStats();}}catch(e){m.querySelector('#ma-error').textContent=e.message;}};}});
  }

  function renderReview(day) {
    const root = $('review-card'); root.innerHTML = '<label>今日复盘</label><textarea id="mw-review-text" rows="6"></textarea><button class="btn btn-primary" id="mw-review-save">保存复盘</button><p id="mw-review-status" role="status"></p>';
    $('mw-review-text').value = day.review?.text || '';
    $('mw-review-save').onclick = async () => { const text = $('mw-review-text').value; if (await commit(() => { day.review = { text, at: new Date().toISOString() }; })) $('mw-review-status').textContent = '已保存'; };
  }
  function init() {
    ready = true; taskDay = M().userDay(); lastDay = taskDay; lastCivilDay = M().naturalDay();
    const root = $('view-tasks');
    const axis = document.createElement('section'); axis.id = 'view-memo-timeaxis'; axis.className = 'view'; document.querySelector('main').appendChild(axis); axis.appendChild($('memo-schedule-panel'));
    const error = document.createElement('button'); error.id = 'flow-save-error'; error.className = 'btn btn-danger'; error.hidden = true; document.querySelector('main').before(error);
    root.insertAdjacentHTML('afterbegin', '<p id="mw-error" role="alert"></p><div id="mw-today"></div><div id="mw-queue" hidden></div><div id="mw-reviews" hidden></div><div id="mw-history" hidden></div><div id="mw-legacy" hidden></div><div id="mw-details" hidden></div><div id="mw-pending" hidden></div>');
    // Keep legacy review content reachable, with mutation entries retired in memo mode.
    const review = document.createElement('section'); review.id = 'view-memo-review'; review.className = 'view'; review.innerHTML = '<h2>今日复盘</h2><p class="hint">完成和补记请在任务中操作，统一关联笔记、积分与时间轴。</p>'; $('review-card').parentNode.removeChild($('review-card')); review.appendChild(document.createElement('div')).id = 'review-card'; document.querySelector('main').appendChild(review);
    document.querySelectorAll('.mn-grid, header nav').forEach(el => el.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" data-view="memo-review">今日复盘</button>'));
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend', '<button class="btn" id="mw-trash">删除记录</button>'); $('mw-trash').onclick = () => A.memoActions.trash(); document.querySelector('#main-nav')?.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" id="mw-trash-desktop">删除记录</button>'); if ($('mw-trash-desktop')) $('mw-trash-desktop').onclick = () => A.memoActions.trash();
    document.querySelectorAll('[data-view="memo-review"]').forEach(b => b.onclick = () => { A.app.switchView('memo-review'); const d = S().getDay(M().userDay()); renderReview(d); });
    $('schedule-active').before($('schedule-live')); const live = document.createElement('div'); live.id = 'mw-live'; live.append($('schedule-live'), $('schedule-active')); const controls = document.createElement('span'); controls.id = 'mw-live-controls'; live.appendChild(controls); document.querySelector('main').before(live);
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend','<button class="btn" id="mw-open-history">任务历史</button>');$('mw-open-history').onclick=()=>{$('mn-sheet')?.classList.add('hidden');A.app.switchView('tasks');showPane('history');};
    root.addEventListener('click', e => {
      const gantt=e.target.closest('[data-gantt-edit]');if(gantt){e.preventDefault();e.stopImmediatePropagation();const n=A.memoGantt?.locate(gantt.dataset.ganttEdit);if(!n)return A.ui.toast('任务已移动，请刷新');return editor(n.ref,n.ref.list||'extra');}
      const deferred=e.target.closest('[data-deferred-open],[data-deferred-backfill],[data-deferred-assign]');if(deferred){e.preventDefault();e.stopImmediatePropagation();if(deferred.hasAttribute('data-deferred-assign'))return assignmentEditor(JSON.parse(deferred.dataset.deferredAssign));return deferred.hasAttribute('data-deferred-open')?openDeferred(JSON.parse(deferred.dataset.deferredOpen)):A.memoFlow.backfill(JSON.parse(deferred.dataset.deferredBackfill),deferred.dataset.deferredDay);}
      const goal=e.target.closest('[data-goal]');if(goal){e.preventDefault();e.stopImmediatePropagation();return A.memoGoals.editor(goal.dataset.goal);}
      if(e.target.closest('.mw-overview'))return overviewClick(e,taskDay);
      const deadline=e.target.closest('[data-ms-item]');if(deadline){e.preventDefault();e.stopImmediatePropagation();return A.ms.edit(deadline.dataset.msItem);}
      const b = e.target.closest('[data-mw]'), cardEl = e.target.closest('[data-mw-card]');
      if (b) { e.preventDefault(); e.stopImmediatePropagation(); const act = b.dataset.mw, ref = b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
        if(act==='open-queue')return showPane('queue');
        if(act==='exec-pick')return execPick();
        if(act==='exec-add')return execAdd(ref);
        if(act==='exec-menu')return execMenu(ref);
        if(act==='exec-checkin')return complete(ref);
        if(act==='exec-complete')return complete(ref);
        if(act==='exec-expand'){execExpanded=!execExpanded;return renderTasks();}
        if(act==='search')return taskSearch();
        if(act==='claim-rewards')return claimDayRewards();
        if(['exec-skip','exec-pin','exec-up','exec-down','exec-tail'].includes(act))return execMove(ref,act.slice(5));
        if(act==='exec-edit')return editor(ref);
        if(act==='exec-delete')return ref.kind==='project'||ref.kind==='daily'?editor(ref):A.memoActions.deleteTask(ref);
        if(act==='enqueue')return commit(()=>A.memoFlow.moveCore(ref,M().userDay(),'ideal','queue'));
        if(act==='goal-add')return A.memoGoals.editor();
        if(act==='goal-edit')return A.memoGoals.editor(b.dataset.id);
        if(act==='ddl')return A.ms.open();
        if(act==='column'){const col=$('mw-column-'+b.dataset.column);$('mw-today').querySelector('.mw-board').scrollTo({left:col.offsetLeft-col.parentElement.offsetLeft,behavior:'smooth'});return;}
        if (act.startsWith('add-')) return editor(null, act.slice(4));
        if (act === 'edit') return editor(ref);
        if (act === 'open-day') { taskDay = ref.day; showPane('today'); return render(); }
        if (act === 'backfill') return A.memoFlow.backfill(ref);
        if (act === 'assign') return assignmentEditor(ref);
        if (act === 'restore-pending') return commit(() => { const t = ref.kind==='queue' ? A.memoFlow.queues().find(t=>t.id===ref.id) : S().data().days[ref.day]?.tasks[ref.list]?.find(t=>t.id===ref.id); if(t)delete t.memoDismissed; });
        if (act === 'dismiss') return commit(() => { const t = A.memoSchedule.find(ref); if(t?.memoReviewRoundId){A.memoReview.cancelCore(t.memoReviewRoundId);return;} if (t) { A.memoSchedule.stopRef(ref); t.memoDismissed = new Date().toISOString(); } });
        if (act === 'complete') return complete(ref);
        if (act === 'today' || act === 'tomorrow' || act === 'yesterday') { taskDay = act === 'today' ? M().userDay() : M().shiftDay(M().userDay(), act==='yesterday'?-1:1); return renderTasks(); }
        if (act === 'restore-daily') return commit(() => { S().data().daily.find(p => p.id === ref.id).archived = false; A.memoSchedule.state().items.filter(p => p.ref.kind === 'daily' && p.ref.id === ref.id).forEach(p => delete p.suspendedByArchive); });
        if (act === 'restore-project') return commit(() => { projects().find(p => p.id === ref.id).archived = false; A.memoSchedule.state().items.filter(p => p.ref.kind === 'project' && p.ref.id === ref.id).forEach(p => delete p.suspendedByArchive); });
        if (['pin', 'up', 'down'].includes(act)) return commit(() => moveQueue(ref.id, act));
      }
      if (cardEl && !e.target.closest('button,input,textarea,select,a,summary,details,[data-schedule-command]') && !window.getSelection()?.toString()) { e.stopImmediatePropagation(); editor(JSON.parse(cardEl.dataset.ref)); }
    }, true);
    root.addEventListener('keydown',e=>{if(e.target.matches('[data-overview-ref],[data-overview-list],[data-goal]')&&['Enter',' '].includes(e.key)&&!e.isComposing)overviewClick(e,taskDay);});
    A.tasks.renderAll = render; A.queue.render = () => preserve(renderQueue);
    function refreshDates(){const now=M().userDay(),civil=M().naturalDay();if(now!==lastDay){if(taskDay===lastDay)taskDay=now;lastDay=now;render();}else if(civil!==lastCivilDay)A.memoGoals?.refresh();lastCivilDay=civil;}
    setInterval(refreshDates,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDates();});window.addEventListener('focus',refreshDates);
    A.memoReview?.init();A.memoRecurrence?.init();
    render();
  }
  A.memoWorkspace = { captureQueueAdvance, queueSettled, timerStarted, timerEnded, pruneExec, execAdd, execHas, execHTML, setDay, assignmentEditor, complete, score, scoreBand, priorityWeight, priorityLabel, deferredHTML, taskItems, pendingRows, waitingRow, overviewHTML, overviewClick, init, render, enter, leave, returnToday, showPane, editor, sortedQueue, orderQueue, moveQueue, saveTiming, projects, renderHistory, renderReview };
})();
