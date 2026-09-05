// Dynamic music: a drone engine synthesized straight onto the music bus (no registered names).
// Every layer is a persistent little synth graph behind its own GainNode. update() only moves gains,
// frequencies and LFO targets with slow time constants; the only things created after build() are
// nothing at all: sighs, beats, hits and bells are envelopes on voices that already exist.
// Crossfades follow the Director (state + tension), night, the base interior and the Tide countdown.
// Gain discipline: layer gains <= 0.12 (combat <= 0.2) so music always sits well under the sfx bus.
import { clamp01, lerp } from '../core/math.js';

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const cents = (c) => Math.pow(2, c / 1200);
const FIFTH = 1.4983, MIN3 = 1.1892, MAJ3 = 1.2599;
const LOOKAHEAD = 0.6;   // seconds of beats scheduled ahead per frame (every per-beat envelope is shorter than one beat, so lookahead never cancels a live one)

export function createMusic(ctx) {
  const audio = ctx.audio;
  let running = false, built = false, subscribed = false;
  let ac = null, master = null;
  let sources = [], nodes = [];
  const L = {};                      // layers by name
  const issued = new Map();          // AudioParam -> { v, t } last issued target (throttles automation spam)
  let tideRise = 0, lastMode = '', frameDt = 0;

  // ---------- small graph helpers ----------
  const mk = (n) => { nodes.push(n); return n; };
  const gain = (v) => mk(audio.gain(v));
  const filt = (type, f, q) => mk(audio.filter(type, f, q));
  const osc = (type, f, det = 0) => mk(audio.osc(type, f, det));
  function startSrc(s, at) { s.start(at ?? ac.currentTime + rnd(0, 0.04)); sources.push(s); return s; }
  function noise(type) { const s = audio.noise(type); nodes.push(s); sources.push(s); return s; }   // audio.noise() already started it
  // oscillator LFO feeding an AudioParam; random start offset gives a random phase
  function lfo(rate, depth, param, type = 'sine') { const o = osc(type, rate); const g = gain(depth); o.connect(g); g.connect(param); startSrc(o, ac.currentTime + rnd(0, Math.min(1.5, 1 / Math.max(0.01, rate)))); return o; }
  // linear piecewise envelope; pts = [[dt, value], ...] relative to t
  function env(p, t, pts) { p.cancelScheduledValues(t); p.setValueAtTime(pts[0][1], t); for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], t + pts[i][0]); }
  // slow approach with separate attack / release seconds, throttled so we do not flood the automation timeline
  // (s.est tracks roughly where the param actually is, so event schedulers can follow the audible tail)
  function fade(p, v, attack, release) {
    let s = issued.get(p); if (!s) { s = { v: NaN, t: -1, est: 0 }; issued.set(p, s); }
    const now = ac.currentTime;
    const first = Number.isNaN(s.v);
    const tc = Math.max(0.02, (v > s.est ? attack : release) / 3);
    s.est += (v - s.est) * (1 - Math.exp(-frameDt / tc));
    if (!first && Math.abs(s.v - v) < 1e-3) return;
    if (!first && now - s.t < 0.12) return;
    const secs = first || v > s.v ? attack : release;
    s.v = v; s.t = now; p.setTargetAtTime(v, now, Math.max(0.02, secs / 3));
  }
  const audible = (layer) => (issued.get(layer.g.gain)?.est ?? 0) > 0.003;

  // ---------- layers ----------
  function buildFloor() {
    // two detuned low saws a fifth apart (each doubled for beating), slow breathing lowpass, sub sine underneath
    const g = gain(0); g.connect(master);
    const wob = gain(1); lfo(0.07 * rnd(0.8, 1.2), 0.14, wob.gain); wob.connect(g);
    const lp = filt('lowpass', 260, 1.3); lfo(0.05 * rnd(0.85, 1.15), 140, lp.frequency); lp.connect(wob);
    const root = 41.2 * cents(rnd(-12, 12));
    for (const [f, d, v] of [[root, -6, 0.3], [root, 7, 0.3], [root * FIFTH, -5, 0.2], [root * FIFTH, 6, 0.2]]) {
      const o = osc('sawtooth', f, d + rnd(-2, 2)); const og = gain(v); o.connect(og); og.connect(lp); startSrc(o);
    }
    const sub = osc('sine', root); const sg = gain(0.5); sub.connect(sg); sg.connect(wob); startSrc(sub);
    L.floor = { g };
  }

  function buildUnease() {
    const g = gain(0); g.connect(master);
    // high thin tone with slow vibrato, plus a whisper of its octave, fading in and out irregularly
    const f0 = 1200 * cents(rnd(-70, 70));
    // toneG is the slow fade; shim is a gentle amplitude shimmer on top so the sustain never sits perfectly still
    const tone = osc('sine', f0); const toneG = gain(0); const shim = gain(1); lfo(0.13 * rnd(0.8, 1.25), 0.15, shim.gain);
    tone.connect(toneG); toneG.connect(shim); shim.connect(g); startSrc(tone);
    lfo(0.3 * rnd(0.8, 1.25), f0 * (cents(8) - 1), tone.frequency);
    const tone2 = osc('sine', f0 * 2.003, rnd(-9, 9)); const t2g = gain(0.16); tone2.connect(t2g); t2g.connect(toneG); startSrc(tone2);
    // breath: pink noise through a narrow bandpass riding the tone, so it reads as something blown or bowed, not a bare sine
    const airF = filt('bandpass', f0, 14); const airG = gain(1.2); noise('pink').connect(airF); airF.connect(airG); airG.connect(toneG);
    // irregular sub pulse
    const sub = osc('sine', 50); const subG = gain(0); sub.connect(subG); subG.connect(g); startSrc(sub);
    // descending sighs: pink noise through a swept bandpass
    const sighF = filt('bandpass', 2000, 2.4); const sighG = gain(0); noise('pink').connect(sighF); sighF.connect(sighG); sighG.connect(g);
    L.unease = { g, f0, tone, tone2, toneG, airF, sub, subG, sighF, sighG, toneT: rnd(1, 4), sighT: rnd(6, 18), subT: rnd(2, 6) };
  }

  function buildHunt() {
    const g = gain(0); g.connect(master);
    // pulse: a filtered noise tick and a pitched-down thump, scheduled per beat on the audio clock
    const tf = filt('bandpass', 3200, 6); const tickG = gain(0); noise('white').connect(tf); tf.connect(tickG); tickG.connect(g);
    const th = osc('sine', 60); const thG = gain(0); th.connect(thG); thG.connect(g); startSrc(th);
    const knock = osc('triangle', 170); const knG = gain(0); knock.connect(knG); knG.connect(g); startSrc(knock);
    // rising minor cluster: three sines drifting upward over 30 s, then resetting
    const base = 220 * cents(rnd(-120, 80));
    const cl = filt('lowpass', 1400, 0.8); const trem = gain(0.9); lfo(0.9 * rnd(0.8, 1.3), 0.22, trem.gain); const clG = gain(0.5);
    cl.connect(trem); trem.connect(clG); clG.connect(g);
    const clOsc = [];
    for (const r of [1, MIN3, FIFTH]) { const o = osc('sine', base * r, rnd(-8, 8)); const og = gain(0.33); o.connect(og); og.connect(cl); startSrc(o); clOsc.push(o); }
    L.hunt = { g, tf, tickG, th, thG, knock, knG, clOsc, nextBeat: -1, clusterT: 0, beat: 0 };
  }

  function buildCombat() {
    const g = gain(0); g.connect(master);
    // distorted low pulse at 120 bpm: two saws (octave apart) through a shaper and a snapping lowpass
    const pf = 55 * cents(rnd(-30, 30));
    const s1 = osc('sawtooth', pf, -7), s2 = osc('sawtooth', pf * 0.5, 8); const pre = gain(0.55); s1.connect(pre); s2.connect(pre);
    const sh = mk(audio.shaper(35)); const lp = filt('lowpass', 320, 2.2); const pulseG = gain(0);
    pre.connect(sh); sh.connect(lp); lp.connect(pulseG); pulseG.connect(g); startSrc(s1); startSrc(s2);
    // metallic hits: white noise through two high-Q bandpasses retuned per hit
    const b1 = filt('bandpass', 1800, 28), b2 = filt('bandpass', 2900, 18); const hitG = gain(0);
    const hn = noise('white'); hn.connect(b1); hn.connect(b2); b1.connect(hitG); b2.connect(hitG); hitG.connect(g);
    // screaming high band: three detuned saws through a wandering bandpass with a fast tremolo
    const sf = 2500 * cents(rnd(-150, 150));
    const scB = filt('bandpass', sf, 4); lfo(0.17 * rnd(0.7, 1.3), sf * 0.16, scB.frequency);
    const trem = gain(0.5); lfo(rnd(9, 13), 0.48, trem.gain); const scG = gain(0.26);
    scB.connect(trem); trem.connect(scG); scG.connect(g);
    for (const [r, d] of [[1, -11], [1.0035, 13], [1.126, -6]]) { const o = osc('sawtooth', sf * r, d); const og = gain(0.3); o.connect(og); og.connect(scB); startSrc(o); }
    L.combat = { g, pf, s1, s2, lp, pulseG, b1, b2, hitG, nextBeat: -1, beat: 0, hitT: rnd(1, 2.5) };
  }

  function buildAftermath() {
    const g = gain(0.1); g.connect(master);
    // warm pad: three detuned triangle pairs, lowpassed and breathing; a single soft bell
    const lp = filt('lowpass', 900, 0.7); lfo(0.11 * rnd(0.8, 1.2), 220, lp.frequency);
    const padG = gain(0); lp.connect(padG); padG.connect(g);
    const pad = [];
    for (let i = 0; i < 6; i++) { const o = osc('triangle', 130.8); const og = gain(0.2); o.connect(og); og.connect(lp); startSrc(o); pad.push(o); }
    const bellG = gain(0); bellG.connect(g);
    const bell = osc('sine', 660); bell.connect(bellG); startSrc(bell);
    const bell2 = osc('sine', 660 * 2.756); const b2g = gain(0.22); bell2.connect(b2g); b2g.connect(bellG); startSrc(bell2);
    L.aftermath = { g, pad, padG, bell, bell2, bellG, bellAt: -1, active: false };
  }

  function buildTide() {
    const g = gain(0); g.connect(master);
    const lp = filt('lowpass', 1800, 0.6); const shim = gain(0.9); lfo(0.23 * rnd(0.8, 1.2), 0.12, shim.gain); lp.connect(shim); shim.connect(g);
    const base = 164.8 * cents(rnd(-50, 50));
    const oscs = [], det0 = [], rate = [];
    for (const r of [1, 1.0595, 1.1225, 1.1892, 1.2599, 1.3348]) {    // six semitone-stacked sines: a chromatic cluster
      const d = rnd(-14, 14); const o = osc('sine', base * r, d); const og = gain(0.17); o.connect(og); og.connect(lp); startSrc(o);
      oscs.push(o); det0.push(d); rate.push(rnd(0.8, 1.2));
    }
    L.tide = { g, oscs, det0, rate };
  }

  function buildBase() {
    const g = gain(0); g.connect(master);
    // fluorescent-warm hum pad: mains harmonics as soft triangles with a slow wobble
    const lp = filt('lowpass', 520, 0.9); const wob = gain(1); lfo(0.09 * rnd(0.8, 1.2), 0.18, wob.gain); lp.connect(wob); wob.connect(g);
    for (const [f, type, v, d] of [[100, 'triangle', 0.32, -5], [100, 'triangle', 0.32, 6], [150, 'triangle', 0.2, rnd(-4, 4)], [200, 'sine', 0.16, 3], [300.5, 'triangle', 0.1, -8]]) {
      const o = osc(type, f, d); const og = gain(v); o.connect(og); og.connect(lp); startSrc(o);
    }
    L.base = { g };
  }

  function build() {
    ac = audio.ctx;
    master = gain(0); master.connect(audio.musicBus);
    buildFloor(); buildUnease(); buildHunt(); buildCombat(); buildAftermath(); buildTide(); buildBase();
    master.gain.setTargetAtTime(1, ac.currentTime, 0.6);
    built = true;
    if (ctx.director.state === 'AFTERMATH') enterAftermath();
  }

  function teardown(fadeS = 1.2) {
    if (!built) return;
    const now = ac.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(0, now, fadeS / 3);
    const srcs = sources, nds = nodes;
    sources = []; nodes = [];
    for (const s of srcs) { try { s.stop(now + fadeS + 0.05); } catch { /* already stopped */ } }
    setTimeout(() => { for (const n of nds) { try { n.disconnect(); } catch { /* gone */ } } }, (fadeS + 0.25) * 1000);
    for (const k of Object.keys(L)) delete L[k];
    issued.clear(); master = null; built = false;
  }

  // ---------- scheduled musical events (envelopes on existing voices) ----------
  function uneaseEvents(u, dt) {
    const now = ac.currentTime;
    u.toneT -= dt;
    if (u.toneT <= 0) {
      u.toneT = rnd(6, 16);
      const lvl = Math.random() < 0.35 ? 0 : rnd(0.25, 1);
      u.toneG.gain.setTargetAtTime(lvl, now, rnd(1.2, 2.6));
      const f = u.f0 * cents(rnd(-45, 45));
      u.tone.frequency.setTargetAtTime(f, now, 3); u.tone2.frequency.setTargetAtTime(f * 2.003, now, 3); u.airF.frequency.setTargetAtTime(f, now, 3);
    }
    u.subT -= dt;
    if (u.subT <= 0) {
      u.subT = rnd(4, 9); const t = now + 0.02;
      u.sub.frequency.setValueAtTime(rnd(46, 54), t);
      env(u.subG.gain, t, [[0, 0], [0.06, rnd(0.6, 1)], [rnd(0.5, 0.9), 0]]);
    }
    u.sighT -= dt;
    if (u.sighT <= 0) {
      u.sighT = rnd(20, 40); const t = now + 0.02, len = rnd(2.6, 3.4);
      u.sighF.frequency.cancelScheduledValues(t); u.sighF.frequency.setValueAtTime(2000 * rnd(0.85, 1.2), t); u.sighF.frequency.exponentialRampToValueAtTime(200 * rnd(0.8, 1.25), t + len);
      u.sighF.Q.setValueAtTime(rnd(1.8, 3.2), t);
      env(u.sighG.gain, t, [[0, 0], [0.5, rnd(0.5, 0.9)], [len * 0.55, rnd(0.3, 0.5)], [len, 0]]);
    }
  }

  function huntEvents(h, dt, tension) {
    const now = ac.currentTime;
    const bpm = lerp(72, 100, clamp01((tension - 0.5) / 0.5));
    const period = 60 / bpm;
    // beats are scheduled up to LOOKAHEAD s ahead on the audio clock; a frame hitch longer than that restarts the pulse
    if (h.nextBeat < now - 0.6) h.nextBeat = now + 0.05;
    while (h.nextBeat < now + LOOKAHEAD) {
      const t = h.nextBeat + rnd(-0.008, 0.008);
      h.tf.frequency.setValueAtTime(rnd(2600, 4400), t); h.tf.Q.setValueAtTime(rnd(4, 9), t);
      env(h.tickG.gain, t, [[0, 0], [0.004, rnd(0.45, 0.8)], [rnd(0.035, 0.06), 0]]);
      h.th.frequency.cancelScheduledValues(t); h.th.frequency.setValueAtTime(rnd(85, 100), t); h.th.frequency.exponentialRampToValueAtTime(rnd(44, 52), t + 0.14);
      env(h.thG.gain, t, [[0, 0], [0.012, rnd(0.7, 1)], [rnd(0.28, 0.36), 0]]);
      if (h.beat % 2 === 1) { h.knock.frequency.setValueAtTime(rnd(150, 190), t); env(h.knG.gain, t, [[0, 0], [0.003, rnd(0.15, 0.3)], [0.03, 0]]); }
      h.beat++; h.nextBeat += period;
    }
    h.clusterT -= dt;
    if (h.clusterT <= 0) {
      h.clusterT = 30; const t = now + 0.02, rise = 240 + rnd(-40, 60);
      for (const o of h.clOsc) { o.detune.cancelScheduledValues(t); o.detune.setValueAtTime(rnd(-8, 8), t); o.detune.linearRampToValueAtTime(rise + rnd(-20, 20), t + 30); }
    }
  }

  function combatEvents(c, dt) {
    const now = ac.currentTime;
    if (c.nextBeat < now - 0.6) c.nextBeat = now + 0.05;
    while (c.nextBeat < now + LOOKAHEAD) {
      const t = c.nextBeat + rnd(-0.005, 0.005); const accent = c.beat % 4 === 0;
      const lvl = accent ? 1 : rnd(0.5, 0.75);
      c.lp.frequency.cancelScheduledValues(t); c.lp.frequency.setValueAtTime(accent ? rnd(480, 600) : rnd(250, 380), t); c.lp.frequency.exponentialRampToValueAtTime(110, t + 0.3);
      if (c.beat % 8 === 6) { const drop = c.pf * 0.75; c.s1.frequency.setValueAtTime(drop, t); c.s2.frequency.setValueAtTime(drop * 0.5, t); c.s1.frequency.setValueAtTime(c.pf, t + 0.46); c.s2.frequency.setValueAtTime(c.pf * 0.5, t + 0.46); }
      env(c.pulseG.gain, t, [[0, 0], [0.008, lvl], [0.2, lvl * 0.35], [0.42, 0]]);
      c.beat++; c.nextBeat += 0.5;
    }
    c.hitT -= dt;
    if (c.hitT <= 0) {
      c.hitT = rnd(1.5, 4); const t = now + 0.02, f = rnd(900, 3400);
      c.b1.frequency.setValueAtTime(f, t); c.b2.frequency.setValueAtTime(f * rnd(1.4, 2.2), t);
      c.b1.Q.setValueAtTime(rnd(22, 34), t); c.b2.Q.setValueAtTime(rnd(14, 22), t);
      env(c.hitG.gain, t, [[0, 0], [0.003, rnd(1.0, 1.5)], [0.08, 0.45], [rnd(0.5, 1.3), 0]]);
    }
  }

  function enterAftermath() {
    const a = L.aftermath; if (!a) return;
    const now = ac.currentTime, t = now + 0.05;
    const root = [130.8, 146.8, 174.6, 196.0][Math.floor(rnd(0, 4))] * cents(rnd(-15, 15));
    const voicing = Math.random() < 0.5 ? [1, MAJ3, FIFTH] : [1, FIFTH, 2.2449];   // major triad, or root-fifth-ninth
    a.pad.forEach((o, i) => { o.frequency.setValueAtTime(root * voicing[i % 3], t); o.detune.setValueAtTime((i % 2 ? 1 : -1) * rnd(5, 10), t); });
    a.padG.gain.cancelScheduledValues(t); a.padG.gain.setValueAtTime(0, t);
    a.padG.gain.linearRampToValueAtTime(1, t + 4); a.padG.gain.linearRampToValueAtTime(0.8, t + 9); a.padG.gain.linearRampToValueAtTime(0, t + 22);
    const bf = root * (Math.random() < 0.5 ? 4 : 5) * cents(rnd(-6, 6));   // the chord's root or major third, two octaves up
    a.bellAt = t + rnd(1.5, 3.2);
    a.bell.frequency.setValueAtTime(bf, a.bellAt); a.bell2.frequency.setValueAtTime(bf * 2.756, a.bellAt);
    a.bellG.gain.cancelScheduledValues(a.bellAt); a.bellG.gain.setValueAtTime(0, a.bellAt);
    a.bellG.gain.linearRampToValueAtTime(rnd(0.5, 0.75), a.bellAt + 0.006); a.bellG.gain.exponentialRampToValueAtTime(0.001, a.bellAt + rnd(2.2, 3.2)); a.bellG.gain.linearRampToValueAtTime(0, a.bellAt + 3.4);
    a.active = true;
  }
  function leaveAftermath() {
    const a = L.aftermath; if (!a || !a.active) return;
    const now = ac.currentTime;
    a.padG.gain.cancelScheduledValues(now); a.padG.gain.setValueAtTime(a.padG.gain.value, now); a.padG.gain.setTargetAtTime(0, now, 1.2);
    if (a.bellAt > now) { a.bellG.gain.cancelScheduledValues(now); a.bellG.gain.setValueAtTime(0, now); }
    a.active = false;
  }

  // ---------- events ----------
  function subscribe() {
    if (subscribed) return; subscribed = true;
    ctx.events.on('directorState', (s, prev) => { if (!built) return; if (s === 'AFTERMATH') enterAftermath(); else if (prev === 'AFTERMATH') leaveAftermath(); });
    ctx.events.on('tideRising', () => { tideRise = 1; });
    ctx.events.on('tide', () => { tideRise = 0; });
  }

  // ---------- per-frame ----------
  function update(dt) {
    if (!running) return;
    if (!built) { if (audio.ready) build(); else return; }
    frameDt = dt;
    const mode = ctx.mode;
    const s = ctx.director.state, tension = ctx.director.tension, night = ctx.time.night;
    const inBase = ctx.player.inBase ? 1 : 0;
    const live = (mode === 'playing' || mode === 'dead') && !ctx.panels?.isOpen;
    const duck = mode === 'title' ? 0 : mode === 'dead' ? 0.45 : mode === 'paused' ? 0.7 : 1;
    if (mode !== lastMode) { lastMode = mode; if (mode === 'title') tideRise = 0; }

    // state weights (night raises the floor: CALM at night leans into unease)
    let wUnease = s === 'UNEASE' ? 1 : s === 'HUNT' ? 0.5 : s === 'AFTERMATH' ? 0.1 : s === 'CALM' ? night * 0.55 : 0;
    if (s !== 'COMBAT') wUnease = clamp01(wUnease + tension * 0.25);
    const wHunt = s === 'HUNT' ? 1 : s === 'COMBAT' ? 0.4 : s === 'UNEASE' ? clamp01((tension - 0.4) / 0.4) * 0.5 : 0;
    const wCombat = s === 'COMBAT' ? 1 : 0;

    const floor = (0.055 + night * 0.025) * (1 - wCombat * 0.85) * (1 - inBase * 0.94);
    fade(L.floor.g.gain, floor * duck, 4, 8);
    fade(L.unease.g.gain, 0.1 * wUnease * (1 - inBase) * duck, 5, 8);
    fade(L.hunt.g.gain, 0.1 * wHunt * (1 - inBase) * duck, 3, 6);
    fade(L.combat.g.gain, 0.19 * wCombat * duck, 2, 6);
    fade(L.base.g.gain, 0.06 * inBase * duck, 5, 4);
    fade(L.aftermath.g.gain, 0.1 * duck, 2, 4);

    // tide cluster: grows through the last in-game hour, crescendo when the Tide rises, gone after the reset
    const tideIn = ctx.time.tideIn();
    const w = tideIn < 3600 ? clamp01(1 - Math.max(0, tideIn) / 3600) : 0;
    const tideLvl = (w > 0 ? 0.1 * (0.12 + 0.88 * w * w) : 0) + tideRise * 0.06;
    fade(L.tide.g.gain, Math.min(0.16, tideLvl) * duck, tideRise ? 3 : 6, 5);
    const glide = w > 0 || tideRise ? 520 * w + 1300 * tideRise : 0;   // settles back down once the window is over
    L.tide.oscs.forEach((o, i) => fade(o.detune, L.tide.det0[i] + glide * L.tide.rate[i], tideRise ? 5 : 12, 12));

    // scheduled events only while the layer is audible and the world is running
    if (!live) return;
    if (audible(L.unease)) uneaseEvents(L.unease, dt);
    if (audible(L.hunt)) huntEvents(L.hunt, dt, tension); else L.hunt.nextBeat = -1;
    if (audible(L.combat)) combatEvents(L.combat, dt); else L.combat.nextBeat = -1;
  }

  return {
    start() { subscribe(); running = true; if (built && master) master.gain.setTargetAtTime(1, ac.currentTime, 0.6); },
    stop() { running = false; teardown(1.2); },
    update,
    // debug: last issued layer targets
    levels() { const o = {}; for (const k in L) { const s = issued.get(L[k].g.gain); o[k] = +(s?.v ?? 0).toFixed(4); o[k + '_est'] = +(s?.est ?? 0).toFixed(4); } return o; },
    get built() { return built; },
  };
}
