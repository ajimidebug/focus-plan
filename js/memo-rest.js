/* Stateless timestamp insertion. Legacy rest records and paused sessions remain untouched. */
(function(){'use strict';const A=window.App,S=()=>A.store,M=()=>A.memoCore;
function stampCore(now=Date.now()){const day=M().userDay(now),blocks=M().segments(M().read(day)),text=blocks.map(x=>x.text).join('');blocks.push({id:S().uid(),text:(text&&!text.endsWith('\n')?'\n':'')+(M().naturalDay(now)!==day?'次日':'')+M().clock(now).replace(':','')+' 休息\n'});M().write(day,blocks.map(x=>x.text).join(''),new Date(now).toISOString(),blocks);}
function init(){const b=document.createElement('button');b.id='memo-rest';b.className='btn';b.textContent='休息';document.getElementById('memo-time').after(b);let pending=false;b.onclick=async()=>{if(pending)return;pending=true;b.disabled=true;try{if(await A.memoActions.commit(stampCore)){A.memo.show(A.memo.selected());A.ui.toast('已记录休息时间点');}}catch(e){A.ui.toast(e.message);}finally{pending=false;b.disabled=false;}};}
A.memoRest={stampCore,init};})();
