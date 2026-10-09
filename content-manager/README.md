# Nowhere Expeditions Content Manager

A local, SQLite-backed editor for the campaign data published by `../public-site`. It runs on Python's standard library and does not add a framework, login system, or deployment requirement to the static site.

## Start

From this directory, run:

```powershell
python app.py
```

Then open <http://127.0.0.1:8001>. The first launch imports the existing public JSON into `content.db`. The manager binds only to `127.0.0.1`.

## Content model

```
Outpost Sheet (single record)
 └── capability contributing assets ──> Facility | Character

Job ──> Session Record (an Archive entry of type session-record, optional)
 └── organizer, participants ──> Character

Archive entry (gate-record | session-record | newspaper | history | folklore)
 └── participants (session records only) ──> Character

Character ──< Stash entry ──> Gear

Project ──> characters
 ^── Facility, Gear ("brought into the game by")
```

- **Outpost Sheet**: the shared settlement "character" (formerly the Island Sheet): aspects, capabilities, stress, and consequences. Each capability's **Contributing assets** is an ordered list of facilities and characters, picked from a menu; a facility or character that is still assigned cannot be deleted.
- **Facilities**: what the Outpost has (name, the service it provides, optional Markdown details). A facility decides whether a service exists at all; the capability it supports rates how well the Outpost performs it. Facilities are published inside `outpost.json`, each with the capabilities it supports, and shown as a table on the Outpost page (`outpost.html#facility-<id>` links to a row).
- **Projects**: work the GM and players agree on: a progress track (marked boxes out of a total), prerequisites (a checklist, each ticked when met), and the expected outcome. **Complications** are listed with a *Resolved* checkbox and how they were resolved: an active one frames the project in red with a **!** badge on the site, and resolved ones stay in a collapsible complication history. A project that never had one shows none of this. **Access** is *open* (anyone may join) or *private* (only its characters). A project is **completed** when every box is marked. An **Outpost project** is shown on the Outpost page while ongoing; every character listed shows it in a **Projects** tab on their page, split into ongoing and completed. Facilities and Gear can name the project that brought them into the game.
- **Characters**: player characters and NPCs (name, type, status, portrait, summary, player name). A character can have an optional **Fate Core sheet** with its own **Show this sheet on the public site** switch, and a **Stash**: references to Gear with a quantity and a **Brought into action** flag. The stash editor has two tabs, *My Stash* and *Marketplace*; adding Gear that is already owned raises its quantity instead of creating a duplicate. Removing an entry never deletes the Gear. A character also has a **Sponsor** (a Recruitment Faction rule ticked as *Sponsor*) and **owned Expedition Packs** (see below).
- **Gear Tags, categories and Armor** (schema v13): `tags` are Gear Tags (Cutting, Breaching, Loud...), picked from the suggested groups in `GEAR_TAG_GROUPS` or added freely; they carry no numbers. Players see them, so a Tag may not share a name with a Resource Function: such words go in **GM tags** (`gmTags`, CM only, never exported). Clashing Tags (including ones created later by a Function vocabulary change) are moved to GM tags automatically. Categories: weapon, tactical, exploration, scientific, communication, protective, medical, supplies, personal, special (older armor/tool/consumable/utility are migrated). `armorBoxes` (0–4; ordinary Armor 1–2) makes Gear Armor; a stash entry's `armorMarked` (column `character_stash.armor_marked`) stays until set back to 0 (repaired). The rule lives in the Game post `gear-tags-and-armor` (Onboarding).
- **Components and bundles** (Gear fields `marketplaceVisible` and `contents`): Gear with *Marketplace visible* off is a **component** (one Ration, one Bandage): it can be listed in Packs and bundles and tracked there, but it isn't listed in the Marketplace and can't be added to a stash (the server refuses it, so weightless supplies can't be piled up). A **bundle** is Gear whose `contents` lists other Gear with a quantity (Rations Kit, weight 1 → Ration ×5); bundles may nest but no Gear may end up containing itself, and Packs never go inside Gear. A stashed bundle keeps `used` ([{gearId, quantity}], column `character_stash.used`, schema v12) so each kit has its own count beside the Pack's. Pattern: component → bundle (Marketplace, weighted) → Pack (built from components).
- **Expedition Packs** (`packs`): a Pack definition has a name, description, Sponsor, *starting Pack* flag (one per Sponsor), Carry Limit (default 6), price (default 1), Sponsor price (default 0), availability, image, featured flag, sort order and **contents**: Gear references with a quantity (never free text, and never another Pack). A character owns Pack *instances* (`packs` on the character: `{id, packId, active, contents: [{gearId, quantity, capacity}]}`), at most one active. An instance keeps its own remaining quantities; editing the definition never refills it, **Restock** in the character editor does. Saving a character with a Sponsor and no Pack gives them the Sponsor's starting Pack (this is also the migration path for older characters). Exported as `data/packs/` and `data/sponsors.json` (Sponsor → starting Pack). Rules show a Sponsor's Pack with `{{expedition-pack}}` on its own line.
- **Jobs**: the Job Board. A job has a type (`expedition`, `recovery`, `investigation`, `escort`, `bounty`, `outpost`, `other`), a status (`open`, `scheduled`, `in-progress`, `completed`, `failed`, `cancelled`), summary, objective, briefing, schedule, crew limits, organizer, participants, and optionally the **Session Record** describing what happened when it was played. Jobs do not need a Gate; lore is linked from the briefing.
- **Archive**: one general lore model. Every entry has a type, title, subtitle, summary, content, author, published date, event date (free text), image, and tags. Type-specific metadata lives in `details`: Gate Records keep designation, Gate status, discovery date, environment, and known traits, hazards, and locations; Session Records keep a session date and outcome, plus participants. New types can be added in `ARCHIVE_TYPES` (app.py and both front ends) without changing the schema.
- **Gear**: the Marketplace catalogue: name, category, description, price, weight, availability (`common`, `restricted`, `rare`, `unavailable`), image, tags, **featured**, an optional promotional label (e.g. NEW, LIMITED), and an optional discount (`{active, salePrice}`; the regular price stays in `price`). The Marketplace is informational: nothing is bought or charged.
- **Game**: out-of-character posts. `type` is `announcement` (posted date, optional **Pinned** and **Show until** date) or `rule` (category). Pinned announcements are listed first on the public Game page, and the newest pinned one appears as a banner on the Overview. Announcements past their show-until date are hidden on the site but stay in the manager. Rules from before schema v5 move into Game automatically as `rule` posts, keeping their IDs; the originals are kept in `legacy_records`.

Structured references are stored as IDs in SQLite foreign-key columns and link tables (`jobs.session_record_id`, `job_participants`, `archive_participants`, `character_stash`). Reverse relationships (a Session Record's Job, a Gear's owners, what links to an Archive entry) are derived, never stored. A record that is still referenced cannot be deleted; the manager lists what refers to it.

### Links between records

Authored text (Archive summary and content; Job summary, objective, and briefing; Game summary and details; Gear descriptions) is **Markdown**: CommonMark plus tables and `~~strikethrough~~`, rendered on the site by the vendored [markdown-it](https://github.com/markdown-it/markdown-it) (`public-site/vendor/`, MIT). Single line breaks are kept, raw HTML is shown as text, and `javascript:` links are refused. `#` headings start one level below the section they sit in. On top of Markdown, `[[entry-id]]` or `[[entry-id|link text]]` links an Archive entry; other pages use normal links such as `[text](jobs.html#e-17)`. The editor lists every Archive link in a record and flags missing or unpublished targets. On export, links to unpublished entries become plain text so their IDs never reach the site.

### Explore mode

Each Archive entry has **Explore connections**, which opens `archive.html#explore/<archive|job|character>/<id>`: the record in the center and everything connected to it on a ring around it. Connections are derived when the page loads, never stored: `[[archive-id]]` and `[text](jobs.html#id)` links in text (both directions), a Job's Session Record, Session Record and Job crews, and Job organizers. Archive entries are filled circles colored by type, Jobs are diamonds, Characters are outlined circles; Jobs and Characters can be hidden with toggles. Clicking a node re-centers on it, and the same connections are listed as text below the graph.

### Dice

`public-site/dice.js` rolls Fate dice (4dF + modifier) for skills on public and editable sheets and for Outpost capabilities. Results and the last 30 rolls (with label and modifier) are kept only in the player's browser, shared between open tabs, with a **Clear** button. Nothing is sent anywhere.

### Carry Limit

The character's **Active Pack** sets their Carry Limit, plus the character's **Carry modifier** (`carryModifier`, −20 to +20, default 0) for stunts that raise it or situations that lower it (never below 0; no Active Pack, no limit). Gear brought into action from the stash counts its weight against it; what is inside a Pack never does. The limit is shown (sheet, character page, manager), not enforced. The shared rules (pricing, Active Pack, carried weight, *Forgot something?*) live in `public-site/packs.js` and are tested by `tests/packs_rules.test.js` (run from `test_app.py` when Node.js is installed). The old per-character `carryLimit` was retired in schema v11; non-default values were kept in `legacy_records` (source `carry-limit`).

## Publishing

- Every Character, Job, Archive entry, Gear item, and Rule has a **Published** checkbox. New records start unpublished.
- Sync and Export write only published records. References to unpublished records are removed from the public JSON (organizer, participants, Session Record, stash entries for unpublished Gear). Jobs still publish the full `crewCount`, so an unlisted crew member keeps the count correct without being named.
- **Sync data** atomically replaces only `../public-site/data`. **Export to site** builds a complete replacement site in `../site-export`. **Import site data** replaces the database with the published JSON, which discards unpublished records.
- Uploaded images are stored in SQLite: portraits are published to `data/portraits/`, Archive and Gear images to `data/images/`.

Public data layout: `data/{gear,characters,archive,jobs}/index.json` manifests plus one `<id>.json` per record, alongside `outpost.json` and `game.json` (all Game posts in one file). Record IDs are stable slugs and double as public URL fragments (`archive.html#g-03`, `jobs.html#e-17`, `marketplace.html#gear-rope`, `characters.html#varga`). The old pages `island.html`, `gates.html`, `expeditions.html`, and `rules.html` redirect to their replacements, keeping the record ID.

## Site & launch

**Site & launch** (last in the sidebar) holds the site-wide settings, published as `data/site.json`:

- **Launch:** the time of the first session with its UTC offset (`2026-11-06T20:00+02:00`; Athens is +02:00 in winter and +03:00 in summer), a heading, and a short introduction. While **Show the launch panel** is on and the time has not passed, the Overview shows a live countdown, the time in Athens and in the visitor's own time zone, and the roadmap. The panel hides itself once the launch time passes.
- **Roadmap:** steps with *To do*, *In progress*, or *Done*, reordered with the arrows. The Overview shows them with a progress bar.
- **Discord invite:** a *Join our Discord* button on the launch panel and in every page footer.
- **Community:** the *A campaign of Game of Adventuring* credit in every page footer, linked to the Discord invite, with a small logo.
- **Sponsor:** name, link, and logo, credited as *Supported by …* in every page footer.
- **Logos** can be a file dropped into `public-site/assets/images/` (the defaults expect `game-of-adventuring.png` and `cozy-house-games.png`), an uploaded image (hosted with the site under `data/images/`), or a full `https://` address. A missing file just leaves the name without a logo.

Every page footer also carries the copyright line, written into the pages themselves.

## Preview

**Preview** (next to Save on every record and on the Outpost Sheet) opens a panel showing the record on the real public site, with the same pages, styles, and scripts. The manager serves `public-site` under `/preview/` but answers its `data/` requests from the database instead of the files, so the preview:

- shows **unsaved** form changes, updating as you type, and unpublished records;
- follows the **Show sample content** switch;
- never writes anything: `public-site/data` changes only with Sync data or Export.

If the form is not valid yet (for example a missing title), the preview keeps showing the saved version and says why. **Desktop / Phone** switches the width, and **Open in new tab** opens the same preview full size; you can click around the whole site from there.

## Sample content

Any Character, Job, Archive entry, Gear item, or Game post can be flagged as **Sample content**: preview data that is not campaign canon. The **Show sample content** switch under *Preview* in the sidebar decides whether those records exist as far as the manager and the site are concerned:

- **On:** sample records appear in the lists with a *Sample* badge, each form shows a *Sample content* checkbox, and Sync data / Export include published samples.
- **Off** (the default for a new database): sample records are hidden from every list and from Sync data / Export, so the public site shows only real content. Nothing is deleted. References from real records to hidden samples are labelled as such and kept when the real record is saved.

Turning the switch off or on does not touch the site files by itself; press **Sync data** afterwards. The Outpost Sheet is a single record and cannot be flagged.

## Upgrading a schema v3 database

Opening a database from before this model (Island, Gates, Expeditions, Expedition Reports) converts it in place on startup. The original file is first copied to `content.v3-backup.db`, and every source row is also kept in the `legacy_records` table. Gates become Gate Records with the same IDs, Reports become Session Records (the first by date is attached to its Job; others are linked from the Job's briefing), Expeditions become Jobs with the same IDs, and the Island Sheet becomes the Outpost Sheet. The console prints a summary of anything that needed a judgement call.

## Upgrading a schema v5 database (Facilities)

On startup, the Outpost Sheet's old facility list (name and description) becomes records in the Facilities section, flagged as sample content. Free-text contributing assets are cleared, because they are now picked from Facilities and Characters. The sheet as it was is kept in `legacy_records` (source `outpost`).

## Upgrading a schema v6 database (Projects)

On startup, the Outpost Sheet's active projects become Outpost projects in the Projects section, flagged as sample content, and persistent conditions are retired (consequences and aspects cover them). The sheet as it was is kept in `legacy_records` (source `outpost`).

## Player sheet round trip

1. **Player:** on their character's public page, open **Character Sheet** and press **Open editable sheet**. It opens `sheet.html?id=<id>` in a new tab with the published sheet, stash, and Marketplace.
2. **During play:** the player edits the sheet, including the character's **Public summary**. **View sheet** switches to a play layout: skills as a pyramid you click to roll, with Fate points, stress boxes, and consequences still usable (the choice is remembered per browser); **Edit sheet** switches back. Stress boxes and Fate points are one click, rows can be added or removed, and each skill has a die button. The **Inventory** section has *My Stash* (quantities, **Brought into action**, remove) and *Marketplace* (unavailable items cannot be added). Edits are kept in that browser, even across closing the tab, until **Reset to published** discards them. If the GM publishes a newer version meanwhile, the sheet says so and offers to load it.
3. **After the session:** **Save file** downloads `<id>-sheet.json` (a few KB of readable JSON: name, player, summary, sheet, stash) and shows instructions to send it to the GM. **Open file** on the sheet loads such a file back, for example to continue on another device; it becomes that browser's working copy for the character.
4. **GM:** in the character's editor, press **Import sheet file** and choose that file. The manager loads it into the sheet editor, fills in the public summary, and lists what changed (e.g. "Public summary changed", "Fate points: 2 → 1", "Stash: added Lantern × 1"). Files saved before stashes existed (version 1) leave the stash untouched. Nothing is stored until **Save character**, and **Undo import** restores the previous sheet, stash, and fields. Then **Sync data** or **Export to site** to publish.

### Batch import

After a session, **Batch import sheet files…** (above the Characters list) handles everyone's files at once:

1. **Choose folder…** (or **Choose files…**). Every `.json` file in it is checked; other files are ignored and counted.
2. Files are validated: they must be sheet files, point at a character in the manager (or be a new character with a name), and only the newest file per character is kept. The summary lists *Ready to review* and *Failed validation* with reasons. A new-character file whose name matches an existing character is flagged, since approving it would create a second one.
3. **Start review** walks through the ready files one at a time, showing the same change list as a single import. **Approve and save** saves immediately (keeping the character's published state and sheet visibility; new characters start unpublished); **Deny** skips it.
4. The results list what was imported and what was not, with the reason: failed validation, denied, or could not be saved (with the server's message). **Copy report** copies it as text, and the last report stays available in the batch panel. Closing mid-review records the remaining files as not reviewed.

### New characters

Players can also start from **Create new character** on the Characters page. It opens `sheet.html?new`: a blank sheet with Fate Core defaults (all 18 standard skills at +0, refresh 3, 3 Fate points, two Physical and two Mental stress boxes, Mild/Moderate/Severe consequences), **Character name**, **Player name**, and **Public summary** fields, an empty stash, and the Marketplace. The work in progress is kept in the browser until **Start over**. **Save file** requires a name and downloads `new-character-<name>-sheet.json`.

**GM:** on Characters press **+ New**, then **Import sheet file** and pick that file. The name, player name, and summary are filled in, the type is set to player character, and the sheet and stash load for review. The new record starts unpublished as usual. Importing a new-character file into an existing character asks for confirmation first.

The page is `public-site/sheet.html`. Sheet files are JSON (`format: "nowhere-expeditions/fate-sheet"`, `version: 3`); the manager and the sheet's **Open file** also still accept the older HTML sheet files, reading only the JSON inside them. A file made for a different character asks for confirmation before importing.

## Tests

```powershell
python -m unittest discover -s tests -v
```

Tests use temporary directories and do not modify the campaign's actual database or public JSON.
