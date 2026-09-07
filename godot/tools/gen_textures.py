#!/usr/bin/env python3
"""RADIUS offline PBR texture generator.

Writes assets/textures/<kind>/<kind>_{albedo,normal,orm,height}.webp (2048^2, tileable), the card atlases in
assets/textures/cards/ and the decals in assets/textures/decals/. Deterministic (fixed seeds), re-runnable.

  python3 tools/gen_textures.py                # everything
  python3 tools/gen_textures.py concrete brick  # selected kinds
  python3 tools/gen_textures.py --preview       # also write 1024 preview sheets to .shots/texgen/
  python3 tools/gen_textures.py --size 1024     # quick low-res pass
  python3 tools/gen_textures.py --jobs 3
"""
import argparse
import json
import multiprocessing as mp
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
OUT = os.path.join(ROOT, "assets", "textures")
PREVIEW_DIR = os.path.join(ROOT, ".shots", "texgen")

from texgen import materials as MATS  # noqa: E402
from texgen import materials2 as MATS2  # noqa: E402
from texgen import maps as M  # noqa: E402

for _name in dir(MATS2):
    if not _name.startswith("_") and callable(getattr(MATS2, _name)) and not hasattr(MATS, _name):
        setattr(MATS, _name, getattr(MATS2, _name))

KINDS = [k for k in [
    "concrete", "plaster", "brick", "rust", "painted_metal", "gunmetal", "wood", "logs", "birch_bark", "pine_bark",
    "fabric", "leather", "rubber", "mud", "gravel", "road", "asphalt", "roof_tile", "roof_metal", "grass", "dirt",
    "rock", "sand", "moss", "tarp", "paper", "glass",
    # extras for structures
    "tiles", "wallpaper", "linoleum", "sheet_metal", "roof_slate", "camo", "bone", "canvas"]
    if hasattr(MATS, k) and callable(getattr(MATS, k))]


def gen_kind(args):
    kind, n, preview = args
    t0 = time.time()
    fn = getattr(MATS, kind)
    m = fn(n)
    nrm, ao = M.save_set(OUT, kind, m.albedo, m.height, m.rough, m.metal, normal_strength=m.normal_strength,
                         height_scale_m=m.height_m, tile_m=m.tile_m, ao_strength=m.ao_strength, extra_ao=m.ao_extra, meta=m.meta)
    if preview:
        import numpy as np
        orm = np.stack([ao, m.rough, m.metal], axis=-1)
        M.preview(os.path.join(PREVIEW_DIR, f"{kind}.png"), m.albedo, nrm, orm, m.height, size=1024)
    dt = time.time() - t0
    print(f"[texgen] {kind:14s} {n}^2  {dt:5.1f}s", flush=True)
    return kind, dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kinds", nargs="*")
    ap.add_argument("--size", type=int, default=2048)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--no-cards", action="store_true")
    ap.add_argument("--no-decals", action="store_true")
    ap.add_argument("--only-cards", action="store_true")
    ap.add_argument("--only-decals", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    kinds = a.kinds or KINDS
    for k in kinds:
        if k not in KINDS and k not in ("cards", "decals"):
            print(f"[texgen] unknown kind {k}; known: {', '.join(KINDS)}")
            return 1
    jobs = [(k, a.size, a.preview) for k in kinds if k in KINDS]
    if a.only_cards or a.only_decals:
        jobs = []
    if jobs:
        print(f"[texgen] {len(jobs)} material sets at {a.size}^2 with {a.jobs} workers", flush=True)
        if a.jobs > 1:
            with mp.Pool(a.jobs) as pool:
                for _ in pool.imap_unordered(gen_kind, jobs):
                    pass
        else:
            for j in jobs:
                gen_kind(j)
    if (not a.kinds or "cards" in a.kinds or a.only_cards) and not a.no_cards and not a.only_decals:
        from texgen import cards
        cards.generate(os.path.join(OUT, "cards"), a.size, preview_dir=PREVIEW_DIR if a.preview else None)
    if (not a.kinds or "decals" in a.kinds or a.only_decals) and not a.no_decals and not a.only_cards:
        from texgen import decals
        decals.generate(os.path.join(OUT, "decals"), preview_dir=PREVIEW_DIR if a.preview else None)
    # manifest of tile sizes for consumers
    manifest = {}
    for k in KINDS:
        p = os.path.join(OUT, k, f"{k}.json")
        if os.path.exists(p):
            with open(p) as f:
                manifest[k] = json.load(f)
    with open(os.path.join(OUT, "textures.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"[texgen] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
