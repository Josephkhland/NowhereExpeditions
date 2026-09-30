from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import unquote, urlsplit


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DEFAULT_DATA_DIR = APP_DIR.parent / "public-site" / "data"
PORTRAIT_PREFIX = "data/portraits/"
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE_BYTES = 8_000_000

CHARACTER_TYPES = ("player", "npc")
CHARACTER_STATUSES = ("active", "inactive", "missing", "deceased")
GATE_STATUSES = ("active", "dormant", "collapsed", "lost")
EXPEDITION_TYPES = ("exploration", "recovery", "research", "rescue", "other")
EXPEDITION_STATUSES = ("recruiting", "scheduled", "underway", "completed", "cancelled")
REPORT_OUTCOMES = ("success", "partial", "failed", "aborted", "unknown")

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DATETIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?")


class ManagerError(ValueError):
    """An invalid manager request or campaign record."""


def slugify(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.strip().lower())).strip("-")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def safe_filename(value: str, extension: str = ".json") -> str:
    slug = slugify(value)
    if not slug:
        raise ManagerError("A record ID is required to create an export filename.")
    return f"{slug}{extension}"


# --- Field cleaning ---------------------------------------------------------

def clean_text(data: dict[str, Any], key: str, required_label: str | None = None) -> str:
    value = data.get(key)
    if value is None:
        value = ""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ManagerError(f"{key} must be text.")
    value = str(value).strip()
    if required_label and not value:
        raise ManagerError(f"{required_label} is required.")
    return value


def clean_list(data: dict[str, Any], key: str) -> list[str]:
    value = data.get(key) or []
    if isinstance(value, str):
        value = value.splitlines()
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ManagerError(f"{key} must be a list of text values.")
    return [item.strip() for item in value if item.strip()]


def clean_choice(data: dict[str, Any], key: str, options: tuple[str, ...], default: str) -> str:
    value = str(data.get(key) or default).strip().lower()
    if value not in options:
        raise ManagerError(f"{key} must be one of: {', '.join(options)}.")
    return value


def clean_pattern(data: dict[str, Any], key: str, pattern: re.Pattern[str], label: str) -> str:
    value = clean_text(data, key)
    if value and not pattern.fullmatch(value):
        raise ManagerError(f"{label} is not a valid date.")
    return value


def clean_count(data: dict[str, Any], key: str, label: str) -> int | None:
    value = data.get(key)
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ManagerError(f"{label} must be a whole number.") from error
    if isinstance(value, bool) or number < 0 or str(number) != str(value).strip():
        raise ManagerError(f"{label} must be a whole number of zero or more.")
    return number


def clean_ref(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ManagerError(f"{key} must be a record ID.")
    return value.strip() or None


def clean_int(value: Any, label: str, low: int, high: int, allow_none: bool = False) -> int | None:
    if value is None or value == "":
        if allow_none:
            return None
        raise ManagerError(f"{label} is required.")
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ManagerError(f"{label} must be a whole number.") from error
    if isinstance(value, bool) or not low <= number <= high:
        raise ManagerError(f"{label} must be a whole number from {low} to {high}.")
    return number


def clean_sheet(value: Any) -> dict[str, Any] | None:
    """A Fate Core character sheet. Skill names are free text so campaign skill lists can differ."""
    if value is None or value == "":
        return None
    if not isinstance(value, dict):
        raise ManagerError("The character sheet must be an object.")

    def rows(key: str) -> list[dict[str, Any]]:
        items = value.get(key) or []
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise ManagerError(f"Sheet {key} must be a list.")
        return items

    aspects = value.get("aspects") or {}
    if not isinstance(aspects, dict):
        raise ManagerError("Sheet aspects must be an object.")
    skills = []
    for row in rows("skills"):
        name = clean_text(row, "name")
        if name:
            skills.append({"name": name, "rating": clean_int(row.get("rating"), f"Rating for {name}", -2, 8)})
    stress = []
    for row in rows("stress"):
        name = clean_text(row, "name")
        boxes = row.get("boxes") or []
        if not isinstance(boxes, list) or len(boxes) > 10:
            raise ManagerError("A stress track can have at most 10 boxes.")
        if name:
            stress.append({"name": name, "boxes": [bool(box) for box in boxes]})
    consequences = []
    for row in rows("consequences"):
        label = clean_text(row, "label")
        if label:
            consequences.append({"label": label, "shift": clean_int(row.get("shift"), f"Shift for {label}", 1, 12),
                                 "aspect": clean_text(row, "aspect")})
    return {
        "public": bool(value.get("public", True)),
        "aspects": {
            "highConcept": clean_text(aspects, "highConcept"),
            "trouble": clean_text(aspects, "trouble"),
            "other": clean_list(aspects, "other"),
        },
        "skills": sorted(skills, key=lambda skill: -skill["rating"]),
        "stunts": [
            {"name": clean_text(row, "name"), "description": clean_text(row, "description")}
            for row in rows("stunts") if clean_text(row, "name") or clean_text(row, "description")
        ],
        "refresh": clean_int(value.get("refresh"), "Refresh", 0, 20),
        "fatePoints": clean_int(value.get("fatePoints"), "Fate points", 0, 50, allow_none=True),
        "stress": stress,
        "consequences": consequences,
        "extras": clean_text(value, "extras"),
    }


def clean_character(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": clean_text(data, "name", "A character name"),
        "type": clean_choice(data, "type", CHARACTER_TYPES, "player"),
        "status": clean_choice(data, "status", CHARACTER_STATUSES, "active"),
        "portrait": clean_text(data, "portrait") or None,
        "summary": clean_text(data, "summary"),
        "playerName": clean_text(data, "playerName"),
        "sheet": clean_sheet(data.get("sheet")),
    }


def clean_gate(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "designation": clean_text(data, "designation", "A Gate designation"),
        "name": clean_text(data, "name", "A Gate name"),
        "status": clean_choice(data, "status", GATE_STATUSES, "active"),
        "discoveredAt": clean_pattern(data, "discoveredAt", DATE_RE, "Discovered date"),
        "overview": clean_text(data, "overview"),
        "environment": clean_text(data, "environment"),
        "knownTraits": clean_list(data, "knownTraits"),
        "knownHazards": clean_list(data, "knownHazards"),
        "knownLocations": clean_list(data, "knownLocations"),
    }


def clean_expedition(data: dict[str, Any]) -> dict[str, Any]:
    participants = data.get("participantIds") or []
    if not isinstance(participants, list) or any(not isinstance(item, str) for item in participants):
        raise ManagerError("Participants must be a list of Character IDs.")
    crew_min = clean_count(data, "crewMin", "Minimum crew")
    crew_max = clean_count(data, "crewMax", "Maximum crew")
    if crew_min is not None and crew_max is not None and crew_min > crew_max:
        raise ManagerError("Minimum crew cannot be larger than maximum crew.")
    return {
        "designation": clean_text(data, "designation"),
        "title": clean_text(data, "title", "An expedition title"),
        "gateId": clean_ref(data, "gateId"),
        "type": clean_choice(data, "type", EXPEDITION_TYPES, "exploration"),
        "objective": clean_text(data, "objective"),
        "briefing": clean_text(data, "briefing"),
        "status": clean_choice(data, "status", EXPEDITION_STATUSES, "recruiting"),
        "scheduledAt": clean_pattern(data, "scheduledAt", DATETIME_RE, "Scheduled date"),
        "expectedDuration": clean_text(data, "expectedDuration"),
        "organizerId": clean_ref(data, "organizerId"),
        "participantIds": list(dict.fromkeys(item.strip() for item in participants if item.strip())),
        "crewMin": crew_min,
        "crewMax": crew_max,
        "requirements": clean_list(data, "requirements"),
    }


def clean_report(data: dict[str, Any]) -> dict[str, Any]:
    expedition_id = clean_ref(data, "expeditionId")
    if not expedition_id:
        raise ManagerError("A report must belong to an Expedition.")
    return {
        "expeditionId": expedition_id,
        "title": clean_text(data, "title", "A report title"),
        "submittedBy": clean_ref(data, "submittedBy"),
        "submittedAt": clean_pattern(data, "submittedAt", DATE_RE, "Submitted date"),
        "outcome": clean_choice(data, "outcome", REPORT_OUTCOMES, "unknown"),
        "summary": clean_text(data, "summary"),
        "discoveries": clean_list(data, "discoveries"),
        "hazards": clean_list(data, "hazards"),
        "recoveredItems": clean_list(data, "recoveredItems"),
        "casualties": clean_list(data, "casualties"),
        "notes": clean_text(data, "notes"),
    }


def clean_rule(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": clean_text(data, "title", "A rule title"),
        "category": clean_text(data, "category", "A rule category"),
        "summary": clean_text(data, "summary"),
        "details": clean_text(data, "details"),
        "tags": clean_list(data, "tags"),
    }


@dataclass(frozen=True)
class Collection:
    table: str
    label: str
    id_fields: tuple[str, ...]
    clean: Callable[[dict[str, Any]], dict[str, Any]]
    display: Callable[[dict[str, Any]], str]
    # Reference field -> (SQL column, target collection). Stored as FK columns, not in the JSON blob.
    refs: tuple[tuple[str, str, str], ...] = ()
    unique_field: str | None = None
    # Public JSON fields written by Sync/Export. None means a single combined file (rules.json).
    public_fields: tuple[str, ...] = ()


def _designated(record: dict[str, Any], name_field: str) -> str:
    return " · ".join(part for part in (record.get("designation"), record.get(name_field)) if part)


COLLECTIONS: dict[str, Collection] = {
    "characters": Collection(
        "characters", "Character", ("name",), clean_character, lambda record: str(record.get("name", "")),
        public_fields=("id", "name", "type", "status", "portrait", "summary", "playerName", "sheet"),
    ),
    "gates": Collection(
        "gates", "Gate", ("designation", "name"), clean_gate, lambda record: _designated(record, "name"),
        unique_field="designation",
        public_fields=("id", "designation", "name", "status", "discoveredAt", "overview", "environment",
                       "knownTraits", "knownHazards", "knownLocations"),
    ),
    "expeditions": Collection(
        "expeditions", "Expedition", ("designation", "title"), clean_expedition, lambda record: _designated(record, "title"),
        refs=(("gateId", "gate_id", "gates"), ("organizerId", "organizer_id", "characters")),
        unique_field="designation",
        public_fields=("id", "designation", "title", "gateId", "type", "objective", "briefing", "status", "scheduledAt",
                       "expectedDuration", "organizerId", "participantIds", "crewCount", "crewMin", "crewMax", "requirements"),
    ),
    "reports": Collection(
        "expedition_reports", "Expedition Report", ("title",), clean_report, lambda record: str(record.get("title", "")),
        refs=(("expeditionId", "expedition_id", "expeditions"), ("submittedBy", "submitted_by", "characters")),
        # gateId is derived from the Expedition at export time; it is never stored on a report.
        public_fields=("id", "expeditionId", "gateId", "title", "submittedBy", "submittedAt", "outcome", "summary",
                       "discoveries", "hazards", "recoveredItems", "casualties", "notes"),
    ),
    "rules": Collection(
        "rules", "Rule", ("title",), clean_rule, lambda record: str(record.get("title", "")),
    ),
}
PAGE_COLLECTIONS = ("characters", "gates", "expeditions", "reports")


# --- Store ------------------------------------------------------------------

class ContentStore:
    def __init__(self, database_path: Path, data_dir: Path, export_dir: Path | None = None):
        self.database_path = Path(database_path)
        self.data_dir = Path(data_dir)
        self.site_dir = self.data_dir.parent
        self.export_dir = Path(export_dir) if export_dir else self.site_dir.parent / "site-export"
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._create_schema()
        with self._connect() as connection:
            initialized = connection.execute("SELECT value FROM metadata WHERE key = 'initialized'").fetchone()
        if not initialized:
            self.import_site()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _create_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS island_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rules (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS characters (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS gates (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS expeditions (
                    id TEXT PRIMARY KEY,
                    gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT,
                    organizer_id TEXT REFERENCES characters(id) ON DELETE RESTRICT,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS expedition_participants (
                    expedition_id TEXT NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
                    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (expedition_id, character_id)
                );
                CREATE TABLE IF NOT EXISTS expedition_reports (
                    id TEXT PRIMARY KEY,
                    expedition_id TEXT NOT NULL REFERENCES expeditions(id) ON DELETE RESTRICT,
                    submitted_by TEXT REFERENCES characters(id) ON DELETE RESTRICT,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS media (
                    filename TEXT PRIMARY KEY,
                    content_type TEXT NOT NULL,
                    content BLOB NOT NULL
                );
                CREATE INDEX IF NOT EXISTS expeditions_gate ON expeditions(gate_id);
                CREATE INDEX IF NOT EXISTS reports_expedition ON expedition_reports(expedition_id);
                """
            )

    # --- Record persistence -------------------------------------------------

    def _spec(self, name: str) -> Collection:
        if name not in COLLECTIONS:
            raise ManagerError(f"Unknown content type: {name}")
        return COLLECTIONS[name]

    def _write_record(self, connection: sqlite3.Connection, name: str, record_id: str, record: dict[str, Any], insert: bool) -> None:
        spec = COLLECTIONS[name]
        data = {key: value for key, value in record.items() if key != "id" and key not in {ref[0] for ref in spec.refs}}
        participants = data.pop("participantIds", []) if name == "expeditions" else []
        columns = ["data", *(column for _, column, _ in spec.refs)]
        values = [json.dumps(data, ensure_ascii=False), *(record.get(field) for field, _, _ in spec.refs)]
        if insert:
            connection.execute(
                f"INSERT INTO {spec.table} (id, {', '.join(columns)}) VALUES (?, {', '.join('?' for _ in columns)})",
                (record_id, *values),
            )
        else:
            connection.execute(
                f"UPDATE {spec.table} SET {', '.join(f'{column} = ?' for column in columns)} WHERE id = ?",
                (*values, record_id),
            )
        if name == "expeditions":
            connection.execute("DELETE FROM expedition_participants WHERE expedition_id = ?", (record_id,))
            for position, character_id in enumerate(participants):
                connection.execute(
                    "INSERT INTO expedition_participants (expedition_id, character_id, position) VALUES (?, ?, ?)",
                    (record_id, character_id, position),
                )

    def _records(self, connection: sqlite3.Connection, name: str) -> list[dict[str, Any]]:
        spec = COLLECTIONS[name]
        participants: dict[str, list[str]] = {}
        if name == "expeditions":
            for row in connection.execute("SELECT expedition_id, character_id FROM expedition_participants ORDER BY position"):
                participants.setdefault(row["expedition_id"], []).append(row["character_id"])
        columns = ", ".join(["id", "data", *(column for _, column, _ in spec.refs)])
        records = []
        for row in connection.execute(f"SELECT {columns} FROM {spec.table} ORDER BY id"):
            data = json.loads(row["data"])
            # Rules imported from rules.json carry no flag; everything in the public files is published.
            data.setdefault("published", True)
            for field, column, _ in spec.refs:
                data[field] = row[column]
            if name == "expeditions":
                data["participantIds"] = participants.get(row["id"], [])
            records.append({"id": row["id"], **data})
        return records

    def _record(self, connection: sqlite3.Connection, name: str, record_id: str) -> dict[str, Any] | None:
        return next((record for record in self._records(connection, name) if record["id"] == record_id), None)

    def _references_to(self, connection: sqlite3.Connection, name: str, record_id: str) -> list[str]:
        """Describe every record that points at `name`/`record_id`."""
        blockers = []
        for other_name, other in COLLECTIONS.items():
            for field, column, target in other.refs:
                if target != name:
                    continue
                for row in connection.execute(f"SELECT id, data FROM {other.table} WHERE {column} = ?", (record_id,)):
                    blockers.append(f"{other.label} “{other.display(json.loads(row['data'])) or row['id']}” ({field})")
        if name == "characters":
            for row in connection.execute(
                "SELECT e.id, e.data FROM expedition_participants p JOIN expeditions e ON e.id = p.expedition_id WHERE p.character_id = ?",
                (record_id,),
            ):
                blockers.append(f"Expedition “{COLLECTIONS['expeditions'].display(json.loads(row['data'])) or row['id']}” (participant)")
        return blockers

    def _prune_media(self, connection: sqlite3.Connection, portrait: Any) -> None:
        if not isinstance(portrait, str) or not portrait.startswith(PORTRAIT_PREFIX):
            return
        still_used = any(character.get("portrait") == portrait for character in self._records(connection, "characters"))
        if not still_used:
            connection.execute("DELETE FROM media WHERE filename = ?", (portrait.removeprefix(PORTRAIT_PREFIX),))

    def save_record(self, name: str, record_id: str | None, data: Any) -> dict[str, str]:
        spec = self._spec(name)
        if not isinstance(data, dict):
            raise ManagerError(f"{spec.label} data must be an object.")
        clean = spec.clean(data)
        clean["published"] = bool(data.get("published", False))

        with self._connect() as connection:
            existing = None
            if record_id:
                existing = self._record(connection, name, record_id)
                if not existing:
                    raise ManagerError(f"That {spec.label.lower()} no longer exists.")
                chosen_id = record_id
            else:
                requested = slugify(str(data.get("id") or ""))
                if requested:
                    if connection.execute(f"SELECT 1 FROM {spec.table} WHERE id = ?", (requested,)).fetchone():
                        raise ManagerError(f"Another {spec.label.lower()} already uses the ID “{requested}”.")
                    chosen_id = requested
                else:
                    stem = next((slugify(str(clean.get(field) or "")) for field in spec.id_fields if slugify(str(clean.get(field) or ""))), "") or slugify(spec.label)
                    chosen_id, suffix = stem, 2
                    while connection.execute(f"SELECT 1 FROM {spec.table} WHERE id = ?", (chosen_id,)).fetchone():
                        chosen_id, suffix = f"{stem}-{suffix}", suffix + 1

            if spec.unique_field and clean.get(spec.unique_field):
                wanted = slugify(str(clean[spec.unique_field]))
                for other in self._records(connection, name):
                    if other["id"] != chosen_id and slugify(str(other.get(spec.unique_field) or "")) == wanted:
                        raise ManagerError(f"Another {spec.label.lower()} already uses the {spec.unique_field} “{clean[spec.unique_field]}”.")

            for field, _, target in spec.refs:
                if clean.get(field) and not connection.execute(
                    f"SELECT 1 FROM {COLLECTIONS[target].table} WHERE id = ?", (clean[field],)
                ).fetchone():
                    raise ManagerError(f"Unknown {COLLECTIONS[target].label.lower()} for {field}: {clean[field]}")
            for character_id in clean.get("participantIds", []) if name == "expeditions" else []:
                if not connection.execute("SELECT 1 FROM characters WHERE id = ?", (character_id,)).fetchone():
                    raise ManagerError(f"Unknown participant character: {character_id}")

            record = {**clean, "id": chosen_id}
            self._write_record(connection, name, chosen_id, record, insert=existing is None)
            if name == "characters" and existing and existing.get("portrait") != clean.get("portrait"):
                self._prune_media(connection, existing.get("portrait"))
        return {"id": chosen_id}

    def delete_record(self, name: str, record_id: str) -> None:
        spec = self._spec(name)
        with self._connect() as connection:
            existing = self._record(connection, name, record_id)
            if not existing:
                raise ManagerError(f"That {spec.label.lower()} no longer exists.")
            blockers = self._references_to(connection, name, record_id)
            if blockers:
                raise ManagerError(
                    f"Cannot delete {spec.label.lower()} “{spec.display(existing) or record_id}”: it is still referenced by "
                    f"{'; '.join(blockers)}. Update or delete those records first."
                )
            connection.execute(f"DELETE FROM {spec.table} WHERE id = ?", (record_id,))
            if name == "characters":
                self._prune_media(connection, existing.get("portrait"))

    def save_media(self, body: dict[str, Any]) -> dict[str, str]:
        match = re.fullmatch(r"data:([a-z/+]+);base64,(.+)", str(body.get("dataUrl") or ""), re.S)
        if not match or match[1] not in IMAGE_TYPES:
            raise ManagerError("Portraits must be PNG, JPEG, WebP, or GIF images.")
        try:
            content = base64.b64decode(match[2], validate=True)
        except (binascii.Error, ValueError) as error:
            raise ManagerError("The uploaded image could not be decoded.") from error
        if len(content) > MAX_IMAGE_BYTES:
            raise ManagerError("Portrait images must be 8 MB or smaller.")
        stem = slugify(Path(str(body.get("filename") or "portrait")).stem) or "portrait"
        filename = f"{stem}-{hashlib.sha1(content).hexdigest()[:8]}{IMAGE_TYPES[match[1]]}"
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO media (filename, content_type, content) VALUES (?, ?, ?)",
                (filename, match[1], content),
            )
        return {"path": f"{PORTRAIT_PREFIX}{filename}"}

    def media(self, filename: str) -> tuple[str, bytes] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT content_type, content FROM media WHERE filename = ?", (filename,)).fetchone()
        return (row["content_type"], bytes(row["content"])) if row else None

    # --- Import -------------------------------------------------------------

    def _read_rules(self) -> list[dict[str, Any]]:
        rules_path = self.data_dir / "rules.json"
        rules = read_json(rules_path) if rules_path.exists() else []
        if not isinstance(rules, list) or any(not isinstance(rule, dict) for rule in rules):
            raise ManagerError("Rules data must be a JSON array of objects.")
        seen_ids: set[str] = set()
        for rule in rules:
            rule_id = str(rule.get("id", "")).strip()
            if not rule_id or not str(rule.get("title", "")).strip() or not str(rule.get("category", "")).strip():
                raise ManagerError("Each rule needs an ID, title, and category.")
            if rule_id in seen_ids:
                raise ManagerError(f"Duplicate rule ID in static data: {rule_id}")
            seen_ids.add(rule_id)
        return rules

    def _read_site(self) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
        island_path = self.data_dir / "island.json"
        island = read_json(island_path) if island_path.exists() else {}
        # Fields the export derives (crew counts, a report's Gate) are not stored.
        derived = {"expeditions": {"crewCount"}, "reports": {"gateId"}}
        records: dict[str, list[dict[str, Any]]] = {}
        for plural in PAGE_COLLECTIONS:
            folder = self.data_dir / plural
            manifest_path = folder / "index.json"
            records[plural] = []
            for filename in read_json(manifest_path) if manifest_path.exists() else []:
                data = read_json(folder / filename)
                record = {key: value for key, value in data.items() if key not in derived.get(plural, set())}
                record["published"] = True
                if isinstance(record.get("sheet"), dict):
                    record["sheet"] = {**record["sheet"], "public": True}  # only public sheets are exported
                records[plural].append(record)
        return island, records

    def import_site(self) -> None:
        island, records = self._read_site()
        rules = self._read_rules()
        portraits_dir = self.data_dir / "portraits"
        with self._connect() as connection:
            for table in ("expedition_reports", "expedition_participants", "expeditions", "gates", "characters",
                          "media", "island_state", "rules"):
                connection.execute(f"DELETE FROM {table}")

            for name in ("characters", "gates", "expeditions", "reports"):
                seen: set[str] = set()
                for record in records[name]:
                    record_id = slugify(str(record.get("id") or ""))
                    if not record_id or record_id in seen:
                        raise ManagerError(f"Missing or duplicate {name} ID in static data: {record.get('id')}")
                    seen.add(record_id)
                    self._write_record(connection, name, record_id, {**record, "id": record_id}, insert=True)

            if portraits_dir.is_dir():
                content_types = {extension: kind for kind, extension in IMAGE_TYPES.items()} | {".jpeg": "image/jpeg"}
                for path in portraits_dir.iterdir():
                    content_type = content_types.get(path.suffix.lower())
                    if path.is_file() and content_type:
                        connection.execute(
                            "INSERT INTO media (filename, content_type, content) VALUES (?, ?, ?)",
                            (path.name, content_type, path.read_bytes()),
                        )

            connection.execute(
                "INSERT INTO island_state (id, data) VALUES (1, ?)",
                (json.dumps(island, ensure_ascii=False),),
            )
            for rule in rules:
                connection.execute(
                    "INSERT INTO rules (id, data) VALUES (?, ?)",
                    (str(rule["id"]), json.dumps(rule, ensure_ascii=False)),
                )
            connection.execute(
                "INSERT OR REPLACE INTO metadata (key, value) VALUES ('initialized', '1')"
            )

    # --- State --------------------------------------------------------------

    def state(self) -> dict[str, Any]:
        with self._connect() as connection:
            result: dict[str, Any] = {name: self._records(connection, name) for name in COLLECTIONS}
            island_row = connection.execute("SELECT data FROM island_state WHERE id = 1").fetchone()
            result["island"] = json.loads(island_row["data"]) if island_row else {}
        return result

    def save_island(self, data: Any) -> None:
        if not isinstance(data, dict):
            raise ManagerError("Island data must be an object.")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO island_state (id, data) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (json.dumps(data, ensure_ascii=False),),
            )

    # --- Export -------------------------------------------------------------

    def _build_data_export(self) -> tuple[dict[str, bytes], dict[str, int]]:
        """Build public JSON for published records only, dropping references to unpublished ones."""
        state = self.state()
        published = {name: {record["id"]: record for record in state[name] if record.get("published")} for name in COLLECTIONS}
        output: dict[str, bytes] = {}
        exported: dict[str, list[dict[str, Any]]] = {name: [] for name in PAGE_COLLECTIONS}

        for character in published["characters"].values():
            portrait = character.get("portrait")
            if isinstance(portrait, str) and portrait.startswith(PORTRAIT_PREFIX):
                media = self.media(portrait.removeprefix(PORTRAIT_PREFIX))
                if media:
                    output[f"portraits/{portrait.removeprefix(PORTRAIT_PREFIX)}"] = media[1]
                else:
                    character = {**character, "portrait": None}
            sheet = character.get("sheet")
            public_sheet = {key: value for key, value in sheet.items() if key != "public"} if sheet and sheet.get("public", True) else None
            exported["characters"].append({**character, "sheet": public_sheet})

        exported["gates"] = list(published["gates"].values())

        for expedition in published["expeditions"].values():
            participants = expedition.get("participantIds", [])
            exported["expeditions"].append({
                **expedition,
                "gateId": expedition.get("gateId") if expedition.get("gateId") in published["gates"] else None,
                "organizerId": expedition.get("organizerId") if expedition.get("organizerId") in published["characters"] else None,
                "participantIds": [item for item in participants if item in published["characters"]],
                "crewCount": len(participants),
            })

        public_expeditions = {expedition["id"]: expedition for expedition in exported["expeditions"]}
        for report in published["reports"].values():
            parent = public_expeditions.get(report["expeditionId"])
            if not parent:
                continue
            exported["reports"].append({
                **report,
                "gateId": parent.get("gateId"),
                "submittedBy": report.get("submittedBy") if report.get("submittedBy") in published["characters"] else None,
            })

        for name in PAGE_COLLECTIONS:
            fields = COLLECTIONS[name].public_fields
            filenames = []
            for record in exported[name]:
                filename = safe_filename(record["id"])
                filenames.append(filename)
                output[f"{name}/{filename}"] = json_bytes({field: record.get(field) for field in fields})
            output[f"{name}/index.json"] = json_bytes(sorted(filenames))

        rules = [{key: value for key, value in rule.items() if key != "published"} for rule in published["rules"].values()]
        output["island.json"] = json_bytes(state["island"])
        output["rules.json"] = json_bytes(rules)
        counts = {name: len(exported[name]) for name in PAGE_COLLECTIONS}
        counts["rules"] = len(rules)
        counts["unpublished"] = sum(len(state[name]) for name in COLLECTIONS) - sum(counts.values())
        return output, counts

    def sync_site_data(self) -> dict[str, int | str]:
        output, counts = self._build_data_export()
        if not self.site_dir.is_dir():
            raise ManagerError(f"Static site source folder does not exist: {self.site_dir}")

        site_dir = self.site_dir.resolve()
        data_dir = self.data_dir.resolve()
        if site_dir == data_dir or site_dir not in data_dir.parents:
            raise ManagerError("The data folder must be inside the static site source folder.")

        with tempfile.TemporaryDirectory(prefix=f".{self.data_dir.name}-sync-", dir=self.site_dir) as temporary_dir:
            temporary_root = Path(temporary_dir)
            staging_dir = temporary_root / "data"
            staging_dir.mkdir()
            for relative_path, content in output.items():
                target = (staging_dir / relative_path).resolve()
                if staging_dir.resolve() not in target.parents:
                    raise ManagerError("Refusing to sync outside the staged data folder.")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)

            backup_dir = temporary_root / "previous-data"
            had_previous_data = self.data_dir.exists()
            if had_previous_data:
                if not self.data_dir.is_dir():
                    raise ManagerError(f"Site data destination is not a directory: {self.data_dir}")
                os.replace(self.data_dir, backup_dir)
            try:
                os.replace(staging_dir, self.data_dir)
            except OSError:
                if had_previous_data and backup_dir.exists():
                    os.replace(backup_dir, self.data_dir)
                raise

        return {
            **counts,
            "files": len(output),
            "destination": str(self.data_dir.resolve()),
        }

    def export_site(self) -> dict[str, int | str]:
        output, counts = self._build_data_export()
        source_dir = self.site_dir.resolve()
        export_dir = self.export_dir.resolve()
        if source_dir == export_dir or source_dir in export_dir.parents or export_dir in source_dir.parents:
            raise ManagerError("The site export folder must be separate from the source public-site folder.")
        if not self.site_dir.is_dir():
            raise ManagerError(f"Static site source folder does not exist: {self.site_dir}")

        self.export_dir.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=f".{self.export_dir.name}-", dir=self.export_dir.parent) as temporary_dir:
            temporary_root = Path(temporary_dir)
            staging_dir = temporary_root / "staging"
            shutil.copytree(self.site_dir, staging_dir)
            # data/ is entirely generated from the database, so start it empty.
            staged_data = staging_dir / "data"
            if staged_data.exists():
                shutil.rmtree(staged_data)
            staged_data.mkdir(parents=True)

            for relative_path, content in output.items():
                target = (staged_data / relative_path).resolve()
                if staged_data.resolve() not in target.parents:
                    raise ManagerError("Refusing to export outside the staged public data folder.")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)

            site_file_count = sum(1 for path in staging_dir.rglob("*") if path.is_file())
            backup_dir = temporary_root / "previous"
            had_previous_export = self.export_dir.exists()
            if had_previous_export:
                if not self.export_dir.is_dir():
                    raise ManagerError(f"Site export destination is not a directory: {self.export_dir}")
                os.replace(self.export_dir, backup_dir)
            try:
                os.replace(staging_dir, self.export_dir)
            except OSError:
                if had_previous_export and backup_dir.exists():
                    os.replace(backup_dir, self.export_dir)
                raise

        return {
            **counts,
            "files": len(output),
            "siteFiles": site_file_count,
            "destination": str(self.export_dir.resolve()),
        }


def create_handler(store: ContentStore) -> type[BaseHTTPRequestHandler]:
    class ManagerHandler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_json(self, status: int, value: Any) -> None:
            self._send(status, json_bytes(value), "application/json; charset=utf-8")

        def _read_body(self) -> dict[str, Any]:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as error:
                raise ManagerError("Invalid request body length.") from error
            if length > 12_000_000:
                raise ManagerError("Request body is too large.")
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError as error:
                raise ManagerError("Request body must be valid JSON.") from error
            if not isinstance(body, dict):
                raise ManagerError("Request body must be a JSON object.")
            return body

        def _route_api(self, method: str) -> bool:
            path = unquote(urlsplit(self.path).path)
            parts = path.strip("/").split("/")
            if parts[0] != "api":
                return False
            collection = parts[1] if len(parts) > 1 else ""
            record_id = "/".join(parts[2:]) or None
            try:
                if method == "GET" and path == "/api/state":
                    self._send_json(200, store.state())
                elif method == "GET" and collection == "media" and record_id:
                    media = store.media(record_id)
                    if media:
                        self._send(200, media[1], media[0])
                    else:
                        self._send_json(404, {"error": "Image not found."})
                elif method == "POST" and path == "/api/media":
                    self._send_json(201, store.save_media(self._read_body()))
                elif method == "POST" and path == "/api/island":
                    store.save_island(self._read_body().get("data"))
                    self._send_json(200, {"saved": True})
                elif method == "POST" and path == "/api/export":
                    self._send_json(200, store.export_site())
                elif method == "POST" and path == "/api/sync":
                    self._send_json(200, store.sync_site_data())
                elif method == "POST" and path == "/api/import":
                    store.import_site()
                    self._send_json(200, {"imported": True})
                elif collection in COLLECTIONS and method == "POST" and not record_id:
                    self._send_json(201, store.save_record(collection, None, self._read_body().get("data")))
                elif collection in COLLECTIONS and method == "PUT" and record_id:
                    self._send_json(200, store.save_record(collection, record_id, self._read_body().get("data")))
                elif collection in COLLECTIONS and method == "DELETE" and record_id:
                    store.delete_record(collection, record_id)
                    self._send_json(200, {"deleted": True})
                else:
                    return False
            except ManagerError as error:
                self._send_json(400, {"error": str(error)})
            except sqlite3.IntegrityError as error:
                self._send_json(400, {"error": f"Record could not be saved: {error}"})
            return True

        def do_GET(self) -> None:
            if self._route_api("GET"):
                return
            path = urlsplit(self.path).path
            relative = "index.html" if path == "/" else path.removeprefix("/static/")
            if path != "/" and not path.startswith("/static/"):
                self._send(404, b"Not found", "text/plain; charset=utf-8")
                return
            target = (STATIC_DIR / relative).resolve()
            if STATIC_DIR.resolve() not in target.parents or not target.is_file():
                self._send(404, b"Not found", "text/plain; charset=utf-8")
                return
            content_type = "text/css; charset=utf-8" if target.suffix == ".css" else "text/javascript; charset=utf-8" if target.suffix == ".js" else "text/html; charset=utf-8"
            self._send(200, target.read_bytes(), content_type)

        def do_POST(self) -> None:
            if not self._route_api("POST"):
                self._send_json(404, {"error": "Not found."})

        def do_PUT(self) -> None:
            if not self._route_api("PUT"):
                self._send_json(404, {"error": "Not found."})

        def do_DELETE(self) -> None:
            if not self._route_api("DELETE"):
                self._send_json(404, {"error": "Not found."})

    return ManagerHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Nowhere Expeditions content manager")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--database", type=Path, default=APP_DIR / "content.db")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--export-dir", type=Path, default=None)
    args = parser.parse_args()

    store = ContentStore(args.database, args.data_dir, args.export_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), create_handler(store))
    print(f"Content manager ready at http://127.0.0.1:{args.port}")
    print(f"SQLite database: {args.database.resolve()}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping content manager.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
