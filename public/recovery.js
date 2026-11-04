'use strict';
document.getElementById('export').onclick=function(){
  try{
    const raw=localStorage.getItem('focusPlanData.v1');
    if(raw===null){document.getElementById('status').textContent='当前浏览器没有找到主记录。未创建或覆盖数据。';return;}
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
    link.href=url;link.download='focus-plan-raw-recovery-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    document.getElementById('status').textContent='已请求下载原始主记录。此文件不包含独立图片。';
  }catch(error){document.getElementById('status').textContent='读取失败：'+error.message;}
};
