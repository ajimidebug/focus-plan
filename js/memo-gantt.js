/* 175: editable long-term project planner over memoProjects; no parallel task store. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore,E=x=>S().esc(String(x??''));
const projects=()=>S().data().memoProjects||[],groups=()=>S().data().memoTaskGroups||[];
const DAY=86400000;
const dayNumber=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d?Date.parse(d+'T00:00:00Z')/DAY:null;
const dayString=n=>new Date(n*DAY).toISOString().slice(0,10);
function pref(key,fallback){try{return localStorage.getItem('gantt-175:'+key)||fallback}catch{return fallback}}
function setPref(key,value){try{localStorage.setItem('gantt-175:'+key,value)}catch{}}
function category(p){return groups().some(g=>g.id===p.memoGroup)?p.memoGroup||'':''}
function groupTitle(id){return id?(groups().find(g=>g.id===id)?.name||'未分类'):'未分类'}
function validate(task,from,to,dependencies=[]){
 const start=from?dayNumber(from):null,end=to?dayNumber(to):null;
 if((from&&!Number.isFinite(start))||(to&&!Number.isFinite(end)))throw Error('长期计划日期无效');
 if((from&&!to)||(!from&&to))throw Error('请同时填写开始和截止日期，或者都留空');
 if(start!==null&&(end<start||end-start>3650))throw Error('长期计划截止不得早于开始，最长10年');
 if(!Array.isArray(dependencies))throw Error('依赖项目格式异常');
 const deps=[...new Set(dependencies.filter(Boolean))];
 if(deps.length>20)throw Error('依赖项目最多20项');
 const ownId=task?.id,seen=new Set();
 function visit(id){
   if(id===ownId)throw Error('项目依赖形成循环');
   if(seen.has(id))return;seen.add(id);
   const p=projects().find(x=>x.id===id);
   if(!p)throw Error('依赖项目不存在，请重新选择');
   if(p.memoGanttDependencies!=null&&!Array.isArray(p.memoGanttDependencies))throw Error('前置项目依赖格式异常');
   p.memoGanttDependencies.forEach(visit);
 }
 deps.forEach(visit);
 return {start:from||'',end:to||'',dependencies:deps};
}
function editor(modal,task,kind,selectedList){
 const field=document.createElement('fieldset');field.id='memo-gantt-fields';
 field.innerHTML='<legend>长期计划（可选）</legend><div class="memo-gantt-dates"><label>开始日期<input type="date" id="memo-gantt-start" value="'+E(task?.memoGanttStart||'')+'"></label><label>截止日期<input type="date" id="memo-gantt-end" value="'+E(task?.memoGanttEnd||'')+'"></label></div><label>依赖项目（可多选）<select multiple size="4" id="memo-gantt-dependencies">'+projects().filter(x=>x.id!==task?.id&&(!x.archived||(task?.memoGanttDependencies||[]).includes(x.id))).map(x=>'<option value="'+E(x.id)+'"'+((task?.memoGanttDependencies||[]).includes(x.id)?' selected':'')+'>'+E(x.text)+(x.archived?'（已停用）':'')+'</option>').join('')+'</select></label><p class="hint">依赖提供前置关系和日期冲突提示，不会自动移动项目或每日任务。</p>';
 modal.querySelector('#mw-form-error').before(field);
 const update=()=>{
  const list=modal.querySelector('#mw-list')?.value||selectedList;
  const repeat=modal.querySelector('[name="mw-repeat"]:checked')?.value;
  field.hidden=kind!=='project'&&!(kind==='task'&&list==='extra'&&repeat==='daily');
 };
 modal.querySelector('#mw-list')?.addEventListener('change',update);
 modal.querySelectorAll('[name="mw-repeat"]').forEach(x=>x.addEventListener('change',update));
 update();
}
function apply(task,modal){
 const field=modal.querySelector('#memo-gantt-fields');if(!field||field.hidden)return;
 const from=modal.querySelector('#memo-gantt-start').value,to=modal.querySelector('#memo-gantt-end').value;
 const deps=[...modal.querySelector('#memo-gantt-dependencies').selectedOptions].map(x=>x.value);
 const checked=validate(task,from,to,deps);
 if(checked.start){task.memoGanttStart=checked.start;task.memoGanttEnd=checked.end;}
 else{delete task.memoGanttStart;delete task.memoGanttEnd;}
 task.memoGanttDependencies=checked.dependencies;
}
function model(now=Date.now()){
 const today=dayNumber(M().userDay(now)),all=projects().filter(p=>!p.archived);
 const zoom=['month','quarter','year','all'].includes(pref('zoom','quarter'))?pref('zoom','quarter'):'quarter';
 const focus=dayNumber(pref('focus',M().userDay(now)))??today;
 const rawRows=all.map(p=>{
  const start=dayNumber(p.memoGanttStart),end=dayNumber(p.memoGanttEnd),days=p.days||{};
  const completed=Object.keys(days).filter(d=>!!days[d]&&start!==null&&end!==null&&dayNumber(d)!==null&&dayNumber(d)>=start&&dayNumber(d)<=end).length;
  const elapsed=start===null?0:Math.max(0,Math.min(end-start+1,today-start+1));
  const conflicts=(p.memoGanttDependencies||[]).filter(id=>{const prev=projects().find(x=>x.id===id);return prev?.memoGanttEnd&&p.memoGanttStart&&prev.memoGanttEnd>p.memoGanttStart});
  return {id:p.id,title:p.text,start,end,completed,elapsed,dependencies:p.memoGanttDependencies||[],valid:start!==null&&end!==null,group:category(p),achieved:!!p.memoGanttCompletedAt,conflicts};
 });
 const byDeadline=(a,b)=>Number(a.achieved)-Number(b.achieved)||(a.end??Infinity)-(b.end??Infinity)||a.title.localeCompare(b.title);
 rawRows.sort(byDeadline);
 const planned=rawRows.filter(p=>p.valid);
 const from=zoom==='all'?(planned.length?Math.min(today,...planned.map(p=>p.start)):today-7):focus-(zoom==='month'?10:zoom==='quarter'?30:120);
 const to=zoom==='all'?(planned.length?Math.max(today,...planned.map(p=>p.end)):today+30):focus+(zoom==='month'?50:zoom==='quarter'?180:730);
 return {from,to,now:today,focus,zoom,rows:rawRows};
}
function rowHtml(p,m,width){
 const total=Math.max(1,m.to-m.from+1),lo=p.valid?Math.max(m.from,p.start):null,hi=p.valid?Math.min(m.to,p.end):null;
 const visible=p.valid&&lo<=hi,left=visible?(lo-m.from)/total*100:0,bar=visible?(hi-lo+1)/total*100:0;
 const progress=p.valid?Math.max(0,Math.min(100,(m.now-p.start+1)/(p.end-p.start+1)*100)):0;
 const depNames=p.dependencies.map(id=>{const pre=projects().find(x=>x.id===id);return (pre?.text||'不存在的项目')+(pre?.archived?'（已停用）':'');});
 const label=p.valid?dayString(p.start)+' — '+dayString(p.end)+' · 期间打卡 '+p.completed+' 次':'尚未安排计划日期';
 return '<div class="memo-gantt-item" data-gantt-row="'+E(p.id)+'"><div class="memo-gantt-name"><strong>'+E(p.title)+'</strong><div class="gantt-row-actions"><button class="btn btn-small" data-gantt-quick="'+E(p.id)+'">日期/依赖</button><button class="btn btn-small" data-gantt-edit="'+E(p.id)+'">编辑计划</button></div></div>'+
  '<div class="memo-gantt-lane" style="width:'+width+'px">'+(visible?'<span class="memo-gantt-bar" data-gantt-bar-id="'+E(p.id)+'" style="left:'+left+'%;width:'+bar+'%" role="img" aria-label="计划 '+E(dayString(p.start))+' 至 '+E(dayString(p.end))+'，已过 '+Math.round(progress)+'%"><i style="width:'+progress+'%"></i></span>':'<span class="memo-gantt-unscheduled">'+(p.valid?'不在当前时间范围':'未设定日期')+'</span>')+'</div>'+
  '<small>'+E(label)+(p.achieved?' · 项目已达成':'')+(depNames.length?' · 前置：'+E(depNames.join('、')):'')+(p.conflicts.length?' · ⚠ 前置日期冲突':'')+'</small></div>';
}
function html(now=Date.now()){
 const m=model(now);if(!m.rows.length)return '<div class="card memo-gantt"><button class="btn" data-gantt-create>＋ 新建长期项目</button></div>';
 const selected=pref('filter','all'),allowed=new Set(['all','',...groups().map(g=>g.id)]);
 const filter=selected==='uncategorized'?'':allowed.has(selected)?selected:'all';
 const categories=[{id:'',name:'未分类'},...groups().map(g=>({id:g.id,name:g.name}))].filter(g=>m.rows.some(p=>p.group===g.id));
 const width=Math.max(580,Math.min(11000,Math.max(1,m.to-m.from+1)*(m.zoom==='month'?20:m.zoom==='quarter'?9:m.zoom==='year'?2.8:3.1)));
 const nav='<div class="gantt-controls"><div class="gantt-filters"><button class="btn btn-small'+(filter==='all'?' btn-primary':'')+'" data-gantt-filter="all">全部</button>'+categories.map(g=>'<button class="btn btn-small'+(filter===g.id?' btn-primary':'')+'" data-gantt-filter="'+E(g.id||'uncategorized')+'">'+E(g.name)+' ('+m.rows.filter(p=>p.group===g.id).length+')</button>').join('')+'</div>'+
   '<div class="gantt-timeline-controls"><label>范围 <select data-gantt-zoom><option value="month"'+(m.zoom==='month'?' selected':'')+'>月</option><option value="quarter"'+(m.zoom==='quarter'?' selected':'')+'>半年</option><option value="year"'+(m.zoom==='year'?' selected':'')+'>两年</option><option value="all"'+(m.zoom==='all'?' selected':'')+'>全部</option></select></label><button class="btn btn-small" data-gantt-navigate="-1">◀</button><button class="btn btn-small" data-gantt-navigate="0">今天</button><button class="btn btn-small" data-gantt-navigate="1">▶</button><button class="btn btn-small btn-primary" data-gantt-create>＋ 项目</button></div></div>';
 const blocks=categories.filter(g=>filter==='all'||filter===g.id).map((g,index)=>{
   const all=m.rows.filter(p=>p.group===g.id),k='group:'+g.id;
   const open=pref(k,(filter!=='all'||index===0)?'open':'closed')==='open';
   const expanded=pref('all:'+g.id,'closed')==='open';
   const visible=all.length>8&&!expanded?all.slice(0,5):all;
   return '<details class="gantt-group" data-gantt-group="'+E(g.id)+'" '+(open?'open':'')+'><summary>'+E(g.name)+' · '+all.length+'项'+(all.length>8&&!expanded?'（显示前5项）':'')+'</summary><div class="gantt-group-body">'+visible.map(p=>rowHtml(p,m,width)).join('')+(all.length>8?'<button class="btn btn-small gantt-expand" data-gantt-expand="'+E(g.id||'uncategorized')+'">'+(expanded?'只显示前5项':'展开其余 '+(all.length-5)+' 项')+'</button>':'')+'</div></details>';
 }).join('');
 const result='<details class="card memo-gantt" data-gantt-root><summary>长期任务计划 · '+m.rows.length+' 项</summary>'+nav+
  '<p class="hint">色条填充表示计划时间经过比例；实际打卡次数另列。箭头表示前置依赖，仅作提醒，不自动改期。</p>'+
  '<div class="memo-gantt-scroller" role="region" tabindex="0" aria-label="长期任务甘特时间轴"><div class="memo-gantt-track" style="position:relative;min-width:'+width+'px"><div class="memo-gantt-scale" style="width:'+width+'px"><span>'+E(dayString(m.from))+'</span><span>今天 '+E(dayString(m.now))+'</span><span>'+E(dayString(m.to))+'</span></div>'+blocks+'<svg class="memo-gantt-edges" aria-hidden="true" style="position:absolute;top:0;left:0;pointer-events:none;z-index:1;overflow:visible"></svg></div></div></details>';
 requestAnimationFrame(syncEdges);
 return result;
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
 const shown=new Map([...track.querySelectorAll('[data-gantt-row]')].map(x=>[x.dataset.ganttRow,x]));
 for(const [id,node] of shown){
  const item=projects().find(x=>x.id===id),bar=node.querySelector('.memo-gantt-bar');
  if(!item||!bar)continue;
  for(const preId of item.memoGanttDependencies||[]){
   const previous=shown.get(preId)?.querySelector('.memo-gantt-bar');if(!previous)continue;
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
function quick(id){
 const task=projects().find(p=>p.id===id);if(!task)return A.ui.toast('项目不存在，请刷新');
 if(A.memoActions.busy())return A.ui.toast('请先完成当前保存操作');
 const cats=[{id:'',name:'未分类'},...groups().map(g=>({id:g.id,name:g.name}))];
 const modal=A.ui.openModal('项目计划 · '+task.text,
  '<div class="memo-gantt-dates"><label>开始日期<input type="date" id="gq-start" value="'+E(task.memoGanttStart||'')+'"></label><label>截止日期<input type="date" id="gq-end" value="'+E(task.memoGanttEnd||'')+'"></label></div>'+
  '<label>类别<select id="gq-group">'+cats.map(g=>'<option value="'+E(g.id)+'"'+(category(task)===g.id?' selected':'')+'>'+E(g.name)+'</option>').join('')+'</select></label>'+
  '<label>前置依赖（可多选）<select id="gq-dependencies" multiple size="5">'+projects().filter(p=>p.id!==id&&(!p.archived||(task.memoGanttDependencies||[]).includes(p.id))).map(p=>'<option value="'+E(p.id)+'"'+((task.memoGanttDependencies||[]).includes(p.id)?' selected':'')+'>'+E(p.text)+'</option>').join('')+'</select></label>'+
  '<label><input type="checkbox" id="gq-achieved"'+(task.memoGanttCompletedAt?' checked':'')+'>长期项目已达成（独立于每日打卡）</label>'+
  '<p class="hint">只改变长期计划与达成标记，不移动已有每日任务和计时记录。</p><p id="gq-error" role="alert"></p>',
  '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存计划</button>',{lock:true});
 const q=x=>modal.querySelector('#gq-'+x);
 let saving=false;
 A.ui.bindActions({cancel:()=>{if(!saving&&!A.memoActions.busy())A.ui.closeModal();},save:async()=>{
  if(saving)return;saving=true;
  try{const ok=await A.memoActions.commit(()=>{
    const current=projects().find(p=>p.id===id);if(!current)throw Error('项目已删除');
    const deps=[...q('dependencies').selectedOptions].map(x=>x.value),checked=validate(current,q('start').value,q('end').value,deps);
    if(checked.start){current.memoGanttStart=checked.start;current.memoGanttEnd=checked.end;}else{delete current.memoGanttStart;delete current.memoGanttEnd;}
    current.memoGanttDependencies=checked.dependencies;current.memoGroup=q('group').value;
    if(q('achieved').checked)current.memoGanttCompletedAt=current.memoGanttCompletedAt||new Date().toISOString();
    else delete current.memoGanttCompletedAt;
  });
  if(ok){A.ui.closeModal();A.memoWorkspace.render();}
  }catch(e){q('error').textContent=e.message}finally{saving=false}
 }});
}

/* Pointer interactions only on mouse/pen; touch uses the accessible date editor. */
let drag=null;
function proposeDates(id,start,end,operation){
 const task=projects().find(x=>x.id===id);if(!task)return;
 try{validate(task,start,end,task.memoGanttDependencies||[])}catch(e){return A.ui.toast(e.message)}
 const modal=A.ui.openModal('确认调整长期项目',
  '<p><strong>'+E(task.text)+'</strong></p><p>操作：'+E(operation)+'</p><p>开始：'+E(task.memoGanttStart||'未设置')+' → '+E(start)+'</p><p>截止：'+E(task.memoGanttEnd||'未设置')+' → '+E(end)+'</p><p class="hint">仅修改项目计划日期；不会移动每日打卡、历史记录或其他依赖项目。</p><p id="gantt-drag-error" role="alert"></p>',
  '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认保存</button>',{lock:true});
 let saving=false;
 A.ui.bindActions({cancel:()=>{if(!saving&&!A.memoActions.busy())A.ui.closeModal();},save:async()=>{
  if(saving)return;saving=true;
  try{const ok=await A.memoActions.commit(()=>{
   const t=projects().find(x=>x.id===id);if(!t)throw Error('项目已不存在');
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
 const row=bar.closest('[data-gantt-row]'),task=projects().find(p=>p.id===row?.dataset.ganttRow);
 if(!task?.memoGanttStart||!task?.memoGanttEnd)return;
 const box=bar.getBoundingClientRect(),lane=bar.closest('.memo-gantt-lane');
 if(!lane||box.width<8)return;
 const near=box.width<25?0:12;
 const mode=near&&e.clientX-box.left<near?'start':near&&box.right-e.clientX<near?'end':'move';
 drag={id:task.id,mode,startX:e.clientX,bar,lane,range:model()};
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
 const project=projects().find(p=>p.id===current.id);if(!project)return;
 const from=dayNumber(project.memoGanttStart),to=dayNumber(project.memoGanttEnd);
 if(from===null||to===null)return;
 const first=dayString(from+(current.mode==='end'?0:delta));
 const last=dayString(to+(current.mode==='start'?0:delta));
 proposeDates(project.id,first,last,current.mode==='start'?'调整开始日期':current.mode==='end'?'调整截止日期':'整体平移日期');
});
document.addEventListener('pointercancel',()=>{if(drag){drag.bar.style.outline='';drag=null}});

function refresh(){A.memoWorkspace.render();requestAnimationFrame(syncEdges);}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-gantt-create],[data-gantt-quick],[data-gantt-filter],[data-gantt-navigate],[data-gantt-expand]');if(!b)return;
 e.preventDefault();e.stopPropagation();
 if(b.hasAttribute('data-gantt-create'))return createProject();
 if(b.hasAttribute('data-gantt-quick'))return quick(b.dataset.ganttQuick);
 if(b.hasAttribute('data-gantt-filter')){setPref('filter',b.dataset.ganttFilter);return refresh();}
 if(b.hasAttribute('data-gantt-expand')){const id=b.dataset.ganttExpand==='uncategorized'?'':b.dataset.ganttExpand;setPref('all:'+id,pref('all:'+id,'closed')==='open'?'closed':'open');return refresh();}
 if(b.hasAttribute('data-gantt-navigate')){
  const step=Number(b.dataset.ganttNavigate);
  const m=model();const count=m.zoom==='month'?30:m.zoom==='quarter'?90:m.zoom==='year'?365:90;
  setPref('focus',step===0?M().userDay():dayString(m.focus+step*count));return refresh();
 }
});
document.addEventListener('change',e=>{const input=e.target.closest('[data-gantt-zoom]');if(!input)return;setPref('zoom',input.value);refresh();});
document.addEventListener('toggle',e=>{const target=e.target;if(target.matches?.('.gantt-group')){setPref('group:'+target.dataset.ganttGroup,target.open?'open':'closed');requestAnimationFrame(syncEdges);}
 if(target.matches?.('.memo-gantt[data-gantt-root]'))requestAnimationFrame(syncEdges);
},true);
window.addEventListener('resize',()=>requestAnimationFrame(syncEdges));
A.memoGantt={validate,model,html,editor,apply,quick,syncEdges};
})();