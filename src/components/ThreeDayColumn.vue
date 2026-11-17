<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import OverviewTask from './OverviewTask.vue'
const props=defineProps<{day:string;revision:number}>()
const A=()=>window.App
const offset=ref(0)
watch(()=>props.day,()=>{offset.value=0})
const viewDay=computed(()=>A().memoCore.shiftDay(props.day,offset.value*3))
const deadlines=computed(()=>{void props.revision;const r=A().memoThree.round(viewDay.value);return r?(A().memoGantt?.deadlines()||[]).filter((x:any)=>x.due>=r.start&&x.due<=r.end):[]})
const plan=computed(()=>{void props.revision;return A().memoThree.projection(viewDay.value)})
const dates=computed(()=>plan.value.round?[0,1,2].map(offset=>A().memoCore.shiftDay(plan.value.round.start,offset)):[])
const currentDay=computed(()=>{void props.revision;const current=A().memoThree.round();return current?.index===plan.value.round?.index?current.day:null})
const doneKey=computed(()=>'task-fold:overview:three:'+plan.value.round?.start+':done')
function expanded(){try{return localStorage.getItem(doneKey.value)==='open'}catch{return false}}
function remember(event:Event){try{localStorage.setItem(doneKey.value,(event.target as HTMLDetailsElement).open?'open':'closed')}catch{}}
</script>
<template>
  <q-card flat bordered class="cal-col three-day-column" data-category="three" data-overview-list="three">
    <div class="cal-col-head"><span>三天计划</span><span class="mw-column-count">{{plan.round?plan.done+'/'+plan.total:'尚未开始'}}</span></div>
    <div class="mw-column-meter" role="img" :aria-label="'本轮完成'+plan.done+'/'+plan.total"><span class="mw-column-done" :style="{width:(plan.total?plan.done/plan.total*100:0)+'%'}" /></div>
    <template v-if="plan.round">
      <div class="three-round-nav" role="group" aria-label="选择三天轮次"><q-btn v-for="(label,index) in ['本轮','下轮','下下轮']" :key="index" flat dense no-caps :aria-pressed="offset===index" :class="{selected:offset===index}" @click="offset=index">{{label}}</q-btn></div>
      <div v-if="deadlines.length" class="three-deadlines"><small>本轮截止</small><button v-for="item in deadlines" :key="item.key" type="button" class="btn btn-small" @click="item.ref?A().memoWorkspace.editor(item.ref):A().ms.openList(item.due)">{{item.due.slice(5)}} · {{item.title}}{{item.done?' · 已完成':''}}</button></div>
      <div class="three-day-strip" role="img" :aria-label="'本轮'+plan.round.start+'至'+plan.round.end+(currentDay?'，当前第'+currentDay+'天':'')">
        <div v-for="(date,index) in dates" :key="date" :class="{current:date===A().memoCore.userDay(),past:date<A().memoCore.userDay()}" :aria-current="date===A().memoCore.userDay()?'date':undefined"><span>第{{index+1}}天</span><small>{{date.slice(8)}}日</small></div>
      </div>
      <small class="three-round-dates">{{plan.round.start.slice(5)}}—{{plan.round.end.slice(5)}} · {{plan.historical?'本轮结果':currentDay?'第'+currentDay+'天':'未开始'}}</small>
      <template v-if="plan.historical">
        <div v-for="row in plan.rows" :key="row.id" class="three-history-row"><span>{{row.text}}</span><small>{{row.done?'已完成':'未完成 · 已顺延'}}</small></div>
      </template>
      <template v-else-if="plan.future">
        <button v-for="row in plan.rows" :key="row.id" class="three-future-row" type="button" @click="A().memoThree.editor(row.ref,viewDay)"><span>{{row.text}}</span><small>预排 · 编辑</small></button>
        <q-btn flat dense no-caps class="overview-add" aria-label="添加三天任务" @click.stop="A().memoThree.editor(undefined,viewDay)">＋ 添加</q-btn>
      </template>
      <template v-else>
        <OverviewTask v-for="row in plan.rows.filter((x:any)=>!x.done)" :key="row.id" :x="row" category="three" />
        <details v-if="plan.done" class="mw-completed" :data-fold-key="doneKey" :open="expanded()" @toggle="remember">
          <summary>已完成（{{plan.done}}）</summary>
          <OverviewTask v-for="row in plan.rows.filter((x:any)=>x.done)" :key="row.id" :x="row" category="three" done />
        </details>
        <q-btn flat dense no-caps class="overview-add" aria-label="添加三天任务" @click.stop="A().memoThree.editor()">＋ 添加</q-btn>
      </template>
    </template>
    <template v-else><q-btn flat dense no-caps class="overview-add" @click.stop="A().memoThree.state()?A().memoWorkspace.setDay(A().memoCore.userDay()):A().memoThree.setup()">{{A().memoThree.state()?'查看当前轮':'开始三天计划'}}</q-btn></template>
  </q-card>
</template>

