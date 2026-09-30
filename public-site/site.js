const formatStatus = (status = "UNKNOWN") => {
  const normalized = String(status).trim().toUpperCase();
  const statusClassMap = {
    ACTIVE: "status-active",
    READY: "status-ready",
    OBSERVED: "status-observed",
    LOCKED: "status-locked",
    UNKNOWN: "status-unknown",
    UNCLASSIFIED: "status-unknown",
    "NOT YET SURVEYED": "status-unknown",
    "NO DATA": "status-unknown",
    DORMANT: "status-observed",
    COLLAPSED: "status-unknown",
    LOST: "status-locked",
    RECRUITING: "status-ready",
    SCHEDULED: "status-active",
    UNDERWAY: "status-observed",
    COMPLETED: "status-unknown",
    CANCELLED: "status-locked",
    INACTIVE: "status-unknown",
    MISSING: "status-observed",
    DECEASED: "status-locked",
    SUCCESS: "status-ready",
    PARTIAL: "status-observed",
    FAILED: "status-locked",
    ABORTED: "status-locked"
  };

  return {
    label: normalized || "UNKNOWN",
    className: statusClassMap[normalized] || "status-unknown"
  };
};

const slugify = (value = "") => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
};

const renderBoxTrack = (current, max, label, className = "") => {
  const boxCount = Number.isFinite(Number(max)) ? Math.max(1, Math.floor(Number(max))) : 1;
  const filledCount = Number.isFinite(Number(current))
    ? Math.min(boxCount, Math.max(0, Math.floor(Number(current))) )
    : 0;
  const boxes = Array.from({ length: boxCount }, (_, index) => `
    <span class="track-box${index < filledCount ? " is-filled" : ""}" aria-hidden="true">${index < filledCount ? "X" : ""}</span>
  `).join("");

  return `<div class="box-track ${className}" role="img" aria-label="${label}: ${filledCount} of ${boxCount} boxes marked">${boxes}</div>`;
};

const renderIsland = async () => {
  const root = document.getElementById("island-overview");
  if (!root) return;

  try {
    const island = await fetchJson("data/island.json");

    const facilityMarkup = (island.facilities || [])
      .map(
        (item) => `
          <div class="card fact-card">
            <div class="meta-row">
              <span class="pill">Facility</span>
            </div>
            <h3>${item.name}</h3>
            <p>${item.summary}</p>
          </div>
        `
      )
      .join("");

    const projectMarkup = (island.activeProjects || [])
      .map((item) => {
        const progress = item.progress || {};
        const current = Number(progress.current) || 0;
        const max = Number(progress.max) || 4;
        const isComplete = current >= max;
        const completion = item.completion;

        return `
          <article class="card fact-card project-card${isComplete ? " is-complete" : ""}">
            <div class="meta-row">
              <span class="pill">Project</span>
              ${isComplete ? '<span class="pill status-ready">Completed</span>' : ""}
            </div>
            <h3>${item.name}</h3>
            <p>${item.summary}</p>
            <div class="project-progress">
              <span class="track-label">Progress <span>${Math.min(current, max)}/${max}</span></span>
              ${renderBoxTrack(current, max, `${item.name} progress`, "project-track")}
            </div>
            <p class="project-outcome"><strong>Completion effect:</strong> ${completion?.summary || (isComplete ? "Record the resulting facility, capability change, or condition change." : "Not recorded yet.")}</p>
          </article>
        `;
      })
      .join("");

    const conditionMarkup = (island.conditions || [])
      .map(
        (item) => `
          <div class="card fact-card">
            <div class="meta-row">
              <span class="pill">Condition</span>
            </div>
            <h3>${item.name}</h3>
            <p>${item.summary}</p>
          </div>
        `
      )
      .join("");

    const capabilityRows = (island.capabilities || [])
      .map((capability) => {
        const targetId = `${slugify(capability.name)}-detail`;
        return `
          <tr class="capability-row">
            <th scope="row">${capability.name}</th>
            <td class="rating-cell">${capability.rating}</td>
            <td class="summary-cell">${capability.summary}</td>
            <td class="capability-action">
              <button type="button" class="info-toggle" aria-expanded="false" aria-controls="${targetId}" data-target="${targetId}">
                <span aria-hidden="true">i</span>
              </button>
            </td>
          </tr>
          <tr id="${targetId}" class="capability-detail" hidden>
            <td colspan="4">
              <div class="capability-detail-body">
                <p><strong>What it represents:</strong> ${capability.detail}</p>
                <p><strong>How players use it:</strong> ${capability.use}</p>
                <p><strong>Current contributing assets:</strong> ${capability.assets}</p>
                <p><strong>Relevant conditions:</strong> ${capability.conditions}</p>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    const consequenceMarkup = (island.consequences || [])
      .map((item, index) => {
        const detailId = `consequence-${index}-${slugify(item.name)}-detail`;
        const severityLabel = String(item.severity || "Unrated").trim();
        const severityClass = `severity-${slugify(severityLabel)}`;

        return `
          <article class="consequence-row">
            <div class="consequence-row-main">
              <span class="consequence-severity ${severityClass}">${severityLabel}</span>
              <h4>${item.name}</h4>
              <button type="button" class="info-toggle consequence-toggle" aria-label="Toggle details for ${item.name}" aria-expanded="false" aria-controls="${detailId}" data-target="${detailId}" title="Toggle consequence details">
                <span aria-hidden="true">i</span>
              </button>
            </div>
            <div id="${detailId}" class="consequence-detail" hidden>${item.detail}</div>
          </article>
        `;
      })
      .join("");

    root.innerHTML = `
      <div class="hero-panel">
        <div class="hero-inner">
          <div>
            <span class="kicker">Island Sheet</span>
            <h1>${island.name}</h1>
            <p class="lede"><strong>High Concept:</strong> ${island.highConcept}</p>
            <p class="lede"><strong>Trouble:</strong> ${island.trouble}</p>
            <div class="hero-meta">
              ${(island.aspects || []).map((aspect) => `<span class="tag">${aspect}</span>`).join("")}
            </div>
          </div>
          <div class="status-box">
            <div class="label">Island Stress</div>
            ${renderBoxTrack(island.stress.current, island.stress.max, "Island stress", "stress-track")}
            <p class="track-count">${island.stress.current}/${island.stress.max} boxes marked</p>
          </div>
        </div>
      </div>

      <div class="section-header">
        <h2>Capabilities</h2>
      </div>
      <table class="capability-table">
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Rating</th>
            <th scope="col">Current meaning</th>
            <th scope="col">Info</th>
          </tr>
        </thead>
        <tbody>
          ${capabilityRows}
        </tbody>
      </table>

      <div class="section-header">
        <h2>Current State</h2>
      </div>
      <div class="grid grid-two">
        <div class="card">
          <h3>Consequences</h3>
          <div class="consequence-list">${consequenceMarkup || '<p class="muted">No major consequences currently recorded.</p>'}</div>
        </div>
        <div class="card">
          <h3>Facilities</h3>
          <div class="grid">${facilityMarkup || '<p class="muted">No facilities catalogued.</p>'}</div>
        </div>
      </div>

      <div class="section-header">
        <h2>Projects and Conditions</h2>
      </div>
      <div class="grid grid-two">
        <div class="card">
          <h3>Active Projects</h3>
          <div class="grid">${projectMarkup || '<p class="muted">No active projects.</p>'}</div>
        </div>
        <div class="card">
          <h3>Persistent Conditions</h3>
          <div class="grid">${conditionMarkup || '<p class="muted">No persistent conditions recorded.</p>'}</div>
        </div>
      </div>
    `;

    root.querySelectorAll(".info-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.getAttribute("data-target");
        const target = document.getElementById(targetId);
        if (!target) return;

        const isHidden = target.hasAttribute("hidden");
        target.toggleAttribute("hidden", !isHidden);
        button.setAttribute("aria-expanded", String(isHidden));
      });
    });
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Island data could not be loaded.</p></div>';
    console.error(error);
  }
};

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const renderRules = async () => {
  const root = document.getElementById("rules-list");
  const search = document.getElementById("rules-search");
  const count = document.getElementById("rules-count");
  if (!root || !search || !count) return;

  try {
    const rules = await fetchJson("data/rules.json");
    if (!Array.isArray(rules)) throw new Error("Rules data must be a list.");
    const sortedRules = [...rules].sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")));

    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = sortedRules.filter((rule) => {
        const searchable = [rule.category, rule.title, rule.summary, rule.details, ...(Array.isArray(rule.tags) ? rule.tags : [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchable.includes(query);
      });

      count.textContent = query ? `Showing ${filtered.length} of ${sortedRules.length} rules` : `${sortedRules.length} rules`;
      root.innerHTML = filtered.length ? filtered.map((rule) => `
        <article class="rule-entry">
          <div class="rule-entry-heading">
            <span class="rule-category">${escapeHtml(rule.category || "Campaign")}</span>
            <h2>${escapeHtml(rule.title || "Untitled rule")}</h2>
          </div>
          <p class="rule-summary">${escapeHtml(rule.summary || "")}</p>
          ${rule.details ? `<details class="rule-details"><summary>Read rule</summary><p>${escapeHtml(rule.details)}</p></details>` : ""}
          ${(Array.isArray(rule.tags) && rule.tags.length) ? `<div class="rule-tags" aria-label="Related topics">${rule.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        </article>
      `).join("") : '<p class="empty-state">No rules match this search.</p>';
    };

    search.addEventListener("input", renderList);
    renderList();
  } catch (error) {
    count.textContent = "Rules unavailable";
    root.innerHTML = '<p class="empty-state">Campaign rules could not be loaded.</p>';
    console.error(error);
  }
};

/* ---------- Campaign records: Characters, Gates, Expeditions, Reports ---------- */

const fetchCollection = async (name) => {
  try {
    const manifest = await fetchJson(`data/${name}/index.json`);
    return await Promise.all(manifest.map((fileName) => fetchJson(`data/${name}/${fileName}`)));
  } catch (error) {
    console.warn(`No ${name} data available.`, error);
    return [];
  }
};

let campaignPromise = null;

const loadCampaign = () => {
  if (!campaignPromise) {
    campaignPromise = Promise.all(["characters", "gates", "expeditions", "reports"].map(fetchCollection))
      .then(([characters, gates, expeditions, reports]) => {
        const byId = (items) => new Map(items.map((item) => [item.id, item]));
        return {
          characters, gates, expeditions, reports,
          characterById: byId(characters),
          gateById: byId(gates),
          expeditionById: byId(expeditions),
          // Relationships are derived from references, never stored on the parent record.
          expeditionsForGate: (gateId) => expeditions.filter((expedition) => expedition.gateId === gateId).sort(byScheduleAscending),
          reportsForExpedition: (expeditionId) => reports.filter((report) => report.expeditionId === expeditionId).sort(byDate("submittedAt")),
          expeditionsForCharacter: (characterId) => expeditions
            .filter((expedition) => expedition.organizerId === characterId || (expedition.participantIds || []).includes(characterId))
            .sort(byScheduleAscending)
        };
      });
  }
  return campaignPromise;
};

const byDate = (field) => (left, right) => String(left[field] || "").localeCompare(String(right[field] || ""));
const byScheduleAscending = (left, right) => {
  if (!left.scheduledAt !== !right.scheduledAt) return left.scheduledAt ? -1 : 1;
  return String(left.scheduledAt || left.designation || left.title).localeCompare(String(right.scheduledAt || right.designation || right.title));
};

const capitalize = (value = "") => String(value).charAt(0).toUpperCase() + String(value).slice(1);

const paragraphs = (text, fallback = "NO DATA") => {
  const blocks = String(text || "").split(/\n\s*\n|\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.length ? blocks.map((block) => `<p>${escapeHtml(block)}</p>`).join("") : `<p class="muted">${fallback}</p>`;
};

const itemList = (items, fallback = "NO DATA") => Array.isArray(items) && items.length
  ? `<ul class="clean-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
  : `<p class="muted">${fallback}</p>`;

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(`${value}T00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const formatSchedule = (value) => {
  if (!value) return "Date TBD";
  const [datePart, timePart] = value.split("T");
  const date = new Date(`${datePart}T${timePart || "00:00"}`);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  return timePart ? `${day} · ${timePart}` : day;
};

const statusPill = (status, extraClass = "pill") => {
  const formatted = formatStatus(status);
  return `<span class="${extraClass} ${formatted.className}">${escapeHtml(formatted.label)}</span>`;
};

const gateLabel = (gate) => gate ? [gate.designation, gate.name].filter(Boolean).join(" · ") : "";
const expeditionLabel = (expedition) => [expedition.designation, expedition.title].filter(Boolean).join(" — ");

const gateLink = (gate, text = gateLabel(gate)) => gate
  ? `<a class="inline-link" href="gates.html#${encodeURIComponent(gate.id)}">${escapeHtml(text)}</a>`
  : "";

const characterLink = (character) => character
  ? `<a class="inline-link" href="characters.html#${encodeURIComponent(character.id)}">${escapeHtml(character.name)}</a>`
  : "";

const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";

const avatar = (character, className = "avatar") => character.portrait
  ? `<span class="${className}"><img src="${escapeHtml(character.portrait)}" alt="" loading="lazy" /></span>`
  : `<span class="${className} avatar-empty" aria-hidden="true">${escapeHtml(initials(character.name))}</span>`;

const crewCount = (expedition) => {
  const count = Number.isFinite(expedition.crewCount) ? expedition.crewCount : (expedition.participantIds || []).length;
  return expedition.crewMax ? `Crew ${count}/${expedition.crewMax}` : `Crew ${count}`;
};

const OPEN_EXPEDITION_STATUSES = ["recruiting", "scheduled", "underway"];

/* A report is written up as a field record rather than a list of database fields. */
const renderFieldReport = (report, campaign, { compact = false, expedition = null } = {}) => {
  const author = campaign.characterById.get(report.submittedBy);
  const findings = [
    ["Discoveries", report.discoveries],
    ["Hazards encountered", report.hazards],
    ["Recovered", report.recoveredItems],
    ["Casualties", report.casualties]
  ].filter(([, items]) => Array.isArray(items) && items.length);
  const dateline = [formatDate(report.submittedAt) || "Undated", author ? `filed by ${characterLink(author)}` : ""].filter(Boolean).join(" · ");

  if (compact) {
    return `
      <div class="field-report is-compact">
        <p class="field-report-dateline">Field report · ${dateline}</p>
        <h4>${escapeHtml(report.title)} ${statusPill(report.outcome, "pill pill-small")}</h4>
        ${report.summary ? `<p>${escapeHtml(report.summary)}</p>` : ""}
        ${expedition ? `<a class="inline-link" href="expeditions.html#${encodeURIComponent(expedition.id)}#report-${encodeURIComponent(report.id)}">Read the full report →</a>` : ""}
      </div>`;
  }

  return `
    <article class="field-report" id="report-${escapeHtml(report.id)}">
      <header>
        <p class="field-report-dateline">Field report · ${dateline}</p>
        <h3>${escapeHtml(report.title)}</h3>
        <p class="field-report-outcome">Outcome: ${statusPill(report.outcome, "pill pill-small")}</p>
      </header>
      ${report.summary ? `<p class="field-report-summary">${escapeHtml(report.summary)}</p>` : ""}
      ${findings.length ? `<div class="field-report-findings">${findings.map(([title, items]) => `
        <section><h4>${title}</h4>${itemList(items)}</section>`).join("")}</div>` : ""}
      ${report.notes ? `<div class="field-report-notes">${paragraphs(report.notes)}</div>` : ""}
    </article>`;
};

const selectedHash = () => decodeURIComponent(window.location.hash.slice(1).split("#")[0]);

/* ---------- Gate Archive: a living dossier of what is currently known ---------- */

const renderGateArchive = async () => {
  const root = document.getElementById("gate-archive");
  if (!root) return;

  try {
    const campaign = await loadCampaign();
    const gates = [...campaign.gates].sort((left, right) => String(left.designation).localeCompare(String(right.designation), undefined, { numeric: true }));
    let query = "";

    if (!gates.length) {
      root.innerHTML = '<div class="card"><p class="muted">No Gates are on public record yet.</p></div>';
      return;
    }

    root.innerHTML = `
      <div class="browser-shell">
        <aside class="browser-sidebar">
          <label class="search-wrap" for="gate-archive-search">
            <span class="sr-only">Search Gates</span>
            <input id="gate-archive-search" class="search-input" type="search" placeholder="Search gates..." />
          </label>
          <div id="gate-archive-list" class="entry-list"></div>
        </aside>
        <div id="gate-archive-detail" class="browser-detail"></div>
      </div>`;

    const historyEntry = (expedition) => {
      const reports = campaign.reportsForExpedition(expedition.id);
      const organizer = campaign.characterById.get(expedition.organizerId);
      return `
        <details class="history-entry">
          <summary>
            <span class="history-title">${escapeHtml(expeditionLabel(expedition))}</span>
            <span class="history-meta">${escapeHtml(expedition.scheduledAt ? formatSchedule(expedition.scheduledAt) : capitalize(expedition.type))} ${statusPill(expedition.status, "pill pill-small")}</span>
          </summary>
          <div class="history-body">
            <p><strong>Objective:</strong> ${escapeHtml(expedition.objective || "NO DATA")}</p>
            <p class="muted">${escapeHtml(capitalize(expedition.type))} · ${escapeHtml(crewCount(expedition))}${organizer ? ` · Organized by ${characterLink(organizer)}` : ""}</p>
            ${reports.length ? reports.map((report) => renderFieldReport(report, campaign, { compact: true, expedition })).join("") : '<p class="muted">No report filed.</p>'}
            <a class="inline-link" href="expeditions.html#${encodeURIComponent(expedition.id)}">Open expedition record →</a>
          </div>
        </details>`;
    };

    const renderDetail = (gate) => {
      const detail = document.getElementById("gate-archive-detail");
      if (!gate) {
        detail.innerHTML = '<div class="empty-state">No matching records found.</div>';
        return;
      }
      const expeditions = campaign.expeditionsForGate(gate.id);
      detail.innerHTML = `
        <div class="detail-surface">
          <div class="detail-heading">
            <div>
              <span class="pill">${escapeHtml(gate.designation || "GATE")}</span>
              <h2>${escapeHtml(gate.name)}</h2>
              ${gate.discoveredAt ? `<p class="muted dossier-meta">Discovered ${escapeHtml(formatDate(gate.discoveredAt))}</p>` : ""}
            </div>
            ${statusPill(gate.status)}
          </div>
          <div class="detail-block"><h3>Overview</h3>${paragraphs(gate.overview)}</div>
          <div class="detail-block"><h3>Environment</h3>${paragraphs(gate.environment, "NOT YET SURVEYED")}</div>
          <div class="detail-grid">
            <div class="detail-block"><h3>Known Traits</h3>${itemList(gate.knownTraits)}</div>
            <div class="detail-block"><h3>Known Hazards</h3>${itemList(gate.knownHazards)}</div>
          </div>
          <div class="detail-block"><h3>Known Locations</h3>${itemList(gate.knownLocations)}</div>
          <div class="detail-block">
            <h3>Expedition History</h3>
            ${expeditions.length ? `<div class="history-list">${expeditions.map(historyEntry).join("")}</div>` : '<p class="muted">No expeditions on record.</p>'}
          </div>
        </div>`;
    };

    const renderList = () => {
      const list = document.getElementById("gate-archive-list");
      const filtered = gates.filter((gate) => [gate.designation, gate.name, gate.overview, gate.environment]
        .filter(Boolean).join(" ").toLowerCase().includes(query));
      if (!filtered.length) {
        list.innerHTML = '<div class="empty-state">No entries match the current search.</div>';
        renderDetail(null);
        return;
      }
      const selected = filtered.find((gate) => gate.id === selectedHash()) || filtered[0];
      list.innerHTML = filtered.map((gate) => `
        <a class="entry-item ${gate === selected ? "selected" : ""}" href="#${encodeURIComponent(gate.id)}" ${gate === selected ? 'aria-current="true"' : ""}>
          <span class="entry-name">${escapeHtml(gate.name)}</span>
          <span class="entry-meta">${escapeHtml(gate.designation || "GATE")}</span>
          ${statusPill(gate.status, "entry-pill")}
        </a>`).join("");
      renderDetail(selected);
    };

    document.getElementById("gate-archive-search").addEventListener("input", (event) => {
      query = event.target.value.trim().toLowerCase();
      renderList();
    });
    window.addEventListener("hashchange", () => {
      renderList();
      // On narrow screens the dossier sits below the list.
      if (window.matchMedia("(max-width: 800px)").matches) document.getElementById("gate-archive-detail").scrollIntoView({ block: "start" });
    });
    renderList();
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Gate data could not be loaded.</p></div>';
    console.error(error);
  }
};

/* ---------- Expedition Board ---------- */

const renderExpeditionBoard = async () => {
  const root = document.getElementById("expedition-board");
  if (!root) return;

  try {
    const campaign = await loadCampaign();

    const boardCard = (expedition) => {
      const gate = campaign.gateById.get(expedition.gateId);
      const organizer = campaign.characterById.get(expedition.organizerId);
      const href = `#${encodeURIComponent(expedition.id)}`;
      return `
        <article class="card board-card">
          <div class="board-card-head">
            <span class="board-kicker">${gate ? gateLink(gate, gate.designation || gate.name) : "No Gate"} · ${escapeHtml(capitalize(expedition.type))}</span>
            ${statusPill(expedition.status)}
          </div>
          <h3><a href="${href}">${escapeHtml(expedition.title)}</a></h3>
          <p class="board-objective"><strong>Objective:</strong> ${escapeHtml(expedition.objective || "NO DATA")}</p>
          <p class="board-facts"><span>${escapeHtml(formatSchedule(expedition.scheduledAt))}</span><span>${escapeHtml(crewCount(expedition))}</span></p>
          <p class="board-organizer">${organizer ? `Organized by ${characterLink(organizer)}` : '<span class="muted">Organizer not yet assigned</span>'}</p>
          <a class="board-link" href="${href}">View expedition <span aria-hidden="true">→</span></a>
        </article>`;
    };

    const archiveRow = (expedition) => {
      const gate = campaign.gateById.get(expedition.gateId);
      const reports = campaign.reportsForExpedition(expedition.id);
      return `
        <li>
          <a class="archive-row" href="#${encodeURIComponent(expedition.id)}">
            <span class="archive-title">${escapeHtml(expeditionLabel(expedition))}</span>
            <span class="archive-meta">${escapeHtml([gateLabel(gate), expedition.scheduledAt ? formatSchedule(expedition.scheduledAt) : ""].filter(Boolean).join(" · ") || capitalize(expedition.type))}</span>
            <span class="archive-status">${reports.length ? `${reports.length} report${reports.length > 1 ? "s" : ""}` : "No report"} ${statusPill(expedition.status, "pill pill-small")}</span>
          </a>
        </li>`;
    };

    const renderBoard = () => {
      const open = campaign.expeditions.filter((expedition) => OPEN_EXPEDITION_STATUSES.includes(expedition.status))
        .sort((left, right) => OPEN_EXPEDITION_STATUSES.indexOf(left.status) - OPEN_EXPEDITION_STATUSES.indexOf(right.status) || byScheduleAscending(left, right));
      const past = campaign.expeditions.filter((expedition) => !OPEN_EXPEDITION_STATUSES.includes(expedition.status))
        .sort((left, right) => byScheduleAscending(right, left));
      root.innerHTML = `
        <section aria-labelledby="open-expeditions-head">
          <h2 id="open-expeditions-head" class="board-section-title">Open Expeditions</h2>
          ${open.length ? `<div class="board-grid">${open.map(boardCard).join("")}</div>` : '<div class="card"><p class="muted">No expeditions are recruiting right now.</p></div>'}
        </section>
        <section class="archive-section" aria-labelledby="past-expeditions-head">
          <h2 id="past-expeditions-head" class="board-section-title">Expedition Archive</h2>
          ${past.length ? `<ul class="archive-list">${past.map(archiveRow).join("")}</ul>` : '<p class="muted">No completed expeditions yet.</p>'}
        </section>`;
    };

    const renderRecord = (expedition) => {
      const gate = campaign.gateById.get(expedition.gateId);
      const organizer = campaign.characterById.get(expedition.organizerId);
      const participants = (expedition.participantIds || []).map((id) => campaign.characterById.get(id)).filter(Boolean);
      const hidden = Number.isFinite(expedition.crewCount) ? expedition.crewCount - participants.length : 0;
      const reports = campaign.reportsForExpedition(expedition.id);
      const crewSize = [expedition.crewMin ? `min ${expedition.crewMin}` : "", expedition.crewMax ? `max ${expedition.crewMax}` : ""].filter(Boolean).join(", ");
      root.innerHTML = `
        <a class="back-link" href="expeditions.html">← Expedition Board</a>
        <article class="detail-surface record-surface">
          <div class="detail-heading">
            <div>
              ${expedition.designation ? `<span class="pill">${escapeHtml(expedition.designation)}</span>` : ""}
              <h2>${escapeHtml(expedition.title)}</h2>
              <p class="muted dossier-meta">${gate ? gateLink(gate) : "No associated Gate"} · ${escapeHtml(capitalize(expedition.type))}</p>
            </div>
            ${statusPill(expedition.status)}
          </div>
          <dl class="fact-strip">
            <div><dt>When</dt><dd>${escapeHtml(formatSchedule(expedition.scheduledAt))}</dd></div>
            ${expedition.expectedDuration ? `<div><dt>Duration</dt><dd>${escapeHtml(expedition.expectedDuration)}</dd></div>` : ""}
            <div><dt>Crew</dt><dd>${escapeHtml(crewCount(expedition))}${crewSize ? ` <span class="muted">(${escapeHtml(crewSize)})</span>` : ""}</dd></div>
            <div><dt>Organizer</dt><dd>${organizer ? characterLink(organizer) : "Not assigned"}</dd></div>
          </dl>
          <div class="detail-block"><h3>Objective</h3>${paragraphs(expedition.objective)}</div>
          ${expedition.briefing ? `<div class="detail-block"><h3>Briefing</h3>${paragraphs(expedition.briefing)}</div>` : ""}
          ${(expedition.requirements || []).length ? `<div class="detail-block"><h3>Requirements</h3>${itemList(expedition.requirements)}</div>` : ""}
          <div class="detail-block">
            <h3>Crew</h3>
            ${participants.length ? `<ul class="crew-list">${participants.map((character) => `
              <li><a class="crew-chip" href="characters.html#${encodeURIComponent(character.id)}">${avatar(character)}<span>${escapeHtml(character.name)}</span></a></li>`).join("")}</ul>` : '<p class="muted">No crew signed on yet.</p>'}
            ${hidden > 0 ? `<p class="muted">+${hidden} unlisted crew member${hidden > 1 ? "s" : ""}.</p>` : ""}
          </div>
          <div class="detail-block">
            <h3>Expedition Reports</h3>
            ${reports.length ? `<div class="report-stack">${reports.map((report) => renderFieldReport(report, campaign)).join("")}</div>` : '<p class="muted">No report filed yet.</p>'}
          </div>
        </article>`;
    };

    const route = () => {
      const [expeditionId, anchor] = window.location.hash.slice(1).split("#").map(decodeURIComponent);
      const expedition = campaign.expeditionById.get(expeditionId);
      if (expedition) {
        renderRecord(expedition);
        const target = anchor && document.getElementById(anchor);
        (target || root).scrollIntoView({ block: "start" });
      } else {
        renderBoard();
      }
    };

    window.addEventListener("hashchange", route);
    route();
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Expedition data could not be loaded.</p></div>';
    console.error(error);
  }
};

/* ---------- Fate Core character sheet ---------- */

const FATE_LADDER = { 8: "Legendary", 7: "Epic", 6: "Fantastic", 5: "Superb", 4: "Great", 3: "Good", 2: "Fair", 1: "Average", 0: "Mediocre", "-1": "Poor", "-2": "Terrible" };
const ladderLabel = (rating) => `${FATE_LADDER[rating] || "Rated"} ${rating >= 0 ? "+" : ""}${rating}`;

const renderStressTrack = (track) => {
  const boxes = track.boxes || [];
  const marked = boxes.filter(Boolean).length;
  return `
    <div class="stress-row">
      <span class="stress-name">${escapeHtml(track.name)}</span>
      <div class="box-track" role="img" aria-label="${escapeHtml(track.name)} stress: ${boxes.length ? boxes.map((box, index) => `box ${index + 1} ${box ? "marked" : "clear"}`).join(", ") : "no boxes"}">
        ${boxes.map((box, index) => `<span class="track-box stress-sheet-box${box ? " is-filled" : ""}" aria-hidden="true">${box ? "X" : index + 1}</span>`).join("") || '<span class="muted">—</span>'}
      </div>
      <span class="stress-summary muted">${marked}/${boxes.length}</span>
    </div>`;
};

const renderFateSheet = (sheet) => {
  const aspects = sheet.aspects || {};
  const aspectRows = [
    ["High Concept", aspects.highConcept],
    ["Trouble", aspects.trouble],
    ...(aspects.other || []).map((aspect) => ["Aspect", aspect])
  ].filter(([, text]) => text);
  const tiers = [...new Set((sheet.skills || []).map((skill) => skill.rating))].sort((left, right) => right - left);

  return `
    <div class="fate-sheet">
      <dl class="fact-strip">
        <div><dt>Refresh</dt><dd>${escapeHtml(sheet.refresh ?? "—")}</dd></div>
        ${sheet.fatePoints !== null && sheet.fatePoints !== undefined ? `<div><dt>Fate Points</dt><dd>${escapeHtml(sheet.fatePoints)}</dd></div>` : ""}
      </dl>
      <section class="detail-block">
        <h3>Aspects</h3>
        ${aspectRows.length ? `<dl class="aspect-list">${aspectRows.map(([label, text]) => `<div><dt>${label}</dt><dd>${escapeHtml(text)}</dd></div>`).join("")}</dl>` : '<p class="muted">No aspects recorded.</p>'}
      </section>
      <div class="detail-grid">
        <section class="detail-block">
          <h3>Skills</h3>
          ${tiers.length ? `<div class="skill-ladder">${tiers.map((rating) => `
            <div class="skill-tier">
              <span class="skill-rating">${escapeHtml(ladderLabel(rating))}</span>
              <span class="skill-names">${sheet.skills.filter((skill) => skill.rating === rating).map((skill) => `<span class="skill-chip">${escapeHtml(skill.name)}</span>`).join("")}</span>
            </div>`).join("")}</div>` : '<p class="muted">No skills recorded.</p>'}
        </section>
        <section class="detail-block">
          <h3>Stress</h3>
          ${(sheet.stress || []).length ? sheet.stress.map(renderStressTrack).join("") : '<p class="muted">No stress tracks.</p>'}
          <h3 class="sheet-subheading">Consequences</h3>
          ${(sheet.consequences || []).length ? `<ul class="consequence-slots">${sheet.consequences.map((consequence) => `
            <li><span class="consequence-shift" title="Absorbs ${escapeHtml(consequence.shift)} shifts">${escapeHtml(consequence.shift)}</span>
              <span class="consequence-label">${escapeHtml(consequence.label)}</span>
              <span class="${consequence.aspect ? "consequence-aspect" : "muted"}">${escapeHtml(consequence.aspect || "Free")}</span></li>`).join("")}</ul>` : '<p class="muted">No consequence slots.</p>'}
        </section>
      </div>
      <section class="detail-block">
        <h3>Stunts</h3>
        ${(sheet.stunts || []).length ? `<ul class="stunt-list">${sheet.stunts.map((stunt) => `<li>${stunt.name ? `<strong>${escapeHtml(stunt.name)}.</strong> ` : ""}${escapeHtml(stunt.description)}</li>`).join("")}</ul>` : '<p class="muted">No stunts recorded.</p>'}
      </section>
      ${sheet.extras ? `<section class="detail-block"><h3>Extras</h3>${paragraphs(sheet.extras)}</section>` : ""}
    </div>`;
};

/* The editable sheet is a copy of assets/character-sheet.html with the sheet embedded as JSON.
   The content manager's "Import sheet file" reads the same JSON back out. */
const SHEET_FILE_FORMAT = "nowhere-expeditions/fate-sheet";
const SHEET_DATA_MARKER = '<script type="application/json" id="nowhere-sheet-data">null</script>';

const downloadEditableSheet = async (character) => {
  const response = await fetch("assets/character-sheet.html");
  if (!response.ok) throw new Error(`Sheet template unavailable: ${response.status}`);
  const template = await response.text();
  if (!template.includes(SHEET_DATA_MARKER)) throw new Error("Sheet template is missing its data block.");
  const envelope = {
    format: SHEET_FILE_FORMAT,
    version: 1,
    characterId: character.id,
    characterName: character.name,
    exportedAt: new Date().toISOString(),
    savedAt: null,
    sheet: character.sheet
  };
  // Function replacements keep "$" in sheet text literal; "<" is escaped so text cannot close the script block.
  const html = template
    .replace(SHEET_DATA_MARKER, () => `<script type="application/json" id="nowhere-sheet-data">${JSON.stringify(envelope).replace(/</g, "\\u003c")}</script>`)
    .replace("<title>Character Sheet", () => `<title>${escapeHtml(character.name)} — Character Sheet`);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  link.download = `${character.id}-sheet.html`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

/* ---------- Characters ---------- */

const renderCharacterRoster = async () => {
  const root = document.getElementById("character-roster");
  if (!root) return;

  try {
    const campaign = await loadCampaign();
    const sorted = [...campaign.characters].sort((left, right) => String(left.name).localeCompare(String(right.name)));

    const rosterCard = (character) => `
      <a class="card character-card" href="#${encodeURIComponent(character.id)}">
        ${avatar(character, "avatar avatar-large")}
        <span class="character-card-body">
          <span class="character-name">${escapeHtml(character.name)}</span>
          <span class="meta-row"><span class="pill pill-small">${character.type === "npc" ? "NPC" : "PC"}</span>${statusPill(character.status, "pill pill-small")}</span>
          ${character.summary ? `<span class="character-summary">${escapeHtml(character.summary)}</span>` : ""}
        </span>
      </a>`;

    const renderRoster = () => {
      const groups = [
        ["Expeditioners", sorted.filter((character) => character.type !== "npc")],
        ["Known Figures", sorted.filter((character) => character.type === "npc")]
      ];
      root.innerHTML = groups.map(([title, members]) => `
        <section class="roster-section" aria-label="${title}">
          <h2 class="board-section-title">${title}</h2>
          ${members.length ? `<div class="roster-grid">${members.map(rosterCard).join("")}</div>` : '<p class="muted">None on record.</p>'}
        </section>`).join("");
    };

    const renderProfile = (character) => {
      const history = campaign.expeditionsForCharacter(character.id);
      root.innerHTML = `
        <a class="back-link" href="characters.html">← All characters</a>
        <article class="detail-surface record-surface">
          <div class="profile-head">
            ${avatar(character, "avatar avatar-portrait")}
            <div>
              <span class="pill">${character.type === "npc" ? "NPC" : "Player Character"}</span>
              <h2>${escapeHtml(character.name)}</h2>
              <p class="meta-row">${statusPill(character.status)}${character.type !== "npc" && character.playerName ? `<span class="muted">Played by ${escapeHtml(character.playerName)}</span>` : ""}</p>
              ${paragraphs(character.summary, "No public summary.")}
            </div>
          </div>
          ${character.sheet ? `
            <div class="profile-tabs" role="tablist" aria-label="Character record">
              <button type="button" class="profile-tab" role="tab" id="tab-profile" aria-controls="panel-profile" data-profile-tab="profile">Profile</button>
              <button type="button" class="profile-tab" role="tab" id="tab-sheet" aria-controls="panel-sheet" data-profile-tab="sheet">Character Sheet</button>
            </div>` : ""}
          <div class="detail-block" id="panel-profile" ${character.sheet ? 'role="tabpanel" aria-labelledby="tab-profile"' : ""}>
            <h3>Expedition History</h3>
            ${history.length ? `<ul class="archive-list">${history.map((expedition) => {
              const gate = campaign.gateById.get(expedition.gateId);
              return `<li><a class="archive-row" href="expeditions.html#${encodeURIComponent(expedition.id)}">
                <span class="archive-title">${escapeHtml(expeditionLabel(expedition))}</span>
                <span class="archive-meta">${escapeHtml([expedition.organizerId === character.id ? "Organizer" : "Crew", gateLabel(gate), expedition.scheduledAt ? formatSchedule(expedition.scheduledAt) : ""].filter(Boolean).join(" · "))}</span>
                <span class="archive-status">${statusPill(expedition.status, "pill pill-small")}</span>
              </a></li>`;
            }).join("")}</ul>` : '<p class="muted">No expeditions on record.</p>'}
          </div>
          ${character.sheet ? `<div id="panel-sheet" role="tabpanel" aria-labelledby="tab-sheet">
            <div class="sheet-download">
              <button type="button" class="destination-link" data-download-sheet>Download editable sheet <span aria-hidden="true">↓</span></button>
              <p class="muted">A single file you can open in a desktop browser, edit during play, and save as you go. After the session, send the saved file to the GM.</p>
            </div>
            ${renderFateSheet(character.sheet)}
          </div>` : ""}
        </article>`;
      if (character.sheet) {
        setupProfileTabs(character);
        const button = root.querySelector("[data-download-sheet]");
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await downloadEditableSheet(character);
          } catch (error) {
            console.error(error);
            alert("The editable sheet could not be created. Please try again.");
          } finally {
            button.disabled = false;
          }
        });
      }
    };

    // Tabs keep the chosen panel in the URL (characters.html#id#sheet) so a sheet can be linked directly.
    const setupProfileTabs = (character) => {
      const tabs = [...root.querySelectorAll("[data-profile-tab]")];
      const select = (name, focus = false) => {
        tabs.forEach((tab) => {
          const active = tab.dataset.profileTab === name;
          tab.setAttribute("aria-selected", String(active));
          tab.tabIndex = active ? 0 : -1;
          document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
          if (active && focus) tab.focus();
        });
        window.history.replaceState(null, "", `#${encodeURIComponent(character.id)}${name === "sheet" ? "#sheet" : ""}`);
      };
      tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.profileTab)));
      root.querySelector(".profile-tabs").addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        select(tabs[next].dataset.profileTab, true);
      });
      select(window.location.hash.split("#")[2] === "sheet" ? "sheet" : "profile");
    };

    const route = () => {
      const character = campaign.characterById.get(selectedHash());
      if (character) {
        renderProfile(character);
        root.scrollIntoView({ block: "start" });
      } else if (sorted.length) {
        renderRoster();
      } else {
        root.innerHTML = '<div class="card"><p class="muted">No characters are on public record yet.</p></div>';
      }
    };

    window.addEventListener("hashchange", route);
    route();
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Character data could not be loaded.</p></div>';
    console.error(error);
  }
};

const initializeDestinationCarousel = () => {
  const carousel = document.querySelector(".destination-carousel");
  if (!carousel) return;

  const slides = [...carousel.querySelectorAll("[data-carousel-slide]")];
  const dots = [...carousel.querySelectorAll("[data-carousel-to]")];
  const currentLabel = carousel.querySelector("[data-carousel-current]");
  let activeIndex = 0;

  const showSlide = (index) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeIndex;
      slide.hidden = !isActive;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });
    dots.forEach((dot, dotIndex) => {
      dot.setAttribute("aria-current", String(dotIndex === activeIndex));
    });
    if (currentLabel) currentLabel.textContent = String(activeIndex + 1).padStart(2, "0");
  };

  carousel.querySelector("[data-carousel-previous]")?.addEventListener("click", () => showSlide(activeIndex - 1));
  carousel.querySelector("[data-carousel-next]")?.addEventListener("click", () => showSlide(activeIndex + 1));
  dots.forEach((dot) => dot.addEventListener("click", () => showSlide(Number(dot.dataset.carouselTo))));
  carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showSlide(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showSlide(activeIndex + 1);
    }
  });

  showSlide(activeIndex);
};

const setActiveNav = () => {
  const current = window.location.pathname.split("/").pop() || "index.html";
  const links = document.querySelectorAll(".nav-link");
  links.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const pageName = href.split("/").pop();
    if (pageName === current) {
      link.classList.add("active");
    }
  });
};


document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav();
  initializeDestinationCarousel();
  renderIsland();

  const page = document.body.dataset.page;
  if (page === "rules") await renderRules();
  else if (page === "expeditions") await renderExpeditionBoard();
  else if (page === "gates") await renderGateArchive();
  else if (page === "characters") await renderCharacterRoster();
});
