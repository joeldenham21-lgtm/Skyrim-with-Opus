"""Periodic-loop DSP core for RADIUS music and ambience.

Everything in here works on buffers whose length *is* the loop period, and every operation preserves that
periodicity exactly:

  * noise is drawn in the frequency domain (random phase, shaped magnitude) so it wraps with no seam;
  * filtering is circular (multiply the rFFT by a magnitude curve) or a crossfade between a few such copies
    when a cutoff has to breathe;
  * LFO rates are quantised to an integer number of cycles per loop (`qf`);
  * oscillator frequencies are quantised to bin centres, so a sine ends exactly where it started;
  * one-shot events (notes, drips, ticks) are wrap-added, so a tail that runs past the end reappears at the
    front where it belongs;
  * reverb, delay and tape wow are circular too (circular convolution / `np.interp(..., period=n)`).

The consequence is that the last sample and the first sample are continuous *by construction*, not by a
crossfade: the loop-seam RMS discontinuity measured by report.py is limited only by the Vorbis codec.
"""
import numpy as np
from scipy.signal import lfilter

SR = 44100


# --------------------------------------------------------------------------------------------- basics
def nsec(seconds: float) -> int:
    """Loop length in samples for `seconds` (integer seconds keep the FFT sizes 5-smooth-ish and fast)."""
    return int(round(seconds * SR))


def db(x: float) -> float:
    return 10.0 ** (x / 20.0)


def to_db(x) -> float:
    return float(20.0 * np.log10(max(float(abs(x)), 1e-12)))


def bins(n: int) -> np.ndarray:
    """Frequency of every rFFT bin, Hz."""
    return np.fft.rfftfreq(n, 1.0 / SR)


def qf(f: float, n: int) -> float:
    """Snap a frequency to the nearest bin centre so it completes a whole number of cycles in the loop."""
    k = int(round(f * n / SR))
    if k < 1:
        k = 1
    return k * SR / n


def qlfo(rate: float, n: int) -> float:
    """Snap an LFO rate to a whole number of cycles per loop (may be as low as one)."""
    k = int(round(rate * n / SR))
    return max(1, k) * SR / n


def t_axis(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def sine(n: int, f: float, phase: float = 0.0, quant: bool = True) -> np.ndarray:
    f = qf(f, n) if quant else f
    return np.sin(2.0 * np.pi * f * t_axis(n) + phase)


def lfo(n: int, rate: float, phase: float = 0.0, lo: float = 0.0, hi: float = 1.0) -> np.ndarray:
    """A sine LFO mapped to [lo, hi], with a whole number of cycles per loop."""
    r = qlfo(rate, n)
    s = 0.5 + 0.5 * np.sin(2.0 * np.pi * r * t_axis(n) + phase)
    return lo + (hi - lo) * s


def wander(rng, n: int, rates, weights=None, lo: float = 0.0, hi: float = 1.0, power: float = 1.0) -> np.ndarray:
    """Sum of a handful of slow sines at unrelated rates -> a control signal that never repeats inside the loop
    but is still perfectly periodic. `power` shapes it (>1 = mostly low with occasional peaks)."""
    rates = list(rates)
    if weights is None:
        weights = [1.0 / (i + 1) for i in range(len(rates))]
    acc = np.zeros(n)
    wsum = 0.0
    for r, w in zip(rates, weights):
        acc += w * np.sin(2.0 * np.pi * qlfo(r, n) * t_axis(n) + rng.uniform(0, 2 * np.pi))
        wsum += abs(w)
    acc = 0.5 + 0.5 * acc / max(wsum, 1e-9)
    acc = np.clip(acc, 0.0, 1.0) ** power
    return lo + (hi - lo) * acc


# --------------------------------------------------------------------------------------------- magnitude curves
def lp(f: np.ndarray, fc: float, order: float = 2.0) -> np.ndarray:
    return 1.0 / np.sqrt(1.0 + (np.maximum(f, 1e-6) / max(fc, 1e-6)) ** (2.0 * order))


def hp(f: np.ndarray, fc: float, order: float = 2.0) -> np.ndarray:
    return 1.0 / np.sqrt(1.0 + (max(fc, 1e-6) / np.maximum(f, 1e-6)) ** (2.0 * order))


def _detune_axis(f: np.ndarray, fc: float, q: float) -> np.ndarray:
    """Q-scaled distance from fc in the usual resonator sense: 0 at fc, +-1 at the -3 dB points."""
    r = np.maximum(f, 1e-6) / max(fc, 1e-6)
    return q * (r - 1.0 / r)


def bp(f: np.ndarray, fc: float, q: float = 1.0) -> np.ndarray:
    """Two-pole resonant band-pass magnitude, unity at fc."""
    x = _detune_axis(f, fc, q)
    return 1.0 / np.sqrt(1.0 + x * x)


def notch(f: np.ndarray, fc: float, q: float = 4.0, depth: float = 1.0) -> np.ndarray:
    return 1.0 - depth * bp(f, fc, q)


def peak(f: np.ndarray, fc: float, q: float, gain_db: float) -> np.ndarray:
    """Peaking EQ magnitude (unity far from fc, `gain_db` at fc)."""
    g = db(gain_db)
    x = _detune_axis(f, fc, q)
    return 1.0 + (g - 1.0) / (1.0 + x * x)


def shelf_low(f: np.ndarray, fc: float, gain_db: float) -> np.ndarray:
    g = db(gain_db)
    return 1.0 + (g - 1.0) * lp(f, fc, 1.0)


def shelf_high(f: np.ndarray, fc: float, gain_db: float) -> np.ndarray:
    g = db(gain_db)
    return 1.0 + (g - 1.0) * hp(f, fc, 1.0)


def tilt(f: np.ndarray, slope_db_oct: float, pivot: float = 1000.0) -> np.ndarray:
    """A straight spectral slope (pink = -3 dB/oct, brown = -6)."""
    return db(slope_db_oct * np.log2(np.maximum(f, 20.0) / pivot))


# --------------------------------------------------------------------------------------------- circular filtering
def cfilt(x: np.ndarray, mag: np.ndarray) -> np.ndarray:
    """Zero-phase circular filtering: multiply the loop's spectrum by a magnitude curve."""
    if x.ndim == 2:
        return np.stack([cfilt(x[:, i], mag) for i in range(x.shape[1])], axis=1)
    return np.fft.irfft(np.fft.rfft(x) * mag, n=len(x))


def morph_lp(x: np.ndarray, f: np.ndarray, cutoffs, weights, order: float = 2.0) -> np.ndarray:
    """A low-pass whose cutoff breathes: crossfade between a few fixed circular low-passes.
    `weights` is a list of per-sample weight arrays (they are normalised here)."""
    tot = np.zeros(len(x))
    wsum = np.zeros(len(x))
    for w in weights:
        wsum += np.maximum(w, 0.0)
    wsum = np.maximum(wsum, 1e-9)
    for fc, w in zip(cutoffs, weights):
        tot += cfilt(x, lp(f, fc, order)) * (np.maximum(w, 0.0) / wsum)
    return tot


def morph_bank(x: np.ndarray, mags, weights) -> np.ndarray:
    """General version of morph_lp: crossfade between arbitrary circular filters."""
    tot = np.zeros(len(x))
    wsum = np.zeros(len(x))
    for w in weights:
        wsum += np.maximum(w, 0.0)
    wsum = np.maximum(wsum, 1e-9)
    for m, w in zip(mags, weights):
        tot += cfilt(x, m) * (np.maximum(w, 0.0) / wsum)
    return tot


def sweep_weights(ctrl: np.ndarray, points) -> list:
    """Turn a 0..1 control signal into crossfade weights over a ladder of `points` values (triangular basis)."""
    k = len(points)
    pos = np.clip(ctrl, 0.0, 1.0) * (k - 1)
    out = []
    for i in range(k):
        out.append(np.clip(1.0 - np.abs(pos - i), 0.0, 1.0))
    return out


# --------------------------------------------------------------------------------------------- noise
def spectral_noise(rng, n: int, mag: np.ndarray) -> np.ndarray:
    """Perfectly periodic noise with the given magnitude spectrum (random phase)."""
    m = n // 2 + 1
    ph = rng.uniform(0.0, 2.0 * np.pi, m)
    X = mag.astype(np.complex128) * np.exp(1j * ph)
    X[0] = 0.0
    if n % 2 == 0:
        X[-1] = X[-1].real
    x = np.fft.irfft(X, n)
    s = np.sqrt(np.mean(x * x))
    return x / max(s, 1e-12)


def noise(rng, n: int, slope: float = 0.0, lo: float = 20.0, hi: float = 20000.0, order: float = 2.0) -> np.ndarray:
    """Band-limited coloured noise. slope in dB/octave (0 white, -3 pink, -6 brown)."""
    f = bins(n)
    mag = tilt(f, slope) * hp(f, lo, order) * lp(f, hi, order)
    return spectral_noise(rng, n, mag)


def stereo_noise(rng, n: int, slope: float = 0.0, lo: float = 20.0, hi: float = 20000.0,
                 corr: float = 0.0) -> np.ndarray:
    """Two decorrelated noise channels; `corr` (0..1) mixes in a shared mono core."""
    a = noise(rng, n, slope, lo, hi)
    b = noise(rng, n, slope, lo, hi)
    if corr > 0.0:
        c = noise(rng, n, slope, lo, hi)
        a = a * (1.0 - corr) + c * corr
        b = b * (1.0 - corr) + c * corr
    return np.stack([a, b], axis=1)


# --------------------------------------------------------------------------------------------- events
def wrap_add(dst: np.ndarray, src: np.ndarray, at: int, gain: float = 1.0, pan: float = 0.0) -> None:
    """Add a (mono) event into a loop buffer at sample `at`, wrapping past the end. `pan` -1..1 for stereo dst."""
    n = len(dst)
    if len(src) == 0:
        return
    s = np.asarray(src, dtype=np.float64) * gain
    if len(s) > n:  # a tail longer than the loop folds onto itself, which is what a steady loop would do
        k = int(np.ceil(len(s) / n)) * n
        s = np.concatenate([s, np.zeros(k - len(s))]).reshape(-1, n).sum(axis=0)
    at %= n
    end = at + len(s)
    if dst.ndim == 2:
        gl = np.sqrt(0.5 * (1.0 - pan))
        gr = np.sqrt(0.5 * (1.0 + pan))
        if end <= n:
            dst[at:end, 0] += s * gl
            dst[at:end, 1] += s * gr
        else:
            k = n - at
            dst[at:, 0] += s[:k] * gl
            dst[at:, 1] += s[:k] * gr
            dst[:end - n, 0] += s[k:] * gl
            dst[:end - n, 1] += s[k:] * gr
    else:
        if end <= n:
            dst[at:end] += s
        else:
            k = n - at
            dst[at:] += s[:k]
            dst[:end - n] += s[k:]


def times(rng, n: int, count: int, jitter: float = 0.35, start: float = 0.0) -> list:
    """`count` event times spread over the loop with jitter, as sample indices (deterministic, no clumping)."""
    step = n / max(1, count)
    out = []
    for i in range(count):
        t = start * SR + (i + 0.5) * step + rng.uniform(-jitter, jitter) * step
        out.append(int(t) % n)
    return sorted(out)


def poisson_times(rng, n: int, rate_hz: float) -> np.ndarray:
    """Sample indices of a Poisson process over the loop (for rain, crackle, insects)."""
    count = max(1, int(round(rate_hz * n / SR)))
    return np.sort(rng.integers(0, n, size=count))


# --------------------------------------------------------------------------------------------- envelopes
def env_ar(n: int, attack: float, release: float, curve: float = 2.0) -> np.ndarray:
    """A one-shot attack/decay envelope of length n samples (attack linear-ish, release exponential-ish)."""
    a = max(1, int(attack * SR))
    x = np.zeros(n)
    a = min(a, n)
    x[:a] = np.linspace(0.0, 1.0, a) ** 0.7
    r = n - a
    if r > 0:
        tt = np.linspace(0.0, 1.0, r)
        x[a:] = np.exp(-curve * 3.0 * tt) * (1.0 - tt) ** 0.4
    return x


def env_pts(n: int, pts) -> np.ndarray:
    """Piecewise-linear envelope from [(t_seconds, value), ...] over n samples."""
    ts = np.array([p[0] for p in pts]) * SR
    vs = np.array([p[1] for p in pts], dtype=np.float64)
    return np.interp(np.arange(n), ts, vs, left=vs[0], right=vs[-1])


def hann_win(n: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / max(1, n - 1))


def raised(n: int, rise: float, fall: float) -> np.ndarray:
    """A window that fades in over `rise` seconds and out over `fall` (for Shepard-style overlapping voices)."""
    w = np.ones(n)
    a = min(n, max(1, int(rise * SR)))
    b = min(n - a, max(1, int(fall * SR)))
    w[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 0:
        w[n - b:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b)
    return w


# --------------------------------------------------------------------------------------------- reverb / delay
def make_ir(rng, seconds: float, rt_low: float = 3.0, rt_high: float = 0.9, predelay: float = 0.012,
            early: int = 14, damp_hz: float = 6500.0, spread: float = 1.0) -> np.ndarray:
    """A stereo impulse response: sparse early reflections plus a dense band-decaying tail.
    Built once per piece and applied with circular convolution, so the tail wraps the loop cleanly."""
    L = int(seconds * SR)
    f = bins(L)
    bands = [(20.0, 180.0, rt_low), (180.0, 800.0, rt_low * 0.82), (800.0, 3000.0, (rt_low + rt_high) * 0.45),
             (3000.0, 9000.0, rt_high), (9000.0, 18000.0, rt_high * 0.55)]
    t = np.arange(L) / SR
    out = np.zeros((L, 2))
    for ch in range(2):
        tail = np.zeros(L)
        for lo, hi, rt in bands:
            nz = spectral_noise(rng, L, hp(f, lo, 3.0) * lp(f, hi, 3.0))
            tail += nz * np.exp(-6.9078 * t / max(rt, 0.05))
        # early reflections: a handful of filtered taps before the tail takes over
        er = np.zeros(L)
        for i in range(early):
            d = int((predelay + rng.uniform(0.004, 0.09) * spread) * SR)
            if d < L:
                er[d] += rng.uniform(-1.0, 1.0) * (0.85 ** i)
        er = cfilt(er, lp(f, damp_hz * 1.4, 2.0) * hp(f, 90.0, 1.0))
        d0 = int(predelay * SR)
        tail = np.roll(tail, d0)
        tail[:d0] = 0.0
        ir = 0.55 * er + tail * np.linspace(0.0, 1.0, L) ** 0.25
        ir = cfilt(ir, lp(f, damp_hz, 2.0) * hp(f, 45.0, 1.0))
        out[:, ch] = ir
    out /= max(np.sqrt(np.sum(out * out)) / np.sqrt(2.0), 1e-9)
    return out


def creverb(x: np.ndarray, ir: np.ndarray, n: int) -> np.ndarray:
    """Circular convolution of a mono (or stereo) loop with a stereo IR -> stereo, still exactly periodic."""
    def fold(v):
        if len(v) <= n:
            return np.concatenate([v, np.zeros(n - len(v))])
        k = int(np.ceil(len(v) / n)) * n
        return np.concatenate([v, np.zeros(k - len(v))]).reshape(-1, n).sum(axis=0)

    IRL = np.fft.rfft(fold(ir[:, 0]))
    IRR = np.fft.rfft(fold(ir[:, 1]))
    if x.ndim == 1:
        X = np.fft.rfft(x)
        return np.stack([np.fft.irfft(X * IRL, n), np.fft.irfft(X * IRR, n)], axis=1)
    XL = np.fft.rfft(x[:, 0])
    XR = np.fft.rfft(x[:, 1])
    return np.stack([np.fft.irfft(XL * IRL, n), np.fft.irfft(XR * IRR, n)], axis=1)


def cdelay(x: np.ndarray, seconds: float, feedback: float = 0.35, mix: float = 0.3, damp: float = 4000.0):
    """Circular feedback delay (the repeats wrap the loop instead of dying at the seam)."""
    n = len(x)
    f = bins(n)
    d = int(seconds * SR) % n
    y = np.zeros_like(x)
    g = 1.0
    tap = x.copy()
    for _ in range(8):
        tap = np.roll(cfilt(tap, lp(f, damp, 1.0)), d, axis=0)
        g *= feedback
        if g < 0.004:
            break
        y += tap * g
    return x * (1.0 - mix * 0.35) + y * mix


# --------------------------------------------------------------------------------------------- dynamics / colour
def _circ_onepole(x: np.ndarray, coef: float) -> np.ndarray:
    """One-pole smoothing that has settled by the time it reaches sample 0 again (runs the loop twice)."""
    z = np.concatenate([x, x])
    y = lfilter([1.0 - coef], [1.0, -coef], z)
    return y[len(x):]


def compress(x: np.ndarray, thresh_db: float = -24.0, ratio: float = 3.0, attack: float = 0.02,
             release: float = 0.25, makeup_db: float = 0.0, knee_db: float = 6.0) -> np.ndarray:
    """Feed-forward compressor with a circular envelope, so the gain curve is periodic too."""
    mono = x if x.ndim == 1 else np.max(np.abs(x), axis=1)
    det = np.abs(mono)
    ca = float(np.exp(-1.0 / max(attack * SR, 1.0)))
    cr = float(np.exp(-1.0 / max(release * SR, 1.0)))
    e = _circ_onepole(det, ca)
    e = np.maximum(e, _circ_onepole(det, cr))
    lvl = 20.0 * np.log10(np.maximum(e, 1e-9))
    over = lvl - thresh_db
    # soft knee
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1.0 / ratio - 1.0),
                           ((1.0 / ratio - 1.0) * (over + knee_db / 2) ** 2) / (2.0 * max(knee_db, 1e-6))))
    g = 10.0 ** ((gr + makeup_db) / 20.0)
    return x * (g[:, None] if x.ndim == 2 else g)


def multiband(x: np.ndarray, splits=(180.0, 1600.0), params=None) -> np.ndarray:
    """Three-band compression with circular crossovers (glues a bed together without pumping the whole spectrum)."""
    n = len(x)
    f = bins(n)
    if params is None:
        params = [dict(thresh_db=-26, ratio=2.4, attack=0.05, release=0.4),
                  dict(thresh_db=-28, ratio=2.0, attack=0.02, release=0.22),
                  dict(thresh_db=-30, ratio=1.8, attack=0.008, release=0.15)]
    low = cfilt(x, lp(f, splits[0], 2.0))
    mid = cfilt(x, hp(f, splits[0], 2.0) * lp(f, splits[1], 2.0))
    high = cfilt(x, hp(f, splits[1], 2.0))
    return compress(low, **params[0]) + compress(mid, **params[1]) + compress(high, **params[2])


def saturate(x: np.ndarray, drive: float = 1.6, asym: float = 0.08) -> np.ndarray:
    y = np.tanh(x * drive + asym * x * x * drive) / np.tanh(drive)
    return y


def tape(rng, x: np.ndarray, wow: float = 0.0022, flutter: float = 0.0006, wow_rate: float = 0.45,
         flutter_rate: float = 7.3, hiss: float = 0.0, drive: float = 1.15, hf: float = 11000.0,
         bump_db: float = 2.0, dropout: int = 0) -> np.ndarray:
    """Tape: periodic wow/flutter (fractional-delay via circular interpolation), head bump, HF loss, hiss,
    soft saturation and optional dropouts."""
    n = len(x)
    f = bins(n)
    t = t_axis(n)
    mod = (wow * np.sin(2 * np.pi * qlfo(wow_rate, n) * t + rng.uniform(0, 6.28))
           + wow * 0.5 * np.sin(2 * np.pi * qlfo(wow_rate * 2.7, n) * t + rng.uniform(0, 6.28))
           + flutter * np.sin(2 * np.pi * qlfo(flutter_rate, n) * t + rng.uniform(0, 6.28))) * SR
    idx = np.arange(n) + mod
    src = np.arange(n)
    if x.ndim == 2:
        y = np.stack([np.interp(idx, src, x[:, c], period=n) for c in range(x.shape[1])], axis=1)
    else:
        y = np.interp(idx, src, x, period=n)
    y = cfilt(y, shelf_low(f, 90.0, bump_db) * lp(f, hf, 1.6))
    y = saturate(y, drive)
    if dropout > 0:
        d = np.ones(n)
        for at in times(rng, n, dropout, 0.4):
            w = int(rng.uniform(0.03, 0.18) * SR)
            k = np.arange(w)
            dip = 1.0 - rng.uniform(0.25, 0.7) * np.sin(np.pi * k / w) ** 2
            sl = (np.arange(at, at + w)) % n
            d[sl] *= dip
        y = y * (d[:, None] if y.ndim == 2 else d)
    if hiss > 0.0:
        hz = stereo_noise(rng, n, -1.5, 260.0, 15000.0, corr=0.25) if y.ndim == 2 else noise(rng, n, -1.5, 260.0, 15000.0)
        y = y + hz * hiss
    return y


# --------------------------------------------------------------------------------------------- levels
def rms_env(x: np.ndarray, win: float = 1.0) -> np.ndarray:
    mono = x if x.ndim == 1 else x.mean(axis=1)
    w = max(1, int(win * SR))
    k = np.ones(w) / w
    p = np.convolve(np.concatenate([mono, mono]) ** 2, k, mode="same")[len(mono):2 * len(mono)]
    return np.sqrt(np.maximum(p, 1e-20))


def loud_norm(x: np.ndarray, target_db: float = -23.0, pct: float = 88.0, win: float = 1.0) -> np.ndarray:
    """Normalise by the loud part of the loop (a percentile of the short-term RMS), not by the peak, so a stem
    that is mostly silence keeps its silence and still sits at the right level when it speaks."""
    e = rms_env(x, win)
    ref = float(np.percentile(e, pct))
    if ref < 1e-9:
        return x
    return x * (db(target_db) / ref)


def soft_limit(x: np.ndarray, ceiling_db: float = -1.5) -> np.ndarray:
    """Gentle look-ahead-free limiter: only touches the peaks, keeps the loop periodic."""
    c = db(ceiling_db)
    pk = float(np.max(np.abs(x)))
    if pk <= c:
        return x
    y = x / pk * c
    over = np.maximum(np.abs(x) / max(pk, 1e-9) - 0.7, 0.0)
    if np.max(over) > 0:
        y = np.where(np.abs(x) > c, np.sign(x) * (c * np.tanh(np.abs(x) / c)), x)
        pk2 = float(np.max(np.abs(y)))
        if pk2 > c:
            y = y * (c / pk2)
    return y


def dc_remove(x: np.ndarray) -> np.ndarray:
    if x.ndim == 2:
        return x - x.mean(axis=0, keepdims=True)
    return x - x.mean()


def stereoise(mono: np.ndarray, n: int, spread: float = 0.6, rng=None) -> np.ndarray:
    """Turn a mono loop into a wide but mono-compatible stereo pair by decorrelating only the upper bands
    with a short all-pass-ish circular shift (no polarity tricks, so a mono fold-down stays intact)."""
    f = bins(n)
    lowm = cfilt(mono, lp(f, 200.0, 2.0))
    high = cfilt(mono, hp(f, 200.0, 2.0))
    d = int(0.011 * SR)
    a = high
    b = np.roll(high, d)
    l = lowm + a * (1.0 - spread * 0.5) + b * (spread * 0.5)
    r = lowm + a * (spread * 0.5) + b * (1.0 - spread * 0.5)
    return np.stack([l, r], axis=1)


def width(x: np.ndarray, amount: float = 1.0) -> np.ndarray:
    """Mid/side width control (1.0 = unchanged)."""
    m = 0.5 * (x[:, 0] + x[:, 1])
    s = 0.5 * (x[:, 0] - x[:, 1]) * amount
    return np.stack([m + s, m - s], axis=1)


def pan_mono(mono: np.ndarray, pan: float) -> np.ndarray:
    gl = np.sqrt(0.5 * (1.0 - pan))
    gr = np.sqrt(0.5 * (1.0 + pan))
    return np.stack([mono * gl, mono * gr], axis=1)
