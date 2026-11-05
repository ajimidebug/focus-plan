/* Selective AI-friendly module exchange. It creates new plans; history, points, and timers are never restored here. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore;
const specs=[
 ['required','必做任务',true],['ideal','理想任务',true],['extra','长期拓展任务',true],
 ['queue','待安排队列',true],['review','间隔复习系列',true],['recurrence','周期与持续复习',true],
 ['projects','长期项目与甘特计划',true],['wishlist','愿望单',true],
 ['schedule','时间计划（只读导出）',false],['checkins','积分习惯（只读导出）',false],
 ['ledger','积分流水（只读导出）',false]
];
const allowed=new Set(specs.map(x=>x[0])),clone=x=>JSON.parse(JSON.stringify(x));
const bounded=(v,max=160)=>{if(typeof v!=='string'||v.length>max)throw Error('文本字段格式或长度无效');return v;};
const title=v=>{const t=bounded(v,180).trim();if(!t)throw Error('任务名称不可为空');return t;};
const note=v=>bounded(v??'',4000);
const number=(v,max)=>{const n=Number(v??0);if(!Number.isFinite(n)||n<0||n>max)throw Error('数值字段不合法');return n;};
const validDay=x=>typeof x==='string'&&M().validDate(x);
const safeKey=(value,mod,row)=>{
 if(value!=null){const key=bounded(value,220).trim();if(!key)throw Error('externalKey 无效');return key.startsWith(mod+':')?key:mod+':'+key;}
 const str=JSON.stringify([mod,row]);let n=2166136261;for(let i=0;i<str.length;i++)n=Math.imul(n^str.charCodeAt(i),16777619);
 return mod+':auto-'+(n>>>0).toString(16)+':'+str.length;
};
function mapExport(name,rows){
 return rows.map((r,i)=>({externalKey:r.memoImportKey||'focus-plan:'+name+':'+(r.id||i),sourceId:r.id||null,text:r.text||r.name||'',note:r.note||'',points:r.points??1,estimatedMinutes:r.estimatedMinutes||0}));
}

function ganttMeta(t,d){
 return {memoGroup:t.memoGroup||'',memoGroupName:(d.memoTaskGroups||[]).find(g=>g.id===t.memoGroup)?.name||'',
 memoGanttStart:t.memoGanttStart||'',memoGanttEnd:t.memoGanttEnd||'',
 memoGanttDependencies:clone(t.memoGanttDependencies||[])};
}
function collect(){
 const d=S().data(),out={required:[],ideal:[],extra:[],queue:[],review:[],recurrence:[],projects:[],wishlist:[],schedule:[],checkins:[],ledger:[]};
 for(const [day,value] of Object.entries(d.days||{}))for(const list of ['required','ideal','extra']){
  for(const t of value.tasks?.[list]||[]){
   if(t.fromQueue||t.fromDaily||t.memoProjectId||t.memoMovedTo||t.memoDismissed||t.memoReviewRoundId||t.memoOccurrenceId)continue;
   out[list].push({externalKey:t.memoImportKey||'focus-plan:'+list+':'+day+':'+t.id,sourceId:t.id,day,text:t.text,note:t.note||'',points:t.points??1,estimatedMinutes:t.estimatedMinutes||0,priorityWeight:t.priorityWeight??3,...ganttMeta(t,d)});
  }
 }
 out.queue=(d.queue||[]).filter(t=>!t.memoDismissed&&!t.doneAt).map(t=>({externalKey:t.memoImportKey||'focus-plan:queue:'+t.id,sourceId:t.id,text:t.text,note:t.note||'',points:t.points??1,estimatedMinutes:t.estimatedMinutes||0,day:t.assignment?.day||null,list:t.assignment?.list||null,...ganttMeta(t,d)}));
 out.review=(d.memoReview?.series||[]).filter(s=>!s.stoppedAt).map(s=>{
  const r=(d.memoReview?.rounds||[]).filter(r=>r.seriesId===s.id&&r.status==='pending').sort((a,b)=>a.due-b.due)[0];
  return {externalKey:s.memoImportKey||'focus-plan:review:'+s.id,sourceId:s.id,text:s.text,note:s.note||'',points:s.points??1,estimatedMinutes:s.estimatedMinutes||0,list:s.list||'ideal',intervals:clone(s.intervals||[]),due:r?.due||null};
 });
 out.recurrence=(d.memoRecurrence?.series||[]).filter(s=>!s.stoppedAt).map(s=>{
  const c=A.memoRecurrence.config(s,M().userDay())||s.revisions?.at(-1);
  return c?{externalKey:s.memoImportKey||'focus-plan:recurrence:'+s.id,sourceId:s.id,text:c.text,note:c.note||'',points:c.points??1,estimatedMinutes:c.estimatedMinutes||0,list:c.list||'ideal',rule:clone(c.rule),reviewMode:!!s.reviewMode,end:s.end||null}:null;
 }).filter(Boolean);
 out.projects=(d.memoProjects||[]).filter(p=>!p.archived).map(p=>({externalKey:p.memoImportKey||'focus-plan:projects:'+p.id,sourceId:p.id,text:p.text,note:p.note||'',memoGroup:p.memoGroup||'',memoGroupName:(d.memoTaskGroups||[]).find(g=>g.id===p.memoGroup)?.name||'',memoGanttStart:p.memoGanttStart||'',memoGanttEnd:p.memoGanttEnd||'',memoGanttDependencies:clone(p.memoGanttDependencies||[]),dependencyKeys:(p.memoGanttDependencies||[]).some(id=>id.startsWith('once:'))?[]:(p.memoGanttDependencies||[]).map(id=>{const dep=(d.memoProjects||[]).find(x=>x.id===id);return dep?.memoImportKey||'focus-plan:projects:'+id;})}));
 out.wishlist=(d.memoWishes||[]).filter(w=>!w.hidden&&!w.purchase).map(w=>({externalKey:w.memoImportKey||'focus-plan:wishlist:'+w.id,sourceId:w.id,name:w.name,cents:w.cents}));
 out.schedule=clone(d.memoSchedule?.items||[]);
 out.checkins=clone(d.checkins||[]);
 out.ledger=clone(d.ledger||[]);
 return out;
}
function exportData(names) {
 const namesUnique=[...new Set(names)];
 if(!namesUnique.length||namesUnique.some(x=>!allowed.has(x)))throw Error('请至少勾选一个有效模块');
 const source=collect(),modules={};for(const name of namesUnique)modules[name]=source[name];
 return {format:'focus-plan-modules',version:1,exportedAt:new Date().toISOString(),
  advice:'仅用于按模块新建计划和审计；不含完整图片、计时和积分恢复能力。请使用设置中的完整备份恢复个人数据。',
  modules};
}
function parse(json){
 if(typeof json!=='string'||json.length>2_000_000)throw Error('文件超过 2 MB 限额');
 let data;try{data=JSON.parse(json);}catch{throw Error('JSON 格式无法解析');}
 if(!data||data.format!=='focus-plan-modules'||data.version!==1||!data.modules||typeof data.modules!=='object'||Array.isArray(data.modules))throw Error('不支持的模块文件格式或版本');
 const keys=Object.keys(data.modules);
 if(!keys.length||keys.some(k=>!allowed.has(k)))throw Error('文件包含未知模块或没有模块');
 let total=0;for(const key of keys){if(!Array.isArray(data.modules[key]))throw Error(key+' 必须为数组');total+=data.modules[key].length;}
 if(total>2000)throw Error('单次最多导入 2000 项；请分批操作');
 return data;
}
function existing(mod){
 const d=S().data(),rows=mod==='queue'?(d.queue||[]).concat(d.queueDone||[]):mod==='projects'?d.memoProjects||[]:mod==='wishlist'?d.memoWishes||[]:mod==='review'?d.memoReview?.series||[]:mod==='recurrence'?d.memoRecurrence?.series||[]:Object.values(d.days||{}).flatMap(day=>day.tasks?.[mod]||[]);
 return rows;
}
function prepareOne(mod,raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('导入项必须是对象');
 const item={};
 if(mod==='wishlist'){
  item.name=title(raw.name);item.cents=number(raw.cents,100000000);
 }else{
  item.text=title(raw.text);item.note=note(raw.note);
  item.points=number(raw.points??1,100000);
  item.estimatedMinutes=number(raw.estimatedMinutes,1440);
 }
 if(['required','ideal','extra'].includes(mod)){
  item.day=raw.day==null?M().userDay():raw.day;
  if(!validDay(item.day))throw Error('无效日期：'+String(item.day));
  if(mod==='required'){const weight=Number(raw.priorityWeight??3);if(!Number.isInteger(weight)||weight<1||weight>5)throw Error('必做权重应为 1—5');item.priorityWeight=weight;}
 }
 if(mod==='queue'){
  item.day=raw.day||null;item.list=raw.list||null;
  if(item.day&&!validDay(item.day))throw Error('队列安排日期不合法');
  if(item.list&&!['required','ideal','extra'].includes(item.list))throw Error('队列栏目不合法');
  if(Boolean(item.day)!==Boolean(item.list))throw Error('队列日期和栏目须同时提供');
 }
 if(mod==='review'){
  item.list=raw.list||'ideal';if(!['required','ideal','extra'].includes(item.list))throw Error('复习栏目不合法');
  item.intervals=raw.intervals==null?[]:raw.intervals;
  if(!Array.isArray(item.intervals)||item.intervals.length>100||item.intervals.some(n=>!Number.isSafeInteger(n)||n<1||n>5270400))throw Error('复习间隔数组无效');
  item.due=raw.due==null?null:Number(raw.due);
  if(item.due!==null&&(!Number.isFinite(item.due)||item.due<=0))throw Error('复习到期时间无效');
 }
 if(mod==='recurrence'){
  item.list=raw.list||'ideal';if(!['required','ideal','extra'].includes(item.list))throw Error('周期栏目不合法');
  item.rule=clone(raw.rule);A.memoRecurrence.validateRule(item.rule);
  item.reviewMode=!!raw.reviewMode;item.end=item.reviewMode?null:raw.end||null;
  if(item.end&&!validDay(item.end))throw Error('周期结束日期无效');
 }
 if(['required','ideal','extra','queue','projects'].includes(mod)){
  item.memoGanttStart=raw.memoGanttStart||'';item.memoGanttEnd=raw.memoGanttEnd||'';
  A.memoGantt.validate(null,item.memoGanttStart,item.memoGanttEnd,[]);
  item.memoGroupName=bounded(raw.memoGroupName||'',100).trim();
  item.memoGroup=bounded(raw.memoGroup||'',220);
  item.memoGanttDependencies=raw.memoGanttDependencies||[];
  item.dependencyKeys=raw.dependencyKeys||[];
  if(!Array.isArray(item.memoGanttDependencies)||!Array.isArray(item.dependencyKeys)||item.memoGanttDependencies.length>20||item.dependencyKeys.length>20||item.memoGanttDependencies.some(x=>typeof x!=='string'||x.length>220)||item.dependencyKeys.some(x=>typeof x!=='string'||x.length>220))throw Error('甘特图依赖引用无效');
 }
 return item;
}
function preview(data,names){
 const out={rows:[],create:0,skip:0,unavailable:[]};const seen=new Set();
 for(const mod of [...new Set(names)]){
  if(!allowed.has(mod)||!Object.hasOwn(data.modules,mod))throw Error('所选模块不存在：'+mod);
  if(!specs.find(s=>s[0]===mod)[2]){out.unavailable.push(mod);continue;}
  const candidates=existing(mod);
  for(const raw of data.modules[mod]){
   const item=prepareOne(mod,raw),key=safeKey(raw.externalKey,mod,item);
   const sourceId=typeof raw.sourceId==='string'&&raw.sourceId.length<=220?raw.sourceId:null;
   const isDuplicate=seen.has(key)||candidates.some(x=>x.memoImportKey===key||(sourceId&&x.id===sourceId));
   seen.add(key);out.rows.push({mod,key,item,sourceId,skip:isDuplicate});
   if(isDuplicate)out.skip++;else out.create++;
  }
 }
 // Validate references across all task modules before mutating stored data.
 const linked=out.rows.filter(r=>['required','ideal','extra','queue','projects'].includes(r.mod));
 const existingOnce=Object.values(S().data().days||{}).flatMap(d=>Object.values(d.tasks||{}).flat()).concat(S().data().queue||[],S().data().queueDone||[]);
 const availableProject=new Set([...(S().data().memoProjects||[]).map(t=>t.id),...linked.filter(r=>r.mod==='projects').map(r=>r.sourceId)]);
 const availableOnce=new Set([...existingOnce.map(t=>t.id),...linked.filter(r=>r.mod!=='projects').map(r=>r.sourceId)]);
 const availableKeys=new Set([...linked.flatMap(r=>[r.key,r.sourceId,r.sourceId?'focus-plan:projects:'+r.sourceId:''].filter(Boolean)),...(S().data().memoProjects||[]).flatMap(p=>[p.memoImportKey,'focus-plan:projects:'+p.id].filter(Boolean))]);
 for(const row of linked){
  if(row.skip)continue;
  const refs=row.item.dependencyKeys.length?row.item.dependencyKeys:row.item.memoGanttDependencies;
  const missing=refs.filter(ref=>{
   if(ref.startsWith('once:'))return !availableOnce.has(ref.slice(5));
   if(ref.startsWith('project:'))return !availableProject.has(ref.slice(8));
   return !availableProject.has(ref)&&!availableKeys.has(ref)&&!availableKeys.has(ref.startsWith('projects:')?ref:'projects:'+ref);
  });
  if(missing.length)throw Error('任务「'+row.item.text+'」存在缺失前置依赖：'+missing.join('、')+'。请同时导入依赖任务或显式移除关系。');
 }
 return out;
}
function applyCore(plan){
 const d=S().data(),now=new Date().toISOString(),today=M().userDay();
 for(const row of plan.rows){
  if(row.skip)continue;
  const {mod,key,item}=row;
  const arr=existing(mod);if(arr.some(x=>x.memoImportKey===key||(row.sourceId&&x.id===row.sourceId)))continue;
  if(['required','ideal','extra'].includes(mod)){
   S().getDay(item.day).tasks[mod].push({id:S().uid(),text:item.text,note:item.note,points:item.points,estimatedMinutes:item.estimatedMinutes,priorityWeight:item.priorityWeight??3,memoImportKey:key,dateBasis:'user',createdAt:now});
  }else if(mod==='queue'){
   d.queue=d.queue||[];d.queue.push({id:S().uid(),text:item.text,note:item.note,points:item.points,estimatedMinutes:item.estimatedMinutes,memoImportKey:key,createdAt:now,...(item.day?{assignment:{day:item.day,list:item.list,at:now}}:{})});
  }else if(mod==='review'){
   const due=item.due&&item.due>Date.now()?item.due:null;
   const series=A.memoReview.newSeriesCore({...item,due});series.memoImportKey=key;
  }else if(mod==='recurrence'){
   const series=A.memoRecurrence.newSeriesCore({...item,end:item.end&&item.end>=today?item.end:null});series.memoImportKey=key;
  }else if(mod==='projects'){
   d.memoProjects=d.memoProjects||[];
   const defined=d.memoTaskGroups||(d.memoTaskGroups=[]);
   let category=defined.find(g=>g.id===item.memoGroup);
   if(!category&&item.memoGroupName){category=defined.find(g=>g.name===item.memoGroupName);if(!category){category={id:S().uid(),name:item.memoGroupName};defined.push(category);}}
   d.memoProjects.push({id:S().uid(),text:item.text,note:item.note,days:{},createdDay:today,memoImportKey:key,...(category?{memoGroup:category.id}:{}),...(item.memoGanttStart?{memoGanttStart:item.memoGanttStart,memoGanttEnd:item.memoGanttEnd}:{})});
  }else if(mod==='wishlist'){
   d.memoWishes=d.memoWishes||[];d.memoWishes.push({id:S().uid(),name:item.name,cents:item.cents,memoImportKey:key});
  }
 }
 // Restore category and planning metadata for all task types; keep the original task entity.
 const linked=plan.rows.filter(r=>['required','ideal','extra','queue','projects'].includes(r.mod));
 const locateRow=row=>existing(row.mod).find(x=>x.memoImportKey===row.key||row.sourceId&&x.id===row.sourceId);
 for(const row of linked){
  if(row.skip)continue;
  const task=locateRow(row);if(!task)throw Error('无法定位导入任务：'+row.item.text);
  const item=row.item,defined=d.memoTaskGroups||(d.memoTaskGroups=[]);
  let group=defined.find(g=>g.id===item.memoGroup);
  if(!group&&item.memoGroupName){group=defined.find(g=>g.name===item.memoGroupName);if(!group){group={id:S().uid(),name:item.memoGroupName};defined.push(group);}}
  if(group)task.memoGroup=group.id;
  if(item.memoGanttStart)task.memoGanttStart=item.memoGanttStart;
  if(item.memoGanttEnd)task.memoGanttEnd=item.memoGanttEnd;
 }
 function resolveDependency(value){
  let kind='project',ref=value;
  if(ref.startsWith('once:')){kind='once';ref=ref.slice(5);}
  else if(ref.startsWith('project:'))ref=ref.slice(8);
  const matched=linked.find(row=>(kind==='once'?row.mod!=='projects':row.mod==='projects')&&
   (row.sourceId===ref||row.key===ref||row.key==='projects:'+ref||row.key.endsWith(':'+ref)));
  if(matched){const task=locateRow(matched);if(task)return kind==='once'?'once:'+task.id:task.id;}
  if(kind==='once'){
   const tasks=Object.values(d.days||{}).flatMap(day=>Object.values(day.tasks||{}).flat()).concat(d.queue||[],d.queueDone||[]);
   const task=tasks.find(x=>x.id===ref);if(task)return 'once:'+task.id;
  }else{
   const task=(d.memoProjects||[]).find(x=>x.id===ref||x.memoImportKey===value||'focus-plan:projects:'+x.id===value||x.memoImportKey==='projects:'+value);
   if(task)return task.id;
  }
  throw Error('前置依赖丢失：'+value);
 }
 for(const row of linked){
  if(row.skip)continue;
  const target=locateRow(row);if(!target)throw Error('无法定位导入任务：'+row.item.text);
  const refs=row.item.dependencyKeys.length?row.item.dependencyKeys:row.item.memoGanttDependencies;
  const deps=refs.map(resolveDependency);
  target.memoGanttDependencies=A.memoGantt.validate(target,target.memoGanttStart||'',target.memoGanttEnd||'',deps).dependencies;
 }
 A.memoSchedule.invalidate?.();
}
function download(data){
 const json=JSON.stringify(data,null,2),blob=new Blob([json],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='focus-plan-modules-'+M().userDay()+'.json';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),20000);
}
function open(){
 if(A.memoActions.busy())return A.ui.toast('请先完成当前保存操作');
 const m=A.ui.openModal('模块导入与导出',
  '<div class="mx-tabs"><button type="button" class="btn" id="mx-export" aria-pressed="true">导出模块</button><button type="button" class="btn" id="mx-import" aria-pressed="false">导入模块</button></div>'+
  '<p class="hint">各模块独立勾选。导入只创建新任务或计划，不覆盖历史积分、已完成任务、计时和完整备份。</p>'+
  '<label id="mx-file-label" hidden>选择模块 JSON 文件<input type="file" id="mx-file" accept=".json,application/json"></label>'+
  '<div class="mx-select-actions"><button type="button" class="btn btn-small" id="mx-all">全选可用模块</button><button type="button" class="btn btn-small" id="mx-none">清空选择</button></div>'+
  '<div class="mx-grid" role="group" aria-label="可选模块" id="mx-modules"></div><p class="hint" id="mx-preview" role="status">请选择要导出的模块。</p><p role="alert" id="mx-error"></p>',
  '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">导出所选</button>',{lock:true});
 const q=s=>m.querySelector(s);
 let mode='export',input=null,verified=false,pendingSave=false,saving=false;
 const labels=new Map(specs.map(s=>[s[0],s[1]]));
 const selected=()=>[...q('#mx-modules').querySelectorAll('input:checked')].map(x=>x.value);
 function picker(){
  q('#mx-modules').innerHTML=specs.filter(([key,,can])=>mode==='export'||(input&&Object.hasOwn(input.modules,key))).map(([key,label,can])=>{
   const n=input?.modules[key]?.length??0,disabled=mode==='import'&&!can;
   return '<label class="mx-option"><input type="checkbox" value="'+key+'"'+(disabled?' disabled':'')+'><span>'+S().esc(label)+(mode==='import'?'（'+n+'项'+(disabled?'，只读':'')+'）':'')+'</span></label>';
  }).join('')||'<p class="hint">请先上传有效文件</p>';
  q('#mx-modules').querySelectorAll('input').forEach(x=>x.onchange=()=>{verified=false;showPreview();});
  showPreview();
 }
 function showPreview(){
  q('#mx-error').textContent='';
  const names=selected();
  if(mode==='export'){q('#mx-preview').textContent=names.length?'准备导出 '+names.map(k=>labels.get(k)).join('、'):'请选择导出模块';return;}
  if(!input){q('#mx-preview').textContent='请选择要导入的 JSON 文件';return;}
  try{
   if(!names.length){q('#mx-preview').textContent='请选择导入模块';return;}
   const p=preview(input,names);
   q('#mx-preview').textContent='将新增 '+p.create+' 项，跳过重复 '+p.skip+' 项'+(p.unavailable.length?'；仅导出模块无法导入：'+p.unavailable.map(k=>labels.get(k)).join('、'):'')+'。导入前请确认，不会覆盖现有积分、计时或完成记录。';
  }catch(e){q('#mx-error').textContent=e.message;}
 }
 function switchMode(next){
  mode=next;verified=false;
  q('#mx-export').setAttribute('aria-pressed',String(mode==='export'));q('#mx-import').setAttribute('aria-pressed',String(mode==='import'));
  q('#mx-file-label').hidden=mode!=='import';q('[data-act="save"]').textContent=mode==='export'?'导出所选':'预览导入';
  picker();
 }
 q('#mx-export').onclick=()=>switchMode('export');q('#mx-import').onclick=()=>switchMode('import');
 q('#mx-all').onclick=()=>{q('#mx-modules').querySelectorAll('input:not(:disabled)').forEach(x=>x.checked=true);verified=false;showPreview();};
 q('#mx-none').onclick=()=>{q('#mx-modules').querySelectorAll('input').forEach(x=>x.checked=false);verified=false;showPreview();};
 q('#mx-file').onchange=async()=>{
  input=null;verified=false;
  const f=q('#mx-file').files?.[0];if(!f)return picker();
  try{if(f.size>2_000_000)throw Error('文件超过 2 MB 限额');input=parse(await f.text());picker();}
  catch(e){q('#mx-error').textContent=e.message;picker();q('#mx-error').textContent=e.message;}
 };
 A.ui.bindActions({cancel:()=>{if(!saving&&!pendingSave)A.ui.closeModal();},save:async()=>{
  if(saving)return;
  if(pendingSave){
   saving=true;
   try{if(await A.memoActions.commit(()=>{})){pendingSave=false;A.ui.closeModal();A.memoWorkspace.render();A.ui.toast('之前导入的数据已成功保存');}}
   catch(error){q('#mx-error').textContent=error.message;}
   finally{saving=false;}
   return;
  }
  try{
   const names=selected();if(!names.length)throw Error('请至少选择一个模块');
   if(mode==='export'){download(exportData(names));A.ui.toast('所选模块已导出');return;}
   if(!input)throw Error('请先上传模块 JSON 文件');
   const plan=preview(input,names);
   if(!plan.create)throw Error('没有可新增的数据；重复内容已跳过');
   if(!verified){verified=true;q('[data-act="save"]').textContent='确认导入 '+plan.create+' 项';showPreview();return;}
   saving=true;q('[data-act="save"]').disabled=true;
   const ok=await A.memoActions.commit(()=>applyCore(plan));
   if(ok){pendingSave=false;A.ui.closeModal();A.memoWorkspace.render();A.app.refreshStats();A.ui.toast('已导入 '+plan.create+' 项；重复 '+plan.skip+' 项已跳过');}
  }catch(e){
   if(String(e.message).includes('尚未保存'))pendingSave=true;
   q('#mx-error').textContent=e.message;
   if(pendingSave){q('[data-act="save"]').textContent='重试保存';q('[data-act="save"]').disabled=false;}
  }finally{saving=false;if(!pendingSave)q('[data-act="save"]').disabled=false;}
 }});
 picker();
}
A.memoTransfer={open,collect,exportData,parse,preview,applyCore,specs};
})();