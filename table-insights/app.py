"""Table insights: a local-only dashboard for the GM.

    python app.py [--port 8002]

Shows the session files written by analyze.py and moments.py (data/sessions/), with
charts of spotlight share and the review queue for moments and funny-moment candidates.
Standard library only. Binds to 127.0.0.1: the data is about real players and never
leaves this computer.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))  # also under python -I
import analyze  # noqa: E402
import moments  # noqa: E402

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
SESSION_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")
ITEM_ID_RE = re.compile(r"^[mh]\d{1,4}$")
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon"}
WRITE_LOCK = threading.Lock()
# Demo data (demo/, invented players; rebuilt by demo/make_demo.py) is safe to show. Clicks in demo mode
# change an in-memory copy only, so the demo looks the same after every restart.
DEMO_SESSIONS = HERE / "demo" / "sessions"
DEMO_CACHE: dict[str, dict] = {}


class NotFound(Exception):
    pass


def sessions_dir(source: str) -> Path:
    return DEMO_SESSIONS if source == "demo" else analyze.SESSIONS


def session_path(session_id: str, source: str = "real") -> Path:
    if not SESSION_ID_RE.match(session_id):
        raise NotFound("No such session.")
    path = sessions_dir(source) / f"{session_id}.json"
    if not path.exists():
        raise NotFound("No such session.")
    return path


def read_session(session_id: str, source: str = "real") -> dict:
    if source == "demo" and session_id in DEMO_CACHE:
        return DEMO_CACHE[session_id]
    session = json.loads(session_path(session_id, source).read_text(encoding="utf-8"))
    if source == "demo":
        DEMO_CACHE[session_id] = session
    return session


def all_sessions(source: str = "real") -> list[dict]:
    folder = sessions_dir(source)
    if not folder.exists():
        return []
    sessions = []
    for path in sorted(folder.glob("*.json")):
        try:
            sessions.append(read_session(path.stem, source))
        except (OSError, ValueError, NotFound):
            continue
    return sessions


def first_play(session: dict) -> str:
    played = [s["start"] for s in session["sittings"] if s["player_count"]]
    return min(played) if played else (session["sittings"][0]["start"] if session["sittings"] else "")


def last_play(session: dict) -> str:
    return max((s["end"] for s in session["sittings"]), default="")


def summary(session: dict) -> dict:
    items = session.get("moments", []) + session.get("humor_candidates", [])
    return {
        "id": session["id"],
        "channel": session["source"]["channel"],
        "messages": session["source"]["message_count"],
        "players": sum(1 for p in session["people"].values() if p["role"] == "player"),
        "sittings": len(session["sittings"]),
        "start": first_play(session),
        "end": last_play(session),
        "review": session["review"]["status"],
        "proposed": sum(1 for i in items if i["status"] == "proposed"),
        "flags": len(session["flags"]),
    }


def players_overview(source: str = "real") -> list[dict]:
    """Each player across every session: presence, shares, moments by kind (confirmed and proposed)."""
    players: dict[str, dict] = {}
    for session in sorted(all_sessions(source), key=first_play):
        for author_id, person in session["people"].items():
            if person["role"] != "player":
                continue
            entry = players.setdefault(author_id, {
                "author_id": author_id, "player": person.get("player"), "names": [],
                "sessions": [], "kinds": {}, "kinds_proposed": {}, "assists_given": 0, "humor": 0})
            character = person.get("character") or person.get("name")
            if character and character not in entry["names"]:
                entry["names"].append(character)
            shares = [s["authors"][author_id]["share_words"] for s in session["sittings"]
                      if author_id in s["authors"] and s["player_count"] >= 2 and s["turns"] >= analyze.SETTINGS["min_sitting_turns"]]
            entry["sessions"].append({
                "id": session["id"], "start": first_play(session), "end": last_play(session), "words": person["words"],
                "turns": person["turns"], "share_words": person.get("share_words", 0),
                "sitting_share": round(sum(shares) / len(shares), 3) if shares else None,
                "even_share": round(sum(1 / s["player_count"] for s in session["sittings"]
                                        if author_id in s["authors"] and s["player_count"] >= 2
                                        and s["turns"] >= analyze.SETTINGS["min_sitting_turns"]) / len(shares), 3) if shares else None,
            })
            for moment in session.get("moments", []):
                if moment["author_id"] != author_id or moment["status"] == "rejected":
                    continue
                bucket = entry["kinds"] if moment["status"] == "confirmed" else entry["kinds_proposed"]
                bucket[moment["kind"]] = bucket.get(moment["kind"], 0) + 1
                if moment["kind"] == "assist":
                    entry["assists_given"] += 1
            entry["humor"] += sum(1 for h in session.get("humor_candidates", [])
                                  if author_id in h["authors"] and h["status"] != "rejected")
    return sorted(players.values(), key=lambda p: (p["names"] or [p["player"] or ""])[0].lower())


def context(session_id: str, number: int, radius: int, source: str = "real") -> dict:
    session = read_session(session_id, source)
    raw = json.loads(analyze.transcript_path(session).read_text(encoding="utf-8"))
    numbered = analyze.numbered_messages(raw)
    authors = raw["authors"]
    lo, hi = max(1, number - radius), min(len(numbered), number + radius)
    messages = []
    for n, section, message in numbered[lo - 1:hi]:
        entry = authors.get(message["author_id"], {})
        messages.append({"n": n, "section": section, "time": message["time"], "author_id": message["author_id"],
                         "name": entry.get("character") or entry.get("name") or message["author"],
                         "content": message["content"] or ("[attachment]" if message["attachments"] else ""),
                         "reactions": message.get("reactions") or []})
    return {"focus": number, "messages": messages}


def write_item(session_id: str, item_id: str, body: dict, source: str = "real") -> dict:
    if not ITEM_ID_RE.match(item_id):
        raise NotFound("No such item.")
    with WRITE_LOCK:
        path = session_path(session_id, source)
        session = read_session(session_id, "demo") if source == "demo" else json.loads(path.read_text(encoding="utf-8"))
        note = body.get("note")
        if note is not None and (not isinstance(note, str) or len(note) > 2000):
            raise moments.ReviewError("A note is text, at most 2000 characters.")
        if "verdict" in body:
            moments.decide(session, item_id, body["verdict"], note)
        elif note is not None:
            moments.find(session, item_id)["gm_note"] = note
        if "feature_ok" in body:
            moments.set_feature(session, item_id, body["feature_ok"])
        if source != "demo":
            moments.save(path, session)
    return session


def create_handler():
    class Handler(BaseHTTPRequestHandler):
        server_version = "TableInsights"

        def log_message(self, fmt, *args):  # keep the terminal quiet
            pass

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, data) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 100_000:
                raise moments.ReviewError("Request too large.")
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise moments.ReviewError("Send a JSON object.")
            return data

        def _same_origin(self) -> bool:
            # Writes only from the dashboard itself, not from other pages open in the browser.
            origin = self.headers.get("Origin")
            host = self.headers.get("Host", "")
            return origin is None or origin == f"http://{host}"

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            parts = [p for p in url.path.split("/") if p]
            query = parse_qs(url.query)
            source = "demo" if query.get("source", [""])[0] == "demo" else "real"
            try:
                if parts[:2] == ["api", "sessions"] and len(parts) == 2:
                    sessions = sorted((summary(s) for s in all_sessions(source)), key=lambda s: s["start"], reverse=True)
                    return self._json(200, sessions)
                if parts[:2] == ["api", "sessions"] and len(parts) == 3:
                    return self._json(200, read_session(parts[2], source))
                if parts[:2] == ["api", "sessions"] and len(parts) == 4 and parts[3] == "context":
                    number = int(query.get("n", ["1"])[0])
                    radius = min(12, max(1, int(query.get("radius", ["4"])[0])))
                    return self._json(200, context(parts[2], number, radius, source))
                if parts == ["api", "players"]:
                    return self._json(200, players_overview(source))
                if parts and parts[0] == "api":
                    return self._json(404, {"error": "Not found."})
                name = "index.html" if not parts else "/".join(parts)
                target = (STATIC / name).resolve()
                if STATIC.resolve() not in target.parents or not target.is_file():
                    return self._send(404, b"Not found", "text/plain; charset=utf-8")
                return self._send(200, target.read_bytes(), CONTENT_TYPES.get(target.suffix, "application/octet-stream"))
            except NotFound as error:
                return self._json(404, {"error": str(error)})
            except (ValueError, OSError) as error:
                return self._json(400, {"error": str(error)})

        def do_POST(self) -> None:
            url = urlsplit(self.path)
            parts = [p for p in url.path.split("/") if p]
            source = "demo" if parse_qs(url.query).get("source", [""])[0] == "demo" else "real"
            if not self._same_origin():
                return self._json(403, {"error": "Writes are only accepted from the dashboard."})
            try:
                if parts[:2] == ["api", "sessions"] and len(parts) == 5 and parts[3] == "items":
                    session = write_item(parts[2], parts[4], self._body(), source)
                    return self._json(200, session)
                return self._json(404, {"error": "Not found."})
            except NotFound as error:
                return self._json(404, {"error": str(error)})
            except (moments.ReviewError, ValueError) as error:
                return self._json(400, {"error": str(error)})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Table insights dashboard (local only)")
    parser.add_argument("--port", type=int, default=8002)
    parser.add_argument("--open", action="store_true", help="open the dashboard in the browser")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), create_handler())
    url = f"http://127.0.0.1:{args.port}"
    print(f"Table insights ready at {url}")
    print(f"Sessions: {analyze.SESSIONS}")
    print("Press Ctrl+C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping table insights.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
