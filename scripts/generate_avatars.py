#!/usr/bin/env python3
"""Generate the deterministic "stock" avatar pool — every identity has an avatar.

HIVE-1263 / operator 2026-08: all users & agents must have a valid avatar. This
script renders a pool of distinct, professional, on-brand 128x128 avatar PNGs
into ``frontend/public/avatars/stock/`` — nginx already serves ``/avatars``
statically, so the committed PNGs are immediately addressable at
``https://shizuha.com/avatars/stock/<n>.png``.

Output is byte-deterministic per index across runs (seeded purely by index), so
the committed pool is stable and simply extendable via ``--count``. The pool
size MUST match:

  * hive  ``hive/hive_project/avatars.py``  -> ``AVATAR_STOCK_SIZE``
  * id    ``id/identity/avatars.py``        -> ``STOCK_SIZE`` (default assignment)

Usage (from the home repo root):
    python3 scripts/generate_avatars.py [--count 160] \\
        [--out frontend/public/avatars/stock] [--size 128]

Dependencies: Pillow (python3 -m pip install Pillow).
"""
import argparse
import hashlib
import os
import random
import sys

from PIL import Image, ImageDraw

# Curated two-tone brand-family palettes: (bg_top, bg_bottom, head, accent).
# Muted and soft so the pool reads as one cohesive, professional cast.
PALETTES = [
    ("#6366f1", "#4338ca", "#312e81", "#c7d2fe"),  # indigo
    ("#818cf8", "#4f46e5", "#3730a3", "#e0e7ff"),
    ("#8b5cf6", "#6d28d9", "#4c1d95", "#ddd6fe"),  # violet
    ("#a78bfa", "#7c3aed", "#5b21b6", "#ede9fe"),
    ("#0ea5e9", "#0369a1", "#0c4a6e", "#bae6fd"),  # sky
    ("#38bdf8", "#0284c7", "#075985", "#e0f2fe"),
    ("#14b8a6", "#0f766e", "#134e4a", "#99f6e4"),  # teal
    ("#2dd4bf", "#0d9488", "#115e59", "#ccfbf1"),
    ("#10b981", "#047857", "#064e3b", "#a7f3d0"),  # emerald
    ("#34d399", "#059669", "#065f46", "#d1fae5"),
    ("#f59e0b", "#b45309", "#78350f", "#fde68a"),  # amber
    ("#fbbf24", "#d97706", "#92400e", "#fef3c7"),
    ("#f43f5e", "#be123c", "#881337", "#fecdd3"),  # rose
    ("#fb7185", "#e11d48", "#9f1239", "#ffe4e6"),
    ("#d946ef", "#a21caf", "#86198f", "#f5d0fe"),  # fuchsia
    ("#e879f9", "#c026d3", "#a21caf", "#fae8ff"),
    ("#64748b", "#334155", "#1e293b", "#cbd5e1"),  # slate
    ("#94a3b8", "#475569", "#0f172a", "#e2e8f0"),
]


def _hex(c):
    return tuple(int(c.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))


def _seed_rng(index):
    h = hashlib.sha256(f"shizuha-avatar-{index}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(h[:8], "big"))


def _draw_gradient(size, top, bottom):
    """Vertical two-color gradient image (RGBA)."""
    img = Image.new("RGB", (1, 1))
    img.putpixel((0, 0), top)
    px = Image.new("RGB", (size, size))
    data = []
    for y in range(size):
        t = y / (size - 1)
        row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        data.extend([row] * size)
    px.putdata(data)
    px = px.convert("RGBA")
    return px


def _rounded_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def render_avatar(index, size=128):
    """Render avatar ``index`` as a PIL RGBA image (deterministic)."""
    rng = _seed_rng(index)
    pal = PALETTES[index % len(PALETTES)]
    bg_top, bg_bottom = _hex(pal[0]), _hex(pal[1])
    head = _hex(pal[2])
    accent = _hex(pal[3])

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = _draw_gradient(size, bg_top, bg_bottom)

    draw = ImageDraw.Draw(bg)
    inset = 4
    radius = size // 6
    _rounded_rect(
        draw,
        [inset, inset, size - inset, size - inset],
        radius,
        fill=None,
        outline=accent + (80,),
        width=3,
    )

    # Faint honeycomb dots (subtle texture, on-brand) on the background.
    dot_alpha = 26
    for cx, cy in [(size * 0.22, size * 0.2), (size * 0.78, size * 0.2), (size * 0.5, size * 0.12), (size * 0.22, size * 0.8), (size * 0.78, size * 0.8)]:
        draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=accent + (dot_alpha,))

    canvas.alpha_composite(bg)

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Bot head.
    head_y0, head_y1 = int(size * 0.30), int(size * 0.82)
    eye_y = int(size * 0.50)
    mouth_y = int(size * 0.68)
    head_alpha = 210
    if rng.random() < 0.5:
        _rounded_rect(
            draw,
            [size * 0.24, head_y0, size * 0.76, head_y1],
            radius=size * 0.10,
            fill=head + (head_alpha,),
        )
    else:
        draw.ellipse([size * 0.24, head_y0, size * 0.76, head_y1], fill=head + (head_alpha,))

    # Antenna on top (half the time).
    if rng.random() < 0.5:
        ax = int(size * (0.5 if rng.random() < 0.7 else (0.38 if rng.random() < 0.5 else 0.62)))
        draw.line([ax, head_y0 + size * 0.02, ax, head_y0 - size * 0.09], fill=accent + (255,), width=4)
        draw.ellipse([ax - 5, head_y0 - size * 0.14, ax + 5, head_y0 - size * 0.06], fill=accent + (255,))

    # Eyes.
    eye_r = int(size * 0.045)
    eye_dx = int(size * 0.155)
    eye_cx = size * 0.5
    e1 = (int(eye_cx - eye_dx), eye_y)
    e2 = (int(eye_cx + eye_dx), eye_y)
    eye_fill = (255, 255, 255, 235) if rng.random() < 0.8 else accent + (255,)
    for ex, ey in (e1, e2):
        draw.ellipse([ex - eye_r, ey - eye_r, ex + eye_r, ey + eye_r], fill=eye_fill)

    # Visor / goggles (half the time): rounded band across the eyes.
    if rng.random() < 0.5:
        band_inset = int(size * 0.02)
        draw.rounded_rectangle(
            [e1[0] - eye_r - band_inset, eye_y - eye_r - band_inset, e2[0] + eye_r + band_inset, eye_y + eye_r + band_inset],
            radius=eye_r + band_inset,
            fill=accent + (60,),
            outline=accent + (235,),
            width=3,
        )
        for ex, ey in (e1, e2):
            draw.ellipse([ex - eye_r, ey - eye_r, ex + eye_r, ey + eye_r], fill=eye_fill)

    # Mouth.
    mouth_style = rng.randrange(3)
    mx = size * 0.5
    if mouth_style == 0:  # smile arc
        draw.arc([mx - size * 0.09, mouth_y - size * 0.03, mx + size * 0.09, mouth_y + size * 0.09], start=10, end=170, fill=accent + (255,), width=4)
    elif mouth_style == 1:  # straight
        draw.line([mx - size * 0.08, mouth_y + 2, mx + size * 0.08, mouth_y + 2], fill=accent + (255,), width=4)
    else:  # open (small rect)
        _rounded_rect(draw, [mx - size * 0.06, mouth_y, mx + size * 0.06, mouth_y + size * 0.07], radius=4, fill=accent + (255,))

    # Cheeks (soft blush) half the time.
    if rng.random() < 0.5:
        blush_alpha = 150
        cy = int(mouth_y * 0.92)
        r = int(size * 0.035)
        draw.ellipse([int(size * 0.245) - r, cy - r, int(size * 0.245) + r, cy + r], fill=accent + (blush_alpha,))
        draw.ellipse([int(size * 0.755) - r, cy - r, int(size * 0.755) + r, cy + r], fill=accent + (blush_alpha,))

    # Headset ears (quarter of the time).
    if rng.random() < 0.25:
        er = int(size * 0.05)
        for side in (size * 0.19, size * 0.81):
            draw.ellipse([side - er, eye_y - er, side + er, eye_y + er], fill=accent + (235,))
            draw.ellipse([side - er // 2, eye_y - er // 2, side + er // 2, eye_y + er // 2], fill=head + (255,))

    return canvas


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--count", type=int, default=160)
    ap.add_argument("--size", type=int, default=128)
    ap.add_argument("--out", default="frontend/public/avatars/stock")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    written = 0
    for i in range(args.count):
        img = render_avatar(i, size=args.size)
        path = os.path.join(args.out, f"{i:03d}.png")
        img.save(path, "PNG")
        written += 1
    print(f"wrote {written} avatars -> {os.path.abspath(args.out)}/000..{args.count-1:03d}.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
