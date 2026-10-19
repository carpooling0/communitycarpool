#!/usr/bin/env python3
"""
Community Carpool branded QR code (spec: memory project_qr_code_spec).

Dark green #186A3B, scattered square dots for the body, rounded-square eye
frames, solid square eye balls, two-pins logo in the centre on white.
Writes a PNG and an SVG. Used by new-partner.py, also runnable on its own:

    python3 scripts/qr_style.py "https://communitycarpool.org/?client=hixs" out/hixs
"""
import base64
import hashlib
import io
import os
import sys

import numpy as np
import qrcode  # pip install qrcode pillow numpy zxing-cpp
from PIL import Image, ImageDraw

GREEN = "#186A3B"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_SRC = os.path.join(ROOT, "logo-qr.png")
M = 40            # pixels per module
QUIET = 4         # quiet zone, in modules
LOGO_FRAC = 0.22  # logo width as a fraction of the code width (ECC H tolerates this)


def _logo():
    """Pins only: drop the soft glow baked into logo-qr.png, crop to the pins."""
    im = Image.open(LOGO_SRC).convert("RGBA")
    a = np.array(im).astype(float)
    a[..., 3] = np.clip((a[..., 3] - 200) / 55.0, 0, 1) * 255
    im = Image.fromarray(a.astype("uint8"), "RGBA")
    return im.crop(im.getchannel("A").getbbox())


def _jitter(r, c, salt):
    h = hashlib.md5(f"{r}:{c}:{salt}".encode()).digest()[0] / 255.0
    return h


def build(url):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=0, box_size=1)
    qr.add_data(url)
    qr.make(fit=True)
    grid = qr.get_matrix()
    n = len(grid)
    size = (n + 2 * QUIET) * M

    # Logo geometry and clear zone (in modules)
    logo = _logo()
    lw = n * LOGO_FRAC
    lh = lw * logo.height / logo.width
    cx = cy = n / 2
    pad = 0.7  # white margin around the logo, in modules
    clear = (cx - lw / 2 - pad, cy - lh / 2 - pad, cx + lw / 2 + pad, cy + lh / 2 + pad)

    def in_finder(r, c):
        return (r < 7 and c < 7) or (r < 7 and c >= n - 7) or (r >= n - 7 and c < 7)

    shapes = []  # ("rect"|"rrect"|"ring", x, y, w, h, radius, stroke)
    for r in range(n):
        for c in range(n):
            if not grid[r][c] or in_finder(r, c):
                continue
            if clear[0] - 0.5 < c + 0.5 < clear[2] + 0.5 and clear[1] - 0.5 < r + 0.5 < clear[3] + 0.5:
                continue
            s = 0.74 + 0.22 * _jitter(r, c, "s")           # dot size 74 to 96 percent of the cell
            room = 1 - s
            dx = (_jitter(r, c, "x") - 0.5) * room         # stays inside its own cell
            dy = (_jitter(r, c, "y") - 0.5) * room
            shapes.append(("rect", c + room / 2 + dx, r + room / 2 + dy, s, s, 0, 0))
    for (r0, c0) in [(0, 0), (0, n - 7), (n - 7, 0)]:
        # rounded-square frame, one module thick; corner radius capped at 1.2 because
        # rounder frames (2.0) stopped the code from scanning in tests
        shapes.append(("ring", c0, r0, 7, 7, 1.2, 1))
        shapes.append(("rect", c0 + 2, r0 + 2, 3, 3, 0, 0))  # solid square ball

    return n, size, shapes, logo, lw, lh


def render(url, out_base):
    n, size, shapes, logo, lw, lh = build(url)
    S = 2  # supersample
    img = Image.new("RGB", (size * S, size * S), "white")
    d = ImageDraw.Draw(img)
    px = lambda v: (v + QUIET) * M * S
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           f'viewBox="0 0 {size} {size}" width="{size}" height="{size}">',
           f'<rect width="{size}" height="{size}" fill="#fff"/>', f'<g fill="{GREEN}">']
    for kind, x, y, w, h, rad, _ in shapes:
        X, Y = (x + QUIET) * M, (y + QUIET) * M
        if kind == "rect":
            d.rectangle([px(x), px(y), px(x + w) - 1, px(y + h) - 1], fill=GREEN)
            svg.append(f'<rect x="{X:.2f}" y="{Y:.2f}" width="{w*M:.2f}" height="{h*M:.2f}"/>')
        else:  # ring: outer rounded square minus inner rounded square
            d.rounded_rectangle([px(x), px(y), px(x + w) - 1, px(y + h) - 1], radius=rad * M * S, fill=GREEN)
            d.rounded_rectangle([px(x + 1), px(y + 1), px(x + w - 1) - 1, px(y + h - 1) - 1],
                                radius=(rad - 0.8) * M * S, fill="white")
            o, i = rad * M, (rad - 0.8) * M
            svg.append(
                f'<path fill-rule="evenodd" d="{_rrect(X, Y, w*M, h*M, o)} {_rrect(X+M, Y+M, (w-2)*M, (h-2)*M, i)}"/>')
    svg.append("</g>")

    # Logo on a white rounded plate
    lx, ly = (n / 2 - lw / 2), (n / 2 - lh / 2)
    plate = 0.45
    d.rounded_rectangle([px(lx - plate), px(ly - plate), px(lx + lw + plate), px(ly + lh + plate)],
                        radius=0.8 * M * S, fill="white")
    lg = logo.resize((int(lw * M * S), int(lh * M * S)), Image.LANCZOS)
    img.paste(lg, (int(px(lx)), int(px(ly))), lg)
    buf = io.BytesIO()
    logo.resize((int(lw * M), int(lh * M)), Image.LANCZOS).save(buf, "PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    svg.append(f'<rect x="{(lx-plate+QUIET)*M:.2f}" y="{(ly-plate+QUIET)*M:.2f}" '
               f'width="{(lw+2*plate)*M:.2f}" height="{(lh+2*plate)*M:.2f}" rx="{0.8*M}" fill="#fff"/>')
    svg.append(f'<image x="{(lx+QUIET)*M:.2f}" y="{(ly+QUIET)*M:.2f}" width="{lw*M:.2f}" height="{lh*M:.2f}" '
               f'xlink:href="data:image/png;base64,{b64}"/>')
    svg.append("</svg>")

    img = img.resize((size, size), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(out_base)), exist_ok=True)
    img.save(out_base + ".png", dpi=(300, 300))
    with open(out_base + ".svg", "w") as f:
        f.write("\n".join(svg))
    return out_base + ".png", out_base + ".svg"


def _rrect(x, y, w, h, r):
    return (f"M{x+r:.2f},{y:.2f}H{x+w-r:.2f}A{r:.2f},{r:.2f} 0 0 1 {x+w:.2f},{y+r:.2f}V{y+h-r:.2f}"
            f"A{r:.2f},{r:.2f} 0 0 1 {x+w-r:.2f},{y+h:.2f}H{x+r:.2f}A{r:.2f},{r:.2f} 0 0 1 {x:.2f},{y+h-r:.2f}"
            f"V{y+r:.2f}A{r:.2f},{r:.2f} 0 0 1 {x+r:.2f},{y:.2f}Z")


def verify(png_path, expected):
    """Decode the PNG back at three sizes, the way a phone camera would see it.

    Uses ZXing (pip install zxing-cpp), a good stand-in for phone scanners. OpenCV's
    decoders are not used: they reject styled finder patterns that phones read fine
    and give erratic results at arbitrary scales.
    """
    import zxingcpp
    im = Image.open(png_path).convert("RGB")
    got = ""
    for w in (im.width, 600, 300):
        x = im if w == im.width else im.resize((w, w), Image.LANCZOS)
        res = zxingcpp.read_barcodes(x)
        got = res[0].text if res else ""
        if got != expected:
            return False, got
    return True, got


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    p, s = render(sys.argv[1], sys.argv[2])
    ok, got = verify(p, sys.argv[1])
    print(p, s, "scan check:", "OK" if ok else f"FAILED (read {got!r})")
