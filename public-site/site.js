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

// A page loads many small data files at once; one retry rides out a dropped connection.
const fetchJson = async (url, retries = 1) => {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fetchJson(url, retries - 1);
  }
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
    const [outpost, campaign] = await Promise.all([
      fetchJson("data/outpost.json"),
      loadCampaign().catch(() => ({ archiveById: new Map() }))
    ]);

    // Facilities decide which services exist; each lists the capabilities it supports.
    const facilityRows = (outpost.facilities || [])
      .map((facility) => `
          <tr id="facility-${escapeHtml(facility.id || slugify(facility.name))}" class="facility-row" data-capabilities="${escapeHtml((facility.capabilities || []).length ? `|${facility.capabilities.join("|")}|` : "-")}">
            <th scope="row">${escapeHtml(facility.name)}</th>
            <td class="facility-supports">${(facility.capabilities || []).map((name) => `<span class="tag">${escapeHtml(name)}</span>`).join("") || '<span class="muted">Unassigned</span>'}</td>
            <td class="facility-service">${richInline(facility.summary || "", campaign)}
              ${facility.details ? `<details class="facility-more"><summary>More</summary>${richText(facility.details, campaign)}</details>` : ""}
              ${fromProject(facility.projectId, campaign)}</td>
          </tr>`)
      .join("");

    // A capability's contributing assets: facilities on this page, characters on theirs. Older data held free text.
    const capabilityAssets = (capability) => {
      if (!Array.isArray(capability.assets)) {
        return capability.assets ? `<p><strong>Current contributing assets:</strong> ${escapeHtml(capability.assets)}</p>` : "";
      }
      const link = (asset) => asset.type === "facility"
        ? `<a class="asset-link is-facility" href="#facility-${encodeURIComponent(asset.id)}">${escapeHtml(asset.name)}</a>`
        : `<a class="asset-link is-character" href="characters.html#${encodeURIComponent(asset.id)}">${escapeHtml(asset.name)}</a>`;
      const row = (label, assets) => `<div class="asset-row"><strong>${label}:</strong>${assets.length
        ? `<span class="asset-links">${assets.map(link).join("")}</span>` : ' <span class="muted">None yet.</span>'}</div>`;
      const characters = capability.assets.filter((asset) => asset.type === "character");
      return `<div class="capability-assets">${row("Facilities", capability.assets.filter((asset) => asset.type === "facility"))}${characters.length ? row("Contributing characters", characters) : ""}</div>`;
    };

    const outpostProjects = (campaign.projects || []).filter((project) => project.outpost && !projectComplete(project))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));

    // Ongoing Outpost projects with an active complication are flagged next to the consequences.
    const complicated = outpostProjects.filter((project) => (project.complications || []).some((item) => !item.resolved));

    // Browse facilities by the capability they support.
    const facilities = outpost.facilities || [];
    const facilityGroups = [
      ...(outpost.capabilities || []).map((capability) => capability.name)
        .filter((name) => facilities.some((facility) => (facility.capabilities || []).includes(name)))
        .map((name) => [name, name, facilities.filter((facility) => (facility.capabilities || []).includes(name)).length]),
      ...(facilities.some((facility) => !(facility.capabilities || []).length)
        ? [["-", "Unassigned", facilities.filter((facility) => !(facility.capabilities || []).length).length]] : [])
    ];
    const facilityFilter = facilityGroups.length > 1 ? `
      <div class="filter-bar facility-filter" role="group" aria-label="Show facilities by capability">
        ${[["", "All", facilities.length], ...facilityGroups].map(([value, label, count]) => `
          <button type="button" class="filter-chip" data-facility-filter="${escapeHtml(value)}" aria-pressed="${value === ""}">${escapeHtml(label)} <span class="chip-count">${count}</span></button>`).join("")}
      </div>` : "";

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
                ${capabilityAssets(capability)}
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
        <h2>Current State</h2>
      </div>
      <div class="card current-state">
        ${complicated.length ? `
          <div class="complication-alert" role="note">
            <h3><span class="complication-badge is-inline" aria-hidden="true">!</span>Project complications</h3>
            <ul>${complicated.map((project) => `
              <li>
                <span><strong>${escapeHtml(project.name)}:</strong> ${project.complications.filter((item) => !item.resolved).map((item) => richInline(item.text, campaign)).join(" · ")}</span>
                <a class="complication-jump" href="#project-${encodeURIComponent(project.id)}">View project <span aria-hidden="true">↓</span></a>
              </li>`).join("")}</ul>
          </div>` : ""}
        <h3>Consequences</h3>
        <div class="consequence-list">${consequenceMarkup || '<p class="muted">No major consequences currently recorded.</p>'}</div>
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
        <h2>Facilities</h2>
      </div>
      <p class="section-lede">Facilities decide which services the Outpost offers at all. A capability's rating decides how well it performs them when a roll is needed.</p>
      ${facilityFilter}
      <table class="capability-table facility-table">
        <thead>
          <tr>
            <th scope="col">Facility</th>
            <th scope="col">Supports</th>
            <th scope="col">Service</th>
          </tr>
        </thead>
        <tbody>
          ${facilityRows || '<tr><td colspan="3" class="muted">No facilities catalogued.</td></tr>'}
        </tbody>
      </table>

      <div class="section-header">
        <h2>Active Projects</h2>
      </div>
      <p class="section-lede">Outpost projects in progress. A project is complete when every progress box is marked.</p>
      ${outpostProjects.length ? `<div class="grid grid-two project-grid">${outpostProjects.map((project) => projectCard(project, campaign)).join("")}</div>`
        : '<div class="card"><p class="muted">No Outpost projects under way.</p></div>'}
    `;

    const filterFacilities = (value) => {
      root.querySelectorAll("[data-facility-filter]").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.facilityFilter === value)));
      root.querySelectorAll(".facility-row").forEach((row) => {
        row.hidden = Boolean(value) && !(value === "-" ? row.dataset.capabilities === "-" : row.dataset.capabilities.includes(`|${value}|`));
      });
    };
    root.querySelectorAll("[data-facility-filter]").forEach((chip) => chip.addEventListener("click", () => filterFacilities(chip.dataset.facilityFilter)));

    // Links to #facility-<id> and #project-<id> highlight their row or card.
    const showFacility = () => {
      const target = /^#(facility|project)-/.test(window.location.hash) && document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      root.querySelectorAll(".is-linked").forEach((item) => item.classList.remove("is-linked"));
      if (!target) return;
      if (target.classList.contains("facility-row")) filterFacilities("");
      target.classList.add("is-linked");
      target.scrollIntoView({ block: "center" });
    };
    window.addEventListener("hashchange", showFacility);
    showFacility();

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

/* ---------- Game: out-of-character announcements and rules ---------- */

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const fetchGame = async () => {
  const posts = await fetchJson("data/game.json");
  if (!Array.isArray(posts)) throw new Error("Game data must be a list.");
  return posts;
};

// Announcements past their "show until" date drop off; pinned ones come first, then newest.
const visibleAnnouncements = (posts) => posts
  .filter((post) => post.type === "announcement" && (!post.showUntil || post.showUntil >= todayIso()))
  .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));

const renderGame = async () => {
  const announcementRoot = document.getElementById("announcement-list");
  const rulesRoot = document.getElementById("rules-list");
  const search = document.getElementById("rules-search");
  const count = document.getElementById("rules-count");
  if (!announcementRoot || !rulesRoot) return;

  let posts;
  let campaign;
  let vocabulary;
  let pathsData;
  try {
    [posts, campaign, vocabulary, pathsData] = await Promise.all([fetchGame(), loadCampaign(), fetchJson("data/vocabulary.json").catch(() => null),
      fetchJson("data/learning-paths.json").catch(() => null)]);
  } catch (error) {
    announcementRoot.innerHTML = '<p class="empty-state">Announcements could not be loaded.</p>';
    rulesRoot.innerHTML = '<p class="empty-state">Campaign rules could not be loaded.</p>';
    count.textContent = "Rules unavailable";
    console.error(error);
    return;
  }

  // Optional art sits on the right of a post and fades into the page; a missing file just leaves the text.
  const postArt = (post) => post.image
    ? `<div class="post-art" aria-hidden="true"><img src="${escapeHtml(post.image)}" alt="" loading="lazy" onerror="this.closest('.has-art')?.classList.remove('has-art'); this.parentElement.remove()" /></div>` : "";
  const artClass = (post) => post.image ? " has-art" : "";
  const tagList = (tags, label) => (Array.isArray(tags) && tags.length)
    ? `<div class="rule-tags" aria-label="${label}">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
  // Summaries become plain text in the rules list, where each entry is already a link.
  const plainText = (html) => {
    const box = document.createElement("div");
    box.innerHTML = html;
    return box.textContent;
  };

  // Rules with a reading order (the Onboarding path) come first, in order; the rest follow by title.
  const readingOrder = (rule) => Number.isInteger(rule.order) ? rule.order : Infinity;
  const rules = posts.filter((post) => post.type !== "announcement")
    .sort((left, right) => (readingOrder(left) - readingOrder(right) || 0)
      || String(left.title || "").localeCompare(String(right.title || "")));
  // Learning paths: Onboarding first (the essentials), then optional paths that each teach one area.
  // A rule is on one path at most. Without the paths file, the rules with a reading order make up Onboarding.
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const learningPaths = (Array.isArray(pathsData) && pathsData.length ? pathsData
    : [{ key: "onboarding", title: "Onboarding", description: "", ruleIds: rules.filter((rule) => Number.isInteger(rule.order)).map((rule) => rule.id) }])
    .map((item) => ({ ...item, rules: (item.ruleIds || []).map((id) => rulesById.get(id)).filter(Boolean) }))
    .filter((item, index) => index === 0 || item.rules.length);
  const onboarding = learningPaths[0];
  const path = onboarding.rules;
  const placeOf = (rule) => {
    for (const item of learningPaths) {
      const index = item.rules.indexOf(rule);
      if (index >= 0) return { path: item, index };
    }
    return null;
  };
  const pathTopic = (item) => item === onboarding ? "onboarding" : `path-${item.key}`;
  const ruleLink = (rule) => `#post-${encodeURIComponent(rule.id)}`;

  // {{reading-path}} on its own line in a post's Details: Onboarding to read first, then the learning paths to pick from.
  const readingPathList = () => {
    if (!onboarding.rules.length) return "";
    const others = learningPaths.slice(1);
    return `
      <nav class="reading-path learning-paths" aria-label="Learning paths">
        <div class="reading-path-group">
          <h3>Start here · ${escapeHtml(onboarding.title)}</h3>
          <ol>${onboarding.rules.map((rule) => `<li><a href="${ruleLink(rule)}">${escapeHtml(rule.title)}</a></li>`).join("")}</ol>
        </div>
        ${others.length ? `<div class="reading-path-group">
          <h3>Learning paths · when you need them</h3>
          <ul class="learning-path-list">${others.map((item) => `<li><a href="#${pathTopic(item)}">${escapeHtml(item.title)}</a>
            <span class="muted">${item.rules.length} rule${item.rules.length === 1 ? "" : "s"}</span>
            ${item.description ? `<span class="learning-path-description">${escapeHtml(item.description)}</span>` : ""}</li>`).join("")}</ul>
        </div>` : ""}
      </nav>`;
  };
  // {{resource-catalogue}}: every catalogued Resource, grouped by Domain.
  const resourceCatalogue = () => {
    if (!campaign.resources.length) return '<p class="muted">No Resources have been catalogued yet.</p>';
    const groups = new Map();
    [...campaign.resources].sort((left, right) => String(left.name).localeCompare(String(right.name))).forEach((resource) => {
      const key = resource.domains?.length ? resource.domains.map((domain) => DOMAIN_INFO.get(domain)?.name || humanize(domain)).join(" + ") : "Unclassified";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(resource);
    });
    return [...groups].map(([domain, resources]) => `<h4 class="catalogue-heading">${escapeHtml(domain)}</h4>
      <div class="resource-grid">${resources.map((resource) => resourceCard(resource, campaign)).join("")}</div>`).join("");
  };
  // {{function-vocabulary}}: the current Resource Function vocabulary (managed in the content manager), by group.
  const functionVocabulary = () => {
    const groups = vocabulary?.functionGroups || [];
    if (!groups.length) return '<p class="muted">The vocabulary is not available.</p>';
    return `<div class="vocabulary-groups">${groups.map((group) => `
      <div class="vocabulary-group">
        <h4 class="catalogue-heading">${escapeHtml(group.name)}</h4>
        <dl>${group.functions.map((fn) => `<div><dt>${functionChips([fn.name])}</dt><dd>${escapeHtml(fn.definition || "")}</dd></div>`).join("")}</dl>
      </div>`).join("")}</div>`;
  };
  // {{domain-list}}: the Domains the GM manages, with what each covers.
  const domainList = () => {
    const domains = [...DOMAIN_INFO.values()];
    if (!domains.length) return '<p class="muted">The Domains are not available.</p>';
    return `<div class="rich-table"><table><thead><tr><th>Domain</th><th>What it covers</th></tr></thead><tbody>
      ${domains.map((domain) => `<tr><td>${domainPills([domain.key])}</td><td>${escapeHtml(domain.description || "")}</td></tr>`).join("")}
    </tbody></table></div>`;
  };
  // {{form-list}}: the Spell Forms Endros knows of, by tier.
  const FORM_TIERS = [["basic", "Basic Forms"], ["first", "First Forms"], ["second", "Second Forms"], ["third", "Third Forms"]];
  const formList = () => {
    if (!campaign.forms.length) return '<p class="muted">No Forms have been recorded yet.</p>';
    return FORM_TIERS.map(([tier, title]) => {
      const forms = campaign.forms.filter((form) => form.tier === tier).sort((left, right) => String(left.name).localeCompare(String(right.name)));
      return forms.length ? `<h4 class="catalogue-heading">${title}</h4><div class="rich-table"><table><thead><tr><th>Form</th><th>Words</th><th>Effect</th></tr></thead><tbody>
        ${forms.map((form) => `<tr><td><strong>${escapeHtml(form.name)}</strong>${form.status && form.status !== "known" ? ` <span class="form-status">${escapeHtml(humanize(form.status))}</span>` : ""}</td>
          <td>${functionChips(form.words)}</td><td>${form.effect ? richInline(form.effect, campaign) : '<span class="muted">NO DATA</span>'}</td></tr>`).join("")}
      </tbody></table></div>` : "";
    }).join("");
  };
  // Markers on their own line in a post: {{reading-path}} (the Onboarding list) and {{function-picker}} (Random Resource).
  const postText = (text) => richText(text, campaign)
    .replace(/<p>\s*\{\{\s*reading-path\s*\}\}\s*<\/p>/g, readingPathList)
    .replace(/<p>\s*\{\{\s*function-picker\s*\}\}\s*<\/p>/g, '<p><a class="discovery-button" href="discoveries.html#functions">Try the Functions explorer →</a></p>')
    .replace(/<p>\s*\{\{\s*resource-catalogue\s*\}\}\s*<\/p>/g, resourceCatalogue)
    .replace(/<p>\s*\{\{\s*form-list\s*\}\}\s*<\/p>/g, formList)
    .replace(/<p>\s*\{\{\s*function-vocabulary\s*\}\}\s*<\/p>/g, functionVocabulary)
    .replace(/<p>\s*\{\{\s*domain-list\s*\}\}\s*<\/p>/g, domainList)
    .replace(/<code>([A-Z][A-Za-z-]+)<\/code>/g, (match, word) => VOCABULARY_WORDS.has(word) ? functionChips([word]) : match);

  const announcements = visibleAnnouncements(posts);
  announcementRoot.innerHTML = announcements.length ? announcements.map((post) => `
    <article class="announcement${post.pinned ? " is-pinned" : ""}${artClass(post)}" id="post-${escapeHtml(post.id)}">
      ${postArt(post)}
      <div class="post-body">
        <div class="announcement-meta">
          ${post.pinned ? '<span class="pill pill-small status-observed">Pinned</span>' : ""}
          <span>${escapeHtml(formatDate(post.publishedAt))}</span>
        </div>
        <h2>${escapeHtml(post.title)}</h2>
        ${post.summary ? `<p class="announcement-summary">${richInline(post.summary, campaign)}</p>` : ""}
        ${post.details ? postText(post.details) : ""}
        ${tagList(post.tags, "Tags")}
      </div>
    </article>`).join("") : '<p class="empty-state">No announcements right now.</p>';

  // Previous / Next along the rule's learning path; the last rule points to the next path.
  const pathNav = (rule) => {
    const place = placeOf(rule);
    if (!place) return "";
    const { index } = place;
    const steps = place.path.rules;
    const previous = steps[index - 1];
    const next = steps[index + 1];
    const nextPath = learningPaths[learningPaths.indexOf(place.path) + 1];
    return `
      <nav class="rule-pager" aria-label="Reading path">
        ${previous ? `<a class="rule-pager-link is-previous" href="${ruleLink(previous)}"><span>← Previous</span><strong>${escapeHtml(previous.title)}</strong></a>` : "<span></span>"}
        ${next ? `<a class="rule-pager-link is-next" href="${ruleLink(next)}"><span>Next →</span><strong>${escapeHtml(next.title)}</strong></a>`
          : nextPath ? `<a class="rule-pager-link is-next" href="#${pathTopic(nextPath)}"><span>${place.path === onboarding ? "Done! Next, if you like" : "Next learning path"}</span><strong>${escapeHtml(nextPath.title)}</strong></a>`
          : '<a class="rule-pager-link is-next" href="#rules"><span>Finished</span><strong>Browse all rules</strong></a>'}
      </nav>`;
  };

  // Topics: Onboarding, then each learning path, then all rules.
  const topicsRoot = document.getElementById("rules-topics");
  const topics = [
    ...learningPaths.filter((item) => item.rules.length).map((item) => [pathTopic(item), item.title, item.rules.length]),
    ["all", "All rules", rules.length],
  ];
  let topic = "all";
  const topicHash = () => topic === "all" ? "#rules" : `#${topic}`;
  const inTopic = (rule) => topic === "all" || (placeOf(rule) && pathTopic(placeOf(rule).path) === topic);
  const matchesSearch = (rule) => [rule.category, rule.title, rule.summary, rule.details, ...(Array.isArray(rule.tags) ? rule.tags : [])]
    .filter(Boolean).join(" ").toLowerCase().includes(search.value.trim().toLowerCase());
  // A dropdown keeps the sidebar short however many topics there are.
  const topicSelect = topicsRoot?.querySelector("select");
  const renderTopics = () => {
    if (!topicSelect) return;
    const option = ([key, label, total]) => `<option value="${key}"${key === topic ? " selected" : ""}>${escapeHtml(label)} (${total})</option>`;
    const [first, ...rest] = topics.filter(([key]) => key !== "all");
    topicSelect.innerHTML = `${first ? option([first[0], `Start here: ${first[1]}`, first[2]]) : ""}
      ${rest.length ? `<optgroup label="Learning paths">${rest.map(option).join("")}</optgroup>` : ""}
      ${option(topics.find(([key]) => key === "all"))}`;
    topicSelect.classList.toggle("is-onboarding", topic === "onboarding");
    topicsRoot.hidden = false;
  };

  // The rules reader: every rule with its short description in the sidebar, the open rule on the right.
  // On phones the two take turns: the list, then the rule (with a way back) once one is chosen.
  const layout = document.getElementById("rules-layout");
  const ruleView = document.getElementById("rule-view");
  const wide = window.matchMedia("(min-width: 801px)");
  let selectedRule = null;
  let visibleRules = rules;

  const renderRuleList = () => {
    visibleRules = rules.filter((rule) => inTopic(rule) && matchesSearch(rule));
    count.textContent = visibleRules.length === rules.length ? `${rules.length} rules` : `Showing ${visibleRules.length} of ${rules.length} rules`;
    const current = learningPaths.find((item) => pathTopic(item) === topic);
    const intro = current ? `<li class="rules-nav-intro">${escapeHtml(current.description
      || (current === onboarding ? "The essentials every new player reads first." : "An optional path through one area of the rules."))} Read in order: each rule ends with a link to the next.</li>` : "";
    rulesRoot.innerHTML = intro + (visibleRules.length ? visibleRules.map((rule) => `
      <li><a class="rules-nav-item${rule === selectedRule ? " is-active" : ""}" href="${ruleLink(rule)}"${rule === selectedRule ? ' aria-current="true"' : ""}>
        <span class="rules-nav-meta"><span>${escapeHtml(placeOf(rule)?.path.title || rule.category || "Campaign")}</span>${placeOf(rule) ? `<span>${placeOf(rule).index + 1} / ${placeOf(rule).path.rules.length}</span>` : ""}</span>
        <strong>${escapeHtml(rule.title || "Untitled rule")}</strong>
        ${rule.summary ? `<span class="rules-nav-summary">${escapeHtml(plainText(richInline(rule.summary, campaign)))}</span>` : ""}
      </a></li>`).join("") : '<li class="empty-state">No rules match this search.</li>');
  };

  const renderRuleView = () => {
    const rule = selectedRule;
    layout.classList.toggle("is-reading", Boolean(rule) && window.location.hash.startsWith("#post-"));
    ruleView.className = `rule-view${rule ? artClass(rule) : ""}`;
    if (!rule) {
      ruleView.innerHTML = '<p class="empty-state">Choose a rule from the list.</p>';
      return;
    }
    const place = placeOf(rule);
    ruleView.innerHTML = `
      ${postArt(rule)}
      <a class="rule-back" href="${topicHash()}">← All rules</a>
      <header class="rule-view-head">
        <div class="rule-view-meta">
          <span class="rule-category">${escapeHtml(rule.category || "Campaign")}</span>
          ${place ? `<a class="rule-step" href="#${pathTopic(place.path)}">${escapeHtml(place.path.title)} · ${place.index + 1} of ${place.path.rules.length}</a>` : ""}
        </div>
        <h2 id="rule-view-title">${escapeHtml(rule.title || "Untitled rule")}</h2>
        ${rule.summary ? `<p class="rule-lead">${richInline(rule.summary, campaign)}</p>` : ""}
      </header>
      ${rule.details ? `<div class="rule-content">${postText(rule.details)}</div>` : ""}
      ${pathNav(rule)}
      ${tagList(rule.tags, "Related topics")}`;
  };

  // Brings the reader to the top of the open rule, and keeps its entry in view in the sidebar.
  const revealRule = () => {
    const headerHeight = document.querySelector(".site-header")?.offsetHeight || 0;
    const top = layout.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
    if (!wide.matches || window.scrollY > top) window.scrollTo({ top, behavior: "instant" });
    const active = rulesRoot.querySelector(".is-active");
    // On wide screens only the list scrolls (the topic and search stay at the top of the sidebar).
    if (active && wide.matches && (active.offsetTop < rulesRoot.scrollTop || active.offsetTop + active.offsetHeight > rulesRoot.scrollTop + rulesRoot.clientHeight)) {
      rulesRoot.scrollTop = active.offsetTop - rulesRoot.clientHeight / 3;
    }
  };

  const showRule = (rule) => {
    // A topic or search that hides the rule would leave its entry missing from the list.
    if (!inTopic(rule)) topic = "all";
    if (!matchesSearch(rule)) search.value = "";
    selectedRule = rule;
    renderTopics();
    renderRuleList();
    renderRuleView();
    revealRule();
  };

  const setTopic = (key, { updateHash = false } = {}) => {
    topic = topics.some(([candidate]) => candidate === key) ? key : "all";
    if (updateHash) window.history.replaceState(null, "", topicHash());
    renderTopics();
    renderRuleList();
    // Wide screens always show a rule: keep the open one if it is still listed, otherwise the first.
    if (!selectedRule || !visibleRules.includes(selectedRule)) selectedRule = visibleRules[0] || null;
    renderRuleList();
    renderRuleView();
  };
  topicSelect?.addEventListener("change", () => setTopic(topicSelect.value, { updateHash: true }));
  search.addEventListener("input", renderRuleList);
  setTopic("all");

  // Tabs follow the hash: #rules, #announcements, #onboarding / #topic-<category>, or #post-<id> (which opens the tab holding that post).
  const tabs = [...document.querySelectorAll("[data-game-tab]")];
  const select = (name, { focus = false, updateHash = true } = {}) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.gameTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
      if (active && focus) tab.focus();
    });
    if (updateHash) window.history.replaceState(null, "", `#${name}`);
  };
  const route = () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const post = hash.startsWith("post-") ? posts.find((item) => `post-${item.id}` === hash) : null;
    if (post?.type === "announcement") {
      select("announcements", { updateHash: false });
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    } else if (post) {
      select("rules", { updateHash: false });
      showRule(post);
    } else if (hash === "onboarding" || hash.startsWith("path-") || hash.startsWith("topic-")) {
      select("rules", { updateHash: false });
      search.value = "";
      setTopic(hash);
      revealRule();
    } else if (hash === "rules") {
      select("rules", { updateHash: false });
      renderRuleView();
    } else if (hash === "announcements") {
      select("announcements", { updateHash: false });
    } else {
      select(announcements.length ? "announcements" : "rules", { updateHash: false });
    }
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.gameTab)));
  document.querySelector(".game-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    select(tabs[next].dataset.gameTab, { focus: true });
  });
  window.addEventListener("hashchange", route);
  route();
};

// The Overview shows the newest pinned announcement as a single line.
const renderAnnouncementBanner = async () => {
  const banner = document.getElementById("announcement-banner");
  if (!banner) return;
  try {
    const pinned = visibleAnnouncements(await fetchGame()).find((post) => post.pinned);
    if (!pinned) return;
    banner.innerHTML = `
      <a class="announcement-banner-link" href="game.html#post-${encodeURIComponent(pinned.id)}">
        <span class="kicker">Announcement</span>
        <strong>${escapeHtml(pinned.title)}</strong>
        <span class="muted">${escapeHtml(formatDate(pinned.publishedAt))}</span>
        <span class="announcement-banner-arrow" aria-hidden="true">→</span>
      </a>`;
    banner.hidden = false;
  } catch (error) {
    console.warn("No announcements available.", error);
  }
};
/* ---------- Site settings: launch countdown and roadmap, Discord, sponsor ---------- */

let sitePromise = null;
const loadSiteSettings = () => {
  sitePromise ||= fetchJson("data/site.json").catch(() => null);
  return sitePromise;
};

const CHAT_ICON = '<svg class="chat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm4 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" fill="currentColor"/></svg>';
const safeUrl = (url) => /^https?:\/\//i.test(String(url || "")) ? url : "";

// Every page: the Discord link, the community and sponsor credits above the copyright line.
// A logo file that is missing or fails to load is simply removed, leaving the name.
const footerLogo = (logo, className) => logo
  ? `<img class="${className}" src="${escapeHtml(logo)}" alt="" onerror="this.remove()" />` : "";

const footerCredit = (label, name, url, logo, className) => {
  if (!name) return "";
  const body = `${footerLogo(logo, className)}<span>${escapeHtml(name)}</span>`;
  const href = safeUrl(url);
  return `<span class="footer-credit"><span class="footer-credit-label">${escapeHtml(label)}</span>${href
    ? `<a class="footer-credit-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${body}</a>` : `<span class="footer-credit-link">${body}</span>`}</span>`;
};

const renderFooterCommunity = async () => {
  const slot = document.getElementById("footer-community");
  if (!slot) return;
  const site = await loadSiteSettings();
  if (!site) return;
  const discord = safeUrl(site.discordUrl);
  const community = site.community || {};
  const sponsor = site.sponsor || {};
  const parts = [
    discord ? `<a class="discord-link" href="${escapeHtml(discord)}" target="_blank" rel="noopener">${CHAT_ICON}Join our Discord</a>` : "",
    footerCredit(community.label || "A campaign of", community.name, discord, community.logo, "community-logo"),
    footerCredit("Supported by", sponsor.name, sponsor.url, sponsor.logo, "sponsor-logo")
  ].filter(Boolean);
  if (!parts.length) return;
  slot.innerHTML = parts.join("");
  slot.hidden = false;
};

// Every page: the release version beside the copyright, e.g. "v1.4.2 (2026-10-04)", linking to its release notes.
// version.json is written by the deploy workflow, so a local preview has none and says so.
const renderSiteVersion = async () => {
  const slot = document.getElementById("site-version");
  if (!slot) return;
  let release = null;
  try {
    const response = await fetch("version.json", { cache: "no-cache" });
    if (response.ok) release = await response.json();
  } catch {
    // Offline or a local preview: fall through to the label below.
  }
  const label = release?.version ? `v${release.version}${release.date ? ` (${release.date})` : ""}` : "Local preview";
  const href = safeUrl(release?.url);
  slot.innerHTML = ` · ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" title="Release notes">${escapeHtml(label)}</a>` : escapeHtml(label)}`;
  slot.hidden = false;
};

// "2026-11-06T20:00+02:00" read as written: the wall-clock date and time in that offset.
const launchWallClock = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return `${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const TIMELINE_STATES = { done: ["✓", "Done"], "in-progress": ["", "In progress"], todo: ["", "Estimate"] };

// "2026-10-11" as "11 Oct"; the year only when it is not the launch year.
const timelineDate = (value, launchYear) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return "";
  const [, year, month, day] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", ...(year === launchYear ? {} : { year: "numeric" }), timeZone: "UTC" });
};

// Overview: the milestones to the first session as a vertical timeline, then the countdown. Hidden after launch.
const renderLaunchPanel = async () => {
  const panel = document.getElementById("launch-panel");
  if (!panel) return;
  const site = await loadSiteSettings();
  const launch = site?.launchAt ? new Date(site.launchAt) : null;
  if (!site?.showLaunch || !launch || Number.isNaN(launch.getTime()) || launch <= new Date()) return;
  const steps = site.roadmap || [];
  const done = steps.filter((step) => step.status === "done").length;
  const launchYear = Number(site.launchAt.slice(0, 4));
  const visitorTime = launch.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  const sameOffset = new Date(launch).getTimezoneOffset() === -Number((/([+-]\d{2}):(\d{2})$/.exec(site.launchAt) || [0, "+00", "00"]).slice(1, 3).reduce((hours, minutes) => Number(hours) * 60 + Math.sign(Number(hours) || 1) * Number(minutes)));
  const discord = safeUrl(site.discordUrl);
  panel.innerHTML = `
    <div class="launch-head">
      <span class="kicker">Before the first expedition${steps.length ? ` · ${done} of ${steps.length} milestones done` : ""}</span>
      <h2 id="launch-title">${escapeHtml(site.launchTitle || "Launch")}</h2>
      ${site.launchSummary ? `<p class="launch-summary">${escapeHtml(site.launchSummary)}</p>` : ""}
    </div>
    ${steps.length ? `<ol class="timeline">${steps.map((step) => {
      const status = TIMELINE_STATES[step.status] ? step.status : "todo";
      const [mark, label] = TIMELINE_STATES[status];
      const date = timelineDate(step.date, launchYear);
      return `<li class="timeline-step is-${status}">
        <span class="timeline-date">${date ? `<time datetime="${escapeHtml(step.date)}">${status === "done" ? "" : "~ "}${escapeHtml(date)}</time>` : ""}<span class="timeline-state">${label}</span></span>
        <span class="timeline-node" aria-hidden="true">${mark}</span>
        <div class="timeline-body"><h3 class="timeline-title">${escapeHtml(step.title)}</h3>${step.detail ? `<p class="timeline-detail">${escapeHtml(step.detail)}</p>` : ""}</div>
      </li>`;
    }).join("")}</ol>` : ""}
    <div class="launch-countdown">
      <p class="launch-when"><span class="kicker">Countdown to the first session</span>
        <span><strong>${escapeHtml(launchWallClock(site.launchAt))}</strong>${site.launchLabel ? ` ${escapeHtml(site.launchLabel)}` : ""}</span>
        ${sameOffset ? "" : `<span class="muted">Your time: ${escapeHtml(visitorTime)}</span>`}</p>
      <div class="countdown" role="timer" aria-label="Time until launch">
        ${["days", "hours", "minutes", "seconds"].map((unit) => `<div><span class="countdown-value" data-unit="${unit}">--</span><span class="countdown-label">${unit}</span></div>`).join("")}
      </div>
      ${discord ? `<a class="destination-link discord-cta" href="${escapeHtml(discord)}" target="_blank" rel="noopener">${CHAT_ICON}Join our Discord <span aria-hidden="true">↗</span></a>` : ""}
    </div>`;
  panel.hidden = false;

  // The countdown ticks once a second; at zero the panel steps aside.
  const values = Object.fromEntries([...panel.querySelectorAll("[data-unit]")].map((node) => [node.dataset.unit, node]));
  const tick = () => {
    const remaining = launch.getTime() - Date.now();
    if (remaining <= 0) {
      panel.hidden = true;
      clearInterval(timer);
      return;
    }
    const seconds = Math.floor(remaining / 1000);
    values.days.textContent = Math.floor(seconds / 86400);
    values.hours.textContent = String(Math.floor(seconds / 3600) % 24).padStart(2, "0");
    values.minutes.textContent = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
    values.seconds.textContent = String(seconds % 60).padStart(2, "0");
  };
  const timer = setInterval(tick, 1000);
  tick();
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
    campaignPromise = Promise.all([...["characters", "jobs", "archive", "gear", "projects", "resources", "forms"].map(fetchCollection),
      fetchJson("data/vocabulary.json").catch(() => null)])
      .then(([characters, jobs, archive, gear, projects, resources, forms, vocabulary]) => {
        DOMAIN_INFO = new Map((vocabulary?.domains || []).map((domain) => [domain.key, domain]));
        VOCABULARY_WORDS = new Set((vocabulary?.functionGroups || []).flatMap((group) => group.functions.map((fn) => fn.name)));
        const byId = (items) => new Map(items.map((item) => [item.id, item]));
        const mentions = (item, id) => [item.summary, item.content, item.objective, item.briefing]
          .some((text) => String(text || "").includes(`[[${id}]]`) || String(text || "").includes(`[[${id}|`));
        return {
          characters, jobs, archive, gear, projects, resources, forms,
          vocabulary: { functionGroups: vocabulary?.functionGroups || [], interactions: vocabulary?.interactions || [], domains: vocabulary?.domains || [] },
          characterById: byId(characters),
          resourceById: byId(resources),
          resourcesForGate: (gateId) => resources.filter((resource) => resource.gateId === gateId)
            .sort((left, right) => String(left.name).localeCompare(String(right.name))),
          projectById: byId(projects),
          projectsForCharacter: (characterId) => projects.filter((project) => (project.characterIds || []).includes(characterId)),
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

/* Authored text is Markdown (CommonMark plus tables and ~~strikethrough~~), rendered by the vendored
   markdown-it (vendor/markdown-it.min.js). Raw HTML is never rendered, and links to javascript: and similar are
   refused by markdown-it. On top of Markdown, [[archive-id]] / [[archive-id|text]] link to Archive entries.
   Single line breaks are kept as line breaks, as authors expect from a plain text box. */
const markdown = (() => {
  if (!window.markdownit) return null;
  const md = window.markdownit({ html: false, linkify: true, breaks: true, typographer: true });
  const renderDefault = (tokens, index, options, env, self) => self.renderToken(tokens, index, options);
  const linkOpen = md.renderer.rules.link_open || renderDefault;
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet("href") || "";
    token.attrJoin("class", href.startsWith("archive.html#") ? "inline-link archive-link" : "inline-link");
    if (/^https?:/i.test(href)) token.attrSet("rel", "noopener");
    return linkOpen(tokens, index, options, env, self);
  };
  // Headings sit inside sections that already have their own h2/h3, so # starts at h4.
  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 3)}`;
    token.attrJoin("class", "rich-heading");
    return self.renderToken(tokens, index, options);
  };
  md.renderer.rules.heading_close = (tokens, index, options, env, self) => {
    tokens[index].tag = tokens[index - 2]?.tag || tokens[index].tag;
    return self.renderToken(tokens, index, options);
  };
  const image = md.renderer.rules.image || renderDefault;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    tokens[index].attrSet("loading", "lazy");
    return image(tokens, index, options, env, self);
  };
  md.renderer.rules.table_open = () => '<div class="rich-table"><table>';
  md.renderer.rules.table_close = () => "</table></div>";
  return md;
})();

const escapeMarkdown = (text) => String(text).replace(/([\\`*_{}\[\]()#+!|<>~])/g, "\\$1");

// [[archive-id]] links become ordinary Markdown links; links to records not on the site become plain text.
const expandArchiveLinks = (text, campaign) => String(text || "").replace(/\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]/g, (match, id, label) => {
  const entry = campaign.archiveById.get(id);
  if (!entry) return escapeMarkdown(label || "[record unavailable]");
  return `[${escapeMarkdown(label || entry.title)}](archive.html#${encodeURIComponent(id)})`;
});

// Inline text (card summaries, ledes): Markdown without paragraphs, lists, or headings.
const richInline = (text, campaign) => markdown
  ? markdown.renderInline(expandArchiveLinks(text, campaign))
  : escapeHtml(expandArchiveLinks(text, campaign));

const richText = (text, campaign, fallback = "NO DATA") => {
  if (!String(text || "").trim()) return `<p class="muted">${fallback}</p>`;
  if (!markdown) return paragraphs(expandArchiveLinks(text, campaign), fallback);
  return `<div class="rich-text">${markdown.render(expandArchiveLinks(text, campaign))}</div>`;
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

/* ---------- Projects: progress tracks agreed between the GM and players ---------- */

const projectComplete = (project) => (Number(project.progress?.current) || 0) >= (Number(project.progress?.max) || 1);

// Where a project is shown: the Outpost while an ongoing Outpost project, otherwise its first character's page.
const projectHref = (project) => {
  if (project.outpost && !projectComplete(project)) return `outpost.html#project-${encodeURIComponent(project.id)}`;
  return project.characterIds?.length ? `characters.html#${encodeURIComponent(project.characterIds[0])}#projects` : "";
};

// "Brought into the game by …" on facilities and gear.
const fromProject = (projectId, campaign) => {
  const project = projectId && campaign.projectById?.get(projectId);
  if (!project) return "";
  const href = projectHref(project);
  const name = escapeHtml(project.name);
  return `<p class="from-project">Brought into the game by ${href ? `<a class="inline-link" href="${href}">${name}</a>` : `<strong>${name}</strong>`}</p>`;
};

/* ---------- Domains, Functions and Resources ---------- */

// Domain names and colours come from the vocabulary the GM manages (data/vocabulary.json), loaded with the campaign.
let DOMAIN_INFO = new Map();
let VOCABULARY_WORDS = new Set();
const domainPills = (domains) => (domains || []).map((key) => {
  const domain = DOMAIN_INFO.get(key);
  const colour = /^#[0-9a-fA-F]{6}$/.test(domain?.colour || "") ? ` style="--domain-colour: ${domain.colour}"` : "";
  return `<a class="domain-pill"${colour} href="discoveries.html#domain-${encodeURIComponent(key)}">${escapeHtml(domain?.name || humanize(key))}</a>`;
}).join("");
// Each Word opens in the Functions explorer.
const functionChips = (names) => (names || []).map((name) => `<a class="function-chip" href="discoveries.html#function-${encodeURIComponent(name)}">${escapeHtml(name)}</a>`).join(" ");
const SOURCE_LABELS = { fauna: "Fauna-derived", flora: "Flora-derived", ground: "Ground / ore / stone", constructed: "Constructed / machine-derived",
  "by-product": "Environmental by-product", other: "Other origin" };
// "G-12 · The Ash Steps", or just the title when it already names the Gate.
const gateName = (gate) => {
  const designation = gate.details?.designation || "";
  return designation && !String(gate.title || "").includes(designation) ? [designation, gate.title].filter(Boolean).join(" · ") : gate.title || designation;
};

// One Resource as the Outpost knows it. Hidden Functions never reach the site.
const resourceCard = (resource, campaign, { showGate = true } = {}) => {
  const gate = resource.gateId ? campaign.archiveById.get(resource.gateId) : null;
  return `
    <article class="resource-card" id="resource-${escapeHtml(resource.id)}">
      <div class="resource-head">
        <h4><a href="discoveries.html#resource-${encodeURIComponent(resource.id)}">${escapeHtml(resource.name)}</a></h4>
        <span class="resource-pills">${domainPills(resource.domains)}<span class="pill pill-small availability-${escapeHtml(resource.availability || "sample")}">${escapeHtml(humanize(resource.availability || "sample"))}</span></span>
      </div>
      <p class="resource-meta">${escapeHtml(SOURCE_LABELS[resource.sourceType] || humanize(resource.sourceType || "other"))}${showGate && gate
        ? ` · from <a class="inline-link" href="archive.html#${encodeURIComponent(gate.id)}">${escapeHtml(gateName(gate))}</a>` : ""}</p>
      ${resource.description ? `<p>${richInline(resource.description, campaign)}</p>` : ""}
      <p class="resource-functions"><span class="resource-label">Functions</span> ${resource.functions?.length ? functionChips(resource.functions) : '<span class="muted">NONE IDENTIFIED</span>'}</p>
      ${resource.specialProperty ? `<p><span class="resource-label">Special Property</span> ${richInline(resource.specialProperty, campaign)}</p>` : ""}
      ${resource.supply ? `<p><span class="resource-label">Supply</span> ${escapeHtml(resource.supply)}</p>` : ""}
    </article>`;
};

const projectNeeds = (project, campaign) => {
  const resources = (project.requiredResourceIds || []).map((id) => campaign.resourceById.get(id)).filter(Boolean);
  const gate = project.relatedGateId ? campaign.archiveById.get(project.relatedGateId) : null;
  const rows = [
    project.requiredFunctions?.length ? `<li><span class="resource-label">Functions</span> ${functionChips(project.requiredFunctions)}</li>` : "",
    resources.length ? `<li><span class="resource-label">Resources</span> ${resources.map((resource) => `<a class="inline-link" href="discoveries.html#resource-${encodeURIComponent(resource.id)}">${escapeHtml(resource.name)}</a>`).join(", ")}</li>` : "",
    project.requiredDomain ? `<li><span class="resource-label">Domain</span> ${domainPills([project.requiredDomain])}</li>` : "",
    gate ? `<li><span class="resource-label">Gate</span> <a class="inline-link" href="archive.html#${encodeURIComponent(gate.id)}">${escapeHtml(gateName(gate))}</a></li>` : "",
  ].filter(Boolean);
  return rows.length ? `<div class="project-field"><strong>Needs</strong><ul class="project-needs">${rows.join("")}</ul></div>` : "";
};

const projectCard = (project, campaign) => {
  const prerequisites = (project.prerequisites || []).map((item) => typeof item === "string" ? { text: item, met: false } : item);
  const met = prerequisites.filter((item) => item.met).length;
  const active = (project.complications || []).filter((item) => !item.resolved);
  const resolved = (project.complications || []).filter((item) => item.resolved);
  const max = Number(project.progress?.max) || 1;
  const current = Math.min(max, Number(project.progress?.current) || 0);
  const complete = projectComplete(project);
  const characters = (project.characterIds || []).map((id) => campaign.characterById.get(id)).filter(Boolean);
  return `
    <article class="card fact-card project-card${complete ? " is-complete" : ""}${active.length ? " has-complication" : ""}" id="project-${escapeHtml(project.id)}">
      ${active.length ? '<span class="complication-badge" role="img" aria-label="Active complication" title="Active complication">!</span>' : ""}
      <div class="meta-row">
        <span class="pill">${project.access === "private" ? "Private project" : "Open project"}</span>
        ${project.outpost ? '<span class="pill">Outpost</span>' : ""}
        ${complete ? '<span class="pill status-ready">Completed</span>' : ""}
      </div>
      <h3>${escapeHtml(project.name)}</h3>
      ${project.summary ? richText(project.summary, campaign) : ""}
      ${active.length ? `<div class="project-complication"><strong>Complication</strong>${active.map((item) => `<p>${richInline(item.text, campaign)}</p>`).join("")}</div>` : ""}
      <div class="project-progress">
        <span class="track-label">Progress <span>${current}/${max}</span></span>
        ${renderBoxTrack(current, max, `${escapeHtml(project.name)} progress`, "project-track")}
      </div>
      ${prerequisites.length ? `<div class="project-field"><strong>Prerequisites <span class="chip-count">${met}/${prerequisites.length} met</span></strong>
        <ul class="prerequisite-list">${prerequisites.map((item) => `<li class="${item.met ? "is-met" : ""}"><span class="prerequisite-mark" aria-hidden="true">${item.met ? "✓" : ""}</span><span>${escapeHtml(item.text)}<span class="sr-only">${item.met ? " (met)" : " (not met yet)"}</span></span></li>`).join("")}</ul></div>` : ""}
      ${projectNeeds(project, campaign)}
      ${project.outcome ? `<div class="project-field"><strong>${complete ? "Outcome" : "Expected outcome"}</strong>${richText(project.outcome, campaign)}</div>` : ""}
      ${characters.length ? `<div class="project-field"><strong>Characters</strong>${crewList(characters, "")}</div>` : ""}
      ${resolved.length ? `<details class="complication-history"><summary>Complication history (${resolved.length})</summary>
        <ol>${resolved.map((item) => `<li><p>${richInline(item.text, campaign)}</p><p class="complication-resolution"><strong>Resolved:</strong> ${item.resolution ? richInline(item.resolution, campaign) : "No details recorded."}</p></li>`).join("")}</ol>
      </details>` : ""}
    </article>`;
};

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
        <div class="detail-block"><h3>Domain</h3>${details.domains?.length ? `<p class="domain-row">${domainPills(details.domains)}</p>` : '<p class="muted">UNCLASSIFIED</p>'}</div>
        <div class="detail-block"><h3>Environment</h3>${paragraphs(details.environment, "NOT YET SURVEYED")}</div>
        <div class="detail-grid">
          <div class="detail-block"><h3>Known Traits</h3>${itemList(details.knownTraits)}</div>
          <div class="detail-block"><h3>Known Hazards</h3>${itemList(details.knownHazards)}</div>
        </div>
        <div class="detail-grid">
          <div class="detail-block"><h3>Known Locations</h3>${itemList(details.knownLocations)}</div>
          <div class="detail-block"><h3>Known Creatures</h3>${itemList(details.knownCreatures, "NOT YET SURVEYED")}</div>
        </div>
        <div class="detail-block"><h3>Resources</h3>${(() => {
          const resources = campaign.resourcesForGate(entry.id);
          return resources.length ? `<div class="resource-grid">${resources.map((resource) => resourceCard(resource, campaign, { showGate: false })).join("")}</div>`
            : '<p class="muted">NO RESOURCES CATALOGUED</p>';
        })()}</div>`;
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
          ${fromProject(item.projectId, campaign)}
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

/* Stash: the character's Coins and the Gear they own, split by whether it is brought into action.
   What is brought into action counts against the character's carry limit (6 unless a stunt or situation changes it). */
const DEFAULT_CARRY_LIMIT = 6;
const MAX_DOWNTIME = 8;
const carryLimitOf = (character) => Number.isInteger(character.carryLimit) ? character.carryLimit : DEFAULT_CARRY_LIMIT;
const renderStash = (character, campaign) => {
  const limit = carryLimitOf(character);
  const rows = (character.stash || []).map((item) => ({ ...item, gear: campaign.gearById.get(item.gearId) })).filter((item) => item.gear);
  const carried = rows.filter((item) => item.broughtIntoAction).reduce((total, item) => total + (Number(item.gear.weight) || 0) * item.quantity, 0);
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
      <div class="stash-summary">
        <span class="stash-coins"><span class="muted">Coins</span> ${coins(Number(character.coins) || 0)}</span>
        <span class="stash-carried${carried > limit ? " is-over" : ""}"><span class="muted">Carried into action</span> ${weightMarkup(`${carried} / ${limit}`)}</span>
      </div>
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
      const stash = renderStash(character, campaign);
      const projects = campaign.projectsForCharacter(character.id).sort((left, right) => String(left.name).localeCompare(String(right.name)));
      const ongoing = projects.filter((project) => !projectComplete(project));
      const completed = projects.filter(projectComplete);
      const tabbed = Boolean(character.sheet || projects.length);
      const projectGroup = (title, items, empty) => `<h3${title === "Completed" ? ' class="sheet-subheading"' : ""}>${title}</h3>
        ${items.length ? `<div class="grid grid-two project-grid">${items.map((project) => projectCard(project, campaign)).join("")}</div>` : `<p class="muted">${empty}</p>`}`;
      root.innerHTML = `
        <a class="back-link" href="characters.html">← All characters</a>
        <article class="detail-surface record-surface">
          <div class="profile-head">
            ${avatar(character, "avatar avatar-portrait")}
            <div>
              <span class="pill">${character.type === "npc" ? "NPC" : "Player Character"}</span>
              <h2>${escapeHtml(character.name)}</h2>
              <p class="meta-row">${statusPill(character.status)}${character.type !== "npc" && character.playerName ? `<span class="muted">Played by ${escapeHtml(character.playerName)}</span>` : ""}</p>
              ${character.type !== "npc" ? `<dl class="character-tallies">
                <div title="Spent on Project Actions between expeditions; at most ${MAX_DOWNTIME}"><dt>Downtime</dt><dd><strong>${escapeHtml(Number(character.downtime) || 0)}</strong> / ${MAX_DOWNTIME}</dd></div>
                <div><dt>Coins</dt><dd>${coins(Number(character.coins) || 0)}</dd></div>
              </dl>` : ""}
              ${paragraphs(character.summary, "No public summary.")}
            </div>
          </div>
          ${tabbed ? `
            <div class="profile-tabs" role="tablist" aria-label="Character record">
              <button type="button" class="profile-tab" role="tab" id="tab-profile" aria-controls="panel-profile" data-profile-tab="profile">Profile</button>
              ${character.sheet ? '<button type="button" class="profile-tab" role="tab" id="tab-sheet" aria-controls="panel-sheet" data-profile-tab="sheet">Character Sheet</button>' : ""}
              ${projects.length ? `<button type="button" class="profile-tab" role="tab" id="tab-projects" aria-controls="panel-projects" data-profile-tab="projects">Projects <span class="chip-count">${projects.length}</span></button>` : ""}
            </div>` : ""}
          <div class="detail-block" id="panel-profile" ${tabbed ? 'role="tabpanel" aria-labelledby="tab-profile"' : ""}>
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
          ${projects.length ? `<div class="detail-block" id="panel-projects" role="tabpanel" aria-labelledby="tab-projects">
            ${projectGroup("Ongoing", ongoing, "No ongoing projects.")}
            ${projectGroup("Completed", completed, "No completed projects yet.")}
          </div>` : ""}
        </article>`;
      if (tabbed) setupProfileTabs(character);
    };

    // Tabs keep the chosen panel in the URL (characters.html#id#sheet, #id#projects) so it can be linked directly.
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
        window.history.replaceState(null, "", `#${encodeURIComponent(character.id)}${name === "profile" ? "" : `#${name}`}`);
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
      const wanted = window.location.hash.split("#")[2];
      select(tabs.some((tab) => tab.dataset.profileTab === wanted) ? wanted : "profile");
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

// On narrow screens the links fold behind a Menu button, so the sticky header stays one short row.
// Without JavaScript the header keeps its full, wrapped layout.
const setupMobileNav = () => {
  const header = document.querySelector(".site-header");
  const topbar = header?.querySelector(".topbar");
  const nav = header?.querySelector(".main-nav");
  if (!topbar || !nav) return;
  nav.id ||= "main-nav";
  const current = nav.querySelector(".nav-link.active")?.textContent.trim();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-toggle";
  button.setAttribute("aria-controls", nav.id);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<span class="nav-toggle-current">${escapeHtml(current || "Menu")}</span><span class="nav-toggle-icon" aria-hidden="true"></span><span class="sr-only">Open menu</span>`;
  topbar.insertBefore(button, nav);
  header.classList.add("has-nav-toggle");
  const setOpen = (open) => {
    header.classList.toggle("nav-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.querySelector(".sr-only").textContent = open ? "Close menu" : "Open menu";
  };
  button.addEventListener("click", () => setOpen(!header.classList.contains("nav-open")));
  nav.addEventListener("click", (event) => { if (event.target.closest("a")) setOpen(false); });
  document.addEventListener("click", (event) => { if (!header.contains(event.target)) setOpen(false); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header.classList.contains("nav-open")) { setOpen(false); button.focus(); }
  });
};

/* ---------- Discoveries: Resources, Functions, Domains and spell Forms ---------- */

const INTERACTION_NAMES = { synergy: "Synergy", opposition: "Opposition", instability: "Instability" };
const KIND_ORDER = ["instability", "opposition", "synergy"];
const pairKey = (left, right) => [left, right].sort().join("|");
// All interactions of a pair, strongest warning first.
const interactionsOf = (vocabulary, left, right) => (vocabulary.interactions || [])
  .filter((entry) => pairKey(entry.a, entry.b) === pairKey(left, right))
  .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
const interactionBadge = (entry) => `<span class="interaction-badge is-${entry.kind}">${INTERACTION_NAMES[entry.kind]}${entry.keyword ? ` · ${escapeHtml(entry.keyword)}` : ""}</span>`;
const vocabularyWords = (vocabulary) => (vocabulary.functionGroups || []).flatMap((group) => group.functions.map((fn) => ({ ...fn, group: group.name })));

const renderDiscoveries = async () => {
  const panels = Object.fromEntries(["resources", "functions", "domains", "forms"].map((key) => [key, document.getElementById(`panel-${key}`)]));
  if (!panels.resources) return;
  let campaign;
  try {
    campaign = await loadCampaign();
  } catch (error) {
    panels.resources.innerHTML = '<p class="empty-state">Discoveries could not be loaded.</p>';
    console.error(error);
    return;
  }
  const vocabulary = campaign.vocabulary;
  const words = vocabularyWords(vocabulary);
  const wordNames = words.map((word) => word.name);
  const resources = [...campaign.resources].sort((left, right) => String(left.name).localeCompare(String(right.name)));
  const forms = campaign.forms;
  const gates = campaign.archive.filter((entry) => entry.type === "gate-record");

  /* Resources: the catalogue, filtered by Domain, Function and availability. */
  const resourceFilters = { query: "", domain: "", fn: "", availability: "" };
  panels.resources.innerHTML = `
    <div class="discovery-filters">
      <input type="search" class="search-input" data-resource-filter="query" placeholder="Search Resources" aria-label="Search Resources" />
      <select class="search-input" data-resource-filter="domain" aria-label="Domain"><option value="">Any Domain</option>${[...DOMAIN_INFO.values()].map((domain) => `<option value="${escapeHtml(domain.key)}">${escapeHtml(domain.name)}</option>`).join("")}</select>
      <select class="search-input" data-resource-filter="fn" aria-label="Function"><option value="">Any Function</option>${wordNames.map((name) => `<option>${escapeHtml(name)}</option>`).join("")}</select>
      <select class="search-input" data-resource-filter="availability" aria-label="Availability"><option value="">Any availability</option>${["sample", "limited", "available", "unavailable"].map((value) => `<option value="${value}">${humanize(value)}</option>`).join("")}</select>
    </div>
    <p class="muted discovery-count" id="resource-count"></p>
    <div class="resource-grid" id="resource-results"></div>`;
  const renderResources = () => {
    const query = resourceFilters.query.trim().toLowerCase();
    const shown = resources.filter((resource) => (!resourceFilters.domain || (resource.domains || []).includes(resourceFilters.domain))
      && (!resourceFilters.fn || (resource.functions || []).includes(resourceFilters.fn))
      && (!resourceFilters.availability || resource.availability === resourceFilters.availability)
      && (!query || [resource.name, resource.description, resource.specialProperty, ...(resource.functions || [])].join(" ").toLowerCase().includes(query)));
    document.getElementById("resource-count").textContent = shown.length === resources.length ? `${resources.length} Resources catalogued` : `Showing ${shown.length} of ${resources.length} Resources`;
    document.getElementById("resource-results").innerHTML = shown.length ? shown.map((resource) => resourceCard(resource, campaign)).join("")
      : `<p class="empty-state">${resources.length ? "No Resources match." : "No Resources have been catalogued yet."}</p>`;
  };
  panels.resources.addEventListener("input", (event) => {
    const key = event.target.dataset.resourceFilter;
    if (!key) return;
    resourceFilters[key] = event.target.value;
    renderResources();
  });
  renderResources();

  /* Functions: look up a Word, combine Words, draw a random Resource, or scan the interaction grid. */
  let selectedWord = wordNames[0] || "";
  let combo = [];
  let functionTool = "word";
  const wordLink = (name) => `<a class="function-chip" href="#function-${encodeURIComponent(name)}">${escapeHtml(name)}</a>`;
  const resourcesWith = (names) => resources.filter((resource) => names.every((name) => (resource.functions || []).includes(name)));
  const formsWith = (names) => forms.filter((form) => names.every((name) => (form.words || []).includes(name)));
  const recordLinks = (items, href, empty) => items.length
    ? `<ul class="discovery-links">${items.map((item) => `<li><a class="inline-link" href="${href(item)}">${escapeHtml(item.name)}</a></li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`;
  const pairRows = (names) => {
    const rows = [];
    names.forEach((left, index) => names.slice(index + 1).forEach((right) => {
      const found = interactionsOf(vocabulary, left, right);
      rows.push(`<li><span class="pair-names">${wordLink(left)} + ${wordLink(right)}</span>
        ${found.length ? found.map((entry) => `${interactionBadge(entry)}${entry.note ? `<span class="interaction-note">${escapeHtml(entry.note)}</span>` : ""}`).join("")
          : '<span class="muted">No recorded interaction</span>'}</li>`);
    }));
    return rows.length ? `<ul class="pair-list">${rows.join("")}</ul>` : "";
  };

  const wordPanel = () => {
    const word = words.find((item) => item.name === selectedWord);
    if (!word) return '<p class="empty-state">Choose a Word.</p>';
    const related = (vocabulary.interactions || []).filter((entry) => entry.a === word.name || entry.b === word.name);
    const byKind = (kind) => related.filter((entry) => entry.kind === kind).map((entry) => {
      const other = entry.a === word.name ? entry.b : entry.a;
      return `<li>${wordLink(other)}${entry.keyword ? ` <span class="interaction-keyword">${escapeHtml(entry.keyword)}</span>` : ""}${entry.note ? `<span class="interaction-note">${escapeHtml(entry.note)}</span>` : ""}</li>`;
    }).join("");
    return `
      <div class="word-head"><span class="kicker">${escapeHtml(word.group)}</span><h2>${escapeHtml(word.name)}</h2>
        <p class="word-definition">${escapeHtml(word.definition || "No definition recorded.")}</p>
        <button type="button" class="discovery-button" data-combine-with="${escapeHtml(word.name)}">Combine with another Word →</button></div>
      <div class="word-relations">${KIND_ORDER.slice().reverse().map((kind) => `
        <section class="word-relation is-${kind}"><h3>${INTERACTION_NAMES[kind]}</h3>${byKind(kind) ? `<ul>${byKind(kind)}</ul>` : '<p class="muted">None recorded.</p>'}</section>`).join("")}</div>
      <div class="detail-grid">
        <div class="detail-block"><h3>Resources with ${escapeHtml(word.name)}</h3>${recordLinks(resourcesWith([word.name]), (item) => `#resource-${encodeURIComponent(item.id)}`, "None catalogued yet.")}</div>
        <div class="detail-block"><h3>Forms using ${escapeHtml(word.name)}</h3>${recordLinks(formsWith([word.name]), (item) => `#form-${encodeURIComponent(item.id)}`, "None recorded yet.")}</div>
      </div>`;
  };

  const comboPanel = () => {
    const select = (index) => `<select class="search-input" data-combo="${index}" aria-label="Word ${index + 1}">
      <option value="">${index < 2 ? "Choose a Word" : "Optional third Word"}</option>${wordNames.map((name) => `<option ${combo[index] === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>`;
    const chosen = [...new Set(combo.filter(Boolean))];
    return `
      <h2>Combine Words</h2>
      <p class="muted">Pick two or three Words to see how they behave together, which known Resources already combine them, and which Forms use them.</p>
      <div class="combo-selects">${select(0)}<span aria-hidden="true">+</span>${select(1)}<span aria-hidden="true">+</span>${select(2)}</div>
      ${chosen.length >= 2 ? `
        <h3>Interactions</h3>${pairRows(chosen)}
        <div class="detail-grid">
          <div class="detail-block"><h3>Resources with all of them</h3>${recordLinks(resourcesWith(chosen), (item) => `#resource-${encodeURIComponent(item.id)}`, "No known Resource combines them yet.")}</div>
          <div class="detail-block"><h3>Forms using all of them</h3>${recordLinks(formsWith(chosen), (item) => `#form-${encodeURIComponent(item.id)}`, "No Form uses them together yet.")}</div>
        </div>
        <p class="muted">Interactions are guidance, not a chemistry table: the GM decides how a particular combination behaves.</p>` : ""}`;
  };

  const randomState = { count: "random", hidden: false, drawn: null, hiddenIndex: -1 };
  const randomPanel = () => {
    const drawn = randomState.drawn;
    return `
      <h2>Random Resource</h2>
      <p class="muted">Draw Functions at random for a Gate, an experiment or inspiration. Usually two, sometimes one or three, rarely four.</p>
      <div class="picker-controls">
        <label>Functions <select data-random-count>${["random", 1, 2, 3, 4].map((value) => `<option value="${value}" ${String(value) === String(randomState.count) ? "selected" : ""}>${value === "random" ? "Random" : value}</option>`).join("")}</select></label>
        <label class="picker-check"><input type="checkbox" data-random-hidden ${randomState.hidden ? "checked" : ""} /> Make one Hidden</label>
        <button type="button" class="picker-draw" data-random-draw>Draw a Resource</button>
      </div>
      ${drawn ? `<ul class="picker-functions">${drawn.map((word, index) => `<li${index === randomState.hiddenIndex ? ' class="is-hidden"' : ""}>${wordLink(word.name)}${index === randomState.hiddenIndex ? '<span class="picker-hidden-label">Hidden</span>' : ""}<span>${escapeHtml(word.definition || "")}</span></li>`).join("")}</ul>
        ${drawn.length > 1 ? `<h3>Interactions</h3>${pairRows(drawn.map((word) => word.name))}` : ""}
        <button type="button" class="discovery-button" data-open-combo="${escapeHtml(drawn.map((word) => word.name).join("+"))}">Open in Combine →</button>
        <p class="muted">Now give it a name, a description and, if it needs one, a Special Property.</p>` : ""}`;
  };
  const drawRandom = () => {
    const weights = [[1, 30], [2, 45], [3, 20], [4, 5]];
    let count = Number(randomState.count);
    if (!count) {
      let roll = Math.random() * 100;
      count = (weights.find(([, weight]) => (roll -= weight) < 0) || [2])[0];
    }
    const pool = [...words];
    randomState.drawn = Array.from({ length: Math.min(count, pool.length) }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    randomState.hiddenIndex = randomState.hidden && count > 1 ? Math.floor(Math.random() * count) : -1;
  };

  const gridPanel = () => {
    const strongest = (left, right) => interactionsOf(vocabulary, left, right);
    return `
      <h2>Interaction grid</h2>
      <p class="muted">Every Word against every other. Click a square to open that pair in Combine.</p>
      <p class="grid-legend"><span class="grid-cell is-synergy"></span> Synergy <span class="grid-cell is-opposition"></span> Opposition <span class="grid-cell is-instability"></span> Instability <span class="grid-cell is-mixed"></span> Synergy and a risk</p>
      <div class="grid-scroll"><table class="interaction-grid"><thead><tr><th></th>${wordNames.map((name) => `<th scope="col"><span>${escapeHtml(name)}</span></th>`).join("")}</tr></thead>
        <tbody>${wordNames.map((row) => `<tr><th scope="row">${escapeHtml(row)}</th>${wordNames.map((column) => {
          if (row === column) return '<td class="grid-self"></td>';
          const found = strongest(row, column);
          if (!found.length) return `<td><button type="button" class="grid-cell" data-grid-pair="${escapeHtml(row)}+${escapeHtml(column)}" aria-label="${escapeHtml(row)} and ${escapeHtml(column)}: no recorded interaction"></button></td>`;
          const kinds = found.map((entry) => entry.kind);
          const kind = kinds.includes("synergy") && kinds.length > 1 ? "mixed" : found[0].kind;
          const label = found.map((entry) => `${INTERACTION_NAMES[entry.kind]}${entry.keyword ? ` (${entry.keyword})` : ""}`).join("; ");
          return `<td><button type="button" class="grid-cell is-${kind}" data-grid-pair="${escapeHtml(row)}+${escapeHtml(column)}" title="${escapeHtml(`${row} + ${column}: ${label}`)}" aria-label="${escapeHtml(`${row} and ${column}: ${label}`)}"></button></td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div>`;
  };

  const renderFunctions = () => {
    const toolButton = (key, label) => `<button type="button" class="filter-chip" data-function-tool="${key}" aria-pressed="${functionTool === key}">${label}</button>`;
    const panel = { word: wordPanel, combine: comboPanel, random: randomPanel, grid: gridPanel }[functionTool]();
    panels.functions.innerHTML = `
      <div class="filter-bar function-tools">${toolButton("word", "Look up a Word")}${toolButton("combine", "Combine Words")}${toolButton("random", "Random Resource")}${toolButton("grid", "Interaction grid")}</div>
      <div class="functions-layout${functionTool === "grid" ? " is-wide" : ""}">
        ${functionTool === "grid" ? "" : `<aside class="word-index" aria-label="Function vocabulary">${(vocabulary.functionGroups || []).map((group) => `
          <h3>${escapeHtml(group.name)}</h3>
          <ul>${group.functions.map((fn) => `<li><a class="word-index-link${functionTool === "word" && fn.name === selectedWord ? " is-active" : ""}" href="#function-${encodeURIComponent(fn.name)}">${escapeHtml(fn.name)}</a></li>`).join("")}</ul>`).join("")}</aside>`}
        <div class="function-panel">${panel}</div>
      </div>`;
  };
  panels.functions.addEventListener("click", (event) => {
    const tool = event.target.closest("[data-function-tool]");
    if (tool) { functionTool = tool.dataset.functionTool; return renderFunctions(); }
    const combineWith = event.target.closest("[data-combine-with]");
    if (combineWith) { combo = [combineWith.dataset.combineWith]; functionTool = "combine"; return renderFunctions(); }
    const openCombo = event.target.closest("[data-open-combo]");
    if (openCombo) { combo = openCombo.dataset.openCombo.split("+").slice(0, 3); functionTool = "combine"; return renderFunctions(); }
    const gridPair = event.target.closest("[data-grid-pair]");
    if (gridPair) { combo = gridPair.dataset.gridPair.split("+"); functionTool = "combine"; return renderFunctions(); }
    if (event.target.closest("[data-random-draw]")) { drawRandom(); return renderFunctions(); }
  });
  panels.functions.addEventListener("change", (event) => {
    if (event.target.dataset.combo !== undefined) { combo[Number(event.target.dataset.combo)] = event.target.value; renderFunctions(); }
    if (event.target.matches("[data-random-count]")) randomState.count = event.target.value;
    if (event.target.matches("[data-random-hidden]")) randomState.hidden = event.target.checked;
  });

  /* Domains: each with what it covers, its Gates and its Resources. */
  panels.domains.innerHTML = [...DOMAIN_INFO.values()].map((domain) => {
    const domainGates = gates.filter((gate) => (gate.details?.domains || []).includes(domain.key));
    const domainResources = resources.filter((resource) => (resource.domains || []).includes(domain.key));
    return `<article class="domain-card" id="domain-${escapeHtml(domain.key)}" style="--domain-colour: ${/^#[0-9a-fA-F]{6}$/.test(domain.colour || "") ? domain.colour : "var(--line-strong)"}">
      <h2>${escapeHtml(domain.name)}</h2>
      <p>${escapeHtml(domain.description || "")}</p>
      <div class="detail-grid">
        <div class="detail-block"><h3>Gates</h3>${domainGates.length ? `<ul class="discovery-links">${domainGates.map((gate) => `<li><a class="inline-link" href="archive.html#${encodeURIComponent(gate.id)}">${escapeHtml(gateName(gate))}</a></li>`).join("")}</ul>` : '<p class="muted">None recorded yet.</p>'}</div>
        <div class="detail-block"><h3>Resources</h3>${recordLinks(domainResources, (item) => `#resource-${encodeURIComponent(item.id)}`, "None catalogued yet.")}</div>
      </div>
    </article>`;
  }).join("") || '<p class="empty-state">No Domains recorded.</p>';
  panels.domains.insertAdjacentHTML("afterbegin", '<p class="muted discovery-count">Every Gate has a Domain, and what comes from it shares that Domain. See the <a class="inline-link" href="game.html#post-domains">Domains rule</a>.</p>');

  /* Spell Forms, by tier. */
  const tiers = [["basic", "Basic Forms"], ["first", "First Forms"], ["second", "Second Forms"], ["third", "Third Forms"]];
  panels.forms.innerHTML = '<p class="muted discovery-count">The Forms Endros has recorded. How to cast them is in the <a class="inline-link" href="game.html#post-spellcasting">Spellcasting rule</a>.</p>'
    + (forms.length ? tiers.map(([tier, title]) => {
      const tierForms = forms.filter((form) => form.tier === tier).sort((left, right) => String(left.name).localeCompare(String(right.name)));
      return tierForms.length ? `<h2 class="catalogue-heading">${title}</h2><div class="rich-table"><table><thead><tr><th>Form</th><th>Words</th><th>Effect</th></tr></thead><tbody>
        ${tierForms.map((form) => `<tr id="form-${escapeHtml(form.id)}"><td><strong>${escapeHtml(form.name)}</strong>${form.status && form.status !== "known" ? ` <span class="form-status">${escapeHtml(humanize(form.status))}</span>` : ""}</td>
          <td>${functionChips(form.words)}</td><td>${form.effect ? richInline(form.effect, campaign) : '<span class="muted">NO DATA</span>'}</td></tr>`).join("")}
      </tbody></table></div>` : "";
    }).join("") : '<p class="empty-state">No Forms have been recorded yet.</p>');

  /* Tabs follow the hash: #resources, #functions, #domains, #forms, and deep links into each. */
  const tabs = [...document.querySelectorAll("[data-discovery-tab]")];
  const select = (name) => tabs.forEach((tab) => {
    const active = tab.dataset.discoveryTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panels[tab.dataset.discoveryTab].hidden = !active;
  });
  const highlight = (id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    element.classList.add("is-highlighted");
    setTimeout(() => element.classList.remove("is-highlighted"), 1800);
  };
  const route = () => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash.startsWith("function-")) {
      selectedWord = wordNames.includes(hash.slice(9)) ? hash.slice(9) : selectedWord;
      functionTool = "word";
      select("functions");
      renderFunctions();
      panels.functions.scrollIntoView({ block: "start" });
    } else if (hash.startsWith("resource-")) {
      Object.assign(resourceFilters, { query: "", domain: "", fn: "", availability: "" });
      panels.resources.querySelectorAll("[data-resource-filter]").forEach((control) => { control.value = ""; });
      renderResources();
      select("resources");
      highlight(hash);
    } else if (hash.startsWith("domain-")) {
      select("domains");
      highlight(hash);
    } else if (hash.startsWith("form-")) {
      select("forms");
      highlight(hash);
    } else if (["resources", "functions", "domains", "forms"].includes(hash)) {
      select(hash);
      if (hash === "functions") renderFunctions();
    } else {
      select("resources");
    }
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    window.history.replaceState(null, "", `#${tab.dataset.discoveryTab}`);
    select(tab.dataset.discoveryTab);
    if (tab.dataset.discoveryTab === "functions") renderFunctions();
  }));
  window.addEventListener("hashchange", route);
  renderFunctions();
  route();
};

/* ---------- Site-wide search ---------- */

const PAGE_ENTRIES = [
  ["Overview", "index.html", "Start here, the launch timeline and every section"], ["Outpost Sheet", "outpost.html", "Capabilities, facilities, projects and consequences"],
  ["Job Board", "jobs.html", "Expeditions and work looking for crew"], ["Archive", "archive.html", "Gate records, sessions, newspapers, history, folklore"],
  ["Discoveries", "discoveries.html", "Resources, Functions, Domains and spell Forms"], ["Marketplace", "marketplace.html", "Equipment for sale"],
  ["Characters", "characters.html", "Expeditioners and known figures"], ["Rules & News", "game.html", "Announcements and rules"],
  ["Onboarding", "game.html#onboarding", "start here the essential rules new players read first reading path"], ["Create a character", "sheet.html?new", "make build start a new character Expeditioner on a blank sheet"],
];
let searchIndexPromise = null;
const buildSearchIndex = () => searchIndexPromise ||= Promise.all([loadCampaign(), fetchGame().catch(() => []), fetchJson("data/learning-paths.json").catch(() => [])])
  .then(([campaign, posts, paths]) => [
  ...(Array.isArray(paths) ? paths : []).filter((item, index) => index > 0 && item.ruleIds.length).map((item) => ({ label: item.title,
    href: `game.html#path-${encodeURIComponent(item.key)}`, kind: "Learning path", text: `${item.description || ""} learning path` })),
  ...PAGE_ENTRIES.map(([label, href, text]) => ({ label, href, kind: "Page", text })),
  ...posts.map((post) => ({ label: post.title, href: `game.html#post-${encodeURIComponent(post.id)}`, kind: post.type === "announcement" ? "Announcement" : "Rule",
    text: [post.summary, ...(post.tags || []), post.category].join(" "), body: post.details || "" })),
  ...campaign.archive.map((entry) => ({ label: entry.type === "gate-record" ? gateName(entry) : entry.title, href: `archive.html#${encodeURIComponent(entry.id)}`,
    kind: entry.type === "gate-record" ? "Gate" : archiveTypeLabel(entry.type), text: [entry.summary, ...(entry.tags || [])].join(" "), body: entry.content || "" })),
  ...campaign.resources.map((resource) => ({ label: resource.name, href: `discoveries.html#resource-${encodeURIComponent(resource.id)}`, kind: "Resource",
    text: [resource.description, ...(resource.functions || [])].join(" ") })),
  ...campaign.forms.map((form) => ({ label: form.name, href: `discoveries.html#form-${encodeURIComponent(form.id)}`, kind: "Spell Form", text: [form.effect, ...(form.words || [])].join(" ") })),
  ...vocabularyWords(campaign.vocabulary).map((word) => ({ label: word.name, href: `discoveries.html#function-${encodeURIComponent(word.name)}`, kind: "Function", text: word.definition || "" })),
  ...[...DOMAIN_INFO.values()].map((domain) => ({ label: domain.name, href: `discoveries.html#domain-${encodeURIComponent(domain.key)}`, kind: "Domain", text: domain.description || "" })),
  ...campaign.characters.map((character) => ({ label: character.name, href: `characters.html#${encodeURIComponent(character.id)}`, kind: "Character", text: character.summary || "" })),
  ...campaign.jobs.map((job) => ({ label: jobLabel(job), href: `jobs.html#${encodeURIComponent(job.id)}`, kind: "Job", text: [job.summary, job.objective].join(" ") })),
  ...campaign.gear.map((gear) => ({ label: gear.name, href: `marketplace.html#gear-${encodeURIComponent(gear.id)}`, kind: "Gear", text: gear.description || "" })),
]);

const siteSearch = { index: PAGE_ENTRIES.map(([label, href, text]) => ({ label, href, kind: "Page", text })), results: [], active: 0 };
// Words that say nothing about what is being looked for ("how do I make a character").
const SEARCH_STOP_WORDS = new Set(["a", "an", "the", "how", "do", "does", "i", "to", "of", "in", "on", "for", "is", "are", "what", "where", "my", "can", "with", "and", "or"]);
// Titles count most, then summaries and tags, then body text.
const searchScore = (item, words) => words.reduce((score, word) => {
  if (score < 0) return score;
  const label = String(item.label || "").toLowerCase();
  if (label.startsWith(word)) return score + 6;
  if (label.includes(word)) return score + 4;
  if (String(item.text || "").toLowerCase().includes(word)) return score + 2;
  if (String(item.body || "").toLowerCase().includes(word)) return score + 1;
  return -1;
}, 0);

async function openSiteSearch() {
  let dialog = document.getElementById("site-search");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "site-search";
    dialog.className = "site-search";
    dialog.innerHTML = `<div class="site-search-panel" role="dialog" aria-label="Search the site">
      <input type="search" class="search-input" id="site-search-input" placeholder="Search rules, Gates, Resources, characters…" autocomplete="off" aria-label="Search the site" />
      <ul class="site-search-results" id="site-search-results" role="listbox"></ul>
      <p class="muted site-search-help">↑ ↓ to choose · Enter to open · Esc to close</p></div>`;
    document.body.append(dialog);
    const input = dialog.querySelector("input");
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeSiteSearch(); });
    input.addEventListener("input", () => { siteSearch.active = 0; renderSiteSearch(input.value); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); siteSearch.active = Math.min(siteSearch.results.length - 1, siteSearch.active + 1); renderSiteSearch(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); siteSearch.active = Math.max(0, siteSearch.active - 1); renderSiteSearch(); }
      else if (event.key === "Enter") { event.preventDefault(); const item = siteSearch.results[siteSearch.active]; if (item) { closeSiteSearch(); window.location.href = item.href; } }
      else if (event.key === "Escape") closeSiteSearch();
    });
    dialog.querySelector(".site-search-results").addEventListener("click", (event) => { if (event.target.closest("a")) closeSiteSearch(); });
  }
  dialog.hidden = false;
  document.body.classList.add("search-open");
  const input = dialog.querySelector("input");
  input.value = "";
  input.focus();
  renderSiteSearch("");
  try { siteSearch.index = await buildSearchIndex(); } catch { siteSearch.index = PAGE_ENTRIES.map(([label, href, text]) => ({ label, href, kind: "Page", text })); }
  // Whatever was typed while the index loaded is searched now.
  renderSiteSearch(input.value);
}

function renderSiteSearch(query) {
  if (query !== undefined) {
    const words = query.toLowerCase().split(/\s+/).filter((word) => word && !SEARCH_STOP_WORDS.has(word));
    siteSearch.results = words.length
      ? siteSearch.index.map((item) => ({ item, score: searchScore(item, words) })).filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score).slice(0, 14).map(({ item }) => item)
      : siteSearch.index.filter((item) => item.kind === "Page");
  }
  document.getElementById("site-search-results").innerHTML = siteSearch.results.length ? siteSearch.results.map((item, index) => `
    <li role="option" aria-selected="${index === siteSearch.active}"><a class="${index === siteSearch.active ? "is-active" : ""}" href="${escapeHtml(item.href)}">
      <span>${escapeHtml(item.label)}</span><span class="site-search-kind">${escapeHtml(item.kind)}</span></a></li>`).join("")
    : '<li class="site-search-empty">Nothing matches.</li>';
}

function closeSiteSearch() {
  const dialog = document.getElementById("site-search");
  if (dialog) dialog.hidden = true;
  document.body.classList.remove("search-open");
}

const setupSiteSearch = () => {
  const topbar = document.querySelector(".site-header .topbar");
  if (!topbar) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-toggle";
  button.title = "Search the site (Ctrl+K)";
  button.innerHTML = '<span aria-hidden="true">⌕</span><span class="search-toggle-label">Search</span>';
  button.addEventListener("click", openSiteSearch);
  // Start loading the index as soon as someone reaches for the button.
  ["pointerenter", "focus"].forEach((type) => button.addEventListener(type, () => buildSearchIndex().catch(() => null), { once: true }));
  topbar.append(button); // CSS order puts it after the links on wide screens and beside the Menu button when folded
  document.addEventListener("keydown", (event) => {
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || "");
    if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !typing)) {
      event.preventDefault();
      openSiteSearch();
    }
  });
};

/* ---------- Footer site map ---------- */

const renderFooterMap = () => {
  const footer = document.querySelector(".footer");
  if (!footer || footer.querySelector(".footer-map")) return;
  const column = (title, links) => `<div><h2>${title}</h2><ul>${links.map(([label, href]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul></div>`;
  footer.insertAdjacentHTML("afterbegin", `<nav class="footer-map wrapper" aria-label="Site map">
    ${column("The world", [["Outpost", "outpost.html"], ["Archive", "archive.html"], ["Discoveries", "discoveries.html"], ["Marketplace", "marketplace.html"]])}
    ${column("Expeditions", [["Job Board", "jobs.html"], ["Characters", "characters.html"], ["Create a character", "sheet.html?new"]])}
    ${column("Rules", [["Onboarding", "game.html#onboarding"], ["Learning paths", "game.html#post-game-listing"], ["Downtime", "game.html#post-downtime"], ["All rules", "game.html#rules"]])}
    ${column("News", [["Announcements", "game.html#announcements"], ["Overview", "index.html"]])}
  </nav>`);
};

const PAGE_RENDERERS ={ game: renderGame, jobs: renderJobBoard, archive: renderArchive, marketplace: renderMarketplace, characters: renderCharacterRoster, discoveries: renderDiscoveries };

document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav();
  setupMobileNav();
  setupSiteSearch();
  renderFooterMap();
  initializeDestinationCarousel();
  const page = document.body.dataset.page;
  await Promise.all([renderOutpost(), renderAnnouncementBanner(), renderLaunchPanel(), renderFooterCommunity(), renderSiteVersion(), PAGE_RENDERERS[page]?.()]);
  // Marks the page as fully rendered; the content manager's preview waits for this before showing an update.
  document.documentElement.dataset.rendered = "true";
});
