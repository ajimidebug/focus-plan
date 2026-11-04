import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { transform } from 'esbuild';
import postcss from 'postcss';
import prefix from 'postcss-prefix-selector';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const write=(p,text)=>{mkdirSync(path.dirname(path.join(root,p)),{recursive:true});writeFileSync(path.join(root,p),text)};
// Always rebuild from a clean output so obsolete bundles cannot enter the worker.
if(process.env.npm_lifecycle_event==='prebuild')rmSync(path.join(root,'dist'),{recursive:true,force:true});
const html=read('legacy/index.html');
const body=html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
write('src/legacy-template.html',html.match(/<style id="pip-style">[\s\S]*?<\/style>/)[0]+'\n'+body);
const css=await postcss([prefix({prefix:'.legacy-host',transform:(p,selector,prefixed)=>{
  if(selector.includes(':root')||/^html\b/.test(selector))return selector;
  if(/^body[^\s]*$/.test(selector))return selector.replace(/^body(?:\.memo-layout)?/,'body.framework-layout');
  selector=selector.replace(/^body\.memo-layout/,'body.framework-layout');
  if(selector.startsWith('.memo-layout'))return selector.replace(/^\.memo-layout/,p);
  if(/^body[^\s]*:has\(/.test(selector))return selector;
  if(/^body\[data-theme=[^\]]+\]$/.test(selector))return selector;
  if(/^body\b/.test(selector))return selector.replace(/^(body[^\s]*)(\s*)/,(_,body,space)=>body+' '+p+(space?' ':''));
  return prefixed;
}})]).process(read('css/style.css'),{from:undefined});
write('src/css/legacy.css',css.css);
const paths=[...html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]);
const core=await transform(paths.map(p=>'\n/* '+p+' */\n'+read(p)).join('\n'),{minify:true,target:'es2022',legalComments:'eof'});
write('public/legacy-core.js',core.code);
for(const p of ['icon.svg','manifest.webmanifest','version.html','assets','css/katex.css','js/katex.min.js','js/mhchem.min.js','js/marked.min.js']){
  mkdirSync(path.dirname(path.join(root,'public',p)),{recursive:true});cpSync(path.join(root,p),path.join(root,'public',p),{recursive:true});
}
console.log('Prepared framework assets and one legacy domain runtime.');
