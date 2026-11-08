"use strict";

// Renderers for the Marketing tab: Discord-flavoured Markdown (as a post will look in Discord), the plan's
// inline Markdown, and reel/video storyboards. Everything is built as DOM nodes from text: no HTML is parsed,
// so nothing in a post can inject markup.

const Render = (() => {
  const EMOJI = {
    compass: "🧭", speech_balloon: "💬", hammer_and_wrench: "🛠️", tools: "🛠️", globe_with_meridians: "🌐", door: "🚪",
    scroll: "📜", busts_in_silhouette: "👥", bust_in_silhouette: "👤", ship: "🚢", anchor: "⚓", crossed_swords: "⚔️",
    map: "🗺️", world_map: "🗺️", sparkles: "✨", star: "⭐", star2: "🌟", fire: "🔥", tada: "🎉", calendar: "📅", date: "📅",
    clock: "🕒", clock8: "🕗", hourglass: "⌛", hourglass_flowing_sand: "⏳", pushpin: "📌", round_pushpin: "📍", mag: "🔍",
    microscope: "🔬", gear: "⚙️", books: "📚", book: "📖", pencil: "📝", pencil2: "✏️", memo: "📝", envelope: "✉️",
    incoming_envelope: "📨", bell: "🔔", loudspeaker: "📢", mega: "📣", warning: "⚠️", white_check_mark: "✅",
    heavy_check_mark: "✔️", x: "❌", question: "❓", exclamation: "❗", eyes: "👀", wave: "👋", point_right: "👉",
    point_down: "👇", arrow_right: "➡️", arrow_down: "⬇️", rocket: "🚀", crystal_ball: "🔮", game_die: "🎲", dragon: "🐉",
    cow: "🐄", ocean: "🌊", cloud: "☁️", zap: "⚡", lock: "🔒", unlock: "🔓", key: "🔑", trophy: "🏆", medal: "🏅",
    coin: "🪙", moneybag: "💰", heart: "❤️", smile: "😄", joy: "😂", sweat_smile: "😅", thinking: "🤔", test_tube: "🧪",
    alembic: "⚗️", telescope: "🔭", satellite: "🛰️", hammer: "🔨", wrench: "🔧", package: "📦", mailbox: "📫",
    clipboard: "📋", bookmark: "🔖", link: "🔗", earth_africa: "🌍", earth_americas: "🌎", mountain: "⛰️", ringed_planet: "🪐",
    milky_way: "🌌", new: "🆕", one: "1️⃣", two: "2️⃣", three: "3️⃣", four: "4️⃣", five: "5️⃣", raised_hands: "🙌",
    handshake: "🤝", muscle: "💪", skull: "💀", ghost: "👻", candle: "🕯️", bulb: "💡", camera: "📷", movie_camera: "🎥",
    clapper: "🎬", film_frames: "🎞️", microphone: "🎤", headphones: "🎧", musical_note: "🎵", newspaper: "📰",
  };
  const DISCORD_LINKS = { customize: "Channels & Roles", browse: "Browse Channels", guide: "Server Guide" };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Inline Markdown → nodes. `discord` adds mentions, channels, :emoji: and <id:…> the way Discord shows them.
  const RULES = [
    ["code", /`([^`\n]+)`/],
    ["bold", /\*\*([\s\S]+?)\*\*/],
    ["under", /__([\s\S]+?)__/],
    ["strike", /~~([\s\S]+?)~~/],
    ["spoiler", /\|\|([\s\S]+?)\|\|/],
    ["italic", /\*(?!\s)([^*\n]+?)\*/],
    ["italic", /(?<![\w])_(?!\s)([^_\n]+?)_(?![\w])/],
    ["mdlink", /\[([^\]\n]+)\]\(([^)\s]+)\)/],
    ["url", /https?:\/\/[^\s<>)]+/],
    ["idlink", /<id:(\w+)>/],
    ["chanid", /<#\d+>/],
    ["mention", /@(?:everyone|here|[A-Za-z][\w-]*)/],
    ["channel", /(?<![\w&])#[a-z][a-z0-9-]*/],
    ["emoji", /:([a-z0-9_+-]+):/],
  ];

  function inline(text, discord = true, onLink) {
    const out = document.createDocumentFragment();
    let rest = text;
    while (rest) {
      let best = null;
      for (const [kind, re] of RULES) {
        if (!discord && ["mention", "channel", "emoji", "idlink", "chanid", "spoiler"].includes(kind)) continue;
        const m = re.exec(rest);
        if (m && (!best || m.index < best.m.index)) best = { kind, m };
      }
      if (!best) {
        out.append(rest);
        break;
      }
      const { kind, m } = best;
      if (m.index) out.append(rest.slice(0, m.index));
      rest = rest.slice(m.index + m[0].length);
      if (kind === "code") out.append(el("code", "", m[1]));
      else if (kind === "bold" || kind === "under" || kind === "strike" || kind === "italic" || kind === "spoiler") {
        const node = el({ bold: "strong", under: "u", strike: "s", italic: "em", spoiler: "span" }[kind], kind === "spoiler" ? "spoiler" : "");
        node.append(inline(m[1], discord, onLink));
        out.append(node);
      } else if (kind === "mdlink" || kind === "url") {
        const a = el("a", "link", kind === "mdlink" ? m[1] : m[0]);
        const href = kind === "mdlink" ? m[2] : m[0];
        a.title = href;
        a.addEventListener("click", (event) => {
          event.preventDefault();
          onLink?.(href);
        });
        out.append(a);
      } else if (kind === "idlink") out.append(el("span", "mention", `# ${DISCORD_LINKS[m[1]] || m[1]}`));
      else if (kind === "chanid") out.append(el("span", "mention", "# channel"));
      else if (kind === "mention") out.append(el("span", "mention", m[0]));
      else if (kind === "channel") out.append(el("span", "mention", m[0]));
      else if (kind === "emoji") out.append(EMOJI[m[1]] ? el("span", "emoji", EMOJI[m[1]]) : `:${m[1]}:`);
    }
    return out;
  }

  // A whole post, block by block, as Discord renders it.
  function discord(text, onLink) {
    const root = el("div", "discord-text");
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let quote = null;
    let list = null;
    let quoteRest = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.startsWith("```")) {
        const code = [];
        for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
        root.append(el("pre", "codeblock", code.join("\n")));
        quote = list = null;
        continue;
      }
      let target = root;
      if (quoteRest || /^>>> /.test(line) || /^> ?/.test(line)) {
        if (/^>>> /.test(line)) {
          quoteRest = true;
          line = line.slice(4);
        } else if (!quoteRest) line = line.replace(/^> ?/, "");
        if (!quote) {
          quote = el("blockquote");
          root.append(quote);
        }
        target = quote;
      } else quote = null;
      const bullet = line.match(/^\s*[-*] (.*)$/);
      if (bullet) {
        if (!list || list.parentNode !== target) {
          list = el("ul");
          target.append(list);
        }
        const li = el("li");
        li.append(inline(bullet[1], true, onLink));
        list.append(li);
        continue;
      }
      list = null;
      const heading = line.match(/^(#{1,3}) (.*)$/);
      const sub = line.match(/^-# (.*)$/);
      let node;
      if (heading) node = el(`h${heading[1].length + 1}`, "dh");
      else if (sub) node = el("div", "subtext");
      else node = el("div", line.trim() ? "line" : "line empty");
      node.append(inline(heading ? heading[2] : sub ? sub[1] : line, true, onLink));
      target.append(node);
    }
    return root;
  }

  // Discord counts characters (newlines too); 2000 per message, 4000 with Nitro.
  function count(text) {
    return [...text.replace(/\r\n/g, "\n").trim()].length;
  }

  // --- reels -----------------------------------------------------------------------------------

  // "# Reel: title", "format: …" lines, "## Section" blocks, and a Shots table: # | Time | Visual | On-screen text | Voice / sound.
  function parseReel(text) {
    const reel = { title: "", meta: {}, sections: [], shots: [] };
    let section = null;
    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
      const title = line.match(/^#\s+(?:Reel|Video):?\s*(.*)$/i) || (!reel.title && line.match(/^#\s+(.*)$/));
      const meta = line.match(/^([a-z][\w ]{1,20}):\s*(.*)$/i);
      const heading = line.match(/^##\s+(.*)$/);
      if (title && !reel.title) reel.title = title[1];
      else if (heading) {
        section = { title: heading[1], lines: [] };
        reel.sections.push(section);
      } else if (section && /^shots?$/i.test(section.title) && /^\|/.test(line)) {
        const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (/^:?-{3,}/.test(cells[0]) || /^#$/.test(cells[0])) continue;
        reel.shots.push({ n: cells[0], time: cells[1] || "", visual: cells[2] || "", text: cells[3] || "", voice: cells[4] || "" });
      } else if (!section && meta) reel.meta[meta[1].toLowerCase()] = meta[2];
      else if (section) section.lines.push(line);
    }
    // "0–3s", "3-10s", "0:25–0:30" → seconds, for the time bar.
    const sec = (t) => {
      const m = t.match(/(\d+):(\d+)/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : Number(t.replace(/[^\d.]/g, "")) || 0;
    };
    for (const shot of reel.shots) {
      const parts = shot.time.split(/[–—-]/).map((p) => p.trim()).filter(Boolean);
      shot.start = parts.length ? sec(parts[0]) : null;
      shot.end = parts.length > 1 ? sec(parts[1]) : null;
    }
    reel.length = Math.max(0, ...reel.shots.map((s) => s.end || 0));
    return reel;
  }

  function reelView(text, media, onLink) {
    const reel = parseReel(text);
    const root = el("div", "reel");
    root.append(el("h2", "reel-title", reel.title || "Untitled reel"));
    const meta = el("div", "reel-meta");
    for (const [k, v] of Object.entries(reel.meta)) if (v) meta.append(el("span", "chip", `${k}: ${v}`));
    if (reel.length) meta.append(el("span", "chip", `${reel.length}s in ${reel.shots.length} shots`));
    root.append(meta);
    if (reel.length) {
      const bar = el("div", "timebar");
      reel.shots.forEach((s, i) => {
        if (s.start == null || s.end == null || s.end <= s.start) return;
        const seg = el("span", `seg seg-${i % 6}`, s.n);
        seg.style.left = `${(s.start / reel.length) * 100}%`;
        seg.style.width = `${((s.end - s.start) / reel.length) * 100}%`;
        seg.title = `${s.time}: ${s.visual || s.text}`;
        bar.append(seg);
      });
      root.append(bar);
    }
    for (const section of reel.sections) {
      if (/^shots?$/i.test(section.title)) {
        root.append(el("h3", "", "Shots"));
        const grid = el("div", "shots");
        reel.shots.forEach((s, i) => {
          const card = el("div", `shot seg-${i % 6}-border`);
          const head = el("div", "shot-head");
          head.append(el("span", "shot-n", s.n), el("span", "shot-time", s.time));
          card.append(head);
          for (const [label, value] of [["Visual", s.visual], ["On screen", s.text], ["Voice / sound", s.voice]]) {
            const row = el("div", "shot-row");
            row.append(el("span", "shot-label", label));
            const v = el("span", value ? "" : "shot-empty");
            v.append(value ? inline(value, false, onLink) : "—");
            row.append(v);
            card.append(row);
          }
          grid.append(card);
        });
        root.append(grid);
      } else {
        const body = section.lines.join("\n").trim();
        if (!body) continue;
        root.append(el("h3", "", section.title));
        root.append(discord(body, onLink));
      }
    }
    if (media?.length) {
      root.append(el("h3", "", "Clips and images in this folder"));
      root.append(gallery(media));
    }
    return root;
  }

  function gallery(media) {
    const grid = el("div", "gallery");
    for (const m of media) {
      const item = el("figure", "media");
      let node;
      if (m.kind === "image") {
        node = el("img");
        node.alt = m.name;
      } else {
        node = el(m.kind === "audio" ? "audio" : "video");
        node.controls = true;
        node.preload = "metadata";
      }
      node.src = m.url;
      item.append(node, el("figcaption", "", m.name));
      grid.append(item);
    }
    return grid;
  }

  return { el, inline, discord, count, parseReel, reelView, gallery };
})();
