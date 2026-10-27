import { chromium } from 'playwright';
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
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  for (const width of [320,350,550,770,1280]) {
    const context=await browser.newContext({viewport:{width,height:width===550?350:Math.max(550,Math.round(width*.8))},serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.App?.store?.data()?.version===1 && !!window.App?.app?.switchView,{timeout:15000});
    await page.evaluate(()=>{document.querySelector('#demo-overlay')?.classList.add('hidden');App.app.switchView('tasks');App.memoWorkspace.showPane('today');});
    await page.waitForSelector('#mw-today .mw-toolbar',{timeout:15000});
    const result=await page.evaluate(()=>({
      docWidth:document.documentElement.scrollWidth,
      windowWidth:window.innerWidth,
      taskView:document.querySelector('#view-tasks')?.classList.contains('active'),
      overviewCollapsed:!document.querySelector('.mw-overview-fold')?.open
    }));
    assert.equal(result.taskView,true,'task view visible at '+width);
    assert.equal(result.overviewCollapsed,true,'task overview collapsed by default at '+width);
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
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
console.log('Chromium responsive, app startup, task navigation and accessible modal smoke tests passed.');
