"""Draws the Nowhere Expeditions desktop icon (tools/nowhere-expeditions.ico).

Based on the site's brand mark (a teal diamond in a glowing frame, see .brand-mark in
public-site/styles.css) with the gold star from the bot's tarot card backs.
Needs Pillow:  python tools/make_icon.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().with_name("nowhere-expeditions.ico")
BG = (15, 12, 9)
GOLD = (224, 168, 93)
TEAL = (122, 215, 209)
S = 512  # drawn large, scaled down for each icon size


def draw_icon():
    image = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((16, 16, S - 16, S - 16), radius=96, fill=BG, outline=GOLD, width=22)

    # Teal glow behind the mark.
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((96, 96, S - 96, S - 96), fill=TEAL + (110,))
    glow = glow.filter(ImageFilter.GaussianBlur(48))
    image.alpha_composite(glow)

    # The brand diamond.
    c = S / 2
    r = 150
    diamond = [(c, c - r), (c + r, c), (c, c + r), (c - r, c)]
    draw = ImageDraw.Draw(image)
    draw.polygon(diamond, outline=TEAL, width=20)

    # Gold eight-point star inside it.
    star = []
    for k in range(16):
        radius = 112 if k % 2 == 0 else 36
        angle = -math.pi / 2 + math.pi * k / 8
        star.append((c + radius * math.cos(angle), c + radius * math.sin(angle)))
    draw.polygon(star, fill=GOLD)
    draw.ellipse((c - 22, c - 22, c + 22, c + 22), fill=TEAL)
    return image


if __name__ == "__main__":
    icon = draw_icon()
    icon.save(OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    icon.resize((256, 256), Image.LANCZOS).save(OUT.with_suffix(".png"))
    print(f"Icon written to {OUT}")
