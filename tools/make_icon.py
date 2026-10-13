"""Draws the Nowhere Expeditions icons: the desktop icon and the three favicons.

Based on the site's brand mark (a teal diamond in a glowing frame, see .brand-mark in
public-site/styles.css) with the gold star from the bot's tarot card backs. The frame colour
tells the tabs apart: gold for the public site (and the desktop shortcut), teal for the
content manager.

Needs Pillow (the bot's venv has it):
    discord_server\\bot\\.venv\\Scripts\\python.exe tools\\make_icon.py
"""

import io
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
BG = (15, 12, 9)
GOLD = (224, 168, 93)
TEAL = (122, 215, 209)
S = 512  # drawn large, scaled down for each icon size
FAVICON_SIZES = [(16, 16), (32, 32), (48, 48)]


def draw_icon(frame=GOLD):
    image = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((16, 16, S - 16, S - 16), radius=96, fill=BG, outline=frame, width=22)

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


def png_bytes(image, size):
    buffer = io.BytesIO()
    image.resize((size, size), Image.LANCZOS).save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


if __name__ == "__main__":
    site, manager = draw_icon(GOLD), draw_icon(TEAL)

    # Desktop shortcut.
    site.save(TOOLS / "nowhere-expeditions.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    site.resize((256, 256), Image.LANCZOS).save(TOOLS / "nowhere-expeditions.png")

    # Public site: favicon.ico at the root, a PNG for modern browsers and one for phones' home screens.
    site.save(ROOT / "public-site" / "favicon.ico", sizes=FAVICON_SIZES)
    (ROOT / "public-site" / "assets" / "favicon-32.png").write_bytes(png_bytes(site, 32))
    (ROOT / "public-site" / "assets" / "apple-touch-icon.png").write_bytes(png_bytes(site, 180))

    # Content manager (served from /static/).
    manager.save(ROOT / "content-manager" / "static" / "favicon.ico", sizes=FAVICON_SIZES)
    print("Icons written")
