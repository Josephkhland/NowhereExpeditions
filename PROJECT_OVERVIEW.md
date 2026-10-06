# Nowhere Expeditions: Project Overview

A single-file summary of the whole project for people, tools and AI agents that need to catch up quickly: what the campaign is, how the repository is built, which tools exist, how the rules work, and what lore has been established so far.

- **Snapshot:** 6 October 2026 (pre-launch; Factions added the same day). The first session is planned for **6 November 2026**.
- **Player-facing only.** This file holds only what players can already see on the public site. It deliberately leaves out GM-only material: GM notes, Hidden Functions, harvesting issues, unpublished drafts and anything about the true nature of the Gates, Cores or ruins. The repository is public, so keep it that way.
- **Sources of truth:** the content manager's database (`content-manager/content.db`, not in Git) for content, `instructions.md` for design principles, and the code itself. When this file disagrees with them, they win. Regenerate this file rather than editing facts by hand.

---

## 1. The project in brief

**Nowhere Expeditions** is a [Fate Core](https://fate-srd.com/) tabletop campaign run in a **West Marches** style, played on Discord. There is no fixed party: for each expedition, the players who sign up for a job form that session's crew. They travel through **Gates** into impossible places and bring back knowledge, materials and artifacts that permanently change a shared, persistent world centred on the settlement of **Endros**.

The project has two parts:

| Part | What it is | Who uses it |
| --- | --- | --- |
| **Public site** (`public-site/`) | The campaign website: rules, the Outpost's current state, Job Board, Archive (lore), Discoveries, Marketplace, characters. It is part handbook, part in-world expedition database. | Players |
| **Content manager** (`content-manager/`) | A local app where the GM writes and publishes everything the site shows. | The GM, on a desktop |

- **Live site:** <https://josephkhland.github.io/NowhereExpeditions/>
- **Repository:** `git@github.com:Josephkhland/NowhereExpeditions.git` (main branch: `main`)
- **Community:** a campaign of *Game of Adventuring*, supported by *Cozy House Games*. Discord: <https://discord.gg/TxcudTj>
- **License:** MIT for code and content, with Fate Core attribution (CC BY 3.0, Evil Hat Productions).

### Campaign principles (from `instructions.md`)

- **Exploration over plot.** The world presents places, situations, mysteries and opportunities, never a predetermined sequence of events.
- **Player-driven expeditions.** Players choose which Gates, problems and Projects matter.
- **Persistent world.** What one crew discovers, damages or leaves unfinished stays that way for the next.
- **Knowledge is progression.** Information found in play is itself a reward, so the site never exposes what Expeditioners haven't discovered. Unknowns are shown as *NO DATA* or *NOT YET SURVEYED*.
- **The settlement is a shared character.** It has Aspects, Capabilities, Stress and Consequences.
- **Different crews, shared world.** A returning player must be able to catch up without reading every session log.

The site should feel like **industrial expedition infrastructure + scientific documentation + impossible phenomena**: survey reports, engineering documents, research terminals. It should not feel like a medieval fantasy wiki, a cyberpunk terminal, a SaaS dashboard or a game inventory. Player-facing writing is concise and functional: clarity first, in-world flavour second.

### Status and roadmap

| Date | Milestone | Status |
| --- | --- | --- |
| 29 Sep 2026 | Interest check for a Fate West Marches campaign | Done |
| 4 Oct 2026 | Site created (Outpost, Job Board, Archive, Marketplace, Characters) | Done |
| ~11 Oct 2026 | Game listing and rules authored | In progress |
| ~18 Oct 2026 | Real Outpost, Archive, gear and first jobs replace the sample content | To do |
| ~25 Oct 2026 | Players recruited | To do |
| ~1 Nov 2026 | Characters built, sent in and imported | To do |
| 6 Nov 2026, 20:00 Athens time (UTC+2) | Opening event and first session on Discord | To do |

The Overview page shows this roadmap with a live countdown, shown in each visitor's local time.

---

## 2. Repository layout

```
.
├── public-site/          The published website (deployed as-is to GitHub Pages)
├── content-manager/      The GM's local editing tool (Python + SQLite)
├── artwork/              Reference art: homeland clothing, environments, flags, logos (not published)
├── site-export/          Generated full copy from "Export to site" (ignored by Git)
├── .github/              Deploy workflow and release versioning
├── instructions.md       Design and content principles for the site (the house style)
├── README.md             Getting started
├── RUNNING.md            Running both parts locally
├── DEPLOYING.md          Git, GitHub Pages and publishing
└── PROJECT_OVERVIEW.md   This file
```

Some older files still use earlier names: the settlement was once **the Island**, Jobs were **Expeditions**, and the Archive held separate **Gates** and **Reports** pages. `instructions.md` still uses the Island wording. The current terms are **Outpost/Endros**, **Job Board** and **Archive**.

---

## 3. The public site

Plain HTML, CSS and vanilla JavaScript: no framework and no build step. Every page loads its content from JSON files in `public-site/data/`, which the content manager generates. Never edit those files by hand.

| Page | What it shows |
| --- | --- |
| `index.html`, the **Overview** | Hero carousel, the newest **pinned announcement** featured as a card, a three-step *Start here* (read Onboarding, create a character, find a job), the launch roadmap and countdown (in the visitor's local time), and section tiles. |
| `factions.html`, **Factions** | The countries and powers of the wider world. A card grid you can scan in under a minute (flag, homeland image, short descriptor, core values, Sponsor Extra), then a detail view per faction (`factions.html#<id>`): hero, At a glance, Sponsorship, Beliefs & folklore, History, Visual identity (artwork), Relations, and the Archive entries that name the faction. On phones the essentials and sponsorship come first. |
| `outpost.html`, the **Outpost Sheet** | The settlement as a Fate character: High Concept, Trouble, Aspects, six Capabilities with ratings and dice rolls, Stress, Consequences, the Facilities table (filterable by Capability) and ongoing Outpost Projects with Complications. |
| `jobs.html`, the **Job Board** | Open listings (objective, briefing, schedule, crew size, who posted it), filterable by type, plus closed jobs linked to their Session Records. |
| `archive.html`, the **Archive** | All lore as a wiki: Gate Records, Session Records, Newspapers and Lore. Lore entries carry **topics** (History, Folklore, Religion, Politics…), and an entry can have several. Search, category filters, a **topic filter** (`archive.html?topic=<name>`), a **faction filter** (`archive.html?faction=<id>`), cross-links, "Referenced In" backlinks, links to the factions an entry is about, and an **Explore connections** graph view. |
| `discoveries.html`, **Discoveries** | Four tabs: **Resources** (searchable catalogue), **Functions** (look up a Word, combine two, random Resource, a 30×30 interaction grid), **Domains**, and **Spell Forms**. |
| `marketplace.html`, the **Marketplace** | Featured Gear carousel and the full price list (grid or list view), with prices in Coins, weights and availability. |
| `characters.html`, **Characters** | Player characters and NPCs, profiles, Fate sheets (with clickable skill rolls), Personal Stash, Projects, and "Create new character". |
| `game.html`, **Rules & News** | Announcements and the rules reader. Rules are grouped into **learning paths**, starting with Onboarding, and each rule links to the next. |
| `sheet.html`, the **character sheet** | An editable Fate sheet that runs in the browser. Players fill it in or update it, press **Save file** (JSON) and send the file to the GM, who imports it. It includes a Marketplace tab for buying Gear and carry-limit tracking. |
| `rules.html`, `island.html`, `gates.html`, `expeditions.html` | Redirect stubs from old addresses. |

**Site-wide features:**
- **Search:** Ctrl+K, `/` or the Search button searches rules, Gates, Resources, characters and pages.
- **Header and footer:** a sticky header whose **Encyclopedia** dropdown groups Factions, Archive and Discoveries (click to open; on screens 1,100px wide or less the header folds into a Menu button and the three appear under an Encyclopedia heading), and a footer site map.
- **Dice:** a Fate dice roller with roll history (`dice.js`, kept in the browser only).
- **Markdown and links:** authored text supports Markdown (via `vendor/markdown-it`) and wiki links like `[[archive-id]]`.
- **Deep links:** every record has a stable URL, such as `jobs.html#<id>`, `archive.html#<id>`, `characters.html#<id>#sheet`, `discoveries.html#function-Heat` or `game.html#post-<id>`.

**Mobile:** the public site is meant to work well on phones (checked 6 Oct 2026 at 390px wide):
- the header is one row;
- list-and-detail pages (Archive, Rules, Jobs, Characters) show either the list or the open item, with a back link;
- tap targets are enlarged on touch screens;
- nothing scrolls sideways (the interaction grid scrolls inside its own box).

The content manager is desktop-only.

**Special markers** in rules text expand into live content: `{{reading-path}}`, `{{function-vocabulary}}`, `{{function-picker}}`, `{{domain-list}}`, `{{resource-catalogue}}` and `{{form-list}}`.

---

## 4. The content manager

A local web app: `python content-manager/app.py`, then open <http://127.0.0.1:8001>.
- **Tech:** Python standard library only, with SQLite storage (`content.db`, gitignored, schema v10). Its tests live in `content-manager/tests/` (run with `python -m unittest discover -s tests`).
- **Code:** `app.py` (server, storage, validation, export) and `static/` (`manager.js`, `generators.js`, `manager.css`).

### Collections (record types)

| Collection | Represents | Notes |
| --- | --- | --- |
| **Factions** | Countries, powers and sponsors | Name, aliases, descriptor, identity, government, values, Gate attitude, beliefs and history summaries, visual notes, relations to other factions, the Recruitment Faction rule it links to plus a compact Extra, and images (flag, homeland, gallery, clothing). Archive entries name their factions (`factionIds`, many-to-many), and the faction page lists them automatically. Schema v9. |
| **Characters** | PCs and NPCs | Optional Fate sheet, Personal Stash (Gear × quantity, "brought into action"), Coins, Downtime, Projects. |
| **Jobs** | Job Board listings | Type, schedule, crew and participants, optional link to a Session Record. |
| **Archive** | Lore entries | Structural types: gate-record, session-record, newspaper, lore. What a lore entry is about is its **topics** (suggested: History, Folklore, Religion, Politics, Technology, Culture, Notable People, Institutions, Events, Diplomacy; others can be added). Schema v10 turned the old History and Folklore types into lore entries with that topic. Gate Records add a designation, status, Domains, environment, traits, hazards, locations and creatures. Any entry can name the factions it is about. Free-text search tags are separate from topics. |
| **Gear** | Marketplace items | Category, price, sale price, weight, availability, featured flag. |
| **Facilities** | What Endros has | Assigned to Capabilities, optionally built by a Project. |
| **Projects** | Progress tracks | Personal, Public, Research, Marketplace, Facility, Recovery, Establish Supply or Spell Innovation. Each has Progress, Requirements (required Functions, Resources, Domain), Complications and a result. |
| **Resources** | Materials found beyond Gates | Domain, Functions, Special Property, availability, source Gate. Hidden Functions and harvesting issues are GM-only. |
| **Forms** | Spell Forms | A tier (basic/first/second/third) that fixes how many Words it uses. |
| **Game posts** | Announcements and rules | Rules are grouped into learning paths, and announcements can be pinned. |
| **Outpost Sheet** | The settlement's "character" | A single record. |
| **Site settings** | Launch countdown and roadmap, Discord, credits | Shown on the Overview and in every footer. |
| **Vocabulary** | Functions, interactions and Domains | Renaming a Function carries the change through every record. Removing one that is still in use is refused. |
| **Learning paths** | Reading order for rules | "Onboarding" is always first. |

### Publishing model

- Each record has **Published** and **Sample** flags. **Sync data** writes only published records to `public-site/data/`. A global switch decides whether sample (placeholder) records are included. It is currently **off**, so the live site shows only real content.
- GM-only fields (GM notes on Resources and Gates, Hidden Functions, harvesting issues) are stripped on export. Wiki links to unpublished entries are scrubbed.
- **Workflow:** edit, then Publish, then Sync data. Commit `public-site/` and push. A GitHub Action deploys the site.

### Manager features

- **Navigation and editing:** a dashboard home, grouped sidebar, Ctrl+K jump and back navigation, plus an unsaved-changes guard and bulk publish.
- **Status:** sync status and a live site preview.
- **Character sheets:** batch import of sheet files.
- **Vocabulary editor:** Functions, interactions and Domains.
- **Images:** a form can hold several image controls and image lists. Uploads larger than 1280px are scaled down and re-encoded as WebP in the browser, so published pages stay light.
- **Learning Paths editor.**
- **CM Tools** (`generators.js`): a **Resource generator** and a **Gate generator**. They draft Resources by Domain, with Functions chosen through the interaction table, field descriptions, Special Properties and harvesting issues. They also draft whole Gates: concept, Aspect, hazards, landmarks, creatures, a signature Function set, native Resources, and inferred ecology and technology. Everything they produce is an editable draft.

### Deployment and versions

- **Deploy:** `.github/workflows/deploy-site.yml` publishes `public-site/` to GitHub Pages whenever it changes on `main`.
- **Versions:** each deploy becomes a numbered release (`vX.Y.Z`, rules in `.github/versioning.json`, script `.github/scripts/release_version.py`), shown in the site footer and linked to its release notes.

---

## 5. The game system (Fate with house rules)

The campaign uses **Fate Core**: Aspects, Skills on the ladder (Mediocre +0 to Great +4 and above), Stunts, Fate Points, Stress and Consequences. The house rules below are established on the site. Anything marked *still being designed* is not settled yet.

### The two loops

- **Expedition Loop:** Job Board, then **Preparation**, then **Exploration**, then **Return**. During Preparation the crew reads the Archive, picks Gear within its carry limit and considers the Gate's Domain. During Exploration they enter the Gate, learn its rules and pursue the objective. Return records discoveries, Resources, Cores, consequences, rewards and Downtime.
- **Settlement Loop:** Downtime is spent on Projects, Research and recovery. Their results, and especially their Complications, create new jobs.

Somewhere in each Gate is a **Core**. Recovering the Core collapses the Gate, so the crew may need to decide whether that is the goal.

### Downtime and Projects

- **Gaining Downtime:** each completed expedition gives **2 Downtime** to those who took part and **3** to those who stayed in Endros. You can hold at most **8**; anything above is lost.
- **Every significant between-session action is a Project Action:**
  1. Spend 1 Downtime.
  2. Describe the approach and the Skill used.
  3. Roll against a difficulty the GM sets for that approach.
  4. Gain Progress: **Fail 0** (plus a Complication), **Tie 1**, **Success 2**, **Success with Style 3**.
- **Limits:**
  - Each character can make **one action per Project between expeditions**.
  - Spending **1 extra Downtime** lets one relevant Outpost **Capability** add its rating to the Progress gained.
- **Project types:** Personal, Public, Research, Marketplace, Facility, Recovery/Repair, Establish Supply and Spell Innovation. These are one system applied to different goals.
- **Size guidelines:** Minor about 4 Progress, Standard about 6, Major about 10, Grand 15 or more (or several stages). Ambitious Projects need more Progress, Requirements and stages, not higher difficulties.
- **Requirements:** a Resource with given Functions, a Facility, knowledge, a Capability rating, a specialist, a previous Project, an expedition or a free Consequence slot. A missing Requirement **Pauses** a Project without losing Progress.
- **Complications:** new problems rather than lost Progress: an Aspect, a harder next step, a blocking issue, a new Requirement or an expedition objective.
- **Research:** a Project whose goal is an answer. It can reveal partial information, rule out theories, reveal a hidden property or raise new questions. Results become shared knowledge in the Archive.

### Consequences and recovery (replaces Fate's recovery rule)

- **No natural healing:** Consequences never fade over time. A **Recovery Project** lowers one by **one step**.
- **Progress needed:** personal Mild 2, Moderate 4, Severe 6. For the Outpost: Low 2, Moderate 4, High 6, Critical 8.
- **Free slot:** a personal Consequence can only step down into a free slot. Recovering a Severe one needs a free Moderate slot; recovering a Moderate one needs a free Mild slot.
- **Outpost Consequences:** they arise when the settlement's Stress track fills. Their recovery is a Public Project anyone can work on.

### Coins, Marketplace and Personal Stash

- **Starting Coins** equal your **Resources** rating (none at +0 or below). Buying costs no Downtime.
- **After every expedition, refresh:** if your Coins are below your Resources rating, raise them to it. If you took part, refresh first, then add reward Coins.
- **Personal Stash:** everything you own. Before an expedition you mark Gear as **brought into action**, up to a **carry limit of 6** (weight measures how hard something is to bring along, not mass).
- **Forgot something?** You can produce an owned item mid-expedition. It costs 1 stress if it fits your carry limit, or 1 Fate Point if it takes you over.
- **Personal Project vs Marketplace Project:** a Personal Project makes one item for you. A Marketplace Project makes the item buyable by everyone.

### Recruitment Factions

Every character picks the faction that brought them to Endros. It grants a small **Extra** and roleplay hooks, but doesn't decide profession or Skills. **A Recruitment Faction means sponsor, not nationality.** There are eight. The three below come from Endros itself; the five major powers (Vardic Holds, Aurelian Empire, Vesper Republic, Kharad Compact, Tianzhao Mandate) are listed in section 6, *Factions*. Each has a rule on the Recruitment Factions learning path with Lore, Recruitment Extra and Expectations sections.

| Faction | Extra | Expectations |
| --- | --- | --- |
| **Nowhere Expeditions (the company)** | *Relocation Package:* +1 Coin after each expedition you take part in. | Stay active, honour your contract, appear in promotional material, let the company take its commissions. |
| **University of Verna** | *Institutional Access:* once between expeditions, +1 Progress on a Research Project Action the University could plausibly help with. | Submit research, share samples, publish findings, assist University staff. |
| **Independent** | *Self-Directed:* once between expeditions, +1 Progress on a Personal Project Action. | None, but no contacts or support either. |

### Outpost Capabilities

The six Capabilities: **Industry** (crafting, repairs, manufacturing), **Research** (investigation, analysis, Gate knowledge), **Commerce** (trade, funding, access to resources), **Security** (defence, policing, emergency response), **Medicine** (treatment and recovery) and **Infrastructure** (facilities, transport, services).

Each can support one Project Action for 1 extra Downtime, can serve as a Requirement, and changes through Facilities, Projects and Consequences. **Facilities** are built through Public Projects and mostly unlock new possibilities rather than add numbers.

### Domains

Every Gate has a **Domain** (rarely two), which its Resources, creatures and hazards inherit. A Domain gives no bonus by itself. It's a keyword that Stunts, equipment, specialisms, Projects and Preparation can refer to.

| Domain | Description |
| --- | --- |
| **Verdant** | Biologically dense places dominated by strange growth: forests, wetlands, fungal systems and other highly active life. |
| **Volcanic** | Heat, geothermal activity, magma, ash, mineral pressure and intensely energetic geology. |
| **Abyssal** | Deep water: submerged, high-pressure, lightless, oceanic or otherwise deep and hostile places. |
| **Arid** | Dry places: deserts, salt flats, exposed stone, desiccated caverns and mineral wastes. |
| **Frozen** | Ice, snow, extreme cold, cryogenic conditions and unusual preservation. |
| **Constructed** | Places that were clearly built: machine worlds, ancient complexes, artificial ecosystems and megastructures. |

### Resources

A **Resource** is anything useful recovered from a Gate. **Whoever discovers it names it.** Each Resource has:
- a description (fiction);
- a Domain;
- **Functions** (what it can do; most have one to three);
- an optional **Special Property** (odd behaviour too specific to be a Function);
- an **Availability**: *Sample* (enough for Research), *Limited* (enough for one Project) or *Available* (a dependable supply).

Some Functions are **Hidden** until Research reveals them. An **Establish Supply** Public Project makes a Resource more available.

### Resource Functions (the shared vocabulary)

Functions are verbs: exceptional, exploitable properties rather than descriptions. Ordinary materials have none.
- Projects ask for Functions rather than named materials.
- Effects are combinations: burning is `Release` + `Heat`, cooling is `Absorb` + `Heat`, propulsion is `Move` + `Release`.
- Spellcasting manifests the same Functions as **Words**.
- The GM keeps the list. It currently has **30 Functions in five groups** (reworked 5–6 Oct 2026):

| Function | Definition |
| --- | --- |
| **Energy & Light** | |
| `Absorb` | Draw something into itself, taking it out of its surroundings. |
| `Amplify` | Increase the strength or intensity of an effect that already exists. |
| `Conduct` | Carry energy, force or a signal through itself efficiently. |
| `Dampen` | Reduce the strength or intensity of an effect without ending it. |
| `Glow` | Give off light. |
| `Heat` | Raise the temperature of itself or its target. |
| `Release` | Emit or discharge what it holds or can reach, often all at once. |
| `Store` | Hold energy, matter or charge safely for later use. |
| **Matter & Structure** | |
| `Bind` | Join separate things and keep them connected. |
| `Corrode` | Break down or degrade matter. |
| `Flex` | Bend, stretch or deform under stress and return to shape without breaking. |
| `Regenerate` | Restore damaged structure or lost substance to what it was. |
| `Reinforce` | Increase resistance to damage, pressure or deformation. |
| `Stabilize` | Resist unwanted change and keep processes steady. |
| `Transmute` | Change matter, or its properties, into another form. |
| **Motion & Space** | |
| `Anchor` | Hold fast in place, resisting any force or effect that would shift it. |
| `Move` | Impart, alter, speed up or direct motion. |
| `Phase` | Change how something occupies space, letting it pass partly or wholly through solid matter. |
| `Slip` | Escape grip, friction or restraint, sliding free of whatever would hold it. |
| **Signal & Perception** | |
| `Hide` | Conceal from perception or detection, whether senses or instruments. |
| `Record` | Keep impressions, states or patterns that can be read back later. |
| `Resonate` | Respond strongly to a particular frequency, pattern or signature. |
| `Sense` | Detect a target phenomenon or condition. |
| **Process & Response** | |
| `Adapt` | Change in response to conditions, in a useful or self-directed way. |
| `Catalyze` | Start, enable or speed up a process without being used up by it. |
| `Filter` | Let some things through while holding others back. |
| `Invert` | Reverse a property, direction or effect: hot to cold, pull to push, growth to decay. |
| `Loop` | Repeat a process, motion or event in a cycle, returning to where it began. |
| `Nullify` | Cancel or suppress a phenomenon outright, especially an anomalous one. |
| `React` | Produce a defined response to a specific trigger. |

**Interactions.** Pairs of Functions can be in **Synergy** (easy to engineer together), **Opposition** (they work against each other: possible, but harder) or **Instability** (dangerous or unpredictable, and often the most valuable frontier). A pair can carry more than one kind, plus a keyword naming the effect. There are **151 defined pairs**; the full list is in `public-site/data/vocabulary.json` (seeded from `content-manager/default_interactions.json`). Some examples:
- **Synergy:** `Store` + `Release`, `Glow` + `Store` (*Afterglow*), `Loop` + `Record` (*Playback*), `Conduct` + `Store`.
- **Opposition:** `Amplify` + `Dampen` (*Cancellation*), `Conduct` + `Dampen` (*Resistance*), `Anchor` + `Move` (*Strain*), `Nullify` + `Record` (*Erasure*).
- **Instability:** `Release` + `Store` (*Catastrophic discharge*, when uncontrolled), `Catalyze` + `Release` (*Runaway*), `Invert` + `Regenerate` (*Withering*), `Nullify` + `Phase` (*Entrapment*), `Move` + `Slip` (*Loss of control*).

Interactions are guidance, not a chemistry table: the GM decides how a particular combination behaves.

### Material Engineering and crafting

When no known Resource has the needed Functions, a character can **engineer a new material** through a Project. Its difficulty follows the Functions' interaction (synergy is easy, no known relationship is moderate, opposition is hard, instability is high-risk).
- **Failure** creates interesting Complications: instability, lost samples, a dangerous by-product, an unexpected Function, or the need for a Catalyst, equipment or an expedition.
- **Success:** the inventors name the result, and it counts as a Resource.
- **Experimental Substitution:** a Resource with not-quite-matching Functions can be argued for, at extra cost or risk.

### Spellcasting (partly designed)

**Artificery studies Functions embodied in matter; Spellcasting manifests the same Functions directly as magical Words.** Magic is an emerging experimental science made possible by Gate discoveries, not an ancient spell list.

The chain: Gates contain environments, environments produce Resources, Resources embody Functions, Research reveals them, artificery combines them in matter, and Spellcasting manifests them as **Words**. **Forms** then combine Words into repeatable effects, and Projects make discoveries permanent.

- **Words:** a caster knows how to manifest some Words. Each manifested Word has temporary **Stress capacity**.
- **Forms:**
  - **Basic** manifests one Word. The Basic Form can be skipped when the Word or its Function is already within reach (a Resource, an object, the scene).
  - **First Form:** uses one Word for a defined effect.
  - **Second Form:** combines two Words.
  - **Third Form:** combines three Words.

  Every Form is learned separately.
- **Hosts:** a Word can be manifested in three places:
  - **Self:** your own capacity and high control, but the risk falls on you.
  - **Object:** limited capacity and high control, but the object can be lost.
  - **Scene:** large capacity and low control, and anyone (including enemies) can use it.
- **Resources:** a Resource can give access to a matching Word, but a physical Function is not an unlimited Word.
- **Example Forms** (illustrations, not a spell list): Kindle (`Heat`), Kinetic Impulse (`Move`), Flash Freeze (`Absorb` + `Heat`), Thermal Burst (`Release` + `Heat`), Kinetic Arrest (`Absorb` + `Move`), Dimensional Lock (`Anchor` + `Phase`), Gate Signature Reading (`Sense` + `Resonate`).
- **Spell Innovation:** a Project that turns a theoretical combination of Words into a reliable new Form.
- **Still being designed:**
  - Word Stress values;
  - manifestation difficulties and the Skills used;
  - Form costs;
  - how many Words can be manifested at once;
  - drawing capacity from Resources;
  - how Words and Forms are learned.

  Until then the GM rules case by case.

### Learning paths (how the rules are read)

| Path | Rules | Read it when… |
| --- | --- | --- |
| **Onboarding** | Nowhere Expeditions, Creating an Expeditioner, Expeditions, Downtime, Coins, Marketplace & Personal Stash, What's Next | Before your first expedition. |
| **Recruitment Factions** | the three factions | Creating a character. |
| **Between Expeditions** | Projects, Project Requirements & Complications, Research, Consequences & Recovery | First time spending Downtime. |
| **Gates & Discoveries** | Domains, Resources, Resource Functions | The crew brings back something new. |
| **Crafting & Artificery** | Material Engineering, Personal Stash & Crafting | Building gear or inventing materials. |
| **Spellcasting** | Spellcasting, Spell Innovation | The character studies magic. |
| **Building Endros** | Outpost Capabilities, Facilities & Outpost Development, Marketplace Development | Helping the settlement grow. |

The pinned announcement **JOIN NOWHERE EXPEDITIONS!** (the game listing) is the entry point. Onboarding page 1 sends new players to it first.

---

## 6. Established lore (canon)

Everything here is published on the site. Where a detail isn't established, it is left out rather than guessed.

### The setting

- **The Valeoran Ruins** were discovered **11 years ago**, at the far ends of an uncharted horizon. Fragments of an ancient wonder rise from the sea and reach high into the sky, **suspended and drifting in place over an unnaturally still ocean**.
- **Endros** has grown around the ruins: floating platforms, laboratories, workshops, shipyards and habitation blocks. It is a rapidly growing settlement so remote that newspapers call it *"Endros in the Middle of Nowhere"*, *"Endwhere"* or just *"Nowhere"*. It is the expedition hub: every expedition starts and ends there.
- **Gates:** several years after the discovery, researchers saw parts of the ruins **begin to move, gathering together to form temporary portals**. What lies beyond them varies widely: ruins, unknown ecosystems, impossible machinery. They are strange places where familiar rules no longer apply, holding resources found nowhere else in the known world.
- **Cores:** somewhere in each Gate is a **Core**. Recovering it collapses the Gate.
- **Artificery:** materials recovered from Gates have created an entirely new field of technology.
- **Magic:** more recently, researchers have begun documenting something even stranger. The Gates and what comes out of them (Cores and materials) are the world's **only known source of magic**. The game listing calls this new age **"the Era of Magic"**.
- **The central mystery:** the origin and purpose of the Gates, the Cores and the ancient ruins. No answers have been established. Do not invent them.
- **Expeditioners** are the specialists who come to Endros, form crews and go through the Gates for knowledge, materials, artifacts, money and answers. They include researchers, engineers, physicians, sailors, security personnel, salvagers, artificers, surveyors, cartographers, medics, linguists, riggers, cooks, mechanics and Gate scholars. Most are recruited from abroad.

### The Outpost: Endros Research Outpost

The settlement's sheet, played as a shared Fate character:

- **High Concept:** *From Archaeological Outpost to Gateway Industry*
- **Trouble:** *Everything We Need Comes by Ship*
- **Aspects:** *Built Fast, Built to Work* · *Everyone Came Here for Something* · *No Expedition Without Evaluation and Clearance*
- **Stress:** 0 of 3. **Consequences:** none.

| Capability | Rating | Facilities behind it | Current conditions |
| --- | --- | --- | --- |
| Industry | +0 | Workshops | Strained harbour and damaged support structures. |
| Research | +0 | University of Verna Laboratories, Gate Evaluation Committee | New artifacts and partial survey data keep expanding the public record. |
| Commerce | +0 | Docks | Active, but sensitive to the volatility of new discoveries. |
| Security | +0 | Watchtower | Threats are real but being contained. |
| Medicine | +0 | Infirmary | Long-term recovery is a concern as more unusual injuries are identified. |
| Infrastructure | +1 | Cranes, Elevators | Damage to support systems makes it more valuable and more fragile. |

**Facilities:**

| Facility | What it does |
| --- | --- |
| **Workshops** | General fabrication, repairs, maintenance and production of mundane equipment. |
| **University of Verna Laboratories** | Archaeology, Gate studies, artifact analysis and experimental work. |
| **Gate Evaluation Committee** | Evaluates newly discovered Gates, maintains classifications and records, and recommends on exploration and containment. (Compare the Aspect *No Expedition Without Evaluation and Clearance*.) |
| **Docks** | Incoming supplies, outgoing goods, trade vessels and shipping processed Gate materials to the mainland. |
| **Watchtower** | Basic observation, local security coordination and warning of approaching threats. |
| **Infirmary** | Basic medical treatment, stabilisation and recovery. |
| **Cranes** | Heavy lifting and cargo handling across the industrial areas and docks. |
| **Elevators** | Move people, equipment and cargo between the Outpost's different elevations. |

### Organisations

- **Nowhere Expeditions (the company):** an in-world recruitment and relocation agency that shares its name with the campaign.
  - **What it does:** finds people abroad willing to move to the edge of the known world and gets them there. It arranges transport, relocation help, subsidised housing, job placement, expedition registration and introductions.
  - **How it profits:** it is not a charity. It earns through commissions, placement fees or shares of expedition rewards, on terms set by each recruit's contract.
  - **Its advertising:** the pinned recruitment notice is one of its adverts: *"Sell your lord! Sell your house! Bring your family! Bring your sheep! Bring your cow!"*.
- **University of Verna:** an academic institution with laboratories, archives and staff in Endros. It means to understand the Gates as the only known source of magic, and sponsors researchers, archaeologists, historians, engineers, natural philosophers, physicians and field specialists. It expects research, samples and publications in return.
- **Independents:** Expeditioners who came on their own terms: self-funded, through personal contacts, working their passage, or by unusual opportunity. They owe no one.
- **Gate Evaluation Committee:** the body that classifies new Gates and clears expeditions (see Facilities).

### Characters (published)

- **Palava Bansz** (player: *Jack The Wizard*), active. Bookworm middle child of the noble **Bansz** family.
  - **Aspects:** *Sleepy (will nap and wrap up in blankets at any chance)* · *Feverish: feels cold all the time, frail* · *Childishly manipulative* · *Well researched on the new "Magic"*.
  - **Top skills:** Lore +4, Deceive +3, Investigate +3.
  - **Stunts:** *Wikipedia* (an eldritch knowledge book that looks up nearly any topic), *Magic User* and *Magical Fluency*.
  - **Spells:** her sheet uses a provisional, D&D-style spell list (cantrips such as Fire Bolt, Mending and Prestidigitation; 1st-level Shield, Burning Hands and Feather Fall). This predates the Words-and-Forms spellcasting design and may need reconciling with it.

### Glossary

| Term | Meaning |
| --- | --- |
| **Endros / Nowhere / Endwhere** | The settlement around the Valeoran Ruins. |
| **Outpost** | Endros as a mechanical entity (the Outpost Sheet); formerly "the Island". |
| **Valeoran Ruins** | The ancient floating ruins the Gates form from. |
| **Gate** | A temporary portal formed by moving fragments of the ruins. |
| **Core** | The object inside each Gate whose recovery collapses it. |
| **Expeditioner** | A player character, or anyone who goes through Gates. |
| **Crew** | The group taking one job. There is no permanent party. |
| **Artificery** | Technology built from Gate materials. |
| **Resource / Function / Word / Form** | Gate material / what it can do / that Function as magic / a learned spell technique. |
| **Domain** | A Gate's kind of environment. |
| **Downtime / Project Action / Progress** | Between-session time / one unit of work / filling a Project's track. |
| **Recruitment Faction** | Who brought a character to Endros. |

### Factions

Six world factions are published on the Factions page, and the five major powers have Recruitment Faction rules. Their content comes from the *Factions Site Integration Guide*. The Expectations lists of the five new rules are drafts written for the site. The artwork in `artwork/` (gitignored) supplies their flags, homelands and clothing references. The art files say `valdic-holds`, but the canonical name is **Vardic Holds**.

| Faction | Identity | Recruitment Extra |
| --- | --- | --- |
| **Vardic Holds** | A loose federation of industrial northern jarldoms valuing craftsmanship, reputation, self-reliance and deeds worth remembering. Old Gods of the Holds (Fate, Making, Memory). | *Built to Endure:* once per session, a tie on a Crafts advantage to repair, reinforce, modify or improvise equipment counts as a success with a free invoke. |
| **Aurelian Empire** | A powerful maritime empire of navy, bureaucracy, standardization and etiquette; power creates responsibility. Faith of the First Light, Aurelian Communion (the Crowned Sun). | *Properly Provisioned:* once per session, bring one Stash item into action without the Stress or Fate Point cost. |
| **Vesper Republic** | A young revolutionary republic of citizenship, public argument and inquiry; resists monopolies over magical knowledge. Vesperian Communion (the Sacred Flame). | *Someone Knows Someone* (working design): once per session, a reasonable useful contact through the sponsor's societies. |
| **Kharad Compact** | A league of mercantile city-states, banks, merchant houses and treaty networks prizing agreement, reputation, patient negotiation and honest measure. Covenant of the One. | *Established Credit* (working design): a Minor Obligation slot that lets someone cover a cost now, in exchange for a debt or favour. |
| **Tianzhao Mandate** | An ancient bureaucratic civilization of harmony, long-term consequence and celestial order; first read the Gates through its Spirit and Celestial realms. | *Restorative Care:* once between expeditions, +1 Progress on a Recovery Project for your own Consequence. |
| **Verna** | A small independent republic neighbouring Vesper, home of the University of Verna; shaped by scholars fleeing the Silencing of the Schools. | The Recruitment Faction is the **University of Verna** (published); being sponsored by it is not the same as being Vernan. |

Religions cross faction lines: the Faith of the First Light is shared by Aurelia and Vesper, and minor First Light communities live in the Holds. Fringe beliefs are published as beliefs, never as facts.

---

## 7. Sample (placeholder) content: NOT canon

The database holds **sample** records used to test layouts. They are hidden from the live site and **must not be treated as lore**. They will be replaced around 18 Oct 2026 with the real Archive, gear and first jobs.

- **Archive:** five Gate Records (The Silt Choir G-03, Glass Verge G-07, The Lantern Reef G-12, The Hollow Orchard, The Brass Tide), plus session records, newspapers and lore entries ("Founding of the Outpost", "The Silence of Year Three", "The Karthian Flood Myth", "The Bell That Rings Early"…).
- **Jobs:** 12 sample jobs (e.g. Saltglass Survey E-17, Find Teodor Quell).
- **Characters:** 8 sample characters (e.g. Ilse Markov, Doctor Enna Hale, Quartermaster Varga, The Archivist).
- **Other records:** 18 sample Gear items, 3 sample Projects (Harbor Reinforcement, Gate Mapping Sweep, Ruin Stabilization) and 3 sample Facilities.
- **In rules text:** the examples Emberglass, Whisper Silk, Gate-Silk Armor, Mira, Tomas and Ines are illustrations, not established world facts.

No real Gates, Resources, spell Forms, Jobs, Gear or Projects have been published yet.

---

## 8. Known gaps and inconsistencies

- **Undesigned spellcasting details:** see the list in section 5.
- **Old wording in `instructions.md`:** it describes "an industrial Island built around enormous ancient floating ruins". The published canon describes Endros as floating platforms around ruins over a still ocean. Update `instructions.md` (and its "Island Sheet", "Expedition Board" and "Gate Archive" sections) to the current terms.
- **Palava Bansz's spell list:** it uses D&D-style spells rather than Words and Forms.
- **Working designs:** the Vesper (*Someone Knows Someone*) and Kharad (*Established Credit*) Extras are marked as working design in their rules.
- **Faction lore:** no Archive lore entries about the factions exist yet (e.g. the Old Gods of the Holds, the Faith of the First Light, the Covenant of the One, the Silencing of the Schools). Write them as Lore entries with topics and tick their factions; the faction pages list them automatically.
- **Factions brief, Phase 3** (relationship visuals, faction nodes in the connection graph, Marketplace origins, NPC and Job faction links) is not built.
- **Capability ratings:** they are all +0 except Infrastructure +1. This is the starting state, not a placeholder.

---

## 9. Working on the project (for agents)

- **Read `instructions.md` first.** The site is **player-facing**: never put GM secrets into `public-site/` or this file. When unsure whether something is public, ask.
- **Don't invent lore or mechanics.** Distinguish standard Fate, established house rules, proposals and examples. Mark undefined things as undefined.
- **Content lives in the database.** Don't hand-edit `public-site/data/*.json`. Change content in the content manager, then Sync.
- **Keep the site simple:** static files, vanilla JS, no build step. Pages must work on phones. The content manager only needs to work on a desktop.
- **Run the tests** after changing `content-manager/app.py`, and restart the manager to pick up code changes.
- **Repository practices:**
  - Line endings: the repo stores LF, and the Windows checkout uses autocrlf.
  - Commits: commit to a branch and open a PR to `main`. Deploys run on `main`.
- **Local URLs:** the site is served at <http://127.0.0.1:8000> (it must be served over HTTP, not opened as files) and the manager at <http://127.0.0.1:8001>.
