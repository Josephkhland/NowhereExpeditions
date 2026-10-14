// The Git tab's only bridge to the app: named actions (see git.js), the output log, the GitHub Actions page.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gitApi", {
  run: (name, args) => ipcRenderer.invoke("git:run", name, args),
  openActions: () => ipcRenderer.send("git:open-actions"),
  onLog: (callback) => ipcRenderer.on("git:log", (_event, text) => callback(text)),
  onBusy: (callback) => ipcRenderer.on("git:busy", (_event, busy) => callback(busy)),
});
