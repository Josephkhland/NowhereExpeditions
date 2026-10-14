"""Which player-facing records each release added, changed or removed: public-site/changes.json.

Called by release_version.py on every deploy. The history is rebuilt from the release tags each time
(nothing is stored), starting at the version named by "changelogFrom" in .github/versioning.json.
Each release is compared with the one before it, record by record, using the exported data in
public-site/data. The release being deployed is compared against the working tree, so a local preview
(python .github/scripts/release_version.py) shows what the next deploy will list.

For a changed record it notes which fields changed and, in long Markdown text (rules, lore), which
## sections were added, edited or removed, so a reader knows what to re-read.
"""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = "public-site/data"
CHANGES_FILE = ROOT / "public-site" / "changes.json"
# One JSON file per record, listed in the folder's index.json.
RECORD_FOLDERS = ("archive", "factions", "resources", "forms", "gear", "packs", "characters", "jobs", "projects")
# Fields whose changes say nothing a reader needs: rule order moves whenever a learning path is edited.
IGNORED_FIELDS = {"order"}
# The main text of a rule (details) or an Archive entry (content).
FIELD_LABELS = {"details": "Text", "content": "Text", "ruleIds": "Rules", "factionIds": "Factions", "participantIds": "Participants",
                "gateIds": "Gates", "characterIds": "Characters", "imageCrop": "Icon framing"}
FIELD_DEFAULTS = {"layout": "standard"}
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
ARCHIVE_PAGES = {"gate-record": ("Gates", "gates.html"), "lore": ("Lore", "lore.html"),
                 "session-record": ("Expedition Reports", "reports.html"), "newspaper": ("Expedition Reports", "reports.html")}
SECTION_ORDER = ["Rules", "News", "Lore", "Gates", "Factions", "Discoveries", "Marketplace", "Outpost",
                 "Job Board", "Expedition Reports", "Characters"]


# ---------- Reading the exported data at a release ----------

def read_tree(ref):
    """{path: text} for every JSON file under public-site/data, at a git ref or (ref None) in the working tree."""
    if ref is None:
        base = ROOT / DATA
        return {f"{DATA}/{path.relative_to(base).as_posix()}": path.read_text(encoding="utf-8")
                for path in base.rglob("*.json")}
    listing = subprocess.run(["git", "ls-tree", "-r", ref, "--", DATA], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    blobs = []
    for line in listing.splitlines():
        meta, path = line.split("\t", 1)
        if path.endswith(".json"):
            blobs.append((path, meta.split()[2]))
    if not blobs:
        return {}
    # One git process for all the files rather than one per file.
    batch = subprocess.run(["git", "cat-file", "--batch"], cwd=ROOT, check=True, capture_output=True,
                           input="".join(f"{sha}\n" for _, sha in blobs).encode()).stdout
    files, offset = {}, 0
    for path, _ in blobs:
        header_end = batch.index(b"\n", offset)
        size = int(batch[offset:header_end].split()[2])
        files[path] = batch[header_end + 1:header_end + 1 + size].decode("utf-8")
        offset = header_end + 1 + size + 1
    return files


def load(files, name, default):
    text = files.get(f"{DATA}/{name}")
    if text is None:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def gate_name(entry):
    designation = (entry.get("details") or {}).get("designation") or ""
    title = entry.get("title") or ""
    return " · ".join(part for part in (designation, title) if part) if designation and designation not in title else title or designation


def describe(kind, record):
    """(section, label, title, href) for one record, matching the links the site itself uses."""
    rid = str(record.get("id", ""))
    if kind == "archive":
        section, page = ARCHIVE_PAGES.get(record.get("type"), ("Lore", "lore.html"))
        label = {"gate-record": "Gate", "session-record": "Expedition report", "newspaper": "Bulletin"}.get(record.get("type"), "Lore")
        title = gate_name(record) if record.get("type") == "gate-record" else record.get("title")
        return section, label, title, f"{page}#{rid}"
    if kind == "game":
        if record.get("type") == "announcement":
            return "News", "Announcement", record.get("title"), f"game.html#post-{rid}"
        return "Rules", "Rule", record.get("title"), f"game.html#post-{rid}"
    if kind == "path":
        key = record.get("key", "")
        return "Rules", "Learning path", record.get("title"), "game.html#onboarding" if key == "onboarding" else f"game.html#path-{key}"
    if kind == "factions":
        return "Factions", "Faction", record.get("name"), f"factions.html#{rid}"
    if kind == "resources":
        return "Discoveries", "Resource", record.get("name"), f"discoveries.html#resource-{rid}"
    if kind == "forms":
        return "Discoveries", "Spell Form", record.get("name"), f"discoveries.html#form-{rid}"
    if kind == "function":
        return "Discoveries", "Function", record.get("name"), f"discoveries.html#function-{record.get('name')}"
    if kind == "domain":
        label = "Domain" if record.get("kind", "environment") == "environment" else "Trade origin"
        return "Discoveries", label, record.get("name"), f"discoveries.html#domain-{record.get('key')}"
    if kind == "interaction":
        return ("Discoveries", "Function interaction", f"{record.get('a')} + {record.get('b')} ({record.get('kind')})",
                f"discoveries.html#function-{record.get('a')}")
    if kind == "gear":
        href = f"marketplace.html#gear-{rid}" if record.get("marketplaceVisible", True) is not False else "marketplace.html"
        return "Marketplace", "Gear", record.get("name"), href
    if kind == "packs":
        return "Marketplace", "Expedition Pack", record.get("name"), f"marketplace.html#pack-{rid}"
    if kind == "characters":
        return "Characters", "Character", record.get("name"), f"characters.html#{rid}"
    if kind == "jobs":
        return "Job Board", "Job", record.get("title"), f"jobs.html#{rid}"
    if kind == "projects":
        return "Outpost", "Project", record.get("name") or record.get("title"), f"outpost.html#{rid}"
    if kind == "facility":
        return "Outpost", "Facility", record.get("name"), f"outpost.html#{rid}"
    if kind == "outpost":
        return "Outpost", "Outpost Sheet", record.get("name") or "Outpost Sheet", "outpost.html"
    return "Other", kind, rid, ""


def snapshot(files):
    """{key: (kind, record)} for every player-facing record in one export."""
    records = {}

    def add(kind, key, record):
        records[f"{kind}:{key}"] = (kind, record)

    for folder in RECORD_FOLDERS:
        for name in load(files, f"{folder}/index.json", []):
            record = load(files, f"{folder}/{name}", None)
            if isinstance(record, dict):
                add(folder, record.get("id") or name.removesuffix(".json"), record)
    for post in load(files, "game.json", []):
        add("game", post.get("id"), post)
    for path in load(files, "learning-paths.json", []):
        add("path", path.get("key"), path)
    outpost = load(files, "outpost.json", {})
    if outpost:
        for facility in outpost.get("facilities") or []:
            add("facility", facility.get("id"), facility)
        add("outpost", "sheet", {key: value for key, value in outpost.items() if key != "facilities"})
    vocabulary = load(files, "vocabulary.json", {})
    for group in vocabulary.get("functionGroups") or []:
        for word in group.get("functions") or []:
            add("function", word.get("name"), {**word, "group": group.get("name")})
    for domain in vocabulary.get("domains") or []:
        add("domain", domain.get("key"), domain)
    for pair in vocabulary.get("interactions") or []:
        add("interaction", f"{pair.get('a')}|{pair.get('b')}|{pair.get('kind')}", pair)
    return records


# ---------- Comparing two exports ----------

def humanize(key):
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key.replace("_", " ").replace("-", " ")).split()
    return " ".join(words).capitalize() if words else key


def sections(text):
    """[(heading, body)] of a Markdown text; the part before the first heading is "Opening"."""
    parts, heading, body = [], "Opening", []
    for line in str(text).splitlines():
        match = HEADING.match(line)
        if match:
            parts.append((heading, "\n".join(body).strip()))
            heading, body = match.group(2), []
        else:
            body.append(line)
    parts.append((heading, "\n".join(body).strip()))
    # A heading that appears twice is told apart by its position among its namesakes.
    seen, keyed = {}, []
    for heading, body in parts:
        seen[heading] = seen.get(heading, 0) + 1
        keyed.append((heading if seen[heading] == 1 else f"{heading} ({seen[heading]})", body))
    return [(heading, body) for heading, body in keyed if heading != "Opening" or body]


def section_changes(before, after):
    """Which ## sections of a Markdown text were added, edited or removed, in reading order."""
    old, new = dict(sections(before)), sections(after)
    changes = []
    for heading, body in new:
        if heading not in old:
            changes.append({"title": heading, "change": "added"})
        elif old[heading] != body:
            changes.append({"title": heading, "change": "updated"})
    new_headings = {heading for heading, _ in new}
    changes += [{"title": heading, "change": "removed"} for heading in old if heading not in new_headings]
    return changes


def is_default(key, value):
    return value in (None, "", False, [], {}) or FIELD_DEFAULTS.get(key) == value


def is_markdown_document(value):
    return isinstance(value, str) and any(HEADING.match(line) for line in value.splitlines())


def field_changes(before, after):
    """[{field, sections?}] for each changed field; a "details" object is looked into one level deep."""
    changes = []

    def compare(prefix, old, new):
        for key in sorted(set(old) | set(new), key=lambda key: (list(new).index(key) if key in new else len(new), key)):
            if key in IGNORED_FIELDS or old.get(key) == new.get(key):
                continue
            # A field the export gained or dropped, or one going from one empty value to another (None to False),
            # is not a change anyone made.
            if is_default(key, old.get(key)) and is_default(key, new.get(key)):
                continue
            if key == "details" and isinstance(old.get(key), dict) and isinstance(new.get(key), dict) and not prefix:
                compare("details.", old[key], new[key])
                continue
            change = {"field": FIELD_LABELS.get(key, humanize(key)) if not prefix else humanize(key)}
            if is_markdown_document(old.get(key)) or is_markdown_document(new.get(key)):
                change["sections"] = section_changes(old.get(key) or "", new.get(key) or "")
            changes.append(change)

    compare("", before, after)
    return changes


def diff(old_records, new_records):
    """The changes between two snapshots, sorted by site section then title."""
    changes = []
    for key in set(old_records) | set(new_records):
        old, new = old_records.get(key), new_records.get(key)
        kind, record = new or old
        if old and new:
            if old[1] == new[1]:
                continue
            fields = field_changes(old[1], new[1])
            if not fields:
                continue
            change = "updated"
        else:
            change, fields = ("added" if new else "removed"), []
        section, label, title, href = describe(kind, record)
        entry = {"key": key, "section": section, "label": label, "title": title or key.split(":", 1)[1], "change": change}
        if change != "removed" and href:
            entry["href"] = href
        if fields:
            entry["fields"] = fields
        if old and new:
            previous_title = describe(kind, old[1])[2]
            if previous_title and previous_title != entry["title"]:
                entry["previousTitle"] = previous_title
        changes.append(entry)
    rank = {name: index for index, name in enumerate(SECTION_ORDER)}
    return sorted(changes, key=lambda item: (rank.get(item["section"], len(rank)), item["label"], str(item["title"]).lower()))


# ---------- The release history ----------

def build(config, current, release_url, tag_date, parse_version):
    """The changes.json content. `current` is the release being deployed (version/tag/date/previous tag/new)."""
    prefix = config.get("tagPrefix", "v")
    start = config.get("changelogFrom")
    if not start:
        return {"from": None, "sectionOrder": SECTION_ORDER, "releases": []}
    start_version = parse_version(start)
    tags = []
    for tag in subprocess.run(["git", "tag", "--list", f"{prefix}*"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.split():
        try:
            tags.append((parse_version(tag[len(prefix):]), tag))
        except ValueError:
            continue
    tags.sort()
    steps = []  # (version, tag, date, previous ref, ref to read; None = working tree)
    for index, (version, tag) in enumerate(tags):
        if version >= start_version and index > 0:
            steps.append((version, tag, tag_date(tag), tags[index - 1][1], tag))
    # The release being deployed has no tag yet (it is created after a successful deploy).
    if current["new"] and current["previousTag"] and parse_version(current["version"]) >= start_version:
        steps.append((parse_version(current["version"]), current["tag"], current["date"], current["previousTag"], None))

    cache = {}

    def records_at(ref):
        if ref not in cache:
            cache[ref] = snapshot(read_tree(ref))
        return cache[ref]

    releases = []
    for version, tag, date, previous_ref, ref in sorted(steps, reverse=True):
        releases.append({
            "version": ".".join(str(part) for part in version),
            "date": date,
            "url": release_url(tag),
            "changes": diff(records_at(previous_ref), records_at(ref)),
        })
    return {"from": start, "sectionOrder": SECTION_ORDER, "releases": releases}


def markdown_summary(release):
    """A short list of one release's changes for the GitHub Release notes and the workflow summary."""
    if not release["changes"]:
        return "No player-facing records changed in this release.\n"
    lines = ["### Changed on the site", ""]
    for item in release["changes"]:
        detail = ""
        if item.get("fields"):
            detail = ": " + ", ".join(
                field["field"] + (" (" + ", ".join(f"{section['title']} {section['change']}" for section in field["sections"]) + ")"
                                  if field.get("sections") else "")
                for field in item["fields"])
        renamed = f" (was {item['previousTitle']})" if item.get("previousTitle") else ""
        lines.append(f"- **{item['change'].capitalize()}** {item['label']}: {item['title']}{renamed}{detail}")
    return "\n".join(lines) + "\n"


def write(data, path=CHANGES_FILE):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
