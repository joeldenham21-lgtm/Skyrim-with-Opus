"""Deterministic 2D gradient noise on numpy grids (no external noise library).

All functions take float64 arrays x, y (any shape, same shape) in noise space and return arrays of the same
shape.  perlin() is in roughly [-1, 1]; fbm() and ridged() are normalised to the same range.
"""
import numpy as np

_TWO_PI_OVER_2_32 = 2.0 * np.pi / 4294967296.0


def _hash(ix, iy, seed):
    h = (ix * np.int64(374761393) + iy * np.int64(668265263) + np.int64(seed) * np.int64(1442695041)) & np.int64(0xFFFFFFFF)
    h = ((h ^ (h >> np.int64(13))) * np.int64(1274126177)) & np.int64(0xFFFFFFFF)
    h = (h ^ (h >> np.int64(16))) & np.int64(0xFFFFFFFF)
    return h


def hash01(ix, iy, seed=0):
    """White noise in [0, 1) for integer lattice arrays."""
    return _hash(np.asarray(ix, dtype=np.int64), np.asarray(iy, dtype=np.int64), seed).astype(np.float64) / 4294967296.0


def perlin(x, y, seed=0):
    x = np.asarray(x, dtype=np.float64); y = np.asarray(y, dtype=np.float64)
    x0 = np.floor(x); y0 = np.floor(y)
    fx = x - x0; fy = y - y0
    ix = x0.astype(np.int64); iy = y0.astype(np.int64)

    def g(dx, dy, ox, oy):
        a = _hash(ix + ox, iy + oy, seed).astype(np.float64) * _TWO_PI_OVER_2_32
        return np.cos(a) * dx + np.sin(a) * dy

    n00 = g(fx, fy, 0, 0); n10 = g(fx - 1.0, fy, 1, 0); n01 = g(fx, fy - 1.0, 0, 1); n11 = g(fx - 1.0, fy - 1.0, 1, 1)
    u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0)
    v = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0)
    nx0 = n00 + u * (n10 - n00); nx1 = n01 + u * (n11 - n01)
    return (nx0 + v * (nx1 - nx0)) * 1.4142


def fbm(x, y, octaves=5, lacunarity=2.0, gain=0.5, seed=0):
    out = np.zeros(np.broadcast(x, y).shape, dtype=np.float64)
    amp = 1.0; norm = 0.0; fx = 1.0
    for i in range(octaves):
        out += amp * perlin(x * fx + i * 17.31, y * fx - i * 9.17, seed + i * 101)
        norm += amp; amp *= gain; fx *= lacunarity
    return out / norm


def ridged(x, y, octaves=4, lacunarity=2.0, gain=0.5, seed=0, sharpness=1.0):
    """Ridged multifractal in [0, 1]: sharp crests, rounded valleys (mountain/rock outcrop shape)."""
    out = np.zeros(np.broadcast(x, y).shape, dtype=np.float64)
    amp = 1.0; norm = 0.0; fx = 1.0; weight = np.ones_like(out)
    for i in range(octaves):
        n = 1.0 - np.abs(perlin(x * fx + i * 5.7, y * fx + i * 3.1, seed + 977 * i))
        n = n ** (1.0 + sharpness)
        n *= weight
        weight = np.clip(n * 2.0, 0.0, 1.0)
        out += amp * n
        norm += amp; amp *= gain; fx *= lacunarity
    return out / norm


def warp(x, y, amount, scale, seed=0, octaves=3):
    """Domain warp: returns (x', y') displaced by fbm at `scale` (noise-space frequency) by up to `amount`."""
    wx = fbm(x * scale + 31.7, y * scale + 11.3, octaves, seed=seed + 11)
    wy = fbm(x * scale - 7.7, y * scale + 41.9, octaves, seed=seed + 23)
    return x + amount * wx, y + amount * wy


def worley(x, y, seed=0):
    """Cellular noise: distance to the nearest of one feature point per lattice cell, in [0, ~1.4]."""
    x = np.asarray(x, dtype=np.float64); y = np.asarray(y, dtype=np.float64)
    ix = np.floor(x).astype(np.int64); iy = np.floor(y).astype(np.int64)
    fx = x - ix; fy = y - iy
    best = np.full(x.shape, 9.0)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            px = hash01(ix + ox, iy + oy, seed) + ox
            py = hash01(ix + ox, iy + oy, seed + 7919) + oy
            d = (px - fx) ** 2 + (py - fy) ** 2
            best = np.minimum(best, d)
    return np.sqrt(best)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t
