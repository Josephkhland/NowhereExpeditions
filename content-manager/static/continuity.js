/* ---------- Continuity: discrepancies between pieces of content, resolved one at a time ----------

   An issue quotes two or more "sides": exact excerpts anchored to a text field of a record (or a free note, such as
   what a canon packet says). Resolving works like a merge conflict: each anchored side shows its excerpt in context
   with an editable replacement, and "Apply edits" rewrites every changed excerpt in its record at once. The server
   keeps the before/after text, so a resolution can be undone. Issues never reach the public site.

   Loaded before manager.js; everything here runs only after the manager has started. */

const ISSUE_STATUS_LABELS = { open: "Open", deferred: "Deferred", resolved: "Resolved", dismissed: "Dismissed" };
const ISSUE_RESOLUTION_LABELS = {
  edited: "Resolved by editing the text", intentional: "Kept as is: intentional", handled: "Fixed elsewhere",
  deferred: "Deferred", dismissed: "Dismissed", reopened: "Reopened",
};
const ANCHOR_PROBLEMS = {
  stale: "This text is no longer in the record: it was changed somewhere else. Edit the issue to quote the current text, or resolve it as fixed elsewhere.",
  "missing-record": "The record this side quotes no longer exists.",
  "missing-field": "That field no longer holds text on this record.",
};
// Fields that are bookkeeping, not authored text.
const ISSUE_SKIP_FIELDS = new Set(["id", "published", "sample", "updatedAt", "type", "legacy"]);

const issueView = { status: "open", severity: "", category: "", query: "", editing: null, prefill: null, dirty: false };
let lastTextField = null;

const issueRecordLabel = (collection, id) => {
  const record = collection && findRecord(collection, id);
  return record ? collections[collection]?.name(record) || id : id || "";
};
const issueCollectionLabel = (collection) => collection === "archive" ? "Archive" : collections[collection]?.title || collection;
const sideTitle = (side, index) => side.label || `Side ${index + 1}`;
const issueById = (id) => (state.issues || []).find((issue) => issue.id === id);
const openIssueCount = () => (state.issues || []).filter((issue) => issue.status === "open").length;
const issuesForRecord = (collection, id) => (state.issues || [])
  .filter((issue) => issue.status === "open" && issue.sides.some((side) => side.collection === collection && side.recordId === id));

// Every text value in a record, as a field path ("content", "details.environment", "relations.0.text").
function textPaths(record, prefix = "", depth = 0) {
  if (!record || depth > 4) return [];
  return Object.entries(record).flatMap(([key, value]) => {
    if (!prefix && ISSUE_SKIP_FIELDS.has(key)) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return value.trim() ? [path] : [];
    if (value && typeof value === "object") return textPaths(value, path, depth + 1);
    return [];
  });
}
const valueAt = (record, path) => path.split(".").reduce((value, part) => value == null ? undefined : value[part], record);

/* ---------- List ---------- */

function filteredIssues() {
  const query = issueView.query.trim().toLowerCase();
  const severityRank = { critical: 0, major: 1, minor: 2 };
  return (state.issues || [])
    .filter((issue) => issueView.status === "all" || issue.status === issueView.status)
    .filter((issue) => !issueView.severity || issue.severity === issueView.severity)
    .filter((issue) => !issueView.category || issue.category === issueView.category)
    .filter((issue) => !query || JSON.stringify([issue.title, issue.summary, issue.sides.map((side) => [side.label, side.excerpt, side.recordId])]).toLowerCase().includes(query))
    .sort((left, right) => (severityRank[left.severity] - severityRank[right.severity]) || left.title.localeCompare(right.title));
}

const issueProblems = (issue) => issue.sides.filter((side) => ANCHOR_PROBLEMS[side.anchor?.state]).length;

function issueList(items, selected) {
  if (!items.length) return `<div class="empty-list">${(state.issues || []).length ? "No issues match these filters." : "No continuity issues recorded yet."}</div>`;
  return items.map((issue) => `
    <button type="button" class="record-button issue-row ${selected?.id === issue.id ? "active" : ""}" data-issue-id="${escapeHtml(issue.id)}">
      <span class="record-name">${escapeHtml(issue.title)}</span>
      <span class="record-meta"><span class="severity-chip severity-${issue.severity}">${escapeHtml(capitalize(issue.severity))}</span><span>${escapeHtml(humanize(issue.category))}</span>
        ${issueView.status === "all" ? `<span>${escapeHtml(ISSUE_STATUS_LABELS[issue.status])}</span>` : ""}
        ${issueProblems(issue) ? '<span class="record-draft">Out of date</span>' : ""}</span>
    </button>`).join("");
}

function issueFilters() {
  const vocabulary = state.vocabulary;
  const options = (values, selected, all) => `<option value="">${all}</option>${values.map((value) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(humanize(value))}</option>`).join("")}`;
  const count = (status) => (state.issues || []).filter((issue) => status === "all" || issue.status === status).length;
  return `<div class="issue-filters">
    <input type="search" data-issue-filter="query" value="${escapeHtml(issueView.query)}" placeholder="Search issues" aria-label="Search issues" />
    <select data-issue-filter="status" aria-label="Status">${["open", "deferred", "resolved", "dismissed", "all"].map((status) =>
      `<option value="${status}" ${status === issueView.status ? "selected" : ""}>${status === "all" ? "All" : ISSUE_STATUS_LABELS[status]} (${count(status)})</option>`).join("")}</select>
    <select data-issue-filter="severity" aria-label="Severity">${options(vocabulary.issueSeverities || [], issueView.severity, "Any severity")}</select>
    <select data-issue-filter="category" aria-label="Category">${options(vocabulary.issueCategories || [], issueView.category, "Any category")}</select>
  </div>`;
}

function renderIssues() {
  const items = filteredIssues();
  const editing = issueView.editing;
  const selected = editing === "new" ? null : issueById(selectedId) || (editing ? null : items[0]) || null;
  if (editing !== "new") selectedId = selected?.id || null;
  let detail;
  if (editing === "new") detail = issueForm(null);
  else if (editing && selected) detail = issueForm(selected);
  else if (selected) detail = issueDetail(selected);
  else detail = `<div class="editor-content"><div class="empty-list">Record a discrepancy with <strong>+ New</strong>, or flag one from any record with <strong>⚑ Flag issue</strong>.</div></div>`;
  document.getElementById("work-area").innerHTML = `
    <div class="collection-layout">
      <section class="record-list-panel" aria-label="Continuity issues">
        <div class="panel-head"><h2>CONTINUITY ISSUES</h2><button class="button button-secondary" type="button" data-action="issue-new">+ New</button></div>
        ${issueFilters()}
        <div class="record-list">${issueList(items, selected)}</div>
      </section>
      <section class="editor-panel" aria-label="Issue">${detail}</section>
    </div>`;
  issueView.dirty = false;
}

/* ---------- Resolving ---------- */

function sideContext(side) {
  const anchor = side.anchor || {};
  return `<div class="conflict-context">${anchor.clippedBefore ? "…" : ""}${escapeHtml(anchor.before || "")}<mark>${escapeHtml(side.excerpt)}</mark>${escapeHtml(anchor.after || "")}${anchor.clippedAfter ? "…" : ""}</div>`;
}

function sidePanel(issue, side, index, editable) {
  const anchor = side.anchor || { state: "note" };
  const where = side.collection
    ? `<button type="button" class="related-link" data-jump-view="${escapeHtml(side.collection)}" data-jump-id="${escapeHtml(side.recordId)}">${escapeHtml(issueRecordLabel(side.collection, side.recordId))}</button>
       <span class="helper">${escapeHtml(issueCollectionLabel(side.collection))} · ${escapeHtml(side.field)}</span>`
    : '<span class="helper">Note (not tied to a record)</span>';
  let body;
  if (anchor.state === "note") body = `<blockquote class="conflict-note">${escapeHtml(side.excerpt)}</blockquote>`;
  else if (ANCHOR_PROBLEMS[anchor.state]) body = `<blockquote class="conflict-note">${escapeHtml(side.excerpt)}</blockquote><p class="conflict-problem">${escapeHtml(ANCHOR_PROBLEMS[anchor.state])}</p>`;
  else {
    body = sideContext(side);
    if (anchor.state === "ambiguous") body += `<p class="conflict-problem">This text appears ${anchor.count} times in the field, so it can't be replaced safely. Edit the issue to quote a longer, unique passage.</p>`;
    else if (editable) body += `
      <label class="field conflict-edit"><span>Replace the highlighted text with</span>
        <textarea rows="${Math.min(10, Math.max(3, Math.ceil(side.excerpt.length / 70)))}" data-side-text="${index}">${escapeHtml(side.excerpt)}</textarea></label>
      <div class="conflict-side-actions">
        <button type="button" class="button button-secondary" data-action="issue-side-reset" data-side="${index}">Reset</button>
        <button type="button" class="button button-secondary" data-action="issue-side-copy" data-side="${index}" title="Put this side's text into every other side's replacement">Use this wording on every side</button>
        <span class="helper" data-side-state="${index}">Unchanged</span>
      </div>`;
  }
  return `<section class="conflict-side anchor-${anchor.state}" data-side="${index}">
    <header><strong>${escapeHtml(sideTitle(side, index))}</strong><span class="conflict-where">${where}</span></header>
    ${body}
  </section>`;
}

function resolutionSummary(issue) {
  const resolution = issue.resolution;
  if (!resolution) return "";
  const when = new Date(resolution.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const edits = (resolution.edits || []).map((edit) => `
    <li><span class="helper">${escapeHtml(sideTitle(issue.sides[edit.side] || {}, edit.side))} · ${escapeHtml(issueRecordLabel(edit.collection, edit.recordId))} · ${escapeHtml(edit.field)}</span>
      <div class="conflict-diff"><del>${escapeHtml(edit.before)}</del><ins>${escapeHtml(edit.after)}</ins></div></li>`).join("");
  return `<div class="resolve-panel is-settled">
    <h3>${escapeHtml(ISSUE_RESOLUTION_LABELS[resolution.kind] || capitalize(resolution.kind))} <span class="helper">${escapeHtml(when)}</span></h3>
    ${resolution.note ? `<p>${escapeHtml(resolution.note)}</p>` : ""}
    ${edits ? `<ul class="conflict-diffs">${edits}</ul>` : ""}
    <div class="resolve-actions">
      <button type="button" class="button button-secondary" data-action="issue-reopen">Reopen</button>
      ${(resolution.edits || []).length ? '<button type="button" class="button button-danger" data-action="issue-undo">Undo the edits and reopen</button>' : ""}
    </div>
  </div>`;
}

function issueDetail(issue) {
  const editable = issue.status === "open" || issue.status === "deferred";
  const history = (issue.history || []).slice().reverse();
  return `<div class="editor-content issue-detail" data-issue="${escapeHtml(issue.id)}">
    <div class="editor-title">
      <div><h2>${escapeHtml(issue.title)}</h2>
        <p><span class="severity-chip severity-${issue.severity}">${escapeHtml(capitalize(issue.severity))}</span> ${escapeHtml(humanize(issue.category))} · ${escapeHtml(ISSUE_STATUS_LABELS[issue.status])}</p></div>
      <div class="editor-actions">
        <button type="button" class="button button-danger" data-action="issue-delete">Delete</button>
        <button type="button" class="button button-secondary" data-action="issue-edit">Edit issue</button>
      </div>
    </div>
    ${issue.summary ? `<div class="issue-summary">${issue.summary.split(/\n\s*\n/).map((block) => `<p>${escapeHtml(block)}</p>`).join("")}</div>` : ""}
    ${issue.suggestion ? `<div class="issue-suggestion"><strong>Suggested resolution</strong><p>${escapeHtml(issue.suggestion)}</p></div>` : ""}
    <div class="conflict-grid">${issue.sides.map((side, index) => sidePanel(issue, side, index, editable)).join("")}</div>
    ${editable ? `<div class="resolve-panel">
      <label class="field"><span>Resolution note <span class="helper">(optional: why it was settled this way)</span></span><textarea rows="2" data-issue-note></textarea></label>
      <div class="resolve-actions">
        <button type="button" class="button button-primary" data-action="issue-apply" disabled>Apply edits and resolve</button>
        <button type="button" class="button button-secondary" data-action="issue-resolve" data-kind="intentional" title="Both texts stay as they are; the difference is deliberate">Keep as is (intentional)</button>
        <button type="button" class="button button-secondary" data-action="issue-resolve" data-kind="handled" title="Already fixed by editing the records directly">Fixed elsewhere</button>
        ${issue.status === "deferred" ? "" : '<button type="button" class="button button-secondary" data-action="issue-resolve" data-kind="deferred">Defer</button>'}
        <button type="button" class="button button-secondary" data-action="issue-resolve" data-kind="dismissed" title="Not a real problem">Dismiss</button>
      </div>
      <p class="helper">Apply edits replaces each highlighted passage with your text in its record, all at once (nothing is saved if any side has gone out of date). The old text is kept, so you can undo. Published records change on the site at the next Sync.</p>
    </div>` : resolutionSummary(issue)}
    ${history.length ? `<details class="issue-history"><summary>History (${history.length})</summary><ul>${history.map((event) =>
      `<li><strong>${escapeHtml(ISSUE_RESOLUTION_LABELS[event.kind] || event.kind)}</strong> <span class="helper">${escapeHtml(new Date(event.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}${event.edits?.length ? ` · ${event.edits.length} edit${event.edits.length === 1 ? "" : "s"}` : ""}${event.undone ? ` · ${event.undone} undone` : ""}</span>${event.note ? ` — ${escapeHtml(event.note)}` : ""}</li>`).join("")}</ul></details>` : ""}
  </div>`;
}

function refreshSideStates() {
  const issue = issueById(selectedId);
  if (!issue) return;
  let changed = 0;
  document.querySelectorAll("[data-side-text]").forEach((box) => {
    const index = Number(box.dataset.sideText);
    const edited = box.value !== issue.sides[index].excerpt;
    changed += edited ? 1 : 0;
    box.closest(".conflict-side").classList.toggle("is-edited", edited);
    const label = document.querySelector(`[data-side-state="${index}"]`);
    if (label) label.textContent = edited ? "Will be replaced" : "Unchanged";
  });
  const apply = document.querySelector('[data-action="issue-apply"]');
  if (apply) {
    apply.disabled = !changed;
    apply.textContent = changed ? `Apply ${changed} edit${changed === 1 ? "" : "s"} and resolve` : "Apply edits and resolve";
  }
  issueView.dirty = changed > 0 || Boolean(document.querySelector("[data-issue-note]")?.value.trim());
}

async function afterIssueChange(message, id = selectedId) {
  await loadState();
  selectedId = id;
  issueView.editing = null;
  renderContent();
  showNotice(message);
}

/* ---------- Creating and editing ---------- */

function collectionOptions(selected) {
  return `<option value="">Note: not tied to a record</option>${Object.keys(collections).map((key) =>
    `<option value="${key}" ${key === selected ? "selected" : ""}>${escapeHtml(issueCollectionLabel(key))}</option>`).join("")}`;
}

function recordOptions(collection, selected) {
  if (!collection) return "";
  return `<option value="">Choose a record…</option>${(state[collection] || []).map((record) =>
    `<option value="${escapeHtml(record.id)}" ${record.id === selected ? "selected" : ""}>${escapeHtml(collections[collection].name(record) || record.id)}</option>`).join("")}`;
}

function fieldOptions(collection, recordId) {
  const record = collection && recordId ? findRecord(collection, recordId) : null;
  return record ? textPaths(record).map((path) => `<option value="${escapeHtml(path)}"></option>`).join("") : "";
}

let sideRowCounter = 0;
function sideRow(side = {}) {
  const row = sideRowCounter++;
  return `<div class="issue-side-row" data-side-row>
    <div class="issue-side-grid">
      <label class="field"><span>Label</span><input data-side-field="label" value="${escapeHtml(side.label || "")}" placeholder="e.g. Faction page" /></label>
      <label class="field"><span>Where</span><select data-side-field="collection">${collectionOptions(side.collection || "")}</select></label>
      <label class="field" ${side.collection ? "" : "hidden"} data-side-anchored><span>Record</span><select data-side-field="recordId">${recordOptions(side.collection, side.recordId)}</select></label>
      <label class="field" ${side.collection ? "" : "hidden"} data-side-anchored><span>Field</span><input data-side-field="field" list="side-fields-${row}" value="${escapeHtml(side.field || "")}" placeholder="content" />
        <datalist id="side-fields-${row}" data-side-fields>${fieldOptions(side.collection, side.recordId)}</datalist></label>
    </div>
    <label class="field"><span>Exact text <span class="helper">(copied word for word from the record; for a note, what it says)</span></span><textarea rows="3" data-side-field="excerpt">${escapeHtml(side.excerpt || "")}</textarea></label>
    <div class="conflict-side-actions"><button type="button" class="button button-secondary" data-action="issue-side-find" data-side-anchored ${side.collection ? "" : "hidden"}>Find the field from this text</button><button type="button" class="button button-danger" data-action="issue-side-remove">Remove side</button></div>
  </div>`;
}

function issueForm(issue) {
  const source = issue || issueView.prefill || {};
  const vocabulary = state.vocabulary;
  const select = (name, values, value, labels = {}) => `<select name="${name}">${values.map((option) =>
    `<option value="${option}" ${option === value ? "selected" : ""}>${escapeHtml(labels[option] || humanize(option))}</option>`).join("")}</select>`;
  const sides = source.sides?.length ? source.sides : [{}, {}];
  return `<form id="issue-form" class="editor-content">
    <div class="editor-title">
      <div><h2>${issue ? "Edit issue" : "New continuity issue"}</h2><p>Quote each conflicting passage exactly, so it can be found and replaced.</p></div>
      <div class="editor-actions">
        <button type="button" class="button button-secondary" data-action="issue-cancel">Cancel</button>
        <button type="submit" class="button button-primary">Save issue</button>
      </div>
    </div>
    <div class="form-grid">
      <label class="field full"><span>Title</span><input name="title" required value="${escapeHtml(source.title || "")}" placeholder="What disagrees with what" /></label>
      <label class="field"><span>Severity</span>${select("severity", vocabulary.issueSeverities || [], source.severity || "minor")}</label>
      <label class="field"><span>Category</span>${select("category", vocabulary.issueCategories || [], source.category || "contradiction")}</label>
      ${issue ? `<label class="field"><span>Status</span>${select("status", vocabulary.issueStatuses || [], issue.status, ISSUE_STATUS_LABELS)}</label>` : ""}
      <label class="field full"><span>What's wrong</span><textarea name="summary" rows="4">${escapeHtml(source.summary || "")}</textarea></label>
      <label class="field full"><span>Suggested resolution <span class="helper">(optional)</span></span><textarea name="suggestion" rows="2">${escapeHtml(source.suggestion || "")}</textarea></label>
      <div class="form-section">Sides</div>
      <div class="field full" id="issue-side-rows">${sides.map(sideRow).join("")}</div>
      <div class="field full"><button type="button" class="button button-secondary" data-action="issue-side-add">+ Add side</button></div>
    </div>
  </form>`;
}

function readIssueForm(form) {
  const data = new FormData(form);
  return {
    title: formText(data, "title"), severity: formText(data, "severity"), category: formText(data, "category"),
    status: formText(data, "status") || "open", summary: formText(data, "summary"), suggestion: formText(data, "suggestion"),
    sides: [...form.querySelectorAll("[data-side-row]")].map((row) => {
      const value = (name) => row.querySelector(`[data-side-field="${name}"]`).value;
      const collection = value("collection");
      return { label: value("label").trim(), collection, recordId: collection ? value("recordId") : "",
               field: collection ? value("field").trim() : "", excerpt: value("excerpt") };
    }).filter((side) => side.excerpt.trim() || side.collection),
  };
}

async function saveIssue(form) {
  const data = readIssueForm(form);
  const existing = issueView.editing && issueView.editing !== "new" ? issueById(issueView.editing) : null;
  const result = existing
    ? await api(`/api/issues/${encodeURIComponent(existing.id)}`, { method: "PUT", body: JSON.stringify({ data }) })
    : await api("/api/issues", { method: "POST", body: JSON.stringify({ data }) });
  issueView.prefill = null;
  await afterIssueChange(existing ? "Issue saved." : "Issue recorded.", result.id);
}

// Fill a side's field from its quoted text: the first text field of the chosen record that contains it.
function findSideField(row) {
  const collection = row.querySelector('[data-side-field="collection"]').value;
  const recordId = row.querySelector('[data-side-field="recordId"]').value;
  const excerpt = row.querySelector('[data-side-field="excerpt"]').value;
  const record = collection && recordId ? findRecord(collection, recordId) : null;
  if (!record || !excerpt) { showNotice("Choose a record and paste the exact text first.", true); return; }
  const match = textPaths(record).find((path) => String(valueAt(record, path)).includes(excerpt));
  if (!match) { showNotice("That text isn't in any field of this record as saved. Check it was copied exactly (and the record saved).", true); return; }
  row.querySelector('[data-side-field="field"]').value = match;
  showNotice(`Found in “${match}”.`);
}

/* Start a new issue from the record being edited: side 1 is this record, quoting the selected text. */
function flagIssueFromRecord(collection, recordId) {
  const record = findRecord(collection, recordId);
  let excerpt = "";
  if (lastTextField && document.contains(lastTextField) && lastTextField.selectionEnd > lastTextField.selectionStart) {
    excerpt = lastTextField.value.slice(lastTextField.selectionStart, lastTextField.selectionEnd);
  } else excerpt = String(window.getSelection?.() || "");
  const field = record && excerpt ? textPaths(record).find((path) => String(valueAt(record, path)).includes(excerpt)) || "" : "";
  issueView.prefill = { sides: [{ label: issueRecordLabel(collection, recordId), collection, recordId, field, excerpt }, {}] };
  issueView.editing = "new";
  if (!navigateTo("issues", null, { remember: true })) { issueView.prefill = null; issueView.editing = null; return; }
  if (excerpt && !field) showNotice("The selected text isn't in the saved record (unsaved edits?). Check the side before saving.", true);
}

/* ---------- Events (called from manager.js) ---------- */

async function handleIssueClick(event, actionButton, action) {
  const row = event.target.closest("[data-issue-id]");
  if (row) {
    if (row.dataset.issueId !== selectedId && !confirmLeave()) return true;
    selectedId = row.dataset.issueId;
    issueView.editing = null;
    renderContent();
    return true;
  }
  if (!action?.startsWith("issue-")) return false;
  const issue = issueById(selectedId);
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
  try {
    if (action === "issue-new") {
      if (!confirmLeave()) return true;
      issueView.editing = "new";
      issueView.prefill = null;
      renderContent();
    } else if (action === "issue-edit") {
      issueView.editing = issue.id;
      renderContent();
    } else if (action === "issue-cancel") {
      issueView.editing = null;
      issueView.prefill = null;
      renderContent();
    } else if (action === "issue-delete") {
      if (!confirm(`Delete the issue “${issue.title}”? Its history is lost. Records are not changed.`)) return true;
      await api(`/api/issues/${encodeURIComponent(issue.id)}`, { method: "DELETE" });
      await afterIssueChange("Issue deleted.", null);
    } else if (action === "issue-side-reset" || action === "issue-side-copy") {
      const index = Number(actionButton.dataset.side);
      const source = document.querySelector(`[data-side-text="${index}"]`);
      if (action === "issue-side-reset") source.value = issue.sides[index].excerpt;
      else document.querySelectorAll("[data-side-text]").forEach((box) => { if (box !== source) box.value = source.value; });
      refreshSideStates();
    } else if (action === "issue-apply") {
      const edits = [...document.querySelectorAll("[data-side-text]")]
        .map((box) => ({ side: Number(box.dataset.sideText), replacement: box.value }))
        .filter((edit) => edit.replacement !== issue.sides[edit.side].excerpt);
      const note = document.querySelector("[data-issue-note]")?.value.trim() || "";
      const result = await post(`/api/issues/${encodeURIComponent(issue.id)}/resolve`, { kind: "edited", edits, note });
      issueView.dirty = false;
      await afterIssueChange(`Resolved: ${result.edited} passage${result.edited === 1 ? "" : "s"} rewritten. Sync data to update the site.`);
    } else if (action === "issue-resolve") {
      const note = document.querySelector("[data-issue-note]")?.value.trim() || "";
      const kind = actionButton.dataset.kind;
      if (document.querySelector(".conflict-side.is-edited") && !confirm("Your edited text will be discarded, because this option keeps the records as they are. Continue?")) return true;
      await post(`/api/issues/${encodeURIComponent(issue.id)}/resolve`, { kind, note });
      issueView.dirty = false;
      await afterIssueChange(`Issue ${kind === "deferred" ? "deferred" : kind === "dismissed" ? "dismissed" : "resolved"}.`);
    } else if (action === "issue-reopen" || action === "issue-undo") {
      const undo = action === "issue-undo";
      if (undo && !confirm("Put the original text back in every record this resolution edited, and reopen the issue?")) return true;
      const result = await post(`/api/issues/${encodeURIComponent(issue.id)}/reopen`, { undo });
      await afterIssueChange(undo ? `Reopened; ${result.undone} edit${result.undone === 1 ? "" : "s"} undone.` : "Issue reopened.");
    } else if (action === "issue-side-add") {
      document.getElementById("issue-side-rows").insertAdjacentHTML("beforeend", sideRow());
      issueView.dirty = true;
    } else if (action === "issue-side-remove") {
      actionButton.closest("[data-side-row]").remove();
      issueView.dirty = true;
    } else if (action === "issue-side-find") {
      findSideField(actionButton.closest("[data-side-row]"));
    } else if (action === "issue-flag") {
      const form = actionButton.closest("#record-form");
      flagIssueFromRecord(form.dataset.collection, form.dataset.editingId);
    } else return false;
  } catch (error) {
    showNotice(error.message, true);
  }
  return true;
}

function handleIssueInput(target) {
  const filter = target.closest("[data-issue-filter]");
  if (filter) {
    issueView[filter.dataset.issueFilter] = filter.value;
    if (filter.tagName === "SELECT" || filter.type === "search") {
      const position = filter.selectionStart;
      renderContent();
      if (filter.type === "search") {
        const box = document.querySelector('[data-issue-filter="query"]');
        box.focus();
        box.setSelectionRange(position, position);
      }
    }
    return true;
  }
  if (target.matches("[data-side-text], [data-issue-note]")) { refreshSideStates(); return true; }
  if (target.closest("#issue-form")) issueView.dirty = true;
  const row = target.closest("[data-side-row]");
  if (row && target.matches('[data-side-field="collection"]')) {
    row.querySelectorAll("[data-side-anchored]").forEach((label) => { label.hidden = !target.value; });
    row.querySelector('[data-side-field="recordId"]').innerHTML = recordOptions(target.value, "");
    row.querySelector("[data-side-fields]").innerHTML = "";
  } else if (row && target.matches('[data-side-field="recordId"]')) {
    row.querySelector("[data-side-fields]").innerHTML = fieldOptions(row.querySelector('[data-side-field="collection"]').value, target.value);
  }
  return Boolean(row);
}

// Open issues that quote the record being edited, shown at the top of its form.
function recordIssueBanner(collection, record) {
  if (!record) return "";
  const issues = issuesForRecord(collection, record.id);
  return issues.length ? `<div class="issue-banner field full"><strong>⚠ ${issues.length} open continuity issue${issues.length === 1 ? "" : "s"}:</strong>
    ${issues.map((issue) => `<button type="button" class="related-link" data-jump-view="issues" data-jump-id="${escapeHtml(issue.id)}">${escapeHtml(issue.title)}</button>`).join(" · ")}</div>` : "";
}

document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("textarea, input[type='text'], input:not([type])")) lastTextField = event.target;
});
