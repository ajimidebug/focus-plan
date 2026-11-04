<script setup lang="ts">
import { computed, ref } from 'vue'
import HtmlIsland from './HtmlIsland.vue'
const props = defineProps<{ day: string; revision: number }>()
const collapsed = ref<Record<string, boolean>>({})
const A = () => window.App
const lists = [{key:'required',name:'必须',color:'negative'}, {key:'ideal',name:'理想',color:'warning'}, {key:'extra',name:'长期',color:'positive'}]
const columns = computed(() => {
  void props.revision
  return lists.map(list => ({ ...list, progress: A().memoFinance.column(props.day,list.key), items: A().memoWorkspace.taskItems(props.day,list.key), habits: A().memoFinance.plans(props.day).filter((x:any)=>x.r.list===list.key) }))
})
function done(x:any) { return x.deferred ? false : ['project','daily'].includes(x.ref.kind) ? !!x.task.days?.[x.ref.day] : x.ref.kind==='queue' ? !!(x.task.doneAt||x.task.doneDay) : !!x.task.done }
function open(x:any) { if (x.deferred) { if(x.currentRef) A().memoWorkspace.enter('today',x.currentRef.day||A().memoSchedule.find(x.currentRef)?.assignment?.day); return } A().memoWorkspace.complete(x.ref) }
function score(x:any) { return A().memoWorkspace.score(x.task,x.ref) }
function labels(x:any) { return (A().memoReview?.label(x.task)||'')+(A().memoRecurrence?.label(x.task)||'') }
function groups(items:any[]) {
  const open=items.filter(x=>!done(x)), finished=items.filter(done)
  return { open, finished }
}
function add(key:string) { A().memoWorkspace.editor(null,key) }
</script>
<template>
  <section class="mw-overview framework-overview" aria-label="三栏任务概览">
    <div class="overview-heading"><h2>{{day.slice(5).replace('-','月')}}日任务</h2><span>北京时间 04:00 分日</span></div>
    <div class="cal-cols framework-columns">
      <q-card v-for="col in columns" :key="col.key" flat bordered class="cal-col" :data-overview-list="col.key" :data-category="col.key">
        <div class="cal-col-head"><span>{{col.name}}</span><q-badge :color="col.color" :label="col.progress.label" /></div>
        <div class="mw-column-meter" role="img" :aria-label="col.name+'：'+col.progress.label+'；'+col.progress.segments.map((s:any)=>s.label+s.count+'项').join('，')">
          <span v-for="seg in col.progress.segments" :key="seg.state" :class="'mw-column-'+seg.state" :data-progress-state="seg.state" :style="{width:seg.percent+'%'}" aria-hidden="true" />
        </div>
        <small v-if="col.progress.deferred" class="mw-column-deferred-label">延期 {{col.progress.deferred}}项</small>
        <template v-for="x in groups(col.items).open" :key="JSON.stringify(x.ref)">
          <q-btn flat no-caps class="cal-task overview-task" :class="{'mw-deferred':x.deferred}" :data-overview-ref="x.deferred?undefined:JSON.stringify(x.ref)" :data-carried="!!A().memoFlow.isCarried(x.task)" :data-category="col.key" :data-bounty="!!A().memoOrganize?.bounty(score(x))" :aria-label="'打开任务：'+x.task.text" @click.stop="open(x)">
            <span class="ov-task-name">{{x.task.text}}</span>
            <span v-if="score(x)!==null" class="mw-score">+{{score(x)}}分</span>
            <small v-if="x.deferred" class="mw-deferred-status">{{x.closed?'已补记至':'延期至'}} {{x.toDay}}</small>
            <small v-else-if="x.task.originalDay" class="carried-label">原安排 {{x.task.originalDay}}</small>
            <HtmlIsland v-if="labels(x)" :html="labels(x)" class="overview-labels" />
            <small v-if="x.task.standard">标准：{{x.task.standard}}</small>
            <small v-for="sub in x.task.subs||[]" :key="sub.id">· {{sub.text}}{{sub.done?' ✓':''}}</small>
            <small v-for="g in x.task.groups||[]" :key="g.id">{{g.name}} · {{(g.subs||[]).filter((s:any)=>s.done).length}}/{{(g.subs||[]).length}}</small>
          </q-btn>
        </template>
        <q-btn v-for="h in col.habits" :key="h.it.id" flat no-caps class="habit-plan-row" :class="{'habit-plan-goal-done':h.n>=h.r.target&&A().memoPenalty.policy(h.it,day).mode!=='punch'}" :data-habit-kind="A().memoPenalty.policy(h.it,day).mode" :data-habit-punch="h.it.id" :data-habit-day="day">
          <span class="habit-plan-title">{{h.it.text}}</span><span class="habit-plan-meta"><small>{{h.n}}/{{h.r.target}}次</small><strong>{{A().checkin.memoPoints(h.it,day)>0?'+':''}}{{A().checkin.memoPoints(h.it,day)}}分</strong></span>
        </q-btn>
        <q-btn v-if="groups(col.items).finished.length" flat dense no-caps class="overview-done-toggle" :aria-expanded="!collapsed[col.key]" @click.stop="collapsed[col.key]=!collapsed[col.key]">已完成 {{groups(col.items).finished.length}} {{collapsed[col.key]?'▸':'▾'}}</q-btn>
        <template v-if="!collapsed[col.key]">
          <q-btn v-for="x in groups(col.items).finished" :key="JSON.stringify(x.ref)" flat no-caps class="cal-task overview-task done" :data-overview-ref="JSON.stringify(x.ref)" :aria-label="'打开任务：'+x.task.text" @click.stop="open(x)"><span class="ov-task-name">{{x.task.text}} ✓</span><span v-if="score(x)!==null" class="mw-score">+{{score(x)}}分</span></q-btn>
        </template>
        <q-btn flat dense no-caps class="overview-add" :aria-label="'添加'+col.name+'任务'" @click.stop="add(col.key)">＋ 添加</q-btn>
        <HtmlIsland v-if="col.key==='required'" :html="A().memoGoals?.html(day,true)||''" />
      </q-card>
    </div>
  </section>
</template>
