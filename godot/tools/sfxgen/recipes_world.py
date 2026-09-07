"""The world around the explorer: doors, hatches, lockers, containers, the base, the Tide, and the legacy ambience names
the game logic calls by name (wind, radius_hum, base_hum, drizzle, crow, bird, drip, thunder)."""
import numpy as np
from . import dsp, synth, reverb
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, glass_body, whoosh, rattle
from .registry import sound, define, alias


# ------------------------------------------------------------------------------------------------------ doors
def _creak(v: Voice, at: float, f0: float, f1: float, dur: float, g: float, lp: float = 1800.0):
    trem(v, lambda sv: tone(sv, type="sawtooth", f0=f0, f1=f1, dur=dur, g=g, atk=dur * 0.3, lp=lp, lq=2.5, shape=12, curve="lin", jitter=0.02),
         freq=v.rnd(9, 15), depth=0.45, jitter=0.15, at=at)


def _clunk(v: Voice, at: float, g: float, f: float = 90.0):
    thump(v, at=at, f0=f, f1=f * 0.5, dur=0.2, g=g * 0.9)
    burst(v, at=at, type="brown", filt="lowpass", f0=300, q=0.7, dur=0.18, g=g * 0.6, atk=0.001)
    modal(v, at=at, freqs=[230, 380, 610], t60s=[0.4, 0.3, 0.2], amps=[1, 0.6, 0.35], exc=0.003, g=g * 0.15)
    burst(v, at=at, type="white", filt="bandpass", f0=1500, q=1, dur=0.02, g=g * 0.3, atk=0.001)


@sound("door_wood_open", 3, "world", desc="a wooden door: latch, the hinge's dry creak, the stop", tags=["door"])
def door_wood_open(v, i):
    clack(v, f=1900, g=0.35, dur=0.012, decay=0.06)  # latch
    wood_body(v, at=0.002, f=180, g=0.3, t60=0.12)
    _creak(v, 0.08, v.rnd(260, 380), v.rnd(180, 260), v.rnd(0.5, 0.8), 0.14)
    pulses(v, n=v.irnd(4, 8), at=0.1, span=0.6, type="white", f0=1600, f1=2800, q=3, dur=0.01, g=0.1)  # dry hinge ticks
    wood_body(v, at=0.85, f=140, g=0.35, t60=0.15)  # the door against the wall
    burst(v, at=0.85, type="brown", filt="lowpass", f0=300, q=0.7, dur=0.1, g=0.3, atk=0.002)


@sound("door_wood_close", 3, "world", desc="a wooden door pulled shut: creak, the frame, the latch", tags=["door"])
def door_wood_close(v, i):
    _creak(v, 0.0, v.rnd(200, 280), v.rnd(260, 360), v.rnd(0.35, 0.55), 0.12)
    wood_body(v, at=0.55, f=120, g=0.7, t60=0.2)
    thump(v, at=0.55, f0=80, f1=45, dur=0.15, g=0.6)
    burst(v, at=0.55, type="brown", filt="lowpass", f0=400, q=0.7, dur=0.1, g=0.4, atk=0.001)
    clack(v, at=0.62, f=2100, g=0.4, dur=0.012, decay=0.06)  # latch
    rattle(v, at=0.6, n=3, span=0.1, freqs=[2200, 3400], g=0.06, t60=0.05)  # glass in the door


@sound("door_metal_open", 3, "world", desc="a steel door: the handle, hinges groaning, a long swing", tags=["door"])
def door_metal_open(v, i):
    clack(v, f=1700, g=0.5, dur=0.015, decay=0.1)
    metal_body(v, at=0.002, f=700, g=0.3, t60=0.5, n=9, thick=0.6)
    _creak(v, 0.15, v.rnd(150, 220), v.rnd(200, 300), v.rnd(0.6, 0.9), 0.16, 1400.0)
    pulses(v, n=v.irnd(5, 9), at=0.2, span=0.7, type="white", f0=1800, f1=2800, q=3, dur=0.01, g=0.12)
    burst(v, at=0.2, type="pink", filt="bandpass", f0=500, q=1.5, dur=0.7, g=0.08, atk=0.2)  # the mass moving
    _clunk(v, 1.0, 0.8, 70.0)
    metal_body(v, at=1.0, f=600, g=0.25, t60=0.6, n=9, thick=0.6)


@sound("door_metal_close", 3, "world", desc="a steel door slammed: the swing, the boom, the latch", tags=["door"])
def door_metal_close(v, i):
    _creak(v, 0.0, v.rnd(200, 280), v.rnd(150, 220), v.rnd(0.4, 0.6), 0.14, 1400.0)
    burst(v, at=0.0, type="pink", filt="bandpass", f0=500, q=1.5, dur=0.5, g=0.08, atk=0.1)
    _clunk(v, 0.5, 1.0, 65.0)
    metal_body(v, at=0.5, f=550, g=0.35, t60=0.8, n=10, thick=0.6)
    burst(v, at=0.5, type="white", filt="bandpass", f0=2500, q=0.8, dur=0.03, g=0.3, atk=0.0008)
    clack(v, at=0.62, f=1800, g=0.5, dur=0.02, decay=0.15)
    metal_body(v, at=0.62, f=1300, g=0.15, t60=0.2, n=6)
alias("door_open", "door_metal_open"); alias("door_close", "door_metal_close")


@sound("hatch_open", 2, "world", desc="a bunker hatch: the wheel spun, dogs releasing, the hatch swung up", tags=["door"])
def hatch_open(v, i):
    for k in range(v.irnd(4, 6)):
        t = k * 0.16
        burst(v, at=t, type="white", filt="bandpass", f0=1200, f1=1500, q=2, dur=0.12, g=0.15, atk=0.02)  # the wheel turning
        pulses(v, n=3, at=t, span=0.12, type="white", f0=2000, f1=3000, q=3, dur=0.008, g=0.08)
    metal_body(v, at=0.02, f=400, g=0.15, t60=1.0, n=10, thick=0.7)
    for k in range(3):
        clack(v, at=1.0 + k * 0.09, f=1500 - k * 200, g=0.45, dur=0.018, decay=0.1)  # the dogs
        metal_body(v, at=1.0 + k * 0.09, f=900, g=0.2, t60=0.3, n=7, thick=0.6)
    _creak(v, 1.4, 120, 90, 1.0, 0.18, 1000.0)
    burst(v, at=1.4, type="pink", filt="bandpass", f0=400, q=1.5, dur=1.0, g=0.1, atk=0.2)
    _clunk(v, 2.5, 0.9, 60.0)
    metal_body(v, at=2.5, f=350, g=0.3, t60=1.2, n=10, thick=0.7)


@sound("hatch_close", 2, "world", desc="a bunker hatch dropped shut and dogged", tags=["door"])
def hatch_close(v, i):
    _creak(v, 0.0, 90, 120, 0.7, 0.15, 1000.0)
    _clunk(v, 0.7, 1.0, 55.0)
    metal_body(v, at=0.7, f=330, g=0.4, t60=1.4, n=10, thick=0.7)
    burst(v, at=0.7, type="white", filt="bandpass", f0=2000, q=0.8, dur=0.04, g=0.3, atk=0.0008)
    for k in range(3):
        clack(v, at=1.3 + k * 0.1, f=1300 + k * 200, g=0.45, dur=0.018, decay=0.1)
    for k in range(v.irnd(3, 5)):
        t = 1.7 + k * 0.16
        burst(v, at=t, type="white", filt="bandpass", f0=1500, f1=1200, q=2, dur=0.12, g=0.12, atk=0.02)


@sound("locker_open", 3, "world", desc="a steel locker: the latch, the thin door swinging with a tinny rattle", tags=["container"])
def locker_open(v, i):
    clack(v, f=2300, g=0.45, dur=0.012, decay=0.06)
    modal(v, at=0.0, freqs=[v.rnd(180, 260), v.rnd(350, 480), v.rnd(700, 900)], t60s=[0.5, 0.35, 0.25], amps=[1, 0.6, 0.4], exc=0.003, g=0.35)  # the door panel
    _creak(v, 0.1, v.rnd(600, 900), v.rnd(450, 700), v.rnd(0.25, 0.4), 0.06, 2500.0)
    rattle(v, at=0.15, n=5, span=0.35, freqs=[1600, 2400, 3900], g=0.07, t60=0.06)
    modal(v, at=0.5, freqs=[v.rnd(160, 220), v.rnd(400, 520)], t60s=[0.4, 0.25], amps=[1, 0.5], exc=0.003, g=0.25)  # against the stop


@sound("locker_close", 3, "world", desc="a locker door banged shut", tags=["container"])
def locker_close(v, i):
    _creak(v, 0.0, v.rnd(500, 700), v.rnd(650, 900), v.rnd(0.15, 0.25), 0.05, 2500.0)
    modal(v, at=0.2, freqs=[v.rnd(170, 240), v.rnd(380, 500), v.rnd(760, 950), v.rnd(1400, 1800)], t60s=[0.6, 0.45, 0.3, 0.2], amps=[1, 0.7, 0.4, 0.25], exc=0.003, g=0.6)
    thump(v, at=0.2, f0=110, f1=60, dur=0.12, g=0.5)
    burst(v, at=0.2, type="white", filt="bandpass", f0=2200, q=0.8, dur=0.03, g=0.3, atk=0.0008)
    clack(v, at=0.24, f=2400, g=0.4, dur=0.012, decay=0.06)
    rattle(v, at=0.22, n=4, span=0.3, freqs=[1800, 2800, 4200], g=0.06, t60=0.06)


@sound("container_open", 3, "world", desc="a metal box or ammo crate lid (legacy name; crate_open for wood)", tags=["container"])
def container_open(v, i):
    _creak(v, 0.0, 320, 260, 0.3, 0.12)
    clack(v, at=0.32, f=1800, g=0.5, dur=0.02, decay=0.12)
    metal_body(v, at=0.32, f=900, g=0.25, t60=0.3, n=8, thick=0.6)
    rattle(v, at=0.34, n=3, span=0.15, freqs=[2000, 3200], g=0.05, t60=0.05)


@sound("crate_open", 3, "world", desc="a wooden crate lid levered up", tags=["container"])
def crate_open(v, i):
    _creak(v, 0.0, 260, 200, 0.3, 0.12)
    burst(v, at=0.05, type="crackle_coarse", filt="lowpass", f0=2500, q=0.7, dur=0.2, g=0.15, atk=0.02)  # nails complaining
    wood_body(v, at=0.32, f=200, g=0.5, t60=0.12)
    burst(v, at=0.32, type="white", filt="lowpass", f0=1200, q=0.7, dur=0.03, g=0.4, atk=0.001)
    wood_body(v, at=0.45, f=260, g=0.25, t60=0.08)


@sound("container_close", 2, "world", desc="a lid dropped back", tags=["container"])
def container_close(v, i):
    clack(v, f=1700, g=0.55, dur=0.02, decay=0.12)
    metal_body(v, f=800, g=0.3, t60=0.35, n=8, thick=0.6)
    thump(v, f0=120, f1=70, dur=0.08, g=0.4)


@sound("safe_dial", 3, "world", desc="a safe's dial: ratcheting clicks", tags=["container"])
def safe_dial(v, i):
    pulses(v, n=v.irnd(10, 18), span=0.6, type="white", f0=3500, f1=4500, q=4, dur=0.004, g=0.3)
    burst(v, type="pink", filt="bandpass", f0=800, q=1.2, dur=0.6, g=0.06, atk=0.1)


@sound("lockpick", 3, "world", desc="a pick working a lock: scratches and pins", tags=["container"])
def lockpick(v, i):
    burst(v, type="white", filt="bandpass", f0=4500, f1=3500, q=2.5, dur=0.4, g=0.12, atk=0.05)
    pulses(v, n=v.irnd(5, 9), at=0.05, span=0.4, type="white", f0=3000, f1=6000, q=4, dur=0.005, g=0.2)
    for k in range(v.irnd(2, 4)):
        modal(v, at=v.rnd(0.05, 0.45), freqs=[v.rnd(4000, 6500)], t60s=[0.03], amps=[1], exc=0.0008, g=0.1)


@sound("lockpick_break", 2, "world", desc="the pick snapping", tags=["container"])
def lockpick_break(v, i):
    burst(v, type="white", filt="bandpass", f0=4000, q=2.5, dur=0.2, g=0.12, atk=0.05)
    click(v, at=0.22, f=5000, g=0.5, dur=0.003)
    modal(v, at=0.22, freqs=[5200, 7800], t60s=[0.05, 0.03], amps=[1, 0.4], exc=0.0008, g=0.3)
    tinkle(v, n=1, at=0.35, span=0.02, f0=4000, f1=6000, dur=0.04, g=0.08)


@sound("lock_open", 2, "world", desc="a lock giving: the cylinder turns, the bolt draws", tags=["container"])
def lock_open(v, i):
    click(v, f=3200, g=0.35, dur=0.005)
    burst(v, at=0.03, type="white", filt="bandpass", f0=1800, f1=1400, q=2, dur=0.08, g=0.1, atk=0.01)
    clack(v, at=0.12, f=2000, g=0.5, dur=0.015, decay=0.08)
    metal_body(v, at=0.12, f=1500, g=0.15, t60=0.12, n=6)


# ------------------------------------------------------------------------------------------------------ base
@sound("bed_sleep", 1, "world", peak=-10.0, desc="lying down on a cot: springs, cloth, a long breath out", tags=["base"])
def bed_sleep(v, i):
    cloth(v, n=5, span=0.6, g=0.2)
    for k in range(v.irnd(3, 5)):
        modal(v, at=v.rnd(0.1, 0.7), freqs=[v.rnd(400, 700), v.rnd(900, 1300)], t60s=[0.2, 0.12], amps=[1, 0.5], exc=0.003, g=0.1)  # springs
    _creak(v, 0.3, 300, 240, 0.4, 0.05)
    burst(v, at=1.0, type="pink", filt="bandpass", f0=700, q=0.9, dur=1.4, g=0.15, atk=0.4)


@sound("sleep", 1, "tide", peak=-8.0, desc="the sleep transition: a soft descending chord and the hum sinking away", tags=["base"])
def sleep(v, i):
    for k, f in enumerate([330, 415, 494]):
        tone(v, f0=f, f1=f / 2, dur=2.0, g=0.14 - k * 0.02, atk=0.4, hold=0.5, lp=1200, curve="lin", fcurve="exp")
    tone(v, f0=165, f1=82, dur=2.0, g=0.08, atk=0.6, hold=0.4, curve="lin")
    burst(v, type="brown", filt="lowpass", f0=200, q=0.7, dur=2.0, g=0.1, atk=0.8, curve="lin")


@sound("generator_start", 1, "world", desc="the base generator coughing into life", tags=["base"])
def generator_start(v, i):
    for k in range(4):
        t = k * 0.35
        thump(v, at=t, f0=80, f1=50, dur=0.15, g=0.5)
        burst(v, at=t, type="brown", filt="lowpass", f0=300, q=0.8, dur=0.15, g=0.4, atk=0.005)
    n = dsp.sec(2.0)
    rate = dsp.sweep(n, 18.0, 42.0, "exp", 0.7)
    x = dsp.lowpass(dsp.osc(n, rate, "sawtooth"), 180.0, 1.0)
    x *= dsp.env(n, 0.3, 1.5, curve="lin", hold_level=1.0) * 0.5
    v.add(x, 1.4)


@sound("fluorescent_flicker", 3, "world", peak=-16.0, desc="a tube stuttering", tags=["base"])
def fluorescent_flicker(v, i):
    for k in range(v.irnd(3, 6)):
        t = v.rnd(0.0, 0.5)
        burst(v, at=t, type="white", filt="bandpass", f0=v.rnd(1800, 3200), q=3, dur=v.rnd(0.02, 0.08), g=0.25, atk=0.002)
        tone(v, at=t, type="square", f0=100, dur=v.rnd(0.03, 0.08), g=0.08, atk=0.002, bp=1800, bq=2)


# ------------------------------------------------------------------------------------------------------ the Tide
@sound("tide_warn", 1, "tide", desc="the base siren, one rise and fall, heard across the zone", tags=["tide"])
def tide_warn(v, i):
    for d in (0, 7):
        tone(v, type="sawtooth", f0=400, f1=620, dur=0.75, g=0.22, atk=0.2, curve="lin", lp=900, detune=d)
        tone(v, at=0.75, type="sawtooth", f0=620, f1=400, dur=0.75, g=0.22, atk=0.02, lp=900, detune=d)
    burst(v, type="pink", filt="bandpass", f0=600, q=0.6, dur=1.5, g=0.05, atk=0.4, curve="lin")
    return reverb.far(v.render(), 500.0, v.rng)


@sound("siren", 1, "loop", peak=-4.0, loop=True, desc="4 s: the Tide siren at the base, close", tags=["tide", "loop"])
def siren(v, i):
    n = dsp.sec(4.0)
    tt = np.arange(n) / dsp.SR
    f = 480.0 + 240.0 * (0.5 - 0.5 * np.cos(2 * np.pi * tt / 2.0))
    x = np.zeros(n)
    for d in (-4, 0, 5):
        x += dsp.osc(n, f * 2 ** (d / 1200.0), "sawtooth") * 0.3
    x = dsp.lowpass(x, 1100.0, 1.2)
    x += dsp.osc(n, f * 2, "sine") * 0.08
    # a mechanical siren has a rotor: slight AM at its blade rate
    x *= 1.0 + 0.12 * np.sin(2 * np.pi * (f / 6.0) * tt)
    x = dsp.saturate(x, 1.6)
    v.add(x, 0.0)
    v.buf = v.buf[:n]


@sound("tide_chord", 1, "tide", peak=-3.0, desc="the Tide: six seconds of rising cluster and white", tags=["tide"])
def tide_chord(v, i):
    for f in (110, 165, 220, 277, 330, 440):
        tone(v, f0=f, f1=f * 1.5, dur=6.0, g=0.12, atk=2.0, hold=2.5, curve="lin", detune=v.rnd(-8, 8), lp=2500)
        tone(v, f0=f * 1.002, f1=f * 1.5, dur=6.0, g=0.06, atk=2.5, hold=2.0, curve="lin", detune=v.rnd(-15, 15), lp=2500, type="triangle")
    burst(v, type="white", filt="lowpass", f0=2000, f1=6000, q=0.5, dur=6.0, g=0.25, atk=5.0, curve="lin")
    burst(v, type="brown", filt="lowpass", f0=150, q=0.7, dur=6.0, g=0.2, atk=4.0, curve="lin")
    thump(v, at=5.6, f0=40, f1=20, dur=0.5, g=0.8)


@sound("tide_roll", 1, "tide", peak=-3.0, desc="the Tide arriving: ten seconds of wind rising to a wall, the chord, the white-out", tags=["tide"])
def tide_roll(v, i):
    n = dsp.sec(10.0)
    w = dsp.pink(v.rng, n)
    cut = dsp.sweep(n, 300.0, 6000.0, "exp")
    w = dsp.biquad(w, "bandpass", cut, 0.6)
    w *= dsp.env(n, 7.0, 2.0, curve="lin", hold_level=1.0) * 0.7
    v.add(w, 0.0)
    for f in (55, 82.5, 110, 165, 220, 277, 330, 440, 660):
        tone(v, at=2.0, f0=f, f1=f * 1.5, dur=8.0, g=0.08, atk=4.0, hold=3.0, curve="lin", detune=v.rnd(-10, 10), lp=3000)
    burst(v, at=3.0, type="brown", filt="lowpass", f0=120, q=0.7, dur=7.0, g=0.3, atk=5.0, curve="lin")
    burst(v, at=8.5, type="white", filt="highpass", f0=3000, q=0.5, dur=1.5, g=0.3, atk=1.0, curve="lin")
    thump(v, at=9.4, f0=45, f1=20, dur=0.6, g=1.0)


@sound("tide_siren_far", 1, "loop", peak=-12.0, loop=True, desc="6 s: the siren from kilometres away, in the wind", tags=["tide", "loop"])
def tide_siren_far(v, i):
    sv = v.sub(); siren(sv, 0); x = sv.render()
    x = np.tile(x, 2)[:dsp.sec(6.0)]
    x = reverb.air(x, 900.0, True, v.rng)
    n = len(x)
    x *= 0.7 + 0.3 * np.sin(2 * np.pi * 0.23 * np.arange(n) / dsp.SR + v.rnd(0, 6))  # the wind carrying it
    v.buf = x[:dsp.sec(6.0)]


# ------------------------------------------------------------------------------------------------------ legacy ambience names
@sound("wind", 1, "ambience", peak=-12.0, loop=True, desc="12 s: wind over a field (legacy name; amb_* supersedes)", tags=["ambience", "loop"])
def wind(v, i):
    n = dsp.sec(12.0)
    tt = np.arange(n) / dsp.SR
    body = dsp.pink(v.rng, n)
    f = 450.0 + 120.0 * np.sin(2 * np.pi * 0.07 * tt) + 60.0 * np.sin(2 * np.pi * 0.19 * tt + 1.0)
    body = dsp.biquad(body, "bandpass", f, 0.5)
    gust = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.05 * tt + 2.0)) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * tt))
    whistle = dsp.biquad(dsp.pink(v.rng, n), "bandpass", 2000.0 + 450.0 * np.sin(2 * np.pi * 0.13 * tt), 8.0) * 0.08 * gust ** 2
    x = body * gust * 0.5 + whistle
    x += dsp.lowpass(dsp.brown(v.rng, n), 80.0) * 0.1 * gust
    v.buf = x[:n]


@sound("radius_hum", 1, "ambience", peak=-14.0, loop=True, desc="10 s: the Radius hum, 42 Hz and detuned partials (legacy name)", tags=["ambience", "loop"])
def radius_hum(v, i):
    n = dsp.sec(10.0)
    tt = np.arange(n) / dsp.SR
    x = np.zeros(n)
    for f, g, lf in ((42.0, 0.5, 0.05), (63.0, 0.35, 0.07), (84.5, 0.25, 0.04), (126.3, 0.1, 0.09)):
        x += dsp.osc(n, f * (1.0 + 0.002 * np.sin(2 * np.pi * lf * tt)), "sine") * g * (0.8 + 0.2 * np.sin(2 * np.pi * lf * 1.3 * tt + v.rnd(0, 6)))
    x += dsp.lowpass(dsp.brown(v.rng, n), 90.0) * 0.08
    v.buf = x


@sound("base_hum", 1, "ambience", peak=-14.0, loop=True, desc="8 s: fluorescent tubes and the generator through the wall (legacy name)", tags=["ambience", "loop"])
def base_hum(v, i):
    n = dsp.sec(8.0)
    tt = np.arange(n) / dsp.SR
    x = dsp.osc(n, 100.0, "sine") * 0.06 + dsp.osc(n, 120.0, "sine") * 0.018
    x += dsp.bandpass(dsp.osc(n, 100.0, "square"), 1800.0, 3.0) * 0.04 * (1.0 + 0.5 * (np.sin(2 * np.pi * 0.7 * tt) > 0.9))
    gen = dsp.lowpass(dsp.osc(n, 42.0, "sawtooth"), 180.0, 1.0) * (0.7 + 0.3 * np.sin(2 * np.pi * 6.0 * tt)) * 0.12
    x += gen
    x += dsp.highpass(dsp.white(v.rng, n), 5000.0) * 0.004
    v.buf = x


@sound("drizzle", 1, "ambience", peak=-14.0, loop=True, desc="8 s: drizzle on leaves and a tin roof (legacy name)", tags=["ambience", "loop"])
def drizzle(v, i):
    n = dsp.sec(8.0)
    x = dsp.bandpass(dsp.crackle(v.rng, n, 1800.0, 0.3), 3200.0, 0.7) * 0.5
    x += dsp.bandpass(dsp.crackle(v.rng, n, 600.0, 0.5), 1500.0, 1.0) * 0.3
    x += dsp.highpass(dsp.pink(v.rng, n), 3000.0) * 0.04
    for k in range(v.irnd(10, 16)):  # drops on tin
        modal(v, at=v.rnd(0.0, 7.8), freqs=[v.rnd(1800, 2600), v.rnd(3200, 4400)], t60s=[0.06, 0.04], amps=[1, 0.4], exc=0.001, g=0.06)
    v.add(x, 0.0)
    v.buf = v.buf[:n]


@sound("crow", 4, "ambience", peak=-8.0, desc="a hooded crow, two or three caws", tags=["ambience", "bird"])
def crow(v, i):
    def caw(at, k):
        f = v.rnd(800, 1000)
        fm(v, at=at, type="sawtooth", f0=f, f1=f * 0.72, ratio=1.5, index=1.8, index1=1.2, dur=v.rnd(0.18, 0.26), g=0.3, atk=0.02, shape=18, bp=1400, bq=1.5)
        burst(v, at=at, type="pink", filt="bandpass", f0=1200, q=1, dur=0.22, g=0.1, atk=0.02)
        burst(v, at=at, type="crackle_fine", filt="bandpass", f0=2500, q=1.2, dur=0.2, g=0.08, atk=0.02)  # the rasp
    seq(v, v.irnd(2, 3), 0.0, v.rnd(0.7, 1.1), caw)
    return reverb.place(v.render(), "forest", v.rng, wet_db=-9.0)


@sound("bird", 4, "ambience", peak=-12.0, desc="a small bird, far", tags=["ambience", "bird"])
def bird(v, i):
    tone(v, f0=3000, f1=4500, dur=0.07, g=0.15, atk=0.005)
    tone(v, at=0.12, f0=4200, f1=3600, dur=0.06, g=0.12, atk=0.005)
    if v.chance(0.4):
        tone(v, at=0.22, f0=3800, f1=4600, dur=0.05, g=0.1, atk=0.005)
    if v.chance(0.5):
        for k in range(v.irnd(3, 6)):
            tone(v, at=0.4 + k * 0.07, f0=v.rnd(3200, 4200), f1=v.rnd(2800, 4600), dur=0.04, g=0.08, atk=0.004)
    return reverb.place(v.render(), "forest", v.rng, wet_db=-6.0)


@sound("drip", 4, "ambience", peak=-14.0, desc="a drop into a puddle in the bunker", tags=["ambience", "base"])
def drip(v, i):
    tone(v, f0=v.rnd(1500, 2100), f1=v.rnd(2300, 3000), dur=0.05, g=0.25, atk=0.002)
    burst(v, type="white", filt="bandpass", f0=3000, q=1.5, dur=0.015, g=0.2, atk=0.001)
    modal(v, at=0.01, freqs=[v.rnd(2200, 2600)], t60s=[0.12], amps=[1], exc=0.001, g=0.05)
    return reverb.place(v.render(), "bunker", v.rng, wet_db=-6.0)


@sound("thunder", 3, "ambience", peak=-3.0, desc="thunder rolling across the marsh", tags=["ambience", "weather"])
def thunder(v, i):
    n = dsp.sec(v.rnd(3.5, 5.5))
    x = dsp.brown(v.rng, n)
    env = np.zeros(n)
    for k in range(v.irnd(3, 6)):  # a series of claps rolling into one another
        t0 = v.rnd(0.0, 0.5 * n / dsp.SR); d = v.rnd(0.3, 1.2)
        env = np.maximum(env, dsp.pad_to(dsp.delay(dsp.env(dsp.sec(d), 0.02 + 0.1 * k, 0, curve="exp"), t0), n)[:n] * v.rnd(0.5, 1.0))
    env = dsp.smooth(env, 0.02)
    x = dsp.biquad(x, "lowpass", dsp.sweep(n, 900.0, 150.0, "exp"), 0.8) * env
    x += dsp.lowpass(dsp.pink(v.rng, n), 400.0) * env * 0.3
    x = dsp.saturate(x * 3.0, 2.5)
    v.add(x, 0.0)
    if v.chance(0.5):
        click(v, g=0.6, f=1500, dur=0.02)
        burst(v, type="white", filt="bandpass", f0=2500, f1=600, q=0.7, dur=0.25, g=0.5, atk=0.002)  # the near crack
    return reverb.place(v.render(), "distant", v.rng, wet_db=0.0, dry=0.6)


@sound("metal_creak", 4, "ambience", peak=-12.0, desc="a distant sheet of roofing shifting in the wind", tags=["ambience"])
def metal_creak(v, i):
    _creak(v, 0.0, v.rnd(120, 200), v.rnd(90, 160), v.rnd(0.6, 1.4), 0.12, 1200.0)
    modal(v, at=v.rnd(0.3, 0.8), freqs=[v.rnd(150, 250), v.rnd(320, 480)], t60s=[0.6, 0.4], amps=[1, 0.5], exc=0.004, g=0.15)
    return reverb.place(v.render(), "field", v.rng, wet_db=-6.0)


@sound("debris_drift", 3, "ambience", peak=-14.0, desc="floating stones grinding against each other overhead", tags=["ambience", "anomaly"])
def debris_drift(v, i):
    n = dsp.sec(v.rnd(1.5, 2.5))
    x = dsp.biquad(dsp.pink(v.rng, n), "bandpass", 300.0 + 100.0 * np.sin(np.linspace(0, 4, n)), 2.0)
    x *= dsp.env(n, 0.4, 0.5, curve="cos") * 0.4
    v.add(x, 0.0)
    for k in range(v.irnd(3, 6)):
        modal(v, at=v.rnd(0.1, 1.8), freqs=[v.rnd(700, 1400), v.rnd(1600, 2600)], t60s=[0.15, 0.08], amps=[1, 0.4], exc=0.003, g=0.1)
    thump(v, at=v.rnd(0.3, 1.2), f0=60, f1=35, dur=0.3, g=0.3)
