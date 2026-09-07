"""Reverberation and distance: a block-processed feedback delay network (8 lines, Householder mixing, per-line damping),
synthetic impulse responses (early reflections, rooms, the outdoor 'field' with slapback off tree lines) and an air
absorption / smear model for far-away versions.
"""
import numpy as np
from scipy.signal import lfilter, fftconvolve
from . import dsp
from .dsp import SR, sec

_BASE = np.array([1051, 1249, 1373, 1499, 1621, 1777, 1931, 2053], dtype=float)  # ~24-47 ms, mutually prime-ish


def allpass(x: np.ndarray, delay_s: float, g: float = 0.6) -> np.ndarray:
    d = max(1, sec(delay_s))
    b = np.zeros(d + 1); a = np.zeros(d + 1)
    b[0] = -g; b[d] = 1.0
    a[0] = 1.0; a[d] = -g
    return lfilter(b, a, x)


def fdn(x: np.ndarray, rt60: float = 1.5, damp: float = 0.4, size: float = 1.0, rng=None, lines: int = 8,
        predelay: float = 0.0, diffuse: bool = True, tail: float = None) -> np.ndarray:
    """Wet-only FDN reverb. damp 0..1 = high-frequency loss per pass; size scales the delay lengths (0.5 closet, 3 hall)."""
    rng = rng if rng is not None else np.random.default_rng(7)
    n_in = len(x)
    if n_in == 0:
        return x
    tail = rt60 * 1.1 if tail is None else tail
    n = n_in + sec(tail) + sec(predelay)
    xin = np.concatenate([np.zeros(sec(predelay)), x, np.zeros(n - n_in - sec(predelay))])
    if diffuse:
        xin = allpass(allpass(xin, 0.0047, 0.62), 0.0017, 0.55)
    L = (_BASE[:lines] * size * (1.0 + rng.uniform(-0.03, 0.03, lines))).astype(int)
    L = np.maximum(L, 64)
    block = int(min(256, L.min()))
    g = 10.0 ** (-3.0 * L / (rt60 * SR))
    a = np.clip(0.15 + 0.8 * damp, 0.0, 0.97) * np.ones(lines)  # one-pole damping per line
    a *= rng.uniform(0.92, 1.0, lines)
    inj = np.where(np.arange(lines) % 2 == 0, 1.0, -1.0) * rng.uniform(0.7, 1.0, lines)
    outw = rng.uniform(0.7, 1.0, lines) * np.where(rng.random(lines) < 0.5, 1.0, -1.0)
    bufs = [np.zeros(int(l)) for l in L]
    st = np.zeros(lines)
    y = np.zeros(n)
    ar = np.arange(block)
    for t in range(0, n, block):
        m = min(block, n - t)
        xb = xin[t:t + m]
        R = np.empty((lines, m))
        idxs = []
        for i in range(lines):
            idx = (t + ar[:m]) % L[i]
            idxs.append(idx)
            R[i] = bufs[i][idx]
        Rd = np.empty_like(R)
        for i in range(lines):
            Rd[i], z = lfilter([1 - a[i]], [1, -a[i]], R[i], zi=[st[i]])
            st[i] = z[0]
        M = Rd * g[:, None]
        fb = M - (2.0 / lines) * M.sum(axis=0)[None, :]
        new = fb + inj[:, None] * xb[None, :]
        for i in range(lines):
            bufs[i][idxs[i]] = new[i]
        y[t:t + m] = (outw[:, None] * Rd).sum(axis=0)
    y *= 1.0 / np.sqrt(lines)
    return y


def early_ir(rng, count: int = 10, span: float = 0.06, lp: float = 4000.0, gain: float = 0.5) -> np.ndarray:
    n = sec(span) + 64
    ir = np.zeros(n)
    t = np.sort(rng.uniform(0.003, span, count))
    for tk in t:
        i = sec(tk)
        ir[i] += rng.uniform(0.3, 1.0) * np.exp(-tk / (span * 0.6)) * (1 if rng.random() < 0.6 else -1)
    ir = dsp.lowpass(ir, lp)
    return ir * gain


def outdoor_ir(rng, rt: float = 1.8, echoes: int = 5, span=(0.07, 0.55), lp: float = 1800.0, diffuse_gain: float = 0.35,
               echo_gain: float = 0.6, ground: float = 0.25) -> np.ndarray:
    """A field: a ground bounce, a few discrete low-passed slaps off tree lines and buildings (each smeared 15-60 ms),
    and a diffuse tail that darkens as it dies."""
    n = sec(rt) + sec(0.7)
    ir = np.zeros(n)
    ir[sec(0.004)] += ground
    ir[sec(0.009)] -= ground * 0.5
    for k in range(echoes):
        t0 = rng.uniform(span[0], span[1])
        i = sec(t0)
        w = sec(rng.uniform(0.015, 0.06))
        burst = dsp.white(rng, w) * dsp.env(w, 0.002, 0, curve="exp")
        f = rng.uniform(lp * 0.5, lp * 1.3)
        burst = dsp.lowpass(burst, f, 0.8)
        g = echo_gain * np.exp(-t0 / 0.32) * rng.uniform(0.5, 1.0)
        ir = dsp.mix_into(ir, burst * g / (np.max(np.abs(burst)) + 1e-9), i)
    m = sec(rt)
    tl = dsp.pink(rng, m) * dsp.env(m, 0.01, 0, curve="exp")
    cut = dsp.sweep(m, 2600.0, 220.0, "exp", 0.8)
    tl = dsp.biquad(tl, "lowpass", cut, 0.7)
    tl *= diffuse_gain / (np.max(np.abs(tl)) + 1e-9)
    ir = dsp.mix_into(ir, tl, sec(0.02))
    return ir[:n]


def room_ir(rng, rt60: float = 0.5, size: float = 1.0, damp: float = 0.4, early: float = 0.5) -> np.ndarray:
    n = sec(rt60 * 1.2) + sec(0.05)
    imp = np.zeros(n); imp[0] = 1.0
    ir = fdn(imp, rt60, damp, size, rng, tail=rt60 * 0.2)[:n]
    ir = dsp.mix_into(ir, early_ir(rng, 8, 0.03 * size, 5000.0, early), 0)
    return ir / (np.max(np.abs(ir)) + 1e-9)


def _unit(ir: np.ndarray) -> np.ndarray:
    return ir / (np.sqrt(np.sum(ir * ir)) + 1e-12)


# preset spaces: name -> (unit-energy IR, wet level in dB relative to the dry energy, dry gain)
SPACES = {
    "field": (lambda rng: outdoor_ir(rng, 1.9, 5, (0.08, 0.55), 1800.0, 0.35, 0.6), -10.0, 1.0),
    "field_big": (lambda rng: outdoor_ir(rng, 2.6, 7, (0.1, 0.8), 1400.0, 0.4, 0.7), -7.0, 1.0),
    "forest": (lambda rng: outdoor_ir(rng, 1.3, 9, (0.03, 0.3), 2600.0, 0.3, 0.45), -12.0, 1.0),
    "village": (lambda rng: outdoor_ir(rng, 1.5, 6, (0.04, 0.35), 2200.0, 0.35, 0.7), -9.0, 1.0),
    "bunker": (lambda rng: room_ir(rng, 1.1, 1.2, 0.35, 0.6), -2.0, 1.0),
    "room": (lambda rng: room_ir(rng, 0.45, 0.8, 0.5, 0.5), -8.0, 1.0),
    "hall": (lambda rng: room_ir(rng, 2.4, 2.4, 0.3, 0.4), -3.0, 1.0),
    "closet": (lambda rng: room_ir(rng, 0.18, 0.4, 0.6, 0.5), -12.0, 1.0),
    "distant": (lambda rng: outdoor_ir(rng, 3.2, 8, (0.15, 1.2), 900.0, 0.6, 0.8, 0.1), 4.0, 0.3),
}


def space(kind: str, rng):
    mk, wet_db, dry = SPACES[kind]
    return _unit(mk(rng)), wet_db, dry


def place(x: np.ndarray, kind: str, rng, wet_db: float = None, dry: float = None, rt_scale: float = 1.0) -> np.ndarray:
    """Dry + convolution with a unit-energy IR at `wet_db` (energy ratio). rt_scale shortens/lengthens the IR."""
    ir, w, d = space(kind, rng)
    if rt_scale < 1.0:
        m = max(64, int(len(ir) * rt_scale))
        ir = _unit(ir[:m] * dsp.env(m, 0.0, 0.0, curve="cos", peak=1.0) ** 0.35)
    elif rt_scale > 1.0:
        ir = _unit(dsp.resample_rate(ir, 1.0 / rt_scale))  # stretched: longer and a shade darker, like a bigger gun
    wet_db = w if wet_db is None else wet_db
    dry = d if dry is None else dry
    return dsp.mix_into(x * dry, fftconvolve(x, ir) * dsp.db(wet_db), 0)


def air(x: np.ndarray, metres: float, smear: bool = True, rng=None) -> np.ndarray:
    """Air absorption and turbulence for a source `metres` away: high-frequency loss, transient smear, slight LF lift."""
    rng = rng if rng is not None else np.random.default_rng(3)
    fc = 14000.0 / (1.0 + metres / 45.0)
    y = dsp.lowpass(x, max(fc, 250.0), 0.6)
    y = dsp.shelf_hi(y, max(fc * 0.5, 200.0), -6.0 * min(metres / 200.0, 1.0))
    if smear and metres > 20:
        k = sec(0.002 + 0.02 * min(metres / 400.0, 1.0))
        ker = dsp.white(rng, k) * dsp.env(k, 0.0005, 0, curve="exp")
        ker[0] += 1.5
        ker /= np.sum(np.abs(ker)) * 0.6
        y = fftconvolve(y, ker)
    return y


def far(x: np.ndarray, metres: float, rng, kind: str = "distant") -> np.ndarray:
    """The distant version of a loud event: absorbed, smeared, rolled through a long outdoor IR."""
    y = air(x, metres, True, rng)
    y = place(y, kind, rng)
    # the distant boom sits in the low mids; a little compression keeps the roll audible
    y = dsp.compress(y, -14.0, 3.0, 0.004, 0.25)
    return y
