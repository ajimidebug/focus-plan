<script setup lang="ts">
import { computed } from 'vue'
import HtmlIsland from './HtmlIsland.vue'
import OverviewTask from './OverviewTask.vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const lists=[{key:'required',name:'必须',symbol:'✅',full:'必做任务',color:'negative'},{key:'ideal',name:'理想',symbol:'⭐',full:'理想任务',color:'warning'},{key:'extra',name:'拓展',symbol:'🌱',full:'长期拓展',color:'positive'}]
const weekday=computed(()=>['日','一','二','三','四','五','六'][new Date(props.day+'T12:00:00+08:00').getUTCDay()]||'')
function done(x:any){return !x.deferred&&(['project','daily'].includes(x.ref.kind)?!!x.task.days?.[x.ref.day]:x.ref.kind==='queue'?!!(x.task.doneAt||x.task.doneDay):!!x.task.done)}
const columns=computed(()=>{void props.revision;return lists.map(col=>{const items=A().memoWorkspace.taskItems(props.day,col.key),open=items.filter((x:any)=>!done(x)),finished=items.filter(done),families=A().store.data().memoTaskGroups||[];return {...col,progress:A().memoFinance.column(props.day,col.key),open,finished,families:[{id:'',name:'未分组'},...families].map(g=>({...g,rows:open.filter((x:any)=>(families.some((f:any)=>f.id===x.task.memoGroup)?x.task.memoGroup:'')===g.id)})).filter(g=>g.id||g.rows.length)}})})
function expanded(key:string,defaultOpen=false){try{return (localStorage.getItem(key)|| (defaultOpen?'open':'closed'))==='open'}catch{return defaultOpen}}
</script>
<template>
  <section class="mw-overview framework-overview" aria-label="三栏任务概览">
    <div class="overview-heading"><h2>{{Number(day.slice(5,7))}}月{{Number(day.slice(8))}}日 周{{weekday}}</h2><span>04:00 分日</span></div>
    <div class="cal-cols framework-columns">
      <q-card v-for="col in columns" :key="col.key" flat bordered class="cal-col" :data-overview-list="col.key" :data-category="col.key">
        <div class="cal-col-head"><span><span aria-hidden="true">{{col.symbol}} </span>{{col.name}}</span><span class="mw-column-count">{{col.progress.label}}</span></div>
        <div class="mw-column-meter" role="img" :aria-label="col.full+'：'+col.progress.label+'，未完成延期'+col.progress.deferred+'项；'+col.progress.segments.map((s:any)=>s.label+s.count+'项').join('，')"><span v-for="seg in col.progress.segments" :key="seg.state" :class="'mw-column-'+seg.state" :data-progress-state="seg.state" :style="{width:seg.percent+'%'}" aria-hidden="true" /></div>
        <small v-if="col.progress.supervision" class="mw-column-extra">监督 {{col.progress.supervision}}项</small>
        <template v-if="col.key==='extra'"><details v-for="g in col.families" :key="g.id" class="task-family family-compact" :data-family="'overview:'+g.id" :data-family-id="g.id" :open="expanded('task-group:overview:'+g.id,true)"><summary>{{g.name}} · {{g.rows.length}}</summary><div class="family-body"><OverviewTask v-for="x in g.rows" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" /></div></details></template>
        <template v-else><OverviewTask v-for="x in col.open" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" /></template>
        <HtmlIsland :html="A().memoFinance.planned(day,col.key,false)" />
        <details v-if="col.finished.length" class="mw-completed" :data-fold-key="'overview:'+day+':'+col.key" :open="expanded('task-fold:overview:'+day+':'+col.key)"><summary>已完成（{{col.finished.length}}）</summary><OverviewTask v-for="x in col.finished" :key="JSON.stringify(x.ref)" :x="x" :category="col.key" done /></details>
        <q-btn flat dense no-caps class="overview-add" :aria-label="'概览：添加'+col.name+'任务'" @click.stop="A().memoWorkspace.editor(null,col.key)">＋ 添加</q-btn>
        <HtmlIsland v-if="col.key==='required'" :html="A().memoGoals?.html(day,true)||''" />
      </q-card>
    </div>
  </section>
</template>
