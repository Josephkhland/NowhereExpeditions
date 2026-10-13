"""Tarot card images for the bot: card faces, card backs, the dealt table, flips and the reveal.

Pure Pillow; nothing here talks to Discord. Run it on its own to preview the images:

    python tarot.py preview [out_dir]        (default out_dir: tarot-cache/preview)

Cards are drawn, not painted: a numeral, an emblem and the card's name, in the campaign
site's colours. Real art can replace card_face() later without touching the bot.
"""

import io
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
CACHE = HERE / "tarot-cache"

MAJOR_ARCANA = [
    "The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor",
    "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit",
    "Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance",
    "The Devil", "The Tower", "The Star", "The Moon", "The Sun", "Judgement", "The World",
]
ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
         "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"]

# Site palette (public-site/styles.css): --accent #7ad7d1, --accent-2 #e0a85d.
TABLE = (15, 12, 9)
CARD = (29, 24, 19)
BACK = (19, 16, 12)
GOLD = (224, 168, 93)
TEAL = (122, 215, 209)
CREAM = (239, 230, 214)
DIM = (120, 100, 70)

CARD_W, CARD_H = 300, 500
GAP = 40
LABEL_H = 70
FONT_FILES = ["pala.ttf", "georgia.ttf", "times.ttf"]
FONT_BOLD_FILES = ["palab.ttf", "georgiab.ttf", "timesbd.ttf"]


def font(size, bold=False):
    for name in (FONT_BOLD_FILES if bold else FONT_FILES):
        for folder in (Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")):
            path = folder / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def centred_text(draw, y, text, fnt, fill, width=CARD_W):
    box = draw.textbbox((0, 0), text, font=fnt)
    draw.text(((width - (box[2] - box[0])) / 2 - box[0], y), text, font=fnt, fill=fill)


def fitted_font(draw, text, size, max_width, bold=False):
    while size > 12:
        fnt = font(size, bold)
        box = draw.textbbox((0, 0), text, font=fnt)
        if box[2] - box[0] <= max_width:
            return fnt
        size -= 2
    return font(12, bold)


def card_frame(fill):
    card = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((0, 0, CARD_W - 1, CARD_H - 1), radius=22, fill=fill, outline=GOLD, width=6)
    draw.rounded_rectangle((16, 16, CARD_W - 17, CARD_H - 17), radius=14, outline=DIM, width=2)
    return card, draw


def polygon(cx, cy, radius, sides, rotation=0.0):
    return [(cx + radius * math.cos(rotation + 2 * math.pi * k / sides),
             cy + radius * math.sin(rotation + 2 * math.pi * k / sides)) for k in range(sides)]


def card_back():
    card, draw = card_frame(BACK)
    # Diamond lattice, clipped to the inner panel.
    lattice = Image.new("RGBA", card.size, (0, 0, 0, 0))
    lattice_draw = ImageDraw.Draw(lattice)
    for offset in range(-CARD_H, CARD_W + CARD_H, 34):
        lattice_draw.line((offset, 0, offset + CARD_H, CARD_H), fill=(40, 52, 50, 255), width=1)
        lattice_draw.line((offset, CARD_H, offset + CARD_H, 0), fill=(40, 52, 50, 255), width=1)
    mask = Image.new("L", card.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((18, 18, CARD_W - 19, CARD_H - 19), radius=12, fill=255)
    card.paste(lattice, (0, 0), Image.composite(lattice, Image.new("RGBA", card.size, (0, 0, 0, 0)), mask))
    draw.rounded_rectangle((16, 16, CARD_W - 17, CARD_H - 17), radius=14, outline=DIM, width=2)
    cx, cy = CARD_W / 2, CARD_H / 2
    draw.ellipse((cx - 96, cy - 96, cx + 96, cy + 96), fill=BACK, outline=GOLD, width=4)
    draw.ellipse((cx - 72, cy - 72, cx + 72, cy + 72), outline=TEAL, width=2)
    star = []
    for k in range(16):
        r = 64 if k % 2 == 0 else 22
        a = -math.pi / 2 + math.pi * k / 8
        star.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    draw.polygon(star, fill=GOLD)
    draw.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=TEAL)
    centred_text(draw, CARD_H - 70, "NOWHERE", font(20, True), GOLD)
    return card


def card_face(index):
    card, draw = card_frame(CARD)
    centred_text(draw, 34, ROMAN[index], font(46, True), GOLD)
    cx, cy = CARD_W / 2, 238
    draw.ellipse((cx - 100, cy - 100, cx + 100, cy + 100), outline=TEAL, width=4)
    sides = 3 + index % 7
    draw.polygon(polygon(cx, cy, 78, sides, -math.pi / 2 + index * 0.3), outline=GOLD, width=4)
    draw.polygon(polygon(cx, cy, 40, sides, math.pi / 2 + index * 0.3), fill=GOLD)
    for k in range(index % 5 + 3):
        a = 2 * math.pi * k / (index % 5 + 3) + index
        x, y = cx + 120 * math.cos(a), cy + 120 * math.sin(a)
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=TEAL)
    draw.line((40, 380, CARD_W - 40, 380), fill=DIM, width=2)
    name = MAJOR_ARCANA[index]
    centred_text(draw, 400, name, fitted_font(draw, name, 34, CARD_W - 60, bold=True), CREAM)
    return card


# --- compositions --------------------------------------------------------------

def table_size():
    return 3 * CARD_W + 4 * GAP, CARD_H + 2 * GAP + LABEL_H


def card_x(position):
    return GAP + position * (CARD_W + GAP)


def blank_table():
    return Image.new("RGB", table_size(), TABLE)


def label(draw, position, text, fill=GOLD, size=40):
    fnt = font(size, True)
    box = draw.textbbox((0, 0), text, font=fnt)
    x = card_x(position) + (CARD_W - (box[2] - box[0])) / 2 - box[0]
    draw.text((x, GAP + CARD_H + 18), text, font=fnt, fill=fill)


def ease_out(t):
    return 1 - (1 - t) ** 3


def save_gif(frames, durations):
    """Animated GIF that plays once and then holds its last frame."""
    buffer = io.BytesIO()
    frames[0].save(buffer, format="GIF", save_all=True, append_images=frames[1:],
                   duration=durations, disposal=1, optimize=False)
    return buffer.getvalue()


def deal_gif(faces=None):
    """Three cards sliding onto the table one after another: face down, or face up when
    `faces` lists the three card numbers. The numerals I, II, III are on every frame, so
    they show whichever frame Discord ends on."""
    cards = [card_face(i) for i in faces] if faces else [card_back()] * 3
    width, height = table_size()
    frames, durations = [], []
    steps = 7
    for position in range(3):
        for step in range(1, steps + 1):
            frame = blank_table()
            draw = ImageDraw.Draw(frame)
            for slot in range(3):
                label(draw, slot, ROMAN[slot + 1])
            for done in range(position):
                frame.paste(cards[done], (card_x(done), GAP), cards[done])
            y = int(height + (GAP - height) * ease_out(step / steps))
            frame.paste(cards[position], (card_x(position), y), cards[position])
            frames.append(frame)
            durations.append(45)
    frames.append(frames[-1].copy())  # a spare copy of the finished table to rest on
    durations.append(60000)
    return save_gif(frames, durations)


def glow_card(face, pad=20):
    """A face-up card with a soft teal glow around it."""
    size = (CARD_W + 2 * pad, CARD_H + 2 * pad)
    frame = Image.new("RGB", size, TABLE)
    halo = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(halo).rounded_rectangle((pad - 8, pad - 8, pad + CARD_W + 8, pad + CARD_H + 8),
                                           radius=28, fill=TEAL + (120,))
    halo = halo.filter(ImageFilter.GaussianBlur(12))
    frame.paste(halo, (0, 0), halo)
    frame.paste(face, (pad, pad), face)
    return frame


def chosen_png(index):
    """The card a player picked from a face-up reading (no flip needed)."""
    buffer = io.BytesIO()
    glow_card(card_face(index)).save(buffer, format="PNG")
    return buffer.getvalue()


def flip_gif(index):
    """One card turning over, from its back to its face. Cached per card."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"flip-{index:02d}.gif"
    if path.exists():
        return path.read_bytes()
    back, face = card_back(), card_face(index)
    pad = 20
    size = (CARD_W + 2 * pad, CARD_H + 2 * pad)
    frames, durations = [], []
    hold = Image.new("RGB", size, TABLE)
    hold.paste(back, (pad, pad), back)
    frames.append(hold)
    durations.append(350)
    steps = 8
    for side, image in (("back", back), ("face", face)):
        for step in range(steps):
            t = step / steps if side == "back" else (step + 1) / steps
            scale = math.cos(t * math.pi / 2) if side == "back" else math.sin(t * math.pi / 2)
            w = max(2, int(CARD_W * scale))
            lift = int(18 * math.sin(t * math.pi / 2 if side == "back" else (1 - t) * math.pi / 2))
            squeezed = image.resize((w, CARD_H + lift))
            frame = Image.new("RGB", size, TABLE)
            frame.paste(squeezed, (pad + (CARD_W - w) // 2, pad - lift // 2), squeezed)
            frames.append(frame)
            durations.append(40)
    # A soft teal glow as it lands, held (twice, in case Discord drops the very last frame).
    glow = glow_card(face, pad)
    frames += [glow, glow.copy()]
    durations += [1500, 60000]
    data = save_gif(frames, durations)
    path.write_bytes(data)
    return data


def reveal_png(cards, counts):
    """All three cards face up; the most-chosen one(s) glow; vote counts underneath."""
    frame = blank_table()
    best = max(counts) if any(counts) else None
    for position, index in enumerate(cards):
        x = card_x(position)
        if best is not None and counts[position] == best:
            halo = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            ImageDraw.Draw(halo).rounded_rectangle((x - 10, GAP - 10, x + CARD_W + 10, GAP + CARD_H + 10),
                                                   radius=30, fill=TEAL + (140,))
            halo = halo.filter(ImageFilter.GaussianBlur(14))
            frame.paste(halo, (0, 0), halo)
        face = card_face(index)
        frame.paste(face, (x, GAP), face)
    draw = ImageDraw.Draw(frame)
    for position in range(3):
        votes = counts[position]
        text = f"{ROMAN[position + 1]} · {votes} vote{'s' if votes != 1 else ''}"
        label(draw, position, text, TEAL if best is not None and votes == best else GOLD, 34)
    buffer = io.BytesIO()
    frame.save(buffer, format="PNG")
    return buffer.getvalue()


def preview(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    card_back().save(out / "back.png")
    for index in (0, 16, 17):
        card_face(index).save(out / f"face-{index:02d}.png")
    (out / "deal.gif").write_bytes(deal_gif())
    (out / "deal-face-up.gif").write_bytes(deal_gif([0, 16, 17]))
    (out / "chosen-16.png").write_bytes(chosen_png(16))
    (out / "flip-16.gif").write_bytes(flip_gif(16))
    (out / "reveal.png").write_bytes(reveal_png([0, 16, 17], [1, 3, 0]))
    print(f"Preview written to {out}")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "preview":
        preview(sys.argv[2] if len(sys.argv) > 2 else CACHE / "preview")
    else:
        sys.exit(__doc__)
