'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b)});
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-06T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');
  await page.waitForFunction(()=>App?.app?.ready&&App?.memoGantt?.nodes&&App?.memoOrganize?.openGroups);
  const initial=await page.evaluate(()=>{
   const A=App,d=A.store.data(),day='2026-11-06';
   d.memoTaskGroups=[{id:'g-math',name:'数学'},{id:'g-life',name:'生活'}];
   A.store.getDay(day).tasks.ideal.push({id:'once-ideal',text:'一次性数学测试',memoGroup:'g-math',done:false});
   A.store.getDay(day).tasks.required.push({id:'once-ungrouped',text:'未分组的事项',done:false});
   d.queue.push({id:'once-queue',text:'待安排的原始任务',createdAt:new Date().toISOString()});
   d.memoProjects=[{id:'p-math',text:'高数强化',memoGroup:'g-math',memoGanttStart:'2026-11-05',memoGanttEnd:'2026-11-20',days:{}},
     {id:'p-life',text:'生活习惯长期项目',memoGroup:'g-life',memoGanttStart:'2026-11-06',memoGanttEnd:'2026-11-15',days:{}}];
   d.milestones=[{id:'ddl-1',name:'考试日',due:'2026-11-08'}];
   A.memoWorkspace.render();
   return A.memoGantt.model().rows.map(n=>({key:n.key,group:n.group,point:n.point}));
  });
  assert(initial.some(n=>n.key==='once:once-ideal'&&n.group==='g-math'),'dated one-off shown in Gantt');
  assert(initial.some(n=>n.key==='once:once-queue'),'unscheduled queue item shown in Gantt');
  assert(initial.some(n=>n.key==='once:once-ungrouped'&&n.group===''),'ungrouped one-off shown');
  assert.equal(await page.locator('.memo-gantt[data-gantt-root]').evaluate(x=>x.open),true,'Gantt initially open');
  assert.equal(await page.locator('.gantt-group[data-gantt-group=""]').evaluate(x=>x.open),false,'ungrouped collapsed by default');
  assert.equal(await page.locator('.gantt-today-line').count(),1,'today marker visible');
  assert.equal(await page.locator('.gantt-past').count(),1,'past region visible');
  assert.equal(await page.locator('.gantt-deadline-line').count(),1,'global deadline shown');
  assert.equal(await page.locator('.mw-inline-waiting').count(),1,'waiting tasks under Gantt');
  assert.equal(await page.locator('.mw-inline-waiting').getByText('待安排的原始任务').count(),1);
  const order=await page.evaluate(()=>{const a=document.querySelector('.memo-gantt'),b=document.querySelector('.mw-inline-waiting');return !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)});
  assert(order,'waiting area follows Gantt');
  const geo=await page.evaluate(()=>{const row=document.querySelector('[data-gantt-row="project:p-math"]'),overlay=document.querySelector('.gantt-time-overlay'),lane=row?.querySelector('.memo-gantt-lane'),label=row?.querySelector('.memo-gantt-name');if(!row||!overlay||!lane||!label)return null;const a=overlay.getBoundingClientRect(),b=lane.getBoundingClientRect(),c=label.getBoundingClientRect();return {delta:Math.abs(a.left-b.left),sameRow:Math.abs(c.top-b.top)<1,uncovered:c.left>=document.querySelector('.memo-gantt-scroller').getBoundingClientRect().left-2}});
  assert(geo&&geo.delta<2&&geo.sameRow&&geo.uncovered,'fixed task column aligns with shared date axis: '+JSON.stringify(geo));
  await page.locator('[data-gantt-quick="once:once-ideal"]').click();
  assert.equal(await page.locator('[data-gantt-picker="gq"] .q-date').count(),1,'Quasar range calendar mounted');
  assert.equal(await page.locator('#gq-dependency-list input[data-gantt-dep][value="p-math"]').count(),1,'same-group project available');
  assert.equal(await page.locator('#gq-dependency-list input[data-gantt-dep][value="p-life"]').count(),0,'cross-group default excluded');
  await page.locator('.gantt-dependency-picker > summary').click();
  await page.locator('[data-gantt-cross]').check();
  assert.equal(await page.locator('#gq-dependency-list input[data-gantt-dep][value="p-life"]').count(),1,'cross-group can be enabled');
  await page.locator('[data-gantt-dep][value="p-math"]').check();
  await page.locator('.gantt-calendar-details > summary').click();
  const calendarText=await page.locator('[data-gantt-picker="gq"] .q-date').innerText();
  assert(!/chevron_left|chevron_right|arrow_drop_down|November/i.test(calendarText),'date picker icons/localization render correctly: '+calendarText.slice(0,140));
  await page.locator('[data-range-one]').click();
  assert.equal(await page.locator('#gq-start').inputValue(),await page.locator('#gq-end').inputValue(),'same-day shortcut');
  await page.locator('[data-act="save"]').last().click();
  assert.equal(await page.evaluate(()=>App.store.data().days['2026-11-06'].tasks.ideal.find(t=>t.id==='once-ideal').memoGanttDependencies[0]),'p-math');
  assert.equal(await page.locator('.memo-gantt[data-gantt-root]').evaluate(x=>x.open),true,'Gantt stays open after save');
  assert.equal(await page.locator('.gantt-group[data-gantt-group=""]').evaluate(x=>x.open),false,'ungrouped state persists after save');
  const cycle=await page.evaluate(()=>{
   const A=App,p=A.store.data().memoProjects.find(x=>x.id==='p-math');
   try{A.memoGantt.validate(p,p.memoGanttStart,p.memoGanttEnd,['once:once-ideal']);return false}catch(e){return /循环/.test(e.message)}
  });
  assert(cycle,'cross-type dependency cycle blocked');
  await page.locator('.memo-gantt > summary').click();
  await page.evaluate(()=>App.memoWorkspace.render());
  assert.equal(await page.locator('.memo-gantt[data-gantt-root]').evaluate(x=>x.open),false,'root fold persists after render');
  await page.locator('.memo-gantt > summary').click();
  await page.evaluate(async()=>{
   const A=App;
   if(!await A.memoActions.commit(()=>A.memoFlow.moveCore({kind:'task',id:'once-ideal',day:'2026-11-06',list:'ideal'},'2026-11-06','ideal','queue')))throw Error('move transaction failed');
   A.memoWorkspace.render();
  });
  const moved=await page.evaluate(()=>{
   const rows=App.memoGantt.nodes().filter(x=>x.key==='once:once-ideal');return rows.map(x=>({kind:x.ref.kind,dependencies:x.task.memoGanttDependencies}));
  });
  assert.equal(moved.length,1,'task->queue keeps exactly one Gantt node');
  assert.equal(moved[0].kind,'queue');
  assert.deepEqual(moved[0].dependencies,['p-math'],'dependencies move with original task identity');
  await page.locator('.gantt-settings > summary').click();
  await page.locator('[data-gantt-manage]').click();
  await page.locator('[data-group-add]').last().click();
  await page.locator('#family-name').fill('新分组');
  await page.locator('[data-act="save"]').last().click();
  assert(await page.evaluate(()=>App.store.data().memoTaskGroups.some(g=>g.name==='新分组')),'new category saved');
  if(!await page.locator('.gantt-settings').evaluate(x=>x.open))await page.locator('.gantt-settings > summary').click();
  await page.locator('[data-gantt-manage]').click();
  await page.locator('[data-group-manage="g-math"]').click();
  await page.locator('#family-target').selectOption('g-life');
  await page.locator('[data-act="remove"]').click();
  await page.locator('[data-act="ok"]').last().click();
  await page.waitForFunction(()=>!App.store.data().memoTaskGroups.some(g=>g.id==='g-math'));
  const groupState=await page.evaluate(()=>{
   const d=App.store.data();
   return {ideal:(d.queue||[]).find(t=>t.id==='once-ideal')?.memoGroup,project:d.memoProjects.find(t=>t.id==='p-math')?.memoGroup};
  });
  assert.equal(groupState.ideal,'g-life','one-off reassigned when deleting category');
  assert.equal(groupState.project,'g-life','recurring project reassigned when deleting category');
  const imported=await page.evaluate(()=>{
   const A=App,d=A.store.data();
   d.memoProjects.find(p=>p.id==='p-math').memoGanttDependencies=['once:once-queue'];
   const exported=A.memoTransfer.exportData(['queue','projects']);
   d.queue=[];d.memoProjects=[];
   const preview=A.memoTransfer.preview(A.memoTransfer.parse(JSON.stringify(exported)),['queue','projects']);
   A.memoTransfer.applyCore(preview);
   const project=d.memoProjects.find(p=>p.text==='高数强化');
   const once=d.queue.find(q=>q.text==='待安排的原始任务');
   return {created:preview.create,dep:project?.memoGanttDependencies?.[0],key:once?'once:'+once.id:null,group:project?.memoGroup};
  });
  assert(imported.created>=4,'mixed module imports created plans');
  assert.equal(imported.dep,imported.key,'cross-type dependency remaps to imported queue ID');
  assert.equal(imported.group,'g-life','project category still restored');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=1,'no page-level horizontal overflow: '+overflow);
  assert.deepEqual(errors,[],'page errors');
  console.log('175.1 one-offs, mixed dependencies, date range, Gantt markers, waiting tasks and groups passed');
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
