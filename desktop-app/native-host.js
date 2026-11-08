"use strict";
// Private stdio protocol. No listening TCP port, renderer Node access, or Electron runtime.
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const handlers=new Map(); const ipcMain=new EventEmitter();
ipcMain.handle=(name,fn)=>handlers.set(name,fn); ipcMain.removeHandler=name=>handlers.delete(name);
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
let next=0; const pending=new Map();
const native=(action,args)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});send({native:id,action,args});});
const clipboard={writeText:text=>native('clipboardWrite',[text]),readText:()=>native('clipboardRead',[])};
const shell={openExternal:url=>native('openUrl',[url]),openPath:file=>native('openPath',[file]),showItemInFolder:file=>spawn('explorer.exe',['/select,',file],{windowsHide:true})};
const dialog={showSaveDialog:async(...args)=>native('saveDialog',[args.at(-1)])};
module.exports={ipcMain,handlers,send,native,pending,clipboard,shell,dialog};
