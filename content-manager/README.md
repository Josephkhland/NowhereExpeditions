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

Job ──> Session Record (an Archive entry of type session-record, optional)
 └── organizer, participants ──> Character

Archive entry (gate-record | session-record | newspaper | history | folklore)
 └── participants (session records only) ──> Character

Character ──< Stash entry ──> Gear
```

- **Outpost Sheet**: the shared settlement "character" (formerly the Island Sheet): aspects, capabilities, stress, consequences, facilities, projects, conditions.
- **Characters**: player characters and NPCs (name, type, status, portrait, summary, player name). A character can have an optional **Fate Core sheet** with its own **Show this sheet on the public site** switch, and a **Stash**: references to Gear with a quantity and a **Brought into action** flag. The stash editor has two tabs, *My Stash* and *Marketplace*; adding Gear that is already owned raises its quantity instead of creating a duplicate. Removing an entry never deletes the Gear.
- **Jobs**: the Job Board. A job has a type (`expedition`, `recovery`, `investigation`, `escort`, `bounty`, `outpost`, `other`), a status (`open`, `scheduled`, `in-progress`, `completed`, `failed`, `cancelled`), summary, objective, briefing, schedule, crew limits, organizer, participants, and optionally the **Session Record** describing what happened when it was played. Jobs do not need a Gate; lore is linked from the briefing.
- **Archive**: one general lore model. Every entry has a type, title, subtitle, summary, content, author, published date, event date (free text), image, and tags. Type-specific metadata lives in `details`: Gate Records keep designation, Gate status, discovery date, environment, and known traits, hazards, and locations; Session Records keep a session date and outcome, plus participants. New types can be added in `ARCHIVE_TYPES` (app.py and both front ends) without changing the schema.
- **Gear**: the Marketplace catalogue: name, category, description, price, weight, availability (`common`, `restricted`, `rare`, `unavailable`), image, tags, **featured**, an optional promotional label (e.g. NEW, LIMITED), and an optional discount (`{active, salePrice}`; the regular price stays in `price`). The Marketplace is informational: nothing is bought or charged.
- **Rules**.

Structured references are stored as IDs in SQLite foreign-key columns and link tables (`jobs.session_record_id`, `job_participants`, `archive_participants`, `character_stash`). Reverse relationships (a Session Record's Job, a Gear's owners, what links to an Archive entry) are derived, never stored. A record that is still referenced cannot be deleted; the manager lists what refers to it.

### Links between records

Authored text (Archive summary and content, Job summary, objective, and briefing) can link Archive entries with `[[entry-id]]` or `[[entry-id|link text]]`, and other pages with `[text](jobs.html#e-17)`. Content also understands `## headings`, `- list items`, `**bold**`, and `*italic*`. The editor lists every Archive link in a record and flags missing or unpublished targets. On export, links to unpublished entries become plain text so their IDs never reach the site.

### Explore mode

Each Archive entry has **Explore connections**, which opens `archive.html#explore/<archive|job|character>/<id>`: the record in the center and everything connected to it on a ring around it. Connections are derived when the page loads, never stored: `[[archive-id]]` and `[text](jobs.html#id)` links in text (both directions), a Job's Session Record, Session Record and Job crews, and Job organizers. Archive entries are filled circles colored by type, Jobs are diamonds, Characters are outlined circles; Jobs and Characters can be hidden with toggles. Clicking a node re-centers on it, and the same connections are listed as text below the graph.

### Dice

`public-site/dice.js` rolls Fate dice (4dF + modifier) for skills on public and editable sheets and for Outpost capabilities. Results and the last 30 rolls (with label and modifier) are kept only in the player's browser, shared between open tabs, with a **Clear** button. Nothing is sent anywhere.

### Load rules

Only the data a future Load system needs is stored: `Gear.weight` and each stash entry's `broughtIntoAction`. No Load limit, Stress cost, or Fate Point cost is calculated or enforced.

## Publishing

- Every Character, Job, Archive entry, Gear item, and Rule has a **Published** checkbox. New records start unpublished.
- Sync and Export write only published records. References to unpublished records are removed from the public JSON (organizer, participants, Session Record, stash entries for unpublished Gear). Jobs still publish the full `crewCount`, so an unlisted crew member keeps the count correct without being named.
- **Sync data** atomically replaces only `../public-site/data`. **Export to site** builds a complete replacement site in `../site-export`. **Import site data** replaces the database with the published JSON, which discards unpublished records.
- Uploaded images are stored in SQLite: portraits are published to `data/portraits/`, Archive and Gear images to `data/images/`.

Public data layout: `data/{gear,characters,archive,jobs}/index.json` manifests plus one `<id>.json` per record, alongside `outpost.json` and `rules.json`. Record IDs are stable slugs and double as public URL fragments (`archive.html#g-03`, `jobs.html#e-17`, `marketplace.html#gear-rope`, `characters.html#varga`). The old pages `island.html`, `gates.html`, and `expeditions.html` redirect to their replacements, keeping the record ID.

## Upgrading a schema v3 database

Opening a database from before this model (Island, Gates, Expeditions, Expedition Reports) converts it in place on startup. The original file is first copied to `content.v3-backup.db`, and every source row is also kept in the `legacy_records` table. Gates become Gate Records with the same IDs, Reports become Session Records (the first by date is attached to its Job; others are linked from the Job's briefing), Expeditions become Jobs with the same IDs, and the Island Sheet becomes the Outpost Sheet. The console prints a summary of anything that needed a judgement call.

## Player sheet round trip

1. **Player:** on their character's public page, open **Character Sheet** and press **Open editable sheet**. It opens `sheet.html?id=<id>` in a new tab with the published sheet, stash, and Marketplace.
2. **During play:** the player edits the sheet. Stress boxes and Fate points are one click, rows can be added or removed, and each skill has a die button. The **Inventory** section has *My Stash* (quantities, **Brought into action**, remove) and *Marketplace* (unavailable items cannot be added). Edits are kept in that browser, even across closing the tab, until **Reset to published** discards them. If the GM publishes a newer version meanwhile, the sheet says so and offers to load it.
3. **After the session:** **Save file** downloads `<id>-sheet.html` and shows instructions to send it to the GM. The file is self-contained: it holds the sheet as JSON plus a copy of the dice script, so it also opens offline and can be edited and saved again (**Revert to file** discards edits in that mode).
4. **GM:** in the character's editor, press **Import sheet file** and choose that file. The manager loads it into the sheet editor and lists what changed (e.g. "Fate points: 2 → 1", "Stash: added Lantern × 1"). Files saved before stashes existed (version 1) leave the stash untouched. Nothing is stored until **Save character**, and **Undo import** restores the previous sheet and stash. Then **Sync data** or **Export to site** to publish.

### New characters

Players can also start from **Create new character** on the Characters page. It opens `sheet.html?new`: a blank sheet with Fate Core defaults (all 18 standard skills at +0, refresh 3, 3 Fate points, two Physical and two Mental stress boxes, Mild/Moderate/Severe consequences), **Character name** and **Player name** fields, an empty stash, and the Marketplace. The work in progress is kept in the browser until **Start over**. **Save file** requires a name and downloads `new-character-<name>-sheet.html`.

**GM:** on Characters press **+ New**, then **Import sheet file** and pick that file. The name and player name are filled in, the type is set to player character, and the sheet and stash load for review. The new record starts unpublished as usual. Importing a new-character file into an existing character asks for confirmation first.

The page is `public-site/sheet.html`. The sheet travels as JSON inside the saved file (`format: "nowhere-expeditions/fate-sheet"`), and the manager reads only that JSON; nothing in the file runs in the manager. A file made for a different character asks for confirmation before importing.

## Tests

```powershell
python -m unittest discover -s tests -v
```

Tests use temporary directories and do not modify the campaign's actual database or public JSON.
