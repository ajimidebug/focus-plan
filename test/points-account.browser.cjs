/* Isolated synthetic ledger: unified entry points, full detail and refund recovery. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'',process.cwd()]}));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,fonts=process.env.FOCUS_TEST_FONT_DIR,base=fonts&&pathname.startsWith('/__fonts/')?fonts:root;
 const file=path.resolve(base,'.'+(base===fonts?pathname.slice('/__fonts'.length):pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,bytes)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(bytes);});
});
let checks=0;function check(ok,message){assert(ok,message);checks++;}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.FOCUS_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[320,640],[390,844],[550,350],[1280,800]]){
   const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-10-29T12:40:00+08:00')});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
   await page.addStyleTag({content:'#toast-root{visibility:hidden!important}'});
   if(process.env.FOCUS_TEST_FONT_DIR){await page.addStyleTag({content:'@import url("/__fonts/400.css");body,button,input,textarea,select{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(()=>document.fonts.ready);}
   await page.evaluate(async()=>{
    const S=App.store,d=S.data(),day=App.memoCore.userDay(),at=day+'T12:00:00+08:00';
    d.ledger=[
     {id:'reward',date:day,at,type:'earn-checkin',points:25,note:'打卡：合成习惯'},
     {id:'undo',date:day,at,type:'undo-checkin',points:-25,note:'撤销原次积分：合成习惯',refundOf:'reward'},
     {id:'cost',date:day,at,type:'redeem',points:-60,note:'自定义支出：合成消费',itemSnapshot:{amountCents:3000,rate:2,note:'<img src=x onerror=alert(1)>'}},
     {id:'miss',date:'2026-10-28',at,type:'penalty-habit',points:-50,note:'习惯未达标扣分'},
     {id:'late1',date:'2026-10-28',at,type:'penalty-required',points:-5,note:'必做逾期甲'},
     {id:'late2',date:'2026-10-28',at,type:'penalty-required',points:-5,note:'必做逾期乙'},
     {id:'task',date:day,at,type:'earn-task',points:1,note:'任务完成'},
     {id:'habit',date:day,at,type:'earn-checkin',points:3,note:'打卡'},
     {id:'old',date:'2026-10-27',at:'2026-10-27T12:00:00+08:00',type:'redeem',points:-24,note:'历史合成消费'},
     {id:'legacy',date:'2026-10-27',type:'adjust',points:100,note:'旧流水无时间'}
    ];
    d.settings.redeemTable=[{item:'合成奖励',points:5}];
    await S.save();App.app.refreshStats();window.__ledgerBefore=JSON.stringify(d.ledger);
   });
   await page.locator('#stat-points').click();
   check(await page.locator('.modal-heading').innerText()==='积分明细与兑换','balance opens shared dialog '+width);
   const first=await page.locator('.modal-body').innerHTML();
   check(/有效收入 \+4 \/ 有效支出 −120 \/ 今日净变动 -116分/.test(await page.locator('.modal-body').innerText()),'canceled rewards excluded from effective totals '+width);
   check(await page.locator('#stat-points-today').innerText()==='今日 +4 / −120','header uses effective totals '+width);
   check((await page.locator('.points-day-rows [data-ledger-id]').count())===8,'today includes task, habit and undo rows '+width);
   check((await page.locator('.modal-body').innerText()).includes('消费 −60 / 扣分 −60 / 其他支出 −0'),'effective expense categories exclude cancellation '+width);
   check(await page.locator('[data-ledger-id="reward"]').getAttribute('data-ledger-status')==='canceled'&&await page.locator('[data-ledger-id="undo"]').getAttribute('data-ledger-status')==='canceled','both canceled records remain explicitly labelled '+width);
   check((await page.locator('[data-ledger-id="cost"]').innerText()).includes('30.00元；比例：2分/元'),'money and original rate remain visible '+width);
   check((await page.locator('.points-day-rows img').count())===0,'notes escaped '+width);
   check(await page.evaluate(()=>JSON.stringify(App.store.data().ledger)===window.__ledgerBefore),'viewing never changes ledger '+width);
   await page.locator('.modal [data-act="cancel"]').click();
   await page.locator('#stat-points-today').click();
   check(await page.locator('.modal-body').innerHTML()===first,'both header entries have identical detail '+width);
   await page.locator('.modal [data-act="cancel"]').click();
   await page.evaluate(()=>App.app.switchView('checkin'));
   await page.locator('#flow-shop').click();
   check(await page.locator('.modal-body').innerHTML()===first,'points-page entry also shares complete detail '+width);
   await page.locator('.modal [data-act="all"]').click();
   check(await page.locator('.points-day-rows [data-ledger-id]').count()===10,'history includes every ledger type '+width);
   check(await page.locator('[data-ledger-id="legacy"]').count()===1,'unknown timestamp retained '+width);
   await page.locator('.modal [data-act="preset-list"]').click();
   check(await page.locator('#points-presets').evaluate(e=>e.open),'fixed rewards reachable '+width);
   await page.locator('.modal [data-act="preset"]').click();
   check(await page.locator('.modal-heading').innerText()==='确认兑换','preset confirmation preserved '+width);
   await page.locator('.modal [data-act="cancel"]').click();
   check(await page.locator('.modal [data-act="all"]').getAttribute('aria-pressed')==='true','cancel returns to selected scope '+width);
   await page.locator('[data-act="refund"][data-id="cost"]').click();
   check(await page.locator('.modal-heading').innerText()==='撤销支出','refund accessible from complete ledger '+width);
   await page.evaluate(()=>{App.memoFlow.state().rate=4;window.__save=App.store.save;App.store.save=async()=>false;});
   await page.locator('.modal [data-act="save"]').click();
   await page.waitForFunction(()=>App.memoActions.busy()&&document.querySelector('.modal [data-act="save"]').textContent==='重试保存');
   check(await page.evaluate(()=>App.store.data().ledger.filter(e=>e.refundOf==='cost').length)===1,'failed save creates only one in-memory refund '+width);
   await page.evaluate(()=>App.store.save=window.__save);
   await page.locator('.modal [data-act="save"]').click();await page.waitForFunction(()=>!App.memoActions.busy()&&!!document.querySelector('.points-account-modal'));
   check(await page.evaluate(()=>App.store.data().ledger.filter(e=>e.refundOf==='cost').length)===1,'retry persists without another refund '+width);
   check(await page.evaluate(()=>App.store.data().ledger.find(e=>e.refundOf==='cost').points)===60,'refund uses original points after rate change '+width);
   check(await page.locator('[data-act="refund"][data-id="cost"]').count()===0,'refunded expense cannot be refunded twice '+width);
   check((await page.locator('[data-ledger-id="cost"]').innerText()).includes('已全额抵消'),'original debit remains labelled '+width);
   check(await page.locator('#stat-points-today').innerText()==='今日 +4 / −60','same-day refund reduces expense rather than inflating income '+width);
   for(const theme of ['default','dark']){
    await page.evaluate(t=>document.body.dataset.theme=t,theme);
    check(await page.locator('.modal').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'dialog fits '+width+' '+theme);
    check(await page.locator('.modal-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'detail wraps '+width+' '+theme);
    check(await page.locator('.modal [data-act="cancel"]').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'close reachable '+width+' '+theme);
   }
   await page.locator('.modal [data-act="custom"]').click();
   await page.locator('#spend-purpose').fill('合成新支出');await page.locator('#spend-value').fill('3');
   check((await page.locator('#spend-preview').innerText()).includes('12 分'),'custom spending uses current rate '+width);
   await page.locator('.modal [data-act="save"]').click();await page.waitForFunction(()=>!!document.querySelector('.points-account-modal'));
   check(await page.evaluate(()=>App.store.data().ledger.filter(e=>e.note==='自定义支出：合成新支出'&&e.points===-12).length)===1,'new expense returns to same complete ledger '+width);
   if(process.env.FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.FOCUS_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>document.body.dataset.theme='default');await page.screenshot({path:path.join(process.env.FOCUS_SCREENSHOT_DIR,'points-'+width+'.png'),animations:'disabled'});}
   await page.locator('.modal [data-act="cancel"]').click();
   await page.reload();await page.waitForFunction(()=>App?.app?.ready);
   check(await page.evaluate(()=>App.store.data().ledger.filter(e=>e.refundOf==='cost').length)===1,'refund survives reload '+width);
   check(errors.length===0,'no browser exceptions '+width+': '+errors.join(';'));
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
  await page.clock.install({time:new Date('2026-10-29T03:59:58+08:00')});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>App?.app?.ready);
  await page.evaluate(async()=>{
   const d=App.store.data();d.checkins=[];d.queue=[];d.daily=[];d.memoProjects=[];
   d.ledger=[{id:'early',at:'2026-10-29T03:59:57+08:00',date:'2026-10-20',type:'earn-checkin',points:25,note:'合成旧奖励'},
    {id:'old-cost',at:'2026-10-28T21:00:00+08:00',date:'2026-10-28',type:'redeem',points:-60,note:'合成旧支出'}];
   await App.store.save();App.app.refreshStats();
  });
  check(await page.locator('#stat-points-today').innerText()==='今日 +25 / −60','pre-boundary posting-day totals');
  await page.clock.runFor(2100);await page.evaluate(()=>App.memoSchedule.tick());
  check(await page.locator('#stat-points-today').innerText()==='今日 +0 / −0','effective totals reset at 04:00');
  await page.evaluate(async()=>{
   App.store.undoLastLedger('early');App.memoCurrency.refundCore('old-cost');await App.store.save();App.app.refreshStats();
  });
  check(await page.locator('#stat-points-today').innerText()==='今日 +0 / −0','cross-day reversals do not inflate either counter');
  await page.locator('#stat-points').click();
  check((await page.locator('.modal-body').innerText()).includes('跨日调整：+35分'),'cross-day adjustment remains explicit');
  check((await page.locator('.modal-body').innerText()).includes('今日净变动 +35分'),'posting-day net still matches all raw entries');
  check(await page.locator('[data-ledger-status="cross-day"]').count()===2,'both cross-day correction records retained');
  check(await page.evaluate(()=>{const f=App.memoFinance.effectiveFlow('2026-10-28');return f.income===25&&f.expense===60;}),'earlier user-day remains unchanged');
  await page.locator('.modal [data-act="cancel"]').click();
  await page.evaluate(async()=>{
   const d=App.store.data(),at=new Date().toISOString(),day=App.memoCore.userDay();
   d.ledger.push({id:'manual',date:day,at,type:'adjust',points:7,note:'合成调整'},{id:'orphan',date:day,at,type:'reverse-checkin',points:-3,refundOf:'missing',note:'合成孤立冲正'});
   await App.store.save();App.app.refreshStats();
  });
  check(await page.locator('#stat-points-today').innerText()==='今日 +0 / −0','manual and unresolved changes remain separate');
  await page.locator('#stat-points-today').click();
  check((await page.locator('.modal-body').innerText()).includes('其他调整：+4分'),'unresolved effects remain counted exactly');
  check((await page.locator('.modal-body').innerText()).includes('关联待核验'),'unresolved correction is labelled');
  check(await page.evaluate(()=>App.memoFinance.effectiveFlow(App.memoCore.userDay()).net)===39,'all adjustments reconcile to raw daily net');
  await context.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log(checks+' unified and effective points browser checks passed across four viewports and 04:00.');
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});
