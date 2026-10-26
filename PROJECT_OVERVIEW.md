# Nowhere Expeditions: Project Overview

A single-file summary of the whole project for people, tools and AI agents that need to catch up quickly: what the campaign is, how the repository is built, which tools exist, how the rules work, and what lore has been established so far.

- **Snapshot:** 6 October 2026 (pre-launch; Factions added the same day), brought fully up to date on 14 October 2026 (repository, site, rules and lore; v1.0.8 content). Lore restructured on 21 October 2026: faction pages are the central overviews, and the Archive holds short one-subject entries. The first session is planned for **6 November 2026**.
- **Player-facing only.** This file holds only what players can already see on the public site. It deliberately leaves out GM-only material: GM notes, Hidden Functions, harvesting issues, unpublished drafts and anything about the true nature of the Gates, Cores or ruins. The repository is public, so keep it that way.
- **Sources of truth:** the content manager's database (`content-manager/content.db`, not in Git) for content, `instructions.md` for design principles, and the code itself. When this file disagrees with them, they win. Regenerate this file rather than editing facts by hand.

---

## 1. The project in brief

**Nowhere Expeditions** is a [Fate Core](https://fate-srd.com/) tabletop campaign run in a **West Marches** style, played on Discord. There is no fixed party: for each expedition, the players who sign up for a job form that session's crew. They travel through **Gates** into impossible places and bring back knowledge, materials and artifacts that permanently change a shared, persistent world centred on the settlement of **Endros**.

The project has three parts:

| Part | What it is | Who uses it |
| --- | --- | --- |
| **Public site** (`public-site/`) | The campaign website: rules, the Outpost's current state, Job Board, Expedition Reports, Factions, Gates, Lore, Discoveries, Marketplace, characters. It is part handbook, part in-world expedition database. | Players |
| **Content manager** (`content-manager/`) | A local app where the GM writes and publishes everything the site shows. | The GM, on a desktop |
| **Discord bot** (`discord_server/bot/`) | Vaultulation, the campaign server's bot, run locally by the GM with a dashboard for approvals. Its `/names` command shares the site's name lists. | Players on Discord; the GM |

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
| 11 Oct 2026 | Game listing and rules authored | Done |
| ~18 Oct 2026 | Real Outpost, Archive, gear and first jobs replace the sample content | In progress |
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
├── discord_server/bot/   Vaultulation, the Discord bot (the rest of discord_server/ is not committed)
├── tools/                One-click launch scripts (start-everything.ps1, make-shortcut.ps1)
├── artwork/              Reference art: homeland clothing, environments, flags, logos (not published)
├── site-export/          Generated full copy from "Export to site" (ignored by Git)
├── .github/              Deploy workflow, release versioning and the What's Changed generator
├── instructions.md       Design and content principles for the site (the house style)
├── README.md             Getting started
├── RUNNING.md            Running everything locally, including the bot
├── DEPLOYING.md          Git, GitHub Pages and publishing
└── PROJECT_OVERVIEW.md   This file
```

Some older files still use earlier names: the settlement was once **the Island**, Jobs were **Expeditions**, and for a while one **Archive** page held Gates, reports and lore together (`archive.html` now forwards each record to its new page). `instructions.md` still uses the Island wording. The current terms are **Outpost/Endros**, **Job Board**, **Gates**, **Lore** and **Expedition Reports**.

---

## 3. The public site

Plain HTML, CSS and vanilla JavaScript: no framework and no build step. Every page loads its content from JSON files in `public-site/data/`, which the content manager generates. Never edit those files by hand.

| Page | What it shows |
| --- | --- |
| `index.html`, the **Overview** | Hero carousel, the newest **pinned announcement** featured as a card, a three-step *Start here* (read Onboarding, create a character, find a job), the launch roadmap and countdown (in the visitor's local time), and section tiles. |
| `factions.html`, **Factions** | The countries and powers of the wider world. A card grid you can scan in under a minute (flag, homeland image, short descriptor, core values, Sponsor Extra), then a detail view per faction (`factions.html#<id>`): hero, At a glance (government, known for, values, Gate attitude, visuals), Sponsorship, Beliefs & folklore, History, Visual identity (artwork), Relations. **The faction page is the faction's central overview**: everything general about it is there. Below it, a **Study guide** lists Archive entries about the faction as a numbered reading path (kind, subtitle, reading time; the GM's order or, by default, by kind) beside **Connected reading** (other records that name the faction); while there are none, it says that more detailed entries get added as backstories and expeditions bring them up. On phones the essentials and sponsorship come first. |
| `outpost.html`, the **Outpost Sheet** | The settlement as a Fate character: High Concept, Trouble, Aspects, six Capabilities with ratings and dice rolls, Stress, Consequences, the Facilities table (filterable by Capability) and ongoing Outpost Projects with Complications. |
| `jobs.html`, the **Job Board** | Open listings (objective, briefing, schedule, crew size, who posted it), filterable by type, plus closed jobs linked to their Session Records. |
| `gates.html`, **Gates** | Built from the Factions page's own components, so the two read as siblings. Index: a card grid (painting banner with the designation badge; name, significance, Domain, Status and Core; "Explore Gate"), filterable by status. A Gate page (`gates.html#<id>`): a hero over the painting (designation, status, name, significance, summary); a main column with At a glance (Status, Core, Access, Domain), Environment, the record text and glossary-style Known traits/locations/creatures; a side column with **The painting** (whole, with caption), **Known hazards** as the highlighted panel and the **Resources** as small cards (square icon, name, availability, Functions); then **On record** (jobs, reports and lore about the Gate). |
| `lore.html`, **Lore** | The encyclopedia, arranged as reading paths. **Each entry covers exactly one subject** (a term, person, place or historical event), says in its first sentence what that is, and links to other entries instead of changing topic. Each entry has one **kind** (Place, Person, Event, Term, Institution, Faith, Folklore; the older Overview, Society and Endros & the Gates still exist) shown above its title, with its subtitle in every list. The page opens with a **Start here** path for new players (entries with a Start here step), then one shelf per faction in reading order and a shelf for lore about no faction. An opened entry shows its step ("Step 3 of 5") and Previous/Next links; `lore.html?path=<faction-id|start>#<id>` keeps the reader on a path. Lore entries also carry **topics** (History, Folklore, Religion, Politics…), and an entry can have several. Search, a **topic filter** (`lore.html?topic=<name>`), a **shelf filter** (`lore.html?faction=<id>`, or `?faction=world` for the Endros & the Gates shelf), cross-links, "Referenced In" backlinks, links to the factions an entry is about, and an **Explore connections** graph view (`lore.html#explore/archive/<id>`). |
| `reports.html`, **Expedition Reports** | Session records ("Expedition Reports") and newspapers ("Bulletins"), newest first, each with its session date, outcome, job, crew and Gate(s). |
| `discoveries.html`, **Discoveries** | Four tabs: **Resources** (searchable catalogue; each card shows a 44px square icon, the crop of the painting chosen in the manager's **Icon framing** editor), **Functions** (look up a Word, combine two, random Resource, a 30×30 interaction grid), **Domains**, and **Spell Forms**. |
| `marketplace.html`, the **Marketplace** | Featured Gear carousel and the full price list (grid or list view), with prices in Coins, weights and availability. |
| `characters.html`, **Characters** | Player characters and NPCs ("Known Figures", e.g. the Gate Evaluation Committee's Senior Evaluator), profiles, Fate sheets (with clickable skill rolls), Personal Stash, Projects, "Create new character", and **In the Archive**: every Archive entry that links to the character with `[Name](characters.html#id)`. NPCs show no empty stash or job history. |
| `game.html`, **Rules & News** | Announcements and the rules reader. Rules are grouped into **learning paths**, starting with Onboarding, and each rule links to the next. |
| `sheet.html`, the **character sheet** | An editable Fate sheet that runs in the browser. Players fill it in or update it, press **Save file** (JSON) and send the file to the GM, who imports it. It includes the Sponsor choice, the Active Expedition Pack (with what is left inside it), a Marketplace tab for buying Packs and Gear, and Carry Limit tracking. |
| `names.html`, the **Name Generator** | Ten character names at a time in the style of a homeland (Vardic Holds, Aurelian Empire, Vesper Republic, Kharad Compact, Tianzhao Mandate, Verna), mixed or feminine/masculine, with a note on how that culture names people. Deep link `names.html#<faction-id>`. Linked from the Creating an Expeditioner rule, the Characters page (beside Create new character), each faction page and the footer. The lists are the hand-maintained `assets/names.json`, which the Discord bot's `/names` command also reads. |
| `changes.html`, **What's Changed** | Every release since v1.0.9 and the records it added, edited or removed, grouped by site section (Rules, Lore, Gates…). Each record links to its page and lists the changed fields; for rules and lore it names the `##` sections that were added, edited or removed. A **Changes since** picker (`changes.html?since=<version>`) merges every later release into one re-reading list. Generated at deploy time from the published data, so nobody keeps notes by hand. |
| `archive.html`, `rules.html`, `island.html`, `expeditions.html` | Redirect stubs from old addresses. |

**Site-wide features:**
- **Search:** Ctrl+K, `/` or the Search button searches rules, Gates, Resources, characters and pages.
- **Header and footer:** a sticky header with two dropdowns: **Expeditions** (Job Board, Expedition Reports) and **Encyclopedia** (Factions, Gates, Lore, Discoveries). Click to open; on screens 1,100px wide or less the header folds into a Menu button and each group appears under its heading, and a footer site map. The footer shows the site version (`v1.0.9 (date)`), which links to that release on What's Changed.
- **Dice:** a Fate dice roller with roll history (`dice.js`, kept in the browser only).
- **Markdown and links:** authored text supports Markdown (via `vendor/markdown-it`) and wiki links like `[[archive-id]]`, which go to the page for the record's type (Gate, Lore or Report).
- **Deep links:** every record has a stable URL, such as `jobs.html#<id>`, `gates.html#<id>`, `lore.html#<id>`, `reports.html#<id>`, `characters.html#<id>#sheet`, `discoveries.html#function-Heat` or `game.html#post-<id>`.

**Mobile:** the public site is meant to work well on phones (checked 6 Oct 2026 at 390px wide):
- the header is one row;
- list-and-detail pages (Lore, Expedition Reports, Rules, Jobs, Characters) show either the list or the open item, with a back link;
- tap targets are enlarged on touch screens;
- nothing scrolls sideways (the interaction grid scrolls inside its own box).

The content manager is desktop-only.

**Special markers** in rules text expand into live content: `{{reading-path}}`, `{{function-vocabulary}}`, `{{function-picker}}`, `{{domain-list}}`, `{{resource-catalogue}}` and `{{form-list}}`.

---

## 4. The content manager

A local web app: `python content-manager/app.py`, then open <http://127.0.0.1:8001>.
- **Tech:** Python standard library only, with SQLite storage (`content.db`, gitignored, schema v13). Its tests live in `content-manager/tests/` (run with `python -m unittest discover -s tests`).
- **Code:** `app.py` (server, storage, validation, export) and `static/` (`manager.js`, `generators.js`, `continuity.js`, `revisions.js`, `icon-framing.js`, `manager.css`).

### Collections (record types)

| Collection | Represents | Notes |
| --- | --- | --- |
| **Factions** | Countries, powers and sponsors | Name, aliases, descriptor, identity, government, values, Gate attitude, beliefs and history summaries, visual notes, relations to other factions, the Recruitment Faction rule it links to plus a compact Extra, and images (flag, homeland, gallery, clothing). Archive entries name their factions (`factionIds`, many-to-many), and the faction page lists them automatically. Schema v9. |
| **Characters** | PCs and NPCs | Optional Fate sheet, Sponsor, owned Expedition Packs (one active, each with its remaining contents), Personal Stash (Gear × quantity, "brought into action"), Coins, Downtime, Projects. |
| **Expedition Packs** | Carrying setups | Sponsor, Carry Limit, price / Sponsor price, contents (Gear × quantity). One starting Pack per Sponsor. |
| **Jobs** | Job Board listings | Type, schedule, crew and participants, optional link to a Session Record. |
| **Archive** | Lore entries | Structural types: gate-record, session-record, newspaper, lore. What a lore entry is about is its **topics** (suggested: History, Folklore, Religion, Politics, Technology, Culture, Notable People, Institutions, Events, Diplomacy; others can be added). Schema v10 turned the old History and Folklore types into lore entries with that topic. Gate Records add a designation, status (incl. restricted, quarantined), Core state, access, significance, Domains (environments only), environment, traits, hazards, locations, creatures, and a poster image with caption. Session records and newspapers can name **Gates** (`details.gateIds`); Jobs have a `gateId`. Any entry can name the factions it is about. Free-text search tags are separate from topics. |
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
- **Versions** (`revisions.js`, table `record_revisions`, database-only): every save that changes a record keeps the version it replaced (latest 30), and a record can carry **proposed revisions** (e.g. a lore rewrite loaded with `lore_tool.py load --propose`) that leave the live record alone until applied. A record's **Versions** dialog compares any version with the current one side by side (word diff) and applies, restores or discards it; applying never changes the Published state. Records with a proposal get a banner and appear under Home → Needs attention.
- **Character sheets:** batch import of sheet files.
- **Vocabulary editor:** Functions, interactions and Domains.
- **Images:** a form can hold several image controls and image lists. Uploads larger than 1280px are scaled down and re-encoded as WebP in the browser, so published pages stay light.
- **Learning Paths editor.**
- **CM Tools** (`generators.js`): a **Resource generator** and a **Gate generator**. They draft Resources by Domain, with Functions chosen through the interaction table, field descriptions, Special Properties and harvesting issues. They also draft whole Gates: concept, Aspect, hazards, landmarks, creatures, a signature Function set, native Resources, and inferred ecology and technology. Everything they produce is an editable draft.

### Deployment and versions

- **Deploy:** `.github/workflows/deploy-site.yml` publishes `public-site/` to GitHub Pages whenever it changes on `main`.
- **Versions:** each deploy becomes a numbered release (`vX.Y.Z`, rules in `.github/versioning.json`, script `.github/scripts/release_version.py`), shown in the site footer. A tag and a GitHub Release are created only after a successful deploy.
- **What's Changed:** `.github/scripts/site_changelog.py` runs with every deploy. It compares the published data of each release since `changelogFrom` (1.0.9) with the release before it, writes `public-site/changes.json` (not in Git) for `changes.html`, and puts the same list at the top of the GitHub Release notes. Only data changes are listed; code-only releases say so.

---

## 5. The game system (Fate with house rules)

The campaign uses **Fate Core**: Aspects, Skills on the ladder (Mediocre +0 to Great +4 and above), Stunts, Fate Points, Stress and Consequences. The house rules below are established on the site. Anything marked *still being designed* is not settled yet.

### The two loops

- **Expedition Loop:** players sign up for a job on the Job Board, and each session has three parts: **Preparation**, **Exploration** and **Return**. During Preparation the crew reads the Archive, chooses each Active Pack, checks its supplies, picks extra Gear within its Carry Limit and considers the Gate's Domain. During Exploration they enter the Gate, learn its rules and pursue the objective. Return records discoveries, newly named Resources, Cores, consequences, rewards, Downtime and the Coin refresh. Jobs are never mandatory; they can be abandoned, fail or be overtaken, and explored places can be revisited.
- **Settlement Loop:** Downtime is spent on Projects, Research and recovery. Their results, and especially their Complications, create new jobs.

Somewhere in each Gate is a **Core**. Recovering the Core collapses the Gate. **No Core may be moved without the Gate Evaluation Committee's explicit authorization**, and closing a Gate that supplies Endros is a public decision: its established supplies start to run down.

### Downtime and Projects

- **Gaining Downtime:** each completed expedition gives **2 Downtime** to those who took part and **3** to those who stayed in Endros. You can hold at most **8**; anything above is lost.
- **Every significant between-session action is a Project Action:**
  1. Spend 1 Downtime.
  2. Describe the approach and the Skill used.
  3. Roll against a difficulty the GM sets for that approach.
  4. Gain Progress: **Fail 0** (plus a Complication), **Tie 1**, **Success 2**, **Success with Style 3**.
- **Limits:**
  - Each character can make **one action per Project between expeditions**.
  - Spending **1 extra Downtime** lets one relevant Outpost **Capability** add its rating to the Progress gained. Only one Capability can support an action, and it doesn't count as a second action.
- **Free actions:** casual roleplay, conversations, buying at the Marketplace and small fictional actions cost no Downtime.
- **Project types:** Personal, Public, Research, Marketplace, Facility, Recovery/Repair, Establish Supply and Spell Innovation. These are one system applied to different goals.
- **Size guidelines:** Minor about 4 Progress, Standard about 6, Major about 10, Grand 15 or more (or several stages). Ambitious Projects need more Progress, Requirements and stages, not higher difficulties.
- **Requirements:** a Resource with given Functions, a Facility, knowledge, a Capability rating, a specialist, a previous Project, an expedition or a free Consequence slot. A missing Requirement **Pauses** a Project without losing Progress.
- **Complications:** new problems rather than lost Progress: an Aspect, a harder next step, a blocking issue, a new Requirement or an expedition objective.
- **Research:** a Project whose goal is an answer. It can reveal partial information, rule out theories, reveal a hidden property or raise new questions. Results become shared knowledge in the Archive.

### Consequences and recovery (replaces Fate's recovery rule)

- **No natural healing:** Consequences never fade over time. A **Recovery Project** lowers one by **one step**.
- **Progress needed:** personal Mild 2, Moderate 4, Severe 6. For the Outpost: Low 2, Moderate 4, High 6, Critical 8.
- **Free slot:** a personal Consequence can only step down into a free slot. Recovering a Severe one needs a free Moderate slot; recovering a Moderate one needs a free Mild slot.
- **Outpost Consequences:** they arise when the settlement's Stress track fills. Their recovery is a Public Project anyone can work on. The Outpost has no slot limits, so its Consequences can always step down.

### Coins, Marketplace and Personal Stash

- **Starting Coins** equal your **Resources** rating (none at +0 or below). Buying costs no Downtime. Gear availability (Common, Restricted, Rare) doesn't change the price; only *Unavailable* items can't be bought.
- **After every expedition, refresh:** if your Coins are below your Resources rating, raise them to it. If you took part, refresh first, then add reward Coins.
- **Personal Stash:** everything you own, including your **Expedition Packs**.
- **Expedition Packs:** a Pack is your carrying setup with a fixed list of ordinary supplies inside (Rope, Lantern, Rations...). One is your **Active Pack**; it sets your **Carry Limit** (6 for every starting Pack), and its contents don't count toward it. Contents get used up, lost or left behind and stay gone until the GM restocks the Pack. Each of the eight Sponsors has its own Pack (e.g. the University Field Pack), listed in its Recruitment Faction rule. Your Sponsor gives you its Pack free at creation; your own Sponsor's Packs cost 0 Coins, other Sponsors' 1 Coin. Owning one of each is enough, since only one is active.
- **Carry modifier:** Stunts or situations can raise or lower the Carry Limit; the sheet records this as a Carry modifier (e.g. +1 or −1).
- **Gear Tags:** Gear has Tags (`Cutting`, `Breaching`, `Loud`, `Magnetic`, `Breathing`...) describing what it can do in the fiction. No numerical bonuses: creatures, hazards and Gates refer to Tags. Weapons have no damage numbers; ordinary ammunition isn't counted.
- **Armor:** protective Gear may have 1–2 Armor boxes. When you'd take Physical Stress the Armor could reasonably stop, mark a box instead; it stays marked until repaired or replaced.
- **Catalogue:** late-Victorian/Edwardian industrial: weapons (Machete, Revolver, Bolt-Action Rifle, Heavy Rifle, Harpoon Gun, Flamethrower...), Tactical & Demolition kits (Dynamite Bundle, Grenade Kit, Smoke Kit, Flare Kit...), Exploration, Scientific Instruments, Communication, Protective Equipment (Heavy Leather Coat, Steel Breastplate, Reinforced Diving Suit), Personal (Cigarette Carton), about 95 items in all. Most costs 0 Coins; weight is the real cost. Limited supplies whose count matters (explosives, Flares, flamethrower fuel, breathing air) come in kits that keep their own count. Every Sponsor Pack has an Expedition Compass (its second needle points to the Gate within range) and Ear Plugs.
- **Supplies and kits:** small supplies (a Ration, a Bandage, a flask of Lantern Oil; also Knife, Canteen, Flint & Steel, Field Notebook, Specimen Jar) are *components*: counted inside Packs, never sold alone. Extra supplies come as weighted kits: Rations Kit (weight 1, Ration ×5), Bandage Kit (weight 1, Bandage ×5), Lantern Oil Kit (weight 1, Lantern Oil ×3). Kits, Rope, Lantern and Bedroll cost 0 Coins. Each kit keeps its own count beside the Pack's.
- **Brought into action:** before an expedition you mark additional Gear from your stash; its weight (how hard something is to bring along, not mass) can total up to your Active Pack's Carry Limit. Extra copies of something the Pack holds count normally.
- **Forgot something?** You can produce an owned item mid-expedition. It costs 1 stress if it fits your Active Pack's Carry Limit, or 1 Fate Point if it takes you over.
- **Personal Project vs Marketplace Project:** a Personal Project makes one item for you. A Marketplace Project makes the item buyable by everyone.

### Recruitment Factions

Every character picks the faction that brought them to Endros. It grants a small **Extra**, its **Expedition Pack** and roleplay hooks, but doesn't decide profession or Skills. **A Recruitment Faction means sponsor, not nationality**: a character's homeland can differ (a Vardic engineer sponsored by the University, a Vernan scholar who is Independent). There are eight. The three below come from Endros itself; the five major powers (Vardic Holds, Aurelian Empire, Vesper Republic, Kharad Compact, Tianzhao Mandate) are listed in section 6, *Factions*. Each has a rule on the Recruitment Factions learning path with Lore, Recruitment Extra, Expedition Pack and Expectations sections. Choosing a Sponsor on the character sheet grants its Pack and writes its Extra into the sheet's Extras. Expectations are roleplay hooks and possible Compels, never automatic penalties.

| Faction | Extra | Expectations |
| --- | --- | --- |
| **Nowhere Expeditions (the company)** | *Relocation Package:* +1 Coin after each expedition you take part in (added after the Resources refresh). | Stay active, honour your contract, appear in promotional material, let the company take its commissions. |
| **University of Verna** | *Institutional Access:* once between expeditions, +1 Progress on a Research Project Action the University could plausibly help with. | Submit research, share samples, publish findings, assist University staff. |
| **Independent** | *Self-Directed:* once between expeditions, +1 Progress on a Personal Project Action. | None, but no contacts or support either. |

### Outpost Capabilities

The six Capabilities: **Industry** (crafting, repairs, manufacturing), **Research** (investigation, analysis, Gate knowledge), **Commerce** (trade, funding, access to resources), **Security** (defence, policing, emergency response), **Medicine** (treatment and recovery) and **Infrastructure** (facilities, transport, services).

Each can support one Project Action for 1 extra Downtime, can serve as a Requirement, and changes through Facilities, Projects and Consequences. **Facilities** are built through Public Projects and mostly unlock new possibilities rather than add numbers.

### Domains

Every Gate has a **Domain** (rarely two, such as `Frozen + Constructed`), which its Resources, creatures and hazards inherit. A Domain gives no bonus by itself. It's a keyword that Stunts, equipment, specialisms, spellcasting specialities, Projects and Preparation can refer to.

Ordinary trade materials from the wider world (e.g. Bloom Iron from the Holds, Purified Alum from the Compact) are catalogued with their **origin**, the culture they come from, in place of a Domain. The five origins are the five major powers. An origin is not a Gate environment, and no Gate has one. Discoveries lists them as "Trade origins".

| Domain | Description |
| --- | --- |
| **Verdant** | Biologically dense places dominated by strange growth: forests, wetlands, fungal systems and other highly active life. |
| **Volcanic** | Heat, geothermal activity, magma, ash, mineral pressure and intensely energetic geology. |
| **Abyssal** | Deep water: submerged, high-pressure, lightless, oceanic or otherwise deep and hostile places. |
| **Arid** | Dry places: deserts, salt flats, exposed stone, desiccated caverns and mineral wastes. |
| **Frozen** | Ice, snow, extreme cold, cryogenic conditions and unusual preservation. |
| **Constructed** | Places that were clearly built: machine worlds, ancient complexes, artificial ecosystems and megastructures. |

### Resources

A **Resource** is a catalogued material: usually something recovered from a Gate, and sometimes an ordinary trade good from the wider world. **Whoever discovers it names it.**

- **Specimens first:** anything brought out of a Gate is a **Specimen** until studied, then filed as Discarded Material, Research Specimen, Artifact, Resource Candidate or Confirmed Resource (at least one Function identified). Old Specimens can be re-studied when new discoveries give a reason.
- **What a Resource has:**
  - a description (fiction);
  - a Domain (or, for a trade good, an origin);
  - **Functions** (what it can do; most have one to three);
  - an optional **Special Property** (odd behaviour too specific to be a Function);
  - an **Availability**: *Sample* (enough for Research), *Limited* (enough for one Project) or *Available* (a dependable supply);
  - **Word Stress** for spellcasters: 1–4 boxes per known Function, listed in Discoveries (NO DATA until set).
- **Hidden Functions:** some stay hidden until Research reveals them.
- **Establish Supply:** a Public Project makes a Resource more available. If its source Gate closes, the Project pauses and an Available Resource slowly becomes Limited as stockpiles run down. An established supply needs no upkeep.
- **Unavailable:** a Resource is unavailable when its supply runs out or its source is lost.

### Resource Functions (the shared vocabulary)

Functions are verbs: exceptional, exploitable properties rather than descriptions. Ordinary materials have none.
- Projects ask for Functions rather than named materials.
- Effects are combinations of Functions. The interaction table in the Discoveries Functions explorer is the source of truth (GM ruling, 13 Oct 2026); rules point to it rather than keeping their own combination tables.
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

### Spellcasting (partly designed; reworked 13 Oct 2026)

**Artificery studies Functions embodied in matter; Spellcasting manifests the same Functions directly as magical Words.** Magic is a new experimental science (the "Era of Magic"): book-dependent, specialised and inconvenient on purpose; simplifications are discovered in play. Rules: Spellcasting, Runes, Base Forms, Forms, Spell Innovation.

- **Words:** Functions manifested as magic. A manifested Word has **Word Stress** (capacity Forms draw on) and lasts until the end of the scene or until its Stress runs out.
- **Runes:** Gate artifacts that each supply one Word; a caster with the Rune can cast a Form without knowing its Base Form. A used Rune goes **inert** (stays physically present). Nobody can make Runes; Rune research is open to players.
- **Base Form: [Word]:** a Stunt per Word (never "Basic Form"). Casting = a mental calculation using celestial/real-world parameters + a vocalisation; needs the spellbook. Own roll; the result sets the Word's Stress. Discovered *after* the first Forms.
- **Forms:** each a Stunt. First (1 Word), Second (2), Third (3). Physical technique (caster must be unrestrained); own roll, usually Overcome. Magic gives **permission** for otherwise impossible actions; on already-possible actions it gives **leverage** +1/+2/+3 by tier, never automatically.
- **Recorded Forms:** Effect Glowing (`Glow`), Simple Sauna (`Heat`), Kinetic Shove (`Move`), all First Forms.
- **Base Form roll (decided 13 Oct 2026):** Lore (a Stunt can swap the Skill for one Word) vs Fair (+2), GM adjusts. Fail no Word, Tie 1 box, Success 2, Success with Style 3. Once per Word, 1 Fate Point adds the Skill rating in boxes, even on a Fail. One Word per roll; no cap on Words held.
- **Form cost:** set per Form (`cost` on the Form record, default 1), marked on each of its Words. Extra boxes buy scope only, never a roll bonus.
- **Runes:** power exactly one Form cast (whole cost), then go inert.
- **Resources:** a Resource supplies the Word for each of its known Functions, with 1–4 boxes each (shown in Discoveries; `wordStress` in the CMS, NO DATA until set). Casting through one is +1 difficulty; you need the Resource with you; each Word clears 1 box per scene and fully between expeditions. Hidden Functions supply nothing.
- **Order of discovery (canon):** Runes first, then the first Forms (worked out with Runes), then the vocabulary of Words, and only last Base Form. Practical spellcasting is a few years old.
- **Learning (Progress):** learn Base Form 6 / First 4 / Second 6 / Third 10; invent First 6 / Second 10 / Third 15. Magical Stunts from Projects cost no Refresh.
- **Self/Object/Scene hosts:** under review, may be dropped.

The CMS Form tier key is `base` (`basic` is still accepted and converted). Rules can use `layout: "cheatsheet"` (the **Rules at a Glance** page: `###` sections render as numbered cards, `##` as groups, "(House rule)" in a heading becomes a badge, with a Print button).

### Skills

The **Skill List** rule uses the standard 18 Fate Core skills and the standard pyramid (one Great +4, two Good +3, three Fair +2, four Average +1).
- **Stress boxes:** Physique sets Physical stress and Will sets Mental stress. That is 2 boxes at +0, 3 at +1/+2, 4 at +3/+4, and at +5 or more 4 plus an extra Mild Consequence slot.
- **Campaign uses:** Resources sets starting and refreshed Coins, Lore casts Base Forms and drives Research, Investigate drives Research, and Crafts covers most crafting (the Vardic Extra uses it).
- **Which skill a Project Action uses** depends on the approach, not on the Project.

### Learning paths (how the rules are read)

| Path | Rules | Read it when… |
| --- | --- | --- |
| **Onboarding** | Nowhere Expeditions, Creating an Expeditioner, Expeditions, Downtime, Coins, Marketplace & Personal Stash, Gear Tags & Armor, What's Next | Before your first expedition. |
| **Recruitment Factions** | all eight Sponsors: the Company, University of Verna, Independent, Vardic Holds, Aurelian Empire, Vesper Republic, Kharad Compact, Tianzhao Mandate | Creating a character. |
| **Between Expeditions** | Projects, Project Requirements & Complications, Research, Consequences & Recovery | First time spending Downtime. |
| **Gates & Discoveries** | Domains, Resources, Resource Functions | The crew brings back something new. |
| **Crafting & Artificery** | Material Engineering, Personal Stash & Crafting | Building gear or inventing materials. |
| **Spellcasting** | Spellcasting, Runes, Base Forms, Forms, Spell Innovation | The character studies magic. |
| **Building Endros** | Outpost Capabilities, Facilities & Outpost Development, Marketplace Development | Helping the settlement grow. |
| **Quick Reference** | Rules at a Glance, Skill List | Looking something up at the table. |

The pinned announcement **JOIN NOWHERE EXPEDITIONS!** (the game listing) is the entry point. Onboarding page 1 sends new players to it first. *Creating an Expeditioner* also gives lore-reading advice per character type ("only read what your character would know") and embeds the Name Generator.

---

## 6. Established lore (canon)

Everything here is published on the site. Where a detail isn't established, it is left out rather than guessed.

### The setting

- **The Valeoran Ruins** were discovered **11 years ago**, at the far ends of an uncharted horizon, by a **University of Verna vessel** taking oceanographic measurements far from any trade route or shore. Fragments of an ancient wonder rise from the sea and reach high into the sky, **suspended and drifting in place over an unnaturally still ocean**.
- **The names are borrowed:** University scholars named the Ruins and the settlement after an old myth from the Old Scholastic Coast, about **Valeor**, who held Sea and Sky apart, the mortal seafarer **Maera**, and their son **Endros**, who sailed into the unknown in search of his father and never came back in any way that answered the question. *Valeoran* means "evocative of Valeor", **not** "built by Valeor". Nothing links the builders to the myth.
- **Endros** has grown around the ruins: floating platforms, laboratories, workshops, shipyards and habitation blocks. It is a rapidly growing settlement so remote that newspapers call it *"Endros in the Middle of Nowhere"*, *"Endwhere"* or just *"Nowhere"*. It is the expedition hub: every expedition starts and ends there.
- **Gates:** several years after the discovery, researchers saw parts of the ruins **begin to move, gathering together to form temporary portals**. What lies beyond them varies widely: ruins, unknown ecosystems, impossible machinery. They are strange places where familiar rules no longer apply, holding resources found nowhere else in the known world.
- **Cores:** somewhere in each Gate is a **Core**. Every known Core looks the same: an enormous, nearly perfect white sphere about the size of a small automobile, iridescent, floating unsupported inside an aurora-like play of light. The name is historical, not descriptive. The one established fact is that **removing a Core through its Gate collapses the Gate**. The working hypothesis is that a Gate stays open as long as its Core stays inside; that is "evidence, not proof". One Core has been recovered and is held in secured storage. What Cores are is unknown.
- **Artificery:** materials recovered from Gates have created an entirely new field of technology.
- **Magic:** more recently, researchers have begun documenting something even stranger. The Gates and what comes out of them (Cores and materials) are the world's **only known source of magic**. Newspapers call this new age **"the Era of Magic"** (see *The Era of Magic* below).
- **The central mystery:** the origin and purpose of the Gates, the Cores and the ancient ruins. No answers have been established. Do not invent them. Each faith reads the Ruins its own way (the Vardic Nameless King theory, Tianzhao Spirit and Celestial realms, First Light order or revelation); these are published as beliefs and speculation, never as fact.
- **Expeditioners** are the specialists who come to Endros, form crews and go through the Gates for knowledge, materials, artifacts, money and answers. They include researchers, engineers, physicians, sailors, security personnel, salvagers, artificers, surveyors, cartographers, medics, linguists, riggers, cooks, mechanics and Gate scholars. Most are recruited from abroad.

### The Outpost: Endros Research Outpost

The settlement's sheet, played as a shared Fate character:

- **High Concept:** *From Archaeological Outpost to Gateway Industry*
- **Trouble:** *Everything We Need Comes by Ship*
- **Aspects:** *Built Fast, Built to Work* · *Everyone Came Here for Something* · *No Expedition Without Evaluation and Clearance*
- **Stress:** 0 of 3.
- **Consequences:** one Low, ***Strained Harbour***: the harbour and the supports beneath the platforms were built fast and worked hard; cracked moorings, overloaded cranes and patched supports slow every delivery. Recovering it is a Public Recovery Project (2 Progress), supported by Industry or Infrastructure.

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
| **Gate Evaluation Committee** | Founded by the University of Verna, now independent with members from all the factions. Evaluates new Gates, keeps classifications and records, clears expeditions and rules on exploration and containment. (Compare the Aspect *No Expedition Without Evaluation and Clearance*.) |
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
- **Gate Evaluation Committee:** see *Who runs Endros* below.

### Who runs Endros

*Officially* the University of Verna; *in practice* authority is split three ways:
- **The Ruins:** the University's **Department of Archaeology** answers for the Valeoran structures. Work on them needs its written approval, and fragments are "not salvage, ballast or souvenirs".
- **The Gates:** the **Gate Evaluation Committee** answers for these.
  - **Seats:** the University founded it, but it is now an independent body with one member for each of the six powers (Vardic, Aurelian, Vesperian, Kharadi, Tianzhao, Vernan). The chair rotates.
  - **Working bodies:** unvoting **evaluators** do the analysis and briefings, and a **classification sub-committee** reviews classifications.
  - **What it sets:** each Gate's classification (*emerging, active, restricted, quarantined, dormant, collapsed, sealed, lost*) and the terms of entry. Every notice says *"a classification … is not a statement of safety"*.
  - **How it decides:** it prefers to wait until no member objects strongly.
  - **What isn't public:** its voting rules and the terms of its independence.
- **The settlement:** **nobody** runs it. There is no council or mayor, only competing agendas:
  - **Aurelia** offers standards and record-keeping, claiming no sovereignty.
  - **Kharad** finances, insures and argues salvage claims.
  - **Vesper** works through its societies for open knowledge.
  - **Tianzhao** keeps its own enclave, the Pavilion of Celestial Affairs.
  - **The Vardic Holds** look after their own workers.
  - **The company** keeps people arriving and expeditions running.
- **Unsettled:** who *owns* what crews bring back. The Committee decides whether a Core may be moved, not whose it is afterwards.

**The Gate Evaluation Doctrine.** Drafted after Gate Four by Senior Evaluator **Anselm Hartree**, it sets out ten working assumptions, heard at every new Expeditioner's first briefing:
1. A Gate may stay stable indefinitely if its Core stays beyond the threshold.
2. No Core moves without explicit authorization.
3. Initial safety doesn't imply long-term safety.
4. Permanent structures may alter local conditions.
5. Native life may react differently to repeated presence.
6. Returned materials may stay hazardous.
7. Everything recovered is a **Specimen** until evaluated.
8. A Specimen becomes a **Resource** only once useful anomalous properties are confirmed.
9. Unknown material shouldn't be assumed worthless.
10. Nor should it be assumed safe.

### The Gates on record

Endros has **one recovered Core, one closed Gate, one occupied Gate, one hostile Gate and one quarantined Gate**, and no explanation of what the Gates are. Each taught a lesson; the lore entry *The Gate Evaluation Doctrine* traces each working assumption back to them.

| Gate | Domain | Status · Core | What happened |
| --- | --- | --- | --- |
| **G-01, the White Expanse** | Frozen | collapsed · recovered | A still frozen plain under a pearl-white sky. The first confirmed Gate; its Core was hauled out without understanding, and the Gate closed behind it (report G-01-17, no casualties). Its Resources are all there will ever be. *Lesson: discovery, and the oldest rule in Gate work.* |
| **G-02, the Green Vault** | Verdant | active · located (left in place) | A warm, humid ecosystem inside what looks like an artificial structure. The Core was deliberately left; the University's forward laboratory **the Greenhouse** has operated beside it ever since. Access controlled. *Lesson: a Gate can be a place to work.* |
| **G-03, the Red Forest** | Verdant | restricted · located (~9 km in) | A cool, dark crimson forest. **Forward Station Three** worked for four months until coordinated-seeming attacks by several species (to continuous Bell-Throat calls) forced a night evacuation: four seriously injured, one missing, presumed dead. Fauna: Redbacks, Bell-Throats, Thorn Walkers, needle mites, an unidentified tree-damaging organism. *Lesson: "A survivable environment is not necessarily an occupiable environment."* |
| **G-04, the Yellow Mire** | Verdant | quarantined · not located | A warm amber wetland with no large animals. Returned equipment rotted; illness (fevers, yellow branching marks) reached people who never crossed. The first Gate classified as a threat to Endros; no authorised entry since, nothing may leave (order G-04-12). *Lesson: danger can follow a crew home.* |

### Resources on record

27 Resources are catalogued in Discoveries (Hidden Functions are not listed here or on the site):
- **From the Gates (12):**
  - *White Expanse:* Paleglass (`Dampen`, `Store`), Whisper Ice (`Record`, `Resonate`), White Thread (`Reinforce`).
  - *Green Vault:* Lantern Pollen (`Glow`, `React`), Raincap Gel (`Absorb`, `Store`), Vaultvine Fibre (`Flex`, `Reinforce`). Two of these are dependable supplies in the Workshops.
  - *Red Forest:* Redbark (`Regenerate`, `Reinforce`), Bellbone (`Amplify`, `Resonate`), Hunter's Moss (`Sense`, `React`).
  - *Yellow Mire:* Amber Reed (`Filter`), Ghost Membrane (`Dampen`, `Filter`), Mirefilm (`Corrode`, `Adapt`).
- **Trade goods (15)**, ordinary materials catalogued by origin, with no Functions:
  - *Vardic Holds:* Blackpine Resin, Hearth-Ox Sinew, Bloom Iron.
  - *Aurelian Empire:* Admiralty Wool, Greyhold Cork, Refractory Fireclay.
  - *Vesper Republic:* Glassvine Sap, Signal-Moth Silk, Line Copper.
  - *Kharad Compact:* Caravan Felt, Date-Palm Resin, Purified Alum.
  - *Tianzhao Mandate:* Celestial Silk, Porcelain Kaolin, Registered Tea.

### The Era of Magic

Before the Gates the world had no magic. The order of discovery matters, because it isn't the order a textbook would choose:
1. **Runes**, Gate artifacts that could trigger impossible effects, were found and used before anyone understood them.
2. **The first Forms.** Professor **Manhattan R. Wylde** of the University of Verna demonstrated **Effect Glowing**, using runic markings painted on the wrists. Its publication set off a rush. **Simple Sauna** followed, first performed around a symbol drawn on the floor by a Vardic team working in the University's facilities, independently of Effect Glowing. **Kinetic Shove** was developed from the Effect Glowing paper.
3. **The Vocabulary Breakthrough.** Comparing Forms with Runes isolated the **Words**, which turned out to be the artificers' **Functions**.
4. **Base Form**, casting without a Rune through a calculation and a sound, came last. That is why spellbooks look like star tables.

Universities, independent natural philosophers, industry, governments and Expeditioners are all in the field; the University is prominent but not alone. The powers' attitudes clash over who gets to know a new Form (Aurelia: responsible administration; Vesper: *No Crown Owns the Impossible*; the University: publish what is true, think hard before publishing instructions).

Still open: why Words work at all, what a Rune is, whether a used Rune is finished, whether anyone can *make* one, and which steps of early techniques are really needed.

### Characters (published)

- **Palava Bansz** (player: *Jack The Wizard*), active, sponsored by the **University of Verna**. Bookworm middle child of the noble **Bansz** family; a doctoral candidate at the University uncovering the new Magic, strong at magic and deciphering foreign languages. Professor Wylde is her doctoral supervisor.
  - **Aspects:** *Sleepy (will nap and wrap up in blankets at any chance)* · *Feverish: feels cold all the time, frail* · *Childishly manipulative* · *Well researched on the new "Magic"*.
  - **Top skills:** Lore +4, Deceive +3, Investigate +3.
  - **Stunts:** *Wikipedia* (an eldritch knowledge book that looks up nearly any topic), *Magic User* and *Magical Fluency*.
  - **Spells:** her sheet still uses a provisional, D&D-style spell list (cantrips such as Fire Bolt, Mending and Prestidigitation; 1st-level Shield, Burning Hands and Feather Fall). This predates the Words-and-Forms design and needs reconciling with it.
- **Known Figures (NPCs):**
  - **Anselm Hartree:** Senior Evaluator of the Gate Evaluation Committee. Vernan, University-trained, one of the first evaluators; drafted the Doctrine and still gives the first briefing. Known for *"Evidence, not proof."*
  - **Manhattan R. Wylde:** University of Verna professor and discoverer of Effect Glowing. Asked whether ordinary people could learn it: by anyone with patience, a steady hand and access to a Rune, *"which is to say, at present, almost nobody."*

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
| **Specimen** | Anything brought out of a Gate before it has been evaluated. |
| **Rune** | A Gate artifact that supplies one Word for one cast, then goes inert. |
| **Base Form** | A Stunt to manifest one Word yourself; *base* as in foundation, never "basic". |
| **Gate Evaluation Committee / the Doctrine** | The six-power body that classifies Gates and clears expeditions / its ten working assumptions. |
| **The Greenhouse / Forward Station Three** | The University laboratory inside G-02 / the evacuated station in G-03. |
| **Trade origin** | The culture an ordinary trade-good Resource comes from, used in place of a Domain. |
| **Domain** | A Gate's kind of environment. |
| **Downtime / Project Action / Progress** | Between-session time / one unit of work / filling a Project's track. |
| **Recruitment Faction** | Who brought a character to Endros. |

### Factions

Six world factions are published on the Factions page, and the five major powers have Recruitment Faction rules (Verna's sponsor is the University). Their content comes from the *Factions Site Integration Guide*, expanded since by lore that is now summarised on each faction's page (history, government, beliefs and folklore, visual identity). The artwork in `artwork/` (gitignored) supplies their flags, homelands and clothing references. The art files say `valdic-holds`, but the canonical name is **Vardic Holds**.

| Faction | Identity | Recruitment Extra |
| --- | --- | --- |
| **Vardic Holds** | A loose federation of industrial northern jarldoms valuing craftsmanship, reputation, self-reliance and deeds worth remembering. Old Gods of the Holds (Fate, Making, Memory). | *Built to Endure:* once per session, a tie on a Crafts advantage to repair, reinforce, modify or improvise equipment counts as a success with a free invoke. |
| **Aurelian Empire** | A powerful maritime empire of navy, bureaucracy, standardization and etiquette; power creates responsibility. Faith of the First Light, Aurelian Communion (the Crowned Sun). | *Properly Provisioned:* once per session, bring one Stash item into action without the Stress or Fate Point cost. |
| **Vesper Republic** | A young revolutionary republic of citizenship, public argument and inquiry; resists monopolies over magical knowledge. Vesperian Communion (the Sacred Flame). | *Someone Knows Someone* (working design): once per session, a reasonable, useful contact through the sponsor or its societies: information, an introduction or limited help, never solving the main problem. |
| **Kharad Compact** | A league of mercantile city-states, banks, merchant houses and treaty networks prizing agreement, reputation, patient negotiation and honest measure. Covenant of the One. | *Established Credit* (working design): an extra Mild Consequence slot, **Minor Obligation**. Instead of paying up to 2 Coins, someone covers the cost and the debt is written there; it clears when you complete a Project and give its result to the Compact. |
| **Tianzhao Mandate** | An ancient bureaucratic civilization of harmony, long-term consequence and celestial order; first read the Gates through its Spirit and Celestial realms. | *Restorative Care:* once between expeditions, +1 Progress on a Recovery Project for your own Consequence. |
| **Verna** | A small independent republic neighbouring Vesper, home of the University of Verna; shaped by scholars fleeing the Silencing of the Schools. | The Recruitment Faction is the **University of Verna** (published); being sponsored by it is not the same as being Vernan. |

Religions cross faction lines: the Faith of the First Light is shared by Aurelia and Vesper, and minor First Light communities live in the Holds. Fringe beliefs are published as beliefs, never as facts.

### The lore library

The lore was restructured on 21 October 2026 (GM decision), because it had spread over too many long entries and readers got lost:

- **Faction pages are the central overviews.** Each faction's page (about 1,000–1,200 words) carries everything general about it: history, government, beliefs and folklore, visual identity and relations.
- **The Archive is an encyclopedia of one-subject entries.** Each entry's title is one term, person, place or historical event, and its text explains exactly that (usually 150–350 words, at most one short scene).
- **Detail grows from play.** The 31 earlier long entries (faction histories, societies, faiths and folklore, the Silencing of the Schools, the Gate and magic histories) are unpublished drafts in the manager; their canon now lives on the faction pages and in the entries below. New detail entries are written when players' backstories or expeditions need them.

Lore entries about the world outside the factions:

| Entry | Kind | What it is |
| --- | --- | --- |
| **The Valeoran Ruins** | Place | The suspended ancient structures where the Gates form; the Department of Archaeology's authority; why the name is a designation, not an identification. |
| **Endros** | Place | The settlement around the Ruins, named for Valeor's son, run in practice by nobody. |
| **Valeor, Maera and Endros** | Folklore | The Old Scholastic Coast myth behind both names. |
| **Gates** | Term | Portals into other worlds formed by moving parts of the Ruins; designations and classifications. |
| **Cores** | Term | The floating white spheres inside Gates; removing one collapses its Gate. |
| **Specimens** | Term | Everything brought back, until evaluated; the five filing categories. |
| **The Gate Evaluation Doctrine** | Term | The ten working assumptions, and which Gate taught each. |
| **The Gate Evaluation Committee** | Institution | The six-power body that classifies Gates and clears expeditions. |
| **The Era of Magic** | Event | The few years since magic began, and the order of discovery. |
| **Runes** · **Words** · **Forms** · **Base Form** | Term | The four building blocks of spellcasting: Gate artifacts that supply a Word; the underlying elements (the same as Functions); learned techniques (the first three: Effect Glowing, Simple Sauna, Kinetic Shove); manifesting a Word without a Rune. |

The four Gate Records (G-01 to G-04) sit beside them. For anything beyond these summaries, read the published records themselves in `public-site/data/`.

---

## 7. Sample (placeholder) content: NOT canon

The database still holds **sample** records used to test layouts. They are hidden from the live site and **must not be treated as lore**. Some reuse names that now mean something else: the sample "Silt Choir G-03" is not the real G-03, the Red Forest.

- **Archive:** 16 sample entries, including Gate Records (The Silt Choir, Glass Verge, The Lantern Reef, The Hollow Orchard, The Brass Tide), session records, newspapers and lore ("Founding of the Outpost", "Harbor Ring Anomaly"…).
- **Jobs:** 12 sample jobs (e.g. Saltglass Survey, The First Descent).
- **Characters:** 9 sample characters (e.g. Ilse Markov, Doctor Enna Hale, Teodor Quell, Sample Expeditioner).
- **Other records:** 13 sample Gear items, 9 sample Game posts, 3 sample Projects (Harbor Reinforcement, Gate Mapping Sweep, Ruin Stabilization) and 3 sample Facilities.
- **In rules text:** example characters (Mira, Tomas, Ines, Nell, Odile, Yusra) and their projects are illustrations, not established world facts. Example materials in rules always use Resources that exist in Discoveries, with their public Functions only (checked 13 Oct 2026).

**Published real content (14 Oct 2026):**
- **Records:** 4 Gates, 27 Resources, 3 spell Forms, about 95 Gear items, 8 Expedition Packs, 6 factions (each with its central lore overview) and 13 one-subject lore entries (from 21 Oct 2026; replacing 29 longer ones).
- **Characters:** 3 (Palava Bansz and two Known Figures).
- **Not yet published:** Jobs and Projects.

---

## 8. Known gaps and inconsistencies

- **Undesigned spellcasting details:** where a Word is manifested (self, object or scene) is under review; the GM rules case by case.
- **No Jobs on the Job Board yet:** the first jobs are part of the "Site Content Authored" milestone.
- **Old wording in `instructions.md`:** it describes "an industrial Island built around enormous ancient floating ruins". The published canon describes Endros as floating platforms around ruins over a still ocean. Update `instructions.md` (and its "Island Sheet", "Expedition Board" and "Gate Archive" sections) to the current terms.
- **Palava Bansz's spell list:** it uses D&D-style spells rather than Words and Forms.
- **Working designs:** the Vesper (*Someone Knows Someone*) and Kharad (*Established Credit*) Extras are marked as working design in their rules.
- **Factions brief, Phase 3** (relationship visuals, faction nodes in the connection graph, Marketplace origins, NPC and Job faction links) is not built.
- **Capability ratings:** they are all +0 except Infrastructure +1. This is the starting state, not a placeholder.

---

## 9. Working on the project (for agents)

- **Read `instructions.md` first.** The site is **player-facing**: never put GM secrets into `public-site/` or this file. When unsure whether something is public, ask.
- **Don't invent lore or mechanics.** Distinguish standard Fate, established house rules, proposals and examples. Mark undefined things as undefined.
- **Lore format:** general faction lore goes on the faction page; an Archive lore entry covers exactly one term, person, place or event. Rewrites of existing records go in as proposed revisions (Versions) for the GM to review, never straight over the live text.
- **Content lives in the database.** Don't hand-edit `public-site/data/*.json`. Change content in the content manager, then Sync.
- **Keep the site simple:** static files, vanilla JS, no build step. Pages must work on phones. The content manager only needs to work on a desktop.
- **Run the tests** after changing `content-manager/app.py`, and restart the manager to pick up code changes.
- **Repository practices:**
  - Line endings: the repo stores LF, and the Windows checkout uses autocrlf.
  - Commits: commit to a branch and open a PR to `main`. Deploys run on `main`.
- **Local URLs:** the site is served at <http://127.0.0.1:8000> (it must be served over HTTP, not opened as files) and the manager at <http://127.0.0.1:8001>.
