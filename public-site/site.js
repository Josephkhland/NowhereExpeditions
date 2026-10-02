const rollButton = (label, modifier, className = "") => window.NowhereDice
  ? window.NowhereDice.button(label, modifier).replace('class="nx-roll"', `class="nx-roll ${className}"`)
  : "";

const formatStatus = (status = "UNKNOWN") => {
  const normalized = String(status).trim().toUpperCase().replace(/-/g, " ");
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
    OPEN: "status-ready",
    SCHEDULED: "status-active",
    "IN PROGRESS": "status-observed",
    COMPLETED: "status-unknown",
    CANCELLED: "status-locked",
    INACTIVE: "status-unknown",
    MISSING: "status-observed",
    DECEASED: "status-locked",
    SUCCESS: "status-ready",
    PARTIAL: "status-observed",
    FAILED: "status-locked",
    ABORTED: "status-locked",
    COMMON: "status-ready",
    RESTRICTED: "status-observed",
    RARE: "status-active",
    UNAVAILABLE: "status-locked"
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

/* ---------- Outpost Sheet ---------- */

const renderOutpost = async () => {
  const root = document.getElementById("outpost-overview");
  if (!root) return;

  try {
    const outpost = await fetchJson("data/outpost.json");

    const facilityMarkup = (outpost.facilities || [])
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

    const projectMarkup = (outpost.activeProjects || [])
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

    const conditionMarkup = (outpost.conditions || [])
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

    const capabilityRows = (outpost.capabilities || [])
      .map((capability) => {
        const targetId = `${slugify(capability.name)}-detail`;
        return `
          <tr class="capability-row">
            <th scope="row">${capability.name}</th>
            <td class="rating-cell"><span class="rating-roll">${capability.rating}${rollButton(`${outpost.name || "Outpost"} · ${capability.name}`, parseInt(capability.rating, 10) || 0, "capability-roll")}</span></td>
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

    const consequenceMarkup = (outpost.consequences || [])
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
            <span class="kicker">Outpost Sheet</span>
            <h1>${outpost.name}</h1>
            <p class="lede"><strong>High Concept:</strong> ${outpost.highConcept}</p>
            <p class="lede"><strong>Trouble:</strong> ${outpost.trouble}</p>
            <div class="hero-meta">
              ${(outpost.aspects || []).map((aspect) => `<span class="tag">${aspect}</span>`).join("")}
            </div>
          </div>
          <div class="status-box">
            <div class="label">Outpost Stress</div>
            ${renderBoxTrack(outpost.stress.current, outpost.stress.max, "Outpost stress", "stress-track")}
            <p class="track-count">${outpost.stress.current}/${outpost.stress.max} boxes marked</p>
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
    root.innerHTML = '<div class="card"><p>Outpost data could not be loaded.</p></div>';
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

/* ---------- Campaign records: Characters, Jobs, Archive, Gear ---------- */

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
    campaignPromise = Promise.all(["characters", "jobs", "archive", "gear"].map(fetchCollection))
      .then(([characters, jobs, archive, gear]) => {
        const byId = (items) => new Map(items.map((item) => [item.id, item]));
        const mentions = (item, id) => [item.summary, item.content, item.objective, item.briefing]
          .some((text) => String(text || "").includes(`[[${id}]]`) || String(text || "").includes(`[[${id}|`));
        return {
          characters, jobs, archive, gear,
          characterById: byId(characters),
          jobById: byId(jobs),
          archiveById: byId(archive),
          gearById: byId(gear),
          // Relationships are derived from references, never stored on the referenced record.
          jobForSessionRecord: (entryId) => jobs.find((job) => job.sessionRecordId === entryId),
          jobsForCharacter: (characterId) => jobs
            .filter((job) => job.organizerId === characterId || (job.participantIds || []).includes(characterId))
            .sort(byScheduleAscending),
          sessionRecordsForCharacter: (characterId) => archive
            .filter((entry) => entry.type === "session-record" && (entry.participantIds || []).includes(characterId))
            .sort(byDate("publishedAt")),
          // "What links here" for the Archive, read from the [[id]] links in authored text.
          referencesTo: (entryId) => ({
            entries: archive.filter((entry) => entry.id !== entryId && mentions(entry, entryId)),
            jobs: jobs.filter((job) => mentions(job, entryId))
          })
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
const humanize = (value = "") => capitalize(String(value).replace(/-/g, " "));

const paragraphs = (text, fallback = "NO DATA") => {
  const blocks = String(text || "").split(/\n\s*\n|\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.length ? blocks.map((block) => `<p>${escapeHtml(block)}</p>`).join("") : `<p class="muted">${fallback}</p>`;
};

const itemList = (items, fallback = "NO DATA") => Array.isArray(items) && items.length
  ? `<ul class="clean-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
  : `<p class="muted">${fallback}</p>`;

/* Authored text: one paragraph per line, "## " headings, "- " lists, **bold**, *italic*,
   [[archive-id]] / [[archive-id|text]] links to Archive entries, and [text](page.html#id) links. */
const richInline = (text, campaign) => escapeHtml(text)
  .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (match, id, label) => {
    const entry = campaign.archiveById.get(id);
    if (!entry) return label || "[record unavailable]";
    return `<a class="inline-link archive-link" href="archive.html#${encodeURIComponent(id)}">${label || escapeHtml(entry.title)}</a>`;
  })
  .replace(/\[([^\]]+)\]\(((?:https?:\/\/|[a-z0-9-]+\.html)[^\s)]*)\)/g, (match, label, href) =>
    `<a class="inline-link" href="${href}"${/^https?:/.test(href) ? ' rel="noopener"' : ""}>${label}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>");

const richText = (text, campaign, fallback = "NO DATA") => {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return `<p class="muted">${fallback}</p>`;
  const output = [];
  let list = [];
  const flush = () => {
    if (list.length) output.push(`<ul class="clean-list">${list.map((item) => `<li>${richInline(item, campaign)}</li>`).join("")}</ul>`);
    list = [];
  };
  lines.forEach((line) => {
    if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
      return;
    }
    flush();
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    output.push(heading ? `<h4 class="rich-heading">${richInline(heading[2], campaign)}</h4>` : `<p>${richInline(line, campaign)}</p>`);
  });
  flush();
  return `<div class="rich-text">${output.join("")}</div>`;
};

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

const jobLabel = (job) => [job.designation, job.title].filter(Boolean).join(" — ");

const characterLink = (character) => character
  ? `<a class="inline-link" href="characters.html#${encodeURIComponent(character.id)}">${escapeHtml(character.name)}</a>`
  : "";

const archiveLink = (entry, text = entry?.title) => entry
  ? `<a class="inline-link" href="archive.html#${encodeURIComponent(entry.id)}">${escapeHtml(text)}</a>`
  : "";

const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";

const avatar = (character, className = "avatar") => character.portrait
  ? `<span class="${className}"><img src="${escapeHtml(character.portrait)}" alt="" loading="lazy" /></span>`
  : `<span class="${className} avatar-empty" aria-hidden="true">${escapeHtml(initials(character.name))}</span>`;

const crewList = (characters, emptyText) => characters.length
  ? `<ul class="crew-list">${characters.map((character) => `
      <li><a class="crew-chip" href="characters.html#${encodeURIComponent(character.id)}">${avatar(character)}<span>${escapeHtml(character.name)}</span></a></li>`).join("")}</ul>`
  : `<p class="muted">${emptyText}</p>`;

const crewCount = (job) => {
  const count = Number.isFinite(job.crewCount) ? job.crewCount : (job.participantIds || []).length;
  return job.crewMax ? `Crew ${count} / ${job.crewMax}` : `Crew ${count}`;
};

const selectedHash = () => decodeURIComponent(window.location.hash.slice(1).split("#")[0]);

/* ---------- Job Board ---------- */

const ACTIVE_JOB_STATUSES = ["open", "scheduled", "in-progress"];
const JOB_TYPES = ["expedition", "recovery", "investigation", "escort", "bounty", "outpost", "other"];

const renderJobBoard = async () => {
  const root = document.getElementById("job-board");
  if (!root) return;

  try {
    const campaign = await loadCampaign();
    let typeFilter = "";

    const jobCard = (job) => {
      const organizer = campaign.characterById.get(job.organizerId);
      const href = `#${encodeURIComponent(job.id)}`;
      const facts = [job.scheduledAt ? formatSchedule(job.scheduledAt) : "", (job.crewMax || job.crewCount) ? crewCount(job) : ""].filter(Boolean);
      return `
        <article class="card board-card">
          <div class="board-card-head">
            <span class="board-kicker">${escapeHtml(humanize(job.type))}</span>
            ${statusPill(job.status)}
          </div>
          <h3><a href="${href}">${escapeHtml(job.title)}</a></h3>
          <p class="board-objective">${richInline(job.summary || job.objective || "NO DATA", campaign)}</p>
          ${facts.length ? `<p class="board-facts">${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</p>` : ""}
          ${organizer || job.postedBy ? `<p class="board-organizer">${organizer ? `Organized by ${characterLink(organizer)}` : `Posted by ${escapeHtml(job.postedBy)}`}</p>` : ""}
          <a class="board-link" href="${href}">View job <span aria-hidden="true">→</span></a>
        </article>`;
    };

    const closedRow = (job) => {
      const record = campaign.archiveById.get(job.sessionRecordId);
      return `
        <li>
          <a class="archive-row" href="#${encodeURIComponent(job.id)}">
            <span class="archive-title">${escapeHtml(jobLabel(job))}</span>
            <span class="archive-meta">${escapeHtml([humanize(job.type), job.scheduledAt ? formatSchedule(job.scheduledAt) : ""].filter(Boolean).join(" · "))}</span>
            <span class="archive-status">${record ? "Session record" : "No record"} ${statusPill(job.status, "pill pill-small")}</span>
          </a>
        </li>`;
    };

    const renderBoard = () => {
      const matches = (job) => !typeFilter || job.type === typeFilter;
      const active = campaign.jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status) && matches(job))
        .sort((left, right) => ACTIVE_JOB_STATUSES.indexOf(left.status) - ACTIVE_JOB_STATUSES.indexOf(right.status) || byScheduleAscending(left, right));
      const closed = campaign.jobs.filter((job) => !ACTIVE_JOB_STATUSES.includes(job.status) && matches(job))
        .sort((left, right) => byScheduleAscending(right, left));
      const usedTypes = JOB_TYPES.filter((type) => campaign.jobs.some((job) => job.type === type));
      root.innerHTML = `
        ${usedTypes.length > 1 ? `<div class="filter-bar" role="group" aria-label="Filter jobs by type">
          ${[["", "All jobs"], ...usedTypes.map((type) => [type, humanize(type)])].map(([type, label]) => `
            <button type="button" class="filter-chip" data-job-type="${type}" aria-pressed="${typeFilter === type}">${escapeHtml(label)}</button>`).join("")}
        </div>` : ""}
        <section aria-labelledby="open-jobs-head">
          <h2 id="open-jobs-head" class="board-section-title">Open Listings</h2>
          ${active.length ? `<div class="board-grid">${active.map(jobCard).join("")}</div>` : '<div class="card"><p class="muted">No jobs are posted right now.</p></div>'}
        </section>
        <section class="archive-section" aria-labelledby="closed-jobs-head">
          <h2 id="closed-jobs-head" class="board-section-title">Closed Listings</h2>
          ${closed.length ? `<ul class="archive-list">${closed.map(closedRow).join("")}</ul>` : '<p class="muted">No closed jobs yet.</p>'}
        </section>`;
      root.querySelectorAll("[data-job-type]").forEach((button) => button.addEventListener("click", () => {
        typeFilter = button.dataset.jobType;
        renderBoard();
        root.querySelector(`[data-job-type="${typeFilter}"]`)?.focus();
      }));
    };

    const renderJob = (job) => {
      const organizer = campaign.characterById.get(job.organizerId);
      const participants = (job.participantIds || []).map((id) => campaign.characterById.get(id)).filter(Boolean);
      const hidden = Number.isFinite(job.crewCount) ? job.crewCount - participants.length : 0;
      const record = campaign.archiveById.get(job.sessionRecordId);
      const crewSize = [job.crewMin ? `min ${job.crewMin}` : "", job.crewMax ? `max ${job.crewMax}` : ""].filter(Boolean).join(", ");
      root.innerHTML = `
        <a class="back-link" href="jobs.html">← Job Board</a>
        <article class="detail-surface record-surface">
          <div class="detail-heading">
            <div>
              ${job.designation ? `<span class="pill">${escapeHtml(job.designation)}</span>` : ""}
              <h2>${escapeHtml(job.title)}</h2>
              <p class="muted dossier-meta">${escapeHtml(humanize(job.type))}${job.postedBy ? ` · Posted by ${escapeHtml(job.postedBy)}` : ""}</p>
            </div>
            ${statusPill(job.status)}
          </div>
          ${record ? `<a class="destination-link session-record-link" href="archive.html#${encodeURIComponent(record.id)}">View session record <span aria-hidden="true">→</span></a>` : ""}
          <dl class="fact-strip">
            <div><dt>When</dt><dd>${escapeHtml(formatSchedule(job.scheduledAt))}</dd></div>
            ${job.expectedDuration ? `<div><dt>Duration</dt><dd>${escapeHtml(job.expectedDuration)}</dd></div>` : ""}
            <div><dt>Crew</dt><dd>${escapeHtml(crewCount(job))}${crewSize ? ` <span class="muted">(${escapeHtml(crewSize)})</span>` : ""}</dd></div>
            <div><dt>Organizer</dt><dd>${organizer ? characterLink(organizer) : "Not assigned"}</dd></div>
          </dl>
          ${job.summary ? `<p class="lede job-summary">${richInline(job.summary, campaign)}</p>` : ""}
          <div class="detail-block"><h3>Objective</h3>${richText(job.objective, campaign)}</div>
          ${job.briefing ? `<div class="detail-block"><h3>Briefing</h3>${richText(job.briefing, campaign)}</div>` : ""}
          ${(job.requirements || []).length ? `<div class="detail-block"><h3>Requirements</h3>${itemList(job.requirements)}</div>` : ""}
          <div class="detail-block">
            <h3>Crew</h3>
            ${crewList(participants, "No crew signed on yet.")}
            ${hidden > 0 ? `<p class="muted">+${hidden} unlisted crew member${hidden > 1 ? "s" : ""}.</p>` : ""}
          </div>
          <div class="detail-block">
            <h3>Session Record</h3>
            ${record ? `<p>${archiveLink(record)}${record.summary ? ` — ${richInline(record.summary, campaign)}` : ""}</p>` : '<p class="muted">No session record filed yet.</p>'}
          </div>
        </article>`;
    };

    const route = () => {
      const job = campaign.jobById.get(selectedHash());
      if (job) {
        renderJob(job);
        root.scrollIntoView({ block: "start" });
      } else {
        renderBoard();
      }
    };

    window.addEventListener("hashchange", route);
    route();
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Job data could not be loaded.</p></div>';
    console.error(error);
  }
};

/* ---------- Archive: the campaign's lore, one entry per page ---------- */

const ARCHIVE_CATEGORIES = [
  ["", "All"], ["gate-record", "Gate Records"], ["session-record", "Session Records"],
  ["newspaper", "Newspaper"], ["history", "History"], ["folklore", "Folklore"]
];
const ARCHIVE_TYPE_LABELS = { "gate-record": "Gate Record", "session-record": "Session Record", newspaper: "Newspaper", history: "History", folklore: "Folklore" };
const archiveTypeLabel = (type) => ARCHIVE_TYPE_LABELS[type] || humanize(type);

/* ---------- Archive Explore mode: a neighborhood view of how records link ---------- */

// Every connection is derived from published data at page load; nothing about the graph is stored.
// Archive entries and Jobs link with [[archive-id]] and [text](jobs.html#id) in their text; Jobs point at their
// Session Record; Session Records and Jobs list their crew; Jobs name an organizer.
const LORE_TYPE_COLORS = { "gate-record": "#7ad7d1", "session-record": "#e0a85d", newspaper: "#c8d3d6", history: "#b9a3e3", folklore: "#7dcf98" };
const LORE_KIND_ORDER = { archive: 0, job: 1, character: 2 };

const buildLoreGraph = (campaign) => {
  const nodes = new Map();
  const addNode = (kind, record, label, extra) => nodes.set(`${kind}:${record.id}`, { key: `${kind}:${record.id}`, kind, id: record.id, label, ...extra });
  campaign.archive.forEach((entry) => addNode("archive", entry, entry.title, { type: entry.type, summary: entry.summary, href: `archive.html#${encodeURIComponent(entry.id)}` }));
  campaign.jobs.forEach((job) => addNode("job", job, job.title, { type: job.type, summary: job.summary || job.objective, href: `jobs.html#${encodeURIComponent(job.id)}` }));
  campaign.characters.forEach((character) => addNode("character", character, character.name, { type: character.type, summary: character.summary, href: `characters.html#${encodeURIComponent(character.id)}` }));

  const edges = new Map();
  const addEdge = (from, to, kind) => {
    if (from !== to && nodes.has(from) && nodes.has(to)) edges.set(`${from}|${to}|${kind}`, { from, to, kind });
  };
  const textLinks = (from, texts) => {
    const text = texts.filter(Boolean).join("\n");
    for (const match of text.matchAll(/\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g)) addEdge(from, `archive:${match[1]}`, "link");
    for (const match of text.matchAll(/\b(archive|jobs|characters)\.html#([a-z0-9-]+)/g)) {
      addEdge(from, `${{ archive: "archive", jobs: "job", characters: "character" }[match[1]]}:${match[2]}`, "link");
    }
  };
  campaign.archive.forEach((entry) => {
    textLinks(`archive:${entry.id}`, [entry.summary, entry.content]);
    (entry.participantIds || []).forEach((id) => addEdge(`archive:${entry.id}`, `character:${id}`, "crew"));
  });
  campaign.jobs.forEach((job) => {
    textLinks(`job:${job.id}`, [job.summary, job.objective, job.briefing]);
    if (job.sessionRecordId) addEdge(`job:${job.id}`, `archive:${job.sessionRecordId}`, "session-record");
    (job.participantIds || []).forEach((id) => addEdge(`job:${job.id}`, `character:${id}`, "crew"));
    if (job.organizerId) addEdge(`job:${job.id}`, `character:${job.organizerId}`, "organizer");
  });

  // Neighbors of one node, merged per neighbor so two-way or multi-kind connections draw as one line.
  const neighbors = (key, { jobs = true, characters = true } = {}) => {
    const merged = new Map();
    for (const edge of edges.values()) {
      const outgoing = edge.from === key;
      if (!outgoing && edge.to !== key) continue;
      const other = nodes.get(outgoing ? edge.to : edge.from);
      if ((other.kind === "job" && !jobs) || (other.kind === "character" && !characters)) continue;
      const item = merged.get(other.key) || { node: other, out: false, in: false, kinds: new Set(), relations: new Set() };
      item[outgoing ? "out" : "in"] = true;
      item.kinds.add(edge.kind);
      item.relations.add(loreRelation(edge.kind, outgoing, nodes.get(key).kind));
      merged.set(other.key, item);
    }
    return [...merged.values()].sort((left, right) => LORE_KIND_ORDER[left.node.kind] - LORE_KIND_ORDER[right.node.kind]
      || String(left.node.label).localeCompare(String(right.node.label)));
  };
  return { nodes, neighbors };
};

// How a neighbor relates to the record in the center, in plain words.
const loreRelation = (kind, outgoing, centerKind) => {
  if (kind === "link") return outgoing ? "mentioned here" : "mentions this";
  if (kind === "session-record") return centerKind === "job" ? "session record" : "job recorded here";
  if (kind === "organizer") return outgoing ? "organizer" : "organized";
  return outgoing ? "crew" : centerKind === "character" ? "took part" : "crew of";
};

const loreKindLabel = (node) => node.kind === "archive" ? archiveTypeLabel(node.type) : node.kind === "job" ? `Job · ${humanize(node.type)}` : node.type === "npc" ? "NPC" : "Character";

const loreShape = (node, size) => {
  if (node.kind === "job") {
    return `<polygon class="lore-shape" points="0,${-size} ${size},0 0,${size} ${-size},0" fill="#0b1214" stroke="#6fa8dc" stroke-width="2.5" />`;
  }
  if (node.kind === "character") {
    return `<circle class="lore-shape" r="${size}" fill="#0b1214" stroke="#e7f0f2" stroke-width="2" />
      <text class="lore-initials" text-anchor="middle" dy="0.35em" font-size="${Math.round(size * 0.75)}">${escapeHtml(initials(node.label))}</text>`;
  }
  return `<circle class="lore-shape" r="${size}" fill="${LORE_TYPE_COLORS[node.type] || "#aebec2"}" stroke="#0b1214" stroke-width="2" />`;
};

const truncate = (text, length) => text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;

const renderLoreGraph = (svgHost, graph, center, neighborItems) => {
  const width = Math.max(320, Math.min(1180, svgHost.clientWidth || 800));
  const height = Math.round(Math.max(360, Math.min(620, width * 0.62)));
  const cx = width / 2;
  const cy = height / 2;
  const shown = neighborItems.slice(0, 24);
  const outerRadius = Math.min(width / 2 - (width < 600 ? 70 : 140), height / 2 - 48);
  const rings = shown.length > 12 ? [shown.filter((_, index) => index % 2 === 0), shown.filter((_, index) => index % 2 === 1)] : [shown];
  const labelLength = width < 600 ? 14 : 26;
  const positioned = rings.flatMap((ring, ringIndex) => ring.map((item, index) => {
    const radius = rings.length === 1 ? outerRadius : ringIndex === 0 ? outerRadius * 0.62 : outerRadius;
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / ring.length + (ringIndex === 1 ? Math.PI / ring.length : 0);
    return { ...item, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), angle };
  }));
  const centerSize = 24;
  const nodeSize = width < 600 ? 11 : 14;

  const edge = (item) => {
    const dx = item.x - cx;
    const dy = item.y - cy;
    const distance = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / distance, dy / distance];
    const start = [cx + ux * (centerSize + 4), cy + uy * (centerSize + 4)];
    const end = [item.x - ux * (nodeSize + 4), item.y - uy * (nodeSize + 4)];
    const dash = item.kinds.has("link") ? "" : item.kinds.has("session-record") ? "7 5" : "2 5";
    // Lines run center -> neighbor; arrowheads show which way each link points.
    return `<line class="lore-edge" x1="${start[0].toFixed(1)}" y1="${start[1].toFixed(1)}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}"
      ${dash ? `stroke-dasharray="${dash}"` : ""} ${item.out ? 'marker-end="url(#lore-arrow)"' : ""} ${item.in ? 'marker-start="url(#lore-arrow-back)"' : ""} />`;
  };

  const label = (item) => {
    const cos = Math.cos(item.angle);
    const sin = Math.sin(item.angle);
    const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
    const offset = nodeSize + 7;
    const x = item.x + cos * offset;
    const y = item.y + sin * offset + (sin > 0.3 ? 9 : sin < -0.3 ? -2 : 4);
    // Fit the label into the room left on its side of the canvas (about 6.5px per character at 12px).
    const room = anchor === "start" ? width - x - 6 : anchor === "end" ? x - 6 : 2 * Math.min(x, width - x) - 12;
    const fits = Math.max(6, Math.min(labelLength, Math.floor(room / 6.5)));
    return `<text class="lore-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${escapeHtml(truncate(item.node.label, fits))}</text>`;
  };

  svgHost.innerHTML = `
    <svg class="lore-graph" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="lore-graph-title">
      <title id="lore-graph-title">Connections of ${escapeHtml(center.label)}: ${neighborItems.length} linked records. The list below the graph has the same information.</title>
      <defs>
        <marker id="lore-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8ea3a8" /></marker>
        <marker id="lore-arrow-back" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="#8ea3a8" /></marker>
      </defs>
      <g class="lore-edges">${positioned.map(edge).join("")}</g>
      ${positioned.map((item) => `
        <a class="lore-node lore-${item.node.kind}" href="#explore/${item.node.kind}/${encodeURIComponent(item.node.id)}">
          <title>${escapeHtml(item.node.label)} (${escapeHtml(loreKindLabel(item.node))}): ${escapeHtml([...item.relations].join(", "))}</title>
          <g transform="translate(${item.x.toFixed(1)} ${item.y.toFixed(1)})">${loreShape(item.node, nodeSize)}</g>
          ${label(item)}
        </a>`).join("")}
      <a class="lore-node lore-center lore-${center.kind}" href="${center.href}">
        <title>${escapeHtml(center.label)} (${escapeHtml(loreKindLabel(center))}): open the full record</title>
        <g transform="translate(${cx} ${cy})">${loreShape(center, centerSize)}</g>
        <text class="lore-label lore-center-label" x="${cx}" y="${cy + centerSize + 20}" text-anchor="middle">${escapeHtml(truncate(center.label, labelLength + 14))}</text>
      </a>
      ${neighborItems.length ? "" : `<text class="lore-empty" x="${cx}" y="${cy + centerSize + 46}" text-anchor="middle">No connections on record yet.</text>`}
    </svg>`;
  return neighborItems.length - shown.length;
};

const LORE_PREFS_KEY = "nowhere-expeditions:explore";
const loreOptions = () => {
  try { return { jobs: true, characters: true, ...JSON.parse(localStorage.getItem(LORE_PREFS_KEY) || "{}") }; } catch { return { jobs: true, characters: true }; }
};

const renderLoreExplorer = (container, graph, key) => {
  const center = graph.nodes.get(key);
  if (!center) {
    container.innerHTML = '<p class="empty-state">That record is not on public record. <a class="inline-link" href="archive.html">Back to the Archive</a></p>';
    return;
  }
  const options = loreOptions();
  const items = graph.neighbors(key, options);
  const back = center.kind === "archive" ? `#${encodeURIComponent(center.id)}` : "archive.html";
  container.innerHTML = `
    <div class="explore-head">
      <a class="back-link" href="${back}">← ${center.kind === "archive" ? "Back to the record" : "Back to the Archive"}</a>
      <div class="explore-title">
        <span class="kicker">Explore · ${escapeHtml(loreKindLabel(center))}</span>
        <h2>${escapeHtml(center.label)}</h2>
      </div>
      <div class="explore-controls" role="group" aria-label="Show in the graph">
        <label class="explore-toggle"><input type="checkbox" data-explore-toggle="jobs" ${options.jobs ? "checked" : ""} />${loreShapeIcon("job")}Jobs</label>
        <label class="explore-toggle"><input type="checkbox" data-explore-toggle="characters" ${options.characters ? "checked" : ""} />${loreShapeIcon("character")}Characters</label>
      </div>
    </div>
    <div class="explore-canvas" id="explore-canvas"></div>
    <p class="muted explore-more" id="explore-more" hidden></p>
    <div class="explore-legend" aria-label="Legend">
      ${Object.entries(LORE_TYPE_COLORS).map(([type, color]) => `<span><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" fill="${color}" /></svg>${escapeHtml(archiveTypeLabel(type))}</span>`).join("")}
      <span>${loreShapeIcon("job")}Job</span>
      <span>${loreShapeIcon("character")}Character</span>
      <span><svg viewBox="0 0 28 8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="#8ea3a8" stroke-width="2" /></svg>Link in text</span>
      <span><svg viewBox="0 0 28 8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="#8ea3a8" stroke-width="2" stroke-dasharray="7 5" /></svg>Session record</span>
      <span><svg viewBox="0 0 28 8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="#8ea3a8" stroke-width="2" stroke-dasharray="2 5" /></svg>Crew / organizer</span>
    </div>
    <div class="detail-grid explore-details">
      <section class="detail-block">
        <h3>${escapeHtml(loreKindLabel(center))}</h3>
        <p>${center.summary ? escapeHtml(truncate(center.summary.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (m, id, text) => text || graph.nodes.get(`archive:${id}`)?.label || id), 240)) : '<span class="muted">No summary.</span>'}</p>
        <a class="inline-link" href="${center.href}">Open the full record →</a>
      </section>
      <section class="detail-block">
        <h3>Connections (${items.length})</h3>
        ${items.length ? `<ul class="clean-list explore-list">${items.map((item) => `
          <li><a class="inline-link" href="#explore/${item.node.kind}/${encodeURIComponent(item.node.id)}">${escapeHtml(item.node.label)}</a>
            <span class="muted">${escapeHtml(loreKindLabel(item.node))} · ${escapeHtml([...item.relations].join(", "))}</span></li>`).join("")}</ul>`
          : '<p class="muted">No connections on record yet.</p>'}
      </section>
    </div>`;
  const draw = () => {
    const hidden = renderLoreGraph(container.querySelector("#explore-canvas"), graph, center, items);
    const more = container.querySelector("#explore-more");
    more.hidden = hidden <= 0;
    more.textContent = hidden > 0 ? `${hidden} more connection${hidden > 1 ? "s" : ""} are listed below the graph.` : "";
  };
  draw();
  container.querySelectorAll("[data-explore-toggle]").forEach((input) => input.addEventListener("change", () => {
    const next = { ...loreOptions(), [input.dataset.exploreToggle]: input.checked };
    try { localStorage.setItem(LORE_PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    renderLoreExplorer(container, graph, key);
    container.querySelector(`[data-explore-toggle="${input.dataset.exploreToggle}"]`)?.focus();
  }));
  return draw;
};

const loreShapeIcon = (kind) => kind === "job"
  ? '<svg viewBox="-8 -8 16 16" aria-hidden="true"><polygon points="0,-6 6,0 0,6 -6,0" fill="#0b1214" stroke="#6fa8dc" stroke-width="1.6" /></svg>'
  : '<svg viewBox="-8 -8 16 16" aria-hidden="true"><circle r="5.5" fill="#0b1214" stroke="#e7f0f2" stroke-width="1.4" /></svg>';

const renderArchive = async () => {
  const root = document.getElementById("archive");
  if (!root) return;

  try {
    const campaign = await loadCampaign();
    const sortKey = (entry) => entry.type === "gate-record" ? `0 ${entry.details?.designation || entry.title}` : `1 ${entry.publishedAt || entry.details?.sessionDate || ""} ${entry.title}`;
    const entries = [...campaign.archive].sort((left, right) => sortKey(left).localeCompare(sortKey(right), undefined, { numeric: true }));
    let query = "";
    let category = "";

    if (!entries.length) {
      root.innerHTML = '<div class="card"><p class="muted">The Archive holds no public records yet.</p></div>';
      return;
    }

    root.innerHTML = `
      <div id="archive-browse">
      <div class="filter-bar" role="group" aria-label="Archive categories">
        ${ARCHIVE_CATEGORIES.map(([type, label]) => `<button type="button" class="filter-chip" data-archive-type="${type}" aria-pressed="${type === category}">${label}</button>`).join("")}
      </div>
      <div class="browser-shell">
        <aside class="browser-sidebar">
          <label class="search-wrap" for="archive-search">
            <span class="sr-only">Search the Archive</span>
            <input id="archive-search" class="search-input" type="search" placeholder="Search the Archive..." />
          </label>
          <div id="archive-list" class="entry-list"></div>
        </aside>
        <div id="archive-detail" class="browser-detail"></div>
      </div>
      </div>
      <section id="archive-explore" class="explore" aria-label="Explore connections" hidden></section>`;
    const graph = buildLoreGraph(campaign);
    let redrawExplore = null;

    const entryMeta = (entry) => {
      if (entry.type === "gate-record") return entry.details?.designation || "Gate Record";
      if (entry.type === "session-record") return [formatDate(entry.details?.sessionDate), "Session Record"].filter(Boolean).join(" · ");
      return [archiveTypeLabel(entry.type), entry.eventDate || formatDate(entry.publishedAt)].filter(Boolean).join(" · ");
    };

    const gateDossier = (entry) => {
      const details = entry.details || {};
      return `
        <div class="detail-block"><h3>Overview</h3>${richText(entry.content, campaign)}</div>
        <div class="detail-block"><h3>Environment</h3>${paragraphs(details.environment, "NOT YET SURVEYED")}</div>
        <div class="detail-grid">
          <div class="detail-block"><h3>Known Traits</h3>${itemList(details.knownTraits)}</div>
          <div class="detail-block"><h3>Known Hazards</h3>${itemList(details.knownHazards)}</div>
        </div>
        <div class="detail-block"><h3>Known Locations</h3>${itemList(details.knownLocations)}</div>`;
    };

    const sessionFacts = (entry) => {
      const job = campaign.jobForSessionRecord(entry.id);
      const crew = (entry.participantIds || []).map((id) => campaign.characterById.get(id)).filter(Boolean);
      return `
        <dl class="fact-strip">
          <div><dt>Session</dt><dd>${escapeHtml(formatDate(entry.details?.sessionDate) || "Undated")}</dd></div>
          <div><dt>Outcome</dt><dd>${statusPill(entry.details?.outcome || "unknown", "pill pill-small")}</dd></div>
          <div><dt>Job</dt><dd>${job ? `<a class="inline-link" href="jobs.html#${encodeURIComponent(job.id)}">${escapeHtml(jobLabel(job))}</a>` : "Not linked"}</dd></div>
        </dl>
        <div class="detail-block"><h3>Crew</h3>${crewList(crew, "Crew not recorded.")}</div>`;
    };

    const renderDetail = (entry) => {
      const detail = document.getElementById("archive-detail");
      if (!entry) {
        detail.innerHTML = '<div class="empty-state">No matching records found.</div>';
        return;
      }
      const isGate = entry.type === "gate-record";
      const references = campaign.referencesTo(entry.id);
      const dateline = [entry.author ? `By ${escapeHtml(entry.author)}` : "", entry.publishedAt ? escapeHtml(formatDate(entry.publishedAt)) : "",
        entry.eventDate ? `Event: ${escapeHtml(entry.eventDate)}` : "", isGate && entry.details?.discoveredAt ? `Discovered ${escapeHtml(formatDate(entry.details.discoveredAt))}` : ""]
        .filter(Boolean).join(" · ");
      const referenceRows = [
        ...references.jobs.map((job) => `<li><a class="inline-link" href="jobs.html#${encodeURIComponent(job.id)}">${escapeHtml(jobLabel(job))}</a> <span class="muted">Job</span></li>`),
        ...references.entries.map((other) => `<li>${archiveLink(other)} <span class="muted">${escapeHtml(archiveTypeLabel(other.type))}</span></li>`)
      ];
      detail.innerHTML = `
        <article class="detail-surface archive-entry archive-${escapeHtml(entry.type)}">
          <div class="detail-heading">
            <div>
              <span class="pill">${escapeHtml(isGate ? entry.details?.designation || "GATE" : archiveTypeLabel(entry.type))}</span>
              <h2>${escapeHtml(entry.title)}</h2>
              ${entry.subtitle ? `<p class="archive-subtitle">${escapeHtml(entry.subtitle)}</p>` : ""}
              ${dateline ? `<p class="muted dossier-meta">${dateline}</p>` : ""}
            </div>
            <div class="detail-actions">
              ${isGate ? statusPill(entry.details?.gateStatus) : ""}
              <a class="explore-link" href="#explore/archive/${encodeURIComponent(entry.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="currentColor"/><circle cx="4.5" cy="5" r="2.2" fill="currentColor"/><circle cx="19.5" cy="5" r="2.2" fill="currentColor"/><circle cx="19.5" cy="19" r="2.2" fill="currentColor"/><circle cx="4.5" cy="19" r="2.2" fill="currentColor"/><path d="M6 6.5l4 3.5M18 6.5l-4 3.5M18 17.5l-4-3.5M6 17.5l4-3.5" stroke="currentColor" stroke-width="1.5"/></svg>Explore connections</a>
            </div>
          </div>
          ${entry.image ? `<figure class="archive-figure"><img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.title)}" loading="lazy" /></figure>` : ""}
          ${entry.summary ? `<p class="lede archive-summary">${richInline(entry.summary, campaign)}</p>` : ""}
          ${entry.type === "session-record" ? sessionFacts(entry) : ""}
          ${isGate ? gateDossier(entry) : `<div class="detail-block archive-body">${richText(entry.content, campaign, "No text on record.")}</div>`}
          ${(entry.tags || []).length ? `<div class="rule-tags" aria-label="Tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          ${referenceRows.length ? `<div class="detail-block"><h3>Referenced In</h3><ul class="clean-list">${referenceRows.join("")}</ul></div>` : ""}
        </article>`;
    };

    const renderList = () => {
      const list = document.getElementById("archive-list");
      const filtered = entries.filter((entry) => (!category || entry.type === category) && [entry.title, entry.subtitle, entry.summary,
        entry.content, entry.author, entry.details?.designation, entry.details?.environment, ...(entry.tags || [])]
        .filter(Boolean).join(" ").toLowerCase().includes(query));
      // A linked entry always opens, even when the current filter hides it from the list.
      const linked = campaign.archiveById.get(selectedHash());
      const selected = linked || filtered[0];
      list.innerHTML = filtered.length ? filtered.map((entry) => `
        <a class="entry-item ${entry === selected ? "selected" : ""}" href="#${encodeURIComponent(entry.id)}" ${entry === selected ? 'aria-current="true"' : ""}>
          <span class="entry-name">${escapeHtml(entry.title)}</span>
          <span class="entry-meta">${escapeHtml(entryMeta(entry))}</span>
          ${entry.type === "gate-record" ? statusPill(entry.details?.gateStatus, "entry-pill") : `<span class="entry-pill">${escapeHtml(archiveTypeLabel(entry.type))}</span>`}
        </a>`).join("") : '<div class="empty-state">No entries match the current filter.</div>';
      renderDetail(selected);
    };

    root.querySelectorAll("[data-archive-type]").forEach((button) => button.addEventListener("click", () => {
      category = button.dataset.archiveType;
      root.querySelectorAll("[data-archive-type]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      if (selectedHash()) window.history.replaceState(null, "", window.location.pathname);
      renderList();
    }));
    document.getElementById("archive-search").addEventListener("input", (event) => {
      query = event.target.value.trim().toLowerCase();
      renderList();
    });
    // #explore/<archive|job|character>/<id> opens Explore mode; any other hash is an Archive entry.
    const route = () => {
      const explore = /^#explore\/(archive|job|character)\/(.+)$/.exec(window.location.hash);
      const browse = document.getElementById("archive-browse");
      const panel = document.getElementById("archive-explore");
      browse.hidden = Boolean(explore);
      panel.hidden = !explore;
      if (explore) {
        redrawExplore = renderLoreExplorer(panel, graph, `${explore[1]}:${decodeURIComponent(explore[2])}`);
        // Scroll the explorer to just below the sticky site header.
        const header = document.querySelector(".site-header");
        window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - (header?.offsetHeight || 0) - 12 });
        return;
      }
      redrawExplore = null;
      renderList();
    };
    window.addEventListener("hashchange", () => {
      route();
      // On narrow screens the entry sits below the list.
      if (!window.location.hash.startsWith("#explore/") && window.matchMedia("(max-width: 800px)").matches) document.getElementById("archive-detail").scrollIntoView({ block: "start" });
    });
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => redrawExplore?.(), 150);
    });
    route();
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Archive data could not be loaded.</p></div>';
    console.error(error);
  }
};

/* ---------- Marketplace: an in-world price list, not a shop ---------- */

const CURRENCY = "coins";
const GEAR_CATEGORIES = ["weapon", "armor", "tool", "medical", "consumable", "exploration", "utility", "special"];
const onSale = (gear) => Boolean(gear.discount?.active && Number.isFinite(gear.discount.salePrice));

// A coin stands in for the currency; screen readers hear "coins".
const COIN_ICON = '<svg class="coin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="12" cy="12" r="7" fill="none" stroke="rgba(16, 23, 25, 0.45)" stroke-width="1.5"/><path d="M12 8.5l1.1 2.4 2.4 1.1-2.4 1.1L12 15.5l-1.1-2.4L8.5 12l2.4-1.1z" fill="rgba(16, 23, 25, 0.5)"/></svg>';
const coins = (amount) => `<span class="coins">${COIN_ICON}${escapeHtml(amount)}<span class="sr-only"> ${CURRENCY}</span></span>`;

const priceMarkup = (gear) => onSale(gear)
  ? `<span class="price price-sale">${coins(gear.discount.salePrice)}</span> <s class="price-original"><span class="sr-only">Regular price </span>${coins(gear.price)}</s>`
  : `<span class="price">${coins(gear.price)}</span>`;

// A small dumbbell stands in for the word "Weight"; screen readers still hear the word.
const WEIGHT_ICON = '<svg class="weight-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1 10h1.5V8H1zM2.5 5h3v14h-3zM5.5 7.5h2.5v9H5.5zM8 10.75h8v2.5H8zM16 7.5h2.5v9H16zM18.5 5h3v14h-3zM21.5 8H23v2h-1.5z M21.5 14H23v2h-1.5zM1 14h1.5v2H1z" fill="currentColor"/></svg>';
const weightMarkup = (weight, suffix = "") =>
  `<span class="weight" title="Weight">${WEIGHT_ICON}<span class="sr-only">Weight</span> ${escapeHtml(weight)}${suffix}</span>`;

const availabilityFlag = (gear) => gear.availability && gear.availability !== "common"
  ? `<span class="gear-flag ${formatStatus(gear.availability).className}">${escapeHtml(humanize(gear.availability))}</span>` : "";

const promoClass = (gear) => gear.promoLabel ? ` promo-${slugify(gear.promoLabel)}` : "";

const renderMarketplace = async () => {
  const root = document.getElementById("marketplace");
  if (!root) return;

  try {
    const campaign = await loadCampaign();
    const gear = [...campaign.gear].sort((left, right) => String(left.name).localeCompare(String(right.name)));
    const featured = gear.filter((item) => item.featured);
    let category = "";
    let query = "";
    let view = "grid";
    try { view = localStorage.getItem("marketplace-view") === "list" ? "list" : "grid"; } catch { /* storage unavailable */ }

    if (!gear.length) {
      root.innerHTML = '<div class="card"><p class="muted">The Marketplace has not published a price list yet.</p></div>';
      return;
    }

    const featureCard = (item) => `
      <article class="card feature-card${promoClass(item)}${item.availability === "unavailable" ? " is-unavailable" : ""}" data-feature-card>
        ${item.promoLabel ? `<span class="promo-label">${escapeHtml(item.promoLabel)}</span>` : ""}
        ${item.image ? `<img class="feature-image" src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : `<span class="feature-glyph" aria-hidden="true">${escapeHtml(humanize(item.category).slice(0, 2).toUpperCase())}</span>`}
        <span class="board-kicker">${escapeHtml(humanize(item.category))}</span>
        <h3><button type="button" class="gear-open" data-gear-open="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button></h3>
        ${item.description ? `<p class="muted">${escapeHtml(item.description)}</p>` : ""}
        <p class="feature-price">${priceMarkup(item)}</p>
        <p class="board-facts">${weightMarkup(item.weight)}${item.availability !== "common" ? statusPill(item.availability, "pill pill-small") : ""}</p>
      </article>`;

    const gridCard = (item) => `
      <li class="gear-card${item.availability === "unavailable" ? " is-unavailable" : ""}" id="gear-${escapeHtml(item.id)}">
        <button type="button" class="gear-card-button" data-gear-open="${escapeHtml(item.id)}" aria-haspopup="dialog">
          ${availabilityFlag(item)}
          <span class="gear-card-name">${escapeHtml(item.name)}</span>
          <span class="gear-card-facts"><span class="gear-card-price">${priceMarkup(item)}</span>${weightMarkup(item.weight)}</span>
        </button>
      </li>`;

    const listRow = (item) => `
      <li class="gear-row${item.availability === "unavailable" ? " is-unavailable" : ""}" id="gear-${escapeHtml(item.id)}">
        <span class="gear-name"><button type="button" class="gear-open" data-gear-open="${escapeHtml(item.id)}" aria-haspopup="dialog">${escapeHtml(item.name)}</button>${item.promoLabel ? ` <span class="promo-label promo-inline">${escapeHtml(item.promoLabel)}</span>` : ""}
          ${item.description ? `<span class="gear-description">${escapeHtml(item.description)}</span>` : ""}</span>
        <span class="gear-price">${priceMarkup(item)}</span>
        <span class="gear-weight">${weightMarkup(item.weight)}</span>
        <span class="gear-availability">${item.availability !== "common" ? statusPill(item.availability, "pill pill-small") : ""}</span>
      </li>`;

    const renderCatalogue = () => {
      const target = document.getElementById("gear-catalogue");
      const matches = gear.filter((item) => (!category || item.category === category)
        && [item.name, item.description, item.category, ...(item.tags || [])].join(" ").toLowerCase().includes(query));
      const groups = GEAR_CATEGORIES.concat([...new Set(gear.map((item) => item.category))].filter((name) => !GEAR_CATEGORIES.includes(name)))
        .map((name) => [name, matches.filter((item) => item.category === name)
          .sort((left, right) => (left.availability === "unavailable") - (right.availability === "unavailable") || left.name.localeCompare(right.name))])
        .filter(([, items]) => items.length);
      target.innerHTML = groups.length ? groups.map(([name, items]) => `
        <section class="gear-group" aria-labelledby="gear-group-${name}">
          <h3 id="gear-group-${name}" class="gear-group-title">${escapeHtml(humanize(name))}</h3>
          ${view === "grid"
            ? `<ul class="gear-grid">${items.map(gridCard).join("")}</ul>`
            : `<ul class="gear-list">${items.map(listRow).join("")}</ul>`}
        </section>`).join("") : '<p class="empty-state">No equipment matches this search.</p>';
    };

    const usedCategories = GEAR_CATEGORIES.filter((name) => gear.some((item) => item.category === name));
    root.innerHTML = `
      ${featured.length ? `
        <section class="featured-gear" aria-roledescription="carousel" aria-labelledby="featured-head">
          <div class="featured-head">
            <h2 id="featured-head" class="board-section-title">Featured</h2>
            ${featured.length > 1 ? `<div class="featured-controls">
              <button type="button" class="carousel-arrow" data-feature-step="-1" aria-label="Previous featured items">&#8592;</button>
              <button type="button" class="carousel-arrow" data-feature-step="1" aria-label="Next featured items">&#8594;</button>
            </div>` : ""}
          </div>
          <div class="feature-track" tabindex="0" aria-label="Featured equipment, scroll horizontally">${featured.map(featureCard).join("")}</div>
        </section>` : ""}
      <section class="archive-section" aria-labelledby="catalogue-head">
        <div class="catalogue-head">
          <h2 id="catalogue-head" class="board-section-title">Available Equipment</h2>
          <div class="view-toggle" role="group" aria-label="Catalogue layout">
            <button type="button" class="filter-chip" data-gear-view="grid" aria-pressed="${view === "grid"}">Grid</button>
            <button type="button" class="filter-chip" data-gear-view="list" aria-pressed="${view === "list"}">List</button>
          </div>
        </div>
        <div class="catalogue-tools">
          <div class="filter-bar" role="group" aria-label="Gear categories">
            ${[["", "All"], ...usedCategories.map((name) => [name, humanize(name)])].map(([name, label]) => `
              <button type="button" class="filter-chip" data-gear-category="${name}" aria-pressed="${name === category}">${escapeHtml(label)}</button>`).join("")}
          </div>
          <label class="sr-only" for="gear-search">Search equipment</label>
          <input id="gear-search" class="search-input" type="search" placeholder="Search equipment..." />
        </div>
        <div id="gear-catalogue"></div>
        <p class="muted catalogue-note">Prices are posted by Outpost traders. Purchases are settled at the table; this list does not track funds.</p>
      </section>
      <dialog class="gear-dialog" id="gear-dialog" aria-labelledby="gear-dialog-title"></dialog>`;

    const dialog = document.getElementById("gear-dialog");
    const openGear = (id) => {
      const item = campaign.gearById.get(id);
      if (!item) return;
      dialog.innerHTML = `
        <article class="gear-detail${promoClass(item)}">
          <header class="gear-detail-head">
            <div>
              <span class="board-kicker">${escapeHtml(humanize(item.category))}</span>
              <h2 id="gear-dialog-title">${escapeHtml(item.name)}</h2>
            </div>
            <button type="button" class="carousel-arrow" data-gear-close aria-label="Close">&#10005;</button>
          </header>
          ${item.image ? `<img class="feature-image" src="${escapeHtml(item.image)}" alt="" />` : ""}
          <p class="gear-detail-price">${priceMarkup(item)} ${item.promoLabel ? `<span class="promo-label promo-inline">${escapeHtml(item.promoLabel)}</span>` : ""}</p>
          <dl class="fact-strip">
            <div><dt>Weight</dt><dd>${weightMarkup(item.weight)}</dd></div>
            <div><dt>Availability</dt><dd>${statusPill(item.availability, "pill pill-small")}</dd></div>
          </dl>
          ${richText(item.description, campaign, "No description posted.")}
          ${(item.tags || []).length ? `<div class="rule-tags" aria-label="Tags">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        </article>`;
      if (!dialog.open) dialog.showModal();
      window.history.replaceState(null, "", `#gear-${encodeURIComponent(id)}`);
    };
    dialog.addEventListener("click", (event) => {
      // A click on the backdrop lands on the dialog element itself.
      if (event.target === dialog || event.target.closest("[data-gear-close]")) dialog.close();
    });
    dialog.addEventListener("close", () => window.history.replaceState(null, "", window.location.pathname));
    root.addEventListener("click", (event) => {
      const opener = event.target.closest("[data-gear-open]");
      if (opener) openGear(opener.dataset.gearOpen);
    });

    const track = root.querySelector(".feature-track");
    root.querySelectorAll("[data-feature-step]").forEach((button) => button.addEventListener("click", () => {
      const card = track.querySelector("[data-feature-card]");
      const step = card ? card.getBoundingClientRect().width + 16 : track.clientWidth;
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      const atStart = track.scrollLeft <= 4;
      const direction = Number(button.dataset.featureStep);
      if (direction > 0 && atEnd) track.scrollTo({ left: 0, behavior: "smooth" });
      else if (direction < 0 && atStart) track.scrollTo({ left: track.scrollWidth, behavior: "smooth" });
      else track.scrollBy({ left: direction * step, behavior: "smooth" });
    }));
    track?.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      root.querySelector(`[data-feature-step="${event.key === "ArrowRight" ? 1 : -1}"]`)?.click();
    });
    root.querySelectorAll("[data-gear-view]").forEach((button) => button.addEventListener("click", () => {
      view = button.dataset.gearView;
      try { localStorage.setItem("marketplace-view", view); } catch { /* storage unavailable */ }
      root.querySelectorAll("[data-gear-view]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      renderCatalogue();
    }));
    root.querySelectorAll("[data-gear-category]").forEach((button) => button.addEventListener("click", () => {
      category = button.dataset.gearCategory;
      root.querySelectorAll("[data-gear-category]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      renderCatalogue();
    }));
    document.getElementById("gear-search").addEventListener("input", (event) => {
      query = event.target.value.trim().toLowerCase();
      renderCatalogue();
    });
    renderCatalogue();
    // Links such as marketplace.html#gear-rope (from character stashes) open that item.
    const linked = /^#gear-(.+)$/.exec(window.location.hash);
    if (linked) {
      document.getElementById(`gear-${decodeURIComponent(linked[1])}`)?.scrollIntoView({ block: "center" });
      openGear(decodeURIComponent(linked[1]));
    }
  } catch (error) {
    root.innerHTML = '<div class="card"><p>Marketplace data could not be loaded.</p></div>';
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

const renderFateSheet = (sheet, characterName = "Character") => {
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
              <span class="skill-names">${sheet.skills.filter((skill) => skill.rating === rating).map((skill) => window.NowhereDice
                ? `<button type="button" class="skill-chip skill-roll" data-roll-label="${escapeHtml(`${characterName} · ${skill.name}`)}" data-roll-mod="${escapeHtml(skill.rating)}" title="Roll ${escapeHtml(skill.name)} (4dF ${escapeHtml(ladderLabel(skill.rating).split(" ").pop())})">${escapeHtml(skill.name)}${window.NowhereDice.icon}</button>`
                : `<span class="skill-chip">${escapeHtml(skill.name)}</span>`).join("")}</span>
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

/* Stash: Gear the character owns, split by whether it is brought into action. No Load rules are applied yet. */
const renderStash = (stash, campaign) => {
  const rows = (stash || []).map((item) => ({ ...item, gear: campaign.gearById.get(item.gearId) })).filter((item) => item.gear);
  const group = (title, items, emptyText) => `
    <section class="stash-group">
      <h4>${title}</h4>
      ${items.length ? `<ul class="gear-list stash-list">${items.map(({ gear, quantity }) => `
        <li class="gear-row">
          <span class="gear-name"><a class="inline-link" href="marketplace.html#gear-${encodeURIComponent(gear.id)}">${escapeHtml(gear.name)}</a>${quantity > 1 ? ` <span class="muted">× ${escapeHtml(quantity)}</span>` : ""}</span>
          <span class="gear-category muted">${escapeHtml(humanize(gear.category))}</span>
          <span class="gear-weight">${weightMarkup(gear.weight, quantity > 1 ? " each" : "")}</span>
        </li>`).join("")}</ul>` : `<p class="muted">${emptyText}</p>`}
    </section>`;
  return `
    <section class="detail-block stash-block">
      <h3>Stash</h3>
      ${rows.length ? `<div class="detail-grid">
        ${group("Brought into Action", rows.filter((item) => item.broughtIntoAction), "Nothing marked for the next job.")}
        ${group("Stored in Stash", rows.filter((item) => !item.broughtIntoAction), "Nothing in storage.")}
      </div>` : '<p class="muted">No Gear on record.</p>'}
    </section>`;
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

    // New characters are built on a blank sheet and sent to the GM as a file; nothing is submitted from here.
    const createBar = `
      <div class="sheet-download roster-create">
        <a class="destination-link" href="sheet.html?new" target="_blank" rel="noopener">Create new character <span aria-hidden="true">↗</span></a>
        <p class="muted">Opens a blank sheet in a new tab with every skill at +0. When your character is ready, press <strong>Save file</strong> there and send the file to the GM.</p>
      </div>`;

    const renderRoster = () => {
      const groups = [
        ["Expeditioners", sorted.filter((character) => character.type !== "npc")],
        ["Known Figures", sorted.filter((character) => character.type === "npc")]
      ];
      root.innerHTML = createBar + groups.map(([title, members]) => `
        <section class="roster-section" aria-label="${title}">
          <h2 class="board-section-title">${title}</h2>
          ${members.length ? `<div class="roster-grid">${members.map(rosterCard).join("")}</div>` : '<p class="muted">None on record.</p>'}
        </section>`).join("");
    };

    const renderProfile = (character) => {
      const jobs = campaign.jobsForCharacter(character.id);
      const sessions = campaign.sessionRecordsForCharacter(character.id);
      const stash = renderStash(character.stash, campaign);
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
            <h3>Job History</h3>
            ${jobs.length ? `<ul class="archive-list">${jobs.map((job) => `<li><a class="archive-row" href="jobs.html#${encodeURIComponent(job.id)}">
                <span class="archive-title">${escapeHtml(jobLabel(job))}</span>
                <span class="archive-meta">${escapeHtml([job.organizerId === character.id ? "Organizer" : "Crew", humanize(job.type), job.scheduledAt ? formatSchedule(job.scheduledAt) : ""].filter(Boolean).join(" · "))}</span>
                <span class="archive-status">${statusPill(job.status, "pill pill-small")}</span>
              </a></li>`).join("")}</ul>` : '<p class="muted">No jobs on record.</p>'}
            ${sessions.length ? `<h3 class="sheet-subheading">Session Records</h3><ul class="clean-list">${sessions.map((entry) => `<li>${archiveLink(entry)} <span class="muted">${escapeHtml(formatDate(entry.details?.sessionDate))}</span></li>`).join("")}</ul>` : ""}
            ${character.sheet ? "" : stash}
          </div>
          ${character.sheet ? `<div id="panel-sheet" role="tabpanel" aria-labelledby="tab-sheet">
            <div class="sheet-download">
              <a class="destination-link" href="sheet.html?id=${encodeURIComponent(character.id)}" target="_blank" rel="noopener">Open editable sheet <span aria-hidden="true">↗</span></a>
              <p class="muted">Opens in a new tab. Edit during play; your changes stay in this browser. Afterwards press <strong>Save file</strong> there and send the file to the GM. Click a skill to roll it.</p>
            </div>
            ${renderFateSheet(character.sheet, character.name)}
            ${stash}
          </div>` : ""}
        </article>`;
      if (character.sheet) setupProfileTabs(character);
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
        root.innerHTML = `${createBar}<div class="card"><p class="muted">No characters are on public record yet.</p></div>`;
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
  renderOutpost();

  const page = document.body.dataset.page;
  if (page === "rules") await renderRules();
  else if (page === "jobs") await renderJobBoard();
  else if (page === "archive") await renderArchive();
  else if (page === "marketplace") await renderMarketplace();
  else if (page === "characters") await renderCharacterRoster();
});
