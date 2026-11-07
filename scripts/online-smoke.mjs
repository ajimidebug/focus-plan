import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=new URL(process.env.SITE_URL);assert.equal(base.protocol,'https:');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({timezoneId:'Asia/Shanghai',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.App?.app?.ready);
 const release=await page.evaluate(async()=>{const r=await fetch('version.json?verify='+Date.now(),{cache:'no-store'});return {server:await r.json(),page:window.__RELEASE};});
 assert.equal(release.server.sourceCommit,process.env.EXPECTED_SHA);assert.equal(release.page,release.server.id);
 assert.deepEqual(errors,[]);await context.close();console.log('Isolated online startup verified. Existing user sessions were not accessed.');
}finally{await browser.close();}
