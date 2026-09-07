"""Tileable water surface maps for shaders/water.gdshader (deterministic, offline).

  assets/terrain/water_normal.png  RGB tangent-space normal (OpenGL Y+), A = a foam/turbulence mask.
      Two summed bands of directional capillary waves plus a swirl term; tiles exactly at 8 m in world space.
  assets/terrain/water_ripple.png  RGBA: four phase-shifted rain-ring normal packs (RG = xy of ring 1/2 ... ) —
      R,G = ripple normal xy for phase A, B,A = ripple normal xy for phase B; the shader crossfades the two.

Run: python3 tools/terragen/water_tex.py   (or through gen_terrain.py)
"""
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from terragen.post import write_import  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'assets', 'terrain')


def _height_to_normal(h, strength):
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    n = np.stack([-gx * strength, -gy * strength, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def waves(size=512, seed=1987):
    """Sum of integer-frequency sines with random directions and phases: exactly tileable, no visible grid."""
    u = (np.arange(size) + 0.5) / size
    U, V = np.meshgrid(u, u)
    rng = np.random.default_rng(seed)
    h = np.zeros((size, size))
    for band, (nwaves, kmin, kmax, amp) in enumerate([(9, 1, 3, 1.0), (14, 3, 7, 0.45), (22, 7, 16, 0.16), (30, 16, 34, 0.05)]):
        for _ in range(nwaves):
            kx = int(rng.integers(-kmax, kmax + 1))
            ky = int(rng.integers(-kmax, kmax + 1))
            k = np.hypot(kx, ky)
            if k < kmin or k > kmax:
                continue
            ph = rng.uniform(0, 2 * np.pi)
            # sharpened crests (Gerstner-ish) for the two low bands
            w = np.sin(2 * np.pi * (kx * U + ky * V) + ph)
            if band == 0:
                w = np.sign(w) * np.abs(w) ** 0.75
            h += amp * w / max(k, 1.0) ** 0.35
    h = (h - h.mean()) / (h.std() + 1e-9)
    return h


def run(log=print):
    size = 512
    h = waves(size, 1987)
    n = _height_to_normal(h, 0.55)
    # foam / turbulence mask: crest tops plus a blotchy field
    from scipy.ndimage import gaussian_filter
    crest = np.clip((h - 0.55) * 0.9, 0.0, 1.0)
    blob = gaussian_filter(np.random.default_rng(7).uniform(0, 1, (size, size)), 9.0, mode='wrap')
    blob = (blob - blob.min()) / (blob.max() - blob.min() + 1e-9)
    foam = np.clip(0.55 * crest + 0.75 * blob ** 1.6, 0.0, 1.0)
    img = np.concatenate([n * 0.5 + 0.5, foam[..., None]], axis=-1)
    Image.fromarray((img * 255.0 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'water_normal.png'), optimize=True)
    write_import('water_normal.png', mips=True)

    # rain rings: two phase packs of concentric rings around jittered centres
    rng = np.random.default_rng(41)
    cells = 8
    out = []
    for phase in (0.0, 0.5):
        hh = np.zeros((size, size))
        u = (np.arange(size) + 0.5) / size
        U, V = np.meshgrid(u, u)
        for cj in range(cells):
            for ci in range(cells):
                cx = (ci + rng.uniform(0.2, 0.8)) / cells
                cy = (cj + rng.uniform(0.2, 0.8)) / cells
                t = (rng.uniform(0, 1) + phase) % 1.0
                r = np.minimum(np.minimum(np.abs(U - cx), np.abs(U - cx + 1)), np.abs(U - cx - 1))
                s = np.minimum(np.minimum(np.abs(V - cy), np.abs(V - cy + 1)), np.abs(V - cy - 1))
                d = np.hypot(r, s)
                rad = 0.02 + t * 0.10
                ring = np.exp(-((d - rad) / 0.010) ** 2) * (1.0 - t) * np.cos((d - rad) * 260.0)
                hh += ring
        out.append(_height_to_normal(hh, 0.9)[..., :2])
    pack = np.concatenate([out[0] * 0.5 + 0.5, out[1] * 0.5 + 0.5], axis=-1)
    Image.fromarray((np.clip(pack, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'water_ripple.png'), optimize=True)
    write_import('water_ripple.png', mips=True)
    log('water_normal.png + water_ripple.png written (%d^2)' % size)


if __name__ == '__main__':
    run()
