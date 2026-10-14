// The tab bar's only bridge to the app: pick a tab, a tab's menu, the Live site's address, reload, go back,
// open in browser, receive state.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shellApi", {
  select: (id) => ipcRenderer.send("select", id),
  tabMenu: (id) => ipcRenderer.send("tab-menu", id),
  navigate: (text) => ipcRenderer.send("navigate", text),
  onFocusAddress: (callback) => ipcRenderer.on("focus-address", () => callback()),
  reload: () => ipcRenderer.send("reload"),
  back: () => ipcRenderer.send("back"),
  openInBrowser: () => ipcRenderer.send("open-in-browser"),
  onState: (callback) => ipcRenderer.on("state", (_event, state) => callback(state)),
});
