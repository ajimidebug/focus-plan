import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', process.cwd()] }));
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };
const server = createServer((req,res)=>{
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname==='/'?'/index.html':pathname));
    if (!(file===root || file.startsWith(root+sep)) || !statSync(file).isFile()) throw new Error('unavailable');
    res.writeHead(200, { 'content-type':mime[extname(file)]||'application/octet-stream', 'cache-control':'no-store' });
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = 'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE || undefined,args:JSON.parse(process.env.FOCUS_BROWSER_ARGS || '["--no-sandbox"]')});
try {
  for (const width of [320,350,550,770,1280]) {
    const context=await browser.newContext({viewport:{width,height:width===550?350:Math.max(550,Math.round(width*.8))},serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.App?.store?.data()?.version===1 && window.App?.app?.ready===true,{timeout:15000});
    await page.evaluate(()=>{document.querySelector('#demo-overlay')?.classList.add('hidden');App.app.switchView('tasks');App.memoWorkspace.showPane('today');});
    await page.waitForSelector('#mw-today .mw-toolbar',{timeout:15000});
    const result=await page.evaluate(()=>({
      docWidth:document.documentElement.scrollWidth,
      windowWidth:window.innerWidth,
      taskView:document.querySelector('#view-tasks')?.classList.contains('active'),
      overviewVisible:!!document.querySelector('.mw-overview') && !document.querySelector('.mw-overview-fold'),
      columnCount:document.querySelector('.mw-overview .cal-cols').children.length,
      columnTemplate:getComputedStyle(document.querySelector('.mw-overview .cal-cols')).gridTemplateColumns,
      buttons:[...document.querySelectorAll('.mw-day-shortcuts button')].map(b=>({
        w:b.getBoundingClientRect().width, bg:getComputedStyle(b).backgroundColor, pressed:b.getAttribute('aria-pressed')
      })),
      shortcutWidth:document.querySelector('.mw-day-shortcuts').getBoundingClientRect().width
    }));
    assert.equal(result.taskView,true,'task view visible at '+width);
    assert.equal(result.overviewVisible,true,'three-column overview visible by default at '+width);
    assert.equal(result.columnCount,3,'three task columns at '+width);
    assert.equal(result.columnTemplate.trim().split(/\s+/).length,3,'side-by-side grid columns at '+width);
    assert.equal(result.buttons.length,3,'three date shortcuts at '+width);
    assert(Math.max(...result.buttons.map(b=>b.w))-Math.min(...result.buttons.map(b=>b.w))<2,'date shortcut widths match at '+width);
    assert(result.buttons.reduce((n,b)=>n+b.w,0)>result.shortcutWidth*.88,'date shortcuts fill toolbar at '+width);
    assert.notEqual(result.buttons[1].bg,result.buttons[0].bg,'today stands out at '+width);
    assert(result.docWidth<=result.windowWidth+8,'horizontal page overflow at '+width+': '+JSON.stringify(result));
    assert.deepEqual(errors,[],'no runtime errors at '+width);

    await page.evaluate(()=>{
      window.__testModalInjected=false;
      App.ui.openModal('<img src=x onerror="window.__testModalInjected=true">','<input id="smoke-modal-input">','<button data-act="cancel">关闭</button>',{closeIcon:true});
    });
    assert.equal(await page.locator('.modal[role="dialog"][aria-modal="true"]').count(),1);
    assert.equal(await page.locator('.modal-heading img').count(),0);
    assert.equal(await page.evaluate(()=>window.__testModalInjected),false);
    await page.keyboard.press('Tab');
    const inside=await page.evaluate(()=>document.querySelector('.modal').contains(document.activeElement));
    assert.equal(inside,true,'modal focus stays inside at '+width);
    await page.evaluate(()=>App.ui.closeModal());
    assert.equal(await page.locator('.modal').count(),0);
    if (width===350) {
      await page.evaluate(()=>App.app.switchView('checkin'));
      await page.locator('#checkin-view [data-act="ck-add"]').first().click();
      await page.locator('#ck-text').fill('负积分浏览器测试');
      await page.locator('#ck-penalty-mode').selectOption('punch');
      await page.locator('#ck-penalty-points').fill('7');
      await page.locator('.modal [data-act="ok"]').click();
      await page.waitForFunction(()=>document.querySelector('#checkin-view')?.textContent.includes('负积分浏览器测试'),{timeout:15000});
      assert.equal(await page.evaluate(()=>App.memoPenalty.policy(App.store.data().checkins.find(x=>x.text==='负积分浏览器测试'),App.memoCore.userDay()).mode),'punch');
      assert.match(await page.locator('#checkin-view').innerText(),/-7分/);
      const id=await page.evaluate(()=>App.store.data().checkins.find(x=>x.text==='负积分浏览器测试').id);
      await page.evaluate(id=>App.memoFinance.arrange(id),id);
      await page.locator('.modal [data-mode="daily"]').click();
      await page.locator('.modal [data-act="save"][data-list="required"]').click();
      await page.waitForFunction(id=>App.memoFinance.plans(App.memoCore.userDay()).some(x=>x.it.id===id && x.r.list==='required'),id);
      await page.evaluate(()=>{App.app.switchView('tasks');App.memoWorkspace.showPane('today');});
      await page.waitForSelector('.mw-overview .habit-plan-row[data-habit-kind="punch"]');
      assert.match(await page.locator('.mw-overview .habit-plan-row[data-habit-kind="punch"]').innerText(),/-7分/);
      assert.notEqual(await page.locator('.mw-overview .habit-plan-row[data-habit-kind="punch"]').evaluate(el=>getComputedStyle(el).backgroundImage),'none');
      await page.evaluate(id=>App.memoFinance.arrange(id),id);
      await page.locator('.modal [data-mode="daily"]').click();
      await page.locator('.modal [data-act="save"][data-list="ideal"]').click();
      await page.waitForFunction(id=>App.memoFinance.plans(App.memoCore.userDay()).some(x=>x.it.id===id && x.r.list==='ideal'),id);
      assert.equal(await page.evaluate(id=>App.memoFinance.plans(App.memoCore.userDay()).filter(x=>x.it.id===id).length,id),1);
      await page.waitForSelector('.mw-overview [data-overview-list="ideal"] .habit-plan-row[data-habit-kind="punch"]');
      await page.waitForFunction(()=>document.querySelectorAll('.mw-overview [data-overview-list="required"] .habit-plan-row[data-habit-kind="punch"]').length===0);
      await page.evaluate(()=>App.app.switchView('checkin'));
      await page.locator('#checkin-view [data-act="ck-add"]').first().click();
      await page.locator('#ck-text').fill('排序第二项目');
      await page.locator('.modal [data-act="ok"]').click();
      await page.waitForFunction(()=>App.store.data().checkins.some(x=>x.text==='排序第二项目'));
      await page.locator('#checkin-view [data-act="ck-info"]').filter({hasText:'排序第二项目'}).first().click();
      await page.locator('.modal [data-act="ck-up"]').click();
      await page.waitForFunction(()=>App.store.data().checkins[0]?.text==='排序第二项目');
      assert.equal(await page.evaluate(()=>App.store.data().checkins[0].text),'排序第二项目');

      // Floating timer: progress is cumulative, overrun is visible, memo remains editable.
      await page.evaluate(()=>{
        const it=App.store.data().checkins.find(x=>x.text==='负积分浏览器测试');
        it.estimatedMinutes=40;
        const day=App.memoCore.userDay();
        const session=App.memoSchedule.startRef({kind:'checkin',id:it.id,day});
        session.chunks.at(-1).start=Date.now()-26*60000;
        App.memoSchedule.tick();
      });
      await page.locator('#mw-live [data-float-toggle]').click();
      await page.waitForSelector('#mw-live #float-meter:not([hidden])');
      assert.match(await page.locator('#float-meter .float-meter-text').innerText(),/今日预计 40分钟 · 剩余/);
      assert.equal(await page.locator('#mw-live.float-overtime').count(),0);
      await page.evaluate(()=>App.app.switchView('memo'));
      const editor=page.locator('#memo-editor');
      await editor.click({position:{x:20,y:30}});
      await page.keyboard.type('focus memo under floating timer', {delay:5});
      assert.match(await editor.innerText(),/focus memo under floating timer/);
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'memo-editor');
      const focusState=await page.evaluate(()=>({
        folded:document.querySelector('#mw-live').classList.contains('float-collapsed'),
        pointer:getComputedStyle(document.querySelector('#mw-live')).pointerEvents,
        active:App.memoSchedule.state().sessions.some(s=>s.status==='running')
      }));
      assert.equal(focusState.folded,true,'memo editing temporarily compacts float');
      assert.equal(focusState.pointer,'none','floating background does not steal memo touches');
      assert.equal(focusState.active,true,'memo focus never pauses the running session');
      await page.evaluate(()=>{
        const live=App.memoSchedule.state().sessions.find(s=>s.status==='running');
        live.chunks.at(-1).start=Date.now()-52*60000;
        App.memoSchedule.tick();
      });
      assert.equal(await page.locator('#mw-live.float-overtime').count(),1);
      assert.match(await page.locator('#float-meter .float-meter-text').innerText(),/超时/);
      await page.evaluate(()=>App.app.switchView('checkin'));
      await page.waitForSelector('.memo-bank [data-finance-export]');
      const exportInfo=await page.evaluate(()=>({
        count:document.querySelectorAll('[data-finance-export]').length,
        audit:App.memoFinance.auditPayload(),
        ledger:App.store.data().ledger.reduce((n,e)=>n+(Number(e.points)||0),0)
      }));
      assert.equal(exportInfo.count>0,true,'CSV export is actually visible');
      assert.equal(exportInfo.audit.schema,'focus-plan-points-audit/v1');
      assert.equal(exportInfo.audit.balances.points,exportInfo.ledger);
      await page.locator('.memo-bank [data-finance-export]').click();
      await page.waitForSelector('#fe-text');
      assert.equal(await page.locator('.modal [data-act="csv"]').count(),1);
      await page.evaluate(()=>App.ui.closeModal());


    }
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
console.log('Chromium responsive, app startup, task navigation and accessible modal smoke tests passed.');
