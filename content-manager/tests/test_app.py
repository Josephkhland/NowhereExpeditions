import base64
import json
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
        (self.site_dir / "assets" / "images" / "island.txt").write_text("static asset", encoding="utf-8")
        write_json(self.data_dir / "island.json", {
            "name": "Test Island",
            "highConcept": "A fixture",
            "stress": {"current": 1, "max": 6},
            "capabilities": [],
            "consequences": [],
            "facilities": [],
            "activeProjects": [],
            "conditions": [],
        })
        write_json(self.data_dir / "characters" / "index.json", [])
        write_json(self.data_dir / "gates" / "index.json", ["g-03.json"])
        write_json(self.data_dir / "gates" / "g-03.json", {
            "id": "g-03", "designation": "G-03", "name": "Silt Choir", "status": "active", "discoveredAt": "",
            "overview": "Harmonic patterns.", "environment": "A drowned corridor.",
            "knownTraits": [], "knownHazards": ["Pressure shifts"], "knownLocations": [],
        })
        expedition = {
            "briefing": "", "type": "exploration", "scheduledAt": "", "expectedDuration": "", "organizerId": None,
            "participantIds": [], "crewCount": 0, "crewMin": None, "crewMax": None, "requirements": [],
        }
        write_json(self.data_dir / "expeditions" / "index.json", ["e-16.json", "e-17.json"])
        write_json(self.data_dir / "expeditions" / "e-16.json", {
            **expedition, "id": "e-16", "designation": "E-16", "title": "Harbor Watch", "gateId": "g-03",
            "objective": "Watch the harbor ring.", "status": "completed",
        })
        write_json(self.data_dir / "expeditions" / "e-17.json", {
            **expedition, "id": "e-17", "designation": "E-17", "title": "Saltglass Survey", "gateId": None,
            "objective": "Map the approaches.", "status": "recruiting",
        })
        report = {"submittedBy": None, "outcome": "unknown", "discoveries": [], "hazards": [], "recoveredItems": [], "casualties": []}
        write_json(self.data_dir / "reports" / "index.json", ["gate-note.json", "route-note.json"])
        write_json(self.data_dir / "reports" / "gate-note.json", {
            **report, "id": "gate-note", "expeditionId": "e-16", "gateId": "g-03", "title": "Gate Note",
            "submittedAt": "2026-09-12", "summary": "A short note", "notes": "Observed near the harbor.",
        })
        write_json(self.data_dir / "reports" / "route-note.json", {
            **report, "id": "route-note", "expeditionId": "e-17", "gateId": None, "title": "Route Note",
            "submittedAt": "", "summary": "Routes held.", "notes": "Details.",
        })
        write_json(self.data_dir / "rules.json", [{
            "id": "persistent-world",
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
        self.assertEqual(state["island"]["name"], "Test Island")
        self.assertEqual(state["rules"][0]["id"], "persistent-world")
        self.assertTrue(state["rules"][0]["published"])
        self.assertEqual(self.record("gates", "g-03")["knownHazards"], ["Pressure shifts"])
        self.assertEqual(self.record("expeditions", "e-16")["gateId"], "g-03")
        self.assertNotIn("crewCount", self.record("expeditions", "e-16"), "crew count is derived on export")
        report = self.record("reports", "gate-note")
        self.assertEqual(report["expeditionId"], "e-16")
        self.assertNotIn("gateId", report, "a report's Gate is derived on export")
        self.assertTrue(all(record["published"] for name in ("gates", "expeditions", "reports") for record in state[name]))

    def test_export_then_import_round_trips_new_format(self) -> None:
        varga = self.add_character("Varga", type="npc", summary="Quartermaster.")
        self.store.save_record("expeditions", "e-17", {**self.record("expeditions", "e-17"), "gateId": "g-03",
                                                       "organizerId": varga, "participantIds": [varga]})
        self.store.sync_site_data()
        self.store.import_site()
        expedition = self.record("expeditions", "e-17")
        self.assertEqual(expedition["gateId"], "g-03")
        self.assertEqual(expedition["participantIds"], [varga])
        self.assertEqual(self.record("characters", varga)["summary"], "Quartermaster.")
        self.assertEqual(self.record("reports", "route-note")["expeditionId"], "e-17")
        self.assertNotIn("gateId", self.record("reports", "route-note"))

    # --- CRUD and references ---

    def test_crud_for_all_content_types_and_participant_order(self) -> None:
        varga = self.add_character("Varga", type="npc", status="active")
        mara = self.add_character("Mara Lind", playerName="Alex")
        oren = self.add_character("Oren")
        self.assertEqual(varga, "varga")
        gate = self.store.save_record("gates", None, {
            "designation": "Gate 017", "name": "The Sunken Archive", "status": "dormant",
            "knownTraits": "Tidal time\n\nEchoes", "published": True,
        })["id"]
        self.assertEqual(gate, "gate-017")
        self.assertEqual(self.record("gates", gate)["knownTraits"], ["Tidal time", "Echoes"])
        expedition = self.store.save_record("expeditions", None, {
            "title": "Return to the Sunken Archive", "designation": "017-C", "gateId": gate, "type": "exploration",
            "status": "recruiting", "scheduledAt": "2026-10-03T19:00", "organizerId": varga,
            "participantIds": [oren, mara, oren], "crewMin": "2", "crewMax": 5, "published": True,
        })["id"]
        saved = self.record("expeditions", expedition)
        self.assertEqual(saved["participantIds"], [oren, mara])
        self.assertEqual((saved["crewMin"], saved["crewMax"]), (2, 5))
        report = self.store.save_record("reports", None, {
            "title": "Sealed structure found", "expeditionId": expedition, "gateId": gate, "submittedBy": mara,
            "outcome": "partial", "discoveries": ["A sealed door"], "published": True,
        })["id"]
        self.assertNotIn("gateId", self.record("reports", report), "a report's Gate is derived from its Expedition, never stored")

        self.store.save_record("characters", mara, {"name": "Mara Lind", "status": "missing", "published": True})
        self.assertEqual(self.record("characters", mara)["status"], "missing")

        self.store.delete_record("reports", report)
        self.store.delete_record("expeditions", expedition)
        self.store.delete_record("gates", gate)
        self.store.delete_record("characters", mara)
        self.assertNotIn(mara, [item["id"] for item in self.store.state()["characters"]])

    def test_invalid_references_and_values_are_rejected(self) -> None:
        with self.assertRaisesRegex(ManagerError, "Unknown gate"):
            self.store.save_record("expeditions", None, {"title": "X", "gateId": "nope"})
        with self.assertRaisesRegex(ManagerError, "Unknown participant"):
            self.store.save_record("expeditions", None, {"title": "X", "participantIds": ["ghost"]})
        with self.assertRaisesRegex(ManagerError, "status must be one of"):
            self.store.save_record("gates", None, {"designation": "G-1", "name": "X", "status": "haunted"})
        with self.assertRaisesRegex(ManagerError, "Minimum crew"):
            self.store.save_record("expeditions", None, {"title": "X", "crewMin": 5, "crewMax": 2})
        with self.assertRaisesRegex(ManagerError, "must belong to an Expedition"):
            self.store.save_record("reports", None, {"title": "Orphan"})
        with self.assertRaisesRegex(ManagerError, "already uses the designation"):
            self.store.save_record("gates", None, {"designation": "g_03", "name": "Duplicate Gate"})

    def test_referenced_records_cannot_be_deleted(self) -> None:
        varga = self.add_character("Varga")
        self.store.save_record("expeditions", "e-17", {**self.record("expeditions", "e-17"), "gateId": "g-03", "participantIds": [varga]})
        with self.assertRaisesRegex(ManagerError, "Saltglass Survey.*participant"):
            self.store.delete_record("characters", varga)
        with self.assertRaisesRegex(ManagerError, "E-17 · Saltglass Survey.*gateId"):
            self.store.delete_record("gates", "g-03")
        with self.assertRaisesRegex(ManagerError, "Route Note"):
            self.store.delete_record("expeditions", "e-17")
        self.assertEqual(len(self.store.state()["gates"]), 1)

    # --- publishing ---

    def test_unpublished_records_are_left_out_and_references_to_them_dropped(self) -> None:
        secret = self.store.save_record("characters", None, {"name": "Hidden Patron", "published": False})["id"]
        crew = self.add_character("Crew Member")
        self.store.save_record("gates", None, {"designation": "G-99", "name": "Secret Gate", "published": False})
        self.store.save_record("expeditions", "e-17", {**self.record("expeditions", "e-17"), "gateId": "g-99",
                                                       "organizerId": secret, "participantIds": [secret, crew]})
        hidden_expedition = self.store.save_record("expeditions", None, {"title": "Black op", "published": False})["id"]
        self.store.save_record("reports", None, {"title": "Classified", "expeditionId": hidden_expedition, "published": True})
        self.store.save_record("rules", "persistent-world", {**self.record("rules", "persistent-world"), "published": False})

        counts = self.store.export_site()
        data = self.export_dir / "data"
        self.assertEqual(read_json(data / "characters" / "index.json"), [f"{crew}.json"])
        self.assertEqual(read_json(data / "gates" / "index.json"), ["g-03.json"])
        self.assertEqual(read_json(data / "expeditions" / "index.json"), ["e-16.json", "e-17.json"])
        self.assertEqual(read_json(data / "reports" / "index.json"), ["gate-note.json", "route-note.json"])
        self.assertEqual(read_json(data / "rules.json"), [])
        expedition = read_json(data / "expeditions" / "e-17.json")
        self.assertIsNone(expedition["gateId"])
        self.assertIsNone(expedition["organizerId"])
        self.assertEqual(expedition["participantIds"], [crew])
        self.assertEqual(expedition["crewCount"], 2)
        self.assertNotIn("published", expedition)
        self.assertEqual(counts["unpublished"], 5)

    def test_new_records_default_to_unpublished(self) -> None:
        record_id = self.store.save_record("characters", None, {"name": "Draft"})["id"]
        self.assertFalse(self.record("characters", record_id)["published"])

    def test_report_gate_is_derived_from_expedition_on_export(self) -> None:
        self.store.save_record("expeditions", "e-17", {**self.record("expeditions", "e-17"), "gateId": "g-03"})
        self.store.export_site()
        report = read_json(self.export_dir / "data" / "reports" / "route-note.json")
        self.assertEqual(report["expeditionId"], "e-17")
        self.assertEqual(report["gateId"], "g-03")
        self.assertEqual(set(report), {"id", "expeditionId", "gateId", "title", "submittedBy", "submittedAt", "outcome",
                                       "summary", "discoveries", "hazards", "recoveredItems", "casualties", "notes"})

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

    # --- portraits ---

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

    def test_non_image_upload_is_rejected(self) -> None:
        with self.assertRaisesRegex(ManagerError, "PNG, JPEG"):
            self.store.save_media({"filename": "x.txt", "dataUrl": "data:text/plain;base64,aGk="})

    # --- export / sync ---

    def test_export_builds_complete_replaceable_site_folder_without_touching_source(self) -> None:
        # data/ is regenerated: files the manager did not write are not exported.
        stale_gate = self.data_dir / "gates" / "g-99.json"
        unmanaged_file = self.data_dir / "notes.json"
        write_json(stale_gate, {"designation": "G-99", "name": "Stale gate"})
        write_json(unmanaged_file, [{"designation": "G-99"}])

        result = self.store.export_site()
        exported_site = self.export_dir

        self.assertEqual(Path(str(result["destination"])), exported_site)
        self.assertEqual(result["siteFiles"], len([path for path in exported_site.rglob("*") if path.is_file()]))
        for relative_path in ("index.html", "styles.css", "site.js", "assets/images/island.txt"):
            with self.subTest(static_file=relative_path):
                self.assertEqual((exported_site / relative_path).read_bytes(), (self.site_dir / relative_path).read_bytes())
        self.assertEqual(read_json(exported_site / "data/gates/index.json"), ["g-03.json"])
        self.assertEqual(read_json(exported_site / "data/characters/index.json"), [])
        self.assertTrue((exported_site / "data/island.json").is_file())
        self.assertFalse((exported_site / "data/gates/g-99.json").exists())
        self.assertFalse((exported_site / "data/notes.json").exists())
        self.assertTrue(stale_gate.exists())
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
        self.assertEqual((result["gates"], result["expeditions"], result["reports"]), (1, 2, 2))
        self.assertFalse(unmanaged_file.exists())
        self.assertTrue((self.data_dir / "gates" / "g-03.json").is_file())
        self.assertEqual(read_json(self.data_dir / "rules.json")[0]["id"], "persistent-world")
        self.assertEqual((self.site_dir / "index.html").read_bytes(), page_before)

    def test_api_crud_and_delete_protection(self) -> None:
        send, stop = self.serve()
        try:
            character = send("/api/characters", {"data": {"name": "Varga", "type": "npc", "published": True}})["id"]
            gate = send("/api/gates", {"data": {"designation": "Gate 017", "name": "Archive", "published": True}})["id"]
            expedition = send("/api/expeditions", {"data": {
                "title": "First Descent", "gateId": gate, "organizerId": character, "participantIds": [character], "published": True,
            }})["id"]
            send(f"/api/expeditions/{expedition}", {"data": {
                "title": "First Descent", "gateId": gate, "organizerId": character, "participantIds": [], "status": "completed", "published": True,
            }}, "PUT")
            report = send("/api/reports", {"data": {"title": "Descent log", "expeditionId": expedition, "published": True}})["id"]
            with self.assertRaises(HTTPError) as blocked:
                send(f"/api/gates/{gate}", method="DELETE")
            self.assertIn("First Descent", json.loads(blocked.exception.read())["error"])

            state = send("/api/state", method="GET")
            self.assertEqual(next(item for item in state["expeditions"] if item["id"] == expedition)["status"], "completed")
            send(f"/api/reports/{report}", method="DELETE")
            send(f"/api/expeditions/{expedition}", method="DELETE")
            send(f"/api/gates/{gate}", method="DELETE")
            send(f"/api/characters/{character}", method="DELETE")
            rule = send("/api/rules", {"data": {"title": "Choose a route", "category": "Expeditions", "published": True}})["id"]
            send("/api/export", {})
            self.assertIn(rule, [item["id"] for item in read_json(self.export_dir / "data" / "rules.json")])
        finally:
            stop()


if __name__ == "__main__":
    unittest.main()
