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
Gate ──< Expedition ──< Expedition Report
            │  └── organizer, participants ──> Character
            └── report author ───────────────> Character
```

- **Characters**: player characters and NPCs (name, type, status, portrait, summary, player name). A character can have an optional **Fate Core sheet**. The sheet holds aspects, skills on the ladder, stunts, refresh and Fate points, numbered stress boxes, consequences, and extras. It is shown as a separate "Character Sheet" tab on the public profile (`characters.html#id#sheet`). The sheet has its own **Show this sheet on the public site** switch, so an NPC can be published without revealing their stats.
- **Gates**: persistent locations. The public record holds only what the Island currently knows: overview, environment, and known traits, hazards, and locations.
- **Expeditions**: one planned or completed session, optionally at a Gate, with an organizer, participants, schedule, and crew limits.
- **Expedition Reports**: the record of an Expedition. Every report belongs to exactly one Expedition (many reports per Expedition). A report's Gate is always derived from its Expedition, and a Gate's reports are the reports of its Expeditions.
- **Rules** and the **Island Sheet**.

References are stored as IDs in SQLite foreign-key columns (`expeditions.gate_id`, `expedition_participants`, `expedition_reports.expedition_id`, …). Histories are derived by querying those references, never stored on the parent. A record that is still referenced cannot be deleted; the manager lists what refers to it.

## Publishing

- Every Character, Gate, Expedition, Report, and Rule has a **Published** checkbox. New records start unpublished.
- Sync and Export write only published records. References to unpublished records are removed from the public JSON. Expeditions still publish the full `crewCount`, so an unlisted crew member keeps the count correct without being named. A report whose Expedition is unpublished is left out.
- **Sync data** atomically replaces only `../public-site/data`. **Export to site** builds a complete replacement site in `../site-export`. **Import site data** replaces the database with the published JSON, which discards unpublished records.
- Uploaded portraits are stored in SQLite and published to `data/portraits/`.

Public data layout: `data/{characters,gates,expeditions,reports}/index.json` manifests plus one `<id>.json` per record, alongside `island.json` and `rules.json`. Record IDs are stable slugs and double as public URL fragments (`gates.html#g-03`, `expeditions.html#e-17`, `characters.html#varga`).

## Player sheet round trip

1. **Player:** on their character's public page, open **Character Sheet** and press **Download editable sheet**. This saves `<id>-sheet.html`, a single self-contained file (no internet needed) that opens in any desktop browser.
2. **During play:** the player edits the sheet. Stress boxes and Fate points are one click, and rows can be added or removed. Changes are also kept in that browser in case the tab closes. **Save copy** downloads the updated file.
3. **After the session:** the player sends the newest saved file to the GM.
4. **GM:** in the character's editor, press **Import sheet file** and choose that file. The manager loads it into the sheet editor and lists what changed (e.g. "Fate points: 2 → 1", "Physical stress: 1 of 4 → 2 of 4 boxes marked"). Nothing is stored until **Save character**, and **Undo import** restores the previous sheet. Then **Sync data** or **Export to site** to publish.

The file's template is `public-site/assets/character-sheet.html`. The sheet travels as JSON inside it (`format: "nowhere-expeditions/fate-sheet"`), and the manager reads only that JSON; nothing in the file runs in the manager. A file made for a different character asks for confirmation before importing.

## Tests

```powershell
python -m unittest discover -s tests -v
```

Tests use temporary directories and do not modify the campaign's actual database or public JSON.
