"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

test("service enforces page boundaries and receives the bot's dashboard protocol", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ne-tauri-test-"));
  const app = path.resolve(__dirname, "..");
  const pipe = `\\\\.\\pipe\\nowhere-tauri-test-${process.pid}`;
  const child = spawn(process.execPath, [path.join(app, "service.js"), "--open-only"], {
    cwd: app,
    env: { ...process.env, NE_APP_DATA: folder, NE_APP_PIPE: pipe },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let errors = "";
  child.stderr.on("data", data => { errors += data; });
  const waiting = new Map();
  const events = [];
  let next = 0;
  const lines = require("node:readline").createInterface({ input: child.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line);
    events.push(message);
    waiting.get(message.id)?.(message);
  });
  function request(page, channel, args = []) {
    return new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`Service timed out. ${errors}`));
      }, 15000);
      waiting.set(id, message => {
        clearTimeout(timer); waiting.delete(id); resolve(message);
      });
      child.stdin.write(JSON.stringify({ id, page, channel, args }) + "\n");
    });
  }
  async function handoff(message) {
    await new Promise((resolve, reject) => {
      const socket = net.connect(pipe);
      socket.once("error", reject);
      socket.once("connect", () => socket.end(JSON.stringify(message) + "\n", resolve));
    });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  try {
    const actions = await request("terminal", "term:actions");
    assert.ok(Array.isArray(actions.result));
    const status = await request("git", "git:run", ["status", {}]);
    assert.equal(status.error, undefined);
    assert.ok(status.result);
    const denied = await request("git", "term:actions");
    assert.equal(denied.error, "Not allowed");
    const unknown = await request("marketing", "mk:run", ["does-not-exist"]);
    assert.equal(unknown.result.error, "Not allowed.");
    await handoff({ open: "dashboard", url: "https://example.com/?key=rejected" });
    assert.equal(events.some(m => m.channel === "dashboard"), false);
    await handoff({ open: "dashboard", url: "http://127.0.0.1:8766/?key=test-only" });
    assert.ok(events.some(m => m.channel === "dashboard" && m.args[0] === "http://127.0.0.1:8766/?key=test-only"));
  } finally {
    child.stdin.end();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => { child.kill(); resolve(); }, 5000).unref();
    });
    lines.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
  assert.equal(errors, "");
});
