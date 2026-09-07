"""Formant speech synthesis for the things in the zone that talk: mimics (garbled Russian radio chatter), phantoms
(whispers) and the player (breath, grunts). A glottal pulse source with jitter and shimmer drives four parallel
formant resonators whose centre frequencies follow phoneme targets with coarticulation; fricatives and plosives are
shaped noise. Phrases are written as phoneme lists (Russian fragments) with a stress pattern and a pitch contour.
"""
import numpy as np
from . import dsp
from .dsp import SR, sec

# formant targets (F1, F2, F3, F4) for a male voice, plus per-phoneme kind and default duration (s)
PH = {
    # vowels
    "a": dict(kind="v", f=(700, 1150, 2600, 3300), dur=0.13),
    "o": dict(kind="v", f=(480, 850, 2500, 3200), dur=0.12),
    "u": dict(kind="v", f=(320, 700, 2300, 3100), dur=0.12),
    "e": dict(kind="v", f=(500, 1750, 2500, 3300), dur=0.12),
    "i": dict(kind="v", f=(290, 2200, 2950, 3400), dur=0.11),
    "y": dict(kind="v", f=(360, 1450, 2350, 3200), dur=0.11),
    # sonorants
    "m": dict(kind="n", f=(250, 1000, 2200, 3000), dur=0.08),
    "n": dict(kind="n", f=(260, 1450, 2500, 3100), dur=0.08),
    "l": dict(kind="l", f=(360, 1250, 2700, 3300), dur=0.07),
    "r": dict(kind="r", f=(420, 1300, 2200, 3200), dur=0.07),
    "j": dict(kind="l", f=(280, 2100, 2900, 3400), dur=0.05),
    "v": dict(kind="vf", f=(300, 1100, 2300, 3200), dur=0.06, nf=(1500, 6000)),
    "z": dict(kind="vf", f=(300, 1600, 2500, 3200), dur=0.07, nf=(4500, 8500)),
    "zh": dict(kind="vf", f=(300, 1500, 2400, 3100), dur=0.08, nf=(2000, 4000)),
    # fricatives (noise only)
    "s": dict(kind="f", dur=0.09, nf=(5000, 9000)),
    "sh": dict(kind="f", dur=0.1, nf=(2200, 4500)),
    "kh": dict(kind="f", dur=0.08, nf=(900, 2400)),
    "f": dict(kind="f", dur=0.07, nf=(1800, 7000), g=0.5),
    "h": dict(kind="f", dur=0.05, nf=(600, 2000), g=0.4),
    # plosives: closure then burst
    "p": dict(kind="p", dur=0.06, bf=(500, 1500), voiced=False),
    "b": dict(kind="p", dur=0.05, bf=(400, 1200), voiced=True),
    "t": dict(kind="p", dur=0.06, bf=(3000, 5500), voiced=False),
    "d": dict(kind="p", dur=0.05, bf=(2500, 4500), voiced=True),
    "k": dict(kind="p", dur=0.07, bf=(1400, 3000), voiced=False),
    "g": dict(kind="p", dur=0.05, bf=(1200, 2600), voiced=True),
    "ts": dict(kind="a", dur=0.09, nf=(4500, 8500)),
    "ch": dict(kind="a", dur=0.09, nf=(2200, 4500)),
    # pause
    "_": dict(kind="_", dur=0.09),
    ",": dict(kind="_", dur=0.16),
}

# phrases: list of syllables, each a list of phonemes; the stressed syllable index; a rough translation for the manifest
PHRASES = {
    "priyom": (["p", "r", "i", "j", "o", "m"], [3], "over"),
    "vizhu_tsel": (["v", "i", "zh", "u", "_", "ts", "e", "l"], [0, 5], "target in sight"),
    "nazad": (["n", "a", "z", "a", "d", ",", "n", "a", "z", "a", "d"], [3, 9], "back, back"),
    "kontakt": (["k", "o", "n", "t", "a", "k", "t"], [4], "contact"),
    "ogon": (["a", "g", "o", "n", "j"], [2], "fire"),
    "chisto": (["ch", "i", "s", "t", "a"], [1], "clear"),
    "gde_on": (["g", "d", "e", "_", "o", "n"], [2, 4], "where is he"),
    "pomogi": (["p", "a", "m", "a", "g", "i", "_", "m", "n", "e"], [5, 9], "help me"),
    "oni_zdes": (["a", "n", "i", "_", "z", "d", "e", "s", "j"], [2, 6], "they are here"),
    "vtoroy": (["f", "t", "a", "r", "o", "j", ",", "a", "t", "v", "e", "t", "j"], [4, 10], "second, respond"),
    "ne_strelyai": (["n", "e", "_", "s", "t", "r", "e", "l", "j", "a", "j"], [9], "don't shoot"),
    "kholodno": (["kh", "o", "l", "a", "d", "n", "a"], [1], "it's cold"),
    "domoy": (["d", "a", "m", "o", "j"], [3], "home"),
    "idi_syuda": (["i", "d", "i", "_", "s", "j", "u", "d", "a"], [2, 6], "come here"),
    "tikho": (["t", "i", "kh", "a"], [1], "quiet"),
    "eto_ne_ya": (["e", "t", "a", "_", "n", "e", "_", "j", "a"], [0, 8], "this is not me"),
    "slyshish": (["s", "l", "y", "sh", "y", "sh", "_", "m", "i", "n", "j", "a"], [2, 8], "can you hear me"),
    "vsyo": (["f", "s", "j", "o", ",", "k", "a", "n", "e", "ts"], [3, 8], "that's it, the end"),
    "zdes_nikogo": (["z", "d", "e", "s", "j", "_", "n", "i", "k", "a", "v", "o"], [2, 11], "nobody here"),
    "on_ryadom": (["o", "n", "_", "r", "j", "a", "d", "a", "m"], [0, 5], "he is close"),
    "granata": (["g", "r", "a", "n", "a", "t", "a"], [4], "grenade"),
    "otkhodim": (["a", "t", "kh", "o", "d", "i", "m"], [3], "pull back"),
    "ranen": (["j", "a", "_", "r", "a", "n", "i", "n"], [1, 4], "I am hit"),
    "perezaryazhayu": (["p", "i", "r", "i", "z", "a", "r", "j", "a", "zh", "a", "j", "u"], [8], "reloading"),
}


def _smooth_track(vals: np.ndarray, n_total: int, blend: float) -> np.ndarray:
    return dsp.smooth(vals[:n_total], blend)


def speak(rng, phones, stress=(), pitch=118.0, speed=1.0, breathy=0.15, tense=0.5, whisper=False,
          contour="fall") -> np.ndarray:
    """Render a phoneme list to a dry voice signal. pitch in Hz (male ~100-140). whisper: noise source only."""
    # 1. timeline of phoneme segments with durations (stress lengthens the following vowel)
    segs = []
    for i, p in enumerate(phones):
        d = PH[p]["dur"] / speed * rng.uniform(0.85, 1.2)
        if i in stress and PH[p]["kind"] == "v":
            d *= 1.45
        segs.append((p, d))
    total = sum(d for _, d in segs) + 0.08
    n = sec(total)
    # 2. formant tracks, voicing, noise bands
    F = np.zeros((4, n)); Fw = np.zeros((4, n))
    voicing = np.zeros(n); nasal = np.zeros(n); noise_g = np.zeros(n); noise_lo = np.full(n, 2000.0); noise_hi = np.full(n, 4000.0)
    burst_g = np.zeros(n); trill = np.zeros(n)
    amp = np.zeros(n)
    t = 0.0
    last_f = np.array(PH["a"]["f"], dtype=float)
    for i, (p, d) in enumerate(segs):
        ph = PH[p]
        i0, i1 = sec(t), min(n, sec(t + d))
        m = i1 - i0
        if m <= 0:
            t += d; continue
        kind = ph["kind"]
        if "f" in ph:
            last_f = np.array(ph["f"], dtype=float)
        F[:, i0:i1] = last_f[:, None]
        stressed = i in stress
        a = 1.0 if stressed else 0.75
        if kind == "v":
            voicing[i0:i1] = 1.0; amp[i0:i1] = a
            noise_g[i0:i1] = breathy * 0.5
        elif kind == "n":
            voicing[i0:i1] = 1.0; amp[i0:i1] = a * 0.55; nasal[i0:i1] = 1.0
        elif kind == "l":
            voicing[i0:i1] = 1.0; amp[i0:i1] = a * 0.7
        elif kind == "r":
            voicing[i0:i1] = 1.0; amp[i0:i1] = a * 0.7; trill[i0:i1] = 1.0
        elif kind == "vf":
            voicing[i0:i1] = 1.0; amp[i0:i1] = a * 0.5
            noise_g[i0:i1] = 0.5; noise_lo[i0:i1], noise_hi[i0:i1] = ph["nf"]
        elif kind == "f":
            noise_g[i0:i1] = ph.get("g", 0.8); noise_lo[i0:i1], noise_hi[i0:i1] = ph["nf"]
            amp[i0:i1] = a
        elif kind == "a":  # affricate: closure, then fricative
            k = i0 + int(m * 0.35)
            noise_g[k:i1] = 0.85; noise_lo[k:i1], noise_hi[k:i1] = ph["nf"]; amp[k:i1] = a
        elif kind == "p":
            # closure (silence or voice bar), then a burst and aspiration
            k = i0 + int(m * 0.6)
            if ph["voiced"]:
                voicing[i0:k] = 1.0; amp[i0:k] = 0.15
            bl = min(i1, k + sec(0.012))
            burst_g[k:bl] = 1.0; noise_lo[k:i1], noise_hi[k:i1] = ph["bf"]
            noise_g[bl:i1] = 0.35 if not ph["voiced"] else 0.15
            amp[k:i1] = a
        elif kind == "_":
            pass
        t += d
    # coarticulation: smooth formant tracks (~35 ms) and amplitude (~12 ms)
    for k in range(4):
        F[k] = dsp.smooth(F[k], 0.035)
    amp = dsp.smooth(amp, 0.012)
    voicing = dsp.smooth(voicing, 0.01)
    noise_g = dsp.smooth(noise_g, 0.008)
    nasal = dsp.smooth(nasal, 0.02)
    # 3. pitch contour: declination + stress bumps + jitter
    tt = np.arange(n) / SR
    if contour == "fall":
        f0 = pitch * (1.12 - 0.22 * tt / total)
    elif contour == "rise":
        f0 = pitch * (0.95 + 0.25 * tt / total)
    elif contour == "scream":
        f0 = pitch * (1.0 + 0.6 * np.sin(np.pi * tt / total))
    else:
        f0 = np.full(n, pitch)
    bump = np.zeros(n)
    t = 0.0
    for i, (p, d) in enumerate(segs):
        if i in stress:
            i0, i1 = sec(t), min(n, sec(t + d))
            bump[i0:i1] = 1.0
        t += d
    f0 = f0 * (1.0 + 0.12 * dsp.smooth(bump, 0.05))
    # 4. sources
    if whisper:
        src = np.zeros(n)
    else:
        src = dsp.osc(n, f0, "pulse", rng=rng, jitter=0.012)
        # shimmer + a little turbulence in the glottal flow
        src *= (1.0 + 0.08 * dsp.smooth(rng.standard_normal(n), 0.004))
        src = dsp.onepole_lp(src, 1800.0 + 2200.0 * tense)
        src *= voicing
    asp = dsp.white(rng, n)
    frication = dsp.biquad(asp, "bandpass", (noise_lo + noise_hi) * 0.5, 0.9) * noise_g
    aspir = dsp.highpass(asp, 900.0) * (breathy * voicing * 0.4 + (0.6 if whisper else 0.0) * amp)
    bursts = dsp.biquad(asp, "bandpass", (noise_lo + noise_hi) * 0.5, 1.2) * burst_g * 2.5
    # 5. formant filter bank (parallel), applied to voiced+aspiration; frication bypasses the tract mostly
    tract_in = src + aspir
    out = np.zeros(n)
    bw = np.array([70.0, 110.0, 160.0, 220.0])
    gains = np.array([1.0, 0.7, 0.35, 0.18])
    for k in range(4):
        fk = F[k] * (1.0 - 0.15 * nasal if k == 1 else 1.0)
        q = np.clip(fk / bw[k], 2.0, 20.0)
        # block-wise q is fixed per formant; use mean q
        y = dsp.biquad(tract_in, "bandpass", fk, float(np.mean(q)))
        out += y * gains[k] * (1.0 - 0.5 * nasal if k >= 2 else 1.0)
    out += dsp.biquad(tract_in, "lowpass", np.full(n, 300.0), 0.7) * 0.25 * nasal  # nasal murmur
    if np.any(trill > 0):
        out *= (1.0 - 0.6 * trill * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 27.0 * tt))))
    out = out * amp + frication * amp * 0.5 + bursts * 0.6
    out = dsp.highpass(out, 60.0)
    return out / (np.max(np.abs(out)) + 1e-9)


def radio(x: np.ndarray, rng, drive: float = 4.0, bits: float = 7.0, band=(320.0, 3200.0), hum: float = 0.12,
          static: float = 0.08, dropouts: int = 1, squelch: bool = True) -> np.ndarray:
    """The handset chain: band-limit, saturate, crush, mains hum AM, static bed, dropouts, squelch open/close."""
    n = len(x)
    y = dsp.highpass(x, band[0], 0.8)
    y = dsp.lowpass(y, band[1], 0.9)
    y = dsp.biquad(y, "peak", 1700.0, 1.2) * 0.7  # handset speaker presence
    y = dsp.saturate(y, drive)
    y = dsp.bitcrush(y, bits)
    tt = np.arange(n) / SR
    y *= (1.0 - hum + hum * np.sin(2 * np.pi * rng.uniform(48, 54) * tt))
    for _ in range(dropouts):
        if rng.random() < 0.7:
            i0 = int(rng.uniform(0.1, 0.8) * n); m = sec(rng.uniform(0.02, 0.07))
            y[i0:i0 + m] *= np.linspace(1, 0.05, min(m, n - i0))
    st = dsp.highpass(dsp.white(rng, n + sec(0.25)), 2500.0, 0.5) * static
    st += dsp.crackle(rng, n + sec(0.25), 300.0) * static * 0.6
    y = dsp.mix_into(st, y, sec(0.03))
    if squelch:
        k = sec(0.04)
        open_ = dsp.bandpass(dsp.white(rng, k), 2500.0, 1.0) * dsp.env(k, 0.001, 0, curve="exp") * 0.5
        y = dsp.mix_into(y, open_, 0)
        close = dsp.bandpass(dsp.white(rng, k), 2000.0, 1.0) * dsp.env(k, 0.001, 0, curve="exp") * 0.4
        tone_ = dsp.osc(sec(0.06), dsp.sweep(sec(0.06), 2400.0, 600.0), "sine") * dsp.env(sec(0.06), 0.002, 0) * 0.12
        y = dsp.mix_into(y, close + dsp.pad_to(tone_, k)[:k], n + sec(0.06))
    return dsp.fade(y, 0.002, 0.03)


def mimic_process(x: np.ndarray, rng, detune: float = 0.03, reverse_tail: bool = True, ringmod: float = 0.0,
                  echo: float = 0.0) -> np.ndarray:
    """What makes a mimic's voice wrong: doubled/detuned copies, a reversed tail, sometimes a low ring modulation."""
    n = len(x)
    y = x.copy()
    d1 = dsp.resample_rate(x, 1.0 + detune)
    d2 = dsp.resample_rate(x, 1.0 - detune * 0.8)
    y = dsp.mix_into(y, d1, sec(rng.uniform(0.012, 0.03)), 0.55)
    y = dsp.mix_into(y, d2, sec(rng.uniform(0.02, 0.045)), 0.45)
    if ringmod > 0:
        tt = np.arange(len(y)) / SR
        y *= (1 - ringmod) + ringmod * np.sin(2 * np.pi * rng.uniform(28, 70) * tt)
    if reverse_tail:
        k = min(len(y), sec(rng.uniform(0.18, 0.4)))
        seg = y[len(y) - k:][::-1] * dsp.env(k, 0.01, 0, curve="exp")[::-1] * 0.7
        y = dsp.mix_into(y, seg, len(y) - int(k * 0.4))
    if echo > 0:
        y = dsp.mix_into(y, dsp.lowpass(y, 1500.0) * echo, sec(0.11))
    return y / (np.max(np.abs(y)) + 1e-9)


def vocal(rng, phones, stress=(), pitch=118.0, speed=1.0, breathy=0.15, tense=0.5, contour="fall") -> np.ndarray:
    return speak(rng, phones, stress, pitch, speed, breathy, tense, False, contour)


def scream(rng, dur: float = 0.8, pitch: float = 240.0, vowel: str = "a", rasp: float = 0.6, contour="scream") -> np.ndarray:
    n = sec(dur)
    tt = np.arange(n) / SR
    if contour == "scream":
        f0 = pitch * (0.85 + 0.5 * np.sin(np.pi * tt / dur) ** 0.7)
    elif contour == "fall":
        f0 = pitch * (1.2 - 0.6 * tt / dur)
    else:
        f0 = np.full(n, pitch)
    src = dsp.osc(n, f0, "pulse", rng=rng, jitter=0.03)
    # subharmonic rasp / vocal fry: half-rate pulse mixed in
    src += rasp * dsp.osc(n, f0 * 0.5, "pulse", rng=rng, jitter=0.05) * np.sin(2 * np.pi * 7.0 * tt) ** 2
    src *= 1.0 + 0.2 * dsp.smooth(rng.standard_normal(n), 0.003)
    fv = np.array(PH[vowel]["f"], dtype=float) * 1.12  # screams push formants up
    out = np.zeros(n)
    for k, (f, bw, g) in enumerate(zip(fv, [90, 130, 180, 240], [1.0, 0.8, 0.45, 0.25])):
        out += dsp.bandpass(src, f, float(np.clip(f / bw, 2, 18))) * g
    out += dsp.highpass(dsp.white(rng, n), 1200.0) * 0.25 * rasp
    e = dsp.env(n, 0.03, dur * 0.55, curve="cos", hold_level=1.0)
    out = dsp.saturate(out * e, 3.0)
    return out / (np.max(np.abs(out)) + 1e-9)
