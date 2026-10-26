// The Terminal tab's only bridge to the app: keystrokes in, output out, size, clipboard, start/stop/restart.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("terminalApi", {
  ready: () => ipcRenderer.send("term:ready"),
  input: (id, data) => ipcRenderer.send("term:input", id, data),
  resize: (cols, rows) => ipcRenderer.send("term:resize", cols, rows),
  start: (id) => ipcRenderer.send("term:start", id),
  resume: (id) => ipcRenderer.send("term:resume", id),
  stop: (id) => ipcRenderer.send("term:stop", id),
  restart: (id) => ipcRenderer.send("term:restart", id),
  restartServers: () => ipcRenderer.send("term:restart-servers"),
  copy: (text) => ipcRenderer.send("term:copy", text),
  paste: () => ipcRenderer.invoke("term:paste"),
  actions: () => ipcRenderer.invoke("term:actions"),
  setFolder: (id, folder) => ipcRenderer.invoke("term:set-folder", id, folder),
  openTab: (id) => ipcRenderer.send("term:open-tab", id),
  memory: () => ipcRenderer.invoke("mem:list"),
  deleteMemory: (file) => ipcRenderer.invoke("mem:delete", file),
  restoreMemory: (file) => ipcRenderer.invoke("mem:restore", file),
  onData: (callback) => ipcRenderer.on("term:data", (_event, id, data) => callback(id, data)),
  onReplay: (callback) => ipcRenderer.on("term:replay", (_event, id, data) => callback(id, data)),
  onState: (callback) => ipcRenderer.on("term:state", (_event, sessions) => callback(sessions)),
  onShow: (callback) => ipcRenderer.on("term:show", (_event, id) => callback(id)),
});
