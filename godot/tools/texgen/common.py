"""Shared building blocks for material recipes: grids, stones, cracks, stains, speckles, rust."""
import numpy as np
from . import noise as N
from . import maps as M
from .draw import Canvas, stroke_field

F32 = np.float32


class Mat:
    """Result of a material recipe. albedo (n,n,3) sRGB in [0,1]; height/rough/metal (n,n) in [0,1]."""

    def __init__(self, n, tile_m=2.0, height_m=0.02):
        self.n = n
        self.tile_m = tile_m
        self.height_m = height_m
        self.albedo = np.zeros((n, n, 3), F32)
        self.height = np.zeros((n, n), F32)
        self.rough = np.full((n, n), 0.8, F32)
        self.metal = np.zeros((n, n), F32)
        self.ao_extra = None
        self.ao_strength = 1.0
        self.normal_strength = None
        self.meta = {}

    def finish(self):
        self.height = np.clip(self.height, 0.0, 1.0).astype(F32)
        self.albedo = np.clip(self.albedo, 0.0, 1.0).astype(F32)
        self.rough = np.clip(self.rough, 0.02, 1.0).astype(F32)
        self.metal = np.clip(self.metal, 0.0, 1.0).astype(F32)
        return self


def px_per_m(n, tile_m):
    return n / tile_m


# ----------------------------------------------------------------- masks and fields

def speckle(n, density, seed, size=(1, 3), soft=0.6):
    """Random dots (n,n) in [0,1]: density per pixel^2 fraction, sizes in px."""
    r = N.rng_for(seed)
    cnt = int(density * n * n)
    c = Canvas(n, "F", 0.0)
    xs = r.uniform(0, n, cnt)
    ys = r.uniform(0, n, cnt)
    ss = r.uniform(size[0], size[1], cnt)
    vs = r.uniform(0.5, 1.0, cnt)
    for x, y, s, v in zip(xs, ys, ss, vs):
        c.ellipse(x, y, s, s * r.uniform(0.7, 1.0), float(v))
    a = c.array()
    return N.blur(a, soft) if soft > 0 else a


def blotches(n, cells, seed, threshold=0.55, softness=0.08, octaves=6, warp_amt=0.0, gain=0.55):
    """Organic patches mask from thresholded warped fbm with detailed (broken) edges, in [0,1]."""
    f = N.fbm(n, cells, octaves, seed, gain=gain, min_res=256)
    if warp_amt > 0:
        w1 = N.fbm(n, max(2, cells // 2), 4, seed + 11, min_res=256)
        w2 = N.fbm(n, max(2, cells // 2), 4, seed + 23, min_res=256)
        f = N.warp(f, w1 * warp_amt, w2 * warp_amt)
    f = f * 0.5 + 0.5
    return N.smoothstep(threshold - softness, threshold + softness, f)


def crack_lines(n, count, seed, length=(0.15, 0.5), wander=0.05, kink_every=(12, 40), kink=(0.35, 1.1),
                branch_p=0.35, step=3.0, start_mask=None, direction=None, dir_spread=1.0, depth=0):
    """Realistic crack paths: long straight-ish runs with occasional sharp kinks, branches at kinks.
    Returns list of (points array, width_scale) where width_scale tapers 1 -> 0 along the path."""
    r = N.rng_for(seed)
    lines = []
    todo = []
    for i in range(count):
        if start_mask is not None:
            ys, xs = np.nonzero(start_mask > 0.5)
            if len(xs) == 0:
                break
            k = r.integers(len(xs))
            p = np.array([xs[k], ys[k]], dtype=np.float64) + r.uniform(-2, 2, 2)
        else:
            p = r.uniform(0, n, 2)
        ang = r.uniform(0, 2 * np.pi) if direction is None else direction + r.normal(0, dir_spread)
        ln = int(r.uniform(*length) * n / step)
        todo.append((p, ang, ln, 0, 1.0))
    while todo:
        p, ang, nsteps, dep, w0 = todo.pop()
        pts = [p.copy()]
        next_kink = int(r.integers(*kink_every))
        for s in range(nsteps):
            ang += r.normal(0.0, wander)
            next_kink -= 1
            if next_kink <= 0:
                next_kink = int(r.integers(*kink_every))
                turn = r.uniform(*kink) * r.choice([-1, 1])
                if dep < 3 and r.random() < branch_p:
                    todo.append((p.copy(), ang + turn * r.uniform(1.2, 2.0), max(6, int((nsteps - s) * r.uniform(0.3, 0.7))), dep + 1, w0 * (1.0 - s / nsteps) * 0.8))
                ang += turn * 0.5
            p = p + step * np.array([np.cos(ang), np.sin(ang)])
            pts.append(p + r.normal(0.0, 0.6, 2))
        lines.append((np.array(pts), w0))
    return lines


def crack_mask(n, lines, width=2.0, soft=0.7, taper=0.85):
    """Rasterise crack paths with width tapering along each path."""
    c = Canvas(n, "F", 0.0)
    for pts, w0 in lines:
        m = len(pts)
        seg = max(1, m // 12)
        for i in range(0, m - 1, seg):
            t = i / max(1, m - 1)
            w = width * w0 * (1.0 - taper * t)
            wi = max(1, int(round(w)))
            val = float(min(1.0, w / max(1.0, wi) if w < 1.0 else 1.0))
            c.line(pts[i:i + seg + 1], val, width=wi)
    a = c.array()
    if soft > 0:
        a = N.blur(a, soft)
    return np.clip(a, 0, 1).astype(F32)


def crack_network(n, count, seed, steps=(120, 600), step_len=3.0, wander=0.3, branch_p=0.02, width=2.0, soft=0.8,
                  start_mask=None, length=None):
    """Crack network (mask, lines). Kept signature for older recipes; uses the kinked generator."""
    if length is None:
        length = (steps[0] * step_len / n, steps[1] * step_len / n)
    lines = crack_lines(n, count, seed, length=length, wander=min(wander, 0.08), branch_p=max(branch_p, 0.3),
                        step=step_len, start_mask=start_mask)
    m = crack_mask(n, lines, width=width, soft=soft)
    return m, lines


def polygon_cracks(n, cells, seed, width=2.0, jitter=1.0, aniso=1.0, soft=1.0, warp_amt=6.0):
    """Cracks along Worley cell boundaries (dried mud, crazing). Returns (mask, f1, cid)."""
    f1, f2, cid = N.worley(n, cells, seed, jitter=jitter, aniso=aniso)
    edge = f2 - f1  # 0 at boundary
    if warp_amt > 0:
        w1 = N.fbm(n, cells * 2, 3, seed + 5, min_res=256)
        w2 = N.fbm(n, cells * 2, 3, seed + 6, min_res=256)
        edge = N.warp(edge, w1 * warp_amt, w2 * warp_amt)
        f1 = N.warp(f1, w1 * warp_amt, w2 * warp_amt)
        cid = N.warp(cid.astype(F32), w1 * warp_amt, w2 * warp_amt, order=0).astype(np.int32)
    wpx = width * cells / n
    mask = 1.0 - N.smoothstep(0.0, wpx, edge)
    if soft > 0:
        mask = N.blur(mask, soft)
    return mask.astype(F32), f1, cid


def stones(n, cells, seed, jitter=0.9, aniso=1.0, round_=0.5, gap=0.08, warp_amt=4.0):
    """Packed stones: per-cell dome height in [0,1] (0 in gaps), cell ids, and edge mask.

    round_ controls dome profile (0 flat plates .. 1 spherical). gap is the boundary width in cell units.
    """
    f1, f2, cid, dx, dy = N.worley(n, cells, seed, jitter=jitter, aniso=aniso, extra=True)
    if warp_amt > 0:
        w1 = N.fbm(n, cells, 3, seed + 3, min_res=256)
        w2 = N.fbm(n, cells, 3, seed + 4, min_res=256)
        f1 = N.warp(f1, w1 * warp_amt, w2 * warp_amt)
        f2 = N.warp(f2, w1 * warp_amt, w2 * warp_amt)
        cid = N.warp(cid.astype(F32), w1 * warp_amt, w2 * warp_amt, order=0).astype(np.int32)
    edge = f2 - f1
    inside = N.smoothstep(0.0, gap, edge)          # 0 at boundary -> 1 inside
    # dome: distance to boundary normalised by distance to centre
    t = np.clip(edge / np.maximum(f1 + edge, 1e-4), 0, 1)   # 0 at edge, ~1 at centre
    dome = np.sqrt(np.clip(1.0 - (1.0 - t) ** 2, 0, 1)) * round_ + t * (1.0 - round_)
    h = dome * inside
    return h.astype(F32), cid, (1.0 - inside).astype(F32), f1


def running_bond(n, cols, rows, mortar=0.12, seed=0, jitter_px=0.0, offset=0.5):
    """Running-bond brick layout. Returns (brick_id (n,n) int, u (n,n) 0..1 across brick, v (n,n) 0..1 up brick,
    edge_dist (n,n) distance to nearest brick edge in brick-height units, mortar mask)."""
    x, y = N.coords(n)
    bw = n / cols
    bh = n / rows
    row = np.floor(y / bh).astype(np.int32)
    xs = x + (row % 2) * bw * offset
    if jitter_px > 0:
        r = N.rng_for(seed)
        jit = r.uniform(-jitter_px, jitter_px, rows)
        xs = xs + jit[row % rows][:, None] if False else xs
    col = np.floor(xs / bw).astype(np.int32)
    u = (xs / bw) - col
    v = (y / bh) - row
    bid = (row % rows) * (cols + 1) + (col % (cols + 1))
    # distances to edges in pixels
    mw = mortar * bh
    dxe = np.minimum(u, 1 - u) * bw
    dye = np.minimum(v, 1 - v) * bh
    d = np.minimum(dxe, dye)
    mortar_mask = 1.0 - N.smoothstep(mw * 0.5, mw * 0.5 + 1.5, d)
    return bid, u.astype(F32), v.astype(F32), (d / bh).astype(F32), mortar_mask.astype(F32), dxe.astype(F32), dye.astype(F32)


def seams_grid(n, nx, ny, width_px, depth=1.0, chamfer_px=None, jitter=None):
    """V-groove seams every n/nx horizontally and n/ny vertically. Returns depth mask in [0,1] (1 deepest) and a
    thin line mask for the seam centre."""
    x, y = N.coords(n)
    out = np.zeros((n, n), F32)
    line = np.zeros((n, n), F32)
    ch = width_px * 1.6 if chamfer_px is None else chamfer_px
    if nx > 0:
        px = n / nx
        dx = np.abs(((x + px * 0.5) % px) - px * 0.5)
        if jitter is not None:
            dx = dx + jitter
        out = np.maximum(out, 1.0 - N.smoothstep(width_px * 0.5, ch, dx))
        line = np.maximum(line, 1.0 - N.smoothstep(0.0, width_px * 0.5, dx))
    if ny > 0:
        py = n / ny
        dy = np.abs(((y + py * 0.5) % py) - py * 0.5)
        if jitter is not None:
            dy = dy + jitter
        out = np.maximum(out, 1.0 - N.smoothstep(width_px * 0.5, ch, dy))
        line = np.maximum(line, 1.0 - N.smoothstep(0.0, width_px * 0.5, dy))
    return (out * depth).astype(F32), line.astype(F32)


def holes_grid(n, nx, ny, radius_px, seed=0, ox=0.5, oy=0.5, jitter_px=0.0, profile="cone"):
    """Circular holes at grid centres (form ties, bolts). Returns depth mask [0,1] and ring mask."""
    x, y = N.coords(n)
    px = n / nx
    py = n / ny
    if jitter_px > 0:
        # per-hole jitter through a low-frequency periodic warp of the coordinate grid
        x = x + N.fbm(n, nx, 1, seed + 1, cells_y=ny, min_res=256) * jitter_px * 2
        y = y + N.fbm(n, nx, 1, seed + 2, cells_y=ny, min_res=256) * jitter_px * 2
    dx = ((x - ox * px + px * 0.5) % px) - px * 0.5
    dy = ((y - oy * py + py * 0.5) % py) - py * 0.5
    d = np.sqrt(dx * dx + dy * dy)
    if profile == "cone":
        prof = np.sqrt(np.clip(1.0 - d / radius_px, 0, 1))
    else:
        prof = 1.0 - N.smoothstep(radius_px * 0.8, radius_px, d)
    out = prof.astype(F32)
    ring = N.blur(out, 3) - out
    return out, np.clip(ring * 3, 0, 1).astype(F32)


def stain_down(source, decay=0.992, seed=0, strength=1.0, thin=True, n=None):
    """Water/rust drip streaks under `source`: thinned by vertical column noise so streaks are ragged."""
    n = source.shape[0]
    col = N.fbm(n, 128, 3, seed + 41, cells_y=8, min_res=512) * 0.5 + 0.5
    src = source * (0.4 + 0.6 * col) if thin else source
    d = N.drips(src, decay=decay, noise=col, strength=strength)
    return np.clip(d, 0, 1).astype(F32)


def grain_stripes(n, seed, freq=60.0, warp_cells=6, warp_amt=40.0, along="y", ring_noise=0.0):
    """Wood-grain like stripes (0..1) along an axis, warped by low-frequency noise."""
    x, y = N.uv(n)
    w = N.fbm(n, warp_cells, 4, seed, min_res=256)
    w2 = N.fbm(n, warp_cells * 4, 3, seed + 7, min_res=512)
    coord = x if along == "y" else y
    # keep periodicity: warp must be periodic (it is), stripe freq integer
    phase = coord * float(int(freq)) + w * (warp_amt / n * freq) + w2 * (warp_amt * 0.15 / n * freq)
    s = 0.5 + 0.5 * np.sin(phase * 2 * np.pi)
    if ring_noise > 0:
        s = np.clip(s + N.fbm(n, 64, 3, seed + 9) * ring_noise, 0, 1)
    return s.astype(F32)


def aniso_noise(n, seed, cells_x, cells_y, octaves=4):
    return N.fbm(n, cells_x, octaves, seed, cells_y=cells_y)


# ----------------------------------------------------------------- colour recipes

def tone(base, n, variation=0.06, seed=0, cells=3, hue=0.01, sat=0.03):
    """Solid colour with low-frequency mottling in value/hue/sat."""
    v = N.fbm(n, cells, 4, seed, min_res=256)
    h = N.fbm(n, cells * 2, 3, seed + 1, min_res=256)
    s = N.fbm(n, cells * 3, 3, seed + 2, min_res=256)
    c = M.solid(n, base)
    c = M.hsv_shift(c, dh=h * hue, ds=s * sat, dv=v * variation)
    return c


def rust_colour(n, seed, dark=(0.20, 0.11, 0.07), mid=(0.45, 0.24, 0.12), bright=(0.62, 0.36, 0.16)):
    """Layered rust colour field in [0,1]^3 with pitting; returns (rgb, pit_height)."""
    f = N.fbm(n, 12, 6, seed, min_res=256) * 0.5 + 0.5
    g = N.fbm(n, 48, 4, seed + 1, min_res=512) * 0.5 + 0.5
    pits = N.worley(n, 200, seed + 2)[0]
    pit = 1.0 - N.smoothstep(0.15, 0.45, pits)
    t = np.clip(f * 0.7 + g * 0.5 - 0.1, 0, 1)
    c = M.mix(M.solid(n, dark), M.solid(n, mid), N.smoothstep(0.2, 0.6, t))
    c = M.mix(c, M.solid(n, bright), N.smoothstep(0.55, 0.9, t) * (0.5 + 0.5 * g))
    c = M.mix(c, M.solid(n, dark), pit * 0.7)
    return c, (pit * (0.5 + 0.5 * g)).astype(F32)


def sprinkle_lines(n, count, seed, length=(10, 60), width=(1, 2), angle=None, spread=0.3, soft=0.5, curve=0.0):
    """Scratch-like short lines mask."""
    r = N.rng_for(seed)
    c = Canvas(n, "F", 0.0)
    for i in range(count):
        x0, y0 = r.uniform(0, n, 2)
        ln = r.uniform(*length)
        a = r.uniform(0, np.pi) if angle is None else angle + r.normal(0, spread)
        w = r.uniform(*width)
        pts = []
        k = max(2, int(ln / 6))
        for s in range(k + 1):
            t = s / k
            aa = a + curve * (t - 0.5)
            pts.append((x0 + np.cos(aa) * ln * t, y0 + np.sin(aa) * ln * t))
        c.line(pts, float(r.uniform(0.6, 1.0)), width=max(1, int(w)))
    a = c.array()
    return N.blur(a, soft) if soft > 0 else a
