/* Fate dice for Nowhere Expeditions.
   Rolls 4dF + a modifier and keeps the last 30 results in this browser only (localStorage), shared between open
   tabs of the site. Used by the public pages and by the editable character sheet. It is self-contained (no imports,
   styles injected below) so any page can load it with one script tag. */
(() => {
  "use strict";
  if (window.NowhereDice) return;

  const STORAGE_KEY = "nowhere-expeditions:rolls";
  const LIMIT = 30;
  const LADDER = { 8: "Legendary", 7: "Epic", 6: "Fantastic", 5: "Superb", 4: "Great", 3: "Good", 2: "Fair", 1: "Average",
    0: "Mediocre", "-1": "Poor", "-2": "Terrible" };
  const DIE_ICON = '<svg class="nx-die-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="16" cy="16" r="1.7" fill="currentColor"/><circle cx="16" cy="8" r="1.7" fill="currentColor"/><circle cx="8" cy="16" r="1.7" fill="currentColor"/></svg>';

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = (value) => `${value >= 0 ? "+" : ""}${value}`;
  const ladderName = (total) => LADDER[total] || (total > 8 ? "Beyond Legendary" : "Below Terrible");
  const face = (value) => value > 0 ? "+" : value < 0 ? "−" : " ";
  const faceName = (value) => value > 0 ? "plus" : value < 0 ? "minus" : "blank";

  const read = () => {
    try {
      const rolls = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(rolls) ? rolls : [];
    } catch { return []; }
  };
  const write = (rolls) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rolls.slice(0, LIMIT))); } catch { /* storage unavailable */ } };

  const rollDie = () => {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] % 3) - 1;
  };

  const STYLE = `
    .nx-roll { display: inline-flex; align-items: center; justify-content: center; gap: 0.35em; padding: 0.2em 0.45em;
      border: 1px solid var(--line-strong, rgba(164, 192, 200, 0.45)); background: transparent; color: var(--accent, #7ad7d1);
      font: inherit; line-height: 1.2; cursor: pointer; }
    .nx-roll:hover, .nx-roll:focus-visible { border-color: var(--accent-2, #e0a85d); color: var(--accent-2, #e0a85d); }
    .nx-roll:focus-visible { outline: 2px solid rgba(122, 215, 209, 0.55); outline-offset: 1px; }
    .nx-die-icon { width: 1.05em; height: 1.05em; flex: 0 0 auto; }
    .nx-dice { position: fixed; right: 1rem; bottom: 1rem; z-index: 50; display: flex; flex-direction: column; align-items: flex-end;
      gap: 0.5rem; max-width: min(22rem, calc(100vw - 2rem)); color: var(--text, #e7f0f2); font: 14px/1.4 "Segoe UI", sans-serif; }
    .nx-card, .nx-log { width: 100%; border: 1px solid var(--line-strong, rgba(164, 192, 200, 0.45)); background: #0b1214;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45); }
    .nx-card { position: relative; padding: 0.8rem 2.4rem 0.8rem 0.9rem; border-top: 2px solid var(--accent-2, #e0a85d); }
    .nx-card-label { color: var(--muted, #aebec2); font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; }
    .nx-card-result { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.4rem; }
    .nx-face { display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border: 1px solid var(--line-strong, rgba(164, 192, 200, 0.45));
      background: #121c1f; font-size: 1.15rem; font-weight: 700; }
    .nx-face.is-plus { color: var(--accent, #7ad7d1); }
    .nx-face.is-minus { color: var(--danger, #d66d63); }
    .nx-card.is-fresh .nx-face { animation: nx-tumble 0.45s ease-out both; }
    .nx-card.is-fresh .nx-face:nth-child(2) { animation-delay: 0.05s; }
    .nx-card.is-fresh .nx-face:nth-child(3) { animation-delay: 0.1s; }
    .nx-card.is-fresh .nx-face:nth-child(4) { animation-delay: 0.15s; }
    .nx-mod { color: var(--muted, #aebec2); }
    .nx-total { margin-left: auto; font-size: 1.35rem; font-weight: 700; }
    .nx-total small { display: block; color: var(--accent-2, #e0a85d); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-align: right; text-transform: uppercase; }
    .nx-close { position: absolute; top: 0.35rem; right: 0.35rem; width: 1.8rem; height: 1.8rem; border: 0; background: none; color: var(--muted, #aebec2); font-size: 1rem; cursor: pointer; }
    .nx-close:hover, .nx-close:focus-visible { color: var(--text, #e7f0f2); }
    .nx-log { max-height: min(24rem, 60vh); display: flex; flex-direction: column; }
    .nx-log-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--line, rgba(164, 192, 200, 0.2)); }
    .nx-log-head h2 { margin: 0; color: var(--muted, #aebec2); font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; }
    .nx-log-actions { display: flex; gap: 0.35rem; }
    .nx-log ol { margin: 0; padding: 0.3rem 0.8rem 0.6rem; overflow-y: auto; list-style: none; }
    .nx-log li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.1rem 0.6rem; padding: 0.4rem 0; border-bottom: 1px solid var(--line, rgba(164, 192, 200, 0.2)); }
    .nx-log li:last-child { border-bottom: 0; }
    .nx-log-label { overflow-wrap: anywhere; }
    .nx-log-total { font-weight: 700; text-align: right; }
    .nx-log-meta { grid-column: 1 / -1; color: var(--muted, #aebec2); font-size: 0.78rem; }
    .nx-log-empty { padding: 0.8rem; color: var(--muted, #aebec2); }
    .nx-toggle { padding: 0.45rem 0.75rem; background: #0b1214; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4); }
    .nx-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @keyframes nx-tumble { from { transform: rotate(-90deg) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .nx-card.is-fresh .nx-face { animation: none; } }
    @media print { .nx-dice, .nx-roll { display: none !important; } }`;

  let root;
  let logOpen = false;
  let latest = null;
  let fresh = false;

  const mount = () => {
    if (root) return;
    const style = document.createElement("style");
    style.id = "nx-dice-style";
    style.textContent = STYLE;
    document.head.append(style);
    root = document.createElement("aside");
    root.className = "nx-dice";
    root.setAttribute("aria-label", "Dice rolls");
    document.body.append(root);
    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-nx]")?.dataset.nx;
      if (action === "close") { latest = null; render(); }
      else if (action === "toggle") { logOpen = !logOpen; render(); root.querySelector('[data-nx="toggle"]')?.focus(); }
      else if (action === "clear") {
        if (!confirm("Clear your roll history? This only affects this browser.")) return;
        write([]);
        latest = null;
        render();
      } else if (action === "plain") roll("Plain roll", 0);
    });
  };

  const render = () => {
    mount();
    const rolls = read();
    const card = latest ? `
      <div class="nx-card${fresh ? " is-fresh" : ""}" role="status" aria-live="polite">
        <div class="nx-card-label">${escapeHtml(latest.label)} (${escapeHtml(signed(latest.modifier))})</div>
        <div class="nx-card-result">
          ${latest.dice.map((value) => `<span class="nx-face is-${faceName(value)}" aria-hidden="true">${face(value)}</span>`).join("")}
          <span class="nx-mod" aria-hidden="true">${escapeHtml(signed(latest.modifier))}</span>
          <span class="nx-total">${escapeHtml(signed(latest.total))}<small>${escapeHtml(ladderName(latest.total))}</small></span>
          <span class="nx-sr">Rolled ${latest.dice.map(faceName).join(", ")}, total ${escapeHtml(signed(latest.total))}, ${escapeHtml(ladderName(latest.total))}.</span>
        </div>
        <button type="button" class="nx-close" data-nx="close" aria-label="Dismiss roll result">✕</button>
      </div>` : "";
    const log = logOpen ? `
      <section class="nx-log" aria-label="Roll history">
        <div class="nx-log-head">
          <h2>Last ${LIMIT} rolls</h2>
          <div class="nx-log-actions">
            <button type="button" class="nx-roll" data-nx="plain">${DIE_ICON}4dF</button>
            <button type="button" class="nx-roll" data-nx="clear" ${rolls.length ? "" : "disabled"}>Clear</button>
          </div>
        </div>
        ${rolls.length ? `<ol>${rolls.map((entry) => `
          <li>
            <span class="nx-log-label">${escapeHtml(entry.label)} (${escapeHtml(signed(entry.modifier))})</span>
            <span class="nx-log-total">${escapeHtml(signed(entry.total))}</span>
            <span class="nx-log-meta">${entry.dice.map(face).map((f) => `[${f}]`).join(" ")} · ${escapeHtml(ladderName(entry.total))} · ${escapeHtml(new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
          </li>`).join("")}</ol>` : '<p class="nx-log-empty">No rolls yet.</p>'}
      </section>` : "";
    root.innerHTML = `${card}${log}
      <button type="button" class="nx-roll nx-toggle" data-nx="toggle" aria-expanded="${logOpen}">${DIE_ICON}Rolls (${rolls.length})</button>`;
    fresh = false;
  };

  const roll = (label, modifier = 0) => {
    const mod = Number.isFinite(Number(modifier)) ? Math.round(Number(modifier)) : 0;
    const dice = [rollDie(), rollDie(), rollDie(), rollDie()];
    const entry = { label: String(label || "Roll"), modifier: mod, dice, total: dice.reduce((sum, value) => sum + value, 0) + mod, at: new Date().toISOString() };
    write([entry, ...read()]);
    latest = entry;
    fresh = true;
    render();
    return entry;
  };

  // A roll button for any page: <button data-roll-label="..." data-roll-mod="2">.
  const button = (label, modifier, text = "") => `<button type="button" class="nx-roll" data-roll-label="${escapeHtml(label)}" data-roll-mod="${escapeHtml(modifier)}" title="Roll ${escapeHtml(label)} (${escapeHtml(signed(Number(modifier) || 0))})">${DIE_ICON}${text ? escapeHtml(text) : `<span class="nx-sr">Roll ${escapeHtml(label)}</span>`}</button>`;

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-roll-mod]");
    if (trigger) roll(trigger.dataset.rollLabel, trigger.dataset.rollMod);
  });
  // Rolls made in another tab show up in this tab's history.
  window.addEventListener("storage", (event) => { if (event.key === STORAGE_KEY && root) render(); });

  window.NowhereDice = { roll, button, icon: DIE_ICON, mount: render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
