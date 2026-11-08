"use strict";
(() => {
 const tauri=window.__TAURI__; if(!tauri)throw Error('This page must run in Tauri');
 const callbacks=new Map();
 const ready=tauri.event.listen('host-event',event=>{const m=event.payload;for(const fn of callbacks.get(m.channel)||[])fn({},...(m.args||[]));});
 const invoke=async(channel,...args)=>{await ready;return tauri.core.invoke('service',{channel,args:args.map(v=>ArrayBuffer.isView(v)?Array.from(v):v)});};
 window.desktopBridge={contextBridge:{exposeInMainWorld:(key,value)=>{window[key]=value;}},ipcRenderer:{
 invoke,send:(channel,...args)=>{invoke(channel,...args).catch(e=>console.error('Desktop action failed:',String(e)));},
 on:(channel,callback)=>{if(!callbacks.has(channel))callbacks.set(channel,[]);callbacks.get(channel).push(callback);}
 }};
 document.addEventListener('keydown',event=>{
   if(event.ctrlKey && /^[1-8]$/.test(event.key)) {
     event.preventDefault();
     const ids=['live','manager','site','insights','bot','terminal','git','marketing'];
     tauri.event.emitTo({kind:'Webview',label:'main'},'host-event',{channel:'open-tab',args:[ids[Number(event.key)-1]]});
   }
 });
 window.desktopEvents={ready,on:(channel,fn)=>window.desktopBridge.ipcRenderer.on(channel,(_, ...args)=>fn(...args))};
})();
