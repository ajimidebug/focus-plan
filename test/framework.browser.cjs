'use strict';
// Run against the packaged SPA, never the legacy source template.
const {chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');fs.mkdirSync('test-results',{recursive:true});
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[ext]||'text/html');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const base='http://127.0.0.1:'+server.address().port;try{
for(const width of [320,390,1280]){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));await page.goto(base+'/#/tasks');await page.waitForFunction(()=>App?.app?.ready&&document.querySelector('.framework-overview'));
 assert.equal(await page.locator('.bottom-grid button').count(),5);
 await page.getByRole('region',{name:'三栏任务概览'}).getByRole('button',{name:'添加理想任务',exact:true}).click();await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('成熟框架验收');await page.getByRole('button',{name:'保存到 2026-11-04',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:'打开任务：成熟框架验收',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:'打开任务：成熟框架验收',exact:true}).click();await page.keyboard.press('Escape');await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:'打开任务：成熟框架验收',exact:true}).click();await page.locator('.q-dialog__backdrop').click({position:{x:2,y:2}});await page.locator('.modal').waitFor({state:'detached'});
 await page.getByRole('button',{name:'打开任务：成熟框架验收',exact:true}).click();await page.getByRole('checkbox',{name:'同时领取额外全部完成（含选做，非全勤）奖励'}).uncheck();await page.getByRole('button',{name:'确认完成 · 2026-11-04',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>App.store.pointsTotal()),1);
 await page.getByRole('button',{name:'打开任务：成熟框架验收',exact:true}).click();await page.getByRole('button',{name:'确认取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0);
 const axe=await new AxeBuilder({page}).include('.app-topbar').include('.app-bottom-nav').include('.framework-overview').withTags(['wcag2a','wcag2aa']).analyze();fs.writeFileSync('test-results/axe-'+width+'.json',JSON.stringify(axe,null,2));assert.deepEqual(axe.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],'new framework accessibility');
 await page.screenshot({path:'test-results/tasks-'+width+'.png',fullPage:true});
 for(const view of ['memo','timeline','checkin','memo-history','calendar','stats','cards','mistakes','sport','memo-review','settings','tasks']){
   await page.evaluate(v=>App.app.switchView(v),view);await page.waitForTimeout(80);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'no horizontal overflow '+width+' '+view);
   if(view==='calendar')assert.equal(await page.locator('.fc-daygrid').count(),1,'FullCalendar mounted');
   if(view==='stats')assert((await page.locator('canvas').count())>0,'Chart.js mounted');
 }
 const csv=await page.evaluate(()=>App.framework.csv([['文本','值'],['逗号,引号"换行\n','中文']]));assert(csv.includes('"逗号,引号""换行\n"'));assert(csv.includes('\r\n'));
 await page.reload();await page.waitForFunction(()=>App?.app?.ready);assert.equal(await page.evaluate(()=>App.store.getDay('2026-11-04').tasks.ideal[0].text),'成熟框架验收');assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0);
 // Old UI reads exactly the same store; no migration or second worker is needed.
 await page.goto(base+'/rollback/173.9.1/index.html');await page.waitForFunction(()=>App?.app?.ready);assert.equal(await page.evaluate(()=>App.store.getDay('2026-11-04').tasks.ideal[0].text),'成熟框架验收');assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0);
 assert.deepEqual(errors,[]);await context.close();
}
// Exercise the real release worker and all cached recovery resources offline.
const c=await browser.newContext({timezoneId:'Asia/Shanghai'}),p=await c.newPage();await p.goto(base+'/');await p.waitForFunction(()=>App?.app?.ready);await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await p.waitForFunction(()=>navigator.serviceWorker.controller);await c.setOffline(true);await p.reload();await p.waitForFunction(()=>App?.app?.ready);await p.goto(base+'/recovery.html');assert.equal(await p.getByRole('heading',{name:'随手记恢复入口'}).count(),1);await c.setOffline(false);await c.close();
console.log('Framework navigation, task transaction, accessibility, responsive, CSV, persistence, rollback and offline checks passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
