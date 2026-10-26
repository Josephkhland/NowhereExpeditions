"""Table insights, step 2: moments and humor candidates, proposed by the AI, decided by the GM.

    python moments.py import <session-id> <draft.json>   add the AI's proposals (replaces earlier proposals)
    python moments.py list <session-id>                  show everything with its status
    python moments.py review <session-id> <item> confirm|reject|reset ["note"]
    python moments.py feature <session-id> <h-id> ok|no  a featured player's poll opt-in / opt-out
    python moments.py poll <session-id>[,<session-id>...] [--hours 72] [--out FILE]
                                                         draft a funny-moments poll for Vaulty

poll only takes humor candidates the GM confirmed AND marked "everyone agreed" (feature ok),
ranked across the sessions given, at most 10. The draft goes to discord_server/embeds/
(private) by default; edit it freely, preview it with `ask.py funny-poll <channel> <file>
--preview` and post it (after the GM's approval) with `ask.py funny-poll <channel> <file>`.

The draft refers to messages by their #n in sessions/<id>.reading.md:

    {"moments": [{"who": "Saya", "kind": "story-choice", "messages": [212, 213],
                  "summary": "...", "why": "...", "quote": "exact words", "helped": ["Ewa Cyanea"]}],
     "humor":   [{"messages": [55, 56], "setup": "...", "quote": "exact words", "rank": 1}]}

`who` / `helped` take a character, player or Discord name from the player map. Every
quote must appear word for word in one of the listed messages (spacing and case aside),
so nothing invented reaches the GM's review or a poll. The script adds message ids,
times, the scene and, for humor, the laughter signals: reactions on the messages and
laughing replies from other people in the next few messages.

Decisions (confirm / reject, GM notes) are kept when proposals are re-imported for the
same messages, and are the labelled examples a future model could learn from.
"""

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # also under python -I
import analyze  # noqa: E402

MOMENT_KINDS = ("story-choice", "discovery", "assist", "character", "mechanics")
# Out-of-character ("lol") and in-character ("*laughs*", "Pffff", "*snickers*") laughter.
LAUGH_RE = re.compile(r"\b(lol+|lmf?ao+|rofl|a?ha(ha)+h?|he(he)+|pf{2,}t*|kek|xd+|laugh\w*|chuckl\w*|snicker\w*|"
                      r"giggl\w*|cackl\w*)\b|😂|🤣|💀|😆|😹", re.IGNORECASE)
LAUGH_WINDOW = 4  # messages after the joke that count as reactions to it


def squash(text):
    return re.sub(r"\s+", " ", text).strip().lower()


class ReviewError(ValueError):
    """A bad review request (unknown item, verdict or answer)."""


def load(session_id):
    path = analyze.SESSIONS / f"{session_id}.json"
    if not path.exists():
        sys.exit(f"No session file {path}. Run analyze.py first.")
    session = json.loads(path.read_text(encoding="utf-8"))
    raw = json.loads(analyze.transcript_path(session).read_text(encoding="utf-8"))
    return path, session, raw


def save(path, session):
    path.write_text(json.dumps(session, indent=1, ensure_ascii=False), encoding="utf-8")


def resolver(raw):
    names = {}
    for author_id, entry in raw["authors"].items():
        for key in ("character", "player", "name"):
            if entry.get(key):
                names[squash(entry[key])] = author_id
        names[author_id] = author_id
    return lambda who: names.get(squash(who)) or sys.exit(f"Unknown person in the draft: {who!r}")


def resolve_messages(numbers, by_number, label):
    if not numbers:
        sys.exit(f"{label}: needs at least one message number")
    missing = [n for n in numbers if n not in by_number]
    if missing:
        sys.exit(f"{label}: no message #{', #'.join(map(str, missing))} in the reading copy")
    return [by_number[n] for n in sorted(numbers)]


def check_quote(quote, picked, label):
    if not quote:
        return
    if not any(squash(quote) in squash(message["content"] or "") for _, _, message in picked):
        sys.exit(f"{label}: quote not found word for word in its messages: {quote!r}")


def laughter(numbered, picked, quote):
    """Reactions on the joke, and laughing replies from others: inside the picked messages after the
    punchline, and in the next few messages after them."""
    punch_number, section, punchline = next(
        (p for p in picked if quote and squash(quote) in squash(p[2]["content"] or "")), picked[-1])
    last = max(number for number, _, _ in picked)
    replies = []
    for number, sec, message in numbered[punch_number:last + LAUGH_WINDOW]:  # numbers start at 1
        if sec != section or message["author_id"] == punchline["author_id"] or message.get("bot"):
            continue
        if LAUGH_RE.search(message["content"] or ""):
            replies.append({"n": number, "author_id": message["author_id"]})
    reactions = {}
    for _, _, message in picked:
        for reaction in message.get("reactions") or []:
            reactions[reaction["emoji"]] = reactions.get(reaction["emoji"], 0) + reaction["count"]
    return {"reactions": reactions, "laughing_replies": replies}


def base_item(item_id, picked, label):
    return {
        "id": item_id,
        "section": picked[0][1],
        "message_numbers": [number for number, _, _ in picked],
        "message_ids": [message["id"] for _, _, message in picked],
        "at": picked[0][2]["time"],
        "status": "proposed",
        "gm_note": "",
        "decided_at": None,
    }


def keep_decisions(new_items, old_items):
    """Carry the GM's decision over to a re-proposed item about the same messages."""
    decided = {tuple(i["message_ids"]): i for i in old_items if i.get("status") != "proposed"}
    for item in new_items:
        old = decided.get(tuple(item["message_ids"]))
        if old:
            for key in ("status", "gm_note", "decided_at", "feature_ok"):
                if key in old:
                    item[key] = old[key]
    kept_ids = {tuple(i["message_ids"]) for i in new_items}
    # Decided items the new draft dropped stay, so no decision is ever lost.
    return new_items + [i for key, i in decided.items() if key not in kept_ids]


def command_import(session_id, draft_path):
    path, session, raw = load(session_id)
    draft = json.loads(Path(draft_path).read_text(encoding="utf-8"))
    numbered = analyze.numbered_messages(raw)
    by_number = {number: (number, section, message) for number, section, message in numbered}
    who = resolver(raw)

    moments = []
    for index, entry in enumerate(draft.get("moments", []), 1):
        label = f"moment {index}"
        if entry.get("kind") not in MOMENT_KINDS:
            sys.exit(f"{label}: kind must be one of {', '.join(MOMENT_KINDS)}")
        picked = resolve_messages(entry.get("messages"), by_number, label)
        check_quote(entry.get("quote"), picked, label)
        author_id = who(entry["who"])
        if author_id not in {message["author_id"] for _, _, message in picked}:
            sys.exit(f"{label}: {entry['who']} didn't write any of its messages")
        moments.append({**base_item(f"m{index}", picked, label), "author_id": author_id, "kind": entry["kind"],
                        "summary": entry.get("summary", ""), "why": entry.get("why", ""),
                        "quote": entry.get("quote", ""),
                        "helped": [who(name) for name in entry.get("helped", [])]})

    humor = []
    for index, entry in enumerate(draft.get("humor", []), 1):
        label = f"humor {index}"
        picked = resolve_messages(entry.get("messages"), by_number, label)
        check_quote(entry.get("quote"), picked, label)
        humor.append({**base_item(f"h{index}", picked, label),
                      "authors": sorted({message["author_id"] for _, _, message in picked
                                         if not message.get("bot")}),
                      "setup": entry.get("setup", ""), "quote": entry.get("quote", ""),
                      "rank": entry.get("rank"), "signals": laughter(numbered, picked, entry.get("quote")),
                      "feature_ok": None})

    session["moments"] = keep_decisions(moments, session.get("moments", []))
    session["humor_candidates"] = keep_decisions(humor, session.get("humor_candidates", []))
    if session["review"]["status"] == "stats-only":
        session["review"]["status"] = "ai-draft"
    save(path, session)
    print(f"{len(moments)} moments, {len(humor)} humor candidates → {path}")


def name_of(session, author_id):
    person = session["people"].get(author_id, {})
    return person.get("character") or person.get("name") or author_id


def command_list(session_id):
    _, session, _ = load(session_id)
    print(f"{session_id} · review: {session['review']['status']}")
    by_person = {}
    for m in session["moments"]:
        by_person.setdefault(m["author_id"], []).append(m)
    print("\nMoments")
    for author_id, person in session["people"].items():
        if person["role"] != "player":
            continue
        items = by_person.get(author_id, [])
        kinds = ", ".join(sorted({m["kind"] for m in items})) or "none yet"
        print(f"  {name_of(session, author_id)}: {len(items)} ({kinds})")
        for m in items:
            helped = f" → helped {', '.join(name_of(session, a) for a in m['helped'])}" if m["helped"] else ""
            print(f"    {m['id']} [{m['status']}] {m['kind']} #{m['message_numbers'][0]} · {m['summary']}{helped}")
    print("\nHumor candidates")
    for h in sorted(session["humor_candidates"], key=lambda h: h.get("rank") or 99):
        s = h["signals"]
        signal = f"{sum(s['reactions'].values())} reactions, {len(s['laughing_replies'])} laughing replies"
        who = ", ".join(name_of(session, a) for a in h["authors"])
        print(f"  {h['id']} [{h['status']}] rank {h.get('rank')} · {who} · #{h['message_numbers'][0]} · {signal}")
        print(f"      {h['setup']}")
        if h["quote"]:
            print(f"      “{h['quote']}”")


VERDICTS = {"confirm": "confirmed", "reject": "rejected", "reset": "proposed"}


def find(session, item_id):
    for item in session["moments"] + session["humor_candidates"]:
        if item["id"] == item_id:
            return item
    raise ReviewError(f"No item {item_id}")


def decide(session, item_id, verdict, note=None):
    """The GM's decision on one proposal. note=None keeps the current note (a reset clears it)."""
    item = find(session, item_id)
    if verdict not in VERDICTS:
        raise ReviewError("Verdict: confirm, reject or reset")
    item["status"] = VERDICTS[verdict]
    if verdict == "reset":
        item["gm_note"] = note or ""
    elif note is not None:
        item["gm_note"] = note
    item["decided_at"] = None if verdict == "reset" else datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    open_items = [i for i in session["moments"] + session["humor_candidates"] if i["status"] == "proposed"]
    session["review"]["status"] = "ai-draft" if open_items else "reviewed"
    session["review"]["reviewed_at"] = None if open_items else item["decided_at"]
    return item


def set_feature(session, item_id, allowed):
    """Whether the people in a humor candidate agreed to it being featured: True, False or None (not asked)."""
    item = find(session, item_id)
    if not item_id.startswith("h") or allowed not in (True, False, None):
        raise ReviewError("Only humor candidates take a feature answer: true, false or null")
    item["feature_ok"] = allowed
    return item


def command_review(session_id, item_id, verdict, note=None):
    path, session, _ = load(session_id)
    try:
        item = decide(session, item_id, verdict, note)
    except ReviewError as error:
        sys.exit(str(error))
    save(path, session)
    print(f"{item_id}: {item['status']}")


def command_feature(session_id, item_id, answer):
    path, session, _ = load(session_id)
    if answer not in ("ok", "no"):
        sys.exit("Usage: feature <session-id> <h-id> ok|no")
    try:
        item = set_feature(session, item_id, answer == "ok")
    except ReviewError as error:
        sys.exit(str(error))
    save(path, session)
    print(f"{item_id}: feature {'allowed' if item['feature_ok'] else 'declined'}")


POLL_MAX = 10  # Discord polls take at most 10 answers
ANSWER_MAX = 55  # characters per poll answer
NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
POLL_DRAFTS = analyze.REPO / "discord_server" / "embeds"


def shorten(text, limit):
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def poll_entries(sessions):
    """Confirmed, consented humor candidates across sessions, best ranked first."""
    entries = []
    for session in sessions:
        for item in session.get("humor_candidates", []):
            if item["status"] == "confirmed" and item.get("feature_ok") is True:
                entries.append((item.get("rank") or 99, session["source"].get("read_at", ""), session, item))
    entries.sort(key=lambda e: (e[0], e[1]))
    return entries[:POLL_MAX]


def build_poll(sessions, hours=72):
    """The draft Vaulty posts: an embed with the moments, then a native poll to vote on them."""
    entries = poll_entries(sessions)
    if len(entries) < 2:
        waiting = sum(1 for s in sessions for h in s.get("humor_candidates", [])
                      if h["status"] == "confirmed" and h.get("feature_ok") is not True)
        raise ReviewError(f"A poll needs at least 2 funny moments that are confirmed and that everyone agreed to "
                          f"feature; found {len(entries)}. {waiting} confirmed moment(s) still wait for consent.")
    fields, answers, sources = [], [], []
    for index, (_, _, session, item) in enumerate(entries):
        people = [name_of(session, a) for a in item["authors"]
                  if session["people"].get(a, {}).get("role") != "gm"] or [name_of(session, a) for a in item["authors"]]
        names = people[0] if len(people) == 1 else ", ".join(people[:-1]) + " & " + people[-1]
        quote = f"\n> “{shorten(item['quote'], 300)}”" if item["quote"] else ""
        fields.append({"name": f"{NUMBER_EMOJI[index]} {shorten(names, 200)}",
                       "value": shorten(item["setup"], 600) + quote, "inline": False})
        label = item["quote"] or item["setup"]
        answers.append({"emoji": NUMBER_EMOJI[index], "text": shorten(label, ANSWER_MAX)})
        sources.append({"session": session["id"], "item": item["id"], "message_ids": item["message_ids"]})
    channels = sorted({f"#{s['source']['channel']}" for s in sessions})
    return {
        "kind": "funny-moments-poll",
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "embed": {
            "title": "😂 Funniest moment: vote!",
            "description": f"The best laughs from {', '.join(channels)}. Read them here, then vote in the poll below.",
            "color": "#eda100",
            "fields": fields,
            "footer": "Featured with the players' OK. One vote each.",
        },
        "question": "Which moment was the funniest?",
        "answers": answers,
        "duration_hours": hours,
        "multiple": False,
        "sources": sources,
    }


def command_poll(session_ids, options):
    sessions = []
    for session_id in session_ids.split(","):
        path = analyze.SESSIONS / f"{session_id.strip()}.json"
        if not path.exists():
            sys.exit(f"No session file {path}.")
        sessions.append(json.loads(path.read_text(encoding="utf-8")))
    hours = int(options.get("--hours", 72))
    if not 1 <= hours <= 768:
        sys.exit("--hours must be between 1 and 768 (32 days), Discord's limits")
    try:
        poll = build_poll(sessions, hours)
    except ReviewError as error:
        sys.exit(str(error))
    out = Path(options["--out"]) if "--out" in options else \
        POLL_DRAFTS / f"funny-poll-{datetime.date.today():%Y%m%d}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(poll, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(poll['answers'])} moments → {out}")
    for answer in poll["answers"]:
        print(f"  {answer['emoji']} {answer['text']}")
    print("Preview with: python discord_server\\bot\\ask.py funny-poll <channel> <file> --preview")


def main(argv):
    if argv and argv[0] == "poll":
        args, options = list(argv[1:]), {}
        for name in ("--hours", "--out"):
            if name in args:
                index = args.index(name)
                options[name] = args[index + 1] if index + 1 < len(args) else sys.exit(f"{name} needs a value")
                del args[index:index + 2]
        if len(args) != 1:
            sys.exit(__doc__)
        command_poll(args[0], options)
    elif len(argv) >= 3 and argv[0] == "import":
        command_import(argv[1], argv[2])
    elif len(argv) == 2 and argv[0] == "list":
        command_list(argv[1])
    elif len(argv) in (4, 5) and argv[0] == "review":
        command_review(*argv[1:])
    elif len(argv) == 4 and argv[0] == "feature":
        command_feature(*argv[1:])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
