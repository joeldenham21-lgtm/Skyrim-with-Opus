"""Pack the eight terrain ground layers into three Texture2DArray sheets for the splat shader.

  assets/terrain/layers_alb.png   4 x 2 tiles of TILE^2: grass, dirt, mud, rock, gravel, asphalt, sand, moss (albedo sRGB, A = height)
  assets/terrain/layers_nml.png   same order, tangent-space normals (OpenGL Y+)
  assets/terrain/layers_orm.png   same order, R ambient occlusion, G roughness, B metallic
  assets/terrain/layers.json      per-layer source and tile size in metres (the shader's uniform table)

Sources are the PBR sets in assets/textures/<kind>/ (Contracts v1) resized to TILE; a layer whose set has not been
generated yet gets a deterministic procedural stand-in (coloured grain with a matching normal) so the terrain shader
always has a complete array. Re-run after the texture generator to replace the stand-ins.
Run: python3 tools/terragen/pack_layers.py [--tile 1024]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from terragen.noise import fbm, worley  # noqa: E402
from terragen.post import write_import  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
TEX = os.path.join(ROOT, 'assets', 'textures')
OUT = os.path.join(ROOT, 'assets', 'terrain')

# layer -> (candidate texture kinds in preference order, fallback albedo (sRGB 0..1), tile metres, roughness)
LAYERS = [
    ('grass', ['grass'], (0.43, 0.41, 0.22), 2.5, 0.92),
    ('dirt', ['dirt'], (0.40, 0.32, 0.21), 3.0, 0.9),
    ('mud', ['mud'], (0.22, 0.17, 0.12), 3.0, 0.55),
    ('rock', ['rock'], (0.43, 0.41, 0.38), 4.0, 0.85),
    ('gravel', ['gravel'], (0.50, 0.47, 0.42), 2.0, 0.88),
    ('asphalt', ['asphalt', 'road'], (0.26, 0.26, 0.27), 4.0, 0.8),
    ('sand', ['sand'], (0.60, 0.54, 0.40), 3.0, 0.85),
    ('moss', ['moss'], (0.25, 0.31, 0.14), 2.0, 0.95),
]


def find_set(kinds):
    for k in kinds:
        d = os.path.join(TEX, k)
        alb = None
        for ext in ('webp', 'png', 'jpg'):
            p = os.path.join(d, '%s_albedo.%s' % (k, ext))
            if os.path.exists(p):
                alb = p
                break
        if alb:
            def find(m):
                for ext in ('webp', 'png', 'jpg'):
                    p = os.path.join(d, '%s_%s.%s' % (k, m, ext))
                    if os.path.exists(p):
                        return p
                return None
            meta = {}
            mp = os.path.join(d, k + '.json')
            if os.path.exists(mp):
                try:
                    meta = json.load(open(mp))
                except Exception:
                    meta = {}
            return dict(kind=k, albedo=alb, normal=find('normal'), orm=find('orm'), height=find('height'), meta=meta)
    return None


def load_rgb(path, tile):
    im = Image.open(path).convert('RGB')
    if im.size != (tile, tile):
        im = im.resize((tile, tile), Image.LANCZOS)
    return np.asarray(im).astype(np.float64) / 255.0


def height_to_normal(hgt, strength):
    gy, gx = np.gradient(hgt)
    gx = np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1); gy = np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)
    n = np.stack([-gx * strength, gy * strength * -1.0, np.ones_like(hgt)], axis=-1)   # OpenGL Y+: +y = up in the image
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def fallback(name, col, rough, tile, seed):
    """Procedural stand-in: colour with two grain scales, blotches, a bump normal and AO from the bump."""
    u = (np.arange(tile) + 0.5) / tile
    U, V = np.meshgrid(u, u)

    def tor(fn):
        a = fn(U, V); b = fn(U - 1, V); c = fn(U, V - 1); d = fn(U - 1, V - 1)
        return a * (1 - U) * (1 - V) + b * U * (1 - V) + c * (1 - U) * V + d * U * V

    coarse = tor(lambda x, y: fbm(x * 6.0, y * 6.0, 4, seed=seed))
    fine = tor(lambda x, y: fbm(x * 40.0, y * 40.0, 3, seed=seed + 7))
    cells = tor(lambda x, y: worley(x * 14.0, y * 14.0, seed=seed + 3))
    base = np.array(col)[None, None, :]
    if name in ('rock', 'gravel', 'asphalt'):
        hgt = 0.6 * (1.0 - np.clip(cells, 0, 1)) + 0.3 * coarse + 0.15 * fine
    elif name == 'sand':
        hgt = 0.5 * coarse + 0.2 * fine + 0.1 * np.sin(U * 60.0 + coarse * 8.0)
    else:
        hgt = 0.5 * coarse + 0.35 * fine + 0.2 * cells
    hgt = (hgt - hgt.min()) / (hgt.max() - hgt.min() + 1e-9)
    tint = 1.0 + 0.28 * (coarse - coarse.mean()) + 0.16 * (fine - fine.mean())
    alb = np.clip(base * tint[..., None] * (0.82 + 0.36 * hgt[..., None]), 0.0, 1.0)
    if name == 'grass':
        alb[..., 1] *= 0.92 + 0.16 * cells   # olive/yellow variation
    if name == 'asphalt':
        alb *= (0.9 + 0.2 * (fine > 0.6))[..., None]
    nrm = height_to_normal(hgt, 2.5 if name in ('rock', 'gravel') else 1.2)
    ao = np.clip(0.75 + 0.25 * hgt, 0.0, 1.0)
    orm = np.stack([ao, np.full_like(hgt, rough) - 0.1 * hgt, np.zeros_like(hgt)], axis=-1)
    return np.concatenate([alb, hgt[..., None]], axis=-1), nrm, np.clip(orm, 0, 1)


def run(tile=1024, log=print):
    cols = 4; rows = 2
    sheets = {k: np.zeros((rows * tile, cols * tile, 4 if k == 'alb' else 3), dtype=np.float64) for k in ('alb', 'nml', 'orm')}
    info = []
    for i, (name, kinds, col, tile_m, rough) in enumerate(LAYERS):
        src = find_set(kinds)
        r, c = divmod(i, cols)
        sl = (slice(r * tile, (r + 1) * tile), slice(c * tile, (c + 1) * tile))
        if src:
            alb = load_rgb(src['albedo'], tile)
            hgt = load_rgb(src['height'], tile)[..., :1] if src['height'] else np.full((tile, tile, 1), 0.5)
            alb = np.concatenate([alb, hgt], axis=-1)
            nml = load_rgb(src['normal'], tile) if src['normal'] else np.tile(np.array([0.5, 0.5, 1.0]), (tile, tile, 1))
            orm = load_rgb(src['orm'], tile) if src['orm'] else np.tile(np.array([1.0, rough, 0.0]), (tile, tile, 1))
            tile_m = float(src['meta'].get('tile_m', tile_m))
            info.append(dict(layer=name, source=src['kind'], tile_m=tile_m, procedural=False))
            log('  %-8s <- %s (%.1f m)' % (name, src['kind'], tile_m))
        else:
            alb, nml, orm = fallback(name, col, rough, tile, 1987 + i * 13)
            info.append(dict(layer=name, source='procedural', tile_m=tile_m, procedural=True))
            log('  %-8s <- procedural stand-in (%.1f m)' % (name, tile_m))
        sheets['alb'][sl] = alb; sheets['nml'][sl] = nml; sheets['orm'][sl] = orm
    os.makedirs(OUT, exist_ok=True)
    for k, arr in sheets.items():
        name = 'layers_%s.png' % k
        Image.fromarray((np.clip(arr, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'RGBA' if arr.shape[-1] == 4 else 'RGB').save(os.path.join(OUT, name), optimize=False, compress_level=4)
        write_import(name, kind='array', slices=(cols, rows), hq=False)
    json.dump(dict(tile=tile, cols=cols, rows=rows, layers=info), open(os.path.join(OUT, 'layers.json'), 'w'), indent=1)
    log('layer sheets written (%d x %d tiles of %d)' % (cols, rows, tile))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--tile', type=int, default=1024)
    a = ap.parse_args()
    run(a.tile)
