'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b)})});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-05T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');
  await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt?.quick&&window.App?.memoTransfer?.preview);
  const inspect=await page.evaluate(async()=>{
   const A=App,S=A.store,d=S.data(),day='2026-11-05',prev='2026-11-03';
   d.checkins.push({id:'habit-continuing',text:'重置！',target:1,rewardLimit:99,points:2,days:{[day]:1}});
   d.memoHabitPlans=(d.memoHabitPlans||[]).concat({id:'plan-1750',habitId:'habit-continuing',mode:'once',from:day,list:'required',target:1});
   S.getDay(day).tasks.required.push({id:'normal-1750',text:'正常任务',done:false});
   S.getDay(day).tasks.required.push({id:'moved-1750',text:'跨日任务',done:false,originalDay:prev});
   S.getDay(prev).tasks.required.push({id:'moved-1750',text:'跨日任务',done:false,memoMovedTo:{kind:'task',id:'moved-1750',day,list:'required'},memoDeferred:{version:1,toDay:day}});
   d.memoTaskGroups=[{id:'g-study',name:'考研'},{id:'g-life',name:'生活'}];
   d.memoProjects=[
    {id:'p-one',text:'项目一',days:{},memoGroup:'g-study',memoGanttStart:'2026-11-01',memoGanttEnd:'2026-11-10'},
    {id:'p-two',text:'项目二',days:{},memoGroup:'g-study',memoGanttStart:'2026-11-11',memoGanttEnd:'2026-12-01',memoGanttDependencies:['p-one']},
    {id:'p-three',text:'项目三',days:{},memoGroup:'g-life',memoGanttStart:'2026-11-03',memoGanttEnd:'2026-11-20'}];
   A.memoWorkspace.render();
   return {total:A.memoFinance.column(day,'required',true).total,done:A.memoFinance.column(day,'required',true).done,model:A.memoGantt.model(),habitCount:A.memoFinance.plans(day).length};
  });
  assert(inspect.total>=3&&inspect.done>=1,'goal complete habit counted once');
  assert.equal(await page.locator('.framework-overview .overview-habit').filter({hasText:'重置！'}).count(),1,'continuing habit stays visible');
  assert.equal(await page.locator('.framework-overview .mw-late-section').first().count(),1,'moved active task rendered as late');
  assert.equal(await page.locator('.framework-overview .mw-completed .overview-habit').filter({hasText:'重置！'}).count(),0,'continuing habit not folded');
  assert.equal(await page.locator('.memo-gantt .gantt-group').count(),3,'one-off tasks appear in ungrouped Gantt');
  assert.equal(await page.locator('.memo-gantt .gantt-group[data-gantt-group=""]').evaluate(el=>el.open),false,'ungrouped defaults collapsed');
  await page.locator('[data-gantt-filter-select]').selectOption('g-study');
  assert.equal(await page.locator('.memo-gantt [data-gantt-row]').count(),2,'category filter returns only study projects');
  await page.locator('[data-gantt-quick="project:p-two"]').click();
  await page.evaluate(()=>{document.querySelector('#gq-end').value='2026-12-05'});
  await page.locator('#gq-achieved').check();
  await page.locator('#gq-group').selectOption('g-life');
  await page.locator('[data-act="save"]').last().click();
  const editState=await page.evaluate(()=>({end:App.store.data().memoProjects.find(x=>x.id==='p-two')?.memoGanttEnd,error:document.querySelector('#gq-error')?.textContent||'',modal:document.querySelector('.modal')?.innerText?.slice(-500)||'',busy:App.memoActions.busy()}));
  assert.equal(editState.end,'2026-12-05','quick Gantt edit saved: '+JSON.stringify(editState));
  assert.equal(await page.evaluate(()=>App.store.data().memoProjects.find(x=>x.id==='p-two').memoGroup),'g-life');
  await page.evaluate(()=>App.memoWorkspace.setDay('2026-11-03'));
  assert.equal(await page.locator('.framework-overview .mw-history-section').count(),1,'original day historical copy is folded');
  await page.locator('.framework-overview .mw-history-section > summary').click();
  const hist=await page.locator('.mw-history-section').innerText();
  assert(hist.includes('已改期至'),'changed date must not claim backfill');
  const mapped=await page.evaluate(()=>{
   const A=App,d=A.store.data();
   const exported=A.memoTransfer.exportData(['projects']);
   d.memoProjects=[];d.memoTaskGroups=[];
   const data=A.memoTransfer.parse(JSON.stringify(exported));
   const plan=A.memoTransfer.preview(data,['projects']);
   A.memoTransfer.applyCore(plan);
   const all=d.memoProjects,source=all.find(p=>p.text==='项目一'),target=all.find(p=>p.text==='项目二');
   const cycle=(()=>{try{A.memoGantt.validate(source,'2026-11-01','2026-11-10',[target.id]);return false}catch(e){return /循环/.test(e.message)}})();
   return {count:all.length,sourceId:source?.id,targetDependency:target?.memoGanttDependencies?.[0],categories:d.memoTaskGroups.length,cycle};
  });
  assert.equal(mapped.count,3);assert.equal(mapped.targetDependency,mapped.sourceId,'dependency remapped to new ID');
  assert.equal(mapped.categories,2,'project categories restored');
  assert(mapped.cycle,'dependency cycles still rejected');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=1,'no page-level horizontal overflow: '+overflow);
  assert.deepEqual(errors,[],'browser page errors');
  console.log('175.0 habits, historical copies, categorized editable Gantt, dependency remapping passed');
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
