#!/usr/bin/env python3
"""RADIUS terrain generator (offline, deterministic).

Builds the Pechorsk zone heightfield and its data maps from data/map.json into assets/terrain/ (Contracts v1):
  height.f32   (N+1)^2 float32 little-endian, row-major, z-major then x, metres
  splat.png    RGBA8: R grass, G dirt/mud, B rock, A gravel/road
  splat2.png   RGBA8: R sand, G moss, B wet, A snow (0)
  flora.png    RGBA8: R tree density, G bush density, B grass density, A clutter density
  water.png    RGBA8: R water mask, G flow-x, B flow-z (0.5 = still, +-2 m/s), A depth / 16 m
  terrain.json metadata
plus extras used by terrain.gd / water.gd and offered to other agents:
  roads.png    RGBA8: R asphalt share of the road layer, G mud share of the dirt layer, B rail ballast, A concrete
  biome.png    RGBA8: R pine, G birch, B reeds, A farmland
  water.f32    (N+1)^2 float32 water surface height (NaN where no water); exact levels for the water mesh
  far.f32      257^2 float32 at 16 m covering +-2048 m (horizon terrain beyond the map)
  preview.png  hillshade + splat colour preview (look at it)

Pipeline: macro shape (control blobs + warped fBm) -> escarpment -> river valley (channel, banks, floodplain,
terraces) and dry ravine -> marsh / lake / crater basins -> hydraulic (particle) + thermal erosion -> man-made
stamps (POI plateaus, roads with crown and ditches, rail with embankment and cutting, dam and spillway, quarry
benches and ramp, peat cuttings, drainage ditches) -> water surfaces -> splat / flora / biome maps.
Run: python3 tools/gen_terrain.py  (about 1-2 minutes; re-runnable, same output for the same seed/version).
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, distance_transform_edt, binary_dilation, map_coordinates, uniform_filter, maximum_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terragen.noise import perlin, fbm, ridged, warp, worley, smoothstep, lerp, hash01  # noqa: E402
from terragen.geom import catmull_rom, densify, fillet, PolyField, bbox_slices, seg_intersections  # noqa: E402
from terragen.erosion import hydraulic, thermal, flow_accumulation, slope_map, normals, curvature  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'terrain')
MAP = json.load(open(os.path.join(ROOT, 'data', 'map.json')))
SIZE = int(MAP['SIZE']); HALF = SIZE // 2; N = SIZE; V = N + 1
WATER_LEVEL = float(MAP['WATER_LEVEL'])
VERSION = 'pechorsk-terrain-v3'
SEED = 1987
T0 = time.time()


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


def check(stage):
    hh = globals().get('h')
    if hh is not None and (np.abs(hh).max() > 500 or np.isnan(hh).any()):
        j, i = np.unravel_index(np.abs(np.nan_to_num(hh, nan=1e9)).argmax(), hh.shape)
        log('!! %s: |h| max %.3g at x=%d z=%d, nan=%d' % (stage, hh[j, i], i - HALF, j - HALF, int(np.isnan(hh).sum())))


def poi(pid):
    for p in MAP['POIS']:
        if p['id'] == pid:
            return p
    raise KeyError(pid)


# ---------------------------------------------------------------------------------------------------------------
# grid
# ---------------------------------------------------------------------------------------------------------------
xs = (np.arange(V) - HALF).astype(np.float64)
zs = (np.arange(V) - HALF).astype(np.float64)
X, Z = np.meshgrid(xs, zs)          # X[j, i] = xs[i] (east), Z[j, i] = zs[j] (south)


def gauss_bump(x, z, cx, cz, r):
    d2 = ((x - cx) ** 2 + (z - cz) ** 2) / (r * r)
    return np.where(d2 < 1.0, (1.0 - d2) ** 2, 0.0)


def dist(x, z, cx, cz):
    return np.sqrt((x - cx) ** 2 + (z - cz) ** 2)


def sample(h, x, z):
    """Bilinear sample of a grid at world coordinates (arrays)."""
    x = np.atleast_1d(np.asarray(x, dtype=np.float64)); z = np.atleast_1d(np.asarray(z, dtype=np.float64))
    return map_coordinates(h, [z + HALF, x + HALF], order=1, mode='nearest')


# ---------------------------------------------------------------------------------------------------------------
# 1. macro shape
# ---------------------------------------------------------------------------------------------------------------
log('macro shape')
WX, WZ = warp(X, Z, 70.0, 0.0028, seed=SEED)
lowland = 6.8 + 3.6 * fbm(WX * 0.0032, WZ * 0.0032, 4, seed=SEED + 1) + 1.3 * fbm(X * 0.011, Z * 0.011, 3, seed=SEED + 2)
lowland += 0.9 * fbm(X * 0.03, Z * 0.03, 3, seed=SEED + 3) + 0.25 * fbm(X * 0.09, Z * 0.09, 2, seed=SEED + 4)
# regional trends: the south-west lowland sinks toward the river exit, the south-east rises into hills
lowland += -3.0 * smoothstep(0.0, 1.0, (-(X + 200) / 440.0)) * smoothstep(0.0, 1.0, (Z - 150) / 400.0)
lowland += 4.0 * smoothstep(0.2, 1.0, (X + Z) / 1100.0) * smoothstep(0.0, 1.0, (X - 150) / 400.0)
# hills and basins (x, z, r, height)
BLOBS = [
    (50, -230, 82, 16.0),        # church hill
    (440, -262, 92, 30.0),       # radio mast hill
    (520, -60, 130, 9.0),        # east ridge behind Object 12
    (470, 470, 210, 15.0), (300, 560, 150, 8.0), (600, 300, 140, 7.0),   # south-east hills
    (-560, 40, 150, 8.0),        # western rise beyond the lake
    (-470, 220, 150, -5.5),      # lake basin
    (-40, 140, 122, -6.0),       # marsh basin (floor set later)
    (-210, -210, 55, -3.5),      # crater field basin
    (-60, -150, 75, 8.5),        # spur the rail cuts through
    (-300, 90, 160, -1.2),       # farmland flats west of Zarya
    (150, -60, 80, 1.5),         # Object 12 rise
    (430, 130, 150, 7.0),        # quarry rim ground
]
for cx, cz, r, hh in BLOBS:
    lowland += hh * gauss_bump(X, Z, cx, cz, r)
# ridged detail on the mast hill and the eastern hills
ridge = ridged(WX * 0.012, WZ * 0.012, 4, seed=SEED + 5)
lowland += 5.0 * ridge * gauss_bump(X, Z, 440, -262, 120) + 2.5 * ridge * gauss_bump(X, Z, 470, 470, 260)

# plateau north of the escarpment
plateau = 45.0 + 6.5 * fbm(WX * 0.003 + 3.0, WZ * 0.003, 4, seed=SEED + 6) + 1.5 * fbm(X * 0.02, Z * 0.02, 3, seed=SEED + 7)
plateau -= 9.0 * smoothstep(150.0, 640.0, X) + 4.0 * smoothstep(-350.0, -640.0, X)
plateau += 0.02 * np.maximum(0.0, -320.0 - Z)                # rises 2 m per 100 m toward the Column
plateau += 3.0 * ridged(WX * 0.02, WZ * 0.02, 3, seed=SEED + 8) * smoothstep(-330.0, -420.0, Z)

# cliff-top line z_top(x): wavy, pinned to z = -300 at x = 0 (the 'north' POI sits on the edge)
def z_top_of(x):
    def f(xx):
        return (-322.0 + 42.0 * fbm(xx * 0.0018, np.full_like(xx, 0.37), 3, seed=SEED + 9) + 14.0 * fbm(xx * 0.007, np.full_like(xx, 0.9), 2, seed=SEED + 10)
                + 5.0 * fbm(xx * 0.03, np.full_like(xx, 0.5), 2, seed=SEED + 90))
    base = f(x); b0 = f(np.zeros(1))
    return base + (-300.0 - b0[0]) * np.exp(-(x / 170.0) ** 2)


z_top = z_top_of(X[0])[None, :].repeat(V, axis=0)
dn = Z - z_top                                                    # + = south of the edge (below the cliff)
# buttresses and gullies in the face
dn_w = dn + 7.0 * (ridged(X * 0.03, Z * 0.03, 3, seed=SEED + 11) - 0.5) + 3.0 * fbm(X * 0.08, Z * 0.08, 2, seed=SEED + 12)
CLIFF_W = 18.0; TALUS_W = 56.0
f_face = 1.0 - 0.58 * np.clip(dn_w / CLIFF_W, 0.0, 1.0)
u_t = np.clip((dn_w - CLIFF_W) / TALUS_W, 0.0, 1.0)
f_talus = 0.42 * (1.0 - u_t) ** 2
f_esc = np.where(dn_w < 0.0, 1.0, np.where(dn_w < CLIFF_W, f_face, f_talus))
f_esc = np.where(dn_w > CLIFF_W + TALUS_W, 0.0, f_esc)
f_esc = gaussian_filter(f_esc, 1.2)
h = lowland + (plateau - lowland) * f_esc
# rock outcrops on the face: ridged displacement
cliffness = smoothstep(0.0, 0.4, f_esc) * (1.0 - smoothstep(0.9, 1.0, f_esc))
h += 2.5 * (ridged(X * 0.06, Z * 0.06, 3, seed=SEED + 13) - 0.4) * cliffness
cliff_mask = cliffness.copy()
del WX, WZ

# ---------------------------------------------------------------------------------------------------------------
# 2. valleys: the river (with meanders) and the dry ravine that climbs the escarpment
# ---------------------------------------------------------------------------------------------------------------
log('river valley')
RIVER_CTRL = MAP['RIVER']['pts']
river_dense = catmull_rom(RIVER_CTRL, 1.0)
# meanders: lateral sine offsets, strongest in the lowland, none in the gorge / reservoir
seg = np.diff(river_dense, axis=0); s_d = np.concatenate([[0.0], np.cumsum(np.linalg.norm(seg, axis=1))])
tang = np.vstack([seg, seg[-1:]]); tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
norm_l = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
zz = river_dense[:, 1]
amp = np.where(zz < -300, 4.0, np.where(zz < -100, 9.0, np.where(zz < 220, 13.0, 24.0)))
amp = gaussian_filter1d(amp, 60)
lam = np.where(zz < 220, 150.0, 260.0)
phase = np.cumsum(2 * np.pi / lam)
offs = amp * np.sin(phase + 1.3) + 0.35 * amp * np.sin(phase * 2.3 + 0.7)
river_dense = river_dense + norm_l * offs[:, None]
river_dense = densify(river_dense, 1.0)
river = PolyField(river_dense)
S_RIVER = river.length

# control table along the river: surface height, channel width, depth, half-widths of floodplain and valley, bank height
ctrl_s = np.array([river.s_at(p[0], p[1]) for p in RIVER_CTRL])
s_dam = river.s_at(-235.0, -435.0)
RES_LEVEL = 30.0; DAM_CREST = 32.0; TAIL_LEVEL = 20.0; CHUTE_LEN = 26.0
surf_ctrl = np.array([40, 30, 30, 19.6, 12, 6.5, 4.5, 3.2, 2.0, 1.0, 0.2, -0.3, -0.6, -0.6, -0.6, -0.6, -0.6, -0.6, -0.6, -0.6, -0.6], dtype=np.float64)
wch_ctrl = np.array([9, 55, 70, 12, 10, 10, 11, 11, 12, 12, 12, 13, 14, 14, 14, 15, 16, 16, 17, 18, 18], dtype=np.float64)
dep_ctrl = np.array([1.4, 4.5, 5.5, 1.8, 1.6, 1.6, 1.6, 1.8, 1.8, 1.8, 2.0, 2.0, 2.2, 2.4, 2.4, 2.4, 2.4, 2.4, 2.6, 2.6, 2.6])
wfp_ctrl = np.array([40, 34, 40, 20, 16, 30, 40, 36, 34, 32, 30, 28, 40, 50, 50, 55, 60, 70, 80, 90, 90], dtype=np.float64)
wval_ctrl = np.array([200, 220, 220, 120, 90, 120, 150, 150, 160, 160, 150, 120, 140, 140, 140, 160, 180, 180, 180, 180, 180], dtype=np.float64)
bank_ctrl = np.array([1.0, 1.0, 1.2, 1.5, 1.8, 1.6, 1.5, 1.5, 1.5, 1.5, 1.4, 1.3, 1.0, 0.9, 0.9, 1.0, 1.2, 1.2, 1.2, 1.2, 1.2])
# insert the dam knots: flat reservoir up to the dam, chute drop, then the tail
knots_s = list(ctrl_s); knots = {k: list(v) for k, v in dict(surf=surf_ctrl, wch=wch_ctrl, dep=dep_ctrl, wfp=wfp_ctrl, wval=wval_ctrl, bank=bank_ctrl).items()}


def insert_knot(s, **vals):
    i = int(np.searchsorted(knots_s, s))
    knots_s.insert(i, s)
    for k in knots:
        v = vals.get(k)
        if v is None:
            v = float(np.interp(s, [x for j, x in enumerate(knots_s) if j != i], knots[k]))
        knots[k].insert(i, v)


insert_knot(ctrl_s[1] - 45.0, surf=RES_LEVEL + 1.5, wch=14.0, dep=1.6, wfp=40.0)
insert_knot(s_dam - 30.0, surf=RES_LEVEL, wch=72.0, dep=6.0, wfp=40.0)
insert_knot(s_dam - 4.0, surf=RES_LEVEL, wch=70.0, dep=6.0, wfp=40.0)
insert_knot(s_dam + 4.0, surf=RES_LEVEL - 0.4, wch=9.0, dep=0.4, wfp=8.0)
insert_knot(s_dam + 4.0 + CHUTE_LEN, surf=TAIL_LEVEL, wch=12.0, dep=1.2, wfp=14.0)
insert_knot(s_dam + 4.0 + CHUTE_LEN + 16.0, surf=TAIL_LEVEL - 0.3, wch=12.0, dep=1.8, wfp=16.0)
knots_s = np.array(knots_s)
K = {k: np.array(v) for k, v in knots.items()}

sl_r = bbox_slices(river_dense, 260.0, HALF, N)
gx = X[sl_r].ravel(); gz = Z[sl_r].ravel()
d_r, s_r, side_r, idx_r = river.query(gx, gz)
prof = {k: np.interp(s_r, knots_s, K[k]) for k in K}
curv = river.curv[idx_r]
inner = (side_r * curv) > 0.0                       # inside of the bend: gentle point bar
u_ch = d_r / (prof['wch'] * 0.5)
bed = prof['surf'] - prof['dep'] * np.clip(1.0 - u_ch ** 2, 0.0, 1.0)
bank_w = (2.5 + prof['wch'] * 0.25) * np.where(inner, 2.4, 0.8)
d_bank = d_r - prof['wch'] * 0.5
bank_t = smoothstep(0.0, 1.0, np.clip(d_bank / bank_w, 0.0, 1.0))
fp_h = prof['surf'] + prof['bank']
h_bank = prof['surf'] + prof['bank'] * bank_t
fp_noise = 0.22 * fbm(gx * 0.05, gz * 0.05, 3, seed=SEED + 14) + 0.004 * np.clip(d_r - prof['wch'] * 0.5 - bank_w, 0.0, 80.0)
h_fp = fp_h + fp_noise * smoothstep(0.0, 6.0, d_bank - bank_w)
# terraced valley sides
u2 = np.clip((d_r - prof['wfp']) / np.maximum(prof['wval'] - prof['wfp'], 1.0), 0.0, 1.0)
u2n = np.clip(u2 + 0.07 * fbm(gx * 0.02, gz * 0.02, 3, seed=SEED + 15), 0.0, 1.0)


def terrace_profile(u):
    # three rises with two benches; benches are flat-ish (rise 0.02 across)
    f = np.zeros_like(u)
    f += np.where(u < 0.2, smoothstep(0.0, 0.2, u) * 0.3, 0.3)
    f += np.where(u < 0.35, 0.0, np.where(u < 0.55, smoothstep(0.35, 0.55, u) * 0.32, 0.32))
    f += np.where(u < 0.7, 0.0, smoothstep(0.7, 1.0, u) * 0.38)
    f += 0.02 * u
    return np.clip(f / 1.02, 0.0, 1.0)


f_val = terrace_profile(u2n)
h_flat = h[sl_r].ravel()
h_val = h_fp + (h_flat - h_fp) * f_val
in_ch = d_r < prof['wch'] * 0.5
in_bank = d_r < prof['wch'] * 0.5 + bank_w
in_fp = d_r < prof['wfp']
in_val = d_r < prof['wval']
new = np.where(in_ch, bed, np.where(in_bank, h_bank, np.where(in_fp, h_fp, np.where(in_val, h_val, h_flat))))
# the marsh keeps its own floor; the valley blend fades out inside it
mp = poi('marsh')
marsh_d = dist(gx, gz, mp['x'], mp['z']) / (mp['r'] * (1.0 + 0.12 * fbm(gx * 0.01, gz * 0.01, 2, seed=SEED + 16)))
marsh_w = 1.0 - smoothstep(0.6, 1.0, marsh_d)
wv = np.where(in_ch, 1.0, 1.0 - marsh_w)
h[sl_r] = (h_flat + (new - h_flat) * wv).reshape(h[sl_r].shape)
# channel always carved (it also cuts through the marsh floor)
h[sl_r] = np.where(in_ch, np.minimum(h[sl_r].ravel(), bed), h[sl_r].ravel()).reshape(h[sl_r].shape)
# keep-out mask for stamps and a corridor record used for water later
river_keep = np.zeros_like(h)
river_keep[sl_r] = (1.0 - smoothstep(0.0, 8.0, d_r - prof['wch'] * 0.5 - bank_w)).reshape(h[sl_r].shape)
river_d = np.full_like(h, 1e9); river_d[sl_r] = d_r.reshape(h[sl_r].shape)
river_s = np.zeros_like(h); river_s[sl_r] = s_r.reshape(h[sl_r].shape)
river_surf = np.full_like(h, np.nan); river_surf[sl_r] = prof['surf'].reshape(h[sl_r].shape)
river_wch = np.zeros_like(h); river_wch[sl_r] = prof['wch'].reshape(h[sl_r].shape)
river_bankw = np.zeros_like(h); river_bankw[sl_r] = bank_w.reshape(h[sl_r].shape)
river_inner = np.zeros_like(h); river_inner[sl_r] = inner.astype(np.float64).reshape(h[sl_r].shape)
river_tx = np.zeros_like(h); river_tz = np.zeros_like(h)
river_tx[sl_r] = river.tangent[idx_r, 0].reshape(h[sl_r].shape); river_tz[sl_r] = river.tangent[idx_r, 1].reshape(h[sl_r].shape)
river_val = np.zeros_like(h); river_val[sl_r] = (in_val & (wv > 0.5)).reshape(h[sl_r].shape)
del gx, gz, prof, bed, h_bank, h_fp, h_val, new, u2, u2n, f_val, h_flat, fp_noise

# dry ravine: a side valley through the escarpment where the north track climbs
log('ravine')
RAVINE = [[112, -262], [108, -300], [104, -360], [95, -430], [80, -500], [60, -560], [40, -600]]
rav_dense = catmull_rom(RAVINE, 1.0)
rav = PolyField(rav_dense)
sl_v = bbox_slices(rav_dense, 90.0, HALF, N)
gx = X[sl_v].ravel(); gz = Z[sl_v].ravel()
d_v, s_v, _, idx_v = rav.query(gx, gz)
floor_ctrl = np.array([0.0, 40.0, 100.0, 175.0, 250.0, 315.0, rav.length])
floor_h = np.interp(s_v, floor_ctrl, [7.5, 11.0, 18.0, 28.0, 38.0, 45.0, 48.0])
wf = 9.0; wv2 = np.interp(s_v, [0.0, 80.0, rav.length], [40.0, 75.0, 60.0])
u = np.clip((d_v - wf) / (wv2 - wf), 0.0, 1.0)
u = np.clip(u + 0.08 * fbm(gx * 0.03, gz * 0.03, 3, seed=SEED + 17), 0.0, 1.0)
fprof = u ** 1.5
hf = h[sl_v].ravel()
newv = np.where(d_v < wf, floor_h + 0.15 * fbm(gx * 0.1, gz * 0.1, 2, seed=SEED + 18), floor_h + (hf - floor_h) * fprof)
# only carve (the ravine lowers ground; where the ground is already lower than the floor keep it)
newv = np.where(d_v < wv2, np.minimum(hf, newv), hf)
h[sl_v] = newv.reshape(h[sl_v].shape)
ravine_d = np.full_like(h, 1e9); ravine_d[sl_v] = d_v.reshape(h[sl_v].shape)
del gx, gz, newv, hf, u, fprof

# ---------------------------------------------------------------------------------------------------------------
# 3. basins: marsh floor, lake, crater field
# ---------------------------------------------------------------------------------------------------------------
log('basins')
marsh_dn = dist(X, Z, mp['x'], mp['z']) / (mp['r'] * (1.0 + 0.12 * fbm(X * 0.01, Z * 0.01, 2, seed=SEED + 16)))
marsh_mask = 1.0 - smoothstep(0.6, 1.0, marsh_dn)
marsh_floor = -1.35 + 0.55 * fbm(X * 0.06, Z * 0.06, 3, seed=SEED + 19) + 0.4 * fbm(X * 0.22, Z * 0.22, 2, seed=SEED + 20)
marsh_floor += 0.35 * smoothstep(0.35, 0.75, worley(X * 0.08, Z * 0.08, seed=SEED + 21))    # hummocks
h = np.where(river_d < river_wch * 0.5, h, lerp(h, marsh_floor, marsh_mask * 0.95))

lp = poi('lake'); LAKE_LEVEL = 2.0
ang = np.arctan2(Z - lp['z'], X - lp['x'])
lake_r = 96.0 * (1.0 + 0.18 * np.sin(2 * ang + 1.0) + 0.12 * np.sin(3 * ang + 2.5) + 0.06 * np.sin(7 * ang + 0.4) + 0.05 * fbm(X * 0.03, Z * 0.03, 2, seed=SEED + 91))
rho = dist(X, Z, lp['x'], lp['z']) / lake_r
lake_bed = LAKE_LEVEL - 6.5 * np.clip(1.0 - rho ** 2.2, 0.0, 1.0) + 0.25 * fbm(X * 0.05, Z * 0.05, 2, seed=SEED + 22)
lake_w = 1.0 - smoothstep(1.0, 1.3, rho)
h = np.where(rho < 1.0, np.minimum(h, lake_bed), lerp(h, np.maximum(h, LAKE_LEVEL + 0.35), lake_w * smoothstep(1.3, 1.05, rho)))
# a shallow shore shelf just outside
h = np.where((rho >= 1.0) & (rho < 1.12), np.minimum(h, LAKE_LEVEL + 0.35 + 3.0 * (rho - 1.0)), h)
lake_rho = rho

cp = poi('field_c')
crater_rng = np.random.default_rng(SEED + 23)
crater_field = np.zeros_like(h)
for k in range(11):
    a = crater_rng.uniform(0, 2 * np.pi); rr = crater_rng.uniform(4.0, 36.0)
    cx = cp['x'] + np.cos(a) * rr; cz = cp['z'] + np.sin(a) * rr
    cr = crater_rng.uniform(5.0, 13.0); dep = 0.38 * cr; rim = 0.13 * cr
    rr2 = dist(X, Z, cx, cz) / cr
    crater_field += np.where(rr2 < 1.0, -dep * (1.0 - rr2 ** 2), 0.0) + rim * np.exp(-((rr2 - 1.0) / 0.22) ** 2)
craters_pending = crater_field       # stamped after erosion (crisp rims)

# ---------------------------------------------------------------------------------------------------------------
# 4. erosion
# ---------------------------------------------------------------------------------------------------------------
log('erosion (hydraulic)')
protect = np.clip(river_keep + (marsh_mask * 0.8) + (rho < 1.05) * 1.0 + smoothstep(0.75, 1.0, f_esc) * 0.0, 0.0, 1.0)
for pid, frac in [('vanno', 1.0), ('checkpoint', 0.8), ('zarya', 0.6), ('object12', 0.8), ('church', 0.5), ('field_b', 0.7)]:
    p = poi(pid); protect = np.maximum(protect, frac * (1.0 - smoothstep(0.5, 1.0, dist(X, Z, p['x'], p['z']) / p['r'])))
spawn_w = 0.02 + smoothstep(0.05, 0.3, slope_map(gaussian_filter(h, 4.0))[0])
spawn_w *= (1.0 - protect * 0.9)
h = hydraulic(h, n_drops=140000, seed=SEED, batch=14000, lifetime=72, capacity=6.0, erode_speed=0.35, deposit_speed=0.25,
              evaporate=0.015, radius=2, protect=protect, spawn_weight=spawn_w, log=log)
check('after hydraulic'); log('erosion (thermal)')
talus = np.where(cliff_mask > 0.35, 2.2, 0.72) + 0.4 * smoothstep(0.55, 1.0, f_esc) * 0.0
h = thermal(h, iterations=40, talus_tan=talus, rate=0.9, protect=np.clip(river_keep, 0.0, 1.0))
check('after thermal')
h = np.where(marsh_mask > 0.3, gaussian_filter(h, 0.8) * marsh_mask + h * (1 - marsh_mask), h)
flat_w = (1.0 - smoothstep(0.035, 0.11, slope_map(gaussian_filter(h, 8.0))[0])) * (1.0 - river_keep)
h = lerp(h, gaussian_filter(h, 1.6), flat_w * 0.7)
h += craters_pending * (1.0 - smoothstep(0.0, 5.0, river_wch * 0.5 + 3.0 - river_d))
# quarry outer ground flat-ish before the pit
qp = poi('quarry')

# ---------------------------------------------------------------------------------------------------------------
# 5. man-made stamps
# ---------------------------------------------------------------------------------------------------------------
check('before stamps: plateaus'); log('stamps: plateaus')
stamp_keep = np.clip(river_keep, 0.0, 1.0)


def plateau_stamp(cx, cz, r, level=None, strength=0.9, inner=0.5, outer=1.12, noise=0.3):
    global h
    d = dist(X, Z, cx, cz) / r
    if level is None:
        m = d < 0.55
        level = float(np.mean(h[m]))
    w = (1.0 - smoothstep(inner, outer, d)) * strength * (1.0 - stamp_keep)
    target = level + noise * fbm(X * 0.05 + cx, Z * 0.05 + cz, 2, seed=SEED + 24)
    h = lerp(h, target, w)
    return level


LEVELS = {}
LEVELS['vanno'] = plateau_stamp(0, 300, 34, level=5.5, strength=1.0, noise=0.12)
LEVELS['checkpoint'] = plateau_stamp(22, 212, 22, level=3.8, strength=0.85, noise=0.2, outer=1.4)
LEVELS['convoy'] = plateau_stamp(48, 160, 26, level=3.6, strength=0.9, noise=0.3, outer=1.4)
LEVELS['zarya'] = plateau_stamp(-130, 60, 72, level=4.6, strength=0.7, noise=0.45, inner=0.6, outer=1.15)
LEVELS['object12'] = plateau_stamp(150, -60, 58, strength=0.9, noise=0.15)
LEVELS['field_b'] = plateau_stamp(225, 70, 45, strength=0.7, noise=0.3)
LEVELS['church'] = plateau_stamp(50, -230, 30, strength=0.9, noise=0.15)
LEVELS['mast'] = plateau_stamp(440, -262, 18, strength=0.95, noise=0.1)
LEVELS['north'] = plateau_stamp(0, -348, 46, strength=0.9, noise=0.2)
LEVELS['rail'] = None
ANCHORS = [(0, 300, 34), (22, 212, 22), (150, -60, 58), (225, 70, 45), (50, -230, 30), (440, -262, 18), (0, -348, 46), (-130, 60, 60), (48, 160, 26), (22, 212, 22)]

# --- quarry: stepped benches cut into the rim ground, flooded floor, a spiral ramp ---------------------------------
check('before stamps: quarry'); log('stamps: quarry')
ang = np.arctan2(Z - qp['z'], X - qp['x'])
q_r = 82.0 * (1.0 + 0.12 * np.sin(3 * ang + 0.7) + 0.08 * np.sin(5 * ang + 2.0) + 0.04 * np.sin(11 * ang))
q_d = dist(X, Z, qp['x'], qp['z'])
q_in = q_r - q_d                                       # metres inside the rim
QUARRY_RIM = float(np.mean(h[(q_d > q_r + 5) & (q_d < q_r + 40)]))
QUARRY_LEVEL = QUARRY_RIM - 9.0
h = lerp(h, QUARRY_RIM + 0.4 * fbm(X * 0.04, Z * 0.04, 2, seed=SEED + 25), (1.0 - smoothstep(q_r + 30, q_r + 70, q_d)) * 0.85)
BENCH = 6.0; FACE = 1.6; BENCH_W = 12.0
q_h = np.full_like(h, QUARRY_RIM)
lvl = QUARRY_RIM
for b in range(3):
    start = b * (FACE + BENCH_W)
    q_h = np.where(q_in > start, lvl - BENCH * smoothstep(start, start + FACE, q_in), q_h)
    lvl -= BENCH
q_h += 0.25 * fbm(X * 0.15, Z * 0.15, 2, seed=SEED + 26) * (q_in > 0)
q_h -= 0.8 * smoothstep(2 * (FACE + BENCH_W) + FACE, q_r, q_in)     # floor dips toward the centre
h = np.where(q_in > 0, np.minimum(h, q_h), h)
quarry_in = q_in
quarry_face = (q_in > 0) & (np.abs((q_in % (FACE + BENCH_W)) - FACE * 0.5) < FACE * 0.9)
# spiral ramp from the west rim (track end) clockwise down to the second bench
ramp_pts = []
a0 = np.pi; nseg = 60
for k in range(nseg + 1):
    t = k / nseg
    a = a0 - t * np.deg2rad(215.0)
    rr = 82.0 * (1.0 + 0.12 * np.sin(3 * a + 0.7) + 0.08 * np.sin(5 * a + 2.0) + 0.04 * np.sin(11 * a)) - 3.2 - 2.5 * t
    ramp_pts.append([qp['x'] + np.cos(a) * rr, qp['z'] + np.sin(a) * rr, QUARRY_RIM - 12.0 * t])
ramp_pts = np.array(ramp_pts)

# --- roads and rail --------------------------------------------------------------------------------------------
check('before stamps: roads'); log('stamps: roads')
road_kind_d = {'asphalt': np.full_like(h, 1e9), 'gravel': np.full_like(h, 1e9), 'dirt': np.full_like(h, 1e9), 'rail': np.full_like(h, 1e9), 'concrete': np.full_like(h, 1e9)}
road_any_d = np.full_like(h, 1e9)
road_hw = np.zeros_like(h)
road_center_h = np.full_like(h, np.nan)
BRIDGES = []



def road_profile(field, sigma, max_grade, explicit=None, level_spans=(), min_deck=-1e9):
    """Centre-line height along the dense polyline: smoothed terrain, grade-limited, level over bridges,
    pinned to the stamped POI plateaus so roads never cut through a base or a village."""
    P = field.P
    if explicit is not None:
        return explicit
    keep = sample(river_keep, P[:, 0], P[:, 1])
    hs = sample(h, P[:, 0], P[:, 1])
    hs_raw = hs.copy()
    anchor_w = np.zeros(len(P))
    for (ax, az, ar) in ANCHORS:
        anchor_w = np.maximum(anchor_w, 1.0 - smoothstep(0.45 * ar, 0.8 * ar, np.hypot(P[:, 0] - ax, P[:, 1] - az)))
    hs = np.where(keep > 0.15, np.nan, hs)
    nans = np.isnan(hs)
    if nans.any():
        hs[nans] = np.interp(field.s[nans], field.s[~nans], hs[~nans])
    hs = gaussian_filter1d(hs, sigma / max(1e-6, np.mean(np.diff(field.s))), mode='nearest')
    ds = np.diff(field.s)
    for _ in range(4):
        for i in range(1, len(hs)):
            hs[i] = np.clip(hs[i], hs[i - 1] - max_grade * ds[i - 1], hs[i - 1] + max_grade * ds[i - 1])
        for i in range(len(hs) - 2, -1, -1):
            hs[i] = np.clip(hs[i], hs[i + 1] - max_grade * ds[i], hs[i + 1] + max_grade * ds[i])
    hs = lerp(hs, hs_raw, anchor_w)
    if anchor_w.max() > 0.5:
        log('    profile anchors: max w %.2f, raw end %.2f, profile end %.2f, len %d' % (anchor_w.max(), hs_raw[-1], hs[-1], len(hs)))
    for (sa, sb) in level_spans:
        m = (field.s >= sa) & (field.s <= sb)
        if m.any():
            ha = np.interp(sa, field.s, hs); hb = np.interp(sb, field.s, hs)
            lvl = max(ha, hb, min_deck)
            hs[m] = lvl
            # ease the approaches over 25 m each side
            for (s0, s1, dirn) in ((sa - 25.0, sa, 1), (sb, sb + 25.0, -1)):
                mm = (field.s >= s0) & (field.s <= s1)
                t = (field.s[mm] - s0) / 25.0
                if dirn < 0:
                    t = 1.0 - t
                hs[mm] = np.maximum(hs[mm], lerp(hs[mm], lvl, smoothstep(0.0, 1.0, t)))
    return hs


def stamp_road(pts, width, kind, sigma=25.0, max_grade=0.09, explicit_h=None, bridges=(), ditch=True, crown=0.08, ramp=False, min_deck=-1e9):
    global h
    hw = width * 0.5
    dense = fillet(pts, radius=12.0, spacing=1.0) if explicit_h is None else densify(pts, 1.0)
    field = PolyField(dense)
    level_spans = []
    binfo = []
    for b in bridges:
        sb = field.s_at(b['x'], b['z'])
        keep_line = sample(river_keep, field.P[:, 0], field.P[:, 1])
        near = np.where((keep_line > 0.25) & (np.abs(field.s - sb) < 60.0))[0]
        if len(near):
            s0 = field.s[near[0]] - 2.5; s1 = field.s[near[-1]] + 2.5
            sb = 0.5 * (s0 + s1); half = max(b['half'], 0.5 * (s1 - s0))
        else:
            half = b['half']
        b = dict(b, half=half)
        level_spans.append((sb - half, sb + half))
        binfo.append((b, sb))
    if explicit_h is not None:
        ph = np.interp(field.s, np.linspace(0, field.length, len(explicit_h)), explicit_h)
    else:
        ph = road_profile(field, sigma, max_grade, level_spans=level_spans, min_deck=min_deck)
    for b, sb in binfo:
        i = int(np.argmin(np.abs(field.s - sb)))
        BRIDGES.append(dict(id=b['id'], kind=b['kind'], x=float(field.P[i, 0]), z=float(field.P[i, 1]), dx=float(field.tangent[i, 0]), dz=float(field.tangent[i, 1]),
                            length=float(2 * b['half']), deck=float(ph[i]), width=float(width), broken=bool(b.get('broken', False)), water=float(sample(river_surf, field.P[i, 0], field.P[i, 1])[0])))
    margin = hw + 64.0
    sl = bbox_slices(dense, margin, HALF, N)
    gx = X[sl].ravel(); gz = Z[sl].ravel()
    d, s, side, idx = field.query(gx, gz)
    hc = np.interp(s, field.s, ph)
    hf = h[sl].ravel()
    # cross-section
    if kind == 'rail':
        top_w = 2.2
        target = hc + 0.0
        zone = top_w + 0.6
    else:
        target = hc + crown * np.clip(1.0 - (d / hw) ** 2, 0.0, 1.0)
        zone = hw + 1.2
    shoulder = np.clip((d - hw) / 1.2, 0.0, 1.0)
    target = np.where(d > hw, hc - 0.06 * shoulder, target)
    if ditch and kind in ('asphalt', 'gravel'):
        dd = (d - hw - 1.2) / 2.6
        ditch_shape = -0.42 * np.clip(1.0 - np.abs(dd * 2.0 - 1.0), 0.0, 1.0)
        at_grade = hf > hc - 0.6                       # a ditch only where the road is not on an embankment
        target = np.where((d > hw + 1.2) & (d < hw + 3.8) & at_grade, hc - 0.06 + ditch_shape, target)
        zone = np.where(at_grade, hw + 3.8, hw + 1.2)
    # beyond the formation: fill slope (1:1.75) where the ground is lower, cut slope (1:1.3) where it is higher
    base = hc - 0.06
    fill_line = base - (d - zone) / 1.75
    cut_line = base + (d - zone) / 1.3
    outside = np.where(hf < base, np.maximum(hf, fill_line), np.minimum(hf, cut_line))
    newh = np.where(d < zone, target, outside)
    w = 1.0 - sample(stamp_keep, gx, gz)
    if ramp:
        w *= (sample(quarry_in, gx, gz) > -3.0)
    newh = lerp(hf, newh, w)
    h[sl] = newh.reshape(h[sl].shape)
    kd = road_kind_d[kind][sl].ravel()
    road_kind_d[kind][sl] = np.minimum(kd, d).reshape(h[sl].shape)
    ad = road_any_d[sl].ravel()
    upd = d < ad
    road_any_d[sl] = np.where(upd, d, ad).reshape(h[sl].shape)
    rh = road_hw[sl].ravel(); road_hw[sl] = np.where(upd, hw, rh).reshape(h[sl].shape)
    rc = road_center_h[sl].ravel(); road_center_h[sl] = np.where(upd, hc, rc).reshape(h[sl].shape)
    return field, ph


ROAD_FIELDS = {}
order = sorted(MAP['ROADS'], key=lambda r: {'dirt': 0, 'gravel': 1, 'asphalt': 2}[r['kind']])
bridge_defs = {'main': [dict(id='bridge', kind='road', x=-70.0, z=69.0, half=15.0)]}
for r in order:
    kind = r['kind']
    sig = {'asphalt': 30.0, 'gravel': 18.0, 'dirt': 10.0}[kind]
    grade = {'asphalt': 0.07, 'gravel': 0.11, 'dirt': 0.14}[kind]
    crown = {'asphalt': 0.09, 'gravel': 0.07, 'dirt': 0.03}[kind]
    f, ph = stamp_road(r['pts'], r['width'], kind, sigma=sig, max_grade=grade, bridges=bridge_defs.get(r['id'], ()), crown=crown, min_deck=-0.3 + 3.2)
    ROAD_FIELDS[r['id']] = (f, ph)
# quarry ramp (gravel, explicit descending profile)
stamp_road(ramp_pts[:, :2], 5.0, 'gravel', explicit_h=ramp_pts[:, 2], ditch=False, crown=0.0, ramp=True)
check('before stamps: rail'); log('stamps: rail')
rail_field, rail_ph = stamp_road(MAP['RAIL']['pts'], 4.4, 'rail', sigma=120.0, max_grade=0.018,
                                 bridges=[dict(id='rail_bridge', kind='rail', x=-140.0, z=-134.0, half=18.0, broken=True)], min_deck=3.2 + 4.6)
LEVELS['rail'] = float(np.interp(rail_field.s_at(-60, -150), rail_field.s, rail_ph))

# --- dam body and spillway ---------------------------------------------------------------------------------------
check('before stamps: dam'); log('stamps: dam')
i_dam = int(np.argmin(np.abs(river.s - s_dam)))
dam_c = river.P[i_dam]; dam_t = river.tangent[i_dam]; dam_n = np.array([-dam_t[1], dam_t[0]])
sl = bbox_slices(np.array([dam_c - 140, dam_c + 140]), 0.0, HALF, N)
gx = X[sl].ravel(); gz = Z[sl].ravel()
a_al = (gx - dam_c[0]) * dam_t[0] + (gz - dam_c[1]) * dam_t[1]          # along river (+ downstream)
b_ac = (gx - dam_c[0]) * dam_n[0] + (gz - dam_c[1]) * dam_n[1]          # across
body = np.where(np.abs(a_al) <= 4.0, DAM_CREST, np.where(a_al > 4.0, DAM_CREST - (a_al - 4.0) / 2.0, DAM_CREST - (-a_al - 4.0) / 2.5))
body = np.where(np.abs(b_ac) < 95.0, body, -1e9)
hf = h[sl].ravel()
chute = (np.abs(b_ac) < 5.0) & (a_al > -4.0) & (a_al < 4.0 + CHUTE_LEN)
notch = np.where(a_al <= 4.0, RES_LEVEL - 0.45, RES_LEVEL - 0.45 - (a_al - 4.0) * (RES_LEVEL - 0.45 - (TAIL_LEVEL - 1.0)) / CHUTE_LEN)
steps = np.floor((a_al - 4.0) / 3.0) * 3.0 + 4.0
notch_stepped = np.where(a_al > 4.0, RES_LEVEL - 0.45 - (steps - 4.0) * (RES_LEVEL - 0.45 - (TAIL_LEVEL - 1.0)) / CHUTE_LEN, notch)
basin = (np.abs(b_ac) < 9.0) & (a_al >= 4.0 + CHUTE_LEN) & (a_al < 4.0 + CHUTE_LEN + 16.0)
newh = np.maximum(hf, body)
newh = np.where(chute, np.minimum(newh, notch_stepped), newh)
newh = np.where(basin, np.minimum(newh, TAIL_LEVEL - 1.2), newh)
# keep the river bed below the tail level downstream of the basin (it was carved by the valley step)
h[sl] = newh.reshape(h[sl].shape)
dam_mask = np.zeros_like(h); dam_mask[sl] = ((body > -1e8) & (newh <= body + 0.01) & (newh > hf + 0.05)).reshape(h[sl].shape)
chute_mask = np.zeros_like(h); chute_mask[sl] = (chute | basin).reshape(h[sl].shape)
dam_crest_mask = np.zeros_like(h); dam_crest_mask[sl] = ((np.abs(a_al) <= 4.0) & (np.abs(b_ac) < 95.0) & (newh >= DAM_CREST - 0.05)).reshape(h[sl].shape)
road_kind_d['concrete'] = np.where(chute_mask > 0, 0.0, road_kind_d['concrete'])
road_kind_d['concrete'] = np.where(dam_crest_mask > 0, 0.0, road_kind_d['concrete'])
DAM_INFO = dict(x=float(dam_c[0]), z=float(dam_c[1]), dx=float(dam_t[0]), dz=float(dam_t[1]), crest=DAM_CREST, reservoir=RES_LEVEL, tail=TAIL_LEVEL, chute_len=CHUTE_LEN)

# --- marsh works: peat cuttings and drainage ditches --------------------------------------------------------------
check('before stamps: marsh works'); log('stamps: marsh works')
peat_mask = np.zeros_like(h)
for row in range(3):
    for col in range(4):
        cx = -22 + col * 22 + (row % 2) * 6; cz = 158 + row * 13
        m = (np.abs(X - cx) < 8.0) & (np.abs(Z - cz) < 2.8)
        edge = np.maximum(np.abs(X - cx) - 8.0, np.abs(Z - cz) - 2.8)
        w = 1.0 - smoothstep(-0.5, 1.2, edge)
        pit = np.minimum(h, -2.3 + 0.15 * fbm(X * 0.3, Z * 0.3, 2, seed=SEED + 27))
        h = lerp(h, pit, w * (river_d > river_wch * 0.5 + 4.0))
        peat_mask = np.maximum(peat_mask, w)
        # the dug bank beside the pit
        bank = (np.abs(X - cx) < 9.5) & (np.abs(Z - cz - 4.6) < 1.6)
        h = np.where(bank & (river_d > river_wch * 0.5 + 4.0), np.maximum(h, -0.25), h)
DITCHES = [[[-135, 105], [-78, 125]], [[-140, 140], [-70, 160]], [[-130, 175], [-70, 195]], [[-120, 210], [-78, 225]],
           [[5, 120], [-38, 135]], [[12, 176], [-32, 186]], [[2, 210], [-46, 220]], [[-95, 235], [-60, 250]]]
ditch_d = np.full_like(h, 1e9)
for dpts in DITCHES:
    dd = densify(dpts, 1.0); fld = PolyField(dd)
    sl = bbox_slices(dd, 8.0, HALF, N)
    gx = X[sl].ravel(); gz = Z[sl].ravel()
    d, s, _, _ = fld.query(gx, gz)
    hf = h[sl].ravel()
    prof_d = -1.25 - 0.15 * np.clip(1.0 - d / 1.2, 0.0, 1.0)
    w = 1.0 - smoothstep(0.8, 2.2, d)
    keep = sample(river_keep, gx, gz)
    h[sl] = np.where(keep < 0.5, lerp(hf, np.minimum(hf, prof_d), w), hf).reshape(h[sl].shape)
    ditch_d[sl] = np.minimum(ditch_d[sl].ravel(), d).reshape(h[sl].shape)

# --- lake landing (sand flat where the track meets the shore), pier record --------------------------------------
LANDING = dict(x=-378.0, z=200.0)
lw = 1.0 - smoothstep(6.0, 16.0, dist(X, Z, LANDING['x'], LANDING['z']))
h = lerp(h, np.maximum(LAKE_LEVEL + 0.5, np.minimum(h, LAKE_LEVEL + 1.2)), lw * (lake_rho > 0.98))
pier_dir = np.array([lp['x'] - LANDING['x'], lp['z'] - LANDING['z']]); pier_dir /= np.linalg.norm(pier_dir)
PIER = dict(x=LANDING['x'] + pier_dir[0] * 4.0, z=LANDING['z'] + pier_dir[1] * 4.0, dx=float(pier_dir[0]), dz=float(pier_dir[1]), length=26.0, deck=LAKE_LEVEL + 0.55, width=2.0)

# ---------------------------------------------------------------------------------------------------------------
# 6. final cleanup and water surfaces
# ---------------------------------------------------------------------------------------------------------------
check('before water surfaces'); log('water surfaces')
h = np.where(np.isnan(h), 0.0, h)
water_surf = np.full_like(h, np.nan)
# river: cells inside the corridor at or below the local surface
corridor = (river_d < river_wch * 0.5 + river_bankw * 1.5 + 2.0)
riv_w = corridor & (h < river_surf - 0.02)
water_surf = np.where(riv_w, river_surf, water_surf)
# reservoir upstream of the dam (whole valley width below RES_LEVEL)
sl = bbox_slices(np.array([dam_c - 400, dam_c + 400]), 0.0, HALF, N)
gx = X[sl].ravel(); gz = Z[sl].ravel()
a_al = (gx - dam_c[0]) * dam_t[0] + (gz - dam_c[1]) * dam_t[1]
up = (a_al < -2.0) & (river_val[sl].ravel() > 0.5) & (river_s[sl].ravel() > ctrl_s[1] - 60.0) & (h[sl].ravel() < RES_LEVEL - 0.02)
ws = water_surf[sl].ravel(); ws = np.where(up, RES_LEVEL, ws); water_surf[sl] = ws.reshape(water_surf[sl].shape)
# spillway sheet and stilling basin
ch = (chute_mask > 0) & (h < RES_LEVEL)
water_surf = np.where(ch, np.minimum(np.where(np.isnan(water_surf), 1e9, water_surf), h + 0.28), water_surf)
# marsh pools (and peat pits, ditches inside the marsh)
marsh_w = (marsh_mask > 0.25) & (h < WATER_LEVEL - 0.02) & (river_d > river_wch * 0.5)
water_surf = np.where(marsh_w & np.isnan(water_surf), WATER_LEVEL, water_surf)
# lake
lake_w = (lake_rho < 1.15) & (h < LAKE_LEVEL - 0.02)
water_surf = np.where(lake_w, LAKE_LEVEL, water_surf)
# quarry
quarry_w = (quarry_in > 0) & (h < QUARRY_LEVEL - 0.02)
water_surf = np.where(quarry_w, QUARRY_LEVEL, water_surf)
# land that ended up below the marsh level outside every body is lifted (no ambiguous puddles)
water_mask = ~np.isnan(water_surf)
land_low = (~water_mask) & (h < WATER_LEVEL + 0.15) & (marsh_mask < 0.25) & (lake_rho > 1.15) & (quarry_in <= 0) & (river_d > river_wch * 0.5 + river_bankw + 6)
h = np.where(land_low, WATER_LEVEL + 0.15 + 0.1 * fbm(X * 0.2, Z * 0.2, 2, seed=SEED + 28), h)
# remove isolated one-cell water specks
from scipy.ndimage import binary_opening, label
wm = binary_opening(water_mask, iterations=1)
water_surf = np.where(wm, water_surf, np.nan)
water_mask = wm
depth = np.where(water_mask, water_surf - h, 0.0)
# flow: river tangent scaled by speed; still elsewhere
speed = np.where(river_s < s_dam, 0.15, np.where(river_s < ctrl_s[5], 1.6, np.where(river_s < ctrl_s[11], 0.7, 0.35)))
speed = np.where(chute_mask > 0, 3.0, speed)
flow_x = np.where(water_mask & corridor, river_tx * speed, 0.0); flow_z = np.where(water_mask & corridor, river_tz * speed, 0.0)
flow_x = np.where(water_mask & (chute_mask > 0), dam_t[0] * 3.0, flow_x); flow_z = np.where(water_mask & (chute_mask > 0), dam_t[1] * 3.0, flow_z)
res_cells = water_mask & (water_surf > RES_LEVEL - 0.1) & (water_surf < RES_LEVEL + 0.1)
flow_x = np.where(res_cells, 0.0, flow_x); flow_z = np.where(res_cells, 0.0, flow_z)
# extended surface (2 m dilation) so the water mesh reaches under the banks
water_ext = water_surf.copy()
for _ in range(3):
    m = np.isnan(water_ext)
    nb = np.stack([np.roll(water_ext, s, ax) for s in (-1, 1) for ax in (0, 1)])
    fill = np.nanmean(np.where(np.isnan(nb), np.nan, nb), axis=0)
    water_ext = np.where(m & ~np.isnan(fill), fill, water_ext)

# ---------------------------------------------------------------------------------------------------------------
# 7. analysis maps for the splat
# ---------------------------------------------------------------------------------------------------------------
check('before analysis'); log('analysis')
slope, gx_, gz_ = slope_map(h)
nrm = normals(h)
h_s = gaussian_filter(h, 1.2)
slope_s, _, _ = slope_map(h_s)
curv = curvature(h, 2.5)
log('flow accumulation')
h_fill = np.where(water_mask, water_surf, h)
acc, _ = flow_accumulation(gaussian_filter(h_fill, 0.7))
lacc = np.log1p(acc)
slope8 = slope_map(gaussian_filter(h, 8.0))[0]
gully_sharp = smoothstep(4.2, 7.0, lacc) * smoothstep(0.08, 0.2, slope8)
gully_broad = np.clip(gaussian_filter(smoothstep(5.5, 8.5, lacc), 3.0) * 1.8, 0.0, 1.0) * (1.0 - smoothstep(0.08, 0.2, slope8))
gully = np.clip(gully_sharp + gully_broad, 0.0, 1.0) * (~water_mask)
# distance to water (metres)
d_water = distance_transform_edt(~water_mask)
d_river_ch = np.where(river_d < river_wch * 0.5, 0.0, river_d - river_wch * 0.5)
rel_h = h - np.where(np.isnan(water_ext), np.nanmax(water_ext) * 0 + WATER_LEVEL, water_ext)     # height above the nearest water surface (rough)
tree_zone_noise = fbm(X * 0.008, Z * 0.008, 4, seed=SEED + 30)
micro = fbm(X * 0.05, Z * 0.05, 3, seed=SEED + 31)
macro = fbm(X * 0.006 + 9.0, Z * 0.006, 4, seed=SEED + 32)
hw_any = road_hw
d_road = road_any_d
d_asph = road_kind_d['asphalt']; d_grav = road_kind_d['gravel']; d_dirt = road_kind_d['dirt']; d_rail = road_kind_d['rail']; d_conc = road_kind_d['concrete']
# escarpment foot belt / plateau masks
on_plateau = f_esc > 0.98
foot_belt = (dn > CLIFF_W + TALUS_W - 10) & (dn < CLIFF_W + TALUS_W + 110)
talus_zone = (dn > CLIFF_W - 4) & (dn < CLIFF_W + TALUS_W + 6) & (f_esc > 0.02) & (f_esc < 0.96)
farmland = gauss_bump(X, Z, -300, 90, 210) * (1.0 - marsh_mask) + gauss_bump(X, Z, -200, 170, 120) * (1.0 - marsh_mask) + gauss_bump(X, Z, -80, 20, 90) * 0.8
farmland = np.clip(farmland * 1.6, 0.0, 1.0) * (lake_rho > 1.25) * (river_d > river_wch * 0.5 + river_bankw + 8)
# field strips: plough bands 28 m apart in the farmland, rotated
fu = (X * 0.94 + Z * 0.34) / 28.0
strips = smoothstep(0.42, 0.5, np.abs((fu % 1.0) - 0.5)) * 0.0 + (np.floor(fu) % 3 == 0)
strips = strips.astype(np.float64) * smoothstep(0.35, 0.7, farmland) * (slope < 0.25)

# ---------------------------------------------------------------------------------------------------------------
# 8. splat weights (8 layers) -> splat.png, splat2.png, roads.png
# ---------------------------------------------------------------------------------------------------------------
log('splat')
w_rock = smoothstep(0.62, 1.05, slope_s) + 0.6 * smoothstep(0.45, 0.75, slope_s) * (cliff_mask > 0.2)
w_rock += 0.9 * quarry_face * (~water_mask)
w_rock += 0.85 * smoothstep(0.72, 0.9, ridged(X * 0.025, Z * 0.025, 3, seed=SEED + 33)) * smoothstep(0.2, 0.45, slope_s) * (on_plateau | (gauss_bump(X, Z, 440, -262, 120) > 0.05))
w_rock += 0.5 * talus_zone * smoothstep(0.35, 0.6, micro + 0.5)
w_rock *= (1.0 - smoothstep(-3.0, 0.0, -road_any_d + road_hw + 1.0))      # not on the carriageway
w_rock = np.clip(w_rock, 0.0, 1.0)
w_gravel = np.zeros_like(h)
w_gravel += 1.0 * (d_rail < 2.4) + 0.6 * smoothstep(4.5, 2.4, d_rail)
w_gravel += 0.85 * (d_grav < road_hw + 0.3) * (d_grav < 1e8)
w_gravel += 0.7 * (d_dirt < road_hw * 0.55) * (d_dirt < 1e8) + 0.35 * (d_dirt < road_hw + 0.3) * (d_dirt < 1e8)
w_gravel += 0.6 * (np.abs(d_asph - road_hw) < 1.0) * (d_asph < 1e8)          # asphalt verge
w_gravel += 0.7 * ((quarry_in > 0) & (~water_mask)) * (1.0 - quarry_face) + 0.6 * ((q_in > -40) & (q_in <= 0)) * smoothstep(0.2, 0.6, micro + 0.5)
w_gravel += 0.75 * talus_zone * (1.0 - smoothstep(0.35, 0.6, micro + 0.5)) + 0.5 * (dam_mask > 0) * (dam_crest_mask == 0)
w_gravel += 0.5 * (river_inner > 0.5) * (d_river_ch < river_bankw) * (~water_mask) * (river_s < ctrl_s[12])
w_gravel = np.clip(w_gravel, 0.0, 1.0)
w_road = np.clip((1.0 - smoothstep(road_hw - 0.4, road_hw + 0.2, d_asph)) * (d_asph < 1e8) + (d_conc < 0.5), 0.0, 1.0)
w_sand = np.zeros_like(h)
w_sand += 0.9 * (river_inner > 0.5) * (d_river_ch < river_bankw * 1.1) * (~water_mask) * (river_s >= ctrl_s[5])
w_sand += 0.4 * (d_river_ch < river_bankw * 0.6) * (~water_mask) * (river_s >= ctrl_s[5])
w_sand += 0.85 * smoothstep(1.1, 0.96, lake_rho) * (lake_rho >= 0.9) * (~water_mask)
w_sand += 0.9 * (dist(X, Z, LANDING['x'], LANDING['z']) < 14)
w_sand += 0.35 * ((quarry_in > 0) & (~water_mask) & (d_water < 6))
w_sand += 0.5 * (d_water < 2.5) * (river_d < 1e8) * (river_s >= ctrl_s[5]) * (~water_mask) * (marsh_mask < 0.3)
w_sand = np.clip(w_sand, 0.0, 1.0)
w_moss = np.zeros_like(h)
north_facing = smoothstep(-0.12, -0.35, nrm[..., 2])
w_moss += 0.8 * north_facing * smoothstep(0.15, 0.5, tree_zone_noise + 0.3) * (1.0 - farmland)
w_moss += 0.6 * smoothstep(0.2, 0.9, -curv) * (~water_mask) * (marsh_mask < 0.5) * (slope < 0.6)
w_moss += 0.5 * smoothstep(0.55, 0.8, worley(X * 0.06 + 3.0, Z * 0.06, seed=SEED + 34)) * (dn > CLIFF_W) * (dn < CLIFF_W + 90) * (1.0 - farmland)
w_moss += 0.55 * (d_water < 5.0) * (marsh_mask > 0.3) * (~water_mask)
w_moss *= (1.0 - w_rock * 0.7) * (road_any_d > road_hw + 1.5)
w_moss = np.clip(w_moss, 0.0, 1.0)
wet = np.zeros_like(h)
wet += smoothstep(6.0, 0.0, d_water) * 0.9
wet += 0.75 * marsh_mask * (1.0 - smoothstep(-0.2, 0.9, h - WATER_LEVEL))
wet += 0.7 * gully
wet += 0.45 * smoothstep(0.25, 0.9, -curv) * (slope < 0.35)
wet += 0.5 * (ditch_d < 2.5)
wet += 0.35 * (np.abs(d_asph - road_hw - 2.4) < 0.9) * (d_asph < 1e8)         # roadside ditches hold water
wet += 0.4 * (chute_mask > 0)
wet = np.clip(wet * (1.0 - 0.8 * smoothstep(0.5, 0.9, slope_s)), 0.0, 1.0)
w_mud = np.zeros_like(h)
w_mud += 0.95 * marsh_mask * (~water_mask) * (1.0 - smoothstep(0.1, 0.7, h - WATER_LEVEL))
w_mud += 0.9 * smoothstep(3.5, 0.0, d_water) * (~water_mask)
w_mud += 0.85 * gully + 0.6 * (ditch_d < 3.0)
w_mud += 0.5 * (peat_mask > 0.2) * (~water_mask)
w_mud = np.clip(w_mud * (1.0 - w_rock) * (1.0 - w_gravel * 0.5) * (1.0 - w_sand), 0.0, 1.0)
w_dirt = np.zeros_like(h)
w_dirt += 0.45 * strips
w_dirt += 0.55 * smoothstep(0.55, 0.85, worley(X * 0.03 + 7.0, Z * 0.03 + 2.0, seed=SEED + 35)) * (1.0 - farmland * 0.5)   # dead patches
w_dirt += 0.6 * (d_dirt < road_hw + 1.0) * (d_dirt < 1e8)
for pid, frac in [('zarya', 0.6), ('object12', 0.8), ('checkpoint', 0.7), ('convoy', 0.6), ('vanno', 0.7), ('church', 0.5), ('mast', 0.7), ('rail', 0.4), ('dam', 0.5)]:
    p = poi(pid); w_dirt += frac * (1.0 - smoothstep(0.35, 0.75, dist(X, Z, p['x'], p['z']) / p['r'])) * smoothstep(0.25, 0.6, micro + 0.5 + 0.3)
w_dirt += 0.5 * smoothstep(0.3, 0.7, marsh_mask) * (h > WATER_LEVEL + 0.6)      # peat banks
w_dirt += 0.55 * (crater_field < -0.6) + 0.35 * (crater_field > 0.3)
w_dirt += 0.4 * (d_asph < road_hw + 6.0) * (d_asph > road_hw + 3.8) * smoothstep(0.4, 0.7, micro + 0.5)
w_dirt = np.clip(w_dirt * (1.0 - w_rock) * (1.0 - w_mud) * (1.0 - w_sand) * (1.0 - w_gravel) * (1.0 - w_road), 0.0, 1.0)
w_grass = np.clip(1.0 - (w_rock + w_gravel + w_road + w_sand + w_moss * 0.6 + w_mud + w_dirt), 0.0, 1.0)
w_grass = np.where(water_mask, 0.25 * w_grass, w_grass)
w_moss_final = w_moss * (1.0 - w_rock) * (1.0 - w_road) * (1.0 - w_gravel * 0.5)
layers = np.stack([w_grass, w_dirt, w_mud, w_rock, w_gravel, w_road, w_sand, w_moss_final], axis=0)
layers = np.clip(layers, 0.0, 1.0)
tot = np.maximum(layers.sum(0), 1e-4)
layers /= tot
grass, dirt, mud, rock, gravel, road, sand, moss = layers
splat = np.stack([grass, dirt + mud, rock, gravel + road], axis=-1)
splat2 = np.stack([sand, moss, wet, np.zeros_like(h)], axis=-1)
roads_png = np.stack([road / np.maximum(gravel + road, 1e-4), mud / np.maximum(dirt + mud, 1e-4), np.clip(1.0 - d_rail / 2.6, 0.0, 1.0), (d_conc < 0.5).astype(np.float64)], axis=-1)

# ---------------------------------------------------------------------------------------------------------------
# 9. flora and biome
# ---------------------------------------------------------------------------------------------------------------
log('flora')
pine = np.zeros_like(h)
pine += 0.8 * on_plateau * smoothstep(-0.35, 0.25, tree_zone_noise)
pine += 0.9 * foot_belt * smoothstep(-0.5, 0.1, fbm(X * 0.01 + 5.0, Z * 0.01, 3, seed=SEED + 36))
pine += 0.55 * (gauss_bump(X, Z, 440, -262, 130) > 0.03) * smoothstep(-0.3, 0.3, tree_zone_noise)
pine += 0.55 * (gauss_bump(X, Z, 470, 470, 260) > 0.05) * smoothstep(-0.3, 0.2, tree_zone_noise + 0.1)
pine += 0.6 * (gauss_bump(X, Z, -560, 40, 190) > 0.05) * smoothstep(-0.3, 0.2, tree_zone_noise)
pine += 0.5 * talus_zone * (dn > CLIFF_W + 20)
pine = np.clip(pine, 0.0, 1.0)
birch = np.zeros_like(h)
fp_ = poi('forest')
birch += 0.95 * (1.0 - smoothstep(0.9, 1.35, dist(X, Z, fp_['x'], fp_['z']) / fp_['r']))
birch += 0.6 * smoothstep(0.18, 0.4, fbm(X * 0.007 + 2.0, Z * 0.007 + 8.0, 4, seed=SEED + 37)) * (~on_plateau)
birch += 0.4 * (river_d < 1e8) * (d_river_ch > river_bankw + 4) * (d_river_ch < 60) * (river_s > ctrl_s[4]) * smoothstep(-0.3, 0.3, micro)
birch += 0.4 * (lake_rho > 1.05) * (lake_rho < 1.4) * smoothstep(-0.2, 0.3, micro)
birch += 0.35 * (marsh_mask > 0.2) * (h > WATER_LEVEL + 0.5) * smoothstep(0.1, 0.5, micro + 0.3)
birch += 0.3 * smoothstep(0.3, 0.6, fbm(X * 0.02 + 1.0, Z * 0.02, 3, seed=SEED + 38)) * (~on_plateau)
birch = np.clip(birch, 0.0, 1.0)
tree = np.clip(pine + birch, 0.0, 1.0)
excl = np.ones_like(h)
excl *= smoothstep(road_hw + 5.0, road_hw + 11.0, road_any_d)
excl *= (1.0 - binary_dilation(water_mask, iterations=2))
excl *= smoothstep(0.92, 0.72, slope_s)
excl *= (1.0 - smoothstep(0.35, 0.6, cliff_mask))
excl *= (1.0 - (quarry_in > -6))
excl *= (1.0 - (dam_mask > 0)) * (1.0 - (chute_mask > 0))
excl *= (1.0 - farmland * 0.92) * (1.0 - strips)
excl *= (1.0 - peat_mask) * smoothstep(1.5, 4.0, ditch_d)
for p in MAP['POIS']:
    if p['kind'] in ('forest', 'lake', 'marsh'):
        continue
    core = {'anomaly': 0.75, 'bridge': 0.45}.get(p['kind'], 0.6)
    keep = {'anomaly': 0.35, 'bridge': 0.6, 'ridge': 0.5}.get(p['kind'], 0.05)
    dd = dist(X, Z, p['x'], p['z']) / p['r']
    excl *= lerp(keep, 1.0, smoothstep(core, 1.05, dd))
tree_d = np.clip(tree * excl, 0.0, 1.0)
edge = np.clip(np.abs(gaussian_filter(tree_d, 6.0) - tree_d) * 2.5, 0.0, 1.0)
bush = np.zeros_like(h)
bush += 0.6 * edge
bush += 0.45 * (marsh_mask > 0.25) * (h > WATER_LEVEL + 0.25) * (~water_mask)
bush += 0.55 * (d_river_ch > 1.0) * (d_river_ch < river_bankw + 6) * (~water_mask) * (river_d < 1e8)
bush += 0.4 * (lake_rho > 0.98) * (lake_rho < 1.2) * (~water_mask)
bush += 0.35 * (d_rail > 2.6) * (d_rail < 9.0)
bush += 0.3 * (road_any_d > road_hw + 3.0) * (road_any_d < road_hw + 9.0) * smoothstep(0.1, 0.5, micro + 0.4)
bush += 0.35 * (ditch_d < 4.0) * (ditch_d > 1.5)
bush += 0.4 * strips * 0.0 + 0.35 * smoothstep(0.3, 0.6, fbm(X * 0.04, Z * 0.04, 3, seed=SEED + 39)) * (farmland > 0.4)
for p in MAP['POIS']:
    dd = dist(X, Z, p['x'], p['z']) / p['r']
    if p['kind'] in ('village', 'industrial', 'checkpoint', 'base', 'church', 'mast', 'convoy'):
        bush += 0.4 * smoothstep(0.7, 0.85, dd) * (1.0 - smoothstep(1.05, 1.3, dd))
bush *= smoothstep(road_hw + 1.5, road_hw + 3.5, road_any_d) * (1.0 - water_mask) * smoothstep(0.9, 0.7, slope_s) * (1.0 - (quarry_in > 0)) * (1.0 - peat_mask)
bush = np.clip(bush, 0.0, 1.0)
grass_d = np.ones_like(h)
grass_d *= (1.0 - 0.7 * smoothstep(0.35, 0.9, tree_d) * (pine > 0.4))
grass_d *= (1.0 - rock) * (1.0 - road) * (1.0 - 0.8 * gravel) * (1.0 - 0.6 * sand) * (1.0 - water_mask)
grass_d *= (1.0 - 0.85 * (quarry_in > 0)) * (1.0 - (chute_mask > 0)) * (1.0 - 0.8 * peat_mask)
grass_d *= smoothstep(road_hw - 0.5, road_hw + 0.6, road_any_d)
grass_d *= (1.0 - 0.5 * strips)
grass_d = np.clip(grass_d * (0.75 + 0.25 * smoothstep(-0.4, 0.4, micro)) * (1.0 - 0.5 * mud) * (1.0 - 0.3 * smoothstep(0.35, 0.6, marsh_mask)), 0.0, 1.0)
grass_d = np.where(marsh_mask > 0.3, np.maximum(grass_d, 0.85 * (~water_mask)), grass_d)
clutter = np.zeros_like(h)
clutter += 0.7 * smoothstep(0.3, 0.8, tree_d) + 0.85 * talus_zone + 0.5 * (river_inner > 0.5) * (d_river_ch < river_bankw + 2) * (~water_mask)
clutter += 0.65 * (quarry_in > -10) * (~water_mask) + 0.35 * (road_any_d > road_hw + 0.5) * (road_any_d < road_hw + 6.0)
clutter += 0.45 * (crater_field < -0.3) + 0.5 * (dam_mask > 0) + 0.3 * rock
for p in MAP['POIS']:
    dd = dist(X, Z, p['x'], p['z']) / p['r']
    clutter += 0.45 * (1.0 - smoothstep(0.6, 1.1, dd))
clutter = np.clip(clutter + 0.12, 0.0, 1.0) * (1.0 - water_mask)
flora = np.stack([tree_d, bush, grass_d, clutter], axis=-1)
reeds = np.clip(0.9 * (marsh_mask > 0.25) * (h > WATER_LEVEL - 0.35) * (h < WATER_LEVEL + 0.55)
                + 0.85 * (lake_rho > 0.93) * (lake_rho < 1.06) * (h < LAKE_LEVEL + 0.6)
                + 0.7 * (d_river_ch < river_bankw + 3) * (river_s >= ctrl_s[10]) * (river_d < 1e8) * (h < river_surf + 0.6)
                + 0.5 * (ditch_d < 3.5) * (h < -0.2), 0.0, 1.0) * (road_any_d > road_hw + 1.0)
biome = np.stack([pine * excl, birch * excl, reeds, farmland], axis=-1)

# ---------------------------------------------------------------------------------------------------------------
# 10. outputs
# ---------------------------------------------------------------------------------------------------------------
log('write')
os.makedirs(OUT, exist_ok=True)
h32 = h.astype('<f4')
h32.tofile(os.path.join(OUT, 'height.f32'))


def save_rgba(name, arr):
    a = np.clip(arr, 0.0, 1.0)
    Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name), optimize=True)


save_rgba('splat.png', splat)
save_rgba('splat2.png', splat2)
save_rgba('flora.png', flora)
save_rgba('roads.png', roads_png)
save_rgba('biome.png', biome)
wpng = np.stack([water_mask.astype(np.float64), 0.5 + flow_x / 4.0, 0.5 + flow_z / 4.0, np.clip(depth / 16.0, 0.0, 1.0)], axis=-1)
save_rgba('water.png', wpng)
water_ext.astype('<f4').tofile(os.path.join(OUT, 'water.f32'))

# far terrain: 257 x 257 at 16 m covering +-2048
log('far terrain')
FAR_N = 257; FAR_CELL = 16.0; FAR_HALF = 2048.0
fx = (np.arange(FAR_N) * FAR_CELL - FAR_HALF); FX, FZ = np.meshgrid(fx, fx)
far_low = 5.0 + 4.5 * fbm(FX * 0.0025, FZ * 0.0025, 4, seed=SEED + 40) + 2.0 * fbm(FX * 0.008, FZ * 0.008, 3, seed=SEED + 41)
far_plat = 48.0 + 0.02 * np.maximum(0.0, -320.0 - FZ) + 6.0 * fbm(FX * 0.003, FZ * 0.003, 4, seed=SEED + 42) + 4.0 * ridged(FX * 0.006, FZ * 0.006, 3, seed=SEED + 43)
far_zt = z_top_of(FX[0])[None, :].repeat(FAR_N, axis=0)
far_dn = FZ - far_zt
far_f = np.where(far_dn < 0, 1.0, np.where(far_dn < CLIFF_W, 1.0 - 0.58 * far_dn / CLIFF_W, np.where(far_dn < CLIFF_W + TALUS_W, 0.42 * (1 - (far_dn - CLIFF_W) / TALUS_W) ** 2, 0.0)))
far = far_low + (far_plat - far_low) * far_f
# a mountain rampart toward the Column and the ring's outer hills
far += 60.0 * smoothstep(-900.0, -1700.0, FZ) * (0.6 + 0.4 * ridged(FX * 0.004, FZ * 0.004, 3, seed=SEED + 44))
far += 25.0 * smoothstep(900.0, 1700.0, np.abs(FX)) * (0.5 + 0.5 * ridged(FX * 0.005 + 3.0, FZ * 0.005, 3, seed=SEED + 45))
far += 18.0 * smoothstep(1000.0, 1800.0, FZ) * (0.5 + 0.5 * fbm(FX * 0.004, FZ * 0.004, 3, seed=SEED + 46))
# the river valley continues north beyond the map edge
far_d = np.sqrt((FX - (-380 - (FZ + 640) * 0.35)) ** 2) * (FZ < -640)
far -= 12.0 * (1.0 - smoothstep(60.0, 220.0, far_d)) * (FZ < -640) * smoothstep(-640.0, -700.0, FZ)
inside = (np.abs(FX) <= HALF) & (np.abs(FZ) <= HALF)
far = np.where(inside, sample(h, np.clip(FX, -HALF, HALF), np.clip(FZ, -HALF, HALF)), far)
# blend the outside ring onto the map edge values over 200 m so the seam is continuous
edge_d = np.maximum(np.abs(FX), np.abs(FZ)) - HALF
edge_val = sample(h, np.clip(FX, -HALF, HALF), np.clip(FZ, -HALF, HALF))
far = np.where(inside, far, lerp(edge_val, far, smoothstep(0.0, 260.0, edge_d)))
far.astype('<f4').tofile(os.path.join(OUT, 'far.f32'))

# blocks min/max for chunk AABBs (80 m blocks -> 16 x 16)
B = 80; nb = SIZE // B
bmin = np.zeros((nb, nb)); bmax = np.zeros((nb, nb))
for j in range(nb):
    for i in range(nb):
        blk = h[j * B:(j + 1) * B + 1, i * B:(i + 1) * B + 1]
        bmin[j, i] = blk.min(); bmax[j, i] = blk.max()
river_export = [[float(river.P[i, 0]), float(river.P[i, 1]), float(np.interp(river.s[i], knots_s, K['surf'])), float(np.interp(river.s[i], knots_s, K['wch']))] for i in range(0, len(river.P), 10)]
meta = dict(version=VERSION, seed=SEED, size=SIZE, n=N, samples=V, cell=1.0, min=float(h.min()), max=float(h.max()), sea_level=WATER_LEVEL,
            water_levels=dict(marsh=WATER_LEVEL, lake=LAKE_LEVEL, quarry=QUARRY_LEVEL, reservoir=RES_LEVEL, tail=TAIL_LEVEL),
            files=dict(height='height.f32', splat='splat.png', splat2='splat2.png', flora='flora.png', water='water.png', roads='roads.png', biome='biome.png', water_surface='water.f32', far='far.f32', preview='preview.png'),
            far=dict(n=FAR_N, cell=FAR_CELL, half=FAR_HALF),
            roads_png='R asphalt share of splat.A, G mud share of splat.G, B rail ballast, A concrete',
            biome_png='R pine, G birch, B reeds, A farmland (open)',
            water_png='R mask, G flow-x (0.5 still, +-2 m/s), B flow-z, A depth/16 m',
            water_f32='(N+1)^2 float32 water surface height, NaN where no water (dilated 3 cells under the banks)',
            blocks=dict(size=B, n=nb, min=bmin.round(2).tolist(), max=bmax.round(2).tolist()),
            levels={k: (None if v is None else round(float(v), 2)) for k, v in LEVELS.items()},
            quarry=dict(x=qp['x'], z=qp['z'], rim=round(QUARRY_RIM, 2), level=round(QUARRY_LEVEL, 2), bench=BENCH, bench_w=BENCH_W, face=FACE),
            bridges=BRIDGES, pier=PIER, dam=DAM_INFO, landing=LANDING, ditches=DITCHES, ravine=RAVINE,
            river=dict(control=RIVER_CTRL, dense=river_export, note='dense: [x, z, surface height, channel width] every 10 m'),
            escarpment=dict(z_top_samples=[[float(x), float(z)] for x, z in zip(xs[::40], z_top[0, ::40])], cliff_w=CLIFF_W, talus_w=TALUS_W))
json.dump(meta, open(os.path.join(OUT, 'terrain.json'), 'w'), indent=1)

# preview: hillshade x splat colour x water
log('preview')
COL = np.array([[0.46, 0.44, 0.24], [0.42, 0.34, 0.22], [0.22, 0.18, 0.13], [0.45, 0.44, 0.41], [0.52, 0.50, 0.45], [0.28, 0.28, 0.29], [0.62, 0.56, 0.42], [0.25, 0.34, 0.16]])
col = np.tensordot(layers.transpose(1, 2, 0), COL, axes=([2], [0]))
col *= (1.0 - 0.35 * wet[..., None])
ldir = np.array([-0.5, 0.65, -0.55]); ldir /= np.linalg.norm(ldir)
shade = np.clip((nrm * ldir).sum(-1), 0.0, 1.0) * 0.8 + 0.25
col = col * shade[..., None]
wcol = np.array([0.10, 0.14, 0.15])
col = np.where(water_mask[..., None], wcol * (0.7 + 0.3 * np.clip(1.0 - depth / 4.0, 0.0, 1.0))[..., None], col)
# contour lines every 5 m, faint
cont = (np.abs(((h + 2.5) % 5.0) - 2.5) < 0.12) & (slope > 0.03)
col = np.where(cont[..., None], col * 0.75, col)
Image.fromarray((np.clip(col, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'preview.png'))
# secondary previews for the data maps
Image.fromarray((np.clip(np.stack([tree_d, bush, grass_d], -1), 0, 1) * 255).astype(np.uint8), 'RGB').resize((640, 640)).save(os.path.join(OUT, 'preview_flora.png'))
log('done: h range %.1f .. %.1f, water cells %d (%.1f%%), bridges %s' % (h.min(), h.max(), water_mask.sum(), 100.0 * water_mask.mean(), [(b['id'], round(b['deck'], 1)) for b in BRIDGES]))

# ---------------------------------------------------------------------------------------------------------------
# 11. post-steps: normal map, noise, import files, layer sheets (tools/terragen/post.py, pack_layers.py)
# ---------------------------------------------------------------------------------------------------------------
log('post')
from terragen import post as _post, pack_layers as _pack  # noqa: E402
_post.run(log)
_pack.run(1024, log)
log('all done')
