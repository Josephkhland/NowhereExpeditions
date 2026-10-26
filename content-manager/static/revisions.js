/* Record revisions: proposed versions waiting for review, and earlier versions kept on every edit.
   Uses manager.js globals (state, collections, api, escapeHtml, findRecord, showNotice, loadState, hasUnsavedChanges). */

const REVISION_SKIP_FIELDS = new Set(["id", "updatedAt", "published", "sample", "legacy"]);
const revisionView = { collection: "", recordId: "", revisions: [], comparing: null };

const proposedRevisions = (collection, recordId) =>
  (state.revisions || []).filter((revision) => revision.kind === "proposed" && revision.collection === collection && revision.recordId === recordId);

const revisionDate = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

// Shown at the top of a record's form when someone has proposed a new version of it.
function recordRevisionBanner(collection, record) {
  if (!record) return "";
  const proposed = proposedRevisions(collection, record.id);
  if (!proposed.length) return "";
  return `<div class="issue-banner revision-banner field full"><strong>✎ ${proposed.length === 1 ? "A proposed revision is" : `${proposed.length} proposed revisions are`} waiting for review.</strong>
    The text below is the current version${record.published ? ", which is what the site shows" : ""}.
    ${proposed.map((revision) => `<span class="revision-chip">${escapeHtml(revision.label)} <span class="helper">${escapeHtml(revisionDate(revision.createdAt))}</span>
      <button type="button" class="related-link" data-revision-action="compare" data-revision-id="${escapeHtml(revision.id)}">Compare</button></span>`).join(" ")}</div>`;
}

function revisionCount(collection, recordId) {
  return (state.revisions || []).filter((revision) => revision.collection === collection && revision.recordId === recordId).length;
}

/* ---------- Word diff ---------- */

// Words with their trailing whitespace, so the text reassembles exactly and newlines survive.
const diffTokens = (text) => String(text ?? "").match(/\S+\s*|\s+/g) || [];

function diffWords(before, after) {
  const a = diffTokens(before), b = diffTokens(after);
  if (a.length * b.length > 6_000_000) return diffParagraphs(before, after);
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i].trim() === b[j].trim() ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  // A "same" part keeps each side's own text: the word matches, the whitespace after it may not.
  const parts = [];
  const push = (kind, text, left = text) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) { last.text += text; last.left += left; } else parts.push({ kind, text, left });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].trim() === b[j].trim()) { push("same", b[j], a[i]); i += 1; j += 1; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { push("removed", a[i]); i += 1; }
    else { push("added", b[j]); j += 1; }
  }
  while (i < a.length) { push("removed", a[i]); i += 1; }
  while (j < b.length) { push("added", b[j]); j += 1; }
  return parts;
}

// Very long texts: compare whole paragraphs instead of words.
function diffParagraphs(before, after) {
  const a = String(before ?? "").split(/(?<=\n\n)/), b = String(after ?? "").split(/(?<=\n\n)/);
  const kept = new Set(a.filter((paragraph) => b.includes(paragraph)));
  return [...a.filter((paragraph) => !kept.has(paragraph)).map((text) => ({ kind: "removed", text, left: text })),
    ...b.map((text) => ({ kind: kept.has(text) ? "same" : "added", text, left: text }))];
}

const fieldText = (value) => typeof value === "string" ? value
  : Array.isArray(value) && value.every((item) => typeof item === "string") ? value.join(", ")
  : value === undefined || value === null ? "" : JSON.stringify(value, null, 2);

const fieldLabel = (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
const wordCount = (text) => (String(text).match(/[\p{L}\p{N}'’-]+/gu) || []).length;

function compareHtml(current, other, otherTitle) {
  const keys = [...new Set([...Object.keys(current || {}), ...Object.keys(other || {})])].filter((key) => !REVISION_SKIP_FIELDS.has(key));
  const changed = keys.filter((key) => fieldText(current?.[key]) !== fieldText(other?.[key]));
  if (!changed.length) return '<p class="helper">No differences: this version matches the current one.</p>';
  return changed.map((key) => {
    const before = fieldText(current?.[key]), after = fieldText(other?.[key]);
    const parts = diffWords(before, after);
    const side = (kinds) => parts.filter((part) => kinds.includes(part.kind))
      .map((part) => part.kind === "same" ? escapeHtml(kinds.includes("removed") ? part.left : part.text)
        : `<mark class="diff-${part.kind}">${escapeHtml(part.text)}</mark>`).join("");
    const counts = key === "content" ? ` <span class="helper">(${wordCount(before)} → ${wordCount(after)} words)</span>` : "";
    return `<section class="diff-field"><h3>${escapeHtml(fieldLabel(key))}${counts}</h3>
      <div class="diff-grid"><div><span class="eyebrow">Current</span><div class="diff-text">${side(["same", "removed"]) || '<span class="helper">(empty)</span>'}</div></div>
      <div><span class="eyebrow">${escapeHtml(otherTitle)}</span><div class="diff-text">${side(["same", "added"]) || '<span class="helper">(empty)</span>'}</div></div></div></section>`;
  }).join("");
}

/* ---------- Versions dialog ---------- */

function versionsDialog() {
  let dialog = document.getElementById("versions-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "versions-dialog";
  dialog.className = "batch-dialog versions-dialog";
  dialog.setAttribute("aria-labelledby", "versions-title");
  dialog.innerHTML = `<header class="batch-head"><div><span class="eyebrow">VERSIONS</span><h2 id="versions-title"></h2></div>
    <button type="button" class="button button-secondary" data-revision-action="close" aria-label="Close">✕</button></header><div id="versions-body"></div>`;
  document.body.append(dialog);
  return dialog;
}

function renderVersions() {
  const dialog = versionsDialog();
  const current = findRecord(revisionView.collection, revisionView.recordId);
  const config = collections[revisionView.collection];
  dialog.querySelector("#versions-title").textContent = current ? config.name(current) || current.id : revisionView.recordId;
  const body = dialog.querySelector("#versions-body");
  const comparing = revisionView.revisions.find((revision) => revision.id === revisionView.comparing);
  if (comparing) {
    const proposed = comparing.kind === "proposed";
    body.innerHTML = `<div class="versions-toolbar"><button type="button" class="button button-secondary" data-revision-action="back">← All versions</button>
        <span><strong>${escapeHtml(comparing.label)}</strong> <span class="helper">${escapeHtml(revisionDate(comparing.createdAt))}</span></span></div>
      ${comparing.note ? `<p class="helper">${escapeHtml(comparing.note)}</p>` : ""}
      <p class="helper">Removed text is struck out on the left, new text is highlighted on the right.</p>
      ${compareHtml(current, comparing.record, proposed ? "Proposed" : "Earlier version")}
      <div class="batch-actions">
        <button type="button" class="button button-danger" data-revision-action="discard" data-revision-id="${escapeHtml(comparing.id)}">${proposed ? "Discard proposal" : "Delete this version"}</button>
        <button type="button" class="button button-primary" data-revision-action="apply" data-revision-id="${escapeHtml(comparing.id)}">${proposed ? "Apply this revision" : "Restore this version"}</button>
      </div>`;
    return;
  }
  const row = (revision) => `<li class="version-row"><span class="version-kind version-${revision.kind}">${revision.kind === "proposed" ? "Proposed" : "Earlier"}</span>
    <span class="version-label"><strong>${escapeHtml(revision.label)}</strong> <span class="helper">${escapeHtml(revisionDate(revision.createdAt))}</span>
    ${revision.note ? `<span class="helper version-note">${escapeHtml(revision.note)}</span>` : ""}</span>
    <button type="button" class="button button-secondary" data-revision-action="compare" data-revision-id="${escapeHtml(revision.id)}">Compare</button></li>`;
  body.innerHTML = revisionView.revisions.length
    ? `<p class="helper">Every save that changes this record keeps the version it replaced (the latest 30). Compare any of them with the current version, then apply or restore it. Applying never changes whether the record is published.</p>
       <ul class="version-list">${revisionView.revisions.map(row).join("")}</ul>`
    : '<p class="helper">No other versions yet. From now on, every save that changes this record keeps the version it replaced.</p>';
}

async function openVersions(collection, recordId, comparing = null) {
  Object.assign(revisionView, { collection, recordId, comparing });
  revisionView.revisions = (await api(`/api/revisions/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}`, { method: "GET" })).revisions;
  renderVersions();
  const dialog = versionsDialog();
  if (!dialog.open) dialog.showModal();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revision-action]");
  if (!button) return;
  const action = button.dataset.revisionAction;
  const revisionId = button.dataset.revisionId;
  const dialog = document.getElementById("versions-dialog");
  try {
    if (action === "open") {
      const form = button.closest("form");
      await openVersions(form.dataset.collection, form.dataset.editingId);
    } else if (action === "compare") {
      const form = button.closest("#record-form");
      if (form) await openVersions(form.dataset.collection, form.dataset.editingId, revisionId);
      else { revisionView.comparing = revisionId; renderVersions(); }
    } else if (action === "back") {
      revisionView.comparing = null;
      renderVersions();
    } else if (action === "close") {
      dialog?.close();
    } else if (action === "apply") {
      const revision = revisionView.revisions.find((item) => item.id === revisionId);
      if (hasUnsavedChanges() && !confirm("The open form has unsaved changes, and they will be lost. Continue?")) return;
      const proposed = revision.kind === "proposed";
      if (!confirm(`${proposed ? "Apply" : "Restore"} “${revision.label}”? The current version is kept under Versions, and the record stays ${findRecord(revisionView.collection, revisionView.recordId)?.published ? "published" : "unpublished"}.`)) return;
      await api(`/api/revision/${encodeURIComponent(revisionId)}/apply`, { method: "POST", body: "{}" });
      dialog.close();
      await loadState();
      showNotice(`${proposed ? "Revision applied" : "Version restored"}. Sync data to update the site.`);
    } else if (action === "discard") {
      const revision = revisionView.revisions.find((item) => item.id === revisionId);
      if (!confirm(`${revision.kind === "proposed" ? "Discard the proposal" : "Delete the earlier version"} “${revision.label}”? This can't be undone.`)) return;
      await api(`/api/revision/${encodeURIComponent(revisionId)}`, { method: "DELETE" });
      await loadState();
      await openVersions(revisionView.collection, revisionView.recordId);
      showNotice(revision.kind === "proposed" ? "Proposal discarded." : "Earlier version deleted.");
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});
