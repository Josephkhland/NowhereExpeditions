/* CM Tools: Resource and Gate generators.
   Everything here produces editable drafts. Word lists are grouped by Domain so a Gate's Resources share an
   environmental logic: the same few Functions recur across its fauna, flora and ground, and their descriptions
   say something about how life survives there. Function interactions are read from the Resource Functions rule. */

const pick = (items) => items[Math.floor(Math.random() * items.length)];
const pickSome = (items, count) => {
  const pool = [...items];
  return Array.from({ length: Math.min(count, pool.length) }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
};
const weighted = (entries) => {
  let roll = Math.random() * entries.reduce((total, [, weight]) => total + weight, 0);
  for (const [value, weight] of entries) if ((roll -= weight) < 0) return value;
  return entries[0][0];
};
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Per Domain: the Functions its environment favours, words for names and descriptions, and Gate-level ideas.
const DOMAIN_PROFILES = {
  verdant: {
    functions: ["Regenerate", "Adapt", "Bind", "Absorb", "Sense", "Catalyze", "Filter", "Flex", "React", "Hide"],
    prefixes: ["Moss", "Thorn", "Bloom", "Rot", "Vine", "Spore", "Mire", "Sap", "Briar", "Lichen"],
    looks: ["damp, fibrous", "pale green and spongy", "veined and translucent", "sticky, amber-coloured", "velvety and dark", "glistening, mottled"],
    creatures: ["canopy stalkers", "mire grazers", "spore moths", "root-crawlers", "lantern beetles"],
    plants: ["strangler vines", "bell-shaped fungal towers", "carnivorous pitchers", "breathing moss mats", "glass-leaf trees"],
    grounds: ["the peat beneath the root mats", "silt pools choked with seeds", "mineral crusts on drowned stones"],
    concepts: ["a forest so dense that daylight arrives green and second-hand", "a drowned jungle where every surface is alive and hungry",
      "a fungal cathedral whose spore clouds move like weather", "a wetland where the plants hunt and the animals hide"],
    aspects: ["Everything Grows Back by Morning", "The Forest Remembers Footsteps", "Spores in Every Breath", "Nothing Dead Stays Still"],
    hazards: ["spore storms", "grasping undergrowth", "parasitic seeds", "sinking mire", "venomous pollen"],
    landmarks: ["a hollow tree the size of a tower", "a lake of floating blossoms", "a ring of petrified giants", "a fungal bridge over a ravine"],
  },
  volcanic: {
    functions: ["Heat", "Store", "Release", "Absorb", "Reinforce", "Conduct", "Glow", "Corrode", "Catalyze"],
    prefixes: ["Ash", "Ember", "Cinder", "Slag", "Char", "Magma", "Soot", "Pyre", "Basalt", "Flare"],
    looks: ["black and glassy", "warm, porous", "red-veined", "ash-grey and brittle", "smoke-dark and dense", "faintly glowing"],
    creatures: ["ash burrowers", "vent crabs", "cinder hounds", "slag eels", "magma-backed tortoises"],
    plants: ["heat-drinking moss", "ash-flowers", "obsidian lichens", "vent tubeworms", "smoulder shrubs"],
    grounds: ["the cooling lava fields", "geothermal vents", "mineral pools around the fumaroles", "fractured basalt cliffs"],
    concepts: ["a chain of basalt islands floating above a lake of slow magma", "a caldera city of ash where the ground breathes smoke",
      "an endless field of vents that pulse like a heartbeat", "a mountain turned inside out, hot at its surface and frozen at its heart"],
    aspects: ["The Ground Is Always Shifting", "Heat Rises in Waves", "Ash Falls Like Snow", "Every Breath Burns"],
    hazards: ["sudden steam vents", "ash falls", "lava tubes collapsing", "toxic fumes", "thermal shock"],
    landmarks: ["a smoking crater lake", "a forest of obsidian spires", "a river of slow-moving magma", "a vent field that pulses in rhythm"],
  },
  abyssal: {
    functions: ["Sense", "Absorb", "Phase", "Store", "Filter", "Dampen", "Resonate", "Glow", "Hide", "Move"],
    prefixes: ["Deep", "Brine", "Pale", "Drown", "Murk", "Tide", "Gloam", "Kelp", "Hollow", "Silt"],
    looks: ["slick and lightless", "pale and gelatinous", "pressure-dense", "faintly bioluminescent", "cold and rubbery", "pearl-smooth"],
    creatures: ["lantern-jawed eels", "pressure crabs", "drift jellies", "blind trench hunters", "shell-backed rays"],
    plants: ["kelp forests that hum", "glowing coral shelves", "trench anemones", "brine-flowers"],
    grounds: ["the trench floor sediment", "black smoker chimneys", "brine pools", "salt-crusted wreckage"],
    concepts: ["an ocean with no surface, only deeper water above and below", "a trench lit only by things that want to be seen",
      "a drowned city where the water itself is heavy", "an endless dark sea where sound carries for miles"],
    aspects: ["The Pressure Never Lets Up", "Light Draws Attention", "Sound Travels Too Far", "There Is Always Something Below"],
    hazards: ["crushing pressure", "lightless depths", "currents that drag", "luring lights", "brine pockets"],
    landmarks: ["a pillar of black smokers", "a shoal of drifting wreckage", "a reef that sings at night", "a pit that swallows light"],
  },
  arid: {
    functions: ["Store", "Absorb", "Reinforce", "Hide", "Record", "Filter", "Stabilize", "Corrode", "Slip", "Glow"],
    prefixes: ["Salt", "Dune", "Dust", "Sun", "Bone", "Glass", "Mirage", "Sand", "Dry", "Rust"],
    looks: ["sun-bleached and brittle", "fine as powder", "crusted with salt", "mirror-bright", "rust-red", "hollow and light"],
    creatures: ["salt striders", "dune burrowers", "glass-backed lizards", "hollow-bone birds", "dust swarms"],
    plants: ["water-hoarding cacti", "salt lichens", "thorn scrub", "sand-rooted bulbs"],
    grounds: ["the salt flats", "wind-carved stone", "fused-glass dunes", "dry mineral seams"],
    concepts: ["a white salt flat under two suns", "a desert of fused glass where the wind sings", "a canyon maze of wind-carved stone",
      "a dust sea whose dunes move overnight"],
    aspects: ["Water Is Worth More Than Gold", "The Mirage Lies", "The Wind Erases Everything", "Shade Is a Luxury"],
    hazards: ["dehydration", "sandstorms", "glare blindness", "sinkholes", "heat haze"],
    landmarks: ["a field of standing glass", "a dry riverbed of bones", "a salt arch", "an oasis that is never in the same place"],
  },
  frozen: {
    functions: ["Absorb", "Stabilize", "Record", "Invert", "Store", "Anchor", "Dampen", "Heat", "Slip", "Loop"],
    prefixes: ["Rime", "Frost", "Hoar", "Glacier", "Pale", "Shiver", "Snow", "Ice", "Still", "Winter"],
    looks: ["frost-white", "glass-clear and cold", "blue and dense", "brittle as thin ice", "furred with rime", "still and silent"],
    creatures: ["ice-shelled crawlers", "snow-white hunters", "frost moths", "glacier worms", "sleeping giants in the ice"],
    plants: ["frost-flowers", "ice-lichen", "crystal pines", "rime-moss"],
    grounds: ["the glacier's blue heart", "frozen lakes", "permafrost seams", "ice caves"],
    concepts: ["a glacier that preserves everything that ever fell into it", "a frozen sea crossed by ancient bridges",
      "a white silence where breath freezes in the air", "an ice cave network older than any map"],
    aspects: ["Nothing Here Decays", "The Cold Takes Its Time", "The Ice Remembers", "Silence Is Absolute"],
    hazards: ["frostbite", "thin ice", "whiteouts", "falling icicles", "hypothermia"],
    landmarks: ["a frozen waterfall", "an ice-locked ship", "a field of frozen statues", "a blue cavern that hums"],
  },
  constructed: {
    functions: ["Conduct", "Store", "Record", "React", "Move", "Anchor", "Stabilize", "Transmute", "Sense", "Loop"],
    prefixes: ["Gear", "Lattice", "Cog", "Wire", "Forge", "Static", "Circuit", "Rivet", "Echo", "Index"],
    looks: ["precisely machined", "segmented and metallic", "lattice-patterned", "faintly humming", "oil-dark", "seamless and smooth"],
    creatures: ["wandering maintenance drones", "spider-legged repairers", "patrolling sentries", "scavenger units"],
    plants: ["stationary machine colonies", "cable forests", "crystal processors", "self-assembling scaffolds"],
    grounds: ["the structural substrate", "slag heaps from old foundries", "alloy seams in the walls", "coolant channels"],
    concepts: ["a city-sized machine still running a purpose no one knows", "an endless archive of shelves and moving corridors",
      "a megastructure built around a sealed core", "a factory world whose builders vanished mid-shift"],
    aspects: ["The Machines Are Still Working", "Every Door Has a Rule", "Something Is Keeping Count", "Built for Someone Else"],
    hazards: ["defence systems", "moving walls", "energy discharges", "collapsing scaffolds", "corrosive coolant"],
    landmarks: ["a central spire that hums", "a hall of silent automatons", "a rotating bridge", "a vast frozen assembly line"],
  },
};

// A Domain added in the content manager has no word lists of its own yet: it gets neutral ones, and its
// description becomes the Gate concept.
const GENERIC_PROFILE = {
  functions: ["Absorb", "Store", "Release", "Sense", "Adapt", "Stabilize", "Reinforce", "Resonate", "Phase"],
  prefixes: ["Strange", "Pale", "Hollow", "Shard", "Echo", "Drift", "Veil", "Mire", "Glim", "Rift"],
  looks: ["oddly textured", "faintly luminous", "cold and smooth", "irregular and veined", "dense and heavy", "light and brittle"],
  creatures: ["native grazers", "lurking hunters", "drifting swarms", "burrowing things"],
  plants: ["unfamiliar growths", "creeping mats", "tall stalks", "clustered pods"],
  grounds: ["the exposed bedrock", "loose sediment", "strange mineral seams"],
  concepts: ["a place unlike any surveyed before"],
  aspects: ["Nothing Here Behaves as Expected", "The Rules Are Different Here"],
  hazards: ["unknown phenomena", "unstable ground", "hostile wildlife"],
  landmarks: ["a structure of unknown origin", "a natural formation of great size", "a clearing that is always silent"],
};
const profileFor = (domain) => {
  if (DOMAIN_PROFILES[domain]) return DOMAIN_PROFILES[domain];
  const info = (state.vocabulary.domainList || []).find((item) => item.key === domain);
  return { ...GENERIC_PROFILE, concepts: info?.description ? [info.description.replace(/\.$/, "").toLowerCase()] : GENERIC_PROFILE.concepts };
};

// Source types and the parts they yield; Constructed Gates read them as machines.
const SOURCE_PARTS = {
  fauna: ["shell", "bone", "venom", "blood", "gland", "membrane", "fibre", "secretion", "scale"],
  flora: ["sap", "fibre", "bark", "spores", "resin", "fruiting body", "root", "fungal growth", "moss"],
  ground: ["ore", "crystal", "stone", "sediment", "fluid", "dust", "deposit", "salt", "glass"],
};
const CONSTRUCTED_PARTS = {
  fauna: ["plating", "servo", "coolant", "actuator", "sensor housing"],
  flora: ["filament", "lattice", "node", "cell", "cable"],
  ground: ["alloy", "slag", "substrate", "wiring", "residue"],
};
const NAME_TAILS = ["veil", "back", "glass", "vein", "heart", "bloom", "fang", "coil", "drift", "spine", "shard", "weave", "crown", "skin"];

// What each Function looks like when you meet it in the field. Pairs listed in PAIR_BEHAVIOR read as one phenomenon.
const FUNCTION_BEHAVIOR = {
  Absorb: ["draws in warmth, light or sound from around it", "leaves the air around it noticeably thinner and stiller"],
  Amplify: ["makes any sound or tremor near it grow louder", "intensifies whatever passes through it"],
  Conduct: ["carries a tingle of current from one end to the other", "passes heat through itself almost instantly"],
  Dampen: ["muffles sound and vibration around it", "softens any blow that strikes it"],
  Heat: ["is always warm to the touch", "slowly warms whatever rests against it"],
  Glow: ["gives off a soft light of its own", "shines brighter the more it is handled"],
  Release: ["discharges in a sudden burst when struck", "vents what it holds when cracked open"],
  Store: ["holds a charge for days after being exposed", "keeps what it absorbs locked inside"],
  Bind: ["fuses with whatever it touches", "knits separate pieces into one"],
  Corrode: ["eats slowly into metal and stone", "leaves pitted marks on anything it rests on"],
  Flex: ["bends almost double and springs back", "stretches far without tearing"],
  Regenerate: ["closes its own cracks overnight", "regrows when cut"],
  Reinforce: ["is far harder than its weight suggests", "turns brittle materials tough when bonded to them"],
  Stabilize: ["calms reactions happening around it", "keeps nearby materials from changing"],
  Transmute: ["slowly turns what it touches into something else", "changes the substance of materials around it"],
  Anchor: ["refuses to be moved once it settles", "stays fixed in place even in strong currents"],
  Move: ["shifts on its own when disturbed", "pushes away anything that touches it"],
  Phase: ["seems to sink partly into solid surfaces", "flickers as if not entirely here"],
  Slip: ["cannot be held for long, sliding out of any grip", "lets nothing stick to it"],
  Adapt: ["changes texture to match its surroundings", "reshapes itself to whatever holds it"],
  React: ["responds sharply to one particular trigger", "snaps shut or flares at a specific touch"],
  Hide: ["is hard to spot even when you know where it is", "slips out of notice the moment you look away"],
  Record: ["keeps impressions of what happens near it", "plays back faint echoes of past sounds"],
  Resonate: ["hums in answer to certain sounds", "vibrates in sympathy with others of its kind"],
  Sense: ["turns towards movement nearby", "changes colour when something living approaches"],
  Catalyze: ["speeds up any reaction it is dropped into", "makes nearby materials react faster"],
  Filter: ["lets water through but holds back everything else", "passes some things freely and stops others"],
  Nullify: ["seems to quieten strange phenomena near it", "makes Gate effects around it falter"],
  Invert: ["turns cold when heated and warm in the cold", "pushes away what should fall towards it"],
  Loop: ["repeats the same slow motion over and over", "returns to the same state every few hours, whatever is done to it"],
};
const PAIR_BEHAVIOR = {
  "Absorb+Heat": "stays warm itself while the air immediately around it turns unnaturally cold",
  "Heat+Release": "flares with a burst of heat when struck",
  "Heat+Store": "soaks up heat during the day and gives it off all night",
  "Move+Release": "jets away when disturbed, pushing against the air",
  "Absorb+Move": "stops anything thrown at it dead, as if catching it",
  "Release+Store": "holds a charge for days, then discharges it all at once",
  "Conduct+Dampen": "carries current along one face while the other stays completely inert",
  "Glow+Store": "drinks in light all day and shines faintly all night",
  "Hide+Phase": "fades from sight and touch together when disturbed",
  "Loop+Record": "replays the same scene in faint echoes, over and over",
  "Anchor+Phase": "seems pinned in place even as its outline blurs",
  "Resonate+Sense": "hums whenever another sample of it is nearby",
  "Record+Sense": "changes colour to show where something passed hours ago",
  "Bind+Regenerate": "heals cracks in anything it is bonded to",
  "Corrode+Release": "spits a corrosive spray when pressed",
};
const SPECIAL_PROPERTIES = [
  "slowly turns to face the nearest Gate", "grows in perfect spirals", "is heavier at night", "tastes of iron to anyone who touches it",
  "falls silent whenever someone lies near it", "repeats the vibration patterns of nearby machinery", "bends towards exposed blood",
  "cannot be drawn accurately; sketches of it always come out wrong", "smells of rain when it is about to react",
  "grows only where someone has died", "shows faint writing under starlight", "attracts small insects from miles away",
];
const HARVESTING_ISSUES = {
  fauna: ["the creatures are dangerous when cornered", "it spoils within hours of the creature's death", "only shed during a short season"],
  flora: ["it wilts and loses its properties once uprooted", "the plants defend themselves with spores", "harvesting kills the whole colony"],
  ground: ["the deposits lie in unstable ground", "it cracks if cut with metal tools", "the seams are deep and hard to reach"],
};

/* ---------- Function interactions, read from the Resource Functions rule ---------- */

// Interactions are managed in the content manager (Vocabulary → Interactions): { a, b, kind, keyword, note }.
// relations["Heat|Store"] lists the kinds that pair has.
function functionRelations() {
  const relations = {};
  for (const entry of state.vocabulary.interactions || []) {
    const key = [entry.a, entry.b].sort().join("|");
    (relations[key] ||= []).push(entry.kind);
  }
  return relations;
}
// The most telling kind for a pair: instability outweighs opposition, which outweighs synergy.
function pairKind(relations, left, right) {
  const kinds = relations[[left, right].sort().join("|")] || [];
  if (kinds.includes("instability")) return "unstable";
  if (kinds.includes("opposition")) return "opposed";
  if (kinds.includes("synergy")) return "synergy";
  return "neutral";
}

// Every pair of Functions the rule table relates, by kind.
function relatedPairs(relations, kind) {
  const all = Object.values(state.vocabulary.functionGroups).flat();
  const pairs = [];
  all.forEach((left, index) => all.slice(index + 1).forEach((right) => {
    if (pairKind(relations, left, right) === kind) pairs.push([left, right]);
  }));
  return pairs;
}

// Picks `count` Functions, preferring the Domain's (or Gate's) own. For a synergistic, opposed or unstable Resource
// it starts from a pair of that kind (one in the preferred list when possible), then adds Functions that do not
// introduce danger unless the mode asks for it.
function pickFunctions(count, mode, preferred, relations) {
  const all = Object.values(state.vocabulary.functionGroups).flat();
  const chosen = [];
  const seedKind = { synergy: "synergy", opposed: "opposed", unstable: "unstable" }[mode];
  if (seedKind && count >= 2) {
    const pairs = relatedPairs(relations, seedKind);
    const local = pairs.filter(([left, right]) => preferred.includes(left) || preferred.includes(right));
    const pair = (local.length ? pick(local) : pairs.length ? pick(pairs) : null);
    if (pair) chosen.push(...pair);
  }
  for (let attempt = 0; chosen.length < count && attempt < 400; attempt += 1) {
    const candidate = pick(preferred.length && Math.random() < 0.7 ? preferred : all);
    if (chosen.includes(candidate)) continue;
    const kinds = chosen.map((other) => pairKind(relations, other, candidate));
    const fits = mode === "synergy" ? kinds.every((kind) => kind === "synergy" || kind === "neutral")
      : mode === "unstable" ? true
      : !kinds.includes("unstable");
    if (fits || attempt > 300) chosen.push(candidate);
  }
  return chosen;
}

/* ---------- Resource generator ---------- */

// The vocabulary is managed in the content manager: Words added there have no hand-written field behavior yet,
// so they are described from their definition, and Domain favourites that were renamed or removed are skipped.
const currentFunctions = () => Object.values(state.vocabulary.functionGroups).flat();
const definitionOf = (name) => (state.vocabulary.functions || []).flatMap((group) => group.functions).find((fn) => fn.name === name)?.definition || "";
const behaviorOf = (name) => {
  if (FUNCTION_BEHAVIOR[name]) return pick(FUNCTION_BEHAVIOR[name]);
  const definition = definitionOf(name).replace(/\.$/, "");
  return definition ? `can ${definition.charAt(0).toLowerCase()}${definition.slice(1)}` : `shows an unusual ${name.toLowerCase()} property`;
};
const inVocabulary = (names) => names.filter((name) => currentFunctions().includes(name));

function describeFunctions(functions) {
  const sorted = [...functions].sort();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const pair = PAIR_BEHAVIOR[`${sorted[i]}+${sorted[j]}`];
      if (pair) return [pair, ...functions.filter((name) => name !== sorted[i] && name !== sorted[j]).map(behaviorOf)];
    }
  }
  return functions.map(behaviorOf);
}
const joinPhrases = (phrases) => phrases.length < 2 ? phrases[0] || "" : `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;

/* options: { domain, source, count ("random" | n), mode, hidden, special, harvesting, gateFunctions } */
function generateResource(options = {}) {
  const domains = state.vocabulary.environmentDomains || state.vocabulary.domains;
  const domain = options.domain && domains.includes(options.domain) ? options.domain : pick(domains);
  const profile = profileFor(domain);
  const source = ["fauna", "flora", "ground"].includes(options.source) ? options.source : pick(["fauna", "flora", "ground"]);
  const count = options.count && options.count !== "random" ? Number(options.count) : weighted([[1, 30], [2, 50], [3, 20]]);
  const relations = functionRelations();
  const preferred = inVocabulary(options.gateFunctions?.length ? [...options.gateFunctions, ...profile.functions] : profile.functions);
  const functions = pickFunctions(count, options.mode || "mixed", preferred, relations);
  const all = Object.values(state.vocabulary.functionGroups).flat();
  const hidden = options.hidden ? pickSome(preferred.filter((name) => !functions.includes(name)).concat(all.filter((name) => !functions.includes(name))), 1) : [];

  const parts = domain === "constructed" ? CONSTRUCTED_PARTS[source] : SOURCE_PARTS[source];
  const part = pick(parts);
  const origin = { fauna: pick(profile.creatures), flora: pick(profile.plants), ground: pick(profile.grounds) }[source];
  const name = `${pick(profile.prefixes)}${pick(NAME_TAILS)} ${cap(part)}`;
  const behavior = describeFunctions(functions);
  const look = pick(profile.looks);
  const description = source === "ground"
    ? `${cap(look)} ${part} found in ${origin}. It ${joinPhrases(behavior)}.`
    : `${cap(look)} ${part} taken from the ${origin}. It ${joinPhrases(behavior)}.`;

  return {
    name, sourceType: domain === "constructed" ? "constructed" : source, description,
    domains: [domain], functions, hiddenFunctions: hidden,
    specialProperty: options.special ? `It ${pick(SPECIAL_PROPERTIES)}.` : "",
    availability: weighted([["sample", 55], ["limited", 35], ["available", 10]]),
    supply: "",
    harvestingIssue: options.harvesting ? cap(`${pick(HARVESTING_ISSUES[source])}.`) : "",
    // Kept for the Gate generator: which ecological pass produced it, its look, and what creature or plant it came from.
    origin, ecology: source, look: `${look} ${part}`,
  };
}

/* ---------- Gate generator ---------- */

const FUNCTION_INFERENCES = {
  Heat: ["Life here keeps warm by its own means.", "thermal tools and warming gear"],
  Store: ["Things here hoard what they need for hard times.", "batteries, reservoirs and accumulators"],
  Release: ["Sudden discharges are part of daily life here.", "propellants, charges and emergency systems"],
  Absorb: ["Organisms here survive by drawing in what they need from their surroundings.", "filters, collectors and heat sinks"],
  Reinforce: ["Shells, bark and stone here are unusually tough.", "armour, plating and pressure vessels"],
  Regenerate: ["Damage here heals quickly.", "medicine and self-repairing equipment"],
  Adapt: ["Living things here change to suit their surroundings.", "adaptive armour and environmental gear"],
  Sense: ["Everything here is watching for something.", "detectors and survey instruments"],
  Record: ["The place keeps traces of what happened in it.", "recording devices and research equipment"],
  Move: ["Little here stays still for long.", "engines, lifting gear and propulsion"],
  Phase: ["Boundaries here are not entirely solid.", "Gate technology and barrier penetration"],
  Conduct: ["Energy flows easily through this place.", "wiring, circuits and power systems"],
  Glow: ["The place makes its own light.", "lamps, beacons and signalling"],
  Hide: ["Everything here survives by not being seen.", "camouflage, stealth gear and concealment"],
  Slip: ["Nothing here can be held for long.", "lubricants, escape gear and low-friction surfaces"],
  Stabilize: ["Things here resist change.", "containment and precision equipment"],
  Filter: ["Survival here depends on keeping the wrong things out.", "masks, purification and separation"],
  Corrode: ["The environment slowly eats away at everything.", "etching, demolition and waste processing"],
  React: ["Things here respond instantly to the right trigger.", "fuses, triggers and alarms"],
  Amplify: ["Small disturbances here grow into big ones.", "transmitters, boosters and focusing devices"],
  Dampen: ["The place swallows force and sound.", "shock absorbers, silencers and shielding"],
  Bind: ["Things here grow into and around each other.", "composites, adhesives and repairs"],
  Flex: ["Survival here means bending rather than breaking.", "flexible armour, springs and climbing gear"],
  Transmute: ["Matter here does not stay what it was.", "refining, recycling and fabrication"],
  Catalyze: ["Reactions here happen fast and spread.", "synthesis, refining and medicine"],
  Nullify: ["Strange effects falter in parts of this place.", "anti-magic and anomaly suppression"],
  Invert: ["The usual rules run backwards here.", "reversers, refrigeration and counter-force devices"],
  Loop: ["The place repeats itself.", "clocks, cycling engines and perpetual mechanisms"],
  Anchor: ["Things here hold fast against every force.", "anchors, foundations and restraints"],
  Resonate: ["The place answers sound with sound.", "communications, scanners and tuned devices"],
};

/* options: { designation, domain, secondDomain, fauna, flora, ground } (counts may be "random") */
function generateGate(options = {}) {
  const domains = state.vocabulary.environmentDomains || state.vocabulary.domains;
  const domain = options.domain && domains.includes(options.domain) ? options.domain : pick(domains);
  const second = options.secondDomain && options.secondDomain !== domain && domains.includes(options.secondDomain) ? options.secondDomain : "";
  const profile = profileFor(domain);
  // A Gate's signature: three or four Functions that recur across its Resources.
  const signature = pickSome(inVocabulary(second ? [...profile.functions, ...profileFor(second).functions] : profile.functions), 3 + Math.round(Math.random()));
  const howMany = (value) => value && value !== "random" ? Number(value) : 1 + Math.floor(Math.random() * 3);
  const resources = [];
  for (const source of ["fauna", "flora", "ground"]) {
    for (let index = 0; index < howMany(options[source]); index += 1) {
      const resourceDomain = second && Math.random() < 0.35 ? second : domain;
      resources.push(generateResource({
        domain: resourceDomain, source, mode: weighted([["synergy", 40], ["mixed", 45], ["opposed", 8], ["unstable", 7]]),
        hidden: Math.random() < 0.4, special: Math.random() < 0.35, harvesting: Math.random() < 0.5, gateFunctions: signature,
      }));
    }
  }
  resources.forEach((resource) => { resource.domains = []; }); // native Resources inherit the Gate's Domain

  const counts = {};
  resources.forEach((resource) => resource.functions.forEach((name) => { counts[name] = (counts[name] || 0) + 1; }));
  const dominant = Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([name]) => name);
  const relations = functionRelations();
  const risky = [];
  resources.forEach((resource) => resource.functions.forEach((left, index) => resource.functions.slice(index + 1).forEach((right) => {
    if (pairKind(relations, left, right) === "unstable") risky.push(`${resource.name} (${left} + ${right})`);
  })));

  const creatures = [...new Set(resources.filter((resource) => resource.ecology === "fauna").map((resource) => cap(resource.origin)))];
  const inferred = {
    visualIdentity: `${cap(joinPhrases(pickSome(resources.map((resource) => resource.look), 3)))}.`,
    ecology: dominant.map((name) => FUNCTION_INFERENCES[name]?.[0]).filter(Boolean).join(" "),
    likelyHazards: risky.length ? `Unstable materials: ${risky.join("; ")}.` : "No unstable Resources among the known ones.",
    extraction: resources.filter((resource) => resource.availability !== "sample").map((resource) => `${resource.name} (${resource.availability})`).join(", ") || "Only samples so far.",
    researchHooks: resources.filter((resource) => resource.hiddenFunctions.length)
      .map((resource) => `${resource.name} hides ${resource.hiddenFunctions.join(", ")}`).join("; ") || "No Hidden Functions yet.",
    technology: dominant.map((name) => FUNCTION_INFERENCES[name]?.[1]).filter(Boolean).join("; "),
  };
  return {
    designation: options.designation || "",
    domains: second ? [domain, second] : [domain],
    concept: cap(pick(profile.concepts)) + ".",
    aspect: pick(profile.aspects),
    hazards: pickSome(profile.hazards, 2 + Math.round(Math.random())),
    landmarks: pickSome(profile.landmarks, 2 + Math.round(Math.random())),
    creatures, signature, resources, inferred,
  };
}
