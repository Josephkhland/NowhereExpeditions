const state = { gear: [], characters: [], archive: [], jobs: [], game: [], outpost: {}, site: {}, settings: { includeSamples: false, sampleCount: 0 }, hiddenSamples: [] };
let activeView = "outpost";
let selectedId = null;
let draft = false;
let filterText = "";
let listFilters = {};
let activeOutpostTab = "profile";
let noticeTimer;

const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const listText = (value) => Array.isArray(value) ? value.join("\n") : (value || "");
const capitalize = (value = "") => value.charAt(0).toUpperCase() + value.slice(1);
const humanize = (value = "") => capitalize(String(value).replace(/-/g, " "));

const JOB_TYPES = ["expedition", "recovery", "investigation", "escort", "bounty", "outpost", "other"];
const JOB_STATUSES = ["open", "scheduled", "in-progress", "completed", "failed", "cancelled"];
const ARCHIVE_TYPES = [["gate-record", "Gate Record"], ["session-record", "Session Record"], ["newspaper", "Newspaper"],
  ["history", "History"], ["folklore", "Folklore"]];
const archiveTypeLabel = (type) => (ARCHIVE_TYPES.find(([key]) => key === type) || [type, humanize(type)])[1];
const GEAR_CATEGORIES = ["weapon", "armor", "tool", "medical", "consumable", "exploration", "utility", "special"];
const GEAR_AVAILABILITY = ["common", "restricted", "rare", "unavailable"];
const PROMO_LABELS = ["DISCOUNT", "NEW", "LIMITED", "FEATURED"];
const CURRENCY = "coins";
// Same icons as the public site: a coin for prices, a dumbbell for weight.
const COIN_ICON = '<svg class="coin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="12" cy="12" r="7" fill="none" stroke="rgba(255, 255, 255, 0.45)" stroke-width="1.5"/><path d="M12 8.5l1.1 2.4 2.4 1.1-2.4 1.1L12 15.5l-1.1-2.4L8.5 12l2.4-1.1z" fill="rgba(255, 255, 255, 0.55)"/></svg>';
const WEIGHT_ICON = '<svg class="weight-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1 10h1.5V8H1zM2.5 5h3v14h-3zM5.5 7.5h2.5v9H5.5zM8 10.75h8v2.5H8zM16 7.5h2.5v9H16zM18.5 5h3v14h-3zM21.5 8H23v2h-1.5zM21.5 14H23v2h-1.5zM1 14h1.5v2H1z" fill="currentColor"/></svg>';
const weightText = (value) => `<span class="weight" title="Weight">${WEIGHT_ICON}<span class="sr-only">Weight </span>${escapeHtml(value ?? "—")}</span>`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function showNotice(message, isError = false) {
  const notice = document.getElementById("notice");
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 8000);
}

/* ---------- Lookups between content types ---------- */

const findRecord = (key, id) => state[key].find((record) => record.id === id);
const characterLabel = (character) => character
  ? `${character.name || "Unnamed"} (${character.type === "npc" ? "NPC" : "PC"}${character.status && character.status !== "active" ? `, ${character.status}` : ""})`
  : "";
const jobLabel = (job) => job ? [job.designation, job.title].filter(Boolean).join(" · ") : "";
const archiveLabel = (entry) => {
  if (!entry) return "";
  const designation = entry.type === "gate-record" ? entry.details?.designation : "";
  return [designation, entry.title].filter(Boolean).join(" · ");
};
const sessionRecordLabel = (entry) => [entry.details?.sessionDate, entry.title].filter(Boolean).join(" · ");
const gearLabel = (gear) => gear ? gear.name || gear.id : "";

// Authored text links to Archive entries as [[entry-id]] or [[entry-id|link text]].
const ARCHIVE_LINK = /\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]/g;
function linkCheck(texts) {
  const ids = [...new Set([...texts.join("\n").matchAll(ARCHIVE_LINK)].map((match) => match[1]))];
  if (!ids.length) return "";
  const rows = ids.map((id) => {
    const entry = findRecord("archive", id);
    if (!entry) return `<code>[[${escapeHtml(id)}]]</code> <span class="link-state link-missing">No such Archive entry</span>`;
    return `${referenceLink("archive", entry, archiveLabel(entry))} <span class="link-state ${entry.published ? "" : "link-hidden"}">${entry.published ? archiveTypeLabel(entry.type) : "Unpublished — shown to players as plain text"}</span>`;
  });
  return relatedBlock("Archive links in this record", rows, "");
}

function referenceLink(key, record, label) {
  if (!record) return "";
  return `<button type="button" class="related-link" data-jump-view="${key}" data-jump-id="${escapeHtml(record.id)}">${escapeHtml(label)}</button>`;
}

function relatedBlock(title, rows, emptyText) {
  return `<div class="field full"><span class="field-label">${title}</span>${rows.length
    ? `<ul class="related-list">${rows.map((row) => `<li>${row}</li>`).join("")}</ul>`
    : `<span class="helper">${emptyText}</span>`}</div>`;
}

/* ---------- Form controls ---------- */

function field(label, name, value, options = {}) {
  const className = options.full ? "field full" : "field";
  const type = options.type || "text";
  return `<div class="${className}"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${options.required ? "required" : ""} ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.readOnly ? "readonly" : ""} ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""} ${options.list ? `list="${options.list}"` : ""} />${options.help ? `<span class="helper">${options.help}</span>` : ""}</div>`;
}

function textarea(label, name, value, options = {}) {
  const className = options.full ? "field full" : "field";
  return `<div class="${className}"><label for="field-${name}">${label}</label><textarea id="field-${name}" name="${name}" ${options.rows ? `rows="${options.rows}"` : ""}>${escapeHtml(value)}</textarea>${options.help ? `<span class="helper">${options.help}</span>` : ""}</div>`;
}

function selectField(label, name, value, choices, options = {}) {
  const className = options.full ? "field full" : "field";
  const empty = options.emptyLabel !== undefined ? `<option value="">${escapeHtml(options.emptyLabel)}</option>` : "";
  return `<div class="${className}"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" ${options.required ? "required" : ""} ${options.disabled ? "disabled" : ""}>${empty}${choices.map(([choice, text]) => `<option value="${escapeHtml(choice)}" ${choice === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select>${options.help ? `<span class="helper" id="help-${name}">${options.help}</span>` : ""}</div>`;
}

const enumChoices = (values) => values.map((value) => [value, capitalize(value)]);

function referenceSelect(label, name, value, key, labelFor, options = {}) {
  const choices = [...state[key]]
    .filter(options.filter || (() => true))
    .map((record) => [record.id, `${labelFor(record)}${record.published ? "" : " — unpublished"}`])
    .sort((left, right) => left[1].localeCompare(right[1]));
  if (value && !choices.some(([id]) => id === value)) choices.unshift([value, hiddenSampleLabel(key, value) || `Missing record: ${value}`]);
  return selectField(label, name, value || "", choices, { emptyLabel: options.emptyLabel || "— None —", ...options });
}

function participantPicker(selectedIds, labels = {}) {
  const hiddenCount = selectedIds.filter((id) => !findRecord("characters", id) && hiddenSampleLabel("characters", id)).length;
  const selected = selectedIds.map((id) => findRecord("characters", id)).filter(Boolean);
  const others = [...state.characters].filter((character) => !selectedIds.includes(character.id))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  const options = [...selected, ...others];
  const list = options.length ? options.map((character) => `
    <label class="check-option" data-search="${escapeHtml(characterLabel(character).toLowerCase())}">
      <input class="participant-check" type="checkbox" value="${escapeHtml(character.id)}" ${selectedIds.includes(character.id) ? "checked" : ""} />
      <span>${escapeHtml(characterLabel(character))}${character.published ? "" : " — unpublished"}</span>
    </label>`).join("") : '<div class="empty-list">No characters yet. Create them in the Characters section.</div>';
  return `<div class="field full"><span class="field-label">${labels.label || "Participants"} <span class="participant-count">(${selectedIds.length} selected)</span></span>
    <input type="search" class="reference-filter" data-filter-list="participant-list" placeholder="Filter characters" aria-label="Filter participants" />
    <div class="check-list" id="participant-list">${list}</div>
    ${hiddenCount ? `<span class="helper">+ ${hiddenCount} hidden sample participant${hiddenCount > 1 ? "s" : ""}, kept when you save.</span>` : ""}
    <span class="helper">${labels.help || "Crew count on the board is the number of participants. Include the organizer here if they are going."}</span></div>`;
}

const MEDIA_PREFIXES = ["data/portraits/", "data/images/"];

function imageSource(path) {
  if (!path) return "";
  const prefix = MEDIA_PREFIXES.find((item) => path.startsWith(item));
  if (prefix) return `/api/media/${encodeURIComponent(path.slice(prefix.length))}`;
  if (path.startsWith("assets/")) return `/preview/${path}`;
  return /^https?:\/\//.test(path) ? path : "";
}

function imagePreview(path, emptyText = "No image") {
  const source = imageSource(path);
  if (source) return `<img src="${escapeHtml(source)}" alt="Image preview" />`;
  return `<span>${path ? "Preview unavailable for site paths" : escapeHtml(emptyText)}</span>`;
}

// One image control per form. `kind` decides the published folder: portraits/ for characters, images/ otherwise.
function imageField(label, name, value, kind = "image") {
  const folder = kind === "portrait" ? "data/portraits/" : "data/images/";
  return `<div class="field full"><label for="field-${name}">${label}</label>
    <div class="portrait-editor">
      <div class="portrait-preview" id="image-preview">${imagePreview(value, `No ${label.toLowerCase()}`)}</div>
      <div class="portrait-controls">
        <input id="field-${name}" name="${name}" type="text" value="${escapeHtml(value || "")}" data-image-field placeholder="Upload an image, or enter a site path / URL" />
        <div class="portrait-actions">
          <label class="button button-secondary">Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-upload="${kind}" hidden /></label>
          <button type="button" class="button button-secondary" data-action="clear-image">Remove</button>
        </div>
        <span class="helper">Uploaded images are stored in SQLite and published to <code>${folder}</code> with the record.</span>
      </div>
    </div></div>`;
}

/* ---------- Fate Core character sheet ---------- */

const FATE_SKILLS = ["Athletics", "Burglary", "Contacts", "Crafts", "Deceive", "Drive", "Empathy", "Fight", "Investigate",
  "Lore", "Notice", "Physique", "Provoke", "Rapport", "Resources", "Shoot", "Stealth", "Will"];
const FATE_LADDER = [[8, "Legendary"], [7, "Epic"], [6, "Fantastic"], [5, "Superb"], [4, "Great"], [3, "Good"],
  [2, "Fair"], [1, "Average"], [0, "Mediocre"], [-1, "Poor"], [-2, "Terrible"]];
const ladderText = ([rating, name]) => `${name} (${rating >= 0 ? "+" : ""}${rating})`;

const defaultSheet = () => ({
  public: true,
  aspects: { highConcept: "", trouble: "", other: ["", "", ""] },
  skills: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1].map((rating) => ({ name: "", rating })),
  stunts: [{ name: "", description: "" }],
  refresh: 3,
  fatePoints: null,
  stress: [{ name: "Physical", boxes: [false, false] }, { name: "Mental", boxes: [false, false] }],
  consequences: [{ label: "Mild", shift: 2, aspect: "" }, { label: "Moderate", shift: 4, aspect: "" }, { label: "Severe", shift: 6, aspect: "" }],
  extras: ""
});

const stressBoxes = (boxes) => boxes.map((checked, index) => `
  <label class="stress-box" title="Stress box ${index + 1}"><input type="checkbox" class="stress-box-check" aria-label="Stress box ${index + 1}" ${checked ? "checked" : ""} /><span>${index + 1}</span></label>`).join("");

const sheetRows = {
  aspects: {
    empty: "",
    render: (text) => `<input type="text" data-key="text" value="${escapeHtml(text)}" placeholder="Aspect" aria-label="Aspect" />`
  },
  skills: {
    empty: { name: "", rating: 1 },
    render: (skill) => `<input type="text" data-key="name" list="fate-skills" value="${escapeHtml(skill.name)}" placeholder="Skill" aria-label="Skill name" />
      <select data-key="rating" aria-label="Skill rating">${FATE_LADDER.map((step) => `<option value="${step[0]}" ${step[0] === Number(skill.rating) ? "selected" : ""}>${ladderText(step)}</option>`).join("")}</select>`
  },
  stunts: {
    empty: { name: "", description: "" },
    render: (stunt) => `<input type="text" data-key="name" value="${escapeHtml(stunt.name)}" placeholder="Stunt name" aria-label="Stunt name" />
      <textarea data-key="description" placeholder="Because I…, I get +2 when…" aria-label="Stunt description">${escapeHtml(stunt.description)}</textarea>`
  },
  stress: {
    empty: { name: "", boxes: [false, false] },
    render: (track) => `<input type="text" data-key="name" value="${escapeHtml(track.name)}" placeholder="Track name" aria-label="Stress track name" />
      <label class="stress-count">Boxes <input type="number" min="0" max="10" data-stress-count value="${track.boxes.length}" /></label>
      <span class="stress-boxes">${stressBoxes(track.boxes)}</span>`
  },
  consequences: {
    empty: { label: "", shift: 2, aspect: "" },
    render: (consequence) => `<input type="text" data-key="label" value="${escapeHtml(consequence.label)}" placeholder="Mild" aria-label="Consequence severity" />
      <input type="number" min="1" max="12" data-key="shift" value="${escapeHtml(consequence.shift)}" aria-label="Shifts absorbed" />
      <input type="text" data-key="aspect" value="${escapeHtml(consequence.aspect)}" placeholder="Empty" aria-label="Consequence aspect" />`
  }
};

const sheetRow = (kind, item) => `<div class="sheet-row sheet-row-${kind}">${sheetRows[kind].render(item)}<button class="remove-record" type="button" data-action="remove-sheet-row" aria-label="Remove row" title="Remove">×</button></div>`;

function sheetList(kind, title, items, addLabel, help = "") {
  return `<section class="sheet-section"><h3>${title}</h3>${help ? `<p class="helper">${help}</p>` : ""}
    <div class="sheet-rows" data-rows="${kind}">${items.map((item) => sheetRow(kind, item)).join("")}</div>
    <button type="button" class="button button-secondary sheet-add" data-action="add-sheet-row" data-row-kind="${kind}">+ ${addLabel}</button></section>`;
}

function sheetEditor(sheet) {
  if (!sheet) {
    return `<div class="sheet-empty"><span class="helper">No Fate Core sheet yet. A sheet appears as a separate tab on the public character page.</span>
      <button type="button" class="button button-secondary" data-action="add-sheet">+ Set up Fate Core sheet</button></div>`;
  }
  const other = sheet.aspects?.other?.length ? sheet.aspects.other : [""];
  return `<div class="sheet-body" data-sheet>
    <div class="sheet-toolbar">
      <label class="check-option sheet-public"><input type="checkbox" data-sheet-field="public" ${sheet.public !== false ? "checked" : ""} /><span>Show this sheet on the public site</span></label>
      <button type="button" class="button button-danger" data-action="remove-sheet">Remove sheet</button>
    </div>
    <section class="sheet-section"><h3>Aspects</h3>
      <div class="sheet-pair">
        <label>High Concept<input type="text" data-sheet-field="highConcept" value="${escapeHtml(sheet.aspects?.highConcept || "")}" /></label>
        <label>Trouble<input type="text" data-sheet-field="trouble" value="${escapeHtml(sheet.aspects?.trouble || "")}" /></label>
      </div>
      <div class="sheet-rows" data-rows="aspects">${other.map((text) => sheetRow("aspects", text)).join("")}</div>
      <button type="button" class="button button-secondary sheet-add" data-action="add-sheet-row" data-row-kind="aspects">+ Aspect</button>
    </section>
    ${sheetList("skills", "Skills", sheet.skills || [], "Skill", "Rows without a name are ignored. Suggestions use the Fate Core skill list; any name is allowed.")}
    <datalist id="fate-skills">${FATE_SKILLS.map((skill) => `<option value="${skill}"></option>`).join("")}</datalist>
    ${sheetList("stunts", "Stunts", sheet.stunts?.length ? sheet.stunts : [sheetRows.stunts.empty], "Stunt")}
    <section class="sheet-section"><h3>Refresh and Fate points</h3>
      <div class="sheet-pair">
        <label>Refresh<input type="number" min="0" max="20" data-sheet-field="refresh" value="${escapeHtml(sheet.refresh ?? 3)}" /></label>
        <label>Current Fate points<input type="number" min="0" max="50" data-sheet-field="fatePoints" value="${escapeHtml(sheet.fatePoints ?? "")}" placeholder="Optional" /></label>
      </div>
    </section>
    ${sheetList("stress", "Stress", sheet.stress || [], "Stress track", "Tick a box to mark it.")}
    ${sheetList("consequences", "Consequences", sheet.consequences || [], "Consequence", "Leave the aspect empty while the slot is free.")}
    <section class="sheet-section"><h3>Extras</h3><textarea data-sheet-field="extras" aria-label="Extras">${escapeHtml(sheet.extras || "")}</textarea></section>
  </div>`;
}

function readSheet(form) {
  const root = form.querySelector("[data-sheet]");
  if (!root) return null;
  const fieldValue = (name) => root.querySelector(`[data-sheet-field="${name}"]`).value.trim();
  const rows = (kind) => [...root.querySelectorAll(`[data-rows="${kind}"] > .sheet-row`)];
  const cell = (row, key) => row.querySelector(`[data-key="${key}"]`).value.trim();
  return {
    public: root.querySelector('[data-sheet-field="public"]').checked,
    aspects: {
      highConcept: fieldValue("highConcept"),
      trouble: fieldValue("trouble"),
      other: rows("aspects").map((row) => cell(row, "text")).filter(Boolean)
    },
    skills: rows("skills").map((row) => ({ name: cell(row, "name"), rating: Number(cell(row, "rating")) })).filter((skill) => skill.name),
    stunts: rows("stunts").map((row) => ({ name: cell(row, "name"), description: cell(row, "description") })).filter((stunt) => stunt.name || stunt.description),
    refresh: fieldValue("refresh"),
    fatePoints: fieldValue("fatePoints"),
    stress: rows("stress").map((row) => ({ name: cell(row, "name"), boxes: [...row.querySelectorAll(".stress-box-check")].map((box) => box.checked) })).filter((track) => track.name),
    consequences: rows("consequences").map((row) => ({ label: cell(row, "label"), shift: cell(row, "shift"), aspect: cell(row, "aspect") })).filter((consequence) => consequence.label),
    extras: fieldValue("extras")
  };
}

/* ---------- Importing a sheet file saved by a player ---------- */

const SHEET_FILE_FORMAT = "nowhere-expeditions/fate-sheet";
let sheetBeforeImport;
let stashBeforeImport;
let fieldsBeforeImport;

// Accepts the editable HTML sheet from the public site (or its JSON). Nothing in the file is executed.
function parseSheetFile(text) {
  let envelope = null;
  try {
    if (text.trim().startsWith("{")) {
      envelope = JSON.parse(text);
    } else {
      const node = new DOMParser().parseFromString(text, "text/html").getElementById("nowhere-sheet-data");
      envelope = node ? JSON.parse(node.textContent) : null;
    }
  } catch {
    envelope = null;
  }
  if (!envelope || envelope.format !== SHEET_FILE_FORMAT || !envelope.sheet || typeof envelope.sheet !== "object") {
    throw new Error("That file is not a Nowhere Expeditions character sheet. Use the file saved with Save file on the character's editable sheet.");
  }
  return envelope;
}

function normalizeImportedSheet(sheet) {
  const text = (value) => typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  const list = (value) => Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
  return {
    aspects: {
      highConcept: text(sheet.aspects?.highConcept),
      trouble: text(sheet.aspects?.trouble),
      other: list(sheet.aspects?.other).map(text)
    },
    skills: list(sheet.skills).map((skill) => ({ name: text(skill.name), rating: Math.max(-2, Math.min(8, Math.round(Number(skill.rating)) || 0)) })),
    stunts: list(sheet.stunts).map((stunt) => ({ name: text(stunt.name), description: text(stunt.description) })),
    refresh: sheet.refresh ?? "",
    fatePoints: sheet.fatePoints ?? null,
    stress: list(sheet.stress).map((track) => ({ name: text(track.name), boxes: list(track.boxes).slice(0, 10).map(Boolean) })),
    consequences: list(sheet.consequences).map((item) => ({ label: text(item.label), shift: item.shift ?? 2, aspect: text(item.aspect) })),
    extras: text(sheet.extras)
  };
}

function describeSheetChanges(before, after) {
  if (!before) return ["New sheet created from the file."];
  const changes = [];
  const quoted = (value) => value ? `“${value}”` : "empty";
  const signed = (value) => `${Number(value) >= 0 ? "+" : ""}${value}`;
  const byName = (items, key = "name") => new Map(items.map((item) => [item[key], item]));

  [["highConcept", "High Concept"], ["trouble", "Trouble"]].forEach(([key, label]) => {
    if (before.aspects[key] !== after.aspects[key]) changes.push(`${label}: ${quoted(before.aspects[key])} → ${quoted(after.aspects[key])}`);
  });
  after.aspects.other.filter((aspect) => !before.aspects.other.includes(aspect)).forEach((aspect) => changes.push(`Aspect added: “${aspect}”`));
  before.aspects.other.filter((aspect) => !after.aspects.other.includes(aspect)).forEach((aspect) => changes.push(`Aspect removed: “${aspect}”`));

  const skillsBefore = byName(before.skills);
  const skillsAfter = byName(after.skills);
  skillsAfter.forEach((skill, name) => {
    const old = skillsBefore.get(name);
    if (!old) changes.push(`Skill added: ${name} ${signed(skill.rating)}`);
    else if (old.rating !== skill.rating) changes.push(`${name}: ${signed(old.rating)} → ${signed(skill.rating)}`);
  });
  skillsBefore.forEach((skill, name) => { if (!skillsAfter.has(name)) changes.push(`Skill removed: ${name}`); });

  const stuntsBefore = byName(before.stunts);
  const stuntsAfter = byName(after.stunts);
  stuntsAfter.forEach((stunt, name) => {
    const old = stuntsBefore.get(name);
    if (!old) changes.push(`Stunt added: ${name || "(unnamed)"}`);
    else if (old.description !== stunt.description) changes.push(`Stunt changed: ${name || "(unnamed)"}`);
  });
  stuntsBefore.forEach((stunt, name) => { if (!stuntsAfter.has(name)) changes.push(`Stunt removed: ${name || "(unnamed)"}`); });

  [["refresh", "Refresh"], ["fatePoints", "Fate points"]].forEach(([key, label]) => {
    if (String(before[key] ?? "") !== String(after[key] ?? "")) changes.push(`${label}: ${before[key] || "—"} → ${after[key] || "—"}`);
  });

  const stressBefore = byName(before.stress);
  const stressAfter = byName(after.stress);
  stressAfter.forEach((track, name) => {
    const old = stressBefore.get(name);
    const marked = (boxes) => boxes.filter(Boolean).length;
    if (!old) changes.push(`Stress track added: ${name} (${track.boxes.length} boxes)`);
    else if (JSON.stringify(old.boxes) !== JSON.stringify(track.boxes)) {
      changes.push(`${name} stress: ${marked(old.boxes)} of ${old.boxes.length} → ${marked(track.boxes)} of ${track.boxes.length} boxes marked`);
    }
  });
  stressBefore.forEach((track, name) => { if (!stressAfter.has(name)) changes.push(`Stress track removed: ${name}`); });

  const consequencesBefore = byName(before.consequences, "label");
  const consequencesAfter = byName(after.consequences, "label");
  consequencesAfter.forEach((item, label) => {
    const old = consequencesBefore.get(label);
    if (!old) changes.push(`Consequence slot added: ${label}${item.aspect ? ` (“${item.aspect}”)` : ""}`);
    else if (old.aspect !== item.aspect) changes.push(`${label} consequence: ${quoted(old.aspect)} → ${quoted(item.aspect)}`);
  });
  consequencesBefore.forEach((item, label) => { if (!consequencesAfter.has(label)) changes.push(`Consequence slot removed: ${label}`); });

  if (before.extras !== after.extras) changes.push("Extras and notes changed");
  return changes;
}

function describeStashChanges(before, after) {
  const changes = [];
  const name = (id) => gearLabel(findRecord("gear", id)) || id;
  const old = new Map(before.map((item) => [item.gearId, item]));
  const now = new Map(after.map((item) => [item.gearId, item]));
  now.forEach((item, id) => {
    const previous = old.get(id);
    if (!previous) changes.push(`Stash: added ${name(id)} × ${item.quantity}${item.broughtIntoAction ? " (in action)" : ""}`);
    else {
      if (previous.quantity !== item.quantity) changes.push(`Stash: ${name(id)} quantity ${previous.quantity} → ${item.quantity}`);
      if (previous.broughtIntoAction !== item.broughtIntoAction) changes.push(`Stash: ${name(id)} ${item.broughtIntoAction ? "brought into action" : "stored"}`);
    }
  });
  old.forEach((item, id) => { if (!now.has(id)) changes.push(`Stash: removed ${name(id)}`); });
  return changes;
}

async function importSheetFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const envelope = parseSheetFile(await file.text());
  const form = input.closest("#record-form");
  const currentName = form.querySelector('[name="name"]').value.trim() || "this character";
  if (envelope.characterId && envelope.characterId !== form.dataset.editingId
    && !confirm(`This sheet file belongs to “${envelope.characterName || envelope.characterId}”. Import it into ${currentName} anyway?`)) return;
  // Players create characters on a blank sheet; those files are meant for a new record (+ New).
  if (envelope.newCharacter && form.dataset.editingId
    && !confirm(`This is a new-character file for “${envelope.characterName || "an unnamed character"}”. Import it over the existing character ${currentName}? To add it as a new character, press + New first.`)) return;

  const identityChanges = [];
  fieldsBeforeImport = Object.fromEntries(["name", "playerName", "summary", "type"].map((name) => [name, form.querySelector(`[name="${name}"]`).value]));
  if (envelope.newCharacter) {
    const fill = (name, value, label) => {
      const control = form.querySelector(`[name="${name}"]`);
      if (value && !control.value.trim()) {
        control.value = value;
        identityChanges.push(`${label}: ${value}`);
      }
    };
    fill("name", String(envelope.characterName || "").trim(), "Name");
    fill("playerName", String(envelope.playerName || "").trim(), "Player name");
    form.querySelector('[name="type"]').value = "player";
  }
  // Players write their character's public summary on the sheet (sheet files from version 3 on).
  if (typeof envelope.summary === "string") {
    const summary = form.querySelector('[name="summary"]');
    if (summary.value.trim() !== envelope.summary.trim()) {
      identityChanges.push(summary.value.trim() ? "Public summary changed" : "Public summary added");
      summary.value = envelope.summary.trim();
    }
  }

  const before = readSheet(form);
  document.getElementById("sheet-editor").innerHTML = sheetEditor({ ...normalizeImportedSheet(envelope.sheet), public: before ? before.public : true });
  const changes = [...identityChanges, ...describeSheetChanges(before, readSheet(form))];
  sheetBeforeImport = before;
  stashBeforeImport = null;
  if (Array.isArray(envelope.stash)) {
    // Version 1 files have no stash; only files that carry one replace it.
    const stashBefore = readStash(form) || [];
    const imported = envelope.stash.filter((item) => item && typeof item.gearId === "string").map((item) => ({
      gearId: item.gearId,
      quantity: Math.max(1, Math.min(999, Math.round(Number(item.quantity)) || 1)),
      broughtIntoAction: Boolean(item.broughtIntoAction)
    }));
    const known = imported.filter((item) => findRecord("gear", item.gearId));
    imported.filter((item) => !findRecord("gear", item.gearId)).forEach((item) => changes.push(`Skipped unknown Gear “${item.gearId}” from the file`));
    changes.push(...describeStashChanges(stashBefore, known));
    stashBeforeImport = stashBefore;
    rerenderStash(known);
  }
  const note = document.getElementById("sheet-import-note");
  const savedAt = envelope.savedAt ? new Date(envelope.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  note.innerHTML = `<div class="import-note">
      <div><strong>Imported ${escapeHtml(file.name)}</strong>${savedAt ? ` — saved by the player ${escapeHtml(savedAt)}` : " — never saved by the player"}.
        Review the sheet below, then press <strong>Save character</strong> to apply it.</div>
      ${changes.length ? `<ul>${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : '<p class="helper">The file matches the current sheet; nothing changed.</p>'}
      <button type="button" class="button button-secondary" data-action="undo-sheet-import">Undo import</button>
    </div>`;
  note.hidden = false;
  note.scrollIntoView({ block: "nearest" });
}

const linesToArray = (value) => String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
const formText = (formData, name) => String(formData.get(name) || "").trim();

/* ---------- Character stash: Gear owned by a character ---------- */

// The editor keeps the working stash in its rows; the Marketplace tab only adds references to Gear.
let stashView = { tab: "stash", query: "", category: "" };

const priceText = (value) => `<span class="coins">${COIN_ICON}${Number(value) || 0}<span class="sr-only"> ${CURRENCY}</span></span>`;

function readStash(root = document) {
  const editor = root.querySelector("[data-stash]");
  if (!editor) return null;
  return [...editor.querySelectorAll("[data-stash-row]")].map((row) => ({
    gearId: row.dataset.gearId,
    quantity: Math.max(1, Math.min(999, Math.round(Number(row.querySelector("[data-stash-quantity]").value)) || 1)),
    broughtIntoAction: row.querySelector("[data-stash-action]").checked
  }));
}

function stashEditor(stash) {
  const owned = new Map(stash.map((item) => [item.gearId, item]));
  const rows = stash.map((item) => {
    const gear = findRecord("gear", item.gearId);
    return `<tr data-stash-row data-gear-id="${escapeHtml(item.gearId)}">
      <td>${gear ? referenceLink("gear", gear, gearLabel(gear)) : (hiddenSampleLabel("gear", item.gearId) ? `<span class="helper">${escapeHtml(hiddenSampleLabel("gear", item.gearId))}</span>` : `<span class="link-missing">Missing Gear: ${escapeHtml(item.gearId)}</span>`)}
        ${gear && !gear.published ? '<span class="record-draft">Unpublished</span>' : ""}</td>
      <td>${escapeHtml(humanize(gear?.category || ""))}</td>
      <td class="numeric">${weightText(gear?.weight)}</td>
      <td><input type="number" min="1" max="999" value="${item.quantity}" data-stash-quantity aria-label="Quantity of ${escapeHtml(gearLabel(gear) || item.gearId)}" /></td>
      <td><label class="stash-check"><input type="checkbox" data-stash-action ${item.broughtIntoAction ? "checked" : ""} /><span>In action</span></label></td>
      <td><button class="remove-record" type="button" data-action="remove-stash-item" aria-label="Remove ${escapeHtml(gearLabel(gear) || item.gearId)} from the stash" title="Remove from stash">×</button></td>
    </tr>`;
  }).join("");
  const query = stashView.query.trim().toLowerCase();
  const catalogue = [...state.gear]
    .filter((gear) => !stashView.category || gear.category === stashView.category)
    .filter((gear) => !query || [gear.name, gear.category, gear.description, ...(gear.tags || [])].join(" ").toLowerCase().includes(query))
    .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
  const market = catalogue.map((gear) => {
    const item = owned.get(gear.id);
    return `<li class="market-row">
      <span><strong>${escapeHtml(gear.name)}</strong> <span class="helper">${escapeHtml(humanize(gear.category))} · ${priceText(gear.price)} · ${weightText(gear.weight)}${gear.availability !== "common" ? ` · ${escapeHtml(humanize(gear.availability))}` : ""}${gear.published ? "" : " · unpublished"}</span></span>
      <button type="button" class="button button-secondary" data-action="add-stash-item" data-gear-id="${escapeHtml(gear.id)}">${item ? `In stash (${item.quantity}) · +1` : "+ Add"}</button>
    </li>`;
  }).join("");
  const tab = (key, label) => `<button type="button" class="outpost-tab" role="tab" data-stash-tab="${key}" aria-selected="${stashView.tab === key}">${label}</button>`;
  return `<div class="stash-editor" data-stash>
    <div class="outpost-tabs" role="tablist" aria-label="Inventory">${tab("stash", `My Stash (${stash.length})`)}${tab("market", "Marketplace")}</div>
    <div class="stash-panel" ${stashView.tab === "stash" ? "" : "hidden"}>
      ${stash.length ? `<table class="stash-table"><thead><tr><th>Gear</th><th>Category</th><th class="numeric">Weight</th><th>Qty</th><th>Brought into action</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="nested-empty">The stash is empty. Add Gear from the Marketplace tab.</p>'}
      <p class="helper">Removing an entry only removes it from this character; the Gear stays in the Marketplace. No Load limit is enforced yet.</p>
    </div>
    <div class="stash-panel" ${stashView.tab === "market" ? "" : "hidden"}>
      <div class="stash-market-filters">
        <input type="search" data-stash-query value="${escapeHtml(stashView.query)}" placeholder="Search Gear" aria-label="Search Gear" />
        <select data-stash-category aria-label="Gear category"><option value="">All categories</option>${GEAR_CATEGORIES.map((category) => `<option value="${category}" ${stashView.category === category ? "selected" : ""}>${humanize(category)}</option>`).join("")}</select>
      </div>
      ${market ? `<ul class="market-list">${market}</ul>` : `<p class="nested-empty">${state.gear.length ? "No Gear matches." : "No Gear yet. Create it in Marketplace / Gear."}</p>`}
      <p class="helper">Adding Gear here does not charge the character anything; handle purchases at the table.</p>
    </div>
  </div>`;
}

function rerenderStash(stash) {
  const editor = document.querySelector("[data-stash]");
  const focusedQuery = document.activeElement?.matches("[data-stash-query]");
  editor.outerHTML = stashEditor(stash);
  if (focusedQuery) {
    const input = document.querySelector("[data-stash-query]");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

/* ---------- Content type definitions ---------- */

/* ---------- Capability contributing assets: facilities and characters ---------- */

const ASSET_KINDS = { facility: ["facilities", "Facility"], character: ["characters", "Character"] };
const capabilitiesUsing = (type, id) => (state.outpost.capabilities || [])
  .filter((capability) => Array.isArray(capability.assets) && capability.assets.some((asset) => asset.type === type && asset.id === id));
const assetLabel = (type, record) => type === "character" ? characterLabel(record) : record.name || "Unnamed";

function assetChip(asset) {
  const [key, kind] = ASSET_KINDS[asset.type] || ["", "Record"];
  const record = key ? findRecord(key, asset.id) : null;
  const label = record ? assetLabel(asset.type, record) : hiddenSampleLabel(key, asset.id) || `Missing ${kind.toLowerCase()}: ${asset.id}`;
  return `<li class="asset-chip is-${escapeHtml(asset.type)}" data-asset-type="${escapeHtml(asset.type)}" data-asset-id="${escapeHtml(asset.id)}">`
    + `<span class="asset-kind">${kind}</span><span class="asset-name">${escapeHtml(label)}${record && !record.published ? " — unpublished" : ""}</span>`
    + `<button type="button" class="asset-remove" data-action="remove-asset" aria-label="Remove ${escapeHtml(label)}" title="Remove">×</button></li>`;
}

function assetOptions(selected) {
  const taken = new Set(selected.map((asset) => `${asset.type}:${asset.id}`));
  const group = (type, label) => {
    const options = [...state[ASSET_KINDS[type][0]]]
      .filter((record) => !taken.has(`${type}:${record.id}`))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)))
      .map((record) => `<option value="${type}:${escapeHtml(record.id)}">${escapeHtml(assetLabel(type, record))}${record.published ? "" : " — unpublished"}</option>`)
      .join("");
    return options ? `<optgroup label="${label}">${options}</optgroup>` : "";
  };
  return `<option value="">+ Add a facility or character…</option>${group("facility", "Facilities")}${group("character", "Characters")}`;
}

// Chips in order, then a menu of the facilities and characters not listed yet.
function assetPicker(id, assets) {
  const list = Array.isArray(assets) ? assets : [];
  return `<div class="asset-picker" data-outpost-path="assets">
    <ul class="asset-list">${list.map(assetChip).join("")}</ul>
    <p class="asset-empty">No contributing assets yet.</p>
    <select id="${id}" class="asset-add">${assetOptions(list)}</select>
  </div>`;
}

const readAssets = (picker) => [...picker.querySelectorAll(".asset-chip")]
  .map((chip) => ({ type: chip.dataset.assetType, id: chip.dataset.assetId }));

function refreshAssetPicker(picker) {
  const select = picker.querySelector(".asset-add");
  select.innerHTML = assetOptions(readAssets(picker));
  select.value = "";
}

/* ---------- Projects ---------- */

const PROJECT_ACCESS = [["open", "Open to anyone"], ["private", "Private to its characters"]];
const projectComplete = (project) => (project.progress?.current ?? 0) >= (project.progress?.max ?? 1);
const projectProgress = (project) => projectComplete(project) ? "Completed" : `${project.progress?.current ?? 0}/${project.progress?.max ?? 4} boxes`;
const projectSelect = (record) => referenceSelect("Brought into the game by project", "projectId", record.projectId, "projects", (project) => project.name,
  { emptyLabel: "— No project —", help: "Optional. The project whose outcome this is." });
// Older records kept prerequisites as plain text.
const projectPrerequisites = (project) => (project.prerequisites || []).map((item) => typeof item === "string" ? { text: item, met: false } : item);
const activeComplications = (project) => (project.complications || []).filter((item) => !item.resolved);

function prerequisiteRow(item = { text: "", met: false }) {
  return `<div class="checklist-row" data-prerequisite-row>
    <input type="checkbox" data-prerequisite="met" ${item.met ? "checked" : ""} aria-label="Fulfilled" title="Fulfilled" />
    <input type="text" data-prerequisite="text" value="${escapeHtml(item.text)}" placeholder="What must be true first" aria-label="Prerequisite" />
    <button class="remove-record" type="button" data-action="remove-project-row" aria-label="Remove prerequisite" title="Remove prerequisite">×</button>
  </div>`;
}

function complicationRow(item = { text: "", resolved: false, resolution: "" }) {
  return `<div class="complication-row${item.resolved ? "" : " is-active"}" data-complication-row>
    <div class="complication-row-head">
      <span class="complication-state">${item.resolved ? "Resolved" : "Active"}</span>
      <label class="inline-check"><input type="checkbox" data-complication="resolved" ${item.resolved ? "checked" : ""} /> Resolved</label>
      <button class="remove-record" type="button" data-action="remove-project-row" aria-label="Remove complication" title="Remove complication">×</button>
    </div>
    <textarea data-complication="text" rows="2" placeholder="What went wrong or stands in the way" aria-label="Complication">${escapeHtml(item.text)}</textarea>
    <textarea data-complication="resolution" rows="2" placeholder="How it was resolved" aria-label="Resolution">${escapeHtml(item.resolution || "")}</textarea>
  </div>`;
}

const projectRows = (projects) => projects.map((project) => `${referenceLink("projects", project, project.name)} <span class="helper">${escapeHtml(projectProgress(project))}</span>`);

const collections = {
  projects: {
    title: "Projects", panel: "PROJECTS", singular: "Project",
    name: (record) => record.name,
    meta: (record) => [record.access === "private" ? "Private" : "Open", record.outpost ? "Outpost" : "",
      activeComplications(record).length ? "⚠ Complication" : "", projectProgress(record)],
    filters: [["access", "Any access", [["open", "Open"], ["private", "Private"]]]],
    idHelp: "Generated from the name when left blank. Gear and facilities reference this ID.",
    fields: (record) => {
      const progress = record.progress || { current: 0, max: 4 };
      return `
      ${field("Name", "name", record.name || "", { required: true, full: true })}
      ${selectField("Access", "access", record.access || "open", PROJECT_ACCESS, { help: "Open projects take anyone who wants to help; private ones only their characters." })}
      <label class="publish-toggle field"><input type="checkbox" name="outpost" ${record.outpost ? "checked" : ""} /><span><strong>Outpost project</strong><span class="helper">Shown on the Outpost page while it is ongoing.</span></span></label>
      ${field("Marked progress", "progressCurrent", progress.current ?? 0, { type: "number", min: 0 })}
      ${field("Progress boxes", "progressMax", progress.max ?? 4, { type: "number", min: 1, help: "The project is completed when every box is marked." })}
      ${participantPicker(record.characterIds || [], { label: "Characters", help: "Each character listed shows this project on their character page." })}
      ${textarea("Summary", "summary", record.summary || "", { full: true, rows: 3 })}
      <div class="field full"><span class="field-label">Prerequisites</span>
        <div class="checklist-rows" id="prerequisite-rows">${projectPrerequisites(record).map(prerequisiteRow).join("")}</div>
        <div class="row-actions"><button type="button" class="button button-secondary" data-action="add-prerequisite">+ Add prerequisite</button>
          <span class="helper">Tick a prerequisite once it is met. Empty rows are dropped on save.</span></div></div>
      <div class="field full"><span class="field-label">Complications</span>
        <div class="complication-rows" id="complication-rows">${(record.complications || []).map(complicationRow).join("")}</div>
        <div class="row-actions"><button type="button" class="button button-secondary" data-action="add-complication">+ Add complication</button>
          <span class="helper">An active complication marks the project in red on the site. Resolved ones stay in its complication history.</span></div></div>
      ${textarea("Expected outcome", "outcome", record.outcome || "", { full: true, rows: 4, help: "What changes in the world when it is completed. Markdown; link Archive entries with [[archive-id]]." })}`;
    },
    related: (record) => {
      const facilities = state.facilities.filter((facility) => facility.projectId === record.id);
      const gear = state.gear.filter((item) => item.projectId === record.id);
      return `<div class="form-section">Derived references</div>
        ${relatedBlock("Brought into the game", [
          ...facilities.map((facility) => `${referenceLink("facilities", facility, facility.name)} <span class="helper">facility</span>`),
          ...gear.map((item) => `${referenceLink("gear", item, item.name)} <span class="helper">gear</span>`)
        ], "No facility or gear names this project yet.")}
        ${linkCheck([record.summary, record.outcome])}`;
    },
    read: (formData, form) => ({
      name: formText(formData, "name"), access: formText(formData, "access"), outpost: formData.get("outpost") === "on",
      progress: { current: formText(formData, "progressCurrent"), max: formText(formData, "progressMax") },
      characterIds: [...form.querySelectorAll(".participant-check:checked")].map((checkbox) => checkbox.value),
      summary: formText(formData, "summary"), outcome: formText(formData, "outcome"),
      prerequisites: [...form.querySelectorAll("[data-prerequisite-row]")].map((row) => ({
        text: row.querySelector('[data-prerequisite="text"]').value.trim(), met: row.querySelector('[data-prerequisite="met"]').checked
      })).filter((item) => item.text),
      complications: [...form.querySelectorAll("[data-complication-row]")].map((row) => ({
        text: row.querySelector('[data-complication="text"]').value.trim(),
        resolved: row.querySelector('[data-complication="resolved"]').checked,
        resolution: row.querySelector('[data-complication="resolution"]').value.trim()
      })).filter((item) => item.text)
    })
  },
  facilities: {
    title: "Facilities", panel: "OUTPOST FACILITIES", singular: "Facility",
    name: (record) => record.name,
    meta: (record) => {
      const supported = capabilitiesUsing("facility", record.id).map((capability) => capability.name);
      return [supported.length ? supported.join(", ") : "Not assigned"];
    },
    idHelp: "Generated from the name when left blank. Capabilities on the Outpost Sheet reference this ID.",
    fields: (record) => `
      ${field("Name", "name", record.name || "", { required: true, full: true })}
      ${textarea("Service", "summary", record.summary || "", { full: true, rows: 3, help: "What the facility makes available, in a sentence or two. Shown in the Facilities table on the Outpost page." })}
      ${textarea("Details", "details", record.details || "", { full: true, rows: 6, help: "Optional. Markdown: **bold**, *italic*, lists, [text](url). Link Archive entries with [[archive-id]]." })}
      ${projectSelect(record)}
      <div class="field full"><span class="helper">Assign the facility to a capability under <strong>Contributing assets</strong> on the Outpost Sheet’s Capabilities tab.</span></div>`,
    related: (record) => {
      const supported = capabilitiesUsing("facility", record.id);
      return `<div class="form-section">Derived references</div>
        ${relatedBlock("Supports capabilities", supported.map((capability) => `<button type="button" class="related-link" data-jump-view="outpost">${escapeHtml(capability.name || "Unnamed")}</button> <span class="helper">${escapeHtml(capability.rating || "")}</span>`), "Not assigned to a capability yet.")}
        ${linkCheck([record.summary, record.details])}`;
    },
    read: (formData) => ({ name: formText(formData, "name"), summary: formText(formData, "summary"), details: formText(formData, "details"),
      projectId: formText(formData, "projectId") || null })
  },
  characters: {
    title: "Characters", panel: "CHARACTER ROSTER", singular: "Character",
    name: (record) => record.name,
    meta: (record) => [record.type === "npc" ? "NPC" : "PC", record.status],
    idHelp: "Generated from the name when left blank.",
    fields: (record) => `
      ${field("Name", "name", record.name || "", { required: true })}
      ${field("Player name", "playerName", record.playerName || "", { help: "Mostly relevant for player characters." })}
      ${selectField("Type", "type", record.type || "player", [["player", "Player character"], ["npc", "NPC"]])}
      ${selectField("Status", "status", record.status || "active", enumChoices(["active", "inactive", "missing", "deceased"]))}
      ${imageField("Portrait", "portrait", record.portrait, "portrait")}
      ${textarea("Public summary", "summary", record.summary || "", { full: true, help: "A short, player-facing description." })}
      <div class="form-section">Fate Core character sheet</div>
      <div class="field full sheet-import-bar">
        <label class="button button-secondary">Import sheet file<input type="file" accept=".html,.htm,.json,text/html,application/json" data-sheet-import hidden /></label>
        <span class="helper">Load a sheet file a player saved from the public site. You can review the changes before saving.</span>
      </div>
      <div class="field full" id="sheet-import-note" hidden></div>
      <div class="field full" id="sheet-editor">${sheetEditor(record.sheet)}</div>
      <div class="form-section">Inventory</div>
      <div class="field full">${stashEditor(record.stash || [])}</div>`,
    related: (record) => {
      const jobs = state.jobs.filter((job) => job.organizerId === record.id || job.participantIds.includes(record.id));
      const sessions = state.archive.filter((entry) => entry.participantIds.includes(record.id));
      return `<div class="form-section">Derived history</div>
        ${relatedBlock("Jobs", jobs.map((job) => `${referenceLink("jobs", job, jobLabel(job))} <span class="helper">${job.organizerId === record.id ? "organizer" : "crew"} · ${job.status}</span>`), "Not part of any job yet.")}
        ${relatedBlock("Session Records", sessions.map((entry) => referenceLink("archive", entry, sessionRecordLabel(entry))), "Not listed in any Session Record.")}
        ${relatedBlock("Projects", projectRows(state.projects.filter((project) => (project.characterIds || []).includes(record.id))), "Not part of any project.")}
        ${relatedBlock("Outpost capabilities", capabilitiesUsing("character", record.id).map((capability) => `<button type="button" class="related-link" data-jump-view="outpost">${escapeHtml(capability.name || "Unnamed")}</button> <span class="helper">contributing asset</span>`), "Not a contributing asset of any capability.")}`;
    },
    read: (formData, form) => ({
      name: formText(formData, "name"), playerName: formText(formData, "playerName"),
      type: formText(formData, "type"), status: formText(formData, "status"),
      portrait: formText(formData, "portrait"), summary: formText(formData, "summary"),
      sheet: readSheet(form), stash: readStash(form) || []
    })
  },
  jobs: {
    title: "Job Board", panel: "JOB LISTINGS", singular: "Job",
    name: (record) => record.title,
    meta: (record) => [humanize(record.type), record.status],
    filters: [["status", "All statuses", JOB_STATUSES.map((value) => [value, humanize(value)])],
              ["type", "All types", JOB_TYPES.map((value) => [value, humanize(value)])]],
    idHelp: "Generated from the designation (or title) when left blank; used in public page links.",
    fields: (record) => `
      ${field("Title", "title", record.title || "", { required: true, full: true })}
      ${selectField("Type", "type", record.type || "expedition", JOB_TYPES.map((value) => [value, humanize(value)]))}
      ${selectField("Status", "status", record.status || "open", JOB_STATUSES.map((value) => [value, humanize(value)]))}
      ${field("Designation", "designation", record.designation || "", { placeholder: "E-20", help: "Optional short code." })}
      ${field("Posted by", "postedBy", record.postedBy || "", { placeholder: "e.g. Harbor Authority", help: "Optional. The in-world client or notice issuer." })}
      ${textarea("Summary", "summary", record.summary || "", { full: true, help: "One or two sentences for the Job Board card. The objective is used when this is empty." })}
      ${textarea("Objective", "objective", record.objective || "", { full: true })}
      ${textarea("Briefing", "briefing", record.briefing || "", { full: true, rows: 7, help: "Optional. Markdown: **bold**, *italic*, # headings, - and 1. lists, > quotes, tables, `code`, [text](url). Link Archive entries with [[archive-id]] or [[archive-id|text]]." })}
      <div class="form-section">Schedule and crew</div>
      ${field("Scheduled", "scheduledAt", record.scheduledAt || "", { type: "datetime-local" })}
      ${field("Expected duration", "expectedDuration", record.expectedDuration || "", { placeholder: "e.g. 3 hours" })}
      ${field("Minimum crew", "crewMin", record.crewMin ?? "", { type: "number", min: 0 })}
      ${field("Maximum crew", "crewMax", record.crewMax ?? "", { type: "number", min: 0 })}
      ${referenceSelect("Organizer", "organizerId", record.organizerId, "characters", characterLabel, { full: true })}
      ${participantPicker(record.participantIds || [])}
      ${textarea("Requirements", "requirements", listText(record.requirements), { full: true, help: "Optional. One per line." })}
      <div class="form-section">After play</div>
      ${referenceSelect("Session Record", "sessionRecordId", record.sessionRecordId, "archive", sessionRecordLabel, {
        full: true, emptyLabel: "— No Session Record yet —", filter: (entry) => entry.type === "session-record",
        help: "What happened when this Job was played. Create the record in the Archive first." })}`,
    related: (record) => linkCheck([record.summary, record.objective, record.briefing]) + legacyNote(record),
    read: (formData, form) => ({
      title: formText(formData, "title"), designation: formText(formData, "designation"),
      type: formText(formData, "type"), status: formText(formData, "status"), postedBy: formText(formData, "postedBy"),
      summary: formText(formData, "summary"), objective: formText(formData, "objective"), briefing: formText(formData, "briefing"),
      scheduledAt: formText(formData, "scheduledAt"), expectedDuration: formText(formData, "expectedDuration"),
      crewMin: formText(formData, "crewMin"), crewMax: formText(formData, "crewMax"),
      organizerId: formText(formData, "organizerId") || null,
      participantIds: [...form.querySelectorAll(".participant-check:checked")].map((checkbox) => checkbox.value),
      requirements: linesToArray(formData.get("requirements")),
      sessionRecordId: formText(formData, "sessionRecordId") || null
    })
  },
  archive: {
    title: "Archive", panel: "ARCHIVE ENTRIES", singular: "Archive entry",
    name: (record) => record.title,
    meta: (record) => [archiveTypeLabel(record.type), record.type === "gate-record" ? record.details?.designation : record.publishedAt || record.details?.sessionDate],
    filters: [["type", "All types", ARCHIVE_TYPES]],
    idHelp: "Generated from the designation or title when left blank. It is the entry's permanent URL (archive.html#id) and the target of [[id]] links.",
    fields: (record) => {
      const type = record.type || listFilters.archive?.type || "history";
      const details = record.details || {};
      const section = (key, content) => `<div class="field full type-section" data-type-section="${key}" ${type === key ? "" : "hidden"}><div class="form-grid nested-grid">${content}</div></div>`;
      return `
      ${selectField("Type", "type", type, ARCHIVE_TYPES, { help: "Gate and Session Records have extra fields below." })}
      ${field("Title", "title", record.title || "", { required: true })}
      ${field("Subtitle", "subtitle", record.subtitle || "", { full: true })}
      ${textarea("Summary", "summary", record.summary || "", { full: true, help: "Optional teaser shown in Archive listings." })}
      ${textarea("Content", "content", record.content || "", { full: true, rows: 12, help: "Markdown: **bold**, *italic*, # headings, - and 1. lists, > quotes, tables, `code`, [text](url). Link Archive entries with [[archive-id]] or [[archive-id|text]]." })}
      ${field("Author", "author", record.author || "", { placeholder: "e.g. Harbor Gazette" })}
      ${field("Published", "publishedAt", record.publishedAt || "", { type: "date", help: "When the document appeared in the world." })}
      ${field("Event date", "eventDate", record.eventDate || "", { help: "Free text; in-world dates are allowed." })}
      ${textarea("Tags", "tags", listText(record.tags), { help: "One per line." })}
      ${imageField("Image", "image", record.image)}
      ${section("gate-record", `
        <div class="form-section">Gate Record</div>
        ${field("Designation", "gateDesignation", details.designation || "", { placeholder: "G-17", help: "Required for Gate Records." })}
        ${selectField("Gate status", "gateStatus", details.gateStatus || "active", enumChoices(["active", "dormant", "collapsed", "lost"]))}
        ${field("Discovered", "discoveredAt", details.discoveredAt || "", { type: "date" })}
        ${textarea("Environment", "environment", details.environment || "", { full: true, help: "What the Outpost currently knows. Keep GM-only truths out of this record." })}
        ${textarea("Known traits", "knownTraits", listText(details.knownTraits), { help: "One per line." })}
        ${textarea("Known hazards", "knownHazards", listText(details.knownHazards), { help: "One per line." })}
        ${textarea("Known locations", "knownLocations", listText(details.knownLocations), { full: true, help: "One per line. Only locations the Expeditioners have found or heard of." })}`)}
      ${section("session-record", `
        <div class="form-section">Session Record</div>
        ${field("Session date", "sessionDate", details.sessionDate || "", { type: "date" })}
        ${selectField("Outcome", "outcome", details.outcome || "unknown", enumChoices(["success", "partial", "failed", "aborted", "unknown"]))}
        ${participantPicker(record.participantIds || [])}`)}`;
    },
    related: (record) => {
      const jobs = state.jobs.filter((job) => job.sessionRecordId === record.id);
      const linkedFrom = [...state.archive, ...state.jobs].filter((other) => other.id !== record.id
        && [other.content, other.summary, other.briefing, other.objective].join("\n").includes(`[[${record.id}`));
      return `<div class="form-section">Derived references</div>
        ${record.type === "session-record" ? relatedBlock("Session Record of", jobs.map((job) => referenceLink("jobs", job, jobLabel(job))), "No Job points at this record yet.") : ""}
        ${relatedBlock("Linked from", linkedFrom.map((other) => state.archive.includes(other) ? referenceLink("archive", other, archiveLabel(other)) : referenceLink("jobs", other, jobLabel(other))), "No other record links here.")}
        ${linkCheck([record.summary, record.content])}${legacyNote(record)}`;
    },
    read: (formData, form) => {
      const type = formText(formData, "type");
      const details = type === "gate-record" ? {
        designation: formText(formData, "gateDesignation"), gateStatus: formText(formData, "gateStatus"),
        discoveredAt: formText(formData, "discoveredAt"), environment: formText(formData, "environment"),
        knownTraits: linesToArray(formData.get("knownTraits")), knownHazards: linesToArray(formData.get("knownHazards")),
        knownLocations: linesToArray(formData.get("knownLocations"))
      } : type === "session-record" ? { sessionDate: formText(formData, "sessionDate"), outcome: formText(formData, "outcome") } : {};
      return {
        type, title: formText(formData, "title"), subtitle: formText(formData, "subtitle"),
        summary: formText(formData, "summary"), content: formText(formData, "content"), author: formText(formData, "author"),
        publishedAt: formText(formData, "publishedAt"), eventDate: formText(formData, "eventDate"),
        image: formText(formData, "image"), tags: linesToArray(formData.get("tags")), details,
        participantIds: type === "session-record" ? [...form.querySelectorAll(".participant-check:checked")].map((checkbox) => checkbox.value) : []
      };
    }
  },
  gear: {
    title: "Marketplace / Gear", panel: "GEAR CATALOGUE", singular: "Gear",
    name: (record) => record.name,
    meta: (record) => [humanize(record.category), record.featured ? "Featured" : "", record.availability],
    filters: [["category", "All categories", GEAR_CATEGORIES.map((value) => [value, humanize(value)])],
              ["availability", "Any availability", GEAR_AVAILABILITY.map((value) => [value, humanize(value)])]],
    idHelp: "Generated from the name when left blank. Character stashes reference this ID.",
    fields: (record) => {
      const discount = record.discount || {};
      return `
      ${field("Name", "name", record.name || "", { required: true })}
      ${selectField("Category", "category", record.category || "tool", GEAR_CATEGORIES.map((value) => [value, humanize(value)]))}
      ${field(`${COIN_ICON} Price (${CURRENCY})`, "price", record.price ?? 0, { type: "number", min: 0 })}
      ${field(`${WEIGHT_ICON} Weight`, "weight", record.weight ?? 0, { type: "number", min: 0, help: "Counts toward a future Load limit when brought into action." })}
      ${selectField("Availability", "availability", record.availability || "common", GEAR_AVAILABILITY.map((value) => [value, humanize(value)]), { help: "Unavailable Gear stays listed on the public Marketplace, marked unavailable." })}
      ${textarea("Tags", "tags", listText(record.tags), { help: "One per line." })}
      ${textarea("Description", "description", record.description || "", { full: true })}
      ${imageField("Image", "image", record.image)}
      ${projectSelect(record)}
      <div class="form-section">Promotion</div>
      <label class="publish-toggle field full"><input type="checkbox" name="featured" ${record.featured ? "checked" : ""} /><span><strong>Featured</strong><span class="helper">Shown in the Marketplace carousel. About three featured items works best.</span></span></label>
      ${field("Promotional label", "promoLabel", record.promoLabel || "", { placeholder: "NEW", help: `Optional, up to 24 characters. Suggestions: ${PROMO_LABELS.join(", ")}.`, list: "promo-labels" })}
      <datalist id="promo-labels">${PROMO_LABELS.map((label) => `<option value="${label}"></option>`).join("")}</datalist>
      <label class="publish-toggle field"><input type="checkbox" name="discountActive" ${discount.active ? "checked" : ""} /><span><strong>Discount active</strong><span class="helper">Shows the sale price with the regular price struck through.</span></span></label>
      ${field(`${COIN_ICON} Sale price (${CURRENCY})`, "salePrice", discount.salePrice ?? "", { type: "number", min: 0 })}`;
    },
    related: (record) => {
      const owners = state.characters.filter((character) => (character.stash || []).some((item) => item.gearId === record.id));
      return `<div class="form-section">Derived references</div>
        ${relatedBlock("In the stash of", owners.map((character) => {
          const item = character.stash.find((entry) => entry.gearId === record.id);
          return `${referenceLink("characters", character, character.name)} <span class="helper">× ${item.quantity}${item.broughtIntoAction ? " · in action" : ""}</span>`;
        }), "No character owns this Gear.")}`;
    },
    read: (formData) => ({
      name: formText(formData, "name"), category: formText(formData, "category"),
      price: formText(formData, "price"), weight: formText(formData, "weight"), availability: formText(formData, "availability"),
      tags: linesToArray(formData.get("tags")), description: formText(formData, "description"), image: formText(formData, "image"),
      featured: formData.get("featured") === "on", promoLabel: formText(formData, "promoLabel"),
      discount: { active: formData.get("discountActive") === "on", salePrice: formText(formData, "salePrice") },
      projectId: formText(formData, "projectId") || null
    })
  },
  game: {
    title: "Game", panel: "GAME POSTS", singular: "Game post",
    name: (record) => record.title,
    meta: (record) => record.type === "announcement"
      ? ["Announcement", record.pinned ? "Pinned" : "", record.publishedAt]
      : ["Rule", record.category || "Uncategorized"],
    // Announcements first, newest at the top; then rules by title.
    sortKey: (record) => record.type === "announcement"
      ? `0 ${String(99999999 - Number(String(record.publishedAt || "0").replace(/-/g, ""))).padStart(8, "0")}`
      : `1 ${record.title || ""}`,
    filters: [["type", "Announcements and rules", [["announcement", "Announcements"], ["rule", "Rules"]]]],
    idHelp: "Generated from the title when left blank. Announcements are linked as game.html#post-<id>.",
    fields: (record) => {
      const type = record.type || listFilters.game?.type || "announcement";
      const categories = ["Campaign", "Jobs", "Outpost", "Information"];
      if (record.category && !categories.includes(record.category)) categories.push(record.category);
      const section = (key, content) => `<div class="field full type-section" data-type-section="${key}" ${type === key ? "" : "hidden"}><div class="form-grid nested-grid">${content}</div></div>`;
      return `
      ${selectField("Type", "type", type, [["announcement", "Announcement"], ["rule", "Rule"]], { help: "Announcements are dated notices; rules are reference material." })}
      ${field("Title", "title", record.title || "", { required: true })}
      ${section("announcement", `
        ${field("Posted", "publishedAt", record.publishedAt || new Date().toISOString().slice(0, 10), { type: "date", help: "Required for announcements." })}
        ${field("Show until", "showUntil", record.showUntil || "", { type: "date", help: "Optional. After this date the announcement is hidden from the site." })}
        <label class="publish-toggle field full"><input type="checkbox" name="pinned" ${record.pinned ? "checked" : ""} /><span><strong>Pinned</strong><span class="helper">Pinned announcements are listed first, and the newest one appears as a banner on the Overview page.</span></span></label>`)}
      ${section("rule", `
        ${selectField("Category", "category", record.category || "Campaign", categories.map((category) => [category, category]))}`)}
      ${textarea("Short summary", "summary", record.summary || "", { full: true })}
      ${textarea("Details", "details", record.details || "", { full: true, rows: 8, help: "Markdown: **bold**, *italic*, # headings, - and 1. lists, > quotes, tables, `code`, [text](url). Link Archive entries with [[archive-id]] or [[archive-id|text]]." })}
      ${textarea("Search tags", "tags", listText(record.tags), { full: true, help: "One tag per line. These terms are included in public search." })}`;
    },
    related: (record) => linkCheck([record.summary, record.details]) + legacyNote(record),
    read: (formData) => {
      const type = formText(formData, "type");
      return {
        type, title: formText(formData, "title"),
        category: type === "rule" ? formText(formData, "category") : "",
        publishedAt: type === "announcement" ? formText(formData, "publishedAt") : "",
        showUntil: type === "announcement" ? formText(formData, "showUntil") : "",
        pinned: type === "announcement" && formData.get("pinned") === "on",
        summary: formText(formData, "summary"), details: formText(formData, "details"),
        tags: linesToArray(formData.get("tags"))
      };
    }
  }
};

function legacyNote(record) {
  if (!record.legacy) return "";
  const source = { gates: "Gate", expeditions: "Expedition", expedition_reports: "Expedition Report", rules: "Rule" }[record.legacy.source] || record.legacy.source;
  return `<div class="field full"><span class="helper">Migrated from a v3 ${escapeHtml(source)}. The original record is kept in the database's legacy_records table.</span></div>`;
}

/* ---------- Batch import of character sheet files ---------- */

// Pick a folder of sheet files, validate them, review each one, and keep a report of what was not imported.
const BATCH_REPORT_KEY = "nowhere-manager:last-batch-import";
const batch = { stage: "select", ready: [], failed: [], ignored: 0, index: 0, results: [] };

// The same empty-row rules the server applies, so the change list shows only what would really change.
function comparableSheet(sheet) {
  const normalized = normalizeImportedSheet(sheet || {});
  return {
    ...normalized,
    aspects: { ...normalized.aspects, other: normalized.aspects.other.filter((text) => text.trim()) },
    skills: normalized.skills.filter((skill) => skill.name.trim()),
    stunts: normalized.stunts.filter((stunt) => stunt.name.trim() || stunt.description.trim()),
    stress: normalized.stress.filter((track) => track.name.trim()),
    consequences: normalized.consequences.filter((item) => item.label.trim())
  };
}

function importedStash(envelope) {
  if (!Array.isArray(envelope.stash)) return { stash: null, skipped: [] };
  const items = envelope.stash.filter((item) => item && typeof item.gearId === "string").map((item) => ({
    gearId: item.gearId,
    quantity: Math.max(1, Math.min(999, Math.round(Number(item.quantity)) || 1)),
    broughtIntoAction: Boolean(item.broughtIntoAction)
  }));
  return { stash: items.filter((item) => findRecord("gear", item.gearId)), skipped: items.filter((item) => !findRecord("gear", item.gearId)).map((item) => item.gearId) };
}

// One file: either a ready import (with its change list) or the reason it cannot be imported.
async function validateBatchFile(file) {
  let envelope;
  try {
    envelope = parseSheetFile(await file.text());
  } catch {
    return { file: file.name, error: "Not a character sheet file (invalid JSON or wrong format)." };
  }
  const isNew = Boolean(envelope.newCharacter) || !envelope.characterId;
  const name = String(envelope.characterName || "").trim();
  if (isNew && !name) return { file: file.name, error: "New character file without a character name." };
  const existing = isNew ? null : findRecord("characters", envelope.characterId);
  if (!isNew && !existing) {
    const hidden = hiddenSampleLabel("characters", envelope.characterId);
    return { file: file.name, character: name || envelope.characterId,
      error: hidden ? `Character “${envelope.characterId}” is hidden sample content; turn on Show sample content to import it.` : `No character with ID “${envelope.characterId}” in the manager.` };
  }
  const { stash, skipped } = importedStash(envelope);
  const before = existing?.sheet ? comparableSheet(existing.sheet) : null;
  const after = comparableSheet(envelope.sheet);
  const changes = [];
  if (isNew) {
    changes.push(`New character: ${name}${envelope.playerName ? ` (player: ${envelope.playerName})` : ""}`);
  }
  if (typeof envelope.summary === "string" && envelope.summary.trim() !== String(existing?.summary || "").trim()) {
    changes.push(existing?.summary ? "Public summary changed" : "Public summary added");
  }
  changes.push(...describeSheetChanges(before, after).filter((line) => !(isNew && line.startsWith("New sheet"))));
  if (stash) changes.push(...describeStashChanges(existing?.stash || [], stash));
  skipped.forEach((gearId) => changes.push(`Skipped unknown Gear “${gearId}”`));
  // New-character files carry no ID, so importing the same file twice would create a second character.
  const namesake = isNew ? state.characters.find((character) => String(character.name || "").trim().toLowerCase() === name.toLowerCase()) : null;
  return {
    file: file.name, envelope, isNew, existing, stash, changes,
    warning: namesake ? `A character named “${namesake.name}” already exists (${namesake.id}). Approving creates a second one; deny it if this file was already imported.` : "",
    character: isNew ? name : existing.name,
    key: isNew ? `new:${name.toLowerCase()}` : `id:${existing.id}`,
    savedAt: envelope.savedAt || ""
  };
}

async function startBatch(files) {
  const sheets = files.filter((file) => /\.json$/i.test(file.name));
  const checked = await Promise.all(sheets.map(validateBatchFile));
  const ready = [];
  const failed = checked.filter((item) => item.error);
  // Several files for one character: only the newest is reviewed.
  const byTarget = new Map();
  checked.filter((item) => !item.error).forEach((item) => {
    const current = byTarget.get(item.key);
    if (!current) byTarget.set(item.key, item);
    else {
      const [newer, older] = item.savedAt > current.savedAt ? [item, current] : [current, item];
      byTarget.set(item.key, newer);
      failed.push({ file: older.file, character: older.character, error: `Older file for the same character; ${newer.file} is newer.` });
    }
  });
  byTarget.forEach((item) => ready.push(item));
  ready.sort((left, right) => left.character.localeCompare(right.character));
  Object.assign(batch, { stage: "summary", ready, failed, ignored: files.length - sheets.length, index: 0,
    results: failed.map((item) => ({ file: item.file, character: item.character || "", status: "invalid", reason: item.error })) });
  renderBatch();
}

async function decideBatch(approve) {
  const item = batch.ready[batch.index];
  if (!approve) {
    batch.results.push({ file: item.file, character: item.character, status: "denied", reason: "Denied during review." });
  } else {
    try {
      const envelope = item.envelope;
      const sheet = { ...normalizeImportedSheet(envelope.sheet), public: item.existing?.sheet ? item.existing.sheet.public !== false : true };
      const summary = typeof envelope.summary === "string" ? envelope.summary.trim() : item.existing?.summary || "";
      if (item.isNew) {
        await api("/api/characters", { method: "POST", body: JSON.stringify({ data: {
          name: item.character, playerName: String(envelope.playerName || "").trim(), type: "player", status: "active",
          summary, sheet, stash: item.stash || [], published: false
        } }) });
      } else {
        const { id, legacy, sample, ...record } = item.existing;
        await api(`/api/characters/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ data: {
          ...record, summary, sheet, ...(item.stash ? { stash: item.stash } : {})
        } }) });
      }
      batch.results.push({ file: item.file, character: item.character, status: "imported", reason: item.isNew ? "Created (unpublished)." : "Updated." });
    } catch (error) {
      batch.results.push({ file: item.file, character: item.character, status: "error", reason: `Could not be saved: ${error.message || "unknown error"}` });
    }
  }
  batch.index += 1;
  if (batch.index >= batch.ready.length) finishBatch();
  else renderBatch();
}

function finishBatch() {
  batch.stage = "done";
  try { localStorage.setItem(BATCH_REPORT_KEY, JSON.stringify({ at: new Date().toISOString(), results: batch.results })); } catch { /* storage unavailable */ }
  renderBatch();
  loadState().catch((error) => showNotice(error.message, true));
}

const BATCH_STATUS = { imported: "Imported", denied: "Denied", invalid: "Failed validation", error: "Save failed" };

function batchReportText(results, at) {
  return [`Batch import ${new Date(at).toLocaleString()}`, ...results.map((item) =>
    `${BATCH_STATUS[item.status]}: ${item.character ? `${item.character} — ` : ""}${item.file}. ${item.reason}`)].join("\n");
}

function batchList(items, empty, success = false) {
  return items.length ? `<ul class="batch-list">${items.map((item) => `
    <li><strong>${escapeHtml(item.character || "Unknown character")}</strong> <span class="helper">${escapeHtml(item.file)}</span>
      ${item.reason || item.error ? `<span class="${success ? "batch-done" : "batch-reason"}">${escapeHtml(item.reason || item.error)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="helper">${empty}</p>`;
}

function renderBatch() {
  const body = document.getElementById("batch-body");
  if (batch.stage === "select") {
    let last = null;
    try { last = JSON.parse(localStorage.getItem(BATCH_REPORT_KEY) || "null"); } catch { last = null; }
    body.innerHTML = `
      <p>Choose the folder where you keep the sheet files players sent you. Every <code>.json</code> sheet file in it is checked; other files are ignored.</p>
      <div class="batch-pickers">
        <label class="button button-primary">Choose folder…<input type="file" data-batch-files webkitdirectory directory multiple hidden /></label>
        <label class="button button-secondary">Choose files…<input type="file" data-batch-files accept=".json,application/json" multiple hidden /></label>
      </div>
      ${last ? `<details class="batch-last"><summary>Last batch import (${escapeHtml(new Date(last.at).toLocaleString())}): ${last.results.filter((item) => item.status === "imported").length} imported, ${last.results.filter((item) => item.status !== "imported").length} not imported</summary>
        ${batchList(last.results.filter((item) => item.status !== "imported").map((item) => ({ ...item, reason: `${BATCH_STATUS[item.status]}: ${item.reason}` })), "Everything was imported.")}</details>` : ""}`;
    return;
  }
  if (batch.stage === "summary") {
    body.innerHTML = `
      <div class="batch-columns">
        <section><h3>Ready to review (${batch.ready.length})</h3>
          ${batch.ready.length ? `<ul class="batch-list">${batch.ready.map((item) => `
            <li><strong>${escapeHtml(item.character)}</strong> <span class="batch-tag">${item.isNew ? "New" : "Update"}</span>
              <span class="helper">${escapeHtml(item.file)}${item.savedAt ? ` · saved ${escapeHtml(new Date(item.savedAt).toLocaleString())}` : ""} · ${item.changes.length} change${item.changes.length === 1 ? "" : "s"}</span>
              ${item.warning ? `<span class="batch-warning">${escapeHtml(item.warning)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="helper">No valid sheet files found.</p>'}
        </section>
        <section><h3>Failed validation (${batch.failed.length})</h3>${batchList(batch.failed, "Every file passed.")}</section>
      </div>
      ${batch.ignored ? `<p class="helper">${batch.ignored} other file${batch.ignored === 1 ? " was" : "s were"} ignored (not .json).</p>` : ""}
      <div class="batch-actions">
        <button type="button" class="button button-secondary" data-batch="restart">Choose again</button>
        ${batch.ready.length ? `<button type="button" class="button button-primary" data-batch="review">Start review</button>`
          : '<button type="button" class="button button-primary" data-batch="finish">Finish</button>'}
      </div>`;
    return;
  }
  if (batch.stage === "review") {
    const item = batch.ready[batch.index];
    body.innerHTML = `
      <p class="batch-progress">Reviewing ${batch.index + 1} of ${batch.ready.length}</p>
      <div class="batch-card">
        <h3>${escapeHtml(item.character)} <span class="batch-tag">${item.isNew ? "New character" : "Update"}</span></h3>
        <p class="helper">${escapeHtml(item.file)}${item.savedAt ? ` · saved by the player ${escapeHtml(new Date(item.savedAt).toLocaleString())}` : ""}${item.envelope.playerName ? ` · player: ${escapeHtml(item.envelope.playerName)}` : ""}</p>
        ${item.warning ? `<p class="batch-warning">${escapeHtml(item.warning)}</p>` : ""}
        ${item.changes.length ? `<ul class="batch-changes">${item.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : '<p class="helper">The file matches the current character; approving changes nothing.</p>'}
        ${typeof item.envelope.summary === "string" && item.envelope.summary.trim() ? `<p class="batch-summary"><span class="field-label">Public summary</span>${escapeHtml(item.envelope.summary.trim())}</p>` : ""}
      </div>
      <div class="batch-actions">
        <button type="button" class="button button-danger" data-batch="deny">Deny</button>
        <button type="button" class="button button-primary" data-batch="approve">Approve and save</button>
      </div>`;
    body.querySelector('[data-batch="approve"]').focus();
    return;
  }
  const imported = batch.results.filter((item) => item.status === "imported");
  const notImported = batch.results.filter((item) => item.status !== "imported");
  body.innerHTML = `
    <div class="batch-columns">
      <section><h3>Imported (${imported.length})</h3>${batchList(imported, "Nothing was imported.", true)}</section>
      <section><h3>Not imported (${notImported.length})</h3>
        ${notImported.length ? `<ul class="batch-list">${notImported.map((item) => `
          <li><strong>${escapeHtml(item.character || "Unknown character")}</strong> <span class="batch-tag is-${item.status}">${BATCH_STATUS[item.status]}</span>
            <span class="helper">${escapeHtml(item.file)}</span><span class="batch-reason">${escapeHtml(item.reason)}</span></li>`).join("")}</ul>` : '<p class="helper">Everything was imported.</p>'}
      </section>
    </div>
    <p class="helper">Imported changes are saved in the manager. Sync data or Export to site to publish them. This report stays available under “Last batch import”.</p>
    <div class="batch-actions">
      <button type="button" class="button button-secondary" data-batch="copy">Copy report</button>
      <button type="button" class="button button-primary" data-batch="close">Done</button>
    </div>`;
}

function openBatch() {
  let dialog = document.getElementById("batch-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "batch-dialog";
    dialog.className = "batch-dialog";
    dialog.setAttribute("aria-labelledby", "batch-title");
    dialog.innerHTML = `<header class="batch-head"><div><span class="eyebrow">CHARACTERS</span><h2 id="batch-title">Batch import sheet files</h2></div>
      <button type="button" class="button button-secondary" data-batch="close" aria-label="Close">✕</button></header><div id="batch-body"></div>`;
    document.body.append(dialog);
    // Esc mid-review behaves like the close button, so unreviewed files are recorded in the report.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.querySelector('[data-batch="close"]').click();
    });
    dialog.addEventListener("change", async (event) => {
      if (!event.target.matches("[data-batch-files]")) return;
      const files = [...(event.target.files || [])];
      event.target.value = "";
      if (files.length) await startBatch(files).catch((error) => showNotice(error.message, true));
    });
    dialog.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-batch]")?.dataset.batch;
      if (!action) return;
      if (action === "close") {
        if (batch.stage === "review" && !confirm("Stop reviewing? Files not reviewed yet are not imported.")) return;
        if (batch.stage === "review") {
          batch.ready.slice(batch.index).forEach((item) => batch.results.push({ file: item.file, character: item.character, status: "denied", reason: "Not reviewed (review stopped)." }));
          finishBatch();
        }
        dialog.close();
      } else if (action === "restart") {
        batch.stage = "select";
        renderBatch();
      } else if (action === "review") {
        batch.stage = "review";
        renderBatch();
      } else if (action === "finish") {
        finishBatch();
      } else if (action === "approve" || action === "deny") {
        event.target.closest(".batch-actions").querySelectorAll("button").forEach((button) => { button.disabled = true; });
        await decideBatch(action === "approve");
      } else if (action === "copy") {
        const text = batchReportText(batch.results, new Date().toISOString());
        try { await navigator.clipboard.writeText(text); showNotice("Batch import report copied."); } catch { prompt("Copy the report:", text); }
      }
    });
  }
  Object.assign(batch, { stage: "select", ready: [], failed: [], ignored: 0, index: 0, results: [] });
  renderBatch();
  dialog.showModal();
}

/* ---------- Site & launch: countdown, roadmap, Discord, sponsor ---------- */

const ROADMAP_STATUS = [["todo", "To do"], ["in-progress", "In progress"], ["done", "Done"]];

function roadmapRow(step = { title: "", detail: "", status: "todo", date: "" }) {
  return `<div class="roadmap-row" data-roadmap-row>
    <input type="text" data-step="title" value="${escapeHtml(step.title)}" placeholder="Step" aria-label="Step" />
    <input type="text" data-step="detail" value="${escapeHtml(step.detail)}" placeholder="Optional detail" aria-label="Step detail" />
    <input type="date" data-step="date" value="${escapeHtml(step.date || "")}" aria-label="Date (or estimate)" title="When it happened, or the estimate" />
    <select data-step="status" aria-label="Status">${ROADMAP_STATUS.map(([value, label]) => `<option value="${value}" ${step.status === value ? "selected" : ""}>${label}</option>`).join("")}</select>
    <span class="roadmap-move">
      <button type="button" class="button button-secondary" data-action="roadmap-up" aria-label="Move up" title="Move up">↑</button>
      <button type="button" class="button button-secondary" data-action="roadmap-down" aria-label="Move down" title="Move down">↓</button>
    </span>
    <button class="remove-record" type="button" data-action="roadmap-remove" aria-label="Remove step" title="Remove step">×</button>
  </div>`;
}

function renderSiteEditor() {
  const site = state.site || {};
  const sponsor = site.sponsor || {};
  const community = site.community || {};
  const done = (site.roadmap || []).filter((step) => step.status === "done").length;
  document.getElementById("work-area").innerHTML = `
    <form id="site-form" class="outpost-layout">
      <header class="outpost-editor-head">
        <div><h2>Site &amp; launch</h2><p>The launch countdown and roadmap on the Overview, the Discord link, and the community and sponsor credits in every page footer.</p></div>
        <div class="editor-actions"><button type="button" class="button button-secondary" data-action="open-preview">Preview</button><button type="submit" class="button button-primary">Save site settings</button></div>
      </header>
      <section class="outpost-panel">
        <h2>Launch</h2>
        <div class="outpost-fields">
          <label class="publish-toggle field full"><input type="checkbox" name="showLaunch" ${site.showLaunch ? "checked" : ""} /><span><strong>Show the launch panel on the Overview</strong><span class="helper">It also hides itself once the launch time has passed.</span></span></label>
          ${field("Launch time", "launchAt", site.launchAt || "", { placeholder: "2026-11-06T20:00+02:00", help: "Date, time, and UTC offset. Athens is +02:00 in winter (from 25 October) and +03:00 in summer." })}
          ${field("Time zone name", "launchLabel", site.launchLabel || "", { placeholder: "Athens time", help: "Shown next to the time; visitors also see it in their own time zone." })}
          ${field("Heading", "launchTitle", site.launchTitle || "", { full: true })}
          ${textarea("Introduction", "launchSummary", site.launchSummary || "", { full: true, rows: 3 })}
        </div>
      </section>
      <section class="outpost-panel">
        <div class="outpost-panel-head"><div><h2>Timeline</h2><p class="outpost-section-caption">${done} of ${(site.roadmap || []).length} milestones done. The date is when a milestone happened, or the estimate until it is done. Milestones without a title are dropped on save.</p></div>
          <button type="button" class="button button-secondary" data-action="roadmap-add">+ Add step</button></div>
        <div class="roadmap-rows" id="roadmap-rows">${(site.roadmap || []).map(roadmapRow).join("")}</div>
      </section>
      <section class="outpost-panel">
        <h2>Community and sponsor</h2>
        <div class="outpost-fields">
          ${field("Discord invite", "discordUrl", site.discordUrl || "", { full: true, placeholder: "https://discord.gg/…", help: "Shown as “Join our Discord” on the Overview and in every footer. Leave empty to hide it." })}
          ${field("Community credit", "communityLabel", community.label || "", { placeholder: "A campaign of" })}
          ${field("Community name", "communityName", community.name || "", { help: "Links to the Discord invite above. Leave empty to hide it." })}
          ${field("Community logo", "communityLogo", community.logo || "", { full: true, placeholder: "assets/images/game-of-adventuring.png", help: "A file in public-site/assets/images/, or a full https:// address. Shown small in the footer." })}
          ${field("Sponsor name", "sponsorName", sponsor.name || "")}
          ${field("Sponsor link", "sponsorUrl", sponsor.url || "", { placeholder: "https://…" })}
          ${imageField("Sponsor logo", "sponsorLogo", sponsor.logo)}
        </div>
      </section>
      <div class="outpost-save-note">Saved in the local manager. Sync data or Export to site to publish.</div>
    </form>`;
}

function readSite(form) {
  const formData = new FormData(form);
  return {
    showLaunch: form.elements.showLaunch.checked,
    launchAt: formText(formData, "launchAt"),
    launchLabel: formText(formData, "launchLabel"),
    launchTitle: formText(formData, "launchTitle"),
    launchSummary: formText(formData, "launchSummary"),
    roadmap: [...form.querySelectorAll("[data-roadmap-row]")].map((row) => ({
      title: row.querySelector('[data-step="title"]').value.trim(),
      detail: row.querySelector('[data-step="detail"]').value.trim(),
      status: row.querySelector('[data-step="status"]').value,
      date: row.querySelector('[data-step="date"]').value
    })),
    discordUrl: formText(formData, "discordUrl"),
    community: { label: formText(formData, "communityLabel"), name: formText(formData, "communityName"), logo: formText(formData, "communityLogo") || null },
    sponsor: { name: formText(formData, "sponsorName"), url: formText(formData, "sponsorUrl"), logo: formText(formData, "sponsorLogo") || null }
  };
}

async function saveSite(form) {
  await api("/api/site", { method: "POST", body: JSON.stringify({ data: readSite(form) }) });
  await loadState();
  showNotice("Site settings saved in the local manager.");
}

/* ---------- Rendering ---------- */

const hiddenSampleLabel = (collection, id) => {
  const sample = state.hiddenSamples.find((item) => item.collection === collection && item.id === id);
  return sample ? `${sample.label} — hidden sample` : "";
};

function renderSampleSwitch() {
  const toggle = document.getElementById("include-samples");
  toggle.checked = state.settings.includeSamples;
  const count = state.settings.sampleCount;
  document.getElementById("sample-count").textContent = count
    ? `${count} sample record${count === 1 ? "" : "s"} ${state.settings.includeSamples ? "shown" : "hidden"}`
    : "No sample records yet";
}

async function setIncludeSamples(include) {
  await api("/api/settings", { method: "POST", body: JSON.stringify({ includeSamples: include }) });
  selectedId = null;
  draft = false;
  await loadState();
  showNotice(include
    ? "Sample content is shown. Sync data or Export to include published samples on the site."
    : "Sample content is hidden. Sync data or Export to remove it from the site.");
}

async function loadState() {
  const loaded = await api("/api/state");
  for (const key of Object.keys(collections)) state[key] = loaded[key] || [];
  state.outpost = loaded.outpost || {};
  state.site = loaded.site || {};
  state.settings = loaded.settings || { includeSamples: false, sampleCount: 0 };
  state.hiddenSamples = loaded.hiddenSamples || [];
  renderSampleSwitch();
  document.getElementById("database-indicator").textContent = "SQLite database connected";
  updateNavigation();
  renderContent();
}

function updateNavigation() {
  for (const key of Object.keys(collections)) {
    const counter = document.getElementById(`${key}-count`);
    if (counter) counter.textContent = state[key].length;
  }
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeView);
    button.setAttribute("aria-current", button.dataset.view === activeView ? "page" : "false");
  });
  document.getElementById("page-title").textContent = activeView === "outpost" ? "Outpost Sheet" : activeView === "site" ? "Site & launch" : collections[activeView].title;
  document.getElementById("search-wrap").hidden = activeView === "outpost" || activeView === "site";
  document.getElementById("collection-search").value = filterText;
}

function filteredRecords(key) {
  const config = collections[key];
  const query = filterText.trim().toLowerCase();
  const filters = listFilters[key] || {};
  return state[key]
    .filter((record) => Object.entries(filters).every(([field, value]) => !value || record[field] === value))
    .filter((record) => !query || JSON.stringify(record).toLowerCase().includes(query))
    .sort((left, right) => config.sortKey
      ? config.sortKey(left).localeCompare(config.sortKey(right))
      : String(config.name(left) || "").localeCompare(String(config.name(right) || "")));
}

function renderContent() {
  if (activeView === "outpost") renderOutpostEditor();
  else if (activeView === "site") renderSiteEditor();
  else renderCollection(activeView);
  if (preview.open) schedulePreview(0);
}

/* ---------- Site preview: the real public pages, fed by the database and the unsaved form ---------- */

const preview = { open: false, timer: null, size: "desktop", page: "", counter: 0, latest: 0 };

// Which public page shows a record of each kind.
const PREVIEW_PAGES = {
  outpost: () => "outpost.html",
  facilities: (id) => `outpost.html#facility-${encodeURIComponent(id)}`,
  projects: (id, data) => data?.outpost || !data?.characterIds?.length
    ? `outpost.html#project-${encodeURIComponent(id)}`
    : `characters.html#${encodeURIComponent(data.characterIds[0])}#projects`,
  site: () => "index.html",
  characters: (id, data) => `characters.html#${encodeURIComponent(id)}${data?.sheet ? "#sheet" : ""}`,
  jobs: (id) => `jobs.html#${encodeURIComponent(id)}`,
  archive: (id) => `archive.html#${encodeURIComponent(id)}`,
  gear: (id) => `marketplace.html#gear-${encodeURIComponent(id)}`,
  game: (id, data) => `game.html#${data?.type === "announcement" || data?.type === "rule" ? `post-${encodeURIComponent(id)}` : ""}`
};

function currentDraft() {
  if (activeView === "outpost") {
    const form = document.getElementById("outpost-form");
    return form ? { collection: "outpost", data: readOutpost(form) } : null;
  }
  if (activeView === "site") {
    const form = document.getElementById("site-form");
    return form ? { collection: "site", data: readSite(form) } : null;
  }
  const form = document.getElementById("record-form");
  if (!form) return null;
  const config = collections[activeView];
  const formData = new FormData(form);
  const data = { ...config.read(formData, form), published: form.elements.published.checked };
  if (form.elements.sample) data.sample = form.elements.sample.checked;
  return { collection: activeView, id: form.dataset.editingId || formText(formData, "recordId"), data };
}

function schedulePreview(delay = 600) {
  clearTimeout(preview.timer);
  preview.timer = setTimeout(() => refreshPreview().catch((error) => setPreviewStatus(error.message === "Not found."
    // The page loads fresh scripts on refresh, but the Python server only loads new code when restarted.
    ? "The running content manager is older than this page and has no preview yet. Restart it (stop and start the Content manager task), then refresh this tab."
    : error.message, true)), delay);
}

function setPreviewStatus(text, isError = false) {
  const status = document.getElementById("preview-status");
  status.textContent = text;
  status.classList.toggle("is-error", isError);
}

async function refreshPreview() {
  // Refreshes can overlap when records change quickly; only the newest one may update the frame.
  const ticket = ++preview.latest;
  const frame = document.getElementById("preview-frame");
  let draft;
  try {
    draft = currentDraft();
  } catch (error) {
    setPreviewStatus(`Not valid yet: ${error.message} The preview shows the saved version.`, true);
    return;
  }
  if (!draft) {
    await api("/api/preview", { method: "POST", body: JSON.stringify({ data: null }) });
    preview.page = "";
    document.querySelectorAll(".preview-frame-wrap iframe").forEach((item) => item.removeAttribute("src"));
    document.getElementById("preview-title").textContent = "Nothing to preview";
    setPreviewStatus("Choose or create a record to see it on the site.");
    return;
  }
  const result = await api("/api/preview", { method: "POST", body: JSON.stringify(draft) });
  if (ticket !== preview.latest) return;
  const page = PREVIEW_PAGES[draft.collection](result.id, draft.data);
  document.getElementById("preview-title").textContent = draft.collection === "outpost" ? "Outpost Sheet" : draft.collection === "site" ? "Overview · Site & launch"
    : collections[draft.collection].name(draft.data) || `New ${collections[draft.collection].singular.toLowerCase()}`;
  setPreviewStatus(result.error
    ? `Not valid yet: ${result.error} The preview shows the saved version.`
    : "Shows unsaved changes and unpublished records. Nothing reaches the public site until you save and sync.", Boolean(result.error));
  // Keep the reader's place when the same page is shown again after an edit.
  let scroll = 0;
  try { scroll = page === preview.page ? frame.contentWindow.scrollY : 0; } catch { scroll = 0; }
  preview.page = page;
  document.getElementById("preview-open").href = `/preview/${page}`;
  const hashAt = page.indexOf("#");
  const [file, hash] = hashAt < 0 ? [page, ""] : [page.slice(0, hashAt), page.slice(hashAt)];
  preview.counter += 1;
  // A changing query string forces a full load, so the page fetches the new draft data.
  await showInPreview(`/preview/${file}?v=${preview.counter}${hash}`, scroll, ticket);
}

// Double buffering: the new version loads in the hidden frame, renders, and gets its scroll position back;
// only then does it swap to the front. The visible preview never blanks or jumps while it updates.
function showInPreview(url, scroll, ticket) {
  const front = document.querySelector(".preview-frame-wrap iframe.is-front");
  const back = [...document.querySelectorAll(".preview-frame-wrap iframe")].find((item) => item !== front);
  return new Promise((resolve) => {
    back.onload = () => {
      back.onload = null;
      const started = Date.now();
      const settle = () => {
        if (ticket !== preview.latest) return resolve();
        let rendered = false;
        try { rendered = back.contentDocument.documentElement.dataset.rendered === "true"; } catch { /* navigated away */ }
        // site.js marks the page once it has fetched its data and rendered (including its own scrolling).
        if (!rendered && Date.now() - started < 5000) return setTimeout(settle, 50);
        // instant: the site uses smooth scrolling, which would still be gliding after the swap.
        try { back.contentWindow.scrollTo({ top: scroll, behavior: "instant" }); } catch { /* navigated away */ }
        back.classList.add("is-front");
        back.removeAttribute("aria-hidden");
        back.removeAttribute("tabindex");
        back.title = "Site preview";
        front.classList.remove("is-front");
        front.setAttribute("aria-hidden", "true");
        front.setAttribute("tabindex", "-1");
        front.title = "Site preview (loading)";
        back.id = "preview-frame";
        front.id = "preview-frame-back";
        resolve();
      };
      settle();
    };
    back.src = url;
  });
}

function setPreviewOpen(open) {
  preview.open = open;
  document.getElementById("preview-panel").hidden = !open;
  document.querySelector(".app-shell").classList.toggle("with-preview", open);
  if (open) schedulePreview(0);
  else {
    clearTimeout(preview.timer);
    api("/api/preview", { method: "POST", body: JSON.stringify({ data: null }) }).catch(() => {});
  }
}

function setPreviewSize(size) {
  preview.size = size;
  document.querySelector(".preview-frame-wrap").classList.toggle("is-phone", size === "phone");
  document.querySelectorAll("[data-preview-size]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.previewSize === size)));
}

function renderCollection(key) {
  const config = collections[key];
  const items = filteredRecords(key);
  const selected = draft ? null : items.find((record) => record.id === selectedId) || items[0] || null;
  if (!draft) selectedId = selected?.id || null;
  const listMarkup = items.length ? items.map((record) => `
    <button type="button" class="record-button ${selected?.id === record.id ? "active" : ""}" data-record-id="${escapeHtml(record.id)}">
      <span class="record-name">${escapeHtml(config.name(record) || "Untitled")}</span>
      <span class="record-meta">${config.meta(record).filter(Boolean).map((part, index, parts) => `<span class="${index === parts.length - 1 ? "record-status" : ""}">${escapeHtml(part)}</span>`).join("")}${record.published ? "" : '<span class="record-draft">Unpublished</span>'}${record.sample ? '<span class="record-sample">Sample</span>' : ""}</span>
    </button>
  `).join("") : '<div class="empty-list">No matching records yet.</div>';
  const editor = draft ? recordForm(key, null) : selected ? recordForm(key, selected) : `
    <div class="editor-content"><div class="empty-list">Choose a record to edit, or create a new ${config.singular.toLowerCase()}.</div></div>`;

  document.getElementById("work-area").innerHTML = `
    <div class="collection-layout">
      <section class="record-list-panel" aria-label="${config.title} list">
        <div class="panel-head"><h2>${config.panel}</h2><button class="button button-secondary" type="button" data-action="new-record">+ New</button></div>
        ${key === "characters" ? '<div class="panel-tools"><button class="button button-secondary" type="button" data-action="batch-import" title="Review and import a folder of player sheet files">Batch import sheet files…</button></div>' : ""}
        ${listFilterBar(key)}
        <div class="record-list">${listMarkup}</div>
      </section>
      <section class="editor-panel" aria-label="${config.singular} editor">${editor}</section>
    </div>`;
}

function listFilterBar(key) {
  const config = collections[key];
  if (!config.filters) return "";
  const current = listFilters[key] || {};
  return `<div class="list-filters">${config.filters.map(([fieldName, allLabel, choices]) => `
    <select data-list-filter="${fieldName}" aria-label="Filter by ${fieldName}">
      <option value="">${allLabel}</option>
      ${choices.map(([value, text]) => `<option value="${escapeHtml(value)}" ${current[fieldName] === value ? "selected" : ""}>${escapeHtml(text)} (${state[key].filter((record) => record[fieldName] === value).length})</option>`).join("")}
    </select>`).join("")}</div>`;
}

function recordForm(key, record) {
  const config = collections[key];
  const singular = config.singular.toLowerCase();
  const published = record ? record.published : false;
  return `
    <form id="record-form" data-collection="${key}" data-editing-id="${escapeHtml(record?.id || "")}">
      <div class="editor-content">
        <div class="editor-title">
          <div><h2>${record ? escapeHtml(config.name(record) || `Edit ${singular}`) : `New ${singular}`}</h2><p>${record ? `ID: ${escapeHtml(record.id)}` : "Create a new record"}</p></div>
          <div class="editor-actions">
            ${record ? '<button type="button" class="button button-danger" data-action="delete-record">Delete</button>' : ""}
            <button type="button" class="button button-secondary" data-action="open-preview" title="See this record on the site, including unsaved changes">Preview</button>
            <button type="submit" class="button button-primary">Save ${singular}</button>
          </div>
        </div>
        <div class="form-grid">
          <label class="publish-toggle field full"><input type="checkbox" name="published" ${published ? "checked" : ""} /><span><strong>Published</strong><span class="helper">When unchecked, Sync data and Export to site leave this record out of the public site.</span></span></label>
          ${state.settings.includeSamples ? `<label class="publish-toggle field full sample-flag"><input type="checkbox" name="sample" ${record?.sample ? "checked" : ""} /><span><strong>Sample content</strong><span class="helper">Preview data, not campaign canon. While <em>Show sample content</em> is off, it is hidden here and left out of Sync data and Export.</span></span></label>` : ""}
          ${record ? "" : field("ID / URL slug", "recordId", "", { full: true, help: `Optional. ${config.idHelp} It cannot be changed later.` })}
          ${config.fields(record || {})}
          ${record && config.related ? config.related(record) : ""}
        </div>
        <div class="editor-footer"><span class="helper">Saving updates the local SQLite database. Sync data or Export to site to publish.</span><button type="submit" class="button button-primary">Save ${singular}</button></div>
      </div>
    </form>`;
}

/* ---------- Outpost Sheet ---------- */

const outpostArraySchemas = [
  {
    key: "capabilities", title: "Capabilities", singular: "Capability",
    help: "Outpost ratings and how Expeditioners can use them. Contributing assets are facilities (from the Facilities section) and characters.",
    defaultItem: { name: "", rating: "+0", summary: "", detail: "", use: "", assets: [], conditions: "" },
    fields: [
      ["name", "Name", "text"], ["rating", "Rating", "text"],
      ["summary", "Current meaning", "textarea", true], ["detail", "What it represents", "textarea", true],
      ["use", "How players use it", "textarea", true], ["assets", "Contributing assets", "assets", true],
      ["conditions", "Relevant conditions", "textarea", true]
    ]
  },
  {
    key: "consequences", title: "Consequences", singular: "Consequence",
    help: "Active Outpost consequences and their severity.",
    defaultItem: { name: "", severity: "Low", detail: "" },
    fields: [["name", "Name", "text"], ["severity", "Severity", "select"], ["detail", "Details", "textarea", true]]
  }
];

function outpostNestedField(schema, index, [path, label, type, full = false], item) {
  const id = `outpost-${schema.key}-${index}-${path.replace(/[^a-z0-9]+/gi, "-")}`;
  const value = path.split(".").reduce((current, key) => current?.[key], item) ?? "";
  const className = full ? "nested-field full" : "nested-field";
  const required = path === "name" ? "required" : "";
  if (type === "textarea") {
    return `<div class="${className}"><label for="${id}">${label}</label><textarea id="${id}" data-outpost-path="${path}" ${required}>${escapeHtml(value)}</textarea></div>`;
  }
  if (type === "assets") {
    return `<div class="${className}"><label for="${id}">${label}</label>${assetPicker(id, value)}</div>`;
  }
  if (type === "select") {
    const levels = ["Low", "Moderate", "High", "Critical"];
    return `<div class="${className}"><label for="${id}">${label}</label><select id="${id}" data-outpost-path="${path}">${levels.map((level) => `<option value="${level}" ${value === level ? "selected" : ""}>${level}</option>`).join("")}</select></div>`;
  }
  const numberAttributes = type === "number" ? `min="${path === "progress.max" ? "1" : "0"}" step="1"` : "";
  return `<div class="${className}"><label for="${id}">${label}</label><input id="${id}" type="${type}" data-outpost-path="${path}" value="${escapeHtml(value)}" ${numberAttributes} ${required} /></div>`;
}

function renderOutpostArrayEditor(schema, items, startIndex = 0) {
  const cards = items.map((item, index) => {
    const recordIndex = startIndex + index;
    const recordKey = `${recordIndex}-${Math.random().toString(36).slice(2)}`;
    return `
    <article class="nested-record" data-original="${escapeHtml(JSON.stringify(item))}">
      <header class="nested-record-head">
        <span>${schema.singular} ${recordIndex + 1}</span>
        <button class="remove-record" type="button" data-action="remove-outpost-record" aria-label="Remove ${schema.singular.toLowerCase()} ${recordIndex + 1}" title="Remove ${schema.singular.toLowerCase()}">×</button>
      </header>
      <div class="nested-record-grid">${schema.fields.map((fieldDefinition) => outpostNestedField(schema, recordKey, fieldDefinition, item)).join("")}</div>
    </article>
  `;
  }).join("");

  return `
    <section class="outpost-panel">
      <div class="outpost-panel-head"><div><h2>${schema.title}</h2><p class="outpost-section-caption">${schema.help}</p></div>
        <button class="button button-secondary" type="button" data-action="add-outpost-record" data-array-key="${schema.key}">+ Add ${schema.singular.toLowerCase()}</button>
      </div>
      <div class="nested-record-list" data-array-key="${schema.key}">${cards || `<p class="nested-empty">No ${schema.title.toLowerCase()} recorded.</p>`}</div>
    </section>`;
}

function readNestedRecords(form, schema) {
  return [...form.querySelectorAll(`.nested-record-list[data-array-key="${schema.key}"] .nested-record`)].map((record) => {
    const item = JSON.parse(record.dataset.original || "{}");
    for (const control of record.querySelectorAll("[data-outpost-path]")) {
      const path = control.dataset.outpostPath;
      if (path === "assets") {
        item.assets = readAssets(control);
        continue;
      }
      const value = control.type === "number" ? Number(control.value) : control.value.trim();
      const parts = path.split(".");
      const property = parts.pop();
      const target = parts.reduce((current, key) => {
        if (!current[key] || typeof current[key] !== "object") current[key] = {};
        return current[key];
      }, item);
      target[property] = value;
    }
    return item;
  });
}

function renderOutpostEditor() {
  const outpost = state.outpost || {};
  const stress = outpost.stress || {};
  const tabs = [
    ["profile", "Profile"],
    ["stress", "Stress"],
    ...outpostArraySchemas.map((schema) => [schema.key, schema.title])
  ];
  if (!tabs.some(([key]) => key === activeOutpostTab)) activeOutpostTab = "profile";
  const renderTabPanel = (key, content) => `
    <div id="outpost-panel-${key}" class="outpost-tab-panel" data-outpost-panel role="tabpanel" tabindex="0" aria-labelledby="outpost-tab-${key}" ${activeOutpostTab === key ? "" : "hidden"}>${content}</div>`;

  document.getElementById("work-area").innerHTML = `
    <form id="outpost-form" class="outpost-layout">
      <header class="outpost-editor-head">
        <div><h2>Outpost Sheet</h2><p>Manage profile, stress, capabilities, and consequences. Facilities and projects have their own sections.</p></div>
        <div class="editor-actions"><button type="button" class="button button-secondary" data-action="open-preview">Preview</button><button type="submit" class="button button-primary">Save Outpost Sheet</button></div>
      </header>
      <div class="outpost-tabs" role="tablist" aria-label="Outpost Sheet sections">
        ${tabs.map(([key, label]) => `<button id="outpost-tab-${key}" class="outpost-tab" type="button" role="tab" data-outpost-tab="${key}" aria-controls="outpost-panel-${key}" aria-selected="${activeOutpostTab === key}" tabindex="${activeOutpostTab === key ? "0" : "-1"}">${label}</button>`).join("")}
      </div>
      ${renderTabPanel("profile", `
        <section class="outpost-panel">
          <h2>Outpost profile</h2>
          <div class="outpost-fields">
            ${field("Name", "name", outpost.name || "The Outpost", { required: true })}
            ${field("High Concept", "highConcept", outpost.highConcept || "", { required: true })}
            ${textarea("Trouble", "trouble", outpost.trouble || "", { full: true })}
            ${textarea("Aspects", "aspects", listText(outpost.aspects), { full: true, help: "One aspect per line." })}
          </div>
        </section>
      `)}
      ${renderTabPanel("stress", `
        <section class="outpost-panel">
          <h2>Stress track</h2>
          <p class="outpost-section-caption">Set the current marked boxes and the Outpost’s total stress capacity.</p>
          <div class="stress-fields">
            ${field("Marked stress", "stressCurrent", stress.current ?? 0, { type: "number", min: 0, required: true })}
            ${field("Maximum boxes", "stressMax", stress.max ?? 6, { type: "number", min: 1, required: true })}
          </div>
        </section>
      `)}
      ${outpostArraySchemas.map((schema) => renderTabPanel(schema.key, renderOutpostArrayEditor(schema, outpost[schema.key] || []))).join("")}
      <div class="outpost-save-note">These structured fields are saved in the public Outpost Sheet format. Export separately to update the static site.</div>
    </form>`;
}

/* ---------- Saving ---------- */

async function saveRecord(form) {
  const key = form.dataset.collection;
  const config = collections[key];
  const formData = new FormData(form);
  const existing = findRecord(key, form.dataset.editingId);
  const data = { ...config.read(formData, form), published: form.elements.published.checked };
  // The flag is only sent while samples are shown; otherwise the server keeps whatever the record had.
  if (form.elements.sample) data.sample = form.elements.sample.checked;
  if (!existing && formText(formData, "recordId")) data.id = formText(formData, "recordId");
  const result = existing
    ? await api(`/api/${key}/${encodeURIComponent(existing.id)}`, { method: "PUT", body: JSON.stringify({ data }) })
    : await api(`/api/${key}`, { method: "POST", body: JSON.stringify({ data }) });
  selectedId = result.id;
  draft = false;
  await loadState();
  showNotice(`${config.name(data) || config.singular} saved in the local manager${data.published ? "" : " (unpublished)"}.`);
}

function readOutpost(form) {
  const formData = new FormData(form);
  const outpost = {
    ...state.outpost,
    name: String(formData.get("name") || "").trim(),
    highConcept: String(formData.get("highConcept") || "").trim(),
    trouble: String(formData.get("trouble") || "").trim(),
    aspects: linesToArray(String(formData.get("aspects") || "")),
    stress: {
      ...(state.outpost.stress || {}),
      current: Number(formData.get("stressCurrent")),
      max: Number(formData.get("stressMax"))
    }
  };
  for (const schema of outpostArraySchemas) {
    outpost[schema.key] = readNestedRecords(form, schema);
  }
  if (outpost.stress.current < 0 || outpost.stress.max < 1 || outpost.stress.current > outpost.stress.max) {
    throw new Error("Stress must be between zero and the maximum box count.");
  }
  return outpost;
}

async function saveOutpost(form) {
  const outpost = readOutpost(form);
  await api("/api/outpost", { method: "POST", body: JSON.stringify({ data: outpost }) });
  await loadState();
  showNotice("Outpost Sheet saved in the local manager.");
}

async function deleteSelected() {
  const config = collections[activeView];
  const record = findRecord(activeView, selectedId);
  if (!record || !confirm(`Delete ${config.singular.toLowerCase()} “${config.name(record) || record.id}”? It will be removed from the next site Sync or Export.`)) return;
  await api(`/api/${activeView}/${encodeURIComponent(record.id)}`, { method: "DELETE" });
  selectedId = null;
  draft = false;
  await loadState();
  showNotice("Record deleted from the local manager. Sync or Export to apply the change to the site.");
}

async function uploadImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
  const result = await api("/api/media", { method: "POST", body: JSON.stringify({ filename: file.name, dataUrl, kind: input.dataset.imageUpload }) });
  document.querySelector("[data-image-field]").value = result.path;
  document.getElementById("image-preview").innerHTML = imagePreview(result.path);
  showNotice("Image uploaded. Save the record to keep it.");
}

const publishSummary = (result) => `${result.characters} characters, ${result.jobs} jobs, ${result.archive} Archive entries, ${result.gear} Gear, ${result.game} Game posts${result.unpublished ? `; ${result.unpublished} unpublished records left out` : ""}${result.samplesHidden ? `; ${result.samplesHidden} hidden sample records left out` : ""}`;

async function exportToSite() {
  const result = await api("/api/export", { method: "POST", body: "{}" });
  showNotice(`Complete site folder generated at ${result.destination} (${result.siteFiles} files): ${publishSummary(result)}.`);
}

async function syncDataToSite() {
  if (!confirm("Replace the entire public-site/data folder with the current SQLite data? Any files in data/ not managed here will be removed. All other public-site files stay unchanged.")) return;
  const result = await api("/api/sync", { method: "POST", body: "{}" });
  showNotice(`Synced ${publishSummary(result)} (${result.files} files) to ${result.destination}.`);
}

async function importFromSite() {
  if (!confirm("Import all content from public-site/data? This replaces the manager’s SQLite records, including unpublished records and changes not yet exported.")) return;
  await api("/api/import", { method: "POST", body: "{}" });
  selectedId = null;
  draft = false;
  await loadState();
  showNotice("Manager database replaced with the current public-site data.");
}

/* ---------- Events ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadState();
  } catch (error) {
    document.getElementById("database-indicator").textContent = "Database unavailable";
    showNotice(error.message, true);
  }

  const openView = (view, id = null) => {
    activeView = view;
    selectedId = id;
    draft = false;
    filterText = "";
    stashView = { tab: "stash", query: "", category: "" };
    updateNavigation();
    renderContent();
  };

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));

  document.getElementById("collection-search").addEventListener("input", (event) => {
    filterText = event.target.value;
    selectedId = null;
    draft = false;
    renderContent();
  });

  const workArea = document.getElementById("work-area");

  workArea.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");
    const action = actionButton?.dataset.action;
    const outpostTab = event.target.closest("[data-outpost-tab]");
    if (outpostTab) {
      activeOutpostTab = outpostTab.dataset.outpostTab;
      document.querySelectorAll("[data-outpost-tab]").forEach((button) => {
        const selected = button === outpostTab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      document.querySelectorAll("[data-outpost-panel]").forEach((panel) => {
        panel.hidden = panel.id !== `outpost-panel-${activeOutpostTab}`;
      });
      return;
    }
    if (action === "add-outpost-record") {
      const schema = outpostArraySchemas.find((item) => item.key === actionButton.dataset.arrayKey);
      const list = actionButton.closest(".outpost-panel").querySelector(".nested-record-list");
      if (schema && list) {
        list.querySelector(".nested-empty")?.remove();
        const markup = renderOutpostArrayEditor(schema, [schema.defaultItem], list.querySelectorAll(".nested-record").length);
        const temporary = document.createElement("div");
        temporary.innerHTML = markup;
        list.append(temporary.querySelector(".nested-record"));
      }
      return;
    }
    if (action === "remove-asset") {
      const picker = actionButton.closest(".asset-picker");
      actionButton.closest(".asset-chip").remove();
      refreshAssetPicker(picker);
      if (preview.open) schedulePreview();
      return;
    }
    if (action === "remove-outpost-record") {
      const panel = actionButton.closest(".outpost-panel");
      actionButton.closest(".nested-record")?.remove();
      if (!panel.querySelector(".nested-record")) {
        const list = panel.querySelector(".nested-record-list");
        list.innerHTML = `<p class="nested-empty">No ${panel.querySelector("h2").textContent.toLowerCase()} recorded.</p>`;
      }
      return;
    }
    const stashTab = event.target.closest("[data-stash-tab]");
    if (stashTab) {
      stashView.tab = stashTab.dataset.stashTab;
      rerenderStash(readStash());
      return;
    }
    if (action === "add-stash-item") {
      const stash = readStash();
      const existing = stash.find((item) => item.gearId === actionButton.dataset.gearId);
      if (existing) existing.quantity = Math.min(999, existing.quantity + 1);
      else stash.push({ gearId: actionButton.dataset.gearId, quantity: 1, broughtIntoAction: false });
      rerenderStash(stash);
      const gear = findRecord("gear", actionButton.dataset.gearId);
      showNotice(`${gearLabel(gear)} ${existing ? `quantity is now ${existing.quantity}` : "added to the stash"}. Save the character to keep it.`);
      return;
    }
    if (action === "remove-stash-item") {
      const row = actionButton.closest("[data-stash-row]");
      const gear = findRecord("gear", row.dataset.gearId);
      if (confirm(`Remove ${gearLabel(gear) || row.dataset.gearId} from this character's stash? The Gear itself stays in the Marketplace.`)) {
        rerenderStash(readStash().filter((item) => item.gearId !== row.dataset.gearId));
      }
      return;
    }
    if (action === "add-sheet") {
      document.getElementById("sheet-editor").innerHTML = sheetEditor(defaultSheet());
      return;
    }
    if (action === "remove-sheet") {
      if (confirm("Remove this character sheet? The change is kept only when you save the character.")) {
        document.getElementById("sheet-editor").innerHTML = sheetEditor(null);
      }
      return;
    }
    if (action === "undo-sheet-import") {
      document.getElementById("sheet-editor").innerHTML = sheetEditor(sheetBeforeImport);
      if (stashBeforeImport) rerenderStash(stashBeforeImport);
      const form = document.getElementById("record-form");
      Object.entries(fieldsBeforeImport || {}).forEach(([name, value]) => { form.querySelector(`[name="${name}"]`).value = value; });
      const note = document.getElementById("sheet-import-note");
      note.hidden = true;
      note.innerHTML = "";
      showNotice("Import undone. The character is back to how it was before the import.");
      return;
    }
    if (action === "add-sheet-row") {
      const kind = actionButton.dataset.rowKind;
      actionButton.parentElement.querySelector(`[data-rows="${kind}"]`).insertAdjacentHTML("beforeend", sheetRow(kind, sheetRows[kind].empty));
      return;
    }
    if (action === "remove-sheet-row") {
      actionButton.closest(".sheet-row").remove();
      return;
    }
    const jump = event.target.closest("[data-jump-view]");
    if (jump) {
      if (jump.dataset.jumpView === "outpost") activeOutpostTab = "capabilities";
      openView(jump.dataset.jumpView, jump.dataset.jumpId);
      return;
    }
    const navRecord = event.target.closest("[data-record-id]");
    if (navRecord) {
      selectedId = navRecord.dataset.recordId;
      draft = false;
      renderContent();
      return;
    }
    if (action === "new-record") {
      selectedId = null;
      draft = true;
      renderContent();
    } else if (action === "add-prerequisite" || action === "add-complication") {
      const list = document.getElementById(action === "add-prerequisite" ? "prerequisite-rows" : "complication-rows");
      list.insertAdjacentHTML("beforeend", action === "add-prerequisite" ? prerequisiteRow() : complicationRow());
      list.lastElementChild.querySelector('input[type="text"], textarea')?.focus();
      if (preview.open) schedulePreview();
    } else if (action === "remove-project-row") {
      actionButton.closest("[data-prerequisite-row], [data-complication-row]").remove();
      if (preview.open) schedulePreview();
    } else if (action === "roadmap-add") {
      document.getElementById("roadmap-rows").insertAdjacentHTML("beforeend", roadmapRow());
      document.querySelector("#roadmap-rows [data-roadmap-row]:last-child input")?.focus();
      if (preview.open) schedulePreview();
    } else if (action === "roadmap-remove" || action === "roadmap-up" || action === "roadmap-down") {
      const row = actionButton.closest("[data-roadmap-row]");
      if (action === "roadmap-remove") row.remove();
      else if (action === "roadmap-up" && row.previousElementSibling) row.previousElementSibling.before(row);
      else if (action === "roadmap-down" && row.nextElementSibling) row.nextElementSibling.after(row);
      if (preview.open) schedulePreview();
    } else if (action === "batch-import") {
      openBatch();
    } else if (action === "open-preview") {
      setPreviewOpen(true);
    } else if (action === "delete-record") {
      try { await deleteSelected(); } catch (error) { showNotice(error.message, true); }
    } else if (action === "clear-image") {
      document.querySelector("[data-image-field]").value = "";
      document.getElementById("image-preview").innerHTML = imagePreview("");
    }
  });

  workArea.addEventListener("input", (event) => {
    const filter = event.target.closest(".reference-filter");
    if (filter) {
      const query = filter.value.trim().toLowerCase();
      document.querySelectorAll(`#${filter.dataset.filterList} .check-option`).forEach((option) => {
        option.hidden = Boolean(query) && !option.dataset.search.includes(query);
      });
    }
    if (event.target.matches("[data-stress-count]")) {
      const row = event.target.closest(".sheet-row");
      const marked = [...row.querySelectorAll(".stress-box-check")].map((box) => box.checked);
      const count = Math.max(0, Math.min(10, Number(event.target.value) || 0));
      row.querySelector(".stress-boxes").innerHTML = stressBoxes(Array.from({ length: count }, (_, index) => marked[index] || false));
    }
    if (event.target.matches("[data-image-field]")) {
      document.getElementById("image-preview").innerHTML = imagePreview(event.target.value.trim());
    }
    if (event.target.matches("[data-stash-query]")) {
      stashView.query = event.target.value;
      rerenderStash(readStash());
    }
  });

  workArea.addEventListener("change", async (event) => {
    if (event.target.classList.contains("participant-check")) {
      const count = workArea.querySelectorAll(".participant-check:checked").length;
      workArea.querySelector(".participant-count").textContent = `(${count} selected)`;
    }
    if (event.target.matches("[data-sheet-import]")) {
      try { await importSheetFile(event.target); } catch (error) { showNotice(error.message, true); }
      event.target.value = "";
    }
    if (event.target.matches("[data-image-upload]")) {
      try { await uploadImage(event.target); } catch (error) { showNotice(error.message, true); }
      event.target.value = "";
    }
    if (event.target.matches("[data-stash-category]")) {
      stashView.category = event.target.value;
      rerenderStash(readStash());
    }
    if (event.target.matches("[data-list-filter]")) {
      listFilters[activeView] = { ...(listFilters[activeView] || {}), [event.target.dataset.listFilter]: event.target.value };
      selectedId = null;
      draft = false;
      renderContent();
      return;
    }
    const form = event.target.closest("#record-form");
    if (form && event.target.name === "type" && form.querySelector("[data-type-section]")) {
      form.querySelectorAll("[data-type-section]").forEach((section) => {
        section.hidden = section.dataset.typeSection !== event.target.value;
      });
    }
  });

  workArea.addEventListener("keydown", (event) => {
    const currentTab = event.target.closest("[data-outpost-tab]");
    if (!currentTab) return;
    const tabButtons = [...document.querySelectorAll("[data-outpost-tab]")];
    const currentIndex = tabButtons.indexOf(currentTab);
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabButtons.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    tabButtons[nextIndex].focus();
    tabButtons[nextIndex].click();
  });

  workArea.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (event.target.matches("#record-form")) await saveRecord(event.target);
      else if (event.target.matches("#outpost-form")) await saveOutpost(event.target);
      else if (event.target.matches("#site-form")) await saveSite(event.target);
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  document.getElementById("export-button").addEventListener("click", async () => {
    try { await exportToSite(); } catch (error) { showNotice(error.message, true); }
  });
  document.getElementById("sync-button").addEventListener("click", async () => {
    try { await syncDataToSite(); } catch (error) { showNotice(error.message, true); }
  });
  document.getElementById("preview-panel").addEventListener("click", (event) => {
    if (event.target.closest("[data-preview-close]")) setPreviewOpen(false);
    else if (event.target.closest("[data-preview-refresh]")) schedulePreview(0);
    else if (event.target.closest("[data-preview-size]")) setPreviewSize(event.target.closest("[data-preview-size]").dataset.previewSize);
  });
  workArea.addEventListener("input", () => { if (preview.open) schedulePreview(); });
  workArea.addEventListener("change", (event) => {
    const resolved = event.target.closest('[data-complication="resolved"]');
    if (resolved) {
      const row = resolved.closest("[data-complication-row]");
      row.classList.toggle("is-active", !resolved.checked);
      row.querySelector(".complication-state").textContent = resolved.checked ? "Resolved" : "Active";
    }
    const select = event.target.closest(".asset-add");
    if (select?.value) {
      const [type, ...rest] = select.value.split(":");
      const picker = select.closest(".asset-picker");
      picker.querySelector(".asset-list").insertAdjacentHTML("beforeend", assetChip({ type, id: rest.join(":") }));
      refreshAssetPicker(picker);
    }
    if (preview.open) schedulePreview();
  });
  document.getElementById("include-samples").addEventListener("change", async (event) => {
    try { await setIncludeSamples(event.target.checked); } catch (error) { showNotice(error.message, true); event.target.checked = !event.target.checked; }
  });
  document.getElementById("import-button").addEventListener("click", async () => {
    try { await importFromSite(); } catch (error) { showNotice(error.message, true); }
  });
});
