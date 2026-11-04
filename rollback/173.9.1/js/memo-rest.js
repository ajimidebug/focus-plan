/* Each click adds an ordinary note stamp. No rest session or task timer is changed. */
(function(){
  'use strict';const A=window.App,S=()=>A.store,M=()=>A.memoCore;
  function stampCore(now=Date.now(),label='休息'){
    const day=M().userDay(now),blocks=M().segments(M().read(day)),text=blocks.map(x=>x.text).join(''),block={id:S().uid(),text:(text&&!text.endsWith('\n')?'\n':'')+(M().naturalDay(now)!==day?'次日':'')+M().clock(now).replace(':','')+' '+label+'\n'};
    blocks.push(block);M().write(day,blocks.map(x=>x.text).join(''),new Date(now).toISOString(),blocks);return {day,blockId:block.id,offset:text.length+block.text.length-1,label};
  }
  function focusStamp(result){
    A.memo.show(result.day);const root=document.getElementById('memo-editor');if(root.contentEditable==='false')return;
    const blocks=M().segments(M().read(result.day));let offset=0,found=false;for(const b of blocks){if(b.id===result.blockId){offset+=b.text.lastIndexOf(result.label||'休息')+(result.label||'休息').length;found=true;break;}offset+=b.text.length;}
    root.focus({preventScroll:true});A.memoEditor.select(found?offset:Math.min(result.offset,A.memoEditor.text().length));
  }
  function init(){
    [['memo-rest','休息','休息'],['memo-think','思考','【思考/建设】']].forEach(([id,title,label])=>{const b=document.createElement('button');b.id=id;b.className='btn';b.textContent=title;document.getElementById(id==='memo-rest'?'memo-time':'memo-rest').after(b);let pending=false,result=null;
    b.onclick=async()=>{
      if(pending)return;if(A.memoEditor.busy())return A.ui.toast('请先完成正在输入的文字');if(!result&&A.memoActions.busy())return A.ui.toast('请先重试保存当前操作');pending=true;b.disabled=true;
      try{if(await A.memoActions.commit(()=>{if(!result)result=stampCore(Date.now(),label);})){focusStamp(result);result=null;}}
      catch(e){A.ui.toast(e.message+(result?'；再点“'+title+'”重试保存':''));}finally{pending=false;b.disabled=false;}
    };});
  }
  A.memoRest={stampCore,focusStamp,init};
})();
