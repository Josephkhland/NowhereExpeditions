"use strict";

// Table Insights dashboard. Everything that comes from Discord is inserted with
// textContent (via el()), never as HTML.

const app = document.getElementById("app");
const tooltip = document.getElementById("tooltip");

const KIND_LABELS = {
  "story-choice": "Story choice",
  discovery: "Discovery",
  assist: "Assist",
  character: "Character",
  mechanics: "Mechanics",
};
const KINDS = Object.keys(KIND_LABELS);
const FLAG_LABELS = {
  "long-turn": "Long turn",
  burst: "Burst",
  "spotlight-dominance": "Spotlight",
  "quiet-player": "Quiet",
};
const STATUS_LABELS = { proposed: "Open", confirmed: "Confirmed", rejected: "Rejected" };
const SERIES_SLOTS = 8;

const state = {
  sessions: [],
  session: null,
  colors: {},
  momentFilter: "all",
  humorFilter: "all",
  spotlightView: "chart",
};

// --- helpers -------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Real data (data/) or demo data (demo/, invented players). Remembered per browser.
function loadSource() {
  const fromLink = new URLSearchParams(location.search).get("source");
  if (fromLink === "demo" || fromLink === "real") return fromLink;
  try {
    return localStorage.getItem("ti-source") === "demo" ? "demo" : "real";
  } catch {
    return "real";
  }
}
state.source = loadSource();

function setSource(source) {
  state.source = source;
  try {
    localStorage.setItem("ti-source", source);
  } catch {
    // The choice just won't be remembered.
  }
  showSource();
  if (location.hash.startsWith("#/sessions/")) location.hash = "#/sessions";
  else route();
}

function showSource() {
  for (const button of document.querySelectorAll(".source-toggle button")) {
    button.setAttribute("aria-pressed", String(button.dataset.source === state.source));
  }
  document.getElementById("demo-banner").hidden = state.source !== "demo";
}

async function api(path, options = {}) {
  if (state.source === "demo" && path.startsWith("/api/")) path += `${path.includes("?") ? "&" : "?"}source=demo`;
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function pct(value) {
  return value === null || value === undefined ? "–" : `${Math.round(value * 100)}%`;
}

function formatDate(iso, withTime = false) {
  if (!iso) return "–";
  const date = new Date(iso);
  const options = { day: "numeric", month: "short", year: "numeric" };
  if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleString(undefined, options);
}

function dateRange(start, end) {
  if (!start) return "–";
  const a = formatDate(start);
  const b = formatDate(end);
  return a === b ? a : `${a} – ${b}`;
}

function sectionName(title) {
  return title.replace(/^🧵\s*/, "").replace(/\s*\(archived\)$/, "").replace(/`/g, "");
}

function personName(session, authorId) {
  const person = session.people[authorId];
  if (!person) return authorId;
  return person.character || person.name || authorId;
}

function colorOf(authorId) {
  const slot = state.colors[authorId];
  return slot ? `var(--s${slot})` : "var(--other)";
}

function swatch(authorId) {
  return el("span", { class: "swatch", style: `background:${colorOf(authorId)}` });
}

// Colors follow the player, in order of first appearance, and never change with filters.
function assignColors(session) {
  state.colors = {};
  let slot = 0;
  for (const [authorId, person] of Object.entries(session.people)) {
    if (person.role !== "player") continue;
    slot += 1;
    if (slot <= SERIES_SLOTS) state.colors[authorId] = slot;
  }
}

function players(session) {
  return Object.keys(session.people).filter((id) => session.people[id].role === "player");
}

function judged(session, sitting) {
  return sitting.player_count >= 2 && sitting.turns >= session.settings.min_sitting_turns;
}

function showTooltip(event, title, rows, authorId) {
  tooltip.replaceChildren(
    el("div", { class: "tt-title" }, authorId ? swatch(authorId) : null, title),
    ...rows.map((row) => el("div", { class: "tt-row", text: row })),
  );
  tooltip.hidden = false;
  const pad = 14;
  const box = tooltip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - pad;
  if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function setTab(name) {
  for (const link of document.querySelectorAll(".tabs a")) {
    if (link.dataset.tab === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function errorPanel(message) {
  return el("section", { class: "panel" }, el("p", { class: "error", text: message }));
}

// --- routing -------------------------------------------------------------------

async function route() {
  hideTooltip();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (parts[0] === "players") {
      setTab("players");
      await renderPlayers();
      return;
    }
    setTab("sessions");
    state.sessions = await api("/api/sessions");
    const id = parts[0] === "sessions" && parts[1] ? decodeURIComponent(parts[1]) : state.sessions[0]?.id;
    await renderSessions(id);
  } catch (error) {
    app.className = "layout single";
    app.replaceChildren(errorPanel(error.message));
  }
}

// --- sessions view -------------------------------------------------------------

async function renderSessions(id) {
  app.className = "layout";
  const list = el("ul", { class: "session-list" });
  for (const s of state.sessions) {
    list.append(el("li", {},
      el("a", { href: `#/sessions/${encodeURIComponent(s.id)}`, "aria-current": s.id === id ? "page" : null },
        el("div", { class: "title", text: s.id }),
        el("div", { class: "meta", text: `${dateRange(s.start, s.end)} · ${s.messages} messages` }),
        el("div", { class: "meta" },
          s.proposed ? el("span", { class: "badge open", text: `${s.proposed} to review` }) :
            el("span", { class: "badge ok", text: s.review === "reviewed" ? "Reviewed" : "Stats only" })),
      )));
  }
  const side = el("aside", { class: "column" },
    el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", { text: "Sessions" })),
      state.sessions.length ? list : el("p", { class: "empty", text: "No sessions yet." }),
      el("p", { class: "panel-note", style: "margin-top:12px" },
        "Add one: run analyze.py on a transcript, then the AI pass (see README)."),
    ));

  if (!id) {
    app.replaceChildren(side, el("div", { class: "column" }, el("section", { class: "panel" },
      el("p", { class: "empty", text: "Nothing to show yet. Analyse a transcript first." }))));
    return;
  }
  state.session = await api(`/api/sessions/${encodeURIComponent(id)}`);
  assignColors(state.session);
  app.replaceChildren(side, el("div", { class: "column", id: "session-view" }, ...sessionPanels(state.session)));
}

function sessionPanels(session) {
  return [
    headPanel(session),
    spotlightPanel(session),
    playersPanel(session),
    flagsPanel(session),
    momentsPanel(session),
    humorPanel(session),
  ];
}

function rerenderPanel(id, panel) {
  const old = document.getElementById(id);
  if (old) old.replaceWith(panel);
}

function headPanel(session) {
  const items = session.moments.concat(session.humor_candidates);
  const open = items.filter((i) => i.status === "proposed").length;
  const confirmed = items.filter((i) => i.status === "confirmed").length;
  const played = session.sittings.filter((s) => s.player_count);
  const start = played.length ? played[0].start : session.sittings[0]?.start;
  const end = session.sittings.reduce((max, s) => (s.end > max ? s.end : max), "");
  const reviewBadge = open
    ? el("span", { class: "badge open", text: `${open} to review` })
    : el("span", { class: "badge ok", text: session.review.status === "reviewed" ? "Reviewed" : "Stats only" });
  return el("section", { class: "panel session-head", id: "panel-head" },
    el("div", { class: "panel-head" },
      el("div", {},
        el("h2", { text: session.id }),
        el("p", { class: "meta", text: `#${session.source.channel} · ${dateRange(start, end)} · read ${formatDate(session.source.read_at)}` })),
      reviewBadge),
    el("div", { class: "tiles" },
      tile(session.source.message_count, "messages"),
      tile(players(session).length, "players"),
      tile(session.sittings.filter((s) => judged(session, s)).length, "scenes with 2+ players"),
      tile(`${confirmed}/${items.length}`, "proposals confirmed"),
    ));
}

function tile(value, label) {
  return el("div", { class: "tile" }, el("div", { class: "value", text: value }), el("div", { class: "label", text: label }));
}

// --- spotlight chart ------------------------------------------------------------

function spotlightPanel(session) {
  const rows = session.sittings.filter((s) => judged(session, s));
  const hidden = session.sittings.length - rows.length;
  const ids = players(session);
  const toggle = el("div", { class: "view-toggle", role: "group", "aria-label": "Chart or table" },
    ...["chart", "table"].map((view) => el("button", {
      type: "button",
      "aria-pressed": String(state.spotlightView === view),
      text: view === "chart" ? "Chart" : "Table",
      onclick: () => {
        state.spotlightView = view;
        rerenderPanel("panel-spotlight", spotlightPanel(session));
      },
    })));
  const legend = el("div", { class: "legend", "aria-label": "Players" },
    ...ids.map((id) => el("span", {}, swatch(id), personName(session, id))));

  let body;
  if (!rows.length) {
    body = el("p", { class: "empty", text: "No scene had two or more players and enough turns to compare." });
  } else if (state.spotlightView === "table") {
    body = el("div", { class: "table-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text: "Scene" }), el("th", { class: "num", text: "Turns" }),
        el("th", { class: "num", text: "Even share" }),
        ...ids.map((id) => el("th", { class: "num" }, personName(session, id))))),
      el("tbody", {}, ...rows.map((s) => el("tr", {},
        el("td", {}, sectionName(s.section), el("div", { class: "sub", text: formatDate(s.start, true) })),
        el("td", { class: "num", text: s.turns }),
        el("td", { class: "num", text: pct(s.even_share) }),
        ...ids.map((id) => el("td", { class: "num", text: s.authors[id] && s.authors[id].share_words !== undefined ? pct(s.authors[id].share_words) : "" })),
      )))));
  } else {
    body = el("div", {},
      el("div", { class: "bars" }, ...rows.map((s) => spotlightRow(session, s))),
      el("div", { class: "axis-row", "aria-hidden": "true" }, el("span"),
        el("div", { class: "axis" }, el("span", { text: "0%" }), el("span", { text: "50%" }), el("span", { text: "100% of player words" }))));
  }

  return el("section", { class: "panel", id: "panel-spotlight" },
    el("div", { class: "panel-head" }, el("h2", { text: "Spotlight by scene" }), toggle),
    el("p", { class: "panel-note", style: "margin-bottom:12px" },
      "Share of player words in each scene (a stretch of play without a long pause). The GM isn't counted. Compare a bar with its even share, not with other scenes."),
    rows.length && state.spotlightView === "chart" ? legend : null,
    body,
    hidden ? el("p", { class: "panel-note", style: "margin-top:10px",
      text: `${hidden} shorter scenes (under ${session.settings.min_sitting_turns} turns or a single player) aren't shown.` }) : null,
  );
}

function spotlightRow(session, sitting) {
  const track = el("div", { class: "bar-track", role: "img",
    "aria-label": `${sectionName(sitting.section)}: ` + players(session).filter((id) => sitting.authors[id])
      .map((id) => `${personName(session, id)} ${pct(sitting.authors[id].share_words)}`).join(", ") });
  const present = players(session).filter((id) => sitting.authors[id] && sitting.authors[id].words > 0);
  for (const id of present) {
    const stats = sitting.authors[id];
    const share = stats.share_words;
    const seg = el("div", { class: "seg", style: `flex:${share} 1 0;background:${colorOf(id)}` },
      share >= 0.1 ? el("span", { class: "seg-label", text: pct(share) }) : null);
    seg.addEventListener("mousemove", (event) => showTooltip(event, personName(session, id), [
      `${pct(share)} of player words (even share ${pct(sitting.even_share)})`,
      `${stats.words} words in ${stats.turns} turns`,
    ], id));
    seg.addEventListener("mouseleave", hideTooltip);
    track.append(seg);
  }
  const quiet = sitting.quiet.length ? ` · quiet: ${sitting.quiet.map((id) => personName(session, id)).join(", ")}` : "";
  return el("div", { class: "bar-row" },
    el("div", { class: "bar-label" },
      el("div", { class: "name", text: sectionName(sitting.section) }),
      el("div", { class: "meta", text: `${formatDate(sitting.start, true)} · ${sitting.turns} turns · ${sitting.player_count} players${quiet}` })),
    track);
}

// --- players table ---------------------------------------------------------------

function sceneShare(session, id) {
  const scenes = session.sittings.filter((s) => judged(session, s) && s.authors[id]);
  if (!scenes.length) return null;
  const share = scenes.reduce((sum, s) => sum + (s.authors[id].share_words || 0), 0) / scenes.length;
  const even = scenes.reduce((sum, s) => sum + s.even_share, 0) / scenes.length;
  return { share, even, scenes: scenes.length };
}

function shareBar(id, value, marker) {
  return el("span", { class: "share-cell" },
    el("span", { text: pct(value) }),
    el("span", { class: "share-bar", "aria-hidden": "true" },
      el("i", { style: `width:${Math.min(100, value * 100)}%;background:${colorOf(id)}` }),
      marker !== undefined ? el("b", { style: `left:calc(${Math.min(100, marker * 100)}% - 1px)` }) : null));
}

function playersPanel(session) {
  const ids = players(session);
  const momentCounts = (id) => {
    const mine = session.moments.filter((m) => m.author_id === id && m.status !== "rejected");
    const confirmed = mine.filter((m) => m.status === "confirmed").length;
    return { confirmed, open: mine.length - confirmed };
  };
  const gm = Object.keys(session.people).filter((id) => session.people[id].role === "gm");
  const rows = ids.map((id) => {
    const p = session.people[id];
    const scene = sceneShare(session, id);
    const counts = momentCounts(id);
    return el("tr", {},
      el("td", {}, el("span", { class: "who" }, swatch(id), personName(session, id)),
        el("div", { class: "sub", text: p.player || p.name }),
        p.note ? el("div", { class: "sub", text: `Note: ${p.note}` }) : null),
      el("td", { class: "num", text: p.turns }),
      el("td", { class: "num", text: p.words }),
      el("td", { class: "num" }, shareBar(id, p.share_words)),
      el("td", { class: "num" }, scene ? shareBar(id, scene.share, scene.even) : "–",
        scene ? el("div", { class: "sub", text: `${scene.scenes} scenes · even ${pct(scene.even)}` }) : null),
      el("td", { class: "num", text: `${p.words_per_turn.median} / ${p.words_per_turn.p90} / ${p.words_per_turn.max}` }),
      el("td", { class: "num", text: p.response_minutes.median ?? "–" }),
      el("td", { class: "num", text: p.rolls }),
      el("td", { class: "num", text: counts.open ? `${counts.confirmed} (+${counts.open} open)` : counts.confirmed }),
    );
  });
  const gmRows = gm.map((id) => {
    const p = session.people[id];
    return el("tr", {},
      el("td", {}, el("span", { class: "who", text: personName(session, id) }), el("div", { class: "sub", text: "GM" })),
      el("td", { class: "num", text: p.turns }), el("td", { class: "num", text: p.words }),
      el("td", { class: "num", text: "–" }), el("td", { class: "num", text: "–" }),
      el("td", { class: "num", text: `${p.words_per_turn.median} / ${p.words_per_turn.p90} / ${p.words_per_turn.max}` }),
      el("td", { class: "num", text: p.response_minutes.median ?? "–" }),
      el("td", { class: "num", text: p.rolls }), el("td", { class: "num", text: "–" }));
  });
  return el("section", { class: "panel", id: "panel-players" },
    el("div", { class: "panel-head" }, el("h2", { text: "Players" })),
    el("div", { class: "table-wrap" }, el("table", {},
      el("thead", {}, el("tr", {},
        el("th", { text: "Player" }), el("th", { class: "num", text: "Turns" }), el("th", { class: "num", text: "Words" }),
        el("th", { class: "num", text: "Share overall" }), el("th", { class: "num", text: "Share in scenes" }),
        el("th", { class: "num", text: "Words / turn (median · p90 · max)" }), el("th", { class: "num", text: "Reply (min)" }),
        el("th", { class: "num", text: "Rolls" }), el("th", { class: "num", text: "Moments" }))),
      el("tbody", {}, ...rows, ...gmRows))),
    el("p", { class: "panel-note", style: "margin-top:10px" },
      "Share overall grows with how many threads someone joined. Share in scenes is the fairer one: the average of their share in scenes they were part of, with the even share marked."),
  );
}

// --- flags ----------------------------------------------------------------------

function flagsPanel(session) {
  const settings = session.settings;
  const list = session.flags.length
    ? el("ul", { class: "flags" }, ...session.flags.map((f) => el("li", {},
      el("span", { class: "badge", text: FLAG_LABELS[f.kind] || f.kind }),
      el("span", { class: "kind" }, el("span", { class: "who", style: "display:inline-flex;gap:6px;align-items:center" },
        swatch(f.author_id), personName(session, f.author_id))),
      el("span", { class: "detail", text: `${sectionName(f.section)} · ${formatDate(f.at, true)} · ${f.detail}` }))))
    : el("p", { class: "empty", text: "Nothing flagged in this session." });
  return el("section", { class: "panel", id: "panel-flags" },
    el("div", { class: "panel-head" }, el("h2", { text: "Worth a look" })),
    list,
    el("p", { class: "panel-note", style: "margin-top:10px",
      text: `Flags: a turn of ${settings.long_turn_words}+ words; ${settings.burst_messages}+ messages in a row with ${settings.burst_words}+ words; one player with ${settings.dominance_factor}× the even share in a scene of ${settings.min_players_for_balance}+ players; someone with ${settings.quiet_max_turns} turn or fewer in a scene of ${settings.min_sitting_turns}+ turns. Check the scene before acting on any of them.` }),
  );
}

// --- review: moments and humor ----------------------------------------------------

function filterButtons(current, onPick, items) {
  const counts = { all: items.length };
  for (const status of Object.keys(STATUS_LABELS)) counts[status] = items.filter((i) => i.status === status).length;
  return el("div", { class: "filters", role: "group", "aria-label": "Filter by status" },
    ...["all", "proposed", "confirmed", "rejected"].map((key) => el("button", {
      type: "button",
      "aria-pressed": String(current === key),
      text: `${key === "all" ? "All" : STATUS_LABELS[key]} ${counts[key]}`,
      onclick: () => onPick(key),
    })));
}

function momentsPanel(session) {
  const filter = state.momentFilter;
  const visible = session.moments.filter((m) => filter === "all" || m.status === filter);
  const groups = [];
  for (const id of players(session)) {
    const mine = visible.filter((m) => m.author_id === id);
    const total = session.moments.filter((m) => m.author_id === id && m.status !== "rejected").length;
    if (!mine.length && filter !== "all") continue;
    groups.push(el("div", { class: "group" },
      el("div", { class: "group-head" }, swatch(id), el("h3", { text: personName(session, id) }),
        el("span", { class: "count", text: total ? `${total} moment${total === 1 ? "" : "s"}` : "no moments yet: worth a look" })),
      mine.length ? el("div", { class: "cards" }, ...mine.map((m) => momentCard(session, m))) : null));
  }
  return el("section", { class: "panel", id: "panel-moments" },
    el("div", { class: "panel-head" }, el("h2", { text: "Moments" }),
      filterButtons(filter, (key) => {
        state.momentFilter = key;
        rerenderPanel("panel-moments", momentsPanel(state.session));
      }, session.moments)),
    session.moments.length
      ? el("p", { class: "panel-note", style: "margin-bottom:12px",
        text: "Proposed by the AI reading pass. Confirm what really mattered; reject what didn't. The goal is that everyone had at least one, not that anyone had the most." })
      : el("p", { class: "empty", text: "No moments yet. Run the AI reading pass (moments.py import)." }),
    ...groups);
}

function humorPanel(session) {
  const filter = state.humorFilter;
  const items = session.humor_candidates
    .filter((h) => filter === "all" || h.status === filter)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return el("section", { class: "panel", id: "panel-humor" },
    el("div", { class: "panel-head" }, el("h2", { text: "Funny moments" }),
      filterButtons(filter, (key) => {
        state.humorFilter = key;
        rerenderPanel("panel-humor", humorPanel(state.session));
      }, session.humor_candidates)),
    session.humor_candidates.length
      ? el("p", { class: "panel-note", style: "margin-bottom:12px",
        text: "Candidates for a community poll, ranked by the AI. Only moments everyone in them agreed to can be featured." })
      : el("p", { class: "empty", text: "No candidates yet." }),
    items.length ? el("div", { class: "cards" }, ...items.map((h) => humorCard(session, h))) : null);
}

function contextToggle(session, item) {
  const box = el("div");
  const button = el("button", { type: "button", class: "linkish",
    text: `#${item.message_numbers[0]} · ${sectionName(item.section)} · ${formatDate(item.at, true)} · show context` });
  let open = false;
  button.addEventListener("click", async () => {
    open = !open;
    if (!open) {
      box.replaceChildren();
      button.textContent = button.textContent.replace("hide context", "show context");
      return;
    }
    button.textContent = button.textContent.replace("show context", "hide context");
    box.replaceChildren(el("p", { class: "panel-note", text: "Loading…" }));
    try {
      const first = item.message_numbers[0];
      const last = item.message_numbers[item.message_numbers.length - 1];
      const middle = Math.round((first + last) / 2);
      const radius = Math.min(12, Math.ceil((last - first) / 2) + 3);
      const data = await api(`/api/sessions/${encodeURIComponent(session.id)}/context?n=${middle}&radius=${radius}`);
      const lines = data.messages.map((m) => {
        const reactions = m.reactions.map((r) => `${r.emoji} ${r.count}`).join(" ");
        const head = `#${m.n} · ${m.name} · ${formatDate(m.time, true)}${reactions ? ` · ${reactions}` : ""}`;
        return el("div", { class: item.message_numbers.includes(m.n) ? "msg focus" : "msg" },
          el("div", { class: "head", text: head }),
          el("div", { class: "body", text: m.content }));
      });
      box.replaceChildren(el("div", { class: "context" }, ...lines));
    } catch (error) {
      box.replaceChildren(el("p", { class: "error", text: error.message }));
    }
  });
  return [button, box];
}

function reviewControls(session, item, extra = []) {
  const note = el("textarea", { class: "note", rows: "1", placeholder: "GM note (optional)", "aria-label": "GM note" });
  note.value = item.gm_note || "";
  const status = el("span", { class: "saved", "aria-live": "polite" });
  const send = async (body) => {
    status.className = "saved";
    status.textContent = "Saving…";
    try {
      state.session = await api(`/api/sessions/${encodeURIComponent(session.id)}/items/${item.id}`,
        { method: "POST", body: JSON.stringify(body) });
      afterWrite(item.id);
    } catch (error) {
      status.className = "error";
      status.textContent = error.message;
    }
  };
  note.addEventListener("change", () => send({ note: note.value }));
  const verdict = (key, label, cls) => el("button", {
    type: "button", class: cls,
    "aria-pressed": String(item.status === (key === "confirm" ? "confirmed" : "rejected")),
    text: label,
    onclick: () => send({ verdict: item.status === (key === "confirm" ? "confirmed" : "rejected") ? "reset" : key, note: note.value }),
  });
  return [note, el("div", { class: "actions" },
    verdict("confirm", "✓ Confirm", "confirm"),
    verdict("reject", "✕ Reject", "reject"),
    ...extra,
    status)];
}

function statusBadge(item) {
  const cls = item.status === "confirmed" ? "badge ok" : item.status === "rejected" ? "badge no" : "badge open";
  return el("span", { class: cls, text: STATUS_LABELS[item.status] });
}

function momentCard(session, m) {
  const helped = m.helped.length
    ? el("p", { class: "signals" }, "Helped: ", ...m.helped.map((id, i) => el("span", {},
      i ? ", " : "", swatch(id), " ", personName(session, id))))
    : null;
  return el("article", { class: "card", "data-status": m.status, "data-item": m.id },
    el("div", { class: "card-top" }, el("span", { class: "badge kind", text: KIND_LABELS[m.kind] || m.kind }), statusBadge(m)),
    el("p", { class: "summary", text: m.summary }),
    m.why ? el("p", { class: "why", text: m.why }) : null,
    m.quote ? el("blockquote", { text: m.quote }) : null,
    helped,
    ...contextToggle(session, m),
    ...reviewControls(session, m));
}

function humorCard(session, h) {
  const reactions = Object.entries(h.signals.reactions);
  const laughs = h.signals.laughing_replies.length;
  const signals = [
    reactions.length ? reactions.map(([emoji, count]) => `${emoji} ${count}`).join(" ") : "no reactions",
    `${laughs} laughing repl${laughs === 1 ? "y" : "ies"}`,
  ].join(" · ");
  const feature = el("select", { "aria-label": "Featured players agreed?" },
    el("option", { value: "null", text: "Consent: not asked" }),
    el("option", { value: "true", text: "Consent: everyone agreed" }),
    el("option", { value: "false", text: "Consent: declined" }));
  feature.value = String(h.feature_ok);
  feature.addEventListener("change", async () => {
    try {
      state.session = await api(`/api/sessions/${encodeURIComponent(session.id)}/items/${h.id}`,
        { method: "POST", body: JSON.stringify({ feature_ok: JSON.parse(feature.value) }) });
      afterWrite(h.id);
    } catch (error) {
      feature.after(el("span", { class: "error", text: error.message }));
    }
  });
  return el("article", { class: "card", "data-status": h.status, "data-item": h.id },
    el("div", { class: "card-top" },
      el("span", { class: "rank", text: h.rank ? `#${h.rank}` : "" }),
      ...h.authors.map((id) => el("span", { class: "badge" }, swatch(id), personName(session, id))),
      statusBadge(h),
      h.feature_ok === true ? el("span", { class: "badge ok", text: "OK to feature" }) : null,
      h.feature_ok === false ? el("span", { class: "badge no", text: "Don't feature" }) : null),
    el("p", { class: "why", text: h.setup }),
    h.quote ? el("blockquote", { text: h.quote }) : null,
    el("p", { class: "signals", text: signals }),
    ...contextToggle(session, h),
    ...reviewControls(session, h, [feature]));
}

// After a save: redraw the one card in place (keeps open context panels elsewhere) and the counters.
function afterWrite(itemId) {
  const session = state.session;
  const old = document.querySelector(`[data-item="${itemId}"]`);
  const moment = session.moments.find((m) => m.id === itemId);
  const humor = session.humor_candidates.find((h) => h.id === itemId);
  if (old && moment) old.replaceWith(momentCard(session, moment));
  if (old && humor) old.replaceWith(humorCard(session, humor));
  rerenderPanel("panel-head", headPanel(session));
  rerenderPanel("panel-players", playersPanel(session));
  const groupCounts = document.querySelectorAll("#panel-moments .group");
  if (moment && groupCounts.length) {
    // Group headers show live totals; rebuild them cheaply by re-rendering only their count text.
    for (const group of groupCounts) {
      const card = group.querySelector(`[data-item="${itemId}"]`);
      if (!card) continue;
      const total = session.moments.filter((m) => m.author_id === moment.author_id && m.status !== "rejected").length;
      group.querySelector(".count").textContent = total ? `${total} moment${total === 1 ? "" : "s"}` : "no moments yet: worth a look";
    }
  }
  api("/api/sessions").then((sessions) => {
    state.sessions = sessions;
    const entry = sessions.find((s) => s.id === session.id);
    const link = document.querySelector(`.session-list a[aria-current="page"] .meta:last-child`);
    if (entry && link) {
      link.replaceChildren(entry.proposed
        ? el("span", { class: "badge open", text: `${entry.proposed} to review` })
        : el("span", { class: "badge ok", text: entry.review === "reviewed" ? "Reviewed" : "Stats only" }));
    }
  }).catch(() => {});
}

// --- players view (across sessions) -------------------------------------------------

async function renderPlayers() {
  app.className = "layout single";
  const list = await api("/api/players");
  const kindCell = (p, kind) => {
    const confirmed = p.kinds[kind] || 0;
    const open = p.kinds_proposed[kind] || 0;
    return el("td", { class: "num" }, String(confirmed), open ? el("span", { class: "sub", text: ` +${open}` }) : null);
  };
  const rows = list.map((p) => {
    const scenes = p.sessions.filter((s) => s.sitting_share !== null);
    const share = scenes.length ? scenes.reduce((a, s) => a + s.sitting_share, 0) / scenes.length : null;
    const even = scenes.length ? scenes.reduce((a, s) => a + s.even_share, 0) / scenes.length : null;
    const last = p.sessions[p.sessions.length - 1];
    return el("tr", {},
      el("td", {}, el("span", { class: "who", text: p.names.join(", ") || p.player }), el("div", { class: "sub", text: p.player })),
      el("td", { class: "num", text: p.sessions.length }),
      el("td", { class: "num", text: last ? formatDate(last.end || last.start) : "–" }),
      el("td", { class: "num", text: share === null ? "–" : `${pct(share)} (even ${pct(even)})` }),
      ...KINDS.map((kind) => kindCell(p, kind)),
      el("td", { class: "num", text: p.humor }));
  });
  app.replaceChildren(el("section", { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", { text: "Players across sessions" })),
    list.length ? el("div", { class: "table-wrap" }, el("table", {},
      el("thead", {}, el("tr", {},
        el("th", { text: "Character" }), el("th", { class: "num", text: "Sessions" }), el("th", { class: "num", text: "Last seen" }),
        el("th", { class: "num", text: "Share in scenes" }),
        ...KINDS.map((kind) => el("th", { class: "num", text: KIND_LABELS[kind] })),
        el("th", { class: "num", text: "Funny moments" }))),
      el("tbody", {}, ...rows))) : el("p", { class: "empty", text: "No sessions yet." }),
    el("p", { class: "panel-note", style: "margin-top:10px",
      text: "Moments count confirmed ones; +n are still open. Use this to spot who hasn't had a story choice or a discovery for a while, and aim the next hook at them. Patterns need several sessions." })));
}

for (const button of document.querySelectorAll(".source-toggle button")) {
  button.addEventListener("click", () => setSource(button.dataset.source));
}
showSource();
window.addEventListener("hashchange", route);
route();
