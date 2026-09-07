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
    bug = grit(n, seed + 6, density=0.10, sizes=(0.9, 3.4), soft=0.6)
    bug = N.smoothstep(0.25, 0.8, bug) * N.smoothstep(0.35, 0.75, blotches(n, 5, seed + 7, threshold=0.4,
                                                                          softness=0.25, warp_amt=40) + 0.25)
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
    sand = grit(n, seed + 2, density=0.55, sizes=(0.5, 1.9), soft=0.35)

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
    base = M.mul(base, 1.0 + trowel * 0.05 + ridge * 0.06 + grain * 0.08 + sand * 0.10)
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
    m.rough = 0.84 + sand * 0.08 - damp * 0.16 - wash * 0.04 + fall1 * 0.08 + mould * 0.05 + grain * 0.07
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

    # --- grain: 7-14 growth rings across a 150 mm board, warped, latewood a sharp dark line
    w1 = N.fbm(n, 4, 4, seed + 3, cells_y=9, min_res=256)
    w2 = N.fbm(n, 16, 3, seed + 4, cells_y=40, min_res=512)
    freq = 7.0 + pv[..., 0] * 7.0
    phase = (u + w1 * 0.16 + w2 * 0.035 + pv[..., 1] * 5.0) * freq
    saw = 0.5 + 0.5 * np.sin(phase * 2 * np.pi)
    late = N.smoothstep(0.62, 0.95, saw)                      # narrow dark latewood band
    early = N.smoothstep(0.05, 0.55, saw)
    fibre = N.fbm(n, 3, 3, seed + 5, cells_y=520, min_res=1024)
    sawmark = 0.5 + 0.5 * np.sin((v * 240.0 + N.fbm(n, 6, 2, seed + 6, min_res=256) * 3.0) * 2 * np.pi)
    sawmark = N.smoothstep(0.5, 1.0, sawmark) * N.smoothstep(0.3, 0.7, pv[..., 4])

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
    fresh = M.mix(early_c, late_c, np.clip(late * 0.85 + saw * 0.3, 0, 1))
    fresh = M.hsv_shift(fresh, dh=(pv[..., 1] - 0.5) * 0.02, ds=(pv[..., 2] - 0.5) * 0.12, dv=(pv[..., 3] - 0.5) * 0.14)
    grey = M.mix(M.solid(n, C("#918f86")), M.solid(n, C("#5f5d57")), np.clip(late * 0.9, 0, 1))
    col = M.mix(fresh, grey, silver)
    col = M.mul(col, 1.0 + fibre * 0.16 + grain * 0.14 + sawmark * 0.05)
    col = M.mix(col, M.solid(n, C("#33281d")), knot * 0.75)
    col = M.mul(col, 1.0 - splits * 0.55 - checks * 0.25 - gap * 0.75)
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
    fibre = N.fbm(n, 2, 3, seed + 5, cells_y=460, min_res=1024)
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
    h = 0.30 + round_ * 0.62 + along * 0.03 + hewn * 0.025 + fibre * 0.015 + knot * 0.03
    h -= joint * 0.55 + checks * 0.16
    h += chink * 0.12                                             # oakum/moss packed into the groove
    m.height = np.clip(h, 0, 1)

    silver = np.clip(N.smoothstep(0.15, 0.75, round_) * (0.5 + 0.7 * blotches(n, 4, seed + 10, threshold=0.45,
                                                                              softness=0.25, warp_amt=40)), 0, 1)
    base = M.mix(M.solid(n, C("#6b563f")), M.solid(n, C("#8a7358")), np.clip(along * 0.5 + 0.5, 0, 1))
    base = M.hsv_shift(base, ds=(cv[..., 1] - 0.5) * 0.12, dv=(cv[..., 2] - 0.5) * 0.14)
    grey = M.mix(M.solid(n, C("#928f86")), M.solid(n, C("#63615a")), np.clip(fibre * 0.5 + 0.5, 0, 1))
    col = M.mix(base, grey, silver * 0.85)
    col = M.mul(col, 1.0 + fibre * 0.18 + grain * 0.13 + hewn * 0.08)
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
    rows = 46
    for i in range(rows):
        yy = (i + r.uniform(-0.35, 0.35)) * n / rows
        cnt = int(r.uniform(3, 11))
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
        rx = r.uniform(0.045, 0.10) * n
        ry = rx * r.uniform(1.5, 3.0)
        dx = N.wrapped_delta(xx, cx, n) / rx
        dy = N.wrapped_delta(yyc, cy, n) / ry
        d = np.sqrt(dx * dx + dy * dy) * (1.0 + 0.45 * np.sin(np.arctan2(dy, dx) * r.integers(3, 7) + r.uniform(0, 6)))
        d = d + N.fbm(n, 12, 3, seed + 20 + i, min_res=256) * 0.55
        scar = np.maximum(scar, 1.0 - N.smoothstep(0.75, 1.5, d))
        scar_core = np.maximum(scar_core, 1.0 - N.smoothstep(0.25, 0.75, d))
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

    fissure = 1.0 - N.smoothstep(0.0, 0.42, plates)
    subfis = (1.0 - N.smoothstep(0.0, 0.35, sub)) * (1 - fissure)
    lift = np.clip(scedge * 1.6, 0, 1) * (1 - fissure) * (1 - subfis)
    fine = N.fbm(n, 140, 3, seed + 8, min_res=512)

    h = (0.30 + plates * 0.50 + (pv[..., 0] - 0.5) * 0.14
         + sub * 0.13 * (1 - fissure) + (sv[..., 0] - 0.5) * 0.05
         + scale * 0.05 * (1 - fissure) + lift * 0.05
         + fine * 0.025 + grain * 0.012)
    h -= subfis * 0.10
    m.height = np.clip(h, 0, 1)

    inner = M.mix(M.solid(n, C("#7a4f33")), M.solid(n, C("#96603c")), scv[..., 0])
    outer = M.mix(M.solid(n, C("#5c4d40")), M.solid(n, C("#736152")), pv[..., 1])
    col = M.mix(outer, inner, np.clip(N.smoothstep(0.45, 0.95, sub) * 0.55 + lift * 0.6, 0, 1))
    col = M.mix(col, M.solid(n, C("#7d7368")), N.smoothstep(0.6, 1.0, scale) * 0.30)
    col = M.mix(col, M.solid(n, C("#241c16")), fissure * 0.9)
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
