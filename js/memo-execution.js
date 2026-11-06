/* 175.3: lightweight execution order for existing tasks; no task copies. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore,E=x=>S().esc(String(x??''));
const categories={required:'必做',ideal:'理想',extra:'拓展'};
let expanded=false;
function state(){
 const d=S().data();
 if(d.memoExecutionQueue===undefined)d.memoExecutionQueue=[];
 if(!Array.isArray(d.memoExecutionQueue))throw Error('执行队列格式异常，请下载备份');
 return d.memoExecutionQueue;
}
const key=ref=>A.memoSchedule.key(ref);
function resolved(item){
 const f=item?.ref&&A.memoSchedule.resolve(item.ref);
 if(!f||f.task.archived||f.task.memoDismissed||A.memoReview?.hidden(f.task,f.ref.list||f.task.assignment?.list))return null;
 const ref=f.ref,t=f.task;
 if(ref.kind==='task'&&t.done||ref.kind==='queue'&&(t.doneAt||t.doneDay)||['project','daily'].includes(ref.kind)&&t.days?.[ref.day])return null;
 if(ref.kind==='checkin'){
   const rules=S().habitRules(t),target=Number(rules.target)||0,n=Number(t.days?.[ref.day])||0;
   if(target>0&&n>=target&&Number(rules.rewardLimit)<=target&&A.memoPenalty?.policy(t,ref.day).mode!=='punch')return null;
 }
 return {ref,task:t,pinned:item.pinned===true,key:key(ref)};
}
function rows(){
 const seen=new Set();return state().map(resolved).filter(x=>{if(!x||seen.has(x.key))return false;seen.add(x.key);return true;}).sort((a,b)=>Number(b.pinned)-Number(a.pinned));
}
function addCore(refs){
 const q=state(),seen=new Set(rows().map(x=>x.key));let count=0;
 for(const ref of refs){
   const x=resolved({ref});
   if(!x||seen.has(x.key))continue;
   q.push({ref:x.ref,pinned:false});seen.add(x.key);count++;
 }
 if(!count)throw Error('任务已在队列中，或当前不可加入');
 return count;
}
function removeCore(ref){
 const q=state(),k=key(ref);
 for(let i=q.length-1;i>=0;i--)if(q[i]?.ref&&key(q[i].ref)===k)q.splice(i,1);
}
function reorderCore(ref,action){
 const q=state(),k=key(ref),i=q.findIndex(x=>x?.ref&&key(x.ref)===k);
 if(i<0)throw Error('任务已从队列移除');
 const x=q.splice(i,1)[0];
 if(action==='pin'){x.pinned=!x.pinned;q.splice(x.pinned?0:q.filter(y=>y.pinned).length,0,x);return;}
 if(action==='tail'){x.pinned=false;q.push(x);return;}
 const eligible=q.map((y,j)=>({y,j})).filter(v=>!!v.y.pinned===!!x.pinned);
 const target=action==='up'?eligible.filter(v=>v.j<i).at(-1):eligible.find(v=>v.j>=i);
 if(target){q.splice(target.j,0,x);}else q.splice(action==='up'?0:q.length,0,x);
}
function onComplete(event){
 const ref={kind:event.kind,id:event.sourceId,day:event.sourceDay,list:event.sourceList};
 if(ref.kind==='checkin'){
   const it=(S().data().checkins||[]).find(t=>t.id===ref.id);
   if(it){const rule=S().habitRules(it),target=Number(rule.target)||0;
     if(!target||Number(rule.rewardLimit)>target||A.memoPenalty?.policy(it,ref.day).mode==='punch')return;
   }
 }
 removeCore(ref);
}
function category(ref,task){
 if(ref.kind==='task')return ref.list;
 if(ref.kind==='queue')return task.assignment?.list||'';
 if(ref.kind==='checkin')return A.memoFinance?.plans(ref.day)?.find(x=>x.it.id===ref.id)?.r.list||'';
 return task.memoCategoryDays?.[ref.day]||'extra';
}
function html(){
 const all=rows(),shown=expanded?all:all.slice(0,5);
 const refAttr=ref=>'data-exec-ref="'+E(JSON.stringify(ref))+'"';
 return '<section class="card exec-queue" aria-label="今日执行队列"><div class="exec-queue-heading"><h2>执行队列 <small>· '+all.length+' 项</small></h2><button type="button" class="btn btn-small btn-primary" data-exec="add">＋ 添加</button></div>'+
  (shown.length?'<div class="exec-queue-list">'+shown.map((x,i)=>{
    const ref=refAttr(x.ref),cat=category(x.ref,x.task);
    return '<div class="exec-queue-row" data-category="'+E(cat)+'"><span class="exec-queue-rail"></span>'+
      '<button type="button" class="exec-queue-title" data-exec="open" '+ref+' aria-label="编辑任务 '+E(x.task.text)+'"><strong>'+E(i+1+'. '+x.task.text)+'</strong><small>'+E(categories[cat]||'待安排')+(i===0?' · 当前':'')+(x.pinned?' · 置顶':'')+(x.ref.day&&x.ref.day!==M().userDay()?' · '+E(x.ref.day):'')+'</small></button>'+
      '<button type="button" class="btn btn-small" data-schedule-command="start" data-schedule-ref="'+E(JSON.stringify(x.ref))+'" aria-label="开始或继续计时">▶</button>'+
      '<button type="button" class="btn btn-small" data-exec="skip" '+ref+'>跳过</button>'+
      '<details class="exec-queue-menu"><summary aria-label="队列排序及其他操作">⋯</summary><div>'+
      ['pin','up','down','tail'].map(act=>'<button type="button" class="btn btn-small" data-exec="'+act+'" '+ref+'>'+({pin:x.pinned?'取消置顶':'置顶',up:'上移',down:'下移',tail:'移至队尾'}[act])+'</button>').join('')+
      (['task','queue'].includes(x.ref.kind)?'<button type="button" class="btn btn-small" data-exec="delete" '+ref+'>删除原任务</button>':'')+'</div></details></div>';
  }).join('')+'</div>':'<p class="hint">从三栏加入任务，为今天安排执行顺序。</p>')+
  (all.length>5?'<button class="btn btn-small" data-exec="expand">'+(expanded?'收起':'展开其余 '+(all.length-5)+' 项')+'</button>':'')+
  '<p class="exec-queue-hint">跳过仅移出执行队列，不影响原任务、积分和历史。</p></section>';
}
function candidates(){
 const day=A.memoWorkspace.currentDay?.()||M().userDay(),seen=new Set(rows().map(x=>x.key)),out=[];
 for(const list of ['required','ideal','extra']){
   for(const x of A.memoWorkspace.taskItems(day,list)){
     if(x.deferred||!resolved({ref:x.ref}))continue;
     const k=key(x.ref);if(seen.has(k))continue;seen.add(k);
     out.push({ref:x.ref,text:x.task.text,list});
   }
 }
 for(const x of A.memoFinance?.plans(day)||[]){
   if(x.it.archived)continue;
   const ref={kind:'checkin',id:x.it.id,day};
   if(!resolved({ref})||seen.has(key(ref)))continue;seen.add(key(ref));
   out.push({ref,text:x.it.text,list:x.r.list});
 }
 return out;
}
function addModal(){
 const options=candidates();
 const body=options.length?'<p class="hint">勾选任务后加入顺序清单，三栏安排不变。</p><div class="exec-queue-picker">'+options.map((x,i)=>
 '<label data-category="'+E(x.list)+'"><input type="checkbox" data-exec-index="'+i+'"><span>'+E(x.text)+'</span><small>'+E(categories[x.list]||'待安排')+'</small></label>').join('')+'</div><p id="exec-error" role="alert"></p>':'<p>当前日期没有可加入的未完成任务。</p>';
 const modal=A.ui.openModal('加入执行队列',body,'<button class="btn" data-act="cancel">取消</button>'+(options.length?'<button class="btn btn-primary" data-act="save">加入队列</button>':''),{lock:true});
 A.ui.bindActions({cancel:A.ui.closeModal,save:async b=>{
   const refs=[...modal.querySelectorAll('[data-exec-index]:checked')].map(x=>options[Number(x.dataset.execIndex)]?.ref).filter(Boolean);
   if(!refs.length){modal.querySelector('#exec-error').textContent='请先勾选任务';return;}
   b.disabled=true;try{if(await A.memoActions.commit(()=>addCore(refs))){A.ui.closeModal();A.memoWorkspace.render();A.ui.toast('已加入执行队列');}}
   catch(e){modal.querySelector('#exec-error').textContent=e.message;}finally{b.disabled=false;}
 }});
}
async function add(ref){
 try{if(await A.memoActions.commit(()=>addCore([ref]))){A.memoWorkspace.render();A.ui.toast('已加入执行队列');}}
 catch(e){A.ui.toast(e.message);}
}
document.addEventListener('click',async e=>{
 const b=e.target.closest?.('#mw-today .exec-queue [data-exec]');if(!b)return;
 e.preventDefault();e.stopImmediatePropagation();
 const act=b.dataset.exec,ref=b.dataset.execRef&&JSON.parse(b.dataset.execRef);
 if(act==='add')return addModal();
 if(act==='expand'){expanded=!expanded;return A.memoWorkspace.render();}
 if(act==='open')return ref.kind==='checkin'?A.memoSchedule.arrange(ref):A.memoWorkspace.editor(ref);
 if(act==='delete')return A.memoActions.deleteTask(ref);
 if(['skip','pin','up','down','tail'].includes(act)){
   b.disabled=true;
   try{if(await A.memoActions.commit(()=>act==='skip'?removeCore(ref):reorderCore(ref,act)))A.memoWorkspace.render();}
   catch(err){A.ui.toast(err.message);}finally{b.disabled=false;}
 }
},true);
A.memoExecutionQueue={html,rows,add,addCore,removeCore,reorderCore,onComplete};
})();