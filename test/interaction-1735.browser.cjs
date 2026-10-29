/* Isolated synthetic tasks: dated copies, live overtime transitions and one-point defaults. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'',process.cwd()]}));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,fonts=process.env.FOCUS_TEST_FONT_DIR,base=fonts&&pathname.startsWith('/__fonts/')?fonts:root;
 const file=path.resolve(base,'.'+(base===fonts?pathname.slice('/__fonts'.length):pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,bytes)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(bytes);});
});
let checks=0;function check(ok,message){assert(ok,message);checks++;}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[320,640],[390,844],[550,350],[1280,800]]){
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-30T12:00:00+08:00')});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
   await page.evaluate(async()=>{
    const S=App.store,d=S.data(),day=App.memoCore.userDay(),old=App.memoCore.shiftDay(day,-1);
    delete d.memoIdealDefaultVersion;d.settings.idealPoints=10;d.ledger=[];d.queue=[{id:'meter',text:'自动超时与暂停恢复',points:1,estimatedMinutes:1}];
    d.memoSchedule={version:1,items:[],sessions:[]};d.checkins=[];d.daily=[];d.memoProjects=[];
    S.getDay(old).tasks.ideal=[{id:'copy',text:'原日期任务名称',note:'原备注',subs:[{text:'原子项',done:true}]}];await S.save();
   });
   await page.reload();await page.waitForFunction(()=>App?.app?.ready);
   await page.addStyleTag({content:'#toast-root{visibility:hidden!important}'});
   if(process.env.FOCUS_TEST_FONT_DIR){await page.addStyleTag({content:'@import url("/__fonts/400.css");body,button,input,textarea,select{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);}
   check(await page.evaluate(()=>App.store.settings().idealPoints)===1,'legacy default becomes one '+width);
   const days=await page.evaluate(async()=>{
    const S=App.store,M=App.memoCore,day=M.userDay(),old=M.shiftDay(day,-1),ref={kind:'task',id:'copy',day:old,list:'ideal'};
    await App.memoActions.commit(()=>App.memoFlow.moveCore(ref,day,'ideal'));
    const current=App.memoSchedule.find(ref);current.text='目标日期修改后的名称';current.subs[0].text='目标子项';await S.save();
    App.app.switchView('tasks');App.memoWorkspace.enter('today',old);return {day,old};
   });
   check(await page.evaluate(old=>App.store.getDay(old).tasks.ideal[0].points,days.old)===10,'implicit old reward stays ten '+width);
   const history=page.locator('#mw-today .mw-overview .mw-deferred');check(await history.count()===1,'original day retains one copy '+width);
   check((await history.innerText()).includes('原日期任务名称')&&(await history.innerText()).includes(days.day),'source title and destination visible '+width);
   check(await history.locator('[data-mw="complete"],[data-schedule-command]').count()===0,'history is not another executable task '+width);
   check(await page.locator('#mw-today .mw-overview [data-overview-list="ideal"] .mw-column-count').innerText()==='0/1','historical daily denominator retained '+width);
   await history.locator('[data-deferred-open]').click();check(await page.locator('#mw-day').inputValue()===days.day,'history navigates to active continuation '+width);
   check((await page.locator('#mw-today .mw-overview').innerText()).includes('目标日期修改后的名称'),'current copy has edited title '+width);
   await page.locator('#mw-column-ideal [data-mw="add-ideal"]').click();check(await page.locator('#mw-points').inputValue()==='1','new ideal form uses one '+width);
   await page.locator('#mw-title').fill('新建一分任务');await page.locator('.modal [data-act="save"]').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
   check(await page.evaluate(day=>App.store.getDay(day).tasks.ideal.find(t=>t.text==='新建一分任务').points,days.day)===1,'new task saves explicit one '+width);
   const session=await page.evaluate(async()=>{const s=App.memoSchedule.startRef({kind:'queue',id:'meter'},Date.now()-59000);await App.store.save();App.memoSchedule.tick();return s.id;});
   check(await page.locator('#mw-live .float-meter-track').evaluate(e=>e.getBoundingClientRect().height)>=6,'visible collapsed meter stays at least six px '+width);
   await page.evaluate(()=>App.memoActions.queue('meter'));
   const footer=page.locator('.task-action-modal .float-meter-track'),footerFill=page.locator('.task-action-modal .float-meter-fill'),floatTrack=page.locator('#mw-live .float-meter-track');
   check(await footer.getAttribute('role')==='progressbar','footer starts in expected mode '+width);
   const drawing=await footerFill.evaluate(e=>({display:getComputedStyle(e).display,width:e.getBoundingClientRect().width,height:parseFloat(getComputedStyle(e).height),image:getComputedStyle(e).backgroundImage}));
   check(drawing.display==='block'&&drawing.width>5&&drawing.height>=8&&drawing.image.includes('linear-gradient'),'footer fill actually renders '+width+': '+JSON.stringify(drawing));
   await page.locator('#memo-action-text').fill('计时期间保留草稿');
   await page.clock.runFor(2100);await page.evaluate(()=>App.memoSchedule.tick());
   check(await page.locator('#mw-live').getAttribute('data-meter-state')==='overtime','float automatically crosses threshold '+width);
   check(await page.locator('.ma-timer-panel').getAttribute('data-meter-state')==='overtime','open dialog automatically crosses threshold '+width);
   check(await footer.getAttribute('role')==='img'&&await floatTrack.getAttribute('role')==='img','both switch to time scale '+width);
   check(await page.evaluate(id=>App.memoSchedule.state().sessions.length===1&&App.memoSchedule.state().sessions[0].id===id,session),'threshold never creates a session '+width);
   check(await floatTrack.evaluate(e=>parseFloat(getComputedStyle(e,'::before').width)>=3),'visible state marker at first overtime second '+width);
   check((await page.locator('#mw-live .float-clock').innerText()).includes('超时'),'collapsed overtime text visible '+width);
   check(await footerFill.evaluate(e=>getComputedStyle(e).backgroundImage.includes('244, 180, 74')),'footer changes to warm gradient '+width);
   if(width===390){
    await page.evaluate(()=>{window.__save=App.store.save;App.store.save=async()=>false;});await page.locator('#ma-timer').click();
    await page.waitForFunction(()=>App.memoActions.busy()&&document.querySelector('#ma-timer').textContent==='重试保存');
    await page.evaluate(()=>App.store.save=window.__save);await page.locator('#ma-timer').click();await page.waitForFunction(()=>!App.memoActions.busy());
    check(await page.evaluate(()=>App.memoSchedule.state().sessions[0].chunks.length)===1,'retry does not duplicate timer chunk');
   }else await page.locator('#ma-timer').click();
   await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('继续计时')&&!document.querySelector('#ma-timer').disabled);
   const frozen=await footerFill.evaluate(e=>e.style.width);await page.clock.runFor(2100);await page.evaluate(()=>App.memoSchedule.tick());
   check(await footerFill.evaluate(e=>e.style.width)===frozen,'paused overtime freezes '+width);
   check(await footerFill.evaluate(e=>Number(getComputedStyle(e).opacity))>=.65,'paused meter remains readable '+width);
   await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('暂停计时')&&!document.querySelector('#ma-timer').disabled);await page.clock.runFor(1100);await page.evaluate(()=>App.memoSchedule.tick());
   check(await page.evaluate(id=>App.memoSchedule.state().sessions[0].id===id&&App.memoSchedule.state().sessions[0].chunks.length===2,session),'resume keeps session and adds only its real chunk '+width);
   check(parseFloat(await footerFill.evaluate(e=>e.style.width))>parseFloat(frozen),'overtime resumes growing '+width);
   check((await page.locator('#memo-action-text').inputValue()).includes('保留草稿'),'timer updates preserve draft '+width);
   for(const theme of ['default','dark']){
    await page.evaluate(t=>document.body.dataset.theme=t,theme);
    check(await page.locator('.modal-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'modal fits '+width+' '+theme);
    check(await page.locator('#ma-timer').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'timer control visible '+width+' '+theme);
   }
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>document.body.dataset.theme='default');await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1735-overtime-'+width+'.png'),animations:'disabled'});}
   await page.evaluate(()=>App.ui.closeModal());
   check(await floatTrack.evaluate(e=>e.getBoundingClientRect().height)>=6,'overtime remains visible when dialog closes '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1735-float-'+width+'.png'),animations:'disabled'});
   check(errors.length===0,'no browser exceptions '+width+': '+errors.join(';'));await context.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log(checks+' deferred-copy, luminous-meter and default-point checks passed across four viewports.');
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
