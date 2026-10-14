// Nowhere Expeditions desktop app: one window with a tab per local tool, instead of browser tabs.
//
// - Single instance: launching it again (the desktop shortcut) focuses the open window.
// - It runs the servers and the bot itself, in the Terminal tab (terminal.js), and stops them when it closes.
//   --no-bot / --no-insights skip one at launch; --open-only starts none.
// - Each tool is its own sandboxed view; pages that aren't up yet are retried until their server answers.
// - The bot dashboard arrives through a private named pipe (see hand_to_app in the bot). Its link holds the
//   dashboard key, so it is kept in this process only: never logged, never shown, never sent to the tab bar.

"use strict";

const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, shell, session } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { createSessions } = require("./terminal");
const { createGit } = require("./git");
const { createMemory } = require("./memory");

const PIPE = "\\\\.\\pipe\\nowhere-expeditions-app";
const DASHBOARD_ORIGIN = "http://127.0.0.1:8766";
const TAB_BAR_HEIGHT = 46;
const RETRY_MS = 2000;
const ICON = path.join(__dirname, "..", "tools", "nowhere-expeditions.ico");

const LIVE_SITE = "https://josephkhland.github.io/NowhereExpeditions/";
const TOOLS = [
  { id: "live", title: "Live site", url: LIVE_SITE }, // the published site; the tab bar shows an address field for it
  { id: "manager", title: "Content manager", url: "http://127.0.0.1:8001/" },
  { id: "site", title: "Draft site", url: "http://127.0.0.1:8000/" }, // public-site/, before it's published
  { id: "insights", title: "Table insights", url: "http://127.0.0.1:8002/" },
  { id: "bot", title: "Bot dashboard", url: null }, // set only through the pipe
  { id: "terminal", title: "Terminal", page: "terminal.html", preload: "terminal-preload.js" }, // the servers, the bot and Claude Code, see terminal.js
  { id: "git", title: "Git", page: "git.html", preload: "git-preload.js" }, // diffs, commits, publishing to main, see git.js
];
const LOCAL_ORIGINS = new Set(["http://127.0.0.1:8001", "http://127.0.0.1:8000", "http://127.0.0.1:8002", DASHBOARD_ORIGIN]);

let win = null;
let bar = null;
const views = new Map(); // id -> { view, status: "starting" | "online" | "offline", retry }
let active = "manager";
let sessions = null; // the servers, the bot and Claude Code (terminal.js)
let gitTool = null; // the Git tab's actions (git.js)
let memoryTool = null; // Claude Code's memory notes (memory.js)
let closing = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    const tab = argv.find((a) => a.startsWith("--tab="));
    if (tab) select(tab.slice(6));
  });
  app.whenReady().then(start);
}

// --- window state -------------------------------------------------------------------

function stateFile() {
  return path.join(app.getPath("userData"), "window.json");
}

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1440, height: 920, maximized: false };
  }
}

function saveBounds() {
  if (!win) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized(), active }));
  } catch {
    // Not worth failing over.
  }
}

// --- tools ---------------------------------------------------------------------------

function tool(id) {
  return TOOLS.find((t) => t.id === id);
}

function canOpen(t) {
  return Boolean(t && (t.url || t.page));
}

function isLocal(url) {
  try {
    return LOCAL_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// What you type in the Live site's address field: a web address, "https://" added if left out.
function webAddress(text) {
  const typed = String(text || "").trim();
  if (!typed || typed.length > 2048) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`);
    return /^https?:$/.test(url.protocol) && url.origin !== DASHBOARD_ORIGIN ? url.href : null;
  } catch {
    return null;
  }
}

function toolFor(url) {
  try {
    const origin = new URL(url).origin;
    return TOOLS.find((t) => (t.id === "bot" ? origin === DASHBOARD_ORIGIN : t.url && new URL(t.url).origin === origin));
  } catch {
    return null;
  }
}

function makeView(id) {
  if (tool(id).page) return makePageView(id);
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const entry = { view, status: "starting", retry: null };
  views.set(id, entry);
  const contents = view.webContents;

  contents.on("did-finish-load", () => setStatus(id, "online"));
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: navigation aborted, not a failure
    setStatus(id, "offline");
    clearTimeout(entry.retry);
    // Only the tab you're looking at keeps retrying; a background tab tries again when you open it.
    if (id === active) entry.retry = setTimeout(() => load(id), RETRY_MS);
  });
  contents.on("page-title-updated", () => pushState());
  if (id === "live") {
    // The address field follows the page, and a failed load retries the address you typed.
    const follow = (_event, url) => {
      entry.address = url;
      pushState();
    };
    contents.on("did-navigate", follow);
    contents.on("did-navigate-in-page", follow);
  }

  // Links: our own tools open in their tab, everything else in the normal browser.
  contents.setWindowOpenHandler(({ url }) => {
    route(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const target = toolFor(url);
    if (target && target.id === id) return; // within the same tool
    if (id === "live" && sameOrigin(url, entry.address)) return; // a site you typed into the address field
    event.preventDefault();
    route(url);
  });
  contents.on("context-menu", (_event, params) => contextMenu(contents, params));
  contents.on("before-input-event", (event, input) => shortcuts(event, input));

  win.contentView.addChildView(view);
  view.setVisible(false);
  layout();
  return entry;
}

// The Terminal and Git tabs are local pages, each with its own bridge; they never navigate anywhere.
function makePageView(id) {
  const t = tool(id);
  const view = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, t.preload), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const entry = { view, status: "starting", retry: null };
  views.set(id, entry);
  const contents = view.webContents;
  if (id === "terminal") contents.setIgnoreMenuShortcuts(true); // Ctrl+R, Ctrl+C, Ctrl+V… belong to the shell
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("did-finish-load", () => setStatus(id, "online"));
  contents.on("before-input-event", (event, input) => shortcuts(event, input));
  if (id === "git") contents.on("context-menu", (_event, params) => contextMenu(contents, params));
  if (id === "terminal") {
    sessions.attach(contents);
    memoryTool.attach(contents); // "Claude's memory", opened from the Terminal tab
  } else {
    gitTool.attach(contents);
  }
  win.contentView.addChildView(view);
  view.setVisible(false);
  layout();
  return entry;
}

function load(id) {
  const t = tool(id);
  const entry = views.get(id);
  if (!t || !entry) return;
  if (t.page) entry.view.webContents.loadFile(path.join(__dirname, t.page));
  else if (t.url) entry.view.webContents.loadURL(entry.address || t.url).catch(() => {}); // failures are handled by did-fail-load
}

// The Live site's address field: go where it says.
function navigate(text) {
  const url = webAddress(text);
  const entry = ensureView("live");
  if (!url || !entry) return pushState(); // puts the current address back in the field
  entry.address = url;
  load("live");
  select("live");
}

// Tabs are created the first time they're opened, so tools you don't use cost no memory.
function ensureView(id) {
  if (!views.has(id) && canOpen(tool(id))) {
    makeView(id);
    load(id);
  }
  return views.get(id);
}

function route(url) {
  const target = toolFor(url);
  if (target && target.id !== "bot") {
    ensureView(target.id).view.webContents.loadURL(url).catch(() => {});
    select(target.id);
  } else if (target && target.id === "bot") {
    select("bot");
  } else if (/^https?:/i.test(url)) {
    shell.openExternal(url);
  }
}

function setStatus(id, status) {
  const entry = views.get(id);
  if (!entry || entry.status === status) return;
  entry.status = status;
  pushState();
}

function select(id) {
  const selected = ensureView(id);
  if (!selected) return;
  active = id;
  for (const [key, entry] of views) entry.view.setVisible(key === id);
  layout();
  pushState();
  if (selected.status === "offline") load(id); // it stopped retrying while in the background
  selected.view.webContents.focus();
}

function layout() {
  if (!win || !bar) return;
  const { width, height } = win.getContentBounds();
  bar.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT });
  // Every tab gets the full size (hidden ones too), so background tabs load and lay out like the visible one.
  const bounds = { x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) };
  for (const entry of views.values()) entry.view.setBounds(bounds);
}

// The tab bar learns titles and statuses, and only one URL: the Live site's, for its address field.
function pushState() {
  if (!bar) return;
  const live = views.get("live");
  bar.webContents.send("state", {
    active,
    address: live?.view.webContents.getURL() || live?.address || LIVE_SITE,
    tools: TOOLS.map((t) => ({
      id: t.id,
      title: t.title,
      available: views.has(t.id) || canOpen(t),
      status: t.id === "terminal" ? sessions.summary() : views.get(t.id)?.status || (canOpen(t) ? "idle" : "waiting"),
    })),
  });
}

// A server came (back) up: refresh its tab if it's open. The bot's tab refreshes when its new link arrives.
function serverUp(id) {
  if (id !== "bot" && views.has(id)) load(id);
}

function showSession(id) {
  select("terminal");
  sessions.show(id);
}

// Right-click on a tab: restart its server, or see its output.
function tabMenu(id) {
  const t = tool(id);
  if (!t) return;
  const items = [];
  if (sessions.hasServer(id)) {
    const name = id === "bot" ? "the bot" : t.title.toLowerCase();
    items.push({ label: `Restart ${name}`, click: () => sessions.restart(id) });
    items.push({ label: `Show ${name} output`, click: () => showSession(id) });
    items.push({ type: "separator" });
  }
  items.push({ label: "Restart all servers", click: () => sessions.restartServers() });
  items.push({ label: "Reload interface (keeps terminals running)", click: reloadInterface });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// Picks up changes to the tab bar and the Terminal tab's page (shell.*, terminal.html/css, terminal-page.js and
// their preloads) without restarting: the terminals live in this process, so Claude Code, the servers and the bot
// keep running and their output is replayed. Changes to main.js or terminal.js still need a restart.
function reloadInterface() {
  bar.webContents.reloadIgnoringCache();
  views.get("terminal")?.view.webContents.reloadIgnoringCache();
  views.get("git")?.view.webContents.reloadIgnoringCache();
}

// --- bot dashboard pipe -----------------------------------------------------------------

// Development only (NE_APP_DEBUG=<file>): events, never URLs.
function debug(text) {
  if (process.env.NE_APP_DEBUG) fs.appendFileSync(process.env.NE_APP_DEBUG, `${new Date().toISOString()} ${text}\n`);
}

function listenForDashboard() {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096) socket.destroy(); // nothing legitimate is this long
    });
    socket.on("end", () => {
      for (const line of buffer.split("\n")) {
        if (line.trim()) receive(line);
      }
    });
    socket.on("error", () => {});
  });
  server.on("error", (error) => debug(`pipe error: ${error.code}`)); // the bot then falls back to the browser
  server.on("connection", () => debug("pipe: connection"));
  server.listen(PIPE, () => debug("pipe: listening"));
}

function receive(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return debug("pipe: not JSON, ignored");
  }
  // Only the bot's own dashboard address is accepted, so nothing else can be slipped into this window.
  if (message.open !== "dashboard" || typeof message.url !== "string" || !message.url.startsWith(`${DASHBOARD_ORIGIN}/`)) {
    return debug("pipe: rejected a message");
  }
  debug("pipe: dashboard link accepted"); // never the link itself
  tool("bot").url = message.url;
  if (views.has("bot")) load("bot"); // the bot restarted: refresh the open tab; otherwise it loads when opened
  pushState();
}

// --- menus and keys ----------------------------------------------------------------------

function contextMenu(contents, params) {
  const items = [];
  if (params.linkURL && /^https?:/i.test(params.linkURL) && !params.linkURL.startsWith(DASHBOARD_ORIGIN)) {
    items.push({ label: "Open link in browser", click: () => shell.openExternal(params.linkURL) });
    items.push({ label: "Copy link", click: () => require("electron").clipboard.writeText(params.linkURL) });
    items.push({ type: "separator" });
  }
  if (params.isEditable) {
    items.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
  } else if (params.selectionText) {
    items.push({ role: "copy" });
  }
  items.push({ type: "separator" }, { label: "Back", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
  items.push({ label: "Reload", click: () => contents.reload() });
  Menu.buildFromTemplate(items).popup();
}

function shortcuts(event, input) {
  if (input.type !== "keyDown" || !input.control) return;
  // Handled here rather than by the menu, so they work in the Terminal tab too (it ignores menu shortcuts).
  const key = input.key.toLowerCase();
  if (key === "r" && input.alt && !input.shift) {
    reloadInterface();
    return event.preventDefault();
  }
  if (key === "r" && input.shift && !input.alt) {
    sessions.restartServers();
    return event.preventDefault();
  }
  if (key === "l" && active === "live") {
    bar.webContents.focus();
    bar.webContents.send("focus-address");
    return event.preventDefault();
  }
  const index = Number(input.key) - 1;
  if (index >= 0 && index < TOOLS.length && (views.has(TOOLS[index].id) || canOpen(TOOLS[index]))) {
    select(TOOLS[index].id);
    event.preventDefault();
  }
}

function appMenu() {
  // Hidden menu bar (Alt shows it); mainly so the usual keys work: copy/paste, reload, zoom.
  return Menu.buildFromTemplate([
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload tab", accelerator: "CmdOrCtrl+R", click: () => views.get(active)?.view.webContents.reload() },
        { label: "Back", accelerator: "Alt+Left", click: () => views.get(active)?.view.webContents.navigationHistory.goBack() },
        { type: "separator" },
        { label: "Zoom in", accelerator: "CmdOrCtrl+=", click: () => zoom(0.5) },
        { label: "Zoom out", accelerator: "CmdOrCtrl+-", click: () => zoom(-0.5) },
        { label: "Reset zoom", accelerator: "CmdOrCtrl+0", click: () => views.get(active)?.view.webContents.setZoomLevel(0) },
        { type: "separator" },
        { label: "Developer tools", accelerator: "F12", click: () => views.get(active)?.view.webContents.toggleDevTools() },
      ],
    },
    {
      label: "Servers",
      submenu: [
        { label: "Restart all servers", accelerator: "CmdOrCtrl+Shift+R", registerAccelerator: false, click: () => sessions.restartServers() },
        { label: "Reload interface", accelerator: "CmdOrCtrl+Alt+R", registerAccelerator: false, click: reloadInterface },
        { label: "Show terminal", click: () => select("terminal") },
      ],
    },
    { role: "windowMenu" },
  ]);
}

function zoom(step) {
  const contents = views.get(active)?.view.webContents;
  if (contents) contents.setZoomLevel(contents.getZoomLevel() + step);
}

// --- start ---------------------------------------------------------------------------------

function start() {
  app.setAppUserModelId("NowhereExpeditions.Toolkit");
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  sessions = createSessions({
    onChange: pushState,
    onServerUp: serverUp,
    onOpenTab: (id) => canOpen(tool(id)) && select(id),
    settingsFile: path.join(app.getPath("userData"), "terminal.json"),
  });
  gitTool = createGit();
  memoryTool = createMemory({ getFolder: () => sessions.claudeFolder() });
  Menu.setApplicationMenu(appMenu());

  const bounds = loadBounds();
  win = new BaseWindow({
    width: bounds.width || 1440,
    height: bounds.height || 920,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 480,
    title: "Nowhere Expeditions",
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: "#141210",
  });
  if (bounds.maximized) win.maximize();

  bar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  bar.webContents.on("before-input-event", (event, input) => shortcuts(event, input));
  bar.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  bar.webContents.on("will-navigate", (event) => event.preventDefault());
  win.contentView.addChildView(bar);
  bar.webContents.loadFile(path.join(__dirname, "shell.html"));
  bar.webContents.on("did-finish-load", pushState);

  // Only the first tab loads now; the others load when you open them.
  const tabArg = process.argv.find((a) => a.startsWith("--tab="));
  const opens = (id) => Boolean(id && canOpen(tool(id)));
  select(tabArg && opens(tabArg.slice(6)) ? tabArg.slice(6) : opens(bounds.active) ? bounds.active : "manager");

  win.on("resize", layout);
  win.on("maximize", layout);
  win.on("unmaximize", layout);
  // Closing stops everything the app runs: ask first, then give each a moment to shut down cleanly.
  win.on("close", (event) => {
    if (closing || !sessions.anyRunning()) return saveBounds();
    if (!process.env.NE_APP_CAPTURE) {
      const choice = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: ["Close and stop them", "Keep open"],
        defaultId: 1,
        cancelId: 1,
        title: "Nowhere Expeditions",
        message: "Closing the app stops the servers, the bot and any Claude Code session.",
      });
      if (choice !== 0) return event.preventDefault();
    }
    saveBounds();
    event.preventDefault();
    closing = true;
    win.hide();
    debug("close: stopping sessions");
    sessions.stopAll().finally(() => {
      debug("close: sessions stopped");
      win?.close();
    });
  });
  win.on("closed", () => {
    debug("closed");
    win = null;
    sessions.dispose();
    app.quit();
  });

  ipcMain.on("select", (_event, id) => select(String(id)));
  ipcMain.on("navigate", (event, text) => {
    if (event.sender === bar.webContents) navigate(text);
  });
  ipcMain.on("tab-menu", (event, id) => {
    if (event.sender === bar.webContents) tabMenu(String(id));
  });
  ipcMain.on("reload", () => {
    if (active !== "terminal") views.get(active)?.view.webContents.reload();
  });
  ipcMain.on("back", () => views.get(active)?.view.webContents.navigationHistory.goBack());
  ipcMain.on("open-in-browser", () => {
    const url = views.get(active)?.view.webContents.getURL();
    if (active !== "bot" && url && (isLocal(url) || (active === "live" && webAddress(url)))) shell.openExternal(url); // the bot link holds the key: never
  });

  listenForDashboard(); // before the bot starts, so it can hand over its dashboard

  const flag = (name) => process.argv.includes(name);
  const skip = new Set(flag("--open-only") ? ["manager", "site", "insights", "bot"] : []);
  if (flag("--no-bot")) skip.add("bot");
  if (flag("--no-insights")) skip.add("insights");
  sessions.startServers(skip);

  // Self-test for development: NE_APP_CAPTURE=<file.png> saves the window after a few seconds and quits.
  if (process.env.NE_APP_CAPTURE) {
    if (process.env.NE_APP_CAPTURE_RELOAD) setTimeout(reloadInterface, Number(process.env.NE_APP_CAPTURE_RELOAD)); // test it
    // NE_APP_CAPTURE_CLICK=<CSS selector>[;;<selector>…]: clicks them in the open tab first, a second apart.
    const clicks = (process.env.NE_APP_CAPTURE_CLICK || "").split(";;").filter(Boolean);
    clicks.forEach((selector, i) =>
      setTimeout(() => views.get(active)?.view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click()`).catch(() => {}), 3500 + i * 1000),
    );
    setTimeout(async () => {
      try {
        const shot = await views.get(active).view.webContents.capturePage();
        const top = await bar.webContents.capturePage();
        fs.writeFileSync(process.env.NE_APP_CAPTURE.replace(/\.png$/, "-bar.png"), top.toPNG());
        fs.writeFileSync(process.env.NE_APP_CAPTURE, shot.toPNG());
      } catch (error) {
        debug(`capture failed: ${error.message}`);
      }
      debug("capture: quitting");
      app.quit();
    }, Number(process.env.NE_APP_CAPTURE_DELAY || 5000));
  }
}
