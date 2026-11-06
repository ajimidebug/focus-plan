<script setup lang="ts">
import { computed, ref } from 'vue'
import OverviewTask from './OverviewTask.vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const lists=[{key:'required',name:'必须',symbol:'✅',full:'必做任务'},{key:'ideal',name:'理想',symbol:'⭐',full:'理想任务'},{key:'extra',name:'拓展',symbol:'🌱',full:'长期拓展'}]
const weekday=computed(()=>['日','一','二','三','四','五','六'][new Date(props.day+'T12:00:00+08:00').getUTCDay()]||'')
function done(x:any){return !x.deferred&&(['project','daily'].includes(x.ref.kind)?!!x.task.days?.[x.ref.day]:x.ref.kind==='queue'?!!(x.task.doneAt||x.task.doneDay):!!x.task.done)}
function foldedKey(day:string,list:string,section:string){return 'task-fold:overview:'+day+':'+list+':'+section}
function expanded(key:string,defaultOpen=false){try{return (localStorage.getItem(key)||(defaultOpen?'open':'closed'))==='open'}catch{return defaultOpen}}
function remember(key:string,event:Event){try{localStorage.setItem(key,(event.target as HTMLDetailsElement).open?'open':'closed')}catch{}}
const groupExpansion=ref<Record<string,boolean>>({})
function showAllGroup(id:string){return Object.hasOwn(groupExpansion.value,id)?groupExpansion.value[id]:expanded('task-group:limit:'+id,false)}
function visibleGroupRows(g:any){return g.rows.length>8&&!showAllGroup(g.id)?g.rows.slice(0,5):g.rows}
function toggleGroup(id:string){const next=!showAllGroup(id);groupExpansion.value={...groupExpansion.value,[id]:next};try{localStorage.setItem('task-group:limit:'+id,next?'open':'closed')}catch{}}
function choose(offset:number){const m=A().memoCore;A().memoWorkspace.setDay(m.shiftDay(m.userDay(),offset))}
function dateChanged(e:Event){A().memoWorkspace.setDay((e.target as HTMLInputElement).value)}
function milestoneClick(event:Event){const b=(event.target as HTMLElement).closest<HTMLElement>('[data-ms-edit]');if(b)A().ms?.edit?.(b.dataset.msEdit)}
function pressed(offset:number){const m=A().memoCore;return props.day===m.shiftDay(m.userDay(),offset)}
function habitRow(it:any,r:any,n:number,day:string){
 const mode=A().memoPenalty?.policy(it,day).mode||'reward'
 const target=Number(r.target)||0,limits=A().store.habitRules(it),achieved=mode!=='punch'&&target>0&&n>=target
 const continuing=mode==='punch'||target===0||limits.rewardLimit>target
 const points=A().checkin?.memoPoints(it,day)??0
 return {it,r,n,mode,target,achieved,continuing,points,limit:limits.rewardLimit}
}
const columns=computed(()=>{void props.revision;return lists.map(col=>{
 const items=A().memoWorkspace.taskItems(props.day,col.key)
 const active=items.filter((x:any)=>!x.deferred&&!done(x))
 const normal=active.filter((x:any)=>!A().memoFinance.deferredTarget(x.task,x.ref,props.day))
 const late=active.filter((x:any)=>A().memoFinance.deferredTarget(x.task,x.ref,props.day))
 const historical=items.filter((x:any)=>x.deferred)
 const finished=items.filter((x:any)=>done(x))
 const habits=A().memoFinance.plans(props.day).filter((x:any)=>x.r.list===col.key).map((x:any)=>habitRow(x.it,x.r,x.n,props.day))
 const habitActive=habits.filter((h:any)=>!h.achieved||h.continuing)
 const habitDone=habits.filter((h:any)=>h.achieved&&!h.continuing)
 const families=A().store.data().memoTaskGroups||[]
 const grouped=[{id:'',name:'未分组'},...families].map(g=>({...g,rows:normal.filter((x:any)=>(families.some((f:any)=>f.id===x.task.memoGroup)?x.task.memoGroup:'')===g.id)})).filter(g=>g.rows.length)
 return {...col,progress:A().memoFinance.column(props.day,col.key,true),normal,late,historical,finished,habitActive,habitDone,grouped,completeCount:finished.length+habitDone.length}
})})
</script>
<template>
  <section class="mw-overview framework-overview" aria-label="三栏任务概览">
    <div class="ms-featured">
      <div class="ms-featured-header"><strong>截止日期</strong><button type="button" class="btn btn-small" @click.stop="A().ms?.openList?.()">全部／管理</button></div>
      <div class="ms-featured-items" v-html="A().ms?.featuredHTML?.()||'<small>暂无即将到期的截止日期</small>'" @click.stop="milestoneClick"></div>
    </div>
    <div class="overview-heading"><h2>{{Number(day.slice(5,7))}}月{{Number(day.slice(8))}}日 周{{weekday}}</h2>
      <div class="mw-toolbar mw-date-header">
        <input id="mw-day" type="date" aria-label="任务日期" :value="day" @change="dateChanged" />
        <div class="mw-day-shortcuts" role="group" aria-label="快捷日期">
          <button class="btn" data-mw="yesterday" :aria-pressed="pressed(-1)" @click.stop="choose(-1)">昨天</button>
          <button class="btn" data-mw="today" :aria-pressed="pressed(0)" @click.stop="choose(0)">今天</button>
          <button class="btn" data-mw="tomorrow" :aria-pressed="pressed(1)" @click.stop="choose(1)">明天</button>
        </div>
      </div>
    </div>
    <div class="cal-cols framework-columns">
      <q-card v-for="col in columns" :key="col.key" flat bordered class="cal-col" :data-overview-list="col.key" :data-category="col.key">
        <div class="cal-col-head"><span><span aria-hidden="true">{{col.symbol}} </span>{{col.name}}</span><span class="mw-column-count">{{col.progress.label}}</span></div>
        <div class="mw-column-meter" role="img" :aria-label="col.full+'：'+col.progress.label+'，未完成延期'+col.progress.deferred+'项；'+col.progress.segments.map((s:any)=>s.label+s.count+'项').join('，')"><span v-for="seg in col.progress.segments" :key="seg.state" :class="'mw-column-'+seg.state" :data-progress-state="seg.state" :style="{width:seg.percent+'%'}" aria-hidden="true" /></div>
        <template v-if="col.key==='extra'">
          <details v-for="g in col.grouped" :key="g.id" class="task-family family-compact" :data-family="'overview:'+g.id" :data-family-id="g.id" :open="expanded('task-group:overview:'+g.id,true)" @toggle="remember('task-group:overview:'+g.id,$event)">
            <summary>{{g.name}} · {{g.rows.length}}</summary>
            <div class="family-body"><OverviewTask v-for="x in visibleGroupRows(g)" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" /><button v-if="g.rows.length>8" class="btn btn-small overview-group-more" @click.stop="toggleGroup(g.id)">{{showAllGroup(g.id)?'收起到前5项':'展开其余 '+(g.rows.length-5)+' 项'}}</button></div>
          </details>
        </template>
        <template v-else><OverviewTask v-for="x in col.normal" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" /></template>
        <q-btn v-for="h in col.habitActive" :key="'habit:'+h.it.id" flat no-caps class="habit-plan-row overview-habit" :class="{'habit-plan-goal-done':h.achieved}" :data-habit-kind="h.mode" :data-category="col.key" :aria-label="'习惯打卡：'+h.it.text+'，'+h.n+'次，目标'+h.target+'次'" @click.stop="A().memoActions.checkin(h.it.id,day)">
          <span class="habit-plan-title">{{h.it.text}}<small>{{h.mode==='punch'?'监督':h.achieved?' ✓ 已达标':h.target===0?'选做':'待达标'}}</small></span>
          <span class="habit-plan-meta"><small>{{h.n}}/{{h.target}} 次<span v-if="h.continuing&&h.achieved"> · 可继续</span></small><strong>{{h.points>0?'+':''}}{{h.points}}分</strong></span>
        </q-btn>
        <details v-if="col.late.length" class="mw-late-section" :open="expanded(foldedKey(day,col.key,'late'),true)" @toggle="remember(foldedKey(day,col.key,'late'),$event)">
          <summary>延期待办（{{col.late.length}}）</summary>
          <OverviewTask v-for="x in col.late" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" />
        </details>
        <details v-if="col.completeCount" class="mw-completed" :data-fold-key="'overview:'+day+':'+col.key" :open="expanded(foldedKey(day,col.key,'done'))" @toggle="remember(foldedKey(day,col.key,'done'),$event)">
          <summary>已完成（{{col.completeCount}}）</summary>
          <OverviewTask v-for="x in col.finished" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" done />
          <q-btn v-for="h in col.habitDone" :key="'habit:done:'+h.it.id" flat no-caps class="habit-plan-row habit-plan-goal-done overview-habit" :data-habit-kind="h.mode" @click.stop="A().memoActions.checkin(h.it.id,day)"><span class="habit-plan-title">{{h.it.text}} ✓</span><span class="habit-plan-meta">{{h.n}}/{{h.target}} 次</span></q-btn>
        </details>
        <details v-if="col.historical.length" class="mw-history-section" :open="expanded(foldedKey(day,col.key,'history'))" @toggle="remember(foldedKey(day,col.key,'history'),$event)">
          <summary>历史与改期记录（{{col.historical.length}}）</summary>
          <OverviewTask v-for="x in col.historical" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" />
        </details>
        <q-btn flat dense no-caps class="overview-add" :aria-label="'概览：添加'+col.name+'任务'" @click.stop="A().memoWorkspace.editor(null,col.key)">＋ 添加</q-btn>
      </q-card>
    </div>
  </section>
</template>
