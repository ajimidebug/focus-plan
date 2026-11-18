<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import OverviewTask from './OverviewTask.vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const selectedIndex=ref<number|null>(null)
watch(()=>props.day,()=>{selectedIndex.value=null})
const rounds=computed(()=>{void props.revision;return A().memoThree.rounds()})
const selected=computed(()=>{void props.revision;return (selectedIndex.value===null?null:A().memoThree.byIndex(selectedIndex.value))||A().memoThree.selected(props.day)})
const plan=computed(()=>{void props.revision;return A().memoThree.projection(selected.value?.start||props.day)})
const dates=computed(()=>{
 const r=selected.value;if(!r)return []
 const count=Math.floor((Date.parse(r.end)-Date.parse(r.start))/86400000)+1
 return count<=7?Array.from({length:count},(_,i)=>A().memoCore.shiftDay(r.start,i)):[]
})
const position=computed(()=>rounds.value.findIndex((r:any)=>r.index===selected.value?.index))
const globals=computed(()=>{void props.revision;const r=selected.value;return r?(A().memoGantt.deadlines()||[]).filter((x:any)=>x.key.startsWith('deadline:')&&x.due>=r.start&&x.due<=r.end):[]})
const pending=computed(()=>{void props.revision;return A().memoThree.pending()})
const active=computed(()=>selected.value&&!plan.value.historical&&!plan.value.future&&A().memoThree.current()?.index===selected.value.index)
function choose(index:number){selectedIndex.value=index;A().memoThree.selectRound(index,props.day)}
function change(event:Event){choose(Number((event.target as HTMLSelectElement).value))}
function move(step:number){const r=rounds.value[position.value+step];if(r)choose(r.index)}
function edit(row:any){A().memoWorkspace.editor(row.ref,row.ref.list, false,selected.value?.start)}
function complete(row:any){const ref={...row.ref};if(ref.kind==='project')ref.day=A().memoCore.userDay();A().memoWorkspace.complete(ref)}
</script>
<template>
  <q-card flat bordered class="cal-col three-day-column" data-category="three" data-overview-list="three">
    <div class="cal-col-head"><span>轮次计划</span><span class="mw-column-count">{{plan.round?plan.done+'/'+plan.total:'尚未安排'}}</span></div>
    <div class="mw-column-meter" role="img" :aria-label="'本轮完成'+plan.done+'/'+plan.total"><span class="mw-column-done" :style="{width:(plan.total?plan.done/plan.total*100:0)+'%'}" /></div>
    <div class="three-round-nav">
      <q-btn flat dense no-caps :disable="position<=0" aria-label="上一轮" @click="move(-1)">‹</q-btn>
      <select v-if="selected" aria-label="选择轮次" :value="selected.index" @change="change"><option v-for="r in rounds" :key="r.index" :value="r.index">{{r.start}} — {{r.end}}{{r.closedAt?' · 已结束':''}}</option></select>
      <q-btn flat dense no-caps :disable="position<0||position>=rounds.length-1" aria-label="下一轮" @click="move(1)">›</q-btn>
      <q-btn flat dense no-caps aria-label="新建轮次" @click="A().memoThree.rangeEditor()">＋ 新建</q-btn>
    </div>
    <template v-if="selected">
      <small class="three-round-dates">{{selected.start}} — {{selected.end}} · {{plan.historical?'已结束':plan.future?'预排':active?'进行中':'待开始'}}{{selected.originalEnd?' · 原定结束 '+selected.originalEnd:''}}</small>
      <div v-if="dates.length" class="three-day-strip" role="img" aria-label="轮次日期进度">
        <div v-for="(date,index) in dates" :key="date" :class="{current:date===A().memoCore.userDay(),past:date<A().memoCore.userDay()}" :aria-current="date===A().memoCore.userDay()?'date':undefined"><span>第{{index+1}}天</span><small>{{date.slice(5)}}</small></div>
      </div>
      <div v-if="!plan.historical" class="round-actions"><q-btn flat dense no-caps @click="A().memoThree.rangeEditor(selected.index)">调整日期</q-btn><q-btn v-if="active" flat dense no-caps @click="A().memoThree.earlyEnd(selected.index)">提前结束本轮</q-btn></div>
      <div v-if="globals.length" class="three-deadlines"><small>本轮截止事项</small><button v-for="item in globals" :key="item.key" type="button" class="btn btn-small" @click="A().ms.openList(item.due)">{{item.due.slice(5)}} · {{item.title}}</button></div>
      <div v-for="row in plan.rows" :key="row.key" class="round-entry" :data-round-key="row.key">
        <template v-if="row.kind==='three'&&active"><OverviewTask :x="row" category="three" :done="row.done" /></template>
        <button v-else type="button" class="three-future-row" :disabled="plan.historical" @click="row.kind==='three'?edit(row):A().memoGantt.quick(row.key)"><span>{{row.text}}</span><small>{{row.kind==='project'?(row.overallDone?'项目已达成':row.done?'本轮已推进':'尚未推进'):row.done?'已完成':plan.future?'预排':'未完成'}}</small></button>
        <details v-if="plan.historical&&row.note"><summary>备注</summary><p class="round-snapshot-note">{{row.note}}</p></details>
        <small v-if="row.due">截止 {{row.due}}{{row.manual?' · 手动安排':''}}{{row.conflict?' · 截止日位于轮次外':''}}</small>
        <small v-if="row.delayed">延期</small>
        <div v-if="!plan.historical" class="round-actions">
          <q-btn v-if="row.kind!=='three'&&active" flat dense no-caps @click="complete(row)">{{row.kind==='project'?'今日推进':row.done?'撤销完成':'完成任务'}}</q-btn>
          <q-btn v-if="row.kind!=='three'" flat dense no-caps @click="edit(row)">任务与备注</q-btn>
          <q-btn v-if="!row.done" flat dense no-caps @click="A().memoThree.assignmentEditor(row.ref)">安排轮次</q-btn>
        </div>
      </div>
      <q-btn v-if="!plan.historical" flat dense no-caps class="overview-add" aria-label="添加轮次任务" @click.stop="A().memoThree.editor(undefined,selected.start)">＋ 添加</q-btn>
    </template>
    <details v-if="pending.length" class="round-pending"><summary>待安排（{{pending.length}}）</summary><div v-for="row in pending" :key="row.key" class="round-entry"><span>{{row.text}}</span><q-btn flat dense no-caps @click="A().memoThree.assignmentEditor(row.ref)">安排轮次</q-btn></div></details>
  </q-card>
</template>
