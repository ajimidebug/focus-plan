'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(process.env.FOCUS_TEST_ROOT||'dist/spa');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/html');res.end(b);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Asia/Shanghai'}),base='http://127.0.0.1:'+server.address().port;
  const p=await context.newPage();await p.goto(base);await p.waitForFunction(()=>window.App?.app?.ready&&App.safeHTML);
  // Storage tests use the real IndexedDB API with two independent pages and
  // forced localStorage quota failure. Respect recovery.html's script CSP.
  await p.evaluate(()=>App.store.flush());
  const isolated=await browser.newContext({serviceWorkers:'block'}),a=await isolated.newPage(),b=await isolated.newPage();
  for(const page of [a,b]){
   await page.goto(base+'/recovery.html');
   await page.addScriptTag({url:base+'/rollback/173.9.1/js/store.js'});
   await page.evaluate(()=>App.store.load());
  }
  for(const page of [a,b])await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='focusPlanData.v1')throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v);};});
  const resultA=await a.evaluate(async()=>{App.store.data().queue.push({id:'a',text:'A'});return App.store.save();});
  const resultB=await b.evaluate(async()=>{App.store.data().queue.push({id:'b',text:'B'});return {saved:await App.store.save(),blocked:App.store.status().readOnly,pending:App.store.data().queue.some(x=>x.id==='b')};});
  assert(resultA);assert.deepEqual(resultB,{saved:false,blocked:true,pending:true});
  const restored=await isolated.newPage();await restored.goto(base+'/recovery.html');
  await restored.addScriptTag({url:base+'/rollback/173.9.1/js/store.js'});
  assert.deepEqual(await restored.evaluate(async()=>{await App.store.load();return App.store.data().queue.map(x=>x.id);}),['a']);
  await isolated.close();
  const sanitized=await p.evaluate(()=>{const html=App.safeHTML('<img src=x onerror="window.__xss=1"><a href="javascript:alert(1)">x</a><div style="position:fixed">text</div><svg onload="window.__xss=2"></svg>');const box=document.createElement('div');box.innerHTML=html;document.body.append(box);return {html,eventAttributes:box.querySelector('[onerror],[onload],[style]')!==null,jsLink:box.querySelector('[href^="javascript:"]')!==null};});
  assert(!sanitized.eventAttributes&&!sanitized.jsLink);assert.equal(await p.evaluate(()=>window.__xss),undefined);
  // Inspect actual card rendering, including formulas, without rewriting source text.
  await p.evaluate(()=>new Promise(resolve=>App.memcards.ensureMath(resolve)));
  const card=await p.evaluate(()=>{const source='<img src=x onerror="window.__xss=3"> **正常文本** $x^2+\\frac{1}{2}$';const box=document.createElement('div');box.innerHTML=App.memcards.render(source);document.body.append(box);return {math:box.querySelectorAll('.katex').length,bold:box.querySelector('strong')?.textContent,unsafe:!!box.querySelector('[onerror]')};});
  assert.deepEqual(card,{math:1,bold:'正常文本',unsafe:false});assert.equal(await p.evaluate(()=>window.__xss),undefined);
  await p.goto(base+'/rollback/173.9.1/index.html');await p.waitForFunction(()=>window.App?.app?.ready&&App.safeHTML);
  assert.equal(await p.evaluate(()=>typeof App.safeHTML),'function');
  assert.equal(await p.evaluate(()=>App.safeHTML('<img src=x onerror="void(0)">').includes('onerror')),false);
  await context.close();console.log('Storage conflict and HTML safety checks passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
