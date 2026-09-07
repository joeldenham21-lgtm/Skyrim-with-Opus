"""Layered sound builders on top of dsp.py — the browser build's toolkit (burst/tone/fm/ring/click/thump/tail/clack/
seq/cloth/pulses/tinkle/trem/grunt/gunshot) ported to offline rendering and extended with modal resonators, whooshes,
rattles and metal/wood/glass bodies. A Voice accumulates layers at time offsets; every parameter is jittered from the
voice's RNG so the four variants of a name differ the way real takes differ.
"""
import math
import numpy as np
from . import dsp
from .dsp import SR, sec, EPS


class Voice:
    def __init__(self, rng: np.random.Generator, rate: float = 1.0):
        self.rng = rng
        self.rate = float(dsp.clamp(rate, 0.25, 4.0))
        self.s = math.sqrt(self.rate)
        self.buf = np.zeros(sec(0.25))

    # ------------------------------------------------------------------ random helpers
    def rnd(self, a: float, b: float) -> float:
        return float(self.rng.uniform(a, b))

    def irnd(self, a: int, b: int) -> int:
        return int(self.rng.integers(a, b + 1))

    def jit(self, v: float, p: float = 0.08) -> float:
        return v * (1.0 + self.rng.uniform(-1, 1) * p)

    def chance(self, p: float) -> bool:
        return bool(self.rng.random() < p)

    def pick(self, arr):
        return arr[int(self.rng.integers(0, len(arr)))]

    # ------------------------------------------------------------------ mixing
    def at(self, t: float) -> int:
        return sec(t / self.s)

    def add(self, sig: np.ndarray, at: float = 0.0, gain: float = 1.0) -> np.ndarray:
        self.buf = dsp.mix_into(self.buf, sig, self.at(at), gain)
        return sig

    def sub(self) -> "Voice":
        v = Voice(self.rng, self.rate)
        v.buf = np.zeros(8)
        return v

    def render(self) -> np.ndarray:
        return self.buf

    def length(self) -> float:
        return len(self.buf) / SR


# ---------------------------------------------------------------------------------------------------------- fx chain
def fx(v: Voice, x: np.ndarray, c: dict) -> np.ndarray:
    if c.get("shape"):
        x = dsp.shaper(x, c["shape"])
    if c.get("sat"):
        x = dsp.saturate(x, c["sat"])
    if c.get("hp"):
        x = dsp.highpass(x, c["hp"] * v.rate, c.get("hq", 0.7))
    if c.get("lp"):
        x = dsp.lowpass(x, c["lp"] * v.rate, c.get("lq", 0.7))
    if c.get("bp"):
        x = dsp.bandpass(x, c["bp"] * v.rate, c.get("bq", 1.0))
    return x


def _env(v: Voice, n: int, g: float, c: dict) -> np.ndarray:
    atk = min(n / SR * 0.9, c.get("atk", 0.003) / v.s)
    return dsp.env(n, atk, c.get("hold", 0.0) / v.s, curve=c.get("curve", "exp"), peak=g, hold_level=c.get("hold_level", 0.9))


# ---------------------------------------------------------------------------------------------------------- builders
def burst(v: Voice, **c) -> np.ndarray:
    """Filtered noise burst. keys: at type filt f0 f1 q dur g atk hold curve pr pr1 sweep shape sat hp lp bp fjit djit gjit to"""
    s = v.s
    dur = max(0.003, v.jit(c.get("dur", 0.1), c.get("djit", 0.1)) / s)
    n = sec(dur)
    f0 = v.jit(c.get("f0", 1000.0) * v.rate, c.get("fjit", 0.07))
    f1 = f0 if c.get("f1") is None else v.jit(c["f1"] * v.rate, c.get("fjit", 0.07))
    g = max(EPS, v.jit(c.get("g", 0.5), c.get("gjit", 0.12)))
    pr, pr1 = c.get("pr", 1.0), c.get("pr1")
    m = n if pr1 is None else int(n * max(pr, pr1) + 8)
    x = dsp.noise(v.rng, m + 8, c.get("type", "white"))
    if pr1 is not None or abs(pr - 1.0) > 1e-6:
        rate = dsp.sweep(n, pr, pr if pr1 is None else pr1, "exp")
        x = dsp.resample_rate(x, rate)[:n]
    x = x[:n]
    if len(x) < n:
        x = dsp.pad_to(x, n)
    filt = c.get("filt", "bandpass")
    if filt != "none":
        freq = f0 if abs(f1 - f0) < 1e-6 else dsp.sweep(n, f0, f1, "exp", c.get("sweep", 1.0))
        x = dsp.biquad(x, filt, freq, c.get("q", 1.0))
    x = fx(v, x, c)
    x *= _env(v, n, g, c)
    tgt = c.get("to", v)
    tgt.add(x, c.get("at", 0.0))
    return x


def tone(v: Voice, **c) -> np.ndarray:
    """Pitched tone with sweep. keys: at type f0 f1 dur g atk hold curve sweep detune(cents) vib{f,depth} fcurve jitter shape sat hp lp bp"""
    s = v.s
    dur = max(0.004, v.jit(c.get("dur", 0.2), c.get("djit", 0.08)) / s)
    n = sec(dur)
    f0 = v.jit(c.get("f0", 220.0) * v.rate, c.get("fjit", 0.03))
    f1 = f0 if c.get("f1") is None else v.jit(c["f1"] * v.rate, c.get("fjit", 0.03))
    g = max(EPS, v.jit(c.get("g", 0.4), c.get("gjit", 0.1)))
    det = 2.0 ** (c.get("detune", 0.0) / 1200.0)
    freq = dsp.sweep(n, f0, f1, c.get("fcurve", "exp"), c.get("sweep", 1.0)) * det
    vib = c.get("vib")
    if vib:
        freq = freq + vib["depth"] * v.rate * np.sin(2 * np.pi * vib["f"] * np.arange(n) / SR + v.rnd(0, 6.28))
    x = dsp.osc(n, freq, c.get("type", "sine"), phase=v.rnd(0, 1), rng=v.rng, jitter=c.get("jitter", 0.0))
    x = fx(v, x, c)
    x *= _env(v, n, g, c)
    tgt = c.get("to", v)
    tgt.add(x, c.get("at", 0.0))
    return x


def fm(v: Voice, **c) -> np.ndarray:
    """Two-operator FM. keys: at f0 f1 ratio index index1 dur g type mtype atk hold curve shape sat lp bp hp"""
    s = v.s
    dur = max(0.01, v.jit(c.get("dur", 0.3), c.get("djit", 0.08)) / s)
    n = sec(dur)
    f0 = v.jit(c.get("f0", 300.0) * v.rate, 0.03)
    f1 = f0 if c.get("f1") is None else v.jit(c["f1"] * v.rate, 0.03)
    ratio = v.jit(c.get("ratio", 1.5), 0.02)
    i0 = c.get("index", 2.0); i1 = c.get("index1", i0)
    g = max(EPS, v.jit(c.get("g", 0.3), 0.1))
    freq = dsp.sweep(n, f0, f1, "exp")
    idx = dsp.sweep(n, max(i0, 0.01), max(i1, 0.01), "exp")
    x = dsp.fm_osc(n, freq, ratio, idx, c.get("type", "sine"), c.get("mtype", "sine"))
    x = fx(v, x, c)
    x *= _env(v, n, g, c)
    tgt = c.get("to", v)
    tgt.add(x, c.get("at", 0.0))
    return x


def ring(v: Voice, **c) -> None:
    """Decaying partials (a struck object). keys: at freqs decay g type fall spread lp shape to"""
    freqs = c.get("freqs", [800, 1300]); fall = c.get("fall", 0.75)
    for i, f in enumerate(freqs):
        tone(v, at=c.get("at", 0.0) + v.rnd(0, c.get("spread", 0.004)), type=c.get("type", "sine"), f0=f,
             dur=c.get("decay", 0.2) * (1 - i * 0.08), g=c.get("g", 0.2) * (fall ** i), atk=0.0015, fjit=0.015, djit=0.25,
             to=c.get("to", v), lp=c.get("lp"), shape=c.get("shape"))


def modal(v: Voice, **c) -> np.ndarray:
    """Modal resonator: inharmonic partials with per-mode decay, struck by a short noise excitation.
    keys: at freqs t60s amps exc(dur) g bright(exc lp) jitter to hp lp sat"""
    freqs = np.asarray(c["freqs"], dtype=float) * v.rate
    freqs = freqs * (1.0 + v.rng.uniform(-1, 1, len(freqs)) * c.get("jitter", 0.02))
    t60 = np.asarray(c.get("t60s", [0.3] * len(freqs)), dtype=float) / v.s
    amps = np.asarray(c.get("amps", [1.0] * len(freqs)), dtype=float)
    dur = float(np.max(t60)) * 1.15 + 0.01
    n = sec(dur)
    t = np.arange(n) / SR
    ph = v.rng.uniform(0, 2 * np.pi, len(freqs))
    y = (amps[:, None] * np.exp(-6.91 * t[None, :] / t60[:, None]) * np.sin(2 * np.pi * freqs[:, None] * t[None, :] + ph[:, None])).sum(axis=0)
    k = sec(c.get("exc", 0.002))
    if k > 1:
        ex = dsp.white(v.rng, k) * dsp.env(k, 0.0003, 0, curve="exp")
        if c.get("bright"):
            ex = dsp.lowpass(ex, c["bright"] * v.rate)
        y = dsp.convolve(y, ex / (np.sum(np.abs(ex)) + 1e-9))[:n]
    y *= c.get("g", 0.3) / (np.max(np.abs(y)) + 1e-9)
    y = fx(v, y, c)
    tgt = c.get("to", v)
    tgt.add(y, c.get("at", 0.0))
    return y


def click(v: Voice, **c) -> None:
    """The 2 ms transient at the front of anything mechanical. keys: at f q dur g body to"""
    burst(v, at=c.get("at", 0.0), type="white", filt="bandpass", f0=c.get("f", 3000.0), q=c.get("q", 1.5), dur=c.get("dur", 0.004),
          g=c.get("g", 0.5), atk=0.0005, to=c.get("to", v))
    if c.get("body"):
        tone(v, at=c.get("at", 0.0), f0=c.get("f", 3000.0) * 0.3, f1=c.get("f", 3000.0) * 0.18, dur=c.get("dur", 0.006),
             g=c.get("g", 0.5) * 0.4, atk=0.0005, to=c.get("to", v))


def thump(v: Voice, **c) -> np.ndarray:
    """Low sine drop: the weight of a thing. keys: at f0 f1 dur g atk shape sat curve to"""
    return tone(v, at=c.get("at", 0.0), type="sine", f0=c.get("f0", 90.0), f1=c.get("f1", 30.0), dur=c.get("dur", 0.12),
                g=c.get("g", 0.8), atk=c.get("atk", 0.002), shape=c.get("shape"), sat=c.get("sat"), to=c.get("to", v),
                curve=c.get("curve", "exp"))


def tail(v: Voice, **c) -> np.ndarray:
    """Short synthetic reverb-ish tail: filtered noise darkening as it dies. keys: at type f0 f1 dur g atk to"""
    return burst(v, at=c.get("at", 0.01), type=c.get("type", "pink"), filt="lowpass", f0=c.get("f0", 2500.0), f1=c.get("f1", 300.0),
                 q=0.5, dur=c.get("dur", 0.5), g=c.get("g", 0.15), atk=c.get("atk", 0.015), to=c.get("to", v))


def clack(v: Voice, **c) -> None:
    """Metal on metal: burst + short partials. keys: at f q dur g decay ringMul to"""
    f = c.get("f", 2200.0)
    burst(v, at=c.get("at", 0.0), type="white", filt="bandpass", f0=f, q=c.get("q", 2.0), dur=c.get("dur", 0.015), g=c.get("g", 0.5),
          atk=0.0008, to=c.get("to", v))
    ring(v, at=c.get("at", 0.0), freqs=[f * 0.62, f * 1.07, f * 1.9], decay=c.get("decay", 0.06), g=c.get("g", 0.5) * c.get("ringMul", 0.22),
         to=c.get("to", v))


def seq(v: Voice, n: int, at: float, span: float, fn) -> None:
    for i in range(n):
        fn(at + span * (i + v.rnd(0.12, 0.88)) / n, i)


def cloth(v: Voice, **c) -> None:
    """Cloth rustle: overlapping soft pink bursts. keys: at n span f dur g to"""
    f = c.get("f", 2500.0)

    def one(at, i):
        burst(v, at=at, type="pink", filt="bandpass", f0=v.rnd(f * 0.7, f * 1.3), q=0.8, dur=c.get("dur", 0.06),
              g=c.get("g", 0.2) * v.rnd(0.6, 1.0), atk=0.012, to=c.get("to", v))
    seq(v, c.get("n", 3), c.get("at", 0.0), c.get("span", 0.2), one)


def pulses(v: Voice, **c) -> np.ndarray:
    """Many tiny noise impulses through one moving filter (skitter, gravel, rattle). keys: n at span dur type filt f0 f1 q g decay to"""
    s = v.s
    span = c.get("span", 0.4) / s
    n = max(1, c.get("n", 8))
    total = sec(span) + sec(0.06)
    src = dsp.noise(v.rng, total, c.get("type", "white"))
    freq = np.full(total, c.get("f0", 3000.0) * v.rate)
    gate = np.zeros(total)
    slot = span / n
    for i in range(n):
        ti = slot * (i + v.rnd(0.1, 0.9))
        d = min(slot * 0.8, max(0.002, v.jit(c.get("dur", 0.008), 0.3) / s))
        g = max(EPS, c.get("g", 0.4) * v.jit(1.0, 0.3) * (c.get("decay", 1.0) ** i))
        i0, i1 = sec(ti), min(total, sec(ti + d))
        if i1 <= i0 + 1:
            continue
        freq[i0:] = v.rnd(c.get("f0", 3000.0), c.get("f1", c.get("f0", 3000.0))) * v.rate
        gate[i0:i1] = np.maximum(gate[i0:i1], g * dsp.env(i1 - i0, 0.0008, 0, curve="exp"))
    x = dsp.biquad(src, c.get("filt", "bandpass"), freq, c.get("q", 3.0)) * gate
    x = fx(v, x, c)
    tgt = c.get("to", v)
    tgt.add(x, c.get("at", 0.0))
    return x


def tinkle(v: Voice, **c) -> None:
    """Cluster of short high sines (glass, brass, chime). keys: n at span f0 f1 dur g type to"""
    def one(at, i):
        tone(v, at=at, type=c.get("type", "sine"), f0=v.rnd(c.get("f0", 2500.0), c.get("f1", 6500.0)),
             dur=c.get("dur", 0.08) * v.rnd(0.6, 1.4), g=c.get("g", 0.08) * v.rnd(0.5, 1.0), atk=0.001, to=c.get("to", v))
    seq(v, c.get("n", 6), c.get("at", 0.0), c.get("span", 0.25), one)


def tremolo(x: np.ndarray, freq: float, depth: float, rng=None, jitter: float = 0.0) -> np.ndarray:
    n = len(x)
    f = np.full(n, freq)
    if jitter and rng is not None:
        k = max(2, n // 2205)
        w = np.interp(np.linspace(0, k - 1, n), np.arange(k), rng.standard_normal(k))
        f *= 1 + jitter * w
    ph = np.cumsum(f) / SR
    return x * (1 - depth + depth * np.sin(2 * np.pi * ph))


def trem(v: Voice, fn, freq: float = 20.0, depth: float = 0.4, at: float = 0.0, jitter: float = 0.1) -> np.ndarray:
    """Run fn(sub_voice) and add its output through a tremolo gain stage."""
    sv = v.sub()
    fn(sv)
    x = tremolo(sv.render(), freq, dsp.clamp(depth, 0, 0.5), v.rng, jitter)
    v.add(x, at)
    return x


def grunt(v: Voice, **c) -> None:
    """Throaty vocal pulse (hurt, cough): saw through lowpass + drive, doubled by band-limited noise. keys: at f0 f1 dur g atk lp to"""
    tone(v, at=c.get("at", 0.0), type="sawtooth", f0=c.get("f0", 120.0), f1=c.get("f1", 80.0), dur=c.get("dur", 0.16),
         g=c.get("g", 0.4) * 0.6, atk=c.get("atk", 0.015), lp=c.get("lp", 550.0), lq=1.2, shape=14, jitter=0.02, to=c.get("to", v))
    burst(v, at=c.get("at", 0.0), type="pink", filt="bandpass", f0=c.get("f0", 120.0) * 2.6, f1=c.get("f1", 80.0) * 2.4, q=1.6,
          dur=c.get("dur", 0.16), g=c.get("g", 0.4), atk=c.get("atk", 0.012), to=c.get("to", v))


def whoosh(v: Voice, **c) -> np.ndarray:
    """Air moving past: pink noise with a bandpass that sweeps and a swell envelope. keys: at f0 f1 q dur g peak(0..1 position)"""
    dur = v.jit(c.get("dur", 0.4), 0.1) / v.s
    n = sec(dur)
    x = dsp.pink(v.rng, n)
    freq = dsp.sweep(n, c.get("f0", 400.0) * v.rate, c.get("f1", 2500.0) * v.rate, "exp")
    x = dsp.biquad(x, "bandpass", freq, c.get("q", 1.2))
    p = c.get("peak", 0.6)
    e = np.concatenate([dsp.curve_seg(int(n * p), 0, 1, "cos"), dsp.curve_seg(n - int(n * p), 1, 0, "cos")])
    x *= e * c.get("g", 0.5)
    x = fx(v, x, c)
    tgt = c.get("to", v)
    tgt.add(x, c.get("at", 0.0))
    return x


def rattle(v: Voice, **c) -> None:
    """Loose small parts: clusters of bright modal ticks. keys: at n span freqs g t60 decay"""
    freqs = c.get("freqs", [3200, 4700, 6100])
    for i in range(c.get("n", 5)):
        at = c.get("at", 0.0) + c.get("span", 0.2) * (i + v.rnd(0.1, 0.9)) / c.get("n", 5)
        modal(v, at=at, freqs=[f * v.rnd(0.9, 1.1) for f in freqs], t60s=[c.get("t60", 0.05)] * len(freqs),
              amps=[1.0, 0.6, 0.4][:len(freqs)], exc=0.0012, g=c.get("g", 0.2) * (c.get("decay", 0.9) ** i) * v.rnd(0.6, 1.0))


# ---------------------------------------------------------------------------------------------------------- bodies
def metal_body(v: Voice, **c) -> None:
    """A struck metal object: dense inharmonic modes. keys: at f(base) g t60 n thick(0..1) to"""
    f = c.get("f", 1800.0)
    n = c.get("n", 7)
    thick = c.get("thick", 0.4)
    ratios = np.array([1.0, 1.58, 2.24, 2.9, 3.6, 4.4, 5.3, 6.1, 7.2, 8.6])[:n] * (1 + v.rng.uniform(-0.04, 0.04, n))
    amps = (1.0 / (1 + np.arange(n) * (0.5 + thick))) * (1 + v.rng.uniform(-0.3, 0.3, n))
    t60 = c.get("t60", 0.4) * (1.0 / (1 + np.arange(n) * 0.35))
    modal(v, at=c.get("at", 0.0), freqs=list(f * ratios), t60s=list(t60), amps=list(amps), exc=c.get("exc", 0.0015),
          bright=c.get("bright"), g=c.get("g", 0.3), to=c.get("to", v), hp=c.get("hp"), lp=c.get("lp"))


def wood_body(v: Voice, **c) -> None:
    """Wood knock: a few low damped modes plus a papery transient. keys: at f g t60 to"""
    f = c.get("f", 240.0)
    modal(v, at=c.get("at", 0.0), freqs=[f, f * 1.9, f * 2.7, f * 4.2, f * 6.1], t60s=[c.get("t60", 0.12), 0.08, 0.06, 0.04, 0.03],
          amps=[1.0, 0.5, 0.35, 0.2, 0.1], exc=0.0025, bright=3000, g=c.get("g", 0.4), to=c.get("to", v))
    burst(v, at=c.get("at", 0.0), type="white", filt="lowpass", f0=1600, q=0.7, dur=0.02, g=c.get("g", 0.4) * 0.5, atk=0.0006, to=c.get("to", v))


def glass_body(v: Voice, **c) -> None:
    f = c.get("f", 3200.0)
    modal(v, at=c.get("at", 0.0), freqs=[f, f * 1.36, f * 1.83, f * 2.5, f * 3.1], t60s=[c.get("t60", 0.35), 0.28, 0.2, 0.12, 0.08],
          amps=[1.0, 0.7, 0.5, 0.3, 0.2], exc=0.001, g=c.get("g", 0.25), to=c.get("to", v))


# ---------------------------------------------------------------------------------------------------------- gunshot
def gunshot(v: Voice, **p) -> None:
    """Layered report: muzzle transient, saturated blast, bass punch, mid growl, boom, mechanical clacks, air tail.
    Reverb is applied afterwards by the recipe (reverb.place). Parameters are per calibre, see recipes_weapons."""
    # 1. transient: a very fast broadband snap
    click(v, g=p.get("clickG", 0.9), f=p.get("clickF", 3800.0), dur=0.0025, q=0.9)
    burst(v, type="white", filt="highpass", f0=1800, q=0.7, dur=0.006, g=p.get("clickG", 0.9) * 0.8, atk=0.0003)
    # 2. blast: bandpass sweep down, saturated
    burst(v, type="white", filt="bandpass", f0=p.get("crackF0", 4000.0), f1=p.get("crackF1", 400.0), q=p.get("crackQ", 0.7),
          dur=p.get("crackDur", 0.07), g=p.get("crackG", 1.0), atk=0.0008, sat=p.get("crackSat", 3.0))
    burst(v, at=0.002, type="white", filt="lowpass", f0=p.get("blastF0", 6000.0), f1=p.get("blastF1", 500.0), q=0.8,
          dur=p.get("blastDur", 0.05), g=p.get("blastG", 0.7), atk=0.0005, sat=4.0)
    # 3. punch: sine drop + brown burst
    thump(v, f0=p.get("thumpF0", 90.0), f1=p.get("thumpF1", 30.0), dur=p.get("thumpDur", 0.12), g=p.get("thumpG", 0.9), sat=1.5)
    burst(v, type="brown", filt="lowpass", f0=p.get("punchF", 260.0), f1=p.get("punchF", 260.0) * 0.5, q=0.8,
          dur=p.get("thumpDur", 0.12) * 1.1, g=p.get("thumpG", 0.9) * 0.6, atk=0.001)
    # 4. growl body
    tone(v, type="sawtooth", f0=p.get("bodyF0", 140.0), f1=p.get("bodyF1", 60.0), dur=p.get("bodyDur", 0.05), g=p.get("bodyG", 0.4),
         lp=p.get("bodyLp", 900.0), shape=p.get("bodyShape", 8), atk=0.001)
    # 5. boom for big bores
    if p.get("boomG"):
        burst(v, type="brown", filt="lowpass", f0=p.get("boomF", 400.0), f1=p.get("boomF", 400.0) * 0.4, q=0.7,
              dur=p.get("boomDur", 0.2), g=p["boomG"], atk=0.002, sat=2.0)
    # 6. barrel resonance (a short comb-coloured breath out of the bore)
    if p.get("boreLen"):
        sv = v.sub()
        burst(sv, type="white", filt="lowpass", f0=3000, q=0.7, dur=0.03, g=0.6, atk=0.0005)
        x = dsp.comb(sv.render(), p["boreLen"] / 343.0 * 2.0, 0.55, 3500.0)
        v.add(x, 0.001, p.get("boreG", 0.25))
    # 7. air tail (short; the space adds the rest)
    tail(v, dur=p.get("tailDur", 0.35) * 0.7, g=p.get("tailG", 0.15) * 0.5, f0=p.get("tailF0", 2500.0), f1=p.get("tailF1", 300.0))
    # 8. mechanical action
    for m in p.get("mech", []):
        clack(v, at=m["at"], f=m.get("f", 2400.0), g=m.get("g", 0.3), dur=0.012, decay=m.get("decay", 0.05))
        if m.get("slide"):
            burst(v, at=m["at"] + 0.004, type="white", filt="bandpass", f0=m.get("f", 2400.0) * 0.8, q=1.2, dur=m["slide"], g=m.get("g", 0.3) * 0.5, atk=0.004)
