"use strict";
(() => {
 const ids=['live','manager','site','insights','bot','terminal','git','marketing'];
 const titles=['Live site','Content manager','Draft site','Table insights','Bot dashboard','Terminal','Git','Marketing'];
 let active=localStorage.getItem('active-tab')||'manager', dashboard=false;
 let address='https://josephkhland.github.io/NowhereExpeditions/';
 let update=()=>{}, focus=()=>{};const loaded=new Set();
 const state=()=>update({active,address,tools:ids.map((id,i)=>({id,title:titles[i],available:id!=='bot'||dashboard,status:id==='bot'&&!dashboard?'waiting':loaded.has(id)?'online':'idle'}))});
 const run=async(id,action,text=null)=>window.__TAURI__.core.invoke('tab',{id,action,text});
 async function select(id){if(!ids.includes(id)||id==='bot'&&!dashboard)return;try{await run(id,'select');active=id;loaded.add(id);localStorage.setItem('active-tab',id);state();}catch(e){console.error(String(e));}}
 window.shellApi={select,tabMenu:async(id)=>{if(['manager','site','insights','bot'].includes(id)){await select('terminal');window.__TAURI__.event.emitTo('terminal','host-event',{channel:'term:show',args:[id]});}},navigate:async text=>{await run('live','navigate',text);address=text;state();},onFocusAddress:cb=>focus=cb,reload:()=>run(active,'reload'),back:()=>run(active,'back'),openInBrowser:()=>run(active,'browser'),onState:cb=>{update=cb;state();}};
 window.desktopEvents.on('open-tab',select);
 window.desktopEvents.on('dashboard',()=>{dashboard=true;state();});
 window.desktopEvents.on('server-up',id=>{if(loaded.has(id))run(id,'reload');});
 window.desktopEvents.on('service-error',()=>{alert('The desktop service stopped. Close and reopen the app.');});
 document.addEventListener('keydown',event=>{if(event.ctrlKey&&/^[1-8]$/.test(event.key)){event.preventDefault();select(ids[Number(event.key)-1]);}else if(event.ctrlKey&&event.key.toLowerCase()==='l'){event.preventDefault();focus();}else if(event.ctrlKey&&event.key.toLowerCase()==='r'){event.preventDefault();run(active,'reload');}});
 window.desktopEvents.ready.then(async()=>{
   dashboard=await window.__TAURI__.core.invoke('dashboard_available');
   state();
   await window.__TAURI__.event.emit('shell-ready');
 });
})();
