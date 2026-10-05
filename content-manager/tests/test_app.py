import base64
import json
import sqlite3
import sys
import threading
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import ContentStore, ManagerError, create_handler

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


GATE_DETAILS = {"designation": "G-03", "gateStatus": "active", "discoveredAt": "", "environment": "A drowned corridor.",
                "knownTraits": [], "knownHazards": ["Pressure shifts"], "knownLocations": []}


class ContentStoreTests(unittest.TestCase):
    """The fixture site holds public data exactly as Sync/Export writes it."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.site_dir = self.root / "public-site"
        self.data_dir = self.site_dir / "data"
        self.export_dir = self.root / "site-export"
        self.database = self.root / "manager.db"
        (self.site_dir / "assets" / "images").mkdir(parents=True, exist_ok=True)
        (self.site_dir / "index.html").write_text('<link rel="stylesheet" href="styles.css"><script src="site.js"></script>', encoding="utf-8")
        (self.site_dir / "styles.css").write_text("body { color: green; }", encoding="utf-8")
        (self.site_dir / "site.js").write_text("document.documentElement.dataset.ready = 'true';", encoding="utf-8")
        (self.site_dir / "assets" / "images" / "outpost.txt").write_text("static asset", encoding="utf-8")
        write_json(self.data_dir / "outpost.json", {
            "name": "Test Outpost",
            "highConcept": "A fixture",
            "stress": {"current": 1, "max": 6},
            "capabilities": [],
            "consequences": [],
            "facilities": [],
            "activeProjects": [],
            "conditions": [],
        })
        write_json(self.data_dir / "gear" / "index.json", ["rope.json"])
        write_json(self.data_dir / "gear" / "rope.json", {
            "id": "rope", "name": "Rope", "category": "exploration", "description": "Thirty metres.", "price": 10,
            "weight": 1, "availability": "common", "image": None, "tags": [], "featured": False, "promoLabel": "", "discount": None,
        })
        write_json(self.data_dir / "characters" / "index.json", [])
        entry = {"subtitle": "", "summary": "", "author": "", "publishedAt": "", "eventDate": "", "image": None, "tags": [],
                 "participantIds": []}
        write_json(self.data_dir / "archive" / "index.json", ["g-03.json", "gate-note.json", "route-note.json"])
        write_json(self.data_dir / "archive" / "g-03.json", {
            **entry, "id": "g-03", "type": "gate-record", "title": "Silt Choir", "content": "Harmonic patterns.",
            "details": GATE_DETAILS,
        })
        session = {"sessionDate": "2026-09-12", "outcome": "unknown"}
        write_json(self.data_dir / "archive" / "gate-note.json", {
            **entry, "id": "gate-note", "type": "session-record", "title": "Gate Note", "summary": "A short note",
            "content": "Observed near [[g-03|the Silt Choir]].", "details": session,
        })
        write_json(self.data_dir / "archive" / "route-note.json", {
            **entry, "id": "route-note", "type": "session-record", "title": "Route Note", "summary": "Routes held.",
            "content": "Details.", "details": session,
        })
        job = {
            "summary": "", "briefing": "", "type": "expedition", "scheduledAt": "", "expectedDuration": "", "organizerId": None,
            "postedBy": "", "participantIds": [], "crewCount": 0, "crewMin": None, "crewMax": None, "requirements": [],
        }
        write_json(self.data_dir / "jobs" / "index.json", ["e-16.json", "e-17.json"])
        write_json(self.data_dir / "jobs" / "e-16.json", {
            **job, "id": "e-16", "designation": "E-16", "title": "Harbor Watch", "objective": "Watch the harbor ring.",
            "status": "completed", "sessionRecordId": "gate-note",
        })
        write_json(self.data_dir / "jobs" / "e-17.json", {
            **job, "id": "e-17", "designation": "E-17", "title": "Saltglass Survey", "objective": "Map the approaches.",
            "status": "open", "sessionRecordId": None,
        })
        write_json(self.data_dir / "game.json", [{
            "id": "persistent-world",
            "type": "rule",
            "category": "Campaign",
            "title": "The world persists",
            "summary": "Expedition outcomes affect the shared world.",
            "details": "Update the public record when outcomes are established.",
            "tags": ["world", "consequences"],
        }])
        self.store = ContentStore(self.database, self.data_dir)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    # --- helpers ---

    def record(self, collection: str, record_id: str) -> dict:
        return next(item for item in self.store.state()[collection] if item["id"] == record_id)

    def add_character(self, name: str, **fields) -> str:
        return self.store.save_record("characters", None, {"name": name, "published": True, **fields})["id"]

    def add_gear(self, name: str, **fields) -> str:
        return self.store.save_record("gear", None, {"name": name, "price": 10, "weight": 1, "published": True, **fields})["id"]

    def serve(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(self.store))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base_url = f"http://127.0.0.1:{server.server_port}"

        def send(path: str, data: object = None, method: str = "POST") -> dict:
            request = Request(
                f"{base_url}{path}",
                data=None if data is None else json.dumps(data).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method=method,
            )
            with urlopen(request, timeout=5) as response:
                return json.loads(response.read())

        def stop() -> None:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

        return send, stop

    # --- import ---

    def test_initial_import_loads_public_data(self) -> None:
        state = self.store.state()
        self.assertEqual(state["outpost"]["name"], "Test Outpost")
        self.assertEqual((state["game"][0]["id"], state["game"][0]["type"]), ("persistent-world", "rule"))
        self.assertTrue(state["game"][0]["published"])
        gate = self.record("archive", "g-03")
        self.assertEqual((gate["type"], gate["details"]["knownHazards"]), ("gate-record", ["Pressure shifts"]))
        job = self.record("jobs", "e-16")
        self.assertEqual(job["sessionRecordId"], "gate-note")
        self.assertNotIn("crewCount", job, "crew count is derived on export")
        self.assertEqual(self.record("gear", "rope")["price"], 10)
        self.assertTrue(all(record["published"] for name in ("archive", "jobs", "gear") for record in state[name]))

    def test_export_then_import_round_trips(self) -> None:
        varga = self.add_character("Varga", type="npc", summary="Quartermaster.", stash=[{"gearId": "rope", "quantity": 2}])
        self.store.save_record("jobs", "e-17", {**self.record("jobs", "e-17"), "sessionRecordId": "route-note",
                                                "organizerId": varga, "participantIds": [varga]})
        self.store.save_record("archive", "route-note", {**self.record("archive", "route-note"), "participantIds": [varga]})
        self.store.sync_site_data()
        self.store.import_site()
        job = self.record("jobs", "e-17")
        self.assertEqual((job["sessionRecordId"], job["participantIds"]), ("route-note", [varga]))
        self.assertEqual(self.record("archive", "route-note")["participantIds"], [varga])
        self.assertEqual(self.record("characters", varga)["stash"], [{"gearId": "rope", "quantity": 2, "broughtIntoAction": False}])

    # --- CRUD and references ---

    def test_crud_for_all_content_types(self) -> None:
        varga = self.add_character("Varga", type="npc")
        mara = self.add_character("Mara Lind", playerName="Alex")
        oren = self.add_character("Oren")
        gate = self.store.save_record("archive", None, {
            "type": "gate-record", "title": "The Sunken Archive", "content": "Tidal ruins.",
            "details": {"designation": "Gate 017", "gateStatus": "dormant", "knownTraits": "Tidal time\n\nEchoes"},
            "participantIds": [mara], "published": True,
        })["id"]
        self.assertEqual(gate, "gate-017")
        saved_gate = self.record("archive", gate)
        self.assertEqual(saved_gate["details"]["knownTraits"], ["Tidal time", "Echoes"])
        self.assertEqual(saved_gate["participantIds"], [], "only Session Records keep participants")
        session = self.store.save_record("archive", None, {
            "type": "session-record", "title": "The First Descent", "content": "We reached [[gate-017]].",
            "participantIds": [oren, mara, oren], "details": {"sessionDate": "2026-10-03", "outcome": "partial"}, "published": True,
        })["id"]
        self.assertEqual(self.record("archive", session)["participantIds"], [oren, mara])
        for entry_type in ("newspaper", "history", "folklore"):
            with self.subTest(entry_type=entry_type):
                entry = self.store.save_record("archive", None, {"type": entry_type, "title": f"A {entry_type}",
                                                                 "details": GATE_DETAILS, "published": True})["id"]
                self.assertEqual(self.record("archive", entry)["details"], {}, "Gate metadata is not kept on other types")
        job = self.store.save_record("jobs", None, {
            "title": "Return to the Sunken Archive", "designation": "017-C", "type": "expedition", "status": "open",
            "scheduledAt": "2026-10-03T19:00", "organizerId": varga, "participantIds": [oren, mara, oren],
            "crewMin": "2", "crewMax": 5, "sessionRecordId": session, "published": True,
        })["id"]
        saved = self.record("jobs", job)
        self.assertEqual(saved["participantIds"], [oren, mara])
        self.assertEqual((saved["crewMin"], saved["crewMax"], saved["sessionRecordId"]), (2, 5, session))
        for job_type in ("recovery", "investigation", "escort", "bounty", "outpost", "other"):
            self.store.save_record("jobs", job, {**saved, "type": job_type, "status": "failed", "published": True})
            self.assertEqual(self.record("jobs", job)["type"], job_type)

        lantern = self.add_gear("Lantern", category="exploration", featured=True, promoLabel="new",
                                discount={"active": True, "salePrice": 8})
        saved_gear = self.record("gear", lantern)
        self.assertEqual((saved_gear["promoLabel"], saved_gear["discount"]), ("NEW", {"active": True, "salePrice": 8}))

        self.store.delete_record("jobs", job)
        self.store.delete_record("archive", session)
        self.store.delete_record("archive", gate)
        self.store.delete_record("gear", lantern)
        self.store.delete_record("characters", mara)
        self.assertNotIn(mara, [item["id"] for item in self.store.state()["characters"]])

    def test_invalid_references_and_values_are_rejected(self) -> None:
        with self.assertRaisesRegex(ManagerError, "Unknown archive entry"):
            self.store.save_record("jobs", None, {"title": "X", "sessionRecordId": "nope"})
        with self.assertRaisesRegex(ManagerError, "type session-record"):
            self.store.save_record("jobs", None, {"title": "X", "sessionRecordId": "g-03"})
        with self.assertRaisesRegex(ManagerError, "Unknown character"):
            self.store.save_record("jobs", None, {"title": "X", "participantIds": ["ghost"]})
        with self.assertRaisesRegex(ManagerError, "status must be one of"):
            self.store.save_record("jobs", None, {"title": "X", "status": "underway"})
        with self.assertRaisesRegex(ManagerError, "Minimum crew"):
            self.store.save_record("jobs", None, {"title": "X", "crewMin": 5, "crewMax": 2})
        with self.assertRaisesRegex(ManagerError, "gateStatus must be one of"):
            self.store.save_record("archive", None, {"type": "gate-record", "title": "X", "details": {"designation": "G-1", "gateStatus": "haunted"}})
        with self.assertRaisesRegex(ManagerError, "already uses the Gate designation"):
            self.store.save_record("archive", None, {"type": "gate-record", "title": "Dup", "details": {"designation": "g_03"}})
        with self.assertRaisesRegex(ManagerError, "type must be one of"):
            self.store.save_record("archive", None, {"type": "creature", "title": "X"})
        with self.assertRaisesRegex(ManagerError, "sale price must be lower"):
            self.add_gear("Bad deal", discount={"active": True, "salePrice": 12})
        with self.assertRaisesRegex(ManagerError, "Unknown Gear in stash"):
            self.add_character("X", stash=[{"gearId": "ghost-gear"}])
        with self.assertRaisesRegex(ManagerError, "Stash quantity"):
            self.add_character("X", stash=[{"gearId": "rope", "quantity": 0}])

    def test_referenced_records_cannot_be_deleted(self) -> None:
        varga = self.add_character("Varga", stash=[{"gearId": "rope"}])
        self.store.save_record("jobs", "e-17", {**self.record("jobs", "e-17"), "participantIds": [varga]})
        with self.assertRaisesRegex(ManagerError, "Saltglass Survey.*participant"):
            self.store.delete_record("characters", varga)
        with self.assertRaisesRegex(ManagerError, "Harbor Watch.*sessionRecordId"):
            self.store.delete_record("archive", "gate-note")
        with self.assertRaisesRegex(ManagerError, "Varga.*stash"):
            self.store.delete_record("gear", "rope")
        with self.assertRaisesRegex(ManagerError, "uses this entry as its Session Record"):
            self.store.save_record("archive", "gate-note", {**self.record("archive", "gate-note"), "type": "history"})

    # --- character stash ---

    def test_stash_references_gear_and_merges_duplicates(self) -> None:
        lantern = self.add_gear("Lantern")
        mara = self.add_character("Mara", stash=[
            {"gearId": "rope", "quantity": 1}, {"gearId": lantern, "broughtIntoAction": True}, {"gearId": "rope", "quantity": 2},
        ])
        oren = self.add_character("Oren", stash=[{"gearId": lantern, "broughtIntoAction": False}])
        self.assertEqual(self.record("characters", mara)["stash"], [
            {"gearId": "rope", "quantity": 3, "broughtIntoAction": False},
            {"gearId": lantern, "quantity": 1, "broughtIntoAction": True},
        ])
        self.assertFalse(self.record("characters", oren)["stash"][0]["broughtIntoAction"], "stash state is per character")
        self.store.save_record("characters", mara, {**self.record("characters", mara), "stash": [{"gearId": "rope", "quantity": 3}]})
        self.assertEqual(len(self.record("characters", mara)["stash"]), 1)
        self.assertIn(lantern, [gear["id"] for gear in self.store.state()["gear"]], "removing from a stash keeps the Gear")
        self.store.delete_record("characters", mara)
        self.store.delete_record("characters", oren)
        self.store.delete_record("gear", lantern)

    # --- publishing ---

    def test_unpublished_records_are_left_out_and_references_to_them_dropped(self) -> None:
        secret = self.store.save_record("characters", None, {"name": "Hidden Patron", "published": False})["id"]
        hidden_gear = self.add_gear("Prototype", published=False)
        crew = self.add_character("Crew Member", stash=[{"gearId": "rope"}, {"gearId": hidden_gear}])
        hidden_session = self.store.save_record("archive", None, {
            "type": "session-record", "title": "Black op", "participantIds": [secret, crew], "published": False})["id"]
        self.store.save_record("jobs", "e-17", {**self.record("jobs", "e-17"), "organizerId": secret,
                                                "participantIds": [secret, crew], "sessionRecordId": hidden_session,
                                                "briefing": f"See [[{hidden_session}]] and [[g-03]]."})
        self.store.save_record("archive", "route-note", {**self.record("archive", "route-note"),
                                                         "content": f"Cf. [[{hidden_session}|the incident]].",
                                                         "participantIds": [secret, crew]})
        self.store.save_record("game", "persistent-world", {**self.record("game", "persistent-world"), "published": False})

        counts = self.store.export_site()
        data = self.export_dir / "data"
        self.assertEqual(read_json(data / "characters" / "index.json"), [f"{crew}.json"])
        self.assertEqual(read_json(data / "gear" / "index.json"), ["rope.json"])
        self.assertNotIn(f"{hidden_session}.json", read_json(data / "archive" / "index.json"))
        self.assertEqual(read_json(data / "game.json"), [])
        job = read_json(data / "jobs" / "e-17.json")
        self.assertIsNone(job["organizerId"])
        self.assertIsNone(job["sessionRecordId"])
        self.assertEqual(job["participantIds"], [crew])
        self.assertEqual(job["crewCount"], 2)
        self.assertEqual(job["briefing"], "See [record unavailable] and [[g-03]].")
        self.assertNotIn("published", job)
        self.assertEqual(read_json(data / "archive" / "route-note.json")["content"], "Cf. the incident.")
        self.assertEqual(read_json(data / "archive" / "route-note.json")["participantIds"], [crew])
        self.assertEqual(read_json(data / "characters" / f"{crew}.json")["stash"], [{"gearId": "rope", "quantity": 1, "broughtIntoAction": False}])
        self.assertEqual(counts["unpublished"], 4)

    def test_new_records_default_to_unpublished(self) -> None:
        record_id = self.store.save_record("characters", None, {"name": "Draft"})["id"]
        self.assertFalse(self.record("characters", record_id)["published"])

    def test_public_fields_never_include_manager_only_data(self) -> None:
        self.store.export_site()
        gate = read_json(self.export_dir / "data" / "archive" / "g-03.json")
        self.assertEqual(set(gate), {"id", "type", "title", "subtitle", "summary", "content", "author", "publishedAt",
                                     "eventDate", "image", "tags", "participantIds", "details"})
        self.assertEqual(set(read_json(self.export_dir / "data" / "gear" / "rope.json")),
                         {"id", "name", "category", "description", "price", "weight", "availability", "image", "tags",
                          "featured", "promoLabel", "discount", "projectId"})

    # --- site settings: launch roadmap, Discord, sponsor ---

    def test_site_settings_default_validate_export_and_import(self) -> None:
        site = self.store.state()["site"]
        self.assertEqual((site["launchAt"], site["discordUrl"]), ("2026-11-06T20:00+02:00", "https://discord.gg/TxcudTj"))
        self.assertEqual(site["sponsor"]["name"], "Cozy House Games")
        self.assertEqual(site["roadmap"][0], {"title": "Interest Check", "detail": site["roadmap"][0]["detail"], "status": "done", "date": "2026-09-29"})
        self.assertEqual(site["roadmap"][-1]["date"], "2026-11-06")
        with self.assertRaisesRegex(ManagerError, "must look like 2026-10-04"):
            self.store.save_site_settings({**site, "roadmap": [{"title": "X", "date": "soon"}]})
        with self.assertRaisesRegex(ManagerError, "Launch time must look like"):
            self.store.save_site_settings({**site, "launchAt": "next friday"})
        with self.assertRaisesRegex(ManagerError, "Discord invite must be a full web address"):
            self.store.save_site_settings({**site, "discordUrl": "javascript:alert(1)"})
        with self.assertRaisesRegex(ManagerError, "status must be one of"):
            self.store.save_site_settings({**site, "roadmap": [{"title": "X", "status": "maybe"}]})
        self.assertEqual(site["sponsor"]["logo"], "assets/images/cozy-house-games.png")
        self.assertEqual((site["community"]["name"], site["community"]["logo"]), ("Game of Adventuring", "assets/images/game-of-adventuring.png"))
        with self.assertRaisesRegex(ManagerError, "sponsor logo must be an uploaded image"):
            self.store.save_site_settings({**site, "sponsor": {**site["sponsor"], "logo": "javascript:alert(1)"}})
        with self.assertRaisesRegex(ManagerError, "community logo must be"):
            self.store.save_site_settings({**site, "community": {**site["community"], "logo": "../../secret.png"}})
        self.store.save_site_settings({**site, "sponsor": {**site["sponsor"], "logo": "https://example.com/logo.png"}})
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "site.json")
        self.assertEqual(exported["sponsor"]["logo"], "https://example.com/logo.png", "a web address is published as is")
        self.assertEqual(exported["community"]["logo"], "assets/images/game-of-adventuring.png", "a site file path is published as is")

        data_url = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()
        logo = self.store.save_media({"filename": "Cozy logo.png", "dataUrl": data_url, "kind": "image"})["path"]
        self.store.save_site_settings({**site, "roadmap": [{"title": "Recruit players", "status": "done", "date": "2026-10-25"}, {"title": "  ", "status": "todo"}],
                                       "sponsor": {**site["sponsor"], "logo": logo}})
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "site.json")
        self.assertEqual(exported["roadmap"], [{"title": "Recruit players", "detail": "", "status": "done", "date": "2026-10-25"}])
        self.assertEqual((self.export_dir / logo).read_bytes(), PNG_BYTES)

        self.store.sync_site_data()
        self.store.save_site_settings({**site, "launchTitle": "Changed locally"})
        self.store.import_site()
        self.assertEqual(self.store.state()["site"]["roadmap"][0]["status"], "done", "import reads site.json back")

    # --- preview ---

    def test_preview_serves_the_site_with_database_data_and_the_unsaved_draft(self) -> None:
        hidden = self.store.save_record("archive", None, {"type": "history", "title": "Unpublished history", "published": False})["id"]
        content_type, page = self.store.preview_file("index.html")
        self.assertEqual(content_type, "text/html; charset=utf-8")
        self.assertIn(b"window.top !== window", page, "preview pages keep scrolling inside the frame")
        self.assertIn(b'<script src="site.js"></script>', page)
        self.assertEqual(self.store.preview_file("site.js")[1], (self.site_dir / "site.js").read_bytes())
        index = json.loads(self.store.preview_file("data/archive/index.json")[1])
        self.assertIn(f"{hidden}.json", index, "the preview includes unpublished records")

        result = self.store.set_preview_draft({"collection": "jobs", "id": "e-17", "data": {
            **self.record("jobs", "e-17"), "title": "Draft title", "briefing": "See [[g-03]]."}})
        self.assertEqual(result, {"id": "e-17"})
        job = json.loads(self.store.preview_file("data/jobs/e-17.json")[1])
        self.assertEqual((job["title"], job["briefing"]), ("Draft title", "See [[g-03]]."))
        self.assertEqual(self.record("jobs", "e-17")["title"], "Saltglass Survey", "a draft is never saved")

        new = self.store.set_preview_draft({"collection": "gear", "data": {"name": "Brand New Lamp", "price": 5, "weight": 1}})
        self.assertEqual(new, {"id": "brand-new-lamp"})
        self.assertIn("brand-new-lamp.json", json.loads(self.store.preview_file("data/gear/index.json")[1]))

        invalid = self.store.set_preview_draft({"collection": "jobs", "id": "e-17", "data": {"title": ""}})
        self.assertIn("title is required", invalid["error"])
        self.assertEqual(json.loads(self.store.preview_file("data/jobs/e-17.json")[1])["title"], "Saltglass Survey")

        self.store.set_preview_draft({"collection": "outpost", "data": {"name": "Draft Outpost"}})
        self.assertEqual(json.loads(self.store.preview_file("data/outpost.json")[1])["name"], "Draft Outpost")
        self.store.set_preview_draft({"collection": "outpost", "data": None})
        self.assertEqual(json.loads(self.store.preview_file("data/outpost.json")[1])["name"], "Test Outpost")

    def test_preview_never_serves_files_outside_the_site_or_stale_data_files(self) -> None:
        write_json(self.data_dir / "stale.json", {"old": True})
        self.assertIsNone(self.store.preview_file("data/stale.json"))
        self.assertIsNone(self.store.preview_file("../manager.db"))
        self.assertIsNone(self.store.preview_file("missing.html"))
        send, stop = self.serve()
        try:
            draft = send("/api/preview", {"collection": "characters", "data": {"name": "Wren"}})
            self.assertEqual(draft, {"id": "wren"})
            with self.assertRaises(HTTPError) as missing:
                send("/preview/../app.py", method="GET")
            self.assertEqual(missing.exception.code, 404)
        finally:
            stop()

    # --- sample content ---

    def test_sample_records_are_hidden_from_manager_and_site_until_shown(self) -> None:
        self.assertFalse(self.store.state()["settings"]["includeSamples"], "samples start hidden")
        self.store.set_include_samples(True)
        lantern = self.add_gear("Sample lantern", sample=True)
        sample_crew = self.add_character("Sample crew", sample=True, stash=[{"gearId": lantern}])
        self.store.save_record("jobs", "e-17", {**self.record("jobs", "e-17"), "participantIds": [sample_crew]})
        self.store.export_site()
        self.assertIn(f"{lantern}.json", read_json(self.export_dir / "data" / "gear" / "index.json"))

        self.store.set_include_samples(False)
        state = self.store.state()
        self.assertNotIn(lantern, [gear["id"] for gear in state["gear"]])
        self.assertNotIn(sample_crew, [character["id"] for character in state["characters"]])
        self.assertEqual(state["settings"], {"includeSamples": False, "sampleCount": 2})
        self.assertEqual({item["id"] for item in state["hiddenSamples"]}, {lantern, sample_crew})
        counts = self.store.export_site()
        data = self.export_dir / "data"
        self.assertNotIn(f"{lantern}.json", read_json(data / "gear" / "index.json"))
        self.assertEqual(read_json(data / "jobs" / "e-17.json")["participantIds"], [])
        self.assertEqual(counts["samplesHidden"], 2)

    def test_saving_while_samples_are_hidden_keeps_links_to_them_and_their_flag(self) -> None:
        self.store.set_include_samples(True)
        rope_sample = self.add_gear("Sample rope", sample=True)
        sample_crew = self.add_character("Sample crew", sample=True)
        real = self.add_character("Real crew", stash=[{"gearId": "rope"}, {"gearId": rope_sample, "quantity": 2}])
        self.store.save_record("jobs", "e-17", {**self.record("jobs", "e-17"), "participantIds": [sample_crew, real], "organizerId": sample_crew})
        self.store.set_include_samples(False)
        # The client never saw the sample records, so it sends the record without them.
        self.store.save_record("jobs", "e-17", {**self.record("jobs", "e-17"), "participantIds": [real], "organizerId": None, "title": "Renamed"})
        self.store.save_record("characters", real, {"name": "Real crew", "published": True, "stash": [{"gearId": "rope"}]})
        self.store.set_include_samples(True)
        job = self.record("jobs", "e-17")
        self.assertEqual((job["title"], job["participantIds"], job["organizerId"]), ("Renamed", [real, sample_crew], sample_crew))
        self.assertEqual([item["gearId"] for item in self.record("characters", real)["stash"]], ["rope", rope_sample])
        # Edits without the field keep the flag; sending it changes it.
        self.store.save_record("gear", rope_sample, {"name": "Sample rope", "published": True})
        self.assertTrue(self.record("gear", rope_sample)["sample"])
        self.store.save_record("gear", rope_sample, {"name": "Sample rope", "published": True, "sample": False})
        self.assertFalse(self.record("gear", rope_sample)["sample"])

    def test_settings_api_toggles_samples(self) -> None:
        self.store.save_record("characters", None, {"name": "Hidden sample", "sample": True, "published": True})
        send, stop = self.serve()
        try:
            self.assertEqual(send("/api/state", method="GET")["settings"], {"includeSamples": False, "sampleCount": 1})
            send("/api/settings", {"includeSamples": True})
            state = send("/api/state", method="GET")
            self.assertTrue(state["settings"]["includeSamples"])
            self.assertIn("Hidden sample", [character["name"] for character in state["characters"]])
        finally:
            stop()

    # --- Game: announcements and rules ---

    def test_game_posts_validate_and_export_newest_announcements_first(self) -> None:
        with self.assertRaisesRegex(ManagerError, "posted date"):
            self.store.save_record("game", None, {"type": "announcement", "title": "No date"})
        with self.assertRaisesRegex(ManagerError, "rule category"):
            self.store.save_record("game", None, {"type": "rule", "title": "No category"})
        with self.assertRaisesRegex(ManagerError, "earlier than the posted date"):
            self.store.save_record("game", None, {"type": "announcement", "title": "Bad", "publishedAt": "2026-10-05", "showUntil": "2026-10-01"})
        with self.assertRaisesRegex(ManagerError, "type must be one of"):
            self.store.save_record("game", None, {"type": "poll", "title": "X"})
        old = self.store.save_record("game", None, {"type": "announcement", "title": "Session zero", "publishedAt": "2026-09-01",
                                                    "published": True})["id"]
        new = self.store.save_record("game", None, {"type": "announcement", "title": "Next session moved", "publishedAt": "2026-10-02",
                                                    "pinned": True, "showUntil": "2026-10-10", "details": "See [[g-03]] and [[hidden]].",
                                                    "published": True})["id"]
        rule = self.store.save_record("game", None, {"type": "rule", "title": "Pinned rules are not a thing", "category": "Campaign",
                                                     "pinned": True, "showUntil": "2026-12-01", "published": True})["id"]
        self.assertEqual((self.record("game", rule)["pinned"], self.record("game", rule)["showUntil"]), (False, ""))
        self.store.export_site()
        game = read_json(self.export_dir / "data" / "game.json")
        self.assertEqual([post["id"] for post in game][:2], [new, old])
        self.assertEqual({post["type"] for post in game[2:]}, {"rule"})
        latest = game[0]
        self.assertEqual((latest["pinned"], latest["showUntil"]), (True, "2026-10-10"))
        self.assertEqual(latest["details"], "See [[g-03]] and [record unavailable].")
        self.assertEqual(set(latest), {"id", "type", "title", "category", "summary", "details", "tags", "publishedAt", "pinned", "showUntil", "order", "image"})

    # --- Resources, Forms and Gate Domains (schema v8) ---

    def gate(self, designation: str = "G-12", domains: list[str] | None = None, published: bool = True) -> str:
        return self.store.save_record("archive", None, {"type": "gate-record", "title": f"Gate {designation}", "published": published,
                                                        "details": {"designation": designation, "domains": domains or ["volcanic"]}})["id"]

    def test_resources_validate_functions_domains_and_their_gate(self) -> None:
        gate = self.gate()
        resource = self.store.save_record("resources", None, {
            "name": "Emberglass", "sourceType": "ground", "functions": ["Store", "Heat", "Release"], "hiddenFunctions": ["Resonate"],
            "availability": "limited", "gateId": gate, "harvestingIssue": "Shatters when chilled", "gmNotes": "Linked to the Core"})["id"]
        self.assertEqual(self.record("resources", resource)["hiddenFunctions"], ["Resonate"])
        bad = [
            {"name": "X", "functions": ["Lighten"]},                      # not in the vocabulary
            {"name": "X", "functions": ["Heat"], "hiddenFunctions": ["Heat"]},
            {"name": "X", "domains": ["volcanic", "frozen", "arid"]},     # at most two
            {"name": "X", "domains": ["swamp"]},
            {"name": "X", "availability": "plentiful"},
            {"name": "Emberglass"},                                       # names are unique
        ]
        for data in bad:
            with self.assertRaises(ManagerError):
                self.store.save_record("resources", None, data)
        session = self.store.save_record("archive", None, {"type": "session-record", "title": "A session"})["id"]
        with self.assertRaisesRegex(ManagerError, "gate-record"):
            self.store.save_record("resources", None, {"name": "Stray", "gateId": session})
        with self.assertRaisesRegex(ManagerError, "Resource"):
            self.store.delete_record("archive", gate)
        with self.assertRaisesRegex(ManagerError, "detach"):
            self.store.save_record("archive", gate, {**self.record("archive", gate), "type": "history"})

    def test_resource_export_hides_gm_knowledge_and_inherits_the_gate_domain(self) -> None:
        gate = self.gate(domains=["frozen", "constructed"])
        self.store.save_record("resources", None, {"id": "rime-gear", "name": "Rime Gear", "functions": ["Move", "Absorb"],
                                                   "hiddenFunctions": ["Record"], "harvestingIssue": "Seizes up", "gmNotes": "secret",
                                                   "gateId": gate, "published": True})
        self.store.save_record("resources", None, {"id": "own-domain", "name": "Own Domain", "domains": ["arid"], "gateId": gate, "published": True})
        self.store.save_record("resources", None, {"id": "draft", "name": "Draft", "published": False})
        self.store.export_site()
        data = self.export_dir / "data" / "resources"
        self.assertEqual(read_json(data / "index.json"), ["own-domain.json", "rime-gear.json"])
        rime = read_json(data / "rime-gear.json")
        self.assertNotIn("hiddenFunctions", rime)
        self.assertNotIn("harvestingIssue", rime)
        self.assertNotIn("gmNotes", rime)
        self.assertEqual((rime["domains"], rime["functions"], rime["gateId"]), (["frozen", "constructed"], ["Move", "Absorb"], gate))
        self.assertEqual(read_json(data / "own-domain.json")["domains"], ["arid"])

    def test_resources_of_an_unpublished_gate_keep_no_gate_link(self) -> None:
        gate = self.gate(published=False)
        self.store.save_record("resources", None, {"id": "orphan", "name": "Orphan", "gateId": gate, "published": True})
        self.store.export_site()
        orphan = read_json(self.export_dir / "data" / "resources" / "orphan.json")
        self.assertIsNone(orphan["gateId"])
        self.assertEqual(orphan["domains"], [], "an unpublished Gate's Domain is not revealed either")

    # --- The Function vocabulary ---

    def vocabulary_with(self, change) -> list:
        groups = json.loads(json.dumps(self.store.function_vocabulary()))
        change(groups)
        return groups

    def test_function_vocabulary_renames_carry_through_records(self) -> None:
        resource = self.store.save_record("resources", None, {"name": "Emberglass", "functions": ["Heat", "Store"], "hiddenFunctions": ["Resonate"]})["id"]
        form = self.store.save_record("forms", None, {"name": "Kindle", "tier": "first", "words": ["Heat"]})["id"]
        project = self.store.save_record("projects", None, {"name": "Forge", "progress": {"max": 4}, "requiredFunctions": ["Heat"]})["id"]
        self.store.save_record("game", None, {"type": "rule", "title": "Fire", "category": "Campaign", "details": "Uses `Heat`."})
        def rename(groups):
            next(fn for group in groups for fn in group["functions"] if fn["name"] == "Heat")["name"] = "Warm"
        result = self.store.save_function_vocabulary(self.vocabulary_with(rename), {"Heat": "Warm"})
        self.assertEqual(result["recordsUpdated"], 3)
        self.assertEqual(result["ruleMentions"], ["Heat (Fire)"], "rules text is reported, not rewritten")
        self.assertEqual(self.record("resources", resource)["functions"], ["Warm", "Store"])
        self.assertEqual(self.record("forms", form)["words"], ["Warm"])
        self.assertEqual(self.record("projects", project)["requiredFunctions"], ["Warm"])
        with self.assertRaises(ManagerError):
            self.store.save_record("resources", None, {"name": "Old word", "functions": ["Heat"]})
        reopened = ContentStore(self.database, self.data_dir)
        self.assertIn("Warm", reopened.state()["vocabulary"]["functionGroups"]["Energy & Transfer"])

    def test_functions_in_use_cannot_be_removed_but_unused_ones_can(self) -> None:
        self.store.save_record("resources", None, {"name": "Emberglass", "functions": ["Heat"]})
        def drop(name):
            return lambda groups: [group.__setitem__("functions", [fn for fn in group["functions"] if fn["name"] != name]) for group in groups]
        with self.assertRaisesRegex(ManagerError, "Heat .*Emberglass"):
            self.store.save_function_vocabulary(self.vocabulary_with(drop("Heat")))
        self.store.save_function_vocabulary(self.vocabulary_with(drop("Corrode")))
        self.assertNotIn("Corrode", self.store.state()["vocabulary"]["functionGroups"]["Matter & Structure"])

    def test_new_functions_and_groups_are_usable_and_exported(self) -> None:
        def add(groups):
            groups.append({"name": "Time", "functions": [{"name": "Delay", "definition": "Slow a process down."}]})
        self.store.save_function_vocabulary(self.vocabulary_with(add))
        self.store.save_record("forms", None, {"name": "Slow Fall", "tier": "first", "words": ["Delay"], "published": True})
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "vocabulary.json")["functionGroups"]
        self.assertEqual(exported[-1], {"name": "Time", "functions": [{"name": "Delay", "definition": "Slow a process down."}]})
        for bad in ([], [{"name": "A", "functions": [{"name": "lowercase"}]}], [{"name": "A", "functions": [{"name": "Heat"}, {"name": "heat"}]}],
                    [{"name": "A", "functions": [{"name": "Heat"}]}, {"name": "a", "functions": [{"name": "Move"}]}]):
            with self.assertRaises(ManagerError):
                self.store.save_function_vocabulary(bad)

    # --- Domains ---

    def test_domains_can_be_renamed_added_and_removed_when_unused(self) -> None:
        gate = self.gate(domains=["frozen"])
        domains = self.store.domain_vocabulary()
        next(domain for domain in domains if domain["key"] == "frozen")["name"] = "Glacial"
        domains.append({"name": "Astral Wastes", "colour": "#aa66ff", "description": "Void between stars."})
        self.store.save_domain_vocabulary(domains)
        saved = self.store.domain_vocabulary()
        self.assertEqual([domain["key"] for domain in saved][-1], "astral-wastes")
        self.assertEqual(self.record("archive", gate)["details"]["domains"], ["frozen"], "records keep the key through a rename")
        self.store.save_record("resources", None, {"name": "Starglass", "domains": ["astral-wastes"]})
        with self.assertRaisesRegex(ManagerError, "Starglass"):
            self.store.save_domain_vocabulary([domain for domain in saved if domain["key"] != "astral-wastes"])
        self.store.save_domain_vocabulary([domain for domain in saved if domain["key"] != "arid"])
        with self.assertRaises(ManagerError):
            self.store.save_record("resources", None, {"name": "Dune salt", "domains": ["arid"]})
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "vocabulary.json")["domains"]
        self.assertIn({"key": "frozen", "name": "Glacial", "colour": "#9fdcec", "description": saved[4]["description"]}, exported)
        for bad in ([], [{"name": "A"}, {"name": "a"}], [{"name": "A", "colour": "red"}]):
            with self.assertRaises(ManagerError):
                self.store.save_domain_vocabulary(bad)

    def test_bulk_publish_and_sample_flags(self) -> None:
        ids = [self.store.save_record("forms", None, {"name": f"Form {n}", "tier": "first", "words": ["Heat"]})["id"] for n in range(3)]
        self.assertTrue(self.record("forms", ids[0])["updatedAt"])
        self.assertEqual(self.store.bulk_update("forms", ids[:2], "publish"), {"changed": 2})
        self.assertEqual([self.record("forms", item)["published"] for item in ids], [True, True, False])
        self.assertEqual(self.store.bulk_update("forms", ids, "publish"), {"changed": 1})
        self.store.bulk_update("forms", [ids[2]], "sample")
        self.assertTrue(self.store.state()["forms"][-1]["sample"] if self.store.include_samples() else True)
        for bad in (("forms", [], "publish"), ("forms", ["missing"], "publish"), ("forms", ids, "explode"), ("nothing", ids, "publish")):
            with self.assertRaises(ManagerError):
                self.store.bulk_update(*bad)

    def test_sync_status_tracks_changes_after_the_last_sync(self) -> None:
        self.assertFalse(self.store.sync_status()["pending"])
        self.store.mark("lastChangeAt")
        self.assertTrue(self.store.sync_status()["pending"])
        self.store.mark("lastSyncAt")
        self.assertFalse(self.store.sync_status()["pending"])

    def test_function_interactions_start_from_the_design_table_and_follow_renames(self) -> None:
        interactions = self.store.function_interactions()
        self.assertIn({"a": "Conduct", "b": "Insulate", "kind": "opposition", "keyword": "", "note": ""}, interactions)
        self.assertTrue(any(entry["a"] == "Release" and entry["b"] == "Store" and entry["kind"] == "synergy" for entry in interactions))
        self.store.save_function_interactions([{"a": "Store", "b": "Heat", "kind": "synergy", "keyword": "Thermal battery", "note": "Holds warmth."},
                                               {"a": "Move", "b": "Anchor", "kind": "opposition"}])
        self.assertEqual([(e["a"], e["b"]) for e in self.store.function_interactions()], [("Anchor", "Move"), ("Heat", "Store")])
        for bad in ([{"a": "Heat", "b": "Heat"}], [{"a": "Heat", "b": "Teleport"}], [{"a": "Heat", "b": "Store", "kind": "love"}],
                    [{"a": "Heat", "b": "Store"}, {"a": "Store", "b": "Heat"}], [{"a": "Heat", "b": "Move", "keyword": "x" * 41}]):
            with self.assertRaises(ManagerError):
                self.store.save_function_interactions(bad)
        groups = self.store.function_vocabulary()
        for group in groups:
            for fn in group["functions"]:
                if fn["name"] == "Heat":
                    fn["name"] = "Warmth"
            group["functions"] = [fn for fn in group["functions"] if fn["name"] != "Move"]
        result = self.store.save_function_vocabulary(groups, {"Heat": "Warmth"})
        self.assertEqual(result["interactionsRemoved"], 1)
        self.assertEqual(self.store.function_interactions(), [{"a": "Store", "b": "Warmth", "kind": "synergy", "keyword": "Thermal battery", "note": "Holds warmth."}])
        self.store.export_site()
        self.assertEqual(len(read_json(self.export_dir / "data" / "vocabulary.json")["interactions"]), 1)

    def test_gate_cm_notes_stay_private(self) -> None:
        gate = self.store.save_record("archive", None, {"type": "gate-record", "title": "Gate G-30", "published": True, "details": {
            "designation": "G-30", "domains": ["abyssal"], "knownCreatures": ["Drift jellies"], "gmNotes": "Gate Aspect: Light Draws Attention"}})["id"]
        self.assertEqual(self.record("archive", gate)["details"]["gmNotes"], "Gate Aspect: Light Draws Attention")
        self.store.export_site()
        details = read_json(self.export_dir / "data" / "archive" / f"{gate}.json")["details"]
        self.assertNotIn("gmNotes", details)
        self.assertEqual((details["domains"], details["knownCreatures"]), (["abyssal"], ["Drift jellies"]))

    def test_forms_need_the_right_number_of_words(self) -> None:
        form = self.store.save_record("forms", None, {"name": "Flash Freeze", "tier": "second", "words": ["Absorb", "Heat"], "published": True})["id"]
        self.assertEqual(self.record("forms", form)["status"], "known")
        for data in ({"name": "Too few", "tier": "second", "words": ["Heat"]}, {"name": "Too many", "tier": "basic", "words": ["Heat", "Move"]},
                     {"name": "Unknown", "tier": "first", "words": ["Fly"]}, {"name": "Bad tier", "tier": "fourth", "words": ["Heat"]}):
            with self.assertRaises(ManagerError):
                self.store.save_record("forms", None, data)
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "forms" / f"{form}.json")
        self.assertEqual(set(exported), {"id", "name", "tier", "words", "effect", "status", "projectId"})

    def test_projects_reference_functions_resources_domain_and_gate(self) -> None:
        gate = self.gate()
        ember = self.store.save_record("resources", None, {"name": "Emberglass", "gateId": gate, "published": True})["id"]
        draft = self.store.save_record("resources", None, {"name": "Unpublished ore"})["id"]
        project = self.store.save_record("projects", None, {
            "name": "Establish Emberglass Supply", "progress": {"max": 10}, "published": True, "requiredFunctions": ["Heat", "Store"],
            "requiredResourceIds": [ember, draft], "requiredDomain": "volcanic", "relatedGateId": gate, "resultType": "resource-supply"})["id"]
        saved = self.record("projects", project)
        self.assertEqual((saved["requiredResourceIds"], saved["relatedGateId"], saved["resultType"]), ([ember, draft], gate, "resource-supply"))
        with self.assertRaisesRegex(ManagerError, "Project .* \(requiredResourceIds\)"):
            self.store.delete_record("resources", ember)
        with self.assertRaises(ManagerError):
            self.store.save_record("projects", project, {**saved, "requiredFunctions": ["Teleport"]})
        with self.assertRaises(ManagerError):
            self.store.save_record("projects", project, {**saved, "requiredDomain": "astral"})
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "projects" / f"{project}.json")
        self.assertEqual(exported["requiredResourceIds"], [ember], "unpublished Resources are left out")
        self.assertEqual((exported["relatedGateId"], exported["requiredDomain"]), (gate, "volcanic"))

    def test_older_databases_gain_the_v8_tables_and_project_gate_column(self) -> None:
        connection = sqlite3.connect(self.database)
        connection.execute("DROP TABLE project_resources")
        connection.execute("DROP TABLE resources")
        connection.execute("DROP TABLE forms")
        connection.commit()
        connection.close()
        reopened = ContentStore(self.database, self.data_dir)
        gate = reopened.save_record("archive", None, {"type": "gate-record", "title": "Old gate", "details": {"designation": "G-01"}})["id"]
        reopened.save_record("resources", None, {"name": "Works again", "gateId": gate})
        self.assertEqual(reopened.state()["vocabulary"]["domains"][0], "verdant")

    def test_characters_keep_a_coin_count(self) -> None:
        crew = self.store.save_record("characters", None, {"name": "Coin keeper", "published": True})["id"]
        self.assertEqual(self.record("characters", crew)["coins"], 0, "no coins given means none")
        self.store.save_record("characters", crew, {**self.record("characters", crew), "coins": "12"})
        self.assertEqual(self.record("characters", crew)["coins"], 12)
        for bad in (-1, "lots", 1_000_000):
            with self.assertRaises(ManagerError):
                self.store.save_record("characters", crew, {**self.record("characters", crew), "coins": bad})
        record = self.record("characters", crew)
        self.assertEqual((record["downtime"], record["carryLimit"]), (0, 6), "defaults: no Downtime, carry limit 6")
        self.store.save_record("characters", crew, {**record, "downtime": 8, "carryLimit": "9"})
        for field, bad in (("downtime", 9), ("downtime", -1), ("carryLimit", 100)):
            with self.assertRaises(ManagerError):
                self.store.save_record("characters", crew, {**self.record("characters", crew), field: bad})
        self.store.export_site()
        public = read_json(self.export_dir / "data" / "characters" / f"{crew}.json")
        self.assertEqual((public["coins"], public["downtime"], public["carryLimit"]), (12, 8, 9))

    def test_reading_path_is_saved_as_reading_orders(self) -> None:
        ids = [self.store.save_record("game", None, {"type": "rule", "title": title, "category": "Campaign", "order": order})["id"]
               for title, order in (("One", 1), ("Two", 2), ("Three", None))]
        notice = self.store.save_record("game", None, {"type": "announcement", "title": "News", "publishedAt": "2026-10-01"})["id"]
        self.store.save_reading_path([ids[2], ids[0]])
        orders = {post["id"]: post.get("order") for post in self.store.state()["game"]}
        self.assertEqual((orders[ids[2]], orders[ids[0]], orders[ids[1]]), (1, 2, None))
        for bad in ([notice], [ids[0], ids[0]], ["missing"], "one"):
            with self.assertRaises(ManagerError):
                self.store.save_reading_path(bad)
        self.store.save_reading_path([])
        self.assertTrue(all(post.get("order") is None for post in self.store.state()["game"]))

    def test_learning_paths_split_rules_and_set_a_global_order(self) -> None:
        ids = [self.store.save_record("game", None, {"type": "rule", "title": f"Rule {n}", "category": "Campaign", "published": n != 4})["id"] for n in range(5)]
        self.assertEqual(self.store.learning_paths()[0]["key"], "onboarding")
        self.store.save_learning_paths([{"title": "Onboarding", "ruleIds": [ids[1], ids[0]]},
                                        {"title": "Crafting & Artificery", "description": "For makers.", "ruleIds": [ids[2], ids[4]]}])
        paths = self.store.learning_paths()
        self.assertEqual([(path["key"], path["ruleIds"]) for path in paths], [("onboarding", [ids[1], ids[0]]), ("crafting-artificery", [ids[2], ids[4]])])
        orders = {post["id"]: post.get("order") for post in self.store.state()["game"]}
        self.assertEqual([orders[item] for item in ids], [2, 1, 3, None, 4])
        for bad in ([], [{"title": "Onboarding", "ruleIds": [ids[0]]}, {"title": "Other", "ruleIds": [ids[0]]}],
                    [{"title": "A"}, {"title": "a"}], [{"title": "Onboarding", "ruleIds": ["missing"]}]):
            with self.assertRaises(ManagerError):
                self.store.save_learning_paths(bad)
        self.store.save_reading_path([ids[2]])
        self.assertEqual([path["ruleIds"] for path in self.store.learning_paths()], [[ids[2]], [ids[4]]])
        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "learning-paths.json")
        self.assertEqual(exported[1]["ruleIds"], [], "unpublished rules are left out")

    def test_rules_with_a_reading_order_come_first_in_that_order(self) -> None:
        for title, order in (("Zeta", 2), ("Alpha", None), ("Omega", 1), ("Beta", "")):
            self.store.save_record("game", None, {"type": "rule", "title": title, "category": "Campaign", "order": order, "published": True})
        with self.assertRaises(ManagerError):
            self.store.save_record("game", None, {"type": "rule", "title": "Bad", "category": "Campaign", "order": "first"})
        self.store.export_site()
        rules = [post for post in read_json(self.export_dir / "data" / "game.json") if post["type"] == "rule"]
        titles = [post["title"] for post in rules]
        self.assertEqual(titles[:2], ["Omega", "Zeta"])
        self.assertLess(titles.index("Alpha"), titles.index("Beta"))
        self.assertIsNone(rules[titles.index("Alpha")]["order"])

    def test_rules_table_from_schema_v4_moves_into_game(self) -> None:
        connection = sqlite3.connect(self.database)
        connection.execute("CREATE TABLE rules (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
        connection.execute("INSERT INTO rules VALUES ('old-rule', ?)", (json.dumps({"id": "old-rule", "title": "Old rule", "category": "Jobs"}),))
        connection.commit()
        connection.close()
        reopened = ContentStore(self.database, self.data_dir)
        self.assertEqual(reopened.migration_report, ["Moved 1 rules into the Game section as rule posts."])
        post = next(item for item in reopened.state()["game"] if item["id"] == "old-rule")
        self.assertEqual((post["type"], post["category"], post["published"]), ("rule", "Jobs", True))
        connection = sqlite3.connect(self.database)
        self.assertIsNone(connection.execute("SELECT name FROM sqlite_master WHERE name = 'rules'").fetchone())
        connection.close()

    def test_import_accepts_a_rules_json_from_before_game(self) -> None:
        (self.data_dir / "game.json").unlink()
        write_json(self.data_dir / "rules.json", [{"id": "legacy", "title": "Legacy rule", "category": "Campaign"}])
        self.store.import_site()
        self.assertEqual(self.record("game", "legacy")["type"], "rule")

    # --- facilities and capability assets ---

    def capability(self, name: str, assets: list) -> dict:
        return {"name": name, "rating": "+0", "summary": "", "detail": "", "use": "", "assets": assets, "conditions": ""}

    def test_outpost_facilities_from_schema_v5_become_records(self) -> None:
        legacy = {**self.store.state()["outpost"],
                  "capabilities": [self.capability("Industry", "Foundry yards, repair sheds.")],
                  "facilities": [{"name": "Survey Spire", "summary": "Gate scans."}, {"name": "Survey Spire", "summary": "Again."}]}
        connection = sqlite3.connect(self.database)
        connection.execute("UPDATE outpost_state SET data = ? WHERE id = 1", (json.dumps(legacy),))
        connection.commit()
        connection.close()
        reopened = ContentStore(self.database, self.data_dir)
        self.assertEqual(reopened.migration_report[0], "Moved 2 Outpost facilities into the new Facilities section, flagged as sample content.")
        self.assertIn("legacy_records", reopened.migration_report[1])
        self.assertEqual(reopened.state()["facilities"], [], "sample facilities stay hidden while samples are off")
        reopened.set_include_samples(True)
        state = reopened.state()
        self.assertNotIn("facilities", state["outpost"])
        self.assertEqual(state["outpost"]["capabilities"][0]["assets"], [])
        spire = next(item for item in state["facilities"] if item["id"] == "survey-spire")
        self.assertEqual((spire["name"], spire["summary"], spire["published"], spire["sample"]), ("Survey Spire", "Gate scans.", True, True))
        self.assertIn("survey-spire-2", {item["id"] for item in state["facilities"]})
        connection = sqlite3.connect(self.database)
        kept = json.loads(connection.execute("SELECT data FROM legacy_records WHERE source = 'outpost'").fetchone()[0])
        connection.close()
        self.assertEqual(kept["capabilities"][0]["assets"], "Foundry yards, repair sheds.")
        self.assertEqual(ContentStore(self.database, self.data_dir).migration_report, [], "the migration runs once")

    def test_capability_assets_reference_facilities_and_characters(self) -> None:
        workshops = self.store.save_record("facilities", None, {"name": "Workshops", "summary": "General fabrication.", "published": True})["id"]
        docks = self.store.save_record("facilities", None, {"name": "Docks", "summary": "Shipping.", "published": False})["id"]
        hale = self.add_character("Doctor Hale")
        outpost = self.store.state()["outpost"]
        assets = [{"type": "facility", "id": workshops}, {"type": "character", "id": hale}, {"type": "facility", "id": workshops},
                  {"type": "facility", "id": docks}]
        self.store.save_outpost({**outpost, "capabilities": [self.capability("Industry", assets), self.capability("Commerce", [{"type": "facility", "id": docks}])]})
        self.assertEqual(len(self.store.state()["outpost"]["capabilities"][0]["assets"]), 3, "duplicates are merged")

        with self.assertRaisesRegex(ManagerError, "Unknown facility in the contributing assets of Industry: nowhere"):
            self.store.save_outpost({**outpost, "capabilities": [self.capability("Industry", [{"type": "facility", "id": "nowhere"}])]})
        with self.assertRaisesRegex(ManagerError, "must be a facility or a character"):
            self.store.save_outpost({**outpost, "capabilities": [self.capability("Industry", [{"type": "gear", "id": "rope"}])]})
        with self.assertRaisesRegex(ManagerError, "Reload the manager page"):
            self.store.save_outpost({**outpost, "capabilities": [self.capability("Industry", "free text")]})
        with self.assertRaisesRegex(ManagerError, "Reload the manager page"):
            self.store.save_outpost({**outpost, "facilities": []})

        with self.assertRaisesRegex(ManagerError, "Outpost capability “Industry” \\(contributing assets\\)"):
            self.store.delete_record("facilities", workshops)
        with self.assertRaisesRegex(ManagerError, "Outpost capability “Industry”"):
            self.store.delete_record("characters", hale)

        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "outpost.json")
        self.assertEqual(exported["capabilities"][0]["assets"], [
            {"type": "facility", "id": workshops, "name": "Workshops"}, {"type": "character", "id": hale, "name": "Doctor Hale"}],
            "unpublished facilities are left out")
        self.assertEqual(exported["facilities"], [{"id": workshops, "name": "Workshops", "summary": "General fabrication.", "details": "",
                                                   "projectId": None, "capabilities": ["Industry"]}])

        self.store.sync_site_data()
        self.store.import_site()
        state = self.store.state()
        self.assertEqual(state["outpost"]["capabilities"][0]["assets"], [{"type": "facility", "id": workshops}, {"type": "character", "id": hale}],
                         "import reads the references back without the names")
        self.assertEqual([(item["id"], item["published"]) for item in state["facilities"]], [(workshops, True)])
        self.assertNotIn("facilities", state["outpost"])

    # --- projects ---

    def add_project(self, name: str, **fields) -> str:
        return self.store.save_record("projects", None, {"name": name, "progress": {"current": 0, "max": 4}, "published": True, **fields})["id"]

    def test_outpost_projects_and_conditions_from_schema_v6(self) -> None:
        legacy = {**self.store.state()["outpost"],
                  "activeProjects": [{"name": "Harbor Reinforcement", "summary": "Repair the docks.", "progress": {"current": 2, "max": 6},
                                      "completion": {"summary": "The docks hold."}}],
                  "conditions": [{"name": "Unstable Harbor Approach", "summary": "Dangerous."}]}
        connection = sqlite3.connect(self.database)
        connection.execute("UPDATE outpost_state SET data = ? WHERE id = 1", (json.dumps(legacy),))
        connection.commit()
        connection.close()
        reopened = ContentStore(self.database, self.data_dir)
        self.assertEqual(reopened.migration_report, [
            "Moved 1 Outpost projects into the new Projects section, flagged as sample content.",
            "Persistent conditions were retired; the old ones are kept in legacy_records (source 'outpost')."])
        reopened.set_include_samples(True)
        state = reopened.state()
        self.assertFalse({"activeProjects", "conditions"} & set(state["outpost"]))
        project = state["projects"][0]
        self.assertEqual((project["id"], project["outpost"], project["access"], project["progress"], project["outcome"], project["sample"]),
                         ("harbor-reinforcement", True, "open", {"current": 2, "max": 6}, "The docks hold.", True))
        self.assertEqual(ContentStore(self.database, self.data_dir).migration_report, [], "the migration runs once")

    def test_projects_link_characters_gear_and_facilities(self) -> None:
        mara = self.add_character("Mara")
        hidden = self.add_character("Hidden", published=False)
        prototype = self.add_project("Prototype Rifle", access="private", characterIds=[mara, hidden],
                                     progress={"current": 4, "max": 4}, prerequisites="Workshop access\nA rare alloy", outcome="A **new** rifle.")
        harbor = self.add_project("Harbor Crane", outpost=True)
        draft = self.add_project("Secret Plan", published=False)
        self.assertEqual(self.record("projects", prototype)["prerequisites"],
                         [{"text": "Workshop access", "met": False}, {"text": "A rare alloy", "met": False}], "text lines are accepted")
        self.store.save_record("projects", prototype, {**self.record("projects", prototype),
            "prerequisites": [{"text": "Workshop access", "met": True}, {"text": "  "}],
            "complications": [{"text": "The alloy cracked.", "resolved": True, "resolution": "Bought a new shard."},
                              {"text": "Varga wants a cut."}, {"text": "", "resolution": "dropped"}]})
        saved = self.record("projects", prototype)
        self.assertEqual(saved["prerequisites"], [{"text": "Workshop access", "met": True}])
        self.assertEqual(saved["complications"], [
            {"text": "The alloy cracked.", "resolved": True, "resolution": "Bought a new shard."},
            {"text": "Varga wants a cut.", "resolved": False, "resolution": ""}])
        with self.assertRaisesRegex(ManagerError, "Complications must be a list"):
            self.store.save_record("projects", prototype, {**saved, "complications": {"text": "x"}})
        with self.assertRaisesRegex(ManagerError, "between 1 and 40 progress boxes"):
            self.store.save_record("projects", None, {"name": "X", "progress": {"current": 0, "max": 0}})
        with self.assertRaisesRegex(ManagerError, "cannot be more than"):
            self.store.save_record("projects", None, {"name": "X", "progress": {"current": 5, "max": 4}})
        with self.assertRaisesRegex(ManagerError, "Unknown"):
            self.store.save_record("projects", None, {"name": "X", "progress": {"max": 4}, "characterIds": ["nobody"]})

        rifle = self.add_gear("Prototype Rifle", projectId=prototype)
        lens = self.add_gear("Lens", projectId=draft)
        crane = self.store.save_record("facilities", None, {"name": "Big Crane", "projectId": harbor, "published": True})["id"]
        with self.assertRaisesRegex(ManagerError, "Unknown project"):
            self.add_gear("Ghost", projectId="nowhere")
        with self.assertRaisesRegex(ManagerError, "still referenced by Gear “Prototype Rifle” \\(projectId\\)"):
            self.store.delete_record("projects", prototype)
        with self.assertRaisesRegex(ManagerError, "Project “Prototype Rifle”"):
            self.store.delete_record("characters", mara)

        self.store.export_site()
        data = self.export_dir / "data"
        exported = read_json(data / "projects" / f"{prototype}.json")
        self.assertEqual(exported["characterIds"], [mara], "unpublished characters are left out")
        self.assertEqual(set(exported), {"id", "name", "access", "outpost", "characterIds", "summary", "prerequisites", "complications", "outcome", "progress",
                                         "requiredFunctions", "requiredResourceIds", "requiredDomain", "relatedGateId", "resultType"})
        self.assertEqual(sorted(read_json(data / "projects" / "index.json")), sorted([f"{prototype}.json", f"{harbor}.json"]))
        self.assertEqual(read_json(data / "gear" / f"{rifle}.json")["projectId"], prototype)
        self.assertIsNone(read_json(data / "gear" / f"{lens}.json")["projectId"], "unpublished projects are not named")
        facility = next(item for item in read_json(data / "outpost.json")["facilities"] if item["id"] == crane)
        self.assertEqual(facility["projectId"], harbor)

        self.store.sync_site_data()
        self.store.import_site()
        self.assertEqual(self.record("projects", prototype)["characterIds"], [mara])
        self.assertEqual(self.record("projects", prototype)["complications"][1]["text"], "Varga wants a cut.")
        self.assertEqual(self.record("gear", rifle)["projectId"], prototype)
        self.assertEqual(self.record("facilities", crane)["projectId"], harbor)

    # --- character sheets ---

    def test_fate_sheet_is_cleaned_and_published_only_when_public(self) -> None:
        sheet = {
            "public": True,
            "aspects": {"highConcept": "Salvage Diver", "trouble": "Debts", "other": ["", "Knows the tides"]},
            "skills": [{"name": "Athletics", "rating": "2"}, {"name": "Notice", "rating": 4}, {"name": "", "rating": 1}],
            "stunts": [{"name": "Deep Breath", "description": "+2 underwater."}, {"name": "", "description": ""}],
            "refresh": "3", "fatePoints": "",
            "stress": [{"name": "Physical", "boxes": [True, False, False]}, {"name": "", "boxes": []}],
            "consequences": [{"label": "Mild", "shift": 2, "aspect": "Bruised Ribs"}],
            "extras": "",
        }
        character = self.add_character("Mara", sheet=sheet)
        stored = self.record("characters", character)["sheet"]
        self.assertEqual([skill["name"] for skill in stored["skills"]], ["Notice", "Athletics"])
        self.assertEqual(stored["aspects"]["other"], ["Knows the tides"])
        self.assertEqual(len(stored["stunts"]), 1)
        self.assertEqual((stored["refresh"], stored["fatePoints"]), (3, None))
        self.assertEqual(stored["stress"], [{"name": "Physical", "boxes": [True, False, False]}])

        self.store.export_site()
        exported = read_json(self.export_dir / "data" / "characters" / f"{character}.json")["sheet"]
        self.assertNotIn("public", exported)
        self.assertEqual(exported["consequences"][0]["aspect"], "Bruised Ribs")

        self.store.save_record("characters", character, {"name": "Mara", "published": True, "sheet": {**stored, "public": False}})
        self.store.export_site()
        self.assertIsNone(read_json(self.export_dir / "data" / "characters" / f"{character}.json")["sheet"])
        self.assertIsNotNone(self.record("characters", character)["sheet"], "hidden sheets stay in the manager")

    def test_invalid_fate_sheet_values_are_rejected(self) -> None:
        with self.assertRaisesRegex(ManagerError, "Rating for Fight"):
            self.add_character("X", sheet={"skills": [{"name": "Fight", "rating": 12}], "refresh": 3})
        with self.assertRaisesRegex(ManagerError, "at most 10 boxes"):
            self.add_character("X", sheet={"stress": [{"name": "Physical", "boxes": [False] * 11}], "refresh": 3})
        with self.assertRaisesRegex(ManagerError, "Refresh"):
            self.add_character("X", sheet={"refresh": ""})

    # --- images ---

    def test_portrait_upload_is_exported_only_with_published_character(self) -> None:
        data_url = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()
        path = self.store.save_media({"filename": "Varga Portrait.png", "dataUrl": data_url})["path"]
        self.assertTrue(path.startswith("data/portraits/varga-portrait-"))
        varga = self.add_character("Varga", portrait=path)
        self.store.export_site()
        exported = self.export_dir / path
        self.assertEqual(exported.read_bytes(), PNG_BYTES)
        self.assertEqual(read_json(self.export_dir / "data" / "characters" / f"{varga}.json")["portrait"], path)

        self.store.save_record("characters", varga, {"name": "Varga", "portrait": path, "published": False})
        self.store.export_site()
        self.assertFalse((self.export_dir / path).exists())

        self.store.delete_record("characters", varga)
        self.assertIsNone(self.store.media(path.removeprefix("data/portraits/")))

    def test_archive_and_gear_images_are_exported(self) -> None:
        data_url = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()
        path = self.store.save_media({"filename": "Lantern.png", "dataUrl": data_url, "kind": "image"})["path"]
        self.assertTrue(path.startswith("data/images/lantern-"))
        lantern = self.add_gear("Lantern", image=path)
        self.store.save_record("archive", "g-03", {**self.record("archive", "g-03"), "image": path})
        self.store.export_site()
        self.assertEqual((self.export_dir / path).read_bytes(), PNG_BYTES)
        self.store.delete_record("gear", lantern)
        self.assertIsNotNone(self.store.media(path.removeprefix("data/images/")), "still used by the Gate Record")

    def test_non_image_upload_is_rejected(self) -> None:
        with self.assertRaisesRegex(ManagerError, "PNG, JPEG"):
            self.store.save_media({"filename": "x.txt", "dataUrl": "data:text/plain;base64,aGk="})

    # --- export / sync ---

    def test_export_builds_complete_replaceable_site_folder_without_touching_source(self) -> None:
        # data/ is regenerated: files the manager did not write are not exported.
        stale_entry = self.data_dir / "archive" / "g-99.json"
        unmanaged_file = self.data_dir / "notes.json"
        write_json(stale_entry, {"type": "gate-record", "title": "Stale gate"})
        write_json(unmanaged_file, [{"designation": "G-99"}])

        result = self.store.export_site()
        exported_site = self.export_dir

        self.assertEqual(Path(str(result["destination"])), exported_site)
        self.assertEqual(result["siteFiles"], len([path for path in exported_site.rglob("*") if path.is_file()]))
        for relative_path in ("index.html", "styles.css", "site.js", "assets/images/outpost.txt"):
            with self.subTest(static_file=relative_path):
                self.assertEqual((exported_site / relative_path).read_bytes(), (self.site_dir / relative_path).read_bytes())
        self.assertEqual(read_json(exported_site / "data/archive/index.json"), ["g-03.json", "gate-note.json", "route-note.json"])
        self.assertEqual(read_json(exported_site / "data/characters/index.json"), [])
        self.assertTrue((exported_site / "data/outpost.json").is_file())
        self.assertFalse((exported_site / "data/archive/g-99.json").exists())
        self.assertFalse((exported_site / "data/notes.json").exists())
        self.assertTrue(stale_entry.exists())
        self.assertTrue(unmanaged_file.exists())

        (exported_site / "old-deployment-file.txt").write_text("old", encoding="utf-8")
        self.store.export_site()
        self.assertFalse((exported_site / "old-deployment-file.txt").exists())

    def test_sync_api_replaces_only_the_data_folder(self) -> None:
        unmanaged_file = self.data_dir / "old-custom-data.json"
        unmanaged_file.write_text('{"obsolete": true}', encoding="utf-8")
        page_before = (self.site_dir / "index.html").read_bytes()
        send, stop = self.serve()
        try:
            result = send("/api/sync", {})
        finally:
            stop()
        self.assertEqual(Path(result["destination"]), self.data_dir)
        self.assertEqual((result["archive"], result["jobs"], result["gear"]), (3, 2, 1))
        self.assertFalse(unmanaged_file.exists())
        self.assertTrue((self.data_dir / "archive" / "g-03.json").is_file())
        self.assertEqual(read_json(self.data_dir / "game.json")[0]["id"], "persistent-world")
        self.assertEqual((self.site_dir / "index.html").read_bytes(), page_before)

    def test_api_crud_and_delete_protection(self) -> None:
        send, stop = self.serve()
        try:
            character = send("/api/characters", {"data": {"name": "Varga", "type": "npc", "published": True}})["id"]
            session = send("/api/archive", {"data": {"type": "session-record", "title": "Descent log", "published": True}})["id"]
            job = send("/api/jobs", {"data": {
                "title": "First Descent", "organizerId": character, "participantIds": [character], "published": True,
            }})["id"]
            send(f"/api/jobs/{job}", {"data": {
                "title": "First Descent", "organizerId": character, "participantIds": [], "status": "completed",
                "sessionRecordId": session, "published": True,
            }}, "PUT")
            with self.assertRaises(HTTPError) as blocked:
                send(f"/api/archive/{session}", method="DELETE")
            self.assertIn("First Descent", json.loads(blocked.exception.read())["error"])

            state = send("/api/state", method="GET")
            self.assertEqual(next(item for item in state["jobs"] if item["id"] == job)["status"], "completed")
            send("/api/outpost", {"data": {**state["outpost"], "name": "The Outpost"}})
            self.assertEqual(send("/api/state", method="GET")["outpost"]["name"], "The Outpost")
            send(f"/api/jobs/{job}", method="DELETE")
            send(f"/api/archive/{session}", method="DELETE")
            send(f"/api/characters/{character}", method="DELETE")
            rule = send("/api/game", {"data": {"type": "rule", "title": "Choose a route", "category": "Jobs", "published": True}})["id"]
            send("/api/export", {})
            self.assertIn(rule, [item["id"] for item in read_json(self.export_dir / "data" / "game.json")])
        finally:
            stop()


class LegacyMigrationTests(unittest.TestCase):
    """A schema v3 database (Island, Gates, Expeditions, Reports) is converted in place on startup."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.data_dir = self.root / "public-site" / "data"
        self.data_dir.mkdir(parents=True)
        self.database = self.root / "content.db"
        connection = sqlite3.connect(self.database)
        connection.executescript("""
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE island_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
            CREATE TABLE rules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE characters (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE gates (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE expeditions (id TEXT PRIMARY KEY, gate_id TEXT REFERENCES gates(id), organizer_id TEXT REFERENCES characters(id), data TEXT NOT NULL);
            CREATE TABLE expedition_participants (expedition_id TEXT NOT NULL, character_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (expedition_id, character_id));
            CREATE TABLE expedition_reports (id TEXT PRIMARY KEY, expedition_id TEXT NOT NULL REFERENCES expeditions(id), submitted_by TEXT REFERENCES characters(id), data TEXT NOT NULL);
            CREATE TABLE media (filename TEXT PRIMARY KEY, content_type TEXT NOT NULL, content BLOB NOT NULL);
        """)
        rows = {
            "metadata": [("initialized", "1")],
            "island_state": [(1, json.dumps({"name": "The Island", "highConcept": "An island settlement",
                                             "capabilities": [{"name": "Industry", "detail": "The Island's ability to build."}]}))],
            "rules": [("island-projects", json.dumps({"id": "island-projects", "category": "Island", "title": "Island projects",
                                                      "summary": "See the Island Sheet and the Gate archive.", "tags": ["Island"]}))],
            "characters": [("mara", json.dumps({"name": "Mara", "type": "player", "status": "active", "published": True}))],
            "gates": [("g-03", json.dumps({"published": True, "designation": "G-03", "name": "The Silt Choir", "status": "dormant",
                                           "discoveredAt": "2026-01-02", "overview": "Harmonic patterns.", "environment": "Drowned.",
                                           "knownTraits": ["Echoes"], "knownHazards": ["Pressure"], "knownLocations": ["Ring"]}))],
            "expeditions": [
                ("e-17", "g-03", "mara", json.dumps({"published": True, "designation": "E-17", "title": "Saltglass Survey",
                                                    "type": "exploration", "status": "underway", "objective": "Map it.",
                                                    "briefing": "Bring rope.", "scheduledAt": "2026-09-10T19:00",
                                                    "requirements": ["Divers"], "crewMin": 2, "crewMax": 4})),
                ("e-18", None, None, json.dumps({"published": False, "title": "Rescue", "type": "rescue", "status": "recruiting"})),
            ],
            "expedition_participants": [("e-17", "mara", 0)],
            "expedition_reports": [
                ("late", "e-17", None, json.dumps({"published": True, "title": "Late notes", "submittedAt": "2026-09-18",
                                                  "outcome": "unknown", "summary": "Later.", "notes": "More."})),
                ("early", "e-17", "mara", json.dumps({"published": True, "title": "Early notes", "submittedAt": "2026-09-12",
                                                     "outcome": "partial", "summary": "Sooner.", "notes": "Found a door.",
                                                     "discoveries": ["A door"], "hazards": [], "recoveredItems": [], "casualties": []})),
            ],
        }
        for table, values in rows.items():
            for value in values:
                connection.execute(f"INSERT INTO {table} VALUES ({', '.join('?' for _ in value)})", value)
        connection.commit()
        connection.close()
        self.store = ContentStore(self.database, self.data_dir, self.root / "site-export")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def record(self, collection: str, record_id: str) -> dict:
        return next(item for item in self.store.state()[collection] if item["id"] == record_id)

    def test_gates_reports_and_expeditions_are_converted(self) -> None:
        gate = self.record("archive", "g-03")
        self.assertEqual((gate["type"], gate["title"], gate["published"]), ("gate-record", "The Silt Choir", True))
        self.assertEqual(gate["details"], {"designation": "G-03", "gateStatus": "dormant", "discoveredAt": "2026-01-02",
                                           "environment": "Drowned.", "knownTraits": ["Echoes"], "knownHazards": ["Pressure"],
                                           "knownLocations": ["Ring"]})
        self.assertIn("Harmonic patterns.", gate["content"])
        self.assertIn("[E-17 · Saltglass Survey](jobs.html#e-17) — session records: [[early]], [[late]]", gate["content"])

        early = self.record("archive", "early")
        self.assertEqual((early["type"], early["author"], early["publishedAt"]), ("session-record", "Mara", "2026-09-12"))
        self.assertEqual(early["details"], {"sessionDate": "2026-09-10", "outcome": "partial"})
        self.assertEqual(early["participantIds"], ["mara"])
        self.assertIn("## Discoveries\n- A door", early["content"])

        job = self.record("jobs", "e-17")
        self.assertEqual((job["type"], job["status"], job["sessionRecordId"]), ("expedition", "in-progress", "early"))
        self.assertEqual((job["organizerId"], job["participantIds"], job["crewMax"]), ("mara", ["mara"], 4))
        self.assertEqual(job["briefing"], "Bring rope.\n\nGate: [[g-03]]\n\nFurther session records: [[late]]")
        self.assertEqual(job["legacy"]["gateId"], "g-03")
        rescue = self.record("jobs", "e-18")
        self.assertEqual((rescue["type"], rescue["status"], rescue["published"]), ("other", "open", False))
        self.assertTrue(any("rescue" in line for line in self.store.migration_report))

    def test_outpost_and_rules_terminology_and_source_preservation(self) -> None:
        state = self.store.state()
        self.assertEqual(state["outpost"]["name"], "The Outpost")
        self.assertEqual(state["outpost"]["capabilities"][0]["detail"], "The Outpost's ability to build.")
        rule = state["game"][0]
        self.assertEqual((rule["id"], rule["type"], rule["category"], rule["tags"]), ("island-projects", "rule", "Outpost", ["Outpost"]))
        self.assertEqual(rule["summary"], "See the Outpost Sheet and the Archive.")

        connection = sqlite3.connect(self.database)
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        sources = {row[0] for row in connection.execute("SELECT source FROM legacy_records")}
        connection.close()
        self.assertFalse(tables & {"gates", "expeditions", "expedition_reports", "island_state"})
        self.assertEqual(sources, {"gates", "expeditions", "expedition_reports", "island_state", "expedition_participants", "rules"})
        self.assertTrue((self.root / "content.v3-backup.db").is_file())

    def test_migrated_records_keep_provenance_after_editing_and_export_cleanly(self) -> None:
        job = self.record("jobs", "e-17")
        self.store.save_record("jobs", "e-17", {**job, "summary": "Edited."})
        self.assertEqual(self.record("jobs", "e-17")["legacy"]["source"], "expeditions")
        self.store.export_site()
        exported = read_json(self.root / "site-export" / "data" / "jobs" / "e-17.json")
        self.assertNotIn("legacy", exported)
        self.assertEqual(exported["sessionRecordId"], "early")
        # Reopening the migrated database does not migrate twice.
        reopened = ContentStore(self.database, self.data_dir, self.root / "site-export")
        self.assertEqual(reopened.migration_report, [])


if __name__ == "__main__":
    unittest.main()
