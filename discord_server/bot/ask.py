"""Talk to the running bot through its local API.

Never touches the token: the bot must already be running in the GM's terminal.

    python ask.py status
    python ask.py guilds
    python ask.py channels [server_id]   (server id optional if the bot is in one server)
    python ask.py roles [server_id]
    python ask.py threads <channel>
    python ask.py read <channel|thread> [--from TIME] [--to TIME] [--threads] [--map FILE] [--out FILE]
    python ask.py embed <channel> <file.json> [--no-ping] [--welcome-channel NAME]
    python ask.py delete <channel> <message id>      (Vaulty's own messages only)
    python ask.py tarot <channel> "<question>" [--text "..."] [--cards 0,16,17] [--face-up]
    python ask.py tarot-status <reading id>
    python ask.py tarot-reveal <reading id>
    python ask.py action <create-role|post-terms|apply-structure> <file.json> [--channel NAME]
    python ask.py consent
    python ask.py funny-poll <channel> <draft.json> [--preview]

funny-poll posts a funny-moments poll drafted by table-insights/moments.py poll (only
moments the GM confirmed and everyone in them agreed to feature): an embed with the
moments, then a native Discord poll. Needs the GM's approval like every write.
--preview checks the draft and shows what would be posted, without contacting the bot.

action sends the JSON file to that write action (always approved by the GM first);
--channel overrides the file's "channel" (e.g. to test terms in bot-debug).
consent lists who accepted the terms, and which version.

tarot deals three face-down Major Arcana (random unless --cards is given) with buttons
I, II, III. Pressing one flips that card privately for the player and records their
choice in secret. tarot-status shows the GM who chose what; tarot-reveal turns the
cards face up for everyone with the counts (both deal and reveal need GM approval).

Add --json to channels or roles for the full data (topics, who can see each channel).

read writes a Markdown transcript (default: discord_server/transcripts/) and, next to it,
a .json file with the same name holding the raw messages (exact UTC times, ids, author
ids, replies, reaction counts) for analysis. TIME is an
ISO date or date-time ("2026-10-01" or "2026-10-01T18:00"); without an offset it is
this computer's local time. --threads also reads the channel's threads (always on
for a forum: each post is a thread). Authors are matched to characters through
discord_server/player-map.json (Nowhere Expeditions) when it exists, or the file
given with --map (other games, e.g. discord_server/player-maps/school-of-fish.json):

    {"users": {"<discord user id>": {"player": "Name", "character": "Character name",
                                     "characterId": "site-character-id"}}}

embed posts the embed described in the JSON file ({"content": ..., "embed": {...}},
see build_embed in the bot for the keys). Optional in the file: "ping": ["@everyone"
or role names] (shown as a warning in the approval), and "role_button": {"role", "join",
"leave", "join_message", "leave_message"} for Join / Leave buttons. --no-ping drops the
pings, for test posts. It waits until the GM approves or rejects
it in the bot's terminal.
"""

import datetime
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8765"
DISCORD_DIR = Path(__file__).resolve().parent.parent
PLAYER_MAP = DISCORD_DIR / "player-map.json"
TRANSCRIPTS = DISCORD_DIR / "transcripts"
NOT_RUNNING = "The bot isn't running (nothing on 127.0.0.1:8765). Start it in your own terminal."


def get(path, timeout=10):
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(f"Bot answered {error.code}: {error.read().decode('utf-8', 'replace')}")


def post(path, payload):
    """POST JSON and return (http_status, body). Waits up to 10 minutes for the GM's answer."""
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.load(error)
        except ValueError:
            return error.code, {"status": "error", "error": error.reason}


def pick_guild(args):
    if args:
        return args[0]
    guilds = get("/guilds")
    if len(guilds) != 1:
        names = "; ".join(f"{g['name']} ({g['id']})" for g in guilds) or "none"
        sys.exit(f"Give a server id. The bot is in: {names}")
    return guilds[0]["id"]


def take_option(args, name, has_value=True):
    """Remove --name [value] from args and return the value (or True/None)."""
    if name not in args:
        return None
    index = args.index(name)
    if not has_value:
        del args[index]
        return True
    if index + 1 >= len(args):
        sys.exit(f"{name} needs a value")
    value = args[index + 1]
    del args[index:index + 2]
    return value


def to_utc_iso(value):
    if not value:
        return None
    moment = datetime.datetime.fromisoformat(value)
    if moment.tzinfo is None:
        moment = moment.astimezone()  # this computer's local time
    return moment.astimezone(datetime.timezone.utc).isoformat()


def local_time(iso):
    return datetime.datetime.fromisoformat(iso).astimezone().strftime("%Y-%m-%d %H:%M")


# --- read ----------------------------------------------------------------------

def load_player_map(path=None):
    path = Path(path) if path else PLAYER_MAP
    if not path.exists():
        if path != PLAYER_MAP:
            sys.exit(f"No player map at {path}")
        return {}
    with path.open(encoding="utf-8") as map_file:
        return json.load(map_file).get("users", {})


def read_one(ref, after, before):
    query = {"channel": ref}
    if after:
        query["after"] = after
    if before:
        query["before"] = before
    return get("/read?" + urllib.parse.urlencode(query), timeout=300)


def who(message, players):
    entry = players.get(message["author_id"])
    if entry:
        return f"{entry.get('character') or message['author']} ({entry.get('player') or message['author']})"
    return message["author"] + (" [bot]" if message["bot"] else "")


def render_section(title, data, players, index):
    lines = [f"## {title}", ""]
    if data["truncated"]:
        lines += ["> ⚠️ Truncated: more messages exist in this range than one read returns.", ""]
    for m in data["messages"]:
        index[m["id"]] = m
    for m in data["messages"]:
        stamp = local_time(m["time"])
        kind = m["type"].split(".")[-1]
        if kind == "thread_starter_message":
            continue  # a copy of the thread's first message, which follows anyway
        if kind not in ("default", "reply", "chat_input_command", "context_menu_command"):
            lines.append(f"*[{stamp}] {m['author']} · {kind}*")
            continue
        invoked = f" · for {m['invoked_by']}" if m.get("invoked_by") else ""
        lines.append(f"**[{stamp}] {who(m, players)}**{invoked}{' (edited)' if m['edited'] else ''}")
        if m["reply_to"]:
            target = index.get(m["reply_to"])
            quote = f"{target['author']}: {target['content'][:80]}" if target else f"message {m['reply_to']}"
            lines.append(f"> ↪ replying to {quote}")
        if m["content"]:
            lines.append(m["content"])
        for a in m["attachments"]:
            lines.append(f"📎 [{a['name']}]({a['url']})")
        for e in m["embeds"]:
            lines.append(f"🔗 embed: {e[:120]}")
        if m.get("reactions"):  # missing when the bot predates reaction counts
            lines.append("reactions: " + " · ".join(f"{r['emoji']} {r['count']}" for r in m["reactions"]))
        if m["thread"]:
            lines.append(f"🧵 started thread **{m['thread']['name']}** (id {m['thread']['id']})")
        lines.append("")
    return lines


def command_read(args):
    after = to_utc_iso(take_option(args, "--from"))
    before = to_utc_iso(take_option(args, "--to"))
    with_threads = take_option(args, "--threads", has_value=False)
    out = take_option(args, "--out")
    map_path = take_option(args, "--map")
    if len(args) != 1:
        sys.exit("Usage: python ask.py read <channel|thread> [--from TIME] [--to TIME] [--threads] [--map FILE] [--out FILE]")
    ref = args[0]
    players = load_player_map(map_path)
    index, sections, authors, total = {}, [], {}, 0
    raw_sections = []  # the bot's answers as they came, for analysis (the Markdown is for reading)

    def add(title, data):
        nonlocal total
        total += len(data["messages"])
        for m in data["messages"]:
            authors.setdefault(m["author_id"], m["author"])
        sections.extend(render_section(title, data, players, index))
        raw_sections.append({"title": title, "channel": data.get("channel"),
                             "truncated": data["truncated"], "messages": data["messages"]})

    channel_name, is_forum = ref, False
    try:
        data = read_one(ref, after, before)
        channel_name = data["channel"]["name"]
        add(f"#{channel_name}", data)
    except SystemExit as error:
        if "forum has no messages" not in str(error):
            raise
        is_forum = True
    if with_threads or is_forum:
        listing = get("/threads?" + urllib.parse.urlencode({"channel": ref}), timeout=120)
        channel_name = listing["channel"]
        for thread in listing["threads"]:
            data = read_one(thread["id"], after, before)
            if data["messages"]:
                add(f"🧵 {thread['name']}" + (" (archived)" if thread["archived"] else ""), data)

    span = f"{local_time(after) if after else 'beginning'} → {local_time(before) if before else 'now'}"
    header = [
        f"# Transcript · #{channel_name}",
        "",
        f"Read {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} · range {span} (local time) · {total} messages",
        "",
        "| Discord author | id | Player | Character |",
        "| --- | --- | --- | --- |",
    ]
    for author_id, name in authors.items():
        entry = players.get(author_id, {})
        header.append(f"| {name} | {author_id} | {entry.get('player', '—')} | {entry.get('character', 'unmapped')} |")
    header.append("")

    if out:
        path = Path(out)
    else:
        TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
        slug = re.sub(r"[^a-z0-9-]+", "-", channel_name.lower()).strip("-") or "channel"
        path = TRANSCRIPTS / f"{slug}-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    path.write_text("\n".join(header + sections), encoding="utf-8")
    raw = {
        "channel": channel_name,
        "read_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "from": after,
        "to": before,
        "message_count": total,
        "authors": {author_id: {"name": name, **players.get(author_id, {})} for author_id, name in authors.items()},
        "sections": raw_sections,
    }
    raw_path = path.with_suffix(".json")
    raw_path.write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{total} messages from {len(authors)} authors → {path} (+ {raw_path.name})")


# --- funny-moments poll --------------------------------------------------------

def poll_problems(draft):
    """The same limits the bot checks, so a preview catches them without the bot."""
    problems = []
    if draft.get("kind") != "funny-moments-poll":
        problems.append("not a funny-moments poll draft (make one with table-insights/moments.py poll)")
    embed = draft.get("embed") or {}
    if len(embed.get("title") or "") > 256 or len(embed.get("description") or "") > 4096:
        problems.append("embed title or description too long")
    for field in embed.get("fields") or []:
        if not field.get("name") or not field.get("value") or len(field["name"]) > 256 or len(field["value"]) > 1024:
            problems.append(f"embed field '{(field.get('name') or '')[:30]}' is empty or too long")
    total = sum(len(embed.get(k) or "") for k in ("title", "description", "footer")) + sum(
        len(f.get("name") or "") + len(f.get("value") or "") for f in embed.get("fields") or [])
    if total > 6000:
        problems.append(f"embed is {total} characters (Discord allows 6000)")
    if not 1 <= len((draft.get("question") or "").strip()) <= 300:
        problems.append("the question needs 1-300 characters")
    answers = draft.get("answers") or []
    if not 2 <= len(answers) <= 10:
        problems.append("a poll needs 2-10 answers")
    for answer in answers:
        if not 1 <= len((answer.get("text") or "").strip()) <= 55:
            problems.append(f"answer '{(answer.get('text') or '')[:30]}' needs 1-55 characters")
    hours = draft.get("duration_hours")
    if not isinstance(hours, int) or not 1 <= hours <= 768:
        problems.append("duration_hours must be a whole number from 1 to 768")
    return problems


def preview_poll(channel, draft):
    embed = draft.get("embed") or {}
    print(f"Would post in #{channel} (after the GM's approval), with no pings:\n")
    print(f"  ┌ {embed.get('title', '')}")
    print(f"  │ {embed.get('description', '')}")
    for field in embed.get("fields") or []:
        print(f"  │\n  │ {field['name']}")
        for line in field["value"].splitlines():
            print(f"  │   {line}")
    if embed.get("footer"):
        print(f"  │\n  └ {embed['footer']}")
    print(f"\n  📊 {draft.get('question')}  ({'several choices' if draft.get('multiple') else 'one vote'}, "
          f"open {draft.get('duration_hours')} h)")
    for answer in draft.get("answers") or []:
        print(f"     {answer.get('emoji') or '•'} {answer.get('text')}  [{len(answer.get('text') or '')}/55]")


# --- main ----------------------------------------------------------------------

def main(argv):
    commands = {"status", "guilds", "channels", "roles", "threads", "read", "embed", "delete",
                "tarot", "tarot-status", "tarot-reveal", "action", "consent", "funny-poll"}
    if not argv or argv[0] not in commands:
        sys.exit(__doc__)
    command, args = argv[0], [a for a in argv[1:] if a != "--json"]
    try:
        if command == "read":
            command_read(args)
        elif command == "action":
            channel = take_option(args, "--channel")
            if len(args) != 2 or args[0] not in {"create-role", "post-terms", "apply-structure"}:
                sys.exit("Usage: python ask.py action <create-role|post-terms|apply-structure> <file.json> [--channel NAME]")
            with open(args[1], encoding="utf-8") as spec_file:
                payload = json.load(spec_file)
            if channel:
                payload["channel"] = channel
            print("Waiting for the GM to approve (terminal, dashboard or dialog)...")
            status, body = post(f"/actions/{args[0]}", payload)
            print(json.dumps(body, indent=2, ensure_ascii=False))
            sys.exit(0 if status == 200 else 1)
        elif command == "funny-poll":
            preview = take_option(args, "--preview", has_value=False)
            if len(args) != 2:
                sys.exit("Usage: python ask.py funny-poll <channel> <draft.json> [--preview]")
            with open(args[1], encoding="utf-8") as draft_file:
                draft = json.load(draft_file)
            problems = poll_problems(draft)
            if preview:
                preview_poll(args[0], draft)
                print("\n" + ("Problems: " + "; ".join(problems) if problems else "Draft OK. Nothing was sent."))
                sys.exit(1 if problems else 0)
            if problems:
                sys.exit("Fix the draft first: " + "; ".join(problems))
            print("Waiting for the GM to approve (terminal, dashboard or dialog)...")
            status, body = post("/actions/funny-poll", {"channel": args[0], "poll": draft})
            print(json.dumps(body, indent=2, ensure_ascii=False))
            sys.exit(0 if status == 200 else 1)
        elif command == "consent":
            consent = get("/consent")
            print(f"Role: {consent['role']} · terms v{consent['version']} · {len(consent['accepted'])} accepted")
            for user_id, entry in consent["accepted"].items():
                print(f"  {entry['name']} ({user_id}) · v{entry['version']} · {entry['time']}")
        elif command == "tarot":
            text = take_option(args, "--text")
            cards = take_option(args, "--cards")
            face_up = take_option(args, "--face-up", has_value=False)
            if len(args) != 2:
                sys.exit('Usage: python ask.py tarot <channel> "<question>" [--text "..."] [--cards 0,16,17] [--face-up]')
            payload = {"channel": args[0], "question": args[1], "description": text, "face_up": bool(face_up)}
            if cards:
                payload["cards"] = [int(c) for c in cards.split(",")]
            print("Waiting for the GM to approve (terminal, dashboard or dialog)...")
            status, body = post("/actions/tarot-deal", payload)
            print(json.dumps(body, indent=2, ensure_ascii=False))
            sys.exit(0 if status == 200 else 1)
        elif command == "tarot-status":
            if len(args) != 1:
                sys.exit("Usage: python ask.py tarot-status <reading id>")
            poll = get(f"/tarot/{args[0]}")
            print(f"Reading {poll['id']} · {poll['question']} · {'revealed' if poll['closed'] else 'open'}")
            for position, name in enumerate(poll["card_names"]):
                voters = [v["name"] for v in poll["votes"].values() if v["position"] == position]
                print(f"  {['I', 'II', 'III'][position]}: {name} · {poll['counts'][position]} · {', '.join(voters) or '-'}")
        elif command == "tarot-reveal":
            if len(args) != 1:
                sys.exit("Usage: python ask.py tarot-reveal <reading id>")
            print("Waiting for the GM to approve (terminal, dashboard or dialog)...")
            status, body = post("/actions/tarot-reveal", {"poll": args[0]})
            print(json.dumps(body, indent=2, ensure_ascii=False))
            sys.exit(0 if status == 200 else 1)
        elif command == "threads":
            if len(args) != 1:
                sys.exit("Usage: python ask.py threads <channel>")
            listing = get("/threads?" + urllib.parse.urlencode({"channel": args[0]}), timeout=120)
            print(f"Threads of #{listing['channel']}:")
            for t in listing["threads"]:
                state = "archived" if t["archived"] else "active"
                created = local_time(t["created"]) if t["created"] else "?"
                print(f"  {t['name']}  id={t['id']}  {state}  created {created}  ~{t['messages']} msgs")
        elif command == "delete":
            if len(args) != 2:
                sys.exit("Usage: python ask.py delete <channel> <message id>")
            print("Waiting for the GM to approve (terminal, dashboard or dialog)...")
            status, body = post("/actions/delete-message", {"channel": args[0], "message_id": args[1]})
            print(json.dumps(body, indent=2, ensure_ascii=False))
            sys.exit(0 if status == 200 else 1)
        elif command == "embed":
            no_ping = take_option(args, "--no-ping", has_value=False)
            welcome_channel = take_option(args, "--welcome-channel")
            if len(args) != 2:
                sys.exit("Usage: python ask.py embed <channel> <file.json> [--no-ping] [--welcome-channel NAME]")
            with open(args[1], encoding="utf-8") as spec_file:
                spec = json.load(spec_file)
            spec["channel"] = args[0]
            if no_ping:
                spec.pop("ping", None)
            if welcome_channel and spec.get("role_button"):
                spec["role_button"]["welcome_channel"] = welcome_channel  # e.g. bot-debug for a test
            print("Waiting for the GM to approve (terminal, dashboard or dialog)...")
            status, body = post("/actions/post-embed", spec)
            print(json.dumps(body, indent=2, ensure_ascii=False))
            sys.exit(0 if status == 200 else 1)
        elif "--json" in argv and command in {"channels", "roles"}:
            print(json.dumps(get(f"/guilds/{pick_guild(args)}/{command}"), indent=2, ensure_ascii=False))
        elif command == "status":
            print(json.dumps(get("/status"), indent=2))
        elif command == "guilds":
            for g in get("/guilds"):
                print(f"{g['name']}  id={g['id']}  members={g['members']}")
        elif command == "channels":
            channels = get(f"/guilds/{pick_guild(args)}/channels")
            categories = sorted((c for c in channels if c["type"] == "category"), key=lambda c: c["position"])
            for group in [None] + [c["name"] for c in categories]:
                members = sorted(
                    (c for c in channels if c["type"] != "category" and c["category"] == group),
                    key=lambda c: c["position"],
                )
                if group is None and not members:
                    continue
                print(f"\n[{group or 'No category'}]")
                for c in members:
                    print(f"  #{c['name']}  ({c['type']}, id={c['id']})")
        elif command == "roles":
            for r in get(f"/guilds/{pick_guild(args)}/roles"):
                flag = "  [managed]" if r["managed"] else ""
                print(f"{r['position']:>3}  {r['name']}  id={r['id']}{flag}")
    except urllib.error.URLError:
        sys.exit(NOT_RUNNING)


if __name__ == "__main__":
    main(sys.argv[1:])
