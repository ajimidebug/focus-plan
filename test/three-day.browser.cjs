'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/html');res.end(body);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-16T12:00:00+08:00'));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');await page.waitForFunction(()=>window.App?.app?.ready);
  assert.equal(await page.locator('.framework-overview .cal-col').count(),3);
  assert.equal(await page.locator('.framework-overview [data-overview-list=extra]').count(),0);
  await page.getByRole('button',{name:'添加轮次任务',exact:true}).click();
  assert(await page.locator('.mw-task-editor #mw-title').isVisible(),'three-day creation uses the shared editor');
  await page.locator('#mw-title').fill('三天内复盘数学错题');await page.locator('#mw-note-edit').fill('保留自定义备注');await page.locator('#mw-points').fill('7');
  await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.locator('.three-day-column .overview-task-frame .overview-task').count(),1,'same task card component');
  await page.evaluate(()=>App.memoThree.editor({kind:'three',id:App.memoThree.state().tasks[0].id,list:'three'}));
  assert.equal(await page.locator('.mw-task-editor #mw-note-edit').inputValue(),'保留自定义备注');
  await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoThree.state().tasks.length),1,'shared editing preserves task identity');
  assert(await page.evaluate(()=>{const ideal=document.querySelector('[data-overview-list=ideal] .cal-col-head'),three=document.querySelector('[data-overview-list=three] .cal-col-head');return getComputedStyle(ideal).padding===getComputedStyle(three).padding&&getComputedStyle(three).backgroundColor!=='rgba(0, 0, 0, 0)';}),'shared header styling');
  await page.locator('.three-round-position').click();assert.equal(await page.locator('.modal').count(),0,'day indicator remains noninteractive');
  await page.getByRole('button',{name:'打开任务：三天内复盘数学错题，7分',exact:true}).click();
  await page.locator('.task-action-modal .ma-enqueue').click();await page.locator('.modal [data-act=cancel]').click();await page.locator('.modal').waitFor({state:'detached'});
  await page.evaluate(async()=>{
   const A=App,d=A.store.data(),day=A.memoCore.userDay();A.store.getDay(day).tasks.ideal.push({id:'order-b',text:'其他任务B'},{id:'order-c',text:'其他任务C'});
   await A.memoWorkspace.execAdd({kind:'task',id:'order-b',day,list:'ideal'});await A.memoWorkspace.execAdd({kind:'task',id:'order-c',day,list:'ideal'});
  });
  const moveFirst=async id=>{
   await page.locator('.mw-exec-item').filter({hasText:id}).locator('[data-mw=exec-menu]').click();
   await page.getByRole('button',{name:'移到最上方',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
  };
  await moveFirst('其他任务B');await moveFirst('其他任务C');
  assert.deepEqual(await page.locator('.mw-exec-info strong').allTextContents(),['1. 其他任务C','2. 其他任务B','3. 三天内复盘数学错题']);
  assert.equal(await page.evaluate(()=>App.store.data().memoExecutionQueue.some(x=>x.pinned)),false);
  await moveFirst('三天内复盘数学错题');await page.locator('.mw-exec-item').first().locator('[data-schedule-command=start]').click();
  await page.locator('#mw-live [data-float-toggle]').click();
  assert(await page.locator('[data-float-task]').isVisible());await page.locator('[data-float-complete]').click();
  await page.locator('#ma-remark').fill('本次完成备注');await page.locator('.task-action-modal [data-act=cancel]').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoThree.state().tasks[0].done),false);
  await page.locator('#mw-live [data-float-toggle]').click();await page.locator('[data-float-complete]').click();
  await page.locator('#ma-remark').fill('本次完成备注');await page.locator('.task-action-modal [data-act=commit]').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoThree.state().tasks[0].done),true);
  assert.equal(await page.locator('#mw-live').getAttribute('data-status'),'waiting');
  assert.equal(await page.evaluate(()=>App.store.data().ledger.filter(x=>x.type==='earn-three').length),1);
  await page.evaluate(()=>App.memoWorkspace.complete({kind:'three',id:App.memoThree.state().tasks[0].id}));
  await page.getByRole('button',{name:'确认取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoThree.state().tasks[0].note),'保留自定义备注');
  assert.match(await page.evaluate(()=>App.memoCore.read(App.memoCore.userDay()).text),/本次完成备注/);
  await page.getByRole('button',{name:'日历',exact:true}).click();
  await page.getByRole('button',{name:'查看2026-11-19任务',exact:true}).press('Enter');
  await page.getByRole('button',{name:'添加轮次任务',exact:true}).click();
  await page.locator('#mw-title').fill('下轮独立任务');await page.locator('#mw-note-edit').fill('未来任务备注');
  await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoThree.state().tasks.find(t=>t.text==='下轮独立任务').originRound),1);
  assert.match(await page.locator('.three-day-column').innerText(),/下轮独立任务/);
  assert.doesNotMatch(await page.locator('.three-day-column').innerText(),/三天内复盘数学错题/);
  const copied=await page.evaluate(()=>App.memoFlow.copyQuote(App.memoCore.userDay()).text);
  assert.match(copied,/保留自定义备注/);assert.match(copied,/未来任务备注/);assert.match(copied,/预排/);assert.match(copied,/未完成/);
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await page.clock.setFixedTime(new Date('2026-11-19T04:00:00+08:00'));
  await page.evaluate(async()=>{await App.memoActions.commit(()=>{});App.memoWorkspace.returnToday();});
  assert.match(await page.locator('.three-day-column').innerText(),/延期/);
  assert.equal(await page.locator('.three-round-position').innerText(),'第1/3天');
  await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);assert.equal(await page.evaluate(()=>App.memoThree.state().tasks.length),2);
  fs.mkdirSync('test-results',{recursive:true});
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});await page.locator('.framework-overview').screenshot({path:'test-results/175121-three-day-'+width+'.png',animations:'disabled'});}
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'长期拓展',exact:true}).click();
  assert(await page.locator('#mw-details:not([hidden]) #mw-column-extra').isVisible());
  await page.locator('.more-sheet').waitFor({state:'hidden'});
  await page.evaluate(()=>App.app.switchView('timeline'));
  assert.equal(await page.locator('#schedule-range').inputValue(),'24');
  const controls=await page.evaluate(()=>({chart:document.querySelector('.schedule-chart').getBoundingClientRect().bottom,controls:document.querySelector('.schedule-display-controls').getBoundingClientRect().top}));
  assert(controls.controls>=controls.chart);
  await page.locator('#schedule-range').selectOption('4');await page.evaluate(()=>App.memoSchedule.tick());assert.equal(await page.locator('#schedule-range').inputValue(),'4');
  await page.evaluate(()=>{App.app.switchView('tasks');App.app.switchView('timeline');});assert.equal(await page.locator('#schedule-range').inputValue(),'24');
  for(const width of [320,390,430,1280]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>App.memoSchedule.render());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
   assert((await page.locator('.schedule-axis').boundingBox()).height<700);
   assert(await page.evaluate(()=>document.querySelector('.schedule-chart').getBoundingClientRect().bottom<=document.querySelector('.app-bottom-nav').getBoundingClientRect().top+2),'full day fits above navigation at '+width);
   await page.locator('.schedule-chart').screenshot({path:'test-results/17512-timeline-'+width+'.png',animations:'disabled'});
  }
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/17512-timeline.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);console.log('Three-day plan, queue move, floating completion, rollover and full-day timeline passed');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

