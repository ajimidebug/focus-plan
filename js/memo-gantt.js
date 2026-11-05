/* 175: editable long-term project planner over memoProjects; no parallel task store. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore,E=x=>S().esc(String(x??''));

const projects=()=>S().data().memoProjects||[],groups=()=>S().data().memoTaskGroups||[];
const DAY=86400000;
const dayNumber=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d?Date.parse(d+'T00:00:00Z')/DAY:null;
const dayString=n=>new Date(n*DAY).toISOString().slice(0,10);
function pref(key,fallback){try{return localStorage.getItem('gantt-175:'+key)??fallback}catch{return fallback}}
function setPref(key,value){try{localStorage.setItem('gantt-175:'+key,value)}catch{}}
function category(t){return groups().some(g=>g.id===t.memoGroup)?t.memoGroup||'':''}
function groupTitle(id){return groups().find(g=>g.id===id)?.name||'未分组'}
function nodes(){
 const d=S().data(),out=new Map();
 for(const t of projects())if(!t.archived)out.set('project:'+t.id,{key:'project:'+t.id,kind:'project',id:t.id,task:t,ref:{kind:'project',id:t.id,day:M().userDay()},group:category(t),title:t.text});
 for(const [day,data] of Object.entries(d.days||{}).sort(([a],[b])=>a.localeCompare(b))){
  for(const list of ['required','ideal','extra'])for(const t of data.tasks?.[list]||[]){
   if(t.fromQueue||t.fromDaily||t.memoProjectId||t.memoMovedTo||t.memoDismissed||t.memoOccurrenceId||t.memoReviewRoundId)continue;
   out.set('once:'+t.id,{key:'once:'+t.id,kind:'once',id:t.id,task:t,ref:{kind:'task',id:t.id,day,list},day,group:category(t),title:t.text});
  }
 }
 for(const t of [...(d.queue||[]),...(d.queueDone||[])]){
  if(t.memoDismissed||t.archived||t.memoOccurrenceId||t.memoReviewRoundId)continue;
  out.set('once:'+t.id,{key:'once:'+t.id,kind:'once',id:t.id,task:t,ref:{kind:'queue',id:t.id},day:t.assignment?.day||'',group:category(t),title:t.text});
 }
 return [...out.values()];
}
function normalizeKey(id){if(typeof id!=='string')return '';if(id.startsWith('once:')||id.startsWith('project:'))return id;return 'project:'+id;}
function keyToStored(key){return key.startsWith('project:')?key.slice(8):key;}
function locate(key){return nodes().find(n=>n.key===normalizeKey(key))||null}
function dependencies(t){return Array.isArray(t?.memoGanttDependencies)?t.memoGanttDependencies:[]}
function optionsHtml(task,group,selected=[],cross=false){
 const chosen=new Set(selected.map(normalizeKey));
 return nodes().filter(n=>n.id!==task?.id&&(n.group===group||cross||chosen.has(n.key)))
  .map(n=>'<label class="gantt-dependency-option"><input type="checkbox" data-gantt-dep value="'+E(keyToStored(n.key))+'"'+(chosen.has(n.key)?' checked':'')+'><span>'+E(n.title)+' <small>('+E(groupTitle(n.group))+' · '+(n.kind==='once'?'一次性':'每日推进')+')</small></span></label>').join('')||'<p class="hint">此分组没有可选的前置项目</p>';
}
function selectedDeps(modal){return [...modal.querySelectorAll('[data-gantt-dep]:checked')].map(x=>x.value)}
function bindDeps(modal,task,groupSelector,container){
 const cross=modal.querySelector('[data-gantt-cross]');
 let chosen=dependencies(task).slice();
 const update=()=>{chosen=[...new Set([...chosen,...selectedDeps(modal)])];container.innerHTML=optionsHtml(task,groupSelector.value,chosen,cross.checked);};
 container.addEventListener('change',e=>{if(e.target.matches('[data-gantt-dep]'))chosen=selectedDeps(modal)});
 groupSelector.addEventListener('change',update);cross.addEventListener('change',update);update();
 return ()=>selectedDeps(modal);
}
function dateFields(prefix,start,end){
 return '<div class="gantt-range-wrap"><p class="hint">第一次选开始，第二次选截止，再次点击重新选择。同日可作为一天；仅截止日可显示为里程碑。</p><div class="gantt-range-picker" data-gantt-picker="'+E(prefix)+'"></div><div class="memo-gantt-dates gantt-native-date"><label>开始日期<input type="date" id="'+E(prefix)+'-start" value="'+E(start||'')+'"></label><label>截止日期<input type="date" id="'+E(prefix)+'-end" value="'+E(end||'')+'"></label></div><p class="gantt-range-status" role="status"></p><div class="gantt-range-actions"><button class="btn btn-small" type="button" data-range-one>设为单日</button><button class="btn btn-small" type="button" data-range-deadline>仅截止日</button><button class="btn btn-small" type="button" data-range-clear>清空</button></div></div>';
}
function bindDates(modal,prefix){
 const st=modal.querySelector('#'+prefix+'-start'),ed=modal.querySelector('#'+prefix+'-end');
 const wrap=st.closest('.gantt-range-wrap'),status=wrap.querySelector('.gantt-range-status'),picker=wrap.querySelector('[data-gantt-picker]');
 const label=()=>{status.textContent=st.value&&ed.value?st.value+' — '+ed.value:ed.value?'截止日：'+ed.value:st.value?'开始日：'+st.value+'（请选择截止日）':'未设定计划日期';};
 const set=(from,to)=>{st.value=from||'';ed.value=to||'';label()};
 wrap.querySelector('[data-range-one]').onclick=()=>{const day=st.value||ed.value||M().naturalDay();set(day,day);picker._ganttSet?.(day,day)};
 wrap.querySelector('[data-range-deadline]').onclick=()=>{const day=ed.value||st.value||M().naturalDay();set('',day);picker._ganttSet?.('',day)};
 wrap.querySelector('[data-range-clear]').onclick=()=>{set('','');picker._ganttSet?.('','')};
 st.onchange=ed.onchange=label;label();
 if(A.framework?.ganttRange){wrap.querySelector('.gantt-native-date').hidden=true;A.framework.ganttRange(picker,st.value,ed.value,set);}
}

function validate(task,from,to,deps=[]){
 const start=from?dayNumber(from):null,end=to?dayNumber(to):null;
 if((from&&start===null)||(to&&end===null))throw Error('甘特图日期无效');
 if(from&&!to)throw Error('请补充截止日期，或选择清空日期');
 if(start!==null&&(end<start||end-start>3650))throw Error('截止日期不能早于开始日期，最长10年');
 if(!Array.isArray(deps)||deps.length>20||deps.some(x=>typeof x!=='string'))throw Error('前置项目格式异常，最多20项');
 const mapped=new Map(nodes().map(n=>[n.key,n])),own=task?.id;
 const unique=[...new Set(deps.filter(Boolean).map(normalizeKey))],visited=new Set();
 function visit(key){
  if(key.startsWith('once:')&&key==='once:'+own || key.startsWith('project:')&&key==='project:'+own)throw Error('项目依赖形成循环');
  if(visited.has(key))return;visited.add(key);
  const n=mapped.get(key);if(!n)throw Error('前置项目不存在，请检查引用');
  if(!Array.isArray(n.task.memoGanttDependencies)&&n.task.memoGanttDependencies!==undefined)throw Error('旧前置关系格式异常');
  dependencies(n.task).forEach(x=>visit(normalizeKey(x)));
 }
 unique.forEach(visit);
 return {start:from||'',end:to||'',dependencies:unique.map(keyToStored)};
}
function editor(modal,task,kind,list){
 const field=document.createElement('details');field.id='memo-gantt-fields';
 field.open=kind==='project'||!!(task?.memoGanttStart||task?.memoGanttEnd||(task?.memoGanttDependencies||[]).length);
 field.innerHTML='<summary>甘特图计划与依赖（可选）</summary><label>甘特图分组<select id="memo-gantt-group"><option value="">未分组</option>'+groups().map(g=>'<option value="'+E(g.id)+'">'+E(g.name)+'</option>').join('')+'</select></label>'+dateFields('memo-gantt',task?.memoGanttStart,task?.memoGanttEnd)+
 '<label class="gantt-cross-label"><input type="checkbox" data-gantt-cross> 显示其他分组项目</label><div class="gantt-dependency-list" id="memo-gantt-dependency-list"></div><p class="hint">依赖只提示，不会自动调整安排、积分或计时。</p>';
 modal.querySelector('#mw-form-error').before(field);
 const group=field.querySelector('#memo-gantt-group');group.value=category(task||{});
 const outer=modal.querySelector('#task-group');if(outer){group.closest('label').hidden=true;group.value=outer.value;outer.addEventListener('change',()=>{group.value=outer.value;group.dispatchEvent(new Event('change'));});}
 const update=()=>{const selected=modal.querySelector('#mw-list')?.value||list;field.hidden=!(kind==='project'||kind==='task'||kind==='queue'||selected==='extra');};
 modal.querySelector('#mw-list')?.addEventListener('change',update);
 modal.querySelectorAll('[name="mw-repeat"]').forEach(x=>x.addEventListener('change',update));update();
 bindDeps(modal,task,group,field.querySelector('#memo-gantt-dependency-list'));bindDates(modal,'memo-gantt');
}
function apply(task,modal){
 const field=modal.querySelector('#memo-gantt-fields');if(!field||field.hidden)return;
 const st=modal.querySelector('#memo-gantt-start').value,end=modal.querySelector('#memo-gantt-end').value;
 const checked=validate(task,st,end,selectedDeps(modal));
 if(checked.start)task.memoGanttStart=checked.start;else delete task.memoGanttStart;
 if(checked.end)task.memoGanttEnd=checked.end;else delete task.memoGanttEnd;
 task.memoGanttDependencies=checked.dependencies;
 task.memoGroup=modal.querySelector('#memo-gantt-group').value;
}

function model(now=Date.now()){
 const today=dayNumber(M().naturalDay(now)),all=nodes(),byKey=new Map(all.map(x=>[x.key,x]));
 const zoom=['month','quarter','year','all'].includes(pref('zoom','quarter'))?pref('zoom','quarter'):'quarter';
 const focus=dayNumber(pref('focus',M().naturalDay(now)))??today;
 const rows=all.map(n=>{
  const explicitStart=dayNumber(n.task.memoGanttStart),explicitEnd=dayNumber(n.task.memoGanttEnd);
  const inherited=dayNumber(n.day);
  const start=explicitEnd!==null?explicitStart:inherited,end=explicitEnd!==null?explicitEnd:inherited;
  const achieved=n.kind==='project'?!!n.task.memoGanttCompletedAt:!!(n.task.done||n.task.doneAt||n.task.doneDay);
  const completed=n.kind==='project'?Object.keys(n.task.days||{}).filter(day=>(n.task.days||{})[day]&&start!==null&&end!==null&&dayNumber(day)>=start&&dayNumber(day)<=end).length:0;
  return {...n,start,end,valid:end!==null,point:start===null&&end!==null,achieved,completed,dependencies:dependencies(n.task),conflicts:[]};
 });
 const map=new Map(rows.map(x=>[x.key,x]));
 rows.forEach(n=>{n.conflicts=n.dependencies.map(normalizeKey).filter(key=>{const p=map.get(key);return !p||!p.achieved||(p.end!==null&&n.start!==null&&p.end>n.start);});});
 rows.sort((a,b)=>Number(a.achieved)-Number(b.achieved)||(a.end??Infinity)-(b.end??Infinity)||a.title.localeCompare(b.title));
 const planned=rows.filter(x=>x.valid);
 const from=zoom==='all'?(planned.length?Math.min(today,...planned.map(p=>p.start??p.end)):today-7):focus-(zoom==='month'?10:zoom==='quarter'?30:120);
 const to=zoom==='all'?(planned.length?Math.max(today,...planned.map(p=>p.end)):today+30):focus+(zoom==='month'?50:zoom==='quarter'?180:730);
 return {from,to,now:today,focus,zoom,rows};
}
function rowHtml(p,m,width){
 const total=Math.max(1,m.to-m.from+1),lo=p.valid?Math.max(m.from,p.start??p.end):null,hi=p.valid?Math.min(m.to,p.end):null;
 const visible=p.valid&&lo<=hi,left=visible?(lo-m.from)/total*100:0,bar=visible?(hi-lo+1)/total*100:0;
 const progress=p.valid&&p.start!==null?Math.max(0,Math.min(100,(m.now-p.start+1)/(p.end-p.start+1)*100)):0;
 const deps=p.dependencies.map(id=>{const n=locate(id);return n?(n.title+(n.group!==p.group?'（'+groupTitle(n.group)+'）':'')):'已删除的前置项目';});
 const label=p.valid?(p.point?'截止：'+dayString(p.end):dayString(p.start)+' — '+dayString(p.end))+(p.kind==='project'?' · 期间打卡 '+p.completed+' 次':' · 一次性'): '尚未设定计划日期';
 return '<div class="memo-gantt-item" data-gantt-row="'+E(p.key)+'"><div class="memo-gantt-name"><strong>'+E(p.title)+'</strong><div class="gantt-row-actions"><button class="btn btn-small" data-gantt-quick="'+E(p.key)+'">日期/依赖</button><button class="btn btn-small" data-gantt-edit="'+E(p.key)+'">编辑任务</button></div></div>'+
 '<div class="memo-gantt-lane" style="width:'+width+'px">'+(visible?'<span class="memo-gantt-bar'+(p.point?' gantt-milestone':'')+(p.achieved?' gantt-achieved':'')+'" data-gantt-bar-id="'+E(p.key)+'" style="left:'+left+'%;width:'+(p.point?'12px':bar+'%')+'" role="img" aria-label="计划 '+E(label)+'"><i style="width:'+progress+'%"></i></span>':'<span class="memo-gantt-unscheduled">'+(p.valid?'不在当前时间范围':'未设定日期')+'</span>')+'</div>'+
 '<small>'+E(label)+(p.achieved?' · 已完成':'')+(deps.length?' · 前置：'+E(deps.join('、')):'')+(p.conflicts.length?' · ⚠ 前置未完成或日期冲突':'')+'</small></div>';
}
function overlay(m,width){
 const total=Math.max(1,m.to-m.from+1),x=day=>(day-m.from)/total*width;
 let h='<div class="gantt-time-overlay" aria-hidden="true">';
 if(m.now>m.from)h+='<span class="gantt-past" style="width:'+Math.max(0,Math.min(width,x(m.now)))+'px"></span>';
 if(m.now>=m.from&&m.now<=m.to)h+='<span class="gantt-today-line" style="left:'+x(m.now)+'px"><small>今日</small></span>';
 const ms=A.ms?.list?.()||[],byDay=new Map();
 for(const item of ms){const date=item.due||item.end||item.start,d=dayNumber(date);if(d===null||d<m.from||d>m.to)continue;const values=byDay.get(d)||[];values.push(item.name);byDay.set(d,values);}
 for(const [day,titles] of byDay)h+='<span class="gantt-deadline-line" style="left:'+x(day)+'px" title="'+E(dayString(day)+' · '+titles.join('、'))+'"><small>'+E(titles.length===1?titles[0]:titles.length+'个截止日')+'</small></span>';
 return h+'</div>';
}
function html(now=Date.now()){
 const m=model(now),selected=pref('filter','all'),allowed=new Set(['all','',...groups().map(g=>g.id)]);
 const filter=selected==='uncategorized'?'':allowed.has(selected)?selected:'all';
 const categories=[{id:'',name:'未分组'},...groups().map(g=>({id:g.id,name:g.name}))];
 const width=Math.max(580,Math.min(11000,Math.max(1,m.to-m.from+1)*(m.zoom==='month'?20:m.zoom==='quarter'?9:m.zoom==='year'?2.8:3.1)));
 const nav='<div class="gantt-controls"><div class="gantt-filters"><button class="btn btn-small'+(filter==='all'?' btn-primary':'')+'" data-gantt-filter="all">全部</button>'+categories.filter(g=>m.rows.some(p=>p.group===g.id)).map(g=>'<button class="btn btn-small'+(filter===g.id?' btn-primary':'')+'" data-gantt-filter="'+E(g.id||'uncategorized')+'">'+E(g.name)+' ('+m.rows.filter(p=>p.group===g.id).length+')</button>').join('')+'</div>'+
 '<div class="gantt-timeline-controls"><label>范围 <select data-gantt-zoom><option value="month"'+(m.zoom==='month'?' selected':'')+'>月</option><option value="quarter"'+(m.zoom==='quarter'?' selected':'')+'>半年</option><option value="year"'+(m.zoom==='year'?' selected':'')+'>两年</option><option value="all"'+(m.zoom==='all'?' selected':'')+'>全部</option></select></label><button class="btn btn-small" data-gantt-navigate="-1">◀</button><button class="btn btn-small" data-gantt-navigate="0">今天</button><button class="btn btn-small" data-gantt-navigate="1">▶</button><button class="btn btn-small" data-gantt-create>＋ 项目</button><button class="btn btn-small" data-gantt-manage>管理分组</button></div></div>';
 const blocks=categories.filter(g=>(filter==='all'||filter===g.id)&&m.rows.some(p=>p.group===g.id)).map((g,index)=>{
  const all=m.rows.filter(p=>p.group===g.id),k='group:'+g.id;
  const open=pref(k,g.id===''?'closed':(filter!=='all'||index===1)?'open':'closed')==='open';
  const expanded=pref('all:'+g.id,'closed')==='open';
  const visible=all.length>8&&!expanded?all.slice(0,5):all;
  return '<details class="gantt-group" data-gantt-group="'+E(g.id)+'" '+(open?'open':'')+'><summary>'+E(g.name)+' · '+all.length+'项'+(all.length>8&&!expanded?'（显示前5项）':'')+'</summary><div class="gantt-group-body">'+visible.map(p=>rowHtml(p,m,width)).join('')+(all.length>8?'<button class="btn btn-small gantt-expand" data-gantt-expand="'+E(g.id||'uncategorized')+'">'+(expanded?'只显示前5项':'展开其余 '+(all.length-5)+' 项')+'</button>':'')+'</div></details>';
 }).join('');
 const open=pref('root','open')==='open';
 const result='<details class="card memo-gantt" data-gantt-root '+(open?'open':'')+'><summary>长期任务计划 · '+m.rows.length+' 项</summary>'+nav+'<p class="hint">红线：自然日今天；灰色：已经过去的日历；虚线：全局截止日期。依赖仅作提醒。</p>'+
 '<div class="memo-gantt-scroller" role="region" tabindex="0" aria-label="长期任务甘特时间轴"><div class="memo-gantt-track" style="position:relative;min-width:'+width+'px">'+overlay(m,width)+'<div class="memo-gantt-scale" style="width:'+width+'px"><span>'+E(dayString(m.from))+'</span><span>今天 '+E(dayString(m.now))+'</span><span>'+E(dayString(m.to))+'</span></div>'+blocks+'<svg class="memo-gantt-edges" aria-hidden="true" style="position:absolute;top:0;left:0;pointer-events:none;z-index:1;overflow:visible"></svg></div></div></details>';
 requestAnimationFrame(syncEdges);return result;
}
function syncEdges(){
 const root=document.querySelector('#mw-today .memo-gantt[data-gantt-root]');
 if(!root||!root.open)return;
 const track=root.querySelector('.memo-gantt-track'),svg=track?.querySelector('.memo-gantt-edges');if(!svg)return;
 const bounds=track.getBoundingClientRect();
 svg.setAttribute('width',String(track.scrollWidth));svg.setAttribute('height',String(track.scrollHeight));svg.textContent='';
 const defs=document.createElementNS('http://www.w3.org/2000/svg','defs'),marker=document.createElementNS('http://www.w3.org/2000/svg','marker'),tip=document.createElementNS('http://www.w3.org/2000/svg','path');
 marker.setAttribute('id','gantt-175-arrow');marker.setAttribute('markerWidth','7');marker.setAttribute('markerHeight','7');marker.setAttribute('refX','6');marker.setAttribute('refY','3');marker.setAttribute('orient','auto');
 tip.setAttribute('d','M0,0 L6,3 L0,6 Z');tip.setAttribute('fill','#bc903f');marker.appendChild(tip);defs.appendChild(marker);svg.appendChild(defs);
 const shown=new Map([...track.querySelectorAll('[data-gantt-row]')].filter(x=>x.getClientRects().length>0).map(x=>[x.dataset.ganttRow,x]));
 for(const [id,node] of shown){
  const item=locate(id)?.task,bar=node.querySelector('.memo-gantt-bar');
  if(!item||!bar)continue;
  for(const preId of item.memoGanttDependencies||[]){
   const previous=shown.get(normalizeKey(preId))?.querySelector('.memo-gantt-bar');if(!previous)continue;
   const a=previous.getBoundingClientRect(),b=bar.getBoundingClientRect();
   const x1=a.right-bounds.left,y1=a.top+a.height/2-bounds.top;
   const x2=b.left-bounds.left,y2=b.top+b.height/2-bounds.top;
   const mid=Math.max(x1+8,(x1+x2)/2);
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');
   path.setAttribute('d','M'+x1+','+y1+' H'+mid+' V'+y2+' H'+x2);
   path.setAttribute('marker-end','url(#gantt-175-arrow)');path.setAttribute('fill','none');path.setAttribute('stroke','#bc903f');path.setAttribute('stroke-width','1.5');path.setAttribute('opacity','0.75');svg.appendChild(path);
  }
 }
}
function createProject(){
 A.memoWorkspace.editor(null,'extra');
 const radio=document.querySelector('#modal-root [name="mw-repeat"][value="daily"]');
 if(radio){radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));}
}

function quick(key){
 const n=locate(key);if(!n)return A.ui.toast('任务已移动或删除，请刷新');
 if(A.memoActions.busy())return A.ui.toast('请先完成当前保存操作');
 const task=n.task,cats=[{id:'',name:'未分组'},...groups().map(g=>({id:g.id,name:g.name}))];
 const modal=A.ui.openModal('甘特图计划 · '+task.text,
  '<label>所属分组<select id="gq-group">'+cats.map(g=>'<option value="'+E(g.id)+'"'+(n.group===g.id?' selected':'')+'>'+E(g.name)+'</option>').join('')+'</select></label>'+
  dateFields('gq',task.memoGanttStart,task.memoGanttEnd)+
  '<label class="gantt-cross-label"><input type="checkbox" data-gantt-cross> 显示其他分组项目</label><div id="gq-dependency-list" class="gantt-dependency-list"></div>'+
  (n.kind==='project'?'<label><input type="checkbox" id="gq-achieved"'+(task.memoGanttCompletedAt?' checked':'')+'> 长期项目已达成（独立于每日打卡）</label>':'<p class="hint">一次性任务的完成状态仍由三栏打卡控制。</p>')+
  '<p class="hint">计划日期不自动更改三栏安排和历史计时。</p><p id="gq-error" role="alert"></p>',
  '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存计划</button>',{lock:true,wide:true});
 const q=x=>modal.querySelector('#gq-'+x);
 bindDeps(modal,task,q('group'),q('dependency-list'));bindDates(modal,'gq');
 let saving=false;
 A.ui.bindActions({cancel:()=>{if(!saving&&!A.memoActions.busy())A.ui.closeModal();},save:async()=>{
  if(saving)return;saving=true;
  try{
   const ok=await A.memoActions.commit(()=>{
    const current=locate(key);if(!current)throw Error('任务已移动或删除');
    const checked=validate(current.task,q('start').value,q('end').value,selectedDeps(modal));
    if(checked.start)current.task.memoGanttStart=checked.start;else delete current.task.memoGanttStart;
    if(checked.end)current.task.memoGanttEnd=checked.end;else delete current.task.memoGanttEnd;
    current.task.memoGanttDependencies=checked.dependencies;current.task.memoGroup=q('group').value;
    if(n.kind==='project'){
      if(q('achieved').checked)current.task.memoGanttCompletedAt=current.task.memoGanttCompletedAt||new Date().toISOString();
      else delete current.task.memoGanttCompletedAt;
    }
   });
   if(ok){A.ui.closeModal();A.memoWorkspace.render();}
  }catch(e){q('error').textContent=e.message}finally{saving=false}
 }});
}
/* Pointer interactions only on mouse/pen; touch uses the accessible date editor. */
let drag=null;
function proposeDates(id,start,end,operation){
 const task=locate(id)?.task;if(!task)return;
 try{validate(task,start,end,task.memoGanttDependencies||[])}catch(e){return A.ui.toast(e.message)}
 const modal=A.ui.openModal('确认调整长期项目',
  '<p><strong>'+E(task.text)+'</strong></p><p>操作：'+E(operation)+'</p><p>开始：'+E(task.memoGanttStart||'未设置')+' → '+E(start)+'</p><p>截止：'+E(task.memoGanttEnd||'未设置')+' → '+E(end)+'</p><p class="hint">仅修改项目计划日期；不会移动每日打卡、历史记录或其他依赖项目。</p><p id="gantt-drag-error" role="alert"></p>',
  '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认保存</button>',{lock:true});
 let saving=false;
 A.ui.bindActions({cancel:()=>{if(!saving&&!A.memoActions.busy())A.ui.closeModal();},save:async()=>{
  if(saving)return;saving=true;
  try{const ok=await A.memoActions.commit(()=>{
   const t=locate(id)?.task;if(!t)throw Error('项目已不存在');
   const checked=validate(t,start,end,t.memoGanttDependencies||[]);
   t.memoGanttStart=checked.start;t.memoGanttEnd=checked.end;
  });if(ok){A.ui.closeModal();A.memoWorkspace.render();}}
  catch(e){modal.querySelector('#gantt-drag-error').textContent=e.message}
  finally{saving=false}
 }});
}
document.addEventListener('pointerdown',e=>{
 if(e.button!==0||e.pointerType==='touch')return;
 const bar=e.target.closest?.('#mw-today .memo-gantt-bar');if(!bar)return;
 const row=bar.closest('[data-gantt-row]'),task=locate(row?.dataset.ganttRow)?.task;
 if(!task?.memoGanttStart||!task?.memoGanttEnd)return;
 const box=bar.getBoundingClientRect(),lane=bar.closest('.memo-gantt-lane');
 if(!lane||box.width<8)return;
 const near=box.width<25?0:12;
 const mode=near&&e.clientX-box.left<near?'start':near&&box.right-e.clientX<near?'end':'move';
 drag={id:row.dataset.ganttRow,mode,startX:e.clientX,bar,lane,range:model()};
});
document.addEventListener('pointermove',e=>{
 if(!drag)return;
 const dx=e.clientX-drag.startX;
 if(Math.abs(dx)>4){drag.bar.style.outline='2px dashed #bc903f';drag.bar.title='松开后确认修改计划日期';}
});
document.addEventListener('pointerup',e=>{
 if(!drag)return;
 const current=drag;drag=null;current.bar.style.outline='';
 const dx=e.clientX-current.startX;
 if(Math.abs(dx)<6)return;
 const rangeDays=current.range.to-current.range.from+1;
 const delta=Math.round(dx*rangeDays/Math.max(1,current.lane.getBoundingClientRect().width));
 if(!delta)return;
 const project=locate(current.id)?.task;if(!project)return;
 const from=dayNumber(project.memoGanttStart),to=dayNumber(project.memoGanttEnd);
 if(from===null||to===null)return;
 const first=dayString(from+(current.mode==='end'?0:delta));
 const last=dayString(to+(current.mode==='start'?0:delta));
 proposeDates(current.id,first,last,current.mode==='start'?'调整开始日期':current.mode==='end'?'调整截止日期':'整体平移日期');
});
document.addEventListener('pointercancel',()=>{if(drag){drag.bar.style.outline='';drag=null}});

function refresh(){A.memoWorkspace.render();requestAnimationFrame(syncEdges);}
document.addEventListener('click',e=>{
 const rootSummary=e.target.closest?.('.memo-gantt[data-gantt-root] > summary');
 if(rootSummary){const details=rootSummary.closest('[data-gantt-root]');if(details)setPref('root',details.open?'closed':'open');}
 const b=e.target.closest('[data-gantt-create],[data-gantt-manage],[data-gantt-quick],[data-gantt-filter],[data-gantt-navigate],[data-gantt-expand]');if(!b)return;
 e.preventDefault();e.stopPropagation();
 if(b.hasAttribute('data-gantt-create'))return createProject();
 if(b.hasAttribute('data-gantt-manage'))return A.memoOrganize?.openGroups?.();
 if(b.hasAttribute('data-gantt-quick'))return quick(b.dataset.ganttQuick);
 if(b.hasAttribute('data-gantt-filter')){setPref('filter',b.dataset.ganttFilter);return refresh();}
 if(b.hasAttribute('data-gantt-expand')){const id=b.dataset.ganttExpand==='uncategorized'?'':b.dataset.ganttExpand;setPref('all:'+id,pref('all:'+id,'closed')==='open'?'closed':'open');return refresh();}
 if(b.hasAttribute('data-gantt-navigate')){
  const step=Number(b.dataset.ganttNavigate);
  const m=model();const count=m.zoom==='month'?30:m.zoom==='quarter'?90:m.zoom==='year'?365:90;
  setPref('focus',step===0?M().naturalDay():dayString(m.focus+step*count));return refresh();
 }
});
document.addEventListener('change',e=>{const input=e.target.closest('[data-gantt-zoom]');if(!input)return;setPref('zoom',input.value);refresh();});
document.addEventListener('toggle',e=>{const target=e.target;if(target.matches?.('.gantt-group')){setPref('group:'+target.dataset.ganttGroup,target.open?'open':'closed');requestAnimationFrame(syncEdges);}
 if(target.matches?.('.memo-gantt[data-gantt-root]')){setPref('root',target.open?'open':'closed');requestAnimationFrame(syncEdges);}
},true);
window.addEventListener('resize',()=>requestAnimationFrame(syncEdges));
A.memoGantt={validate,model,html,editor,apply,quick,syncEdges,locate,nodes,normalizeKey};
})();