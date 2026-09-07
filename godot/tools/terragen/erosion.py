"""Erosion and hydrology on a 1 m heightfield (numpy, vectorised over droplet batches)."""
import numpy as np


def _bilinear(h, px, pz):
    """Height and gradient at float positions (cell units). h is (H, W); px in [0, W-1), pz in [0, H-1)."""
    H, W = h.shape
    ix = np.clip(np.floor(px).astype(np.int64), 0, W - 2); iz = np.clip(np.floor(pz).astype(np.int64), 0, H - 2)
    fx = px - ix; fz = pz - iz
    h00 = h[iz, ix]; h10 = h[iz, ix + 1]; h01 = h[iz + 1, ix]; h11 = h[iz + 1, ix + 1]
    gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz
    gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx
    hh = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
    return hh, gx, gz, ix, iz, fx, fz


def hydraulic(h, n_drops=120000, seed=7, batch=12000, lifetime=64, inertia=0.05, capacity=8.0, min_slope=0.01,
              erode_speed=0.3, deposit_speed=0.3, evaporate=0.012, gravity=4.0, radius=2, protect=None,
              spawn_weight=None, log=print):
    """Particle-based hydraulic erosion (Hans Beyer / S. Lague scheme), droplets simulated in vectorised batches.

    `protect` (H, W) in [0, 1] scales erosion/deposition down (1 = untouched).  `spawn_weight` (H, W) biases where
    droplets start (defaults to uniform).  Modifies h in place and returns it.
    """
    rng = np.random.default_rng(seed)
    H, W = h.shape
    # erosion kernel offsets and weights (disc of `radius`)
    offs = []
    for oz in range(-radius, radius + 1):
        for ox in range(-radius, radius + 1):
            d = np.hypot(ox, oz)
            if d <= radius + 0.01:
                offs.append((ox, oz, max(0.0, radius + 0.5 - d)))
    wsum = sum(w for _, _, w in offs)
    offs = [(ox, oz, w / wsum) for ox, oz, w in offs]
    if spawn_weight is not None:
        flat = spawn_weight.ravel().astype(np.float64)
        flat = flat / flat.sum()
        cdf = np.cumsum(flat)
    done = 0
    while done < n_drops:
        n = min(batch, n_drops - done)
        if spawn_weight is None:
            px = rng.uniform(1.0, W - 2.0, n); pz = rng.uniform(1.0, H - 2.0, n)
        else:
            cell = np.searchsorted(cdf, rng.uniform(0.0, 1.0, n))
            cell = np.clip(cell, 0, H * W - 1)
            pz = (cell // W).astype(np.float64) + rng.uniform(0.0, 1.0, n)
            px = (cell % W).astype(np.float64) + rng.uniform(0.0, 1.0, n)
            px = np.clip(px, 1.0, W - 2.0); pz = np.clip(pz, 1.0, H - 2.0)
        dx = np.zeros(n); dz = np.zeros(n); speed = np.ones(n); water = np.ones(n); sediment = np.zeros(n)
        alive = np.ones(n, dtype=bool)
        for step in range(lifetime):
            hh, gx, gz, ix, iz, fx, fz = _bilinear(h, px, pz)
            dx = dx * inertia - gx * (1.0 - inertia); dz = dz * inertia - gz * (1.0 - inertia)
            ln = np.sqrt(dx * dx + dz * dz)
            still = ln < 1e-6
            if still.any():
                a = rng.uniform(0, 2 * np.pi, int(still.sum()))
                dx[still] = np.cos(a); dz[still] = np.sin(a); ln[still] = 1.0
            dx /= ln; dz /= ln
            nx = px + dx; nz = pz + dz
            alive &= (nx >= 1.0) & (nx < W - 2.0) & (nz >= 1.0) & (nz < H - 2.0)
            if not alive.any():
                break
            nx = np.clip(nx, 1.0, W - 2.0); nz = np.clip(nz, 1.0, H - 2.0)
            nh, _, _, _, _, _, _ = _bilinear(h, nx, nz)
            dh = nh - hh
            cap = np.maximum(-dh, min_slope) * speed * water * capacity
            pf = 1.0
            if protect is not None:
                pf = 1.0 - protect[iz, ix]
            deposit_mask = (sediment > cap) | (dh > 0)
            dep = np.where(dh > 0, np.minimum(dh, sediment), (sediment - cap) * deposit_speed)
            dep = np.where(deposit_mask & alive, dep, 0.0) * pf
            ero = np.minimum((cap - sediment) * erode_speed, -dh)
            ero = np.where((~deposit_mask) & alive, np.maximum(ero, 0.0), 0.0) * pf
            # scatter: deposit bilinearly on the old cell, erode a disc around it; one bincount per step
            idx_list = []; val_list = []
            if dep.any():
                idx_list += [iz * W + ix, iz * W + ix + 1, (iz + 1) * W + ix, (iz + 1) * W + ix + 1]
                val_list += [dep * (1 - fx) * (1 - fz), dep * fx * (1 - fz), dep * (1 - fx) * fz, dep * fx * fz]
            if ero.any():
                sel = ero > 0
                ez = iz[sel]; ex = ix[sel]; e = ero[sel]
                for ox, oz, w in offs:
                    zz = np.clip(ez + oz, 0, H - 1); xx = np.clip(ex + ox, 0, W - 1)
                    idx_list.append(zz * W + xx); val_list.append(-e * w)
            if idx_list:
                acc = np.bincount(np.concatenate(idx_list), weights=np.concatenate(val_list), minlength=H * W)
                h += acc.reshape(H, W)
            sediment = sediment - dep + ero
            speed = np.sqrt(np.maximum(speed * speed + dh * gravity * -1.0, 0.0))
            water *= (1.0 - evaporate)
            px = nx; pz = nz
        done += n
        if log:
            log("  erosion: %d / %d droplets" % (done, n_drops))
    return h


def thermal(h, iterations=30, talus_tan=0.7, rate=0.5, protect=None):
    """Thermal weathering: material slides from cells to lower 8-neighbours where the slope exceeds the talus
    angle (talus_tan can be a per-cell array).  Conservative (mass moves, not created)."""
    H, W = h.shape
    tt = talus_tan if np.ndim(talus_tan) else np.full_like(h, talus_tan)
    for _ in range(iterations):
        delta = np.zeros_like(h)
        for oz, ox, dist in ((0, 1, 1.0), (1, 0, 1.0), (1, 1, 1.41421), (1, -1, 1.41421)):
            # compare each cell with its neighbour at (+oz, +ox)
            a = h[max(0, -oz):H - max(0, oz), max(0, -ox):W - max(0, ox)]
            b = h[max(0, oz):H - max(0, -oz), max(0, ox):W - max(0, -ox)]
            ta = tt[max(0, -oz):H - max(0, oz), max(0, -ox):W - max(0, ox)]
            tb = tt[max(0, oz):H - max(0, -oz), max(0, ox):W - max(0, -ox)]
            diff = a - b
            lim = np.where(diff > 0, ta, tb) * dist
            excess = np.abs(diff) - lim
            # each cell takes part in 8 pairs; limit the per-pair share so the total never overshoots (stable)
            move = np.where(excess > 0, np.sign(diff) * excess * (rate / 8.0), 0.0)
            da = delta[max(0, -oz):H - max(0, oz), max(0, -ox):W - max(0, ox)]
            db = delta[max(0, oz):H - max(0, -oz), max(0, ox):W - max(0, -ox)]
            da -= move; db += move
        if protect is not None:
            delta *= (1.0 - protect)
        h += delta
    return h


def flow_accumulation(h):
    """D8 flow accumulation (cells draining through each cell, including itself).  Pits terminate."""
    H, W = h.shape
    n = H * W
    hp = np.pad(h, 1, mode='edge')
    best = np.zeros((H, W)); rcv = np.full((H, W), -1, dtype=np.int64)
    idx = np.arange(n).reshape(H, W)
    for oz, ox in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
        nb = hp[1 + oz:1 + oz + H, 1 + ox:1 + ox + W]
        dist = 1.41421 if (oz and ox) else 1.0
        slope = (h - nb) / dist
        better = slope > best
        best = np.where(better, slope, best)
        rz = np.clip(np.arange(H)[:, None] + oz, 0, H - 1); rx = np.clip(np.arange(W)[None, :] + ox, 0, W - 1)
        cand = idx[rz, rx]
        rcv = np.where(better, cand, rcv)
    order = np.argsort(-h.ravel(), kind='stable').tolist()
    rl = rcv.ravel().tolist()
    acc = [1.0] * n
    for i in order:
        r = rl[i]
        if r >= 0:
            acc[r] += acc[i]
    return np.array(acc).reshape(H, W), rcv


def slope_map(h, cell=1.0):
    gz, gx = np.gradient(h, cell)
    return np.sqrt(gx * gx + gz * gz), gx, gz


def normals(h, cell=1.0):
    gz, gx = np.gradient(h, cell)
    n = np.stack([-gx, np.ones_like(h), -gz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def curvature(h, sigma=3.0):
    from scipy.ndimage import gaussian_filter, laplace
    return laplace(gaussian_filter(h, sigma))
