"use strict";

// The Marketing tab: marketing_promotion/ as a plan calendar, a next-steps checklist and a content library
// with Discord previews, reel storyboards and exports. marketing.js does all reading and writing.

const api = window.marketingApi;
const { el, inline, discord, count, reelView, gallery } = Render;
const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const PHASE_COLORS = ["#e8a530", "#7fb2e5", "#c58fe0", "#5fd0c8", "#f0a19e"]; // green is kept for "posted"
const KIND_ICON = { post: "✉", reel: "🎬", image: "🖼", video: "▶", audio: "♪" };

let data = null;
let view = "plan";
let selectedPlan = null; // plan item key
let selectedFile = null; // content file shown in the viewer
let showDone = false;

const openUrl = (url) => api.run("openUrl", url);

function notice(result) {
  const box = $("notice");
  if (!result || (!result.error && !(typeof result.done === "string"))) return;
  box.hidden = false;
  box.className = `notice ${result.error ? "bad" : "good"}`;
  box.textContent = result.error || result.done;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => (box.hidden = true), 8000);
}

const parseDate = (s) => new Date(`${s}T12:00:00`);
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nice = (s, opts = { weekday: "short", day: "numeric", month: "short" }) => parseDate(s).toLocaleDateString([], opts);
const plainTitle = (post) => {
  const bold = post.match(/\*\*([^*]+)\*\*/);
  return (bold ? bold[1] : post).replace(/[`*_]/g, "").replace(/\s*\(.*$/, "").trim().slice(0, 70);
};
const button = (text, onClick, className = "", title = "") => {
  const b = el("button", className, text);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
};

// --- plan items and their status -------------------------------------------------------------------

function planItems() {
  if (!data?.plan) return [];
  return data.plan.phases.flatMap((phase, p) => phase.items.map((item) => ({ ...item, phase, p })));
}

// done (marked, or posted through the tab) · today · late (past, not marked) · drafted · planned · skipped
function statusOf(item) {
  const saved = data.board.items[item.key] || {};
  if (saved.status === "posted" || saved.status === "done") return "done";
  if (saved.status === "skipped") return "skipped";
  if (!item.date) return "planned";
  if (item.date < data.today) return "late";
  if (item.date === data.today) return "today";
  return item.drafts.length || saved.content ? "drafted" : "planned";
}
const STATUS_TEXT = { done: "Done", skipped: "Skipped", late: "Past · not marked done", today: "Today", drafted: "Drafted", planned: "Planned" };

// --- plan view -------------------------------------------------------------------------------------

function renderPlan() {
  const items = planItems();
  renderNextUp(items);
  renderLegend();
  renderCalendar(items);
  renderPlanDetail(items);
}

function renderNextUp(items) {
  const box = $("next-up");
  box.replaceChildren();
  const today = data.today;
  const soon = isoOf(new Date(parseDate(today).getTime() + 3 * DAY));
  const late = items.filter((i) => statusOf(i) === "late");
  const upcoming = items.filter((i) => i.date >= today && i.date <= soon && !["done", "skipped"].includes(statusOf(i)));
  const head = el("div", "next-head");
  head.append(el("h2", "", "Next up"));
  const done = items.filter((i) => statusOf(i) === "done").length;
  head.append(el("span", "muted", `${done} of ${items.length} planned posts done${late.length ? ` · ${late.length} past and not marked done` : ""}`));
  box.append(head);
  const row = el("div", "next-cards");
  for (const item of [...late.slice(-3), ...upcoming]) row.append(planCard(item));
  if (!row.children.length) row.append(el("p", "muted", "Nothing due in the next few days."));
  box.append(row);
}

function planCard(item) {
  const status = statusOf(item);
  const card = el("button", `next-card status-${status}${selectedPlan === item.key ? " selected" : ""}`);
  card.type = "button";
  card.style.setProperty("--phase", PHASE_COLORS[item.p % PHASE_COLORS.length]);
  const top = el("div", "next-card-top");
  top.append(el("span", "", item.date ? nice(item.date) : item.day), el("span", `badge status-${status}`, STATUS_TEXT[status]));
  card.append(top, el("strong", "", plainTitle(item.post)), el("span", "muted small", item.where.replace(/`/g, "")));
  card.addEventListener("click", () => selectPlan(item.key));
  return card;
}

function renderLegend() {
  const box = $("legend");
  box.replaceChildren();
  data.plan?.phases.forEach((phase, p) => {
    const item = el("span", "legend-item");
    const sw = el("i");
    sw.style.background = PHASE_COLORS[p % PHASE_COLORS.length];
    item.append(sw, phase.title.replace(/^Phase \d+ · /, ""));
    item.title = `${phase.title} (${phase.range})${phase.goal ? `\n${phase.goal}` : ""}`;
    box.append(item);
  });
  const posted = el("span", "legend-item");
  posted.append(el("i", "posted-swatch"), "Posted");
  box.append(posted);
}

function renderCalendar(items) {
  const box = $("calendar");
  box.replaceChildren();
  const posted = data.content.filter((c) => c.area === "posted" && c.date);
  const dates = [...items.map((i) => i.date), ...posted.map((c) => c.date), ...data.readme.milestones.map((m) => m.date), data.today].filter(Boolean).sort();
  if (!dates.length) return box.append(el("p", "muted", "No dated plan yet."));
  const start = parseDate(dates[0]);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const end = parseDate(dates[dates.length - 1]);
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7))); // on to Sunday
  for (const name of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) box.append(el("div", "dow", name));
  const phaseOf = (iso) => data.plan?.phases.findIndex((p) => p.days.includes(iso));
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY)) {
    const iso = isoOf(d);
    const p = phaseOf(iso);
    const cell = el("div", `day${iso === data.today ? " today" : ""}${iso < data.today ? " past" : ""}`);
    if (p >= 0) cell.style.setProperty("--phase", PHASE_COLORS[p % PHASE_COLORS.length]);
    else cell.classList.add("no-phase");
    const num = el("div", "day-num", d.getDate() === 1 || iso === isoOf(start) ? d.toLocaleDateString([], { day: "numeric", month: "short" }) : String(d.getDate()));
    cell.append(num);
    for (const m of data.readme.milestones.filter((x) => x.date === iso)) {
      const flag = el("div", "milestone", `⚑ ${m.title.replace(/\s*\(.*$/, "")}`);
      flag.title = m.title;
      cell.append(flag);
    }
    for (const c of posted.filter((x) => x.date === iso)) {
      const chip = button(`✓ ${c.title}`, () => openContent(c.file), "chip-posted", `Posted: ${c.file}`);
      cell.append(chip);
    }
    for (const item of items.filter((i) => i.date === iso)) {
      const status = statusOf(item);
      const chip = button(`${item.work === "big" ? "★" : "☆"} ${plainTitle(item.post)}`, () => selectPlan(item.key), `chip-plan status-${status}${selectedPlan === item.key ? " selected" : ""}`);
      chip.title = `${STATUS_TEXT[status]} · ${item.where.replace(/`/g, "")}`;
      cell.append(chip);
    }
    box.append(cell);
  }
}

function selectPlan(key) {
  selectedPlan = selectedPlan === key ? null : key;
  if (view !== "plan") showView("plan");
  else renderPlan();
}

function renderPlanDetail(items) {
  const box = $("plan-detail");
  box.replaceChildren();
  const item = items.find((i) => i.key === selectedPlan);
  if (!item) {
    box.append(el("h3", "", data.plan?.title || "Plan"));
    for (const phase of data.plan?.phases || []) {
      const block = el("div", "phase-block");
      block.style.setProperty("--phase", PHASE_COLORS[data.plan.phases.indexOf(phase) % PHASE_COLORS.length]);
      block.append(el("strong", "", phase.title), el("span", "muted small", phase.range));
      if (phase.goal) block.append(el("p", "small", phase.goal));
      box.append(block);
    }
    box.append(el("p", "muted small", "Click a post in the calendar to see it, mark it done or link its content."));
    return;
  }
  const saved = data.board.items[item.key] || {};
  const status = statusOf(item);
  box.append(el("span", `badge status-${status}`, STATUS_TEXT[status]));
  box.append(el("h3", "", item.date ? nice(item.date, { weekday: "long", day: "numeric", month: "long" }) : item.day));
  box.append(el("p", "muted small", item.phase.title));
  const post = el("p", "plan-post");
  post.append(inline(item.post, false, openUrl));
  box.append(post);
  const where = el("p", "small");
  where.append(el("span", "muted", "Where: "), inline(item.where, false));
  box.append(where);
  box.append(el("p", "small muted", item.work === "big" ? "★ A written post from scratch" : item.work === "small" ? "☆ Short: a poll, reminder or a few lines" : ""));

  const files = new Set(item.drafts);
  if (saved.content) files.add(saved.content);
  if (saved.posted) files.add(saved.posted);
  if (files.size) {
    box.append(el("h4", "", "Content"));
    for (const f of files) {
      const matches = data.content.filter((c) => c.file === f || c.file.startsWith(f.endsWith("/") ? f : `${f}/`));
      if (!matches.length) box.append(el("p", "small muted", `${f} (not found)`));
      for (const c of matches) box.append(button(`${KIND_ICON[c.kind]} ${c.title}`, () => openContent(c.file), "link-button", c.file));
    }
  }

  const actions = el("div", "detail-actions");
  if (status !== "done") actions.append(button("✓ Mark done", () => setItem(item, { status: "done" }), "primary"));
  if (status !== "skipped") actions.append(button("Skip", () => setItem(item, { status: "skipped" })));
  if (saved.status) actions.append(button("Reset", () => setItem(item, { status: null })));
  box.append(actions);

  const link = el("label", "small field");
  link.append(el("span", "muted", "Link content"));
  const select = el("select");
  select.append(new Option("—", ""));
  for (const c of data.content) select.append(new Option(`${c.area}/${c.title}`.slice(0, 70), c.file, false, c.file === saved.content));
  select.addEventListener("change", () => setItem(item, { content: select.value || null }));
  link.append(select);
  box.append(link);

  const note = el("label", "small field");
  note.append(el("span", "muted", "Notes (kept in board.json)"));
  const area = el("textarea");
  area.rows = 3;
  area.value = saved.note || "";
  area.addEventListener("change", () => setItem(item, { note: area.value }));
  note.append(area);
  box.append(note);
}

async function setItem(item, patch) {
  const result = await api.run("setItem", item.key, patch);
  if (result.error) notice(result);
  await load();
}

// --- next steps --------------------------------------------------------------------------------------

function renderSteps() {
  const box = $("steps");
  box.replaceChildren();
  const groups = data.actions.map((g) => ({ ...g, file: "action-items.md" }));
  const questions = data.plan?.extras.find((e) => /open questions/i.test(e.title));
  if (questions) {
    groups.unshift({
      title: "Plan: open questions",
      section: "Plan",
      file: "promotion-plan.md",
      items: questions.lines.filter((l) => "check" in l).map((l) => ({ kind: "check", done: l.check, text: l.text, line: l.line, indent: 0 })),
    });
  }
  let open = 0;
  for (const group of groups) {
    const checks = group.items.filter((i) => i.kind === "check");
    const left = checks.filter((i) => !i.done).length;
    open += left;
    if (!showDone && !left && checks.length) continue;
    const card = el("div", `panel step-group${left ? "" : " all-done"}`);
    const head = el("div", "step-head");
    head.append(el("h3", "", group.title.replace(/`/g, "")), el("span", "count", checks.length ? `${checks.length - left}/${checks.length}` : ""));
    card.append(head);
    const ul = el("ul", "step-list");
    for (const item of group.items) {
      if (item.kind === "check" && item.done && !showDone) continue;
      if (item.kind === "note" && !showDone && group.section === "Done") continue;
      const li = el("li", item.kind === "check" ? `check${item.done ? " done" : ""}` : "note");
      li.style.marginLeft = `${Math.min(item.indent, 8) * 6}px`;
      if (item.kind === "check") {
        const box2 = el("input");
        box2.type = "checkbox";
        box2.checked = item.done;
        box2.addEventListener("change", async () => {
          const result = await api.run("toggle", group.file, item.line, item.text);
          if (result.error) notice(result);
          await load();
        });
        li.append(box2);
      }
      const text = el("span", "");
      text.append(inline(item.text, false, openUrl));
      li.append(text);
      ul.append(li);
    }
    card.append(ul);
    box.append(card);
  }
  $("count-steps").textContent = open ? String(open) : "";
}

// --- content library and viewer ------------------------------------------------------------------------

function renderLibrary() {
  const box = $("library");
  box.replaceChildren();
  const q = $("search").value.trim().toLowerCase();
  const list = data.content.filter((c) => !q || `${c.title} ${c.file}`.toLowerCase().includes(q));
  const groups = [
    ["Drafts", list.filter((c) => c.area === "drafts")],
    ["Posted", list.filter((c) => c.area === "posted")],
    ["Other", list.filter((c) => c.area === "other")],
  ];
  for (const [title, items] of groups) {
    if (!items.length) continue;
    box.append(el("h4", "lib-head", `${title} (${items.length})`));
    let folder = null;
    for (const c of items) {
      if (title === "Drafts" && c.folder !== folder) {
        folder = c.folder;
        if (folder !== "drafts") box.append(el("div", "lib-folder", `${folder.replace(/^drafts\//, "")}/`));
      }
      const row = el("button", `lib-item${selectedFile === c.file ? " selected" : ""}`);
      row.type = "button";
      row.append(el("span", "lib-icon", KIND_ICON[c.kind] || "•"));
      const text = el("span", "lib-text");
      text.append(el("span", "lib-title", c.title));
      const meta = el("span", "lib-meta", [c.date && nice(c.date), c.kind === "post" && `${c.chars} chars`, c.kind !== "post" && c.kind].filter(Boolean).join(" · "));
      if (c.kind === "post" && c.chars > 2000) meta.classList.add("over");
      text.append(meta);
      row.append(text);
      row.title = c.file;
      row.addEventListener("click", () => openContent(c.file));
      box.append(row);
    }
  }
  if (!box.children.length) box.append(el("p", "muted", q ? "Nothing matches." : "No content yet."));
  $("count-content").textContent = String(data.content.length);
}

function openContent(file) {
  selectedFile = file;
  if (view !== "content") showView("content");
  else {
    renderLibrary();
    renderViewer();
  }
}

async function renderViewer() {
  const bar = $("viewer-bar");
  const body = $("viewer");
  const c = data.content.find((x) => x.file === selectedFile);
  bar.replaceChildren();
  body.replaceChildren();
  if (!c) return body.append(el("p", "placeholder", "Pick a post, reel plan, image or video."));
  const info = el("div", "viewer-info");
  info.append(el("strong", "", c.title), el("span", "muted small", c.file));
  bar.append(info);
  const tools = el("div", "viewer-tools");
  bar.append(tools);

  if (c.kind === "image" || c.kind === "video" || c.kind === "audio") {
    body.append(gallery([{ ...c, name: c.name }]));
    tools.append(button("Show in folder", () => api.run("reveal", c.file)), button("Open", () => api.run("open", c.file)));
    return;
  }
  const { text = "", siblings = [] } = await api.run("read", c.file);
  if (selectedFile !== c.file) return;
  let card;
  if (c.kind === "reel") {
    card = el("div", "export-card reel-card");
    card.append(reelView(text, siblings, openUrl));
  } else {
    card = el("div", "export-card discord-card");
    const head = el("div", "discord-head");
    head.append(el("span", "discord-avatar", "NE"), el("span", "discord-name", "Nowhere Expeditions"), el("span", "discord-time", c.date ? nice(c.date) : "Draft"));
    card.append(head, discord(text, openUrl));
    if (siblings.length) card.append(gallery(siblings));
    const n = count(text);
    const counter = el("span", `counter${n > 2000 ? " over" : ""}`, `${n} / 2000 characters${n > 2000 ? (n > 4000 ? ": too long even with Nitro" : ": needs Nitro (4000) or a split") : ""}`);
    info.append(counter);
  }
  body.append(card);

  if (c.kind === "reel") tools.append(button("🎬 Render video", () => renderVideo(c, text, siblings), "primary", "Make a 1080×1920 video from the storyboard (plays through once while it records)"));
  tools.append(
    button(c.kind === "reel" ? "Copy text" : "Copy for Discord", async () => notice(await api.run("copy", text)), c.kind === "reel" ? "" : "primary", "The exact text, ready to paste"),
    button("Image", () => exportPng(card, c), "", "Save this card as a PNG"),
    button("PDF", () => exportPdf(card, c), "", "Save this as a PDF"),
    button("Text", async () => notice(await api.run("exportText", c.title, text)), "", "Save as a text file"),
  );
  if (c.area === "drafts" && c.kind === "post") {
    const plan = planItems().find((i) => i.drafts.some((d) => c.file === d || c.file.startsWith(d.endsWith("/") ? d : `${d}/`)));
    tools.append(button("Mark as posted", async () => {
      if (!confirm(`Copy ${c.file} to posted/ with today's date?${plan ? `\n\nIt also marks "${plainTitle(plan.post)}" in the plan as done.` : ""}\n\nThe draft stays where it is.`)) return;
      notice(await api.run("markPosted", c.file, plan?.key || null));
      await load();
    }, "", "Copy it to posted/ under today's date (the draft stays)"));
  }
  tools.append(button("Edit", () => api.run("open", c.file), "", "Open in your editor"), button("Show in folder", () => api.run("reveal", c.file)));
}

// --- rendering a reel into a video (marketing-video.js) -------------------------------------------------

async function renderVideo(c, text, siblings) {
  const base = c.name.replace(/\.reel\.md$/i, "");
  const existing = siblings.find((s) => s.kind === "video" && s.name.replace(/\.\w+$/, "") === base);
  if (existing && !confirm(`Replace ${existing.name} with a new render?`)) return;
  const body = $("viewer");
  const stage = el("div", "render-stage");
  const canvas = el("canvas", "render-canvas");
  const status = el("p", "", "Preparing…");
  const signal = { cancelled: false };
  const cancel = button("Cancel", () => (signal.cancelled = true));
  const info = el("div", "render-info");
  info.append(el("h3", "", "Rendering the video"), status, el("p", "muted small", "It records while it plays, so it takes as long as the reel. You can switch tabs meanwhile."), cancel);
  stage.append(canvas, info);
  body.replaceChildren(stage);
  const loadImage = async (name) => {
    const media = siblings.find((s) => s.name === name && s.kind === "image");
    if (!media) return null;
    const { bytes } = await api.run("readMedia", media.file);
    return bytes ? createImageBitmap(new Blob([bytes])) : null;
  };
  try {
    const result = await ReelVideo.render(text, canvas, loadImage, (t, total) => (status.textContent = `${Math.floor(t)}s of ${Math.round(total)}s`), signal);
    if (!result) {
      notice({ done: "Render cancelled." });
    } else {
      status.textContent = "Saving…";
      notice(await api.run("saveVideo", c.file, new Uint8Array(await result.blob.arrayBuffer()), result.ext));
    }
  } catch (error) {
    notice({ error: error.message });
  }
  await load();
  openContent(c.file);
}

// --- exports ----------------------------------------------------------------------------------------------

// PNG: the card alone on the screen for a moment, captured by the app. The page comes back straight after
// the capture (whatever happens), and only then does the Save dialog open.
async function exportPng(card, c) {
  const stage = el("div", "capture-stage");
  const copy = card.cloneNode(true);
  stage.append(copy);
  document.body.append(stage);
  document.body.classList.add("capturing");
  let captured;
  try {
    const fit = Math.min(1, (window.innerHeight - 40) / copy.offsetHeight);
    copy.style.zoom = String(fit);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = copy.getBoundingClientRect();
    captured = await api.run("capturePng", { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  } finally {
    document.body.classList.remove("capturing");
    stage.remove();
  }
  notice(captured.error ? captured : await api.run("savePng", c.title));
}

async function exportPdf(card, c) {
  const area = $("print-area");
  area.replaceChildren(card.cloneNode(true));
  try {
    notice(await api.run("exportPdf", c.title, false));
  } finally {
    area.replaceChildren();
  }
}

// The whole plan as an agenda: one table per phase, with each post's status.
async function exportPlan() {
  if (!data.plan) return;
  const area = $("print-area");
  area.replaceChildren();
  const doc = el("div", "agenda");
  doc.append(el("h1", "", data.plan.title), el("p", "muted", `Exported ${nice(data.today, { day: "numeric", month: "long", year: "numeric" })}`));
  data.plan.phases.forEach((phase, p) => {
    const h = el("h2", "", `${phase.title} · ${phase.range}`);
    h.style.borderColor = PHASE_COLORS[p % PHASE_COLORS.length];
    doc.append(h);
    if (phase.goal) doc.append(el("p", "goal", phase.goal));
    const table = el("table");
    const head = el("tr");
    for (const t of ["Day", "Post", "Where", "", "Status"]) head.append(el("th", "", t));
    table.append(head);
    for (const item of phase.items) {
      const row = el("tr");
      row.append(el("td", "nowrap", item.date ? nice(item.date) : item.day));
      const post = el("td");
      post.append(inline(item.post, false));
      const where = el("td");
      where.append(inline(item.where, false));
      row.append(post, where, el("td", "", item.work === "big" ? "★" : item.work === "small" ? "☆" : ""), el("td", "nowrap", STATUS_TEXT[statusOf({ ...item, phase, p })]));
      table.append(row);
    }
    doc.append(table);
  });
  area.append(doc);
  notice(await api.run("exportPdf", "promotion-plan", true));
  area.replaceChildren();
}

// --- views, loading, events ----------------------------------------------------------------------------

function showView(name) {
  view = name;
  for (const b of document.querySelectorAll(".views button")) b.setAttribute("aria-selected", String(b.dataset.view === name));
  for (const id of ["plan", "steps", "content"]) $(`view-${id}`).hidden = id !== name;
  render();
}

function render() {
  if (!data) return;
  if (data.missing) {
    $("view-plan").replaceChildren(el("p", "placeholder", `No marketing folder at ${data.folder}.`));
    return;
  }
  const items = planItems();
  $("summary").textContent = data.plan ? `${data.plan.title.replace(/^Promotion Plan · /, "")} · today ${nice(data.today)}` : "";
  renderSteps();
  renderLibrary();
  if (view === "plan") renderPlan(items);
  if (view === "content") renderViewer();
}

async function load() {
  data = await api.run("load");
  render();
}

for (const b of document.querySelectorAll(".views button")) b.addEventListener("click", () => showView(b.dataset.view));
$("search").addEventListener("input", renderLibrary);
$("show-done").addEventListener("change", (event) => {
  showDone = event.target.checked;
  renderSteps();
});
$("open-folder").addEventListener("click", () => api.run("open", ""));
$("export-plan").addEventListener("click", exportPlan);

let newKind = null;
function startNew(kind) {
  newKind = kind;
  $("new-kind").textContent = kind === "reel" ? "New reel plan:" : "New post:";
  $("new-form").hidden = false;
  $("new-title").focus();
}
$("new-post").addEventListener("click", () => startNew("post"));
$("new-reel").addEventListener("click", () => startNew("reel"));
$("new-cancel").addEventListener("click", () => ($("new-form").hidden = true));
$("new-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await api.run("create", newKind, $("new-title").value);
  notice(result);
  if (result.error) return;
  $("new-form").hidden = true;
  $("new-title").value = "";
  await load();
  openContent(result.file);
});

// Esc always brings the page back (an export's capture or print view, the New form).
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.body.classList.remove("capturing");
  document.querySelectorAll(".capture-stage").forEach((n) => n.remove());
  $("print-area").replaceChildren();
  $("new-form").hidden = true;
});

api.onChanged(load); // edits made in your editor (or by Claude Code) show up here
showView("plan");
load();
