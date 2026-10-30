/* Synthetic data only: whole-document bounds, always-visible navigation,
 * cumulative session colors and compact completion dialogs. */
'use strict';
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 for(const width of [320,360,390,430,1280]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-30T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
  await page.evaluate(async()=>{
   const S=App.store,M=App.memoCore,P=App.memoSchedule,day=M.userDay(),old=M.shiftDay(day,-1),d=S.data();
   d.queue=[{id:'prior-current',text:'此前20分钟，本次5分钟，未设置预计时长'}];
   S.getDay(old).tasks.ideal=[{id:'deferred-color',text:'保留原日期的延期任务'}];App.memoFlow.moveCore({kind:'task',id:'deferred-color',day:old,list:'ideal'},day,'ideal');
   S.getDay(day).tasks.ideal.push({id:'normal-color',text:'普通任务'+('长标题'.repeat(30)),points:1234567},{id:'done-color',text:'已完成',points:1,done:true});
   const ref={kind:'queue',id:'prior-current'},now=Date.now(),first=P.startRef(ref,now-60*60000);P.stopRef(ref,now-40*60000);const second=P.startRef(ref,now-5*60000);P.pauseCore(second,now);
   await S.save();App.app.switchView('tasks');App.memoWorkspace.enter('today',day);P.tick();
  });
  for(const theme of ['default','dark']){
   await page.evaluate(t=>document.body.dataset.theme=t,theme);
   const q=await page.locator('#float-meter .float-meter-track').evaluate(e=>({total:+e.dataset.totalMs,previous:+e.dataset.previousMs,current:+e.dataset.currentMs}));
   check(q.total===25*60000&&q.previous===20*60000&&q.current===5*60000,'unestimated cumulative scope '+width+' '+theme);
   const colors=await page.locator('#float-meter .float-meter-track').evaluate(e=>{const p=e.querySelector('.float-meter-previous'),c=e.querySelector('.float-meter-fill');return {p:parseFloat(p.style.width),c:parseFloat(c.style.width),left:parseFloat(c.style.left),a:getComputedStyle(p).backgroundColor,b:getComputedStyle(c).backgroundImage};});
   check(Math.abs(colors.p-100/3)<.01&&Math.abs(colors.c-100/12)<.01&&colors.left===colors.p,'two proportional nonoverlapping session colors '+width+' '+theme);
   check(colors.b.includes('linear-gradient')&&colors.a!=='rgba(0, 0, 0, 0)','both colors drawn '+width+' '+theme);
   check((await page.locator('#mw-live .float-current').innerText()).includes('0:25:00'),'collapsed headline is cumulative '+width);
   const bar=page.locator('#mw-today .mw-overview [data-overview-list="ideal"] .mw-column-meter');
   check((await bar.getAttribute('aria-label')).startsWith('理想任务：1/3，未完成延期1项；'),'deferred count excludes completed target '+width);
   check(await bar.locator('.mw-column-deferred').evaluate(e=>parseFloat(e.style.width)>33),'deferred segment drawn '+width);
   const bounds=await page.evaluate(()=>({root:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,body:document.body.scrollWidth,bodyWidth:document.body.clientWidth}));
   check(bounds.root<=bounds.width+1&&bounds.body<=bounds.bodyWidth+1,'whole document and body bounded '+width+' '+theme);
  }
  if(width<700){
   const anchor=await page.locator('#mobile-nav').boundingBox();
   for(const top of [200,100000,0]){await page.evaluate(top=>window.scrollTo({left:999,top,behavior:'instant'}),top);await page.clock.runFor(50);const nav=await page.locator('#mobile-nav').boundingBox();check(nav&&Math.abs(nav.x)<1&&Math.abs(nav.width-width)<1&&Math.abs(nav.y-anchor.y)<1,'nav stays full-width and visible on scroll '+width+' '+top);check(await page.evaluate(()=>window.scrollX)===0,'no whole-page horizontal pan '+width);check(await page.locator('#app-header').evaluate(e=>getComputedStyle(e).position==='static'),'task header preserves existing scroll behavior '+width);}
   const probe=await page.evaluate(()=>{const e=document.createElement('div');e.style.cssText='width:1800px;height:1px';document.querySelector('main').append(e);window.scrollTo({left:999,top:window.scrollY,behavior:'instant'});const result={x:window.scrollX,root:document.documentElement.scrollWidth,width:document.documentElement.clientWidth};e.remove();return result;});check(probe.x===0&&probe.root<=probe.width+1,'oversized child cannot move root or navigation '+width);
   await page.setViewportSize({width,height:400});await page.clock.runFor(100);check(await page.locator('#mobile-nav').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),'nav visible after viewport shrinks '+width);await page.setViewportSize({width,height:844});
  }
  await page.evaluate(()=>App.memoWorkspace.complete({kind:'task',id:'normal-color',day:App.memoCore.userDay(),list:'ideal'}));
  check(await page.locator('#ma-timer-state,.task-action-modal .float-meter-track,.task-action-modal .ma-meter').count()===0,'no dialog meter or summary '+width);
  check(await page.locator('.task-action-modal').evaluate(e=>e.getBoundingClientRect().width<=400),'compact modal width '+width);
  await page.locator('#ma-remark').fill('保留草稿');await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('暂停计时')&&!document.querySelector('#ma-timer').disabled);
  check(await page.locator('#ma-remark').inputValue()==='保留草稿','start preserves remark '+width);
  check(await page.locator('#ma-timer').evaluate(e=>{const r=e.getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight;}),'primary timer remains reachable '+width);
  await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('继续计时'));
  await page.evaluate(async()=>{App.ui.closeModal();App.memoSchedule.stopRef({kind:'task',id:'normal-color',day:App.memoCore.userDay(),list:'ideal'});const ref={kind:'queue',id:'prior-current'},t=App.memoSchedule.find(ref);t.estimatedMinutes=24;await App.store.save();App.memoSchedule.tick();});
  check(await page.locator('#mw-live').getAttribute('data-meter-state')==='overtime','already accumulated time triggers overtime immediately '+width);
  check(await page.locator('.float-expected-mark').evaluate(e=>!e.hidden&&parseFloat(e.style.left)===50),'expected landmark retained after extension '+width);
  check(await page.locator('#float-meter .float-meter-track').evaluate(e=>+e.dataset.totalMs===25*60000),'overtime keeps cumulative total '+width);
  await page.reload();await page.waitForFunction(()=>App?.app?.ready);await page.evaluate(()=>App.memoSchedule.tick());
  check(await page.locator('#float-meter .float-meter-track').evaluate(e=>+e.dataset.previousMs===20*60000&&+e.dataset.currentMs===5*60000),'session colors survive reload '+width);
  if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1739-'+width+'.png'),animations:'disabled'});}
  check(errors.length===0,'no runtime exceptions '+width+': '+errors.join(';'));await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}console.log(checks+' 173.9 browser checks passed.');})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
