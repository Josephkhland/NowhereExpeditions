// The Marketing tab's only bridge to the app: named actions (see marketing.js) and "the folder changed".
"use strict";

const { contextBridge, ipcRenderer } = window.desktopBridge;

contextBridge.exposeInMainWorld("marketingApi", {
  run: async (name, ...args) => {
    if(name==='capturePng'){
      const node=document.querySelector('.capture-stage > *');
      if(!node)return {error:'Nothing to capture.'};
      const url=await htmlToImage.toPng(node,{backgroundColor:'#141210',pixelRatio:2});
      window.__capturedPng=Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer()));return {ok:true};
    }
    if(name==='savePng')return ipcRenderer.invoke('mk:run','saveImage',args[0],window.__capturedPng);
    if(name==='exportPdf'){
      const area=document.getElementById('print-area');const previous=area.style.cssText;
      try{
        area.style.cssText='display:block;position:fixed;left:0;top:0;width:1000px;background:white;color:#171411;padding:24px;z-index:1000';
        const png=await htmlToImage.toCanvas(area,{backgroundColor:'#ffffff',pixelRatio:1});
        const pdf=new jspdf.jsPDF({orientation:args[1]?'landscape':'portrait',unit:'mm',format:'a4'});
        const width=pdf.internal.pageSize.getWidth()-20,height=pdf.internal.pageSize.getHeight()-20;
        const pixelsPerPage=Math.floor(height*png.width/width);
        for(let y=0;y<png.height;y+=pixelsPerPage){if(y)pdf.addPage();const part=document.createElement('canvas');part.width=png.width;part.height=Math.min(pixelsPerPage,png.height-y);part.getContext('2d').drawImage(png,0,y,png.width,part.height,0,0,png.width,part.height);pdf.addImage(part.toDataURL('image/png'),'PNG',10,10,width,part.height*width/png.width);}
        return ipcRenderer.invoke('mk:run','savePdf',args[0],Array.from(new Uint8Array(pdf.output('arraybuffer'))));
      }finally{area.style.cssText=previous;}
    }
    const result=await ipcRenderer.invoke('mk:run',name,...args);
    const convert=value=>{if(!value||typeof value!=='object')return;if(value.type==='Buffer'&&Array.isArray(value.data))return;for(const key of Object.keys(value)){if(key==='url'&&typeof value[key]==='string'&&value[key].startsWith('file:')){let p=decodeURIComponent(new URL(value[key]).pathname).replace(/^\/(?=[A-Z]:)/i,'');value[key]=window.__TAURI__.core.convertFileSrc(p);}else if(key==='bytes'&&value[key]?.type==='Buffer'){value[key]=value[key].data;}else convert(value[key]);}};convert(result);return result;
  },
  onChanged: (callback) => ipcRenderer.on("mk:changed", () => callback()),
});
