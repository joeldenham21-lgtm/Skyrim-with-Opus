"""Projected decals: impacts, fluids, growth, marks and signage.

Each decal is written to assets/textures/decals/ as <name>_albedo.webp (RGBA — the alpha is the decal's own
coverage), plus <name>_normal.webp and <name>_orm.webp where the surface actually deforms or changes finish.
Sizes, projection extents and blend hints live in decals.json so the placement code does not have to guess.

Decals are NOT tileable (they are one-shot marks), so drawing here uses plain arrays; only the tyre track is
made to repeat along its length.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from . import maps as M
from . import noise as N
from .common import blotches, crack_lines, crack_mask, grit, micrograin, sprinkle_lines, stain_down
from .draw import Canvas, font

F32 = np.float32
C = M.hexc

ENTRIES = []


# ---------------------------------------------------------------- helpers

def _rng(seed):
    return N.rng_for(seed)


def _radial(w, h, cx=0.5, cy=0.5):
    y, x = np.mgrid[0:h, 0:w].astype(F32)
    x = x / w - cx
    y = y / h - cy
    return np.sqrt(x * x + y * y * 1.0), np.arctan2(y, x)


def _noise(w, h, cells, octaves, seed):
    n = max(w, h)
    n2 = 1
    while n2 < n:
        n2 *= 2
    a = N.fbm(n2, cells, octaves, seed, min_res=256)
    return a[:h, :w].astype(F32)


def _blur(a, s):
    return ndimage.gaussian_filter(a.astype(F32), s, mode="nearest")


def _normal_from(height, strength=6.0, alpha=None):
    from scipy import ndimage as nd
    h = height.astype(F32)
    sx = nd.sobel(h, axis=1, mode="nearest") / 8.0
    sy = nd.sobel(h, axis=0, mode="nearest") / 8.0
    nx = -sx * strength
    ny = sy * strength
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx * inv, ny * inv, nz * inv], axis=-1) * 0.5 + 0.5
    if alpha is not None:
        f = np.clip(alpha * 1.5, 0, 1)[..., None]
        out = out * f + np.array([0.5, 0.5, 1.0], F32)[None, None, :] * (1 - f)
    return out.astype(F32)


def _bleed(rgb, alpha, thresh=0.02):
    solid = alpha > thresh
    if not solid.any():
        return rgb
    _, idx = ndimage.distance_transform_edt(~solid, return_indices=True)
    return rgb[idx[0], idx[1]].astype(F32)


def _write(out, name, albedo, alpha, normal=None, orm=None, meta=None):
    os.makedirs(out, exist_ok=True)
    a = np.clip(alpha, 0, 1).astype(F32)
    rgba = np.concatenate([_bleed(np.clip(albedo, 0, 1), a), a[..., None]], axis=-1)
    M.save_webp(os.path.join(out, f"{name}_albedo.webp"), rgba, quality=92)
    e = {"name": name, "albedo": f"decals/{name}_albedo.webp", "size_px": [int(a.shape[1]), int(a.shape[0])]}
    if normal is not None:
        M.save_webp(os.path.join(out, f"{name}_normal.webp"), normal, quality=92)
        e["normal"] = f"decals/{name}_normal.webp"
    if orm is not None:
        M.save_webp(os.path.join(out, f"{name}_orm.webp"), orm, quality=90)
        e["orm"] = f"decals/{name}_orm.webp"
    if meta:
        e.update(meta)
    ENTRIES.append(e)
    print(f"[decals] {name:22s} {a.shape[1]}x{a.shape[0]}", flush=True)


def _orm(alpha, rough, ao=None, metal=None):
    sh = alpha.shape
    ao = np.ones(sh, F32) if ao is None else ao
    metal = np.zeros(sh, F32) if metal is None else metal
    r = rough if np.ndim(rough) else np.full(sh, float(rough), F32)
    return np.stack([np.clip(ao, 0, 1), np.clip(r, 0, 1), np.clip(metal, 0, 1)], axis=-1).astype(F32)


# ---------------------------------------------------------------- impacts

def bullet(kind, n=512, seed=0):
    """One bullet impact. kind in concrete|wood|metal|dirt."""
    r = _rng(seed)
    d, th = _radial(n, n)
    warp = _noise(n, n, 14, 4, seed + 1) * 0.06 + _noise(n, n, 40, 3, seed + 2) * 0.02
    dd = d + warp
    alpha = np.zeros((n, n), F32)
    col = np.zeros((n, n, 3), F32)
    height = np.zeros((n, n), F32)
    rough = np.full((n, n), 0.9, F32)
    metal = np.zeros((n, n), F32)

    if kind == "concrete":
        crater = 1.0 - N.smoothstep(0.12, 0.20, dd)
        hole = 1.0 - N.smoothstep(0.035, 0.055, dd)
        dust = (1.0 - N.smoothstep(0.16, 0.42, dd)) * (0.35 + 0.65 * (_noise(n, n, 22, 4, seed + 3) * 0.5 + 0.5))
        spok = np.zeros((n, n), F32)
        for i in range(int(r.integers(5, 9))):
            a0 = r.uniform(0, 2 * np.pi)
            wdt = r.uniform(0.05, 0.12)
            ln = r.uniform(0.18, 0.42)
            dth = np.abs(((th - a0 + np.pi) % (2 * np.pi)) - np.pi)
            spok = np.maximum(spok, (1.0 - N.smoothstep(wdt * 0.4, wdt, dth)) * (1.0 - N.smoothstep(ln * 0.6, ln, dd)))
        agg = grit(n, seed + 4, density=0.5, sizes=(0.6, 2.4), soft=0.4)
        alpha = np.clip(crater + dust * 0.8 + spok * 0.55, 0, 1)
        base = M.solid(n, C("#a29d94"))
        base = M.mul(base, 0.85 + agg * 0.4)
        col = M.mix(base, M.solid(n, C("#6e6a64")), dust * 0.5)
        col = M.mix(col, M.solid(n, C("#3a3835")), crater * 0.55)
        col = M.mix(col, M.solid(n, C("#131211")), hole * 0.95)
        col = M.mix(col, M.solid(n, C("#4a4744")), spok * 0.6)
        height = -crater * 0.35 - hole * 0.6 + agg * 0.05 * crater - spok * 0.12
        rough = 0.95 - agg * 0.05
    elif kind == "wood":
        hole = 1.0 - N.smoothstep(0.035, 0.06, dd)
        crater = 1.0 - N.smoothstep(0.07, 0.14, dd)
        splinter = np.zeros((n, n), F32)
        for i in range(int(r.integers(14, 24))):
            a0 = r.normal(np.pi / 2, 0.45) + (np.pi if r.random() < 0.5 else 0)
            wdt = r.uniform(0.012, 0.05)
            ln = r.uniform(0.12, 0.34)
            dth = np.abs(((th - a0 + np.pi) % (2 * np.pi)) - np.pi)
            splinter = np.maximum(splinter, (1.0 - N.smoothstep(wdt * 0.4, wdt, dth)) *
                                  (1.0 - N.smoothstep(ln * 0.7, ln, dd)))
        alpha = np.clip(crater + splinter * 0.85 + hole, 0, 1)
        col = M.mix(M.solid(n, C("#b09b76")), M.solid(n, C("#7a6444")), _noise(n, n, 30, 3, seed + 5) * 0.5 + 0.5)
        col = M.mix(col, M.solid(n, C("#2a2119")), crater * 0.6)
        col = M.mix(col, M.solid(n, C("#0e0b09")), hole * 0.95)
        height = -crater * 0.3 - hole * 0.7 + splinter * 0.18
        rough = 0.88
    elif kind == "metal":
        hole = 1.0 - N.smoothstep(0.030, 0.048, dd)
        lip = (1.0 - N.smoothstep(0.055, 0.085, dd)) * N.smoothstep(0.028, 0.05, dd)
        bright = 1.0 - N.smoothstep(0.06, 0.13, dd)
        petal = np.zeros((n, n), F32)
        for i in range(int(r.integers(5, 8))):
            a0 = r.uniform(0, 2 * np.pi)
            dth = np.abs(((th - a0 + np.pi) % (2 * np.pi)) - np.pi)
            petal = np.maximum(petal, (1.0 - N.smoothstep(0.25, 0.55, dth)) * lip)
        chip = (1.0 - N.smoothstep(0.10, 0.19, dd)) * (_noise(n, n, 26, 3, seed + 6) * 0.5 + 0.5)
        alpha = np.clip(hole + lip + bright * 0.7 + chip * 0.5, 0, 1)
        col = M.mix(M.solid(n, C("#8f959a")), M.solid(n, C("#c2c7ca")), bright)
        col = M.mix(col, M.solid(n, C("#d6dade")), petal * 0.8)
        col = M.mix(col, M.solid(n, C("#08080a")), hole * 0.98)
        col = M.mix(col, M.solid(n, C("#5b4a3a")), chip * 0.35)
        height = -hole * 0.8 + petal * 0.4 + lip * 0.2
        rough = 0.35 + chip * 0.3 - bright * 0.12
        metal = np.clip(0.9 - chip * 0.4, 0, 1) * np.clip(alpha * 2, 0, 1)
    else:  # dirt
        crater = 1.0 - N.smoothstep(0.10, 0.18, dd)
        ejecta = (1.0 - N.smoothstep(0.16, 0.40, dd)) * N.smoothstep(0.11, 0.20, dd)
        clods = grit(n, seed + 7, density=0.20, sizes=(1.0, 4.5), soft=0.6) * ejecta
        alpha = np.clip(crater + ejecta * 0.9 + clods, 0, 1)
        col = M.mix(M.solid(n, C("#4a3f31")), M.solid(n, C("#2e271f")), crater * 0.8)
        col = M.mix(col, M.solid(n, C("#6a5c47")), np.clip(clods * 1.4, 0, 1) * 0.7)
        height = -crater * 0.45 + ejecta * 0.12 + clods * 0.3
        rough = 0.94

    height = _blur(height, 1.0)
    nrm = _normal_from(height, strength=10.0, alpha=alpha)
    ao = np.clip(1.0 + np.clip(height, -1, 0) * 0.9, 0.25, 1.0)
    return col, alpha, nrm, _orm(alpha, rough, ao, metal)


# ---------------------------------------------------------------- fluids

def blood_splat(n=512, seed=0, big=False):
    r = _rng(seed)
    d, th = _radial(n, n)
    warp = _noise(n, n, 7, 5, seed + 1) * 0.10 + _noise(n, n, 26, 4, seed + 2) * 0.035
    core_r = 0.16 if not big else 0.26
    core = 1.0 - N.smoothstep(core_r - 0.02, core_r + 0.02, d + warp)
    # spines and satellite drops thrown outward
    spines = np.zeros((n, n), F32)
    for i in range(int(r.integers(16, 30))):
        a0 = r.uniform(0, 2 * np.pi)
        ln = r.uniform(0.05, 0.30) ** 1.4 + core_r
        wdt = r.uniform(0.010, 0.05)
        dth = np.abs(((th - a0 + np.pi) % (2 * np.pi)) - np.pi)
        s = (1.0 - N.smoothstep(wdt * 0.3, wdt, dth * (0.4 + d * 3.0))) * (1.0 - N.smoothstep(ln * 0.85, ln, d))
        spines = np.maximum(spines, s)
    drops = np.zeros((n, n), F32)
    cv = Canvas(n, "F", 0.0)
    for i in range(int(r.integers(30, 70))):
        a0 = r.uniform(0, 2 * np.pi)
        rr = r.uniform(core_r, 0.48)
        cx = n * (0.5 + np.cos(a0) * rr)
        cy = n * (0.5 + np.sin(a0) * rr)
        rad = n * r.uniform(0.004, 0.022) * (1.0 - rr)
        cv.ellipse(cx, cy, rad, rad * r.uniform(0.7, 1.3), 1.0)
        if r.random() < 0.4:                       # tail pointing outward
            cv.line([(cx, cy), (cx + np.cos(a0) * rad * 5, cy + np.sin(a0) * rad * 5)], 1.0,
                    width=max(1, int(rad * 0.8)))
    drops = cv.array()
    alpha = np.clip(core + spines * 0.95 + drops, 0, 1)
    alpha = _blur(alpha, 0.8)
    edge = np.clip((alpha - _blur(alpha, 3.0)) * 4.0, 0, 1)
    inner = np.clip(alpha - edge, 0, 1)
    dark = M.solid(n, C("#3a0f0c"))
    mid = M.solid(n, C("#5a1a12"))
    dry = M.solid(n, C("#2a1410"))
    col = M.mix(dark, mid, _noise(n, n, 20, 4, seed + 3) * 0.5 + 0.5)
    col = M.mix(col, dry, np.clip(1.0 - inner, 0, 1) * 0.6)
    col = M.mul(col, 0.8 + (_noise(n, n, 60, 3, seed + 4) * 0.5 + 0.5) * 0.4)
    height = alpha * 0.12 + edge * 0.10
    nrm = _normal_from(_blur(height, 1.2), strength=5.0, alpha=alpha)
    rough = 0.55 + (1.0 - inner) * 0.35
    return col, alpha, nrm, _orm(alpha, rough)


def blood_drip(w=384, h=768, seed=0):
    r = _rng(seed)
    a = np.zeros((h, w), F32)
    cv = Canvas(max(w, h), "F", 0.0)
    m = max(w, h)
    for i in range(int(r.integers(5, 9))):
        x = r.uniform(0.15, 0.85) * w
        y0 = r.uniform(0.02, 0.18) * h
        ln = r.uniform(0.25, 0.85) * h
        wd = r.uniform(2.5, 9.0)
        pts = []
        for s in range(14):
            t = s / 13.0
            pts.append((x + np.sin(t * 5 + i) * wd * 0.7, y0 + ln * t))
        cv.line(pts, 1.0, width=int(wd))
        cv.ellipse(pts[-1][0], pts[-1][1], wd * 0.9, wd * 1.4, 1.0)
    src = cv.array()[:h, :w]
    top = np.zeros((h, w), F32)
    ys, xs = np.mgrid[0:h, 0:w].astype(F32)
    for i in range(int(r.integers(2, 5))):
        cx, cy = r.uniform(0.2, 0.8) * w, r.uniform(0.02, 0.10) * h
        rr = r.uniform(0.04, 0.12) * h
        top = np.maximum(top, 1.0 - N.smoothstep(rr * 0.7, rr, np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2 * 1.6)))
    alpha = np.clip(_blur(src + top, 0.9), 0, 1)
    nz = np.zeros((h, w), F32)
    nz[:] = (np.random.default_rng(seed + 9).random((h, w)) - 0.5) * 0.2
    col = np.zeros((h, w, 3), F32)
    base = np.array(C("#4a1410"), F32)
    dryc = np.array(C("#2b110d"), F32)
    fade = np.clip(ys / h, 0, 1)
    col[:] = base[None, None, :] * (1 - fade[..., None] * 0.35) + dryc[None, None, :] * (fade[..., None] * 0.35)
    col = col * (0.85 + nz[..., None])
    height = alpha * 0.2
    nrm = _normal_from(_blur(height, 1.0), strength=6.0, alpha=alpha)
    return col, alpha, nrm, _orm(alpha, 0.5 + fade * 0.35)


def puddle(n=1024, seed=0):
    r = _rng(seed)
    d, th = _radial(n, n)
    shape = d + _noise(n, n, 5, 5, seed + 1) * 0.13 + _noise(n, n, 18, 4, seed + 2) * 0.05
    water = 1.0 - N.smoothstep(0.30, 0.36, shape)
    damp = 1.0 - N.smoothstep(0.34, 0.47, shape)
    alpha = np.clip(water + damp * 0.75, 0, 1)
    ripple = (_noise(n, n, 90, 3, seed + 3) * 0.5) * water
    silt = grit(n, seed + 4, density=0.25, sizes=(0.6, 2.4), soft=0.5)
    debris = grit(n, seed + 5, density=0.03, sizes=(1.5, 5.0), soft=0.8) * damp
    col = M.mix(M.solid(n, C("#3b3a34")), M.solid(n, C("#22231f")), water)
    col = M.mix(col, M.solid(n, C("#4a4740")), damp * (1 - water) * 0.6)
    col = M.mul(col, 0.9 + silt * 0.2)
    col = M.mix(col, M.solid(n, C("#5a5348")), np.clip(debris * 1.3, 0, 1) * 0.5)
    height = -water * 0.25 + ripple * 0.02
    nrm = _normal_from(_blur(height, 1.5), strength=3.0, alpha=alpha)
    rough = 0.06 + (1 - water) * 0.55 + damp * 0.1
    ao = 1.0 - water * 0.15
    return col, alpha, nrm, _orm(alpha, rough, ao)


def oil(n=512, seed=0):
    r = _rng(seed)
    d, th = _radial(n, n)
    shape = d + _noise(n, n, 6, 5, seed + 1) * 0.14 + _noise(n, n, 24, 4, seed + 2) * 0.04
    core = 1.0 - N.smoothstep(0.26, 0.30, shape)
    halo = 1.0 - N.smoothstep(0.30, 0.44, shape)
    drips = np.zeros((n, n), F32)
    cv = Canvas(n, "F", 0.0)
    for i in range(int(r.integers(3, 7))):
        a0 = r.uniform(0, 2 * np.pi)
        x = n * (0.5 + np.cos(a0) * 0.26)
        y = n * (0.5 + np.sin(a0) * 0.26)
        cv.line([(x, y), (x + np.cos(a0) * n * r.uniform(0.05, 0.18), y + np.sin(a0) * n * r.uniform(0.05, 0.18))],
                1.0, width=int(r.uniform(3, 12)))
    drips = _blur(cv.array(), 1.2)
    alpha = np.clip(core + halo * 0.6 + drips, 0, 1)
    sheen = _noise(n, n, 30, 4, seed + 3) * 0.5 + 0.5
    col = M.mix(M.solid(n, C("#17181a")), M.solid(n, C("#0d0e10")), core)
    col = M.mix(col, M.solid(n, C("#2a2c22")), halo * (1 - core) * 0.5)
    irid = np.stack([sheen * 0.10, sheen * 0.06 + 0.02, (1 - sheen) * 0.12], axis=-1).astype(F32)
    col = np.clip(col + irid * core[..., None], 0, 1)
    height = core * 0.05
    nrm = _normal_from(_blur(height, 2.0), strength=2.0, alpha=alpha)
    rough = 0.16 + (1 - core) * 0.5
    return col, alpha, nrm, _orm(alpha, rough)


def scorch(n=1024, seed=0):
    r = _rng(seed)
    d, th = _radial(n, n)
    shape = d + _noise(n, n, 5, 5, seed + 1) * 0.16 + _noise(n, n, 20, 4, seed + 2) * 0.05
    soot = 1.0 - N.smoothstep(0.14, 0.46, shape)
    core = 1.0 - N.smoothstep(0.08, 0.18, shape)
    streaks = np.zeros((n, n), F32)
    for i in range(int(r.integers(18, 34))):
        a0 = r.uniform(0, 2 * np.pi)
        wdt = r.uniform(0.03, 0.14)
        ln = r.uniform(0.25, 0.52)
        dth = np.abs(((th - a0 + np.pi) % (2 * np.pi)) - np.pi)
        streaks = np.maximum(streaks, (1.0 - N.smoothstep(wdt * 0.4, wdt, dth)) *
                             (1.0 - N.smoothstep(ln * 0.6, ln, shape)))
    ash = grit(n, seed + 3, density=0.10, sizes=(0.8, 3.0), soft=0.7)
    alpha = np.clip(soot * 0.95 + streaks * 0.5 + core, 0, 1)
    col = M.mix(M.solid(n, C("#2b2926")), M.solid(n, C("#0c0b0a")), core * 0.9 + soot * 0.3)
    col = M.mix(col, M.solid(n, C("#7d7469")), np.clip(ash * 1.2, 0, 1) * 0.45 * (1 - core))
    height = -core * 0.06 + ash * 0.03
    nrm = _normal_from(_blur(height, 1.5), strength=3.0, alpha=alpha)
    return col, alpha, nrm, _orm(alpha, 0.95 - core * 0.1)


def rust_streak(w=384, h=768, seed=0):
    r = _rng(seed)
    m = max(w, h)
    src = np.zeros((m, m), F32)
    rr = np.random.default_rng(seed)
    for i in range(int(rr.integers(3, 7))):
        x = int(rr.uniform(0.15, 0.85) * w)
        src[int(rr.uniform(0.01, 0.08) * h), max(0, x - 3):x + 3] = 1.0
    col_noise = N.fbm(m, 90, 3, seed + 1, cells_y=6, min_res=512) * 0.5 + 0.5
    d = N.drips(src * (0.4 + 0.6 * col_noise), decay=0.9975, noise=col_noise, strength=1.0)
    d = np.clip(d[:h, :w] * 1.5, 0, 1)
    spread = _blur(d, 3.0) * 0.7
    alpha = np.clip(d + spread * 0.6, 0, 1)
    tex = (N.fbm(m, 60, 4, seed + 2, min_res=512) * 0.5 + 0.5)[:h, :w]
    col = np.zeros((h, w, 3), F32)
    c1 = np.array(C("#6b3a1e"), F32)
    c2 = np.array(C("#9a5c2a"), F32)
    col[:] = c1[None, None, :] * (1 - tex[..., None]) + c2[None, None, :] * tex[..., None]
    col = col * (0.8 + tex[..., None] * 0.4)
    height = alpha * 0.06
    nrm = _normal_from(_blur(height, 1.0), strength=3.0, alpha=alpha)
    return col, alpha, nrm, _orm(alpha, 0.9)


def moss_patch(n=1024, seed=0):
    from .common import draw_strokes, composite_strokes
    r = _rng(seed)
    d, th = _radial(n, n)
    shape = d + _noise(n, n, 6, 5, seed + 1) * 0.16 + _noise(n, n, 22, 4, seed + 2) * 0.06
    body = 1.0 - N.smoothstep(0.26, 0.40, shape)
    greens = [C("#455326"), C("#57662f"), C("#38431f"), C("#6d7a3f")]
    rgb, cov, hh = draw_strokes(n, seed + 3, 12000, length=(5, 14), width=(1.4, 3.0), colors=greens,
                                shade=(0.55, 1.15), tip_light=0.4, height=(0.2, 1.0), ss=2, segments=3, taper=0.6)
    alpha = np.clip(cov * np.clip(body * 1.6, 0, 1), 0, 1)
    col = np.zeros((n, n, 3), F32)
    okay = cov > 1e-4
    for c in range(3):
        col[..., c] = np.where(okay, rgb[..., c] / np.maximum(cov, 1e-4), 0)
    col = M.mul(col, 0.75 + body * 0.45)
    height = hh * 0.5 * body
    nrm = _normal_from(_blur(height, 0.8), strength=8.0, alpha=alpha)
    ao = np.clip(1.0 - _blur(alpha, 16) * 0.5, 0.3, 1.0)
    return col, alpha, nrm, _orm(alpha, 0.95, ao)


def crack_decal(n=1024, seed=0, heavy=False):
    lines = crack_lines(n, 2 if not heavy else 4, seed, length=(0.4, 0.95), wander=0.05, branch_p=0.55)
    lines += crack_lines(n, 5 if not heavy else 9, seed + 1, length=(0.1, 0.35), wander=0.1, branch_p=0.35)
    m1 = crack_mask(n, lines, width=3.2 if heavy else 2.2, soft=0.5, wobble=1.5, seed=seed + 2)
    m2 = crack_mask(n, lines, width=9.0, soft=5.0)
    alpha = np.clip(m1 + m2 * 0.55, 0, 1)
    edge = np.clip(m2 - m1, 0, 1)
    col = M.mix(M.solid(n, C("#2a2825")), M.solid(n, C("#12100f")), m1)
    col = M.mix(col, M.solid(n, C("#918d84")), edge * 0.35)
    height = -m1 * 0.5 - m2 * 0.08
    nrm = _normal_from(_blur(height, 0.8), strength=9.0, alpha=alpha)
    ao = np.clip(1.0 - m2 * 0.5 - m1 * 0.4, 0.2, 1.0)
    return col, alpha, nrm, _orm(alpha, 0.95, ao)


# ---------------------------------------------------------------- marks

def tyre_track(w=320, h=1024, seed=0, kind="block"):
    """Tread pressed into mud; repeats along its length (v)."""
    r = _rng(seed)
    ys, xs = np.mgrid[0:h, 0:w].astype(F32)
    u = xs / w
    v = ys / h
    inside = N.smoothstep(0.03, 0.10, u) * N.smoothstep(0.03, 0.10, 1 - u)
    if kind == "block":
        rows = 14
        rv = (v * rows) % 1.0
        ri = np.floor(v * rows)
        off = (ri % 2) * 0.5
        cu = ((u + off) * 4.0) % 1.0
        block = (N.smoothstep(0.12, 0.22, rv) * N.smoothstep(0.12, 0.22, 1 - rv)
                 * N.smoothstep(0.10, 0.20, cu) * N.smoothstep(0.10, 0.20, 1 - cu))
    else:
        rows = 9
        rv = (v * rows) % 1.0
        ang = (u - 0.5) * 1.1
        rv2 = (rv + ang) % 1.0
        block = N.smoothstep(0.10, 0.30, rv2) * N.smoothstep(0.10, 0.30, 1 - rv2)
    nz = N.fbm(max(w, h), 40, 4, seed + 1, min_res=256)[:h, :w]
    block = np.clip(block * inside * (0.75 + nz * 0.5), 0, 1)
    ridge = np.clip(_blur(block, 4) - block, 0, 1) * inside
    alpha = np.clip(block + ridge * 0.9 + inside * 0.35, 0, 1)
    col = M.mix(M.solid(max(w, h), C("#4a3f31"))[:h, :w], M.solid(max(w, h), C("#2b241c"))[:h, :w], block * 0.85)
    col = M.mix(col, M.solid(max(w, h), C("#6a5b46"))[:h, :w], ridge * 0.6)
    col = col * (0.85 + nz[..., None] * 0.35)
    height = -block * 0.5 + ridge * 0.30
    nrm = _normal_from(_blur(height, 1.2), strength=9.0, alpha=alpha)
    ao = np.clip(1.0 - block * 0.45, 0.3, 1.0)
    return col, alpha, nrm, _orm(alpha, 0.86 - block * 0.15, ao)


def footprint(w=320, h=640, seed=0, right=True):
    """A lugged boot sole pressed into soft ground."""
    r = _rng(seed)
    ys, xs = np.mgrid[0:h, 0:w].astype(F32)
    u = (xs / w - 0.5) * 2.0
    v = ys / h
    if not right:
        u = -u
    # sole outline: heel (0.72-1.0), waist, forefoot (0.05-0.62)
    halfw = (0.72 * np.exp(-((v - 0.30) / 0.36) ** 2)
             + 0.60 * np.exp(-((v - 0.86) / 0.16) ** 2)
             + 0.30)
    halfw = np.clip(halfw, 0, 0.92)
    halfw = halfw * (1.0 - 0.16 * np.exp(-((v - 0.62) / 0.10) ** 2))     # waist
    edge = np.abs(u + 0.06 * np.sin(v * 6.0)) / np.maximum(halfw, 1e-3)
    sole = 1.0 - N.smoothstep(0.90, 1.02, edge)
    sole = sole * N.smoothstep(0.02, 0.06, v) * N.smoothstep(0.02, 0.06, 1 - v)
    # lugs: chevrons on the forefoot, bars on the heel
    chev = np.abs(((v * 22.0 + np.abs(u) * 3.2) % 1.0) - 0.5) * 2.0
    bar = np.abs(((v * 15.0) % 1.0) - 0.5) * 2.0
    lug = np.where(v < 0.66, N.smoothstep(0.30, 0.60, chev), N.smoothstep(0.35, 0.65, bar))
    rim = 1.0 - N.smoothstep(0.72, 0.95, edge)
    nz = N.fbm(max(w, h), 50, 4, seed + 1, min_res=256)[:h, :w]
    depth = sole * (0.55 + lug * 0.45) * (0.8 + nz * 0.4)
    push = np.clip(_blur(sole, 6) - sole, 0, 1)
    alpha = np.clip(sole + push * 0.9, 0, 1)
    base = M.solid(max(w, h), C("#3d3428"))[:h, :w]
    col = M.mix(base, M.solid(max(w, h), C("#241d16"))[:h, :w], depth * 0.9)
    col = M.mix(col, M.solid(max(w, h), C("#5f5340"))[:h, :w], push * 0.7)
    col = col * (0.85 + nz[..., None] * 0.3)
    height = -depth * 0.55 + push * 0.30
    nrm = _normal_from(_blur(height, 1.0), strength=10.0, alpha=alpha)
    ao = np.clip(1.0 - depth * 0.5, 0.25, 1.0)
    return col, alpha, nrm, _orm(alpha, 0.88 - depth * 0.15, ao)


# ---------------------------------------------------------------- signage

def poster(w=768, h=1024, seed=0, variant=0):
    """A faded Soviet-era notice, printed cheaply and left on a wall for thirty years."""
    r = _rng(seed)
    im = Image.new("RGB", (w, h), (214, 205, 182))
    d = ImageDraw.Draw(im)
    red = (150, 44, 32)
    ink = (34, 32, 30)
    blue = (58, 78, 96)
    if variant == 0:
        d.rectangle([0, 0, w, int(h * 0.16)], fill=red)
        f = font(int(h * 0.075), bold=True)
        d.text((int(w * 0.06), int(h * 0.045)), "СЛАВА ТРУДУ", font=f, fill=(226, 220, 205))
        f2 = font(int(h * 0.045), bold=True)
        d.text((int(w * 0.06), int(h * 0.22)), "ПЕЧОРСКИЙ", font=f2, fill=ink)
        d.text((int(w * 0.06), int(h * 0.28)), "КОМБИНАТ № 12", font=f2, fill=ink)
        d.rectangle([int(w * 0.06), int(h * 0.36), int(w * 0.94), int(h * 0.38)], fill=ink)
        f3 = font(int(h * 0.030), bold=False)
        for i, line in enumerate(["ПЛАН ВЫПОЛНЕН НА 118 %", "СМЕНА 2 — БРИГАДА КУЗНЕЦОВА",
                                  "СОЦИАЛИСТИЧЕСКОЕ ОБЯЗАТЕЛЬСТВО", "ПРИНЯТО 14 МАРТА 1987 Г."]):
            d.text((int(w * 0.06), int(h * (0.42 + i * 0.05))), line, font=f3, fill=ink)
        for i in range(5):
            y = int(h * (0.66 + i * 0.055))
            d.rectangle([int(w * 0.06), y, int(w * (0.30 + r.uniform(0, 0.55))), y + int(h * 0.012)], fill=(96, 92, 86))
    elif variant == 1:
        d.rectangle([int(w * 0.05), int(h * 0.05), int(w * 0.95), int(h * 0.95)], outline=ink, width=int(w * 0.012))
        f = font(int(h * 0.085), bold=True)
        d.text((w // 2, int(h * 0.14)), "ВНИМАНИЕ", font=f, fill=red, anchor="ma")
        # hazard triangle
        cx, cy, s = w // 2, int(h * 0.42), int(h * 0.14)
        d.polygon([(cx, cy - s), (cx - s, cy + s * 0.8), (cx + s, cy + s * 0.8)], fill=(196, 170, 60), outline=ink)
        d.polygon([(cx, cy - s * 0.72), (cx - s * 0.72, cy + s * 0.6), (cx + s * 0.72, cy + s * 0.6)],
                  fill=(196, 170, 60), outline=ink)
        f2 = font(int(h * 0.10), bold=True)
        d.text((cx, cy - s * 0.55), "!", font=f2, fill=ink, anchor="ma")
        f3 = font(int(h * 0.036), bold=True)
        for i, line in enumerate(["ЗАПРЕТНАЯ ЗОНА", "ПРОХОД БЕЗ ПРОПУСКА", "СТРОГО ВОСПРЕЩЁН"]):
            d.text((cx, int(h * (0.62 + i * 0.055))), line, font=f3, fill=ink, anchor="ma")
        f4 = font(int(h * 0.026), bold=False)
        d.text((cx, int(h * 0.82)), "УНПСК · ОТДЕЛ РЕЖИМА · ФОРМА 4", font=f4, fill=(88, 84, 80), anchor="ma")
    else:
        f = font(int(h * 0.055), bold=True)
        d.text((int(w * 0.07), int(h * 0.07)), "ГРАФИК", font=f, fill=ink)
        d.text((int(w * 0.07), int(h * 0.135)), "ДЕЖУРСТВ", font=f, fill=ink)
        rows, cols = 9, 4
        x0, y0 = int(w * 0.07), int(h * 0.24)
        cw, ch = int(w * 0.86 / cols), int(h * 0.06)
        for rr in range(rows + 1):
            d.line([(x0, y0 + rr * ch), (x0 + cw * cols, y0 + rr * ch)], fill=(70, 68, 64), width=2)
        for cc in range(cols + 1):
            d.line([(x0 + cc * cw, y0), (x0 + cc * cw, y0 + ch * rows)], fill=(70, 68, 64), width=2)
        f2 = font(int(h * 0.026), bold=False)
        names = ["ПЕТРОВ", "СИДОРОВ", "ЛЕБЕДЕВ", "ОРЛОВА", "МИХЕЕВ", "ЗАЙЦЕВ", "ФОМИН", "КРЫЛОВ", "ВОРОНОВ"]
        for rr in range(rows):
            d.text((x0 + 8, y0 + rr * ch + ch // 4), names[rr], font=f2, fill=ink)
            for cc in range(1, cols):
                if r.random() < 0.5:
                    d.text((x0 + cc * cw + cw // 2, y0 + rr * ch + ch // 4), "×", font=f2, fill=red, anchor="ma")
    base = np.asarray(im, dtype=F32) / 255.0

    # ageing: yellowing, damp, fading, tears, torn corners, a curl at one edge
    nz = _noise(w, h, 5, 5, seed + 1) * 0.5 + 0.5
    fine = _noise(w, h, 40, 4, seed + 2) * 0.5 + 0.5
    yellow = np.array(C("#c9b98f"), F32)
    col = base * (0.82 + nz[..., None] * 0.3)
    col = col * (1 - 0.28 * nz[..., None]) + yellow[None, None, :] * (0.28 * nz[..., None])
    damp = np.clip(_noise(w, h, 4, 4, seed + 3) * 0.5 + 0.5, 0, 1)
    damp = N.smoothstep(0.55, 0.85, damp)
    col = col * (1 - damp[..., None] * 0.35) + np.array(C("#8a7f66"), F32)[None, None, :] * (damp[..., None] * 0.35)
    col = col * (0.9 + fine[..., None] * 0.2)
    # paper alpha with torn edges
    ys, xs = np.mgrid[0:h, 0:w].astype(F32)
    ex = np.minimum(xs, w - 1 - xs) / w
    ey = np.minimum(ys, h - 1 - ys) / h
    tear = np.minimum(ex * 3.0, ey * 3.0) + (_noise(w, h, 30, 4, seed + 4)) * 0.20
    alpha = N.smoothstep(0.02, 0.05, tear)
    for i in range(int(r.integers(1, 3))):                       # a corner gone
        cx = r.choice([0.0, 1.0]) * w
        cy = r.choice([0.0, 1.0]) * h
        rad = r.uniform(0.10, 0.26) * h
        dd = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) + _noise(w, h, 16, 3, seed + 10 + i) * rad * 0.5
        alpha = alpha * N.smoothstep(rad * 0.75, rad, dd)
    height = alpha * 0.05 + _blur(alpha, 6) * 0.03
    nrm = _normal_from(_blur(height, 1.5), strength=4.0, alpha=alpha)
    return col, alpha, nrm, _orm(alpha, 0.9 - damp * 0.05)


def stencil_sheet(n=1024, seed=0):
    """Stencilled digits and short words, sprayed through a plate: bridges, bleed, overspray, wear."""
    r = _rng(seed)
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    cell = n // 4
    f = font(int(cell * 0.62), bold=True, mono=True)
    labels = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "OB", "12",
              "ВХОД", "ЦЕХ", "Н-2", "47"]
    rects = []
    for i, s in enumerate(labels):
        cx = (i % 4) * cell
        cy = (i // 4) * cell
        fs = f if len(s) <= 2 else font(int(cell * 0.30), bold=True, mono=True)
        d.text((cx + cell // 2, cy + cell // 2), s, font=fs, fill=255, anchor="mm")
        rects.append({"label": s, "px": [cx, cy, cell, cell],
                      "uv": [round(cx / n, 5), round(cy / n, 5), round((cx + cell) / n, 5), round((cy + cell) / n, 5)]})
    m = np.asarray(im, dtype=F32) / 255.0
    # stencil bridges: knock out thin horizontal bars
    ys, xs = np.mgrid[0:n, 0:n].astype(F32)
    bridge = ((ys % cell) > cell * 0.44) & ((ys % cell) < cell * 0.50)
    m = m * (1.0 - bridge.astype(F32) * 0.9)
    bleed = _blur(m, 1.6)
    over = grit(n, seed + 1, density=0.05, sizes=(0.6, 2.0), soft=0.5) * _blur(m, 9) * 1.5
    wear = N.fbm(n, 40, 4, seed + 2, min_res=256) * 0.5 + 0.5
    m = np.clip(m * N.smoothstep(0.25, 0.55, wear) + bleed * 0.25 + over * 0.5, 0, 1)
    alpha = np.clip(m, 0, 1)
    col = M.solid(n, C("#cfc9b8"))
    col = M.mul(col, 0.8 + (N.fbm(n, 80, 3, seed + 3, min_res=512) * 0.5 + 0.5) * 0.4)
    height = alpha * 0.03
    nrm = _normal_from(_blur(height, 1.0), strength=2.0, alpha=alpha)
    return col, alpha, nrm, _orm(alpha, 0.82), rects


# ---------------------------------------------------------------- driver

def generate(out, preview_dir=None):
    import time
    t0 = time.time()
    ENTRIES.clear()
    os.makedirs(out, exist_ok=True)

    for k, sz in (("concrete", 0.30), ("wood", 0.28), ("metal", 0.24), ("dirt", 0.34)):
        c, a, nn, oo = bullet(k, 512, seed=1000 + hash(k) % 977)
        _write(out, f"bullet_{k}", c, a, nn, oo, {"size_m": [sz, sz], "surface": k, "kind": "impact",
                                                  "depth_m": 0.06, "normal_fade": 0.9})
    for i in range(3):
        c, a, nn, oo = blood_splat(768, seed=1200 + i * 37, big=(i == 2))
        _write(out, f"blood_splat_{'abc'[i]}", c, a, nn, oo,
               {"size_m": [1.1 + 0.5 * i, 1.1 + 0.5 * i], "kind": "fluid", "albedo_mix": 1.0})
    for i in range(2):
        c, a, nn, oo = blood_drip(384, 768, seed=1300 + i * 41)
        _write(out, f"blood_drip_{'ab'[i]}", c, a, nn, oo, {"size_m": [0.5, 1.0], "kind": "fluid", "vertical": True})
    for i in range(2):
        c, a, nn, oo = puddle(1024, seed=1400 + i * 53)
        _write(out, f"puddle_{'ab'[i]}", c, a, nn, oo, {"size_m": [2.6, 2.6], "kind": "fluid", "ground": True})
    for i in range(2):
        c, a, nn, oo = oil(512, seed=1500 + i * 59)
        _write(out, f"oil_{'ab'[i]}", c, a, nn, oo, {"size_m": [1.4, 1.4], "kind": "fluid", "ground": True})
    for i in range(2):
        c, a, nn, oo = scorch(768, seed=1600 + i * 61)
        _write(out, f"scorch_{'ab'[i]}", c, a, nn, oo, {"size_m": [2.2, 2.2], "kind": "burn"})
    for i in range(3):
        c, a, nn, oo = rust_streak(384, 768, seed=1700 + i * 67)
        _write(out, f"rust_streak_{'abc'[i]}", c, a, nn, oo, {"size_m": [0.6, 1.4], "kind": "stain", "vertical": True})
    for i in range(3):
        c, a, nn, oo = moss_patch(768, seed=1800 + i * 71)
        _write(out, f"moss_{'abc'[i]}", c, a, nn, oo, {"size_m": [1.6, 1.6], "kind": "growth"})
    for i in range(3):
        c, a, nn, oo = crack_decal(1024, seed=1900 + i * 73, heavy=(i == 2))
        _write(out, f"crack_{'abc'[i]}", c, a, nn, oo, {"size_m": [2.4, 2.4], "kind": "damage"})
    for i, kind in enumerate(("block", "bar")):
        c, a, nn, oo = tyre_track(320, 1024, seed=2000 + i * 79, kind=kind)
        _write(out, f"tyre_{kind}", c, a, nn, oo,
               {"size_m": [0.24, 0.8], "kind": "track", "tiles_along_v": True})
    for i, right in enumerate((True, False)):
        c, a, nn, oo = footprint(320, 640, seed=2100 + i * 83, right=right)
        _write(out, f"footprint_{'r' if right else 'l'}", c, a, nn, oo,
               {"size_m": [0.13, 0.29], "kind": "track", "surface": "mud"})
    for i in range(3):
        c, a, nn, oo = poster(768, 1024, seed=2200 + i * 89, variant=i)
        _write(out, f"poster_{'abc'[i]}", c, a, nn, oo,
               {"size_m": [0.6, 0.8], "kind": "signage", "albedo_mix": 1.0})
    c, a, nn, oo, rects = stencil_sheet(1024, seed=2300)
    _write(out, "stencil_sheet", c, a, nn, oo,
           {"size_m": [1.0, 1.0], "kind": "signage", "atlas": rects,
            "note": "4x4 cells; use one cell per decal via the uv rect"})

    doc = {"note": "Projected decals. albedo carries alpha; place with Godot Decal nodes (albedo_mix 1.0 unless "
                   "the entry says otherwise). size_m is the suggested projector width/height in metres; "
                   "vertical entries hang on walls, ground entries lie flat.",
           "decals": ENTRIES}
    with open(os.path.join(out, "decals.json"), "w") as f:
        json.dump(doc, f, indent=1)
    if preview_dir:
        _preview(out, preview_dir)
    print(f"[decals] {len(ENTRIES)} decals in {time.time() - t0:.0f}s -> {out}", flush=True)
    return doc


def _preview(out, preview_dir):
    os.makedirs(preview_dir, exist_ok=True)
    cols = 6
    cell = 256
    rows = (len(ENTRIES) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (72, 74, 76))
    dr = ImageDraw.Draw(sheet)
    f = font(14, bold=False)
    for i, e in enumerate(ENTRIES):
        im = Image.open(os.path.join(out, os.path.basename(e["albedo"]))).convert("RGBA")
        im.thumbnail((cell - 8, cell - 8), Image.LANCZOS)
        bg = Image.new("RGBA", im.size, (110, 112, 108, 255))
        bg.alpha_composite(im)
        x = (i % cols) * cell + (cell - im.size[0]) // 2
        y = (i // cols) * cell + (cell - im.size[1]) // 2
        sheet.paste(bg.convert("RGB"), (x, y))
        dr.text(((i % cols) * cell + 4, (i // cols) * cell + 2), e["name"], font=f, fill=(240, 236, 228))
    sheet.save(os.path.join(preview_dir, "decals.png"))
