"""Gunfire for every weapon in data/weapons.json (fire_<id>, fire_<id>_sup, fire_<id>_far) plus class and calibre
fallbacks, and the mechanical vocabulary per family (mags, bolts, slides, pumps, belts, clips, safeties, dry fire, jams).
"""
import json
import os
import numpy as np
from . import dsp, synth, reverb
from .synth import Voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, modal, metal_body, wood_body, whoosh, rattle, gunshot
from .registry import sound, define, alias, REG

HERE = os.path.dirname(os.path.abspath(__file__))
WEAPONS = json.load(open(os.path.join(HERE, "..", "..", "data", "weapons.json")))

# ------------------------------------------------------------------------------------------------ calibre character
CAL = {
    "9x18": dict(tailScale=0.55, crackF0=4600, crackF1=520, crackDur=0.05, crackG=0.9, blastF0=6500, blastDur=0.035, blastG=0.6, thumpF0=95, thumpF1=40, thumpDur=0.08,
                 thumpG=0.55, punchF=320, bodyF0=170, bodyF1=80, bodyDur=0.04, bodyG=0.25, bodyLp=1200, tailDur=0.3, tailG=0.1, far=140, supersonic=False),
    "9x19": dict(tailScale=0.60, crackF0=4400, crackF1=500, crackDur=0.055, crackG=0.95, blastF0=6500, blastDur=0.04, blastG=0.65, thumpF0=95, thumpF1=38, thumpDur=0.09,
                 thumpG=0.65, punchF=300, bodyF0=160, bodyF1=75, bodyDur=0.045, bodyG=0.28, bodyLp=1100, tailDur=0.35, tailG=0.12, far=160, supersonic=True),
    "7.62x25": dict(tailScale=0.60, crackF0=5200, crackF1=600, crackDur=0.06, crackG=1.0, blastF0=7500, blastDur=0.04, blastG=0.7, thumpF0=100, thumpF1=45, thumpDur=0.08,
                    thumpG=0.5, punchF=340, bodyF0=190, bodyF1=90, bodyDur=0.04, bodyG=0.22, bodyLp=1400, tailDur=0.35, tailG=0.12, far=180, supersonic=True),
    ".45": dict(tailScale=0.65, crackF0=3600, crackF1=420, crackDur=0.06, crackG=0.9, blastF0=5500, blastDur=0.045, blastG=0.7, thumpF0=85, thumpF1=34, thumpDur=0.11,
                thumpG=0.8, punchF=260, bodyF0=140, bodyF1=65, bodyDur=0.05, bodyG=0.3, bodyLp=900, boomG=0.3, boomF=300, tailDur=0.4, tailG=0.14, far=160, supersonic=False),
    "5.45x39": dict(tailScale=0.90, crackF0=4300, crackF1=460, crackDur=0.075, crackG=1.05, blastF0=7000, blastDur=0.05, blastG=0.75, thumpF0=100, thumpF1=32, thumpDur=0.12,
                    thumpG=0.85, punchF=280, bodyF0=150, bodyF1=65, bodyDur=0.05, bodyG=0.4, bodyLp=800, tailDur=0.5, tailG=0.2, far=300, supersonic=True),
    "7.62x39": dict(tailScale=1.00, crackF0=3800, crackF1=400, crackDur=0.08, crackG=1.0, blastF0=6000, blastDur=0.055, blastG=0.8, thumpF0=100, thumpF1=28, thumpDur=0.14,
                    thumpG=1.0, punchF=250, bodyF0=140, bodyF1=60, bodyDur=0.055, bodyG=0.5, bodyLp=700, boomG=0.25, boomF=380, boomDur=0.16, tailDur=0.6, tailG=0.22, far=320, supersonic=True),
    "5.56x45": dict(tailScale=0.90, crackF0=4800, crackF1=500, crackDur=0.07, crackG=1.1, blastF0=7500, blastDur=0.045, blastG=0.8, thumpF0=105, thumpF1=35, thumpDur=0.11,
                    thumpG=0.8, punchF=290, bodyF0=160, bodyF1=70, bodyDur=0.045, bodyG=0.35, bodyLp=900, tailDur=0.5, tailG=0.2, far=300, supersonic=True),
    "9x39": dict(tailScale=0.50, crackF0=3200, crackF1=400, crackDur=0.05, crackG=0.5, blastF0=4000, blastDur=0.03, blastG=0.3, thumpF0=90, thumpF1=35, thumpDur=0.09,
                 thumpG=0.6, punchF=260, bodyF0=130, bodyF1=60, bodyDur=0.05, bodyG=0.3, bodyLp=700, tailDur=0.3, tailG=0.1, far=120, supersonic=False),
    "12ga": dict(tailScale=1.20, crackF0=3000, crackF1=250, crackDur=0.09, crackG=0.9, blastF0=5000, blastDur=0.07, blastG=0.9, thumpF0=70, thumpF1=25, thumpDur=0.2,
                 thumpG=1.2, punchF=200, bodyF0=90, bodyF1=40, bodyDur=0.12, bodyG=0.6, bodyLp=500, boomG=0.7, boomF=420, boomDur=0.2, tailDur=0.75, tailG=0.25, tailF0=1500, far=400, supersonic=False),
    "7.62x54": dict(tailScale=1.30, clickG=1.0, crackF0=5000, crackF1=350, crackDur=0.09, crackG=1.2, crackQ=0.6, blastF0=7000, blastDur=0.06, blastG=0.9, thumpF0=95, thumpF1=28,
                    thumpDur=0.16, thumpG=1.0, punchF=240, bodyF0=130, bodyF1=55, bodyDur=0.06, bodyG=0.5, bodyLp=800, boomG=0.4, boomF=350, boomDur=0.18, tailDur=0.9,
                    tailG=0.3, tailF0=3000, tailF1=250, far=420, supersonic=True),
    ".357": dict(tailScale=0.80, crackF0=4200, crackF1=420, crackDur=0.07, crackG=1.1, blastF0=7000, blastDur=0.05, blastG=0.85, thumpF0=95, thumpF1=32, thumpDur=0.11,
                 thumpG=0.85, punchF=280, bodyF0=150, bodyF1=70, bodyDur=0.05, bodyG=0.35, bodyLp=900, boomG=0.2, boomF=320, tailDur=0.45, tailG=0.18, far=220, supersonic=True),
}

# barrel length (m) — bore resonance and how much unburnt powder leaves the muzzle
BARREL = {"pm": 0.093, "pb": 0.105, "aps": 0.14, "tt": 0.116, "glock": 0.114, "m9": 0.125, "m1911": 0.127, "kedr": 0.12, "bizon": 0.23, "vityaz": 0.23,
          "mp5": 0.225, "ppsh": 0.27, "akm": 0.415, "akms": 0.415, "ak74m": 0.415, "aks74u": 0.21, "ak105": 0.314, "ak12": 0.415, "sks": 0.52, "m4": 0.37,
          "hk416": 0.368, "scar": 0.35, "vss": 0.2, "val": 0.2, "sr3m": 0.156, "toz": 0.71, "mp153": 0.71, "rem870": 0.47, "saiga": 0.43, "mosin": 0.73,
          "obrez": 0.25, "svd": 0.62, "sv98": 0.65, "rpk74": 0.59, "pkm": 0.658}

# mechanical action after the shot, per family (time from the report, s)
MECH = {
    "pistol": [dict(at=0.045, f=2600, g=0.22, slide=0.02), dict(at=0.085, f=2200, g=0.28)],
    "smg": [dict(at=0.05, f=2300, g=0.3, slide=0.03), dict(at=0.09, f=1900, g=0.25)],
    "ak": [dict(at=0.07, f=2300, g=0.3, slide=0.03), dict(at=0.115, f=1900, g=0.22)],
    "ar": [dict(at=0.06, f=2600, g=0.25, slide=0.025), dict(at=0.1, f=2100, g=0.2)],
    "sks": [dict(at=0.06, f=2400, g=0.3), dict(at=0.1, f=2000, g=0.22)],
    "svd": [dict(at=0.065, f=2200, g=0.32, slide=0.03), dict(at=0.11, f=1800, g=0.25)],
    "vss": [dict(at=0.05, f=2400, g=0.4, slide=0.03), dict(at=0.09, f=2000, g=0.35)],
    "shotgun_semi": [dict(at=0.08, f=1900, g=0.35, slide=0.04), dict(at=0.13, f=1500, g=0.3)],
    "pkm": [dict(at=0.06, f=1700, g=0.4, slide=0.04), dict(at=0.1, f=1400, g=0.35)],
    "manual": [],
}
FAMILY_MECH = {"pm": "pistol", "aps": "pistol", "tt": "pistol", "glock": "pistol", "m9": "pistol", "m1911": "pistol", "kedr": "smg", "bizon": "smg",
               "vityaz": "smg", "mp5": "smg", "ppsh": "smg", "ak762": "ak", "ak545": "ak", "sks": "sks", "ar": "ar", "vss": "vss", "toz": "manual",
               "mp153": "shotgun_semi", "rem870": "manual", "saiga": "shotgun_semi", "mosin": "manual", "svd": "svd", "sv98": "manual", "pkm": "pkm"}
INTEGRAL_SUPPRESSED = {"vss", "val", "sr3m", "pb"}
FAR_SPACE = {"pistol": "distant", "smg": "distant", "rifle": "distant", "shotgun": "distant", "sniper": "distant", "mg": "distant"}


def weapon_params(wid: str) -> dict:
    w = WEAPONS[wid]
    p = dict(CAL[w["cal"]])
    L = BARREL.get(wid, 0.4)
    p["boreLen"] = L
    p["boreG"] = 0.2 + 0.25 * min(L / 0.7, 1.0)
    # short barrels: more blast, deeper, louder
    if L < 0.26 and w["cls"] not in ("pistol",):
        p["blastG"] = p.get("blastG", 0.7) * 1.4
        p["boomG"] = p.get("boomG", 0.0) + 0.35
        p["boomF"] = p.get("boomF", 380) * 0.9
        p["crackF0"] = p["crackF0"] * 0.85
        p["thumpG"] = p["thumpG"] * 1.15
    if wid == "obrez":
        p["blastG"] *= 1.3; p["boomG"] += 0.3; p["crackG"] *= 0.9; p["tailG"] *= 1.2
    if wid == "rpk74":
        p["boreG"] *= 1.2
    if wid == "pkm":
        p["thumpG"] *= 1.1; p["bodyG"] *= 1.15
    if w["cls"] == "mg":
        p["tailG"] *= 1.1
    p["mech"] = [dict(m) for m in MECH[FAMILY_MECH.get(w["family"], "ak")]]
    if w["family"] == "ar":
        p["ar_spring"] = True
    if w["family"] == "pkm":
        p["belt"] = True
    p["cls"] = w["cls"]
    p["sup_integral"] = wid in INTEGRAL_SUPPRESSED
    return p


def _mech_extras(v: Voice, p: dict, g: float = 1.0):
    if p.get("ar_spring"):
        tone(v, at=0.075, type="triangle", f0=1500, f1=1150, dur=0.07, g=0.08 * g, atk=0.004, lp=3000, vib=dict(f=90, depth=40))
    if p.get("belt"):
        pulses(v, n=3, at=0.09, span=0.08, type="white", f0=2500, f1=4000, q=3, dur=0.006, g=0.18 * g)


def render_shot(v: Voice, p: dict, suppressed: bool = False, space: str = "field") -> np.ndarray:
    p = dict(p)
    if suppressed:
        # the can eats the blast: a mid thud, gas hiss, the action loud in the mix, a supersonic snap if the round is fast
        crack_g = p["crackG"] * 0.22
        burst(v, type="white", filt="bandpass", f0=p["crackF0"] * 0.55, f1=350, q=0.9, dur=p["crackDur"] * 0.8, g=crack_g, atk=0.0008, sat=2.5)
        burst(v, at=0.002, type="pink", filt="lowpass", f0=1600, f1=400, q=0.8, dur=0.06, g=0.55, atk=0.001, sat=3.0)
        thump(v, f0=p["thumpF0"] * 0.95, f1=p["thumpF1"] * 1.2, dur=p["thumpDur"] * 0.7, g=p["thumpG"] * 0.8)
        burst(v, type="brown", filt="lowpass", f0=p["punchF"], f1=p["punchF"] * 0.5, q=0.8, dur=p["thumpDur"] * 0.8, g=p["thumpG"] * 0.45, atk=0.001)
        burst(v, at=0.01, type="white", filt="bandpass", f0=1800, f1=900, q=0.7, dur=0.16, g=0.22, atk=0.01)  # gas venting hiss
        if p.get("supersonic"):
            burst(v, at=0.0, type="white", filt="highpass", f0=3500, q=0.8, dur=0.004, g=0.7, atk=0.0002)
            burst(v, at=0.004, type="white", filt="bandpass", f0=4500, f1=2500, q=1.5, dur=0.025, g=0.25, atk=0.001)
        for m in p.get("mech", []):
            clack(v, at=m["at"], f=m.get("f", 2400), g=m.get("g", 0.3) * 1.7, dur=0.012, decay=0.06)
            if m.get("slide"):
                burst(v, at=m["at"] + 0.004, type="white", filt="bandpass", f0=m.get("f", 2400) * 0.8, q=1.2, dur=m["slide"], g=m.get("g", 0.3) * 0.8, atk=0.004)
        _mech_extras(v, p, 1.6)
        tail(v, dur=0.2, g=0.08, f0=1500, f1=300)
        x = v.render()
        x = dsp.saturate(x, 1.4)
        return reverb.place(x, "forest", v.rng, wet_db=-12.0, rt_scale=0.7)
    gunshot(v, **p)
    _mech_extras(v, p, 1.0)
    # muzzle crackle of burning powder in the first 15 ms
    burst(v, at=0.001, type="crackle_fine", filt="highpass", f0=2500, q=0.7, dur=0.02, g=0.5, atk=0.0005, sat=2.0)
    x = v.render()
    x = dsp.saturate(x, 1.8)
    ts = p.get("tailScale", 1.0)
    return reverb.place(x, space, v.rng, wet_db=reverb.SPACES[space][1] + 6.0 * np.log2(ts), rt_scale=0.6 + 0.4 * ts)


def make_fire(wid: str, mode: str):
    p = weapon_params(wid)

    def fn(v: Voice, i: int):
        if mode == "sup" or (mode == "fire" and p["sup_integral"]):
            return render_shot(v, p, True)
        if mode == "far":
            dry_v = Voice(v.rng)
            if p["sup_integral"]:
                x = render_shot(dry_v, p, True)
                return reverb.far(x, p["far"] * 0.35, v.rng)
            gunshot(dry_v, **p)
            x = dsp.saturate(dry_v.render(), 2.0)
            return reverb.far(x, p["far"] * v.rnd(0.8, 1.25), v.rng)
        return render_shot(v, p, False, v.pick(["field", "field", "village"]))
    return fn


for _wid in WEAPONS:
    _p = weapon_params(_wid)
    _cls = WEAPONS[_wid]["cls"]
    define("fire_%s" % _wid, make_fire(_wid, "fire"), variants=3, cat="gun", sat=0.0, desc="%s report, outdoor" % WEAPONS[_wid]["name"], tags=["weapon", _cls])
    define("fire_%s_sup" % _wid, make_fire(_wid, "sup"), variants=2, cat="gun_sup", desc="%s suppressed" % WEAPONS[_wid]["name"], tags=["weapon", _cls])
    define("fire_%s_far" % _wid, make_fire(_wid, "far"), variants=2, cat="gun_far", desc="%s heard from %d m" % (WEAPONS[_wid]["name"], _p["far"]), tags=["weapon", _cls])

# class and calibre-family fallbacks (a representative weapon each)
CLASS_REP = {"pistol": "pm", "smg": "vityaz", "rifle": "akm", "shotgun": "rem870", "sniper": "mosin", "mg": "pkm", "revolver": None,
             "9x18": "pm", "9x19": "glock", "357": None, "ak545": "ak74m", "ak762": "akm", "ar556": "m4", "12ga_pump": "rem870", "12ga_semi": "saiga",
             "bolt_762x54": "mosin", "dmr": "svd", "lmg": "pkm", "smg_9x18": "kedr", "smg_9x19": "mp5", "vss": "vss", "sks": "sks"}


def make_generic(cal: str, cls: str, mech: str, mode: str, barrel: float = 0.15):
    p = dict(CAL[cal]); p["boreLen"] = barrel; p["boreG"] = 0.3; p["mech"] = [dict(m) for m in MECH[mech]]; p["cls"] = cls; p["sup_integral"] = False

    def fn(v: Voice, i: int):
        if mode == "sup":
            return render_shot(v, p, True)
        if mode == "far":
            dv = Voice(v.rng); gunshot(dv, **p)
            return reverb.far(dsp.saturate(dv.render(), 2.0), p["far"] * v.rnd(0.8, 1.2), v.rng)
        if mode == "indoor":
            gunshot(v, **p)
            return reverb.place(dsp.saturate(v.render(), 1.8), "bunker", v.rng, wet_db=-1.0)
        return render_shot(v, p, False)
    return fn


for _key, _rep in CLASS_REP.items():
    for _mode, _suffix, _cat, _n in (("fire", "", "gun", 3), ("sup", "_sup", "gun_sup", 2), ("far", "_far", "gun_far", 2)):
        if _rep is None:  # the revolver: no catalogue weapon, a .357 snub with no cycling action
            define("fire_%s%s" % (_key, _suffix), make_generic(".357", "pistol", "manual", _mode, 0.1), variants=_n, cat=_cat, desc=".357 revolver fallback", tags=["weapon", "fallback"])
        else:
            define("fire_%s%s" % (_key, _suffix), make_fire(_rep, _mode), variants=_n, cat=_cat, desc="fallback = %s" % _rep, tags=["weapon", "fallback"])
for _cls, _cal, _mech, _bl in (("pistol", "9x18", "pistol", 0.1), ("smg", "9x19", "smg", 0.23), ("rifle", "7.62x39", "ak", 0.415), ("shotgun", "12ga", "manual", 0.5),
                               ("sniper", "7.62x54", "manual", 0.7), ("mg", "7.62x54", "pkm", 0.65)):
    define("fire_%s_indoor" % _cls, make_generic(_cal, _cls, _mech, "indoor", _bl), variants=2, cat="gun", desc="%s inside a concrete room" % _cls, tags=["weapon", "indoor"])

# legacy names from the browser build
define("shot_pm", make_fire("pm", "fire"), variants=3, cat="gun", desc="legacy = fire_pm", tags=["legacy"])
define("shot_akm", make_fire("akm", "fire"), variants=3, cat="gun", desc="legacy = fire_akm", tags=["legacy"])
define("shot_toz", make_fire("toz", "fire"), variants=3, cat="gun", desc="legacy = fire_toz", tags=["legacy"])
define("shot_mosin", make_fire("mosin", "fire"), variants=3, cat="gun", desc="legacy = fire_mosin", tags=["legacy"])
define("shot_suppressed", make_fire("ak74m", "sup"), variants=2, cat="gun_sup", desc="legacy generic suppressed rifle", tags=["legacy"])


@sound("mimic_shot", 3, "gun", desc="a mimic's AK: the report with a thin ghost of static folded in", tags=["creature", "mimic"])
def mimic_shot(v: Voice, i: int):
    p = weapon_params(v.pick(["akm", "ak74m", "akms"]))
    gunshot(v, **p)
    burst(v, at=0.01, type="white", filt="highpass", f0=3000, q=0.5, dur=0.1, g=0.1, atk=0.002)
    burst(v, at=0.03, type="crackle", filt="bandpass", f0=2500, q=1.0, dur=0.12, g=0.12, atk=0.005)
    return reverb.place(dsp.saturate(v.render(), 1.8), "field", v.rng)


@sound("seeker_shot", 3, "gun", desc="the seeker's PKM, heavier and closer", tags=["creature", "seeker"])
def seeker_shot(v: Voice, i: int):
    p = weapon_params("pkm"); p["thumpG"] *= 1.2; p["boomG"] = 0.5; p["boomF"] = 300
    gunshot(v, **p)
    pulses(v, n=4, at=0.08, span=0.1, type="white", f0=2000, f1=3500, q=3, dur=0.006, g=0.25)
    return reverb.place(dsp.saturate(v.render(), 2.0), "field_big", v.rng)


@sound("distant_shot", 4, "gun_far", desc="a single shot somewhere across the fields (mixed calibres)", tags=["ambience"])
def distant_shot(v: Voice, i: int):
    p = weapon_params(v.pick(["akm", "ak74m", "mosin", "toz", "sks", "svd"]))
    dv = Voice(v.rng); gunshot(dv, **p)
    return reverb.far(dsp.saturate(dv.render(), 2.0), v.rnd(350, 900), v.rng)


@sound("distant_burst", 3, "gun_far", desc="a 3-5 round burst far away", tags=["ambience"])
def distant_burst(v: Voice, i: int):
    p = weapon_params(v.pick(["akm", "ak74m", "aks74u"]))
    dv = Voice(v.rng)
    n = v.irnd(3, 5); gap = 60.0 / WEAPONS["akm"]["rpm"]
    for k in range(n):
        sv = dv.sub(); gunshot(sv, **p); dv.add(sv.render() * v.rnd(0.8, 1.0), k * gap * v.rnd(0.97, 1.03))
    return reverb.far(dsp.saturate(dv.render(), 2.0), v.rnd(300, 700), v.rng)


# ------------------------------------------------------------------------------------------------ mechanicals
def _mag_out(v: Voice, size: float = 1.0, plastic: bool = False):
    """release button, magazine sliding out of the well, into the hand"""
    click(v, f=3200, g=0.35, dur=0.004)
    metal_body(v, at=0.002, f=2600 if not plastic else 1800, g=0.12, t60=0.05, n=4, thick=0.7)
    burst(v, at=0.03, type="pink", filt="bandpass", f0=1400 * (1.2 if plastic else 1.0), f1=800, q=1.3, dur=0.12 * size, g=0.3, atk=0.02)
    pulses(v, n=v.irnd(2, 4), at=0.04, span=0.1 * size, type="white", f0=2500, f1=4500, q=3, dur=0.005, g=0.1)
    thump(v, at=0.13 * size, f0=150, f1=90, dur=0.05, g=0.25)
    cloth(v, at=0.11 * size, n=2, span=0.12, g=0.15)


def _mag_in(v: Voice, size: float = 1.0, rock: bool = False, plastic: bool = False):
    """cloth, the magazine finding the well, the seat"""
    cloth(v, n=2, span=0.08, g=0.14)
    burst(v, at=0.02, type="pink", filt="bandpass", f0=800 * (1.3 if plastic else 1.0), f1=1500, q=1.2, dur=0.1 * size, g=0.22, atk=0.02)
    if rock:  # AK: front hook, then the latch
        click(v, at=0.09, f=2800, g=0.3, dur=0.005)
        metal_body(v, at=0.09, f=2200, g=0.12, t60=0.04, n=4)
    t = 0.14 * size
    thump(v, at=t, f0=140, f1=70, dur=0.06, g=0.6)
    burst(v, at=t, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.05, g=0.45, atk=0.001)
    clack(v, at=t + 0.003, f=2800 if not plastic else 2000, g=0.45, dur=0.01, decay=0.05)
    metal_body(v, at=t + 0.003, f=1900 if not plastic else 1300, g=0.14, t60=0.08 * size, n=6, thick=0.5)


def _rack(v: Voice, f_back: float = 2300.0, f_fwd: float = 2000.0, travel: float = 0.12, weight: float = 1.0, ring_f: float = 1600.0, spring: bool = False):
    """pull the bolt/slide back against the spring, let it slam home"""
    clack(v, f=f_back, g=0.45 * weight, dur=0.012, decay=0.08)
    burst(v, at=0.01, type="white", filt="bandpass", f0=2800, f1=3400, q=1.5, dur=travel, g=0.2, atk=0.02, pr=0.9, pr1=1.15)
    if spring:
        tone(v, at=0.012, type="triangle", f0=900, f1=1300, dur=travel, g=0.05, atk=0.01, lp=2500, vib=dict(f=60, depth=30))
    clack(v, at=travel + 0.01, f=f_back * 0.9, g=0.35 * weight, dur=0.01, decay=0.05)  # rear stop
    # forward
    t = travel + 0.1
    burst(v, at=t, type="white", filt="bandpass", f0=3000, f1=2200, q=1.5, dur=travel * 0.6, g=0.15, atk=0.01)
    clack(v, at=t + travel * 0.6, f=f_fwd, g=0.7 * weight, dur=0.018, decay=0.09)
    thump(v, at=t + travel * 0.6, f0=150 * weight ** 0.5, f1=90, dur=0.05, g=0.5 * weight)
    metal_body(v, at=t + travel * 0.6, f=ring_f, g=0.2 * weight, t60=0.14, n=7, thick=0.4)
    if spring:
        tone(v, at=t + travel * 0.6 + 0.005, type="triangle", f0=1400, f1=1100, dur=0.08, g=0.06, atk=0.003, lp=3000, vib=dict(f=80, depth=40))


def _bolt_back(v: Voice, f=2300.0, travel=0.12, weight=1.0, ring_f=1600.0, spring=False):
    clack(v, f=f, g=0.45 * weight, dur=0.012, decay=0.08)
    burst(v, at=0.01, type="white", filt="bandpass", f0=2800, f1=3400, q=1.5, dur=travel, g=0.2, atk=0.02, pr=0.9, pr1=1.15)
    if spring:
        tone(v, at=0.012, type="triangle", f0=900, f1=1300, dur=travel, g=0.05, atk=0.01, lp=2500, vib=dict(f=60, depth=30))
    clack(v, at=travel + 0.01, f=f * 0.9, g=0.4 * weight, dur=0.01, decay=0.06)
    metal_body(v, at=travel + 0.01, f=ring_f * 1.2, g=0.1 * weight, t60=0.08, n=5)


def _bolt_forward(v: Voice, f=2000.0, travel=0.08, weight=1.0, ring_f=1600.0, spring=False):
    burst(v, type="white", filt="bandpass", f0=3000, f1=2200, q=1.5, dur=travel, g=0.15, atk=0.01)
    clack(v, at=travel, f=f, g=0.7 * weight, dur=0.018, decay=0.09)
    thump(v, at=travel, f0=150 * weight ** 0.5, f1=90, dur=0.05, g=0.5 * weight)
    metal_body(v, at=travel, f=ring_f, g=0.2 * weight, t60=0.14, n=7, thick=0.4)
    if spring:
        tone(v, at=travel + 0.005, type="triangle", f0=1400, f1=1100, dur=0.08, g=0.06, atk=0.003, lp=3000, vib=dict(f=80, depth=40))


FAMS = {  # name -> (mag size, rock-in, plastic mag, bolt f, travel, weight, ring, spring)
    "pistol": (0.8, False, False, 2600, 0.07, 0.7, 2400, False),
    "smg": (1.0, False, False, 2300, 0.1, 0.9, 1900, False),
    "ak": (1.3, True, True, 2300, 0.13, 1.1, 1500, False),
    "ar": (1.1, False, False, 2600, 0.12, 1.0, 1800, True),
    "svd": (1.2, True, False, 2200, 0.12, 1.1, 1400, False),
    "vss": (1.0, False, False, 2400, 0.1, 0.9, 1700, False),
    "sks": (1.0, False, False, 2400, 0.11, 1.0, 1600, False),
    "shotgun": (1.3, True, True, 1900, 0.13, 1.3, 1200, False),
    "pkm": (1.6, False, False, 1700, 0.16, 1.5, 1100, False),
}


def _mk_mag_out(fam):
    def fn(v, i):
        s, rock, plastic, *_ = FAMS[fam]; _mag_out(v, s, plastic)
    return fn


def _mk_mag_in(fam):
    def fn(v, i):
        s, rock, plastic, *_ = FAMS[fam]; _mag_in(v, s, rock, plastic)
    return fn


def _mk_bolt_back(fam):
    def fn(v, i):
        _, _, _, f, tr, w, rf, sp = FAMS[fam]; _bolt_back(v, f, tr, w, rf, sp)
    return fn


def _mk_bolt_forward(fam):
    def fn(v, i):
        _, _, _, f, tr, w, rf, sp = FAMS[fam]; _bolt_forward(v, f * 0.85, tr * 0.6, w, rf, sp)
    return fn


def _mk_rack(fam):
    def fn(v, i):
        _, _, _, f, tr, w, rf, sp = FAMS[fam]; _rack(v, f, f * 0.85, tr, w, rf, sp)
    return fn


for _fam in FAMS:
    define("mag_out_%s" % _fam, _mk_mag_out(_fam), variants=3, cat="mech", desc="magazine out (%s family)" % _fam, tags=["mech", _fam])
    define("mag_in_%s" % _fam, _mk_mag_in(_fam), variants=3, cat="mech", desc="magazine seated (%s family)" % _fam, tags=["mech", _fam])
    define("bolt_back_%s" % _fam, _mk_bolt_back(_fam), variants=2, cat="mech", desc="bolt/slide pulled back (%s)" % _fam, tags=["mech", _fam])
    define("bolt_forward_%s" % _fam, _mk_bolt_forward(_fam), variants=2, cat="mech", desc="bolt/slide released home (%s)" % _fam, tags=["mech", _fam])
    define("rack_%s" % _fam, _mk_rack(_fam), variants=3, cat="mech", desc="full charge cycle (%s)" % _fam, tags=["mech", _fam])
alias("slide_rack_pistol", "rack_pistol"); alias("slide_rack_smg", "rack_smg")
alias("reload_magout", "mag_out_ak"); alias("reload_magin", "mag_in_ak"); alias("reload_chamber", "rack_ak")


@sound("slide_release_pistol", 2, "mech", desc="thumb on the slide stop: the slide slams home", tags=["mech", "pistol"])
def slide_release(v, i):
    click(v, f=3000, g=0.3, dur=0.004)
    _bolt_forward(v, 2400, 0.04, 0.75, 2300, False)


@sound("bolt_release_ar", 2, "mech", desc="the AR bolt catch paddle: loud clack and the buffer spring", tags=["mech", "ar"])
def bolt_release_ar(v, i):
    click(v, f=2800, g=0.4, dur=0.005)
    _bolt_forward(v, 2300, 0.05, 1.05, 1800, True)


@sound("bolt_open", 3, "mech", desc="bolt-action: lift and draw the bolt (Mosin, SV-98)", tags=["mech", "bolt"])
def bolt_open(v, i):
    clack(v, f=2100, g=0.5, dur=0.015, decay=0.12)  # handle lifted, lugs unlock
    metal_body(v, at=0.002, f=1500, g=0.15, t60=0.15, n=6, thick=0.5)
    burst(v, at=0.05, type="white", filt="bandpass", f0=2600, f1=3300, q=1.5, dur=0.16, g=0.22, atk=0.02, pr=0.9, pr1=1.15)
    pulses(v, n=v.irnd(3, 6), at=0.06, span=0.15, type="white", f0=3000, f1=5000, q=3, dur=0.005, g=0.08)  # rough steel grinding
    clack(v, at=0.22, f=1900, g=0.45, dur=0.012, decay=0.08)  # rear stop, empty case flicks out
    if v.chance(0.7):
        tinkle(v, n=2, at=0.24, span=0.06, f0=4000, f1=6500, dur=0.04, g=0.05)


@sound("bolt_close", 3, "mech", desc="bolt-action: push forward and turn down", tags=["mech", "bolt"])
def bolt_close(v, i):
    burst(v, type="white", filt="bandpass", f0=3000, f1=2200, q=1.5, dur=0.13, g=0.2, atk=0.015)
    clack(v, at=0.13, f=2000, g=0.6, dur=0.018, decay=0.09)
    thump(v, at=0.13, f0=150, f1=90, dur=0.05, g=0.4)
    clack(v, at=0.2, f=1800, g=0.55, dur=0.015, decay=0.1)  # handle turned down, lugs lock
    metal_body(v, at=0.2, f=1300, g=0.18, t60=0.18, n=7, thick=0.5)
alias("bolt_back_bolt", "bolt_open"); alias("bolt_forward_bolt", "bolt_close")


@sound("clip_load", 3, "mech", desc="stripper clip: seat the clip, thumb five rounds down", tags=["mech", "bolt", "sks"])
def clip_load(v, i):
    click(v, f=3200, g=0.3, dur=0.005)
    metal_body(v, at=0.002, f=3400, g=0.1, t60=0.04, n=4)
    for k in range(5):
        t = 0.08 + k * v.rnd(0.05, 0.07)
        burst(v, at=t, type="white", filt="bandpass", f0=2000, f1=1500, q=2, dur=0.03, g=0.15, atk=0.004)
        click(v, at=t + 0.02, f=3600, g=0.25 * (1 + k * 0.08), dur=0.005)
        tinkle(v, n=1, at=t + 0.02, span=0.01, f0=3800, f1=5200, dur=0.03, g=0.05)
    clack(v, at=0.45, f=2400, g=0.35, dur=0.01, decay=0.05)  # clip pulled and flicked away
    tinkle(v, n=2, at=0.47, span=0.08, f0=3000, f1=5000, dur=0.05, g=0.06)


@sound("pump_back", 3, "mech", desc="shotgun fore-end drawn back: the shuck", tags=["mech", "shotgun"])
def pump_back(v, i):
    clack(v, f=1900, g=0.4, dur=0.012, decay=0.07)
    burst(v, at=0.008, type="white", filt="bandpass", f0=2200, f1=2800, q=1.2, dur=0.11, g=0.28, atk=0.01)
    rattle(v, at=0.01, n=4, span=0.1, freqs=[2600, 3900, 5200], g=0.08, t60=0.04)
    clack(v, at=0.12, f=1600, g=0.55, dur=0.015, decay=0.1)
    metal_body(v, at=0.12, f=1200, g=0.18, t60=0.14, n=7, thick=0.5)
    if v.chance(0.8):
        tinkle(v, n=1, at=0.14, span=0.02, f0=2800, f1=3600, dur=0.06, g=0.06)  # ejected hull


@sound("pump_forward", 3, "mech", desc="shotgun fore-end slammed forward: the shuck's second half", tags=["mech", "shotgun"])
def pump_forward(v, i):
    burst(v, type="white", filt="bandpass", f0=2600, f1=2000, q=1.2, dur=0.09, g=0.25, atk=0.01)
    rattle(v, at=0.0, n=3, span=0.08, freqs=[2600, 3900], g=0.07, t60=0.04)
    clack(v, at=0.09, f=1500, g=0.7, dur=0.018, decay=0.12)
    thump(v, at=0.09, f0=140, f1=80, dur=0.06, g=0.5)
    metal_body(v, at=0.09, f=1100, g=0.22, t60=0.18, n=8, thick=0.5)


@sound("shotgun_pump", 3, "mech", desc="the whole pump cycle", tags=["mech", "shotgun"])
def shotgun_pump(v, i):
    pump_back(v, i)
    sv = v.sub(); pump_forward(sv, i); v.add(sv.render(), 0.24)


@sound("shell_insert", 4, "mech", desc="a 12 ga hull pushed into the tube past the latch", tags=["mech", "shotgun"])
def shell_insert(v, i):
    burst(v, type="white", filt="bandpass", f0=3000, f1=2200, q=2, dur=0.07, g=0.16, atk=0.012)  # plastic hull sliding
    burst(v, at=0.01, type="pink", filt="bandpass", f0=900, q=1.0, dur=0.06, g=0.12, atk=0.01)
    click(v, at=0.075, f=2600, g=0.4, dur=0.006)
    modal(v, at=0.075, freqs=[1900, 2900, 4100], t60s=[0.05, 0.04, 0.03], amps=[1, 0.6, 0.3], exc=0.0015, g=0.14)
    thump(v, at=0.078, f0=210, f1=120, dur=0.03, g=0.25)


@sound("break_open", 3, "mech", desc="the TOZ: lever over, barrels swing down, ejectors click", tags=["mech", "shotgun"])
def break_open(v, i):
    clack(v, f=2300, g=0.4, dur=0.012, decay=0.08)  # top lever
    trem(v, lambda sv: tone(sv, type="sawtooth", f0=680, f1=520, dur=0.2, g=0.1, atk=0.05, lp=1800, lq=2.5, shape=12, curve="lin"), v.rnd(9, 15), 0.45, 0.03)
    clack(v, at=0.2, f=2000, g=0.5, dur=0.02, decay=0.1)
    metal_body(v, at=0.2, f=1000, g=0.2, t60=0.2, n=7, thick=0.6)
    if v.chance(0.7):
        tinkle(v, n=2, at=0.24, span=0.1, f0=2800, f1=4200, dur=0.06, g=0.06)


@sound("break_close", 3, "mech", desc="barrels snapped shut", tags=["mech", "shotgun"])
def break_close(v, i):
    trem(v, lambda sv: tone(sv, type="sawtooth", f0=520, f1=700, dur=0.11, g=0.08, atk=0.03, lp=1800, lq=2.5, shape=12, curve="lin"), v.rnd(9, 15), 0.45, 0.0)
    clack(v, at=0.1, f=1900, g=0.65, dur=0.02, decay=0.12)
    thump(v, at=0.1, f0=160, f1=90, dur=0.05, g=0.45)
    metal_body(v, at=0.1, f=950, g=0.22, t60=0.25, n=8, thick=0.6)
    wood_body(v, at=0.1, f=210, g=0.2, t60=0.1)


@sound("belt_open_pkm", 2, "mech", desc="PKM feed cover unlatched and lifted", tags=["mech", "pkm"])
def belt_open(v, i):
    clack(v, f=1800, g=0.5, dur=0.015, decay=0.1)
    metal_body(v, at=0.002, f=900, g=0.25, t60=0.3, n=8, thick=0.6)
    burst(v, at=0.06, type="white", filt="bandpass", f0=1800, f1=2400, q=1.2, dur=0.2, g=0.12, atk=0.03)  # cover hinging
    clack(v, at=0.3, f=1500, g=0.35, dur=0.015, decay=0.08)


@sound("belt_load_pkm", 2, "mech", desc="a belt laid on the feed tray, links rattling", tags=["mech", "pkm"])
def belt_load(v, i):
    pulses(v, n=v.irnd(8, 12), span=0.5, type="white", f0=2200, f1=4200, q=3, dur=0.007, g=0.3)
    for k in range(v.irnd(4, 6)):
        metal_body(v, at=v.rnd(0.0, 0.5), f=v.rnd(2400, 3600), g=0.08, t60=0.05, n=4)
    cloth(v, at=0.1, n=2, span=0.3, g=0.1)
    clack(v, at=0.52, f=2000, g=0.3, dur=0.012, decay=0.06)


@sound("belt_close_pkm", 2, "mech", desc="feed cover slammed shut", tags=["mech", "pkm"])
def belt_close(v, i):
    burst(v, type="white", filt="bandpass", f0=2200, f1=1600, q=1.2, dur=0.12, g=0.12, atk=0.02)
    clack(v, at=0.12, f=1400, g=0.8, dur=0.02, decay=0.14)
    thump(v, at=0.12, f0=130, f1=70, dur=0.08, g=0.6)
    metal_body(v, at=0.12, f=800, g=0.3, t60=0.35, n=9, thick=0.7)


@sound("safety_click", 3, "mech", desc="a small thumb safety", tags=["mech"])
def safety_click(v, i):
    click(v, f=3400, g=0.45, dur=0.004)
    modal(v, freqs=[2600, 3900, 5600], t60s=[0.03, 0.025, 0.02], amps=[1, 0.5, 0.3], exc=0.001, g=0.2)
    thump(v, f0=260, f1=180, dur=0.02, g=0.15)


@sound("safety_ak", 3, "mech", desc="the AK safety lever: a loud flat clack off the receiver", tags=["mech", "ak"])
def safety_ak(v, i):
    burst(v, type="white", filt="bandpass", f0=2200, f1=1800, q=2, dur=0.03, g=0.25, atk=0.006)  # lever scraping the receiver
    clack(v, at=0.03, f=2000, g=0.6, dur=0.015, decay=0.08)
    metal_body(v, at=0.03, f=1400, g=0.25, t60=0.12, n=7, thick=0.35)
    thump(v, at=0.03, f0=180, f1=110, dur=0.03, g=0.3)


@sound("fire_selector", 3, "mech", desc="a selector switch detent", tags=["mech"])
def fire_selector(v, i):
    click(v, f=3000, g=0.4, dur=0.005)
    modal(v, freqs=[2200, 3300, 4700], t60s=[0.04, 0.03, 0.02], amps=[1, 0.6, 0.3], exc=0.0012, g=0.18)
    click(v, at=0.03, f=2600, g=0.25, dur=0.004)


@sound("dry_click", 4, "mech", desc="hammer on an empty chamber", tags=["mech"])
def dry_click(v, i):
    click(v, f=3000, g=0.45, dur=0.004)
    burst(v, type="white", filt="bandpass", f0=1800, q=3, dur=0.015, g=0.4, atk=0.0008)
    modal(v, freqs=[2200, 3100, 4400, 6100], t60s=[0.05, 0.04, 0.03, 0.02], amps=[1, 0.6, 0.4, 0.2], exc=0.0012, g=0.22)
    thump(v, f0=220, f1=140, dur=0.02, g=0.2)
alias("dry_click_pistol", "dry_click")


@sound("dry_click_rifle", 3, "mech", desc="a rifle hammer falling on nothing: heavier", tags=["mech"])
def dry_click_rifle(v, i):
    click(v, f=2600, g=0.5, dur=0.005)
    burst(v, type="white", filt="bandpass", f0=1500, q=2.5, dur=0.02, g=0.45, atk=0.0008)
    metal_body(v, f=1600, g=0.25, t60=0.09, n=7, thick=0.5)
    thump(v, f0=190, f1=110, dur=0.03, g=0.3)


@sound("jam", 3, "mech", desc="a stovepipe: the action stops short with a dull double-stop", tags=["mech"])
def jam(v, i):
    tone(v, f0=140, f1=90, dur=0.07, g=0.6, atk=0.001)
    burst(v, type="brown", filt="lowpass", f0=700, q=0.8, dur=0.06, g=0.5, atk=0.001)
    burst(v, at=0.02, type="white", filt="bandpass", f0=1400, q=3, dur=0.08, g=0.2, atk=0.01, pr=1, pr1=0.7)
    clack(v, at=0.04, f=1700, g=0.3, dur=0.01, decay=0.03)
    burst(v, at=0.06, type="white", filt="bandpass", f0=2400, f1=1800, q=2, dur=0.04, g=0.15, atk=0.005)  # brass scraping


@sound("unjam", 3, "mech", desc="clearing it: rattle, tug, the case flicked out, action home", tags=["mech"])
def unjam(v, i):
    pulses(v, n=v.irnd(4, 6), span=0.25, type="white", f0=2000, f1=3200, q=3, dur=0.012, g=0.3)
    burst(v, at=0.1, type="white", filt="bandpass", f0=2600, q=1.5, dur=0.1, g=0.15, atk=0.02)
    tinkle(v, n=2, at=0.26, span=0.06, f0=3500, f1=5500, dur=0.05, g=0.06)
    clack(v, at=0.3, f=2100, g=0.6, dur=0.02, decay=0.08)
    metal_body(v, at=0.3, f=1500, g=0.2, t60=0.12, n=6)
    thump(v, at=0.3, f0=150, f1=90, dur=0.05, g=0.4)


@sound("cock_revolver", 3, "mech", desc="a revolver hammer drawn back: ratchet clicks, cylinder indexing", tags=["mech", "revolver"])
def cock_revolver(v, i):
    for k, t in enumerate([0.0, 0.035, 0.07]):
        click(v, at=t, f=3200 - k * 300, g=0.35 + k * 0.1, dur=0.004)
        modal(v, at=t, freqs=[2500, 3800, 5400], t60s=[0.03, 0.025, 0.02], amps=[1, 0.5, 0.3], exc=0.001, g=0.14)
    burst(v, at=0.02, type="white", filt="bandpass", f0=2000, f1=2600, q=2, dur=0.05, g=0.08, atk=0.01)  # cylinder turning
    clack(v, at=0.085, f=2400, g=0.4, dur=0.008, decay=0.05)


@sound("revolver_open", 2, "mech", desc="cylinder swung out", tags=["mech", "revolver"])
def revolver_open(v, i):
    click(v, f=3000, g=0.3, dur=0.004)
    burst(v, at=0.02, type="white", filt="bandpass", f0=2200, f1=1800, q=1.5, dur=0.06, g=0.12, atk=0.01)
    clack(v, at=0.08, f=2200, g=0.4, dur=0.01, decay=0.06)
    metal_body(v, at=0.08, f=2000, g=0.15, t60=0.1, n=6)


@sound("revolver_close", 2, "mech", desc="cylinder snapped home", tags=["mech", "revolver"])
def revolver_close(v, i):
    burst(v, type="white", filt="bandpass", f0=1800, f1=2400, q=1.5, dur=0.05, g=0.1, atk=0.01)
    clack(v, at=0.05, f=2100, g=0.55, dur=0.012, decay=0.08)
    metal_body(v, at=0.05, f=1800, g=0.2, t60=0.12, n=7, thick=0.5)
    thump(v, at=0.05, f0=200, f1=120, dur=0.03, g=0.3)


@sound("revolver_eject", 2, "mech", desc="ejector rod: six empties tinkle out", tags=["mech", "revolver"])
def revolver_eject(v, i):
    clack(v, f=2400, g=0.3, dur=0.01, decay=0.05)
    tinkle(v, n=v.irnd(5, 7), at=0.03, span=0.25, f0=3800, f1=6500, dur=0.06, g=0.08)
    pulses(v, n=6, at=0.05, span=0.25, type="white", f0=3000, f1=5000, q=3, dur=0.005, g=0.12)


@sound("mag_load_round", 4, "mech", desc="one cartridge pressed down into a magazine against the spring", tags=["mech"])
def mag_load_round(v, i):
    burst(v, type="pink", filt="bandpass", f0=900, q=1, dur=0.03, g=0.15, atk=0.005)  # thumb pressure
    burst(v, at=0.008, type="white", filt="bandpass", f0=2600, f1=2000, q=2.5, dur=0.03, g=0.14, atk=0.004)  # brass sliding under the lips
    click(v, at=0.03, f=3200, g=0.4, q=4, dur=0.006)
    modal(v, at=0.03, freqs=[3600, 5100, 7200], t60s=[0.03, 0.025, 0.02], amps=[1, 0.5, 0.25], exc=0.001, g=0.14)
    if v.chance(0.5):
        tinkle(v, n=1, at=0.04, span=0.01, f0=4500, f1=6500, dur=0.03, g=0.04)


@sound("mag_unload_round", 3, "mech", desc="a round thumbed out of a magazine", tags=["mech"])
def mag_unload_round(v, i):
    click(v, f=3000, g=0.3, dur=0.005)
    burst(v, at=0.005, type="white", filt="bandpass", f0=2400, f1=3000, q=2.5, dur=0.025, g=0.12, atk=0.003)
    tinkle(v, n=1, at=0.03, span=0.01, f0=4200, f1=6000, dur=0.04, g=0.05)


@sound("weapon_draw", 3, "foley", desc="a weapon brought up: cloth, sling, a small metallic tick", tags=["foley"])
def weapon_draw(v, i):
    cloth(v, n=3, span=0.2, g=0.25)
    burst(v, at=0.05, type="pink", filt="bandpass", f0=600, q=1.0, dur=0.12, g=0.1, atk=0.03)
    clack(v, at=0.15, f=2600, g=0.22, dur=0.012, decay=0.06)
    if v.chance(0.6):
        rattle(v, at=0.1, n=2, span=0.08, freqs=[3000, 4500], g=0.05, t60=0.04)


@sound("weapon_holster", 3, "foley", desc="a weapon slung or holstered", tags=["foley"])
def weapon_holster(v, i):
    cloth(v, n=4, span=0.25, g=0.22)
    click(v, at=0.05, f=2600, g=0.15)
    burst(v, at=0.2, type="brown", filt="lowpass", f0=500, q=0.7, dur=0.05, g=0.3, atk=0.004)
    thump(v, at=0.2, f0=120, f1=80, dur=0.04, g=0.2)


@sound("ads_in", 3, "foley", desc="shouldering: cloth against the stock", tags=["foley"])
def ads_in(v, i):
    cloth(v, n=2, span=0.1, f=1800, g=0.18)
    burst(v, at=0.02, type="pink", filt="highpass", f0=1200, q=0.5, dur=0.15, g=0.05, atk=0.08)


@sound("ads_out", 3, "foley", desc="lowering from the sights", tags=["foley"])
def ads_out(v, i):
    cloth(v, n=2, span=0.1, f=1500, g=0.15, dur=0.08)


@sound("weapon_inspect", 2, "foley", desc="turning the weapon in the hands", tags=["foley"])
def weapon_inspect(v, i):
    cloth(v, n=4, span=0.5, g=0.14)
    rattle(v, at=0.2, n=3, span=0.15, freqs=[2800, 4200], g=0.05, t60=0.04)
    clack(v, at=0.45, f=2400, g=0.15, dur=0.01, decay=0.05)


@sound("grenade_pin", 2, "mech", desc="pin pulled: ring tick, then the spoon springs off with a ping", tags=["mech", "grenade"])
def grenade_pin(v, i):
    click(v, f=3400, g=0.35, dur=0.005)
    burst(v, at=0.005, type="white", filt="bandpass", f0=2800, f1=3600, q=2, dur=0.05, g=0.12, atk=0.005)
    modal(v, at=0.12, freqs=[2900, 4300, 6400, 8100], t60s=[0.25, 0.18, 0.1, 0.06], amps=[1, 0.6, 0.35, 0.2], exc=0.0012, g=0.3)  # spoon ping
    click(v, at=0.12, f=3800, g=0.3, dur=0.004)
    if v.chance(0.7):
        tinkle(v, n=2, at=0.2, span=0.15, f0=3000, f1=5000, dur=0.08, g=0.05)  # spoon lands


@sound("grenade_throw", 2, "foley", desc="the arm swing", tags=["foley", "grenade"])
def grenade_throw(v, i):
    whoosh(v, f0=500, f1=2200, q=1.0, dur=0.3, g=0.4, peak=0.55)
    cloth(v, n=3, span=0.2, g=0.15)
