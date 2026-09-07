"""Imports every recipe module (which registers its sounds) and builds the manifest that documents the naming."""
import importlib
import json
import os
from . import registry

MODULES = ["recipes_weapons", "recipes_impacts", "recipes_foley", "recipes_world", "recipes_anomalies", "recipes_creatures", "recipes_ui"]
LOADED = []
for _m in MODULES:
    try:
        importlib.import_module("sfxgen." + _m)
        LOADED.append(_m)
    except ModuleNotFoundError as e:  # a module not written yet
        if ("sfxgen." + _m) not in str(e):
            raise

REG = registry.REG
ALIASES = registry.ALIASES

SURFACES = ["grass", "dirt", "mud", "gravel", "rock", "road", "concrete", "wood", "metal", "water", "sand", "snow"]
IMPACT_SURFACES = ["dirt", "gravel", "concrete", "brick", "metal", "metal_thick", "wood", "water", "flesh", "glass", "ash", "mud", "sand"]


def weapon_map() -> dict:
    from . import recipes_weapons as rw
    out = {}
    for wid, w in rw.WEAPONS.items():
        fam = rw.FAMILY_MECH.get(w["family"], "ak")
        mech_fam = {"pistol": "pistol", "smg": "smg", "ak": "ak", "ar": "ar", "sks": "sks", "svd": "svd", "vss": "vss", "shotgun_semi": "shotgun", "pkm": "pkm",
                    "manual": {"toz": "break", "rem870": "pump", "mosin": "bolt", "sv98": "bolt", "obrez": "bolt"}.get(wid, "bolt")}[fam]
        mech = {}
        if mech_fam == "break":
            mech = {"open": "break_open", "close": "break_close", "load": "shell_insert", "dry": "dry_click_rifle"}
        elif mech_fam == "pump":
            mech = {"cycle": "shotgun_pump", "back": "pump_back", "forward": "pump_forward", "load": "shell_insert", "dry": "dry_click_rifle"}
        elif mech_fam == "bolt":
            mech = {"open": "bolt_open", "close": "bolt_close", "clip": "clip_load", "load": "mag_load_round", "dry": "dry_click_rifle"}
        else:
            mech = {"mag_out": "mag_out_%s" % mech_fam, "mag_in": "mag_in_%s" % mech_fam, "bolt_back": "bolt_back_%s" % mech_fam,
                    "bolt_forward": "bolt_forward_%s" % mech_fam, "rack": "rack_%s" % mech_fam, "load": "mag_load_round",
                    "dry": "dry_click" if mech_fam in ("pistol", "smg") else "dry_click_rifle"}
            if mech_fam == "pkm":
                mech.update({"belt_open": "belt_open_pkm", "belt_load": "belt_load_pkm", "belt_close": "belt_close_pkm"})
            if mech_fam == "sks":
                mech["clip"] = "clip_load"
            if mech_fam == "pistol":
                mech["slide_release"] = "slide_release_pistol"
            if mech_fam == "ar":
                mech["bolt_release"] = "bolt_release_ar"
        out[wid] = {
            "name": w["name"], "class": w["cls"], "cal": w["cal"], "family": w["family"],
            "fire": "fire_%s" % wid, "fire_sup": "fire_%s_sup" % wid, "fire_far": "fire_%s_far" % wid,
            "class_fallback": "fire_%s" % w["cls"], "integral_suppressor": wid in rw.INTEGRAL_SUPPRESSED,
            "casing": "shell" if w["cal"] == "12ga" else ("casing_rifle" if w["cls"] in ("rifle", "sniper", "mg") else "casing"),
            "mech": mech,
        }
    return out


def manifest(written: dict, alias_copies: bool) -> dict:
    sounds = {}
    for name, e in sorted(REG.items()):
        files = written.get(name, [])
        sounds[name] = {"variants": e.variants, "files": files, "category": e.cat, "loop": e.loop, "stereo": e.stereo,
                        "peak_db": e.peak_db, "desc": e.desc, "tags": e.tags}
    return {
        "version": 2,
        "sample_rate": 44100, "format": "ogg vorbis, compression_level 0.5 (~q0.45), mono unless stereo=true",
        "resolution": "Audio.play(name) loads assets/audio/<name>.ogg or <name>_1.ogg.._4.ogg (max 4 variants per name)",
        "conventions": {
            "fire": "fire_<weapon_id> (3 variants, outdoor field tail baked in), fire_<weapon_id>_sup (suppressed), fire_<weapon_id>_far (heard from CAL.far metres)",
            "fire_fallback": "fire_<class> for pistol smg rifle shotgun sniper mg revolver; fire_<family> for 9x18 9x19 357 ak545 ak762 ar556 12ga_pump 12ga_semi bolt_762x54 dmr lmg smg_9x18 smg_9x19 vss sks; each with _sup and _far; fire_<class>_indoor for a concrete room",
            "mech": "mag_out_<fam> mag_in_<fam> bolt_back_<fam> bolt_forward_<fam> rack_<fam> with fam in pistol smg ak ar svd vss sks shotgun pkm; bolt_open/bolt_close (bolt-actions), pump_back/pump_forward/shotgun_pump, shell_insert, break_open/break_close, clip_load, belt_open_pkm/belt_load_pkm/belt_close_pkm, safety_click, safety_ak, fire_selector, dry_click, dry_click_rifle, jam, unjam, cock_revolver, revolver_open/close/eject, mag_load_round, mag_unload_round",
            "casings": "casing_<surface> (brass pistol/rifle), casing_rifle_<surface> (steel rifle cases), shell_<surface> (12 ga hulls); surface in concrete dirt wood metal",
            "impacts": "impact_<surface> for %s; ricochet, bullet_crack (supersonic snap), bullet_whiz (subsonic), hit_helmet, hit_armor" % " ".join(IMPACT_SURFACES),
            "steps": "step_<surface>, step_<surface>_sprint, step_<surface>_crouch (4 variants) for %s; land, land_<surface>, jump" % " ".join(SURFACES),
            "loops": "entries with loop=true are seamless (crossfaded) and meant for Audio.loop(); set AudioStreamOggVorbis.loop = true at runtime",
            "voices": "mimic_radio/mimic_chatter/mimic_alert (phrases), mimic_scream, mimic_pain, mimic_death, mimic_spot, mimic_hunt, phantom_whisper, phantom_scream",
        },
        "aliases": {k: dict(v, copied=alias_copies) for k, v in ALIASES.items()},
        "weapons": weapon_map(),
        "surfaces": SURFACES, "impact_surfaces": IMPACT_SURFACES,
        "count": len(sounds),
        "sounds": sounds,
    }
