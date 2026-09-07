"""Post-steps after the heightfield is written (cheap; re-runnable on their own):

  normal.png   RGB8 world-space normal of the 1 m heightfield ((n + 1) / 2), sampled by the terrain shader for
               per-pixel lighting on every LOD (the chunk meshes carry no normals of their own)
  noise.png    256^2 RGBA8 tileable value/fbm noise (four independent channels) for the shader's macro variation
  *.png.import Godot import settings for the data maps: lossless, mipmaps, no alpha-border fix (the alpha channels
               are data), no 3D detection (so nothing gets re-imported as VRAM-compressed by mistake)

Run: python3 tools/terragen/post.py  (or through gen_terrain.py)
"""
import hashlib
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from terragen.noise import fbm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'assets', 'terrain')

IMPORT_TEMPLATE = """[remap]

importer="texture"
type="CompressedTexture2D"
path="res://.godot/imported/{name}-{md5}.ctex"
metadata={{
"vram_texture": false
}}

[deps]

source_file="res://assets/terrain/{name}"
dest_files=["res://.godot/imported/{name}-{md5}.ctex"]

[params]

compress/mode=0
compress/high_quality=false
compress/lossy_quality=0.7
compress/uastc_level=0
compress/rdo_quality_loss=0.0
compress/hdr_compression=1
compress/normal_map=2
compress/channel_pack=0
mipmaps/generate={mips}
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/channel_remap/red=0
process/channel_remap/green=1
process/channel_remap/blue=2
process/channel_remap/alpha=3
process/fix_alpha_border=false
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
"""

ARRAY_TEMPLATE = """[remap]

importer="2d_array_texture"
type="CompressedTexture2DArray"
path="res://.godot/imported/{name}-{md5}.ctexarray"

[deps]

source_file="res://assets/terrain/{name}"
dest_files=["res://.godot/imported/{name}-{md5}.ctexarray"]

[params]

compress/mode=2
compress/high_quality={hq}
compress/hdr_compression=1
compress/channel_pack=0
mipmaps/generate=true
mipmaps/limit=-1
slices/horizontal={sx}
slices/vertical={sy}
"""


def _md5(name):
    return hashlib.md5(('res://assets/terrain/' + name).encode()).hexdigest()


def write_import(name, mips=True, kind='texture', slices=(4, 2), hq=False):
    """Write assets/terrain/<name>.import unless one with the same importer already exists."""
    path = os.path.join(OUT, name + '.import')
    if kind == 'texture':
        txt = IMPORT_TEMPLATE.format(name=name, md5=_md5(name), mips='true' if mips else 'false')
    else:
        txt = ARRAY_TEMPLATE.format(name=name, md5=_md5(name), sx=slices[0], sy=slices[1], hq='true' if hq else 'false')
    old = open(path).read() if os.path.exists(path) else ''
    # keep Godot's uid line if it already assigned one (stable references), replace everything else
    uid = ''
    for line in old.splitlines():
        if line.startswith('uid='):
            uid = line
    if uid:
        txt = txt.replace('\npath=', '\n' + uid + '\npath=', 1)
    if old.strip() != txt.strip():
        open(path, 'w').write(txt)


def normal_map(h):
    gz, gx = np.gradient(h, 1.0)
    n = np.stack([-gx, np.ones_like(h), -gz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def write_normal(h, log=print):
    n = normal_map(h)
    img = ((n * 0.5 + 0.5) * 255.0 + 0.5).clip(0, 255).astype(np.uint8)
    Image.fromarray(img, 'RGB').save(os.path.join(OUT, 'normal.png'), optimize=True)
    log('normal.png written (%dx%d)' % (h.shape[1], h.shape[0]))


def write_noise(log=print, size=256, seed=1987):
    """Four tileable channels: R fbm (4 oct), G fbm offset (5 oct, finer), B cellular-ish blotches, A high-frequency grain.
    Tiling is exact: the noise is evaluated on a torus by blending four offset copies."""
    u = (np.arange(size) + 0.5) / size
    U, V = np.meshgrid(u, u)

    def tileable(fn):
        # 4-corner blend on the torus (standard trick; ok for value noise at this scale)
        a = fn(U, V); b = fn(U - 1.0, V); c = fn(U, V - 1.0); d = fn(U - 1.0, V - 1.0)
        wa = (1 - U) * (1 - V); wb = U * (1 - V); wc = (1 - U) * V; wd = U * V
        return a * wa + b * wb + c * wc + d * wd

    r = tileable(lambda x, y: fbm(x * 4.0, y * 4.0, 4, seed=seed + 1))
    g = tileable(lambda x, y: fbm(x * 7.0 + 3.0, y * 7.0, 5, seed=seed + 2))
    bl = tileable(lambda x, y: fbm(x * 3.0 + 9.0, y * 3.0 + 4.0, 2, seed=seed + 3))
    b = np.clip((bl - bl.mean()) * 2.2 + 0.5, 0.0, 1.0)
    rng = np.random.default_rng(seed)
    a = rng.uniform(0.0, 1.0, (size, size))
    from scipy.ndimage import gaussian_filter
    a = gaussian_filter(a, 0.7, mode='wrap'); a = (a - a.min()) / (a.max() - a.min() + 1e-9)

    def norm01(v):
        return np.clip((v - v.min()) / (v.max() - v.min() + 1e-9), 0.0, 1.0)

    img = np.stack([norm01(r), norm01(g), b, a], axis=-1)
    Image.fromarray((img * 255.0 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'noise.png'), optimize=True)
    log('noise.png written')


def run(log=print):
    hp = os.path.join(OUT, 'height.f32')
    n = int(round(np.sqrt(os.path.getsize(hp) / 4)))
    h = np.fromfile(hp, dtype='<f4').reshape(n, n).astype(np.float64)
    write_normal(h, log)
    write_noise(log)
    for name in ('splat.png', 'splat2.png', 'flora.png', 'water.png', 'roads.png', 'biome.png', 'normal.png', 'noise.png'):
        write_import(name, mips=True)
    for name in ('preview.png', 'preview_flora.png'):
        write_import(name, mips=False)
    log('import files written')


if __name__ == '__main__':
    run()
