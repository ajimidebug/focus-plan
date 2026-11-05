'use strict';
/* 174.4 browser contract: keep existing tasks/ledger and add review audits + optional project dates. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(b)});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage();
   await page.clock.setFixedTime(new Date('2026-11-05T12:00:00+08:00'));
   await page.goto(base+'/#/tasks');
   await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt);
   const result=await page.evaluate(async()=>{
    const A=App,S=A.store,d=S.data();
    d.memoProjects=[{id:'gantt-a',text:'长期项目一',days:{'2026-11-04':true},memoGanttStart:'2026-11-02',memoGanttEnd:'2026-11-12'},
      {id:'gantt-b',text:'长期项目二',days:{},memoGanttStart:'2026-11-04',memoGanttEnd:'2026-11-18',memoGanttDependencies:['gantt-a']}];
    d.memoWishes=[{id:'wish-a',name:'测试愿望',cents:5000}];
    const series=A.memoReview.newSeriesCore({text:'测试复习',note:'初始备注',points:1,list:'ideal',due:Date.now()+3600000});
    const round=A.memoReview.rounds(series.id)[0],event={id:'mock-event',at:new Date().toISOString()};
    A.memoReview.onComplete(event,{...round.taskRef,review:{result:'partial',mode:'relative',minutes:30,memoThis:'本次识别错误',memoNext:'下次集中测试'}});
    (d.memoEvents||(d.memoEvents=[])).push({...event,active:true,kind:'task',sourceId:round.taskRef.id,sourceDay:round.taskRef.day});
    const follow=A.memoReview.round(event.review.nextRoundId);
    await S.save();A.memoWorkspace.render();A.memoWishes.render();
    let cycle=false;try{A.memoGantt.validate({id:'gantt-a'},'2026-11-02','2026-11-12',['gantt-b'])}catch(e){cycle=/循环/.test(e.message)}
    return {cycle,review:A.memoReview.exportData(),csv:A.memoReview.exportCSV(),followNote:follow.prepNote,model:A.memoGantt.model(),mainVersion:window.__RELEASE};
   });
   assert.equal(result.mainVersion,require('../package.json').version);
   assert.equal(result.cycle,true,'dependency cycle rejected');
   assert.equal(result.review.series.length,1);
   assert.equal(result.review.rounds.length,2);
   assert.equal(result.review.events.length,1);
   assert.equal(result.review.plans.length,2);
   assert.equal(result.followNote,'下次集中测试');
   assert(result.csv.includes('本次识别错误')&&result.csv.includes('下次集中测试'));
   assert.equal(result.model.rows.length,2);
   await page.locator('.memo-gantt > summary').click();
   assert((await page.locator('.memo-gantt').innerText()).includes('长期项目一'));
   const bar=page.locator('.memo-gantt-bar').first();
   assert((await bar.getAttribute('aria-label')).includes('计划 2026-11-02 至 2026-11-12'));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert(overflow<=1,'no page-wide overflow '+width);
   await page.getByRole('button',{name:'编辑计划'}).first().click();
   await page.locator('#memo-gantt-start').waitFor();
   assert.equal(await page.locator('#memo-gantt-start').inputValue(),'2026-11-02');
   await page.locator('#memo-gantt-end').fill('2026-11-19');
   await page.locator('.mw-task-editor [data-act="save"]').click();
   await page.locator('.mw-task-editor').waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>App.store.data().memoProjects[0].memoGanttEnd),'2026-11-19');
   assert((await page.locator('#memo-wishes').innerText()).includes('进度不可相加'));
   const review=page.locator('.review-registry');
   await review.locator('summary').first().click();
   const [download]=await Promise.all([page.waitForEvent('download'),review.locator('[data-review-export="json"]').click()]);
   assert(download.suggestedFilename().endsWith('.json'));
   assert.equal(await page.evaluate(()=>App.store.pointsTotal()),0,'no points awarded by the presentation audit');
   await context.close();
  }
  console.log('174.4 review export, next-note, Gantt planning, dependency validation, wishlist and responsive checks passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
