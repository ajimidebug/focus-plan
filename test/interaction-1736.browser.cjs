/* Synthetic records only: three timeline tracks, viewport-aware float, first-screen points. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'',process.cwd()]}));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,fonts=process.env.FOCUS_TEST_FONT_DIR,base=fonts&&pathname.startsWith('/__fonts/')?fonts:root;
 const file=path.resolve(base,'.'+(base===fonts?pathname.slice('/__fonts'.length):pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,bytes)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(bytes);});
});
let checks=0;function check(ok,message){assert(ok,message);checks++;}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[320,640],[390,844],[430,850],[550,350],[1280,800]]){
   if(process.env.FOCUS_DEBUG)console.log('viewport',width);
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-30T12:30:00+08:00')});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
   await page.addStyleTag({content:'#toast-root{visibility:hidden!important}'});
   if(process.env.FOCUS_TEST_FONT_DIR){await page.addStyleTag({content:'@import url("/__fonts/400.css");body,button,input,textarea,select{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);}
   const day=await page.evaluate(async()=>{
    const S=App.store,M=App.memoCore,P=App.memoSchedule,d=S.data(),day=M.userDay(),at=t=>Date.parse(day+'T'+t+':00+08:00');
    d.queue=[];d.queueDone=[];d.daily=[];d.checkins=[];d.memoProjects=[];d.memoEvents=[];d.memoTaskGroups=[{id:'g',name:'分组测试'}];d.memoSchedule={version:1,items:[],sessions:[]};d.ledger=[];
    for(const list of ['required','ideal','extra'])S.getDay(day).tasks[list]=[];
    S.getDay(day).tasks.ideal=[{id:'timed',text:'矩阵代表题验证',points:1},{id:'plain',text:'未记录计时的完成',points:0},{id:'pending',text:'只有预计用时，没有时段',estimatedMinutes:30,points:1}];
    const ref={kind:'task',id:'timed',day,list:'ideal'};
    P.savePlan({ref,day,type:'span',start:at('11:00'),end:at('12:00'),title:'矩阵代表题验证'});
    const s=P.startRef(ref,at('11:12'));P.pauseCore(s,at('11:40'));P.startRef(ref,at('11:48'));P.stopRef(ref,at('12:08'));
    App.memoActions.completeCore({kind:'task',id:'timed',day,list:'ideal',title:'矩阵代表题验证'},'',day+'T12:10:00+08:00');
    App.memoActions.completeCore({kind:'task',id:'plain',day,list:'ideal',title:'未记录计时的完成'},'',day+'T10:40:00+08:00');
    d.queue.push({id:'unplanned',text:'已计时但未安排',estimatedMinutes:20,points:0});const q=P.startRef({kind:'queue',id:'unplanned'},at('10:45'));P.pauseCore(q,at('10:55'));
    S.getDay(day).timeline=[{id:'old',start:10*60,end:10*60+20,minutes:20,content:'旧版补记来源',auto:false,category:'study'}];
    await S.save();App.app.switchView('timeline');P.open({day,workspace:true});return day;
   });
   if(process.env.FOCUS_DEBUG)console.log('seeded',width);
   await page.locator('#schedule-range').selectOption('8');
   check(await page.locator('.schedule-plan-lane .schedule-block').count()===1,'only explicit plan occupies expected track '+width);
   check(await page.locator('.schedule-actual-lane .schedule-block').count()>=1,'execution track keeps dense records accessible '+width);
   check(await page.locator('.schedule-completion-lane .completion-marker').count()===2,'both completion instants have own track '+width);
   check(await page.locator('.schedule-actual-lane .completion-marker').count()===0,'completion never consumes execution track '+width);
   check(await page.evaluate(()=>App.memoSchedule.dayExecutionMs(App.memoCore.userDay()))===58*60000,'actual time excludes pause, plans, points and old records '+width);
   const raw=await page.evaluate(()=>JSON.stringify({s:App.store.data().memoSchedule,e:App.store.data().memoEvents,l:App.store.data().ledger}));
   for(const theme of ['default','dark']){
    await page.evaluate(t=>document.body.dataset.theme=t,theme);
    for(const view of ['combined','compare','plan','actual']){
     await page.locator('#schedule-view').selectOption(view);
     const layout=await page.evaluate(()=>{
      const chart=document.querySelector('.schedule-chart'),axis=chart.querySelector('.schedule-axis'),visible=e=>!!e.getClientRects().length;
      return {doc:document.documentElement.scrollWidth,chart:chart.clientWidth,scroll:chart.scrollWidth,
       columns:getComputedStyle(axis).gridTemplateColumns.split(/\s+/).length,
       headings:[...chart.querySelectorAll('.schedule-legend>strong')].filter(visible).map(e=>({text:e.textContent,left:e.getBoundingClientRect().left})).sort((a,b)=>a.left-b.left).map(x=>x.text),
       overflow:[...chart.querySelectorAll('.schedule-lane')].filter(visible).some(e=>e.scrollWidth>e.clientWidth+1)};
     });
     check(layout.doc<=width+1&&layout.scroll<=layout.chart+1&&!layout.overflow,'timeline has no horizontal scrolling '+width+' '+theme+' '+view+': '+JSON.stringify(layout));
     check(layout.columns===(view==='plan'?2:view==='actual'?3:4),'right number of tracks '+width+' '+view);
     check(layout.headings.join('/')===(view==='compare'?'计时/预计/完成':view==='plan'?'预计':view==='actual'?'计时/完成':'预计/计时/完成'),'headings aligned with lane order '+width+' '+view+': '+layout.headings);
    }
   }
   check(await page.evaluate(()=>JSON.stringify({s:App.store.data().memoSchedule,e:App.store.data().memoEvents,l:App.store.data().ledger}))===raw,'view and theme changes do not alter source records '+width);
   await page.evaluate(()=>document.body.dataset.theme='default');await page.locator('#schedule-view').selectOption('combined');
   await page.locator('.completion-marker').filter({hasText:'未记录计时的完成'}).click();
   check(await page.locator('[data-schedule-done]').getAttribute('open')!==null,'completion opens folded task detail '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.locator('#mw-live').evaluate(e=>e.style.visibility='hidden');await page.locator('.schedule-chart').screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1736-timeline-'+width+'.png'),animations:'disabled'});await page.locator('#mw-live').evaluate(e=>e.style.visibility='');}
   if(process.env.FOCUS_DEBUG)console.log('chart checked',width);
   // Dense groups retain exact source instants and open the original task details.
   await page.evaluate(day=>{
    for(let i=0;i<6;i++)App.store.data().memoEvents.push({id:'dense-'+i,kind:'checkin',sourceId:'dense-habit',sourceDay:day,noteDay:day,title:'密集打卡 '+i,at:day+'T12:21:0'+i+'+08:00',active:true,points:0,ledgerIds:[]});
    App.memoSchedule.render();
   },day);
   const group=page.locator('.schedule-completion-lane [data-sc="density-group"]');
   check(await group.count()===1,'nearby completions aggregate without shrinking names '+width);
   await group.click();check((await page.locator('.modal-body').innerText()).includes('密集打卡 5'),'dense popup retains every source '+width);
   await page.locator('[data-density-open]').last().click();check(await page.locator('[data-schedule-checkins]').getAttribute('open')!==null,'group links to exact checkin card '+width);
   // Entry points share a form; points must be above notes, including grouped extras.
   await page.evaluate(day=>{App.app.switchView('tasks');App.memoWorkspace.enter('today',day);},day);
   for(const list of ['required','ideal','extra']){
    await page.locator('#mw-column-'+list+' [data-mw="add-'+list+'"]').click();
    await page.locator('.modal').evaluate(e=>e.getAnimations().forEach(a=>a.finish()));
    const field=page.locator('#mw-points-field');
    check(await field.isVisible()===(list!=='required'),'required task keeps original no-individual-points rule '+width+' '+list);
    if(list!=='required'){
     const box=await page.locator('#mw-points').evaluate(e=>{const r=e.getBoundingClientRect(),b=e.closest('.modal-body').getBoundingClientRect(),note=document.querySelector('#mw-note-edit').getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyTop:b.top,bodyBottom:b.bottom,note:note.top,scroll:e.closest('.modal-body').scrollTop};});
     check(box.bottom<box.note,'points precede notes '+width+' '+list);
     if(height>=600)check(box.top>=box.bodyTop&&box.bottom<=box.bodyBottom+1&&box.scroll===0,'points usable on first screen '+width+' '+list+': '+JSON.stringify(box));
     await page.locator('#mw-list').selectOption('required');check(!await field.isVisible(),'column change hides whole points field '+width);
     await page.locator('#mw-list').selectOption('ideal');check(await page.locator('#mw-points').inputValue()==='1','untouched points follow ideal default '+width);
     await page.locator('#mw-points').fill('0');await page.locator('#mw-list').selectOption('extra');check(await page.locator('#mw-points').inputValue()==='0','manual zero survives category change '+width);
    }
    await page.locator('.modal [data-act="cancel"]').click();
   }
   await page.evaluate(()=>App.memoWorkspace.editor(null,'ideal'));await page.locator('#mw-title').fill('保存重试积分任务');await page.locator('#mw-points').fill('7');await page.locator('#mw-note-edit').fill('保留备注');
   if(width===390){await page.evaluate(()=>{window.__save=App.store.save;App.store.save=async()=>false;});await page.locator('.modal [data-act="save"]').click();await page.waitForFunction(()=>App.memoActions.busy());check(await page.locator('#mw-points').inputValue()==='7','failed save retains points');await page.evaluate(()=>App.store.save=window.__save);}
   await page.locator('.modal [data-act="save"]').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
   const saved=await page.evaluate(day=>App.store.getDay(day).tasks.ideal.filter(t=>t.text==='保存重试积分任务'),day);
   check(saved.length===1&&saved[0].points===7&&saved[0].note==='保留备注','save / retry creates one intact task '+width);
   await page.evaluate(ref=>App.memoWorkspace.editor(ref),{kind:'task',id:saved[0].id,day,list:'ideal'});check(await page.locator('#mw-points').inputValue()==='7','editing keeps explicit points '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1736-editor-'+width+'.png'),animations:'disabled'});
   await page.locator('.modal [data-act="cancel"]').click();
   if(process.env.FOCUS_DEBUG)console.log('forms checked',width);
   // Visible viewport positioning, folded/expanded stability, live overtime and keyboard bounds.
   await page.evaluate(()=>{App.memoSchedule.startRef({kind:'queue',id:'unplanned'},Date.now()-21*60000);App.memoSchedule.tick();});
   const float=page.locator('#mw-live');check(await float.isVisible(),'timer shown '+width);
   const anchor=await float.boundingBox();check(anchor.y>=0&&anchor.y+anchor.height<=height-40,'float is inside viewport '+width);
   if(height>=600)check(anchor.y>=144&&anchor.y>=height*.2,'float moved to upper middle '+width);
   await page.locator('[data-float-toggle]').click();check(Math.abs((await float.boundingBox()).y-anchor.y)<1,'expansion keeps top anchor '+width);
   check(await float.getAttribute('data-meter-state')==='overtime','existing overtime projection preserved '+width);
   const expanded=await float.boundingBox();check(expanded.y+expanded.height<=height-40,'expanded float stays above navigation '+width);
   const session=await page.evaluate(()=>App.memoSchedule.state().sessions.find(s=>s.status==='running').id);
   if(width===390){
    await page.setViewportSize({width,height:340});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));const small=await float.boundingBox();check(small.y>=0&&small.y+small.height<=300,'keyboard-height viewport keeps float reachable');
    await page.setViewportSize({width,height});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:360,offsetTop:80}});window.dispatchEvent(new Event('resize'));});
    const offset=await float.boundingBox();check(offset.y>=80&&offset.y+offset.height<=440,'visual viewport offset bounds are respected');
    await page.evaluate(()=>{delete window.visualViewport;window.dispatchEvent(new Event('resize'));});
   }
   check(await page.evaluate(id=>App.memoSchedule.state().sessions.find(s=>s.status==='running').id===id,session),'position changes never replace running session '+width);
   await page.evaluate(()=>{App.app.switchView('timeline');App.memoSchedule.open({workspace:true});window.__axis=document.querySelector('.schedule-axis');window.__liveHeight=parseFloat(document.querySelector('.schedule-actual-lane [data-live-start]').style.height);});
   if(process.env.FOCUS_DEBUG)console.log('before tick',width);
   await page.clock.runFor(1200);await page.evaluate(()=>App.memoSchedule.tick());
   check(await page.evaluate(()=>window.__axis===document.querySelector('.schedule-axis')),'tick preserves chart node and scroll '+width);
   check(await page.evaluate(()=>parseFloat(document.querySelector('.schedule-actual-lane [data-live-start]').style.height)>window.__liveHeight),'running group grows without rerender '+width);

   if(process.env.FOCUS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'1736-float-'+width+'.png'),animations:'disabled'});
   check(errors.length===0,'no browser exceptions '+width+': '+errors.join(';'));await context.close();
  }

  if(process.env.FOCUS_DEBUG)console.log('boundary');
  const boundary=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),p=await boundary.newPage();
  await p.clock.install({time:new Date('2026-10-31T04:05:01+08:00')});await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>App?.app?.ready);
  await p.evaluate(async()=>{
   const d=App.store.data(),P=App.memoSchedule;d.queue=[{id:'edge',text:'跨04点计时',points:0}];d.checkins=[];d.daily=[];d.memoSchedule={version:1,items:[],sessions:[]};d.memoEvents=[];
   const ref={kind:'queue',id:'edge'};P.savePlan({ref,day:'2026-10-30',type:'span',start:Date.parse('2026-10-31T03:50:00+08:00'),end:Date.parse('2026-10-31T04:10:00+08:00'),title:'跨日预计'});
   P.startRef(ref,Date.parse('2026-10-31T03:55:00+08:00'));
   d.memoEvents.push({id:'edge-completion',kind:'checkin',sourceId:'edge-habit',sourceDay:'2026-10-31',noteDay:'2026-10-31',at:'2026-10-31T04:00:00+08:00',active:true,title:'04点完成',points:0,ledgerIds:[]});
   await App.store.save();App.app.switchView('timeline');P.open({day:'2026-10-30',workspace:true});
  });
  await p.locator('#schedule-range').selectOption('24');
  check(await p.locator('.completion-marker').count()===0,'04:00 completion excluded from previous user day');
  check(await p.locator('.schedule-plan-lane .schedule-block').count()===1&&await p.locator('.schedule-actual-lane .schedule-block').count()===1,'cross-day expectation and execution clipped in previous day');
  check(await p.locator('#schedule-now').isHidden(),'old user day has no current-time line');
  await p.locator('#schedule-date').fill('2026-10-31');await p.locator('#schedule-date').dispatchEvent('change');
  check(await p.locator('.completion-marker').count()===1,'04:00 completion appears once in new user day');
  check(await p.locator('.schedule-plan-lane .schedule-block').count()===1&&await p.locator('.schedule-actual-lane .schedule-block').count()===1,'cross-day records continue in new day');
  const execution=await p.evaluate(()=>({old:App.memoSchedule.dayExecutionMs('2026-10-30'),next:App.memoSchedule.dayExecutionMs('2026-10-31'),ids:App.memoSchedule.state().sessions.map(s=>s.id)}));
  check(execution.old===300000&&execution.next>=301000&&execution.next<305000&&execution.ids.length===1,'04:00 display preserves one session and correct daily durations');
  await boundary.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log(checks+' timeline-track, first-screen-point and floating-viewport checks passed across five viewports.');
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
