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
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-13T12:00:00+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/tasks');
  await page.waitForFunction(()=>window.App?.app?.ready&&window.App?.memoGantt?.nodes&&window.App?.memoOrganize?.openGroups);

  const day='2026-11-13';
  await page.evaluate(async()=>{App.store.getDay('2026-11-13').tasks.ideal.push({id:'retain',text:'数学复盘',points:5});await App.store.save();App.memoWorkspace.render();App.memoActions.task('ideal','retain','2026-11-13');});
  await page.locator('#ma-remark').fill('备注A');
  await page.locator('#memo-action-text').fill('说明B\n第二行');
  await page.locator('.modal [data-act="commit"]').click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>{App.app.switchView('memo');App.memo.show('2026-11-13');App.memoEditor.select(3,3);});
  await page.locator('#memo-editor').pressSequentially('段内C');
  await page.evaluate(()=>App.memo.flush());
  const before=await page.locator('#memo-editor').innerText();
  await page.evaluate(()=>App.memoActions.task('ideal','retain','2026-11-13'));
  await page.locator('.modal [data-act="commit"]').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.reload();await page.waitForFunction(()=>App?.app?.ready);await page.evaluate(()=>{App.app.switchView('memo');App.memo.show('2026-11-13');});
  assert.equal(await page.locator('#memo-editor').innerText(),before);
  assert.match(await page.evaluate(()=>App.memoCore.exportText(['2026-11-13'])),/已撤销完成/);
  assert(before.includes('备注A')&&before.includes('说明B')&&before.includes('段内C'));
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
      {id:'planned-fresh',text:'次日结束普通必做',memoPlannedDueDay:'2026-11-13',originalDay:'2026-11-13',priorityWeight:4},
      {id:'legacy-done',text:'旧版延期已完成',rolled:true,done:true}
    ];
    await App.store.save();App.memoWorkspace.setDay('2026-11-13');
  });
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    const column=page.locator('[data-overview-list="required"]');
    const ids=await column.locator(':scope > [data-overview-ref]').evaluateAll(els=>els.map(el=>JSON.parse(el.dataset.overviewRef).id));
    assert.deepEqual(ids,['legacy-low','fresh-high','planned-fresh'],'legacy overdue is first in actual three-column DOM');
    const late=column.locator('[data-overview-ref]').filter({hasText:'旧版延期低优先级'}),fresh=column.locator('[data-overview-ref]').filter({hasText:'普通高优先级'});
    assert((await late.boundingBox()).y<(await fresh.boundingBox()).y,'legacy overdue is visibly above ordinary tasks');
    assert.equal(await column.locator('[data-carried="true"]').count(),2,'legacy done remains marked inside completed fold');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  }
  await page.reload();await page.waitForFunction(()=>window.App?.app?.ready);await page.evaluate(()=>{App.app.switchView('tasks');App.memoWorkspace.setDay('2026-11-13');});
  assert.equal(await page.locator('[data-overview-list="required"] > [data-overview-ref]').first().getAttribute('data-carried'),'true');
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log('Retention, redo, persisted editing and search pagination passed');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
