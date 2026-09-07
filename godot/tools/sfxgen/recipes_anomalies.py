"""Anomalies and artifacts: hums per type (loops), their events, probes, the detector's tiers, artifact resonance."""
import numpy as np
from . import dsp, synth, reverb
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, glass_body, whoosh, rattle
from .registry import sound, define, alias

LOOP = 8.0


def _lfo(v: Voice, n: int, f: float, depth: float, base: float = 1.0) -> np.ndarray:
    return base + depth * np.sin(2 * np.pi * f * np.arange(n) / dsp.SR + v.rnd(0, 6.28))


# ------------------------------------------------------------------------------------------------------ electric arcs
@sound("arc_hum", 1, "loop", peak=-10.0, loop=True, desc="8 s: the electric anomaly's mains-like buzz with a moving resonance and random crackles", tags=["anomaly", "loop"])
def arc_hum(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    sq = dsp.osc(n, 100.0 * (1.0 + 0.004 * np.sin(2 * np.pi * 0.31 * tt)), "square")
    x = dsp.biquad(sq, "bandpass", 800.0 + 200.0 * np.sin(2 * np.pi * 0.7 * tt) + 120.0 * np.sin(2 * np.pi * 2.3 * tt), 2.0) * 0.5
    x += dsp.osc(n, 50.0, "sine") * 0.12
    x += dsp.biquad(dsp.osc(n, 100.0, "sawtooth"), "bandpass", 2400.0 + 600.0 * np.sin(2 * np.pi * 0.17 * tt), 4.0) * 0.12
    x += dsp.highpass(dsp.crackle(v.rng, n, 40.0, 0.3), 2000.0) * 0.3 * _lfo(v, n, 0.4, 0.5, 0.5)
    v.add(x, 0.0)
    t = 0.2
    while t < LOOP - 0.1:
        burst(v, at=t, type="white", filt="bandpass", f0=v.rnd(2000, 6000), q=2, dur=v.rnd(0.006, 0.03), g=v.rnd(0.15, 0.5), atk=0.0005)
        t += v.rnd(0.08, 0.6)
    v.buf = v.buf[:n]


@sound("arc_zap", 4, "anomaly", peak=-2.0, desc="a discharge between the nodes: snap, sizzle, a low thud", tags=["anomaly"])
def arc_zap(v, i):
    burst(v, type="white", filt="bandpass", f0=3000, f1=800, q=0.8, dur=0.12, g=1.2, atk=0.001, sat=3.0)
    tone(v, f0=6000, f1=1500, dur=0.06, g=0.2, atk=0.001)
    burst(v, type="crackle", filt="lowpass", f0=5000, q=0.7, dur=0.45, g=0.7, atk=0.005)
    burst(v, at=0.02, type="crackle_fine", filt="bandpass", f0=4000, q=1.0, dur=0.3, g=0.4, atk=0.01)
    thump(v, f0=120, f1=50, dur=0.08, g=0.5)
    tone(v, type="square", f0=100, f1=90, dur=0.1, g=0.3, atk=0.001, shape=30, bp=1500, bq=1)
    tone(v, at=0.005, type="sawtooth", f0=v.rnd(1800, 2600), f1=v.rnd(600, 900), dur=0.15, g=0.15, atk=0.002, bp=2000, bq=1.5, jitter=0.05)
    return reverb.place(dsp.saturate(v.render(), 1.5), "village", v.rng, wet_db=-9.0)


@sound("arc_charge", 3, "anomaly", desc="the arcs winding up before a discharge: a rising whine and thickening buzz", tags=["anomaly"])
def arc_charge(v, i):
    tone(v, type="sawtooth", f0=300, f1=2400, dur=0.9, g=0.2, atk=0.3, curve="lin", lp=4000, jitter=0.02)
    tone(v, type="square", f0=100, dur=0.9, g=0.15, atk=0.4, curve="lin", bp=1200, bq=2)
    burst(v, type="crackle_fine", filt="bandpass", f0=3000, q=1.2, dur=0.9, g=0.12, atk=0.5, curve="lin")
    tone(v, type="sawtooth", f0=150, f1=1200, dur=0.9, g=0.1, atk=0.3, curve="lin", bp=1500, bq=2)


# ------------------------------------------------------------------------------------------------------ reflector
@sound("reflector_hum", 1, "loop", peak=-14.0, loop=True, desc="8 s: floating glass — three high partials beating, a whisper of air", tags=["anomaly", "loop"])
def reflector_hum(v, i):
    n = dsp.sec(LOOP)
    x = np.zeros(n)
    for f, amf, g in ((2093.0, 0.17, 0.28), (2637.0, 0.23, 0.22), (3136.0, 0.31, 0.16), (1046.5, 0.11, 0.1)):
        x += dsp.osc(n, f * (1.0 + 0.0015 * np.sin(2 * np.pi * v.rnd(0.3, 0.5) * np.arange(n) / dsp.SR)), "sine") * g * _lfo(v, n, amf, 0.5)
    x += dsp.highpass(dsp.white(v.rng, n), 6000.0) * 0.02 * _lfo(v, n, 0.09, 0.6)
    v.add(x, 0.0)
    for k in range(v.irnd(4, 7)):
        glass_body(v, at=v.rnd(0.0, LOOP - 0.5), f=v.rnd(3000, 5000), g=0.05, t60=0.4)
    v.buf = v.buf[:n]


@sound("reflector_whip", 3, "anomaly", desc="a shard whipping past: a rising hiss and two glass tones", tags=["anomaly"])
def reflector_whip(v, i):
    burst(v, type="white", filt="bandpass", f0=1200, f1=5500, q=1.5, dur=0.3, g=0.5, atk=0.08)
    tone(v, at=0.05, f0=2600, dur=0.35, g=0.2, atk=0.002)
    tone(v, at=0.06, f0=3900, dur=0.25, g=0.1, atk=0.002)
    glass_body(v, at=0.05, f=v.rnd(3400, 4400), g=0.2, t60=0.4)


@sound("reflector_shatter", 2, "anomaly", desc="the reflector collapsing into falling glass", tags=["anomaly"])
def reflector_shatter(v, i):
    burst(v, type="white", filt="highpass", f0=3000, q=0.7, dur=0.05, g=0.6, atk=0.0005)
    tinkle(v, n=v.irnd(18, 26), at=0.01, span=1.2, f0=2500, f1=8000, dur=0.12, g=0.08)
    for k in range(v.irnd(8, 12)):
        glass_body(v, at=v.rnd(0.02, 1.0), f=v.rnd(2800, 6500), g=0.12, t60=0.25)
    tone(v, f0=3000, f1=400, dur=1.2, g=0.1, atk=0.05, curve="lin")
    return reverb.place(v.render(), "village", v.rng, wet_db=-8.0)


# ------------------------------------------------------------------------------------------------------ gravity
@sound("gravity_drone", 1, "loop", peak=-8.0, loop=True, desc="8 s: the gravity sink — 38 Hz beating with itself, a slow pull, debris grinding", tags=["anomaly", "loop"])
def gravity_drone(v, i):
    n = dsp.sec(LOOP)
    x = dsp.osc(n, 38.0, "sine") * 0.6 + dsp.osc(n, 38.7, "sine") * 0.5 + dsp.osc(n, 76.5, "sine") * 0.25
    x *= _lfo(v, n, 0.07, 0.25, 0.75)
    x += dsp.lowpass(dsp.brown(v.rng, n), 60.0) * 0.15
    x += dsp.biquad(dsp.pink(v.rng, n), "bandpass", 220.0 + 60.0 * np.sin(2 * np.pi * 0.05 * np.arange(n) / dsp.SR), 3.0) * 0.12 * _lfo(v, n, 0.11, 0.6)
    v.add(x, 0.0)
    for k in range(v.irnd(3, 6)):
        modal(v, at=v.rnd(0.0, LOOP - 0.5), freqs=[v.rnd(500, 1100), v.rnd(1300, 2200)], t60s=[0.2, 0.1], amps=[1, 0.4], exc=0.004, g=0.05)
    v.buf = v.buf[:n]


@sound("gravity_crush", 3, "anomaly", peak=-2.0, desc="the sink closing: a brown roar collapsing to a sub thud, a thin whine left over", tags=["anomaly"])
def gravity_crush(v, i):
    burst(v, type="brown", filt="lowpass", f0=250, q=0.8, dur=0.5, g=1.0, atk=0.02, sat=2.0)
    burst(v, type="crackle", filt="lowpass", f0=1500, q=0.7, dur=0.5, g=0.5, atk=0.01)
    thump(v, f0=40, f1=18, dur=0.6, g=1.0, sat=1.5)
    whoosh(v, f0=2000, f1=150, q=0.8, dur=0.45, g=0.5, peak=0.3)
    tone(v, at=0.3, f0=4200, f1=5200, dur=1.5, g=0.08, atk=0.1, hold=0.4, curve="lin")
    pulses(v, n=v.irnd(6, 10), at=0.1, span=0.4, type="white", f0=800, f1=2000, q=2.5, dur=0.01, g=0.2, decay=0.85)  # things breaking
    return reverb.place(dsp.saturate(v.render(), 1.5), "field", v.rng, wet_db=-8.0)


@sound("gravity_pull", 3, "anomaly", desc="the pull taking hold of you: a rising sub and the air rushing", tags=["anomaly"])
def gravity_pull(v, i):
    tone(v, f0=30, f1=60, dur=1.2, g=0.6, atk=0.3, curve="lin")
    whoosh(v, f0=200, f1=1200, q=0.7, dur=1.2, g=0.4, peak=0.8)
    burst(v, type="pink", filt="bandpass", f0=300, f1=900, q=1.5, dur=1.2, g=0.2, atk=0.4, curve="lin")


# ------------------------------------------------------------------------------------------------------ gas
@sound("gas_hiss", 1, "loop", peak=-12.0, loop=True, desc="8 s: gas venting from the ground, with bubbling and a chemical whistle", tags=["anomaly", "loop"])
def gas_hiss(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    h = dsp.biquad(dsp.pink(v.rng, n), "highpass", 1500.0 + 400.0 * np.sin(2 * np.pi * 0.15 * tt), 0.6) * 0.35 * _lfo(v, n, 0.15, 0.3)
    b = dsp.lowpass(dsp.crackle(v.rng, n, 90.0, 0.6), 900.0) * 0.2 * _lfo(v, n, 0.3, 0.4)
    w = dsp.biquad(dsp.white(v.rng, n), "bandpass", 5200.0 + 900.0 * np.sin(2 * np.pi * 0.23 * tt), 12.0) * 0.08 * _lfo(v, n, 0.4, 0.8, 0.4)
    v.add(h + b + w, 0.0)
    for k in range(v.irnd(6, 10)):  # bubbles
        f = v.rnd(300, 900)
        tone(v, at=v.rnd(0.0, LOOP - 0.2), f0=f, f1=f * 1.8, dur=v.rnd(0.03, 0.08), g=0.08, atk=0.005)
    v.buf = v.buf[:n]


@sound("gas_burst", 3, "anomaly", desc="a pocket of gas bursting from the mud", tags=["anomaly"])
def gas_burst(v, i):
    burst(v, type="pink", filt="bandpass", f0=500, f1=250, q=1.2, dur=0.2, g=0.5, atk=0.01, pr=1.2, pr1=0.6)
    thump(v, f0=90, f1=45, dur=0.12, g=0.4)
    burst(v, at=0.05, type="white", filt="bandpass", f0=2500, f1=1200, q=1.2, dur=0.6, g=0.15, atk=0.03)
    for k in range(v.irnd(3, 6)):
        f = v.rnd(300, 800)
        tone(v, at=v.rnd(0.0, 0.25), f0=f, f1=f * 1.8, dur=0.05, g=0.1, atk=0.005)


# ------------------------------------------------------------------------------------------------------ distortion / heat
@sound("distortion_hum", 1, "loop", peak=-12.0, loop=True, desc="8 s: a distortion — the air itself detuned: two close tones beating, phasey noise, sub", tags=["anomaly", "loop"])
def distortion_hum(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = dsp.osc(n, 220.0 * (1.0 + 0.01 * np.sin(2 * np.pi * 0.13 * tt)), "sine") * 0.2
    x += dsp.osc(n, 223.0, "sine") * 0.18 + dsp.osc(n, 330.0 * (1.0 + 0.008 * np.sin(2 * np.pi * 0.21 * tt)), "triangle") * 0.06
    ph = dsp.biquad(dsp.pink(v.rng, n), "bandpass", 1200.0 * 2 ** (0.8 * np.sin(2 * np.pi * 0.09 * tt)), 1.5) * 0.25
    ph = ph * _lfo(v, n, 0.31, 0.5)
    x += ph + dsp.osc(n, 55.0, "sine") * 0.15 * _lfo(v, n, 0.06, 0.5)
    # reversed shards of itself, scattered
    for k in range(v.irnd(3, 5)):
        i0 = int(v.rnd(0.1, 0.7) * n); m = dsp.sec(v.rnd(0.2, 0.5))
        seg = x[i0:i0 + m][::-1] * dsp.env(min(m, n - i0), 0.05, 0, curve="cos") * 0.5
        x = dsp.mix_into(x, seg, int(v.rnd(0.1, 0.8) * n))[:n]
    v.add(x, 0.0)
    v.buf = v.buf[:n]


@sound("distortion_warp", 3, "anomaly", desc="stepping into a distortion: the world bending, a smeared tone falling and rising", tags=["anomaly"])
def distortion_warp(v, i):
    tone(v, f0=880, f1=220, dur=0.6, g=0.25, atk=0.05, curve="cos", vib=dict(f=7, depth=30))
    tone(v, at=0.4, f0=220, f1=1100, dur=0.6, g=0.2, atk=0.1, curve="cos", type="triangle")
    whoosh(v, f0=300, f1=3000, q=1.0, dur=0.8, g=0.35, peak=0.5)
    sv = v.sub(); burst(sv, type="pink", filt="bandpass", f0=1500, q=1, dur=0.5, g=0.3, atk=0.05)
    v.add(sv.render()[::-1], 0.3)
    thump(v, at=0.3, f0=50, f1=30, dur=0.4, g=0.4)


@sound("heat_roar", 1, "loop", peak=-10.0, loop=True, desc="8 s: a heat spout — a low roaring flame with pressure surges", tags=["anomaly", "loop"])
def heat_roar(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = dsp.crackle(v.rng, n, 1500.0, 0.6) * 0.5 + dsp.pink(v.rng, n) * 0.7
    x = dsp.biquad(x, "lowpass", 900.0 + 500.0 * np.sin(2 * np.pi * 0.2 * tt) + 200.0 * np.sin(2 * np.pi * 1.3 * tt), 0.9)
    x *= _lfo(v, n, 0.17, 0.35) * _lfo(v, n, 0.9, 0.15)
    x += dsp.lowpass(dsp.brown(v.rng, n), 70.0) * 0.25 * _lfo(v, n, 0.11, 0.5)
    v.add(dsp.saturate(x, 1.5), 0.0)
    v.buf = v.buf[:n]


@sound("heat_burst", 3, "anomaly", desc="the spout flaring", tags=["anomaly"])
def heat_burst(v, i):
    burst(v, type="brown", filt="lowpass", f0=300, f1=150, q=0.8, dur=0.4, g=0.8, atk=0.02, sat=2.0)
    whoosh(v, f0=400, f1=2500, q=0.8, dur=0.5, g=0.5, peak=0.25)
    burst(v, at=0.05, type="crackle", filt="lowpass", f0=3000, q=0.7, dur=0.8, g=0.4, atk=0.02)
    thump(v, f0=70, f1=30, dur=0.3, g=0.6)


# ------------------------------------------------------------------------------------------------------ probes, detector, artifacts
@sound("probe_throw", 3, "foley", desc="a probe thrown: the arm, the little steel body tumbling off", tags=["probe"])
def probe_throw(v, i):
    whoosh(v, f0=600, f1=2500, q=1.0, dur=0.28, g=0.4, peak=0.55)
    cloth(v, n=2, span=0.08, g=0.12)
    rattle(v, at=0.1, n=2, span=0.06, freqs=[3000, 4500], g=0.04, t60=0.03)


def _probe_land(v: Voice, surface: str):
    if surface == "soft":
        thump(v, f0=150, f1=70, dur=0.05, g=0.45)
        burst(v, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.05, g=0.45, atk=0.001)
        burst(v, type="pink", filt="bandpass", f0=1400, q=0.8, dur=0.07, g=0.22, atk=0.003)
        click(v, f=2500, g=0.12)
    elif surface == "wood":
        wood_body(v, f=230, g=0.5, t60=0.06)
        modal(v, freqs=[2400, 3300], t60s=[0.05, 0.03], amps=[1, 0.5], exc=0.001, g=0.06)
        wood_body(v, at=0.11, f=230, g=0.25, t60=0.05)
    elif surface == "metal":
        burst(v, type="white", filt="bandpass", f0=3000, q=2, dur=0.015, g=0.5, atk=0.0005)
        metal_body(v, f=v.rnd(1100, 1600), g=0.3, t60=0.25, n=8, thick=0.4)
        for k in range(v.irnd(1, 2)):
            t = 0.09 + k * 0.14
            metal_body(v, at=t, f=v.rnd(1500, 2200), g=0.15 * 0.6 ** k, t60=0.12, n=6)
    elif surface == "water":
        burst(v, type="white", filt="bandpass", f0=3000, f1=700, q=1, dur=0.12, g=0.4, atk=0.003)
        tone(v, f0=400, f1=1200, dur=0.05, g=0.2, atk=0.002)
        tinkle(v, n=3, at=0.05, span=0.15, f0=1200, f1=2600, dur=0.03, g=0.04)
    else:  # hard: concrete, rock, road, gravel
        burst(v, type="white", filt="bandpass", f0=3000, q=2, dur=0.015, g=0.5, atk=0.0005)
        modal(v, freqs=[2400, 3600, 5200], t60s=[0.08, 0.06, 0.04], amps=[1, 0.6, 0.3], exc=0.001, g=0.2)
        for k in range(v.irnd(1, 2)):
            t = 0.09 + k * 0.13
            burst(v, at=t, type="white", filt="bandpass", f0=3000, q=2, dur=0.012, g=0.3 * 0.6 ** k, atk=0.0005)
            modal(v, at=t, freqs=[2400, 3800], t60s=[0.05, 0.03], amps=[1, 0.5], exc=0.001, g=0.08)
        burst(v, type="pink", filt="bandpass", f0=1500, q=0.8, dur=0.05, g=0.1, atk=0.003)


define("probe_land", lambda v, i: _probe_land(v, "hard"), variants=3, cat="foley", desc="a probe landing (hard ground; see probe_land_<kind>)", tags=["probe"])
for _k in ("soft", "hard", "wood", "metal", "water"):
    define("probe_land_%s" % _k, (lambda k: lambda v, i: _probe_land(v, k))(_k), variants=3, cat="foley", desc="a probe landing on %s" % _k, tags=["probe"])
for _s, _k in (("grass", "soft"), ("dirt", "soft"), ("mud", "soft"), ("sand", "soft"), ("snow", "soft"), ("concrete", "hard"), ("rock", "hard"), ("road", "hard"), ("gravel", "hard")):
    alias("probe_land_%s" % _s, "probe_land_%s" % _k)


@sound("probe_bounce", 3, "foley", peak=-14.0, desc="a probe's second bounce", tags=["probe"])
def probe_bounce(v, i):
    burst(v, type="white", filt="bandpass", f0=3000, q=2, dur=0.01, g=0.3, atk=0.0005)
    modal(v, freqs=[2500, 3900], t60s=[0.05, 0.03], amps=[1, 0.5], exc=0.001, g=0.12)


@sound("probe_trigger", 3, "anomaly", desc="a probe finding an anomaly: a bright ping and its harmonic", tags=["probe"])
def probe_trigger(v, i):
    tone(v, f0=1400, f1=2800, dur=0.05, g=0.15, atk=0.002)
    tone(v, at=0.03, f0=2800, dur=0.5, g=0.35, atk=0.002)
    tone(v, at=0.03, f0=4200, dur=0.3, g=0.15, atk=0.002)
    tone(v, at=0.03, f0=2803, dur=0.45, g=0.15, atk=0.002)
    burst(v, type="white", filt="highpass", f0=5000, q=0.5, dur=0.04, g=0.2, atk=0.001)


def _tick(v: Voice, at: float, g: float, f: float = 4000.0):
    burst(v, at=at, type="white", filt="bandpass", f0=3400, q=1.2, dur=0.003, g=0.5 * g, atk=0.0002)
    tone(v, at=at, f0=f, f1=f * 0.6, dur=0.006, g=0.3 * g, atk=0.0003)
    modal(v, at=at, freqs=[3100, 4700], t60s=[0.02, 0.012], amps=[1, 0.4], exc=0.0004, g=0.35 * g)  # the little speaker's resonance


@sound("detector_tick", 3, "ui", peak=-10.0, desc="one Geiger-like tick of the Veer detector", tags=["detector"])
def detector_tick(v, i):
    _tick(v, 0.0, 1.0)


@sound("detector_far", 2, "ui", peak=-12.0, desc="1.5 s: the detector at the edge of its range — a tick every second", tags=["detector"])
def detector_far(v, i):
    _tick(v, 0.0, 0.8); _tick(v, 1.0 * v.rnd(0.95, 1.05), 0.8)
    v.buf = dsp.pad_to(v.buf, dsp.sec(1.5))[:dsp.sec(1.5)]


@sound("detector_mid", 2, "ui", peak=-10.0, desc="1.5 s: closer — ticks every quarter second", tags=["detector"])
def detector_mid(v, i):
    t = 0.0
    while t < 1.45:
        _tick(v, t, v.rnd(0.8, 1.0)); t += 0.25 * v.rnd(0.9, 1.1)
    v.buf = dsp.pad_to(v.buf, dsp.sec(1.5))[:dsp.sec(1.5)]


@sound("detector_near", 2, "ui", peak=-8.0, desc="1.5 s: near — a fast chatter of ticks", tags=["detector"])
def detector_near(v, i):
    t = 0.0
    while t < 1.45:
        _tick(v, t, v.rnd(0.7, 1.0), 4400.0); t += 0.09 * v.rnd(0.8, 1.2)
    v.buf = dsp.pad_to(v.buf, dsp.sec(1.5))[:dsp.sec(1.5)]


@sound("detector_close", 2, "ui", peak=-8.0, desc="1.5 s: touching distance — ticks blur into a buzz and a tone rises", tags=["detector"])
def detector_close(v, i):
    t = 0.0
    while t < 1.45:
        _tick(v, t, v.rnd(0.6, 0.9), 4800.0); t += 0.035 * v.rnd(0.8, 1.2)
    tone(v, at=0.0, f0=3200, f1=4000, dur=1.5, g=0.1, atk=0.4, hold=0.8, curve="lin")
    v.buf = dsp.pad_to(v.buf, dsp.sec(1.5))[:dsp.sec(1.5)]


@sound("detector_ping", 3, "ui", peak=-10.0, desc="the Bear/Svarog detector's directional ping", tags=["detector"])
def detector_ping(v, i):
    tone(v, f0=2200, dur=0.12, g=0.3, atk=0.002)
    tone(v, at=0.0, f0=3300, dur=0.08, g=0.12, atk=0.002)
    click(v, f=4000, g=0.2, dur=0.003)


@sound("detector_lock", 2, "ui", peak=-10.0, desc="the Svarog naming the type: two rising beeps", tags=["detector"])
def detector_lock(v, i):
    tone(v, f0=1800, dur=0.08, g=0.3, atk=0.002, type="square", lp=5000)
    tone(v, at=0.12, f0=2700, dur=0.12, g=0.3, atk=0.002, type="square", lp=5000)


@sound("artifact_pickup", 3, "anomaly", peak=-8.0, desc="an artifact taken in hand: a chord of glass partials and a shiver of air", tags=["artifact"])
def artifact_pickup(v, i):
    for k, f in enumerate([1320, 1760, 2200, 2640, 3520]):
        tone(v, at=k * 0.04, f0=f, dur=v.rnd(0.6, 1.0) * (1 - k * 0.08), g=0.15 * 0.85 ** k, atk=0.004, vib=dict(f=5.5, depth=4))
    burst(v, type="white", filt="highpass", f0=5000, q=0.5, dur=0.5, g=0.06, atk=0.05)
    cloth(v, n=2, span=0.1, g=0.1)
    glass_body(v, at=0.02, f=v.rnd(3800, 4600), g=0.12, t60=0.6)


def _art_hum(v: Voice, base: float, kind: str):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = np.zeros(n)
    if kind == "pearl":  # pure, slow, but alive: a beating twin, a breath of air, glass ticks
        x += dsp.osc(n, base * (1.0 + 0.003 * np.sin(2 * np.pi * 0.4 * tt)), "sine") * 0.3 * _lfo(v, n, 0.2, 0.15)
        x += dsp.osc(n, base * 1.004, "sine") * 0.2 * _lfo(v, n, 0.13, 0.4)
        x += dsp.osc(n, base * 2.0, "sine") * 0.06 + dsp.osc(n, base * 3.01, "sine") * 0.03 + dsp.osc(n, base * 1.5, "triangle") * 0.03 * _lfo(v, n, 0.07, 0.8)
        x += dsp.biquad(dsp.pink(v.rng, n), "bandpass", base * 4.0, 8.0) * 0.08 * _lfo(v, n, 0.09, 0.7)
        for k in range(v.irnd(3, 6)):
            glass_body(v, at=v.rnd(0.0, LOOP - 0.6), f=base * v.rnd(4, 8), g=0.04, t60=0.5)
    elif kind == "ember":  # warm, crackling
        x += dsp.osc(n, base * 0.5, "triangle") * 0.2 * _lfo(v, n, 0.9, 0.3)
        x += dsp.lowpass(dsp.crackle(v.rng, n, 30.0, 0.7), 1500.0) * 0.2
        x += dsp.osc(n, base * 0.75, "sine") * 0.08 * _lfo(v, n, 0.3, 0.5)
    elif kind == "tear":  # wet, glassy
        x += dsp.osc(n, base * 1.5, "sine") * 0.15 * _lfo(v, n, 1.7, 0.4)
        for k in range(v.irnd(6, 10)):
            f = v.rnd(base * 2, base * 5)
            t0 = v.rnd(0.0, LOOP - 0.2)
            m = dsp.sec(0.15)
            x = dsp.mix_into(x, dsp.osc(m, dsp.sweep(m, f, f * 1.5), "sine") * dsp.env(m, 0.01, 0, curve="exp") * 0.1, dsp.sec(t0))[:n]
    else:  # organic: spine/heart — a slow pulse
        x += dsp.osc(n, base * 0.25, "sine") * 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * 1.1 * tt)) ** 4
        x += dsp.biquad(dsp.pink(v.rng, n), "bandpass", base, 6.0) * 0.15 * _lfo(v, n, 0.13, 0.5)
    v.add(x, 0.0)
    v.buf = v.buf[:n]


define("artifact_hum", lambda v, i: _art_hum(v, v.rnd(600, 720), "pearl"), variants=1, cat="loop", peak=-16.0, loop=True, desc="8 s: a generic artifact's hum (legacy name)", tags=["artifact", "loop"])
for _k, _f in (("pearl", 660.0), ("ember", 330.0), ("tear", 880.0), ("organic", 440.0)):
    define("artifact_hum_%s" % _k, (lambda k, f: lambda v, i: _art_hum(v, f * v.rnd(0.95, 1.05), k))(_k, _f), variants=1, cat="loop", peak=-16.0, loop=True, desc="8 s: %s-type artifact hum" % _k, tags=["artifact", "loop"])
for _id, _k in (("art_pearl", "pearl"), ("art_lens", "pearl"), ("art_snow", "pearl"), ("art_ember", "ember"), ("art_thorn", "ember"), ("art_crown", "ember"), ("art_tear", "tear"), ("art_bracelet", "tear"), ("art_egg", "tear"),
                ("art_spine", "organic"), ("art_heart", "organic"), ("art_knot", "organic")):
    alias("artifact_hum_%s" % _id[4:], "artifact_hum_%s" % _k)


@sound("artifact_resonance", 3, "anomaly", peak=-10.0, desc="an artifact answering the detector: a swell of its partials", tags=["artifact"])
def artifact_resonance(v, i):
    base = v.rnd(500, 900)
    for k, r in enumerate([1.0, 1.5, 2.0, 2.98, 4.02]):
        tone(v, f0=base * r, dur=1.4 - k * 0.15, g=0.15 * 0.8 ** k, atk=0.3, hold=0.3, curve="cos", vib=dict(f=v.rnd(4, 7), depth=base * r * 0.004))
    burst(v, type="white", filt="highpass", f0=6000, q=0.5, dur=1.0, g=0.04, atk=0.4)
