"""Table insights, step 1: countable stats from a raw transcript (no AI involved).

    python analyze.py <transcript.json> [--id ID] [--gap MINUTES] [--out FILE]

Reads the .json that `ask.py read` writes next to each Markdown transcript
(discord_server/transcripts/) and writes a session file (default: data/sessions/<id>.json),
a numbered reading copy for the AI pass (data/sessions/<id>.reading.md) and a short
summary on screen.

Terms used throughout:
  turn     consecutive messages by one author (dice bots don't break it): people split
           a thought over several messages, so turns are fairer to compare than messages.
  sitting  a stretch of play inside one channel or thread with no pause longer than
           --gap minutes (default 60). Spotlight shares are measured per sitting.
  player   anyone who isn't the GM or a bot (the player map marks "role": "gm" | "bot").

The numbers are prompts for the GM to take a look, never verdicts.
"""

import datetime
import json
import re
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SESSIONS = HERE / "data" / "sessions"  # private: gitignored
TRANSCRIPTS = REPO / "discord_server" / "transcripts"
SCHEMA = 1

SETTINGS = {
    "gap_minutes": 60,          # a longer pause starts a new sitting
    "long_turn_words": 250,     # a single turn this long gets flagged
    "burst_messages": 4,        # a turn of this many messages or more is a burst...
    "burst_words": 200,         # ...when it also has at least this many words
    "dominance_factor": 2.0,    # top player share >= factor x even share
    "min_players_for_balance": 3,
    "min_sitting_turns": 10,    # smaller sittings are too short to judge balance or quietness
    "quiet_max_turns": 1,       # present in a sitting but this many turns or fewer
}

URL_RE = re.compile(r"https?://\S+")
CUSTOM_EMOJI_RE = re.compile(r"<a?:\w+:\d+>")
MENTION_RE = re.compile(r"<[@#][!&]?\d+>")
WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")
OOC_RE = re.compile(r"^\s*(\(\(|\(|//|\[ooc|ooc\b)", re.IGNORECASE)
CHAT_TYPES = {"default", "reply"}


def words(text):
    text = URL_RE.sub(" ", text)
    text = CUSTOM_EMOJI_RE.sub(" ", text)
    text = MENTION_RE.sub(" ", text)
    return len(WORD_RE.findall(text))


def is_ooc(text):
    """Out-of-character chatter: lines in (parentheses), // or marked OOC. A heuristic."""
    stripped = text.strip()
    if not stripped:
        return False
    if OOC_RE.match(stripped):
        return stripped.startswith("((") or stripped.endswith(")") or not stripped.startswith("(")
    return False


def when(iso):
    return datetime.datetime.fromisoformat(iso)


def minutes(a, b):
    return round((b - a).total_seconds() / 60, 1)


def median(values):
    return round(statistics.median(values), 1) if values else None


def percentile(values, share):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(share * (len(ordered) - 1))))]


def role_of(author_id, authors, message):
    entry = authors.get(author_id, {})
    if entry.get("role") in ("gm", "bot"):
        return entry["role"]
    return "bot" if message.get("bot") else "player"


def build_turns(section, authors, names_to_ids):
    """Group a section's messages into turns. Returns (turns, rolls by author id)."""
    turns, rolls = [], {}
    for message in section["messages"]:
        kind = message["type"].split(".")[-1]
        author_id = message["author_id"]
        if role_of(author_id, authors, message) == "bot":
            roller = names_to_ids.get(message.get("invoked_by") or "")
            if roller:
                rolls[roller] = rolls.get(roller, 0) + 1
            continue  # dice and other bots never break a turn
        if kind not in CHAT_TYPES:
            continue
        content = message["content"] or ""
        reactions = sum(r["count"] for r in message.get("reactions") or [])
        entry = {
            "id": message["id"], "time": message["time"], "words": words(content),
            "ooc": is_ooc(content), "edited": bool(message["edited"]), "reactions": reactions,
            "attachments": len(message["attachments"]),
        }
        last = turns[-1] if turns else None
        same_stretch = last and minutes(when(last["end"]), when(message["time"])) <= SETTINGS["gap_minutes"]
        if last and last["author_id"] == author_id and same_stretch:
            last["messages"].append(entry)
            last["end"] = message["time"]
        else:
            turns.append({"author_id": author_id, "start": message["time"], "end": message["time"],
                          "messages": [entry]})
    for turn in turns:
        in_character = [m for m in turn["messages"] if not m["ooc"]]
        turn["words"] = sum(m["words"] for m in in_character)
        turn["ooc_words"] = sum(m["words"] for m in turn["messages"] if m["ooc"])
        turn["ooc"] = not in_character
    return turns, rolls


def split_sittings(turns, gap):
    sittings, current, previous_end = [], [], None
    for turn in turns:
        start = when(turn["start"])
        if current and previous_end and minutes(previous_end, start) > gap:
            sittings.append(current)
            current = []
        current.append(turn)
        previous_end = when(turn["end"])
    if current:
        sittings.append(current)
    return sittings


def summarise_sitting(section_title, turns, authors, flags):
    players = {}
    for turn in turns:
        if turn["ooc"]:
            continue
        stats = players.setdefault(turn["author_id"], {"turns": 0, "words": 0})
        stats["turns"] += 1
        stats["words"] += turn["words"]
    player_ids = [a for a in players if authors.get(a, {}).get("role") not in ("gm", "bot")]
    player_turns = sum(players[a]["turns"] for a in player_ids)
    player_words = sum(players[a]["words"] for a in player_ids)
    for author_id, stats in players.items():
        if author_id in player_ids:
            stats["share_turns"] = round(stats["turns"] / player_turns, 3) if player_turns else 0
            stats["share_words"] = round(stats["words"] / player_words, 3) if player_words else 0
    start, end = when(turns[0]["start"]), when(turns[-1]["end"])
    summary = {
        "section": section_title, "start": turns[0]["start"], "end": turns[-1]["end"],
        "duration_minutes": minutes(start, end), "turns": len(turns),
        "player_count": len(player_ids), "even_share": round(1 / len(player_ids), 3) if player_ids else None,
        "authors": players, "top_player": None, "top_share_words": None, "quiet": [],
    }
    if player_ids:
        top = max(player_ids, key=lambda a: players[a]["share_words"])
        summary["top_player"], summary["top_share_words"] = top, players[top]["share_words"]
    judgeable = len(turns) >= SETTINGS["min_sitting_turns"]
    if judgeable and len(player_ids) >= SETTINGS["min_players_for_balance"]:
        if summary["top_share_words"] >= SETTINGS["dominance_factor"] * summary["even_share"]:
            flags.append({"kind": "spotlight-dominance", "author_id": summary["top_player"],
                          "section": section_title, "at": summary["start"],
                          "detail": f"{round(summary['top_share_words'] * 100)}% of player words "
                                    f"(even share {round(summary['even_share'] * 100)}%)"})
    if judgeable and len(player_ids) >= 2:
        summary["quiet"] = [a for a in player_ids if players[a]["turns"] <= SETTINGS["quiet_max_turns"]]
        for author_id in summary["quiet"]:
            flags.append({"kind": "quiet-player", "author_id": author_id, "section": section_title,
                          "at": summary["start"],
                          "detail": f"{players[author_id]['turns']} turn(s) in a sitting of {len(turns)}"})
    return summary


def author_stats(author_id, turns_by_author, response_times, rolls):
    turns = turns_by_author.get(author_id, [])
    messages = [m for t in turns for m in t["messages"]]
    ic_turns = [t for t in turns if not t["ooc"]]
    turn_words = [t["words"] for t in ic_turns]
    message_words = [m["words"] for m in messages if not m["ooc"]]
    longest = max(ic_turns, key=lambda t: t["words"], default=None)
    return {
        "messages": len(messages),
        "turns": len(turns),
        "ooc_messages": sum(1 for m in messages if m["ooc"]),
        "words": sum(turn_words),
        "ooc_words": sum(t["ooc_words"] for t in turns),
        "words_per_turn": {"median": median(turn_words) or 0,
                           "p90": percentile(turn_words, 0.9), "max": max(turn_words, default=0)},
        "words_per_message": {"median": median(message_words) or 0, "max": max(message_words, default=0)},
        "messages_per_turn": {"mean": round(len(messages) / len(turns), 2) if turns else 0,
                              "max": max((len(t["messages"]) for t in turns), default=0)},
        "longest_turn": {"start_id": longest["messages"][0]["id"], "words": longest["words"]} if longest else None,
        "response_minutes": {"median": median(response_times),
                             "count": len(response_times)},
        "edited": sum(1 for m in messages if m["edited"]),
        "attachments": sum(m["attachments"] for m in messages),
        "rolls": rolls.get(author_id, 0),
        "reactions_received": sum(m["reactions"] for m in messages),
    }


def transcript_ref(path):
    """Where the raw transcript lives, relative to the repo when it's inside it."""
    path = path.resolve()
    try:
        return path.relative_to(REPO).as_posix()
    except ValueError:
        return str(path)


def transcript_path(session):
    """The raw transcript a session was made from (older files only stored the name)."""
    ref = session["source"].get("transcript_path")
    if ref:
        path = Path(ref)
        return path if path.is_absolute() else REPO / path
    return TRANSCRIPTS / session["source"]["transcript"]


def analyse(raw, session_id, source_path):
    authors = raw["authors"]
    names_to_ids = {}
    for author_id, entry in authors.items():
        for name in (entry.get("name"), entry.get("player"), entry.get("character")):
            if name:
                names_to_ids.setdefault(name, author_id)

    flags, sittings, sections, turns_by_author, responses, rolls = [], [], [], {}, {}, {}
    for section in raw["sections"]:
        turns, section_rolls = build_turns(section, authors, names_to_ids)
        for author_id, count in section_rolls.items():
            rolls[author_id] = rolls.get(author_id, 0) + count
        section_sittings = split_sittings(turns, SETTINGS["gap_minutes"])
        for group in section_sittings:
            for previous, turn in zip(group, group[1:]):
                responses.setdefault(turn["author_id"], []).append(
                    minutes(when(previous["end"]), when(turn["start"])))
            sittings.append(summarise_sitting(section["title"], group, authors, flags))
        for turn in turns:
            turns_by_author.setdefault(turn["author_id"], []).append(turn)
            role = authors.get(turn["author_id"], {}).get("role", "player")
            if role == "player" and not turn["ooc"]:
                if turn["words"] >= SETTINGS["long_turn_words"]:
                    flags.append({"kind": "long-turn", "author_id": turn["author_id"], "section": section["title"],
                                  "at": turn["start"], "message_id": turn["messages"][0]["id"],
                                  "detail": f"{turn['words']} words in {len(turn['messages'])} message(s)"})
                elif len(turn["messages"]) >= SETTINGS["burst_messages"] and turn["words"] >= SETTINGS["burst_words"]:
                    flags.append({"kind": "burst", "author_id": turn["author_id"], "section": section["title"],
                                  "at": turn["start"], "message_id": turn["messages"][0]["id"],
                                  "detail": f"{len(turn['messages'])} messages in a row, {turn['words']} words"})
        sections.append({"title": section["title"], "truncated": section["truncated"],
                         "messages": len(section["messages"]), "turns": len(turns),
                         "sittings": len(section_sittings)})

    people = {}
    for author_id, entry in authors.items():
        role = entry.get("role", "player")
        if role == "bot":
            continue
        people[author_id] = {"name": entry.get("name"), "player": entry.get("player"),
                             "character": entry.get("character"), "role": role, "note": entry.get("note", ""),
                             **author_stats(author_id, turns_by_author, responses.get(author_id, []), rolls)}
    player_ids = [a for a, p in people.items() if p["role"] == "player"]
    total_words = sum(people[a]["words"] for a in player_ids)
    total_turns = sum(people[a]["turns"] for a in player_ids)
    for author_id in player_ids:
        people[author_id]["share_words"] = round(people[author_id]["words"] / total_words, 3) if total_words else 0
        people[author_id]["share_turns"] = round(people[author_id]["turns"] / total_turns, 3) if total_turns else 0
        people[author_id]["sittings_present"] = sum(1 for s in sittings if author_id in s["authors"])

    return {
        "schema": SCHEMA,
        "id": session_id,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": {"transcript": source_path.name, "transcript_path": transcript_ref(source_path),
                   "channel": raw["channel"], "read_at": raw["read_at"],
                   "from": raw["from"], "to": raw["to"], "message_count": raw["message_count"]},
        "settings": SETTINGS,
        "people": people,
        "sections": sections,
        "sittings": sittings,
        "flags": flags,
        # Filled in by the AI reading step (step 2), each confirmed or rejected by the GM:
        "moments": [],
        "humor_candidates": [],
        "review": {"status": "stats-only", "reviewed_by": None, "reviewed_at": None, "notes": ""},
    }


def numbered_messages(raw):
    """Every message a person wrote or a bot answered with, numbered from 1 in transcript order.
    The reading copy and moments.py both use this numbering, so it must stay stable."""
    numbered = []
    for section in raw["sections"]:
        for message in section["messages"]:
            kind = message["type"].split(".")[-1]
            if kind in CHAT_TYPES or (message.get("bot") and kind == "chat_input_command"):
                numbered.append((len(numbered) + 1, section["title"], message))
    return numbered


def reading_copy(raw, session_id):
    """The transcript as the AI reading pass sees it: #n before each message, mapped names."""
    authors = raw["authors"]

    def name(message):
        entry = authors.get(message["author_id"], {})
        return entry.get("character") or entry.get("name") or message["author"]

    lines = [f"# Reading copy · {session_id}", "",
             "Numbers (#n) are what moments.py drafts refer to. Times are UTC.", ""]
    current, by_id = None, {}
    for number, section, message in numbered_messages(raw):
        by_id[message["id"]] = number
        if section != current:
            lines += [f"## {section}", ""]
            current = section
        head = f"#{number} [{message['time'][:16].replace('T', ' ')}] {name(message)}"
        if message.get("invoked_by"):
            head += f" · for {message['invoked_by']}"
        if message.get("reply_to") in by_id:
            head += f" · ↪ #{by_id[message['reply_to']]}"
        reactions = message.get("reactions") or []
        if reactions:
            head += " · " + " ".join(f"{r['emoji']}{r['count']}" for r in reactions)
        body = message["content"] or ""
        if message["embeds"]:
            body = (body + "\n" if body else "") + " / ".join(message["embeds"])
        if message["attachments"]:
            body = (body + "\n" if body else "") + f"[{len(message['attachments'])} attachment(s)]"
        lines += [head, body, ""]
    return "\n".join(lines)


def label(people, author_id):
    person = people.get(author_id, {})
    return person.get("character") or person.get("name") or author_id


def print_summary(session, out):
    people = session["people"]
    print(f"{session['id']}: {session['source']['message_count']} messages, "
          f"{len(session['sittings'])} sittings in {len(session['sections'])} channel/threads → {out}")
    print()
    print(f"{'Who':28} {'turns':>5} {'words':>6} {'share':>6} {'med/turn':>8} {'p90':>5} {'max':>5} {'reply min':>9} {'rolls':>5}")
    order = sorted(people, key=lambda a: (people[a]["role"] != "gm", -people[a]["words"]))
    for author_id in order:
        p = people[author_id]
        share = f"{round(p['share_words'] * 100)}%" if "share_words" in p else "GM"
        reply = p["response_minutes"]["median"]
        print(f"{label(people, author_id)[:28]:28} {p['turns']:>5} {p['words']:>6} {share:>6} "
              f"{p['words_per_turn']['median']:>8} {p['words_per_turn']['p90']:>5} {p['words_per_turn']['max']:>5} "
              f"{reply if reply is not None else '-':>9} {p['rolls']:>5}")
    if session["flags"]:
        print()
        print("Worth a look:")
        for flag in session["flags"]:
            print(f"  [{flag['kind']}] {label(people, flag['author_id'])} · {flag['section']} · "
                  f"{flag['at'][:16].replace('T', ' ')} UTC · {flag['detail']}")


def main(argv):
    args = list(argv)
    options = {}
    for name in ("--id", "--gap", "--out"):
        if name in args:
            index = args.index(name)
            if index + 1 >= len(args):
                sys.exit(f"{name} needs a value")
            options[name] = args[index + 1]
            del args[index:index + 2]
    if len(args) != 1:
        sys.exit(__doc__)
    source = Path(args[0])
    if source.suffix != ".json":
        sys.exit("Give the .json that ask.py read writes next to the Markdown transcript.")
    raw = json.loads(source.read_text(encoding="utf-8"))
    if "--gap" in options:
        SETTINGS["gap_minutes"] = float(options["--gap"])
    session_id = options.get("--id") or source.stem
    session = analyse(raw, session_id, source)
    out = Path(options["--out"]) if "--out" in options else SESSIONS / f"{session_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        previous = json.loads(out.read_text(encoding="utf-8"))
        # Re-running the stats must never throw away the AI step's work or the GM's review.
        for key in ("moments", "humor_candidates", "review"):
            if previous.get(key):
                session[key] = previous[key]
    out.write_text(json.dumps(session, indent=1, ensure_ascii=False), encoding="utf-8")
    out.with_suffix(".reading.md").write_text(reading_copy(raw, session_id), encoding="utf-8")
    print_summary(session, out)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
