"use strict";

// "Claude's memory": Claude Code's notes about this project as a graph (memory.js reads and deletes them).
// Notes are cards, [[links]] between them are lines; links to notes that don't exist yet are dashed cards.

(() => {
  const api = window.terminalApi;
  const $ = (id) => document.getElementById(id);
  const TYPES = {
    user: { label: "About you", color: "#7fb2e5" },
    feedback: { label: "Your feedback", color: "#e8a530" },
    project: { label: "Project", color: "#3ec46d" },
    reference: { label: "Reference", color: "#c58fe0" },
    note: { label: "Note", color: "#9b9184" },
  };
  const CARD = { w: 184, h: 46 };

  const view = $("memory");
  const graph = $("graph");
  const edgesSvg = $("edges");
  const nodesBox = $("nodes");
  const detail = $("memory-detail");

  let data = null;
  let nodes = []; // { id, memory?, ghost, x, y, el }
  let edges = []; // { a, b, el }
  let selected = null;
  const placed = new Map(); // id -> { x, y }: kept across refreshes and drags

  const typeOf = (memory) => TYPES[memory?.type] || TYPES.note;
  const pretty = (name) => name.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notice(result) {
    const box = $("memory-notice");
    box.hidden = !result || (!result.error && !result.done);
    if (box.hidden) return;
    box.className = `memory-notice${result.error ? " bad" : ""}`;
    box.textContent = result.error || result.done;
  }

  // --- data -----------------------------------------------------------------------------------

  async function load() {
    data = await api.memory();
    $("memory-count").textContent = data.memories?.length ? `(${data.memories.length})` : "";
    if (view.hidden) return;
    $("memory-summary").textContent = data.missing
      ? `No memory yet for ${data.folder}`
      : `${data.memories.length} notes about ${data.folder}. Claude Code reads their index (MEMORY.md) at the start of every session. · ${data.dir}`;
    $("memory-summary").title = data.dir;
    build();
    layout();
    draw();
    renderTrash();
    if (selected && !nodes.some((n) => n.id === selected)) selected = null;
    showDetail(selected);
  }

  function build() {
    const names = new Set(data.memories.map((m) => m.name));
    nodes = data.memories.map((m) => ({ id: m.name, memory: m, ghost: false }));
    edges = [];
    const ghosts = new Set();
    for (const m of data.memories) {
      for (const link of m.links) {
        if (link === m.name) continue;
        if (!names.has(link)) ghosts.add(link);
        if (!edges.some((e) => (e.a === link && e.b === m.name) || (e.a === m.name && e.b === link))) edges.push({ a: m.name, b: link, ghost: !names.has(link) });
      }
    }
    for (const id of ghosts) nodes.push({ id, ghost: true });
  }

  // --- layout: a small force simulation, then fitted into the box ---------------------------------

  function layout() {
    const W = graph.clientWidth;
    const H = graph.clientHeight;
    if (!W || !H) return;
    const fresh = nodes.filter((n) => !placed.has(n.id));
    nodes.forEach((n, i) => {
      const p = placed.get(n.id);
      if (p) Object.assign(n, p);
      else {
        const angle = (i / nodes.length) * Math.PI * 2;
        n.x = W / 2 + Math.cos(angle) * W * 0.3;
        n.y = H / 2 + Math.sin(angle) * H * 0.3;
      }
    });
    if (fresh.length) simulate(W, H, fresh.length === nodes.length ? 600 : 250);
    for (const n of nodes) placed.set(n.id, { x: n.x, y: n.y });
  }

  function simulate(W, H, steps) {
    const index = new Map(nodes.map((n) => [n.id, n]));
    const length = Math.max(170, Math.min(W, H) / 3.2);
    for (let step = 0; step < steps; step++) {
      const heat = 1 - step / steps;
      const force = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = (a.y - b.y) * 2.2; // cards are wide: push harder up and down
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const push = 60000 / d2;
          force.get(a.id).x += (dx / d) * push;
          force.get(a.id).y += (dy / d) * push;
          force.get(b.id).x -= (dx / d) * push;
          force.get(b.id).y -= (dy / d) * push;
        }
      }
      for (const e of edges) {
        const a = index.get(e.a);
        const b = index.get(e.b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const pull = (d - length) * 0.04;
        force.get(a.id).x += (dx / d) * pull;
        force.get(a.id).y += (dy / d) * pull;
        force.get(b.id).x -= (dx / d) * pull;
        force.get(b.id).y -= (dy / d) * pull;
      }
      for (const n of nodes) {
        if (placed.has(n.id) && steps < 600) continue; // only new notes move when the rest are placed
        const f = force.get(n.id);
        f.x += (W / 2 - n.x) * 0.012;
        f.y += (H / 2 - n.y) * 0.02;
        const cap = 30 * heat + 1;
        n.x += Math.max(-cap, Math.min(cap, f.x));
        n.y += Math.max(-cap, Math.min(cap, f.y));
      }
    }
    fit(W, H);
  }

  // Scales the positions (not the cards) so everything fits with a margin.
  function fit(W, H) {
    const mx = CARD.w / 2 + 12;
    const my = CARD.h / 2 + 12;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sx = x1 > x0 ? (W - 2 * mx) / (x1 - x0) : 1;
    const sy = y1 > y0 ? (H - 2 * my) / (y1 - y0) : 1;
    for (const n of nodes) {
      n.x = x1 > x0 ? mx + (n.x - x0) * sx : W / 2;
      n.y = y1 > y0 ? my + (n.y - y0) * sy : H / 2;
    }
    separate(W, H);
  }

  // Nudges overlapping cards apart (along whichever way they overlap less), staying inside the box.
  function separate(W, H) {
    const gapX = CARD.w + 14;
    const gapY = CARD.h + 12;
    for (let round = 0; round < 80; round++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const ox = gapX - Math.abs(a.x - b.x);
          const oy = gapY - Math.abs(a.y - b.y);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox / gapX < oy / gapY) {
            const s = (a.x < b.x ? -1 : 1) * (ox / 2 + 0.5);
            a.x += s;
            b.x -= s;
          } else {
            const s = (a.y < b.y ? -1 : 1) * (oy / 2 + 0.5);
            a.y += s;
            b.y -= s;
          }
        }
      }
      for (const n of nodes) {
        n.x = Math.max(CARD.w / 2 + 8, Math.min(W - CARD.w / 2 - 8, n.x));
        n.y = Math.max(CARD.h / 2 + 8, Math.min(H - CARD.h / 2 - 8, n.y));
      }
      if (!moved) break;
    }
  }

  // --- drawing --------------------------------------------------------------------------------

  function draw() {
    nodesBox.replaceChildren();
    edgesSvg.replaceChildren();
    const index = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      e.el = document.createElementNS("http://www.w3.org/2000/svg", "line");
      if (e.ghost) e.el.classList.add("ghost");
      edgesSvg.append(e.el);
    }
    for (const n of nodes) {
      const card = el("div", `node${n.ghost ? " ghost" : ""}`);
      const type = n.ghost ? TYPES.note : typeOf(n.memory);
      card.style.setProperty("--type", type.color);
      card.append(el("span", "name", n.memory?.title || pretty(n.id)), el("span", "kind", n.ghost ? "linked, not written yet" : type.label));
      card.title = n.ghost ? `Other notes link to "${n.id}", but there's no such note yet.` : n.memory.description;
      if (!n.ghost) {
        const x = el("button", "delete", "×");
        x.type = "button";
        x.title = "Delete this memory";
        x.setAttribute("aria-label", `Delete ${n.id}`);
        x.addEventListener("pointerdown", (event) => event.stopPropagation());
        x.addEventListener("click", (event) => {
          event.stopPropagation();
          remove(n.memory);
        });
        card.append(x);
        drag(card, n);
      }
      n.el = card;
      nodesBox.append(card);
    }
    position(index);
    highlight();
  }

  function position(index = new Map(nodes.map((n) => [n.id, n]))) {
    for (const n of nodes) {
      n.el.style.left = `${n.x - CARD.w / 2}px`;
      n.el.style.top = `${n.y - CARD.h / 2}px`;
    }
    for (const e of edges) {
      const a = index.get(e.a);
      const b = index.get(e.b);
      e.el.setAttribute("x1", a.x);
      e.el.setAttribute("y1", a.y);
      e.el.setAttribute("x2", b.x);
      e.el.setAttribute("y2", b.y);
    }
  }

  // Drag to arrange; a click (or Enter) without dragging opens the note.
  function drag(card, n) {
    let moved = false;
    card.tabIndex = 0;
    card.addEventListener("click", () => !moved && select(n.id));
    card.addEventListener("keydown", (event) => event.key === "Enter" && select(n.id));
    card.addEventListener("pointerdown", (event) => {
      card.setPointerCapture(event.pointerId);
      const start = { x: event.clientX, y: event.clientY, nx: n.x, ny: n.y };
      moved = false;
      const move = (e) => {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        n.x = Math.max(CARD.w / 2, Math.min(graph.clientWidth - CARD.w / 2, start.nx + dx));
        n.y = Math.max(CARD.h / 2, Math.min(graph.clientHeight - CARD.h / 2, start.ny + dy));
        placed.set(n.id, { x: n.x, y: n.y });
        position();
      };
      const up = () => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerup", up);
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerup", up);
    });
  }

  function highlight() {
    const near = new Set(selected ? [selected] : []);
    for (const e of edges) {
      const hot = selected && (e.a === selected || e.b === selected);
      e.el.classList.toggle("hot", Boolean(hot));
      if (hot) near.add(e.a).add(e.b);
    }
    graph.classList.toggle("focus", Boolean(selected));
    for (const n of nodes) {
      n.el.classList.toggle("selected", n.id === selected);
      n.el.classList.toggle("near", near.has(n.id));
    }
  }

  // --- the expanded note ------------------------------------------------------------------------

  function select(id) {
    selected = selected === id ? null : id;
    highlight();
    showDetail(selected);
  }

  function showDetail(id) {
    const n = nodes.find((x) => x.id === id);
    detail.replaceChildren();
    if (!n) {
      detail.append(el("p", "placeholder", "Click a note to read it. Drag notes to arrange them; × deletes one (you can restore it below)."));
      return;
    }
    if (n.ghost) {
      detail.append(el("h2", "", pretty(n.id)), el("p", "placeholder", `Linked from other notes as [[${n.id}]], but not written yet: a topic Claude Code meant to note down.`));
      return;
    }
    const m = n.memory;
    const type = typeOf(m);
    const kind = el("span", "kind", type.label);
    kind.style.color = type.color;
    detail.append(kind, el("h2", "", m.title || pretty(m.name)), el("p", "meta", `${m.file} · ${String(m.modified).slice(0, 10)}${m.indexed ? "" : " · not in the index"}`));
    if (m.description) detail.append(el("p", "description", m.description));
    const linked = [...new Set([...m.links, ...data.memories.filter((o) => o.links.includes(m.name)).map((o) => o.name)])].filter((x) => x !== m.name);
    if (linked.length) {
      const box = el("div", "links");
      for (const name of linked) {
        const exists = data.memories.some((o) => o.name === name);
        const b = el("button", exists ? "" : "ghost", pretty(name));
        b.type = "button";
        b.addEventListener("click", () => {
          selected = null;
          select(name);
        });
        box.append(b);
      }
      detail.append(box);
    }
    detail.append(el("p", "body", m.body));
    const del = el("button", "danger", "× Delete this memory");
    del.type = "button";
    del.addEventListener("click", () => remove(m));
    detail.append(del);
  }

  // --- delete and restore -----------------------------------------------------------------------

  async function remove(m) {
    const ok = confirm(
      `Delete the memory "${m.title || pretty(m.name)}"?\n\n` +
        "Claude Code sessions started after this won't know it (a conversation that's already running may still remember it). " +
        "It moves to memory-trash, so you can restore it here.",
    );
    if (!ok) return;
    notice(await api.deleteMemory(m.file));
    if (selected === m.name) selected = null;
    placed.delete(m.name);
    await load();
  }

  function renderTrash() {
    const box = $("memory-trash");
    box.replaceChildren();
    box.hidden = !data.trash?.length;
    if (box.hidden) return;
    box.append(el("span", "", "Recently deleted:"));
    for (const t of data.trash.slice(0, 8)) {
      const b = el("button", "", `↶ ${pretty(t.name)}`);
      b.type = "button";
      b.title = `Restore ${t.file}`;
      b.addEventListener("click", async () => {
        notice(await api.restoreMemory(t.file));
        await load();
      });
      box.append(b);
    }
  }

  // --- open and close ---------------------------------------------------------------------------

  function legend() {
    const box = $("memory-legend");
    box.replaceChildren();
    for (const key of ["user", "feedback", "project", "reference"]) {
      const item = el("span");
      const swatch = el("i");
      swatch.style.background = TYPES[key].color;
      item.append(swatch, TYPES[key].label);
      box.append(item);
    }
  }

  function open() {
    document.activeElement?.blur(); // keys shouldn't reach the terminal behind
    view.hidden = false;
    notice(null);
    load();
  }

  function close() {
    view.hidden = true;
    window.dispatchEvent(new Event("focus")); // the terminal takes the keyboard again
  }

  $("open-memory").addEventListener("click", open);
  // Picking a session in the panel (another terminal, or Claude Code's own) goes back to the terminals.
  window.addEventListener("session-shown", () => {
    if (!view.hidden) view.hidden = true;
  });
  $("memory-close").addEventListener("click", close);
  $("memory-refresh").addEventListener("click", () => {
    notice(null);
    load();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !view.hidden) close();
  });
  let resizing = null;
  new ResizeObserver(() => {
    if (view.hidden || !nodes.length) return;
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      placed.clear(); // lay out afresh for the new size
      layout();
      position();
    }, 150);
  }).observe(graph);

  legend();
  load(); // for the count on the button
})();
