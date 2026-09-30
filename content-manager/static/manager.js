const state = { characters: [], gates: [], expeditions: [], reports: [], rules: [], island: {} };
let activeView = "island";
let selectedId = null;
let draft = false;
let filterText = "";
let activeIslandTab = "profile";
let noticeTimer;

const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const listText = (value) => Array.isArray(value) ? value.join("\n") : (value || "");
const capitalize = (value = "") => value.charAt(0).toUpperCase() + value.slice(1);

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
const gateLabel = (gate) => gate ? [gate.designation, gate.name].filter(Boolean).join(" · ") : "";
const expeditionLabel = (expedition) => expedition ? [expedition.designation, expedition.title].filter(Boolean).join(" · ") : "";
const reportGateId = (report) => findRecord("expeditions", report.expeditionId)?.gateId;
const reportGateText = (expeditionId) => {
  if (!expeditionId) return "Choose an Expedition";
  return gateLabel(findRecord("gates", findRecord("expeditions", expeditionId)?.gateId)) || "No Gate on this Expedition";
};

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
  return `<div class="${className}"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${options.required ? "required" : ""} ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.readOnly ? "readonly" : ""} ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""} />${options.help ? `<span class="helper">${options.help}</span>` : ""}</div>`;
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
    .map((record) => [record.id, `${labelFor(record)}${record.published ? "" : " — unpublished"}`])
    .sort((left, right) => left[1].localeCompare(right[1]));
  if (value && !choices.some(([id]) => id === value)) choices.unshift([value, `Missing record: ${value}`]);
  return selectField(label, name, value || "", choices, { emptyLabel: options.emptyLabel || "— None —", ...options });
}

function participantPicker(selectedIds) {
  const selected = selectedIds.map((id) => findRecord("characters", id)).filter(Boolean);
  const others = [...state.characters].filter((character) => !selectedIds.includes(character.id))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  const options = [...selected, ...others];
  const list = options.length ? options.map((character) => `
    <label class="check-option" data-search="${escapeHtml(characterLabel(character).toLowerCase())}">
      <input class="participant-check" type="checkbox" value="${escapeHtml(character.id)}" ${selectedIds.includes(character.id) ? "checked" : ""} />
      <span>${escapeHtml(characterLabel(character))}${character.published ? "" : " — unpublished"}</span>
    </label>`).join("") : '<div class="empty-list">No characters yet. Create them in the Characters section.</div>';
  return `<div class="field full"><span class="field-label">Participants <span class="participant-count">(${selectedIds.length} selected)</span></span>
    <input type="search" class="reference-filter" data-filter-list="participant-list" placeholder="Filter characters" aria-label="Filter participants" />
    <div class="check-list" id="participant-list">${list}</div>
    <span class="helper">Crew count on the board is the number of participants. Include the organizer here if they are going.</span></div>`;
}

function portraitSource(path) {
  if (!path) return "";
  if (path.startsWith("data/portraits/")) return `/api/media/${encodeURIComponent(path.slice("data/portraits/".length))}`;
  return /^https?:\/\//.test(path) ? path : "";
}

function portraitPreview(path) {
  const source = portraitSource(path);
  if (source) return `<img src="${escapeHtml(source)}" alt="Portrait preview" />`;
  return `<span>${path ? "Preview unavailable for site paths" : "No portrait"}</span>`;
}

function portraitField(value) {
  return `<div class="field full"><label for="field-portrait">Portrait</label>
    <div class="portrait-editor">
      <div class="portrait-preview" id="portrait-preview">${portraitPreview(value)}</div>
      <div class="portrait-controls">
        <input id="field-portrait" name="portrait" type="text" value="${escapeHtml(value || "")}" placeholder="Upload an image, or enter a site path / URL" />
        <div class="portrait-actions">
          <label class="button button-secondary">Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-portrait-upload hidden /></label>
          <button type="button" class="button button-secondary" data-action="clear-portrait">Remove</button>
        </div>
        <span class="helper">Uploaded images are stored in SQLite and published to <code>data/portraits/</code> with the character.</span>
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
    throw new Error("That file is not a Nowhere Expeditions character sheet. Use the file downloaded from the character's public page.");
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

async function importSheetFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const envelope = parseSheetFile(await file.text());
  const form = input.closest("#record-form");
  const currentName = form.querySelector('[name="name"]').value.trim() || "this character";
  if (envelope.characterId && envelope.characterId !== form.dataset.editingId
    && !confirm(`This sheet file belongs to “${envelope.characterName || envelope.characterId}”. Import it into ${currentName} anyway?`)) return;

  const before = readSheet(form);
  document.getElementById("sheet-editor").innerHTML = sheetEditor({ ...normalizeImportedSheet(envelope.sheet), public: before ? before.public : true });
  const changes = describeSheetChanges(before, readSheet(form));
  sheetBeforeImport = before;
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

/* ---------- Content type definitions ---------- */

const collections = {
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
      ${portraitField(record.portrait)}
      ${textarea("Public summary", "summary", record.summary || "", { full: true, help: "A short, player-facing description." })}
      <div class="form-section">Fate Core character sheet</div>
      <div class="field full sheet-import-bar">
        <label class="button button-secondary">Import sheet file<input type="file" accept=".html,.htm,.json,text/html,application/json" data-sheet-import hidden /></label>
        <span class="helper">Load a sheet file a player saved from the public site. You can review the changes before saving.</span>
      </div>
      <div class="field full" id="sheet-import-note" hidden></div>
      <div class="field full" id="sheet-editor">${sheetEditor(record.sheet)}</div>`,
    related: (record) => {
      const history = state.expeditions.filter((expedition) => expedition.organizerId === record.id || expedition.participantIds.includes(record.id));
      const reports = state.reports.filter((report) => report.submittedBy === record.id);
      return `<div class="form-section">Derived history</div>
        ${relatedBlock("Expeditions", history.map((expedition) => `${referenceLink("expeditions", expedition, expeditionLabel(expedition))} <span class="helper">${expedition.organizerId === record.id ? "organizer" : "participant"} · ${expedition.status}</span>`), "Not part of any expedition yet.")}
        ${relatedBlock("Reports submitted", reports.map((report) => referenceLink("reports", report, report.title)), "No reports submitted.")}`;
    },
    read: (formData, form) => ({
      name: formText(formData, "name"), playerName: formText(formData, "playerName"),
      type: formText(formData, "type"), status: formText(formData, "status"),
      portrait: formText(formData, "portrait"), summary: formText(formData, "summary"),
      sheet: readSheet(form)
    })
  },
  gates: {
    title: "Gates", panel: "GATE ARCHIVE", singular: "Gate",
    name: (record) => record.name,
    meta: (record) => [record.designation, record.status],
    idHelp: "Generated from the designation when left blank; used in public page links.",
    fields: (record) => `
      ${field("Designation", "designation", record.designation || "", { required: true, placeholder: "Gate 017" })}
      ${field("Name", "name", record.name || "", { required: true })}
      ${selectField("Status", "status", record.status || "active", enumChoices(["active", "dormant", "collapsed", "lost"]))}
      ${field("Discovered", "discoveredAt", record.discoveredAt || "", { type: "date" })}
      ${textarea("Overview", "overview", record.overview || "", { full: true, help: "What the Island currently knows. Keep GM-only truths out of this record." })}
      ${textarea("Environment", "environment", record.environment || "", { full: true })}
      <div class="form-section">Known information</div>
      ${textarea("Known traits", "knownTraits", listText(record.knownTraits), { help: "One per line." })}
      ${textarea("Known hazards", "knownHazards", listText(record.knownHazards), { help: "One per line." })}
      ${textarea("Known locations", "knownLocations", listText(record.knownLocations), { full: true, help: "One per line. Only locations the Expeditioners have found or heard of." })}`,
    related: (record) => {
      const expeditions = state.expeditions.filter((expedition) => expedition.gateId === record.id);
      const reports = state.reports.filter((report) => reportGateId(report) === record.id);
      return `<div class="form-section">Derived history</div>
        ${relatedBlock("Expeditions to this Gate", expeditions.map((expedition) => `${referenceLink("expeditions", expedition, expeditionLabel(expedition))} <span class="helper">${expedition.status}</span>`), "No expeditions reference this Gate yet.")}
        ${relatedBlock("Reports from those expeditions", reports.map((report) => `${referenceLink("reports", report, report.title)} <span class="helper">${escapeHtml(expeditionLabel(findRecord("expeditions", report.expeditionId)))}</span>`), "None.")}`;
    },
    read: (formData) => ({
      designation: formText(formData, "designation"), name: formText(formData, "name"),
      status: formText(formData, "status"), discoveredAt: formText(formData, "discoveredAt"),
      overview: formText(formData, "overview"), environment: formText(formData, "environment"),
      knownTraits: linesToArray(formData.get("knownTraits")), knownHazards: linesToArray(formData.get("knownHazards")),
      knownLocations: linesToArray(formData.get("knownLocations"))
    })
  },
  expeditions: {
    title: "Expeditions", panel: "EXPEDITION BOARD", singular: "Expedition",
    name: (record) => record.title,
    meta: (record) => [record.designation || gateLabel(findRecord("gates", record.gateId)) || record.type, record.status],
    idHelp: "Generated from the designation (or title) when left blank; used in public page links.",
    fields: (record) => `
      ${field("Title", "title", record.title || "", { required: true, full: true })}
      ${field("Designation", "designation", record.designation || "", { placeholder: "017-C", help: "Optional short code shown in Gate histories." })}
      ${referenceSelect("Gate", "gateId", record.gateId, "gates", gateLabel, { emptyLabel: "— No Gate —" })}
      ${selectField("Type", "type", record.type || "exploration", enumChoices(["exploration", "recovery", "research", "rescue", "other"]))}
      ${selectField("Status", "status", record.status || "recruiting", enumChoices(["recruiting", "scheduled", "underway", "completed", "cancelled"]))}
      ${textarea("Objective", "objective", record.objective || "", { full: true })}
      ${textarea("Briefing", "briefing", record.briefing || "", { full: true, help: "Optional. Do not repeat Gate details here; the public page links to the Gate." })}
      <div class="form-section">Schedule and crew</div>
      ${field("Scheduled", "scheduledAt", record.scheduledAt || "", { type: "datetime-local" })}
      ${field("Expected duration", "expectedDuration", record.expectedDuration || "", { placeholder: "e.g. 3 hours" })}
      ${field("Minimum crew", "crewMin", record.crewMin ?? "", { type: "number", min: 0 })}
      ${field("Maximum crew", "crewMax", record.crewMax ?? "", { type: "number", min: 0 })}
      ${referenceSelect("Organizer", "organizerId", record.organizerId, "characters", characterLabel, { full: true })}
      ${participantPicker(record.participantIds || [])}
      ${textarea("Requirements", "requirements", listText(record.requirements), { full: true, help: "Optional. One per line." })}`,
    related: (record) => {
      const reports = state.reports.filter((report) => report.expeditionId === record.id);
      return `<div class="form-section">Derived history</div>
        ${relatedBlock("Expedition reports", reports.map((report) => `${referenceLink("reports", report, report.title)} <span class="helper">${report.outcome}</span>`), "No reports filed yet.")}`;
    },
    read: (formData, form) => ({
      title: formText(formData, "title"), designation: formText(formData, "designation"),
      gateId: formText(formData, "gateId") || null, type: formText(formData, "type"), status: formText(formData, "status"),
      objective: formText(formData, "objective"), briefing: formText(formData, "briefing"),
      scheduledAt: formText(formData, "scheduledAt"), expectedDuration: formText(formData, "expectedDuration"),
      crewMin: formText(formData, "crewMin"), crewMax: formText(formData, "crewMax"),
      organizerId: formText(formData, "organizerId") || null,
      participantIds: [...form.querySelectorAll(".participant-check:checked")].map((checkbox) => checkbox.value),
      requirements: linesToArray(formData.get("requirements"))
    })
  },
  reports: {
    title: "Expedition Reports", panel: "FIELD REPORTS", singular: "Report",
    name: (record) => record.title,
    meta: (record) => [expeditionLabel(findRecord("expeditions", record.expeditionId)) || "Unassigned", record.submittedAt || "Undated"],
    idHelp: "Generated from the title when left blank.",
    fields: (record) => `
      ${field("Title", "title", record.title || "", { required: true, full: true })}
      ${referenceSelect("Expedition", "expeditionId", record.expeditionId, "expeditions", expeditionLabel, { emptyLabel: "— Choose an Expedition —", required: true })}
      <div class="field"><span class="field-label">Gate</span><span class="derived-value" id="report-gate">${escapeHtml(reportGateText(record.expeditionId))}</span><span class="helper">Taken from the Expedition.</span></div>
      ${referenceSelect("Submitted by", "submittedBy", record.submittedBy, "characters", characterLabel)}
      ${field("Submitted", "submittedAt", record.submittedAt || "", { type: "date" })}
      ${selectField("Outcome", "outcome", record.outcome || "unknown", enumChoices(["success", "partial", "failed", "aborted", "unknown"]))}
      ${textarea("Summary", "summary", record.summary || "", { full: true })}
      <div class="form-section">Findings</div>
      ${textarea("Discoveries", "discoveries", listText(record.discoveries), { help: "One per line." })}
      ${textarea("Hazards encountered", "hazards", listText(record.hazards), { help: "One per line." })}
      ${textarea("Recovered items", "recoveredItems", listText(record.recoveredItems), { help: "One per line." })}
      ${textarea("Casualties", "casualties", listText(record.casualties), { help: "One per line." })}
      ${textarea("Notes", "notes", record.notes || "", { full: true, rows: 7 })}`,
    read: (formData) => ({
      title: formText(formData, "title"), expeditionId: formText(formData, "expeditionId") || null,
      submittedBy: formText(formData, "submittedBy") || null, submittedAt: formText(formData, "submittedAt"),
      outcome: formText(formData, "outcome"), summary: formText(formData, "summary"),
      discoveries: linesToArray(formData.get("discoveries")), hazards: linesToArray(formData.get("hazards")),
      recoveredItems: linesToArray(formData.get("recoveredItems")), casualties: linesToArray(formData.get("casualties")),
      notes: formText(formData, "notes")
    })
  },
  rules: {
    title: "Campaign Rules", panel: "CAMPAIGN RULES", singular: "Rule",
    name: (record) => record.title,
    meta: (record) => [record.category || "Uncategorized"],
    idHelp: "Generated from the title when left blank.",
    fields: (record) => {
      const categories = ["Campaign", "Expeditions", "Island", "Information"];
      if (record.category && !categories.includes(record.category)) categories.push(record.category);
      return `
      ${field("Title", "title", record.title || "", { required: true, full: true })}
      ${selectField("Category", "category", record.category || "Campaign", categories.map((category) => [category, category]), { required: true })}
      ${textarea("Short summary", "summary", record.summary || "", { full: true })}
      ${textarea("Rule details", "details", record.details || "", { full: true, rows: 8 })}
      ${textarea("Search tags", "tags", listText(record.tags), { full: true, help: "One tag per line. These terms are included in public search." })}`;
    },
    read: (formData) => ({
      title: formText(formData, "title"), category: formText(formData, "category"),
      summary: formText(formData, "summary"), details: formText(formData, "details"),
      tags: linesToArray(formData.get("tags"))
    })
  }
};

/* ---------- Rendering ---------- */

async function loadState() {
  const loaded = await api("/api/state");
  for (const key of Object.keys(collections)) state[key] = loaded[key] || [];
  state.island = loaded.island || {};
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
  document.getElementById("page-title").textContent = activeView === "island" ? "Island Sheet" : collections[activeView].title;
  document.getElementById("search-wrap").hidden = activeView === "island";
  document.getElementById("collection-search").value = filterText;
}

function filteredRecords(key) {
  const config = collections[key];
  const query = filterText.trim().toLowerCase();
  return state[key]
    .filter((record) => !query || JSON.stringify(record).toLowerCase().includes(query))
    .sort((left, right) => String(config.name(left) || "").localeCompare(String(config.name(right) || "")));
}

function renderContent() {
  if (activeView === "island") renderIslandEditor();
  else renderCollection(activeView);
}

function renderCollection(key) {
  const config = collections[key];
  const items = filteredRecords(key);
  const selected = draft ? null : items.find((record) => record.id === selectedId) || items[0] || null;
  if (!draft) selectedId = selected?.id || null;
  const listMarkup = items.length ? items.map((record) => `
    <button type="button" class="record-button ${selected?.id === record.id ? "active" : ""}" data-record-id="${escapeHtml(record.id)}">
      <span class="record-name">${escapeHtml(config.name(record) || "Untitled")}</span>
      <span class="record-meta">${config.meta(record).filter(Boolean).map((part, index, parts) => `<span class="${index === parts.length - 1 ? "record-status" : ""}">${escapeHtml(part)}</span>`).join("")}${record.published ? "" : '<span class="record-draft">Unpublished</span>'}</span>
    </button>
  `).join("") : '<div class="empty-list">No matching records yet.</div>';
  const editor = draft ? recordForm(key, null) : selected ? recordForm(key, selected) : `
    <div class="editor-content"><div class="empty-list">Choose a record to edit, or create a new ${config.singular.toLowerCase()}.</div></div>`;

  document.getElementById("work-area").innerHTML = `
    <div class="collection-layout">
      <section class="record-list-panel" aria-label="${config.title} list">
        <div class="panel-head"><h2>${config.panel}</h2><button class="button button-secondary" type="button" data-action="new-record">+ New</button></div>
        <div class="record-list">${listMarkup}</div>
      </section>
      <section class="editor-panel" aria-label="${config.singular} editor">${editor}</section>
    </div>`;
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
            <button type="submit" class="button button-primary">Save ${singular}</button>
          </div>
        </div>
        <div class="form-grid">
          <label class="publish-toggle field full"><input type="checkbox" name="published" ${published ? "checked" : ""} /><span><strong>Published</strong><span class="helper">When unchecked, Sync data and Export to site leave this record out of the public site.</span></span></label>
          ${record ? "" : field("ID / URL slug", "recordId", "", { full: true, help: `Optional. ${config.idHelp} It cannot be changed later.` })}
          ${config.fields(record || {})}
          ${record && config.related ? config.related(record) : ""}
        </div>
        <div class="editor-footer"><span class="helper">Saving updates the local SQLite database. Sync data or Export to site to publish.</span><button type="submit" class="button button-primary">Save ${singular}</button></div>
      </div>
    </form>`;
}

/* ---------- Island Sheet ---------- */

const islandArraySchemas = [
  {
    key: "capabilities", title: "Capabilities", singular: "Capability",
    help: "Island ratings and how Expeditioners can use them.",
    defaultItem: { name: "", rating: "+0", summary: "", detail: "", use: "", assets: "", conditions: "" },
    fields: [
      ["name", "Name", "text"], ["rating", "Rating", "text"],
      ["summary", "Current meaning", "textarea", true], ["detail", "What it represents", "textarea", true],
      ["use", "How players use it", "textarea", true], ["assets", "Contributing assets", "textarea", true],
      ["conditions", "Relevant conditions", "textarea", true]
    ]
  },
  {
    key: "consequences", title: "Consequences", singular: "Consequence",
    help: "Active Island consequences and their severity.",
    defaultItem: { name: "", severity: "Low", detail: "" },
    fields: [["name", "Name", "text"], ["severity", "Severity", "select"], ["detail", "Details", "textarea", true]]
  },
  {
    key: "facilities", title: "Facilities", singular: "Facility",
    help: "Completed facilities available to the Island.",
    defaultItem: { name: "", summary: "" },
    fields: [["name", "Name", "text"], ["summary", "Description", "textarea", true]]
  },
  {
    key: "activeProjects", title: "Active projects", singular: "Project",
    help: "Projects, progress tracks, and the effect recorded when complete.",
    defaultItem: { name: "", summary: "", progress: { current: 0, max: 4 }, completion: null },
    fields: [
      ["name", "Name", "text"], ["summary", "Description", "textarea", true],
      ["progress.current", "Marked progress", "number"], ["progress.max", "Maximum boxes", "number"],
      ["completion.summary", "Completion effect", "textarea", true]
    ]
  },
  {
    key: "conditions", title: "Persistent conditions", singular: "Condition",
    help: "Ongoing conditions affecting the Island.",
    defaultItem: { name: "", summary: "" },
    fields: [["name", "Name", "text"], ["summary", "Description", "textarea", true]]
  }
];

function islandNestedField(schema, index, [path, label, type, full = false], item) {
  const id = `island-${schema.key}-${index}-${path.replace(/[^a-z0-9]+/gi, "-")}`;
  const value = path.split(".").reduce((current, key) => current?.[key], item) ?? "";
  const className = full ? "nested-field full" : "nested-field";
  const required = path === "name" ? "required" : "";
  if (type === "textarea") {
    return `<div class="${className}"><label for="${id}">${label}</label><textarea id="${id}" data-island-path="${path}" ${required}>${escapeHtml(value)}</textarea></div>`;
  }
  if (type === "select") {
    const levels = ["Low", "Moderate", "High", "Critical"];
    return `<div class="${className}"><label for="${id}">${label}</label><select id="${id}" data-island-path="${path}">${levels.map((level) => `<option value="${level}" ${value === level ? "selected" : ""}>${level}</option>`).join("")}</select></div>`;
  }
  const numberAttributes = type === "number" ? `min="${path === "progress.max" ? "1" : "0"}" step="1"` : "";
  return `<div class="${className}"><label for="${id}">${label}</label><input id="${id}" type="${type}" data-island-path="${path}" value="${escapeHtml(value)}" ${numberAttributes} ${required} /></div>`;
}

function renderIslandArrayEditor(schema, items, startIndex = 0) {
  const cards = items.map((item, index) => {
    const recordIndex = startIndex + index;
    const recordKey = `${recordIndex}-${Math.random().toString(36).slice(2)}`;
    return `
    <article class="nested-record" data-original="${escapeHtml(JSON.stringify(item))}">
      <header class="nested-record-head">
        <span>${schema.singular} ${recordIndex + 1}</span>
        <button class="remove-record" type="button" data-action="remove-island-record" aria-label="Remove ${schema.singular.toLowerCase()} ${recordIndex + 1}" title="Remove ${schema.singular.toLowerCase()}">×</button>
      </header>
      <div class="nested-record-grid">${schema.fields.map((fieldDefinition) => islandNestedField(schema, recordKey, fieldDefinition, item)).join("")}</div>
    </article>
  `;
  }).join("");

  return `
    <section class="island-panel">
      <div class="island-panel-head"><div><h2>${schema.title}</h2><p class="island-section-caption">${schema.help}</p></div>
        <button class="button button-secondary" type="button" data-action="add-island-record" data-array-key="${schema.key}">+ Add ${schema.singular.toLowerCase()}</button>
      </div>
      <div class="nested-record-list" data-array-key="${schema.key}">${cards || `<p class="nested-empty">No ${schema.title.toLowerCase()} recorded.</p>`}</div>
    </section>`;
}

function readNestedRecords(form, schema) {
  return [...form.querySelectorAll(`.nested-record-list[data-array-key="${schema.key}"] .nested-record`)].map((record) => {
    const item = JSON.parse(record.dataset.original || "{}");
    for (const control of record.querySelectorAll("[data-island-path]")) {
      const path = control.dataset.islandPath;
      const value = control.type === "number" ? Number(control.value) : control.value.trim();
      if (path === "completion.summary") {
        item.completion = value ? { ...(item.completion || {}), summary: value } : null;
        continue;
      }
      const parts = path.split(".");
      const property = parts.pop();
      const target = parts.reduce((current, key) => {
        if (!current[key] || typeof current[key] !== "object") current[key] = {};
        return current[key];
      }, item);
      target[property] = value;
    }
    if (schema.key === "activeProjects") {
      const current = item.progress?.current ?? 0;
      const max = item.progress?.max ?? 4;
      if (max < 1 || current < 0 || current > max) {
        throw new Error(`Project "${item.name || "Untitled"}" needs progress between zero and its maximum.`);
      }
    }
    return item;
  });
}

function renderIslandEditor() {
  const island = state.island || {};
  const stress = island.stress || {};
  const tabs = [
    ["profile", "Profile"],
    ["stress", "Stress"],
    ...islandArraySchemas.map((schema) => [schema.key, schema.title])
  ];
  if (!tabs.some(([key]) => key === activeIslandTab)) activeIslandTab = "profile";
  const renderTabPanel = (key, content) => `
    <div id="island-panel-${key}" class="island-tab-panel" data-island-panel role="tabpanel" tabindex="0" aria-labelledby="island-tab-${key}" ${activeIslandTab === key ? "" : "hidden"}>${content}</div>`;

  document.getElementById("work-area").innerHTML = `
    <form id="island-form" class="island-layout">
      <header class="island-editor-head">
        <div><h2>Island Sheet</h2><p>Manage profile, stress, capabilities, and current Island records.</p></div>
        <button type="submit" class="button button-primary">Save Island Sheet</button>
      </header>
      <div class="island-tabs" role="tablist" aria-label="Island Sheet sections">
        ${tabs.map(([key, label]) => `<button id="island-tab-${key}" class="island-tab" type="button" role="tab" data-island-tab="${key}" aria-controls="island-panel-${key}" aria-selected="${activeIslandTab === key}" tabindex="${activeIslandTab === key ? "0" : "-1"}">${label}</button>`).join("")}
      </div>
      ${renderTabPanel("profile", `
        <section class="island-panel">
          <h2>Island profile</h2>
          <div class="island-fields">
            ${field("Name", "name", island.name || "The Island", { required: true })}
            ${field("High Concept", "highConcept", island.highConcept || "", { required: true })}
            ${textarea("Trouble", "trouble", island.trouble || "", { full: true })}
            ${textarea("Aspects", "aspects", listText(island.aspects), { full: true, help: "One aspect per line." })}
          </div>
        </section>
      `)}
      ${renderTabPanel("stress", `
        <section class="island-panel">
          <h2>Stress track</h2>
          <p class="island-section-caption">Set the current marked boxes and the Island’s total stress capacity.</p>
          <div class="stress-fields">
            ${field("Marked stress", "stressCurrent", stress.current ?? 0, { type: "number", min: 0, required: true })}
            ${field("Maximum boxes", "stressMax", stress.max ?? 6, { type: "number", min: 1, required: true })}
          </div>
        </section>
      `)}
      ${islandArraySchemas.map((schema) => renderTabPanel(schema.key, renderIslandArrayEditor(schema, island[schema.key] || []))).join("")}
      <div class="island-save-note">These structured fields are saved in the public Island Sheet format. Export separately to update the static site.</div>
    </form>`;
}

/* ---------- Saving ---------- */

async function saveRecord(form) {
  const key = form.dataset.collection;
  const config = collections[key];
  const formData = new FormData(form);
  const existing = findRecord(key, form.dataset.editingId);
  const data = { ...config.read(formData, form), published: form.elements.published.checked };
  if (!existing && formText(formData, "recordId")) data.id = formText(formData, "recordId");
  const result = existing
    ? await api(`/api/${key}/${encodeURIComponent(existing.id)}`, { method: "PUT", body: JSON.stringify({ data }) })
    : await api(`/api/${key}`, { method: "POST", body: JSON.stringify({ data }) });
  selectedId = result.id;
  draft = false;
  await loadState();
  showNotice(`${config.name(data) || config.singular} saved in the local manager${data.published ? "" : " (unpublished)"}.`);
}

async function saveIsland(form) {
  const formData = new FormData(form);
  const island = {
    ...state.island,
    name: String(formData.get("name") || "").trim(),
    highConcept: String(formData.get("highConcept") || "").trim(),
    trouble: String(formData.get("trouble") || "").trim(),
    aspects: linesToArray(String(formData.get("aspects") || "")),
    stress: {
      ...(state.island.stress || {}),
      current: Number(formData.get("stressCurrent")),
      max: Number(formData.get("stressMax"))
    }
  };
  for (const schema of islandArraySchemas) {
    island[schema.key] = readNestedRecords(form, schema);
  }
  if (island.stress.current < 0 || island.stress.max < 1 || island.stress.current > island.stress.max) {
    throw new Error("Stress must be between zero and the maximum box count.");
  }
  await api("/api/island", { method: "POST", body: JSON.stringify({ data: island }) });
  await loadState();
  showNotice("Island Sheet saved in the local manager.");
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

async function uploadPortrait(input) {
  const file = input.files?.[0];
  if (!file) return;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
  const result = await api("/api/media", { method: "POST", body: JSON.stringify({ filename: file.name, dataUrl }) });
  document.getElementById("field-portrait").value = result.path;
  document.getElementById("portrait-preview").innerHTML = portraitPreview(result.path);
  showNotice("Portrait uploaded. Save the character to keep it.");
}

const publishSummary = (result) => `${result.characters} characters, ${result.gates} Gates, ${result.expeditions} expeditions, ${result.reports} reports, ${result.rules} rules${result.unpublished ? `; ${result.unpublished} unpublished records left out` : ""}`;

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
    const islandTab = event.target.closest("[data-island-tab]");
    if (islandTab) {
      activeIslandTab = islandTab.dataset.islandTab;
      document.querySelectorAll("[data-island-tab]").forEach((button) => {
        const selected = button === islandTab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      document.querySelectorAll("[data-island-panel]").forEach((panel) => {
        panel.hidden = panel.id !== `island-panel-${activeIslandTab}`;
      });
      return;
    }
    if (action === "add-island-record") {
      const schema = islandArraySchemas.find((item) => item.key === actionButton.dataset.arrayKey);
      const list = actionButton.closest(".island-panel").querySelector(".nested-record-list");
      if (schema && list) {
        list.querySelector(".nested-empty")?.remove();
        const markup = renderIslandArrayEditor(schema, [schema.defaultItem], list.querySelectorAll(".nested-record").length);
        const temporary = document.createElement("div");
        temporary.innerHTML = markup;
        list.append(temporary.querySelector(".nested-record"));
      }
      return;
    }
    if (action === "remove-island-record") {
      const panel = actionButton.closest(".island-panel");
      actionButton.closest(".nested-record")?.remove();
      if (!panel.querySelector(".nested-record")) {
        const list = panel.querySelector(".nested-record-list");
        list.innerHTML = `<p class="nested-empty">No ${panel.querySelector("h2").textContent.toLowerCase()} recorded.</p>`;
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
      const note = document.getElementById("sheet-import-note");
      note.hidden = true;
      note.innerHTML = "";
      showNotice("Import undone. The sheet is back to how it was before the import.");
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
    } else if (action === "delete-record") {
      try { await deleteSelected(); } catch (error) { showNotice(error.message, true); }
    } else if (action === "clear-portrait") {
      document.getElementById("field-portrait").value = "";
      document.getElementById("portrait-preview").innerHTML = portraitPreview("");
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
    if (event.target.id === "field-portrait") {
      document.getElementById("portrait-preview").innerHTML = portraitPreview(event.target.value.trim());
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
    if (event.target.matches("[data-portrait-upload]")) {
      try { await uploadPortrait(event.target); } catch (error) { showNotice(error.message, true); }
      event.target.value = "";
    }
    const form = event.target.closest("#record-form");
    if (form?.dataset.collection === "reports" && event.target.name === "expeditionId") {
      document.getElementById("report-gate").textContent = reportGateText(event.target.value);
    }
  });

  workArea.addEventListener("keydown", (event) => {
    const currentTab = event.target.closest("[data-island-tab]");
    if (!currentTab) return;
    const tabButtons = [...document.querySelectorAll("[data-island-tab]")];
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
      else if (event.target.matches("#island-form")) await saveIsland(event.target);
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
  document.getElementById("import-button").addEventListener("click", async () => {
    try { await importFromSite(); } catch (error) { showNotice(error.message, true); }
  });
});
