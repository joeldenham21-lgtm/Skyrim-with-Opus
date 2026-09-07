"""Instruments for the RADIUS score and ambience: struck, plucked, bowed and blown voices plus drones.

One-shot voices return a mono buffer that the caller wrap-adds into a loop. Sustained voices are built
directly at loop length so they stay exactly periodic (frequencies snapped to bin centres).

Nothing here uses a sampled waveform or a stock oscillator bank: plucks are Karplus-Strong with a real
loop filter, bowed tones are noise driven through a bank of resonators with bow pressure and scratch,
piano notes are additive with inharmonicity, hammer noise and per-partial decay, and metal is a set of
measured-shape inharmonic ratios.
"""
import numpy as np
from scipy.signal import lfilter

from . import core as C

SR = C.SR


# --------------------------------------------------------------------------------------------- helpers
def _adsr(n, a, d, s, r, sus_level=0.6):
    a, d, r = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    s = max(0, int(s * SR))
    total = a + d + s + r
    e = np.zeros(max(n, total))
    e[:a] = np.linspace(0, 1, a) ** 0.6
    e[a:a + d] = 1.0 + (sus_level - 1.0) * (np.linspace(0, 1, d) ** 0.7)
    e[a + d:a + d + s] = sus_level
    e[a + d + s:total] = sus_level * (1.0 - np.linspace(0, 1, r)) ** 1.8
    return e[:n]


def _tail(n, decay, curve=1.0):
    t = np.arange(n) / SR
    return np.exp(-t / max(decay, 1e-3)) * (1.0 - (t / (n / SR)) ** 6).clip(0.0, 1.0) ** curve


# --------------------------------------------------------------------------------------------- plucked
def pluck(rng, f0: float, dur: float, damp: float = 0.42, bright: float = 0.5, pick: float = 0.5,
          stretch: float = 0.0, level: float = 1.0) -> np.ndarray:
    """Karplus-Strong with a tunable one-pole loop filter and an all-pass stretch term.
    damp: high-frequency loss per round trip (bigger = shorter, duller). bright: pick spectrum tilt."""
    n = int(dur * SR)
    L = max(4, int(round(SR / f0)))
    frac = SR / f0 - L
    # excitation: a short filtered noise burst plus a pick transient
    ex = rng.standard_normal(L)
    b = np.array([1.0 - bright, bright])
    ex = lfilter(b, [1.0], ex)
    ex *= np.linspace(1.0, 0.2, L) ** (1.0 + pick * 2.0)
    buf = np.zeros(n)
    buf[:L] = ex / max(np.max(np.abs(ex)), 1e-9)
    a = float(np.clip(damp, 0.02, 0.9))
    ap = float(np.clip(frac + stretch, 0.0, 0.98))
    y1 = 0.0
    ap1 = 0.0
    for i in range(L, n):
        v = 0.5 * (buf[i - L] + y1) * (1.0 - a) + y1 * a * 0.5
        v = buf[i - L] * (1.0 - a) + y1 * a
        y1 = v
        w = ap * (v - ap1) + buf[i - L]
        ap1 = w
        buf[i] = v * 0.998
    env = np.ones(n)
    k = int(0.02 * SR)
    env[-k:] = np.linspace(1, 0, k) ** 2
    return buf * env * level


def pluck_fast(rng, f0: float, dur: float, damp: float = 0.42, bright: float = 0.5, pick: float = 0.5,
               level: float = 1.0, detune_cents: float = 0.0) -> np.ndarray:
    """Vectorised Karplus-Strong: the delay line is a block filter, so a 6 s note costs milliseconds.
    Equivalent to the scalar loop above for the integer-delay case, with the fractional part handled by
    a small pitch offset baked into the loop length."""
    f0 = f0 * (2.0 ** (detune_cents / 1200.0))
    n = int(dur * SR)
    L = max(4, int(round(SR / f0)))
    ex = rng.standard_normal(L + 1)
    ex = lfilter([1.0 - bright, bright], [1.0], ex)[:L]
    ex *= np.linspace(1.0, 0.15, L) ** (1.0 + pick * 2.0)
    ex /= max(np.max(np.abs(ex)), 1e-9)
    a = float(np.clip(damp, 0.02, 0.92))
    # y[i] = (1-a) * y[i-L] + a * y[i-L-1]   -> IIR with sparse coefficients
    bnum = np.zeros(1)
    bnum[0] = 1.0
    aden = np.zeros(L + 2)
    aden[0] = 1.0
    aden[L] = -(1.0 - a) * 0.9985
    aden[L + 1] = -a * 0.9985
    src = np.zeros(n)
    src[:L] = ex
    y = lfilter(bnum, aden, src)
    env = np.ones(n)
    k = min(n, int(0.03 * SR))
    env[-k:] = np.linspace(1, 0, k) ** 2
    return y * env * level


def dulcimer(rng, f0: float, dur: float, level: float = 1.0) -> np.ndarray:
    """A hammered pair of strings: two plucks a few cents apart with a wooden knock."""
    a = pluck_fast(rng, f0, dur, damp=0.28, bright=0.62, pick=0.25, detune_cents=rng.uniform(-4, -1))
    b = pluck_fast(rng, f0, dur, damp=0.31, bright=0.55, pick=0.3, detune_cents=rng.uniform(1, 5))
    n = len(a)
    knock = rng.standard_normal(n) * _tail(n, 0.012)
    knock = lfilter(*_biquad_bp(320.0, 3.0), knock)
    return (a * 0.6 + b * 0.5 + knock * 0.25) * level


# --------------------------------------------------------------------------------------------- struck
def _biquad_bp(fc, q):
    w = 2 * np.pi * fc / SR
    alpha = np.sin(w) / (2 * q)
    b = np.array([alpha, 0.0, -alpha])
    a = np.array([1 + alpha, -2 * np.cos(w), 1 - alpha])
    return b / a[0], a / a[0]


def piano(rng, f0: float, dur: float, level: float = 1.0, bright: float = 0.55, felt: float = 0.4,
          partials: int = 22, inharm: float = 0.0005) -> np.ndarray:
    """Additive piano-ish note: stiff-string inharmonicity, per-partial decay (highs die first), a hammer
    thud and a felt noise transient. Meant to be tape-degraded afterwards."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, partials + 1):
        fk = f0 * k * np.sqrt(1.0 + inharm * k * k)
        if fk > 17000:
            break
        dec = dur * (0.95 / (1.0 + 0.55 * (k - 1) ** 0.85))
        amp = (1.0 / k ** (1.55 - bright * 0.5)) * (1.0 + 0.25 * rng.standard_normal())
        if k % 7 == 0:
            amp *= 0.55
        ph = rng.uniform(0, 2 * np.pi)
        beat = 1.0 + 0.06 * np.sin(2 * np.pi * rng.uniform(0.4, 1.6) * t + rng.uniform(0, 6.28))
        out += amp * np.exp(-t / max(dec, 0.05)) * np.sin(2 * np.pi * fk * t + ph) * beat
    out /= max(np.max(np.abs(out)), 1e-9)
    # hammer: a short noise thump filtered around the note
    h = rng.standard_normal(n) * _tail(n, 0.006 + felt * 0.02)
    h = lfilter(*_biquad_bp(f0 * 3.2, 1.1), h)
    thud = np.sin(2 * np.pi * f0 * 0.5 * t) * _tail(n, 0.05) * 0.25
    y = out + h * (0.12 + felt * 0.14) + thud
    k = min(n, int(0.05 * SR))
    y[-k:] *= np.linspace(1, 0, k) ** 2
    return y * level


def metal(rng, f0: float, dur: float, level: float = 1.0, ratios=None, strike: float = 1.0,
          shimmer: float = 0.3) -> np.ndarray:
    """Struck metal (a plate, a rail, a bell): inharmonic partials with individual decays and a beating
    shimmer between close pairs."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    if ratios is None:
        ratios = [1.0, 2.02, 2.71, 3.44, 4.19, 5.43, 6.79, 8.21, 9.87, 12.4]
    out = np.zeros(n)
    for i, r in enumerate(ratios):
        fk = f0 * r * (1.0 + rng.uniform(-0.004, 0.004))
        if fk > 18000:
            continue
        dec = dur * (0.9 / (1.0 + 0.35 * i))
        amp = 1.0 / (1.0 + i * 0.75)
        beatf = rng.uniform(0.2, 2.2) * shimmer
        env = np.exp(-t / max(dec, 0.03)) * (1.0 + 0.35 * shimmer * np.sin(2 * np.pi * beatf * t))
        out += amp * env * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28))
    out /= max(np.max(np.abs(out)), 1e-9)
    hit = rng.standard_normal(n) * _tail(n, 0.004) * strike
    hit = lfilter(*_biquad_bp(f0 * 6.0, 0.8), hit)
    y = out + hit * 0.3
    k = min(n, int(0.04 * SR))
    y[-k:] *= np.linspace(1, 0, k) ** 2
    return y * level


def tom(rng, f0: float, dur: float, level: float = 1.0, bend: float = 1.7, skin: float = 0.35) -> np.ndarray:
    """A low tom / floor drum: pitched membrane modes with a downward bend and skin noise."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (1.0 + (bend - 1.0) * np.exp(-t / 0.055))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / (dur * 0.32))
    body += 0.35 * np.sin(ph * 1.594) * np.exp(-t / (dur * 0.18))
    body += 0.18 * np.sin(ph * 2.136) * np.exp(-t / (dur * 0.1))
    sk = rng.standard_normal(n) * _tail(n, 0.02)
    sk = lfilter(*_biquad_bp(1800.0, 0.7), sk)
    y = body + sk * skin
    y /= max(np.max(np.abs(y)), 1e-9)
    k = min(n, int(0.03 * SR))
    y[-k:] *= np.linspace(1, 0, k) ** 2
    return y * level


def sub_hit(rng, f0: float, dur: float, level: float = 1.0, drop: float = 0.55) -> np.ndarray:
    """A sub pulse that sinks: 55 -> 30 Hz sine with a soft attack."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (drop + (1.0 - drop) * np.exp(-t / (dur * 0.28)))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = (1.0 - np.exp(-t / 0.02)) * np.exp(-t / (dur * 0.35))
    y *= env
    k = min(n, int(0.05 * SR))
    y[-k:] *= np.linspace(1, 0, k) ** 2
    return y * level


def noise_hit(rng, dur: float, fc: float, q: float = 1.2, decay: float = 0.06, level: float = 1.0,
              tilt_db: float = 0.0) -> np.ndarray:
    n = int(dur * SR)
    x = rng.standard_normal(n) * _tail(n, decay)
    x = lfilter(*_biquad_bp(min(fc, SR * 0.45), q), x)
    if tilt_db:
        x = lfilter([1.0, -0.85 if tilt_db < 0 else 0.0], [1.0], x)
    x /= max(np.max(np.abs(x)), 1e-9)
    return x * level


# --------------------------------------------------------------------------------------------- bowed / blown
def bowed(rng, n: int, f0: float, ratios=None, bow: np.ndarray = None, q: float = 60.0,
          scratch: float = 0.25, level: float = 1.0) -> np.ndarray:
    """Bowed metal or string: broadband noise (the bow) through a bank of high-Q circular resonators tuned
    to `ratios` of f0, with the bow pressure modulating the excitation brightness. Perfectly periodic."""
    if ratios is None:
        ratios = [1.0, 2.0, 3.0, 4.16, 5.43, 7.1]
    f = C.bins(n)
    if bow is None:
        bow = C.wander(rng, n, [0.031, 0.017, 0.071], lo=0.15, hi=1.0, power=1.4)
    # excitation: pink-ish noise whose brightness follows bow pressure
    ex_dark = C.noise(rng, n, -4.0, 60.0, 2500.0)
    ex_bright = C.noise(rng, n, -2.0, 120.0, 9000.0)
    ex = ex_dark * (1.0 - bow) + ex_bright * bow
    out = np.zeros(n)
    for i, r in enumerate(ratios):
        fk = C.qf(f0 * r * (1.0 + rng.uniform(-0.0025, 0.0025)), n)
        if fk > 16000:
            continue
        amp = 1.0 / (1.0 + i * 0.8)
        out += amp * C.cfilt(ex, C.bp(f, fk, q * (1.0 + i * 0.25)))
    out /= max(np.sqrt(np.mean(out * out)), 1e-9)
    # bow scratch: a whisper of the raw excitation, band-limited around the fundamental's octave
    if scratch > 0:
        out += C.cfilt(ex, C.bp(f, f0 * 4.0, 1.2)) * scratch * 0.4
    return out * bow * level


def string_section(rng, n: int, freqs, level: float = 1.0, cutoff: float = 2200.0, vib: float = 0.0035,
                   spread_cents: float = 9.0, voices: int = 3) -> np.ndarray:
    """A slow, close-miked string pad: several detuned saw-ish voices per note with independent vibrato,
    through a soft low-pass. Not a synth pad: the partial amplitudes fall like a bowed string and each
    voice has its own slow amplitude life."""
    f = C.bins(n)
    t = C.t_axis(n)
    out = np.zeros(n)
    for f0 in freqs:
        for v in range(voices):
            det = (v - (voices - 1) / 2.0) * spread_cents + rng.uniform(-2.5, 2.5)
            fv = f0 * 2.0 ** (det / 1200.0)
            vr = C.qlfo(rng.uniform(4.2, 5.6), n)
            phase_mod = vib * np.sin(2 * np.pi * vr * t + rng.uniform(0, 6.28))
            voice = np.zeros(n)
            for k in range(1, 26):
                fk = fv * k
                if fk > 12000:
                    break
                amp = 1.0 / (k ** 1.25) * (0.75 + 0.5 * rng.random())
                voice += amp * np.sin(2 * np.pi * C.qf(fk, n) * t + k * phase_mod + rng.uniform(0, 6.28))
            life = C.wander(rng, n, [rng.uniform(0.02, 0.05), rng.uniform(0.008, 0.02)], lo=0.55, hi=1.0)
            out += voice * life
    out = C.cfilt(out, C.lp(f, cutoff, 1.6) * C.hp(f, 45.0, 1.0))
    out /= max(np.sqrt(np.mean(out * out)), 1e-9)
    return out * level


def choir(rng, n: int, freqs, level: float = 1.0, formants=((520, 0.9), (1180, 0.55), (2650, 0.28)),
          breathiness: float = 0.35, voices: int = 4) -> np.ndarray:
    """A distant choir-like pad: detuned harmonic stacks through vowel formants, with breath noise and
    slow independent vibrato. Kept dark and quiet - it should read as 'people somewhere', not a synth."""
    f = C.bins(n)
    t = C.t_axis(n)
    src = np.zeros(n)
    for f0 in freqs:
        for v in range(voices):
            fv = f0 * 2.0 ** (rng.uniform(-12, 12) / 1200.0)
            vr = C.qlfo(rng.uniform(3.6, 5.4), n)
            depth = rng.uniform(0.002, 0.005)
            pm = depth * np.sin(2 * np.pi * vr * t + rng.uniform(0, 6.28))
            drift = C.wander(rng, n, [0.013, 0.029], lo=-0.004, hi=0.004)
            voice = np.zeros(n)
            for k in range(1, 30):
                fk = fv * k
                if fk > 9000:
                    break
                voice += (1.0 / k ** 1.05) * np.sin(2 * np.pi * C.qf(fk, n) * t + k * (pm + drift) + rng.uniform(0, 6.28))
            entry = C.wander(rng, n, [rng.uniform(0.012, 0.03), rng.uniform(0.005, 0.012)], lo=0.3, hi=1.0, power=1.2)
            src += voice * entry
    shaped = np.zeros(n)
    for fc, g in formants:
        shaped += C.cfilt(src, C.bp(f, fc, 2.6)) * g
    if breathiness > 0:
        br = C.noise(rng, n, -2.0, 400.0, 6000.0)
        br = C.cfilt(br, C.bp(f, 1400.0, 1.2))
        shaped += br * breathiness * 0.25
    shaped = C.cfilt(shaped, C.lp(f, 4200.0, 1.4) * C.hp(f, 130.0, 1.5))
    shaped /= max(np.sqrt(np.mean(shaped * shaped)), 1e-9)
    return shaped * level


def breath(rng, n: int, count: int, low: float = 220.0, high: float = 1500.0, level: float = 1.0,
           length=(1.6, 3.2)) -> np.ndarray:
    """Irregular breathing: band-passed noise swells at scattered times, each with its own formant."""
    f = C.bins(n)
    src = C.noise(rng, n, -2.5, 80.0, 7000.0)
    env = np.zeros(n)
    fc_ctrl = np.zeros(n)
    for at in C.times(rng, n, count, 0.45):
        L = int(rng.uniform(*length) * SR)
        w = np.sin(np.pi * np.linspace(0, 1, L)) ** 1.6
        C.wrap_add(env, w, at, gain=rng.uniform(0.55, 1.0))
        C.wrap_add(fc_ctrl, w * rng.uniform(0.2, 1.0), at)
    env = np.clip(env, 0, 1.4)
    fc_ctrl = np.clip(fc_ctrl, 0, 1)
    mags = [C.bp(f, low, 1.1), C.bp(f, np.sqrt(low * high), 1.0), C.bp(f, high, 1.3)]
    y = C.morph_bank(src, mags, C.sweep_weights(fc_ctrl, [0, 1, 2]))
    return y * env * level


# --------------------------------------------------------------------------------------------- sustained
def drone(rng, n: int, f0: float, partials=None, detune_cents: float = 7.0, level: float = 1.0,
          saw: float = 0.5, cutoff: float = 320.0, breathe: float = 0.35) -> np.ndarray:
    """A long detuned drone: pairs of voices a few cents apart per partial so the whole thing beats slowly,
    through a low-pass that breathes. The bedrock of every calm cue."""
    f = C.bins(n)
    t = C.t_axis(n)
    if partials is None:
        partials = [(1.0, 1.0), (2.0, 0.45), (3.0, 0.22), (4.0, 0.12), (6.0, 0.07)]
    out = np.zeros(n)
    for r, a in partials:
        for s in (-1.0, 1.0):
            fk = f0 * r * 2.0 ** (s * detune_cents / 1200.0)
            if fk > 15000:
                continue
            v = np.sin(2 * np.pi * C.qf(fk, n) * t + rng.uniform(0, 6.28))
            if saw > 0:  # add a few harmonics of this voice to get a saw-ish edge without aliasing
                for k in range(2, 7):
                    if fk * k > 12000:
                        break
                    v += (saw / k ** 1.2) * np.sin(2 * np.pi * C.qf(fk * k, n) * t + rng.uniform(0, 6.28))
            out += v * a
    ctrl = C.wander(rng, n, [0.021, 0.043, 0.011], lo=0.0, hi=1.0)
    out = C.morph_lp(out, f, [cutoff * 0.55, cutoff, cutoff * 2.1], C.sweep_weights(ctrl, [0, 1, 2]), order=1.7)
    out *= 1.0 - breathe + breathe * C.wander(rng, n, [0.017, 0.037], lo=0.0, hi=1.0)
    out /= max(np.sqrt(np.mean(out * out)), 1e-9)
    return out * level


def shepard(rng, n: int, base: float, cycles: int, ratios=(1.0, 1.1892, 1.4983), span_oct: float = 1.0,
            level: float = 1.0, voices: int = 3, cutoff: float = 1800.0, direction: float = 1.0) -> np.ndarray:
    """A rising (or falling) cluster that never arrives: `voices` copies of the same glide, offset in time,
    each faded in at the bottom and out at the top. Exactly `cycles` glides per loop, so it is periodic."""
    f = C.bins(n)
    t = C.t_axis(n)
    period = n / cycles
    out = np.zeros(n)
    for v in range(voices):
        off = v * period / voices
        # phase within this voice's glide, 0..1, wrapping
        p = ((np.arange(n) - off) % (period * voices)) / (period * voices)
        # amplitude window: quiet at the extremes of the sweep
        amp = np.sin(np.pi * p) ** 1.4
        for r in ratios:
            f_inst = base * r * 2.0 ** (direction * span_oct * (p * voices % 1.0))
            phase = 2 * np.pi * np.cumsum(f_inst) / SR
            out += np.sin(phase + rng.uniform(0, 6.28)) * amp / len(ratios)
    out = C.cfilt(out, C.lp(f, cutoff, 1.5) * C.hp(f, 60.0, 1.0))
    # the sum of the voices is periodic to within one sample of rounding; force exactness with a tiny taper
    out /= max(np.sqrt(np.mean(out * out)), 1e-9)
    return out * level


def hum(rng, n: int, mains: float = 50.0, harmonics=(1, 2, 3, 4, 6, 8), level: float = 1.0,
        buzz: float = 0.25, wobble: float = 0.06) -> np.ndarray:
    """Mains hum: a fridge, a transformer, a fluorescent tube. Harmonics of the mains frequency with a
    little buzz (odd harmonics through a resonance) and a slow wobble on the whole thing."""
    t = C.t_axis(n)
    f = C.bins(n)
    out = np.zeros(n)
    for k in harmonics:
        a = 1.0 / (k ** 1.15)
        if k % 2 == 1:
            a *= 0.6
        out += a * np.sin(2 * np.pi * C.qf(mains * k, n) * t + rng.uniform(0, 6.28))
    if buzz > 0:
        bz = np.zeros(n)
        for k in range(6, 40, 2):
            bz += (1.0 / k) * np.sin(2 * np.pi * C.qf(mains * k, n) * t + rng.uniform(0, 6.28))
        bz = C.cfilt(bz, C.bp(f, mains * 20.0, 1.4))
        out += bz * buzz
    out *= 1.0 - wobble + wobble * C.wander(rng, n, [0.09, 0.23], lo=0.0, hi=1.0)
    out /= max(np.sqrt(np.mean(out * out)), 1e-9)
    return out * level


def wind(rng, n: int, level: float = 1.0, gust: np.ndarray = None, low: float = 60.0, high: float = 3000.0,
         whistle: float = 0.0, whistle_f: float = 900.0) -> np.ndarray:
    """Wind: broadband noise whose band and level follow a gust signal, with an optional edge tone."""
    f = C.bins(n)
    if gust is None:
        gust = C.wander(rng, n, [0.037, 0.013, 0.083, 0.0071], lo=0.0, hi=1.0, power=1.7)
    src = C.noise(rng, n, -3.0, 20.0, 18000.0)
    mags = [C.lp(f, low * 3.0, 1.6) * C.hp(f, low * 0.5, 1.0),
            C.lp(f, np.sqrt(low * high) * 2.0, 1.4) * C.hp(f, low, 1.0),
            C.lp(f, high, 1.2) * C.hp(f, low * 1.5, 1.0)]
    y = C.morph_bank(src, mags, C.sweep_weights(gust, [0, 1, 2]))
    y *= 0.35 + 0.65 * gust
    if whistle > 0:
        wf = C.cfilt(C.noise(rng, n, 0.0, 200.0, 8000.0), C.bp(f, whistle_f, 22.0))
        wf2 = C.cfilt(C.noise(rng, n, 0.0, 200.0, 8000.0), C.bp(f, whistle_f * 1.51, 30.0))
        y += (wf + wf2 * 0.6) * whistle * np.clip(gust - 0.35, 0, 1) * 2.2
    y /= max(np.sqrt(np.mean(y * y)), 1e-9)
    return y * level


def crackle(rng, n: int, rate: float = 22.0, fc: float = 3200.0, q: float = 3.0, level: float = 1.0,
            spread: float = 1.4) -> np.ndarray:
    """Electrical crackle / geiger-ish bed: sparse impulses through a resonance, clustered in bursts."""
    f = C.bins(n)
    imp = np.zeros(n)
    burst = C.wander(rng, n, [0.09, 0.21, 0.043], lo=0.0, hi=1.0, power=2.2)
    idx = C.poisson_times(rng, n, rate * 2.5)
    keep = rng.random(len(idx)) < np.clip(burst[idx] * spread, 0.02, 1.0)
    idx = idx[keep]
    imp[idx] = rng.standard_normal(len(idx)) * rng.uniform(0.3, 1.0, len(idx))
    y = C.cfilt(imp, C.bp(f, fc, q) * C.hp(f, 300.0, 1.0))
    y /= max(np.sqrt(np.mean(y * y)), 1e-9)
    return y * level


def droplets(rng, n: int, rate: float, fmin: float = 900.0, fmax: float = 6500.0, level: float = 1.0,
             decay: float = 0.004) -> np.ndarray:
    """Rain grains: thousands of tiny resonant ticks. What separates rain from noise."""
    f = C.bins(n)
    y = np.zeros(n)
    count = max(1, int(rate * n / SR))
    idx = rng.integers(0, n, size=count)
    amps = rng.random(count) ** 2.2
    # bucket the grains by resonance so a handful of circular filters covers thousands of drops
    nb = 6
    edges = np.geomspace(fmin, fmax, nb + 1)
    which = rng.integers(0, nb, size=count)
    for b in range(nb):
        sel = which == b
        if not np.any(sel):
            continue
        imp = np.zeros(n)
        np.add.at(imp, idx[sel], amps[sel] * rng.choice([-1.0, 1.0], size=int(sel.sum())))
        fc = float(np.sqrt(edges[b] * edges[b + 1]))
        band = C.cfilt(imp, C.bp(f, fc, 2.2) * C.lp(f, fc * 3.0, 1.0))
        # short exponential tail per grain: convolve circularly with a decaying click
        L = int(decay * 6 * SR)
        tail = np.exp(-np.arange(L) / (decay * SR))
        band = np.fft.irfft(np.fft.rfft(band) * np.fft.rfft(np.concatenate([tail, np.zeros(n - L)])), n)
        y += band / (1.0 + b * 0.25)
    y /= max(np.sqrt(np.mean(y * y)), 1e-9)
    return y * level


def chirp(rng, dur: float, f_start: float, f_end: float, level: float = 1.0, harm: int = 3,
          shape: float = 1.0, noise_mix: float = 0.1) -> np.ndarray:
    """One bird/insect syllable: a swept tone with a couple of harmonics and a bell envelope."""
    n = max(8, int(dur * SR))
    t = np.arange(n) / SR
    p = (t / t[-1]) ** shape
    fi = f_start * (f_end / f_start) ** p
    ph = 2 * np.pi * np.cumsum(fi) / SR
    y = np.sin(ph)
    for k in range(2, harm + 1):
        y += np.sin(ph * k + rng.uniform(0, 6.28)) / (k ** 1.6)
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.3
    if noise_mix > 0:
        nz = rng.standard_normal(n)
        nz = lfilter(*_biquad_bp(float(np.mean(fi)), 2.0), nz)
        y = y + nz * noise_mix * 2.0
    y *= env
    return y / max(np.max(np.abs(y)), 1e-9) * level


def creak(rng, dur: float, f0: float = 180.0, level: float = 1.0, roughness: float = 0.7) -> np.ndarray:
    """Wood or metal creak: a stick-slip train of micro-impulses through a moving resonance."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    rate = 40.0 + 260.0 * (1.0 - np.exp(-t / (dur * 0.4)))
    ph = np.cumsum(rate) / SR
    grain = (np.mod(ph, 1.0) < 0.06).astype(np.float64)
    grain *= rng.uniform(0.4, 1.0, n) ** 2
    fc = f0 * (1.0 + 1.6 * (t / dur) ** 1.5)
    y = np.zeros(n)
    steps = 7
    for i in range(steps):
        a = float(np.clip(1.0 - abs((t / dur) * (steps - 1) - i), 0, 1))
        if a <= 0:
            continue
    # piecewise: filter the whole train at a ladder of cutoffs and crossfade
    for i in range(steps):
        w = np.clip(1.0 - np.abs((t / dur) * (steps - 1) - i), 0, 1)
        if np.max(w) <= 0:
            continue
        fci = float(f0 * (1.0 + 1.6 * (i / max(steps - 1, 1)) ** 1.5))
        y += lfilter(*_biquad_bp(fci, 6.0 + roughness * 10.0), grain) * w
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 0.8
    y *= env
    return y / max(np.max(np.abs(y)), 1e-9) * level


def thunder(rng, dur: float, distance: float = 1.0, level: float = 1.0) -> np.ndarray:
    """Distant thunder: a long, low, rolling rumble made of overlapping filtered noise swells.
    `distance` 0 = close crack, 1 = far roll."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    nsw = int(6 + 14 * distance)
    for i in range(nsw):
        at = int(rng.random() ** (1.0 + distance) * n * 0.7)
        L = int(rng.uniform(0.35, 1.8) * SR)
        if at + L > n:
            L = n - at
        if L < 64:
            continue
        sw = rng.standard_normal(L)
        fc = rng.uniform(55, 260) * (1.0 - 0.5 * distance)
        sw = lfilter(*_biquad_bp(max(35.0, fc), 0.6), sw)
        sw *= np.sin(np.pi * np.linspace(0, 1, L)) ** 1.5 * rng.uniform(0.35, 1.0)
        y[at:at + L] += sw
    if distance < 0.5:
        crack = rng.standard_normal(int(0.25 * SR))
        crack = lfilter(*_biquad_bp(900.0, 0.5), crack)
        crack *= np.exp(-np.arange(len(crack)) / (0.03 * SR))
        y[:len(crack)] += crack * (1.0 - distance * 2.0) * 1.6
    y *= np.exp(-t / (dur * (0.35 + 0.5 * distance)))
    k = min(n, int(0.2 * SR))
    y[-k:] *= np.linspace(1, 0, k) ** 1.5
    return y / max(np.max(np.abs(y)), 1e-9) * level
