#!/usr/bin/env python3
"""Regenerate the PWA icons (build-time only, needs Pillow).

Draws a cream clock face on deep navy — matches the app theme.
Outputs icon-192/512.png (purpose "any") and icon-maskable-192/512.png
(face shrunk into the safe zone).
"""
import math
import os

from PIL import Image, ImageDraw

GOLD = (201, 162, 39)
CREAM = (247, 236, 212)
NAVY = (18, 23, 46)
INK = (18, 23, 46)


def draw_face(size, pad_ratio):
    img = Image.new("RGB", (size, size), NAVY)
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    r = size * (0.5 - pad_ratio)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=CREAM, outline=GOLD,
              width=max(4, int(size * 0.035)))
    # 12 hour marks; quarters longer/thicker
    for i in range(12):
        ang = math.radians(i * 30)
        r1 = r * (0.74 if i % 3 == 0 else 0.80)
        r2 = r * 0.90
        w = max(3, int(size * (0.028 if i % 3 == 0 else 0.014)))
        x1, y1 = cx + r1 * math.sin(ang), cy - r1 * math.cos(ang)
        x2, y2 = cx + r2 * math.sin(ang), cy - r2 * math.cos(ang)
        d.line([x1, y1, x2, y2], fill=INK, width=w)
    # hands at 10:10 (classic watch pose)
    def hand(ang_deg, length, width):
        ang = math.radians(ang_deg)
        x, y = cx + length * math.sin(ang), cy - length * math.cos(ang)
        d.line([cx, cy, x, y], fill=INK, width=width)
    hand(300, r * 0.52, max(6, int(size * 0.045)))
    hand(60, r * 0.72, max(5, int(size * 0.035)))
    dot = size * 0.03
    d.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=GOLD)
    return img


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), "icons")
    os.makedirs(out, exist_ok=True)
    for size in (512, 192):
        draw_face(size, 0.02).save(os.path.join(out, f"icon-{size}.png"))
        draw_face(size, 0.22).save(os.path.join(out, f"icon-maskable-{size}.png"))
    print("icons written to", out)


if __name__ == "__main__":
    main()
