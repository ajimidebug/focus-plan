import { createApp, h, markRaw } from 'vue'
import { Quasar, QDialog, QBtn, Notify } from 'quasar'
import { Chart, registerables } from 'chart.js'
import Papa from 'papaparse'
import { z } from 'zod'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import zh from '@fullcalendar/core/locales/zh-cn'
import TaskOverview from '../components/TaskOverview.vue'

Chart.register(...registerables)
const instances=new Map<Element,()=>void>()
let screen:any, router:any, modalApp:any=null, modalRoot:HTMLElement|null=null, priorFocus:HTMLElement|null=null
const A=()=>window.App
const mount=(node:Element, component:any, props:any={})=>{
  instances.get(node)?.()
  const app=createApp({render:()=>h(component,props)}).use(Quasar)
  app.mount(node)
  const dispose=()=>{app.unmount();instances.delete(node)}
  instances.set(node,dispose)
  return {app,dispose}
}
export function installFramework(state:any, appRouter:any) {
  screen=state;router=appRouter
  window.App=window.App||{}
  const framework={
    openModal, closeModal, toast, barChart, lineChart, calendar, overview,
    csv:(rows:any[][])=>Papa.unparse(rows,{quotes:true,newline:'\r\n'}),
    validateTask:(text:string,minutes:unknown)=>z.object({text:z.string().trim().min(1,'请填写任务名称'),minutes:z.number().finite().min(0).max(1440)}).safeParse({text,minutes:Number(minutes)||0}),
    busy:()=>screen.modalCount>0||screen.more||screen.dirtyDialogs>0,
    changed:()=>{screen.revision++},
    get mounted(){return instances.size},
  }
  window.App.framework=markRaw(framework)
  const observer=new MutationObserver(()=>{for(const [node,dispose]of instances)if(!node.isConnected)dispose()})
  observer.observe(document.body,{childList:true,subtree:true})
  window.addEventListener('focus-storage',(event:any)=>{screen.storage=event.detail?.message||A().store?.status()?.message||'';screen.phase=event.detail?.phase||'';screen.revision++})
}
export async function startLegacy(state:any) {
  await new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');script.src='./legacy-core.js';script.onload=()=>resolve();script.onerror=()=>reject(Error('程序资源加载失败，请联网重试或打开恢复入口'));document.head.append(script)
  })
  const original=A().app.switchView
  A().app.switchView=(view:string)=>{
    const target=view==='queue'?'tasks':view==='memo-timeaxis'?'timeline':view
    original(view)
    if(view==='memo-review')A().memoWorkspace.renderReview(A().store.getDay(A().memoCore.userDay()))
    state.view=target
    if(router.currentRoute.value.params.page!==target)void router.replace('/'+target)
  }
  await A().app.init()
  if(!A().app.ready)throw Error(A().store.status().message)
}
function disposeDialog() {
  const root=modalRoot
  if(root){root._disposeModal?.();root._disposeModal=null;root.replaceChildren();document.querySelector('.q-page-container > .legacy-host')?.append(root)}
  const app=modalApp;modalApp=null;modalRoot=null
  app?.unmount();screen.modalCount=0;screen.dirtyDialogs=0
}
export function closeModal() {
  disposeDialog()
  if(priorFocus?.isConnected)priorFocus.focus({preventScroll:true})
  A().tasks?.pipNeedSpace?.(false)
}
function openModal(title:string,bodyHTML:string,actionsHTML:string,opts:any={}) {
  disposeDialog()
  const root=document.getElementById('modal-root')||document.body.appendChild(document.createElement('div'))
  root.id='modal-root';modalRoot=root;priorFocus=document.activeElement as HTMLElement
  const mask=document.createElement('div');mask.className='modal-mask'
  mask.innerHTML='<div class="modal" tabindex="-1"><h3 class="modal-heading" id="focus-plan-modal-title"></h3><div class="modal-body">'+(bodyHTML||'')+'</div><div class="modal-actions">'+(actionsHTML||'')+'</div>'+(opts.rechoose?'<button class="rechoose-btn" data-act="rechoose">重新选择</button>':'')+'</div>'
  root.append(mask)
  const modal=mask.querySelector('.modal') as HTMLElement
  modal.querySelector('.modal-heading')!.textContent=String(title||'')
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','focus-plan-modal-title')
  if(opts.wide)modal.classList.add('framework-wide-modal')
  const cancel=()=>{
    if(A().memoActions?.busy())return
    if(opts.cancelOnBackdrop){const b=modal.querySelector<HTMLButtonElement>('[data-act="cancel"]');if(b&&!b.disabled)b.click()}
    else if(!opts.lock)closeModal()
  }
  if(opts.closeIcon){const button=document.createElement('button');button.className='modal-x';button.textContent='×';button.setAttribute('aria-label','关闭');button.onclick=()=>{if(!A().memoActions?.busy())closeModal()};modal.append(button)}
  modal.addEventListener('input',()=>{screen.dirtyDialogs=1})
  screen.modalCount=1
  // The returned DOM is synchronous for existing domain form handlers. Quasar
  // takes ownership of placement, focus trapping and scroll locking on mount.
  modalApp=createApp({render:()=>h(QDialog,{modelValue:true,persistent:true,noShake:true,role:'presentation','aria-modal':undefined},()=>h('div',{class:'framework-dialog-layer legacy-host',ref:(el:any)=>{if(el&&root.parentNode!==el)el.append(root)}}))}).use(Quasar)
  const mountPoint=document.createElement('div');mountPoint.className='framework-dialog-mount';document.body.append(mountPoint)
  const app=modalApp,unmount=app.unmount.bind(app)
  app.unmount=()=>{unmount();mountPoint.remove()}
  app.mount(mountPoint)
  let pointer:any=null
  const isBackdrop=(target:any)=>target?.classList?.contains('q-dialog__backdrop')&&target.closest('.q-dialog')?.contains(root)
  const down=(event:PointerEvent)=>{pointer=isBackdrop(event.target)&&event.button===0?{x:event.clientX,y:event.clientY,id:event.pointerId}:null}
  const up=(event:PointerEvent)=>{if(pointer)pointer.released=isBackdrop(event.target)&&pointer.id===event.pointerId&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<=8}
  const click=(event:MouseEvent)=>{const p=pointer;pointer=null;if(isBackdrop(event.target)&&p?.released&&Math.hypot(event.clientX-p.x,event.clientY-p.y)<=8)cancel()}
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel()}}
  document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true)
  root._disposeModal=()=>{document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true)}
  opts.onOpen?.(modal)
  requestAnimationFrame(()=>{if(modal.isConnected&&!modal.contains(document.activeElement))modal.focus({preventScroll:true})})
  return modal
}
function toast(message:string,timeout=2800) { Notify.create({message:String(message),timeout,position:'top',classes:'framework-notification',textColor:'white',color:'grey-9',multiLine:true}) }
function chart(container:HTMLElement,type:'bar'|'line',data:any) {
  if(!container)return
  instances.get(container)?.()
  container.replaceChildren();container.classList.add('framework-chart')
  const canvas=document.createElement('canvas');container.append(canvas)
  const label=type==='bar'?'按日分类时长，单位分钟':'按日学习时长，单位分钟'
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label)
  const instance=new Chart(canvas,{type,data,options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:type==='bar',position:'bottom'}},scales:{y:{beginAtZero:true,stacked:type==='bar',title:{display:true,text:'分钟'}},x:{stacked:type==='bar',ticks:{maxTicksLimit:8}}}}})
  instances.set(container,()=>{instance.destroy();instances.delete(container)})
  const details=document.createElement('details');details.className='framework-chart-data';const summary=document.createElement('summary');summary.textContent='查看图表数据';details.append(summary)
  const table=document.createElement('table'),head=document.createElement('tr')
  for(const text of ['日期',...data.datasets.map((d:any)=>d.label)]){const th=document.createElement('th');th.textContent=text;head.append(th)}
  table.append(head);data.labels.forEach((date:string,i:number)=>{const row=document.createElement('tr');for(const value of [date,...data.datasets.map((d:any)=>d.data[i])]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell)}table.append(row)});details.append(table);container.after(details)
}
function barChart(node:HTMLElement,rows:any[]) { node?.nextElementSibling?.classList.contains('framework-chart-data')&&node.nextElementSibling.remove();chart(node,'bar',{labels:rows.map(x=>x.label),datasets:[['study','学习','#2563eb'],['extend','拓展','#15803d'],['fun','辅助','#0891b2']].map(([key,label,color])=>({label,backgroundColor:color,data:rows.map(x=>Math.max(0,Number(x[key])||0)),borderRadius:3}))}) }
function lineChart(node:HTMLElement,values:number[],labels:string[]) { node?.nextElementSibling?.classList.contains('framework-chart-data')&&node.nextElementSibling.remove();chart(node,'line',{labels,datasets:[{label:'学习',data:values,borderColor:'#2563eb',backgroundColor:'#2563eb20',fill:true,tension:.15,pointRadius:2}]}) }
function calendar(node:HTMLElement,month:string,selected:string,onSelect:(day:string)=>void) {
  const days=A().store.data().days
  const events=Object.keys(days).filter(k=>k.startsWith(month.slice(0,7))).flatMap(k=>{const d=days[k];const count=['required','ideal','extra'].reduce((n,c)=>n+(d.tasks?.[c]||[]).filter((t:any)=>!t.memoMovedTo&&!t.memoDismissed).length,0);return count?[{id:k,title:count+'项任务',start:k,allDay:true}]:[]})
  mount(node,FullCalendar,{options:{plugins:[dayGridPlugin,interactionPlugin],locale:zh,firstDay:1,initialView:'dayGridMonth',initialDate:month,headerToolbar:false,height:'auto',fixedWeekCount:false,events,dayMaxEvents:1,editable:false,selectable:false,dateClick:(info:any)=>onSelect(info.dateStr),dayCellClassNames:(info:any)=>{const d=info.date;const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return key===selected?['framework-selected-day']:[]}}})
}
function overview(node:HTMLElement,day:string) { mount(node,TaskOverview,{day,revision:screen.revision}) }
