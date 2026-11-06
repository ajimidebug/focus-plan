<script setup lang="ts">
import { computed } from 'vue'
import HtmlIsland from './HtmlIsland.vue'
const props=defineProps<{x:any;category:string;done?:boolean}>()
const A=()=>window.App
const score=computed(()=>A().memoWorkspace.score(props.x.task,props.x.ref))
const weight=computed(()=>A().memoWorkspace.priorityWeight(props.x.task))
const labels=computed(()=>[A().tasks?.carryTagHTML?.(props.x.task),A().tasks?.lecTagHTML?.(props.x.task),A().memoReview?.label(props.x.task),A().memoRecurrence?.label(props.x.task)].filter(Boolean).join(''))
</script>
<template>
  <HtmlIsland v-if="x.deferred" :html="A().memoWorkspace.deferredHTML(x,true)" />
  <div v-else class="overview-task-frame"><q-btn flat no-caps class="cal-task overview-task" :class="{done}" :data-overview-ref="JSON.stringify(x.ref)" :data-carried="!!A().memoFlow.isCarried(x.task)" :data-category="category"  :data-bounty="!!A().memoOrganize?.bounty(score)" :data-bounty-tier="A().memoOrganize?.bountyTier(score)||'none'" :data-priority="category==='required'?weight:undefined" :data-score="A().memoWorkspace.scoreBand(score)" :aria-label="'打开任务：'+x.task.text+(A().memoFlow.isCarried(x.task)?'，逾期顺延':'')+(category==='required'?'，优先级'+weight:'')+(score!==null?'，'+score+'分':'')" @click.stop="A().memoWorkspace.complete(x.ref)">
    <span class="ov-task-name">{{x.task.text}}{{done?' ✓':''}}</span>
    <small v-if="category==='required'&&weight!==3" class="mw-priority-note">优先 {{weight}}</small>
    <span v-if="score!==null" class="mw-score">+{{score}}分</span>
    <HtmlIsland v-if="labels" :html="labels" class="overview-labels" />
    <small v-if="x.task.standard" class="t-std">标准：{{x.task.standard}}</small>
    <template v-for="g in x.task.groups||[]" :key="g.id"><small class="t-ctx grp">{{g.name}} · {{(g.subs||[]).filter((s:any)=>s.done===true).length}}/{{(g.subs||[]).length}}</small><small v-for="sub in g.subs||[]" :key="sub.id" class="t-ctx sub">· {{sub.text}}{{sub.done===true?' ✓':sub.done===false?' ✗':''}}</small></template>
    <small v-for="sub in x.task.subs||[]" :key="sub.id" class="t-ctx sub">· {{sub.text}}（限{{sub.minutes}}分）{{sub.done===true?' ✓':sub.done===false?' ✗':''}}</small>
  </q-btn><button v-if="!done" type="button" class="overview-exec-add" :data-ref="JSON.stringify(x.ref)" @click.stop="A().memoWorkspace.execAdd(x.ref)" aria-label="加入执行队列">＋入队</button></div>
</template>
