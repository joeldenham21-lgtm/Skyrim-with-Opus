"""Material recipes, third pass — rewrites of every kind that did not survive a 1:1 crop test.

The failure mode of the earlier passes was band-limited noise: at a 1 m viewing distance a 2048 map over a 2 m
tile shows one texel per millimetre, and smooth fbm has nothing left there. Every recipe here builds four scale
bands explicitly — form (0.1-1 m), feature (1-10 cm), detail (1-10 mm) and grain (texel, added by Mat.finish) —
and drives colour from the height stack so cavities hold dirt and edges show wear.

These names take priority over materials.py / materials2.py (see gen_textures.KINDS).
"""
import numpy as np

from . import maps as M
from . import noise as N
from .common import (Mat, blotches, crack_lines, crack_mask, flake, grit, holes_grid, micrograin, orange_peel,
                     pebble_field, polygon_cracks, running_bond, scratch_set, seams_grid, speckle, sprinkle_lines,
                     stain_down, stones, tone)
from .draw import Canvas

F32 = np.float32
C = M.hexc


def rnd(seed, n):
    return N.rng_for(seed).random((n, n), dtype=F32)


def _bands(n, seed, cells=(3, 12, 48, 200)):
    """Four scale bands of periodic noise in [-0.5, 0.5]."""
    return [N.fbm(n, c, 4 if c < 40 else 3, seed + i * 37, min_res=256 if c < 40 else 512) * 0.5
            for i, c in enumerate(cells)]


# ============================================================== masonry and render

def concrete(n, seed=100):
    """Board-formed cast concrete: form boards and ties, bug holes, exposed aggregate where it has spalled,
    a real crack network with efflorescence, and run-off staining below every hole and crack."""
    m = Mat(n, tile_m=2.0, height_m=0.035)
    ppm = n / m.tile_m
    b0, b1, b2, b3 = _bands(n, seed)
    grain = rnd(seed + 1, n) - 0.5

    # --- form work: horizontal boards 150 mm, each with its own set-back and a lipped joint
    yv = N.coords(n)[1] / (0.150 * ppm)
    board_id = np.floor(yv).astype(np.int32)
    bfrac = yv - board_id
    bset = N.cell_random(board_id % 64, 64, seed + 2, k=2)
    joint = (1.0 - N.smoothstep(0.0, 0.030, np.minimum(bfrac, 1.0 - bfrac)))
    board_face = (bset[..., 0] - 0.5) * 0.10 + np.sin(bfrac * np.pi) * 0.02
    grain_of_form = N.fbm(n, 8, 3, seed + 3, cells_y=180, min_res=512) * 0.35   # board grain printed into the face
    # panel seam every tile height, with a leak line
    seam, seam_line = seams_grid(n, 1, 2, width_px=0.010 * ppm, chamfer_px=0.02 * ppm)

    # --- ties
    holes, ring = holes_grid(n, 4, 3, radius_px=0.013 * ppm, seed=seed + 4, jitter_px=6)
    plugged = N.smoothstep(0.35, 0.4, N.value_noise(n, 6, seed + 5))

    # --- surface porosity
    bug = grit(n, seed + 6, density=0.030, sizes=(0.7, 2.3), soft=0.5)
    bug = N.smoothstep(0.30, 0.85, bug) * N.smoothstep(0.45, 0.95, blotches(n, 7, seed + 7, threshold=0.45,
                                                                           softness=0.22, warp_amt=45) + 0.30)
    sandy = grit(n, seed + 8, density=0.5, sizes=(0.5, 1.4), soft=0.3)

    # --- spalling: hard-edged patches with aggregate showing through
    spall = flake(n, seed + 9, coverage=0.10, cells=9, edge=0.012)
    spall = spall * N.smoothstep(0.3, 0.7, blotches(n, 3, seed + 10, threshold=0.45, softness=0.2, warp_amt=60) + 0.2)
    spall_rim = np.clip((N.blur(spall, 4) - spall) * 5.0, 0, 1)
    agg_h, agg_c, agg_m = pebble_field(
        n, seed + 11, [(90, 0.55, 0.55), (170, 0.6, 0.35), (330, 0.7, 0.2)],
        [C("#8b8880"), C("#6f6a62"), C("#9c968c"), C("#57534c")], np.zeros((n, n), F32),
        M.solid(n, C("#77736b")), embed=0.45, fine=grain)

    # --- cracks
    ln = crack_lines(n, 3, seed + 12, length=(0.35, 0.9), wander=0.05, branch_p=0.45)
    ln += crack_lines(n, 7, seed + 13, length=(0.10, 0.30), wander=0.09, branch_p=0.3)
    crack = crack_mask(n, ln, width=3.4, soft=0.5, wobble=1.6, seed=seed + 14)
    hair = crack_mask(n, crack_lines(n, 14, seed + 15, length=(0.03, 0.14), wander=0.14, branch_p=0.35,
                                     kink_every=(6, 24)), width=1.4, soft=0.35)
    edge_chip = flake(n, seed + 16, coverage=0.35, cells=60, edge=0.05) * N.smoothstep(0.02, 0.25, N.blur(crack, 5))

    h = 0.74 + b1 * 0.05 + b2 * 0.03 + b3 * 0.02 + board_face * 0.5 * 0.06 + grain_of_form * 0.012 + sandy * 0.008
    h -= joint * 0.06 + seam * 0.30 + holes * 0.55 * (1.0 - plugged * 0.6) + bug * 0.20
    h -= crack * 0.30 + hair * 0.08 + edge_chip * 0.10
    h = np.where(spall > 0.5, 0.62 + agg_h * 0.22 + b3 * 0.02, h)
    h += spall_rim * 0.02
    m.height = np.clip(h, 0, 1)

    # --- colour
    base = tone(C("#75726c"), n, variation=0.10, seed=seed + 17, cells=2, hue=0.015, sat=0.05)
    base = M.mul(base, 1.0 + b2 * 0.12 + b3 * 0.10 + grain * 0.09 + sandy * 0.10)
    base = M.mix(base, M.solid(n, C("#8e8b84")), np.clip(sandy * 0.5, 0, 1) * 0.25)
    base = M.mul(base, 1.0 - board_face * 0.25 - grain_of_form * 0.10)
    base = M.mix(base, M.solid(n, C("#332f2b")), N.smoothstep(0.15, 0.9, bug) * 0.75)
    base = M.mix(base, agg_c, spall)
    base = M.mix(base, M.solid(n, C("#a5a199")), spall_rim * (1 - spall) * 0.5)
    base = M.mul(base, 1.0 - crack * 0.55 - hair * 0.30 - joint * 0.12 - seam * 0.35)
    base = M.mix(base, M.solid(n, C("#2f2c29")), holes * 0.7 * (1 - plugged))
    base = M.mix(base, M.solid(n, C("#8d887e")), holes * plugged * 0.6)

    # weathering
    src = np.clip(crack * 0.8 + holes * 1.0 + np.roll(seam, 5, axis=0) * 0.8 + bug * 0.35 + spall_rim * 0.5, 0, 1)
    src = src * (rnd(seed + 18, n) < 0.30)
    stain = stain_down(src, decay=0.9958, seed=seed + 19, strength=1.0)
    stain = np.clip(stain * (0.45 + 0.55 * (N.fbm(n, 30, 4, seed + 20, min_res=512) * 0.5 + 0.5)), 0, 1)
    base = M.mix(base, M.solid(n, C("#3a3936")), np.clip(stain * 1.35, 0, 1) * 0.62)
    damp = blotches(n, 3, seed + 21, threshold=0.58, softness=0.22, warp_amt=55)
    base = M.mix(base, M.solid(n, C("#54564f")), damp * 0.42)
    algae = blotches(n, 14, seed + 22, threshold=0.68, softness=0.07, warp_amt=25) * damp
    base = M.mix(base, M.solid(n, C("#4a5340")), algae * 0.55)
    effl = N.smoothstep(0.03, 0.30, N.blur(crack + hair * 0.4, 14) * (N.fbm(n, 50, 3, seed + 23, min_res=512) * 0.5 + 0.6))
    base = M.mix(base, M.solid(n, C("#b9b7ae")), effl * 0.6)
    rust = np.clip(ring * 1.8 * plugged, 0, 1)
    rust_drip = stain_down(holes * plugged * (rnd(seed + 24, n) < 0.35), decay=0.988, seed=seed + 25, strength=0.8)
    base = M.mix(base, M.solid(n, C("#6d4026")), np.clip(rust * 0.65 + rust_drip * 0.8, 0, 1))
    soot = blotches(n, 2, seed + 26, threshold=0.60, softness=0.28, warp_amt=70)
    base = M.mul(base, 1.0 - soot * 0.22)
    base = M.mul(base, 1.0 - M.cavity(m.height, 2.0) * 0.40)
    m.albedo = base
    m.rough = (0.90 + b3 * 0.06 - stain * 0.18 - damp * 0.14 + spall * 0.05 + effl * 0.05
               + grain * 0.10 - np.clip(sandy, 0, 1) * 0.05)
    m.micro_amt = (0.10, 0.014, 0.07)
    return m.finish()


def plaster(n, seed=200):
    """Lime render on brick: trowel ridges, dense crazing, patches fallen to the scratch coat and to brick,
    a damp tide mark low on the wall with mould in it, and whitewash that has yellowed unevenly."""
    m = Mat(n, tile_m=2.0, height_m=0.03)
    r = N.rng_for(seed)
    ppm = n / m.tile_m
    grain = rnd(seed + 1, n) - 0.5

    # --- trowel: overlapping arcs, each with a raised leading ridge
    c = Canvas(n, "F", 0.0)
    cr = Canvas(n, "F", 0.0)
    for i in range(340):
        cx, cy = r.uniform(0, n, 2)
        rad = r.uniform(0.08, 0.32) * n
        a0 = r.uniform(0, 2 * np.pi)
        a1 = a0 + r.uniform(0.35, 1.3) * (1 if r.random() < 0.5 else -1)
        ay = r.uniform(0.55, 1.0)
        pts = [(cx + np.cos(a) * rad, cy + np.sin(a) * rad * ay) for a in np.linspace(a0, a1, 28)]
        w = int(r.uniform(8, 34))
        c.line(pts, float(r.uniform(0.35, 1.0)), width=w)
        cr.line(pts, float(r.uniform(0.5, 1.0)), width=max(2, int(w * 0.22)))
    trowel = N.blur(c.array(), 2.5)
    ridge = N.blur(cr.array(), 1.2)
    sand = grit(n, seed + 2, density=0.30, sizes=(0.5, 1.5), soft=0.55) * 0.65

    # --- crazing: dense hairline network plus a few structural cracks
    craze = crack_mask(n, crack_lines(n, 26, seed + 3, length=(0.04, 0.16), wander=0.13, branch_p=0.5,
                                      kink_every=(5, 18)), width=1.3, soft=0.3)
    craze = np.maximum(craze, polygon_cracks(n, 26, seed + 4, width=1.1, jitter=1.0, soft=0.7, warp_amt=10)[0] * 0.5)
    big = crack_mask(n, crack_lines(n, 3, seed + 5, length=(0.3, 0.85), wander=0.06, branch_p=0.4),
                     width=3.0, soft=0.6, wobble=1.4, seed=seed + 6)

    # --- fallen patches: finish coat gone, then the whole render gone
    fall1 = flake(n, seed + 7, coverage=0.22, cells=7, edge=0.010)
    fall2 = flake(n, seed + 8, coverage=0.07, cells=7, edge=0.008) * fall1
    fall1 = np.maximum(fall1, N.smoothstep(0.35, 0.9, N.blur(big, 7) * 4.0) * blotches(n, 8, seed + 9, threshold=0.45,
                                                                                      softness=0.2))
    rim1 = np.clip((N.blur(fall1, 3) - fall1) * 6, 0, 1)
    rim2 = np.clip((N.blur(fall2, 3) - fall2) * 6, 0, 1)

    bid, u, v, edged, mortar, dxe, dye = running_bond(n, 8, 26, mortar=0.15, seed=seed + 10)
    bvar = N.cell_random(bid, 8 * 30, seed + 11, k=3)
    brick_h = 0.46 - mortar * 0.18 + N.fbm(n, 130, 3, seed + 12, min_res=512) * 0.04 + bvar[..., 0] * 0.03
    scratch_h = 0.70 + N.fbm(n, 60, 4, seed + 13, min_res=512) * 0.07 + grit(n, seed + 14, 0.6, (0.8, 2.6), 0.4) * 0.05
    finish_h = 0.92 + trowel * 0.035 + ridge * 0.025 + sand * 0.012

    h = finish_h * (1 - fall1) + scratch_h * (fall1 - fall2) + brick_h * fall2
    h -= craze * 0.05 + big * 0.14
    blister = blotches(n, 12, seed + 15, threshold=0.72, softness=0.05) * N.smoothstep(0.0, 0.3, N.blur(fall1, 26)) * (1 - fall1)
    h += blister * 0.025
    m.height = np.clip(h, 0, 1)

    # --- colour
    base = tone(C("#c2bba9"), n, variation=0.07, seed=seed + 16, cells=3, hue=0.012, sat=0.045)
    base = M.mul(base, 1.0 + trowel * 0.06 + ridge * 0.07 + grain * 0.07 + sand * 0.05)
    yellow = blotches(n, 3, seed + 17, threshold=0.48, softness=0.3, warp_amt=45)
    base = M.mix(base, M.solid(n, C("#ab9d7e")), yellow * 0.45)
    wash = blotches(n, 2, seed + 18, threshold=0.5, softness=0.22, warp_amt=75)
    base = M.mix(base, M.solid(n, C("#93a096")), wash * 0.45)                # remnants of a green-grey wash
    base = M.mul(base, 1.0 - craze * 0.42 - big * 0.6)
    scratch_c = M.mul(M.solid(n, C("#8d8578")), 0.82 + N.fbm(n, 60, 3, seed + 19, min_res=512) * 0.3 + grain * 0.18)
    brick_c = M.mix(M.solid(n, C("#7b4f3e")), M.solid(n, C("#5d4034")), bvar[..., 1])
    brick_c = M.mix(brick_c, M.solid(n, C("#8d6b59")), bvar[..., 2] * 0.5)
    brick_c = M.mix(brick_c, M.solid(n, C("#7d7768")), mortar)
    brick_c = M.mul(brick_c, 0.85 + N.fbm(n, 90, 3, seed + 20, min_res=512) * 0.18)
    base = M.mix(base, scratch_c, fall1)
    base = M.mix(base, brick_c, fall2)
    base = M.mix(base, M.solid(n, C("#dcd5c3")), rim1 * (1 - fall1) * 0.75)
    base = M.mix(base, M.solid(n, C("#b3aa9b")), rim2 * (1 - fall2) * 0.5)

    # rising damp: a tide mark in the lower third
    yy = N.uv(n)[1]
    tide = N.smoothstep(0.62, 0.98, yy + N.fbm(n, 6, 4, seed + 21, min_res=256) * 0.22)
    damp = np.clip(tide * 0.9 + blotches(n, 3, seed + 22, threshold=0.68, softness=0.12, warp_amt=60) * 0.5, 0, 1)
    damp_rim = np.clip((N.blur(damp, 18) - damp) * 3.0, 0, 1)
    base = M.mix(base, M.solid(n, C("#6b665b")), damp * 0.5)
    base = M.mix(base, M.solid(n, C("#d6cfbd")), damp_rim * 0.4)
    salt = N.smoothstep(0.3, 0.8, damp_rim + grit(n, seed + 23, 0.4, (0.8, 2.4), 0.5) * 0.5) * tide
    base = M.mix(base, M.solid(n, C("#cfcabd")), salt * 0.4)
    mould = blotches(n, 45, seed + 24, threshold=0.70, softness=0.05) * np.maximum(damp, N.blur(fall1, 22))
    base = M.mix(base, M.solid(n, C("#31342d")), mould * 0.7)
    grime = N.fbm(n, 5, 5, seed + 25, min_res=256) * 0.5 + 0.5
    base = M.mul(base, 0.85 + grime * 0.22)
    st = stain_down(np.clip(big + craze * 0.25 + rim1, 0, 1) * (rnd(seed + 26, n) < 0.07),
                    decay=0.9945, seed=seed + 27, strength=0.7)
    base = M.mix(base, M.solid(n, C("#514e47")), st * 0.5)
    base = M.mul(base, 1.0 - M.cavity(m.height, 2.0) * 0.32)
    m.albedo = base
    m.rough = 0.84 + sand * 0.05 - damp * 0.16 - wash * 0.04 + fall1 * 0.08 + mould * 0.05 + grain * 0.07
    m.micro_amt = (0.09, 0.012, 0.06)
    return m.finish()


# ============================================================== timber

def wood(n, seed=700):
    """Weathered board cladding: staggered planks, ring grain at a believable pitch, saw marks, splits,
    knots with the grain flowing round them, cut nails with rust wash, silvering and moss in the shade."""
    m = Mat(n, tile_m=2.0, height_m=0.014)
    from .materials2 import _plank_layout
    planks = 13
    pid, u, v, end_d, gap, count = _plank_layout(n, planks, seed)
    pv = N.cell_random(pid, count, seed + 1, k=5)
    grain = rnd(seed + 2, n) - 0.5
    pw = n / planks

    # --- grain: growth rings of unequal width across a 150 mm board. Each ring is a wide pale earlywood
    # zone that darkens into a narrow, hard latewood line; ring widths and the latewood fraction vary.
    w1 = N.fbm(n, 4, 4, seed + 3, cells_y=9, min_res=256)
    w2 = N.fbm(n, 14, 3, seed + 4, cells_y=36, min_res=512)
    w3 = N.fbm(n, 2, 3, seed + 30, cells_y=220, min_res=1024)
    freq = 6.0 + pv[..., 0] * 6.0
    phase = (u + w1 * 0.20 + w2 * 0.045 + w3 * 0.010 + pv[..., 1] * 5.0) * freq
    rid = np.floor(phase).astype(np.int32)
    rf = phase - rid
    rv = N.cell_random(np.abs(rid) % 512, 512, seed + 31, k=3)
    lw = 0.10 + rv[..., 0] * 0.22                               # latewood fraction of this ring
    edge = np.clip(0.020 + rv[..., 1] * 0.02, 0.01, 0.06)
    late = N.smoothstep(1.0 - lw - edge, 1.0 - lw + edge, rf) * (1.0 - N.smoothstep(1.0 - edge, 1.0, rf))
    late = np.clip(late + N.smoothstep(1.0 - edge * 0.6, 1.0, rf) * 0.55, 0, 1)
    early = np.clip(rf / np.maximum(1.0 - lw, 0.2), 0, 1) ** 1.6   # earlywood darkens toward the ring edge
    fibre = N.fbm(n, 3, 3, seed + 5, cells_y=520, min_res=1024)
    fibre = fibre + N.fbm(n, 2, 2, seed + 32, cells_y=900, min_res=2048) * 0.6
    sawmark = 0.5 + 0.5 * np.sin((v * 190.0 + N.fbm(n, 6, 2, seed + 6, min_res=256) * 3.0) * 2 * np.pi)
    sawmark = N.smoothstep(0.55, 1.0, sawmark) * N.smoothstep(0.3, 0.7, pv[..., 4])

    # --- knots
    r = N.rng_for(seed + 7)
    xx, yy = N.coords(n)
    knot = np.zeros((n, n), F32)
    knot_ring = np.zeros((n, n), F32)
    for i in range(22):
        cx, cy = r.uniform(0, n, 2)
        rx = r.uniform(7, 20)
        ry = rx * r.uniform(1.1, 2.0)
        dx = N.wrapped_delta(xx, cx, n) / rx
        dy = N.wrapped_delta(yy, cy, n) / ry
        d = np.sqrt(dx * dx + dy * dy)
        knot = np.maximum(knot, 1.0 - N.smoothstep(0.75, 1.05, d))
        swirl = (1.0 - N.smoothstep(1.0, 3.4, d)) * (0.5 + 0.5 * np.sin(d * 7.5 + r.uniform(0, 6)))
        knot_ring = np.maximum(knot_ring, swirl)
    late = np.clip(late + knot_ring * 0.5, 0, 1)

    silver = blotches(n, 3, seed + 8, threshold=0.40, softness=0.2, warp_amt=55)
    silver = np.clip(silver + (pv[..., 2] - 0.5) * 0.8 + 0.15, 0, 1)
    splits = crack_mask(n, crack_lines(n, 16, seed + 9, length=(0.05, 0.34), wander=0.02, kink_every=(20, 60),
                                       kink=(0.05, 0.2), branch_p=0.2, direction=np.pi / 2, dir_spread=0.05),
                        width=2.0, soft=0.35)
    splits *= (1 - gap)
    checks = crack_mask(n, crack_lines(n, 40, seed + 10, length=(0.01, 0.05), wander=0.01, direction=np.pi / 2,
                                       dir_spread=0.03), width=1.1, soft=0.25)

    # --- nails: two per plank crossing, square heads with a rust wash below
    nail = ((np.abs(((end_d / pw) % 3.2) - 0.6) < 0.035) & ((np.abs(u - 0.22) < 0.016) | (np.abs(u - 0.78) < 0.016)))
    nails = N.smoothstep(0.25, 0.65, N.blur(nail.astype(F32), 1.2))
    nail_rust = stain_down(nails * (rnd(seed + 11, n) < 0.4), decay=0.986, seed=seed + 12, strength=0.85)

    cup = (0.5 - np.abs(u - 0.5)) * 2.0
    h = (0.62 + (pv[..., 3] - 0.5) * 0.10 + cup * 0.05
         + (late * 0.055 + early * 0.012) * (0.55 + silver * 0.9)          # raised grain when weathered
         + fibre * 0.02 + sawmark * 0.012 + knot * 0.035)
    h -= gap * 0.55 + splits * 0.16 + checks * 0.05 + nails * 0.06
    m.height = np.clip(h, 0, 1)

    # --- colour
    early_c = M.solid(n, C("#8a7157"))
    late_c = M.solid(n, C("#5a4634"))
    fresh = M.mix(early_c, late_c, np.clip(late * 0.80 + early * 0.35, 0, 1))
    fresh = M.hsv_shift(fresh, dh=(pv[..., 1] - 0.5) * 0.02, ds=(pv[..., 2] - 0.5) * 0.12, dv=(pv[..., 3] - 0.5) * 0.14)
    grey = M.mix(M.solid(n, C("#948f85")), M.solid(n, C("#5c5952")), np.clip(late * 0.85 + early * 0.25, 0, 1))
    col = M.mix(fresh, grey, silver)
    col = M.mul(col, 1.0 + fibre * 0.16 + grain * 0.14 + sawmark * 0.05)
    col = M.mix(col, M.solid(n, C("#33281d")), knot * 0.75)
    col = M.mul(col, 1.0 - splits * 0.55 - checks * 0.25)
    col = M.mix(col, M.solid(n, C("#181513")), np.clip(gap * 1.1, 0, 1) * 0.85)
    col = M.mix(col, M.solid(n, C("#3b3833")), nails * 0.85)
    col = M.mix(col, M.solid(n, C("#5e3b22")), nail_rust * 0.55)
    moss = blotches(n, 7, seed + 13, threshold=0.68, softness=0.1, warp_amt=30) * N.smoothstep(0.3, 0.9, N.uv(n)[1])
    col = M.mix(col, M.solid(n, C("#454b3c")), moss * 0.5)
    st = stain_down((rnd(seed + 14, n) < 0.0006).astype(F32), decay=0.9955, seed=seed + 15, strength=0.7)
    col = M.mix(col, M.solid(n, C("#463f37")), st * 0.45)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.0) * 0.35)
    m.albedo = col
    m.rough = 0.74 + silver * 0.16 + late * 0.05 + moss * 0.06 + gap * 0.1 - knot * 0.12 + grain * 0.06
    m.micro_amt = (0.08, 0.010, 0.06)
    return m.finish()


def logs(n, seed=800):
    """Log wall: round courses with a scribed fit, moss chinking in the joints, radial checks, axe-hewn faces,
    silvered upper surfaces and dark rot below each joint."""
    m = Mat(n, tile_m=2.0, height_m=0.10)
    courses = 7
    yv = N.coords(n)[1] / (n / courses)
    cid = np.floor(yv).astype(np.int32)
    cv = N.cell_random(cid % courses, courses, seed + 1, k=5)
    t = yv - cid                                                  # 0..1 across a log
    # scribed joint: each log sits into the one below, so the visible face is a fat lens
    wobble = N.fbm(n, 5, 3, seed + 2, cells_y=1, min_res=256) * 0.10 + (cv[..., 0] - 0.5) * 0.10
    tt = np.clip(t + wobble, 0.02, 0.98)
    round_ = np.sqrt(np.clip(1.0 - (tt * 2.0 - 1.0) ** 2, 0, 1))
    joint = 1.0 - N.smoothstep(0.0, 0.10, np.minimum(tt, 1.0 - tt))

    grain = rnd(seed + 3, n) - 0.5
    along = N.fbm(n, 3, 4, seed + 4, cells_y=90, min_res=512)
    fibre = (N.fbm(n, 2, 3, seed + 5, cells_y=460, min_res=1024)
             + N.fbm(n, 2, 2, seed + 25, cells_y=1100, min_res=2048) * 0.7)
    # rings exposed on the hewn face: bands running with the log, tighter near the edges of the face
    rphase = (tt * 9.0 + N.fbm(n, 5, 3, seed + 26, cells_y=40, min_res=512) * 1.4 + cv[..., 3] * 4.0)
    rings = np.abs(np.sin(rphase * np.pi))
    rings = N.smoothstep(0.55, 0.95, rings)
    hewn = N.fbm(n, 26, 3, seed + 6, cells_y=6, min_res=512)       # broad axe facets
    # checks: long radial splits running with the log
    checks = crack_mask(n, crack_lines(n, 22, seed + 7, length=(0.08, 0.55), wander=0.015, kink_every=(30, 90),
                                       kink=(0.03, 0.12), branch_p=0.12, direction=0.0, dir_spread=0.04),
                        width=2.6, soft=0.4)
    checks *= N.smoothstep(0.25, 0.7, round_)
    knot = np.zeros((n, n), F32)
    r = N.rng_for(seed + 8)
    xx, yy = N.coords(n)
    for i in range(14):
        cx, cy = r.uniform(0, n, 2)
        rr = r.uniform(10, 26)
        d = np.sqrt(N.wrapped_delta(xx, cx, n) ** 2 + N.wrapped_delta(yy, cy, n) ** 2) / rr
        knot = np.maximum(knot, 1.0 - N.smoothstep(0.6, 1.0, d))

    chink = joint * (0.6 + 0.4 * N.fbm(n, 40, 3, seed + 9, cells_y=6, min_res=512))
    h = 0.30 + round_ * 0.62 + along * 0.03 + hewn * 0.025 + fibre * 0.020 + rings * 0.012 + knot * 0.03
    h -= joint * 0.55 + checks * 0.16
    h += chink * 0.12                                             # oakum/moss packed into the groove
    m.height = np.clip(h, 0, 1)

    silver = np.clip(N.smoothstep(0.15, 0.75, round_) * (0.5 + 0.7 * blotches(n, 4, seed + 10, threshold=0.45,
                                                                              softness=0.25, warp_amt=40)), 0, 1)
    base = M.mix(M.solid(n, C("#6b563f")), M.solid(n, C("#8a7358")), np.clip(along * 0.5 + 0.5, 0, 1))
    base = M.hsv_shift(base, ds=(cv[..., 1] - 0.5) * 0.12, dv=(cv[..., 2] - 0.5) * 0.14)
    grey = M.mix(M.solid(n, C("#928f86")), M.solid(n, C("#63615a")), np.clip(fibre * 0.5 + 0.5, 0, 1))
    col = M.mix(base, grey, silver * 0.85)
    col = M.mul(col, 1.0 + fibre * 0.20 + grain * 0.13 + hewn * 0.08 - rings * 0.16)
    col = M.mix(col, M.solid(n, C("#2f251c")), knot * 0.8)
    col = M.mul(col, 1.0 - checks * 0.55)
    # dark weathering under each joint, moss in it
    below = np.clip(N.smoothstep(0.0, 0.22, tt) * (1.0 - N.smoothstep(0.0, 0.5, tt)), 0, 1)
    col = M.mul(col, 1.0 - below * 0.35)
    mosscol = M.mix(M.solid(n, C("#4a5340")), M.solid(n, C("#6d7053")), N.fbm(n, 90, 3, seed + 11, min_res=512) * 0.5 + 0.5)
    col = M.mix(col, mosscol, np.clip(chink * 1.2, 0, 1) * 0.85)
    rot = blotches(n, 5, seed + 12, threshold=0.66, softness=0.12, warp_amt=40) * np.clip(joint * 1.5 + 0.25, 0, 1)
    col = M.mix(col, M.solid(n, C("#3a352c")), rot * 0.55)
    col = M.mul(col, 1.0 - M.cavity(m.height, 3.0) * 0.4)
    m.albedo = col
    m.rough = 0.80 + silver * 0.12 + chink * 0.1 - knot * 0.1 + grain * 0.06
    m.micro_amt = (0.09, 0.010, 0.06)
    return m.finish()


def birch_bark(n, seed=900):
    """Birch trunk: chalky white papery bark with fine horizontal lenticels, peeling curls that show ochre
    underbark, grey lichen, and the rough black fissured collar that forms round old branch scars."""
    m = Mat(n, tile_m=1.0, height_m=0.012)
    r = N.rng_for(seed)
    grain = rnd(seed + 1, n) - 0.5
    x, y = N.uv(n)

    # --- papery layers: horizontal bands with slightly different tone, edges where a layer has lifted
    band = N.fbm(n, 2, 4, seed + 2, cells_y=26, min_res=256)
    layer = N.smoothstep(-0.05, 0.05, band)
    lift = np.clip((N.blur(layer, 3) - layer) * 6.0, 0, 1)        # the lifted edge of a curl
    curl = N.smoothstep(0.0, 0.35, N.blur(lift, 6))

    # --- lenticels: dashes on horizontal rows, length varies a lot, some run into cracks
    c = Canvas(n, "F", 0.0)
    cw = Canvas(n, "F", 0.0)
    rows = 78
    for i in range(rows):
        yy = (i + r.uniform(-0.35, 0.35)) * n / rows
        cnt = int(r.uniform(5, 15))
        for k in range(cnt):
            x0 = r.uniform(0, n)
            ln = r.uniform(0.006, 0.10) * n * (1.0 + 2.5 * (r.random() < 0.10))
            wd = max(1, int(r.uniform(1.2, 3.6)))
            yj = yy + r.normal(0, 2.5)
            c.line([(x0, yj), (x0 + ln, yj)], float(r.uniform(0.55, 1.0)), width=wd)
            cw.line([(x0 - 2, yj - wd * 0.9), (x0 + ln + 2, yj - wd * 0.9)], float(r.uniform(0.3, 0.8)),
                    width=max(1, wd // 2))
    lent = N.blur(c.array(), 0.7)
    lent_lip = N.blur(cw.array(), 1.0)

    # --- old branch scars: soft irregular dark collars, never clean diamonds
    scar = np.zeros((n, n), F32)
    scar_core = np.zeros((n, n), F32)
    xx, yyc = N.coords(n)
    for i in range(4):
        cx, cy = r.uniform(0, n, 2)
        rx = r.uniform(0.030, 0.065) * n
        ry = rx * r.uniform(1.6, 3.2)
        dx = N.wrapped_delta(xx, cx, n) / rx
        dy = N.wrapped_delta(yyc, cy, n) / ry
        d = np.sqrt(dx * dx + dy * dy) * (1.0 + 0.45 * np.sin(np.arctan2(dy, dx) * r.integers(3, 7) + r.uniform(0, 6)))
        d = d + N.fbm(n, 16, 4, seed + 20 + i, min_res=256) * 0.45
        scar = np.maximum(scar, 1.0 - N.smoothstep(0.86, 1.06, d))
        scar_core = np.maximum(scar_core, 1.0 - N.smoothstep(0.42, 0.62, d))
    scar_cracks = crack_mask(n, crack_lines(n, 30, seed + 3, length=(0.02, 0.09), wander=0.06, branch_p=0.3,
                                            direction=np.pi / 2, dir_spread=0.35), width=1.8, soft=0.4) * scar

    fine = N.fbm(n, 30, 4, seed + 4, cells_y=140, min_res=512)
    h = (0.72 + fine * 0.03 + grain * 0.012 + lent_lip * 0.05 - lent * 0.06
         + curl * 0.09 + lift * 0.10 - layer * 0.01)
    h -= scar * 0.10 + scar_core * 0.14 + scar_cracks * 0.20
    m.height = np.clip(h, 0, 1)

    # --- colour
    white = tone(C("#d9d6cd"), n, variation=0.05, seed=seed + 5, cells=4, hue=0.006, sat=0.03)
    white = M.mul(white, 1.0 + fine * 0.10 + grain * 0.07 + band * 0.06)
    warm = M.solid(n, C("#c3ab90"))                               # underbark showing where a curl lifted
    col = M.mix(white, warm, np.clip(curl * 0.9 + lift * 0.6, 0, 1) * 0.75)
    pink = blotches(n, 4, seed + 6, threshold=0.55, softness=0.25, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#cfbcae")), pink * 0.3)
    col = M.mix(col, M.solid(n, C("#2a2724")), np.clip(lent * 1.15, 0, 1) * 0.9)
    col = M.mix(col, M.solid(n, C("#e6e3da")), lent_lip * 0.35)
    col = M.mix(col, M.solid(n, C("#3a352f")), scar * 0.75)
    col = M.mix(col, M.solid(n, C("#211e1b")), scar_core * 0.85)
    col = M.mul(col, 1.0 - scar_cracks * 0.6)
    lich = blotches(n, 22, seed + 7, threshold=0.72, softness=0.06, warp_amt=18)
    col = M.mix(col, M.solid(n, C("#9aa08a")), lich * 0.45)
    grime = blotches(n, 3, seed + 8, threshold=0.6, softness=0.25, warp_amt=50)
    col = M.mul(col, 1.0 - grime * 0.16)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.0) * 0.28)
    m.albedo = col
    m.rough = 0.72 + lent * 0.15 + scar * 0.18 + curl * 0.08 + grain * 0.06 - lich * 0.05
    m.micro_amt = (0.07, 0.008, 0.05)
    return m.finish()


def pine_bark(n, seed=1000):
    """Scots pine bark: thick irregular plates split by deep black fissures, each plate built of thin scales
    that lift at their edges, orange-red under the grey weathered face."""
    m = Mat(n, tile_m=1.0, height_m=0.045)
    grain = rnd(seed + 1, n) - 0.5
    plates, cid, edge, f1 = stones(n, 6, seed + 2, jitter=1.0, aniso=2.4, round_=0.18, gap=0.10, warp_amt=38)
    pv = N.cell_random(cid, 6 * 6 * 4, seed + 3, k=4)
    sub, sid, sedge, _ = stones(n, 19, seed + 4, jitter=1.0, aniso=1.7, round_=0.15, gap=0.10, warp_amt=16)
    sv = N.cell_random(sid, 19 * 19 * 3, seed + 5, k=2)
    scale, scid, scedge, _ = stones(n, 55, seed + 6, jitter=1.0, aniso=1.4, round_=0.1, gap=0.12, warp_amt=6)
    scv = N.cell_random(scid, 55 * 55 * 2, seed + 7, k=2)

    fissure = 1.0 - N.smoothstep(0.0, 0.13, plates)
    fis_soft = 1.0 - N.smoothstep(0.0, 0.42, plates)
    subfis = (1.0 - N.smoothstep(0.0, 0.12, sub)) * (1 - fissure)
    lift = np.clip(scedge * 1.6, 0, 1) * (1 - fissure) * (1 - subfis)
    fine = N.fbm(n, 140, 3, seed + 8, min_res=512)

    h = (0.30 + N.smoothstep(0.0, 0.5, plates) * 0.50 + (pv[..., 0] - 0.5) * 0.14
         + sub * 0.13 * (1 - fissure) + (sv[..., 0] - 0.5) * 0.05
         + scale * 0.05 * (1 - fissure) + lift * 0.05
         + fine * 0.025 + grain * 0.012)
    h -= subfis * 0.10
    m.height = np.clip(h, 0, 1)

    inner = M.mix(M.solid(n, C("#7a4f33")), M.solid(n, C("#96603c")), scv[..., 0])
    outer = M.mix(M.solid(n, C("#5c4d40")), M.solid(n, C("#736152")), pv[..., 1])
    col = M.mix(outer, inner, np.clip(N.smoothstep(0.45, 0.95, sub) * 0.55 + lift * 0.6, 0, 1))
    col = M.mix(col, M.solid(n, C("#7d7368")), N.smoothstep(0.6, 1.0, scale) * 0.30)
    col = M.mix(col, M.solid(n, C("#2b221b")), fis_soft * 0.55)
    col = M.mix(col, M.solid(n, C("#17110d")), fissure * 0.95)
    col = M.mix(col, M.solid(n, C("#3a2e25")), subfis * 0.75)
    col = M.mul(col, 0.82 + fine * 0.25 + grain * 0.16 + scale * 0.12)
    grey = blotches(n, 5, seed + 9, threshold=0.5, softness=0.2, warp_amt=45)
    col = M.mix(col, M.solid(n, C("#6e6a62")), grey * 0.45)
    lichen = blotches(n, 13, seed + 10, threshold=0.7, softness=0.05, warp_amt=22) * (1 - fissure)
    col = M.mix(col, M.solid(n, C("#9aa384")), lichen * 0.55)
    col = M.mul(col, 1.0 - M.cavity(m.height, 3.0) * 0.45)
    m.albedo = col
    m.rough = 0.92 - lichen * 0.06 + grain * 0.05 - fissure * 0.04
    m.micro_amt = (0.10, 0.012, 0.06)
    return m.finish()


# ============================================================== woven goods

def _weave2(n, threads, seed, twill=0, yarn_var=0.35, fuzz=0.0):
    """Woven cloth. Returns (height, over-mask, thread-id noise, along-yarn shading).

    twill=0 gives plain weave (over/under 1-1), twill=k a k-step diagonal (3 = classic serge). Every yarn gets a
    rounded cross-section, a slight width and tension jitter, and colour noise along its length.
    """
    tp = n / float(threads)
    x, y = N.coords(n)
    wob = N.fbm(n, 6, 3, seed + 1, min_res=256) * tp * 0.22
    xi = (x + wob) / tp
    yi = (y + np.roll(wob, n // 3, axis=1)) / tp
    i = np.floor(xi).astype(np.int32)
    j = np.floor(yi).astype(np.int32)
    u = xi - i
    v = yi - j
    if twill <= 0:
        over = ((i + j) % 2) == 0
    else:
        over = ((i + j) % (twill + 1)) < twill
    warp_p = np.sin(np.pi * np.clip(u, 0, 1)) ** 0.65
    weft_p = np.sin(np.pi * np.clip(v, 0, 1)) ** 0.65
    ci = N.cell_random(np.abs(i) % 512, 512, seed + 2, k=2)
    cj = N.cell_random(np.abs(j) % 512, 512, seed + 3, k=2)
    tone_f = np.where(over, 0.82 + ci[..., 0] * yarn_var, 0.70 + cj[..., 0] * yarn_var)
    along = np.where(over, N.fbm(n, 3, 3, seed + 4, cells_y=threads // 2, min_res=512),
                     N.fbm(n, threads // 2, 3, seed + 5, cells_y=3, min_res=512))
    h = np.where(over, 0.62 + warp_p * 0.38, 0.30 + weft_p * 0.34)
    h = h + along * 0.06
    if fuzz > 0:
        h = N.blur(h, fuzz)
    return h.astype(F32), over.astype(F32), tone_f.astype(F32), along.astype(F32)


def fabric(n, seed=1100):
    """Wool serge (uniform cloth): 2/1 twill with a visible diagonal, raised nap, pilling, threadbare patches,
    a stitched seam and the dust that lives in wool."""
    m = Mat(n, tile_m=0.20, height_m=0.003)
    h, over, tf, along = _weave2(n, 420, seed, twill=2, yarn_var=0.30, fuzz=0.7)
    grain = rnd(seed + 1, n) - 0.5
    nap = sprinkle_lines(n, 9000, seed + 2, length=(4, 20), width=(1, 2), angle=None, soft=0.6)
    fluff = N.blur(nap, 1.6)
    worn = blotches(n, 4, seed + 3, threshold=0.60, softness=0.18, warp_amt=40)
    pill = grit(n, seed + 4, density=0.05, sizes=(1.2, 3.0), soft=0.8) * (0.3 + worn)
    seam_y = (np.abs(N.uv(n)[1] - 0.5) < 0.006).astype(F32)
    stitch = seam_y * (0.5 + 0.5 * np.sin(N.uv(n)[0] * 2 * np.pi * 40.0))
    stitch = N.smoothstep(0.45, 0.9, stitch)
    h = h + fluff * 0.10 + pill * 0.25 - worn * 0.06 + grain * 0.03
    h = np.clip(h + stitch * 0.35 + N.blur(seam_y, 6) * 0.15, 0, 1)
    m.height = h

    base = tone(C("#4e5344"), n, variation=0.08, seed=seed + 5, cells=3, hue=0.02, sat=0.06)
    col = M.mul(base, 0.75 + tf * 0.45)
    col = M.mul(col, 1.0 + along * 0.14 + grain * 0.10)
    col = M.mix(col, M.solid(n, C("#6a6d5c")), np.clip(fluff * 1.4, 0, 1) * 0.35)
    col = M.mix(col, M.solid(n, C("#7b7c6d")), worn * 0.35)
    col = M.mix(col, M.solid(n, C("#3b3f34")), np.clip(1.0 - h, 0, 1) * 0.35)
    dirt = blotches(n, 5, seed + 6, threshold=0.62, softness=0.2, warp_amt=45)
    col = M.mul(col, 1.0 - dirt * 0.22)
    salt = blotches(n, 9, seed + 7, threshold=0.75, softness=0.1, warp_amt=25)
    col = M.mix(col, M.solid(n, C("#8d8b7e")), salt * 0.25)
    col = M.mix(col, M.solid(n, C("#3a3a33")), stitch * 0.6)
    col = M.mul(col, 1.0 - M.cavity(h, 1.6) * 0.35)
    m.albedo = col
    m.rough = 0.92 - worn * 0.06 + grain * 0.05 - fluff * 0.03
    m.micro_amt = (0.09, 0.012, 0.05)
    return m.finish()


def canvas(n, seed=1150):
    """Cotton duck: heavy plain weave, thick slubby yarns, a stitched hem, water stains, mildew and fraying."""
    m = Mat(n, tile_m=0.25, height_m=0.004)
    h, over, tf, along = _weave2(n, 190, seed, twill=0, yarn_var=0.42, fuzz=0.6)
    grain = rnd(seed + 1, n) - 0.5
    slub = N.fbm(n, 8, 3, seed + 2, cells_y=40, min_res=512)
    hem = (np.abs(N.uv(n)[0] - 0.08) < 0.010).astype(F32) + (np.abs(N.uv(n)[0] - 0.92) < 0.010).astype(F32)
    hem = N.blur(hem, 3)
    stitch = N.smoothstep(0.5, 0.9, hem * (0.5 + 0.5 * np.sin(N.uv(n)[1] * 2 * np.pi * 110.0)))
    fray = sprinkle_lines(n, 900, seed + 3, length=(4, 22), width=(1, 2), angle=0.0, spread=0.15, soft=0.4)
    h = np.clip(h + slub * 0.06 + hem * 0.25 + stitch * 0.25 + fray * 0.05 + grain * 0.03, 0, 1)
    m.height = h
    base = tone(C("#8d8465"), n, variation=0.09, seed=seed + 4, cells=3, hue=0.015, sat=0.05)
    col = M.mul(base, 0.72 + tf * 0.5)
    col = M.mul(col, 1.0 + along * 0.16 + slub * 0.12 + grain * 0.1)
    water = blotches(n, 3, seed + 5, threshold=0.55, softness=0.16, warp_amt=50)
    rim = np.clip((N.blur(water, 12) - water) * 3.0, 0, 1)
    col = M.mix(col, M.solid(n, C("#6f6852")), water * 0.4)
    col = M.mix(col, M.solid(n, C("#514c3c")), rim * 0.5)
    mildew = blotches(n, 26, seed + 6, threshold=0.72, softness=0.07) * (0.3 + water)
    col = M.mix(col, M.solid(n, C("#3d4034")), mildew * 0.55)
    col = M.mix(col, M.solid(n, C("#5c5747")), stitch * 0.5)
    col = M.mul(col, 1.0 - M.cavity(h, 1.8) * 0.35)
    m.albedo = col
    m.rough = 0.93 + grain * 0.05 - water * 0.08
    m.micro_amt = (0.09, 0.014, 0.05)
    return m.finish()


def tarp(n, seed=2500):
    """Polyethylene tarpaulin over a load: coarse ribbon weave, deep folds, a reinforced hem with an eyelet row,
    sun-bleached olive, mud splash at the bottom and a taped tear."""
    m = Mat(n, tile_m=0.7, height_m=0.010)
    hw, over, tf, along = _weave2(n, 230, seed, twill=0, yarn_var=0.22, fuzz=0.8)
    grain = rnd(seed + 1, n) - 0.5
    # folds: a few long creases plus general slack
    fold = np.zeros((n, n), F32)
    r = N.rng_for(seed + 2)
    for i in range(7):
        a = r.uniform(0, np.pi)
        cx, cy = r.uniform(0, n, 2)
        x, y = N.coords(n)
        d = (N.wrapped_delta(x, cx, n) * np.cos(a) + N.wrapped_delta(y, cy, n) * np.sin(a))
        w = r.uniform(20, 90)
        fold += np.exp(-(d / w) ** 2) * r.uniform(-1, 1)
    fold = fold / (np.abs(fold).max() + 1e-6)
    slack = N.fbm(n, 4, 4, seed + 3, min_res=256)
    creases = crack_mask(n, crack_lines(n, 9, seed + 4, length=(0.2, 0.8), wander=0.03, branch_p=0.15),
                         width=3.0, soft=2.0)
    hem = (N.uv(n)[1] > 0.955).astype(F32) + (N.uv(n)[1] < 0.045).astype(F32)
    hem = N.blur(hem, 4)
    eyelet, ering = holes_grid(n, 6, 1, radius_px=n * 0.011, seed=seed + 5, oy=0.028)
    eyelet2, ering2 = holes_grid(n, 6, 1, radius_px=n * 0.011, seed=seed + 6, oy=0.972)
    eye = np.clip(eyelet + eyelet2, 0, 1)
    ring = np.clip(ering + ering2, 0, 1)
    tear = crack_mask(n, crack_lines(n, 2, seed + 7, length=(0.06, 0.2), wander=0.1, branch_p=0.2), width=4.0, soft=0.6)
    tape = blotches(n, 7, seed + 8, threshold=0.80, softness=0.02, warp_amt=6)
    h = 0.55 + hw * 0.20 + fold * 0.16 + slack * 0.10 - creases * 0.08 + hem * 0.18 + tape * 0.05
    h -= eye * 0.4 + tear * 0.3
    h += ring * 0.15
    m.height = np.clip(h, 0, 1)

    base = tone(C("#5c6144"), n, variation=0.07, seed=seed + 9, cells=3, hue=0.02, sat=0.05)
    col = M.mul(base, 0.78 + tf * 0.38)
    bleach = N.smoothstep(-0.1, 0.5, fold) * blotches(n, 3, seed + 10, threshold=0.45, softness=0.25, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#7e8062")), bleach * 0.5)
    col = M.mul(col, 1.0 - creases * 0.25 + slack * 0.10 + grain * 0.08)
    mud = N.smoothstep(0.55, 1.0, N.uv(n)[1] + N.fbm(n, 8, 4, seed + 11, min_res=256) * 0.3)
    splash = grit(n, seed + 12, density=0.25, sizes=(1.0, 4.5), soft=0.9) * mud
    col = M.mix(col, M.solid(n, C("#4a4034")), np.clip(splash * 1.4, 0, 1) * 0.6)
    col = M.mix(col, M.solid(n, C("#3d3f33")), hem * 0.3)
    col = M.mix(col, M.solid(n, C("#6d6a62")), np.clip(ring, 0, 1) * 0.8)
    col = M.mix(col, M.solid(n, C("#22241d")), eye * 0.9)
    col = M.mix(col, M.solid(n, C("#4a4a44")), tape * 0.55)
    col = M.mul(col, 1.0 - tear * 0.6)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.0) * 0.3)
    m.albedo = col
    m.rough = 0.70 + hw * 0.08 - bleach * 0.05 + splash * 0.15 + grain * 0.05
    m.micro_amt = (0.07, 0.010, 0.05)
    return m.finish()


def leather(n, seed=1200):
    """Full-grain leather, hard used: pore grain, wrinkle furrows, scuffs down to the pale core, worn edges,
    a stitched seam and a dark polished patina in the hollows."""
    m = Mat(n, tile_m=0.4, height_m=0.004)
    grain = rnd(seed + 1, n) - 0.5
    # grain: fine cells with pores at the vertices
    f1, f2, cid = N.worley(n, 240, seed + 2, jitter=1.0)
    cell = N.smoothstep(0.0, 0.28, f2 - f1)
    pores = grit(n, seed + 3, density=0.30, sizes=(0.6, 1.7), soft=0.3)
    # wrinkles: two crossing families of soft furrows
    w1 = N.fbm(n, 7, 4, seed + 4, cells_y=3, min_res=256)
    w2 = N.fbm(n, 3, 4, seed + 5, cells_y=8, min_res=256)
    furrow = np.abs(np.sin((w1 * 3.4 + w2 * 2.2) * np.pi))
    furrow = 1.0 - N.smoothstep(0.0, 0.35, furrow)
    crease = crack_mask(n, crack_lines(n, 14, seed + 6, length=(0.10, 0.55), wander=0.06, branch_p=0.2),
                        width=9.0, soft=6.0)
    crease = np.clip(crease * 1.3, 0, 1)
    scuff = sprinkle_lines(n, 420, seed + 7, length=(15, 130), width=(1, 3), soft=0.6, curve=0.4)
    worn = blotches(n, 4, seed + 8, threshold=0.62, softness=0.15, warp_amt=45)
    seam = (np.abs(N.uv(n)[0] - 0.5) < 0.004).astype(F32)
    stitch = N.smoothstep(0.4, 0.9, N.blur(seam, 2) * (0.5 + 0.5 * np.sin(N.uv(n)[1] * 2 * np.pi * 42.0)))

    h = (0.70 - cell * 0.06 - pores * 0.10 - furrow * 0.16 - crease * 0.10
         + N.blur(1.0 - cell, 3) * 0.04 + grain * 0.02 - scuff * 0.03)
    h = np.clip(h + stitch * 0.30 - N.blur(seam, 4) * 0.12, 0, 1)
    m.height = h
    base = tone(C("#43352a"), n, variation=0.10, seed=seed + 9, cells=3, hue=0.015, sat=0.06)
    col = M.mul(base, 0.86 + (1.0 - cell) * 0.22 + grain * 0.10)
    col = M.mix(col, M.solid(n, C("#2b211a")), np.clip(furrow * 0.85 + crease * 0.55, 0, 1) * 0.5)
    col = M.mix(col, M.solid(n, C("#7d6a55")), np.clip(scuff * 1.2, 0, 1) * 0.45)
    col = M.mix(col, M.solid(n, C("#6b5945")), worn * 0.35)
    col = M.mix(col, M.solid(n, C("#1c1713")), stitch * 0.5)
    col = M.mul(col, 1.0 - M.cavity(h, 2.0) * 0.35)
    m.albedo = col
    m.rough = 0.62 + cell * 0.10 + furrow * 0.10 + worn * 0.14 - np.clip(scuff, 0, 1) * 0.10 + grain * 0.05
    m.micro_amt = (0.07, 0.009, 0.05)
    return m.finish()


def rubber(n, seed=1300):
    """Moulded rubber sheet: mould-grain pebbling, ozone crazing, a parting-line ridge, embedded grit and the
    dull sheen rubber keeps where it has been rubbed."""
    m = Mat(n, tile_m=0.5, height_m=0.003)
    grain = rnd(seed + 1, n) - 0.5
    pebble = N.worley(n, 260, seed + 2, jitter=1.0)[0]
    pebble = N.smoothstep(0.05, 0.6, pebble)
    craze = crack_mask(n, crack_lines(n, 40, seed + 3, length=(0.02, 0.12), wander=0.15, branch_p=0.5,
                                      kink_every=(4, 14)), width=1.3, soft=0.3)
    craze = np.maximum(craze, polygon_cracks(n, 60, seed + 4, width=1.0, soft=0.6, warp_amt=8)[0] * 0.6)
    parting = (np.abs(N.uv(n)[1] - 0.32) < 0.0025).astype(F32)
    parting = N.blur(parting, 1.5)
    gritty = grit(n, seed + 5, density=0.12, sizes=(0.7, 2.2), soft=0.4)
    scuffed = blotches(n, 5, seed + 6, threshold=0.6, softness=0.18, warp_amt=40)
    h = np.clip(0.62 + pebble * 0.10 - craze * 0.10 + parting * 0.25 + gritty * 0.06 + grain * 0.03, 0, 1)
    m.height = h
    base = tone(C("#26262a"), n, variation=0.06, seed=seed + 7, cells=3, hue=0.01, sat=0.03)
    col = M.mul(base, 0.85 + pebble * 0.25 + grain * 0.12)
    col = M.mix(col, M.solid(n, C("#15151a")), craze * 0.7)
    col = M.mix(col, M.solid(n, C("#4a4844")), np.clip(gritty * 1.3, 0, 1) * 0.4)
    col = M.mix(col, M.solid(n, C("#3d3c3a")), scuffed * 0.3)
    dust = blotches(n, 8, seed + 8, threshold=0.68, softness=0.15, warp_amt=30)
    col = M.mix(col, M.solid(n, C("#5a564d")), dust * 0.22)
    m.albedo = col
    m.rough = 0.86 - scuffed * 0.16 + craze * 0.06 + gritty * 0.08 + grain * 0.05
    m.micro_amt = (0.06, 0.008, 0.05)
    return m.finish()


# ============================================================== metals

def painted_metal(n, seed=500):
    """Painted steel (door, locker, machine housing): flat alkyd paint with orange-peel, chips down to primer
    and to bare steel, rust creeping out of every chip, stencil marks and a grimy lower half."""
    m = Mat(n, tile_m=1.0, height_m=0.002)
    grain = rnd(seed + 1, n) - 0.5
    peel = orange_peel(n, seed + 2, cells=300, amount=1.0)
    dent = N.fbm(n, 9, 4, seed + 3, min_res=256)
    scratches = scratch_set(n, seed + 4, groups=((320, (25, 220), (1, 2)), (40, (250, 900), (1, 3))))
    chip1 = flake(n, seed + 5, coverage=0.20, cells=22, edge=0.010)          # paint gone -> primer
    chip2 = flake(n, seed + 6, coverage=0.09, cells=22, edge=0.008) * chip1  # primer gone -> steel
    edgewear = N.smoothstep(0.35, 0.9, N.blur(np.abs(N.uv(n)[0] - 0.5) * 2.0, 2)) * 0.0
    rim = np.clip((N.blur(chip1, 3) - chip1) * 6, 0, 1)
    rust_zone = np.clip(N.blur(chip2, 10) * 3.0 + np.clip(scratches - 0.6, 0, 1) * 1.5, 0, 1)
    rust_zone = rust_zone * (0.35 + 0.65 * blotches(n, 6, seed + 7, threshold=0.4, softness=0.25, warp_amt=40))
    rust_drip = stain_down(chip2 * (rnd(seed + 8, n) < 0.35), decay=0.990, seed=seed + 9, strength=0.9)
    pit = grit(n, seed + 10, density=0.09, sizes=(0.6, 2.0), soft=0.35) * rust_zone

    h = 0.66 + peel * 0.05 + dent * 0.05 - chip1 * 0.16 - chip2 * 0.10 - scratches * 0.05 + rim * 0.03 + pit * 0.08
    m.height = np.clip(h, 0, 1)
    paint = tone(C("#4f5a4b"), n, variation=0.06, seed=seed + 11, cells=3, hue=0.02, sat=0.05)
    paint = M.mul(paint, 1.0 + peel * 0.10 + grain * 0.06)
    fade = blotches(n, 3, seed + 12, threshold=0.45, softness=0.3, warp_amt=45)
    paint = M.mix(paint, M.solid(n, C("#6b7466")), fade * 0.4)
    col = M.mix(paint, M.solid(n, C("#7a5c46")), chip1 * 0.85)            # red-lead primer
    col = M.mix(col, M.solid(n, C("#6d6f72")), chip2 * 0.9)               # bare steel
    col = M.mix(col, M.solid(n, C("#8a8d8f")), np.clip(scratches * 1.2, 0, 1) * 0.55)
    rustc, rustp = M.mix(M.solid(n, C("#6b3a1f")), M.solid(n, C("#8a4d24")), N.fbm(n, 60, 3, seed + 13, min_res=512) * 0.5 + 0.5), pit
    col = M.mix(col, rustc, np.clip(rust_zone * 0.85 + rust_drip * 0.7, 0, 1))
    # stencil: a number and a bar, painted on
    c = Canvas(n, "F", 0.0)
    from .draw import font as _font
    f = _font(int(n * 0.16), bold=True, mono=True)
    c.text((int(n * 0.10), int(n * 0.66)), "12", f, 1.0)
    f2 = _font(int(n * 0.07), bold=True, mono=True)
    c.text((int(n * 0.10), int(n * 0.50)), "OB-12", f2, 1.0)
    sten = N.blur(c.array(), 1.0) * (1.0 - flake(n, seed + 14, coverage=0.45, cells=90, edge=0.06) * 0.85)
    col = M.mix(col, M.solid(n, C("#c9c4b4")), np.clip(sten, 0, 1) * 0.8)
    grime = N.smoothstep(0.35, 1.0, N.uv(n)[1] + N.fbm(n, 6, 4, seed + 15, min_res=256) * 0.35)
    col = M.mul(col, 1.0 - grime * 0.20 - blotches(n, 4, seed + 16, threshold=0.62, softness=0.2) * 0.15)
    col = M.mul(col, 1.0 - M.cavity(m.height, 1.5) * 0.25)
    m.albedo = col
    m.metal = np.clip(chip2 * 0.85 + np.clip(scratches - 0.5, 0, 1) * 0.5 - rust_zone * 0.6, 0, 1)
    m.rough = (0.55 + peel * 0.10 + fade * 0.12 + rust_zone * 0.35 + pit * 0.1
               - np.clip(scratches, 0, 1) * 0.20 + grain * 0.05)
    m.micro_amt = (0.05, 0.006, 0.05)
    return m.finish()


def gunmetal(n, seed=600):
    """Phosphated/blued steel: bead-blast micro texture, draw lines from the press, polished wear on the high
    spots, oil film in the hollows and freckles of rust where the finish has gone."""
    m = Mat(n, tile_m=0.3, height_m=0.0015)
    grain = rnd(seed + 1, n) - 0.5
    blast = grit(n, seed + 2, density=0.5, sizes=(0.5, 1.5), soft=0.3)
    draw = N.fbm(n, 2, 3, seed + 3, cells_y=420, min_res=1024)               # fine drawing lines along one axis
    tooling = 0.5 + 0.5 * np.sin((N.uv(n)[1] * 150.0 + N.fbm(n, 5, 2, seed + 4, min_res=256) * 4.0) * 2 * np.pi)
    tooling = N.smoothstep(0.4, 1.0, tooling) * 0.5
    scratches = scratch_set(n, seed + 5, groups=((260, (20, 160), (1, 2)), (30, (200, 800), (1, 2))))
    wear = blotches(n, 4, seed + 6, threshold=0.58, softness=0.18, warp_amt=40)
    freck = grit(n, seed + 7, density=0.05, sizes=(0.8, 2.6), soft=0.5) * blotches(n, 8, seed + 8, threshold=0.72,
                                                                                   softness=0.12)
    h = np.clip(0.70 + blast * 0.06 + draw * 0.03 + tooling * 0.02 - scratches * 0.05 - freck * 0.10 + grain * 0.03, 0, 1)
    m.height = h
    base = tone(C("#33363a"), n, variation=0.05, seed=seed + 9, cells=3, hue=0.01, sat=0.03)
    col = M.mul(base, 0.86 + blast * 0.22 + draw * 0.10 + grain * 0.10)
    col = M.mix(col, M.solid(n, C("#7f858a")), wear * 0.35)
    col = M.mix(col, M.solid(n, C("#9aa0a4")), np.clip(scratches * 1.2, 0, 1) * 0.6)
    col = M.mix(col, M.solid(n, C("#5e3a22")), np.clip(freck * 1.4, 0, 1) * 0.65)
    oil = blotches(n, 6, seed + 10, threshold=0.6, softness=0.2, warp_amt=35)
    col = M.mul(col, 1.0 - oil * 0.12)
    m.albedo = col
    m.metal = np.clip(0.95 - freck * 0.5, 0, 1)
    m.rough = np.clip(0.42 + blast * 0.16 + freck * 0.35 - wear * 0.20 - np.clip(scratches, 0, 1) * 0.15
                      - oil * 0.08 + grain * 0.05, 0.08, 1.0)
    m.micro_amt = (0.05, 0.006, 0.05)
    return m.finish()


def sheet_metal(n, seed=2900):
    """Hot-dip galvanised sheet: spangle crystals, roller marks, dents, scratches with rust starting in them,
    and the chalky white corrosion galvanising gets outdoors."""
    m = Mat(n, tile_m=1.0, height_m=0.002)
    grain = rnd(seed + 1, n) - 0.5
    f1, f2, cid = N.worley(n, 130, seed + 2, jitter=1.0)
    spangle_v = N.cell_random(cid, 130 * 130, seed + 3, k=2)
    facet = N.smoothstep(0.0, 0.10, f2 - f1)
    roller = 0.5 + 0.5 * np.sin((N.uv(n)[0] * 110.0 + N.fbm(n, 4, 2, seed + 4, min_res=256) * 3.0) * 2 * np.pi)
    dent = N.fbm(n, 12, 4, seed + 5, min_res=256)
    scratches = scratch_set(n, seed + 6, groups=((280, (30, 260), (1, 2)), (26, (300, 1000), (1, 3))))
    white = blotches(n, 5, seed + 7, threshold=0.6, softness=0.2, warp_amt=45)
    rust = np.clip(N.blur(np.clip(scratches - 0.55, 0, 1), 6) * 3.5, 0, 1) * blotches(n, 4, seed + 8, threshold=0.45,
                                                                                     softness=0.25, warp_amt=40)
    h = np.clip(0.70 + facet * 0.03 + roller * 0.012 + dent * 0.05 - scratches * 0.04 + grain * 0.03, 0, 1)
    m.height = h
    base = tone(C("#8e9296"), n, variation=0.05, seed=seed + 9, cells=3, hue=0.01, sat=0.02)
    col = M.mul(base, 0.93 + spangle_v[..., 0] * 0.10 + facet * 0.05 + grain * 0.10 + roller * 0.05)
    col = M.mix(col, M.solid(n, C("#c3c4bf")), white * 0.45)
    col = M.mix(col, M.solid(n, C("#b9bec2")), np.clip(scratches * 1.2, 0, 1) * 0.5)
    col = M.mix(col, M.solid(n, C("#7a4526")), rust * 0.8)
    grime = blotches(n, 3, seed + 10, threshold=0.6, softness=0.25, warp_amt=50)
    col = M.mul(col, 1.0 - grime * 0.18)
    m.albedo = col
    m.metal = np.clip(0.9 - rust * 0.6 - white * 0.35, 0, 1)
    m.rough = np.clip(0.38 + white * 0.35 + rust * 0.4 + facet * 0.06 - np.clip(scratches, 0, 1) * 0.12 + grain * 0.05,
                      0.1, 1.0)
    m.micro_amt = (0.05, 0.006, 0.05)
    return m.finish()


def roof_metal(n, seed=1800):
    """Corrugated galvanised roofing: 76 mm profile, ridge screws with washers, rust blooming from the fixings
    and the sheet laps, moss in the valleys, dents from feet."""
    m = Mat(n, tile_m=1.2, height_m=0.02)
    grain = rnd(seed + 1, n) - 0.5
    x, y = N.uv(n)
    waves = 16
    prof = np.cos(x * 2 * np.pi * waves)
    corr = prof * 0.5 + 0.5
    crest = N.smoothstep(0.72, 1.0, corr)
    valley = N.smoothstep(0.28, 0.0, corr)
    lap = N.smoothstep(0.0, 0.02, np.abs(((y * 2.0) % 1.0) - 0.5) * -1.0 + 0.5) * 0.0
    lap_line = (np.abs(((y + 0.25) % 0.5) - 0.25) < 0.006).astype(F32)
    lap_line = N.blur(lap_line, 2)
    dent = N.fbm(n, 10, 4, seed + 2, min_res=256)
    screws, sring = holes_grid(n, waves // 2, 4, radius_px=n * 0.006, seed=seed + 3, ox=0.25, jitter_px=2)
    screws = screws * crest
    sring = sring * crest
    scratches = scratch_set(n, seed + 4, groups=((200, (40, 300), (1, 2)),))
    rust_src = np.clip(sring * 1.5 + lap_line * 0.8 + valley * 0.35 + np.clip(scratches - 0.6, 0, 1), 0, 1)
    rust = np.clip(N.blur(rust_src, 5) * 2.2, 0, 1) * (0.3 + 0.7 * blotches(n, 5, seed + 5, threshold=0.42,
                                                                           softness=0.25, warp_amt=45))
    rust = np.clip(rust + flake(n, seed + 6, coverage=0.22, cells=14, edge=0.03) * blotches(n, 3, seed + 7,
                                                                                           threshold=0.55,
                                                                                           softness=0.2) * 0.9, 0, 1)
    streak = stain_down(np.clip(sring + lap_line * 0.6, 0, 1) * (rnd(seed + 8, n) < 0.5), decay=0.992,
                        seed=seed + 9, strength=1.0)
    pit = grit(n, seed + 10, density=0.10, sizes=(0.7, 2.4), soft=0.4) * rust
    moss = blotches(n, 9, seed + 11, threshold=0.62, softness=0.1, warp_amt=25) * valley
    h = 0.5 + corr * 0.42 + dent * 0.04 + lap_line * 0.06 - screws * 0.25 + sring * 0.06 - pit * 0.10 + grain * 0.02
    m.height = np.clip(h, 0, 1)
    base = tone(C("#9a9d9c"), n, variation=0.06, seed=seed + 12, cells=3, hue=0.01, sat=0.03)
    col = M.mul(base, 0.80 + crest * 0.22 - valley * 0.10 + grain * 0.10)
    col = M.mix(col, M.solid(n, C("#c0c1bb")), blotches(n, 6, seed + 13, threshold=0.6, softness=0.2) * 0.35)
    rustc = M.mix(M.solid(n, C("#6a3a20")), M.solid(n, C("#95552a")), N.fbm(n, 70, 3, seed + 14, min_res=512) * 0.5 + 0.5)
    col = M.mix(col, rustc, np.clip(rust * 0.95, 0, 1))
    col = M.mix(col, M.solid(n, C("#5e3a22")), np.clip(streak * 0.9, 0, 1) * 0.65)
    col = M.mix(col, M.solid(n, C("#454b3a")), moss * 0.6)
    col = M.mix(col, M.solid(n, C("#55585a")), screws * 0.8)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.5) * 0.3)
    m.albedo = col
    m.metal = np.clip(0.9 - rust * 0.75 - moss, 0, 1)
    m.rough = np.clip(0.42 + rust * 0.45 + moss * 0.3 + grain * 0.05 - crest * 0.05, 0.12, 1.0)
    m.micro_amt = (0.06, 0.008, 0.05)
    return m.finish()


def roof_tile(n, seed=1750):
    """Soviet shifer: asbestos-cement corrugated sheet, 150 mm wave, cement-grey with fibre bloom, algae and
    moss in the troughs, chipped edges, nail holes and long dirt streaks down the fall."""
    m = Mat(n, tile_m=1.5, height_m=0.035)
    grain = rnd(seed + 1, n) - 0.5
    x, y = N.uv(n)
    waves = 10
    corr = np.cos(x * 2 * np.pi * waves) * 0.5 + 0.5
    corr = corr ** 1.15
    crest = N.smoothstep(0.7, 1.0, corr)
    valley = N.smoothstep(0.3, 0.0, corr)
    lap = (np.abs(((y + 0.5) % 1.0) - 0.5) < 0.010).astype(F32)
    lap = N.blur(lap, 2.5)
    fibre = N.fbm(n, 40, 3, seed + 2, cells_y=140, min_res=512)
    sandy = grit(n, seed + 3, density=0.45, sizes=(0.5, 1.7), soft=0.35)
    chip = flake(n, seed + 4, coverage=0.10, cells=40, edge=0.02) * (crest * 0.6 + 0.4)
    crack = crack_mask(n, crack_lines(n, 5, seed + 5, length=(0.05, 0.35), wander=0.06, branch_p=0.25,
                                      direction=np.pi / 2, dir_spread=0.5), width=2.0, soft=0.4)
    nails, nring = holes_grid(n, waves // 2, 3, radius_px=n * 0.005, seed=seed + 6, ox=0.25)
    nails = nails * crest
    h = 0.46 + corr * 0.48 + fibre * 0.02 + sandy * 0.01 - chip * 0.10 - crack * 0.12 - nails * 0.2 + grain * 0.02
    m.height = np.clip(h, 0, 1)
    base = tone(C("#8d8d87"), n, variation=0.07, seed=seed + 7, cells=3, hue=0.01, sat=0.03)
    col = M.mul(base, 0.82 + crest * 0.18 - valley * 0.08 + fibre * 0.10 + sandy * 0.10 + grain * 0.10)
    dirt = stain_down((valley * (rnd(seed + 8, n) < 0.05)).astype(F32), decay=0.996, seed=seed + 9, strength=1.0)
    col = M.mix(col, M.solid(n, C("#55564f")), np.clip(dirt * 1.2, 0, 1) * 0.55)
    algae = blotches(n, 7, seed + 10, threshold=0.55, softness=0.15, warp_amt=35) * (valley * 0.8 + 0.35)
    col = M.mix(col, M.solid(n, C("#4d5540")), algae * 0.6)
    moss = blotches(n, 22, seed + 11, threshold=0.74, softness=0.06, warp_amt=18) * algae
    col = M.mix(col, M.solid(n, C("#5c6a3f")), moss * 0.75)
    col = M.mix(col, M.solid(n, C("#a8a79d")), chip * 0.6)
    col = M.mul(col, 1.0 - crack * 0.45 - lap * 0.2)
    col = M.mix(col, M.solid(n, C("#4a4a46")), nails * 0.8)
    rust_n = stain_down(nails * (rnd(seed + 12, n) < 0.5), decay=0.988, seed=seed + 13, strength=0.8)
    col = M.mix(col, M.solid(n, C("#6b3f24")), rust_n * 0.6)
    col = M.mul(col, 1.0 - M.cavity(m.height, 3.0) * 0.3)
    m.albedo = col
    m.rough = 0.90 + sandy * 0.05 + moss * 0.05 - dirt * 0.06 + grain * 0.05
    m.micro_amt = (0.08, 0.010, 0.06)
    return m.finish()


# ============================================================== stone, ground cover, interiors

def brick(n, seed=300):
    """Soviet red clay brick, 250x65x120 in running bond: struck mortar with sand and voids, sand-faced bricks
    with pits and frog marks, chipped arrises, over-fired headers, salt bloom and soot."""
    m = Mat(n, tile_m=1.0, height_m=0.020)
    grain = rnd(seed + 1, n) - 0.5
    bid, u, v, edged, mortar, dxe, dye = running_bond(n, 4, 15, mortar=0.13, seed=seed + 2, jitter_px=n * 0.0015)
    bv = N.cell_random(bid, 4 * 18, seed + 3, k=5)
    face = 1.0 - mortar

    # brick face: sand-struck, pitted, slightly hollow in the middle
    pits = grit(n, seed + 4, density=0.10, sizes=(0.8, 3.0), soft=0.5)
    sandface = grit(n, seed + 5, density=0.45, sizes=(0.5, 1.6), soft=0.3)
    dish = np.clip(1.0 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 3.0, 0, 1)
    chip = flake(n, seed + 6, coverage=0.35, cells=90, edge=0.05) * N.smoothstep(0.08, 0.0, np.minimum(dxe, dye) / n * 30.0)
    crackb = crack_mask(n, crack_lines(n, 10, seed + 7, length=(0.02, 0.10), wander=0.1, branch_p=0.2),
                        width=1.4, soft=0.35) * face

    # mortar: pressed back, sandy, with voids and tool furrows
    msand = grit(n, seed + 8, density=0.6, sizes=(0.7, 2.6), soft=0.4)
    mvoid = grit(n, seed + 9, density=0.05, sizes=(1.0, 3.6), soft=0.5)
    mfur = N.fbm(n, 90, 3, seed + 10, min_res=512)

    h = (0.72 + (bv[..., 0] - 0.5) * 0.06 + dish * 0.03 + sandface * 0.012 - pits * 0.10
         - chip * 0.16 - crackb * 0.10) * face
    h += (0.50 + msand * 0.05 + mfur * 0.03 - mvoid * 0.12) * mortar
    h -= N.smoothstep(0.0, 0.02, np.minimum(dxe, dye) / n) * 0.0
    m.height = np.clip(h, 0, 1)

    # colour: three firing families plus salmon and over-fired headers
    c1 = M.solid(n, C("#8a4a35"))
    c2 = M.solid(n, C("#6d3a2c"))
    c3 = M.solid(n, C("#a3684a"))
    dark = M.solid(n, C("#4a3630"))
    col = M.mix(c1, c2, bv[..., 1])
    col = M.mix(col, c3, N.smoothstep(0.6, 1.0, bv[..., 2]))
    col = M.mix(col, dark, N.smoothstep(0.86, 0.98, bv[..., 3]))
    col = M.hsv_shift(col, dh=(bv[..., 4] - 0.5) * 0.012, ds=(bv[..., 1] - 0.5) * 0.10, dv=(bv[..., 0] - 0.5) * 0.12)
    col = M.mul(col, 0.88 + sandface * 0.22 + grain * 0.12 + N.fbm(n, 100, 3, seed + 11, min_res=512) * 0.16)
    col = M.mix(col, M.solid(n, C("#5a3328")), np.clip(pits * 1.2, 0, 1) * 0.55)
    col = M.mix(col, M.solid(n, C("#b08b6d")), chip * 0.6)
    mortar_c = M.mul(M.solid(n, C("#8e8878")), 0.82 + msand * 0.3 + mfur * 0.15 + grain * 0.15)
    mortar_c = M.mix(mortar_c, M.solid(n, C("#5f5b51")), np.clip(mvoid * 1.3, 0, 1) * 0.6)
    col = M.mix(col, mortar_c, mortar)
    salt = N.smoothstep(0.45, 0.9, N.blur(mortar, 8) * (N.fbm(n, 14, 4, seed + 12, min_res=256) * 0.5 + 0.55))
    salt = salt * blotches(n, 4, seed + 13, threshold=0.5, softness=0.25, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#c3bdad")), salt * 0.5)
    stain = stain_down((np.clip(mortar * (rnd(seed + 14, n) < 0.05), 0, 1)), decay=0.994, seed=seed + 15, strength=0.8)
    col = M.mix(col, M.solid(n, C("#4a423a")), stain * 0.45)
    soot = blotches(n, 2, seed + 16, threshold=0.6, softness=0.3, warp_amt=60)
    col = M.mul(col, 1.0 - soot * 0.25)
    algae = blotches(n, 10, seed + 17, threshold=0.72, softness=0.08, warp_amt=25) * N.smoothstep(0.4, 1.0, N.uv(n)[1])
    col = M.mix(col, M.solid(n, C("#4c5340")), algae * 0.45)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.0) * 0.45)
    m.albedo = col
    m.rough = 0.88 + sandface * 0.06 + mortar * 0.06 - stain * 0.08 + grain * 0.06
    m.micro_amt = (0.09, 0.012, 0.06)
    return m.finish()


def rock(n, seed=2200):
    """Grey gneiss outcrop: mineral speckle at millimetre scale, foliation banding, conchoidal fracture faces
    with sharp steps, map lichen with dark rims, moss and grit in the joints."""
    m = Mat(n, tile_m=2.0, height_m=0.14)
    grain = rnd(seed + 1, n) - 0.5
    # fracture blocks
    f1, f2, cid = N.worley(n, 7, seed + 2, jitter=1.0)
    bv = N.cell_random(cid, 49, seed + 3, k=4)
    joint = 1.0 - N.smoothstep(0.0, 0.045, f2 - f1)
    face_tilt = N.fbm(n, 12, 4, seed + 4, min_res=256)
    step = (bv[..., 0] - 0.5) * 0.30
    # foliation: banding that runs through the whole rock at one angle
    ang = 0.6
    x, y = N.uv(n)
    band = np.sin((x * np.cos(ang) + y * np.sin(ang)) * 2 * np.pi * 9.0 + N.fbm(n, 5, 4, seed + 5, min_res=256) * 5.0)
    band = N.smoothstep(-0.2, 0.6, band)
    # mineral grains
    q1 = N.worley(n, 340, seed + 6, jitter=1.0)[0]
    q2 = N.worley(n, 700, seed + 7, jitter=1.0)[0]
    quartz = N.smoothstep(0.35, 0.8, 1.0 - q1)
    mica = N.smoothstep(0.55, 0.95, 1.0 - q2) * band
    rough_face = N.fbm(n, 220, 3, seed + 8, min_res=512)
    cracks = crack_mask(n, crack_lines(n, 8, seed + 9, length=(0.1, 0.6), wander=0.08, branch_p=0.35),
                        width=2.6, soft=0.5)
    h = (0.55 + face_tilt * 0.22 + step * 0.5 * (1 - joint) + band * 0.03
         + rough_face * 0.04 + quartz * 0.02 - mica * 0.01 + grain * 0.012)
    h -= joint * 0.42 + cracks * 0.18
    m.height = np.clip(h, 0, 1)

    base = M.mix(M.solid(n, C("#6a6a67")), M.solid(n, C("#565754")), band)
    base = M.hsv_shift(base, ds=(bv[..., 1] - 0.5) * 0.05, dv=(bv[..., 2] - 0.5) * 0.16)
    col = M.mix(base, M.solid(n, C("#a9a69c")), quartz * 0.55)
    col = M.mix(col, M.solid(n, C("#2f302e")), mica * 0.55)
    col = M.mul(col, 0.88 + rough_face * 0.22 + grain * 0.14)
    col = M.mul(col, 1.0 - joint * 0.45 - cracks * 0.4)
    wet = N.smoothstep(0.3, 0.9, N.blur(joint, 12))
    col = M.mul(col, 1.0 - wet * 0.22)
    # lichen: pale green-grey crusts with a dark margin, plus orange crustose spots
    lich = blotches(n, 16, seed + 10, threshold=0.62, softness=0.05, warp_amt=22)
    lich_rim = np.clip((N.blur(lich, 4) - lich) * 6, 0, 1)
    col = M.mix(col, M.solid(n, C("#9aa38a")), lich * 0.6)
    col = M.mix(col, M.solid(n, C("#4c5145")), lich_rim * 0.5)
    orange = blotches(n, 40, seed + 11, threshold=0.80, softness=0.05, warp_amt=10)
    col = M.mix(col, M.solid(n, C("#8a7340")), orange * 0.45)
    moss = blotches(n, 8, seed + 12, threshold=0.6, softness=0.1, warp_amt=30) * N.smoothstep(0.2, 0.8, N.blur(joint, 8))
    col = M.mix(col, M.solid(n, C("#465038")), moss * 0.65)
    col = M.mul(col, 1.0 - M.cavity(m.height, 3.0) * 0.4)
    m.albedo = col
    m.rough = 0.86 + rough_face * 0.06 - quartz * 0.10 - mica * 0.15 + moss * 0.08 + grain * 0.05
    m.micro_amt = (0.09, 0.010, 0.06)
    return m.finish()


def moss(n, seed=2400):
    """Sphagnum and feather moss: thousands of short shoots in clumps, wet dark hollows, dead brown patches
    and the litter that shows between them."""
    from .common import draw_strokes, composite_strokes, gauss_bumps
    m = Mat(n, tile_m=1.0, height_m=0.03)
    grain = rnd(seed + 1, n) - 0.5
    clump = gauss_bumps(n, seed + 2, 220, sigma=n * 0.012, amp=(0.4, 1.0))
    clump = N.norm01(clump)
    hollow = N.smoothstep(0.55, 0.0, clump)
    soil = M.mix(M.solid(n, C("#3a3128")), M.solid(n, C("#2a241d")), N.fbm(n, 40, 4, seed + 3, min_res=512) * 0.5 + 0.5)
    base_col = M.mix(soil, M.solid(n, C("#37402c")), 0.35)
    greens = [C("#49582f"), C("#5c6c39"), C("#3d4a28"), C("#6f7a45"), C("#8a8b52")]
    browns = [C("#6a5a35"), C("#7d6a3f"), C("#4e4327")]
    dead = blotches(n, 5, seed + 4, threshold=0.62, softness=0.15, warp_amt=35)
    rgb1, cov1, h1 = draw_strokes(n, seed + 5, 9000, length=(6, 16), width=(1.6, 3.4),
                                  colors=greens, shade=(0.55, 1.15), tip_light=0.45, height=(0.2, 1.0),
                                  ss=2, segments=3, taper=0.6)
    rgb2, cov2, h2 = draw_strokes(n, seed + 6, 5000, length=(4, 11), width=(1.4, 2.8),
                                  colors=browns, shade=(0.6, 1.1), tip_light=0.3, height=(0.15, 0.8),
                                  ss=2, segments=3, taper=0.6)
    col = composite_strokes(base_col, rgb1, cov1)
    col = composite_strokes(col, rgb2 * (dead[..., None] * 0.8 + 0.2), cov2 * (dead * 0.8 + 0.2))
    shoots = np.maximum(h1, h2 * 0.8)
    h = 0.35 + clump * 0.45 + shoots * 0.22 - hollow * 0.10 + grain * 0.02
    m.height = np.clip(h, 0, 1)
    col = M.mul(col, 0.72 + clump * 0.5)
    col = M.mul(col, 1.0 - hollow * 0.35)
    wet = blotches(n, 4, seed + 7, threshold=0.62, softness=0.2, warp_amt=40) * hollow
    col = M.mul(col, 1.0 - wet * 0.3)
    col = M.mix(col, M.solid(n, C("#7c7a4a")), N.smoothstep(0.5, 1.0, clump) * 0.18)
    m.albedo = col
    m.rough = 0.95 - wet * 0.35 + grain * 0.04
    m.micro_amt = (0.10, 0.010, 0.05)
    return m.finish()


def bone(n, seed=3300):
    """Weathered cortical bone: longitudinal striations, nutrient foramina, sun-checked cracks, soil staining
    in the crevices and a patch where the cortex has broken to show trabecular structure."""
    m = Mat(n, tile_m=0.4, height_m=0.004)
    grain = rnd(seed + 1, n) - 0.5
    stri = N.fbm(n, 3, 3, seed + 2, cells_y=260, min_res=1024)
    stri2 = N.fbm(n, 2, 2, seed + 3, cells_y=700, min_res=2048)
    foram = grit(n, seed + 4, density=0.03, sizes=(0.8, 2.6), soft=0.4)
    checks = crack_mask(n, crack_lines(n, 26, seed + 5, length=(0.04, 0.30), wander=0.03, branch_p=0.2,
                                       direction=0.0, dir_spread=0.10), width=1.6, soft=0.35)
    micro_c = crack_mask(n, crack_lines(n, 60, seed + 6, length=(0.01, 0.05), wander=0.06, direction=0.0,
                                        dir_spread=0.2), width=1.0, soft=0.25)
    broken = flake(n, seed + 7, coverage=0.10, cells=6, edge=0.012)
    tra1 = N.worley(n, 90, seed + 8, jitter=1.0)[0]
    tra2 = N.worley(n, 180, seed + 9, jitter=1.0)[0]
    trab = np.clip(N.smoothstep(0.05, 0.35, tra1) * 0.6 + N.smoothstep(0.05, 0.3, tra2) * 0.5, 0, 1)
    h = 0.74 + stri * 0.03 + stri2 * 0.02 - foram * 0.14 - checks * 0.10 - micro_c * 0.05 + grain * 0.02
    h = np.where(broken > 0.5, 0.52 + trab * 0.22, h)
    m.height = np.clip(h, 0, 1)
    base = tone(C("#cfc7b1"), n, variation=0.06, seed=seed + 10, cells=3, hue=0.01, sat=0.04)
    col = M.mul(base, 0.9 + stri * 0.14 + stri2 * 0.10 + grain * 0.10)
    col = M.mix(col, M.solid(n, C("#a89a80")), N.smoothstep(0.3, 0.9, N.blur(checks, 4)) * 0.4)
    col = M.mul(col, 1.0 - checks * 0.35 - micro_c * 0.2 - foram * 0.5)
    col = M.mix(col, M.mul(M.solid(n, C("#b7ac92")), 0.75 + trab * 0.5), broken)
    soilst = blotches(n, 4, seed + 11, threshold=0.55, softness=0.2, warp_amt=45)
    col = M.mix(col, M.solid(n, C("#6f5f43")), soilst * 0.45)
    green = blotches(n, 14, seed + 12, threshold=0.76, softness=0.08) * soilst
    col = M.mix(col, M.solid(n, C("#5d6247")), green * 0.4)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.0) * 0.35)
    m.albedo = col
    m.rough = 0.72 + checks * 0.12 + broken * 0.18 + soilst * 0.08 + grain * 0.05
    m.micro_amt = (0.07, 0.008, 0.05)
    return m.finish()


def glass(n, seed=2700):
    """Dirty window glass seen from inside: dust film thickest at the edges, rain runnels that washed clean
    lines through it, spatter, greasy smears, a taped crack and the odd fly."""
    m = Mat(n, tile_m=1.0, height_m=0.0006)
    grain = rnd(seed + 1, n) - 0.5
    x, y = N.uv(n)
    edge = np.clip(1.0 - np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y)) * 7.0, 0, 1)
    dust = np.clip(N.fbm(n, 6, 5, seed + 2, min_res=256) * 0.5 + 0.5, 0, 1)
    dust = np.clip(dust * 0.7 + edge * 0.6, 0, 1)
    runnel = stain_down((rnd(seed + 3, n) < 0.0016).astype(F32), decay=0.9975, seed=seed + 4, strength=1.0)
    runnel = np.clip(runnel * 1.6, 0, 1)
    dust = np.clip(dust - runnel * 0.85, 0, 1)
    spatter = grit(n, seed + 5, density=0.05, sizes=(0.8, 3.4), soft=0.5)
    smear = sprinkle_lines(n, 90, seed + 6, length=(80, 500), width=(6, 26), soft=6.0, curve=0.8)
    crack = crack_mask(n, crack_lines(n, 2, seed + 7, length=(0.2, 0.6), wander=0.02, branch_p=0.55,
                                      kink_every=(40, 140), kink=(0.4, 1.2)), width=1.6, soft=0.4)
    tape = ((np.abs(N.wrapped_delta(x, 0.62, 1.0)) < 0.035) & (np.abs(N.wrapped_delta(y, 0.5, 1.0)) < 0.30)).astype(F32)
    tape = N.blur(tape, 1.5)
    h = np.clip(0.5 + dust * 0.10 + spatter * 0.25 + tape * 0.5 - crack * 0.3 + grain * 0.02, 0, 1)
    m.height = h
    base = M.solid(n, C("#c6ccd0"))
    col = M.mul(base, 0.88 + grain * 0.05)
    col = M.mix(col, M.solid(n, C("#a7a396")), np.clip(dust, 0, 1) * 0.55)
    col = M.mix(col, M.solid(n, C("#dfe3e2")), np.clip(runnel, 0, 1) * 0.35)
    col = M.mix(col, M.solid(n, C("#9d9686")), np.clip(spatter * 1.3, 0, 1) * 0.5)
    col = M.mix(col, M.solid(n, C("#b8b6ac")), np.clip(smear, 0, 1) * 0.28)
    col = M.mix(col, M.solid(n, C("#e8e6dc")), crack * 0.7)
    col = M.mix(col, M.solid(n, C("#b3a687")), tape * 0.7)
    m.albedo = col
    m.rough = np.clip(0.06 + dust * 0.55 + spatter * 0.3 + smear * 0.12 + tape * 0.4 + grain * 0.03, 0.03, 1.0)
    m.micro_amt = (0.03, 0.004, 0.04)
    return m.finish()


def paper(n, seed=2600):
    """Cheap Soviet office paper: pulp fibres, foxing, a hard fold, coffee rings, rust-stained staple holes
    and the grey of forty years in a damp drawer."""
    m = Mat(n, tile_m=0.30, height_m=0.0008)
    grain = rnd(seed + 1, n) - 0.5
    fib = sprinkle_lines(n, 6000, seed + 2, length=(6, 40), width=(1, 2), soft=0.5, curve=0.5)
    fib2 = sprinkle_lines(n, 2500, seed + 3, length=(20, 90), width=(1, 2), angle=0.2, spread=0.5, soft=0.7)
    lumps = N.fbm(n, 60, 4, seed + 4, min_res=512)
    fold_y = 0.5 + N.fbm(n, 3, 2, seed + 5, min_res=256) * 0.02
    fold = np.exp(-((N.uv(n)[1] - fold_y) * 260.0) ** 2)
    fold2 = np.exp(-((N.uv(n)[0] - 0.33) * 200.0) ** 2) * 0.6
    crease = np.clip(fold + fold2, 0, 1)
    foxing = grit(n, seed + 6, density=0.05, sizes=(0.9, 4.0), soft=1.1)
    ring = np.zeros((n, n), F32)
    r = N.rng_for(seed + 7)
    xx, yy = N.coords(n)
    for i in range(3):
        cx, cy = r.uniform(0, n, 2)
        rad = r.uniform(0.08, 0.20) * n
        d = np.sqrt(N.wrapped_delta(xx, cx, n) ** 2 + N.wrapped_delta(yy, cy, n) ** 2) / rad
        d = d + N.fbm(n, 20, 3, seed + 30 + i, min_res=256) * 0.25
        ring = np.maximum(ring, (1.0 - N.smoothstep(0.85, 1.05, d)) * 0.35 +
                          np.exp(-((d - 0.95) * 12.0) ** 2) * 0.9)
    staple, sring = holes_grid(n, 1, 1, radius_px=max(2.0, n * 0.0035), seed=seed + 8, ox=0.12, oy=0.10)
    h = np.clip(0.6 + fib * 0.06 + fib2 * 0.04 + lumps * 0.05 + crease * 0.35 - staple * 0.4 + grain * 0.03, 0, 1)
    m.height = h
    base = tone(C("#cec6ac"), n, variation=0.05, seed=seed + 9, cells=3, hue=0.01, sat=0.03)
    col = M.mul(base, 0.92 + fib * 0.10 + fib2 * 0.06 + lumps * 0.08 + grain * 0.08)
    col = M.mix(col, M.solid(n, C("#a9926a")), np.clip(foxing * 1.4, 0, 1) * 0.45)
    col = M.mix(col, M.solid(n, C("#a08a5f")), np.clip(ring, 0, 1) * 0.5)
    col = M.mul(col, 1.0 - crease * 0.10)
    col = M.mix(col, M.solid(n, C("#e0dac6")), np.clip(crease * 1.2, 0, 1) * 0.25)
    edge = np.clip(1.0 - np.minimum(np.minimum(N.uv(n)[0], 1 - N.uv(n)[0]),
                                    np.minimum(N.uv(n)[1], 1 - N.uv(n)[1])) * 9.0, 0, 1)
    col = M.mul(col, 1.0 - edge * 0.14)
    col = M.mix(col, M.solid(n, C("#6d4f31")), np.clip(sring, 0, 1) * 0.6)
    col = M.mix(col, M.solid(n, C("#2c2823")), staple * 0.8)
    m.albedo = col
    m.rough = 0.90 + fib * 0.05 - crease * 0.05 + grain * 0.05
    m.micro_amt = (0.06, 0.006, 0.05)
    return m.finish()


def linoleum(n, seed=3100):
    """Soviet institutional lino: marbled brown-red field printed on a backing, a seam every run, traffic paths
    where the pattern has been walked off, scratches, curled cracked edges and dirt in every scratch."""
    m = Mat(n, tile_m=2.0, height_m=0.0025)
    grain = rnd(seed + 1, n) - 0.5
    # marbling: two warped tone fields plus fleck
    w1 = N.fbm(n, 5, 5, seed + 2, min_res=256)
    w2 = N.fbm(n, 22, 4, seed + 3, min_res=512)
    marb = N.smoothstep(-0.25, 0.35, w1 + w2 * 0.35)
    fleck = grit(n, seed + 4, density=0.28, sizes=(0.7, 2.6), soft=0.35)
    seam = (np.abs(N.wrapped_delta(N.uv(n)[0], 0.5, 1.0)) < 0.0025).astype(F32)
    seam = N.blur(seam, 1.6)
    path = blotches(n, 3, seed + 5, threshold=0.5, softness=0.28, warp_amt=50)
    scratches = scratch_set(n, seed + 6, groups=((520, (20, 200), (1, 2)), (60, (300, 1200), (1, 2))))
    craze = crack_mask(n, crack_lines(n, 14, seed + 7, length=(0.03, 0.18), wander=0.12, branch_p=0.4),
                       width=1.3, soft=0.3) * N.smoothstep(0.2, 0.8, N.blur(seam, 20) * 6 + path * 0.4)
    curl = N.smoothstep(0.4, 1.0, N.blur(seam, 12) * 8.0)
    h = np.clip(0.66 + marb * 0.010 + fleck * 0.02 - scratches * 0.05 - craze * 0.12 - seam * 0.25
                + curl * 0.06 + grain * 0.02, 0, 1)
    m.height = h
    c_dark = M.solid(n, C("#5e3a2e"))
    c_mid = M.solid(n, C("#8a5b42"))
    c_light = M.solid(n, C("#a8846a"))
    col = M.mix(c_dark, c_mid, marb)
    col = M.mix(col, c_light, N.smoothstep(0.62, 1.0, marb + w2 * 0.2))
    col = M.mix(col, M.solid(n, C("#c9b39c")), np.clip(fleck * 1.2, 0, 1) * 0.35)
    col = M.mul(col, 0.9 + grain * 0.12)
    col = M.mix(col, M.solid(n, C("#7d6a5c")), path * 0.45)            # walked-off pattern
    col = M.mix(col, M.solid(n, C("#b9a893")), np.clip(scratches * 1.2, 0, 1) * 0.35)
    col = M.mul(col, 1.0 - craze * 0.45 - seam * 0.45)
    dirt = np.clip(N.blur(scratches, 3) * 0.6 + M.cavity(h, 2.0) * 1.2, 0, 1)
    col = M.mul(col, 1.0 - dirt * 0.25)
    grime = blotches(n, 4, seed + 8, threshold=0.6, softness=0.22, warp_amt=45)
    col = M.mul(col, 1.0 - grime * 0.18)
    m.albedo = col
    m.rough = np.clip(0.42 + path * 0.30 + craze * 0.2 + np.clip(scratches, 0, 1) * 0.15 + grime * 0.1 + grain * 0.05,
                      0.1, 1.0)
    m.micro_amt = (0.05, 0.005, 0.05)
    return m.finish()


def wallpaper(n, seed=3000):
    """Papered room, thirty years on: a small printed repeat on a cream ground, drop seams every 530 mm,
    damp tide marks, bubbles, and a corner peeled back to the plaster."""
    m = Mat(n, tile_m=1.06, height_m=0.0015)
    grain = rnd(seed + 1, n) - 0.5
    x, y = N.uv(n)
    # printed repeat: a stylised four-petal motif on a grid with a half-drop
    cells_x, cells_y = 8, 10
    gx = x * cells_x
    gy = y * cells_y + np.floor(gx) * 0.5
    fx = gx - np.floor(gx) - 0.5
    fy = gy - np.floor(gy) - 0.5
    rr = np.sqrt(fx * fx + fy * fy)
    th = np.arctan2(fy, fx)
    petal = 0.20 + 0.10 * np.cos(th * 4.0)
    motif = 1.0 - N.smoothstep(petal - 0.02, petal + 0.02, rr)
    dot = 1.0 - N.smoothstep(0.05, 0.07, rr)
    stem = 1.0 - N.smoothstep(0.010, 0.016, np.abs(fy - 0.32) + np.abs(fx) * 0.2)
    print_mask = np.clip(motif * 0.85 + dot * 0.5 + stem * 0.4, 0, 1)
    # paper structure
    fib = sprinkle_lines(n, 4000, seed + 2, length=(8, 40), width=(1, 2), soft=0.6, curve=0.4)
    emboss = N.fbm(n, 120, 3, seed + 3, min_res=512)
    seam = (np.abs(N.wrapped_delta(x, 0.5, 1.0)) < 0.004).astype(F32)
    seam = N.blur(seam, 2.0)
    bubble = blotches(n, 9, seed + 4, threshold=0.72, softness=0.10, warp_amt=25)
    tear = flake(n, seed + 5, coverage=0.10, cells=5, edge=0.008)
    tear = tear * N.smoothstep(0.3, 0.9, np.clip(N.blur(seam, 18) * 6.0 + blotches(n, 3, seed + 6, threshold=0.6,
                                                                                  softness=0.15), 0, 1))
    rim = np.clip((N.blur(tear, 3) - tear) * 6, 0, 1)
    plaster_c = M.mul(M.solid(n, C("#a89f8c")), 0.85 + N.fbm(n, 70, 3, seed + 7, min_res=512) * 0.3 + grain * 0.15)
    h = np.clip(0.66 + fib * 0.05 + emboss * 0.03 + print_mask * 0.02 + bubble * 0.12 + seam * 0.10
                - tear * 0.35 + rim * 0.1 + grain * 0.02, 0, 1)
    m.height = h
    ground = tone(C("#cfc4ab"), n, variation=0.05, seed=seed + 8, cells=3, hue=0.01, sat=0.03)
    ink1 = M.solid(n, C("#8d9a86"))
    ink2 = M.solid(n, C("#a8836f"))
    col = M.mix(ground, ink1, np.clip(motif, 0, 1) * 0.55)
    col = M.mix(col, ink2, np.clip(dot + stem, 0, 1) * 0.5)
    col = M.mul(col, 0.94 + fib * 0.08 + emboss * 0.06 + grain * 0.08)
    fade = blotches(n, 3, seed + 9, threshold=0.45, softness=0.3, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#c8c1b2")), fade * 0.35)
    damp = N.smoothstep(0.55, 1.0, y + N.fbm(n, 5, 4, seed + 10, min_res=256) * 0.3)
    damp = np.clip(damp + blotches(n, 4, seed + 11, threshold=0.7, softness=0.12, warp_amt=50) * 0.7, 0, 1)
    damp_rim = np.clip((N.blur(damp, 14) - damp) * 3.0, 0, 1)
    col = M.mix(col, M.solid(n, C("#9a8f75")), damp * 0.45)
    col = M.mix(col, M.solid(n, C("#7d6f56")), damp_rim * 0.5)
    mould = blotches(n, 40, seed + 12, threshold=0.74, softness=0.06) * damp
    col = M.mix(col, M.solid(n, C("#3a3a32")), mould * 0.6)
    col = M.mix(col, plaster_c, tear)
    col = M.mul(col, 1.0 - seam * 0.18)
    col = M.mul(col, 1.0 - M.cavity(h, 2.0) * 0.2)
    m.albedo = col
    m.rough = 0.86 + damp * 0.06 + tear * 0.06 + grain * 0.05
    m.micro_amt = (0.06, 0.006, 0.05)
    return m.finish()


def rust(n, seed=400):
    """Steel that has been left out: islands of the old paint, exfoliating scale in layers, deep pitting,
    a bloom of fresh orange where water sits and streaks below every edge."""
    m = Mat(n, tile_m=1.0, height_m=0.004)
    grain = rnd(seed + 1, n) - 0.5
    paint = flake(n, seed + 2, coverage=0.34, cells=13, edge=0.012)
    paint_rim = np.clip((N.blur(paint, 3) - paint) * 6, 0, 1)
    scale1 = flake(n, seed + 3, coverage=0.55, cells=26, edge=0.02) * (1 - paint)
    scale2 = flake(n, seed + 4, coverage=0.35, cells=55, edge=0.02) * scale1
    pit = grit(n, seed + 5, density=0.14, sizes=(0.7, 3.0), soft=0.4) * (1 - paint)
    deep = grit(n, seed + 6, density=0.03, sizes=(1.5, 5.0), soft=0.6) * (1 - paint)
    fresh = blotches(n, 5, seed + 7, threshold=0.5, softness=0.18, warp_amt=45) * (1 - paint)
    dark = blotches(n, 8, seed + 8, threshold=0.55, softness=0.15, warp_amt=30)
    streak = stain_down(np.clip(paint_rim + deep * 0.6, 0, 1) * (rnd(seed + 9, n) < 0.35), decay=0.991,
                        seed=seed + 10, strength=0.9)
    h = (0.62 + paint * 0.10 + scale1 * 0.07 + scale2 * 0.06 - pit * 0.16 - deep * 0.26
         + paint_rim * 0.04 + grain * 0.03)
    m.height = np.clip(h, 0, 1)
    paint_c = tone(C("#5a6353"), n, variation=0.07, seed=seed + 11, cells=3, hue=0.02, sat=0.05)
    r_dark = M.solid(n, C("#3a2114"))
    r_mid = M.solid(n, C("#6d3d1e"))
    r_br = M.solid(n, C("#9a5a26"))
    r_or = M.solid(n, C("#b06a2c"))
    rc = M.mix(r_dark, r_mid, N.smoothstep(0.2, 0.8, scale1))
    rc = M.mix(rc, r_br, N.smoothstep(0.35, 0.95, scale2))
    rc = M.mix(rc, r_or, fresh * 0.75)
    rc = M.mix(rc, r_dark, np.clip(dark * 0.7 + deep * 1.2, 0, 1) * 0.7)
    rc = M.mul(rc, 0.85 + N.fbm(n, 80, 3, seed + 12, min_res=512) * 0.30 + grain * 0.16 + pit * 0.12)
    col = M.mix(rc, paint_c, paint)
    col = M.mix(col, M.solid(n, C("#7d858d")), paint_rim * (1 - paint) * 0.25)
    col = M.mix(col, M.solid(n, C("#7a4a22")), np.clip(streak, 0, 1) * 0.6)
    col = M.mul(col, 1.0 - M.cavity(m.height, 2.0) * 0.4)
    m.albedo = col
    m.metal = np.clip(paint * 0.15 + (1 - paint) * 0.35 - fresh * 0.2, 0, 1)
    m.rough = np.clip(0.72 + (1 - paint) * 0.18 + pit * 0.1 - paint * 0.15 + grain * 0.06, 0.2, 1.0)
    m.micro_amt = (0.09, 0.010, 0.06)
    return m.finish()
