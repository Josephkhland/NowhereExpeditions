"use strict";

const api = window.terminalApi;
const FONT_SIZE = 14;
const STATUS_TEXT = {
  idle: "press Enter to start",
  running: "running",
  stopped: "stopped",
  external: "running outside the app",
  off: "not started",
  missing: "not set up",
};

const screens = document.getElementById("screens");
const list = document.getElementById("sessions");
const terms = new Map(); // id -> { term, fit, el }
let sessions = [];
let active = null;
let fontSize = FONT_SIZE;
// Sessions whose earlier output is being replayed (the tab was opened or reloaded). Old output holds queries
// ("what terminal are you?") that the terminal answers by typing; those answers mustn't reach the program now.
const replaying = new Set();

function copySelection(term) {
  const text = term.getSelection();
  if (!text) return false;
  api.copy(text);
  term.clearSelection();
  return true;
}

// Ctrl+V pastes text; with no text on the clipboard (say, a screenshot) the key goes through to the program.
async function paste(id, passThrough) {
  const text = await api.paste();
  if (text) terms.get(id).term.paste(text);
  else if (passThrough) api.input(id, "\x16");
}

function setFontSize(size) {
  fontSize = Math.min(32, Math.max(8, size));
  for (const { term } of terms.values()) term.options.fontSize = fontSize;
  fitAll();
}

function ensureTerm(id) {
  if (terms.has(id)) return terms.get(id);
  const el = document.createElement("div");
  el.className = "screen";
  screens.append(el);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize,
    cursorBlink: true,
    scrollback: 5000,
    scrollOnEraseInDisplay: true, // a clear screen keeps what was there in the scrollback (see spawn in terminal.js)
    theme: { background: "#141210", foreground: "#e9e2d6", cursor: "#f3ece0", selectionBackground: "#5a4e40" },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  term.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    let action = null;

    if (ctrl && key === "c" && (event.shiftKey || term.hasSelection())) action = () => copySelection(term);
    else if (ctrl && key === "v") action = () => paste(id, !event.shiftKey);
    else if (ctrl && (key === "=" || key === "+")) action = () => setFontSize(fontSize + 1);
    else if (ctrl && key === "-") action = () => setFontSize(fontSize - 1);
    else if (ctrl && key === "0") action = () => setFontSize(FONT_SIZE);
    else if (id === "claude" && event.shiftKey && key === "enter" && !event.ctrlKey && !event.altKey) action = () => api.input(id, "\x1b\r"); // new line in Claude Code
    else if (ctrl && /^[1-9]$/.test(key)) return false; // tab switching, handled by the app

    if (!action) return true;
    if (event.type === "keydown") action();
    event.preventDefault();
    return false;
  });
  term.onData((data) => {
    if (!replaying.has(id)) api.input(id, data);
  });

  const entry = { term, fit, el };
  terms.set(id, entry);
  fit.fit();
  return entry;
}

function fitAll() {
  let size = null;
  for (const { term, fit } of terms.values()) {
    fit.fit();
    size = { cols: term.cols, rows: term.rows };
  }
  if (size) api.resize(size.cols, size.rows);
}

function show(id) {
  if (!sessions.some((s) => s.id === id)) return;
  active = id;
  const { term } = ensureTerm(id);
  for (const [key, entry] of terms) entry.el.classList.toggle("shown", key === id);
  window.dispatchEvent(new CustomEvent("session-shown", { detail: id })); // closes Claude's memory if it's open
  render();
  term.focus();
}

function button(className, text, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return b;
}

function render() {
  list.replaceChildren();
  for (const s of sessions) {
    const row = document.createElement("li");
    row.className = `session${s.id === active ? " active" : ""}`;

    const select = button("select", "", s.title, () => show(s.id));
    const dot = document.createElement("span");
    dot.className = `dot ${s.status}`;
    const text = document.createElement("span");
    text.className = "label";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.title;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = s.status === "stopped" && s.exitCode !== null ? `stopped (exit ${s.exitCode})` : STATUS_TEXT[s.status] || s.status;
    text.append(name, status);
    select.replaceChildren(dot, text);
    row.append(select);

    if (s.running) {
      const ask = s.server ? null : `Restart ${s.title}? This ends the session running in it.`;
      row.append(
        button("act", "↻", `Restart ${s.title}`, () => (!ask || confirm(ask)) && api.restart(s.id)),
        button("act", "■", `Stop ${s.title}`, () => (s.server || confirm(`Stop ${s.title}?`)) && api.stop(s.id)),
      );
    } else if (s.status !== "missing") {
      if (s.resumable) row.append(button("act", "⟲", "Resume the last conversation", () => api.resume(s.id)));
      row.append(button("act", "▶", s.resumable ? `Start a new ${s.title} conversation` : `Start ${s.title}`, () => api.start(s.id)));
    }
    list.append(row);
  }
  renderFolder();
  renderActions();
}

// --- the session's folder ---------------------------------------------------------------------

const folderBar = document.getElementById("folder-bar");
const folderInput = document.getElementById("folder");
const folderNote = document.getElementById("folder-note");

function current() {
  return sessions.find((s) => s.id === active);
}

function renderFolder(note, bad = false) {
  const s = current();
  if (!s) return;
  if (document.activeElement !== folderInput) folderInput.value = s.folder;
  folderInput.readOnly = !s.folderEditable;
  folderInput.title = s.folderEditable ? `${s.title} starts in this folder. Edit it and press Enter to switch (Esc to undo).` : `${s.title} always runs here.`;
  folderNote.className = `folder-note${bad ? " bad" : ""}`;
  folderNote.textContent = note || (s.folderEditable ? (s.running ? "Enter switches (restarts it)" : "Enter to change") : "");
}

folderBar.addEventListener("submit", async (event) => {
  event.preventDefault();
  const s = current();
  if (!s?.folderEditable) return;
  const typed = folderInput.value.trim();
  if (!typed || typed === s.folder) return folderInput.blur();
  if (s.running && !confirm(`Restart ${s.title} in ${typed}?\n\nThis ends the conversation running now (⟲ reopens a folder's last conversation).`)) return;
  const result = await api.setFolder(s.id, typed);
  folderInput.blur();
  if (result.error) {
    folderInput.value = s.folder;
    renderFolder(result.error, true);
  } else {
    terms.get(s.id).term.focus();
  }
});
folderInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  folderInput.value = current()?.folder || "";
  folderInput.blur();
});
folderInput.addEventListener("blur", () => {
  const s = current();
  if (s && folderInput.value.trim() !== s.folder) folderInput.value = s.folder; // not kept unless you pressed Enter
});

// --- Claude Code actions (claude-actions.json) ---------------------------------------------------

const actionsBox = document.getElementById("actions");
const tree = document.getElementById("action-tree");
let actionButtons = [];

async function loadActions() {
  const groups = await api.actions();
  tree.replaceChildren();
  actionButtons = [];
  if (groups.error) {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = groups.error;
    return tree.append(p);
  }
  for (const group of groups) {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    const ul = document.createElement("ul");
    for (const item of group.items) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "item";
      b.textContent = item.title;
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = item.tab ? "↗ tab" : "";
      b.append(kind);
      b.title = [item.description, item.prompt && `Types: ${item.prompt}`].filter(Boolean).join("\n\n");
      b.addEventListener("click", () => runAction(item));
      if (item.prompt) actionButtons.push(b);
      li.append(b);
      ul.append(li);
    }
    details.append(summary, ul);
    tree.append(details);
  }
  renderActions();
}

function renderActions() {
  const claude = sessions.find((s) => s.id === "claude");
  actionsBox.hidden = active !== "claude";
  for (const b of actionButtons) b.disabled = !claude?.running;
  const hint = actionsBox.querySelector(".hint");
  hint.textContent = claude?.running
    ? "Click to type the request into Claude Code: fill in the <…> parts, then press Enter."
    : "Start Claude Code (▶ or ⟲) to use these. Tabs open any time.";
}

// A prompt goes into Claude Code's input, unsent: nothing runs until you press Enter.
function runAction(item) {
  if (item.tab) return api.openTab(item.tab);
  const claude = terms.get("claude");
  if (!claude || !sessions.find((s) => s.id === "claude")?.running) return;
  claude.term.paste(item.prompt);
  claude.term.focus();
}

// Right-click: copy the selection, or paste when nothing is selected (like Windows Terminal).
screens.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (active && !copySelection(terms.get(active).term)) paste(active, false);
});

document.getElementById("restart-servers").addEventListener("click", () => api.restartServers());

api.onState((state) => {
  sessions = state;
  for (const s of sessions) ensureTerm(s.id);
  if (!active) show(sessions[0].id);
  else render();
});
api.onData((id, data) => ensureTerm(id).term.write(data));
api.onReplay((id, data) => {
  replaying.add(id);
  ensureTerm(id).term.write(data, () => replaying.delete(id));
});
api.onShow((id) => show(id));

new ResizeObserver(fitAll).observe(screens);
window.addEventListener("focus", () => active && document.activeElement === document.body && terms.get(active).term.focus());
loadActions();
api.ready();
