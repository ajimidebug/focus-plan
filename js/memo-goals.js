/* Deadline reminders are independent of daily completion, rewards and penalties. */
(function () {
  'use strict';
  const A=window.App,S=()=>A.store,M=()=>A.memoCore,esc=x=>S().esc(String(x??''));
  function all(){const x=S().data().memoGoals;if(x===undefined)return [];if(!Array.isArray(x))throw new Error('截止目标数据异常');return x;}
  const ordinal=day=>M().validDate(day)?Date.parse(day+'T00:00:00Z')/86400000:null;
  function origin(g){if(M().validDate(g.createdCivilDay))return g.createdCivilDay;for(const h of g.history||[]){if(h.at&&Number.isFinite(Date.parse(h.at)))return M().naturalDay(h.at);}return (g.history||[]).find(h=>M().validDate(h.day))?.day||null;}
  function at(day,includeHidden=false){return all().map(g=>{const h=(g.history||[]).filter(x=>x.day<=day).slice(-1)[0];return h?Object.assign({},h,{id:g.id,createdCivilDay:origin(g)}):null;}).filter(g=>g&&(includeHidden||!g.hidden));}
  function countdown(g,day=M().naturalDay()){
    const due=ordinal(g.due),today=ordinal(day),start=ordinal(g.createdCivilDay);if(due===null||today===null)return {remaining:null,ratio:0,text:'截止日期待修正'};
    const remaining=due-today,span=start===null?0:due-start,ratio=Math.max(0,Math.min(1,remaining/Math.max(1,span)));
    return {remaining,ratio,text:remaining>0?'剩余'+remaining+'天':remaining===0?'今天截止':'已过期'+Math.abs(remaining)+'天'};
  }
  function content(day,compact){
    const history=day!==M().userDay(),asOf=history?day:M().naturalDay(),rows=at(day),hidden=at(day,true).filter(g=>g.hidden);
    return (rows.length?'<small class="goal-heading">截止提醒'+(history?' · 按所选日期':'')+'</small>':'')+rows.map(g=>{const c=countdown(g,asOf),label=history&&c.remaining>0?'当日剩余'+c.remaining+'天':c.text;return '<button type="button" class="goal-row" data-goal="'+esc(g.id)+'" aria-label="'+esc(g.name+'，截止'+g.due+'，'+label)+'"><span class="goal-name">'+esc(g.name)+'</span><span class="goal-countdown"><span class="goal-fill" aria-hidden="true" style="width:'+(c.ratio*100).toFixed(3)+'%"></span><span class="goal-remaining">'+esc(label)+'</span></span><small>截止 '+esc(g.due)+'</small></button>';}).join('')+(!compact?'<button type="button" class="btn btn-small" data-mw="goal-add">＋ 截止提醒</button>'+(hidden.length?'<details class="goal-hidden"><summary>已收起提醒（'+hidden.length+'）</summary>'+hidden.map(g=>'<button type="button" class="btn btn-small" data-goal="'+esc(g.id)+'">'+esc(g.name)+' · 编辑／恢复</button>').join('')+'</details>':''):'');
  }
  function html(day,compact){return '<div class="goal-group" data-goal-group data-day="'+esc(day)+'" data-compact="'+!!compact+'">'+content(day,compact)+'</div>';}
  function refresh(){document.querySelectorAll('[data-goal-group]').forEach(root=>{const active=document.activeElement,focused=root.contains(active)?active.dataset.goal:null,open=root.querySelector('details')?.open;root.innerHTML=content(root.dataset.day,root.dataset.compact==='true');if(open&&root.querySelector('details'))root.querySelector('details').open=true;if(focused)[...root.querySelectorAll('[data-goal]')].find(el=>el.dataset.goal===focused)?.focus({preventScroll:true});});}
  function saveCore(id,v,now=Date.now()){
    if(!String(v.name??'').trim()||!M().validDate(v.due))throw new Error('请填写名称和有效截止日期');
    const d=S().data();let g=id?all().find(x=>x.id===id):null;if(id&&!g)throw new Error('提醒已不存在');if(!d.memoGoals)d.memoGoals=[];
    if(!g){g={id:S().uid(),createdCivilDay:M().naturalDay(now),history:[]};d.memoGoals.push(g);}
    g.history.push({name:String(v.name).trim(),due:v.due,mode:'countdown',hidden:!!v.hidden,day:M().userDay(now),at:new Date(now).toISOString()});return g;
  }
  function editor(id){
    if(A.memoActions.busy())return A.ui.toast('请先重试保存');const g=all().find(x=>x.id===id),v=g?.history.slice(-1)[0]||{name:'',due:M().naturalDay()};
    const m=A.ui.openModal('截止提醒','<label>名称<input type="text" class="q-input" id="gg-name"></label><label>截止日期<input type="date" id="gg-due"></label><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button>'+(g?'<button class="btn" data-act="toggle">'+(v.hidden?'恢复提醒':'收起提醒')+'</button>':'')+'<button class="btn btn-primary" data-act="save">保存</button>',{lock:true});
    for(const k of ['name','due'])m.querySelector('#gg-'+k).value=v[k];let pendingValues=null,pendingAction=null;
    async function save(b,toggle){if(pendingAction&&pendingAction!==b)return;pendingAction=b;if(!pendingValues)pendingValues={name:m.querySelector('#gg-name').value,due:m.querySelector('#gg-due').value,hidden:toggle?!v.hidden:!!v.hidden};b.disabled=true;
      try{if(await A.memoActions.commit(()=>saveCore(id,pendingValues))){A.ui.closeModal();A.memoWorkspace.render();}}
      catch(e){m.querySelector('[role="alert"]').textContent=e.message;if(A.memoActions.busy()){b.textContent='重试保存';m.querySelectorAll('input').forEach(el=>el.disabled=true);}else{pendingValues=null;pendingAction=null;}}finally{b.disabled=false;}}
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:b=>save(b,false),toggle:b=>save(b,true)});m.querySelector('#gg-name').focus();
  }
  A.memoGoals={all,at,html,refresh,editor,saveCore,origin,countdown};
})();
