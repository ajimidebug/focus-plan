/* Synthetic records only. Posting-day flows, granular snapshots, copy deltas and task navigation. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'',process.cwd()]}));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,fonts=process.env.FOCUS_TEST_FONT_DIR;
 const base=fonts&&pathname.startsWith('/__fonts/')?fonts:root;
 const file=path.resolve(base,'.'+(base===fonts?pathname.slice('/__fonts'.length):pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,b)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b);});
});
let checks=0;function check(value,message){assert(value,message);checks++;}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined,args:JSON.parse(process.env.FOCUS_BROWSER_ARGS||'["--no-sandbox"]')});
 try{
  for(const [width,height] of [[320,640],[390,844],[550,350],[770,490],[1280,800]]){
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-10-28T12:00:00+08:00')});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
   await page.addStyleTag({content:'#toast-root{visibility:hidden!important}'});
   if(process.env.FOCUS_TEST_FONT_DIR){await page.addStyleTag({content:'@import url("/__fonts/400.css");body,button,input,textarea,select{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);}
   const {day,old}=await page.evaluate(async()=>{
    const S=App.store,M=App.memoCore,d=S.data(),day=M.userDay(),old=M.shiftDay(day,-1);
    S.getDay(day).tasks.required=[{id:'done',text:'已完成任务',done:true},{id:'todo',text:'待完成任务'}];S.getDay(old).tasks.ideal=[{id:'history',text:'历史日期任务'}];
    d.queue=[{id:'meter',text:'专注数学复盘',estimatedMinutes:40,assignment:{day,list:'required'}}];
    d.checkins=[{id:'green',text:'背单词',target:0,points:2,days:{[day]:2}},{id:'bad',text:'坏习惯监督',points:2,target:1,days:{[day]:4},memoPenaltyPolicies:[{from:day,mode:'punch',amount:2,target:1}]}];
    d.memoHabitPlans=[{id:'g',habitId:'green',mode:'once',from:day,list:'required',target:2},{id:'b',habitId:'bad',mode:'once',from:day,list:'required',target:1}];
    d.ledger=[{id:'income',date:old,at:day+'T08:00:00+08:00',type:'earn-task',points:120,note:'补记收入'},{id:'cost',date:day,at:day+'T09:00:00+08:00',type:'redeem',points:-50,note:'今日消费'},{id:'legacy',date:old,type:'earn-task',points:1000,note:'旧积分'}];
    await S.save();App.app.refreshStats();App.app.switchView('tasks');App.memoWorkspace.enter('today',day);return {day,old};
   });
   check((await page.locator('#stat-points-today').innerText())==='今日 +120 / −50','header signed flow '+width);
   check((await page.locator('#mw-today [data-overview-list="required"] .mw-column-count').innerText())==='2/4','column denominator excludes bad habit '+width);
   check(await page.locator('#mw-today .mw-column-meter').count()===3,'one slim meter per column '+width);
   check(/监督 1项/.test(await page.locator('#mw-today [data-overview-list="required"]').innerText()),'supervision separately labelled '+width);
   await page.locator('#stat-points-today').click();
   check(/收入 \+120.*支出 −50/.test(await page.locator('.modal-body').innerText()),'daily breakdown '+width);
   check((await page.locator('.modal-body').innerText()).includes('行为日 '+old),'backfill behavior day retained '+width);
   check(/1条旧流水/.test(await page.locator('.modal-body').innerText()),'missing timestamp explained '+width);
   await page.locator('.modal [data-act="close"]').click();
   const mobile=await page.locator('#mobile-nav').isVisible();
   await page.evaluate(old=>{App.memoWorkspace.enter('today',old);App.app.switchView('memo');},old);
   const nav=page.locator('#mobile-nav [data-view="tasks"]');
   if(mobile)await nav.click();else await nav.dispatchEvent('click');
   check(await page.locator('#mw-day').inputValue()===old,'first task tap restores date '+width);
   if(mobile)await nav.click();else await nav.dispatchEvent('click');
   await page.waitForFunction(day=>document.querySelector('#mw-day').value===day,day);
   check(await page.locator('#mw-day').inputValue()===day,'task reselect returns today '+width);
   await page.evaluate(()=>App.memoWorkspace.showPane('queue'));
   if(mobile)await nav.click();else await nav.dispatchEvent('click');
   check(await page.locator('#mw-today').isVisible(),'reselect exits queue '+width);
   await page.evaluate(old=>{App.memoWorkspace.enter('today',old);App.app.switchView('memo');App.app.switchView('tasks');},old);
   check(await page.locator('#mw-day').inputValue()===old,'programmatic navigation retains history '+width);
   await page.evaluate(()=>App.ui.openModal('未保存测试','<input value="草稿">',''));
   await nav.dispatchEvent('click');check(await page.locator('#mw-day').inputValue()===old,'open modal prevents reset '+width);await page.evaluate(()=>App.ui.closeModal());
   await page.evaluate(day=>{App.memoWorkspace.enter('today',day);const now=Date.now(),ref={kind:'queue',id:'meter'};App.memoSchedule.startRef(ref,now-52*60000);App.memoSchedule.tick();},day);
   const meter=page.locator('#float-meter .float-meter-track');
   check(await meter.getAttribute('role')==='img','overtime is elapsed scale '+width);
   check(await meter.getAttribute('aria-valuenow')===null,'overtime has no completion percent '+width);
   check(Math.abs(await page.locator('.float-meter-fill').evaluate(e=>parseFloat(e.style.width))-20)<1,'12 overtime minutes fill 20 percent hour scale '+width);
   check(await meter.evaluate(e=>getComputedStyle(e,'::after').backgroundImage!=='none'),'ticks overlay fill '+width);
   if(await page.locator('#mw-live').evaluate(e=>e.classList.contains('float-collapsed')))await page.locator('[data-float-toggle]').click();
   check(/40分钟 · 超时 12分/.test(await page.locator('.float-meter-text').innerText()),'overtime scope explicit '+width);
   await page.evaluate(()=>{const P=App.memoSchedule,s=P.timing({kind:'queue',id:'meter'}).session;P.pauseCore(s,Date.now());P.tick();});
   const paused=await page.locator('.float-meter-fill').evaluate(e=>e.style.width);await page.clock.runFor(2500);await page.evaluate(()=>App.memoSchedule.tick());
   check(await page.locator('.float-meter-fill').evaluate(e=>e.style.width)===paused,'paused scale frozen '+width);
   check(await page.locator('.float-meter-fill').evaluate(e=>Number(getComputedStyle(e).opacity))<.5,'paused meter dims '+width);
   const setMinutes=async minutes=>page.evaluate(minutes=>{const P=App.memoSchedule,s=P.timing({kind:'queue',id:'meter'}).session;s.chunks[0].start=s.chunks[0].end-minutes*60000;P.tick();},minutes);
   await setMinutes(100);check(Number(await page.locator('.float-meter-fill').evaluate(e=>parseFloat(e.style.width)))===100,'exact overtime hour keeps full segment '+width);
   await setMinutes(100+1/60);check(Number(await page.locator('.float-meter-fill').evaluate(e=>parseFloat(e.style.width)))<1,'overtime hour rollover retains hour text '+width);
   check(/1小时＋0分01秒/.test(await page.locator('.float-meter-text').innerText()),'overtime hour count retained '+width);
   await setMinutes(20);check(await meter.getAttribute('role')==='progressbar'&&Number(await meter.getAttribute('aria-valuenow'))===50,'before estimate uses bounded time progress '+width);await setMinutes(52);
   // Commit with an edited note; snapshot must reflect submit-time effective chunks independently.
   await page.evaluate(()=>{App.memoActions.queue('meter');});
   await page.locator('#memo-action-text').fill('自定义完成说明');
   await page.locator('.modal [data-act="commit"]').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
   const completion=await page.evaluate(day=>{const e=App.store.data().memoEvents.find(e=>e.sourceId==='meter'&&e.active);return {snapshot:e.timing,text:App.memoFlow.copyQuote(day).text,note:App.memoCore.read(day).text};},day);
   check(completion.snapshot.segments.length===1&&completion.snapshot.actualMs>=52*60000,'submit stores effective snapshot '+width);
   check(completion.note.includes('自定义完成说明'),'custom note preserved '+width);
   check(completion.text.includes('已保存执行快照')&&completion.text.includes('片段'),'copy supplements edited-away detail '+width);
   if(width===390){
    await page.evaluate(()=>{App.store.data().queue.push({id:'fresh',text:'确认时刷新计时'});App.memoSchedule.startRef({kind:'queue',id:'fresh'},Date.now()-60000);App.memoActions.queue('fresh');});
    await page.clock.runFor(2100);await page.locator('.modal [data-act="commit"]').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
    const fresh=await page.evaluate(()=>App.store.data().memoEvents.find(e=>e.active&&e.sourceId==='fresh'));
    check(fresh.timing.actualMs>=62000&&fresh.timing.text.includes('1分2秒'),'unchanged generated preview refreshes at submit');
   }
   const copy=await page.evaluate(day=>{const F=App.memoFlow,d=App.store.data();F.markCopyCore(F.copyQuote(day));d.ledger.find(e=>e.id==='legacy').points=1002;const q=F.copyQuote(day);return {text:q.text,hasBase:!!F.state().reportFacts};},day);
   check(copy.hasBase&&copy.text.includes('修订前：')&&copy.text.includes('修订后：'),'ledger-level correction checkpoint '+width);
   check(!copy.text.includes('任务汇总修订'),'financial edit never cascades task summaries '+width);
   // Inspect ordinary and dark themes, large numeric header and horizontal containment.
   await page.evaluate(()=>{App.store.data().ledger.push({id:'large',at:new Date().toISOString(),date:App.memoCore.userDay(),points:123456789.12345678,type:'earn-task'});App.app.refreshStats();App.memoWorkspace.render();document.body.dataset.theme='dark';});
   const layout=await page.evaluate(()=>{const header=document.querySelector('#stat-bar').getBoundingClientRect(),brand=document.querySelector('.brand').getBoundingClientRect();return {scroll:document.documentElement.scrollWidth,width:innerWidth,overlap:header.left<brand.right&&header.top<brand.bottom&&header.bottom>brand.top};});
   check(layout.scroll<=layout.width+1,'no page horizontal overflow '+width);
   check(!layout.overlap,'large point header clears brand '+width);
   check(await page.locator('#stat-points-today').evaluate(e=>{const h=document.querySelector('#app-header').getBoundingClientRect(),r=e.getBoundingClientRect();return r.bottom<=h.bottom+1;}),'daily flow remains inside adaptive header '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1733-tasks-'+width+'.png')});}
   check(errors.length===0,'no browser exceptions '+width+': '+errors.join(';'));
   await context.close();
  }
  // Actual 04:00 change refreshes today's flow independently of behavior/effective date.
  const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),p=await c.newPage();await p.clock.install({time:new Date('2026-10-28T03:59:59+08:00')});await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>App?.app?.ready);
  await p.evaluate(()=>{App.store.data().ledger=[{id:'boundary',at:'2026-10-28T03:59:59+08:00',date:'2026-10-27',points:5,type:'earn-task'}];App.app.refreshStats();App.memoSchedule.tick();});
  check((await p.locator('#stat-points-today').innerText()).includes('+5'),'pre-boundary flow');await p.clock.runFor(2100);await p.evaluate(()=>App.memoSchedule.tick());check((await p.locator('#stat-points-today').innerText())==='今日 +0 / −0','flow resets at 04:00');await c.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log(checks+' granular feature browser checks passed across five viewports and 04:00.');
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
