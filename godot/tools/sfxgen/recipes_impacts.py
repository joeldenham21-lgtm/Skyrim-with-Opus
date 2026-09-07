"""Bullet impacts per surface, ricochets, passing rounds, armour hits, casings falling on things, explosions."""
import numpy as np
from . import dsp, synth, reverb
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, glass_body, whoosh, rattle
from .registry import sound, define, alias


# ------------------------------------------------------------------------------------------------------ impacts
def _debris(v: Voice, n: int, span: float, f0: float, f1: float, g: float, at: float = 0.02, decay: float = 0.85):
    pulses(v, n=n, at=at, span=span, type="white", f0=f0, f1=f1, q=2.5, dur=0.01, g=g, decay=decay)


@sound("impact_dirt", 4, "impact", desc="a round into soil: thud and a spray of earth", tags=["impact"])
def impact_dirt(v, i):
    thump(v, f0=110, f1=50, dur=0.08, g=0.5)
    burst(v, type="brown", filt="lowpass", f0=400, q=0.7, dur=0.08, g=0.5, atk=0.001)
    burst(v, at=0.004, type="pink", filt="bandpass", f0=1800, f1=700, q=0.8, dur=0.16, g=0.25, atk=0.006)
    _debris(v, v.irnd(5, 9), 0.2, 1200, 2600, 0.07, 0.03, 0.8)  # clods landing
    burst(v, at=0.03, type="pink", filt="highpass", f0=3000, q=0.6, dur=0.2, g=0.05, atk=0.02)  # dust


@sound("impact_mud", 3, "impact", desc="a round into mud: wet slap, no debris", tags=["impact"])
def impact_mud(v, i):
    thump(v, f0=100, f1=45, dur=0.09, g=0.5)
    burst(v, type="pink", filt="bandpass", f0=900, f1=300, q=1.2, dur=0.12, g=0.45, atk=0.002, pr=1.2, pr1=0.6)
    burst(v, at=0.01, type="crackle_fine", filt="lowpass", f0=2500, q=0.7, dur=0.08, g=0.15, atk=0.004)
    tinkle(v, n=2, at=0.05, span=0.1, f0=1200, f1=2200, dur=0.03, g=0.03)


@sound("impact_sand", 3, "impact", desc="a round into sand: soft thud and a hiss of grains", tags=["impact"])
def impact_sand(v, i):
    thump(v, f0=120, f1=55, dur=0.07, g=0.4)
    burst(v, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.06, g=0.4, atk=0.001)
    burst(v, at=0.003, type="white", filt="bandpass", f0=4500, f1=2500, q=0.8, dur=0.2, g=0.25, atk=0.004)
    _debris(v, v.irnd(8, 14), 0.2, 3000, 6000, 0.03, 0.02, 0.9)


@sound("impact_gravel", 4, "impact", desc="a round into gravel: crunch and scattering stones", tags=["impact"])
def impact_gravel(v, i):
    thump(v, f0=130, f1=60, dur=0.06, g=0.4)
    burst(v, type="white", filt="bandpass", f0=2200, f1=1200, q=1.0, dur=0.05, g=0.5, atk=0.001)
    _debris(v, v.irnd(8, 14), 0.25, 1500, 4000, 0.16, 0.005, 0.86)
    for k in range(v.irnd(2, 4)):
        modal(v, at=v.rnd(0.03, 0.25), freqs=[v.rnd(1800, 3200), v.rnd(3500, 5000)], t60s=[0.03, 0.02], amps=[1, 0.5], exc=0.001, g=0.08)


@sound("impact_concrete", 4, "impact", desc="a round into concrete: sharp crack, chips, dust", tags=["impact"])
def impact_concrete(v, i):
    click(v, f=4500, g=0.7, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=2500, f1=900, q=1, dur=0.04, g=0.8, atk=0.0008, sat=2.5)
    _debris(v, v.irnd(5, 8), 0.15, 1500, 3200, 0.15, 0.02, 0.85)
    burst(v, at=0.01, type="pink", filt="lowpass", f0=1500, q=0.7, dur=0.12, g=0.2, atk=0.01)
    burst(v, at=0.02, type="pink", filt="highpass", f0=2500, q=0.6, dur=0.3, g=0.06, atk=0.03)
    modal(v, freqs=[1900, 3300], t60s=[0.05, 0.03], amps=[1, 0.4], exc=0.001, g=0.08)
alias("impact_rock", "impact_concrete"); alias("impact_road", "impact_concrete"); alias("impact_grass", "impact_dirt"); alias("impact_snow", "impact_sand")


@sound("impact_brick", 3, "impact", desc="a round into brick: a lower knock, chips of clay", tags=["impact"])
def impact_brick(v, i):
    click(v, f=3800, g=0.6, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=1800, f1=600, q=1, dur=0.045, g=0.75, atk=0.0008, sat=2.0)
    modal(v, freqs=[900, 1500, 2400], t60s=[0.08, 0.05, 0.03], amps=[1, 0.5, 0.3], exc=0.0015, g=0.18)
    _debris(v, v.irnd(4, 7), 0.15, 1200, 2600, 0.14, 0.02, 0.85)
    burst(v, at=0.02, type="pink", filt="highpass", f0=2000, q=0.6, dur=0.25, g=0.06, atk=0.03)


@sound("impact_metal", 4, "impact", desc="a round through sheet metal: bright tick, the panel booms and rings", tags=["impact"])
def impact_metal(v, i):
    click(v, f=4000, g=0.6, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=3000, q=1, dur=0.02, g=0.5, atk=0.0008)
    metal_body(v, f=v.rnd(2100, 2800), g=0.35, t60=0.35, n=8, thick=0.3)
    modal(v, at=0.002, freqs=[v.rnd(160, 260), v.rnd(300, 420), v.rnd(500, 700)], t60s=[0.25, 0.18, 0.12], amps=[1, 0.6, 0.4], exc=0.003, g=0.3)  # the panel
    thump(v, f0=120, f1=70, dur=0.05, g=0.3)


@sound("impact_metal_thick", 3, "impact", desc="a round on heavy steel: a dense tink and a dull thud, no ring", tags=["impact"])
def impact_metal_thick(v, i):
    click(v, f=5000, g=0.7, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=3500, f1=2000, q=1.2, dur=0.015, g=0.6, atk=0.0006)
    modal(v, freqs=[v.rnd(2400, 3200), v.rnd(4200, 5500), v.rnd(6500, 8000)], t60s=[0.07, 0.05, 0.03], amps=[1, 0.6, 0.3], exc=0.001, g=0.35)
    thump(v, f0=140, f1=80, dur=0.05, g=0.4)
    burst(v, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.05, g=0.3, atk=0.001)


@sound("impact_wood", 4, "impact", desc="a round into planks: knock and splinters", tags=["impact"])
def impact_wood(v, i):
    wood_body(v, f=v.rnd(200, 260), g=0.6, t60=0.1)
    burst(v, type="white", filt="lowpass", f0=1500, q=0.7, dur=0.03, g=0.4, atk=0.001)
    _debris(v, v.irnd(3, 6), 0.12, 2500, 4500, 0.15, 0.01, 0.8)
    burst(v, at=0.01, type="crackle_coarse", filt="bandpass", f0=1800, q=1, dur=0.08, g=0.2, atk=0.003)  # splintering


@sound("impact_water", 4, "impact", desc="a round into water: a plip and a short splash", tags=["impact"])
def impact_water(v, i):
    tone(v, f0=500, f1=1400, dur=0.04, g=0.3, atk=0.002)
    burst(v, type="white", filt="bandpass", f0=3000, f1=800, q=1, dur=0.06, g=0.3, atk=0.002)
    burst(v, at=0.02, type="pink", filt="bandpass", f0=1500, q=0.8, dur=0.12, g=0.15, atk=0.01)
    tinkle(v, n=v.irnd(3, 5), at=0.04, span=0.2, f0=1200, f1=3000, dur=0.03, g=0.04)  # droplets falling back
    thump(v, f0=90, f1=50, dur=0.06, g=0.2)


@sound("impact_flesh", 4, "impact", desc="a round into a body: wet slap, low thud", tags=["impact"])
def impact_flesh(v, i):
    thump(v, f0=130, f1=60, dur=0.07, g=0.6)
    burst(v, type="brown", filt="lowpass", f0=600, q=0.8, dur=0.06, g=0.5, atk=0.001)
    burst(v, type="pink", filt="bandpass", f0=700, f1=300, q=1.4, dur=0.08, g=0.5, atk=0.001, pr=1.3, pr1=0.6)
    burst(v, at=0.005, type="crackle_fine", filt="lowpass", f0=3000, q=0.7, dur=0.05, g=0.15, atk=0.002)
    cloth(v, at=0.02, n=2, span=0.08, g=0.1)


@sound("impact_glass", 4, "impact", desc="a round through a pane: crack and a fall of shards", tags=["impact"])
def impact_glass(v, i):
    burst(v, type="white", filt="highpass", f0=3000, q=0.7, dur=0.02, g=0.5, atk=0.0005)
    glass_body(v, f=v.rnd(2800, 3600), g=0.3, t60=0.25)
    tinkle(v, n=v.irnd(6, 9), at=0.005, span=0.3, f0=2500, f1=6500, dur=0.09, g=0.08)
    for k in range(v.irnd(3, 5)):
        glass_body(v, at=v.rnd(0.05, 0.4), f=v.rnd(3000, 6000), g=0.08, t60=0.12)


@sound("impact_ash", 4, "impact", desc="a round into a mimic: dry, papery, a puff", tags=["impact", "mimic"])
def impact_ash(v, i):
    thump(v, f0=90, f1=50, dur=0.09, g=0.4)
    burst(v, type="brown", filt="lowpass", f0=300, q=0.7, dur=0.1, g=0.4, atk=0.004)
    burst(v, type="white", filt="bandpass", f0=1200, f1=500, q=1, dur=0.05, g=0.5, atk=0.001)
    burst(v, at=0.01, type="pink", filt="highpass", f0=2500, q=0.5, dur=0.25, g=0.08, atk=0.03)
    burst(v, at=0.02, type="crackle", filt="lowpass", f0=5000, q=0.7, dur=0.1, g=0.15, atk=0.002)


@sound("ricochet", 4, "impact", desc="a spinning fragment zinging off: spark tick, a falling whine with fast flutter", tags=["impact"])
def ricochet(v, i):
    click(v, f=5000, g=0.6, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=4000, f1=1500, q=1.5, dur=0.04, g=0.5, atk=0.0006)
    f0 = v.rnd(3200, 4800); dur = v.rnd(0.25, 0.5)
    sv = v.sub()
    tone(sv, at=0.01, type="triangle", f0=f0, f1=f0 * 0.32, dur=dur, g=0.35, atk=0.004, vib=dict(f=v.rnd(35, 70), depth=f0 * 0.03), lp=6000)
    tone(sv, at=0.01, type="sine", f0=f0 * 1.5, f1=f0 * 0.5, dur=dur * 0.8, g=0.15, atk=0.004)
    burst(sv, at=0.01, type="white", filt="bandpass", f0=f0, f1=f0 * 0.35, q=6, dur=dur, g=0.3, atk=0.004)
    x = synth.tremolo(sv.render(), v.rnd(90, 180), 0.35, v.rng, 0.2)
    v.add(dsp.saturate(x, 1.5), 0.0)
    thump(v, f0=150, f1=90, dur=0.03, g=0.15)


@sound("bullet_crack", 4, "impact", desc="a supersonic round passing close: the N-wave snap", tags=["impact"])
def bullet_crack(v, i):
    burst(v, type="white", filt="highpass", f0=2500, q=0.7, dur=0.003, g=1.0, atk=0.0001)
    burst(v, at=0.001, type="white", filt="bandpass", f0=4500, f1=2500, q=1.2, dur=0.02, g=0.5, atk=0.0005, sat=3.0)
    thump(v, f0=250, f1=120, dur=0.015, g=0.4)
    burst(v, at=0.01, type="white", filt="bandpass", f0=3500, f1=1200, q=2, dur=0.05, g=0.2, atk=0.003)  # the trailing whizz
    tail(v, at=0.01, dur=0.12, g=0.06, f0=3000, f1=600)


@sound("bullet_whiz", 4, "impact", desc="a subsonic round passing: a short doppler whoosh", tags=["impact"])
def bullet_whiz(v, i):
    burst(v, type="white", filt="bandpass", f0=5000, f1=1200, q=2, dur=0.08, g=0.7, atk=0.005, hp=1500)
    tone(v, f0=3200, f1=900, dur=0.08, g=0.1, atk=0.005)
    burst(v, at=0.02, type="pink", filt="bandpass", f0=2500, f1=800, q=1.5, dur=0.07, g=0.2, atk=0.01)


@sound("hit_helmet", 3, "impact", desc="a round on a steel helmet: the ring", tags=["impact", "armor"])
def hit_helmet(v, i):
    click(v, f=4500, g=0.6, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=3200, q=1, dur=0.02, g=0.5, atk=0.0006)
    modal(v, freqs=[v.rnd(1900, 2300), v.rnd(2900, 3400), v.rnd(4300, 4900), v.rnd(6000, 7000)], t60s=[0.45, 0.35, 0.25, 0.15], amps=[1, 0.7, 0.4, 0.25], exc=0.0012, g=0.4)
    thump(v, f0=160, f1=90, dur=0.05, g=0.35)


@sound("hit_armor", 3, "impact", desc="a round stopped by a plate: a hard flat thwack", tags=["impact", "armor"])
def hit_armor(v, i):
    click(v, f=3500, g=0.6, dur=0.003)
    burst(v, type="white", filt="bandpass", f0=1600, f1=500, q=1, dur=0.035, g=0.8, atk=0.0006, sat=2.5)
    thump(v, f0=140, f1=60, dur=0.08, g=0.7)
    burst(v, type="brown", filt="lowpass", f0=600, q=0.8, dur=0.06, g=0.5, atk=0.001)
    modal(v, freqs=[v.rnd(700, 900), v.rnd(1400, 1700)], t60s=[0.06, 0.04], amps=[1, 0.5], exc=0.002, g=0.15)
    cloth(v, at=0.01, n=2, span=0.06, g=0.12)


# ------------------------------------------------------------------------------------------------------ casings
def _bounces(v: Voice, first: float, gap0: float, count: int, fn):
    t, gap = first, gap0
    for k in range(count):
        fn(t, k)
        t += gap; gap *= v.rnd(0.55, 0.72)


def _brass(v: Voice, at: float, f: float, g: float, t60: float = 0.04):
    modal(v, at=at, freqs=[f, f * 1.42, f * 1.9, f * 2.6], t60s=[t60, t60 * 0.8, t60 * 0.6, t60 * 0.4], amps=[1, 0.6, 0.4, 0.2], exc=0.0008, g=g)


def _casing(v: Voice, surface: str, f: float, hull: bool = False):
    g0 = 0.35
    if surface == "concrete":
        def hit(t, k):
            gg = g0 * (0.6 ** k)
            click(v, at=t, f=5000 if not hull else 2600, g=gg * 0.6, dur=0.002)
            if hull:
                modal(v, at=t, freqs=[900, 1500, 2300], t60s=[0.03, 0.02, 0.015], amps=[1, 0.5, 0.3], exc=0.001, g=gg * 0.8)
            else:
                _brass(v, t, f * v.rnd(0.97, 1.03), gg)
        _bounces(v, 0.0, v.rnd(0.09, 0.14), v.irnd(3, 5), hit)
        if not hull and v.chance(0.6):
            pulses(v, n=v.irnd(4, 8), at=0.35, span=0.25, type="white", f0=3500, f1=6000, q=4, dur=0.004, g=0.05, decay=0.85)  # rolling
    elif surface == "dirt":
        thump(v, f0=200, f1=120, dur=0.03, g=0.25)
        burst(v, type="pink", filt="bandpass", f0=1200, q=1, dur=0.04, g=0.3, atk=0.002)
        if not hull:
            _brass(v, 0.0, f, 0.12, 0.015)
        if v.chance(0.5):
            burst(v, at=0.08, type="pink", filt="bandpass", f0=1000, q=1, dur=0.03, g=0.15, atk=0.002)
    elif surface == "wood":
        def hit(t, k):
            gg = g0 * (0.6 ** k)
            wood_body(v, at=t, f=v.rnd(300, 420), g=gg * 0.8, t60=0.05)
            if not hull:
                _brass(v, t, f * v.rnd(0.97, 1.03), gg * 0.5, 0.02)
        _bounces(v, 0.0, v.rnd(0.08, 0.12), v.irnd(2, 4), hit)
    elif surface == "metal":
        def hit(t, k):
            gg = g0 * (0.6 ** k)
            click(v, at=t, f=4500, g=gg * 0.5, dur=0.002)
            metal_body(v, at=t, f=v.rnd(1400, 2200), g=gg * 0.7, t60=0.18, n=6, thick=0.3)
            if not hull:
                _brass(v, t, f * v.rnd(0.97, 1.03), gg * 0.6)
        _bounces(v, 0.0, v.rnd(0.09, 0.13), v.irnd(3, 5), hit)


for _s in ("concrete", "dirt", "wood", "metal"):
    define("casing_%s" % _s, (lambda s: lambda v, i: _casing(v, s, v.rnd(4200, 5600)))(_s), variants=4, cat="casing", desc="brass pistol/rifle case on %s" % _s, tags=["casing"])
    define("casing_rifle_%s" % _s, (lambda s: lambda v, i: _casing(v, s, v.rnd(2600, 3600)))(_s), variants=3, cat="casing", desc="steel rifle case on %s" % _s, tags=["casing"])
    define("shell_%s" % _s, (lambda s: lambda v, i: _casing(v, s, 900.0, True))(_s), variants=3, cat="casing", desc="12 ga plastic hull on %s" % _s, tags=["casing"])
alias("casing_grass", "casing_dirt"); alias("casing_mud", "casing_dirt"); alias("casing_gravel", "casing_concrete"); alias("casing_rock", "casing_concrete"); alias("casing_road", "casing_concrete")


# ------------------------------------------------------------------------------------------------------ explosions
def _frag_blast(v: Voice, size: float = 1.0):
    click(v, g=1.0, f=3000, dur=0.004)
    burst(v, type="white", filt="bandpass", f0=2800, f1=200, q=0.6, dur=0.14 * size, g=1.2, atk=0.0008, sat=4.0)
    burst(v, at=0.002, type="white", filt="lowpass", f0=6000, f1=300, q=0.8, dur=0.1 * size, g=0.9, atk=0.0005, sat=5.0)
    thump(v, f0=70, f1=22, dur=0.5 * size, g=1.4, sat=2.0)
    burst(v, type="brown", filt="lowpass", f0=200, f1=60, q=0.8, dur=0.45 * size, g=1.0, atk=0.002, sat=2.0)
    tone(v, type="sawtooth", f0=90, f1=35, dur=0.12 * size, g=0.5, lp=500, shape=10, atk=0.001)
    burst(v, at=0.03, type="crackle", filt="lowpass", f0=4000, q=0.7, dur=0.4, g=0.5, atk=0.005)  # burning
    # shrapnel and debris
    pulses(v, n=v.irnd(6, 10), at=0.02, span=0.25, type="white", f0=3000, f1=6000, q=3, dur=0.006, g=0.35, decay=0.85)
    for k in range(v.irnd(3, 5)):
        t = v.rnd(0.08, 0.3)
        sv = v.sub(); ricochet(sv, 0); v.add(sv.render() * v.rnd(0.15, 0.3), t)
    pulses(v, n=v.irnd(14, 24), at=0.4, span=1.4 * size, type="white", f0=800, f1=2400, q=2.5, dur=0.012, g=0.2, decay=0.93)  # earth falling back
    burst(v, at=0.3, type="pink", filt="bandpass", f0=1500, f1=600, q=0.8, dur=1.2 * size, g=0.15, atk=0.1)  # dust settling


@sound("explosion_frag", 3, "explosion", desc="a fragmentation grenade close by: crack, sub, shrapnel whine, earth falling back", tags=["explosion", "grenade"])
def explosion_frag(v, i):
    _frag_blast(v, 1.0)
    return reverb.place(dsp.saturate(v.render(), 2.5), "field_big", v.rng, wet_db=-6.0)


@sound("explosion_frag_far", 3, "explosion", desc="a grenade 150-400 m off", tags=["explosion", "grenade"])
def explosion_frag_far(v, i):
    dv = Voice(v.rng); _frag_blast(dv, 1.0)
    return reverb.far(dsp.saturate(dv.render(), 2.5), v.rnd(150, 400), v.rng)


@sound("explosion_frag_indoor", 2, "explosion", desc="a grenade in a concrete room", tags=["explosion", "grenade"])
def explosion_frag_indoor(v, i):
    _frag_blast(v, 0.9)
    return reverb.place(dsp.saturate(v.render(), 2.5), "bunker", v.rng, wet_db=0.0)


@sound("explosion_gas", 2, "explosion", desc="a gas anomaly igniting: a whoomp and a roar of fire", tags=["explosion", "anomaly"])
def explosion_gas(v, i):
    burst(v, type="brown", filt="lowpass", f0=250, f1=120, q=0.8, dur=0.35, g=1.0, atk=0.03, sat=2.0)
    thump(v, at=0.02, f0=60, f1=25, dur=0.5, g=1.1, atk=0.02)
    burst(v, at=0.01, type="pink", filt="bandpass", f0=800, f1=300, q=0.8, dur=0.4, g=0.5, atk=0.02)
    whoosh(v, at=0.0, f0=300, f1=2500, q=0.8, dur=0.35, g=0.5, peak=0.3)
    # the roar: crackle and pink through a moving lowpass for 1.6 s
    n = dsp.sec(1.8)
    roar = dsp.crackle(v.rng, n, 1200.0) * 0.6 + dsp.pink(v.rng, n) * 0.8
    roar = dsp.biquad(roar, "lowpass", 1200.0 + 600.0 * np.sin(np.linspace(0, 9, n)), 0.8)
    roar *= dsp.env(n, 0.05, 0.4, curve="exp", hold_level=0.8) * 0.6
    v.add(dsp.saturate(roar, 2.0), 0.15)
    burst(v, at=0.4, type="pink", filt="highpass", f0=2500, q=0.6, dur=1.2, g=0.08, atk=0.2)
    return reverb.place(dsp.saturate(v.render(), 2.0), "field", v.rng, wet_db=-8.0)


@sound("artifact_pop", 3, "explosion", peak=-4.0, desc="an artifact bursting: a glassy pop, a resonance sweeping up, a shimmer", tags=["explosion", "artifact"])
def artifact_pop(v, i):
    burst(v, type="white", filt="highpass", f0=2500, q=0.7, dur=0.03, g=0.7, atk=0.0005)
    thump(v, f0=120, f1=45, dur=0.2, g=0.7)
    tone(v, f0=600, f1=2400, dur=0.35, g=0.3, atk=0.005, fcurve="exp")
    tone(v, at=0.01, f0=900, f1=3600, dur=0.3, g=0.15, atk=0.005)
    glass_body(v, f=v.rnd(3000, 4200), g=0.3, t60=0.5)
    tinkle(v, n=v.irnd(8, 12), at=0.02, span=0.6, f0=3000, f1=8000, dur=0.15, g=0.07)
    burst(v, at=0.05, type="white", filt="highpass", f0=5000, q=0.5, dur=0.8, g=0.08, atk=0.1)
    return reverb.place(v.render(), "village", v.rng, wet_db=-8.0)


@sound("flashbang", 2, "explosion", desc="a stun grenade: a white crack and the ears ringing", tags=["explosion", "grenade"])
def flashbang(v, i):
    click(v, g=1.0, f=4500, dur=0.004)
    burst(v, type="white", filt="highpass", f0=800, q=0.7, dur=0.09, g=1.2, atk=0.0005, sat=6.0)
    burst(v, type="white", filt="bandpass", f0=3500, f1=600, q=0.7, dur=0.12, g=1.0, atk=0.0008, sat=3.0)
    thump(v, f0=90, f1=30, dur=0.25, g=0.9)
    tone(v, at=0.05, f0=3400, dur=2.5, g=0.18, atk=0.02, hold=1.2, curve="lin")  # tinnitus
    tone(v, at=0.05, f0=3400 * 1.003, dur=2.3, g=0.1, atk=0.02, hold=1.0, curve="lin")
    burst(v, at=0.1, type="pink", filt="highpass", f0=4000, q=0.5, dur=1.5, g=0.06, atk=0.1)
    return reverb.place(dsp.saturate(v.render(), 2.0), "village", v.rng, wet_db=-6.0)


@sound("smoke_pop", 2, "foley", desc="a smoke grenade: fuse pop, then the long hiss of the charge", tags=["grenade"])
def smoke_pop(v, i):
    click(v, f=2500, g=0.5, dur=0.005)
    burst(v, type="brown", filt="lowpass", f0=500, q=0.8, dur=0.08, g=0.6, atk=0.002)
    thump(v, f0=140, f1=60, dur=0.1, g=0.5)
    n = dsp.sec(4.0)
    hiss = dsp.white(v.rng, n)
    hiss = dsp.biquad(hiss, "bandpass", 1800.0 + 500.0 * np.sin(np.linspace(0, 5, n)), 0.9)
    hiss *= dsp.env(n, 0.08, 2.5, curve="cos", hold_level=0.9) * 0.4
    hiss += dsp.crackle(v.rng, n, 200.0) * dsp.env(n, 0.1, 2.0, curve="cos") * 0.08
    v.add(hiss, 0.05)


@sound("grenade_hiss", 2, "foley", desc="a live grenade's fuse: 3.5 s of hiss and sputter", tags=["grenade"], fade_out=0.05)
def grenade_hiss(v, i):
    n = dsp.sec(3.6)
    tt = np.arange(n) / dsp.SR
    h = dsp.biquad(dsp.white(v.rng, n), "bandpass", 3800.0 + 900.0 * np.sin(2 * np.pi * 0.9 * tt) + 300.0 * np.sin(2 * np.pi * 4.1 * tt), 1.6) * 0.35
    h += dsp.biquad(dsp.crackle(v.rng, n, 80.0, 0.5), "bandpass", 1800.0, 1.0) * 0.2  # sputter
    h += dsp.lowpass(dsp.brown(v.rng, n), 120.0) * 0.06
    h *= dsp.env(n, 0.05, 3.2, curve="lin", hold_level=1.0) * (1.0 + 0.2 * dsp.smooth(v.rng.standard_normal(n), 0.03))
    v.add(h, 0.0)
    click(v, f=3000, g=0.3, dur=0.004)


def _bounce(v: Voice, surface: str):
    """a grenade body (a steel can) landing and bouncing"""
    def one(t, k):
        gg = 0.6 ** k
        if surface == "concrete":
            click(v, at=t, f=3500, g=0.5 * gg, dur=0.003)
            metal_body(v, at=t, f=v.rnd(1500, 2100), g=0.35 * gg, t60=0.12, n=7, thick=0.6)
            thump(v, at=t, f0=180, f1=100, dur=0.03, g=0.3 * gg)
        elif surface == "dirt":
            thump(v, at=t, f0=140, f1=70, dur=0.05, g=0.45 * gg)
            burst(v, at=t, type="pink", filt="bandpass", f0=1000, q=1, dur=0.05, g=0.35 * gg, atk=0.002)
            metal_body(v, at=t, f=1700, g=0.08 * gg, t60=0.05, n=4)
        elif surface == "wood":
            wood_body(v, at=t, f=v.rnd(220, 300), g=0.5 * gg, t60=0.08)
            metal_body(v, at=t, f=1700, g=0.15 * gg, t60=0.06, n=5)
        else:  # metal
            click(v, at=t, f=4000, g=0.5 * gg, dur=0.003)
            metal_body(v, at=t, f=v.rnd(1200, 1800), g=0.4 * gg, t60=0.3, n=8, thick=0.35)
            modal(v, at=t, freqs=[v.rnd(200, 320)], t60s=[0.25], amps=[1], exc=0.003, g=0.25 * gg)
    _bounces(v, 0.0, v.rnd(0.14, 0.22), v.irnd(2, 3) if surface != "dirt" else v.irnd(1, 2), one)
    if surface in ("concrete", "metal") and v.chance(0.7):
        pulses(v, n=v.irnd(5, 9), at=0.45, span=0.4, type="white", f0=2000, f1=3500, q=4, dur=0.005, g=0.06, decay=0.85)  # rolling


for _s in ("concrete", "dirt", "wood", "metal"):
    define("grenade_bounce_%s" % _s, (lambda s: lambda v, i: _bounce(v, s))(_s), variants=3, cat="impact", peak=-9.0, desc="a grenade landing on %s" % _s, tags=["grenade"])
alias("grenade_bounce_grass", "grenade_bounce_dirt"); alias("grenade_bounce_mud", "grenade_bounce_dirt"); alias("grenade_bounce_gravel", "grenade_bounce_concrete"); alias("grenade_bounce_rock", "grenade_bounce_concrete")
