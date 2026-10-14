// The Terminal tab's main-process half: the toolkit's servers and a Claude Code shell, each in its own
// pseudo-terminal, instead of a PowerShell window apiece.
//
// - Servers start with the app (unless something already answers on their port, or a --no-* flag skips them).
//   Closing the app stops them.
// - Claude Code starts only when asked (press Enter in its session): it's a few hundred MB.
// - Output outlives the page: reloading the tab replays it. The bot's output can hold its dashboard link (and key),
//   so it stays in memory and in that view only: never logged or written anywhere.
// - Only the terminal view itself may talk to it (every message is checked against its webContents).

"use strict";

const { ipcMain, clipboard } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const pty = require("node-pty");

const ROOT = path.join(__dirname, "..");
const SHELL = "powershell.exe";
const REPLAY_CHARS = 200_000;
const STOP_GRACE_MS = 3000;
const PROBE_MS = 5000;
const CAPTURE = Boolean(process.env.NE_APP_CAPTURE); // self-test: plain PowerShell instead of Claude Code

const SESSIONS = [
  // resume: "Resume last" reopens the most recent Claude Code conversation in this folder (it's saved on disk).
  { id: "claude", title: "Claude Code", cwd: ".", command: CAPTURE ? null : "claude", resume: CAPTURE ? null : "claude --continue", shell: true },
  { id: "manager", title: "Content manager", cwd: "content-manager", command: "python app.py", port: 8001 },
  { id: "site", title: "Draft site", cwd: "public-site", command: "python -m http.server 8000 --bind 127.0.0.1", port: 8000 },
  { id: "insights", title: "Table insights", cwd: "table-insights", command: "python -I app.py", port: 8002 },
  {
    id: "bot",
    title: "Discord bot",
    cwd: path.join("discord_server", "bot"),
    command: "& '.venv\\Scripts\\python.exe' run_bot.py --open-dashboard", // run_bot.py: the dashboard's Restart button works
    port: 8766,
    requires: path.join(".venv", "Scripts", "python.exe"),
  },
];

function shellEnv() {
  const env = { ...process.env, COLORTERM: "truecolor" };
  for (const key of Object.keys(env)) if (key.startsWith("ELECTRON_")) delete env[key];
  return env;
}

function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(800, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(port, open, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if ((await portAnswers(port)) === open) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const grey = (text) => `\r\n\x1b[90m[${text}]\x1b[0m\r\n`;

// The Claude Code actions tree (claude-actions.json): read fresh each time, so edits show after a tab reload.
const ACTIONS_FILE = path.join(__dirname, "claude-actions.json");

function readActions() {
  try {
    const data = JSON.parse(fs.readFileSync(ACTIONS_FILE, "utf8"));
    const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
    return (Array.isArray(data.groups) ? data.groups : []).map((group) => ({
      title: text(group.title, 80),
      items: (Array.isArray(group.items) ? group.items : [])
        .map((item) => ({ title: text(item.title, 80), description: text(item.description, 400), prompt: text(item.prompt, 4000), tab: text(item.tab, 20) }))
        .filter((item) => item.title && (item.prompt || item.tab)),
    }));
  } catch (error) {
    return { error: `Couldn't read claude-actions.json: ${error.message}` };
  }
}

function isFolder(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

// onChange(): something's status changed. onServerUp(id): a server answers on its port again after (re)starting.
// onOpenTab(id): an action asked for another tab. settingsFile: where Claude Code's folder is remembered.
function createSessions({ onChange, onServerUp, onOpenTab, settingsFile }) {
  let contents = null; // the terminal page, once open
  let size = { cols: 120, rows: 30 };
  let probe = null;

  const sessions = new Map(
    SESSIONS.map((def) => [def.id, { def, folder: path.join(ROOT, def.cwd), shell: null, replay: "", status: "idle", exitCode: null, stopping: null }]),
  );
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8")).claudeFolder;
    if (typeof saved === "string" && isFolder(saved)) sessions.get("claude").folder = saved;
  } catch {
    // First run: the repo folder.
  }

  const send = (channel, ...args) => {
    if (contents && !contents.isDestroyed()) contents.send(channel, ...args);
  };

  function output(session, data) {
    session.replay = (session.replay + data).slice(-REPLAY_CHARS);
    send("term:data", session.def.id, data);
  }

  function setStatus(session, status, note) {
    session.status = status;
    if (note) output(session, grey(note));
    send("term:state", list());
    onChange();
  }

  function list() {
    return [...sessions.values()].map((s) => ({
      id: s.def.id,
      title: s.def.title,
      server: Boolean(s.def.port),
      status: s.status,
      exitCode: s.exitCode,
      running: Boolean(s.shell),
      resumable: Boolean(s.def.resume),
      folder: s.folder,
      folderEditable: Boolean(s.def.shell),
    }));
  }

  function startable(session) {
    return !session.shell && !session.stopping && session.status !== "missing";
  }

  function spawn(session, resume = false) {
    const { def } = session;
    const command = resume && def.resume ? def.resume : def.command;
    const args = def.shell
      ? ["-NoLogo", "-NoExit", ...(command ? ["-Command", command] : [])]
      : ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", def.command]; // exits with the server, so a crash shows
    // useConptyDll: node-pty's bundled ConPTY, whose kill doesn't need a helper process (that one fails under Electron).
    const shell = pty.spawn(SHELL, args, { name: "xterm-256color", cwd: session.folder, env: shellEnv(), useConptyDll: true, ...size });
    session.shell = shell;
    session.exitCode = null;
    output(session, grey(`${resume ? "Resumed" : "Started"} ${new Date().toLocaleTimeString()}`));
    // The new console thinks the screen is empty with the cursor at the top; make it so (the notes and any
    // earlier run move to the scrollback), or its cursor moves land on the wrong lines.
    output(session, "\x1b[2J\x1b[H");
    shell.onData((data) => output(session, data));
    shell.onExit(({ exitCode }) => {
      if (session.shell !== shell) return;
      session.shell = null;
      session.exitCode = exitCode;
      const how = def.shell ? "PowerShell closed" : "Stopped";
      setStatus(session, "stopped", `${how} (exit code ${exitCode}). Press Enter to start it again.`);
    });
    setStatus(session, "running");
    if (def.port) waitForPort(def.port, true, 60).then((up) => up && session.shell === shell && onServerUp(def.id));
  }

  async function start(id, resume = false) {
    const session = sessions.get(id);
    if (!session || !startable(session)) return;
    // A server that just stopped may still hold its port for a moment.
    if (session.def.port) await waitForPort(session.def.port, false, 5);
    if (startable(session)) spawn(session, resume);
  }

  // Servers get Ctrl+C first, like closing them by hand; whatever hasn't gone after a few seconds is ended.
  // Resolves once the process has really exited (or a last few seconds have passed).
  function stop(id) {
    const session = sessions.get(id);
    if (!session?.shell) return Promise.resolve();
    if (session.stopping) return session.stopping;
    const shell = session.shell;
    const exited = new Promise((resolve) => shell.onExit(() => resolve(true)));
    const within = (ms) => Promise.race([exited, sleep(ms).then(() => false)]);
    session.stopping = (async () => {
      if (!session.def.shell) {
        shell.write("\x03");
        if (await within(STOP_GRACE_MS)) return;
      }
      if (session.shell === shell) {
        session.shell = null;
        session.exitCode = null;
        setStatus(session, "stopped", "Stopped. Press Enter to start it again.");
      }
      try {
        shell.kill();
      } catch {
        // Already gone.
      }
      await within(STOP_GRACE_MS);
    })().finally(() => {
      session.stopping = null;
    });
    return session.stopping;
  }

  async function restart(id) {
    await stop(id);
    await start(id);
  }

  async function startServers(skip) {
    for (const session of sessions.values()) {
      const { def } = session;
      if (def.shell) {
        const resume = def.resume ? ", or ⟲ to resume the last conversation" : "";
        output(session, grey(`Press Enter to start ${def.command ? "Claude Code" : "PowerShell"} in ${session.folder}${resume}.`));
        if (CAPTURE) spawn(session);
        continue;
      }
      if (def.requires && !fs.existsSync(path.join(ROOT, def.cwd, def.requires))) {
        setStatus(session, "missing", `Not set up: ${path.join(def.cwd, def.requires)} not found.`);
      } else if (await portAnswers(def.port)) {
        setStatus(session, "external", `Already running outside the app on port ${def.port}. Close that window, then press Enter to run it here.`);
      } else if (skip.has(def.id)) {
        setStatus(session, "off", "Not started (skipped at launch). Press Enter to start it.");
      } else {
        spawn(session);
      }
    }
    // Servers run elsewhere (a PowerShell window, VS Code) come and go: keep "outside the app" honest.
    probe = setInterval(async () => {
      for (const session of sessions.values()) {
        if (!["external", "off"].includes(session.status) || session.shell) continue;
        const answers = await portAnswers(session.def.port);
        if (answers && session.status === "off") setStatus(session, "external", `Now running outside the app on port ${session.def.port}.`);
        if (!answers && session.status === "external") setStatus(session, "off", "No longer running outside the app. Press Enter to start it here.");
      }
    }, PROBE_MS);
  }

  function resize(cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return;
    size = { cols, rows };
    for (const session of sessions.values()) session.shell?.resize(cols, rows);
  }

  // --- the page ---------------------------------------------------------------------------------

  const handlers = {
    "term:ready": () => {
      send("term:state", list());
      for (const session of sessions.values()) if (session.replay) send("term:replay", session.def.id, session.replay);
    },
    "term:input": (id, data) => {
      const session = sessions.get(id);
      if (!session || typeof data !== "string") return;
      if (session.shell) session.shell.write(data);
      else if (data === "\r") start(id);
    },
    "term:resize": (cols, rows) => resize(cols, rows),
    "term:start": (id) => start(id),
    "term:resume": (id) => start(id, true),
    "term:stop": (id) => stop(id),
    "term:restart": (id) => restart(id),
    "term:restart-servers": () => restartServers(),
    "term:open-tab": (id) => onOpenTab(String(id)),
    "term:copy": (text) => {
      if (typeof text === "string" && text) clipboard.writeText(text);
    },
  };

  const listeners = Object.entries(handlers).map(([channel, handler]) => {
    const listener = (event, ...args) => {
      if (contents && event.sender === contents) handler(...args);
    };
    ipcMain.on(channel, listener);
    return [channel, listener];
  });
  ipcMain.handle("term:paste", (event) => (contents && event.sender === contents ? clipboard.readText() : ""));
  ipcMain.handle("term:actions", (event) => (contents && event.sender === contents ? readActions() : []));

  // Claude Code's folder: remembered, and used from its next start. The page has already asked before a
  // running session is restarted (that ends its conversation; ⟲ resumes a folder's last one).
  ipcMain.handle("term:set-folder", async (event, id, text) => {
    const session = sessions.get(id);
    if (!contents || event.sender !== contents || !session?.def.shell) return { error: "This session's folder can't be changed." };
    const folder = path.resolve(String(text || "").trim().replace(/^"(.*)"$/, "$1") || ".");
    if (!isFolder(folder)) return { error: `No such folder: ${folder}` };
    session.folder = folder;
    try {
      fs.writeFileSync(settingsFile, JSON.stringify({ claudeFolder: folder }));
    } catch {
      // Still used for now.
    }
    send("term:state", list());
    if (session.shell) await restart(id);
    else output(session, grey(`Folder set to ${folder}. Press Enter to start here.`));
    return { folder };
  });

  // Servers the app runs (or could run): restart them all, side by side.
  function restartServers() {
    return Promise.all(
      [...sessions.values()].filter((s) => s.def.port && s.status !== "missing" && s.status !== "external").map((s) => restart(s.def.id)),
    );
  }

  return {
    list,
    startServers,
    start,
    stop,
    restart,
    restartServers,
    show: (id) => send("term:show", id),
    attach(webContents) {
      contents = webContents;
    },
    anyRunning: () => [...sessions.values()].some((s) => s.shell),
    claudeFolder: () => sessions.get("claude").folder,
    hasServer: (id) => Boolean(sessions.get(id)?.def.port),
    // Shown on the Terminal tab's dot: red when a server the app ran has stopped.
    summary: () => ([...sessions.values()].some((s) => s.def.port && s.status === "stopped") ? "exited" : "online"),
    async stopAll() {
      clearInterval(probe);
      await Promise.all([...sessions.keys()].map((id) => stop(id)));
    },
    dispose() {
      clearInterval(probe);
      for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
      ipcMain.removeHandler("term:paste");
      ipcMain.removeHandler("term:actions");
      ipcMain.removeHandler("term:set-folder");
      for (const session of sessions.values()) {
        const shell = session.shell;
        session.shell = null;
        try {
          shell?.kill();
        } catch {
          // Already gone.
        }
      }
    },
  };
}

module.exports = { createSessions };
