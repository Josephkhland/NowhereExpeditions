"use strict";
const fs=require('node:fs'), path=require('node:path'),net=require('node:net');
const {ipcMain,handlers,send,pending}=require('./native-host');
const pages=new Map(['terminal','git','marketing'].map(id=>[id,{isDestroyed:()=>false,send:(channel,...args)=>send({page:id,channel,args})}]));
const data=process.env.NE_APP_DATA; if(!data) throw Error('NE_APP_DATA is required');
fs.mkdirSync(data,{recursive:true});
const emit=(channel,...args)=>send({page:'main',channel,args});
const sessions=require('./terminal').createSessions({onChange:()=>{},onServerUp:id=>emit('server-up',id),onOpenTab:id=>emit('open-tab',id),settingsFile:path.join(data,'terminal.json')});
sessions.attach(pages.get('terminal'));
require('./memory').createMemory({getFolder:()=>sessions.claudeFolder()}).attach(pages.get('terminal'));
require('./git').createGit().attach(pages.get('git'));
require('./marketing').createMarketing({getWindow:()=>null}).attach(pages.get('marketing'));
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;await sessions.stopAll();sessions.dispose();server.close();process.exit(0);}
const server=net.createServer(socket=>{let text='';socket.setEncoding('utf8');socket.on('error',()=>{});socket.on('data',chunk=>{text+=chunk;if(text.length>4096)socket.destroy();});socket.on('end',()=>{if(text.length>4096)return;try {for(const line of text.split('\n')){if(!line.trim())continue;const m=JSON.parse(line);const u=new URL(m.url);if(m.open==='dashboard'&&u.origin==='http://127.0.0.1:8766'&&!u.username&&!u.password)emit('dashboard',u.href);}}catch{}});});
server.on('error',()=>{});server.listen(process.env.NE_APP_PIPE || "\\\\.\\pipe\\nowhere-expeditions-app");
require('node:readline').createInterface({input:process.stdin}).on('line',async line=>{
 let m;try{m=JSON.parse(line);
 if(m.nativeReply){const p=pending.get(m.nativeReply);pending.delete(m.nativeReply);if(p)m.error?p.reject(Error(m.error)):p.resolve(m.result);return;}
 if(m.channel==='shutdown'){await shutdown();return;}
 if(m.channel==='host:ready'){emit('ready');return;}
 if(m.channel==='mk:run'&&['saveImage','savePdf'].includes(m.args?.[0])){
 if(m.page!=='marketing')throw Error('Not allowed');
 const ext=m.args[0]==='savePdf'?'pdf':'png';const name=String(m.args[1]||'export').replace(/[^\w.-]+/g,'-').slice(0,80);
 const dir=path.resolve(process.env.NE_APP_MARKETING_DIR||path.join(__dirname,'../marketing_promotion'),'exports');
 const result=await require('./native-host').dialog.showSaveDialog({defaultPath:path.join(dir,name+'.'+ext)});
 if(!result.canceled&&result.filePath){fs.mkdirSync(path.dirname(result.filePath),{recursive:true});fs.writeFileSync(result.filePath,Buffer.from(m.args[2]));}
 send({id:m.id,result:result.canceled?{}:{done:'Export saved.'}});return;
 }
 const page=pages.get(m.page); const allowed=m.page==='terminal'?/^(term:|mem:)/:m.page==='git'?/^git:/:m.page==='marketing'?/^mk:/:null;
 if(!page||!allowed.test(m.channel))throw Error('Not allowed');
 const event={sender:page}; const fn=handlers.get(m.channel);
 const result=fn?await fn(event,...(m.args||[])):(ipcMain.emit(m.channel,event,...(m.args||[])),null);
 send({id:m.id,result:result??null});
 }catch(e){if(m?.id)send({id:m.id,error:e.message});}
}).on('close',shutdown);
const flags=new Set(process.argv.slice(2));const skip=new Set(flags.has('--open-only')?['manager','site','insights','bot']:[]);
if(flags.has('--no-bot'))skip.add('bot');if(flags.has('--no-insights'))skip.add('insights');
sessions.startServers(skip);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
