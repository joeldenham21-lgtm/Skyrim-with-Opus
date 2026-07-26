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

  footstep(surface = 'grass', strength = 1) {
    if (!this.ready) return;
    const t = this._now();
    if (t - this._lastFootstep < 0.09) return;
    this._lastFootstep = t;
    const v = 0.055 + strength * 0.10;
    switch (surface) {
      case 'snow': this._noiseBurst(t, 0.16, 900, 0.7, v * 0.9, this.busSfx, 'lowpass', 300); break;
      case 'stone': this._noiseBurst(t, 0.08, 2600, 2.2, v * 1.1, this.busSfx, 'bandpass', 900); break;
      case 'gravel': this._noiseBurst(t, 0.11, 2000, 1.1, v, this.busSfx, 'bandpass', 700); break;
      case 'water': this._noiseBurst(t, 0.24, 1400, 0.6, v * 1.3, this.busSfx, 'lowpass', 260); break;
      case 'wood': this._noiseBurst(t, 0.07, 420, 3.0, v * 1.2); this._osc('sine', 140, t, 0.09, v * 0.5); break;
      case 'forest': this._noiseBurst(t, 0.13, 1500, 0.8, v * 0.85, this.busSfx, 'lowpass', 420); break;
      default: this._noiseBurst(t, 0.12, 1100, 0.7, v, this.busSfx, 'lowpass', 380);
    }
  }

  sfx_swing({ heavy = false } = {}) {
    const t = this._now();
    this._noiseBurst(t, heavy ? 0.34 : 0.22, heavy ? 700 : 1100, 1.4, heavy ? 0.20 : 0.13,
      this.busSfx, 'bandpass', heavy ? 180 : 300);
  }
  sfx_hitFlesh({ crit = false } = {}) {
    const t = this._now();
    this._noiseBurst(t, 0.12, 380, 1.0, crit ? 0.32 : 0.22, this.busSfx, 'lowpass', 110);
    this._osc('sine', crit ? 90 : 120, t, 0.14, crit ? 0.20 : 0.13);
  }
  sfx_hitMetal() {
    const t = this._now();
    for (const [f, g, d] of [[2400, 0.10, 0.5], [3600, 0.07, 0.36], [5200, 0.05, 0.25], [1500, 0.08, 0.7]]) {
      const n = this._osc('triangle', f, t, d, g);
      this._sendReverb(n.g, 0.4);
    }
    this._noiseBurst(t, 0.09, 5200, 2.4, 0.12);
  }
  sfx_hitStone() {
    const t = this._now();
    this._noiseBurst(t, 0.16, 900, 1.6, 0.22, this.busSfx, 'bandpass', 250);
    this._osc('square', 160, t, 0.10, 0.09);
  }
  sfx_block() {
    const t = this._now();
    this._noiseBurst(t, 0.13, 1800, 1.2, 0.22, this.busSfx, 'bandpass', 500);
    this._osc('triangle', 320, t, 0.16, 0.13);
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
    const f = kind === 'accept' ? 720 : kind === 'back' ? 380 : 520;
    this._osc('sine', f, t, 0.09, 0.09, this.busUi);
    if (kind === 'accept') this._osc('sine', f * 1.5, t + 0.03, 0.10, 0.06, this.busUi);
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
    rv.gain.value = 0.5;
    this.musicGain.connect(rv);
    rv.connect(this.reverb);

    // Sustained drone bed (two detuned saws through a lowpass).
    this.drone = { osc: [], gain: ctx.createGain(), filter: ctx.createBiquadFilter() };
    this.drone.gain.gain.value = 0;
    this.drone.filter.type = 'lowpass';
    this.drone.filter.frequency.value = 500;
    this.drone.filter.Q.value = 0.6;
    for (const det of [-7, 5, 0]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFreq(this.key - 12);
      o.detune.value = det;
      o.connect(this.drone.filter);
      o.start();
      this.drone.osc.push(o);
    }
    this.drone.filter.connect(this.drone.gain).connect(this.musicGain);

    // Choir pad: three sine partials with slow vibrato.
    this.pad = { osc: [], gain: ctx.createGain() };
    this.pad.gain.gain.value = 0;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = midiToFreq(this.key + [0, 7, 12, 15][i]);
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.28, 0.2, 0.12][i];
      o.connect(g).connect(this.pad.gain);
      o.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.2 + i * 0.35;
      const lg = ctx.createGain();
      lg.gain.value = 3.5;
      lfo.connect(lg).connect(o.detune);
      lfo.start();
      this.pad.osc.push(o);
    }
    this.pad.gain.connect(this.musicGain);

    this.musicOn = true;
    this._schedulerId = setInterval(() => this._scheduleMusic(), 60);
    this.nextNoteTime = ctx.currentTime + 0.2;
  }

  /** Plucked/bowed lead note. */
  _lead(t, midi, dur, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiToFreq(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(2200, t + 0.10);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    f.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
    // sympathetic fifth, quiet
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = midiToFreq(midi + 7);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(vel * 0.22, t + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    o2.connect(g2).connect(this.musicGain);
    o2.start(t); o2.stop(t + dur + 0.05);
  }

  _drum(t, kind, vel) {
    if (kind === 'kick') {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
      o.connect(g).connect(this.musicGain);
      o.start(t); o.stop(t + 0.34);
    } else {
      this._noiseBurst(t, 0.16, kind === 'frame' ? 260 : 1800, 1.2, vel * 0.5, this.musicGain,
        'bandpass', kind === 'frame' ? 120 : 900);
    }
  }

  setMood(mood, intensity = 1) {
    this.mood = mood;
    this.moodTarget = intensity;
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
        const prog = [0, 0, 5, 3, 0, 7, 5, 3];
        this.chordRoot = this.key + prog[this.bar % prog.length];
        for (const o of this.drone.osc) o.frequency.setTargetAtTime(midiToFreq(this.chordRoot - 12), t, 0.35);
        const padTones = [0, 3, 7, 10];
        this.pad.osc.forEach((o, i) => o.frequency.setTargetAtTime(midiToFreq(this.chordRoot + padTones[i] + 12), t, 0.5));
      }

      // ---- lead ------------------------------------------------------------
      const leadChance = m.explore * 0.28 + m.town * 0.42 + m.sad * 0.30 + m.combat * 0.16;
      if (this.rand.next() < leadChance && (beatInBar % 2 === 0 || this.rand.bool(0.3))) {
        const deg = this.scale[this.rand.int(0, this.scale.length - 1)];
        const oct = this.rand.bool(0.35) ? 24 : 12;
        this._lead(t, (this.chordRoot ?? this.key) + deg + oct, spb * this.rand.float(1.1, 2.6),
          0.055 * (0.5 + leadChance));
      }

      // ---- percussion --------------------------------------------------------
      const drive = m.combat;
      if (drive > 0.05) {
        if (beatInBar % 4 === 0) this._drum(t, 'kick', 0.28 * drive);
        if (beatInBar % 4 === 2) this._drum(t, 'frame', 0.22 * drive);
        if (this.rand.next() < 0.22 * drive) this._drum(t, 'frame', 0.10 * drive);
        if (beatInBar === 6 && this.rand.bool(0.5)) this._drum(t, 'kick', 0.20 * drive);
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
