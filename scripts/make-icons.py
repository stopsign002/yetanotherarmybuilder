#!/usr/bin/env python3
"""Rasterise the YAAB crest (app/img/icon-512.svg) into the PNGs Chrome wants.

    python3 scripts/make-icons.py

WHY THIS EXISTS. Chrome will not offer "Install app" without a raster icon of at
least 192px, and on Android it downloads and hashes that raster to mint a real
WebAPK -- with SVG-only icons it falls back to a legacy home-screen shortcut,
which looks installed but runs in an older container where things like
env(safe-area-inset-bottom) silently stop applying. app/img/ held only SVGs.

There is no SVG toolchain on this host (no rsvg-convert, inkscape, imagemagick
or cairosvg -- only PIL), and the crest is four elements, so it is drawn
directly. icon-512.svg remains the design source of truth: if you change the
artwork, change it there and mirror the numbers below. Everything is drawn at
SS x scale and downsampled with LANCZOS, which is where the antialiasing comes
from.

Three variants, because they are genuinely different pictures:
  * "any"      -- the crest at full size, matching icon-512.svg exactly.
  * "maskable" -- Android applies its own mask (circle, squircle, teardrop...)
                  and may clip up to 10% off every edge. The crest's corners sit
                  at radius 241 from centre and the mask circle is radius 204.8,
                  so at full size all four shoulders get cut. Scaling the whole
                  mark to 0.8 about the centre puts the extreme point at 193 --
                  inside the safe zone -- with no redraw.
  * apple      -- full size (iOS's squircle is far more generous than Android's
                  circle; the crest's extreme point at (100,72) sits inside it),
                  but flattened to RGB because iOS composites transparency onto
                  black.

NEVER ship one file as `"purpose": "any maskable"`. That tells the launcher to
use the same art both masked and unmasked, so it gets clipped in the masked
context -- which is the bug this script exists to fix.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SS = 8                        # supersample factor
VB = 512.0                    # source viewBox
DARK = (0x0D, 0x0D, 0x0D)
GOLD = (0xE8, 0xC8, 0x6A)

# Straight from icon-512.svg. The crest outline is a closed path with two
# quadratic Beziers along the bottom; `Q` entries carry (control, end).
CREST = [
    ('M', (256, 72)),
    ('L', (412, 136)),
    ('L', (412, 272)),
    ('Q', (412, 372), (256, 444)),
    ('Q', (100, 372), (100, 272)),
    ('L', (100, 136)),
]
CREST_STROKE = 14

PENTAGON = [(256, 160), (336, 216), (304, 320), (208, 320), (176, 216)]

DIVIDER = [(256, 160), (256, 404)]
DIVIDER_STROKE = 10

BEZIER_STEPS = 32             # flattening resolution for each quadratic


def flatten(path):
    """Turn the SVG path above into a plain list of points.

    PIL has no curve primitive, so each quadratic is sampled. 32 steps is well
    past the point where the difference is visible even at SS x 512.
    """
    pts = []
    for seg in path:
        kind = seg[0]
        if kind in ('M', 'L'):
            pts.append(seg[1])
        elif kind == 'Q':
            (cx, cy), (ex, ey) = seg[1], seg[2]
            sx, sy = pts[-1]
            for i in range(1, BEZIER_STEPS + 1):
                t = i / BEZIER_STEPS
                u = 1 - t
                pts.append((u * u * sx + 2 * u * t * cx + t * t * ex,
                            u * u * sy + 2 * u * t * cy + t * t * ey))
    return pts


def render(size, *, maskable=False):
    """Draw one icon. `maskable` shrinks the mark into Android's safe zone."""
    S = size * SS
    img = Image.new('RGBA', (S, S), DARK + (255,))
    d = ImageDraw.Draw(img)

    # Full bleed either way -- the SVG's background is a plain square, so there
    # are no pre-rounded corners for a launcher mask to cut twice.
    scale = (S / VB) * (0.8 if maskable else 1.0)
    off = S * 0.1 if maskable else 0.0

    def pt(p):
        return (off + p[0] * scale, off + p[1] * scale)

    # 1. Crest outline. stroke-linejoin="round" -> joint='curve'. Repeating the
    # first two points closes the path AND makes the apex an interior vertex,
    # so it gets the same rounded join as every other corner (PIL only rounds
    # interior ones). The duplicated segment is drawn twice in the same colour.
    crest = [pt(p) for p in flatten(CREST)]
    d.line(crest + crest[:2], fill=GOLD,
           width=max(1, round(CREST_STROKE * scale)), joint='curve')

    # 2. Filled pentagon.
    d.polygon([pt(p) for p in PENTAGON], fill=GOLD)

    # 3. Dark divider down the middle of it.
    d.line([pt(p) for p in DIVIDER], fill=DARK,
           width=max(1, round(DIVIDER_STROKE * scale)))

    return img.resize((size, size), Image.LANCZOS)


OUT = Path(__file__).resolve().parent.parent / 'img'
for size in (192, 512):
    render(size).save(OUT / f'icon-{size}.png')
    print(f'icon-{size}.png')
    render(size, maskable=True).save(OUT / f'icon-{size}-maskable.png')
    print(f'icon-{size}-maskable.png')
# apple-touch-icon: no alpha channel (iOS renders transparency as black).
render(180).convert('RGB').save(OUT / 'icon-180.png')
print('icon-180.png')
