'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(b);});
});
async function run(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'Asia/Shanghai'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-05T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');
  await page.waitForFunction(()=>App?.app?.ready&&App?.memoSchedule?.startRef);
  await page.evaluate(async()=>{
    const day=App.memoCore.userDay(),d=App.store.data();
    d.queue=[{id:'timer1742',text:'一次计时',points:1},{id:'rename1742',text:'旧名称',points:1},{id:'window1742',text:'下午计划',points:2}];
    d.queueDone=[];d.memoSchedule={version:1,items:[],sessions:[]};d.memoEvents=[];d.ledger=[];
    await App.store.save();App.app.switchView('tasks');App.memoWorkspace.render();
  });
  await page.evaluate(()=>App.memoActions.queue('timer1742'));
  await page.locator('#ma-timer').click();
  await page.locator('.task-action-modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.filter(s=>s.status==='running').length),1,'starting a timer closes completion dialog');
  await page.locator('#mw-live-controls [data-schedule-command="pause"]').click();
  await page.waitForFunction(()=>App.memoSchedule.state().sessions.some(s=>s.status==='paused')&&!App.memoActions.busy());
  await page.evaluate(()=>App.memoActions.queue('timer1742'));
  await page.locator('.task-action-modal').waitFor({state:'visible'});
  assert.match(await page.locator('#ma-timer').innerText(),/继续计时/);
  await page.locator('#ma-timer').click();
  await page.locator('.task-action-modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.filter(s=>s.ref.id==='timer1742').length),1);
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.ref.id==='timer1742').chunks.length),2);
  await page.locator('#mw-live [data-float-toggle]').click();
  await page.locator('#mw-live-controls [data-schedule-command="end"]').click();
  await page.locator('.modal').waitFor({state:'visible'});
  assert.match(await page.locator('.modal').innerText(),/任务仍未完成/);
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions[0].status),'running');
  await page.locator('.modal [data-act="cancel"]').click();
  await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions[0].status),'running');
  await page.locator('#mw-live-controls [data-schedule-command="end"]').click();
  await page.locator('.modal [data-act="end"]').click();
  await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions[0].status),'ended');
  assert.equal(await page.evaluate(()=>App.store.data().memoEvents.length),0,'ending time does not complete a task');
  assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0,'ending time does not change points');
  await page.evaluate(()=>App.memoActions.queue('rename1742'));
  await page.locator('.task-action-modal').waitFor({state:'visible'});
  await page.evaluate(async()=>{App.store.data().queue.find(x=>x.id==='rename1742').text='最后修改的名称';await App.store.save();});
  await page.locator('.modal [data-act="commit"]').click();
  await page.locator('.modal').waitFor({state:'detached'});
  const record=await page.evaluate(()=>{const e=App.store.data().memoEvents.find(x=>x.sourceId==='rename1742');return {title:e?.title,note:App.memoActions.passage(e)};});
  assert.equal(record.title,'最后修改的名称');
  assert(record.note.includes('最后修改的名称'),'auto-generated passage uses the latest title');
  await page.evaluate(async()=>{
    const P=App.memoSchedule,ref={kind:'queue',id:'window1742'},now=Date.now(),start=now-60*60000,end=now+60*60000;
    P.savePlan({ref,title:'下午计划',day:App.memoCore.userDay(),type:'span',start,end});
    P.startRef(ref);await App.store.save();P.tick();
  });
  await page.waitForFunction(()=>document.querySelector('#mw-live')?.dataset.meterState==='window');
  assert.equal(await page.locator('#float-meter .float-range-end').innerText(),'13:00');
  const detail=await page.locator('#float-meter .float-meter-text').innerText();
  const match=detail.match(/距截止 (\\d+):(\\d{2}):(\\d{2})/);
  assert(match,'remaining time appears in deadline progress');
  const seconds=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
  assert(seconds>=3590&&seconds<=3600,'remaining time is within rendering delay of one hour');
  assert.match(await page.locator('#float-meter .float-meter-track').getAttribute('aria-label'),/截止时刻/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  await page.reload();await page.waitForFunction(()=>App?.app?.ready);
  assert.equal(await page.evaluate(()=>App.store.data().memoEvents.find(e=>e.sourceId==='rename1742')?.title),'最后修改的名称');
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('174.2 timer confirmation, resume, title snapshot, deadline window and persistence passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1;});
