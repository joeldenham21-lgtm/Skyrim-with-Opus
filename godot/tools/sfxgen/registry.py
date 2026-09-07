"""The sound registry: every name the game can ask for, with its recipe, variant count, category and level target."""
from dataclasses import dataclass, field
from typing import Callable, Optional

# peak targets (dBFS) by category; foley sits well below gunshots so the mixer has headroom
PEAK = {
    "gun": -1.0, "gun_sup": -4.0, "gun_far": -6.0, "explosion": -1.0, "impact": -6.0, "mech": -9.0, "casing": -14.0,
    "step": -12.0, "foley": -11.0, "ui": -14.0, "creature": -5.0, "voice": -5.0, "anomaly": -8.0, "loop": -12.0,
    "world": -9.0, "tide": -4.0, "ambience": -14.0,
}


@dataclass
class Entry:
    name: str
    fn: Callable
    variants: int = 3
    cat: str = "foley"
    peak: Optional[float] = None
    loop: bool = False
    stereo: bool = False
    sat: float = 0.0            # analog saturation drive applied to the sum (0 = none)
    trim_db: float = -70.0
    desc: str = ""
    fade_out: float = 0.02
    tags: list = field(default_factory=list)

    @property
    def peak_db(self) -> float:
        return PEAK.get(self.cat, -10.0) if self.peak is None else self.peak


REG: dict = {}
ALIASES: dict = {}


def sound(name: str, variants: int = 3, cat: str = "foley", peak: float = None, loop: bool = False, stereo: bool = False,
          sat: float = 0.0, desc: str = "", fade_out: float = 0.02, tags=None):
    """Decorator registering fn(v: Voice, i: int) -> ndarray | None under `name`."""
    def deco(fn):
        REG[name] = Entry(name, fn, variants, cat, peak, loop, stereo, sat, -70.0, desc, fade_out, tags or [])
        return fn
    return deco


def define(name: str, fn: Callable, **kw):
    REG[name] = Entry(name, fn, kw.get("variants", 3), kw.get("cat", "foley"), kw.get("peak"), kw.get("loop", False),
                      kw.get("stereo", False), kw.get("sat", 0.0), -70.0, kw.get("desc", ""), kw.get("fade_out", 0.02), kw.get("tags", []))


def alias(name: str, target: str, note: str = ""):
    """Names the game may ask for that resolve to another file set (documented in the manifest; Audio.gd has no alias
    table yet, so gen_sfx writes real copies for these unless --no-alias-copies).
    A self-alias (name == target) is a no-op: the generated loops that build alias tables from id lists can land on a
    name that is already its own recipe, and listing it as an alias would make it appear twice in the manifest."""
    if name == target:
        return
    ALIASES[name] = {"to": target, "note": note}
