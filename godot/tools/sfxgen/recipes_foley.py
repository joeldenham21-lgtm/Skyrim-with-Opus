"""The explorer's own body and kit: footsteps per surface (walk/sprint/crouch), landing, gear, breathing, heartbeat,
bleeding, eating and drinking, meds, backpack, pickups and drops, hurt and death."""
import numpy as np
from . import dsp, synth, voice as vox
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, glass_body, whoosh, rattle, grunt
from .registry import sound, define, alias

SURFACES = ["grass", "dirt", "mud", "gravel", "rock", "road", "concrete", "wood", "metal", "water", "sand", "snow"]


# ------------------------------------------------------------------------------------------------------ footsteps
def _heel(v: Voice, g: float, f0: float = 120.0, dur: float = 0.04):
    thump(v, f0=f0, f1=f0 * 0.5, dur=dur, g=0.7 * g, atk=0.001)
    burst(v, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.02, g=0.5 * g, atk=0.0008)


def _scuff(v: Voice, g: float, at: float = 0.03, dur: float = 0.08, f: float = 1100.0):
    burst(v, at=at, type="pink", filt="bandpass", f0=f, f1=f * 0.7, q=0.9, dur=dur, g=0.25 * g, atk=0.015)


def _gear(v: Voice, g: float, at: float = 0.02):
    cloth(v, at=at, n=2, span=0.1, g=0.08 * g)
    if v.chance(0.35):
        rattle(v, at=at + 0.03, n=2, span=0.06, freqs=[2800, 4300], g=0.03 * g, t60=0.03)


def step(v: Voice, surface: str, mode: str):
    g = {"walk": 1.0, "sprint": 1.35, "crouch": 0.55}[mode]
    slow = 1.25 if mode == "crouch" else (0.85 if mode == "sprint" else 1.0)
    if surface == "grass":
        burst(v, type="pink", filt="highpass", f0=800, q=0.6, dur=0.08 * slow, g=0.55 * g, atk=0.014)
        burst(v, at=0.005, type="crackle_fine", filt="bandpass", f0=3200, q=0.8, dur=0.07 * slow, g=0.22 * g, atk=0.006)  # dry stems
        _heel(v, g * 0.5, 100.0)
        if v.chance(0.5):
            burst(v, at=0.04, type="pink", filt="bandpass", f0=2600, q=1.2, dur=0.03, g=0.12 * g, atk=0.005)
        _gear(v, g)
    elif surface == "dirt":
        _heel(v, g * 0.9, 110.0, 0.05)
        burst(v, at=0.002, type="crackle_coarse", filt="lowpass", f0=3000, q=0.7, dur=0.05 * slow, g=0.25 * g, atk=0.002)  # grit
        _scuff(v, g, 0.03, 0.07 * slow, 900.0)
        burst(v, at=0.02, type="pink", filt="highpass", f0=2500, q=0.5, dur=0.1, g=0.04 * g, atk=0.02)  # dust
        _gear(v, g)
    elif surface == "mud":
        thump(v, f0=70, f1=40, dur=0.09, g=0.8 * g)
        burst(v, type="pink", filt="bandpass", f0=900, f1=320, q=1.3, dur=0.14 * slow, g=0.45 * g, atk=0.012, pr=1.1, pr1=0.6)  # squelch
        burst(v, at=0.01, type="crackle_fine", filt="lowpass", f0=2200, q=0.7, dur=0.08, g=0.14 * g, atk=0.004)  # wet crackle
        pulses(v, n=v.irnd(2, 4), at=0.015, span=0.07, type="white", f0=1800, f1=3200, q=3, dur=0.008, g=0.12 * g)
        if mode != "crouch" and v.chance(0.6):
            tone(v, at=0.12 * slow, f0=220, f1=70, dur=0.06, g=0.18 * g, atk=0.004, lp=800)  # the suction letting go
            burst(v, at=0.12 * slow, type="pink", filt="bandpass", f0=600, f1=300, q=1.5, dur=0.06, g=0.15 * g, atk=0.004)
        _gear(v, g)
    elif surface == "gravel":
        _heel(v, g * 0.8, 130.0)
        pulses(v, n=v.irnd(8, 16), at=0.0, span=0.11 * slow, type="white", f0=1500, f1=4000, q=2.5, dur=0.009, g=0.3 * g, decay=0.92)  # crunch
        for k in range(v.irnd(2, 4)):
            modal(v, at=v.rnd(0.01, 0.1), freqs=[v.rnd(1800, 3400), v.rnd(3500, 5200)], t60s=[0.025, 0.02], amps=[1, 0.5], exc=0.001, g=0.07 * g)
        burst(v, at=0.01, type="pink", filt="bandpass", f0=1200, q=0.8, dur=0.08 * slow, g=0.15 * g, atk=0.01)
        _gear(v, g)
    elif surface in ("rock", "road", "concrete"):
        f = {"rock": 1500.0, "road": 2000.0, "concrete": 2600.0}[surface]
        burst(v, type="white", filt="bandpass", f0=f, q=0.9, dur=0.025, g=0.6 * g, atk=0.0008)
        click(v, f=f * 2, g=0.35 * g, dur=0.003)
        _heel(v, g * 0.7, 150.0, 0.035)
        if surface == "concrete":
            modal(v, freqs=[1900, 3100], t60s=[0.06, 0.04], amps=[1, 0.4], exc=0.001, g=0.06 * g)
        elif surface == "rock":
            modal(v, freqs=[2400, 3700], t60s=[0.09, 0.06], amps=[1, 0.6], exc=0.001, g=0.07 * g)
            pulses(v, n=v.irnd(2, 4), at=0.01, span=0.06, type="white", f0=3000, f1=5000, q=3, dur=0.005, g=0.08 * g)
        _scuff(v, g, 0.03, 0.06 * slow, 1600.0 if surface != "road" else 1200.0)
        _gear(v, g)
    elif surface == "wood":
        wood_body(v, f=v.rnd(170, 240), g=0.65 * g, t60=0.09)
        tone(v, f0=90, f1=60, dur=0.06, g=0.3 * g, atk=0.002)  # the floor's hollow
        if v.chance(0.35 if mode != "sprint" else 0.15):
            trem(v, lambda sv: tone(sv, type="sawtooth", f0=v.rnd(300, 500), f1=v.rnd(250, 420), dur=0.12, g=0.06, atk=0.03, lp=1800, lq=2.5, shape=12, curve="lin"), v.rnd(9, 15), 0.45, 0.04)
        _scuff(v, g * 0.6, 0.03, 0.05, 1400.0)
        _gear(v, g)
    elif surface == "metal":
        burst(v, type="white", filt="bandpass", f0=3000, q=1, dur=0.015, g=0.55 * g, atk=0.0008)
        metal_body(v, f=v.rnd(900, 1400), g=0.3 * g, t60=0.25, n=8, thick=0.35)
        modal(v, at=0.002, freqs=[v.rnd(150, 240), v.rnd(300, 420)], t60s=[0.2, 0.12], amps=[1, 0.5], exc=0.003, g=0.25 * g)  # the sheet
        thump(v, f0=110, f1=60, dur=0.06, g=0.3 * g)
        _gear(v, g)
    elif surface == "water":
        burst(v, type="white", filt="bandpass", f0=4000, f1=600, q=0.8, dur=0.2 * slow, g=0.55 * g, atk=0.01)
        thump(v, f0=80, f1=50, dur=0.08, g=0.3 * g)
        burst(v, at=0.03, type="pink", filt="bandpass", f0=1200, f1=500, q=1, dur=0.15, g=0.2 * g, atk=0.02)
        tinkle(v, n=v.irnd(2, 4), at=0.06, span=0.18, f0=1500, f1=2600, dur=0.03, g=0.05 * g)
        for k in range(v.irnd(1, 3)):
            tone(v, at=v.rnd(0.05, 0.2), f0=v.rnd(400, 700), f1=v.rnd(900, 1500), dur=0.03, g=0.06 * g, atk=0.003)  # gurgle
    elif surface == "sand":
        _heel(v, g * 0.5, 100.0, 0.05)
        burst(v, type="crackle_fine", filt="lowpass", f0=5000, q=0.7, dur=0.09 * slow, g=0.28 * g, atk=0.008)
        burst(v, at=0.005, type="white", filt="bandpass", f0=3500, f1=2000, q=0.8, dur=0.1 * slow, g=0.14 * g, atk=0.01)
        _gear(v, g)
    elif surface == "snow":
        _heel(v, g * 0.5, 100.0, 0.05)
        burst(v, type="crackle_fine", filt="bandpass", f0=3500, q=0.9, dur=0.1 * slow, g=0.35 * g, atk=0.006)
        if v.chance(0.6):
            tone(v, at=0.02, f0=v.rnd(1800, 2800), f1=v.rnd(1500, 2400), dur=0.05, g=0.05 * g, atk=0.01, vib=dict(f=40, depth=60))  # the squeak
        _gear(v, g)


for _s in SURFACES:
    for _m, _suffix, _n in (("walk", "", 4), ("sprint", "_sprint", 4), ("crouch", "_crouch", 4)):
        define("step_%s%s" % (_s, _suffix), (lambda s, m: lambda v, i: step(v, s, m))(_s, _m), variants=_n, cat="step",
               desc="%s footstep on %s" % (_m, _s), tags=["step", _s, _m])
alias("step_ash", "step_dirt"); alias("step_brick", "step_concrete"); alias("step_asphalt", "step_road"); alias("step_glass", "step_concrete")


@sound("land", 3, "foley", peak=-8.0, desc="landing from a jump: weight, boots, gear", tags=["foley"])
def land(v, i):
    thump(v, f0=90, f1=35, dur=0.18, g=1.0)
    burst(v, type="brown", filt="lowpass", f0=600, f1=200, q=0.7, dur=0.14, g=0.5, atk=0.004)
    burst(v, type="pink", filt="bandpass", f0=1200, q=0.8, dur=0.06, g=0.25, atk=0.003)
    burst(v, at=0.002, type="crackle_coarse", filt="lowpass", f0=3000, q=0.7, dur=0.05, g=0.2, atk=0.002)
    cloth(v, at=0.02, n=3, span=0.18, g=0.16)
    rattle(v, at=0.03, n=3, span=0.12, freqs=[2600, 4000], g=0.05, t60=0.04)


@sound("land_hard", 2, "foley", peak=-6.0, desc="a hard landing: the knees, a grunt", tags=["foley"])
def land_hard(v, i):
    land(v, i)
    thump(v, at=0.01, f0=60, f1=28, dur=0.25, g=0.8)
    grunt(v, at=0.05, f0=120, f1=80, dur=0.16, g=0.3)


for _s in ("grass", "dirt", "mud", "gravel", "concrete", "wood", "metal", "water"):
    def _land_s(v, i, s=_s):
        land(v, i)
        sv = v.sub(); step(sv, s, "sprint"); v.add(sv.render() * 0.8, 0.0)
    define("land_%s" % _s, _land_s, variants=2, cat="foley", peak=-8.0, desc="landing on %s" % _s, tags=["foley"])


@sound("jump", 3, "foley", desc="pushing off: cloth and a scuff", tags=["foley"])
def jump(v, i):
    cloth(v, n=3, span=0.12, f=2400, g=0.24)
    burst(v, type="brown", filt="lowpass", f0=400, q=0.7, dur=0.06, g=0.25, atk=0.008)
    burst(v, at=0.02, type="crackle_coarse", filt="lowpass", f0=2500, q=0.7, dur=0.04, g=0.12, atk=0.004)
    rattle(v, at=0.05, n=2, span=0.08, freqs=[2800, 4200], g=0.04, t60=0.04)


# ------------------------------------------------------------------------------------------------------ gear / cloth
@sound("gear_rustle", 4, "foley", desc="turning: webbing, straps, a magazine knocking a pouch", tags=["foley"])
def gear_rustle(v, i):
    cloth(v, n=v.irnd(3, 5), span=0.3, g=0.2)
    burst(v, at=0.05, type="pink", filt="bandpass", f0=500, q=1.0, dur=0.15, g=0.1, atk=0.03)  # strap
    rattle(v, at=v.rnd(0.05, 0.2), n=v.irnd(2, 4), span=0.12, freqs=[2600, 3900, 5400], g=0.05, t60=0.04)
    if v.chance(0.5):
        click(v, at=v.rnd(0.1, 0.3), f=2400, g=0.12, dur=0.005)  # a buckle


@sound("cloth", 4, "foley", peak=-16.0, desc="cloth moving", tags=["foley"])
def cloth_only(v, i):
    cloth(v, n=v.irnd(2, 4), span=0.22, g=0.2)


# ------------------------------------------------------------------------------------------------------ breathing
def _breath_cycle(v: Voice, at: float, period: float, level: float, voiced: float = 0.0, shaky: float = 0.0):
    n = dsp.sec(period)
    inh = dsp.biquad(dsp.pink(v.rng, n), "bandpass", 1300.0 + 120.0 * np.sin(np.linspace(0, 2.2, n)), 1.2)
    exh = dsp.biquad(dsp.pink(v.rng, n), "bandpass", 650.0 + 60.0 * np.sin(np.linspace(0, 1.7, n)), 0.9)
    p = period
    e_in = dsp.breakpoints([(0, 0), (p * 0.3, 0.55, "lin"), (p * 0.42, 0.35, "lin"), (p * 0.5, 0.0, "cos")], n)
    e_out = dsp.breakpoints([(0, 0), (p * 0.45, 0.0, "lin"), (p * 0.58, 1.0, "lin"), (p * 0.8, 0.45, "lin"), (p * 0.97, 0.0, "cos")], n)
    if shaky > 0:
        tr = 1.0 - shaky * 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * v.rnd(6, 9) * np.arange(n) / dsp.SR))
        e_in *= tr; e_out *= tr
    x = (inh * e_in + exh * e_out) * level
    if voiced > 0:  # a hint of voice on the exhale (exhausted, hurt)
        f0 = v.rnd(95, 125) * (1.0 - 0.15 * np.linspace(0, 1, n))
        src = dsp.onepole_lp(dsp.osc(n, f0, "pulse", rng=v.rng, jitter=0.02), 1500.0)
        vv = dsp.bandpass(src, 500.0, 3.0) + 0.5 * dsp.bandpass(src, 1100.0, 4.0)
        x += vv * e_out * level * voiced
    v.add(x, at)


@sound("breath", 3, "foley", peak=-16.0, desc="one calm breath cycle (legacy single)", tags=["breath"])
def breath_single(v, i):
    _breath_cycle(v, 0.0, v.rnd(2.6, 3.2), 0.8)


@sound("breath_calm", 1, "loop", peak=-18.0, loop=True, desc="8 s: slow breathing, barely there", tags=["breath", "loop"])
def breath_calm(v, i):
    t = 0.0
    while t < 8.0:
        p = v.rnd(3.0, 3.4); _breath_cycle(v, t, p, v.rnd(0.6, 0.85)); t += p
    v.buf = v.buf[:dsp.sec(8.0)]


@sound("breath_exhausted", 1, "loop", peak=-10.0, loop=True, desc="6 s: hard breathing after a sprint, voice on the exhale", tags=["breath", "loop"])
def breath_exhausted(v, i):
    t = 0.0
    while t < 6.0:
        p = v.rnd(1.05, 1.3); _breath_cycle(v, t, p, v.rnd(0.9, 1.1), voiced=0.35); t += p
    v.buf = v.buf[:dsp.sec(6.0)]


@sound("breath_hurt", 1, "loop", peak=-10.0, loop=True, desc="6 s: shaky breathing with whimpers", tags=["breath", "loop"])
def breath_hurt(v, i):
    t = 0.0
    while t < 6.0:
        p = v.rnd(1.3, 1.9); _breath_cycle(v, t, p, v.rnd(0.8, 1.0), voiced=0.5, shaky=0.8)
        if v.chance(0.45):
            grunt(v, at=t + p * 0.55, f0=v.rnd(140, 190), f1=v.rnd(90, 120), dur=0.12, g=0.25, atk=0.02, lp=900)
        t += p
    v.buf = v.buf[:dsp.sec(6.0)]


@sound("breath_gasp", 3, "foley", peak=-8.0, desc="a sharp intake of breath", tags=["breath"])
def breath_gasp(v, i):
    burst(v, type="pink", filt="bandpass", f0=1400, f1=1900, q=1.2, dur=0.35, g=0.6, atk=0.03, curve="cos")
    burst(v, at=0.02, type="white", filt="highpass", f0=2500, q=0.6, dur=0.3, g=0.15, atk=0.05)
    tone(v, at=0.05, type="pulse", f0=140, f1=180, dur=0.2, g=0.08, atk=0.05, lp=1200, jitter=0.03)


@sound("mask_breath", 1, "loop", peak=-14.0, loop=True, desc="6 s: breathing through a gas mask, valve clicks", tags=["breath", "loop"])
def mask_breath(v, i):
    t = 0.0
    while t < 6.0:
        p = v.rnd(2.4, 2.9)
        sv = v.sub(); _breath_cycle(sv, 0.0, p, 1.0)
        x = dsp.bandpass(sv.render(), 900.0, 0.8) * 1.6 + dsp.lowpass(sv.render(), 500.0) * 0.6
        v.add(x, t)
        click(v, at=t + p * 0.5, f=1400, g=0.12, dur=0.006)  # exhale valve
        click(v, at=t + p * 0.05, f=1800, g=0.08, dur=0.005)
        t += p
    v.buf = v.buf[:dsp.sec(6.0)]


# ------------------------------------------------------------------------------------------------------ heart, blood
def _beat(v: Voice, at: float, g: float):
    thump(v, at=at, f0=68, f1=38, dur=0.11, g=0.9 * g)
    burst(v, at=at, type="brown", filt="lowpass", f0=220, q=0.7, dur=0.08, g=0.5 * g, atk=0.002)
    thump(v, at=at + 0.14, f0=58, f1=34, dur=0.1, g=0.6 * g)
    burst(v, at=at + 0.14, type="brown", filt="lowpass", f0=180, q=0.7, dur=0.07, g=0.35 * g, atk=0.002)


@sound("heartbeat", 3, "foley", peak=-8.0, desc="one lub-dub", tags=["heart"])
def heartbeat(v, i):
    _beat(v, 0.0, 1.0)


@sound("heartbeat_loop", 1, "loop", peak=-8.0, loop=True, desc="4 s at 60 bpm", tags=["heart", "loop"])
def heartbeat_loop(v, i):
    for k in range(4):
        _beat(v, k * 1.0, v.rnd(0.9, 1.0))
    v.buf = v.buf[:dsp.sec(4.0)]


@sound("heartbeat_fast_loop", 1, "loop", peak=-6.0, loop=True, desc="4 s at 120 bpm", tags=["heart", "loop"])
def heartbeat_fast_loop(v, i):
    for k in range(8):
        _beat(v, k * 0.5, v.rnd(0.9, 1.0))
    v.buf = v.buf[:dsp.sec(4.0)]


@sound("bleed_drip", 4, "foley", peak=-16.0, desc="a drop of blood on cloth or a boot", tags=["foley"])
def bleed_drip(v, i):
    tone(v, f0=v.rnd(700, 1100), f1=v.rnd(350, 500), dur=0.04, g=0.25, atk=0.002)
    burst(v, type="pink", filt="bandpass", f0=1200, q=1.5, dur=0.03, g=0.2, atk=0.002)
    if v.chance(0.5):
        tone(v, at=0.12, f0=v.rnd(800, 1000), f1=400, dur=0.03, g=0.12, atk=0.002)


# ------------------------------------------------------------------------------------------------------ eating, drinking, meds
def _swallow(v: Voice, at: float, g: float = 0.35):
    tone(v, at=at, type="sine", f0=220, f1=110, dur=0.09, g=g * 0.6, atk=0.01)
    burst(v, at=at, type="pink", filt="bandpass", f0=500, f1=250, q=1.5, dur=0.1, g=g, atk=0.01)
    click(v, at=at + 0.06, f=900, g=g * 0.4, dur=0.008)


@sound("eat", 2, "foley", desc="bread and tushonka: tearing, chewing, a swallow", tags=["foley", "food"])
def eat(v, i):
    burst(v, type="crackle_coarse", filt="lowpass", f0=2500, q=0.7, dur=0.25, g=0.3, atk=0.02)  # tearing crust
    t = 0.3
    for k in range(v.irnd(5, 7)):
        burst(v, at=t, type="pink", filt="lowpass", f0=900, q=0.8, dur=0.1, g=0.3, atk=0.02)  # chew
        burst(v, at=t, type="crackle_fine", filt="lowpass", f0=3000, q=0.7, dur=0.06, g=0.12, atk=0.005)
        t += v.rnd(0.32, 0.42)
    _swallow(v, t + 0.1)
    cloth(v, at=0.1, n=2, span=0.3, g=0.08)


@sound("drink", 2, "foley", desc="a canteen: cap, gulps, the bottle's glug", tags=["foley", "food"])
def drink(v, i):
    click(v, f=1800, g=0.25, dur=0.006); click(v, at=0.05, f=1600, g=0.2, dur=0.006)
    t = 0.35
    for k in range(v.irnd(3, 5)):
        _swallow(v, t, 0.4)
        modal(v, at=t + 0.05, freqs=[v.rnd(380, 520), v.rnd(700, 900)], t60s=[0.12, 0.08], amps=[1, 0.4], exc=0.004, g=0.12)  # glug
        tone(v, at=t + 0.05, f0=v.rnd(300, 400), f1=v.rnd(500, 700), dur=0.08, g=0.06, atk=0.01)
        t += v.rnd(0.55, 0.7)
    burst(v, at=t, type="pink", filt="bandpass", f0=1500, q=0.8, dur=0.15, g=0.1, atk=0.03)  # breath out
    click(v, at=t + 0.3, f=1800, g=0.2, dur=0.006)


@sound("bandage_use", 3, "foley", desc="a bandage: the wrapper torn, gauze wound tight, tape", tags=["foley", "med"])
def bandage_use(v, i):
    trem(v, lambda sv: burst(sv, type="white", filt="bandpass", f0=2500, f1=1500, q=1, dur=0.28, g=0.35, atk=0.02), freq=v.rnd(35, 45), depth=0.45, jitter=0.1)
    cloth(v, at=0.35, n=v.irnd(5, 7), span=0.9, g=0.18, dur=0.1)
    burst(v, at=0.5, type="pink", filt="bandpass", f0=1800, q=0.8, dur=0.5, g=0.08, atk=0.1)
    trem(v, lambda sv: burst(sv, type="white", filt="bandpass", f0=3200, q=1.2, dur=0.12, g=0.2, atk=0.02), freq=v.rnd(60, 80), depth=0.4, jitter=0.05, at=1.3)  # tape
    click(v, at=1.45, f=2200, g=0.15, dur=0.006)


@sound("medkit_use", 3, "foley", desc="a medkit: zip, clasps, rummaging, a bandage, zip", tags=["foley", "med"])
def medkit_use(v, i):
    _zip(v, 0.0, 0.35, up=True, g=0.25)
    clack(v, at=0.45, f=2400, g=0.35, dur=0.015, decay=0.08)
    cloth(v, at=0.55, n=5, span=0.7, g=0.14)
    rattle(v, at=0.6, n=4, span=0.4, freqs=[2200, 3400, 5000], g=0.06, t60=0.04)
    trem(v, lambda sv: burst(sv, type="white", filt="bandpass", f0=2500, f1=1500, q=1, dur=0.25, g=0.3, atk=0.02), freq=v.rnd(35, 45), depth=0.45, jitter=0.1, at=1.4)
    cloth(v, at=1.7, n=4, span=0.6, g=0.15, dur=0.1)
    clack(v, at=2.4, f=2200, g=0.3, dur=0.012, decay=0.06)
    _zip(v, 2.5, 0.3, up=False, g=0.22)


def _zip(v: Voice, at: float, dur: float, up: bool = True, g: float = 0.3):
    n = dsp.sec(dur)
    rate = 70.0 + 40.0 * np.sin(np.linspace(0, np.pi, n))
    ph = np.cumsum(rate) / dsp.SR
    ticks = (np.diff(np.floor(ph), prepend=0) > 0).astype(float) * (0.6 + 0.4 * v.rng.random(n))
    x = dsp.lfilter([1.0], [1.0, -0.6], ticks) if hasattr(dsp, "lfilter") else ticks
    f = dsp.sweep(n, 2200.0 if up else 4200.0, 4200.0 if up else 2200.0, "exp")
    x = dsp.biquad(x, "bandpass", f, 2.5) * 3.0
    x += dsp.biquad(dsp.white(v.rng, n), "bandpass", f * 1.5, 1.0) * 0.25
    x *= dsp.env(n, 0.03, dur * 0.8, curve="cos", hold_level=1.0) * g
    v.add(x, at)


@sound("backpack_open", 2, "foley", desc="a pack swung round, a zip drawn open, the flap", tags=["foley", "backpack"])
def backpack_open(v, i):
    cloth(v, n=4, span=0.3, g=0.2)
    thump(v, at=0.15, f0=110, f1=70, dur=0.06, g=0.25)
    _zip(v, 0.3, 0.55, True, 0.3)
    cloth(v, at=0.9, n=3, span=0.25, g=0.15)
    if v.chance(0.6):
        click(v, at=0.85, f=2000, g=0.15, dur=0.006)  # buckle


@sound("backpack_close", 2, "foley", desc="zip shut, the pack settling on the shoulders", tags=["foley", "backpack"])
def backpack_close(v, i):
    cloth(v, n=2, span=0.15, g=0.15)
    _zip(v, 0.1, 0.45, False, 0.3)
    click(v, at=0.6, f=2000, g=0.15, dur=0.006)
    cloth(v, at=0.65, n=4, span=0.35, g=0.2)
    thump(v, at=0.85, f0=100, f1=60, dur=0.08, g=0.3)
    rattle(v, at=0.85, n=3, span=0.15, freqs=[2600, 4000], g=0.05, t60=0.04)


@sound("stim_use", 3, "foley", desc="an autoinjector: cap, the click, the hiss into the thigh", tags=["foley", "med"])
def stim_use(v, i):
    click(v, f=2800, g=0.3, dur=0.006)
    burst(v, at=0.02, type="pink", filt="bandpass", f0=1500, q=1, dur=0.06, g=0.1, atk=0.01)
    cloth(v, at=0.05, n=2, span=0.1, g=0.1)
    click(v, at=0.3, f=3000, g=0.5, dur=0.01)
    burst(v, at=0.31, type="white", filt="bandpass", f0=4000, f1=2500, q=1, dur=0.25, g=0.3, atk=0.01)
    grunt(v, at=0.33, f0=150, f1=110, dur=0.1, g=0.12, atk=0.01)
    modal(v, at=0.58, freqs=[5200, 7800], t60s=[0.04, 0.03], amps=[1, 0.5], exc=0.001, g=0.08)


@sound("syringe", 2, "foley", desc="a glass syringe: cap, needle, plunger", tags=["foley", "med"])
def syringe(v, i):
    glass_body(v, f=v.rnd(3800, 4600), g=0.12, t60=0.15)
    click(v, at=0.1, f=2600, g=0.2, dur=0.005)
    burst(v, at=0.3, type="white", filt="highpass", f0=5000, q=0.7, dur=0.04, g=0.15, atk=0.003)  # needle in
    burst(v, at=0.4, type="pink", filt="bandpass", f0=800, f1=500, q=1.2, dur=0.5, g=0.1, atk=0.05)  # plunger
    click(v, at=0.95, f=2200, g=0.15, dur=0.006)


@sound("pills", 2, "foley", desc="a blister pack, a pill, a swallow", tags=["foley", "med"])
def pills(v, i):
    rattle(v, n=4, span=0.25, freqs=[3200, 4800, 6400], g=0.1, t60=0.04)
    burst(v, at=0.3, type="crackle_fine", filt="bandpass", f0=4000, q=1, dur=0.08, g=0.2, atk=0.005)  # foil
    click(v, at=0.36, f=3500, g=0.2, dur=0.004)
    _swallow(v, 0.8, 0.3)


@sound("cigarette", 2, "foley", desc="a match struck, a drag, the exhale", tags=["foley"])
def cigarette(v, i):
    burst(v, type="crackle_fine", filt="bandpass", f0=3000, q=0.8, dur=0.12, g=0.25, atk=0.01)  # strike
    burst(v, at=0.12, type="pink", filt="bandpass", f0=1200, f1=600, q=0.8, dur=0.35, g=0.2, atk=0.05)  # flare
    burst(v, at=0.9, type="crackle_fine", filt="highpass", f0=3500, q=0.7, dur=0.9, g=0.08, atk=0.3)  # the ember
    burst(v, at=0.8, type="pink", filt="bandpass", f0=1300, q=1.2, dur=1.0, g=0.12, atk=0.4)  # the drag
    burst(v, at=2.2, type="pink", filt="bandpass", f0=700, q=0.9, dur=1.2, g=0.16, atk=0.2)  # exhale


# ------------------------------------------------------------------------------------------------------ pickups, drops
def _pick(v: Voice, material: str):
    cloth(v, n=2, span=0.1, g=0.18)
    if material == "metal":
        rattle(v, at=0.04, n=2, span=0.06, freqs=[2600, 3900, 5400], g=0.08, t60=0.05)
        clack(v, at=0.08, f=2800, g=0.2, dur=0.01, decay=0.05)
    elif material == "cloth":
        cloth(v, at=0.05, n=3, span=0.2, g=0.2)
    elif material == "paper":
        burst(v, at=0.03, type="pink", filt="bandpass", f0=3000, q=0.6, dur=0.15, g=0.3, atk=0.02, pr=1.1, pr1=0.85)
        burst(v, at=0.1, type="crackle_fine", filt="highpass", f0=2500, q=0.7, dur=0.1, g=0.1, atk=0.01)
    elif material == "glass":
        glass_body(v, at=0.05, f=v.rnd(2600, 3800), g=0.15, t60=0.2)
        click(v, at=0.05, f=3500, g=0.15, dur=0.004)
    elif material == "plastic":
        modal(v, at=0.05, freqs=[v.rnd(900, 1300), v.rnd(1800, 2400)], t60s=[0.03, 0.02], amps=[1, 0.5], exc=0.0015, g=0.18)
        click(v, at=0.05, f=2200, g=0.15, dur=0.005)
    elif material == "wood":
        wood_body(v, at=0.05, f=v.rnd(260, 380), g=0.25, t60=0.06)
    elif material == "ammo":
        for k in range(v.irnd(5, 8)):
            t = 0.25 * (k + v.rnd(0.1, 0.9)) / 7
            f = v.rnd(4000, 6500)
            modal(v, at=t, freqs=[f, f * 1.5], t60s=[0.05, 0.03], amps=[1, 0.5], exc=0.0008, g=0.1)
    else:
        click(v, at=0.08, f=3000, g=0.25, q=3, dur=0.008)


for _m, _n in (("item", 3), ("ammo", 3), ("metal", 3), ("cloth", 2), ("paper", 3), ("glass", 2), ("plastic", 2), ("wood", 2)):
    define("pickup_%s" % _m, (lambda m: lambda v, i: _pick(v, m))(_m), variants=_n, cat="foley", desc="picking up something %s" % ("" if _m == "item" else _m), tags=["foley", "pickup"])


def _drop(v: Voice, material: str):
    if material == "metal":
        clack(v, f=2400, g=0.5, dur=0.012, decay=0.06)
        metal_body(v, f=v.rnd(1400, 2200), g=0.3, t60=0.12, n=6, thick=0.5)
        thump(v, f0=140, f1=80, dur=0.05, g=0.3)
        if v.chance(0.6):
            clack(v, at=v.rnd(0.1, 0.16), f=2200, g=0.2, dur=0.01, decay=0.04)
    elif material == "cloth":
        thump(v, f0=110, f1=60, dur=0.08, g=0.4)
        burst(v, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.08, g=0.4, atk=0.002)
        cloth(v, at=0.01, n=3, span=0.15, g=0.2)
    elif material == "paper":
        burst(v, type="pink", filt="bandpass", f0=2500, q=0.6, dur=0.08, g=0.3, atk=0.005, pr=1.2, pr1=0.9)
        thump(v, f0=160, f1=100, dur=0.03, g=0.1)
    elif material == "glass":
        click(v, f=3800, g=0.3, dur=0.003)
        glass_body(v, f=v.rnd(2800, 3800), g=0.35, t60=0.3)
        if v.chance(0.6):
            glass_body(v, at=v.rnd(0.1, 0.18), f=v.rnd(3000, 4200), g=0.15, t60=0.2)
    elif material == "plastic":
        click(v, f=2400, g=0.35, dur=0.004)
        modal(v, freqs=[v.rnd(800, 1200), v.rnd(1600, 2200), v.rnd(2600, 3400)], t60s=[0.05, 0.035, 0.025], amps=[1, 0.5, 0.3], exc=0.002, g=0.3)
        thump(v, f0=170, f1=100, dur=0.03, g=0.2)
        if v.chance(0.6):
            modal(v, at=v.rnd(0.09, 0.15), freqs=[v.rnd(900, 1300)], t60s=[0.04], amps=[1], exc=0.002, g=0.15)
    elif material == "wood":
        wood_body(v, f=v.rnd(220, 320), g=0.5, t60=0.08)
        if v.chance(0.6):
            wood_body(v, at=v.rnd(0.09, 0.15), f=v.rnd(260, 360), g=0.25, t60=0.06)
    else:
        thump(v, f0=130, f1=70, dur=0.06, g=0.4)
        burst(v, type="brown", filt="lowpass", f0=600, q=0.7, dur=0.06, g=0.4, atk=0.002)
        click(v, f=2600, g=0.2, dur=0.005)
    burst(v, at=0.0, type="crackle_coarse", filt="lowpass", f0=2500, q=0.7, dur=0.03, g=0.1, atk=0.002)  # the ground


for _m, _n in (("item", 3), ("metal", 3), ("cloth", 2), ("paper", 2), ("glass", 2), ("plastic", 2), ("wood", 2)):
    define("drop_%s" % _m, (lambda m: lambda v, i: _drop(v, m))(_m), variants=_n, cat="foley", desc="dropping something %s on the ground" % ("" if _m == "item" else _m), tags=["foley", "drop"])


# ------------------------------------------------------------------------------------------------------ hurt, death, misc
@sound("hurt", 3, "voice", peak=-8.0, desc="a grunt of pain", tags=["player", "voice"])
def hurt(v, i):
    x = vox.scream(v.rng, v.rnd(0.18, 0.28), v.rnd(120, 160), v.pick(["a", "u", "o"]), rasp=0.5, contour="fall")
    v.add(x * 0.6, 0.0)
    thump(v, f0=80, f1=40, dur=0.12, g=0.5)


@sound("hurt_bullet", 3, "voice", peak=-8.0, desc="hit by a round: the impact and the gasp", tags=["player", "voice"])
def hurt_bullet(v, i):
    burst(v, type="white", filt="bandpass", f0=2200, f1=500, q=1, dur=0.05, g=0.5, atk=0.001)
    thump(v, f0=90, f1=40, dur=0.1, g=0.6)
    x = vox.scream(v.rng, v.rnd(0.25, 0.4), v.rnd(140, 190), v.pick(["a", "e"]), rasp=0.7, contour="fall")
    v.add(x * 0.7, 0.02)
    cloth(v, at=0.03, n=2, span=0.1, g=0.12)


@sound("death", 1, "voice", peak=-4.0, desc="the end: a fall, the last breath, a low tone sinking, static", tags=["player", "voice"])
def death(v, i):
    thump(v, f0=70, f1=28, dur=0.45, g=1.0)
    burst(v, type="brown", filt="lowpass", f0=500, f1=120, q=0.7, dur=0.4, g=0.5, atk=0.005)
    cloth(v, at=0.1, n=4, span=0.5, g=0.2)
    x = vox.scream(v.rng, 0.9, 110, "o", rasp=0.8, contour="fall")
    v.add(dsp.lowpass(x, 1200.0) * 0.5, 0.15)
    tone(v, type="sawtooth", f0=110, f1=38, dur=3.0, g=0.28, atk=0.05, lp=420, lq=1.1, curve="lin")
    tone(v, f0=55, f1=24, dur=3.0, g=0.25, atk=0.1, curve="lin")
    for at, g in ((0.5, 0.6), (0.85, 0.45), (1.55, 0.5), (1.9, 0.35), (2.7, 0.35)):
        thump(v, at=at, f0=62, f1=40, dur=0.12, g=g)
    burst(v, type="pink", filt="highpass", f0=2000, q=0.5, dur=3.2, g=0.05, atk=2.4, curve="lin")
    burst(v, at=1.5, type="crackle", filt="lowpass", f0=4000, q=0.7, dur=2.0, g=0.15, atk=1.5, curve="lin")


@sound("gas_cough", 3, "voice", peak=-8.0, desc="coughing in gas", tags=["player", "voice"])
def gas_cough(v, i):
    for k in range(v.irnd(2, 3)):
        at = k * v.rnd(0.24, 0.32)
        x = vox.scream(v.rng, v.rnd(0.12, 0.18), v.rnd(110, 150), v.pick(["a", "o"]), rasp=0.4, contour="fall")
        v.add(dsp.lowpass(x, 2500.0) * 0.7, at)
        burst(v, at=at, type="pink", filt="bandpass", f0=900, f1=500, q=1.2, dur=0.1, g=0.3, atk=0.003)
        thump(v, at=at, f0=110, f1=70, dur=0.06, g=0.3)
    burst(v, at=0.6, type="pink", filt="highpass", f0=1000, q=0.6, dur=0.3, g=0.1, atk=0.1)


@sound("flashlight", 2, "foley", peak=-14.0, desc="the torch switch", tags=["foley"])
def flashlight(v, i):
    burst(v, type="white", filt="bandpass", f0=2800, q=2, dur=0.008, g=0.55, atk=0.0005)
    modal(v, freqs=[1100, 2400, 3600], t60s=[0.03, 0.02, 0.015], amps=[1, 0.5, 0.3], exc=0.001, g=0.2)
    tone(v, f0=300, f1=200, dur=0.02, g=0.3, atk=0.0005)


@sound("click", 2, "ui", desc="a small dead click (empty battery, nothing happens)", tags=["ui"])
def click_only(v, i):
    burst(v, type="white", filt="bandpass", f0=2600, q=3, dur=0.008, g=0.45, atk=0.0005)
    modal(v, freqs=[3400], t60s=[0.03], amps=[1], exc=0.001, g=0.1)


@sound("nvg_on", 1, "foley", peak=-14.0, desc="night vision powering up: switch, the tube's whine rising", tags=["foley", "nvg"])
def nvg_on(v, i):
    click(v, f=2400, g=0.3, dur=0.005)
    tone(v, at=0.03, f0=800, f1=9000, dur=0.5, g=0.06, atk=0.05, hold=0.2, curve="lin")
    tone(v, at=0.4, f0=9000, dur=0.6, g=0.03, atk=0.1, hold=0.4, curve="lin")
    burst(v, at=0.05, type="white", filt="highpass", f0=6000, q=0.6, dur=0.5, g=0.03, atk=0.1)


@sound("nvg_off", 1, "foley", peak=-14.0, desc="night vision off: the whine falling away", tags=["foley", "nvg"])
def nvg_off(v, i):
    click(v, f=2400, g=0.3, dur=0.005)
    tone(v, at=0.01, f0=9000, f1=600, dur=0.4, g=0.05, atk=0.005, curve="lin")


@sound("mask_on", 1, "foley", desc="a gas mask pulled on: rubber, straps, the seal", tags=["foley", "mask"])
def mask_on(v, i):
    cloth(v, n=3, span=0.3, g=0.15)
    burst(v, at=0.1, type="pink", filt="bandpass", f0=800, f1=400, q=1.2, dur=0.3, g=0.25, atk=0.05)  # rubber stretching
    burst(v, at=0.3, type="white", filt="bandpass", f0=2200, q=1.0, dur=0.15, g=0.1, atk=0.03)  # straps
    burst(v, at=0.55, type="pink", filt="bandpass", f0=600, q=1.5, dur=0.12, g=0.2, atk=0.02)  # the seal
    sv = v.sub(); _breath_cycle(sv, 0.0, 1.6, 1.0); v.add(dsp.bandpass(sv.render(), 900.0, 0.8) * 1.5, 0.7)


@sound("mask_off", 1, "foley", desc="a gas mask pulled off, a breath of open air", tags=["foley", "mask"])
def mask_off(v, i):
    burst(v, type="pink", filt="bandpass", f0=500, f1=900, q=1.2, dur=0.25, g=0.25, atk=0.03)
    cloth(v, at=0.2, n=3, span=0.3, g=0.15)
    burst(v, at=0.4, type="pink", filt="bandpass", f0=1400, q=1.0, dur=0.5, g=0.15, atk=0.1)


@sound("binoculars", 2, "foley", desc="binoculars raised", tags=["foley"])
def binoculars(v, i):
    cloth(v, n=2, span=0.15, g=0.15)
    burst(v, at=0.05, type="pink", filt="bandpass", f0=600, q=1.0, dur=0.12, g=0.08, atk=0.03)
    click(v, at=0.2, f=2000, g=0.12, dur=0.005)


@sound("watch_raise", 2, "foley", peak=-16.0, desc="the sleeve pulled back", tags=["foley"])
def watch_raise(v, i):
    cloth(v, n=3, span=0.2, f=2000, g=0.2)
