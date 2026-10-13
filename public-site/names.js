/* Name Generator for Nowhere Expeditions (names.html).
   Suggests character names in the style of each faction's homeland. The lists live in assets/names.json, which the
   Discord bot's /names command reads too; the generator below mirrors the bot's names.py, so keep the two in step.
   Deep link: names.html#<faction-id> (for example names.html#vardic-holds). */
(() => {
  "use strict";

  const SOURCE = "assets/names.json";
  const COUNT = 10;
  const GENDERS = ["feminine", "masculine"];
  const STYLES = [["", "Mixed"], ["feminine", "Feminine"], ["masculine", "Masculine"]];

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const italics = (text) => escapeHtml(text).replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const sample = (list, count) => {
    const pool = [...list];
    const chosen = [];
    while (chosen.length < count && pool.length) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return chosen;
  };
  const weighted = (patterns) => {
    const total = patterns.reduce((sum, pattern) => sum + (pattern.weight ?? 1), 0);
    let roll = Math.random() * total;
    for (const pattern of patterns) {
      roll -= pattern.weight ?? 1;
      if (roll < 0) return pattern.format;
    }
    return patterns[patterns.length - 1].format;
  };

  const givenName = (style, gender) => {
    if (style.syllables) {
      const parts = sample([...style.syllables[gender], ...(style.syllables.neutral || [])], pick([1, 2, 2]));
      // Pinyin marks a syllable break before a vowel: Ying'an, not Yingan.
      return parts[0] + parts.slice(1).map((part) => ("AEO".includes(part[0]) ? "'" : "") + part.toLowerCase()).join("");
    }
    return pick(style[gender]);
  };

  const oneName = (style, gender) => {
    const format = weighted(style.patterns);
    const given = givenName(style, gender);
    const [surname, surname2] = sample(style.surnames, 2);
    const values = { given, surname, surname2, initial: `${pick("ABCDEFGHIJKLMNOPQRSTUVWYZ")}.` };
    if (format.includes("{given2}")) values.given2 = pick(style[gender].filter((name) => name !== given));
    if (format.includes("{patronymic}")) values.patronymic = pick(style.fathers) + style.patronymic[gender];
    return format.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  };

  const generate = (style, gender) => {
    const names = [];
    for (let attempt = 0; attempt < COUNT * 20 && names.length < COUNT; attempt += 1) {
      const name = oneName(style, gender || pick(GENDERS));
      if (!names.includes(name)) names.push(name);
    }
    return names;
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const render = async (root) => {
    let factions;
    try {
      const response = await fetch(SOURCE, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${response.status}`);
      factions = (await response.json()).factions || {};
    } catch (error) {
      root.innerHTML = '<p class="empty-state">The name lists could not be loaded.</p>';
      console.error(error);
      return;
    }
    const ids = Object.keys(factions);
    if (!ids.length) {
      root.innerHTML = '<p class="empty-state">No name lists yet.</p>';
      return;
    }
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      return factions[id] ? id : null;
    };
    let origin = fromHash() || ids[0];
    let gender = "";

    root.innerHTML = `
      <section class="faction-section names-controls">
        <h3>Where are they from?</h3>
        <div class="filter-bar" role="group" aria-label="Homeland">
          ${ids.map((id) => `<button type="button" class="filter-chip topic-chip" data-origin="${escapeHtml(id)}">${escapeHtml(factions[id].label)}</button>`).join("")}
        </div>
        <h3>Style</h3>
        <div class="filter-bar" role="group" aria-label="Style">
          ${STYLES.map(([value, label]) => `<button type="button" class="filter-chip topic-chip" data-gender="${value}">${label}</button>`).join("")}
        </div>
      </section>
      <div class="faction-layout names-layout">
        <section class="faction-section names-results" aria-live="polite">
          <h3 data-names-title></h3>
          <ol class="name-list" data-names-list></ol>
          <button type="button" class="discovery-button" data-reroll><span aria-hidden="true">🎲</span> Ten more</button>
        </section>
        <aside class="faction-section names-about">
          <h3>How they're named</h3>
          <p data-names-note></p>
          <a class="destination-link" data-names-faction href="factions.html">About them <span aria-hidden="true">→</span></a>
          <p class="faction-note">These are suggestions. Mix, change or ignore them: a name only has to suit your character.</p>
        </aside>
      </div>`;

    const list = root.querySelector("[data-names-list]");
    const update = () => {
      const style = factions[origin];
      root.querySelectorAll("[data-origin]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.origin === origin)));
      root.querySelectorAll("[data-gender]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.gender === gender)));
      root.querySelector("[data-names-title]").textContent = `Names from ${origin === "verna" ? "" : "the "}${style.label}`;
      root.querySelector("[data-names-note]").innerHTML = italics(style.note || "");
      const link = root.querySelector("[data-names-faction]");
      link.href = `factions.html#${encodeURIComponent(origin)}`;
      link.firstChild.textContent = `About ${origin === "verna" ? "" : "the "}${style.label} `;
      list.innerHTML = generate(style, gender).map((name) => `
        <li><span class="name-text">${escapeHtml(name)}</span>
          <button type="button" class="name-copy" data-copy="${escapeHtml(name)}" aria-label="Copy ${escapeHtml(name)}">Copy</button></li>`).join("");
    };

    root.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.origin) {
        origin = button.dataset.origin;
        history.replaceState(null, "", `#${encodeURIComponent(origin)}`);
        update();
      } else if (button.dataset.gender !== undefined) {
        gender = button.dataset.gender;
        update();
      } else if (button.hasAttribute("data-reroll")) {
        update();
      } else if (button.dataset.copy) {
        const copied = await copyText(button.dataset.copy);
        button.textContent = copied ? "Copied" : "Select it";
        setTimeout(() => { button.textContent = "Copy"; }, 1500);
      }
    });
    window.addEventListener("hashchange", () => {
      const id = fromHash();
      if (id && id !== origin) {
        origin = id;
        update();
      }
    });
    update();
  };

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("names-root");
    if (root) render(root);
  });
})();
