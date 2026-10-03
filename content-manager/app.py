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
import threading
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
IMAGE_PREFIX = "data/images/"
MEDIA_PREFIXES = (PORTRAIT_PREFIX, IMAGE_PREFIX)
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
# Added to preview pages only. Inside the manager's preview frame, scrollIntoView would also scroll the
# manager page around the frame; this keeps page scrolling inside the frame. The public site is unchanged.
PREVIEW_FRAME_SCRIPT = b"""<script>
if (window.top !== window) {
  Element.prototype.scrollIntoView = function (options) {
    const top = this.getBoundingClientRect().top + window.scrollY;
    const block = options && typeof options === "object" ? options.block : "start";
    window.scrollTo(0, block === "center" ? top - window.innerHeight / 2 : block === "nearest" ? window.scrollY : top);
  };
}
</script>
"""
# Content types for files served by the preview of the public site.
PREVIEW_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon"}
MAX_IMAGE_BYTES = 8_000_000
SCHEMA_VERSION = 5

CHARACTER_TYPES = ("player", "npc")
CHARACTER_STATUSES = ("active", "inactive", "missing", "deceased")
GATE_STATUSES = ("active", "dormant", "collapsed", "lost")
JOB_TYPES = ("expedition", "recovery", "investigation", "escort", "bounty", "outpost", "other")
JOB_STATUSES = ("open", "scheduled", "in-progress", "completed", "failed", "cancelled")
ARCHIVE_TYPES = ("gate-record", "session-record", "newspaper", "history", "folklore")
SESSION_OUTCOMES = ("success", "partial", "failed", "aborted", "unknown")
GEAR_CATEGORIES = ("weapon", "armor", "tool", "medical", "consumable", "exploration", "utility", "special")
GEAR_AVAILABILITY = ("common", "restricted", "rare", "unavailable")
GAME_POST_TYPES = ("announcement", "rule")

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DATETIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?")
# Archive cross-references inside authored text: [[entry-id]] or [[entry-id|link text]].
ARCHIVE_LINK_RE = re.compile(r"\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]")


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


def media_filename(path: Any) -> str | None:
    """The media-table filename behind a site image path, or None for external/empty paths."""
    if isinstance(path, str):
        for prefix in MEDIA_PREFIXES:
            if path.startswith(prefix):
                return path.removeprefix(prefix)
    return None


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


def clean_ids(data: dict[str, Any], key: str, label: str) -> list[str]:
    value = data.get(key) or []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ManagerError(f"{label} must be a list of record IDs.")
    return list(dict.fromkeys(item.strip() for item in value if item.strip()))


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


def clean_stash(value: Any) -> list[dict[str, Any]]:
    """Gear a character owns. Entries reference Gear by ID; the same Gear never appears twice."""
    if value is None or value == "":
        return []
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ManagerError("The stash must be a list of Gear entries.")
    merged: dict[str, dict[str, Any]] = {}
    for item in value:
        gear_id = clean_ref(item, "gearId")
        if not gear_id:
            raise ManagerError("Every stash entry needs a Gear ID.")
        quantity = clean_int(item.get("quantity", 1), "Stash quantity", 1, 999)
        in_action = bool(item.get("broughtIntoAction", False))
        if gear_id in merged:
            merged[gear_id]["quantity"] = min(999, merged[gear_id]["quantity"] + quantity)
            merged[gear_id]["broughtIntoAction"] = merged[gear_id]["broughtIntoAction"] or in_action
        else:
            merged[gear_id] = {"gearId": gear_id, "quantity": quantity, "broughtIntoAction": in_action}
    return list(merged.values())


def clean_character(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": clean_text(data, "name", "A character name"),
        "type": clean_choice(data, "type", CHARACTER_TYPES, "player"),
        "status": clean_choice(data, "status", CHARACTER_STATUSES, "active"),
        "portrait": clean_text(data, "portrait") or None,
        "summary": clean_text(data, "summary"),
        "playerName": clean_text(data, "playerName"),
        "sheet": clean_sheet(data.get("sheet")),
        "stash": clean_stash(data.get("stash")),
    }


def clean_job(data: dict[str, Any]) -> dict[str, Any]:
    crew_min = clean_count(data, "crewMin", "Minimum crew")
    crew_max = clean_count(data, "crewMax", "Maximum crew")
    if crew_min is not None and crew_max is not None and crew_min > crew_max:
        raise ManagerError("Minimum crew cannot be larger than maximum crew.")
    return {
        "designation": clean_text(data, "designation"),
        "title": clean_text(data, "title", "A job title"),
        "type": clean_choice(data, "type", JOB_TYPES, "expedition"),
        "status": clean_choice(data, "status", JOB_STATUSES, "open"),
        "summary": clean_text(data, "summary"),
        "objective": clean_text(data, "objective"),
        "briefing": clean_text(data, "briefing"),
        "postedBy": clean_text(data, "postedBy"),
        "organizerId": clean_ref(data, "organizerId"),
        "scheduledAt": clean_pattern(data, "scheduledAt", DATETIME_RE, "Scheduled date"),
        "expectedDuration": clean_text(data, "expectedDuration"),
        "crewMin": crew_min,
        "crewMax": crew_max,
        "participantIds": clean_ids(data, "participantIds", "Participants"),
        "requirements": clean_list(data, "requirements"),
        "sessionRecordId": clean_ref(data, "sessionRecordId"),
    }


def clean_archive_details(entry_type: str, details: Any) -> dict[str, Any]:
    """Type-specific metadata. Types without extra metadata keep an empty object."""
    details = details if isinstance(details, dict) else {}
    if entry_type == "gate-record":
        return {
            "designation": clean_text(details, "designation", "A Gate designation"),
            "gateStatus": clean_choice(details, "gateStatus", GATE_STATUSES, "active"),
            "discoveredAt": clean_pattern(details, "discoveredAt", DATE_RE, "Discovered date"),
            "environment": clean_text(details, "environment"),
            "knownTraits": clean_list(details, "knownTraits"),
            "knownHazards": clean_list(details, "knownHazards"),
            "knownLocations": clean_list(details, "knownLocations"),
        }
    if entry_type == "session-record":
        return {
            "sessionDate": clean_pattern(details, "sessionDate", DATE_RE, "Session date"),
            "outcome": clean_choice(details, "outcome", SESSION_OUTCOMES, "unknown"),
        }
    return {}


def clean_archive_entry(data: dict[str, Any]) -> dict[str, Any]:
    entry_type = clean_choice(data, "type", ARCHIVE_TYPES, "history")
    return {
        "type": entry_type,
        "title": clean_text(data, "title", "An Archive title"),
        "subtitle": clean_text(data, "subtitle"),
        "summary": clean_text(data, "summary"),
        "content": clean_text(data, "content"),
        "author": clean_text(data, "author"),
        "publishedAt": clean_pattern(data, "publishedAt", DATE_RE, "Published date"),
        "eventDate": clean_text(data, "eventDate"),
        "image": clean_text(data, "image") or None,
        "tags": clean_list(data, "tags"),
        # Only Session Records carry a crew; other types never store participants.
        "participantIds": clean_ids(data, "participantIds", "Participants") if entry_type == "session-record" else [],
        "details": clean_archive_details(entry_type, data.get("details")),
    }


def clean_gear(data: dict[str, Any]) -> dict[str, Any]:
    price = clean_count(data, "price", "Price")
    discount = data.get("discount")
    clean_discount = None
    if isinstance(discount, dict) and (discount.get("active") or discount.get("salePrice") not in (None, "")):
        sale = clean_count(discount, "salePrice", "Sale price")
        active = bool(discount.get("active"))
        if active and sale is None:
            raise ManagerError("An active discount needs a sale price.")
        if active and price is not None and sale is not None and sale >= price:
            raise ManagerError("The sale price must be lower than the regular price.")
        clean_discount = {"active": active, "salePrice": sale}
    elif discount not in (None, "", {}) and not isinstance(discount, dict):
        raise ManagerError("discount must be an object.")
    label = clean_text(data, "promoLabel").upper()
    if len(label) > 24:
        raise ManagerError("Promotional labels must be 24 characters or fewer.")
    return {
        "name": clean_text(data, "name", "A Gear name"),
        "category": clean_choice(data, "category", GEAR_CATEGORIES, "tool"),
        "description": clean_text(data, "description"),
        "price": price if price is not None else 0,
        "weight": clean_count(data, "weight", "Weight") or 0,
        "availability": clean_choice(data, "availability", GEAR_AVAILABILITY, "common"),
        "image": clean_text(data, "image") or None,
        "tags": clean_list(data, "tags"),
        "featured": bool(data.get("featured", False)),
        "promoLabel": label,
        "discount": clean_discount,
    }


def clean_game_post(data: dict[str, Any]) -> dict[str, Any]:
    """Out-of-character notes on the Game page: announcements and campaign rules."""
    post_type = clean_choice(data, "type", GAME_POST_TYPES, "rule")
    announcement = post_type == "announcement"
    published_at = clean_pattern(data, "publishedAt", DATE_RE, "Posted date")
    show_until = clean_pattern(data, "showUntil", DATE_RE, "Show until date") if announcement else ""
    if announcement and not published_at:
        raise ManagerError("An announcement needs a posted date.")
    if show_until and show_until < published_at:
        raise ManagerError("Show until cannot be earlier than the posted date.")
    return {
        "type": post_type,
        "title": clean_text(data, "title", "A title"),
        "category": clean_text(data, "category") if announcement else clean_text(data, "category", "A rule category"),
        "summary": clean_text(data, "summary"),
        "details": clean_text(data, "details"),
        "tags": clean_list(data, "tags"),
        "publishedAt": published_at,
        "pinned": bool(data.get("pinned")) if announcement else False,
        "showUntil": show_until,
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
    # ID-list field -> (link table, owner column, target column, target collection), kept in order.
    links: tuple[tuple[str, str, str, str, str], ...] = ()
    # Returns (label, value) that must be unique within the collection, or None.
    unique: Callable[[dict[str, Any]], tuple[str, str] | None] | None = None
    # Public JSON fields, one file per record. Empty means the collection is written as a single combined file.
    public_fields: tuple[str, ...] = ()
    # Fields holding site image paths (uploaded images live in the media table).
    image_fields: tuple[str, ...] = ()
    # Authored text fields that may contain [[archive-id]] links.
    text_fields: tuple[str, ...] = ()


def _designated(record: dict[str, Any], name_field: str) -> str:
    return " · ".join(part for part in (record.get("designation"), record.get(name_field)) if part)


def _gate_designation(record: dict[str, Any]) -> tuple[str, str] | None:
    designation = (record.get("details") or {}).get("designation")
    return ("Gate designation", designation) if record.get("type") == "gate-record" and designation else None


# Order matters: records are imported in this order, so referenced collections come first.
COLLECTIONS: dict[str, Collection] = {
    "gear": Collection(
        "gear", "Gear", ("name",), clean_gear, lambda record: str(record.get("name", "")),
        public_fields=("id", "name", "category", "description", "price", "weight", "availability", "image", "tags",
                       "featured", "promoLabel", "discount"),
        image_fields=("image",), text_fields=("description",),
    ),
    "characters": Collection(
        "characters", "Character", ("name",), clean_character, lambda record: str(record.get("name", "")),
        public_fields=("id", "name", "type", "status", "portrait", "summary", "playerName", "sheet", "stash"),
        image_fields=("portrait",),
    ),
    "archive": Collection(
        "archive_entries", "Archive entry", ("title",), clean_archive_entry, lambda record: str(record.get("title", "")),
        links=(("participantIds", "archive_participants", "entry_id", "character_id", "characters"),),
        unique=_gate_designation,
        public_fields=("id", "type", "title", "subtitle", "summary", "content", "author", "publishedAt", "eventDate",
                       "image", "tags", "participantIds", "details"),
        image_fields=("image",), text_fields=("summary", "content"),
    ),
    "jobs": Collection(
        "jobs", "Job", ("designation", "title"), clean_job, lambda record: _designated(record, "title"),
        refs=(("organizerId", "organizer_id", "characters"), ("sessionRecordId", "session_record_id", "archive")),
        links=(("participantIds", "job_participants", "job_id", "character_id", "characters"),),
        unique=lambda record: ("designation", record["designation"]) if record.get("designation") else None,
        public_fields=("id", "designation", "title", "type", "status", "summary", "objective", "briefing", "postedBy",
                       "organizerId", "scheduledAt", "expectedDuration", "crewCount", "crewMin", "crewMax",
                       "participantIds", "requirements", "sessionRecordId"),
        text_fields=("summary", "objective", "briefing"),
    ),
    # Announcements and rules share one combined public file, game.json.
    "game": Collection(
        "game_posts", "Game post", ("title",), clean_game_post, lambda record: str(record.get("title", "")),
        text_fields=("summary", "details"),
    ),
}
PAGE_COLLECTIONS = ("gear", "characters", "archive", "jobs")
GAME_FIELDS = ("id", "type", "title", "category", "summary", "details", "tags", "publishedAt", "pinned", "showUntil")


# --- Store ------------------------------------------------------------------

class ContentStore:
    def __init__(self, database_path: Path, data_dir: Path, export_dir: Path | None = None):
        self.database_path = Path(database_path)
        self.data_dir = Path(data_dir)
        self.site_dir = self.data_dir.parent
        self.export_dir = Path(export_dir) if export_dir else self.site_dir.parent / "site-export"
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.migration_report: list[str] = []
        # Preview: an unsaved record from the editor, and the data built for it (rebuilt when anything changes).
        self._preview_lock = threading.Lock()
        self._preview_draft: dict[str, Any] | None = None
        self._preview_version = 0
        self._preview_cache: tuple[tuple[Any, ...], dict[str, bytes]] | None = None
        if self._has_legacy_schema():
            self.migration_report = self._migrate_from_v3()
        self._create_schema()
        self.migration_report += self._migrate_rules_to_game()
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
                CREATE TABLE IF NOT EXISTS outpost_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS game_posts (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS gear (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS characters (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS character_stash (
                    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
                    gear_id TEXT NOT NULL REFERENCES gear(id) ON DELETE RESTRICT,
                    quantity INTEGER NOT NULL CHECK (quantity > 0),
                    brought_into_action INTEGER NOT NULL DEFAULT 0,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (character_id, gear_id)
                );
                CREATE TABLE IF NOT EXISTS archive_entries (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS archive_participants (
                    entry_id TEXT NOT NULL REFERENCES archive_entries(id) ON DELETE CASCADE,
                    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (entry_id, character_id)
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    organizer_id TEXT REFERENCES characters(id) ON DELETE RESTRICT,
                    session_record_id TEXT REFERENCES archive_entries(id) ON DELETE RESTRICT,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_participants (
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (job_id, character_id)
                );
                CREATE TABLE IF NOT EXISTS media (
                    filename TEXT PRIMARY KEY,
                    content_type TEXT NOT NULL,
                    content BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS legacy_records (
                    source TEXT NOT NULL,
                    id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    PRIMARY KEY (source, id)
                );
                CREATE INDEX IF NOT EXISTS archive_type ON archive_entries(type);
                CREATE INDEX IF NOT EXISTS jobs_session_record ON jobs(session_record_id);
                CREATE INDEX IF NOT EXISTS stash_gear ON character_stash(gear_id);
                """
            )
            connection.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schemaVersion', ?)", (str(SCHEMA_VERSION),))

    # --- Migration from the v3 schema (Island, Gates, Expeditions, Reports) --

    def _has_legacy_schema(self) -> bool:
        if not self.database_path.exists():
            return False
        with self._connect() as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        return bool(tables & {"gates", "expeditions", "expedition_reports", "island_state"})

    def _migrate_from_v3(self) -> list[str]:
        """Convert a v3 database in place. The original file is copied first and every source row is kept
        in legacy_records, so nothing is lost even where the new model has no equivalent field."""
        backup = self.database_path.with_name(f"{self.database_path.stem}.v3-backup.db")
        suffix = 2
        while backup.exists():
            backup = self.database_path.with_name(f"{self.database_path.stem}.v3-backup-{suffix}.db")
            suffix += 1
        shutil.copy2(self.database_path, backup)
        report = [f"Backed up the v3 database to {backup.name}."]
        self._create_schema()

        with self._connect() as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}

            def rows(table: str) -> list[dict[str, Any]]:
                return [dict(row) for row in connection.execute(f"SELECT * FROM {table}")] if table in tables else []

            gates, expeditions = rows("gates"), rows("expeditions")
            participants, reports = rows("expedition_participants"), rows("expedition_reports")
            island = rows("island_state")
            for source, items in (("gates", gates), ("expeditions", expeditions), ("expedition_reports", reports),
                                  ("island_state", island)):
                for item in items:
                    connection.execute("INSERT OR REPLACE INTO legacy_records (source, id, data) VALUES (?, ?, ?)",
                                       (source, str(item["id"]), json.dumps(item, ensure_ascii=False)))
            crews: dict[str, list[str]] = {}
            for row in sorted(participants, key=lambda row: row["position"]):
                crews.setdefault(row["expedition_id"], []).append(row["character_id"])
            connection.execute("INSERT OR REPLACE INTO legacy_records (source, id, data) VALUES (?, ?, ?)",
                               ("expedition_participants", "all", json.dumps(participants)))

            characters = {row["id"]: json.loads(row["data"]) for row in connection.execute("SELECT id, data FROM characters")}
            gate_data = {gate["id"]: json.loads(gate["data"]) for gate in gates}
            expedition_data = {item["id"]: {**json.loads(item["data"]), "gateId": item.get("gate_id"),
                                            "organizerId": item.get("organizer_id")} for item in expeditions}
            report_data = {item["id"]: {**json.loads(item["data"]), "expeditionId": item["expedition_id"],
                                        "submittedBy": item.get("submitted_by")} for item in reports}
            taken = set(gate_data) | set(report_data)
            if len(taken) != len(gate_data) + len(report_data):
                raise ManagerError("Gate and Report IDs collide; resolve the duplicate before migrating.")

            def label(record: dict[str, Any], name_field: str) -> str:
                return _designated(record, name_field) or record.get(name_field) or ""

            # Reports become Session Records.
            reports_by_expedition: dict[str, list[str]] = {}
            for report_id, item in sorted(report_data.items(), key=lambda pair: (pair[1].get("submittedAt") or "", pair[0])):
                reports_by_expedition.setdefault(item["expeditionId"], []).append(report_id)
                expedition = expedition_data.get(item["expeditionId"], {})
                sections = [item.get("notes", "")]
                for heading, key in (("Discoveries", "discoveries"), ("Hazards encountered", "hazards"),
                                     ("Recovered", "recoveredItems"), ("Casualties", "casualties")):
                    if item.get(key):
                        sections.append(f"## {heading}\n" + "\n".join(f"- {line}" for line in item[key]))
                author = characters.get(item.get("submittedBy") or "", {}).get("name", "")
                scheduled = (expedition.get("scheduledAt") or "").split("T")[0]
                entry = {
                    "type": "session-record", "title": item.get("title", report_id), "subtitle": "",
                    "summary": item.get("summary", ""), "content": "\n\n".join(part for part in sections if part),
                    "author": author, "publishedAt": item.get("submittedAt", ""), "eventDate": "", "image": None, "tags": [],
                    "details": {"sessionDate": scheduled or item.get("submittedAt", ""), "outcome": item.get("outcome", "unknown")},
                    "published": item.get("published", False),
                    "legacy": {"source": "expedition_reports", "expeditionId": item["expeditionId"],
                               "submittedBy": item.get("submittedBy")},
                }
                connection.execute("INSERT INTO archive_entries (id, type, data) VALUES (?, ?, ?)",
                                   (report_id, entry["type"], json.dumps(entry, ensure_ascii=False)))
                for position, character_id in enumerate(crews.get(item["expeditionId"], [])):
                    connection.execute("INSERT INTO archive_participants (entry_id, character_id, position) VALUES (?, ?, ?)",
                                       (report_id, character_id, position))
                if item.get("submittedBy"):
                    report.append(f"Session Record {report_id}: submittedBy reference stored as author text “{author}”.")

            # Gates become Gate Records; their expedition history becomes links in the record's content.
            for gate_id, item in gate_data.items():
                history = []
                for expedition_id, expedition in sorted(expedition_data.items()):
                    if expedition.get("gateId") != gate_id:
                        continue
                    records = ", ".join(f"[[{report_id}]]" for report_id in reports_by_expedition.get(expedition_id, []))
                    history.append(f"- [{label(expedition, 'title')}](jobs.html#{expedition_id})"
                                   + (f" — session records: {records}" if records else ""))
                content = item.get("overview", "")
                if history:
                    content = "\n\n".join(part for part in (content, "## Expedition history\n" + "\n".join(history)) if part)
                entry = {
                    "type": "gate-record", "title": item.get("name", gate_id), "subtitle": "", "summary": "",
                    "content": content, "author": "", "publishedAt": "", "eventDate": "", "image": None, "tags": [],
                    "details": {
                        "designation": item.get("designation", ""), "gateStatus": item.get("status", "active"),
                        "discoveredAt": item.get("discoveredAt", ""), "environment": item.get("environment", ""),
                        "knownTraits": item.get("knownTraits", []), "knownHazards": item.get("knownHazards", []),
                        "knownLocations": item.get("knownLocations", []),
                    },
                    "published": item.get("published", False),
                    "legacy": {"source": "gates", "overview": item.get("overview", "")},
                }
                connection.execute("INSERT INTO archive_entries (id, type, data) VALUES (?, ?, ?)",
                                   (gate_id, entry["type"], json.dumps(entry, ensure_ascii=False)))

            # Expeditions become Jobs of type "expedition" (or the closest new type).
            type_map = {"exploration": "expedition", "recovery": "recovery", "research": "investigation", "rescue": "other"}
            status_map = {"recruiting": "open", "scheduled": "scheduled", "underway": "in-progress",
                          "completed": "completed", "cancelled": "cancelled"}
            for expedition_id, item in expedition_data.items():
                linked = reports_by_expedition.get(expedition_id, [])
                briefing = [item.get("briefing", "")]
                if item.get("gateId"):
                    briefing.append(f"Gate: [[{item['gateId']}]]")
                if len(linked) > 1:
                    briefing.append("Further session records: " + ", ".join(f"[[{report_id}]]" for report_id in linked[1:]))
                    report.append(f"Job {expedition_id} had {len(linked)} reports; {linked[0]} is its Session Record, "
                                  f"the others are linked from its briefing.")
                old_type, old_status = item.get("type", "exploration"), item.get("status", "recruiting")
                job = {
                    "designation": item.get("designation", ""), "title": item.get("title", expedition_id),
                    "type": type_map.get(old_type, "other"), "status": status_map.get(old_status, "open"),
                    "summary": "", "objective": item.get("objective", ""),
                    "briefing": "\n\n".join(part for part in briefing if part), "postedBy": "",
                    "scheduledAt": item.get("scheduledAt", ""), "expectedDuration": item.get("expectedDuration", ""),
                    "crewMin": item.get("crewMin"), "crewMax": item.get("crewMax"),
                    "requirements": item.get("requirements", []), "published": item.get("published", False),
                    "legacy": {"source": "expeditions", "gateId": item.get("gateId"), "type": old_type, "status": old_status},
                }
                if old_type not in type_map:
                    report.append(f"Job {expedition_id}: unknown expedition type “{old_type}” mapped to “other”.")
                if old_type == "rescue":
                    report.append(f"Job {expedition_id}: expedition type “rescue” has no Job equivalent; mapped to “other”.")
                connection.execute(
                    "INSERT INTO jobs (id, organizer_id, session_record_id, data) VALUES (?, ?, ?, ?)",
                    (expedition_id, item.get("organizerId"), linked[0] if linked else None, json.dumps(job, ensure_ascii=False)),
                )
                for position, character_id in enumerate(crews.get(expedition_id, [])):
                    connection.execute("INSERT INTO job_participants (job_id, character_id, position) VALUES (?, ?, ?)",
                                       (expedition_id, character_id, position))

            # The Island Sheet becomes the Outpost Sheet; the settlement's name changes with it.
            if island:
                outpost = outpost_terminology(json.loads(island[0]["data"]))
                connection.execute("INSERT OR REPLACE INTO outpost_state (id, data) VALUES (1, ?)",
                                   (json.dumps(outpost, ensure_ascii=False),))
            for row in connection.execute("SELECT id, data FROM rules").fetchall():
                updated = outpost_terminology(json.loads(row["data"]))
                connection.execute("UPDATE rules SET data = ? WHERE id = ?", (json.dumps(updated, ensure_ascii=False), row["id"]))
            report.append("Rewrote Island/Gate Archive/Expedition Board terminology in the Outpost Sheet and rules text.")

            for table in ("expedition_reports", "expedition_participants", "expeditions", "gates", "island_state"):
                connection.execute(f"DROP TABLE IF EXISTS {table}")
            connection.execute("DROP INDEX IF EXISTS expeditions_gate")
            connection.execute("DROP INDEX IF EXISTS reports_expedition")
            report.append(f"Migrated {len(gates)} Gates, {len(reports)} Reports and {len(expeditions)} Expeditions; "
                          f"source rows are kept in legacy_records.")
            connection.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('migrationReport', ?)",
                               (json.dumps(report, ensure_ascii=False),))
        return report

    def _migrate_rules_to_game(self) -> list[str]:
        """Schema v5: the Rules collection became Game posts of type "rule". Rows keep their IDs and categories,
        and the originals are copied to legacy_records."""
        with self._connect() as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if "rules" not in tables:
                return []
            rows = connection.execute("SELECT id, data FROM rules").fetchall()
            for row in rows:
                connection.execute("INSERT OR REPLACE INTO legacy_records (source, id, data) VALUES ('rules', ?, ?)",
                                   (row["id"], row["data"]))
                data = {key: value for key, value in json.loads(row["data"]).items() if key != "id"}
                data.setdefault("published", True)
                post = {"type": "rule", "publishedAt": "", "pinned": False, "showUntil": "", **data}
                connection.execute("INSERT OR REPLACE INTO game_posts (id, data) VALUES (?, ?)",
                                   (row["id"], json.dumps(post, ensure_ascii=False)))
            connection.execute("DROP TABLE rules")
        return [f"Moved {len(rows)} rules into the Game section as rule posts."]

    # --- Record persistence -------------------------------------------------

    def _spec(self, name: str) -> Collection:
        if name not in COLLECTIONS:
            raise ManagerError(f"Unknown content type: {name}")
        return COLLECTIONS[name]

    def _write_record(self, connection: sqlite3.Connection, name: str, record_id: str, record: dict[str, Any], insert: bool) -> None:
        spec = COLLECTIONS[name]
        stored_elsewhere = {"id", *(ref[0] for ref in spec.refs), *(link[0] for link in spec.links)}
        if name == "characters":
            stored_elsewhere.add("stash")
        data = {key: value for key, value in record.items() if key not in stored_elsewhere}
        columns = ["data", *(column for _, column, _ in spec.refs)]
        values = [json.dumps(data, ensure_ascii=False), *(record.get(field) for field, _, _ in spec.refs)]
        if name == "archive":
            columns.append("type")
            values.append(record.get("type") or "history")
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
        for field, table, owner, target, _ in spec.links:
            connection.execute(f"DELETE FROM {table} WHERE {owner} = ?", (record_id,))
            for position, target_id in enumerate(record.get(field) or []):
                connection.execute(f"INSERT INTO {table} ({owner}, {target}, position) VALUES (?, ?, ?)",
                                   (record_id, target_id, position))
        if name == "characters":
            connection.execute("DELETE FROM character_stash WHERE character_id = ?", (record_id,))
            for position, item in enumerate(record.get("stash") or []):
                connection.execute(
                    "INSERT INTO character_stash (character_id, gear_id, quantity, brought_into_action, position) VALUES (?, ?, ?, ?, ?)",
                    (record_id, item["gearId"], item["quantity"], int(bool(item["broughtIntoAction"])), position),
                )

    def _records(self, connection: sqlite3.Connection, name: str) -> list[dict[str, Any]]:
        spec = COLLECTIONS[name]
        linked: dict[str, dict[str, list[str]]] = {}
        for field, table, owner, target, _ in spec.links:
            linked[field] = {}
            for row in connection.execute(f"SELECT {owner} AS owner, {target} AS target FROM {table} ORDER BY position"):
                linked[field].setdefault(row["owner"], []).append(row["target"])
        stashes: dict[str, list[dict[str, Any]]] = {}
        if name == "characters":
            for row in connection.execute("SELECT * FROM character_stash ORDER BY position"):
                stashes.setdefault(row["character_id"], []).append(
                    {"gearId": row["gear_id"], "quantity": row["quantity"], "broughtIntoAction": bool(row["brought_into_action"])})
        columns = ", ".join(["id", "data", *(column for _, column, _ in spec.refs)])
        records = []
        for row in connection.execute(f"SELECT {columns} FROM {spec.table} ORDER BY id"):
            data = json.loads(row["data"])
            # Older rows may carry no flag; everything that came from the public files is published.
            data.setdefault("published", True)
            for field, column, _ in spec.refs:
                data[field] = row[column]
            for field in linked:
                data[field] = linked[field].get(row["id"], [])
            if name == "characters":
                data["stash"] = stashes.get(row["id"], [])
            records.append({"id": row["id"], **data})
        return records

    def _record(self, connection: sqlite3.Connection, name: str, record_id: str) -> dict[str, Any] | None:
        return next((record for record in self._records(connection, name) if record["id"] == record_id), None)

    def _references_to(self, connection: sqlite3.Connection, name: str, record_id: str) -> list[str]:
        """Describe every record that points at `name`/`record_id`."""
        blockers = []
        for other in COLLECTIONS.values():
            for field, column, target in other.refs:
                if target != name:
                    continue
                for row in connection.execute(f"SELECT id, data FROM {other.table} WHERE {column} = ?", (record_id,)):
                    blockers.append(f"{other.label} “{other.display(json.loads(row['data'])) or row['id']}” ({field})")
            for field, table, owner, target_column, target in other.links:
                if target != name:
                    continue
                for row in connection.execute(
                    f"SELECT o.id, o.data FROM {table} l JOIN {other.table} o ON o.id = l.{owner} WHERE l.{target_column} = ?",
                    (record_id,),
                ):
                    blockers.append(f"{other.label} “{other.display(json.loads(row['data'])) or row['id']}” (participant)")
        if name == "gear":
            for row in connection.execute(
                "SELECT c.id, c.data FROM character_stash s JOIN characters c ON c.id = s.character_id WHERE s.gear_id = ?",
                (record_id,),
            ):
                blockers.append(f"Character “{json.loads(row['data']).get('name') or row['id']}” (stash)")
        return blockers

    def _prune_media(self, connection: sqlite3.Connection, path: Any) -> None:
        filename = media_filename(path)
        if not filename:
            return
        for spec_name, spec in COLLECTIONS.items():
            for record in self._records(connection, spec_name) if spec.image_fields else []:
                if any(media_filename(record.get(field)) == filename for field in spec.image_fields):
                    return
        connection.execute("DELETE FROM media WHERE filename = ?", (filename,))

    def save_record(self, name: str, record_id: str | None, data: Any) -> dict[str, str]:
        spec = self._spec(name)
        if not isinstance(data, dict):
            raise ManagerError(f"{spec.label} data must be an object.")
        clean = spec.clean(data)
        clean["published"] = bool(data.get("published", False))
        include_samples = self.include_samples()

        with self._connect() as connection:
            existing = None
            if record_id:
                existing = self._record(connection, name, record_id)
                if not existing:
                    raise ManagerError(f"That {spec.label.lower()} no longer exists.")
                chosen_id = record_id
                if existing.get("legacy"):
                    clean["legacy"] = existing["legacy"]  # provenance of migrated records survives edits
                if not include_samples:
                    self._keep_hidden_references(connection, spec, existing, clean)
            else:
                requested = slugify(str(data.get("id") or ""))
                if requested:
                    if connection.execute(f"SELECT 1 FROM {spec.table} WHERE id = ?", (requested,)).fetchone():
                        raise ManagerError(f"Another {spec.label.lower()} already uses the ID “{requested}”.")
                    chosen_id = requested
                else:
                    stem_source = (clean.get("details") or {}).get("designation") if name == "archive" else None
                    candidates = [stem_source, *(clean.get(field) for field in spec.id_fields)]
                    stem = next((slugify(str(value)) for value in candidates if value and slugify(str(value))), "") or slugify(spec.label)
                    chosen_id, suffix = stem, 2
                    while connection.execute(f"SELECT 1 FROM {spec.table} WHERE id = ?", (chosen_id,)).fetchone():
                        chosen_id, suffix = f"{stem}-{suffix}", suffix + 1

            wanted = spec.unique(clean) if spec.unique else None
            if wanted:
                for other in self._records(connection, name):
                    theirs = spec.unique(other) if other["id"] != chosen_id else None
                    if theirs and theirs[0] == wanted[0] and slugify(theirs[1]) == slugify(wanted[1]):
                        raise ManagerError(f"Another {spec.label.lower()} already uses the {wanted[0]} “{wanted[1]}”.")

            for field, _, target in spec.refs:
                if clean.get(field) and not connection.execute(
                    f"SELECT 1 FROM {COLLECTIONS[target].table} WHERE id = ?", (clean[field],)
                ).fetchone():
                    raise ManagerError(f"Unknown {COLLECTIONS[target].label.lower()} for {field}: {clean[field]}")
            for field, _, _, _, target in spec.links:
                for target_id in clean.get(field) or []:
                    if not connection.execute(f"SELECT 1 FROM {COLLECTIONS[target].table} WHERE id = ?", (target_id,)).fetchone():
                        raise ManagerError(f"Unknown participant character: {target_id}")
            if name == "jobs" and clean.get("sessionRecordId"):
                row = connection.execute("SELECT type FROM archive_entries WHERE id = ?", (clean["sessionRecordId"],)).fetchone()
                if row["type"] != "session-record":
                    raise ManagerError("A Job's Session Record must be an Archive entry of type session-record.")
            if name == "archive" and existing and existing.get("type") == "session-record" and clean["type"] != "session-record":
                for row in connection.execute("SELECT id FROM jobs WHERE session_record_id = ?", (chosen_id,)):
                    raise ManagerError(f"Job “{row['id']}” uses this entry as its Session Record; detach it before changing the type.")
            for item in clean.get("stash") or [] if name == "characters" else []:
                if not connection.execute("SELECT 1 FROM gear WHERE id = ?", (item["gearId"],)).fetchone():
                    raise ManagerError(f"Unknown Gear in stash: {item['gearId']}")

            clean["sample"] = bool(data["sample"]) if "sample" in data else bool(existing and existing.get("sample"))
            record = {**clean, "id": chosen_id}
            self._write_record(connection, name, chosen_id, record, insert=existing is None)
            for field in spec.image_fields if existing else ():
                if existing.get(field) != clean.get(field):
                    self._prune_media(connection, existing.get(field))
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
            for field in spec.image_fields:
                self._prune_media(connection, existing.get(field))

    def save_media(self, body: dict[str, Any]) -> dict[str, str]:
        match = re.fullmatch(r"data:([a-z/+]+);base64,(.+)", str(body.get("dataUrl") or ""), re.S)
        if not match or match[1] not in IMAGE_TYPES:
            raise ManagerError("Images must be PNG, JPEG, WebP, or GIF files.")
        try:
            content = base64.b64decode(match[2], validate=True)
        except (binascii.Error, ValueError) as error:
            raise ManagerError("The uploaded image could not be decoded.") from error
        if len(content) > MAX_IMAGE_BYTES:
            raise ManagerError("Images must be 8 MB or smaller.")
        stem = slugify(Path(str(body.get("filename") or "image")).stem) or "image"
        filename = f"{stem}-{hashlib.sha1(content).hexdigest()[:8]}{IMAGE_TYPES[match[1]]}"
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO media (filename, content_type, content) VALUES (?, ?, ?)",
                (filename, match[1], content),
            )
        prefix = PORTRAIT_PREFIX if body.get("kind", "portrait") == "portrait" else IMAGE_PREFIX
        return {"path": f"{prefix}{filename}"}

    def media(self, filename: str) -> tuple[str, bytes] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT content_type, content FROM media WHERE filename = ?", (filename,)).fetchone()
        return (row["content_type"], bytes(row["content"])) if row else None

    # --- Import -------------------------------------------------------------

    def _read_game(self) -> list[dict[str, Any]]:
        game_path = self.data_dir / "game.json"
        legacy_path = self.data_dir / "rules.json"
        posts = read_json(game_path) if game_path.exists() else read_json(legacy_path) if legacy_path.exists() else []
        if not isinstance(posts, list) or any(not isinstance(post, dict) for post in posts):
            raise ManagerError("Game data must be a JSON array of objects.")
        seen_ids: set[str] = set()
        for post in posts:
            post_id = str(post.get("id", "")).strip()
            if not post_id or not str(post.get("title", "")).strip():
                raise ManagerError("Each Game post needs an ID and a title.")
            if post_id in seen_ids:
                raise ManagerError(f"Duplicate Game post ID in static data: {post_id}")
            seen_ids.add(post_id)
            post.setdefault("type", "rule")
        return posts

    def _read_site(self) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
        outpost_path = self.data_dir / "outpost.json"
        outpost = read_json(outpost_path) if outpost_path.exists() else {}
        # Fields the export derives (crew counts) are not stored.
        derived = {"jobs": {"crewCount"}}
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
        return outpost, records

    def import_site(self) -> None:
        outpost, records = self._read_site()
        posts = self._read_game()
        media_dirs = [self.data_dir / "portraits", self.data_dir / "images"]
        with self._connect() as connection:
            for table in ("character_stash", "job_participants", "archive_participants", "jobs", "archive_entries",
                          "characters", "gear", "media", "outpost_state", "game_posts"):
                connection.execute(f"DELETE FROM {table}")

            for name in PAGE_COLLECTIONS:
                seen: set[str] = set()
                for record in records[name]:
                    record_id = slugify(str(record.get("id") or ""))
                    if not record_id or record_id in seen:
                        raise ManagerError(f"Missing or duplicate {name} ID in static data: {record.get('id')}")
                    seen.add(record_id)
                    self._write_record(connection, name, record_id, {**record, "id": record_id}, insert=True)

            content_types = {extension: kind for kind, extension in IMAGE_TYPES.items()} | {".jpeg": "image/jpeg"}
            for folder in media_dirs:
                for path in folder.iterdir() if folder.is_dir() else []:
                    content_type = content_types.get(path.suffix.lower())
                    if path.is_file() and content_type:
                        connection.execute(
                            "INSERT OR REPLACE INTO media (filename, content_type, content) VALUES (?, ?, ?)",
                            (path.name, content_type, path.read_bytes()),
                        )

            connection.execute(
                "INSERT INTO outpost_state (id, data) VALUES (1, ?)",
                (json.dumps(outpost, ensure_ascii=False),),
            )
            for post in posts:
                self._write_record(connection, "game", str(post["id"]), {**post, "published": True}, insert=True)
            connection.execute(
                "INSERT OR REPLACE INTO metadata (key, value) VALUES ('initialized', '1')"
            )

    # --- Sample content ------------------------------------------------------

    def include_samples(self) -> bool:
        """Whether records flagged as sample content are shown in the manager and written to the site."""
        with self._connect() as connection:
            row = connection.execute("SELECT value FROM metadata WHERE key = 'includeSamples'").fetchone()
        return bool(row) and row["value"] == "1"

    def set_include_samples(self, include: Any) -> None:
        with self._connect() as connection:
            connection.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('includeSamples', ?)", ("1" if include else "0",))

    def _sample_ids(self, connection: sqlite3.Connection) -> dict[str, set[str]]:
        return {name: {record["id"] for record in self._records(connection, name) if record.get("sample")} for name in COLLECTIONS}

    def _keep_hidden_references(self, connection: sqlite3.Connection, spec: Collection, existing: dict[str, Any], clean: dict[str, Any]) -> None:
        """While samples are hidden the client never sees them, so a saved record would silently lose its links
        to them. Put those links back."""
        hidden = self._sample_ids(connection)
        for field, _, target in spec.refs:
            if not clean.get(field) and existing.get(field) in hidden[target]:
                clean[field] = existing[field]
        for field, _, _, _, target in spec.links:
            kept = [item for item in existing.get(field) or [] if item in hidden[target] and item not in clean.get(field, [])]
            clean[field] = [*clean.get(field, []), *kept]
        if "stash" in clean:
            owned = {item["gearId"] for item in clean["stash"]}
            clean["stash"] += [item for item in existing.get("stash") or [] if item["gearId"] in hidden["gear"] and item["gearId"] not in owned]

    # --- State --------------------------------------------------------------

    def state(self) -> dict[str, Any]:
        """Everything the manager shows. Hidden sample records are left out, except for a short list naming them
        so references to them can still be labelled."""
        include = self.include_samples()
        with self._connect() as connection:
            records = {name: self._records(connection, name) for name in COLLECTIONS}
            outpost_row = connection.execute("SELECT data FROM outpost_state WHERE id = 1").fetchone()
        result: dict[str, Any] = {name: [record for record in items if include or not record.get("sample")] for name, items in records.items()}
        result["outpost"] = json.loads(outpost_row["data"]) if outpost_row else {}
        samples = [{"collection": name, "id": record["id"], "label": COLLECTIONS[name].display(record) or record["id"]}
                   for name, items in records.items() for record in items if record.get("sample")]
        result["settings"] = {"includeSamples": include, "sampleCount": len(samples)}
        result["hiddenSamples"] = [] if include else samples
        return result

    def save_outpost(self, data: Any) -> None:
        if not isinstance(data, dict):
            raise ManagerError("Outpost data must be an object.")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO outpost_state (id, data) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (json.dumps(data, ensure_ascii=False),),
            )

    # --- Export -------------------------------------------------------------

    def _build_data_export(self, preview: bool = False) -> tuple[dict[str, bytes], dict[str, int]]:
        """Build public JSON for published records only, dropping references to unpublished ones.
        In preview mode unpublished records are included and the editor's unsaved draft replaces its record."""
        state = self.state()
        draft = self._preview_draft if preview else None
        if draft and draft["collection"] == "outpost":
            state["outpost"] = draft["record"]
        elif draft:
            records = [record for record in state[draft["collection"]] if record["id"] != draft["id"]]
            state[draft["collection"]] = [*records, draft["record"]]
        published = {name: {record["id"]: record for record in state[name] if preview or record.get("published")} for name in COLLECTIONS}
        public_archive = set(published["archive"])
        output: dict[str, bytes] = {}
        exported: dict[str, list[dict[str, Any]]] = {name: [] for name in PAGE_COLLECTIONS}

        def public_record(name: str, record: dict[str, Any]) -> dict[str, Any]:
            spec = COLLECTIONS[name]
            record = dict(record)
            for field in spec.image_fields:
                filename = media_filename(record.get(field))
                media = self.media(filename) if filename else None
                if media:
                    output[str(record[field]).removeprefix("data/")] = media[1]
                elif filename:
                    record[field] = None
            for field in spec.text_fields:
                record[field] = scrub_archive_links(record.get(field) or "", public_archive)
            return record

        exported["gear"] = [public_record("gear", gear) for gear in published["gear"].values()]

        for character in published["characters"].values():
            character = public_record("characters", character)
            sheet = character.get("sheet")
            public_sheet = {key: value for key, value in sheet.items() if key != "public"} if sheet and sheet.get("public", True) else None
            stash = [item for item in character.get("stash", []) if item["gearId"] in published["gear"]]
            exported["characters"].append({**character, "sheet": public_sheet, "stash": stash})

        for entry in published["archive"].values():
            entry = public_record("archive", entry)
            entry["participantIds"] = [item for item in entry.get("participantIds", []) if item in published["characters"]]
            exported["archive"].append(entry)

        for job in published["jobs"].values():
            participants = job.get("participantIds", [])
            job = public_record("jobs", job)
            exported["jobs"].append({
                **job,
                "organizerId": job.get("organizerId") if job.get("organizerId") in published["characters"] else None,
                "sessionRecordId": job.get("sessionRecordId") if job.get("sessionRecordId") in public_archive else None,
                "participantIds": [item for item in participants if item in published["characters"]],
                "crewCount": len(participants),
            })

        for name in PAGE_COLLECTIONS:
            fields = COLLECTIONS[name].public_fields
            filenames = []
            for record in exported[name]:
                filename = safe_filename(record["id"])
                filenames.append(filename)
                output[f"{name}/{filename}"] = json_bytes({field: record.get(field) for field in fields})
            output[f"{name}/index.json"] = json_bytes(sorted(filenames))

        posts = [public_record("game", post) for post in published["game"].values()]
        announcements = sorted((post for post in posts if post.get("type") == "announcement"),
                               key=lambda post: (post.get("publishedAt") or "", post.get("title", "")), reverse=True)
        game = announcements + sorted((post for post in posts if post.get("type") != "announcement"),
                                      key=lambda post: str(post.get("title", "")))
        output["outpost.json"] = json_bytes(state["outpost"])
        output["game.json"] = json_bytes([{field: post.get(field) for field in GAME_FIELDS} for post in game])
        counts = {name: len(exported[name]) for name in PAGE_COLLECTIONS}
        counts["game"] = len(game)
        counts["unpublished"] = sum(len(state[name]) for name in COLLECTIONS) - sum(counts.values())
        counts["samplesHidden"] = len(state["hiddenSamples"])
        return output, counts

    # --- Preview ------------------------------------------------------------

    def set_preview_draft(self, body: dict[str, Any]) -> dict[str, Any]:
        """Keep the editor's unsaved record for the preview. Returns the ID the preview page should open,
        or an error message when the draft is not valid yet (the preview then shows the saved version)."""
        collection = body.get("collection")
        data = body.get("data")
        with self._preview_lock:
            self._preview_version += 1
            if data is None:
                self._preview_draft = None
                return {"id": None}
            if collection == "outpost":
                if not isinstance(data, dict):
                    raise ManagerError("Outpost data must be an object.")
                self._preview_draft = {"collection": "outpost", "id": None, "record": data}
                return {"id": None}
            spec = self._spec(collection)
            if not isinstance(data, dict):
                raise ManagerError(f"{spec.label} data must be an object.")
            record_id = slugify(str(body.get("id") or "")) or next(
                (slugify(str(data.get(field) or "")) for field in spec.id_fields if slugify(str(data.get(field) or ""))), "") or "draft-preview"
            try:
                clean = spec.clean(data)
            except ManagerError as error:
                self._preview_draft = None
                return {"id": record_id, "error": str(error)}
            self._preview_draft = {"collection": collection, "id": record_id,
                                   "record": {**clean, "id": record_id, "published": True, "sample": bool(data.get("sample"))}}
            return {"id": record_id}

    def preview_file(self, relative: str) -> tuple[str, bytes] | None:
        """A file of the public site for the preview: pages and assets from public-site, data from the database."""
        relative = relative or "index.html"
        if relative.startswith("data/"):
            key = (self.database_path.stat().st_mtime_ns, self._preview_version)
            with self._preview_lock:
                if not self._preview_cache or self._preview_cache[0] != key:
                    self._preview_cache = (key, self._build_data_export(preview=True)[0])
                content = self._preview_cache[1].get(relative.removeprefix("data/"))
        else:
            target = (self.site_dir / relative).resolve()
            site = self.site_dir.resolve()
            if site not in target.parents or not target.is_file() or target.is_relative_to(self.data_dir.resolve()):
                return None
            content = target.read_bytes()
            if target.suffix.lower() == ".html":
                content = (content.replace(b"</head>", PREVIEW_FRAME_SCRIPT + b"</head>", 1) if b"</head>" in content
                           else PREVIEW_FRAME_SCRIPT + content)
        if content is None:
            return None
        return PREVIEW_TYPES.get(Path(relative).suffix.lower(), "application/octet-stream"), content

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


def scrub_archive_links(text: str, public_ids: set[str]) -> str:
    """Links to Archive entries players cannot see become plain text, so no unpublished ID or title leaks."""
    def replace(match: re.Match[str]) -> str:
        if match[1] in public_ids:
            return match[0]
        return match[2] or "[record unavailable]"
    return ARCHIVE_LINK_RE.sub(replace, text) if isinstance(text, str) else text


# The settlement was called the Island before schema v4. These rewrites apply only to the Outpost Sheet and
# rules text, where every use of the word named the settlement system rather than the physical island.
TERMINOLOGY = (
    (re.compile(r"\bGate [Aa]rchive\b"), "Archive"),
    (re.compile(r"\b[Ee]xpedition [Bb]oard\b"), "Job Board"),
    (re.compile(r"\bIsland\b"), "Outpost"),
    (re.compile(r"\bisland\b"), "outpost"),
)


def outpost_terminology(value: Any, key: str = "") -> Any:
    if isinstance(value, dict):
        return {name: item if name == "id" else outpost_terminology(item, name) for name, item in value.items()}
    if isinstance(value, list):
        return [outpost_terminology(item, key) for item in value]
    if isinstance(value, str):
        for pattern, replacement in TERMINOLOGY:
            value = pattern.sub(replacement, value)
    return value


class ManagerServer(ThreadingHTTPServer):
    # A site page (and so the preview) requests dozens of data files at once. The default queue of 5 waiting
    # connections makes Windows reset some of them, which the page sees as "Failed to fetch".
    request_queue_size = 128
    daemon_threads = True


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
                elif method == "POST" and path == "/api/preview":
                    self._send_json(200, store.set_preview_draft(self._read_body()))
                elif method == "POST" and path == "/api/settings":
                    store.set_include_samples(self._read_body().get("includeSamples"))
                    self._send_json(200, {"saved": True})
                elif method == "POST" and path == "/api/outpost":
                    store.save_outpost(self._read_body().get("data"))
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
            path = unquote(urlsplit(self.path).path)
            if path == "/preview":
                self.send_response(302)
                self.send_header("Location", "/preview/")
                self.end_headers()
                return
            if path.startswith("/preview/"):
                found = store.preview_file(path.removeprefix("/preview/"))
                if found:
                    self._send(200, found[1], found[0])
                else:
                    self._send(404, b"Not found", "text/plain; charset=utf-8")
                return
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
    for line in store.migration_report:
        print(f"[migration] {line}")
    server = ManagerServer(("127.0.0.1", args.port), create_handler(store))
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
