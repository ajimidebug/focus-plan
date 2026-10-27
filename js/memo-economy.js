/* 173: prospective independent habit rewards and event-sourced monthly points interest.
 * No historical reward repricing. Ledger entry dates are display dates; at/effectiveAt
 * determine economic balance timing. Settlements remain deterministic after offline gaps. */
(function () {
'use strict';
const A=window.App,S=()=>A.store,M=()=>A.memoCore;
const shift=(d,n)=>M().shiftDay(d,n);
const start=d=>Date.parse(d+'T04:00:00+08:00');
const ym=d=>d.slice(0,7);
const first=m=>m+'-01';
const nextMonth=m=>{const [y,n]=m.split('-').map(Number);return (n===12?y+1:y)+'-'+String(n===12?1:n+1).padStart(2,'0');};
const monthDays=m=>{const [y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,0)).getUTCDate();};
const cash=x=>Math.round((x+Number.EPSILON)*100)/100;
function state(){const x=S().data().memoEconomy;if(x!==undefined&&(!x||x.version!==1))throw Error('积分银行数据版本不兼容');return x;}
function enableCore(now=Date.now()){
 if(state())return state();
 const current=M().userDay(now),startedDay=shift(current,1);
 S().data().memoEconomy={version:1,enabledAt:new Date(now).toISOString(),startedDay,
   openingBalance:S().pointsTotal(),
   initialAtIds:S().data().ledger.filter(e=>e.at===new Date(now).toISOString()||e.effectiveAt===new Date(now).toISOString()).map(e=>e.id),
   positiveRate:.02,negativeRate:.04,settlements:[]};
 return state();
}
function previousStreak(it,day) {
 const x=state();if(!x||day<x.startedDay)return 0;
 const target=S().habitRules(it).target;
 let d=shift(day,-1),count=0;
 while(d>=x.startedDay && (Number(it.days?.[d])||0)>=Math.max(1,target)) {
   count++;d=shift(d,-1);if(count>10000)break;
 }
 return count;
}
function quote(it,day){
 const x=state();if(!x||day<x.startedDay)return null;
 const n=Number(it.days?.[day])||0,h=S().habitRules(it);
 const consecutive=previousStreak(it,day)+1, factor=consecutive<=2?.5:consecutive<=6?.75:1;
 const base=n<h.rewardLimit?Math.max(0,Number(it.points)||0):0;
 return {version:4,total:cash(base*factor),base,bonus:0,factor,consecutive,
   rewardLimit:h.rewardLimit,target:h.target,optional:h.optional};
}
function eventsAfterEnable(){
 const x=state(),cutoff=Date.parse(x.enabledAt);
 return S().data().ledger.filter(e=>{
   const t=Date.parse(e.effectiveAt||e.at||'');
   return Number.isFinite(t)&&t>=cutoff && !(x.initialAtIds||[]).includes(e.id);
 }).map(e=>({points:Number(e.points)||0,when:Date.parse(e.effectiveAt||e.at)}));
}
function balanceAt(end,inclusive=true){
 const x=state();if(!x)return S().pointsTotal();
 return x.openingBalance+eventsAfterEnable().reduce((n,e)=>n+((e.when<end||(inclusive&&e.when===end))?e.points:0),0);
}
function closedMonths(now=Date.now()){
 const x=state();if(!x)return [];
 let m=ym(x.startedDay),last=ym(M().userDay(now)),out=[];
 while(m<last){out.push(m);if(out.length>120)throw Error('未结息跨度过长，先导出备份后检查');m=nextMonth(m);}
 return out.filter(m=>!x.settlements.some(r=>r.month===m));
}
function settleCore(now=Date.now()){
 const x=state();if(!x)return 0;
 const months=closedMonths(now);let n=0;
 for(const month of months){
   const endMonth=nextMonth(month),denominator=monthDays(month);
   let day=month===ym(x.startedDay)?x.startedDay:first(month);
   let positive=0,negative=0;
   while(day<first(endMonth)){
     const bal=balanceAt(start(shift(day,1)),false);
     if(bal>=0)positive+=bal*x.positiveRate/denominator;
     else negative+=bal*x.negativeRate/denominator;
     day=shift(day,1);
   }
   positive=cash(positive);negative=cash(negative);
   const effectiveAt=new Date(start(first(endMonth))).toISOString();
   const record={id:S().uid(),month,positive,negative,effectiveAt,postedAt:new Date(now).toISOString()};
   x.settlements.push(record);
   for(const [kind,points] of [['positive',positive],['negative',negative]]){
     if(!points)continue;
     S().data().ledger.push({
       id:S().uid(),operationId:'interest:'+month+':'+kind,
       date:first(endMonth),type:'interest-'+kind,points,
       leisure:0,at:record.postedAt,effectiveAt,
       note:month+(kind==='positive'?' 正余额利息':' 负余额利息')
     });
   }
   n++;
 }
 return n;
}
function hasPending(now=Date.now()){return !!state() && closedMonths(now).length>0;}
function latest(){const x=state();return x?.settlements.at(-1)||null;}
function bankHTML(){
 const x=state();if(!x)return '';
 const balance=S().pointsTotal(),last=latest();
 const p=balance>=0?x.positiveRate:x.negativeRate;
 const estimate=cash(balance*p);
 return '<section class="card memo-bank" aria-label="积分银行">'+
 '<h3>积分银行</h3><p>余额 <strong>' + S().esc(balance.toFixed(2)) +
 ' 分</strong> · 月利率：正余额 +2%，负余额 -4%，无固定金额上限</p>'+
 '<p>按每日余额计算，次月首个用户日04:00结息并复利。当前余额不变时，完整月份预计 '+ (estimate>=0?'+':'')+estimate.toFixed(2)+' 分。</p>'+
 (last?'<p>最近结息：'+S().esc(last.month)+'，正利息 +'+last.positive.toFixed(2)+'，负利息 '+last.negative.toFixed(2)+' 分</p>':'<p>新规则启用后第一个完整结息周期结束时显示流水。</p>')+
 '<p class="hint">旧账本不会按新规则补息；补记的经济入账时间以实际保存为准。真实消费预算单独计算。</p></section>';
}
A.memoEconomy={state,enableCore,quote,previousStreak,settleCore,hasPending,closedMonths,balanceAt,bankHTML};
})();
