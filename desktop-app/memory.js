// "Claude's memory" in the Terminal tab: Claude Code's notes about the project it runs in, as a graph.
//
// Claude Code keeps them in <config>/projects/<project folder, as a slug>/memory/: one Markdown file per note
// (frontmatter name / description / metadata.type, links as [[name]]) and MEMORY.md, the index it loads at the
// start of every session. Deleting a note moves it to a memory-trash folder beside memory/ (and takes its line
// out of the index), so it can be restored from the view.

"use strict";

const { ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const INDEX = "MEMORY.md";
const NOTE = /^[\w.-]+\.md$/; // a note's file name: no folders, nothing odd

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// Claude Code names a project's folder after its path, with every other character turned into "-".
function memoryDir(projectFolder) {
  return path.join(configDir(), "projects", path.resolve(projectFolder).replace(/[^A-Za-z0-9]/g, "-"), "memory");
}

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fields = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([\w-]+):\s*(.*)$/);
      if (m && m[2] !== "") fields[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return { fields, body: match ? text.slice(match[0].length) : text };
}

// [[name]] links, leaving out ones inside `code` (examples of the site's own link syntax, say).
function links(body) {
  const plain = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...new Set([...plain.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)].map((m) => m[1].trim()))];
}

function readIndex(dir) {
  try {
    return fs.readFileSync(path.join(dir, INDEX), "utf8");
  } catch {
    return "";
  }
}

function createMemory({ getFolder }) {
  let contents = null;

  function dirs() {
    const dir = memoryDir(getFolder());
    return { dir, trash: path.join(path.dirname(dir), "memory-trash") };
  }

  function list() {
    const { dir, trash } = dirs();
    const index = readIndex(dir);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => NOTE.test(f) && f !== INDEX);
    } catch {
      return { dir, folder: getFolder(), memories: [], trash: [], missing: true };
    }
    const memories = files.map((file) => {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const { fields, body } = frontmatter(text);
      const line = index.split(/\r?\n/).find((l) => l.includes(`(${file})`)) || "";
      const hook = line.match(/^\s*-\s*\[([^\]]*)\]\([^)]*\)\s*[—-]?\s*(.*)$/);
      return {
        file,
        name: fields.name || file.replace(/\.md$/, ""),
        title: hook ? hook[1] : "",
        hook: hook ? hook[2] : "",
        description: fields.description || "",
        type: fields.type || "note",
        modified: fields.modified || fs.statSync(path.join(dir, file)).mtime.toISOString(),
        body: body.trim(),
        links: links(body),
        indexed: Boolean(line),
      };
    });
    let trashed = [];
    try {
      trashed = fs
        .readdirSync(trash)
        .filter((f) => NOTE.test(f))
        .sort()
        .reverse()
        .map((f) => ({ file: f, name: f.replace(/^\d+-/, "").replace(/\.md$/, "") }));
    } catch {
      // Nothing deleted yet.
    }
    return { dir, folder: getFolder(), memories, trash: trashed };
  }

  // Moves the note to memory-trash (with its index line beside it) and takes the line out of MEMORY.md.
  function remove(file) {
    const { dir, trash } = dirs();
    if (!NOTE.test(file) || file === INDEX || !fs.existsSync(path.join(dir, file))) return { error: "No such memory." };
    fs.mkdirSync(trash, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const target = path.join(trash, `${stamp}-${file}`);
    const index = readIndex(dir);
    const lines = index.split(/\r?\n/);
    const removed = lines.filter((l) => l.includes(`(${file})`));
    fs.renameSync(path.join(dir, file), target);
    if (removed.length) {
      fs.writeFileSync(`${target}.index`, removed.join("\n"));
      fs.writeFileSync(path.join(dir, INDEX), lines.filter((l) => !l.includes(`(${file})`)).join("\n"));
    }
    return { done: `Deleted ${file} (it's in memory-trash: Restore brings it back).` };
  }

  function restore(trashFile) {
    const { dir, trash } = dirs();
    if (!NOTE.test(trashFile)) return { error: "No such deleted memory." };
    const source = path.join(trash, trashFile);
    const file = trashFile.replace(/^\d+-/, "");
    if (!fs.existsSync(source)) return { error: "No such deleted memory." };
    if (fs.existsSync(path.join(dir, file))) return { error: `${file} exists again: delete or rename that one first.` };
    fs.renameSync(source, path.join(dir, file));
    try {
      const line = fs.readFileSync(`${source}.index`, "utf8");
      const index = readIndex(dir).replace(/\s*$/, "");
      fs.writeFileSync(path.join(dir, INDEX), `${index}\n${line}\n`);
      fs.unlinkSync(`${source}.index`);
    } catch {
      // It had no index line.
    }
    return { done: `Restored ${file}.` };
  }

  const guard = (handler) => (event, ...args) => {
    if (!contents || event.sender !== contents) return { error: "Not allowed." };
    try {
      return handler(...args);
    } catch (error) {
      return { error: error.message };
    }
  };
  ipcMain.handle("mem:list", guard(() => list()));
  ipcMain.handle("mem:delete", guard((file) => remove(String(file))));
  ipcMain.handle("mem:restore", guard((file) => restore(String(file))));

  return {
    attach(webContents) {
      contents = webContents;
    },
  };
}

module.exports = { createMemory, memoryDir };
