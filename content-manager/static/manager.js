const state = { factions: [], gear: [], characters: [], archive: [], jobs: [], game: [], resources: [], forms: [], outpost: {}, site: {},
  settings: { includeSamples: false, sampleCount: 0 }, hiddenSamples: [],
  // The shared vocabulary (Functions, Domains...), sent by the server so it is defined in one place.
  vocabulary: { functionGroups: {}, functions: [], domains: [], resourceSources: [], resourceAvailability: [], formTiers: {}, formStatuses: [], projectResults: [], gateStatuses: [] } };
let activeView = "home";
let selectedId = null;
let draft = false;
// The learning paths being edited (in the Learning Paths view), or null.
let pathEditor = null;
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

// An image control. `kind` decides the published folder: portraits/ for characters, images/ otherwise.
// A form can hold several; each control finds its own preview.
function imageField(label, name, value, kind = "image", help = "") {
  const folder = kind === "portrait" ? "data/portraits/" : "data/images/";
  return `<div class="field full" data-image-control><label for="field-${name}">${label}</label>
    <div class="portrait-editor">
      <div class="portrait-preview" data-image-preview>${imagePreview(value, `No ${label.toLowerCase()}`)}</div>
      <div class="portrait-controls">
        <input id="field-${name}" name="${name}" type="text" value="${escapeHtml(value || "")}" data-image-field placeholder="Upload an image, or enter a site path / URL" />
        <div class="portrait-actions">
          <label class="button button-secondary">Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-upload="${kind}" hidden /></label>
          <button type="button" class="button button-secondary" data-action="clear-image">Remove</button>
        </div>
        <span class="helper">${help ? `${help} ` : ""}Uploaded images are stored in SQLite and published to <code>${folder}</code> with the record.</span>
      </div>
    </div></div>`;
}

// Several images in order, read with formData.getAll(name).
const imageListItem = (name, path) => `<div class="image-list-item">
    <div class="portrait-preview">${imagePreview(path)}</div>
    <input type="hidden" name="${name}" value="${escapeHtml(path)}" />
    <div class="image-list-actions">
      <button type="button" class="button button-secondary" data-action="image-earlier" aria-label="Move earlier" title="Move earlier">←</button>
      <button type="button" class="button button-secondary" data-action="image-later" aria-label="Move later" title="Move later">→</button>
      <button type="button" class="button button-secondary" data-action="image-remove">Remove</button>
    </div>
  </div>`;

function imageListField(label, name, values, help = "") {
  return `<div class="field full" data-image-list="${name}"><span class="field-label">${label}</span>
    <div class="image-list">${(values || []).map((path) => imageListItem(name, path)).join("")}</div>
    <div class="portrait-actions"><label class="button button-secondary">Add images<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-upload="image" multiple hidden /></label></div>
    <span class="helper">${help ? `${help} ` : ""}Published to <code>data/images/</code> with the record, in this order.</span></div>`;
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
  fieldsBeforeImport = Object.fromEntries(["name", "playerName", "summary", "type", "coins", "carryLimit"].map((name) => [name, form.querySelector(`[name="${name}"]`).value]));
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

  [["coins", "Coins", 999999], ["carryLimit", "Carry limit", 99]].forEach(([name, label, max]) => {
    const value = envelope[name];
    if (!Number.isInteger(value) || value < 0 || value > max) return;
    const control = form.querySelector(`[name="${name}"]`);
    if (Number(control.value) !== value) {
      identityChanges.push(`${label}: ${control.value || 0} → ${value}`);
      control.value = value;
    }
  });

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

// Total weight of the Gear brought into action, against the character's carry limit (6 unless a stunt or situation changes it).
const DEFAULT_CARRY_LIMIT = 6;
const carryLimit = () => {
  const value = document.querySelector('#record-form [name="carryLimit"]')?.value;
  return value === undefined || value === "" ? DEFAULT_CARRY_LIMIT : Number(value);
};
const carriedWeight = (stash) => stash.filter((item) => item.broughtIntoAction)
  .reduce((total, item) => total + (Number(findRecord("gear", item.gearId)?.weight) || 0) * item.quantity, 0);
const carriedText = (stash, limit = carryLimit()) => {
  const carried = carriedWeight(stash);
  return `Carried into action: <strong>${carried} / ${limit}</strong>${carried > limit ? " · over the limit" : ""}`;
};
function updateCarried() {
  const line = document.querySelector("[data-carried]");
  const stash = readStash();
  if (!line || !stash) return;
  line.innerHTML = carriedText(stash);
  line.classList.toggle("is-over", carriedWeight(stash) > carryLimit());
}

// `limit` is passed when the form is being built (its carry limit field is not on the page yet).
function stashEditor(stash, limit = carryLimit()) {
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
      <p class="stash-carried${carriedWeight(stash) > limit ? " is-over" : ""}" data-carried>${carriedText(stash, limit)}</p>
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
      ${textarea("Expected outcome", "outcome", record.outcome || "", { full: true, rows: 4, help: "What changes in the world when it is completed. Markdown; link Archive entries with [[archive-id]]." })}
      <div class="form-section">Requirements &amp; result</div>
      ${functionPicker("requiredFunctions", record.requiredFunctions || [], "Required Functions", "Any Resource with these Functions meets the Requirement.")}
      ${recordChecklist("requiredResourceIds", record.requiredResourceIds || [], "resources", (resource) => resource.name, "Required Resources", "Specific Resources this Project needs, such as the one an Establish Supply Project is for.")}
      ${selectField("Required Domain", "requiredDomain", record.requiredDomain || "", state.vocabulary.domains.map((key) => [key, domainName(key)]), { emptyLabel: "— None —" })}
      ${gateSelect("Related Gate", "relatedGateId", record.relatedGateId, "Optional. The Gate this Project depends on, for example the source of a Resource.")}
      ${selectField("Result", "resultType", record.resultType || "", state.vocabulary.projectResults.map((value) => [value, humanize(value)]), { emptyLabel: "— Not set —", help: "What completing it produces. Link the result back with its own Project field (Gear, Facilities, Resources, Forms)." })}`;
    },
    related: (record) => {
      const facilities = state.facilities.filter((facility) => facility.projectId === record.id);
      const gear = state.gear.filter((item) => item.projectId === record.id);
      const resources = state.resources.filter((resource) => resource.projectId === record.id);
      const forms = state.forms.filter((form) => form.projectId === record.id);
      return `<div class="form-section">Derived references</div>
        ${relatedBlock("Brought into the game", [
          ...facilities.map((facility) => `${referenceLink("facilities", facility, facility.name)} <span class="helper">facility</span>`),
          ...gear.map((item) => `${referenceLink("gear", item, item.name)} <span class="helper">gear</span>`),
          ...resources.map((resource) => `${referenceLink("resources", resource, resource.name)} <span class="helper">resource</span>`),
          ...forms.map((form) => `${referenceLink("forms", form, form.name)} <span class="helper">spell form</span>`)
        ], "Nothing names this project as its source yet.")}
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
      })).filter((item) => item.text),
      requiredFunctions: formData.getAll("requiredFunctions"),
      requiredResourceIds: formData.getAll("requiredResourceIds"),
      requiredDomain: formText(formData, "requiredDomain"), relatedGateId: formText(formData, "relatedGateId") || null,
      resultType: formText(formData, "resultType")
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
      <div class="form-section">Between expeditions</div>
      ${field("Downtime", "downtime", record.downtime ?? 0, { type: "number", min: 0, help: "0 to 8. After each expedition: +2 for the crew, +3 for everyone else, up to 8. Shown on the character's page." })}
      ${field("Coins", "coins", record.coins ?? 0, { type: "number", min: 0, help: "After each expedition, raise to the Resources rating if lower, then add any reward." })}
      ${field("Carry limit", "carryLimit", record.carryLimit ?? 6, { type: "number", min: 0, help: "Most total weight brought into action. 6 by default; stunts may raise it and situations lower it." })}
      <div class="form-section">Fate Core character sheet</div>
      <div class="field full sheet-import-bar">
        <label class="button button-secondary">Import sheet file<input type="file" accept=".html,.htm,.json,text/html,application/json" data-sheet-import hidden /></label>
        <span class="helper">Load a sheet file a player saved from the public site. You can review the changes before saving.</span>
      </div>
      <div class="field full" id="sheet-import-note" hidden></div>
      <div class="field full" id="sheet-editor">${sheetEditor(record.sheet)}</div>
      <div class="form-section">Inventory</div>
      <div class="field full">${stashEditor(record.stash || [], record.carryLimit ?? DEFAULT_CARRY_LIMIT)}</div>`,
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
      sheet: readSheet(form), stash: readStash(form) || [], coins: formText(formData, "coins"),
      downtime: formText(formData, "downtime"), carryLimit: formText(formData, "carryLimit")
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
      const listType = listFilters.archive?.type;
      const type = record.type || (activePreset === "gates" ? "gate-record" : listType && !listType.startsWith("!") && listType !== "gate-record" ? listType : "history");
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
      ${recordChecklist("factionIds", record.factionIds || [], "factions", (faction) => faction.name, "Factions",
        "Optional. Who this entry is about; it is listed on those factions' pages. An entry can name several.")}
      ${section("gate-record", `
        <div class="form-section">Gate Record</div>
        ${field("Designation", "gateDesignation", details.designation || "", { placeholder: "G-17", help: "Required for Gate Records." })}
        ${selectField("Gate status", "gateStatus", details.gateStatus || "active", enumChoices(state.vocabulary.gateStatuses), { help: "Collapsed: Core recovered. Sealed: closed as an unacceptable threat. Emerging: newly opening." })}
        ${domainPicker("domains", details.domains || [], "Normally one Domain. Two only when that defines the place; its native Resources and creatures inherit it.")}
        ${field("Discovered", "discoveredAt", details.discoveredAt || "", { type: "date" })}
        ${textarea("Environment", "environment", details.environment || "", { full: true, help: "What the Outpost currently knows. Keep GM-only truths out of this record." })}
        ${textarea("Known traits", "knownTraits", listText(details.knownTraits), { help: "One per line." })}
        ${textarea("Known hazards", "knownHazards", listText(details.knownHazards), { help: "One per line." })}
        ${textarea("Known locations", "knownLocations", listText(details.knownLocations), { full: true, help: "One per line. Only locations the Expeditioners have found or heard of." })}
        ${textarea("Known creatures", "knownCreatures", listText(details.knownCreatures), { full: true, help: "One per line. They inherit the Gate's Domain." })}
        <div class="form-section cm-only">CM only · never published</div>
        ${textarea("CM notes", "gmNotes", details.gmNotes || "", { full: true, rows: 4, help: "The Gate Aspect, secrets, generator notes." })}`)}
      ${section("session-record", `
        <div class="form-section">Session Record</div>
        ${field("Session date", "sessionDate", details.sessionDate || "", { type: "date" })}
        ${selectField("Outcome", "outcome", details.outcome || "unknown", enumChoices(["success", "partial", "failed", "aborted", "unknown"]))}
        ${participantPicker(record.participantIds || [])}`)}`;
    },
    related: (record) => {
      const jobs = state.jobs.filter((job) => job.sessionRecordId === record.id);
      const resources = state.resources.filter((resource) => resource.gateId === record.id);
      const projects = state.projects.filter((project) => project.relatedGateId === record.id);
      const gateBlock = record.type === "gate-record" ? `
        ${relatedBlock("Resources from this Gate", resources.map((resource) => `${referenceLink("resources", resource, resource.name)} <span class="helper">${escapeHtml(resource.availability)}</span>`), "No Resources yet. Add them in Resources or generate them in CM Tools.")}
        ${relatedBlock("Related projects", projectRows(projects), "No project names this Gate.")}` : "";
      const linkedFrom = [...state.archive, ...state.jobs].filter((other) => other.id !== record.id
        && [other.content, other.summary, other.briefing, other.objective].join("\n").includes(`[[${record.id}`));
      return `<div class="form-section">Derived references</div>
        ${record.type === "session-record" ? relatedBlock("Session Record of", jobs.map((job) => referenceLink("jobs", job, jobLabel(job))), "No Job points at this record yet.") : ""}
        ${gateBlock}
        ${relatedBlock("Linked from", linkedFrom.map((other) => state.archive.includes(other) ? referenceLink("archive", other, archiveLabel(other)) : referenceLink("jobs", other, jobLabel(other))), "No other record links here.")}
        ${linkCheck([record.summary, record.content])}${legacyNote(record)}`;
    },
    read: (formData, form) => {
      const type = formText(formData, "type");
      const details = type === "gate-record" ? {
        designation: formText(formData, "gateDesignation"), gateStatus: formText(formData, "gateStatus"),
        discoveredAt: formText(formData, "discoveredAt"), environment: formText(formData, "environment"),
        knownTraits: linesToArray(formData.get("knownTraits")), knownHazards: linesToArray(formData.get("knownHazards")),
        knownLocations: linesToArray(formData.get("knownLocations")),
        domains: formData.getAll("domains"), knownCreatures: linesToArray(formData.get("knownCreatures")), gmNotes: formText(formData, "gmNotes")
      } : type === "session-record" ? { sessionDate: formText(formData, "sessionDate"), outcome: formText(formData, "outcome") } : {};
      return {
        type, title: formText(formData, "title"), subtitle: formText(formData, "subtitle"),
        summary: formText(formData, "summary"), content: formText(formData, "content"), author: formText(formData, "author"),
        publishedAt: formText(formData, "publishedAt"), eventDate: formText(formData, "eventDate"),
        image: formText(formData, "image"), tags: linesToArray(formData.get("tags")), details, factionIds: formData.getAll("factionIds"),
        participantIds: type === "session-record" ? [...form.querySelectorAll(".participant-check:checked")].map((checkbox) => checkbox.value) : []
      };
    }
  },
  gear: {
    title: "Marketplace", panel: "GEAR CATALOGUE", singular: "Gear",
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
    title: "Announcements & Rules", panel: "ANNOUNCEMENTS & RULES", singular: "Game post",
    name: (record) => record.title,
    meta: (record) => record.type === "announcement"
      ? ["Announcement", record.pinned ? "Pinned" : "", record.publishedAt]
      : ["Rule", record.category || "Uncategorized"],
    // Announcements first, newest at the top; then rules in reading order, the rest by title.
    sortKey: (record) => record.type === "announcement"
      ? `0 ${String(99999999 - Number(String(record.publishedAt || "0").replace(/-/g, ""))).padStart(8, "0")}`
      : `1 ${String(record.order || 999).padStart(3, "0")} ${record.title || ""}`,
    filters: [["type", "Announcements and rules", [["announcement", "Announcements"], ["rule", "Rules"]]]],
    idHelp: "Generated from the title when left blank. Announcements are linked as game.html#post-<id>.",
    fields: (record) => {
      const type = record.type || listFilters.game?.type || "announcement";
      const categories = ["Campaign", "Recruitment Factions", "Campaign Systems", "For Crafters & Artificers", "For Spellcasters", "For Settlement Builders", "Jobs", "Outpost", "Information"];
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
        ${selectField("Category", "category", record.category || "Campaign", categories.map((category) => [category, category]))}
        <div class="field"><span class="field-label">Learning path</span><p class="path-status">${(() => {
          const place = record.id ? pathOfRule(record.id) : null;
          return place ? `Step ${place.index + 1} of ${place.path.ruleIds.length} on “${escapeHtml(place.path.title)}”.` : "Not on a learning path.";
        })()}</p>
          <span class="helper">Change it under <strong>Learning Paths</strong> in the sidebar.</span></div>`)}
      ${textarea("Short summary", "summary", record.summary || "", { full: true })}
      ${textarea("Details", "details", record.details || "", { full: true, rows: 8, help: "Markdown: **bold**, *italic*, # headings, - and 1. lists, > quotes, tables, `code`, [text](url). Link Archive entries with [[archive-id]] or [[archive-id|text]]. Put <code>{{reading-path}}</code> on its own line to show Onboarding and the learning paths there." })}
      ${textarea("Search tags", "tags", listText(record.tags), { full: true, help: "One tag per line. These terms are included in public search." })}
      ${imageField("Art", "image", record.image)}
      <p class="helper field full">Optional. Shown on the right of the post on wide screens, fading into the page, and as a faded banner above it on phones. Wide landscape images work best.</p>`;
    },
    related: (record) => linkCheck([record.summary, record.details]) + legacyNote(record),
    read: (formData, form) => {
      const type = formText(formData, "type");
      return {
        type, title: formText(formData, "title"),
        category: type === "rule" ? formText(formData, "category") : "",
        // Kept as saved: the reading path editor is the one place that changes it.
        order: type === "rule" ? state.game.find((post) => post.id === form?.dataset.editingId)?.order ?? null : null,
        publishedAt: type === "announcement" ? formText(formData, "publishedAt") : "",
        showUntil: type === "announcement" ? formText(formData, "showUntil") : "",
        pinned: type === "announcement" && formData.get("pinned") === "on",
        summary: formText(formData, "summary"), details: formText(formData, "details"),
        tags: linesToArray(formData.get("tags")), image: formText(formData, "image")
      };
    }
  }
};

function legacyNote(record) {
  if (!record.legacy) return "";
  const source = { gates: "Gate", expeditions: "Expedition", expedition_reports: "Expedition Report", rules: "Rule" }[record.legacy.source] || record.legacy.source;
  return `<div class="field full"><span class="helper">Migrated from a v3 ${escapeHtml(source)}. The original record is kept in the database's legacy_records table.</span></div>`;
}

/* ---------- Functions, Domains, Resources and Spell Forms ---------- */

// Checkboxes for Resource Functions, grouped as in the rules. Read with formData.getAll(name).
function functionPicker(name, selected, label, help = "") {
  return `<div class="field full"><span class="field-label">${label}</span>
    <div class="function-picker-groups">${Object.entries(state.vocabulary.functionGroups).map(([group, names]) => `
      <div class="function-group"><strong>${escapeHtml(group)}</strong>${names.map((fn) => `
        <label><input type="checkbox" name="${name}" value="${fn}" ${selected.includes(fn) ? "checked" : ""} />${fn}</label>`).join("")}</div>`).join("")}</div>
    ${help ? `<span class="helper">${help}</span>` : ""}</div>`;
}

function domainPicker(name, selected, help = "") {
  return `<div class="field full"><span class="field-label">Domain</span>
    <div class="domain-options">${state.vocabulary.domains.map((domain) => `
      <label><input type="checkbox" name="${name}" value="${domain}" ${selected.includes(domain) ? "checked" : ""} />${escapeHtml(domainName(domain))}</label>`).join("")}</div>
    ${help ? `<span class="helper">${help}</span>` : ""}</div>`;
}

// A filterable list of records to tick. Read with formData.getAll(name).
function recordChecklist(name, selectedIds, key, labelFor, label, help = "") {
  const records = [...state[key]].sort((left, right) => String(labelFor(left)).localeCompare(String(labelFor(right))));
  const list = records.length ? records.map((record) => `
    <label class="check-option" data-search="${escapeHtml(String(labelFor(record)).toLowerCase())}">
      <input type="checkbox" name="${name}" value="${escapeHtml(record.id)}" ${selectedIds.includes(record.id) ? "checked" : ""} />
      <span>${escapeHtml(labelFor(record))}${record.published ? "" : " — unpublished"}</span>
    </label>`).join("") : '<div class="empty-list">None yet.</div>';
  return `<div class="field full"><span class="field-label">${label}</span>
    <input type="search" class="reference-filter" data-filter-list="${name}-list" placeholder="Filter" aria-label="Filter ${label}" />
    <div class="check-list" id="${name}-list">${list}</div>${help ? `<span class="helper">${help}</span>` : ""}</div>`;
}

const isGate = (entry) => entry.type === "gate-record";
const gateLabel = (entry) => [entry.details?.designation, entry.title].filter(Boolean).join(" · ");
const gateSelect = (label, name, value, help) => referenceSelect(label, name, value, "archive", gateLabel, { filter: isGate, emptyLabel: "— No Gate —", help });
const gateDomains = (gateId) => findRecord("archive", gateId)?.details?.domains || [];
const resourceDomains = (resource) => resource.domains?.length ? resource.domains : gateDomains(resource.gateId);
const domainText = (domains) => domains.length ? domains.map(domainName).join(" + ") : "No Domain";

collections.resources = {
  title: "Resources", panel: "GATE RESOURCES", singular: "Resource",
  name: (record) => record.name,
  meta: (record) => [domainText(resourceDomains(record)), humanize(record.availability || "sample"), (record.functions || []).join(" · ")],
  get filters() {
    return [["availability", "Any availability", state.vocabulary.resourceAvailability.map((value) => [value, humanize(value)])],
      ["sourceType", "Any source", state.vocabulary.resourceSources.map((value) => [value, humanize(value)])]];
  },
  idHelp: "Generated from the name when left blank. Projects reference this ID.",
  fields: (record) => `
    ${field("Name", "name", record.name || "", { required: true, help: "Named by the Expeditioners who discovered it." })}
    ${selectField("Source", "sourceType", record.sourceType || "other", state.vocabulary.resourceSources.map((value) => [value, humanize(value)]))}
    ${gateSelect("Origin Gate", "gateId", record.gateId, "The Gate it comes from. It inherits that Gate's Domain unless you pick one below.")}
    ${selectField("Availability", "availability", record.availability || "sample", state.vocabulary.resourceAvailability.map((value) => [value, humanize(value)]),
      { help: "Sample: research quantities. Limited: a stock that use consumes. Available: a dependable supply." })}
    ${domainPicker("domains", record.domains || [], "Leave empty to inherit the origin Gate's Domain.")}
    ${textarea("Description", "description", record.description || "", { full: true, rows: 3, help: "What it looks, feels and behaves like. Fiction, not mechanics." })}
    ${functionPicker("functions", record.functions || [], "Known Functions", "What Endros currently understands it can do. Usually 1–3; 4+ is exceptional.")}
    ${textarea("Special Property", "specialProperty", record.specialProperty || "", { full: true, rows: 2, help: "Strange behavior too specific to be a Function." })}
    ${field("Supply", "supply", record.supply || "", { full: true, placeholder: "e.g. Established extraction operation", help: "Optional. How Endros gets it." })}
    ${projectSelect(record)}
    <div class="form-section cm-only">CM only · never published</div>
    <div class="field full gm-only">${functionPicker("hiddenFunctions", record.hiddenFunctions || [], "Hidden Functions", "Already in the material, not yet understood. Research can reveal them: move them to Known Functions when it does.")}</div>
    ${textarea("Harvesting issue", "harvestingIssue", record.harvestingIssue || "", { full: true, rows: 2 })}
    ${textarea("CM notes", "gmNotes", record.gmNotes || "", { full: true, rows: 3 })}`,
  related: (record) => {
    const projects = state.projects.filter((project) => (project.requiredResourceIds || []).includes(record.id));
    return `<div class="form-section">Derived references</div>
      ${relatedBlock("Required by projects", projectRows(projects), "No project requires it.")}`;
  },
  read: (formData) => ({
    name: formText(formData, "name"), sourceType: formText(formData, "sourceType"), gateId: formText(formData, "gateId") || null,
    availability: formText(formData, "availability"), domains: formData.getAll("domains"), description: formText(formData, "description"),
    functions: formData.getAll("functions"), specialProperty: formText(formData, "specialProperty"), supply: formText(formData, "supply"),
    projectId: formText(formData, "projectId") || null, hiddenFunctions: formData.getAll("hiddenFunctions"),
    harvestingIssue: formText(formData, "harvestingIssue"), gmNotes: formText(formData, "gmNotes")
  })
};

function relationRow(item = { factionId: "", text: "" }, ownId = "") {
  const choices = state.factions.filter((faction) => faction.id !== ownId)
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .map((faction) => `<option value="${escapeHtml(faction.id)}" ${faction.id === item.factionId ? "selected" : ""}>${escapeHtml(faction.name)}${faction.published ? "" : " — unpublished"}</option>`);
  return `<div class="checklist-row relation-row" data-relation-row>
    <select data-relation="factionId" aria-label="Faction"><option value="">— Faction —</option>${choices.join("")}</select>
    <input type="text" data-relation="text" value="${escapeHtml(item.text || "")}" placeholder="One line: how they see each other" aria-label="Relationship" />
    <button class="remove-record" type="button" data-action="remove-relation" aria-label="Remove relation" title="Remove relation">×</button>
  </div>`;
}

const readRelations = (form) => [...form.querySelectorAll("[data-relation-row]")]
  .map((row) => ({ factionId: row.querySelector('[data-relation="factionId"]').value, text: row.querySelector('[data-relation="text"]').value.trim() }))
  .filter((item) => item.factionId);

collections.factions = {
  title: "Factions", panel: "WORLD FACTIONS", singular: "Faction",
  name: (record) => record.name,
  meta: (record) => [record.tagline, record.extraName ? `Extra: ${record.extraName}` : ""],
  sortKey: (record) => `${String(record.order ?? 999).padStart(3, "0")} ${record.name || ""}`,
  idHelp: "Generated from the name when left blank. It is the faction's permanent URL (factions.html#id).",
  fields: (record) => `
    <div class="form-section">Basics</div>
    ${field("Name", "name", record.name || "", { required: true, placeholder: "e.g. Vardic Holds" })}
    ${field("Short name", "shortName", record.shortName || "", { placeholder: "e.g. the Holds", help: "Optional. Used in relation lists and other tight spaces." })}
    ${field("Short descriptor", "tagline", record.tagline || "", { full: true, placeholder: "e.g. Industrial northern jarldoms", help: "A few words under the name on cards." })}
    ${textarea("One-sentence identity", "summary", record.summary || "", { full: true, rows: 3, help: "Who these people are, in a sentence or two. Shown on the card and at the top of the page." })}
    ${field("Government", "government", record.government || "", { full: true })}
    ${field("Known for", "knownFor", record.knownFor || "", { full: true })}
    ${textarea("Core values", "coreValues", listText(record.coreValues), { help: "One per line, e.g. Craft, Reputation." })}
    ${textarea("Aliases", "aliases", listText(record.aliases), { help: "One per line. Other names people search for, e.g. Vards, Vardic." })}
    ${textarea("Relationship with the Gates", "gateAttitude", record.gateAttitude || "", { full: true, rows: 2 })}
    ${field("Sort order", "order", record.order ?? "", { type: "number", min: 1, help: "Optional. Lower numbers come first on the Factions page." })}
    <div class="form-section">Sponsorship</div>
    ${referenceSelect("Recruitment Faction rule", "ruleId", record.ruleId, "game", (post) => post.title, { full: true, filter: (post) => post.type === "rule",
      emptyLabel: "— Not a Recruitment Faction —", help: "The rule a player reads when choosing this sponsor. The faction page links to it." })}
    ${textarea("Sponsor framing", "sponsorFraming", record.sponsorFraming || "", { full: true, rows: 2, help: "Optional. Who exactly sponsors people, e.g. \"through the University of Verna\"." })}
    ${field("Extra name", "extraName", record.extraName || "", { placeholder: "e.g. Built to Endure" })}
    ${textarea("Extra (short rules text)", "extraRule", record.extraRule || "", { full: true, rows: 3, help: "A compact version; the full rule lives in the Recruitment Faction rule." })}
    ${textarea("Expectations", "expectations", record.expectations || "", { full: true, rows: 2, help: "What the sponsor expects, as roleplay hooks." })}
    <div class="form-section">Visual identity</div>
    ${imageField("Flag", "flag", record.flag, "image", "Shown on the card and the page header.")}
    ${imageField("Homeland image", "homeland", record.homeland, "image", "The main landscape: the card crop and the page banner.")}
    ${imageListField("Homeland gallery", "gallery", record.gallery, "Optional extra landscapes.")}
    ${imageListField("Clothing references", "clothing", record.clothing, "How people dress.")}
    ${textarea("Visual summary", "visualSummary", record.visualSummary || "", { full: true, rows: 3, help: "Silhouettes, architecture, industrial style. A short paragraph." })}
    ${field("Colours", "palette", record.palette || "", { full: true, placeholder: "e.g. navy, cream, polished brass" })}
    ${field("Materials", "materials", record.materials || "", { full: true, placeholder: "e.g. dark iron, timber, wool, leather" })}
    <div class="form-section">Beliefs, history and relations</div>
    ${textarea("Beliefs & folklore", "beliefs", record.beliefs || "", { full: true, rows: 3, help: "A short summary. Link the full entries with [[archive-id]]; tag those entries with this faction so they are listed too." })}
    ${textarea("History", "history", record.history || "", { full: true, rows: 3, help: "Two to four sentences of orientation. Link the full history with [[archive-id]]." })}
    <div class="field full"><span class="field-label">Relations</span>
      <div class="checklist-rows" id="relation-rows">${(record.relations || []).map((item) => relationRow(item, record.id)).join("")}</div>
      <div class="row-actions"><button type="button" class="button button-secondary" data-action="add-relation">+ Add relation</button></div>
      <span class="helper">One line each. Relations to unpublished factions stay off the site.</span></div>`,
  related: (record) => {
    const entries = state.archive.filter((entry) => (entry.factionIds || []).includes(record.id));
    const relatedBy = state.factions.filter((other) => (other.relations || []).some((item) => item.factionId === record.id));
    return `<div class="form-section">Derived references</div>
      ${relatedBlock("Archive entries about this faction", entries.map((entry) => `${referenceLink("archive", entry, entry.title)} <span class="helper">${escapeHtml(archiveTypeLabel(entry.type))}${entry.published ? "" : " · unpublished"}</span>`), "None yet. Tick this faction on an Archive entry to list it here.")}
      ${relatedBlock("Named in the relations of", relatedBy.map((other) => referenceLink("factions", other, other.name)), "No other faction lists this one.")}
      ${linkCheck([record.summary, record.beliefs, record.history, record.gateAttitude, record.visualSummary])}`;
  },
  read: (formData, form) => ({
    name: formText(formData, "name"), shortName: formText(formData, "shortName"), tagline: formText(formData, "tagline"),
    summary: formText(formData, "summary"), government: formText(formData, "government"), knownFor: formText(formData, "knownFor"),
    coreValues: linesToArray(formData.get("coreValues")), aliases: linesToArray(formData.get("aliases")),
    gateAttitude: formText(formData, "gateAttitude"), order: formText(formData, "order"),
    ruleId: formText(formData, "ruleId") || null, sponsorFraming: formText(formData, "sponsorFraming"),
    extraName: formText(formData, "extraName"), extraRule: formText(formData, "extraRule"), expectations: formText(formData, "expectations"),
    flag: formText(formData, "flag"), homeland: formText(formData, "homeland"), gallery: formData.getAll("gallery"), clothing: formData.getAll("clothing"),
    visualSummary: formText(formData, "visualSummary"), palette: formText(formData, "palette"), materials: formText(formData, "materials"),
    beliefs: formText(formData, "beliefs"), history: formText(formData, "history"), relations: readRelations(form)
  })
};

const FORM_TIER_LABELS = { basic: "Basic Form", first: "First Form", second: "Second Form", third: "Third Form" };
collections.forms = {
  title: "Spell Forms", panel: "SPELL FORMS", singular: "Form",
  name: (record) => record.name,
  meta: (record) => [FORM_TIER_LABELS[record.tier] || record.tier, (record.words || []).join(" + "), humanize(record.status || "known")],
  get filters() {
    return [["tier", "Any tier", Object.keys(state.vocabulary.formTiers).map((tier) => [tier, FORM_TIER_LABELS[tier] || humanize(tier)])],
      ["status", "Any status", state.vocabulary.formStatuses.map((value) => [value, humanize(value)])]];
  },
  idHelp: "Generated from the name when left blank.",
  fields: (record) => `
    ${field("Name", "name", record.name || "", { required: true, placeholder: "e.g. Flash Freeze" })}
    ${selectField("Tier", "tier", record.tier || "first", Object.entries(state.vocabulary.formTiers).map(([tier, words]) => [tier, `${FORM_TIER_LABELS[tier] || humanize(tier)} (${words} Word${words > 1 ? "s" : ""})`]),
      { help: "Basic manifests one Word. First uses one Word for a defined effect. Second and Third combine two and three Words." })}
    ${selectField("Status", "status", record.status || "known", state.vocabulary.formStatuses.map((value) => [value, humanize(value)]),
      { help: "Theoretical: proposed. In development: a Spell Innovation Project is working on it. Known: a learnable Form." })}
    ${projectSelect(record)}
    ${functionPicker("words", record.words || [], "Words", "Tick exactly as many Words as the tier uses.")}
    ${textarea("Effect", "effect", record.effect || "", { full: true, rows: 4, help: "What the Form does. Leave costs and difficulties out until they are finalized." })}
    <div class="form-section cm-only">CM only · never published</div>
    ${textarea("CM notes", "gmNotes", record.gmNotes || "", { full: true, rows: 3 })}`,
  read: (formData) => ({
    name: formText(formData, "name"), tier: formText(formData, "tier"), status: formText(formData, "status"),
    projectId: formText(formData, "projectId") || null, words: formData.getAll("words"), effect: formText(formData, "effect"),
    gmNotes: formText(formData, "gmNotes")
  })
};

/* ---------- CM Tools: Resource and Gate generators (drafts, edited before saving) ---------- */

const toolView = {
  tab: "resource",
  resourceOptions: { domain: "random", source: "random", count: "random", mode: "mixed", gateId: "", hidden: true, special: true, harvesting: true },
  gateOptions: { designation: "", domain: "random", secondDomain: "", fauna: "random", flora: "random", ground: "random" },
  resource: null,
  gate: null,
};

const nextGateDesignation = () => {
  const numbers = state.archive.filter(isGate).map((entry) => Number(String(entry.details?.designation || "").match(/(\d+)/)?.[1]) || 0);
  return `G-${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
};
const optionList = (values, selected, labels = {}) => values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(labels[value] || humanize(String(value)))}</option>`).join("");
const listInput = (values) => (values || []).join(", ");
const parseList = (text) => String(text || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);

// One editable Resource draft. `inheritGate` hides the Domain choice for Resources saved with a new Gate.
function draftCard(resource, index, { inheritGate = false, removable = false } = {}) {
  const words = Object.values(state.vocabulary.functionGroups).flat().join(", ");
  return `<div class="draft-card" data-draft-card="${index}">
    <div class="draft-card-head">
      <strong>${escapeHtml(humanize(resource.ecology || resource.sourceType || "resource"))}${resource.origin ? ` · ${escapeHtml(resource.origin)}` : ""}</strong>
      ${removable ? '<label class="inline-check"><input type="checkbox" class="draft-include" checked /> Save this one</label>' : ""}
    </div>
    <div class="draft-grid">
      <label>Name<input type="text" data-draft="name" value="${escapeHtml(resource.name)}" /></label>
      <label>Source<select data-draft="sourceType">${optionList(state.vocabulary.resourceSources, resource.sourceType)}</select></label>
      <label>Availability<select data-draft="availability">${optionList(state.vocabulary.resourceAvailability, resource.availability)}</select></label>
      ${inheritGate ? "" : `<label>Domain<select data-draft="domain"><option value="">Inherit from Gate</option>${optionList(state.vocabulary.domains, resource.domains?.[0] || "", domainLabels())}</select></label>`}
      <label>Known Functions<input type="text" data-draft="functions" value="${escapeHtml(listInput(resource.functions))}" title="${escapeHtml(words)}" /></label>
      <label>Hidden Functions (CM only)<input type="text" data-draft="hiddenFunctions" value="${escapeHtml(listInput(resource.hiddenFunctions))}" title="${escapeHtml(words)}" /></label>
    </div>
    <label>Description<textarea data-draft="description">${escapeHtml(resource.description)}</textarea></label>
    <label>Special Property<input type="text" data-draft="specialProperty" value="${escapeHtml(resource.specialProperty || "")}" /></label>
    <label>Harvesting issue (CM only)<input type="text" data-draft="harvestingIssue" value="${escapeHtml(resource.harvestingIssue || "")}" /></label>
  </div>`;
}

function readDraftCard(card) {
  const value = (key) => card.querySelector(`[data-draft="${key}"]`)?.value.trim() ?? "";
  const domain = value("domain");
  return {
    name: value("name"), sourceType: value("sourceType"), availability: value("availability"), domains: domain ? [domain] : [],
    functions: parseList(value("functions")), hiddenFunctions: parseList(value("hiddenFunctions")),
    description: value("description"), specialProperty: value("specialProperty"), harvestingIssue: value("harvestingIssue"), published: false
  };
}

function resourceToolPanel() {
  const options = toolView.resourceOptions;
  const gates = state.archive.filter(isGate);
  const draftResource = toolView.resource;
  return `
    <div class="tool-options" id="tool-resource-options">
      <label>Domain<select name="domain"><option value="random">Random</option>${optionList(state.vocabulary.domains, options.domain, domainLabels())}</select></label>
      <label>Source<select name="source"><option value="random">Random</option>${optionList(["fauna", "flora", "ground"], options.source, { fauna: "Fauna-derived", flora: "Flora-derived", ground: "Ground / ore / stone" })}</select></label>
      <label>Functions<select name="count">${optionList(["random", 1, 2, 3, 4], options.count, { random: "Random (1–3)", 4: "4 (exceptional)" })}</select></label>
      <label>Combination<select name="mode">${optionList(["synergy", "mixed", "opposed", "unstable"], options.mode, { synergy: "Naturally synergistic", mixed: "Mixed / ordinary", opposed: "Opposed", unstable: "Unstable / catastrophic" })}</select></label>
      <label>Origin Gate<select name="gateId"><option value="">None</option>${gates.map((gate) => `<option value="${escapeHtml(gate.id)}" ${gate.id === options.gateId ? "selected" : ""}>${escapeHtml(gateLabel(gate))}</option>`).join("")}</select></label>
      <label class="inline-check"><input type="checkbox" name="hidden" ${options.hidden ? "checked" : ""} /> Hidden Function</label>
      <label class="inline-check"><input type="checkbox" name="special" ${options.special ? "checked" : ""} /> Special Property</label>
      <label class="inline-check"><input type="checkbox" name="harvesting" ${options.harvesting ? "checked" : ""} /> Harvesting issue</label>
      <div class="tool-actions"><button type="button" class="button button-primary" data-action="tool-generate-resource">${draftResource ? "Generate again" : "Generate Resource"}</button></div>
    </div>
    <p class="helper">With an origin Gate, the draft uses that Gate's Domain and leans towards the Functions its other Resources already have.
      Interactions come from the table in the Resource Functions rule.</p>
    ${draftResource ? `<div class="tool-draft">${draftCard(draftResource, 0)}
      <div class="tool-actions"><button type="button" class="button button-primary" data-action="tool-save-resource">Save as unpublished Resource</button></div></div>` : ""}`;
}

function gateToolPanel() {
  const options = toolView.gateOptions;
  const gate = toolView.gate;
  const counts = ["random", 1, 2, 3];
  return `
    <div class="tool-options" id="tool-gate-options">
      <label>Designation<input type="text" name="designation" value="${escapeHtml(options.designation || nextGateDesignation())}" /></label>
      <label>Domain<select name="domain"><option value="random">Random</option>${optionList(state.vocabulary.domains, options.domain, domainLabels())}</select></label>
      <label>Second Domain (rare)<select name="secondDomain"><option value="">None</option>${optionList(state.vocabulary.domains, options.secondDomain, domainLabels())}</select></label>
      <label>Fauna Resources<select name="fauna">${optionList(counts, options.fauna, { random: "Random (1–3)" })}</select></label>
      <label>Flora Resources<select name="flora">${optionList(counts, options.flora, { random: "Random (1–3)" })}</select></label>
      <label>Ground Resources<select name="ground">${optionList(counts, options.ground, { random: "Random (1–3)" })}</select></label>
      <div class="tool-actions"><button type="button" class="button button-primary" data-action="tool-generate-gate">${gate ? "Generate again" : "Generate Gate"}</button></div>
    </div>
    ${gate ? `<div class="tool-draft" id="gate-draft">
      <div class="draft-card">
        <div class="draft-card-head"><strong>Gate · ${escapeHtml(gate.domains.map(domainName).join(" + "))}</strong><span class="helper">Signature Functions: ${escapeHtml(gate.signature.join(", "))}</span></div>
        <div class="draft-grid">
          <label>Title<input type="text" data-gate="title" value="${escapeHtml(`Gate ${gate.designation}`)}" /></label>
          <label>Designation<input type="text" data-gate="designation" value="${escapeHtml(gate.designation)}" /></label>
          <label>Status<select data-gate="gateStatus">${optionList(state.vocabulary.gateStatuses, "emerging")}</select></label>
        </div>
        <label>Environment (core concept)<textarea data-gate="environment">${escapeHtml(gate.concept)}</textarea></label>
        <div class="draft-grid">
          <label>Known hazards<textarea data-gate="knownHazards">${escapeHtml(gate.hazards.map(cap).join("\n"))}</textarea></label>
          <label>Landmarks (known locations)<textarea data-gate="knownLocations">${escapeHtml(gate.landmarks.map(cap).join("\n"))}</textarea></label>
          <label>Known creatures<textarea data-gate="knownCreatures">${escapeHtml(gate.creatures.join("\n"))}</textarea></label>
        </div>
        <label>CM notes (never published)<textarea data-gate="gmNotes" rows="8">${escapeHtml([
          `Gate Aspect: ${gate.aspect}`,
          `Signature Functions: ${gate.signature.join(", ")}`,
          `Visual identity: ${gate.inferred.visualIdentity}`,
          `Ecology: ${gate.inferred.ecology}`,
          `Likely hazards: ${gate.inferred.likelyHazards}`,
          `Extraction: ${gate.inferred.extraction}`,
          `Research hooks: ${gate.inferred.researchHooks}`,
          `Technology it could unlock: ${gate.inferred.technology}`
        ].join("\n"))}</textarea></label>
      </div>
      <h3>Resources (${gate.resources.length})</h3>
      ${gate.resources.map((resource, index) => draftCard(resource, index, { inheritGate: true, removable: true })).join("")}
      <div class="tool-actions"><button type="button" class="button button-primary" data-action="tool-save-gate">Save Gate and ticked Resources as unpublished drafts</button></div>
    </div>` : ""}`;
}

function renderTools() {
  const tab = (key, label) => `<button type="button" class="outpost-tab" role="tab" data-action="tool-tab" data-tab="${key}" aria-selected="${toolView.tab === key}">${label}</button>`;
  document.getElementById("work-area").innerHTML = `
    <section class="editor-panel tools-editor" aria-label="CM tools"><div class="editor-content tools-panel">
      <div class="editor-title"><div><h2>Generators</h2><p>Every result is an editable draft. Saved records start unpublished.</p></div></div>
      <div class="outpost-tabs" role="tablist" aria-label="Generators">${tab("resource", "Resource Generator")}${tab("gate", "Gate Generator")}</div>
      ${toolView.tab === "resource" ? resourceToolPanel() : gateToolPanel()}
    </div></section>`;
}

function readToolOptions(id) {
  const root = document.getElementById(id);
  const options = {};
  root.querySelectorAll("select, input").forEach((control) => { options[control.name] = control.type === "checkbox" ? control.checked : control.value; });
  return options;
}

async function handleToolAction(action, button) {
  if (action === "tool-tab") {
    toolView.tab = button.dataset.tab;
  } else if (action === "tool-generate-resource") {
    const options = toolView.resourceOptions = readToolOptions("tool-resource-options");
    const gate = options.gateId ? findRecord("archive", options.gateId) : null;
    const gateFunctions = gate ? state.resources.filter((resource) => resource.gateId === gate.id).flatMap((resource) => resource.functions || []) : [];
    const domain = gate?.details?.domains?.length ? pick(gate.details.domains) : options.domain;
    toolView.resource = generateResource({ ...options, domain, gateFunctions });
    if (gate) toolView.resource.domains = [];
  } else if (action === "tool-save-resource") {
    const data = { ...readDraftCard(document.querySelector("[data-draft-card]")), gateId: toolView.resourceOptions.gateId || null };
    const result = await api("/api/resources", { method: "POST", body: JSON.stringify({ data }) });
    toolView.resource = null;
    await loadState();
    activeView = "resources"; selectedId = result.id; draft = false;
    updateNavigation(); renderContent();
    showNotice(`${data.name} saved as an unpublished Resource.`);
    return;
  } else if (action === "tool-generate-gate") {
    const options = toolView.gateOptions = readToolOptions("tool-gate-options");
    toolView.gate = generateGate(options);
  } else if (action === "tool-save-gate") {
    const draftRoot = document.getElementById("gate-draft");
    const value = (key) => draftRoot.querySelector(`[data-gate="${key}"]`).value.trim();
    const lines = (key) => value(key).split("\n").map((line) => line.trim()).filter(Boolean);
    const gate = await api("/api/archive", { method: "POST", body: JSON.stringify({ data: {
      type: "gate-record", title: value("title"), published: false,
      details: { designation: value("designation"), gateStatus: value("gateStatus"), domains: toolView.gate.domains, environment: value("environment"),
        knownTraits: [], knownHazards: lines("knownHazards"), knownLocations: lines("knownLocations"), knownCreatures: lines("knownCreatures"),
        gmNotes: value("gmNotes") }
    } }) });
    const failures = [];
    let saved = 0;
    for (const card of draftRoot.querySelectorAll("[data-draft-card]")) {
      if (!card.querySelector(".draft-include")?.checked) continue;
      const data = { ...readDraftCard(card), gateId: gate.id };
      try {
        await api("/api/resources", { method: "POST", body: JSON.stringify({ data }) });
        saved += 1;
      } catch (error) {
        failures.push(`${data.name}: ${error.message}`);
      }
    }
    toolView.gate = null;
    toolView.gateOptions.designation = "";
    await loadState();
    activeView = "archive"; selectedId = gate.id; draft = false;
    updateNavigation(); renderContent();
    showNotice(`Gate saved with ${saved} Resource${saved === 1 ? "" : "s"}, all unpublished.${failures.length ? ` Not saved: ${failures.join("; ")}` : ""}`, Boolean(failures.length));
    return;
  }
  renderTools();
}

/* ---------- Domains: the kinds of Gate environment ---------- */

// Records store a Domain's key; everything shown to the GM uses its current name.
const domainList = () => state.vocabulary.domainList || [];
const domainName = (key) => domainList().find((domain) => domain.key === key)?.name || humanize(key);
const domainLabels = () => Object.fromEntries(domainList().map((domain) => [domain.key, domain.name]));

let vocabTab = "functions";
let domainDraft = null;
const startDomainDraft = () => { domainDraft = domainList().map((domain) => ({ ...domain, isNew: false })); };

function domainUsage() {
  const usage = {};
  const add = (key) => { if (key) usage[key] = (usage[key] || 0) + 1; };
  state.archive.forEach((entry) => (entry.details?.domains || []).forEach(add));
  state.resources.forEach((resource) => (resource.domains || []).forEach(add));
  state.projects.forEach((project) => add(project.requiredDomain));
  return usage;
}

const vocabTabs = () => `<div class="outpost-tabs" role="tablist" aria-label="Vocabulary">
  <button type="button" class="outpost-tab" role="tab" data-action="vocab-tab" data-tab="functions" aria-selected="${vocabTab === "functions"}">Function Words</button>
  <button type="button" class="outpost-tab" role="tab" data-action="vocab-tab" data-tab="interactions" aria-selected="${vocabTab === "interactions"}">Interactions</button>
  <button type="button" class="outpost-tab" role="tab" data-action="vocab-tab" data-tab="domains" aria-selected="${vocabTab === "domains"}">Domains</button>
</div>`;

function renderDomainEditor() {
  if (!domainDraft) startDomainDraft();
  const usage = domainUsage();
  document.getElementById("work-area").innerHTML = `
    <section class="editor-panel" aria-label="Domains"><div class="editor-content">
      <div class="editor-title">
        <div><h2>Vocabulary</h2><p>The shared lists Gates, Resources, Projects and spells draw on.</p></div>
        <div class="editor-actions">
          <button type="button" class="button button-secondary" data-action="vocab-domain-reset">Discard changes</button>
          <button type="button" class="button button-primary" data-action="vocab-domain-save">Save Domains</button>
        </div>
      </div>
      ${vocabTabs()}
      <div class="path-help helper">
        <p>A Gate normally has one Domain; its Resources and creatures inherit it. <strong>Renaming</strong> a Domain is safe: records keep
          pointing at it by its key, which never changes. <strong>Removing</strong> one is refused while a Gate, Resource or Project uses it.</p>
        <p>The colour is used for the Domain's label on the site. The Domains rule lists these automatically.</p>
      </div>
      <div class="vocab-rows domain-rows">${domainDraft.map((domain, index) => {
        const used = domain.isNew ? 0 : usage[domain.key] || 0;
        return `<div class="vocab-row domain-row">
          <input type="text" data-domain-field="${index}:name" value="${escapeHtml(domain.name)}" aria-label="Domain name" />
          <input type="color" data-domain-field="${index}:colour" value="${escapeHtml(domain.colour || "#b4b4c8")}" aria-label="Colour" />
          <input type="text" data-domain-field="${index}:description" value="${escapeHtml(domain.description || "")}" placeholder="What kind of place it is" aria-label="Description" />
          <span class="vocab-usage">${domain.isNew ? "new" : `${used} in use · key ${escapeHtml(domain.key)}`}</span>
          <span class="roadmap-move">
            <button type="button" class="button button-secondary" data-action="vocab-domain-up" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button type="button" class="button button-secondary" data-action="vocab-domain-down" data-index="${index}" ${index === domainDraft.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button type="button" class="button button-secondary" data-action="vocab-domain-remove" data-index="${index}" ${used ? `disabled title="In use by ${used} record${used > 1 ? "s" : ""}"` : ""}>Remove</button>
          </span>
        </div>`;
      }).join("")}</div>
      <div class="tool-actions"><button type="button" class="button button-secondary" data-action="vocab-domain-add">+ Add Domain</button></div>
    </div></section>`;
}

async function handleDomainAction(action, button) {
  const index = Number(button.dataset.index);
  const swap = (from, to) => { if (to >= 0 && to < domainDraft.length) [domainDraft[from], domainDraft[to]] = [domainDraft[to], domainDraft[from]]; };
  if (action === "vocab-domain-add") domainDraft.push({ key: "", name: "", colour: "#b4b4c8", description: "", isNew: true });
  else if (action === "vocab-domain-remove") domainDraft.splice(index, 1);
  else if (action === "vocab-domain-up") swap(index, index - 1);
  else if (action === "vocab-domain-down") swap(index, index + 1);
  else if (action === "vocab-domain-reset") startDomainDraft();
  else if (action === "vocab-domain-save") {
    const data = domainDraft.filter((domain) => domain.name.trim())
      .map(({ key, name, colour, description, isNew }) => ({ key: isNew ? "" : key, name: name.trim(), colour, description: description.trim() }));
    await api("/api/domains", { method: "POST", body: JSON.stringify({ data }) });
    domainDraft = null;
    await loadState();
    showNotice("Domains saved.");
    return;
  }
  renderDomainEditor();
}

/* ---------- Interactions: how two Words behave together ---------- */

const INTERACTION_LABELS = { synergy: "Synergy", opposition: "Opposition", instability: "Instability" };
// Suggested keywords; any short word or phrase is allowed.
const INTERACTION_KEYWORDS = ["Cancellation", "Suppression", "Strain", "Separation", "Detuning", "Erasure", "Blindness", "Signal loss",
  "Runaway", "Overload", "Rupture", "Feedback", "Corruption", "Discharge", "Fracture", "Containment failure"];
let interactionDraft = null;
let interactionFilter = "";
const startInteractionDraft = () => { interactionDraft = (state.vocabulary.interactions || []).map((entry) => ({ ...entry })); };

function renderInteractionEditor() {
  if (!interactionDraft) startInteractionDraft();
  const words = Object.values(state.vocabulary.functionGroups).flat().sort();
  const wordOptions = (selected) => `<option value="">—</option>${words.map((word) => `<option value="${word}" ${word === selected ? "selected" : ""}>${word}</option>`).join("")}`;
  const shown = interactionDraft.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !interactionFilter || entry.a === interactionFilter || entry.b === interactionFilter);
  const counts = Object.fromEntries(Object.keys(INTERACTION_LABELS).map((kind) => [kind, interactionDraft.filter((entry) => entry.kind === kind).length]));
  document.getElementById("work-area").innerHTML = `
    <section class="editor-panel" aria-label="Interactions"><div class="editor-content">
      <div class="editor-title">
        <div><h2>Vocabulary</h2><p>The shared lists Gates, Resources, Projects and spells draw on.</p></div>
        <div class="editor-actions">
          <button type="button" class="button button-secondary" data-action="vocab-interaction-reset">Discard changes</button>
          <button type="button" class="button button-primary" data-action="vocab-interaction-save">Save interactions</button>
        </div>
      </div>
      ${vocabTabs()}
      <div class="path-help helper">
        <p>How two Words behave together. <strong>Synergy</strong>: they support each other. <strong>Opposition</strong>: they work against each other.
          <strong>Instability</strong>: dangerous or unpredictable together. A pair can have more than one kind (Store + Release is both a synergy and an instability).</p>
        <p>The <strong>keyword</strong> names the specific effect in a word or two, such as Runaway or Cancellation; the note can say more. Players see all of this in the Functions explorer, and the generators use it.</p>
      </div>
      <div class="interaction-toolbar">
        <label>Show <select data-interaction-filter><option value="">All Words</option>${words.map((word) => `<option value="${word}" ${word === interactionFilter ? "selected" : ""}>${word}</option>`).join("")}</select></label>
        <span class="helper">${interactionDraft.length} interactions · ${counts.synergy} synergy · ${counts.opposition} opposition · ${counts.instability} instability</span>
        <button type="button" class="button button-secondary" data-action="vocab-interaction-add">+ Add interaction</button>
      </div>
      <datalist id="interaction-keywords">${INTERACTION_KEYWORDS.map((word) => `<option value="${word}"></option>`).join("")}</datalist>
      <div class="interaction-rows">${shown.map(({ entry, index }) => `
        <div class="interaction-row is-${entry.kind}">
          <select data-interaction-field="${index}:a" aria-label="First Word">${wordOptions(entry.a)}</select>
          <span aria-hidden="true">+</span>
          <select data-interaction-field="${index}:b" aria-label="Second Word">${wordOptions(entry.b)}</select>
          <select data-interaction-field="${index}:kind" aria-label="Kind">${Object.entries(INTERACTION_LABELS).map(([kind, label]) => `<option value="${kind}" ${kind === entry.kind ? "selected" : ""}>${label}</option>`).join("")}</select>
          <input type="text" list="interaction-keywords" maxlength="40" data-interaction-field="${index}:keyword" value="${escapeHtml(entry.keyword || "")}" placeholder="Keyword" aria-label="Keyword" />
          <input type="text" data-interaction-field="${index}:note" value="${escapeHtml(entry.note || "")}" placeholder="Note (optional)" aria-label="Note" />
          <button type="button" class="button button-secondary" data-action="vocab-interaction-remove" data-index="${index}">Remove</button>
        </div>`).join("") || '<p class="helper">No interactions for this Word yet.</p>'}</div>
    </div></section>`;
}

async function handleInteractionAction(action, button) {
  if (action === "vocab-interaction-add") interactionDraft.unshift({ a: interactionFilter || "", b: "", kind: "synergy", keyword: "", note: "" });
  else if (action === "vocab-interaction-remove") interactionDraft.splice(Number(button.dataset.index), 1);
  else if (action === "vocab-interaction-reset") startInteractionDraft();
  else if (action === "vocab-interaction-save") {
    const data = interactionDraft.filter((entry) => entry.a && entry.b);
    const result = await api("/api/interactions", { method: "POST", body: JSON.stringify({ data }) });
    interactionDraft = null;
    await loadState();
    showNotice(`${result.count} interactions saved.`);
    return;
  }
  renderInteractionEditor();
}

/* ---------- Function Vocabulary: the Words Resources, Projects and spells share ---------- */

// The working copy while editing. Each Function remembers the name it was saved under, so a rename can be
// carried through every Resource, Form and Project that uses it.
let vocabDraft = null;

const startVocabDraft = () => {
  vocabDraft = (state.vocabulary.functions || []).map((group) => ({
    name: group.name,
    functions: group.functions.map((fn) => ({ name: fn.name, definition: fn.definition || "", original: fn.name }))
  }));
};

// How many records use each Function (by its saved name).
function functionUsage() {
  const usage = {};
  const count = (names) => (names || []).forEach((name) => { usage[name] = (usage[name] || 0) + 1; });
  state.resources.forEach((resource) => { count(resource.functions); count(resource.hiddenFunctions); });
  state.forms.forEach((form) => count(form.words));
  state.projects.forEach((project) => count(project.requiredFunctions));
  return usage;
}

function renderVocabularyEditor() {
  if (vocabTab === "domains") return renderDomainEditor();
  if (vocabTab === "interactions") return renderInteractionEditor();
  if (!vocabDraft) startVocabDraft();
  const usage = functionUsage();
  const groupOptions = (selected) => vocabDraft.map((group, index) => `<option value="${index}" ${index === selected ? "selected" : ""}>${escapeHtml(group.name || `Group ${index + 1}`)}</option>`).join("");
  document.getElementById("work-area").innerHTML = `
    <section class="editor-panel" aria-label="Function vocabulary"><div class="editor-content">
      <div class="editor-title">
        <div><h2>Vocabulary</h2><p>The shared lists Gates, Resources, Projects and spells draw on.</p></div>
        <div class="editor-actions">
          <button type="button" class="button button-secondary" data-action="vocab-reset">Discard changes</button>
          <button type="button" class="button button-primary" data-action="vocab-save">Save vocabulary</button>
        </div>
      </div>
      ${vocabTabs()}
      <div class="path-help helper">
        <p><strong>Renaming</strong> a Function updates every Resource, Form and Project that uses it.
          <strong>Removing</strong> one is refused while anything still uses it.</p>
        <p>Rules text isn't rewritten. After a rename, the manager lists the Game posts that mention the old name.
          The vocabulary list in the Resource Functions rule updates on its own, but its interaction table is ordinary text: add rows there for new Functions.</p>
      </div>
      ${vocabDraft.map((group, groupIndex) => `
        <div class="vocab-group">
          <div class="vocab-group-head">
            <input type="text" class="vocab-group-name" data-vocab-group="${groupIndex}" value="${escapeHtml(group.name)}" aria-label="Group name" />
            <span class="roadmap-move">
              <button type="button" class="button button-secondary" data-action="vocab-group-up" data-group="${groupIndex}" ${groupIndex === 0 ? "disabled" : ""} aria-label="Move group up">↑</button>
              <button type="button" class="button button-secondary" data-action="vocab-group-down" data-group="${groupIndex}" ${groupIndex === vocabDraft.length - 1 ? "disabled" : ""} aria-label="Move group down">↓</button>
              <button type="button" class="button button-secondary" data-action="vocab-remove-group" data-group="${groupIndex}" ${group.functions.length ? "disabled title=\"Move or remove its Functions first\"" : ""}>Remove group</button>
            </span>
          </div>
          <div class="vocab-rows">${group.functions.map((fn, index) => {
            const used = fn.original ? usage[fn.original] || 0 : 0;
            return `<div class="vocab-row">
              <input type="text" data-vocab-name="${groupIndex}:${index}" value="${escapeHtml(fn.name)}" aria-label="Function name" />
              <input type="text" data-vocab-definition="${groupIndex}:${index}" value="${escapeHtml(fn.definition)}" placeholder="What it does" aria-label="Definition" />
              <span class="vocab-usage" title="Resources, Forms and Projects using it">${fn.original ? `${used} in use` : "new"}${fn.original && fn.original !== fn.name ? ` · was ${escapeHtml(fn.original)}` : ""}</span>
              <select data-vocab-move="${groupIndex}:${index}" aria-label="Group">${groupOptions(groupIndex)}</select>
              <span class="roadmap-move">
                <button type="button" class="button button-secondary" data-action="vocab-up" data-group="${groupIndex}" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                <button type="button" class="button button-secondary" data-action="vocab-down" data-group="${groupIndex}" data-index="${index}" ${index === group.functions.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                <button type="button" class="button button-secondary" data-action="vocab-remove" data-group="${groupIndex}" data-index="${index}" ${used ? `disabled title="In use by ${used} record${used > 1 ? "s" : ""}"` : ""}>Remove</button>
              </span>
            </div>`;
          }).join("")}</div>
          <button type="button" class="button button-secondary" data-action="vocab-add" data-group="${groupIndex}">+ Add Function</button>
        </div>`).join("")}
      <div class="tool-actions"><button type="button" class="button button-secondary" data-action="vocab-add-group">+ Add group</button></div>
    </div></section>`;
}

async function handleVocabAction(action, button) {
  if (action === "vocab-tab") {
    vocabTab = button.dataset.tab;
    return renderVocabularyEditor();
  }
  if (action.startsWith("vocab-domain-")) return handleDomainAction(action, button);
  if (action.startsWith("vocab-interaction-")) return handleInteractionAction(action, button);
  const group = Number(button.dataset.group);
  const index = Number(button.dataset.index);
  const swap = (list, from, to) => { if (to >= 0 && to < list.length) [list[from], list[to]] = [list[to], list[from]]; };
  if (action === "vocab-add") vocabDraft[group].functions.push({ name: "", definition: "", original: null });
  else if (action === "vocab-remove") vocabDraft[group].functions.splice(index, 1);
  else if (action === "vocab-up") swap(vocabDraft[group].functions, index, index - 1);
  else if (action === "vocab-down") swap(vocabDraft[group].functions, index, index + 1);
  else if (action === "vocab-add-group") vocabDraft.push({ name: "New group", functions: [] });
  else if (action === "vocab-remove-group") vocabDraft.splice(group, 1);
  else if (action === "vocab-group-up") swap(vocabDraft, group, group - 1);
  else if (action === "vocab-group-down") swap(vocabDraft, group, group + 1);
  else if (action === "vocab-reset") startVocabDraft();
  else if (action === "vocab-save") {
    const data = vocabDraft.map((item) => ({ name: item.name.trim(), functions: item.functions
      .filter((fn) => fn.name.trim()).map((fn) => ({ name: fn.name.trim(), definition: fn.definition.trim() })) }));
    const renames = Object.fromEntries(vocabDraft.flatMap((item) => item.functions)
      .filter((fn) => fn.original && fn.name.trim() && fn.original !== fn.name.trim()).map((fn) => [fn.original, fn.name.trim()]));
    const result = await api("/api/vocabulary", { method: "POST", body: JSON.stringify({ data, renames }) });
    vocabDraft = null;
    await loadState();
    showNotice(`Vocabulary saved${result.recordsUpdated ? `; ${result.recordsUpdated} record${result.recordsUpdated > 1 ? "s" : ""} updated` : ""}.`
      + (result.ruleMentions.length ? ` Rules still mention old names: ${result.ruleMentions.join(", ")}.` : ""), Boolean(result.ruleMentions.length));
    return;
  }
  renderVocabularyEditor();
}

// Typing updates the working copy without redrawing; moving a Function to another group redraws.
function handleVocabInput(target) {
  if (target.dataset.interactionFilter !== undefined) {
    interactionFilter = target.value;
    renderInteractionEditor();
    return;
  }
  if (target.dataset.interactionField !== undefined) {
    const [index, field] = target.dataset.interactionField.split(":");
    interactionDraft[Number(index)][field] = target.value;
    if (field === "kind") target.closest(".interaction-row").className = `interaction-row is-${target.value}`;
    return;
  }
  if (target.dataset.domainField !== undefined) {
    const [index, field] = target.dataset.domainField.split(":");
    domainDraft[Number(index)][field] = target.value;
    return;
  }
  if (target.dataset.vocabGroup !== undefined) vocabDraft[Number(target.dataset.vocabGroup)].name = target.value;
  const [group, index] = String(target.dataset.vocabName ?? target.dataset.vocabDefinition ?? target.dataset.vocabMove ?? "").split(":").map(Number);
  if (target.dataset.vocabName !== undefined) vocabDraft[group].functions[index].name = target.value;
  if (target.dataset.vocabDefinition !== undefined) vocabDraft[group].functions[index].definition = target.value;
  if (target.dataset.vocabMove !== undefined && Number(target.value) !== group) {
    const [fn] = vocabDraft[group].functions.splice(index, 1);
    vocabDraft[Number(target.value)].functions.push(fn);
    renderVocabularyEditor();
  }
}

/* ---------- Navigation: views, history, unsaved changes ---------- */

// Gates and lore are both Archive entries; the sidebar opens the Archive with one of these presets.
let activePreset = "";
// Where "← Back" returns to after following a link, newest last.
const navHistory = [];
// Per collection: which records the list shows ("all", "unpublished", "published") and how it sorts ("name", "recent").
const listView = {};
// Records ticked in the list for a bulk action, by collection.
let bulkSelection = new Set();
// The record form as it was when drawn, to notice unsaved edits.
let formSnapshot = null;

const SPECIAL_VIEWS = {
  home: "Home", outpost: "Outpost Sheet", site: "Site & Launch", tools: "CM Tools · Generators",
  vocabulary: "CM Tools · Vocabulary", readingpath: "Learning Paths",
};
const viewTitle = () => SPECIAL_VIEWS[activeView]
  || (activeView === "archive" ? (activePreset === "gates" ? "Gates" : "Archive (lore)") : collections[activeView]?.title || activeView);
const viewLabelFor = (view, preset) => SPECIAL_VIEWS[view] || (view === "archive" ? (preset === "gates" ? "Gates" : "Archive (lore)") : collections[view]?.title || view);
const isGateRecord = (id) => findRecord("archive", id)?.type === "gate-record";

const draftSnapshot = () => {
  try { return JSON.stringify(currentDraft()?.data ?? null); } catch { return "invalid"; }
};

// True when leaving now would lose work: an edited form, an edited vocabulary or reading path, or an unsaved generated draft.
function hasUnsavedChanges() {
  if (activeView === "vocabulary") {
    const savedFunctions = JSON.stringify((state.vocabulary.functions || []).map((group) => [group.name, group.functions.map((fn) => [fn.name, fn.definition || ""])]));
    const draftFunctions = vocabDraft && JSON.stringify(vocabDraft.map((group) => [group.name, group.functions.map((fn) => [fn.name, fn.definition || ""])]));
    const savedDomains = JSON.stringify(domainList().map((domain) => [domain.key, domain.name, domain.colour || "", domain.description || ""]));
    const draftDomains = domainDraft && JSON.stringify(domainDraft.map((domain) => [domain.key, domain.name, domain.colour || "", domain.description || ""]));
    const interactionKey = (list) => JSON.stringify((list || []).filter((entry) => entry.a && entry.b).map((entry) => [entry.a, entry.b, entry.kind, entry.keyword || "", entry.note || ""]));
    const interactionsChanged = interactionDraft && interactionKey(interactionDraft) !== interactionKey(state.vocabulary.interactions);
    return Boolean((draftFunctions && draftFunctions !== savedFunctions) || (draftDomains && draftDomains !== savedDomains) || interactionsChanged);
  }
  if (activeView === "readingpath") {
    const key = (paths) => JSON.stringify((paths || []).map((path) => [path.title, path.description || "", path.ruleIds]));
    return Boolean(pathEditor) && key(pathEditor) !== key(savedPaths());
  }
  if (activeView === "tools") return Boolean(toolView.resource || toolView.gate);
  return formSnapshot !== null && draftSnapshot() !== formSnapshot;
}

function confirmLeave() {
  if (!hasUnsavedChanges()) return true;
  if (!confirm("You have unsaved changes here. Leave without saving them?")) return false;
  toolView.resource = null;
  toolView.gate = null;
  return true;
}

/* navigateTo(view, id, { preset, remember, force }): the one way to change what the work area shows.
   `remember` puts the current place on the back stack (used when following links). */
function navigateTo(view, id = null, options = {}) {
  if (!options.force && !confirmLeave()) return false;
  if (options.remember && (view !== activeView || id !== selectedId)) {
    navHistory.push({ view: activeView, id: selectedId, preset: activePreset, label: currentPlaceLabel() });
    if (navHistory.length > 20) navHistory.shift();
  }
  if (view !== activeView) { vocabDraft = null; domainDraft = null; interactionDraft = null; pathEditor = null; bulkSelection = new Set(); }
  if (view === "archive") activePreset = options.preset || (id ? (isGateRecord(id) ? "gates" : "lore") : activePreset || "gates");
  else activePreset = "";
  activeView = view;
  selectedId = id;
  draft = false;
  filterText = "";
  stashView = { tab: "stash", query: "", category: "" };
  updateNavigation();
  renderContent();
  window.scrollTo({ top: 0 });
  return true;
}

function currentPlaceLabel() {
  const config = collections[activeView];
  const record = config && selectedId ? findRecord(activeView, selectedId) : null;
  return record ? `${config.name(record) || record.id}` : viewTitle();
}

function renderBackBar() {
  const bar = document.getElementById("back-bar");
  const last = navHistory.at(-1);
  bar.hidden = !last;
  bar.innerHTML = last ? `<button type="button" class="back-link" data-nav-back>← Back to ${escapeHtml(last.label)}</button>` : "";
}

function goBack() {
  const last = navHistory.at(-1);
  if (!last || !confirmLeave()) return;
  navHistory.pop();
  navigateTo(last.view, last.id, { preset: last.preset, force: true });
}

// Runs after every render: remember the form, offer section links, show the back link.
function afterRender() {
  formSnapshot = document.getElementById("record-form") || document.getElementById("outpost-form") || document.getElementById("site-form") ? draftSnapshot() : null;
  buildSectionJump();
  renderBackBar();
}

/* ---------- Long forms: section links and a header that stays in view ---------- */

function buildSectionJump() {
  const nav = document.querySelector("[data-section-jump]");
  const form = document.getElementById("record-form");
  if (!nav || !form) return;
  const sections = [...form.querySelectorAll(".form-section")].filter((section) => !section.closest("[hidden]"));
  if (sections.length < 2) { nav.hidden = true; return; }
  sections.forEach((section, index) => { section.id = `form-section-${index}`; });
  nav.innerHTML = `<button type="button" data-jump-section="top">Details</button>${sections.map((section, index) =>
    `<button type="button" data-jump-section="form-section-${index}">${escapeHtml(section.textContent.replace(/·.*$/, "").trim())}</button>`).join("")}`;
  nav.hidden = false;
}

function jumpToSection(target) {
  const sticky = document.querySelector(".editor-sticky");
  const offset = (sticky?.offsetHeight || 0) + 12;
  const element = target === "top" ? document.getElementById("record-form") : document.getElementById(target);
  if (element) window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - (target === "top" ? 20 : offset), behavior: "smooth" });
}

/* ---------- Lists: status filter, sort, and bulk actions ---------- */

const listOptions = (key) => listView[key] || (listView[key] = { status: "all", sort: "name" });

function listControls(key) {
  const options = listOptions(key);
  return `<div class="list-controls">
    <select data-list-status aria-label="Show">
      <option value="all" ${options.status === "all" ? "selected" : ""}>All records</option>
      <option value="unpublished" ${options.status === "unpublished" ? "selected" : ""}>Unpublished only</option>
      <option value="published" ${options.status === "published" ? "selected" : ""}>Published only</option>
    </select>
    <select data-list-sort aria-label="Sort">
      <option value="name" ${options.sort === "name" ? "selected" : ""}>Sort: name</option>
      <option value="recent" ${options.sort === "recent" ? "selected" : ""}>Sort: recently edited</option>
    </select>
  </div>`;
}

function bulkBar() {
  const count = bulkSelection.size;
  return `<div class="bulk-bar${count ? " has-selection" : ""}" data-bulk-bar>
    <label class="bulk-all"><input type="checkbox" data-bulk-all ${count && count === document.querySelectorAll(".bulk-check").length ? "checked" : ""} /> ${count ? `${count} selected` : "Select"}</label>
    ${count ? `<span class="bulk-actions">
      <button type="button" class="button button-primary" data-action="bulk-publish">Publish</button>
      <button type="button" class="button button-secondary" data-action="bulk-unpublish">Unpublish</button>
      <button type="button" class="button button-secondary" data-action="bulk-sample">Mark as sample</button>
      ${state.settings.includeSamples ? '<button type="button" class="button button-secondary" data-action="bulk-unsample">Not a sample</button>' : ""}
    </span>` : '<span class="helper">Tick records to publish them or mark them as samples together.</span>'}
  </div>`;
}

function refreshBulkBar() {
  const bar = document.querySelector("[data-bulk-bar]");
  if (bar) bar.outerHTML = bulkBar();
}

async function runBulkAction(action) {
  const ids = [...bulkSelection];
  const labels = { publish: "published", unpublish: "unpublished", sample: "marked as sample", unsample: "no longer marked as sample" };
  if (action === "sample" && !confirm(`Mark ${ids.length} record${ids.length > 1 ? "s" : ""} as sample content? Samples are hidden from the site and from these lists while "Show sample content" is off.`)) return;
  const result = await api("/api/bulk", { method: "POST", body: JSON.stringify({ collection: activeView, ids, action }) });
  bulkSelection = new Set();
  await loadState();
  showNotice(`${result.changed} record${result.changed === 1 ? "" : "s"} ${labels[action]}. Sync data to update the site.`);
}

/* ---------- Home ---------- */

const HOME_SECTIONS = [
  ["factions", "", "Factions"], ["outpost", "", "Outpost Sheet"], ["facilities", "", "Facilities"], ["projects", "", "Projects"], ["gear", "", "Marketplace"],
  ["jobs", "", "Job Board"], ["archive", "gates", "Gates"], ["resources", "", "Resources"], ["characters", "", "Characters"],
  ["archive", "lore", "Archive (lore)"], ["forms", "", "Spell Forms"], ["game", "", "Announcements & Rules"],
];

function sectionRecords(view, preset) {
  if (!Array.isArray(state[view])) return [];
  if (view !== "archive") return state[view];
  return state.archive.filter((entry) => (preset === "gates") === (entry.type === "gate-record"));
}

function renderHome() {
  const navLink = (view, id, label, preset = "") => `<button type="button" class="home-link" data-home-open="${view}" data-home-id="${escapeHtml(id || "")}" data-home-preset="${preset}">${escapeHtml(label)}</button>`;
  const recordLabel = (view, record) => collections[view]?.name(record) || record.id;
  const all = Object.keys(collections).flatMap((view) => state[view].map((record) => ({ view, record })));
  const unpublished = all.filter(({ record }) => !record.published && !record.sample);
  const recent = all.filter(({ record }) => record.updatedAt).sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt)).slice(0, 8);
  const attention = [
    ...state.projects.filter((project) => (project.complications || []).some((item) => !item.resolved))
      .map((project) => ["projects", project, "has an active complication"]),
    ...state.resources.filter((resource) => !resource.gateId && !(resource.domains || []).length)
      .map((resource) => ["resources", resource, "has no origin Gate and no Domain"]),
    ...state.archive.filter((entry) => entry.type === "gate-record" && !(entry.details?.domains || []).length)
      .map((entry) => ["archive", entry, "Gate has no Domain"]),
    ...state.characters.filter((character) => Number(character.downtime) >= 8)
      .map((character) => ["characters", character, "has 8 Downtime (full)"]),
  ];
  const sync = state.sync || {};
  const when = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never";
  document.getElementById("work-area").innerHTML = `
    <div class="home-grid">
      <section class="home-card home-sync${sync.pending ? " is-pending" : ""}">
        <h2>Site</h2>
        <p>${sync.pending ? "<strong>You have changes that are not on the site yet.</strong>" : "The site data is up to date with the manager."}</p>
        <p class="helper">Last edit: ${when(sync.lastChangeAt)} · Last sync: ${when(sync.lastSyncAt)}</p>
        <button type="button" class="button button-primary" data-home-sync>⟳ Sync data</button>
      </section>
      <section class="home-card">
        <h2>Quick actions</h2>
        <div class="home-actions">
          <button type="button" class="button button-secondary" data-home-new="game">New announcement or rule</button>
          <button type="button" class="button button-secondary" data-home-new="jobs">New job</button>
          <button type="button" class="button button-secondary" data-home-tool="gate">Generate a Gate</button>
          <button type="button" class="button button-secondary" data-home-tool="resource">Generate a Resource</button>
        </div>
      </section>
      <section class="home-card home-wide">
        <h2>Sections</h2>
        <div class="home-sections">${HOME_SECTIONS.map(([view, preset, label]) => {
          const records = sectionRecords(view, preset);
          const drafts = records.filter((record) => !record.published && !record.sample).length;
          return `<button type="button" class="home-section" data-home-open="${view}" data-home-id="" data-home-preset="${preset}">
            <strong>${escapeHtml(label)}</strong><span>${view === "outpost" ? "Sheet" : `${records.length} record${records.length === 1 ? "" : "s"}`}${drafts ? ` · ${drafts} unpublished` : ""}</span></button>`;
        }).join("")}</div>
      </section>
      <section class="home-card">
        <h2>Waiting to publish <span class="chip-count">${unpublished.length}</span></h2>
        ${unpublished.length ? `<ul class="home-list">${unpublished.slice(0, 12).map(({ view, record }) =>
          `<li>${navLink(view, record.id, recordLabel(view, record))} <span class="helper">${escapeHtml(viewLabelFor(view, view === "archive" && record.type === "gate-record" ? "gates" : "lore"))}</span></li>`).join("")}</ul>
          ${unpublished.length > 12 ? `<p class="helper">…and ${unpublished.length - 12} more. Use "Unpublished only" in a section's list to publish them together.</p>` : ""}`
          : '<p class="helper">Everything is published.</p>'}
      </section>
      <section class="home-card">
        <h2>Needs attention <span class="chip-count">${attention.length}</span></h2>
        ${attention.length ? `<ul class="home-list">${attention.slice(0, 12).map(([view, record, reason]) =>
          `<li>${navLink(view, record.id, recordLabel(view, record))} <span class="helper">${escapeHtml(reason)}</span></li>`).join("")}</ul>` : '<p class="helper">Nothing flagged.</p>'}
      </section>
      <section class="home-card home-wide">
        <h2>Recently edited</h2>
        ${recent.length ? `<ul class="home-list">${recent.map(({ view, record }) =>
          `<li>${navLink(view, record.id, recordLabel(view, record))} <span class="helper">${escapeHtml(viewLabelFor(view, view === "archive" && record.type === "gate-record" ? "gates" : "lore"))} · ${when(record.updatedAt)}</span></li>`).join("")}</ul>`
          : '<p class="helper">Edits made from now on appear here.</p>'}
      </section>
    </div>`;
}

/* ---------- Reading Path view ---------- */

function renderReadingPathView() {
  if (!pathEditor) pathEditor = savedPaths();
  document.getElementById("work-area").innerHTML = `<section class="editor-panel" aria-label="Learning paths">${readingPathEditor()}</section>`;
}

/* ---------- Jump to (Ctrl+K) ---------- */

const jump = { open: false, index: 0, results: [] };

function jumpCandidates(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const views = [["home", "", "Home"], ["outpost", "", "Outpost Sheet"], ["readingpath", "", "Learning Paths"], ["site", "", "Site & Launch"],
    ["tools", "", "Generators"], ["vocabulary", "", "Vocabulary"], ...Object.keys(collections).filter((key) => key !== "archive").map((key) => [key, "", collections[key].title]),
    ["archive", "gates", "Gates"], ["archive", "lore", "Archive (lore)"]]
    .map(([view, preset, label]) => ({ view, preset, id: null, label, kind: "Section" }));
  const records = Object.keys(collections).flatMap((view) => state[view].map((record) => ({
    view, id: record.id, preset: "", label: collections[view].name(record) || record.id,
    kind: view === "archive" ? (record.type === "gate-record" ? "Gate" : "Archive")
      : view === "game" ? (record.type === "announcement" ? "Announcement" : "Rule") : collections[view].singular,
  })));
  const matches = (item) => words.every((word) => `${item.label} ${item.id || ""} ${item.kind}`.toLowerCase().includes(word));
  return [...views, ...records].filter(matches).slice(0, 12);
}

function openJump() {
  let dialog = document.getElementById("jump-dialog");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "jump-dialog";
    dialog.className = "jump-dialog";
    dialog.innerHTML = `<div class="jump-panel" role="dialog" aria-label="Jump to">
      <input type="search" id="jump-input" placeholder="Jump to a record or section…" autocomplete="off" aria-label="Jump to" />
      <ul class="jump-results" id="jump-results" role="listbox"></ul>
      <p class="helper">↑ ↓ to choose · Enter to open · Esc to close</p></div>`;
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeJump();
      const item = event.target.closest("[data-jump-index]");
      if (item) chooseJump(Number(item.dataset.jumpIndex));
    });
    dialog.querySelector("#jump-input").addEventListener("input", (event) => { jump.index = 0; renderJump(event.target.value); });
    dialog.querySelector("#jump-input").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); jump.index = Math.min(jump.results.length - 1, jump.index + 1); renderJump(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); jump.index = Math.max(0, jump.index - 1); renderJump(); }
      else if (event.key === "Enter") { event.preventDefault(); chooseJump(jump.index); }
      else if (event.key === "Escape") closeJump();
    });
  }
  dialog.hidden = false;
  jump.open = true;
  jump.index = 0;
  const input = dialog.querySelector("#jump-input");
  input.value = "";
  renderJump("");
  input.focus();
}

function renderJump(query) {
  if (query !== undefined) jump.results = jumpCandidates(query);
  document.getElementById("jump-results").innerHTML = jump.results.length ? jump.results.map((item, index) => `
    <li role="option" aria-selected="${index === jump.index}" class="${index === jump.index ? "is-active" : ""}" data-jump-index="${index}">
      <span>${escapeHtml(item.label)}</span><span class="jump-kind">${escapeHtml(item.kind)}</span></li>`).join("")
    : '<li class="jump-empty">Nothing matches.</li>';
}

function closeJump() {
  const dialog = document.getElementById("jump-dialog");
  if (dialog) dialog.hidden = true;
  jump.open = false;
}

function chooseJump(index) {
  const item = jump.results[index];
  if (!item) return;
  closeJump();
  navigateTo(item.view, item.id, { preset: item.preset, remember: Boolean(item.id) });
}

/* ---------- Publishing bar ---------- */

function updateSyncLabel() {
  const label = document.getElementById("sync-label");
  const button = document.getElementById("sync-button");
  if (!label) return;
  const pending = Boolean(state.sync?.pending);
  label.textContent = pending ? "Sync data · changes waiting" : "Synced";
  button.classList.toggle("is-pending", pending);
  button.title = pending ? "Some saved changes are not on the site yet. Sync writes published content to public-site/data." : "The site data matches the manager.";
}

async function refreshSyncStatus() {
  try {
    const loaded = await api("/api/state");
    state.sync = loaded.sync;
    updateSyncLabel();
  } catch { /* the label just stays as it was */ }
}

/* ---------- Sidebar groups ---------- */

const NAV_COLLAPSED_KEY = "nowhere-manager:collapsed-groups";
function setupNavGroups() {
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem(NAV_COLLAPSED_KEY) || "[]"); } catch { collapsed = []; }
  document.querySelectorAll("[data-nav-toggle]").forEach((toggle) => {
    const group = toggle.closest(".nav-group");
    const apply = (isCollapsed) => {
      group.classList.toggle("is-collapsed", isCollapsed);
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
    };
    apply(collapsed.includes(toggle.dataset.navToggle));
    toggle.addEventListener("click", () => {
      const isCollapsed = !group.classList.contains("is-collapsed");
      apply(isCollapsed);
      collapsed = isCollapsed ? [...new Set([...collapsed, toggle.dataset.navToggle])] : collapsed.filter((key) => key !== toggle.dataset.navToggle);
      try { localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(collapsed)); } catch { /* not remembered */ }
    });
  });
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
  const coins = Number.isInteger(envelope.coins) && envelope.coins >= 0 && envelope.coins <= 999999 ? envelope.coins : null;
  if (coins !== null && coins !== (existing?.coins ?? 0)) changes.push(`Coins: ${existing?.coins ?? 0} → ${coins}`);
  const carryLimit = Number.isInteger(envelope.carryLimit) && envelope.carryLimit >= 0 && envelope.carryLimit <= 99 ? envelope.carryLimit : null;
  if (carryLimit !== null && carryLimit !== (existing?.carryLimit ?? 6)) changes.push(`Carry limit: ${existing?.carryLimit ?? 6} → ${carryLimit}`);
  skipped.forEach((gearId) => changes.push(`Skipped unknown Gear “${gearId}”`));
  // New-character files carry no ID, so importing the same file twice would create a second character.
  const namesake = isNew ? state.characters.find((character) => String(character.name || "").trim().toLowerCase() === name.toLowerCase()) : null;
  return {
    file: file.name, envelope, isNew, existing, stash, coins, carryLimit, changes,
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
          summary, sheet, stash: item.stash || [], coins: item.coins ?? 0, carryLimit: item.carryLimit ?? 6, published: false
        } }) });
      } else {
        const { id, legacy, sample, ...record } = item.existing;
        await api(`/api/characters/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ data: {
          ...record, summary, sheet, ...(item.stash ? { stash: item.stash } : {}), ...(item.coins !== null ? { coins: item.coins } : {}),
          ...(item.carryLimit !== null ? { carryLimit: item.carryLimit } : {})
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
          ${field("Time zone name", "launchLabel", site.launchLabel || "", { placeholder: "Athens time", help: "Visitors see the launch in their own time zone; this name is shown with the original time only to visitors in a different zone." })}
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
  if (loaded.vocabulary) state.vocabulary = loaded.vocabulary;
  state.sync = loaded.sync || {};
  state.learningPaths = loaded.learningPaths || [];
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
  const gates = state.archive.filter((entry) => entry.type === "gate-record").length;
  document.getElementById("gates-count").textContent = gates;
  document.getElementById("lore-count").textContent = state.archive.length - gates;
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.view === activeView && (button.dataset.preset || "") === activePreset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  document.getElementById("page-title").textContent = viewTitle();
  document.getElementById("search-wrap").hidden = Boolean(SPECIAL_VIEWS[activeView]);
  document.getElementById("collection-search").value = filterText;
  updateSyncLabel();
}

function filteredRecords(key) {
  const config = collections[key];
  const query = filterText.trim().toLowerCase();
  const filters = { ...(listFilters[key] || {}) };
  // The Archive is shown as two sections: Gates, and everything else (lore).
  if (key === "archive") {
    if (activePreset === "gates") filters.type = "gate-record";
    else if (!filters.type || filters.type === "gate-record") filters.type = "!gate-record";
  }
  const options = listOptions(key);
  const byName = (left, right) => config.sortKey
    ? config.sortKey(left).localeCompare(config.sortKey(right))
    : String(config.name(left) || "").localeCompare(String(config.name(right) || ""));
  return state[key]
    .filter((record) => Object.entries(filters).every(([field, value]) => !value
      || (String(value).startsWith("!") ? record[field] !== value.slice(1) : record[field] === value)))
    .filter((record) => options.status === "all" || (options.status === "published") === Boolean(record.published))
    .filter((record) => !query || JSON.stringify(record).toLowerCase().includes(query))
    .sort(options.sort === "recent"
      ? (left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) || byName(left, right)
      : byName);
}

function renderContent() {
  if (activeView === "home") renderHome();
  else if (activeView === "outpost") renderOutpostEditor();
  else if (activeView === "site") renderSiteEditor();
  else if (activeView === "tools") renderTools();
  else if (activeView === "vocabulary") renderVocabularyEditor();
  else if (activeView === "readingpath") renderReadingPathView();
  else renderCollection(activeView);
  afterRender();
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
  game: (id, data) => `game.html#${data?.type === "announcement" || data?.type === "rule" ? `post-${encodeURIComponent(id)}` : ""}`,
  // A Resource shows on its Gate's Archive page, or in the catalogue in the Resources rule.
  resources: (id, data) => data?.gateId ? `archive.html#${encodeURIComponent(data.gateId)}` : "game.html#post-resources",
  forms: () => "game.html#post-spellcasting",
  factions: (id) => `factions.html#${encodeURIComponent(id)}`
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
    <div class="record-row">
    <input type="checkbox" class="bulk-check" value="${escapeHtml(record.id)}" ${bulkSelection.has(record.id) ? "checked" : ""} aria-label="Select ${escapeHtml(config.name(record) || record.id)}" />
    <button type="button" class="record-button ${selected?.id === record.id ? "active" : ""}" data-record-id="${escapeHtml(record.id)}">
      <span class="record-name">${escapeHtml(config.name(record) || "Untitled")}</span>
      <span class="record-meta">${config.meta(record).filter(Boolean).map((part, index, parts) => `<span class="${index === parts.length - 1 ? "record-status" : ""}">${escapeHtml(part)}</span>`).join("")}${record.published ? "" : '<span class="record-draft">Unpublished</span>'}${record.sample ? '<span class="record-sample">Sample</span>' : ""}</span>
    </button>
    </div>
  `).join("") : '<div class="empty-list">No matching records yet.</div>';
  const editor = draft ? recordForm(key, null) : selected ? recordForm(key, selected) : `
    <div class="editor-content"><div class="empty-list">Choose a record to edit, or create a new ${config.singular.toLowerCase()}.</div></div>`;

  document.getElementById("work-area").innerHTML = `
    <div class="collection-layout">
      <section class="record-list-panel" aria-label="${config.title} list">
        <div class="panel-head"><h2>${key === "archive" ? (activePreset === "gates" ? "GATE RECORDS" : "ARCHIVE ENTRIES") : config.panel}</h2><button class="button button-secondary" type="button" data-action="new-record">+ New</button></div>
        ${key === "characters" ? '<div class="panel-tools"><button class="button button-secondary" type="button" data-action="batch-import" title="Review and import a folder of player sheet files">Batch import sheet files…</button></div>' : ""}
        ${key === "game" ? '<div class="panel-tools"><button class="button button-secondary" type="button" data-action="path-edit" title="Onboarding and the optional learning paths">Open Learning Paths…</button></div>' : ""}
        ${listFilterBar(key)}
        ${listControls(key)}
        ${bulkBar()}
        <div class="record-list">${listMarkup}</div>
      </section>
      <section class="editor-panel" aria-label="${config.singular} editor">${editor}</section>
    </div>`;
}

/* ---------- Learning paths: Onboarding first, then optional paths that each teach one area ---------- */

// The paths as saved, copied so the editor can change its own version.
const savedPaths = () => (state.learningPaths || []).map((path) => ({ ...path, ruleIds: [...path.ruleIds] }));
const pathOfRule = (ruleId) => {
  const path = (state.learningPaths || []).find((item) => item.ruleIds.includes(ruleId));
  return path ? { path, index: path.ruleIds.indexOf(ruleId) } : null;
};

function readingPathEditor() {
  const rules = state.game.filter((post) => post.type !== "announcement");
  const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
  const placed = new Set(pathEditor.flatMap((path) => path.ruleIds));
  const unplaced = rules.filter((rule) => !placed.has(rule.id)).sort((left, right) => String(left.title).localeCompare(String(right.title)));
  const pathOptions = (current) => pathEditor.map((path, index) => `<option value="${index}" ${index === current ? "selected" : ""}>${escapeHtml(path.title || `Path ${index + 1}`)}</option>`).join("");
  const ruleRow = (id, ruleIndex, pathIndex, count) => {
    const rule = byId[id];
    if (!rule) return "";
    return `<li class="path-row">
      <span class="path-number">${ruleIndex + 1}</span>
      <span class="path-title"><strong>${escapeHtml(rule.title || id)}</strong>
        <span class="record-meta"><span>${escapeHtml(rule.category || "Uncategorized")}</span>${rule.published ? "" : '<span class="record-draft">Unpublished</span>'}</span></span>
      <select data-path-move="${pathIndex}:${ruleIndex}" aria-label="Move to path">${pathOptions(pathIndex)}</select>
      <span class="roadmap-move">
        <button type="button" class="button button-secondary" data-action="lp-rule-up" data-path="${pathIndex}" data-index="${ruleIndex}" aria-label="Move up" ${ruleIndex === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="button button-secondary" data-action="lp-rule-down" data-path="${pathIndex}" data-index="${ruleIndex}" aria-label="Move down" ${ruleIndex === count - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="button button-secondary" data-action="lp-rule-remove" data-path="${pathIndex}" data-index="${ruleIndex}">Take off</button>
      </span>
    </li>`;
  };
  return `
    <div class="editor-content">
      <div class="editor-title">
        <div><h2>Learning Paths</h2><p>Onboarding first, then optional paths that each teach one area</p></div>
        <div class="editor-actions">
          <button type="button" class="button button-secondary" data-action="lp-reset">Discard changes</button>
          <button type="button" class="button button-primary" data-action="lp-save">Save learning paths</button>
        </div>
      </div>
      <div class="path-help helper">
        <p><strong>Onboarding</strong> is what every new player reads: keep it short, ideally around five rules. The other paths are optional:
          players pick one up when it matters to them. Each path is a topic on the Rules tab, and its rules end with <em>Previous</em> / <em>Next</em> links.
          A rule belongs to one path at most.</p>
        <p>Put <code>{{reading-path}}</code> on its own line in a post (such as the Game Listing) to show Onboarding and the list of learning paths there.</p>
      </div>
      ${pathEditor.map((path, pathIndex) => `
        <div class="vocab-group learning-path">
          <div class="vocab-group-head">
            <input type="text" class="vocab-group-name" data-path-field="${pathIndex}:title" value="${escapeHtml(path.title)}" aria-label="Path title" ${pathIndex === 0 ? "" : ""} />
            ${pathIndex === 0 ? '<span class="helper">Always first</span>' : `<span class="roadmap-move">
              <button type="button" class="button button-secondary" data-action="lp-path-up" data-path="${pathIndex}" ${pathIndex === 1 ? "disabled" : ""} aria-label="Move path up">↑</button>
              <button type="button" class="button button-secondary" data-action="lp-path-down" data-path="${pathIndex}" ${pathIndex === pathEditor.length - 1 ? "disabled" : ""} aria-label="Move path down">↓</button>
              <button type="button" class="button button-secondary" data-action="lp-path-remove" data-path="${pathIndex}">Remove path</button></span>`}
          </div>
          <input type="text" class="path-description" data-path-field="${pathIndex}:description" value="${escapeHtml(path.description || "")}" placeholder="Who it is for and what it teaches" aria-label="Path description" />
          <span class="helper">${path.ruleIds.length} rule${path.ruleIds.length === 1 ? "" : "s"}${pathIndex === 0 && path.ruleIds.length > 8 ? " · consider moving some to an optional path" : ""}</span>
          ${path.ruleIds.length ? `<ol class="path-rows">${path.ruleIds.map((id, ruleIndex) => ruleRow(id, ruleIndex, pathIndex, path.ruleIds.length)).join("")}</ol>` : '<div class="empty-list">No rules on this path yet.</div>'}
          <div class="path-add">
            <select data-path-add="${pathIndex}" aria-label="Rule to add">
              ${unplaced.length ? unplaced.map((rule) => `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.title || rule.id)}</option>`).join("") : '<option value="">Every rule is on a path</option>'}
            </select>
            <button type="button" class="button button-secondary" data-action="lp-rule-add" data-path="${pathIndex}" ${unplaced.length ? "" : "disabled"}>Add to this path</button>
          </div>
        </div>`).join("")}
      <div class="tool-actions"><button type="button" class="button button-secondary" data-action="lp-path-add">+ New learning path</button></div>
      ${unplaced.length ? `<p class="helper">On no path: ${unplaced.map((rule) => escapeHtml(rule.title || rule.id)).join(", ")}. They are still listed under All rules.</p>` : ""}
    </div>`;
}

async function handlePathAction(action, button) {
  const pathIndex = Number(button.dataset.path);
  const ruleIndex = Number(button.dataset.index);
  const swap = (list, from, to) => { if (to >= 0 && to < list.length) [list[from], list[to]] = [list[to], list[from]]; };
  if (action === "lp-reset") pathEditor = savedPaths();
  else if (action === "lp-path-add") pathEditor.push({ key: "", title: "New learning path", description: "", ruleIds: [] });
  else if (action === "lp-path-remove") pathEditor.splice(pathIndex, 1);
  else if (action === "lp-path-up" && pathIndex > 1) swap(pathEditor, pathIndex, pathIndex - 1);
  else if (action === "lp-path-down") swap(pathEditor, pathIndex, pathIndex + 1);
  else if (action === "lp-rule-up") swap(pathEditor[pathIndex].ruleIds, ruleIndex, ruleIndex - 1);
  else if (action === "lp-rule-down") swap(pathEditor[pathIndex].ruleIds, ruleIndex, ruleIndex + 1);
  else if (action === "lp-rule-remove") pathEditor[pathIndex].ruleIds.splice(ruleIndex, 1);
  else if (action === "lp-rule-add") {
    const ruleId = document.querySelector(`[data-path-add="${pathIndex}"]`).value;
    if (ruleId) pathEditor[pathIndex].ruleIds.push(ruleId);
  } else if (action === "lp-save") {
    await api("/api/learning-paths", { method: "POST", body: JSON.stringify({ data: pathEditor }) });
    pathEditor = null;
    await loadState();
    showNotice("Learning paths saved in the local manager. Sync data to publish them.");
    return;
  }
  renderContent();
}

function handlePathInput(target) {
  if (target.dataset.pathField !== undefined) {
    const [index, field] = target.dataset.pathField.split(":");
    pathEditor[Number(index)][field] = target.value;
    return;
  }
  if (target.dataset.pathMove !== undefined) {
    const [from, ruleIndex] = target.dataset.pathMove.split(":").map(Number);
    const to = Number(target.value);
    if (to === from) return;
    const [ruleId] = pathEditor[from].ruleIds.splice(ruleIndex, 1);
    pathEditor[to].ruleIds.push(ruleId);
    renderContent();
  }
}

function listFilterBar(key) {
  const config = collections[key];
  let filters = config.filters;
  if (key === "archive") filters = activePreset === "gates" ? [] : [["type", "All lore", ARCHIVE_TYPES.filter(([value]) => value !== "gate-record")]];
  if (!filters?.length) return "";
  const current = listFilters[key] || {};
  return `<div class="list-filters">${filters.map(([fieldName, allLabel, choices]) => `
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
        <div class="editor-sticky">
        <div class="editor-title">
          <div><h2>${record ? escapeHtml(config.name(record) || `Edit ${singular}`) : `New ${singular}`}</h2><p>${record ? `ID: ${escapeHtml(record.id)}` : "Create a new record"}</p></div>
          <div class="editor-actions">
            ${record ? '<button type="button" class="button button-danger" data-action="delete-record">Delete</button>' : ""}
            <button type="button" class="button button-secondary" data-action="open-preview" title="See this record on the site, including unsaved changes">Preview</button>
            <button type="submit" class="button button-primary">Save ${singular}</button>
          </div>
        </div>
        <nav class="section-jump" data-section-jump hidden aria-label="Form sections"></nav>
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

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("The image could not be read."));
  reader.readAsDataURL(file);
});

// Big images (artwork is often several MB) are scaled to at most 1280px and re-encoded as WebP before upload,
// so pages stay light on phones. Images that are already small, and GIFs, are kept as they are.
const MAX_IMAGE_EDGE = 1280;
async function shrinkImage(file) {
  const original = await readFileAsDataUrl(file);
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 400_000) return original;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL("image/webp", 0.82);
    return webp.startsWith("data:image/webp") && webp.length < original.length ? webp : original;
  } catch {
    return original;
  }
}

async function uploadImage(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const list = input.closest("[data-image-list]");
  for (const file of files) {
    const dataUrl = await shrinkImage(file);
    const result = await api("/api/media", { method: "POST", body: JSON.stringify({ filename: file.name, dataUrl, kind: input.dataset.imageUpload }) });
    if (list) {
      list.querySelector(".image-list").insertAdjacentHTML("beforeend", imageListItem(list.dataset.imageList, result.path));
    } else {
      const control = input.closest("[data-image-control]");
      control.querySelector("[data-image-field]").value = result.path;
      control.querySelector("[data-image-preview]").innerHTML = imagePreview(result.path);
    }
  }
  input.value = "";
  if (preview.open) schedulePreview();
  showNotice(`${files.length > 1 ? `${files.length} images` : "Image"} uploaded. Save the record to keep ${files.length > 1 ? "them" : "it"}.`);
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
  await refreshSyncStatus();
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

  const openView = (view, id = null) => navigateTo(view, id, { remember: true });

  // The sidebar starts a new trail; links inside records remember where you came from.
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
    if (navigateTo(button.dataset.view, null, { preset: button.dataset.preset || "" })) {
      navHistory.length = 0;
      renderBackBar();
    }
  }));
  setupNavGroups();
  document.getElementById("back-bar").addEventListener("click", (event) => { if (event.target.closest("[data-nav-back]")) goBack(); });
  document.getElementById("jump-button").addEventListener("click", openJump);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (jump.open) closeJump(); else openJump();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; }
  });

  document.getElementById("collection-search").addEventListener("input", (event) => {
    if (!confirmLeave()) { event.target.value = filterText; return; }
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
    const jumpLink = event.target.closest("[data-jump-view]");
    if (jumpLink) {
      if (jumpLink.dataset.jumpView === "outpost") activeOutpostTab = "capabilities";
      openView(jumpLink.dataset.jumpView, jumpLink.dataset.jumpId);
      return;
    }
    const sectionJump = event.target.closest("[data-jump-section]");
    if (sectionJump) { jumpToSection(sectionJump.dataset.jumpSection); return; }
    const homeOpen = event.target.closest("[data-home-open]");
    if (homeOpen) {
      navigateTo(homeOpen.dataset.homeOpen, homeOpen.dataset.homeId || null, { preset: homeOpen.dataset.homePreset || "", remember: true });
      return;
    }
    if (event.target.closest("[data-home-sync]")) {
      try { await syncDataToSite(); } catch (error) { showNotice(error.message, true); }
      if (activeView === "home") renderContent();
      return;
    }
    const homeNew = event.target.closest("[data-home-new]");
    if (homeNew) {
      if (navigateTo(homeNew.dataset.homeNew, null, { remember: true })) { draft = true; selectedId = null; renderContent(); }
      return;
    }
    const homeTool = event.target.closest("[data-home-tool]");
    if (homeTool) {
      toolView.tab = homeTool.dataset.homeTool;
      navigateTo("tools", null, { remember: true });
      return;
    }
    if (action?.startsWith("bulk-")) {
      try { await runBulkAction(action.slice(5)); } catch (error) { showNotice(error.message, true); }
      return;
    }
    if (event.target.closest(".bulk-check, [data-bulk-all]")) return;
    const navRecord = event.target.closest("[data-record-id]");
    if (navRecord) {
      if (navRecord.dataset.recordId !== selectedId && !confirmLeave()) return;
      selectedId = navRecord.dataset.recordId;
      draft = false;
      pathEditor = null;
      renderContent();
      return;
    }
    if (action?.startsWith("vocab-")) {
      try { await handleVocabAction(action, actionButton); } catch (error) { showNotice(error.message, true); }
    } else if (action?.startsWith("tool-")) {
      try { await handleToolAction(action, actionButton); } catch (error) { showNotice(error.message, true); }
    } else if (action === "new-record") {
      if (!confirmLeave()) return;
      selectedId = null;
      draft = true;
      pathEditor = null;
      renderContent();
    } else if (action === "path-edit") {
      navigateTo("readingpath", null, { remember: true });
    } else if (action?.startsWith("lp-")) {
      try { await handlePathAction(action, actionButton); } catch (error) { showNotice(error.message, true); }
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
      const control = actionButton.closest("[data-image-control]");
      control.querySelector("[data-image-field]").value = "";
      control.querySelector("[data-image-preview]").innerHTML = imagePreview("");
      if (preview.open) schedulePreview();
    } else if (action === "image-remove" || action === "image-earlier" || action === "image-later") {
      const item = actionButton.closest(".image-list-item");
      if (action === "image-remove") item.remove();
      else if (action === "image-earlier" && item.previousElementSibling) item.previousElementSibling.before(item);
      else if (action === "image-later" && item.nextElementSibling) item.nextElementSibling.after(item);
      if (preview.open) schedulePreview();
    } else if (action === "add-relation") {
      const list = document.getElementById("relation-rows");
      list.insertAdjacentHTML("beforeend", relationRow({}, workArea.querySelector("form")?.dataset.editingId || ""));
      list.lastElementChild.querySelector("select")?.focus();
    } else if (action === "remove-relation") {
      actionButton.closest("[data-relation-row]").remove();
      if (preview.open) schedulePreview();
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
      event.target.closest("[data-image-control]").querySelector("[data-image-preview]").innerHTML = imagePreview(event.target.value.trim());
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
    if (activeView === "readingpath" && event.target.matches("select[data-path-move]")) {
      handlePathInput(event.target);
      return;
    }
    if (activeView === "vocabulary" && event.target.matches("[data-interaction-filter], select[data-interaction-field]")) {
      handleVocabInput(event.target);
      return;
    }
    if (event.target.matches(".bulk-check")) {
      if (event.target.checked) bulkSelection.add(event.target.value); else bulkSelection.delete(event.target.value);
      refreshBulkBar();
      return;
    }
    if (event.target.matches("[data-bulk-all]")) {
      document.querySelectorAll(".bulk-check").forEach((checkbox) => {
        checkbox.checked = event.target.checked;
        if (checkbox.checked) bulkSelection.add(checkbox.value); else bulkSelection.delete(checkbox.value);
      });
      refreshBulkBar();
      return;
    }
    if (event.target.matches("[data-list-status], [data-list-sort]")) {
      if (!confirmLeave()) { renderContent(); return; }
      const options = listOptions(activeView);
      if (event.target.matches("[data-list-status]")) options.status = event.target.value; else options.sort = event.target.value;
      bulkSelection = new Set();
      selectedId = null;
      draft = false;
      renderContent();
      return;
    }
    if (event.target.matches("[data-list-filter]")) {
      if (!confirmLeave()) { renderContent(); return; }
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

  const closeMoreMenu = () => document.querySelector(".more-menu")?.removeAttribute("open");
  document.getElementById("export-button").addEventListener("click", async () => {
    closeMoreMenu();
    try { await exportToSite(); await refreshSyncStatus(); } catch (error) { showNotice(error.message, true); }
  });
  document.getElementById("sync-button").addEventListener("click", async () => {
    try { await syncDataToSite(); } catch (error) { showNotice(error.message, true); }
  });
  document.getElementById("preview-panel").addEventListener("click", (event) => {
    if (event.target.closest("[data-preview-close]")) setPreviewOpen(false);
    else if (event.target.closest("[data-preview-refresh]")) schedulePreview(0);
    else if (event.target.closest("[data-preview-size]")) setPreviewSize(event.target.closest("[data-preview-size]").dataset.previewSize);
  });
  workArea.addEventListener("input", (event) => {
    if (activeView === "vocabulary") handleVocabInput(event.target);
    if (activeView === "readingpath") handlePathInput(event.target);
    if (event.target.matches('[data-stash-quantity], [data-stash-action], [name="carryLimit"]')) updateCarried();
    if (preview.open) schedulePreview();
  });
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
    closeMoreMenu();
    try { await importFromSite(); } catch (error) { showNotice(error.message, true); }
  });
});
