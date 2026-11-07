import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist/spa');
const version=JSON.parse(readFileSync(path.join(root,'package.json'))).version;
const baseline='0150b98105c585e741a49885f557adfe2c3defe2';
const old=p=>execFileSync('git',['show',baseline+':'+p],{cwd:root,maxBuffer:12*1024*1024});
const previous=JSON.parse(old('version.json'));
const rollback='rollback/'+previous.id+'/';
for(const asset of previous.assets){
  const file=asset.url.slice(2).split('?')[0];if(file.includes('..'))throw Error('Invalid rollback path');
  const target=path.join(out,rollback,file);mkdirSync(path.dirname(target),{recursive:true});
  let body=old(file);
  // Compatibility view must use today's storage and rendering protections.
  if(file==='js/store.js'||file==='js/memcards.js')body=readFileSync(path.join(root,file));
  if(file==='index.html'){
    let html=body.toString().replace(/<script src="js\/updates\.js[^\"]*"><\/script>/,'');
    html=html.replace('<body class="memo-layout">','<body class="memo-layout"><div style="padding:12px;background:#fff7ed;color:#9a3412;font:14px system-ui">兼容旧界面 · 使用相同本机记录。<a href="../../index.html">返回新版</a> · <a href="../../recovery.html">恢复入口</a></div>');
    // The compatibility view must never install a second worker or silently
    // fetch a newer UI into the rollback path.
    html=html.replace('<script src="js/app.js',`<script>window.App.updates={init:function(){},appReady:function(){},showBlocked:function(message){document.body.insertAdjacentHTML('afterbegin','<p>记录处于保护状态，请返回恢复入口导出原始记录。</p>');}};</script><script src="js/app.js`);
    html=html.replace('<head>', '<head><script src="../../html-safety.js"></script>');
    body=Buffer.from(html);
  }
  writeFileSync(target,body);
}
const entry=path.join(out,'index.html');
writeFileSync(entry,readFileSync(entry,'utf8').replace(/window\.__RELEASE\s*=\s*'[^']*'/,"window.__RELEASE = '"+version+"'"));
const walk=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
writeFileSync(path.join(out,'.nojekyll'),'');
const assets=walk(out).sort().filter(p=>!['sw.js','version.json'].includes(path.basename(p))).map(file=>({url:'./'+path.relative(out,file).split(path.sep).join('/')+'?v='+version,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
const worker=readFileSync(path.join(root,'scripts/sw.template.js'),'utf8').replace('__RELEASE__',version).replace('__ASSETS__',JSON.stringify(assets,null,2));
writeFileSync(path.join(out,'sw.js'),worker);
const sourceCommit=process.env.FOCUS_SOURCE_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
writeFileSync(path.join(out,'version.json'),JSON.stringify({id:version,dataVersion:1,sourceCommit,rollback:rollback+'index.html',assets},null,2)+'\n');
writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Packaged '+version+' with '+assets.length+' verified assets, including compatibility UI '+previous.id);
