"""Bergkönig Featured Graphic für Google Play (1024x500).

Erzeugt eine policy-konforme Featured Graphic ohne Ranking-/Performance-Claims.
Aufruf: python scripts/build-featured-graphic.py
Output: Fotos/featured-graphic-1024x500.png
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "docs" / "icons" / "icon-512.png"
PLAYFAIR = ROOT / "fonts" / "PlayfairDisplay.ttf"
DMSANS = ROOT / "fonts" / "DMSans.ttf"
ARIAL = Path("C:/Windows/Fonts/arial.ttf")
ARIALBD = Path("C:/Windows/Fonts/arialbd.ttf")
OUT = ROOT / "Fotos" / "featured-graphic-1024x500.png"

W, H = 1024, 500
BG = (26, 24, 20)
GOLD = (201, 168, 76)
CREAM = (240, 236, 228)
MUTED = (136, 136, 136)
SUBTLE = (110, 100, 80)

def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path if path.exists() else ARIAL), size)

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# subtiler Berg-Hintergrund (rechts unten)
draw.polygon(
    [(450, H), (620, 270), (760, 360), (880, 240), (1024, 320), (1024, H)],
    fill=(34, 31, 27),
)
draw.polygon(
    [(580, H), (740, 330), (850, 400), (1024, 350), (1024, H)],
    fill=(40, 36, 30),
)

# Logo links auf schwarzem Quadrat
LOGO_BOX = 420
LOGO_X, LOGO_Y = 40, (H - LOGO_BOX) // 2
draw.rectangle(
    [LOGO_X, LOGO_Y, LOGO_X + LOGO_BOX, LOGO_Y + LOGO_BOX],
    fill=(15, 13, 10),
)
logo = Image.open(LOGO).convert("RGBA")
logo = logo.resize((LOGO_BOX, LOGO_BOX), Image.LANCZOS)
img.paste(logo, (LOGO_X, LOGO_Y), logo)

# Text-Bereich rechts
TX = LOGO_X + LOGO_BOX + 50  # ~510
TY = 70

# Titel "Bergkönig" — Berg cream, könig gold
title_size = 78
f_title = font(PLAYFAIR, title_size)
berg = "Berg"
koenig = "könig"
draw.text((TX, TY), berg, font=f_title, fill=CREAM)
berg_w = draw.textlength(berg, font=f_title)
draw.text((TX + berg_w, TY), koenig, font=f_title, fill=GOLD)

# Untertitel — POLICY-KONFORM (kein "erste", kein Ranking-Wort)
f_sub = font(DMSANS, 22)
draw.text(
    (TX, TY + title_size + 8),
    "Das Gipfel-Spiel der Alpen.",
    font=f_sub,
    fill=MUTED,
)

# Bullets
f_bul = font(DMSANS, 22)
bullets = [
    "Sammle Gipfel",
    "Erkämpfe Kronen",
    "Erobere Gebiete",
    "Verteidige dein Reich",
]
by = TY + title_size + 60
for line in bullets:
    draw.ellipse([TX, by + 8, TX + 8, by + 16], fill=GOLD)
    draw.text((TX + 20, by), line, font=f_bul, fill=CREAM)
    by += 36

# Tagline "Strategie schlägt Tempo." (gold, Playfair italic-feel via Playfair regular)
f_tag = font(PLAYFAIR, 34)
tag_y = H - 80
draw.text((TX, tag_y), "Strategie schlägt Tempo.", font=f_tag, fill=GOLD)

# Compatibility-Zeile
f_compat = font(DMSANS, 15)
draw.text(
    (TX, H - 32),
    "Compatible with Strava  |  Suunto  |  GPX",
    font=f_compat,
    fill=SUBTLE,
)

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG", optimize=True)
print(f"OK -> {OUT}  ({OUT.stat().st_size//1024} KB)")
