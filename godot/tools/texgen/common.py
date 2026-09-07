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
        # texel-scale grain applied by finish(): (albedo, height, roughness) amounts. Real surfaces are never
        # smooth at 1:1 — without this every material reads as a blurred gradient when the player stands close.
        self.micro_amt = (0.075, 0.010, 0.055)
        self.micro_seed = 7717

    def finish(self):
        n = self.n
        for k in ("height", "rough", "metal"):
            v = getattr(self, k)
            if np.ndim(v) == 0:
                setattr(self, k, np.full((n, n), float(v), F32))
        if self.micro_amt:
            a, hh, rr = self.micro_amt
            g = micrograin(n, self.micro_seed)
            if a:
                self.albedo = self.albedo * (1.0 + g[..., None] * F32(a * 2.0))
            if hh:
                self.height = self.height + g * F32(hh * 2.0)
            if rr:
                self.rough = self.rough + g * F32(rr * 2.0)
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


def crack_lines(n, count, seed, length=(0.15, 0.5), wander=0.02, kink_every=(30, 120), kink=(0.3, 0.9),
                branch_p=0.3, step=3.0, start_mask=None, direction=None, dir_spread=1.0, depth=0, curvature=0.004, jag=0.12):
    """Realistic crack paths: long persistent runs with gentle drift (Ornstein-Uhlenbeck curvature), rare sharp
    kinks, and short thinner branches leaving at kinks. No per-point jitter (that reads as hair, not as a crack).
    Returns a list of (points (k,2) float array, width_scale in (0,1])."""
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
        ln = max(4, int(r.uniform(*length) * n / step))
        todo.append((p, ang, ln, 0, 1.0))
    while todo:
        p, ang, nsteps, dep, w0 = todo.pop()
        pts = [p.copy()]
        curv = 0.0
        next_kink = int(r.integers(*kink_every))
        for s in range(nsteps):
            curv = curv * 0.96 + r.normal(0.0, curvature)
            ang += curv + r.normal(0.0, wander)
            if s % 5 == 0:
                ang += r.uniform(-jag, jag)                       # aggregate deflects the crack a little
            next_kink -= 1
            if next_kink <= 0:
                next_kink = int(r.integers(*kink_every))
                turn = r.uniform(*kink) * r.choice([-1, 1])
                if dep < 2 and r.random() < branch_p:
                    bl = max(6, int((nsteps - s) * r.uniform(0.25, 0.6)))
                    todo.append((p.copy(), ang - turn * r.uniform(0.8, 1.6), bl, dep + 1, w0 * r.uniform(0.45, 0.7)))
                ang += turn
                curv = 0.0
            p = p + step * np.array([np.cos(ang), np.sin(ang)])
            pts.append(p.copy())
        lines.append((np.array(pts), w0))
    return lines


def crack_mask(n, lines, width=2.0, soft=0.7, taper=0.85, supersample=2, wobble=0.0, seed=0):
    """Rasterise crack paths into an (n,n) mask in [0,1]. Width is widest around a third of the way along and
    tapers to a hairline at both ends; drawn at `supersample` x resolution and box-filtered so sub-pixel widths
    read as fainter lines rather than aliased steps."""
    ss = max(1, int(supersample))
    m_ = n * ss
    c = Canvas(m_, "F", 0.0)
    r = N.rng_for(seed + 7)
    for pts, w0 in lines:
        m = len(pts)
        if m < 2:
            continue
        seg = max(1, m // 16)
        for i in range(0, m - 1, seg):
            t = i / max(1, m - 1)
            env = min(1.0, t / 0.12, (1.0 - t) / 0.45 + 0.05)          # fast open, slow close
            w = width * w0 * (1.0 - taper * (1.0 - env)) * ss
            if wobble > 0:
                w *= 1.0 + r.uniform(-wobble, wobble)
            wi = max(1, int(round(w)))
            val = float(min(1.0, w / wi)) if w < 1.0 else 1.0
            c.line(pts[i:i + seg + 1] * ss, val, width=wi)
    a = c.array()
    if ss > 1:
        a = a.reshape(n, ss, n, ss).mean(axis=(1, 3))
    if soft > 0:
        a = N.blur(a, soft)
    return np.clip(a, 0, 1).astype(F32)


def crack_network(n, count, seed, steps=(120, 600), step_len=3.0, wander=0.3, branch_p=0.02, width=2.0, soft=0.8,
                  start_mask=None, length=None):
    """Crack network (mask, lines). Kept signature for older recipes; uses the kinked generator."""
    if length is None:
        length = (steps[0] * step_len / n, steps[1] * step_len / n)
    lines = crack_lines(n, count, seed, length=length, wander=min(wander, 0.03), branch_p=max(branch_p, 0.3),
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


# ----------------------------------------------------------------- stroke rendering (grass, litter, fibres)

def flow_angle(n, seed, cells=3, swirl=1.0):
    """Coherent direction field in radians (periodic): dead grass lies in swirls, not at random."""
    a = N.fbm(n, cells, 3, seed, min_res=256)
    b = N.fbm(n, cells * 3, 3, seed + 1, min_res=256)
    return (a * np.pi * swirl + b * 0.5).astype(F32)


def draw_strokes(n, seed, count, length, width, colors, flow=None, follow=0.8, curl=0.3, shade=(0.6, 1.1),
                 tip_light=0.35, height=(0.4, 1.0), ss=2, segments=7, taper=0.75, weights=None):
    """Draw `count` tapered curved strokes (blades, straws, needles) at `ss`x supersampling.

    Returns (rgb premultiplied by coverage (n,n,3), coverage (n,n), height (n,n)). Colours are picked from
    `colors` (sRGB tuples) with optional weights; each stroke gets a random brightness in `shade`, brightening
    toward its tip by `tip_light`. Height rises along the stroke from height[0] to height[1].
    """
    r = N.rng_for(seed)
    m = n * ss
    crgb = Canvas(m, "RGB", (0, 0, 0))
    ch = Canvas(m, "F", 0.0)
    cols = np.asarray(colors, F32)
    w = None if weights is None else np.asarray(weights, float) / np.sum(weights)
    xs = r.uniform(0, n, count)
    ys = r.uniform(0, n, count)
    lns = r.uniform(length[0], length[1], count)
    wds = r.uniform(width[0], width[1], count)
    bends = r.uniform(-curl, curl, count)
    shades = r.uniform(shade[0], shade[1], count)
    cis = r.choice(len(cols), size=count, p=w)
    angs = r.uniform(0, 2 * np.pi, count)
    if flow is not None:
        fa = flow[np.clip(ys.astype(int), 0, n - 1), np.clip(xs.astype(int), 0, n - 1)]
        mixf = r.random(count) < follow
        angs = np.where(mixf, fa + r.normal(0, 0.25, count), angs)
    for i in range(count):
        x0, y0, ln, wd, bend, sh, ci, a = xs[i], ys[i], lns[i], wds[i], bends[i], shades[i], cis[i], angs[i]
        col = cols[ci] * sh
        pts = []
        for s in range(segments + 1):
            t = s / segments
            aa = a + bend * t * t * 2.5
            pts.append((x0 + np.cos(aa) * ln * t, y0 + np.sin(aa) * ln * t))
        for s in range(segments):
            t = s / segments
            ww = max(1, int(round(wd * (1 - taper * t) * ss)))
            c = np.clip(col * (1.0 + tip_light * t), 0, 1)
            seg = [(px * ss, py * ss) for px, py in pts[s:s + 2]]
            crgb.line(seg, (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255)), width=ww)
            ch.line(seg, float(height[0] + (height[1] - height[0]) * t), width=ww)
    rgb = np.asarray(crgb.im).astype(F32) / 255.0
    h = ch.array()
    cov = (h > 0).astype(F32)
    if ss > 1:
        rgb = rgb.reshape(n, ss, n, ss, 3).mean(axis=(1, 3))
        cov = cov.reshape(n, ss, n, ss).mean(axis=(1, 3))
        h = h.reshape(n, ss, n, ss).max(axis=(1, 3))
    return rgb.astype(F32), cov.astype(F32), h.astype(F32)


def composite_strokes(base, rgb, cov):
    """Blend premultiplied stroke colour over base by coverage."""
    return (base * (1.0 - cov)[..., None] + rgb).astype(F32)


def pebble_field(n, seed, layers, palette, base_h, base_col, embed=0.35, fine=None):
    """Embedded stones of several sizes. layers = [(cells, keep_fraction, height_amp)]. Returns (h, col, mask).
    Stones sit partly below the ground (embed) so only their tops show, with per-stone colour and a rim of soil."""
    h = base_h.copy()
    col = base_col.copy()
    total_mask = np.zeros((n, n), F32)
    for li, (cells, keep, amp) in enumerate(layers):
        hh, cid, edge, f1 = stones(n, cells, seed + li * 17, jitter=1.0, round_=0.75, gap=0.3, warp_amt=max(1.5, 24.0 / cells * 4))
        cv = N.cell_random(cid, cells * cells, seed + li * 17 + 1, k=3)
        keep_m = N.smoothstep(1 - keep - 0.02, 1 - keep + 0.02, cv[..., 0])
        size = 0.55 + 0.45 * cv[..., 1]
        top = base_h + (hh * size - embed) * amp
        mask = (top > h) & (hh > 0.05)
        maskf = mask.astype(F32) * keep_m
        maskf = np.clip(maskf, 0, 1)
        h = np.where(maskf > 0.5, top, h)
        sc = M.solid(n, palette[0])
        for i, cc in enumerate(palette[1:]):
            sc = M.mix(sc, M.solid(n, cc), N.smoothstep(i / len(palette), (i + 1) / len(palette), cv[..., 2]))
        if fine is not None:
            sc = M.mul(sc, 0.85 + fine * 0.3)
        sc = M.mul(sc, 0.8 + hh * 0.3)                       # rounded shading: tops lighter
        col = M.mix(col, sc, maskf)
        total_mask = np.maximum(total_mask, maskf)
    return h.astype(F32), col, total_mask


def gauss_bumps(n, seed, count, sigma, amp=(0.5, 1.0), aniso=1.0):
    """Sum of `count` gaussian bumps at random positions (periodic via FFT). Cushions, clods, hummocks."""
    r = N.rng_for(seed)
    pts = np.zeros((n, n), F32)
    xs = r.integers(0, n, count)
    ys = r.integers(0, n, count)
    vs = r.uniform(amp[0], amp[1], count)
    np.add.at(pts, (ys, xs), vs)
    f = np.fft.rfftfreq(n)[None, :]
    g = np.fft.fftfreq(n)[:, None]
    k = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (f * f * aniso + g * g / aniso))
    out = np.fft.irfft2(np.fft.rfft2(pts.astype(np.float64)) * k, s=(n, n)).astype(F32)
    out *= 2 * np.pi * sigma * sigma
    return out


# ----------------------------------------------------------------- texel-scale detail

_MICRO_CACHE = {}


def micrograin(n, seed=7717):
    """Periodic grain from ~1 px to ~8 px, normalised to about [-0.5, 0.5]. Cached per (n, seed)."""
    key = (n, seed)
    g = _MICRO_CACHE.get(key)
    if g is not None:
        return g
    r = N.rng_for(seed)
    w = (r.random((n, n)).astype(F32) - 0.5)
    a = N.blur(w, 0.55)
    a = a / (a.std() + 1e-6)
    b = N.blur(w, 1.7)
    b = b / (b.std() + 1e-6)
    c = N.blur(w, 4.5)
    c = c / (c.std() + 1e-6)
    g = (a * 0.30 + b * 0.24 + c * 0.20).astype(F32)
    g = np.clip(g, -0.5, 0.5)
    if len(_MICRO_CACHE) > 4:
        _MICRO_CACHE.clear()
    _MICRO_CACHE[key] = g
    return g


def grit(n, seed, density=0.35, sizes=(0.6, 2.2), soft=0.35):
    """Fine sand/aggregate grains: many small blurred dots, tileable. Returns [0,1]."""
    r = N.rng_for(seed)
    cnt = int(density * n * n / 40.0)
    c = Canvas(n, "F", 0.0)
    xs = r.uniform(0, n, cnt)
    ys = r.uniform(0, n, cnt)
    ss = r.uniform(sizes[0], sizes[1], cnt) ** 1.6
    vs = r.uniform(0.35, 1.0, cnt)
    for x, y, sz, v in zip(xs, ys, ss, vs):
        c.ellipse(x, y, sz, sz * r.uniform(0.7, 1.15), float(v))
    a = c.array()
    return (N.blur(a, soft) if soft > 0 else a).astype(F32)


def fibres(n, seed, count, length=(20, 120), width=(1, 2), angle=0.0, spread=0.25, curve=0.6, soft=0.4):
    """Directional fibres (paper, canvas, felt, cloth nap)."""
    return sprinkle_lines(n, count, seed, length=length, width=width, angle=angle, spread=spread,
                          soft=soft, curve=curve)


def orange_peel(n, seed, cells=220, amount=1.0):
    """The dimpled micro-relief of sprayed/brushed paint. Returns [-1,1]-ish."""
    w = N.worley(n, cells, seed, jitter=1.0)[0]
    d = (N.blur(w, 1.4) - N.blur(w, 5.0))
    d = d / (np.abs(d).max() + 1e-6)
    return (d * amount).astype(F32)


def flake(n, seed, coverage=0.5, cells=26, edge=0.06):
    """Paint flaking: a warped noise thresholded into islands with hard edges (peeled area = 1)."""
    f = N.fbm(n, cells, 5, seed, min_res=256)
    wx = N.fbm(n, cells // 2 + 1, 3, seed + 3, min_res=256) * (n / cells * 0.5)
    wy = N.fbm(n, cells // 2 + 1, 3, seed + 4, min_res=256) * (n / cells * 0.5)
    f = N.warp(f, wx, wy)
    lo = np.quantile(f, np.clip(1.0 - coverage, 0.02, 0.98))
    return N.smoothstep(lo - edge, lo + edge, f).astype(F32)


def scratch_set(n, seed, groups=((240, (40, 260), (1, 2)), (60, (200, 700), (1, 3)))):
    """Layered scratches: many short random ones plus a few long directional ones."""
    out = np.zeros((n, n), F32)
    for i, (cnt, ln, wd) in enumerate(groups):
        a = None if i % 2 == 0 else N.rng_for(seed + i).uniform(0, np.pi)
        out = np.maximum(out, sprinkle_lines(n, cnt, seed + i * 31, length=ln, width=wd,
                                             angle=a, spread=0.25, soft=0.45, curve=0.25))
    return out
