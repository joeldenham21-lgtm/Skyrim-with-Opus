"""The things in the zone: mimics (garbled radio voices, screams, pain, death, steps, handling), sliders, fragments,
spawn, seekers, phantoms."""
import numpy as np
from . import dsp, synth, reverb, voice as vox
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, glass_body, whoosh, rattle, grunt
from .registry import sound, define, alias
from . import recipes_foley as foley
from . import recipes_weapons as weap

LOOP = 8.0


# ------------------------------------------------------------------------------------------------------ mimic voices
def _phrase(v: Voice, key: str, pitch=None, speed=None, drive: float = 4.5, detune: float = 0.03, ringmod: float = 0.0, echo: float = 0.0,
            static: float = 0.08, reverse: bool = True, contour: str = "fall") -> np.ndarray:
    phones, stress, _ = vox.PHRASES[key]
    p = v.rnd(100, 135) if pitch is None else pitch
    s = v.rnd(0.9, 1.15) if speed is None else speed
    x = vox.vocal(v.rng, phones, stress, p, s, breathy=v.rnd(0.1, 0.25), tense=v.rnd(0.4, 0.7), contour=contour)
    x = vox.mimic_process(x, v.rng, detune=detune, reverse_tail=reverse, ringmod=ringmod, echo=echo)
    return vox.radio(x, v.rng, drive=drive, bits=v.rnd(6.5, 8.0), static=static, dropouts=v.irnd(0, 2))


RADIO = ["priyom", "vizhu_tsel", "chisto", "zdes_nikogo"]
CHATTER = ["pomogi", "kholodno", "domoy", "eto_ne_ya"]
ALERT = ["kontakt", "ogon", "nazad", "granata"]
HUNT = ["gde_on", "on_ryadom", "idi_syuda", "tikho"]
CALL = ["vtoroy", "slyshish", "oni_zdes", "ne_strelyai", "otkhodim", "ranen", "perezaryazhayu", "vsyo"]


def _mk_phrase_set(keys, **kw):
    def fn(v, i):
        return _phrase(v, keys[i % len(keys)], **kw)
    return fn


define("mimic_radio", _mk_phrase_set(RADIO), variants=4, cat="voice", desc="radio procedure words: over / target in sight / clear / nobody here", tags=["mimic", "voice"])
define("mimic_chatter", _mk_phrase_set(CHATTER, drive=5.5, detune=0.045, ringmod=0.25, echo=0.3), variants=4, cat="voice",
       desc="the wrong things it says: help me / it's cold / home / this is not me — doubled, ring-modulated, a reversed tail", tags=["mimic", "voice"])
define("mimic_alert", _mk_phrase_set(ALERT, pitch=140, speed=1.3, drive=7.0, contour="rise", static=0.12), variants=4, cat="voice",
       desc="barked: contact / fire / back back / grenade", tags=["mimic", "voice"])
define("mimic_hunt", _mk_phrase_set(HUNT, pitch=105, speed=0.85, drive=4.0, detune=0.02, echo=0.2, static=0.06), variants=4, cat="voice",
       desc="low, searching: where is he / he is close / come here / quiet", tags=["mimic", "voice"])
define("mimic_call", _mk_phrase_set(CALL, drive=5.0, detune=0.035, static=0.1), variants=4, cat="voice",
       desc="squad talk: second, respond / can you hear me / they are here / don't shoot", tags=["mimic", "voice"])
define("mimic_call_b", _mk_phrase_set(CALL[4:], drive=5.0, detune=0.035, static=0.1), variants=4, cat="voice",
       desc="squad talk: pull back / I am hit / reloading / that's it, the end", tags=["mimic", "voice"])


@sound("mimic_scream", 3, "voice", peak=-3.0, desc="a human scream through a dead handset: doubled, crushed, a reversed tail", tags=["mimic", "voice"])
def mimic_scream(v, i):
    x = vox.scream(v.rng, v.rnd(0.7, 1.1), v.rnd(230, 330), v.pick(["a", "e"]), rasp=v.rnd(0.5, 0.9))
    x = vox.mimic_process(x, v.rng, detune=0.05, reverse_tail=True, ringmod=v.rnd(0.0, 0.3))
    x = vox.radio(x, v.rng, drive=v.rnd(6, 10), bits=6.0, static=0.12, dropouts=1)
    v.add(x, 0.0)
    burst(v, at=0.02, type="crackle", filt="lowpass", f0=4000, q=0.7, dur=0.6, g=0.2, atk=0.05)
    return reverb.place(v.render(), "village", v.rng, wet_db=-9.0)


@sound("mimic_pain", 4, "voice", peak=-5.0, desc="hit: a short crushed cry", tags=["mimic", "voice"])
def mimic_pain(v, i):
    x = vox.scream(v.rng, v.rnd(0.2, 0.35), v.rnd(160, 260), v.pick(["a", "u", "o"]), rasp=v.rnd(0.5, 0.9), contour="fall")
    x = vox.mimic_process(x, v.rng, detune=0.04, reverse_tail=v.chance(0.5))
    v.add(vox.radio(x, v.rng, drive=v.rnd(5, 8), bits=6.5, static=0.1, dropouts=0, squelch=False), 0.0)
    burst(v, at=0.0, type="white", filt="highpass", f0=3000, q=0.5, dur=0.15, g=0.15, atk=0.003)


@sound("mimic_death", 3, "voice", peak=-4.0, desc="it folds: a falling groan, static collapsing to nothing, ash settling", tags=["mimic", "voice"])
def mimic_death(v, i):
    x = vox.scream(v.rng, v.rnd(0.9, 1.3), v.rnd(120, 170), "o", rasp=0.9, contour="fall")
    x = vox.mimic_process(x, v.rng, detune=0.06, reverse_tail=True, ringmod=0.3)
    x = vox.radio(x, v.rng, drive=8.0, bits=5.5, static=0.15, dropouts=2)
    n = len(x)
    x *= dsp.env(n, 0.02, 0.4, curve="lin", hold_level=1.0)  # the handset dying
    v.add(x, 0.0)
    fm(v, type="sine", f0=600, f1=90, ratio=1.4, index=3, index1=0.8, dur=1.2, g=0.3, atk=0.02, hold=0.2, lp=2000)
    fm(v, at=0.08, type="triangle", f0=420, f1=70, ratio=2.7, index=2, index1=0.5, dur=1.0, g=0.15, atk=0.05, lp=1500)
    burst(v, type="white", filt="bandpass", f0=3000, f1=300, q=1, dur=1.3, g=0.25, atk=0.05)
    burst(v, type="crackle", filt="lowpass", f0=4000, q=0.7, dur=1.2, g=0.4, atk=0.01)
    thump(v, at=1.1, f0=70, f1=40, dur=0.2, g=0.35)
    burst(v, at=1.1, type="pink", filt="highpass", f0=2500, q=0.5, dur=0.4, g=0.06, atk=0.04)
    burst(v, at=1.15, type="crackle_fine", filt="lowpass", f0=3000, q=0.7, dur=0.5, g=0.1, atk=0.05)  # ash
    return reverb.place(v.render(), "village", v.rng, wet_db=-10.0)


@sound("mimic_spot", 3, "voice", peak=-5.0, desc="it has seen you: a low tone drops, static swells, one word", tags=["mimic", "voice"])
def mimic_spot(v, i):
    tone(v, f0=220, f1=110, dur=0.6, g=0.5, atk=0.02, hold=0.15)
    tone(v, f0=221.5, f1=110.5, dur=0.6, g=0.25, atk=0.02, hold=0.15, lp=600)
    burst(v, type="white", filt="highpass", f0=2500, q=0.5, dur=0.7, g=0.15, atk=0.35)
    burst(v, at=0.3, type="crackle", filt="lowpass", f0=4000, q=0.7, dur=0.4, g=0.2, atk=0.1)
    x = _phrase(v, v.pick(["vizhu_tsel", "kontakt", "on_ryadom"]), pitch=v.rnd(120, 150), speed=1.25, drive=6.0, static=0.05, reverse=False, contour="rise")
    v.add(x * 0.8, 0.35)


@sound("mimic_hit", 4, "impact", peak=-6.0, desc="a round lands in it: dry papery impact and a spit of static", tags=["mimic"])
def mimic_hit(v, i):
    burst(v, type="white", filt="bandpass", f0=1200, f1=500, q=1, dur=0.05, g=0.6, atk=0.001)
    thump(v, f0=120, f1=70, dur=0.06, g=0.5)
    burst(v, at=0.01, type="white", filt="highpass", f0=2500, q=0.5, dur=0.12, g=0.2, atk=0.003)
    burst(v, at=0.02, type="crackle", filt="lowpass", f0=5000, q=0.7, dur=0.1, g=0.25, atk=0.002)
    burst(v, at=0.01, type="pink", filt="highpass", f0=2500, q=0.5, dur=0.25, g=0.08, atk=0.03)


@sound("mimic_skip", 3, "creature", peak=-6.0, desc="the skip: a whoosh with a fast flutter and a reversed shred of voice, gone before you place it", tags=["mimic"])
def mimic_skip(v, i):
    sv = v.sub()
    burst(sv, type="pink", filt="bandpass", f0=700, f1=2200, q=1, dur=0.4, g=0.5, atk=0.12)
    burst(sv, at=0.05, type="white", filt="highpass", f0=3000, q=0.5, dur=0.3, g=0.08, atk=0.1)
    v.add(synth.tremolo(sv.render(), v.rnd(18, 26), 0.45, v.rng, 0.1), 0.0)
    phones, stress, _ = vox.PHRASES[v.pick(["tikho", "domoy", "priyom"])]
    x = vox.vocal(v.rng, phones, stress, v.rnd(100, 130), 1.4)
    x = vox.radio(x[::-1], v.rng, drive=6.0, static=0.05, squelch=False)
    v.add(x * 0.5, 0.05)
    thump(v, at=0.2, f0=80, f1=40, dur=0.15, g=0.3)


@sound("mimic_step", 4, "step", peak=-10.0, desc="heavier than a human step on grass and dirt", tags=["mimic", "step"])
def mimic_step(v, i):
    foley.step(v, v.pick(["dirt", "grass", "dirt"]), "walk")
    thump(v, f0=75, f1=40, dur=0.1, g=0.6)
    burst(v, at=0.01, type="crackle", filt="lowpass", f0=3000, q=0.7, dur=0.06, g=0.06, atk=0.005)  # a whisper of static with every step
    if v.chance(0.4):
        pulses(v, n=2, at=0.02, span=0.05, type="white", f0=1500, f1=2500, q=3, dur=0.008, g=0.1)


@sound("mimic_static", 1, "loop", peak=-16.0, loop=True, desc="8 s: the radio hiss it carries, slow crackle, the odd squelch", tags=["mimic", "loop"])
def mimic_static(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = dsp.highpass(dsp.white(v.rng, n), 2800.0) * 0.12
    x += dsp.lowpass(dsp.crackle(v.rng, n, 250.0, 0.6), 3500.0) * 0.25 * (0.9 + 0.12 * np.sin(2 * np.pi * 0.25 * tt))
    x += dsp.lowpass(dsp.brown(v.rng, n), 150.0) * 0.04
    x += dsp.osc(n, v.rnd(48, 55), "sine") * 0.02
    v.add(x, 0.0)
    for k in range(v.irnd(1, 3)):
        t = v.rnd(0.3, LOOP - 0.4)
        burst(v, at=t, type="white", filt="bandpass", f0=v.rnd(1500, 3000), q=1.5, dur=v.rnd(0.02, 0.06), g=0.3, atk=0.002)
        tone(v, at=t + 0.01, f0=2000, f1=700, dur=0.05, g=0.06, atk=0.003)
    v.buf = v.buf[:n]


@sound("mimic_reload", 2, "mech", peak=-12.0, desc="a mimic reloading behind cover: mag out, mag in, the bolt, a word", tags=["mimic", "mech"])
def mimic_reload(v, i):
    sv = v.sub(); weap._mag_out(sv, 1.3, True); v.add(sv.render(), 0.0)
    sv = v.sub(); weap._mag_in(sv, 1.3, True, True); v.add(sv.render(), 0.7)
    sv = v.sub(); weap._rack(sv, 2300, 1950, 0.13, 1.1, 1500); v.add(sv.render(), 1.35)
    x = _phrase(v, "perezaryazhayu", pitch=v.rnd(105, 130), speed=1.2, drive=5.0, static=0.06)
    v.add(x * 0.5, 0.1)
    return reverb.place(v.render(), "village", v.rng, wet_db=-10.0)


@sound("mimic_grenade", 2, "voice", peak=-6.0, desc="the tell: a squelch, 'granata', the pin", tags=["mimic", "voice", "grenade"])
def mimic_grenade(v, i):
    burst(v, type="white", filt="bandpass", f0=2500, q=1, dur=0.05, g=0.4, atk=0.001)
    x = _phrase(v, "granata", pitch=v.rnd(125, 150), speed=1.3, drive=7.0, contour="rise", static=0.1)
    v.add(x, 0.05)
    sv = v.sub(); weap.grenade_pin(sv, 0); v.add(sv.render() * 0.8, 0.6)


# ------------------------------------------------------------------------------------------------------ slider
@sound("slider_click", 4, "creature", peak=-8.0, desc="dry clicks like a tongue against teeth, two to four", tags=["slider"])
def slider_click(v, i):
    def one(at, k):
        burst(v, at=at, type="white", filt="bandpass", f0=1400, q=4, dur=0.012, g=0.55, atk=0.0005)
        modal(v, at=at, freqs=[v.rnd(650, 800), v.rnd(1050, 1250), v.rnd(2200, 2600)], t60s=[0.05, 0.04, 0.02], amps=[1, 0.6, 0.3], exc=0.0012, g=0.3)  # bony
        tone(v, at=at, f0=900, f1=500, dur=0.015, g=0.22, atk=0.0005)
    seq(v, v.irnd(2, 4), 0.0, v.rnd(0.18, 0.32), one)


@sound("slider_screech", 3, "creature", peak=-3.0, desc="the charge: a rising screech, part throat, part glass", tags=["slider"])
def slider_screech(v, i):
    fm(v, type="sawtooth", f0=400, f1=1800, ratio=2.01, index=2, index1=1.2, dur=0.6, g=0.45, atk=0.04, shape=20, bp=1600, bq=0.8)
    burst(v, type="white", filt="bandpass", f0=2000, f1=4000, q=1, dur=0.6, g=0.22, atk=0.1)
    x = vox.scream(v.rng, 0.6, v.rnd(380, 520), "i", rasp=0.9)
    v.add(dsp.highpass(x, 800.0) * 0.5, 0.05)
    fm(v, at=0.58, type="sawtooth", f0=1800, f1=900, ratio=2.01, index=1.2, dur=0.12, g=0.3, atk=0.005, shape=20, bp=1600, bq=0.8)
    tinkle(v, n=v.irnd(6, 10), at=0.1, span=0.5, f0=3000, f1=7000, dur=0.06, g=0.05)  # the shards it wears


@sound("slider_lunge", 3, "creature", peak=-5.0, desc="a lunge: air, claws, a snap", tags=["slider"])
def slider_lunge(v, i):
    whoosh(v, f0=500, f1=2800, q=1, dur=0.25, g=0.7, peak=0.6)
    burst(v, at=0.05, type="white", filt="highpass", f0=2000, q=0.6, dur=0.15, g=0.2, atk=0.02)
    click(v, at=0.22, f=2000, g=0.5, dur=0.005)
    modal(v, at=0.22, freqs=[700, 1150, 2400], t60s=[0.05, 0.04, 0.02], amps=[1, 0.6, 0.3], exc=0.0012, g=0.3)


@sound("slider_hit", 3, "creature", peak=-6.0, desc="a round in a slider: wet, a yelp", tags=["slider"])
def slider_hit(v, i):
    thump(v, f0=100, f1=60, dur=0.08, g=0.6)
    burst(v, type="pink", filt="bandpass", f0=500, f1=250, q=1.2, dur=0.1, g=0.5, atk=0.001, pr=1.1, pr1=0.6)
    fm(v, at=0.01, type="sawtooth", f0=900, f1=600, ratio=2, index=1.5, dur=0.12, g=0.2, atk=0.005, shape=15, lp=2500)
    x = vox.scream(v.rng, 0.15, v.rnd(300, 420), "e", rasp=0.8, contour="fall")
    v.add(x * 0.35, 0.02)


@sound("slider_death", 2, "creature", peak=-4.0, desc="it comes apart: a fall, a long broken screech, shards", tags=["slider"])
def slider_death(v, i):
    burst(v, type="brown", filt="lowpass", f0=600, q=0.8, dur=0.15, g=0.8, atk=0.001)
    burst(v, type="crackle", filt="lowpass", f0=3000, q=0.7, dur=0.3, g=0.6, atk=0.001)
    burst(v, type="white", filt="bandpass", f0=1200, f1=400, q=1, dur=0.12, g=0.5, atk=0.001)
    fm(v, at=0.03, type="sawtooth", f0=1600, f1=300, ratio=2.01, index=2, index1=0.6, dur=0.9, g=0.4, atk=0.01, shape=18, bp=1400, bq=0.7)
    x = vox.scream(v.rng, 0.8, v.rnd(300, 400), "a", rasp=1.0, contour="fall")
    v.add(dsp.highpass(x, 600.0) * 0.4, 0.05)
    pulses(v, n=3, at=0.7, span=0.3, type="white", f0=1200, f1=1600, q=4, dur=0.012, g=0.3, decay=0.7)
    tinkle(v, n=v.irnd(10, 16), at=0.5, span=0.8, f0=2500, f1=7000, dur=0.08, g=0.06)


@sound("slider_step", 4, "step", peak=-12.0, desc="two quick scrabbling steps of something on all fours", tags=["slider", "step"])
def slider_step(v, i):
    def one(at, k):
        burst(v, at=at, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.03, g=0.4, atk=0.002)
        burst(v, at=at, type="pink", filt="highpass", f0=900, q=0.6, dur=0.03, g=0.25, atk=0.003)
        burst(v, at=at, type="crackle_fine", filt="bandpass", f0=3000, q=0.9, dur=0.04, g=0.12, atk=0.002)
        if v.chance(0.4):
            modal(v, at=at, freqs=[v.rnd(3000, 4500)], t60s=[0.03], amps=[1], exc=0.0008, g=0.05)  # a claw on stone
    seq(v, v.irnd(2, 3), 0.0, 0.12, one)


@sound("slider_hiss", 3, "creature", peak=-8.0, desc="a breathy hiss with a rattle in it", tags=["slider"])
def slider_hiss(v, i):
    burst(v, type="white", filt="bandpass", f0=2500, f1=1500, q=0.8, dur=v.rnd(0.5, 0.8), g=0.45, atk=0.05)
    burst(v, type="pink", filt="bandpass", f0=800, q=1.0, dur=0.6, g=0.15, atk=0.05)
    pulses(v, n=v.irnd(10, 18), at=0.05, span=0.5, type="white", f0=1200, f1=1800, q=4, dur=0.008, g=0.15)


@sound("slider_rattle", 3, "creature", peak=-10.0, desc="the glass shards it carries rattling against each other", tags=["slider"])
def slider_rattle(v, i):
    for k in range(v.irnd(8, 14)):
        glass_body(v, at=v.rnd(0.0, 0.45), f=v.rnd(2800, 6500), g=v.rnd(0.06, 0.15), t60=v.rnd(0.08, 0.2))
    pulses(v, n=v.irnd(8, 12), span=0.45, type="white", f0=4000, f1=7000, q=4, dur=0.004, g=0.12)


# ------------------------------------------------------------------------------------------------------ fragment
@sound("fragment_chime", 1, "loop", peak=-10.0, loop=True, desc="6 s: the chime — 880 Hz with a beating twin and shimmer partials, pulsing at 0.6 Hz", tags=["fragment", "loop"])
def fragment_chime(v, i):
    n = dsp.sec(6.0)
    tt = np.arange(n) / dsp.SR
    x = dsp.osc(n, 880.0, "sine") * 0.4 + dsp.osc(n, 883.0, "sine") * 0.4 + dsp.osc(n, 1760.0, "sine") * 0.25
    hi = dsp.osc(n, 1762.0 + 3.0 * np.sin(2 * np.pi * 5.2 * tt), "sine") * 0.12 + dsp.osc(n, 2640.0 + 6.0 * np.sin(2 * np.pi * 0.31 * tt), "sine") * 0.07
    x = (x + hi) * (0.55 + 0.45 * np.sin(2 * np.pi * 0.6 * tt)) ** 2
    x += dsp.highpass(dsp.white(v.rng, n), 7000.0) * 0.012 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.6 * tt + 1.0))
    v.add(x, 0.0)
    for k in range(v.irnd(3, 5)):
        glass_body(v, at=v.rnd(0.0, 5.5), f=v.rnd(3500, 5300), g=0.04, t60=0.5)
    v.buf = v.buf[:n]


@sound("fragment_chime_fast", 1, "loop", peak=-9.0, loop=True, desc="4 s: the chime pulsing fast (3 Hz) and 6 % sharp, as it closes in", tags=["fragment", "loop"])
def fragment_chime_fast(v, i):
    n = dsp.sec(4.0)
    tt = np.arange(n) / dsp.SR
    m = 1.06
    x = dsp.osc(n, 880.0 * m, "sine") * 0.4 + dsp.osc(n, 883.0 * m, "sine") * 0.4 + dsp.osc(n, 1760.0 * m, "sine") * 0.3
    x += dsp.osc(n, 1762.0 * m + 3.0 * np.sin(2 * np.pi * 5.2 * tt), "sine") * 0.25 + dsp.osc(n, 2640.0 * m, "sine") * 0.15
    x *= (0.55 + 0.45 * np.sin(2 * np.pi * 3.0 * tt)) ** 2
    x += dsp.highpass(dsp.white(v.rng, n), 6000.0) * 0.02
    v.add(x, 0.0)
    v.buf = v.buf[:n]


@sound("fragment_approach", 2, "creature", peak=-8.0, desc="it has noticed you: the chime climbs an octave over a second and a half", tags=["fragment"])
def fragment_approach(v, i):
    tone(v, f0=880, f1=1760, dur=1.5, g=0.16, atk=0.5, hold=0.4, fcurve="exp")
    tone(v, f0=1320, f1=2640, dur=1.5, g=0.08, atk=0.6, hold=0.3, vib=dict(f=6, depth=8))
    tone(v, f0=883, f1=1770, dur=1.4, g=0.1, atk=0.4, hold=0.4)
    burst(v, type="white", filt="highpass", f0=4000, q=0.5, dur=1.5, g=0.06, atk=0.7)
    tinkle(v, n=v.irnd(4, 7), at=0.3, span=1.0, f0=3000, f1=7000, dur=0.1, g=0.04)


@sound("fragment_pop", 3, "creature", peak=-5.0, desc="one shot pops it: a bright glass burst", tags=["fragment"])
def fragment_pop(v, i):
    burst(v, type="white", filt="highpass", f0=2500, q=0.7, dur=0.03, g=0.7, atk=0.0005)
    tone(v, f0=3000, f1=6000, dur=0.04, g=0.2, atk=0.001)
    glass_body(v, f=v.rnd(3200, 4400), g=0.3, t60=0.3)
    tinkle(v, n=v.irnd(4, 6), at=0.01, span=0.2, f0=3000, f1=7000, dur=0.1, g=0.06)


@sound("fragment_explode", 3, "explosion", peak=-1.0, desc="it touches you: a shock — sub, crack, ringing glass partials", tags=["fragment"])
def fragment_explode(v, i):
    thump(v, f0=55, f1=22, dur=0.5, g=1.2, sat=2.0)
    burst(v, type="brown", filt="lowpass", f0=300, q=0.7, dur=0.3, g=0.8, atk=0.002)
    burst(v, type="white", filt="bandpass", f0=2000, f1=300, q=0.7, dur=0.25, g=0.9, atk=0.001, sat=3.0)
    modal(v, at=0.01, freqs=[1400, 2130, 3520, 5100], t60s=[0.8, 0.7, 0.5, 0.35], amps=[1, 0.7, 0.5, 0.3], exc=0.0015, g=0.35)
    burst(v, at=0.01, type="pink", filt="highpass", f0=3000, q=0.5, dur=0.8, g=0.12, atk=0.02)
    tinkle(v, n=v.irnd(10, 16), at=0.02, span=0.6, f0=3000, f1=8000, dur=0.12, g=0.06)
    tone(v, at=0.05, f0=3200, dur=1.5, g=0.08, atk=0.02, hold=0.6, curve="lin")  # the ears
    return reverb.place(dsp.saturate(v.render(), 1.6), "field", v.rng, wet_db=-8.0)


@sound("fragment_shatter", 3, "creature", peak=-4.0, desc="a cluster breaking apart into shards", tags=["fragment"])
def fragment_shatter(v, i):
    burst(v, type="white", filt="highpass", f0=3000, q=0.7, dur=0.04, g=0.6, atk=0.0005)
    for k in range(v.irnd(6, 9)):
        glass_body(v, at=v.rnd(0.0, 0.6), f=v.rnd(2600, 6000), g=0.15, t60=0.3)
    tinkle(v, n=v.irnd(14, 20), at=0.01, span=0.9, f0=2500, f1=8000, dur=0.1, g=0.06)
    tone(v, f0=1760, f1=440, dur=0.8, g=0.1, atk=0.02, curve="lin")


@sound("fragment_skitter", 3, "creature", peak=-10.0, desc="a fragment darting: a glassy whoosh with ticks", tags=["fragment"])
def fragment_skitter(v, i):
    whoosh(v, f0=2000, f1=6000, q=2, dur=0.35, g=0.3, peak=0.5)
    tone(v, f0=1760, f1=2200, dur=0.35, g=0.08, atk=0.05, curve="cos")
    tinkle(v, n=v.irnd(4, 7), at=0.02, span=0.3, f0=4000, f1=8000, dur=0.05, g=0.05)


# ------------------------------------------------------------------------------------------------------ spawn
@sound("spawn_skitter", 4, "creature", peak=-10.0, desc="many small legs on a hard floor", tags=["spawn"])
def spawn_skitter(v, i):
    span = v.rnd(0.4, 0.9)
    pulses(v, n=v.irnd(10, 22), span=span, type="white", f0=3500, f1=5500, q=3, dur=0.006, g=0.3)
    for k in range(v.irnd(3, 6)):
        modal(v, at=v.rnd(0.0, span), freqs=[v.rnd(2800, 4200)], t60s=[0.02], amps=[1], exc=0.0006, g=0.08)
    burst(v, type="pink", filt="highpass", f0=3000, q=0.5, dur=span, g=0.05, atk=0.05, curve="lin")
    burst(v, at=0.05, type="crackle_fine", filt="bandpass", f0=2000, q=1, dur=span * 0.8, g=0.06, atk=0.05)  # chitin dragging


@sound("spawn_bite", 3, "creature", peak=-6.0, desc="a bite: snap and a wet tear", tags=["spawn"])
def spawn_bite(v, i):
    burst(v, type="white", filt="bandpass", f0=1800, q=2, dur=0.02, g=0.7, atk=0.0005)
    burst(v, at=0.005, type="pink", filt="bandpass", f0=700, f1=300, q=1.2, dur=0.08, g=0.4, atk=0.003, pr=1.2, pr1=0.6)
    thump(v, f0=160, f1=90, dur=0.04, g=0.4)
    click(v, f=4000, g=0.25)
    burst(v, at=0.02, type="crackle_fine", filt="lowpass", f0=3000, q=0.7, dur=0.06, g=0.15, atk=0.002)


@sound("spawn_death", 3, "creature", peak=-6.0, desc="it curls and crumbles: a wet burst, chitin cracking, legs twitching", tags=["spawn"])
def spawn_death(v, i):
    burst(v, type="brown", filt="lowpass", f0=800, q=0.7, dur=0.12, g=0.7, atk=0.001)
    burst(v, type="crackle", filt="lowpass", f0=4000, q=0.7, dur=0.25, g=0.5, atk=0.001)
    burst(v, type="white", filt="bandpass", f0=1500, f1=500, q=1, dur=0.08, g=0.5, atk=0.001)
    x = vox.scream(v.rng, 0.25, v.rnd(500, 750), "i", rasp=1.0, contour="fall")
    v.add(dsp.highpass(x, 1200.0) * 0.25, 0.01)
    pulses(v, n=v.irnd(6, 9), at=0.1, span=0.5, type="white", f0=3500, f1=5500, q=3, dur=0.006, g=0.3, decay=0.78)


@sound("spawn_hiss", 3, "creature", peak=-8.0, desc="the hiss before it spits", tags=["spawn"])
def spawn_hiss(v, i):
    burst(v, type="white", filt="bandpass", f0=3500, f1=2000, q=1.0, dur=v.rnd(0.3, 0.5), g=0.5, atk=0.03)
    x = vox.scream(v.rng, 0.3, v.rnd(600, 900), "i", rasp=1.0, contour="flat")
    v.add(dsp.highpass(x, 2000.0) * 0.15, 0.05)
    pulses(v, n=v.irnd(4, 8), at=0.05, span=0.3, type="white", f0=4000, f1=6000, q=4, dur=0.005, g=0.1)


@sound("spawn_spit", 2, "creature", peak=-7.0, desc="it spits: a wet pop and a spray", tags=["spawn"])
def spawn_spit(v, i):
    tone(v, f0=400, f1=150, dur=0.05, g=0.3, atk=0.002, lp=1000)
    burst(v, type="pink", filt="bandpass", f0=900, f1=400, q=1.2, dur=0.08, g=0.4, atk=0.002, pr=1.3, pr1=0.7)
    burst(v, at=0.03, type="white", filt="bandpass", f0=3000, f1=1500, q=1, dur=0.15, g=0.25, atk=0.01)
    tinkle(v, n=v.irnd(3, 5), at=0.1, span=0.2, f0=1500, f1=3000, dur=0.03, g=0.04)


@sound("spawn_nest", 1, "loop", peak=-14.0, loop=True, desc="8 s: a nest — bubbling, wet clicking, something moving under a membrane", tags=["spawn", "loop"])
def spawn_nest(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = dsp.lowpass(dsp.crackle(v.rng, n, 40.0, 0.7), 700.0) * 0.25 * (0.8 + 0.2 * np.sin(2 * np.pi * 0.17 * tt))
    x += dsp.biquad(dsp.pink(v.rng, n), "bandpass", 250.0 + 80.0 * np.sin(2 * np.pi * 0.09 * tt), 2.5) * 0.15
    v.add(x, 0.0)
    for k in range(v.irnd(14, 22)):  # bubbles
        f = v.rnd(200, 700)
        tone(v, at=v.rnd(0.0, LOOP - 0.2), f0=f, f1=f * 1.9, dur=v.rnd(0.03, 0.09), g=v.rnd(0.05, 0.12), atk=0.005, lp=2500)
    for k in range(v.irnd(3, 5)):
        pulses(v, n=v.irnd(4, 8), at=v.rnd(0.0, LOOP - 0.6), span=0.4, type="white", f0=3000, f1=5000, q=3, dur=0.006, g=0.06)
    v.buf = v.buf[:n]


@sound("spawn_nest_burst", 2, "creature", peak=-6.0, desc="a nest disturbed: the membrane tearing, a rush of small bodies", tags=["spawn"])
def spawn_nest_burst(v, i):
    burst(v, type="pink", filt="bandpass", f0=600, f1=250, q=1.2, dur=0.25, g=0.6, atk=0.01, pr=1.2, pr1=0.6)
    burst(v, type="crackle_fine", filt="lowpass", f0=3000, q=0.7, dur=0.3, g=0.3, atk=0.005)
    thump(v, f0=90, f1=45, dur=0.15, g=0.5)
    for k in range(3):
        sv = v.sub(); spawn_skitter(sv, 0); v.add(sv.render() * 0.7, 0.15 + k * 0.12)
    sv = v.sub(); spawn_hiss(sv, 0); v.add(sv.render() * 0.6, 0.2)


# ------------------------------------------------------------------------------------------------------ seeker
@sound("seeker_hum", 1, "loop", peak=-8.0, loop=True, desc="8 s: the seeker's engine — a 55 Hz saw pair under a moving lowpass, the searchlight's whine", tags=["seeker", "loop"])
def seeker_hum(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = dsp.osc(n, 55.0 * 2 ** (-4 / 1200), "sawtooth") * 0.5 + dsp.osc(n, 55.0 * 2 ** (4 / 1200), "sawtooth") * 0.5
    x = dsp.biquad(x, "lowpass", 270.0 + 150.0 * np.sin(2 * np.pi * 0.11 * tt), 1.2) * 0.4
    x += dsp.osc(n, 27.5, "sine") * 0.15
    x += dsp.osc(n, 1760.0 + 6.0 * np.sin(2 * np.pi * 5.0 * tt), "sine") * 0.015
    x += dsp.biquad(dsp.pink(v.rng, n), "bandpass", 900.0, 3.0) * 0.06 * (0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * tt))  # hydraulics breathing
    v.add(x, 0.0)
    for k in range(v.irnd(2, 4)):
        t = v.rnd(0.3, LOOP - 0.5)
        burst(v, at=t, type="white", filt="bandpass", f0=2500, f1=1200, q=0.8, dur=0.3, g=0.12, atk=0.04)  # a valve
        clack(v, at=t + 0.28, f=1800, g=0.1, dur=0.015, decay=0.06)
    v.buf = v.buf[:n]


@sound("seeker_whine", 1, "loop", peak=-12.0, loop=True, desc="6 s: the searchlight's dynamo whine, rising and falling as it sweeps", tags=["seeker", "loop"])
def seeker_whine(v, i):
    n = dsp.sec(6.0)
    tt = np.arange(n) / dsp.SR
    f = 1400.0 * 2 ** (0.4 * np.sin(2 * np.pi * (1.0 / 6.0) * tt))
    x = dsp.osc(n, f, "sawtooth")
    x = dsp.biquad(x, "bandpass", f * 2.0, 3.0) * 0.5 + dsp.osc(n, f, "sine") * 0.2
    x += dsp.highpass(dsp.white(v.rng, n), 5000.0) * 0.02
    v.add(x * 0.3, 0.0)
    v.buf = v.buf[:n]


@sound("seeker_step", 4, "step", peak=-4.0, desc="three tonnes on one foot: the ground, the suit's frame, hydraulics settling", tags=["seeker", "step"])
def seeker_step(v, i):
    thump(v, f0=55, f1=25, dur=0.35, g=1.2, sat=1.5)
    burst(v, type="brown", filt="lowpass", f0=200, q=0.7, dur=0.3, g=0.8, atk=0.002)
    burst(v, type="white", filt="bandpass", f0=1800, q=1, dur=0.03, g=0.4, atk=0.001)
    burst(v, at=0.002, type="crackle_coarse", filt="lowpass", f0=2500, q=0.7, dur=0.1, g=0.3, atk=0.002)  # ground breaking
    metal_body(v, f=v.rnd(380, 480), g=0.3, t60=0.4, n=9, thick=0.7)
    burst(v, at=0.15, type="white", filt="bandpass", f0=2200, f1=1400, q=0.8, dur=0.25, g=0.12, atk=0.05)  # hydraulic release
    tail(v, dur=0.5, g=0.15, f0=1200, f1=150)
    return reverb.place(v.render(), "field", v.rng, wet_db=-8.0)


@sound("seeker_hiss", 3, "creature", peak=-6.0, desc="hydraulics: a long pressurised hiss and a clank", tags=["seeker"])
def seeker_hiss(v, i):
    burst(v, type="white", filt="bandpass", f0=2500, f1=1200, q=0.8, dur=0.5, g=0.5, atk=0.04)
    burst(v, type="pink", filt="highpass", f0=800, q=0.6, dur=0.5, g=0.2, atk=0.03)
    tone(v, type="sawtooth", f0=60, f1=52, dur=0.5, g=0.15, atk=0.05, lp=200)
    clack(v, at=0.46, f=2000, g=0.4, dur=0.02, decay=0.08)
    metal_body(v, at=0.46, f=700, g=0.2, t60=0.3, n=8, thick=0.6)


@sound("seeker_servo", 3, "creature", peak=-10.0, desc="the turret traversing: a servo whine and a stop", tags=["seeker"])
def seeker_servo(v, i):
    tone(v, type="sawtooth", f0=v.rnd(700, 900), f1=v.rnd(750, 950), dur=v.rnd(0.3, 0.6), g=0.15, atk=0.05, lp=3000, curve="lin", jitter=0.01)
    burst(v, type="pink", filt="bandpass", f0=1200, q=1.5, dur=0.4, g=0.06, atk=0.05)
    clack(v, at=0.45, f=1600, g=0.3, dur=0.015, decay=0.08)


@sound("seeker_spot", 1, "creature", peak=-4.0, desc="the searchlight finding you: the hum rises, a high tone climbs, the light's hiss", tags=["seeker"])
def seeker_spot(v, i):
    tone(v, type="sawtooth", f0=55, f1=58, dur=1.2, g=0.35, atk=0.3, hold=0.3, lp=700, lq=1.5)
    tone(v, f0=1800, f1=3200, dur=1.0, g=0.12, atk=0.3, hold=0.2)
    burst(v, type="white", filt="highpass", f0=4000, q=0.5, dur=1.0, g=0.05, atk=0.3)
    click(v, at=0.02, f=2000, g=0.3, dur=0.01)
    burst(v, at=0.02, type="white", filt="bandpass", f0=6000, q=0.7, dur=0.9, g=0.08, atk=0.02)  # the arc lamp


@sound("seeker_death", 1, "explosion", peak=-2.0, desc="it comes down: hydraulics failing in stages, the frame collapsing, a last boom", tags=["seeker"])
def seeker_death(v, i):
    burst(v, type="white", filt="bandpass", f0=3000, f1=800, q=0.8, dur=1.5, g=0.3, atk=0.1)
    tone(v, type="sawtooth", f0=55, f1=20, dur=2.0, g=0.2, atk=0.05, lp=300, curve="lin")

    def fail(at, k):
        f = v.rnd(1200, 2500); g = v.rnd(0.4, 0.8) * (0.7 + 0.3 * k / 8)
        burst(v, at=at, type="white", filt="bandpass", f0=f, q=1.2, dur=0.03, g=g, atk=0.001)
        metal_body(v, at=at, f=v.rnd(400, 900), g=0.25, t60=0.3, n=8, thick=0.6)
        thump(v, at=at, f0=v.rnd(80, 130), f1=40, dur=0.12, g=0.5)
    seq(v, v.irnd(6, 9), 0.0, 1.8, fail)
    thump(v, at=1.8, f0=55, f1=20, dur=0.5, g=1.2, sat=1.5)
    burst(v, at=1.8, type="brown", filt="lowpass", f0=250, q=0.7, dur=0.4, g=0.8, atk=0.002)
    metal_body(v, at=1.8, f=300, g=0.4, t60=1.2, n=10, thick=0.7)
    burst(v, at=2.0, type="white", filt="bandpass", f0=2000, f1=900, q=0.8, dur=1.2, g=0.15, atk=0.1)  # the last of the pressure
    return reverb.place(dsp.saturate(v.render(), 1.5), "field_big", v.rng, wet_db=-7.0)


# ------------------------------------------------------------------------------------------------------ phantom
@sound("phantom_whisper", 4, "voice", peak=-10.0, desc="whispered fragments, close to the ear, layered and reversed", tags=["phantom", "voice"])
def phantom_whisper(v, i):
    keys = ["idi_syuda", "slyshish", "eto_ne_ya", "kholodno", "domoy", "tikho"]
    phones, stress, _ = vox.PHRASES[keys[i % len(keys)]]
    x = vox.speak(v.rng, phones, stress, 110.0, v.rnd(0.7, 0.9), breathy=0.5, whisper=True)
    x = dsp.bandpass(x, 2200.0, 0.6) * 1.2 + dsp.highpass(x, 4000.0) * 0.5
    v.add(x, 0.0)
    v.add(x[::-1] * 0.5, len(x) / dsp.SR * 0.4)
    phones2, stress2, _ = vox.PHRASES[keys[(i + 2) % len(keys)]]
    y = vox.speak(v.rng, phones2, stress2, 110.0, v.rnd(0.5, 0.7), breathy=0.6, whisper=True)
    v.add(dsp.resample_rate(y, 0.8) * 0.35, 0.3)  # a slower one underneath
    burst(v, type="pink", filt="bandpass", f0=300, q=1.0, dur=1.5, g=0.1, atk=0.5)
    return reverb.place(v.render(), "hall", v.rng, wet_db=-4.0)


@sound("phantom_scream", 3, "voice", peak=-3.0, desc="not a human throat: a scream pitched down and doubled up, tearing", tags=["phantom", "voice"])
def phantom_scream(v, i):
    x = vox.scream(v.rng, v.rnd(1.0, 1.4), v.rnd(260, 360), "e", rasp=0.8)
    v.add(dsp.resample_rate(x, 0.55) * 0.7, 0.0)
    v.add(dsp.resample_rate(x, 1.9) * 0.3, 0.05)
    v.add(x[::-1] * 0.35, 0.5)
    burst(v, type="white", filt="bandpass", f0=3000, f1=800, q=0.8, dur=1.2, g=0.3, atk=0.2)
    thump(v, at=0.1, f0=60, f1=30, dur=0.6, g=0.6)
    return reverb.place(dsp.saturate(v.render(), 1.8), "hall", v.rng, wet_db=-3.0)


@sound("phantom_grab", 2, "creature", peak=-4.0, desc="it takes hold: a rush of air, a squeeze, cloth dragged", tags=["phantom"])
def phantom_grab(v, i):
    whoosh(v, f0=200, f1=3000, q=0.8, dur=0.4, g=0.7, peak=0.7)
    thump(v, at=0.3, f0=90, f1=40, dur=0.3, g=0.9)
    burst(v, at=0.3, type="brown", filt="lowpass", f0=500, q=0.8, dur=0.25, g=0.5, atk=0.002)
    cloth(v, at=0.35, n=6, span=0.6, g=0.25, dur=0.12)
    x = vox.scream(v.rng, 0.5, v.rnd(150, 220), "u", rasp=0.6, contour="fall")
    v.add(x * 0.35, 0.4)
    tone(v, at=0.3, f0=2000, f1=600, dur=0.8, g=0.1, atk=0.05, vib=dict(f=9, depth=80))


@sound("phantom_circle", 1, "loop", peak=-14.0, loop=True, desc="8 s: a presence circling — filtered air that passes and returns, a low pulse", tags=["phantom", "loop"])
def phantom_circle(v, i):
    n = dsp.sec(LOOP)
    tt = np.arange(n) / dsp.SR
    x = dsp.biquad(dsp.pink(v.rng, n), "bandpass", 600.0 * 2 ** (1.2 * np.sin(2 * np.pi * (1.0 / 4.0) * tt)), 1.2)
    x *= (0.3 + 0.7 * (0.5 + 0.5 * np.sin(2 * np.pi * (1.0 / 4.0) * tt - 1.2)) ** 3) * 0.4
    x += dsp.osc(n, 36.0, "sine") * 0.2 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * tt)) ** 6
    v.add(x, 0.0)
    for k in range(v.irnd(2, 3)):
        phones, stress, _ = vox.PHRASES[v.pick(["tikho", "domoy"])]
        w = vox.speak(v.rng, phones, stress, 110.0, 0.7, breathy=0.6, whisper=True)
        v.add(dsp.highpass(w, 2500.0) * 0.15, v.rnd(0.5, LOOP - 1.5))
    v.buf = v.buf[:n]


@sound("phantom_appear", 2, "creature", peak=-8.0, desc="the air folding open", tags=["phantom"])
def phantom_appear(v, i):
    sv = v.sub(); whoosh(sv, f0=3000, f1=300, q=1.0, dur=0.7, g=0.5, peak=0.3)
    v.add(sv.render()[::-1], 0.0)
    tone(v, f0=1200, f1=300, dur=0.7, g=0.1, atk=0.2, curve="cos", vib=dict(f=6, depth=40))
    thump(v, at=0.6, f0=50, f1=30, dur=0.4, g=0.4)


@sound("phantom_death", 2, "creature", peak=-4.0, desc="it unravels: the scream reversed into a whistle, then nothing", tags=["phantom"])
def phantom_death(v, i):
    x = vox.scream(v.rng, 0.9, v.rnd(200, 300), "a", rasp=0.7, contour="fall")
    v.add(dsp.resample_rate(x, 0.6)[::-1] * 0.6, 0.0)
    tone(v, at=0.8, f0=600, f1=6000, dur=0.9, g=0.1, atk=0.05, curve="lin")
    burst(v, type="pink", filt="bandpass", f0=800, f1=4000, q=0.8, dur=1.5, g=0.3, atk=0.6)
    thump(v, at=1.4, f0=45, f1=25, dur=0.5, g=0.6)
    return reverb.place(v.render(), "hall", v.rng, wet_db=-5.0)
