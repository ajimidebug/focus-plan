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
  await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt?.nodes&&window.App?.memoOrganize?.openGroups);
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
  // 175.8: search is read-only and resolves to the one current task instance.
  const searchBefore=await page.evaluate(()=>JSON.stringify({days:App.store.data().days,queue:App.store.data().queue,ledger:App.store.data().ledger}));
  await page.locator('.mw-exec-head [data-mw="search"]').click();
  await page.locator('#mw-search-text').fill('一次性数学测试');
  assert.equal(await page.locator('#mw-search-results [data-search-id="once-ideal"]').count(),1,'search finds the current dated task once');
  await page.locator('#mw-search-results [data-search-id="once-ideal"]').click();
  assert.equal(await page.locator('#mw-title').inputValue(),'一次性数学测试','search result opens the matching task editor');
  await page.locator('.modal [data-act="cancel"]').click();
  await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>JSON.stringify({days:App.store.data().days,queue:App.store.data().queue,ledger:App.store.data().ledger})),searchBefore,'search and navigation do not mutate tasks or points');


  // 175.6: one-screen overview, shared axis geometry, day/weekday markers and saved display mode.
  assert.equal(await page.locator('[data-gantt-display="detail"]').getAttribute('aria-pressed'),'true','existing users start in detailed mode');
  const ganttRecords=await page.evaluate(()=>JSON.stringify({projects:App.store.data().memoProjects,days:App.store.data().days,ledger:App.store.data().ledger}));
  await page.locator('[data-gantt-display="overview"]').click();
  for(const width of [320,360,390,430]){
   await page.setViewportSize({width,height:844});
   await page.waitForTimeout(100);
   const geometry=await page.evaluate(()=>{
    const root=document.querySelector('.memo-gantt'),scroller=root?.querySelector('.memo-gantt-scroller'),axis=root?.querySelector('.gantt-axis-head'),overlay=root?.querySelector('.gantt-time-overlay'),lane=root?.querySelector('[data-gantt-row="project:p-math"] .memo-gantt-lane'),band=root?.querySelector('.gantt-date-band');
    if(!root||!scroller||!axis||!overlay||!lane||!band)return null;
    const a=axis.getBoundingClientRect(),b=overlay.getBoundingClientRect(),c=lane.getBoundingClientRect();
    const edge=scroller.getBoundingClientRect().right,track=scroller.querySelector('.memo-gantt-track');
    const offenders=[...scroller.querySelectorAll('*')].map(el=>({selector:el.tagName.toLowerCase()+'.'+String(el.className?.baseVal||el.className||'').replace(/\\s+/g,'.').slice(0,55),right:Math.round(el.getBoundingClientRect().right-edge),width:Math.round(el.getBoundingClientRect().width),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth})).filter(el=>el.right>1).sort((a,b)=>b.right-a.right).slice(0,12);
    return {mode:root.dataset.ganttMode,scroll:scroller.scrollWidth-scroller.clientWidth,documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,axisError:Math.max(Math.abs(a.left-b.left),Math.abs(c.left-b.left),Math.abs(a.width-b.width),Math.abs(c.width-b.width)),bands:root.querySelectorAll('.gantt-date-band').length,ticks:root.querySelectorAll('.gantt-axis-tick').length,scrollerWidth:scroller.clientWidth,trackWidth:track?.clientWidth,trackScroll:track?.scrollWidth,offenders};
   });
   assert(geometry&&geometry.mode==='overview'&&geometry.scroll<=2&&geometry.documentOverflow<=2&&geometry.axisError<=2&&geometry.bands>1&&geometry.ticks>=2,'overview fits and lines up at '+width+': '+JSON.stringify(geometry));
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>App.memoWorkspace.render());
  assert.equal(await page.locator('[data-gantt-display="overview"]').getAttribute('aria-pressed'),'true','overview preference survives workspace re-render');
  assert.equal(await page.evaluate(()=>localStorage.getItem('gantt-175:display-mode')),'overview','overview stored locally');
  assert.equal(await page.evaluate(()=>JSON.stringify({projects:App.store.data().memoProjects,days:App.store.data().days,ledger:App.store.data().ledger})),ganttRecords,'switching display mode does not modify task or ledger data');
  await page.locator('[data-gantt-display="detail"]').click();
  const detailScroll=await page.locator('.memo-gantt-scroller').evaluate(x=>({scroll:x.scrollWidth,client:x.clientWidth}));
  assert(detailScroll.scroll>detailScroll.client+50,'detailed mode retains independent horizontal scrolling');
  assert.equal(await page.locator('[data-gantt-display="detail"]').getAttribute('aria-pressed'),'true','detailed mode selected');
  assert.equal(await page.locator('.memo-gantt[data-gantt-root]').evaluate(x=>x.open),true,'Gantt initially open');
  assert.equal(await page.locator('.gantt-group[data-gantt-group=""]').evaluate(x=>x.open),false,'ungrouped collapsed by default');
  assert.equal(await page.locator('.gantt-today-line').count(),1,'today marker visible');
  assert.equal(await page.locator('.gantt-past').count(),1,'past region visible');
  assert.equal(await page.locator('.gantt-deadline-line').count(),1,'global deadline shown');
  assert.equal(await page.locator('.mw-inline-waiting').count(),1,'waiting tasks under Gantt');
  assert.equal(await page.locator('.mw-inline-waiting').getByText('待安排的原始任务').count(),1);
  const order=await page.evaluate(()=>{const a=document.querySelector('.memo-gantt'),b=document.querySelector('.mw-inline-waiting');return !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)});
  assert(order,'waiting area follows Gantt');

  const order1753=await page.evaluate(()=>{
    const a=document.querySelector('.mw-exec-board'),b=document.querySelector('.memo-gantt'),c=document.querySelector('.framework-overview');
    return !!(a&&b&&c&&(a.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING)&&(c.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert(order1753,'execution queue comes before task columns and Gantt');
  assert.equal(await page.locator('.gantt-deadline-badge').count(),1,'global deadline initial rendered');
  assert.equal(await page.locator('.gantt-deadline-badge').first().textContent(),'考','global deadline first character');
  assert.equal(await page.locator('.overview-exec-add').count(),0,'three-column cards have no permanent queue button');
  const beforeExec=await page.evaluate(()=>{
    const d=App.store.data();return {ledger:d.ledger.length,events:(d.memoEvents||[]).length,queue:d.queue.length};
  });
  await page.evaluate(async()=>{
    await App.memoWorkspace.execAdd({kind:'task',id:'once-ungrouped',day:'2026-11-06',list:'required'});
  });
  const afterAdd=await page.evaluate(()=>{
    const d=App.store.data();
    return {rows:d.memoExecutionQueue,stillInThreeCols:!!d.days['2026-11-06'].tasks.required.find(t=>t.id==='once-ungrouped'),queue:d.queue.length};
  });
  assert.equal(afterAdd.rows.length,1,'reference queue has one entry');
  assert(afterAdd.stillInThreeCols,'adding to execution queue keeps authoritative task');
  assert.equal(afterAdd.queue,beforeExec.queue,'adding does not create old queue task');
  assert.equal(await page.locator('.mw-exec-item').count(),1,'execution queue card appears');
  await page.locator('.mw-exec-item [data-mw="exec-skip"]').click();
  const afterSkip=await page.evaluate(()=>{
    const d=App.store.data();return {length:(d.memoExecutionQueue||[]).length,task:!!d.days['2026-11-06'].tasks.required.find(t=>t.id==='once-ungrouped'),ledger:d.ledger.length,events:(d.memoEvents||[]).length};
  });
  assert.equal(afterSkip.length,0,'skip removes reference');
  assert(afterSkip.task,'skip preserves original task');
  assert.equal(afterSkip.ledger,beforeExec.ledger,'skip creates no ledger entry');
  assert.equal(afterSkip.events,beforeExec.events,'skip creates no completion event');

  // 175.9: user-started execution queue advances only after a real confirmation.
  const entries1759=await page.evaluate(async()=>{
    const day='2026-11-06';
    const first=await App.memoWorkspace.execAdd({kind:'task',id:'once-ungrouped',day,list:'required'});
    const second=await App.memoWorkspace.execAdd({kind:'task',id:'once-ideal',day,list:'ideal'});
    return {first,second,refs:(App.store.data().memoExecutionQueue||[]).map(x=>x.ref),
      ideal:App.memoSchedule.resolve({kind:'task',id:'once-ideal',day,list:'ideal'})?.task?.done,
      required:App.memoSchedule.resolve({kind:'task',id:'once-ungrouped',day,list:'required'})?.task?.done,
      busy:App.memoActions.busy()};
  });
  assert.equal(await page.locator('.mw-exec-item [data-mw="exec-complete"]').count(),2,'queue has direct completed controls: '+JSON.stringify(entries1759));
  assert.equal(await page.locator('.mw-exec-item [data-schedule-command="pause"]').count(),0,'queue has no pause control');
  await page.locator('.mw-exec-item').first().locator('[data-schedule-command="start"]').click();
  await page.waitForFunction(()=>App.memoSchedule.state().sessions.some(x=>x.ref.id==='once-ungrouped'&&x.status==='running'));
  assert.match(await page.locator('.mw-exec-board h2').innerText(),/连续计时中/,'queue entered sequential mode');
  await page.locator('.mw-exec-item').first().locator('[data-mw="exec-complete"]').click();
  assert.equal(await page.locator('.task-action-modal [data-act="commit"]').count(),1,'queue complete reuses confirmation modal');
  await page.locator('.task-action-modal [data-act="cancel"]').click();
  await page.locator('.task-action-modal').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.ref.id==='once-ungrouped')?.status),'running','cancel preserves current timer');
  assert.equal(await page.evaluate(()=>!!App.store.data().days['2026-11-06'].tasks.required.find(t=>t.id==='once-ungrouped')?.done),false,'cancel does not mark task complete');
  await page.locator('.mw-exec-item').first().locator('[data-mw="exec-complete"]').click();
  await page.locator('.task-action-modal [data-act="commit"]').click();
  await page.waitForFunction(()=>App.memoSchedule.state().sessions.some(s=>s.ref.id==='once-ideal'&&s.status==='running'));
  const nextInfo=await page.evaluate(()=>{
    const d=App.store.data(),sessions=App.memoSchedule.state().sessions;
    return {old:sessions.filter(x=>x.ref.id==='once-ungrouped').map(x=>x.status),next:sessions.filter(x=>x.ref.id==='once-ideal').map(x=>x.status),events:(d.memoEvents||[]).filter(x=>x.sourceId==='once-ungrouped'&&x.active).length,remaining:d.memoExecutionQueue.length,done:!!d.days['2026-11-06'].tasks.required.find(t=>t.id==='once-ungrouped').done};
  });
  assert(nextInfo.done&&nextInfo.events===1&&nextInfo.remaining===1&&nextInfo.old.every(x=>x==='ended')&&nextInfo.next.includes('running'),'confirmed completion closes exactly one item and starts the next: '+JSON.stringify(nextInfo));
  await page.locator('.mw-exec-item [data-mw="exec-skip"]').click();
  await page.waitForFunction(()=>App.store.data().memoExecutionQueue.length===0);
  const afterChainSkip=await page.evaluate(()=>({
    status:App.memoSchedule.state().sessions.find(x=>x.ref.id==='once-ideal')?.status,
    done:!!App.store.data().days['2026-11-06'].tasks.ideal.find(x=>x.id==='once-ideal').done,
    event:(App.store.data().memoEvents||[]).filter(x=>x.sourceId==='once-ideal'&&x.active).length
  }));
  assert.deepEqual(afterChainSkip,{status:'ended',done:false,event:0},'skip ends current timer without completing original task');
  // Search a recurring series as a single result while preserving old occurrence data.
  await page.evaluate(()=>{
    const d=App.store.data(),day='2026-11-06',id='cycle-demo:2026-11-06';
    d.memoRecurrence={version:1,series:[{id:'cycle-demo',enabledDay:day,revisions:[{from:day,rule:{kind:'days',every:2,anchor:day},text:'重复环境背诵',note:'',list:'ideal',points:1,estimatedMinutes:20}]}],
      occurrences:[{id,seriesId:'cycle-demo',day,status:'pending',taskRef:{kind:'task',id:'period:'+id,day,list:'ideal'}}]};
    d.days[day].tasks.ideal.push({id:'period:'+id,text:'重复环境背诵',note:'旧备注',memoOccurrenceId:id,done:false});
    App.memoWorkspace.render();
  });
  await page.locator('.mw-exec-head [data-mw="search"]').click();
  await page.locator('#mw-search-text').fill('重复环境背诵');
  assert.equal(await page.locator('#mw-search-results [data-search-type="cycle"]').count(),1,'one recurrence series row');
  assert.equal(await page.locator('#mw-search-results [data-search-type="task"]').count(),0,'occurrence is not independently shown');
  assert.match(await page.locator('#mw-search-results').innerText(),/每隔2天/,'actual cycle rule visible');
  await page.locator('#mw-search-results [data-search-type="cycle"]').click();
  assert.match(await page.locator('.modal').innerText(),/已有待做期次/,'search opens series manager');
  await page.locator('.modal [data-act="close"]').click();
  await page.evaluate(()=>{const d=App.store.data();d.memoRecurrence={version:1,series:[],occurrences:[]};d.days['2026-11-06'].tasks.ideal=d.days['2026-11-06'].tasks.ideal.filter(x=>!x.memoOccurrenceId);App.memoWorkspace.render();});

  // 175.4: habit in three-column plans becomes one execution, not a copied task.
  await page.evaluate(()=>{
    const A=App,d=A.store.data(),day='2026-11-06';
    d.checkins.push({id:'habit-1754',text:'重置习惯',points:1,target:1,rewardLimit:99,days:{}});
    (d.memoHabitPlans||(d.memoHabitPlans=[])).push({id:'hp-1754',habitId:'habit-1754',mode:'daily',from:day,list:'ideal',target:1});
    A.memoWorkspace.render();
  });
  // Regression: opening a planned habit must initialize both modal actions.
  const habitRow=page.locator('.framework-overview .overview-habit').filter({hasText:'重置习惯'});
  await habitRow.click();
  assert.equal(await page.locator('.task-action-modal [data-act="commit"]').count(),1,'planned habit confirmation opens');
  await page.locator('.task-action-modal [data-act="cancel"]').click();
  await page.locator('.task-action-modal').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>Number(App.store.data().checkins.find(x=>x.id==='habit-1754').days['2026-11-06']||0)),0,'cancelling a habit confirmation leaves count unchanged');
  await page.locator('[data-mw="exec-pick"]').first().click();
  assert.equal(await page.locator('.mw-exec-picker-column').count(),3,'picker contains compact three columns');
  assert.equal(await page.locator('.mw-exec-candidate').filter({hasText:'重置习惯'}).count(),1,'planned habits are selectable');
  await page.locator('.mw-exec-candidate').filter({hasText:'重置习惯'}).locator('input').check();
  assert.match(await page.locator('#mw-exec-selected').textContent(),/1 项/);
  await page.locator('[data-act="save"]').last().click();
  await page.waitForFunction(()=>!App.memoActions.busy());
  const beforeHabit=await page.evaluate(()=>{
    const d=App.store.data(),e=d.memoExecutionQueue.find(x=>x.ref.kind==='checkin');
    return {count:e?.habitCount,day:e?.ref.day,ledger:d.ledger.length};
  });
  assert.equal(beforeHabit.count,0,'habit count snapshot starts from zero');
  assert.equal(beforeHabit.day,'2026-11-06','habit queue item has user-day');
  // Real confirmation, not a simulated count increment, must succeed and prune the queue.
  await habitRow.click();
  await page.locator('.task-action-modal [data-act="commit"]').click();
  await page.waitForFunction(()=>!App.memoActions.busy());
  await page.locator('.task-action-modal').waitFor({state:'hidden'});
  const afterHabit=await page.evaluate(()=>{
    const d=App.store.data(),it=d.checkins.find(x=>x.id==='habit-1754');
    return {count:Number(it.days['2026-11-06']||0),events:(d.memoEvents||[]).filter(x=>x.kind==='checkin'&&x.sourceId===it.id&&x.active).length};
  });
  assert.equal(afterHabit.count,1,'planned habit actually checks in');
  assert.equal(afterHabit.events,1,'habit checkin writes an event');
  assert.equal(await page.locator('.mw-exec-item').count(),0,'habit checkin removes only this execution');
  // Reuse normal queue task to verify the actions dialog stays inside the viewport.
  await page.evaluate(()=>App.memoWorkspace.execAdd({kind:'task',id:'once-ungrouped',day:'2026-11-06',list:'required'}));
  await page.locator('.mw-exec-item [data-mw="exec-menu"]').click();
  assert.equal(await page.locator('[data-exec-action="pin"]').count(),1,'queue actions use a modal rather than an overflow popup');
  const menuRect=await page.locator('.mw-exec-menu-list').boundingBox();
  assert(menuRect&&menuRect.x>=0&&menuRect.x+menuRect.width<=392,'menu stays inside the viewport');
  await page.locator('[data-act="close"]').last().click();
  await page.locator('.mw-exec-item [data-mw="exec-skip"]').click();
  await page.waitForFunction(()=>!App.memoActions.busy());
  await page.waitForFunction(()=>!App.memoActions.busy());
  await page.evaluate(()=>App.ms.openList());
  await page.locator('[data-act="pin"][data-id="ddl-1"]').click();
  await page.waitForFunction(()=>!App.memoActions.busy());
  assert.equal(await page.evaluate(()=>App.store.data().milestones[0].pinned),true,'global deadline pins without changing due date');
  await page.locator('#mw-deadlines .is-pinned').waitFor({state:'visible',timeout:5000});
  assert.equal(await page.locator('#mw-deadlines .is-pinned').count(),1,'pinned deadline appears above three columns');
  await page.locator('[data-act="close"]').last().click();
  await page.evaluate(()=>App.memoWorkspace.assignmentEditor({kind:'task',id:'once-ungrouped',day:'2026-11-06',list:'required'}));
  assert.equal(await page.locator('.mw-assign-week [data-ma-pick-day]').count(),7,'weekly assignment is directly visible');
  await page.locator('[data-ma-pick-day="2026-11-08"]').click();
  assert.equal(await page.locator('#ma-day').inputValue(),'2026-11-08','date shortcut selects day');
  await page.locator('[data-act="cancel"]').last().click();

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

  // 175.5: pinned DDLs are included for visibility and then date-sorted, with
  // three default visible slots and no loss of additional pinned reminders.
  const ddlOrder=await page.evaluate(()=>{
    const A=App,d=A.store.data();
    d.milestones=[
      {id:'far',name:'远期置顶',due:'2026-12-12',pinned:true},
      {id:'soon',name:'临近任务',due:'2026-11-08'},
      {id:'earliest',name:'最早任务',due:'2026-11-07'},
      {id:'fourth',name:'未置顶候选',due:'2026-11-09'}
    ];
    A.ms.refresh();
    return [...document.querySelectorAll('#mw-deadlines .ms-compact-item')].map(x=>x.dataset.msItem);
  });
  assert.deepEqual(ddlOrder,['earliest','soon','far'],'pinned future DDL appears at the right by date');
  const bounty=await page.evaluate(()=>{
    const A=App;A.store.settings().memoBountyThreshold=25;
    return [11,24,25,31].map(p=>({points:p,bounty:A.memoOrganize.bounty(p),tier:A.memoOrganize.bountyTier(p)}));
  });
  assert.deepEqual(bounty.map(x=>x.bounty),[false,false,true,true],'configured >=25 bounty threshold is honored');
  assert.equal(bounty[2].tier,'basic','low tier starts at configured threshold');

  // Save a relative start + linked deadline rule, not literal day boundaries.
  await page.evaluate(()=>App.memoWorkspace.render());
  if(!await page.locator('.gantt-settings').evaluate(x=>x.open))await page.locator('.gantt-settings > summary').click();
  await page.locator('[data-gantt-zoom]').selectOption('custom');
  await page.locator('[data-gantt-custom-end-kind]').selectOption('ddl');
  await page.locator('[data-gantt-custom-ddl]').selectOption('far');
  const readRange=()=>page.evaluate(()=>{
    const m=App.memoGantt.model(),fmt=n=>new Date(n*86400000).toISOString().slice(0,10);
    return {from:fmt(m.from),to:fmt(m.to),error:m.custom?.error||''};
  });
  assert.deepEqual(await readRange(),{from:'2026-11-04',to:'2026-12-12',error:''},'before yesterday to selected DDL');
  assert.equal(await page.locator('[data-gantt-custom-start-kind]').inputValue(),'before2','relative start selected');
  await page.evaluate(()=>App.store.save());
  await page.reload();
  await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt?.model);
  assert.deepEqual(await readRange(),{from:'2026-11-04',to:'2026-12-12',error:''},'custom view survives reload');
  await page.clock.setFixedTime(new Date('2026-11-07T12:00:00+08:00'));
  assert.deepEqual(await readRange(),{from:'2026-11-05',to:'2026-12-12',error:''},'relative start advances on following day');
  await page.evaluate(()=>{App.store.data().milestones.find(x=>x.id==='far').due='2026-12-20';App.memoWorkspace.render();});
  assert.equal((await readRange()).to,'2026-12-20','linked deadline edits update visible end');
  const deleted=await page.evaluate(()=>{
    App.store.data().milestones=App.store.data().milestones.filter(x=>x.id!=='far');
    App.memoWorkspace.render();
    return App.memoGantt.model().custom.error;
  });
  assert.match(deleted,/不存在/,'deleted DDL prompts reselection without dropping saved rule');

  // 175.5: use genuine completion events with long-term work left unfinished.
  const rewardState=await page.evaluate(()=>{
    const A=App,d=A.store.data(),day='2026-11-06',at='2026-11-06T04:00:00.000Z';
    d.days[day].tasks={required:[{id:'req-1755',text:'必须完成',done:false}],ideal:[{id:'ideal-1755',text:'理想完成',done:false}],extra:[{id:'extra-1755',text:'未做的长期拓展',done:false}]};
    d.days[day].rewards=[];d.ledger=[];d.memoEvents=[];d.queue=[];d.queueDone=[];d.memoProjects=[];d.daily=[];d.checkins=[];d.memoHabitPlans=[];
    const task=(id,list)=>({kind:'task',id,day,list,title:id});
    const first=A.memoActions.completeCore(task('req-1755','required'),'',at,[{kind:'perfect',points:20}]);
    const premature=(d.days[day].rewards||[]).filter(r=>r.kind==='perfect').length;
    const second=A.memoActions.completeCore(task('ideal-1755','ideal'),'',at,[{kind:'perfect',points:20}]);
    const earned=d.days[day].rewards.find(r=>r.kind==='perfect');
    const taskReward={premature,earned:!!earned,scope:earned?.scopeVersion,dependencies:earned?.dependencies?.map(x=>x.id),extraPending:!d.days[day].tasks.extra[0].done};
    A.memoActions.undoCore(second.id,'',at);
    const undoTask=d.days[day].rewards.some(r=>r.kind==='perfect');

    d.days[day].tasks.ideal=[];
    d.checkins=[{id:'habit-1755',text:'复习两轮',target:2,rewardLimit:99,points:1,days:{}}];
    d.memoHabitPlans=[{id:'plan-1755',habitId:'habit-1755',mode:'daily',from:day,list:'ideal',target:2}];
    const spec={kind:'checkin',id:'habit-1755',day,title:'复习两轮'};
    A.memoActions.completeCore({...spec},'',at,[{kind:'perfect',points:20}]);
    const earlyHabit=d.days[day].rewards.some(r=>r.kind==='perfect');
    const last=A.memoActions.completeCore({...spec},'',at,[{kind:'perfect',points:20}]);
    const habitAward=d.days[day].rewards.find(r=>r.kind==='perfect');
    const habitGoal=habitAward?.dependencies.find(x=>x.id==='habit:habit-1755')?.goal;
    A.memoActions.undoCore(last.id,'',at);
    const undoneHabit=d.days[day].rewards.some(r=>r.kind==='perfect');
    return {taskReward,undoTask,earlyHabit,habitAward:!!habitAward,habitGoal,undoneHabit};
  });
  assert.equal(rewardState.taskReward.premature,0,'cannot claim perfect before both daily columns are complete');
  assert.equal(rewardState.taskReward.earned,true,'can claim perfect with long-term unfinished');
  assert.equal(rewardState.taskReward.scope,2,'new reward scope version marked for historical compatibility');
  assert(rewardState.taskReward.dependencies.includes('["task","req-1755","2026-11-06"]')&&rewardState.taskReward.dependencies.includes('["task","ideal-1755","2026-11-06"]'),'reward tracks two-column task identities');
  assert(rewardState.taskReward.extraPending&&rewardState.taskReward.dependencies.length===2,'long-term third column excluded');
  assert.equal(rewardState.undoTask,false,'undo task withdraws two-column reward');
  assert.equal(rewardState.earlyHabit,false,'habit below target cannot claim perfect');
  assert.equal(rewardState.habitAward,true,'habit reaching target grants perfect');
  assert.equal(rewardState.habitGoal,2,'habit reward saves goal snapshot');
  assert.equal(rewardState.undoneHabit,false,'undo habit checkin withdraws perfect reward');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=1,'no page-level horizontal overflow: '+overflow);
  assert.deepEqual(errors,[],'page errors');
  console.log('175.1 one-offs, mixed dependencies, date range, Gantt markers, waiting tasks and groups passed');
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
