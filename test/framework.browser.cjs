'use strict';
// Run against the packaged SPA, never the legacy source template.
const {chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');fs.mkdirSync('test-results',{recursive:true});
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[ext]||'text/html');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const base='http://127.0.0.1:'+server.address().port;try{
for(const width of [320,390,1280]){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));await page.goto(base+'/#/tasks');await page.waitForFunction(()=>window.App?.app?.ready&&document.querySelector('.framework-overview'));
 assert.equal(await page.locator('.bottom-grid button').count(),5);
 const shell=await page.evaluate(()=>({
   stats:[...document.querySelectorAll('.shell-stats #stat-bar .stat-item')].filter(el=>getComputedStyle(el).display!=='none').length,
   restored:['stat-extend','stat-aux'].every(id=>{const el=document.getElementById(id);return !!el&&getComputedStyle(el.closest('.stat-item')).display!=='none';}),
   navFixed:getComputedStyle(document.querySelector('.app-bottom-nav')).position==='fixed',
   hasStandaloneLate:!!document.querySelector('.framework-overview .mw-column-deferred-label'),
   columnDirection:getComputedStyle(document.querySelector('.framework-overview .cal-col-head')).flexDirection
 }));
 assert(shell.stats>=7,'original metrics and any newer indicators remain accessible');
 assert(shell.restored,'formerly hidden extend and auxiliary metrics are visible');
 assert.equal(shell.navFixed,true,'five-item navigation is fixed');
 assert.equal(shell.columnDirection,'column','restore stacked category title and count');
 assert.equal(shell.hasStandaloneLate,false,'no redundant late item text under four-segment bar');
 await page.getByRole('region',{name:'三栏任务概览'}).getByRole('button',{name:'概览：添加理想任务',exact:true}).click();await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('成熟框架验收');assert((await page.locator('.modal-date-context').innerText()).includes('2026-11-04'));await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
 const cardTypography=await page.locator('.framework-overview .ov-task-name').first().evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),width:el.getBoundingClientRect().width}));
 assert(cardTypography.font>=13.4,'task name remains readable at '+width+'px');
 assert(cardTypography.width>0,'task name is visible');
 await page.getByRole('button',{name:/^打开任务：成熟框架验收/}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:/^打开任务：成熟框架验收/}).click();await page.keyboard.press('Escape');await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:/^打开任务：成熟框架验收/}).click();await page.locator('.q-dialog__backdrop').click({position:{x:2,y:2}});await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:/^打开任务：成熟框架验收/}).click();await page.getByRole('checkbox',{name:'同时领取前两栏全部完成（必做与理想）奖励'}).uncheck();await page.getByRole('button',{name:'确认完成 · 2026-11-04',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>App.store.pointsTotal()),1);
 await page.locator('.framework-overview .mw-completed summary').click();await page.getByRole('button',{name:/^打开任务：成熟框架验收/}).click();await page.getByRole('button',{name:'确认取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0);
 // 174.3: priority only sorts required; bounty tiers are pure display, with no points created.
 await page.evaluate(async()=>{
   const day='2026-11-04',d=App.store.getDay(day);
   d.tasks.required.push({id:'priority-low',text:'低优先测试',priorityWeight:1},{id:'priority-high',text:'高优先测试',priorityWeight:5},{id:'priority-default',text:'默认权重测试'});
   App.store.settings().memoBountyThreshold=25;
   d.tasks.ideal.push(...[10,11,25,30,31].map(n=>({id:'bounty-'+n,text:'悬赏'+n,points:n})));
   await App.store.save();App.memoWorkspace.render();
 });
 const initial=await page.evaluate(()=>({
   order:App.memoWorkspace.taskItems('2026-11-04','required').filter(x=>['priority-low','priority-high','priority-default'].includes(x.task.id)).map(x=>x.task.id),
   tiers:[10,11,25,30,31].map(n=>App.memoOrganize.bountyTier(n)),
   invalid:App.memoWorkspace.priorityWeight({priorityWeight:99}),
   segments:App.memoFinance.column('2026-11-04','ideal').segments.map(x=>x.state)
 }));
 assert.deepEqual(initial.order,['priority-high','priority-default','priority-low'],'required priority and stable default');
 assert.deepEqual(initial.tiers,['none','none','basic','basic','high'],'configured >=25 bounty and >=31 high tier');
 assert.equal(initial.invalid,3,'invalid legacy weight defaults safely');
 assert.deepEqual(initial.segments,['late-done','done','pending','deferred'],'four progress segments retain their ordering');
 const tierEls=await page.locator('.framework-overview .overview-task[data-bounty-tier]').evaluateAll(nodes=>Object.fromEntries(nodes.filter(n=>n.getAttribute('data-overview-ref')?.includes('bounty-')).map(n=>[JSON.parse(n.dataset.overviewRef).id,n.dataset.bountyTier])));
 assert.equal(tierEls['bounty-10'],'none');assert.equal(tierEls['bounty-11'],'none');assert.equal(tierEls['bounty-25'],'basic');assert.equal(tierEls['bounty-31'],'high');
 await page.evaluate(()=>App.memoWorkspace.editor({kind:'task',id:'priority-low',day:'2026-11-04',list:'required'}));
 await page.locator('#mw-priority').selectOption('4');await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>App.store.getDay('2026-11-04').tasks.required.find(t=>t.id==='priority-low').priorityWeight),4,'UI persists priority');
 const resort=await page.evaluate(()=>App.memoWorkspace.taskItems('2026-11-04','required').filter(x=>['priority-low','priority-high','priority-default'].includes(x.task.id)).map(x=>x.task.id));
 assert.deepEqual(resort,['priority-high','priority-low','priority-default'],'required order refreshes after editing');
 await page.evaluate(()=>{
   App.memoSchedule.startRef({kind:'task',id:'priority-high',day:'2026-11-04',list:'required'},Date.now()-67*60000);
   App.memoSchedule.tick();
 });
 await page.locator('#mw-live .float-toggle').click();
 assert(await page.locator('#mw-live .float-hour-note').isVisible(),'second-hour hint is visible');
 assert(await page.locator('#mw-live .float-complete').isVisible(),'task and completion shortcut visible');
 assert((await page.locator('#mw-live .float-meter-track').evaluate(el=>el.getBoundingClientRect().height))>=8,'timer ruler is visible');
 assert.equal(await page.locator('#mw-live [data-schedule-command=pause]').count(),1,'pause is available');
 await page.evaluate(()=>{App.memoSchedule.stopRef({kind:'task',id:'priority-high',day:'2026-11-04',list:'required'});App.memoSchedule.tick();});
 const axe=await new AxeBuilder({page}).include('.app-topbar').include('.app-bottom-nav').include('.framework-overview').withTags(['wcag2a','wcag2aa']).analyze();fs.writeFileSync('test-results/axe-'+width+'.json',JSON.stringify(axe,null,2));assert.deepEqual(axe.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],'new framework accessibility');
 await page.screenshot({path:'test-results/tasks-'+width+'.png',fullPage:true});
 for(const view of ['memo','timeline','checkin','memo-history','calendar','stats','cards','mistakes','sport','memo-review','settings','tasks']){
   await page.evaluate(v=>App.app.switchView(v),view);await page.waitForTimeout(80);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'no horizontal overflow '+width+' '+view);
   if(view==='calendar')assert.equal(await page.locator('.fc-daygrid').count(),1,'FullCalendar mounted');
   if(view==='stats')assert((await page.locator('canvas').count())>0,'Chart.js mounted');
 }
 const csv=await page.evaluate(()=>App.framework.csv([['文本','值'],['逗号,引号"换行\n','中文']]));assert(csv.includes('"逗号,引号""换行\n"'));assert(csv.includes('\r\n'));
 await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);assert.equal(await page.evaluate(()=>App.store.getDay('2026-11-04').tasks.ideal[0].text),'成熟框架验收');assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0);
 // Old UI reads exactly the same store; no migration or second worker is needed.
 await page.goto(base+'/rollback/173.9.1/index.html');await page.waitForFunction(()=>window.App?.app?.ready);assert.equal(await page.evaluate(()=>App.store.getDay('2026-11-04').tasks.ideal[0].text),'成熟框架验收');assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0);
 assert.deepEqual(errors,[]);await context.close();
}
// Exercise the real release worker and all cached recovery resources offline.
const c=await browser.newContext({timezoneId:'Asia/Shanghai'}),p=await c.newPage();await p.goto(base+'/');await p.waitForFunction(()=>window.App?.app?.ready);await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await p.waitForFunction(()=>navigator.serviceWorker.controller);await c.setOffline(true);await p.reload();await p.waitForFunction(()=>window.App?.app?.ready);await p.goto(base+'/recovery.html');assert.equal(await p.getByRole('heading',{name:'随手记恢复入口'}).count(),1);await c.setOffline(false);await c.close();
console.log('Framework navigation, task transaction, accessibility, responsive, CSV, persistence, rollback and offline checks passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
