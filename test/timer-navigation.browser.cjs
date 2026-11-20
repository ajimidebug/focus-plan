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
  await page.clock.install({time:new Date('2026-11-13T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');
  await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt?.nodes&&window.App?.memoOrganize?.openGroups);

  const day='2026-11-13';
  await page.evaluate(async()=>{
    const A=App,d=A.store.data(),day='2026-11-13';
    A.store.getDay(day).tasks.ideal=[{id:'nav-a',text:'第一项',points:1},{id:'nav-b',text:'下一项等待开始',points:1},{id:'nav-c',text:'第三项',points:1}];
    d.memoExecutionQueue=['nav-a','nav-b','nav-c'].map(id=>({ref:{kind:'task',id,day,list:'ideal'}}));
    A.memoWorkspace.selectQueueCore(d.memoExecutionQueue[0].ref);await A.store.save();A.memoWorkspace.render();
  });
  await page.locator('.mw-exec-item').first().locator('[data-schedule-command=start]').click();
  await page.waitForFunction(()=>App.memoSchedule.state().sessions.some(s=>s.status==='running'));
  await page.locator('#mw-live [data-float-toggle]').click();
  await page.locator('.float-management-modal [data-schedule-command=end]').click();
  await page.getByRole('button',{name:'确认结束',exact:true}).click();
  await page.waitForFunction(()=>App.memoSchedule.state().sessions.every(s=>s.status==='ended'));
  const endedTime=await page.evaluate(()=>App.memoSchedule.timing({kind:'task',id:'nav-a',day:'2026-11-13',list:'ideal'}).allMs);
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(()=>App.memoSchedule.timing({kind:'task',id:'nav-a',day:'2026-11-13',list:'ideal'}).allMs),endedTime);
  assert.equal(await page.evaluate(()=>App.store.data().days['2026-11-13'].tasks.ideal[0].done||false),false);
  await page.locator('#mw-live.float-empty').waitFor({state:'attached'});
  await page.reload();await page.waitForFunction(()=>App?.app?.ready&&document.querySelector('#mw-live')?.classList.contains('float-empty'));
  await page.locator('.mw-exec-item').first().locator('[data-schedule-command=start]').click();
  await page.waitForFunction(()=>App.memoSchedule.state().sessions.some(s=>s.status==='running'));
  const original=await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.status==='running').id);
  await page.clock.runFor(1000);
  await page.locator('#mw-live [data-float-toggle]').click();
  await page.locator('.float-management-modal').waitFor({state:'visible'});
  await page.locator('.float-management-modal [data-schedule-command=pause]').click();
  await page.waitForFunction(()=>!document.querySelector('.modal')&&document.querySelector('#mw-live')?.dataset.status==='paused');
  await page.locator('#mw-live-controls [data-schedule-command=start]').click();
  await page.waitForFunction(()=>document.querySelector('#mw-live')?.dataset.status==='running');
  await page.locator('#mw-live [data-float-mode=full]').click();
  assert.equal(await page.locator('#mw-live.float-fullscreen').count(),1);
  assert(await page.locator('#mw-live .float-meter-track').isVisible());
  const full=await page.locator('#mw-live').boundingBox();assert(full.y>=0&&full.height<=844);
  await page.locator('#mw-live [data-float-mode=edge]').click();
  assert(await page.locator('.float-edge-toggle').isVisible());assert(await page.locator('#mw-live .float-summary').isHidden());
  await page.locator('.float-edge-toggle').click();
  assert.equal(await page.locator('#mw-live.float-collapsed').count(),1);
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.status==='running').id),original);
  await page.locator('.mw-exec-item').first().locator('[data-mw=exec-complete]').click();
  await page.locator('.task-action-modal [data-act=commit]').click();
  await page.waitForFunction(()=>!document.querySelector('.modal')&&document.querySelector('#mw-live')?.dataset.status==='waiting');
  const waiting=await page.locator('#mw-live .float-current').innerText();
  await page.clock.runFor(20000);assert.equal(await page.locator('#mw-live .float-current').innerText(),waiting);
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.filter(s=>s.ref.id==='nav-b').length),0);
  await page.reload();await page.waitForFunction(()=>App?.app?.ready&&document.querySelector('#mw-live')?.dataset.status==='waiting');
  assert.match(await page.locator('#mw-live').innerText(),/待开始/);
  await page.locator('#mw-live-controls [data-schedule-command=start]').click();
  await page.waitForFunction(()=>document.querySelector('#mw-live')?.dataset.status==='running');
  await page.evaluate(()=>{App.app.switchView('tasks');App.memoWorkspace.setDay('2026-11-13');});
  await page.locator('[data-mw=exec-clear]').click();await page.locator('.modal [data-act=ok]').click();
  await page.waitForFunction(()=>!App.memoActions.busy()&&App.store.data().memoExecutionQueue.length===0);
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.ref.id==='nav-b').status),'ended');
  assert.equal(await page.evaluate(()=>App.store.data().days['2026-11-13'].tasks.ideal.find(t=>t.id==='nav-b').done||false),false);
  await page.reload();await page.waitForFunction(()=>App?.app?.ready);assert.equal(await page.evaluate(()=>App.store.data().memoExecutionQueue.length),0);
  await page.evaluate(()=>App.app.switchView('memo'));
  for(const [width,height] of [[320,640],[390,844],[550,350]]){
    await page.setViewportSize({width,height});
    const before=await page.locator('.memo-toolbar').boundingBox();
    await page.locator('#memo-copy-menu>summary').click();await page.locator('.memo-popup-layer').waitFor({state:'visible'});
    const after=await page.locator('.memo-toolbar').boundingBox();assert(Math.abs(before.height-after.height)<1);
    const popup=await page.locator('.memo-popup-layer .memo-copy-options').boundingBox();
    assert(popup.x>=0&&popup.y>=0&&popup.x+popup.width<=width+1&&popup.y+popup.height<=height+1);
    await page.keyboard.press('Escape');await page.locator('.memo-popup-layer').waitFor({state:'hidden'});
  }
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log('Queue waiting, clear, mini/full/edge timer and clamped popup passed');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

