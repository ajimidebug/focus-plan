'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function renderer(){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://test.invalid/',runScripts:'outside-only'}),w=dom.window;
 for(const file of ['public/html-safety.js','js/store.js','js/marked.min.js','js/katex.min.js','js/mhchem.min.js','js/memcards.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 return {dom,w,render:s=>{const box=w.document.createElement('div');box.innerHTML=w.App.memcards.render(s);return box;}};
}
test('actual card renderer removes active HTML and styles without changing source',()=>{
 const {dom,render}=renderer();try{
  const source='<img src=x onerror="alert(1)"><svg onload="alert(2)"><a href="javascript:alert(3)">bad</a></svg><iframe srcdoc="bad"></iframe><div style="position:fixed">text</div>\n\n**保留加粗**';
  const box=render(source);assert(!box.querySelector('[onerror],[onload],[style],iframe,script,[href^="javascript:"]'));
  assert.equal(box.querySelector('strong').textContent,'保留加粗');assert(source.includes('onerror'));
 }finally{dom.window.close();}
});
test('math and chemistry remain readable while trusted HTML commands are disabled',()=>{
 const {dom,render}=renderer();try{
  const box=render('分式 $x^2+\\frac{1}{2}$，化学式 $\\ce{H2O}$');
  assert.equal(box.querySelectorAll('.katex').length,2);assert(box.querySelector('math'));assert(box.querySelector('[style]'));
  const bad=render('$\\href{javascript:alert(1)}{bad}$ $\\htmlStyle{position:fixed}{bad}$');
  assert(!bad.querySelector('[href^="javascript:"],[style*="position:fixed"]'));
 }finally{dom.window.close();}
});
test('missing sanitizer displays escaped source instead of raw HTML',()=>{
 const {dom,w,render}=renderer();try{delete w.App.safeHTML;const box=render('<img src=x onerror="bad()">');assert.equal(box.querySelector('img'),null);assert(box.textContent.includes('<img'));}finally{dom.window.close();}
});
