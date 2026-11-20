<script setup lang="ts">
import { computed } from 'vue'
import TaskColumn from './TaskColumn.vue'
import OverviewTask from './OverviewTask.vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const plan=computed(()=>{void props.revision;return A().memoThree.projection(props.day)})
const selected=computed(()=>plan.value.round)
function add(){A().memoThree.editor(undefined,props.day)}
const roundDay=computed(()=>{
 const r=selected.value
 if(!r)return null
 const start=Date.parse(r.start), dayMs=86400000
 return {number:(Date.parse(props.day)-start)/dayMs+1,total:(Date.parse(r.end)-start)/dayMs+1}
})
const globals=computed(()=>{void props.revision;const r=selected.value;return r?(A().memoGantt.deadlines()||[]).filter((x:any)=>x.key.startsWith('deadline:')&&x.due>=r.start&&x.due<=r.end):[]})
const pending=computed(()=>{void props.revision;return A().memoThree.pending().filter((row:any)=>!plan.value.rows.some((visible:any)=>visible.key===row.key))})
const active=computed(()=>selected.value&&!plan.value.historical&&!plan.value.future&&A().memoThree.current()?.index===selected.value.index)
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
 if(row.kind==='project'){
   return A().memoWorkspace.editor({...row.ref,day:A().memoCore.userDay()},'extra',false,props.day,true,true)
 }
 if(!active.value){
   if(row.kind==='three')return edit(row)
   return A().memoWorkspace.editor(row.ref,row.ref.list,false,props.day,true,true)
 }
 A().memoWorkspace.complete(row.ref)
}
</script>
<template>
  <TaskColumn area category="three" class="three-day-column" label="添加轮次任务" :add="selected&&!plan.historical?add:undefined">
    <div class="three-round-header" @click.stop>
      <div class="cal-col-head"><span>轮次计划</span><span v-if="selected" class="mw-column-count">{{plan.done}}/{{plan.total}}</span></div>
      <div v-if="roundDay && selected" class="three-round-controls">
        <span class="three-round-position" role="img" :aria-label="'第 '+roundDay.number+' 天，共 '+roundDay.total+' 天'">第{{roundDay.number}}/{{roundDay.total}}天</span>
        <q-btn v-if="!plan.historical" flat dense no-caps aria-label="调整日期" @click="A().memoThree.rangeEditor(selected.index,day)">调整</q-btn>
      </div>
      <div v-else class="three-round-controls">尚未安排</div>
    </div>
    <div class="mw-column-meter" role="img" :aria-label="'本轮完成'+plan.done+'/'+plan.total"><span class="mw-column-done" :style="{width:(plan.total?plan.done/plan.total*100:0)+'%'}" /></div>
    <template v-if="selected">
      <div v-if="globals.length" class="three-deadlines"><small>本轮截止事项</small><button v-for="item in globals" :key="item.key" type="button" class="btn btn-small" @click="A().ms.openList(item.due)">{{item.due.slice(5)}} · {{item.title}}</button></div>
      <template v-for="section in sections" :key="section.key">
        <component v-if="section.rows.length" :is="section.label?'details':'div'"
          :key="selected.start+':'+section.key"
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
    </template>
    <details v-if="pending.length" class="round-pending">
      <summary>待安排（{{pending.length}}）</summary>
      <OverviewTask v-for="row in pending" :key="row.key" :x="row" category="three" :open="()=>edit(row)" />
    </details>
  </TaskColumn>
</template>
