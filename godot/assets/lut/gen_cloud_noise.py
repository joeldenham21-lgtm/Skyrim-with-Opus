#!/usr/bin/env python3
"""Generates assets/lut/cloud_noise.png: a tileable 512x512 RGBA noise atlas sampled by shaders/sky.gdshader for the
cloud layers (texture noise is far cheaper and better shaped than per-pixel hash noise).
  R  Perlin fBm, 5 octaves (base shape, warp)
  G  inverted Worley fBm, 3 octaves (billows)
  B  Perlin-Worley remap (the classic cumulus base shape)
  A  high-frequency inverted Worley, 3 octaves (edge erosion)
All layers are periodic on the texture so the sky can tile them freely. Deterministic; re-run with
python3 assets/lut/gen_cloud_noise.py."""
import os
import numpy as np
from PIL import Image

N = 512
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 1987


def fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def perlin(period, rng):
    """Periodic gradient noise on an N x N grid with `period` lattice cells per axis, in [-1, 1]."""
    ang = rng.random((period, period)) * 2.0 * np.pi
    gx, gy = np.cos(ang), np.sin(ang)
    xs = (np.arange(N) + 0.5) / N * period
    x, y = np.meshgrid(xs, xs, indexing="xy")
    xi, yi = np.floor(x).astype(int), np.floor(y).astype(int)
    xf, yf = x - xi, y - yi
    u, v = fade(xf), fade(yf)

    def dot(ix, iy, dx, dy):
        ix %= period; iy %= period
        return gx[iy, ix] * dx + gy[iy, ix] * dy

    n00 = dot(xi, yi, xf, yf)
    n10 = dot(xi + 1, yi, xf - 1.0, yf)
    n01 = dot(xi, yi + 1, xf, yf - 1.0)
    n11 = dot(xi + 1, yi + 1, xf - 1.0, yf - 1.0)
    nx0 = n00 + u * (n10 - n00)
    nx1 = n01 + u * (n11 - n01)
    return (nx0 + v * (nx1 - nx0)) * 1.4142


def perlin_fbm(period, octaves, rng, gain=0.5, lac=2.0):
    s = np.zeros((N, N)); a = 1.0; total = 0.0; p = period
    for _ in range(octaves):
        s += a * perlin(int(p), rng); total += a; a *= gain; p *= lac
    return s / total * 0.5 + 0.5


def worley(period, rng):
    """Periodic cellular noise: distance to the nearest feature point (one per cell), normalised to [0, 1]."""
    pts = rng.random((period, period, 2))
    xs = (np.arange(N) + 0.5) / N * period
    x, y = np.meshgrid(xs, xs, indexing="xy")
    xi, yi = np.floor(x).astype(int), np.floor(y).astype(int)
    best = np.full((N, N), 1e9)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx = (xi + dx) % period; cy = (yi + dy) % period
            px = (xi + dx) + pts[cy, cx, 0]; py = (yi + dy) + pts[cy, cx, 1]
            d = (px - x) ** 2 + (py - y) ** 2
            best = np.minimum(best, d)
    return np.clip(np.sqrt(best), 0.0, 1.0)


def worley_fbm(period, octaves, rng):
    s = np.zeros((N, N)); a = 1.0; total = 0.0; p = period
    for _ in range(octaves):
        s += a * (1.0 - worley(int(p), rng)); total += a; a *= 0.5; p *= 2
    return s / total


def remap(v, lo, hi, nlo, nhi):
    return nlo + (v - lo) / np.maximum(hi - lo, 1e-6) * (nhi - nlo)


def main():
    rng = np.random.default_rng(SEED)
    p = perlin_fbm(4, 5, rng)
    w = worley_fbm(6, 3, rng)
    pw = np.clip(remap(p, 1.0 - w, 1.0, 0.0, 1.0), 0.0, 1.0)     # perlin-worley
    pw = pw * 0.7 + w * 0.3
    hw = worley_fbm(16, 3, rng)
    # normalise each channel to use the full range
    def norm(c):
        lo, hi = np.percentile(c, 0.5), np.percentile(c, 99.5)
        return np.clip((c - lo) / (hi - lo), 0.0, 1.0)
    img = np.stack([norm(p), norm(w), norm(pw), norm(hw)], axis=-1)
    Image.fromarray((img * 255.0 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(HERE, "cloud_noise.png"))
    for i, n in enumerate("RGBA"):
        c = img[..., i]
        print("%s mean %.3f std %.3f" % (n, c.mean(), c.std()))


if __name__ == "__main__":
    main()
