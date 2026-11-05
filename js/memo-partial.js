/* Selective AI task interchange. This is not a restore of history, time or ledger. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore;
const names={required:'必做',ideal:'理想',extra:'长期拓展',queue:'待安排',review:'复习系列',recurrence:'周期与持续复习',projects:'长期项目',wishes:'愿望单',schedule:'计划时间（仅导出）'};
const writable=Object.keys(names).filter(k=>k!=='schedule'),keys=Object.keys(names);
const E=v=>S().esc(String(v??''));
function safeText(v,label){if(typeof v!=='string'||!v.trim()||v.trim().length>300)throw Error(label+'需为1至300字');return v.trim();}
function note(v){if(v==null)return '';if(typeof v!=='string'||v.length>4000)throw Error('备注过长');return v;}
function num(v,label,max=100000){const n=Number(v??0);if(!Number.isFinite(n)||n<0||n>max)throw Error(label+'数值无效');return n;}
function date(v){if(typeof v!=='string'||!M().validDate(v)||v<'2000-01-01'||v>'2100-12-31')throw Error('日期无效');return v;}
function json(v){return JSON.parse(JSON.stringify(v));}
function hash(s){let n=2166136261;for(let i=0;i<s.length;i++){n^=s.charCodeAt(i);n=Math.imul(n,16777619);}return (n>>>0).toString(36);}
function external(x,k,v){return typeof x.externalKey==='string'&&x.externalKey.length<=160&&/^[\w:.-]+$/.test(x.externalKey)?x.externalKey:'ai:'+k+':'+hash(JSON.stringify(v));}
function exportRows(k){
 const d=S().data(),out=[];
 const tagged=(prefix,id,x)=>({externalKey:x.memoImportKey||prefix+id});
 if(['required','ideal','extra'].includes(k)){Object.entries(d.days||{}).forEach(([day,v])=>(v.tasks?.[k]||[]).filter(t=>!t.fromQueue&&!t.fromDaily&&!t.memoProjectId&&!t.memoMovedTo&&!t.memoReviewRoundId&&!t.memoOccurrenceId&&!t.memoDismissed).forEach(t=>out.push({...tagged('task:'+day+':'+k+':',t.id,t),title:t.text,day,points:t.points??0,note:t.note||'',estimatedMinutes:t.estimatedMinutes||0,priorityWeight:t.priorityWeight??3})));return out;}
 if(k==='queue')return(d.queue||[]).filter(t=>!t.assignment&&!t.memoDismissed&&!t.memoReviewRoundId&&!t.memoOccurrenceId&&!t.doneAt).map(t=>({...tagged('queue:',t.id,t),title:t.text,points:t.points??0,note:t.note||'',estimatedMinutes:t.estimatedMinutes||0}));
 if(k==='review')return(d.memoReview?.series||[]).filter(s=>!s.stoppedAt).map(s=>{const r=(d.memoReview.rounds||[]).filter(r=>r.seriesId===s.id&&r.status==='pending').sort((a,b)=>a.due-b.due)[0];return {...tagged('review:',s.id,s),title:s.text,list:s.list||'ideal',points:s.points??1,note:s.note||'',estimatedMinutes:s.estimatedMinutes||0,intervals:s.intervals||[],nextDue:r?.due||null};});
 if(k==='recurrence')return(d.memoRecurrence?.series||[]).filter(s=>!s.stoppedAt).map(s=>{const c=A.memoRecurrence.config(s,M().userDay())||s.revisions.at(-1);return {...tagged('cycle:',s.id,s),title:c.text,list:c.list,points:c.points,note:c.note||'',estimatedMinutes:c.estimatedMinutes||0,rule:c.rule,reviewMode:!!s.reviewMode};});
 if(k==='projects')return(d.memoProjects||[]).filter(t=>!t.archived).map(t=>({...tagged('project:',t.id,t),title:t.text,points:t.points??0,note:t.note||'',estimatedMinutes:t.estimatedMinutes||0}));
 if(k==='wishes')return(d.memoWishes||[]).filter(t=>!t.hidden&&!t.purchase).map(t=>({...tagged('wish:',t.id,t),title:t.name,cents:t.cents}));
 if(k==='schedule')return(d.memoSchedule?.items||[]).filter(x=>!x.deleted).map(p=>({id:p.id,ref:p.ref,title:p.title,day:p.day,type:p.type,start:p.start,end:p.end??null}));
 return out;
}
function bundle(selected){const modules={};selected.forEach(k=>{if(names[k])modules[k]=exportRows(k)});return {format:'focus-plan-partial',version:1,exportedAt:new Date().toISOString(),restoreAdvice:'仅用于选择性管理或 AI 生成任务，不包含完整备份、积分流水、计时和历史恢复。',modules};}
function normalize(k,row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('记录必须是对象');
 const title=safeText(row.title,'任务名称'),v={title,note:note(row.note),points:num(row.points??(k==='review'||k==='recurrence'?(S().settings().reviewDefaultPoints??1):1),'积分'),estimatedMinutes:num(row.estimatedMinutes||0,'预计用时',1440)};
 if(['required','ideal','extra'].includes(k)){v.day=date(row.day);const w=Number(row.priorityWeight??3);if(!Number.isInteger(w)||w<1||w>5)throw Error('必做权重必须1至5');v.priorityWeight=w;}
 if(k==='review'){v.list=['required','ideal','extra'].includes(row.list)?row.list:'ideal';if(row.intervals!=null){if(!Array.isArray(row.intervals)||row.intervals.length>30||row.intervals.some(x=>!Number.isSafeInteger(x)||x<=0||x>5256000))throw Error('复习间隔无效');v.intervals=row.intervals;}else v.intervals=[];if(row.nextDue!=null){const due=typeof row.nextDue==='string'?Date.parse(row.nextDue):row.nextDue;if(!Number.isFinite(due)||due<=Date.now())throw Error('首次复习时间须晚于现在');v.nextDue=due;}}
 if(k==='recurrence'){v.list=['required','ideal','extra'].includes(row.list)?row.list:'ideal';v.reviewMode=!!row.reviewMode;const r=row.rule||{};v.rule={kind:r.kind||'days',anchor:date(r.anchor||M().userDay()),every:r.every,monthDay:r.monthDay,missing:r.missing};A.memoRecurrence.validateRule(v.rule);}
 if(k==='wishes'){v.cents=num(row.cents,'价格（分）',100000000);if(!Number.isInteger(v.cents)||v.cents<1)throw Error('价格需为正整数分');}
 return v;
}
function knownKeys(){
 const d=S().data(),set=new Set();keys.filter(k=>k!=='schedule').forEach(k=>exportRows(k).forEach(x=>set.add(k+':'+x.externalKey)));
 return set;
}
function plan(doc,selected){
 if(!doc||doc.format!=='focus-plan-partial'||doc.version!==1||!doc.modules||typeof doc.modules!=='object'||Array.isArray(doc.modules))throw Error('文件不是兼容的模块导入 JSON');
 const existing=knownKeys(),seen=new Set(),ops=[],errors=[],skipped=[];let count=0;
 for(const k of selected){
  if(!writable.includes(k))continue;
  const rows=doc.modules[k];if(!Array.isArray(rows))throw Error(names[k]+'数据必须是数组');
  count+=rows.length;if(count>1000)throw Error('单次导入最多1000项');
  rows.forEach((row,i)=>{try{const v=normalize(k,row),key=external(row,k,v),id=k+':'+key;if(existing.has(id)||seen.has(id)){skipped.push(names[k]+' #'+(i+1)+' 重复');return;}seen.add(id);ops.push({k,key,v});}catch(e){errors.push(names[k]+' #'+(i+1)+'：'+e.message);}});
 }
 return {ops,errors,skipped,count};
}
function apply(ops){
 const d=S().data(),at=new Date().toISOString();
 for(const {k,key,v} of ops){
  if(['required','ideal','extra'].includes(k))S().getDay(v.day).tasks[k].push({id:S().uid(),text:v.title,note:v.note,points:v.points,estimatedMinutes:v.estimatedMinutes,priorityWeight:v.priorityWeight,createdAt:at,memoImportKey:key,dateBasis:'user'});
  if(k==='queue')(d.queue||(d.queue=[])).push({id:S().uid(),text:v.title,note:v.note,points:v.points,estimatedMinutes:v.estimatedMinutes,createdAt:at,memoImportKey:key});
  if(k==='review'){const s=A.memoReview.newSeriesCore({text:v.title,note:v.note,list:v.list,points:v.points,estimatedMinutes:v.estimatedMinutes,intervals:v.intervals,due:v.nextDue});s.memoImportKey=key;}
  if(k==='recurrence'){const s=A.memoRecurrence.newSeriesCore({text:v.title,note:v.note,list:v.list,points:v.points,estimatedMinutes:v.estimatedMinutes,rule:v.rule,reviewMode:v.reviewMode});s.memoImportKey=key;}
  if(k==='projects')(d.memoProjects||(d.memoProjects=[])).push({id:S().uid(),text:v.title,note:v.note,points:v.points,estimatedMinutes:v.estimatedMinutes,createdAt:at,createdDay:M().userDay(),days:{},memoImportKey:key});
  if(k==='wishes')(d.memoWishes||(d.memoWishes=[])).push({id:S().uid(),name:v.title,cents:v.cents,memoImportKey:key});
 }
 A.memoSchedule?.invalidate?.();
}
function download(content){const blob=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='focus-plan-partial-'+M().userDay()+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function checkboxList(available,selected){return '<div class="memo-partial-options">'+available.map(k=>'<label><input type="checkbox" data-partial-key="'+k+'" '+(selected.includes(k)?'checked':'')+'> '+E(names[k])+'</label>').join('')+'</div>';}
function choose(m){return [...m.querySelectorAll('[data-partial-key]:checked')].map(x=>x.dataset.partialKey);}
function exportDialog(){
 const m=A.ui.openModal('选择性导出','<p class="hint">勾选模块；导出为 AI 可编辑的任务计划，不是完整恢复备份。</p>'+checkboxList(keys,[] )+'<p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">下载所选 JSON</button>',{lock:true,wide:true});
 A.ui.bindActions({cancel:()=>A.ui.closeModal(),save:()=>{const k=choose(m);if(!k.length){m.querySelector('[role=alert]').textContent='请至少选择一项';return;}download(JSON.stringify(bundle(k),null,2));A.ui.closeModal();}});
}
function importDialog(){
 let source=null,last=null,reading=false;const m=A.ui.openModal('选择性导入','<p class="hint">上传模块 JSON，或粘贴 AI 生成的 JSON。只新增独立计划；不导入历史积分、完成事件及计时。单次最多1000项。</p><label>选择 JSON 文件<input type="file" id="partial-file" accept=".json,application/json"></label><label>或粘贴 JSON<textarea id="partial-text" rows="4" maxlength="1000000" placeholder="{...}"></textarea></label><div id="partial-select"></div><div id="partial-preview" role="status"></div><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn" data-act="preview">预览变更</button><button class="btn btn-primary" data-act="save" disabled>确认导入</button>',{lock:true,wide:true});
 const q=x=>m.querySelector(x),error=msg=>q('[role=alert]').textContent=msg,reset=()=>{last=null;q('[data-act=save]').disabled=true;};
 const parse=()=>{reset();const text=q('#partial-text').value;if(text.length>1000000)throw Error('文件超过1MB');const doc=JSON.parse(text);if(!doc||doc.format!=='focus-plan-partial'||doc.version!==1||typeof doc.modules!=='object'||!doc.modules)throw Error('文件格式或版本不受支持');source=doc;const found=Object.keys(doc.modules).filter(k=>writable.includes(k));q('#partial-select').innerHTML='<p>选择需要导入的模块：</p>'+checkboxList(found,[])+(Object.keys(doc.modules).includes('schedule')?'<p class="hint">计划时间仅支持导出，不允许脱离任务引用独立导入。</p>':'');q('#partial-preview').textContent='已读取 '+found.length+' 个可导入模块。';if(!found.length)throw Error('没有可导入的任务模块');};
 q('#partial-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>1000000){error('文件超过1MB');return;}reading=true;try{q('#partial-text').value=await f.text();parse();error('');}catch(e){error(e.message);}finally{reading=false;}};
 q('#partial-text').addEventListener('change',()=>{try{parse();error('');}catch(e){error(e.message);}});
 q('#partial-select').addEventListener('change',reset);
 A.ui.bindActions({cancel:()=>{if(!reading&&!A.memoActions.busy())A.ui.closeModal();},preview:()=>{try{parse();const keys=choose(m);if(!keys.length)throw Error('请勾选至少一个模块');last=plan(source,keys);const p=last;q('#partial-preview').textContent='选择 '+keys.map(k=>names[k]).join('、')+'；新增 '+p.ops.length+' 项，重复跳过 '+p.skipped.length+' 项，错误 '+p.errors.length+' 项。'+(p.errors.length?' 错误：'+p.errors.slice(0,5).join('；'):'');q('[data-act=save]').disabled=!!p.errors.length||!p.ops.length;error(p.errors.length?'存在无效记录；请修改 JSON 后重新预览。':'');}catch(e){reset();error(e.message);}},save:async()=>{if(!last||last.errors.length||!last.ops.length||reading)return;const b=q('[data-act=save]');b.disabled=true;try{if(await A.memoActions.commit(()=>{const newer=plan(source,choose(m));if(newer.errors.length||newer.ops.length!==last.ops.length||newer.skipped.length!==last.skipped.length)throw Error('数据已变化，请重新预览');apply(newer.ops);})){A.ui.closeModal();A.memoWorkspace?.render();A.memoWishes?.render();A.app?.refreshStats();A.ui.toast('已导入 '+last.ops.length+' 项');}}catch(e){error(e.message);if(A.memoActions.busy())b.textContent='重试保存';}finally{b.disabled=false;}}});
}
function open(){if(A.memoActions.busy())return A.ui.toast('请先重试当前保存');const m=A.ui.openModal('批量管理 · 导入／导出','<p>按模块选择需要交给 AI 管理的任务，先预览后导入。原有完整备份不受影响。</p>','<button class="btn" data-act="cancel">关闭</button><button class="btn" data-act="export">勾选导出</button><button class="btn btn-primary" data-act="import">勾选导入</button>',{lock:true});A.ui.bindActions({cancel:()=>A.ui.closeModal(),export:exportDialog,import:importDialog});}
function init(){document.addEventListener('click',e=>{const b=e.target.closest('[data-partial-open]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();open();},true);}
A.memoPartial={names,bundle,normalize,plan,apply,open,init};
})();
