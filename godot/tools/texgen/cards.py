"""Alpha-cut foliage card atlases.

Every card is drawn as real botany: blades, needles, leaves and twigs are individual tapered polygons with
per-element colour, depth ordering and a rounded cross-section, not a noise field with a cutout. Three atlases
are written to assets/textures/cards/:

  grass_*      2 x 4 cells of 1024 x 512 — grass blade clusters in four colour states, two variants each
  branches_*   2 x 2 cells of 1024 — pine, spruce, birch (leaves), dead branch
  plants_*     2 x 2 cells of 1024 — bush, fern, reeds, leaf litter

Each atlas ships albedo (RGBA, colour bled into the transparent margin so mips stay clean), normal (OpenGL Y+),
orm (R occlusion, G roughness, B metallic) and a separate greyscale alpha map. Rectangles are documented in
cards/atlas.json.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from . import maps as M
from . import noise as N

F32 = np.float32


# ------------------------------------------------------------------ tile canvas

class Tile:
    """A single card cell. Elements are drawn back to front; `depth` orders them and drives the height stack."""

    def __init__(self, w, h, ss=2):
        self.w, self.h, self.ss = w, h, ss
        self.rgb = Image.new("RGB", (w * ss, h * ss), (0, 0, 0))
        self.dep = Image.new("F", (w * ss, h * ss), 0.0)
        self.rgh = Image.new("F", (w * ss, h * ss), 0.0)
        self._d_rgb = ImageDraw.Draw(self.rgb)
        self._d_dep = ImageDraw.Draw(self.dep)
        self._d_rgh = ImageDraw.Draw(self.rgh)

    def poly(self, pts, col, depth, rough):
        s = self.ss
        p = [(float(x) * s, float(y) * s) for x, y in pts]
        if len(p) < 3:
            return
        self._d_rgb.polygon(p, fill=(int(np.clip(col[0], 0, 1) * 255), int(np.clip(col[1], 0, 1) * 255),
                                     int(np.clip(col[2], 0, 1) * 255)))
        self._d_dep.polygon(p, fill=float(depth))
        self._d_rgh.polygon(p, fill=float(rough))

    def line(self, pts, col, width, depth, rough):
        s = self.ss
        p = [(float(x) * s, float(y) * s) for x, y in pts]
        w = max(1, int(round(width * s)))
        c = (int(np.clip(col[0], 0, 1) * 255), int(np.clip(col[1], 0, 1) * 255), int(np.clip(col[2], 0, 1) * 255))
        self._d_rgb.line(p, fill=c, width=w, joint="curve")
        self._d_dep.line(p, fill=float(depth), width=w, joint="curve")
        self._d_rgh.line(p, fill=float(rough), width=w, joint="curve")

    def ellipse(self, cx, cy, rx, ry, col, depth, rough):
        s = self.ss
        box = [(cx - rx) * s, (cy - ry) * s, (cx + rx) * s, (cy + ry) * s]
        c = (int(np.clip(col[0], 0, 1) * 255), int(np.clip(col[1], 0, 1) * 255), int(np.clip(col[2], 0, 1) * 255))
        self._d_rgb.ellipse(box, fill=c)
        self._d_dep.ellipse(box, fill=float(depth))
        self._d_rgh.ellipse(box, fill=float(rough))

    def resolve(self):
        """-> rgb (h,w,3) premultiplied, cov (h,w), depth (h,w), rough (h,w) at card resolution."""
        s = self.ss
        rgb = np.asarray(self.rgb, dtype=F32) / F32(255.0)
        dep = np.asarray(self.dep, dtype=F32)
        rgh = np.asarray(self.rgh, dtype=F32)
        cov = (dep > 0).astype(F32)
        if s > 1:
            h, w = self.h, self.w
            rgb = rgb.reshape(h, s, w, s, 3).mean(axis=(1, 3))
            cov = cov.reshape(h, s, w, s).mean(axis=(1, 3))
            dep = dep.reshape(h, s, w, s).max(axis=(1, 3))
            rgh = rgh.reshape(h, s, w, s).max(axis=(1, 3))
        return rgb.astype(F32), cov.astype(F32), dep.astype(F32), rgh.astype(F32)


def _unpremul(rgb, cov):
    out = np.zeros_like(rgb)
    m = cov > 1e-4
    for c in range(3):
        out[..., c] = np.where(m, rgb[..., c] / np.maximum(cov, 1e-4), 0.0)
    return np.clip(out, 0, 1).astype(F32)


def _bleed(rgb, cov, thresh=0.02):
    """Push colour outwards into transparent pixels (nearest opaque) so filtering never fetches black."""
    solid = cov > thresh
    if not solid.any():
        return rgb
    _, idx = ndimage.distance_transform_edt(~solid, return_indices=True)
    return rgb[idx[0], idx[1]].astype(F32)


def _card_maps(rgb_pm, cov, dep, rgh, radius=3.0, ao_blur=24.0, depth_h=0.55):
    """Turn a resolved tile into (albedo, alpha, normal, orm, height)."""
    alpha = np.clip(cov, 0, 1)
    albedo = _bleed(_unpremul(rgb_pm, cov), cov)
    # cross-section: distance inside the silhouette gives every blade/leaf a rounded body
    d = ndimage.distance_transform_edt(cov > 0.35).astype(F32)
    bulge = np.sqrt(np.clip(d / radius, 0.0, 1.0)).astype(F32)
    height = np.clip(dep * depth_h + bulge * (1.0 - depth_h), 0.0, 1.0) * (cov > 0.2)
    strength = 6.0
    nrm = M.normal_from_height(height, strength)
    flat = np.array([0.5, 0.5, 1.0], F32)
    fade = np.clip(cov * 1.6, 0, 1)[..., None]
    nrm = nrm * fade + flat[None, None, :] * (1.0 - fade)
    dens = ndimage.gaussian_filter(alpha, ao_blur)
    ao = np.clip(1.0 - 0.62 * dens * (1.0 - dep * 0.65), 0.18, 1.0)
    ao *= np.clip(0.55 + 0.55 * dep, 0.0, 1.0)
    rough = np.where(cov > 0.2, np.clip(rgh, 0.05, 1.0), 0.9)
    orm = np.stack([np.clip(ao, 0, 1), rough, np.zeros_like(ao)], axis=-1)
    return albedo, alpha, nrm, orm.astype(F32), height


# ------------------------------------------------------------------ botany primitives

def _spine(x0, y0, ang, length, bend, gravity=0.0, seg=14):
    """Curved stem: heading turns by `bend` over the length plus a gravity term that grows with arc length."""
    pts = [(x0, y0)]
    x, y, a = x0, y0, ang
    step = length / seg
    for i in range(seg):
        t = (i + 1) / seg
        a = ang + bend * t * t + gravity * t * t * t
        x += np.cos(a) * step
        y += np.sin(a) * step
        pts.append((x, y))
    return pts


def _strip(tile, pts, w0, w1, col0, col1, depth, rough, taper=1.6, crease=None):
    """Tapered ribbon along a polyline with a colour gradient; optional lighter crease line down the middle."""
    n = len(pts) - 1
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        dx, dy = bx - ax, by - ay
        L = max(1e-5, np.hypot(dx, dy))
        px, py = -dy / L, dx / L
        wa = (w0 + (w1 - w0) * (t0 ** taper)) * 0.5
        wb = (w0 + (w1 - w0) * (t1 ** taper)) * 0.5
        col = tuple(col0[k] + (col1[k] - col0[k]) * (0.5 * (t0 + t1)) for k in range(3))
        tile.poly([(ax + px * wa, ay + py * wa), (bx + px * wb, by + py * wb),
                   (bx - px * wb, by - py * wb), (ax - px * wa, ay - py * wa)], col, depth, rough)
    if crease is not None and n > 2:
        tile.line(pts[:-1], crease, max(1.0, w0 * 0.18), depth + 0.004, rough * 0.9)


def _leaf_outline(length, width, teeth=9, tooth=0.055, tip=0.75, base=0.62, seg=26):
    """Ovate serrated leaf in local coords (0,0)=petiole join, +x = toward the tip."""
    up, dn = [], []
    for i in range(seg + 1):
        t = i / seg
        prof = np.sin(np.pi * (t ** base)) ** tip
        w = width * 0.5 * prof
        w *= 1.0 + tooth * np.sin(t * np.pi * 2 * teeth)
        x = t * length
        up.append((x, -w))
        dn.append((x, w))
    return up + dn[::-1]


def _place(pts, x, y, ang, flip=1.0):
    c, s = np.cos(ang), np.sin(ang)
    return [(x + px * c - py * flip * s, y + px * s + py * flip * c) for px, py in pts]


def _leaf(tile, x, y, ang, length, width, col, vein, depth, rough, teeth=9, flip=1.0, shade=1.0,
          tip=0.75, base=0.62, tooth=0.055, petiole=None):
    body = _place(_leaf_outline(length, width, teeth, tooth, tip, base), x, y, ang, flip)
    c = tuple(min(1.0, v * shade) for v in col)
    tile.poly(body, c, depth, rough)
    # midrib and laterals
    mid = [(x, y), (x + np.cos(ang) * length, y + np.sin(ang) * length)]
    tile.line(mid, vein, max(1.0, width * 0.06), depth + 0.006, rough)
    for k in range(1, 6):
        t = k / 6.0
        w = width * 0.5 * (np.sin(np.pi * (t ** base)) ** tip)
        for sgn in (-1.0, 1.0):
            a = ang + sgn * flip * 0.75
            bx = x + np.cos(ang) * t * length
            by = y + np.sin(ang) * t * length
            ex = bx + np.cos(a) * w * 1.5
            ey = by + np.sin(a) * w * 1.5
            tile.line([(bx, by), (ex, ey)], vein, max(1.0, width * 0.035), depth + 0.005, rough)
    if petiole is not None:
        tile.line([(x - np.cos(ang) * length * 0.16, y - np.sin(ang) * length * 0.16), (x, y)],
                  petiole, max(1.0, width * 0.08), depth - 0.004, 0.85)


def _needle_fan(tile, r, x, y, ang, count, length, width, cols, depth, rough, spread=1.1, curve=0.5):
    for i in range(count):
        a = ang + r.uniform(-spread, spread)
        ln = length * r.uniform(0.7, 1.15)
        col = cols[r.integers(0, len(cols))]
        sh = r.uniform(0.75, 1.15)
        c0 = tuple(v * sh * 0.85 for v in col)
        c1 = tuple(min(1.0, v * sh * 1.1) for v in col)
        pts = _spine(x, y, a, ln, r.uniform(-curve, curve), seg=5)
        _strip(tile, pts, width * r.uniform(0.8, 1.25), width * 0.25, c0, c1, depth + r.uniform(-0.03, 0.03), rough)


# ------------------------------------------------------------------ cards

GRASS_STATES = [
    ("green", (0.148, 0.196, 0.108), (0.300, 0.360, 0.190), (0.36, 0.33, 0.18), 0.10, 0.72),
    ("olive", (0.170, 0.196, 0.128), (0.345, 0.375, 0.228), (0.40, 0.35, 0.20), 0.24, 0.76),
    ("dry", (0.230, 0.216, 0.128), (0.470, 0.430, 0.250), (0.46, 0.39, 0.24), 0.52, 0.84),
    ("dead", (0.235, 0.196, 0.140), (0.430, 0.380, 0.280), (0.40, 0.33, 0.23), 0.88, 0.90),
]


def grass_cell(w, h, seed, state, dense=1.0):
    name, base, tip, dry, dead_f, rough = state
    r = N.rng_for(seed)
    t = Tile(w, h, ss=2)
    count = int(430 * dense)
    # a few broad dead leaves lying at the back
    for i in range(int(18 * dense)):
        x = r.uniform(0, w)
        y = h - r.uniform(0, h * 0.10)
        a = -np.pi / 2 + r.uniform(-1.2, 1.2)
        ln = r.uniform(0.25, 0.55) * h
        c0 = tuple(v * r.uniform(0.55, 0.8) for v in dry)
        _strip(t, _spine(x, y, a, ln, r.uniform(-1.0, 1.0), gravity=r.uniform(0.4, 1.4), seg=9),
               r.uniform(5, 9), 1.5, c0, tuple(v * 1.15 for v in c0), 0.12 + r.uniform(0, 0.06), rough)
    for i in range(count):
        depth_layer = i / count                       # back to front
        x = r.uniform(-w * 0.02, w * 1.02)
        y = h - r.uniform(0.0, h * 0.06)
        lean = r.normal(0, 0.42)
        a = -np.pi / 2 + lean
        ln = r.uniform(0.34, 0.98) * h * (0.72 + 0.5 * depth_layer)
        wd = r.uniform(3.4, 7.4) * (w / 1024.0)
        grav = np.sign(lean if abs(lean) > 0.05 else r.normal()) * r.uniform(0.5, 2.3) * (ln / h)
        is_dead = r.random() < dead_f
        shade = 0.52 + 0.48 * depth_layer             # back rows sit in shadow
        if is_dead:
            c0 = tuple(v * shade * r.uniform(0.8, 1.1) for v in dry)
            c1 = tuple(min(1.0, v * 1.35 * r.uniform(0.85, 1.15)) for v in c0)
        else:
            k = r.uniform(0.75, 1.2)
            c0 = tuple(v * shade * k for v in base)
            c1 = tuple(min(1.0, v * shade * k * r.uniform(0.9, 1.15)) for v in tip)
            if r.random() < 0.45:                     # dry tip
                c1 = tuple(c1[j] * 0.55 + dry[j] * 0.75 * shade for j in range(3))
        crease = tuple(min(1.0, v * 1.35) for v in c1) if r.random() < 0.6 else None
        _strip(t, _spine(x, y, a, ln, r.uniform(-0.35, 0.35), gravity=grav, seg=12),
               wd, wd * 0.18, c0, c1, 0.18 + 0.8 * depth_layer, rough * r.uniform(0.9, 1.1), crease=crease)
        if r.random() < 0.06:                         # broken blade: snapped tip hanging
            bx, by = _spine(x, y, a, ln * 0.62, 0.0, gravity=grav, seg=4)[-1]
            _strip(t, _spine(bx, by, a + r.uniform(1.0, 2.2), ln * 0.3, 0.4, gravity=1.6, seg=5),
                   wd * 0.8, 1.0, tuple(v * 0.8 for v in dry), dry, 0.18 + 0.8 * depth_layer, rough)
    # seed heads on the tallest state
    if name in ("dry", "dead"):
        for i in range(int(9 * dense)):
            x = r.uniform(0, w)
            y = h - r.uniform(0, h * 0.05)
            a = -np.pi / 2 + r.normal(0, 0.3)
            ln = r.uniform(0.75, 0.98) * h
            sp = _spine(x, y, a, ln, r.uniform(-0.2, 0.2), gravity=r.uniform(-0.6, 0.6), seg=10)
            _strip(t, sp, 2.6, 1.4, tuple(v * 0.8 for v in dry), dry, 0.9, rough)
            hx, hy = sp[-1]
            for k in range(26):
                aa = a + r.uniform(-0.5, 0.5)
                _strip(t, _spine(hx + r.uniform(-4, 4), hy + r.uniform(-6, 22), aa, r.uniform(14, 34),
                                 r.uniform(-0.6, 0.6), seg=3), 2.4, 0.8,
                       tuple(v * 0.75 for v in dry), tuple(min(1, v * 1.25) for v in dry), 0.93, rough)
    return t


def pine_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    wood = (0.155, 0.115, 0.082)
    wood2 = (0.235, 0.180, 0.128)
    needles = [(0.118, 0.170, 0.118), (0.145, 0.196, 0.130), (0.098, 0.145, 0.108), (0.180, 0.205, 0.135)]
    dead_n = [(0.320, 0.240, 0.140), (0.260, 0.185, 0.110)]
    y0 = n * 0.5
    main = _spine(-n * 0.02, y0 + n * 0.16, -0.16, n * 1.02, -0.10, seg=14)
    _strip(t, main, n * 0.055, n * 0.012, wood, wood2, 0.30, 0.88)
    # side branches with needle fans at every twig tip
    for i, tt in enumerate(np.linspace(0.16, 0.97, 9)):
        bx, by = main[int(tt * (len(main) - 1))]
        for sgn in (-1.0, 1.0):
            if r.random() < 0.12:
                continue
            a = -0.16 + sgn * r.uniform(0.55, 1.05)
            ln = n * r.uniform(0.16, 0.34) * (1.05 - tt * 0.45)
            sp = _spine(bx, by, a, ln, sgn * r.uniform(0.1, 0.4), seg=8)
            dep = 0.35 + 0.3 * r.random()
            _strip(t, sp, n * 0.020, n * 0.006, wood, wood2, dep, 0.88)
            for k in np.linspace(0.35, 1.0, 4):
                px, py = sp[int(k * (len(sp) - 1))]
                _needle_fan(t, r, px, py, a + sgn * r.uniform(-0.3, 0.3), 26,
                            n * r.uniform(0.10, 0.15), n * 0.0055, needles, 0.55 + 0.4 * r.random(), 0.55,
                            spread=1.05, curve=0.55)
            if r.random() < 0.3:
                px, py = sp[-1]
                _needle_fan(t, r, px, py, a, 9, n * 0.09, n * 0.005, dead_n, 0.5, 0.85, spread=1.3, curve=0.7)
    # terminal candle
    ex, ey = main[-1]
    _needle_fan(t, r, ex, ey, -0.16, 46, n * 0.16, n * 0.006, needles, 0.92, 0.55, spread=1.4, curve=0.5)
    # two cones
    for _ in range(2):
        cx, cy = r.uniform(n * 0.35, n * 0.8), r.uniform(n * 0.25, n * 0.75)
        ca = r.uniform(0, np.pi * 2)
        for s in range(9):
            u = s / 8.0
            rr = n * 0.022 * np.sin(np.pi * (0.25 + u * 0.75))
            t.ellipse(cx + np.cos(ca) * u * n * 0.06, cy + np.sin(ca) * u * n * 0.06, rr, rr * 0.8,
                      (0.175 + 0.06 * u, 0.115 + 0.04 * u, 0.070), 0.75, 0.8)
    return t


def spruce_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    wood = (0.130, 0.098, 0.075)
    needles = [(0.075, 0.125, 0.098), (0.098, 0.150, 0.110), (0.060, 0.100, 0.082), (0.130, 0.165, 0.115)]
    main = _spine(-n * 0.02, n * 0.30, 0.06, n * 1.03, 0.10, seg=14)
    _strip(t, main, n * 0.042, n * 0.010, wood, (0.20, 0.155, 0.115), 0.30, 0.88)
    for tt in np.linspace(0.10, 0.98, 12):
        bx, by = main[int(tt * (len(main) - 1))]
        for sgn in (-1.0, 1.0):
            a = 0.06 + sgn * r.uniform(0.5, 1.0)
            ln = n * r.uniform(0.14, 0.30) * (1.1 - tt * 0.5)
            sp = _spine(bx, by, a, ln, sgn * r.uniform(0.2, 0.6), gravity=sgn * 0.5, seg=8)
            dep = 0.35 + 0.35 * r.random()
            _strip(t, sp, n * 0.014, n * 0.004, wood, (0.19, 0.145, 0.108), dep, 0.88)
            # needles all around the branchlet, short and dense
            for k in range(len(sp) - 1):
                px, py = sp[k]
                for _ in range(9):
                    aa = a + r.choice([-1.0, 1.0]) * r.uniform(0.5, 1.5)
                    ln2 = n * r.uniform(0.028, 0.052)
                    col = needles[r.integers(0, len(needles))]
                    sh = r.uniform(0.8, 1.2)
                    _strip(t, _spine(px + r.uniform(-3, 3), py + r.uniform(-3, 3), aa, ln2,
                                     r.uniform(-0.4, 0.4), seg=3),
                           n * 0.0048, n * 0.0012, tuple(v * sh * 0.85 for v in col),
                           tuple(min(1, v * sh * 1.15) for v in col), dep + r.uniform(0.0, 0.25), 0.55)
    return t


def birch_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    bark = (0.560, 0.545, 0.505)
    bark2 = (0.300, 0.270, 0.235)
    greens = [(0.170, 0.230, 0.115), (0.205, 0.265, 0.135), (0.140, 0.190, 0.100)]
    yellows = [(0.400, 0.360, 0.150), (0.330, 0.270, 0.115)]
    main = _spine(-n * 0.02, n * 0.72, -0.30, n * 1.04, 0.22, seg=14)
    _strip(t, main, n * 0.026, n * 0.006, bark2, bark, 0.28, 0.85)
    twigs = [(main, -0.30)]
    for tt in np.linspace(0.18, 0.95, 7):
        bx, by = main[int(tt * (len(main) - 1))]
        sgn = 1.0 if r.random() < 0.5 else -1.0
        a = -0.30 + sgn * r.uniform(0.4, 0.9)
        sp = _spine(bx, by, a, n * r.uniform(0.16, 0.34), sgn * r.uniform(0.1, 0.5), gravity=0.35, seg=8)
        _strip(t, sp, n * 0.012, n * 0.004, bark2, bark, 0.33, 0.85)
        twigs.append((sp, a))
    for sp, a in twigs:
        m = len(sp) - 1
        for k in range(2, m):
            if r.random() < 0.25:
                continue
            px, py = sp[k]
            for sgn in (-1.0, 1.0):
                if r.random() < 0.35:
                    continue
                la = a + sgn * r.uniform(0.5, 1.35) + r.normal(0, 0.15)
                ln = n * r.uniform(0.085, 0.145)
                yellow = r.random() < 0.28
                col = (yellows if yellow else greens)[r.integers(0, 2 if yellow else 3)]
                sh = r.uniform(0.78, 1.22)
                dep = 0.45 + 0.5 * r.random()
                _leaf(t, px, py, la, ln, ln * r.uniform(0.72, 0.92), col,
                      tuple(v * 0.62 for v in col), dep, 0.52 if not yellow else 0.74,
                      teeth=11, flip=1.0 if r.random() < 0.5 else -1.0, shade=sh, petiole=bark2)
    for _ in range(3):                                  # catkins
        sp, a = twigs[r.integers(0, len(twigs))]
        px, py = sp[r.integers(2, len(sp) - 1)]
        cs = _spine(px, py, a + r.uniform(0.6, 1.4), n * 0.075, 0.2, gravity=0.9, seg=6)
        _strip(t, cs, n * 0.016, n * 0.008, (0.300, 0.255, 0.130), (0.400, 0.340, 0.170), 0.85, 0.8)
    return t


def dead_branch_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    wood = (0.175, 0.155, 0.135)
    wood2 = (0.310, 0.285, 0.250)
    lichen = (0.415, 0.435, 0.365)

    def fork(x, y, a, ln, wd, depth, order):
        sp = _spine(x, y, a, ln, r.uniform(-0.5, 0.5), gravity=r.uniform(-0.35, 0.35), seg=9)
        _strip(t, sp, wd, wd * 0.32, wood, wood2, depth, 0.92)
        # bark cracks along the limb
        for _ in range(max(1, int(wd * 0.6))):
            k = r.integers(1, len(sp) - 2)
            px, py = sp[k]
            qx, qy = sp[k + 1]
            t.line([(px + r.uniform(-wd, wd) * 0.3, py + r.uniform(-wd, wd) * 0.3), (qx, qy)],
                   tuple(v * 0.55 for v in wood), max(1.0, wd * 0.12), depth + 0.01, 0.95)
        if r.random() < 0.5:
            for _ in range(r.integers(1, 4)):
                px, py = sp[r.integers(2, len(sp) - 1)]
                t.ellipse(px, py, wd * r.uniform(0.5, 1.1), wd * r.uniform(0.4, 0.9), lichen, depth + 0.02, 0.95)
        if order <= 0 or ln < n * 0.05:
            return
        ex, ey = sp[-1]
        aa = a + r.uniform(-0.2, 0.2)
        for sgn in (-1.0, 1.0):
            if r.random() < 0.15:
                continue
            fork(ex, ey, aa + sgn * r.uniform(0.25, 0.75), ln * r.uniform(0.45, 0.7),
                 wd * r.uniform(0.5, 0.7), depth + r.uniform(0.03, 0.12), order - 1)
        mx, my = sp[r.integers(3, len(sp) - 1)]
        if r.random() < 0.7:
            fork(mx, my, a + r.choice([-1.0, 1.0]) * r.uniform(0.5, 1.1), ln * r.uniform(0.35, 0.55),
                 wd * r.uniform(0.4, 0.6), depth + r.uniform(0.02, 0.1), order - 1)

    fork(-n * 0.02, n * 0.62, -0.35, n * 0.42, n * 0.035, 0.3, 4)
    fork(n * 0.05, n * 0.92, -0.85, n * 0.34, n * 0.026, 0.32, 3)
    return t


def bush_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    wood = (0.140, 0.120, 0.098)
    greens = [(0.128, 0.170, 0.098), (0.160, 0.205, 0.118), (0.100, 0.140, 0.088), (0.205, 0.225, 0.128)]
    autumn = [(0.330, 0.255, 0.115), (0.270, 0.190, 0.098)]
    cx, cy = n * 0.5, n * 0.62
    stems = []
    for i in range(9):
        a = -np.pi / 2 + r.uniform(-0.85, 0.85)
        sp = _spine(cx + r.uniform(-n * 0.06, n * 0.06), n * 1.0, a, n * r.uniform(0.55, 0.92),
                    r.uniform(-0.5, 0.5), gravity=r.uniform(-0.4, 0.4), seg=10)
        _strip(t, sp, n * 0.016, n * 0.004, wood, (0.22, 0.19, 0.15), 0.22, 0.9)
        stems.append((sp, a))
        for k in range(3, len(sp) - 1):
            if r.random() < 0.5:
                px, py = sp[k]
                aa = a + r.choice([-1.0, 1.0]) * r.uniform(0.4, 1.0)
                sp2 = _spine(px, py, aa, n * r.uniform(0.10, 0.24), r.uniform(-0.5, 0.5), seg=6)
                _strip(t, sp2, n * 0.009, n * 0.003, wood, (0.22, 0.19, 0.15), 0.26, 0.9)
                stems.append((sp2, aa))
    for i in range(560):
        sp, a = stems[r.integers(0, len(stems))]
        k = r.integers(1, len(sp))
        px, py = sp[k - 1]
        px += r.normal(0, n * 0.02)
        py += r.normal(0, n * 0.02)
        d = np.hypot(px - cx, py - cy * 1.05) / (n * 0.55)
        if r.random() < d * d * 0.9:
            continue
        la = a + r.uniform(-1.6, 1.6)
        ln = n * r.uniform(0.045, 0.085)
        aut = r.random() < 0.18
        col = (autumn if aut else greens)[r.integers(0, 2 if aut else 4)]
        depth = 0.35 + 0.62 * float(np.clip(1.0 - d, 0.05, 1.0)) * r.uniform(0.6, 1.0)
        _leaf(t, px, py, la, ln, ln * r.uniform(0.5, 0.72), col, tuple(v * 0.6 for v in col),
              depth, 0.58 if not aut else 0.8, teeth=7, tooth=0.04,
              flip=1.0 if r.random() < 0.5 else -1.0, shade=r.uniform(0.62, 1.25))
    return t


def fern_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    greens = [(0.105, 0.155, 0.088), (0.135, 0.185, 0.100), (0.082, 0.120, 0.072)]
    brown = (0.290, 0.220, 0.110)
    for f in range(4):
        x0 = n * (0.20 + 0.20 * f) + r.uniform(-n * 0.04, n * 0.04)
        a0 = -np.pi / 2 + r.uniform(-0.5, 0.5)
        L = n * r.uniform(0.72, 0.98)
        rach = _spine(x0, n * 1.0, a0, L, r.uniform(-0.35, 0.35), gravity=r.uniform(0.5, 1.4), seg=16)
        dep = 0.3 + 0.16 * f
        _strip(t, rach, n * 0.011, n * 0.003, (0.20, 0.175, 0.098), (0.28, 0.255, 0.140), dep, 0.85)
        m = len(rach) - 1
        for k in range(1, m):
            tt = k / m
            px, py = rach[k]
            ax, ay = rach[k + 1]
            base_a = np.arctan2(ay - py, ax - px)
            plen = n * 0.20 * (np.sin(np.pi * (0.12 + tt * 0.88)) ** 0.8) * r.uniform(0.85, 1.15)
            for sgn in (-1.0, 1.0):
                pa = base_a + sgn * (0.95 - 0.35 * tt)
                psp = _spine(px, py, pa, plen, sgn * r.uniform(0.1, 0.45), seg=7)
                dry = r.random() < 0.16
                col = brown if dry else greens[r.integers(0, 3)]
                sh = r.uniform(0.72, 1.2)
                _strip(t, psp, n * 0.010, n * 0.002, tuple(v * sh * 0.8 for v in col),
                       tuple(min(1, v * sh * 1.1) for v in col), dep + 0.02, 0.62)
                # pinnules along the pinna
                for j in range(1, len(psp) - 1):
                    qx, qy = psp[j]
                    sz = plen * 0.30 * (1.0 - j / len(psp))
                    for s2 in (-1.0, 1.0):
                        _leaf(t, qx, qy, pa + s2 * 1.0, sz, sz * 0.55,
                              tuple(v * sh for v in col), tuple(v * sh * 0.6 for v in col),
                              dep + 0.04 + r.uniform(0, 0.1), 0.6, teeth=5, tooth=0.09, tip=0.9, base=0.55)
    return t


def reeds_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    stalk = [(0.255, 0.245, 0.145), (0.205, 0.210, 0.130), (0.300, 0.280, 0.165)]
    green = [(0.150, 0.185, 0.110), (0.185, 0.215, 0.128)]
    plume = (0.380, 0.330, 0.255)
    for i in range(70):
        d = i / 70.0
        x = r.uniform(-n * 0.03, n * 1.03)
        a = -np.pi / 2 + r.normal(0, 0.22)
        L = n * r.uniform(0.55, 1.0)
        col = (green if r.random() < 0.35 else stalk)
        c = col[r.integers(0, len(col))]
        sh = 0.55 + 0.45 * d
        sp = _spine(x, n * 1.0, a, L, r.uniform(-0.25, 0.25), gravity=r.uniform(-1.1, 1.1), seg=12)
        _strip(t, sp, n * r.uniform(0.005, 0.010), n * 0.0015, tuple(v * sh * 0.85 for v in c),
               tuple(min(1, v * sh * 1.15) for v in c), 0.2 + 0.7 * d, 0.8)
        # sheath leaves
        for k in (3, 6, 9):
            if k < len(sp) - 1 and r.random() < 0.6:
                px, py = sp[k]
                la = a + r.choice([-1.0, 1.0]) * r.uniform(0.5, 1.2)
                _strip(t, _spine(px, py, la, n * r.uniform(0.14, 0.30), r.uniform(-0.3, 0.3),
                                 gravity=r.uniform(0.8, 2.2), seg=8),
                       n * 0.012, n * 0.001, tuple(v * sh * 0.8 for v in c), tuple(min(1, v * sh * 1.1) for v in c),
                       0.2 + 0.7 * d, 0.82)
        if r.random() < 0.30:                          # seed plume at the tip
            hx, hy = sp[-1]
            for _ in range(70):
                aa = a + r.normal(0, 0.35)
                ln = n * r.uniform(0.03, 0.085)
                _strip(t, _spine(hx + r.normal(0, n * 0.008), hy + r.uniform(0, n * 0.06), aa, ln,
                                 r.uniform(-0.8, 0.8), seg=3), n * 0.0035, n * 0.0008,
                       tuple(v * 0.75 for v in plume), tuple(min(1, v * 1.25) for v in plume), 0.2 + 0.7 * d, 0.9)
    return t


def litter_cell(n, seed):
    r = N.rng_for(seed)
    t = Tile(n, n, ss=2)
    cols = [(0.300, 0.215, 0.118), (0.245, 0.170, 0.098), (0.355, 0.280, 0.150), (0.195, 0.150, 0.098),
            (0.330, 0.245, 0.135), (0.270, 0.230, 0.155), (0.210, 0.185, 0.135)]
    # needles and twigs underneath
    for i in range(900):
        x, y = r.uniform(0, n), r.uniform(0, n)
        a = r.uniform(0, np.pi * 2)
        ln = n * r.uniform(0.02, 0.075)
        c = (0.235, 0.175, 0.098) if r.random() < 0.6 else (0.185, 0.155, 0.118)
        sh = r.uniform(0.7, 1.25)
        _strip(t, _spine(x, y, a, ln, r.uniform(-0.5, 0.5), seg=3), n * r.uniform(0.002, 0.005), n * 0.001,
               tuple(v * sh * 0.8 for v in c), tuple(min(1, v * sh * 1.15) for v in c), 0.08 + 0.12 * r.random(), 0.9)
    for i in range(230):
        d = i / 230.0
        x, y = r.uniform(0, n), r.uniform(0, n)
        # keep an irregular open edge so the card does not read as a rectangle
        e = min(x, y, n - x, n - y) / (n * 0.12)
        if r.random() > np.clip(e, 0.15, 1.0):
            continue
        a = r.uniform(0, np.pi * 2)
        ln = n * r.uniform(0.075, 0.165)
        col = cols[r.integers(0, len(cols))]
        sh = r.uniform(0.65, 1.3)
        curl = r.random() < 0.35
        _leaf(t, x, y, a, ln, ln * r.uniform(0.55, 0.85), tuple(v * sh for v in col),
              tuple(v * sh * 0.55 for v in col), 0.25 + 0.7 * d, 0.86,
              teeth=9 if not curl else 5, tooth=0.05 if not curl else 0.11,
              flip=1.0 if r.random() < 0.5 else -1.0, tip=0.7 if not curl else 1.1)
    return t


# ------------------------------------------------------------------ atlas assembly

def _paste(dst, src, x, y):
    h, w = src.shape[:2]
    dst[y:y + h, x:x + w] = src


def _build_atlas(name, size, cells, out, preview_dir, radius=3.0, ao_blur=24.0):
    """cells = [(cx, cy, cw, ch, tile, meta)] in atlas pixels."""
    albedo = np.zeros((size, size, 3), F32)
    alpha = np.zeros((size, size), F32)
    nrm = np.zeros((size, size, 3), F32)
    nrm[..., 2] = 1.0
    nrm[..., 0] = 0.5
    nrm[..., 1] = 0.5
    orm = np.zeros((size, size, 3), F32)
    orm[..., 0] = 1.0
    orm[..., 1] = 0.9
    height = np.zeros((size, size), F32)
    rects = []
    for cx, cy, cw, ch, tile, meta in cells:
        a, al, nn, oo, hh = _card_maps(*tile.resolve(), radius=radius, ao_blur=ao_blur)
        _paste(albedo, a, cx, cy)
        _paste(alpha, al, cx, cy)
        _paste(nrm, nn, cx, cy)
        _paste(orm, oo, cx, cy)
        _paste(height, hh, cx, cy)
        m = dict(meta)
        m["px"] = [cx, cy, cw, ch]
        m["uv"] = [round(cx / size, 6), round(cy / size, 6), round((cx + cw) / size, 6), round((cy + ch) / size, 6)]
        m["coverage"] = round(float(al.mean()), 4)
        rects.append(m)
    d = out
    os.makedirs(d, exist_ok=True)
    rgba = np.concatenate([albedo, alpha[..., None]], axis=-1)
    M.save_webp(os.path.join(d, f"{name}_albedo.webp"), rgba, quality=92)
    M.save_webp(os.path.join(d, f"{name}_normal.webp"), nrm, quality=95)
    M.save_webp(os.path.join(d, f"{name}_orm.webp"), orm, quality=90)
    M.save_webp(os.path.join(d, f"{name}_alpha.webp"), alpha, lossless=True)
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        bg = np.array([0.35, 0.36, 0.38], F32)
        comp = albedo * alpha[..., None] + bg[None, None, :] * (1.0 - alpha[..., None])
        M.preview(os.path.join(preview_dir, f"cards_{name}.png"), comp, nrm, orm, alpha, size=1024)
    return rects


def generate(out, size=2048, preview_dir=None):
    import time
    t0 = time.time()
    os.makedirs(out, exist_ok=True)
    atlases = {}

    # --- grass: 2 columns x 4 rows of 1024 x 512, four colour states, two variants each
    cw, ch = size // 2, size // 4
    cells = []
    for row, st in enumerate(GRASS_STATES):
        for col in range(2):
            dense = 1.0 if col == 0 else 1.45
            tile = grass_cell(cw, ch, 6100 + row * 31 + col, st, dense=dense)
            cells.append((col * cw, row * ch, cw, ch, tile,
                          {"name": f"grass_{st[0]}_{'a' if col == 0 else 'b'}", "state": st[0],
                           "variant": "sparse" if col == 0 else "dense",
                           "size_m": [0.55, 0.30], "kind": "grass"}))
    atlases["grass"] = {"size": [size, size], "cell": [cw, ch], "cards":
                        _build_atlas("grass", size, cells, out, preview_dir, radius=2.6, ao_blur=18.0)}
    print(f"[cards] grass atlas {time.time() - t0:.0f}s", flush=True)

    # --- branches: 2 x 2 of 1024
    c = size // 2
    defs = [(0, 0, "pine_branch", pine_cell, {"size_m": [1.1, 1.1], "kind": "branch", "tree": "pine"}),
            (1, 0, "spruce_branch", spruce_cell, {"size_m": [1.2, 1.2], "kind": "branch", "tree": "spruce"}),
            (0, 1, "birch_branch", birch_cell, {"size_m": [1.0, 1.0], "kind": "branch", "tree": "birch"}),
            (1, 1, "dead_branch", dead_branch_cell, {"size_m": [1.0, 1.0], "kind": "branch", "tree": "dead"})]
    cells = []
    for col, row, nm, fn, meta in defs:
        tile = fn(c, 6200 + col * 7 + row * 13)
        m = dict(meta)
        m["name"] = nm
        cells.append((col * c, row * c, c, c, tile, m))
    atlases["branches"] = {"size": [size, size], "cell": [c, c], "cards":
                           _build_atlas("branches", size, cells, out, preview_dir, radius=3.0, ao_blur=26.0)}
    print(f"[cards] branch atlas {time.time() - t0:.0f}s", flush=True)

    # --- plants: 2 x 2 of 1024
    defs = [(0, 0, "bush", bush_cell, {"size_m": [1.4, 1.4], "kind": "bush"}),
            (1, 0, "fern", fern_cell, {"size_m": [0.9, 0.9], "kind": "fern"}),
            (0, 1, "reeds", reeds_cell, {"size_m": [1.1, 1.5], "kind": "reeds"}),
            (1, 1, "leaf_litter", litter_cell, {"size_m": [1.2, 1.2], "kind": "litter", "ground": True})]
    cells = []
    for col, row, nm, fn, meta in defs:
        tile = fn(c, 6300 + col * 11 + row * 17)
        m = dict(meta)
        m["name"] = nm
        cells.append((col * c, row * c, c, c, tile, m))
    atlases["plants"] = {"size": [size, size], "cell": [c, c], "cards":
                         _build_atlas("plants", size, cells, out, preview_dir, radius=3.0, ao_blur=26.0)}
    print(f"[cards] plant atlas {time.time() - t0:.0f}s", flush=True)

    doc = {
        "note": "Alpha-cut foliage cards. Use albedo RGBA (or the separate _alpha map) with alpha scissor ~0.4, "
                "cull disabled, backface normals flipped. uv = [u0, v0, u1, v1] with v measured downwards from "
                "the top-left, matching Godot UVs; px = [x, y, w, h].",
        "material": {"alpha_scissor": 0.4, "cull": "disabled", "specular": 0.35, "roughness_from": "orm.g",
                     "ao_from": "orm.r", "backlight": "foliage translucency 0.25 recommended"},
        "atlases": {k: {"albedo": f"cards/{k}_albedo.webp", "normal": f"cards/{k}_normal.webp",
                        "orm": f"cards/{k}_orm.webp", "alpha": f"cards/{k}_alpha.webp",
                        **v} for k, v in atlases.items()},
    }
    with open(os.path.join(out, "atlas.json"), "w") as f:
        json.dump(doc, f, indent=1)
    print(f"[cards] done in {time.time() - t0:.0f}s -> {out}", flush=True)
    return doc
