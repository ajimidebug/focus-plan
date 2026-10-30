/* Actual unfinished intervals, stationary task controls and three narrow columns. Synthetic data only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'',process.cwd()]}));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,fonts=process.env.FOCUS_TEST_FONT_DIR,base=fonts&&pathname.startsWith('/__fonts/')?fonts:root;
 const file=path.resolve(base,'.'+(base===fonts?pathname.slice('/__fonts'.length):pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,b)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b);});
});
let checks=0;function check(value,message){assert(value,message);checks++;}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined,args:JSON.parse(process.env.FOCUS_BROWSER_ARGS||'["--no-sandbox"]')});
 try{
  for(const [width,height] of [[320,640],[360,740],[390,844],[430,850],[550,350],[1280,800]]){
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-10-29T12:00:00+08:00')});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
   await page.addStyleTag({content:'#toast-root{visibility:hidden!important}'});
   if(process.env.FOCUS_TEST_FONT_DIR){await page.addStyleTag({content:'@import url("/__fonts/400.css");body,button,input,textarea,select{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);}
   const day=await page.evaluate(async()=>{
    const S=App.store,M=App.memoCore,d=S.data(),day=M.userDay();
    d.queue=[];d.queueDone=[];d.daily=[];d.memoProjects=[];d.memoSchedule={version:1,items:[],sessions:[]};d.ledger=[];
    ['required','ideal','extra'].forEach((list,i)=>S.getDay(day).tasks[list]=[{id:'long-'+i,text:'任务名称完整展示测试：复盘线性代数相似矩阵证明和微分方程错题，独立完成代表题验证，不隐藏末尾文字XYZ123456789',points:123456789,estimatedMinutes:20}]);
    d.checkins=[{id:'habit-long',text:'习惯名称完整展示：连续背诵专业课并且独立回忆章节结构',target:99,points:12345,days:{}}];
    d.memoHabitPlans=[{id:'habit-plan',habitId:'habit-long',mode:'once',from:day,list:'ideal',target:99}];
    const ref={kind:'task',id:'long-1',day,list:'ideal'},base=Date.parse(day+'T09:10:00+08:00');
    const s=App.memoSchedule.startRef(ref,base);App.memoSchedule.pauseCore(s,base+1500000);App.memoSchedule.startRef(ref,base+3000000);App.memoSchedule.pauseCore(s,base+4080000);
    await S.save();App.app.switchView('tasks');App.memoWorkspace.enter('today',day);return day;
   });
   for(const theme of ['default','dark']){
    await page.evaluate(theme=>document.body.dataset.theme=theme,theme);
    const layout=await page.evaluate(()=>{
     const overview=document.querySelector('.mw-overview'),grid=overview.querySelector('.cal-cols'),cols=[...grid.children];
     return {width:innerWidth,page:document.documentElement.scrollWidth,ow:overview.clientWidth,os:overview.scrollWidth,gw:grid.clientWidth,gs:grid.scrollWidth,
      cols:cols.map(c=>{const r=c.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:c.scrollWidth,client:c.clientWidth};}),
      names:[...overview.querySelectorAll('.ov-task-name,.habit-plan-title')].map(e=>({height:e.clientHeight,scroll:e.scrollHeight,clamp:getComputedStyle(e).webkitLineClamp})),
      overflowing:[...overview.querySelectorAll('*')].filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+2).map(e=>e.className)};
    });
    check(layout.page<=width+1,'page fits '+width+' '+theme);
    check(layout.os<=layout.ow+1&&layout.gs<=layout.gw+1,'no internal carousel '+width+' '+theme);
    check(layout.cols.length===3&&layout.cols.every(c=>c.left>=0&&c.right<=width+1),'three visible columns '+width+' '+theme);
    check(layout.cols.every(c=>c.scroll<=c.client+1),'all column contents fit '+width+' '+theme);
    check(layout.names.every(n=>n.height>=n.scroll-1&&n.clamp==='none'),'names never clamped '+width+' '+theme);
    check(layout.overflowing.length===0,'all overview metadata wraps '+width+' '+theme+': '+layout.overflowing.join(','));
   }
   await page.evaluate(()=>document.body.dataset.theme='default');
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1734-columns-'+width+'.png')});}
   const exported=await page.evaluate(day=>App.memoFlow.copyQuote(day),day);
   check(exported.text.includes('09:10:00 — 2026-10-29 09:35:00')&&exported.text.includes('10:00:00 — 2026-10-29 10:18:00'),'unfinished copied with both exact intervals '+width);
   check(exported.factSnapshot.execution[day].actualMs===43*60000,'copied time excludes gaps '+width);
   await page.locator('[data-overview-ref]').first().click();
   await page.locator('.modal').evaluate(e=>e.getAnimations().forEach(a=>a.finish()));
   check(await page.locator('.task-action-modal .modal-actions #ma-timer').count()===1,'original timer moved into footer '+width);
   const footer=await page.locator('#ma-timer').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('.modal-actions').getBoundingClientRect();return {height:r.height,width:r.width,footer:p.width,bottom:r.bottom};});
   check(footer.height>=48&&footer.width>=footer.footer-2,'full-width prominent timer '+width+': '+JSON.stringify(footer));
   check(footer.bottom<=height,'timer visible immediately '+width);
   check(await page.locator('.modal-body').evaluate(e=>e.clientHeight>=60),'body retains a reachable scroll area '+width);
   await page.locator('#memo-action-text').fill('保留用户修改的完成说明\n'+('正文内容\n'.repeat(30)));
   await page.clock.runFor(40);
   const beforeScroll=await page.locator('#ma-timer').boundingBox();
   await page.locator('.modal-body').evaluate(e=>e.scrollTop=e.scrollHeight);
   check(Math.abs((await page.locator('#ma-timer').boundingBox()).y-beforeScroll.y)<2,'footer remains stationary when body scrolls '+width);
   await page.locator('#ma-timer').click();
   await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('暂停计时')&&!document.querySelector('#ma-timer').disabled);
   check(await page.locator('.task-action-modal').count()===1,'edited text keeps dialog open '+width);
   check(/暂停计时/.test(await page.locator('#ma-timer').innerText()),'running timer changes action '+width);
   check(await page.evaluate(()=>App.store.data().ledger.length)===0,'starting never grants points '+width);
   await page.clock.runFor(2100);await page.evaluate(()=>App.memoSchedule.tick());
   check(await page.locator('#ma-timer-state,.ma-meter').count()===0,'dialog omits timer summary and meter '+width);
   check((await page.locator('#memo-action-text').inputValue()).includes('保留用户修改'),'clock does not replace draft '+width);
   await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('继续计时')&&!document.querySelector('#ma-timer').disabled);check(/继续计时/.test(await page.locator('#ma-timer').innerText()),'pause becomes continue '+width);
   if(width===390){
    await page.evaluate(()=>{window.__save=App.store.save;App.store.save=async()=>false;});
    const before=await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.ref.id==='long-0').chunks.length);
    await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('重试保存'));check(/重试保存/.test(await page.locator('#ma-timer').innerText()),'timer save failure has reachable retry');
    await page.evaluate(()=>App.store.save=window.__save);await page.locator('#ma-timer').click();
    await page.waitForFunction(()=>!App.memoActions.busy());
    check((await page.locator('#memo-action-error').innerText())==='','successful retry clears the stale save error');
    check(await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.ref.id==='long-0').chunks.length)===before+1,'retry saves once without another chunk');
    await page.evaluate(()=>App.memoSchedule.tick());
   }
   if(process.env.FOCUS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1734-dialog-'+width+'.png')});
   await page.locator('.modal [data-act="commit"]').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
   check(await page.evaluate(()=>App.memoSchedule.state().sessions.filter(s=>s.ref.id==='long-0').every(s=>s.status==='ended')),'completion ends its timer '+width);
   check(errors.length===0,'no exceptions '+width+': '+errors.join(';'));
   await context.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log(checks+' execution-copy and narrow-column browser checks passed across six viewports.');
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
