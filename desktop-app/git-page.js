"use strict";

const api = window.gitApi;
const $ = (id) => document.getElementById(id);
const POLL_MS = 5000;

let state = null; // the last status
let signature = ""; // to notice changes made elsewhere (Claude Code, an editor)
let view = "changes";
let selected = null; // { kind: "file", path, staged } | { kind: "commit", hash } | { kind: "publish", path }
let plan = null; // the last publish preview
let busy = false;

// --- helpers ----------------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(result) {
  const box = $("notice");
  if (!result || (!result.error && !result.done)) return;
  box.hidden = false;
  box.className = `notice ${result.error ? "bad" : "good"}`;
  box.textContent = result.error || result.done;
}

async function act(name, args) {
  const result = await api.run(name, args);
  notice(result);
  await refresh(true);
  return result;
}

function pathNode(file) {
  const span = el("span", "path");
  const cut = file.lastIndexOf("/");
  if (cut >= 0) span.append(el("span", "dir", file.slice(0, cut + 1)));
  span.append(file.slice(cut + 1));
  span.title = file;
  return span;
}

// --- diff -------------------------------------------------------------------------------------

function lineClass(line) {
  if (line.startsWith("diff --git")) return "file-head";
  if (line.startsWith("+++") || line.startsWith("---") || /^(index |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/.test(line)) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "text";
}

function showDiff(title, text) {
  $("diff-title").textContent = title;
  const box = $("diff");
  box.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const line of (text || "").replace(/\n$/, "").split("\n")) fragment.append(el("div", `line ${lineClass(line)}`, line || " "));
  box.append(fragment);
  box.scrollTop = 0;
}

async function loadSelected() {
  if (!selected) return;
  const s = selected;
  let result;
  if (s.kind === "file") result = await api.run("diff", { path: s.path, staged: s.staged });
  else if (s.kind === "commit") result = await api.run("show", { hash: s.hash });
  else result = await api.run("previewDiff", { path: s.path });
  if (selected !== s) return; // another pick since
  const title = s.kind === "file" ? `${s.path} (${s.staged ? "staged" : "not staged"})` : s.kind === "commit" ? `commit ${s.hash.slice(0, 7)}` : `${s.path} (what publishing brings to main)`;
  showDiff(title, result.text);
}

function select(item, row) {
  selected = item;
  document.querySelectorAll(".selected").forEach((node) => node.classList.remove("selected"));
  row?.classList.add("selected");
  loadSelected();
}

function isSelected(item) {
  return selected && Object.keys(item).every((key) => selected[key] === item[key]);
}

// --- toolbar ----------------------------------------------------------------------------------

function renderToolbar() {
  const branch = $("branch");
  branch.replaceChildren();
  if (!state.branch) branch.append(el("option", "", "(no branch)"));
  for (const name of state.branches) {
    const option = el("option", "", name);
    option.value = name;
    option.selected = name === state.branch;
    branch.append(option);
  }
  const sync = $("sync");
  if (!state.upstream) sync.textContent = state.branch ? "not on GitHub yet" : "";
  else if (!state.ahead && !state.behind) sync.textContent = `in step with ${state.upstream}`;
  else sync.textContent = [state.ahead && `${state.ahead} to push`, state.behind && `${state.behind} to pull`].filter(Boolean).join(", ") + ` (${state.upstream})`;
  $("pull").disabled = !state.upstream || !state.behind;
  $("push").disabled = !state.branch || (state.upstream && !state.ahead);
}

// --- changes ----------------------------------------------------------------------------------

function fileRow(file, staged) {
  const code = staged ? file.x : file.untracked ? "?" : file.y;
  const item = { kind: "file", path: file.path, staged };
  const row = el("li", `file${isSelected(item) ? " selected" : ""}`);
  const badge = el("span", `badge ${code}`, code === "?" ? "N" : code);
  badge.title = { M: "modified", A: "added", D: "deleted", R: "renamed", U: "conflict", "?": "new file" }[code] || code;
  const button = el("button", "", staged ? "−" : "+");
  button.title = staged ? "Unstage" : "Stage";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    act(staged ? "unstage" : "stage", { paths: [file.path] });
  });
  row.append(badge, pathNode(file.path), button);
  row.addEventListener("click", () => select(item, row));
  return row;
}

function renderChanges() {
  const staged = state.files.filter((f) => !f.untracked && f.x !== "." && !f.conflict);
  const unstaged = state.files.filter((f) => f.untracked || f.conflict || f.y !== ".");
  for (const [id, list, isStaged] of [["staged", staged, true], ["unstaged", unstaged, false]]) {
    const ul = $(id);
    ul.replaceChildren();
    if (!list.length) ul.append(el("li", "empty", isStaged ? "Nothing staged." : "No other changes."));
    for (const file of list) ul.append(fileRow(file, isStaged));
  }
  $("count-staged").textContent = staged.length || "";
  $("count-unstaged").textContent = unstaged.length || "";
  $("count-changes").textContent = state.files.length || "";
  $("unstage-all").disabled = !staged.length;
  $("stage-all").disabled = !unstaged.length;
  $("commit-button").disabled = !staged.length;
  $("commit-button").textContent = staged.length ? `Commit ${staged.length} staged file${staged.length === 1 ? "" : "s"} to ${state.branch || "HEAD"}` : "Commit (stage something first)";
}

// --- history ----------------------------------------------------------------------------------

// --- the commit graph ---
// Each commit gets a lane (column); lines run from a commit down to its parents. Worked out row by row:
// `lanes` holds, per column, the commit that column is waiting for next.

const LANE = 14; // px between lanes
const ROW = 44; // px per commit row (matches .graph-row in git.css)
const COLORS = ["#e8a530", "#7fb2e5", "#3ec46d", "#c58fe0", "#f0a19e", "#5fd0c8", "#d6c36b", "#9fa8ff"];
const SVG = "http://www.w3.org/2000/svg";

function graphRows(commits) {
  const lanes = [];
  const rows = [];
  const free = () => {
    const i = lanes.indexOf(null);
    return i >= 0 ? i : lanes.length;
  };
  for (const c of commits) {
    const before = lanes.slice();
    let col = lanes.indexOf(c.hash);
    if (col < 0) col = free(); // a branch tip: a new lane starts here
    for (let j = 0; j < lanes.length; j++) if (j !== col && lanes[j] === c.hash) lanes[j] = null; // branches joining here
    const fromCommit = new Set([col]);
    lanes[col] = c.parents[0] || null;
    for (const p of c.parents.slice(1)) {
      let j = lanes.indexOf(p);
      if (j < 0) {
        j = free();
        lanes[j] = p;
      }
      fromCommit.add(j);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ commit: c, col, before, after: lanes.slice(), fromCommit });
  }
  return rows;
}

function svgLine(svg, x1, y1, x2, y2, color) {
  const path = document.createElementNS(SVG, "path");
  const mid = (y1 + y2) / 2;
  path.setAttribute("d", x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`);
  path.setAttribute("stroke", color);
  svg.append(path);
}

function graphCell(row, width) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "graph-cell");
  svg.setAttribute("width", width);
  svg.setAttribute("height", ROW);
  const x = (j) => 8 + j * LANE;
  const mid = ROW / 2;
  const color = (j) => COLORS[j % COLORS.length];
  row.before.forEach((hash, j) => {
    if (hash === null) return;
    if (hash === row.commit.hash) svgLine(svg, x(j), 0, x(row.col), mid, color(j)); // into this commit
    else svgLine(svg, x(j), 0, x(j), mid, color(j)); // passing by
  });
  row.after.forEach((hash, j) => {
    if (hash === null) return;
    if (row.fromCommit.has(j)) svgLine(svg, x(row.col), mid, x(j), ROW, color(j)); // out to a parent
    if (j !== row.col && row.before[j] != null && row.before[j] !== row.commit.hash) svgLine(svg, x(j), mid, x(j), ROW, color(j)); // passing by
  });
  const dot = document.createElementNS(SVG, "circle");
  dot.setAttribute("cx", x(row.col));
  dot.setAttribute("cy", mid);
  dot.setAttribute("r", row.commit.parents.length > 1 ? 3.5 : 4.5);
  dot.style.fill = row.commit.parents.length > 1 ? "var(--panel)" : color(row.col); // merges: a hollow dot
  dot.setAttribute("stroke", color(row.col));
  dot.setAttribute("stroke-width", "2");
  svg.append(dot);
  return svg;
}

function refChip(ref) {
  const chip = el("span", `ref ref-${ref.kind}${ref.head ? " head" : ""}${ref.main ? " main" : ""}`);
  chip.textContent = `${ref.kind === "tag" ? "◆ " : ref.kind === "remote" ? "☁ " : ""}${ref.name}${ref.synced ? " ☁" : ""}`;
  chip.title =
    ref.kind === "tag" ? `Tag ${ref.name}${/^v\d/.test(ref.name) ? ": a release of the live site" : ""}`
    : ref.kind === "remote" ? `${ref.name}: the branch on GitHub`
    : `${ref.head ? "You're on " : "Branch "}${ref.name}${ref.synced ? " (same as on GitHub)" : ""}`;
  return chip;
}

let historyScope = "all";

async function renderHistory() {
  const commits = await api.run("history", { scope: historyScope });
  const rows = graphRows(commits);
  const width = 16 + Math.max(1, ...rows.map((r) => Math.max(r.before.length, r.after.length, r.col + 1))) * LANE;
  const ul = $("history");
  ul.replaceChildren();
  for (const r of rows) {
    const c = r.commit;
    const item = { kind: "commit", hash: c.hash };
    const row = el("li", `graph-row${isSelected(item) ? " selected" : ""}`);
    const text = el("div", "graph-text");
    const top = el("div", "graph-line");
    for (const ref of c.refs) top.append(refChip(ref));
    top.append(el("span", `subject${c.parents.length > 1 ? " merge" : ""}`, c.subject));
    const meta = el("div", "meta");
    meta.append(el("span", "hash", c.short), el("span", "", `${c.author}, ${c.when}`));
    if (c.unpushed) meta.append(el("span", "tag unpushed", "not pushed"));
    text.append(top, meta);
    row.append(graphCell(r, width), text);
    row.title = c.subject;
    row.addEventListener("click", () => select(item, row));
    ul.append(row);
  }
}

// --- publish ----------------------------------------------------------------------------------

function card(className, text) {
  return el("div", `card ${className}`, text);
}

async function renderPublish(fetchFirst = true) {
  const box = $("publish");
  if (!plan) box.replaceChildren(card("quiet", "Checking GitHub…"));
  plan = await api.run("preview", { fetchFirst });
  box.replaceChildren();
  if (plan.error) return box.append(card("bad", plan.error));

  const onMain = plan.branch === "main";
  box.append(
    el("p", "", onMain
      ? "Sends main's new commits to GitHub."
      : `Merges ${plan.branch} into main (a merge commit, like a pull request), pushes main, then brings you back to ${plan.branch}.`),
  );
  if (plan.files.length) {
    box.append(plan.deploys
      ? card("good", "public-site/ changes: GitHub will deploy the live site (usually a minute or two).")
      : card("quiet", "No changes in public-site/: main updates, but the live site won't redeploy."));
  }
  if (plan.blockers.length) {
    const c = card("bad", "Can't publish yet:");
    const ul = el("ul");
    for (const b of plan.blockers) ul.append(el("li", "", b));
    c.append(ul);
    box.append(c);
  }
  if (onMain && plan.uncommitted) box.append(card("quiet", `${plan.uncommitted} uncommitted file(s) stay here: only commits are published.`));

  if (plan.commits.length) {
    box.append(el("h3", "", `Commits (${plan.commits.length})`));
    const ul = el("ul", "commits");
    for (const c of plan.commits) {
      const li = el("li");
      const meta = el("span", "meta");
      meta.append(el("span", "hash", c.short), el("span", "", `${c.author}, ${c.when}`));
      li.append(el("span", "subject", c.subject), meta);
      li.style.cursor = "default";
      ul.append(li);
    }
    box.append(ul);
  }
  if (plan.files.length) {
    box.append(el("h3", "", `Files (${plan.files.length}): click to see the diff`));
    const ul = el("ul", "files");
    for (const f of plan.files) {
      const item = { kind: "publish", path: f.path };
      const row = el("li", `file${isSelected(item) ? " selected" : ""}`);
      row.append(el("span", `badge ${f.status}`, f.status), pathNode(f.path));
      row.addEventListener("click", () => select(item, row));
      ul.append(row);
    }
    box.append(ul);
  }

  const actions = el("div", "actions");
  const go = el("button", "primary", onMain ? "Publish: push main" : `Publish: merge ${plan.branch} into main`);
  go.type = "button";
  go.disabled = Boolean(plan.blockers.length);
  go.addEventListener("click", publish);
  const watch = el("button", "", "Deploys on GitHub ↗");
  watch.type = "button";
  watch.title = "Open the repository's Actions page in your browser";
  watch.addEventListener("click", () => api.openActions());
  actions.append(go, watch);
  box.append(actions);
}

async function publish() {
  const what = plan.branch === "main" ? `push ${plan.commits.length} commit(s) on main` : `merge ${plan.branch} (${plan.commits.length} commit(s)) into main and push it`;
  const site = plan.deploys ? "\n\nThe live site will update." : "\n\nNo public-site/ changes: the live site won't redeploy.";
  if (!confirm(`Publish: ${what} to GitHub?${site}`)) return;
  const result = await api.run("publish", { head: plan.head });
  notice(result);
  plan = null;
  await refresh(true);
}

// --- views and refresh ------------------------------------------------------------------------

function showView(name) {
  view = name;
  for (const button of document.querySelectorAll(".views button")) button.setAttribute("aria-selected", String(button.dataset.view === name));
  for (const id of ["changes", "history", "publish"]) $(`view-${id}`).hidden = id !== name;
  document.querySelector(".side").classList.toggle("wide", name === "history");
  if (name === "history") renderHistory();
  if (name === "publish") renderPublish();
}

// full: also reload the history/publish view and the open diff (after an action, or by hand).
async function refresh(full = false) {
  const next = await api.run("status");
  if (next.error) {
    notice({ error: next.error });
    return;
  }
  const sig = JSON.stringify(next);
  const changed = sig !== signature;
  state = next;
  signature = sig;
  if (changed || full) {
    renderToolbar();
    renderChanges();
  }
  if (full) {
    if (view === "history") renderHistory();
    if (view === "publish") renderPublish(false);
  }
  if ((changed || full) && selected) loadSelected();
}

// --- events -----------------------------------------------------------------------------------

for (const button of document.querySelectorAll(".views button")) button.addEventListener("click", () => showView(button.dataset.view));

$("branch").addEventListener("change", (event) => act("checkout", { branch: event.target.value }));
$("new-branch").addEventListener("click", () => {
  $("branch-form").hidden = false;
  $("new-branch").hidden = true;
  $("branch-name").focus();
});
$("branch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await act("createBranch", { name: $("branch-name").value });
  if (!result.error) {
    $("branch-name").value = "";
    $("branch-form").hidden = true;
    $("new-branch").hidden = false;
  }
});
$("branch-name").addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  $("branch-form").hidden = true;
  $("new-branch").hidden = false;
});

$("history-scope").addEventListener("change", (event) => {
  historyScope = event.target.value;
  renderHistory();
});
$("fetch").addEventListener("click", () => act("fetch"));
$("pull").addEventListener("click", () => act("pull"));
$("push").addEventListener("click", () => act("push"));
$("refresh").addEventListener("click", () => {
  $("notice").hidden = true;
  plan = null;
  refresh(true);
});
$("stage-all").addEventListener("click", () => act("stage", { paths: state.files.filter((f) => f.untracked || f.conflict || f.y !== ".").map((f) => f.path) }));
$("unstage-all").addEventListener("click", () => act("unstage", { paths: state.files.filter((f) => !f.untracked && f.x !== ".").map((f) => f.path) }));

$("commit").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await act("commit", { message: $("message").value });
  if (!result.error) $("message").value = "";
});
$("message").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey) $("commit").requestSubmit();
});

api.onLog((text) => {
  const log = $("log");
  log.textContent += `${text}\n`;
  if (log.textContent.length > 200_000) log.textContent = log.textContent.slice(-150_000);
  log.scrollTop = log.scrollHeight;
});
api.onBusy((value) => {
  busy = value;
  document.body.classList.toggle("busy", value);
});

// Changes made elsewhere (Claude Code, an editor) show up on their own while this tab is open.
setInterval(() => {
  if (!busy && document.visibilityState === "visible") refresh();
}, POLL_MS);
window.addEventListener("focus", () => !busy && refresh());

showView("changes");
refresh(true);
