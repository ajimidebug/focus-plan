<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScreen } from './stores/screen'
import { installFramework, startLegacy } from './services/framework'
import legacyHTML from './legacy-template.html?raw'
import { views } from './router'

const screen=useScreen(), route=useRoute(), router=useRouter()
const host=ref<HTMLElement>(), stats=ref<HTMLElement>()
const primary=[{view:'memo',name:'笔记',symbol:'✎'},{view:'tasks',name:'任务',symbol:'☷'},{view:'timeline',name:'时间轴',symbol:'◷'},{view:'checkin',name:'积分',symbol:'✓'}]
const more=[{view:'memo-history',name:'笔记历史'},{view:'calendar',name:'日历'},{view:'stats',name:'历史统计'},{view:'cards',name:'闪卡'},{view:'mistakes',name:'错题'},{view:'sport',name:'运动'},{view:'memo-review',name:'今日复盘'},{view:'settings',name:'设置与备份'}]
const names=Object.fromEntries([...primary,...more].map(x=>[x.view,x.name]))
function navigate(view:string) {
  if(!screen.ready)return
  screen.more=false
  if(screen.view==='tasks'&&view==='tasks'){window.App.memoWorkspace.returnToday();return}
  if(route.params.page!==view)void router.push('/'+view)
  else window.App.app.switchView(view)
}
function extra(kind:string) {
  screen.more=false
  if(['history','queue','reviews','legacy','details'].includes(kind)){window.App.app.switchView('tasks');window.App.memoWorkspace.showPane(kind)}
  if(kind==='transfer')window.App.memoTransfer?.open()
  if(kind==='trash')window.App.memoActions.trash()
  if(kind==='ddl')window.App.ms.open()
}
watch(()=>route.params.page,(v)=>{if(screen.ready){const page=typeof v==='string'&&views.has(v)?v:'memo';if(screen.view!==page)window.App.app.switchView(page)}})
onMounted(async()=>{
  if(!host.value)return
  await router.isReady()
  const requestedPage=String(route.params.page||'memo')
  host.value.innerHTML=legacyHTML
  try {
    installFramework(screen,router)
    await startLegacy(screen)
    const stat=document.querySelector('#stat-bar')
    if(stat&&stats.value)stats.value.append(stat)
    screen.ready=true
    const v=requestedPage
    window.App.app.switchView(views.has(v)?v:'memo')
  } catch(error:any) { screen.failed=error?.message||'启动未完成';screen.phase='error' }
})
</script>
<template>
  <q-layout view="hHh lpR fFf" class="framework-shell">
    <q-header bordered class="app-topbar">
      <q-toolbar class="shell-toolbar">
        <q-toolbar-title><span class="shell-brand">随手记</span><span class="shell-location">{{names[screen.view]||'时间轴'}}</span></q-toolbar-title>
        <q-btn flat dense no-caps label="设置" aria-label="设置与完整备份" @click="navigate('settings')" />
      </q-toolbar>
      <div ref="stats" class="shell-stats legacy-host" />
      <div class="shell-save-status" :data-state="screen.phase" role="status">{{screen.storage}}</div>
    </q-header>
    <q-page-container>
      <div v-if="!screen.ready&&!screen.failed" class="app-loading" role="status"><q-spinner color="primary" size="32px" /><p>正在读取本机记录…</p></div>
      <q-banner v-if="screen.failed" class="boot-error"><p>启动未完成，原有记录未清除。</p><p>{{screen.failed}}</p><a href="./recovery.html">导出记录或打开恢复入口</a></q-banner>
      <div ref="host" class="legacy-host" :class="{'framework-not-ready':!screen.ready}" />
    </q-page-container>
    <q-footer bordered class="app-bottom-nav">
      <nav aria-label="主导航" class="bottom-grid">
        <q-btn v-for="item in primary" :key="item.view" flat no-caps class="bottom-nav-item" :class="{'nav-active':screen.view===item.view||(item.view==='timeline'&&screen.view==='memo-timeaxis')}" :aria-current="screen.view===item.view?'page':undefined" @click="navigate(item.view)"><span class="nav-symbol" aria-hidden="true">{{item.symbol}}</span><span>{{item.name}}</span></q-btn>
        <q-btn flat no-caps class="bottom-nav-item" :class="{'nav-active':screen.more}" :aria-expanded="screen.more" aria-controls="more-pages" @click="screen.more=!screen.more"><span class="nav-symbol" aria-hidden="true">⋯</span><span>更多</span></q-btn>
      </nav>
    </q-footer>
    <q-dialog v-model="screen.more" position="bottom" aria-label="更多页面">
      <q-card id="more-pages" class="more-sheet"><q-card-section class="more-title"><h2>更多</h2><q-btn flat dense label="收起" v-close-popup /></q-card-section><q-separator />
        <q-card-section class="more-grid"><q-btn v-for="item in more" :key="item.view" outline no-caps :label="item.name" @click="navigate(item.view)" /><q-btn outline no-caps label="待安排任务" @click="extra('queue')" /><q-btn outline no-caps label="复习与周期管理" @click="extra('reviews')" /><q-btn outline no-caps label="基础任务与归档" @click="extra('legacy')" /><q-btn outline no-caps label="详细任务管理" @click="extra('details')" /><q-btn outline no-caps label="批量导入导出" @click="extra('transfer')" /><q-btn outline no-caps label="任务历史" @click="extra('history')" /><q-btn outline no-caps label="删除记录" @click="extra('trash')" /><q-btn outline no-caps label="截止日期" @click="extra('ddl')" /></q-card-section>
        <q-card-section class="more-foot">版本 {{windowRelease}} · 数据保存在当前浏览器</q-card-section>
      </q-card>
    </q-dialog>
  </q-layout>
</template>
<script lang="ts">const windowRelease=window.__RELEASE</script>
