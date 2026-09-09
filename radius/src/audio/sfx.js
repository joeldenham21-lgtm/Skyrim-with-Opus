// RADIUS — sound design. Every canonical sound name (ARCHITECTURE.md, Audio) is synthesised here from a small
// toolkit of layered builders. Nothing is a bare oscillator: each sound is transient + body + tail, and every
// parameter is jittered per call so no two plays are identical. opts.rate scales pitch (x rate) and time (x 1/sqrt rate).
import { registerVoices } from './voices.js';

const EPS = 1e-4;
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const jit = (v, p = 0.08) => v * (1 + (Math.random() * 2 - 1) * p);
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------------------------------------------
// Per-call voice: holds the engine, the output node, the rate scaling and the list of sources (for early stop).
function voice(a, out, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const r = +o.rate, rate = clamp(Number.isFinite(r) && r > 0 ? r : 1, 0.25, 4);
  const v = { a, out, o, rate, s: Math.sqrt(rate), t0: a.now + 0.006, srcs: [], end: 0 };
  v.src = (n, tEnd) => { v.srcs.push(n); if (tEnd > v.end) v.end = tEnd; };
  return v;
}
// optional post-chain on any builder: shape (waveshaper drive), hp / lp / bp (+ q) filters
function fx(v, head, c) {
  const a = v.a;
  if (c.shape) { const w = a.shaper(c.shape); head.connect(w); head = w; }
  if (c.hp) { const f = a.filter('highpass', c.hp * v.rate, c.hq ?? 0.7); head.connect(f); head = f; }
  if (c.lp) { const f = a.filter('lowpass', c.lp * v.rate, c.lq ?? 0.7); head.connect(f); head = f; }
  if (c.bp) { const f = a.filter('bandpass', c.bp * v.rate, c.bq ?? 1); head.connect(f); head = f; }
  return head;
}
// amplitude envelope: attack → (optional hold) → decay to silence
function ampEnv(v, param, t, dur, g, c) {
  const atk = Math.min(dur * 0.9, (c.atk ?? 0.003) / v.s);
  const pts = [[0, EPS], [atk, g, 'lin']];
  if (c.hold) pts.push([Math.min(dur * 0.95, atk + c.hold / v.s), g * 0.9, 'lin']);
  pts.push([dur, EPS, c.curve || 'exp']);
  v.a.env(param, pts, t);
}

// Filtered noise burst. { at, type, filt, f0, f1, q, dur, g, atk, hold, curve, pr, pr1, sweep, to, shape, hp, lp, bp }
function burst(v, c = {}) {
  const a = v.a, s = v.s, t = v.t0 + (c.at || 0) / s;
  const dur = Math.max(0.003, jit(c.dur ?? 0.1, c.djit ?? 0.1) / s);
  const f0 = jit((c.f0 ?? 1000) * v.rate, c.fjit ?? 0.07), f1 = c.f1 == null ? f0 : jit(c.f1 * v.rate, c.fjit ?? 0.07);
  const g = Math.max(EPS, jit(c.g ?? 0.5, c.gjit ?? 0.12));
  const n = a.noise(c.type || 'white', c.pr ?? 1);
  if (c.pr1 != null) a.env(n.playbackRate, [[0, c.pr ?? 1], [dur, c.pr1, 'exp']], t);
  const f = a.filter(c.filt || 'bandpass', f0, c.q ?? 1);
  if (f1 !== f0) a.env(f.frequency, [[0, f0], [dur * (c.sweep ?? 1), f1, 'exp']], t);
  n.connect(f);
  const head = fx(v, f, c), gn = a.gain(0);
  ampEnv(v, gn.gain, t, dur, g, c);
  head.connect(gn); gn.connect(c.to || v.out);
  const tEnd = t + dur + 0.03; n.stop(tEnd); v.src(n, tEnd);
  return gn;
}
// Pitched tone with frequency sweep. { at, type, f0, f1, dur, g, atk, hold, curve, sweep, detune, vib:{f,depth}, to, shape, hp, lp, bp }
function tone(v, c = {}) {
  const a = v.a, s = v.s, t = v.t0 + (c.at || 0) / s;
  const dur = Math.max(0.005, jit(c.dur ?? 0.2, c.djit ?? 0.08) / s);
  const f0 = jit((c.f0 ?? 220) * v.rate, c.fjit ?? 0.03), f1 = c.f1 == null ? f0 : jit(c.f1 * v.rate, c.fjit ?? 0.03);
  const g = Math.max(EPS, jit(c.g ?? 0.4, c.gjit ?? 0.1));
  const o = a.osc(c.type || 'sine', f0, c.detune || 0);
  if (f1 !== f0) a.env(o.frequency, [[0, f0], [dur * (c.sweep ?? 1), f1, c.fcurve || 'exp']], t);
  if (c.vib) { const l = a.osc('sine', c.vib.f), lg = a.gain(c.vib.depth * v.rate); l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.03); v.src(l, t + dur); }
  const head = fx(v, o, c), gn = a.gain(0);
  ampEnv(v, gn.gain, t, dur, g, c);
  head.connect(gn); gn.connect(c.to || v.out);
  const tEnd = t + dur + 0.03; o.start(t); o.stop(tEnd); v.src(o, tEnd);
  return gn;
}
// Two-operator FM tone. { at, f0, f1, ratio, index, index1, dur, g, type, mtype, atk, hold, curve, shape, lp, bp, hp }
function fm(v, c = {}) {
  const a = v.a, s = v.s, t = v.t0 + (c.at || 0) / s;
  const dur = Math.max(0.01, jit(c.dur ?? 0.3, c.djit ?? 0.08) / s);
  const f0 = jit((c.f0 ?? 300) * v.rate, 0.03), f1 = c.f1 == null ? f0 : jit(c.f1 * v.rate, 0.03);
  const ratio = jit(c.ratio ?? 1.5, 0.02), i0 = c.index ?? 2, i1 = c.index1 ?? i0;
  const g = Math.max(EPS, jit(c.g ?? 0.3, 0.1));
  const car = a.osc(c.type || 'sine', f0), mod = a.osc(c.mtype || 'sine', f0 * ratio), mg = a.gain(i0 * f0);
  mod.connect(mg); mg.connect(car.frequency);
  a.env(car.frequency, [[0, f0], [dur, f1, 'exp']], t);
  a.env(mod.frequency, [[0, f0 * ratio], [dur, f1 * ratio, 'exp']], t);
  a.env(mg.gain, [[0, Math.max(1, i0 * f0)], [dur, Math.max(1, i1 * f1), 'exp']], t);
  const head = fx(v, car, c), gn = a.gain(0);
  ampEnv(v, gn.gain, t, dur, g, c);
  head.connect(gn); gn.connect(c.to || v.out);
  const tEnd = t + dur + 0.03; car.start(t); mod.start(t); car.stop(tEnd); mod.stop(tEnd); v.src(car, tEnd); v.src(mod, tEnd);
  return gn;
}
// Decaying partials (a struck object). { at, freqs, decay, g, type, fall, spread, to }
function ring(v, c = {}) {
  const freqs = c.freqs || [800, 1300], fall = c.fall ?? 0.75;
  freqs.forEach((f, i) => tone(v, { at: (c.at || 0) + rnd(0, c.spread ?? 0.004), type: c.type || 'sine', f0: f, dur: (c.decay ?? 0.2) * (1 - i * 0.08), g: (c.g ?? 0.2) * Math.pow(fall, i), atk: 0.0015, fjit: 0.015, djit: 0.25, to: c.to, lp: c.lp, shape: c.shape }));
}
// The 2 ms transient at the front of anything mechanical.
function click(v, c = {}) {
  burst(v, { at: c.at || 0, type: 'white', filt: 'bandpass', f0: c.f ?? 3000, q: c.q ?? 1.5, dur: c.dur ?? 0.004, g: c.g ?? 0.5, atk: 0.0005, to: c.to });
  if (c.body) tone(v, { at: c.at || 0, f0: (c.f ?? 3000) * 0.3, f1: (c.f ?? 3000) * 0.18, dur: c.dur ?? 0.006, g: (c.g ?? 0.5) * 0.4, atk: 0.0005, to: c.to });
}
// Low sine drop: the weight of a thing.
function thump(v, c = {}) { return tone(v, { at: c.at || 0, type: 'sine', f0: c.f0 ?? 90, f1: c.f1 ?? 30, dur: c.dur ?? 0.12, g: c.g ?? 0.8, atk: c.atk ?? 0.002, shape: c.shape, to: c.to, curve: c.curve }); }
// A short synthetic reverb tail: filtered noise darkening as it dies.
function tail(v, c = {}) { return burst(v, { at: c.at ?? 0.01, type: c.type || 'pink', filt: 'lowpass', f0: c.f0 ?? 2500, f1: c.f1 ?? 300, q: 0.5, dur: c.dur ?? 0.5, g: c.g ?? 0.15, atk: c.atk ?? 0.015, to: c.to }); }
// A clack: metal on metal (burst + short partials).
function clack(v, c = {}) {
  const f = c.f ?? 2200;
  burst(v, { at: c.at || 0, type: 'white', filt: 'bandpass', f0: f, q: c.q ?? 2, dur: c.dur ?? 0.015, g: c.g ?? 0.5, atk: 0.0008, to: c.to });
  ring(v, { at: c.at || 0, freqs: [f * 0.62, f * 1.07, f * 1.9], decay: c.decay ?? 0.06, g: (c.g ?? 0.5) * (c.ringMul ?? 0.22), to: c.to });
}
// Evenly spaced, jittered event times over a span (unscaled seconds); fn(at, i).
function seq(v, n, at, span, fn) { for (let i = 0; i < n; i++) fn(at + span * (i + rnd(0.12, 0.88)) / n, i); }
// Cloth rustle: overlapping soft pink bursts.
function cloth(v, c = {}) {
  seq(v, c.n ?? 3, c.at || 0, c.span ?? 0.2, (at) => burst(v, { at, type: 'pink', filt: 'bandpass', f0: rnd((c.f ?? 2500) * 0.7, (c.f ?? 2500) * 1.3), q: 0.8, dur: c.dur ?? 0.06, g: (c.g ?? 0.2) * rnd(0.6, 1), atk: 0.012, to: c.to }));
}
// Many tiny noise impulses through one filter (skitter, gravel, rattle). { n, at, span, dur, type, filt, f0, f1, q, g, decay, to }
function pulses(v, c = {}) {
  const a = v.a, s = v.s, tStart = v.t0 + (c.at || 0) / s, span = (c.span ?? 0.4) / s, n = Math.max(1, c.n ?? 8);
  const src = a.noise(c.type || 'white'), f = a.filter(c.filt || 'bandpass', (c.f0 ?? 3000) * v.rate, c.q ?? 3), gn = a.gain(0);
  src.connect(f); f.connect(gn); gn.connect(c.to || v.out);
  const slot = span / n; let last = tStart;
  gn.gain.setValueAtTime(EPS, tStart);
  for (let i = 0; i < n; i++) {
    const ti = tStart + slot * (i + rnd(0.1, 0.9));
    const d = Math.min(slot * 0.8, Math.max(0.002, jit(c.dur ?? 0.008, 0.3) / s));
    const g = Math.max(EPS, (c.g ?? 0.4) * jit(1, 0.3) * Math.pow(c.decay ?? 1, i));
    f.frequency.setValueAtTime(rnd(c.f0 ?? 3000, c.f1 ?? c.f0 ?? 3000) * v.rate, ti);
    gn.gain.setValueAtTime(EPS, ti); gn.gain.linearRampToValueAtTime(g, ti + 0.001); gn.gain.exponentialRampToValueAtTime(EPS, ti + d);
    last = ti + d;
  }
  const tEnd = last + 0.05; src.stop(tEnd); v.src(src, tEnd);
  return gn;
}
// Cluster of short high sines (glass, brass, chime). { n, at, span, f0, f1, dur, g, type }
function tinkle(v, c = {}) {
  seq(v, c.n ?? 6, c.at || 0, c.span ?? 0.25, (at) => tone(v, { at, type: c.type || 'sine', f0: rnd(c.f0 ?? 2500, c.f1 ?? 6500), dur: (c.dur ?? 0.08) * rnd(0.6, 1.4), g: (c.g ?? 0.08) * rnd(0.5, 1), atk: 0.001 }));
}
// Tremolo gain stage: route builders into it with { to }. { freq, depth (<= 0.5 clean), dur, at }
function trem(v, c = {}) {
  const a = v.a, s = v.s, t = v.t0 + (c.at || 0) / s, depth = clamp(c.depth ?? 0.4, 0, 0.5);
  const g = a.gain(1 - depth), l = a.osc('sine', c.freq ?? 20), lg = a.gain(depth);
  l.connect(lg); lg.connect(g.gain); g.connect(c.to || v.out);
  const tEnd = t + (c.dur ?? 0.5) / s + 0.1; l.start(t); l.stop(tEnd); v.src(l, tEnd);
  return g;
}
// A throaty vocal pulse (hurt, cough): saw through a lowpass + drive, doubled by band-limited noise.
function grunt(v, c = {}) {
  tone(v, { at: c.at || 0, type: 'sawtooth', f0: c.f0 ?? 120, f1: c.f1 ?? 80, dur: c.dur ?? 0.16, g: (c.g ?? 0.4) * 0.6, atk: c.atk ?? 0.015, lp: c.lp ?? 550, lq: 1.2, shape: 14 });
  burst(v, { at: c.at || 0, type: 'pink', filt: 'bandpass', f0: (c.f0 ?? 120) * 2.6, f1: (c.f1 ?? 80) * 2.4, q: 1.6, dur: c.dur ?? 0.16, g: c.g ?? 0.4, atk: c.atk ?? 0.012 });
}
// ===============================================================================================================
// MUZZLE BLAST — the physics, because a gunshot is not a note.
//
// What leaves the muzzle is a few grams of propellant gas at several hundred atmospheres tearing into still air.
// The front steepens into a shock with a rise time of tens of MICROseconds, then decays through zero into a
// rarefaction: a Friedlander wave,  p(t) = P (1 - t/tau) e^(-t/tau),  whose integral over all time is exactly zero
// and which therefore carries no pitch whatever. Everything a listener uses to tell one weapon from another lives
// in that shape and in what rides on it:
//   tau   positive-phase duration, set by the volume of gas, so it scales with the CUBE ROOT of the propellant
//         charge. The wave's spectrum peaks at 1/(2*pi*tau): 0.25 g of Makarov powder lands near 650 Hz, 1.6 g of
//         7.62x39 near 350 Hz, 3.1 g of 7.62x54R near 280 Hz. That is the whole of "small gun / big gun".
//   rise  shock thickness, set by chamber pressure. 380 MPa of 5.56 gives a ~28 us front that reads as a whipcrack;
//         105 MPa of shotshell gives ~70 us and reads as a door slamming. Nothing else in the recipe controls
//         "sharp" so directly, and no gain ramp can imitate it: a 3 ms attack is a hundred times too slow.
//   mp    muzzle pressure — gas still under pressure when the bullet uncorks the bore. Shortening a barrel raises
//         it steeply ((design length / actual length)^0.55), which is exactly why an AKS-74U or a sawn-off Mosin
//         is so much louder and harsher than the full-length rifle firing the same cartridge.
//   jet   once the shock is away the gas keeps escaping as a turbulent supersonic jet for several milliseconds.
//         That is broadband noise, and it is most of the roar of a large charge.
// Riding on top, but separate: the bullet's own N-wave when it is supersonic; the first reflections off the ground
// and the shooter's own body; the environment's reverberant tail. And the action — the bolt, the slide, the case —
// which is real but QUIETER and LATER, and must never be fused into the report as a ringing partial. Doing that is
// how you build a cowbell: a pitched body with struck-metal overtones over it.
//
// The shock and the jet are computed as an actual waveform into an AudioBuffer (cached per weapon, three variants)
// because no envelope on a gain node can produce a 30 us rise; automation is quantised to the render block and the
// fastest linearRamp still takes a millisecond to matter. Everything else is scheduled around it.
const KERNELS = new Map();
// fill() may return the divisor to normalise by. Returning one (rather than letting the peak sample decide)
// keeps the SHOCK the reference: the turbulent jet is noise, and a noise realisation that happens to spike
// above the shock front would otherwise scale the whole blast down by however unlucky that sample was, which
// is both a level bug and a way to lose the very transient the sound is about. Anything left above 1 after
// that is softly compressed rather than clipped — which is also what nonlinear propagation does to a shock.
function kernel(a, key, samples, fill) {
  const sr = a.ctx.sampleRate, k = key + '@' + sr;
  let b = KERNELS.get(k);
  if (b) return b;
  const n = Math.max(8, Math.ceil(samples));
  b = a.ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const norm = fill(d, sr, n);
  let mean = 0; for (let i = 0; i < n; i++) mean += d[i];
  mean /= n;
  if (norm > 0) {
    const kk = 0.9, sc = Math.tanh(kk);
    for (let i = 0; i < n; i++) d[i] = Math.tanh((d[i] - mean) / norm * kk) / sc;
  } else {
    let mx = 0; for (let i = 0; i < n; i++) { d[i] -= mean; const x = Math.abs(d[i]); if (x > mx) mx = x; }
    if (mx > 1e-9) for (let i = 0; i < n; i++) d[i] /= mx;
  }
  KERNELS.set(k, b);
  return b;
}
// The blast itself: a two-timescale Friedlander wave (the shock, plus the slower expansion of the whole powder-gas
// cloud that gives a big charge its weight) with the turbulent jet noise decaying over it.
function blastKernel(a, id, P, variant) {
  // Shot-to-shot variety is baked into the three variants (a few percent of charge and shock thickness)
  // rather than taken from playbackRate: resampling a one-sample shock front interpolates it away, and with
  // it a third of the peak. The direct blast therefore always plays at exactly the caller's rate.
  const jv = 1 + (variant - 1) * 0.045, tau = P.tau * jv, rise = P.rise * (1 + (variant - 1) * 0.12);
  const len = Math.max(40 * tau, 6 * P.jetDur) + 0.002;
  return kernel(a, 'blast:' + id + ':' + variant, len * a.ctx.sampleRate, (d, sr, n) => {
    const riseN = Math.max(1.15, rise * sr), tau2 = tau * 5.5;
    const k1 = 1 - Math.exp(-2 * Math.PI * Math.min(sr * 0.45, P.jetLp) / sr);
    const k2 = 1 - Math.exp(-2 * Math.PI * Math.min(sr * 0.45, P.jetLp * 3.4) / sr);
    let lp1 = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, w = Math.random() * 2 - 1;
      lp1 += (w - lp1) * k1; lp2 += (w - lp2) * k2;
      const r = i < riseN ? 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / riseN) : 1;
      const f1 = (1 - t / tau) * Math.exp(-t / tau);
      const f2 = (1 - t / tau2) * Math.exp(-t / tau2);
      // The jet builds over a few hundred microseconds, AFTER the shock has gone by: the turbulence needs the
      // gas to be out of the bore before it can make any noise. That also keeps the noise off the shock front,
      // so the front stays the loudest sample in the buffer and the level of a shot stays predictable.
      const jetE = Math.exp(-t / P.jetDur) * (1 - Math.exp(-t / (rise * 10 + 2.5e-4)));
      const hiE = Math.exp(-t / (P.jetDur * 0.3));
      d[i] = r * (f1 + P.a2 * f2) + P.jet * jetE * (lp1 * 2.0 + P.hf * lp2 * hiE * 1.1);
    }
    return 1 + P.a2;                                                    // the analytic height of the shock front
  });
}
// The bullet's N-wave: pressure jumps up, falls linearly through zero to an equal underpressure, jumps back.
// Duration comes from the standard weak-shock result T ~ 1.82 M L / (c (M^2-1)^(3/8)) * (b/L)^(1/4), so a fast
// small round makes a short, bright snap and a slow fat one makes a duller crack.
function nwaveKernel(a, id, T, rise) {
  return kernel(a, 'nwave:' + id, (T + 2 * rise) * a.ctx.sampleRate + 4, (d, sr, n) => {
    const riseN = Math.max(1.1, rise * sr), tn = Math.max(riseN + 1, T * sr);
    for (let i = 0; i < n; i++) {
      const x = i + 0.5;
      d[i] = x < riseN ? 0.5 - 0.5 * Math.cos(Math.PI * x / riseN)
        : x < tn ? 1 - 2 * (x - riseN) / (tn - riseN)
          : x < tn + riseN ? -(0.5 + 0.5 * Math.cos(Math.PI * (x - tn) / riseN)) : 0;
    }
  });
}
// Schedule a kernel. Sample-accurate start, optional filtering, always a scheduled stop.
function kplay(v, buf, c = {}) {
  const a = v.a, t = v.t0 + (c.at || 0) / v.s;
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const rate = clamp((c.rate || 1) * v.rate, 0.06, 8);
  src.playbackRate.value = rate;
  let head = src;
  if (c.hp) { const f = a.filter('highpass', c.hp, c.hq ?? 0.7); head.connect(f); head = f; }
  if (c.lp) { const f = a.filter('lowpass', c.lp, c.lq ?? 0.7); head.connect(f); head = f; }
  if (c.lp2) { const f = a.filter('lowpass', c.lp2, 0.7); head.connect(f); head = f; }
  if (c.shape) { const w = a.shaper(c.shape); head.connect(w); head = w; }
  const gn = a.gain(Math.max(EPS, c.g ?? 1));
  head.connect(gn); gn.connect(c.to || v.out);
  const tEnd = t + buf.duration / rate + 0.01;
  src.start(t); src.stop(tEnd); v.src(src, tEnd);
  return gn;
}

// Cartridges. chg = propellant charge in grams (this sets the size of the blast), bore in mm, p = peak chamber
// pressure in MPa (this sets the sharpness of the shock), v = muzzle velocity at the reference barrel, ref = the
// barrel length the cartridge was designed around, gas = extra gas volume beyond the powder (a shot column).
const CAL = {
  '9x18': { chg: 0.25, bore: 9.3, p: 160, v: 315, ref: 100 },
  '9x19': { chg: 0.40, bore: 9.0, p: 235, v: 375, ref: 115 },
  '7.62x25': { chg: 0.50, bore: 7.9, p: 245, v: 430, ref: 116 },
  '.45': { chg: 0.35, bore: 11.5, p: 130, v: 260, ref: 127 },
  '5.45x39': { chg: 1.45, bore: 5.6, p: 300, v: 880, ref: 415 },
  '7.62x39': { chg: 1.60, bore: 7.9, p: 355, v: 715, ref: 415 },
  '5.56x45': { chg: 1.70, bore: 5.7, p: 380, v: 900, ref: 415 },
  '9x39': { chg: 0.60, bore: 9.2, p: 245, v: 295, ref: 200 },
  '7.62x54': { chg: 3.10, bore: 7.9, p: 390, v: 830, ref: 700 },
  '12ga': { chg: 1.70, bore: 18.5, p: 105, v: 400, ref: 700, gas: 1.55 },
};
// Everything the report is built from, derived from the cartridge and the barrel. Nothing here is a free number
// except the two mix constants at the end, which set how loud a gunshot is against the rest of the game.
function makeSpec(o) {
  const C = o.cal ? CAL[o.cal] : o, barrel = o.barrel || C.ref;
  const mp = clamp(Math.pow(C.ref / barrel, 0.55), 0.72, 2.3);           // muzzle pressure vs the design length
  const brake = o.mod === 'brake' ? 1 : 0, can = o.mod === 'can' || o.sup ? 1 : 0;
  const gas = C.chg * (C.gas || 1);
  const tauOpen = 0.45e-3 * Math.cbrt(gas / 1.6) * Math.pow(mp, 0.25);   // the bare muzzle
  const tau = tauOpen * (can ? 2.6 : 1);                                 // a can holds the gas and slows the release
  const rise = 34e-6 * Math.pow(300 / C.p, 0.7) / Math.pow(mp, 0.35) * (can ? 5.5 : 1);
  const v0 = C.v * Math.pow(barrel / C.ref, 0.2);
  const mach = v0 / 343;
  // Acoustic energy tracks the propellant charge and the pressure it burns at, NOT the gas volume: a shotshell
  // moves a lot of gas slowly at 105 MPa and is quieter than a rifle round burning half as much powder at 390.
  const energy = C.chg * mp * Math.pow(C.p / 300, 0.25);
  const S = {
    id: (o.id || o.cal) + '|' + Math.round(barrel) + (o.mod || '') + (can ? 's' : ''),
    tau, rise, mach, can, brake, mp, bore: C.bore,
    a2: can ? 0.62 : 0.46 + 0.16 * Math.min(1, gas / 2),                // weight of the slow gas-cloud lobe
    jet: (can ? 1.6 : 0.72 + 0.42 * Math.min(1.6, mp - 0.6)) * (1 + 0.25 * brake),
    jetDur: tau * (can ? 30 : 16) + 0.0025,
    jetLp: clamp(3400 * Math.pow(0.45e-3 / tau, 0.4) * Math.pow(C.p / 300, 0.25) * Math.pow(mp, 0.3) * (can ? 0.34 : 1), 300, 9000),
    hf: clamp(Math.pow(C.p / 300, 0.8) * Math.pow(mp, 0.4) * (can ? 0.2 : 1), 0.1, 2.2),
    big: clamp(tauOpen / 0.45e-3, 0.5, 2),                              // how big the space has to answer for
    tailG: can ? 0.3 : 1,
    // 0.80 and the 0.10 exponent are the mix, and the only two numbers here chosen for the game rather than
    // from the physics: they put a Makarov at the reference peak (0.80 raw, 0.64 through the master bus) and
    // compress the real 20 dB between a Makarov and a PKM into about 3 dB, which is all a game mix can carry.
    // The ORDER is still the physics: charge, muzzle pressure and chamber pressure decide it, so the sawn-off
    // Mosin is the loudest thing in the game and the Makarov the quietest, without anyone typing that in.
    // mechG is that same figure WITHOUT the can, because a suppressor silences the blast and not the bolt —
    // that inversion is the whole reason a suppressed weapon sounds clacky and wet rather than merely quiet.
    mechG: 0.80 * Math.pow(energy / 0.233, 0.10) * (1 + 0.06 * brake),
  };
  S.g = S.mechG * (can ? 0.30 : 1);
  // Supersonic bullets drag an N-wave behind them; the shooter stands inside its cone, a few decimetres off axis.
  // Subsonic rounds (9x18, .45, every 9x39 load) have none at all, and that absence is most of why they sound flat.
  S.crack = mach > 1.06 ? clamp(0.5 * Math.sqrt(clamp(mach - 1, 0, 2)) * Math.pow(C.bore / 7.9, 0.55) * (C.gas ? 0.35 : 1), 0, 0.9) : 0;
  const L = C.bore * 3.3e-3;                                            // bullet length, m
  S.crackT = S.crack ? 1.82 * mach * L / (343 * Math.pow(Math.max(0.05, mach * mach - 1), 0.375)) * Math.pow(0.15 / L, 0.25) : 0;
  S.action = o.action || 'piston';
  return S;
}
// Metal hitting metal, the way an action actually does it: a hard broadband impact with the part's resonances
// shaped out of NOISE and gone inside 30-50 ms. Tuned sine partials over a transient are how you build a
// cowbell; a bolt carrier is a heavy thing hitting a stop, and it is over almost before it started.
function mknock(v, at, f, g, q, dur) { burst(v, { at, type: 'white', filt: 'bandpass', f0: f, q: q ?? 2.2, dur: dur ?? 0.008, g, atk: 0.0004, fjit: 0.1 }); }
function mclunk(v, at, f, g) {
  tone(v, { at, type: 'sine', f0: f, f1: f * 0.62, dur: 0.009, g, atk: 0.0006 });   // one lobe: weight, not pitch
  burst(v, { at, type: 'brown', filt: 'lowpass', f0: f * 4, q: 0.7, dur: 0.012, g: g * 0.8, atk: 0.0005 });
}
function metal(v, c = {}) {
  const at = c.at || 0, f = c.f ?? 1800, g = c.g ?? 0.5, dk = c.decay ?? 0.035;
  mknock(v, at, f * 1.75, g, 1.2, c.dur ?? 0.008);
  burst(v, { at, type: 'white', filt: 'bandpass', f0: f, q: 7, dur: dk, g: g * 0.45, atk: 0.0006, fjit: 0.05 });
  burst(v, { at: at + 0.0012, type: 'white', filt: 'bandpass', f0: f * 1.63, q: 8, dur: dk * 0.7, g: g * 0.26, atk: 0.0006, fjit: 0.05 });
  if (c.low) mclunk(v, at, c.low, g * 0.6);
}
// Mechanical noise: the action, at -20 dB and 20-90 ms behind the shot, never inside it.
function actionNoise(v, S, g) {
  const A = S.action, k = g * (S.can ? 1.9 : 1);                        // with a can on, the action is what you hear
  const knock = (at, f, gg, q, dur) => mknock(v, at, f, gg, q, dur);
  const clunk = (at, f, gg) => mclunk(v, at, f, gg);
  if (A === 'piston' || A === 'belt' || A === 'gasshot') {
    const t1 = rnd(0.020, 0.030), t2 = t1 + rnd(0.026, 0.040);
    knock(t1, 2100, 0.55 * k, 1.8, 0.010); clunk(t1, 148, 0.42 * k);
    knock(t1 + 0.004, 3400, 0.22 * k, 3, 0.006);
    knock(t2, 1750, 0.75 * k, 1.6, 0.012); clunk(t2, 122, 0.6 * k);
    knock(t2 + 0.005, 2900, 0.25 * k, 3, 0.007);
    if (A === 'belt') pulses(v, { n: irnd(3, 5), at: t1, span: 0.05, type: 'white', f0: 2600, f1: 4200, q: 4, dur: 0.005, g: 0.22 * k, decay: 0.8 });
  } else if (A === 'ar') {
    const t1 = rnd(0.016, 0.024), t2 = t1 + rnd(0.030, 0.042);
    knock(t1, 2600, 0.5 * k, 2.2, 0.008); clunk(t1, 160, 0.3 * k);
    knock(t2, 2000, 0.6 * k, 1.8, 0.010); clunk(t2, 135, 0.42 * k);
    // the buffer spring: the one honestly tonal thing in a rifle, and it belongs 25 dB down
    tone(v, { at: t1 + 0.004, type: 'sawtooth', f0: rnd(430, 520), f1: 300, dur: 0.05, g: 0.055 * k, atk: 0.002, lp: 1400, lq: 2.4 });
  } else if (A === 'slide') {
    const t1 = rnd(0.014, 0.020), t2 = t1 + rnd(0.020, 0.030);
    knock(t1, 3000, 0.5 * k, 2.4, 0.006); clunk(t1, 210, 0.24 * k);
    knock(t2, 2400, 0.7 * k, 2.0, 0.008); clunk(t2, 175, 0.4 * k);
  } else if (A === 'open' || A === 'blow' || A === 'roller') {
    // an open bolt is already running: the carrier slams home a hair BEFORE the primer goes
    knock(-0.006, 1500, 0.7 * k, 1.5, 0.012); clunk(-0.006, 115, 0.55 * k);
    const t2 = rnd(0.026, 0.040);
    knock(t2, 1900, 0.5 * k, 1.8, 0.010); clunk(t2, 140, 0.35 * k);
  }
  // brass on the ground, a long way behind everything else
  if (A !== 'bolt' && A !== 'break' && A !== 'pump' && Math.random() < 0.55) {
    const at = rnd(0.20, 0.42), f = rnd(3200, 5200);
    burst(v, { at, type: 'white', filt: 'bandpass', f0: f, q: 5, dur: 0.006, g: 0.10 * g, atk: 0.0004 });
    burst(v, { at: at + rnd(0.03, 0.07), type: 'white', filt: 'bandpass', f0: f * 1.2, q: 6, dur: 0.004, g: 0.05 * g, atk: 0.0004 });
  }
}
// The full report: blast, its reflections, the bullet's crack, the space it happened in, and the action.
function report(v, S, o = {}) {
  const a = v.a, envG = o.space ?? 1;
  // The crack lands within a couple of hundred microseconds of the blast, so the two sum at the peak. Dividing
  // by that sum makes the rendered peak equal S.g, which keeps the level table honest: a weapon is louder here
  // because its charge is bigger, not because its bullet happens to be supersonic.
  const g = S.g * (o.g ?? 1) / (1 + (S.crack > 0.02 ? 0.55 * S.crack : 0));
  const kv = irnd(0, 2), kb = blastKernel(a, S.id, S, kv);
  kplay(v, kb, { g });
  // Reflections in the first few milliseconds: the shooter's own body and gun, then the ground under him. Each uses
  // a different noise realisation of the same blast so the pair does not comb into a metallic colour.
  kplay(v, blastKernel(a, S.id, S, (kv + 1) % 3), { at: rnd(0.0012, 0.0026), g: g * 0.32, lp: 3600, rate: jit(1, 0.05) });
  kplay(v, blastKernel(a, S.id, S, (kv + 2) % 3), { at: rnd(0.0068, 0.0098), g: g * 0.42 * envG, lp: 1900, rate: jit(1, 0.05) });
  if (S.brake) kplay(v, blastKernel(a, S.id, S, (kv + 2) % 3), { at: rnd(0.0004, 0.0011), g: g * 0.34, hp: 700, rate: jit(1.1, 0.05) });
  // Ballistic crack: a real N-wave, arriving with the blast because the bullet is only now leaving.
  if (S.crack > 0.02) {
    const nb = nwaveKernel(a, S.id, S.crackT, S.rise * 0.8);
    kplay(v, nb, { at: rnd(0.0001, 0.0004), g: g * S.crack * 0.8, hp: 320, rate: jit(1, 0.06) });
  }
  // The space. Early scattering off ground clutter and trees, then a dark decay: this is the part players use to
  // judge distance, and it is the environment's sound, not the gun's.
  const tl = (o.tail ?? 1) * envG * S.tailG, big = S.big;
  seq(v, irnd(4, 6), 0.008, 0.060, (at) => burst(v, { at, type: 'pink', filt: 'lowpass', f0: rnd(900, 2400), f1: 500, q: 0.6, dur: rnd(0.02, 0.05), g: 0.28 * g * tl, atk: 0.004 }));
  burst(v, { at: 0.016, type: 'pink', filt: 'lowpass', f0: 1500 / big, f1: 190, q: 0.5, dur: (0.28 + 0.34 * big) * (o.tailDur ?? 1), g: 0.34 * g * tl, atk: 0.022 });
  burst(v, { at: 0.012, type: 'brown', filt: 'lowpass', f0: 420, f1: 120, q: 0.6, dur: 0.10 + 0.16 * big, g: 0.34 * g * tl * big, atk: 0.008 });
  if (big > 0.85 && tl > 0.2) kplay(v, kb, { at: rnd(0.085, 0.20), g: g * 0.085 * tl, lp: 620, lp2: 900, rate: jit(0.94, 0.04) });
  actionNoise(v, S, (o.mech ?? 1) * S.mechG * (o.g ?? 1) * 0.11);
}
// The name the rest of the game knows. `p.spec` is the physical description; the old keyword form is still
// understood (voices.js hands it one) and is mapped onto a cartridge rather than reproduced.
function gunshot(v, p = {}) {
  const S = p.spec || makeSpec({
    chg: clamp(1.6 * Math.pow(95 / (p.thumpF0 ?? 90), 2.2) * (p.boomG ? 1.5 : 1), 0.2, 3.6),
    bore: 7.9, p: clamp(300 * (p.crackF0 ?? 4000) / 4000, 120, 400), v: 715, ref: 415,
    barrel: 415, action: (p.mech && p.mech.length) ? 'piston' : 'bolt', id: 'legacy' + Math.round(p.thumpF0 ?? 90) + (p.boomG ? 'b' : ''),
  });
  report(v, S, { tail: (p.tailG ?? 0.18) / 0.18 });
}

// ---------------------------------------------------------------------------------------------------------------
// Loop voice: tracks every source/node so stop() tears down the whole graph; `setters` map set(k,v); `tick(dt)`.
function loopVoice(a, out, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const r = +o.rate, rate = clamp(Number.isFinite(r) && r > 0 ? r : 1, 0.25, 4);
  const L = {
    a, out, o, rate, srcs: [], nodes: [], setters: {}, tick: null,
    keep(n) { L.nodes.push(n); return n; },
    noise(type, filt, f, q, g, to, pr = 1) { const n = a.noise(type, pr); const fl = a.filter(filt, f, q); const gn = a.gain(g); n.connect(fl); fl.connect(gn); gn.connect(to || L.out); L.srcs.push(n); L.nodes.push(fl, gn); return { n, f: fl, g: gn }; },
    osc(type, f, g, to, detune = 0) { const os = a.osc(type, f, detune); const gn = a.gain(g); os.connect(gn); gn.connect(to || L.out); os.start(a.now); L.srcs.push(os); L.nodes.push(gn); return { o: os, g: gn }; },
    lfo(param, freq, depth, type = 'sine') { const l = a.osc(type, freq); const lg = a.gain(depth); l.connect(lg); lg.connect(param); l.start(a.now + rnd(0, 0.4)); L.srcs.push(l); L.nodes.push(lg); return l; },
    target(param, v, tc = 0.1) { try { param.setTargetAtTime(v, a.now, tc); } catch {} },
    stop() { for (const s of L.srcs) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} } for (const n of L.nodes) { try { n.disconnect(); } catch {} } L.srcs.length = 0; L.nodes.length = 0; L.tick = null; },
  };
  return L;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-sound level trims (multiplier on the recipe's raw layer sum), calibrated from an offline render of every sound in
// isolation (tools/scenarios/sfx-review.mjs): gunshots and shocks pulled down to a raw peak of ~1.2 so the engine's
// compressor is not the only thing between the muzzle and the speaker; whispers pulled up so a crow at 40 m, a slider's
// click in the grass or a cloth rustle at ADS are actually audible under the wind. Everything else sits at 1.
const LEVEL = {
  // The gunshots carry NO trims any more. Their level is set inside makeSpec from the charge, the muzzle
  // pressure and the chamber pressure, so a trim here would only be a second opinion about the same thing —
  // and the old trims (mosin 0.72, akm 0.85, toz 0.8) were calibrated against a recipe that no longer exists.
  seeker_shot: 0.76, mimic_shot: 0.9, fragment_explode: 0.88, seeker_death: 0.8, seeker_step: 0.8,
  door_open: 0.85, door_close: 0.85, death: 0.95, ui_stamp: 0.8,
  crow: 5, bird: 3, slider_screech: 3, slider_click: 1.8, slider_death: 2.2, slider_lunge: 1.8, slider_step: 1.8, mimic_radio: 2.2, mimic_skip: 3,
  spawn_skitter: 3, spawn_death: 1.6, spawn_bite: 1.4, seeker_hiss: 1.4, reflector_whip: 1.3, bullet_whiz: 1.4, impact_concrete: 1.3, drip: 1.4, gas_cough: 2.5,
  phantom_hiss: 1.5, phantom_scream: 1.25, phantom_grab: 0.9,
  armor_hit: 0.75, armor_pen: 0.8, helmet_ring: 0.68, ricochet: 2.2, thunder: 1.0,
  ads_in: 4, ads_out: 3.8, click: 4.5, jump: 3.2, ui_slip: 3, ui_click: 1.8, ui_open: 1.3, hurt: 1.3,
  mag_load_round: 3, probe_throw: 3, probe_land: 2, weapon_holster: 2.8, weapon_draw: 2.2, pickup_item: 3, pickup_ammo: 2.2, reload_magout: 2.6,
  bandage_use: 2.5, medkit_use: 1.6, stim_use: 1.3, step_grass: 2, dry_click: 1.8, bolt_open: 2, shell_insert: 1.5, break_open: 1.5, unjam: 1.5,
  container_open: 1.5, artifact_pickup: 1.6, step_road: 1.5, step_concrete: 1.4,
  wind: 1.6, drizzle: 1.5, fragment_chime: 0.8, breath: 1.8,
  // The eight above were calibrated the same way, against shot_pm's 0.70 peak on the master bus: an
  // armour plate has no business being louder than the rifle whose round it just stopped.
};

export function registerSfx(audio) {
  if (!audio || typeof audio.register !== 'function') return;
  const trim = (a, out, name) => { const lv = LEVEL[name]; if (lv == null || lv === 1) return null; const g = a.gain(lv); g.connect(out); return g; };
  const def = (name, fn) => audio.register(name, (a, out, opts) => {
    const v = voice(a, out, opts);
    const t = trim(a, out, name); if (t) v.out = t;
    try { fn(v); } catch (e) { console.warn('sfx ' + name, e); }
    return { stop() { for (const s of v.srcs) { try { s.stop(); } catch {} } } };
  });
  const defLoop = (name, fn) => audio.registerLoop(name, (a, out, opts) => {
    const L = loopVoice(a, out, opts);
    const t = trim(a, out, name); if (t) { L.out = t; L.nodes.push(t); }
    try { fn(L); } catch (e) { console.warn('loop ' + name, e); }
    return { stop: () => L.stop(), set: (k, val) => { try { L.setters[k]?.(+val); } catch {} }, update: (dt) => { try { L.tick?.(dt); } catch {} } };
  });
  const H = { EPS, rnd, irnd, jit, clamp, pick, voice, burst, tone, fm, ring, click, thump, tail, clack, seq, cloth, pulses, tinkle, trem, grunt, gunshot, def, defLoop };

  // ===================================================== footsteps ==============================================
  def('step_mud', (v) => {
    thump(v, { f0: 70, f1: 40, dur: 0.09, g: 0.8 });
    burst(v, { type: 'pink', filt: 'bandpass', f0: 900, f1: 320, q: 1.3, dur: 0.12, g: 0.45, atk: 0.012, pr: 1.1, pr1: 0.6 });
    pulses(v, { n: irnd(2, 4), at: 0.015, span: 0.07, type: 'white', f0: 1800, f1: 3200, q: 3, dur: 0.008, g: 0.12 });
  });
  def('step_grass', (v) => {
    burst(v, { type: 'pink', filt: 'highpass', f0: 800, q: 0.6, dur: 0.07, g: 0.55, atk: 0.014 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 320, q: 0.7, dur: 0.05, g: 0.35, atk: 0.006 });
    if (Math.random() < 0.5) burst(v, { at: 0.03, type: 'pink', filt: 'bandpass', f0: 2600, q: 1.2, dur: 0.03, g: 0.12, atk: 0.005 });
  });
  const hardTap = (v, f, g, low) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: f, q: 0.9, dur: 0.025, g, atk: 0.0008 });
    click(v, { f: f * 2, g: g * 0.35, dur: 0.003 });
    tone(v, { f0: low, f1: low * 0.6, dur: 0.04, g: g * 0.45, atk: 0.001 });
  };
  def('step_road', (v) => hardTap(v, 2000, 0.6, 130));
  def('step_concrete', (v) => { hardTap(v, 2600, 0.6, 150); ring(v, { freqs: [1900], decay: 0.06, g: 0.06 }); });
  def('step_rock', (v) => { hardTap(v, 1500, 0.75, 160); ring(v, { freqs: [2400, 3700], decay: 0.09, g: 0.07 }); burst(v, { at: 0.01, type: 'white', filt: 'bandpass', f0: 4000, q: 2, dur: 0.02, g: 0.12 }); });
  def('step_metal', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, q: 1, dur: 0.015, g: 0.55, atk: 0.0008 });
    ring(v, { freqs: [900, 1400, 2300], decay: 0.25, g: 0.18, fall: 0.7 });
    thump(v, { f0: 110, f1: 60, dur: 0.06, g: 0.3 });
  });
  def('step_wood', (v) => {
    tone(v, { f0: 180, f1: 120, dur: 0.04, g: 0.65, atk: 0.001 });
    burst(v, { type: 'white', filt: 'lowpass', f0: 1200, q: 0.7, dur: 0.03, g: 0.4, atk: 0.001 });
    ring(v, { freqs: [420, 700], decay: 0.08, g: 0.08 });
  });
  def('step_water', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 4000, f1: 600, q: 0.8, dur: 0.2, g: 0.55, atk: 0.01 });
    thump(v, { f0: 80, f1: 50, dur: 0.08, g: 0.3 });
    tinkle(v, { n: irnd(2, 3), at: 0.06, span: 0.16, f0: 1500, f1: 2600, dur: 0.03, g: 0.05 });
  });
  def('land', (v) => {
    thump(v, { f0: 90, f1: 35, dur: 0.18, g: 1.0 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 600, f1: 200, q: 0.7, dur: 0.14, g: 0.5, atk: 0.004 });
    burst(v, { type: 'pink', filt: 'bandpass', f0: 1200, q: 0.8, dur: 0.06, g: 0.25, atk: 0.003 });
    cloth(v, { at: 0.02, n: 3, span: 0.18, g: 0.16 });
  });
  def('jump', (v) => { cloth(v, { n: 3, span: 0.12, f: 2400, g: 0.24 }); burst(v, { type: 'brown', filt: 'lowpass', f0: 400, q: 0.7, dur: 0.06, g: 0.25, atk: 0.008 }); });

  // ===================================================== player =================================================
  def('hurt', (v) => { grunt(v, { f0: 125, f1: 78, dur: 0.18, g: 0.5 }); thump(v, { f0: 80, f1: 40, dur: 0.12, g: 0.6 }); });
  def('hurt_bullet', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 2200, f1: 500, q: 1, dur: 0.05, g: 0.5, atk: 0.001 });
    grunt(v, { at: 0.01, f0: 150, f1: 90, dur: 0.12, g: 0.5, atk: 0.006 });
    thump(v, { f0: 90, f1: 40, dur: 0.1, g: 0.6 });
  });
  // Armour impacts: damage.js has played these three since the armour system landed and none of them
  // existed, so a plate stopping a rifle round made the same noise as one that was not there.
  // A round the plate stops: a flat hard slap into the chest, the ceramic cracking, and the carrier
  // taking the load. No ring-out — a plate is a dead thing that just moved.
  def('armor_hit', (v) => {
    click(v, { f: 5200, g: 0.5, dur: 0.003 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 3200, f1: 900, q: 1.1, dur: 0.045, g: 0.85, atk: 0.0006 });
    thump(v, { f0: 150, f1: 52, dur: 0.13, g: 1.0 });
    ring(v, { at: 0.002, freqs: [1180, 1930, 2740], decay: 0.055, g: 0.22, fall: 0.6 });
    cloth(v, { at: 0.02, n: 3, span: 0.14, f: 1800, g: 0.22 });
    grunt(v, { at: 0.05, f0: 140, f1: 96, dur: 0.14, g: 0.3, atk: 0.02 });
  });
  // The plate loses: less slap, more punch-through — a duller entry, the backing tearing, and the body
  // behind it taking what the ceramic did not.
  def('armor_pen', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 2600, f1: 600, q: 0.9, dur: 0.05, g: 0.6, atk: 0.0008 });
    burst(v, { at: 0.008, type: 'pink', filt: 'bandpass', f0: 1400, f1: 380, q: 1.4, dur: 0.11, g: 0.5, atk: 0.004, pr: 1.15, pr1: 0.55 });
    thump(v, { f0: 105, f1: 40, dur: 0.14, g: 0.9 });
    pulses(v, { n: irnd(3, 5), at: 0.012, span: 0.09, type: 'white', f0: 2400, f1: 3600, q: 3, dur: 0.007, g: 0.2, decay: 0.7 });
    grunt(v, { at: 0.02, f0: 158, f1: 88, dur: 0.16, g: 0.55, atk: 0.008 });
  });
  // A round off the helmet: the shell rings, and so does the head inside it — the low sine is the part
  // that lingers after the metal has stopped.
  def('helmet_ring', (v) => {
    click(v, { f: 6000, g: 0.6, dur: 0.003 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 4200, f1: 1600, q: 1.2, dur: 0.04, g: 0.8, atk: 0.0005 });
    ring(v, { freqs: [1640, 2480, 3310, 4720], decay: 0.55, g: 0.4, fall: 0.62, spread: 0.002 });
    thump(v, { f0: 190, f1: 70, dur: 0.1, g: 0.7 });
    tone(v, { at: 0.01, f0: 900, f1: 820, dur: 1.6, g: 0.16, atk: 0.02, curve: 'lin', vib: { f: 4.5, depth: 5 } });
    tone(v, { at: 0.02, f0: 62, f1: 44, dur: 1.2, g: 0.2, atk: 0.03, lp: 220, curve: 'lin' });
  });
  // ballistics.js has asked for this on every grazing hit behind an audio.has() guard, so the zone has
  // been ricocheting in silence. The spang: a hard transient, then the whine of a deformed round
  // spinning away, pitch falling as it goes.
  def('ricochet', (v) => {
    const f = rnd(1500, 2600);
    click(v, { f: f * 2.2, g: 0.5, dur: 0.003 });
    burst(v, { type: 'white', filt: 'bandpass', f0: f * 2.4, f1: f, q: 1.6, dur: 0.03, g: 0.6, atk: 0.0005 });
    fm(v, { at: 0.006, type: 'sawtooth', f0: f * 1.6, f1: f * 0.28, ratio: 1.99, index: 1.1, index1: 0.25, dur: rnd(0.32, 0.55), g: 0.35, atk: 0.004, shape: 8, bp: f, bq: 3.5 });
    tone(v, { at: 0.01, f0: f * 1.5, f1: f * 0.3, dur: 0.4, g: 0.16, atk: 0.006, lp: 5200, vib: { f: rnd(16, 30), depth: 40 } });
    tail(v, { at: 0.03, dur: 0.35, g: 0.1, f0: 3000, f1: 400 });
  });
  // sky.js schedules this seconds behind each lightning flash, also behind an audio.has() guard, so the
  // storms have been mute. Distant thunder: no crack, just the rumble arriving and rolling over.
  def('thunder', (v) => {
    burst(v, { type: 'brown', filt: 'lowpass', f0: 220, f1: 70, q: 0.6, dur: 2.6, g: 0.9, atk: 0.55, sweep: 0.8 });
    burst(v, { at: 0.15, type: 'brown', filt: 'lowpass', f0: 420, f1: 110, q: 0.8, dur: 1.8, g: 0.55, atk: 0.35 });
    tone(v, { f0: 38, f1: 22, dur: 3.2, g: 0.45, atk: 0.7, curve: 'lin', shape: 4 });
    seq(v, irnd(3, 5), 0.3, 2.4, (at) => burst(v, { at, type: 'brown', filt: 'lowpass', f0: rnd(160, 340), f1: 60, q: 0.7, dur: rnd(0.5, 1.1), g: rnd(0.2, 0.4), atk: 0.2 }));
    tail(v, { at: 1.2, dur: 2.4, g: 0.22, f0: 700, f1: 90 });
  });
  def('death', (v) => {
    thump(v, { f0: 70, f1: 28, dur: 0.45, g: 1.0 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 500, f1: 120, q: 0.7, dur: 0.4, g: 0.5, atk: 0.005 });
    tone(v, { type: 'sawtooth', f0: 110, f1: 38, dur: 3.0, g: 0.28, atk: 0.05, lp: 420, lq: 1.1, curve: 'lin' });
    tone(v, { f0: 55, f1: 24, dur: 3.0, g: 0.25, atk: 0.1, curve: 'lin' });
    for (const [at, g] of [[0.5, 0.6], [0.85, 0.45], [1.55, 0.5], [1.9, 0.35], [2.7, 0.35]]) thump(v, { at, f0: 62, f1: 40, dur: 0.12, g });
    burst(v, { type: 'pink', filt: 'highpass', f0: 2000, q: 0.5, dur: 3.2, g: 0.05, atk: 2.4, curve: 'lin' });
  });
  def('flashlight', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 2800, q: 2, dur: 0.008, g: 0.55, atk: 0.0005 });
    tone(v, { f0: 1100, f1: 600, dur: 0.015, g: 0.15, atk: 0.0005 });
    tone(v, { f0: 300, f1: 200, dur: 0.02, g: 0.3, atk: 0.0005 });
  });
  def('click', (v) => { burst(v, { type: 'white', filt: 'bandpass', f0: 2600, q: 3, dur: 0.008, g: 0.45, atk: 0.0005 }); ring(v, { freqs: [3400], decay: 0.03, g: 0.05 }); });

  // ===================================================== weapons ================================================
  // ---- the arsenal -------------------------------------------------------------------------------------------
  // [cartridge, barrel mm, action, muzzle device]. The barrel lengths are the real ones, and they are not
  // decoration: the ratio of the actual barrel to the length the cartridge was designed around is what decides
  // how much of the charge is still burning when the bullet uncorks the bore, and therefore how loud and how
  // harsh the report is. An AKS-74U (206 mm) and an AK-74M (415 mm) fire the same round and do not sound alike.
  const GUNS = {
    pm: ['9x18', 93, 'slide'], pb: ['9x18', 100, 'slide', 'can'], aps: ['9x18', 140, 'slide'],
    tt: ['7.62x25', 116, 'slide'], glock: ['9x19', 114, 'slide'], m9: ['9x19', 125, 'slide'], m1911: ['.45', 127, 'slide'],
    kedr: ['9x18', 120, 'open'], bizon: ['9x18', 230, 'open'], vityaz: ['9x19', 237, 'blow'], mp5: ['9x19', 225, 'roller'], ppsh: ['7.62x25', 269, 'open'],
    akm: ['7.62x39', 415, 'piston'], akms: ['7.62x39', 415, 'piston'], sks: ['7.62x39', 520, 'piston'],
    ak74m: ['5.45x39', 415, 'piston', 'brake'], aks74u: ['5.45x39', 206, 'piston', 'brake'], ak105: ['5.45x39', 314, 'piston', 'brake'], ak12: ['5.45x39', 415, 'piston', 'brake'],
    m4: ['5.56x45', 370, 'ar', 'brake'], hk416: ['5.56x45', 368, 'ar', 'brake'], scar: ['5.56x45', 351, 'ar', 'brake'],
    vss: ['9x39', 200, 'piston', 'can'], val: ['9x39', 200, 'piston', 'can'], sr3m: ['9x39', 156, 'piston'],
    toz: ['12ga', 711, 'break'], mp153: ['12ga', 710, 'gasshot'], rem870: ['12ga', 660, 'pump'], saiga: ['12ga', 430, 'piston'],
    mosin: ['7.62x54', 730, 'bolt'], obrez: ['7.62x54', 250, 'bolt'], svd: ['7.62x54', 620, 'piston', 'brake'], sv98: ['7.62x54', 650, 'bolt', 'brake'],
    rpk74: ['5.45x39', 590, 'piston', 'brake'], pkm: ['7.62x54', 645, 'belt'],
  };
  // Every weapon gets its own name so weapons.js's `shot_<id>` lookup finds it, plus a `_sup` twin for the
  // mimics, who ask for `shot_<id>_sup` before falling back. A can on the muzzle is not a volume knob: the
  // blast loses ~10 dB and most of its top end, the gas leaves over milliseconds instead of microseconds, and
  // the action — untouched — becomes the loudest thing in the sound.
  const OPEN = {}, SUP = {};
  for (const id of Object.keys(GUNS)) {
    const [cal, barrel, action, mod] = GUNS[id];
    OPEN[id] = makeSpec({ id, cal, barrel, action, mod });
    SUP[id] = makeSpec({ id: id + '#s', cal, barrel, action, mod: 'can' });
    const integral = mod === 'can';
    def('shot_' + id, (v) => {
      // weapons.js and mimic.js signal a fitted can by dropping the gain to ~0.35-0.5 and nothing else plays a
      // shot that quietly, so that is the switch. The 2.2 puts back what the caller took off the mechanical
      // half, which a suppressor does not touch.
      const sup = v.o.suppressed === true || (v.o.gain != null && v.o.gain <= 0.62);
      report(v, (integral || sup) ? SUP[id] : OPEN[id], (integral || sup) ? { g: 2.2 } : {});
    });
    def('shot_' + id + '_sup', (v) => report(v, SUP[id], { g: 2.2 }));
  }
  def('shot_suppressed', (v) => report(v, SUP.akm, { g: 2.2 }));
  // The hammer falls on an empty chamber: a dead, unresonant tick, plus the sear and the spring behind it.
  // Nothing rings, because nothing here is free to ring.
  def('dry_click', (v) => {
    metal(v, { f: 2500, g: 0.5, dur: 0.005, decay: 0.016, low: 330 });
    mknock(v, 0.004, 4200, 0.16, 4, 0.004);
    burst(v, { at: 0.006, type: 'white', filt: 'bandpass', f0: 1600, q: 5, dur: 0.02, g: 0.08, atk: 0.002, pr: 1.2, pr1: 0.8 });
  });
  def('reload_magout', (v) => {
    clack(v, { f: 2500, g: 0.45, dur: 0.012, decay: 0.05 });
    burst(v, { at: 0.03, type: 'pink', filt: 'bandpass', f0: 1200, f1: 700, q: 1.2, dur: 0.14, g: 0.28, atk: 0.03 });
    cloth(v, { at: 0.1, n: 2, span: 0.12, g: 0.15 });
  });
  def('reload_magin', (v) => {
    cloth(v, { n: 2, span: 0.08, g: 0.14 });
    burst(v, { at: 0.02, type: 'pink', filt: 'bandpass', f0: 800, f1: 1300, q: 1.2, dur: 0.1, g: 0.22, atk: 0.02 });
    thump(v, { at: 0.12, f0: 140, f1: 70, dur: 0.06, g: 0.6 });
    burst(v, { at: 0.12, type: 'brown', filt: 'lowpass', f0: 500, q: 0.7, dur: 0.05, g: 0.45, atk: 0.001 });
    clack(v, { at: 0.135, f: 2800, g: 0.45, dur: 0.01, decay: 0.05 });
  });
  def('reload_chamber', (v) => {
    clack(v, { f: 2200, g: 0.55, dur: 0.02, decay: 0.05 });
    burst(v, { at: 0.02, type: 'pink', filt: 'bandpass', f0: 1500, q: 1.5, dur: 0.1, g: 0.2, atk: 0.02 });
    clack(v, { at: 0.14, f: 1900, g: 0.65, dur: 0.02, decay: 0.07 });
    thump(v, { at: 0.14, f0: 120, f1: 80, dur: 0.04, g: 0.4 });
  });
  // Bolt handle up and back: the lug camming out, then steel sliding on steel, then the carrier hitting the stop.
  def('bolt_open', (v) => {
    metal(v, { f: 2200, g: 0.5, dur: 0.012, decay: 0.05, low: 260 });
    burst(v, { at: 0.03, type: 'white', filt: 'bandpass', f0: 2600, f1: 3400, q: 1.4, dur: 0.11, g: 0.2, atk: 0.02, pr: 0.9, pr1: 1.15 });
    metal(v, { at: 0.115, f: 1500, g: 0.4, dur: 0.01, decay: 0.045, low: 180 });
  });
  def('bolt_close', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, f1: 2000, q: 1.4, dur: 0.09, g: 0.2, atk: 0.014, pr: 1.1, pr1: 0.85 });
    metal(v, { at: 0.1, f: 1900, g: 0.7, dur: 0.016, decay: 0.05, low: 150 });
    metal(v, { at: 0.135, f: 2600, g: 0.3, dur: 0.008, decay: 0.02 });        // the handle coming down
  });
  // A pump gun's action: a heavy sliding fore-end, the shell lifting, and the bolt slamming shut. weapons.js
  // asks for these by name and has been falling back to the bolt sounds, which are half the weight.
  def('pump_back', (v) => {
    metal(v, { f: 1700, g: 0.45, dur: 0.01, decay: 0.04, low: 210 });
    burst(v, { at: 0.012, type: 'pink', filt: 'bandpass', f0: 1100, f1: 1700, q: 1.1, dur: 0.11, g: 0.3, atk: 0.015, pr: 0.85, pr1: 1.2 });
    pulses(v, { n: irnd(2, 4), at: 0.03, span: 0.08, type: 'white', f0: 2200, f1: 3600, q: 4, dur: 0.006, g: 0.16 });
    metal(v, { at: 0.13, f: 1250, g: 0.6, dur: 0.016, decay: 0.05, low: 130 });
  });
  def('pump_forward', (v) => {
    burst(v, { type: 'pink', filt: 'bandpass', f0: 1600, f1: 1000, q: 1.1, dur: 0.1, g: 0.3, atk: 0.012, pr: 1.2, pr1: 0.85 });
    metal(v, { at: 0.105, f: 1450, g: 0.85, dur: 0.018, decay: 0.055, low: 120 });
    metal(v, { at: 0.112, f: 2400, g: 0.3, dur: 0.007, decay: 0.018 });
  });
  // The selector lever, or a safety: a small stiff detent, one notch.
  def('weapon_select', (v) => { metal(v, { f: 3100, g: 0.4, dur: 0.005, decay: 0.014, low: 420 }); mknock(v, 0.018, 2400, 0.22, 3.5, 0.005); });
  const creak = (v, at, f0, f1, dur, g) => {
    const tr = trem(v, { at, freq: rnd(9, 15), depth: 0.45, dur });
    tone(v, { at, type: 'sawtooth', f0, f1, dur, g, atk: dur * 0.3, lp: 1800, lq: 2.5, shape: 12, to: tr, curve: 'lin' });
  };
  def('break_open', (v) => { creak(v, 0, 700, 520, 0.2, 0.12); clack(v, { at: 0.18, f: 2200, g: 0.5, dur: 0.02, decay: 0.1 }); ring(v, { at: 0.18, freqs: [1100, 1800], decay: 0.1, g: 0.08 }); });
  def('break_close', (v) => { creak(v, 0, 520, 700, 0.12, 0.1); clack(v, { at: 0.1, f: 1900, g: 0.65, dur: 0.02, decay: 0.12 }); thump(v, { at: 0.1, f0: 160, f1: 90, dur: 0.05, g: 0.45 }); });
  def('shell_insert', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 3500, q: 2, dur: 0.06, g: 0.18, atk: 0.01 });
    click(v, { at: 0.06, f: 3000, g: 0.4 }); ring(v, { at: 0.06, freqs: [2600, 4100], decay: 0.04, g: 0.1 });
    thump(v, { at: 0.065, f0: 200, f1: 120, dur: 0.03, g: 0.25 });
  });
  def('jam', (v) => {
    tone(v, { f0: 140, f1: 90, dur: 0.07, g: 0.65, atk: 0.001 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 700, q: 0.8, dur: 0.06, g: 0.5, atk: 0.001 });
    burst(v, { at: 0.04, type: 'white', filt: 'bandpass', f0: 1400, q: 3, dur: 0.08, g: 0.2, atk: 0.01, pr: 1, pr1: 0.7 });
  });
  def('unjam', (v) => {
    pulses(v, { n: irnd(4, 6), span: 0.25, type: 'white', f0: 2000, f1: 3200, q: 3, dur: 0.012, g: 0.3 });
    burst(v, { at: 0.1, type: 'white', filt: 'bandpass', f0: 2600, q: 1.5, dur: 0.1, g: 0.15, atk: 0.02 });
    clack(v, { at: 0.28, f: 2100, g: 0.6, dur: 0.02, decay: 0.08 });
  });
  def('mag_load_round', (v) => {
    burst(v, { type: 'pink', filt: 'bandpass', f0: 900, q: 1, dur: 0.03, g: 0.15, atk: 0.005 });
    click(v, { at: 0.02, f: 3200, g: 0.45, q: 4, dur: 0.008 }); ring(v, { at: 0.02, freqs: [4200], decay: 0.03, g: 0.08 });
  });
  def('weapon_draw', (v) => { cloth(v, { n: 3, span: 0.2, g: 0.25 }); clack(v, { at: 0.15, f: 2600, g: 0.3, dur: 0.012, decay: 0.06 }); });
  def('weapon_holster', (v) => { cloth(v, { n: 4, span: 0.25, g: 0.22 }); click(v, { at: 0.05, f: 2600, g: 0.2 }); burst(v, { at: 0.2, type: 'brown', filt: 'lowpass', f0: 500, q: 0.7, dur: 0.05, g: 0.3, atk: 0.004 }); });
  def('ads_in', (v) => { cloth(v, { n: 2, span: 0.1, f: 1800, g: 0.18 }); burst(v, { at: 0.02, type: 'pink', filt: 'highpass', f0: 1200, q: 0.5, dur: 0.15, g: 0.05, atk: 0.08 }); });
  def('ads_out', (v) => cloth(v, { n: 2, span: 0.1, f: 1500, g: 0.15, dur: 0.08 }));
  // A round going past your head. Supersonic bullets drag a Mach cone; what crosses your ear is a genuine
  // N-wave — pressure jumps up, falls straight through zero to an equal underpressure, snaps back — lasting
  // about 0.4 ms at a metre's miss distance. That double discontinuity IS the crack, and no filtered noise
  // burst reproduces it. Behind it comes the wake: turbulent air closing up after the bullet, falling away.
  // ballistics.js plays this whenever a round passes within 1.5 m of the player's eye.
  const whiz = (v, sub) => {
    if (!sub) {
      const T = rnd(0.00032, 0.00054), nb = nwaveKernel(v.a, 'whiz' + Math.round(T * 5e4), T, 3.5e-5);
      kplay(v, nb, { g: 0.95, hp: 380 });
      kplay(v, nb, { at: rnd(0.0016, 0.0042), g: 0.26, lp: 2600 });        // the same crack off the ground
    }
    burst(v, { type: 'white', filt: 'bandpass', f0: sub ? 2000 : 4400, f1: sub ? 650 : 950, q: 1.1, dur: 0.07, g: sub ? 0.5 : 0.38, atk: 0.0035, hp: 500 });
    burst(v, { at: 0.018, type: 'pink', filt: 'bandpass', f0: 1400, f1: 480, q: 0.9, dur: 0.09, g: 0.14, atk: 0.012 });
  };
  def('bullet_whiz', (v) => whiz(v, /sub|sup|quiet/.test(String(v.o.variant || ''))));
  def('bullet_crack', (v) => whiz(v, false));
  // A bullet into sheet steel. The strike is a hard flat slap; the plate answers with a DENSE, inharmonic,
  // fast-dying bending spectrum, so the modes are built from resonant noise rather than tuned sines. A quarter
  // second of a clean 2.4 kHz sine, which is what used to be here, is a struck bell — the same mistake the
  // gunshot was making, in a smaller place.
  def('impact_metal', (v) => {
    const f = rnd(820, 1450);
    burst(v, { type: 'white', filt: 'highpass', f0: 2000, q: 0.6, dur: 0.0035, g: 0.95, atk: 0.0003 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 3200, f1: 1300, q: 0.8, dur: 0.018, g: 0.55, atk: 0.0004 });
    tone(v, { f0: f * 0.42, f1: f * 0.3, dur: 0.018, g: 0.4, atk: 0.0005 });          // the panel taking the load
    for (const [r, gg, dd] of [[1, 0.26, 0.06], [1.74, 0.19, 0.045], [2.43, 0.13, 0.032], [3.87, 0.08, 0.022]])
      burst(v, { at: rnd(0, 0.0015), type: 'white', filt: 'bandpass', f0: f * r, q: 7, dur: dd, g: gg, atk: 0.0007, fjit: 0.06 });
    pulses(v, { n: irnd(3, 6), at: 0.004, span: 0.08, type: 'white', f0: 3000, f1: 6500, q: 4, dur: 0.005, g: 0.14, decay: 0.75 });
  });
  def('impact_concrete', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 2500, f1: 900, q: 1, dur: 0.04, g: 0.8, atk: 0.0008 });
    pulses(v, { n: irnd(5, 8), at: 0.02, span: 0.15, type: 'white', f0: 1500, f1: 3200, q: 2, dur: 0.01, g: 0.15, decay: 0.85 });
    burst(v, { at: 0.01, type: 'pink', filt: 'lowpass', f0: 1500, q: 0.7, dur: 0.12, g: 0.2, atk: 0.01 });
  });
  def('impact_dirt', (v) => {
    thump(v, { f0: 110, f1: 50, dur: 0.08, g: 0.5 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 400, q: 0.7, dur: 0.08, g: 0.5, atk: 0.001 });
    burst(v, { at: 0.01, type: 'pink', filt: 'bandpass', f0: 1800, q: 0.8, dur: 0.14, g: 0.2, atk: 0.01 });
  });
  def('impact_wood', (v) => {
    tone(v, { f0: 220, f1: 140, dur: 0.05, g: 0.6, atk: 0.001 });
    burst(v, { type: 'white', filt: 'lowpass', f0: 1500, q: 0.7, dur: 0.03, g: 0.4, atk: 0.001 });
    pulses(v, { n: irnd(3, 5), at: 0.01, span: 0.1, type: 'white', f0: 2500, f1: 4500, q: 2.5, dur: 0.012, g: 0.15 });
  });
  def('impact_ash', (v) => {
    thump(v, { f0: 90, f1: 50, dur: 0.09, g: 0.4 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 300, q: 0.7, dur: 0.1, g: 0.4, atk: 0.004 });
    burst(v, { at: 0.01, type: 'pink', filt: 'highpass', f0: 2500, q: 0.5, dur: 0.25, g: 0.08, atk: 0.03 });
  });
  def('impact_glass', (v) => { burst(v, { type: 'white', filt: 'highpass', f0: 3000, q: 0.7, dur: 0.02, g: 0.5, atk: 0.0005 }); tinkle(v, { n: irnd(6, 9), at: 0.005, span: 0.25, f0: 2500, f1: 6500, dur: 0.09, g: 0.08 }); });
  def('impact_water', (v) => {
    tone(v, { f0: 500, f1: 1400, dur: 0.04, g: 0.3, atk: 0.002 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, f1: 800, q: 1, dur: 0.06, g: 0.3, atk: 0.002 });
    burst(v, { at: 0.02, type: 'pink', filt: 'bandpass', f0: 1500, q: 0.8, dur: 0.1, g: 0.15, atk: 0.01 });
  });

  // ===================================================== entities (mimic voice lives in voices.js) ===============
  registerVoices(audio, H);
  def('slider_click', (v) => seq(v, irnd(2, 4), 0, rnd(0.18, 0.32), (at) => {
    burst(v, { at, type: 'white', filt: 'bandpass', f0: 1400, q: 4, dur: 0.012, g: 0.55, atk: 0.0005 });
    ring(v, { at, freqs: [700, 1150], decay: 0.05, g: 0.18 });
    tone(v, { at, f0: 900, f1: 500, dur: 0.015, g: 0.22, atk: 0.0005 });
  }));
  def('slider_screech', (v) => {
    fm(v, { type: 'sawtooth', f0: 400, f1: 1800, ratio: 2.01, index: 2, index1: 1.2, dur: 0.6, g: 0.45, atk: 0.04, shape: 20, bp: 1600, bq: 0.8 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 2000, f1: 4000, q: 1, dur: 0.6, g: 0.22, atk: 0.1 });
    fm(v, { at: 0.58, type: 'sawtooth', f0: 1800, f1: 900, ratio: 2.01, index: 1.2, dur: 0.12, g: 0.3, atk: 0.005, shape: 20, bp: 1600, bq: 0.8 });
  });
  def('slider_lunge', (v) => { burst(v, { type: 'pink', filt: 'bandpass', f0: 500, f1: 2800, q: 1, dur: 0.22, g: 0.7, atk: 0.06 }); burst(v, { at: 0.05, type: 'white', filt: 'highpass', f0: 2000, q: 0.6, dur: 0.15, g: 0.2, atk: 0.02 }); });
  def('slider_hit', (v) => {
    thump(v, { f0: 100, f1: 60, dur: 0.08, g: 0.6 });
    burst(v, { type: 'pink', filt: 'bandpass', f0: 500, f1: 250, q: 1.2, dur: 0.1, g: 0.5, atk: 0.001, pr: 1.1, pr1: 0.6 });
    fm(v, { at: 0.01, type: 'sawtooth', f0: 900, f1: 600, ratio: 2, index: 1.5, dur: 0.12, g: 0.2, atk: 0.005, shape: 15, lp: 2500 });
  });
  def('slider_death', (v) => {
    burst(v, { type: 'brown', filt: 'lowpass', f0: 600, q: 0.8, dur: 0.15, g: 0.8, atk: 0.001 });
    burst(v, { type: 'crackle', filt: 'lowpass', f0: 3000, q: 0.7, dur: 0.3, g: 0.6, atk: 0.001 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 1200, f1: 400, q: 1, dur: 0.12, g: 0.5, atk: 0.001 });
    fm(v, { at: 0.03, type: 'sawtooth', f0: 1600, f1: 300, ratio: 2.01, index: 2, index1: 0.6, dur: 0.9, g: 0.4, atk: 0.01, shape: 18, bp: 1400, bq: 0.7 });
    pulses(v, { n: 3, at: 0.7, span: 0.3, type: 'white', f0: 1200, f1: 1600, q: 4, dur: 0.012, g: 0.3, decay: 0.7 });
  });
  def('slider_step', (v) => seq(v, 2, 0, 0.1, (at) => { burst(v, { at, type: 'brown', filt: 'lowpass', f0: 500, q: 0.7, dur: 0.03, g: 0.4, atk: 0.002 }); burst(v, { at, type: 'pink', filt: 'highpass', f0: 900, q: 0.6, dur: 0.03, g: 0.25, atk: 0.003 }); }));

  // The phantom had three sounds in its code and none of them in this file: every vanish, flinch, scream
  // and grab played nothing, so the one enemy that is meant to be heard before it is seen was silent.
  // An indrawn hiss that swells rather than strikes: the long attack against a short body is what reads
  // as a sound running backwards, and the filter closing down under it is the breath being taken.
  def('phantom_hiss', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 900, f1: 3400, q: 0.9, dur: 0.42, g: 0.5, atk: 0.3, pr: 0.8, pr1: 1.25 });
    burst(v, { type: 'pink', filt: 'highpass', f0: 1600, q: 0.6, dur: 0.42, g: 0.22, atk: 0.34 });
    tone(v, { type: 'sawtooth', f0: 58, f1: 44, dur: 0.5, g: 0.16, atk: 0.18, lp: 180, shape: 10 });
    clack(v, { at: 0.4, f: 2600, g: 0.3, dur: 0.014, decay: 0.05, ringMul: 0.15 });
  });
  // The tell before the rush, and the death. Two detuned FM voices an octave apart, driven hard enough
  // to shred, sliding up into the scream and falling out of it; the sub underneath is what you feel.
  def('phantom_scream', (v) => {
    fm(v, { type: 'sawtooth', f0: 310, f1: 620, ratio: 1.41, index: 3, index1: 5, dur: 0.5, g: 0.5, atk: 0.02, shape: 26, bp: 1800, bq: 0.7 });
    fm(v, { at: 0.01, type: 'sawtooth', f0: 156, f1: 300, ratio: 2.51, index: 2.2, index1: 4, dur: 0.55, g: 0.35, atk: 0.03, shape: 22, bp: 900, bq: 0.8, detune: 14 });
    burst(v, { at: 0.02, type: 'white', filt: 'bandpass', f0: 2600, f1: 5200, q: 0.8, dur: 0.5, g: 0.3, atk: 0.05 });
    tone(v, { type: 'sine', f0: 78, f1: 34, dur: 0.7, g: 0.5, atk: 0.01, curve: 'lin' });
    fm(v, { at: 0.5, type: 'sawtooth', f0: 620, f1: 180, ratio: 1.41, index: 5, index1: 1, dur: 0.35, g: 0.32, atk: 0.005, shape: 24, bp: 1500, bq: 0.7 });
    tail(v, { at: 0.5, dur: 0.8, g: 0.2, f0: 3000, f1: 260 });
  });
  // Contact: the weight lands first, then cloth and a choked-off fragment of the scream.
  def('phantom_grab', (v) => {
    thump(v, { f0: 120, f1: 38, dur: 0.16, g: 1.0 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 700, f1: 200, q: 0.9, dur: 0.14, g: 0.7, atk: 0.001, pr: 1.2, pr1: 0.6 });
    burst(v, { at: 0.01, type: 'white', filt: 'bandpass', f0: 1800, f1: 600, q: 1.1, dur: 0.09, g: 0.45, atk: 0.001 });
    cloth(v, { at: 0.02, n: 4, span: 0.22, f: 2200, g: 0.3 });
    fm(v, { at: 0.03, type: 'sawtooth', f0: 420, f1: 150, ratio: 1.41, index: 4, index1: 0.8, dur: 0.22, g: 0.34, atk: 0.004, shape: 24, bp: 1400, bq: 0.8 });
    tail(v, { at: 0.06, dur: 0.45, g: 0.16, f0: 2200, f1: 200 });
  });

  defLoop('fragment_chime', (L) => {
    const a = L.a, amp = L.keep(a.gain(0.55)), pulseG = L.keep(a.gain(1)), bright = L.keep(a.gain(0.12));
    amp.connect(pulseG); pulseG.connect(L.out); bright.connect(amp);
    const base = [880, 883, 1760], oscs = [];
    base.forEach((f, i) => { const r = L.osc('sine', f * L.rate, i === 2 ? 0.25 : 0.4, amp); oscs.push(r); });
    const hi = L.osc('sine', 1762 * L.rate, 1, bright); oscs.push(hi); L.lfo(hi.o.frequency, 5.2, 3);
    const hi2 = L.osc('sine', 2640 * L.rate, 0.6, bright); oscs.push(hi2); L.lfo(hi2.o.frequency, 0.31, 6);
    const am = a.osc('sine', 0.6), amg = L.keep(a.gain(0.45)); am.connect(amg); amg.connect(amp.gain); am.start(a.now); L.srcs.push(am);
    let pitch = 1, near = 0, lastHz = -1, lastNear = -1;
    const applyPitch = () => { const m = pitch * (1 + 0.04 * near); oscs.forEach((r, i) => L.target(r.o.frequency, [880, 883, 1760, 1762, 2640][i] * L.rate * m, 0.15)); };
    // set('rate', hz): pulses per second. fragment.js sends 1 / period (1.8 s idle -> 0.25 s at touching distance, i.e. 0.55..4 Hz);
    // the AM follows it and the pitch creeps up ~6 % at full speed. One convention only: a value in (0, 1) is a slow pulse, not a fraction.
    // Callers set these every frame, so changes under 1 % are ignored rather than queued as automation events.
    L.setters.rate = (val) => { if (!Number.isFinite(val) || val <= 0) return; const hz = clamp(val, 0.3, 8); if (Math.abs(hz - lastHz) < lastHz * 0.01) return; lastHz = hz; L.target(am.frequency, hz, 0.1); pitch = 1 + 0.06 * clamp((hz - 0.55) / 3.45, 0, 1); applyPitch(); };
    L.setters.near = (val) => { const n = clamp(val, 0, 1); if (Math.abs(n - lastNear) < 0.01) return; lastNear = near = n; L.target(bright.gain, 0.12 + 0.35 * near, 0.3); applyPitch(); };
    L.setters.pulse = (val) => L.target(pulseG.gain, 0.65 + 0.35 * clamp(val, 0, 1), 0.03);
  });
  def('fragment_approach', (v) => {
    tone(v, { f0: 880, f1: 1760, dur: 1.5, g: 0.16, atk: 0.5, hold: 0.4, fcurve: 'exp' });
    tone(v, { f0: 1320, f1: 2640, dur: 1.5, g: 0.08, atk: 0.6, hold: 0.3, vib: { f: 6, depth: 8 } });
    tone(v, { f0: 883, f1: 1770, dur: 1.4, g: 0.1, atk: 0.4, hold: 0.4 });
    burst(v, { type: 'white', filt: 'highpass', f0: 4000, q: 0.5, dur: 1.5, g: 0.06, atk: 0.7 });
  });
  def('fragment_pop', (v) => {
    burst(v, { type: 'white', filt: 'highpass', f0: 2500, q: 0.7, dur: 0.03, g: 0.7, atk: 0.0005 });
    tone(v, { f0: 3000, f1: 6000, dur: 0.04, g: 0.2, atk: 0.001 });
    tinkle(v, { n: irnd(4, 6), at: 0.01, span: 0.2, f0: 3000, f1: 7000, dur: 0.1, g: 0.06 });
  });
  def('fragment_explode', (v) => {
    thump(v, { f0: 55, f1: 22, dur: 0.5, g: 1.2 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 300, q: 0.7, dur: 0.3, g: 0.8, atk: 0.002 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 2000, f1: 300, q: 0.7, dur: 0.25, g: 0.9, atk: 0.001 });
    ring(v, { at: 0.01, freqs: [1400, 2130, 3520, 5100], decay: 0.8, g: 0.22, fall: 0.7 });
    burst(v, { at: 0.01, type: 'pink', filt: 'highpass', f0: 3000, q: 0.5, dur: 0.8, g: 0.12, atk: 0.02 });
    tail(v, { dur: 0.9, g: 0.3, f0: 2000, f1: 200 });
  });
  def('spawn_skitter', (v) => {
    const span = rnd(0.4, 0.9);
    pulses(v, { n: irnd(8, 20), span, type: 'white', f0: 3500, f1: 5500, q: 3, dur: 0.006, g: 0.3 });
    burst(v, { type: 'pink', filt: 'highpass', f0: 3000, q: 0.5, dur: span, g: 0.05, atk: 0.05, curve: 'lin' });
  });
  def('spawn_bite', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 1800, q: 2, dur: 0.02, g: 0.7, atk: 0.0005 });
    burst(v, { at: 0.005, type: 'pink', filt: 'bandpass', f0: 700, f1: 300, q: 1.2, dur: 0.08, g: 0.4, atk: 0.003, pr: 1.2, pr1: 0.6 });
    thump(v, { f0: 160, f1: 90, dur: 0.04, g: 0.4 });
    click(v, { f: 4000, g: 0.25 });
  });
  def('spawn_death', (v) => {
    burst(v, { type: 'brown', filt: 'lowpass', f0: 800, q: 0.7, dur: 0.12, g: 0.7, atk: 0.001 });
    burst(v, { type: 'crackle', filt: 'lowpass', f0: 4000, q: 0.7, dur: 0.25, g: 0.5, atk: 0.001 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 1500, f1: 500, q: 1, dur: 0.08, g: 0.5, atk: 0.001 });
    pulses(v, { n: irnd(6, 9), at: 0.1, span: 0.5, type: 'white', f0: 3500, f1: 5500, q: 3, dur: 0.006, g: 0.3, decay: 0.78 });
  });
  def('seeker_step', (v) => {
    thump(v, { f0: 55, f1: 25, dur: 0.35, g: 1.2 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 200, q: 0.7, dur: 0.3, g: 0.8, atk: 0.002 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 1800, q: 1, dur: 0.03, g: 0.4, atk: 0.001 });
    ring(v, { freqs: [420, 610, 1130], decay: 0.35, g: 0.15 });
    tail(v, { dur: 0.5, g: 0.15, f0: 1200, f1: 150 });
  });
  def('seeker_shot', (v) => gunshot(v, { clickG: 1, crackF0: 3500, crackF1: 300, crackDur: 0.09, crackG: 1.2, thumpF0: 80, thumpF1: 25, thumpDur: 0.18, thumpG: 1.2, bodyG: 0.6, bodyLp: 600, boomG: 0.4, boomF: 350, tailDur: 0.8, tailG: 0.3, mech: [{ at: 0.06, f: 1800, g: 0.4 }, { at: 0.1, f: 1500, g: 0.25 }] }));
  def('seeker_hiss', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 2500, f1: 1200, q: 0.8, dur: 0.5, g: 0.5, atk: 0.04 });
    burst(v, { type: 'pink', filt: 'highpass', f0: 800, q: 0.6, dur: 0.5, g: 0.2, atk: 0.03 });
    tone(v, { type: 'sawtooth', f0: 60, f1: 52, dur: 0.5, g: 0.15, atk: 0.05, lp: 200 });
    clack(v, { at: 0.46, f: 2000, g: 0.4, dur: 0.02, decay: 0.08 });
  });
  def('seeker_death', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, f1: 800, q: 0.8, dur: 1.5, g: 0.3, atk: 0.1 });
    tone(v, { type: 'sawtooth', f0: 55, f1: 20, dur: 2.0, g: 0.2, atk: 0.05, lp: 300, curve: 'lin' });
    seq(v, irnd(6, 9), 0, 1.8, (at, i) => {
      const f = rnd(1200, 2500), g = rnd(0.4, 0.8) * (0.7 + 0.3 * i / 8);
      burst(v, { at, type: 'white', filt: 'bandpass', f0: f, q: 1.2, dur: 0.03, g, atk: 0.001 });
      ring(v, { at, freqs: [rnd(300, 900), rnd(900, 1800)], decay: 0.3, g: 0.15 });
      thump(v, { at, f0: rnd(80, 130), f1: 40, dur: 0.12, g: 0.5 });
    });
    thump(v, { at: 1.8, f0: 55, f1: 20, dur: 0.5, g: 1.2 });
    burst(v, { at: 1.8, type: 'brown', filt: 'lowpass', f0: 250, q: 0.7, dur: 0.4, g: 0.8, atk: 0.002 });
    tail(v, { at: 1.82, dur: 0.9, g: 0.25, f0: 1500, f1: 150 });
  });
  def('seeker_spot', (v) => {
    tone(v, { type: 'sawtooth', f0: 55, f1: 58, dur: 1.2, g: 0.35, atk: 0.3, hold: 0.3, lp: 700, lq: 1.5 });
    tone(v, { f0: 1800, f1: 3200, dur: 1.0, g: 0.12, atk: 0.3, hold: 0.2 });
    burst(v, { type: 'white', filt: 'highpass', f0: 4000, q: 0.5, dur: 1.0, g: 0.05, atk: 0.3 });
  });
  defLoop('seeker_hum', (L) => {
    const a = L.a, lp = L.keep(a.filter('lowpass', 270, 1.2)), mix = L.keep(a.gain(0.4));
    lp.connect(mix); mix.connect(L.out);
    L.osc('sawtooth', 55 * L.rate, 0.5, lp, -4); L.osc('sawtooth', 55 * L.rate, 0.5, lp, 4);
    L.lfo(lp.frequency, 0.11, 150);
    L.osc('sine', 27.5 * L.rate, 0.15);
    const w = L.osc('sine', 1760, 0.015); L.lfo(w.o.frequency, 5, 6);
    L.setters.intensity = (val) => L.target(mix.gain, 0.25 + 0.6 * clamp(val, 0, 1), 0.3);
  });

  // ===================================================== anomalies ==============================================
  def('arc_zap', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, f1: 800, q: 0.8, dur: 0.12, g: 1.2, atk: 0.001 });
    tone(v, { f0: 6000, f1: 1500, dur: 0.06, g: 0.2, atk: 0.001 });
    burst(v, { type: 'crackle', filt: 'lowpass', f0: 5000, q: 0.7, dur: 0.45, g: 0.7, atk: 0.005 });
    thump(v, { f0: 120, f1: 50, dur: 0.08, g: 0.5 });
    tone(v, { type: 'square', f0: 100, f1: 90, dur: 0.1, g: 0.3, atk: 0.001, shape: 30, bp: 1500, bq: 1 });
  });
  defLoop('arc_hum', (L) => {
    const a = L.a, bp = L.keep(a.filter('bandpass', 800, 2)), g = L.keep(a.gain(0.15));
    bp.connect(g); g.connect(L.out);
    L.osc('square', 100 * L.rate, 1, bp);
    L.lfo(bp.frequency, 0.7, 200);
    L.osc('sine', 50 * L.rate, 0.05);
    let t = 0.2;   // random crackles ride on top of the hum
    L.tick = (dt) => { t -= dt; if (t > 0) return; t = rnd(0.08, 0.6); burst(voice(a, L.out, {}), { type: 'white', filt: 'bandpass', f0: rnd(2000, 6000), q: 2, dur: rnd(0.006, 0.03), g: rnd(0.1, 0.4), atk: 0.0005 }); };
    L.setters.intensity = (val) => L.target(g.gain, 0.05 + 0.2 * clamp(val, 0, 1), 0.3);
  });
  def('reflector_whip', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 1200, f1: 5500, q: 1.5, dur: 0.3, g: 0.5, atk: 0.08 });
    tone(v, { at: 0.05, f0: 2600, dur: 0.35, g: 0.2, atk: 0.002 });
    tone(v, { at: 0.06, f0: 3900, dur: 0.25, g: 0.1, atk: 0.002 });
  });
  defLoop('reflector_hum', (L) => {
    [[2093, 0.17, 0.028], [2637, 0.23, 0.022], [3136, 0.31, 0.016]].forEach(([f, amf, g]) => { const r = L.osc('sine', f * L.rate, g, null, rnd(-10, 10)); L.lfo(r.g.gain, amf, g * 0.5); L.lfo(r.o.frequency, rnd(0.3, 0.5), 3); });
    L.noise('white', 'highpass', 6000, 0.5, 0.006);
  });
  defLoop('gravity_drone', (L) => {
    const a = L.a, sum = L.keep(a.gain(0.7)); sum.connect(L.out);
    L.osc('sine', 38 * L.rate, 0.6, sum); L.osc('sine', 38.7 * L.rate, 0.5, sum); L.osc('sine', 76.5 * L.rate, 0.25, sum);
    L.lfo(sum.gain, 0.07, 0.25); L.noise('brown', 'lowpass', 60, 0.7, 0.1);
    L.setters.intensity = (val) => L.target(sum.gain, 0.4 + 0.5 * clamp(val, 0, 1), 0.5);
  });
  def('gravity_crush', (v) => {
    burst(v, { type: 'brown', filt: 'lowpass', f0: 250, q: 0.8, dur: 0.5, g: 1.0, atk: 0.02 });
    burst(v, { type: 'crackle', filt: 'lowpass', f0: 1500, q: 0.7, dur: 0.5, g: 0.5, atk: 0.01 });
    thump(v, { f0: 40, f1: 18, dur: 0.6, g: 1.0 });
    tone(v, { f0: 4200, f1: 5200, dur: 1.5, g: 0.08, atk: 0.1, hold: 0.4, curve: 'lin' });
  });
  defLoop('gas_hiss', (L) => {
    const h = L.noise('pink', 'highpass', 1500, 0.6, 0.35); L.lfo(h.g.gain, 0.15, 0.15);
    const b = L.noise('crackle', 'lowpass', 900, 0.7, 0.15, null, 0.6); L.lfo(b.g.gain, 0.3, 0.08);
    L.setters.intensity = (val) => L.target(h.g.gain, 0.15 + 0.4 * clamp(val, 0, 1), 0.3);
  });
  def('gas_cough', (v) => {
    grunt(v, { f0: 150, f1: 90, dur: 0.14, g: 0.6, atk: 0.005, lp: 700 });
    grunt(v, { at: 0.22, f0: 140, f1: 85, dur: 0.1, g: 0.45, atk: 0.005, lp: 650 });
    burst(v, { at: 0.4, type: 'pink', filt: 'highpass', f0: 1000, q: 0.6, dur: 0.3, g: 0.1, atk: 0.1 });
  });
  def('probe_throw', (v) => { burst(v, { type: 'pink', filt: 'bandpass', f0: 800, f1: 2500, q: 1, dur: 0.25, g: 0.4, atk: 0.05 }); cloth(v, { n: 2, span: 0.08, g: 0.12 }); });
  // A small steel probe hitting the ground. probe.js passes the surface it landed on as opts.variant.
  def('probe_land', (v) => {
    const s = String(v.o.variant || ''), soft = /grass|mud|dirt|water|ash|sand/.test(s);
    if (soft) {                                   // dull: the probe sinks into turf or mud, no bounce
      thump(v, { f0: 150, f1: 70, dur: 0.05, g: 0.45 });
      burst(v, { type: 'brown', filt: 'lowpass', f0: 500, q: 0.7, dur: 0.05, g: 0.45, atk: 0.001 });
      burst(v, { type: 'pink', filt: 'bandpass', f0: 1400, q: 0.8, dur: 0.07, g: 0.22, atk: 0.003 });
      click(v, { f: 2500, g: 0.12 });
      return;
    }
    if (s === 'wood') {                           // knock on planks, one small bounce
      tone(v, { f0: 230, f1: 150, dur: 0.04, g: 0.5, atk: 0.001 });
      burst(v, { type: 'white', filt: 'lowpass', f0: 1500, q: 0.7, dur: 0.03, g: 0.35, atk: 0.001 });
      ring(v, { freqs: [2400, 3300], decay: 0.05, g: 0.06 });
      tone(v, { at: 0.11, f0: 230, f1: 160, dur: 0.03, g: 0.25, atk: 0.001 });
      return;
    }
    const metal = s === 'metal';                  // hard: tick + ring (on metal a longer, brighter clank) and 1-2 bounces
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, q: 2, dur: 0.015, g: 0.5, atk: 0.0005 });
    ring(v, { freqs: metal ? [1100, 1700, 2600, 3900] : [2400, 3600], decay: metal ? 0.22 : 0.08, g: metal ? 0.14 : 0.1 });
    seq(v, irnd(1, 2), 0.09, 0.14, (at, i) => { burst(v, { at, type: 'white', filt: 'bandpass', f0: 3000, q: 2, dur: 0.012, g: 0.3 * Math.pow(0.6, i), atk: 0.0005 }); ring(v, { at, freqs: metal ? [1700, 2600] : [2400], decay: metal ? 0.1 : 0.05, g: 0.05 }); });
    burst(v, { type: 'pink', filt: 'bandpass', f0: 1500, q: 0.8, dur: 0.05, g: 0.1, atk: 0.003 });
  });
  def('probe_trigger', (v) => {
    tone(v, { f0: 1400, f1: 2800, dur: 0.05, g: 0.15, atk: 0.002 });
    tone(v, { at: 0.03, f0: 2800, dur: 0.5, g: 0.35, atk: 0.002 });
    tone(v, { at: 0.03, f0: 4200, dur: 0.3, g: 0.15, atk: 0.002 });
    burst(v, { type: 'white', filt: 'highpass', f0: 5000, q: 0.5, dur: 0.04, g: 0.2, atk: 0.001 });
  });
  def('artifact_pickup', (v) => {
    [1320, 1760, 2200, 2640, 3520].forEach((f, i) => tone(v, { at: i * 0.04, f0: f, dur: rnd(0.6, 1.0) * (1 - i * 0.08), g: 0.15 * Math.pow(0.85, i), atk: 0.004 }));
    burst(v, { type: 'white', filt: 'highpass', f0: 5000, q: 0.5, dur: 0.5, g: 0.06, atk: 0.05 });
    cloth(v, { n: 2, span: 0.1, g: 0.1 });
  });
  defLoop('artifact_hum', (L) => {
    const f = rnd(600, 720) * L.rate, r = L.osc('sine', f, 0.15); L.lfo(r.o.frequency, 0.4, 4); L.lfo(r.g.gain, 0.2, 0.03);
    L.osc('sine', f * 2, 0.03);
    L.setters.intensity = (val) => L.target(r.g.gain, 0.08 + 0.2 * clamp(val, 0, 1), 0.3);
  });
  def('detector_tick', (v) => {
    burst(v, { type: 'white', filt: 'highpass', f0: 2500, q: 0.7, dur: 0.004, g: 0.8, atk: 0.0003 });
    tone(v, { f0: 4000, f1: 2500, dur: 0.006, g: 0.3, atk: 0.0003 });
    ring(v, { freqs: [3100], decay: 0.015, g: 0.15 });
  });

  // ===================================================== ambience ===============================================
  defLoop('wind', (L) => {
    const a = L.a, gust = L.keep(a.gain(0.5)); gust.connect(L.out);
    const body = L.noise('pink', 'bandpass', rnd(380, 520), 0.5, 0.45, gust); L.lfo(body.f.frequency, rnd(0.05, 0.09), 120); L.lfo(gust.gain, 0.07, 0.15);
    const whistle = L.noise('pink', 'bandpass', 2000, 8, 0.03, gust); L.lfo(whistle.f.frequency, 0.13, 450);
    // set('gust', 0..1) is driven by ambience at ~10 Hz; the random gust multiplier re-rolled by tick() rides on top of it
    // (ambience's setGain() sets the overall level; 'level' is accepted and ignored so it is not applied twice).
    let level = 0.5, mul = 1, timer = rnd(2, 5);
    const apply = (tc) => L.target(gust.gain, level * mul, tc);
    L.setters.gust = (val) => { const g = clamp(val, 0, 1); level = 0.35 + 0.65 * g; apply(0.6); L.target(whistle.g.gain, 0.01 + 0.07 * g, 0.8); };
    L.setters.level = () => {};
    L.tick = (dt) => { timer -= dt; if (timer > 0) return; timer = rnd(3, 9); mul = rnd(0.6, 1.5); apply(rnd(0.8, 2)); };
  });
  defLoop('radius_hum', (L) => {
    const a = L.a, mix = L.keep(a.gain(0.25)); mix.connect(L.out);
    const parts = [[42, 0.5], [63, 0.35], [84.5, 0.25]].map(([f, g]) => { const r = L.osc('sine', f * L.rate, g, mix, rnd(-6, 6)); L.lfo(r.g.gain, rnd(0.03, 0.08), g * 0.4); return r; });
    const floor = L.noise('brown', 'lowpass', 90, 0.7, 0.04, mix);
    L.setters.intensity = (val) => { const i = clamp(val, 0, 1); L.target(mix.gain, 0.12 + 0.9 * i, 0.8); L.target(floor.g.gain, 0.02 + 0.1 * i, 0.8); L.target(parts[1].o.detune, 6 + 20 * i, 1); };
  });
  defLoop('base_hum', (L) => {
    const a = L.a;
    L.osc('sine', 100, 0.06); L.osc('sine', 120, 0.018);
    const bz = L.keep(a.filter('bandpass', 1800, 3)), buzz = L.keep(a.gain(0.04)); bz.connect(buzz); buzz.connect(L.out);
    L.osc('square', 100, 1, bz);
    const lp = L.keep(a.filter('lowpass', 180, 1)), am = L.keep(a.gain(0.35)), gen = L.keep(a.gain(0.14)); lp.connect(am); am.connect(gen); gen.connect(L.out);
    L.osc('sawtooth', 42, 1, lp); L.lfo(am.gain, 6, 0.3);
    let timer = rnd(2, 7);
    L.tick = (dt) => { timer -= dt; if (timer > 0) return; timer = rnd(2, 7); L.target(buzz.gain, 0.1, 0.01); try { buzz.gain.setTargetAtTime(0.04, a.now + rnd(0.05, 0.2), 0.05); } catch {} };
  });
  defLoop('drizzle', (L) => {
    const c1 = L.noise('crackle', 'bandpass', 3200, 0.7, 0.5, null, 1.3); L.lfo(c1.g.gain, 0.1, 0.15);
    L.noise('crackle', 'bandpass', 1500, 1, 0.3, null, 0.8);
    L.noise('pink', 'highpass', 3000, 0.5, 0.04);
    L.setters.intensity = (val) => L.target(c1.g.gain, 0.2 + 0.5 * clamp(val, 0, 1), 0.5);
  });
  def('crow', (v) => seq(v, irnd(2, 3), 0, rnd(0.7, 1.1), (at) => {
    const f = rnd(800, 1000);
    fm(v, { at, type: 'sawtooth', f0: f, f1: f * 0.72, ratio: 1.5, index: 1.8, index1: 1.2, dur: rnd(0.18, 0.26), g: 0.3, atk: 0.02, shape: 18, bp: 1400, bq: 1.5 });
    burst(v, { at, type: 'pink', filt: 'bandpass', f0: 1200, q: 1, dur: 0.22, g: 0.1, atk: 0.02 });
  }));
  def('bird', (v) => {
    tone(v, { f0: 3000, f1: 4500, dur: 0.07, g: 0.15, atk: 0.005 });
    tone(v, { at: 0.12, f0: 4200, f1: 3600, dur: 0.06, g: 0.12, atk: 0.005 });
    if (Math.random() < 0.4) tone(v, { at: 0.22, f0: 3800, f1: 4600, dur: 0.05, g: 0.1, atk: 0.005 });
  });
  // Someone else's gunfire, hundreds of metres off. This is distance modelled, not a filter preset:
  //  * no ballistic crack. The N-wave exists only inside the bullet's Mach cone, and a fight you are listening
  //    to rather than standing in is off-axis, so all that reaches you is the muzzle blast.
  //  * air absorption has eaten the top: at 500 m, 4 kHz is down about 13 dB and 8 kHz about 40, so the report
  //    arrives with nothing above roughly a kilohertz. Two cascaded lowpasses, moving with distance.
  //  * turbulence and ground multipath have smeared the microsecond shock front into tens of milliseconds and
  //    split the report into two or three arrivals.
  //  * what is left is the terrain answering, for a second or more. Over the marsh that is most of the sound.
  // opts.dist sets the range (ambience and scares pass a position, so a default spread is rolled here);
  // opts.variant picks which weapon, so a distant firefight is not one gun repeating.
  const FAR = ['akm', 'ak74m', 'mosin', 'pkm', 'sks'];
  def('distant_shot', (v) => {
    const iv = +v.o.variant, S = OPEN[FAR[(Number.isFinite(iv) ? Math.abs(Math.round(iv)) : irnd(0, 40)) % FAR.length]];
    const dist = clamp(+v.o.dist || rnd(220, 750), 80, 1600), far = dist / 400;
    const cut = clamp(1500 / Math.pow(far, 0.85), 170, 2400), g = 0.9 / Math.pow(far, 0.15);
    const kv = irnd(0, 2), kb = blastKernel(v.a, S.id, S, kv);
    kplay(v, kb, { g, rate: 0.82, lp: cut, lp2: cut * 1.6, lq: 0.9 });
    for (let i = 0; i < irnd(2, 3); i++)                                   // multipath: ground, tree line, ridge
      kplay(v, blastKernel(v.a, S.id, S, (kv + i + 1) % 3), { at: rnd(0.012, 0.06) * far, g: g * rnd(0.28, 0.5), rate: 0.78, lp: cut * 0.7, lp2: cut });
    burst(v, { at: 0.02, type: 'brown', filt: 'lowpass', f0: cut * 0.8, f1: 90, q: 0.6, dur: 0.5 + 0.6 * far, g: 0.5 * g, atk: 0.05 });
    burst(v, { at: 0.06, type: 'pink', filt: 'lowpass', f0: cut * 0.5, f1: 110, q: 0.5, dur: 0.9 + 1.1 * far, g: 0.22 * g, atk: 0.14, curve: 'lin' });
    if (Math.random() < 0.55) kplay(v, kb, { at: rnd(0.22, 0.5), g: g * 0.10, rate: 0.7, lp: cut * 0.55, lp2: cut * 0.8 });
  });
  def('drip', (v) => {
    tone(v, { f0: 1800, f1: 2600, dur: 0.05, g: 0.25, atk: 0.002 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, q: 1.5, dur: 0.015, g: 0.2, atk: 0.001 });
    ring(v, { at: 0.01, freqs: [2400], decay: 0.12, g: 0.04 });
  });

  // ===================================================== ui / game ==============================================
  def('ui_slip', (v) => burst(v, { type: 'pink', filt: 'bandpass', f0: 3000, q: 0.6, dur: 0.12, g: 0.35, atk: 0.02, pr: 1.2, pr1: 0.8 }));
  def('ui_click', (v) => { burst(v, { type: 'white', filt: 'bandpass', f0: 2200, q: 2, dur: 0.01, g: 0.4, atk: 0.0005 }); tone(v, { f0: 800, f1: 500, dur: 0.02, g: 0.15, atk: 0.0005 }); });
  const paper = (v, at, dur, g) => burst(v, { at, type: 'pink', filt: 'bandpass', f0: 2800, q: 0.6, dur, g, atk: 0.03, pr: 1.1, pr1: 0.85 });
  const softThump = (v, at, g) => { thump(v, { at, f0: 120, f1: 80, dur: 0.07, g: g * 0.35 }); burst(v, { at, type: 'brown', filt: 'lowpass', f0: 400, q: 0.7, dur: 0.06, g: g * 0.3, atk: 0.002 }); };
  def('ui_open', (v) => { paper(v, 0, 0.2, 0.3); softThump(v, 0.15, 1); });
  def('ui_close', (v) => { paper(v, 0, 0.14, 0.28); softThump(v, 0.08, 1.2); });
  def('ui_buy', (v) => { ring(v, { freqs: [3200, 4800, 6100], decay: 0.12, g: 0.12 }); click(v, { f: 4000, g: 0.4 }); ring(v, { at: 0.07, freqs: [3400, 5100], decay: 0.1, g: 0.07 }); click(v, { at: 0.07, f: 4200, g: 0.25 }); });
  def('ui_deny', (v) => seq(v, 2, 0, 0.22, (at) => { burst(v, { at, type: 'brown', filt: 'lowpass', f0: 600, q: 0.7, dur: 0.03, g: 0.5, atk: 0.001 }); tone(v, { at, f0: 220, f1: 180, dur: 0.04, g: 0.3, atk: 0.001 }); }));
  def('ui_stamp', (v) => {
    thump(v, { f0: 140, f1: 70, dur: 0.1, g: 0.8 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 500, q: 0.7, dur: 0.08, g: 0.6, atk: 0.001 });
    burst(v, { type: 'white', filt: 'lowpass', f0: 2500, q: 0.7, dur: 0.02, g: 0.3, atk: 0.0005 });
    ring(v, { freqs: [600], decay: 0.05, g: 0.1 });
  });
  const clunk = (v, at, g) => { thump(v, { at, f0: 90, f1: 45, dur: 0.2, g: g * 0.9 }); burst(v, { at, type: 'brown', filt: 'lowpass', f0: 300, q: 0.7, dur: 0.18, g: g * 0.6, atk: 0.001 }); ring(v, { at, freqs: [230, 380, 610], decay: 0.4, g: g * 0.15 }); burst(v, { at, type: 'white', filt: 'bandpass', f0: 1500, q: 1, dur: 0.02, g: g * 0.3, atk: 0.001 }); };
  def('door_open', (v) => {
    creak(v, 0, 180, 240, 0.5, 0.15);
    pulses(v, { n: irnd(4, 7), span: 0.5, type: 'white', f0: 1800, f1: 2800, q: 3, dur: 0.01, g: 0.15 });
    clunk(v, 0.55, 1);
    creak(v, 0.65, 120, 95, 0.6, 0.12);
  });
  def('door_close', (v) => {
    creak(v, 0, 95, 120, 0.5, 0.12);
    clunk(v, 0.5, 1);
    creak(v, 0.65, 240, 180, 0.3, 0.12);
    clack(v, { at: 1.05, f: 1800, g: 0.5, dur: 0.02, decay: 0.15 });
  });
  def('sleep', (v) => {
    [330, 415, 494].forEach((f, i) => tone(v, { f0: f, f1: f / 2, dur: 2.0, g: 0.14 - i * 0.02, atk: 0.4, hold: 0.5, lp: 1200, curve: 'lin', fcurve: 'exp' }));
    tone(v, { f0: 165, f1: 82, dur: 2.0, g: 0.08, atk: 0.6, hold: 0.4, curve: 'lin' });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 200, q: 0.7, dur: 2.0, g: 0.1, atk: 0.8, curve: 'lin' });
  });
  def('mission_complete', (v) => {
    tone(v, { type: 'triangle', f0: 660, dur: 0.18, g: 0.28, atk: 0.003 }); click(v, { f: 2500, g: 0.12 });
    tone(v, { at: 0.2, type: 'triangle', f0: 880, dur: 0.3, g: 0.3, atk: 0.003 }); click(v, { at: 0.2, f: 2500, g: 0.12 });
  });
  def('container_open', (v) => {
    const wooden = v.o.variant === 'crate';
    creak(v, 0, wooden ? 260 : 320, wooden ? 200 : 260, 0.3, 0.12);
    if (wooden) { tone(v, { at: 0.32, f0: 200, f1: 130, dur: 0.05, g: 0.5, atk: 0.001 }); burst(v, { at: 0.32, type: 'white', filt: 'lowpass', f0: 1200, q: 0.7, dur: 0.03, g: 0.4, atk: 0.001 }); ring(v, { at: 0.32, freqs: [420, 640], decay: 0.1, g: 0.08 }); }
    else { clack(v, { at: 0.32, f: 1800, g: 0.5, dur: 0.02, decay: 0.12 }); ring(v, { at: 0.32, freqs: [900, 1500], decay: 0.12, g: 0.08 }); }
  });
  def('pickup_item', (v) => { cloth(v, { n: 2, span: 0.1, g: 0.2 }); click(v, { at: 0.08, f: 3000, g: 0.3, q: 3, dur: 0.008 }); });
  def('pickup_ammo', (v) => {
    seq(v, irnd(5, 8), 0, 0.25, (at) => { const f = rnd(4000, 6500); ring(v, { at, freqs: [f, f * 1.5], decay: 0.05, g: 0.08 }); click(v, { at, f: f * 0.8, g: 0.2, dur: 0.005 }); });
    cloth(v, { n: 2, span: 0.15, g: 0.12 });
  });
  def('bandage_use', (v) => {
    const tr = trem(v, { freq: rnd(35, 45), depth: 0.45, dur: 0.25 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 2500, f1: 1500, q: 1, dur: 0.25, g: 0.35, atk: 0.02, to: tr });
    cloth(v, { at: 0.3, n: 3, span: 0.6, g: 0.18, dur: 0.1 });
  });
  def('medkit_use', (v) => {
    clack(v, { f: 2400, g: 0.45, dur: 0.015, decay: 0.08 });
    burst(v, { at: 0.1, type: 'pink', filt: 'bandpass', f0: 2200, q: 0.8, dur: 0.35, g: 0.2, atk: 0.05 });
    clack(v, { at: 0.5, f: 2200, g: 0.35, dur: 0.012, decay: 0.06 });
  });
  def('stim_use', (v) => {
    click(v, { at: 0.02, f: 3000, g: 0.4, dur: 0.01 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 4000, f1: 2500, q: 1, dur: 0.25, g: 0.3, atk: 0.01 });
    ring(v, { at: 0.28, freqs: [5200, 7800], decay: 0.05, g: 0.06 });
  });
  def('tide_warn', (v) => {
    for (const d of [0, 7]) { tone(v, { f0: 400, f1: 620, dur: 0.75, g: 0.22, atk: 0.2, curve: 'lin', lp: 900, detune: d }); tone(v, { at: 0.75, f0: 620, f1: 400, dur: 0.75, g: 0.22, atk: 0.02, lp: 900, detune: d }); }
    burst(v, { type: 'pink', filt: 'bandpass', f0: 600, q: 0.6, dur: 1.5, g: 0.05, atk: 0.4, curve: 'lin' });
  });
  def('tide_chord', (v) => {
    [110, 165, 220, 277, 330, 440].forEach((f) => tone(v, { f0: f, f1: f * 1.5, dur: 6, g: 0.12, atk: 2, hold: 2.5, curve: 'lin', detune: rnd(-8, 8), lp: 2500 }));
    burst(v, { type: 'white', filt: 'lowpass', f0: 2000, f1: 6000, q: 0.5, dur: 6, g: 0.25, atk: 5, curve: 'lin' });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 150, q: 0.7, dur: 6, g: 0.2, atk: 4, curve: 'lin' });
  });
  def('siren', (v) => {
    for (const d of [0, 6]) { tone(v, { f0: 480, f1: 720, dur: 1.0, g: 0.35, atk: 0.15, curve: 'lin', lp: 700, detune: d }); tone(v, { at: 1.0, f0: 720, f1: 480, dur: 1.0, g: 0.35, atk: 0.02, lp: 700, detune: d }); }
  });

  // ===================================================== player beds (not canonical; DESIGN §13 heartbeat < 30 HP, breathing at low stamina)
  // loop 'heartbeat': lub-dub every beat. set('rate', bpm | Hz), set('level', 0..1). Driven by tick(), so it needs audio.update().
  defLoop('heartbeat', (L) => {
    const a = L.a, mix = L.keep(a.gain(0.6)); mix.connect(L.out);
    let bpm = 72, level = 1, phase = 0.9;
    const beat = (g) => {
      const v = voice(a, mix, {});
      thump(v, { f0: 68, f1: 38, dur: 0.11, g: 0.9 * g }); burst(v, { type: 'brown', filt: 'lowpass', f0: 220, q: 0.7, dur: 0.08, g: 0.5 * g, atk: 0.002 });
      thump(v, { at: 0.14, f0: 58, f1: 34, dur: 0.1, g: 0.6 * g }); burst(v, { at: 0.14, type: 'brown', filt: 'lowpass', f0: 180, q: 0.7, dur: 0.07, g: 0.35 * g, atk: 0.002 });
    };
    L.tick = (dt) => { phase += dt * bpm / 60; if (phase < 1) return; phase -= 1; if (level > 0.01) beat(level * jit(1, 0.1)); };
    L.setters.rate = (val) => { if (Number.isFinite(val) && val > 0) bpm = clamp(val <= 4 ? val * 60 : val, 30, 200); };
    L.setters.level = (val) => { level = clamp(Number.isFinite(val) ? val : 1, 0, 1); };
  });
  // loop 'breath': in through the nose, out through the mouth; each cycle is scheduled when it starts. set('rate', breaths/s), set('level', 0..1).
  defLoop('breath', (L) => {
    const a = L.a, mix = L.keep(a.gain(0.5)); mix.connect(L.out);
    const inh = L.noise('pink', 'bandpass', 1300, 1.2, EPS, mix), exh = L.noise('pink', 'bandpass', 650, 0.9, EPS, mix);
    L.lfo(inh.f.frequency, 0.9, 120); L.lfo(exh.f.frequency, 0.7, 60);
    let period = 2.8, level = 0.7, phase = 0.95;
    const cycle = () => {
      const p = period * jit(1, 0.08), t0 = a.now + 0.01, g = level * jit(1, 0.12);
      a.env(inh.g.gain, [[0, EPS], [p * 0.3, g * 0.55, 'lin'], [p * 0.42, g * 0.35, 'lin'], [p * 0.5, EPS, 'exp']], t0);
      a.env(exh.g.gain, [[0, EPS], [p * 0.45, EPS, 'lin'], [p * 0.58, g, 'lin'], [p * 0.8, g * 0.45, 'lin'], [p * 0.97, EPS, 'exp']], t0);
    };
    L.tick = (dt) => { phase += dt / period; if (phase < 1) return; phase -= 1; if (level > 0.01) cycle(); };
    L.setters.rate = (val) => { if (Number.isFinite(val) && val > 0) period = 1 / clamp(val, 0.15, 1.5); };
    L.setters.level = (val) => { level = clamp(Number.isFinite(val) ? val : 0.7, 0, 1); };
  });
}
