/* ---------- Maps: GM graphs of each Gate and of Endros, to run sessions from ----------

   A map is a graph. Locations (nodes) carry their Aspects, Resources, dangers and GM notes; routes (edges) carry what
   the crew needs to use them: a skill and difficulty, a narrative condition (an Aspect, a Contacts check with a
   faction...), travel time and notes. "Edit" lets the GM drag, connect and fill in; "Run" is the read-only view for
   the table, where clicking a location shows everything about it and its routes onward.

   Maps never reach the public site. Loaded before manager.js; everything here runs only after the manager has started. */

const MAP_LADDER = { "-2": "Terrible", "-1": "Poor", 0: "Mediocre", 1: "Average", 2: "Fair", 3: "Good", 4: "Great",
  5: "Superb", 6: "Fantastic", 7: "Epic", 8: "Legendary" };
const MAP_STATE_LABELS = { known: "Known", rumoured: "Rumoured", unexplored: "Unexplored", unknown: "Unknown (GM only)" };
// Fields a location from before arrival descriptions, Specimens and Gates were added may lack.
const withNodeDefaults = (node) => ({ arrival: "", specimens: [], gateId: "", ...node });
const mapGateLabel = (gate) => `${gate.details?.designation ? `${gate.details.designation} · ` : ""}${gate.title}`;
const MAP_NODE_HEIGHT = 50;

// key: "map:<id>" for a saved map, "gate:<id>" for a Gate without one yet, "new" for a new place map.
const mapView = { key: null, draft: null, mode: "edit", selected: null, connecting: null, dirty: false, views: {}, drag: null };

const mapClone = (value) => JSON.parse(JSON.stringify(value));
const mapSigned = (value) => value > 0 ? `+${value}` : String(value);
const mapLadderText = (value) => `${MAP_LADDER[value] || ""} (${mapSigned(value)})`;
const mapGates = () => state.archive.filter((entry) => entry.type === "gate-record")
  .sort((left, right) => String(left.details?.designation || left.title).localeCompare(String(right.details?.designation || right.title)));
const mapById = (id) => (state.maps || []).find((map) => map.id === id);
const mapForGate = (gateId) => (state.maps || []).find((map) => map.gateId === gateId);
const mapNode = (id) => mapView.draft?.nodes.find((node) => node.id === id);
const mapEdge = (id) => mapView.draft?.edges.find((edge) => edge.id === id);
const nodeWidth = (node) => Math.max(120, Math.min(260, node.name.length * 7.4 + 30));

function uniqueMapId(base, taken) {
  const root = (base || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "location";
  let id = root, counter = 2;
  while (taken.has(id)) id = `${root}-${counter++}`;
  return id;
}

function routeLabel(edge) {
  const parts = [];
  if (edge.skill) parts.push(`${edge.skill}${edge.difficulty === null || edge.difficulty === undefined ? "" : ` ${mapSigned(edge.difficulty)}`}`);
  if (edge.requirement) parts.push("⚑");
  if (!parts.length && edge.travel) parts.push(edge.travel);
  return parts.join(" ");
}

/* ---------- Starting a map from a Gate record ---------- */

// Positions in columns by distance from the first location (usually the threshold).
function autoLayout(nodes, edges) {
  if (!nodes.length) return;
  const neighbours = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => { neighbours.get(edge.from)?.push(edge.to); neighbours.get(edge.to)?.push(edge.from); });
  const depth = new Map([[nodes[0].id, 0]]);
  const queue = [nodes[0].id];
  while (queue.length) {
    const id = queue.shift();
    for (const next of neighbours.get(id) || []) if (!depth.has(next)) { depth.set(next, depth.get(id) + 1); queue.push(next); }
  }
  const lastColumn = Math.max(0, ...depth.values());
  nodes.forEach((node) => { if (!depth.has(node.id)) depth.set(node.id, lastColumn + 1); });
  const columns = new Map();
  nodes.forEach((node) => { const column = depth.get(node.id); columns.set(column, [...(columns.get(column) || []), node]); });
  for (const [column, members] of columns) {
    members.forEach((node, index) => { node.x = column * 270; node.y = (index - (members.length - 1) / 2) * 120; });
  }
}

const locationKey = (name) => name.toLowerCase().replace(/\(.*?\)|"[^"]*"/g, " ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const keyWords = (key) => key.split(" ").filter((word) => word && word !== "the");

// The location graph and the Known locations name places a little differently ("Threshold" / "Quarantine Threshold",
// "Distant Structures" / "Distant Vertical Forms"): match when one name's words all appear in the other, or failing
// that when exactly one place starts with the same word.
function matchLocation(key, byKey) {
  if (byKey.has(key)) return byKey.get(key);
  const words = keyWords(key);
  const contained = [...byKey.entries()].filter(([other]) => {
    const otherWords = keyWords(other);
    const [short, long] = words.length <= otherWords.length ? [words, otherWords] : [otherWords, words];
    return short.length && short.every((word) => long.includes(word));
  });
  if (contained.length === 1) return contained[0][1];
  const sameStart = [...byKey.entries()].filter(([other]) => keyWords(other)[0] === words[0]);
  return sameStart.length === 1 ? sameStart[0][1] : null;
}

// A first draft from what the Gate record already says: its Known locations and the LOCATION GRAPH in its GM notes.
function gateMapDraft(gate) {
  const details = gate.details || {};
  const nodes = [], edges = [], taken = new Set(), byKey = new Map();
  const addNode = (name, summary = "", nodeState = "known", fuzzy = false) => {
    const key = locationKey(name);
    const existing = fuzzy ? matchLocation(key, byKey) : byKey.get(key);
    if (existing) {
      if (summary && !existing.summary) existing.summary = summary;
      return existing;
    }
    const node = { id: uniqueMapId(name, taken), name, x: 0, y: 0, state: nodeState, summary, arrival: "", specimens: [], gateId: "", aspects: [], resourceIds: [],
      facilityIds: [], dangers: [], notes: "", mapId: "" };
    taken.add(node.id);
    nodes.push(node);
    byKey.set(key, node);
    return node;
  };
  const graph = String(details.gmNotes || "").split(/LOCATION GRAPH:/i)[1]?.split(/\n\s*\n/)[0] || "";
  let unknownCount = 0;
  graph.split("\n").map((line) => line.split(/\s*(?:→|->)\s*/).map((part) => part.trim()).filter(Boolean))
    .filter((chain) => chain.length > 1)
    .forEach((chain) => {
      let previous = null;
      for (const name of chain) {
        const node = /^unknown$/i.test(name)
          ? addNode(`Unknown ${++unknownCount}`, `Beyond ${previous?.name || "the map"}: not yet explored.`, "unexplored")
          : addNode(name);
        if (previous && !edges.some((edge) => edge.from === previous.id && edge.to === node.id)) {
          edges.push({ id: uniqueMapId(`r-${previous.id}-${node.id}`, new Set(edges.map((edge) => edge.id))), from: previous.id, to: node.id,
            skill: "", difficulty: null, requirement: "", travel: "", notes: "", oneWay: false });
        }
        previous = node;
      }
    });
  (details.knownLocations || []).forEach((line) => {
    const [name, ...rest] = String(line).split(":");
    if (!rest.length || /^all locations$/i.test(name.trim())) return;
    const summary = rest.join(":").trim();
    // Only the record's capitalised survey markers count: "unknown" in a sentence is not a survey status.
    const nodeState = /NO DATA|NOT YET SURVEYED/.test(summary) ? "unexplored" : /INCOMPLETE|UNKNOWN|UNCONFIRMED/.test(summary) ? "rumoured" : "known";
    const node = addNode(name.trim(), summary, nodeState, true);
    if (node.state === "known") node.state = nodeState;
  });
  autoLayout(nodes, edges);
  const hazards = (details.knownHazards || []).map((hazard) => `- ${hazard}`).join("\n");
  return { title: gate.title, kind: "gate", gateId: gate.id, summary: gate.summary || "",
    notes: hazards ? `Gate-wide hazards (from the Gate record):\n${hazards}` : "", nodes, edges };
}

function blankMapDraft(kind, gate = null) {
  return { title: gate ? gate.title : "New map", kind, gateId: gate?.id || "", summary: "", notes: "",
    nodes: [{ id: "start", name: gate ? "Threshold" : "Starting point", x: 0, y: 0, state: "known", summary: "", aspects: [],
      resourceIds: [], facilityIds: [], dangers: [], notes: "", mapId: "" }], edges: [] };
}

/* ---------- The list of maps ---------- */

// The maps are a compact picker bar above the map, so the canvas gets the full width.
function mapListItem(key, title, meta, active) {
  return `<button type="button" class="map-pick ${active ? "active" : ""}" data-map-open="${escapeHtml(key)}" aria-pressed="${active}">
    <strong>${escapeHtml(title)}</strong>${meta ? `<small>${meta}</small>` : ""}</button>`;
}

function mapList() {
  const places = (state.maps || []).filter((map) => map.kind === "settlement").sort((left, right) => left.title.localeCompare(right.title));
  const placeItems = places.map((map) => mapListItem(`map:${map.id}`, map.title, `${map.nodes.length} locations`, mapView.key === `map:${map.id}`)).join("");
  const gateItems = mapGates().map((gate) => {
    const map = mapForGate(gate.id);
    const status = escapeHtml(humanize(gate.details?.gateStatus || ""));
    const label = `${gate.details?.designation ? `${gate.details.designation} · ` : ""}${map ? map.title : gate.title}`;
    return map
      ? mapListItem(`map:${map.id}`, label, status, mapView.key === `map:${map.id}`)
      : mapListItem(`gate:${gate.id}`, label, `No map yet${status ? ` · ${status}` : ""}`, mapView.key === `gate:${gate.id}`);
  }).join("");
  return `<div class="map-pick-group"><span class="map-pick-label">Places</span>${placeItems || '<span class="helper">None yet.</span>'}</div>
    <div class="map-pick-group"><span class="map-pick-label">Gates</span>${gateItems || '<span class="helper">No Gate records.</span>'}</div>
    <button class="button button-secondary map-pick-new" type="button" data-map-action="new-place">+ Place map</button>`;
}

/* ---------- Rendering ---------- */

function ensureDraft() {
  if (mapView.draft || !mapView.key) return;
  if (mapView.key.startsWith("map:")) {
    const map = mapById(mapView.key.slice(4));
    if (map) { mapView.draft = mapClone(map); mapView.draft.nodes = mapView.draft.nodes.map(withNodeDefaults); }
    else mapView.key = null;
  }
}

function renderMaps() {
  if (!mapView.key) {
    const first = (state.maps || []).find((map) => map.kind === "settlement") || (state.maps || [])[0];
    mapView.key = first ? `map:${first.id}` : mapGates()[0] ? `gate:${mapGates()[0].id}` : null;
  }
  ensureDraft();
  let detail;
  if (mapView.draft) detail = mapEditor();
  else if (mapView.key?.startsWith("gate:")) detail = mapCreatePanel(findRecord("archive", mapView.key.slice(5)));
  else detail = `<div class="editor-content"><div class="empty-list">Choose a map, or start one with <strong>+ Place map</strong>.</div></div>`;
  document.getElementById("work-area").innerHTML = `
    <div class="map-layout">
      <nav class="map-picker" aria-label="Maps">${mapList()}</nav>
      <section class="editor-panel map-panel" aria-label="Map">${detail}</section>
    </div>`;
  if (mapView.draft) { drawMap(); renderMapInspector(); }
}

function mapCreatePanel(gate) {
  if (!gate) return `<div class="editor-content"><div class="empty-list">That Gate no longer exists.</div></div>`;
  const details = gate.details || {};
  const locations = (details.knownLocations || []).length;
  const hasGraph = /LOCATION GRAPH:/i.test(details.gmNotes || "");
  return `<div class="editor-content map-create">
    <span class="eyebrow">${escapeHtml(details.designation || "GATE")} · NO MAP YET</span>
    <h2>${escapeHtml(gate.title)}</h2>
    <p class="helper">A map is only for you: it is never synced to the site. Start from what the Gate record already says,
      then add Aspects, Resources, dangers and the checks each route needs.</p>
    <div class="map-create-actions">
      <button type="button" class="button button-primary" data-map-action="create-from-gate" data-gate-id="${escapeHtml(gate.id)}" ${locations || hasGraph ? "" : "disabled"}>
        Start from the Gate record</button>
      <button type="button" class="button button-secondary" data-map-action="create-blank" data-gate-id="${escapeHtml(gate.id)}">Blank map</button>
    </div>
    <p class="helper">The Gate record has ${locations} known location${locations === 1 ? "" : "s"}${hasGraph ? " and a location graph in its GM notes" : ""}.
      Nothing is saved until you press Save.</p>
  </div>`;
}

function mapEditor() {
  const draft = mapView.draft;
  const gate = draft.gateId ? findRecord("archive", draft.gateId) : null;
  const editing = mapView.mode === "edit";
  const selectedLabel = mapView.selected ? (mapView.selected.type === "node" ? "location" : "route") : "";
  return `
    <div class="map-head">
      <div><span class="eyebrow">${gate ? `${escapeHtml(gate.details?.designation || "GATE")} · GATE MAP` : "PLACE MAP"}${mapView.key === "new" || mapView.key?.startsWith("gate:") ? " · NOT SAVED YET" : ""}</span>
        <h2>${escapeHtml(draft.title)}</h2></div>
      <div class="map-mode" role="group" aria-label="Mode">
        <button type="button" data-map-mode="edit" aria-pressed="${editing}">Edit</button>
        <button type="button" data-map-mode="run" aria-pressed="${!editing}">Run</button>
      </div>
    </div>
    <div class="map-toolbar">
      ${editing ? `<button type="button" class="button button-secondary" data-map-action="add-node">+ Location</button>
        <button type="button" class="button button-secondary ${mapView.connecting ? "is-on" : ""}" data-map-action="connect" title="Click a location, then the location it leads to">${mapView.connecting ? "Connecting… (Esc)" : "Connect"}</button>
        <button type="button" class="button button-secondary" data-map-action="delete-selected" ${selectedLabel ? "" : "disabled"}>Delete ${selectedLabel || "selected"}</button>
        <button type="button" class="button button-secondary" data-map-action="layout" title="Arrange in columns from the first location">Auto-arrange</button>` : ""}
      <button type="button" class="button button-secondary" data-map-action="fit">Fit</button>
      <span class="map-toolbar-spacer"></span>
      <span class="helper map-dirty" ${mapView.dirty ? "" : "hidden"}>Unsaved changes</span>
      <button type="button" class="button button-secondary" data-map-action="discard" ${mapView.dirty ? "" : "disabled"}>Discard</button>
      <button type="button" class="button button-primary" data-map-action="save">Save</button>
    </div>
    <div class="map-body">
      <div class="map-canvas-wrap">
        <svg class="map-canvas ${editing ? "is-editing" : "is-running"} ${mapView.connecting ? "is-connecting" : ""}" id="map-canvas" role="img" aria-label="Map of ${escapeHtml(draft.title)}" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="map-hint">${editing ? "Drag locations · double-click empty space to add one · drag the background to pan · scroll to zoom" : "Click a location or route to see its details · drag to pan · scroll to zoom"}</div>
      </div>
      <aside class="map-inspector" id="map-inspector" aria-label="Details"></aside>
    </div>`;
}

function mapBounds(nodes) {
  if (!nodes.length) return { x: -300, y: -200, w: 600, h: 400 };
  const left = Math.min(...nodes.map((node) => node.x - nodeWidth(node) / 2)), right = Math.max(...nodes.map((node) => node.x + nodeWidth(node) / 2));
  const top = Math.min(...nodes.map((node) => node.y - MAP_NODE_HEIGHT / 2)), bottom = Math.max(...nodes.map((node) => node.y + MAP_NODE_HEIGHT / 2));
  const pad = 70;
  return { x: left - pad, y: top - pad, w: Math.max(400, right - left + pad * 2), h: Math.max(300, bottom - top + pad * 2) };
}

// Below this many screen pixels per map unit, names stop being readable: a big map is shown at this scale from its
// start (left) and panned, rather than shrunk to fit.
const MAP_MIN_SCALE = 0.8;

// A view that fits the map into the canvas, with the canvas's own proportions so nothing is letterboxed.
function fitView(nodes) {
  const bounds = mapBounds(nodes);
  const rect = document.getElementById("map-canvas")?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return bounds;
  const scale = Math.min(1.1, Math.max(MAP_MIN_SCALE, Math.min(rect.width / bounds.w, rect.height / bounds.h)));
  const w = rect.width / scale, h = rect.height / scale;
  const centreY = bounds.y + bounds.h / 2;
  const x = w >= bounds.w ? bounds.x + bounds.w / 2 - w / 2 : bounds.x;
  return { x, y: h >= bounds.h ? centreY - h / 2 : bounds.y, w, h };
}

const viewKey = () => mapView.key || "draft";
const currentMapView = () => mapView.views[viewKey()] || (mapView.views[viewKey()] = fitView(mapView.draft.nodes));

// Where a line from the centre of a box towards (tx, ty) leaves the box.
function boxExit(node, tx, ty) {
  const dx = tx - node.x, dy = ty - node.y;
  if (!dx && !dy) return { x: node.x, y: node.y };
  const scale = Math.min((nodeWidth(node) / 2 + 3) / Math.abs(dx || 1e-9), (MAP_NODE_HEIGHT / 2 + 3) / Math.abs(dy || 1e-9));
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

function drawMap() {
  const svg = document.getElementById("map-canvas");
  if (!svg || !mapView.draft) return;
  const { nodes, edges } = mapView.draft;
  const view = currentMapView();
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const selected = mapView.selected;
  const touching = new Set(selected?.type === "node" ? edges.filter((edge) => edge.from === selected.id || edge.to === selected.id).map((edge) => edge.id) : []);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edgeMarkup = edges.map((edge) => {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to) return "";
    const start = boxExit(from, to.x, to.y), end = boxExit(to, from.x, from.y);
    const label = routeLabel(edge);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const isSelected = selected?.type === "edge" && selected.id === edge.id;
    const width = label.length * 6.6 + 14;
    return `<g class="map-edge ${isSelected ? "is-selected" : ""} ${touching.has(edge.id) ? "is-touching" : ""} ${edge.requirement ? "has-condition" : ""}" data-edge-id="${escapeHtml(edge.id)}">
      <line class="map-edge-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" ${edge.oneWay ? 'marker-end="url(#map-arrow)"' : ""} />
      <line class="map-edge-hit" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />
      ${label ? `<rect class="map-edge-label-box" x="${mid.x - width / 2}" y="${mid.y - 10}" width="${width}" height="20" rx="10" />
        <text class="map-edge-label" x="${mid.x}" y="${mid.y + 4}">${escapeHtml(label)}</text>` : ""}
    </g>`;
  }).join("");
  const nodeMarkup = nodes.map((node) => {
    const width = nodeWidth(node);
    const isSelected = selected?.type === "node" && selected.id === node.id;
    const gate = node.gateId ? findRecord("archive", node.gateId) : null;
    const badges = [node.aspects.length ? `✦${node.aspects.length}` : "", node.resourceIds.length ? `◆${node.resourceIds.length}` : "",
      node.specimens?.length ? `❖${node.specimens.length}` : "", node.dangers.length ? `⚠${node.dangers.length}` : "",
      gate?.details?.designation || (node.mapId ? "↗ map" : "")].filter(Boolean).join("  ");
    return `<g class="map-node state-${node.state} ${gate ? "has-gate" : ""} ${isSelected ? "is-selected" : ""} ${mapView.connecting === node.id ? "is-source" : ""}" data-node-id="${escapeHtml(node.id)}" transform="translate(${node.x} ${node.y})">
      <rect x="${-width / 2}" y="${-MAP_NODE_HEIGHT / 2}" width="${width}" height="${MAP_NODE_HEIGHT}" rx="7" />
      ${gate ? `<circle class="map-gate-mark" cx="${-width / 2}" cy="${-MAP_NODE_HEIGHT / 2}" r="13" /><text class="map-gate-symbol" x="${-width / 2}" y="${-MAP_NODE_HEIGHT / 2 + 6}">◎</text>` : ""}
      <text class="map-node-name" x="0" y="${badges ? -3 : 5}">${escapeHtml(node.name)}</text>
      ${badges ? `<text class="map-node-badges" x="0" y="15">${escapeHtml(badges)}</text>` : ""}
    </g>`;
  }).join("");
  svg.innerHTML = `<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" class="map-arrow-head" /></marker></defs>
    <rect class="map-backdrop" x="${view.x - view.w * 5}" y="${view.y - view.h * 5}" width="${view.w * 11}" height="${view.h * 11}" />
    ${edgeMarkup}${nodeMarkup}`;
}

/* ---------- The inspector: details of the selected location, route or the map itself ---------- */

const mapField = (target, field, label, value, options = {}) => {
  const attrs = `data-map-target="${target}" data-map-field="${field}" id="map-field-${field}"`;
  const control = options.rows
    ? `<textarea ${attrs} rows="${options.rows}" placeholder="${escapeHtml(options.placeholder || "")}">${escapeHtml(value)}</textarea>`
    : `<input ${attrs} type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(options.placeholder || "")}" />`;
  return `<div class="field"><label for="map-field-${field}">${label}</label>${control}${options.help ? `<span class="helper">${options.help}</span>` : ""}</div>`;
};

const mapSelect = (target, field, label, value, choices, help = "") => `<div class="field"><label for="map-field-${field}">${label}</label>
  <select data-map-target="${target}" data-map-field="${field}" id="map-field-${field}">${choices.map(([choice, text]) =>
    `<option value="${escapeHtml(choice)}" ${String(choice) === String(value ?? "") ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select>
  ${help ? `<span class="helper">${help}</span>` : ""}</div>`;

function resourceChoices(node) {
  const gateId = mapView.draft.gateId;
  const usable = state.resources.filter((resource) => !node.resourceIds.includes(resource.id));
  const own = usable.filter((resource) => gateId && resource.gateId === gateId);
  const other = usable.filter((resource) => !(gateId && resource.gateId === gateId));
  const options = (list) => list.map((resource) => `<option value="${escapeHtml(resource.id)}">${escapeHtml(resource.name)}</option>`).join("");
  return `<option value="">Add a Resource…</option>${own.length ? `<optgroup label="From this Gate">${options(own)}</optgroup>` : ""}
    ${other.length ? `<optgroup label="Other Resources">${options(other)}</optgroup>` : ""}`;
}

function chipList(ids, collection, field) {
  if (!ids.length) return '<span class="helper">None yet.</span>';
  return ids.map((id) => {
    const record = findRecord(collection, id);
    return `<span class="map-chip">${record ? `<button type="button" class="link-button" data-jump-view="${collection}" data-jump-id="${escapeHtml(id)}">${escapeHtml(record.name || record.title || id)}</button>` : escapeHtml(id)}
      <button type="button" class="map-chip-remove" data-map-remove="${field}" data-value="${escapeHtml(id)}" aria-label="Remove">×</button></span>`;
  }).join("");
}

function routesOf(node) {
  return mapView.draft.edges.filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => {
      const outgoing = edge.from === node.id;
      const other = mapNode(outgoing ? edge.to : edge.from);
      const blocked = !outgoing && edge.oneWay;
      return { edge, other, outgoing, blocked };
    });
}

function routeLines(node, interactive) {
  const routes = routesOf(node);
  if (!routes.length) return '<span class="helper">No routes yet.</span>';
  return `<ul class="map-routes">${routes.map(({ edge, other, outgoing, blocked }) => `
    <li class="${blocked ? "is-blocked" : ""}">
      <button type="button" class="link-button" data-map-select="edge:${escapeHtml(edge.id)}">${outgoing ? "→" : blocked ? "←" : "↔"} ${escapeHtml(other?.name || "?")}</button>
      ${edge.skill ? `<span class="map-check">${escapeHtml(edge.skill)}${edge.difficulty === null || edge.difficulty === undefined ? "" : ` · ${escapeHtml(mapLadderText(edge.difficulty))}`}</span>` : ""}
      ${edge.requirement ? `<span class="map-condition">⚑ ${escapeHtml(edge.requirement)}</span>` : ""}
      ${edge.travel ? `<span class="helper">${escapeHtml(edge.travel)}</span>` : ""}
      ${blocked ? '<span class="helper">One way: only from there to here.</span>' : ""}
      ${interactive && other ? `<button type="button" class="link-button map-go" data-map-select="node:${escapeHtml(other.id)}">Go to ${escapeHtml(other.name)} ›</button>` : ""}
    </li>`).join("")}</ul>`;
}

function nodeInspector(node) {
  const draft = mapView.draft;
  const otherMaps = (state.maps || []).filter((map) => mapView.key !== `map:${map.id}`);
  const showFacilities = draft.kind === "settlement" || node.facilityIds.length;
  return `<div class="map-inspector-head"><span class="eyebrow">LOCATION</span>
      <button type="button" class="link-button" data-map-select="">Map details</button></div>
    ${mapField("node", "name", "Name", node.name)}
    ${mapSelect("node", "state", "State", node.state, Object.entries(MAP_STATE_LABELS),
      "Rumoured: reported, unconfirmed. Unexplored: known to exist, nobody has been. Unknown: on no record; only you know it's there.")}
    ${mapField("node", "summary", "What's here (GM summary)", node.summary, { rows: 2 })}
    ${mapField("node", "arrival", "On arrival", node.arrival, { rows: 6, placeholder: "What the crew sees, hears and smells as they arrive…",
      help: "Read or paraphrase at the table. Describe what could be picked up (so players think to sample it), hint at the ways onward and at the threats." })}
    ${mapSelect("node", "gateId", "Gate here", node.gateId, [["", "No Gate"], ...mapGates().map((gate) => [gate.id, mapGateLabel(gate)])],
      "The threshold of this Gate is at this location. Gate locations are marked ◎ on the map.")}
    ${mapField("node", "aspects", "Aspects", node.aspects.join("\n"), { rows: 3, placeholder: "One per line", help: "Situation Aspects the crew can discover, invoke or be compelled by here." })}
    ${mapField("node", "dangers", "Obstacles & dangers", node.dangers.join("\n"), { rows: 3, placeholder: "One per line" })}
    ${mapField("node", "specimens", "Specimens to pick up", (node.specimens || []).join("\n"), { rows: 4, placeholder: "One per line, e.g. Glasswing Husk: a clear insect casing",
      help: "Anything a crew can sample here. Some are common Specimens; some may prove to be Resources." })}
    <div class="field"><label>Resources found here</label><div class="map-chips">${chipList(node.resourceIds, "resources", "resourceIds")}</div>
      <select data-map-add="resourceIds" aria-label="Add a Resource">${resourceChoices(node)}</select></div>
    ${showFacilities ? `<div class="field"><label>Facilities here</label><div class="map-chips">${chipList(node.facilityIds, "facilities", "facilityIds")}</div>
      <select data-map-add="facilityIds" aria-label="Add a Facility"><option value="">Add a Facility…</option>${state.facilities
        .filter((facility) => !node.facilityIds.includes(facility.id)).map((facility) => `<option value="${escapeHtml(facility.id)}">${escapeHtml(facility.name)}</option>`).join("")}</select></div>` : ""}
    ${mapSelect("node", "mapId", "Opens another map", node.mapId, [["", "No"], ...otherMaps.map((map) => [map.id, map.title])],
      "For example, a Gate threshold in Endros opening that Gate's map.")}
    ${mapField("node", "notes", "GM notes", node.notes, { rows: 4 })}
    <div class="field"><label>Routes</label>${routeLines(node, false)}
      <button type="button" class="button button-secondary" data-map-action="connect-from" data-node-id="${escapeHtml(node.id)}">Connect from here…</button></div>
    <button type="button" class="button button-danger" data-map-action="delete-selected">Delete location</button>`;
}

function edgeInspector(edge) {
  const from = mapNode(edge.from), to = mapNode(edge.to);
  const skills = state.vocabulary.mapSkills || [];
  const [low, high] = state.vocabulary.mapDifficulties || [-2, 8];
  const ladder = Array.from({ length: high - low + 1 }, (_, index) => low + index);
  return `<div class="map-inspector-head"><span class="eyebrow">ROUTE</span>
      <button type="button" class="link-button" data-map-select="">Map details</button></div>
    <p class="map-route-ends"><button type="button" class="link-button" data-map-select="node:${escapeHtml(edge.from)}">${escapeHtml(from?.name || "?")}</button>
      <span>${edge.oneWay ? "→" : "↔"}</span>
      <button type="button" class="link-button" data-map-select="node:${escapeHtml(edge.to)}">${escapeHtml(to?.name || "?")}</button>
      <button type="button" class="button button-secondary map-swap" data-map-action="swap">⇄ Swap</button></p>
    <div class="map-check-row">
      ${mapSelect("edge", "skill", "Check", edge.skill, [["", "No check"], ...skills.map((skill) => [skill, skill])])}
      ${edge.skill ? mapSelect("edge", "difficulty", "Difficulty", edge.difficulty ?? "", [["", "Not set"], ...ladder.map((value) => [value, mapLadderText(value)])]) : ""}
    </div>
    ${mapField("edge", "requirement", "Condition", edge.requirement, { rows: 2, placeholder: "e.g. Committee clearance, or Contacts with the Kharad Compact",
      help: "Narrative gates: an Aspect the crew must have, a faction's goodwill, a key, a time of day." })}
    ${mapField("edge", "travel", "Travel", edge.travel, { placeholder: "e.g. two hours on foot" })}
    <label class="check-option"><input type="checkbox" data-map-target="edge" data-map-field="oneWay" ${edge.oneWay ? "checked" : ""} /> One way only (${escapeHtml(from?.name || "?")} → ${escapeHtml(to?.name || "?")})</label>
    ${mapField("edge", "notes", "Notes", edge.notes, { rows: 4, placeholder: "What happens on a failure, who watches this route, shortcuts…" })}
    <button type="button" class="button button-danger" data-map-action="delete-selected">Delete route</button>`;
}

function mapInspector() {
  const draft = mapView.draft;
  const gate = draft.gateId ? findRecord("archive", draft.gateId) : null;
  const placed = new Set(draft.nodes.flatMap((node) => node.resourceIds));
  const unplaced = gate ? state.resources.filter((resource) => resource.gateId === gate.id && !placed.has(resource.id)) : [];
  const saved = mapView.key?.startsWith("map:");
  return `<div class="map-inspector-head"><span class="eyebrow">MAP</span></div>
    ${mapField("map", "title", "Title", draft.title)}
    ${gate ? `<p class="helper">Gate record: <button type="button" class="link-button" data-jump-view="archive" data-jump-id="${escapeHtml(gate.id)}">${escapeHtml(gate.title)}</button>${gate.details?.gateStatus ? ` · ${escapeHtml(humanize(gate.details.gateStatus))}` : ""}</p>` : ""}
    ${mapField("map", "summary", "Overview", draft.summary, { rows: 3 })}
    ${mapField("map", "notes", "GM notes", draft.notes, { rows: 6, help: "Map-wide notes: hazards everywhere, what changes between visits, ideas to seed." })}
    ${unplaced.length ? `<div class="field"><label>Gate Resources not placed yet</label><div class="map-chips">${unplaced.map((resource) =>
      `<span class="map-chip">${escapeHtml(resource.name)}</span>`).join("")}</div><span class="helper">Select a location to place them.</span></div>` : ""}
    <div class="map-legend">
      <span><i class="legend-node state-known"></i>Known</span><span><i class="legend-node state-rumoured"></i>Rumoured</span>
      <span><i class="legend-node state-unexplored"></i>Unexplored</span><span><i class="legend-node state-unknown"></i>Unknown</span>
      <span><i class="legend-node has-gate"></i>◎ Gate</span>
      <span>✦ Aspects · ◆ Resources · ❖ Specimens · ⚠ Dangers · ⚑ Condition</span>
    </div>
    ${saved ? '<button type="button" class="button button-danger" data-map-action="delete-map">Delete map</button>' : ""}`;
}

function runCard(node) {
  const list = (items) => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<span class="helper">None noted.</span>';
  const resources = node.resourceIds.map((id) => findRecord("resources", id)).filter(Boolean);
  const facilities = node.facilityIds.map((id) => findRecord("facilities", id)).filter(Boolean);
  const gate = node.gateId ? findRecord("archive", node.gateId) : null;
  // A Gate location opens its Gate's map, unless it already opens a map of its own (or is that Gate's own threshold).
  const gateMap = gate && mapForGate(gate.id);
  const linked = (node.mapId && mapById(node.mapId)) || (gateMap && mapView.key !== `map:${gateMap.id}` ? gateMap : null);
  return `<div class="map-inspector-head"><span class="eyebrow">${escapeHtml(MAP_STATE_LABELS[node.state].toUpperCase())} LOCATION</span>
      <button type="button" class="link-button" data-map-select="">Map overview</button></div>
    <h3 class="map-run-title">${gate ? '<span class="map-gate-inline">◎</span> ' : ""}${escapeHtml(node.name)}</h3>
    ${gate ? `<p class="map-run-gate">Gate: <strong>${escapeHtml(mapGateLabel(gate))}</strong>${gate.details?.gateStatus ? ` · ${escapeHtml(humanize(gate.details.gateStatus))}` : ""}</p>` : ""}
    ${node.arrival ? `<div class="map-arrival"><span class="eyebrow">ON ARRIVAL</span><p>${escapeHtml(node.arrival)}</p></div>` : ""}
    ${node.summary ? `<p class="helper">${escapeHtml(node.summary)}</p>` : ""}
    ${linked ? `<button type="button" class="button button-secondary" data-map-open="map:${escapeHtml(linked.id)}">Open map: ${escapeHtml(linked.title)} ↗</button>` : ""}
    <h4>Aspects</h4>${node.aspects.length ? `<div class="map-chips">${node.aspects.map((aspect) => `<span class="map-aspect">${escapeHtml(aspect)}</span>`).join("")}</div>` : '<span class="helper">None noted.</span>'}
    <h4>Obstacles &amp; dangers</h4>${list(node.dangers)}
    <h4>Resources</h4>${resources.length ? `<ul class="map-run-resources">${resources.map((resource) => `<li>
      <button type="button" class="link-button" data-jump-view="resources" data-jump-id="${escapeHtml(resource.id)}">${escapeHtml(resource.name)}</button>
      <span class="helper">${escapeHtml((resource.functions || []).join(", "))}${resource.availability ? ` · ${escapeHtml(humanize(resource.availability))}` : ""}</span></li>`).join("")}</ul>` : '<span class="helper">None noted.</span>'}
    <h4>Specimens to pick up</h4>${list(node.specimens || [])}
    ${facilities.length ? `<h4>Facilities</h4><ul>${facilities.map((facility) => `<li><button type="button" class="link-button" data-jump-view="facilities" data-jump-id="${escapeHtml(facility.id)}">${escapeHtml(facility.name)}</button></li>`).join("")}</ul>` : ""}
    ${node.notes ? `<h4>GM notes</h4><p class="map-run-notes">${escapeHtml(node.notes)}</p>` : ""}
    <h4>Routes onward</h4>${routeLines(node, true)}`;
}

function runRoute(edge) {
  const from = mapNode(edge.from), to = mapNode(edge.to);
  return `<div class="map-inspector-head"><span class="eyebrow">ROUTE</span>
      <button type="button" class="link-button" data-map-select="">Map overview</button></div>
    <h3 class="map-run-title">${escapeHtml(from?.name || "?")} ${edge.oneWay ? "→" : "↔"} ${escapeHtml(to?.name || "?")}</h3>
    <h4>Check</h4><p>${edge.skill ? `<strong>${escapeHtml(edge.skill)}</strong>${edge.difficulty === null || edge.difficulty === undefined ? "" : ` against ${escapeHtml(mapLadderText(edge.difficulty))}`}` : '<span class="helper">No check: the crew can just go.</span>'}</p>
    ${edge.requirement ? `<h4>Condition</h4><p class="map-condition">⚑ ${escapeHtml(edge.requirement)}</p>` : ""}
    ${edge.travel ? `<h4>Travel</h4><p>${escapeHtml(edge.travel)}</p>` : ""}
    ${edge.notes ? `<h4>Notes</h4><p class="map-run-notes">${escapeHtml(edge.notes)}</p>` : ""}
    <p><button type="button" class="link-button" data-map-select="node:${escapeHtml(edge.from)}">‹ ${escapeHtml(from?.name || "?")}</button> ·
      <button type="button" class="link-button" data-map-select="node:${escapeHtml(edge.to)}">${escapeHtml(to?.name || "?")} ›</button></p>`;
}

function runOverview() {
  const draft = mapView.draft;
  const known = draft.nodes.filter((node) => node.state === "known").length;
  return `<div class="map-inspector-head"><span class="eyebrow">MAP OVERVIEW</span></div>
    <h3 class="map-run-title">${escapeHtml(draft.title)}</h3>
    ${draft.summary ? `<p>${escapeHtml(draft.summary)}</p>` : ""}
    <p class="helper">${draft.nodes.length} locations (${known} known) · ${draft.edges.length} routes. Click a location to run it.</p>
    ${draft.notes ? `<h4>GM notes</h4><p class="map-run-notes">${escapeHtml(draft.notes)}</p>` : ""}`;
}

function renderMapInspector() {
  const panel = document.getElementById("map-inspector");
  if (!panel || !mapView.draft) return;
  const selected = mapView.selected;
  const node = selected?.type === "node" ? mapNode(selected.id) : null;
  const edge = selected?.type === "edge" ? mapEdge(selected.id) : null;
  if (selected && !node && !edge) mapView.selected = null;
  if (mapView.mode === "run") panel.innerHTML = node ? runCard(node) : edge ? runRoute(edge) : runOverview();
  else panel.innerHTML = node ? nodeInspector(node) : edge ? edgeInspector(edge) : mapInspector();
}

// The toolbar's Delete button and unsaved marker depend on the selection and draft state.
function refreshMapToolbar() {
  const dirty = document.querySelector(".map-dirty");
  if (dirty) dirty.hidden = !mapView.dirty;
  const discard = document.querySelector('[data-map-action="discard"]');
  if (discard) discard.disabled = !mapView.dirty;
  const remove = document.querySelector('.map-toolbar [data-map-action="delete-selected"]');
  if (remove) {
    const label = mapView.selected ? (mapView.selected.type === "node" ? "location" : "route") : "";
    remove.disabled = !label;
    remove.textContent = `Delete ${label || "selected"}`;
  }
  const connect = document.querySelector('[data-map-action="connect"]');
  if (connect) { connect.classList.toggle("is-on", Boolean(mapView.connecting)); connect.textContent = mapView.connecting ? "Connecting… (Esc)" : "Connect"; }
  document.getElementById("map-canvas")?.classList.toggle("is-connecting", Boolean(mapView.connecting));
}

function markMapDirty() { mapView.dirty = true; refreshMapToolbar(); }

function selectMapItem(selection) {
  mapView.selected = selection;
  drawMap();
  renderMapInspector();
  refreshMapToolbar();
}

/* ---------- Changing the draft ---------- */

function addMapNode(x, y) {
  const taken = new Set(mapView.draft.nodes.map((node) => node.id));
  const node = { id: uniqueMapId("new-location", taken), name: "New location", x: Math.round(x), y: Math.round(y), state: "known", summary: "",
    arrival: "", specimens: [], gateId: "", aspects: [], resourceIds: [], facilityIds: [], dangers: [], notes: "", mapId: "" };
  mapView.draft.nodes.push(node);
  markMapDirty();
  selectMapItem({ type: "node", id: node.id });
  const name = document.getElementById("map-field-name");
  name?.focus();
  name?.select();
}

function connectMapNodes(fromId, toId) {
  mapView.connecting = null;
  if (fromId === toId) { refreshMapToolbar(); drawMap(); return; }
  const existing = mapView.draft.edges.find((edge) => (edge.from === fromId && edge.to === toId) || (edge.from === toId && edge.to === fromId));
  if (existing) { selectMapItem({ type: "edge", id: existing.id }); showNotice("Those locations are already connected: this is the route between them."); return; }
  const edge = { id: uniqueMapId(`r-${fromId}-${toId}`, new Set(mapView.draft.edges.map((item) => item.id))), from: fromId, to: toId,
    skill: "", difficulty: null, requirement: "", travel: "", notes: "", oneWay: false };
  mapView.draft.edges.push(edge);
  markMapDirty();
  selectMapItem({ type: "edge", id: edge.id });
}

function deleteSelectedMapItem() {
  const selected = mapView.selected;
  if (!selected) return;
  const draft = mapView.draft;
  if (selected.type === "node") {
    const node = mapNode(selected.id);
    const routes = draft.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id).length;
    if (!confirm(`Delete “${node?.name}”${routes ? ` and its ${routes} route${routes === 1 ? "" : "s"}` : ""}?`)) return;
    draft.nodes = draft.nodes.filter((item) => item.id !== selected.id);
    draft.edges = draft.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id);
  } else {
    draft.edges = draft.edges.filter((edge) => edge.id !== selected.id);
  }
  markMapDirty();
  selectMapItem(null);
}

function setMapField(target) {
  const field = target.dataset.mapField;
  const kind = target.dataset.mapTarget;
  const item = kind === "map" ? mapView.draft : kind === "node" ? mapNode(mapView.selected?.id) : mapEdge(mapView.selected?.id);
  if (!item) return;
  let value = target.type === "checkbox" ? target.checked : target.value;
  if (field === "aspects" || field === "dangers" || field === "specimens") value = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (field === "difficulty") value = value === "" ? null : Number(value);
  item[field] = value;
  if (field === "skill" && !value) item.difficulty = null;
  markMapDirty();
  drawMap();
  if (field === "title") { const heading = document.querySelector(".map-head h2"); if (heading) heading.textContent = value; }
  // Choosing a skill shows the Difficulty picker; a one-way switch changes the arrows in the labels.
  if (field === "skill" || field === "oneWay") renderMapInspector();
}

function fitMap() {
  mapView.views[viewKey()] = fitView(mapView.draft.nodes);
  drawMap();
}

function openMapKey(key) {
  if (key === mapView.key) return;
  if (mapView.dirty && !confirm("This map has unsaved changes. Leave without saving them?")) return;
  mapView.key = key;
  mapView.draft = null;
  mapView.selected = null;
  mapView.connecting = null;
  mapView.dirty = false;
  renderMaps();
}

async function saveMap() {
  const draft = mapView.draft;
  const existing = mapView.key?.startsWith("map:") ? mapView.key.slice(4) : null;
  const previousView = mapView.views[viewKey()];
  const result = existing
    ? await api(`/api/maps/${encodeURIComponent(existing)}`, { method: "PUT", body: JSON.stringify({ data: draft }) })
    : await api("/api/maps", { method: "POST", body: JSON.stringify({ data: draft }) });
  const selected = mapView.selected;
  mapView.key = `map:${result.id}`;
  if (previousView) mapView.views[mapView.key] = previousView;
  mapView.draft = null;
  mapView.dirty = false;
  await loadState();
  mapView.selected = selected;
  renderMapInspector();
  drawMap();
  showNotice("Map saved.");
}

async function deleteMap() {
  const id = mapView.key?.slice(4);
  const map = mapById(id);
  if (!map || !confirm(`Delete the map “${map.title}”? This cannot be undone.`)) return;
  await api(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" });
  mapView.key = map.gateId ? `gate:${map.gateId}` : null;
  mapView.draft = null;
  mapView.dirty = false;
  mapView.selected = null;
  await loadState();
  showNotice("Map deleted.");
}

/* ---------- Events ---------- */

function svgPoint(svg, event) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

async function handleMapClick(event) {
  const open = event.target.closest("[data-map-open]");
  if (open) { openMapKey(open.dataset.mapOpen); return; }
  const mode = event.target.closest("[data-map-mode]");
  if (mode) {
    mapView.mode = mode.dataset.mapMode;
    mapView.connecting = null;
    const view = mapView.views[viewKey()];
    renderMaps();
    if (view) { mapView.views[viewKey()] = view; drawMap(); }
    return;
  }
  const select = event.target.closest("[data-map-select]");
  if (select) {
    const [type, id] = select.dataset.mapSelect.split(":");
    selectMapItem(type ? { type, id } : null);
    return;
  }
  const remove = event.target.closest("[data-map-remove]");
  if (remove) {
    const node = mapNode(mapView.selected?.id);
    if (node) { node[remove.dataset.mapRemove] = node[remove.dataset.mapRemove].filter((id) => id !== remove.dataset.value); markMapDirty(); drawMap(); renderMapInspector(); }
    return;
  }
  const action = event.target.closest("[data-map-action]")?.dataset.mapAction;
  if (!action) return;
  const button = event.target.closest("[data-map-action]");
  try {
    if (action === "new-place") {
      if (mapView.dirty && !confirm("This map has unsaved changes. Leave without saving them?")) return;
      mapView.key = "new"; mapView.draft = blankMapDraft("settlement"); mapView.selected = null; mapView.dirty = true; mapView.mode = "edit";
      delete mapView.views.new;
      renderMaps();
    } else if (action === "create-from-gate" || action === "create-blank") {
      const gate = findRecord("archive", button.dataset.gateId);
      mapView.draft = action === "create-from-gate" ? gateMapDraft(gate) : blankMapDraft("gate", gate);
      mapView.dirty = true; mapView.selected = null; mapView.mode = "edit";
      delete mapView.views[viewKey()];
      renderMaps();
    } else if (action === "add-node") {
      const view = currentMapView();
      addMapNode(view.x + view.w / 2, view.y + view.h / 2);
    } else if (action === "connect") {
      mapView.connecting = mapView.connecting ? null : (mapView.selected?.type === "node" ? mapView.selected.id : "");
      refreshMapToolbar(); drawMap();
      if (mapView.connecting === "") showNotice("Click the location the route starts from, then the one it leads to.");
      else if (mapView.connecting) showNotice("Now click the location this route leads to.");
    } else if (action === "connect-from") {
      mapView.connecting = button.dataset.nodeId;
      refreshMapToolbar(); drawMap();
      showNotice("Now click the location this route leads to.");
    } else if (action === "delete-selected") deleteSelectedMapItem();
    else if (action === "layout") {
      if (!confirm("Rearrange every location in columns from the first one? Your own positions are replaced.")) return;
      autoLayout(mapView.draft.nodes, mapView.draft.edges); markMapDirty(); fitMap();
    } else if (action === "fit") fitMap();
    else if (action === "swap") {
      const edge = mapEdge(mapView.selected?.id);
      if (edge) { [edge.from, edge.to] = [edge.to, edge.from]; markMapDirty(); drawMap(); renderMapInspector(); }
    } else if (action === "discard") {
      if (!confirm("Discard your unsaved changes to this map?")) return;
      mapView.draft = null; mapView.dirty = false; mapView.selected = null;
      if (!mapView.key?.startsWith("map:")) mapView.key = mapView.key === "new" ? null : mapView.key;
      renderMaps();
    } else if (action === "save") await saveMap();
    else if (action === "delete-map") await deleteMap();
  } catch (error) { showNotice(error.message, true); }
}

function handleMapPointerDown(event) {
  const svg = event.target.closest("#map-canvas");
  if (!svg || event.button !== 0) return;
  const nodeElement = event.target.closest("[data-node-id]");
  const edgeElement = event.target.closest("[data-edge-id]");
  const editing = mapView.mode === "edit";
  if (nodeElement) {
    const id = nodeElement.dataset.nodeId;
    if (editing && mapView.connecting !== null) {
      if (mapView.connecting) connectMapNodes(mapView.connecting, id);
      else { mapView.connecting = id; drawMap(); showNotice("Now click the location this route leads to."); }
      return;
    }
    if (mapView.selected?.type !== "node" || mapView.selected.id !== id) selectMapItem({ type: "node", id });
    if (editing) {
      const node = mapNode(id), point = svgPoint(svg, event);
      mapView.drag = { kind: "node", id, dx: point.x - node.x, dy: point.y - node.y, moved: false, svg };
    }
    return;
  }
  if (edgeElement) { selectMapItem({ type: "edge", id: edgeElement.dataset.edgeId }); return; }
  const matrix = svg.getScreenCTM();
  mapView.drag = { kind: "pan", startX: event.clientX, startY: event.clientY, view: { ...currentMapView() }, scale: matrix ? matrix.a : 1, moved: false, svg };
}

function handleMapPointerMove(event) {
  const drag = mapView.drag;
  if (!drag) return;
  if (drag.kind === "node") {
    const node = mapNode(drag.id);
    if (!node) return;
    const point = svgPoint(drag.svg, event);
    const x = Math.round((point.x - drag.dx) / 10) * 10, y = Math.round((point.y - drag.dy) / 10) * 10;
    if (x !== node.x || y !== node.y) { node.x = x; node.y = y; drag.moved = true; drawMap(); }
  } else {
    const dx = (event.clientX - drag.startX) / drag.scale, dy = (event.clientY - drag.startY) / drag.scale;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    mapView.views[viewKey()] = { ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy };
    drawMap();
  }
}

function handleMapPointerUp() {
  const drag = mapView.drag;
  mapView.drag = null;
  if (!drag) return;
  if (drag.kind === "node" && drag.moved) markMapDirty();
  // A click on empty space (not a pan) clears the selection.
  if (drag.kind === "pan" && !drag.moved && mapView.selected) selectMapItem(null);
}

function handleMapWheel(event) {
  const svg = event.target.closest("#map-canvas");
  if (!svg) return;
  event.preventDefault();
  const view = currentMapView();
  const point = svgPoint(svg, event);
  const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
  const width = Math.min(20000, Math.max(200, view.w * factor));
  const scale = width / view.w;
  mapView.views[viewKey()] = { x: point.x - (point.x - view.x) * scale, y: point.y - (point.y - view.y) * scale, w: width, h: view.h * scale };
  drawMap();
}

function handleMapDoubleClick(event) {
  const svg = event.target.closest("#map-canvas");
  if (!svg || mapView.mode !== "edit") return;
  // The canvas is redrawn on every pointerdown, so the event's own target may be gone: look at what is under the pointer.
  const under = document.elementFromPoint(event.clientX, event.clientY);
  if (under?.closest("[data-node-id]")) { document.getElementById("map-field-name")?.focus(); return; }
  if (under?.closest("[data-edge-id]")) return;
  const point = svgPoint(svg, event);
  addMapNode(Math.round(point.x / 10) * 10, Math.round(point.y / 10) * 10);
}

function handleMapInput(event) {
  if (event.target.matches("[data-map-field]")) setMapField(event.target);
}

function handleMapChange(event) {
  const add = event.target.closest("[data-map-add]");
  if (add && add.value) {
    const node = mapNode(mapView.selected?.id);
    if (node) { node[add.dataset.mapAdd] = [...node[add.dataset.mapAdd], add.value]; markMapDirty(); drawMap(); renderMapInspector(); }
    return;
  }
  if (event.target.matches("select[data-map-field], input[type=checkbox][data-map-field]")) setMapField(event.target);
}

function handleMapKey(event) {
  if (activeView !== "maps" || !mapView.draft) return;
  const typing = event.target.closest("input, textarea, select, [contenteditable]");
  if (event.key === "Escape" && mapView.connecting !== null) { mapView.connecting = null; refreshMapToolbar(); drawMap(); return; }
  if (typing || mapView.mode !== "edit") return;
  if ((event.key === "Delete" || event.key === "Backspace") && mapView.selected) { event.preventDefault(); deleteSelectedMapItem(); }
}

document.addEventListener("DOMContentLoaded", () => {
  const workArea = document.getElementById("work-area");
  const onMaps = (handler) => (event) => { if (activeView === "maps") handler(event); };
  workArea.addEventListener("click", onMaps(handleMapClick));
  workArea.addEventListener("pointerdown", onMaps(handleMapPointerDown));
  workArea.addEventListener("dblclick", onMaps(handleMapDoubleClick));
  workArea.addEventListener("input", onMaps(handleMapInput));
  workArea.addEventListener("change", onMaps(handleMapChange));
  workArea.addEventListener("wheel", onMaps(handleMapWheel), { passive: false });
  window.addEventListener("pointermove", onMaps(handleMapPointerMove));
  window.addEventListener("pointerup", onMaps(handleMapPointerUp));
  document.addEventListener("keydown", handleMapKey);
});
