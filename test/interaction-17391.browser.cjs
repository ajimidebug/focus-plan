/* Synthetic records: four ordered progress segments and two-row action footer. */
'use strict';
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 for(const width of [320,360,390,430,1280]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-30T12:00:00+08:00'));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
  await page.evaluate(async()=>{const S=App.store,M=App.memoCore,day=M.userDay(),old=M.shiftDay(day,-1);for(const list of ['required','ideal','extra'])S.getDay(day).tasks[list]=[{id:list+'-late-done',text:list+'延期完成',done:true,originalDay:old,points:1},{id:list+'-done',text:list+'当日完成',done:true,points:1},{id:list+'-pending',text:list+'普通未完成',points:1},{id:list+'-late',text:list+'延期未完成',originalDay:old,points:1}];await S.save();App.app.switchView('tasks');App.memoWorkspace.enter('today',day);});
  for(const theme of ['default','dark']){
   await page.evaluate(t=>document.body.dataset.theme=t,theme);const grays=[];
   for(const list of ['required','ideal','extra']){
    const q=await page.locator('#mw-today [data-overview-list="'+list+'"] .mw-column-meter').evaluate(e=>({box:e.getBoundingClientRect().toJSON(),parts:[...e.children].map(c=>({state:c.dataset.progressState,width:c.getBoundingClientRect().width,left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right,color:getComputedStyle(c).backgroundColor}))}));
    check(q.parts.map(x=>x.state).join(',')==='late-done,done,pending,deferred','four fixed states '+width+' '+theme+' '+list);
    check(q.parts.every((x,i)=>Math.abs(x.width-q.box.width/4)<1&&Math.abs(x.left-(q.box.left+q.box.width*i/4))<1),'equal quarter segments in the right order '+width+' '+list);
    check(Math.abs(q.parts[3].right-q.box.right)<1,'pending deferral anchored at right '+width+' '+list);grays.push(q.parts[3].color);
    const sum=c=>c.match(/[\d.]+/g).slice(0,3).reduce((n,v)=>n+Number(v),0)*(c.startsWith('color(srgb')?255:1);check(sum(q.parts[0].color)<sum(q.parts[1].color),'late completion darker in its own category '+width+' '+list);
   }
   check(grays.every(x=>x==='rgb(217, 221, 225)'),'same light gray in all categories '+width+' '+theme);
  }
  await page.locator('#mw-today [data-overview-ref]').filter({hasText:'ideal延期未完成'}).click();
  const geometry=()=>page.locator('.task-action-modal').evaluate(e=>{const primary=[...e.querySelector('.ma-primary').children].filter(x=>!x.hidden),secondary=[...e.querySelector('.ma-secondary').children];return {primary:primary.map(x=>({top:x.getBoundingClientRect().top,bottom:x.getBoundingClientRect().bottom,height:x.getBoundingClientRect().height,text:x.textContent})),secondary:secondary.map(x=>({top:x.getBoundingClientRect().top,height:x.getBoundingClientRect().height,text:x.textContent})),cancelColor:getComputedStyle(e.querySelector('[data-act="cancel"]')).borderTopColor,req:getComputedStyle(e).getPropertyValue('--req').trim(),bodyWidth:e.querySelector('.modal-body').scrollWidth,clientWidth:e.querySelector('.modal-body').clientWidth};});
  // Keep Date deterministic while real timers, animations and viewport events continue.
  await page.waitForTimeout(1500);await page.locator('.task-action-modal').evaluate(e=>Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished)));let g=await geometry();
  check(g.primary.length===2&&Math.abs(g.primary[0].top-g.primary[1].top)<1&&g.primary.every(x=>x.height>=44),'primary controls share a row '+width+': '+JSON.stringify(g));
  check(g.primary[1].text==='确认完成','short confirmation label survives date tick '+width);
  check(g.secondary.map(x=>x.text).join('|')==='保存修改|编辑任务|调整安排|取消','secondary order '+width);
  check(g.secondary.every(x=>Math.abs(x.top-g.secondary[0].top)<1&&x.height>=44),'all four secondary controls share a row '+width);
  check(g.cancelColor==='rgb(226, 84, 93)','cancel has red border '+width);check(g.bodyWidth<=g.clientWidth+1,'dialog content fits '+width);
  check((await page.locator('.modal-date-context').innerText()).includes('2026-10-30'),'date context retained '+width);
  await page.locator('#ma-remark').fill('四段进度验收');await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('暂停计时')&&!document.querySelector('#ma-timer').disabled);
  g=await geometry();check(Math.abs(g.primary[0].top-g.primary[1].top)<1&&g.primary[0].text.includes('暂停'),'running state stays in primary row '+width);
  await page.locator('#ma-timer').click();await page.waitForFunction(()=>document.querySelector('#ma-timer')?.textContent.includes('继续计时')&&!document.querySelector('#ma-timer').disabled);
  if(width===320){await page.setViewportSize({width,height:350});await page.waitForFunction(()=>document.querySelector('.modal-mask')?.style.height==='350px');g=await geometry();check(g.primary.every(x=>x.bottom<=350)&&g.secondary.every(x=>x.top>=g.primary[0].bottom),'both rows reachable in short viewport: '+JSON.stringify(g));await page.setViewportSize({width,height:844});}
  await page.locator('.modal [data-act="commit"]').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  let values=await page.evaluate(()=>App.memoFinance.column(App.memoCore.userDay(),'ideal').segments.map(x=>x.count));check(values.join(',')==='2,1,1,0','completion moves the right gray segment to the far-left deep segment '+width);
  await page.evaluate(async()=>{const e=App.store.data().memoEvents.find(e=>e.active&&e.sourceId==='ideal-late');App.memoActions.undoCore(e.id);await App.store.save();App.memoWorkspace.render();});
  values=await page.evaluate(()=>App.memoFinance.column(App.memoCore.userDay(),'ideal').segments.map(x=>x.count));check(values.join(',')==='1,1,1,1','undo restores rightmost pending deferral '+width);
  await page.reload();await page.waitForFunction(()=>App?.app?.ready);await page.evaluate(()=>App.app.switchView('tasks'));check(await page.locator('#mw-today [data-overview-list="ideal"] .mw-column-meter>[data-progress-state="deferred"]').evaluate(e=>parseFloat(e.style.width)===25),'four-segment projection survives reload '+width);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'root width remains bounded '+width);check(errors.length===0,'no runtime errors '+width+': '+errors.join(';'));await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}console.log(checks+' 173.9.1 progress and action-layout checks passed.');})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
