// RADIUS — the score.
//
// Everything here is synthesised. There are no samples. The exploration music is a real plucked
// acoustic guitar built with an extended Karplus-Strong string: a shaped excitation is injected into
// a delay line of length sampleRate/f0 whose feedback path carries a one-pole loss filter (the
// string's frequency-dependent damping), a first-order allpass (stiffness, which stretches the
// partials the way a wound string does) and a loop gain derived from a target T60. Two slightly
// detuned copies model the string's two polarisations, which is where the beating and the long tail
// come from. That raw string is a bare wire; the wooden box is a series of peaking biquads tuned to
// the air (Helmholtz) resonance and the top/back plate modes, and the room is a Schroeder network of
// four damped combs and two allpasses. Pick noise, fret clicks and wound-string squeaks are their own
// little noise voices.
//
// The combat music is bowed, not hit: sawtooth oscillators (a bowed string's bridge force IS a
// sawtooth — Helmholtz motion) with vibrato, bow-hair noise and cello body formants, voiced as a
// semitone/tritone cluster. The drive comes from a pizzicato bass ostinato (the same string model,
// heavily damped) doubled by a sub, not from a drum kit. Percussion, where it exists, is a felt low
// hit, a rattle and a scrape.
//
// The two are one instrument: the Director's state and tension thin the guitar out, bring the bowed
// cluster in underneath it, and hand it back after a real comedown.
//
// Timing lives on the audio clock, never on dt: update() only pushes fades and refills a scheduling
// horizon, so a starved main loop stretches the frame rate, not the music.
import { clamp, clamp01, lerp } from '../core/math.js';

// ============================================================================================
// 1. The string. Pure DSP: no AudioContext, no browser. Exported so it can be measured offline.
// ============================================================================================

// phase delay (in samples) of the one-pole loss filter y = (1-b)x + b*y1 at angular frequency w
const phaseDelayLP = (b, w) => (b <= 1e-6 ? 0 : Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w);
// phase delay of the first-order allpass H(z) = (a + z^-1) / (1 + a z^-1)
function phaseDelayAP(a, w) {
  if (Math.abs(a) <= 1e-6) return 1;
  const cw = Math.cos(w), sw = Math.sin(w);
  return -(Math.atan2(-sw, a + cw) - Math.atan2(-a * sw, 1 + a * cw)) / w;
}

export const STRING_DEFAULTS = {
  decay: 3.4,        // T60 at the fundamental, seconds
  damp: 0.38,        // loop loss-filter coefficient: how fast the high partials die (0..0.7)
  stiff: 0.06,       // loop allpass coefficient: inharmonicity / "clang" of a wound string
  bright: 0.6,       // spectrum of the excitation (0 = thumb, 1 = fingernail near the bridge)
  pick: 0.14,        // pick position along the string (0..0.5); nulls every 1/pick'th partial
  noise: 0.4,        // how much of the excitation is scrape rather than displacement
  detune: 0.0009,    // second polarisation offset (fraction of f0)
  poly: 0.42,        // level of the second polarisation
  polyDecay: 2.1,    // its T60 multiplier — the slow tail
  maxDur: 4.6,
  seed: 0,
};

// A tiny deterministic RNG so a rendered note can be reproduced exactly when measuring it.
function rng32(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One Karplus-Strong polarisation, summed into `out`.
function ksInto(out, sampleRate, f0, p, amp, decay, rand) {
  const n = out.length;
  const w = (2 * Math.PI * f0) / sampleRate;
  const b = clamp(p.damp, 0, 0.85);
  const a = clamp(p.stiff, 0, 0.5);
  let D = sampleRate / f0 - phaseDelayLP(b, w) - phaseDelayAP(a, w);
  if (D < 3) D = 3;
  const Di = Math.floor(D), frac = D - Di;
  const size = Di + 4;
  const line = new Float32Array(size);

  // --- excitation: the string's initial shape, plus the noise of the finger leaving it.
  // A string pulled aside at `pick` and released holds a triangular displacement; its harmonic
  // amplitudes fall as 1/n^2 with nulls at every (1/pick)'th partial. That single fact is most of
  // why a pluck near the bridge is nasal and one over the soundhole is round.
  const exLen = Math.min(size, Math.max(8, Math.round(sampleRate / f0)));
  const pick = clamp(p.pick, 0.04, 0.5);
  const exDamp = clamp(1 - p.bright, 0.02, 0.95);   // one-pole on the scrape noise
  let lp = 0, mean = 0;
  const combOff = Math.max(1, Math.round(pick * exLen));
  for (let i = 0; i < exLen; i++) {
    const x = i / exLen;
    const tri = x < pick ? x / pick : (1 - x) / (1 - pick);
    lp += ((rand() * 2 - 1) - lp) * (1 - exDamp);
    const v = tri * (1 - p.noise) + lp * p.noise * (0.35 + 0.65 * tri);
    line[i] = v; mean += v;
  }
  mean /= exLen;
  for (let i = 0; i < exLen; i++) line[i] -= mean;
  // comb the scrape at the pick point too, so the nulls are consistent across the whole excitation
  for (let i = exLen - 1; i >= combOff; i--) line[i] -= 0.55 * line[i - combOff];

  // --- circulate
  const rho = Math.pow(10, -3 / (f0 * Math.max(0.05, decay)));
  let lpS = 0, apX = 0, apY = 0, dcX = 0, dcY = 0;
  const dcC = 1 - 6.5 / sampleRate;   // ~25 Hz DC blocker
  let wi = 0;
  for (let i = 0; i < n; i++) {
    let r0 = wi - Di; if (r0 < 0) r0 += size;
    let r1 = r0 - 1; if (r1 < 0) r1 += size;
    const s = line[r0] * (1 - frac) + line[r1] * frac;
    lpS = (1 - b) * s + b * lpS;
    const y = a * lpS + apX - a * apY; apX = lpS; apY = y;
    line[wi] = y * rho;
    wi++; if (wi >= size) wi = 0;
    // DC block the tap so a triangular initial condition does not park the whole note off zero
    dcY = s - dcX + dcC * dcY; dcX = s;
    out[i] += dcY * amp;
  }
}

// Render one plucked note. Returns a Float32Array normalised to a peak of 1.
export function renderString(sampleRate, f0, opts = {}) {
  const p = Object.assign({}, STRING_DEFAULTS, opts);
  const dur = Math.min(p.maxDur, Math.max(0.25, p.dur ?? p.decay * 1.05 + 0.12));
  const n = Math.max(64, Math.floor(sampleRate * dur));
  const out = new Float32Array(n);
  const rand = rng32(p.seed || (Math.random() * 1e9) | 0);
  ksInto(out, sampleRate, f0, p, 1, p.decay, rand);
  if (p.poly > 0.001) {
    const q = Object.assign({}, p, { damp: Math.min(0.85, p.damp + 0.06), pick: clamp(p.pick * 1.13, 0.04, 0.5) });
    ksInto(out, sampleRate, f0 * (1 + p.detune), q, p.poly, p.decay * p.polyDecay, rand);
  }
  // tail fade so the buffer never ends on a step
  const fade = Math.min(n >> 2, Math.floor(sampleRate * 0.09));
  for (let i = 0; i < fade; i++) { const g = i / fade; out[n - 1 - i] *= g * g; }
  let peak = 0;
  for (let i = 0; i < n; i++) { const m = out[i] < 0 ? -out[i] : out[i]; if (m > peak) peak = m; }
  if (peak > 1e-6) { const k = 1 / peak; for (let i = 0; i < n; i++) out[i] *= k; }
  return out;
}

// ============================================================================================
// 2. Graph helpers. Every builder takes an AudioContext so the same code renders offline.
// ============================================================================================
const NOISE = new WeakMap();
function noiseBuffer(ac, seconds = 2.2) {
  let b = NOISE.get(ac); if (b) return b;
  const n = Math.floor(ac.sampleRate * seconds);
  b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  NOISE.set(ac, b); return b;
}
const G = (ac, v = 1) => { const g = ac.createGain(); g.gain.value = v; return g; };
const F = (ac, type, f, q = 0.7, gain) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (gain !== undefined) b.gain.value = gain; return b; };
const O = (ac, type, f, det = 0) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; return o; };
const P = (ac, pan = 0) => { if (!ac.createStereoPanner) return null; const p = ac.createStereoPanner(); p.pan.value = pan; return p; };
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// piecewise linear envelope: pts = [[dt, value], ...] relative to t
function env(param, t, pts) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(pts[0][1], t);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
}

// Schroeder reverb: four damped comb filters into two allpasses, pseudo-stereo at the output.
// A convolver would be prettier but this costs a handful of nodes and never starves the audio thread.
//
// Two traps, both measured rather than guessed. (1) BiquadFilterNode's Q is in DECIBELS for lowpass
// and highpass (it is a linear Q only for bandpass/notch/allpass/peaking). A "gentle" Q of 0.4 is a
// linear Q of 1.047 with a +1.5 dB resonant peak, and 0.927 comb feedback times 1.19 is a loop gain
// of 1.10: the tail grew 950x in four seconds and took the whole guitar with it. Damping filters
// inside a feedback loop must be overdamped (Q_dB <= -3) and the loop must keep a margin.
// (2) A Schroeder allpass takes its feedforward tap from the SUM node, not from the input; tapping
// the input gives ((1+g^2)z^-D - g)/(1 - g z^-D), which has up to +8 dB of gain and is not allpass.
const APQ = -6;      // dB: an overdamped, strictly non-resonant lowpass
export function buildReverb(ac, o = {}) {
  const rt = o.rt ?? 3.2, dampF = o.damp ?? 3000;
  const input = G(ac, 1), output = G(ac, o.gain ?? 0.85);
  const pre = ac.createDelay(0.25); pre.delayTime.value = o.pre ?? 0.026;
  input.connect(pre);
  const sum = G(ac, 0.2);
  for (const d of o.combs ?? [0.0297, 0.0371, 0.0411, 0.0437, 0.0491, 0.0533]) {
    const dl = ac.createDelay(0.6); dl.delayTime.value = d;
    const fb = G(ac, Math.min(0.91, Math.pow(10, (-3 * d) / rt) * 0.96));
    const lp = F(ac, 'lowpass', dampF, APQ);
    pre.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); dl.connect(sum);
  }
  const allpass = (src, d, g) => {
    const dl = ac.createDelay(0.1); dl.delayTime.value = d;
    const fb = G(ac, g), ff = G(ac, -g), mid = G(ac, 1), out = G(ac, 1);
    src.connect(mid);
    mid.connect(dl); mid.connect(ff); ff.connect(out);
    dl.connect(out); dl.connect(fb); fb.connect(mid);
    return out;
  };
  let node = sum;
  for (const [d, g] of [[0.0053, 0.7], [0.0037, 0.65]]) node = allpass(node, d, g);
  const hp = F(ac, 'highpass', 140, APQ);
  node.connect(hp);
  // stereo: the right channel is the same tail through one more, differently sized allpass, which
  // decorrelates it without the fixed comb a plain 17 ms offset would leave when summed to mono.
  const merger = ac.createChannelMerger(2);
  hp.connect(merger, 0, 0);
  allpass(hp, 0.0071, 0.62).connect(merger, 0, 1);
  merger.connect(output);
  return { input, output };
}

// ============================================================================================
// 3. The guitar rig
// ============================================================================================
// Drop-D: the low string tuned down a tone so the open D can drone under everything in D minor.
export const TUNING = [38, 45, 50, 55, 59, 64];      // D2 A2 D3 G3 B3 E4
// Per-string character: the low strings are wound (dull, stiff, long), the trebles plain.
// `dur` is where the buffer is cut: at the string's measured -13 to -25 dB/s that is 30-40 dB down,
// under the reverb tail, and it is what keeps the note cache inside ~16 MB rather than 60.
const STRINGS = [
  { damp: 0.42, stiff: 0.115, decay: 5.2, bright: 0.56, pick: 0.125, noise: 0.34, wound: 1.0, pan: -0.34, lvl: 1.00, dur: 3.4 },
  { damp: 0.41, stiff: 0.095, decay: 4.8, bright: 0.58, pick: 0.130, noise: 0.35, wound: 1.0, pan: -0.22, lvl: 0.98, dur: 3.2 },
  { damp: 0.38, stiff: 0.070, decay: 4.3, bright: 0.62, pick: 0.135, noise: 0.36, wound: 0.9, pan: -0.09, lvl: 0.95, dur: 2.6 },
  { damp: 0.34, stiff: 0.040, decay: 3.7, bright: 0.68, pick: 0.145, noise: 0.40, wound: 0.4, pan: 0.09, lvl: 0.92, dur: 2.2 },
  { damp: 0.30, stiff: 0.022, decay: 3.1, bright: 0.75, pick: 0.155, noise: 0.44, wound: 0.1, pan: 0.22, lvl: 0.88, dur: 1.9 },
  { damp: 0.27, stiff: 0.016, decay: 2.7, bright: 0.82, pick: 0.165, noise: 0.46, wound: 0.1, pan: 0.34, lvl: 0.84, dur: 1.7 },
];

export function buildGuitar(ac, dest, o = {}) {
  const sr = ac.sampleRate;
  const out = G(ac, o.gain ?? 1);
  const dry = G(ac, 1);
  // The soundbox. Air resonance ~100 Hz, top plate ~195 Hz, back/second top ~385 Hz, the scoop
  // around 640 Hz that stops a guitar sounding like a box, presence at 1.2k and 2.6k, and the
  // lowpass that keeps the string's fizz where a microphone a metre away would find it.
  const chain = [
    F(ac, 'highpass', 74, -3),
    F(ac, 'peaking', 102, 1.1, 6.0),
    F(ac, 'peaking', 196, 1.5, 3.6),
    F(ac, 'peaking', 385, 2.1, 2.6),
    F(ac, 'peaking', 640, 1.3, -3.2),
    F(ac, 'peaking', 1220, 1.7, 2.2),
    F(ac, 'peaking', 2650, 1.0, 1.8),
    F(ac, 'lowpass', 7400, -3),
  ];
  const input = G(ac, 1);
  let n = input;
  for (const f of chain) { n.connect(f); n = f; }
  n.connect(dry); dry.connect(out);
  const verb = buildReverb(ac, { rt: o.rt ?? 2.7, damp: 2600, gain: 0.9 });
  const send = G(ac, o.verb ?? 0.30);
  n.connect(send); send.connect(verb.input); verb.output.connect(out);
  out.connect(dest);

  const nb = noiseBuffer(ac);
  const cache = new Map();
  const voices = new Array(6).fill(null);
  const live = new Set();
  let renders = 0, clock = 0;

  function buffer(f0, s, variant, durCap) {
    const key = s.i + '|' + Math.round(f0 * 4) + '|' + variant;
    let e = cache.get(key);
    if (e) { e.t = ++clock; return e.buf; }
    const decay = Math.min(durCap, s.decay * lerp(1.15, 0.72, clamp01((f0 - 70) / 340)));
    const data = renderString(sr, f0, {
      decay, damp: s.damp, stiff: s.stiff, bright: s.bright * rnd(0.94, 1.07),
      pick: s.pick * rnd(0.85, 1.2), noise: s.noise, maxDur: durCap,
      detune: 0.0006 + Math.random() * 0.0008, poly: 0.42, polyDecay: 2.0,
    });
    const buf = ac.createBuffer(1, data.length, sr);
    buf.copyToChannel ? buf.copyToChannel(data, 0) : buf.getChannelData(0).set(data);
    e = { buf, t: ++clock };
    cache.set(key, e);
    renders++;
    if (cache.size > 44) { let oldest = null, ot = Infinity; for (const [k, v] of cache) if (v.t < ot) { ot = v.t; oldest = k; } cache.delete(oldest); }
    return buf;
  }

  // A plucked note. `si` is the string index, `midi` the sounding pitch (fret = midi - open).
  function pluck(t, si, midi, vel = 0.7, opt = {}) {
    si = clamp(si | 0, 0, 5);
    const s = STRINGS[si]; s.i = si;
    const f0 = mtof(midi) * Math.pow(2, (opt.cents ?? 0) / 1200);
    if (f0 < 40 || f0 > 2000) return null;
    const durCap = opt.dur ?? s.dur;
    const buf = buffer(f0, s, si < 2 ? (Math.random() * 2) | 0 : 0, durCap);
    const src = ac.createBufferSource(); src.buffer = buf;
    const rate = Math.pow(2, rnd(-4, 4) / 1200);
    src.playbackRate.value = rate;
    // a slide: the note starts a fret or two low and the hand arrives. Ramping playbackRate is
    // exactly what a finger moving along a string does to the speaking length.
    if (opt.slide) {
      src.playbackRate.setValueAtTime(rate * Math.pow(2, -opt.slide / 1200), t);
      src.playbackRate.linearRampToValueAtTime(rate, t + (opt.slideT ?? 0.1));
    }
    // dynamics: a harder pluck is brighter, not just louder
    const tone = F(ac, 'lowpass', lerp(1500, 8600, Math.pow(clamp01(vel), 0.6)), -1);
    const g = G(ac, 0);
    const pan = P(ac, clamp(s.pan + rnd(-0.06, 0.06), -1, 1));
    src.connect(tone); tone.connect(g);
    if (pan) { g.connect(pan); pan.connect(input); } else g.connect(input);
    const amp = vel * s.lvl * (opt.amp ?? 1) * 0.82;
    g.gain.setValueAtTime(amp, t);
    src.start(t);
    const ends = t + buf.duration + 0.1;
    try { src.stop(ends); } catch { /* already scheduled */ }
    const voice = { g, t, ends, si };
    live.add(voice);
    src.onended = () => { live.delete(voice); try { src.disconnect(); tone.disconnect(); g.disconnect(); pan && pan.disconnect(); } catch { /* gone */ } };
    // re-plucking a string kills whatever it was ringing: a guitar has six strings, not six voices per string
    const prev = voices[si];
    if (prev && prev.ends > t) {
      const t2 = Math.max(t - 0.004, ac.currentTime);
      prev.g.gain.cancelScheduledValues(t2);
      prev.g.gain.setValueAtTime(prev.g.gain.value, t2);
      prev.g.gain.linearRampToValueAtTime(0, t2 + 0.022);
    }
    voices[si] = voice;

    // the finger or nail leaving the string
    if (vel > 0.12 && (opt.noise ?? 1) > 0) {
      const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true;
      ns.playbackRate.value = rnd(0.9, 1.15);
      const bp = F(ac, 'bandpass', lerp(1700, 4200, s.wound * 0.5 + Math.random() * 0.5), 1.1);
      const ng = G(ac, 0);
      ns.connect(bp); bp.connect(ng); ng.connect(input);
      const nl = vel * (0.09 + 0.07 * s.wound) * (opt.noise ?? 1);
      env(ng.gain, t - 0.002, [[0, 0], [0.0016, nl], [0.006, nl * 0.35], [rnd(0.014, 0.03), 0]]);
      ns.start(Math.max(ac.currentTime, t - 0.002)); ns.stop(t + 0.06);
      ns.onended = () => { try { ns.disconnect(); bp.disconnect(); ng.disconnect(); } catch { /* gone */ } };
    }
    return voice;
  }

  // A natural harmonic: touch the string at 1/n and it rings a thin, glassy n*f0.
  function harmonic(t, si, midi, n = 2, vel = 0.5) {
    const s = STRINGS[clamp(si | 0, 0, 5)]; s.i = si;
    const f0 = mtof(midi) * n;
    if (f0 > 1900) return null;
    const buf = buffer(f0, { ...s, i: si + 10, damp: 0.34, stiff: 0.004, decay: 3.0, bright: 0.9, pick: 1 / (2 * n), noise: 0.18 }, 0, 2.4);
    const src = ac.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = Math.pow(2, rnd(-3, 3) / 1200);
    const g = G(ac, 0), hp = F(ac, 'highpass', f0 * 0.75, -3);
    src.connect(hp); hp.connect(g); g.connect(input);
    g.gain.setValueAtTime(vel * 0.5, t);
    src.start(t); src.stop(t + buf.duration + 0.05);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch { /* gone */ } };
    return { g, t, ends: t + buf.duration };
  }

  // Fingers sliding along a wound string: bandpass noise sweeping, amplitude-modulated at the
  // winding rate, which is what turns a hiss into that squeak.
  function squeak(t, level = 0.5) {
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.playbackRate.value = rnd(0.85, 1.2);
    const bp = F(ac, 'bandpass', 1500, 3.4);
    const am = G(ac, 0.42);
    const lfo = O(ac, 'sine', rnd(190, 330));
    const lg = G(ac, 0.5);
    const g = G(ac, 0);
    const len = rnd(0.14, 0.34);
    ns.connect(bp); bp.connect(am); am.connect(g); g.connect(input);
    lfo.connect(lg); lg.connect(am.gain);
    const f0 = rnd(1200, 1900), f1 = f0 * rnd(1.5, 2.6);
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + len);
    lfo.frequency.setValueAtTime(rnd(190, 280), t); lfo.frequency.linearRampToValueAtTime(rnd(320, 470), t + len);
    env(g.gain, t, [[0, 0], [0.02, level * 0.10], [len * 0.6, level * 0.07], [len, 0]]);
    ns.start(t); ns.stop(t + len + 0.05); lfo.start(t); lfo.stop(t + len + 0.05);
    ns.onended = () => { try { ns.disconnect(); bp.disconnect(); am.disconnect(); g.disconnect(); lfo.disconnect(); lg.disconnect(); } catch { /* gone */ } };
  }

  // A left-hand finger landing on a fret.
  function fret(t, level = 0.4) {
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.playbackRate.value = rnd(0.9, 1.2);
    const bp = F(ac, 'bandpass', rnd(900, 1900), 1.6), g = G(ac, 0);
    ns.connect(bp); bp.connect(g); g.connect(input);
    env(g.gain, t, [[0, 0], [0.001, level * 0.07], [rnd(0.008, 0.02), 0]]);
    ns.start(t); ns.stop(t + 0.05);
    ns.onended = () => { try { ns.disconnect(); bp.disconnect(); g.disconnect(); } catch { /* gone */ } };
  }

  // Damp everything still ringing — the flat of the hand across the strings.
  function damp(t, seconds = 1.0) {
    for (const v of live) {
      if (v.ends <= t) continue;
      try { v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.setTargetAtTime(0, t, seconds / 3); } catch { /* gone */ }
    }
  }

  // Rendering a 3 s string costs 5-25 ms of JS. Scheduled a beat ahead that is inaudible, but the
  // first phrase would otherwise render half a dozen at once. warm() renders exactly one uncached
  // note per call, so the cost is spread over the first couple of seconds of play.
  const warmList = [];
  for (const name of ['Dm', 'C', 'Bb', 'A', 'Gm', 'F']) {
    const sh = SHAPES[name];
    for (let i = 0; i < 6; i++) if (sh[i] !== null && sh[i] !== undefined) warmList.push([i, TUNING[i] + sh[i]]);
  }
  let warmI = 0;
  function warm() {
    while (warmI < warmList.length) {
      const [si, midi] = warmList[warmI++];
      const st = STRINGS[si]; st.i = si;
      const f0 = mtof(midi);
      const key = si + '|' + Math.round(f0 * 4) + '|0';
      if (cache.has(key)) continue;
      buffer(f0, st, 0, st.dur);
      return true;
    }
    return false;
  }

  return {
    out, input, pluck, harmonic, squeak, fret, damp, warm,
    get voices() { return live.size; },
    get renders() { return renders; },
    get cached() { return cache.size; },
    dispose() { try { out.disconnect(); } catch { /* gone */ } },
  };
}

// ============================================================================================
// 4. The combat rig — bowed cluster, pizzicato ostinato, felt percussion
// ============================================================================================
export function buildCombat(ac, dest, o = {}) {
  const sr = ac.sampleRate;
  const out = G(ac, o.gain ?? 1);
  out.connect(dest);
  const nb = noiseBuffer(ac);

  // ---- bowed section -------------------------------------------------------------------
  // The bridge force of a bowed string is a sawtooth (Helmholtz motion). Two saws per desk, a few
  // cents apart, through a cello body: air ~110 Hz, main wood ~230 Hz, a bridge hill at 2.3 kHz.
  const bowBus = G(ac, 1);
  const bodyIn = G(ac, 1);
  let bn = bodyIn;
  for (const f of [F(ac, 'highpass', 42, -3), F(ac, 'peaking', 112, 1.2, 4.0), F(ac, 'peaking', 232, 1.4, 3.0), F(ac, 'peaking', 460, 1.6, -2.0), F(ac, 'peaking', 2300, 0.9, 3.0)]) { bn.connect(f); bn = f; }
  const bowLP = F(ac, 'lowpass', 700, 1.1);
  bn.connect(bowLP); bowLP.connect(bowBus); bowBus.connect(out);

  const desks = [];
  const DESK = [
    { midi: 38, lvl: 1.00, pan: -0.35 },   // D2   root
    { midi: 45, lvl: 0.80, pan: 0.32 },    // A2   fifth
    { midi: 39, lvl: 0.62, pan: 0.12 },    // Eb2  minor second — the grinding one
    { midi: 44, lvl: 0.55, pan: -0.18 },   // Ab2  tritone
    { midi: 50, lvl: 0.50, pan: 0.05 },    // D3   octave
  ];
  for (const d of DESK) {
    const g = G(ac, 0);
    const pan = P(ac, d.pan);
    const vib = O(ac, 'sine', rnd(4.6, 6.3));
    const vibG = G(ac, rnd(5, 11));
    const drift = O(ac, 'sine', rnd(0.07, 0.19));
    const driftG = G(ac, rnd(2, 5));
    const oscs = [];
    for (const det of [-6, 7]) {
      const s = O(ac, 'sawtooth', mtof(d.midi), det + rnd(-3, 3));
      const sg = G(ac, 0.42);
      s.connect(sg); sg.connect(g);
      vibG.connect(s.detune); driftG.connect(s.detune);
      oscs.push(s);
    }
    // bow hair: broadband noise riding the note, without which a saw is just a synth
    const bs = ac.createBufferSource(); bs.buffer = nb; bs.loop = true; bs.playbackRate.value = rnd(0.85, 1.15);
    const bf = F(ac, 'bandpass', rnd(2200, 4200), 0.9);
    const bg = G(ac, 0.055);
    bs.connect(bf); bf.connect(bg); bg.connect(g);
    vib.connect(vibG); drift.connect(driftG);
    if (pan) { g.connect(pan); pan.connect(bodyIn); } else g.connect(bodyIn);
    desks.push({ def: d, g, oscs, vib, drift, vibG, sources: [...oscs, vib, drift, bs] });
  }

  // ---- pizzicato bass ostinato: the drive. Same string model, throttled and short. -------
  const pizzBus = G(ac, 1);
  let pn = pizzBus;
  for (const f of [F(ac, 'highpass', 46, -3), F(ac, 'peaking', 92, 1.2, 4.5), F(ac, 'peaking', 240, 1.3, 1.5), F(ac, 'lowpass', 3400, -3)]) { pn.connect(f); pn = f; }
  pn.connect(out);
  const pizzCache = new Map();
  function pizzBuffer(midi) {
    const key = midi | 0;
    let b = pizzCache.get(key);
    if (b) return b;
    const data = renderString(sr, mtof(midi), { decay: 0.85, damp: 0.60, stiff: 0.14, bright: 0.42, pick: 0.09, noise: 0.30, poly: 0.3, polyDecay: 1.5, maxDur: 1.1 });
    b = ac.createBuffer(1, data.length, sr);
    b.copyToChannel ? b.copyToChannel(data, 0) : b.getChannelData(0).set(data);
    pizzCache.set(key, b); return b;
  }
  function pizz(t, midi, vel = 0.8) {
    const buf = pizzBuffer(midi);
    const src = ac.createBufferSource(); src.buffer = buf; src.playbackRate.value = Math.pow(2, rnd(-6, 6) / 1200);
    const g = G(ac, 0), lp = F(ac, 'lowpass', lerp(700, 2600, vel), -1);
    src.connect(lp); lp.connect(g); g.connect(pizzBus);
    g.gain.setValueAtTime(vel * 0.9, t);
    src.start(t); src.stop(t + buf.duration + 0.05);
    src.onended = () => { try { src.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } };
    // the sub under it: felt in the chest, never heard as a kick
    const so = O(ac, 'sine', mtof(midi) * 0.5), sg = G(ac, 0);
    so.connect(sg); sg.connect(out);
    so.frequency.setValueAtTime(mtof(midi) * 0.52, t);
    so.frequency.exponentialRampToValueAtTime(mtof(midi) * 0.5, t + 0.09);
    env(sg.gain, t, [[0, 0], [0.006, vel * 0.30], [0.06, vel * 0.13], [rnd(0.16, 0.26), 0]]);
    so.start(t); so.stop(t + 0.4);
    so.onended = () => { try { so.disconnect(); sg.disconnect(); } catch { /* gone */ } };
  }

  // ---- felt percussion -----------------------------------------------------------------
  function lowHit(t, vel = 1) {
    const o1 = O(ac, 'sine', 78), g1 = G(ac, 0);
    o1.connect(g1); g1.connect(out);
    o1.frequency.setValueAtTime(rnd(78, 94), t); o1.frequency.exponentialRampToValueAtTime(rnd(38, 45), t + 0.16);
    env(g1.gain, t, [[0, 0], [0.008, vel * 0.42], [0.12, vel * 0.20], [rnd(0.55, 0.85), 0]]);
    o1.start(t); o1.stop(t + 1.1);
    o1.onended = () => { try { o1.disconnect(); g1.disconnect(); } catch { /* gone */ } };
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.playbackRate.value = rnd(0.8, 1.2);
    const lp = F(ac, 'lowpass', 150, -2), ng = G(ac, 0);
    ns.connect(lp); lp.connect(ng); ng.connect(out);
    env(ng.gain, t, [[0, 0], [0.004, vel * 0.30], [0.11, 0]]);
    ns.start(t); ns.stop(t + 0.25);
    ns.onended = () => { try { ns.disconnect(); lp.disconnect(); ng.disconnect(); } catch { /* gone */ } };
  }
  function rattle(t, vel = 0.6) {
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.playbackRate.value = rnd(0.9, 1.2);
    const bp = F(ac, 'bandpass', rnd(2100, 3800), 2.2), g = G(ac, 0);
    const pan = P(ac, rnd(-0.5, 0.5));
    ns.connect(bp); bp.connect(g);
    if (pan) { g.connect(pan); pan.connect(out); } else g.connect(out);
    const n = 14 + ((Math.random() * 18) | 0), span = rnd(0.18, 0.36);
    const step = span / n, rel = Math.min(0.016, step * 0.55);   // grains must not overlap their own release
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const tt = t + i * step + rnd(0, step * 0.35);
      const a = vel * 0.11 * (1 - i / n) * rnd(0.4, 1);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(a, tt + 0.0015); g.gain.linearRampToValueAtTime(0, tt + rel);
    }
    g.gain.setValueAtTime(0, t + span + 0.03);
    ns.start(t); ns.stop(t + span + 0.08);
    ns.onended = () => { try { ns.disconnect(); bp.disconnect(); g.disconnect(); pan && pan.disconnect(); } catch { /* gone */ } };
  }
  function scrape(t, vel = 0.6) {
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.playbackRate.value = rnd(0.7, 1.1);
    const bp = F(ac, 'bandpass', 320, 3.0), g = G(ac, 0);
    const am = G(ac, 0.6), lfo = O(ac, 'sawtooth', rnd(11, 26)), lg = G(ac, 0.4);
    const pan = P(ac, rnd(-0.6, 0.6));
    ns.connect(bp); bp.connect(am); am.connect(g);
    lfo.connect(lg); lg.connect(am.gain);
    if (pan) { g.connect(pan); pan.connect(out); } else g.connect(out);
    const len = rnd(0.45, 0.95), up = Math.random() < 0.5;
    bp.frequency.setValueAtTime(up ? 300 : 1500, t); bp.frequency.exponentialRampToValueAtTime(up ? 1600 : 260, t + len);
    env(g.gain, t, [[0, 0], [len * 0.25, vel * 0.14], [len * 0.7, vel * 0.09], [len, 0]]);
    ns.start(t); ns.stop(t + len + 0.05); lfo.start(t); lfo.stop(t + len + 0.05);
    ns.onended = () => { try { ns.disconnect(); bp.disconnect(); am.disconnect(); g.disconnect(); lfo.disconnect(); lg.disconnect(); pan && pan.disconnect(); } catch { /* gone */ } };
  }

  // ---- the riser: a high cluster crawling upward, the sound of something about to happen -----
  const riseBus = G(ac, 0);
  const riseBP = F(ac, 'bandpass', 900, 3.2);
  const riseTrem = G(ac, 0.7);
  const tremLfo = O(ac, 'sine', 8.5), tremG = G(ac, 0.35);
  tremLfo.connect(tremG); tremG.connect(riseTrem.gain);
  riseBP.connect(riseTrem); riseTrem.connect(riseBus); riseBus.connect(out);
  const riseOsc = [];
  for (const [r, d] of [[1, -9], [1.0595, 11], [1.4142, -5]]) {
    const s = O(ac, 'sawtooth', 220 * r, d), sg = G(ac, 0.3);
    s.connect(sg); sg.connect(riseBP); riseOsc.push(s);
  }

  const allSources = [tremLfo, ...riseOsc];
  for (const d of desks) allSources.push(...d.sources);

  function start(t) { for (const s of allSources) { try { s.start(t + rnd(0, 0.05)); } catch { /* already started */ } } }
  function stopAll(t) { for (const s of allSources) { try { s.stop(t); } catch { /* already stopped */ } } }

  // While the section is resolving, the per-frame intensity control must keep its hands off: the
  // comedown is a nine-second scripted ramp on the same gains, and a setTargetAtTime on top of it
  // cancels it and leaves the cluster hanging.
  let resolveUntil = -1e9;
  // bow pressure: how many desks are playing and how open the section sounds
  function setIntensity(t, v, tc = 1.2) {
    if (t < resolveUntil) return;
    const lv = clamp01(v);
    for (let i = 0; i < desks.length; i++) {
      const d = desks[i];
      const thresh = [0, 0.18, 0.42, 0.62, 0.78][i];
      const w = clamp01((lv - thresh) / 0.22);
      d.g.gain.setTargetAtTime(w * d.def.lvl * 0.24, t, tc / 3);
    }
    bowLP.frequency.setTargetAtTime(lerp(420, 1900, Math.pow(lv, 0.8)), t, tc / 3);
  }
  // the moment it starts: a bite, not a fade
  function attack(t) {
    resolveUntil = -1e9;
    for (let i = 0; i < desks.length; i++) {
      const d = desks[i];
      const target = [1, 0.9, 0.7, 0.55, 0.5][i] * d.def.lvl * 0.24;
      d.g.gain.cancelScheduledValues(t);
      d.g.gain.setValueAtTime(0.0001, t);
      d.g.gain.linearRampToValueAtTime(target * 1.25, t + 0.22 + i * 0.03);
      d.g.gain.linearRampToValueAtTime(target, t + 0.7);
    }
    bowLP.frequency.cancelScheduledValues(t);
    bowLP.frequency.setValueAtTime(420, t);
    bowLP.frequency.linearRampToValueAtTime(2100, t + 0.35);
    bowLP.frequency.linearRampToValueAtTime(1500, t + 1.6);
  }
  // the comedown: the cluster resolves to an octave and lets go
  function resolve(t, seconds = 8) {
    resolveUntil = t + seconds;
    const dest2 = [38, 45, 38, 50, 50];
    for (let i = 0; i < desks.length; i++) {
      const d = desks[i];
      for (const s of d.oscs) s.frequency.setTargetAtTime(mtof(dest2[i]), t, 1.6);
      d.g.gain.cancelScheduledValues(t);
      d.g.gain.setValueAtTime(d.g.gain.value, t);
      d.g.gain.linearRampToValueAtTime(d.def.lvl * 0.11, t + 1.4);
      d.g.gain.linearRampToValueAtTime(0, t + seconds);
    }
    bowLP.frequency.cancelScheduledValues(t);
    bowLP.frequency.setValueAtTime(bowLP.frequency.value, t);
    bowLP.frequency.linearRampToValueAtTime(360, t + seconds);
  }
  function setRise(t, v, tc = 2) { riseBus.gain.setTargetAtTime(clamp01(v) * 0.10, t, tc / 3); }
  function riseSweep(t, len = 12) {
    for (const s of riseOsc) { s.detune.cancelScheduledValues(t); s.detune.setValueAtTime(rnd(-10, 10), t); s.detune.linearRampToValueAtTime(rnd(900, 1500), t + len); }
    riseBP.frequency.cancelScheduledValues(t);
    riseBP.frequency.setValueAtTime(700, t); riseBP.frequency.exponentialRampToValueAtTime(rnd(2400, 4000), t + len);
  }
  function transpose(t, semis) {
    if (t < resolveUntil) return;
    for (const d of desks) for (const s of d.oscs) s.frequency.setTargetAtTime(mtof(d.def.midi + semis), t, 0.8);
  }

  return {
    out, start, stopAll, setIntensity, attack, resolve, setRise, riseSweep, transpose,
    pizz, lowHit, rattle, scrape,
    dispose() { try { out.disconnect(); } catch { /* gone */ } },
  };
}

// ============================================================================================
// 5. The music: chords, patterns, and the performance
// ============================================================================================
// Shapes are fret numbers per string in drop D (null = the string is not sounded). Everything sits
// in D aeolian with the Phrygian flat second and the harmonic-minor V borrowed when it wants to
// sound Slavic rather than merely sad.
const SHAPES = {
  Dm:    [0, 0, 0, 2, 3, 1],
  Dm9:   [0, 0, 0, 2, 1, 0],
  Dm7:   [0, 0, 0, 2, 1, 1],
  C:     [null, 3, 2, 0, 1, 0],
  Bb:    [null, 1, 0, 3, 3, 1],
  BbM7:  [null, 1, 0, 2, 3, 1],
  A:     [null, 0, 2, 2, 2, 0],
  Am:    [null, 0, 2, 2, 1, 0],
  Gm:    [5, null, 0, 3, 3, 3],
  F:     [3, 0, 3, 2, 1, 1],
  Eb:    [1, 1, 1, 0, 4, null],
  Dsus4: [0, 0, 0, 2, 3, 3],
};
// i - VI - VII - i, the Andalusian descent, the Phrygian turn, the harmonic-minor cadence.
const PROGRESSIONS = [
  ['Dm', 'Dm', 'Bb', 'Bb', 'C', 'C', 'Dm', 'Dm'],
  ['Dm', 'C', 'Bb', 'A'],
  ['Dm', 'Dm', 'Gm', 'Gm', 'Bb', 'A', 'Dm', 'Dm'],
  ['Dm9', 'BbM7', 'F', 'C'],
  ['Dm', 'Eb', 'Dm', 'A'],
  ['Dm', 'F', 'C', 'Dm'],
  ['Dm9', 'Dm9', 'C', 'C', 'BbM7', 'BbM7', 'A', 'A'],
  ['Gm', 'Dm', 'Eb', 'Dm'],
];
// Fingerpicking: eight eighth-note slots per bar. Each entry is a "voice" of the chord counted from
// the bass upward (0 = lowest sounding string, 1 = next, ...), -1 = the alternating bass, null = rest.
const PATTERNS = [
  [0, 4, 3, 5, 4, 3, null, 4],           // p-i-m-a-m-i, the standard arpeggio
  [0, null, 3, 4, -1, null, 4, 3],       // alternating-bass, sparse
  [0, null, 4, null, 5, null, 3, null],  // half-time, lots of air
  [0, 3, 4, 5, null, 4, 3, null],
  [0, null, null, 4, null, null, 3, null], // very slow, almost a pulse
  [0, 4, null, 3, -1, 5, null, 4],
];
// D aeolian over two octaves. The melody lives here; the motifs below are scale-degree indices, so
// they stay in the mode wherever the harmony happens to be.
const SCALE = [62, 64, 65, 67, 69, 70, 72, 74, 77, 79, 81];   // D E F G A Bb C D F G A
// [degree, eighth-notes to the next note]. Minor descents, a Phrygian lean, a rising sigh.
const MOTIFS = [
  [[4, 1], [3, 1], [2, 2], [0, 4]],
  [[7, 2], [6, 1], [4, 1], [3, 3]],
  [[2, 1], [4, 1], [5, 2], [4, 1], [2, 1], [0, 4]],
  [[0, 2], [2, 1], [4, 3], [3, 2], [2, 4]],
  [[4, 3], [4, 1], [3, 1], [1, 3]],
  [[5, 1], [4, 1], [2, 2], [3, 1], [2, 5]],
];
// The sparse forms used when the zone is leaning in and the player should be listening for footsteps.
const THIN = [
  [0, null, null, null, null, null, 4, null],
  [0, null, null, null, -1, null, null, null],
  [0, null, null, null, null, null, null, null],
];

export function createMusic(ctx) {
  const audio = ctx.audio;
  let running = false, built = false, subscribed = false;
  let ac = null, master = null;
  let guitar = null, combat = null;
  let drone = null, unease = null, base = null, tideL = null;
  let extraSources = [], extraNodes = [];
  const issued = new Map();
  const throttled = new Map();
  // call fn(v) only when the value has actually moved, or a quarter second has passed
  function nudge(key, v, fn, eps = 0.01, every = 0.25) {
    const st = throttled.get(key);
    const now = ac.currentTime;
    if (st && Math.abs(st.v - v) < eps && now - st.t < every) return;
    throttled.set(key, { v, t: now });
    fn(v);
  }
  let frameDt = 1 / 60, tideRise = 0, lastMode = '';
  let comedownAt = -1e9;
  const LOOKAHEAD = 2.2;    // seconds of music scheduled ahead on the audio clock

  // ---- fades (slow parameter approach, throttled so the automation timeline is not flooded) ----
  function fade(p, v, attack, release) {
    let s = issued.get(p); if (!s) { s = { v: NaN, t: -1, est: 0 }; issued.set(p, s); }
    const now = ac.currentTime;
    const first = Number.isNaN(s.v);
    const tc = Math.max(0.02, (v > s.est ? attack : release) / 3);
    s.est += (v - s.est) * (1 - Math.exp(-frameDt / tc));
    if (!first && Math.abs(s.v - v) < 1e-4) return;
    if (!first && now - s.t < 0.1) return;
    const secs = first || v > s.v ? attack : release;
    s.v = v; s.t = now; p.setTargetAtTime(v, now, Math.max(0.02, secs / 3));
  }
  const est = (p) => issued.get(p)?.est ?? 0;

  // ---- the ambient beds that are not the score proper ----------------------------------------
  const mkG = (v) => { const g = G(ac, v); extraNodes.push(g); return g; };
  const mkF = (t, f, q, gn) => { const b = F(ac, t, f, q, gn); extraNodes.push(b); return b; };
  const mkO = (t, f, d) => { const o = O(ac, t, f, d); extraNodes.push(o); extraSources.push(o); return o; };
  const mkN = () => { const s = ac.createBufferSource(); s.buffer = noiseBuffer(ac); s.loop = true; extraNodes.push(s); extraSources.push(s); return s; };
  function lfo(rate, depth, param, type = 'sine') { const o = mkO(type, rate); const g = mkG(depth); o.connect(g); g.connect(param); return o; }

  function buildDrone() {
    // The zone under the music: a low D pedal with a slow filter breath and a hiss of air.
    const g = mkG(0); g.connect(master);
    const lp = mkF('lowpass', 240, 1.2); lfo(0.043, 110, lp.frequency); lp.connect(g);
    const root = mtof(26) * Math.pow(2, rnd(-6, 6) / 1200);   // D1
    for (const [f, d, v, ty] of [[root, -5, 0.34, 'sine'], [root, 6, 0.30, 'triangle'], [root * 2, -7, 0.16, 'sine'], [root * 3, 5, 0.07, 'sine'], [root * 1.4983, 4, 0.06, 'sine']]) {
      const o = mkO(ty, f, d); const og = mkG(v); o.connect(og); og.connect(lp);
    }
    const air = mkF('bandpass', 320, 0.8); const ag = mkG(0.05); mkN().connect(air); air.connect(ag); ag.connect(lp);
    lfo(0.031, 130, air.frequency);
    drone = { g };
  }

  function buildUnease() {
    const g = mkG(0); g.connect(master);
    const f0 = 1180 * Math.pow(2, rnd(-70, 70) / 1200);
    const tone = mkO('sine', f0); const toneG = mkG(0); const shim = mkG(1);
    lfo(0.13, 0.16, shim.gain); tone.connect(toneG); toneG.connect(shim); shim.connect(g);
    lfo(0.3, f0 * 0.0046, tone.frequency);
    const t2 = mkO('sine', f0 * 2.003, rnd(-9, 9)); const t2g = mkG(0.15); t2.connect(t2g); t2g.connect(toneG);
    const airF = mkF('bandpass', f0, 14); const airG = mkG(1.1); mkN().connect(airF); airF.connect(airG); airG.connect(toneG);
    const sighF = mkF('bandpass', 2000, 2.4); const sighG = mkG(0); mkN().connect(sighF); sighF.connect(sighG); sighG.connect(g);
    unease = { g, f0, tone, t2, toneG, airF, sighF, sighG, toneT: rnd(1, 5), sighT: rnd(8, 22) };
  }

  function buildBase() {
    const g = mkG(0); g.connect(master);
    const lp = mkF('lowpass', 540, 0.9); const wob = mkG(1); lfo(0.09, 0.18, wob.gain); lp.connect(wob); wob.connect(g);
    for (const [f, ty, v, d] of [[100, 'triangle', 0.32, -5], [100, 'triangle', 0.32, 6], [150, 'triangle', 0.2, 0], [200, 'sine', 0.16, 3], [300.5, 'triangle', 0.1, -8]]) {
      const o = mkO(ty, f, d); const og = mkG(v); o.connect(og); og.connect(lp);
    }
    base = { g };
  }

  function buildTide() {
    const g = mkG(0); g.connect(master);
    const lp = mkF('lowpass', 1700, 0.6); const shim = mkG(0.9); lfo(0.23, 0.12, shim.gain); lp.connect(shim); shim.connect(g);
    const root = mtof(52) * Math.pow(2, rnd(-40, 40) / 1200);
    const oscs = [], det0 = [], rate = [];
    for (const r of [1, 1.0595, 1.1225, 1.1892, 1.2599, 1.3348]) {
      const d = rnd(-14, 14); const o = mkO('sine', root * r, d); const og = mkG(0.17); o.connect(og); og.connect(lp);
      oscs.push(o); det0.push(d); rate.push(rnd(0.8, 1.2));
    }
    tideL = { g, oscs, det0, rate };
  }

  // ---- build / teardown -----------------------------------------------------------------------
  function build() {
    ac = audio.ctx;
    master = G(ac, 0); master.connect(audio.musicBus);
    // Levels, measured on the master bus with settings at 0.8/0.8 against shot_pm's 0.70 peak:
    // the guitar sits about 11 dB under a pistol shot, the combat section about 6 dB under.
    guitar = buildGuitar(ac, master, { gain: 0, verb: 0.30, rt: 3.2 });
    combat = buildCombat(ac, master, { gain: 0 });
    buildDrone(); buildUnease(); buildBase(); buildTide();
    for (const s of extraSources) { try { s.start(ac.currentTime + rnd(0, 0.05)); } catch { /* started */ } }
    combat.start(ac.currentTime);
    combat.setIntensity(ac.currentTime, 0, 0.1);
    master.gain.setTargetAtTime(1, ac.currentTime, 0.5);
    built = true;
    Gt.t = ac.currentTime + 1.5; Gt.playing = false; Gt.restUntil = ac.currentTime + rnd(1.5, 5);
    Ct.t = ac.currentTime;
    if (ctx.director.state === 'AFTERMATH') comedownAt = ac.currentTime;
  }

  function teardown(fadeS = 1.2) {
    if (!built) return;
    const now = ac.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(0, now, fadeS / 3);
    const srcs = extraSources, nds = extraNodes;
    const gtr = guitar, cbt = combat;
    extraSources = []; extraNodes = [];
    for (const s of srcs) { try { s.stop(now + fadeS + 0.05); } catch { /* stopped */ } }
    try { cbt.stopAll(now + fadeS + 0.05); } catch { /* stopped */ }
    try { gtr.damp(now, fadeS * 0.7); } catch { /* gone */ }
    setTimeout(() => {
      for (const n of nds) { try { n.disconnect(); } catch { /* gone */ } }
      try { gtr.dispose(); } catch { /* gone */ }
      try { cbt.dispose(); } catch { /* gone */ }
      try { master.disconnect(); } catch { /* gone */ }
    }, (fadeS + 0.3) * 1000);
    guitar = null; combat = null; drone = null; unease = null; base = null; tideL = null;
    issued.clear(); throttled.clear(); master = null; built = false;
  }

  // ---- the guitarist ---------------------------------------------------------------------------
  const Gt = {
    t: 0, playing: false, restUntil: 0, bpm: 56, prog: null, bar: 0, slot: 0,
    pattern: null, phraseBars: 0, lastChord: null, phrases: 0, melody: null, roll: false,
  };

  // Turn a shape into sounding notes, lowest first.
  function voicing(name) {
    const shape = SHAPES[name] || SHAPES.Dm;
    const notes = [];
    for (let i = 0; i < 6; i++) if (shape[i] !== null && shape[i] !== undefined) notes.push({ si: i, midi: TUNING[i] + shape[i] });
    return notes;
  }

  function startPhrase(thin) {
    Gt.prog = pick(PROGRESSIONS);
    Gt.pattern = thin > 0.5 ? pick(THIN) : pick(PATTERNS);
    Gt.bpm = rnd(50, 60) * (thin > 0.5 ? 0.9 : 1);
    Gt.bar = 0; Gt.slot = 0;
    Gt.phraseBars = Math.min(Gt.prog.length, thin > 0.5 ? 4 : pick([4, 4, 6, 8, Gt.prog.length]));
    Gt.playing = true; Gt.lastChord = null;
    Gt.phrases++;
    // a melody in the second half of the phrase, sometimes, and never when the guitar is thinning out
    Gt.melody = thin < 0.35 && Math.random() < 0.5
      ? { m: pick(MOTIFS), bar: 1 + ((Math.random() * Math.max(1, Gt.phraseBars - 2)) | 0), slot: pick([0, 2, 4]) }
      : null;
    Gt.roll = Math.random() < 0.55;
  }

  // Put a scale note on a real string and fret. The top two strings carry the tune, which is where
  // a guitarist's little finger lives.
  function melodyNote(t, midi, vel, slide) {
    const si = midi >= 69 ? 5 : 4;
    const fret = midi - TUNING[si];
    if (fret < 0 || fret > 15) return;
    guitar.pluck(t, si, midi, vel, slide ? { slide: pick([100, 200]), slideT: rnd(0.07, 0.13) } : {});
  }

  function guitarTick(horizon, weight, thin) {
    const now = ac.currentTime;
    if (Gt.t < now - 0.5) Gt.t = now + 0.15;            // a stalled frame does not desync the music
    let guard = 0;
    while (Gt.t < horizon && guard++ < 64) {
      if (!Gt.playing) {
        if (weight > 0.06 && Gt.t >= Gt.restUntil) startPhrase(thin);
        else { Gt.t += 0.4; continue; }
      }
      const beat = 60 / Gt.bpm;
      const slotDur = beat / 2;
      const name = Gt.prog[Gt.bar % Gt.prog.length];
      const notes = voicing(name);
      const v = Gt.pattern[Gt.slot % 8];
      const isNew = name !== Gt.lastChord && Gt.slot === 0;
      // rubato: the phrase breathes, and the last bar leans back
      const late = (Gt.bar >= Gt.phraseBars - 1 ? 0.06 : 0) * (Gt.slot / 8);
      const t = Gt.t + rnd(-0.014, 0.02) + late * beat;

      if (isNew && Gt.lastChord && Math.random() < 0.45) guitar.squeak(t - rnd(0.1, 0.22), 0.5 + thin * 0.2);
      if (isNew && Math.random() < 0.5) guitar.fret(t - rnd(0.02, 0.07), 0.5);

      // the melody, laid over the arpeggio on the top strings (which the arpeggio then has to give up:
      // re-plucking a string stops what it was ringing, exactly as it does under a real hand)
      if (Gt.melody && Gt.bar === Gt.melody.bar && Gt.slot === Gt.melody.slot) {
        let mt = t, first = true;
        for (const [deg, dur] of Gt.melody.m) {
          const midi = SCALE[clamp(deg, 0, SCALE.length - 1)];
          melodyNote(mt + rnd(-0.01, 0.015), midi, clamp01(rnd(0.62, 0.86) * weight), first && Math.random() < 0.4);
          // a hammer-on: the next note arrives under the finger with no pluck behind it
          if (!first && Math.random() < 0.22) {
            const up = SCALE[clamp(deg + 1, 0, SCALE.length - 1)];
            const si2 = up >= 69 ? 5 : 4;
            guitar.fret(mt + slotDur * 0.44, 0.35);
            guitar.pluck(mt + slotDur * 0.5, si2, up, clamp01(0.3 * weight), { noise: 0.25, amp: 0.6 });
          }
          mt += dur * slotDur;
          first = false;
        }
        Gt.melody = null;
      }

      // the last chord of the phrase, rolled with the thumb and left to ring
      let rolled = false;
      if (Gt.roll && Gt.bar === Gt.phraseBars - 1 && Gt.slot === 4 && notes.length) {
        const sp = rnd(0.028, 0.05);
        notes.forEach((nn, i) => guitar.pluck(t + i * sp + rnd(0, 0.008), nn.si, nn.midi, clamp01(rnd(0.5, 0.7) * weight * (1 - i * 0.04))));
        Gt.roll = false; rolled = true;
      }

      if (v !== null && notes.length && !rolled) {
        let n;
        if (v === -1) n = notes[Math.min(1, notes.length - 1)];
        else if (v === 0) n = notes[0];
        else n = notes[Math.min(notes.length - 1, v - (6 - notes.length))] || notes[notes.length - 1];
        const accent = Gt.slot === 0 ? 1 : Gt.slot === 4 ? 0.82 : 0.66;
        const vel = clamp01(accent * rnd(0.82, 1.05) * lerp(0.95, 0.55, thin) * weight * 1.15);
        guitar.pluck(t, n.si, n.midi, vel);
        // an occasional melody note above the arpeggio, or a harmonic left hanging
        if (!thin && Gt.slot === 6 && Gt.bar % 2 === 1 && Math.random() < 0.35) {
          const scale = [62, 64, 65, 67, 69, 70, 72, 74];   // D aeolian, an octave up
          guitar.pluck(t + slotDur * rnd(0.45, 0.6), 5, pick(scale), vel * 0.75);
        }
        if (Gt.slot === 0 && Gt.bar === Gt.phraseBars - 1 && Math.random() < 0.4) {
          guitar.harmonic(t + beat * rnd(1.4, 2.2), 4, 62, 2, 0.5 * weight);
        }
      }
      Gt.lastChord = name;
      Gt.t += slotDur;
      Gt.slot++;
      if (Gt.slot >= 8) {
        Gt.slot = 0; Gt.bar++;
        if (Gt.bar >= Gt.phraseBars) {
          Gt.playing = false;
          // silence is part of the score: longer rests when the zone is quiet, shorter when it is not
          const restBase = thin > 0.5 ? rnd(10, 26) : rnd(7, 22);
          Gt.restUntil = Gt.t + restBase * lerp(1.25, 0.7, weight) + (Math.random() < 0.18 ? rnd(15, 35) : 0);
        }
      }
    }
  }

  // ---- the section ------------------------------------------------------------------------------
  const Ct = { t: 0, step: 0, bar: 0, root: 38, riseT: 0, textureT: 0 };
  // 16 sixteenths. Not a kit: these are bow-arm accents on a pizzicato bass, so the pattern is
  // asymmetric and the accents fall where a string player would put them.
  const OSTINATO = [
    [1, 0, 0, 0.5, 0.8, 0, 0.45, 0, 1, 0, 0, 0.5, 0.75, 0.45, 0, 0.35],
    [1, 0, 0.4, 0, 0.8, 0, 0, 0.5, 1, 0, 0.4, 0, 0.7, 0, 0.5, 0.4],
    [1, 0, 0, 0, 0.7, 0, 0.5, 0.5, 0.9, 0, 0, 0.45, 0.8, 0, 0, 0],
  ];
  let ostinato = OSTINATO[0];
  const BASSLINE = [0, 0, 0, 0, 1, 1, 0, 0, -2, -2, 0, 0, 1, 1, 5, 5];   // semitone moves off D: D, Eb, C, G

  // `drive` is the ostinato: only COMBAT gets it. HUNT gets the bowed bed, the riser and the odd
  // scrape, which is a room holding its breath rather than a fight already happening.
  function combatTick(horizon, intensity, drive) {
    const now = ac.currentTime;
    if (Ct.t < now - 0.4) { Ct.t = now + 0.12; Ct.step = 0; }
    if (drive <= 0) { Ct.t = now; Ct.step = 0; }
    else {
      const bpm = lerp(120, 150, clamp01(intensity));
      const stepDur = 60 / bpm / 4;
      let guard = 0;
      while (Ct.t < horizon && guard++ < 96) {
        const s = Ct.step % 16;
        if (s === 0) {
          Ct.bar++;
          ostinato = OSTINATO[(Math.random() * OSTINATO.length) | 0];
          if (Ct.bar % 4 === 1) combat.lowHit(Ct.t, 0.85 + intensity * 0.3);
          const semis = BASSLINE[(Ct.bar - 1) % BASSLINE.length];
          Ct.root = 38 + semis;
          combat.transpose(Ct.t, semis);
        }
        const v = ostinato[s];
        if (v > 0) {
          const vel = clamp01(v * lerp(0.6, 1, intensity) * rnd(0.9, 1.05));
          combat.pizz(Ct.t + rnd(-0.006, 0.006), Ct.root, vel);
        }
        Ct.t += stepDur; Ct.step++;
      }
    }
    // textures on their own clock, sparse enough that they read as events rather than a loop
    Ct.textureT -= frameDt;
    if (Ct.textureT <= 0 && intensity > 0.16) {
      Ct.textureT = (drive > 0 ? rnd(2.2, 6.5) : rnd(6, 16)) / Math.max(0.35, intensity);
      const r = Math.random();
      if (r < 0.4) combat.rattle(now + 0.05, 0.4 + intensity * 0.6);
      else if (r < 0.75) combat.scrape(now + 0.05, 0.4 + intensity * 0.5);
      else combat.lowHit(now + 0.05, 0.45 + intensity * 0.45);
    }
  }

  // ---- unease events ---------------------------------------------------------------------------
  function uneaseEvents(u, dt) {
    const now = ac.currentTime;
    u.toneT -= dt;
    if (u.toneT <= 0) {
      u.toneT = rnd(7, 18);
      const lvl = Math.random() < 0.35 ? 0 : rnd(0.25, 1);
      u.toneG.gain.setTargetAtTime(lvl, now, rnd(1.4, 3));
      const f = u.f0 * Math.pow(2, rnd(-45, 45) / 1200);
      u.tone.frequency.setTargetAtTime(f, now, 3); u.t2.frequency.setTargetAtTime(f * 2.003, now, 3); u.airF.frequency.setTargetAtTime(f, now, 3);
    }
    u.sighT -= dt;
    if (u.sighT <= 0) {
      u.sighT = rnd(22, 46); const t = now + 0.02, len = rnd(2.6, 3.6);
      u.sighF.frequency.cancelScheduledValues(t); u.sighF.frequency.setValueAtTime(2000 * rnd(0.85, 1.2), t);
      u.sighF.frequency.exponentialRampToValueAtTime(200 * rnd(0.8, 1.25), t + len);
      u.sighF.Q.setValueAtTime(rnd(1.8, 3.2), t);
      env(u.sighG.gain, t, [[0, 0], [0.5, rnd(0.5, 0.9)], [len * 0.55, rnd(0.3, 0.5)], [len, 0]]);
    }
  }

  // ---- transitions -------------------------------------------------------------------------------
  function onState(s, prev) {
    if (!built) return;
    const now = ac.currentTime;
    if (s === 'COMBAT' && prev !== 'COMBAT') {
      // The guitarist stops playing and puts a hand across the strings; the section takes the room.
      guitar.damp(now + 0.05, 0.9);
      Gt.playing = false; Gt.restUntil = now + 24;
      combat.attack(now + 0.02);
      combat.lowHit(now + 0.02, 1.1);
      combat.scrape(now + 0.02, 0.9);
      Ct.t = now + 0.28; Ct.step = 0; Ct.bar = 0; Ct.textureT = rnd(1, 2.5);
    } else if (prev === 'COMBAT' && s !== 'COMBAT') {
      comedownAt = now;
      combat.resolve(now + 0.1, 9);
      combat.lowHit(now + 0.12, 0.6);
      // the guitar comes back, but not immediately, and quietly
      Gt.playing = false; Gt.restUntil = now + rnd(9, 16);
    }
    if (s === 'AFTERMATH' && prev !== 'COMBAT') { Gt.restUntil = Math.min(Gt.restUntil, now + rnd(3, 9)); }
  }

  function subscribe() {
    if (subscribed) return; subscribed = true;
    ctx.events.on('directorState', (s, prev) => onState(s, prev));
    ctx.events.on('tideRising', () => { tideRise = 1; });
    ctx.events.on('tide', () => { tideRise = 0; });
  }

  // ---- per frame ----------------------------------------------------------------------------------
  function update(dt) {
    if (!running) return;
    if (!built) { if (audio.ready) build(); else return; }
    frameDt = clamp(dt || 1 / 60, 1 / 240, 0.5);
    const mode = ctx.mode;
    const dir = ctx.director;
    const s = dir.state, tension = dir.tension, night = ctx.time.night;
    const inBase = ctx.player.inBase ? 1 : 0;
    const live = (mode === 'playing' || mode === 'dead') && !ctx.panels?.isOpen;
    const duck = mode === 'title' ? 0 : mode === 'dead' ? 0.5 : mode === 'paused' ? 0.65 : 1;
    if (mode !== lastMode) { lastMode = mode; if (mode === 'title') tideRise = 0; }
    const vol = ctx.state.data.settings?.music ?? 0.8;
    const now = ac.currentTime;

    // ---- how much of each thing the zone wants right now ----
    // The guitar is the sound of nothing happening. It thins as tension rises and stops before combat.
    let wGuitar = ({ CALM: 1, UNEASE: 0.75, HUNT: 0.28, COMBAT: 0, AFTERMATH: 0.62 }[s] ?? 0.6);
    wGuitar *= lerp(1, 0.25, clamp01((tension - 0.25) / 0.55));
    if (inBase) wGuitar = Math.max(wGuitar, 0.85);            // the bunker gets its quiet song back
    if (now - comedownAt < 7) wGuitar *= clamp01((now - comedownAt) / 7);
    const thin = clamp01((tension - 0.2) / 0.45) * (inBase ? 0.2 : 1);

    // HUNT keeps a floor of bowed low strings whatever the tension: something is looking for you and
    // the room should say so even before the Director has finished making up its mind.
    const wCombat = s === 'COMBAT' ? 1
      : s === 'HUNT' ? 0.30 + clamp01((tension - 0.3) / 0.4) * 0.42
        : s === 'UNEASE' ? clamp01((tension - 0.5) / 0.4) * 0.22
          : now - comedownAt < 9 ? clamp01(1 - (now - comedownAt) / 9) : 0;
    const drive = s === 'COMBAT' ? 1 : 0;
    const intensity = clamp01(s === 'COMBAT' ? 0.6 + tension * 0.4 : wCombat * 0.55);

    let wUnease = s === 'UNEASE' ? 0.8 : s === 'HUNT' ? 0.55 : s === 'AFTERMATH' ? 0.15 : s === 'CALM' ? night * 0.5 : 0;
    wUnease = clamp01(wUnease + tension * 0.2) * (1 - inBase);
    const wDrone = (0.55 + night * 0.35) * (1 - wCombat * 0.7) * (1 - inBase * 0.9);

    // ---- levels. Calibrated against shot_pm = 0.70 peak on the master bus. ----
    fade(guitar.out.gain, 0.55 * wGuitar * duck, 2.5, 4);
    fade(combat.out.gain, 0.42 * wCombat * duck, 1.2, 5);
    fade(drone.g.gain, 0.105 * wDrone * duck, 4, 8);
    fade(unease.g.gain, 0.085 * wUnease * duck, 5, 8);
    fade(base.g.gain, 0.075 * inBase * duck, 5, 4);

    nudge('intensity', wCombat > 0.02 ? intensity : 0, (v) => combat.setIntensity(ac.currentTime, v, 1.4));
    // the riser leans on HUNT, where something is coming but has not arrived
    const wRise = s === 'HUNT' ? clamp01((tension - 0.35) / 0.4) : s === 'UNEASE' ? clamp01((tension - 0.55) / 0.4) * 0.4 : 0;
    nudge('rise', wRise * duck, (v) => combat.setRise(ac.currentTime, v, 3), 0.02);
    Ct.riseT -= frameDt;
    if (wRise > 0.15 && Ct.riseT <= 0) { Ct.riseT = rnd(13, 22); combat.riseSweep(now + 0.05, rnd(9, 15)); }

    // ---- the Tide cluster ----
    const tideIn = ctx.time.tideIn();
    const w = tideIn < 3600 ? clamp01(1 - Math.max(0, tideIn) / 3600) : 0;
    const tideLvl = (w > 0 ? 0.11 * (0.12 + 0.88 * w * w) : 0) + tideRise * 0.07;
    fade(tideL.g.gain, Math.min(0.18, tideLvl) * duck, tideRise ? 3 : 6, 5);
    const glide = w > 0 || tideRise ? 520 * w + 1300 * tideRise : 0;
    tideL.oscs.forEach((o, i) => fade(o.detune, tideL.det0[i] + glide * tideL.rate[i], tideRise ? 5 : 12, 12));

    if (vol < 0.004) return;
    guitar.warm();
    if (!live) return;
    const horizon = now + LOOKAHEAD;
    if (est(guitar.out.gain) > 0.01 || Gt.playing) guitarTick(horizon, clamp01(wGuitar), thin);
    else { Gt.playing = false; Gt.t = now; }
    if (est(combat.out.gain) > 0.008) combatTick(horizon, intensity, drive); else { Ct.t = now; Ct.step = 0; }
    if (est(unease.g.gain) > 0.004) uneaseEvents(unease, frameDt);
  }

  return {
    start() { subscribe(); running = true; if (built && master) master.gain.setTargetAtTime(1, ac.currentTime, 0.5); },
    stop() { running = false; teardown(1.2); },
    update,
    levels() {
      const o = {};
      if (!built) return o;
      const lv = (k, p) => { const st = issued.get(p); o[k] = +(st?.v ?? 0).toFixed(4); o[k + '_est'] = +(st?.est ?? 0).toFixed(4); };
      lv('guitar', guitar.out.gain); lv('combat', combat.out.gain); lv('drone', drone.g.gain);
      lv('unease', unease.g.gain); lv('base', base.g.gain); lv('tide', tideL.g.gain);
      o.playing = Gt.playing; o.bar = Gt.bar; o.phrases = Gt.phrases;
      o.restIn = +(Gt.restUntil - ac.currentTime).toFixed(1);
      o.voices = guitar.voices; o.renders = guitar.renders; o.cached = guitar.cached;
      return o;
    },
    get built() { return built; },
    // measurement hooks: the same builders, pointed at an OfflineAudioContext
    __test: { renderString, buildGuitar, buildCombat, buildReverb, SHAPES, PROGRESSIONS, PATTERNS, TUNING, STRINGS, voicing },
  };
}
