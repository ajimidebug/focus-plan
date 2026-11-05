/* 174.4: read-only planning bars over existing long-term projects. No second task store. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,E=x=>S().esc(String(x??''));
const projects=()=>S().data().memoProjects||[];
const dayNumber=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d?Date.parse(d+'T00:00:00Z')/86400000:null;
const dayString=n=>new Date(n*86400000).toISOString().slice(0,10);
function validate(task,from,to,dependencies=[]){
 const start=from?dayNumber(from):null,end=to?dayNumber(to):null;
 if((from&&!Number.isFinite(start))||(to&&!Number.isFinite(end)))throw Error('长期计划日期无效');
 if((from&&!to)||(!from&&to))throw Error('请同时填写开始和截止日期，或者都留空');
 if(start!==null&&(end<start||end-start>3650))throw Error('长期计划截止不得早于开始，最长10年');
 const deps=[...new Set(dependencies.filter(Boolean))];
 if(deps.length>20)throw Error('依赖项目最多20项');
 const ownId=task?.id;
 const seen=new Set();
 function visit(id){
   if(id===ownId)throw Error('项目依赖形成循环');
   if(seen.has(id))return;
   seen.add(id);
   const p=projects().find(x=>x.id===id);
   if(!p)throw Error('依赖项目不存在，请重新选择');
   (p.memoGanttDependencies||[]).forEach(visit);
 }
 deps.forEach(visit);
 return {start:from||'',end:to||'',dependencies:deps};
}
function editor(modal,task,kind,selectedList){
 const field=document.createElement('fieldset');field.id='memo-gantt-fields';
 field.innerHTML='<legend>长期计划（可选）</legend><div class="memo-gantt-dates"><label>开始日期<input type="date" id="memo-gantt-start" value="'+E(task?.memoGanttStart||'')+'"></label><label>截止日期<input type="date" id="memo-gantt-end" value="'+E(task?.memoGanttEnd||'')+'"></label></div><label>依赖项目（可多选）<select multiple size="3" id="memo-gantt-dependencies">'+projects().filter(x=>x.id!==task?.id&&!x.archived).map(x=>'<option value="'+E(x.id)+'"'+((task?.memoGanttDependencies||[]).includes(x.id)?' selected':'')+'>'+E(x.text)+'</option>').join('')+'</select></label><p class="hint">时间条表示计划期间已经经过的比例；实际完成记录单独统计。依赖仅作提示，不自动改变任务日程。</p>';
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
 if(checked.start){task.memoGanttStart=checked.start;task.memoGanttEnd=checked.end;}else{delete task.memoGanttStart;delete task.memoGanttEnd;}
 task.memoGanttDependencies=checked.dependencies;
}
function model(now=Date.now()){
 const all=projects().filter(p=>!p.archived);
 const planned=all.filter(p=>dayNumber(p.memoGanttStart)!==null&&dayNumber(p.memoGanttEnd)!==null);
 const today=dayNumber(new Date(now+8*3600000).toISOString().slice(0,10));
 const from=planned.length?Math.min(...planned.map(p=>dayNumber(p.memoGanttStart)),today):today-7;
 const to=planned.length?Math.max(...planned.map(p=>dayNumber(p.memoGanttEnd)),today):today+30;
 // A single ten-year project can scroll inside the chart; it never widens the page.
 return {from,to,now:today,rows:all.map(p=>{
   const start=dayNumber(p.memoGanttStart),end=dayNumber(p.memoGanttEnd);
   const days=p.days||{};
   const completed=Object.keys(days).filter(d=>!!days[d]&&start!==null&&end!==null&&dayNumber(d)!==null&&dayNumber(d)>=start&&dayNumber(d)<=end).length;
   const elapsed=start===null?0:Math.max(0,Math.min(end-start+1,today-start+1));
   return {id:p.id,title:p.text,start,end,completed,elapsed,dependencies:p.memoGanttDependencies||[],valid:start!==null&&end!==null};
 })};
}
function html(now=Date.now()){
 const m=model(now);if(!m.rows.length)return '';
 const total=Math.max(1,m.to-m.from+1);
 const width=Math.max(580,Math.min(11000,total*23));
 const rows=m.rows.map(p=>{
  const left=p.valid?(p.start-m.from)/total*100:0;
  const bar=p.valid?(p.end-p.start+1)/total*100:0;
  const progress=p.valid?Math.max(0,Math.min(100,(m.now-p.start+1)/(p.end-p.start+1)*100)):0;
  const depNames=p.dependencies.map(id=>m.rows.find(x=>x.id===id)?.title||'已停用或已删除项目');
  return '<div class="memo-gantt-item"><div class="memo-gantt-name"><strong>'+E(p.title)+'</strong><button class="btn btn-small" data-gantt-edit="'+E(p.id)+'">编辑计划</button></div><div class="memo-gantt-lane" style="width:'+width+'px">'+(p.valid?'<span class="memo-gantt-bar" style="left:'+left+'%;width:'+bar+'%" role="img" aria-label="计划 '+E(dayString(p.start))+' 至 '+E(dayString(p.end))+'，已过去 '+Math.round(progress)+'%"><i style="width:'+progress+'%"></i></span>':'<span class="memo-gantt-unscheduled">未设定计划起止日期</span>')+'</div><small>'+(p.valid?E(dayString(p.start)+' — '+dayString(p.end))+' · 已过去 '+Math.round(progress)+'% · 此期间完成打卡 '+p.completed+'次 / 已过 '+p.elapsed+'天':'尚未安排日期')+(depNames.length?' · 依赖：'+E(depNames.join('、')):'')+'</small></div>';
 }).join('');
 return '<details class="card memo-gantt" data-gantt-root><summary>长期任务计划 · '+m.rows.length+'项</summary><p class="hint">只读甘特图：色块长度表示计划日期跨度，填充表示日历时间经过；任务实际完成、预计学习时长和积分均另行计算。</p><div class="memo-gantt-scroller" role="region" tabindex="0" aria-label="长期任务甘特时间轴"><div class="memo-gantt-scale" style="width:'+width+'px"><span>'+E(dayString(m.from))+'</span><span>今天 '+E(dayString(m.now))+'</span><span>'+E(dayString(m.to))+'</span></div>'+rows+'</div></details>';
}
A.memoGantt={validate,model,html,editor,apply};
})();