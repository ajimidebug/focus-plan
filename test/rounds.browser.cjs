'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/html');res.end(body);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-16T12:00:00+08:00'));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');await page.waitForFunction(()=>window.App?.app?.ready);
  async function range(start,end){
   const details=page.locator('.modal .gantt-calendar-details');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();
   const days=details.locator('.q-date__calendar-item--in .q-btn');
   await days.filter({hasText:new RegExp('^'+start+'$')}).click();await days.filter({hasText:new RegExp('^'+end+'$')}).click();
  }
  async function save(){await page.locator('.modal [data-act=save]').click();await page.locator('.modal').waitFor({state:'detached'});}
  const selectedDate=page.locator('.overview-heading time');
  const roundPosition=page.locator('.three-round-position');
  const pickDay=async(day)=>{
   await page.getByRole('button',{name:'日历',exact:true}).click();
   await page.getByRole('button',{name:'查看2026-11-'+day+'任务',exact:true}).press('Enter');
  };
  const adjustRound=()=>page.getByRole('button',{name:'调整日期',exact:true}).click();
  await page.getByRole('button',{name:'明天',exact:true}).click();
  assert.equal(await roundPosition.innerText(),'第2/3天');
  await pickDay(18);
  assert.equal(await roundPosition.innerText(),'第3/3天');
  assert.equal(await page.locator('.overview-heading input[type=date]').count(),0);
  await page.getByRole('group',{name:'任务日期'}).getByRole('button',{name:'今天',exact:true}).click();
  await adjustRound();await range(16,20);assert.equal(await page.locator('#round-end').inputValue(),'2026-11-20');await save();
  await page.getByRole('button',{name:'添加轮次任务',exact:true}).click();await page.locator('#mw-title').fill('弹性轮次任务');await page.locator('#mw-note-edit').fill('轮次原备注');await save();
  await page.getByRole('button',{name:'日历',exact:true}).click();
  await page.locator('.task-date-calendar .calendar-round-start[data-date="2026-11-21"]').waitFor();
  await page.getByRole('button',{name:'查看2026-11-21任务'}).press('Enter');
  assert.equal(await selectedDate.getAttribute('datetime'),'2026-11-21');
  for(const title of ['下一轮数学','下一轮专业课']){
   await page.getByRole('button',{name:'添加轮次任务',exact:true}).click();
   assert.equal(await page.locator('#mw-three-round').count(),0);
   assert.equal(await page.locator('[data-act=save-start]').isVisible(),false);
   await page.locator('#mw-title').fill(title);await save();
  }
  assert.equal(await page.evaluate(()=>App.memoThree.state().tasks.filter(t=>t.roundIndex===1).length),2);
  await page.getByRole('button',{name:/打开任务：下一轮数学/}).click();
  assert.equal(await page.locator('#mw-three-round').inputValue(),'2026-11-21');
  await page.locator('#mw-note-edit').fill('预排备注');await save();
  await pickDay(24);
  await page.getByRole('button',{name:'添加轮次任务',exact:true}).click();
  await page.locator('#mw-title').fill('第三轮预排');await save();
  await pickDay(16);
  await page.evaluate(async()=>{
   const day=App.memoCore.userDay();await App.memoActions.commit(()=>{App.store.getDay(day).tasks.ideal.push({id:'linked-round',text:'截止归入测试',note:'甘特原备注',points:4,memoGanttEnd:'2026-11-19'});});App.memoWorkspace.render();
  });
  let row=page.locator('[data-round-key="once:linked-round"]');assert(await row.isVisible());
  await row.getByRole('button',{name:/打开任务/}).click();await page.locator('#ma-remark').fill('共享完成备注');await page.locator('.modal [data-act=commit]').click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.store.getDay(App.memoCore.userDay()).tasks.ideal.find(t=>t.id==='linked-round').done),true);
  await row.locator('xpath=ancestor::details[contains(@class, "mw-completed")]').locator('summary').click();
  await row.getByRole('button',{name:/打开任务/}).click();await page.getByRole('button',{name:'确认取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.store.getDay(App.memoCore.userDay()).tasks.ideal.find(t=>t.id==='linked-round').note),'甘特原备注');
  await page.evaluate(()=>App.memoGantt.quick('once:linked-round'));
  assert.equal(await page.getByRole('button',{name:'安排到轮次',exact:true}).count(),0);
  await page.locator('.modal [data-act=cancel]').click();
  await page.evaluate(async()=>{
   const day=App.memoCore.userDay();
   await App.memoActions.commit(()=>App.memoThree.assignCore({kind:'task',id:'linked-round',day,list:'ideal'},1));
   App.memoWorkspace.render();
  });
  await pickDay(21);assert(await row.isVisible());
  assert.match(await row.innerText(),/手动安排/);
  assert.match(await row.innerText(),/截止日位于轮次外/);
  assert.equal(await page.getByRole('button',{name:'安排轮次',exact:true}).count(),0);
  await row.getByRole('button',{name:/打开任务/}).click();
  await page.getByRole('button',{name:'完成任务',exact:true}).waitFor();
  await page.getByLabel('恢复按截止日关联轮次').check();await save();
  await pickDay(16);assert(await row.isVisible());
  const native=page.getByRole('button',{name:/打开任务：弹性轮次任务/});
  await native.click();await page.getByRole('button',{name:'加入队列'}).click();
  await page.getByRole('button',{name:'已入队'}).waitFor();await page.locator('.modal [data-act=cancel]').click();
  await native.click();
  await page.locator('#ma-timer').click();
  await page.locator('.modal').waitFor({state:'detached'});await native.click();
  await page.clock.setFixedTime(new Date('2026-11-16T12:02:00+08:00'));
  await page.locator('#ma-remark').fill('轮次完成备注');
  await page.locator('.modal [data-act=commit]').click();await page.locator('.modal').waitFor({state:'detached'});
  const finished=page.locator('.three-day-column .mw-completed summary');
  await finished.click();await native.click();
  await page.getByRole('button',{name:'确认取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
  const retained=await page.evaluate(()=>{
   const task=App.memoThree.state().tasks.find(t=>t.text==='弹性轮次任务');
   const event=App.store.data().memoEvents.find(e=>e.kind==='three'&&e.sourceId===task.id);
   return {done:task.done,note:task.note,remark:event.remark,active:event.active,timing:!!event.timing};
  });
  assert.deepEqual(retained,{done:false,note:'轮次原备注',remark:'轮次完成备注',active:false,timing:true});
  await page.evaluate(async()=>{await App.memoActions.commit(()=>App.memoSchedule.startRef({kind:'three',id:App.memoThree.state().tasks[0].id,list:'three'}));});
  await adjustRound();await page.getByRole('button',{name:'提前结束本轮',exact:true}).click();await page.getByRole('button',{name:'确认提前结束',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>App.memoThree.byIndex(0).end),'2026-11-16');assert.equal(await page.evaluate(()=>App.memoThree.byIndex(0).originalEnd),'2026-11-20');assert.equal(await page.evaluate(()=>App.memoSchedule.state().sessions.at(-1).status),'paused');
  assert.equal(await selectedDate.getAttribute('datetime'),'2026-11-17');
  assert.equal(await roundPosition.innerText(),'第1/3天');
  assert.deepEqual(await page.evaluate(()=>App.memoThree.rounds().map(r=>[r.start,r.end])),
    [['2026-11-16','2026-11-16'],['2026-11-17','2026-11-19'],['2026-11-20','2026-11-22']]);
  await pickDay(20);assert(await page.getByRole('button',{name:/打开任务：第三轮预排/}).isVisible());
  await adjustRound();await range(17,18);
  await page.locator('.modal [data-act=save]').click();assert.match(await page.locator('#round-error').innerText(),/重叠/);await page.locator('.modal [data-act=cancel]').click();
  await page.clock.setFixedTime(new Date('2026-11-17T12:00:00+08:00'));await page.evaluate(()=>App.memoWorkspace.returnToday());
  const text=await page.evaluate(()=>App.memoFlow.copyQuote(App.memoCore.userDay()).text);assert.match(text,/轮次计划/);assert.match(text,/甘特原备注/);assert.match(text,/未完成/);
  // Exercise the actual copy control, including an asynchronous save and a denied clipboard.
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.evaluate(async()=>{
   const day=App.memoCore.userDay();
   await App.memoActions.commit(()=>{
    for(let i=1;i<=30;i++)App.store.getDay(App.memoCore.shiftDay(day,-i)).tasks.ideal.push({id:'copy-history-'+i,text:'历史安排 '+i});
    App.memoCore.write(day,'轮次复制原文');
   });
   App.app.switchView('memo');App.memo.show(day);
   const model=App.memoGantt.model;
   window.copyPlanBuilds=0;
   App.memoGantt.model=(...args)=>{window.copyPlanBuilds++;return model(...args);};
  });
  async function clickCopy(){
   await page.locator('#memo-copy-menu summary').click();
   await page.getByRole('button',{name:'复制全文',exact:true}).click();
  }
  await clickCopy();
  await page.waitForFunction(()=>App.memoFlow.state().lastCopy?.text.includes('轮次复制原文'));
  const pasted=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(pasted,/^请逐项回应/);assert.equal(pasted.split('请逐项回应').length,2);
  assert.match(pasted,/轮次复制原文/);
  assert.match(pasted,/甘特原备注/);
  assert.equal(await page.evaluate(()=>window.copyPlanBuilds),1);
  await page.waitForFunction(()=>!App.memoActions.busy());
  const before=await page.evaluate(()=>App.memoFlow.state().lastCopy.at);
  await page.evaluate(()=>{
   const real=navigator.clipboard;
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    write:()=>Promise.reject(new Error('blocked')),
    writeText:text=>real.writeText(text),
    readText:()=>real.readText()
   }});
  });
  await page.clock.setFixedTime(new Date('2026-11-17T12:01:00+08:00'));
  await clickCopy();
  const fallback=page.locator('#memo-copy-fallback');
  await fallback.waitFor();
  assert.match(await fallback.inputValue(),/甘特原备注/);
  assert.equal(await page.evaluate(()=>App.memoFlow.state().lastCopy.at),before);
  await page.getByRole('button',{name:'重新复制',exact:true}).click();
  await page.waitForFunction(id=>App.memoFlow.state().lastCopy.at!==id,before);
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/轮次复制原文/);
  await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);assert.equal(await page.evaluate(()=>App.memoThree.byIndex(1).start),'2026-11-17');
  fs.mkdirSync('test-results',{recursive:true});
  for(const [width,height] of [[320,640],[390,844],[550,350]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>{App.app.switchView('tasks');App.memoWorkspace.returnToday();});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
   assert(await page.locator('.mw-date-header > button').evaluateAll(buttons=>{
    const bounds=buttons.map(button=>button.getBoundingClientRect());
    return bounds.length===4&&bounds.every(b=>b.width>=44&&Math.abs(b.width-bounds[0].width)<1&&b.top===bounds[0].top);
   }),'four date buttons have equal widths and stay on one row at '+width);
   assert(await page.locator('.three-round-header').evaluate(header=>{
    const bounds=header.getBoundingClientRect();
    const children=[...header.querySelectorAll('.cal-col-head > span,.three-round-position,.three-round-controls > button')];
    return bounds.height<=62&&children.every(child=>child.getBoundingClientRect().right<=bounds.right+1);
   }),'round title and controls fit in two lines at '+width);
   await page.locator('.three-day-column').screenshot({path:'test-results/round-plan-'+width+'.png'});
   await page.evaluate(async()=>{const day=App.memoCore.userDay();App.memoCore.write(day,Array.from({length:100},(_,i)=>'第'+i+'行长笔记，用于末尾定位验证').join('\n'));await App.store.save();App.memo.show(day);window.scrollTo(0,document.body.scrollHeight);App.app.switchView('memo');});
   await page.waitForFunction(()=>{const root=document.querySelector('#memo-editor'),range=document.createRange();range.selectNodeContents(root);range.collapse(false);const rect=range.getClientRects()[0]||root.getBoundingClientRect(),nav=document.querySelector('.app-bottom-nav').getBoundingClientRect();return root.scrollHeight-root.clientHeight-root.scrollTop<3&&rect.bottom<=nav.top&&rect.top>=0;});
   assert.equal(await page.evaluate(()=>document.activeElement?.id==='memo-editor'),false);
   await page.evaluate(()=>{document.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));document.querySelector('#memo-editor').scrollTop=0;});await page.waitForTimeout(100);assert.equal(await page.locator('#memo-editor').evaluate(e=>e.scrollTop),0);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{
   const day=App.memoCore.userDay();
   await App.memoActions.commit(()=>{
    App.memoWorkspace.clearExecCore();
    App.store.getDay(day).tasks.required=Array.from({length:5},(_,i)=>({id:'priority-'+(i+1),text:'等级测试 '+(i+1),priorityWeight:i+1}));
   });
   App.app.switchView('tasks');App.memoWorkspace.setDay(day);
  });
  async function checkColors(cards){
   const styles=await cards.evaluateAll(elements=>elements.map(el=>({
    rail:getComputedStyle(el).borderLeftColor,
    label:getComputedStyle(el.querySelector('.mw-priority-note')).color
   })));
   assert.equal(new Set(styles.map(x=>x.rail)).size,5);
   assert(styles.every(x=>x.label===x.rail),'priority text and rail use the same color');
  }
  const cards=page.locator('.framework-overview .overview-task[data-category="required"]');
  await checkColors(cards);
  await page.evaluate(()=>document.body.dataset.theme='dark');
  await checkColors(cards);
  await page.evaluate(()=>{delete document.body.dataset.theme;App.memoWorkspace.showPane('details');});
  await checkColors(page.locator('#mw-details .mw-task[data-category="required"]'));
  await page.evaluate(()=>App.memoWorkspace.returnToday());
  const celebration=page.locator('.required-completion');
  const requiredTask=(priority)=>page.getByRole('button',{name:new RegExp('打开任务：等级测试 '+priority+'，')});
  async function finishRequired(){
   const bonus=page.locator('.modal input[data-reward=base]');
   if(await bonus.count())await bonus.uncheck();
   const perfect=page.locator('.modal input[data-reward=perfect]');
   if(await perfect.count())await perfect.uncheck();
   await page.locator('.modal [data-act=commit]').click();
   await page.locator('.modal').waitFor({state:'detached'});
  }
  await requiredTask(1).click();await finishRequired();
  assert.equal(await celebration.count(),0,'incomplete required group does not animate');
  await page.evaluate(async()=>{
   const day=App.memoCore.userDay();
   await App.memoActions.commit(()=>{
    App.store.getDay(day).tasks.required.slice(1,4).forEach(t=>t.done=true);
   });
   await App.memoWorkspace.execAdd({kind:'task',id:'priority-5',day,list:'required'});
  });
  await page.locator('.mw-exec-item [data-schedule-command=start]').click();
  await page.locator('#mw-live [data-float-toggle]').click();
  await page.locator('[data-float-complete]').click();await finishRequired();
  await celebration.waitFor({state:'visible'});
  assert.match(await celebration.innerText(),/今日必做已完成/);
  assert.equal(await page.evaluate(()=>App.store.data().ledger.filter(x=>x.type==='reward-base').length),0);
  await celebration.waitFor({state:'detached'});
  await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);
  assert.equal(await celebration.count(),0,'already-finished groups do not replay on page load');
  await page.evaluate(()=>{App.app.switchView('tasks');App.memoWorkspace.returnToday();});
  const completed=page.locator('[data-overview-list=required] .mw-completed');
  if(!await completed.evaluate(el=>el.open))await completed.locator('summary').click();
  await requiredTask(5).click();
  await page.getByRole('button',{name:'确认取消',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await celebration.count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await requiredTask(5).click();await finishRequired();await celebration.waitFor({state:'visible'});
  assert.equal(await celebration.evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.deepEqual(errors,[]);console.log('Rounds, four-button layout, priority colors, and saved completion feedback passed');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
