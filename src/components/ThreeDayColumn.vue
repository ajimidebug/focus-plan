<script setup lang="ts">
import { computed, ref } from 'vue'
import OverviewTask from './OverviewTask.vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const rounds=computed(()=>{void props.revision;return A().memoThree.rounds()})
const selectionRevision=ref(0)
const selected=computed(()=>{void props.revision;void selectionRevision.value;return A().memoThree.selected(props.day)})
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
function choose(index:number){A().memoThree.selectRound(index,props.day);selectionRevision.value++}
function change(event:Event){choose(Number((event.target as HTMLSelectElement).value))}
function move(step:number){const r=rounds.value[position.value+step];if(r)choose(r.index)}
const delayed=computed(()=>plan.value.rows.filter((row:any)=>!row.done&&row.delayed))
const unfinished=computed(()=>plan.value.rows.filter((row:any)=>!row.done&&!row.delayed))
const finished=computed(()=>plan.value.rows.filter((row:any)=>row.done))
const sections=computed(()=>[
 { key:'delayed', label:'延期待办', rows:delayed.value },
 { key:'unfinished', label:'', rows:unfinished.value },
 { key:'finished', label:'已完成', rows:finished.value },
])
function edit(row:any){
 A().memoWorkspace.editor(row.ref,row.ref.list,false,null,!active.value)
}
function open(row:any){
 if(!active.value)return edit(row)
 const taskRef=row.kind==='project'?{...row.ref,day:A().memoCore.userDay()}:row.ref
 A().memoWorkspace.complete(taskRef, row.kind==='project' ? '今日推进' : undefined)
}
</script>
<template>
  <q-card flat bordered class="cal-col three-day-column" data-category="three" data-overview-list="three" @click.stop>
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
      <template v-for="section in sections" :key="section.key">
        <component v-if="section.rows.length" :is="section.label?'details':'div'"
          :key="selected.index+':'+section.key"
          :class="section.key==='finished'?'mw-completed':section.key==='delayed'?'mw-late-section':undefined"
          :open="section.key==='delayed'?true:undefined">
          <summary v-if="section.label">{{section.label}}（{{section.rows.length}}）</summary>
          <div v-for="row in section.rows" :key="row.key" :class="{'round-entry':plan.historical}" :data-round-key="row.key">
            <template v-if="plan.historical">
              <div class="three-future-row"><span>{{row.text}}</span><small>{{row.kind==='project'?(row.overallDone?'项目已达成':row.done?'本轮已推进':'尚未推进'):row.done?'已完成':'未完成'}}</small></div>
              <small v-if="row.due">截止 {{row.due}}</small>
              <details v-if="row.note"><summary>备注</summary><p class="round-snapshot-note">{{row.note}}</p></details>
            </template>
            <OverviewTask v-else :x="row" category="three" :done="row.done" :open="()=>open(row)">
              <small v-if="row.due">截止 {{row.due}}{{row.manual?' · 手动安排':''}}{{row.conflict?' · 截止日位于轮次外':''}}</small>
              <small v-if="row.kind==='project'">{{row.overallDone?'项目已达成':row.done?'本轮已推进':'尚未推进'}}</small>
              <small v-if="row.note">有备注</small>
            </OverviewTask>
          </div>
        </component>
      </template>
      <q-btn v-if="!plan.historical" flat dense no-caps class="overview-add" aria-label="添加轮次任务" @click.stop="A().memoThree.editor(undefined,selected.start)">＋ 添加</q-btn>
    </template>
    <details v-if="pending.length" class="round-pending">
      <summary>待安排（{{pending.length}}）</summary>
      <OverviewTask v-for="row in pending" :key="row.key" :x="row" category="three" :open="()=>edit(row)" />
    </details>
  </q-card>
</template>
