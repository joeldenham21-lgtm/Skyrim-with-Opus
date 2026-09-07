#!/usr/bin/env python3
"""RADIUS — offline sound-effect synthesis. Renders every registered sound (tools/sfxgen/recipes_*.py) to
assets/audio/<name>[_N].ogg, writes assets/audio/sfx_manifest.json and runs the report (sfx_report.json + spectrogram
contact sheet). Deterministic: the RNG seed is derived from the name and variant index, so a re-run reproduces every
file bit for bit.

  python3 tools/gen_sfx.py                      # everything (4 processes, ~1 min incl. the report)
  python3 tools/gen_sfx.py --only fire_ak       # names starting with a prefix (comma list)
  python3 tools/gen_sfx.py --out /tmp/x --sheet # render elsewhere and build a sheet of just those
  python3 tools/gen_sfx.py --pages DIR          # also write paged full-size spectrogram sheets to DIR
  python3 tools/gen_sfx.py --list               # print the catalogue
"""
import argparse
import hashlib
import json
import os
import sys
import time
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from sfxgen import dsp, synth, catalog, report  # noqa: E402

ROOT = os.path.dirname(HERE)
AUDIO_DIR = os.path.join(ROOT, "assets", "audio")
QUALITY = 0.5  # soundfile compression_level for Vorbis (0 = best/largest, 1 = smallest); 0.5 ~ q0.45


def seed_for(name: str, i: int) -> int:
    h = hashlib.sha1(("radius-sfx:%s:%d" % (name, i)).encode()).digest()
    return int.from_bytes(h[:8], "little")


def post(x: np.ndarray, e) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1) if not e.stereo else x
    if not np.all(np.isfinite(x)):
        x = np.nan_to_num(x)
    if e.sat > 0:
        x = dsp.saturate(x, e.sat)
    if e.loop:
        x = dsp.dc_remove(x)
        x = dsp.loop_crossfade(x, min(0.35, len(x) / dsp.SR * 0.2))
        x = dsp.normalize(x, e.peak_db)
        return x
    x = dsp.dc_remove(x)
    x = dsp.trim(x, e.trim_db, 0.002, max(e.fade_out, 0.03))
    x = dsp.fade(x, 0.0008, e.fade_out)
    x = dsp.normalize(x, e.peak_db)
    return x


def write_ogg(path: str, x: np.ndarray) -> float:
    """Encode, decode, and if the codec overshoots full scale (it does on dense transients) pull the gain a hair and
    re-encode, so no decoded sample clips. Returns the gain applied."""
    g = 1.0
    for _ in range(3):
        sf.write(path, (x * g).astype(np.float32), dsp.SR, format="OGG", subtype="VORBIS", compression_level=QUALITY)
        y, _sr = sf.read(path, dtype="float32", always_2d=True)
        pk = float(np.max(np.abs(y))) if len(y) else 0.0
        if pk < 0.995:
            break
        g *= 0.985 / pk
    return g


def render_one(job):
    name, i, out_dir, nvar = job
    e = catalog.REG[name]
    rng = np.random.default_rng(seed_for(name, i))
    v = synth.Voice(rng, rate=float(rng.uniform(0.96, 1.04)) if nvar > 1 else 1.0)
    t0 = time.time()
    try:
        res = e.fn(v, i)
        x = v.render() if res is None else res
        x = post(x, e)
    except Exception as ex:  # report and keep going; the run fails at the end
        import traceback
        return {"name": name, "i": i, "error": "%s: %s\n%s" % (type(ex).__name__, ex, traceback.format_exc())}
    fname = "%s.ogg" % name if nvar == 1 else "%s_%d.ogg" % (name, i + 1)
    path = os.path.join(out_dir, fname)
    g = write_ogg(path, x)
    return {"name": name, "i": i, "file": fname, "seconds": round(len(x) / dsp.SR, 3), "bytes": os.path.getsize(path),
            "peak_db": round(dsp.to_db(np.max(np.abs(x)) * g), 2), "ms": int((time.time() - t0) * 1000), "regain": g}


def fix_loop_imports(out_dir: str, written: dict) -> int:
    """Godot's Ogg importer defaults to loop=false, so a looping bed restarts silent at the end of its buffer instead of
    wrapping. Every sound registered with loop=True gets loop=true written into its .ogg.import [params]; Godot keeps
    existing [params] across re-imports, so this survives. Returns how many files were changed."""
    changed = 0
    for name, files in written.items():
        e = catalog.REG.get(name)
        if e is None or not e.loop:
            continue
        for f in files:
            ip = os.path.join(out_dir, f + ".import")
            if not os.path.exists(ip):
                # not imported yet: leave a minimal stub, Godot fills in uid/path on the next --import
                with open(ip, "w") as fh:
                    fh.write('[remap]\n\nimporter="oggvorbisstr"\ntype="AudioStreamOggVorbis"\n\n[deps]\n\n'
                             'source_file="res://assets/audio/%s"\n\n[params]\n\nloop=true\nloop_offset=0\nbpm=0\n'
                             'beat_count=0\nbar_beats=4\n' % f)
                changed += 1
                continue
            txt = open(ip).read()
            if "loop=true" in txt:
                continue
            if "loop=false" in txt:
                open(ip, "w").write(txt.replace("loop=false", "loop=true", 1))
                changed += 1
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="comma list of name prefixes")
    ap.add_argument("--out", default=AUDIO_DIR)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--sheet", action="store_true", help="also render the spectrogram sheet (always on for a full run)")
    ap.add_argument("--pages", default=None, help="directory for paged full-size spectrogram sheets")
    ap.add_argument("--no-alias-copies", action="store_true")
    ap.add_argument("--no-report", action="store_true")
    a = ap.parse_args()
    names = sorted(catalog.REG)
    if a.only:
        pre = [p.strip() for p in a.only.split(",") if p.strip()]
        names = [n for n in names if any(n.startswith(p) for p in pre)]
    if a.list:
        for n in names:
            e = catalog.REG[n]
            print("%-28s x%d %-10s %6.1f dB %s%s" % (n, e.variants, e.cat, e.peak_db, "loop " if e.loop else "", e.desc))
        print("%d names, %d files, %d aliases" % (len(names), sum(catalog.REG[n].variants for n in names), len(catalog.ALIASES)))
        return
    os.makedirs(a.out, exist_ok=True)
    jobs = [(n, i, a.out, catalog.REG[n].variants) for n in names for i in range(catalog.REG[n].variants)]
    print("[gen_sfx] %d names, %d files, %d processes -> %s (modules: %s)" % (len(names), len(jobs), a.jobs, a.out, ", ".join(catalog.LOADED)), flush=True)
    t0 = time.time()
    written = {}
    errors = []
    total_bytes = 0
    done = 0
    regained = 0
    with Pool(a.jobs) as pool:
        for r in pool.imap_unordered(render_one, jobs, chunksize=2):
            done += 1
            if "error" in r:
                errors.append(r)
                print("[gen_sfx] ERROR %s_%d: %s" % (r["name"], r["i"] + 1, r["error"].splitlines()[0]), flush=True)
                continue
            written.setdefault(r["name"], []).append(r["file"])
            total_bytes += r["bytes"]
            regained += 1 if r["regain"] < 1.0 else 0
            if done % 100 == 0 or done == len(jobs):
                print("[gen_sfx] %d/%d  %.1f MB  %.0fs" % (done, len(jobs), total_bytes / 1e6, time.time() - t0), flush=True)
    for n in written:
        written[n].sort()
    # alias copies: names the game may ask for that resolve to another set (Audio.gd has no alias table)
    if not a.no_alias_copies:
        import shutil
        for al, spec in catalog.ALIASES.items():
            tgt = spec["to"]
            if tgt not in written or al in catalog.REG:
                continue
            if a.only and not any(al.startswith(p.strip()) for p in a.only.split(",")):
                continue
            files = []
            for k, f in enumerate(written[tgt]):
                dst = "%s.ogg" % al if len(written[tgt]) == 1 else "%s_%d.ogg" % (al, k + 1)
                shutil.copyfile(os.path.join(a.out, f), os.path.join(a.out, dst))
                files.append(dst)
            written[al] = files
    nloop = fix_loop_imports(a.out, written)
    if nloop:
        print("[gen_sfx] loop=true written into %d .import files (re-run --import for Godot to pick them up)" % nloop, flush=True)
    if not a.only:
        man = catalog.manifest(written, not a.no_alias_copies)
        man["generated_seconds"] = round(time.time() - t0, 1)
        man["total_bytes"] = total_bytes
        with open(os.path.join(a.out, "sfx_manifest.json"), "w") as fh:
            json.dump(man, fh, indent=1, sort_keys=False)
        print("[gen_sfx] manifest: %d names, %d files (incl. alias copies), %.1f MB rendered, %d re-gained for codec overshoot"
              % (man["count"], sum(len(f) for f in written.values()), total_bytes / 1e6, regained), flush=True)
    if errors:
        print("[gen_sfx] %d ERRORS" % len(errors))
        for r in errors:
            print(r["error"])
    if not a.no_report:
        sheet = os.path.join(a.out, "sfx_spectrograms.png") if (a.sheet or not a.only) else None
        s = report.run(a.out, None, sheet, cols=8, report=os.path.join(a.out, "sfx_report.json"), pages_dir=a.pages)
        print("[gen_sfx] report: %s" % json.dumps({k: v for k, v in s.items() if k != "problems"}))
        for p in s["problems"][:60]:
            print("[gen_sfx] problem: %s" % p)
    print("[gen_sfx] done in %.0fs" % (time.time() - t0))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
