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
  await page.getByRole('button',{name:'开始三天计划',exact:true}).click();
  await page.locator('#three-anchor').fill('2026-11-16');await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
  await page.getByRole('button',{name:'添加三天任务',exact:true}).click();
  await page.locator('#three-title').fill('三天内复盘数学错题');await page.locator('#three-note').fill('保留自定义备注');await page.locator('#three-points').fill('7');
  await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
  await page.getByRole('button',{name:'打开三天任务：三天内复盘数学错题',exact:true}).click();
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
  await page.clock.setFixedTime(new Date('2026-11-19T04:00:00+08:00'));
  await page.evaluate(async()=>{await App.memoActions.commit(()=>{});App.memoWorkspace.returnToday();});
  assert.match(await page.locator('.three-day-column').innerText(),/延期/);
  assert.equal(await page.locator('.three-day-strip [aria-current=date]').innerText(),'第1天\n11/19');
  await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);assert.equal(await page.evaluate(()=>App.memoThree.state().tasks.length),1);
  await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'长期拓展',exact:true}).click();
  assert(await page.locator('#mw-details:not([hidden]) #mw-column-extra').isVisible());
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
  }
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/17512-timeline.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Three-day plan, queue move, floating completion, rollover and full-day timeline passed');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
