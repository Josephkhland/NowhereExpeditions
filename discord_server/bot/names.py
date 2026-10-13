"""Character names in each faction's style, for the /names slash command.

The lists live in public-site/assets/names.json, shared with the site's Name Generator
(public-site/names.js does the same in the browser, so keep the two in step). Edit freely;
the bot reads the file on every use. Preview without the bot:

    .venv\\Scripts\\python.exe names.py vardic-holds [feminine|masculine] [count]
"""

import json
import random
import string
import sys
from pathlib import Path

NAMES_FILE = Path(__file__).resolve().parents[2] / "public-site" / "assets" / "names.json"
GENDERS = ("feminine", "masculine")
MAX_COUNT = 10


def load():
    return json.loads(NAMES_FILE.read_text(encoding="utf-8"))["factions"]


def given_name(style, gender, rng):
    syllables = style.get("syllables")
    if syllables:
        pool = syllables[gender] + syllables.get("neutral", [])
        parts = rng.sample(pool, rng.choice((1, 2, 2)))
        # Pinyin marks a syllable break before a vowel: Ying'an, not Yingan.
        return parts[0] + "".join(("'" if part[0] in "AEO" else "") + part.lower() for part in parts[1:])
    return rng.choice(style[gender])


def one_name(style, gender, rng):
    pattern = rng.choices(style["patterns"], weights=[p.get("weight", 1) for p in style["patterns"]])[0]["format"]
    given = given_name(style, gender, rng)
    surname, surname2 = rng.sample(style["surnames"], 2)
    values = {"given": given, "surname": surname, "surname2": surname2,
              "initial": rng.choice(string.ascii_uppercase.replace("X", "")) + "."}
    if "{given2}" in pattern:
        values["given2"] = rng.choice([n for n in style[gender] if n != given])
    if "{patronymic}" in pattern:
        values["patronymic"] = rng.choice(style["fathers"]) + style["patronymic"][gender]
    return pattern.format(**values)


def generate(faction, gender=None, count=MAX_COUNT, rng=random):
    """Up to `count` different names; gender None mixes feminine and masculine."""
    style = load()[faction]
    count = max(1, min(int(count), MAX_COUNT))
    names = []
    for _ in range(count * 20):
        if len(names) == count:
            break
        name = one_name(style, gender or rng.choice(GENDERS), rng)
        if name not in names:
            names.append(name)
    return names


def describe(faction):
    style = load()[faction]
    return style["label"], style.get("note", "")


if __name__ == "__main__":
    args = sys.argv[1:]
    factions = load()
    if not args or args[0] not in factions:
        print("Factions:", ", ".join(factions))
        sys.exit(1)
    gender = next((a for a in args[1:] if a in GENDERS), None)
    count = next((int(a) for a in args[1:] if a.isdigit()), MAX_COUNT)
    label, note = describe(args[0])
    print(f"{label}: {note}")
    for i, name in enumerate(generate(args[0], gender, count), 1):
        print(f"{i:2}. {name}")
