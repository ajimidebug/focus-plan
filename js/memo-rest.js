/* Rest is a persisted interval; timer chunks and plain memo lines commit together. */
(function(){'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore;
function state(){const d=S().data();if(d.memoRest===undefined)d.memoRest={version:1,intervals:[]};if(d.memoRest.version!==1||!Array.isArray(d.memoRest.intervals))throw new Error('休息记录异常，请先备份');return d.memoRest;}
function active(){return state().intervals.find(x=>!x.endedAt);}
function note(at,text){const day=M().userDay(at),blocks=M().segments(M().read(day)),all=blocks.map(x=>x.text).join('');blocks.push({id:S().uid(),text:(all&&!all.endsWith('\n')?'\n':'')+(M().naturalDay(at)!==day?'次日':'')+M().clock(at).replace(':','')+' '+text+'\n'});M().write(day,blocks.map(x=>x.text).join(''),new Date(at).toISOString(),blocks);}
function startCore(now=Date.now()){if(active())return;const running=A.memoSchedule.state().sessions.find(x=>x.status==='running');const entry={id:S().uid(),startedAt:now,pausedSessionId:running?.id||null};if(running)A.memoSchedule.pauseCore(running,now);state().intervals.push(entry);note(now,'开始休息');return entry;}
function finishCore(now=Date.now(),resume=true){const entry=active();if(!entry)return;entry.endedAt=Math.max(entry.startedAt,now);const ms=entry.endedAt-entry.startedAt;note(now,'结束休息，共'+Math.floor(ms/60000)+'分'+Math.floor(ms/1000)%60+'秒');
 const sessions=A.memoSchedule.state().sessions,prior=sessions.find(x=>x.id===entry.pausedSessionId),found=prior&&A.memoSchedule.resolve(prior.ref);
 if(resume&&prior?.status==='paused'&&found&&!found.task.archived&&!found.task.done&&!found.task.doneAt&&!(['daily','project'].includes(found.ref.kind)&&found.task.days?.[found.ref.day])&&!sessions.some(x=>x.status==='running')){A.memoSchedule.startRef(found.ref,now,prior.itemId||null);entry.resumedTitle=found.task.text;}
 return entry;
}
function render(){const b=document.getElementById('memo-rest');if(!b)return;try{const e=active(),sec=e?Math.floor(Math.max(0,Date.now()-e.startedAt)/1000):0;b.textContent=e?'结束休息 · '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'):'休息一下';b.setAttribute('aria-pressed',String(!!e));}catch(e){b.textContent='休息记录异常';}}
function init(){const b=document.createElement('button');b.id='memo-rest';b.className='btn';document.getElementById('memo-time').after(b);let submitting=false;b.onclick=async()=>{if(submitting)return;submitting=true;b.disabled=true;let ended;try{if(await A.memoActions.commit(()=>{ended=active()?finishCore():startCore();})){if(A.memo.selected())A.memo.show(A.memo.selected());A.memoSchedule.render();A.memoWorkspace.render();A.ui.toast(ended?.resumedTitle?'已继续：'+ended.resumedTitle:active()?'已开始休息':'休息已结束');}}catch(e){A.ui.toast(e.message);}finally{submitting=false;b.disabled=false;render();}};setInterval(render,1000);document.addEventListener('visibilitychange',render);render();}
A.memoRest={state,active,startCore,finishCore,init};
})();
