"""Core DSP primitives for the offline sound-effect synthesiser (numpy + scipy only).

Everything works on float64 mono arrays at SR. Time-varying filters run block-wise (32 samples) with state carried
between blocks, oscillators are polyBLEP band-limited, noise colours are shaped in the frequency domain.
"""
import numpy as np
from scipy.signal import lfilter, fftconvolve

SR = 44100
EPS = 1e-5


# ------------------------------------------------------------------------------------------------------- helpers
def sec(t: float) -> int:
    return max(0, int(round(t * SR)))


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def db(x: float) -> float:
    """dB -> linear."""
    return 10.0 ** (x / 20.0)


def to_db(x: float) -> float:
    return 20.0 * np.log10(max(abs(x), 1e-12))


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
    if len(x) >= n:
        return x
    return np.concatenate([x, np.zeros(n - len(x))])


def mix_into(dst: np.ndarray, src: np.ndarray, at: int = 0, gain: float = 1.0) -> np.ndarray:
    """Add src into dst at sample offset `at`, growing dst if needed. Returns the (possibly new) dst."""
    if at < 0:
        src = src[-at:]
        at = 0
    end = at + len(src)
    if end > len(dst):
        dst = pad_to(dst, end)
    dst[at:end] += src * gain
    return dst


# ------------------------------------------------------------------------------------------------------- noise
def white(rng, n: int) -> np.ndarray:
    return rng.standard_normal(n)


def _spectral_noise(rng, n: int, slope: float, lo_hz: float = 20.0) -> np.ndarray:
    """Gaussian noise with a 1/f^slope power spectrum (slope 1 = pink, 2 = brown) below lo_hz flattened."""
    m = max(n, 64)
    spec = rng.standard_normal(m // 2 + 1) + 1j * rng.standard_normal(m // 2 + 1)
    f = np.fft.rfftfreq(m, 1.0 / SR)
    f = np.maximum(f, lo_hz)
    spec *= f ** (-slope / 2.0)
    spec[0] = 0.0
    y = np.fft.irfft(spec, m)[:n]
    y /= (np.std(y) + 1e-9)
    return y


def pink(rng, n: int) -> np.ndarray:
    return _spectral_noise(rng, n, 1.0, 30.0)


def brown(rng, n: int) -> np.ndarray:
    return _spectral_noise(rng, n, 2.0, 40.0)


def crackle(rng, n: int, density: float = 900.0, tilt: float = 0.5) -> np.ndarray:
    """Sparse random impulses (Poisson, `density` per second) with a heavy-tailed amplitude distribution."""
    y = np.zeros(n)
    k = max(1, int(density * n / SR))
    idx = rng.integers(0, n, k)
    amp = rng.standard_normal(k) * (rng.random(k) ** 2.2 + 0.05)
    np.add.at(y, idx, amp)
    if tilt > 0:
        y = lfilter([1.0], [1.0, -tilt], y)  # a little body under each tick
    y /= (np.std(y) + 1e-9)
    return y


def noise(rng, n: int, kind: str = "white") -> np.ndarray:
    if kind == "white":
        return white(rng, n)
    if kind == "pink":
        return pink(rng, n)
    if kind == "brown":
        return brown(rng, n)
    if kind == "crackle":
        return crackle(rng, n)
    if kind == "crackle_fine":
        return crackle(rng, n, 4000.0, 0.2)
    if kind == "crackle_coarse":
        return crackle(rng, n, 220.0, 0.7)
    raise ValueError(kind)


# ------------------------------------------------------------------------------------------------------- envelopes
def curve_seg(n: int, a: float, b: float, kind: str = "lin") -> np.ndarray:
    if n <= 0:
        return np.zeros(0)
    t = np.linspace(0.0, 1.0, n, endpoint=False)
    if kind == "exp":
        a2 = max(a, EPS)
        b2 = max(b, EPS)
        return a2 * (b2 / a2) ** t
    if kind == "cos":
        return a + (b - a) * (0.5 - 0.5 * np.cos(np.pi * t))
    return a + (b - a) * t


def breakpoints(pts, n: int = None) -> np.ndarray:
    """pts = [(t_sec, value, curve)] with curve applying to the segment ending at that point. Returns per-sample envelope."""
    segs = []
    last_t, last_v = 0.0, float(pts[0][1]) if pts and pts[0][0] == 0 else 0.0
    if pts and pts[0][0] == 0:
        pts = pts[1:]
    for p in pts:
        t, v = float(p[0]), float(p[1])
        kind = p[2] if len(p) > 2 else "lin"
        m = sec(t) - sec(last_t)
        segs.append(curve_seg(m, last_v, v, kind))
        last_t, last_v = t, v
    e = np.concatenate(segs) if segs else np.zeros(0)
    if n is not None:
        e = pad_to(e, n)[:n] if len(e) >= n else np.concatenate([e, np.full(n - len(e), last_v)])
    return e


def env(n: int, atk: float = 0.003, hold: float = 0.0, dec: float = None, curve: str = "exp", peak: float = 1.0,
        hold_level: float = 0.9) -> np.ndarray:
    """attack -> optional hold -> decay to silence over the remaining samples."""
    na = min(n, sec(atk))
    nh = min(n - na, sec(hold))
    nd = n - na - nh
    parts = [curve_seg(na, 0.0, peak, "lin")]
    if nh > 0:
        parts.append(curve_seg(nh, peak, peak * hold_level, "lin"))
    start = peak * hold_level if nh > 0 else peak
    if curve == "exp":
        floor = 3e-4 * max(start, EPS)
        d = curve_seg(nd, start, floor, "exp")
        d = (d - floor) * (start / max(start - floor, EPS))  # ends at a true zero
        parts.append(d)
    elif curve == "cos":
        parts.append(curve_seg(nd, start, 0.0, "cos"))
    else:
        parts.append(curve_seg(nd, start, 0.0, "lin"))
    e = np.concatenate(parts)
    return e[:n]


def sweep(n: int, f0: float, f1: float, kind: str = "exp", frac: float = 1.0) -> np.ndarray:
    """Per-sample frequency trajectory from f0 to f1 over `frac` of the length, then held."""
    m = max(1, int(n * frac))
    s = curve_seg(m, f0, f1, kind)
    if m < n:
        s = np.concatenate([s, np.full(n - m, f1)])
    return s[:n]


# ------------------------------------------------------------------------------------------------------- oscillators
def _polyblep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    out = np.zeros_like(t)
    m1 = t < dt
    tt = t[m1] / dt[m1]
    out[m1] = tt + tt - tt * tt - 1.0
    m2 = t > 1.0 - dt
    tt = (t[m2] - 1.0) / dt[m2]
    out[m2] = tt * tt + tt + tt + 1.0
    return out


def osc(n: int, freq, kind: str = "sine", phase: float = 0.0, rng=None, jitter: float = 0.0) -> np.ndarray:
    """Band-limited oscillator. `freq` is a float or a per-sample array (Hz). jitter adds per-cycle pitch noise (0..0.05)."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,)).copy()
    if jitter > 0 and rng is not None:
        # slow random walk of pitch: smooth noise at ~30 Hz
        k = max(2, n // 1470)
        w = rng.standard_normal(k + 2)
        w = np.interp(np.linspace(0, k + 1, n), np.arange(k + 2), w)
        f *= 1.0 + jitter * w
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    if kind == "sine":
        return np.sin(2 * np.pi * ph)
    if kind == "triangle":
        return 2.0 * np.abs(2.0 * ph - 1.0) - 1.0
    if kind == "sawtooth":
        return (2.0 * ph - 1.0) - _polyblep(ph, dt)
    if kind == "square":
        sq = np.where(ph < 0.5, 1.0, -1.0)
        return sq + _polyblep(ph, dt) - _polyblep((ph + 0.5) % 1.0, dt)
    if kind == "pulse":  # narrow pulse (glottal-ish), ~12% duty, band-limited by a one-pole
        p = np.where(ph < 0.12, 1.0, -0.136)
        return lfilter([0.5], [1.0, -0.5], p)
    raise ValueError(kind)


def fm_osc(n: int, freq, ratio: float = 1.5, index=2.0, kind: str = "sine", mkind: str = "sine") -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    idx = np.broadcast_to(np.asarray(index, dtype=float), (n,))
    mod = osc(n, f * ratio, mkind)
    car_f = f + idx * f * mod
    car_f = np.maximum(car_f, 1.0)
    return osc(n, car_f, kind)


# ------------------------------------------------------------------------------------------------------- filters
def _coeffs(kind: str, f: np.ndarray, q: float):
    """Vectorised RBJ biquad coefficients for arrays of frequencies."""
    f = np.clip(np.asarray(f, dtype=float), 10.0, SR * 0.47)
    w0 = 2 * np.pi * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    if kind == "lowpass":
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
    elif kind == "highpass":
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
    elif kind == "bandpass":  # constant peak gain
        b0 = alpha; b1 = np.zeros_like(alpha); b2 = -alpha
    elif kind == "notch":
        b0 = np.ones_like(alpha); b1 = -2 * cw; b2 = np.ones_like(alpha)
    elif kind == "peak":  # q as bandwidth, gain fixed +12 dB
        A = db(12) ** 0.5
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
        return np.stack([b0 / a0, b1 / a0, b2 / a0]), np.stack([np.ones_like(a0), a1 / a0, a2 / a0])
    else:
        raise ValueError(kind)
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    return np.stack([b0 / a0, b1 / a0, b2 / a0]), np.stack([np.ones_like(a0), a1 / a0, a2 / a0])


def biquad(x: np.ndarray, kind: str, freq, q: float = 0.707, block: int = 32) -> np.ndarray:
    """Biquad with a fixed or per-sample-array cutoff. Arrays are applied block-wise with carried state."""
    n = len(x)
    if n == 0:
        return x
    if np.isscalar(freq):
        b, a = _coeffs(kind, np.array([freq]), q)
        return lfilter(b[:, 0], a[:, 0], x)
    freq = np.asarray(freq, dtype=float)
    centres = freq[np.minimum(np.arange(0, n, block) + block // 2, n - 1)]
    b, a = _coeffs(kind, centres, q)
    y = np.empty(n)
    zi = np.zeros(2)
    for k, i in enumerate(range(0, n, block)):
        y[i:i + block], zi = lfilter(b[:, k], a[:, k], x[i:i + block], zi=zi)
    return y


def lowpass(x, f, q=0.707):
    return biquad(x, "lowpass", f, q)


def highpass(x, f, q=0.707):
    return biquad(x, "highpass", f, q)


def bandpass(x, f, q=1.0):
    return biquad(x, "bandpass", f, q)


def onepole_lp(x: np.ndarray, f: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * f / SR)
    return lfilter([1 - a], [1, -a], x)


def onepole_hp(x: np.ndarray, f: float) -> np.ndarray:
    return x - onepole_lp(x, f)


def tilt(x: np.ndarray, lo_gain_db: float, hi_gain_db: float, f: float = 1000.0) -> np.ndarray:
    lo = onepole_lp(x, f)
    return lo * db(lo_gain_db) + (x - lo) * db(hi_gain_db)


def shelf_hi(x: np.ndarray, f: float, gain_db: float) -> np.ndarray:
    hi = x - onepole_lp(x, f)
    return x + hi * (db(gain_db) - 1.0)


def comb(x: np.ndarray, delay_s: float, fb: float = 0.5, damp_hz: float = 4000.0) -> np.ndarray:
    """Feedback comb (resonator) — used for tubes, barrels, metal bodies."""
    d = max(1, sec(delay_s))
    n = len(x)
    y = np.zeros(n + d)
    a = np.exp(-2 * np.pi * damp_hz / SR)
    st = 0.0
    # block form: process d samples at a time (exact since feedback delay is d)
    xp = pad_to(x, n + d)
    for i in range(0, n + d, d):
        j = min(i + d, n + d)
        prev = y[i - d:j - d] if i >= d else np.zeros(j - i)
        # one-pole damping on the fed-back block
        filt, zf = lfilter([1 - a], [1, -a], prev, zi=[st])
        st = zf[0]
        y[i:j] = xp[i:j] + fb * filt
    return y[:n]


# ------------------------------------------------------------------------------------------------------- nonlinear
def saturate(x: np.ndarray, drive: float = 2.0, bias: float = 0.0) -> np.ndarray:
    """tanh soft clip with makeup; drive 1 = gentle, 8 = crunch. A little even-harmonic bias for 'analog'."""
    d = max(drive, 1e-3)
    y = np.tanh((x + bias) * d) - np.tanh(bias * d)
    return y / np.tanh(d)


def shaper(x: np.ndarray, k: float) -> np.ndarray:
    """Waveshaper matching the browser build's a.shaper(k): (1+k) x / (1 + k|x|)."""
    return (1.0 + k) * x / (1.0 + k * np.abs(x))


def bitcrush(x: np.ndarray, bits: float = 6.0, downsample: int = 1) -> np.ndarray:
    q = 2.0 ** (bits - 1)
    y = np.round(x * q) / q
    if downsample > 1:
        idx = (np.arange(len(y)) // downsample) * downsample
        y = y[idx]
    return y


def compress(x: np.ndarray, thresh_db: float = -12.0, ratio: float = 4.0, atk: float = 0.002, rel: float = 0.08) -> np.ndarray:
    """Simple feed-forward RMS-ish compressor (peak detector with attack/release), vectorised per 64-sample block."""
    n = len(x)
    block = 64
    envl = np.abs(x)
    # per-block peak
    m = int(np.ceil(n / block))
    peaks = np.zeros(m)
    for k in range(m):
        peaks[k] = envl[k * block:(k + 1) * block].max() if k * block < n else 0.0
    ga = np.exp(-block / (atk * SR))
    gr = np.exp(-block / (rel * SR))
    det = np.zeros(m)
    v = 0.0
    for k in range(m):
        p = peaks[k]
        v = ga * v + (1 - ga) * p if p > v else gr * v + (1 - gr) * p
        det[k] = v
    det_db = 20 * np.log10(np.maximum(det, 1e-9))
    over = np.maximum(det_db - thresh_db, 0.0)
    gain_db = -over * (1 - 1 / ratio)
    g = 10 ** (gain_db / 20)
    gs = np.repeat(g, block)[:n]
    return x * gs


# ------------------------------------------------------------------------------------------------------- utilities
def delay(x: np.ndarray, t: float, gain: float = 1.0) -> np.ndarray:
    d = sec(t)
    return np.concatenate([np.zeros(d), x * gain])


def fade(x: np.ndarray, fin: float = 0.002, fout: float = 0.01) -> np.ndarray:
    n = len(x)
    y = x.copy()
    ni = min(n, sec(fin))
    no = min(n, sec(fout))
    if ni > 0:
        y[:ni] *= np.linspace(0, 1, ni)
    if no > 0:
        y[n - no:] *= np.linspace(1, 0, no)
    return y


def dc_remove(x: np.ndarray) -> np.ndarray:
    return highpass(x, 18.0, 0.6)


def normalize(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    p = np.max(np.abs(x)) if len(x) else 0.0
    if p < 1e-9:
        return x
    return x * (db(peak_db) / p)


def rms_db(x: np.ndarray) -> float:
    return to_db(np.sqrt(np.mean(x * x)) if len(x) else 0.0)


def trim(x: np.ndarray, thresh_db: float = -66.0, pre: float = 0.0, post: float = 0.02) -> np.ndarray:
    """Cut leading/trailing silence (below thresh relative to full scale) keeping a little pad."""
    if len(x) == 0:
        return x
    a = np.abs(x)
    th = db(thresh_db)
    idx = np.nonzero(a > th)[0]
    if len(idx) == 0:
        return x[:sec(0.05)]
    i0 = max(0, idx[0] - sec(pre))
    i1 = min(len(x), idx[-1] + sec(post))
    return x[i0:i1]


def resample_rate(x: np.ndarray, rate) -> np.ndarray:
    """Playback-rate change (pitch and duration together). rate may be a per-sample array (the 'pr/pr1' sweep)."""
    n = len(x)
    if np.isscalar(rate):
        if abs(rate - 1.0) < 1e-6:
            return x
        m = int(n / rate)
        pos = np.arange(m) * rate
    else:
        r = np.asarray(rate, dtype=float)
        pos = np.cumsum(r)
        pos = pos[pos < n - 1]
    return np.interp(pos, np.arange(n), x)


def stretch_env(x: np.ndarray, n: int) -> np.ndarray:
    """Resample x to exactly n samples (used for slow control signals)."""
    if len(x) == n:
        return x
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)


def smooth(x: np.ndarray, t: float = 0.005) -> np.ndarray:
    k = max(1, sec(t))
    if k <= 1:
        return x
    ker = np.hanning(k)
    ker /= ker.sum()
    return fftconvolve(x, ker, mode="same")


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    if len(ir) == 0 or len(x) == 0:
        return x
    return fftconvolve(x, ir)


def loop_crossfade(x: np.ndarray, xf: float = 0.25) -> np.ndarray:
    """Make x seamlessly loopable: overlap-add the tail onto the head with an equal-power crossfade."""
    n = len(x)
    k = min(sec(xf), n // 3)
    if k <= 0:
        return x
    head = x[:k]
    tail = x[n - k:]
    t = np.linspace(0, 1, k)
    a = np.cos(t * np.pi / 2)
    b = np.sin(t * np.pi / 2)
    body = x[:n - k].copy()
    body[:k] = head * b + tail * a
    return body
