/* View-only controls use the existing ledger and transaction paths. */
(function(){
'use strict';
const A=window.App, S=()=>A.store, esc=x=>S().esc(String(x??''));
function enhance(){
 document.querySelectorAll('#mw-points,#ck-points,[data-reward-points],#spend-value,#mq-points,#mw-estimate,#ck-estimate,#ma-estimate').forEach(input=>{
  if(input.dataset.presets){const row=input.nextElementSibling;row.hidden=input.hidden;row.querySelectorAll('button').forEach(b=>b.disabled=input.disabled);return;} input.dataset.presets='1';
  const row=document.createElement('div'); row.className='point-presets';
  const time=/estimate/.test(input.id);
  function update(){const unit=time?'分钟':input.id==='spend-value'&&document.getElementById('spend-mode')?.value==='money'?'元':'分';row.querySelectorAll('[data-value]').forEach(b=>b.textContent='+'+b.dataset.value+unit);}
  (time?[5,20,60]:[1,5,10,25]).forEach(v=>{const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.value=v;b.onclick=()=>{if(input.disabled)return;try{const max=input.max?Number(input.max):Infinity;input.value=A.memoNumbers.add(input.value,v,max);input.dispatchEvent(new Event('input',{bubbles:true}));}catch(e){A.ui.toast(e.message);}};row.append(b);});
  const reset=document.createElement('button');reset.type='button';reset.className='btn';reset.textContent='Reset';reset.setAttribute('aria-label',time?'清除预计时间':'数值归零');reset.onclick=()=>{if(input.disabled)return;input.value=time?'':'0';input.dispatchEvent(new Event('input',{bubbles:true}));};row.append(reset);input.after(row);row.hidden=input.hidden;update();document.getElementById('mw-list')?.addEventListener('change',()=>{row.hidden=input.hidden;});document.getElementById('spend-mode')?.addEventListener('change',update);
 });
 if(!A.app || !A.memoCore || !S().data()?.ledger)return;
 const root=document.getElementById('view-checkin');if(!root || document.getElementById('point-records'))return;
 const nav=document.createElement('div');nav.className='point-tabs';nav.setAttribute('role','group');nav.setAttribute('aria-label','积分页面');nav.innerHTML='<button type="button" class="btn" data-point-pane="punch" aria-controls="checkin-view" aria-pressed="true">打卡</button><button type="button" class="btn" data-point-pane="records" aria-controls="point-history" aria-pressed="false">积分记录</button>';root.prepend(nav);
 const section=document.createElement('section');section.id='point-records';section.className='card';section.innerHTML='<div id="point-history" hidden><h2>积分记录</h2><button class="btn" data-finance-export>导出</button><select id="point-filter" aria-label="记录类型"><option value="all">全部</option><option value="earn">获得</option><option value="spend">支出</option><option value="correction">扣分与退回</option><option value="manual">手动调整</option></select><div id="point-rows"></div><button class="btn" id="point-more">查看更多</button></div>';section.hidden=true;nav.after(section);
 const summary=document.createElement('section');summary.id='point-summary';summary.className='card';summary.innerHTML='<h2>积分</h2><p id="point-balance"></p>';root.append(summary);
 const shop=document.getElementById('flow-shop');if(shop)summary.append(shop);
 function positionSummary(){const view=document.getElementById('checkin-view'),stats=view.querySelector('.ck-secondary');if(stats&&stats.parentNode===view)view.after(stats);const firstSecondary=root.querySelector('.ck-secondary');if(firstSecondary&&summary.nextElementSibling!==firstSecondary)firstSecondary.before(summary);if(shop&&shop.parentNode!==summary)summary.append(shop);}
 positionSummary();
 let limit=50;
 const category=e=>/^(earn-|reward-)/.test(e.type)?'earn':e.type==='redeem'?'spend':/penalty|refund/.test(e.type)?'correction':'manual';
 function render(){const ledger=S().data().ledger, today=A.memoCore.userDay();const sum=cat=>ledger.filter(e=>e.date===today&&category(e)===cat).reduce((n,e)=>n+e.points,0);document.getElementById('point-balance').textContent='余额 '+S().pointsTotal()+' 分 · 今日获得 '+sum('earn')+' · 今日支出 '+Math.abs(sum('spend'));const type=document.getElementById('point-filter').value;const items=ledger.map((e,i)=>({e,i})).filter(({e})=>type==='all'||category(e)===type).sort((a,b)=>(b.e.at||b.e.date).localeCompare(a.e.at||a.e.date)||b.i-a.i);document.getElementById('point-rows').innerHTML=items.slice(0,limit).map(({e})=>'<article class="point-record"><strong>'+esc((e.points>0?'+':'')+e.points)+'分</strong><span>'+esc(e.note||e.type)+'</span><small>归属日 '+esc(e.date)+(e.at?' · 录入 '+esc(new Date(e.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})):'')+'</small></article>').join('')||'<p>暂无记录</p>';document.getElementById('point-more').hidden=items.length<=limit;}
 nav.querySelectorAll('[data-point-pane]').forEach(b=>b.onclick=()=>{const history=b.dataset.pointPane==='records';document.getElementById('point-history').hidden=!history;section.hidden=!history;document.getElementById('checkin-view').hidden=history;root.querySelectorAll('.ck-secondary').forEach(el=>el.hidden=history);nav.querySelectorAll('[data-point-pane]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));render();});document.getElementById('point-filter').onchange=()=>{limit=50;render();};document.getElementById('point-more').onclick=()=>{limit+=50;render();};const priorRefresh=A.app.refreshStats;A.app.refreshStats=function(){const result=priorRefresh.apply(this,arguments);render();return result;};document.addEventListener('click',e=>{if(e.target.closest('[data-view="checkin"]'))render();});document.addEventListener('focus-storage',render);root.addEventListener('click',()=>setTimeout(render,0));render();
}
const presetSelector='#mw-points,#ck-points,[data-reward-points],#spend-value,#mq-points,#mw-estimate,#ck-estimate,#ma-estimate';
let queued=false;
new MutationObserver(records=>{
 const relevant=records.some(record=>[...record.addedNodes].some(node=>{
   if(node.nodeType!==1)return false;
   return node.matches?.(presetSelector) || node.querySelector?.(presetSelector) ||
     (!document.getElementById('point-records') && !!node.closest?.('#view-checkin'));
 }));
 if(!relevant||queued)return;
 queued=true;queueMicrotask(()=>{queued=false;enhance();});
}).observe(document.body,{childList:true,subtree:true});
})();
