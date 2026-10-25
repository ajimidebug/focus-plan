/* Deadline dates use Shanghai civil days; editing preserves native IME input. */
(function(){
'use strict';
const A=window.App,S=()=>A.store,esc=x=>S().esc(String(x??''));
function list(){const d=S().data();if(d.milestones===undefined)return [];if(!Array.isArray(d.milestones))throw new Error('截止日期数据异常，请先备份');return d.milestones;}
const due=m=>m.due||m.end||m.start||'';
function daysLeft(m,now=Date.now()){if(!A.memoCore.validDate(due(m)))return null;return Math.round((Date.parse(due(m)+'T00:00Z')-Date.parse(A.memoCore.naturalDay(now)+'T00:00Z'))/86400000);}
const label=n=>n===null?'日期待检查':n<0?'已过 '+(-n)+' 天':n===0?'今天截止':n===1?'明天截止':'还有 '+n+' 天';
function sorted(){return list().slice().sort((a,b)=>String(due(a)).localeCompare(String(due(b))));}
function refresh(){let next;try{next=sorted().find(m=>daysLeft(m)!==null&&daysLeft(m)>=0);}catch(e){return;}
 const text=next?next.name+' · '+label(daysLeft(next)):'截止日期';
 const mini=document.getElementById('ms-mini');if(mini)mini.textContent=text;
 const button=document.getElementById('mw-ddl');if(button){button.textContent=text;button.title=text;}
}
async function save(m,button,mutate,success){button.disabled=true;try{if(await A.memoActions.commit(mutate)){A.ui.closeModal();refresh();success?.();}}catch(e){m.querySelector('[role="alert"]').textContent=e.message;button.textContent=A.memoActions.busy()?'重试保存':'保存';}finally{button.disabled=false;}}
function remove(id){const entry=list().find(x=>x.id===id);if(!entry)return;const m=A.ui.openModal('删除截止日期','<p>删除“'+esc(entry.name)+'”？其他任务和笔记保留。</p><p role="alert"></p>','<button class="btn" data-act="back">保留</button><button class="btn btn-danger" data-act="save">确认删除</button>',{lock:true});A.ui.bindActions({back:()=>{if(!A.memoActions.busy())openList();},save:b=>save(m,b,()=>{const i=list().findIndex(x=>x.id===id);if(i>=0)S().data().milestones.splice(i,1);},openList)});}
function edit(id){if(A.memoActions.busy())return A.ui.toast('请先重试保存当前操作');const existing=id&&list().find(x=>x.id===id);if(id&&!existing)return;
 const m=A.ui.openModal(existing?'编辑截止日期':'添加截止日期','<label for="ms-name">名称</label><input id="ms-name" type="text" class="q-input" maxlength="500" autocomplete="off" placeholder="例如：提交材料"><label for="ms-due">截止日期（北京时间）</label><input id="ms-due" type="date" class="q-input"><label for="ms-note">备注（选填）</label><textarea id="ms-note" class="q-input"></textarea><p role="alert"></p>','<button class="btn" data-act="back">返回列表</button><button class="btn btn-primary" data-act="save">保存</button>',{lock:true});
 const q=x=>m.querySelector(x);q('#ms-name').value=existing?.name||'';q('#ms-due').value=existing?due(existing):'';q('#ms-note').value=existing?.note||'';
 let composing=false;q('#ms-name').addEventListener('compositionstart',()=>{composing=true;});q('#ms-name').addEventListener('compositionend',()=>{composing=false;});
 A.ui.bindActions({back:()=>{if(!A.memoActions.busy())openList();},save:b=>{if(composing)return;return save(m,b,()=>{
  const name=q('#ms-name').value.trim(),date=q('#ms-due').value;if(!name)throw new Error('请填写名称');if(!A.memoCore.validDate(date))throw new Error('请选择有效截止日期');
  if(!S().data().milestones)S().data().milestones=[];
  const item=id?list().find(x=>x.id===id):{id:S().uid()};if(!item)throw new Error('该截止日期已被删除');Object.assign(item,{name,due:date,note:q('#ms-note').value});if(!id)S().data().milestones.push(item);
 },()=>{openList();A.ui.toast('截止日期已保存');});}});
 q('#ms-name').focus({preventScroll:true});
}
function openList(){if(A.memoActions.busy())return A.ui.toast('请先重试保存当前操作');let items;try{items=sorted();}catch(e){return A.ui.toast(e.message);}
 const row=m=>'<article class="ms-row"><div class="ms-info"><strong>'+esc(m.name)+'</strong><p>'+esc(due(m))+' · '+label(daysLeft(m))+'</p>'+(m.note?'<p>'+esc(m.note)+'</p>':'')+'</div><button class="btn" data-act="edit" data-id="'+esc(m.id)+'">编辑</button><button class="btn" data-act="delete" data-id="'+esc(m.id)+'">删除</button></article>';
 const active=items.filter(m=>daysLeft(m)===null||daysLeft(m)>=0),past=items.filter(m=>daysLeft(m)<0);
 A.ui.openModal('截止日期',(active.map(row).join('')||'<p>暂无未过期的截止日期</p>')+'<details><summary>过去节点（'+past.length+'）</summary>'+past.map(row).join('')+'</details>','<button class="btn" data-act="close">关闭</button><button class="btn" data-act="goal">添加截止目标</button><button class="btn btn-primary" data-act="add">添加截止日期</button>',{lock:true});A.ui.bindActions({close:A.ui.closeModal,goal:()=>A.memoGoals.editor(),add:()=>edit(),edit:b=>edit(b.dataset.id),delete:b=>remove(b.dataset.id)});
}
function open(){try{list().length?openList():edit();}catch(e){A.ui.toast(e.message);}}
function init(){const b=document.getElementById('btn-ms');if(b)b.onclick=open;refresh();setInterval(refresh,60000);}
A.ms={init,refresh,list,daysLeft,open,openList};
})();
