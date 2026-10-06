#!/usr/bin/env python3
"""Generates the Manual J launcher icons (adaptive foreground, monochrome, legacy square/round) from one drawing.
Run: python3 scripts/make_icons.py   (needs Pillow). Output goes to android/app/src/main/res/mipmap-*/.
Design: warm dark ground (matches the app chrome), amber roof chevron over a bold white 'MJ'. Everything stays inside the
66dp adaptive-icon safe circle."""
from PIL import Image, ImageDraw, ImageFont
import os

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
BG = (31, 15, 8, 255); EMBER = (232, 89, 12, 255); AMBER = (245, 166, 35, 255); WHITE = (255, 255, 255, 255)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
S = 1728  # master canvas (108dp * 16)

def foreground(mono: bool = False) -> Image.Image:
    """108dp adaptive-icon foreground on a transparent canvas. mono=True -> single-colour silhouette for themed icons."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    u = S / 108.0                                   # px per dp
    cx = S / 2
    roof_col = WHITE if mono else AMBER; text_col = WHITE
    # roof chevron (peaked attic roof), stroke 5dp
    w = 5.6 * u; peak = (cx, 24 * u); left = (cx - 25 * u, 45 * u); right = (cx + 25 * u, 45 * u)
    d.line([left, peak, right], fill=roof_col, width=int(w), joint='curve')
    for pt in (left, peak, right): d.ellipse([pt[0] - w / 2, pt[1] - w / 2, pt[0] + w / 2, pt[1] + w / 2], fill=roof_col)
    # small ember flame-dot under the peak (identity touch)
    if not mono: d.ellipse([cx - 3.4 * u, 47 * u, cx + 3.4 * u, 53.8 * u], fill=EMBER)
    # "MJ"
    font = ImageFont.truetype(FONT, int(34 * u)); txt = 'MJ'
    bbox = d.textbbox((0, 0), txt, font=font); tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], 74 * u - th / 2 - bbox[1]), txt, font=font, fill=text_col)
    return fit_safe_zone(im)

def fit_safe_zone(im: Image.Image) -> Image.Image:
    """Centre the drawing and scale it so every drawn pixel lies inside the 66dp adaptive-icon safe circle."""
    small = im.resize((S // 8, S // 8), Image.BOX); a = small.split()[3]; bb = a.point(lambda v: 255 if v > 8 else 0).getbbox()
    cx = (bb[0] + bb[2]) / 2 * 8; cy = (bb[1] + bb[3]) / 2 * 8
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0)); layer.alpha_composite(im, (int(S / 2 - cx), int(S / 2 - cy)))
    sm = layer.resize((S // 8, S // 8), Image.BOX).split()[3].load(); c = S // 16; maxd = 0.0
    for y in range(S // 8):
        for x in range(S // 8):
            if sm[x, y] > 8: maxd = max(maxd, ((x - c) ** 2 + (y - c) ** 2) ** 0.5 * 8)
    limit = 33 * (S / 108.0) * 0.96; k = min(1.0, limit / maxd)
    if k < 1.0:
        n = int(S * k); scaled = layer.resize((n, n), Image.LANCZOS); layer = Image.new('RGBA', (S, S), (0, 0, 0, 0)); layer.alpha_composite(scaled, ((S - n) // 2, (S - n) // 2))
    print(f'safe-zone fit: scale {k:.3f}')
    return layer

def legacy(fg: Image.Image, px: int, round_: bool) -> Image.Image:
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ground = Image.new('RGBA', (S, S), BG)
    mask = Image.new('L', (S, S), 0); md = ImageDraw.Draw(mask)
    if round_: md.ellipse([0, 0, S - 1, S - 1], fill=255)
    else: md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.18), fill=255)
    base.paste(ground, (0, 0), mask); base.alpha_composite(fg)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.paste(base, (0, 0), mask)
    return out.resize((px, px), Image.LANCZOS)

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
fg, mono = foreground(), foreground(True)
for name, f in DENS.items():
    d = os.path.join(RES, f'mipmap-{name}'); os.makedirs(d, exist_ok=True)
    fg.resize((int(108 * f), int(108 * f)), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'), optimize=True)
    mono.resize((int(108 * f), int(108 * f)), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_monochrome.png'), optimize=True)
    legacy(fg, int(48 * f), False).save(os.path.join(d, 'ic_launcher.png'), optimize=True)
    legacy(fg, int(48 * f), True).save(os.path.join(d, 'ic_launcher_round.png'), optimize=True)
# preview sheet for review (not shipped)
sheet = Image.new('RGBA', (1200, 420), (240, 240, 240, 255)); sheet.alpha_composite(legacy(fg, 384, False), (10, 10)); sheet.alpha_composite(legacy(fg, 384, True), (410, 10))
adapt = Image.new('RGBA', (S, S), BG); adapt.alpha_composite(fg); circ = Image.new('L', (S, S), 0); ImageDraw.Draw(circ).ellipse([int(S * 0.1667), int(S * 0.1667), int(S * 0.8333), int(S * 0.8333)], fill=255)
masked = Image.new('RGBA', (S, S), (0, 0, 0, 0)); masked.paste(adapt, (0, 0), circ); sheet.alpha_composite(masked.resize((384, 384), Image.LANCZOS), (810, 10))
sheet.save(os.path.join(os.path.dirname(__file__), '..', '.icon-preview.png'))
print('icons written')
