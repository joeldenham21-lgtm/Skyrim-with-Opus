"""Material recipes part 2: metals, wood, bark, soft goods, roofing, interior finishes, glass."""
import numpy as np
from . import noise as N
from . import maps as M
from .common import (Mat, speckle, blotches, crack_lines, crack_mask, polygon_cracks, stones, running_bond,
                     seams_grid, holes_grid, stain_down, grain_stripes, tone, rust_colour, sprinkle_lines)
from .draw import Canvas, stroke_field, font

F32 = np.float32
C = M.hexc


def rnd(seed, n):
    return N.rng_for(seed).random((n, n), dtype=F32)


# ============================================================== metals

def rust(n, seed=400):
    """Steel plate, old grey-green paint flaking over layered rust: blisters, scale, pits, streaks, bare metal."""
    m = Mat(n, tile_m=1.0, height_m=0.006)
    rc, pit = rust_colour(n, seed, dark=C("#2b1a12"), mid=C("#6a3a1f"), bright=C("#8c5a2c"))
    rc = M.mix(rc, M.solid(n, C("#4a2c1c")), N.fbm(n, 30, 4, seed + 1, min_res=512) * 0.5 + 0.5)
    scale, sid, sedge, _ = stones(n, 60, seed + 2, jitter=1.0, round_=0.2, gap=0.12, warp_amt=10)   # flaky scale plates
    scale_keep = N.smoothstep(0.55, 0.7, N.cell_random(sid, 60 * 60, seed + 3))
    scale = scale * scale_keep
    # paint mask: eroded from rust centres outward, with broken edges and isolated islands
    rustiness = blotches(n, 3, seed + 4, threshold=0.5, softness=0.18, warp_amt=60, octaves=7)
    micro = N.fbm(n, 60, 4, seed + 5, min_res=512) * 0.5 + 0.5
    paint = 1.0 - N.smoothstep(0.42, 0.52, rustiness * 0.7 + micro * 0.3)
    paint_edge = np.clip((N.blur(paint, 2.5) - paint) * 4, 0, 1)
    lifted = np.clip((paint - N.blur(paint, 6)) * 3, 0, 1) * paint          # curled paint edges
    blister = (1.0 - N.smoothstep(0.1, 0.35, N.worley(n, 90, seed + 6)[0])) * paint * N.smoothstep(0.35, 0.6, rustiness)
    grain = rnd(seed + 7, n) - 0.5
    fine = N.fbm(n, 150, 3, seed + 8)
    bare = blotches(n, 10, seed + 9, threshold=0.78, softness=0.03, warp_amt=15) * (1 - paint)      # scoured bare steel
    scratches = sprinkle_lines(n, 60, seed + 10, length=(30, 200), width=(1, 2), angle=0.3, spread=0.6, soft=0.4)
    h = 0.5 + fine * 0.03 + grain * 0.02 - pit * 0.2 + scale * 0.08 + N.fbm(n, 20, 4, seed + 11, min_res=512) * 0.06
    h = h * (1 - paint) + (0.7 + fine * 0.01 + grain * 0.005 + blister * 0.12 + lifted * 0.08) * paint
    h -= scratches * 0.05
    m.height = h
    paint_c = tone(C("#5e6a5c"), n, variation=0.08, seed=seed + 12, cells=3, hue=0.01, sat=0.05)
    paint_c = M.mul(paint_c, 0.95 + grain * 0.06)
    chalk = blotches(n, 4, seed + 13, threshold=0.5, softness=0.2, warp_amt=30)
    paint_c = M.mix(paint_c, M.solid(n, C("#8b948a")), chalk * 0.4)                              # chalked, faded paint
    paint_c = M.mix(paint_c, M.solid(n, C("#3e3a30")), blister * 0.5)
    col = M.mix(rc, paint_c, paint)
    col = M.mix(col, M.solid(n, C("#8a8f8f")), paint_edge * 0.35)                                # bright primer at edges
    col = M.mix(col, M.solid(n, C("#6f7274")), bare * 0.7)
    col = M.mix(col, M.solid(n, C("#a58a5c")), N.smoothstep(0.3, 0.8, scale) * (1 - paint) * 0.2)
    col = M.mix(col, M.solid(n, C("#7b7f80")), scratches * 0.6)
    drip_src = np.clip((1 - paint) * (rnd(seed + 14, n) < 0.02) + paint_edge * (rnd(seed + 15, n) < 0.1), 0, 1)
    drip = stain_down(drip_src, decay=0.99, seed=seed + 16, strength=0.9)
    col = M.mix(col, M.solid(n, C("#6b3c1e")), drip * 0.7)
    grime = N.fbm(n, 5, 4, seed + 17, min_res=256) * 0.5 + 0.5
    col = M.mul(col, 0.85 + grime * 0.25)
    col = M.mul(col, 1.0 - M.cavity(h, 2.0) * 0.35)
    m.albedo = col
    m.rough = (0.9 + pit * 0.08 - bare * 0.5 - scratches * 0.3) * (1 - paint) + (0.55 + chalk * 0.25 + blister * 0.1) * paint
    m.metal = np.clip(bare * 0.9 + scratches * 0.8 + (1 - paint) * 0.15, 0, 1) * (1 - paint * 0.9)
    return m.finish()


def painted_metal(n, seed=500):
    """Military grey-green oil paint on steel: orange peel, brush strokes, runs, chips with rust, scratches, wear."""
    m = Mat(n, tile_m=1.0, height_m=0.0025)
    peel = N.fbm(n, 400, 2, seed) * 0.5
    brush = N.fbm(n, 6, 4, seed + 1, cells_y=90, min_res=512)      # horizontal brush strokes
    grain = rnd(seed + 2, n) - 0.5
    runs = stain_down((rnd(seed + 3, n) < 0.0004).astype(F32) * blotches(n, 3, seed + 4, threshold=0.55, softness=0.2), decay=0.985, seed=seed + 5, strength=1.0)
    runs = N.smoothstep(0.1, 0.7, runs)
    chips = blotches(n, 24, seed + 6, threshold=0.8, softness=0.02, warp_amt=8)
    chips = np.maximum(chips, blotches(n, 6, seed + 7, threshold=0.84, softness=0.02, warp_amt=20))
    chip_edge = np.clip((N.blur(chips, 2) - chips) * 4, 0, 1)
    scratches = sprinkle_lines(n, 90, seed + 8, length=(20, 260), width=(1, 2), angle=0.2, spread=0.9, soft=0.4)
    wear = blotches(n, 3, seed + 9, threshold=0.6, softness=0.2, warp_amt=50)
    h = 0.7 + peel * 0.05 + brush * 0.03 + grain * 0.01 + runs * 0.08 - chips * 0.25 - scratches * 0.06
    m.height = h
    col = tone(C("#4d5747"), n, variation=0.06, seed=seed + 10, cells=3, hue=0.01, sat=0.05)
    col = M.mul(col, 1.0 + brush * 0.05 + grain * 0.05)
    fade = blotches(n, 2, seed + 11, threshold=0.5, softness=0.3, warp_amt=60)
    col = M.mix(col, M.solid(n, C("#76806f")), fade * 0.35)
    col = M.mix(col, M.solid(n, C("#3a3f35")), wear * 0.2)
    col = M.mul(col, 1.0 + runs * 0.06)
    rc, _ = rust_colour(n, seed + 12)
    col = M.mix(col, rc, chips * 0.9)
    col = M.mix(col, M.solid(n, C("#6d7473")), chip_edge * 0.3)
    col = M.mix(col, M.solid(n, C("#8a8f8f")), scratches * 0.7)
    rust_drip = stain_down(chips * (rnd(seed + 13, n) < 0.05), decay=0.985, seed=seed + 14, strength=0.6)
    col = M.mix(col, M.solid(n, C("#6a3c20")), rust_drip * 0.6)
    dirt = blotches(n, 5, seed + 15, threshold=0.6, softness=0.2, warp_amt=30)
    col = M.mul(col, 1.0 - dirt * 0.2)
    m.albedo = col
    m.rough = 0.5 + fade * 0.25 + dirt * 0.15 + chips * 0.4 - scratches * 0.2 - runs * 0.1
    m.metal = np.clip(scratches * 0.9 + chip_edge * 0.6, 0, 1)
    return m.finish()


def gunmetal(n, seed=600):
    """Parkerised / blued steel: brushed micro-grain, worn edges bright, oil smears, small scratches."""
    m = Mat(n, tile_m=0.5, height_m=0.0006)
    brushed = N.fbm(n, 8, 5, seed, cells_y=400, min_res=1024)
    grain = rnd(seed + 1, n) - 0.5
    wear = blotches(n, 3, seed + 2, threshold=0.62, softness=0.15, warp_amt=40)
    scratches = sprinkle_lines(n, 120, seed + 3, length=(10, 120), width=(1, 1), angle=0.0, spread=0.4, soft=0.3)
    oil = blotches(n, 4, seed + 4, threshold=0.55, softness=0.25, warp_amt=40)
    pits = 1.0 - N.smoothstep(0.05, 0.2, N.worley(n, 300, seed + 5)[0])
    pits = pits * blotches(n, 5, seed + 6, threshold=0.7, softness=0.05)
    h = 0.6 + brushed * 0.05 + grain * 0.01 - scratches * 0.06 - pits * 0.1
    m.height = h
    col = tone(C("#2b2d30"), n, variation=0.04, seed=seed + 7, cells=3, hue=0.0, sat=0.02)
    col = M.mul(col, 1.0 + brushed * 0.12 + grain * 0.08)
    col = M.mix(col, M.solid(n, C("#6d7075")), wear * 0.55)
    col = M.mix(col, M.solid(n, C("#8a8d90")), scratches * 0.7)
    col = M.mix(col, M.solid(n, C("#1e1f21")), pits * 0.6)
    col = M.mix(col, M.solid(n, C("#26272a")), oil * 0.3)
    m.albedo = col
    m.rough = 0.48 + brushed * 0.08 - wear * 0.2 - oil * 0.18 - scratches * 0.15 + pits * 0.3
    m.metal = np.full((n, n), 1.0, F32)
    return m.finish()


def sheet_metal(n, seed=2900):
    """Bare hot-rolled steel sheet: mill scale, dents, weld beads, surface rust bloom, grinding marks."""
    m = Mat(n, tile_m=1.0, height_m=0.008)
    grain = rnd(seed, n) - 0.5
    scale = blotches(n, 6, seed + 1, threshold=0.45, softness=0.2, warp_amt=40)
    scale_flake = blotches(n, 40, seed + 2, threshold=0.7, softness=0.04) * scale
    dents = N.fbm(n, 5, 3, seed + 3, min_res=256, billow=True)
    dent2 = 1.0 - N.smoothstep(0.2, 0.6, N.worley(n, 12, seed + 4)[0])
    dent2 = dent2 * N.smoothstep(0.6, 0.8, N.value_noise(n, 12, seed + 5))
    grind = sprinkle_lines(n, 40, seed + 6, length=(60, 300), width=(3, 8), angle=0.5, spread=0.2, soft=1.2)
    rustb = blotches(n, 4, seed + 7, threshold=0.66, softness=0.1, warp_amt=40, octaves=7)
    rc, pit = rust_colour(n, seed + 8)
    h = 0.6 - dents * 0.12 - dent2 * 0.15 + grain * 0.01 + scale * 0.01 - scale_flake * 0.02 - pit * rustb * 0.08
    m.height = h
    col = tone(C("#4d4f50"), n, variation=0.06, seed=seed + 9, cells=3, hue=0.0, sat=0.02)
    col = M.mul(col, 1.0 + grain * 0.1)
    col = M.mix(col, M.solid(n, C("#33353a")), scale * 0.7)
    col = M.mix(col, M.solid(n, C("#6b6e70")), scale_flake * 0.7)
    col = M.mix(col, M.solid(n, C("#8a8c8d")), grind * 0.5)
    col = M.mix(col, rc, rustb * 0.9)
    drip = stain_down(rustb * (rnd(seed + 10, n) < 0.01), decay=0.99, seed=seed + 11, strength=0.7)
    col = M.mix(col, M.solid(n, C("#5e3519")), drip * 0.6)
    col = M.mul(col, 1.0 - M.cavity(h, 3.0) * 0.3)
    m.albedo = col
    m.rough = 0.55 + scale * 0.2 + rustb * 0.35 - grind * 0.2 + grain * 0.05
    m.metal = np.clip(1.0 - rustb * 0.9 - scale * 0.3, 0, 1)
    return m.finish()


def roof_metal(n, seed=1800):
    """Corrugated galvanised roofing: sinusoidal profile, spangle, rust in troughs and from screws, paint remnants."""
    m = Mat(n, tile_m=2.0, height_m=0.03)
    x, y = N.uv(n)
    waves = 26
    prof = 0.5 + 0.5 * np.sin(x * 2 * np.pi * waves)
    prof = prof ** 0.9
    sheet_step = N.smoothstep(0.0, 0.01, (y % 0.5)) * 0.06          # horizontal sheet overlap every 1 m
    grain = rnd(seed, n) - 0.5
    spangle, sid, sedge, _ = stones(n, 30, seed + 1, jitter=1.0, round_=0.0, gap=0.03, warp_amt=6)
    sp = N.cell_random(sid, 30 * 30, seed + 2)
    trough = 1.0 - prof
    rustiness = blotches(n, 3, seed + 3, threshold=0.55, softness=0.15, warp_amt=60, octaves=7)
    rust_m = N.smoothstep(0.3, 0.7, rustiness * 0.6 + trough * 0.5 + (N.fbm(n, 40, 4, seed + 4, min_res=512) * 0.5 + 0.5) * 0.3 - 0.35)
    rust_m = np.clip(rust_m + N.smoothstep(0.985, 1.0, (y % 0.5) / 0.5) * 0.6, 0, 1)   # sheet bottom edges rust
    rc, pit = rust_colour(n, seed + 5)
    # screws on crests along the overlap lines
    screws, ring = holes_grid(n, waves // 2, 2, radius_px=n * 0.004, seed=seed + 6, ox=0.25 / (waves // 2) * waves / 2 if False else 0.25, oy=0.02, profile="flat")
    screw_rust = stain_down(screws * (rnd(seed + 7, n) < 0.3), decay=0.985, seed=seed + 8, strength=0.9)
    paint = blotches(n, 2, seed + 9, threshold=0.6, softness=0.06, warp_amt=60) * (1 - rust_m)
    dents = N.fbm(n, 6, 3, seed + 10, min_res=256, billow=True)
    h = 0.15 + prof * 0.7 - sheet_step + grain * 0.005 - pit * rust_m * 0.05 - dents * 0.05 + screws * 0.15
    m.height = h
    galv = tone(C("#8a8f90"), n, variation=0.05, seed=seed + 11, cells=3, hue=0.0, sat=0.02)
    galv = M.mul(galv, 0.9 + sp * 0.2 + grain * 0.06)
    galv = M.mix(galv, M.solid(n, C("#6c7172")), N.smoothstep(0.4, 0.8, N.fbm(n, 10, 4, seed + 12, min_res=256) * 0.5 + 0.5) * 0.5)   # dulled zinc
    col = M.mix(galv, rc, rust_m)
    col = M.mix(col, M.solid(n, C("#6a4a33")), N.blur(rust_m, 8) * (1 - rust_m) * 0.3)   # rust halo
    col = M.mix(col, M.solid(n, C("#6b3a1f")), screw_rust * 0.7)
    paint_c = M.mix(M.solid(n, C("#7a4634")), M.solid(n, C("#8f5a45")), N.fbm(n, 20, 3, seed + 13, min_res=512) * 0.5 + 0.5)  # old surik red-brown paint
    col = M.mix(col, paint_c, paint * 0.85)
    dirt = N.smoothstep(0.3, 0.9, trough) * blotches(n, 4, seed + 14, threshold=0.5, softness=0.2, warp_amt=40)
    col = M.mul(col, 1.0 - dirt * 0.3)
    col = M.mul(col, 1.0 - M.cavity(h, 3.0) * 0.2)
    m.albedo = col
    m.rough = 0.45 + rust_m * 0.45 + dirt * 0.2 + paint * 0.2 - sp * 0.1
    m.metal = np.clip(1.0 - rust_m * 0.9 - paint * 0.9 - dirt * 0.3, 0, 1)
    return m.finish()


def roof_tile(n, seed=1750):
    """Soviet 'shifer' asbestos-cement corrugated sheets: 6-wave profile, overlaps, moss and lichen, cracks."""
    m = Mat(n, tile_m=2.0, height_m=0.05)
    x, y = N.uv(n)
    waves = 12
    prof = 0.5 + 0.5 * np.sin(x * 2 * np.pi * waves)
    overlap_y = N.smoothstep(0.0, 0.006, (y % 0.5)) * 0.1           # sheets overlap every 1 m
    overlap_x = N.smoothstep(0.0, 0.004, ((x + 0.5 / waves) % 0.5)) * 0.05   # side overlap of one wave every 1 m
    grain = rnd(seed, n) - 0.5
    fine = N.fbm(n, 120, 3, seed + 1, min_res=512)
    fibre = N.fbm(n, 4, 3, seed + 2, cells_y=300, min_res=1024) * 0.5    # asbestos fibre streaks along the sheet
    cracks = crack_mask(n, crack_lines(n, 5, seed + 3, length=(0.1, 0.4), wander=0.06, branch_p=0.2, direction=np.pi / 2, dir_spread=0.3), width=2.0, soft=0.6)
    broken = blotches(n, 6, seed + 4, threshold=0.84, softness=0.02, warp_amt=20) * N.smoothstep(0.96, 1.0, (y % 0.5) / 0.5 + 0.02)
    moss = blotches(n, 4, seed + 5, threshold=0.6, softness=0.1, warp_amt=40) * N.smoothstep(0.2, 0.8, 1 - prof)   # moss in troughs
    lichen = blotches(n, 14, seed + 6, threshold=0.72, softness=0.04, warp_amt=15)
    streaks = stain_down((rnd(seed + 7, n) < 0.0008).astype(F32) * (1 - prof), decay=0.997, seed=seed + 8, strength=0.9)
    nails, ring = holes_grid(n, waves // 2, 2, radius_px=n * 0.004, seed=seed + 9, ox=0.25, oy=0.03, profile="flat")
    nail_rust = stain_down(nails * (rnd(seed + 10, n) < 0.3), decay=0.988, seed=seed + 11, strength=0.8)
    h = 0.15 + prof * 0.7 - overlap_y - overlap_x + fine * 0.01 + grain * 0.004 - cracks * 0.1 - broken * 0.5 + moss * 0.06 + nails * 0.08
    m.height = h
    col = tone(C("#7c7e78"), n, variation=0.07, seed=seed + 12, cells=3, hue=0.0, sat=0.02)
    col = M.mul(col, 0.95 + fine * 0.12 + grain * 0.1 + fibre * 0.08)
    age = blotches(n, 2, seed + 13, threshold=0.5, softness=0.3, warp_amt=60)
    col = M.mix(col, M.solid(n, C("#5f625d")), age * 0.5)
    col = M.mix(col, M.solid(n, C("#4e5a3a")), moss * 0.75)
    col = M.mix(col, M.solid(n, C("#a9a888")), lichen * 0.6)
    col = M.mix(col, M.solid(n, C("#3d3f3b")), streaks * 0.5)
    col = M.mul(col, 1.0 - cracks * 0.5)
    col = M.mix(col, M.solid(n, C("#5a5b57")), broken * 0.8)
    col = M.mix(col, M.solid(n, C("#66391f")), nail_rust * 0.7)
    col = M.mul(col, 1.0 - M.cavity(h, 3.0) * 0.25)
    m.albedo = col
    m.rough = 0.85 + moss * 0.1 + lichen * 0.05 - streaks * 0.1 + grain * 0.04
    return m.finish()


def roof_slate(n, seed=1760):
    """Slate-like flat roofing shingles (Soviet 'plosky shifer' cut into overlapping rows), mossy."""
    m = Mat(n, tile_m=2.0, height_m=0.02)
    cols, rows = 6, 8
    bid, u, v, edged, gap, dxe, dye = running_bond(n, cols, rows, mortar=0.02, seed=seed)
    svar = N.cell_random(bid, rows * (cols + 1) + 8, seed + 1, k=3)
    step = N.smoothstep(0.0, 0.03, v) * 0.15
    grain = rnd(seed + 2, n) - 0.5
    fine = N.fbm(n, 100, 4, seed + 3, min_res=512)
    chip = N.smoothstep(0.7, 0.9, N.fbm(n, 60, 4, seed + 4, min_res=512) * 0.5 + 0.5) * (1.0 - N.smoothstep(0.0, 0.1, edged)) * N.smoothstep(0.5, 0.8, svar[..., 2])
    h = 0.6 + step + (svar[..., 0] - 0.5) * 0.05 + fine * 0.02 + grain * 0.01 - chip * 0.2 - gap * 0.2
    m.height = h
    col = M.mix(M.solid(n, C("#5e6164")), M.solid(n, C("#4a4d52")), svar[..., 1])
    col = M.mul(col, 0.9 + fine * 0.15 + grain * 0.15)
    moss = blotches(n, 5, seed + 5, threshold=0.62, softness=0.1, warp_amt=40) * N.smoothstep(0.0, 0.2, v)
    col = M.mix(col, M.solid(n, C("#4a5836")), moss * 0.7)
    lichen = blotches(n, 16, seed + 6, threshold=0.74, softness=0.04)
    col = M.mix(col, M.solid(n, C("#a3a48c")), lichen * 0.5)
    col = M.mix(col, M.solid(n, C("#7a7c7e")), chip * 0.6)
    col = M.mul(col, 1.0 - gap * 0.6 - M.cavity(h, 3.0) * 0.3)
    m.albedo = col
    m.rough = 0.7 + moss * 0.2 + lichen * 0.1 + grain * 0.05
    return m.finish()


# ============================================================== wood and bark

def _plank_layout(n, planks, seed, min_len=0.35, max_len=0.9, vertical=True):
    """Staggered plank layout along the tile. Returns (plank_id, local u across, v along, end_dist px, gap mask)."""
    r = N.rng_for(seed)
    x, y = N.coords(n)
    if not vertical:
        x, y = y, x
    pw = n / planks
    col = np.floor(x / pw).astype(np.int32)
    u = x / pw - col
    # each column: a random set of joints along y (periodic): choose joint offset and lengths that sum to n
    pid = np.zeros((n, n), np.int32)
    v = np.zeros((n, n), F32)
    end_d = np.full((n, n), 1e9, F32)
    base = 0
    for cidx in range(planks):
        joints = []
        pos = r.uniform(0, n)
        total = 0.0
        while total < n:
            ln = r.uniform(min_len, max_len) * n
            joints.append((pos % n, ln))
            pos += ln
            total += ln
        colmask = col == cidx
        yy = y[colmask]
        pidc = np.zeros_like(yy, np.int32)
        vc = np.zeros_like(yy, F32)
        endc = np.full_like(yy, 1e9, F32)
        for j, (start, ln) in enumerate(joints):
            d = (yy - start) % n
            inside = d < ln
            pidc = np.where(inside, base + j, pidc)
            vc = np.where(inside, d / ln, vc)
            endc = np.where(inside, np.minimum(d, ln - d), endc)
        pid[colmask] = pidc
        v[colmask] = vc
        end_d[colmask] = endc
        base += len(joints) + 1
    gap_w = pw * 0.05
    dxe = np.minimum(u, 1 - u) * pw
    gap = 1.0 - N.smoothstep(gap_w * 0.5, gap_w * 0.5 + 1.5, np.minimum(dxe, end_d))
    if not vertical:
        pid, u, v, end_d, gap = pid.T, u.T, v.T, end_d.T, gap.T
    return pid, u.astype(F32), v.astype(F32), end_d.astype(F32), gap.astype(F32), base + 2


def wood(n, seed=700):
    """Weathered unpainted board wall: staggered planks, warped grain, knots, silvered surface, splits, nails."""
    m = Mat(n, tile_m=2.0, height_m=0.012)
    planks = 14
    pid, u, v, end_d, gap, count = _plank_layout(n, planks, seed)
    pv = N.cell_random(pid, count, seed + 1, k=4)
    x, y = N.uv(n)
    # grain: stripes along y warped by per-plank low-frequency noise; frequency per plank
    w = N.fbm(n, 3, 4, seed + 2, min_res=256, cells_y=6)
    w2 = N.fbm(n, 24, 3, seed + 3, min_res=512)
    freq = 26 + pv[..., 0] * 30
    phase = (u + w * 0.35 + w2 * 0.05 + pv[..., 1] * 3.0) * freq
    ring = 0.5 + 0.5 * np.sin(phase * 2 * np.pi)
    ring = N.smoothstep(0.25, 0.8, ring) * 0.7 + ring * 0.3           # latewood bands narrower and sharper
    fibre = N.fbm(n, 3, 3, seed + 4, cells_y=400, min_res=1024) * 0.5   # fine fibre streaks along the plank
    # knots
    r = N.rng_for(seed + 5)
    knot = np.zeros((n, n), F32)
    knot_ring = np.zeros((n, n), F32)
    xx, yy = N.coords(n)
    for i in range(18):
        cx, cy = r.uniform(0, n, 2)
        rx = r.uniform(8, 22)
        ry = rx * r.uniform(1.2, 2.2)
        dx = N.wrapped_delta(xx, cx, n) / rx
        dy = N.wrapped_delta(yy, cy, n) / ry
        d = np.sqrt(dx * dx + dy * dy)
        knot = np.maximum(knot, 1.0 - N.smoothstep(0.7, 1.0, d))
        knot_ring = np.maximum(knot_ring, (1.0 - N.smoothstep(1.0, 2.8, d)) * (0.5 + 0.5 * np.sin(d * 9.0)))
    ring = np.clip(ring + knot_ring * 0.4, 0, 1)
    # weathering: silvering, raised grain, checks/splits along grain near ends
    silver = blotches(n, 3, seed + 6, threshold=0.42, softness=0.2, warp_amt=50)
    silver = np.clip(silver + pv[..., 2] * 0.4 - 0.2, 0, 1)
    splits = crack_mask(n, crack_lines(n, 12, seed + 7, length=(0.06, 0.3), wander=0.02, kink_every=(20, 60), kink=(0.05, 0.2), branch_p=0.15, direction=np.pi / 2, dir_spread=0.04), width=1.8, soft=0.4)
    splits = splits * (1 - gap)
    grain = rnd(seed + 8, n) - 0.5
    # nails: two per plank end, rust halo and streak
    nail_pos = (end_d < n / planks * 0.35) & (end_d > n / planks * 0.25) & (np.abs(u - 0.25) < 0.02) | ((end_d < n / planks * 0.35) & (end_d > n / planks * 0.25) & (np.abs(u - 0.75) < 0.02))
    nails = N.blur(nail_pos.astype(F32), 1.0)
    nails = N.smoothstep(0.2, 0.6, nails)
    nail_rust = stain_down(nails * (rnd(seed + 9, n) < 0.25), decay=0.985, seed=seed + 10, strength=0.8)
    cup = (0.5 - np.abs(u - 0.5)) * 2.0                                # boards cup: edges slightly lower
    h = 0.6 + (pv[..., 3] - 0.5) * 0.15 + cup * 0.05 + ring * 0.04 * (0.6 + silver * 0.8) + fibre * 0.02 + grain * 0.01 + knot * 0.03
    h -= gap * 0.5 + splits * 0.15 + nails * 0.05
    m.height = h
    # colour
    fresh = M.mix(M.solid(n, C("#7a6248")), M.solid(n, C("#5a4634")), ring)
    fresh = M.hsv_shift(fresh, dh=(pv[..., 1] - 0.5) * 0.02, ds=(pv[..., 2] - 0.5) * 0.1, dv=(pv[..., 3] - 0.5) * 0.12)
    grey = M.mix(M.solid(n, C("#8b8b84")), M.solid(n, C("#66665f")), ring)
    col = M.mix(fresh, grey, silver)
    col = M.mul(col, 1.0 + fibre * 0.12 + grain * 0.12)
    col = M.mix(col, M.solid(n, C("#3a2e22")), knot * 0.7)
    col = M.mul(col, 1.0 - splits * 0.5 - gap * 0.7)
    col = M.mix(col, M.solid(n, C("#3d3a36")), nails * 0.8)
    col = M.mix(col, M.solid(n, C("#5e3b22")), nail_rust * 0.6)
    mould = blotches(n, 6, seed + 11, threshold=0.66, softness=0.1, warp_amt=30)
    col = M.mix(col, M.solid(n, C("#3f423a")), mould * 0.4)
    stain = stain_down((rnd(seed + 12, n) < 0.0005).astype(F32), decay=0.995, seed=seed + 13, strength=0.7)
    col = M.mix(col, M.solid(n, C("#45423c")), stain * 0.4)
    col = M.mul(col, 1.0 - M.cavity(h, 2.0) * 0.3)
    m.albedo = col
    m.rough = 0.72 + silver * 0.2 + ring * 0.05 + mould * 0.05 + gap * 0.1 - knot * 0.1 + grain * 0.05
    return m.finish()


def _bark_pine(n, seed):
    """Pine bark field: plates elongated vertically, deep fissures, flaky sub-plates. Returns (h, fissure, plate rnd)."""
    plates, cid, edge, f1 = stones(n, 7, seed, jitter=1.0, aniso=2.6, round_=0.25, gap=0.06, warp_amt=30)
    pv = N.cell_random(cid, 7 * 7 * 4, seed + 1, k=3)
    sub, sid, sedge, _ = stones(n, 22, seed + 2, jitter=1.0, aniso=1.8, round_=0.2, gap=0.08, warp_amt=12)
    sv = N.cell_random(sid, 22 * 22 * 3, seed + 3)
    fissure = 1.0 - N.smoothstep(0.0, 0.5, plates)
    h = 0.35 + plates * 0.45 + (pv[..., 0] - 0.5) * 0.15 + sub * 0.12 * (1 - fissure) + (sv - 0.5) * 0.05
    return h, fissure, pv, sub


def pine_bark(n, seed=1000):
    m = Mat(n, tile_m=1.0, height_m=0.03)
    h, fissure, pv, sub = _bark_pine(n, seed)
    fine = N.fbm(n, 120, 3, seed + 4, min_res=512)
    grain = rnd(seed + 5, n) - 0.5
    flake = N.fbm(n, 40, 4, seed + 6, min_res=512, cells_y=10)      # horizontal papery flakes on plates
    h = h + fine * 0.03 + grain * 0.01 + flake * 0.02
    m.height = h
    col = M.mix(M.solid(n, C("#5b4b3e")), M.solid(n, C("#6f5a48")), pv[..., 1])
    col = M.mix(col, M.solid(n, C("#8a6a4d")), N.smoothstep(0.6, 1.0, sub) * 0.35)      # inner plates warmer
    col = M.mix(col, M.solid(n, C("#2e241d")), fissure * 0.85)
    col = M.mul(col, 0.85 + fine * 0.2 + grain * 0.15 + flake * 0.15)
    grey = blotches(n, 4, seed + 7, threshold=0.55, softness=0.2, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#6f6b64")), grey * 0.5)                      # weathered grey outer scales
    lichen = blotches(n, 10, seed + 8, threshold=0.7, softness=0.05, warp_amt=20) * (1 - fissure)
    col = M.mix(col, M.solid(n, C("#9ea27e")), lichen * 0.6)
    col = M.mul(col, 1.0 - M.cavity(h, 3.0) * 0.4)
    m.albedo = col
    m.rough = 0.9 - fissure * 0.05 + grain * 0.04
    return m.finish()


def birch_bark(n, seed=900):
    """Birch trunk: chalky white with horizontal lenticels, black diamond scars, peeling curls, dark base patches."""
    m = Mat(n, tile_m=1.0, height_m=0.006)
    x, y = N.uv(n)
    grain = rnd(seed, n) - 0.5
    fine = N.fbm(n, 6, 4, seed + 1, cells_y=200, min_res=1024)      # horizontal fine texture
    # lenticels: horizontal dashes
    r = N.rng_for(seed + 2)
    lc = Canvas(n, "F", 0.0)
    for i in range(900):
        cx, cy = r.uniform(0, n, 2)
        ln = r.uniform(0.01, 0.07) * n
        w = r.uniform(1.2, 3.5)
        lc.line([(cx - ln / 2, cy), (cx + ln / 2, cy + r.uniform(-1.5, 1.5))], float(r.uniform(0.4, 1.0)), width=int(w))
    lent = N.blur(lc.array(), 0.6)
    # black scars: diamonds where branches were and rough dark plates
    sc = Canvas(n, "F", 0.0)
    for i in range(7):
        cx, cy = r.uniform(0, n, 2)
        hw = r.uniform(0.03, 0.09) * n
        hh = r.uniform(0.04, 0.12) * n
        pts = [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]
        sc.polygon(pts, 1.0)
    scars = N.blur(sc.array(), 2.0)
    scars = N.smoothstep(0.3, 0.7, scars + N.fbm(n, 40, 3, seed + 3, min_res=512) * 0.3)
    dark_patch = blotches(n, 3, seed + 4, threshold=0.7, softness=0.05, warp_amt=40, octaves=7)
    dark = np.clip(scars + dark_patch, 0, 1)
    rough_dark = N.fbm(n, 60, 4, seed + 5, min_res=512) * dark      # rough furrowed texture inside dark areas
    # peeling: horizontal bands of lifted bark with curled edge (height step, shadow line)
    band = N.fbm(n, 2, 3, seed + 6, cells_y=40, min_res=512)
    peel = N.smoothstep(0.35, 0.42, band * 0.5 + 0.5) * (1 - N.smoothstep(0.55, 0.62, band * 0.5 + 0.5))
    peel = peel * blotches(n, 3, seed + 7, threshold=0.5, softness=0.15, warp_amt=40)
    peel_edge = np.clip((peel - N.blur(peel, 4)) * 3, 0, 1)
    # horizontal grey banding (older bark greyer)
    bands = N.fbm(n, 1, 4, seed + 8, cells_y=12, min_res=512) * 0.5 + 0.5
    h = 0.65 + fine * 0.03 + grain * 0.01 - lent * 0.05 - dark * 0.12 + rough_dark * 0.1 + peel * 0.08 - peel_edge * 0.03
    m.height = h
    col = tone(C("#d6d2c7"), n, variation=0.04, seed=seed + 9, cells=3, hue=0.0, sat=0.02)
    col = M.mul(col, 0.95 + fine * 0.08 + grain * 0.05)
    col = M.mix(col, M.solid(n, C("#a9a79c")), bands * 0.4)
    col = M.mix(col, M.solid(n, C("#3a3532")), lent * 0.8)
    col = M.mix(col, M.solid(n, C("#242220")), dark * 0.9)
    col = M.mix(col, M.solid(n, C("#4b4744")), rough_dark * 0.4)
    col = M.mix(col, M.solid(n, C("#c9b9a5")), peel * 0.35)                   # underside of curls: pinkish tan
    col = M.mix(col, M.solid(n, C("#6d6660")), peel_edge * 0.5)
    green = blotches(n, 4, seed + 10, threshold=0.68, softness=0.08, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#8c9679")), green * 0.35)                   # algae on the north side
    col = M.mul(col, 1.0 - M.cavity(h, 2.0) * 0.25)
    m.albedo = col
    m.rough = 0.62 + dark * 0.3 + lent * 0.15 + green * 0.1 + grain * 0.04
    return m.finish()


def logs(n, seed=800):
    """Izba wall: horizontal round log courses, checking cracks, axe-hewn grey surface, moss chinking."""
    m = Mat(n, tile_m=2.0, height_m=0.08)
    courses = 8
    x, y = N.uv(n)
    r = N.rng_for(seed)
    # per-course radius variation along x (periodic)
    row = np.floor(y * courses).astype(np.int32)
    t = (y * courses - row) - 0.5
    rad_var = N.fbm(n, 2, 2, seed + 1, cells_y=courses, min_res=256) * 0.08
    rr = 0.5 + rad_var
    t2 = np.clip(np.abs(t) / np.maximum(rr, 0.3), 0, 1)
    prof = np.sqrt(np.clip(1.0 - t2 * t2, 0, 1))
    chink = 1.0 - N.smoothstep(0.1, 0.3, prof)
    rv = N.cell_random(row % courses, courses + 2, seed + 2, k=3)
    # bark remnants on some logs, axe-hewn facets, checking cracks along the log
    grain = rnd(seed + 3, n) - 0.5
    fibre = N.fbm(n, 300, 3, seed + 4, cells_y=4, min_res=1024) * 0.5   # fibres along x
    ringw = N.fbm(n, 6, 3, seed + 5, cells_y=60, min_res=512)
    rings = 0.5 + 0.5 * np.sin((y * courses + ringw * 0.2) * 2 * np.pi * 9)
    checks = crack_mask(n, crack_lines(n, 14, seed + 6, length=(0.1, 0.5), wander=0.02, kink_every=(30, 80), kink=(0.05, 0.2), branch_p=0.1, direction=0.0, dir_spread=0.03), width=2.6, soft=0.5)
    checks = checks * N.smoothstep(0.3, 0.7, prof)
    hew = N.fbm(n, 20, 3, seed + 7, cells_y=6, min_res=512, billow=True)
    bark = blotches(n, 3, seed + 8, threshold=0.7, softness=0.05, warp_amt=40, cells=3) * N.smoothstep(0.5, 0.7, rv[..., 0])
    bark_h, fissure, pv, sub = _bark_pine(n, seed + 9)
    h = prof * 0.8 + 0.1 + hew * 0.04 + fibre * 0.02 + grain * 0.01 + rings * 0.008 - checks * 0.2
    h = h * (1 - bark) + (prof * 0.8 + 0.1 + bark_h * 0.1) * bark
    chink_h = 0.12 + N.fbm(n, 80, 4, seed + 10, min_res=512) * 0.06 + grain * 0.02
    h = h * (1 - chink) + chink_h * chink
    m.height = h
    col = M.mix(M.solid(n, C("#6f665a")), M.solid(n, C("#5a5248")), rv[..., 1])
    col = M.mix(col, M.solid(n, C("#8a8177")), N.smoothstep(0.6, 0.9, rv[..., 2]) * 0.5)
    col = M.mul(col, 0.9 + fibre * 0.2 + grain * 0.15 + rings * 0.08 + hew * 0.1)
    silver = blotches(n, 3, seed + 11, threshold=0.45, softness=0.2, warp_amt=50)
    col = M.mix(col, M.solid(n, C("#8b8b85")), silver * 0.45)
    warm = blotches(n, 4, seed + 12, threshold=0.66, softness=0.1, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#7a5f45")), warm * 0.35)                                # sheltered wood still brown
    col = M.mul(col, 1.0 - checks * 0.6)
    barkc = M.mix(M.solid(n, C("#5b4b3e")), M.solid(n, C("#3a2f27")), fissure)
    col = M.mix(col, barkc, bark)
    moss_c = M.mix(M.solid(n, C("#5a6238")), M.solid(n, C("#8a8462")), N.fbm(n, 60, 3, seed + 13, min_res=512) * 0.5 + 0.5)
    col = M.mix(col, moss_c, chink)
    lower_dark = N.smoothstep(0.4, 0.95, t + 0.5) * (1 - chink)           # underside of each log in shadow/damp
    col = M.mul(col, 1.0 - lower_dark * 0.3)
    stain = stain_down(checks * (rnd(seed + 14, n) < 0.02), decay=0.99, seed=seed + 15, strength=0.5)
    col = M.mix(col, M.solid(n, C("#3e3a34")), stain * 0.4)
    col = M.mul(col, 1.0 - M.cavity(h, 3.0) * 0.35)
    m.albedo = col
    m.rough = 0.8 + silver * 0.1 + chink * 0.12 + bark * 0.1 + grain * 0.04
    return m.finish()


# ============================================================== soft goods

def _weave(n, seed, threads, irregular=0.3, yarn=1.0):
    """Plain weave field: returns (height 0..1, warp-over mask)."""
    x, y = N.uv(n)
    jit = N.fbm(n, 30, 3, seed, min_res=512) * irregular
    tx = x * threads + jit * 0.5
    ty = y * threads + jit * 0.5
    wx = 0.5 + 0.5 * np.cos(tx * 2 * np.pi)
    wy = 0.5 + 0.5 * np.cos(ty * 2 * np.pi)
    ix = np.floor(tx).astype(np.int32)
    iy = np.floor(ty).astype(np.int32)
    over = ((ix + iy) % 2).astype(F32)
    hgt = over * (wy ** yarn) * (0.6 + 0.4 * wx) + (1 - over) * (wx ** yarn) * (0.6 + 0.4 * wy)
    return hgt.astype(F32), over


def fabric(n, seed=1100):
    """Heavy khaki canvas: plain weave with yarn irregularity, worn nap, fading, dirt, stitched seam."""
    m = Mat(n, tile_m=0.5, height_m=0.0015)
    weave, over = _weave(n, seed, 180, irregular=0.4, yarn=1.4)
    grain = rnd(seed + 1, n) - 0.5
    slub = N.smoothstep(0.7, 0.9, N.fbm(n, 6, 3, seed + 2, cells_y=180, min_res=1024) * 0.5 + 0.5)   # thick yarn slubs
    wear = blotches(n, 3, seed + 3, threshold=0.55, softness=0.2, warp_amt=40)
    fold = N.fbm(n, 3, 3, seed + 4, min_res=256)
    h = 0.4 + weave * 0.4 + slub * 0.1 + grain * 0.02 + fold * 0.1
    m.height = h
    col = tone(C("#5c5b47"), n, variation=0.05, seed=seed + 5, cells=3, hue=0.01, sat=0.04)
    col = M.mul(col, 0.9 + weave * 0.2 + grain * 0.12)
    col = M.mix(col, M.solid(n, C("#8a866c")), wear * 0.4)
    col = M.mix(col, M.solid(n, C("#6f6d58")), slub * 0.4)
    dirt = blotches(n, 4, seed + 6, threshold=0.62, softness=0.15, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#3d3b30")), dirt * 0.45)
    m.albedo = col
    m.rough = 0.92 - wear * 0.08 + dirt * 0.05
    return m.finish()


def canvas(n, seed=1150):
    """Coarse tent canvas / sacking: open weave, water stains, mildew spots."""
    m = Mat(n, tile_m=0.5, height_m=0.002)
    weave, over = _weave(n, seed, 110, irregular=0.5, yarn=1.2)
    grain = rnd(seed + 1, n) - 0.5
    fold = N.fbm(n, 3, 3, seed + 2, min_res=256)
    h = 0.35 + weave * 0.5 + grain * 0.02 + fold * 0.1
    m.height = h
    col = tone(C("#8a8268"), n, variation=0.06, seed=seed + 3, cells=3, hue=0.01, sat=0.04)
    col = M.mul(col, 0.9 + weave * 0.25 + grain * 0.1)
    tide = blotches(n, 3, seed + 4, threshold=0.62, softness=0.08, warp_amt=50)
    rim = np.clip((N.blur(tide, 8) - tide) * 3, 0, 1)
    col = M.mix(col, M.solid(n, C("#6e6650")), tide * 0.45)
    col = M.mix(col, M.solid(n, C("#5a5340")), rim * 0.5)
    mildew = blotches(n, 30, seed + 5, threshold=0.78, softness=0.03)
    col = M.mix(col, M.solid(n, C("#3b3d35")), mildew * 0.6)
    m.albedo = col
    m.rough = 0.95 - tide * 0.05
    return m.finish()


def leather(n, seed=1200):
    """Worn brown leather: pebble grain, creases, polished high spots, cracked dry areas."""
    m = Mat(n, tile_m=0.5, height_m=0.0012)
    pebble, pid, pedge, _ = stones(n, 160, seed, jitter=1.0, round_=0.7, gap=0.25, warp_amt=3)
    pv = N.cell_random(pid, 160 * 160, seed + 1)
    creases = crack_mask(n, crack_lines(n, 30, seed + 2, length=(0.1, 0.5), wander=0.04, kink_every=(20, 60), kink=(0.1, 0.4), branch_p=0.2), width=2.5, soft=1.2)
    fine = N.fbm(n, 200, 3, seed + 3)
    grain = rnd(seed + 4, n) - 0.5
    wear = blotches(n, 3, seed + 5, threshold=0.55, softness=0.2, warp_amt=40)
    dry = blotches(n, 4, seed + 6, threshold=0.68, softness=0.06, warp_amt=30)
    crackle, _, _ = polygon_cracks(n, 60, seed + 7, width=1.2, soft=0.4, warp_amt=4)
    h = 0.5 + pebble * 0.25 + (pv - 0.5) * 0.05 + fine * 0.05 + grain * 0.01 - creases * 0.3 - crackle * dry * 0.12
    m.height = h
    col = tone(C("#3f2c1e"), n, variation=0.08, seed=seed + 8, cells=3, hue=0.01, sat=0.05)
    col = M.mul(col, 0.9 + fine * 0.15 + grain * 0.1 + pebble * 0.1)
    col = M.mix(col, M.solid(n, C("#6a4c34")), wear * 0.5)
    col = M.mix(col, M.solid(n, C("#2a1d14")), creases * 0.7)
    col = M.mix(col, M.solid(n, C("#8a705a")), crackle * dry * 0.5)
    col = M.mul(col, 1.0 - M.cavity(h, 2.0) * 0.3)
    m.albedo = col
    m.rough = 0.55 + dry * 0.3 - wear * 0.2 + creases * 0.1 + grain * 0.04
    return m.finish()


def rubber(n, seed=1300):
    """Matte black rubber: fine grain, mould flash lines, grey scuffs, embedded grit."""
    m = Mat(n, tile_m=0.5, height_m=0.001)
    grain = rnd(seed, n) - 0.5
    fine = N.fbm(n, 300, 2, seed + 1)
    bumps = 1.0 - N.smoothstep(0.2, 0.6, N.worley(n, 250, seed + 2)[0])
    scuffs = sprinkle_lines(n, 80, seed + 3, length=(30, 200), width=(2, 6), angle=0.4, spread=0.5, soft=1.5)
    x, y = N.uv(n)
    flash = 1.0 - N.smoothstep(0.0, 0.004, np.abs(((x + 0.25) % 0.5) - 0.25))
    grit = N.smoothstep(0.97, 0.99, rnd(seed + 4, n))
    h = 0.5 + fine * 0.1 + grain * 0.04 + bumps * 0.15 + flash * 0.1 - scuffs * 0.05 + grit * 0.1
    m.height = h
    col = tone(C("#1f1f1e"), n, variation=0.04, seed=seed + 5, cells=3, hue=0.0, sat=0.0)
    col = M.mul(col, 1.0 + grain * 0.15 + fine * 0.1)
    col = M.mix(col, M.solid(n, C("#5a5a57")), scuffs * 0.5)
    col = M.mix(col, M.solid(n, C("#7a7568")), grit * 0.5)
    dust = blotches(n, 3, seed + 6, threshold=0.6, softness=0.2, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#4a4843")), dust * 0.3)
    m.albedo = col
    m.rough = 0.82 + dust * 0.1 - scuffs * 0.1 + grain * 0.05
    return m.finish()


def tarp(n, seed=2500):
    """Old army tarpaulin: coated canvas weave, creases and folds, faded olive, water tide marks, patch."""
    m = Mat(n, tile_m=1.0, height_m=0.01)
    weave, over = _weave(n, seed, 300, irregular=0.3, yarn=1.0)
    folds = N.fbm(n, 3, 5, seed + 1, min_res=256, ridged=True)
    creases = crack_mask(n, crack_lines(n, 10, seed + 2, length=(0.3, 0.9), wander=0.02, kink_every=(40, 120), kink=(0.1, 0.5), branch_p=0.2), width=6.0, soft=3.0)
    grain = rnd(seed + 3, n) - 0.5
    h = 0.35 + folds * 0.35 + creases * 0.15 + weave * 0.05 + grain * 0.01
    m.height = h
    col = tone(C("#4c5340"), n, variation=0.06, seed=seed + 4, cells=3, hue=0.01, sat=0.05)
    col = M.mul(col, 0.92 + weave * 0.1 + grain * 0.08)
    fade = blotches(n, 2, seed + 5, threshold=0.5, softness=0.3, warp_amt=60)
    col = M.mix(col, M.solid(n, C("#7c7f68")), fade * 0.4)
    col = M.mul(col, 1.0 + creases * 0.15)       # crease lines catch light / wear
    tide = blotches(n, 3, seed + 6, threshold=0.64, softness=0.06, warp_amt=50)
    rim = np.clip((N.blur(tide, 10) - tide) * 3, 0, 1)
    col = M.mix(col, M.solid(n, C("#3d4235")), tide * 0.4)
    col = M.mix(col, M.solid(n, C("#8a8a70")), rim * 0.4)
    r = N.rng_for(seed + 7)
    pc = Canvas(n, "F", 0.0)
    px0, py0 = r.uniform(0.2, 0.7, 2) * n
    pc.polygon([(px0, py0), (px0 + 0.18 * n, py0 + 6), (px0 + 0.17 * n, py0 + 0.14 * n), (px0 - 4, py0 + 0.15 * n)], 1.0)
    patch = pc.array()
    col = M.mix(col, M.solid(n, C("#5a5a48")), patch * 0.8)
    stitch = np.clip(N.blur(patch, 3) - patch, 0, 1) * 6 * (0.5 + 0.5 * np.sin(N.uv(n)[0] * 2 * np.pi * 300))
    col = M.mix(col, M.solid(n, C("#b0aa90")), np.clip(stitch, 0, 1) * 0.6)
    m.albedo = col
    m.rough = 0.78 + fade * 0.12 + tide * 0.05 - creases * 0.05
    return m.finish()


def paper(n, seed=2600):
    """Aged document paper: fibre, yellowing, foxing, folds, water tide marks, a torn corner's shadow."""
    m = Mat(n, tile_m=0.5, height_m=0.0006)
    grain = rnd(seed, n) - 0.5
    fibre = N.fbm(n, 400, 2, seed + 1)
    x, y = N.uv(n)
    folds = (1.0 - N.smoothstep(0.0, 0.003, np.abs(x - 0.5))) + (1.0 - N.smoothstep(0.0, 0.003, np.abs(y - 0.5)))
    folds = np.clip(folds, 0, 1)
    wrinkle = N.fbm(n, 6, 4, seed + 2, min_res=256, ridged=True)
    h = 0.55 + fibre * 0.08 + grain * 0.04 + wrinkle * 0.15 - folds * 0.2
    m.height = h
    col = tone(C("#cfc5ab"), n, variation=0.05, seed=seed + 3, cells=2, hue=0.01, sat=0.04)
    col = M.mul(col, 0.95 + grain * 0.06 + fibre * 0.06)
    yellow = blotches(n, 2, seed + 4, threshold=0.45, softness=0.3, warp_amt=60)
    col = M.mix(col, M.solid(n, C("#b5a47a")), yellow * 0.5)
    fox = speckle(n, 0.0006, seed + 5, size=(2, 9), soft=1.5)
    col = M.mix(col, M.solid(n, C("#8a6a48")), np.clip(fox * 1.5, 0, 1) * 0.5)
    tide = blotches(n, 3, seed + 6, threshold=0.62, softness=0.06, warp_amt=50)
    rim = np.clip((N.blur(tide, 6) - tide) * 4, 0, 1)
    col = M.mix(col, M.solid(n, C("#b3a683")), tide * 0.4)
    col = M.mix(col, M.solid(n, C("#8c7d5c")), rim * 0.5)
    col = M.mul(col, 1.0 - folds * 0.15)
    m.albedo = col
    m.rough = 0.88 + grain * 0.04
    return m.finish()


# ============================================================== interior finishes and glass

def wallpaper(n, seed=3000):
    """Soviet flat wallpaper: faded floral repeat, seams, peeling strips showing newspaper/plaster, damp."""
    m = Mat(n, tile_m=1.06, height_m=0.004)
    x, y = N.uv(n)
    r = N.rng_for(seed)
    # pattern: a damask-like repeat 6x6 of lozenges and small flowers drawn with shapes
    pc = Canvas(n, "F", 0.0)
    rep = 6
    cell = n / rep
    for i in range(rep):
        for j in range(rep):
            cx = (i + 0.5) * cell + ((j % 2) * cell * 0.5)
            cy = (j + 0.5) * cell
            for k in range(5):
                a = k * 2 * np.pi / 5
                pc.ellipse(cx + np.cos(a) * cell * 0.13, cy + np.sin(a) * cell * 0.13, cell * 0.08, cell * 0.06, 1.0)
            pc.ellipse(cx, cy, cell * 0.05, cell * 0.05, 0.6)
            for k in range(4):
                a = k * np.pi / 2 + np.pi / 4
                x0 = cx + np.cos(a) * cell * 0.34
                y0 = cy + np.sin(a) * cell * 0.34
                pc.line([(x0, y0), (cx + np.cos(a) * cell * 0.5, cy + np.sin(a) * cell * 0.5)], 0.7, width=int(max(1, cell * 0.012)))
                pc.ellipse(x0, y0, cell * 0.03, cell * 0.03, 0.8)
    pattern = N.blur(pc.array(), 1.2)
    fade = blotches(n, 2, seed + 1, threshold=0.45, softness=0.3, warp_amt=60)
    grain = rnd(seed + 2, n) - 0.5
    seams = 1.0 - N.smoothstep(0.0, 0.002, np.abs(((x + 0.25) % 0.5) - 0.25))
    peel = blotches(n, 3, seed + 3, threshold=0.72, softness=0.02, warp_amt=50)
    peel_edge = np.clip((N.blur(peel, 4) - peel) * 4, 0, 1)
    damp = blotches(n, 3, seed + 4, threshold=0.62, softness=0.1, warp_amt=50)
    rim = np.clip((N.blur(damp, 12) - damp) * 3, 0, 1)
    bubbles = blotches(n, 10, seed + 5, threshold=0.7, softness=0.06) * (1 - peel)
    h = 0.7 + pattern * 0.02 + grain * 0.01 + bubbles * 0.08 - seams * 0.05 + peel_edge * 0.06
    h = h * (1 - peel) + (0.55 + N.fbm(n, 80, 3, seed + 6, min_res=512) * 0.05) * peel
    m.height = h
    ground = tone(C("#a99f8a"), n, variation=0.04, seed=seed + 7, cells=2, hue=0.0, sat=0.03)
    ground = M.mul(ground, 0.97 + grain * 0.06)
    ink = M.mix(M.solid(n, C("#6f7a6a")), M.solid(n, C("#8a6f6a")), N.smoothstep(0.4, 0.6, (np.floor(y * rep) % 2)))
    col = M.mix(ground, ink, pattern * (0.8 - fade * 0.5))
    col = M.mix(col, M.solid(n, C("#c4bba6")), fade * 0.3)
    col = M.mix(col, M.solid(n, C("#6a6156")), damp * 0.45)
    col = M.mix(col, M.solid(n, C("#8c7f66")), rim * 0.4)
    under = M.mul(M.solid(n, C("#bdb49d")), 0.9 + N.fbm(n, 100, 3, seed + 8, min_res=512) * 0.2)    # newspaper/plaster beneath
    lines = 0.5 + 0.5 * np.sin(y * 2 * np.pi * 220)
    under = M.mul(under, 1.0 - N.smoothstep(0.6, 0.9, lines) * 0.25 * N.smoothstep(0.4, 0.6, N.value_noise(n, 12, seed + 9)))
    col = M.mix(col, under, peel)
    col = M.mix(col, M.solid(n, C("#d5cdb7")), peel_edge * (1 - peel) * 0.5)
    col = M.mul(col, 1.0 - seams * 0.25)
    mould = blotches(n, 30, seed + 10, threshold=0.76, softness=0.04) * damp
    col = M.mix(col, M.solid(n, C("#3a3d35")), mould * 0.6)
    m.albedo = col
    m.rough = 0.85 - fade * 0.05 + damp * 0.05 + peel * 0.05
    return m.finish()


def linoleum(n, seed=3100):
    """Worn brown-red linoleum floor: marbled pattern, scuffs, worn traffic lane, torn holes to floorboards."""
    m = Mat(n, tile_m=1.0, height_m=0.004)
    x, y = N.uv(n)
    grain = rnd(seed, n) - 0.5
    marble = N.fbm(n, 5, 6, seed + 1, min_res=256)
    marble = N.warp(marble, N.fbm(n, 4, 3, seed + 2, min_res=256) * 60, N.fbm(n, 4, 3, seed + 3, min_res=256) * 60)
    veins = N.smoothstep(0.45, 0.5, marble * 0.5 + 0.5) * (1 - N.smoothstep(0.5, 0.55, marble * 0.5 + 0.5))
    scuffs = sprinkle_lines(n, 200, seed + 4, length=(20, 200), width=(1, 4), soft=0.8, curve=0.3)
    wear = blotches(n, 2, seed + 5, threshold=0.5, softness=0.3, warp_amt=60)
    holes = blotches(n, 4, seed + 6, threshold=0.8, softness=0.02, warp_amt=30)
    hole_edge = np.clip((N.blur(holes, 4) - holes) * 4, 0, 1)
    seam = 1.0 - N.smoothstep(0.0, 0.003, np.abs(x - 0.5))
    bubbles = N.fbm(n, 8, 3, seed + 7, min_res=256, billow=True)
    h = 0.75 + bubbles * 0.05 + grain * 0.005 - scuffs * 0.02 - seam * 0.08 + hole_edge * 0.05
    boards = 0.4 + N.fbm(n, 3, 3, seed + 8, cells_y=200, min_res=1024) * 0.05 + grain * 0.02
    h = h * (1 - holes) + boards * holes
    m.height = h
    col = tone(C("#6b3f34"), n, variation=0.06, seed=seed + 9, cells=3, hue=0.01, sat=0.06)
    col = M.mul(col, 0.92 + marble * 0.15 + grain * 0.08)
    col = M.mix(col, M.solid(n, C("#8c5a4a")), veins * 0.6)
    col = M.mix(col, M.solid(n, C("#8a7360")), wear * 0.45)
    col = M.mix(col, M.solid(n, C("#a89a86")), scuffs * 0.5)
    dirt = blotches(n, 4, seed + 10, threshold=0.6, softness=0.15, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#3f342d")), dirt * 0.4)
    board_c = M.mul(M.solid(n, C("#6b5a45")), 0.85 + N.fbm(n, 3, 3, seed + 11, cells_y=200, min_res=1024) * 0.3)
    col = M.mix(col, board_c, holes)
    col = M.mix(col, M.solid(n, C("#2f2622")), hole_edge * (1 - holes) * 0.6)
    col = M.mul(col, 1.0 - seam * 0.4)
    m.albedo = col
    m.rough = 0.45 + wear * 0.2 + dirt * 0.25 + scuffs * 0.2 + holes * 0.4
    return m.finish()


def glass(n, seed=2700):
    """Dirty window glass: dust film, wiped arcs, drip trails, fingerprints, dried water spots.
    Albedo is the grime colour; the height channel doubles as grime opacity (white = dirty) for alpha use."""
    m = Mat(n, tile_m=1.0, height_m=0.0002)
    grain = rnd(seed, n) - 0.5
    dust = N.fbm(n, 4, 5, seed + 1, min_res=256) * 0.5 + 0.5
    dust = np.clip(dust * 0.8 + 0.1 + grain * 0.06, 0, 1)
    r = N.rng_for(seed + 2)
    wc = Canvas(n, "F", 0.0)
    for i in range(6):
        cx, cy = r.uniform(0, n, 2)
        rad = r.uniform(0.15, 0.4) * n
        a0 = r.uniform(0, 2 * np.pi)
        pts = [(cx + np.cos(a) * rad, cy + np.sin(a) * rad) for a in np.linspace(a0, a0 + r.uniform(0.6, 1.8), 30)]
        wc.line(pts, 1.0, width=int(r.uniform(30, 90)))
    wiped = N.blur(wc.array(), 6)
    drips = stain_down((rnd(seed + 3, n) < 0.0006).astype(F32), decay=0.996, seed=seed + 4, strength=1.0)
    drips = N.smoothstep(0.05, 0.8, drips)
    spots = speckle(n, 0.0008, seed + 5, size=(2, 7), soft=1.0)
    spots = np.clip(spots - N.blur(spots, 2) * 0.5, 0, 1) * 2
    prints = blotches(n, 12, seed + 6, threshold=0.78, softness=0.03, warp_amt=10)
    grime = np.clip(dust * (1 - wiped * 0.7) - drips * 0.5 + spots * 0.5 + prints * 0.4, 0, 1)
    edge_dirt = N.smoothstep(0.35, 0.5, np.maximum(np.abs(N.uv(n)[0] - 0.5), np.abs(N.uv(n)[1] - 0.5)))
    grime = np.clip(grime + edge_dirt * 0.5, 0, 1)
    m.height = grime
    col = M.mix(M.solid(n, C("#7c8284")), M.solid(n, C("#a9a79b")), grime)
    col = M.mix(col, M.solid(n, C("#8f8b7c")), spots * 0.5)
    m.albedo = col
    m.rough = 0.04 + grime * 0.6 + spots * 0.2
    m.normal_strength = 1.5
    return m.finish()


def camo(n, seed=3200):
    """Soviet KLMK/'berezka' style camouflage fabric: two-tone digital birch leaf pattern on ripstop weave."""
    m = Mat(n, tile_m=0.5, height_m=0.0015)
    weave, over = _weave(n, seed, 200, irregular=0.3, yarn=1.2)
    x, y = N.uv(n)
    rip = (1.0 - N.smoothstep(0.0, 0.004, np.abs(((x + 0.05) % 0.1) - 0.05))) + (1.0 - N.smoothstep(0.0, 0.004, np.abs(((y + 0.05) % 0.1) - 0.05)))
    rip = np.clip(rip, 0, 1)
    grain = rnd(seed + 1, n) - 0.5
    blocks = N.value_noise(n, 48, seed + 2)
    shape = blotches(n, 5, seed + 3, threshold=0.52, softness=0.02, warp_amt=30)
    pattern = N.smoothstep(0.45, 0.55, np.round(blocks * 3) / 3 * 0.5 + shape * 0.5)
    h = 0.4 + weave * 0.4 + rip * 0.1 + grain * 0.02
    m.height = h
    a = tone(C("#6a7a55"), n, variation=0.04, seed=seed + 4, cells=3)
    b = M.solid(n, C("#b8b48e"))
    col = M.mix(a, b, pattern)
    col = M.mul(col, 0.9 + weave * 0.15 + grain * 0.1)
    fade = blotches(n, 2, seed + 5, threshold=0.5, softness=0.3, warp_amt=60)
    col = M.mix(col, M.saturate(col, 0.5), fade * 0.5)
    dirt = blotches(n, 4, seed + 6, threshold=0.65, softness=0.15, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#3f3d30")), dirt * 0.4)
    m.albedo = col
    m.rough = 0.9
    return m.finish()


def bone(n, seed=3300):
    """Bone surface: porous cortical texture, cracks, dirt in pores, weathered grey-yellow."""
    m = Mat(n, tile_m=0.3, height_m=0.002)
    grain = rnd(seed, n) - 0.5
    pores = 1.0 - N.smoothstep(0.1, 0.35, N.worley(n, 260, seed + 1)[0])
    pores = pores * blotches(n, 4, seed + 2, threshold=0.5, softness=0.2, warp_amt=30)
    fibre = N.fbm(n, 4, 4, seed + 3, cells_y=120, min_res=1024)
    cracks = crack_mask(n, crack_lines(n, 10, seed + 4, length=(0.1, 0.5), wander=0.04, branch_p=0.2, direction=np.pi / 2, dir_spread=0.3), width=1.5, soft=0.5)
    h = 0.6 + fibre * 0.05 + grain * 0.01 - pores * 0.15 - cracks * 0.12
    m.height = h
    col = tone(C("#c9bfa4"), n, variation=0.06, seed=seed + 5, cells=3, hue=0.01, sat=0.04)
    col = M.mul(col, 0.95 + fibre * 0.08 + grain * 0.06)
    col = M.mix(col, M.solid(n, C("#6e6250")), pores * 0.6)
    col = M.mul(col, 1.0 - cracks * 0.5)
    stain = blotches(n, 3, seed + 6, threshold=0.6, softness=0.15, warp_amt=40)
    col = M.mix(col, M.solid(n, C("#8a7c5c")), stain * 0.4)
    m.albedo = col
    m.rough = 0.6 + pores * 0.3 + stain * 0.15
    return m.finish()
