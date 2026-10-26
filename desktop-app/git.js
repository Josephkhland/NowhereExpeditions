// The Git tab's main-process half: status, diffs, staging, commits, branches, and publishing to main (which
// GitHub then deploys to the live site, see .github/workflows/deploy-site.yml).
//
// The page asks for named actions only; it never passes git arguments. Paths must be in the current status,
// branch names and commit hashes are checked, and nothing here force-pushes, resets or discards work.
// Works with old git (2.19 is installed): checkout rather than switch, reset rather than restore.

"use strict";

const { ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MAIN = "main";
const REMOTE = "origin";
const DIFF_LIMIT = 600_000; // characters shown; bigger diffs are cut
// Changes here make the deploy workflow run (its "paths" filter).
const DEPLOYS = [/^public-site\//, /^\.github\/workflows\/deploy-site\.yml$/, /^\.github\/versioning\.json$/, /^\.github\/scripts\/(release_version|site_changelog)\.py$/];

const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }; // never wait for a password prompt
for (const key of Object.keys(env)) if (key.startsWith("ELECTRON_")) delete env[key];

// Runs git; resolves { ok, code, out, err }. "Differences found" (exit 1) is fine for diff commands.
function git(args, { timeout = 60_000 } = {}) {
  return new Promise((resolve) => {
    execFile("git", ["-c", "core.quotepath=off", "-c", "color.ui=false", ...args], { cwd: ROOT, env, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, out, err) => {
      const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
      resolve({ ok: !error, code, out: String(out), err: String(err || (error && !err ? error.message : "")) });
    });
  });
}

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._\/-]{1,100}(?<![./])$/;
const HASH = /^[0-9a-f]{7,40}$/;

function cut(text) {
  return text.length > DIFF_LIMIT ? `${text.slice(0, DIFF_LIMIT)}\n\n… (diff cut: ${text.length.toLocaleString()} characters in all)` : text;
}

function deploys(file) {
  return DEPLOYS.some((pattern) => pattern.test(file));
}

// git status --porcelain=v2 -z --branch → branch info and files.
function parseStatus(out) {
  const info = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith("# branch.head ")) info.branch = line.slice(14) === "(detached)" ? null : line.slice(14);
    else if (line.startsWith("# branch.upstream ")) info.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const [, a, b] = line.match(/\+(\d+) -(\d+)/) || [];
      info.ahead = Number(a) || 0;
      info.behind = Number(b) || 0;
    } else if (line[0] === "1") {
      const f = line.split(" ");
      info.files.push({ path: f.slice(8).join(" "), x: f[1][0], y: f[1][1] });
    } else if (line[0] === "2") {
      const f = line.split(" ");
      info.files.push({ path: f.slice(9).join(" "), x: f[1][0], y: f[1][1], from: parts[++i] });
    } else if (line[0] === "u") {
      const f = line.split(" ");
      info.files.push({ path: f.slice(10).join(" "), x: "U", y: "U", conflict: true });
    } else if (line[0] === "?") {
      info.files.push({ path: line.slice(2), x: "?", y: "?", untracked: true });
    }
  }
  return info;
}

// %D ("HEAD -> main, tag: v1.0.8, origin/main") → chips. A branch that sits where its GitHub copy does
// becomes one chip marked as on GitHub, like VS Code shows it.
function parseRefs(text) {
  const parts = (text || "").split(", ").filter(Boolean);
  const locals = [];
  const remotes = [];
  const tags = [];
  let head = null;
  for (const part of parts) {
    if (part.startsWith("HEAD -> ")) {
      head = part.slice(8);
      locals.push(head);
    } else if (part === "HEAD") head = "HEAD";
    else if (part.startsWith("tag: ")) tags.push(part.slice(5));
    else if (part.startsWith(`${REMOTE}/`)) {
      if (part !== `${REMOTE}/HEAD`) remotes.push(part.slice(REMOTE.length + 1));
    } else locals.push(part);
  }
  const chips = [];
  for (const name of locals) chips.push({ kind: "branch", name, head: name === head, synced: remotes.includes(name), main: name === MAIN });
  for (const name of remotes) if (!locals.includes(name)) chips.push({ kind: "remote", name: `${REMOTE}/${name}`, main: name === MAIN });
  if (head === "HEAD") chips.unshift({ kind: "branch", name: "HEAD (detached)", head: true });
  for (const name of tags) chips.push({ kind: "tag", name });
  return chips;
}

function createGit() {
  let contents = null;
  let busy = false;
  let remoteWeb = null; // https://github.com/<owner>/<repo>, from the remote's address

  const send = (channel, ...args) => {
    if (contents && !contents.isDestroyed()) contents.send(channel, ...args);
  };
  const log = (text) => send("git:log", text);

  // Runs a command that changes something, showing it and its output in the Output panel.
  async function run(args, options) {
    log(`$ git ${args.join(" ")}`);
    const result = await git(args, options);
    const text = `${result.out}${result.err}`.trim();
    if (text) log(text);
    if (!result.ok) log(`(failed, exit code ${result.code})`);
    return result;
  }

  async function status() {
    const [s, branches, remote] = await Promise.all([
      git(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]),
      git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
      git(["remote", "get-url", REMOTE]),
    ]);
    if (!s.ok) return { error: s.err.trim() || "git status failed" };
    const info = parseStatus(s.out);
    const m = remote.out.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
    remoteWeb = m ? `https://github.com/${m[1]}/${m[2]}` : null;
    return { ...info, branches: branches.out.split("\n").filter(Boolean), main: MAIN, github: Boolean(remoteWeb) };
  }

  // Only paths git currently reports may be named by the page.
  async function knownFile(file) {
    const s = await status();
    return s.files?.find((f) => f.path === file) || null;
  }

  async function diff({ path: file, staged }) {
    const f = await knownFile(file);
    if (!f) return { text: "That file has no changes any more." };
    let result;
    if (f.untracked) result = await git(["diff", "--no-index", "--", "/dev/null", file]);
    else if (staged) result = await git(["diff", "--cached", "-M", "--", ...(f.from ? [f.from] : []), file]);
    else result = await git(["diff", "--", file]);
    if (!result.ok && result.code !== 1) return { text: result.err };
    return { text: cut(result.out) || "No differences (only the file mode or line endings changed)." };
  }

  async function stage({ paths }) {
    const s = await status();
    const known = new Set(s.files.map((f) => f.path));
    const list = (Array.isArray(paths) ? paths : []).filter((p) => known.has(p));
    if (list.length) await run(["add", "-A", "--", ...list]);
  }

  async function unstage({ paths }) {
    const s = await status();
    const known = new Set(s.files.map((f) => f.path).concat(s.files.map((f) => f.from).filter(Boolean)));
    const list = (Array.isArray(paths) ? paths : []).filter((p) => known.has(p));
    if (list.length) await run(["reset", "-q", "HEAD", "--", ...list]);
  }

  async function commit({ message }) {
    const text = String(message || "").trim();
    if (!text) return { error: "Write a commit message first." };
    const result = await run(["commit", "-m", text]);
    return result.ok ? { done: "Committed." } : { error: "The commit failed: see Output." };
  }

  // The commit graph: parents (for the lines) and refs (branch and tag chips), newest first.
  // scope "all": every local and GitHub branch and tag, like VS Code's graph; otherwise this branch only.
  async function history({ scope = "all" } = {}) {
    const sep = "\x1f";
    const refs = scope === "all" ? ["--branches", "--remotes", "--tags", "HEAD"] : ["HEAD"];
    const [list, unpushed, notOnMain] = await Promise.all([
      git(["log", "-200", "--date-order", `--format=%H${sep}%P${sep}%h${sep}%s${sep}%an${sep}%ar${sep}%D`, ...refs, "--"]),
      git(["rev-list", "@{u}..HEAD"]),
      git(["rev-list", `${REMOTE}/${MAIN}..HEAD`]),
    ]);
    const pending = new Set(unpushed.ok ? unpushed.out.split("\n") : []);
    const unmerged = new Set(notOnMain.ok ? notOnMain.out.split("\n") : []);
    return list.out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, parents, short, subject, author, when, decorations] = line.split(sep);
        return {
          hash,
          parents: parents ? parents.split(" ") : [],
          short,
          subject,
          author,
          when,
          refs: parseRefs(decorations),
          unpushed: pending.has(hash) || (!unpushed.ok && unmerged.has(hash)),
          unmerged: unmerged.has(hash),
        };
      });
  }

  async function showCommit({ hash }) {
    if (!HASH.test(String(hash))) return { text: "" };
    const result = await git(["show", "--stat", "--patch", "-M", "--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%w(0,4,4)%B", hash]);
    return { text: result.ok ? cut(result.out) : result.err };
  }

  async function fetch() {
    await run(["fetch", "--prune", REMOTE]);
  }

  async function pull() {
    const s = await status();
    if (!s.upstream) return { error: "This branch isn't on GitHub yet: push it first." };
    const result = await run(["pull", "--ff-only"]);
    return result.ok ? { done: "Up to date with GitHub." } : { error: "Couldn't pull without a merge (both sides have new commits). Ask Claude Code to sort it out." };
  }

  async function push() {
    const s = await status();
    if (!s.branch) return { error: "Not on a branch." };
    const result = await run(s.upstream ? ["push", REMOTE, s.branch] : ["push", "-u", REMOTE, s.branch]);
    if (!result.ok) return { error: "The push failed: see Output." };
    return { done: s.branch === MAIN ? "Pushed main: GitHub deploys the live site if public-site/ changed." : `Pushed ${s.branch}.` };
  }

  async function checkout({ branch }) {
    const s = await status();
    if (!s.branches.includes(branch)) return { error: "No such branch." };
    const result = await run(["checkout", branch]);
    return result.ok ? { done: `On ${branch}.` } : { error: "Couldn't switch: probably uncommitted changes that would be overwritten (see Output)." };
  }

  async function createBranch({ name }) {
    const branch = String(name || "").trim();
    if (!BRANCH.test(branch) || !(await git(["check-ref-format", "--branch", branch])).ok) return { error: "That isn't a usable branch name (letters, digits, - _ . / only)." };
    const result = await run(["checkout", "-b", branch]);
    return result.ok ? { done: `Created ${branch} and switched to it; your changes came along.` } : { error: "Couldn't create it: see Output." };
  }

  // What publishing would do, after fetching so it compares against GitHub's main.
  async function preview({ fetchFirst = true } = {}) {
    if (fetchFirst) await git(["fetch", "--prune", REMOTE]);
    const s = await status();
    if (s.error) return { error: s.error };
    const target = `${REMOTE}/${MAIN}`;
    const sep = "\x1f";
    const [head, commits, files, behind] = await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["log", `--format=%h${sep}%s${sep}%an${sep}%ar`, `${target}..HEAD`]),
      git(["diff", "--name-status", "-M", `${target}...HEAD`]),
      git(["rev-list", "--count", `HEAD..${target}`]),
    ]);
    const fileList = files.out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [code, ...names] = line.split("\t");
        return { status: code[0], path: names[names.length - 1], from: names.length > 1 ? names[0] : null };
      });
    const tracked = s.files.filter((f) => !f.untracked);
    const blockers = [];
    if (!s.branch) blockers.push("You're not on a branch.");
    if (s.files.some((f) => f.conflict)) blockers.push("There are unresolved merge conflicts.");
    if (s.branch === MAIN && Number(behind.out) > 0) blockers.push(`GitHub's main has ${behind.out.trim()} commit(s) you don't have: Pull first.`);
    if (s.branch && s.branch !== MAIN && tracked.length) blockers.push("Commit (or set aside) your changes first: publishing switches to main for a moment.");
    if (!commits.out.trim()) blockers.push(`Nothing to publish: ${s.branch || "this"} has no commits that GitHub's main doesn't have.`);
    return {
      branch: s.branch,
      head: head.out.trim(),
      commits: commits.out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [short, subject, author, when] = line.split(sep);
          return { short, subject, author, when };
        }),
      files: fileList,
      deploys: fileList.some((f) => deploys(f.path) || (f.from && deploys(f.from))),
      uncommitted: tracked.length + s.files.filter((f) => f.untracked).length,
      blockers,
    };
  }

  async function previewDiff({ path: file }) {
    const p = await preview({ fetchFirst: false });
    const f = p.files?.find((x) => x.path === file);
    if (!f) return { text: "" };
    const result = await git(["diff", "-M", `${REMOTE}/${MAIN}...HEAD`, "--", ...(f.from ? [f.from] : []), file]);
    return { text: result.ok ? cut(result.out) : result.err };
  }

  // On main: push it. On a branch: push the branch, merge it into main (a merge commit, like a pull request),
  // push main, and come back to the branch. Stops, and undoes the merge attempt, at the first problem.
  async function publish({ head }) {
    const p = await preview();
    if (p.error) return { error: p.error };
    if (p.head !== head) return { error: "Something changed since you looked: check the list again." };
    if (p.blockers.length) return { error: p.blockers[0] };
    const branch = p.branch;
    const done = p.deploys
      ? "Published. GitHub is deploying the live site now (usually a minute or two)."
      : "Published to main. Nothing in public-site/ changed, so the live site won't redeploy.";

    if (branch === MAIN) {
      return (await run(["push", REMOTE, MAIN])).ok ? { done, deployed: p.deploys } : { error: "The push failed: see Output." };
    }

    if (!(await run(["push", "-u", REMOTE, branch])).ok) return { error: `Couldn't push ${branch}: see Output.` };
    if (!(await run(["checkout", MAIN])).ok) return { error: "Couldn't switch to main: see Output." };
    const back = async (error) => {
      await run(["checkout", branch]);
      return { error };
    };
    if (!(await run(["merge", "--ff-only", `${REMOTE}/${MAIN}`])).ok) return back("Your local main has commits GitHub doesn't: sort that out first (ask Claude Code).");
    if (!(await run(["merge", "--no-ff", "--no-edit", "-m", `Merge branch '${branch}'`, branch])).ok) {
      await run(["merge", "--abort"]);
      return back(`${branch} doesn't merge cleanly into main (conflicts). Nothing was published; ask Claude Code to merge it.`);
    }
    if (!(await run(["push", REMOTE, MAIN])).ok) return back("The merge is done locally but pushing main failed: see Output, then Publish again.");
    await run(["checkout", branch]);
    return { done, deployed: p.deploys };
  }

  // --- the page ---------------------------------------------------------------------------------

  const actions = {
    status,
    diff,
    stage,
    unstage,
    commit,
    history,
    show: showCommit,
    fetch,
    pull,
    push,
    checkout,
    createBranch,
    preview,
    previewDiff,
    publish,
  };
  const READS = new Set(["status", "diff", "history", "show", "previewDiff"]);

  ipcMain.handle("git:run", async (event, name, args) => {
    if (!contents || event.sender !== contents || !Object.hasOwn(actions, name)) return { error: "Unknown action." };
    const params = args && typeof args === "object" ? args : {};
    if (READS.has(name)) return actions[name](params);
    if (busy) return { error: "Still busy with the last action." };
    busy = true;
    send("git:busy", true);
    try {
      return (await actions[name](params)) || {};
    } catch (error) {
      log(String(error?.message || error));
      return { error: "Something went wrong: see Output." };
    } finally {
      busy = false;
      send("git:busy", false);
    }
  });
  ipcMain.on("git:open-actions", (event) => {
    if (contents && event.sender === contents && remoteWeb) shell.openExternal(`${remoteWeb}/actions`);
  });

  return {
    attach(webContents) {
      contents = webContents;
    },
  };
}

module.exports = { createGit };
