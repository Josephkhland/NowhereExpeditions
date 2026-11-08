"use strict";
const fs = require('node:fs');
const path = require('node:path');
const dest=path.resolve(__dirname,'dist');
// This directory contains generated frontend assets only. Rebuild it to remove obsolete layouts.
if (path.dirname(dest) !== fs.realpathSync(__dirname)) throw new Error('Unexpected frontend output path');
if (fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()) throw new Error('Frontend output must not be a symlink');
fs.rmSync(dest,{recursive:true,force:true});
fs.mkdirSync(dest,{recursive:true});
for(const f of fs.readdirSync(__dirname)) {
 if(!/\.(html|css|js)$/.test(f) || ['main.js','build-assets.js','service.js','native-host.js','terminal.js','git.js','memory.js','marketing.js','statusline.js'].includes(f)) continue;
 let data=fs.readFileSync(path.join(__dirname,f),'utf8');
 if(f.endsWith('.html')) { data=data.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,''); data=data.replace('<script src=', '<script src="bridge.js"></script>\n  <script src='); data=data.replace('../tools/nowhere-expeditions.png','logo.png');
 data=data.replaceAll('node_modules/@xterm/xterm/css/xterm.css','vendor/xterm.css')
   .replaceAll('node_modules/@xterm/xterm/lib/xterm.js','vendor/xterm.js')
   .replaceAll('node_modules/@xterm/addon-fit/lib/addon-fit.js','vendor/addon-fit.js');
 const page=f.replace('.html','');const preload=page==='shell'?'preload.js':page+'-preload.js';
 data=data.replace('<script src="bridge.js"></script>', '<script src="bridge.js"></script><script src="'+preload+'"></script>');
 if(page==='marketing')data=data.replace('<script src="bridge.js">','<script src="vendor/html-to-image/index.js"></script><script src="vendor/jspdf/jspdf.umd.min.js"></script><script src="bridge.js">'); }
 fs.writeFileSync(path.join(dest,f),data);
}
for(const [source,target] of [
 ['node_modules/@xterm/xterm/lib/xterm.js','vendor/xterm.js'],
 ['node_modules/@xterm/xterm/css/xterm.css','vendor/xterm.css'],
 ['node_modules/@xterm/addon-fit/lib/addon-fit.js','vendor/addon-fit.js'],
 ['node_modules/html-to-image/dist/html-to-image.js','vendor/html-to-image/index.js'],
 ['node_modules/jspdf/dist/jspdf.umd.min.js','vendor/jspdf/jspdf.umd.min.js']
]) {
 const output=path.join(dest,target); fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.copyFileSync(path.join(__dirname,source),output);
}
fs.copyFileSync(path.join(__dirname,'../tools/nowhere-expeditions.png'),path.join(dest,'logo.png'));
