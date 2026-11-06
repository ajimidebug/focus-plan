/* Shared task grouping. Group edits use the existing atomic persistence workflow. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore,E=x=>S().esc(String(x??''));let context='';
const groups=()=>S().data().memoTaskGroups||[];
function allTasks(){
 const d=S().data();
 return [...(d.memoProjects||[]),...(d.daily||[]),...(d.queue||[]),...(d.queueDone||[]),...Object.values(d.days||{}).flatMap(day=>Object.values(day.tasks||{}).flat())];
}
function grouped(items,render,compact=false){
 const region=compact?'overview':'full';
 return (compact?'':'<button class="btn" data-group-add>＋ 分组</button>')+[{id:'',name:'未分组'},...groups()].map(g=>{
  const rows=items.filter(x=>(groups().some(v=>v.id===x.task.memoGroup)?x.task.memoGroup:'')===g.id);
  if(!rows.length&&!g.id)return '';
  let open=true;try{open=localStorage.getItem('task-group:'+region+':'+g.id)!=='closed'}catch{}
  return '<details class="task-family '+(compact?'family-compact':'')+'" data-family="'+region+':'+E(g.id)+'" data-family-id="'+E(g.id)+'" '+(open?'open':'')+'><summary>'+E(g.name)+' · '+rows.length+'</summary><div class="family-body">'+(compact?'':'<div class="family-actions"><button class="btn" data-group-task="'+E(g.id)+'">＋ 任务</button>'+(g.id?'<button class="btn" data-group-manage="'+E(g.id)+'">管理分组</button>':'')+'</div>')+render(rows)+'</div></details>';
 }).join('');
}
function add(id){context=id;A.memoWorkspace.editor(null,'extra')}
function bountyTier(points){const n=Number(points),configured=Number(S().settings().memoBountyThreshold??30),minimum=Number.isFinite(configured)&&configured>0?configured:30;return !Number.isFinite(n)||n<minimum?'none':n>=Math.max(31,minimum)?'high':'basic'}
function bounty(points){return bountyTier(points)!=='none'}
function badge(){return ''}
function fold(key,body,count){
 if(!count)return '';
 let open=false;try{open=localStorage.getItem('task-fold:'+key)==='open'}catch{}
 return '<details class="mw-completed" data-fold-key="'+E(key)+'" '+(open?'open':'')+'><summary>已完成（'+count+'）</summary>'+body+'</details>';
}
function editor(m,t,list,ref){
 if(list!=='extra'&&ref?.kind!=='project')return;
 const label=document.createElement('label');label.textContent='分组';
 const select=document.createElement('select');select.id='task-group';
 select.innerHTML='<option value="">未分组</option>'+groups().map(g=>'<option value="'+E(g.id)+'">'+E(g.name)+'</option>').join('');
 select.value=t?.memoGroup||context;context='';label.append(select);m.querySelector('#mw-note-edit').after(label);
}
function change(ref,list){
 const f=A.memoSchedule.resolve(ref);if(!f)throw Error('任务已不存在');
 const t=f.task,r=f.ref;if(t.done||t.doneAt||t.days?.[r.day])throw Error('已完成记录保留原分类');
 if(r.kind==='checkin'){
  const x=A.memoFinance.plans(r.day).find(x=>x.it.id===r.id);if(!x)throw Error('此打卡尚未安排');
  (S().data().memoHabitPlans||(S().data().memoHabitPlans=[])).push(Object.assign({},x.r,{id:S().uid(),mode:'once',from:r.day,until:undefined,list,at:new Date().toISOString()}));
 }else if(r.kind==='project'||r.kind==='daily'){
  (t.memoCategoryDays||(t.memoCategoryDays={}))[r.day]=list;
 }else A.memoFlow.moveCore(r,r.day||t.assignment?.day||M().userDay(),list);
 return A.memoSchedule.canonical(r);
}
function openGroups(){
 if(A.memoActions.busy())return A.ui.toast('请先完成当前保存操作');
 const arr=groups().map(g=>({id:g.id,name:g.name,count:allTasks().filter(t=>t.memoGroup===g.id&&!t.memoMovedTo).length}));
 const m=A.ui.openModal('管理甘特图与长期任务分组',
  '<p class="hint">分组在长期拓展和甘特图中共用，删除分组不会删除任务。</p>'+
  (arr.map(g=>'<div class="gantt-manage-group"><strong>'+E(g.name)+'</strong><small>'+g.count+' 项</small><button type="button" class="btn btn-small" data-group-manage="'+E(g.id)+'">编辑</button></div>').join('')||'<p class="hint">尚无分组。一次性任务默认显示在未分组中。</p>')+
  '<button class="btn" data-group-add>＋ 新建分组</button>',
  '<button class="btn" data-act="close">关闭</button>');
 A.ui.bindActions({close:()=>{if(!A.memoActions.busy())A.ui.closeModal()}});
}
function manage(id){
 const g=groups().find(x=>x.id===id);
 const candidate=groups().filter(x=>x.id!==id);
 const m=A.ui.openModal(g?'编辑分组':'新建分组',
  '<label>名称<input id="family-name" maxlength="80" value="'+E(g?.name||'')+'"></label>'+
  (g?'<label>删除后转入<select id="family-target"><option value="">未分组</option>'+candidate.map(x=>'<option value="'+E(x.id)+'">'+E(x.name)+'</option>').join('')+'</select></label>':'')+
  '<p role="alert"></p>',
  '<button class="btn" data-act="cancel">取消</button>'+
  (g?'<button class="btn" data-act="up">上移</button><button class="btn" data-act="down">下移</button><button class="btn btn-danger" data-act="remove">删除分组</button>':'')+
  '<button class="btn btn-primary" data-act="save">保存</button>',{lock:true});
 const save=fn=>async()=>{try{if(await A.memoActions.commit(fn)){A.ui.closeModal();A.memoWorkspace.render();A.ui.toast('分组已保存')}}catch(e){m.querySelector('[role=alert]').textContent=e.message}};
 const move=n=>()=>{const a=groups(),i=a.findIndex(x=>x.id===id),j=i+n;if(j>=0&&j<a.length)[a[i],a[j]]=[a[j],a[i]]};
 A.ui.bindActions({
  cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal()},
  save:save(()=>{const name=m.querySelector('#family-name').value.trim();if(!name)throw Error('请填写名称');
   const a=S().data().memoTaskGroups||(S().data().memoTaskGroups=[]);
   if(a.some(x=>x.id!==id&&x.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('分组名称已存在');
   const existing=a.find(x=>x.id===id);if(existing)existing.name=name;else a.push({id:S().uid(),name});
  }),
  up:save(move(-1)),down:save(move(1)),
  remove:()=>{
   const target=m.querySelector('#family-target')?.value||'',count=allTasks().filter(t=>t.memoGroup===id).length;
   A.ui.confirm('删除分组“'+g.name+'”？'+count+'条任务将移入'+(groups().find(x=>x.id===target)?.name||'未分组')+'，任务、积分、计时和依赖保留。','删除分组',async()=>{
    try{
     const ok=await A.memoActions.commit(()=>{
      if(!groups().some(x=>x.id===id))throw Error('分组已不存在');
      if(target&&!groups().some(x=>x.id===target))throw Error('目标分组已不存在');
      for(const task of allTasks())if(task.memoGroup===id){if(target)task.memoGroup=target;else delete task.memoGroup;}
      S().data().memoTaskGroups=groups().filter(x=>x.id!==id);
     });
     if(ok){A.memoWorkspace.render();A.ui.toast('分组已删除，原任务保留');}
    }catch(e){A.ui.toast('分组删除失败：'+e.message);}
   });
  }
 });
}
document.addEventListener('toggle',e=>{
 if(e.target.matches?.('[data-fold-key]'))try{localStorage.setItem('task-fold:'+e.target.dataset.foldKey,e.target.open?'open':'closed')}catch{}
 if(e.target.matches?.('[data-family]'))try{localStorage.setItem('task-group:'+e.target.dataset.family,e.target.open?'open':'closed')}catch{}
},true);
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-group-add],[data-group-task],[data-group-manage]');if(!b)return;
 if(b.hasAttribute('data-group-task'))return add(b.dataset.groupTask);
 e.preventDefault();e.stopPropagation();
 manage(b.dataset.groupManage||'');
});
A.memoOrganize={grouped,editor,change,add,bounty,bountyTier,badge,fold,openGroups};
})();
