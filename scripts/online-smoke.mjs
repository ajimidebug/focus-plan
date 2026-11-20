import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=new URL(process.env.SITE_URL);assert.equal(base.protocol,'https:');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.App?.app?.ready);
 const release=await page.evaluate(async()=>{const r=await fetch('version.json?verify='+Date.now(),{cache:'no-store'});return {server:await r.json(),page:window.__RELEASE};});
 assert.equal(release.server.sourceCommit,process.env.EXPECTED_SHA);assert.equal(release.page,release.server.id);
 if(process.env.CHECK_TASK_OVERVIEW==='1'){
  await page.evaluate(()=>{
   const day=App.memoCore.userDay();
   App.store.getDay(day).tasks.required=Array.from({length:5},(_,i)=>({id:'online-priority-'+i,text:'等级验收 '+(i+1),priorityWeight:i+1}));
   App.app.switchView('tasks');App.memoWorkspace.setDay(day);
  });
  const toolbar=page.locator('.framework-overview .mw-date-header');
  await toolbar.waitFor();
  assert.deepEqual(await toolbar.locator('button').allTextContents(),['昨天','今天','明天','日历']);
  assert.equal(await page.locator('.three-round-header .three-round-position').isVisible(),true);
  const colors=await page.locator('.framework-overview .overview-task[data-category="required"]').evaluateAll(cards=>cards.map(card=>getComputedStyle(card).borderLeftColor));
  assert.equal(new Set(colors).size,5);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.getByRole('button',{name:'概览：添加必须任务',exact:true}).click();
  const priorities=page.getByRole('group',{name:'必做优先级'});
  const choices=priorities.getByRole('radio');
  assert.deepEqual(await choices.evaluateAll(inputs=>inputs.map(input=>input.value)),['1','2','3','4','5']);
  assert(await choices.nth(1).isChecked());
  await choices.nth(3).check();
  assert(await choices.nth(3).isChecked());
 }
 assert.deepEqual(errors,[]);await context.close();console.log('Isolated online startup verified. Existing user sessions were not accessed.');
}finally{await browser.close();}
