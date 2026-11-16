<script setup lang="ts">
import { computed } from 'vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const plan=computed(()=>{void props.revision;return A().memoThree.projection(props.day)})
const dates=computed(()=>plan.value.round?[0,1,2].map(offset=>A().memoCore.shiftDay(plan.value.round.start,offset)):[])
function open(row:any){if(row.task)A().memoWorkspace.complete(row.ref)}
</script>
<template>
  <q-card flat bordered class="cal-col three-day-column" data-category="three">
    <div class="cal-col-head"><span>三天计划</span><span v-if="plan.round" class="mw-column-count">{{plan.done}}/{{plan.total}}</span></div>
    <template v-if="plan.round">
      <div class="three-day-strip" aria-label="三天轮次">
        <div v-for="(date,index) in dates" :key="date" :class="{current:date===A().memoCore.userDay(),past:date<A().memoCore.userDay()}" :aria-current="date===A().memoCore.userDay()?'date':undefined"><span>第{{index+1}}天</span><small>{{date.slice(5).replace('-','/')}}</small></div>
      </div>
      <small class="three-round-dates">{{plan.round.start.slice(5)}}—{{plan.round.end.slice(5)}} · {{plan.historical?'本轮结果':'第'+plan.round.day+'天'}}</small>
      <div class="mw-column-meter" role="img" :aria-label="'本轮完成'+plan.done+'/'+plan.total"><span class="mw-column-done" :style="{width:(plan.total?plan.done/plan.total*100:0)+'%'}" /></div>
      <template v-if="plan.historical">
        <div v-for="row in plan.rows" :key="row.id" class="three-history-row"><span>{{row.text}}</span><small>{{row.done?'已完成':'未完成 · 已顺延'}}</small></div>
      </template>
      <template v-else>
        <button v-for="row in plan.rows.filter((x:any)=>!x.done)" :key="row.id" class="btn three-task-row" :aria-label="'打开三天任务：'+row.text" @click.stop="open(row)"><span>{{row.text}}</span><small v-if="row.delayed" class="three-delayed">延期</small><small>+{{row.task.points||0}}分</small></button>
        <details v-if="plan.done" class="mw-completed"><summary>已完成（{{plan.done}}）</summary><button v-for="row in plan.rows.filter((x:any)=>x.done)" :key="row.id" class="btn three-task-row" @click.stop="open(row)">{{row.text}} ✓</button></details>
        <q-btn flat dense no-caps class="overview-add" aria-label="添加三天任务" @click.stop="A().memoThree.editor()">＋ 添加</q-btn>
      </template>
    </template>
    <template v-else><p class="hint">三天内想完成的任务</p><q-btn flat no-caps @click.stop="A().memoThree.state()?A().memoWorkspace.setDay(A().memoCore.userDay()):A().memoThree.setup()">{{A().memoThree.state()?'查看当前轮':'开始三天计划'}}</q-btn></template>
  </q-card>
</template>
