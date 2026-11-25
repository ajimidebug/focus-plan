/* Isolated synthetic records. Exercises 173.2 interactions; never opens a user session. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||path.resolve(__dirname,'..'));
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
   await page.waitForFunction(()=>window.App?.app?.ready);
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
   check(await page.evaluate(()=>{const s=App.memoEditor.selection(),n=App.memoEditor.text().length;return s&&s.end<n;}),'first click on visible text retains its caret instead of forcing document end '+width);
   await page.evaluate(()=>App.memoEditor.select(App.memoEditor.text().length));
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
   const beforeStamp=await page.evaluate(()=>{App.memoEditor.select(2,10);return App.memoEditor.text();});
   await page.locator('#memo-time').click();
   const stamped=await page.evaluate(()=>({text:App.memoEditor.text(),caret:App.memoEditor.selection(),colors:['memo-time','memo-rest','memo-think'].map(id=>getComputedStyle(document.getElementById(id)).backgroundColor),buttons:[...document.querySelector('.memo-toolbar').children].map(el=>el.id)}));
   check(stamped.text.startsWith(beforeStamp)&&/^\n(?:次日)?\d{4} $/.test(stamped.text.slice(beforeStamp.length)),'time appends at document tail and preserves selected text '+width);
   check(stamped.caret.start===stamped.text.length&&stamped.caret.end===stamped.text.length,'time leaves collapsed caret after appended space '+width);
   check(stamped.buttons.join('|')==='memo-time|memo-rest|memo-think|memo-copy-menu','four toolbar actions with full copy under more '+width);
   check(new Set(stamped.colors).size===3,'time rest and thought use distinct harmonious colors '+width);
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__toolbarCopy=text;}}}));
   await page.locator('#memo-copy-menu>summary').click();
   check(await page.locator('.memo-popup-layer .memo-copy-options>button').first().getAttribute('id')==='memo-copy-full','full copy is first menu action '+width);
   await page.locator('#memo-copy-full').click();await page.waitForFunction(()=>!!window.__toolbarCopy);
   check((await page.evaluate(()=>window.__toolbarCopy)).includes(beforeStamp),'full copy menu retains complete memo content '+width);
   check(await page.locator('.memo-popup-layer').isHidden(),'copy closes popup '+width);
   await page.waitForFunction(()=>!App.memoActions.busy()&&App.store.status().phase==='saved');
   if(width===390){
    for (const offset of [-1,1]) {
     const otherDay=await page.evaluate(async ({day,offset})=>{
      await App.memo.flush();
      const other=App.memoCore.shiftDay(day,offset);
      App.memoCore.write(other,'其他日正文');App.memo.show(other);
      App.memoEditor.select(App.memoEditor.text().length);App.memoEditor.insert('，刚输入');
      return other;
     },{day,offset});
     const previousText=await page.evaluate(day=>App.memoCore.read(day).text,day);
     await page.locator('#memo-time').click();
     await page.waitForFunction(day=>App.memo.selected()===day&&App.memoEditor.selection()?.end===App.memoEditor.text().length,day);
     check(await page.evaluate(other=>App.memoCore.read(other).text==='其他日正文，刚输入',otherDay),'non-today draft is saved without receiving a stamp '+offset);
     const currentText=await page.evaluate(()=>App.memoEditor.text());
     check(currentText.startsWith(previousText)&&/^\n?(?:次日)?\d{4} $/.test(currentText.slice(previousText.length)),
      'time is appended to the current user day '+offset);
    }
    await page.evaluate(async day=>{
     await App.memo.flush();App.memo.show(App.memoCore.shiftDay(day,-1));
     window.originalMemoFlush=App.store.flush;App.store.flush=async()=>false;
    },day);
    await page.locator('#memo-time').click();
    await page.waitForFunction(()=>document.querySelector('#memo-save').textContent.includes('暂不切换日期'));
    check(await page.evaluate(day=>App.memo.selected()===App.memoCore.shiftDay(day,-1),day),'time leaves the source day selected when save fails');
    await page.evaluate(day=>{App.store.flush=window.originalMemoFlush;App.memo.show(day);},day);
   }

   await page.evaluate(()=>{document.querySelector('#memo-editor').blur();document.querySelector('#memo-heading').focus?.();});
   await editor.dispatchEvent('pointerdown',{pointerId:4,clientX:30,clientY:150,pointerType:'touch'});
   await page.evaluate(()=>{document.querySelector('#memo-editor').focus();App.memoEditor.select(2,10);});
   await editor.dispatchEvent('contextmenu');await editor.dispatchEvent('click',{detail:1});
   check(await page.evaluate(()=>App.memoEditor.selection()?.end-App.memoEditor.selection()?.start===8),'long press selection is preserved '+width);
   // Reopening returns to the tail; layout changes keep the tail visible without stealing focus.
   await page.evaluate(()=>{window.getSelection().removeAllRanges();App.app.switchView('tasks');App.app.switchView('memo');});
   await page.waitForFunction(()=>{const e=document.querySelector('#memo-editor');return e.scrollHeight-e.clientHeight-e.scrollTop<2;});
   await editor.click({position:{x:20,y:25}});
   const caretBeforeResize=await page.evaluate(()=>App.memoEditor.selection()?.end);
   await page.setViewportSize({width,height:Math.min(height,400)});
   await page.waitForFunction(()=>{const e=document.querySelector('#memo-editor');return document.activeElement===e&&e.getBoundingClientRect().height>0;});
   check(await page.evaluate(()=>document.activeElement.id==='memo-editor'),'resizing retains editor focus '+width);
   check(await page.evaluate(()=>App.memoEditor.selection()?.end)===caretBeforeResize,'resizing preserves selected caret instead of forcing tail '+width);
   await page.setViewportSize({width,height});
   await page.evaluate(()=>{document.querySelector('#memo-editor').blur();App.memoSchedule.startRef({kind:'queue',id:'visual-clock'},Date.now()-83*60000);App.memoSchedule.tick();});
   // The float becomes expanded explicitly, independent of previous test state.
   await page.locator('[data-float-mode="full"]').click();
   const meter=page.locator('#float-meter .float-meter-track');
   check(await meter.getAttribute('role')==='img','unestimated timer is a time scale '+width);
   check(await meter.getAttribute('aria-valuenow')===null,'time scale has no false completion percent '+width);
   check(/1小时＋23分/.test(await page.locator('.float-meter-text').innerText()),'hour count survives scale rollover '+width);
   const expanded=await page.locator('#mw-live').boundingBox();
   check(Math.abs(expanded.height-height)<2&&expanded.width<=width,'full timer fits visible screen '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'memo-'+width+'.png')});}
   await page.locator('[data-float-mode="full"]').click();
   const compact=await page.locator('#mw-live').boundingBox();check(compact.height<110,'collapsed float remains compact and does not cover task controls '+width);check(await page.locator('#mw-live .float-complete').isHidden(),'collapsed float defers task shortcut until expansion '+width);await shot('compact');
   check(await page.locator('#mw-live-controls [data-schedule-command="pause"]').isVisible(),'pause accessible while collapsed '+width);
   await page.evaluate(()=>{App.store.data().queue[0].estimatedMinutes=60;App.memoSchedule.tick();});
   check(await page.locator('#mw-live').evaluate(e=>e.classList.contains('float-overtime')),'overtime remains visually distinct '+width);
   await page.locator('[data-float-mode="full"]').click();check(/超时/.test(await page.locator('.float-meter-text').innerText()),'overtime label visible '+width);
   await page.evaluate(()=>{const P=App.memoSchedule;P.stopRef({kind:'queue',id:'visual-clock'});App.app.switchView('tasks');App.memoWorkspace.showPane('today');});
   await page.evaluate(()=>App.app.switchView('checkin'));const green=page.locator('.ck-row[data-id="green"]');
   const color=await green.evaluate(e=>getComputedStyle(e).backgroundColor);
   check(color==='rgb(232, 245, 236)','points-page attainment is green '+width);await shot('green');
   check(await green.locator('xpath=ancestor::details[contains(@class,"mw-completed")]').count()===0,'attained habit remains visible '+width);
   await page.evaluate(()=>{const it=App.store.data().checkins.find(i=>i.id==='green');it.days[App.memoCore.userDay()]=3;App.checkin.render();});
   check(await green.evaluate(e=>getComputedStyle(e).backgroundColor)===color,'cap exhausted keeps green and original position '+width);
   await page.evaluate(()=>{App.store.data().checkins.find(i=>i.id==='green').days[App.memoCore.userDay()]=1;App.checkin.render();});
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
   if(width===320||width===390){
    for(const theme of ['', 'dark', 'purple']){
     for(const [offset, relation] of [[-1,'past'],[1,'future']]){
      await page.evaluate(({theme,offset})=>{
       document.body.dataset.theme=theme;
       App.memoWorkspace.setDay(App.memoCore.shiftDay(App.memoCore.userDay(),offset));
       App.memoWorkspace.editor(null,'ideal');
      },{theme,offset});
      await page.waitForSelector('.overview-heading[data-date-context="'+relation+'"]');
      check(await page.evaluate(relation=>{
       const header=document.querySelector('.overview-heading'),modal=document.querySelector('.modal');
       const background=element=>getComputedStyle(element).backgroundColor;
       const tone=background(header);
       return modal.dataset.dateContext===relation&&tone!=='rgba(0, 0, 0, 0)'&&
        tone===background(modal.querySelector('.modal-heading'))&&tone===background(modal.querySelector('.modal-date-context'));
      },relation),'task and dialog date regions share a visible '+relation+' background in '+(theme||'light')+' at '+width);
      await page.locator('.modal [data-act="cancel"]').click();
     }
    }
    await page.evaluate(()=>{document.body.dataset.theme='';});
   }
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
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.App?.app?.ready);
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
  await page.locator('.modal [data-act="cancel"]').click();
  await page.clock.setFixedTime(new Date('2026-10-29T00:35:00+08:00'));
  await page.evaluate(()=>{App.app.switchView('memo');App.memo.show('2026-10-27');});
  await page.locator('#memo-time').click();
  await page.waitForFunction(()=>App.memo.selected()==='2026-10-28'&&App.memoEditor.text().endsWith('次日0035 '));
  await context.close();
  console.log(checks+' browser interaction checks passed across five viewports and the 04:00 boundary.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
