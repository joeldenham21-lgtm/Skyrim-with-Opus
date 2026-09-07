"""Verification: per-file measurements (assets/audio/sfx_report.json) and a contact sheet of spectrograms
(assets/audio/sfx_spectrograms.png) so a flat band of noise or a bare sine is visible at a glance.

Usage: python3 tools/sfxgen/report.py [--dir assets/audio] [--only prefix] [--sheet path] [--cols 8]
"""
import argparse
import json
import os
import sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, os.path.dirname(HERE))

FONT_PATHS = [
    os.path.join(HERE, "..", "..", "assets", "fonts", "ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _font(size: int):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def analyse(path: str) -> dict:
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    mono = x.mean(axis=1)
    n = len(mono)
    peak = float(np.max(np.abs(x))) if n else 0.0
    rms = float(np.sqrt(np.mean(mono ** 2))) if n else 0.0
    clip = int(np.sum(np.abs(x) >= 0.999))
    dc = float(np.mean(mono)) if n else 0.0
    # spectral centroid (Hz) over a magnitude spectrum of the whole file (windowed frames averaged)
    if n >= 2048:
        frames = np.lib.stride_tricks.sliding_window_view(mono, 2048)[::1024] * np.hanning(2048)
        mag = np.abs(np.fft.rfft(frames, axis=1)).mean(axis=0)
    else:
        mag = np.abs(np.fft.rfft(mono * np.hanning(n))) if n else np.zeros(1)
    f = np.fft.rfftfreq(2048 if n >= 2048 else max(n, 1), 1.0 / sr)
    cent = float(np.sum(f * mag) / (np.sum(mag) + 1e-12))
    # spectral flatness (geometric/arithmetic mean of power) — near 1 = white noise, near 0 = tonal
    p = mag ** 2 + 1e-14
    flat = float(np.exp(np.mean(np.log(p))) / np.mean(p))
    # crest factor, and how much energy sits in the first 50 ms (transient) vs the rest
    crest = float(peak / (rms + 1e-9))
    head = mono[: int(sr * 0.05)]
    trans = float(np.sum(head ** 2) / (np.sum(mono ** 2) + 1e-12)) if n else 0.0
    silence_lead = int(np.argmax(np.abs(mono) > 1e-3)) if n and np.any(np.abs(mono) > 1e-3) else n
    return {
        "duration": round(n / sr, 3), "sr": sr, "channels": x.shape[1], "peak_db": round(20 * np.log10(peak + 1e-12), 2),
        "rms_db": round(20 * np.log10(rms + 1e-12), 2), "centroid_hz": round(cent, 1), "flatness": round(flat, 4),
        "crest": round(crest, 2), "transient_ratio": round(trans, 3), "clipping": clip, "dc_offset": round(dc, 6),
        "lead_silence_ms": round(1000.0 * silence_lead / sr, 1), "bytes": os.path.getsize(path),
    }


def spectrogram(mono: np.ndarray, sr: int, w: int = 220, h: int = 110, fmax: float = 12000.0, nfft: int = 1024) -> Image.Image:
    """Log-frequency-ish magnitude spectrogram as an RGB image (dark ground, amber highs) with a waveform strip."""
    n = len(mono)
    if n < nfft:
        mono = np.concatenate([mono, np.zeros(nfft - n)])
        n = nfft
    hop = max(1, (n - nfft) // max(w - 1, 1))
    frames = np.lib.stride_tricks.sliding_window_view(mono, nfft)[::hop][:w] * np.hanning(nfft)
    mag = np.abs(np.fft.rfft(frames, axis=1))  # (frames, bins)
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    # log frequency axis 40 Hz .. fmax mapped onto h rows
    edges = np.geomspace(40.0, fmax, h + 1)
    rows = np.zeros((h, mag.shape[0]))
    for r in range(h):
        sel = (freqs >= edges[r]) & (freqs < edges[r + 1])
        if not np.any(sel):
            sel = np.argmin(np.abs(freqs - edges[r]))
            rows[r] = mag[:, sel]
        else:
            rows[r] = mag[:, sel].max(axis=1)
    dbimg = 20 * np.log10(rows + 1e-7)
    top = dbimg.max()
    dbimg = np.clip((dbimg - (top - 70.0)) / 70.0, 0.0, 1.0)
    dbimg = dbimg[::-1]  # high frequencies on top
    # colour map: black -> deep blue -> rust -> amber -> pale
    v = dbimg
    r = np.clip(v * 2.2 - 0.3, 0, 1) ** 0.9
    g = np.clip(v * 1.6 - 0.45, 0, 1) ** 1.1
    b = np.clip(0.55 - np.abs(v - 0.25) * 2.0, 0, 1) * 0.8 + np.clip(v * 3 - 2.4, 0, 1) * 0.7
    rgb = (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB")
    if img.size != (w, h):
        img = img.resize((w, h), Image.BILINEAR)
    # waveform strip
    strip = Image.new("RGB", (w, 22), (18, 18, 20))
    d = ImageDraw.Draw(strip)
    step = max(1, n // w)
    for i in range(w):
        seg = mono[i * step:(i + 1) * step]
        a = float(np.max(np.abs(seg))) if len(seg) else 0.0
        hh = int(a * 10)
        d.line([(i, 11 - hh), (i, 11 + hh)], fill=(224, 164, 88))
    out = Image.new("RGB", (w, h + 22), (0, 0, 0))
    out.paste(img, (0, 0))
    out.paste(strip, (0, h))
    return out


def contact_sheet(files, out_path: str, cols: int = 8, w: int = 220, h: int = 110, title: str = "RADIUS SFX"):
    font = _font(11)
    tile_h = h + 22 + 16
    rows = int(np.ceil(len(files) / cols))
    sheet = Image.new("RGB", (cols * (w + 6) + 6, rows * (tile_h + 6) + 30), (12, 12, 13))
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), "%s — %d files — log-f spectrogram 40 Hz..12 kHz, 70 dB range, waveform strip" % (title, len(files)), fill=(217, 211, 196), font=font)
    for i, path in enumerate(files):
        x, sr = sf.read(path, dtype="float64", always_2d=True)
        mono = x.mean(axis=1)
        tile = spectrogram(mono, sr, w, h)
        cx = 6 + (i % cols) * (w + 6)
        cy = 30 + (i // cols) * (tile_h + 6)
        sheet.paste(tile, (cx, cy))
        name = os.path.basename(path).replace(".ogg", "")
        d.text((cx, cy + h + 23), "%s %.2fs" % (name[:30], len(mono) / sr), fill=(200, 196, 184), font=font)
    sheet.save(out_path)
    return out_path


def run(audio_dir: str, only: str = None, sheet: str = None, cols: int = 8, report: str = None):
    files = sorted(f for f in os.listdir(audio_dir) if f.endswith(".ogg") and not f.startswith(("amb_", "music_")))
    if only:
        files = [f for f in files if f.startswith(only)]
    rep = {}
    problems = []
    for f in files:
        p = os.path.join(audio_dir, f)
        a = analyse(p)
        rep[f[:-4]] = a
        if a["clipping"] > 0:
            problems.append((f, "clipping x%d" % a["clipping"]))
        if abs(a["dc_offset"]) > 0.01:
            problems.append((f, "dc offset %.3f" % a["dc_offset"]))
        if a["lead_silence_ms"] > 60:
            problems.append((f, "lead silence %.0f ms" % a["lead_silence_ms"]))
        if a["flatness"] > 0.6 and a["duration"] > 0.3:
            problems.append((f, "very flat spectrum (noise band?) %.2f" % a["flatness"]))
    total = sum(a["bytes"] for a in rep.values())
    summary = {"files": len(rep), "total_bytes": total, "total_mb": round(total / 1e6, 2), "problems": ["%s: %s" % p for p in problems]}
    out = report or os.path.join(audio_dir, "sfx_report.json")
    with open(out, "w") as fh:
        json.dump({"summary": summary, "files": rep}, fh, indent=1, sort_keys=True)
    if sheet:
        contact_sheet([os.path.join(audio_dir, f) for f in files], sheet, cols)
    return summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "..", "..", "assets", "audio"))
    ap.add_argument("--only", default=None)
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--cols", type=int, default=8)
    a = ap.parse_args()
    s = run(a.dir, a.only, a.sheet, a.cols, a.report)
    print(json.dumps(s, indent=1))
