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
// Gunshot: click transient + bandpassed crack sweep + low thump + saw body + noise tail (+ optional mechanical clacks).
function gunshot(v, p = {}) {
  click(v, { g: p.clickG ?? 0.8, f: 3500, dur: 0.003 });
  burst(v, { type: 'white', filt: 'bandpass', f0: p.crackF0 ?? 4000, f1: p.crackF1 ?? 400, q: p.crackQ ?? 0.7, dur: p.crackDur ?? 0.07, g: p.crackG ?? 1, atk: 0.001 });
  thump(v, { f0: p.thumpF0 ?? 90, f1: p.thumpF1 ?? 30, dur: p.thumpDur ?? 0.12, g: p.thumpG ?? 0.9 });
  tone(v, { type: 'sawtooth', f0: p.bodyF0 ?? 140, f1: p.bodyF1 ?? 60, dur: p.bodyDur ?? 0.05, g: p.bodyG ?? 0.4, lp: p.bodyLp ?? 900, shape: p.bodyShape ?? 8, atk: 0.001 });
  if (p.boomG) burst(v, { type: 'brown', filt: 'lowpass', f0: p.boomF ?? 400, f1: (p.boomF ?? 400) * 0.4, q: 0.7, dur: p.boomDur ?? 0.2, g: p.boomG, atk: 0.002 });
  tail(v, { dur: p.tailDur ?? 0.5, g: p.tailG ?? 0.18, f0: p.tailF0 ?? 2500, f1: p.tailF1 ?? 300 });
  if (p.echo) burst(v, { at: p.echo.at ?? 0.12, type: 'pink', filt: 'lowpass', f0: 1200, f1: 200, q: 0.5, dur: p.echo.dur ?? 0.6, g: p.echo.g ?? 0.12, atk: 0.02 });
  for (const m of p.mech || []) clack(v, { at: m.at, f: m.f ?? 2400, g: m.g ?? 0.3, dur: 0.012, decay: 0.05 });
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
  shot_mosin: 0.72, seeker_shot: 0.76, shot_toz: 0.8, shot_akm: 0.85, mimic_shot: 0.9, fragment_explode: 0.88, seeker_death: 0.8, seeker_step: 0.8,
  door_open: 0.85, door_close: 0.85, death: 0.95, ui_stamp: 0.8,
  crow: 5, bird: 3, slider_screech: 3, slider_click: 1.8, slider_death: 2.2, slider_lunge: 1.8, slider_step: 1.8, mimic_radio: 2.2, mimic_skip: 3,
  spawn_skitter: 3, spawn_death: 1.6, spawn_bite: 1.4, seeker_hiss: 1.4, reflector_whip: 1.3, bullet_whiz: 1.4, impact_concrete: 1.3, drip: 1.4, gas_cough: 2.5,
  phantom_hiss: 1.5, phantom_scream: 0.9, phantom_grab: 1.1,
  armor_hit: 1.1, armor_pen: 1.2, helmet_ring: 1.0, ricochet: 2.2, thunder: 1.4,
  ads_in: 4, ads_out: 3.8, click: 4.5, jump: 3.2, ui_slip: 3, ui_click: 1.8, ui_open: 1.3, hurt: 1.3,
  mag_load_round: 3, probe_throw: 3, probe_land: 2, weapon_holster: 2.8, weapon_draw: 2.2, pickup_item: 3, pickup_ammo: 2.2, reload_magout: 2.6,
  bandage_use: 2.5, medkit_use: 1.6, stim_use: 1.3, step_grass: 2, dry_click: 1.8, bolt_open: 2, shell_insert: 1.5, break_open: 1.5, unjam: 1.5,
  container_open: 1.5, artifact_pickup: 1.6, step_road: 1.5, step_concrete: 1.4,
  wind: 1.6, drizzle: 1.5, fragment_chime: 0.8, breath: 1.8,
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
  def('shot_pm', (v) => gunshot(v, { crackF0: 4500, crackDur: 0.055, thumpF0: 85, thumpDur: 0.09, thumpG: 0.6, bodyG: 0.25, bodyLp: 1100, tailDur: 0.4, tailG: 0.12, mech: [{ at: 0.06, f: 2600, g: 0.22 }] }));
  def('shot_akm', (v) => gunshot(v, { crackF0: 3800, crackDur: 0.08, thumpF0: 100, thumpF1: 28, thumpDur: 0.14, thumpG: 1.0, bodyG: 0.5, bodyLp: 700, tailDur: 0.7, tailG: 0.22, mech: [{ at: 0.07, f: 2300, g: 0.3 }, { at: 0.115, f: 1900, g: 0.2 }] }));
  def('shot_toz', (v) => gunshot(v, { crackF0: 3000, crackF1: 250, crackDur: 0.09, crackG: 0.9, thumpF0: 70, thumpF1: 25, thumpDur: 0.2, thumpG: 1.2, bodyF0: 90, bodyF1: 40, bodyDur: 0.12, bodyG: 0.6, bodyLp: 500, boomG: 0.7, boomF: 420, boomDur: 0.2, tailDur: 0.75, tailG: 0.25, tailF0: 1500 }));
  def('shot_mosin', (v) => gunshot(v, { clickG: 1, crackF0: 5000, crackF1: 350, crackDur: 0.09, crackG: 1.2, crackQ: 0.6, thumpF0: 95, thumpF1: 28, thumpDur: 0.16, thumpG: 1.0, bodyG: 0.5, bodyLp: 800, tailDur: 0.9, tailG: 0.3, tailF0: 3000, tailF1: 250, echo: { at: 0.12, dur: 0.7, g: 0.12 } }));
  def('dry_click', (v) => { click(v, { f: 3000, g: 0.4 }); burst(v, { type: 'white', filt: 'bandpass', f0: 1800, q: 3, dur: 0.015, g: 0.4, atk: 0.0008 }); ring(v, { freqs: [2200, 3100], decay: 0.04, g: 0.12 }); });
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
  def('bolt_open', (v) => {
    clack(v, { f: 2300, g: 0.5, dur: 0.015, decay: 0.12 });
    burst(v, { at: 0.03, type: 'white', filt: 'bandpass', f0: 3000, q: 1.5, dur: 0.12, g: 0.2, atk: 0.02, pr: 0.9, pr1: 1.15 });
    ring(v, { at: 0.03, freqs: [1600, 2500], decay: 0.12, g: 0.08 });
  });
  def('bolt_close', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 2800, f1: 2000, q: 1.5, dur: 0.1, g: 0.2, atk: 0.015 });
    clack(v, { at: 0.1, f: 2000, g: 0.65, dur: 0.018, decay: 0.09 });
    thump(v, { at: 0.1, f0: 150, f1: 90, dur: 0.05, g: 0.45 });
  });
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
  def('bullet_whiz', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 5000, f1: 1200, q: 2, dur: 0.08, g: 0.7, atk: 0.005, hp: 1500 });
    tone(v, { f0: 3200, f1: 900, dur: 0.08, g: 0.1, atk: 0.005 });
  });
  def('impact_metal', (v) => {
    click(v, { f: 4000, g: 0.6 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, q: 1, dur: 0.02, g: 0.5, atk: 0.0008 });
    tone(v, { f0: rnd(2200, 2700), dur: 0.25, g: 0.28, atk: 0.001, fjit: 0.02 });
    ring(v, { freqs: [1700, 3300, 4800], decay: 0.3, g: 0.14 });
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
  def('distant_shot', (v) => {
    burst(v, { type: 'brown', filt: 'lowpass', f0: 400, f1: 200, q: 0.7, dur: 0.25, g: 0.8, atk: 0.01 });
    thump(v, { f0: 60, f1: 30, dur: 0.3, g: 0.5 });
    tail(v, { dur: 1.4, g: 0.3, f0: 500, f1: 120, atk: 0.05 });
    tail(v, { at: 0.35, dur: 1.0, g: 0.12, f0: 350, f1: 100, atk: 0.05 });
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
