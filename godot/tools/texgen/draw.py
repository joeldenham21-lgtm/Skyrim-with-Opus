"""Rasterisation on the torus with PIL: lines, polygons, ellipses drawn with wrap-around copies.

A Canvas holds a float ('F') or 8-bit ('L') PIL image of n x n. Every primitive is drawn at up to nine
offsets so shapes crossing an edge continue on the other side, which keeps every texture exactly tileable.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

F32 = np.float32


class Canvas:
    def __init__(self, n, mode="F", fill=0.0):
        self.n = n
        self.mode = mode
        self.im = Image.new(mode, (n, n), fill)
        self.d = ImageDraw.Draw(self.im)

    def _offsets(self, xs, ys, pad):
        n = self.n
        xmin, xmax = min(xs) - pad, max(xs) + pad
        ymin, ymax = min(ys) - pad, max(ys) + pad
        ox = [0]
        oy = [0]
        if xmin < 0:
            ox.append(n)
        if xmax >= n:
            ox.append(-n)
        if ymin < 0:
            oy.append(n)
        if ymax >= n:
            oy.append(-n)
        # shapes larger than the tile also need the double offsets
        if xmax - xmin > n:
            ox = [-n, 0, n]
        if ymax - ymin > n:
            oy = [-n, 0, n]
        return [(a, b) for a in ox for b in oy]

    def line(self, pts, value, width=1, joint=None):
        pts = [(float(x), float(y)) for x, y in pts]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for ox, oy in self._offsets(xs, ys, width):
            self.d.line([(x + ox, y + oy) for x, y in pts], fill=value, width=int(width), joint=joint)

    def polygon(self, pts, value, outline=None):
        pts = [(float(x), float(y)) for x, y in pts]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for ox, oy in self._offsets(xs, ys, 1):
            self.d.polygon([(x + ox, y + oy) for x, y in pts], fill=value, outline=outline)

    def ellipse(self, cx, cy, rx, ry, value):
        xs = [cx - rx, cx + rx]
        ys = [cy - ry, cy + ry]
        for ox, oy in self._offsets(xs, ys, 1):
            self.d.ellipse([cx - rx + ox, cy - ry + oy, cx + rx + ox, cy + ry + oy], fill=value)

    def rect(self, x0, y0, x1, y1, value):
        for ox, oy in self._offsets([x0, x1], [y0, y1], 1):
            self.d.rectangle([x0 + ox, y0 + oy, x1 + ox, y1 + oy], fill=value)

    def text(self, xy, s, font, value, anchor="la"):
        # text is drawn without wrap (callers keep it inside the tile)
        self.d.text(xy, s, font=font, fill=value, anchor=anchor)

    def array(self):
        a = np.asarray(self.im).astype(F32)
        if self.mode == "L":
            a = a / F32(255.0)
        return a


def font(size, bold=True, mono=False):
    cands = []
    if mono:
        cands += ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
    cands += ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf"]
    for c in cands:
        try:
            return ImageFont.truetype(c, int(size))
        except Exception:
            continue
    return ImageFont.load_default()


def stroke_field(n, lines, width, soft=1.0, value=1.0, taper=False):
    """Rasterise a list of polylines (arrays of (x,y)) into an (n,n) float mask with optional width taper."""
    c = Canvas(n, "F", 0.0)
    for pts in lines:
        if taper and len(pts) > 2:
            m = len(pts)
            for i in range(m - 1):
                w = max(1, int(round(width * (1.0 - 0.8 * i / m))))
                c.line(pts[i:i + 2], value, width=w)
        else:
            c.line(pts, value, width=max(1, int(round(width))))
    a = c.array()
    if soft > 0:
        from scipy import ndimage
        a = ndimage.gaussian_filter(a, soft, mode="wrap")
    return a.astype(F32)
