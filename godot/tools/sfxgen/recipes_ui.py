"""Interface: paper, ink, stamp, the terminal, the radio, the watch. Stereo where the sound is not in the world."""
import numpy as np
from . import dsp, synth, reverb, voice as vox
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, glass_body, whoosh, rattle
from .registry import sound, define, alias


def _paper(v: Voice, at: float, dur: float, g: float, f: float = 2800.0):
    burst(v, at=at, type="pink", filt="bandpass", f0=f, q=0.6, dur=dur, g=g, atk=0.03, pr=1.1, pr1=0.85)
    burst(v, at=at + dur * 0.3, type="crackle_fine", filt="highpass", f0=3000, q=0.7, dur=dur * 0.5, g=g * 0.35, atk=0.01)


def _soft_thump(v: Voice, at: float, g: float):
    thump(v, at=at, f0=120, f1=80, dur=0.07, g=g * 0.35)
    burst(v, at=at, type="brown", filt="lowpass", f0=400, q=0.7, dur=0.06, g=g * 0.3, atk=0.002)


@sound("ui_click", 3, "ui", desc="a small mechanical click (a switch on the panel)", tags=["ui"])
def ui_click(v, i):
    burst(v, type="white", filt="bandpass", f0=2200, q=2, dur=0.01, g=0.4, atk=0.0005)
    modal(v, freqs=[1800, 2900, 4200], t60s=[0.025, 0.02, 0.015], amps=[1, 0.5, 0.3], exc=0.001, g=0.15)
    tone(v, f0=800, f1=500, dur=0.02, g=0.15, atk=0.0005)


@sound("ui_hover", 2, "ui", peak=-20.0, desc="a paper edge brushed", tags=["ui"])
def ui_hover(v, i):
    _paper(v, 0.0, 0.05, 0.2)


@sound("ui_slip", 3, "ui", desc="a sheet slid across the table", tags=["ui"])
def ui_slip(v, i):
    _paper(v, 0.0, 0.14, 0.35)


@sound("ui_open", 2, "ui", desc="a folder opened: paper, then set down", tags=["ui"])
def ui_open(v, i):
    _paper(v, 0.0, 0.2, 0.3)
    _soft_thump(v, 0.15, 1.0)


@sound("ui_close", 2, "ui", desc="a folder closed", tags=["ui"])
def ui_close(v, i):
    _paper(v, 0.0, 0.14, 0.28)
    _soft_thump(v, 0.08, 1.2)


@sound("ui_tab", 3, "ui", peak=-16.0, desc="a tab flipped", tags=["ui"])
def ui_tab(v, i):
    _paper(v, 0.0, 0.08, 0.3, 3200.0)
    click(v, at=0.06, f=2600, g=0.12, dur=0.004)


@sound("ui_buy", 2, "ui", desc="coins on the counter: two small bright rings", tags=["ui"])
def ui_buy(v, i):
    modal(v, freqs=[3200, 4800, 6100], t60s=[0.12, 0.09, 0.06], amps=[1, 0.6, 0.35], exc=0.0008, g=0.3)
    click(v, f=4000, g=0.4)
    modal(v, at=0.07, freqs=[3400, 5100, 7400], t60s=[0.1, 0.08, 0.05], amps=[1, 0.6, 0.3], exc=0.0008, g=0.22)
    click(v, at=0.07, f=4200, g=0.25)


@sound("ui_deny", 2, "ui", desc="no: two dull knocks", tags=["ui"])
def ui_deny(v, i):
    def one(at, k):
        burst(v, at=at, type="brown", filt="lowpass", f0=600, q=0.7, dur=0.03, g=0.5, atk=0.001)
        wood_body(v, at=at, f=v.rnd(200, 240), g=0.35, t60=0.05)
    seq(v, 2, 0.0, 0.22, one)


@sound("ui_stamp", 2, "ui", peak=-8.0, desc="the Committee's stamp coming down on the paper", tags=["ui"])
def ui_stamp(v, i):
    thump(v, f0=140, f1=70, dur=0.1, g=0.8)
    burst(v, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.08, g=0.6, atk=0.001)
    burst(v, type="white", filt="lowpass", f0=2500, q=0.7, dur=0.02, g=0.3, atk=0.0005)
    wood_body(v, f=160, g=0.3, t60=0.1)
    modal(v, freqs=[600], t60s=[0.05], amps=[1], exc=0.002, g=0.1)
    _paper(v, 0.12, 0.08, 0.1)


@sound("paper_flip", 4, "ui", desc="a page turned", tags=["ui", "paper"])
def paper_flip(v, i):
    _paper(v, 0.0, v.rnd(0.12, 0.2), 0.35, v.rnd(2400, 3200))
    _paper(v, 0.15, 0.08, 0.15, 2000.0)
    if v.chance(0.5):
        click(v, at=0.22, f=1500, g=0.06, dur=0.006)


@sound("paper_write", 3, "ui", desc="a pen on paper: a few strokes", tags=["ui", "paper"])
def paper_write(v, i):
    for k in range(v.irnd(4, 7)):
        t = k * v.rnd(0.09, 0.16)
        burst(v, at=t, type="white", filt="bandpass", f0=v.rnd(3500, 5500), f1=v.rnd(3000, 5000), q=2.5, dur=v.rnd(0.04, 0.12), g=0.25, atk=0.01)
    burst(v, type="pink", filt="bandpass", f0=1800, q=1, dur=0.7, g=0.04, atk=0.1)


@sound("pen_click", 2, "ui", peak=-16.0, desc="a ballpoint clicked", tags=["ui", "paper"])
def pen_click(v, i):
    click(v, f=3200, g=0.35, dur=0.004)
    modal(v, freqs=[2800, 4300, 6000], t60s=[0.03, 0.02, 0.015], amps=[1, 0.5, 0.3], exc=0.0008, g=0.2)


@sound("terminal_key", 4, "ui", desc="one key of the terminal: a heavy Soviet keyboard", tags=["ui", "terminal"])
def terminal_key(v, i):
    click(v, f=v.rnd(2200, 2800), g=0.4, dur=0.005)
    modal(v, freqs=[v.rnd(1400, 1800), v.rnd(2600, 3200), v.rnd(4000, 5000)], t60s=[0.04, 0.03, 0.02], amps=[1, 0.5, 0.3], exc=0.0015, g=0.25)
    thump(v, f0=200, f1=140, dur=0.02, g=0.2)
    if v.chance(0.6):
        click(v, at=v.rnd(0.06, 0.1), f=2000, g=0.15, dur=0.004)  # key up


@sound("terminal_enter", 2, "ui", desc="the return key and the line feed", tags=["ui", "terminal"])
def terminal_enter(v, i):
    click(v, f=2000, g=0.5, dur=0.006)
    modal(v, freqs=[1200, 2100, 3400], t60s=[0.06, 0.04, 0.03], amps=[1, 0.5, 0.3], exc=0.002, g=0.3)
    thump(v, f0=180, f1=120, dur=0.03, g=0.25)
    burst(v, at=0.05, type="white", filt="bandpass", f0=3000, q=2, dur=0.04, g=0.08, atk=0.005)


@sound("terminal_beep", 2, "ui", desc="the terminal's beep: a square wave through a tiny speaker", tags=["ui", "terminal"])
def terminal_beep(v, i):
    tone(v, type="square", f0=1000, dur=0.12, g=0.3, atk=0.002, bp=1600, bq=1.5)
    tone(v, type="sine", f0=1000, dur=0.12, g=0.15, atk=0.002)


@sound("terminal_error", 2, "ui", desc="the terminal refusing: a low double buzz", tags=["ui", "terminal"])
def terminal_error(v, i):
    for at in (0.0, 0.18):
        tone(v, at=at, type="square", f0=220, dur=0.12, g=0.3, atk=0.002, lp=1500)
        tone(v, at=at, type="square", f0=233, dur=0.12, g=0.15, atk=0.002, lp=1500)


@sound("terminal_print", 1, "ui", desc="1.6 s: the dot-matrix printing a contract", tags=["ui", "terminal"])
def terminal_print(v, i):
    n = dsp.sec(1.6)
    x = dsp.biquad(dsp.crackle(v.rng, n, 900.0, 0.2), "bandpass", 3200.0, 2.0) * 0.4
    x *= (0.4 + 0.6 * (np.sin(2 * np.pi * 7.0 * np.arange(n) / dsp.SR) > 0)) * dsp.env(n, 0.02, 1.4, curve="cos", hold_level=1.0)
    x += dsp.biquad(dsp.osc(n, 120.0, "sawtooth"), "bandpass", 500.0, 2.0) * 0.08 * dsp.env(n, 0.05, 1.4, curve="cos", hold_level=1.0)
    v.add(x, 0.0)
    clack(v, at=1.55, f=2200, g=0.25, dur=0.012, decay=0.06)


@sound("radio_tune", 3, "ui", desc="turning the dial: static, a carrier whistle sliding, a voice fragment passing", tags=["ui", "radio"])
def radio_tune(v, i):
    n = dsp.sec(1.2)
    st = dsp.highpass(dsp.white(v.rng, n), 2000.0) * 0.25 * (0.6 + 0.4 * np.sin(2 * np.pi * 1.3 * np.arange(n) / dsp.SR))
    st += dsp.lowpass(dsp.crackle(v.rng, n, 300.0), 3500.0) * 0.2
    v.add(st, 0.0)
    tone(v, at=0.2, f0=v.rnd(3000, 5000), f1=v.rnd(600, 1200), dur=0.5, g=0.12, atk=0.05, curve="cos")  # the heterodyne
    phones, stress, _ = vox.PHRASES[v.pick(["priyom", "vtoroy", "chisto"])]
    x = vox.vocal(v.rng, phones, stress, v.rnd(100, 140), 1.1)
    x = vox.radio(x, v.rng, drive=4.0, static=0.0, squelch=False, dropouts=2)
    m = len(x)
    x *= dsp.env(m, 0.15, 0.2, curve="cos")
    v.add(x * 0.5, 0.45)
    click(v, at=0.02, f=2500, g=0.15, dur=0.005)


@sound("radio_static", 1, "loop", peak=-16.0, loop=True, desc="6 s: a dead channel", tags=["ui", "radio", "loop"])
def radio_static(v, i):
    n = dsp.sec(6.0)
    tt = np.arange(n) / dsp.SR
    x = dsp.biquad(dsp.white(v.rng, n), "bandpass", 2500.0 + 300.0 * np.sin(2 * np.pi * 0.3 * tt), 0.5) * 0.3
    x += dsp.lowpass(dsp.crackle(v.rng, n, 200.0, 0.5), 4000.0) * 0.15
    x += dsp.osc(n, 50.0, "sine") * 0.03
    v.add(x, 0.0)
    v.buf = v.buf[:n]


@sound("radio_squelch", 3, "ui", desc="the squelch opening and closing on nothing", tags=["ui", "radio"])
def radio_squelch(v, i):
    burst(v, type="white", filt="bandpass", f0=2500, q=1, dur=0.04, g=0.45, atk=0.001)
    burst(v, at=0.03, type="white", filt="highpass", f0=2500, q=0.5, dur=v.rnd(0.15, 0.4), g=0.12, atk=0.01)
    tone(v, at=0.05, f0=2400, f1=600, dur=0.08, g=0.12, atk=0.003)
    burst(v, at=0.3, type="white", filt="bandpass", f0=2000, q=1, dur=0.03, g=0.3, atk=0.001)


@sound("radio_dispatch", 2, "voice", peak=-8.0, desc="the Committee dispatcher: a clean procedural voice through a good radio", tags=["ui", "radio", "voice"])
def radio_dispatch(v, i):
    keys = ["priyom", "vtoroy"]
    phones, stress, _ = vox.PHRASES[keys[i % 2]]
    x = vox.vocal(v.rng, phones, stress, v.rnd(115, 135), 1.0, breathy=0.1, tense=0.6)
    y = vox.radio(x, v.rng, drive=2.5, bits=10.0, band=(300.0, 3400.0), hum=0.04, static=0.03, dropouts=0)
    v.add(y, 0.0)


@sound("watch_beep", 2, "ui", desc="the wristwatch: a tiny piezo beep", tags=["ui", "watch"])
def watch_beep(v, i):
    tone(v, type="square", f0=4000, dur=0.06, g=0.25, atk=0.001, bp=4000, bq=3)
    tone(v, at=0.09, type="square", f0=4000, dur=0.06, g=0.25, atk=0.001, bp=4000, bq=3)


@sound("watch_alarm", 1, "ui", peak=-10.0, desc="the watch alarm: four quick beeps, twice", tags=["ui", "watch"])
def watch_alarm(v, i):
    # a piezo disc in a plastic case: a hard square whose odd harmonics survive (a narrow band-pass would leave a sine),
    # each beep started by the driver's click and coloured by the case resonance, with the timing a hair imperfect
    f = 4100.0
    for r in range(2):
        for k in range(4):
            at = r * 0.6 + k * 0.1 + v.rnd(-0.002, 0.002)
            tone(v, at=at, type="square", f0=f * v.rnd(0.995, 1.005), dur=0.05, g=0.22, atk=0.0008, hp=2200, lp=13000)
            click(v, at=at, f=6200, g=0.16, dur=0.0018)
            modal(v, at=at, freqs=[2450, 5900, 8300], t60s=[0.02, 0.03, 0.015], amps=[0.7, 1.0, 0.4], exc=0.0006, g=0.10)


@sound("watch_tick", 2, "ui", peak=-22.0, desc="the watch's tick", tags=["ui", "watch"])
def watch_tick(v, i):
    click(v, f=5000, g=0.3, dur=0.002)
    modal(v, freqs=[6500], t60s=[0.01], amps=[1], exc=0.0005, g=0.1)


@sound("mission_complete", 1, "ui", peak=-10.0, desc="a contract closed: two triangle tones and the stamp", tags=["ui", "mission"])
def mission_complete(v, i):
    tone(v, type="triangle", f0=660, dur=0.18, g=0.28, atk=0.003); click(v, f=2500, g=0.12)
    tone(v, at=0.2, type="triangle", f0=880, dur=0.3, g=0.3, atk=0.003); click(v, at=0.2, f=2500, g=0.12)
    sv = v.sub(); ui_stamp(sv, 0); v.add(sv.render() * 0.6, 0.5)


@sound("mission_new", 1, "ui", peak=-12.0, desc="a new contract: the printer and a beep", tags=["ui", "mission"])
def mission_new(v, i):
    sv = v.sub(); terminal_print(sv, 0); v.add(sv.render() * 0.7, 0.0)
    tone(v, at=1.6, type="square", f0=1000, dur=0.1, g=0.2, atk=0.002, bp=1600, bq=1.5)


@sound("rank_up", 1, "ui", peak=-8.0, desc="a Committee notice: three rising tones, a stamp, paper", tags=["ui", "mission"])
def rank_up(v, i):
    for k, f in enumerate([523, 659, 784]):
        tone(v, at=k * 0.16, type="triangle", f0=f, dur=0.35, g=0.25, atk=0.003)
    sv = v.sub(); ui_stamp(sv, 0); v.add(sv.render() * 0.7, 0.6)
    _paper(v, 0.75, 0.2, 0.2)


@sound("notify", 2, "ui", peak=-14.0, desc="a quiet notice: one soft tone and paper", tags=["ui"])
def notify(v, i):
    tone(v, type="triangle", f0=880, dur=0.25, g=0.2, atk=0.005, lp=3000)
    _paper(v, 0.05, 0.1, 0.15)


@sound("map_open", 2, "ui", desc="the paper map unfolded", tags=["ui", "map"])
def map_open(v, i):
    cloth(v, n=2, span=0.1, g=0.1)
    _paper(v, 0.05, 0.3, 0.35, 2400.0)
    _paper(v, 0.3, 0.2, 0.3, 2800.0)
    burst(v, at=0.5, type="crackle_fine", filt="highpass", f0=2500, q=0.7, dur=0.15, g=0.12, atk=0.02)  # creases


@sound("map_close", 2, "ui", desc="the map folded away", tags=["ui", "map"])
def map_close(v, i):
    _paper(v, 0.0, 0.2, 0.3, 2600.0)
    burst(v, at=0.15, type="crackle_fine", filt="highpass", f0=2500, q=0.7, dur=0.12, g=0.12, atk=0.02)
    _paper(v, 0.3, 0.12, 0.2, 2200.0)
    cloth(v, at=0.4, n=2, span=0.1, g=0.1)


@sound("money", 2, "ui", desc="roubles counted out", tags=["ui"])
def money(v, i):
    for k in range(v.irnd(3, 5)):
        _paper(v, k * 0.12, 0.08, 0.25, v.rnd(2600, 3400))
    modal(v, at=0.05, freqs=[4200, 6300], t60s=[0.08, 0.05], amps=[1, 0.5], exc=0.0008, g=0.12)


@sound("inventory_move", 3, "ui", peak=-16.0, desc="an item moved between pouches", tags=["ui", "inventory"])
def inventory_move(v, i):
    cloth(v, n=2, span=0.1, g=0.18)
    click(v, at=0.06, f=v.rnd(2200, 3200), g=0.15, dur=0.005)


@sound("inventory_equip", 2, "ui", desc="a piece of gear buckled on", tags=["ui", "inventory"])
def inventory_equip(v, i):
    cloth(v, n=3, span=0.2, g=0.2)
    clack(v, at=0.15, f=2600, g=0.25, dur=0.01, decay=0.05)
    burst(v, at=0.05, type="pink", filt="bandpass", f0=500, q=1.0, dur=0.15, g=0.1, atk=0.03)  # strap pulled
