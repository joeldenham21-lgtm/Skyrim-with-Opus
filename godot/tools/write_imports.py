#!/usr/bin/env python3
"""Emit Godot .import files for every texture under assets/textures so they load as VRAM-compressed
CompressedTexture2D with mipmaps (a 4K laptop or a phone runs out of memory with uncompressed 2K sets).

  python3 tools/write_imports.py            # write/refresh .import files
  python3 tools/write_imports.py --import   # ...then run the Godot import and report timing and .ctex count

Rules: compress/mode=2 (VRAM compressed), high_quality=false, mipmaps on, normal_map=1 for *_normal*,
roughness/mode=0, size_limit=0, detect_3d/compress_to=0. Existing uids are preserved so scene references stay
valid; the [remap] path/dest_files are filled in by Godot on import.
"""
import argparse
import glob
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX = os.path.join(ROOT, "assets", "textures")
GODOT = os.environ.get("GODOT", "/tmp/claude-0/-home-user-Skyrim-with-Opus/4735b3e9-ed8f-54b0-979d-13b1690a1576/scratchpad/godot/Godot_v4.5-stable_linux.x86_64")

TEMPLATE = """[remap]

importer="texture"
type="CompressedTexture2D"
{uid}path="res://.godot/imported/{base}-{md5}.ctex"
metadata={{
"vram_texture": true
}}

[deps]

source_file="{res}"
dest_files=["res://.godot/imported/{base}-{md5}.ctex"]

[params]

compress/mode=2
compress/high_quality=false
compress/lossy_quality=0.7
compress/uastc_level=0
compress/rdo_quality_loss=0.0
compress/hdr_compression=1
compress/normal_map={normal}
compress/channel_pack=0
mipmaps/generate=true
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/channel_remap/red=0
process/channel_remap/green=1
process/channel_remap/blue=2
process/channel_remap/alpha=3
process/fix_alpha_border=true
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
"""


def res_path(p):
    return "res://" + os.path.relpath(p, ROOT).replace(os.sep, "/")


def md5_of_res(res):
    import hashlib
    return hashlib.md5(res.encode("utf-8")).hexdigest()


def write_import(path):
    res = res_path(path)
    imp = path + ".import"
    uid = ""
    if os.path.exists(imp):
        m = re.search(r'^uid="(uid://[^"]+)"', open(imp).read(), re.M)
        if m:
            uid = 'uid="%s"\n' % m.group(1)
    base = os.path.basename(path)
    is_normal = "_normal" in base
    text = TEMPLATE.format(uid=uid, base=base, md5=md5_of_res(res), res=res, normal=1 if is_normal else 0)
    old = open(imp).read() if os.path.exists(imp) else None
    if old != text:
        with open(imp, "w") as f:
            f.write(text)
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--import", dest="do_import", action="store_true")
    a = ap.parse_args()
    files = []
    for ext in ("webp", "png", "jpg"):
        files += glob.glob(os.path.join(TEX, "**", "*." + ext), recursive=True)
    files.sort()
    changed = sum(write_import(f) for f in files)
    print(f"[imports] {len(files)} textures, {changed} .import files written/updated")
    if a.do_import:
        t0 = time.time()
        lock = open("/tmp/radius-godot-import.lock", "w")
        try:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
        except Exception:
            pass
        r = subprocess.run([GODOT, "--headless", "--path", ROOT, "--import"], capture_output=True, text=True)
        dt = time.time() - t0
        try:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_UN)
        except Exception:
            pass
        # each source file must have exactly its own <basename>-<md5 of res path>.ctex
        imported = os.path.join(ROOT, ".godot", "imported")
        have, missing, total = 0, [], 0
        for f in files:
            res = res_path(f)
            ct = os.path.join(imported, "%s-%s.ctex" % (os.path.basename(f), md5_of_res(res)))
            if os.path.exists(ct):
                have += 1
                total += os.path.getsize(ct)
            else:
                missing.append(os.path.basename(f))
        print(f"[imports] godot --import took {dt:.1f}s ({dt / max(1, len(files)):.2f}s per texture); "
              f"{have}/{len(files)} .ctex present in .godot/imported, {total / 1048576:.1f} MB VRAM-compressed "
              f"(exit {r.returncode})")
        if missing:
            print("[imports] missing:", ", ".join(missing[:20]), "..." if len(missing) > 20 else "")
        err = [ln for ln in (r.stdout + r.stderr).splitlines() if "ERROR" in ln or "error" in ln.lower()]
        for ln in err[:10]:
            print("[imports]", ln)
    return 0


if __name__ == "__main__":
    sys.exit(main())
