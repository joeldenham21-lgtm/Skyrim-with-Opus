/**
 * WYRMHOLD — procedural audio.
 *
 * There are no sound files. Everything — footsteps, steel on steel, bowstrings,
 * fire, wind, rain, thunder, wolves, and the adaptive score — is synthesised at
 * runtime with the Web Audio API. The music engine layers a slow modal drone,
 * a hardanger-ish bowed melody, a hand drum and a choir pad, and cross-fades
 * between exploration, danger, combat, town and night moods.
 */

import { settings } from '../core/settings.js';
import { clamp, saturate, lerp, mod, Rand } from '../core/math.js';

const NOTE = f => f;
const SCALE_AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const SCALE_DORIAN = [0, 2, 3, 5, 7, 9, 10];
const SCALE_PHRYG = [0, 1, 3, 5, 7, 8, 10];

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.rand = new Rand(20260726);
    this.mood = 'explore';
    this.moodLevel = { explore: 1, danger: 0, combat: 0, town: 0, night: 0, sad: 0 };
    this.beat = 0;
    this.bar = 0;
    this.nextNoteTime = 0;
    this.tempo = 74;
    this.key = 45;                 // A2
    this.scale = SCALE_AEOLIAN;
    this._envNodes = {};
    this._lastFootstep = 0;
    this._pending = [];
  }

  /** Audio contexts must be created from a user gesture. */
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = settings.get('volMaster');
    // A gentle limiter keeps combat from clipping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.22;
    this.master.connect(this.limiter).connect(ctx.destination);

    const bus = (vol) => { const g = ctx.createGain(); g.gain.value = vol; g.connect(this.master); return g; };
    this.busMusic = bus(settings.get('volMusic'));
    this.busSfx = bus(settings.get('volSfx'));
    this.busAmb = bus(settings.get('volAmbient'));
    this.busUi = bus(settings.get('volUi'));

    // Shared reverb — a synthesised impulse response (valley / hall).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.6, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.32;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this._buildNoiseBuffer();
    this._startAmbience();
    this._startMusic();
    this.ready = true;
    for (const fn of this._pending) fn();
    this._pending.length = 0;
    return true;
  }

  resume() {
    if (!this.ctx) { this.init(); return; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections + exponential tail
        const env = Math.pow(1 - t, decay);
        let v = (Math.random() * 2 - 1) * env;
        if (i < rate * 0.05) v *= 0.4 + Math.random() * 0.6;
        d[i] = v;
      }
    }
    return buf;
  }

  _buildNoiseBuffer() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // pink-ish filtering: much easier on the ear for wind and rain
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
    this.noiseBuffer = buf;
    const wbuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = wbuf.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.whiteBuffer = wbuf;
  }

  noiseSource(white = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = white ? this.whiteBuffer : this.noiseBuffer;
    s.loop = true;
    return s;
  }

  applySettings() {
    if (!this.ready) return;
    this.master.gain.value = this.muted ? 0 : settings.get('volMaster');
    this.busMusic.gain.value = settings.get('volMusic');
    this.busSfx.gain.value = settings.get('volSfx');
    this.busAmb.gain.value = settings.get('volAmbient');
    this.busUi.gain.value = settings.get('volUi');
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready) this.master.gain.value = m ? 0 : settings.get('volMaster');
  }

  // -------------------------------------------------------------------------
  // Ambience: wind, rain, water, birds, night insects
  // -------------------------------------------------------------------------
  _startAmbience() {
    const ctx = this.ctx;
    const mk = (freq, q, gain, type = 'bandpass') => {
      const src = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(this.busAmb);
      src.start();
      return { src, f, g };
    };
    this.amb = {
      windLow: mk(190, 0.7, 0.0),
      windHigh: mk(1250, 1.6, 0.0),
      rain: mk(4200, 0.55, 0.0),
      rainLow: mk(700, 0.8, 0.0),
      water: mk(560, 0.9, 0.0),
      interior: mk(140, 0.6, 0.0),
    };
    // Slow LFO on the wind so it breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(this.amb.windHigh.f.frequency);
    lfo.start();
  }

  /** @param {object} state { windStrength, rain, snow, nearWater, interior, night, indoors } */
  updateAmbience(state, dt) {
    if (!this.ready) return;
    const a = this.amb;
    const set = (node, v) => { node.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.6); };
    const w = state.windStrength ?? 0.3;
    set(a.windLow, 0.055 + w * 0.30);
    set(a.windHigh, (0.012 + w * 0.13) * (state.exposed ?? 1));
    set(a.rain, (state.rain ?? 0) * 0.28);
    set(a.rainLow, (state.rain ?? 0) * 0.13);
    set(a.water, (state.nearWater ?? 0) * 0.14);
    set(a.interior, state.interior ? 0.05 : 0);

    // Occasional wildlife.
    this._critterT = (this._critterT ?? 0) - dt;
    if (this._critterT <= 0) {
      this._critterT = 4 + this.rand.float(0, 12);
      if (!state.interior && this.rand.bool(0.55)) {
        if (state.night) this.owl();
        else this.birdCall();
      }
    }
  }

  // -------------------------------------------------------------------------
  // One-shot synthesis helpers
  // -------------------------------------------------------------------------
  _now() { return this.ctx.currentTime; }

  _osc(type, freq, t0, dur, gain, bus, detune = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus || this.busSfx);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return { o, g };
  }

  _noiseBurst(t0, dur, freq, q, gain, bus, type = 'bandpass', sweepTo = null) {
    const ctx = this.ctx;
    const s = this.noiseSource(true);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.008, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(bus || this.busSfx);
    s.start(t0); s.stop(t0 + dur + 0.03);
    return { s, f, g };
  }

  _sendReverb(node, amount = 0.25) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.reverb);
  }

  // ---- gameplay sounds ----------------------------------------------------
  play(name, opts = {}) {
    if (!this.ready) { if (this._pending.length < 8) this._pending.push(() => this.play(name, opts)); return; }
    const fn = this['sfx_' + name];
    if (fn) fn.call(this, opts);
  }

  /** Random multiplier around 1 — the cheapest cure for machine-gun sameness. */
  _vary(amount = 0.12) { return 1 + (this.rand.next() - 0.5) * 2 * amount; }

  /**
   * A footstep is three things happening within 30 ms: the heel landing (a
   * pitched thud in the ground), the sole compressing whatever is underfoot,
   * and a small scuff as the foot settles. One noise burst gives you a
   * metronome; layering and detuning gives you walking.
   */
  footstep(surface = 'grass', strength = 1) {
    if (!this.ready) return;
    const t = this._now();
    if (t - this._lastFootstep < 0.09) return;
    this._lastFootstep = t;
    const v = (0.050 + strength * 0.095) * this._vary(0.18);
    const p = this._vary(0.16);
    const thud = (freq, dur, gain) => {
      const o = this._osc('sine', freq * p, t, dur, gain);
      o.o.frequency.exponentialRampToValueAtTime(freq * p * 0.55, t + dur);
    };
    switch (surface) {
      case 'snow':
        this._noiseBurst(t, 0.19 * p, 780 * p, 0.6, v * 0.85, this.busSfx, 'lowpass', 240);
        this._noiseBurst(t + 0.03, 0.13, 3200 * p, 1.0, v * 0.16, this.busSfx, 'highpass');
        thud(78, 0.09, v * 0.30);
        break;
      case 'stone':
        this._noiseBurst(t, 0.055 * p, 2800 * p, 2.4, v * 0.9, this.busSfx, 'bandpass', 1100);
        this._noiseBurst(t + 0.018, 0.10, 5200 * p, 1.6, v * 0.22, this.busSfx, 'highpass');
        thud(112, 0.10, v * 0.55);
        break;
      case 'gravel':
        this._noiseBurst(t, 0.09 * p, 2100 * p, 1.0, v * 0.85, this.busSfx, 'bandpass', 620);
        this._noiseBurst(t + 0.035 * p, 0.10, 3400 * p, 0.9, v * 0.35, this.busSfx, 'bandpass', 1400);
        thud(92, 0.08, v * 0.35);
        break;
      case 'water':
        this._noiseBurst(t, 0.26 * p, 1300 * p, 0.5, v * 1.2, this.busSfx, 'lowpass', 220);
        this._noiseBurst(t + 0.05, 0.18, 2600, 0.8, v * 0.4, this.busSfx, 'bandpass', 900);
        break;
      case 'wood':
        this._noiseBurst(t, 0.05, 480 * p, 2.6, v * 0.9);
        thud(148 * p, 0.13, v * 0.75);
        thud(232 * p, 0.07, v * 0.30);
        break;
      case 'forest':
        this._noiseBurst(t, 0.12 * p, 1400 * p, 0.7, v * 0.8, this.busSfx, 'lowpass', 380);
        this._noiseBurst(t + 0.028, 0.11, 4200 * p, 0.9, v * 0.26, this.busSfx, 'highpass');
        thud(84, 0.09, v * 0.35);
        break;
      default:
        this._noiseBurst(t, 0.10 * p, 1050 * p, 0.7, v * 0.85, this.busSfx, 'lowpass', 340);
        this._noiseBurst(t + 0.03, 0.10, 2800 * p, 0.8, v * 0.22, this.busSfx, 'bandpass', 1200);
        thud(88, 0.09, v * 0.40);
    }
  }

  sfx_swing({ heavy = false } = {}) {
    const t = this._now();
    const p = this._vary(0.14);
    // The whoosh rises as the blade accelerates past you and falls away after.
    const dur = (heavy ? 0.38 : 0.24) * p;
    const n = this._noiseBurst(t, dur, (heavy ? 320 : 520) * p, 2.2,
      heavy ? 0.18 : 0.12, this.busSfx, 'bandpass');
    n.f.frequency.exponentialRampToValueAtTime((heavy ? 1500 : 2100) * p, t + dur * 0.45);
    n.f.frequency.exponentialRampToValueAtTime((heavy ? 200 : 360) * p, t + dur);
    if (heavy) this._osc('sine', 70 * p, t + dur * 0.4, 0.16, 0.07);
  }
  sfx_hitFlesh({ crit = false } = {}) {
    const t = this._now();
    const p = this._vary(0.12);
    // wet slap, body thump, and a short tail of cloth
    this._noiseBurst(t, 0.055 * p, 900 * p, 1.2, crit ? 0.26 : 0.17, this.busSfx, 'bandpass', 320);
    this._noiseBurst(t + 0.01, 0.14 * p, 300 * p, 0.8, crit ? 0.28 : 0.19, this.busSfx, 'lowpass', 100);
    const o = this._osc('sine', (crit ? 84 : 108) * p, t, 0.16, crit ? 0.22 : 0.14);
    o.o.frequency.exponentialRampToValueAtTime((crit ? 48 : 62) * p, t + 0.16);
    if (crit) this._noiseBurst(t + 0.03, 0.22, 1800, 0.7, 0.10, this.busSfx, 'bandpass', 500);
  }
  sfx_hitMetal() {
    const t = this._now();
    const p = this._vary(0.09);
    // Inharmonic partials — a struck plate is not a harmonic series.
    for (const [f, g, d] of [[2380, 0.085, 0.55], [3610, 0.060, 0.40], [5240, 0.040, 0.28],
                             [1490, 0.070, 0.75], [7900, 0.022, 0.18]]) {
      const n = this._osc('triangle', f * p * this._vary(0.02), t, d, g);
      this._sendReverb(n.g, 0.45);
    }
    this._noiseBurst(t, 0.05, 6200 * p, 2.0, 0.13);
    this._osc('sine', 190 * p, t, 0.09, 0.06);
  }
  sfx_hitStone() {
    const t = this._now();
    const p = this._vary(0.14);
    this._noiseBurst(t, 0.13 * p, 950 * p, 1.5, 0.20, this.busSfx, 'bandpass', 220);
    this._noiseBurst(t, 0.035, 4200 * p, 1.8, 0.10, this.busSfx, 'highpass');
    const o = this._osc('triangle', 168 * p, t, 0.12, 0.09);
    o.o.frequency.exponentialRampToValueAtTime(96 * p, t + 0.12);
  }
  sfx_block() {
    const t = this._now();
    const p = this._vary(0.11);
    this._noiseBurst(t, 0.10 * p, 1900 * p, 1.1, 0.20, this.busSfx, 'bandpass', 430);
    const o = this._osc('triangle', 300 * p, t, 0.18, 0.12);
    this._sendReverb(o.g, 0.35);
    this._osc('sine', 96 * p, t, 0.13, 0.10);
  }
  sfx_bowDraw() {
    const t = this._now();
    const n = this._noiseBurst(t, 0.42, 700, 4.0, 0.10, this.busSfx, 'bandpass');
    n.f.frequency.exponentialRampToValueAtTime(1500, t + 0.42);
  }
  sfx_bowRelease() {
    const t = this._now();
    this._osc('triangle', 220, t, 0.13, 0.16);
    this._noiseBurst(t, 0.20, 2200, 1.2, 0.14, this.busSfx, 'bandpass', 600);
  }
  sfx_arrowHit() {
    const t = this._now();
    this._noiseBurst(t, 0.09, 1400, 2.0, 0.18, this.busSfx, 'bandpass', 400);
  }
  sfx_cast({ element = 'fire' } = {}) {
    const t = this._now();
    const base = { fire: 180, frost: 420, shock: 640, heal: 520 }[element] ?? 300;
    const o = this._osc(element === 'shock' ? 'sawtooth' : 'sine', base, t, 0.5, 0.13);
    o.o.frequency.exponentialRampToValueAtTime(base * (element === 'frost' ? 2.6 : 0.55), t + 0.5);
    this._noiseBurst(t, 0.45, element === 'fire' ? 900 : 3200, 1.0, 0.10, this.busSfx, 'bandpass',
      element === 'fire' ? 300 : 6000);
    this._sendReverb(o.g, 0.5);
  }
  sfx_impactMagic({ element = 'fire' } = {}) {
    const t = this._now();
    if (element === 'fire') {
      this._noiseBurst(t, 0.55, 500, 0.8, 0.30, this.busSfx, 'lowpass', 90);
      this._osc('sine', 70, t, 0.4, 0.22);
    } else if (element === 'frost') {
      for (let i = 0; i < 5; i++) this._osc('triangle', 1800 + i * 900, t + i * 0.012, 0.22, 0.07);
      this._noiseBurst(t, 0.3, 5200, 1.6, 0.16);
    } else {
      this._noiseBurst(t, 0.16, 3000, 0.6, 0.30, this.busSfx, 'highpass');
      this._osc('sawtooth', 900, t, 0.10, 0.14);
    }
  }
  sfx_levelUp() {
    const t = this._now();
    const root = midiToFreq(this.key + 24);
    [0, 4, 7, 12].forEach((s, i) => {
      const n = this._osc('sine', root * Math.pow(2, s / 12), t + i * 0.09, 1.4, 0.10, this.busUi);
      this._sendReverb(n.g, 0.6);
    });
  }
  sfx_ui({ kind = 'move' } = {}) {
    const t = this._now();
    // Wood and parchment, not a phone notification: a short knock with a bit of
    // body, plus a paper-dry noise tick on top.
    const p = this._vary(0.06);
    const f = (kind === 'accept' ? 260 : kind === 'back' ? 150 : 200) * p;
    const o = this._osc('triangle', f, t, kind === 'accept' ? 0.16 : 0.10, 0.075, this.busUi);
    o.o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.09);
    this._noiseBurst(t, 0.035, 2600 * p, 1.6, 0.045, this.busUi, 'bandpass');
    if (kind === 'accept') {
      const n = this._osc('sine', f * 3, t + 0.035, 0.22, 0.045, this.busUi);
      this._sendReverb(n.g, 0.4);
    }
  }
  sfx_loot() {
    const t = this._now();
    for (let i = 0; i < 4; i++) this._noiseBurst(t + i * 0.03, 0.09, 2600 + i * 700, 3.0, 0.07, this.busUi);
  }
  sfx_door({ open = true } = {}) {
    const t = this._now();
    const n = this._noiseBurst(t, 0.8, 320, 3.0, 0.13, this.busSfx, 'bandpass', open ? 600 : 180);
    this._sendReverb(n.g, 0.5);
    this._osc('sine', 90, t + 0.7, 0.2, 0.10);
  }
  sfx_thunder({ distance = 0.4 } = {}) {
    const t = this._now() + distance * 2.6;
    const dur = 1.6 + distance * 2.4;
    const n = this._noiseBurst(t, dur, lerp(700, 130, distance), 0.5, lerp(0.42, 0.16, distance),
      this.busAmb, 'lowpass', 60);
    this._sendReverb(n.g, 0.8);
    for (let i = 0; i < 3; i++) {
      this._noiseBurst(t + 0.2 + i * this.rand.float(0.15, 0.5), 0.6, 200, 0.7,
        lerp(0.14, 0.05, distance), this.busAmb, 'lowpass', 70);
    }
  }
  sfx_wolfHowl() {
    const t = this._now();
    const o = this._osc('sawtooth', 300, t, 1.9, 0.09, this.busAmb);
    o.o.frequency.setValueAtTime(240, t);
    o.o.frequency.exponentialRampToValueAtTime(430, t + 0.5);
    o.o.frequency.exponentialRampToValueAtTime(360, t + 1.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    this._sendReverb(o.g, 0.7);
  }
  sfx_growl() {
    const t = this._now();
    const o = this._osc('sawtooth', 82, t, 0.7, 0.13);
    o.o.frequency.exponentialRampToValueAtTime(62, t + 0.7);
    this._noiseBurst(t, 0.7, 300, 1.2, 0.09, this.busSfx, 'lowpass', 140);
  }
  sfx_dragonRoar() {
    const t = this._now();
    const o = this._osc('sawtooth', 58, t, 2.4, 0.30);
    o.o.frequency.setValueAtTime(46, t);
    o.o.frequency.exponentialRampToValueAtTime(96, t + 0.6);
    o.o.frequency.exponentialRampToValueAtTime(40, t + 2.3);
    this._sendReverb(o.g, 0.9);
    this._noiseBurst(t, 2.2, 420, 0.6, 0.20, this.busSfx, 'lowpass', 120);
    this._osc('sawtooth', 29, t, 2.4, 0.18);
  }
  sfx_fireBreath() {
    const t = this._now();
    const n = this._noiseBurst(t, 1.5, 800, 0.5, 0.26, this.busSfx, 'lowpass', 200);
    this._sendReverb(n.g, 0.4);
  }
  sfx_splash({ big = false } = {}) {
    const t = this._now();
    this._noiseBurst(t, big ? 0.7 : 0.35, 1800, 0.6, big ? 0.28 : 0.16, this.busSfx, 'lowpass', 260);
  }
  sfx_drink() {
    const t = this._now();
    for (let i = 0; i < 3; i++) this._osc('sine', 260 - i * 40, t + i * 0.13, 0.12, 0.09);
  }
  sfx_forge() {
    const t = this._now();
    this.sfx_hitMetal();
    this._noiseBurst(t + 0.05, 0.5, 300, 0.7, 0.10, this.busSfx, 'lowpass', 120);
  }
  birdCall() {
    const t = this._now();
    const base = 1800 + this.rand.float(0, 1400);
    for (let i = 0; i < this.rand.int(2, 4); i++) {
      const o = this._osc('sine', base, t + i * 0.13, 0.10, 0.045, this.busAmb);
      o.o.frequency.exponentialRampToValueAtTime(base * this.rand.float(0.7, 1.5), t + i * 0.13 + 0.09);
    }
  }
  owl() {
    const t = this._now();
    for (const d of [0, 0.42]) {
      const o = this._osc('sine', 420, t + d, 0.34, 0.05, this.busAmb);
      o.o.frequency.exponentialRampToValueAtTime(370, t + d + 0.3);
      this._sendReverb(o.g, 0.6);
    }
  }

  // -------------------------------------------------------------------------
  // Adaptive music
  // -------------------------------------------------------------------------
  _startMusic() {
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.9;
    this.musicGain.connect(this.busMusic);
    const rv = ctx.createGain();
    rv.gain.value = 0.62;
    this.musicGain.connect(rv);
    rv.connect(this.reverb);

    // --- low strings: three saws, detuned in cents, behind a soft lowpass ----
    this.drone = { osc: [], gain: ctx.createGain(), filter: ctx.createBiquadFilter() };
    this.drone.gain.gain.value = 0;
    this.drone.filter.type = 'lowpass';
    this.drone.filter.frequency.value = 420;
    this.drone.filter.Q.value = 0.4;
    for (const det of [-9, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFreq(this.key - 12);
      o.detune.value = det;
      o.connect(this.drone.filter);
      o.start();
      this.drone.osc.push(o);
    }
    this.drone.filter.connect(this.drone.gain).connect(this.musicGain);

    // --- choir pad: sine partials through two vowel formants -----------------
    this.pad = { osc: [], gain: ctx.createGain(), voices: [] };
    this.pad.gain.gain.value = 0;
    const formant = (freq, q, g) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g;
      f.connect(gg).connect(this.pad.gain);
      return f;
    };
    // "ah" formants — the difference between a choir and a bank of sine waves
    const f1 = formant(700, 5, 0.9), f2 = formant(1220, 7, 0.5), f3 = formant(2600, 9, 0.18);
    const mixIn = ctx.createGain();
    mixIn.connect(f1); mixIn.connect(f2); mixIn.connect(f3);
    const direct = ctx.createGain(); direct.gain.value = 0.35;
    direct.connect(this.pad.gain);
    mixIn.connect(direct);
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = midiToFreq(this.key + [0, 7, 12, 15][i]);
      const g = ctx.createGain();
      g.gain.value = [0.34, 0.24, 0.18, 0.10][i];
      o.connect(g).connect(mixIn);
      o.start();
      // Slow, slightly irregular vibrato per voice: singers do not agree.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.6 + i * 0.47;
      const lg = ctx.createGain();
      lg.gain.value = 4.5 + i * 1.2;
      lfo.connect(lg).connect(o.detune);
      lfo.start();
      this.pad.osc.push(o);
    }
    this.pad.gain.connect(this.musicGain);

    this.musicOn = true;
    this.phrase = null;         // { notes, i, t } currently being played
    this.phraseRest = 4;        // bars of silence before the next entry
    this._schedulerId = setInterval(() => this._scheduleMusic(), 60);
    this.nextNoteTime = ctx.currentTime + 0.2;
  }

  /**
   * Bowed lead — a hardanger-ish fiddle. Three partials with a slow bow attack,
   * vibrato that arrives after the note has settled, and a breath of bow noise
   * on the front. A raw sawtooth through a filter sweep just sounds like a synth.
   */
  _bowed(t, midi, dur, vel) {
    const ctx = this.ctx;
    const f0 = midiToFreq(midi);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(Math.max(vel, 0.0002), t + 0.13);
    out.gain.setValueAtTime(Math.max(vel, 0.0002), t + Math.max(0.14, dur * 0.62));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = Math.min(6200, f0 * 7 + 700);
    body.Q.value = 0.7;
    body.connect(out);

    // vibrato, fading in
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.1;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(7, t + Math.min(0.5, dur * 0.5));
    vib.connect(vibG);
    vib.start(t); vib.stop(t + dur + 0.1);

    for (const [mult, amp, type] of [[1, 1.0, 'sawtooth'], [2, 0.22, 'sine'], [3, 0.10, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f0 * mult;
      o.detune.value = (mult - 1) * 4;
      vibG.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(body);
      o.start(t); o.stop(t + dur + 0.1);
    }
    // rosin
    this._noiseBurst(t, 0.09, f0 * 4, 1.4, vel * 0.30, out, 'bandpass');
    out.connect(this.musicGain);
    this._sendReverb(out, 0.5);
  }

  /** Plucked lute — for town and tavern colour. */
  _pluck(t, midi, dur, vel) {
    const ctx = this.ctx;
    const f0 = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0 * 9 + 900, t);
    f.frequency.exponentialRampToValueAtTime(f0 * 2.5 + 200, t + dur);
    f.connect(g).connect(this.musicGain);
    for (const [mult, amp] of [[1, 1.0], [2, 0.34], [3, 0.16], [4.02, 0.07]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f0 * mult;
      const gg = ctx.createGain(); gg.gain.value = amp;
      o.connect(gg).connect(f);
      o.start(t); o.stop(t + dur + 0.05);
    }
    this._noiseBurst(t, 0.02, f0 * 6, 2.0, vel * 0.5, g, 'bandpass');
  }

  /** A horn swell under combat. */
  _horn(t, midi, dur, vel) {
    const ctx = this.ctx;
    const f0 = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vel, 0.0002), t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0 * 2.2, t);
    f.frequency.linearRampToValueAtTime(f0 * 6.0, t + dur * 0.4);
    f.frequency.linearRampToValueAtTime(f0 * 2.4, t + dur);
    f.Q.value = 1.4;
    f.connect(g).connect(this.musicGain);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f0;
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur + 0.08);
    }
    this._sendReverb(g, 0.55);
  }

  _drum(t, kind, vel) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g).connect(this.musicGain);
      o.start(t); o.stop(t + 0.38);
      return;
    }
    // Frame drum: a short skin slap plus the shell's ringing body.
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    g.connect(this.musicGain);
    this._noiseBurst(t, 0.10, kind === 'frame' ? 340 : 1900, 1.1, vel * 0.7, g, 'bandpass',
      kind === 'frame' ? 150 : 900);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'frame' ? 190 : 420, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'frame' ? 96 : 300, t + 0.18);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.55, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(og).connect(g);
    o.start(t); o.stop(t + 0.26);
    this._sendReverb(g, 0.3);
  }

  setMood(mood, intensity = 1) {
    this.mood = mood;
    this.moodTarget = intensity;
  }

  /**
   * Melodies are written, not rolled. Each motif is a list of
   * [scale degree, beats] pairs, shaped so it opens, arches and cadences;
   * picking notes at random out of a scale is what makes generative music
   * sound like an accident rather than a tune.
   */
  _pickPhrase(m) {
    const R = this.rand;
    const CALM = [
      [[0, 2], [2, 1], [3, 1], [2, 2], [0, 3], [null, 1]],
      [[4, 2], [3, 1], [2, 1], [0, 4], [null, 2]],
      [[0, 1], [2, 1], [4, 2], [3, 2], [2, 2], [0, 2]],
      [[7, 3], [6, 1], [4, 2], [3, 2], [2, 4]],
      [[2, 1], [3, 1], [4, 2], [2, 1], [0, 1], [-3, 4]],
    ];
    const SAD = [
      [[4, 3], [3, 1], [2, 2], [1, 2], [0, 4]],
      [[0, 2], [-2, 2], [0, 2], [2, 4], [null, 2]],
      [[7, 4], [4, 2], [3, 2], [2, 4]],
    ];
    const TOWN = [
      [[0, 1], [2, 1], [4, 1], [2, 1], [3, 2], [2, 2]],
      [[4, 1], [4, 1], [3, 1], [2, 1], [0, 2], [2, 2]],
      [[0, 1], [4, 1], [3, 1], [4, 1], [6, 2], [4, 2]],
    ];
    const WAR = [
      [[0, 2], [0, 1], [3, 1], [2, 2], [4, 2]],
      [[4, 1], [3, 1], [2, 1], [0, 1], [0, 4]],
    ];
    if (m.combat > 0.45) return R.pick(WAR);
    if (m.town > 0.45) return R.pick(TOWN);
    if (m.sad > 0.35 || m.night > 0.5) return R.pick(SAD);
    return R.pick(CALM);
  }

  /** Scale degree (can be negative or > 7) to a midi note above a root. */
  _degree(root, d) {
    const n = this.scale.length;
    const oct = Math.floor(d / n);
    const idx = ((d % n) + n) % n;
    return root + this.scale[idx] + oct * 12;
  }

  _scheduleMusic() {
    if (!this.ready || !this.musicOn) return;
    const ctx = this.ctx;
    const spb = 60 / this.tempo;
    while (this.nextNoteTime < ctx.currentTime + 0.6) {
      const t = this.nextNoteTime;
      const beatInBar = this.beat % 8;
      const m = this.moodLevel;

      // ---- harmony ---------------------------------------------------------
      if (beatInBar === 0) {
        this.bar++;
        // i - VI - III - VII, the standard modal turn, with a longer tonic.
        const prog = [0, 0, 8, 8, 3, 3, 10, 10];
        this.chordRoot = this.key + prog[this.bar % prog.length];
        for (const o of this.drone.osc) o.frequency.setTargetAtTime(midiToFreq(this.chordRoot - 12), t, 0.45);
        // Voice the pad by moving each part to its nearest chord tone rather
        // than transposing the whole stack in parallel.
        const tones = [0, 3, 7, 10];
        this.pad.osc.forEach((o, i) => {
          const target = this.chordRoot + tones[i] + 12;
          const cur = o.frequency.value;
          let best = target, bestD = Infinity;
          for (const oct of [-12, 0, 12]) {
            const f = midiToFreq(target + oct);
            const d = Math.abs(Math.log2(f / Math.max(cur, 1)));
            if (d < bestD) { bestD = d; best = target + oct; }
          }
          o.frequency.setTargetAtTime(midiToFreq(best), t, 0.9);
        });

        // ---- melodic phrasing ----------------------------------------------
        const wantsMelody = m.explore * 0.55 + m.town * 0.9 + m.sad * 0.7 + m.combat * 0.5 + m.night * 0.25;
        if (!this.phrase) {
          this.phraseRest -= 1;
          if (this.phraseRest <= 0 && this.rand.next() < wantsMelody) {
            this.phrase = { notes: this._pickPhrase(m), i: 0, next: t, oct: this.rand.bool(0.3) ? 24 : 12 };
          }
        }
      }

      // ---- play the phrase, note by note ------------------------------------
      if (this.phrase && t >= this.phrase.next - 1e-4) {
        const p = this.phrase;
        const [deg, beats] = p.notes[p.i];
        const dur = beats * spb * 0.92;
        if (deg !== null) {
          const midi = this._degree(this.chordRoot ?? this.key, deg) + p.oct;
          const vel = 0.052 * (0.75 + this.rand.float(0, 0.35));
          if (m.town > 0.45) this._pluck(t, midi, dur, vel * 1.4);
          else this._bowed(t, midi, dur * 1.05, vel);
          // an octave-below shadow on the strong notes
          if (beats >= 3 && this.rand.bool(0.5)) this._bowed(t + 0.02, midi - 12, dur, vel * 0.35);
        }
        p.next = t + beats * spb;
        p.i++;
        if (p.i >= p.notes.length) {
          this.phrase = null;
          this.phraseRest = 2 + this.rand.int(0, 3);
        }
      }

      // ---- percussion --------------------------------------------------------
      const drive = m.combat;
      if (drive > 0.05) {
        if (beatInBar % 4 === 0) this._drum(t, 'kick', 0.30 * drive);
        if (beatInBar % 4 === 2) this._drum(t, 'frame', 0.20 * drive);
        if (this.rand.next() < 0.18 * drive) this._drum(t, 'frame', 0.09 * drive);
        if (beatInBar === 6 && this.rand.bool(0.5)) this._drum(t, 'kick', 0.20 * drive);
        if (beatInBar === 0 && this.rand.bool(0.35)) {
          this._horn(t, (this.chordRoot ?? this.key) - 12, spb * 4, 0.05 * drive);
        }
      } else if (m.danger > 0.2 && beatInBar === 0) {
        this._drum(t, 'kick', 0.12 * m.danger);
      }

      this.beat++;
      this.nextNoteTime += spb / 2;
    }
  }

  update(dt, engine) {
    if (!this.ready) return;
    const target = this.moodLevel;
    const cur = this.mood;
    for (const k of Object.keys(target)) {
      const want = k === cur ? (this.moodTarget ?? 1) : 0;
      target[k] = lerp(target[k], want, 1 - Math.exp(-dt * 0.9));
    }
    const m = target;
    const t = this.ctx.currentTime;
    this.drone.gain.gain.setTargetAtTime(
      0.030 * m.explore + 0.055 * m.danger + 0.065 * m.combat + 0.020 * m.town + 0.045 * m.night, t, 0.7);
    this.drone.filter.frequency.setTargetAtTime(
      320 + 900 * m.combat + 220 * m.danger, t, 0.8);
    this.pad.gain.gain.setTargetAtTime(
      0.024 * m.explore + 0.045 * m.sad + 0.030 * m.night + 0.012 * m.town, t, 1.1);
    this.tempo = lerp(66, 104, m.combat) + m.danger * 6;
  }

  dispose() {
    clearInterval(this._schedulerId);
    this.ctx?.close();
  }
}
