"""Material recipes (masonry, stone, ground). Each function returns a Mat (albedo sRGB, height, roughness,
metallic) for an n x n tile. Every recipe is a physically motivated stack (structure -> weathering -> dirt),
periodic by construction. Palette follows DESIGN.md: desaturated, cold; rust is the only warm accent.
"""
import numpy as np
from . import noise as N
from . import maps as M
from .common import (Mat, speckle, blotches, crack_lines, crack_mask, polygon_cracks, stones, running_bond,
                     seams_grid, holes_grid, stain_down, grain_stripes, tone, rust_colour, sprinkle_lines)
from .draw import Canvas, stroke_field

F32 = np.float32
C = M.hexc


def rnd(seed, n):
    return N.rng_for(seed).random((n, n), dtype=F32)


# ============================================================== masonry

def concrete(n, seed=100):
    """Cast-in-place wall: board-form ribs, form joints, tie holes, air pits, spalls, cracks, run-off stains."""
    m = Mat(n, tile_m=2.0, height_m=0.03)
    ppm = n / m.tile_m
    fine = N.fbm(n, 64, 5, seed, min_res=512)
    grain = rnd(seed + 99, n) - 0.5
    aggregate = 1.0 - N.smoothstep(0.1, 0.5, N.worley(n, 300, seed + 1)[0])
    # air pits: clustered, varied size
    pit_f = N.worley(n, 160, seed + 2)[0]
    pit_zone = blotches(n, 5, seed + 3, threshold=0.5, softness=0.2, warp_amt=30)
    pit_size = 0.08 + 0.22 * pit_zone
    bubbles = (1.0 - N.smoothstep(pit_size * 0.5, pit_size, pit_f)) * N.smoothstep(0.35, 0.6, pit_zone)
    boards = 0.5 + 0.5 * np.sin(N.uv(n)[1] * 2 * np.pi * 14 + N.fbm(n, 4, 2, seed + 4, min_res=256) * 0.6)
    boards = N.smoothstep(0.35, 0.65, boards) * 0.25 + boards * 0.2
    seam, seam_line = seams_grid(n, 1, 2, width_px=0.012 * ppm, chamfer_px=0.03 * ppm)
    holes, ring = holes_grid(n, 4, 4, radius_px=0.014 * ppm, seed=seed + 5, jitter_px=3)
    hole_keep = N.smoothstep(0.3, 0.32, N.value_noise(n, 4, seed + 55))          # some tie holes filled with mortar
    holes = holes * (0.35 + 0.65 * hole_keep)
    spall = blotches(n, 4, seed + 6, threshold=0.7, softness=0.04, warp_amt=40)
    spall_rim = np.clip((N.blur(spall, 5) - spall) * 4, 0, 1)
    lines = crack_lines(n, 4, seed + 7, length=(0.25, 0.7), wander=0.07, branch_p=0.4)
    lines += crack_lines(n, 5, seed + 8, length=(0.08, 0.25), wander=0.1, branch_p=0.2)
    cracks = crack_mask(n, lines, width=2.6, soft=0.6)
    hair = crack_mask(n, crack_lines(n, 8, seed + 9, length=(0.05, 0.18), wander=0.12, branch_p=0.3), width=1.2, soft=0.4)
    chip = N.smoothstep(0.6, 0.9, N.fbm(n, 40, 4, seed + 10, min_res=512) * 0.5 + 0.5) * (N.blur(seam_line, 6) > 0.04)
    h = 0.72 + fine * 0.05 + grain * 0.02 + boards * 0.04 * (1 - seam) + aggregate * 0.015
    h -= bubbles * 0.14 + seam * 0.35 + holes * 0.5 + spall * 0.28 + cracks * 0.2 + hair * 0.06 + chip * 0.18
    h += spall * (N.fbm(n, 150, 3, seed + 11) * 0.08 + aggregate * 0.06)
    m.height = h
    # --- colour
    base = tone(C("#6f6c67"), n, variation=0.09, seed=seed + 12, cells=2, hue=0.02, sat=0.05)
    mottle = N.fbm(n, 8, 6, seed + 13, min_res=256)
    base = M.mul(base, 1.0 + mottle * 0.16 + fine * 0.08 + grain * 0.1)
    base = M.mix(base, M.solid(n, C("#8f8c87")), np.clip(aggregate, 0, 1) * 0.3)
    base = M.mix(base, M.solid(n, C("#45433f")), N.smoothstep(0.1, 0.9, bubbles) * 0.7)
    base = M.mix(base, M.solid(n, C("#5a554d")), spall * 0.8)
    base = M.mix(base, M.solid(n, C("#9a9791")), spall_rim * (1 - spall) * 0.55)
    base = M.mul(base, 1.0 - cracks * 0.6 - hair * 0.3 - seam * 0.3 - holes * 0.55 - chip * 0.25)
    # weathering: water run-off from cracks, holes and seams; damp blotches; efflorescence; rust from ties
    src = np.clip(cracks * 0.9 + holes * 1.0 + np.roll(seam, 4, axis=0) * 0.7 + bubbles * 0.5 + spall_rim * 0.5, 0, 1)
    src = src * (rnd(seed + 14, n) < 0.25)
    stain = stain_down(src, decay=0.9955, seed=seed + 15, strength=1.0)
    stain = np.clip(stain * (0.5 + 0.5 * (N.fbm(n, 24, 4, seed + 16, min_res=512) * 0.5 + 0.5)), 0, 1)
    base = M.mix(base, M.solid(n, C("#3b3b39")), np.clip(stain * 1.3, 0, 1) * 0.6)
    dampb = blotches(n, 3, seed + 17, threshold=0.6, softness=0.2, warp_amt=50)
    base = M.mix(base, M.solid(n, C("#54564f")), dampb * 0.4)
    algae = blotches(n, 12, seed + 18, threshold=0.7, softness=0.08, warp_amt=20) * dampb
    base = M.mix(base, M.solid(n, C("#4d5540")), algae * 0.5)
    effl = N.blur(cracks, 12) * (N.fbm(n, 60, 3, seed + 19, min_res=512) * 0.5 + 0.5)
    effl = N.smoothstep(0.02, 0.2, effl)
    base = M.mix(base, M.solid(n, C("#b0aea7")), effl * 0.55)
    rust_ring = np.clip(ring * 2.0, 0, 1) * hole_keep
    rust_drip = stain_down(holes * hole_keep * (rnd(seed + 20, n) < 0.3), decay=0.987, seed=seed + 21, strength=0.8)
    base = M.mix(base, M.solid(n, C("#6b3f25")), np.clip(rust_ring * 0.7 + rust_drip * 0.8, 0, 1))
    soot = blotches(n, 2, seed + 22, threshold=0.62, softness=0.25, warp_amt=60)
    base = M.mul(base, 1.0 - soot * 0.25)
    cav = M.cavity(m.height, 2.0)
    base = M.mul(base, 1.0 - cav * 0.35)
    m.albedo = base
    m.rough = 0.88 + fine * 0.05 - stain * 0.2 - dampb * 0.12 + spall * 0.06 + effl * 0.05 + grain * 0.08
    return m.finish()


def plaster(n, seed=200):
    """Lime plaster over brick: trowel marks, crazing, patches fallen off in layers, damp tide marks, mould."""
    m = Mat(n, tile_m=2.0, height_m=0.03)
    r = N.rng_for(seed)
    c = Canvas(n, "F", 0.0)
    for i in range(220):
        cx, cy = r.uniform(0, n, 2)
        rad = r.uniform(0.1, 0.35) * n
        a0 = r.uniform(0, 2 * np.pi)
        a1 = a0 + r.uniform(0.4, 1.5)
        pts = [(cx + np.cos(a) * rad, cy + np.sin(a) * rad * r.uniform(0.6, 1.0)) for a in np.linspace(a0, a1, 24)]
        c.line(pts, float(r.uniform(0.3, 1.0)), width=int(r.uniform(6, 26)))
    trowel = N.blur(c.array(), 3)
    fine = N.fbm(n, 90, 4, seed + 1, min_res=512)
    grain = rnd(seed + 2, n) - 0.5
    sand = speckle(n, 0.003, seed + 3, size=(0.6, 1.6), soft=0.4)
    # crazing and structural cracks
    craze = crack_mask(n, crack_lines(n, 16, seed + 4, length=(0.05, 0.2), wander=0.1, branch_p=0.45, kink_every=(6, 20)), width=1.3, soft=0.4)
    big = crack_mask(n, crack_lines(n, 3, seed + 5, length=(0.3, 0.8), wander=0.06, branch_p=0.35), width=2.8, soft=0.7)
    # fallen plaster: two layers (finish coat gone -> rough scratch coat; both gone -> brick)
    fall2 = blotches(n, 3, seed + 6, threshold=0.72, softness=0.02, warp_amt=60)               # down to brick
    fall1 = np.maximum(blotches(n, 3, seed + 6, threshold=0.64, softness=0.03, warp_amt=60), fall2)   # finish coat gone
    fall1 = np.maximum(fall1, N.smoothstep(0.3, 0.9, N.blur(big, 6) * 3) * blotches(n, 6, seed + 7, threshold=0.5, softness=0.2))
    rim1 = np.clip((N.blur(fall1, 3) - fall1) * 5, 0, 1)
    rim2 = np.clip((N.blur(fall2, 3) - fall2) * 5, 0, 1)
    bid, u, v, edged, mortar, dxe, dye = running_bond(n, 8, 26, mortar=0.16, seed=seed + 8)
    bvar = N.cell_random(bid, 8 * 30, seed + 9, k=3)
    brick_h = 0.5 - mortar * 0.2 + N.fbm(n, 120, 3, seed + 10, min_res=512) * 0.04 + bvar[..., 0] * 0.03
    scratch_h = 0.72 + N.fbm(n, 70, 4, seed + 11, min_res=512) * 0.06 + grain * 0.03
    finish_h = 0.92 + trowel * 0.04 + fine * 0.025 + sand * 0.02 + grain * 0.005
    h = finish_h * (1 - fall1) + scratch_h * (fall1 - fall2) + brick_h * fall2
    h -= craze * 0.05 + big * 0.12
    bulge = blotches(n, 10, seed + 12, threshold=0.7, softness=0.05) * N.smoothstep(0.0, 0.3, N.blur(fall1, 30)) * (1 - fall1)
    h += bulge * 0.03   # hollow blisters about to fall
    m.height = h
    # colour: whitewash over lime plaster, yellowed, pale blue-green wash remnants
    base = tone(C("#bdb5a3"), n, variation=0.06, seed=seed + 13, cells=3, hue=0.01, sat=0.04)
    base = M.mul(base, 1.0 + fine * 0.05 + trowel * 0.04 + grain * 0.06)
    yellow = blotches(n, 3, seed + 14, threshold=0.5, softness=0.3, warp_amt=40)
    base = M.mix(base, M.solid(n, C("#a89a7b")), yellow * 0.45)
    wash = blotches(n, 2, seed + 15, threshold=0.52, softness=0.2, warp_amt=70)
    base = M.mix(base, M.solid(n, C("#98a498")), wash * 0.5)
    base = M.mul(base, 1.0 - craze * 0.45 - big * 0.55 - bulge * 0.05)
    scratch_c = M.mul(M.solid(n, C("#8f877a")), 0.85 + N.fbm(n, 70, 3, seed + 16, min_res=512) * 0.25 + grain * 0.15)
    brick_c = M.mix(M.solid(n, C("#7a4e3d")), M.solid(n, C("#5e4034")), bvar[..., 1])
    brick_c = M.mix(brick_c, M.solid(n, C("#8c6a58")), bvar[..., 2] * 0.5)
    brick_c = M.mix(brick_c, M.solid(n, C("#7c7669")), mortar)
    brick_c = M.mul(brick_c, 0.85 + N.fbm(n, 80, 3, seed + 17, min_res=512) * 0.15)
    base = M.mix(base, scratch_c, fall1)
    base = M.mix(base, brick_c, fall2)
    base = M.mix(base, M.solid(n, C("#d6cfbd")), rim1 * (1 - fall1) * 0.7)
    base = M.mix(base, M.solid(n, C("#b0a89a")), rim2 * (1 - fall2) * 0.5)
    damp = blotches(n, 3, seed + 18, threshold=0.66, softness=0.1, warp_amt=60)
    damp_rim = np.clip((N.blur(damp, 16) - damp) * 2.5, 0, 1)
    base = M.mix(base, M.solid(n, C("#6d675c")), damp * 0.5)
    base = M.mix(base, M.solid(n, C("#d3ccbc")), damp_rim * 0.35)
    mould = blotches(n, 40, seed + 19, threshold=0.72, softness=0.05) * np.maximum(damp, N.blur(fall1, 20))
    base = M.mix(base, M.solid(n, C("#33362f")), mould * 0.65)
    grime = N.fbm(n, 5, 5, seed + 20, min_res=256) * 0.5 + 0.5
    base = M.mul(base, 0.86 + grime * 0.2)
    stain = stain_down(np.clip(big + craze * 0.3 + rim1, 0, 1) * (rnd(seed + 21, n) < 0.06), decay=0.994, seed=seed + 22, strength=0.7)
    base = M.mix(base, M.solid(n, C("#514e47")), stain * 0.5)
    cav = M.cavity(m.height, 2.0)
    base = M.mul(base, 1.0 - cav * 0.3)
    m.albedo = base
    m.rough = 0.82 + fine * 0.05 - damp * 0.12 - wash * 0.05 + fall1 * 0.1 + mould * 0.05 + grain * 0.05
    return m.finish()


def brick(n, seed=300):
    """Red clay brick 250x65, running bond, recessed lime mortar, irregular edges, chipped corners, salt, soot."""
    m = Mat(n, tile_m=1.0, height_m=0.02)
    cols, rows = 4, 13
    # wobble the layout slightly so edges are not machine-straight
    wob = N.fbm(n, 8, 3, seed + 90, min_res=256) * 3.0
    bid, u, v, edged, mortar, dxe, dye = running_bond(n, cols, rows, mortar=0.13, seed=seed)
    bvar = N.cell_random(bid, rows * (cols + 1) + 8, seed + 1, k=6)
    fine = N.fbm(n, 100, 4, seed + 2, min_res=512)
    grain = rnd(seed + 3, n) - 0.5
    face = N.fbm(n, 24, 4, seed + 4, min_res=512)
    striae = 0.5 + 0.5 * np.sin(N.uv(n)[1] * 2 * np.pi * 400 + N.fbm(n, 30, 2, seed + 5, min_res=512) * 3)  # extrusion lines
    striae = striae * N.smoothstep(0.4, 0.8, bvar[..., 5])
    edge_prox = 1.0 - N.smoothstep(0.0, 0.25, edged + wob / n * rows)
    chipn = N.fbm(n, 60, 4, seed + 6, min_res=512) * 0.5 + 0.5
    chip = N.smoothstep(0.62 - bvar[..., 3] * 0.3, 0.8, chipn) * edge_prox
    spallface = blotches(n, 14, seed + 7, threshold=0.76, softness=0.03) * N.smoothstep(0.7, 0.9, bvar[..., 2])
    pits = 1.0 - N.smoothstep(0.08, 0.3, N.worley(n, 180, seed + 8)[0])
    pits *= blotches(n, 8, seed + 9, threshold=0.55, softness=0.1)
    mortar_h = 0.52 + N.fbm(n, 140, 3, seed + 10, min_res=512) * 0.07 + speckle(n, 0.003, seed + 11, size=(0.8, 2.2), soft=0.4) * 0.06 + grain * 0.03
    missing = blotches(n, 16, seed + 12, threshold=0.74, softness=0.05) * mortar
    ragged = N.smoothstep(-0.02, 0.06, edged - (N.fbm(n, 200, 2, seed + 13) * 0.03))   # ragged brick edge
    brick_h = 0.85 + bvar[..., 0] * 0.07 + face * 0.02 + fine * 0.02 + grain * 0.01 + striae * 0.008 - pits * 0.08 - chip * 0.25 - spallface * 0.12
    h = brick_h * ragged + 0.52 * (1 - ragged)
    h = h * (1 - mortar) + mortar_h * mortar
    h -= missing * 0.18
    m.height = h
    reds = [C("#7b4b3b"), C("#8a5341"), C("#6a3f33"), C("#96634c"), C("#5a3a33"), C("#8f5c47")]
    col = M.solid(n, reds[0])
    for i, cc in enumerate(reds[1:]):
        w = N.smoothstep(i * 0.17, i * 0.17 + 0.17, bvar[..., 1])
        col = M.mix(col, M.solid(n, cc), w)
    col = M.hsv_shift(col, dh=(bvar[..., 2] - 0.5) * 0.02, ds=(bvar[..., 4] - 0.5) * 0.14, dv=(bvar[..., 0] - 0.5) * 0.12)
    col = M.mul(col, 1.0 + face * 0.18 + fine * 0.1 + grain * 0.12 + striae * 0.05)
    over = N.smoothstep(0.86, 0.97, bvar[..., 3])
    col = M.mix(col, M.solid(n, C("#43332f")), over * 0.7)
    col = M.mix(col, M.solid(n, C("#a8806a")), chip * 0.6)
    col = M.mix(col, M.solid(n, C("#8a5e4a")), spallface * 0.5)
    col = M.mix(col, M.solid(n, C("#47382f")), pits * 0.5)
    mortar_c = tone(C("#8d887a"), n, variation=0.12, seed=seed + 14, cells=6, hue=0.0, sat=0.02)
    mortar_c = M.mul(mortar_c, 0.88 + N.fbm(n, 160, 3, seed + 15, min_res=512) * 0.18 + grain * 0.15)
    col = M.mix(col, mortar_c, mortar)
    col = M.mix(col, M.solid(n, C("#55514a")), missing * 0.55)
    salt = blotches(n, 3, seed + 16, threshold=0.64, softness=0.1, warp_amt=40) * N.smoothstep(0.3, 0.8, N.fbm(n, 120, 3, seed + 17, min_res=512) * 0.5 + 0.5)
    col = M.mix(col, M.solid(n, C("#c4bfb2")), salt * 0.7)
    soot = blotches(n, 2, seed + 18, threshold=0.58, softness=0.22, warp_amt=60)
    col = M.mul(col, 1.0 - soot * 0.4)
    moss = blotches(n, 12, seed + 19, threshold=0.68, softness=0.06) * mortar * soot
    col = M.mix(col, M.solid(n, C("#4f5a38")), moss * 0.7)
    stain = stain_down(np.clip(missing + chip * 0.5, 0, 1) * (rnd(seed + 20, n) < 0.05), decay=0.99, seed=seed + 21, strength=0.5)
    col = M.mix(col, M.solid(n, C("#45403b")), stain * 0.45)
    cav = M.cavity(m.height, 2.0)
    col = M.mul(col, 1.0 - cav * 0.3)
    m.albedo = col
    m.rough = 0.78 + mortar * 0.15 + salt * 0.1 + fine * 0.05 - over * 0.25 + chip * 0.05 + moss * 0.05 + grain * 0.06
    return m.finish()


def rock(n, seed=2200):
    """Glacial boulder / outcrop: large faceted forms, few long fractures, strata, lichen, wet crevices."""
    m = Mat(n, tile_m=2.0, height_m=0.15)
    facets, cid, edge_mask, f1 = stones(n, 4, seed, jitter=1.0, round_=0.15, gap=0.02, warp_amt=90)
    fvar = N.cell_random(cid, 4 * 4 + 6, seed + 1, k=2)
    big = N.fbm(n, 3, 6, seed + 2, min_res=256, gain=0.55)
    ridge = N.fbm(n, 6, 5, seed + 3, ridged=True, min_res=256)
    mid = N.fbm(n, 14, 5, seed + 4, min_res=512)
    fine = N.fbm(n, 90, 4, seed + 5, min_res=512)
    grain = rnd(seed + 6, n) - 0.5
    w1 = N.fbm(n, 3, 3, seed + 7, min_res=256)
    strata = 0.5 + 0.5 * np.sin((N.uv(n)[1] + w1 * 0.1 + big * 0.05) * 2 * np.pi * 5)
    strata = N.smoothstep(0.3, 0.75, strata)
    frac = crack_mask(n, crack_lines(n, 4, seed + 8, length=(0.4, 0.9), wander=0.03, kink_every=(30, 90), kink=(0.2, 0.6), branch_p=0.25, step=3.0), width=4.0, soft=1.2)
    frac2 = crack_mask(n, crack_lines(n, 8, seed + 9, length=(0.08, 0.3), wander=0.05, branch_p=0.2), width=1.8, soft=0.7)
    h = 0.45 + facets * 0.2 + (fvar[..., 0] - 0.5) * 0.12 + big * 0.25 + ridge * 0.12 + mid * 0.08 + fine * 0.03 + grain * 0.01
    h += strata * 0.02 - frac * 0.25 - frac2 * 0.08 - edge_mask * 0.05
    m.height = h
    base = tone(C("#6b6963"), n, variation=0.1, seed=seed + 10, cells=3, hue=0.02, sat=0.04)
    base = M.mul(base, 0.85 + fine * 0.18 + mid * 0.1 + grain * 0.12)
    base = M.mix(base, M.solid(n, C("#57554f")), strata * 0.3)
    base = M.mix(base, M.solid(n, C("#807e76")), N.smoothstep(0.55, 0.95, ridge) * 0.35)
    base = M.mix(base, M.solid(n, C("#5a5850")), (fvar[..., 1] - 0.5) * 0.6 + 0.3)
    mineral = N.smoothstep(0.7, 0.95, N.fbm(n, 200, 2, seed + 11) * 0.5 + 0.5)                # feldspar/quartz flecks
    base = M.mix(base, M.solid(n, C("#9a978f")), mineral * 0.5)
    base = M.mul(base, 1.0 - frac * 0.55 - frac2 * 0.3)
    lichen = blotches(n, 8, seed + 12, threshold=0.7, softness=0.04, warp_amt=25) * N.smoothstep(0.5, 0.7, facets + 0.3)
    lichen_c = M.mix(M.solid(n, C("#8e9270")), M.solid(n, C("#b0ad6c")), N.fbm(n, 40, 3, seed + 13) * 0.5 + 0.5)
    lichen_c = M.mix(lichen_c, M.solid(n, C("#c9c2a8")), N.smoothstep(0.6, 0.9, N.fbm(n, 120, 3, seed + 14) * 0.5 + 0.5) * 0.5)
    base = M.mix(base, lichen_c, lichen * 0.8)
    moss = blotches(n, 5, seed + 15, threshold=0.68, softness=0.08, warp_amt=30) * np.clip(M.cavity(h, 8.0) * 3, 0, 1)
    base = M.mix(base, M.solid(n, C("#45512d")), np.clip(moss, 0, 1) * 0.8)
    wet = np.clip(M.cavity(h, 5.0) * 2, 0, 1)
    base = M.mul(base, 1.0 - wet * 0.45)
    m.albedo = base
    m.rough = 0.8 + fine * 0.08 - wet * 0.35 + lichen * 0.12 - mineral * 0.1
    return m.finish()


def tiles(n, seed=2800):
    """Bathhouse ceramic tiles 150 mm: crazed glaze, chipped, missing tiles show screed, grout mould, tide marks."""
    m = Mat(n, tile_m=1.2, height_m=0.012)
    cols = 8
    bid, u, v, edged, grout, dxe, dye = running_bond(n, cols, cols, mortar=0.045, seed=seed, offset=0.0)
    tvar = N.cell_random(bid, cols * (cols + 1) + 8, seed + 1, k=5)
    fine = N.fbm(n, 120, 3, seed + 2, min_res=512)
    grain = rnd(seed + 3, n) - 0.5
    craze = crack_mask(n, crack_lines(n, 60, seed + 4, length=(0.02, 0.08), wander=0.15, kink_every=(4, 12), branch_p=0.5), width=1.0, soft=0.3)
    craze = craze * N.smoothstep(0.35, 0.6, tvar[..., 0])
    missing = N.smoothstep(0.91, 0.93, tvar[..., 1])
    chip = N.smoothstep(0.62, 0.85, N.fbm(n, 50, 4, seed + 5, min_res=512) * 0.5 + 0.5) * (1.0 - N.smoothstep(0.0, 0.18, edged)) * N.smoothstep(0.55, 0.8, tvar[..., 2])
    bevel = N.smoothstep(0.0, 0.05, edged)
    tilt = (tvar[..., 3] - 0.5) * 0.03                                   # tiles set slightly unevenly
    h = 0.9 * bevel + 0.72 * (1 - bevel) + fine * 0.006 + tilt - chip * 0.2 - craze * 0.02
    screed = 0.45 + N.fbm(n, 100, 4, seed + 6, min_res=512) * 0.07 + grain * 0.03 + speckle(n, 0.002, seed + 7, size=(1, 3)) * 0.06
    h = h * (1 - grout) + (0.7 + fine * 0.03 + grain * 0.02) * grout
    h = h * (1 - missing) + screed * missing
    m.height = h
    white = M.mix(M.solid(n, C("#cfd1c9")), M.solid(n, C("#b6bcb6")), tvar[..., 0])
    teal = M.mix(M.solid(n, C("#6d8987")), M.solid(n, C("#5f7a78")), tvar[..., 4])
    pattern = ((bid // (cols + 1)) % 4 == 0).astype(F32)
    col = M.mix(white, teal, pattern)
    col = M.mul(col, 1.0 + fine * 0.05 + grain * 0.03)
    col = M.mul(col, 1.0 - craze * 0.4)
    col = M.mix(col, M.solid(n, C("#b89b78")), chip * 0.85)
    grout_c = M.mul(M.solid(n, C("#8a877c")), 0.85 + N.fbm(n, 200, 2, seed + 8) * 0.2 + grain * 0.2)
    col = M.mix(col, grout_c, grout)
    mould = blotches(n, 6, seed + 9, threshold=0.58, softness=0.15, warp_amt=30) * np.maximum(grout, chip)
    col = M.mix(col, M.solid(n, C("#383b33")), mould * 0.75)
    grime = blotches(n, 3, seed + 10, threshold=0.55, softness=0.25, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#6b6960")), grime * 0.45)
    scum = stain_down(np.clip(grout * (rnd(seed + 11, n) < 0.02), 0, 1), decay=0.992, seed=seed + 12, strength=0.6)
    col = M.mix(col, M.solid(n, C("#8b8577")), scum * 0.5)
    screed_c = M.mul(M.solid(n, C("#6f6759")), 0.8 + N.fbm(n, 90, 3, seed + 13, min_res=512) * 0.3 + grain * 0.2)
    col = M.mix(col, screed_c, missing)
    m.albedo = col
    m.rough = 0.2 + grime * 0.4 + craze * 0.25 + chip * 0.5 + grout * 0.6 + missing * 0.65 + mould * 0.35 + scum * 0.3
    return m.finish()


# ============================================================== ground

def _grass_layer(n, count, seed, length, width, colors, direction_bias=0.0, curl=0.35):
    """Draw `count` grass blades as curved tapered strokes; returns (rgb sum, coverage, height)."""
    r = N.rng_for(seed)
    cv = Canvas(n, "F", 0.0)
    ch = Canvas(n, "F", 0.0)
    idx = Canvas(n, "F", 0.0)
    for i in range(count):
        x0, y0 = r.uniform(0, n, 2)
        ln = r.uniform(*length)
        a = r.uniform(0, 2 * np.pi) if direction_bias <= 0 else r.normal(-np.pi / 2, direction_bias)
        bend = r.uniform(-curl, curl)
        w = r.uniform(*width)
        k = 6
        pts = []
        for s in range(k + 1):
            t = s / k
            aa = a + bend * t * t * 3
            pts.append((x0 + np.cos(aa) * ln * t, y0 + np.sin(aa) * ln * t))
        ci = r.integers(len(colors))
        shade = r.uniform(0.7, 1.05)
        for s in range(k):
            ww = max(1, int(round(w * (1 - 0.7 * s / k))))
            cv.line(pts[s:s + 2], float(ci + 1), width=ww)
            ch.line(pts[s:s + 2], float(shade), width=ww)
            idx.line(pts[s:s + 2], float(0.3 + 0.7 * s / k), width=ww)
    ids = cv.array()
    shade = ch.array()
    tip = idx.array()
    cover = (ids > 0).astype(F32)
    rgb = np.zeros((n, n, 3), F32)
    for ci, col in enumerate(colors):
        rgb += (ids == ci + 1)[..., None] * np.asarray(col, F32)[None, None, :]
    rgb *= shade[..., None]
    return rgb, cover, tip


def grass(n, seed=1900):
    """Dead-yellow meadow grass seen from above: layered blade clusters, dead mats, soil and stones showing."""
    m = Mat(n, tile_m=2.0, height_m=0.05)
    # soil base
    soil = tone(C("#4a4234"), n, variation=0.1, seed=seed, cells=3, hue=0.01, sat=0.04)
    fine = N.fbm(n, 120, 4, seed + 1, min_res=512)
    soil = M.mul(soil, 0.85 + fine * 0.3 + (rnd(seed + 2, n) - 0.5) * 0.15)
    pebbles, pid, pedge, _ = stones(n, 160, seed + 3, jitter=1.0, round_=0.8, gap=0.25, warp_amt=2)
    pebble_keep = N.smoothstep(0.86, 0.9, N.cell_random(pid, 160 * 160, seed + 4))
    pebbles = pebbles * pebble_keep
    soil = M.mix(soil, M.solid(n, C("#8a867c")), N.smoothstep(0.2, 0.7, pebbles) * 0.8)
    # thatch (dead flattened grass mat) layer
    thatch_cols = [C("#7d7247"), C("#8c7f4d"), C("#6d6540"), C("#9a8d5a")]
    th_rgb, th_cov, th_tip = _grass_layer(n, 26000, seed + 5, length=(40, 110), width=(2, 5), colors=thatch_cols, curl=0.6)
    th_cov_s = N.blur(th_cov, 1.0)
    # live/dry standing blades: olive and straw
    blade_cols = [C("#8a8a4d"), C("#a49a5c"), C("#6b7040"), C("#b0a56a"), C("#5d6338"), C("#c2b678")]
    bl_rgb, bl_cov, bl_tip = _grass_layer(n, 30000, seed + 6, length=(50, 140), width=(2, 4), colors=blade_cols, curl=0.5)
    # dead patches: greyer, sparser; soil patches
    dead = blotches(n, 3, seed + 7, threshold=0.55, softness=0.2, warp_amt=60)
    bare = blotches(n, 4, seed + 8, threshold=0.72, softness=0.05, warp_amt=50)
    bare_keep = 1.0 - bare * N.smoothstep(0.3, 0.9, rnd(seed + 9, n) * 0.5 + fine * 0.5 + 0.25)
    bl_mask = bl_cov * bare_keep
    th_mask = th_cov * (1 - bare * 0.6)
    col = soil
    col = M.mix(col, th_rgb / np.maximum(th_cov, 1e-3)[..., None], th_mask)
    col = M.mix(col, bl_rgb / np.maximum(bl_cov, 1e-3)[..., None], bl_mask)
    col = M.mix(col, M.saturate(col, 0.6), dead * 0.6)
    # height: thatch 0.3, blades up to 1 with tips, soil 0.05 + pebbles
    h = 0.06 + fine * 0.04 + pebbles * 0.15
    h = np.maximum(h, 0.25 * th_mask + th_tip * 0.15 * th_mask)
    h = np.maximum(h, (0.45 + bl_tip * 0.5) * bl_mask)
    h = N.blur(h, 0.6)
    m.height = h
    # depth shading: lower layers darker (ambient occlusion in the blade mass)
    depth = 1.0 - N.blur(bl_mask, 6) * 0.25 - N.blur(th_mask, 6) * 0.15
    col = M.mul(col, depth + h * 0.25)
    col = M.mul(col, 0.9 + N.fbm(n, 4, 4, seed + 10, min_res=256) * 0.2)
    m.albedo = col
    m.rough = 0.85 + (1 - bl_mask) * 0.08 - pebbles * 0.1
    m.ao_strength = 0.6
    return m.finish()


def dirt(n, seed=2000):
    """Bare packed earth: clods, pebbles, twigs and roots, dry cracked spots, a trodden path smoothness."""
    m = Mat(n, tile_m=2.0, height_m=0.03)
    clods, cid, cedge, _ = stones(n, 40, seed, jitter=1.0, round_=0.6, gap=0.3, warp_amt=12)
    clod_keep = N.smoothstep(0.4, 0.7, N.cell_random(cid, 40 * 40, seed + 1))
    clods = clods * clod_keep
    lumps = N.fbm(n, 24, 5, seed + 2, min_res=512, billow=True)
    fine = N.fbm(n, 150, 4, seed + 3, min_res=512)
    grain = rnd(seed + 4, n) - 0.5
    pebbles, pid, pedge, _ = stones(n, 220, seed + 5, jitter=1.0, round_=0.85, gap=0.25, warp_amt=2)
    pebbles = pebbles * N.smoothstep(0.82, 0.86, N.cell_random(pid, 220 * 220, seed + 6))
    trodden = blotches(n, 2, seed + 7, threshold=0.5, softness=0.25, warp_amt=80)
    cracks, _, _ = polygon_cracks(n, 24, seed + 8, width=1.6, soft=0.6, warp_amt=10)
    dry = blotches(n, 4, seed + 9, threshold=0.66, softness=0.08, warp_amt=40)
    twigs = sprinkle_lines(n, 140, seed + 10, length=(20, 120), width=(1, 3), soft=0.5, curve=0.6)
    roots = sprinkle_lines(n, 30, seed + 11, length=(120, 400), width=(2, 5), soft=0.8, curve=0.8)
    h = 0.5 + clods * 0.2 * (1 - trodden * 0.7) + lumps * 0.12 + fine * 0.05 + grain * 0.02 + pebbles * 0.18
    h -= cracks * dry * 0.12
    h = np.maximum(h, 0.5 + twigs * 0.15 + roots * 0.2)
    m.height = h
    base = tone(C("#5b5142"), n, variation=0.1, seed=seed + 12, cells=3, hue=0.01, sat=0.05)
    base = M.mul(base, 0.85 + fine * 0.25 + grain * 0.18 + lumps * 0.1)
    base = M.mix(base, M.solid(n, C("#7a705f")), dry * 0.6)                          # dry pale crust
    base = M.mix(base, M.solid(n, C("#3d3630")), (1 - dry) * blotches(n, 6, seed + 13, threshold=0.55, softness=0.2) * 0.4)  # damp darker
    base = M.mix(base, M.solid(n, C("#8b877d")), N.smoothstep(0.3, 0.8, pebbles) * 0.75)
    base = M.mix(base, M.solid(n, C("#4a3f33")), twigs * 0.8)
    base = M.mix(base, M.solid(n, C("#5c4d3c")), roots * 0.8)
    base = M.mul(base, 1.0 - cracks * dry * 0.4)
    base = M.mix(base, M.solid(n, C("#6a6152")), trodden * 0.3)
    cav = M.cavity(h, 3.0)
    base = M.mul(base, 1.0 - cav * 0.4)
    m.albedo = base
    m.rough = 0.9 - trodden * 0.12 - (1 - dry) * 0.1 - pebbles * 0.1 + grain * 0.04
    return m.finish()


def mud(n, seed=1400):
    """Dried mud crust: curled polygon plates over wet dark lows, with debris. Roughness makes the lows glossy."""
    m = Mat(n, tile_m=2.0, height_m=0.045)
    cracks, f1, cid = polygon_cracks(n, 14, seed, width=5.0, soft=1.2, warp_amt=14)
    small, _, _ = polygon_cracks(n, 40, seed + 1, width=1.6, soft=0.6, warp_amt=8)
    plate = N.cell_random(cid, 14 * 14 + 8, seed + 2, k=2)
    # curl: plates rise toward their edges
    curl = N.smoothstep(0.0, 0.35, 1.0 - N.blur(cracks, 10) * 2)   # 1 inside plate, 0 near crack
    edge_rise = (1.0 - curl) * (1.0 - cracks)
    wet = blotches(n, 3, seed + 3, threshold=0.6, softness=0.12, warp_amt=60)    # low, wet areas without crust
    fine = N.fbm(n, 120, 4, seed + 4, min_res=512)
    grain = rnd(seed + 5, n) - 0.5
    lumps = N.fbm(n, 20, 5, seed + 6, min_res=512, billow=True)
    debris = sprinkle_lines(n, 200, seed + 7, length=(8, 60), width=(1, 3), soft=0.5, curve=0.5)
    pebbles, pid, _, _ = stones(n, 200, seed + 8, jitter=1.0, round_=0.85, gap=0.25, warp_amt=2)
    pebbles = pebbles * N.smoothstep(0.9, 0.93, N.cell_random(pid, 200 * 200, seed + 9))
    crust_h = 0.62 + edge_rise * 0.25 + (plate[..., 0] - 0.5) * 0.08 + fine * 0.03 + grain * 0.01 - cracks * 0.4 - small * 0.05
    wet_h = 0.3 + lumps * 0.12 + fine * 0.02
    h = crust_h * (1 - wet) + wet_h * wet
    h = np.maximum(h, (0.5 + debris * 0.3) * (debris > 0.2)) if False else h + debris * 0.12 + pebbles * 0.15
    m.height = h
    crust = tone(C("#6a6151"), n, variation=0.08, seed=seed + 10, cells=3, hue=0.01, sat=0.04)
    crust = M.mul(crust, 0.9 + fine * 0.2 + grain * 0.1 + (plate[..., 1] - 0.5) * 0.15)
    crust = M.mix(crust, M.solid(n, C("#8a8170")), N.smoothstep(0.5, 1.0, edge_rise) * 0.3)      # pale dried curled edges
    crust = M.mul(crust, 1.0 - cracks * 0.6 - small * 0.25)
    wetc = tone(C("#3a332b"), n, variation=0.1, seed=seed + 11, cells=4, hue=0.0, sat=0.03)
    wetc = M.mul(wetc, 0.9 + lumps * 0.2 + fine * 0.1)
    col = M.mix(crust, wetc, wet)
    col = M.mix(col, M.solid(n, C("#2e2a25")), N.blur(cracks, 3) * (1 - wet) * 0.5)
    col = M.mix(col, M.solid(n, C("#5c5344")), debris * 0.7)
    col = M.mix(col, M.solid(n, C("#807b72")), N.smoothstep(0.3, 0.8, pebbles) * 0.7)
    cav = M.cavity(h, 3.0)
    col = M.mul(col, 1.0 - cav * 0.35)
    m.albedo = col
    m.rough = (0.85 + fine * 0.05) * (1 - wet) + (0.2 + lumps * 0.15 + fine * 0.05) * wet
    m.rough += cracks * 0.05 - pebbles * 0.1
    return m.finish()


def gravel(n, seed=1500):
    """Packed crushed stone of mixed sizes with sand between, dust on top, a few larger cobbles."""
    m = Mat(n, tile_m=1.0, height_m=0.03)
    layers = []
    for cells, sd, rnd_, gap in ((28, 1, 0.7, 0.12), (52, 2, 0.75, 0.16), (100, 3, 0.8, 0.22)):
        hh, cid, edge, f1 = stones(n, cells, seed + sd, jitter=1.0, round_=rnd_, gap=gap, warp_amt=6)
        keep = N.smoothstep(0.35, 0.5, N.cell_random(cid, cells * cells, seed + sd + 10))
        size = 0.6 + 0.4 * N.cell_random(cid, cells * cells, seed + sd + 20)
        cv = N.cell_random(cid, cells * cells, seed + sd + 30, k=2)
        layers.append((hh * keep * size, cv, cid))
    sand = 0.25 + N.fbm(n, 90, 4, seed + 40, min_res=512) * 0.06 + (rnd(seed + 41, n) - 0.5) * 0.04
    h = sand.copy()
    col = tone(C("#7a7568"), n, variation=0.08, seed=seed + 42, cells=4, hue=0.01, sat=0.03)
    col = M.mul(col, 0.9 + N.fbm(n, 200, 3, seed + 43) * 0.2)
    fine = N.fbm(n, 300, 2, seed + 44)
    palette = [C("#8a877f"), C("#6e6b64"), C("#9b968a"), C("#5d5b56"), C("#857b70"), C("#736f6b")]
    for hh, cv, cid in layers:
        top = 0.3 + hh * 0.7
        mask = (top > h) & (hh > 0.02)
        h = np.where(mask, top, h)
        stone_c = M.solid(n, palette[0])
        for i, cc in enumerate(palette[1:]):
            stone_c = M.mix(stone_c, M.solid(n, cc), N.smoothstep(i * 0.2, i * 0.2 + 0.2, cv[..., 0]))
        stone_c = M.mul(stone_c, 0.8 + cv[..., 1] * 0.3 + fine * 0.15)
        # facet shading from the dome slope for crushed look
        col = M.mix(col, stone_c, mask.astype(F32))
    h = h + fine * 0.015
    m.height = h
    dust = blotches(n, 4, seed + 45, threshold=0.5, softness=0.25, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#8c877b")), dust * 0.35 * N.smoothstep(0.3, 0.6, h))
    damp = blotches(n, 3, seed + 46, threshold=0.65, softness=0.1, warp_amt=50)
    col = M.mul(col, 1.0 - damp * 0.35)
    cav = M.cavity(h, 3.0)
    col = M.mul(col, 1.0 - cav * 0.5)
    m.albedo = col
    m.rough = 0.82 + fine * 0.06 - damp * 0.25 + dust * 0.08
    return m.finish()


def sand(n, seed=2300):
    """River sand: fine grain, wind ripples, damp patches, a few pebbles and twigs."""
    m = Mat(n, tile_m=1.0, height_m=0.01)
    grain = rnd(seed, n) - 0.5
    fine = N.fbm(n, 200, 3, seed + 1)
    w = N.fbm(n, 3, 3, seed + 2, min_res=256)
    ripple = 0.5 + 0.5 * np.sin((N.uv(n)[1] + w * 0.06 + N.fbm(n, 12, 3, seed + 3, min_res=512) * 0.02) * 2 * np.pi * 9)
    ripple = ripple ** 1.6 * blotches(n, 2, seed + 4, threshold=0.45, softness=0.3, warp_amt=60)
    lumps = N.fbm(n, 10, 4, seed + 5, min_res=512)
    pebbles, pid, _, _ = stones(n, 180, seed + 6, jitter=1.0, round_=0.9, gap=0.25, warp_amt=2)
    pebbles = pebbles * N.smoothstep(0.93, 0.95, N.cell_random(pid, 180 * 180, seed + 7))
    h = 0.5 + ripple * 0.18 + lumps * 0.1 + fine * 0.04 + grain * 0.03 + pebbles * 0.2
    m.height = h
    col = tone(C("#9a9179"), n, variation=0.07, seed=seed + 8, cells=3, hue=0.01, sat=0.04)
    col = M.mul(col, 0.9 + fine * 0.15 + grain * 0.2)
    damp = blotches(n, 3, seed + 9, threshold=0.6, softness=0.12, warp_amt=50)
    col = M.mix(col, M.solid(n, C("#6f6753")), damp * 0.6)
    col = M.mix(col, M.solid(n, C("#807b70")), N.smoothstep(0.3, 0.8, pebbles) * 0.8)
    dark_grains = N.smoothstep(0.8, 0.95, rnd(seed + 10, n))
    col = M.mul(col, 1.0 - dark_grains * 0.3)
    m.albedo = col
    m.rough = 0.9 - damp * 0.3 + grain * 0.05
    return m.finish()


def moss(n, seed=2400):
    """Cushion moss: clumps with fine fuzz, brighter tips, dead brown parts, some bark/soil showing."""
    m = Mat(n, tile_m=1.0, height_m=0.03)
    clumps = N.fbm(n, 6, 4, seed, min_res=256, billow=True)
    bumps, cid, _, _ = stones(n, 36, seed + 1, jitter=1.0, round_=0.9, gap=0.3, warp_amt=10)
    fuzz = N.fbm(n, 250, 3, seed + 2)
    grain = rnd(seed + 3, n) - 0.5
    fine = N.worley(n, 400, seed + 4)[0]
    fine = 1.0 - N.smoothstep(0.2, 0.7, fine)
    h = 0.35 + clumps * 0.35 + bumps * 0.25 + fuzz * 0.08 + fine * 0.06 + grain * 0.02
    bare = blotches(n, 3, seed + 5, threshold=0.7, softness=0.06, warp_amt=50)
    h = h * (1 - bare) + (0.2 + N.fbm(n, 60, 3, seed + 6, min_res=512) * 0.05) * bare
    m.height = h
    col = M.mix(M.solid(n, C("#4d5a2f")), M.solid(n, C("#6f7d3a")), N.smoothstep(0.35, 0.85, h))
    col = M.mix(col, M.solid(n, C("#8f9a4c")), N.smoothstep(0.75, 0.95, h) * 0.6)
    col = M.mul(col, 0.85 + fuzz * 0.25 + grain * 0.15 + fine * 0.2)
    dead = blotches(n, 5, seed + 7, threshold=0.62, softness=0.12, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#6b5a3a")), dead * 0.55)
    col = M.mix(col, M.solid(n, C("#4a4238")), bare * 0.9)
    col = M.mul(col, 1.0 - M.cavity(h, 4.0) * 0.4)
    m.albedo = col
    m.rough = 0.92 - bare * 0.1
    m.ao_strength = 0.8
    return m.finish()


def road(n, seed=1600):
    """Full-width (6 m) country road tile: crumbling asphalt edges, wheel tracks, faded dashed centre line,
    cracks with tar seals, patches, potholes. u across the road, v along it."""
    m = Mat(n, tile_m=6.0, height_m=0.04)
    x, y = N.uv(n)
    grain = rnd(seed, n) - 0.5
    agg = N.worley(n, 500, seed + 1)[0]
    agg = 1.0 - N.smoothstep(0.15, 0.6, agg)
    fine = N.fbm(n, 200, 3, seed + 2)
    # edge crumble: asphalt mask across u
    edge_noise = N.fbm(n, 6, 5, seed + 3, min_res=256, cells_y=12) * 0.06
    asphalt = N.smoothstep(0.06, 0.1, x + edge_noise) * (1.0 - N.smoothstep(0.9, 0.94, x + edge_noise))
    shoulder = 1.0 - asphalt
    # wheel tracks: smoother, darker; ruts in the shoulder
    tracks = np.exp(-((x - 0.3) ** 2) / (2 * 0.045 ** 2)) + np.exp(-((x - 0.7) ** 2) / (2 * 0.045 ** 2))
    tracks = np.clip(tracks * (0.7 + 0.3 * N.fbm(n, 2, 3, seed + 4, min_res=256, cells_y=8)), 0, 1)
    # cracks: alligator polygons in fatigued zones + long longitudinal + transverse
    alli, _, _ = polygon_cracks(n, 30, seed + 5, width=2.0, soft=0.8, warp_amt=8)
    fatigue = blotches(n, 3, seed + 6, threshold=0.62, softness=0.1, warp_amt=60) * tracks
    alli = alli * N.smoothstep(0.2, 0.6, fatigue)
    longi = crack_mask(n, crack_lines(n, 4, seed + 7, length=(0.4, 1.0), wander=0.04, kink_every=(40, 120), kink=(0.15, 0.4), branch_p=0.2, direction=np.pi / 2, dir_spread=0.08), width=3.0, soft=0.8)
    trans = crack_mask(n, crack_lines(n, 5, seed + 8, length=(0.15, 0.6), wander=0.06, branch_p=0.3, direction=0.0, dir_spread=0.25), width=2.5, soft=0.8)
    cracks = np.clip(alli + longi + trans, 0, 1) * asphalt
    tar = N.smoothstep(0.05, 0.4, N.blur(np.clip(longi + trans, 0, 1), 4)) * N.smoothstep(0.4, 0.6, N.value_noise(n, 6, seed + 9)) * asphalt
    # patches: rectangular repairs
    r = N.rng_for(seed + 10)
    pc = Canvas(n, "F", 0.0)
    for i in range(3):
        px0 = r.uniform(0.15, 0.7) * n
        py0 = r.uniform(0, 1) * n
        pc.polygon([(px0, py0), (px0 + r.uniform(0.1, 0.25) * n, py0 + r.uniform(-8, 8)), (px0 + r.uniform(0.1, 0.25) * n, py0 + r.uniform(0.1, 0.3) * n), (px0 + r.uniform(-8, 8), py0 + r.uniform(0.1, 0.3) * n)], 1.0)
    patch = N.blur(pc.array(), 1.0) * asphalt
    patch_edge = np.clip((N.blur(patch, 4) - patch) * 3, 0, 1) + np.clip((patch - N.blur(patch, 4)) * 3, 0, 1)
    # potholes
    pot = np.zeros((n, n), F32)
    for i in range(2):
        cx, cy = r.uniform(0.2, 0.8) * n, r.uniform(0, 1) * n
        rx, ry = r.uniform(0.02, 0.05) * n, r.uniform(0.02, 0.05) * n
        dx = N.wrapped_delta(N.coords(n)[0], cx, n) / rx
        dy = N.wrapped_delta(N.coords(n)[1], cy, n) / ry
        d = np.sqrt(dx * dx + dy * dy) + N.fbm(n, 40, 3, seed + 11 + i, min_res=512) * 0.4
        pot = np.maximum(pot, 1.0 - N.smoothstep(0.7, 1.0, d))
    # centre line: dashed, faded, worn
    dash = (np.abs(x - 0.5) < 0.012) * ((y % 0.5) < 0.25)
    dash = dash.astype(F32) * N.smoothstep(0.35, 0.7, N.fbm(n, 30, 4, seed + 12, min_res=512) * 0.5 + 0.5) * (1 - tracks * 0.3)
    dash = N.blur(dash, 0.8)
    # heights
    h = 0.7 + fine * 0.03 + grain * 0.015 + agg * 0.03 - tracks * 0.05 - cracks * 0.2 + tar * 0.02 + patch * 0.03 - pot * 0.5
    grav, gid, _, _ = stones(n, 240, seed + 13, jitter=1.0, round_=0.8, gap=0.25, warp_amt=2)
    sh_h = 0.55 + N.fbm(n, 30, 4, seed + 14, min_res=512) * 0.1 + grav * 0.15 + grain * 0.02 - tracks * 0.1
    h = h * asphalt + sh_h * shoulder
    h = np.where(pot > 0.5, h + grav * 0.12, h)
    m.height = h
    # colour
    asp = tone(C("#4b4b4a"), n, variation=0.08, seed=seed + 15, cells=3, hue=0.0, sat=0.02)
    asp = M.mul(asp, 0.9 + fine * 0.2 + grain * 0.25 + agg * 0.3)
    asp = M.mix(asp, M.solid(n, C("#8d8a84")), N.smoothstep(0.5, 1.0, agg) * 0.3)         # exposed pale aggregate
    asp = M.mix(asp, M.solid(n, C("#3a3a3a")), tracks * 0.4)
    asp = M.mix(asp, M.solid(n, C("#2a2a2a")), np.clip(tar * 1.5, 0, 1) * 0.8)
    asp = M.mix(asp, M.solid(n, C("#333334")), patch * 0.7)
    asp = M.mul(asp, 1.0 - cracks * 0.55 - patch_edge * 0.2)
    asp = M.mix(asp, M.solid(n, C("#b8b4a6")), dash * 0.8)
    oil = blotches(n, 8, seed + 16, threshold=0.75, softness=0.05, warp_amt=20) * tracks
    asp = M.mix(asp, M.solid(n, C("#2b2b2c")), oil * 0.6)
    sh = tone(C("#6e6a5e"), n, variation=0.1, seed=seed + 17, cells=4, hue=0.01, sat=0.03)
    sh = M.mul(sh, 0.85 + grain * 0.3 + N.fbm(n, 150, 3, seed + 18) * 0.2)
    sh = M.mix(sh, M.solid(n, C("#8a867d")), N.smoothstep(0.2, 0.8, grav) * 0.7)
    sh = M.mix(sh, M.solid(n, C("#5f5a4c")), tracks * 0.4)
    col = M.mix(asp, sh, shoulder)
    col = M.mix(col, sh, pot * 0.8)
    dust = N.smoothstep(0.0, 0.25, shoulder) * (1 - shoulder) * 0.5
    col = M.mix(col, M.solid(n, C("#726d62")), dust)
    cav = M.cavity(h, 3.0)
    col = M.mul(col, 1.0 - cav * 0.4)
    m.albedo = col
    m.rough = (0.78 + fine * 0.06 - tracks * 0.12 - tar * 0.4 - oil * 0.3 + cracks * 0.1) * asphalt + (0.88 + grain * 0.04) * shoulder
    return m.finish()


def asphalt(n, seed=1700):
    """Generic aged asphalt: exposed aggregate, alligator and long cracks with tar seals, patches, oil, puddled lows."""
    m = Mat(n, tile_m=2.0, height_m=0.015)
    grain = rnd(seed, n) - 0.5
    agg = N.worley(n, 260, seed + 1)[0]
    agg = 1.0 - N.smoothstep(0.15, 0.6, agg)
    agg2 = 1.0 - N.smoothstep(0.1, 0.4, N.worley(n, 520, seed + 2)[0])
    fine = N.fbm(n, 200, 3, seed + 3)
    alli, _, _ = polygon_cracks(n, 22, seed + 4, width=2.0, soft=0.8, warp_amt=8)
    fatigue = blotches(n, 3, seed + 5, threshold=0.6, softness=0.08, warp_amt=60)
    alli = alli * N.smoothstep(0.2, 0.6, fatigue)
    longc = crack_mask(n, crack_lines(n, 5, seed + 6, length=(0.3, 0.9), wander=0.05, branch_p=0.3), width=3.0, soft=0.8)
    cracks = np.clip(alli + longc, 0, 1)
    tar = N.smoothstep(0.05, 0.4, N.blur(longc, 4)) * N.smoothstep(0.45, 0.6, N.value_noise(n, 5, seed + 7))
    patch = blotches(n, 2, seed + 8, threshold=0.7, softness=0.02, warp_amt=30)
    patch_edge = np.clip(np.abs(N.blur(patch, 3) - patch) * 3, 0, 1)
    wear = blotches(n, 3, seed + 9, threshold=0.5, softness=0.25, warp_amt=50)
    low = N.fbm(n, 4, 4, seed + 10, min_res=256)
    h = 0.6 + fine * 0.04 + grain * 0.02 + agg * 0.05 * (0.5 + wear) + agg2 * 0.02 + low * 0.08 - cracks * 0.3 + tar * 0.03 + patch * 0.04
    m.height = h
    col = tone(C("#494a49"), n, variation=0.08, seed=seed + 11, cells=3, hue=0.0, sat=0.02)
    col = M.mul(col, 0.9 + fine * 0.2 + grain * 0.3 + agg * 0.3 * wear)
    col = M.mix(col, M.solid(n, C("#8f8c86")), N.smoothstep(0.5, 1.0, agg) * wear * 0.4)
    col = M.mix(col, M.solid(n, C("#262626")), np.clip(tar * 1.5, 0, 1) * 0.8)
    col = M.mix(col, M.solid(n, C("#343435")), patch * 0.7)
    col = M.mul(col, 1.0 - cracks * 0.55 - patch_edge * 0.2)
    oil = blotches(n, 6, seed + 12, threshold=0.74, softness=0.05, warp_amt=20)
    col = M.mix(col, M.solid(n, C("#2a2a2b")), oil * 0.6)
    puddle = N.smoothstep(0.55, 0.75, -low * 0.5 + 0.5)
    col = M.mul(col, 1.0 - puddle * 0.35)
    dust = blotches(n, 4, seed + 13, threshold=0.6, softness=0.2, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#6d6a62")), dust * 0.3)
    cav = M.cavity(h, 3.0)
    col = M.mul(col, 1.0 - cav * 0.35)
    m.albedo = col
    m.rough = 0.78 + fine * 0.06 - tar * 0.45 - oil * 0.3 - puddle * 0.45 + cracks * 0.1 + dust * 0.08
    return m.finish()
