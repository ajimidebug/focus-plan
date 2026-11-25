'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b)});
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-13T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');
  await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt?.nodes&&window.App?.memoOrganize?.openGroups);

  const day='2026-11-13';
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  async function checkTaskNoteCopy(completed){
   await page.evaluate(day=>{App.app.switchView('memo');App.memo.show(day);},day);
   await page.locator('#memo-copy-menu summary').click();
   await page.getByRole('button',{name:'复制全文',exact:true}).click();
   await page.waitForFunction(async done=>(await navigator.clipboard.readText()).includes((done?'✓':'○')+' 数学复盘〔'+(done?'已完成':'未完成')+'〕'),completed);
   await page.waitForFunction(()=>!App.memoActions.busy());
   await page.evaluate(()=>{
    const field=document.createElement('textarea');field.id='test-paste';field.style.position='fixed';
    document.body.append(field);field.focus();
   });
   const field=page.locator('#test-paste');await field.press('Control+v');
   const pasted=await field.inputValue();await field.evaluate(node=>node.remove());
   assert.match(pasted,/数学复盘〔[^\n]*〕\n  任务备注：复盘错因\n保留第二行/);
  }
  await page.evaluate(async()=>{App.store.getDay('2026-11-13').tasks.ideal.push({id:'retain',text:'数学复盘',points:5,note:'复盘错因\n保留第二行'});await App.store.save();App.memoWorkspace.render();});
  await checkTaskNoteCopy(false);
  await page.evaluate(()=>App.memoActions.task('ideal','retain','2026-11-13'));
  await page.locator('#ma-remark').fill('备注A');
  await page.locator('#memo-action-text').fill('说明B\n第二行');
  await page.locator('.modal [data-act="commit"]').click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await checkTaskNoteCopy(true);
  await page.evaluate(()=>{App.app.switchView('memo');App.memo.show('2026-11-13');App.memoEditor.select(3,3);});
  await page.locator('#memo-editor').pressSequentially('段内C');
  await page.evaluate(()=>App.memo.flush());
  const before=await page.locator('#memo-editor').innerText();
  await page.evaluate(()=>App.memoActions.task('ideal','retain','2026-11-13'));
  await page.locator('.modal [data-act="commit"]').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.reload();await page.waitForFunction(()=>App?.app?.ready);await page.evaluate(()=>{App.app.switchView('memo');App.memo.show('2026-11-13');});
  const after=await page.locator('#memo-editor').innerText();
  assert.doesNotMatch(after,/本次实际获得积分/);
  for(const handWritten of ['备注A','说明B','第二行','段内C'])assert(after.includes(handWritten));
  assert.doesNotMatch(await page.evaluate(()=>App.memoCore.exportText(['2026-11-13'])),/已撤销完成/);
  assert(before.includes('备注A')&&before.includes('说明B')&&before.includes('段内C'));
  await page.evaluate(()=>navigator.clipboard.writeText(''));
  await checkTaskNoteCopy(false);
  await page.evaluate(()=>App.memoActions.task('ideal','retain','2026-11-13'));
  assert.equal(await page.locator('#ma-remark').inputValue(),'备注A');assert.equal(await page.locator('#memo-action-text').inputValue(),'说明B\n第二行');
  await page.locator('.modal [data-act="commit"]').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>App.memoCore.read('2026-11-13').text.split('说明B').length-1),1);
  await page.evaluate(async()=>{for(let i=0;i<65;i++)App.store.getDay('2026-11-13').tasks.ideal.push({id:'find'+i,text:'分页任务'+i});await App.store.save();App.app.switchView('tasks');App.memoWorkspace.render();});
  await page.locator('[data-mw="search"]').first().click();await page.locator('#mw-search-text').fill('分页任务');
  assert.equal(await page.locator('[data-search-key]').count(),60);await page.locator('#mw-search-more').click();assert.equal(await page.locator('[data-search-key]').count(),65);
  await page.locator('[data-search-id="find64"]').click();assert.equal(await page.locator('#mw-title').inputValue(),'分页任务64');await page.getByRole('button',{name:'返回检索',exact:true}).click();assert.equal(await page.locator('[data-search-key]').count(),65);
  await page.locator('.modal [data-act="cancel"]').click();
  await page.evaluate(async()=>{
    App.store.getDay('2026-11-13').tasks.required=[
      {id:'fresh-high',text:'普通高优先级',priorityWeight:5},
      {id:'legacy-low',text:'旧版延期低优先级',rolled:true,priorityWeight:1},
      {id:'current-late',text:'当前延期必做',memoAutoCarry:{kind:'required',origin:'2026-11-12'},priorityWeight:2},
      {id:'planned-fresh',text:'次日结束普通必做',memoPlannedDueDay:'2026-11-13',originalDay:'2026-11-13',priorityWeight:4},
      {id:'legacy-done',text:'旧版延期已完成',rolled:true,done:true}
    ];
    await App.store.save();App.memoWorkspace.setDay('2026-11-13');
  });
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    const column=page.locator('[data-overview-list="required"]');
    const ids=await column.locator('[data-overview-ref]:not(.done)').evaluateAll(els=>els.map(el=>JSON.parse(el.dataset.overviewRef).id));
    assert.deepEqual(ids,['current-late','legacy-low','fresh-high','planned-fresh'],'legacy overdue is first in actual three-column DOM');
    assert.equal(await column.locator('.mw-late-section').isVisible(),true);
    const late=column.locator('[data-overview-ref]').filter({hasText:'旧版延期低优先级'}),fresh=column.locator('[data-overview-ref]').filter({hasText:'普通高优先级'});
    assert((await late.boundingBox()).y<(await fresh.boundingBox()).y,'legacy overdue is visibly above ordinary tasks');
    assert.equal(await column.locator('[data-carried="true"]').count(),3,'legacy done remains marked inside completed fold');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  }
  await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);await page.evaluate(()=>{App.app.switchView('tasks');App.memoWorkspace.setDay('2026-11-13');});
  assert.equal(await page.locator('[data-overview-list="required"] [data-overview-ref]:not(.done)').first().getAttribute('data-carried'),'true');
  await page.evaluate(async()=>{
    App.store.getDay('2026-11-13').tasks.ideal.push({id:'ideal-late',text:'逾期理想',points:1});
    App.store.getDay('2026-11-14').tasks.ideal.push({id:'ideal-fresh',text:'当日理想',points:5});
    await App.store.save();
  });
  await page.clock.setSystemTime(new Date('2026-11-14T04:00:01+08:00'));
  await page.evaluate(async()=>{
    await App.memoFlow.settle();
    App.memoWorkspace.setDay('2026-11-14');
  });
  const ideal=page.locator('.framework-overview [data-overview-list="ideal"]');
  const delayed=ideal.locator('.mw-late-section').getByRole('button',{name:/打开任务：逾期理想/});
  assert.equal(await delayed.getAttribute('data-carried'),'true');
  const freshIdeal=ideal.getByRole('button',{name:/打开任务：当日理想/});
  assert((await delayed.boundingBox()).y<(await freshIdeal.boundingBox()).y);
  const overdueBar=ideal.locator('[data-progress-state="deferred"]');
  const overdueBefore=await overdueBar.evaluate(el=>parseFloat(el.style.width));
  await delayed.click();
  await page.getByRole('button',{name:'调整安排',exact:true}).click();
  assert.match(await page.locator('.modal-date-context').innerText(),/今天/);
  await page.locator('.modal [data-act="pick"][data-list="ideal"]').click();
  await page.locator('.task-action-modal [data-act="cancel"]').click();
  const rescheduled=ideal.getByRole('button',{name:/打开任务：逾期理想/});
  assert.equal(await rescheduled.getAttribute('data-carried'),'false');
  assert.equal(await delayed.count(),0);
  assert((await overdueBar.evaluate(el=>parseFloat(el.style.width)))<overdueBefore);
  await page.evaluate(()=>App.memoWorkspace.setDay('2026-11-13'));
  const history=ideal.locator('.mw-history-section');
  await history.locator('summary').first().click();
  const original=history.locator('[data-deferred-source]').filter({hasText:'逾期理想'});
  assert.match(await original.innerText(),/已顺延至2026-11-14/);
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log('Retention, redo, persisted editing and search pagination passed');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
