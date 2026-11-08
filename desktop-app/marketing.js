// The Marketing tab's main-process half: reads marketing_promotion/ (the plan, action items, drafts, posted
// messages, images and videos), and the few writes the tab offers: tick an action item, copy a draft to posted/,
// new drafts from a template, the tab's own notes in board.json, and exports (PNG, PDF, text).
//
// The folder is gitignored (private planning). Files keep their own format: the tab parses them as they are,
// and anything it needs to remember (plan item done, linked content) goes into board.json beside them.
// Every path the page names must resolve inside the folder.

"use strict";

const { ipcMain, shell, clipboard, dialog } = require("./native-host");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// NE_APP_MARKETING_DIR: another folder, for testing on a copy.
const ROOT = path.resolve(process.env.NE_APP_MARKETING_DIR || path.join(__dirname, "..", "marketing_promotion"));
const BOARD = path.join(ROOT, "board.json");
const TEXT = new Set([".md", ".txt"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const VIDEO = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO = new Set([".mp3", ".wav", ".ogg", ".m4a"]);
const SKIP = new Set(["README.md", "promotion-plan.md", "action-items.md", "board.json"]);
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A path from the page → an absolute path inside the folder, or null.
function inside(relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\0")) return null;
  const full = path.resolve(ROOT, relative);
  return full.startsWith(ROOT + path.sep) ? full : null;
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch {
    return "";
  }
}

function readBoard() {
  try {
    return { items: {}, ...JSON.parse(read(BOARD)) };
  } catch {
    return { items: {} };
  }
}

function writeBoard(board) {
  fs.writeFileSync(BOARD, `${JSON.stringify(board, null, 2)}\n`);
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isRule = (line) => /^\|?\s*:?-{3,}/.test(line.trim());

// promotion-plan.md: "## Phase 1 · Title (Tue 13 → Sun 18 Oct)" then a table: Day | Post | Where | ★/☆.
function parsePlan() {
  const text = read(path.join(ROOT, "promotion-plan.md"));
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const year = Number((lines[0].match(/\b(20\d\d)\b/) || [])[1]) || new Date().getFullYear();
  const plan = { title: lines[0].replace(/^#\s*/, ""), phases: [], extras: [] };
  let phase = null;
  let section = null;
  lines.forEach((line, index) => {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      const m = heading[1].match(/^(.*?)\s*\((.*)\)\s*$/);
      phase = null;
      if (m && /→/.test(m[2])) {
        phase = { title: m[1].replace(/\s*·\s*/, " · "), range: m[2], days: rangeDays(m[2], year), goal: "", items: [] };
        plan.phases.push(phase);
      } else {
        section = { title: heading[1], lines: [] };
        plan.extras.push(section);
      }
      return;
    }
    if (phase) {
      const goal = line.match(/^Goal:\s*(.*)$/);
      if (goal) phase.goal = goal[1];
      if (/^\|/.test(line) && !isRule(line)) {
        const [day, post, where, work] = cells(line);
        if (/^day$/i.test(day)) return;
        const date = dayToDate(day, phase.days);
        phase.items.push({
          key: `${date || day}|${post}`.slice(0, 200),
          day,
          date,
          post,
          where: where || "",
          work: (work || "").includes("★") ? "big" : (work || "").includes("☆") ? "small" : "",
          drafts: [...post.matchAll(/`(drafts\/[^`]+)`/g)].map((m) => m[1]),
          line: index + 1,
        });
      } else if (line.trim() && !/^\|/.test(line) && !/^Goal:/.test(line)) phase.notes = `${phase.notes || ""}${line}\n`;
    } else if (section) {
      const check = line.match(/^\s*- \[( |x|X)\]\s+(.*)$/);
      section.lines.push(check ? { check: check[1] !== " ", text: check[2], line: index + 1 } : { text: line, line: index + 1 });
    }
  });
  return plan;
}

// "Tue 13 → Sun 18 Oct" / "Tue 27 Oct → Sun 1 Nov" / "Mon 2 → Fri 6 Nov" → every date in between.
function rangeDays(range, year) {
  const [a, b] = range.split("→").map((s) => s.trim());
  const end = b.match(/(\d{1,2})\s+([A-Za-z]{3})/);
  if (!end) return [];
  const endDate = new Date(year, MONTHS[end[2].toLowerCase()], Number(end[1]));
  const start = a.match(/(\d{1,2})(?:\s+([A-Za-z]{3}))?/);
  if (!start) return [];
  let month = start[2] ? MONTHS[start[2].toLowerCase()] : endDate.getMonth();
  if (!start[2] && Number(start[1]) > endDate.getDate()) month -= 1;
  const days = [];
  for (let d = new Date(year, month, Number(start[1])); d <= endDate && days.length < 60; d.setDate(d.getDate() + 1)) days.push(iso(d));
  return days;
}

function dayToDate(day, days) {
  const n = Number((day.match(/(\d{1,2})/) || [])[1]);
  return days.find((d) => Number(d.slice(8)) === n) || null;
}

// README.md: the "Timeline so far" table and "Upcoming milestones" bullets.
function parseReadme() {
  const text = read(path.join(ROOT, "README.md"));
  const timeline = [];
  const milestones = [];
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) section = h[1].toLowerCase();
    else if (section.startsWith("timeline") && /^\|/.test(line) && !isRule(line)) {
      const [date, where, post] = cells(line);
      if (/^\d{4}-\d\d-\d\d$/.test(date)) {
        const link = post.match(/\[([^\]]+)\]\(([^)]+)\)/);
        timeline.push({ date, where, title: link ? link[1] : post, file: link ? link[2] : null });
      }
    } else if (section.startsWith("upcoming")) {
      const m = line.match(/^-\s*(?:~|Fri |Sat |Sun |Mon |Tue |Wed |Thu )*\s*(?:~)?(\d{4}-\d\d-\d\d)(?:,\s*[^—-]*)?\s*[—-]+\s*(.*)$/);
      if (m) milestones.push({ date: m[1], title: m[2] });
    }
  }
  return { timeline, milestones };
}

// action-items.md: ### groups with "- [ ]" / "- [x]" lines (and notes in between).
function parseActions() {
  const text = read(path.join(ROOT, "action-items.md"));
  const groups = [];
  let top = "";
  let group = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const h2 = line.match(/^##\s+(.*)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    if (h2) {
      top = h2[1];
      group = { title: top, section: top, items: [] };
      groups.push(group);
    } else if (h3) {
      group = { title: h3[1], section: top, items: [] };
      groups.push(group);
    } else if (group) {
      const check = line.match(/^(\s*)- \[( |x|X)\]\s+(.*)$/);
      if (check) group.items.push({ kind: "check", done: check[2] !== " ", text: check[3], line: index + 1, indent: check[1].length });
      else if (line.trim() && !/^#/.test(line)) group.items.push({ kind: "note", text: line.replace(/^\s*-\s+/, ""), line: index + 1, indent: (line.match(/^\s*/) || [""])[0].length });
    }
  });
  return groups.filter((g) => g.items.length);
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT.has(ext)) return /\.reel\.md$/i.test(file) || /^\s*format:\s*(reel|video)/im.test(read(file).slice(0, 400)) ? "reel" : "post";
  if (IMAGE.has(ext)) return "image";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  return null;
}

function listContent() {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!(dir === ROOT && SKIP.has(entry.name))) {
        const kind = kindOf(full);
        if (!kind) continue;
        const r = rel(full);
        const stat = fs.statSync(full);
        const dated = entry.name.match(/^(\d{4}-\d\d-\d\d)-/);
        const text = kind === "post" || kind === "reel" ? read(full) : "";
        out.push({
          file: r,
          name: entry.name,
          folder: path.dirname(r) === "." ? "" : path.dirname(r),
          area: r.startsWith("posted/") ? "posted" : r.startsWith("drafts/") ? "drafts" : "other",
          kind,
          date: dated ? dated[1] : null,
          modified: stat.mtimeMs,
          size: stat.size,
          title: titleOf(text, entry.name),
          chars: text ? [...text.replace(/\r\n/g, "\n").trim()].length : 0,
          url: kind === "post" || kind === "reel" ? null : pathToFileURL(full).href,
        });
      }
    }
  };
  walk(ROOT);
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.file.localeCompare(b.file));
}

// The first bold or heading line reads best as a title ("__**GAME ANNOUNCEMENT**__").
function titleOf(text, name) {
  for (const line of text.split(/\r?\n/).slice(0, 6)) {
    const clean = line.replace(/^#+\s*/, "").replace(/[_*`]/g, "").trim();
    if (clean && !/^@/.test(clean) && clean.length <= 80 && /\*\*|^#/.test(line)) return clean;
  }
  return name.replace(/^\d{4}-\d\d-\d\d-/, "").replace(/\.(reel\.)?md$/i, "").replace(/[-_]/g, " ").replace(/^\d+\s/, "");
}

const TEMPLATES = {
  post: (title) => `__**${title.toUpperCase()}**__\n*Nowhere Expeditions: A Game of Adventuring*\n\nWrite the post here. Discord formatting works: **bold**, *italic*, __underline__, > quotes, :emoji:.\n`,
  reel: (title) =>
    `# Reel: ${title}\nformat: reel · 9:16 · about 30 seconds\nplatform: \nstatus: idea\n\n## Hook\nWhat stops the scroll in the first 2 seconds.\n\n## Shots\n| # | Time | Visual | On-screen text | Voice / sound |\n| --- | --- | --- | --- | --- |\n| 1 | 0–3s |  |  |  |\n| 2 | 3–10s |  |  |  |\n| 3 | 10–25s |  |  |  |\n| 4 | 25–30s |  | Join us on Discord |  |\n\n## Caption\n\n\n## Assets\n- Put clips and images in this folder: they show up next to the storyboard.\n`,
};

// getWindow(): the app window, so Save dialogs open on top of it (not hidden behind it).
function createMarketing({ getWindow } = {}) {
  let contents = null;
  let captured = null; // the last PNG taken, waiting for "where to save it"
  let watcher = null;
  let timer = null;

  const send = (channel, ...args) => {
    if (contents && !contents.isDestroyed()) contents.send(channel, ...args);
  };

  function load() {
    if (!fs.existsSync(ROOT)) return { missing: true, folder: ROOT };
    return { folder: ROOT, plan: parsePlan(), readme: parseReadme(), actions: parseActions(), content: listContent(), board: readBoard(), today: iso(new Date()) };
  }

  function watch() {
    if (watcher || !fs.existsSync(ROOT)) return;
    try {
      watcher = fs.watch(ROOT, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => send("mk:changed"), 400); // edits in your editor show up here
      });
    } catch {
      // Refresh by hand then.
    }
  }

  // Toggles "- [ ]" ↔ "- [x]" on one line, only if that line still says what the page saw.
  function toggle(file, line, text) {
    const full = inside(file);
    if (!full || !["action-items.md", "promotion-plan.md"].includes(rel(full))) return { error: "Only action items and the plan's checklists can be ticked." };
    const lines = read(full).split(/(?<=\n)/);
    const target = lines[line - 1];
    if (!target || !target.includes(text) || !/- \[( |x|X)\]/.test(target)) return { error: "That line changed in the file: refreshed, try again." };
    lines[line - 1] = target.replace(/- \[( |x|X)\]/, (m) => (m === "- [ ]" ? "- [x]" : "- [ ]"));
    fs.writeFileSync(full, lines.join(""));
    return { done: true };
  }

  // Copies (never moves) a draft into posted/ under today's date, as the README's convention has it.
  function markPosted(file, planKey) {
    const full = inside(file);
    if (!full || !rel(full).startsWith("drafts/") || !fs.existsSync(full)) return { error: "Only drafts can be marked as posted." };
    const slug = rel(full).slice(7).replace(/\.md$/i, "").replace(/[\\/]+/g, "-");
    const target = path.join(ROOT, "posted", `${iso(new Date())}-${slug}.md`);
    if (fs.existsSync(target)) return { error: `posted/${path.basename(target)} already exists.` };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(full, target);
    const board = readBoard();
    if (planKey) board.items[planKey] = { ...(board.items[planKey] || {}), status: "posted", posted: rel(target) };
    writeBoard(board);
    return { done: `Copied to posted/${path.basename(target)} (the draft stays). Add it to the README timeline when you like.`, file: rel(target) };
  }

  function create(kind, title) {
    const name = String(title || "").trim();
    if (!TEMPLATES[kind] || !name) return { error: "Give it a title first." };
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";
    const target = kind === "reel" ? path.join(ROOT, "drafts", "reels", slug, `${slug}.reel.md`) : path.join(ROOT, "drafts", `${slug}.md`);
    if (fs.existsSync(target)) return { error: `${rel(target)} already exists.` };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, TEMPLATES[kind](name));
    shell.openPath(target);
    return { done: `Created ${rel(target)} and opened it in your editor.`, file: rel(target) };
  }

  function setItem(key, patch) {
    if (typeof key !== "string" || key.length > 200) return { error: "Unknown plan item." };
    const board = readBoard();
    const next = { ...(board.items[key] || {}) };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!["status", "content", "note"].includes(k)) continue;
      if (v === null || v === "") delete next[k];
      else next[k] = String(v).slice(0, 2000);
    }
    if (next.content && !inside(next.content)) return { error: "That file isn't in the marketing folder." };
    if (Object.keys(next).length) board.items[key] = next;
    else delete board.items[key];
    writeBoard(board);
    return { done: true };
  }

  async function saveAs(defaultName, filters, write) {
    const options = { defaultPath: path.join(ROOT, "exports", defaultName), filters };
    const win = getWindow?.();
    // Self-test captures (NE_APP_CAPTURE) can't click a dialog: they save straight to exports/.
    const { canceled, filePath } = process.env.NE_APP_CAPTURE
      ? { canceled: false, filePath: options.defaultPath }
      : await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return {};
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await write(filePath);
    if (!process.env.NE_APP_CAPTURE) shell.showItemInFolder(filePath);
    return { done: `Saved ${path.basename(filePath)}.` };
  }

  const clean = (name) => String(name || "export").replace(/[^\w.-]+/g, "-").slice(0, 80);

  const handlers = {
    load: () => {
      watch();
      return load();
    },
    read: (file) => {
      const full = inside(file);
      return full ? { text: read(full), siblings: siblings(full) } : { error: "Not in the marketing folder." };
    },
    toggle: (file, line, text) => toggle(file, Number(line), String(text)),
    markPosted: (file, planKey) => markPosted(file, planKey ? String(planKey) : null),
    create: (kind, title) => create(String(kind), title),
    setItem: (key, patch) => setItem(key, patch),
    open: (file) => {
      const full = inside(file) || (file === "" ? ROOT : null);
      if (full) shell.openPath(full);
      return {};
    },
    reveal: (file) => {
      const full = inside(file);
      if (full) shell.showItemInFolder(full);
      return {};
    },
    copy: (text) => {
      clipboard.writeText(String(text));
      return { done: "Copied: paste it into Discord." };
    },
    openUrl: (url) => {
      if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
      return {};
    },
    exportText: (name, text) => saveAs(`${clean(name)}.txt`, [{ name: "Text", extensions: ["txt", "md"] }], (f) => fs.writeFileSync(f, String(text))),
    // A picture's bytes, so the page can draw it into a video (pictures loaded from file: URLs would make the
    // canvas unrecordable).
    readMedia: (file) => {
      const full = inside(file);
      if (!full || kindOf(full) !== "image") return { error: "Not a picture in the marketing folder." };
      return { bytes: fs.readFileSync(full) };
    },
    // A reel's rendered video, saved next to its storyboard: drafts/reels/x/x.reel.md → x.mp4 (or .webm).
    saveVideo: (file, bytes, ext) => {
      const full = inside(file);
      if (!full || !/\.reel\.md$/i.test(full) || !["mp4", "webm"].includes(ext) || !bytes?.length) return { error: "Can't save that video." };
      const target = full.replace(/\.reel\.md$/i, `.${ext}`);
      fs.writeFileSync(target, Buffer.from(bytes));
      return { done: `Saved ${rel(target)} (${(bytes.length / 1048576).toFixed(1)} MB), next to the storyboard.`, file: rel(target) };
    },
    // Two steps, so the page can put itself back before the Save dialog opens: capture, then save.
    capturePng: async (rect) => {
      const r = rect && { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      if (!r || r.width < 2 || r.height < 2) return { error: "Nothing to capture." };
      captured = (await contents.capturePage(r)).toPNG();
      return { ok: true };
    },
    savePng: async (name) => {
      if (!captured) return { error: "Nothing captured." };
      const png = captured;
      captured = null;
      return saveAs(`${clean(name)}.png`, [{ name: "PNG image", extensions: ["png"] }], (f) => fs.writeFileSync(f, png));
    },
    // The page has already filled its print area; this prints only that (see @media print in marketing.css).
    exportPdf: async (name, landscape) => {
      const pdf = await contents.printToPDF({ printBackground: true, landscape: Boolean(landscape), pageSize: "A4", margins: { marginType: "default" } });
      return saveAs(`${clean(name)}.pdf`, [{ name: "PDF", extensions: ["pdf"] }], (f) => fs.writeFileSync(f, pdf));
    },
  };

  // Images, videos and sound next to a file (a reel's footage, a post's picture).
  function siblings(full) {
    const dir = path.dirname(full);
    try {
      return fs
        .readdirSync(dir)
        .map((n) => path.join(dir, n))
        .filter((f) => f !== full && ["image", "video", "audio"].includes(kindOf(f)))
        .map((f) => ({ file: rel(f), name: path.basename(f), kind: kindOf(f), url: pathToFileURL(f).href }));
    } catch {
      return [];
    }
  }

  ipcMain.handle("mk:run", async (event, name, ...args) => {
    if (!contents || event.sender !== contents || !Object.hasOwn(handlers, name)) return { error: "Not allowed." };
    try {
      return (await handlers[name](...args)) || {};
    } catch (error) {
      return { error: error.message };
    }
  });

  return {
    attach(webContents) {
      contents = webContents;
    },
  };
}

module.exports = { createMarketing };
