/* Isolated synthetic records. Exercises 173.2 interactions; never opens a user session. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'',process.cwd()]}));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const fonts=process.env.FOCUS_TEST_FONT_DIR;
 const base=fonts&&pathname.startsWith('/__fonts/')?fonts:root;
 const file=path.resolve(base,'.'+(base===fonts?pathname.slice('/__fonts'.length):pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,b)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b);});
});
let checks=0;
function check(value,message){assert(value,message);checks++;}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined,args:JSON.parse(process.env.FOCUS_BROWSER_ARGS||'["--no-sandbox"]')});
 try{
  for(const [width,height] of [[320,640],[390,844],[550,350],[770,490],[1280,800]]){
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.stack||e.message));
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.addStyleTag({content:'#toast-root{visibility:hidden!important}'});
   const shot=async name=>{if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(process.env.FOCUS_SCREENSHOT_DIR,name+'-'+width+'.png')});}};
   await page.waitForFunction(()=>App?.app?.ready);
   if(process.env.FOCUS_TEST_FONT_DIR){await page.addStyleTag({content:'@import url("/__fonts/400.css");body,button,input,textarea,select{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);}
   const day=await page.evaluate(async()=>{
    const M=App.memoCore,S=App.store,d=S.data(),day=M.userDay();
    d.queue=[{id:'visual-clock',text:'复盘数学错题与代表题独立验证',points:10}];
    d.checkins=[{id:'green',text:'背单词',target:2,rewardLimit:3,points:5,days:{[day]:2}},{id:'bad',text:'坏习惯记录',target:1,points:5,days:{[day]:2},memoPenaltyPolicies:[{from:day,mode:'punch',amount:5,target:1}]}];
    d.memoHabitPlans=[{id:'green-plan',habitId:'green',mode:'daily',from:day,list:'required',target:2}];
    M.write(day,Array.from({length:65},(_,i)=>'第'+(i+1)+'行：复盘、学习与随手记录。').join('\n')+'\n\n');
    await S.save();App.memo.show(day);App.app.switchView('memo');return day;
   });
   const editor=page.locator('#memo-editor');
   await page.waitForFunction(()=>{const e=document.querySelector('#memo-editor');return e.scrollHeight-e.clientHeight-e.scrollTop<2;});
   check(await page.evaluate(()=>document.activeElement?.id!=='memo-editor'),'opening memo does not summon keyboard '+width);
   await editor.click({position:{x:20,y:25}});
   check(await page.evaluate(()=>App.memoEditor.selection().end===App.memoEditor.text().length),'first click selects document end '+width);
   await page.keyboard.insertText('末尾追加');
   check(await page.evaluate(()=>App.memoEditor.text().endsWith('末尾追加')),'text appends at tail '+width);
   await page.evaluate(()=>App.memoEditor.select(2));await page.keyboard.insertText('编辑');
   check(await page.evaluate(()=>App.memoEditor.text().slice(2,4)==='编辑'),'focused editor permits old-text editing '+width);
   if(width===390){
    const ime=await page.evaluate(()=>{
     const root=document.querySelector('#memo-editor');App.memoEditor.select(App.memoEditor.text().length);
     root.dispatchEvent(new CompositionEvent('compositionstart',{data:''}));
     const node=window.getSelection().focusNode,offset=node.textContent.length;node.textContent+='中文';
     const range=document.createRange();range.setStart(node,offset+2);range.collapse(true);window.getSelection().removeAllRanges();window.getSelection().addRange(range);
     root.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText',data:'中文'}));
     const preserved=root.contains(node);root.dispatchEvent(new CompositionEvent('compositionend',{data:'中文'}));
     return {preserved,text:App.memoEditor.text(),busy:App.memoEditor.busy()};
    });
    check(ime.preserved,'composition input retains the native DOM node');check(ime.text.endsWith('中文')&&!ime.busy,'composition commits text and leaves input ready');
   }
   await page.evaluate(()=>App.memoEditor.select(6));await page.locator('#memo-time').click();
   check(await page.evaluate(()=>/\d{4}/.test(App.memoEditor.text().slice(6,24))),'toolbar insertion retains caret '+width);
   await page.evaluate(()=>{document.querySelector('#memo-editor').blur();document.querySelector('#memo-heading').focus?.();});
   await editor.dispatchEvent('pointerdown',{pointerId:4,clientX:30,clientY:150,pointerType:'touch'});
   await page.evaluate(()=>{document.querySelector('#memo-editor').focus();App.memoEditor.select(2,10);});
   await editor.dispatchEvent('contextmenu');await editor.dispatchEvent('click',{detail:1});
   check(await page.evaluate(()=>App.memoEditor.selection()?.end-App.memoEditor.selection()?.start===8),'long press selection is preserved '+width);
   // Reopening returns to the tail; layout changes keep the tail visible without stealing focus.
   await page.evaluate(()=>{window.getSelection().removeAllRanges();App.app.switchView('tasks');App.app.switchView('memo');});
   await page.waitForFunction(()=>{const e=document.querySelector('#memo-editor');return e.scrollHeight-e.clientHeight-e.scrollTop<2;});
   await editor.click({position:{x:20,y:25}});await page.setViewportSize({width,height:Math.min(height,400)});
   await page.waitForFunction(()=>{const e=document.querySelector('#memo-editor');return e.scrollHeight-e.clientHeight-e.scrollTop<3;});
   check(await page.evaluate(()=>document.activeElement.id==='memo-editor'),'resizing retains editor focus '+width);
   await page.setViewportSize({width,height});
   await page.evaluate(()=>{document.querySelector('#memo-editor').blur();App.memoSchedule.startRef({kind:'queue',id:'visual-clock'},Date.now()-83*60000);App.memoSchedule.tick();});
   // The float becomes expanded explicitly, independent of previous test state.
   await page.locator('[data-float-toggle]').click();
   const meter=page.locator('#float-meter .float-meter-track');
   check(await meter.getAttribute('role')==='img','unestimated timer is a time scale '+width);
   check(await meter.getAttribute('aria-valuenow')===null,'time scale has no false completion percent '+width);
   check(/1小时＋23分/.test(await page.locator('.float-meter-text').innerText()),'hour count survives scale rollover '+width);
   const expanded=await page.locator('#mw-live').boundingBox();
   check(expanded.height<245&&expanded.width<=width-20,'expanded float stays compact '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'memo-'+width+'.png')});}
   await page.locator('[data-float-toggle]').click();
   const compact=await page.locator('#mw-live').boundingBox();check(compact.height<110,'collapsed float has two content lines '+width);await shot('compact');
   check(await page.locator('#mw-live-controls [data-schedule-command="pause"]').isVisible(),'pause accessible while collapsed '+width);
   await page.evaluate(()=>{App.store.data().queue[0].estimatedMinutes=60;App.memoSchedule.tick();});
   check(await page.locator('#mw-live').evaluate(e=>e.classList.contains('float-overtime')),'overtime remains visually distinct '+width);
   await page.locator('[data-float-toggle]').click();check(/超时/.test(await page.locator('.float-meter-text').innerText()),'overtime label visible '+width);
   await page.evaluate(()=>{const P=App.memoSchedule;P.stopRef({kind:'queue',id:'visual-clock'});App.app.switchView('tasks');App.memoWorkspace.showPane('today');});
   const green=page.locator('.mw-overview [data-habit-punch="green"]');
   const color=await green.evaluate(e=>getComputedStyle(e).backgroundColor);
   check(color==='rgb(232, 245, 236)','task-page attainment is green '+width);await shot('green');
   check(await green.locator('xpath=ancestor::details[contains(@class,"mw-completed")]').count()===0,'attained habit remains visible '+width);
   await page.evaluate(()=>{const it=App.store.data().checkins.find(i=>i.id==='green');it.days[App.memoCore.userDay()]=3;App.tasks.renderAll();});
   check(await green.evaluate(e=>getComputedStyle(e).backgroundColor)===color,'cap exhausted keeps green and original position '+width);
   await page.evaluate(()=>{App.store.data().checkins.find(i=>i.id==='green').days[App.memoCore.userDay()]=1;App.tasks.renderAll();});
   check(await green.evaluate(e=>getComputedStyle(e).backgroundColor)!==color,'undo below goal removes green '+width);
   await page.evaluate(()=>{App.store.data().checkins.find(i=>i.id==='green').days[App.memoCore.userDay()]=2;App.app.switchView('checkin');});
   check(await page.locator('.ck-row[data-id="green"]').evaluate(e=>getComputedStyle(e).backgroundColor)===color,'points and tasks share attainment color '+width);
   await page.evaluate(()=>document.body.dataset.theme='dark');
   check(await page.locator('.ck-row[data-id="green"]').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(32, 62, 48)','dark theme has readable green '+width);
   await page.evaluate(()=>{document.body.dataset.theme='';App.app.switchView('tasks');App.memoWorkspace.enter('today',App.memoCore.shiftDay(App.memoCore.userDay(),1));App.memoWorkspace.editor(null,'ideal');});
   check(await page.locator('.modal').getAttribute('data-date-context')==='future','future task highlights whole dialog '+width);
   check((await page.locator('.modal-date-context').innerText()).includes('明天'),'explicit target day '+width);await shot('date');
   const target=await page.evaluate(()=>App.memoCore.shiftDay(App.memoCore.userDay(),1));
   check((await page.locator('.modal [data-act="save"]').innerText()).includes(target),'save button names target date '+width);
   check(!await page.locator('.modal [data-act="save-start"]').isVisible(),'future task cannot start accidentally '+width);
   await page.locator('.modal [data-act="cancel"]').click();
   await page.evaluate(()=>App.memoWorkspace.editor({kind:'queue',id:'visual-clock'}));
   check((await page.locator('.modal-date-context').innerText()).includes('尚未安排日期'),'undated queue is labeled honestly '+width);
   await page.locator('.modal [data-act="cancel"]').click();
   await page.evaluate(()=>App.memoFinance.arrange('green'));
   await page.locator('#hp-day').fill(target);await page.locator('#hp-day').dispatchEvent('input');
   check(await page.locator('.modal').getAttribute('data-date-context')==='future','changing habit day updates context '+width);
   check((await page.locator('.modal [data-act="save"]').first().innerText()).includes(target.slice(5)),'habit save choices include date '+width);
   await page.locator('.modal [data-act="cancel"]').click();
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document overflow '+width);
   check(errors.length===0,'no runtime errors '+width+': '+errors.join(';'));
   await context.close();
  }
  // Boundary passes while a form remains open: text updates, target does not move.
  const context=await browser.newContext({viewport:{width:390,height:700},serviceWorkers:'block'}),page=await context.newPage();
  await page.clock.install({time:new Date('2026-10-28T03:59:50+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
  await page.evaluate(()=>{
   const day=App.memoCore.userDay();App.store.data().checkins=[{id:'boundary-clock',text:'分日预计计时',target:10,rewardLimit:10,points:2,estimatedMinutes:40,days:{}}];
   App.memoSchedule.startRef({kind:'checkin',id:'boundary-clock',day},Date.now()-20*60000);App.memoSchedule.tick();
  });
  check(Number(await page.locator('#float-meter .float-meter-track').getAttribute('aria-valuenow'))===50,'daily estimate uses pre-boundary daily time');
  await page.evaluate(()=>App.memoWorkspace.editor(null,'ideal'));
  const original=await page.locator('.modal-date-context').innerText();check(original.includes('今天'),'pre-boundary form starts today');
  await page.clock.fastForward(20000);
  check((await page.locator('.modal-date-context').innerText()).includes('昨天'),'open form changes relative label after 04:00');
  check((await page.locator('.modal [data-act="save"]').innerText()).includes('2026-10-27'),'open form retains original date after boundary');
  check(!await page.locator('.modal [data-act="save-start"]').isVisible(),'cross-boundary save cannot start old-day task');
  check(Number(await page.locator('#float-meter .float-meter-track').getAttribute('aria-valuenow'))===0,'daily estimate resets its scope after 04:00 while session keeps running');
  await context.close();
  console.log(checks+' browser interaction checks passed across five viewports and the 04:00 boundary.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
