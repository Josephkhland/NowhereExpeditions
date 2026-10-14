"""Build the demo data set for Table Insights: invented players, characters and scenes.

    python -I table-insights\\demo\\make_demo.py

Writes demo/transcripts/*.json (in the same shape `ask.py read` produces), runs them through
analyze.py and moments.py exactly like real data, then records some example GM decisions.
Nothing here is about a real person, so it's safe for screenshots and showcases. Scenes only
mention real Marketplace gear and never name a Gate or a material (canon stays canon).
"""

import datetime
import json
import sys
import tempfile
from pathlib import Path

DEMO = Path(__file__).resolve().parent
sys.path.insert(0, str(DEMO.parent))
import analyze  # noqa: E402
import moments  # noqa: E402

TRANSCRIPTS = DEMO / "transcripts"
SESSIONS = DEMO / "sessions"

AUTHORS = {
    "900000000000000001": {"name": "Narrator", "player": "GM", "character": "GM", "role": "gm"},
    "900000000000000002": {"name": "Wren", "player": "Wren", "character": "Ilse Varga"},
    "900000000000000003": {"name": "Bolt", "player": "Bolt", "character": "Cassian Ardent"},
    "900000000000000004": {"name": "Moss", "player": "Moss", "character": "Pell Morrow"},
    "900000000000000005": {"name": "Juniper", "player": "Juniper", "character": "Dagny Stone"},
    "900000000000000006": {"name": "Kit", "player": "Kit", "character": "Mei Lan"},
    "900000000000000007": {"name": "Fennel", "player": "Fennel", "character": "Theo Quill",
                           "note": "joined the hub scene late"},
    "900000000000000099": {"name": "Dice Maiden", "player": "Dice Maiden", "character": "dice bot", "role": "bot"},
}
WHO = {"GM": "900000000000000001", "Ilse": "900000000000000002", "Cassian": "900000000000000003",
       "Pell": "900000000000000004", "Dagny": "900000000000000005", "Mei": "900000000000000006",
       "Theo": "900000000000000007", "dice": "900000000000000099"}

CASSIAN_SPEECH = (
    "*Cassian sets his glass down with great ceremony and rises, as if the whole room had asked for him.* "
    "\"Friends. Colleagues. Fellow survivors of a truly unreasonable week. When I signed with the Company, my "
    "family told me the Outpost was a place for people who had run out of better ideas. They were wrong. It is "
    "a place for people who have run out of worse ones. Consider the evidence. Yesterday I watched Pell carry "
    "rations for five people up a cliff and eat all of them on the way down. I watched Dagny argue with a "
    "lantern and win. I watched Ilse tie a knot so good that the rope filed a complaint. And I, Cassian Ardent, "
    "heir to absolutely nothing of value, held the line while the Echo Bell rang and rang and the dark answered "
    "back. I have been thinking about that sound all day. I think it was the Gate laughing at us. I think we "
    "should laugh back. So here is my proposal: a toast, and then another toast, and then a third toast to "
    "make the first two feel less lonely. To the Job Board, which lies. To the Marketplace, which overcharges. "
    "To the Sample Case, which held. To the Outpost itself, which is held together by rope, stubbornness and "
    "whatever is in that stew. To the intake clerk, the rubber stamp and the bent nail, all three of them heroes. And to all of you, who held better.\" "
    "*He raises the glass again, "
    "visibly preparing a second speech.*"
)

# (key, who, text, minutes after the previous message, reactions)
SESSION_ONE = {
    "id": "demo-first-crossing", "channel": "expedition-sessions",
    "start": "2026-10-03T17:00:00+00:00",
    "sections": [
        ("🧵 Briefing · Job 03", [
            ("brief1", "GM", "*The Job Board notice is pinned with a bent nail: SURVEY BEYOND THE GATE. RETURN BY DARK. PAY ON DELIVERY OF SAMPLES.* The crew gathers at the Outpost gate at first light. What do you bring?", 0),
            ("", "Ilse", "*Checks the Rope twice, then a third time out of spite.* \"Rope, Grappling Kit, and my own two hands. That's the whole plan.\"", 3),
            ("", "Cassian", "\"I've brought a Lantern, a Flare Pistol and an excellent attitude.\"", 2),
            ("rations", "Pell", "*Pell has a Rations Kit strapped to each shoulder.* \"I packed rations for five. Do not ask me why there are five.\"", 2),
            ("", "Mei", "\"There are five of us, Pell.\"", 1, [("😂", 3)]),
            ("", "Pell", "\"...Right. Yes. That was the plan all along.\"", 1),
            ("", "Dagny", "*Dagny shoulders the Echo Bell and a Listening Horn.* \"If anything down there sings, I want to hear it first.\"", 3),
            ("", "Mei", "*Mei unrolls a Tide Chart and a blank page of the field notebook.* \"I'll map. Somebody has to write down where we nearly died.\"", 2),
            ("", "GM", "\"Good. The Gate opens at the turn of the tide. Anyone want to check the weather before you go?\"", 2),
            ("barometer", "Mei", "\"The Portable Barometer, please. I want to know if the air on the other side is lying to us.\"", 2),
            ("", "dice", "Mei (Kit) Request: `[4dF+2]` Result: `4` Reason: `Notice`", 1),
            ("", "GM", "*The needle shivers, then drops. Pressure falls fast on the far side: a storm, or something breathing.* You get the aspect **Pressure Falling**.", 2),
            ("", "Ilse", "\"Lovely. A storm or a monster. My two favourite surprises.\"", 1),
            ("stat", "Cassian", "\"Statistically one of those is fine.\"", 1),
            ("", "Dagny", "\"Statistically you've never been right about anything.\"", 1, [("😂", 2)]),
            ("", "Cassian", "*laughs* \"Fair.\"", 1),
        ]),
        ("🧵 Underway · Job 03", [
            ("underway1", "GM", "*Beyond the Gate the ground slopes down into a basin of black glass. Wind moves over it with a sound like breath through teeth. Halfway down, the path ends in a drop.*", 30),
            ("anchor", "Ilse", "\"I'll anchor a line. Nobody step anywhere until I say so.\"", 2),
            ("", "dice", "Ilse (Wren) Request: `[4dF+3]` Result: `5` Reason: `Athletics: create an advantage`", 1),
            ("rope", "Ilse", "*Ilse hammers a spike into the glass, loops the Rope through, and tests it with her full weight.* \"**Rope Line Anchored**. Free invoke for whoever goes first.\"", 2),
            ("pellfirst", "Pell", "\"I'll go first. I have the most rations to lose.\"", 2),
            ("", "Dagny", "\"That is not how risk works, Pell.\"", 1),
            ("", "dice", "Pell (Moss) Request: `[4dF+1]` Result: `3` Reason: `Athletics, invoking Rope Line Anchored`", 2),
            ("", "GM", "*Pell swings down on Ilse's line and lands neatly, scattering glass dust. The line holds.*", 2),
            ("", "Pell", "\"I'm alive! The rations are alive!\"", 1),
            ("", "Mei", "*Mei follows, counting steps out loud and sketching the drop on her page.*", 2),
            ("", "Cassian", "*Cassian goes last, lantern high, and lands with a bow nobody asked for.*", 2),
            ("bell", "Dagny", "\"Quiet. Everyone.\" *Dagny rings the Echo Bell once and lifts the Listening Horn.*", 3),
            ("", "dice", "Dagny (Juniper) Request: `[4dF+2]` Result: `5` Reason: `Notice`", 1),
            ("echo", "GM", "*The bell's note comes back wrong: three echoes, then a fourth that arrives before the others, as if something under the glass answered early.*", 2),
            ("dagnyecho", "Dagny", "\"Something down there rang back before the bell finished. I'm writing that down and then I'm never thinking about it again.\"", 2),
            ("", "Mei", "\"I'm writing it down too. Bigger.\"", 1),
            ("", "Ilse", "*laughs* \"Bigger letters won't make it less creepy, Mei.\"", 1),
            ("", "GM", "*At the bottom of the basin, a shallow pool. Something pale floats in it, turning slowly against the wind.*", 3),
            ("", "Cassian", "\"Do we touch the mysterious floating thing?\"", 1),
            ("sample", "Mei", "\"We don't touch it. We collect it. Sample Case, please.\" *Mei slides the specimen in with the lid held like a shield.*", 2),
            ("", "dice", "Mei (Kit) Request: `[4dF+2]` Result: `2` Reason: `Lore`", 1),
            ("", "GM", "*It goes in. The lid clicks. The pool, very slightly, starts to drain.*", 2),
            ("map", "Mei", "\"The map says 'here be nothing.' Bold of the map.\"", 2, [("😂", 4), ("🔥", 1)]),
            ("", "Pell", "*Pell laughs so hard he has to sit on a ration tin.*", 1),
            ("", "Dagny", "\"We should go. Now. The pressure's still falling.\"", 2),
            ("", "Ilse", "\"Back up the line. Pell first, rations second.\"", 1),
            ("", "GM", "*The wind rises behind you as you climb. Something in the basin hums the bell's note back, slow and wrong.*", 3),
            ("", "Cassian", "\"I want it noted I did not touch anything.\"", 1),
            ("", "Mei", "\"Noted. In small letters.\"", 1),
        ]),
        ("🧵 Returned · Job 03", [
            ("return1", "GM", "*You come back through the Gate at dusk with one full Sample Case and four sore shoulders. The intake clerk wants a report.*", 50),
            ("report", "Cassian", "\"I'll do the talking.\" *He does not do the talking: Dagny elbows him aside.*", 3),
            ("dagnyreport", "Dagny", "\"Basin of black glass. Echo returns early. One sample, sealed. Pressure falling the whole time. That's it.\"", 2),
            ("pellrations", "Pell", "\"And the rations were excellent.\"", 1),
            ("", "Ilse", "\"Nobody asked about the rations, Pell.\"", 1),
            ("", "Pell", "\"Somebody should.\"", 1, [("😂", 2)]),
            ("", "Mei", "*Mei hands over the map, the early echo circled three times.*", 2),
            ("", "GM", "*The clerk stamps it: UNDER EVALUATION. Pay on delivery, minus one bent nail.*", 2),
        ]),
    ],
}

SESSION_TWO = {
    "id": "demo-lantern-night", "channel": "rp-hub",
    "start": "2026-10-06T19:00:00+00:00",
    "sections": [
        ("#rp-hub", [
            ("hub1", "GM", "*Evening at the Outpost. The mess hall smells of lamp oil and stew. The crew from Job 03 has the corner table and, apparently, a reputation.*", 0),
            ("", "Ilse", "*Ilse props her boots on the bench.* \"Day off. Nobody say the word Gate.\"", 3),
            ("", "Pell", "\"Gate.\"", 1),
            ("", "Ilse", "*throws a bread roll*", 1),
            ("speech", "Cassian", CASSIAN_SPEECH, 4),
            ("", "Pell", "\"He's doing another one.\"", 2),
            ("", "Cassian", "\"I am doing another one. To the bread roll Ilse threw, which missed, and to Pell, who caught it with his face.\"", 2),
            ("", "Ilse", "\"Did he just give a toast to a bread roll?\"", 1, [("😂", 3)]),
            ("", "Cassian", "\"And to Mei's map, which insulted the void and won. To Dagny's ears. To the stew. To the person who made the stew. To the pot.\"", 3),
            ("", "Pell", "\"The pot did a lot of work, to be fair.\"", 1),
            ("", "Cassian", "\"Thank you, Pell. To Pell's fairness. To the concept of fairness generally, which the Marketplace has never heard of.\"", 2),
            ("theo", "Theo", "*From the next table, without looking up from a book:* \"I'd like the record to show the early echo is in chapter four. I was right.\"", 3, [("😂", 2)]),
            ("", "Cassian", "\"To the record! To chapter four! To the stranger at the next table, who is clearly a genius and should join us for the next eleven toasts.\"", 2),
            ("", "Ilse", "\"Bolt please let someone else talk\"", 1),
            ("", "Cassian", "\"Right. Yes. Sorry. Pell, you were saying?\"", 1),
            ("", "Pell", "\"I was saying the pot did a lot of work.\"", 1),
        ]),
        ("🧵 Late watch", [
            ("watch1", "Ilse", "*Later, on the wall, Ilse finds Pell sharing the last ration with a lantern moth.*", 90),
            ("pellmoth", "Pell", "\"Don't tell anyone. He's had a hard week too.\"", 2),
            ("moth", "Ilse", "\"Your secret's safe. Same time tomorrow? I'll teach you the knot that made the rope complain.\"", 3),
            ("", "Pell", "\"Deal. Bring two rations. He's growing.\"", 2),
            ("", "Ilse", "*laughs*", 1),
            ("", "Pell", "*The moth settles on the Lantern. Neither of them says the word Gate.*", 2),
        ]),
    ],
}

MOMENTS = {
    "demo-first-crossing": {
        "moments": [
            {"who": "Ilse Varga", "kind": "assist", "keys": ["rope"], "helped": ["Pell Morrow"],
             "summary": "Anchors a rope line down the drop and hands the free invoke to whoever goes first.",
             "why": "Set the whole descent up for the others; Pell used the invoke straight away.",
             "quote": "Free invoke for whoever goes first."},
            {"who": "Ilse Varga", "kind": "story-choice", "keys": ["anchor"],
             "summary": "Decides the crew descends into the basin instead of skirting it.",
             "why": "Took the expedition to where the discoveries were.",
             "quote": "Nobody step anywhere until I say so"},
            {"who": "Cassian Ardent", "kind": "character", "keys": ["report"],
             "summary": "Volunteers to give the report and is elbowed aside by Dagny.",
             "why": "Shows the crew's dynamic in one line.", "quote": "I'll do the talking."},
            {"who": "Pell Morrow", "kind": "character", "keys": ["rations"],
             "summary": "Packs rations for five, then realises there are five of them.",
             "why": "Set up a running joke the whole crew picked up.", "quote": "I packed rations for five."},
            {"who": "Pell Morrow", "kind": "mechanics", "keys": ["pellfirst"],
             "summary": "Goes first down the line, invoking Ilse's aspect, and lands it.",
             "why": "A clean use of another player's advantage.", "quote": "I'll go first."},
            {"who": "Dagny Stone", "kind": "discovery", "keys": ["bell", "dagnyecho"],
             "summary": "Rings the Echo Bell and hears something answer before the bell finished.",
             "why": "The session's central mystery, now an open thread.", "quote": "Something down there rang back before the bell finished."},
            {"who": "Dagny Stone", "kind": "story-choice", "keys": ["dagnyreport"],
             "summary": "Gives the intake report herself: short, factual, complete.",
             "why": "Turned the session into a clean record for the Archive.", "quote": "Basin of black glass."},
            {"who": "Mei Lan", "kind": "discovery", "keys": ["barometer"],
             "summary": "Reads the barometer before crossing: pressure falling on the far side.",
             "why": "Earned the aspect Pressure Falling, which framed the whole trip.", "quote": "I want to know if the air on the other side is lying to us."},
            {"who": "Mei Lan", "kind": "story-choice", "keys": ["sample"],
             "summary": "Collects the floating specimen with the Sample Case instead of touching it.",
             "why": "Secured the job's payment and the session's only sample.", "quote": "We don't touch it. We collect it."},
        ],
        "humor": [
            {"keys": ["map"], "rank": 1, "setup": "The crew's map of the basin is blank. Mei reads it aloud.",
             "quote": "The map says 'here be nothing.' Bold of the map."},
            {"keys": ["rations"], "rank": 2, "setup": "Pell explains why he packed rations for five.",
             "quote": "Do not ask me why there are five."},
            {"keys": ["stat"], "rank": 4, "setup": "Cassian is optimistic about the falling pressure. Dagny isn't.",
             "quote": "Statistically you've never been right about anything.", "extra": 2},
            {"keys": ["pellrations"], "rank": 5, "setup": "At intake, Pell insists the report mention the rations.",
             "quote": "Somebody should.", "extra": 3},
        ],
    },
    "demo-lantern-night": {
        "moments": [
            {"who": "Cassian Ardent", "kind": "character", "keys": ["speech"],
             "summary": "Gives a sweeping toast to the crew, the Job Board and the Sample Case.",
             "why": "A big character moment, though it filled most of the scene.", "quote": "To the Sample Case, which held."},
            {"who": "Theo Quill", "kind": "discovery", "keys": ["theo"],
             "summary": "From the next table: the early echo is described in a book, chapter four.",
             "why": "One line that linked the expedition's mystery to a lead. Worth a follow-up hook.",
             "quote": "the early echo is in chapter four"},
            {"who": "Ilse Varga", "kind": "assist", "keys": ["moth"], "helped": ["Pell Morrow"],
             "summary": "Offers to teach Pell her knot on the late watch.",
             "why": "Gave a quieter scene room and a reason to continue.", "quote": "I'll teach you the knot that made the rope complain."},
            {"who": "Pell Morrow", "kind": "character", "keys": ["pellmoth"],
             "summary": "Shares his last ration with a lantern moth.", "why": "A small, warm character beat.",
             "quote": "He's had a hard week too."},
        ],
        "humor": [
            {"keys": ["theo"], "rank": 3, "setup": "Cassian's toasts have gone on for a while. A stranger at the next table speaks up.",
             "quote": "I'd like the record to show the early echo is in chapter four. I was right."},
            {"keys": ["speech"], "rank": 6, "setup": "Ilse throws a bread roll; Cassian toasts it.",
             "quote": "Did he just give a toast to a bread roll?", "extra": 4},
        ],
    },
}

# Example GM decisions so the dashboard shows every state: (item id, verdict, note, feature consent)
DECISIONS = {
    "demo-first-crossing": [
        ("m1", "confirm", "Textbook assist.", None), ("m2", "confirm", "", None), ("m3", "reject", "Funny, not a moment.", None),
        ("m4", "confirm", "", None), ("m6", "confirm", "Hook for next session.", None), ("m8", "confirm", "", None),
        ("h1", "confirm", "", True), ("h2", "confirm", "", True), ("h3", "reject", "Needs too much context.", None),
    ],
    "demo-lantern-night": [
        ("m1", "confirm", "Lovely, but Bolt had 70% of the scene: a gentle word about leaving room.", None),
        ("m2", "confirm", "Theo had one line all night. Aim the next hook at him.", None),
        ("h1", "confirm", "", True),
    ],
}


def build_raw(spec):
    time = datetime.datetime.fromisoformat(spec["start"])
    sections, keys, counter, number = [], {}, 0, 0
    for title, lines in spec["sections"]:
        messages = []
        for entry in lines:
            key, who, text, gap = entry[:4]
            reactions = [{"emoji": e, "count": c} for e, c in (entry[4] if len(entry) > 4 else [])]
            time += datetime.timedelta(minutes=gap)
            counter += 1
            number += 1
            author_id = WHO[who]
            author = AUTHORS[author_id]
            dice = who == "dice"
            invoker = None
            if dice:
                invoker = text.split(" (")[1].split(")")[0]  # "Mei (Kit) Request..." -> Kit
            messages.append({
                "invoked_by": invoker, "id": str(910000000000000000 + counter), "time": time.isoformat(),
                "edited": None, "author_id": author_id, "author": author["name"], "bot": dice, "webhook": dice,
                "type": "MessageType.chat_input_command" if dice else "MessageType.default",
                "content": text, "reply_to": None, "attachments": [], "embeds": [], "thread": None,
                "reactions": reactions,
            })
            if key:
                keys[key] = number
        sections.append({"title": title, "channel": {"name": title}, "truncated": False, "messages": messages})
    present = {m["author_id"] for s in sections for m in s["messages"]}
    raw = {
        "channel": spec["channel"], "read_at": (time + datetime.timedelta(hours=1)).isoformat(),
        "from": None, "to": None, "message_count": sum(len(s["messages"]) for s in sections),
        "authors": {a: v for a, v in AUTHORS.items() if a in present}, "sections": sections,
    }
    return raw, keys


def main():
    TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
    SESSIONS.mkdir(parents=True, exist_ok=True)
    for old in SESSIONS.glob("*"):
        old.unlink()
    analyze.SESSIONS = SESSIONS  # everything below writes to the demo set, never to data/
    for spec in (SESSION_ONE, SESSION_TWO):
        raw, keys = build_raw(spec)
        source = TRANSCRIPTS / f"{spec['id']}.json"
        source.write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
        session = analyze.analyse(raw, spec["id"], source)
        out = SESSIONS / f"{spec['id']}.json"
        out.write_text(json.dumps(session, indent=1, ensure_ascii=False), encoding="utf-8")
        out.with_suffix(".reading.md").write_text(analyze.reading_copy(raw, spec["id"]), encoding="utf-8")

        plan = MOMENTS[spec["id"]]
        draft = {"moments": [], "humor": []}
        for m in plan["moments"]:
            draft["moments"].append({**{k: v for k, v in m.items() if k != "keys"},
                                     "messages": [keys[k] for k in m["keys"]]})
        for h in plan["humor"]:
            first = keys[h["keys"][0]]
            numbers = list(range(first, first + h.get("extra", 1))) if h.get("extra") else [keys[k] for k in h["keys"]]
            draft["humor"].append({"messages": numbers, "rank": h["rank"], "setup": h["setup"], "quote": h["quote"]})
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
            json.dump(draft, handle)
        moments.command_import(spec["id"], handle.name)
        Path(handle.name).unlink()

        path, session, _ = moments.load(spec["id"])
        for item_id, verdict, note, feature in DECISIONS[spec["id"]]:
            moments.decide(session, item_id, verdict, note)
            if feature is not None:
                moments.set_feature(session, item_id, feature)
        session["review"]["reviewed_by"] = "GM (demo)"
        moments.save(path, session)
        print(f"{spec['id']}: {raw['message_count']} messages, {len(session['moments'])} moments, "
              f"{len(session['humor_candidates'])} humor candidates, {len(session['flags'])} flags")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
